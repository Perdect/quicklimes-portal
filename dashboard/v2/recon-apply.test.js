/* recon-apply.test.js — the tests that matter here are the ones proving this
   code does NOT post.

   Reconciliation moves real money. The expensive failure is not "a bill stayed
   Pending" — it is "a bill was paid twice because the bank line was a payment
   the user had already entered by hand". recon-core.js:422 sets action:'link'
   with the comment "NEVER 'post' — the money is already recorded". Every test
   below exists to keep that true through this file.

   The fake QLD implements data.js's REAL settle math —
       paid = Math.min(total, prev + amount)
       status = paid >= total - 0.5 ? 'paid' : paid > 0 ? 'partial' : 'pending'
   — copied from recordPurchasePayment / receiveSalesPayment, so "the dialog
   says 110 and posts 111" is a thing these tests can actually catch.

   Run: node recon-apply.test.js */

const A = require('./recon-apply.js');
const fs = require('fs');

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b),
  JSON.stringify(a) === JSON.stringify(b));

/* ── a books-shaped fake of QLD ─────────────────────────────────────────── */
function makeQ(sales, purchases) {
  const S = { SALES: JSON.parse(JSON.stringify(sales || [])), PURCH: JSON.parse(JSON.stringify(purchases || [])), CASHBOOK: [] };
  let n = 0;
  const settle = (row, amount, kind, o) => {
    const prev = +row.paid || 0;
    const paid = Math.min(row.total, prev + amount);          // data.js
    row.paid = paid;
    row.status = paid >= row.total - 0.5 ? 'paid' : (paid > 0 ? 'partial' : 'pending');
    row.payments = (row.payments || []).concat([{ amount, date: o.date }]);
    S.CASHBOOK.push({ id: 'cb' + (++n), amount, type: kind === 'sale' ? 'credit' : 'debit',
                      party: kind === 'sale' ? row.party : row.sup, link: { kind, idx: row.idx }, notes: o.notes });
  };
  const rowOf = (kind, idx) => (kind === 'sale' ? S.SALES : S.PURCH).find(r => r.idx === idx) || null;
  return {
    S,
    receiveSalesPayment: (i, o) => { const r = rowOf('sale', i); if (!r) throw new Error('no sale ' + i); settle(r, +o.amount || 0, 'sale', o); },
    payPurchaseBill: (i, o) => { const r = rowOf('purchase', i); if (!r) throw new Error('no bill ' + i); settle(r, +o.amount || 0, 'purchase', o); },
    cashIds: () => S.CASHBOOK.map(e => e.id),
    // what plan() reads — always recomputed from live rows, like the real page
    billOf: (kind, idx) => { const r = rowOf(kind, idx); return r ? Object.assign({}, r, { outstanding: Math.max(0, r.total - (+r.paid || 0)) }) : null; },
  };
}
const sale = (idx, inv, total, extra) => Object.assign({ idx, inv, party: 'Shree Cement', total, paid: 0, status: 'pending' }, extra || {});
const purch = (idx, bill, total, extra) => Object.assign({ idx, bill, sup: 'Indian Oil', total, paid: 0, status: 'pending' }, extra || {});
const cr = (id, amount, m, extra) => Object.assign({ id, date: '2026-06-10', credit: amount, debit: 0, desc: 'NEFT ' + id, m }, extra || {});
const db = (id, amount, m, extra) => Object.assign({ id, date: '2026-06-10', credit: 0, debit: amount, desc: 'NEFT ' + id, m }, extra || {});

/* ════════════════════════════════════════════════════════════════════════
   1. THE ONE THAT MATTERS MOST — an already-recorded payment is NEVER posted.

   The user paid Nagaur Golden Transport ₹54,944 for freight and entered it in
   the cashbook that day. The bank line IS that entry. recon-core matches it
   kind:'entry' / action:'link'. If this file posts it, the transporter is paid
   twice in the books and the cashbook shows money that never left.
   ════════════════════════════════════════════════════════════════════════ */
{
  const Q = makeQ([], [purch(0, 'FR/77', 54944)]);
  const t = db('t1', 54944, {
    kind: 'entry', action: 'link', entryId: 'cb101', status: 'matched',
    confidence: 100, tier: 'green', matchedBy: 'entry', party: 'Nagaur Golden Transport Company'
  });
  const p = A.plan([t], { billOf: Q.billOf });
  eq('entry-kind: nothing is planned for posting', p.post.length, 0);
  eq('entry-kind: it lands in skipEntry', p.skipEntry.length, 1);
  eq('entry-kind: reason is entry', p.skipEntry[0].reason, 'entry');
  eq('entry-kind: totals.post is 0', p.totals.post, 0);

  const r = A.applyPlan(p, { Q, cashIds: Q.cashIds });
  eq('entry-kind: DOUBLE-PAY GUARD — no payment written', r.bills, 0);
  eq('entry-kind: no cashbook row created', Q.S.CASHBOOK.length, 0);
  eq('entry-kind: the bill is untouched', Q.S.PURCH[0].status, 'pending');
  eq('entry-kind: no money moved', r.amount, 0);
  ok('entry-kind: the txn is NOT stamped (it was never posted)', !t.m.posted);
}
/* ...and a 100%-confident entry match is still never posted. Confidence is not
   the question — "is this money already in the books" is. */
{
  const Q = makeQ([], [purch(0, 'FR/77', 100000)]);
  const t = db('t1', 100000, { kind: 'entry', entryId: 'cb9', status: 'matched', confidence: 100, tier: 'green' });
  const p = A.plan([t], { billOf: Q.billOf, minConfidence: 0 });   // even with the gate wide open
  eq('entry-kind: not posted even at minConfidence 0', p.post.length, 0);
  eq('entry-kind: still skipEntry at minConfidence 0', p.skipEntry.length, 1);
}
/* A ledger match already posted to the running account (postOnAccount →
   recordLedgerEntry). Same hazard, same answer. */
{
  const Q = makeQ([sale(0, 'INV/1', 50000)], []);
  const t = cr('t1', 50000, { kind: 'ledger', ledgerEntryId: 'le1', partyIdx: 2, status: 'matched', manual: true, confidence: 100 });
  const p = A.plan([t], { billOf: Q.billOf });
  eq('ledger-kind: not posted (already in the running a/c)', p.post.length, 0);
  eq('ledger-kind: reason is ledger', p.skipEntry[0].reason, 'ledger');
  A.applyPlan(p, { Q, cashIds: Q.cashIds });
  eq('ledger-kind: invoice untouched', Q.S.SALES[0].status, 'pending');
}

/* ════════════════════════════════════════════════════════════════════════
   2. IDEMPOTENT — the user WILL double-click.
   ════════════════════════════════════════════════════════════════════════ */
{
  const Q = makeQ([sale(0, 'INV/1', 60000)], []);
  const t = cr('t1', 60000, { kind: 'sale', idx: 0, status: 'matched', confidence: 98, tier: 'green' });

  const p1 = A.plan([t], { billOf: Q.billOf });
  eq('idempotency: first run plans 1 post', p1.post.length, 1);
  const r1 = A.applyPlan(p1, { Q, cashIds: Q.cashIds });
  eq('idempotency: first run pays once', r1.bills, 1);
  eq('idempotency: invoice is Paid', Q.S.SALES[0].status, 'paid');
  eq('idempotency: paid = 60000', Q.S.SALES[0].paid, 60000);
  ok('idempotency: the txn is stamped', !!(t.m.posted && t.m.posted.batch));
  eq('idempotency: the stamp records the cashbook row', t.m.posted.cashbookIds, ['cb1']);

  // the second click — same txns, fresh plan
  const p2 = A.plan([t], { billOf: Q.billOf });
  eq('idempotency: second run plans NOTHING', p2.post.length, 0);
  eq('idempotency: second run says already-posted', p2.skipPosted.length, 1);
  const r2 = A.applyPlan(p2, { Q, cashIds: Q.cashIds });
  eq('idempotency: DOUBLE-PAY GUARD — second run writes no payment', r2.bills, 0);
  eq('idempotency: still exactly one cashbook row', Q.S.CASHBOOK.length, 1);
  eq('idempotency: paid is still 60000, not 120000', Q.S.SALES[0].paid, 60000);
  eq('idempotency: exactly one payment on the invoice', Q.S.SALES[0].payments.length, 1);
}

/* ════════════════════════════════════════════════════════════════════════
   3. LOW CONFIDENCE is not posted without confirmation.
   The thresholds are the ENGINE's: >=95 green, >=75 yellow (recon-core.js:305).
   ════════════════════════════════════════════════════════════════════════ */
{
  const Q = makeQ([sale(0, 'INV/1', 60000), sale(1, 'INV/2', 60000), sale(2, 'INV/3', 60000)], []);
  const yellow = cr('t1', 60000, { kind: 'sale', idx: 0, status: 'review', confidence: 80, tier: 'yellow' });
  const green = cr('t2', 60000, { kind: 'sale', idx: 1, status: 'matched', confidence: 96, tier: 'green' });
  const asked = cr('t3', 60000, { kind: 'sale', idx: 2, action: 'ask', status: 'review', confidence: 92, tier: 'yellow' });

  const p = A.plan([yellow, green, asked], { billOf: Q.billOf });
  eq('threshold: only the green line posts', p.post.length, 1);
  eq('threshold: the green one is t2', p.post[0].txnId, 't2');
  eq('threshold: yellow + ask are held back', p.skipLowConf.length, 2);
  eq('threshold: the gate is the engine green line', p.totals.minConfidence, 95);
  eq('threshold: an "ask" is named as such, not as low confidence', p.skipLowConf.find(x => x.txnId === 't3').reason, 'ask');

  A.applyPlan(p, { Q, cashIds: Q.cashIds });
  eq('threshold: the yellow invoice is untouched', Q.S.SALES[0].status, 'pending');
  eq('threshold: the green invoice is paid', Q.S.SALES[1].status, 'paid');
  eq('threshold: the "ask" invoice is untouched', Q.S.SALES[2].status, 'pending');
}
/* A human confirming IS the confirmation. A manual link posts at any score. */
{
  const Q = makeQ([sale(0, 'INV/1', 60000)], []);
  const t = cr('t1', 60000, { kind: 'sale', idx: 0, status: 'matched', manual: true, confidence: 40 });
  const p = A.plan([t], { billOf: Q.billOf });
  eq('threshold: a user-confirmed link posts regardless of score', p.post.length, 1);
}
/* The thresholds must remain the ENGINE's — not numbers this file invented.
   If recon-core re-tunes its tiers, this fails instead of silently drifting. */
{
  const src = fs.readFileSync(__dirname + '/recon-core.js', 'utf8');
  ok('threshold: 95/75 still ARE recon-core\'s green/yellow tiers',
    /conf\s*>=\s*95\s*\?\s*'green'\s*:\s*conf\s*>=\s*75\s*\?\s*'yellow'/.test(src));
  eq('threshold: recon-apply GREEN matches the engine', A.GREEN, 95);
  eq('threshold: recon-apply YELLOW matches the engine', A.YELLOW, 75);
}

/* ════════════════════════════════════════════════════════════════════════
   4. PARTIAL — post the ACTUAL bank amount, never mark Paid for less.
   ════════════════════════════════════════════════════════════════════════ */
{
  const Q = makeQ([], [purch(0, 'IOC/9001', 100000)]);
  const t = db('t1', 30000, { kind: 'purchase', idx: 0, status: 'matched', confidence: 97, tier: 'green' });
  const p = A.plan([t], { billOf: Q.billOf });
  eq('partial: posts the bank amount, not the bill total', p.post[0].lines[0].amount, 30000);
  eq('partial: the plan says Partial', p.post[0].lines[0].resultStatus, 'partial');
  eq('partial: outstanding after = 70000', p.post[0].lines[0].outstandingAfter, 70000);
  eq('partial: totals count 0 paid, 1 partial', [p.totals.paid, p.totals.partial], [0, 1]);
  eq('partial: no excess on a part payment', p.totals.excess, 0);

  A.applyPlan(p, { Q, cashIds: Q.cashIds });
  eq('partial: the bill is NOT marked Paid', Q.S.PURCH[0].status, 'partial');
  eq('partial: paid = 30000', Q.S.PURCH[0].paid, 30000);
  eq('partial: outstanding = 70000', Q.S.PURCH[0].total - Q.S.PURCH[0].paid, 70000);
}
/* Two bank lines settling one bill in the SAME run. The bill row's own
   `outstanding` is stale after the first line — if the plan doesn't track the
   remainder it promises "0 Paid" and then writes a Paid. */
{
  const Q = makeQ([], [purch(0, 'IOC/9001', 60000)]);
  const t1 = db('t1', 30000, { kind: 'purchase', idx: 0, status: 'matched', confidence: 97 });
  const t2 = db('t2', 30000, { kind: 'purchase', idx: 0, status: 'matched', confidence: 97 });
  const p = A.plan([t1, t2], { billOf: Q.billOf });
  eq('instalments: first is Partial, second is Paid', p.post.map(x => x.lines[0].resultStatus), ['partial', 'paid']);
  eq('instalments: totals say 1 paid + 1 partial', [p.totals.paid, p.totals.partial], [1, 1]);
  const r = A.applyPlan(p, { Q, cashIds: Q.cashIds });
  eq('instalments: the promise matches the write (paid)', r.paid, p.totals.paid);
  eq('instalments: the promise matches the write (partial)', r.partial, p.totals.partial);
  eq('instalments: the bill ends Paid', Q.S.PURCH[0].status, 'paid');
  eq('instalments: no excess invented', p.totals.excess, 0);
}

/* ════════════════════════════════════════════════════════════════════════
   5. OVERPAYMENT does not vanish. ₹75,000 against a ₹60,000 debt is ₹15,000
      of real money — post up to the bill, REPORT the rest.
   ════════════════════════════════════════════════════════════════════════ */
{
  const Q = makeQ([sale(0, 'INV/1', 60000)], []);
  const t = cr('t1', 75000, { kind: 'sale', idx: 0, status: 'matched', confidence: 96, tier: 'green' });
  const p = A.plan([t], { billOf: Q.billOf });
  eq('overpay: posts only up to the bill', p.post[0].lines[0].amount, 60000);
  eq('overpay: the invoice is Paid', p.post[0].lines[0].resultStatus, 'paid');
  eq('overpay: the excess is REPORTED, not dropped', p.overpay.length, 1);
  eq('overpay: the excess is 15000', p.overpay[0].excess, 15000);
  eq('overpay: totals carry the excess', p.totals.excess, 15000);
  eq('overpay: the excess names the bank line', p.overpay[0].bankAmount, 75000);
  ok('overpay: the report says what to do with it', /advance|not posted/i.test(p.overpay[0].why));

  A.applyPlan(p, { Q, cashIds: Q.cashIds });
  eq('overpay: the invoice is never over-paid', Q.S.SALES[0].paid, 60000);
  eq('overpay: exactly one cashbook row, for 60000', Q.S.CASHBOOK.map(e => e.amount), [60000]);
}
/* A bill already settled: the whole line is unapplied money. It must be named,
   not silently swallowed. */
{
  const Q = makeQ([sale(0, 'INV/1', 60000, { paid: 60000, status: 'paid' })], []);
  const t = cr('t1', 60000, { kind: 'sale', idx: 0, status: 'matched', confidence: 96 });
  const p = A.plan([t], { billOf: Q.billOf });
  eq('overpay: nothing posted against a settled bill', p.post.length, 0);
  eq('overpay: the whole 60000 is reported as unapplied', p.overpay[0].excess, 60000);
}

/* ════════════════════════════════════════════════════════════════════════
   6. SPLIT — one payment per allocation, never more than the bank line.
   ════════════════════════════════════════════════════════════════════════ */
{
  const Q = makeQ([], [purch(0, 'B/1', 40000), purch(1, 'B/2', 35000)]);
  const t = db('t1', 75000, {
    kind: 'purchase', status: 'matched', confidence: 98, tier: 'green',
    allocs: [{ kind: 'purchase', idx: 0, amount: 40000 }, { kind: 'purchase', idx: 1, amount: 35000 }]
  });
  const p = A.plan([t], { billOf: Q.billOf });
  eq('split: one line per allocation', p.post[0].lines.length, 2);
  eq('split: each line carries its OWN amount', p.post[0].lines.map(l => l.amount), [40000, 35000]);
  eq('split: the lines sum to the bank line, no more', p.post[0].applied, 75000);
  eq('split: totals count 2 bills', p.totals.bills, 2);
  eq('split: no excess', p.totals.excess, 0);

  const r = A.applyPlan(p, { Q, cashIds: Q.cashIds });
  eq('split: two payments written', r.bills, 2);
  eq('split: both bills Paid', [Q.S.PURCH[0].status, Q.S.PURCH[1].status], ['paid', 'paid']);
  eq('split: the cashbook total equals the bank line', Q.S.CASHBOOK.reduce((s, e) => s + e.amount, 0), 75000);
  eq('split: ONE stamp covering both lines', t.m.posted.lines.length, 2);
}
/* Allocations that over-claim the bank line must be capped AT the bank line —
   a split can never pay out more than the money that actually moved. */
{
  const Q = makeQ([], [purch(0, 'B/1', 60000), purch(1, 'B/2', 60000)]);
  const t = db('t1', 50000, {
    kind: 'purchase', status: 'matched', confidence: 98,
    allocs: [{ kind: 'purchase', idx: 0, amount: 40000 }, { kind: 'purchase', idx: 1, amount: 40000 }]  // 80k of a 50k line
  });
  const p = A.plan([t], { billOf: Q.billOf });
  const total = p.post[0].lines.reduce((s, l) => s + l.amount, 0);
  ok('split: NEVER exceeds the bank line — got ' + total, total <= 50000);
  eq('split: the second line is capped at the remaining 10000', p.post[0].lines.map(l => l.amount), [40000, 10000]);
  A.applyPlan(p, { Q, cashIds: Q.cashIds });
  eq('split: the books moved exactly the bank amount', Q.S.CASHBOOK.reduce((s, e) => s + e.amount, 0), 50000);
}

/* ════════════════════════════════════════════════════════════════════════
   7. UNMATCHED posts nothing. Also: duplicates, cancelled bills, and lines
      pointing the wrong way.
   ════════════════════════════════════════════════════════════════════════ */
{
  const Q = makeQ([sale(0, 'INV/1', 60000)], [purch(0, 'B/1', 60000, { status: 'cancelled' }), purch(1, 'B/2', 60000)]);
  const un = cr('t1', 60000, { kind: 'sale', idx: null, status: 'unmatched', confidence: 0, tier: 'red' });
  const none = cr('t2', 60000, null);
  const dup = cr('t3', 60000, { kind: 'sale', idx: 0, status: 'duplicate', confidence: 98, tier: 'green' });
  const canc = db('t4', 60000, { kind: 'purchase', idx: 0, status: 'matched', confidence: 98 });
  const wrongDir = cr('t5', 60000, { kind: 'purchase', idx: 1, status: 'matched', confidence: 98 });

  const p = A.plan([un, none, dup, canc, wrongDir], { billOf: Q.billOf });
  eq('unmatched: nothing is posted', p.post.length, 0);
  eq('unmatched: an unmatched line is reported as such', p.skipNoBill.filter(x => x.txnId === 't1').length, 1);
  eq('unmatched: a line with no match at all is reported', p.skipNoBill.filter(x => x.txnId === 't2').length, 1);
  eq('duplicate: a re-imported copy is never posted', p.skipDuplicate.length, 1);
  eq('cancelled: a cancelled bill is never paid', p.skipNoBill.filter(x => x.txnId === 't4')[0].reason, 'cancelled');
  eq('direction: a CREDIT can never pay a purchase bill', p.skipNoBill.filter(x => x.txnId === 't5')[0].reason, 'direction');

  const r = A.applyPlan(p, { Q, cashIds: Q.cashIds });
  eq('unmatched: not one payment written', r.bills, 0);
  eq('unmatched: the cashbook is empty', Q.S.CASHBOOK.length, 0);
}

/* ════════════════════════════════════════════════════════════════════════
   8. THE DIALOG'S NUMBERS ARE THE TRUTH.
      A dialog that says 110 and posts 111 is worse than no dialog. This runs a
      realistic mixed batch and asserts every number the dialog shows equals
      what the books actually did.
   ════════════════════════════════════════════════════════════════════════ */
{
  const sales = [], purchases = [], txns = [];
  for (let i = 0; i < 110; i++) { sales.push(sale(i, 'INV/' + i, 10000)); txns.push(cr('g' + i, 10000, { kind: 'sale', idx: i, status: 'matched', confidence: 97, tier: 'green' })); }
  for (let i = 0; i < 8; i++) { purchases.push(purch(i, 'B/' + i, 50000)); txns.push(db('p' + i, 20000, { kind: 'purchase', idx: i, status: 'matched', confidence: 96, tier: 'green' })); }
  for (let i = 0; i < 7; i++) txns.push(cr('u' + i, 5000, { kind: 'sale', idx: null, status: 'unmatched', confidence: 0, tier: 'red' }));
  for (let i = 0; i < 3; i++) txns.push(db('e' + i, 9000, { kind: 'entry', entryId: 'cb' + i, status: 'matched', confidence: 99, tier: 'green' }));

  const Q = makeQ(sales, purchases);
  const p = A.plan(txns, { billOf: Q.billOf });
  eq('dialog: 110 will be marked Paid', p.totals.paid, 110);
  eq('dialog: 8 Partial', p.totals.partial, 8);
  eq('dialog: 7 unmatched', p.totals.skipNoBill, 7);
  eq('dialog: 3 already recorded — skipped', p.totals.skipEntry, 3);
  eq('dialog: every txn is accounted for exactly once',
    p.totals.post + p.totals.skipEntry + p.totals.skipPosted + p.totals.skipLowConf + p.totals.skipDuplicate + p.totals.skipNoBill,
    txns.length);

  const r = A.applyPlan(p, { Q, cashIds: Q.cashIds });
  eq('dialog: the count it PROMISED equals what was applied (paid)', r.paid, p.totals.paid);
  eq('dialog: the count it PROMISED equals what was applied (partial)', r.partial, p.totals.partial);
  eq('dialog: the count it PROMISED equals what was applied (bills)', r.bills, p.totals.bills);
  eq('dialog: the amount it PROMISED equals what moved', r.amount, p.totals.amount);
  eq('dialog: the books agree with the promise (paid count)', Q.S.SALES.filter(s => s.status === 'paid').length, 110);
  eq('dialog: the books agree with the promise (partial count)', Q.S.PURCH.filter(s => s.status === 'partial').length, 8);
  eq('dialog: the cashbook total equals the promised amount', Q.S.CASHBOOK.reduce((s, e) => s + e.amount, 0), p.totals.amount);
  eq('dialog: no cashbook row exists for an already-recorded line', Q.S.CASHBOOK.filter(e => e.amount === 9000).length, 0);
  eq('dialog: no errors', r.errors.length, 0);
}

/* ── 9. the batch id, so a run is identifiable (see the report re: undo) ── */
{
  const Q = makeQ([sale(0, 'INV/1', 60000), sale(1, 'INV/2', 60000)], []);
  const t1 = cr('t1', 60000, { kind: 'sale', idx: 0, status: 'matched', confidence: 97 });
  const t2 = cr('t2', 60000, { kind: 'sale', idx: 1, status: 'matched', confidence: 97 });
  const p = A.plan([t1, t2], { billOf: Q.billOf });
  const r = A.applyPlan(p, { Q, cashIds: Q.cashIds, batch: 'rbTEST' });
  eq('batch: the run reports its id', r.batch, 'rbTEST');
  eq('batch: every txn in the run carries it', [t1.m.posted.batch, t2.m.posted.batch], ['rbTEST', 'rbTEST']);
  eq('batch: the cashbook rows it created are recorded', [t1.m.posted.cashbookIds, t2.m.posted.cashbookIds], [['cb1'], ['cb2']]);
  ok('batch: the posted txns are marked so a re-match cannot silently undo them', t1.m.manual === true);
}

/* ── 10. a mutation that throws does not fake success ── */
{
  const Q = makeQ([sale(0, 'INV/1', 60000)], []);
  const t = cr('t1', 60000, { kind: 'sale', idx: 99, status: 'matched', confidence: 97 });
  // idx 99 does not exist; billOf returns null → plan refuses it outright
  const p = A.plan([t], { billOf: Q.billOf });
  eq('missing bill: refused at plan time', p.post.length, 0);
  eq('missing bill: reported', p.skipNoBill[0].reason, 'bill_missing');
}
{
  // and if the mutation itself throws mid-run, the error surfaces
  const Q = makeQ([sale(0, 'INV/1', 60000)], []);
  const boom = Object.assign({}, Q, { receiveSalesPayment: () => { throw new Error('blob write failed'); } });
  const t = cr('t1', 60000, { kind: 'sale', idx: 0, status: 'matched', confidence: 97 });
  const p = A.plan([t], { billOf: Q.billOf });
  const r = A.applyPlan(p, { Q: boom, cashIds: Q.cashIds });
  eq('failure: nothing counted as applied', r.bills, 0);
  eq('failure: the error is reported', r.errors.length, 1);
  ok('failure: an unwritten payment is NOT stamped as posted', !t.m.posted);
}

/* ════════════════════════════════════════════════════════════════════════
   11. WIRING — the planner being right proves nothing if the PAGE doesn't use
   it. This repo has already shipped a bug that survived a green engine suite
   because the router never called the fixed code, so: load the REAL reconcile.js
   and drive its REAL runMatchAll().

   What is at stake here is not cosmetic. Posting a payment CREATES a cashbook
   entry, so the next runMatchAll() sees the line we just posted match its own
   new entry and rewrites t.m. If the m.posted stamp does not survive that
   rewrite, "Update Payments" pays every one of those bills again on the next
   click. The stamp is the entire idempotency story in the live app.
   ════════════════════════════════════════════════════════════════════════ */
{
  const vm = require('vm'), path = require('path');
  const noop = () => {};
  /* querySelectorAll MUST return an array: the page does
     root.querySelectorAll(...).forEach(...), and a stub that hands back a noop
     makes render() throw into its own catch. The page would look "deferred" and
     any REAL wiring error would be buried in that same swallowed warning.

     innerHTML is really stored, so the confirmation dialog's MARKUP can be read
     back and checked against the plan — the numbers on screen are the whole
     point of the dialog. */
  const HTML = {};
  const elStub = new Proxy({}, {
    get: (t, k) => (k === 'classList' ? { add: noop, remove: noop, toggle: noop, contains: () => false }
      : k === 'style' ? {} : k === 'dataset' ? {} : k === 'innerHTML' ? (HTML.v || '')
      : k === 'textContent' || k === 'value' ? ''
      : k === 'querySelectorAll' ? () => [] : k === 'children' || k === 'childNodes' ? []
      : typeof k === 'string' ? noop : undefined),
    set: (t, k, v) => { if (k === 'innerHTML') HTML.v = v; return true; }
  });
  const doc = { getElementById: () => elStub, querySelector: () => elStub, querySelectorAll: () => [],
                createElement: () => elStub, addEventListener: noop, body: elStub, documentElement: elStub };

  const SALES = [{ idx: 0, inv: 'INV/1', party: 'Shree Cement', total: 60000, paid: 0, outstanding: 60000, status: 'pending' }];
  const TXNS = [];
  const QLD = {
    fC: n => '₹' + Math.round(+n || 0).toLocaleString('en-IN'), fmt: String, fDS: d => String(d || ''), fL: String, daysAgo: () => 0,
    co: { name: 'Gotan Lime', short: 'GOTAN' }, COMPANIES: {}, ownFirmNames: ['Gotan Lime'], activeCo: 'gotan',
    salesRows: () => SALES, purchaseRows: () => [], partyRows: () => [], cashbookRows: () => [],
    bankAccounts: () => [], bankAccountById: () => null, bankAccountLabel: () => '',
    recon: { txns: TXNS }, saveRecon: noop, commit: noop, state: {},
    uiMonth: () => null, setUiMonth: noop, partyLedger: () => [],
    receiveSalesPayment: noop, payPurchaseBill: noop,
  };
  const ctx = {
    console, window: {}, document: doc, QLShell: { mount: noop, modal: noop, toast: noop, openForm: noop },
    QLD, QLFin: {}, QLMobile: null, setTimeout: noop, clearTimeout: noop, requestAnimationFrame: noop,
    localStorage: { getItem: () => null, setItem: noop }, sessionStorage: { getItem: () => null, setItem: noop },
    location: { href: 'https://app.quicklimes.com/v2/reconcile', search: '', hash: '', pathname: '/v2/reconcile' },
    history: { replaceState: noop, pushState: noop }, navigator: { userAgent: 'node' }, alert: noop, confirm: () => false,
    Date, JSON, Math, Object, Array, Set, Map, String, Number, isNaN, parseFloat, parseInt,
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.window.QLD = QLD;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'recon-core.js'), 'utf8'), ctx);
  ctx.RC = ctx.window.ReconCore || ctx.ReconCore;
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'recon-apply.js'), 'utf8'), ctx);
  ok('wiring: the page-side RCApply global is published', !!ctx.window.RCApply);

  let loaded = true, err = null;
  try {
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'reconcile.js'), 'utf8') +
      '\n;this.__runMatchAll = runMatchAll; this.__buildApplyPlan = buildApplyPlan; this.__openApply = openApply;', ctx);
  } catch (e) { loaded = false; err = e; }
  ok('wiring: the REAL reconcile.js still loads' + (err ? ' — ' + err.message : ''), loaded);

  if (loaded) {
    ok('wiring: the page exposes an apply planner', typeof ctx.__buildApplyPlan === 'function');
    ok('wiring: the page exposes the Update Payments handler', typeof ctx.__openApply === 'function');

    /* the page must build its plan through recon-apply, not a private copy */
    const src = fs.readFileSync(path.join(__dirname, 'reconcile.js'), 'utf8');
    ok('wiring: the page plans via RCApply.plan', /RCApply\.plan\(/.test(src));
    ok('wiring: the page applies via RCApply.applyPlan', /RCApply\.applyPlan\(/.test(src));
    ok('wiring: the button exists in the hero', /id="rcApply"/.test(src));
    ok('wiring: the button is bound', /\$\('rcApply'\)\.onclick\s*=\s*openApply/.test(src));

    /* THE STAMP MUST SURVIVE A FORCED RE-MATCH.
       force=true is the "AI Reconcile" button, which deliberately clobbers even
       manual work. If it eats m.posted, the next Update Payments double-pays. */
    const np = ctx.RC.parseNarration('NEFT-BARBT26161997932-SHREE CEMENT LTD');
    const t = { id: 'w1', date: '2026-06-16', debit: 0, credit: 60000, desc: 'NEFT SHREE CEMENT LTD',
                raw: np.raw, clean: np.clean, utr: np.utr, mode: np.mode, accountId: '',
                m: { kind: 'sale', idx: 0, status: 'matched', confidence: 97, tier: 'green',
                     posted: { batch: 'rbOLD', at: '2026-06-16T00:00:00Z', lines: [{ kind: 'sale', idx: 0, amount: 60000 }], cashbookIds: ['cb1'] } } };
    TXNS.length = 0; TXNS.push(t);

    ctx.__runMatchAll(true);                       // the AI Reconcile button
    ok('wiring: m.posted SURVIVES a forced re-match', !!(t.m && t.m.posted));
    eq('wiring: ...with its original batch intact', t.m.posted && t.m.posted.batch, 'rbOLD');

    // and the planner, run on that re-matched txn, still refuses to pay it twice
    const pl2 = A.plan(TXNS, { billOf: (k, i) => (k === 'sale' ? SALES : []).find(r => r.idx === i) || null });
    eq('wiring: DOUBLE-PAY GUARD — a re-matched posted line is still skipped', pl2.post.length, 0);
    eq('wiring: ...and is reported as already posted', pl2.skipPosted.length, 1);

    /* ── THE DIALOG ITSELF ────────────────────────────────────────────────
       A dialog that throws is a dead button; a dialog whose numbers are not the
       plan's is worse than no dialog. Drive the REAL openApply() and read the
       REAL markup it produced. */
    SALES.length = 0;
    SALES.push({ idx: 0, inv: 'INV/1', party: 'Shree Cement', total: 60000, paid: 0, outstanding: 60000, status: 'pending' });
    SALES.push({ idx: 1, inv: 'INV/2', party: 'Ambuja', total: 90000, paid: 0, outstanding: 90000, status: 'pending' });
    const mk = (id, amt, m) => { const n = ctx.RC.parseNarration('NEFT-X-SHREE CEMENT LTD');
      return { id, date: '2026-06-16', debit: 0, credit: amt, desc: 'NEFT SHREE CEMENT', raw: n.raw, clean: n.clean, utr: n.utr, mode: n.mode, accountId: '', m }; };
    TXNS.length = 0;
    TXNS.push(mk('d1', 60000, { kind: 'sale', idx: 0, status: 'matched', confidence: 97, tier: 'green', manual: true }));   // → Paid
    TXNS.push(mk('d2', 30000, { kind: 'sale', idx: 1, status: 'matched', confidence: 97, tier: 'green', manual: true }));   // → Partial
    TXNS.push(mk('d3', 9000, { kind: 'entry', entryId: 'cb7', status: 'matched', confidence: 99, tier: 'green' }));         // already recorded

    const planned = ctx.__buildApplyPlan();
    eq('dialog: the page\'s own plan sees 1 Paid', planned.totals.paid, 1);
    eq('dialog: ...1 Partial', planned.totals.partial, 1);
    eq('dialog: ...and 1 already recorded', planned.totals.skipEntry, 1);

    HTML.v = '';
    let threw = null;
    try { ctx.__openApply(); } catch (e) { threw = e; }
    ok('dialog: openApply() renders without throwing' + (threw ? ' — ' + threw.message : ''), !threw);
    const html = HTML.v || '';
    ok('dialog: it shows the Paid count from the plan', /<b[^>]*>1<\/b><span[^>]*>will be marked Paid<\/span>/.test(html));
    ok('dialog: it shows the Partial count from the plan', /<b[^>]*>1<\/b><span[^>]*>will be marked Partial/.test(html));
    ok('dialog: it tells the user what it will NOT touch', /already recorded in your cash book/.test(html));
    ok('dialog: it names the double-pay reason in plain words', /pay those parties twice/.test(html));
    ok('dialog: the confirm button counts the same bills the plan will post',
      new RegExp('Post ' + planned.totals.bills + ' payment').test(html));
    ok('dialog: it is honest that this cannot be undone here', /cannot be undone/.test(html));
    ok('dialog: nothing was written merely by SHOWING it', TXNS.every(t => !(t.m && t.m.posted)));
  }
}

/* ════════════════════════════════════════════════════════════════════════ */
console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail);
if (fail) { console.log('\nFailures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
process.exit(fail ? 1 : 0);
