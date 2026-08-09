/* month-apply.test.js — executing a month delete against a live book.
 * The rule under test, in one line: deleting one source deletes ONLY that
 * source, and the money is never deleted — only the tick that said which
 * invoice it belonged to.
 * Run: node month-apply.test.js */
const SC = require('./sources-core.js');
const MA = require('./month-apply.js');
let pass = 0, fail = 0; const bad = [];
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : (fail++, bad.push(`${n} → got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)); };
const close = (n, a, b) => { Math.abs(a - b) < 0.01 ? pass++ : (fail++, bad.push(`${n} → got ${a}, want ${b}`)); };

/* A book shaped like the real one: a posted bank line that created a cash
   book receipt against a July invoice, plus August rows that must survive. */
function book() {
  return {
    sales: [
      { inv: 'J1', date: '2026-07-02', qty: 20, rate: 5000, gstR: 5, status: 'paid', paid: 105000 },  // 0
      { inv: 'J2', date: '2026-07-14', qty: 10, rate: 5000, gstR: 5, status: 'pending' },             // 1
      { inv: 'A1', date: '2026-08-03', qty: 30, rate: 5000, gstR: 5, status: 'pending' }              // 2
    ],
    purchases: [
      { bill: 'PJ', date: '2026-07-01', taxable: 200000, status: 'pending' },                          // 0
      { bill: 'PA', date: '2026-08-01', taxable: 50000, status: 'pending' }                            // 1
    ],
    cashbook: [
      { id: 'cb1', date: '2026-07-20', type: 'credit', amount: 105000, link: { kind: 'sale', idx: 0 } },       // 0
      { id: 'cb2', date: '2026-07-21', type: 'debit', amount: 40000, link: { kind: 'purchase', idx: 0, freightId: 'fr9' } }, // 1
      { id: 'cb3', date: '2026-08-02', type: 'credit', amount: 9000, link: null }                              // 2
    ],
    reconcile: { txns: [
      { id: 'T1', date: '2026-07-22', credit: 105000, debit: 0,
        bank: 'ICICI', accountId: 'ac1', utr: 'UTR123',
        m: { status: 'matched', kind: 'sale', idx: 0, confidence: 96, manual: true, cat: 'Sales receipt',
             posted: { batch: 'rb1', at: '2026-07-22', cashbookIds: ['cb1'], lines: [{ kind: 'sale', idx: 0, amount: 105000, cashbookId: 'cb1' }] } } },
      { id: 'T2', date: '2026-07-23', credit: 0, debit: 5000, m: { status: 'other', kind: 'other', cat: 'Bank charges' } },
      { id: 'T3', date: '2026-08-04', credit: 9000, debit: 0, m: { status: 'review', kind: 'sale', idx: null } }
    ] },
    statements: [
      { id: 'STjul', file: 'jul.pdf', from: '2026-07-01', to: '2026-07-31', sha: 'aaa' },
      { id: 'STaug', file: 'aug.pdf', from: '2026-08-01', to: '2026-08-31', sha: 'bbb' }
    ]
  };
}
const ctxOf = (b, extra) => Object.assign({
  sales: b.sales, purchases: b.purchases, cashbook: b.cashbook,
  txns: b.reconcile.txns, statements: b.statements,
  who: { by: 'test', role: 'owner' }, at: '2026-08-09T00:00:00Z',
  audits: [], logAudit(a, m, r, meta) { this.audits.push({ a, m, ref: meta.ref, reason: meta.reason }); },
  commits: 0, commit() { this.commits++; }
}, extra || {});

/* ══ DELETE JULY SALES ═══════════════════════════════════════════════ */
{
  const b = book(), ctx = ctxOf(b);
  const plan = SC.deletePlan(b, 'sales', '2026-07');
  const r = MA.applyPlan(plan, ctx);

  eq('SALES · both July invoices are gone', b.sales.filter(s => s._del).map(s => s.inv), ['J1', 'J2']);
  eq('SALES · August invoice survives', !!b.sales[2]._del, false);
  eq('SALES · array slots never move — August is still index 2', b.sales[2].inv, 'A1');
  eq('SALES · the purchase register is untouched', b.purchases.some(p => p._del), false);

  /* THE MONEY */
  eq('MONEY · no cash book row was deleted', b.cashbook.some(e => e._del), false);
  close('MONEY · the receipt still holds its amount', b.cashbook[0].amount, 105000);
  eq('MONEY · but its invoice tick is released', b.cashbook[0].link.idx, null);
  eq('MONEY · and we remember what it was', b.cashbook[0].link._wasIdx, 0);
  eq('MONEY · the purchase receipt keeps its tick', b.cashbook[1].link.idx, 0);
  eq('MONEY · report names the released amount', r.money.unlinked, 105000);

  /* THE BANK LINE */
  const t1 = b.reconcile.txns.find(t => t.id === 'T1');
  eq('BANK · the line itself is NOT deleted', !!t1, true);
  eq('BANK · it is back to unmatched', t1.m.status, 'unmatched');
  eq('BANK · pointing at nothing', t1.m.idx, null);
  eq('BANK · manual is ABSENT — else it renders as Matched forever', 'manual' in t1.m, false);
  eq('BANK · stale fields are gone, not patched over', 'cat' in t1.m, false);
  eq('BANK · it says why in plain words', /removed/.test(t1.m.reasons.join(' ')), true);
  eq('BANK · the txn itself keeps its identity', [t1.bank, t1.accountId, t1.utr].join('|'), 'ICICI|ac1|UTR123');
  /* the posted stamp is the ONLY guard against paying the same line twice */
  eq('BANK · the posted stamp SURVIVES', !!t1.m.posted, true);
  eq('BANK · flagged orphaned', t1.m.posted.orphaned, true);
  eq('BANK · its dead index is neutralised', t1.m.posted.lines[0].idx, null);
  eq('BANK · but remembered', t1.m.posted.lines[0].wasIdx, 0);
  eq('BANK · and the user is told', /never posted again/.test(t1.m.reasons.join(' ')), true);
  eq('BANK · the bank-charges line is left alone', b.reconcile.txns[1].m.status, 'other');
  eq('BANK · no bank line was removed', b.reconcile.txns.length, 3);
  eq('BANK · no statement was removed', b.statements.length, 2);

  /* ONE commit, ONE audit line */
  eq('LOG · exactly one commit for the whole month', ctx.commits, 1);
  eq('LOG · exactly one audit row', ctx.audits.length, 1);
  eq('LOG · keyed by month', ctx.audits[0].ref, 'MONTH:2026-07');
  eq('LOG · naming what happened', /2 rows.*1 receipts unlinked.*1 bank lines/.test(ctx.audits[0].reason), true);
  eq('RECEIPT · counts', [r.removed, r.unlinkedPayments, r.unlinkedBank, r.postedKept], [2, 1, 1, 1]);
}

/* ══ THE MONTH READS EMPTY, AND RE-UPLOAD LANDS CLEAN ════════════════ */
{
  const b = book();
  MA.applyPlan(SC.deletePlan(b, 'sales', '2026-07'), ctxOf(b));
  const jul = SC.scan(b, { from: '2026-07-01', to: '2026-07-31' });
  eq('AFTER · July sales read empty', jul.sales.present, false);
  eq('AFTER · July purchase still there', jul.purchase.present, true);
  eq('AFTER · July receipts still there', jul.payments.present, true);
  eq('AFTER · July bank lines still there', jul.bank.present, true);
  const aug = SC.scan(b, { from: '2026-08-01', to: '2026-08-31' });
  eq('AFTER · August is untouched', aug.sales.count, 1);
  /* re-upload: the same invoice numbers come back in fresh slots */
  b.sales.push({ inv: 'J1', date: '2026-07-02', qty: 20, rate: 5000, gstR: 5, status: 'pending' });
  const back = SC.scan(b, { from: '2026-07-01', to: '2026-07-31' });
  eq('REUPLOAD · July has rows again', back.sales.count, 1);
  eq('REUPLOAD · and the old slot stayed put', b.sales[0]._del ? b.sales[0].inv : 'MOVED', 'J1');
}

/* ══ DELETE JULY BANK ════════════════════════════════════════════════ */
{
  const b = book(), ctx = ctxOf(b);
  const r = MA.applyPlan(SC.deletePlan(b, 'bank', '2026-07'), ctx);
  eq('BANKDEL · July lines are gone', b.reconcile.txns.map(t => t.id), ['T3']);
  eq('BANKDEL · the July statement log row is SPLICED', b.statements.map(s => s.id), ['STaug']);
  eq('BANKDEL · (a _del row would still block the corrected PDF)', b.statements.length, 1);
  eq('BANKDEL · sales survive', b.sales.some(s => s._del), false);
  eq('BANKDEL · purchases survive', b.purchases.some(p => p._del), false);
  eq('BANKDEL · receipts survive with their ticks intact', b.cashbook[0].link.idx, 0);
  eq('BANKDEL · statement count reported', r.statements, 1);
}

/* ══ STALENESS — the plan must still describe the book ═══════════════ */
{
  const b = book();
  const plan = SC.deletePlan(b, 'sales', '2026-07');
  eq('VERIFY · a fresh plan verifies', MA.verify(plan, b).ok, true);
  b.sales.push({ inv: 'J3', date: '2026-07-28', qty: 5, rate: 5000, gstR: 5, status: 'pending' });
  eq('VERIFY · an import landing after the preview is caught', MA.verify(plan, b).ok, false);
  eq('VERIFY · and the fresh plan has the new row', MA.verify(plan, b).fresh.remove.sales, [0, 1, 3]);
}

/* ══ THE UNLINK NEVER DROPS A HANDLE ANOTHER FEATURE NEEDS ══════════ */
{
  const b = book(), ctx = ctxOf(b);
  MA.applyPlan(SC.deletePlan(b, 'purchase', '2026-07'), ctx);
  eq('HANDLES · the freight receipt is unlinked', b.cashbook[1].link.idx, null);
  eq('HANDLES · but freightId SURVIVES — deleteFreightPayment needs it', b.cashbook[1].link.freightId, 'fr9');
  eq('HANDLES · link is an object, never nulled wholesale', typeof b.cashbook[1].link, 'object');
}

console.log('\n════ month-apply (execute a month delete) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' MONTH-APPLY TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
