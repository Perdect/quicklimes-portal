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
$g = (string)($b['gstin'] ?? ($_GET['gstin'] ?? ''));
$v = ql_gstin_check($g);
$out = ['ok' => true, 'gstin' => $v['gstin'], 'valid' => $v['ok'], 'reason' => $v['reason'],
        'state' => $v['ok'] ? ql_gstin_state($v['stateCode']) : '', 'pan' => $v['pan'] ?? '', 'lookup' => 'unconfigured'];
if (!$v['ok']) ql_out($out);

$url = trim((string)(ql_gstin_cfg('GSTIN_LOOKUP_URL') ?? ''));
if ($url === '' || strpos($url, '{gstin}') === false) ql_out($out);
$hdr = ql_gstin_cfg('GSTIN_LOOKUP_HEADERS'); $hdr = is_array($hdr) ? array_values(array_map('strval', $hdr)) : [];

$ch = curl_init(str_replace('{gstin}', rawurlencode($v['gstin']), $url));
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 5,
                        CURLOPT_HTTPHEADER => array_merge(['Accept: application/json'], $hdr)]);
$res = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
$j = ($res !== false && $res !== '') ? json_decode($res, true) : null;
$n = ql_gstin_normalise($j);
if ($n) { $out['lookup'] = 'ok'; $out = array_merge($out, $n); }
else    { $out['lookup'] = ($code === 404 || $code === 204) ? 'not_found' : 'error'; $out['http'] = $code; }
ql_out($out);
