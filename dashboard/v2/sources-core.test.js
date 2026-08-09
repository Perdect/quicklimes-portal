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

/* ══ ONE receipt, recorded TWICE — the real shape in Gotan's book ═════
   receiveSalesPayment (data.js:2314) writes the same event into s.payments[]
   AND into S.CASHBOOK with link:{kind:'sale',idx}. Summing both doubled the
   money: three real receipts totalling ₹3,58,953 were reported as ₹7,17,906
   on the live Group Overview. */
{
  const mirrored = {
    sales: [
      { inv: '15/2026-27', date: '2026-04-23', qty: 20, rate: 5000, gstR: 5, status: 'paid', paid: 104286,
        payments: [{ date: '2026-06-01', amount: 104286, method: 'Bank' }] },
      { inv: '24/2026-27', date: '2026-05-06', qty: 27, rate: 5000, gstR: 5, status: 'paid', paid: 144375,
        payments: [{ date: '2026-06-06', amount: 144375, method: 'Bank' }] },
      { inv: '49/2026-27', date: '2026-06-18', qty: 21, rate: 5000, gstR: 5, status: 'paid', paid: 110292,
        payments: [{ date: '2026-06-03', amount: 110292, method: 'Bank' }] }
    ],
    purchases: [],
    cashbook: [
      { date: '2026-06-01', type: 'credit', amount: 104286, ptype: 'Sales Payment', link: { kind: 'sale', idx: 0 } },
      { date: '2026-06-06', type: 'credit', amount: 144375, ptype: 'Sales Payment', link: { kind: 'sale', idx: 1 } },
      { date: '2026-06-03', type: 'credit', amount: 110292, ptype: 'Sales Payment', link: { kind: 'sale', idx: 2 } }
    ],
    recon: { txns: [] }, statements: []
  };
  const all = { from: null, to: null };
  const sc = SC.scan(mirrored, all), m = SC.metrics(sc);
  close('MIRROR · received counts each receipt ONCE', m.received.value, 358953);
  eq('MIRROR · not the doubled figure', m.received.value === 717906, false);
  eq('MIRROR · three payment records, not six', sc.payments.count, 3);
  eq('MIRROR · three allocations, not six', sc.payments.allocatedIn, 3);
  close('MIRROR · collected = the allocated total', m.collected.value, 358953);
}
/* Legacy shape: the payment lives ONLY on the invoice, nothing in the
   cashbook. It must still be counted — exactly once. */
{
  const legacy = {
    sales: [{ inv: 'L1', date: '2026-04-01', qty: 10, rate: 5000, gstR: 5, status: 'paid', paid: 52500,
              payments: [{ date: '2026-04-10', amount: 52500 }] }],
    purchases: [], cashbook: [], recon: { txns: [] }, statements: []
  };
  const sc = SC.scan(legacy, { from: null, to: null }), m = SC.metrics(sc);
  eq('LEGACY · an invoice-only payment still registers the source', sc.payments.present, true);
  close('LEGACY · counted once', m.received.value, 52500);
  eq('LEGACY · and counts as an allocation', sc.payments.allocatedIn, 1);
}
/* Partial mirror: ₹100 recorded on the invoice, only ₹60 reached the
   cashbook. Count ₹100 — the ledger's ₹60 plus the ₹40 it is missing. */
{
  const partial = {
    sales: [{ inv: 'P1', date: '2026-04-01', qty: 10, rate: 5000, gstR: 5, status: 'partial', paid: 100,
              payments: [{ date: '2026-04-10', amount: 100 }] }],
    purchases: [],
    cashbook: [{ date: '2026-04-10', type: 'credit', amount: 60, link: { kind: 'sale', idx: 0 } }],
    recon: { txns: [] }, statements: []
  };
  const m = SC.metrics(SC.scan(partial, { from: null, to: null }));
  close('PARTIAL · ledger 60 + missing 40 = 100, never 160', m.received.value, 100);
}
/* An unallocated receipt is real money in, but it settles no invoice. */
{
  const mixed = {
    sales: [{ inv: 'X1', date: '2026-04-01', qty: 100, rate: 5000, gstR: 5, status: 'pending' }],
    purchases: [],
    cashbook: [
      { date: '2026-04-10', type: 'credit', amount: 100000, link: { kind: 'sale', idx: 0 } },
      { date: '2026-04-11', type: 'credit', amount: 25000, link: null }
    ],
    recon: { txns: [] }, statements: []
  };
  const sc = SC.scan(mixed, { from: null, to: null }), m = SC.metrics(sc);
  close('ALLOC · money in counts BOTH receipts', m.received.value, 125000);
  close('ALLOC · but only the linked one settles an invoice', m.collected.value, 100000);
  close('ALLOC · so outstanding subtracts 1,00,000 not 1,25,000', m.outstanding.value, 400000);
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
  /* keep.sales counts what LIVES after the delete — the other months of the
     same source. Reporting 0 here (because sales is the target) told the
     owner every invoice was going when only one month was. */
  eq('§10 · the OTHER month of sales survives', p.keep.sales, 1);
  eq('§10 · and is reported as 1 other month', p.sameSource.months, 1);
  eq('§10 · with 1 invoice untouched', p.sameSource.rows, 1);
  eq('§10 · while this month holds 1 invoice', p.sameSource.monthRows, 1);
}
{ /* §11 — delete July PURCHASE */
  const p = SC.deletePlan(full, 'purchase', '2026-07');
  eq('§11 · removes exactly the July bill', p.remove.purchases, [0]);
  eq('§11 · touches NO sale', p.remove.sales, []);
  eq('§11 · deletes no payment', p.remove.cashbook, []);
  eq('§11 · drops the purchase payment link only', p.unlink.cashbook.map(x => x.idx), [1]);
  eq('§11 · un-matches T2 only', p.unlink.recon.map(x => x.id), ['T2']);
  eq('§11 · sales survive', p.keep.sales, 2);
  eq('§11 · the August bill survives', p.keep.purchases, 1);
}
{ /* §12 — delete July BANK STATEMENT */
  const p = SC.deletePlan(full, 'bank', '2026-07');
  eq('§12 · removes the July bank lines', p.remove.txnIds, ['T1', 'T2']);
  eq('§12 · and the July statement file', p.remove.statementIds, ['ST7']);
  eq('§12 · sales survive', p.keep.sales, 2);
  eq('§12 · purchases survive', p.keep.purchases, 2);
  eq('§12 · payments survive', p.keep.payments, 3);
  eq('§12 · the August bank line survives', p.keep.bank, 1);
}
{ /* §13 — delete July PAYMENTS */
  const p = SC.deletePlan(full, 'payments', '2026-07');
  eq('§13 · removes the July receipts', p.remove.cashbook, [0, 1]);
  eq('§13 · invoices survive', p.keep.sales, 2);
  eq('§13 · bills survive', p.keep.purchases, 2);
  eq('§13 · bank lines survive', p.keep.bank, 3);
  eq('§13 · their invoice links are released', p.unlink.cashbook.map(x => x.idx), [0, 1]);
  eq('§13 · the August receipt survives', p.keep.payments, 1);
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

/* ══ THE REAL BANK SHAPE — three bugs found against the live Gotan book ══
   1. blob() persists the store as `reconcile` (data.js:552), not `recon`.
      Reading blob.recon returned undefined for every saved book, so 656 real
      transactions rendered as "Bank statement — not uploaded".
   2. the match field is m.status, not m.state — so nothing ever counted.
   3. a statement file spans months (the live one runs 2026-01-31 →
      2026-05-31); removing its log row on a single-month delete would drop
      the receipt for the other four months. */
{
  const t = (id, date, cr, dr, m) => ({ id, date, credit: cr, debit: dr, m });
  const real = {
    sales: [{ inv: 'S1', date: '2026-06-02', qty: 10, rate: 5000, gstR: 5, status: 'pending' }],
    purchases: [], cashbook: [],
    reconcile: { txns: [                                   // the PERSISTED key
      t('b1', '2026-06-06', 145000, 0, { status: 'matched', kind: 'sale', idx: 0, posted: { batch: 'rb1', lines: [{ kind: 'sale', idx: 0, amount: 144375 }] } }),
      t('b2', '2026-06-03', 111000, 0, { status: 'partial', kind: 'sale', idx: 0 }),
      t('b3', '2026-06-04', 0, 5000, { status: 'other', kind: 'other', cat: 'Interest (CC/OD)' }),
      t('b4', '2026-06-05', 0, 900, { status: 'review', kind: 'purchase', idx: null }),
      t('b5', '2026-05-30', 22000, 0, { status: 'other', kind: 'other', cat: 'Bank charges' })
    ] },
    statements: [
      { id: 'STspan', file: 'loan245.pdf', from: '2026-01-31', to: '2026-05-31', rows: 10, sha: 'abc' },
      { id: 'STjune', file: 'icici_jun.pdf', from: '2026-06-01', to: '2026-06-30', rows: 4, sha: 'def' }
    ]
  };
  const JUNE = { from: '2026-06-01', to: '2026-06-30' };
  const sc = SC.scan(real, JUNE);
  eq('BANK · the persisted `reconcile` key is read', sc.bank.present, true);
  eq('BANK · four June lines', sc.bank.count, 4);
  /* linked = points at a document; classified = interest/charges with no
     document; review with a null idx is neither — it is still open. */
  eq('BANK · two lines point at an invoice', sc.bank.linked, 2);
  eq('BANK · one is classified, no document to point at', sc.bank.classified, 1);
  eq('BANK · one posted a payment', sc.bank.posted, 1);
  eq('BANK · the review line stays open', sc.bank.unmatched, 1);
  const m = SC.metrics(sc);
  st('BANK · reconciliation is computable', m.reconciled, 'ok');
  close('BANK · 3 of 4 resolved = 75%', m.reconciled.value, 75);
  /* the legacy hand-built `recon` spelling still works (our own fixtures) */
  eq('BANK · the `recon` spelling is still accepted', SC.scan({ recon: { txns: [t('x', '2026-06-01', 1, 0, null)] } }, JUNE).bank.count, 1);

  /* deleting June bank: the June-only statement goes, the spanning one is
     kept WITH a warning, because its sha still guards four other months. */
  const p = SC.deletePlan(real, 'bank', '2026-06');
  eq('BANK-DEL · removes the four June lines', p.remove.txnIds, ['b1', 'b2', 'b3', 'b4']);
  eq('BANK-DEL · leaves the May line', p.remove.txnIds.indexOf('b5'), -1);
  eq('BANK-DEL · removes only the June-only statement', p.remove.statementIds, ['STjune']);
  /* June is OUTSIDE the Jan–May file, so there is nothing to warn about. */
  eq('BANK-DEL · no warning for a file that does not cover June', /loan245/.test(p.warnings.join(' ')), false);
  eq('BANK-DEL · the sale survives', p.keep.sales, 1);
  /* March IS inside the spanning file. Its log row must survive (four other
     months depend on it) and the user must be told the sha still blocks the
     re-upload of that exact PDF. */
  const pMar = SC.deletePlan(real, 'bank', '2026-03');
  eq('BANK-DEL · March holds no lines', pMar.remove.txnIds.length, 0);
  eq('BANK-DEL · the spanning file is NOT dropped', pMar.remove.statementIds.length, 0);
  eq('BANK-DEL · but it IS reported by name', /loan245\.pdf/.test(pMar.warnings.join(' ')), true);
  eq('BANK-DEL · and says re-upload would be refused', /duplicate/.test(pMar.warnings.join(' ')), true);
  eq('BANK-DEL · naming the full range it covers', /2026-01 to 2026-05/.test(pMar.warnings.join(' ')), true);
}

console.log('\n════ sources-core (four independent sources · no invented data) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' SOURCES-CORE TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
