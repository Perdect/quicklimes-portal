/* blob.test.js — every store must survive save→reload, and must not leak
   between companies.
   Run: node blob.test.js

   THE BUG THIS CATCHES (shipped for real on 2026-07-15, found the same day):
   blob() is an explicit WHITELIST of what gets written to localStorage and the
   cloud. The WhatsApp store was added to the app, used as the reminder DEDUPE
   MEMORY, and never added to blob() — so it died on every reload. The comment
   in data.js even claimed it "rides inside the per-company blob and syncs like
   everything else". It didn't. Lose that log and a customer is chased twice for
   the same invoice — the one thing the reminder engine exists to prevent.

   A store must be in THREE places or it is broken in a way no page reveals:
     blob()       — or it is never saved
     hydrate()    — or it is never restored
     clearState() — or it LEAKS into the next company you open

   This EXECUTES the real functions out of data.js and round-trips actual data.
   An earlier version only grep'd for the store's name, and a mutation test
   showed that was theatre: `if (false) S.WA = { cfg: d.wa.cfg }` still contains
   the string "d.wa" and passed. Behaviour, not text. */

const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/data.js', 'utf8');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), a === b);

/* Pull the REAL S declaration + the three real functions. Never a copy. */
function grab(startsWith, endsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) throw new Error('not found in data.js: ' + startsWith);
  const j = src.indexOf(endsWith, i);
  return src.slice(i, j + endsWith.length);
}
const S_DECL = grab('const S = {', '\n  };');
const F_BLOB = grab('function blob(includePic)', '\n  }');
const F_HYDR = grab('function hydrate(d)', '\n  }');
const F_CLEAR = grab('function clearState()', '\n  }');

const ctx = {
  // Only what these three functions touch. Stubs, so a change to unrelated code
  // can never break this test.
  localStorage: { getItem: () => null },
  defaultFinance: () => ({ accounts: [] }),
  normalizeFinance: f => f,
  console,
};
vm.createContext(ctx);
vm.runInContext([S_DECL, F_BLOB, F_HYDR, F_CLEAR,
  'this.S = S; this.blob = blob; this.hydrate = hydrate; this.clearState = clearState;'].join('\n'), ctx);
ok('data.js S + blob + hydrate + clearState loaded and executable', typeof ctx.blob === 'function');

/* One representative row per store, so a lost store is visible by name. */
const SAMPLE = {
  SALES: [{ inv: 'S1' }], PURCHASES: [{ bill: 'P1' }], WORKERS: [{ name: 'W' }],
  WORK_LOG: [{ d: 1 }], TDS: [{ t: 1 }], CHALLANS: [{ c: 1 }], PARTIES: [{ name: 'ARIF' }],
  CASHBOOK: [{ id: 'cb1' }], CHUNNA: [{ c: 1 }], PROD: [{ p: 1 }], AUDIT: [{ a: 1 }],
  REFUNDS: [{ r: 1 }], BANK_ACCOUNTS: [{ id: 'A1' }],
  // Manufacturing expense — the costing system reads production cost from
  // this store; losing it on reload silently zeroes every cost/T.
  EXPENSES: [{ id: "EX1", date: "2026-06-12", group: "production", sub: "Electricity", amount: 12000, treatment: "direct-production" }],
  // Statement upload history — per bank account. Without it a bank card
  // cannot say when it was last updated and a re-upload cannot be detected.
  STATEMENTS: [{ id: 'ST1', accountId: 'A1', file: 'hdfc-jan.pdf', rows: 196, sha: 'abc' }],
};
function fill() {
  ctx.clearState();
  Object.keys(SAMPLE).forEach(k => ctx.S[k].push(...SAMPLE[k]));
  ctx.S.ATT['2026-01'] = { w1: 'P' };
  ctx.S.FINANCE = { accounts: [{ id: 'F1' }] };
  ctx.S.RECON = { txns: [{ id: 'T1' }] };
  ctx.S.WA = { cfg: { provider: 'whapi' }, log: [{ key: 'ARIF|147|0', party: 'ARIF' }] };
}

/* ── 1. SAVE → RESTORE round trip: nothing may vanish ── */
fill();
const saved = JSON.parse(JSON.stringify(ctx.blob(false)));   // as it hits localStorage / the cloud
ctx.clearState();                                            // as on a reload / company switch
ctx.hydrate(saved);

eq('sales survive a reload', ctx.S.SALES.length, 1);
eq('purchases survive', ctx.S.PURCHASES.length, 1);
eq('parties survive', ctx.S.PARTIES.length, 1);
eq('cashbook survives', ctx.S.CASHBOOK.length, 1);
eq('bank accounts survive', ctx.S.BANK_ACCOUNTS.length, 1);
eq('statement history survives — a bank card reads its "last upload" from this', ctx.S.STATEMENTS.length, 1);
eq('...with the content hash intact (re-upload detection depends on it)', (ctx.S.STATEMENTS[0] || {}).sha, 'abc');
eq('attendance survives', JSON.stringify(ctx.S.ATT['2026-01']), JSON.stringify({ w1: 'P' }));
eq('finance survives', ctx.S.FINANCE.accounts.length, 1);
eq('reconcile txns survive', ctx.S.RECON.txns.length, 1);

/* THE REGRESSION: the send log is the dedupe memory. */
eq('the WhatsApp send log survives a reload', (ctx.S.WA.log || []).length, 1);
eq('...with the dedupe key intact', (ctx.S.WA.log[0] || {}).key, 'ARIF|147|0');
eq('the WhatsApp settings survive', (ctx.S.WA.cfg || {}).provider, 'whapi');

/* ── 2. every store in S must actually round-trip ── */
const skip = { LOANS: 'global on purpose (dm_loans), not per-company' };
Object.keys(ctx.S).forEach(k => {
  if (skip[k]) return;
  const v = ctx.S[k];
  const empty = Array.isArray(v) ? v.length === 0
    : (v && typeof v === 'object' ? Object.keys(v).length === 0 : v == null);
  ok('store S.' + k + ' round-trips through blob()+hydrate() — if this fails it is silently NOT SAVED', !empty);
});

/* ── 3. clearState must EMPTY everything: a leftover leaks to the next company ── */
fill();
ctx.clearState();
Object.keys(ctx.S).forEach(k => {
  if (skip[k]) return;
  const v = ctx.S[k];
  if (Array.isArray(v)) ok('clearState empties S.' + k + ' (else it leaks into the next company)', v.length === 0);
  else if (k === 'ATT') ok('clearState empties S.ATT', Object.keys(v).length === 0);
  else if (k === 'WA') ok('clearState resets S.WA — one firm\'s chat log must never appear under another',
    !v || !(v.log || []).length);
});

/* ── 4. a fresh/empty blob must not throw ── */
ctx.clearState();
let threw = false;
try { ctx.hydrate({}); ctx.hydrate(null); ctx.hydrate({ wa: null }); } catch (e) { threw = true; }
ok('hydrating an empty / null / partial blob never throws', !threw);
eq('...and leaves the WA store usable, not undefined', typeof ctx.S.WA, 'object');
let threw2 = false;
try { ctx.blob(false); } catch (e) { threw2 = true; }
ok('blob() on a fresh company never throws', !threw2);

/* ── 5. an OLD blob (saved before the WA store existed) must still load ── */
ctx.clearState();
const legacy = { sales: [{ inv: 'S1' }], purchases: [], parties: [] };   // no `wa` key at all
let threw3 = false;
try { ctx.hydrate(legacy); } catch (e) { threw3 = true; }
ok('a blob saved before this store existed still loads', !threw3);
eq('...and its sales are intact', ctx.S.SALES.length, 1);
ok('...and the WA store defaults rather than being undefined', ctx.S.WA && Array.isArray(ctx.S.WA.log || []));

console.log('\n════ blob save / restore / reset ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' BLOB TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
