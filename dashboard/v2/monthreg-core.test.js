/* Tests for the Monthly Register engine.
   The anchor is the defect the audit found in the live Gotan book: the old
   page showed Sales GST-INCLUSIVE (₹2,26,11,271), Purchases GST-EXCLUSIVE
   (₹1,20,98,470) and a Gross Profit of ₹94,36,073 built from taxable sales.
   On screen, Sales − Purchases = ₹1,05,12,801 — out by ₹10,76,728, exactly
   the output GST. */
const M = require('./monthreg-core.js');
let pass = 0, fail = 0; const bad = [];
const ok = (m, c) => { if (c) pass++; else { fail++; bad.push(m); } };
const near = (m, a, b, e) => ok(m + ' (got ' + a + ', want ' + b + ')', Math.abs(a - b) <= (e == null ? 0.5 : e));

/* Shaped exactly as salesRows()/purchaseRows() hand them over. */
const sale = o => Object.assign({ inv: 'S1', date: '2026-05-10', party: 'ARIF CHEMICAL LIME',
  gstin: '08ALAPD1927C1ZR', qty: 40, taxable: 200000, gst: 10000, total: 210000,
  paid: 0, outstanding: 210000, status: 'pending', product: '' }, o);
const bill = o => Object.assign({ bill: 'B1', date: '2026-05-12', sup: 'Indian Oil Corporation Limited',
  gstin: '24AAACI1681G1ZV', group: 'petcoke', groupLabel: 'Petcoke', qty: 30, taxable: 100000,
  gst: 18000, itc: 18000, total: 118000, paid: 0, outstanding: 118000, status: 'pending' }, o);

/* ── THE DEFECT: THE COLUMNS MUST ADD UP ─────────────────────────────────── */
{
  const S = [sale({ inv: 'A', taxable: 200000, gst: 10000, total: 210000 }),
             sale({ inv: 'B', taxable: 300000, gst: 15000, total: 315000 })];
  const P = [bill({ bill: 'P1', taxable: 100000 })];
  const r = M.monthStats(S, P, '2026-05');

  ok('BASES · netSales is TAXABLE, GST excluded', r.netSales === 500000);
  ok('BASES · grossSales INCLUDES GST', r.grossSales === 525000);
  ok('BASES · they differ by exactly the output GST', r.grossSales - r.netSales === r.gstOut);
  ok('BASES · netPurchases is taxable', r.netPurchases === 100000);

  /* The property the old page violated. */
  ok('ARITHMETIC · gross profit = net sales − net purchases, exactly',
     r.grossProfit === r.netSales - r.netPurchases && r.grossProfit === 400000);
  ok('ARITHMETIC · it is NOT gross sales − net purchases (the old mixed-base bug)',
     r.grossProfit !== r.grossSales - r.netPurchases);
  near('MARGIN · 400000/500000 = 80%', r.margin, 80);
}

/* ── CANCELLED / DELETED / ARCHIVED ARE NOT IN THE BOOK ──────────────────── */
{
  const S = [sale({ inv: 'A' }),
             sale({ inv: 'B', status: 'cancelled' }),
             sale({ inv: 'C', _del: { at: 'x' } }),
             sale({ inv: 'D', _arch: true })];
  const r = M.monthStats(S, [], '2026-05');
  ok('LIVE · a cancelled invoice is excluded — the old register counted it', r.invoices === 1);
  ok('LIVE · deleted and archived are excluded too', r.netSales === 200000);
  ok('LIVE · live() agrees with data.js notCancelled',
     M.live({ status: 'pending' }) && !M.live({ status: 'cancelled' }) &&
     !M.live({ _del: 1 }) && !M.live({ _arch: 1 }));
}

/* ── INDIAN FINANCIAL YEAR: APRIL → MARCH ────────────────────────────────── */
{
  ok('FY · April 2026 is FY 2026-27', M.fyOf('2026-04-01') === '2026');
  ok('FY · March 2027 is STILL FY 2026-27 — the boundary that moves a quarter', M.fyOf('2027-03-31') === '2026');
  ok('FY · April 2027 starts FY 2027-28', M.fyOf('2027-04-01') === '2027');
  ok('FY · January 2027 belongs to the FY that began in 2026', M.fyOf('2027-01-15') === '2026');
  ok('FY · the label reads FY 2026–27', M.fyLabel('2026') === 'FY 2026–27');
  const ms = M.fyMonths('2026');
  ok('FY · twelve months, April first', ms.length === 12 && ms[0] === '2026-04');
  ok('FY · and March of the NEXT calendar year last', ms[11] === '2027-03');
  ok('FY · it crosses the year boundary correctly', ms[8] === '2026-12' && ms[9] === '2027-01');
}

/* ── PURCHASE QUANTITY IS NEVER A BARE NUMBER ────────────────────────────── */
{
  const P = [bill({ bill: 'P1', qty: 30 }), bill({ bill: 'P2', qty: 0 }), bill({ bill: 'P3', qty: 0 })];
  const r = M.monthStats([], P, '2026-05');
  ok('QTY · purchase quantity reports what is recorded and what is missing',
     r.purchaseQty.qty === 30 && r.purchaseQty.recorded === 1 && r.purchaseQty.missing === 2);
  ok('QTY · it is an object, never a bare total that hides the gap',
     typeof r.purchaseQty === 'object');
  ok('QTY · purchase rate/T uses only the recorded tonnage',
     r.purchaseRatePerT === Math.round(300000 / 30 * 100) / 100);
  const none = M.monthStats([], [bill({ qty: 0 })], '2026-05');
  ok('QTY · with no tonnage at all the rate is null, not 0 or Infinity', none.purchaseRatePerT === null);
}

/* ── THINGS THAT DO NOT EXIST ARE null, NEVER 0 ──────────────────────────── */
{
  const r = M.monthStats([sale({})], [bill({})], '2026-05');
  ok('UNAVAILABLE · sales returns are null — there is no store for them', r.salesReturns === null);
  ok('UNAVAILABLE · purchase returns are null', r.purchaseReturns === null);
  ok('UNAVAILABLE · credit and debit notes are null', r.creditNotes === null && r.debitNotes === null);
  ok('UNAVAILABLE · a totals row does not turn them into zeros',
     M.totals([r]).salesReturns === null);
  /* product is present on every sales row and empty on every one of them. */
  ok('UNAVAILABLE · sales-by-product is null when no row carries a product',
     M.salesAnalysis(r).products === null);
  ok('AVAILABLE · purchase-by-material IS real — group is populated',
     M.purchaseAnalysis(r).materials.length === 1);
}

/* ── GST SPLIT ───────────────────────────────────────────────────────────── */
{
  const S = [sale({ inv: 'A', gstin: '08ALAPD1927C1ZR', gst: 10000 }),   // Rajasthan → CGST+SGST
             sale({ inv: 'B', gstin: '24AAACI1681G1ZV', gst: 6000 }),    // Gujarat   → IGST
             sale({ inv: 'C', gstin: '', gst: 4000 })];                  // unknown   → intra
  const r = M.monthStats(S, [], '2026-05');
  near('GST · IGST is only the inter-state sale', r.igstOut, 6000);
  near('GST · CGST is half of the intra-state tax', r.cgstOut, 7000);
  near('GST · SGST matches CGST', r.sgstOut, 7000);
  near('GST · the three add back to output GST', r.cgstOut + r.sgstOut + r.igstOut, r.gstOut);
  const p = M.monthStats([], [bill({ itc: 18000 })], '2026-05');
  ok('GST · input GST is ITC — an ineligible or RCM bill contributes none', p.gstIn === 18000);
  ok('GST · net position is output − input', M.totals([r, p]).netGst === r.gstOut - 18000);
}

/* ── COMPARISON ──────────────────────────────────────────────────────────── */
{
  const S = [sale({ inv: 'A', date: '2026-05-10', taxable: 120000, gst: 6000, total: 126000 }),
             sale({ inv: 'P', date: '2026-04-10', taxable: 100000, gst: 5000, total: 105000 })];
  const c = M.compare(S, [], '2026-05', 'month');
  ok('COMPARE · the base month is the previous one', c.baseMonth === '2026-04' && c.hasBase);
  near('COMPARE · +20% on net sales', c.deltas.netSales.pct, 20);
  const y = M.compare(S, [], '2026-05', 'year');
  ok('COMPARE · year mode reaches back to the same month last year', y.baseMonth === '2025-05');
  ok('COMPARE · and reports there is no base rather than inventing one', !y.hasBase);

  ok('COMPARE · a change from zero is null, not +100% — that would be a made-up trend',
     M.pctChange(500, 0) === null);
  ok('COMPARE · a change to zero from a real base IS reportable', M.pctChange(0, 500) === -100);
  /* Margin moves in points. */
  const m2 = M.compare([sale({ date: '2026-05-01', taxable: 100000, gst: 5000 }),
                        sale({ date: '2026-04-01', taxable: 100000, gst: 5000 })],
                       [bill({ date: '2026-05-01', taxable: 20000 }), bill({ date: '2026-04-01', taxable: 40000 })],
                       '2026-05', 'month');
  near('COMPARE · margin is reported in PERCENTAGE POINTS (80% vs 60% = +20 pts)', m2.deltas.margin.pts, 20);
}

/* ── AGEING ──────────────────────────────────────────────────────────────── */
{
  const rows = [
    { date: '2026-08-20', outstanding: 1000 },   // 2 days
    { date: '2026-07-01', outstanding: 2000 },   // 52 days
    { date: '2026-01-01', outstanding: 4000 },   // 233 days
    { date: '2026-08-20', outstanding: 0 }       // settled — not aged
  ];
  const a = M.ageing(rows, '2026-08-22');
  near('AGEING · a 2-day-old bill lands in 1–30 days', a.d30.amount, 1000);
  near('AGEING · a 52-day-old bill lands in 31–60', a.d60.amount, 2000);
  near('AGEING · a 233-day-old bill lands in 90+', a.d90p.amount, 4000);
  ok('AGEING · a settled invoice is not aged at all', a.total === 7000);
  near('AGEING · overdue excludes the not-yet-due bucket', a.overdue, 7000);
  ok('AGEING · asOf is passed in, so the answer is stable and testable',
     M.ageing(rows, '2026-08-22').d30.amount === 1000);
}

/* ── RECONCILIATION ──────────────────────────────────────────────────────── */
{
  const S = [sale({ inv: 'A', date: '2026-05-01' }), sale({ inv: 'B', date: '2026-06-01' }),
             sale({ inv: 'X', date: '2026-06-02', status: 'cancelled' })];
  const P = [bill({ bill: 'P1', date: '2026-05-01' })];
  const rows = M.register(S, P);
  const rec = M.reconcile(S, P, rows);
  ok('RECONCILE · a healthy book passes every check', rec.ok && rec.failed.length === 0);
  ok('RECONCILE · counts match the source rows, cancelled excluded on both sides',
     rec.checks.find(c => /invoice count/.test(c.k)).got === 2);
  ok('RECONCILE · it checks that gross profit = net sales − net purchases',
     rec.checks.some(c => /Gross profit =/.test(c.k)));
  ok('RECONCILE · and that the GST components add back to the total',
     rec.checks.some(c => /CGST \+ SGST \+ IGST/.test(c.k)));

  /* Feed it a deliberately wrong row set and it must SAY so, not hide it. */
  const wrong = rows.slice(0, 1);
  ok('RECONCILE · a discrepancy is reported, never swallowed',
     !M.reconcile(S, P, wrong).ok && M.reconcile(S, P, wrong).failed.length > 0);
}

/* ── TOTALS AGREE WITH THE ROWS ABOVE THEM ───────────────────────────────── */
{
  const S = [sale({ inv: 'A', date: '2026-05-01', taxable: 100000, gst: 5000, total: 105000, qty: 20 }),
             sale({ inv: 'B', date: '2026-06-01', taxable: 300000, gst: 15000, total: 315000, qty: 60 })];
  const P = [bill({ bill: 'P1', date: '2026-05-01', taxable: 50000 })];
  const rows = M.register(S, P), t = M.totals(rows);
  ok('TOTALS · newest month first', rows[0].ym === '2026-06');
  ok('TOTALS · the footer is the sum of the column above it',
     t.netSales === 400000 && t.invoices === 2 && t.bills === 1);
  ok('TOTALS · and its gross profit is still net − net', t.grossProfit === 350000);
  near('TOTALS · quantity adds up', t.salesQty, 80);
  near('TOTALS · profit per tonne is derived from the totals, not averaged', t.profitPerT, 350000 / 80);
}

/* ── EMPTY AND EDGE ──────────────────────────────────────────────────────── */
{
  const e = M.monthStats([], [], '2026-05');
  ok('EMPTY · a month with nothing in it does not throw', e.invoices === 0 && e.netSales === 0);
  ok('EMPTY · margin is null, not 0% — there is no margin on no sales', e.margin === null);
  ok('EMPTY · average invoice is null, not ₹0', e.avgInvoice === null);
  ok('EMPTY · rate per tonne is null, never Infinity', e.salesRatePerT === null && e.profitPerT === null);
  ok('EMPTY · the register of an empty book is an empty list', M.register([], []).length === 0);
  ok('EMPTY · totals of nothing are zeros with null ratios',
     M.totals([]).netSales === 0 && M.totals([]).margin === null);

  const neg = M.monthStats([sale({ taxable: 100000, gst: 5000 })], [bill({ taxable: 400000 })], '2026-05');
  ok('NEGATIVE · a loss-making month reports a negative profit', neg.grossProfit === -300000);
  near('NEGATIVE · and a negative margin', neg.margin, -300);
}

/* ── EXCEPTIONS ──────────────────────────────────────────────────────────── */
{
  const S = [sale({ inv: 'A', outstanding: 210000 }),
             sale({ inv: 'A' }),                                  // duplicate number, same party
             sale({ inv: 'C', gstin: '', outstanding: 0 }),
             sale({ inv: 'D', qty: 0, outstanding: 0 })];
  const r = M.monthStats(S, [bill({ qty: 0 })], '2026-05');
  const ex = M.exceptions(r);
  const find = re => ex.find(e => re.test(e.label));
  ok('EXCEPT · unpaid invoices are surfaced with their money', find(/not yet paid/).amount > 0);
  ok('EXCEPT · a missing customer GSTIN is surfaced', find(/no customer GSTIN/).count === 1);
  ok('EXCEPT · an invoice with no quantity is surfaced', find(/no quantity/).count >= 1);
  ok('EXCEPT · a duplicate invoice number is surfaced — the Indian Oil check',
     find(/Duplicate/) && find(/Duplicate/).count === 1);
  ok('EXCEPT · purchase bills with no quantity are surfaced', find(/Purchase bills with no quantity/).count === 1);
  ok('EXCEPT · nothing is reported when there is nothing wrong',
     M.exceptions(M.monthStats([sale({ outstanding: 0, qty: 5 })], [], '2026-05'))
       .every(e => !/Duplicate|Negative/.test(e.label)));
}

/* ── INSIGHTS ARE DERIVED, NOT DECORATIVE ────────────────────────────────── */
{
  const S = [sale({ inv: 'A', party: 'ARIF CHEMICAL LIME', taxable: 400000, gst: 20000, qty: 80, paid: 0 }),
             sale({ inv: 'B', party: 'AMAN ENTERPRISES', taxable: 100000, gst: 5000, qty: 20, paid: 0 })];
  const r = M.monthStats(S, [bill({})], '2026-05');
  const ins = M.insights(r, M.compare(S, [], '2026-05', 'month'), M.salesAnalysis(r), M.purchaseAnalysis(r));
  ok('INSIGHT · the largest customer is named with its real share',
     ins.some(i => /ARIF CHEMICAL LIME/.test(i.text) && /80%/.test(i.text)));
  ok('INSIGHT · the average selling rate quotes the real figure',
     ins.some(i => /5,000\/T/.test(i.text)));
  ok('INSIGHT · nothing generic is emitted for an empty month',
     M.insights(M.monthStats([], [], '2026-05'), null, null, null).length === 0);
}

console.log('\n════ monthreg-core (the register must add up) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' MONTHLY-REGISTER TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
