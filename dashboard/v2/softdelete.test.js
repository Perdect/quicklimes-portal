/* softdelete.test.js — loads the REAL data.js in a mocked browser env and tests
   the soft-delete / trash / restore / purge / audit service. Run: node softdelete.test.js */
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = '' + v; }, removeItem: k => { delete store[k]; } };
global.location = { hash: '', hostname: 'localhost', pathname: '/', search: '', replace() {}, href: '' };
global.history = { replaceState() {} };
global.navigator = { userAgent: 'node-test' };
global.document = { addEventListener() {}, createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
global.setTimeout = (fn) => 0;   // skip debounced cloud saves
global.window = global;
localStorage.setItem('ql_plant', JSON.stringify({ id: 'co1', plants: [{ id: 'co1', plant_name: 'Test Co' }], token: 't', role: 'owner', user: { name: 'Tester', role: 'owner' } }));
localStorage.setItem('dm_active_co', 'co1');
global.supabase = { createClient: () => ({ rpc: async () => ({ data: null, error: 'offline' }) }) };

require('./data.js');
const Q = global.QLD;
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };

// seed two invoices
Q.addSale({ inv: 'S-1', date: '2026-06-01', party: 'ARIF', qty: 10, rate: 100, gstR: 5, product: 'Quick Lime' });
Q.addSale({ inv: 'S-2', date: '2026-06-02', party: 'AMAN', qty: 5, rate: 200, gstR: 5, product: 'Quick Lime' });
ok('2 active sales after add', Q.salesRows().length === 2);
ok('trash empty initially', Q.trashCount() === 0);

// soft-delete S-1 (raw idx 0)
const d = Q.deleteSale(0, 'entered twice');
ok('softDelete returns ok', d && d.ok === true);
ok('active sales now 1 (S-1 hidden)', Q.salesRows().length === 1);
ok('remaining active is S-2', Q.salesRows()[0].inv === 'S-2');
ok('trash count 1', Q.trashCount() === 1);
const tr = Q.trashRows();
ok('trash row is sales', tr[0] && tr[0].module === 'sales');
ok('trash row ref S-1', tr[0].ref === 'S-1');
ok('trash reason recorded', tr[0].reason === 'entered twice');
ok('trash deletedBy = Tester', tr[0].deletedBy === 'Tester');
ok('trash daysLeft ~90', tr[0].daysLeft >= 89 && tr[0].daysLeft <= 90);
ok('audit has a trash entry', Q.auditRows().some(a => a.action === 'trash' && a.ref === 'S-1'));

// S-1 must NOT count in summary/totals (still hidden from all active views)
ok('salesSummary excludes trashed', Q.salesSummary().count === 1);

// restore S-1 (raw idx 0)
const r = Q.restoreRecord('sales', 0);
ok('restore ok', r && r.ok === true);
ok('restore no conflict (S-1 unique)', !r.conflict);
ok('active sales back to 2', Q.salesRows().length === 2);
ok('trash empty after restore', Q.trashCount() === 0);
ok('audit has restore entry', Q.auditRows().some(a => a.action === 'restore' && a.ref === 'S-1'));

// conflict detection: soft-delete S-2, add a NEW S-2, then restore → conflict
Q.deleteSale(1, '');                       // trash S-2 (idx 1)
Q.addSale({ inv: 'S-2', date: '2026-06-09', party: 'NEW', qty: 1, rate: 1, gstR: 5 });  // active dup ref
const r2 = Q.restoreRecord('sales', 1);
ok('restore flags duplicate ref', r2.ok && r2.conflict === 'S-2');

// PERMANENT-DELETE PROTECTION — financial records can't be purged
Q.deleteSale(0, 'purge me');               // trash S-1 again (idx 0)
const beforeS = Q.state.SALES.length;
const pBlocked = Q.purgeRecord('sales', 0);
ok('purge of a financial (sales) record is BLOCKED', pBlocked && pBlocked.ok === false && pBlocked.blocked === true);
ok('blocked purge does NOT remove the record', Q.state.SALES.length === beforeS);
Q.restoreRecord('sales', 0);               // bring S-1 back for later tests

// purge IS allowed for a non-financial record (worker)
Q.addWorker({ name: 'Ramu', wage: 500, freq: 'daily' });
const wi = Q.state.WORKERS.length - 1;
Q.deleteWorker(wi, 'left');
const beforeW = Q.state.WORKERS.length;
const pw = Q.purgeRecord('worker', wi);
ok('purge ok for non-financial (worker)', pw && pw.ok === true);
ok('worker physically removed', Q.state.WORKERS.length === beforeW - 1);
ok('audit has purge entry', Q.auditRows().some(a => a.action === 'purge'));

// VOID / CANCEL — posted financial record kept but marked Cancelled
const vIdx = Q.state.SALES.findIndex(s => s.inv === 'S-1');
const v = Q.voidRecord('sales', vIdx, 'wrong party');
ok('voidRecord returns ok', v && v.ok === true);
ok('voided record status is cancelled', Q.state.SALES[vIdx].status === 'cancelled');
ok('voided record keeps _void metadata + reason', Q.state.SALES[vIdx]._void && Q.state.SALES[vIdx]._void.reason === 'wrong party');
ok('voided invoice still EXISTS (not deleted)', !!Q.state.SALES[vIdx].inv);
ok('void logs an audit entry', Q.auditRows().some(a => a.action === 'void'));
ok('double-void is rejected', Q.voidRecord('sales', vIdx, 'again').ok === false);

// backup JSON is valid + contains data
let bk = null; try { bk = JSON.parse(Q.backupJSON()); } catch (_) {}
ok('backupJSON is valid JSON with data', !!(bk && bk.data && Array.isArray(bk.data.sales)));

// blob round-trip: trashed markers persist in the blob
Q.deleteSale(0, 'persist-test');
const blobHasDelMarker = Q.state.SALES.some(s => s._del);
ok('_del marker lives on the record (persists in blob)', blobHasDelMarker);

console.log('\n════ Soft-delete / Trash / Audit ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' SOFT-DELETE TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
