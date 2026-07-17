/* mobile-dash.test.js — the phone dashboard: no tab pills, nothing lost, one period.
 *
 * Two requests, one file, because they share a render:
 *
 * 1. "Dashboard tab pills — remove in mobile version."
 *    mobile.js rendered Overview|Sales|Purchase|Finance|Production as pills. Sixty
 *    pixels below them the bottom nav carried the SAME five words — and meant
 *    something else: the pills swapped a panel in place, the nav navigated to
 *    another page. The trap in "remove the pills" is that they were the only way
 *    to reach four fifths of the dashboard, so deleting the control deletes the
 *    content it gated — silently, looking exactly like success. That is §2.
 *
 * 2. "in the mobile view we don't have this option which important" — the month
 *    filter. The owner picks June on the desktop, walks to the plant gate, opens
 *    the same app on his phone and sees ALL-TIME: same company, same app,
 *    different figures. The missing button was never the whole bug — mobile.js
 *    had no reference to the period AT ALL and every card called the all-time
 *    aggregates. That is §6.
 *
 * It runs the REAL buildDashboard() against a fake DOM, and it loads the REAL
 * dashboard.js — not a stand-in for it. dashboard.js owns the period
 * (window.__qlDashPeriod) and owns monthMetrics(), the function the desktop KPI
 * row renders from; loading it is the only way this file can prove the phone and
 * the desktop agree BY CONSTRUCTION rather than by two authors keeping two sums
 * in step. Asserting on mobile.js's source text would prove the pill markup is
 * absent and nothing whatsoever about what the finance cards say.
 *
 *   node mobile-dash.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ mobile dashboard · no pills · nothing lost · one period ═══\n');

/* ── The books ────────────────────────────────────────────────────────────
   Rows, not summaries: monthMetrics() filters rows by month, so a fixture of
   pre-baked totals could not tell a scoped number from an all-time one — which
   is the entire question here.

   Every month carries different money, and July's figures are nowhere near the
   all-time ones, so a card that quietly reverted to QLD.kpis() would print a
   number this file can name. INV-005 is cancelled: it is July, it is large, and
   no KPI may count it. */
const SALES = [
  { idx: 0, inv: 'INV-001', date: '2026-05-05', party: 'Bikaner Cement', veh: 'RJ-19-GA-0001', taxable: 300000, gst: 15000, total: 315000, paid: 315000, outstanding: 0, qty: 150, status: 'paid' },
  { idx: 1, inv: 'INV-002', date: '2026-06-10', party: 'Marwar Traders', veh: 'RJ-19-GA-0002', taxable: 500000, gst: 25000, total: 525000, paid: 525000, outstanding: 0, qty: 250, status: 'paid' },
  { idx: 2, inv: 'INV-003', date: '2026-07-01', party: 'Aziz Chemicals', veh: 'RJ-19-GA-1234', taxable: 600000, gst: 30000, total: 630000, paid: 400000, outstanding: 230000, qty: 300, status: 'pending' },
  { idx: 3, inv: 'INV-004', date: '2026-07-02', party: 'Marwar Traders', veh: '', taxable: 400000, gst: 20000, total: 420000, paid: 420000, outstanding: 0, qty: 220, status: 'paid' },
  { idx: 4, inv: 'INV-005', date: '2026-07-03', party: 'Voided Traders', veh: '', taxable: 900000, gst: 45000, total: 945000, paid: 0, outstanding: 0, qty: 999, status: 'cancelled' }
];
const PURCHASES = [
  { bill: 'BILL-001', date: '2026-05-05', sup: 'Rajasthan Minerals', taxable: 200000, gst: 10000, itc: 10000, total: 210000, paid: 210000, outstanding: 0, status: 'paid' },
  { bill: 'BILL-002', date: '2026-06-10', sup: 'Jodhpur Freight', taxable: 400000, gst: 20000, itc: 20000, total: 420000, paid: 300000, outstanding: 120000, status: 'pending' },
  { bill: 'BILL-003', date: '2026-07-01', sup: 'Rajasthan Minerals', taxable: 500000, gst: 25000, itc: 25000, total: 525000, paid: 375000, outstanding: 150000, status: 'pending' },
  { bill: 'BILL-004', date: '2026-07-05', sup: 'Jodhpur Freight', taxable: 200000, gst: 10000, itc: 10000, total: 210000, paid: 110000, outstanding: 100000, status: 'pending' }
];
/* July 2026, cancelled excluded — every figure below is hand-computed from the
   rows above, never re-derived by the code under test:
     sales taxable 10,00,000 · invoices 2 · collected 8,20,000 · pending 2,30,000
     purchases 7,00,000 · ITC 35,000 · payable 2,50,000 · bills 2
     qty 520.0 T · gross profit 3,00,000
   All-time, for contrast — the numbers the pre-period cards printed:
     sales taxable 18,00,000 · purchases 13,00,000 · gross profit 5,00,000 */

/* Call counters, not stubs: these are the all-time aggregates the mobile cards
   used to read. The phone must not call them at all now (§6), and only a spy can
   say so — the totals alone cannot, since a correct card and a reverted one both
   render *a* number. dashboard.js legitimately calls kpis()/salesSummary() for
   the desktop, so the count is reset immediately before the phone renders. */
let calls = { kpis: 0, salesSummary: 0, purchaseSummary: 0 };
let savedUiMonth = null;

const MONEY = n => '₹' + Math.round(+n || 0).toLocaleString('en-IN');
const QLD = {
  co: { short: 'GOTAN', name: 'Gotan Lime Udyog' },
  fC: MONEY, fL: MONEY, fDS: d => String(d),
  fmt: (n, d = 0) => Number(n == null ? 0 : n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }),
  salesRows: () => SALES, purchaseRows: () => PURCHASES,
  uiMonth: () => savedUiMonth,
  setUiMonth: p => { savedUiMonth = p; },
  // the real prefix rule (data.js inPeriod), which is what makes 'YYYY-MM' scope a list
  inPeriod: (date, p) => (!p || p === 'all') ? true : String(date || '').slice(0, String(p).length) === String(p),
  monthLabel: (ym, opts) => {
    const blank = (opts && opts.blank) || '';
    ym = (ym || '').toString().slice(0, 7);
    const m = /^(\d{4})-(\d{2})$/.exec(ym);
    if (!m || +m[2] < 1 || +m[2] > 12) return blank;
    return new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: (opts && opts.short) ? 'short' : 'long', year: 'numeric' });
  },
  /* Faithful to data.js: anchored at endYm when given, cancelled rows excluded
     from the buckets. The unanchored fallback is the fixture's July rather than
     the wall clock — every assertion here reaches this through an explicit
     anchor (dAnchor()), so only the desktop's own sparklines take the fallback,
     and a harness that drifts into next month at midnight is not a test. */
  monthSeries: (n = 7, endYm) => {
    const em = /^(\d{4})-(\d{2})$/.exec(String(endYm || ''));
    const end = (em && +em[2] >= 1 && +em[2] <= 12) ? new Date(+em[1], +em[2] - 1, 1) : new Date(2026, 6, 1);
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
      const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      const sal = SALES.filter(s => s.date.slice(0, 7) === ym && s.status !== 'cancelled');
      const pur = PURCHASES.filter(p => p.date.slice(0, 7) === ym && p.status !== 'cancelled');
      const sTx = sal.reduce((a, s) => a + s.taxable, 0), pTx = pur.reduce((a, p) => a + p.taxable, 0);
      out.push({
        ym, m: d.toLocaleDateString('en-IN', { month: 'short' }),
        sales: sal.reduce((a, s) => a + s.total, 0), purchases: pTx, profit: sTx - pTx,
        qty: sal.reduce((a, s) => a + s.qty, 0), invoices: sal.length
      });
    }
    return out;
  },
  /* A balance is an as-of, not a sum over a month, so this takes no period —
     and the Finance cards must therefore NOT move with the picker. */
  accountBalances: () => ({ cash: 40000, bank: 480000, upi: 9000, total: 529000 }),
  kpis: () => { calls.kpis++; return { sales: { v: MONEY(1800000), trend: 4 }, collections: { v: MONEY(230000) }, production: { v: '920.0 T' }, profit: { v: MONEY(500000) }, dispatch: { v: '920.0 T' } }; },
  salesSummary: () => { calls.salesSummary++; return { taxable: 1800000, collected: 1660000, pending: 230000, count: 4, qty: 920 }; },
  purchaseSummary: () => { calls.purchaseSummary++; return { total: 1300000, itc: 65000, pending: 370000, count: 4 }; },
  production: () => ({ month: 520, today: 0 }),
  getPL: () => ({ cogs: 700000, gp: 300000, gpm: 30 }),
  gstSummary: () => ({ net: 15000 }),
  paymentsSummary: () => ({ custOutstanding: 230000, supOutstanding: 370000, inToday: 0, outToday: 0 }),
  purchaseByGroup: () => [], insights: () => [], paymentsInsights: () => [], activity: () => []
  // deliberately no init(): dashboard.js falls through to render(), which is what
  // SEEDS the period to the latest data month. Without that seed there is no period.
};

/* ── a DOM just real enough for buildDashboard + dashboard.js's render ──── */
const REG = {};
function fakeEl(cls) {
  const cl = String(cls || '').split(/\s+/).filter(Boolean);
  const e = {
    get className() { return cl.join(' '); }, set className(v) { cl.length = 0; String(v || '').split(/\s+/).filter(Boolean).forEach(x => cl.push(x)); },
    innerHTML: '', textContent: '', style: {}, children: [], dataset: {}, hidden: false,
    classList: {
      add: (...c) => c.forEach(x => cl.indexOf(x) < 0 && cl.push(x)),
      remove: (...c) => c.forEach(x => { const i = cl.indexOf(x); if (i > -1) cl.splice(i, 1); }),
      toggle: x => (cl.indexOf(x) < 0 ? cl.push(x) : cl.splice(cl.indexOf(x), 1)),
      contains: x => cl.indexOf(x) > -1
    },
    appendChild(c) { e.children.push(c); return c; },
    removeChild(c) { const i = e.children.indexOf(c); if (i > -1) e.children.splice(i, 1); return c; },
    remove() {}, click() {}, contains: n => e.children.indexOf(n) > -1,
    getBoundingClientRect: () => ({ top: 640, bottom: 684, left: 14, right: 200, width: 186, height: 44 }),
    /* One level of class lookup, because buildDashboard's
       `main.querySelector('.qlm-dash')` MUST find the root it appended last
       time — a fake that always answers null would let every rebuild append a
       second dashboard and hide exactly the bug §6 is about. */
    querySelector(sel) { const c = String(sel).replace(/^\./, ''); return e.children.find(x => x.classList && x.classList.contains(c)) || null; },
    querySelectorAll: () => [],
    insertAdjacentHTML() {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null
  };
  return e;
}
const main = fakeEl('ql-main');
const doc = {
  getElementById: id => (id === 'ql-main' ? main : (REG[id] || (REG[id] = fakeEl()))),
  createElement: () => fakeEl(),
  querySelector(sel) { const c = String(sel).replace(/^\./, ''); return doc.body.children.find(x => x.classList && x.classList.contains(c)) || null; },
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  body: fakeEl(), documentElement: fakeEl(), readyState: 'complete'
};

/* QLShell.monthPicker is the app's ONE calendar and is proven elsewhere
   (monthpicker.test.js). Here it is a recorder: what this file has to establish
   is that a tap REACHES it, carrying the period the cards are showing. */
let picker = null;
const QLShell = {
  mount() {},
  toast() {}, csvRow: a => a.join(','),
  monthButton: o => `<button class="ql-mp-btn" id="${o.id}"><span>${o.label}</span></button>`,
  monthPicker(anchor, cfg) {
    picker = { anchor, cfg };
    const mp = fakeEl('ql-mp'); doc.body.appendChild(mp); return mp;
  }
};

const ctx = {
  console, Math, Object, Array, Number, String, Date, JSON, Set, Promise, RegExp, Error,
  isNaN, isFinite, parseFloat, parseInt,
  document: doc, QLD, QLShell,
  matchMedia: () => ({ matches: true, addEventListener() {}, addListener() {} }),   // isMobile() → true
  MutationObserver: function (cb) { return { _cb: cb, observe() {}, disconnect() {} }; },
  requestAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {},
  Blob: function () {}, File: function (parts, name) { this.name = name; },
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  localStorage: { getItem: () => null, setItem() {} },
  sessionStorage: { getItem: () => null, setItem() {} },
  location: { href: 'https://app.quicklimes.com/v2/dashboard', pathname: '/v2/dashboard', search: '', hash: '' },
  history: { replaceState() {}, pushState() {} },
  navigator: { userAgent: 'node', canShare: () => false },   // no share target → shareReport falls back to the desktop download
  innerWidth: 375, innerHeight: 812, performance: { now: () => 0 },
  addEventListener() {}, removeEventListener() {}
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
// dashboard.html's order: mobile.js, then dashboard.js. DP() is read lazily, so
// the order is not load-bearing — but the test should not be the one place it differs.
vm.runInContext(fs.readFileSync(path.join(__dirname, 'mobile.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8'), ctx);

const M = ctx.window.QLMobile;
ok(M && typeof M.buildDashboard === 'function', 'the real mobile.js loaded and exports buildDashboard');
ok(M.isMobile() === true, '  and this harness is a 375px phone (isMobile true) — desktop takes a different path entirely');

const DP = ctx.window.__qlDashPeriod;
ok(DP && typeof DP.metrics === 'function', 'the real dashboard.js loaded and published the period contract mobile reads');
ok(DP && DP.get() === '2026-07', '  and seeded the period to the latest data month (2026-07) — the seed lives in dashboard.js, so the phone inherits it (got ' + (DP && DP.get()) + ')');

calls = { kpis: 0, salesSummary: 0, purchaseSummary: 0 };   // dashboard.js's own desktop render is not the phone's business
M.buildDashboard();
const dash = main.children[0];
ok(dash && typeof dash.innerHTML === 'string' && dash.innerHTML.length > 0, 'buildDashboard rendered a dashboard');
const html = dash.innerHTML;

/* ══════════ 1. THE PILLS ARE GONE ══════════ */
{
  ok(!/qlm-seg/.test(html), 'no .qlm-seg pill bar renders on the mobile dashboard');
  ok(!/data-dt=/.test(html), '  and no data-dt tab buttons — the pills are not merely hidden by CSS');
  ok(!/qlm-seg-btn/.test(html), '  no pill buttons of any kind');

  /* Deleted, not hidden. A `display:none`d control is still built, still in the
     DOM, and comes back the first time someone "fixes" the CSS. */
  const css = fs.readFileSync(path.join(__dirname, 'mobile.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');                 // the comment NAMES the class
  ok(!/\.qlm-seg\s*[{,]/.test(css) && !/\.qlm-seg-btn/.test(css),
    'mobile.css: the .qlm-seg styles are deleted — dead CSS is how a removed control quietly returns (no-fab.test.js)');

  const js = fs.readFileSync(path.join(__dirname, 'mobile.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  ok(!/_dashTab/.test(js), 'mobile.js: the _dashTab selected-tab state is gone, not left dangling at \'overview\'');
}

/* ══════════ 2. NOTHING DISAPPEARED ══════════
   The half that matters. The pills gated four of five sections; if "remove the
   pills" quietly removed the content behind them, every check above still
   passes and the owner loses most of his dashboard.

   Every figure named here is July's, hand-computed from the fixture rows — so
   each assertion does double duty: the card is still on the page AND it is
   showing the period, not the all-time total it used to show. */
{
  // Overview — was the default tab, so it is the one that would have survived a
  // careless removal. Asserted anyway: "the only one left" is a real outcome.
  ok(/Sales · July 2026/.test(html), 'Overview: the Sales KPI is on the page, and carries the period it is showing');
  ok(/Pending · July 2026/.test(html) && /Cash \+ Bank/.test(html), '  Pending + Cash + Bank');
  ok(/Purchase due · July 2026/.test(html) && /Gross profit · July 2026/.test(html), '  Purchase due + Gross profit');

  // Sales — one tap away before; must now be reachable by scrolling.
  ok(/Sales \(excl GST\)/.test(html), 'Sales section: the "Sales (excl GST)" KPI survived the pill removal');
  ok(/₹10,00,000/.test(html), '  and carries July\'s real taxable (10,00,000), not an empty card');
  ok(/Collected/.test(html) && /₹8,20,000/.test(html), '  Collected, with July\'s figure');
  ok(/Invoices/.test(html) && /₹2,30,000/.test(html), '  Invoices + July\'s pending');

  // Purchase.
  ok(/Purchases/.test(html) && /ITC/.test(html), 'Purchase section: Purchases + ITC KPIs survived');
  ok(/₹7,00,000/.test(html) && /₹35,000/.test(html), '  with July\'s purchases and ITC');
  ok(/Payable/.test(html) && /₹2,50,000/.test(html) && /Bills/.test(html), '  Payable + Bills cards too');

  // Finance — the section furthest from the default tab.
  ok(/Total balance/.test(html), 'Finance section: the Total balance KPI survived');
  ok(/₹5,29,000/.test(html), '  with the real total (cash+bank+upi) — a balance is an as-of, so it does NOT move with the picker');
  ok(/UPI/.test(html) && /₹9,000/.test(html) && /₹4,80,000/.test(html), '  UPI + Bank cards too');

  // Production.
  ok(/Dispatched · July 2026/.test(html), 'Production section: the dispatched KPI survived');
  ok(/520\.0 T/.test(html), '  with July\'s real tonnage');
  ok(/Gross profit · July 2026/.test(html) && /₹3,00,000/.test(html), '  and gross profit = July sales − July purchases');

  /* The trend compares against the month BEFORE the picked one — not against
     today: July sales 10,50,000 vs June's 5,25,000 is +100.0%. Note this pair
     cannot by itself prove the trend is ANCHORED, because July is also where an
     un-anchored series would end — the fixture's latest month and its picked
     month are the same. The assertion with teeth is the one under June in §6;
     this one only pins that an arrow is computed at all. */
  ok(/▲ 100\.0%/.test(html) && /vs Jun/.test(html), '  and the trend is measured against the month before the picked one');

  // The charts and the list — content, not chrome, and easy to drop. The titles
  // name the months they actually plot; "last 3 months" stopped being true the
  // moment the chart could be anchored at a picked month.
  ok(/Sales · May – Jul/.test(html), 'the sales chart survived, anchored at the picked month');
  ok(/Purchases · May – Jul/.test(html), 'the purchases chart survived — it was only ever on the Purchase tab');
  ok(/Quantity \(T\) · May – Jul/.test(html), 'the quantity chart survived — Production tab only');
  ok(/Invoices · July 2026/.test(html) && /Aziz Chemicals/.test(html), 'the recent-invoices list survived, with its rows');
  ok(!/Bikaner Cement/.test(html), '  and the list is scoped too — May\'s invoice is not under a July heading');
}

/* ══════════ 3. STACKED, AND EACH SECTION LABELLED ══════════
   The pill WAS the label. Remove it without replacing it and four sets of cards
   run together mid-scroll with nothing saying which is which — content that is
   present but unreadable, which is its own kind of losing it. */
{
  const secs = html.match(/data-dsec="([a-z]+)"/g) || [];
  ok(secs.length === 5, 'all five sections render at once, stacked in one scroll (got ' + secs.length + ')');
  ['overview', 'sales', 'purchase', 'finance', 'production'].forEach(k =>
    ok(secs.some(s => s.indexOf('"' + k + '"') > 0), '  section present: ' + k));

  ['Sales', 'Purchase', 'Finance', 'Production'].forEach(l =>
    ok(new RegExp('<h3>' + l + '</h3>').test(html),
      '  "' + l + '" has a heading — the pill used to be its label, so the label must outlive the pill'));
  /* Overview deliberately has none: the "Welcome back" greeting directly above it
     already says what it is, and a heading there only pushes the KPIs down. */
  ok(/qlm-dash-greet/.test(html) && !/<h3>Overview<\/h3>/.test(html),
    'Overview needs no heading — the greeting above it is the label, and a second one just costs a screenful');
}

/* ══════════ 4. NOTHING IS RENDERED TWICE ══════════
   Overview used to carry the sales chart and the recent-invoice list; so did the
   Sales tab. That was invisible when only one showed at a time — stacked, it
   means scrolling past the same chart twice, which reads as a bug. */
{
  const count = re => (html.match(re) || []).length;
  ok(count(/Sales · May – Jul/g) === 1, 'the sales chart appears ONCE, not once per section that used to own it');
  ok(count(/Invoices · July 2026/g) === 1, 'the recent-invoices list appears ONCE');
}

/* ══════════ 5. DESKTOP IS UNTOUCHED ══════════
   Both requests were explicitly about the mobile view. dashboard.js owns the
   desktop dashboard and its tabs; neither change may have reached it. */
{
  const dj = fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');
  ok(/dx-tab|dxTab/.test(dj), 'dashboard.js still has its desktop tabs — desktop has room, a cursor, and no bottom nav to collide with');
  const mj = fs.readFileSync(path.join(__dirname, 'mobile.js'), 'utf8');
  ok(/if \(!isMobile\(\)\) return;/.test(mj), 'buildDashboard is still gated by isMobile() — desktop never runs this path');
}

/* ══════════ 6. THE PERIOD ══════════
   "in the mobile view we don't have this option which important".
   Three separate things have to be true, and each one has been shipped broken
   on its own: the phone reads the DESKTOP'S period, there is a control to tap,
   and tapping it actually re-scopes the cards. */
{
  /* ── it reads dashboard.js's numbers, not its own ── */
  ok(calls.kpis === 0 && calls.salesSummary === 0 && calls.purchaseSummary === 0,
    'the phone calls NONE of the all-time aggregates (kpis/salesSummary/purchaseSummary) — they take no period, so a card reading them could never agree with the desktop (got ' + JSON.stringify(calls) + ')');
  ok(!/₹18,00,000/.test(html) && !/₹5,00,000/.test(html),
    '  and prints neither the all-time sales (18,00,000) nor the all-time profit (5,00,000) anywhere');

  /* The one assertion that can tell a shared function from a private clone of the
     same arithmetic: swap the OWNER's metrics for a sentinel and the card must
     print the sentinel. Every figure above would look identical if mobile.js had
     quietly grown its own copy of monthMetrics(). */
  const realMetrics = DP.metrics;
  DP.metrics = () => Object.assign(realMetrics(), { salesTax: 12345 });
  M.buildDashboard();
  ok(/₹12,345/.test(dash.innerHTML), 'the Sales card renders dashboard.js\'s OWN monthMetrics() — not a second copy of the same sums living in mobile.js');
  DP.metrics = realMetrics;
  M.buildDashboard();

  /* ── there is something to tap ── */
  const h = dash.innerHTML;
  ok(/id="qlmPeriodBtn"/.test(h) && /ql-mp-btn/.test(h),
    'the period trigger is IN the markup, and it is QLShell.monthButton — the same control the desktop filter bar renders, not a mobile lookalike that can drift');
  ok(/<span>July 2026<\/span>/.test(h), '  and it is labelled with the period actually on screen');

  const btn = doc.getElementById('qlmPeriodBtn');
  ok(typeof btn.onclick === 'function', '  and it is WIRED — openPeriodSheet existed for a whole build with nothing calling it');

  /* ── tapping it opens the app's calendar, on the right month ── */
  picker = null;
  btn.onclick({ stopPropagation() {} });
  ok(picker && picker.anchor === btn, 'a tap reaches openPeriodSheet, which opens QLShell.monthPicker anchored on the button');
  ok(picker && picker.cfg.month === '2026-07', '  opened ON the period the cards are showing, not on \'all\' (got ' + (picker && picker.cfg.month) + ')');
  ok(picker && picker.cfg.have && picker.cfg.have.has('2026-07') && picker.cfg.have.has('2026-05') && picker.cfg.have.size === 3,
    '  with have-dots for the months that actually have data — from dashboard.js\'s availMonths(), so the two calendars mark the same months');
  const mp = doc.querySelector('.ql-mp');
  ok(mp && mp.classList.contains('qlm-mp'), '  and the picker is dressed as a bottom sheet (.qlm-mp) — a 264px popover pinned under a button near the bottom of an 812px screen opens over the thing you tapped');
  ok(doc.body.children.some(c => c.classList.contains('qlm-mp-back')), '  with a backdrop behind it');

  /* ── and picking a month actually moves the phone ──
     The assertion the whole feature reduces to. d.set() re-renders the desktop
     into #dxRoot — a SUBTREE mutation — while buildDashboard's observer watches
     #ql-main for childList only, so it never fires for a pick. Left to the
     observer these cards keep July's numbers under a June heading: a filter that
     visibly does nothing. */
  picker.cfg.onPick('2026-06');
  const jun = dash.innerHTML;
  ok(/Sales · June 2026/.test(jun), 'picking June re-scopes the phone — synchronously, off the pick itself');
  ok(/₹5,00,000/.test(jun), '  to June\'s taxable (5,00,000)');
  ok(!/₹10,00,000/.test(jun), '  and July\'s 10,00,000 is GONE — the cards were rebuilt, not appended to');
  ok(/Sales · Apr – Jun/.test(jun), '  and the charts walked back with it — a chart still ending in July beside June KPIs is the same disagreement in miniature');
  /* June's trend is May→June (+66.7%), July's was June→July (+100.0%). This is
     the assertion that proves the trend is ANCHORED rather than just computed:
     an un-anchored series ends at the latest data month whatever the picker
     says, so it would still print July's +100.0% here. */
  ok(/▲ 66\.7%/.test(jun) && /vs May/.test(jun) && !/▲ 100\.0%/.test(jun),
    '  and so did the trend — measured May→June, not the June→July it would still show if it ignored the pick');
  ok(DP.get() === '2026-06', '  and the period owner moved with it, so the desktop is showing June too — one owner, never two periods');
  ok(savedUiMonth === '2026-06', '  and the pick was written to the shared uiMonth key, so it survives the walk back to the desk');

  /* ── the report the phone shares is the period's ── */
  M.buildDashboard();
  const rb = doc.getElementById('qlmReportBtn');
  ok(typeof rb.onclick === 'function', 'the Report button is wired too — shareReport() was written and never called either');
  let built = null;
  const realBuild = DP.buildReport;
  DP.buildReport = function () { built = realBuild.apply(this, arguments); return built; };
  rb.onclick();
  DP.buildReport = realBuild;
  ok(built && built.lbl === 'June 2026', '  and it builds dashboard.js\'s report for the SELECTED period, so the CSV a phone shares matches the one a desktop downloads (got ' + (built && built.lbl) + ')');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
