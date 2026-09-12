<?php
/* gstin-lib.php — GSTIN validation and provider-response normalisation.
   PURE: no database, no config, no output — so gstin-lib.test.php can run it
   with `php` alone, and gstin.php stays a thin door. */

function ql_gstin_norm($g) { return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)$g)); }

/* The 15th character is a mod-36 check digit over the first 14 (weights
   1,2,1,2…; each product's base-36 digits summed). Mirrors gstinCheck() in
   v2/party-identity.js — both sides must agree, and the test pins the same
   vectors on each. */
function ql_gstin_check($g) {
  $x = ql_gstin_norm($g);
  if (strlen($x) !== 15) return ['ok' => false, 'reason' => 'length', 'gstin' => $x];
  $sc = (int)substr($x, 0, 2);
  if (!preg_match('/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/', $x) || $sc < 1 || ($sc > 38 && $sc !== 97)) return ['ok' => false, 'reason' => 'format', 'gstin' => $x];
  $B = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; $s = 0;
  for ($i = 0; $i < 14; $i++) { $v = strpos($B, $x[$i]); $p = $v * ($i % 2 ? 2 : 1); $s += intdiv($p, 36) + ($p % 36); }
  $ok = $B[(36 - ($s % 36)) % 36] === $x[14];
  return ['ok' => $ok, 'reason' => $ok ? '' : 'checksum', 'gstin' => $x, 'pan' => substr($x, 2, 10), 'stateCode' => substr($x, 0, 2)];
}

const QL_GST_STATES = ['01' => 'Jammu & Kashmir', '02' => 'Himachal Pradesh', '03' => 'Punjab', '04' => 'Chandigarh', '05' => 'Uttarakhand', '06' => 'Haryana', '07' => 'Delhi', '08' => 'Rajasthan', '09' => 'Uttar Pradesh', '10' => 'Bihar', '11' => 'Sikkim', '12' => 'Arunachal Pradesh', '13' => 'Nagaland', '14' => 'Manipur', '15' => 'Mizoram', '16' => 'Tripura', '17' => 'Meghalaya', '18' => 'Assam', '19' => 'West Bengal', '20' => 'Jharkhand', '21' => 'Odisha', '22' => 'Chhattisgarh', '23' => 'Madhya Pradesh', '24' => 'Gujarat', '25' => 'Daman & Diu', '26' => 'Dadra & Nagar Haveli and Daman & Diu', '27' => 'Maharashtra', '28' => 'Andhra Pradesh', '29' => 'Karnataka', '30' => 'Goa', '31' => 'Lakshadweep', '32' => 'Kerala', '33' => 'Tamil Nadu', '34' => 'Puducherry', '35' => 'Andaman & Nicobar', '36' => 'Telangana', '37' => 'Andhra Pradesh', '38' => 'Ladakh', '97' => 'Other Territory'];
function ql_gstin_state($code) { $c = (string)$code; return isset(QL_GST_STATES[$c]) ? QL_GST_STATES[$c] . ' (' . $c . ')' : ''; }

/* The GSTN "taxpayerDetails" shape — what the portal itself returns and what
   the Indian GSTIN APIs mirror, directly or wrapped under data / taxpayerInfo /
   result / response: lgnm legal name, tradeNam trade name, sts status, ctb
   constitution, rgdt registration date, pradr.addr{bno,flno,bnm,st,loc,dst,
   stcd,pncde} principal address. Returns null when the shape is not there —
   the caller reports "not found", never a half-filled name. */
function ql_gstin_normalise($j) {
  if (!is_array($j)) return null;
  foreach (['data', 'taxpayerInfo', 'result', 'response'] as $k) {
    if (isset($j[$k]) && is_array($j[$k]) && (isset($j[$k]['lgnm']) || isset($j[$k]['tradeNam']) || isset($j[$k]['pradr']))) { $j = $j[$k]; break; }
  }
  if (!isset($j['lgnm']) && !isset($j['tradeNam'])) return null;
  $a = isset($j['pradr']['addr']) && is_array($j['pradr']['addr']) ? $j['pradr']['addr'] : (is_array($j['pradr'] ?? null) ? $j['pradr'] : []);
  $parts = [];
  foreach (['bno', 'flno', 'bnm', 'st', 'loc', 'dst'] as $k) { $v = trim((string)($a[$k] ?? '')); if ($v !== '') $parts[] = $v; }
  $addr = implode(', ', $parts);
  $stcd = trim((string)($a['stcd'] ?? '')); $pin = trim((string)($a['pncde'] ?? ''));
  if ($stcd !== '') $addr .= ($addr !== '' ? ', ' : '') . $stcd;
  if ($pin !== '')  $addr .= ($addr !== '' ? ' - ' : '') . $pin;
  return ['name' => trim((string)($j['lgnm'] ?? '')), 'trade' => trim((string)($j['tradeNam'] ?? '')), 'address' => $addr,
          'status' => trim((string)($j['sts'] ?? '')), 'type' => trim((string)($j['ctb'] ?? '')), 'since' => trim((string)($j['rgdt'] ?? ''))];
}
