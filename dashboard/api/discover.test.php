<?php
/* discover.test.php — Lead Discovery: parse, dedupe, and never lie about failure.
   Run: php discover.test.php   (no network, no key, no live DB — SQLite + a
   stubbed HTTP call, so the whole provider path is exercised offline.)

   What these protect, in order of how much damage the opposite does:
     1. A FAILED SEARCH MUST NOT LOOK LIKE AN EMPTY MARKET. A dead key returning
        "0 results" is how you conclude there are no AAC plants in Jodhpur.
     2. A FIRM YOU ALREADY SUPPLY IS NOT A LEAD. Handing a salesman an existing
        customer as a "new prospect" is worse than handing him nothing.
     3. THE KEY NEVER LEAVES THE SERVER.
*/
if (php_sapi_name() !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/db.php';

$PASS = 0; $FAIL = 0; $FAILS = [];
function ok($c, $m) { global $PASS, $FAIL, $FAILS; if ($c) { $PASS++; } else { $FAIL++; $FAILS[] = $m; } }
function eq($a, $b, $m) { ok($a === $b, $m . '  (got ' . json_encode($a) . ', want ' . json_encode($b) . ')'); }

echo "\n═══ Lead Discovery · find, dedupe, never lie ═══\n\n";

/* A realistic Places API (New) searchText body. */
$PLACES_JSON = [
  'places' => [
    ['id' => 'p1', 'displayName' => ['text' => 'Shree AAC Blocks Pvt Ltd'], 'formattedAddress' => 'Boranada, Jodhpur',
     'nationalPhoneNumber' => '098290 11111', 'websiteUri' => 'https://shreeaac.in', 'rating' => 4.4,
     'location' => ['latitude' => 26.19, 'longitude' => 73.01]],
    ['id' => 'p2', 'displayName' => ['text' => 'MARWAR AAC BLOCKS PRIVATE LIMITED'], 'formattedAddress' => 'Pali Road, Jodhpur', 'rating' => 4.1],
    ['id' => 'p3', 'displayName' => ['text' => ''], 'formattedAddress' => 'Nowhere'],   // no name ⇒ not a business
    ['id' => 'p4', 'displayName' => ['text' => 'Balaji Blocks'], 'formattedAddress' => 'Pali'],
  ]
];

/* ══════════ 1. parsing ══════════ */
{
  $rows = ql_places_parse($PLACES_JSON, 'Jodhpur');
  eq(count($rows), 3, 'a place with no name is dropped (3 of 4 kept)');
  eq($rows[0]['name'], 'Shree AAC Blocks Pvt Ltd', 'the name is read');
  eq($rows[0]['phone'], '098290 11111', '  phone');
  eq($rows[0]['website'], 'https://shreeaac.in', '  website');
  eq($rows[0]['rating'], 4.4, '  rating');
  eq($rows[0]['city'], 'Jodhpur', '  the searched city is carried on the row');
  ok($rows[0]['lat'] > 26 && $rows[0]['lng'] > 72, '  coordinates are kept (for distance later)');
  eq($rows[1]['rating'], 4.1, 'a place with no phone/website still parses');
  eq($rows[1]['phone'], '', '  and its missing phone is empty, not null-ish garbage');
  eq(ql_places_parse([], 'X'), [], 'a malformed response yields no rows, never a crash');
  eq(ql_places_parse(['places' => 'nonsense'], 'X'), [], '  and neither does a wrong-typed one');
}

/* ══════════ 2. the name key agrees with the browser ══════════ */
{
  eq(ql_norm_name('Shree AAC Blocks Pvt. Ltd.'), ql_norm_name('SHREE AAC BLOCKS PRIVATE LIMITED'),
    'the same firm written two ways normalises to one key (matches CRMCore.normName)');
  ok(ql_norm_name('M/s Balaji & Co') === ql_norm_name('Balaji'), '  M/s, & and Co are noise, not identity');
}

/* ══════════ 3. classification — an existing CUSTOMER is never a new lead ══════════ */
{
  $rows = ql_places_parse($PLACES_JSON, 'Jodhpur');
  $crm   = [ql_norm_name('Balaji Blocks') => 1];                      // already a prospect
  $party = [ql_norm_name('Marwar AAC Blocks Pvt Ltd') => 1];          // already a CUSTOMER
  $out = ql_discover_classify($rows, $crm, $party, [], []);
  $by = [];
  foreach ($out as $r) $by[$r['name']] = $r;

  eq($by['Shree AAC Blocks Pvt Ltd']['status'], 'new', 'a genuinely unknown firm is NEW');
  eq($by['MARWAR AAC BLOCKS PRIVATE LIMITED']['status'], 'duplicate', 'a firm you already SUPPLY is a duplicate…');
  eq($by['MARWAR AAC BLOCKS PRIVATE LIMITED']['dupe_of'], 'customer', '  …and is labelled as an existing customer');
  eq($by['Balaji Blocks']['status'], 'duplicate', 'a firm already in the CRM is a duplicate…');
  eq($by['Balaji Blocks']['dupe_of'], 'crm', '  …labelled as already in the pipeline');
}
{
  // A repeat search must not re-offer what you already reviewed.
  $rows = ql_places_parse($PLACES_JSON, 'Jodhpur');
  $out = ql_discover_classify($rows, [], [], ['p1' => 1], []);
  eq($out[0]['status'], 'seen', 'a place already discovered before comes back as "seen", not "new"');
  $out2 = ql_discover_classify($rows, [], [], [], [ql_norm_name('Balaji Blocks') => 1]);
  $b = null; foreach ($out2 as $r) if ($r['name'] === 'Balaji Blocks') $b = $r;
  eq($b['status'], 'seen', '  and so does one matched by name when the place id changed');
}

/* ══════════ 4. failure is REPORTED, never disguised as "no results" ══════════
   Driven through ql_places_request with a FAKE key, so every branch runs on any
   machine — with or without a config.php. (An earlier version put these behind
   an `if config exists` and a mutation that turned a 403 into "success, zero
   results" sailed straight through. The seam exists because of that miss.) */
{
  $KEY = 'test-key-not-real';
  $call = function ($resp, $what = 'AAC blocks') use ($KEY) {
    return ql_places_request($KEY, $what, 'Jodhpur', [], function () use ($resp) { return $resp; });
  };

  $bad = $call(['code' => 403, 'body' => json_encode(['error' => ['message' => 'API key expired']]), 'err' => '']);
  ok(!$bad['ok'], 'a 403 is a FAILURE, not an empty market');
  ok(strpos($bad['error'], 'expired') !== false, '  and it surfaces Google\'s own words ("API key expired")');
  eq($bad['places'], [], '  with no rows');

  $quota = $call(['code' => 429, 'body' => json_encode(['error' => ['message' => 'Quota exceeded']]), 'err' => '']);
  ok(!$quota['ok'] && strpos($quota['error'], 'Quota') !== false, 'a quota block is reported as such');

  $net = $call(['code' => 0, 'body' => '', 'err' => 'timeout']);
  ok(!$net['ok'] && $net['places'] === [], 'a network failure is a failure, not an empty result');

  $weird = $call(['code' => 500, 'body' => 'not json at all', 'err' => '']);
  ok(!$weird['ok'] && strpos($weird['error'], '500') !== false, 'an unparseable 500 still reports the status, not silence');

  // The ONE case that may legitimately return nothing: a real 200 with no places.
  $empty = $call(['code' => 200, 'body' => json_encode(['places' => []]), 'err' => '']);
  ok($empty['ok'] && $empty['places'] === [], 'a genuine 200 with no matches IS ok+empty — the only honest empty');

  $good = $call(['code' => 200, 'body' => json_encode(['places' => [['id' => 'x', 'displayName' => ['text' => 'A Co']]]]), 'err' => '']);
  ok($good['ok'] && count($good['places']) === 1, 'a good response parses through');

  $blank = $call(['code' => 200, 'body' => '{}', 'err' => ''], '');
  ok(!$blank['ok'], 'an empty query is refused BEFORE any billable call is made');
  eq(ql_places_request('', 'AAC', 'Jodhpur')['error'], 'not_configured', 'no key ⇒ "not_configured", never a silent zero');
}

/* ══════════ 4b. the FREE source (OpenStreetMap) ══════════
   It must work with NO key at all — that is its entire reason for existing —
   and it must obey the same failure contract as Google. */
{
  $OSM_JSON = ['elements' => [
    ['type' => 'node', 'id' => 111, 'lat' => 26.2, 'lon' => 73.0,
     'tags' => ['name' => 'Marudhar AAC Blocks', 'phone' => '+91 98290 22222', 'website' => 'https://marudhar.example',
                'addr:street' => 'Boranada Industrial Area', 'addr:city' => 'Jodhpur']],
    ['type' => 'way', 'id' => 222, 'center' => ['lat' => 26.3, 'lon' => 73.1],
     'tags' => ['name' => 'Thar Cement Works', 'contact:phone' => '0291-2222222']],
    ['type' => 'node', 'id' => 333, 'lat' => 1, 'lon' => 1, 'tags' => ['amenity' => 'bench']],   // no name
  ]];
  $rows = ql_osm_parse($OSM_JSON, 'Jodhpur');
  eq(count($rows), 2, 'OSM: unnamed geometry (a bench) is dropped');
  eq($rows[0]['name'], 'Marudhar AAC Blocks', 'OSM: the name is read');
  eq($rows[0]['phone'], '+91 98290 22222', '  phone from the phone tag');
  eq($rows[0]['address'], 'Boranada Industrial Area, Jodhpur', '  a readable address is built from addr:* tags');
  eq($rows[0]['place_id'], 'osm:node/111', '  a stable id, namespaced so it can never collide with a Google place_id');
  eq($rows[0]['rating'], null, '  OSM has no ratings — none is INVENTED');
  eq($rows[1]['phone'], '0291-2222222', 'contact:phone is read when plain phone is absent');
  ok($rows[1]['lat'] > 26 && $rows[1]['lng'] > 73, 'a way gets its coordinates from "out center"');
  eq($rows[1]['website'], '', 'a missing website is empty, not garbage');
  eq(ql_osm_parse(['elements' => 'nonsense'], 'X'), [], 'a malformed OSM reply yields no rows, never a crash');

  // The whole point: NO KEY NEEDED.
  $good = ql_osm_search('AAC', 'Jodhpur', [], function () use ($OSM_JSON) {
    return ['code' => 200, 'body' => json_encode($OSM_JSON), 'err' => ''];
  });
  ok($good['ok'] && count($good['places']) === 2, 'OSM searches with NO key configured — it is the free path');

  // Same honesty contract as Google.
  $busy = ql_osm_search('AAC', 'Jodhpur', [], function () { return ['code' => 429, 'body' => '', 'err' => '']; });
  ok(!$busy['ok'] && stripos($busy['error'], 'busy') !== false, 'a throttled Overpass says "busy, try again" — not "no businesses"');
  $gw = ql_osm_search('AAC', 'Jodhpur', [], function () { return ['code' => 504, 'body' => '', 'err' => '']; });
  ok(!$gw['ok'], 'a gateway timeout is a failure, not an empty market');
  $dead = ql_osm_search('AAC', 'Jodhpur', [], function () { return ['code' => 0, 'body' => '', 'err' => 'dns']; });
  ok(!$dead['ok'] && $dead['places'] === [], 'a network failure is reported');
  $junk = ql_osm_search('AAC', 'Jodhpur', [], function () { return ['code' => 200, 'body' => 'not json', 'err' => '']; });
  ok(!$junk['ok'], 'an unreadable 200 is a failure, not zero results');
  ok(!ql_osm_search('', 'Jodhpur', [], function () { return ['code' => 200, 'body' => '{}', 'err' => '']; })['ok'], 'an empty query is refused');
  ok(!ql_osm_search('AAC', '', [], function () { return ['code' => 200, 'body' => '{}', 'err' => '']; })['ok'], 'OSM needs a city (it searches inside an administrative area)');

  // A quote in the search text must not be able to rewrite the Overpass query.
  $sent = '';
  ql_osm_search('AAC" ; out count; //', 'Jodhpur', [], function ($u, $payload) use (&$sent) {
    $sent = $payload; return ['code' => 200, 'body' => '{"elements":[]}', 'err' => ''];
  });
  ok(strpos(urldecode($sent), '\\"') !== false, 'a quote in the search text is ESCAPED, not left to break out of the query');

  /* The server-side Overpass timeout must stay UNDER PHP's execution limit — a
     [timeout:25] with a 40s curl cap was killed by PHP mid-call, and the browser
     could only call the debris "Network error". This pins the headroom. */
  $capturedQ = '';
  ql_osm_search('AAC', 'Jodhpur', [], function ($u, $payload) use (&$capturedQ) {
    $capturedQ = urldecode($payload); return ['code' => 200, 'body' => '{"elements":[]}', 'err' => ''];
  });
  ok(preg_match('/\[timeout:(\d+)\]/', $capturedQ, $m) && (int)$m[1] <= 12,
    'the Overpass query timeout is tight enough that TWO endpoint tries still fit under PHP\'s 30s (so the server always returns JSON, never an HTML error page)');

  /* overpass-api.de 504s often on big cities; a mirror is tried before giving up. */
  $urls = [];
  $twoTries = ql_osm_search('AAC', 'Jodhpur', [], function ($u, $payload) use (&$urls, $OSM_JSON) {
    $urls[] = $u;
    // first endpoint 504s, the mirror answers
    return count($urls) === 1 ? ['code' => 504, 'body' => '', 'err' => '']
                              : ['code' => 200, 'body' => json_encode($OSM_JSON), 'err' => ''];
  });
  ok(count($urls) === 2 && $urls[0] !== $urls[1], 'a 504 on the primary Overpass endpoint retries a different mirror');
  ok($twoTries['ok'] && count($twoTries['places']) === 2, '  and the mirror\'s result is used — one slow endpoint no longer fails the search');

  // A clean non-retryable HTTP error (e.g. 400 bad query) must NOT hammer every mirror.
  $hits = 0;
  ql_osm_search('AAC', 'Jodhpur', [], function () use (&$hits) { $hits++; return ['code' => 400, 'body' => '', 'err' => '']; });
  ok($hits === 1, 'a non-retryable HTTP error stops at the first endpoint (no pointless mirror hammering)');
}

/* ══════════ 4c. radius search (geocode → around) ══════════ */
{
  $OSM_JSON = ['elements' => [
    ['type' => 'node', 'id' => 1, 'lat' => 26.3, 'lon' => 73.0, 'tags' => ['name' => 'Marudhar AAC', 'phone' => '946']],
  ]];
  // A radius + a geocodable place → an "around" query centred on that point.
  $sentQ = '';
  $geo = function ($p) { return ['lat' => 26.29, 'lon' => 73.02]; };
  $r = ql_osm_search('AAC', 'Jodhpur', [
    'radiusKm' => 100, 'geocode' => $geo
  ], function ($u, $payload) use (&$sentQ, $OSM_JSON) {
    $sentQ = urldecode($payload);
    return ['code' => 200, 'body' => json_encode($OSM_JSON), 'err' => ''];
  });
  ok($r['ok'] && count($r['places']) === 1, 'radius: a geocodable place returns results');
  ok(strpos($sentQ, 'around:100000,26.29,73.02') !== false, '  the query is an around-search: 100km → 100000m, centred on the geocoded point');
  ok(strpos($sentQ, 'boundary') === false, '  and NOT an area search (no admin-boundary lookup)');
  ok(empty($r['radius_fell_back']), '  radius honoured → no fall-back flag');

  // Radius clamps to a sane metre range.
  $sentBig = '';
  ql_osm_search('AAC', 'Jodhpur', ['radiusKm' => 99999, 'geocode' => $geo], function ($u, $payload) use (&$sentBig) {
    $sentBig = urldecode($payload); return ['code' => 200, 'body' => '{"elements":[]}', 'err' => ''];
  });
  ok(strpos($sentBig, 'around:500000,') !== false, 'radius: clamped to 500km (500000m) — never an unbounded planet-wide scan');

  // Geocode FAILS → fall back to an area search, honestly flagged, not an error.
  $sentFb = '';
  $geoDead = function ($p) { return null; };
  $fb = ql_osm_search('AAC', 'Jodhpur', ['radiusKm' => 100, 'geocode' => $geoDead], function ($u, $payload) use (&$sentFb, $OSM_JSON) {
    $sentFb = urldecode($payload); return ['code' => 200, 'body' => json_encode($OSM_JSON), 'err' => ''];
  });
  ok($fb['ok'] && !empty($fb['radius_fell_back']), 'radius: a place that will not geocode falls back to area search AND says so');
  ok(strpos($sentFb, 'boundary') !== false, '  the fall-back really is the area query');

  // Radius mode spends its budget on geocode, so it must try only ONE Overpass endpoint.
  $tries = 0;
  ql_osm_search('AAC', 'Jodhpur', ['radiusKm' => 100, 'geocode' => $geo], function () use (&$tries) {
    $tries++; return ['code' => 504, 'body' => '', 'err' => ''];
  });
  ok($tries === 1, 'radius: only ONE Overpass endpoint is tried (geocode already spent part of the 30s budget)');
}

/* ══════════ 5. the key never leaves the server ══════════ */
{
  $src = file_get_contents(__DIR__ . '/discover.php');
  /* Naming the SETTING in a help message is good ("add GOOGLE_PLACES_KEY to
     config.php"). Reading its VALUE in the endpoint is not — that is how a
     secret ends up in a response body. Assert the latter, not the former. */
  ok(strpos($src, 'ql_places_key(') === false, 'discover.php never reads the key value itself');
  ok(!preg_match('/\\$c\\s*\\[\\s*.GOOGLE_PLACES_KEY/', $src), '  and never pulls it out of config directly');
  ok(strpos($src, 'ql_places_search(') !== false, '  it calls the one door instead');
  /* Asking "is Google set up?" must hand back a yes/no, never the secret — the
     answer to this one is sent to the browser by the `sources` action. */
  ok(is_bool(ql_has_places_key()), '  "is Google configured?" answers with a bool, never the key itself');
  $db = file_get_contents(__DIR__ . '/db.php');
  ok(strpos($db, "X-Goog-Api-Key: ' . \$key") !== false, 'the key is sent as a header from the SERVER, never to the browser');
  // The client must never receive it.
  ok(strpos($src, 'places.googleapis.com') === false, '  and the endpoint URL is not duplicated in the endpoint file');
}

/* ══════════ 6. the whole flow against a real (sqlite) database ══════════ */
{
  $db = new PDO('sqlite::memory:');
  $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $db->exec("CREATE TABLE discovered (id INTEGER PRIMARY KEY AUTOINCREMENT, plant_id TEXT, company_id TEXT, source TEXT,
    place_id TEXT, name TEXT, name_key TEXT, industry TEXT, address TEXT, city TEXT, phone TEXT, website TEXT,
    rating REAL, lat REAL, lng REAL, fit_score INTEGER, status TEXT, dupe_of TEXT, query TEXT)");
  $db->exec("CREATE TABLE crm_companies (id INTEGER PRIMARY KEY AUTOINCREMENT, plant_id TEXT, company_id TEXT, name TEXT,
    industry TEXT, website TEXT, city TEXT, source TEXT, notes TEXT)");
  $db->exec("CREATE TABLE crm_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, plant_id TEXT, company_id TEXT,
    crm_company INTEGER, name TEXT, phone TEXT, consent_basis TEXT)");

  $rows = ql_discover_classify(ql_places_parse($PLACES_JSON, 'Jodhpur'), [], [], [], []);
  $ins = $db->prepare('INSERT INTO discovered (plant_id, company_id, source, place_id, name, name_key, industry, address, city, phone, website, rating, lat, lng, status, dupe_of)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  foreach ($rows as $c) {
    $ins->execute(['P', 'C', 'google', $c['place_id'], $c['name'], $c['name_key'], 'aac', $c['address'], $c['city'],
      $c['phone'], $c['website'], $c['rating'], $c['lat'], $c['lng'], $c['status'], $c['dupe_of']]);
  }
  $n = (int)$db->query("SELECT COUNT(*) FROM discovered")->fetchColumn();
  eq($n, 3, 'three candidates stored');

  // Promote the first one, exactly as discover.php does.
  $d = $db->query("SELECT * FROM discovered WHERE place_id='p1'")->fetch(PDO::FETCH_ASSOC);
  $db->prepare('INSERT INTO crm_companies (plant_id, company_id, name, industry, website, city, source, notes) VALUES (?,?,?,?,?,?,?,?)')
     ->execute(['P', 'C', $d['name'], $d['industry'], $d['website'], $d['city'], 'discovery', 'Found via Lead Discovery.']);
  $newId = (int)$db->lastInsertId();
  $db->prepare('INSERT INTO crm_contacts (plant_id, company_id, crm_company, name, phone, consent_basis) VALUES (?,?,?,?,?,?)')
     ->execute(['P', 'C', $newId, $d['name'], $d['phone'], 'purchased']);
  $db->prepare("UPDATE discovered SET status='promoted' WHERE id=?")->execute([$d['id']]);

  eq((int)$db->query("SELECT COUNT(*) FROM crm_companies")->fetchColumn(), 1, 'promoting creates a pipeline company');
  eq($db->query("SELECT source FROM crm_companies")->fetchColumn(), 'discovery', '  tagged as found by discovery');
  eq($db->query("SELECT status FROM discovered WHERE place_id='p1'")->fetchColumn(), 'promoted', '  the candidate is marked promoted');
  eq($db->query("SELECT consent_basis FROM crm_contacts")->fetchColumn(), 'purchased',
    'the discovered phone is stored as "purchased" — legitimate to ring, never to cold-WhatsApp');
}

echo ($FAIL ? "❌ FAILED" : "✅ PASSED") . " — Passed: $PASS · Failed: $FAIL\n";
foreach ($FAILS as $f) echo "  ❌ $f\n";
echo "\n";
exit($FAIL ? 1 : 0);
