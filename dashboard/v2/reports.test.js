/* reports.test.js — loads the REAL data.js in a mocked browser env and tests
   QLD.buildReport: date-range filtering, cancelled/void exclusion, GST/P&L
   date-scoping, and supplier-vs-customer outstanding. Run: node reports.test.js */
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
require('./data.js');
const Q = global.QLD;
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const near = (a, b) => Math.abs(a - b) <= 1;

// Two months of sales; one JUNE invoice VOIDED (must be excluded everywhere).
Q.addSale({ inv: 'S-MAY', date: '2026-05-10', party: 'ARIF', qty: 10, rate: 1000, gstR: 5, gstin: '08ARIF0000A1Z0', product: 'Quick Lime' }); // taxable 10000, gst 500
Q.addSale({ inv: 'S-JUN1', date: '2026-06-10', party: 'AMAN', qty: 10, rate: 2000, gstR: 5, gstin: '08AMAN0000A1Z0', product: 'Quick Lime' }); // taxable 20000, gst 1000
Q.addSale({ inv: 'S-JUN2', date: '2026-06-20', party: 'KIRTI', qty: 5, rate: 1000, gstR: 5, gstin: '24KIRT0000A1Z0', product: 'Quick Lime' }); // taxable 5000, gst 250 (INTER-state, 24)
// void S-JUN2
const vi = Q.state.SALES.findIndex(s => s.inv === 'S-JUN2');
Q.voidRecord('sales', vi, 'test void');

// Purchases: one MAY, one JUNE.
Q.addPurchase({ bill: 'P-MAY', date: '2026-05-05', sup: 'RELIANCE', gstin: '24REL0000A1Z0', taxable: 8000, grate: 18, itc: 'Eligible', status: 'pending' }); // gst 1440 itc 1440
Q.addPurchase({ bill: 'P-JUN', date: '2026-06-05', sup: 'IOC', gstin: '24AAACI1681G1ZV', taxable: 4000, grate: 18, itc: 'Eligible', status: 'pending' }); // gst 720 itc 720

const JUN = { from: '2026-06-01', to: '2026-06-30' };

// ── SALES report, June range ──
const rs = Q.buildReport('sales', JUN.from, JUN.to);
ok('sales(June) excludes May + the voided June invoice → 1 row', rs.count === 1);
ok('sales(June) only S-JUN1 present', rs.rows[0][0] === 'S-JUN1');
ok('sales(June) taxable total = 20000 (voided 5000 excluded)', near(rs.totals[6], 20000));
const rsAll = Q.buildReport('sales', null, null);
ok('sales(all) still excludes voided → 2 rows (May+Jun1)', rsAll.count === 2);

// ── GST report, June range: output = S-JUN1 gst 1000 (intra → CGST 500/SGST 500), ITC = P-JUN 720 ──
const g = Q.buildReport('gst', JUN.from, JUN.to);
const gRow = lbl => (g.rows.find(r => r[0] === lbl) || [])[1];
ok('gst(June) CGST = 500', near(gRow('CGST (output)'), 500));
ok('gst(June) SGST = 500', near(gRow('SGST (output)'), 500));
ok('gst(June) IGST = 0 (voided inter-state excluded)', near(gRow('IGST (output)'), 0));
ok('gst(June) output GST = 1000', near(gRow('Total output GST'), 1000));
ok('gst(June) ITC = 720 (only P-JUN)', near(gRow('Less: Input tax credit'), -720));
ok('gst(June) net payable = 280', near(gRow('Net GST payable'), 280));

// ── P&L report, June range: rev 20000, cogs 4000, gp 16000 ──
const pl = Q.buildReport('pl', JUN.from, JUN.to);
const plRow = lbl => (pl.rows.find(r => r[0] === lbl) || [])[1];
ok('pl(June) revenue = 20000', near(plRow('Revenue (taxable)'), 20000));
ok('pl(June) material cost = -4000', near(plRow('Less: Material cost'), -4000));
ok('pl(June) gross profit = 16000', near(plRow('Gross profit'), 16000));

// ── OUTSTANDING = supplier payables (not customer collections) ──
const out = Q.buildReport('outstanding', null, null);
ok('outstanding lists SUPPLIERS', out.headers[0] === 'Supplier');
ok('outstanding includes RELIANCE + IOC', out.rows.some(r => r[0] === 'RELIANCE') && out.rows.some(r => r[0] === 'IOC'));
const coll = Q.buildReport('collections', null, null);
ok('collections lists CUSTOMERS (distinct from outstanding)', coll.headers[0] === 'Customer');

// ── topsuppliers excludes nothing wrong; topcustomers excludes voided ──
const tc = Q.buildReport('topcustomers', JUN.from, JUN.to);
ok('topcustomers(June) excludes voided KIRTI', !tc.rows.some(r => r[1] === 'KIRTI'));

console.log('\n════ Reports Hub — buildReport ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' REPORT TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
