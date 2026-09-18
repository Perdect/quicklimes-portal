/* units-core.test.js — the quantity / rate-unit arithmetic the whole app trusts.
   Run:  node dashboard/v2/units-core.test.js

   WHY THIS EXISTS. 7,650 Kg @ ₹5,300 / Ton was billed ₹4,05,45,000 — the raw
   quantity multiplied by a rate in a different unit. The five cases below are
   the owner's acceptance cases, verbatim; the rest pin the rules that keep a
   legacy row (no rate unit) at exactly its booked figure, refuse to price
   across families, and derive the same rate back from a booked amount. */
const path = require('path');
const U = require(path.join(__dirname, 'units-core.js'));
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), Math.abs(a - b) < 1e-6);
const amt = (qty, unit, rate, rateUnit) => U.lineAmount({ qty, unit, rate, rateUnit });

console.log('\n═══ the owner\'s five acceptance cases ═══');
eq('7650 Kg × ₹5300/Ton = ₹40,545', amt(7650, 'Kg', 5300, 'Ton').amount, 40545);
eq('1000 Kg × ₹5300/Ton = ₹5,300', amt(1000, 'Kg', 5300, 'Ton').amount, 5300);
eq('500 Kg × ₹5300/Ton = ₹2,650', amt(500, 'Kg', 5300, 'Ton').amount, 2650);
eq('7.65 Ton × ₹5300/Ton = ₹40,545', amt(7.65, 'Ton', 5300, 'Ton').amount, 40545);
eq('10 Ton × ₹5300/Ton = ₹53,000', amt(10, 'Ton', 5300, 'Ton').amount, 53000);

console.log('═══ billable quantity + GST after the correct taxable ═══');
const L = amt(7650, 'Kg', 5300, 'Ton');
ok('billable quantity is 7.65 Ton, entered quantity stays 7,650 Kg', L.billableQty === 7.65 && L.billableUnit === 'Ton' && L.qty === 7650 && L.unit === 'Kg' && L.ok);
const T = U.taxOn(L.amount, 5, false);
eq('GST @ 5% on ₹40,545 = ₹2,027.25', T.gst, 2027.25);
eq('CGST 1,013.63 (half, rounded to paise)', T.cgst, 1013.63);
eq('Grand total ₹42,572.25', T.total, 42572.25);
eq('inter-state: IGST carries the whole 5%', U.taxOn(40545, 5, true).igst, 2027.25);

console.log('═══ decimal conversions ═══');
for (const [kg, t] of [[1, 0.001], [100, 0.1], [500, 0.5], [1000, 1], [7650, 7.65], [12345.678, 12.345678]]) eq(kg + ' Kg = ' + t + ' Ton', U.convertQty(kg, 'Kg', 'Ton'), t);
eq('7.65 Ton = 7650 Kg (both ways)', U.convertQty(7.65, 'Ton', 'Kg'), 7650);
eq('1 Quintal = 0.1 Ton', U.convertQty(1, 'Quintal', 'Ton'), 0.1);
eq('25 Quintal = 2500 Kg', U.convertQty(25, 'Quintal', 'Kg'), 2500);

console.log('═══ aliases: what people type and OCR reads ═══');
ok('Tonne / MT / T / tonnes / METRIC TON → Ton', ['Tonne', 'MT', 't', 'tonnes', 'METRIC TON', 'm.t.'].every(u => U.normalizeUnit(u) === 'Ton'));
ok('KG / kgs / Kilogram → Kg', ['KG', 'kgs', 'Kilogram'].every(u => U.normalizeUnit(u) === 'Kg'));
ok('Bags / bora → Bag; pcs / Nos. → Nos; Ltr → Litre', U.normalizeUnit('Bags') === 'Bag' && U.normalizeUnit('bora') === 'Bag' && U.normalizeUnit('pcs') === 'Nos' && U.normalizeUnit('Nos.') === 'Nos' && U.normalizeUnit('Ltr') === 'Litre');
ok('unknown / blank → ""', U.normalizeUnit('') === '' && U.normalizeUnit('gallon') === '');
eq('7650 Kg @ per "Tonne" (alias) still 40,545', amt(7650, 'KG', 5300, 'Tonne').amount, 40545);
eq('7650 Kg @ per "MT" still 40,545', amt(7650, 'kg', 5300, 'MT').amount, 40545);

console.log('═══ legacy rows: no rate unit means per the quantity\'s own unit ═══');
eq('16.16 Tonne @ 4950, no rateUnit → 79,992 exactly as booked', amt(16.16, 'Tonne', 4950).amount, 79992);
eq('400 Bag @ 250, no rateUnit → 1,00,000', amt(400, 'Bag', 250).amount, 100000);
eq('unit blank, no rateUnit → plain product (nothing to convert)', amt(30, '', 5000).amount, 150000);
ok('legacy row reports ok:true', amt(16.16, 'Tonne', 4950).ok === true);

console.log('═══ never multiply raw numbers across families ═══');
const bad = amt(400, 'Bag', 5300, 'Ton');
ok('400 Bag @ ₹/Ton is refused: ok:false with a reason naming both units', bad.ok === false && /Ton/.test(bad.why) && /Bag/.test(bad.why));
ok('the refused line still carries a finite amount (no NaN downstream)', isFinite(bad.amount));
ok('Litre @ ₹/Kg refused', amt(10, 'Litre', 50, 'Kg').ok === false);
ok('Nos @ ₹/Bag refused (count units do not convert)', amt(10, 'Nos', 50, 'Bag').ok === false);
ok('convertQty returns null across families', U.convertQty(1, 'Bag', 'Ton') === null && U.convertQty(1, 'Ton', 'Litre') === null);

console.log('═══ derived rates for imports and OCR ═══');
eq('₹40,545 booked for 7650 Kg → ₹5,300 per Ton', U.impliedRate(40545, 7650, 'Kg', 'Ton'), 5300);
eq('₹79,992 booked for 16.16 Tonne → ₹4,950 per Ton', U.impliedRate(79992, 16.16, 'Tonne', 'Ton'), 4950);
ok('zero quantity → null, never Infinity', U.impliedRate(1000, 0, 'Kg', 'Ton') === null);

console.log('═══ reporting tonnage ═══');
eq('7650 Kg is 7.65 T for the reports', U.toTonnes(7650, 'Kg'), 7.65);
eq('16.16 Tonne is 16.16 T', U.toTonnes(16.16, 'Tonne'), 16.16);
ok('400 Bag is NOT a tonnage (null) — a report must not add it to tonnes', U.toTonnes(400, 'Bag') === null);
ok('default rate unit: mass → Ton, Bag → Bag, Nos → Nos', U.defaultRateUnit('Kg') === 'Ton' && U.defaultRateUnit('Tonne') === 'Ton' && U.defaultRateUnit('Bag') === 'Bag' && U.defaultRateUnit('Nos') === 'Nos');

console.log('═══ formatting for the paper ═══');
ok('"7,650 Kg" and "₹5,300.00 / Ton"', U.fmtQty(7650, 'Kg') === '7,650 Kg' && U.fmtRate(5300, 'Ton') === '₹5,300.00 / Ton');
ok('"7.65 Ton"', U.fmtQty(7.65, 'Ton') === '7.65 Ton');

console.log('\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' UNIT TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
