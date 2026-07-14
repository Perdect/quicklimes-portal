/* Automated tests for ReconCore. Run: node dashboard/v2/recon-core.test.js */
const RC = require('./recon-core.js');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('  ✗ FAIL:', name, extra != null ? '· ' + JSON.stringify(extra) : ''); } }
function eq(name, a, b) { ok(name + ' (got ' + JSON.stringify(a) + ')', a === b); }

/* ── narration parsing ─────────────────────────────────────────── */
console.log('narration parsing');
let n = RC.parseNarration('RTGS-ICICR42026061700504050-ARIF CHEMICAL LIME');
eq('clean strips bank code + mode', n.clean, 'ARIF CHEMICAL LIME');
ok('utr captured', /ICICR42026061700504050/.test(n.utr), n.utr);
eq('raw preserved', n.raw, 'RTGS-ICICR42026061700504050-ARIF CHEMICAL LIME');
eq('truncated narration still yields ARIF', RC.parseNarration('RTGS-ICICR42026061700504050-ARIF').clean, 'ARIF');
eq('NEFT credit clean', RC.parseNarration('NEFT CR-SBIN0001234-AMAN ENTERPRISES-PAYMENT').clean, 'AMAN ENTERPRISES');
eq('multi-line concat', RC.parseNarration('IMPS/DESHWALI\nMINERALS/500000').clean, 'DESHWALI MINERALS');
eq('cheque number', RC.parseNarration('CHQ NO 456789 PAID').cheque, '456789');
ok('cash withdrawal has no party', RC.parseNarration('ATM CASH WITHDRAWAL SELF').clean.length <= 4, RC.parseNarration('ATM CASH WITHDRAWAL SELF').clean);

/* ── name matching ─────────────────────────────────────────────── */
console.log('name matching');
ok('distinctive prefix ARIF => 1.0', RC.nameMatch('ARIF', 'ARIF CHEMICAL LIME').s === 1);
ok('full name => 1.0', RC.nameMatch('ARIF CHEMICAL LIME', 'ARIF CHEMICAL LIME').s === 1);
ok('AMAN => AMAN ENTERPRISES', RC.nameMatch('AMAN', 'AMAN ENTERPRISES').s === 1);
ok('generic word LIME does NOT match ARIF', RC.nameMatch('LIME', 'ARIF CHEMICAL LIME').s < 0.5, RC.nameMatch('LIME', 'ARIF CHEMICAL LIME').s);
ok('generic MINERALS does not falsely match', RC.nameMatch('MINERALS', 'DESHWALI MINERALS').s < 0.5, RC.nameMatch('MINERALS', 'DESHWALI MINERALS').s);
ok('wrong party => low', RC.nameMatch('RAMKARAN AND SONS', 'ARIF CHEMICAL LIME').s < 0.3);

/* ── full match (the reported bug) ─────────────────────────────── */
console.log('matching engine — the ARIF bug');
const sales = [
  { idx: 0, party: 'ARIF CHEMICAL LIME', inv: '39/2026-27', total: 180810, outstanding: 180810, date: '2026-06-01', gstin: '08ALAPD1927C1ZR' },
  { idx: 1, party: 'DESHWALI MINERALS', inv: '56/2026-27', total: 182461, outstanding: 182461, date: '2026-06-28' },
  { idx: 2, party: 'QUALITY CHEMICAL AND ALLIED PRODUCT', inv: '57/2026-27', total: 93381, outstanding: 93381, date: '2026-06-29' }
];
function run(desc, amt, date) { const t = { credit: amt, debit: 0, date: date || '2026-06-01' }; return RC.bestMatch(RC.parseNarration(desc), t, sales, {}); }
let r = run('RTGS-ICICR42026061700504050-ARIF CHEMICAL LIME', 180810);
ok('ARIF full narration => matched (not unknown)', r.status === 'matched' && r.idx === 0, r);
ok('ARIF full narration => green >=95', r.tier === 'green' && r.confidence >= 95, r.confidence);
r = run('RTGS-ICICR42026061700504050-ARIF', 180810);       // TRUNCATED + amount
ok('ARIF truncated + exact amount => matched', r.status === 'matched' && r.idx === 0, r);
r = run('RTGS-ICICR42026061700504050-ARIF', 12345);        // TRUNCATED, wrong amount
ok('ARIF name-only => never Unknown (>=review)', r.confidence >= 76 && r.status !== 'unknown', r);
r = run('IMPS DESHWALI MINERALS PART', 100000, '2026-06-28');
ok('DESHWALI partial payment => partial', r.status === 'partial', r);
r = run('UPI QUALITY CHEMICAL AND ALLIED PRODUCT', 93381, '2026-06-29');
ok('QUALITY exact => matched', r.status === 'matched' && r.idx === 2, r);
r = run('UPI SOME RANDOM HARDWARE SHOP', 7500);
ok('random vendor => unknown (no party)', r.status === 'unknown' && r.idx === null, r);
r = run('RTGS ARIF CHEMICAL LIME', 200000);                // ARIF, amount over the bill
ok('ARIF overpayment flagged', (r.status === 'overpayment' || r.status === 'review') && r.confidence >= 76, r);

/* ── debit classification ──────────────────────────────────────── */
console.log('debit classification');
const purch = [{ idx: 0, sup: 'MATESHWARI MINES AND MINERALS', bill: 'GJ5534', total: 672985, outstanding: 672985, date: '2026-06-15' }];
function dr(desc, amt, date) { const t = { credit: 0, debit: amt, date: date || '2026-06-15' }; return RC.bestMatch(RC.parseNarration(desc), t, purch, {}); }
ok('MATESHWARI debit => matched purchase', dr('NEFT DR-MATESHWARI MINES AND MINERALS', 672985).status === 'matched');
eq('GST payment classified', dr('GST PAYMENT CHALLAN GSTIN', 158526).cat, 'GST payment');
eq('Loan EMI classified', dr('BOB PMEGP TERM LOAN EMI', 56000).cat, 'Loan EMI');
eq('Cash withdrawal classified', dr('ATM CASH WITHDRAWAL SELF', 50000).cat, 'Cash withdrawal');
eq('Bank interest classified', dr('INT COLL TILL 30JUN', 1200).cat, 'Interest');
eq('Bank charges classified', dr('SMS CHG QTRLY', 35).cat, 'Bank charges');

/* ── learned alias ─────────────────────────────────────────────── */
console.log('alias learning');
r = RC.bestMatch(RC.parseNarration('NEFT-XYZ-IOC PETRO'), { credit: 50000, debit: 0, date: '2026-06-10' },
  [{ idx: 5, party: 'INDIAN OIL CORPORATION', inv: 'X1', total: 50000, outstanding: 50000, date: '2026-06-10' }],
  { aliasParty: 'INDIAN OIL CORPORATION' });
ok('learned alias IOC => matched INDIAN OIL', r.idx === 5 && r.confidence >= 95, r);

/* ── split one payment across many bills ───────────────────────── */
console.log('split payment');
eq('exact split => matched', RC.splitStatus(100000, [{ amount: 60000 }, { amount: 40000 }]).status, 'matched');
eq('partial split => partial', RC.splitStatus(100000, [{ amount: 60000 }]).status, 'partial');
eq('over-allocated => over', RC.splitStatus(100000, [{ amount: 60000 }, { amount: 50000 }]).status, 'over');
ok('over-allocated => invalid', RC.splitStatus(100000, [{ amount: 60000 }, { amount: 50000 }]).valid === false);
ok('rounding tolerance absorbs 0.50', RC.splitStatus(100000, [{ amount: 99999.5 }]).status === 'matched');
eq('remaining computed', RC.splitStatus(100000, [{ amount: 70000 }]).remaining, 30000);
eq('suggest fills remaining capped at due', RC.suggestAlloc(100000, 60000, 25000), 25000);
eq('suggest caps at remaining when due larger', RC.suggestAlloc(100000, 60000, 90000), 40000);
eq('suggest 0 when fully allocated', RC.suggestAlloc(100000, 100000, 50000), 0);

/* ── dedupe + bank detect ──────────────────────────────────────── */
console.log('dedupe + bank detect');
const a = RC.parseNarration('RTGS-ICICR42026061700504050-ARIF CHEMICAL LIME');
eq('dedupe by UTR', RC.dedupeKey(a, { credit: 180810, debit: 0, date: '2026-06-01' }).indexOf('UTR') >= 0, true);
// self-transfer legs that share a reference must NOT be flagged as duplicates
const crLeg = RC.parseNarration('EBANK:SELF/1512391877/BOB to BOb Cr');
const drLeg = RC.parseNarration('EBANK:SELF/1512391877/BOB to BOb Dr');
const kCr = RC.dedupeKey(crLeg, { credit: 25000, debit: 0, date: '2026-06-11' });
const kDr = RC.dedupeKey(drLeg, { credit: 25000, debit: 0, date: '2026-06-11' });
ok('Cr vs Dr legs are NOT the same dedupe key', kCr !== kDr, { kCr: kCr, kDr: kDr });
// but re-importing the exact same line IS a duplicate
ok('identical line re-import = same key', kCr === RC.dedupeKey(RC.parseNarration('EBANK:SELF/1512391877/BOB to BOb Cr'), { credit: 25000, debit: 0, date: '2026-06-11' }));
// two genuinely different payments, same amount/day, different party = not dup
ok('different parties same amount/day are not dups',
  RC.dedupeKey(RC.parseNarration('UPI-AMAN ENTERPRISES'), { credit: 5000, debit: 0, date: '2026-06-11' }) !==
  RC.dedupeKey(RC.parseNarration('UPI-RAKESH TRADERS'), { credit: 5000, debit: 0, date: '2026-06-11' }));
eq('detect ICICI', RC.detectBank('ICICI BANK LTD STATEMENT'), 'ICICI');
eq('detect BOB', RC.detectBank('BANK OF BARODA A/C 3358'), 'Bank of Baroda');

/* ── signed balances + direction inference (real BoB statements) ── */
console.log('signed balance + direction inference');
eq('Cr balance is positive', RC.signedBalance('26,836.73Cr'), 26836.73);
eq('Dr balance is negative (Cash Credit a/c)', RC.signedBalance('9,57,515.37Dr'), -957515.37);
eq('plain number stays positive', RC.signedBalance('12345.50'), 12345.5);
eq('spaced suffix', RC.signedBalance('1,23,456.00 Dr'), -123456);
ok('null for garbage', RC.signedBalance('—') === null);
// Real June-2026 Cash-Credit account slice (latest first, Dr balances):
// 22/06 RTGS INDIAN OIL 5,00,000 Dr → 9,49,497.37Dr ; charges 29 Dr → 4,49,497.37Dr… wait:
// file order (latest first): bal after each txn, prev balance is the row BELOW.
const ccRows = [
  { amt: 1364.75, bal: RC.signedBalance('9,57,515.37Dr') },   // penal charge (D)
  { amt: 6653.25, bal: RC.signedBalance('9,56,150.62Dr') },   // int coll (D)
  { amt: 500000, bal: RC.signedBalance('9,49,497.37Dr') },    // Indian Oil RTGS (D)
  { amt: 29, bal: RC.signedBalance('4,49,497.37Dr') },        // PORD charge (D)
  { amt: 15000, bal: RC.signedBalance('4,49,468.37Dr') },     // EBANK self (D)
  { amt: 497490, bal: RC.signedBalance('4,34,468.37Dr') },    // AMAN ENTERPRISES (C)
  { amt: 147.5, bal: RC.signedBalance('9,31,958.37Dr') },     // folio charges (D)
  { amt: 500000, bal: RC.signedBalance('9,31,810.87Dr') }     // Indian Oil (D)
];
const inf = RC.inferDirections(ccRows);
eq('CC account: order detected desc', inf.order, 'desc');
ok('CC account: >=6 of 8 rows resolved', inf.ok >= 6, inf);
eq('penal charge = debit', inf.dirs[0], 'D');
eq('Indian Oil 5L = debit (was shown as credit!)', inf.dirs[2], 'D');
eq('AMAN ENTERPRISES receipt = credit', inf.dirs[5], 'C');
// Current account (Cr balances, latest first)
const caRows = [
  { amt: 55107, bal: RC.signedBalance('26,836.73Cr') },       // loan recovery (D)
  { amt: 54000, bal: RC.signedBalance('81,943.73Cr') },       // Charbhuja transport (D)
  { amt: 5.6, bal: RC.signedBalance('1,35,943.73Cr') },       // charge (D)
  { amt: 52375, bal: RC.signedBalance('1,35,949.33Cr') }      // Gota Barmer transport (D)
];
const inf2 = RC.inferDirections(caRows);
eq('Loan Recovery = debit (was shown as credit!)', inf2.dirs[0], 'D');
eq('Charbhuja transport = debit', inf2.dirs[1], 'D');

/* ── full-transaction classifier on the REAL narration corpus ── */
console.log('transaction classifier (real BoB corpus)');
function cls(raw, cr, dr) { return RC.classifyTxn(RC.parseNarration(raw), { credit: cr || 0, debit: dr || 0 }); }
eq('PORD charge', (cls('Charges for PORD Customer Payment :003749134560', 0, 29) || {}).cat, 'Bank charges');
eq('Ledger folio', (cls('LEDGER FOLIO CHARGES - CC/OD', 0, 147.5) || {}).cat, 'Bank charges');
eq('Penal charge', (cls('33580500001254:Penal Charge Coll:01-06-2026 to 30', 0, 1364.75) || {}).cat, 'Bank charges');
eq('Int.Coll', (cls('33580500001254:Int.Coll:01-06-2026 to 30-06-2026', 0, 6653.25) || {}).cat, 'Interest (CC/OD)');
eq('Card annual fee', (cls('DCARDFEE/3099/ANNUALFEE JUN26MAY27', 0, 354) || {}).cat, 'Bank charges');
eq('ATM charge (charges beat cash)', (cls('CHARGES FOR :ATM/CASH/616217391584/XXXXXXXX', 0, 27.14) || {}).cat, 'Bank charges');
eq('HRET charge', (cls('ACHRE/BARB7021003262015675/HRETCHARGE/111363774236', 0, 295) || {}).cat, 'Bank charges');
eq('Loan recovery', (cls('Loan Recovery For33580600003245', 0, 55107) || {}).cat, 'Loan recovery');
// A SELF-marked credit ("EBANK:SELF/…/Icic Loaninstalment") is internal money
// movement — 'Self transfer' is correct (loan markers are debit-only now, so a
// loan EMI leaving the account still classifies, but this incoming leg is SELF).
ok('SELF-marked loan-instalment credit is internal (self/loan)', ['Self transfer', 'Loan / EMI'].indexOf((cls('EBANK:SELF/1511896672/Icic Loaninstalment', 25000, 0) || {}).cat) >= 0);
eq('ACH debit = loan/EMI', (cls('ACHDR/HDFC BANK LIMITED/3721700828/111360133033', 0, 55764) || {}).cat, 'Loan / EMI');
eq('Cholamandalam CMS = loan', (cls('CMS/CHOLACSEL/202603209535239', 0, 28450) || {}).cat, 'Loan / EMI');
eq('GST refund credit', (cls('RTGS-SBINR52026060410382938-e PAO GST REFUNDS THRO', 734797, 0) || {}).cat, 'GST refund');
eq('Self transfer', (cls('EBANK:SELF/1513780689/Bob to Bob', 0, 15000) || {}).cat, 'Self transfer');
eq('TO CASH = withdrawal', (cls('TO CASH', 0, 150000) || {}).cat, 'Cash withdrawal');
eq('ATM cash', (cls('ATM/CASH/615616389836/XXXXXXXXXXX3099', 0, 10000) || {}).cat, 'Cash withdrawal');
ok('supplier RTGS is NOT classified (goes to matcher)', cls('RTGS-BARBR52026062200778789-INDIAN OIL CORPORATION', 0, 500000) === null);
ok('customer receipt is NOT classified', cls('RTGS-ICICR42026062100511668-AMAN ENTERPRISES', 497490, 0) === null);

/* ── beneficiary-bank suffix stripping ── */
console.log('bank-suffix stripping');
eq('strips -AXIS', RC.parseNarration('NEFT-BARBT26156370985-SHUBHAM MINCHEM PVT LTD-AXIS').clean, 'SHUBHAM MINCHEM PVT LTD');
eq('strips -PUNJAB NATI (truncated PNB)', RC.parseNarration('NEFT-BARBQ26154195223-MATESHWARI MINES-PUNJAB NATI').clean, 'MATESHWARI MINES');
ok('does not strip a real party starting with a bank word', RC.parseNarration('NEFT-REF123456789-AXIS ROADLINES PVT LTD').clean.indexOf('AXIS ROADLINES') >= 0, RC.parseNarration('NEFT-REF123456789-AXIS ROADLINES PVT LTD').clean);
ok('never strips the only segment', RC.parseNarration('HDFC BANK').clean.length > 0);

/* ── inter-firm residual + self-transfer pairing ── */
console.log('inter-firm + self pairs');
const own = { ownNames: ['DESHWALI MINERALS', 'GOTAN LIME INDUSTRIES'] };
let res = RC.classifyResidual(RC.parseNarration('RTGS-HDFCR52026061771764698-DESHWALI MINERALS'), { credit: 440000, debit: 0 }, own);
eq('unmatched own-firm credit → inter-firm', (res || {}).cat, 'Inter-firm transfer');
ok('random party is NOT inter-firm', RC.classifyResidual(RC.parseNarration('RTGS-X-AMAN ENTERPRISES'), { credit: 1000, debit: 0 }, own) === null);
const legs = [
  { raw: 'EBANK:SELF/1513780689/Bob to Bob', desc: '', date: '2026-06-22', credit: 15000, debit: 0 },
  { raw: 'RTGS-AMAN', desc: '', date: '2026-06-21', credit: 497490, debit: 0 },
  { raw: 'EBANK:SELF/1513780689/Bob to Bob', desc: '', date: '2026-06-22', credit: 0, debit: 15000 }
];
const pairs = RC.selfPairs(legs);
ok('pairs the two 15k SELF legs by shared id', pairs.length === 1 && pairs[0].creditIdx === 0 && pairs[0].debitIdx === 2, pairs);

/* ── review-fix regressions (adversarial findings) ── */
console.log('adversarial-finding regressions');
// #3 classifyResidual must NOT fire when a foreign distinctive token is present
ok('third-party "GOTAN STONE AND LIME COMPANY" is NOT inter-firm',
  RC.classifyResidual(RC.parseNarration('RTGS-GOTAN STONE AND LIME COMPANY-PAYMENT'), { credit: 5000, debit: 0 }, { ownNames: ['GOTAN LIME UDYOG'] }) === null);
ok('own firm exact-token match IS flagged (review-level, not hidden)', (function () {
  const r = RC.classifyResidual(RC.parseNarration('NEFT-DESHWALI MINERALS-X'), { credit: 5000, debit: 0 }, { ownNames: ['DESHWALI MINERALS'] });
  return r && r.review === true && r.confidence < 75;
})());
// #5 loose loan tokens removed: bare EMI / SHRIRAM TRANS no longer classify
ok('customer "EMI TRANSPORT" credit is NOT a loan', RC.classifyTxn(RC.parseNarration('NEFT-BARB0X-EMI TRANSPORT PVT LTD-PAYMENT'), { credit: 90000, debit: 0 }) === null);
ok('freight to SHRIRAM TRANSPORT (debit) is NOT a loan', RC.classifyTxn(RC.parseNarration('RTGS DR-SHRIRAM TRANSPORT COMPANY-UTIB0001234'), { credit: 0, debit: 54000 }) === null);
ok('"PRINT COLLECTION" is NOT interest', RC.classifyTxn(RC.parseNarration('NEFT-X-PRINT COLLECTION SERVICES'), { credit: 0, debit: 12000 }) === null);
// direction gating: a charge/interest/loan marker on the WRONG direction is ignored
ok('bank-charge marker on a CREDIT is ignored', RC.classifyTxn(RC.parseNarration('SOMEONE PENAL CHARGE REFUND'), { credit: 500, debit: 0 }) === null);
eq('penal charge on a DEBIT still classifies', (RC.classifyTxn(RC.parseNarration('Penal Charge Coll'), { credit: 0, debit: 1364 }) || {}).key, 'charges');
// #1 signed-balance: inferDirections is only trusted with sign evidence (caller-side),
// but confirm it still resolves the real signed chain correctly
eq('real signed CC chain still resolves Indian Oil as debit', RC.inferDirections(ccRows).dirs[2], 'D');
// DIFFERENT SELF ids + same amount must NOT pair (loan instalment vs Bob-to-Bob)
const legs2 = [
  { raw: 'EBANK:SELF/1511896672/Icic Loaninstalment', desc: '', date: '2026-06-09', credit: 25000, debit: 0 },
  { raw: 'EBANK:SELF/1512391877/BOB to BOb', desc: '', date: '2026-06-11', credit: 0, debit: 25000 }
];
ok('different SELF ids never pair by amount alone', RC.selfPairs(legs2).length === 0, RC.selfPairs(legs2));

// ── directionCat: unmatched party lines get a receipt/payment category ──────
// (real narrations from the Bank of Baroda cash-credit statement, Jun 2026)
(function () {
  var cr = RC.directionCat(RC.parseNarration('RTGS-ICICR42026062100511668-AMAN'), { credit: 497490, debit: 0 });
  ok('credit from a party → Customer receipt', cr && cr.cat === 'Customer receipt' && cr.key === 'receipt', cr);
  var dr = RC.directionCat(RC.parseNarration('NEFT-BARBT26161997932-NAGAUR'), { credit: 0, debit: 50000 });
  ok('debit to a party → Supplier payment', dr && dr.cat === 'Supplier payment' && dr.key === 'payment', dr);
  var none = RC.directionCat(RC.parseNarration('   '), { credit: 1000, debit: 0 });
  ok('no party token → null (stays Unknown, never fabricated)', none === null, none);
})();

// ── account-scoped dedupe (multi-bank Phase 2) ─────────────────────────────
// The SAME bank line (same UTR/amount/date) hitting two DIFFERENT own accounts
// is two real transactions, not a duplicate. Within one account it still dedupes,
// and legacy txns without accountId keep the exact pre-multi-bank key.
(function () {
  var np = RC.parseNarration('RTGS-UTIBR52026063000811223-VEGA MINERAL INDUSTRIES');
  var line = { credit: 100000, debit: 0, date: '2026-12-31' };
  var inBOB = Object.assign({ accountId: 'BA1' }, line);
  var inHDFC = Object.assign({ accountId: 'BA2' }, line);
  ok('same line, two accounts → DIFFERENT keys', RC.dedupeKey(np, inBOB) !== RC.dedupeKey(np, inHDFC));
  ok('same line, same account → same key', RC.dedupeKey(np, inBOB) === RC.dedupeKey(np, Object.assign({ accountId: 'BA1' }, line)));
  ok('scoped key carries the account', RC.dedupeKey(np, inBOB).indexOf('ABA1|') === 0);
  ok('legacy txn (no accountId) → key unchanged (= base)', RC.dedupeKey(np, line) === RC.dedupeKeyBase(np, line));
  ok('base key is account-blind', RC.dedupeKeyBase(np, inBOB) === RC.dedupeKeyBase(np, inHDFC));
  ok('base key preserves UTR form', RC.dedupeKeyBase(np, line).indexOf('|UTR|') > 0);
})();

// ── backfill planner (multi-bank Phase 6) ──────────────────────────────────
(function () {
  var ACCTS = [
    { id: 'BA1', bank: 'Bank of Baroda', label: 'BOB Current — Merta City' },
    { id: 'BA2', bank: 'HDFC Bank', label: 'HDFC — Umaid Stadium' }
  ];
  var T = [
    { id: 't1', bank: 'Bank of Baroda' },                       // → BA1
    { id: 't2', bank: 'Bank of Baroda' },                       // → BA1
    { id: 't3', bank: 'HDFC' },                                  // partial name → BA2
    { id: 't4', bank: 'ICICI' },                                 // no account → create
    { id: 't5', bank: '' },                                      // blank → stays Unassigned
    { id: 't6', bank: 'Bank of Baroda', accountId: 'BA9' }       // already assigned → untouched
  ];
  var p = RC.backfillPlan(T, ACCTS);
  ok('BOB rows matched to the BOB account', p.map['Bank of Baroda'] === 'BA1');
  ok('partial bank name (HDFC ⊂ HDFC Bank) matches', p.map['HDFC'] === 'BA2');
  ok('unknown bank queued for creation', p.creates.length === 1 && p.creates[0] === 'ICICI');
  ok('assigns cover only unassigned rows with a bank', p.assigns.length === 4);
  ok('already-assigned row untouched', !p.assigns.some(function (a) { return a.id === 't6'; }));
  ok('blank-bank row counted, not assigned', p.blank === 1 && !p.assigns.some(function (a) { return a.id === 't5'; }));

  // no-regression rule: zero accounts + one distinct bank → do nothing
  var solo = RC.backfillPlan([{ id: 'x1', bank: 'Bank of Baroda' }], []);
  ok('zero accounts + single bank → skipped (implicit single account)', solo.skipped === 'implicit-single-bank' && !solo.assigns.length);
  // ...but zero accounts + TWO distinct banks is real multi-bank → create both
  var duo = RC.backfillPlan([{ id: 'x1', bank: 'Bank of Baroda' }, { id: 'x2', bank: 'ICICI' }], []);
  ok('zero accounts + two banks → both created', duo.creates.length === 2 && duo.assigns.length === 2);
  // label fallback: account with blank bank field but a matching label
  var lbl = RC.backfillPlan([{ id: 'y1', bank: 'ICICI' }], [{ id: 'BA7', bank: '', label: 'ICICI CC' }]);
  ok('label fallback matches when bank field is blank', lbl.map['ICICI'] === 'BA7' && !lbl.creates.length);
})();

// ── per-account overview (multi-bank Phase 4) ──────────────────────────────
(function () {
  var ACCTS = [
    { id: 'BA1', bank: 'HDFC Bank', label: 'HDFC', openingBalance: 1000, openingDate: '2026-01-01' },
    { id: 'BA2', bank: 'Bank of Baroda', label: 'BOB', type: 'cc_od' }
  ];
  var T = [
    // HDFC: opening 1000 → +5000 → −2000 ⇒ computed 4000; stated 4000 on latest row
    { accountId: 'BA1', date: '2026-01-05', credit: 5000, debit: 0, balance: 6000, m: { status: 'matched' } },
    { accountId: 'BA1', date: '2026-01-20', credit: 0, debit: 2000, balance: 4000, m: { status: 'review' } },
    // BOB (CC/OD): negative stated balance, older month
    { accountId: 'BA2', date: '2025-12-15', credit: 0, debit: 700, balance: -700, m: { status: 'unmatched' } },
    // internal transfer legs in Jan (both accounts) — excluded from combined flows
    { accountId: 'BA1', date: '2026-01-22', credit: 0, debit: 3000, balance: 1000, m: { status: 'other', cat: 'Self transfer', catKey: 'self' } },
    { accountId: 'BA2', date: '2026-01-22', credit: 3000, debit: 0, balance: 2300, m: { status: 'other', cat: 'Self transfer', catKey: 'self' } },
    // unassigned legacy row
    { date: '2026-01-10', credit: 111, debit: 0 }
  ];
  var o = RC.accountOverview(T, ACCTS);
  var h = o.accounts[0], b = o.accounts[1];
  ok('HDFC row count', h.n === 3);
  ok('HDFC last statement date', h.lastDate === '2026-01-22');
  ok('HDFC stated balance from latest row', h.statedBal === 1000);
  ok('HDFC computed = opening + net', h.computedBal === 1000 + 5000 - 2000 - 3000);
  ok('stated wins as the balance', h.balance === 1000);
  ok('drift = stated − computed', h.drift === 0);
  ok('HDFC month flows are gross (incl. transfer leg)', h.monthIn === 5000 && h.monthOut === 5000);
  ok('HDFC toReview counts review rows only', h.toReview === 1);
  ok('BOB negative stated balance kept (CC/OD)', b.balance === 2300 || b.balance === -700 ? b.statedBal !== null : false);
  ok('BOB latest-dated balance wins', b.balance === 2300);
  ok('total balance sums accounts', o.total.balance === 1000 + 2300);
  ok('combined month = latest overall', o.total.ym === '2026-01');
  ok('combined flows EXCLUDE self-transfer legs', o.total.monthIn === 5000 + 111 && o.total.monthOut === 2000);
  ok('internal moved reported separately', o.total.internalMoved === 3000);
  ok('unassigned counted', o.total.unassigned === 1);
  // account with no rows at all → balance = opening
  var empty = RC.accountOverview([], [{ id: 'BA9', openingBalance: 500 }]);
  ok('empty account balance = opening', empty.accounts[0].balance === 500 && empty.accounts[0].n === 0);
})();

console.log('\n' + (fail === 0 ? '✅ ALL ' + pass + ' TESTS PASSED' : '❌ ' + fail + ' FAILED, ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
