/* qty-backfill.test.js — reading the tonnage back off bills already uploaded.
 *
 * "show quantity get from uploeded bills"
 *
 * The Qty column dashes on old bills because the importer never mapped qty — the
 * OCR read it and the importer dropped it. Fixed for new imports. The 26 bills
 * already in the books still need it, and the bills THEMSELVES are still in
 * IndexedDB, so the tonnage is not gone: it was never read.
 *
 * WHY THIS FILE MATTERS MORE THAN MOST. It writes a number onto real bills, and
 * that number drives Inventory, cost-per-tonne and every margin below it. A WRONG
 * tonnage is far worse than the dash it replaces: a dash says "unknown" and stops
 * you; a wrong 32.49 says "known" and quietly poisons your costing. So the tests
 * that matter here are the ones proving it REFUSES.
 *
 *   node qty-backfill.test.js
 */
'use strict';
const B = require('./qty-backfill.js');
const OCR = require('./bill-ocr.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ qty backfill · reading the tonnage back ═══\n');

/* ══════════ 1. THE REAL BILL ══════════
   Text lifted from the Indian Oil petcoke invoice he sent. If the parser stops
   reading this, the feature is dead and this test says so. */
const REAL = 'GSTIN 24AAACI1681G1ZV\nGSTIN 08BNAPM0488E1Z3\nGOTAN LIME INDUSTRIES\n'
  + 'Item Material Code / Material Description Quantity Unit Rate Unit HSN code Total\n'
  + '10 178100 FUEL GRADE PET COKE (BULK) 32.490 TO 271311\n'
  + 'ZAVL Transaction Value 32.490 TO 12680.000 TO 411973.20\n'
  + 'Taxable Value 32.490 TO 12680.000 TO 411973.20\n'
  + 'JOIG IN: Integrated Tax 18.000 % 74155.18\nTotal 486128.00';
{
  const f = OCR.parse(REAL, 'purchase').fields;
  eq('the REAL Indian Oil bill still yields its tonnage', f.qty, 32.49);
  eq('  and its unit', f.unit, 'TO');
  eq('  and the rate printed on it', f.unitRate, 12680);
  eq('  and the taxable value', f.taxable, 411973.2);

  /* End to end: the bill as booked, against the bill as printed. */
  const row = { idx: 0, bill: '20273121B007217', sup: 'Indian Oil Corporation Limited', taxable: 411973.2, qty: 0 };
  const v = B.verdict(row, f);
  ok(v.ok, 'THE POINT: his real bill backfills — 32.49 T at ₹12,680');
  eq('  the tonnage', v.qty, 32.49);
  eq('  the unit', v.unit, 'TO');
  ok(/matches the booked value/.test(v.why), '  and it says WHY it is safe to apply');
}

/* ══════════ 2. IT MUST REFUSE — the tests that keep the books honest ══════════ */
{
  /* THE MOST IMPORTANT ONE. A human typed that quantity in. A parser does not get
     to overrule a person about their own bill. */
  const v = B.verdict({ idx: 1, taxable: 411973.2, qty: 40 }, { qty: 32.49, unitRate: 12680 });
  ok(!v.ok, 'a bill that ALREADY has a quantity is never touched');
  ok(v.skip, '  and it is a SKIP, not a failure — nothing is wrong with it');

  /* The arithmetic gate. This is what makes the whole feature safe: we do not trust
     the parser, we trust arithmetic it must satisfy against a number already in the
     books. A misread tonnage cannot pass. */
  const bad = B.verdict({ idx: 2, taxable: 411973.2, qty: 0 }, { qty: 3.249, unitRate: 12680 });
  ok(!bad.ok, 'a MISREAD tonnage (decimal point wrong) is refused, not applied');
  ok(/does not reconcile/.test(bad.why), '  and says exactly why, with both figures');

  const bad2 = B.verdict({ idx: 3, taxable: 411973.2, qty: 0 }, { qty: 324.90, unitRate: 12680 });
  ok(!bad2.ok, 'a tonnage 10x too big is refused');

  /* No quantity on the page at all. */
  /* The MESSAGE matters, not just the refusal. Both this and a misread end in "not
     applied", but he has to know WHICH: "no quantity on the bill" means type it in;
     "does not reconcile" means the parser misread a bill that HAS one. Asserting
     only .ok let a mutation through that collapsed the two into one confusing
     message — refusing correctly for the wrong stated reason. */
  const noQ = B.verdict({ idx: 4, taxable: 5000, qty: 0 }, { taxable: 5000 });
  ok(!noQ.ok, 'a bill with no quantity on it is left alone');
  ok(/no quantity found/.test(noQ.why), '  and says so plainly — NOT a confusing arithmetic failure');
  ok(!/does not reconcile/.test(noQ.why), '  a bill without a quantity did not "fail to reconcile" — it had nothing to reconcile');

  const zero = B.verdict({ idx: 4.5, taxable: 5000, qty: 0 }, { qty: 0, unitRate: 100 });
  ok(/no quantity found/.test(zero.why), 'a literal 0 on the bill reads as "no quantity", not as bad arithmetic');
  ok(!B.verdict({ idx: 5, taxable: 5000, qty: 0 }, null).ok, 'an unreadable file is reported, not guessed');
  ok(!B.verdict(null, { qty: 5, unitRate: 1000 }).ok, 'a missing row does not throw');

  /* A rate the parser never found means nothing to check the qty against. */
  ok(!B.verdict({ idx: 6, taxable: 411973.2, qty: 0 }, { qty: 32.49 }).ok,
    'a quantity with NO rate is refused — there is nothing to reconcile it against');

  /* Zero and negative are not tonnages. */
  ok(!B.verdict({ idx: 7, taxable: 5000, qty: 0 }, { qty: 0, unitRate: 100 }).ok, 'zero is not a tonnage');
  ok(!B.verdict({ idx: 8, taxable: 5000, qty: 0 }, { qty: -5, unitRate: 100 }).ok, 'a negative is not a tonnage');
}

/* ══════════ 3. THE ARITHMETIC GATE ══════════ */
{
  ok(B.arithmeticAgrees(32.49, 12680, 411973.2), 'exact arithmetic passes');
  ok(B.arithmeticAgrees(32.49, 12680, 411973), '  sub-rupee dust passes');
  /* Indian Oil's own bill carries a ZRND rounding line (486128.38 → 486128.00), so
     a real bill legitimately misses by a fraction of a percent. */
  ok(B.arithmeticAgrees(32.49, 12680, 411000), '  a bill that rounds its own lines passes (0.24% off)');
  ok(!B.arithmeticAgrees(32.49, 12680, 400000), 'a 3% gap does NOT pass — that is a misread, not rounding');
  ok(!B.arithmeticAgrees(32.49, 12680, 41197), 'a 10x gap does not pass');
  ok(!B.arithmeticAgrees(0, 12680, 411973), 'no qty, no pass');
  ok(!B.arithmeticAgrees(32.49, 0, 411973), 'no rate, no pass');
  ok(!B.arithmeticAgrees(32.49, 12680, 0), 'no booked value to check against, no pass');
}

/* ══════════ 4. WHICH BILLS ARE EVEN SCANNED ══════════ */
{
  const rows = [
    { idx: 0, qty: 0, attach: [{ id: 'a' }], status: 'pending' },      // scan
    { idx: 1, qty: 32, attach: [{ id: 'b' }], status: 'pending' },     // has qty — skip
    { idx: 2, qty: 0, attach: [], status: 'pending' },                 // no file — skip
    { idx: 3, qty: 0, attach: [{ id: 'c' }], status: 'cancelled' },    // cancelled — skip
    { idx: 4, qty: 0, attach: [{ id: 'd' }], status: 'pending' }       // scan
  ];
  eq('only qty-less bills WITH a file are scanned', B.candidates(rows).map(r => r.idx), [0, 4]);
  eq('nothing to do on an empty book', B.candidates([]), []);
  eq('null does not throw', B.candidates(null), []);
}

/* ══════════ 5. IT NEVER OVERWRITES A HUMAN ══════════
   The scan may be minutes old. If someone typed a quantity in meanwhile, the write
   must stand down — a person beats a parser, always. */
{
  const src = require('fs').readFileSync(require('path').join(__dirname, 'qty-backfill.js'), 'utf8');
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const code = strip(src);
  ok(/if \(!cur \|\| \+cur\.qty > 0\) return;/.test(code),
    'apply() RE-CHECKS at write time that the bill is still quantity-less');
  ok(/updatePurchase/.test(code) && !/S\.PURCHASES\[/.test(code),
    '  and writes through the real QLD mutation, not into the store directly');
  ok(!/addPurchase|deletePurchase|commit\(/.test(code),
    '  it only ever updates an existing bill — it cannot create or delete one');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
