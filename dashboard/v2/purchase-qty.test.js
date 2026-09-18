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
    QLUnits: require('./units-core.js'),   // the page's window.QLUnits — the rate is derived through it
    Math, Object, String, Number, parseFloat, isFinite
  };
  vm.createContext(ctx);
  vm.runInContext('this.buildRow = (' + body.replace('buildRow: get => {', 'get => {') + ');', ctx);
  const build = row => ctx.buildRow(k => (k in row ? row[k] : ''));

  /* A real Mateshwari limestone bill, as OCR reads it off the page. */
  const bill = build({ bill: '222/26-27', date: '2026-06-29', sup: 'Mateshwari Mines and Minerals',
                       gstin: '08ABWFM4111F1Z6', qty: '500', unit: 'MT', taxable: '1160333', grate: '5' });
  eq('THE FIX: a bill with 500 MT imports WITH its tonnage', bill.qty, 500);
  eq('  and its unit — canonical: MT is a Ton (units-core.js)', bill.unit, 'Ton');
  eq('  and says which unit the derived rate is per', bill.rateUnit, 'Ton');
  eq('  the money is untouched', bill.taxable, 1160333);
  ok(bill.rate > 0, '  and a per-tonne rate is derived from the two');
  eq('  rate = taxable / qty', bill.rate, Math.round(1160333 / 500 * 100) / 100);

  /* A bill weighed in kilos: the rate is per the bill's OWN unit and the row
     says so — ₹5.30 / Kg, never a bare 5.30 later read as ₹/T. */
  const kg = build({ bill: 'K/1', date: '2026-07-01', sup: 'Y', qty: '7650', unit: 'Kg', taxable: '40545', grate: '5' });
  eq('a 7,650 Kg bill keeps its quantity as entered', kg.qty, 7650);
  eq('  unit Kg', kg.unit, 'Kg');
  eq('  rate per Kg', kg.rateUnit, 'Kg');
  eq('  ₹40,545 ÷ 7,650 Kg = ₹5.30 / Kg', kg.rate, 5.3);
  eq('  Indian Oil\'s "TO" is a Ton', build({ sup: 'IOC', qty: '32.49', unit: 'TO', taxable: '411973.2' }).unit, 'Ton');

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

/* ══════════ 5. BULK "SET RATE ₹/T" MUST NOT REWRITE A BAG / NOS COUNT ══════════
   The bulk action rewrote EVERY selected bill to `unit: 'Ton'` with qty = taxable ÷
   rate. Select 30 IOC bills plus one bill of 200 Bag and the bag count is gone —
   replaced by "20 Ton" — and 12 Nos of something becomes 12 Ton. A ₹/T rate can
   only describe a bill counted by mass; anything else is skipped and reported.
   A bill that already carries a mass quantity keeps its own unit and count
   (5,000 Kg stays 5,000 Kg — the rate is per Ton whatever the truck unit).
   This drives the REAL bulk action out of purchase.js. */
{
  const i = src.indexOf("{ label: 'Set rate ₹/T'"), j = src.indexOf("{ label: 'Mark paid'", i);
  const body = src.slice(i, src.lastIndexOf('},', j) + 1);
  const store = [
    { idx: 0, bill: 'IOC-1',  qty: 0,    unit: '',    taxable: 500000 },   // no tonnage — derive it
    { idx: 1, bill: 'BAG-1',  qty: 200,  unit: 'Bag', taxable: 100000 },   // a count someone typed
    { idx: 2, bill: 'NOS-1',  qty: 12,   unit: 'Nos', taxable: 60000 },
    { idx: 3, bill: 'KG-1',   qty: 5000, unit: 'Kg',  taxable: 25000 },    // mass, not tonnes
    { idx: 4, bill: 'TON-1',  qty: 40,   unit: 'Ton', taxable: 200000 },
    { idx: 5, bill: 'LEGACY', qty: 30,   unit: '',    taxable: 150000 },   // blank unit + qty = tonnes
    { idx: 6, bill: 'NOTAX',  qty: 0,    unit: '',    taxable: 0 }
  ];
  const toasts = [], forms = []; const writes = [];
  const ctx = {
    QLUnits: require('./units-core.js'), toast: (m, k) => toasts.push([m, k]), fC: n => '₹' + n, IC: {},
    QLX: { refresh() {} }, QLShell: { openForm(o) { forms.push(o); } },
    Q: { updatePurchase(i, e) { writes.push(i); Object.assign(store[i], e); } }, Math, Object, Number, String
  };
  vm.createContext(ctx);
  vm.runInContext('this.act = (' + body + ');', ctx);
  ctx.act.onClick(store.map(r => ({ ...r })));
  eq('the form opens for the 4 priceable mass / blank bills only (NOTAX has nothing to divide)', forms.length && /Set rate for 4 bills/.test(forms[0].title), true);
  ok(/2 Bag\/Nos bills skipped/.test(forms[0].sub), '  and the subtitle says 2 Bag/Nos bills are skipped');
  forms[0].onSave({ rate: 5000 });

  const by = b => store.find(r => r.bill === b);
  eq('THE BUG: 200 Bag is still 200 Bag — not rewritten to 20 Ton', [by('BAG-1').qty, by('BAG-1').unit], [200, 'Bag']);
  eq('  12 Nos is still 12 Nos — not 12 Ton', [by('NOS-1').qty, by('NOS-1').unit], [12, 'Nos']);
  ok(!('rate' in by('BAG-1')) && !('rate' in by('NOS-1')), '  and neither got a ₹/T rate stamped on a count');
  ok(!writes.includes(1) && !writes.includes(2) && !writes.includes(6), '  skipped bills were never written at all');
  eq('a bill with no tonnage gets it derived: 5,00,000 ÷ 5,000 = 100 T', [by('IOC-1').qty, by('IOC-1').unit, by('IOC-1').rate, by('IOC-1').rateUnit], [100, 'Ton', 5000, 'Ton']);
  eq('5,000 Kg keeps its unit and count — nothing converted, rate is per Ton', [by('KG-1').qty, by('KG-1').unit, by('KG-1').rate, by('KG-1').rateUnit], [5000, 'Kg', 5000, 'Ton']);
  eq('  and units-core prices it right: 5 T × ₹5,000', ctx.QLUnits.lineAmount({ qty: 5000, unit: 'Kg', rate: 5000, rateUnit: 'Ton' }).amount, 25000);
  eq('40 Ton keeps its 40 (the typed count wins over taxable ÷ rate)', [by('TON-1').qty, by('TON-1').unit, by('TON-1').rateUnit], [40, 'Ton', 'Ton']);
  eq('a legacy blank-unit tonnes row keeps its 30 and becomes self-describing', [by('LEGACY').qty, by('LEGACY').unit, by('LEGACY').rateUnit], [30, 'Ton', 'Ton']);
  eq('the toast reports 4 applied, 1 filled, 2 skipped', toasts[0][0], 'Rate ₹5000/T applied to 4 bills — tonnage filled in on 1 · 2 skipped (Bag/Nos count kept)');
  eq('  as a warning, because something was left out', toasts[0][1], 'warn');

  /* Every selected bill is Bag/Nos: nothing to price, say so, no form. */
  forms.length = 0; toasts.length = 0;
  ctx.act.onClick([{ idx: 1, qty: 200, unit: 'Bag', taxable: 100000 }, { idx: 2, qty: 12, unit: 'Nos', taxable: 60000 }]);
  eq('all-Bag/Nos selection opens no form', forms.length, 0);
  ok(/2 selected bills are counted in Bag \/ Nos/.test(toasts[0] && toasts[0][0]), '  and the toast explains why');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
