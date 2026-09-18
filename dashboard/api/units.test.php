<?php
/* units.test.php — the PHP mirror of units-core.js prices a line exactly as
   the browser does. Run:  php dashboard/api/units.test.php
   The server's outstanding-amount (cron reminders) reads the same sale rows
   the browser wrote; if these two ever disagree a customer is chased for a
   figure the invoice never showed. */
$src = file_get_contents(__DIR__ . '/db.php');
foreach (['ql_unit_norm', 'ql_unit_family', 'ql_convert_qty', 'ql_line_amount', 'ql_sale_outstanding'] as $fn) {
  if (!preg_match('/function ' . $fn . '\(.*?\n\}/s', $src, $m)) { fwrite(STDERR, "✗ $fn not found in db.php\n"); exit(1); }
  eval($m[0]);
}
$pass = 0; $fail = 0; $fails = [];
function ok($n, $c) { global $pass, $fail, $fails; if ($c) $pass++; else { $fail++; $fails[] = $n; } }
function eq($n, $a, $b) { ok($n . ' — got ' . json_encode($a) . ', want ' . json_encode($b), $a !== null && abs($a - $b) < 0.0001); }
$amt = function ($q, $u, $r, $ru) { return ql_line_amount($q, $u, $r, $ru)['amount']; };

echo "\n═══ the owner's five acceptance cases (server mirror) ═══\n";
eq('7650 Kg × ₹5300/Ton = ₹40,545', $amt(7650, 'Kg', 5300, 'Ton'), 40545);
eq('1000 Kg × ₹5300/Ton = ₹5,300', $amt(1000, 'Kg', 5300, 'Ton'), 5300);
eq('500 Kg × ₹5300/Ton = ₹2,650', $amt(500, 'Kg', 5300, 'Ton'), 2650);
eq('7.65 Ton × ₹5300/Ton = ₹40,545', $amt(7.65, 'Ton', 5300, 'Ton'), 40545);
eq('10 Ton × ₹5300/Ton = ₹53,000', $amt(10, 'Ton', 5300, 'Ton'), 53000);

echo "═══ outstanding follows the corrected taxable, then GST ═══\n";
$row = ['inv' => '36', 'qty' => 7650, 'unit' => 'Kg', 'rate' => 5300, 'rateUnit' => 'Ton', 'gstR' => 5, 'status' => 'pending'];
eq('7,650 Kg @ 5,300/Ton + 5% → owes ₹42,572.25', ql_sale_outstanding($row), 42572.25);
eq('the same row without rateUnit is legacy: per Kg → ₹4,25,72,250 (what was booked before)', ql_sale_outstanding(array_diff_key($row, ['rateUnit' => 1])), 42572250);
eq('gstR is read (absent → 5%); export → 0', ql_sale_outstanding(array_merge($row, ['type' => 'export'])), 40545);
eq('legacy "gst" key still honoured as an alias', ql_sale_outstanding(['qty' => 20, 'rate' => 12000, 'gst' => 5, 'status' => 'pending']), 252000);
eq('multi-line sale: items[] + charges[] add up', ql_sale_outstanding(['items' => [['qty' => 20, 'unit' => 'Ton', 'rate' => 5000, 'rateUnit' => 'Ton', 'taxable' => 100000], ['qty' => 7650, 'unit' => 'Kg', 'rate' => 5300, 'rateUnit' => 'Ton']], 'charges' => [['label' => 'Freight', 'amount' => 1000]], 'gstR' => 5, 'status' => 'pending']), (100000 + 40545 + 1000) * 1.05);
eq('a PAID row owes nothing whatever its units', ql_sale_outstanding(array_merge($row, ['status' => 'paid'])), 0);

echo "═══ aliases, families, refusals ═══\n";
ok('Tonne / MT / T / to / TONNES → Ton', array_reduce(['Tonne', 'MT', 't', 'to', 'TONNES', 'm.t.'], fn($c, $u) => $c && ql_unit_norm($u) === 'Ton', true));
ok('KG / kgs → Kg; Bags → Bag; pcs → Nos; Ltr → Litre', ql_unit_norm('KG') === 'Kg' && ql_unit_norm('kgs') === 'Kg' && ql_unit_norm('Bags') === 'Bag' && ql_unit_norm('pcs') === 'Nos' && ql_unit_norm('Ltr') === 'Litre');
eq('1 Quintal = 0.1 Ton', ql_convert_qty(1, 'Quintal', 'Ton'), 0.1);
ok('400 Bag @ ₹/Ton is refused (ok:false) and never silently multiplied as if convertible', ql_line_amount(400, 'Bag', 5300, 'Ton')['ok'] === false);
ok('Bag → Ton conversion is null', ql_convert_qty(1, 'Bag', 'Ton') === null);

echo "\n  Passed: $pass   Failed: $fail\n";
foreach ($fails as $f) echo "    ✗ $f\n";
echo $fail === 0 ? "\n✅ ALL $pass PHP UNIT TESTS PASSED\n\n" : "\n❌ $fail FAILED\n\n";
exit($fail === 0 ? 0 : 1);
