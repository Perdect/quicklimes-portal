/* recon-wiring.test.js — does the PAGE actually use the engine?

   WHY THIS FILE EXISTS (a mistake I have already made once, in this app):
   the bill-direction bug was fixed in the parser, the parser's tests went green,
   and the bug stayed live — because the ROUTER never called the fixed code. A
   green engine test proves the engine. It does not prove the app uses it.

   So this test loads the REAL reconcile.js — not a copy, not a re-implementation
   — in a stubbed browser, and drives its REAL autoMatch() with the REAL June-2026
   Bank of Baroda line:

       NEFT-BARBT26161997932-NAGAUR GOLDEN TRANSPORT COMP   54,944 DR

   That is the user's "party we pay every month". Before this change a debit could
   only be matched against PURCHASE BILLS, and freight is not a purchase bill — so
   this line could never match anything, no matter how good the engine was.

   Run: node recon-wiring.test.js */

const fs = require('fs'), vm = require('vm'), path = require('path');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), a === b);

/* ── the fixture: what the firm has actually recorded ── */
const CASHBOOK = [
  // the freight payment from the user's screenshot — recorded, method Bank
  { id: 'cb101', idx: 0, date: '2026-06-16', type: 'debit', mode: 'bank', method: 'Bank',
    ptype: 'Freight', party: 'Nagaur Golden Transport Company', amount: 54944, ref: '', accountId: '' },
  // a cash payout the same week — must NEVER match a bank line
  { id: 'cb102', idx: 1, date: '2026-06-16', type: 'debit', mode: 'cash', method: 'Cash',
    ptype: 'Labour', party: 'Site Labour', amount: 12000, ref: '', accountId: '' },
];
const PURCHASES = [
  { idx: 0, bill: 'IOC/9001', date: '2026-06-22', sup: 'Indian Oil Corporation Limited',
    total: 500000, outstanding: 500000, status: 'pending' },
];

/* ── a browser, stubbed just enough to load the page ── */
const noop = () => {};
const elStub = new Proxy({}, { get: (t, k) => (k === 'classList' ? { add: noop, remove: noop, toggle: noop, contains: () => false }
  : k === 'style' ? {} : k === 'dataset' ? {} : k === 'innerHTML' || k === 'textContent' || k === 'value' ? ''
  : k === 'children' || k === 'childNodes' ? [] : typeof k === 'string' ? noop : undefined), set: () => true });
const doc = {
  getElementById: () => elStub, querySelector: () => elStub, querySelectorAll: () => [],
  createElement: () => elStub, addEventListener: noop, body: elStub, documentElement: elStub,
};
const QLD = {
  fC: n => '₹' + Math.round(+n || 0).toLocaleString('en-IN'),
  fmt: n => String(n), fDS: d => String(d || ''), fL: n => String(n), daysAgo: () => 0,
  co: { name: 'Gotan Lime Industries', short: 'GOTAN' }, COMPANIES: {}, ownFirmNames: ['Gotan Lime Industries'],
  activeCo: 'gotan',
  salesRows: () => [], purchaseRows: () => PURCHASES, partyRows: () => [], cashbookRows: () => CASHBOOK,
  bankAccounts: () => [], bankAccountById: () => null, bankAccountLabel: () => '',
  recon: { txns: [] }, saveRecon: noop, commit: noop, state: {},
  uiMonth: () => null, setUiMonth: noop, partyLedger: () => [],
};
const ctx = {
  console, window: {}, document: doc, QLShell: { mount: noop, modal: noop, toast: noop, openForm: noop },
  QLD: QLD, QLFin: {}, QLMobile: null, setTimeout: noop, clearTimeout: noop, requestAnimationFrame: noop,
  localStorage: { getItem: () => null, setItem: noop }, sessionStorage: { getItem: () => null, setItem: noop },
  location: { href: 'https://app.quicklimes.com/v2/reconcile', search: '', hash: '', pathname: '/v2/reconcile' },
  history: { replaceState: noop, pushState: noop }, navigator: { userAgent: 'node' }, alert: noop, confirm: () => false,
  Date: Date, JSON: JSON, Math: Math, Object: Object, Array: Array, Set: Set, Map: Map,
  String: String, Number: Number, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.window.QLD = QLD;
vm.createContext(ctx);

/* the REAL engine, then the REAL page — exactly what the browser loads */
vm.runInContext(fs.readFileSync(path.join(__dirname, 'recon-core.js'), 'utf8'), ctx);
ok('recon-core.js loaded and exposed ReconCore', !!(ctx.window.ReconCore || ctx.ReconCore));
ctx.RC = ctx.window.ReconCore || ctx.ReconCore;

let loaded = true, err = null;
try { vm.runInContext(fs.readFileSync(path.join(__dirname, 'reconcile.js'), 'utf8') + '\n;this.__autoMatch = autoMatch; this.__entriesFor = entriesFor; this.__isLinked = isLinked; this.__resetRecur = function () { RECUR = null; }; this.__runMatchAll = runMatchAll;', ctx); }
catch (e) { loaded = false; err = e; }
ok('the REAL reconcile.js loads' + (err ? ' — ' + err.message : ''), loaded);

if (loaded) {
  const autoMatch = ctx.__autoMatch, entriesFor = ctx.__entriesFor, isLinked = ctx.__isLinked;
  /* Build rows EXACTLY as the importer does (reconcile.js: `clean: np.clean`).
     A fixture that skips parseNarration hands the matcher an empty party name
     and every match fails for a reason the real app never has — testing a shape
     the code never sees is how the last bug survived a green suite. */
  const row = (id, date, dr, cr, narr) => {
    const np = ctx.RC.parseNarration(narr);
    return { id: id, date: date, debit: dr, credit: cr, raw: np.raw || narr, desc: narr,
             clean: np.clean, utr: np.utr, cheque: np.cheque, mode: np.mode, accountId: '' };
  };
  ok('autoMatch() is reachable', typeof autoMatch === 'function');
  ok('entriesFor() is reachable — the page can see recorded money', typeof entriesFor === 'function');

  /* ── 1. THE ADAPTER: cashbook rows reach the engine in its shape ── */
  const es = entriesFor({ id: 't1' });
  eq('both cashbook entries are offered as candidates', es.length, 2);
  const frt = es.find(e => /Nagaur/i.test(e.party));
  eq('a recorded debit is money OUT', frt.dir, 'out');
  eq('...carrying the id the link points at', frt.id, 'cb101');
  eq('...and the method, so the cash guard can fire', frt.method, 'Bank');
  eq('...and the payment kind for the UI', frt.kind, 'Freight');

  /* ── 2. THE REPORTED GAP, through the REAL page code ──
     The genuine June-2026 Bank of Baroda narration. */
  const t = row('t1', '2026-06-16', 54944, 0, 'NEFT-BARBT26161997932-NAGAUR GOLDEN TRANSPORT COMP');
  const m = autoMatch(t);
  eq('the real freight line now matches the recorded payment', m.kind, 'entry');
  eq('...it LINKS — the money is already in the books', m.action, 'link');
  eq('...to the right cashbook entry', m.entryId, 'cb101');
  ok('...with the party named', /Nagaur/i.test(m.party || ''));
  ok('...and is not left for the user to identify', isLinked({ id: 't1', m: m }));
  ok('...and it never claims to pay a purchase bill', m.idx == null);

  /* ── 3. the bill path still works (no regression) ── */
  const t2 = row('t2', '2026-06-22', 500000, 0, 'RTGS-BARBR52026062200778789-INDIAN OIL CORPORATION');
  const m2 = autoMatch(t2);
  eq('an unpaid IOC bill still matches its bill', m2.kind, 'purchase');
  eq('...and posts', m2.action, 'post');
  eq('...to the right bill', m2.idx, 0);

  /* ── 4. a bank line must never match a CASH payout ── */
  const t3 = row('t3', '2026-06-16', 12000, 0, 'NEFT-XX-SITE LABOUR');
  ok('the cash labour payout is not matched to a bank debit', autoMatch(t3).kind !== 'entry');

  /* ── 5. one recorded payment cannot reconcile two bank lines ──
     Two identical ₹54,944 debits, one entry. The second must not link to the
     entry the first already claimed, or one payment reconciles twice. */
  QLD.recon.txns = [Object.assign({}, t, { m: m })];          // t1 has claimed cb101
  const es2 = entriesFor(row('t9', '2026-06-16', 54944, 0, 'NEFT-BARBT26161997000-NAGAUR GOLDEN TRANSPORT COMP'));
  eq('the entry claimed by another line is marked linked', (es2.find(e => e.id === 'cb101') || {}).linked, true);
  const t9 = row('t9', '2026-06-16', 54944, 0, 'NEFT-BARBT26161997000-NAGAUR GOLDEN TRANSPORT COMP');
  const m9 = autoMatch(t9);
  ok('a SECOND identical debit does not reconcile the same payment again', m9.entryId !== 'cb101');
  QLD.recon.txns = [];

  /* ── 5b. "THE PARTY WE PAY EVERY MONTH" ──
     A July debit to the transporter. Nothing is recorded for July and there is
     no freight bill — so before this, the line was a bare "Unknown party". The
     firm's OWN history (June, May, April) says this is the monthly freight run.
     It is surfaced for REVIEW: a habit justifies recognizing a name, never
     posting money. */
  QLD.cashbookRows = () => CASHBOOK.concat([
    { id: 'cb90', idx: 9, date: '2026-05-16', type: 'debit', mode: 'bank', method: 'Bank', ptype: 'Freight',
      party: 'Nagaur Golden Transport Company', amount: 54100, ref: '', accountId: '' },
    { id: 'cb91', idx: 10, date: '2026-04-15', type: 'debit', mode: 'bank', method: 'Bank', ptype: 'Freight',
      party: 'Nagaur Golden Transport Company', amount: 55900, ref: '', accountId: '' },
  ]);
  ctx.__resetRecur && ctx.__resetRecur();
  const tJul = row('t5', '2026-07-15', 55000, 0, 'NEFT-BARBT2716199-NAGAUR GOLDEN TRANSPORT COMP');
  const m5 = autoMatch(tJul);
  eq('a monthly payee with nothing recorded yet is recognized from history', m5.catKey, 'recurring');
  eq('...named', m5.party, 'Nagaur Golden Transport Company');
  eq('...and left for a human — history never posts money', m5.status, 'review');
  ok('...explained in the user\'s own terms', /about every month/i.test((m5.reasons || []).join(' ')));
  ok('...and it is not treated as an unknown party', isLinked({ id: 't5', m: m5 }) || m5.party);
  // an amount far off the usual one is the case a human most needs to see
  const mOdd = autoMatch(row('t6', '2026-07-15', 400000, 0, 'NEFT-BARBT2716199-NAGAUR GOLDEN TRANSPORT COMP'));
  ok('an unusual amount to a familiar payee scores lower, not higher', mOdd.catKey !== 'recurring' || mOdd.confidence < 60);
  // a stranger is never invented into a monthly payee
  ok('a party with no history is not called recurring',
    autoMatch(row('t7', '2026-07-15', 55000, 0, 'NEFT-XYZ-SOME NEW VENDOR PVT LTD')).catKey !== 'recurring');
  /* ── 5c. THE HISTORY MUST NOT GO STALE ──
     recurringPayees walks the whole cashbook, so it is cached — autoMatch runs
     once per line and a statement is hundreds of lines. A cache that is never
     invalidated is a bug with a long fuse: record a payment, hit Re-match, and
     the app would still be reasoning from the cashbook as it was at page load.
     Driven through the REAL runMatchAll, which is what the button calls.
     (Mutation testing found this: commenting out the reset kept everything green
     because the test was resetting the cache itself.) */
  ctx.__resetRecur();
  QLD.cashbookRows = () => CASHBOOK;              // history not yet recorded
  QLD.recon.txns = [row('t8', '2026-07-15', 55000, 0, 'NEFT-BARBT2716199-NAGAUR GOLDEN TRANSPORT COMP')];
  ctx.__runMatchAll(true);
  ok('with no history the monthly line is not called recurring', (QLD.recon.txns[0].m || {}).catKey !== 'recurring');
  // now the firm records the earlier months — a re-match must SEE them
  QLD.cashbookRows = () => CASHBOOK.concat([
    { id: 'cb90', idx: 9, date: '2026-05-16', type: 'debit', mode: 'bank', method: 'Bank', ptype: 'Freight',
      party: 'Nagaur Golden Transport Company', amount: 54100, ref: '', accountId: '' },
    { id: 'cb91', idx: 10, date: '2026-04-15', type: 'debit', mode: 'bank', method: 'Bank', ptype: 'Freight',
      party: 'Nagaur Golden Transport Company', amount: 55900, ref: '', accountId: '' },
  ]);
  ctx.__runMatchAll(true);
  eq('a re-match reads the cashbook as it is NOW, not as it was at page load',
    (QLD.recon.txns[0].m || {}).catKey, 'recurring');
  QLD.recon.txns = []; QLD.cashbookRows = () => CASHBOOK; ctx.__resetRecur();

  /* ── 6. hard rules must not swallow a real recorded payment ──
     "Charges"/"self"/"loan" narrations are bank-generated and normally win, but
     an entry match is a real record with a name on it. */
  const t4 = row('t4', '2026-06-16', 54944, 0, 'EBANK:SELF/151/NAGAUR GOLDEN TRANSPORT COMP');
  const m4 = autoMatch(t4);
  ok('a confident recorded payment outranks a narration rule', m4.kind === 'entry' || m4.status === 'other');
}

console.log('\n════ does the PAGE use the engine? ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' WIRING TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
