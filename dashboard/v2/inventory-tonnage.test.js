/* inventory-tonnage.test.js — a 7,650 Kg invoice is 7.65 T on the Inventory page.
 *
 * THE BUG: invHasQty / invCard / invStock / invFgStock / movementHTML read the
 * RAW r.qty off salesRows() and purchaseRows(). A sale entered as 7,650 Kg was
 * "dispatched 7,650 T" against 30 T produced → closing −7,620 T; a petcoke bill
 * of 32,490 Kg was "32,490 T". data.js already hands every row its tonnes
 * (r.tonnes: Kg ÷ 1000, null for Bag/Nos/Litre) — the page must read that,
 * and keep r.qty only for the one card counted in bags.
 *
 * Drives the REAL data.js (booted the way tonnage-wiring.test.js does) and the
 * REAL inline script of inventory.html (loaded the way inventory.test.js does),
 * with the REAL costing-core behind the monthly movement table. Nothing here is
 * a copy of a formula.
 *
 *   node inventory-tonnage.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));
const near = (m, a, b, tol) => ok(a != null && Math.abs(a - b) <= (tol == null ? 0.005 : tol), m + '\n     got: ' + a + '  expected: ~' + b);

console.log('\n═══ inventory · a Kg invoice is 7.65 T on the Inventory page ═══\n');

/* ── the REAL data.js in a mocked browser (as tonnage-wiring.test.js boots it) ── */
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
const QLCosting = require('./costing-core.js');
const YM = '2026-08';

/* The books: one Kg invoice, one production run of 30 T, one petcoke bill in Kg,
   one limestone bill in MT and one bag bill counted in bags. */
const kgAdd = Q.addSale({ inv: 'KG-1', date: YM + '-05', party: 'AZIZ CHEMICALS', product: 'quicklime', qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Ton', gstR: 5, veh: 'RJ19GA1111', status: 'pending' });
ok(!(kgAdd && kgAdd.ok === false), 'a 7,650 Kg @ ₹5,300 / Ton invoice is accepted by the store');
Q.addProduction({ date: YM + '-03', limestone: 60, petcoke: 6, bags: 0, quicklime: 30, hydrated: 0 });
Q.addPurchase({ bill: 'PC-1', date: YM + '-02', sup: 'COKE CO', taxable: 389880, grate: 18, group: 'petcoke', item: 'Petcoke Purchase', qty: 32490, unit: 'Kg' });
Q.addPurchase({ bill: 'L-1', date: YM + '-02', sup: 'STONE CO', taxable: 100000, grate: 5, group: 'limestone', item: 'Limestone Purchase', qty: 100, unit: 'MT' });
Q.addPurchase({ bill: 'B-1', date: YM + '-04', sup: 'BAG CO', taxable: 9600, grate: 18, group: 'packaging', item: 'Plastic Bags', qty: 400, unit: 'Bag' });

const S = Q.salesRows(), P = Q.purchaseRows(), R = Q.productionRows();
const kg = S.find(r => r.inv === 'KG-1'), pc = P.find(r => r.bill === 'PC-1'), bag = P.find(r => r.bill === 'B-1');
eq('fixture · salesRows hands the Kg invoice as 7.65 tonnes', kg.tonnes, 7.65);
eq('fixture · purchaseRows hands the 32,490 Kg petcoke bill as 32.49 tonnes', pc.tonnes, 32.49);
eq('fixture · a bill in bags has NO tonnage (null), and its count stays 400', [bag.tonnes, bag.qty], [null, 400]);
eq('fixture · the run produced 30 T', R.reduce((a, r) => a + r.quicklime, 0), 30);

/* ── the REAL inline script of inventory.html (as inventory.test.js loads it) ── */
const HTML = fs.readFileSync(path.join(__dirname, 'inventory.html'), 'utf8');
function buildQLXChrome() {
  const qlx = fs.readFileSync(path.join(__dirname, 'qlx.js'), 'utf8');
  const grab = name => {
    const i = qlx.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('qlx.js no longer defines ' + name);
    const open = qlx.indexOf('{', i);
    let j = open + 1, d = 1;
    while (j < qlx.length && d > 0) { const c = qlx[j]; if (c === '{') d++; else if (c === '}') d--; j++; }
    return qlx.slice(i, j);
  };
  const sandbox = {
    esc: x => (x == null ? '' : String(x)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    svg: b => '<svg>' + (b || '') + '</svg>', IC: { plus: '<plus/>', file: '<file/>' }
  };
  vm.createContext(sandbox);
  vm.runInContext([grab('icon'), grab('heroMarkup'), grab('statsMarkup')].join('\n') +
    '\n;this.__c = { heroHTML: heroMarkup, statsHTML: statsMarkup, wireHero: function(){} };', sandbox);
  return sandbox.__c;
}
function loadPage() {
  const script = /<script>\n([\s\S]*?)\n<\/script>\s*<\/body>/.exec(HTML);
  if (!script) throw new Error('could not find the page script in inventory.html');
  const noop = () => {};
  const els = {};
  const mkEl = id => els[id] || (els[id] = {
    id, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, onclick: null,
    classList: { add: noop, remove: noop, contains: () => false, toggle: noop },
    querySelectorAll: () => [], contains: () => false, appendChild: noop, removeChild: noop,
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 30, right: 100 })
  });
  const doc = {
    getElementById: id => mkEl(id), querySelector: s => mkEl(String(s).replace(/^#/, '')), querySelectorAll: () => [],
    createElement: () => ({ className: '', style: {}, innerHTML: '', offsetWidth: 268, parentNode: null, querySelectorAll: () => [], contains: () => false, appendChild: noop }),
    addEventListener: noop, removeEventListener: noop, body: { appendChild: noop, removeChild: noop }, documentElement: mkEl('html')
  };
  /* the REAL QLD, with init held so the tests drive render() themselves */
  const QLD = new Proxy(Q, { get: (t, k) => (k === 'init' ? noop : k === 'uiMonth' ? (() => null) : t[k]) });
  const ctx = {
    console, Date, Math, Number, String, Array, Set, Map, JSON, RegExp, isNaN, parseFloat, parseInt,
    document: doc, QLD, QLUnits, QLCosting,
    window: { QLD, QLUnits, QLCosting, scrollY: 0, innerWidth: 1280, addEventListener: noop },
    QLShell: { mount: noop, toast: noop, modal: noop, panel: noop, monthButton: o => `<button id="${o.id}">${o.label}</button>`, monthPicker: noop, closeMonthPicker: noop },
    QLMobile: null, setTimeout: noop, clearTimeout: noop, location: { href: '' },
    QLX: buildQLXChrome()
  };
  ctx.window.document = doc;
  vm.createContext(ctx);
  vm.runInContext(script[1] + `
    ;this.__X = { invModel, invCard, invStock, invFgStock, invHasQty, movementHTML, render, MATS: INV_MATERIALS, FG: INV_FG };
  `, ctx);
  return { X: ctx.__X, els, render: () => ctx.__X.render(), setP: p => vm.runInContext('PERIOD = ' + JSON.stringify(p), ctx) };
}

const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/* ══════════ 1. the finished-goods closing-stock card ══════════ */
{
  const p = loadPage();
  const fg = p.X.invFgStock(S, R, 'all') || {};
  eq('FG STOCK · produced 30 T', fg.inward, 30);
  eq('  dispatched 7.65 T — the Kg invoice is 7.65 tonnes, not 7,650', fg.used, 7.65);
  near('  closing 22.35 T, not −7,620', fg.closing, 22.35);
  eq('  and the invoice counts as a recorded quantity', fg.missing, 0);

  p.setP('all'); p.render();
  const body = strip(p.els.invBody.innerHTML);
  ok(/Quick Lime produced − dispatched 22\.35 T Produced 30 T Dispatched 7\.65 T/.test(body),
     'THE CARD says "22.35 T · Produced 30 T · Dispatched 7.65 T" — got: ' + (body.match(/Quick Lime produced[^]{0,80}/) || [''])[0]);
  ok(!/7,650 T|7,620/.test(body), '  and never prints 7,650 T or a −7,620 shortfall');
}

/* ══════════ 2. the dispatched card + KPI headline ══════════ */
{
  const p = loadPage();
  const fg = p.X.invCard(p.X.FG, S, 'all') || {};
  eq('DISPATCHED CARD · state complete (the Kg invoice carries a tonnage)', fg.state, 'complete');
  eq('  qty is 7.65 T', fg.qty, 7.65);
  near('  avg rate ₹5,300/T (₹40,545 ÷ 7.65), never ₹5.30', fg.rate, 5300, 0.01);
  eq('  no rate flag — ₹5,300/T is a real price', fg.flag, null);
  p.setP('all'); p.render();
  ok(/7\.65<u class="qx-u">T/.test(p.els.invStats.innerHTML), '  KPI · Dispatched reads 7.65 T');
}

/* ══════════ 3. purchase cards: Kg petcoke is 32.49 T, bags stay a count ══════════ */
{
  const p = loadPage();
  const M = p.X.invModel(P, S, R, 'all');
  const coke = M.raw.find(c => c.key === 'petcoke') || {};
  eq('PETCOKE · a 32,490 Kg bill is 32.49 T', coke.qty, 32.49);
  eq('  state complete', coke.state, 'complete');
  near('  rate ₹12,000/T (₹3,89,880 ÷ 32.49), not ₹12 — so no false rate flag', coke.rate, 12000, 0.01);
  eq('  no flag', coke.flag, null);
  const lime = M.raw.find(c => c.key === 'limestone') || {};
  eq('LIMESTONE · 100 MT is 100 T', lime.qty, 100);
  const bags = M.raw.find(c => c.key === 'packaging') || {};
  eq('BAGS · 400 bags stay 400 (a count, not a tonnage)', [bags.qty, bags.state], [400, 'complete']);

  const st = p.X.invStock(p.X.MATS.find(m => m.key === 'petcoke'), P, R, 'all') || {};
  eq('PETCOKE STOCK · inward 32.49 T − 6 T consumed', [st.inward, st.used], [32.49, 6]);
  near('  closing 26.49 T', st.closing, 26.49);
  const bs = p.X.invStock(p.X.MATS.find(m => m.key === 'packaging'), P, R, 'all') || {};
  eq('BAG STOCK · inward is the bag count, 400', bs.inward, 400);
  eq('KPI · "Raw material in" excludes bags (bags are not tonnes)', M.raw.filter(c => c.unit === 'T').reduce((a, c) => a + (c.qty || 0), 0), 132.49);
  p.setP('all'); p.render();
  ok(/132\.49<u class="qx-u">T/.test(p.els.invStats.innerHTML), '  and the KPI prints 132.49 T, not 532.49');
}

/* ══════════ 4. invHasQty: tonnes decide, except for bags ══════════ */
{
  const p = loadPage();
  const T = p.X.MATS.find(m => m.key === 'petcoke'), B = p.X.MATS.find(m => m.key === 'packaging');
  eq('a Kg row on a T card is recorded through its tonnes', p.X.invHasQty(kg, p.X.FG), true);
  eq('a bill in bags on a T card is NOT a recorded tonnage (tonnes null)', p.X.invHasQty(bag, T), false);
  eq('  but on the bag card it is', p.X.invHasQty(bag, B), true);
  eq('tonnes 0 (nothing entered) is not recorded', p.X.invHasQty({ qty: 0, unit: 'Kg', tonnes: 0 }, T), false);
  eq('a raw blob row with a blank unit is tonnes (data.js rule)', p.X.invHasQty({ qty: 40.2 }, T), true);
  eq('a raw blob row in Kg converts', p.X.invHasQty({ qty: 500, unit: 'Kg' }, T), true);
  eq('a raw blob row in Bags is not a tonnage', p.X.invHasQty({ qty: 500, unit: 'Bag' }, T), false);
}

/* ══════════ 5. the monthly movement table (real QLCosting) ══════════ */
{
  const p = loadPage();
  p.setP(YM); p.render();
  const mv = strip(p.els.invBody.innerHTML);
  ok(/Quick Lime \(T\) 0\.00 30\.00 7\.65 22\.35/.test(mv), 'MOVEMENT · Quick Lime row: opening 0 · produced 30 · sold 7.65 · closing 22.35 — got: ' + (mv.match(/Quick Lime \(T\)[^]{0,40}/) || [''])[0]);
  ok(/Petcoke \(T\) 0\.00 32\.49 6\.00 26\.49/.test(mv), '  Petcoke row: 0 · 32.49 · 6 · 26.49 — got: ' + (mv.match(/Petcoke \(T\)[^]{0,40}/) || [''])[0]);
  ok(!/7,650/.test(mv), '  nothing in the table is 7,650');
}

/* ══════════ 6. the defect, pinned in the source ══════════ */
{
  const script = /<script>\n([\s\S]*?)\n<\/script>\s*<\/body>/.exec(HTML)[1];
  const code = script.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  ok(!/a \+ s\.qty/.test(code) && !/a \+ invNum\(r\.qty\)/.test(code), 'no aggregate on the page sums a raw qty any more');
  ok(/r\.tonnes/.test(code), 'the page reads r.tonnes off the rows data.js hands it');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
