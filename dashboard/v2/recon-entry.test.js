/* recon-entry.test.js — a bank line that PAYS a bill vs one that IS a payment.

   THE REQUEST (2026-07-15): "also you can match bank statement amount or party
   we pay every month".

   THE GAP IT EXPOSED: reconcile.js only ever offered PURCHASE BILLS as
   candidates for a bank debit —
       const bills = (t.credit||0) > 0 ? Q.salesRows() : Q.purchaseRows();
   — so ₹55,233 paid to "Nagour Golden Transport" (a freight payment on an IOC
   petcoke bill) could never match: the transporter's name was never in the
   candidate list. Freight, labour, royalty and EMI debits sat unmatched
   forever, while the name sat right there on the cashbook entry.

   THE RULE THIS FILE GUARDS — get it backwards and the books pay a man twice:
       PAYS a bill  -> the money is not recorded yet. Matching POSTS a payment.
       IS an entry   -> the money is ALREADY in the cashbook. Matching may only
                        LINK. Posting again double-counts, and it errs in the
                        direction that HIDES money: the cashbook looks fuller
                        than the bank.
   So an ENTRY match always beats a BILL match, and when both are plausible the
   engine ASKS rather than posts.

   Run: node recon-entry.test.js */

const R = require('./recon-core.js');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), a === b);

const np = raw => R.parseNarration(raw);
const debit = (amount, date) => ({ date: date || '2026-01-15', debit: amount, credit: 0 });

/* the real freight payment from the user's screenshot */
const FREIGHT = { id: 'fr1', date: '2026-01-15', amount: 55233, party: 'Nagour Golden Transport',
                  method: 'Bank', ref: '', kind: 'freight', dir: 'out' };
/* the IOC bill it belongs to — a DIFFERENT amount */
const IOC_BILL = { idx: 0, bill: '20263121B024217', date: '2026-01-15', sup: 'Indian Oil Corporation Limited',
                   gstin: '24AAACI1681G1ZV', total: 474627, outstanding: 474627, status: 'pending', group: 'petcoke' };

/* ── 1. THE REPORTED GAP: the transporter can now match ── */
const n1 = np('NEFT DR-NAGOUR GOLDEN TRANSPORT-N123456789');
const r1 = R.resolve(n1, debit(55233), { bills: [IOC_BILL], entries: [FREIGHT] });
eq('a freight debit finds the recorded payment', r1.kind, 'entry');
eq('...and only LINKS — it must never post money twice', r1.action, 'link');
eq('...pointing at that entry', r1.entryId, 'fr1');
ok('...with real confidence', r1.confidence >= 70);
ok('...and says it is already recorded', /already recorded/i.test(r1.reasons.join(' ')));
ok('...naming the transporter', /Nagour/i.test(r1.reasons.join(' ')));
eq('...it never links a bill index (that would post)', r1.idx, null);

/* ── 2. THE MONEY-LOSING CASE: both a bill and an entry could match ──
   Same amount recorded AND an unpaid bill for the same amount. Posting would
   pay it twice. The engine must ask, never post. */
const SAME = { id: 'cb9', date: '2026-01-20', amount: 100000, party: 'Mateshwari Mines', method: 'Bank', kind: 'payment', dir: 'out' };
const BILL_SAME = { idx: 3, bill: '222/26-27', date: '2026-01-18', sup: 'Mateshwari Mines', total: 100000, outstanding: 100000, status: 'pending' };
const r2 = R.resolve(np('NEFT DR-MATESHWARI MINES-N99'), debit(100000, '2026-01-20'), { bills: [BILL_SAME], entries: [SAME] });
eq('an already-recorded payment wins over the bill', r2.kind, 'entry');
eq('...and links, never posts', r2.action, 'link');
ok('the same money is never posted twice', r2.action !== 'post');

/* ── 2b. THE HALF-SURE CASE — where money is actually lost ──
   Test 2 is the easy version: the entry is an obvious match, so the engine
   links. The dangerous case is the HALF-sure one — an entry that looks like it
   could be this money (right party, plausible) but isn't certain, sitting
   beside a matching bill. Confidence is not high enough to link, and that is
   exactly when "just post it" costs the firm a payment. It must ASK.
   (Mutation testing found this: deleting the whole ask-branch kept every other
   test green, because none of them ever reached it.) */
const HALF = { id: 'cb7', date: '2026-02-28', amount: 100000, party: 'Mateshwari Mines', method: 'Bank', kind: 'payment', dir: 'out' };
const rHalf = R.resolve(np('NEFT DR-MATESHWARI MINES-N99'), debit(100000, '2026-01-20'), { bills: [BILL_SAME], entries: [HALF] });
ok('a half-sure entry is not confidently linked', rHalf.action !== 'link');
eq('...and is NEVER silently posted — it asks', rHalf.action, 'ask');
ok('...naming what it might duplicate', /already-recorded payment to Mateshwari/i.test(rHalf.reasons.join(' ')));
ok('...and it is flagged for a human', rHalf.status === 'review');

/* ── 3. a genuine unpaid bill still POSTS (the feature must still work) ── */
const r3 = R.resolve(np('NEFT DR-INDIAN OIL CORPORATION LTD-N77'), debit(474627), { bills: [IOC_BILL], entries: [] });
eq('an unpaid bill with no recorded payment still posts', r3.action, 'post');
eq('...as a purchase', r3.kind, 'purchase');
ok('...linked to the bill', r3.idx === 0);

/* ── 4. a WEAK entry match must not silently block a real bill payment ── */
const OTHER = { id: 'cb2', date: '2026-01-15', amount: 999, party: 'Someone Else', method: 'Bank', kind: 'payment', dir: 'out' };
const r4 = R.resolve(np('NEFT DR-INDIAN OIL CORPORATION LTD-N77'), debit(474627), { bills: [IOC_BILL], entries: [OTHER] });
eq('an unrelated entry does not interfere', r4.action, 'post');

/* ── 5. AMOUNT IS ABSOLUTE for an entry — no "partial" ──
   A recorded payment has one true amount. A different amount is a different
   payment; treating it as partial would reconcile the wrong money. */
const rPart = R.scoreEntry(np('NEFT DR-NAGOUR GOLDEN TRANSPORT'), debit(30000), FREIGHT, {});
eq('a part amount is NOT this recorded payment', rPart.confidence, 0);
ok('...and says why', /Amount differs/i.test(rPart.reasons.join(' ')));
const rExact = R.scoreEntry(np('NEFT DR-NAGOUR GOLDEN TRANSPORT'), debit(55233), FREIGHT, {});
ok('the exact amount scores high', rExact.confidence >= 70);

/* ── 5b. THE NAME MUST CARRY ITS WEIGHT ──
   Amount alone is not identity. A firm pays many parties round figures, and
   ₹55,233 to a transporter is not ₹55,233 to a mine. Mutation testing caught
   this: letting every name score full marks kept all other tests green, because
   nothing asserted that a STRANGER with the right amount is refused. */
const STRANGER = { id: 'x1', date: '2026-01-15', amount: 55233, party: 'Mateshwari Mines', method: 'Bank', kind: 'payment', dir: 'out' };
const rStr = R.scoreEntry(np('NEFT DR-NAGOUR GOLDEN TRANSPORT-N1'), debit(55233), STRANGER, {});
ok('the right amount to the WRONG party is not this payment', rStr.confidence < 70);
const rStrR = R.resolve(np('NEFT DR-NAGOUR GOLDEN TRANSPORT-N1'), debit(55233), { bills: [], entries: [STRANGER] });
ok('...and is never auto-linked', rStrR.action !== 'link');
// and the right name still must beat the stranger when both are candidates
const rBoth = R.resolve(np('NEFT DR-NAGOUR GOLDEN TRANSPORT-N1'), debit(55233), { bills: [], entries: [STRANGER, FREIGHT] });
eq('with both on the table the correct party wins', rBoth.entryId, 'fr1');

/* ── 6. a CASH entry can never be a bank line ──
   Cash never moves through the account. Matching them reconciles money that
   never touched this bank. */
const CASH = Object.assign({}, FREIGHT, { id: 'fr2', method: 'Cash' });
const rCash = R.resolve(np('NEFT DR-NAGOUR GOLDEN TRANSPORT'), debit(55233), { bills: [], entries: [CASH] });
ok('a cash-recorded payment is not matched to a bank debit', rCash.kind !== 'entry' || rCash.confidence < 70);

/* ── 6b. the guard must not depend on which field happens to be filled ──
   Cashbook rows carry BOTH `method` ('Cash') and `mode` ('cash'), and `method`
   is sometimes blank. A guard that stops firing when a field is empty is not a
   guard. */
const CASH_MODE = { id: 'fr4', date: '2026-01-15', amount: 55233, party: 'Nagour Golden Transport', method: '', mode: 'cash', dir: 'out' };
ok('a cash entry known only by `mode` is still refused',
  R.scoreEntry(np('NEFT DR-NAGOUR GOLDEN TRANSPORT'), debit(55233), CASH_MODE, {}).confidence < 70);

/* ── 6c. one bank's money is not another's ──
   Same party, same amount, same day — but recorded against a different account.
   That is a different payment. */
const OTHER_BANK = Object.assign({}, FREIGHT, { id: 'fr5', accountId: 'hdfc-002' });
ok('a payment recorded against ANOTHER bank account is not this line',
  R.scoreEntry(np('NEFT DR-NAGOUR GOLDEN TRANSPORT'), debit(55233), OTHER_BANK, { accountId: 'bob-001' }).confidence < 70);
ok('...and says why', /different bank account/i.test(
  R.scoreEntry(np('NEFT DR-NAGOUR GOLDEN TRANSPORT'), debit(55233), OTHER_BANK, { accountId: 'bob-001' }).reasons.join(' ')));
ok('the SAME account still matches', R.scoreEntry(np('NEFT DR-NAGOUR GOLDEN TRANSPORT'), debit(55233), Object.assign({}, FREIGHT, { accountId: 'bob-001' }), { accountId: 'bob-001' }).confidence >= 70);
// Legacy rows predate multi-bank and have no accountId. Absence is not disagreement.
ok('a legacy entry with no account is not punished for it',
  R.scoreEntry(np('NEFT DR-NAGOUR GOLDEN TRANSPORT'), debit(55233), FREIGHT, { accountId: 'bob-001' }).confidence >= 70);

/* ── 7. direction + already-linked ── */
const rCr = R.resolve(np('NEFT CR-NAGOUR GOLDEN TRANSPORT'), { date: '2026-01-15', credit: 55233, debit: 0 }, { bills: [], entries: [FREIGHT] });
ok('a CREDIT never matches a money-out entry', rCr.kind !== 'entry');
const LINKED = Object.assign({}, FREIGHT, { id: 'fr3', linked: true });
const rLinked = R.resolve(np('NEFT DR-NAGOUR GOLDEN TRANSPORT'), debit(55233), { bills: [], entries: [LINKED] });
ok('an entry already reconciled to another line is not offered again', rLinked.kind !== 'entry');

/* ── 8. a far-off date is a different payment ── */
const rFar = R.scoreEntry(np('NEFT DR-NAGOUR GOLDEN TRANSPORT'), debit(55233, '2026-06-15'), FREIGHT, {});
ok('the same amount 5 months later is not confidently the same payment', rFar.confidence < 70);
ok('...and says so', /days away/i.test(rFar.reasons.join(' ')));

/* ══ RECURRING PAYEES — "the party we pay every month" ══ */
const monthly = [
  { id: 'a', date: '2025-11-15', amount: 54000, party: 'Nagour Golden Transport', method: 'Bank', dir: 'out' },
  { id: 'b', date: '2025-12-16', amount: 56500, party: 'Nagour Golden Transport', method: 'Bank', dir: 'out' },
  { id: 'c', date: '2026-01-15', amount: 55233, party: 'Nagour Golden Transport', method: 'Bank', dir: 'out' },
  { id: 'd', date: '2026-01-03', amount: 12000, party: 'One Off Traders', method: 'Bank', dir: 'out' },
  // three payments in ONE week is a busy week, not a monthly arrangement
  { id: 'e', date: '2026-01-05', amount: 5000, party: 'Burst Vendor', method: 'Bank', dir: 'out' },
  { id: 'f', date: '2026-01-06', amount: 5000, party: 'Burst Vendor', method: 'Bank', dir: 'out' },
  { id: 'g', date: '2026-01-07', amount: 5000, party: 'Burst Vendor', method: 'Bank', dir: 'out' },
];
const rec = R.recurringPayees(monthly);
const nag = rec.find(x => /Nagour/i.test(x.party));
ok('a party paid in 3 different months is monthly', nag.monthly === true && nag.confident === true);
eq('...median amount', nag.medianAmount, 55233);
ok('...median day around the 15th', Math.abs(nag.medianDay - 15) <= 1);
ok('...and explains itself', /different months/i.test(nag.why));

const one = rec.find(x => /One Off/i.test(x.party));
ok('a single payment is never "monthly"', !one.confident);
ok('...and says how many more are needed', /need 3/.test(one.why));

const burst = rec.find(x => /Burst/i.test(x.party));
ok('3 payments in ONE month is not monthly', burst.monthly === false);
ok('...and says exactly that', /only 1 month/i.test(burst.why));

/* knownPayee raises confidence and explains — it must never invent a match */
const kp = R.knownPayee(np('NEFT DR-NAGOUR GOLDEN TRANSPORT-N1'), debit(55000), rec);
ok('a familiar monthly payee is recognised', kp && kp.monthly === true);
ok('...and the usual amount is noted', kp.amountUsual === true);
ok('...in plain words', /about every month/i.test(kp.why));
const kpOdd = R.knownPayee(np('NEFT DR-NAGOUR GOLDEN TRANSPORT-N1'), debit(500000), rec);
ok('an unusual amount from a familiar payee is flagged, not waved through', kpOdd.amountUsual === false);
ok('...and says the amount is unusual', /unusual/i.test(kpOdd.why));
ok('an unknown party is not a known payee', R.knownPayee(np('NEFT DR-RANDOM CO'), debit(100), rec) === null);
ok('a non-confident payee never counts as known',
  R.knownPayee(np('NEFT DR-ONE OFF TRADERS'), debit(12000), rec) === null);

console.log('\n════ bank line: pays a bill, or IS a payment ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' RECON-ENTRY TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
