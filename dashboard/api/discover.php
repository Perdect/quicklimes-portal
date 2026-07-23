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
function ql_discover_store($db, $plantId, $coId, $src, $places, $ind) {
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
  $added = 0; $dupes = 0; $seenN2 = 0; $out = [];
  foreach ($rows as $c) {
    if ($c['status'] === 'seen') { $seenN2++; continue; }
    try {
      $ins->execute([$plantId, $coId, $src, $c['place_id'] ?: null, $c['name'], $c['name_key'], $ind,
        $c['address'] ?: null, $c['city'] ?: null, $c['phone'] ?: null, $c['website'] ?: null,
        $c['rating'], $c['lat'], $c['lng'], $c['status'], $c['dupe_of']]);
    } catch (Throwable $e) { $seenN2++; continue; }
    if ($c['status'] === 'duplicate') $dupes++; else $added++;
    $c['id'] = (int)$db->lastInsertId();
    $out[] = $c;
  }
  return ['added' => $added, 'dupes' => $dupes, 'seen' => $seenN2, 'rows' => $out];
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
  if ($src !== 'google' && $src !== 'osm') $src = ql_has_places_key() ? 'google' : 'osm';

  /* Radius is an OSM-only refinement (it needs a geocoded centre + Overpass
     around-search). Google's own text search already scopes by place, so the
     radius is simply not passed there. */
  $r = ($src === 'osm')
    ? ql_osm_search($what, $city, ['max' => 40, 'radiusKm' => $radiusKm])
    : ql_places_search($what, $city, ['max' => 20]);

  if (!$r['ok']) {
    $e = $r['error'];
    if ($e === 'not_configured') {
      // Never a dead end: the free source needs nothing at all.
      ql_out(['ok' => false, 'not_configured' => true, 'source' => $src,
        'error' => 'Google search needs a key (GOOGLE_PLACES_KEY in api/config.php). OpenStreetMap is free and needs no key — switch the source above.']);
    }
    ql_out(['ok' => false, 'source' => $src, 'error' => $e]);
  }

  $s = ql_discover_store($db, $plantId, $coId, $src, $r['places'], $ind);
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
  $s = ql_discover_store($db, $plantId, $coId, 'osm', $places, $ind);
  ql_out(['ok' => true, 'source' => 'osm', 'added' => $s['added'], 'dupes' => $s['dupes'], 'seen' => $s['seen'], 'rows' => $s['rows']]);
}

if ($action === 'sources') {
  // OSM is always available; Google only with a key. The page asks, rather than
  // guessing, so it never offers a source that cannot work.
  ql_out(['ok' => true, 'osm' => true, 'google' => ql_has_places_key()]);
}

if ($action === 'list') {
  $st = $db->prepare('SELECT * FROM discovered WHERE plant_id = ? AND company_id = ? ORDER BY (fit_score IS NULL), fit_score DESC, id DESC LIMIT 500');
  $st->execute([$plantId, $coId]);
  $rows = $st->fetchAll(PDO::FETCH_ASSOC);
  $counts = ['new' => 0, 'duplicate' => 0, 'promoted' => 0, 'dismissed' => 0];
  foreach ($rows as $r) { $s = $r['status']; if (isset($counts[$s])) $counts[$s]++; }
  ql_out(['ok' => true, 'rows' => $rows, 'counts' => $counts]);
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
  $db->prepare('UPDATE discovered SET status = ? WHERE id = ?')->execute(['promoted', $id]);
  ql_out(['ok' => true, 'company_id' => $newId]);
}

if ($action === 'dismiss' || $action === 'del') {
  $id = (int)($b['id'] ?? 0);
  if ($action === 'del') $db->prepare('DELETE FROM discovered WHERE id = ? AND plant_id = ? AND company_id = ?')->execute([$id, $plantId, $coId]);
  else $db->prepare('UPDATE discovered SET status = ? WHERE id = ? AND plant_id = ? AND company_id = ?')->execute(['dismissed', $id, $plantId, $coId]);
  ql_out(['ok' => true]);
}

ql_out(['ok' => false, 'error' => 'Unknown action'], 400);
