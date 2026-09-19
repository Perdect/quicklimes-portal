<?php
/* einvoice-lib.php — PURE helpers for GST e-invoicing (no DB, no network, no
   output), so every rule here is unit-tested in einvoice.test.php.

   THE IRP IS THE SOURCE OF TRUTH. This file builds the invoice JSON in the
   NIC e-invoice schema (v1.1), validates it the way the portal will, and
   handles the portal's transport encryption. It NEVER makes an IRN, a QR or
   a signature: those come back from the Invoice Registration Portal and are
   stored exactly as received (see einvoice.php).

   Encryption, as NIC's API specifies (v1.03/1.04):
     auth:     Password and a random 32-byte AppKey, each RSA/PKCS#1 v1.5
               encrypted with the IRP's public key, base64.
     auth rsp: Data = base64( AES-256-ECB/PKCS7( AppKey, JSON ) ); inside it
               Sek = base64( AES-256-ECB( AppKey, 32-byte session key ) ).
     request:  Data = base64( AES-256-ECB( Sek, base64( JSON ) ) ).
     response: Data = base64( AES-256-ECB( Sek, base64( JSON ) ) ) — decrypt,
               then base64-decode; a plain-JSON body is accepted too.
   These are exercised end to end in the tests against a stub IRP that uses
   the same primitives with a locally generated key pair. */

/* NIC unit quantity codes for the units this business uses */
const QL_EINV_UQC = ['Ton' => 'TON', 'Kg' => 'KGS', 'Quintal' => 'QTL', 'Bag' => 'BAG', 'Nos' => 'NOS', 'Litre' => 'LTR', 'Other' => 'OTH'];
const QL_EINV_DOCNO = '~^[A-Za-z0-9/-]{1,16}$~';

function ql_einv_r2($n) { return round((float)$n + 0.0, 2); }
function ql_einv_ddmmyyyy($iso) {
  $s = trim((string)$iso);
  if (preg_match('~^(\d{4})-(\d{2})-(\d{2})~', $s, $m)) return $m[3] . '/' . $m[2] . '/' . $m[1];
  if (preg_match('~^(\d{2})[-/](\d{2})[-/](\d{4})$~', $s, $m)) return $m[1] . '/' . $m[2] . '/' . $m[3];
  return '';
}
/* Financial year of an invoice date, the portal's uniqueness scope: 2026-09-19 → 2026-27 */
function ql_einv_fy($iso) {
  if (!preg_match('~^(\d{4})-(\d{2})~', (string)$iso, $m)) return '';
  $y = (int)$m[1]; if ((int)$m[2] < 4) $y--;
  return $y . '-' . substr((string)($y + 1), 2);
}
function ql_einv_pin($text) { return preg_match('~\b(\d{6})\b~', (string)$text, $m) ? $m[1] : ''; }
function ql_einv_state_code($stateText, $gstin = '') {
  $g = strtoupper(preg_replace('~[^A-Z0-9]~i', '', (string)$gstin));
  if (strlen($g) === 15) return substr($g, 0, 2);
  return preg_match('~\((\d\d)\)~', (string)$stateText, $m) ? $m[1] : '';
}
/* A UPPER / lower / mixed unit key to the portal's UQC; '' when unknown */
function ql_einv_uqc($unit) {
  $u = function_exists('ql_unit_norm') ? ql_unit_norm($unit) : (string)$unit;
  if ($u === '' && (string)$unit !== '') $u = ucfirst(strtolower(trim((string)$unit)));
  return QL_EINV_UQC[$u] ?? '';
}

/* ── Build the NIC payload from a sale row + the seller profile ──────────
   $sale is the row as the browser stores it (inv, date, party, gstin, addr,
   state, product, hsn, qty, unit, rate, rateUnit, gstR, items[], charges[],
   veh, transport, station, eway, type, roundOff…); $seller is the company
   profile (name, gstin, address, pin, state, phone, email, city, roundOff);
   $party is the buyer's master record when one exists (phone, email, pin,
   city). Returns ['ok'=>bool, 'payload'=>array, 'errors'=>[...]]. Money runs
   through ql_line_amount — the same arithmetic the app prints. */
function ql_einv_build($sale, $seller, $party = null) {
  $errors = [];
  $party = is_array($party) ? $party : [];
  $sg = strtoupper(preg_replace('~[^A-Z0-9]~i', '', (string)($seller['gstin'] ?? '')));
  $bg = strtoupper(preg_replace('~[^A-Z0-9]~i', '', (string)($sale['gstin'] ?? '')));
  $isExport = strtolower((string)($sale['type'] ?? '')) === 'export';
  $docNo = trim((string)($sale['inv'] ?? ''));
  $iso = (string)($sale['date'] ?? '');
  $sState = ql_einv_state_code($seller['state'] ?? '', $sg);
  $bState = $isExport ? '96' : ql_einv_state_code($sale['state'] ?? '', $bg);
  $sPin = preg_replace('~\D~', '', (string)($seller['pin'] ?? '')) ?: ql_einv_pin($seller['address'] ?? '');
  $bPin = $isExport ? '999999' : (preg_replace('~\D~', '', (string)($party['pin'] ?? '')) ?: ql_einv_pin($sale['addr'] ?? ''));
  $sLoc = trim((string)($seller['city'] ?? '')) ?: 'Borunda';
  $bLoc = trim((string)($party['city'] ?? ''));
  if ($bLoc === '') {   // the town: the last address part that is not the PIN and not the state's name
    $parts = array_values(array_filter(array_map(function ($x) { return trim(preg_replace('~\b\d{6}\b~', '', $x)); }, explode(',', (string)($sale['addr'] ?? '')))));
    $states = defined('QL_GST_STATES') ? array_map('strtolower', array_values(QL_GST_STATES)) : [];
    while ($parts && (in_array(strtolower(end($parts)), $states, true) || preg_match('~^(india)$~i', end($parts)))) array_pop($parts);
    $bLoc = $parts ? end($parts) : '';
  }
  $gstR = $isExport ? 0.0 : (float)(($sale['gstR'] ?? $sale['gst'] ?? null) === null ? 5 : ($sale['gstR'] ?? $sale['gst']));
  $inter = $isExport || ($sState !== '' && $bState !== '' && $sState !== $bState);
  /* lines */
  $lines = [];
  $items = (isset($sale['items']) && is_array($sale['items']) && $sale['items']) ? $sale['items'] : [[
    'product' => $sale['product'] ?? 'Quick Lime', 'hsn' => $sale['hsn'] ?? '', 'qty' => $sale['qty'] ?? 0, 'unit' => $sale['unit'] ?? 'Ton', 'rate' => $sale['rate'] ?? 0, 'rateUnit' => $sale['rateUnit'] ?? ($sale['unit'] ?? 'Ton')]];
  $n = 0; $assTotal = 0.0; $cgstT = 0.0; $sgstT = 0.0; $igstT = 0.0;
  foreach ($items as $it) {
    $n++;
    $unit = (string)($it['unit'] ?? ($sale['unit'] ?? 'Ton'));
    $la = function_exists('ql_line_amount') ? ql_line_amount($it['qty'] ?? 0, $unit, $it['rate'] ?? 0, $it['rateUnit'] ?? ($sale['rateUnit'] ?? $unit)) : ['amount' => round(((float)($it['qty'] ?? 0)) * ((float)($it['rate'] ?? 0)), 2), 'ok' => true, 'billableQty' => (float)($it['qty'] ?? 0)];
    $ass = isset($it['taxable']) && $it['taxable'] !== '' ? ql_einv_r2($it['taxable']) : ql_einv_r2($la['amount']);
    if (empty($la['ok'])) $errors[] = "Line $n: the quantity unit and the rate unit cannot be converted (" . $unit . ' vs ' . ($it['rateUnit'] ?? '') . ')';
    $qty = (float)($it['qty'] ?? 0);
    $uqc = ql_einv_uqc($unit);
    $hsn = preg_replace('~\D~', '', (string)($it['hsn'] ?? ($sale['hsn'] ?? '')));
    $cg = $inter ? 0.0 : ql_einv_r2($ass * $gstR / 200); $sgst = $inter ? 0.0 : ql_einv_r2($ass * $gstR / 200); $ig = $inter ? ql_einv_r2($ass * $gstR / 100) : 0.0;
    $unitPrice = $qty > 0 ? round($ass / $qty, 3) : 0.0;
    $lines[] = ['SlNo' => (string)$n, 'PrdDesc' => mb_substr(trim((string)($it['product'] ?? '')), 0, 300), 'IsServc' => 'N', 'HsnCd' => $hsn,
      'Qty' => round($qty, 3), 'Unit' => $uqc, 'UnitPrice' => $unitPrice, 'TotAmt' => $ass, 'Discount' => 0, 'AssAmt' => $ass,
      'GstRt' => ql_einv_r2($gstR), 'IgstAmt' => $ig, 'CgstAmt' => $cg, 'SgstAmt' => $sgst, 'CesRt' => 0, 'CesAmt' => 0, 'CesNonAdvlAmt' => 0, 'StateCesRt' => 0, 'StateCesAmt' => 0, 'StateCesNonAdvlAmt' => 0, 'OthChrg' => 0,
      'TotItemVal' => ql_einv_r2($ass + $ig + $cg + $sgst)];
    $assTotal += $ass; $cgstT += $cg; $sgstT += $sgst; $igstT += $ig;
    if ($qty <= 0) $errors[] = "Line $n: quantity must be more than zero";
    if ($ass <= 0) $errors[] = "Line $n: taxable value must be more than zero";
    if ($uqc === '') $errors[] = "Line $n: unit '" . $unit . "' has no GST unit code (use Ton, Kg, Quintal, Bag, Nos or Litre)";
    if (!preg_match('~^\d{4,8}$~', $hsn)) $errors[] = "Line $n: HSN must be 4–8 digits (got '" . $hsn . "')";
    if (!in_array((int)round($gstR), [0, 5, 12, 18, 28], true) && !$isExport) $errors[] = 'GST rate ' . $gstR . '% is not a GST slab';
  }
  /* charges (freight etc.) as their own lines with their own HSN/SAC */
  foreach ((isset($sale['charges']) && is_array($sale['charges'])) ? $sale['charges'] : [] as $c) {
    $amt = ql_einv_r2($c['amount'] ?? 0); if ($amt <= 0) continue; $n++;
    $hsn = preg_replace('~\D~', '', (string)($c['hsn'] ?? '9965'));
    $cg = $inter ? 0.0 : ql_einv_r2($amt * $gstR / 200); $sgst = $inter ? 0.0 : ql_einv_r2($amt * $gstR / 200); $ig = $inter ? ql_einv_r2($amt * $gstR / 100) : 0.0;
    $lines[] = ['SlNo' => (string)$n, 'PrdDesc' => mb_substr(trim((string)($c['label'] ?? 'Charges')), 0, 300), 'IsServc' => 'Y', 'HsnCd' => $hsn, 'Qty' => 1, 'Unit' => 'OTH', 'UnitPrice' => $amt, 'TotAmt' => $amt, 'Discount' => 0, 'AssAmt' => $amt,
      'GstRt' => ql_einv_r2($gstR), 'IgstAmt' => $ig, 'CgstAmt' => $cg, 'SgstAmt' => $sgst, 'CesRt' => 0, 'CesAmt' => 0, 'CesNonAdvlAmt' => 0, 'StateCesRt' => 0, 'StateCesAmt' => 0, 'StateCesNonAdvlAmt' => 0, 'OthChrg' => 0, 'TotItemVal' => ql_einv_r2($amt + $ig + $cg + $sgst)];
    $assTotal += $amt; $cgstT += $cg; $sgstT += $sgst; $igstT += $ig;
  }
  $assTotal = ql_einv_r2($assTotal); $cgstT = ql_einv_r2($cgstT); $sgstT = ql_einv_r2($sgstT); $igstT = ql_einv_r2($igstT);
  $total = ql_einv_r2($assTotal + $cgstT + $sgstT + $igstT);
  $roundsToRupee = !(isset($seller['roundOff']) && $seller['roundOff'] === false);
  $grand = $roundsToRupee ? round($total) : $total;
  $rnd = ql_einv_r2($grand - $total);
  /* identities */
  if (!preg_match(QL_EINV_DOCNO, $docNo)) $errors[] = "Invoice number '" . $docNo . "' — the portal allows 1–16 characters: letters, digits, / and -";
  if (ql_einv_ddmmyyyy($iso) === '') $errors[] = 'Invoice date is missing or not a date';
  $chk = function_exists('ql_gstin_check') ? 'ql_gstin_check' : null;
  if ($chk) { $v = $chk($sg); if (empty($v['ok'])) $errors[] = 'Supplier GSTIN is not valid (' . ($v['reason'] ?? '') . ')'; }
  elseif (strlen($sg) !== 15) $errors[] = 'Supplier GSTIN is not valid';
  if (!$isExport) {
    if ($chk) { $v = $chk($bg); if (empty($v['ok'])) $errors[] = 'Buyer GSTIN is not valid (' . ($v['reason'] ?? '') . ') — e-invoicing is for B2B invoices'; }
    elseif (strlen($bg) !== 15) $errors[] = 'Buyer GSTIN is not valid — e-invoicing is for B2B invoices';
  }
  if (trim((string)($seller['name'] ?? '')) === '') $errors[] = 'Supplier legal name is missing';
  if (trim((string)($sale['party'] ?? '')) === '') $errors[] = 'Buyer name is missing';
  if (!preg_match('~^\d{6}$~', $sPin)) $errors[] = 'Supplier PIN code is missing on the company profile';
  if (!preg_match('~^\d{6}$~', $bPin)) $errors[] = 'Buyer PIN code is missing — add the 6-digit PIN to the customer\'s address';
  if ($sState === '') $errors[] = 'Supplier state code is missing';
  if ($bState === '') $errors[] = 'Buyer state code is missing (the GSTIN or a State like "West Bengal (19)")';
  if ($bLoc === '') $errors[] = 'Buyer city / location is missing from the address';
  if (!$lines) $errors[] = 'No lines to invoice';
  $sAddr = trim((string)($seller['address'] ?? '')); if ($sAddr === '') $errors[] = 'Supplier address is missing';
  $bAddr = trim(str_replace("\n", ', ', (string)($sale['addr'] ?? ''))); if ($bAddr === '') $errors[] = 'Buyer address is missing';
  $payload = [
    'Version' => '1.1',
    'TranDtls' => ['TaxSch' => 'GST', 'SupTyp' => $isExport ? 'EXPWOP' : 'B2B', 'RegRev' => 'N', 'IgstOnIntra' => 'N'],
    'DocDtls' => ['Typ' => 'INV', 'No' => $docNo, 'Dt' => ql_einv_ddmmyyyy($iso)],
    'SellerDtls' => array_filter(['Gstin' => $sg, 'LglNm' => mb_substr(trim((string)($seller['name'] ?? '')), 0, 100), 'TrdNm' => mb_substr(trim((string)($seller['short'] ?? $seller['name'] ?? '')), 0, 100),
      'Addr1' => mb_substr($sAddr, 0, 100), 'Loc' => mb_substr($sLoc, 0, 50), 'Pin' => (int)$sPin, 'Stcd' => $sState,
      'Ph' => preg_replace('~\D~', '', (string)($seller['phone'] ?? '')) ?: null, 'Em' => trim((string)($seller['email'] ?? '')) ?: null], function ($v) { return $v !== null && $v !== ''; }),
    'BuyerDtls' => array_filter(['Gstin' => $isExport ? 'URP' : $bg, 'LglNm' => mb_substr(trim((string)($sale['party'] ?? '')), 0, 100), 'Pos' => $bState,
      'Addr1' => mb_substr($bAddr, 0, 100), 'Loc' => mb_substr($bLoc, 0, 50), 'Pin' => (int)$bPin, 'Stcd' => $bState,
      'Ph' => preg_replace('~\D~', '', (string)($party['phone'] ?? '')) ?: null, 'Em' => trim((string)($party['email'] ?? '')) ?: null], function ($v) { return $v !== null && $v !== ''; }),
    'ItemList' => $lines,
    'ValDtls' => ['AssVal' => $assTotal, 'CgstVal' => $cgstT, 'SgstVal' => $sgstT, 'IgstVal' => $igstT, 'CesVal' => 0, 'StCesVal' => 0, 'Discount' => 0, 'OthChrg' => 0, 'RndOffAmt' => $rnd, 'TotInvVal' => ql_einv_r2($grand)],
  ];
  if ($isExport) $payload['ExpDtls'] = array_filter(['ExpCat' => 'WOPAY' /* under LUT */, 'CntCode' => (string)(($sale['export']['countryCode'] ?? '') ?: ''), 'ShipBNo' => (string)($sale['export']['shippingBill'] ?? ''), 'Port' => (string)($sale['export']['portLoading'] ?? '')], function ($v) { return $v !== ''; });
  /* transport: only when the sale carries it — the portal generates the e-way bill with the IRN then */
  $veh = strtoupper(preg_replace('~[^A-Z0-9]~i', '', (string)($sale['veh'] ?? '')));
  if ($veh !== '' && !empty($sale['ewbWithIrn'])) {
    $payload['EwbDtls'] = array_filter(['TransId' => (string)($sale['transGstin'] ?? ''), 'TransName' => mb_substr((string)($sale['transport'] ?? ''), 0, 100), 'TransMode' => '1', 'Distance' => (int)($sale['distanceKm'] ?? 0),
      'TransDocNo' => (string)($sale['grrr'] ?? ''), 'TransDocDt' => ql_einv_ddmmyyyy($sale['grDate'] ?? ''), 'VehNo' => $veh, 'VehType' => 'R'], function ($v) { return $v !== '' && $v !== 0; });
    if (!preg_match('~^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$~', $veh)) $errors[] = "Vehicle number '" . $veh . "' is not in the RTO format";
  }
  /* the arithmetic must be self-consistent before it leaves */
  $sumItems = ql_einv_r2(array_sum(array_map(function ($l) { return $l['TotItemVal']; }, $lines)));
  if (abs($sumItems + $rnd - $grand) > 1.0) $errors[] = 'Totals do not reconcile: lines ' . $sumItems . ' + round-off ' . $rnd . ' ≠ ' . $grand;
  if (!$inter && ($igstT > 0)) $errors[] = 'Intra-state supply cannot carry IGST';
  if ($inter && ($cgstT > 0 || $sgstT > 0)) $errors[] = 'Inter-state supply cannot carry CGST/SGST';
  return ['ok' => !$errors, 'payload' => $payload, 'errors' => array_values(array_unique($errors)), 'fy' => ql_einv_fy($iso), 'inter' => $inter, 'totals' => ['taxable' => $assTotal, 'cgst' => $cgstT, 'sgst' => $sgstT, 'igst' => $igstT, 'total' => $total, 'grand' => ql_einv_r2($grand)]];
}

/* ── Transport crypto ──────────────────────────────────────────────── */
function ql_einv_rsa_encrypt($publicPem, $bytes) {
  $key = openssl_pkey_get_public($publicPem);
  if (!$key) return null;
  $out = '';
  if (!openssl_public_encrypt($bytes, $out, $key, OPENSSL_PKCS1_PADDING)) return null;
  return base64_encode($out);
}
function ql_einv_aes_encrypt($keyBytes, $plain) { $c = openssl_encrypt($plain, 'aes-256-ecb', $keyBytes, OPENSSL_RAW_DATA); return $c === false ? null : base64_encode($c); }
function ql_einv_aes_decrypt($keyBytes, $b64) { $raw = base64_decode((string)$b64, true); if ($raw === false) return null; $p = openssl_decrypt($raw, 'aes-256-ecb', $keyBytes, OPENSSL_RAW_DATA); return $p === false ? null : $p; }
function ql_einv_random_key() { return random_bytes(32); }
/* request body for an encrypted endpoint: {"Data": base64(AES(sek, base64(json)))} */
function ql_einv_wrap($sek, $payloadArray) { $json = json_encode($payloadArray, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); return ['Data' => ql_einv_aes_encrypt($sek, base64_encode($json))]; }
/* the Data field of a response → array (decrypt, then base64-decode when needed) */
function ql_einv_unwrap($sek, $dataB64) {
  $p = ql_einv_aes_decrypt($sek, $dataB64); if ($p === null) return null;
  $j = json_decode($p, true); if (is_array($j)) return $j;
  $b = base64_decode($p, true); if ($b === false) return null;
  $j = json_decode($b, true); return is_array($j) ? $j : null;
}
/* the auth response: Data encrypted with the AppKey → {AuthToken, Sek(b64, AES(AppKey)), TokenExpiry} */
function ql_einv_open_auth($appKey, $dataB64) {
  $j = ql_einv_unwrap($appKey, $dataB64); if (!$j || empty($j['AuthToken']) || empty($j['Sek'])) return null;
  $sek = ql_einv_aes_decrypt($appKey, $j['Sek']); if ($sek === null || strlen($sek) !== 32) return null;
  return ['token' => (string)$j['AuthToken'], 'sek' => $sek, 'expiry' => (string)($j['TokenExpiry'] ?? '')];
}
/* the middle segment of the SignedQRCode / SignedInvoice, for display —
   UNVERIFIED (the portal's certificate is what verifies it; scanners do that) */
function ql_einv_jws_payload($jws) {
  $p = explode('.', trim((string)$jws)); if (count($p) !== 3) return null;
  $b = base64_decode(strtr($p[1], '-_', '+/') . str_repeat('=', (4 - strlen($p[1]) % 4) % 4), true); if ($b === false) return null;
  $j = json_decode($b, true); if (!is_array($j)) return null;
  if (isset($j['data']) && is_string($j['data'])) { $d = json_decode($j['data'], true); if (is_array($d)) return $d; }
  return $j;
}
/* the portal's error list → one line a person can act on */
function ql_einv_error_text($resp) {
  $e = $resp['ErrorDetails'] ?? null;
  if (is_string($e)) { $x = json_decode($e, true); if (is_array($x)) $e = $x; }
  if (is_array($e)) { $out = []; foreach ($e as $row) { if (is_array($row)) $out[] = trim((string)($row['ErrorCode'] ?? '') . ' ' . (string)($row['ErrorMessage'] ?? '')); } if ($out) return implode('; ', $out); }
  if (!empty($resp['error'])) return (string)$resp['error'];
  return 'The portal rejected the request without a reason';
}
/* a duplicate-IRN refusal carries the existing IRN in InfoDtls — that IS the registration */
function ql_einv_dup_irn($resp) {
  $info = $resp['InfoDtls'] ?? null;
  if (is_string($info)) { $x = json_decode($info, true); if (is_array($x)) $info = $x; }
  if (!is_array($info)) return null;
  foreach ($info as $i) {
    if (!is_array($i)) continue;
    $d = $i['Desc'] ?? null; if (is_string($d)) { $x = json_decode($d, true); if (is_array($x)) $d = $x; }
    if (is_array($d) && !empty($d['Irn'])) return ['Irn' => (string)$d['Irn'], 'AckNo' => (string)($d['AckNo'] ?? ''), 'AckDt' => (string)($d['AckDt'] ?? '')];
  }
  return null;
}
