/* intercompany.test.js — EXTERNAL vs INTER_COMPANY, and the elimination.
 * The rule under test: Gross − Inter-company = External, on BOTH sides,
 * with nothing deleted and no name-only match ever netted.
 * Run: node intercompany.test.js */
const IC = require('./intercompany.js');
let pass = 0, fail = 0; const bad = [];
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : (fail++, bad.push(`${n} → got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)); };
const close = (n, a, b) => { Math.abs(a - b) < 0.01 ? pass++ : (fail++, bad.push(`${n} → got ${a}, want ${b}`)); };

const FIRMS = [
  { id: 'gotan', name: 'Gotan Lime Industries', short: 'Gotan', gstins: ['08BNAPM0488E1Z3'] },
  { id: 'desh', name: 'DESHWALI MINERALS', short: 'Deshwali', gstins: ['08NLIPS9801K1Z5'] }
];

/* Gotan sells 2 lorries to Deshwali and 1 to a real customer.
   Deshwali books one of the two internal bills; the other is missing. */
const BOOKS = [
  { id: 'gotan', name: 'Gotan Lime Industries',
    sales: [
      { inv: 'S1', date: '2026-06-01', party: 'DESHWALI MINERALS', gstin: '08NLIPS9801K1Z5', qty: 20, rate: 5000 },  // internal, paired
      { inv: 'S2', date: '2026-06-02', party: 'DESHWALI MINERALS', gstin: '08NLIPS9801K1Z5', qty: 10, rate: 5000 },  // internal, ORPHAN
      { inv: 'S3', date: '2026-06-03', party: 'ARIF CHEMICAL LIME', gstin: '08AAAAA1111A1Z5', qty: 30, rate: 6000 }, // external
      /* THE TRAP: a real external customer whose NAME resembles the sibling firm.
         Different GSTIN → must stay external, never eliminated. */
      { inv: 'S4', date: '2026-06-04', party: 'DESHWALI LIME INDUSTRIES', gstin: '08ZZZZZ9999Z1ZZ', qty: 15, rate: 4000 }
    ],
    purchases: [{ bill: 'B9', date: '2026-06-10', sup: 'MATESHWARI MINES', gstin: '08ABWFM4111F1Z6', taxable: 200000, qty: 100 }] },
  { id: 'desh', name: 'DESHWALI MINERALS',
    sales: [],
    purchases: [
      { bill: 'S1', date: '2026-06-01', sup: 'Gotan Lime Industries', gstin: '08BNAPM0488E1Z3', taxable: 100000, qty: 20 }, // mirrors S1
      { bill: 'P7', date: '2026-06-05', sup: 'IOC', gstin: '24AAACI1681G1ZV', taxable: 50000, qty: 3 }                       // external
    ] }
];

const rep = IC.report(BOOKS, FIRMS);
const T = rep.totals;

/* ══ CLASSIFICATION ═════════════════════════════════════════════════ */
eq('CLASS · 4 sales + 3 purchases classified', rep.classification.rows.length, 7);
close('CLASS · gross sales = 1,00,000 + 50,000 + 1,80,000 + 60,000', T.gross.salesValue, 390000);
close('CLASS · inter-company sales = S1 + S2', T.inter.salesValue, 150000);
close('CLASS · external sales = gross − inter', T.external.salesValue, 240000);
eq('CLASS · gross count 4', T.gross.salesCount, 4);
eq('CLASS · inter count 2', T.inter.salesCount, 2);
eq('CLASS · external count 2', T.external.salesCount, 2);

/* ══ THE TRAP — a name that looks internal but is a real customer ═══ */
{
  const s4 = rep.classification.rows.find(r => r.ref === 'S4');
  eq('TRAP · "DESHWALI LIME INDUSTRIES" is EXTERNAL', s4.rel, 'external');
  eq('TRAP · its value is NOT eliminated', T.external.salesValue > 0 && s4.value === 60000, true);
  /* it must not even be flagged suspect — a DIFFERENT GSTIN is decisive */
  eq('TRAP · not even suspect, the GSTIN settles it', T.suspect.salesCount, 0);
}

/* ══ PURCHASE SIDE ═════════════════════════════════════════════════ */
close('PURCH · gross = 2,00,000 + 1,00,000 + 50,000', T.gross.purchaseValue, 350000);
close('PURCH · inter-company = the mirrored S1 bill', T.inter.purchaseValue, 100000);
close('PURCH · external = gross − inter', T.external.purchaseValue, 250000);

/* ══ THE FORMULA HOLDS ON BOTH SIDES ═══════════════════════════════ */
close('FORMULA · sales: gross − inter = external', T.gross.salesValue - T.inter.salesValue, T.external.salesValue);
close('FORMULA · purchases: gross − inter = external', T.gross.purchaseValue - T.inter.purchaseValue, T.external.purchaseValue);
close('FORMULA · qty too', T.gross.salesQty - T.inter.salesQty, T.external.salesQty);

/* ══ PAIRING — both sides verified, orphans reported ════════════════ */
eq('PAIR · one matched pair (S1 sale ↔ S1 bill)', rep.pairing.matched, 1);
eq('PAIR · the orphan internal sale is reported', rep.pairing.exceptions.some(e => e.type === 'sale-without-purchase' && e.sale.ref === 'S2'), true);
eq('PAIR · exactly one unmatched leg', rep.pairing.unmatched, 1);
eq('PAIR · so the result is PROVISIONAL', rep.pairing.provisional, true);
eq('PAIR · and the formula says so', /PROVISIONAL/.test(rep.formula.note), true);

/* ══ NOTHING IS DELETED OR RE-VALUED ═══════════════════════════════ */
eq('KEEP · Gotan still shows all 4 of its sales', rep.classification.byFirm.gotan.gross.salesCount, 4);
close('KEEP · at their original gross value', rep.classification.byFirm.gotan.gross.salesValue, 390000);
eq('KEEP · Deshwali still shows both its bills', rep.classification.byFirm.desh.gross.purchaseCount, 2);
eq('KEEP · source rows are untouched', BOOKS[0].sales.length, 4);
eq('KEEP · and still carry their amounts', BOOKS[0].sales[0].rate, 5000);

/* ══ NAME-ONLY MATCH IS SUSPECT, NEVER ELIMINATED ══════════════════ */
{
  const noGstin = [
    { id: 'gotan', name: 'Gotan', sales: [{ inv: 'N1', date: '2026-06-01', party: 'DESHWALI MINERALS', gstin: '', qty: 10, rate: 5000 }], purchases: [] },
    { id: 'desh', name: 'DESHWALI MINERALS', sales: [], purchases: [] }
  ];
  const r = IC.report(noGstin, FIRMS);
  const row = r.classification.rows[0];
  eq('SUSPECT · a name-only hit is flagged', row.rel, 'suspect');
  eq('SUSPECT · not certain', row.certain, false);
  close('SUSPECT · and is NOT eliminated', r.totals.inter.salesValue, 0);
  close('SUSPECT · so external still carries it', r.totals.external.salesValue, 50000);
  eq('SUSPECT · but it is counted for review', r.totals.suspect.salesCount, 1);
}

/* ══ A FIRM NEVER TRADES WITH ITSELF ═══════════════════════════════ */
{
  const self = [{ id: 'gotan', name: 'Gotan', sales: [{ inv: 'X', date: '2026-06-01', party: 'Gotan Lime Industries', gstin: '08BNAPM0488E1Z3', qty: 1, rate: 100 }], purchases: [] }];
  const r = IC.report(self, FIRMS);
  eq('SELF · own-GSTIN on own book is not inter-company', r.classification.rows[0].rel, 'external');
  close('SELF · nothing eliminated', r.totals.inter.salesValue, 0);
}

/* ══ AMOUNT MISMATCH BETWEEN THE TWO SIDES ═════════════════════════ */
{
  const mm = [
    { id: 'gotan', name: 'Gotan', sales: [{ inv: 'M1', date: '2026-06-01', party: 'Deshwali', gstin: '08NLIPS9801K1Z5', qty: 20, rate: 5000 }], purchases: [] },
    { id: 'desh', name: 'Deshwali', sales: [], purchases: [{ bill: 'M1', date: '2026-06-01', sup: 'Gotan', gstin: '08BNAPM0488E1Z3', taxable: 95000, qty: 20 }] }
  ];
  const r = IC.report(mm, FIRMS);
  eq('MISMATCH · paired but partial', r.pairing.pairs[0].status, 'partial');
  close('MISMATCH · delta reported', r.pairing.pairs[0].delta, 5000);
  eq('MISMATCH · raised as an exception', r.pairing.exceptions.some(e => e.type === 'amount-mismatch'), true);
  /* each side is still eliminated at ITS OWN book value — never forced equal */
  close('MISMATCH · sale eliminated at 1,00,000', r.totals.inter.salesValue, 100000);
  close('MISMATCH · bill eliminated at 95,000', r.totals.inter.purchaseValue, 95000);
}

console.log('\n════ intercompany (external vs internal) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' INTERCOMPANY TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
