/* import-guard.test.js — what may not enter the books twice.
 *
 * Reported: one ₹1,00,000 PRINCE LIME payment, three rows, two badged
 * "Duplicate". The badge worked; the rows should never have existed.
 *
 * The tests that matter here are the ones proving the guard does NOT fire. A
 * dedupe that is too eager deletes a real payment permanently, with no badge and
 * no message — the books quietly show less than the bank and nobody knows to
 * look. That failure is worse than the duplicate rows it prevents, so it gets
 * more tests than the happy path.
 *
 *   node import-guard.test.js
 */
'use strict';
const G = require('./import-guard.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ import guard ═══\n');

/* ══════════ 1. THE REPORTED BUG ══════════ */
{
  const line = { id: 'p1', date: '2025-12-14', clean: 'PRINCE LIME INDUSTRIES', utr: '0012545409', credit: 100000, accountId: 'BA1' };
  const again = Object.assign({}, line, { id: 'p2' });
  const third = Object.assign({}, line, { id: 'p3' });

  const r = G.screenTxns([line, again, third], []);
  eq('THE BUG: one payment imported three times keeps ONE', r.keep.map(t => t.id), ['p1']);
  eq('  and drops the other two', r.dropped.length, 2);
  ok(/0012545409/.test(r.dropped[0].because), '  saying WHY, by reference');

  // and on a re-upload, against rows already stored
  const r2 = G.screenTxns([again], [line]);
  eq('re-importing a line already in the books keeps nothing', r2.keep.length, 0);
  eq('  it is dropped, not badged', r2.dropped.length, 1);
}

/* ══════════ 2. THE DANGEROUS SIDE — must NOT fire ══════════ */
{
  /* Two real ₹1,00,000 payments, one day, one customer, NO reference. This is
     legitimate and both must survive. If this test ever fails, the app is
     deleting a real payment. */
  const a = { id: 'a', date: '2025-12-14', clean: 'PRINCE LIME', credit: 100000, accountId: 'BA1' };
  const b = { id: 'b', date: '2025-12-14', clean: 'PRINCE LIME', credit: 100000, accountId: 'BA1' };
  const r = G.screenTxns([a, b], []);
  eq('TWO REAL PAYMENTS, same day/party/amount, NO reference → BOTH KEPT', r.keep.map(t => t.id), ['a', 'b']);
  eq('  nothing is silently deleted', r.dropped.length, 0);

  /* Different references = different transactions, however alike they look. */
  const c = { id: 'c', date: '2025-12-14', clean: 'PRINCE LIME', utr: '0012545409', credit: 100000, accountId: 'BA1' };
  const d = { id: 'd', date: '2025-12-14', clean: 'PRINCE LIME', utr: '0012545410', credit: 100000, accountId: 'BA1' };
  eq('two payments with DIFFERENT references both survive', G.screenTxns([c, d], []).keep.length, 2);

  /* Same UTR in two of the firm's OWN accounts: banks do reuse refs across
     institutions. Two accounts credited = two real transactions. */
  const e = { id: 'e', utr: '0012545409', credit: 100000, accountId: 'BA1' };
  const f = { id: 'f', utr: '0012545409', credit: 100000, accountId: 'BA2' };
  eq('the same reference in two DIFFERENT own accounts is two real lines', G.screenTxns([e, f], []).keep.length, 2);

  /* A reversal reuses the RRN across a credit and a debit. Both are real. */
  const g1 = { id: 'g', utr: 'RRN99887766', credit: 5000, accountId: 'BA1' };
  const g2 = { id: 'h', utr: 'RRN99887766', debit: 5000, accountId: 'BA1' };
  eq('a reversal (same RRN, credit AND debit) keeps both legs', G.screenTxns([g1, g2], []).keep.length, 2);

  /* Junk references must never become an identity — some formats put "0" or a
     3-digit sequence on every line. Treating that as a UTR would make every line
     a duplicate of the first and wipe the statement. */
  eq('"0" is not a reference', G.usableRef('0'), '');
  /* '000000' is SIX characters, so the length rule lets it through — only the
     all-zeros rule stops it. Without this line, deleting that rule changed
     nothing and the mutation survived: every line of a statement that stamps
     "000000" in the ref column would collapse into one row. */
  eq('"000000" is not a reference either (long enough to fool a length check)', G.usableRef('000000'), '');
  eq('"0000000000" is not a reference', G.usableRef('0000000000'), '');
  eq('"NA" is not a reference', G.usableRef('NA'), '');
  eq('a 3-digit sequence number is not a reference', G.usableRef('007'), '');
  eq('a real UTR is', G.usableRef('0012545409'), '0012545409');
  {
    const junk = [
      { id: 'j1', date: '2026-01-01', clean: 'A', utr: '000000', debit: 10, accountId: 'BA1' },
      { id: 'j2', date: '2026-01-02', clean: 'B', utr: '000000', debit: 20, accountId: 'BA1' },
      { id: 'j3', date: '2026-01-03', clean: 'C', utr: '000000', debit: 30, accountId: 'BA1' }
    ];
    eq('a statement whose every line says ref "0" is NOT wiped down to one row', G.screenTxns(junk, []).keep.length, 3);
  }
}

/* ══════════ 3. FILE HASH — same bytes, any name ══════════ */
{
  const stored = [{ id: 'ST1', file: 'hdfc-jan.pdf', sha: 'abc123' }];
  ok(G.fileVerdict('abc123', stored).dup, 'the same file is rejected by its hash');
  ok(G.fileVerdict('abc123', stored).of.file === 'hdfc-jan.pdf', '  naming the file it matches');
  ok(!G.fileVerdict('zzz999', stored).dup, 'a different file is allowed');
  ok(!G.fileVerdict('', stored).dup, 'no hash → cannot be certain → not rejected');
  ok(!G.fileVerdict('abc123', []).dup, 'the first upload is never a duplicate');
  /* RENAMED is the whole point: the hash is of the bytes. */
  ok(G.fileVerdict('abc123', [{ file: 'statement (1).pdf', sha: 'abc123' }]).dup,
    'a RENAMED copy of the same file is still caught — the hash is of the bytes, not the name');
}

/* ══════════ 4. INVOICES / BILLS ══════════ */
{
  const sales = [{ inv: '165/2025-26', party: 'PRINCE LIME INDUSTRIES', gstin: '08AAA0000A1Z5', total: 144470 }];
  const same = { inv: '165/2025-26', party: 'PRINCE LIME INDUSTRIES', gstin: '08AAA0000A1Z5', total: 144470 };
  ok(G.docVerdict(same, sales).dup, 'the same invoice number from the same party is a duplicate');
  ok(/already recorded/i.test(G.docVerdict(same, sales).reason), '  and says so plainly');

  /* Formatting must not defeat it — OCR emits "165 / 2025-26", humans type "165/2025-26". */
  ok(G.docVerdict({ inv: '165 / 2025-26', gstin: '08AAA0000A1Z5', total: 144470 }, sales).dup,
    'spacing/punctuation in the invoice number does not defeat the check');

  /* The AMOUNT is not part of the key, deliberately. */
  const corrected = { inv: '165/2025-26', gstin: '08AAA0000A1Z5', total: 150000 };
  const v = G.docVerdict(corrected, sales);
  ok(v.dup, 'the SAME invoice number with a DIFFERENT amount is still the same invoice, not a new one');
  ok(v.amountDiffers, '  and the difference is reported');
  ok(/different amount/i.test(v.reason), '  naming both figures so the user can tell which is right');

  ok(!G.docVerdict({ inv: '166/2025-26', gstin: '08AAA0000A1Z5', total: 1 }, sales).dup, 'a different invoice number is not a duplicate');
  ok(!G.docVerdict({ inv: '165/2025-26', gstin: '27BBB0000B1Z5', total: 1 }, sales).dup,
    'the same number from a DIFFERENT party is not a duplicate — two firms number their invoices independently');
  ok(!G.docVerdict({ party: 'PRINCE LIME', total: 144470 }, sales).dup,
    'no invoice number → cannot be certain → imported for review, never rejected');
  ok(!G.docVerdict({ inv: '165/2025-26', total: 144470 }, sales).dup,
    'no party → cannot be certain → not rejected');
}

/* ══════════ 5. CUSTOMER PAYMENTS ══════════ */
{
  const paid = [{ party: 'PRINCE LIME', ref: 'UTR7788991122', amount: 100000, date: '2025-12-14' }];
  ok(G.payVerdict({ party: 'PRINCE LIME', ref: 'UTR7788991122', amount: 100000 }, paid).dup, 'the same payment reference is a duplicate');
  ok(!G.payVerdict({ party: 'PRINCE LIME', ref: 'UTR0000000001', amount: 100000 }, paid).dup, 'a different reference is a different payment');
  const noRef = G.payVerdict({ party: 'PRINCE LIME', amount: 100000, date: '2025-12-14' }, paid);
  ok(!noRef.dup, 'A PAYMENT WITH NO REFERENCE IS NEVER REJECTED — two identical payments in a day are real');
  ok(/not rejected/i.test(noRef.reason), '  and the reason is recorded, not silent');
}

/* ══════════ 6. junk in ══════════ */
{
  eq('empty import → nothing kept, nothing dropped, no throw', G.screenTxns([], []).keep.length, 0);
  eq('null-ish input does not throw', G.screenTxns(null, null).keep.length, 0);
  ok(!G.docVerdict({}, []).dup, 'an empty document is not a duplicate of nothing');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
