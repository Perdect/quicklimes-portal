/* cashbook.test.js — the cash book is the single money ledger. It had NO tests.
 *
 * Two layers are exercised, because a bug in either costs real money:
 *
 *   1. The MATH in data.js — accountBalances() / cashbookBalances() / cashbookRows().
 *      Extracted out of data.js and run for real (never re-implemented here).
 *   2. The PAGE — the real cashbook.js is loaded in a VM and its QLX.mount config
 *      driven directly, so the footer/stats/filters under test are the ones that ship.
 *
 * What this file found (documented, NOT fixed — see the ✗ BUG sections):
 *
 *   A. cashbookBalances() DROPS every UPI rupee. It buckets on e.mode ∈ {cash,
 *      phonepay, bank}, but methodToMode() — which every data.js writer runs the
 *      mode through — returns 'upi' and never 'phonepay'. A ₹5,000 PhonePe receipt
 *      is ₹5,000 to accountBalances() and ₹0 to cashbookBalances(). Two functions,
 *      one store, different money. cashbookBalances() feeds the "Cash balance low"
 *      AI insight and the reports page.
 *   B. BOTH balance functions read S.CASHBOOK raw and so COUNT TRASHED ENTRIES.
 *      cashbookRows() filters them (withIdx), the balances do not — the page renders
 *      "0 entries · Balance ₹1,000" off the same store.
 *   C. The page's Account filter offers 'phonepay' but rows carry mode 'upi', so
 *      "PhonePe / UPI" matches nothing that data.js wrote. Same vocabulary split as A.
 *
 * Note on which balance is right: accountBalances() is. It normalises through
 * methodToMode(e.method || e.mode), which absorbs BOTH vocabularies — shell.js's
 * openCashForm writes mode:'phonepay' with no method, data.js writes mode:'upi'
 * with method:'PhonePe', and accountBalances gets both to 'upi'. So the assertions
 * below pin accountBalances as correct and cashbookBalances as the defect.
 *
 *   node cashbook.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
/* JSON-compare, not ===. `[] === []` is false and would report the failure as
   "got: [] expected: []" — a lie that has been written into this repo three times. */
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ Cash Book · balances · trash · the UPI bucket ═══\n');

/* ── grab the REAL functions out of data.js ─────────────────────────
   grabLine for one-liners, grabBlock for multi-line: slicing a one-liner to the
   first ';' truncates it and dies as a bare "Unexpected end of input". */
function grabLine(startsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) throw new Error('not found in data.js: ' + startsWith);
  return src.slice(i, src.indexOf('\n', i));
}
function grabBlock(startsWith, endsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) throw new Error('not found in data.js: ' + startsWith);
  return src.slice(i, src.indexOf(endsWith, i) + endsWith.length);
}

const S = { CASHBOOK: [], SALES: [], PURCHASES: [], FINANCE: { opening: {} } };
const dctx = {
  console, Math, Object, Array, Number, String, Date, JSON, isNaN, parseFloat, S,
  commit: () => {},                 // persistence is not under test
  bankAccountLabel: () => 'HDFC ·1234'
};
vm.createContext(dctx);
vm.runInContext([
  grabLine('const withIdx = arr =>'),
  grabLine('  let _seq = 0;').trim(),
  grabLine('function idStamp()'),
  grabLine('function fmtISO(d)'),
  grabLine('function methodToMode(m)'),
  grabLine('function modeToMethod(m)'),
  grabBlock('function accountBalances()', '\n  }'),
  grabBlock('function cashbookBalances()', '\n  }'),
  grabBlock('function cashbookRows()', '\n  }'),
  grabLine('function addCashEntry(e)'),
  grabBlock('function addLedgerPayment(o)', '\n  }'),
  grabBlock('function addTransfer(o)', '\n  }'),
  'this.X = { withIdx, methodToMode, modeToMethod, accountBalances, cashbookBalances, cashbookRows, addCashEntry, addLedgerPayment, addTransfer };'
].join('\n'), dctx);
const X = dctx.X;
ok(typeof X.accountBalances === 'function', 'the real balance maths loaded out of data.js');
ok(typeof X.cashbookRows === 'function', 'the real cashbookRows loaded out of data.js');

const reset = () => { S.CASHBOOK.length = 0; S.FINANCE.opening = {}; };
/* Exactly what shell.js openCashForm → addCashEntry writes: a `mode`, no `method`. */
const viaForm = o => X.addCashEntry(Object.assign({ date: '2026-07-01', type: 'credit', mode: 'cash', amount: 0, category: '', party: '', ref: '' }, o));

/* ══════════ 1. methodToMode — the bucketing vocabulary ══════════
   Every writer in data.js funnels its payment method through this. If it moves,
   money lands in the wrong account. All nine shipped PAY_METHODS are pinned. */
{
  eq('Cash → cash', X.methodToMode('Cash'), 'cash');
  eq('Bank → bank', X.methodToMode('Bank'), 'bank');
  eq('PhonePe → upi', X.methodToMode('PhonePe'), 'upi');
  eq('Google Pay → upi', X.methodToMode('Google Pay'), 'upi');
  eq('UPI → upi', X.methodToMode('UPI'), 'upi');
  eq('Cheque → bank', X.methodToMode('Cheque'), 'bank');
  eq('NEFT → bank', X.methodToMode('NEFT'), 'bank');
  eq('RTGS → bank', X.methodToMode('RTGS'), 'bank');
  eq('IMPS → bank', X.methodToMode('IMPS'), 'bank');
  /* Case-insensitive, and an unknown/blank method falls back to bank rather than
     dropping the money on the floor. */
  eq('lower-case cash still buckets', X.methodToMode('cash'), 'cash');
  eq('an UNKNOWN method falls back to bank, not nothing', X.methodToMode('Barter'), 'bank');
  eq('blank falls back to bank', X.methodToMode(''), 'bank');
  eq('null does not throw', X.methodToMode(null), 'bank');
  /* THE CRUX: methodToMode never emits 'phonepay' — yet cashbookBalances (§3) and
     the page's Account filter (§6) both look for exactly that. */
  eq('methodToMode NEVER returns "phonepay" — nothing downstream may look for it', X.methodToMode('PhonePe'), 'upi');
  /* shell.js's legacy mode value, normalised the same way — this is why
     accountBalances survives both vocabularies. */
  eq('the legacy mode "phonepay" normalises to upi too', X.methodToMode('phonepay'), 'upi');
}

/* ══════════ 2. accountBalances — direction and buckets ══════════ */
{
  reset();
  viaForm({ type: 'credit', mode: 'cash', amount: 10000 });
  eq('a credit ADDS to its bucket', X.accountBalances().cash, 10000);
  viaForm({ type: 'debit', mode: 'cash', amount: 4000 });
  eq('a debit SUBTRACTS', X.accountBalances().cash, 6000);
  eq('  and only from its own bucket', X.accountBalances().bank, 0);

  reset();
  X.addLedgerPayment({ dir: 'in', amount: 10000, method: 'Bank', date: '2026-07-01', party: 'A' });
  X.addLedgerPayment({ dir: 'in', amount: 5000, method: 'PhonePe', date: '2026-07-01', party: 'B' });
  X.addLedgerPayment({ dir: 'out', amount: 2000, method: 'Cash', date: '2026-07-01', party: 'C' });
  const b = X.accountBalances();
  eq('bank bucket', b.bank, 10000);
  eq('upi bucket', b.upi, 5000);
  eq('cash bucket (a debit with no prior credit goes negative — real, not clamped)', b.cash, -2000);
  eq('total is the sum of the three', b.total, 13000);

  /* Opening balances seed each bucket — a firm does not start at zero. */
  reset(); S.FINANCE.opening = { cash: 50000, bank: 200000, upi: 1000 };
  eq('opening balance seeds cash', X.accountBalances().cash, 50000);
  eq('  and bank', X.accountBalances().bank, 200000);
  eq('  and total', X.accountBalances().total, 251000);
  viaForm({ type: 'debit', mode: 'cash', amount: 20000 });
  eq('entries move off the opening balance', X.accountBalances().cash, 30000);

  /* A string amount must not poison the total. accountBalances coerces (+e.amount). */
  reset();
  X.addCashEntry({ date: '2026-07-01', type: 'credit', mode: 'cash', amount: '1500' });
  ok(!isNaN(X.accountBalances().cash), 'a STRING amount does not turn the balance into NaN');
  eq('  it is coerced to a number, not concatenated', X.accountBalances().cash, 1500);
  X.addCashEntry({ date: '2026-07-01', type: 'credit', mode: 'cash' });   // no amount at all
  eq('an entry with NO amount contributes nothing rather than NaN', X.accountBalances().cash, 1500);
}

/* ══════════ 3. ✗ BUG — cashbookBalances DROPS every UPI rupee ══════════
   Not a style nit: this function is the "Cash balance low: ₹X" AI insight and the
   reports page. A firm taking PhonePe money watches it vanish from that number. */
{
  reset();
  X.addLedgerPayment({ dir: 'in', amount: 5000, method: 'PhonePe', date: '2026-07-01', party: 'A' });
  eq('a ₹5,000 PhonePe receipt IS money (accountBalances agrees)', X.accountBalances().total, 5000);
  eq('  ✗ BUG: cashbookBalances reports ₹0 — the UPI bucket is dropped', X.cashbookBalances().total, 0);
  /* Stated as the divergence itself, so the day someone fixes cashbookBalances this
     line fails loudly and points at this comment. */
  ok(X.accountBalances().total !== X.cashbookBalances().total,
    '  ✗ BUG: two functions over ONE store disagree by the whole UPI balance (₹5,000)');

  /* The mechanism, pinned: the bucket key it looks for is one methodToMode never emits. */
  eq('  the entry data.js wrote carries mode "upi"…', S.CASHBOOK[0].mode, 'upi');
  eq('  …but cashbookBalances buckets "phonepay", which is always empty', X.cashbookBalances().phonepay, 0);

  /* Cash and bank DO work — which is exactly why this survived: the common path is fine. */
  reset();
  X.addLedgerPayment({ dir: 'in', amount: 8000, method: 'Cash', date: '2026-07-01', party: 'A' });
  X.addLedgerPayment({ dir: 'in', amount: 2000, method: 'Bank', date: '2026-07-01', party: 'B' });
  eq('cash + bank are counted correctly (why the bug hid)', X.cashbookBalances().total, 10000);
  eq('  and agree with accountBalances', X.accountBalances().total, 10000);

  /* The legacy shell.js vocabulary is the ONLY UPI-ish thing it can see. */
  reset();
  viaForm({ type: 'credit', mode: 'phonepay', amount: 3000 });
  eq('a legacy mode:"phonepay" entry IS seen by cashbookBalances', X.cashbookBalances().total, 3000);
  eq('  and accountBalances files the same entry under upi', X.accountBalances().upi, 3000);
  ok(X.accountBalances().total === X.cashbookBalances().total,
    '  so the two agree on legacy entries — the split is purely the upi/phonepay word');

  /* Mixed books — the realistic case. One PhonePe payment via the Payments page and
     one via the old cash form: cashbookBalances sees half the UPI money. */
  reset();
  viaForm({ type: 'credit', mode: 'phonepay', amount: 3000 });               // old form
  X.addLedgerPayment({ dir: 'in', amount: 7000, method: 'PhonePe', date: '2026-07-01', party: 'B' });  // payments page
  eq('accountBalances sees all ₹10,000 of UPI money', X.accountBalances().upi, 10000);
  eq('  ✗ BUG: cashbookBalances sees only the ₹3,000 legacy half', X.cashbookBalances().total, 3000);

  /* Latent, not reachable through the Add Entry form (shell.js:711 parseFloats
     number fields first) — but addCashEntry is a public API and cloud-restored /
     imported rows are not coerced. accountBalances does `+e.amount`;
     cashbookBalances does `s + (e.amount || 0)` and so string-concatenates.
     ONE string amount hides it — the final `cr - dr` coerces the string back — so
     it takes TWO in a bucket to see it. My first fixture used one and passed. */
  reset();
  X.addCashEntry({ date: '2026-07-01', type: 'credit', mode: 'cash', amount: '1500' });
  X.addCashEntry({ date: '2026-07-01', type: 'credit', mode: 'cash', amount: '200' });
  eq('accountBalances coerces string amounts and adds them', X.accountBalances().cash, 1700);
  eq('  ✗ LATENT: cashbookBalances CONCATENATES them — ₹1,500 + ₹200 becomes ₹15,00,200',
    X.cashbookBalances().cash, 1500200);
  /* One string alone round-trips, which is why this never showed up. */
  reset();
  X.addCashEntry({ date: '2026-07-01', type: 'credit', mode: 'cash', amount: '1500' });
  eq('  a single string amount happens to survive (cr − dr coerces it back)', X.cashbookBalances().cash, 1500);
}

/* ══════════ 4. ✗ BUG — the balances count records the user threw away ══════════
   pl-gst.test.js fixed exactly this family for P&L/GST (trashed invoices kept
   adding output tax). The cash book still has it. */
{
  reset();
  X.addLedgerPayment({ dir: 'in', amount: 1000, method: 'Bank', date: '2026-07-01', party: 'A' });
  eq('one live entry', X.cashbookRows().length, 1);
  eq('  worth ₹1,000', X.accountBalances().total, 1000);

  /* The exact shape softDelete('payment', …) writes onto S.CASHBOOK[i]. */
  S.CASHBOOK[0]._del = { at: '2026-07-02T10:00:00.000Z', by: 'owner', role: 'owner', reason: 'entered twice' };
  eq('a TRASHED entry leaves the cash book list', X.cashbookRows().length, 0);
  eq('  ✗ BUG: but accountBalances still counts its ₹1,000', X.accountBalances().total, 1000);
  eq('  ✗ BUG: and so does cashbookBalances', X.cashbookBalances().total, 1000);
  eq('  ✗ BUG: cashbookBalances.count counts trashed rows too — the page says 0', X.cashbookBalances().count, 1);
  /* The user-visible contradiction, in one assertion: the subtitle renders
     "N entries · Balance ₹X" from these two functions. */
  ok(X.cashbookRows().length === 0 && X.accountBalances().total === 1000,
    '  ✗ BUG: the page renders "0 entries · Balance ₹1,000" off one store');

  /* Archived behaves the same way — withIdx filters _arch, the balances do not. */
  reset();
  X.addLedgerPayment({ dir: 'in', amount: 2000, method: 'Bank', date: '2026-07-01', party: 'A' });
  S.CASHBOOK[0]._arch = true;
  eq('an ARCHIVED entry leaves the list', X.cashbookRows().length, 0);
  eq('  ✗ BUG: but still counts toward the balance', X.accountBalances().total, 2000);

  /* Live entries alongside trashed ones — the realistic mix. */
  reset();
  X.addLedgerPayment({ dir: 'in', amount: 1000, method: 'Bank', date: '2026-07-01', party: 'A' });
  X.addLedgerPayment({ dir: 'in', amount: 500, method: 'Bank', date: '2026-07-02', party: 'B' });
  S.CASHBOOK[1]._del = { at: 'x' };
  eq('the list shows only the live entry', X.cashbookRows().length, 1);
  eq('  ✗ BUG: the balance is overstated by the trashed ₹500', X.accountBalances().total, 1500);
}

/* ══════════ 5. cashbookRows — shape and ordering ══════════ */
{
  reset();
  X.addLedgerPayment({ dir: 'in', amount: 100, method: 'Bank', date: '2026-07-01', party: 'A' });
  X.addLedgerPayment({ dir: 'out', amount: 200, method: 'Cash', date: '2026-07-09', party: 'B' });
  X.addLedgerPayment({ dir: 'in', amount: 300, method: 'Bank', date: '2026-07-05', party: 'C' });
  eq('rows are newest-first', X.cashbookRows().map(r => r.date), ['2026-07-09', '2026-07-05', '2026-07-01']);
  /* idx must be the RAW index into S.CASHBOOK — it is what Edit and Delete pass to
     deleteCashEntry(). If it were the sorted position, deleting row 1 would trash a
     different entry's money. */
  eq('idx is the RAW store index, not the sorted position', X.cashbookRows().map(r => r.idx), [1, 2, 0]);
  eq('  so the newest row points at the entry actually written second', S.CASHBOOK[X.cashbookRows()[0].idx].party, 'B');
  eq('direction survives the mapping', X.cashbookRows().map(r => r.type), ['debit', 'credit', 'credit']);
  eq('amounts survive the mapping', X.cashbookRows().map(r => r.amount), [200, 300, 100]);
}

/* ══════════ 6. THE PAGE — the real cashbook.js, driven ══════════ */
const noop = () => {};
const elStub = new Proxy({}, { get: (t, k) => (k === 'classList' ? { add: noop, remove: noop, toggle: noop, contains: () => false }
  : k === 'style' ? {} : k === 'dataset' ? {} : k === 'innerHTML' || k === 'textContent' || k === 'value' ? ''
  : k === 'children' || k === 'childNodes' ? [] : typeof k === 'string' ? noop : undefined), set: () => true });
const doc = {
  getElementById: () => elStub, querySelector: () => elStub, querySelectorAll: () => [],
  createElement: () => elStub, addEventListener: noop, body: elStub, documentElement: elStub
};
let CFG = null, exported = null, deleted = null;
/* QLD here is the REAL extracted maths over the REAL store — not a hand-written
   stub. So the page's footer/stats are computed from the same code the app runs. */
const QLD = {
  fC: n => '₹' + Math.round(+n || 0).toLocaleString('en-IN'),
  fmt: n => String(n), fDS: d => String(d || ''), fL: n => String(n), daysAgo: () => 0,
  co: { name: 'Gotan Lime Industries', short: 'GOTAN' }, COMPANIES: {}, ownFirmNames: [], activeCo: 'gotan',
  cashbookRows: () => X.cashbookRows(), accountBalances: () => X.accountBalances(),
  cashbookBalances: () => X.cashbookBalances(),
  salesRows: () => [], purchaseRows: () => [], partyRows: () => [],
  bankAccounts: () => [], bankAccountById: () => null, bankAccountLabel: () => '',
  deleteCashEntry: (i, reason) => { deleted = { i, reason }; },
  uiMonth: () => null, setUiMonth: noop
};
const ctx = {
  console, window: {}, document: doc,
  QLShell: { mount: noop, modal: noop, toast: noop, openForm: noop, confirmDelete: noop, openCashForm: noop,
    exportCSV: (name, head, rows) => { exported = { name, head, rows }; } },
  QLD, QLFin: {}, QLMobile: null,
  QLX: { esc: s => String(s == null ? '' : s), svg: () => '', icons: {}, toast: noop, refresh: noop,
    state: () => ({}), actionsCell: () => '', open: noop, close: noop, mount: c => { CFG = c; } },
  setTimeout: noop, clearTimeout: noop, requestAnimationFrame: noop,
  localStorage: { getItem: () => null, setItem: noop }, sessionStorage: { getItem: () => null, setItem: noop },
  location: { href: 'https://app.quicklimes.com/v2/cashbook', search: '', hash: '', pathname: '/v2/cashbook' },
  history: { replaceState: noop, pushState: noop }, navigator: { userAgent: 'node' }, alert: noop, confirm: () => false,
  Date, JSON, Math, Object, Array, Set, Map, String, Number, isNaN, parseFloat, parseInt
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.window.QLD = QLD;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'cashbook.js'), 'utf8'), ctx);
ok(CFG !== null, 'the real cashbook.js mounted and handed over its config');

{
  reset();
  X.addLedgerPayment({ dir: 'in', amount: 10000, method: 'Cash', date: '2026-07-01', party: 'Aziz', ptype: 'Sales Payment' });
  X.addLedgerPayment({ dir: 'out', amount: 4000, method: 'Bank', date: '2026-07-02', party: 'Indian Oil', category: 'Diesel' });
  X.addLedgerPayment({ dir: 'out', amount: 1000, method: 'PhonePe', date: '2026-07-03', party: 'Hamali', category: 'Labour' });
  const rows = CFG.data();

  /* The footer is the number the user reads at the bottom of the register. */
  const f = CFG.footer(rows);
  eq('footer Money In', f[0].value, '₹10,000');
  eq('footer Money Out sums BOTH debits', f[1].value, '₹5,000');
  eq('footer Net = in − out', f[2].value, '₹5,000');

  /* groupSum signs the group subtotals. A credit must be +, a debit −; flipping it
     turns a group of expenses into income. */
  const row = p => rows.find(r => r.party === p);
  eq('groupSum: a credit is positive', CFG.groupSum(row('Aziz')), 10000);
  eq('groupSum: a debit is NEGATIVE', CFG.groupSum(row('Indian Oil')), -4000);
  eq('  and the UPI debit too', CFG.groupSum(row('Hamali')), -1000);

  /* Direction quick-filters. */
  const qf = k => rows.filter(CFG.quickFilters.find(x => x.key === k).test);
  eq('quick filter All', qf('all').length, 3);
  eq('quick filter Money In', qf('credit').map(r => r.party), ['Aziz']);
  eq('quick filter Money Out', qf('debit').length, 2);

  /* The stat cards. Money Out must sum debits only — if it ever included credits
     the card would read ₹15,000 on ₹5,000 of spending. */
  const stats = CFG.stats();
  const stat = l => stats.find(s => s.label === l).value;
  eq('Cash card', stat('Cash'), '₹10,000');
  eq('Bank card', stat('Bank'), '₹-4,000');
  eq('UPI card', stat('UPI'), '₹-1,000');
  eq('Total Balance card', stat('Total Balance'), '₹5,000');
  eq('Money Out card counts debits ONLY', stat('Money Out'), '₹5,000');
  /* The stat cards read accountBalances, so they are RIGHT while the AI insight
     that reads cashbookBalances is wrong on the same screen's data. */
  eq('  the UPI card shows the UPI money that cashbookBalances drops', stat('UPI'), '₹-1,000');

  /* Search — one box over category/party/ref/notes. */
  const search = q => rows.filter(r => CFG.search(r, q));
  eq('search matches party', search('aziz').length, 1);
  eq('search matches category', search('diesel').length, 1);
  eq('search is case-insensitive', search('HAMALI'.toLowerCase()).length, 1);
  eq('search misses nothing it should not', search('zzzz').length, 0);

  /* ✗ BUG C — the Account filter's PhonePe/UPI option is unreachable. */
  const modeF = CFG.filters.find(f => f.key === 'mode');
  eq('the Account filter offers three options', modeF.options().map(o => o[0]), ['cash', 'bank', 'phonepay']);
  eq('  Cash matches', rows.filter(r => modeF.test(r, 'cash')).length, 1);
  eq('  Bank matches', rows.filter(r => modeF.test(r, 'bank')).length, 1);
  eq('  ✗ BUG: "PhonePe / UPI" matches NOTHING — the option is "phonepay", the rows are "upi"',
    rows.filter(r => modeF.test(r, 'phonepay')).length, 0);
  ok(rows.some(r => r.mode === 'upi'),
    '  ✗ BUG: …even though a UPI entry is right there in the register');
  ok(!modeF.options().some(o => o[0] === 'upi'),
    '  ✗ BUG: and there is no "upi" option to pick instead — the money is unfilterable');

  /* Category / Party filters build their options off the live rows. */
  const catF = CFG.filters.find(f => f.key === 'category');
  eq('Category filter lists the real categories', catF.options(rows).map(o => o[0]), ['Diesel', 'Labour']);
  eq('  and filters to them', rows.filter(r => catF.test(r, 'Diesel')).map(r => r.party), ['Indian Oil']);

  /* Export must carry every entry and the real amounts — a CSV that silently drops
     a row is how a reconciliation goes wrong. Driven through the REAL toolbar
     button, so deleting exportCash's wiring fails here. */
  exported = null;
  CFG.tools.find(t => t.label === 'Export').onClick();
  ok(exported !== null, 'the Export button reaches QLShell.exportCSV');
  eq('  it exports every entry', exported.rows.length, 3);
  eq('  with the real amounts, unrounded', exported.rows.map(r => r[5]), [1000, 4000, 10000]);
  eq('  and the direction, so an export can be re-summed', exported.rows.map(r => r[1]), ['debit', 'debit', 'credit']);
  ok(/GOTAN/.test(exported.name), '  the filename names the firm, not another company');

  eq('the register sorts newest-first by default', CFG.sortDefault, { key: 'date', dir: 'desc' });
  eq('the row id is the raw store index (what Delete passes to deleteCashEntry)', CFG.rowId(rows[0]), rows[0].idx);
}

/* ══════════ 7. the page vs the trash, together ══════════
   §4 proves the maths counts trashed money. This proves the PAGE does — the same
   contradiction, through the real config the user looks at. */
{
  reset();
  X.addLedgerPayment({ dir: 'in', amount: 1000, method: 'Bank', date: '2026-07-01', party: 'A' });
  S.CASHBOOK[0]._del = { at: 'x' };
  eq('the register lists no entries', CFG.data().length, 0);
  eq('  and the footer agrees there is no money in', CFG.footer(CFG.data())[0].value, '₹0');
  eq('  ✗ BUG: but the Total Balance card still shows the trashed ₹1,000',
    CFG.stats().find(s => s.label === 'Total Balance').value, '₹1,000');
  ok(/0 entries/.test(CFG.subtitle()) && /₹1,000/.test(CFG.subtitle()),
    '  ✗ BUG: the subtitle literally renders "0 entries · Balance ₹1,000"');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
