/* dedupe.test.js — finding what is ALREADY duplicated, without proposing to
 * delete anything real.
 *
 * This screen is more dangerous than the import gate. The gate refuses a row the
 * user never had; this one offers to delete rows they DO have, on a screen whose
 * whole design invites a confident click. So the tests that matter are the ones
 * proving it stays SILENT — and the ones proving the surviving copy is the
 * reconciled one, because keeping the bare copy would destroy the user's work
 * while truthfully reporting "duplicates removed".
 *
 *   node dedupe.test.js
 */
'use strict';
const D = require('./dedupe.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ dedupe · what is already in the books ═══\n');

/* ══════════ 1. THE REPORTED BUG ══════════ */
{
  const line = { id: 'p1', date: '2025-12-14', clean: 'PRINCE LIME INDUSTRIES', utr: '0012545409', credit: 100000, accountId: 'BA1' };
  const txns = [line, Object.assign({}, line, { id: 'p2' }), Object.assign({}, line, { id: 'p3' })];
  const r = D.scanTxns(txns);
  eq('THE BUG: one payment imported three times is reported as ONE group', r.length, 1);
  eq('  with two rows to remove', r[0].dupes.length, 2);
  eq('  and one kept', r[0].keep.row.id, 'p1');
  eq('  the group knows how many rows it covers', r[0].count, 3);
}

/* ══════════ 2. IT MUST STAY SILENT ══════════ */
{
  /* No reference. Two real ₹1,00,000 payments in one day are possible. If this
     ever fails, the cleanup screen is inviting the user to delete real money. */
  const a = { id: 'a', date: '2025-12-14', clean: 'PRINCE LIME', credit: 100000, accountId: 'BA1' };
  const b = { id: 'b', date: '2025-12-14', clean: 'PRINCE LIME', credit: 100000, accountId: 'BA1' };
  eq('TWO REAL PAYMENTS, same day/party/amount, NO reference → NOT offered for deletion', D.scanTxns([a, b]).length, 0);

  const c = { id: 'c', utr: '0012545409', credit: 100000, accountId: 'BA1' };
  const d = { id: 'd', utr: '0012545410', credit: 100000, accountId: 'BA1' };
  eq('different references → not duplicates', D.scanTxns([c, d]).length, 0);

  /* Same UTR in two of the firm's OWN accounts: two real credits. */
  eq('the same reference in two different own accounts → not duplicates',
    D.scanTxns([{ id: 'e', utr: 'U123456', credit: 5000, accountId: 'BA1' }, { id: 'f', utr: 'U123456', credit: 5000, accountId: 'BA2' }]).length, 0);

  /* A reversal reuses the RRN across a credit and a debit. Both real. */
  eq('a reversal (same RRN, one credit one debit) → not duplicates',
    D.scanTxns([{ id: 'g', utr: 'RRN99887766', credit: 5000, accountId: 'BA1' }, { id: 'h', utr: 'RRN99887766', debit: 5000, accountId: 'BA1' }]).length, 0);

  /* Junk refs must never group a whole statement into one "duplicate". */
  const junk = ['j1', 'j2', 'j3'].map((id, i) => ({ id, date: '2026-01-0' + (i + 1), utr: '000000', debit: 10 * (i + 1), accountId: 'BA1' }));
  eq('a statement stamping "000000" on every line is NOT reported as duplicates', D.scanTxns(junk).length, 0);

  eq('an empty book has nothing to clean', D.scan({}).total, 0);
  eq('null-ish input does not throw', D.scanTxns(null).length, 0);
}

/* ══════════ 3. THE SURVIVING COPY IS THE ONE WITH THE WORK IN IT ══════════
   The subtle way this feature destroys data while reporting success. */
{
  const bare = { id: 'x1', utr: 'U777777', credit: 50000, accountId: 'BA1' };
  const reconciled = { id: 'x2', utr: 'U777777', credit: 50000, accountId: 'BA1', m: { idx: 4, status: 'matched', confidence: 98 } };
  const r = D.scanTxns([bare, reconciled]);
  eq('the RECONCILED copy survives even though the bare one came first', r[0].keep.row.id, 'x2');
  eq('  and the bare copy is the one removed', r[0].dupes.map(e => e.row.id), ['x1']);

  /* A split allocation is real work too. */
  const split = { id: 'y2', utr: 'U888888', credit: 90000, accountId: 'BA1', m: { allocs: [{ kind: 'sale', idx: 1, amount: 40000 }, { kind: 'sale', idx: 2, amount: 50000 }] } };
  eq('a SPLIT row outranks a bare copy', D.scanTxns([{ id: 'y1', utr: 'U888888', credit: 90000, accountId: 'BA1' }, split])[0].keep.row.id, 'y2');

  /* An entry match (freight/EMI paid from the cashbook) is real work. */
  eq('an ENTRY-matched row outranks a bare copy',
    D.scanTxns([{ id: 'z1', utr: 'U999999', debit: 1000, accountId: 'BA1' },
                { id: 'z2', utr: 'U999999', debit: 1000, accountId: 'BA1', m: { entryId: 'cb9' } }])[0].keep.row.id, 'z2');

  /* Ties go to the earliest — the original, not the re-upload. */
  eq('two equally-worked copies keep the FIRST (the original import)',
    D.scanTxns([{ id: 'q1', utr: 'U111111', debit: 10, accountId: 'BA1' }, { id: 'q2', utr: 'U111111', debit: 10, accountId: 'BA1' }])[0].keep.row.id, 'q1');

  eq('a bare row scores 0', D.txnWork({}), 0);
  eq('a suggested row scores above bare', D.txnWork({ m: { confidence: 60 } }), 1);
  eq('a linked row scores highest', D.txnWork({ m: { idx: 2 } }), 2);
}

/* ══════════ 4. INVOICES AND BILLS ══════════ */
{
  const inv = { inv: '165/2025-26', party: 'PRINCE LIME', gstin: '08AAA0000A1Z5', total: 144470 };
  const r = D.scanDocs([inv, Object.assign({}, inv)]);
  eq('the same invoice number twice from one party is reported', r.length, 1);
  eq('  one to remove', r[0].dupes.length, 1);

  eq('a different invoice number is not a duplicate', D.scanDocs([inv, Object.assign({}, inv, { inv: '166/2025-26' })]).length, 0);
  eq('the same number from a DIFFERENT firm is not a duplicate',
    D.scanDocs([inv, Object.assign({}, inv, { gstin: '27BBB0000B1Z5', party: 'OTHER' })]).length, 0);
  eq('an invoice with NO number is never offered for deletion',
    D.scanDocs([{ party: 'WALK IN', total: 5000 }, { party: 'WALK IN', total: 5000 }]).length, 0);

  /* Same number, different amount: still ONE invoice (corrected or misread) — so
     it IS reported, and the copy the books actually used must survive. */
  const paid = Object.assign({}, inv, { total: 150000, paid: 150000 });
  const r2 = D.scanDocs([inv, paid]);
  eq('the same invoice with a different amount is still one document', r2.length, 1);
  eq('  and the copy with PAYMENTS against it survives — deleting it would strand them', r2[0].keep.row.total, 150000);

  eq('a bill with attachments outranks a bare copy',
    D.scanDocs([{ bill: 'B-1', sup: 'X', gstin: '08CCC0000C1Z5' }, { bill: 'B-1', sup: 'X', gstin: '08CCC0000C1Z5', attach: [{ n: 'scan.pdf' }] }])[0].keep.row.attach.length, 1);

  /* Already-deleted rows are gone. Re-reporting them means the count never
     reaches zero and the user "removes" the same row forever. */
  eq('an already-deleted duplicate is not reported again',
    D.scanDocs([inv, Object.assign({}, inv, { _del: { at: 'x' } })]).length, 0);
  eq('a voided duplicate is not reported again',
    D.scanDocs([inv, Object.assign({}, inv, { _void: true })]).length, 0);
}

/* ══════════ 4b. THE INDEX IS THE CALLER'S INDEX ══════════
   The UI deletes by index — Q.deleteSale(i). If `i` points into some filtered copy
   of the array rather than the real one, the cleanup deletes A DIFFERENT INVOICE
   and cheerfully reports success. That is the worst outcome this feature has.

   This exact bug was live: scanDocs filtered out _del rows and THEN indexed, so a
   single already-deleted row shifted every index by one. 34 tests passed before and
   after the fix — none of them looked at an index, so the bug was invisible. */
{
  const inv = { inv: '165/2025-26', gstin: '08AAA0000A1Z5', party: 'P', total: 100 };
  const docs = [
    { inv: 'OLD-1', gstin: '08ZZZ0000Z1Z5', party: 'Z', total: 1, _del: { at: 'x' } },  // idx 0 — deleted, skipped
    { inv: 'OTHER', gstin: '08YYY0000Y1Z5', party: 'Y', total: 2 },                     // idx 1 — unrelated
    Object.assign({}, inv),                                                              // idx 2 — the keeper
    Object.assign({}, inv)                                                               // idx 3 — the duplicate
  ];
  const g = D.scanDocs(docs)[0];
  eq('the group is found past a deleted row', !!g, true);
  eq('KEEP carries the index into the REAL array, not a filtered one', g.keep.i, 2);
  eq('REMOVE carries the real index too', g.dupes.map(e => e.i), [3]);
  /* The proof: the index must resolve back to the row the group is about. */
  eq('  and that index resolves to the duplicate itself', docs[g.dupes[0].i].inv, '165/2025-26');
  ok(docs[g.dupes[0].i] !== docs[1], '  it is NOT the unrelated invoice sitting next to it');

  /* Bank rows share the rule. */
  const txns = [
    { id: 'unrelated', utr: 'UAAAAAA', debit: 1, accountId: 'BA1' },
    { id: 'k', utr: 'UBBBBBB', debit: 2, accountId: 'BA1' },
    { id: 'd', utr: 'UBBBBBB', debit: 2, accountId: 'BA1' }
  ];
  const tg = D.scanTxns(txns)[0];
  eq('bank rows carry real indices as well', [tg.keep.i, tg.dupes[0].i], [1, 2]);
}

/* ══════════ 5. THE WHOLE PICTURE ══════════ */
{
  const line = { id: 'p1', utr: 'U0001XX', credit: 100000, accountId: 'BA1' };
  const inv = { inv: '165/2025-26', gstin: '08AAA0000A1Z5', party: 'P', total: 1 };
  const bill = { bill: 'B-9021', gstin: '08CCC0000C1Z5', sup: 'S', total: 1 };
  const s = D.scan({
    txns: [line, Object.assign({}, line, { id: 'p2' }), Object.assign({}, line, { id: 'p3' })],
    sales: [inv, Object.assign({}, inv)],
    purchases: [bill, Object.assign({}, bill)]
  });
  eq('counts the bank rows to remove', s.counts.txns, 2);
  eq('counts the invoices to remove', s.counts.sales, 1);
  eq('counts the bills to remove', s.counts.purchases, 1);
  eq('and the total the screen will offer to remove', s.total, 4);
  /* The number shown must equal the number of rows that would go. */
  eq('  the total is the sum of the parts, not a separate count',
    s.total, s.counts.txns + s.counts.sales + s.counts.purchases);
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
