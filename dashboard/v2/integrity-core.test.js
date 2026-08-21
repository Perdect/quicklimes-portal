/* Tests for the data-integrity engine.
   The anchor is the real finding: Indian Oil's purchase bill 20263121B024217
   sitting in SALES eight times — ₹37,97,015 of revenue that never happened. */
const I = require('./integrity-core.js');
let pass = 0, fail = 0; const bad = [];
const ok = (m, c) => { if (c) pass++; else { fail++; bad.push(m); } };

const IOC = { name: 'Indian Oil Corporation Limited', gstin: '24AAACI1681G1ZV', type: 'supplier' };
const ARIF = { name: 'ARIF CHEMICAL LIME', gstin: '08ALAPD1927C1ZR', type: 'customer' };
const PARTIES = [IOC, ARIF];

/* The eight identical rows, exactly as they sit in the live book. */
const PHANTOM = Array.from({ length: 8 }, (_, k) => ({
  idx: 144 + k, inv: '20263121B024217', date: '2026-01-15',
  party: IOC.name, gstin: IOC.gstin, total: 474627
}));
const REAL_SALE = { idx: 10, inv: '51/2026-27', date: '2026-06-21', party: ARIF.name, gstin: ARIF.gstin, total: 248745 };
const PURCHASES = [{ idx: 3, bill: '20263121B024217', date: '2026-01-15', sup: IOC.name, gstin: IOC.gstin, total: 474627 }];

/* ── THE REAL FINDING ────────────────────────────────────────────────────
   All eight rows are the supplier's own bill on the wrong side of the book.
   The whole 8 × 4,74,627 is phantom revenue — and it must be counted ONCE.
   The first version of this engine reported 71,19,405: it billed the eight
   rows as a duplicate (seven extra copies) AND as eight wrong-direction
   rows. Live data caught it. */
{
  const r = I.scan({ sales: PHANTOM.concat([REAL_SALE]), purchases: PURCHASES, parties: PARTIES });

  ok('IOC · eight misfiled rows are ONE finding, not eight',
     r.findings.length === 1 && r.findings[0].count === 8 && r.findings[0].idxs.length === 8);

  const wd = r.findings[0];
  ok('IOC · it is a wrong-direction finding, and CERTAIN',
     wd.type === 'wrong-direction' && wd.severity === 'certain');
  ok('IOC · the overstatement is the whole 8 × 4,74,627 — every row is phantom',
     wd.overstatedBy === 474627 * 8 && r.overstated === 474627 * 8);
  ok('IOC · NOT double counted as a duplicate as well',
     !r.findings.some(f => f.type === 'duplicate') && r.overstated !== 474627 * 15);
  ok('IOC · the explanation gives the count and the evidence',
     /8 rows book this as a SALE/.test(wd.why) && /2026-01-15/.test(wd.why) &&
     /cannot be our invoice number/.test(wd.why));
  ok('IOC · a genuine customer invoice is left alone',
     !r.findings.some(f => /51\/2026-27/.test(f.doc)));
  ok('IOC · removing the finding removes all eight rows and keeps none',
     I.fixPlan(wd).remove.length === 8 && I.fixPlan(wd).keep.length === 0);
}

/* A plain duplicate — same party, right direction — is still caught, and is
   still the thing the duplicate check exists for. */
{
  const twice = [
    { idx: 1, inv: '90/2026-27', date: '2026-07-01', party: ARIF.name, gstin: ARIF.gstin, total: 100000 },
    { idx: 2, inv: '90/2026-27', date: '2026-07-01', party: ARIF.name, gstin: ARIF.gstin, total: 100000 }
  ];
  const r = I.scan({ sales: twice, purchases: PURCHASES, parties: PARTIES });
  const dup = r.findings.find(f => f.type === 'duplicate');
  ok('DUP · a customer invoice entered twice is caught', dup && dup.count === 2);
  ok('DUP · and overstates by exactly one copy', dup.overstatedBy === 100000 && r.overstated === 100000);
  ok('DUP · the fix keeps one and removes one',
     I.fixPlan(dup).keep.length === 1 && I.fixPlan(dup).remove.length === 1);
}

/* ── SEVERITY IS EARNED, NOT ASSUMED ─────────────────────────────────────── */
{
  /* You can genuinely sell to a firm you also buy from. Without a matching
     bill number that is a question, not an accusation. */
  const legit = { idx: 20, inv: '77/2026-27', date: '2026-07-01', party: IOC.name, gstin: IOC.gstin, total: 50000 };
  const r = I.scan({ sales: [legit], purchases: PURCHASES, parties: PARTIES });
  const wd = r.findings.find(f => f.type === 'wrong-direction');
  ok('SEVERITY · a sale to a supplier with NO matching bill is a warning, not a verdict',
     wd.severity === 'warning' && /check it rather than assume/.test(wd.why));
  ok('SEVERITY · a warning contributes NOTHING to the overstated total — a suspicion is not a number',
     r.overstated === 0 && wd.overstatedBy === 0);
}

/* ── IDENTITY, NOT RESEMBLANCE ───────────────────────────────────────────── */
{
  const two = [
    { idx: 1, inv: '5', date: '2026-01-01', party: 'AMAN ENTERPRISES', gstin: '08AAKPI9578B1ZE', total: 1000 },
    { idx: 2, inv: '5', date: '2026-01-01', party: 'AMAN LIME PRODUCTS', gstin: '08AMCPM0730H3ZB', total: 1000 }
  ];
  ok('IDENTITY · the same number for two DIFFERENT parties is not a duplicate',
     I.duplicates(two, { doc: 'inv', party: 'party' }).length === 0);

  const spaced = [
    { idx: 1, inv: '51/2026-27', party: 'Aman  Enterprises', gstin: '08AAKPI9578B1ZE', total: 1000 },
    { idx: 2, inv: '51 / 2026-27', party: 'AMAN ENTERPRISES', gstin: '08aakpi9578b1ze', total: 1000 }
  ];
  ok('IDENTITY · spacing, case and punctuation do not hide a duplicate',
     I.duplicates(spaced, { doc: 'inv', party: 'party' }).length === 1);

  const noGst = [
    { idx: 1, inv: '9', party: 'LOCAL TRADER', gstin: '', total: 500 },
    { idx: 2, inv: '9', party: 'local trader', gstin: '', total: 500 }
  ];
  ok('IDENTITY · with no GSTIN it falls back to the exact name', I.duplicates(noGst, {}).length === 1);
}

/* ── WHAT A DUPLICATE IS, AND IS NOT ─────────────────────────────────────── */
{
  const retyped = [
    { idx: 1, inv: '7', party: 'X', gstin: '', total: 1000 },
    { idx: 2, inv: '7', party: 'X', gstin: '', total: 1200 }
  ];
  const d = I.duplicates(retyped, {});
  ok('DUPLICATE · a re-typed bill with a CORRECTED total is still one bill entered twice',
     d.length === 1 && /amounts differ/.test(d[0].why));

  const blank = [{ idx: 1, inv: '', party: 'X', total: 1 }, { idx: 2, inv: '', party: 'X', total: 1 }];
  ok('DUPLICATE · rows with no document number are never matched to each other',
     I.duplicates(blank, {}).length === 0);

  ok('DUPLICATE · purchases are checked with the same rule',
     I.duplicates([PURCHASES[0], { ...PURCHASES[0], idx: 4 }], { doc: 'bill', party: 'sup' }).length === 1);
}

/* ── THE FIX PLAN NEVER ERASES A REAL TRANSACTION ────────────────────────── */
{
  const dup = I.duplicates(PHANTOM, { doc: 'inv', party: 'party' })[0];
  const plan = I.fixPlan(dup);
  ok('FIX · a duplicate keeps the FIRST copy — the transaction is real',
     plan.keep.length === 1 && plan.keep[0] === 144 && plan.remove.length === 7);
  ok('FIX · it never proposes removing every copy', plan.remove.indexOf(plan.keep[0]) === -1);
  ok('FIX · and explains what it keeps and why', /Keeps the first copy/.test(plan.why));

  const wd = I.wrongDirection(PHANTOM, PURCHASES, PARTIES)[0];
  const wplan = I.fixPlan(wd);
  ok('FIX · wrong-direction rows are removed entirely — they were never ours',
     wplan.remove.length === 8 && wplan.keep.length === 0 && /never a sale/.test(wplan.why));

  ok('FIX · asked about nothing, it proposes nothing', I.fixPlan(null).remove.length === 0);
}

/* ── A CLEAN BOOK REPORTS CLEAN ──────────────────────────────────────────── */
{
  const r = I.scan({ sales: [REAL_SALE], purchases: PURCHASES, parties: PARTIES });
  ok('CLEAN · a healthy book produces no findings and no overstatement',
     r.findings.length === 0 && r.certain === 0 && r.overstated === 0);
  const empty = I.scan({});
  ok('CLEAN · an empty book does not throw and reports nothing',
     empty.findings.length === 0 && empty.overstated === 0);
}

console.log('\n════ integrity-core (what the books cannot see about themselves) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' INTEGRITY TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
