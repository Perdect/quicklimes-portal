/* export.test.js — the CSV export contract.

   REAL BUG this locks down: money here is COMPUTED (qty × rate ± GST), so raw
   JS floats carry binary noise — 18.15 * 12385 === 224787.74999999997, not
   224787.75. Writing String(value) into a file leaks that noise and a
   spreadsheet renders every digit ("244282.500000000000"). The UI never shows
   it because every screen formats through fC(). Exports must format too.

   Rules under test:
     1. numbers → rounded to 2 dp (paise), emitted UNQUOTED so Excel/Numbers
        treat them as numbers
     2. text (invoice/bill no, GSTIN, refs) → quoted, preserved byte-for-byte,
        never coerced to a number (leading zeros + long UTRs survive)
     3. exported value === the value the UI shows
   Run: node export.test.js */

let pass = 0, fail = 0; const fails = [];
const eq = (n, a, b) => { if (a === b) pass++; else { fail++; fails.push(n + '\n      got  ' + JSON.stringify(a) + '\n      want ' + JSON.stringify(b)); } };
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };

/* Load the REAL csvCell/csvRow out of shell.js — never a copy, so this test
   cannot silently drift from what actually ships. */
const fs = require('fs'), src = fs.readFileSync(__dirname + '/shell.js', 'utf8');
const grab = (start, end) => { const i = src.indexOf(start); if (i < 0) throw new Error('not found in shell.js: ' + start); const j = src.indexOf(end, i); return src.slice(i, j + end.length); };
const csvCell = eval('(' + grab('function csvCell(c) {', "return '\"' + String(c).replace(/\"/g, '\"\"') + '\"';\n  }") + ')');
const csvRow = cells => cells.map(csvCell).join(',');
ok('csvCell was loaded from shell.js (not a copy)', typeof csvCell === 'function');

/* ── 1. the exact values from the bug report ── */
eq('244282.5 exports clean', csvCell(244282.5), '244282.5');
eq('250012.875 → paise (2dp)', csvCell(250012.875), '250012.88');
eq('236976.81 exports clean', csvCell(236976.81), '236976.81');
ok('no 12-zero tail anywhere', ![244282.5, 250012.875, 236976.81].some(v => /\.\d{3,}/.test(csvCell(v))));

/* ── 2. REAL float noise from this app's own math ── */
const taxable = (q, r) => q * r;
eq('18.15 × 12385 = 224787.74999999997 → 224787.75', csvCell(taxable(18.15, 12385)), '224787.75');
eq('16.78 × 12385 = 207820.30000000002 → 207820.3', csvCell(taxable(16.78, 12385)), '207820.3');
eq('32.76 × 12380 → 405568.8', csvCell(taxable(32.76, 12380)), '405568.8');
eq('with 18% GST → 478571.18', csvCell(taxable(32.76, 12380) * 1.18), '478571.18');
eq('dashboard total 3170529.6000000006 → 3170529.6', csvCell(3170529.6000000006), '3170529.6');
ok('noisy value never leaks digits', !/0000|9999/.test(csvCell(taxable(18.15, 12385))));

/* ── 3. exported number === what the UI displays (fC rounds to whole rupees,
       the CSV keeps paise — both must agree to the rupee) ── */
const fC = v => '₹' + Math.round(v || 0).toLocaleString('en-IN');
[taxable(18.15, 12385), taxable(16.78, 12385), 244282.5, 250012.875].forEach(v => {
  const ui = Math.round(v);                       // what fC() shows
  const exported = Math.round(parseFloat(csvCell(v)));
  eq('UI vs export agree for ' + v, exported, ui);
});
eq('fC sanity', fC(taxable(18.15, 12385)), '₹2,24,788');

/* ── 4. numbers unquoted (Excel reads them as numbers, not text) ── */
ok('number is unquoted', csvCell(1234.5) === '1234.5');
ok('zero exports as 0, not blank', csvCell(0) === '0');
ok('negative (credit balance) survives', csvCell(-4500.5) === '-4500.5');
eq('rounds half up at paise', csvCell(10.005), '10.01');
eq('whole number stays whole', csvCell(35303), '35303');
eq('tiny fraction collapses', csvCell(0.004), '0');

/* ── 5. TEXT is preserved byte-for-byte and stays text ── */
eq('bill number with letters', csvCell('20263121B021636'), '"20263121B021636"');
eq('invoice with slash', csvCell('147/2025-26'), '"147/2025-26"');
eq('GSTIN untouched', csvCell('08ALAPD1927C1ZR'), '"08ALAPD1927C1ZR"');
eq('leading zeros survive (never becomes 7)', csvCell('007'), '"007"');
eq('long UTR stays exact — no 0000000 / scientific notation', csvCell('529012345678901234'), '"529012345678901234"');
eq('numeric-looking string is NOT rounded', csvCell('244282.500'), '"244282.500"');
eq('quotes escaped', csvCell('M/s "ARIF" Lime'), '"M/s ""ARIF"" Lime"');
eq('comma in party name does not split the row', csvCell('Gotan, Nagaur'), '"Gotan, Nagaur"');

/* ── 6. blanks / bad values never print junk ── */
eq('null → empty', csvCell(null), '""');
eq('undefined → empty', csvCell(undefined), '""');
eq('NaN → empty, never "NaN"', csvCell(NaN), '""');
eq('Infinity → empty', csvCell(Infinity), '""');
eq('empty string stays empty', csvCell(''), '""');

/* ── 7. a full ledger row, end to end (the reported file) ── */
const row = csvRow(['2025-12-09', 'Sales Invoice', '147/2025-26', taxable(18.15, 12385), '', 224787.74999999997]);
eq('ledger row exports clean',
  row, '"2025-12-09","Sales Invoice","147/2025-26",224787.75,"",224787.75');
ok('row has no float noise', !/\d\.\d{3,}/.test(row));
eq('column count preserved', row.split(',').length, 6);

console.log('\n════ CSV export contract ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' EXPORT TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
