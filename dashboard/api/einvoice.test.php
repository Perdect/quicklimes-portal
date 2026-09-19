<?php
/* einvoice.test.php — the pure e-invoice library, and the transport crypto
   exercised END TO END against a stub IRP that speaks the portal's own
   scheme with a locally generated key pair. Run: php dashboard/api/einvoice.test.php
   No network, no DB. The live portal is NOT exercised here (that needs the
   owner's IRP credentials — see the report). */
$src = file_get_contents(__DIR__ . '/db.php');
foreach (['ql_unit_norm', 'ql_unit_family', 'ql_convert_qty', 'ql_line_amount'] as $fn) {
  if (!preg_match('/function ' . $fn . '\(.*?\n\}/s', $src, $m)) { fwrite(STDERR, "✗ $fn not found in db.php\n"); exit(1); }
  eval($m[0]);
}
require __DIR__ . '/gstin-lib.php';
require __DIR__ . '/einvoice-lib.php';
$pass = 0; $fail = 0; $fails = [];
function ok($n, $c) { global $pass, $fail, $fails; if ($c) $pass++; else { $fail++; $fails[] = $n; } }

$seller = ['name' => 'DESHWALI MINERALS', 'short' => 'Deshwali', 'gstin' => '08NLIPS9801K1Z5', 'address' => 'Near Dharam Kanta Gotan Road, Borunda 342604, Rajasthan', 'city' => 'Borunda', 'state' => 'Rajasthan (08)', 'pin' => '342604', 'phone' => '9460767676', 'email' => 'deshwaliminerals@gmail.com', 'roundOff' => false];
$sale = ['inv' => '9/2026-27', 'date' => '2026-09-19', 'party' => 'RASHMI GREEN HYDROGEN STEEL PRIVATE LIMITED', 'gstin' => '19AALCR1619N1ZT', 'addr' => 'Khatranga, Changual, Gopinathpur, Kharagpur, Paschim Medinipur, West Bengal 721301', 'state' => 'West Bengal (19)',
  'product' => 'Burnt (Calcined) Lime Powder 0-3 mm', 'hsn' => '25221000', 'qty' => 40.96, 'unit' => 'Ton', 'rate' => 5250, 'rateUnit' => 'Ton', 'gstR' => 5, 'veh' => 'RJ01GE5906', 'status' => 'pending'];

echo "\n═══ the portal JSON, built from the sale the app prints ═══\n";
$r = ql_einv_build($sale, $seller, ['phone' => '7872532502', 'email' => 'accounts@rashmi.in']);
$p = $r['payload'];
ok('builds cleanly for a complete inter-state B2B sale', $r['ok'] && !$r['errors']);
ok('Version 1.1 · TaxSch GST · SupTyp B2B · RegRev N', $p['Version'] === '1.1' && $p['TranDtls'] === ['TaxSch' => 'GST', 'SupTyp' => 'B2B', 'RegRev' => 'N', 'IgstOnIntra' => 'N']);
ok('DocDtls: INV · the invoice number as printed · dd/mm/yyyy', $p['DocDtls'] === ['Typ' => 'INV', 'No' => '9/2026-27', 'Dt' => '19/09/2026']);
ok('SellerDtls off the profile: GSTIN, legal + trade name, address, Loc Borunda, Pin 342604, Stcd 08, phone, e-mail', $p['SellerDtls']['Gstin'] === '08NLIPS9801K1Z5' && $p['SellerDtls']['LglNm'] === 'DESHWALI MINERALS' && $p['SellerDtls']['TrdNm'] === 'Deshwali' && $p['SellerDtls']['Loc'] === 'Borunda' && $p['SellerDtls']['Pin'] === 342604 && $p['SellerDtls']['Stcd'] === '08' && $p['SellerDtls']['Ph'] === '9460767676' && $p['SellerDtls']['Em'] === 'deshwaliminerals@gmail.com');
ok('BuyerDtls off the sale + party: GSTIN, name, Pos 19 (the GSTIN, not the typed state), Loc "Paschim Medinipur", Pin 721301 read off the address, Stcd 19, phone/e-mail from the master', $p['BuyerDtls']['Gstin'] === '19AALCR1619N1ZT' && $p['BuyerDtls']['Pos'] === '19' && $p['BuyerDtls']['Stcd'] === '19' && $p['BuyerDtls']['Pin'] === 721301 && $p['BuyerDtls']['Loc'] === 'Paschim Medinipur' && $p['BuyerDtls']['Ph'] === '7872532502' && $p['BuyerDtls']['Em'] === 'accounts@rashmi.in');
$l = $p['ItemList'][0];
ok('the line through ql_line_amount: 40.96 TON × 5,250 = 2,15,040.00 assessable, IGST 10,752.00, no CGST/SGST, total item 2,25,792.00, HSN 25221000, UQC TON', $l['Qty'] == 40.96 && $l['Unit'] === 'TON' && $l['UnitPrice'] == 5250 && $l['AssAmt'] == 215040 && $l['IgstAmt'] == 10752 && $l['CgstAmt'] == 0 && $l['SgstAmt'] == 0 && $l['TotItemVal'] == 225792 && $l['HsnCd'] === '25221000' && $l['GstRt'] == 5 && $l['IsServc'] === 'N');
ok('ValDtls reconcile: AssVal 2,15,040 · IgstVal 10,752 · RndOffAmt 0 (Deshwali keeps paise) · TotInvVal 2,25,792', $p['ValDtls']['AssVal'] == 215040 && $p['ValDtls']['IgstVal'] == 10752 && $p['ValDtls']['CgstVal'] == 0 && $p['ValDtls']['RndOffAmt'] == 0 && $p['ValDtls']['TotInvVal'] == 225792 && $r['fy'] === '2026-27');
ok('no EwbDtls unless the sale asks for the e-way bill with the IRN (ewbWithIrn)', !isset($p['EwbDtls']) && isset(ql_einv_build($sale + ['ewbWithIrn' => true, 'transport' => 'By Road', 'distanceKm' => 1900], $seller)['payload']['EwbDtls']['VehNo']));

echo "═══ intra-state, Kg priced per Ton, rounding, charges, export ═══\n";
$intra = ql_einv_build(array_merge($sale, ['gstin' => '08BPLPS6684F1Z6', 'addr' => 'Jodhpur, Rajasthan 342001', 'state' => 'Rajasthan (08)', 'qty' => 7650, 'unit' => 'Kg', 'rate' => 5300, 'rateUnit' => 'Ton']), array_merge($seller, ['roundOff' => true]));
$li = $intra['payload']['ItemList'][0]; $vi = $intra['payload']['ValDtls'];
ok('7,650 Kg @ 5,300/Ton → AssAmt 40,545.00, UQC KGS, CGST 1,013.63 + SGST 1,013.63, no IGST', $intra['ok'] && $li['AssAmt'] == 40545 && $li['Unit'] === 'KGS' && $li['CgstAmt'] == 1013.63 && $li['SgstAmt'] == 1013.63 && $li['IgstAmt'] == 0 && !$intra['inter']);
ok('a firm that rounds to the rupee: total 42,572.26 → RndOffAmt −0.26, TotInvVal 42,572', $vi['TotInvVal'] == 42572 && abs($vi['RndOffAmt'] - (-0.26)) < 0.005);
$multi = ql_einv_build(array_merge($sale, ['items' => [['product' => 'Lime lumps', 'hsn' => '25221000', 'qty' => 20, 'unit' => 'Ton', 'rate' => 5000, 'rateUnit' => 'Ton']], 'charges' => [['label' => 'Transportation charges upto Kharagpur', 'amount' => 30000, 'hsn' => '9965']]]), $seller);
ok('a freight charge is its own service line (IsServc Y, SAC 9965, Qty 1, OTH) and the totals include it', $multi['ok'] && count($multi['payload']['ItemList']) === 2 && $multi['payload']['ItemList'][1]['IsServc'] === 'Y' && $multi['payload']['ItemList'][1]['HsnCd'] === '9965' && $multi['payload']['ValDtls']['AssVal'] == 130000 && $multi['payload']['ValDtls']['IgstVal'] == 6500 && $multi['payload']['ValDtls']['TotInvVal'] == 136500);
$exp = ql_einv_build(array_merge($sale, ['type' => 'export', 'gstin' => '', 'addr' => 'Birendra Nagar, Surkhet, Nepal', 'state' => '', 'export' => ['countryCode' => 'NP']]), $seller);
ok('an export under LUT: SupTyp EXPWOP, buyer URP / Pos 96 / Pin 999999, zero tax, ExpDtls WOPAY + country', $exp['ok'] && $exp['payload']['TranDtls']['SupTyp'] === 'EXPWOP' && $exp['payload']['BuyerDtls']['Gstin'] === 'URP' && $exp['payload']['BuyerDtls']['Pos'] === '96' && $exp['payload']['BuyerDtls']['Pin'] === 999999 && $exp['payload']['ValDtls']['IgstVal'] == 0 && $exp['payload']['ExpDtls']['ExpCat'] === 'WOPAY' && $exp['payload']['ExpDtls']['CntCode'] === 'NP');

echo "═══ validation — nothing incomplete or inconsistent leaves ═══\n";
$bad = ql_einv_build(array_merge($sale, ['gstin' => '19AALCR1619N1ZX', 'addr' => 'Kharagpur', 'inv' => 'INV/2026-27/000000123', 'hsn' => '252', 'qty' => 0, 'unit' => 'Truck']), array_merge($seller, ['pin' => '', 'address' => 'Borunda']));
$e = implode(' | ', $bad['errors']);
ok('a bad buyer GSTIN, a 21-char invoice number, a 3-digit HSN, zero quantity, an unknown unit, a missing buyer PIN and a missing supplier PIN are each named', !$bad['ok'] && preg_match('~Buyer GSTIN is not valid~', $e) && preg_match('~1–16 characters~', $e) && preg_match('~HSN must be 4–8 digits~', $e) && preg_match('~quantity must be more than zero~', $e) && preg_match('~unit .Truck. has no GST unit code~', $e) && preg_match('~Buyer PIN code is missing~', $e) && preg_match('~Supplier PIN code is missing~', $e));
ok('a rate that is not a slab is refused; a supplier GSTIN with a wrong check digit is refused', preg_match('~not a GST slab~', implode(' ', ql_einv_build(array_merge($sale, ['gstR' => 7]), $seller)['errors'])) && preg_match('~Supplier GSTIN is not valid~', implode(' ', ql_einv_build($sale, array_merge($seller, ['gstin' => '08NLIPS9801K1Z6']))['errors'])));
ok('helpers: fy 2026-03-31 → 2025-26, 2026-04-01 → 2026-27; dd/mm/yyyy from ISO and dd-mm-yyyy; PIN off an address; state code off a GSTIN before the typed state; UQC map', ql_einv_fy('2026-03-31') === '2025-26' && ql_einv_fy('2026-04-01') === '2026-27' && ql_einv_ddmmyyyy('2026-09-19') === '19/09/2026' && ql_einv_ddmmyyyy('19-09-2026') === '19/09/2026' && ql_einv_pin('Kharagpur, West Bengal 721301') === '721301' && ql_einv_state_code('Rajasthan (08)', '27CMVPC2808M1ZK') === '27' && ql_einv_state_code('Odisha (21)', '') === '21' && ql_einv_uqc('ton') === 'TON' && ql_einv_uqc('Bag') === 'BAG' && ql_einv_uqc('Truck') === '');

echo "═══ the portal's transport encryption, end to end against a stub IRP ═══\n";
/* a local key pair stands in for the portal's */
$kp = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
$pub = openssl_pkey_get_details($kp)['key'];
$appKey = ql_einv_random_key();
$encPass = ql_einv_rsa_encrypt($pub, 'Sandbox@123'); $encKey = ql_einv_rsa_encrypt($pub, $appKey);
$decPass = ''; openssl_private_decrypt(base64_decode($encPass), $decPass, $kp, OPENSSL_PKCS1_PADDING);
$decKey = ''; openssl_private_decrypt(base64_decode($encKey), $decKey, $kp, OPENSSL_PKCS1_PADDING);
ok('auth request: password and the 32-byte AppKey are RSA/PKCS#1-encrypted with the portal key and base64 — the portal (stub) recovers both exactly', $decPass === 'Sandbox@123' && $decKey === $appKey && strlen($appKey) === 32);
/* the stub portal answers the way NIC does: Data = AES(AppKey, JSON{AuthToken, Sek = AES(AppKey, sek)}) */
$sek = ql_einv_random_key();
$authData = ql_einv_aes_encrypt($appKey, json_encode(['ClientId' => 'AAAC', 'UserName' => 'API_DESHWALI', 'AuthToken' => 'tok-123', 'Sek' => ql_einv_aes_encrypt($appKey, $sek), 'TokenExpiry' => '2026-09-19 18:00:00']));
$s = ql_einv_open_auth($appKey, $authData);
ok('auth response: the token and the session key are recovered through the AppKey', $s && $s['token'] === 'tok-123' && $s['sek'] === $sek && $s['expiry'] === '2026-09-19 18:00:00');
ok('a reply encrypted with a different key is rejected, not mis-read', ql_einv_open_auth(ql_einv_random_key(), $authData) === null);
/* generate: our request → the stub decrypts it and reads the JSON we built */
$wrapped = ql_einv_wrap($sek, $p);
$stubSees = json_decode(base64_decode(ql_einv_aes_decrypt($sek, $wrapped['Data'])), true);
ok('IRN request: {Data} = base64(AES-256-ECB(Sek, base64(JSON))) — the stub reads back the exact payload', is_array($stubSees) && $stubSees === json_decode(json_encode($p, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), true));
$irn = hash('sha256', '08NLIPS9801K1Z5|2026-27|INV|9/2026-27');
$signedQr = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.' . rtrim(strtr(base64_encode(json_encode(['data' => json_encode(['SellerGstin' => '08NLIPS9801K1Z5', 'BuyerGstin' => '19AALCR1619N1ZT', 'DocNo' => '9/2026-27', 'DocTyp' => 'INV', 'DocDt' => '19/09/2026', 'TotInvVal' => 225792, 'ItemCnt' => 1, 'MainHsnCode' => '25221000', 'Irn' => $irn, 'IrnDt' => '2026-09-19 10:12:33']), 'iss' => 'NIC'])), '+/', '-_'), '=') . '.c2ln';
$portalReply = ['AckNo' => 172621081606743, 'AckDt' => '2026-09-19 10:12:33', 'Irn' => $irn, 'SignedInvoice' => 'eyJ.hbG.ci', 'SignedQRCode' => $signedQr, 'Status' => 'ACT', 'EwbNo' => null, 'EwbDt' => null, 'EwbValidTill' => null, 'Remarks' => null];
$respData = ql_einv_aes_encrypt($sek, base64_encode(json_encode($portalReply)));
$got = ql_einv_unwrap($sek, $respData);
ok('IRN response: Data decrypts + base64-decodes to the portal reply — IRN, Ack No, Ack Dt, SignedQRCode intact and UNMODIFIED', $got && $got['Irn'] === $irn && (string)$got['AckNo'] === '172621081606743' && $got['SignedQRCode'] === $signedQr && $got['Status'] === 'ACT');
ok('a plain-JSON Data body (some proxies skip the inner base64) is accepted too', ql_einv_unwrap($sek, ql_einv_aes_encrypt($sek, json_encode($portalReply)))['Irn'] === $irn);
$dec = ql_einv_jws_payload($signedQr);
ok('the SignedQRCode payload decodes (unverified) to the portal facts: seller/buyer GSTIN, doc no/date, value, IRN — what a scanner shows', $dec && $dec['Irn'] === $irn && $dec['DocNo'] === '9/2026-27' && $dec['SellerGstin'] === '08NLIPS9801K1Z5' && $dec['TotInvVal'] == 225792);
ok('portal errors read as one line; a duplicate-IRN refusal exposes the existing registration', ql_einv_error_text(['Status' => 0, 'ErrorDetails' => [['ErrorCode' => '2150', 'ErrorMessage' => 'Duplicate IRN']]]) === '2150 Duplicate IRN' && ql_einv_dup_irn(['InfoDtls' => [['InfCd' => 'DUPIRN', 'Desc' => ['AckNo' => '1', 'AckDt' => '2026-09-19 10:00:00', 'Irn' => $irn]]]])['Irn'] === $irn && ql_einv_dup_irn(['InfoDtls' => 'x']) === null);

echo "═══ the endpoint's rules, pinned in its source ═══\n";
$ep = file_get_contents(__DIR__ . '/einvoice.php');
ok('credentials live in plant_secrets — never in app_data (which data.php hands to every role) and never echoed (masked, has_* flags)', preg_match('~CREATE TABLE IF NOT EXISTS plant_secrets~', $ep) && !preg_match('~ql_save_plant_integration~', $ep) && preg_match('~str_repeat\(\'•\'~', $ep) && preg_match("~'has_secret' =>~", $ep));
ok('one row per (firm, doc type, doc no, FY) — UNIQUE KEY — taken FOR UPDATE in a transaction; a concurrent click sees generating and gets 409; a refresh after success gets the record back', preg_match('~UNIQUE KEY uq_doc \(plant_id, company_id, doc_type, doc_no, fy\)~', $ep) && preg_match('~FOR UPDATE~', $ep) && preg_match('~beginTransaction~', $ep) && preg_match('~being registered right now~', $ep) && preg_match("~'already' => true~", $ep));
ok('a retry first asks the portal by document details (lost response ≠ second registration); a 2150 duplicate is resolved to the existing IRN; a timeout marks needs_verify and never a QR', preg_match('~irnbydocdetails~', $ep) && preg_match('~\$r\[\'dup\'\]~', $ep) && preg_match('~needs_verify = \?~', $ep) && preg_match('~may still have registered the invoice~', $ep));
ok('generate / verify / cancel are owner-admin-partner only; get / json are for any signed-in user of the firm', preg_match('~Only the owner can register or cancel e-invoices~', $ep) && preg_match("~if \(\\\$action === 'get'\) ql_out~", $ep));
ok('the response is stored as received (signed QR, signed invoice, raw JSON) and the public view never carries credentials', preg_match('~signed_qr = \?, signed_invoice = \?, response_json = \?~', $ep) && preg_match('~function ql_einv_public~', $ep) && !preg_match('~client_secret\' => \$r~', $ep));
ok('no IRN, QR or signature is ever manufactured here: no hash(), no local signing, the QR is rendered by the browser from the stored SignedQRCode', !preg_match('~hash\(|openssl_sign|sha256~', $ep) && !preg_match('~qrserver~', $ep));

echo "\n  Passed: $pass   Failed: $fail\n"; foreach ($fails as $f) echo "    ✗ $f\n";
echo $fail ? "\n❌ $fail FAILED\n" : "\n✅ ALL $pass E-INVOICE TESTS PASSED\n";
exit($fail ? 1 : 0);
