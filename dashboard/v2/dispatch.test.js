/* dispatch.test.js — the dispatch register counts TONNES, never raw qty.
 *
 * THE BUG: dispatch.html mapped qty: +r.qty and then summed it as tonnes —
 * a 7,650 Kg trip printed "Dispatched 7,650 T", an average load of thousands
 * of tonnes, and a "Qty (T)" column reading 7,650.00. The register now reads
 * r.tonnes (Q.salesRows() → QLUnits.toTonnes) for every tonnage figure, keeps
 * the entered quantity WITH its unit beside it, and treats a 400 Bag trip as
 * a trip with no tonnage recorded (a bag count is not a mass).
 *
 * Drives the REAL data.js and the REAL inline script of dispatch.html through
 * a captured QLX.mount — nothing here is a copy of a formula.
 *
 *   node dispatch.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));
const near = (a, b) => a != null && Math.abs(a - b) <= 0.01;

console.log('\n═══ dispatch · tonnes come from r.tonnes, never raw qty ═══\n');

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

/* The books: a Kg trip, a Ton trip, a legacy (no unit) trip, a Bag trip and a
   vehicle with no quantity at all. */
Q.addSale({ inv: 'KG-1', date: YM + '-05', party: 'AZIZ CHEMICALS', qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Ton', gstR: 5, veh: 'RJ19GA1111', status: 'pending' });
Q.addSale({ inv: 'T-1', date: YM + '-06', party: 'MARWAR TRADERS', qty: 20, unit: 'Ton', rate: 5000, rateUnit: 'Ton', gstR: 5, veh: 'RJ19GA2222', status: 'pending' });
Q.addSale({ inv: 'LEG-1', date: YM + '-07', party: 'MARWAR TRADERS', qty: 12, rate: 5000, rateUnit: '', gstR: 5, veh: 'RJ19GA2222', status: 'pending' });
Q.addSale({ inv: 'BAG-1', date: YM + '-08', party: 'SHREE HARDWARE', qty: 400, unit: 'Bag', rate: 150, rateUnit: 'Bag', gstR: 5, veh: 'RJ19GA3333', status: 'pending' });
Q.addSale({ inv: 'NOQ-1', date: YM + '-09', party: 'SHREE HARDWARE', qty: 0, rate: 0, gstR: 5, veh: 'RJ19GA4444', status: 'pending', taxable: 1000 });

/* ── the REAL inline script of dispatch.html, QLX.mount captured ── */
const html = fs.readFileSync(path.join(__dirname, 'dispatch.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => /QLX\.mount/.test(s));
ok(scripts.length === 1, 'dispatch.html has one inline register script');

let CFG = null, csv = null;
const noop = () => {};
const ctx = {
  console, Math, Object, Array, Number, String, Date, JSON, Set, Map, RegExp, Error, isNaN, isFinite, parseFloat, parseInt, encodeURIComponent,
  QLUnits, QLD: Q,
  QLShell: { exportCSV: (name, headers, data) => { csv = { name, headers, data }; } },
  QLX: { icons: { dl: '' }, mount: cfg => { CFG = cfg; }, month: () => YM, rows: () => CFG.data().filter(r => (r.date || '').slice(0, 7) === YM) },
  location: { href: '' }
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(scripts[0], ctx);
ok(CFG && typeof CFG.stats === 'function', 'the REAL dispatch.html mounted its register config');

const rows = CFG.data().filter(r => (r.date || '').slice(0, 7) === YM);
const by = inv => rows.find(r => r.inv === inv);
const kg = by('KG-1'), tn = by('T-1'), leg = by('LEG-1'), bag = by('BAG-1'), noq = by('NOQ-1');
ok(kg && tn && leg && bag && noq, 'all five invoices are dispatch rows (a vehicle or a quantity makes a trip)');

/* ══════════ 1. rows carry tonnes AND the entered qty + unit ══════════ */
eq('ROW: the Kg trip carries tonnes 7.65', kg.tonnes, 7.65);
eq('  and its entered quantity stays 7,650 Kg', [kg.qty, kg.unit], [7650, 'Kg']);
eq('  the Ton trip is 20 tonnes', tn.tonnes, 20);
eq('  a legacy row with a blank unit is tonnes (12)', leg.tonnes, 12);
eq('  a 400 Bag trip is NOT a tonnage (0), but its qty is kept', [bag.tonnes, bag.qty, bag.unit], [0, 400, 'Bag']);
eq('  a vehicle with no quantity has no tonnage', [noq.tonnes, noq.qty], [0, 0]);

/* ══════════ 2. stats — Dispatched / Avg load / Trips note ══════════ */
const stats = CFG.stats(rows), stat = l => stats.find(s => s.label === l);
eq('STATS: Dispatched sums r.tonnes — 7.65 + 20 + 12 = 39.65 T, never 8,082', stat('Dispatched').value, '39.65 T');
eq('  three trips carried a tonnage', stat('Dispatched').sub, '3 trips carried a tonnage');
eq('  Avg load is 39.65 ÷ 3 = 13.22 T per loaded trip', stat('Avg load').value, '13.22 T');
eq('  Trips counts the Bag trip AND the no-qty trip as "no tonnage recorded"', [stat('Trips').value, stat('Trips').sub], [5, '2 with no tonnage recorded']);

/* the Kg trip alone: the reproduction the task names */
const kgOnly = CFG.stats([kg]);
eq('REPRO: a 7,650 Kg trip alone reads Dispatched 7.65 T', kgOnly.find(s => s.label === 'Dispatched').value, '7.65 T');
eq('  and Avg load 7.65 T', kgOnly.find(s => s.label === 'Avg load').value, '7.65 T');

/* ══════════ 3. the column, quick filter, drawer, card, CSV ══════════ */
const col = k => CFG.columns.find(c => c.key === k);
ok(!col('qty') && col('tonnes') && col('tonnes').label === 'Qty (T)', 'the Qty (T) column is keyed on tonnes — it sorts by what it shows');
const kgCell = col('tonnes').cell(kg);
ok(/7\.65/.test(kgCell) && /7,650 Kg/.test(kgCell), '  the Kg row shows 7.65 with "7,650 Kg" beside it — got ' + kgCell);
ok(!/7,650\.00/.test(kgCell), '  and never 7,650.00 as tonnes');
ok(/<span class="qx-num">20<\/span>/.test(col('tonnes').cell(tn)) && !/Ton/.test(col('tonnes').cell(tn)), '  the Ton row shows 20 with no entered-qty echo (it IS tonnes) — got ' + col('tonnes').cell(tn));
const bagCell = col('tonnes').cell(bag);
ok(/400 Bag/.test(bagCell) && !/400\.00/.test(bagCell), '  the Bag row shows its entered "400 Bag", not 400.00 tonnes — got ' + bagCell);
ok(/no tonnage/i.test(bagCell), '  and says it has no tonnage');
ok(/qx-dash/.test(col('tonnes').cell(noq)), '  the no-quantity row keeps its dash');

const noqty = CFG.quickFilters.find(f => f.key === 'noqty');
eq('QUICK FILTER "No tonnage" catches the Bag trip and the empty trip, not the Kg one', rows.filter(noqty.test).map(r => r.inv), ['BAG-1', 'NOQ-1']);

const det = CFG.detail(kg).tabs[0].html;
ok(/7\.65 T/.test(det) && /7,650 Kg/.test(det), 'DRAWER: Quantity reads 7.65 T with the entered 7,650 Kg — got ' + (det.match(/Quantity<\/span><b>[^<]*/) || [''])[0]);
ok(!/7,650\.00 T/.test(det), '  never 7,650.00 T');
const bagDet = CFG.detail(bag).tabs[0].html;
ok(/400 Bag/.test(bagDet) && !/400\.00 T/.test(bagDet) && !/400 T/.test(bagDet), '  the Bag trip drawer shows 400 Bag, never 400 T');

const card = CFG.card(kg);
eq('CARD: amount is 7.65 T (never 7,650 T)', card.amount, '7.65 T');
const qrow = card.rows.find(r => r[0] === 'Quantity');
ok(qrow && /7\.65 T/.test(qrow[1]) && /7,650 Kg/.test(qrow[1]), '  the Quantity row carries 7.65 T with 7,650 Kg — got ' + (qrow && qrow[1]));
const bagCard = CFG.card(bag);
ok(/400 Bag/.test(bagCard.amount) && !/ T$/.test(bagCard.amount), '  the Bag card shows "400 Bag", not "400 T" — got ' + bagCard.amount);
ok(/—/.test(CFG.card(noq).amount), '  the no-quantity card shows a dash');

CFG.tools.find(t => t.label === 'Export').onClick();
ok(csv && csv.headers.indexOf('Qty (T)') >= 0 && csv.headers.indexOf('Qty') >= 0 && csv.headers.indexOf('Unit') >= 0, 'CSV: Qty (T) plus the entered Qty and Unit columns');
const kgCsv = csv.data.find(r => r[2] === 'KG-1');
const iT = csv.headers.indexOf('Qty (T)'), iQ = csv.headers.indexOf('Qty'), iU = csv.headers.indexOf('Unit');
eq('  the Kg row exports 7.65 tonnes, 7650, Kg', [kgCsv[iT], kgCsv[iQ], kgCsv[iU]], [7.65, 7650, 'Kg']);
const bagCsv = csv.data.find(r => r[2] === 'BAG-1');
eq('  the Bag row exports blank tonnes, 400, Bag', [bagCsv[iT], bagCsv[iQ], bagCsv[iU]], ['', 400, 'Bag']);

/* ══════════ 4. source pin — no raw qty summed or printed as tonnes ══════════ */
const src = scripts[0];
ok(!/reduce\(\(a, r\) => a \+ r\.qty/.test(src), 'PIN: dispatch.html never reduces r.qty into a tonnage');
ok(!/fmt\(r\.qty/.test(src), 'PIN: dispatch.html never prints r.qty through fmt() as tonnes');
ok(/QLUnits\.fmtQty/.test(src), 'PIN: the entered quantity is printed with QLUnits.fmtQty');
ok(/r\.tonnes/.test(src), 'PIN: tonnage figures read r.tonnes');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
