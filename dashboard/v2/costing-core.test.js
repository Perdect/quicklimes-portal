/* The ten QA scenarios from the costing spec, as executable tests.
   Fixtures mirror the real row shapes (purchaseRows / salesRows / PROD /
   expense store). Every scenario states what it proves. */
const C = require('./costing-core.js');
let pass = 0, fail = 0; const bad = [];
const ok = (m, c) => { if (c) pass++; else { fail++; bad.push(m); } };
const near = (m, a, b, e) => ok(m + ' (got ' + a + ', want ' + b + ')', a != null && Math.abs(a - b) <= (e == null ? 0.5 : e));

const bill = o => Object.assign({ bill: 'B1', date: '2026-06-05', sup: 'X', group: 'limestone',
  taxable: 100000, qty: 100, status: 'pending' }, o);
const sale = o => Object.assign({ inv: 'S1', date: '2026-06-20', party: 'ARIF', qty: 20,
  taxable: 110000, status: 'pending' }, o);
const run = o => Object.assign({ date: '2026-06-10', kiln: 'K1', limestone: 50, petcoke: 5,
  bags: 0, quicklime: 30, hydrated: 0, labour: 0 }, o);
const exp = o => Object.assign({ id: 'E1', date: '2026-06-12', group: 'production',
  sub: 'Electricity', amount: 10000 }, o);

/* ── SCENARIO 1: purchase → consume → produce → sell → COGS & profit ────── */
{
  const inp = { ym: '2026-06',
    purchases: [bill({ taxable: 100000, qty: 100 })],           // limestone @1000/T
    prodRuns: [run({ limestone: 50, petcoke: 0, quicklime: 30 })],
    sales: [sale({ qty: 20, taxable: 110000 })], expenses: [] };
  const pc = C.productionCost(inp);
  ok('S1 · runs exist so the method is ACTUAL', pc.method === 'actual');
  near('S1 · material cost = consumed 50T × avg rate 1000', pc.total, 50000);
  near('S1 · cost/T = 50000 ÷ 30T produced', pc.perT, 1666.67, 0.5);
  const pl = C.monthlyPL(inp);
  near('S1 · COGS = 20T sold × cost/T (stock absorbs the rest)', pl.cogs, 33333.33, 1);
  near('S1 · gross profit = 110000 − COGS', pl.grossProfit, 76666.67, 1);
  near('S1 · 10T stays in finished stock', pl.stockChangeT, 10);
  const trace = pc.lines.find(l => /Limestone/.test(l.label));
  ok('S1 · TRACE: the line names its bills and its rate', trace && trace.refs.includes('B1') && /avg 1000/.test(trace.detail));
}

/* ── SCENARIO 2: petcoke joins the cost/T ────────────────────────────────── */
{
  const base = { ym: '2026-06', prodRuns: [run({ limestone: 50, petcoke: 5, quicklime: 30 })],
    sales: [], expenses: [] };
  const without = C.productionCost(Object.assign({}, base, { purchases: [bill()] }));
  const withPet = C.productionCost(Object.assign({}, base, {
    purchases: [bill(), bill({ bill: 'B2', group: 'petcoke', taxable: 60000, qty: 10 })] }));  // 6000/T
  near('S2 · petcoke adds consumed 5T × 6000', withPet.total - without.total, 30000);
  ok('S2 · and appears as its own trace line', withPet.lines.some(l => /Petcoke/.test(l.label) && l.amount === 30000));
  ok('S2 · consumed petcoke with NO petcoke purchase is a warning, not a silent zero',
     without.warnings.some(w => /Petcoke .*cannot be costed/i.test(w)));
}

/* ── SCENARIO 3: electricity raises production cost ──────────────────────── */
{
  const base = { ym: '2026-06', purchases: [bill()], prodRuns: [run()], sales: [] };
  const a = C.productionCost(Object.assign({}, base, { expenses: [] }));
  const b = C.productionCost(Object.assign({}, base, { expenses: [exp({ amount: 12000 })] }));
  near('S3 · an electricity expense raises the month cost by exactly itself', b.total - a.total, 12000);
  near('S3 · and cost/T moves with it', b.perT - a.perT, 400);   // 12000/30T
}

/* ── SCENARIO 4: factory overhead allocation ─────────────────────────────── */
{
  const al = C.allocate(500000, [{ key: 'quicklime', qty: 700 }, { key: 'hydrated', qty: 300 }], 'qty');
  near('S4 · 700/1000 of 5,00,000', al.shares.quicklime, 350000);
  near('S4 · 300/1000 of 5,00,000', al.shares.hydrated, 150000);
  const eq = C.allocate(1000, [{ key: 'a' }, { key: 'b' }, { key: 'c' }], 'equal');
  near('S4 · equal split parts sum back to the whole', eq.shares.a + eq.shares.b + eq.shares.c, 1000, 0.001);
  const man = C.allocate(1000, [{ key: 'a' }, { key: 'b' }], 'manual', { a: 60, b: 30 });
  ok('S4 · manual shares that do not reach 100% are refused', !man.ok && /100%/.test(man.error));
  const noQty = C.allocate(1000, [{ key: 'a', qty: 0 }], 'qty');
  ok('S4 · a basis with no data fails loudly, never a silent equal split', !noQty.ok);
  const ovh = C.productionCost({ ym: '2026-06', purchases: [bill()], prodRuns: [run()], sales: [],
    expenses: [exp({ group: 'factory', sub: 'Kiln maintenance', amount: 30000 })] });
  ok('S4 · factory expenses land in the cost as allocated overhead',
     ovh.lines.some(l => /overhead/i.test(l.label) && l.amount === 30000) && ovh.overheadTotal === 30000);
}

/* ── SCENARIO 5: invoice-level profit ────────────────────────────────────── */
{
  const inp = { ym: '2026-06', purchases: [bill({ taxable: 100000, qty: 100 })],
    prodRuns: [run({ limestone: 50, quicklime: 25 })],                   // cost/T = 2000
    sales: [sale({ inv: 'A', qty: 25, taxable: 137500 })],               // 5500/T
    expenses: [exp({ group: 'selling', sub: 'Loading charges', amount: 2000 })] };
  const ip = C.invoiceProfit(inp.sales[0], inp);
  ok('S5 · computes', ip.ok);
  near('S5 · rate/T', ip.ratePerT, 5500);
  near('S5 · manufacturing cost 25T × 2000', ip.mfgCost, 50000);
  near('S5 · the month selling expense rides the invoice tonnage', ip.sellingCost, 2000);
  near('S5 · profit = 137500 − 50000 − 2000', ip.profit, 85500);
  near('S5 · profit/T', ip.profitPerT, 3420);
  near('S5 · margin %', ip.margin, 62.18, 0.05);
}

/* ── SCENARIO 6: multiple products share overhead ────────────────────────── */
{
  const inp = { ym: '2026-06', purchases: [bill({ taxable: 200000, qty: 200 })],
    prodRuns: [run({ limestone: 100, quicklime: 70, hydrated: 0 }),
               run({ date: '2026-06-11', limestone: 40, petcoke: 0, quicklime: 0, hydrated: 30 })],
    sales: [], expenses: [exp({ group: 'overhead', sub: 'Insurance', amount: 10000 })] };
  const pp = C.productProfit(inp, 'qty');
  ok('S6 · per-product costing works when runs name the products', pp.ok);
  near('S6 · overhead splits 70:30 by tonnes', pp.products.quicklime.overheadShare, 7000);
  near('S6 ·   hydrated gets the rest', pp.products.hydrated.overheadShare, 3000);
  near('S6 · the two product costs sum to the month total',
       pp.products.quicklime.cost + pp.products.hydrated.cost, C.productionCost(inp).total, 1);
  const noRuns = C.productProfit({ ym: '2026-06', purchases: [bill()], prodRuns: [], sales: [], expenses: [] }, 'qty');
  ok('S6 · without runs it says WHY per-product is impossible, instead of guessing',
     !noRuns.ok && /runs/.test(noRuns.error));
}

/* ── SCENARIO 7: months are independent ──────────────────────────────────── */
{
  const inp = m => ({ ym: m,
    purchases: [bill({ date: '2026-06-05' }), bill({ bill: 'B7', date: '2026-07-05', taxable: 50000, qty: 40 })],
    prodRuns: [run({ date: '2026-06-10' }), run({ date: '2026-07-10', limestone: 20, quicklime: 10 })],
    sales: [sale({ date: '2026-06-20' }), sale({ inv: 'S7', date: '2026-07-20', qty: 5, taxable: 30000 })],
    expenses: [] });
  const jun = C.monthlyPL(inp('2026-06')), jul = C.monthlyPL(inp('2026-07'));
  ok('S7 · June and July compute independently', jun.productionCost !== jul.productionCost);
  near('S7 · July materials at July rate (20T × 1250)', C.productionCost(inp('2026-07')).total, 25000);
  near('S7 · July sales only', jul.salesValue, 30000);
  const empty = C.monthlyPL(inp('2026-01'));
  ok('S7 · an empty month yields zeros and nulls, never leakage from other months',
     empty.productionCost === 0 && empty.salesValue === 0 && empty.mfgPerT === null);
}

/* ── SCENARIO 8: edits and deletions flow through ────────────────────────── */
{
  const P = [bill({ taxable: 100000, qty: 100 })];
  const R = [run({ limestone: 50, quicklime: 30 })];
  const before = C.productionCost({ ym: '2026-06', purchases: P, prodRuns: R, sales: [], expenses: [] });
  P[0] = Object.assign({}, P[0], { taxable: 120000 });          // edit the bill
  const afterEdit = C.productionCost({ ym: '2026-06', purchases: P, prodRuns: R, sales: [], expenses: [] });
  near('S8 · editing the bill re-rates the consumption (50T × 1200)', afterEdit.total, 60000);
  const afterDel = C.productionCost({ ym: '2026-06', purchases: P,
    prodRuns: [Object.assign({}, R[0], { _del: { at: 'x' } })], sales: [], expenses: [] });
  ok('S8 · deleting the run drops back to PERIOD costing — nothing lingers',
     afterDel.method === 'period' && before.method === 'actual');
  const delExp = C.productionCost({ ym: '2026-06', purchases: P, prodRuns: R, sales: [],
    expenses: [exp({ _del: { at: 'x' } })] });
  near('S8 · a deleted expense contributes nothing', delExp.total, 60000);
}

/* ── SCENARIO 9: the same money is never counted twice ───────────────────── */
{
  const limestone = C.classify({ group: 'production', sub: 'Limestone', date: '2026-06-01', amount: 5000 });
  ok('S9 · limestone REFUSED as an expense — it lives in the Purchase Register',
     !limestone.ok && limestone.viaPurchases && /twice/.test(limestone.error));
  ok('S9 · petcoke likewise', !C.classify({ group: 'production', sub: 'Petcoke', date: '2026-06-01', amount: 1 }).ok);
  ok('S9 · packaging bags likewise', !C.classify({ group: 'production', sub: 'Packaging bags', date: '2026-06-01', amount: 1 }).ok);
  ok('S9 · inbound freight likewise (it is on the bills as freight)',
     !C.classify({ group: 'transport', sub: 'Inbound freight', date: '2026-06-01', amount: 1 }).ok);
  ok('S9 · electricity is fine — it has no other home',
     C.classify({ group: 'production', sub: 'Electricity', date: '2026-06-01', amount: 100 }).ok);
  /* labour: expense entries take over from the cashbook, never both */
  const both = C.productionCost({ ym: '2026-06', purchases: [], prodRuns: [run()], sales: [],
    expenses: [exp({ sub: 'Production labour', amount: 8000 })], cashbookLabour: 5000 });
  near('S9 · with labour in BOTH stores only the expense entry counts', both.total, 8000);
  ok('S9 ·   and a warning names the duplication', both.warnings.some(w => /BOTH/.test(w)));
  const cbOnly = C.productionCost({ ym: '2026-06', purchases: [], prodRuns: [run()], sales: [],
    expenses: [], cashbookLabour: 5000 });
  near('S9 · with no expense labour the cashbook figure is used', cbOnly.total, 5000);
}

/* ── SCENARIO 10: stock and COGS reconcile ───────────────────────────────── */
{
  const inp = { ym: '2026-06', purchases: [bill({ taxable: 100000, qty: 100 })],
    prodRuns: [run({ limestone: 50, quicklime: 30 })],
    sales: [sale({ qty: 20, taxable: 110000 })], expenses: [] };
  const pl = C.monthlyPL(inp), pc = C.productionCost(inp);
  near('S10 · produced − sold = stock change (30 − 20)', pl.stockChangeT, 10);
  near('S10 · COGS + stock-value change = production cost',
       pl.cogs + pl.stockChangeT * pc.perT, pc.total, 1);
  const period = C.monthlyPL({ ym: '2026-06', purchases: [bill()], prodRuns: [],
    sales: [sale()], expenses: [] });
  ok('S10 · under PERIOD costing the stock line is null WITH a reason, never a fake zero',
     period.stockChangeT === null && /runs/.test(period.stockNote));
  ok('S10 · and the method is declared on the result', period.method === 'period' && pl.method === 'actual');
}

/* ── variance guard ──────────────────────────────────────────────────────── */
{
  const E = [exp({ date: '2026-06-01', group: 'factory', sub: 'Spare parts', amount: 1210 }),
             exp({ id: 'E2', date: '2026-05-01', group: 'factory', sub: 'Spare parts', amount: 1000 })];
  const v = C.variance(E, '2026-06', '2026-05');
  near('VAR · +21% month on month', v.find(x => x.group === 'factory').pct, 21);
  const nv = C.variance([exp({ date: '2026-06-01' })], '2026-06', '2026-05');
  ok('VAR · change from an empty base is null, not +100%', nv[0].pct === null);
}

/* ── monthly-spec additions: RM movement + yield ─────────────────────────── */
{
  const P = [bill({ date: "2026-05-10", taxable: 100000, qty: 100 }),
             bill({ bill: "B2", date: "2026-06-05", taxable: 60000, qty: 50 }),
             bill({ bill: "B3", date: "2026-06-08", taxable: 20000, qty: 0 })];
  const R = [run({ date: "2026-05-20", limestone: 40, petcoke: 0, quicklime: 24 }),
             run({ date: "2026-06-15", limestone: 60, petcoke: 0, quicklime: 35 })];
  const m = C.rmMovement({ ym: "2026-06", purchases: P, prodRuns: R })[0];
  near("RM · opening = history bought − history consumed (100−40)", m.opening, 60);
  near("RM · purchased counts only qty-carrying bills", m.purchased, 50);
  ok("RM · the no-qty bill is REPORTED missing, not counted as zero", m.purchasedMissing === 1 && /floor/.test(m.note));
  near("RM · closing = opening + purchased − consumed", m.closing, 50);
  near("RM · month cost includes the no-qty bill — its MONEY is real", m.cost, 80000);
  const noRuns = C.rmMovement({ ym: "2026-06", purchases: P, prodRuns: [] })[0];
  ok("RM · with no runs, opening/closing are null WITH the reason",
     noRuns.opening === null && noRuns.closing === null && /runs/.test(noRuns.note));
  const y = C.yieldStats(R, "2026-06");
  near("YIELD · June 35/60", y.current, 58.33, 0.01);
  near("YIELD · May 24/40", y.previous, 60);
  near("YIELD · delta in points", y.delta, -1.67, 0.01);
  ok("YIELD · best/worst named by month", y.best.ym === "2026-05" && y.worst.ym === "2026-06");
  const none = C.yieldStats([], "2026-06");
  ok("YIELD · no runs → nulls everywhere, never a fake percent",
     none.current === null && none.avg12 === null && none.best === null);
}

console.log('\n════ costing-core (the ten scenarios) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' COSTING TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
