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

/* ── THE REAL FINDING ────────────────────────────────────────────────────── */
{
  const r = I.scan({ sales: PHANTOM.concat([REAL_SALE]), purchases: PURCHASES, parties: PARTIES });
  const dup = r.findings.find(f => f.type === 'duplicate');
  ok('IOC · the eight copies are found as ONE duplicate finding, not eight',
     dup && dup.count === 8 && dup.idxs.length === 8);
  ok('IOC · it names the overstatement: seven extra copies, 33,22,389',
     dup.overstatedBy === 474627 * 7);
  ok('IOC · the explanation says how many times and that they are identical',
     /recorded 8 times/.test(dup.why) && /every copy identical/.test(dup.why));

  const wd = r.findings.find(f => f.type === 'wrong-direction');
  ok('IOC · booking a sale to a SUPPLIER is also caught', !!wd);
  ok('IOC · and it is CERTAIN, because the same number is their purchase bill',
     wd.severity === 'certain' && /cannot be our invoice number/.test(wd.why));
  ok('IOC · the twin purchase bill is quoted as the evidence',
     /2026-01-15/.test(wd.why) && /474627/.test(wd.why));

  ok('IOC · a genuine customer invoice is left alone',
     !r.findings.some(f => /51\/2026-27/.test(f.doc)));
  ok('IOC · certain findings are counted and ranked above warnings',
     r.certain >= 2 && r.warnings === 0 && r.findings[0].severity === 'certain');
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
  const r = I.scan({ sales: PHANTOM, purchases: PURCHASES, parties: PARTIES });
  const dup = r.findings.find(f => f.type === 'duplicate');
  const plan = I.fixPlan(dup);
  ok('FIX · a duplicate keeps the FIRST copy — the transaction is real',
     plan.keep.length === 1 && plan.keep[0] === 144 && plan.remove.length === 7);
  ok('FIX · it never proposes removing every copy', plan.remove.indexOf(plan.keep[0]) === -1);
  ok('FIX · and explains what it keeps and why', /Keeps the first copy/.test(plan.why));

  const wd = r.findings.find(f => f.type === 'wrong-direction');
  const wplan = I.fixPlan(wd);
  ok('FIX · a wrong-direction row is removed entirely — it was never ours',
     wplan.remove.length === 1 && wplan.keep.length === 0 && /never a sale/.test(wplan.why));

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
