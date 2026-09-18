/* tonnage-wiring.test.js — a Kg invoice is 7.65 T everywhere, and says so.
 *
 * THE BUG: 7,650 Kg @ ₹5,300 / Ton was booked as 7,650 × 5,300 = ₹4.05 Cr, and
 * the 7,650 was then SUMMED AS TONNES by every register, dashboard, monthly
 * register and costing screen. units-core.js (QLUnits) is the one arithmetic;
 * this file pins that every consumer this track owns is WIRED to it:
 *
 *   · sales.js stats / footer / rate column / CSV read r.tonnes (7.65), and the
 *     card sub-line prints the row AS ENTERED: "7,650 Kg @ ₹5,300 / Ton"
 *   · dashboard.js monthMetrics().qty, monthreg-core monthStats().salesQty and
 *     costing-core productionCost().outputT all count the Kg sale as 7.65 T
 *   · an OCR / spreadsheet import of taxable ₹40,545 with 7,650 Kg books
 *     rate ₹5,300 per Ton (unit Kg, rateUnit Ton) — never ₹5.30 with no unit
 *
 * Drives the REAL data.js, sales.js, dashboard.js, monthreg-core.js and
 * costing-core.js — nothing here is a copy of a formula.
 *
 *   node tonnage-wiring.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));
const near = (a, b) => a != null && Math.abs(a - b) <= 0.01;

console.log('\n═══ tonnage wiring · a Kg invoice is 7.65 T everywhere ═══\n');

/* ── the REAL data.js in a mocked browser ── */
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = '' + v; }, removeItem: k => { delete store[k]; } };
global.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.location = { hash: '', hostname: 'localhost', pathname: '/', search: '', replace() {}, href: '' };
global.history = { replaceState() {} };
global.navigator = { userAgent: 'node-test' };
global.document = { addEventListener() {}, createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
global.setTimeout = () => 0;
global.window = global;
localStorage.setItem('ql_plant', JSON.stringify({ id: 'co1', plants: [{ id: 'co1', plant_name: 'Test Co' }], token: 't', role: 'owner', user: { name: 'Tester', role: 'owner' } }));
localStorage.setItem('dm_active_co', 'co1');
global.supabase = { createClient: () => ({ rpc: async () => ({ data: null, error: 'offline' }) }) };
const QLUnits = require('./units-core.js');
global.QLUnits = QLUnits;
require('./data.js');
const Q = global.QLD;
const YM = '2026-08';

/* The books: one invoice weighed in kilos priced per tonne, one in tonnes. */
const kgAdd = Q.addSale({ inv: 'KG-1', date: YM + '-05', party: 'AZIZ CHEMICALS', qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Ton', gstR: 5, veh: 'RJ19GA1111', status: 'pending' });
ok(!(kgAdd && kgAdd.ok === false), 'a 7,650 Kg @ ₹5,300 / Ton invoice is accepted by the store');
Q.addSale({ inv: 'T-1', date: YM + '-06', party: 'MARWAR TRADERS', qty: 20, unit: 'Ton', rate: 5000, rateUnit: 'Ton', gstR: 5, veh: 'RJ19GA2222', status: 'pending' });
Q.addPurchase({ bill: 'L-1', date: YM + '-02', sup: 'STONE CO', taxable: 100000, grate: 5, group: 'limestone', item: 'Limestone Purchase', qty: 100, unit: 'MT' });

const rows = Q.salesRows().filter(r => (r.date || '').slice(0, 7) === YM);
const kg = rows.find(r => r.inv === 'KG-1'), tn = rows.find(r => r.inv === 'T-1');
eq('salesRows: the Kg row carries tonnes 7.65', kg.tonnes, 7.65);
eq('  and its taxable is ₹40,545 (7.65 Ton × ₹5,300), not ₹4.05 Cr', kg.taxable, 40545);
eq('  qty stays as entered', [kg.qty, kg.unit, kg.rate, kg.rateUnit], [7650, 'Kg', 5300, 'Ton']);
eq('  the Ton row is 20 tonnes', tn.tonnes, 20);

/* ══════════ 1. sales.js — stats, footer, column, card, CSV ══════════ */
{
  let CFG = null, csv = null;
  const noop = () => {};
  const ctx = {
    console, Math, Object, Array, Number, String, Date, JSON, Set, Map, Promise, RegExp, Error, isNaN, isFinite, parseFloat, parseInt, Blob: function () {},
    QLUnits, QLD: Q, QLParty: require('./party-identity.js'), QLBulk: null, QLMobile: null,
    QLFin: { parseNum: v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }, parseDate: d => d || '', colOf: () => null, importSheet: noop },
    QLShell: { mount: noop, toast: noop, openForm: noop, openSaleForm: noop, exportCSV: (name, headers, data) => { csv = { name, headers, data }; }, confirmDelete: noop, getInvoiceHTML: () => '' },
    QLX: { esc: s => String(s == null ? '' : s), svg: () => '', icons: {}, toast: noop, refresh: noop, mount: cfg => { CFG = cfg; }, state: () => ({}), month: () => YM, monthLabel: () => 'Aug 2026', rows: () => rows, actionsCell: () => '' },
    indexedDB: { open: () => ({}) }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: noop },
    location: { hash: '', pathname: '/v2/sales' }, history: { replaceState: noop }, navigator: { userAgent: 'node' },
    matchMedia: () => ({ matches: false }), addEventListener: noop, removeEventListener: noop, setTimeout: noop, clearTimeout: noop,
    localStorage: { getItem: () => null, setItem: noop }, sessionStorage: { getItem: () => null, setItem: noop },
    document: { addEventListener: noop, querySelector: () => null, getElementById: () => null, body: { appendChild: noop } }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'sales.js'), 'utf8'), ctx);
  ok(CFG && typeof CFG.stats === 'function', 'the REAL sales.js mounted its register config');

  const stat = CFG.stats(rows).find(s => s.label === 'Total Invoices');
  eq('stats: "T dispatched" sums r.tonnes — 7.65 + 20 = 27.7 T, not 7,670', stat.sub, '27.7 T dispatched');

  const foot = CFG.footer(rows).find(f => f.label === 'Qty');
  eq('footer: Qty sums tonnes', foot.value, '27.7 T');

  const col = k => CFG.columns.find(c => c.key === k);
  ok(!col('qty') && col('tonnes'), 'the Qty (T) column is keyed on tonnes — it sorts by what it shows');
  ok(/7\.65/.test(col('tonnes').cell(kg)) && /7,650 Kg/.test(col('tonnes').cell(kg)), '  a Kg row shows 7.65 with "7,650 Kg" beside it');
  ok(/5,300/.test(col('rate').cell(kg)), '  Rate ₹/T for the Kg row is ₹5,300 (₹40,545 ÷ 7.65 T), not ₹5');
  ok(/5,000/.test(col('rate').cell(tn)), '  and ₹5,000 for the Ton row');

  const card = CFG.card(kg);
  ok(card.sub.indexOf('7,650 Kg @ ₹5,300 / Ton') === 0, 'THE CARD: sub-line prints "7,650 Kg @ ₹5,300 / Ton" (entered qty WITH unit, stored rate WITH its unit) — got "' + card.sub + '"');
  eq('  and the card rows carry the same quantity', card.rows[0], ['Qty', '7,650 Kg']);
  ok(/20 Ton @ ₹5,000 \/ Ton/.test(CFG.card(tn).sub), '  a Ton row reads "20 Ton @ ₹5,000 / Ton"');
  ok(/7,650 Kg/.test(CFG.detail(kg).sub), 'detail header shows the entered quantity with its unit');

  vm.runInContext('exportRows(' + JSON.stringify(rows) + ')', ctx);
  ok(csv && csv.headers.slice(-4).join('|') === 'Qty|Unit|Rate|Rate per', 'CSV: adds Qty, Unit, Rate, Rate per columns (the row as entered)');
  const kgCsv = csv.data.find(r => r[0] === 'KG-1');
  eq('  Qty (MT) is tonnes (7.65) and Rate ₹/T is ₹5,300', [kgCsv[5], kgCsv[6]], [7.65, 5300]);
  eq('  and the entered row follows: 7650 · Kg · 5300 · Ton', kgCsv.slice(-4), [7650, 'Kg', 5300, 'Ton']);

  /* the spreadsheet importer: taxable + qty in Kg → rate per Ton */
  const importCfg = (() => { let got = null; ctx.QLBulk = { open: c => { got = c; } }; vm.runInContext('importInvoices()', ctx); return got; })();
  ok(importCfg && importCfg.ocrMap.unit === 'unit', 'the sales importer now carries the bill\'s unit across from OCR');
  const built = importCfg.buildRow(k => ({ inv: 'IMP-1', date: '2026-08-09', party: 'X', qty: '7650', unit: 'Kg', taxable: '40545' }[k] || ''));
  eq('IMPORT: taxable ₹40,545 with 7,650 Kg books rate ₹5,300 per Ton', [built.qty, built.unit, built.rate, built.rateUnit], [7650, 'Kg', 5300, 'Ton']);
  eq('  and the preview prices it at ₹40,545', importCfg.preview.row(built)[4], '₹40,545');
  const sheetRate = importCfg.buildRow(k => ({ date: '2026-08-09', party: 'X', qty: '7650', unit: 'Kg', rate: '5300', taxable: '40545' }[k] || ''));
  eq('  a sheet with rate 5300 AND taxable 40545 keeps the rate per Ton', [sheetRate.rate, sheetRate.rateUnit], [5300, 'Ton']);
  const perKg = importCfg.buildRow(k => ({ date: '2026-08-09', party: 'X', qty: '7650', unit: 'Kg', rate: '5.30', taxable: '40545' }[k] || ''));
  eq('  a sheet whose rate reconciles per Kg is stored per Kg', [perKg.rate, perKg.rateUnit], [5.3, 'Kg']);
  const legacy = importCfg.buildRow(k => ({ date: '2026-08-09', party: 'X', qty: '20', taxable: '100000' }[k] || ''));
  ok(legacy.unit === undefined && legacy.rate === 5000, '  a sheet with no unit column stays legacy (rate per the qty, no unit)');
}

/* ══════════ 2. the OCR path: extract-api → importGenericBill ══════════ */
{
  const before = Q.state.SALES.length;
  Q.importGenericBill('sales', { dir: 'sales', docno: 'OCR-1', date: '2026-08-11', name: 'AZIZ CHEMICALS', gstin: '', qty: 7650, unit: 'Kg', taxable: 40545, total: 42572.25, rate: 5 });
  const s = Q.state.SALES[Q.state.SALES.length - 1];
  ok(Q.state.SALES.length === before + 1 && s.inv === 'OCR-1', 'importGenericBill stored the OCR\'d bill');
  eq('OCR: taxable ₹40,545 with 7,650 Kg books rate ₹5,300 per Ton, unit Kg', [s.qty, s.unit, s.rate, s.rateUnit], [7650, 'Kg', 5300, 'Ton']);
  eq('  and the register prices it back to ₹40,545', Q.saleTaxable(s), 40545);
  eq('  as 7.65 tonnes', Q.saleTonnes(s), 7.65);
  const src = fs.readFileSync(path.join(__dirname, 'extract-api.js'), 'utf8');
  ok(/g\.unit = \(li\.unit \|\| ''\) \+ ''/.test(src), 'extract-api.js passes lineItems[0].unit through as g.unit');
  ok(/g\.unitRate = li\.rate/.test(src), '  and the per-unit price as g.unitRate (g.rate stays the GST%)');
}

/* ══════════ 3. dashboard.js monthMetrics ══════════ */
{
  const noop = () => {};
  const QLDp = new Proxy(Q, { get: (t, k) => (k === 'init' ? undefined : t[k]) });
  const ctx = {
    console, Math, Object, Array, Number, String, Date, JSON, Set, Map, Promise, RegExp, Error, isNaN, isFinite, parseFloat, parseInt,
    QLUnits, QLD: QLDp, QLShell: { toast: noop, monthButton: () => '', monthPicker: noop, mount: noop },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}), addEventListener: noop, body: { appendChild: noop } },
    matchMedia: () => ({ matches: false, addEventListener: noop }), setTimeout: noop, clearTimeout: noop, requestAnimationFrame: noop,
    localStorage: { getItem: () => null, setItem: noop }, sessionStorage: { getItem: () => null, setItem: noop },
    location: { href: '', pathname: '/v2/dashboard', search: '', hash: '' }, history: { replaceState: noop }, navigator: { userAgent: 'node' },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: noop }, Blob: function () {}, addEventListener: noop, removeEventListener: noop
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8'), ctx);
  const DP = ctx.window.__qlDashPeriod;
  ok(DP && typeof DP.metrics === 'function', 'the REAL dashboard.js loaded');
  DP.set(YM);
  const M = DP.metrics();
  ok(near(M.qty, 35.3), 'DASHBOARD: the month\'s dispatch is 35.3 T (7.65 + 20 + 7.65 tonnes), never 15,320 — got ' + M.qty);
  const src = fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');
  ok(!/reduce\(\(a, r\) => a \+ \(r\.qty \|\| 0\), 0\)/.test(src) && !/a \+ r\.qty,/.test(src), '  no dashboard aggregate sums a raw r.qty any more');
}

/* ══════════ 4. monthreg-core & costing-core ══════════ */
{
  const MR = require('./monthreg-core.js');
  const st = MR.monthStats(Q.salesRows(), Q.purchaseRows(), YM);
  ok(near(st.salesQty, 35.3), 'MONTHREG: salesQty is tonnes — 7.65 + 20 + 7.65 (the OCR one) = 35.3 T, got ' + st.salesQty);
  ok(near(st.salesRatePerT, (40545 + 100000 + 40545) / 35.3), '  so ₹/T is a true per-tonne rate');
  ok(near(st.purchaseQty.qty, 100), '  purchase tonnage reads MT as tonnes');
  const bagOnly = MR.monthStats([], [{ bill: 'B', date: YM + '-01', taxable: 9600, qty: 400, unit: 'Bag', tonnes: null, status: 'pending' }], YM);
  eq('  a bill in bags is an UNRECORDED tonnage, not 400 T', [bagOnly.purchaseQty.qty, bagOnly.purchaseQty.missing], [0, 1]);

  const C = require('./costing-core.js');
  const pc = C.productionCost(Q.costingInputs(YM));
  ok(near(pc.outputT, 35.3), 'COSTING: period output tonnes = 35.3 (the Kg invoices are 7.65 T each), got ' + pc.outputT);
  const pl = C.monthlyPL(Q.costingInputs(YM));
  ok(near(pl.salesT, 35.3), '  monthly P&L dispatched tonnes agree');
  const kgSale = Q.state.SALES.find(s => s.inv === 'KG-1');
  const ip = C.invoiceProfit({ date: kgSale.date, qty: Q.saleTonnes(kgSale), taxable: Q.saleTaxable(kgSale) }, Q.costingInputs(YM));
  ok(ip.ok && near(ip.qty, 7.65) && near(ip.value, 40545) && near(ip.ratePerT, 5300), '  invoiceProfit on the Kg invoice: 7.65 T, ₹40,545, ₹5,300/T');
  const raw = C.invoiceProfit(kgSale, Q.costingInputs(YM));
  ok(raw.ok && near(raw.qty, 7.65) && near(raw.value, 40545), '  and handed the RAW record (qty 7650, unit Kg) it still prices 7.65 T at ₹40,545 — saleVal goes through QLUnits.lineAmount');
}

/* ── the four sites the gate found after the fan-out ── */
(function () {
  const fs2 = require('fs'), path2 = require('path');
  const s = f => fs2.readFileSync(path2.join(__dirname, f), 'utf8');
  ok('group-core prices a sale through units-core, not qty × rate', /_UN\(\)\.lineAmount\(s\)\.amount/.test(s('group-core.js')) && !/const saleTaxable = s => round2\(num\(s\.qty\) \* num\(s\.rate\)\);/.test(s('group-core.js')));
  ok('sources-core prices a sale through units-core', /_UN\(\)\.lineAmount\(s\)\.amount/.test(s('sources-core.js')));
  ok('intercompany prices through units-core and sums tonnes, not raw qty', /_UN\(\)\.lineAmount\(s\)\.amount/.test(s('intercompany.js')) && /q = tonnesOf\(s\)/.test(s('intercompany.js')));
  ok('crm.js cost-per-tonne divides by tonnes from salesRows', /s\.tonnes != null \? \+s\.tonnes/.test(s('crm.js')));
  const G = require(path2.join(__dirname, 'group-core.js'));
  if (G && typeof G.saleTaxable === 'function') ok('group-core: 7,650 Kg @ 5,300/Ton = 40,545', G.saleTaxable({ qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Ton' }) === 40545);
})();

/* ── sales.js: the two silent ×1000 re-pricings (full pins in sales-import-rateunit.test.js) ── */
(function () {
  const noop = () => {};
  const ctx = {
    console, Math, Object, Array, Number, String, Date, JSON, Set, Map, Promise, RegExp, Error, isNaN, isFinite, parseFloat, parseInt, Blob: function () {},
    QLUnits, QLD: Q, QLParty: require('./party-identity.js'), QLBulk: null, QLMobile: null,
    QLFin: { parseNum: v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }, parseDate: d => d || '', colOf: () => null, importSheet: noop },
    QLShell: { mount: noop, toast: noop, openForm: noop, openSaleForm: noop, exportCSV: noop, confirmDelete: noop, getInvoiceHTML: () => '' },
    QLX: { esc: s => String(s == null ? '' : s), svg: () => '', icons: {}, toast: noop, refresh: noop, mount: noop, state: () => ({}), month: () => YM, monthLabel: () => 'Aug 2026', rows: () => [], actionsCell: () => '' },
    indexedDB: { open: () => ({}) }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: noop },
    location: { hash: '', pathname: '/v2/sales' }, history: { replaceState: noop }, navigator: { userAgent: 'node' },
    matchMedia: () => ({ matches: false }), addEventListener: noop, removeEventListener: noop, setTimeout: noop, clearTimeout: noop,
    localStorage: { getItem: () => null, setItem: noop }, sessionStorage: { getItem: () => null, setItem: noop },
    document: { addEventListener: noop, querySelector: () => null, getElementById: () => null, body: { appendChild: noop } }
  };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'sales.js'), 'utf8'), ctx);
  let cfg = null; ctx.QLBulk = { open: c => { cfg = c; } }; vm.runInContext('importInvoices()', ctx);
  /* IMPORT: a Kg qty with a per-Kg rate and NO taxable/total used to book at 1/1000 (₹40.55). */
  const a = cfg.buildRow(k => ({ date: YM + '-09', party: 'X', qty: '7650', unit: 'Kg', rate: '5.30' }[k] || ''));
  eq('IMPORT: 7,650 Kg @ 5.30 with no taxable/total keeps the rate per Kg and books ₹40,545, not ₹40.55', [a.rateUnit, QLUnits.lineAmount(a).amount, !!a._review], ['Kg', 40545, true]);
  const b = cfg.buildRow(k => ({ date: YM + '-09', party: 'X', qty: '7650', unit: 'Kg', rate: '5.30', total: '42572.25' }[k] || ''));
  eq('  a total with no taxable is reconciled against FIRST — per Kg, ₹40,545, no flag', [b.rateUnit, QLUnits.lineAmount(b).amount, !!b._review], ['Kg', 40545, false]);
  /* DUPLICATE: a legacy row (unit, no rateUnit) re-added without rateUnit defaulted per Ton — ₹4,05,45,000 → ₹40,545. */
  Q.state.SALES.push({ inv: 'LEG-KG', date: YM + '-05', party: 'AZIZ CHEMICALS', qty: 7650, unit: 'Kg', rate: 5300, gstR: 5, status: 'pending' });
  const idx = Q.state.SALES.length - 1;
  vm.runInContext('dupInv(' + JSON.stringify({ idx }) + ')', ctx);
  const copy = Q.state.SALES[Q.state.SALES.length - 1];
  eq('DUPLICATE: the copy of a legacy per-Kg row prices like the original — ₹4,05,45,000 both, rateUnit \'\' explicit', [copy.inv, copy.rateUnit, Q.saleTaxable(copy), Q.saleTaxable(Q.state.SALES[idx])], ['LEG-KG-COPY', '', 40545000, 40545000]);
})();

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
