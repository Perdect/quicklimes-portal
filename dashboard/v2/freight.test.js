/* freight.test.js — freight payments on a purchase bill (multi-bank aware).
   Loads the REAL data.js in a mocked browser env. Run: node freight.test.js */
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = '' + v; }, removeItem: k => { delete store[k]; } };
global.location = { hash: '', hostname: 'localhost', pathname: '/', search: '', replace() {}, href: '' };
global.history = { replaceState() {} };
global.navigator = { userAgent: 'node-test' };
global.document = { addEventListener() {}, createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
global.setTimeout = (fn) => 0;
global.window = global;
localStorage.setItem('ql_plant', JSON.stringify({ id: 'co1', plants: [{ id: 'co1', plant_name: 'Test Co' }], token: 't', role: 'owner', user: { name: 'Tester', role: 'owner' } }));
localStorage.setItem('dm_active_co', 'co1');
global.supabase = { createClient: () => ({ rpc: async () => ({ data: null, error: 'offline' }) }) };
global.QLReconAPI = { mirrorAccount() {}, mirror() {}, pull: async () => null, ready: () => true };

require('./data.js');
const Q = global.QLD;
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };

const hdfc = Q.addBankAccount({ bank: 'HDFC Bank', label: 'HDFC Current' });

/* ── a petcoke bill: 32.76 MT @ 12380, 18% GST ── */
Q.addPurchase({ bill: 'PK-1', date: '2025-12-10', sup: 'Indian Oil Corporation Limited', taxable: 405568.8, grate: 18, qty: 32.76, rate: 12380, itc: 'Eligible', cat: 'Petcoke' });
const pi = Q.state.PURCHASES.findIndex(p => p.bill === 'PK-1');
const row0 = Q.purchaseRows().find(r => r.bill === 'PK-1');
ok('no freight initially', row0.freightAmt === 0 && row0.freightPays.length === 0);

/* ── cash freight to the driver ── */
const f1 = Q.addFreightPayment(pi, { amount: 45000, method: 'Cash', paidTo: 'Ramesh Transport', veh: 'rj19gd9095', date: '2025-12-10' });
ok('freight entry created with id', !!f1 && /^fr\d+/.test(f1.id));
ok('vehicle uppercased', f1.veh === 'RJ19GD9095');
let row = Q.purchaseRows().find(r => r.bill === 'PK-1');
ok('freightAmt = payment sum', row.freightAmt === 45000);
ok('freightAddon rolls into landed cost', row.freightAddon === 45000);
ok('freightPays exposed on the row', row.freightPays.length === 1);

/* ── second freight leg by bank, tagged with the account ── */
Q.addFreightPayment(pi, { amount: 5000, method: 'Bank', accountId: hdfc.id, paidTo: 'Toll/loading', date: '11-Dec-25' });
row = Q.purchaseRows().find(r => r.bill === 'PK-1');
ok('two freight payments sum', row.freightAmt === 50000);
const cb = Q.paymentsLedger().filter(e => e.ptype === 'Freight');
ok('each freight posts one ledger row', cb.length === 2);
ok('ledger rows are debits linked to the bill', cb.every(e => e.debit > 0 && e.link && e.link.kind === 'purchase' && e.link.idx === pi));
ok('online freight carries the bank account', cb.some(e => e.accountId === hdfc.id && e.account === 'HDFC Current'));
ok('cash freight has no account (no fabrication)', cb.some(e => e.accountId === ''));
ok('freight date normalised to ISO', row.freightPays[1].date === '2025-12-11');

/* ── landed cost math ── */
const landed = row.total + row.freightAddon;
ok('landed = bill total + freight', Math.round(landed) === Math.round(row.total + 50000));
ok('bill GST untouched by freight', Math.round(row.gst) === Math.round(405568.8 * 0.18));

/* ── group roll-up includes payment-driven freight ── */
const grp = Q.purchaseByGroup().find(g => g.key === 'petcoke');
ok('petcoke group landed total includes freight', Math.round(grp.total) === Math.round(row.total + 50000));
ok('group freight metric counts it', grp.freight === 50000);

/* ── legacy manual freightAmt still works when no payments exist ── */
Q.addPurchase({ bill: 'PK-2', date: '2025-12-12', sup: 'IOC', taxable: 100000, grate: 18, qty: 10, cat: 'Petcoke', freightAmt: 7000 });
const r2 = Q.purchaseRows().find(r => r.bill === 'PK-2');
ok('manual freightAmt honoured without payments', r2.freightAmt === 7000 && r2.freightAddon === 7000);

/* ── payments supersede the manual number (no double count) ── */
const p2 = Q.state.PURCHASES.findIndex(p => p.bill === 'PK-2');
Q.addFreightPayment(p2, { amount: 8000, method: 'UPI', date: '2025-12-12' });
const r2b = Q.purchaseRows().find(r => r.bill === 'PK-2');
ok('payments win over manual freightAmt', r2b.freightAmt === 8000 && r2b.freightAddon === 8000);

/* ── delete: entry gone, ledger row soft-deleted (Trash), bill untouched ── */
const before = Q.paymentsLedger().filter(e => e.ptype === 'Freight').length;
ok('delete returns true', Q.deleteFreightPayment(pi, f1.id) === true);
row = Q.purchaseRows().find(r => r.bill === 'PK-1');
ok('freight entry removed from the bill', row.freightPays.length === 1 && row.freightAmt === 5000);
ok('ledger row soft-deleted (hidden from ledger)', Q.paymentsLedger().filter(e => e.ptype === 'Freight').length === before - 1);
ok('soft-deleted row is in Trash, not purged', Q.trashRows().some(t => t.module === 'payment'));
ok('bill totals untouched by delete', Math.round(row.total) === Math.round(405568.8 * 1.18));
ok('deleting unknown id is a no-op', Q.deleteFreightPayment(pi, 'nope') === false);

/* ── invalid adds are rejected ── */
ok('zero amount rejected', Q.addFreightPayment(pi, { amount: 0 }) === null);
ok('bad index rejected', Q.addFreightPayment(999, { amount: 100 }) === null);

/* ── audit trail ── */
ok('freight ops audit-logged', Q.auditRows().filter(a => a.module === 'freight').length >= 3);

/* ══ LANDED COST — what the material actually cost ══
   Asked for on 2026-07-15: "add fright amount with total amount". The register's
   headline column is now Landed cost, so this number is read by a human making
   pricing decisions and must not be off by a rupee.

   `landed` is DERIVED and never replaces `total`: `total` is the invoice value —
   what is owed to THIS supplier — and payments, outstanding and bank matching all
   key on it. The freight is owed to the transporter, a different party. */
const L = () => Q.purchaseRows().find(r => r.bill === 'PK-1');
const lr = L();
ok('landed = bill total + the freight paid on it', Math.abs(lr.landed - (lr.total + lr.freightAddon)) < 0.01);
ok('...and it is strictly more than the bill once freight is paid', lr.freightAddon > 0 && lr.landed > lr.total);
ok('...the bill total itself is untouched — it is what the supplier is owed',
  Math.abs(lr.total - (405568.8 + 405568.8 * 0.18)) < 1);
ok('...landed is a real number, never NaN', typeof lr.landed === 'number' && !isNaN(lr.landed));

/* A bill with NO freight: landed must equal the bill, not the bill plus nothing-shaped-like-undefined */
Q.addPurchase({ bill: 'NF-1', date: '2025-12-11', sup: 'Some Vendor', taxable: 10000, grate: 18, itc: 'Eligible', cat: 'Other' });
const nf = Q.purchaseRows().find(r => r.bill === 'NF-1');
ok('a bill with no freight has landed === total', nf.landed === nf.total && nf.landed > 0);

/* THE DOUBLE-COUNT TRAP: on a bill that IS a freight bill, the transport is the
   purchase — the amount already sits inside `total`. Adding freightAmt again
   would overstate what the firm spent, and it would do it silently. */
Q.addPurchase({ bill: 'FR-1', date: '2025-12-12', sup: 'Nagour Golden Transport', taxable: 55233, grate: 5, itc: 'Eligible', cat: 'Freight', item: 'Freight' });
const fr = Q.purchaseRows().find(r => r.bill === 'FR-1');
if (fr.freight && fr.freightAddon === 0) {
  ok('a freight BILL is not double-counted — landed === total', fr.landed === fr.total);
  ok('...its whole value is freight', fr.freightAmt > 0);
} else { ok('freight-item bill classified as a freight bill (freightAddon 0)', false); }

/* The trap only springs when a freight bill ALSO carries a freight amount — a
   transporter's own invoice with a freight figure entered on it. freightAmt is
   then the bill's whole taxable, so adding it to the total would bill the firm
   for the same transport twice. FR-1 above cannot catch this: with no freight
   payments its addon is 0 either way, so the bug hides. */
Q.addPurchase({ bill: 'FR-2', date: '2025-12-13', sup: 'Nagour Golden Transport', taxable: 55233, grate: 5, itc: 'Eligible', cat: 'Freight', item: 'Freight', freightAmt: 55233 });
const fr2 = Q.purchaseRows().find(r => r.bill === 'FR-2');
ok('a freight bill carrying a freight amount still has no add-on', fr2.freightAddon === 0);
ok('...so its landed cost is the bill, not twice the transport', fr2.landed === fr2.total);
ok('...and the transport is not counted twice', fr2.landed < fr2.total + fr2.freightAmt);

/* Deleting the freight payments must walk landed back down — a stale landed cost
   is worse than none, because it is believed. */
const landedBefore = L().landed;
(L().freightPays || []).slice().forEach(f => { if (Q.deleteFreightPayment) Q.deleteFreightPayment(pi, f.id); });
const after = L();
if (Q.deleteFreightPayment) {
  ok('removing every freight payment returns landed to the bill total', after.landed === after.total);
  ok('...and that is a real change from before', landedBefore > after.landed);
}

console.log('\n════ freight payments on purchase bills ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' FREIGHT TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
