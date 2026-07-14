/* session-isolation.test.js — a new account signing in on a browser that holds
   another account's session must NEVER see the previous account's cached data.
   Reproduces the real bug: signup redirected with #auth=<new account>, but the
   handoff was only consumed when NO session existed — so the new user landed on
   the old account's dashboard with its localStorage caches. Run: node session-isolation.test.js */
let store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = '' + v; },
  removeItem: k => { delete store[k]; },
  key: i => Object.keys(store)[i],
  get length() { return Object.keys(store).length; }
};
global.location = { hash: '', hostname: 'localhost', pathname: '/', search: '', replace() {}, href: '' };
global.history = { replaceState() {} };
global.navigator = { userAgent: 'node-test' };
global.document = { addEventListener() {}, createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
global.setTimeout = (fn) => 0;
global.window = global;
global.supabase = { createClient: () => ({ rpc: async () => ({ data: null, error: 'offline' }) }) };
global.QLReconAPI = { mirrorAccount() {}, mirror() {}, pull: async () => null, ready: () => true };

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const b64 = o => Buffer.from(unescape(encodeURIComponent(JSON.stringify(o)))).toString('base64');
const freshBoot = () => { delete require.cache[require.resolve('./data.js')]; require('./data.js'); return global.QLD; };

const GOTAN = { id: 'plant-gotan', plants: [{ id: 'co-gotan', plant_name: 'Gotan Lime Industries' }], token: 'tG', role: 'owner', user: { name: 'Haji', role: 'owner' } };
const NEWCO = { id: 'plant-new', plants: [{ id: 'co-new', plant_name: 'Quick Limes' }], token: 'tN', role: 'owner', user: { name: 'New User', role: 'owner' } };

/* ── Scenario 1: the reported bug — signup #auth over an existing session ── */
store = {};
localStorage.setItem('ql_plant', JSON.stringify(GOTAN));
localStorage.setItem('dm_active_co', 'co-gotan');
localStorage.setItem('ql_data_co-gotan', JSON.stringify({ sales: [{ inv: 'S1', date: '2026-01-01', party: 'X', qty: 1, rate: 100 }], purchases: [], parties: [] }));
localStorage.setItem('ql_bill_aliases_co-gotan', '{"a":"b"}');
localStorage.setItem('dm_loans', '[{"name":"Old loan"}]');
localStorage.setItem('ql_BACKUP_20260713_deshwali', '{"keep":"me"}');
localStorage.setItem('ql_features', '{"people":true}');
location.hash = '#auth=' + b64(NEWCO);
let Q = freshBoot();
ok('S1: session switched to the NEW account', JSON.parse(store.ql_plant).id === 'plant-new');
ok('S1: previous account blob wiped', !('ql_data_co-gotan' in store));
ok('S1: previous bill aliases wiped', !('ql_bill_aliases_co-gotan' in store));
ok('S1: loans cache wiped', !('dm_loans' in store));
ok('S1: active-company pointer reset to the new firm', store.dm_active_co === 'co-new');
ok('S1: new company visible, not Gotan', Q.co && Q.co.short === 'Quick Limes');
Q.init(() => {});
ok('S1: dashboard state is EMPTY for the new account', Q.salesRows().length === 0 && Q.purchaseRows().length === 0);
ok('S1: explicit backups survive', store['ql_BACKUP_20260713_deshwali'] === '{"keep":"me"}');
ok('S1: device feature prefs survive', 'ql_features' in store);
ok('S1: cache-owner marker set', store.ql_cache_owner === 'plant-new');

/* ── Scenario 2: SAME account re-auths via #auth — caches must be KEPT ── */
store = {};
localStorage.setItem('ql_plant', JSON.stringify(GOTAN));
localStorage.setItem('ql_cache_owner', 'plant-gotan');
localStorage.setItem('dm_active_co', 'co-gotan');
localStorage.setItem('ql_data_co-gotan', JSON.stringify({ sales: [{ inv: 'S1', date: '2026-01-01', party: 'X', qty: 1, rate: 100 }], purchases: [], parties: [] }));
location.hash = '#auth=' + b64({ ...GOTAN, token: 'tG2' });   // fresh token, same account
Q = freshBoot();
ok('S2: same-account re-auth keeps the data cache', 'ql_data_co-gotan' in store);
ok('S2: token refreshed', JSON.parse(store.ql_plant).token === 'tG2');
Q.init(() => {});
ok('S2: data still loads', Q.salesRows().length === 1);

/* ── Scenario 3: login page writes ql_plant directly (no #auth hash) ── */
store = {};
localStorage.setItem('ql_plant', JSON.stringify(NEWCO));      // login already swapped the session
localStorage.setItem('ql_cache_owner', 'plant-gotan');        // ...but caches belong to Gotan
localStorage.setItem('ql_data_co-gotan', '{"sales":[{"inv":"S1"}]}');
localStorage.setItem('dm_active_co', 'co-gotan');
location.hash = '';
Q = freshBoot();
ok('S3: marker mismatch wipes the foreign cache', !('ql_data_co-gotan' in store));
ok('S3: marker updated to the new owner', store.ql_cache_owner === 'plant-new');
ok('S3: new firm active', Q.co && Q.co.short === 'Quick Limes');

/* ── Scenario 4: plain reload, same account, no hash — nothing is touched ── */
store = {};
localStorage.setItem('ql_plant', JSON.stringify(GOTAN));
localStorage.setItem('ql_cache_owner', 'plant-gotan');
localStorage.setItem('ql_data_co-gotan', JSON.stringify({ sales: [{ inv: 'S1', date: '2026-01-01', party: 'X', qty: 1, rate: 100 }], purchases: [], parties: [] }));
localStorage.setItem('dm_active_co', 'co-gotan');
location.hash = '';
Q = freshBoot();
Q.init(() => {});
ok('S4: normal reload keeps everything', Q.salesRows().length === 1 && ('ql_data_co-gotan' in store));

/* ── Scenario 5: malformed #auth is ignored, session survives ── */
store = {};
localStorage.setItem('ql_plant', JSON.stringify(GOTAN));
localStorage.setItem('ql_cache_owner', 'plant-gotan');
localStorage.setItem('ql_data_co-gotan', '{"sales":[]}');
location.hash = '#auth=%%%garbage%%%';
Q = freshBoot();
ok('S5: garbage hash ignored — session intact', JSON.parse(store.ql_plant).id === 'plant-gotan');
ok('S5: caches intact', 'ql_data_co-gotan' in store);

console.log('\n════ session isolation (new account vs cached data) ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' ISOLATION TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
