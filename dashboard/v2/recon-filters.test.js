/* recon-filters.test.js — the Filters panel on Bank Reconciliation.
 *
 * The recon page had tabs, a credit/debit toggle and search. The Sales Register
 * has a Filters panel. So "everything over ₹50,000 that Aziz sent this fortnight"
 * meant scrolling 74 lines by eye.
 *
 * Loads the REAL reconcile.js in a VM (same harness as recon-wiring.test.js) and
 * drives advMatch() — the single predicate every count, the list and the export
 * all pass through. A re-implementation would prove nothing; the risk here is
 * that a filter silently HIDES a bank line the user needed to see.
 *
 *   node recon-filters.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

/* The statement from the user's screenshot, as data. */
const TXNS = [
  { id: 'T1', date: '2026-01-31', clean: 'Interest (CC/OD)',   debit: 6647,   m: { status: 'other',   cat: 'Interest (CC/OD)', confidence: 96 } },
  { id: 'T2', date: '2026-01-31', clean: 'Loan recovery',      debit: 4593,   m: { status: 'other',   cat: 'Loan recovery',    confidence: 96 } },
  { id: 'T3', date: '2026-01-28', clean: 'RAMKARAN AND SONS',  debit: 400000, m: { status: 'partial', cat: 'Supplier payment', party: 'RAMKARAN AND SONS', confidence: 76 } },
  { id: 'T4', date: '2026-01-28', clean: 'Bank charges',       debit: 29,     m: { status: 'other',   cat: 'Bank charges',     confidence: 96 } },
  { id: 'T5', date: '2026-01-28', clean: 'Aziz Chemicals',     credit: 200000, m: { status: 'review', cat: 'Credit', party: 'Aziz Chemicals', confidence: 60 } },
  { id: 'T6', date: '2026-01-05', clean: 'Aziz Chemicals',     credit: 200000, m: { status: 'review', cat: 'Credit', party: 'Aziz Chemicals', confidence: 60 } },
  { id: 'T7', date: '2026-01-02', clean: 'Shree Cement Ltd',   credit: 101850, m: { status: 'matched', cat: 'Credit', party: 'Shree Cement Ltd', confidence: 98 } },
  // No suggestion at all — the engine could not even guess. Must be reachable.
  { id: 'T8', date: '2026-01-20', clean: 'UNKNOWN CO',         credit: 5000,  m: { status: 'unmatched', cat: '' } },
  // 88% — squarely inside the yellow band. Without a line HERE, `>=95` and
  // `>=80` return the same rows and the tier boundary is untestable: a
  // mutation moving the threshold to 80 survived until this line existed.
  { id: 'T9', date: '2026-01-18', clean: 'Ambuja Cements',    credit: 75000, m: { status: 'review', cat: 'Credit', party: 'Ambuja Cements', confidence: 88 } }
];

/* The SAME harness recon-wiring.test.js uses. My first attempt hand-rolled a
   thinner context and reconcile.js died at load reading '.match' of undefined —
   the page touches globals a minimal stub does not have. Copying the harness that
   already loads this file beats maintaining a second, subtly different one. */
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
  salesRows: () => [], purchaseRows: () => [], partyRows: () => [], cashbookRows: () => [],
  bankAccounts: () => [], bankAccountById: () => null, bankAccountLabel: () => '',
  recon: { txns: TXNS, aliases: {} }, saveRecon: noop, commit: noop, state: { RECON: { txns: TXNS } },
  uiMonth: () => null, setUiMonth: noop, partyLedger: () => [],
  statementRows: () => [], lastStatement: () => null,
};
const ctx = {
  console, window: {}, document: doc, QLShell: { mount: noop, modal: noop, toast: noop, openForm: noop, exportCSV: noop },
  QLD: QLD, QLFin: {}, QLMobile: null, QLParty: require('./party-identity.js'),
  QLX: { esc: s => String(s == null ? '' : s), svg: () => '', icons: {}, toast: noop, refresh: noop, mount: noop, state: () => ({}) },
  setTimeout: noop, clearTimeout: noop, requestAnimationFrame: noop,
  localStorage: { getItem: () => null, setItem: noop }, sessionStorage: { getItem: () => null, setItem: noop },
  location: { href: 'https://app.quicklimes.com/v2/reconcile', search: '', hash: '', pathname: '/v2/reconcile' },
  history: { replaceState: noop, pushState: noop }, navigator: { userAgent: 'node' }, alert: noop, confirm: () => false,
  Date: Date, JSON: JSON, Math: Math, Object: Object, Array: Array, Set: Set, Map: Map,
  String: String, Number: Number, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.window.QLD = QLD;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'recon-core.js'), 'utf8'), ctx);

let loaded = true, err = null;
try {
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, 'reconcile.js'), 'utf8') +
    '\n;this.__advMatch = advMatch; this.__ST = ST; this.__advCount = advCount; this.__advReset = advReset; this.__txnAmt = txnAmt; this.__filteredTxns = filteredTxns; this.__groupByMonth = groupByMonth; this.__monthName = monthName;',
    ctx
  );
} catch (e) { loaded = false; err = e; }

console.log('\n═══ Bank Reconciliation · Filters ═══\n');
ok(loaded, 'the REAL reconcile.js loads' + (err ? ' — ' + err.message : ''));
if (!loaded) { console.log('\n❌ FAILED\n'); process.exit(1); }

const { __advMatch: advMatch, __ST: ST, __advCount: advCount, __advReset: advReset } = ctx;
const apply = () => TXNS.filter(advMatch).map(t => t.id);
const set = o => { advReset(); Object.assign(ST.adv, o); };

/* ── the default must show EVERYTHING ── */
advReset();
eq('with no filters set, every line is visible', apply().length, 9);
eq('  and nothing claims to be filtering', advCount(), 0);

/* ── party ── */
set({ party: 'Aziz Chemicals' });
eq('party → only that party\'s lines', apply(), ['T5', 'T6']);
eq('  the button reports 1 active filter', advCount(), 1);
set({ party: 'RAMKARAN AND SONS' });
eq('a party with one line returns exactly it', apply(), ['T3']);

/* ── type/category ── */
set({ cat: 'Supplier payment' });
eq('type → only that category', apply(), ['T3']);
set({ cat: 'Credit' });
eq('the Credit category spans several parties', apply(), ['T5', 'T6', 'T7', 'T9']);

/* ── confidence — bands must mirror the ENGINE's tiers (>=95 green, >=75 yellow) ── */
set({ conf: 'high' });
eq('high = 95%+ ONLY — the 88% line must NOT be in it', apply(), ['T1', 'T2', 'T4', 'T7']);
set({ conf: 'med' });
eq('medium = 75–94% — RAMKARAN at 76 AND Ambuja at 88', apply(), ['T3', 'T9']);
set({ conf: 'low' });
eq('low = under 75%', apply(), ['T5', 'T6']);
set({ conf: 'none' });
eq('"no suggestion at all" finds the line the engine could not even guess', apply(), ['T8']);

/* ── dates ── */
set({ from: '2026-01-28' });
eq('from-date is inclusive of the boundary day', apply(), ['T1', 'T2', 'T3', 'T4', 'T5']);
set({ to: '2026-01-05' });
eq('to-date is inclusive too', apply(), ['T6', 'T7']);
set({ from: '2026-01-05', to: '2026-01-20' });
eq('a range takes both ends', apply(), ['T6', 'T8', 'T9']);
eq('  and counts as two active filters', advCount(), 2);

/* ── amounts — on the line's VALUE, whichever side it is on ── */
set({ min: '100000' });
eq('min → big money only, credits and debits alike', apply(), ['T3', 'T5', 'T6', 'T7']);
set({ max: '5000' });
eq('max → the small stuff (₹4,593 and ₹29 and ₹5,000)', apply(), ['T2', 'T4', 'T8']);
set({ min: '5000', max: '10000' });
/* ₹6,647 and ₹5,000 — NOT the ₹4,593 loan recovery, which is below the floor.
   My first expectation listed it and the code was right: min is inclusive at
   5,000 and 4,593 < 5,000. Both ends are inclusive, which is what a user means
   by "between 5 and 10 thousand". */
eq('a band takes both ends, inclusively', apply(), ['T1', 'T8']);
/* 0 is a REAL bound, not "unset" — a `!a.min` guard would silently ignore it. */
set({ min: '0' });
/* min ₹0 excludes nothing either way, so `a.min !== ''` vs `a.min` is an
   EQUIVALENT mutation here — there is no behaviour to pin. Kept only as a
   guard that a zero does not crash or blank the list. */
eq('min ₹0 does not blank the list', apply().length, 9);

/* ── combining — filters must AND, never OR ── */
set({ party: 'Aziz Chemicals', from: '2026-01-10' });
eq('party AND date narrow together', apply(), ['T5']);
set({ cat: 'Credit', min: '150000' });
eq('type AND amount narrow together', apply(), ['T5', 'T6']);
set({ party: 'Aziz Chemicals', cat: 'Supplier payment' });
eq('a contradictory combination returns nothing — not everything', apply(), []);

/* ── clearing ── */
set({ party: 'Aziz Chemicals', cat: 'Credit', min: '1', from: '2026-01-01' });
ok(advCount() === 4, 'four filters report as four');
advReset();
eq('Clear restores every line', apply().length, 9);
eq('  and the count returns to zero', advCount(), 0);

/* ── a line with no party/category must never be hidden by an UNSET filter ── */
advReset();
ok(apply().indexOf('T8') >= 0, 'a line with no category survives the default view — an unfiltered list must never hide a bank line');

/* ── THE WIRING: the PAGE must actually apply the predicate ──
   Everything above drives advMatch() directly, which proves the predicate is
   correct and NOTHING about whether the page uses it. That distinction is not
   academic here: party-identity.js passed 22 checks while ELEVEN call sites
   ignored it, and the company switch passed while EIGHT pages dropped it.
   filteredTxns() is the single funnel every count, the list and the export read,
   so assert THROUGH it — a mutation removing `r.filter(advMatch)` from the
   pipeline survived every test above until this block existed. */
{
  const filteredTxns = ctx.__filteredTxns;
  advReset(); ST.month = 'all'; ST.fstatus = 'all'; ST.ftype = 'all'; ST.q = '';
  const all = filteredTxns().length;
  ok(all === 9, 'the page shows every line when nothing is filtered (got ' + all + ')');

  ST.adv.party = 'Aziz Chemicals';
  const narrowed = filteredTxns().map(t => t.id).sort();
  eq('THE PAGE APPLIES THE FILTER — not just the predicate in isolation', narrowed, ['T5', 'T6']);

  ST.adv.party = 'all'; ST.adv.min = '100000';
  ok(filteredTxns().length === 4, 'the page applies the amount filter through the same funnel');

  ST.adv.min = ''; ST.adv.conf = 'none';
  eq('  and the confidence filter', filteredTxns().map(t => t.id), ['T8']);
  advReset();
}

/* ── MONTH GROUPING — the Purchase Register's collapsible headers, per month ──
   A grouper that drops rows is worse than no grouper: the line is on screen in
   neither the group nor the flat list, and nothing says so. So the invariant is
   arithmetic — every row lands in exactly one group, always. */
{
  const groupByMonth = ctx.__groupByMonth, monthName = ctx.__monthName;
  advReset(); ST.month = 'all'; ST.fstatus = 'all'; ST.ftype = 'all'; ST.q = '';
  const rows = ctx.__filteredTxns();
  const gs = groupByMonth(rows);

  eq('every line is January in this fixture, so there is ONE group', gs.length, 1);
  eq('NO ROW IS LOST — the groups sum back to the list exactly',
    gs.reduce((a, g) => a + g.rows.length, 0), rows.length);
  eq('  and none is duplicated across groups',
    new Set(gs.flatMap(g => g.rows.map(r => r.id))).size, rows.length);
  eq('the group is labelled like a human says it', gs[0].label, 'January 2026');

  /* Multi-month: the real "All months" case, and the reason this exists. */
  const multi = [
    { id: 'X1', date: '2026-06-30', debit: 100 },
    { id: 'X2', date: '2026-06-01', credit: 200 },
    { id: 'X3', date: '2026-05-15', debit: 300 },
    { id: 'X4', date: '2026-04-02', credit: 400 }
  ];
  const mg = groupByMonth(multi);
  eq('three months → three groups', mg.map(g => g.key), ['2026-06', '2026-05', '2026-04']);
  eq('  newest month first, matching the row order', mg[0].label, 'June 2026');
  eq('  and each holds only its own lines', mg.map(g => g.rows.length), [2, 1, 1]);
  eq('  summing back to every row', mg.reduce((a, g) => a + g.rows.length, 0), 4);

  /* A line with no date must still be reachable — it is exactly the line someone
     needs to fix, and silently dropping it is the worst outcome. */
  const withBlank = groupByMonth([{ id: 'B1', date: '', debit: 50 }, { id: 'B2', date: '2026-06-01', debit: 60 }]);
  eq('a dateless line gets its own group, never vanishes', withBlank.reduce((a, g) => a + g.rows.length, 0), 2);
  ok(withBlank.some(g => g.label === 'No date'), '  and is labelled honestly as "No date"');

  eq('an empty list groups to nothing, not a crash', groupByMonth([]).length, 0);
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
