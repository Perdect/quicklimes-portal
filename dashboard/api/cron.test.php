<?php
/* cron.test.php — the freshness rule that makes unattended sending safe.
   Run:  php dashboard/api/cron.test.php     (no database needed)

   WHY THIS EXISTS
   A queued reminder is a promise about the past. Between queueing it and the
   cron firing, the customer may have paid. Sending it then is worse than
   useless: it is wrong, it is rude, and it teaches them to ignore the next one.
   Skipping a real reminder costs a day. Chasing a man who already paid costs
   the relationship.

   ql_sale_outstanding() is what the cron re-checks before every send, and it
   must agree exactly with what the app itself calls "still owed". */

// db.php calls ql_config() at include time via other paths; we only want the
// pure helpers, so define the guard the file expects and swallow its exit.
$src = file_get_contents(__DIR__ . '/db.php');
// pull ONLY the pure function under test — never a copy of it, so this test
// cannot silently drift from what ships.
if (!preg_match('/function ql_sale_outstanding\(\$s\) \{.*?\n\}/s', $src, $m)) {
  fwrite(STDERR, "✗ ql_sale_outstanding not found in db.php\n"); exit(1);
}
eval($m[0]);

$pass = 0; $fail = 0; $fails = [];
function ok($n, $c) { global $pass, $fail, $fails; if ($c) $pass++; else { $fail++; $fails[] = $n; } }
function eq($n, $a, $b) { ok($n . ' — got ' . json_encode($a) . ', want ' . json_encode($b), abs($a - $b) < 0.001); }

/* a plain unpaid invoice: 20 T @ 12,000 + 5% GST = 252,000 */
$unpaid = ['inv' => 'A1', 'qty' => 20, 'rate' => 12000, 'gst' => 5, 'status' => 'pending'];
eq('an unpaid invoice owes the full total', ql_sale_outstanding($unpaid), 252000);

/* THE RULE THIS FILE EXISTS FOR */
eq('a PAID invoice owes nothing — never chase it',
  ql_sale_outstanding(array_merge($unpaid, ['status' => 'paid'])), 0);
eq('a CASH invoice owes nothing',
  ql_sale_outstanding(array_merge($unpaid, ['status' => 'cash'])), 0);
eq('a CANCELLED invoice owes nothing, whatever else it says',
  ql_sale_outstanding(array_merge($unpaid, ['status' => 'cancelled', 'paid' => 0])), 0);
eq('status is case-insensitive (Paid / PAID)',
  ql_sale_outstanding(array_merge($unpaid, ['status' => 'PAID'])), 0);

/* partial payment — the message would name the WRONG figure */
eq('a partly-paid invoice owes the balance',
  ql_sale_outstanding(array_merge($unpaid, ['paid' => 200000])), 52000);
eq('over-payment never goes negative',
  ql_sale_outstanding(array_merge($unpaid, ['paid' => 300000])), 0);
eq('paid exactly in full',
  ql_sale_outstanding(array_merge($unpaid, ['paid' => 252000])), 0);

/* explicit fields win over derived ones (the app stores both) */
eq('explicit total is used when present',
  ql_sale_outstanding(['total' => 100000, 'status' => 'pending']), 100000);
eq('explicit taxable + gst',
  ql_sale_outstanding(['taxable' => 100000, 'gst' => 18, 'status' => 'pending']), 118000);
eq('explicit total beats qty x rate',
  ql_sale_outstanding(['qty' => 1, 'rate' => 1, 'total' => 90000, 'status' => 'pending']), 90000);

/* junk must never become a reason to message someone */
eq('an empty row owes nothing', ql_sale_outstanding([]), 0);
eq('a non-array owes nothing', ql_sale_outstanding(null), 0);
eq('missing status defaults to pending (still owed)',
  ql_sale_outstanding(['total' => 5000]), 5000);
ok('the result is always a number, never null/NaN', is_float(ql_sale_outstanding([])));

/* float noise: 18.15 x 12385 = 224787.74999999997 in binary floating point.
   The cron compares |outstanding − queued| > 1.0, so sub-rupee noise must never
   flip a good job to 'stale' and silently drop a real reminder. */
$noisy = ['qty' => 18.15, 'rate' => 12385, 'gst' => 0, 'status' => 'pending'];
$out = ql_sale_outstanding($noisy);
ok('float noise stays under the 1-rupee staleness tolerance', abs($out - 224787.75) < 0.01);

echo "\n════ cron freshness rule ════\n  Passed: $pass   Failed: $fail\n";
foreach ($fails as $f) echo "    ✗ $f\n";
echo $fail === 0 ? "\n✅ ALL $pass CRON TESTS PASSED\n\n" : "\n❌ $fail FAILED\n\n";
exit($fail === 0 ? 0 : 1);
