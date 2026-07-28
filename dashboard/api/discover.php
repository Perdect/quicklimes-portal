<?php
/* POST /api/discover.php — Lead Discovery.

   Find businesses by trade + city through a data source, dedupe them against
   what you already know, and promote the good ones into the pipeline.

     { action:'search',  what, city, industry?, token }  -> { ok, added, dupes, seen, rows[] }
     { action:'list',    status?, token }                -> { ok, rows[], counts{} }
     { action:'promote', id, token }                     -> { ok, company_id }
     { action:'dismiss', id, token }                     -> { ok }
     { action:'del',     id, token }                     -> { ok }

   The API key lives ONLY in api/config.php (see ql_places_search). A failure is
   reported with the provider's own words — a search that quietly returns zero
   is how you conclude a market is empty when really your key expired. */
require __DIR__ . '/db.php';
require __DIR__ . '/llm.php';   // Assess / Message use it; WHICH provider is llm.php's business, never named here
ql_cors();

$b      = ql_body();
$action = (string)($b['action'] ?? '');
$plantId = (string)($b['plant_id'] ?? '');
$coId    = (string)($b['company_id'] ?? '');

$ctx = ql_token_ctx($plantId);
if (!$ctx)                           ql_out(['ok' => false, 'error' => 'Unauthorized'], 401);
if (!ql_role_can($ctx['role'], '*')) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);

ql_ensure_tables();
$db = ql_db();

/* Per-plant integration tokens live in the DB (app_data, data_id='ql_integrations')
   so the owner can paste a Mapbox token IN THE APP — no server-file editing, no
   OPcache. The global config.php MAPBOX_TOKEN still works and takes precedence. */
function ql_plant_mapbox_token($db, $plantId) {
  $q = $db->prepare('SELECT data FROM app_data WHERE plant_id = ? AND data_id = ? LIMIT 1');
  $q->execute([$plantId, 'ql_integrations']);
  $row = $q->fetch(PDO::FETCH_ASSOC);
  if (!$row) return '';
  $d = json_decode((string)($row['data'] ?? '{}'), true);
  return trim((string)($d['mapbox_token'] ?? ''));
}
function ql_plant_google_key($db, $plantId) {
  $q = $db->prepare('SELECT data FROM app_data WHERE plant_id = ? AND data_id = ? LIMIT 1');
  $q->execute([$plantId, 'ql_integrations']);
  $row = $q->fetch(PDO::FETCH_ASSOC);
  if (!$row) return '';
  $d = json_decode((string)($row['data'] ?? '{}'), true);
  return trim((string)($d['google_key'] ?? ''));
}
function ql_effective_google_key($db, $plantId) {
  $g = ql_places_key(); if ($g !== '') return $g;      // global config.php wins
  return ql_plant_google_key($db, $plantId);
}
function ql_effective_mapbox_token($db, $plantId) {
  $g = ql_mapbox_key(); if ($g !== '') return $g;      // global config.php wins
  return ql_plant_mapbox_token($db, $plantId);
}

/* Owner pastes / clears their Google Places key from the app. Stored beside the
   Mapbox token in the SAME row, so saving one must never wipe the other. */
if ($action === 'save_google') {
  $key = trim((string)($b['google_key'] ?? ''));   // never 'token' — that is the session
  if ($key !== '' && !preg_match('/^AIza[0-9A-Za-z_\-]{20,}$/', $key)) {
    ql_out(['ok' => false, 'error' => 'That does not look like a Google API key — it should start with "AIza".']);
  }
  $cur = ['mapbox_token' => ql_plant_mapbox_token($db, $plantId)];
  $cur['google_key'] = $key;
  $db->prepare('INSERT INTO app_data (plant_id, data_id, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)')
     ->execute([$plantId, 'ql_integrations', json_encode($cur)]);
  ql_out(['ok' => true, 'google' => $key !== '']);
}

/* Owner pastes / clears their Mapbox token from the app. */
if ($action === 'save_mapbox') {
  // read 'mapbox_token' — NOT 'token' (that field carries the session auth token).
  $token = trim((string)($b['mapbox_token'] ?? ''));
  if ($token !== '' && !preg_match('/^pk\.[A-Za-z0-9._-]{20,}$/', $token)) {
    ql_out(['ok' => false, 'error' => 'That does not look like a Mapbox public token — it should start with "pk."']);
  }
  $keep = ['google_key' => ql_plant_google_key($db, $plantId), 'mapbox_token' => $token];
  $db->prepare('INSERT INTO app_data (plant_id, data_id, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)')
     ->execute([$plantId, 'ql_integrations', json_encode($keep)]);
  ql_out(['ok' => true, 'mapbox' => $token !== '']);
}

/* Everything you already know, as normalised-name sets. */
function ql_known_keys($db, $plantId, $coId) {
  $crm = []; $party = [];
  try {
    $st = $db->prepare('SELECT name FROM crm_companies WHERE plant_id = ? AND company_id = ?');
    $st->execute([$plantId, $coId]);
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) { $k = ql_norm_name($r['name']); if ($k !== '') $crm[$k] = 1; }
  } catch (Throwable $e) { /* table may not exist yet */ }
  return [$crm, $party];
}

/* Shared pipeline: given already-fetched candidate places (from Google on the
   server, OR from OpenStreetMap fetched by the BROWSER and posted here), classify
   against what we already know, dedupe, store, and return the rows. Both the
   'search' (Google) and 'ingest' (browser-fetched OSM) actions end here, so the
   two can never disagree about how a candidate is judged or saved. */
function ql_discover_store($db, $plantId, $coId, $src, $places, $ind, $q = '') {
  list($crmKeys, $partyKeys) = ql_known_keys($db, $plantId, $coId);
  $seenP = []; $seenN = [];
  try {
    $st = $db->prepare('SELECT place_id, name_key FROM discovered WHERE plant_id = ? AND company_id = ?');
    $st->execute([$plantId, $coId]);
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
      if ($row['place_id']) $seenP[$row['place_id']] = 1;
      if ($row['name_key']) $seenN[$row['name_key']] = 1;
    }
  } catch (Throwable $e) {}

  $rows = ql_discover_classify($places, $crmKeys, $partyKeys, $seenP, $seenN);
  $ins = $db->prepare('INSERT INTO discovered
      (plant_id, company_id, source, place_id, name, name_key, industry, address, city, phone, website, rating, lat, lng, status, dupe_of, query)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  $added = 0; $dupes = 0; $seenN2 = 0; $failed = 0; $firstErr = ''; $out = [];
  foreach ($rows as $c) {
    if ($c['status'] === 'seen') { $seenN2++; continue; }
    try {
      /* 17 columns, 17 placeholders, 17 VALUES. The `query` column had a
         placeholder but NO value, so every execute() threw "Invalid parameter
         number" — and the catch below counted each failure as "seen before".
         Result: nothing was ever saved, while the UI reported dozens of
         already-known companies. A save that fails must never be reported as a
         save that was skipped. */
      $ins->execute([$plantId, $coId, $src, $c['place_id'] ?: null, $c['name'], $c['name_key'], $ind,
        $c['address'] ?: null, $c['city'] ?: null, $c['phone'] ?: null, $c['website'] ?: null,
        $c['rating'], $c['lat'], $c['lng'], $c['status'], $c['dupe_of'], $q]);
    } catch (Throwable $e) {
      $failed++; if ($firstErr === '') $firstErr = $e->getMessage();
      continue;
    }
    if ($c['status'] === 'duplicate') $dupes++; else $added++;
    $c['id'] = (int)$db->lastInsertId();
    $out[] = $c;
  }
  return ['added' => $added, 'dupes' => $dupes, 'seen' => $seenN2, 'rows' => $out,
          'failed' => $failed, 'save_error' => $firstErr];
}

if ($action === 'search') {
  $what = trim((string)($b['what'] ?? ''));
  $city = trim((string)($b['city'] ?? ''));
  $ind  = trim((string)($b['industry'] ?? ''));
  $radiusKm = (int)($b['radius'] ?? 0);   // 0 = search the whole named area (no circle)

  /* TWO SOURCES, one shape. OpenStreetMap is the free one (no key, no billing)
     and is therefore the DEFAULT: a user who never sets up Google still gets a
     working feature. Google is richer — better phone coverage — when a key is
     present. Whichever is used, the rows and the failure contract are identical
     so nothing downstream has to care. */
  $src = (string)($b['source'] ?? '');
  if (!in_array($src, ['google', 'osm', 'mapbox'], true)) $src = ql_effective_google_key($db, $plantId) !== '' ? 'google' : (ql_effective_mapbox_token($db, $plantId) !== '' ? 'mapbox' : 'osm');

  /* Radius is an OSM-only refinement (it needs a geocoded centre + Overpass
     around-search). Google/Mapbox scope by place/proximity themselves, so the
     radius is simply not passed there. */
  if ($src === 'osm')         $r = ql_osm_search($what, $city, ['max' => 40, 'radiusKm' => $radiusKm]);
  elseif ($src === 'mapbox')  $r = ql_mapbox_search($what, $city, ['max' => 10, 'token' => ql_effective_mapbox_token($db, $plantId)]);
  else                        $r = ql_places_search($what, $city, ['max' => 20, 'key' => ql_effective_google_key($db, $plantId)]);

  if (!$r['ok']) {
    $e = $r['error'];
    if ($e === 'not_configured') {
      // Never a dead end: the free source needs nothing at all.
      $needs = $src === 'mapbox' ? 'Mapbox needs a token (MAPBOX_TOKEN in api/config.php — free tier).' : 'Google search needs a key (GOOGLE_PLACES_KEY in api/config.php).';
      ql_out(['ok' => false, 'not_configured' => true, 'source' => $src,
        'error' => $needs . ' OpenStreetMap is free and needs no key — switch the source above.']);
    }
    ql_out(['ok' => false, 'source' => $src, 'error' => $e]);
  }

  $s = ql_discover_store($db, $plantId, $coId, $src, $r['places'], $ind, $what);
  /* A SAVE THAT FAILED IS NOT A SUCCESS. Reporting failures here is what turns a
     silent data-loss bug into something the user can see immediately. */
  if (!empty($s['failed'])) {
    ql_out(['ok' => false, 'source' => $src,
      'error' => 'Found ' . $s['failed'] . ' businesses but could not save them: ' . $s['save_error']]);
  }
  ql_out(['ok' => true, 'source' => $src, 'added' => $s['added'], 'dupes' => $s['dupes'], 'seen' => $s['seen'],
    'radius_fell_back' => !empty($r['radius_fell_back']), 'rows' => $s['rows']]);
}

/* INGEST — OpenStreetMap results fetched by the BROWSER, posted here to store.
   Why the browser fetches OSM instead of this server: the free Overpass service
   is slow (30s+ when busy) and throttles datacenter IPs, so a server curl bounded
   under PHP's 30s limit reports "could not reach" while a browser (residential
   IP, no hard time limit, CORS allowed) succeeds. The server still owns parsing,
   classification and dedupe — the browser only carries the raw elements across. */
if ($action === 'ingest') {
  $city = trim((string)($b['city'] ?? ''));
  $ind  = trim((string)($b['industry'] ?? ''));
  $elements = $b['elements'] ?? null;
  if (!is_array($elements)) ql_out(['ok' => false, 'error' => 'No results to ingest']);
  if (count($elements) > 200) $elements = array_slice($elements, 0, 200);   // sanity cap
  $places = ql_osm_parse(['elements' => $elements], $city);
  $s = ql_discover_store($db, $plantId, $coId, 'osm', $places, $ind, $city);
  if (!empty($s['failed'])) {
    ql_out(['ok' => false, 'source' => 'osm',
      'error' => 'Found ' . $s['failed'] . ' businesses but could not save them: ' . $s['save_error']]);
  }
  ql_out(['ok' => true, 'source' => 'osm', 'added' => $s['added'], 'dupes' => $s['dupes'], 'seen' => $s['seen'], 'rows' => $s['rows']]);
}

if ($action === 'sources') {
  // OSM is always available; Google only with a key. The page asks, rather than
  // guessing, so it never offers a source that cannot work.
  /* mapbox_public: the pk. token is a PUBLIC token — Mapbox designs it to be used
     from the browser for map tiles, unlike the Google key (server-only, never
     leaves this box). Returning it lets the demand map render real Mapbox
     streets instead of a washed-out fallback basemap. */
  $mb = ql_effective_mapbox_token($db, $plantId);
  ql_out(['ok' => true, 'osm' => true,
    'google' => ql_effective_google_key($db, $plantId) !== '',
    'mapbox' => $mb !== '',
    'mapbox_public' => (strpos($mb, 'pk.') === 0 ? $mb : '')]);
}

/* ASSESS / MESSAGE — the live-Claude path for the lead-working actions. The
   browser has a local rule-based version (lead-actions.js) that always works
   with no key; this upgrades it to live analysis WHEN a provider key is set.
   No key, or the provider errored → { ok:false, fallback:true } and the client
   silently uses its local rules. The key never leaves the server; WHICH model
   answers is llm.php's business (same contract as extract.php). */
if ($action === 'assess' || $action === 'message') {
  $llm = ql_llm();
  if ($llm['key'] === '') ql_out(['ok' => false, 'fallback' => true, 'error' => 'llm_not_configured']);

  // Untrusted input, capped for cost/abuse — this is the boundary.
  $lead = is_array($b['lead'] ?? null) ? $b['lead'] : [];
  $cap = function ($v, $n = 160) { return substr(trim((string)$v), 0, $n); };
  $name = $cap($lead['name'] ?? '', 200);
  if ($name === '') ql_out(['ok' => false, 'fallback' => true, 'error' => 'no_lead']);
  $industry = $cap($lead['industry'] ?? '');
  $city     = $cap($lead['city'] ?? '');
  $has = [];
  if (!empty($lead['phone']))   $has[] = 'a phone number';
  if (!empty($lead['email']))   $has[] = 'an email';
  if (!empty($lead['website'])) $has[] = 'a website';
  $contact = $has ? implode(', ', $has) : 'no contact details';

  $products = ['quick' => 'Quick Lime (CaO)', 'hydrated' => 'Hydrated Lime (Ca(OH)₂)', 'powder' => 'Lime Powder'];
  $product = $products[(string)($b['product'] ?? 'quick')] ?? 'lime';
  $seller = is_array($b['seller'] ?? null) ? $b['seller'] : [];
  $sellerName = $cap($seller['name'] ?? 'Gotan Lime Industries', 120);
  $sellerCity = $cap($seller['city'] ?? 'Gotan, Rajasthan', 120);

  $ctxLine = "$sellerName is a lime manufacturer in $sellerCity, India, selling $product. "
    . "A discovered potential buyer: \"$name\"" . ($industry !== '' ? ", industry: $industry" : ", industry not stated")
    . ($city !== '' ? ", location: $city" : '') . ". Contact on file: $contact.";

  $honesty = "Be honest: use real industrial knowledge of where lime is actually consumed. If this industry does "
    . "not use lime, or the industry is unknown, say so plainly. NEVER invent a contact person's name, a phone "
    . "number, an email, or a price — you were given none.";

  if ($action === 'assess') {
    $prompt = "You are a B2B sales advisor for an Indian lime manufacturer.\n$ctxLine\n\n"
      . "Assess this lead as a lime buyer. Give a one-line verdict, then 3 to 5 short points covering: whether and "
      . "why they use lime (for what process), a realistic buying pattern, and the ROLE/title to ask for (never a "
      . "person's name). Then one line on how to approach them.\n$honesty";
    $schema = ['type' => 'object', 'properties' => [
      'summary'  => ['type' => 'string'],
      'points'   => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
        'label' => ['type' => 'string'], 'value' => ['type' => 'string']],
        'required' => ['label', 'value'], 'additionalProperties' => false]],
      'approach' => ['type' => 'string'],
    ], 'required' => ['summary', 'points', 'approach'], 'additionalProperties' => false];
    $tool = 'lead_assess';
  } else {
    $prompt = "Write a short first-contact outreach message for an Indian lime manufacturer.\n$ctxLine\n\n"
      . "From $sellerName to this lead. 4 to 6 lines, warm but businesslike (Indian B2B tone). Introduce that we "
      . "manufacture and supply $product in bulk, say specifically how lime fits their industry, and ask to share "
      . "grades and landed rates / reach the right buyer. End with the sender name \"$sellerName\".\n$honesty "
      . "Return ONLY the message text, no subject line, no placeholders like [Name].";
    $schema = ['type' => 'object', 'properties' => ['message' => ['type' => 'string']],
      'required' => ['message'], 'additionalProperties' => false];
    $tool = 'lead_message';
  }

  $r = ql_llm_extract($llm, $prompt, [], $schema, $tool);
  if (!$r['ok'] || $r['data'] === null) {
    error_log('[discover:' . $action . '] ' . $r['provider'] . '/' . $r['model'] . ' failed: ' . $r['error'] . ' (http ' . $r['http'] . ')');
    ql_out(['ok' => false, 'fallback' => true, 'error' => $r['error'] ?: 'ai_unavailable']);
  }
  ql_out(['ok' => true, 'data' => $r['data'], 'provider' => $r['provider'], 'model' => $r['model']]);
}

if ($action === 'list') {
  /* NEVER let a sort column blank the whole list. If `discovered` predates
     fit_score the ORDER BY throws, the user sees zero rows in every tab while
     the dedupe still reports "30 seen before", and the app looks broken while
     holding their data. Try the ranked order, fall back to plain recency. */
  try {
    $st = $db->prepare('SELECT * FROM discovered WHERE plant_id = ? AND company_id = ? ORDER BY (fit_score IS NULL), fit_score DESC, id DESC LIMIT 500');
    $st->execute([$plantId, $coId]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
  } catch (Throwable $e) {
    $st = $db->prepare('SELECT * FROM discovered WHERE plant_id = ? AND company_id = ? ORDER BY id DESC LIMIT 500');
    $st->execute([$plantId, $coId]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
  }
  $counts = ['new' => 0, 'duplicate' => 0, 'promoted' => 0, 'dismissed' => 0];
  foreach ($rows as $r) { $s = $r['status']; if (isset($counts[$s])) $counts[$s]++; }
  /* DIAGNOSTIC: if this plant HAS discovered rows but none under the company_id
     the page is asking for, the list looks empty while dedupe says "seen before".
     Reporting both numbers turns that silent mismatch into something visible. */
  $diag = ['scope' => 0, 'plant' => 0, 'company_id' => (string)$coId, 'other_ids' => []];
  try {
    $d1 = $db->prepare('SELECT COUNT(*) FROM discovered WHERE plant_id = ?');
    $d1->execute([$plantId]); $diag['plant'] = (int)$d1->fetchColumn();
    $diag['scope'] = count($rows);
    if ($diag['plant'] > 0 && $diag['scope'] === 0) {
      $d2 = $db->prepare('SELECT company_id, COUNT(*) c FROM discovered WHERE plant_id = ? GROUP BY company_id LIMIT 5');
      $d2->execute([$plantId]);
      $diag['other_ids'] = $d2->fetchAll(PDO::FETCH_ASSOC);
    }
  } catch (Throwable $e) { $diag['err'] = $e->getMessage(); }
  ql_out(['ok' => true, 'rows' => $rows, 'counts' => $counts, 'diag' => $diag]);
}

if ($action === 'promote') {
  $id = (int)($b['id'] ?? 0);
  $st = $db->prepare('SELECT * FROM discovered WHERE id = ? AND plant_id = ? AND company_id = ? LIMIT 1');
  $st->execute([$id, $plantId, $coId]);
  $d = $st->fetch(PDO::FETCH_ASSOC);
  if (!$d) ql_out(['ok' => false, 'error' => 'Not found']);

  // Becomes YOUR record — your note about a business you intend to sell to.
  $ins = $db->prepare('INSERT INTO crm_companies (plant_id, company_id, name, industry, website, city, source, notes)
    VALUES (?,?,?,?,?,?,?,?)');
  try {
    $ins->execute([$plantId, $coId, $d['name'], (string)$d['industry'], $d['website'], $d['city'], 'discovery',
      trim('Found via Lead Discovery. ' . (string)$d['address'])]);
    $newId = (int)$db->lastInsertId();
  } catch (Throwable $e) { ql_out(['ok' => false, 'error' => 'Could not add to the pipeline']); }

  // The phone becomes a CONTACT with a lawful basis of 'purchased' — a number
  // found in a directory is legitimate to hold and to ring, but must never be
  // cold-WhatsApped (CRMCore.mayContact enforces it).
  if (!empty($d['phone'])) {
    try {
      $c = $db->prepare('INSERT INTO crm_contacts (plant_id, company_id, crm_company, name, phone, consent_basis)
        VALUES (?,?,?,?,?,?)');
      $c->execute([$plantId, $coId, $newId, $d['name'], $d['phone'], 'purchased']);
    } catch (Throwable $e) { /* contact is a bonus, not the point */ }
  }
  /* A promoted company must ENTER THE PIPELINE, not merely exist in the CRM.
     Without this row the acquisition board stays empty no matter how many
     leads you promote — the company was created, the lead never was. The fit
     score travels with it so the board can sort hot/warm/cold on day one. */
  $leadId = 0;
  try {
    $lq = $db->prepare('INSERT INTO crm_leads (plant_id, company_id, crm_company, stage, score, score_why)
      VALUES (?,?,?,?,?,?)');
    $lq->execute([$plantId, $coId, $newId, 'new',
      ($d['fit_score'] === null || $d['fit_score'] === '') ? null : (int)$d['fit_score'],
      'Fit score carried over from Lead Discovery']);
    $leadId = (int)$db->lastInsertId();
  } catch (Throwable $e) { /* the company is saved either way; report it below */ }

  $db->prepare('UPDATE discovered SET status = ? WHERE id = ?')->execute(['promoted', $id]);
  ql_out(['ok' => true, 'company_id' => $newId, 'lead_id' => $leadId]);
}

if ($action === 'dismiss' || $action === 'del') {
  $id = (int)($b['id'] ?? 0);
  if ($action === 'del') $db->prepare('DELETE FROM discovered WHERE id = ? AND plant_id = ? AND company_id = ?')->execute([$id, $plantId, $coId]);
  else $db->prepare('UPDATE discovered SET status = ? WHERE id = ? AND plant_id = ? AND company_id = ?')->execute(['dismissed', $id, $plantId, $coId]);
  ql_out(['ok' => true]);
}

ql_out(['ok' => false, 'error' => 'Unknown action'], 400);
