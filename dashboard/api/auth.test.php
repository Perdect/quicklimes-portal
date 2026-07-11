<?php
/* Permission-matrix tests for the multi-user RBAC layer.
   Run: php auth.test.php   (needs a local config.php for APP_SECRET; no DB used).
   Covers token sign/verify (legacy + v2), tamper/expiry/plant-scope, the
   role→capability matrix, and blob read-filter + write-merge (data-loss guard). */

if (php_sapi_name() !== 'cli') { http_response_code(404); exit; }   // never runnable over the web

require __DIR__ . '/db.php';

$PASS = 0; $FAIL = 0; $FAILS = [];
function ok($cond, $msg) {
  global $PASS, $FAIL, $FAILS;
  if ($cond) { $PASS++; } else { $FAIL++; $FAILS[] = $msg; }
}
function eq($a, $b, $msg) { ok($a === $b, $msg . "  (got " . json_encode($a) . ", want " . json_encode($b) . ")"); }

/* ── 1. Token round-trip ─────────────────────────────────────────── */
$PLANT = 'plant-uuid-0001'; $OTHER = 'plant-uuid-9999';

$tOwner = ql_sign_token($PLANT);                               // legacy shape
$cOwner = ql_parse_token($tOwner);
ok($cOwner !== null, 'owner token parses');
eq($cOwner['plant'], $PLANT, 'owner token plant');
eq($cOwner['role'], 'owner', 'owner token role');
eq($cOwner['user'], '', 'owner token has no user');
// legacy shape has exactly 2 pipe-parts in the payload
$payloadOwner = ql_b64url_dec(explode('.', $tOwner)[0]);
eq(count(explode('|', $payloadOwner)), 2, 'owner token uses legacy payload shape (back-compat)');

$tAcc = ql_sign_token($PLANT, 2592000, 'user-uuid-7', 'accountant');   // v2 shape
$cAcc = ql_parse_token($tAcc);
ok($cAcc !== null, 'v2 token parses');
eq($cAcc['plant'], $PLANT, 'v2 token plant');
eq($cAcc['user'], 'user-uuid-7', 'v2 token user');
eq($cAcc['role'], 'accountant', 'v2 token role');

/* ── 2. Backward-compatible verify + scoping ─────────────────────── */
eq(ql_verify_token($tOwner, $PLANT), $PLANT, 'verify_token returns plant id (owner)');
eq(ql_verify_token($tAcc, $PLANT), $PLANT, 'verify_token returns plant id (employee)');
ok(ql_verify_token($tAcc, $OTHER) === false, 'verify_token rejects wrong plant');

/* ── 3. Security: tamper / expiry / garbage ──────────────────────── */
ok(ql_parse_token($tAcc . 'x') === null, 'tampered signature rejected');
$swapSig = explode('.', $tAcc)[0] . '.' . explode('.', $tOwner)[1];
ok(ql_parse_token($swapSig) === null, 'signature from another token rejected');
$expired = ql_sign_token($PLANT, -100, 'u1', 'sales');
ok(ql_parse_token($expired) === null, 'expired token rejected');
ok(ql_parse_token('garbage') === null, 'garbage token rejected');
ok(ql_parse_token('') === null, 'empty token rejected');

/* ── 4. ql_token_ctx reads the request token + scopes to plant ───── */
$_GET['token'] = $tAcc;
$ctx = ql_token_ctx($PLANT);
ok($ctx !== null && $ctx['role'] === 'accountant', 'token_ctx reads request token');
ok(ql_token_ctx($OTHER) === null, 'token_ctx rejects wrong plant');
unset($_GET['token']);

/* ── 5. Role → capability matrix ─────────────────────────────────── */
// full-access roles
foreach (['owner','admin','partner'] as $r) {
  foreach (['sales','purchase','finance','recon','gst','parties','extract','production','inventory','anything'] as $c) {
    ok(ql_role_can($r, $c), "$r can $c (full access)");
  }
}
// accountant
ok(ql_role_can('accountant','finance'), 'accountant CAN finance');
ok(ql_role_can('accountant','recon'), 'accountant CAN recon');
ok(!ql_role_can('accountant','production'), 'accountant CANNOT production');
// sales
ok(ql_role_can('sales','sales'), 'sales CAN sales');
ok(ql_role_can('sales','parties'), 'sales CAN parties');
ok(!ql_role_can('sales','finance'), 'sales CANNOT finance');
ok(!ql_role_can('sales','recon'), 'sales CANNOT recon');
ok(!ql_role_can('sales','purchase'), 'sales CANNOT purchase');
// purchase
ok(ql_role_can('purchase','purchase'), 'purchase CAN purchase');
ok(!ql_role_can('purchase','finance'), 'purchase CANNOT finance');
ok(!ql_role_can('purchase','sales'), 'purchase CANNOT sales');
// production / dispatch
ok(ql_role_can('production','production'), 'production CAN production');
ok(!ql_role_can('production','finance'), 'production CANNOT finance');
ok(!ql_role_can('production','sales'), 'production CANNOT sales');
ok(ql_role_can('dispatch','sales'), 'dispatch CAN sales');
ok(!ql_role_can('dispatch','finance'), 'dispatch CANNOT finance');
// unknown role → nothing
ok(!ql_role_can('ghost','sales'), 'unknown role has NO capabilities');
ok(!ql_role_can('', 'sales'), 'empty role has NO capabilities');

/* ── 6. Blob READ filter ─────────────────────────────────────────── */
$full = [
  'sales' => [1,2], 'purchases' => [3], 'parties' => ['p'],
  'finance' => ['f'], 'cashbook' => ['cb'], 'loans' => ['ln'],
  'reconcile' => ['rc'], 'tds' => ['t'], 'challans' => ['ch'],
  'workers' => ['w'], 'workLog' => ['wl'], 'att' => ['a'],
  'chunna' => ['cn'], 'profile_pic' => 'data:img',
];
$ownerView = ql_filter_blob_for_role($full, 'owner');
eq($ownerView, $full, 'owner sees the whole blob (unfiltered)');

$salesView = ql_filter_blob_for_role($full, 'sales');
ok(isset($salesView['sales']) && isset($salesView['parties']) && isset($salesView['chunna']), 'sales view keeps sales/parties/chunna');
ok(!isset($salesView['finance']) && !isset($salesView['loans']) && !isset($salesView['cashbook']), 'sales view hides finance/loans/cashbook');
ok(!isset($salesView['reconcile']), 'sales view hides reconcile');
ok(!isset($salesView['tds']) && !isset($salesView['challans']), 'sales view hides gst (tds/challans)');
ok(!isset($salesView['workers']) && !isset($salesView['att']), 'sales view hides labour');
ok(!isset($salesView['purchases']), 'sales view hides purchases');
ok($salesView['profile_pic'] === 'data:img', 'metadata (profile_pic) always visible');

$accView = ql_filter_blob_for_role($full, 'accountant');
ok(isset($accView['finance']) && isset($accView['reconcile']) && isset($accView['tds']), 'accountant sees finance/recon/gst');
ok(!isset($accView['workers']), 'accountant does NOT see labour');

/* ── 7. Blob WRITE merge (data-loss prevention) ──────────────────── */
// A sales employee's client only loaded sales/parties; they save. Their save
// must NOT wipe finance, loans, workers, purchases from the stored row, and
// must NOT be able to inject a finance change.
$incoming = ['sales' => [1,2,3], 'parties' => ['p2'], 'finance' => ['HACKED']];
$merged = ql_merge_blob_for_role($full, $incoming, 'sales');
eq($merged['sales'], [1,2,3], 'merge: sales role updates sales');
eq($merged['parties'], ['p2'], 'merge: sales role updates parties');
eq($merged['finance'], ['f'], 'merge: sales role CANNOT overwrite finance (kept existing)');
eq($merged['loans'], ['ln'], 'merge: loans retained');
eq($merged['workers'], ['w'], 'merge: workers retained');
eq($merged['purchases'], [3], 'merge: purchases retained');
eq($merged['profile_pic'], 'data:img', 'merge: metadata retained');

// Owner save = full replace (only the keys they send survive).
$ownerSave = ql_merge_blob_for_role($full, ['sales' => [9]], 'owner');
eq($ownerSave, ['sales' => [9]], 'merge: owner does a full replace');

// Accountant can update finance but not labour.
$accIncoming = ['finance' => ['newF'], 'workers' => ['injected']];
$accMerged = ql_merge_blob_for_role($full, $accIncoming, 'accountant');
eq($accMerged['finance'], ['newF'], 'merge: accountant updates finance');
eq($accMerged['workers'], ['w'], 'merge: accountant CANNOT overwrite labour');

/* ── Report ──────────────────────────────────────────────────────── */
echo "\n════════ RBAC / auth permission matrix ════════\n";
echo "  Passed : $PASS\n  Failed : $FAIL\n";
foreach ($FAILS as $f) echo "    ✗ $f\n";
echo ($FAIL === 0 ? "\n✅ ALL $PASS AUTH TESTS PASSED\n" : "\n❌ $FAIL FAILED\n");
exit($FAIL === 0 ? 0 : 1);
