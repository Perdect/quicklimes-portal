/* sources-core.test.js — the four independent sources, and the ban on
 * inventing numbers from data that was never uploaded.
 * Covers, by the spec's own numbering:
 *   Ex.1  sales only            → payments/bank "not uploaded", outstanding "cannot calculate"
 *   Ex.2  sales + payments      → outstanding computed, ONLY from allocated receipts
 *   Ex.3  sales + bank          → bank credits are NOT sales collections
 *   Ex.4  all three matched     → every figure real
 *   §10   delete Sales month    → payments, bank, purchase all survive; links dropped
 *   §11   delete Purchase month → same, mirrored
 *   §12   delete Bank month     → sales/purchase/payments survive
 *   §13   delete Payments month → invoices survive, go back to "payment unknown"
 *   §19   ₹0 ≠ "no data"
 * Run: node sources-core.test.js */
const SC = require('./sources-core.js');
let pass = 0, fail = 0; const bad = [];
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : (fail++, bad.push(`${n} → got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)); };
const close = (n, a, b) => { Math.abs(a - b) < 0.01 ? pass++ : (fail++, bad.push(`${n} → got ${a}, want ${b}`)); };
const st = (n, m, want) => eq(n, m.state, want);

const JULY = { from: '2026-07-01', to: '2026-07-31' };

/* ══ Ex.1 — SALES ONLY. Nothing else has ever been uploaded. ══════════ */
const salesOnly = {
  sales: [
    { inv: 'S1', date: '2026-07-02', party: 'DURGA', qty: 100, rate: 6000, gstR: 5, status: 'pending' },
    { inv: 'S2', date: '2026-07-11', party: 'ARIF', qty: 66.667, rate: 6000, gstR: 5, status: 'pending' }
  ],
  purchases: [], cashbook: [], recon: { txns: [] }, statements: []
};
{
  const sc = SC.scan(salesOnly, JULY), m = SC.metrics(sc);
  eq('EX1 · sales source present', sc.sales.present, true);
  eq('EX1 · purchase source absent', sc.purchase.present, false);
  eq('EX1 · payments source absent', sc.payments.present, false);
  eq('EX1 · bank source absent', sc.bank.present, false);
  st('EX1 · sales figure is real', m.sales, 'ok');
  close('EX1 · sales = 10,00,002', m.sales.value, 1000002);
  st('EX1 · payments NOT ₹0 — not recorded', m.received, 'nodata');
  eq('EX1 · payments value is null, never 0', m.received.value, null);
  eq('EX1 · payments says why', m.received.why, 'Payments not recorded');
  st('EX1 · bank NOT ₹0 — not uploaded', m.bankIn, 'nodata');
  eq('EX1 · bank value is null, never 0', m.bankIn.value, null);
  st('EX1 · collected refuses', m.collected, 'nodata');
  /* THE headline bug: the old code answered ₹10,00,002 here. */
  st('EX1 · OUTSTANDING CANNOT BE CALCULATED', m.outstanding, 'nocalc');
  eq('EX1 · outstanding is null, not the whole sales value', m.outstanding.value, null);
  st('EX1 · reconciliation refuses', m.reconciled, 'nodata');
}

/* ══ Ex.2 — SALES + PAYMENTS, receipts allocated to invoices ══════════ */
const salesPay = {
  sales: salesOnly.sales,
  purchases: [],
  cashbook: [
    { date: '2026-07-15', type: 'credit', amount: 600000, party: 'DURGA', link: { kind: 'sale', idx: 0 } }
  ],
  recon: { txns: [] }, statements: []
};
{
  const sc = SC.scan(salesPay, JULY), m = SC.metrics(sc);
  eq('EX2 · payments source now present', sc.payments.present, true);
  eq('EX2 · one receipt is allocated', sc.payments.allocatedIn, 1);
  st('EX2 · collected is real', m.collected, 'ok');
  close('EX2 · collected = 6,00,000', m.collected.value, 600000);
  st('EX2 · outstanding is now computable', m.outstanding, 'ok');
  close('EX2 · outstanding = 4,00,002', m.outstanding.value, 400002);
  st('EX2 · bank still refuses', m.bankIn, 'nodata');
}

/* ══ Ex.2b — receipts exist but NONE are allocated ════════════════════ */
{
  const loose = { ...salesPay, cashbook: [{ date: '2026-07-15', type: 'credit', amount: 600000, party: 'WALK-IN', link: null }] };
  const m = SC.metrics(SC.scan(loose, JULY));
  st('EX2b · money in is real', m.received, 'ok');
  close('EX2b · received = 6,00,000', m.received.value, 600000);
  st('EX2b · but collected-against-invoices refuses', m.collected, 'nocalc');
  st('EX2b · so outstanding refuses too', m.outstanding, 'nocalc');
  eq('EX2b · and says why', m.outstanding.why, 'Receipts exist but none are allocated to an invoice');
}

/* ══ Ex.3 — SALES + BANK, no payment module ══════════════════════════ */
const salesBank = {
  sales: salesOnly.sales, purchases: [], cashbook: [],
  recon: { txns: [{ id: 'T1', date: '2026-07-16', credit: 600000, debit: 0, desc: 'NEFT DURGA' }] },
  statements: [{ id: 'ST1', period: '2026-07' }]
};
{
  const sc = SC.scan(salesBank, JULY), m = SC.metrics(sc);
  st('EX3 · bank credits are real', m.bankIn, 'ok');
  close('EX3 · bank credits = 6,00,000', m.bankIn.value, 600000);
  /* A bank credit is NOT a sales collection until something matches it. */
  st('EX3 · collected still refuses — no payment record', m.collected, 'nodata');
  st('EX3 · outstanding still refuses', m.outstanding, 'nocalc');
  st('EX3 · reconciliation is now meaningful', m.reconciled, 'ok');
  close('EX3 · 0% matched — nothing confirmed yet', m.reconciled.value, 0);
  eq('EX3 · bank line is unmatched', sc.bank.unmatched, 1);
}

/* ══ Ex.4 — ALL THREE, matched ═══════════════════════════════════════ */
const all3 = {
  sales: salesOnly.sales, purchases: [],
  cashbook: [{ date: '2026-07-15', type: 'credit', amount: 600000, party: 'DURGA', link: { kind: 'sale', idx: 0 } }],
  recon: { txns: [{ id: 'T1', date: '2026-07-16', credit: 600000, debit: 0, m: { state: 'matched', kind: 'sale', idx: 0 } }] },
  statements: [{ id: 'ST1', period: '2026-07' }]
};
{
  const sc = SC.scan(all3, JULY), m = SC.metrics(sc);
  st('EX4 · sales ok', m.sales, 'ok');
  st('EX4 · collected ok', m.collected, 'ok');
  st('EX4 · outstanding ok', m.outstanding, 'ok');
  close('EX4 · outstanding = 4,00,002', m.outstanding.value, 400002);
  st('EX4 · reconciled ok', m.reconciled, 'ok');
  close('EX4 · 100% matched', m.reconciled.value, 100);
}

/* ══ §19 — a REAL zero must still print as ₹0 ════════════════════════ */
{
  const zero = { sales: [], purchases: [],
    cashbook: [{ date: '2026-07-05', type: 'credit', amount: 0, party: 'X', link: null }],
    recon: { txns: [] }, statements: [] };
  const m = SC.metrics(SC.scan(zero, JULY));
  st('§19 · a recorded receipt of ₹0 is a real zero', m.received, 'ok');
  close('§19 · and prints as 0', m.received.value, 0);
  st('§19 · while an absent source is never 0', m.bankIn, 'nodata');
}

/* ══ §10-13 — DELETE ONE SOURCE, THE OTHERS SURVIVE ══════════════════ */
const full = {
  sales: [
    { inv: 'S1', date: '2026-07-02', qty: 100, rate: 6000, gstR: 5, status: 'pending' },   // 0 · July
    { inv: 'S2', date: '2026-08-02', qty: 10, rate: 6000, gstR: 5, status: 'pending' }     // 1 · August
  ],
  purchases: [
    { bill: 'P1', date: '2026-07-01', taxable: 200000, status: 'pending' },                 // 0 · July
    { bill: 'P2', date: '2026-08-01', taxable: 50000, status: 'pending' }                   // 1 · August
  ],
  cashbook: [
    { date: '2026-07-15', type: 'credit', amount: 600000, link: { kind: 'sale', idx: 0 } }, // 0 → July sale
    { date: '2026-07-18', type: 'debit', amount: 100000, link: { kind: 'purchase', idx: 0 } }, // 1 → July bill
    { date: '2026-08-05', type: 'credit', amount: 50000, link: null }                       // 2 · unallocated
  ],
  recon: { txns: [
    { id: 'T1', date: '2026-07-16', credit: 600000, m: { state: 'matched', kind: 'sale', idx: 0 } },
    { id: 'T2', date: '2026-07-19', debit: 100000, m: { state: 'matched', kind: 'purchase', idx: 0 } },
    { id: 'T3', date: '2026-08-06', credit: 50000 }
  ] },
  statements: [{ id: 'ST7', period: '2026-07' }, { id: 'ST8', period: '2026-08' }]
};

{ /* §10 — delete July SALES */
  const p = SC.deletePlan(full, 'sales', '2026-07');
  eq('§10 · removes exactly the July sale', p.remove.sales, [0]);
  eq('§10 · touches NO purchase', p.remove.purchases, []);
  eq('§10 · DELETES NO payment', p.remove.cashbook, []);
  eq('§10 · DELETES NO bank line', p.remove.txnIds, []);
  eq('§10 · but drops the now-false payment link', p.unlink.cashbook.map(x => x.idx), [0]);
  eq('§10 · and un-matches the bank line', p.unlink.recon.map(x => x.id), ['T1']);
  eq('§10 · purchases survive', p.keep.purchases, 2);
  eq('§10 · payments survive', p.keep.payments, 3);
  eq('§10 · bank lines survive', p.keep.bank, 3);
  eq('§10 · August sale is untouched', p.remove.sales.indexOf(1), -1);
}
{ /* §11 — delete July PURCHASE */
  const p = SC.deletePlan(full, 'purchase', '2026-07');
  eq('§11 · removes exactly the July bill', p.remove.purchases, [0]);
  eq('§11 · touches NO sale', p.remove.sales, []);
  eq('§11 · deletes no payment', p.remove.cashbook, []);
  eq('§11 · drops the purchase payment link only', p.unlink.cashbook.map(x => x.idx), [1]);
  eq('§11 · un-matches T2 only', p.unlink.recon.map(x => x.id), ['T2']);
  eq('§11 · sales survive', p.keep.sales, 2);
}
{ /* §12 — delete July BANK STATEMENT */
  const p = SC.deletePlan(full, 'bank', '2026-07');
  eq('§12 · removes the July bank lines', p.remove.txnIds, ['T1', 'T2']);
  eq('§12 · and the July statement file', p.remove.statementIds, ['ST7']);
  eq('§12 · sales survive', p.keep.sales, 2);
  eq('§12 · purchases survive', p.keep.purchases, 2);
  eq('§12 · payments survive', p.keep.payments, 3);
}
{ /* §13 — delete July PAYMENTS */
  const p = SC.deletePlan(full, 'payments', '2026-07');
  eq('§13 · removes the July receipts', p.remove.cashbook, [0, 1]);
  eq('§13 · invoices survive', p.keep.sales, 2);
  eq('§13 · bills survive', p.keep.purchases, 2);
  eq('§13 · bank lines survive', p.keep.bank, 3);
  eq('§13 · their invoice links are released', p.unlink.cashbook.map(x => x.idx), [0, 1]);
}
{ /* the picker only offers months that exist */
  eq('picker · sales months', SC.availableMonths(full, 'sales').map(x => x.ym), ['2026-08', '2026-07']);
  eq('picker · bank months', SC.availableMonths(full, 'bank').map(x => x.ym), ['2026-08', '2026-07']);
  eq('picker · a month never uploaded is not offered', SC.availableMonths(full, 'sales').some(x => x.ym === '2026-01'), false);
}
{ /* guard rails */
  let threw = ''; try { SC.deletePlan(full, 'production', '2026-07'); } catch (e) { threw = e.message; }
  eq('guard · unknown module is refused', /unknown module/.test(threw), true);
  threw = ''; try { SC.deletePlan(full, 'sales', 'July'); } catch (e) { threw = e.message; }
  eq('guard · a bad month is refused', /YYYY-MM/.test(threw), true);
}
{ /* re-upload: after a soft delete the month reads empty and the slots stay put */
  const after = JSON.parse(JSON.stringify(full));
  SC.deletePlan(after, 'sales', '2026-07').remove.sales.forEach(i => { after.sales[i]._del = { at: 'test' }; });
  const sc = SC.scan(after, JULY);
  eq('re-upload · July sales now read empty', sc.sales.present, false);
  eq('re-upload · the array slot is still there (indices never shift)', after.sales.length, 2);
  eq('re-upload · August sale still at index 1', after.sales[1].inv, 'S2');
  const aug = SC.scan(after, { from: '2026-08-01', to: '2026-08-31' });
  eq('re-upload · August is untouched', aug.sales.count, 1);
}

console.log('\n════ sources-core (four independent sources · no invented data) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' SOURCES-CORE TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
