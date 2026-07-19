/* payments.test.js — the Payments Center posts every rupee that moves. No tests.
 *
 * Two layers, because a bug in either costs real money:
 *
 *   1. The POSTING maths in data.js — receiveSalesPayment / payPurchaseBill /
 *      addTransfer / addLedgerPayment / paymentsLedger / paymentsSummary. Extracted
 *      out of data.js and run for real; nothing is re-implemented here.
 *   2. The MODALS in payments.js — the real file is loaded in a VM, its QLX.mount
 *      config captured, and the real onSave handlers fired against the real data.js
 *      functions over one real store. So "user fills the form → money lands in the
 *      ledger" is the actual shipped path, end to end.
 *
 * What this file found (documented, NOT fixed — see the ✗ BUG sections):
 *
 *   A. OVER-PAYMENT SILENTLY LOSES MONEY. Paying ₹75,000 against a ₹60,000 invoice
 *      caps s.paid at ₹60,000 (Math.min) but posts the FULL ₹75,000 to the cash
 *      book. The ₹15,000 excess is in the bank ledger and recorded nowhere as an
 *      advance or a credit to the customer — the invoice says settled, and the
 *      customer's ₹15,000 has no home. s.payments[] keeps the uncapped ₹75,000, so
 *      the invoice's own two fields disagree with each other. Identical on the
 *      purchase side (payPurchaseBill → recordPurchasePayment).
 *   B. delPayment() trashes a ledger row without reverting the invoice/bill it
 *      settled — the modal's own copy admits this ("The linked invoice/bill status
 *      is not reverted"). Deleting the payment leaves the invoice marked Paid.
 *      Documented at §7 as shipped behaviour.
 *
 *   node payments.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
/* JSON-compare, not ===. `[] === []` is false and would report "got: [] expected: []"
   as a failure — a lie this repo has written three times. */
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ Payments Center · posting · over-payment · the ledger ═══\n');

/* grabLine for one-liners, grabBlock for multi-line — slicing a one-liner to the
   first ';' truncates it and dies as a bare "Unexpected end of input". */
function grabLine(startsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) throw new Error('not found in data.js: ' + startsWith);
  return src.slice(i, src.indexOf('\n', i));
}
function grabBlock(startsWith, endsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) throw new Error('not found in data.js: ' + startsWith);
  return src.slice(i, src.indexOf(endsWith, i) + endsWith.length);
}

const S = { CASHBOOK: [], SALES: [], PURCHASES: [], FINANCE: { opening: {} } };
const dctx = {
  console, Math, Object, Array, Number, String, Date, JSON, isNaN, parseFloat, S,
  commit: () => {},                       // persistence is not under test
  bankAccountLabel: id => 'HDFC ·1234',
  partyGstin: () => '', daysAgo: () => 0, fC: n => '₹' + n,
  /* purchaseRows' taxonomy/roll-up helpers. Stubbed because the GROUP of a bill is
     irrelevant to whether its PAYMENT posts correctly — and each is proven by its
     own suite (freight.test.js, purchase-qty.test.js). The money fields
     (cP → total/paid/outstanding/status) are the real thing. */
  catToGroupItem: () => ({ group: 'other', item: 'Other', dept: '' }),
  PGROUP_MAP: { other: { label: 'Other', emoji: '•' } },
  itemIcon: () => '•', isFreightItem: () => false, nameByGstin: () => '',
  QL_PLANT: { owner_name: 'Owner' }, SUP_LEAK: /^$/
};
vm.createContext(dctx);
vm.runInContext([
  grabLine('const withIdx = arr =>'),
  grabLine('  let _seq = 0;').trim(),
  grabLine('function idStamp()'),
  grabLine('function fmtISO(d)'),
  grabLine('const cS = s =>'), grabLine('const cP = p =>'),
  grabLine('function cleanSup(p)'),
  grabLine('function methodToMode(m)'), grabLine('function modeToMethod(m)'),
  /* the shared "live money" predicate — a trashed/cancelled payment must leave the
     BALANCE. accountBalances() closes over it in data.js; grab it or the vm can't
     see it (it lives in the module scope, not inside accountBalances). */
  grabLine('const liveMoney = e =>'),
  grabBlock('function accountBalances()', '\n  }'),
  grabBlock('function paymentsLedger()', '\n  }'),
  grabBlock('function paymentsSummary()', '\n  }'),
  grabBlock('function receiveSalesPayment(i, o)', '\n  }'),
  grabBlock('function recordPurchasePayment(i, amount, mode, date, extra)', '\n  }'),
  grabLine('function payPurchaseBill(i, o)'),
  grabBlock('function addLedgerPayment(o)', '\n  }'),
  grabBlock('function addTransfer(o)', '\n  }'),
  grabBlock('function salesRows()', '\n  }'),
  grabBlock('function purchaseRows()', '\n  }'),
  grabLine('const PAY_METHODS ='),
  /* The REAL period helpers, not a re-implementation: they are what the page's
     month filter runs on, and a hand-copied `inPeriod` in this file would be
     free to agree with a broken one in data.js. */
  grabBlock('function inPeriod(date, period)', '\n  }'),
  grabBlock('function monthLabel(ym, opts)', '\n  }'),
  grabBlock('function periodLabel(p, allLabel)', '\n  }'),
  'this.X = { methodToMode, accountBalances, paymentsLedger, paymentsSummary, receiveSalesPayment, payPurchaseBill, addLedgerPayment, addTransfer, salesRows, purchaseRows, cS, cP, PAY_METHODS, inPeriod, periodLabel };'
].join('\n'), dctx);
const X = dctx.X;
ok(typeof X.receiveSalesPayment === 'function', 'the real posting maths loaded out of data.js');
ok(typeof X.paymentsLedger === 'function', 'the real paymentsLedger loaded out of data.js');

const reset = () => { S.CASHBOOK.length = 0; S.SALES.length = 0; S.PURCHASES.length = 0; S.FINANCE.opening = {}; };
/* gstR 0 keeps the arithmetic legible: a ₹60,000 invoice is ₹60,000. GST maths is
   pinned by pl-gst.test.js; what is under test here is where the MONEY goes. */
const INV = { inv: 'INV-001', date: '2026-07-01', party: 'Aziz Chemicals', qty: 100, rate: 600, gstR: 0, status: 'pending' };
const BILL = { bill: 'B-001', date: '2026-07-01', sup: 'Ramkaran And Sons', taxable: 100000, grate: 0, status: 'pending' };

/* ══════════ 1. paymentsLedger — the running balance ══════════ */
{
  reset();
  X.addLedgerPayment({ dir: 'in', amount: 1000, method: 'Bank', date: '2026-07-03', party: 'A' });
  X.addLedgerPayment({ dir: 'out', amount: 300, method: 'Bank', date: '2026-07-01', party: 'B' });
  X.addLedgerPayment({ dir: 'in', amount: 500, method: 'Bank', date: '2026-07-02', party: 'C' });
  const led = X.paymentsLedger();

  eq('the table is newest-first', led.map(r => r.date), ['2026-07-03', '2026-07-02', '2026-07-01']);
  /* The running balance must accumulate in DATE order regardless of entry order —
     the rows were written 3rd, 1st, 2nd. A balance computed in insertion order
     would read −300 / 700 / 1200 and every row would be wrong but the last. */
  eq('the running balance accumulates in DATE order, not insertion order',
    led.map(r => r.balance), [1200, 200, -300]);
  eq('  the oldest row is the first movement alone', led[2].balance, -300);
  eq('  and the newest equals the closing balance', led[0].balance, 1200);
  eq('a credit fills `credit` and leaves `debit` at 0', [led[0].credit, led[0].debit], [1000, 0]);
  eq('a debit fills `debit` and leaves `credit` at 0', [led[2].credit, led[2].debit], [0, 300]);
  /* ['in','in','out'] — NOT ['in','out','in']. The rows are date-DESC, and the two
     assertions above already fix the ends: led[0] is the credit (in) and led[2] is
     the debit (out). The original expectation contradicted them; the code was right.
     Derived from the balances too: -300 → 200 is a +500 credit, so led[1] is 'in'. */
  eq('dir mirrors the direction', led.map(r => r.dir), ['in', 'in', 'out']);
  /* idx must be the RAW store index — Delete passes it to deleteLedgerEntry(). */
  eq('idx is the RAW store index, not the sorted position', led.map(r => r.idx), [0, 2, 1]);
  eq('  so the top row points at the entry actually written first', S.CASHBOOK[led[0].idx].party, 'A');

  /* Two entries on ONE day: the balance must still be deterministic (date, then idx). */
  reset();
  X.addLedgerPayment({ dir: 'in', amount: 100, method: 'Bank', date: '2026-07-01', party: 'A' });
  X.addLedgerPayment({ dir: 'in', amount: 200, method: 'Bank', date: '2026-07-01', party: 'B' });
  eq('same-day rows break the tie on insertion order', X.paymentsLedger().map(r => r.balance), [300, 100]);

  /* A trashed ledger row must not appear — and must not shift the balance. */
  reset();
  X.addLedgerPayment({ dir: 'in', amount: 1000, method: 'Bank', date: '2026-07-01', party: 'A' });
  X.addLedgerPayment({ dir: 'in', amount: 500, method: 'Bank', date: '2026-07-02', party: 'B' });
  S.CASHBOOK[1]._del = { at: '2026-07-03T00:00:00.000Z', by: 'owner', role: 'owner', reason: 'duplicate' };
  eq('a TRASHED ledger row leaves the table', X.paymentsLedger().length, 1);
  eq('  and its ₹500 is out of the running balance', X.paymentsLedger()[0].balance, 1000);
}

/* ══════════ 2. receiveSalesPayment — exact and partial ══════════ */
{
  reset(); S.SALES.push(Object.assign({}, INV));
  eq('the invoice is ₹60,000', X.cS(S.SALES[0]).tot, 60000);
  eq('  and starts fully outstanding', X.salesRows()[0].outstanding, 60000);

  X.receiveSalesPayment(0, { amount: 60000, method: 'Bank', ref: 'UTR123', date: '2026-07-05' });
  eq('paying in full marks it paid', S.SALES[0].status, 'paid');
  eq('  outstanding goes to zero', X.salesRows()[0].outstanding, 0);
  eq('  and ONE credit lands in the cash book', X.paymentsLedger().length, 1);
  eq('  for the full amount', X.paymentsLedger()[0].credit, 60000);
  eq('  as money IN', X.paymentsLedger()[0].dir, 'in');
  eq('  tagged Sales Payment', X.paymentsLedger()[0].ptype, 'Sales Payment');
  eq('  linked back to the invoice, so the row can open its source', X.paymentsLedger()[0].link, { kind: 'sale', idx: 0 });
  eq('  and it raises the bank balance', X.accountBalances().bank, 60000);

  /* Partial → the register must show it as partial, not paid, and the remainder
     must stay collectable. A partial rounding to 'paid' writes off real money. */
  reset(); S.SALES.push(Object.assign({}, INV));
  X.receiveSalesPayment(0, { amount: 25000, method: 'Bank', date: '2026-07-05' });
  eq('a partial payment marks the invoice partial', S.SALES[0].status, 'partial');
  eq('  paid is what was actually received', X.salesRows()[0].paid, 25000);
  eq('  and ₹35,000 is still owed', X.salesRows()[0].outstanding, 35000);

  /* Two partials that ADD UP must settle the invoice — this is the common real case
     (an advance, then the balance on delivery). */
  X.receiveSalesPayment(0, { amount: 35000, method: 'Cash', date: '2026-07-09' });
  eq('a second partial settles it', S.SALES[0].status, 'paid');
  eq('  nothing outstanding', X.salesRows()[0].outstanding, 0);
  eq('  BOTH payments are in the ledger — not overwritten', X.paymentsLedger().length, 2);
  eq('  totalling the invoice', X.paymentsLedger().reduce((s, r) => s + r.credit, 0), 60000);
  eq('  each against the account it actually came into', X.accountBalances().cash, 35000);
  eq('  and the bank', X.accountBalances().bank, 25000);
  eq('  and s.payments[] keeps both legs', S.SALES[0].payments.map(p => p.amount), [25000, 35000]);

  /* The ₹0.50 tolerance: `paid >= tot - 0.5` marks paid. A ₹59,999.60 payment is
     a rounding artefact, not a debt — it must settle. */
  reset(); S.SALES.push(Object.assign({}, INV));
  X.receiveSalesPayment(0, { amount: 59999.6, method: 'Bank', date: '2026-07-05' });
  eq('a payment 40 paise short still settles (rounding tolerance)', S.SALES[0].status, 'paid');
  reset(); S.SALES.push(Object.assign({}, INV));
  X.receiveSalesPayment(0, { amount: 59000, method: 'Bank', date: '2026-07-05' });
  eq('  but ₹1,000 short is genuinely partial, not "close enough"', S.SALES[0].status, 'partial');
  eq('  and the ₹1,000 stays collectable', X.salesRows()[0].outstanding, 1000);

  /* A payment against a non-existent invoice must be a no-op, not a crash or a
     phantom cash-book row. */
  reset();
  X.receiveSalesPayment(99, { amount: 5000, method: 'Bank', date: '2026-07-05' });
  eq('paying a non-existent invoice posts NOTHING', X.paymentsLedger().length, 0);
}

/* ══════════ 3. ✗ BUG — over-payment silently loses money (SALES) ══════════
   This documents the CURRENT behaviour. It is not correct; it is what ships. */
{
  reset(); S.SALES.push(Object.assign({}, INV));
  X.receiveSalesPayment(0, { amount: 75000, method: 'Bank', ref: 'UTR999', date: '2026-07-05' });

  eq('the customer sent ₹75,000 against a ₹60,000 invoice — the cash book has all of it',
    X.paymentsLedger()[0].credit, 75000);
  eq('  and the bank balance is right', X.accountBalances().bank, 75000);
  /* …but the invoice caps at its own total (Math.min(c.tot, prev + amount)). */
  eq('  ✗ BUG: the invoice records only ₹60,000 paid — the ₹15,000 excess is capped away',
    S.SALES[0].paid, 60000);
  eq('  ✗ BUG: outstanding is 0, so the invoice looks cleanly settled', X.salesRows()[0].outstanding, 0);
  /* The excess is not held anywhere: not on the invoice, not as an advance. The
     firm owes this customer ₹15,000 and nothing in the books says so. */
  eq('  ✗ BUG: the ₹15,000 the firm now OWES the customer is recorded nowhere',
    X.paymentsLedger().reduce((s, r) => s + r.credit, 0) - X.salesRows()[0].paid, 15000);
  /* The invoice's own two fields disagree — s.payments[] is uncapped, s.paid is not. */
  eq('  ✗ BUG: s.payments[] kept the true ₹75,000…', S.SALES[0].payments[0].amount, 75000);
  eq('  ✗ BUG: …while s.paid says ₹60,000 — one invoice, two numbers, ₹15,000 apart',
    S.SALES[0].payments[0].amount - S.SALES[0].paid, 15000);

  /* The nastier shape: over-paying an ALREADY-paid invoice. prev = c.tot, so
     Math.min caps at tot and paid does not move AT ALL — yet a full second credit
     posts to the bank. A duplicate payment leaves no trace on the invoice. */
  reset(); S.SALES.push(Object.assign({}, INV));
  X.receiveSalesPayment(0, { amount: 60000, method: 'Bank', date: '2026-07-05' });
  X.receiveSalesPayment(0, { amount: 60000, method: 'Bank', date: '2026-07-06' });   // paid twice
  eq('  ✗ BUG: paying a settled invoice AGAIN posts a second ₹60,000 to the bank',
    X.accountBalances().bank, 120000);
  eq('  ✗ BUG: …and the invoice still just says ₹60,000 paid', S.SALES[0].paid, 60000);
  ok(X.paymentsLedger().length === 2,
    '  ✗ BUG: two credits exist; only the ledger knows the invoice was paid twice');
}

/* ══════════ 4. payPurchaseBill — and the SAME over-payment bug ══════════ */
{
  reset(); S.PURCHASES.push(Object.assign({}, BILL));
  eq('the bill is ₹1,00,000', X.purchaseRows()[0].total, 100000);

  X.payPurchaseBill(0, { amount: 100000, method: 'Bank', ref: 'NEFT1', date: '2026-07-05' });
  eq('paying in full marks the bill paid', S.PURCHASES[0].status, 'paid');
  eq('  nothing outstanding', X.purchaseRows()[0].outstanding, 0);
  eq('  ONE debit lands in the cash book', X.paymentsLedger().length, 1);
  eq('  as money OUT', X.paymentsLedger()[0].dir, 'out');
  eq('  for the full amount', X.paymentsLedger()[0].debit, 100000);
  eq('  tagged Purchase Payment', X.paymentsLedger()[0].ptype, 'Purchase Payment');
  eq('  linked to the bill', X.paymentsLedger()[0].link, { kind: 'purchase', idx: 0 });
  eq('  and it DRAINS the bank (a payment out must not credit)', X.accountBalances().bank, -100000);

  /* The method must survive to the ledger — recordPurchasePayment takes a `mode`
     but payPurchaseBill passes the human method through `extra`. If that breaks,
     a Cash payment shows as Bank and reconciliation matches it against a bank line. */
  reset(); S.PURCHASES.push(Object.assign({}, BILL));
  X.payPurchaseBill(0, { amount: 50000, method: 'PhonePe', date: '2026-07-05' });
  eq('a PhonePe bill payment keeps its method', X.paymentsLedger()[0].method, 'PhonePe');
  eq('  and buckets to UPI, not bank', X.paymentsLedger()[0].mode, 'upi');
  eq('  hitting the UPI balance', X.accountBalances().upi, -50000);
  eq('  the bill is partial', S.PURCHASES[0].status, 'partial');
  eq('  with ₹50,000 still to pay', X.purchaseRows()[0].outstanding, 50000);

  /* Same bug, supplier side. */
  reset(); S.PURCHASES.push(Object.assign({}, BILL));
  X.payPurchaseBill(0, { amount: 150000, method: 'Bank', date: '2026-07-05' });
  eq('₹1,50,000 really left the bank on a ₹1,00,000 bill', X.accountBalances().bank, -150000);
  eq('  ✗ BUG: the bill records only ₹1,00,000 paid', S.PURCHASES[0].paid, 100000);
  eq('  ✗ BUG: the ₹50,000 the supplier now owes back is recorded nowhere',
    X.paymentsLedger().reduce((s, r) => s + r.debit, 0) - S.PURCHASES[0].paid, 50000);

  reset();
  X.payPurchaseBill(99, { amount: 5000, method: 'Bank', date: '2026-07-05' });
  eq('paying a non-existent bill posts NOTHING', X.paymentsLedger().length, 0);
}

/* ══════════ 5. addTransfer — money must be CONSERVED ══════════
   A transfer is the one operation that must never change the total. If it posted
   only one leg, moving cash to the bank would create or destroy money. */
{
  reset();
  X.addTransfer({ fromMethod: 'Cash', toMethod: 'Bank', amount: 50000, date: '2026-07-06', ptype: 'Cash Deposit' });
  eq('a transfer posts TWO legs', X.paymentsLedger().length, 2);
  eq('  a debit out of cash', X.accountBalances().cash, -50000);
  eq('  a credit into bank', X.accountBalances().bank, 50000);
  eq('  and the TOTAL is unchanged — money is conserved', X.accountBalances().total, 0);
  eq('  both legs carry the same ptype', X.paymentsLedger().map(r => r.ptype), ['Cash Deposit', 'Cash Deposit']);
  eq('  both on the same date', X.paymentsLedger().map(r => r.date), ['2026-07-06', '2026-07-06']);
  eq('  and the ledger nets to zero', X.paymentsLedger().reduce((s, r) => s + r.credit - r.debit, 0), 0);

  /* On top of a real balance — the deposit shape a plant actually does. */
  reset(); S.FINANCE.opening = { cash: 200000, bank: 0, upi: 0 };
  X.addTransfer({ fromMethod: 'Cash', toMethod: 'Bank', amount: 150000, date: '2026-07-06', ptype: 'Cash Deposit' });
  eq('depositing cash leaves ₹50,000 in hand', X.accountBalances().cash, 50000);
  eq('  and ₹1,50,000 in the bank', X.accountBalances().bank, 150000);
  eq('  the firm is no richer or poorer', X.accountBalances().total, 200000);

  /* UPI → Bank, so the transfer path is not cash-only. */
  reset();
  X.addTransfer({ fromMethod: 'PhonePe', toMethod: 'Bank', amount: 10000, date: '2026-07-06' });
  eq('a UPI→Bank transfer drains UPI', X.accountBalances().upi, -10000);
  eq('  and fills bank', X.accountBalances().bank, 10000);
  eq('  conserving the total', X.accountBalances().total, 0);
}

/* ══════════ 6. paymentsSummary — the stat cards ══════════ */
{
  const today = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0');
  reset();
  X.addLedgerPayment({ dir: 'in', amount: 5000, method: 'Bank', date: today, party: 'A' });
  X.addLedgerPayment({ dir: 'out', amount: 2000, method: 'Cash', date: today, party: 'B' });
  X.addLedgerPayment({ dir: 'in', amount: 9999, method: 'Bank', date: '2020-01-01', party: 'Old' });
  const s = X.paymentsSummary();
  eq('Money In Today counts only today', s.inToday, 5000);
  eq('Money Out Today counts only today', s.outToday, 2000);
  eq('  an old credit is excluded from today…', s.inToday, 5000);
  eq('  …but still counted in the balance', s.total, 12999);
  eq('count is every live ledger row', s.count, 3);

  /* Outstanding must exclude cancelled invoices — a cancelled invoice is not a
     receivable, and counting it inflates what the firm thinks it is owed. */
  reset();
  S.SALES.push(Object.assign({}, INV));
  S.SALES.push(Object.assign({}, INV, { inv: 'INV-002', status: 'cancelled' }));
  eq('customer outstanding EXCLUDES the cancelled invoice', X.paymentsSummary().custOutstanding, 60000);
  S.SALES.push(Object.assign({}, INV, { inv: 'INV-003', _del: { at: 'x' } }));
  eq('  and a TRASHED invoice too (withIdx filters it)', X.paymentsSummary().custOutstanding, 60000);

  reset();
  S.PURCHASES.push(Object.assign({}, BILL));
  S.PURCHASES.push(Object.assign({}, BILL, { bill: 'B-002', status: 'paid' }));
  S.PURCHASES.push(Object.assign({}, BILL, { bill: 'B-003', status: 'cancelled' }));
  const s2 = X.paymentsSummary();
  eq('supplier outstanding counts only the OPEN bill', s2.supOutstanding, 100000);
  eq('  pending bill count matches', s2.pendingBills, 1);
}

/* ══════════ 7. THE PAGE — the real payments.js modals, driven ══════════ */
const noop = () => {};
const elStub = new Proxy({}, { get: (t, k) => (k === 'classList' ? { add: noop, remove: noop, toggle: noop, contains: () => false }
  : k === 'style' ? {} : k === 'dataset' ? {} : k === 'innerHTML' || k === 'textContent' || k === 'value' ? ''
  : k === 'children' || k === 'childNodes' ? [] : typeof k === 'string' ? noop : undefined), set: () => true });
const doc = {
  getElementById: () => elStub, querySelector: () => elStub, querySelectorAll: () => [],
  createElement: () => elStub, addEventListener: noop, body: elStub, documentElement: elStub
};
let CFG = null, FORM = null, toasts = [], exported = null, confirmed = null;
// The month/year the shared picker is standing on. 'all' | 'YYYY' | 'YYYY-MM'.
let QLXPERIOD = 'all';
/* The REAL extracted data.js functions over the REAL store — so firing a modal's
   onSave posts real money through the real path and the real ledger reads it back. */
const QLD = {
  fC: n => '₹' + Math.round(+n || 0).toLocaleString('en-IN'),
  fmt: n => String(n), fDS: d => String(d || ''), fL: n => String(n), daysAgo: () => 0,
  co: { name: 'Gotan Lime Industries', short: 'GOTAN' }, COMPANIES: {}, ownFirmNames: [], activeCo: 'gotan',
  paymentsLedger: () => X.paymentsLedger(), paymentsSummary: () => X.paymentsSummary(),
  paymentsInsights: () => [], accountBalances: () => X.accountBalances(),
  inPeriod: (d, p) => X.inPeriod(d, p), periodLabel: (p, a) => X.periodLabel(p, a),
  salesRows: () => X.salesRows(), purchaseRows: () => X.purchaseRows(),
  receiveSalesPayment: (i, o) => X.receiveSalesPayment(i, o),
  payPurchaseBill: (i, o) => X.payPurchaseBill(i, o),
  addTransfer: o => X.addTransfer(o), addLedgerPayment: o => X.addLedgerPayment(o),
  payLoanEmi: (i, o) => { QLD._emi = { i, o }; },
  deleteLedgerEntry: (i, reason) => { QLD._deleted = { i, reason }; },
  loanRows: () => [{ name: 'HDFC Term Loan', emi: 45000 }],
  paymentMethods: X.PAY_METHODS, bankAccounts: () => [], bankAccountById: () => null, bankAccountLabel: () => '',
  partyRows: () => [], uiMonth: () => null, setUiMonth: noop
};
const ctx = {
  console, window: {}, document: doc,
  QLShell: {
    mount: noop, modal: noop, toast: noop,
    openForm: f => { FORM = f; },
    confirmDelete: o => { confirmed = o; },
    exportCSV: (name, head, rows) => { exported = { name, head, rows }; }
  },
  QLD, QLFin: {}, QLMobile: null,
  /* rows/month/monthLabel are the month-filter half of the real QLX. The page
     reads them for its stats, its export and its subtitle, so a stub without
     them is not a smaller QLX — it is a different one, and the page would only
     fail here. `QLXPERIOD` lets a test drive the picker. */
  QLX: { esc: s => String(s == null ? '' : s), svg: () => '', icons: {},
    toast: (m, t) => { toasts.push([m, t]); }, refresh: noop, state: () => ({}),
    rows: () => QLD.paymentsLedger().filter(r => QLD.inPeriod(r.date, QLXPERIOD)),
    month: () => (QLXPERIOD && QLXPERIOD !== 'all') ? QLXPERIOD : null,
    monthLabel: () => QLD.periodLabel(QLXPERIOD),
    actionsCell: () => '', open: noop, close: noop, mount: c => { CFG = c; } },
  setTimeout: noop, clearTimeout: noop, requestAnimationFrame: noop,
  localStorage: { getItem: () => null, setItem: noop }, sessionStorage: { getItem: () => null, setItem: noop },
  location: { href: 'https://app.quicklimes.com/v2/payments', search: '', hash: '', pathname: '/v2/payments' },
  history: { replaceState: noop, pushState: noop }, navigator: { userAgent: 'node' }, alert: noop, confirm: () => false,
  Date, JSON, Math, Object, Array, Set, Map, String, Number, isNaN, parseFloat, parseInt
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.window.QLD = QLD;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'payments.js'), 'utf8'), ctx);
ok(CFG !== null, 'the real payments.js mounted and handed over its config');

const openTool = label => { FORM = null; toasts = []; CFG.tools.find(t => t.label === label).onClick(); return FORM; };
const openPrimary = () => { FORM = null; toasts = []; CFG.primary.onClick(); return FORM; };

/* ── the Receive Payment modal, end to end ── */
{
  reset();
  S.SALES.push(Object.assign({}, INV));                                            // ₹60,000 open
  S.SALES.push(Object.assign({}, INV, { inv: 'INV-002', date: '2026-07-04', party: 'Shree Cement', rate: 200 })); // ₹20,000 open
  S.SALES.push(Object.assign({}, INV, { inv: 'INV-003', status: 'cancelled' }));
  const f = openPrimary();
  ok(f !== null, 'Receive Payment opens a form');

  /* The invoice picker must offer the unpaid invoices — and not a cancelled one. */
  const invOpts = f.specs.find(s => s.k === 'inv').opts;
  eq('the picker lists both UNPAID invoices', invOpts.length, 2);
  ok(!invOpts.some(o => /INV-003/.test(o[1])), '  and never a CANCELLED invoice');
  ok(/INV-002/.test(invOpts[0][1]), '  newest invoice first');
  ok(/60,000 due/.test(invOpts.find(o => /INV-001/.test(o[1]))[1]), '  each option shows the real amount due');
  eq('the picker is searchable (a plant has hundreds of invoices)',
    f.specs.find(s => s.k === 'inv').type, 'searchselect');
  eq('the amount pre-fills to the full outstanding of the default invoice', f.initial.amount, 20000);
  ok(f.specs.find(s => s.k === 'amount').reqNonZero, 'a ₹0 payment is rejected by the form');

  /* Fire the REAL onSave — money must land in the REAL ledger. */
  f.onSave({ inv: String(X.salesRows().find(r => r.inv === 'INV-001').idx), amount: '60000', method: 'Bank', ref: 'UTR1', date: '2026-07-05', notes: '' });
  eq('saving the form marks the invoice paid', S.SALES[0].status, 'paid');
  eq('  a STRING amount from the form is coerced, not concatenated', X.paymentsLedger()[0].credit, 60000);
  eq('  and the bank balance moves', X.accountBalances().bank, 60000);
  ok(toasts.some(t => /invoice updated/i.test(t[0])), '  and the user is told');

  /* No unpaid invoices → the modal must not open on an empty picker. */
  reset(); S.SALES.push(Object.assign({}, INV, { status: 'paid', paid: 60000 }));
  const f2 = openPrimary();
  eq('with nothing unpaid the form does NOT open', f2, null);
  ok(toasts.some(t => /no unpaid/i.test(t[0])), '  the user gets "No unpaid invoices" instead');
}

/* ── the Pay Bill modal, end to end ── */
{
  reset();
  S.PURCHASES.push(Object.assign({}, BILL));
  S.PURCHASES.push(Object.assign({}, BILL, { bill: 'B-002', status: 'paid' }));
  S.PURCHASES.push(Object.assign({}, BILL, { bill: 'B-003', status: 'cancelled' }));
  const f = openTool('Pay Bill');
  ok(f !== null, 'Pay Bill opens a form');
  const billOpts = f.specs.find(s => s.k === 'bill').opts;
  eq('the picker lists only the OPEN bill', billOpts.length, 1);
  ok(/B-001/.test(billOpts[0][1]), '  the right one');
  ok(!billOpts.some(o => /B-002|B-003/.test(o[1])), '  never a paid or cancelled bill');
  eq('the amount pre-fills to what is actually due', f.initial.amount, 100000);

  f.onSave({ bill: '0', amount: '40000', method: 'Cash', ref: '', date: '2026-07-05', notes: '' });
  eq('saving marks the bill partial', S.PURCHASES[0].status, 'partial');
  eq('  ₹60,000 still to pay', X.purchaseRows()[0].outstanding, 60000);
  eq('  and cash went OUT, not in', X.accountBalances().cash, -40000);

  reset(); S.PURCHASES.push(Object.assign({}, BILL, { status: 'paid' }));
  eq('with no pending bills the form does NOT open', openTool('Pay Bill'), null);
  ok(toasts.some(t => /no pending bills/i.test(t[0])), '  "No pending bills" instead');
}

/* ── ✗ BUG A, through the REAL modal ──
   Not just a data.js quirk: this is what happens when a user types 75000. */
{
  reset(); S.SALES.push(Object.assign({}, INV));
  const f = openPrimary();
  f.onSave({ inv: '0', amount: '75000', method: 'Bank', ref: '', date: '2026-07-05', notes: '' });
  eq('✗ BUG (via the real form): the ledger takes the full ₹75,000', X.paymentsLedger()[0].credit, 75000);
  eq('  ✗ BUG: the invoice caps at ₹60,000', S.SALES[0].paid, 60000);
  eq('  ✗ BUG: and shows as fully settled', X.salesRows()[0].outstanding, 0);
  ok(toasts.some(t => /invoice updated/i.test(t[0]) && t[1] === 'ok'),
    '  ✗ BUG: the user is told "Payment received — invoice updated" with NO warning about the ₹15,000');
  /* Nothing in the form even validates against the outstanding. */
  ok(!f.specs.find(s => s.k === 'amount').max,
    '  ✗ BUG: the amount field has no max — over-paying is not even flagged in the UI');
}

/* ── the Transfer modal ── */
{
  reset();
  const f = openTool('Transfer');
  ok(f !== null, 'Transfer opens a form');
  eq('it defaults to the common case — cash to bank', [f.initial.from, f.initial.to], ['Cash', 'Bank']);

  /* Same account both sides must be REFUSED — it would post two legs that cancel
     and pollute the ledger with a meaningless pair. */
  const r = f.onSave({ from: 'Cash', to: 'Cash', amount: '5000', date: '2026-07-06', ref: '' });
  eq('Cash → Cash is REFUSED', r, false);
  eq('  and posts nothing', X.paymentsLedger().length, 0);
  ok(toasts.some(t => /two different accounts/i.test(t[0])), '  the user is told why');

  /* The ptype is derived from the direction — this is what labels the row. */
  reset(); toasts = [];
  f.onSave({ from: 'Cash', to: 'Bank', amount: '50000', date: '2026-07-06', ref: '' });
  eq('cash INTO the bank is a Cash Deposit', X.paymentsLedger()[0].ptype, 'Cash Deposit');
  eq('  two legs posted', X.paymentsLedger().length, 2);
  eq('  and the total is conserved through the real modal', X.accountBalances().total, 0);

  reset();
  f.onSave({ from: 'Bank', to: 'Cash', amount: '20000', date: '2026-07-06', ref: '' });
  eq('bank OUT to cash is a Cash Withdrawal', X.paymentsLedger()[0].ptype, 'Cash Withdrawal');
  eq('  cash in hand rises', X.accountBalances().cash, 20000);
  eq('  bank falls', X.accountBalances().bank, -20000);

  reset();
  f.onSave({ from: 'Bank', to: 'UPI', amount: '10000', date: '2026-07-06', ref: '' });
  eq('bank to UPI — no cash involved — is a Bank Transfer', X.paymentsLedger()[0].ptype, 'Bank Transfer');
  eq('  and still conserves money', X.accountBalances().total, 0);
}

/* ── the Record modal (expense / salary / EMI / partner) ── */
{
  reset();
  const f = openTool('Record');
  ok(f !== null, 'Record opens a form');
  eq('it defaults to an Expense paid in Cash', [f.initial.ptype, f.initial.method], ['Expense', 'Cash']);

  /* An expense must go OUT. If dir flipped, every expense would read as income and
     the P&L would invert. */
  f.onSave({ ptype: 'Expense', party: 'Indian Oil', amount: '4000', method: 'Cash', ref: '', date: '2026-07-06', notes: '', loan: '' });
  eq('an Expense posts money OUT', X.paymentsLedger()[0].dir, 'out');
  eq('  draining cash', X.accountBalances().cash, -4000);
  eq('  tagged as its type', X.paymentsLedger()[0].ptype, 'Expense');
  eq('  to the named party', X.paymentsLedger()[0].party, 'Indian Oil');

  /* Partner Investment is the ONE type in this modal that comes IN. */
  reset();
  f.onSave({ ptype: 'Partner Investment', party: 'Haji', amount: '500000', method: 'Bank', ref: '', date: '2026-07-06', notes: '', loan: '' });
  eq('Partner Investment is the one type that comes IN', X.paymentsLedger()[0].dir, 'in');
  eq('  adding to the bank', X.accountBalances().bank, 500000);

  reset();
  f.onSave({ ptype: 'Partner Withdrawal', party: 'Haji', amount: '100000', method: 'Bank', ref: '', date: '2026-07-06', notes: '', loan: '' });
  eq('Partner Withdrawal goes OUT', X.paymentsLedger()[0].dir, 'out');

  reset();
  f.onSave({ ptype: 'Salary', party: 'Staff', amount: '30000', method: 'Cash', ref: '', date: '2026-07-06', notes: '', loan: '' });
  eq('Salary goes OUT', X.paymentsLedger()[0].dir, 'out');

  /* EMI routes to payLoanEmi (which also ticks the installment), NOT to the
     generic ledger — routing it wrong would leave the loan schedule untouched. */
  reset(); QLD._emi = null;
  f.onSave({ ptype: 'Loan EMI', party: '', amount: '45000', method: 'Bank', ref: '', date: '2026-07-06', notes: '', loan: '0' });
  ok(QLD._emi !== null, 'a Loan EMI routes to payLoanEmi, not the generic ledger');
  eq('  with the picked loan', QLD._emi.i, 0);
  eq('  and the amount', QLD._emi.o.amount, 45000);
  eq('  and posts nothing generic', X.paymentsLedger().length, 0);

  /* Blank party falls back to the type, so a row is never nameless. */
  reset();
  f.onSave({ ptype: 'Expense', party: '', amount: '100', method: 'Cash', ref: '', date: '2026-07-06', notes: '', loan: '' });
  eq('a blank party falls back to the type rather than an empty row', X.paymentsLedger()[0].party, 'Expense');
}

/* ── ✗ BUG B — deleting a payment does not revert what it settled ── */
{
  reset(); S.SALES.push(Object.assign({}, INV));
  X.receiveSalesPayment(0, { amount: 60000, method: 'Bank', date: '2026-07-05' });
  eq('the invoice is paid', S.SALES[0].status, 'paid');

  confirmed = null; QLD._deleted = null;
  CFG.rowActions().find(a => a.tt === 'Delete').onClick(X.paymentsLedger()[0]);
  ok(confirmed !== null, 'Delete asks for confirmation before trashing money');
  ok(/not reverted/i.test(confirmed.desc),
    '  ✗ BUG (disclosed in the modal copy): "The linked invoice/bill status is not reverted"');
  confirmed.onConfirm('entered twice');
  eq('  the ledger row is trashed', QLD._deleted.i, 0);
  /* …and the invoice is still Paid, with no payment behind it. */
  eq('  ✗ BUG: the invoice it settled is STILL marked paid', S.SALES[0].status, 'paid');
  eq('  ✗ BUG: still showing ₹60,000 received that no longer exists', S.SALES[0].paid, 60000);
}

/* ── the table: footer, groupSum, quick filters, export ── */
{
  reset();
  const today = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0');
  X.addLedgerPayment({ dir: 'in', amount: 10000, method: 'Bank', date: today, party: 'Aziz', ptype: 'Sales Payment' });
  X.addLedgerPayment({ dir: 'out', amount: 4000, method: 'Cash', date: today, party: 'Indian Oil', ptype: 'Expense' });
  X.addLedgerPayment({ dir: 'out', amount: 1000, method: 'PhonePe', date: '2020-01-01', party: 'Hamali', ptype: 'Salary' });
  const rows = CFG.data();

  const f = CFG.footer(rows);
  eq('footer Money In', f[0].value, '₹10,000');
  eq('footer Money Out sums both debits', f[1].value, '₹5,000');
  eq('footer Net flow = in − out', f[2].value, '₹5,000');
  eq('footer Total Balance comes from accountBalances', f[3].value, '₹5,000');

  /* groupSum signs the subtotals: credit − debit. Flipping it turns a group of
     expenses into income. */
  const row = p => rows.find(r => r.party === p);
  eq('groupSum: a receipt is positive', CFG.groupSum(row('Aziz')), 10000);
  eq('groupSum: an expense is NEGATIVE', CFG.groupSum(row('Indian Oil')), -4000);

  const qf = k => rows.filter(CFG.quickFilters.find(x => x.key === k).test);
  eq('quick filter All', qf('all').length, 3);
  eq('quick filter Today excludes the 2020 row', qf('today').length, 2);
  eq('quick filter This Month excludes it too', qf('month').length, 2);

  const dirF = CFG.filters.find(x => x.key === 'dir');
  eq('Direction filter — Money In', rows.filter(r => dirF.test(r, 'in')).length, 1);
  eq('Direction filter — Money Out', rows.filter(r => dirF.test(r, 'out')).length, 2);
  /* Unlike the cash book's (§6 of cashbook.test.js), the Payments Account filter
     offers 'upi' — the value data.js actually writes — so it works. */
  const modeF = CFG.filters.find(x => x.key === 'mode');
  eq('the Account filter offers the modes data.js really writes', modeF.options().map(o => o[0]), ['cash', 'bank', 'upi']);
  eq('  so UPI is reachable here (unlike the cash book page)', rows.filter(r => modeF.test(r, 'upi')).length, 1);

  const search = q => rows.filter(r => CFG.search(r, q));
  eq('search matches party', search('aziz').length, 1);
  eq('search matches type', search('expense').length, 1);
  eq('search matches method', search('phonepe').length, 1);
  eq('search misses what it should', search('zzzz').length, 0);

  exported = null;
  CFG.tools.find(t => t.label === 'Export').onClick();
  ok(exported !== null, 'the Export button reaches QLShell.exportCSV');
  eq('  it exports every transaction', exported.rows.length, 3);
  eq('  debit and credit in separate columns', exported.rows.map(r => [r[6], r[7]]), [[4000, ''], ['', 10000], [1000, '']]);
  eq('  and the running balance', exported.rows.map(r => r[8]), [5000, 9000, -1000]);
  ok(/GOTAN/.test(exported.name), '  the filename names the firm, not another company');

  eq('the ledger sorts newest-first by default', CFG.sortDefault, { key: 'date', dir: 'desc' });
  eq('the row id is the raw store index (what Delete passes to deleteLedgerEntry)', CFG.rowId(rows[0]), rows[0].idx);
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
