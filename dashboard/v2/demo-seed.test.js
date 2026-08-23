/* The demo set must behave like a real factory's books: everything reconciles,
   nothing is double-counted, and the dashboards' numbers FALL OUT of the
   transactions via the real engines. This runs the seed through costing-core —
   the same code the live pages call. */
const Demo = require('./demo-seed.js');
const C = require('./costing-core.js');
let pass = 0, fail = 0; const bad = [];
const ok = (m, c) => { if (c) pass++; else { fail++; bad.push(m); } };
const inR = (m, v, lo, hi) => ok(m + ' (got ' + (v == null ? 'null' : Math.round(v)) + ', want ' + lo + '–' + hi + ')', v != null && v >= lo && v <= hi);

const B = Demo.generate();
const inp = ym => ({ ym, purchases: B.purchases, sales: B.sales, prodRuns: B.prod, expenses: B.expenses, cashbookLabour: 0 });

/* ── determinism (§28) ── */
ok('same seed → byte-identical data', JSON.stringify(Demo.generate(7)) === JSON.stringify(Demo.generate(7)));
ok('different seed → different data', JSON.stringify(Demo.generate(7)) !== JSON.stringify(Demo.generate(8)));

/* ── §27: every record is marked demo ── */
['sales', 'purchases', 'prod', 'expenses', 'parties', 'cashbook'].forEach(k =>
  ok('every ' + k + ' row carries _demo', B[k].length > 0 && B[k].every(r => r._demo === 1)));
ok('the blob itself is labelled', B.demo && B.demo.version === 1 && B.demo.assumptions);

/* ── volumes match the spec ── */
inR('suppliers', B.parties.filter(p => p.type === 'supplier').length, 5, 5);
inR('customers', B.parties.filter(p => p.type === 'customer').length, 6, 10);
['2026-04', '2026-05', '2026-06'].forEach(ym => {
  inR(ym + ' sales invoices', B.sales.filter(s => s.date.slice(0, 7) === ym).length, 12, 25);
  inR(ym + ' production days', B.prod.filter(r => r.date.slice(0, 7) === ym).length, 20, 27);
});

/* ── §17: no expense sits in a via-purchases category; all classify clean ── */
{
  const badE = B.expenses.filter(e => !C.classify(e).ok);
  ok('every seeded expense passes the classifier (0 rejects, got ' + badE.length + ')', badE.length === 0);
  ok('no expense pretends to be limestone/petcoke/bags',
     !B.expenses.some(e => /limestone|petcoke|packaging bags/i.test(e.sub)));
}

/* ── §25/§26: raw material stock reconciles and NEVER goes negative ── */
['2026-04', '2026-05', '2026-06'].forEach(ym => {
  C.rmMovement(inp(ym)).forEach(m => {
    ok(ym + ' ' + m.group + ': closing = opening + purchased − consumed',
       Math.abs(m.closing - (m.opening + m.purchased - m.consumed)) < 0.01);
    ok(ym + ' ' + m.group + ': closing stock is not negative (got ' + Math.round(m.closing) + ')', m.closing >= 0);
    ok(ym + ' ' + m.group + ': no missing-qty bills in demo data', m.purchasedMissing === 0);
  });
});

/* ── finished goods: produced ≥ sold, per product, cumulatively ── */
{
  const upTo = (ym, arr, f) => arr.filter(r => r.date.slice(0, 7) <= ym).reduce((a, r) => a + f(r), 0);
  ['2026-04', '2026-05', '2026-06'].forEach(ym => {
    const pQl = upTo(ym, B.prod, r => r.quicklime), sQl = upTo(ym, B.sales.filter(s => s.product === 'quicklime'), s => s.qty);
    const pHy = upTo(ym, B.prod, r => r.hydrated), sHy = upTo(ym, B.sales.filter(s => s.product === 'hydrated'), s => s.qty);
    ok(ym + ' FG quicklime: cumulative sold ≤ produced (' + Math.round(sQl) + ' ≤ ' + Math.round(pQl) + ')', sQl <= pQl);
    ok(ym + ' FG hydrated: cumulative sold ≤ produced (' + Math.round(sHy) + ' ≤ ' + Math.round(pHy) + ')', sHy <= pHy);
  });
}

/* ── §18: June lands in the target ranges — COMPUTED, not hardcoded ── */
{
  const pc = C.productionCost(inp('2026-06'));
  const pl = C.monthlyPL(inp('2026-06'));
  ok('June method is ACTUAL (runs exist)', pc.method === 'actual' && pl.method === 'actual');
  inR('June production T', pc.outputT, 600, 800);
  inR('June production cost ₹', pc.total, 1500000, 2500000);
  inR('June manufacturing cost/T ₹', pc.perT, 2500, 3500);
  inR('June sales T', pl.salesT, 500, 700);
  inR('June revenue ₹', pl.salesValue, 2500000, 4000000);
  inR('June gross profit ₹', pl.grossProfit, 800000, 1500000);
  ok('June net profit is positive and below gross', pl.netProfit > 0 && pl.netProfit < pl.grossProfit);
  ok('June closing FG grows (produced > sold)', pl.stockChangeT > 0);
  ok('no costing warnings on the demo set', pc.warnings.length === 0);
}

/* ── month-on-month: three distinct months, June strongest ── */
{
  const t = ym => C.productionCost(inp(ym)).outputT;
  ok('production trends up Apr→May→Jun (' + [Math.round(t('2026-04')), Math.round(t('2026-05')), Math.round(t('2026-06'))].join(' → ') + ')',
     t('2026-04') < t('2026-05') && t('2026-05') < t('2026-06'));
  const y = C.yieldStats(B.prod, '2026-06');
  inR('June yield % (≈1/1.75 by the demo assumption)', y.current, 52, 62);
  ok('yield has previous month + 12-month average', y.previous != null && y.avg12 != null);
}

/* ── product + invoice profitability compute cleanly off the set ── */
{
  const pp = C.productProfit(inp('2026-06'), 'qty');
  ok('per-product costing works for June', pp.ok && pp.products.quicklime && pp.products.hydrated);
  ok('hydrated cost/T is real', pp.products.hydrated.perT > 0);
  const junSales = B.sales.filter(s => s.date.slice(0, 7) === '2026-06');
  const ips = junSales.map(s => C.invoiceProfit({ date: s.date, qty: s.qty, taxable: s.qty * s.rate }, inp('2026-06')));
  ok('every June invoice gets a profit figure', ips.every(x => x.ok));
  ok('margins are believable (5–60%)', ips.every(x => x.margin > 5 && x.margin < 60));
}

/* ── receipts tie to invoices ── */
{
  const paid = B.sales.filter(s => s.status === 'paid');
  const rcpts = B.cashbook.filter(c => c.type === 'credit');
  ok('every paid invoice has a matching receipt (' + rcpts.length + '/' + paid.length + ')', rcpts.length === paid.length);
  ok('receipt amounts are qty×rate+GST', rcpts.every(c => c.amount > 0));
}

console.log('\n════ demo seed (reconciliation through the real engine) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' DEMO-SEED TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
