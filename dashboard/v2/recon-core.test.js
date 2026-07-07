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
eq('detect ICICI', RC.detectBank('ICICI BANK LTD STATEMENT'), 'ICICI');
eq('detect BOB', RC.detectBank('BANK OF BARODA A/C 3358'), 'Bank of Baroda');

console.log('\n' + (fail === 0 ? '✅ ALL ' + pass + ' TESTS PASSED' : '❌ ' + fail + ' FAILED, ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
