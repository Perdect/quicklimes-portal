<?php
/* gstin-lib.test.php — the server's GSTIN checks agree with the app's.
   Run:  php dashboard/api/gstin-lib.test.php     (no database needed)

   WHY THIS EXISTS
   The check digit is computed on both sides — v2/party-identity.js at the field
   and gstin-lib.php at the door. Two implementations of one algorithm drift.
   These vectors are the firm's own GSTINs (which must pass) and single-character
   corruptions of them (which must fail); gstin-check.test.js pins the same
   vectors on the JS side. */
require __DIR__ . '/gstin-lib.php';
$pass = 0; $fail = 0; $fails = [];
function ok($n, $c) { global $pass, $fail, $fails; if ($c) $pass++; else { $fail++; $fails[] = $n; } }

foreach (['08NLIPS9801K1Z5' => 'Deshwali Minerals', '08BNAPM0488E1Z3' => 'Gotan Lime Industries', '08BPLPS6684F1Z6' => 'Lekhraj Chemical Industries (invoice 36)'] as $g => $who) {
  $r = ql_gstin_check($g);
  ok("$who — $g passes the check digit", $r['ok'] === true && $r['reason'] === '');
  ok("$who — state code 08 → Rajasthan (08)", ql_gstin_state($r['stateCode']) === 'Rajasthan (08)');
}
ok('a typo in the last character fails as checksum', ql_gstin_check('08NLIPS9801K1Z4')['reason'] === 'checksum');
ok('a typo in the middle fails as checksum',         ql_gstin_check('08NLIPS9891K1Z5')['reason'] === 'checksum');
ok('14 characters fails as length',                  ql_gstin_check('08NLIPS9801K1Z')['reason'] === 'length');
ok('the wrong shape fails as format',                ql_gstin_check('0ANLIPS9801K1Z5')['reason'] === 'format');
ok('state code 00 fails as format',                  ql_gstin_check('00NLIPS9801K1Z5')['reason'] === 'format');
ok('lowercase and spaces are normalised first',      ql_gstin_check(' 08nlips9801k1z5 ')['ok'] === true);
ok('PAN is characters 3–12',                         ql_gstin_check('08NLIPS9801K1Z5')['pan'] === 'NLIPS9801K');
ok('an unknown state code has no name',              ql_gstin_state('99') === '');

/* the GSTN taxpayerDetails shape, bare and wrapped */
$sample = ['lgnm' => 'LEKHRAJ CHEMICAL INDUSTRIES', 'tradeNam' => 'Lekhraj Chemical Industries', 'sts' => 'Active', 'ctb' => 'Proprietorship', 'rgdt' => '01/07/2017',
           'pradr' => ['addr' => ['bno' => 'KHASRA NO 80/4/1', 'st' => 'BORUNDA', 'loc' => 'TEH PIPAR CITY', 'dst' => 'Jodhpur', 'stcd' => 'Rajasthan', 'pncde' => '342604']]];
$n = ql_gstin_normalise($sample);
ok('legal name',   $n['name'] === 'LEKHRAJ CHEMICAL INDUSTRIES');
ok('trade name',   $n['trade'] === 'Lekhraj Chemical Industries');
ok('address assembled in postal order, state and PIN last', $n['address'] === 'KHASRA NO 80/4/1, BORUNDA, TEH PIPAR CITY, Jodhpur, Rajasthan - 342604');
ok('status',       $n['status'] === 'Active');
ok('wrapped under data',         ql_gstin_normalise(['data' => $sample])['name'] === 'LEKHRAJ CHEMICAL INDUSTRIES');
ok('wrapped under taxpayerInfo', ql_gstin_normalise(['taxpayerInfo' => $sample])['trade'] === 'Lekhraj Chemical Industries');
ok('an error body is not a taxpayer', ql_gstin_normalise(['error' => 'Invalid GSTIN']) === null);
ok('empty address parts are skipped, not joined as ", ,"', ql_gstin_normalise(['lgnm' => 'X', 'pradr' => ['addr' => ['bno' => '', 'st' => 'MAIN ROAD', 'loc' => '']]])['address'] === 'MAIN ROAD');

/* the door never echoes the key: the only place the headers exist is the curl call */
$door = file_get_contents(__DIR__ . '/gstin.php');
ok('gstin.php requires a signed-in user before doing anything', strpos($door, "ql_token_ctx()") !== false && strpos($door, "'Unauthorized'") !== false);
ok('gstin.php never puts the headers or URL into the response', !preg_match('/\$out\[[^\]]*\]\s*=\s*\$(hdr|url)\b/', $door) && strpos($door, "'headers'") === false);

echo "\n════ GSTIN validation ↔ app agreement ════\n  Passed: $pass   Failed: $fail\n";
foreach ($fails as $f) echo "    ✗ $f\n";
echo $fail === 0 ? "\n✅ ALL $pass GSTIN TESTS PASSED\n\n" : "\n❌ $fail FAILED\n\n";
exit($fail === 0 ? 0 : 1);
