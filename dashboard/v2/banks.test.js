/* banks.test.js — loads the REAL data.js in a mocked browser env and tests the
   multi-bank BANK_ACCOUNTS store: CRUD, normalisation, archive semantics,
   blob persistence round-trip, legacy-blob hydration and the relational
   mirror hook. Run: node banks.test.js */
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

// Capture the fire-and-forget relational mirror.
const mirrored = [];
global.QLReconAPI = { mirrorAccount: (co, acc) => mirrored.push({ co, acc: { ...acc } }), mirror() {}, pull: async () => null, ready: () => true };

require('./data.js');
const Q = global.QLD;
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };

/* ── add: normalisation + defaults ── */
const a1 = Q.addBankAccount({ bank: '  Bank of Baroda ', acctNo: '3358 0500 001254', ifsc: 'barb0mertac', type: 'current', openingBalance: '125000.50', openingDate: '2025-04-01' });
ok('add returns the account', !!a1 && !!a1.id);
ok('id has BA prefix', /^BA\d+/.test(a1.id));
ok('bank trimmed', a1.bank === 'Bank of Baroda');
ok('acctNo despaced', a1.acctNo === '33580500001254');
ok('IFSC uppercased', a1.ifsc === 'BARB0MERTAC');
ok('label auto-generated from bank + last4', a1.label === 'Bank of Baroda ··1254');
ok('openingBalance numeric', a1.openingBalance === 125000.5);
ok('not archived on create', a1.archived === false);

const a2 = Q.addBankAccount({ bank: 'ICICI', label: 'ICICI CC', type: 'cc_od' });
ok('explicit label kept', a2.label === 'ICICI CC');
ok('cc_od type kept', a2.type === 'cc_od');
const a3 = Q.addBankAccount({ bank: 'HDFC', type: 'bogus-type' });
ok('unknown type falls back to current', a3.type === 'current');

/* ── rows / lookup ── */
ok('bankAccounts lists 3', Q.bankAccounts().length === 3);
ok('bankAccountById finds', Q.bankAccountById(a2.id).label === 'ICICI CC');
ok('bankAccountLabel resolves', Q.bankAccountLabel(a1.id) === 'Bank of Baroda ··1254');
ok('bankAccountLabel empty for unknown', Q.bankAccountLabel('nope') === '');

/* ── update: partial patch must not wipe other fields ── */
Q.updateBankAccount(a1.id, { label: 'BOB Current — Gotan' });
const u1 = Q.bankAccountById(a1.id);
ok('update sets label', u1.label === 'BOB Current — Gotan');
ok('update keeps bank', u1.bank === 'Bank of Baroda');
ok('update keeps acctNo', u1.acctNo === '33580500001254');
ok('update keeps openingBalance', u1.openingBalance === 125000.5);
ok('update of unknown id returns null', Q.updateBankAccount('nope', { label: 'x' }) === null);

/* ── archive / restore ── */
Q.setBankAccountArchived(a3.id, true);
ok('archived hidden from default list', Q.bankAccounts().length === 2);
ok('archived visible with includeArchived', Q.bankAccounts(true).length === 3);
ok('archived flag set', Q.bankAccountById(a3.id).archived === true);
Q.setBankAccountArchived(a3.id, false);
ok('restore brings it back', Q.bankAccounts().length === 3);

/* ── persistence: blob round-trip via saveLocal → loadLocal ── */
Q.saveLocal();
const saved = JSON.parse(store[Object.keys(store).find(k => k.startsWith('ql_data_'))]);
ok('blob carries bankAccounts', Array.isArray(saved.bankAccounts) && saved.bankAccounts.length === 3);
Q.init(() => {});   // public reload path: runs loadLocal synchronously
ok('loadLocal rehydrates accounts', Q.bankAccounts().length === 3 && Q.bankAccountById(a2.id).label === 'ICICI CC');

/* ── legacy blob without bankAccounts key must not crash (no regression) ── */
const key = Object.keys(store).find(k => k.startsWith('ql_data_'));
const legacy = JSON.parse(store[key]); delete legacy.bankAccounts;
store[key] = JSON.stringify(legacy);
Q.init(() => {});   // public reload path: runs loadLocal synchronously
ok('legacy blob → zero accounts, no crash', Q.bankAccounts().length === 0);
ok('other stores intact after legacy load', Array.isArray(Q.salesRows()));

/* ── audit trail + mirror hook ── */
Q.addBankAccount({ bank: 'SBI', label: 'SBI Savings', type: 'savings' });
const audits = Q.auditRows().filter(r => r.module === 'bank_account');
ok('audit rows written for bank ops', audits.length >= 1);
ok('mirrorAccount called on create/update', mirrored.length >= 4);
ok('mirror payload has id+bank', !!mirrored[0].acc.id && mirrored[0].acc.bank === 'Bank of Baroda');
ok('mirror scoped to active company', mirrored[0].co === 'co1');

console.log('\n════ multi-bank accounts (Phase 1) ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' BANK TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
