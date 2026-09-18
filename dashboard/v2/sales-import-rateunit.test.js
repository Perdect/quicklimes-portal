/* sales-import-rateunit.test.js — a rate is per the unit the sheet says, never a
 * ×1000 guess.
 *
 * Two silent re-pricings on the Sales register, both caught by the owner's own
 * 7,650 Kg example:
 *
 *   1. Spreadsheet import: a Kg quantity with a per-Kg rate and NO taxable /
 *      total column booked at 1/1000 — ₹40.55 instead of ₹40,545 — because
 *      buildRow assumed the rate was per Ton with nothing to check it against.
 *      A total with no taxable was also ignored whenever qty and rate were both
 *      on the sheet, which is exactly the row that needed it.
 *   2. Duplicate: the action re-added a row written before rate units existed
 *      (unit Kg, no rateUnit — priced per Kg) WITHOUT a rateUnit, and addSale
 *      defaulted the copy to per Ton: ₹4,05,45,000 became ₹40,545.
 *
 * Drives the REAL data.js + sales.js in a mocked browser.
 *
 *   node sales-import-rateunit.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ sales import + duplicate · the rate unit is never guessed ═══\n');

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

const noop = () => {}, toasts = [];
const colOf = (header, ...kws) => header.findIndex(h => { const c = (h || '').toString().toLowerCase().trim(); return kws.some(k => c.includes(k)); });   // finance.js's matcher, verbatim
const ctx = {
  console, Math, Object, Array, Number, String, Date, JSON, Set, Map, Promise, RegExp, Error, isNaN, isFinite, parseFloat, parseInt, Blob: function () {},
  QLUnits, QLD: Q, QLParty: require('./party-identity.js'), QLBulk: null, QLMobile: null,
  QLFin: { parseNum: v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }, parseDate: d => d || '', colOf, importSheet: noop },
  QLShell: { mount: noop, toast: noop, openForm: noop, openSaleForm: noop, exportCSV: noop, confirmDelete: noop, getInvoiceHTML: () => '' },
  QLX: { esc: s => String(s == null ? '' : s), svg: () => '', icons: {}, toast: m => toasts.push(String(m)), refresh: noop, mount: noop, state: () => ({}), month: () => '2026-08', monthLabel: () => 'Aug 2026', rows: () => [], actionsCell: () => '' },
  indexedDB: { open: () => ({}) }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: noop },
  location: { hash: '', pathname: '/v2/sales' }, history: { replaceState: noop }, navigator: { userAgent: 'node' },
  matchMedia: () => ({ matches: false }), addEventListener: noop, removeEventListener: noop, setTimeout: noop, clearTimeout: noop,
  localStorage: { getItem: () => null, setItem: noop }, sessionStorage: { getItem: () => null, setItem: noop },
  document: { addEventListener: noop, querySelector: () => null, getElementById: () => null, body: { appendChild: noop } }
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'sales.js'), 'utf8'), ctx);
let cfg = null; ctx.QLBulk = { open: c => { cfg = c; } }; vm.runInContext('importInvoices()', ctx);
ok(cfg && typeof cfg.buildRow === 'function', 'the REAL sales importer config was captured');
const row = o => cfg.buildRow(k => (o[k] == null ? '' : String(o[k])));
const amount = r => QLUnits.lineAmount(r).amount;

/* ══════════ 1. buildRow — nothing to reconcile against ══════════ */
{
  /* THE bug: 7,650 Kg @ ₹5.30 with no taxable and no total booked ₹40.55. */
  const a = row({ date: '2026-08-09', party: 'X', qty: 7650, unit: 'Kg', rate: 5.30 });
  eq('IMPORT: Kg qty + per-Kg rate, no taxable/total → rate stays per Kg (the qty\'s own unit), not per Ton', [a.rate, a.rateUnit], [5.3, 'Kg']);
  eq('  so the line books ₹40,545, not ₹40.55', amount(a), 40545);
  ok(typeof a._review === 'string' && /per Kg/.test(a._review) && /taxable|total/.test(a._review), '  and the row is FLAGGED for review — the unit was kept, not verified: "' + a._review + '"');
  ok(/⚠/.test(cfg.preview.row(a)[4]) && /5\.30 \/ Kg/.test(cfg.preview.row(a)[4]), '  the preview shows the flag with the rate AS BOOKED (₹5.30 / Kg), got ' + JSON.stringify(cfg.preview.row(a)[4]));

  /* The same rule protects the other direction: a per-Ton figure with nothing
     to check it against is NOT silently trusted either — it is kept per the
     sheet's unit and flagged, so a ×1000 is seen in the review table. */
  const c = row({ date: '2026-08-09', party: 'X', qty: 7650, unit: 'Kg', rate: 5300 });
  eq('  a rate that LOOKS per Ton is not guessed per Ton without a value to reconcile: per Kg + flagged', [c.rateUnit, !!c._review], ['Kg', true]);

  /* A legacy sheet (no unit column) is unchanged: per the qty, no flag. */
  const l = row({ date: '2026-08-09', party: 'X', qty: 20, rate: 5000 });
  ok(l.unit === undefined && l.rateUnit === undefined && !l._review && amount(l) === 100000, '  a sheet with no unit column stays legacy — 20 × ₹5,000 = ₹1,00,000, no flag');
}

/* ══════════ 2. buildRow — a total IS a value to reconcile against ══════════ */
{
  const b = row({ date: '2026-08-09', party: 'X', qty: 7650, unit: 'Kg', rate: 5.30, total: 42572.25 });
  eq('IMPORT: total ₹42,572.25 with no taxable → taxable ₹40,545 derived FIRST, rate reconciles per Kg', [b.rate, b.rateUnit, amount(b)], [5.3, 'Kg', 40545]);
  ok(!b._review, '  and nothing to flag — the total verified it');
  const t = row({ date: '2026-08-09', party: 'X', qty: 7650, unit: 'Kg', rate: 5300, total: 42572.25 });
  eq('  the same total with rate 5300 reconciles per Ton', [t.rate, t.rateUnit, amount(t)], [5300, 'Ton', 40545]);
  const g = row({ date: '2026-08-09', party: 'X', qty: 7650, unit: 'Kg', rate: 5.30, total: 47842.20, gstr: 18 });
  eq('  the derivation uses the row\'s own GST % (18% → ₹40,545)', [g.rateUnit, amount(g)], ['Kg', 40545]);
}

/* ══════════ 3. buildRow — an explicit "Rate per" column decides ══════════ */
{
  const d = row({ date: '2026-08-09', party: 'X', qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Ton' });
  eq('IMPORT: "Rate per" = Ton with no taxable → per Ton, ₹40,545, no flag', [d.rateUnit, amount(d), !!d._review], ['Ton', 40545, false]);
  const e = row({ date: '2026-08-09', party: 'X', qty: 7650, unit: 'Kg', rate: 5.30, rateUnit: 'Kg' });
  eq('  "Rate per" = Kg → per Kg, ₹40,545, no flag', [e.rateUnit, amount(e), !!e._review], ['Kg', 40545, false]);
  const f = row({ date: '2026-08-09', party: 'X', qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Kg', taxable: 40545 });
  eq('  a "Rate per" the taxable contradicts: the taxable wins — rate re-derived per the sheet\'s unit (₹5.30 / Kg = ₹40,545)', [f.rate, f.rateUnit, amount(f)], [5.3, 'Kg', 40545]);
  ok(cfg.fields.some(x => x.key === 'rateUnit' && x.label === 'Rate per'), '  the mapper offers a "Rate per" field');
  const m = cfg.autoMap(['Invoice No', 'Date', 'Party', 'Qty', 'Unit', 'Rate per', 'Rate', 'GST %']);
  eq('  autoMap finds "Rate per" (5) and does NOT let the plain Rate match land on it (6)', [m.rateUnit, m.rate, m.unit], [5, 6, 4]);
  const m2 = cfg.autoMap(['Date', 'Party', 'Qty', 'Unit', 'Rate', 'Taxable']);
  eq('  a sheet without one maps rateUnit to -1 and Rate normally', [m2.rateUnit, m2.rate], [-1, 4]);
}

/* ══════════ 4. add() + done() — the flag is COUNTED and SEEN, never stored ══════════ */
{
  const a = row({ inv: 'FLAG-1', date: '2026-08-09', party: 'X', qty: 7650, unit: 'Kg', rate: 5.30 });
  const before = Q.state.SALES.length;
  cfg.add(a);
  const saved = Q.state.SALES[Q.state.SALES.length - 1];
  ok(Q.state.SALES.length === before + 1 && saved.inv === 'FLAG-1', 'a flagged row still imports');
  ok(!('_review' in saved), '  but the review note is the importer\'s, not the record\'s — not stored');
  eq('  and it is stored per Kg at ₹40,545', [saved.rateUnit, Q.saleTaxable(saved)], ['Kg', 40545]);
  toasts.length = 0; cfg.done(1);
  ok(toasts.some(t => /^1 invoice booked per Kg/.test(t) && /confirm the rate unit/.test(t)), '  done() toasts the review COUNT: "' + toasts[0] + '"');
  toasts.length = 0; cfg.done(0);
  ok(!toasts.some(t => /booked per/.test(t)), '  and the count resets — a second done() does not repeat it');
}

/* ══════════ 5. Duplicate — the copy prices EXACTLY like the original ══════════ */
{
  /* A row written before rate units existed: unit Kg, rate per Kg (no rateUnit). */
  Q.state.SALES.push({ inv: 'LEG-KG', date: '2026-08-05', party: 'AZIZ CHEMICALS', qty: 7650, unit: 'Kg', rate: 5300, gstR: 5, status: 'pending' });
  const idx = Q.state.SALES.length - 1;
  eq('a legacy Kg row with no rateUnit prices per Kg: ₹4,05,45,000', Q.saleTaxable(Q.state.SALES[idx]), 40545000);
  vm.runInContext('dupInv(' + JSON.stringify({ idx }) + ')', ctx);
  const copy = Q.state.SALES[Q.state.SALES.length - 1];
  eq('DUPLICATE: the copy is LEG-KG-COPY', copy.inv, 'LEG-KG-COPY');
  eq('  and prices EXACTLY like the original — ₹4,05,45,000, not ₹40,545', Q.saleTaxable(copy), Q.saleTaxable(Q.state.SALES[idx]));
  eq('  because it was added with an EXPLICIT rateUnit \'\' (per its own unit)', copy.rateUnit, '');
  eq('  qty, unit, rate carried as-is; status pending, nothing paid', [copy.qty, copy.unit, copy.rate, copy.status, copy.paid, copy.payments], [7650, 'Kg', 5300, 'pending', 0, []]);

  /* A modern row keeps its rateUnit. */
  Q.addSale({ inv: 'MOD-KG', date: '2026-08-06', party: 'AZIZ CHEMICALS', qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Ton', gstR: 5, status: 'pending' });
  const mi = Q.state.SALES.length - 1;
  vm.runInContext('dupInv(' + JSON.stringify({ idx: mi }) + ')', ctx);
  const mc = Q.state.SALES[Q.state.SALES.length - 1];
  eq('  a per-Ton row duplicates per Ton — ₹40,545 both', [mc.rateUnit, Q.saleTaxable(mc), Q.saleTaxable(Q.state.SALES[mi])], ['Ton', 40545, 40545]);

  const src = fs.readFileSync(path.join(__dirname, 'sales.js'), 'utf8');
  ok(/function dupInv\(r\) \{[^\n]*rateUnit: s\.rateUnit \|\| ''/.test(src), '  pinned in source: dupInv passes rateUnit: s.rateUnit || \'\'');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
