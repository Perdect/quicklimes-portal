<?php
/* gstin.php — what a GSTIN tells us, for the auto-fill in the invoice and
   customer forms. Always: is it well-formed, does the check digit hold, which
   State. When a GST lookup provider is configured: the legal / trade name and
   the registered address as well.

   THE PROVIDER IS OPTIONAL AND ITS KEY NEVER LEAVES THE SERVER. The official
   portal's search API rejects unauthenticated requests (verified 12-09-2026:
   "Request Rejected" from services.gst.gov.in), so name/address needs a GST
   API subscription. Set in api/config.php:
       'GSTIN_LOOKUP_URL'     => 'https://…/{gstin}',       // {gstin} is replaced
       'GSTIN_LOOKUP_HEADERS' => ['Authorization: Bearer …'], // optional
   and this door proxies the call. The response is normalised from the GSTN
   taxpayerDetails shape (see gstin-lib.php). Until a key exists the response
   says lookup:'unconfigured' and the app says so under the field — it never
   pretends a lookup happened.

   Requires a signed-in user: a proxy for a metered key is not a public URL. */
require __DIR__ . '/db.php';
require __DIR__ . '/gstin-lib.php';
ql_cors();
$ctx = ql_token_ctx();
if (!$ctx) ql_out(['ok' => false, 'error' => 'Unauthorized'], 401);

/* Guarded like the Places key: an optional feature must never take the app
   down when config.php is absent, and the secret is never echoed. */
function ql_gstin_cfg($k) { if (!is_file(__DIR__ . '/config.php')) return null; $c = ql_config(); return $c[$k] ?? null; }

$b = ql_body();
/* ── Provider settings from INSIDE the app (Settings → GST lookup). Stored per
   plant in app_data/ql_integrations beside the other integration keys; the key
   never leaves the server and is never echoed back (only its last 4 chars).
   config.php's GSTIN_LOOKUP_URL, when set by an operator, takes precedence. */
$action = (string)($b['action'] ?? '');
if ($action === 'config' || $action === 'status') {
  $role = (string)($ctx['role'] ?? 'owner');
  if (!in_array($role, ['owner', 'admin', 'partner'], true)) ql_out(['ok' => false, 'error' => 'Only the owner can see or set the GST lookup provider'], 403);
  if ($action === 'config') {
    $url = trim((string)($b['url'] ?? ''));
    $hdr = trim((string)($b['header'] ?? ''));
    if ($url !== '' && (strpos($url, '{gstin}') === false || !preg_match('~^https://~i', $url))) ql_out(['ok' => false, 'error' => 'The URL must start with https:// and contain {gstin} where the number goes'], 400);
    if ($hdr !== '' && strpos($hdr, ':') === false) ql_out(['ok' => false, 'error' => 'The header must look like  x-api-key: YOUR_KEY  or  Authorization: Bearer YOUR_KEY'], 400);
    if (!empty($b['clear'])) { ql_save_plant_integration($ctx['plant'], 'gstin_url', ''); ql_save_plant_integration($ctx['plant'], 'gstin_header', ''); }
    else {
      if ($url !== '') ql_save_plant_integration($ctx['plant'], 'gstin_url', $url);          // blank URL = keep what is saved
      if (array_key_exists('header', $b)) ql_save_plant_integration($ctx['plant'], 'gstin_header', $hdr);   // header only when SENT — a blank box keeps the saved key
    }
  }
  $cfgUrl = trim((string)(ql_gstin_cfg('GSTIN_LOOKUP_URL') ?? ''));
  $pi = ql_plant_integrations($ctx['plant']);
  $pUrl = trim((string)($pi['gstin_url'] ?? '')); $pHdr = trim((string)($pi['gstin_header'] ?? ''));
  $mask = function ($h) { if ($h === '') return ''; $p = strpos($h, ':'); $name = $p === false ? '' : substr($h, 0, $p); $val = trim($p === false ? $h : substr($h, $p + 1)); return $name . ': ' . (strlen($val) > 4 ? str_repeat('•', 8) . substr($val, -4) : '••••'); };
  /* The URL may carry the key as a query value — every query VALUE is masked to its last 4 chars; config.php's URL is never echoed at all. */
  $maskUrl = function ($u) { if ($u === '') return ''; $q = strpos($u, '?'); if ($q === false) return $u; $base = substr($u, 0, $q); $pairs = []; foreach (explode('&', substr($u, $q + 1)) as $kv) { $e = strpos($kv, '='); if ($e === false) { $pairs[] = $kv; continue; } $k = substr($kv, 0, $e); $v = substr($kv, $e + 1); $pairs[] = $k . '=' . ($v === '{gstin}' ? $v : (strlen($v) > 4 ? '••••' . substr($v, -4) : '••••')); } return $base . '?' . implode('&', $pairs); };
  ql_out(['ok' => true, 'source' => $cfgUrl !== '' ? 'config.php' : ($pUrl !== '' ? 'settings' : 'none'), 'url' => $cfgUrl !== '' ? '' : $maskUrl($pUrl), 'header' => $cfgUrl !== '' ? '' : $mask($pHdr), 'configured' => ($cfgUrl !== '' || $pUrl !== '')]);
}
$g = (string)($b['gstin'] ?? ($_GET['gstin'] ?? ''));
$v = ql_gstin_check($g);
$out = ['ok' => true, 'gstin' => $v['gstin'], 'valid' => $v['ok'], 'reason' => $v['reason'],
        'state' => $v['ok'] ? ql_gstin_state($v['stateCode']) : '', 'pan' => $v['pan'] ?? '', 'lookup' => 'unconfigured'];
if (!$v['ok']) ql_out($out);

$url = trim((string)(ql_gstin_cfg('GSTIN_LOOKUP_URL') ?? ''));
$hdr = ql_gstin_cfg('GSTIN_LOOKUP_HEADERS'); $hdr = is_array($hdr) ? array_values(array_map('strval', $hdr)) : [];
if ($url === '') {   // no operator config → the provider the owner connected in Settings
  $pi = ql_plant_integrations($ctx['plant']);
  $url = trim((string)($pi['gstin_url'] ?? '')); $ph = trim((string)($pi['gstin_header'] ?? '')); $hdr = $ph !== '' ? [$ph] : [];
}
if ($url === '' || strpos($url, '{gstin}') === false) ql_out($out);

$ch = curl_init(str_replace('{gstin}', rawurlencode($v['gstin']), $url));
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 5,
                        CURLOPT_HTTPHEADER => array_merge(['Accept: application/json'], $hdr)]);
$res = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
$j = ($res !== false && $res !== '') ? json_decode($res, true) : null;
$n = ql_gstin_normalise($j);
if ($n) { $out['lookup'] = 'ok'; $out = array_merge($out, $n); }
else    { $out['lookup'] = ($code === 404 || $code === 204) ? 'not_found' : 'error'; $out['http'] = $code; }
ql_out($out);
