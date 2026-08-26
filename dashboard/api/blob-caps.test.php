<?php
/* blob-caps.test.php — every stored module must have a permission.
   Run:  php dashboard/api/blob-caps.test.php     (no database needed)

   WHY THIS EXISTS
   ql_blob_caps() maps each key in the per-company data blob to the capability
   needed to read/write it. data.php uses it to strip modules a role may not
   see. It is a WHITELIST — and a key that is missing from it is readable by
   EVERY role. That is a whitelist which fails OPEN, the worst direction.

   Two keys had already slipped through and were live (found 2026-07-15):
     • bankAccounts — the firm's account numbers and IFSC codes
     • wa           — customers' phone numbers and the content of messages
   Both were readable by a production or dispatch employee.

   Same failure as blob() itself forgetting the WhatsApp store the same day: a
   list somebody has to remember to extend. This test compares the PHP map
   against data.js's real blob() so nobody has to remember — add a store, and
   this fails until you decide who may see it. */

$root = __DIR__;
$php  = file_get_contents($root . '/db.php');
$js   = file_get_contents($root . '/../v2/data.js');

$pass = 0; $fail = 0; $fails = [];
function ok($n, $c) { global $pass, $fail, $fails; if ($c) $pass++; else { $fail++; $fails[] = $n; } }

/* ── the REAL capability map out of db.php ── */
$i = strpos($php, 'function ql_blob_caps');
ok('ql_blob_caps() found in db.php', $i !== false);
$capsSrc = substr($php, $i, strpos($php, "\n}", $i) - $i);
preg_match_all("/'(\w+)'\s*=>\s*'(\w+)'/", $capsSrc, $m, PREG_SET_ORDER);
$caps = [];
foreach ($m as $x) $caps[$x[1]] = $x[2];
ok('the map is not empty', count($caps) > 5);

/* ── the REAL blob() out of data.js ── */
$j = strpos($js, 'function blob(includePic)');
ok('blob() found in data.js', $j !== false);
$blobSrc = substr($js, $j, strpos($js, "\n  }", $j) - $j);
preg_match_all('/(\w+):\s*S\.[A-Z_]+/', $blobSrc, $bm);
$stored = array_values(array_unique($bm[1]));
ok('blob() stores a realistic number of modules', count($stored) >= 10);

/* ── THE RULE ── */
foreach ($stored as $key) {
  ok("blob key '$key' has a capability — without one EVERY role can read it",
     isset($caps[$key]));
}

/* ── the two that were live and unprotected ── */
ok("bankAccounts is finance-only (account numbers + IFSC)", ($caps['bankAccounts'] ?? '') === 'finance');
ok("wa is sales-only (customer numbers + message content)", ($caps['wa'] ?? '') === 'sales');

/* ── a capability must be spelled the way some role grants it ──────────
   A TYPO here fails CLOSED (only the wildcard roles can read the key), which is
   safe but silently wrong: the module would quietly vanish for every employee
   and nobody would know why. Owner/admin/partner hold '*', so "is it grantable"
   is always trivially true — the useful check is that the string matches a
   capability a real employee role actually names.

   OWNER_ONLY records a deliberate choice rather than an oversight: `labour`
   (workers / work log / attendance) is wages data, and NO employee role grants
   it today — only owner/admin/partner via '*'. That is intentional. If you ever
   want a supervisor to take attendance, add a role that grants 'labour'; this
   list is where that decision is written down. */
$k = strpos($php, 'function ql_role_caps');
$rolesSrc = substr($php, $k, strpos($php, "\n}", $k) - $k);
preg_match_all("/'(\w+)'/", $rolesSrc, $rm);
$granted = array_values(array_unique($rm[1]));
$OWNER_ONLY = ['labour'];                 // deliberate: wages are owner-only
foreach ($caps as $key => $cap) {
  ok("capability '$cap' (for '$key') is either granted by an employee role, or deliberately owner-only",
     in_array($cap, $granted, true) || in_array($cap, $OWNER_ONLY, true));
}
foreach ($OWNER_ONLY as $cap) {
  ok("'$cap' is still owner-only — if a role now grants it, that was a DECISION and this list must say so",
     !in_array($cap, array_merge(
        ...array_map(function ($r) use ($rolesSrc) {
            preg_match("/'$r'\s*=>\s*\[([^\]]*)\]/", $rolesSrc, $mm);
            preg_match_all("/'(\w+)'/", $mm[1] ?? '', $c);
            return $c[1];
          }, ['accountant', 'sales', 'purchase', 'production', 'dispatch'])
     ), true));
}

/* ── THE FULL EXPECTED MAP — this file is the spec, not a smoke test ──────
   Checking only that a key HAS some capability is not enough: a mutation that
   moved wages ('workers' => 'labour') onto the SALES capability passed, because
   'sales' is a capability and the key still had one. For a permission map the
   invariant is not "has a permission" — it is "has the RIGHT permission".

   So every key is pinned. Changing any line here is a deliberate decision about
   who may see a customer's money, an employee's wages or the firm's bank
   details — and it must be made HERE, in the open, not by editing db.php and
   hoping someone notices. */
$EXPECTED = [
  'sales'        => 'sales',      // customer invoices
  'chunna'       => 'sales',
  'purchases'    => 'purchase',   // supplier bills + what we pay
  'parties'      => 'parties',    // customer + supplier contact book
  'finance'      => 'finance',
  'cashbook'     => 'finance',    // every rupee in and out
  'expenses'     => 'finance',    // classified manufacturing expenses: salaries, interest — finance eyes only
  'loans'        => 'finance',    // the firm's borrowings
  'bankAccounts' => 'finance',    // account numbers + IFSC
  'refunds'      => 'finance',
  'reconcile'    => 'recon',      // bank statement lines
  'tds'          => 'gst',
  'challans'     => 'gst',
  'workers'      => 'labour',     // WAGES — owner-only, never 'sales'
  'workLog'      => 'labour',     // WAGES
  'att'          => 'labour',     // WAGES
  'prod'         => 'production',
  'audit'        => 'reports',
  'wa'           => 'sales',      // customers' numbers + what was said to them
  // Statement upload history: which bank account, which file, which period, and
  // who uploaded it. It names the firm's bank accounts and the periods its money
  // moved in, so it is money detail — 'finance', the same as bankAccounts and
  // never 'recon': a recon-only role may work the matching screen without being
  // handed the list of the firm's accounts and their statement history.
  'statements'   => 'finance',
];
foreach ($EXPECTED as $key => $want) {
  ok("'$key' is gated on '$want' exactly" . ($want === 'labour' ? ' (wages — never sales/production)' : ''),
     ($caps[$key] ?? '(missing)') === $want);
}
/* and nothing may be added to db.php without being declared here */
foreach ($caps as $key => $cap) {
  ok("'$key' is declared in this test's expected map (a new module needs a decision, not a default)",
     array_key_exists($key, $EXPECTED));
}

echo "\n════ blob permission coverage ════\n  Passed: $pass   Failed: $fail\n";
foreach ($fails as $f) echo "    ✗ $f\n";
echo $fail === 0 ? "\n✅ ALL $pass BLOB-CAPS TESTS PASSED\n\n"
                 : "\n❌ $fail FAILED — a stored module has no permission and is readable by every role\n\n";
exit($fail === 0 ? 0 : 1);
