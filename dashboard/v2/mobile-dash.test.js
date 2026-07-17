/* mobile-dash.test.js — the phone dashboard has no tab pills, and lost nothing.
 *
 * "Dashboard tab pills — remove in mobile version."
 *
 * mobile.js rendered Overview|Sales|Purchase|Finance|Production as pills. Sixty
 * pixels below them the bottom nav carried the SAME five words — and meant
 * something else: the pills swapped a panel in place, the nav navigated to
 * another page. Two identical vocabularies with two behaviours, under one thumb.
 * You cannot tell which you are about to get; you find out by being somewhere you
 * did not intend to be.
 *
 * The trap in "remove the pills" is that they were the only way to reach four
 * fifths of the dashboard: dashTabContent(_dashTab) rendered ONE section and the
 * pills switched it. Delete the control and the content it gated goes with it —
 * silently, looking exactly like success. That is this codebase's signature
 * failure (no-fab.test.js §4 exists for the same reason), so the important half
 * of this file is not "the pills are gone" — it is section 2: EVERY section's
 * content is still on the page.
 *
 * It runs the REAL buildDashboard() against a fake DOM. Asserting on mobile.js's
 * source text would prove the pill markup is absent and nothing whatsoever about
 * whether the finance cards still render.
 *
 *   node mobile-dash.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ mobile dashboard · no pills · nothing lost ═══\n');

/* ── a DOM just real enough for buildDashboard ─────────────────────────────
   It needs: querySelector on #ql-main, appendChild, innerHTML, and a
   MutationObserver it can attach. Nothing else — buildDashboard writes one
   subtree and wires nothing now that the pills are gone. */
function fakeEl(cls) {
  const e = {
    className: cls || '', innerHTML: '', style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { e.children.push(c); return c; },
    querySelector: sel => (sel === '.qlm-dash' ? e._dash : null),
    querySelectorAll: () => [],
    insertAdjacentHTML() {}, addEventListener() {}, setAttribute() {}
  };
  return e;
}
const main = fakeEl('ql-main');
const doc = {
  getElementById: id => (id === 'ql-main' ? main : (id === 'qlmDashBody' ? fakeEl() : null)),
  createElement: () => fakeEl(),
  querySelectorAll: () => [], querySelector: () => null,
  addEventListener() {}, body: fakeEl(), documentElement: fakeEl(),
  readyState: 'complete'
};

/* Real numbers, so a card that silently renders ₹0 (or vanishes) is visible.
   Distinct values per section: if two sections' cards were confused, the money
   would tell us. */
const QLD = {
  co: { short: 'GOTAN' },
  fC: n => '₹' + Math.round(+n || 0).toLocaleString('en-IN'),
  fmt: n => String(n),
  kpis: () => ({
    sales: { v: '₹11,00,000', trend: 4 }, collections: { v: '₹2,00,000', meta: '3 due' },
    production: { v: '820 T', trend: 2, meta: 'this month' }, profit: { v: '₹3,00,000', trend: 1, meta: 'net' },
    dispatch: { v: '120 T', meta: 'so far' }
  }),
  accountBalances: () => ({ cash: 40000, bank: 500000, upi: 9000, total: 549000 }),
  purchaseSummary: () => ({ total: 700000, itc: 35000, pending: 250000, count: 12 }),
  salesSummary: () => ({ taxable: 1000000, collected: 800000, pending: 200000, count: 9 }),
  monthSeries: () => [
    { month: '2026-05', sales: 300000, purchases: 200000, qty: 250, profit: 40000 },
    { month: '2026-06', sales: 400000, purchases: 250000, qty: 300, profit: 50000 },
    { month: '2026-07', sales: 300000, purchases: 250000, qty: 270, profit: 30000 }
  ],
  salesRows: () => [
    { idx: 0, party: 'Aziz Chemicals', veh: 'RJ-19-GA-1234', inv: 'INV-001', date: '2026-07-01', total: 60000, status: 'paid' },
    { idx: 1, party: 'Marwar Traders', veh: '', inv: 'INV-002', date: '2026-07-02', total: 40000, status: 'pending' }
  ]
};

const ctx = {
  console, Math, Object, Array, Number, String, Date, JSON, isNaN, parseFloat, RegExp,
  document: doc, QLD, QLShell: { toast() {} },
  matchMedia: () => ({ matches: true, addEventListener() {}, addListener() {} }),   // isMobile() → true
  MutationObserver: function () { return { observe() {}, disconnect() {} }; },
  requestAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {},
  localStorage: { getItem: () => null, setItem() {} },
  sessionStorage: { getItem: () => null, setItem() {} },
  location: { href: 'https://app.quicklimes.com/v2/dashboard', pathname: '/v2/dashboard', search: '', hash: '' },
  history: { replaceState() {}, pushState() {} },
  navigator: { userAgent: 'node' }, innerWidth: 375, innerHeight: 812,
  addEventListener() {}, removeEventListener() {}
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'mobile.js'), 'utf8'), ctx);

const M = ctx.window.QLMobile;
ok(M && typeof M.buildDashboard === 'function', 'the real mobile.js loaded and exports buildDashboard');
ok(M.isMobile() === true, '  and this harness is a 375px phone (isMobile true) — desktop takes a different path entirely');

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
   passes and the owner loses most of his dashboard. Each assertion names a
   number that was only reachable by tapping a pill. */
{
  // Overview — was the default tab, so it is the one that would have survived a
  // careless removal. Asserted anyway: "the only one left" is a real outcome.
  ok(/Sales \(month\)/.test(html), 'Overview: the Sales (month) KPI is on the page');
  ok(/Collections due/.test(html) && /Cash \+ Bank/.test(html), '  Collections due + Cash + Bank');
  ok(/Purchase due/.test(html) && /Profit \(net\)/.test(html), '  Purchase due + Profit (net)');

  // Sales — one tap away before; must now be reachable by scrolling.
  ok(/Sales \(excl GST\)/.test(html), 'Sales section: the "Sales (excl GST)" KPI survived the pill removal');
  ok(/₹10,00,000/.test(html), '  and carries its real number (taxable 10,00,000), not an empty card');
  ok(/Collected/.test(html) && /Invoices/.test(html), '  Collected + Invoices cards too');

  // Purchase.
  ok(/Purchases/.test(html) && /ITC/.test(html), 'Purchase section: Purchases + ITC KPIs survived');
  ok(/₹35,000/.test(html), '  with the real ITC figure');
  ok(/Payable/.test(html) && /Bills/.test(html), '  Payable + Bills cards too');

  // Finance — the section furthest from the default tab.
  ok(/Total balance/.test(html), 'Finance section: the Total balance KPI survived');
  ok(/₹5,49,000/.test(html), '  with the real total (cash+bank+upi)');
  ok(/UPI/.test(html) && /Bank/.test(html), '  UPI + Bank cards too');

  // Production.
  ok(/Total dispatched/.test(html), 'Production section: the Total dispatched KPI survived');
  ok(/820 T/.test(html), '  with its real tonnage');
  ok(/This month/.test(html), '  and the This month card');

  // The charts and the list — content, not chrome, and easy to drop.
  ok(/Sales · last 3 months/.test(html), 'the sales chart survived');
  ok(/Purchases · last 3 months/.test(html), 'the purchases chart survived — it was only ever on the Purchase tab');
  ok(/Quantity · last 3 months/.test(html), 'the quantity chart survived — Production tab only');
  ok(/Recent invoices/.test(html) && /Aziz Chemicals/.test(html), 'the recent-invoices list survived, with its rows');
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
  ok(count(/Sales · last 3 months/g) === 1, 'the sales chart appears ONCE, not once per section that used to own it');
  ok(count(/Recent invoices/g) === 1, 'the recent-invoices list appears ONCE');
}

/* ══════════ 5. DESKTOP IS UNTOUCHED ══════════
   The request was explicitly "in mobile version". dashboard.js owns the desktop
   dashboard and its tabs; this change must not have reached it. */
{
  const dj = fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');
  ok(/dx-tab|dxTab/.test(dj), 'dashboard.js still has its desktop tabs — desktop has room, a cursor, and no bottom nav to collide with');
  const mj = fs.readFileSync(path.join(__dirname, 'mobile.js'), 'utf8');
  ok(/if \(!isMobile\(\)\) return;/.test(mj), 'buildDashboard is still gated by isMobile() — desktop never runs this path');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
