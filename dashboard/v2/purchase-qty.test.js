/* purchase-qty.test.js — a purchase bill's tonnage must survive the import.
 *
 * Reported: "still not coming correct data we have everything quantity every bill
 * clearly". He was right and my diagnosis was wrong. I had concluded the bills
 * carried no quantity and built an elaborate "not recorded" UI to say so honestly.
 * The bills carry it. The IMPORTER threw it away.
 *
 *     sales.js:381     ocrMap: { …, qty: 'qty', … }      ← always had it
 *     purchase.js:881  ocrMap: { …            }          ← never did
 *
 * bill-ocr reads the tonnage off the bill (f.qty, bill-ocr.js:490). Sales carried
 * it across, which is why Quick Lime's 4,416 T was right all along. Purchase had no
 * mapping, no `qty` field in its importer, and no qty in buildRow's output — three
 * missing links in one chain. Every OCR-imported purchase landed with no tonnage,
 * so Inventory showed "Limestone 0 T" against ₹44,71,494 of real bills. The 97.7 T
 * of petcoke that did appear came from the few typed in by hand on the form, which
 * has always had a Qty field.
 *
 * This drives the REAL buildRow out of purchase.js.
 *
 *   node purchase-qty.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ purchase import · the tonnage ═══\n');

const src = fs.readFileSync(path.join(__dirname, 'purchase.js'), 'utf8');

/* ══════════ 1. THE CHAIN — every link, or the tonnage still vanishes ══════════
   Three separate places had to change. Any one missing and the quantity is lost
   somewhere between the bill and the Inventory card, silently. */
{
  const cfg = src.slice(src.indexOf("kind: 'purchase'"), src.indexOf('Dedup by bill no'));
  ok(/ocrMap:[^\n]*qty: 'qty'/.test(cfg), 'THE BUG: the purchase ocrMap now carries qty across from the OCR');
  ok(/fields:[^\n]*key: 'qty'/.test(cfg), '  the importer offers a Quantity column to map');
  ok(/autoMap:[^\n]*qty: QLFin\.colOf/.test(cfg), '  and auto-detects one in a spreadsheet');
  ok(/out\.qty = qty/.test(cfg), '  and buildRow actually STORES it — the map alone lands nowhere');

  /* The synonyms a real Indian purchase bill / spreadsheet uses. */
  const am = (cfg.match(/qty: QLFin\.colOf\([^)]*\)/) || [''])[0];
  ['qty', 'quantity', 'weight', 'tonne', 'ton', 'mt'].forEach(w =>
    ok(am.includes("'" + w + "'"), '  finds a "' + w + '" column'));
}

/* ══════════ 2. THE REAL buildRow ══════════ */
{
  const i = src.indexOf('buildRow: get => {');
  /* +'}' — the slice ends BEFORE buildRow's closing brace, and without it the vm
     fails as a bare "Unexpected token ')'" that says nothing about the cause. */
  const body = src.slice(i, src.indexOf('\n    },', i)) + '\n}';
  const ctx = {
    QLFin: {
      parseNum: v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; },
      parseDate: d => d || ''
    },
    Q: { purchaseGroups: [{ key: 'limestone', label: 'Limestone', items: ['Limestone Purchase'] }] },
    Math, Object, String, Number, parseFloat, isFinite
  };
  vm.createContext(ctx);
  vm.runInContext('this.buildRow = (' + body.replace('buildRow: get => {', 'get => {') + ');', ctx);
  const build = row => ctx.buildRow(k => (k in row ? row[k] : ''));

  /* A real Mateshwari limestone bill, as OCR reads it off the page. */
  const bill = build({ bill: '222/26-27', date: '2026-06-29', sup: 'Mateshwari Mines and Minerals',
                       gstin: '08ABWFM4111F1Z6', qty: '500', unit: 'MT', taxable: '1160333', grate: '5' });
  eq('THE FIX: a bill with 500 MT imports WITH its tonnage', bill.qty, 500);
  eq('  and its unit', bill.unit, 'MT');
  eq('  the money is untouched', bill.taxable, 1160333);
  ok(bill.rate > 0, '  and a per-tonne rate is derived from the two');
  eq('  rate = taxable / qty', bill.rate, Math.round(1160333 / 500 * 100) / 100);

  /* Indian spreadsheets write "500.5 MT" or "1,200" — the parser must cope. */
  eq('a decimal tonnage survives', build({ sup: 'X', qty: '97.7', taxable: '100' }).qty, 97.7);
  eq('a grouped number survives', build({ sup: 'X', qty: '1,200', taxable: '100' }).qty, 1200);

  /* A bill with NO quantity must leave qty UNSET — not 0. data.js coerces with
     `p.qty || 0` downstream, so writing a literal 0 here would make "never read"
     permanently indistinguishable from "genuinely zero". */
  const noQty = build({ bill: 'B/1', date: '2026-06-01', sup: 'X', taxable: '5000', grate: '5' });
  eq('a bill with no quantity leaves qty UNSET, not 0', noQty.qty, undefined);
  ok(!('unit' in noQty), '  and no unit');
  eq('  but it still imports — the money is real', noQty.taxable, 5000);

  /* Junk must not become a tonnage. */
  eq('a junk quantity is not stored', build({ sup: 'X', qty: 'abc', taxable: '100' }).qty, undefined);
  eq('a zero quantity is not stored as a real 0', build({ sup: 'X', qty: '0', taxable: '100' }).qty, undefined);
  eq('a negative quantity is refused', build({ sup: 'X', qty: '-5', taxable: '100' }).qty, undefined);
}

/* ══════════ 3. SALES MUST NOT REGRESS ══════════
   Sales already worked — Quick Lime's 4,416 T was right. This fix must not touch it. */
{
  const sales = fs.readFileSync(path.join(__dirname, 'sales.js'), 'utf8');
  ok(/ocrMap:[^\n]*qty: 'qty'/.test(sales), 'the sales importer still carries qty (it always did — this is the regression guard)');
  ok(/qty: QLFin\.colOf\(h, 'qty'/.test(sales), '  and still auto-detects the column');
}

/* ══════════ 4. THE TWO IMPORTERS NOW AGREE ══════════
   The whole bug was that one register captured the tonnage and the other did not.
   Nothing about a purchase makes its quantity less real than a sale's. */
{
  const sales = fs.readFileSync(path.join(__dirname, 'sales.js'), 'utf8');
  const sMap = (sales.match(/ocrMap: \{[^}]*\}/) || [''])[0];
  const pMap = (src.match(/ocrMap: \{[^}]*\}/) || [''])[0];
  ok(/qty: 'qty'/.test(sMap) && /qty: 'qty'/.test(pMap),
    'BOTH importers map qty — one capturing tonnage and the other silently dropping it is what caused this');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
