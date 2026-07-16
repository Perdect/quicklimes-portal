/* reports.test.js — loads the REAL data.js in a mocked browser env and tests
   QLD.buildReport: date-range filtering, cancelled/void exclusion, GST/P&L
   date-scoping, and supplier-vs-customer outstanding. Run: node reports.test.js */
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = '' + v; }, removeItem: k => { delete store[k]; } };
global.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.location = { hash: '', hostname: 'localhost', pathname: '/', search: '', replace() {}, href: '' };
global.history = { replaceState() {} };
global.navigator = { userAgent: 'node-test' };
global.document = { addEventListener() {}, createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
global.setTimeout = () => 0;
global.window = global;
localStorage.setItem('ql_plant', JSON.stringify({ id: 'co1', plants: [{ id: 'co1', plant_name: 'Test Co' }], token: 't', role: 'owner', user: { name: 'Tester', role: 'owner' } }));
localStorage.setItem('dm_active_co', 'co1');
global.supabase = { createClient: () => ({ rpc: async () => ({ data: null, error: 'offline' }) }) };
require('./data.js');
const Q = global.QLD;
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const near = (a, b) => Math.abs(a - b) <= 1;

// Two months of sales; one JUNE invoice VOIDED (must be excluded everywhere).
Q.addSale({ inv: 'S-MAY', date: '2026-05-10', party: 'ARIF', qty: 10, rate: 1000, gstR: 5, gstin: '08ARIF0000A1Z0', product: 'Quick Lime' }); // taxable 10000, gst 500
Q.addSale({ inv: 'S-JUN1', date: '2026-06-10', party: 'AMAN', qty: 10, rate: 2000, gstR: 5, gstin: '08AMAN0000A1Z0', product: 'Quick Lime' }); // taxable 20000, gst 1000
Q.addSale({ inv: 'S-JUN2', date: '2026-06-20', party: 'KIRTI', qty: 5, rate: 1000, gstR: 5, gstin: '24KIRT0000A1Z0', product: 'Quick Lime' }); // taxable 5000, gst 250 (INTER-state, 24)
// void S-JUN2
const vi = Q.state.SALES.findIndex(s => s.inv === 'S-JUN2');
Q.voidRecord('sales', vi, 'test void');

// Purchases: one MAY, one JUNE.
Q.addPurchase({ bill: 'P-MAY', date: '2026-05-05', sup: 'RELIANCE', gstin: '24REL0000A1Z0', taxable: 8000, grate: 18, itc: 'Eligible', status: 'pending' }); // gst 1440 itc 1440
Q.addPurchase({ bill: 'P-JUN', date: '2026-06-05', sup: 'IOC', gstin: '24AAACI1681G1ZV', taxable: 4000, grate: 18, itc: 'Eligible', status: 'pending' }); // gst 720 itc 720

const JUN = { from: '2026-06-01', to: '2026-06-30' };

// ── SALES report, June range ──
const rs = Q.buildReport('sales', JUN.from, JUN.to);
ok('sales(June) excludes May + the voided June invoice → 1 row', rs.count === 1);
ok('sales(June) only S-JUN1 present', rs.rows[0][0] === 'S-JUN1');
ok('sales(June) taxable total = 20000 (voided 5000 excluded)', near(rs.totals[6], 20000));
const rsAll = Q.buildReport('sales', null, null);
ok('sales(all) still excludes voided → 2 rows (May+Jun1)', rsAll.count === 2);

// ── GST report, June range: output = S-JUN1 gst 1000 (intra → CGST 500/SGST 500), ITC = P-JUN 720 ──
const g = Q.buildReport('gst', JUN.from, JUN.to);
const gRow = lbl => (g.rows.find(r => r[0] === lbl) || [])[1];
ok('gst(June) CGST = 500', near(gRow('CGST (output)'), 500));
ok('gst(June) SGST = 500', near(gRow('SGST (output)'), 500));
ok('gst(June) IGST = 0 (voided inter-state excluded)', near(gRow('IGST (output)'), 0));
ok('gst(June) output GST = 1000', near(gRow('Total output GST'), 1000));
ok('gst(June) ITC = 720 (only P-JUN)', near(gRow('Less: Input tax credit'), -720));
ok('gst(June) net payable = 280', near(gRow('Net GST payable'), 280));

// ── P&L report, June range: rev 20000, cogs 4000, gp 16000 ──
const pl = Q.buildReport('pl', JUN.from, JUN.to);
const plRow = lbl => (pl.rows.find(r => r[0] === lbl) || [])[1];
ok('pl(June) revenue = 20000', near(plRow('Revenue (taxable)'), 20000));
ok('pl(June) material cost = -4000', near(plRow('Less: Material cost'), -4000));
ok('pl(June) gross profit = 16000', near(plRow('Gross profit'), 16000));

// ── OUTSTANDING = supplier payables (not customer collections) ──
const out = Q.buildReport('outstanding', null, null);
ok('outstanding lists SUPPLIERS', out.headers[0] === 'Supplier');
ok('outstanding includes RELIANCE + IOC', out.rows.some(r => r[0] === 'RELIANCE') && out.rows.some(r => r[0] === 'IOC'));
const coll = Q.buildReport('collections', null, null);
ok('collections lists CUSTOMERS (distinct from outstanding)', coll.headers[0] === 'Customer');

// ── topsuppliers excludes nothing wrong; topcustomers excludes voided ──
const tc = Q.buildReport('topcustomers', JUN.from, JUN.to);
ok('topcustomers(June) excludes voided KIRTI', !tc.rows.some(r => r[1] === 'KIRTI'));

/* ══════════════════════════════════════════════════════════════════
   PART 2 — the PAGE. These load the REAL inline script out of
   reports.html and run it in a vm against the REAL QLD, so they test
   the code the browser runs, not a re-implementation of it.

   The point of every assertion below is that the page TRACKS the
   data. Anything that could pass against hard-coded output (a KPI
   equal to a constant, a trend that is always "12%") is asserted
   twice, against two fixtures with DIFFERENT numbers.
   ══════════════════════════════════════════════════════════════════ */
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML_SRC = fs.readFileSync(path.join(__dirname, 'reports.html'), 'utf8');
const CSS_SRC  = fs.readFileSync(path.join(__dirname, 'reports.css'), 'utf8');
const TOK_SRC  = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8');
const PAGE_SRC = (HTML_SRC.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/) || [])[1];
ok('page: the inline reports.html script was found', !!PAGE_SRC && PAGE_SRC.includes('QLD.buildReport'));

function mkEl() {
  return { textContent: '', innerHTML: '', value: '', dataset: {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, focus() {}, setSelectionRange() {}, click() {}, remove() {} };
}
/* Boot the page against a fixture blob written where data.js reads it. */
function runPage(fixture) {
  localStorage.setItem('ql_data_co1', JSON.stringify(fixture));
  const els = {};
  const doc = { getElementById: id => els[id] || (els[id] = mkEl()), querySelectorAll: () => [],
                createElement: () => mkEl(), addEventListener() {}, body: { appendChild() {} } };
  const ctx = {
    QLD: Q, document: doc, console,
    QLShell: { mount() {}, paintWorkspace() {}, toast() {}, formPrompt() {}, printInvoice() {} },
    setTimeout: () => 0, clearTimeout() {},
    URL: { createObjectURL: () => '', revokeObjectURL() {} }, Blob: function () {}
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(PAGE_SRC, ctx, { filename: 'reports.html#inline' });
  // `let range` is a top-level lexical binding, not a property of the context —
  // read it the only way it is reachable: by evaluating it inside the vm.
  return { ctx, read: () => (els.rhBody ? els.rhBody.innerHTML : ''), sub: () => (els.rhSub ? els.rhSub.textContent : ''),
           peek: expr => vm.runInContext(expr, ctx) };
}
const NOW = new Date();
const dOf = (mOff, day) => { const d = new Date(NOW.getFullYear(), NOW.getMonth() + mOff, day); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const TODAY = `${NOW.getFullYear()}-${String(NOW.getMonth()+1).padStart(2,'0')}-${String(NOW.getDate()).padStart(2,'0')}`;
const LAST = dOf(-1, 15), LAST_B = dOf(-1, 10), LAST_C = dOf(-1, 20), PREV2 = dOf(-2, 15);
const sale = o => ({ inv: 'X', party: 'ARIF', qty: 10, rate: 1000, gstR: 5, gstin: '08ARIF0000A1Z0', product: 'Quick Lime', status: 'pending', ...o });
const kpiVals  = h => (h.match(/<div class="rx-kpi-v">([^<]*)<\/div>/g) || []);
const trendVals = h => (h.match(/class="rx-trend[^"]*">.*?([\d.]+)%<\/span>/g) || []);

/* ── the reports.html:51 bug — `range='month'` opened on an empty view ── */
const pLast = runPage({ sales: [sale({ inv: 'F-LAST', date: LAST })] });
ok('page: default range SKIPS the empty current month and lands on the data', pLast.peek('range') === 'lastmon');
ok('page: the landed default is not the empty state', !/rx-empty/.test(pLast.read()));

const pToday = runPage({ sales: [sale({ inv: 'F-TODAY', date: TODAY })] });
ok('page: default stays on This Month when This Month HAS data', pToday.peek('range') === 'month');

const pQuarterOnly = runPage({ sales: [sale({ inv: 'F-OLD', date: dOf(-8, 15) })] });
ok('page: falls all the way back to a period that has data (never a view of zeros)',
   pQuarterOnly.peek('range') !== 'month' && !/rx-empty/.test(pQuarterOnly.read()));

/* ── every period empty: no crash, honest empty state, no invented rows ── */
const pNone = runPage({ sales: [], purchases: [] });
ok('page: totally empty books do not crash', pNone.read().length > 0);
ok('page: totally empty books render the empty state', /rx-empty/.test(pNone.read()));
ok('page: the empty state names the period that is empty', /Nothing to report in/.test(pNone.read()));
ok('page: with no data anywhere it does NOT offer a nearest period', !/__range\(/.test(pNone.read().split('rx-empty')[1] || ''));
ok('page: the empty state invents no table rows', !/rp-table/.test(pNone.read()));

/* ── the empty state offers the nearest period that HAS data ── */
const pEmptyOffer = runPage({ sales: [sale({ inv: 'F-L', date: LAST })] });
pEmptyOffer.ctx.__range('today');
ok('page: an empty period offers the nearest period that has data', /Show Last Month/.test(pEmptyOffer.read()));
ok('page: ...and still shows the empty state, not fabricated rows', /rx-empty/.test(pEmptyOffer.read()));

/* ── KPIs are COMPUTED: two fixtures, different data → different KPIs ── */
const k1 = runPage({ sales: [sale({ inv: 'K', date: LAST, rate: 1000 })] });   // taxable 10,000
const k2 = runPage({ sales: [sale({ inv: 'K', date: LAST, rate: 3000 })] });   // taxable 30,000
ok('page: KPI cards render', kpiVals(k1.read()).length >= 3);
ok('page: KPI values TRACK the data (differ across fixtures)', kpiVals(k1.read()).join('|') !== kpiVals(k2.read()).join('|'));
ok('page: KPI is the real taxable total for fixture 1', /₹10,000/.test(k1.read()));
ok('page: KPI is the real taxable total for fixture 2', /₹30,000/.test(k2.read()));

/* ── trends are COMPUTED from the real previous period ──
   Both fixtures share the SAME previous month (₹10,000) and differ only in
   the reported month, so a constant trend cannot satisfy both. */
const t1 = runPage({ sales: [sale({ inv: 'P', date: PREV2, rate: 1000 }), sale({ inv: 'C', date: LAST, rate: 2000 })] });  // 10k → 20k = +100%
const t2 = runPage({ sales: [sale({ inv: 'P', date: PREV2, rate: 1000 }), sale({ inv: 'C', date: LAST, rate: 3000 })] });  // 10k → 30k = +200%
ok('page: a trend indicator is drawn when the previous period has data', /rx-trend/.test(t1.read()));
ok('page: trend % TRACKS the data (differs across fixtures)', trendVals(t1.read()).join('|') !== trendVals(t2.read()).join('|'));
ok('page: trend = the real period-over-period change (+100%)', /rx-trend up">.*?100%/.test(t1.read()));
ok('page: trend = the real period-over-period change (+200%)', /rx-trend up">.*?200%/.test(t2.read()));
ok('page: the comparison text quotes the real previous value', /vs ₹10,000 ·/.test(t1.read()));

/* ── NO previous period → NO trend. Not "0%", not a fake. ── */
const tNone = runPage({ sales: [sale({ inv: 'C', date: LAST, rate: 2000 })] });   // nothing in the month before
ok('page: no previous-period data → no trend badge at all', !/rx-trend/.test(tNone.read()));
ok('page: no previous-period data → no comparison line either', !/rx-kpi-c/.test(tNone.read()));
tNone.ctx.__range('all');
ok('page: All time has no previous period → no trend', !/rx-trend/.test(tNone.read()));

/* ── snapshot reports never get a period trend (their numbers ignore from/to) ── */
const snap = runPage({ purchases: [{ bill: 'B1', date: LAST, sup: 'IOC', gstin: '24AAACI1681G1ZV', taxable: 8000, grate: 18, itc: 'Eligible', status: 'pending' }] });
snap.ctx.__type('outstanding');
ok('page: a snapshot report says so', /rx-snap/.test(snap.read()));
ok('page: a snapshot report shows no period trend', !/rx-trend/.test(snap.read()));

/* ── status chips map REAL statuses (paid/pending/overdue/cancelled) ── */
const st = runPage({ sales: [sale({ inv: 'S1', date: LAST, status: 'paid' }), sale({ inv: 'S2', date: LAST, status: 'pending' })] });
const cls = s => st.peek('pillCls(' + JSON.stringify(s) + ')');
ok('page: paid → green chip',     cls('paid') === 'ok');
ok('page: pending → orange chip', cls('pending') === 'warn');
ok('page: overdue → red chip',    cls('overdue') === 'bad');
ok('page: cancelled → grey chip', cls('cancelled') === 'mut');
ok('page: real statuses reach the table as chips', /rp-pill ok">paid</.test(st.read()) && /rp-pill warn">pending</.test(st.read()));

/* ── charts are drawn only where the data supports them ── */
const c1 = runPage({ sales: [sale({ inv: 'C1', date: LAST })] });
ok('page: one data point gets NO trend line (no padded-out chart)', !/Total trend<\/span>/.test(c1.read()));
const c3 = runPage({ sales: [sale({ inv: 'C1', date: LAST_B }), sale({ inv: 'C2', date: LAST }), sale({ inv: 'C3', date: LAST_C })] });
ok('page: three dated rows DO get a real trend line', /Total trend<\/span>/.test(c3.read()));
ok('page: a status mix donut is drawn from the real Status column', /Status mix<\/span>/.test(c3.read()));

/* ── sort is real (and does not invent or drop rows) ── */
const so = runPage({ sales: [sale({ inv: 'A1', date: LAST, rate: 3000 }), sale({ inv: 'A2', date: LAST, rate: 1000 })] });
const firstInv = h => (h.match(/<td class="[^"]*inv[^"]*">([^<]*)<\/td>/) || [])[1];
const beforeInv = firstInv(so.read());
so.ctx.__sort(8);                       // Total, ascending
ok('page: sorting reorders the REAL rows', firstInv(so.read()) !== beforeInv);
ok('page: sorting keeps every row', (so.read().match(/rp-act/g) || []).length === 2);

/* ── existing send / schedule wiring preserved ── */
ok('page: sendToGroup wiring preserved', typeof pLast.ctx.sendToGroup === 'function');
ok('page: addSchedule wiring preserved', typeof pLast.ctx.addSchedule === 'function');
ok('page: addMember / delMember wiring preserved', typeof pLast.ctx.addMember === 'function' && typeof pLast.ctx.delMember === 'function');
ok('page: every report type in data.js is still reachable from the nav',
   Q.REPORT_TYPES.every(t => pLast.read().includes(`__type('${t.id}')`)));
ok('page: recipient chips show the REAL member count', /<em>0<\/em>/.test(pLast.read()));

/* ── STATIC: no dummy data anywhere in the render path ── */
ok('static: no hard-coded money literal in the page script', !/₹\s*\d/.test(PAGE_SRC));
// ...and not smuggled in escaped, which the plain ₹ check above would sail past.
ok('static: no escape-encoded rupee literal', !/\\u20b9|&#8377;|&#x20b9;/i.test(PAGE_SRC));
ok('static: no escape-encoded trend arrow either', !/\\u219[13]|&#86[23][01];/i.test(PAGE_SRC));
// Grouped-digit check runs on the script MINUS the print stylesheet, whose
// rgba()/px values are colours and sizes — never money.
const RENDER_SRC = PAGE_SRC.replace(/<style>[\s\S]*?<\/style>/g, '');
ok('static: the print stylesheet was elided for the digit scan', RENDER_SRC.length < PAGE_SRC.length && RENDER_SRC.includes('QLD.buildReport'));
ok('static: no grouped money-looking number literal (1,24,500)', !/\d{1,3}(,\d{2,3})*,\d{3}\b/.test(RENDER_SRC));
ok('static: no hard-coded percentage inside a string literal', !/["'][^"'\n]{0,30}\b\d+(\.\d+)?\s*%/.test(RENDER_SRC));
ok('static: no hard-coded trend arrow + percentage', !/[↑↓]\s*\d+(\.\d+)?\s*%/.test(PAGE_SRC));
ok('static: no invented "N% from/vs last ..." phrasing', !/\d+(\.\d+)?\s*%\s*(from|vs)\b/i.test(PAGE_SRC));
ok('static: no Math.random / lorem / placeholder rows', !/Math\.random|lorem ipsum|placeholder-row/i.test(PAGE_SRC));

/* ── STATIC: every var(--ql-*) the Reports Hub uses is a REAL token ──
   A phantom token renders as nothing at all, silently. */
const defined = new Set([...TOK_SRC.matchAll(/(--ql-[\w-]+)\s*:/g)].map(m => m[1]));
const used = new Set([...(CSS_SRC + HTML_SRC).matchAll(/var\(\s*(--ql-[\w-]+)/g)].map(m => m[1]));
const missing = [...used].filter(t => !defined.has(t));
ok('static: tokens.css was parsed', defined.has('--ql-brand-600') && defined.has('--ql-card') && defined.size > 40);
ok('static: reports.css/html reference at least the tokens we expect', used.has('--ql-brand-600') && used.size > 20);
ok('static: every var(--ql-*) used exists in tokens.css → ' + (missing.join(', ') || 'none missing'), missing.length === 0);

console.log('\n════ Reports Hub — buildReport + page ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' REPORT TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
