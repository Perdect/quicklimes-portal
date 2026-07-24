<?php
/* POST /api/freight.php — Freight Calculator helpers.

   Distance/geocoding that must NOT run in the browser with the Google key.
   The key lives only in api/config.php (GOOGLE_PLACES_KEY, shared with Places).
   When there is no key, we return { ok:false, fallback:true } — HONEST — so the
   client falls back to its free road-km estimate (lime-market) and free
   Nominatim geocoding, exactly like Lead Discovery does.

     { action:'config' }                                  -> { ok, google:bool }
     { action:'geocode',  q, token }                      -> { ok, lat,lng,formatted,city,state,pin,source } | { fallback:true }
     { action:'distance', oLat,oLng,dLat,dLng, token }    -> { ok, km, minutes, source } | { fallback:true }

   No history is stored here yet (Phase 1 keeps freight history on the client);
   server-side history + transporter master + dispatch are the Phase 2 backend. */
require __DIR__ . '/db.php';
ql_cors();

$b      = ql_body();
$action = (string)($b['action'] ?? '');

/* config is public-ish (just says whether a key exists — never the key). */
if ($action === 'config') {
  ql_out(['ok' => true, 'google' => ql_has_places_key(), 'mapbox' => ql_has_mapbox_key()]);
}

/* Everything else needs a valid session (per-plant token). */
$plantId = (string)($b['plant_id'] ?? '');
$ctx = ql_token_ctx($plantId);
if (!$ctx) ql_out(['ok' => false, 'error' => 'Unauthorized'], 401);

$key = ql_places_key();

/* Small curl GET → decoded JSON (or null). */
function ql_freight_get($url) {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 12,
    CURLOPT_CONNECTTIMEOUT => 6,
    CURLOPT_USERAGENT => 'QuickLimes-Freight/1.0'
  ]);
  $raw = curl_exec($ch);
  $err = curl_error($ch);
  curl_close($ch);
  if ($raw === false || $raw === '') return ['_err' => $err ?: 'transport'];
  $j = json_decode($raw, true);
  return is_array($j) ? $j : ['_err' => 'bad_json'];
}

if ($action === 'geocode') {
  $q = trim((string)($b['q'] ?? ''));
  if ($q === '') ql_out(['ok' => false, 'error' => 'Empty address']);
  if ($key === '') ql_out(['ok' => false, 'fallback' => true, 'error' => 'no_google_key']);
  $u = 'https://maps.googleapis.com/maps/api/geocode/json?region=in&address=' . rawurlencode($q) . '&key=' . rawurlencode($key);
  $r = $u ? ql_freight_get($u) : null;
  if (!$r || ($r['status'] ?? '') !== 'OK' || empty($r['results'])) {
    ql_out(['ok' => false, 'fallback' => true, 'error' => 'google_geocode:' . ($r['status'] ?? ($r['_err'] ?? 'fail'))]);
  }
  $g = $r['results'][0];
  $loc = $g['geometry']['location'] ?? [];
  $comp = function ($type) use ($g) {
    foreach ($g['address_components'] ?? [] as $c) if (in_array($type, $c['types'] ?? [], true)) return $c['long_name'];
    return '';
  };
  ql_out([
    'ok' => true, 'source' => 'google',
    'lat' => $loc['lat'] ?? null, 'lng' => $loc['lng'] ?? null,
    'formatted' => $g['formatted_address'] ?? '',
    'city' => $comp('locality') ?: $comp('administrative_area_level_2'),
    'state' => $comp('administrative_area_level_1'),
    'pin' => $comp('postal_code'),
    'country' => $comp('country')
  ]);
}

if ($action === 'distance') {
  $oLat = $b['oLat'] ?? null; $oLng = $b['oLng'] ?? null;
  $dLat = $b['dLat'] ?? null; $dLng = $b['dLng'] ?? null;
  if (!is_numeric($oLat) || !is_numeric($oLng) || !is_numeric($dLat) || !is_numeric($dLng)) {
    ql_out(['ok' => false, 'error' => 'Need origin + destination coordinates']);
  }
  if ($key === '') ql_out(['ok' => false, 'fallback' => true, 'error' => 'no_google_key']);
  $u = 'https://maps.googleapis.com/maps/api/distancematrix/json?units=metric'
     . '&origins=' . rawurlencode($oLat . ',' . $oLng)
     . '&destinations=' . rawurlencode($dLat . ',' . $dLng)
     . '&key=' . rawurlencode($key);
  $r = ql_freight_get($u);
  $el = $r['rows'][0]['elements'][0] ?? null;
  if (!$r || ($r['status'] ?? '') !== 'OK' || !$el || ($el['status'] ?? '') !== 'OK') {
    ql_out(['ok' => false, 'fallback' => true, 'error' => 'google_distance:' . ($r['status'] ?? ($el['status'] ?? ($r['_err'] ?? 'fail')))]);
  }
  ql_out([
    'ok' => true, 'source' => 'google',
    'km' => round(($el['distance']['value'] ?? 0) / 1000),
    'minutes' => round(($el['duration']['value'] ?? 0) / 60)
  ]);
}

ql_out(['ok' => false, 'error' => 'Unknown action']);
