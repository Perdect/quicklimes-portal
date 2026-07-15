/* party-wiring.test.js — proves the REAL screens group by identity.
 *
 * party-identity.test.js proves the module is correct. That is not the same as
 * proving the app CALLS it: the reported bug lived in nine call sites, and a
 * perfect helper nobody invokes fixes nothing. So this loads the actual data.js
 * in a mocked browser, seeds the exact bill set from the user's screenshot, and
 * asserts the aggregates the dashboards render.
 *
 * Fixture = the real report: GSTIN 08AIUPB9022D1ZB billed under two spellings,
 * ₹7,42,642 + ₹2,64,767, shown as two rows.
 *
 *   node party-wiring.test.js
 */
'use strict';
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = '' + v; }, removeItem: k => { delete store[k]; } };
global.location = { hash: '', hostname: 'localhost', pathname: '/', search: '', replace() {}, href: '' };
global.history = { replaceState() {} };
global.navigator = { userAgent: 'node-test' };
global.document = { addEventListener() {}, createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
global.setTimeout = () => 0;
global.window = global;
localStorage.setItem('ql_plant', JSON.stringify({ id: 'co1', plants: [{ id: 'co1', plant_name: 'Gotan Lime' }], token: 't', role: 'owner', user: { name: 'T', role: 'owner' } }));
localStorage.setItem('dm_active_co', 'co1');
global.supabase = { createClient: () => ({ rpc: async () => ({ data: null, error: 'offline' }) }) };

/* data.js resolves QLParty lazily; in the browser it is a <script> global. Mirror
   that here rather than letting it fall through to the degraded fallback — the
   point is to test what the browser actually runs. */
global.QLParty = require('./party-identity.js');

require('./data.js');
const Q = global.QLD;

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ party grouping · wired through the REAL data.js ═══\n');

/* The screenshot, as data. */
Q.state.PURCHASES = [
  { id: 'p1', sup: 'RAMKARAN AND SONS', gstin: '08AIUPB9022D1ZB', date: '2025-12-31', taxable: 707278, gstR: 5, status: 'pending', paid: 0 },
  { id: 'p2', sup: 'Ramkaran and Sons', gstin: '08AIUPB9022D1ZB', date: '2026-02-28', taxable: 126079, gstR: 5, status: 'pending', paid: 0 },
  { id: 'p3', sup: 'Ramkaran and Sons', gstin: '08AIUPB9022D1ZB', date: '2026-01-15', taxable: 126079, gstR: 5, status: 'pending', paid: 0 },
  // Rule 2 control: same name, different state registration — must NOT merge.
  { id: 'p4', sup: 'Indian Oil Corporation Limited', gstin: '24AAACI1681G1ZV', date: '2026-06-23', taxable: 800000, gstR: 18, status: 'pending', paid: 0 },
  { id: 'p5', sup: 'Indian Oil Corporation Limited', gstin: '08AAACI1681G1Z9', date: '2026-06-20', taxable: 100000, gstR: 18, status: 'pending', paid: 0 }
];

/* Supplier payables — the exact table from the screenshot, via the real report
   builder the Payables page and Reports Hub both render. Row shape:
   ['Supplier', 'Bills', 'Outstanding', 'Oldest', 'Days']. */
const pay = Q.buildReport('outstanding');
const ram = pay.rows.filter(r => /ramkaran/i.test(r[0]));
ok('THE REPORTED BUG: Ramkaran appears ONCE in payables, not twice', ram.length === 1);
ok('  its 3 bills are counted together', ram[0] && ram[0][1] === 3);
const ramTotal = Q.purchaseRows().filter(r => /ramkaran/i.test(r.sup)).reduce((a, r) => a + r.outstanding, 0);
ok('  outstanding is the FULL amount, not a fragment', ram[0] && Math.abs(ram[0][2] - ramTotal) < 1);
ok('  the label is a real name, never the internal key', ram[0] && !/^[GN]:/.test(ram[0][0]));

const ioc = pay.rows.filter(r => /indian oil/i.test(r[0]));
ok('two Indian Oil GST registrations stay SEPARATE (different states, different payables)', ioc.length === 2);

const supKpi = pay.kpis.find(k => k[0] === 'Suppliers');
ok('the "Suppliers" count is 3 (Ramkaran + 2 IOC), not the inflated 4', supKpi && supKpi[1] === 3);

/* Customer side: the same fix must hold for receivables/collections. */
Q.state.SALES = [
  { id: 's1', party: 'Shree Cement Ltd', gstin: '08AABCS1429B1ZW', date: '2026-05-01', qty: 100, rate: 10, gstR: 5, status: 'pending', paid: 0 },
  { id: 's2', party: 'SHREE CEMENT LTD', gstin: '08AABCS1429B1ZW', date: '2026-05-10', qty: 50, rate: 10, gstR: 5, status: 'pending', paid: 0 }
];
const col = Q.buildReport('collections');
const shree = col.rows.filter(r => /shree/i.test(r[0]));
ok('customer side: two spellings of one GSTIN → ONE debtor', shree.length === 1);
ok('  both invoices counted against them', shree[0] && shree[0][1] === 2);
const custKpi = col.kpis.find(k => k[0] === 'Customers');
ok('the "Customers" count is not inflated by a spelling', custKpi && custKpi[1] === 1);

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
