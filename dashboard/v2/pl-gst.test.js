/* pl-gst.test.js — the P&L and the GST summary must agree with each other,
 * and neither may count a bill the user threw away.
 *
 * From the audit. Three defects, all in seven lines of data.js:
 *
 *   1. getPL() summed cgst + sgst and DROPPED IGST. Every inter-state sale showed
 *      zero output GST, so net profit was overstated by the whole IGST amount —
 *      while the dashboard card (gstSummary) reported it correctly on the same
 *      data. Two screens, one number, different answers.
 *   2. getPL().cogs re-summed S.PURCHASES raw: cancelled bills included, and NaN
 *      if any row lacked `taxable`. tp.tx was already in scope, already filtered,
 *      already NaN-safe.
 *   3. totS()/totP() filtered only `status !== 'cancelled'`. A TRASHED invoice left
 *      the Sales register but kept adding output tax; a trashed purchase kept
 *      inflating ITC. Void was handled; trash was not.
 *
 *   node pl-gst.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(a === b, m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ P&L · GST · trashed records ═══\n');

/* Grab whole LINES. Grabbing to the first ';' truncates any one-liner whose body
   contains one — totS does — and the failure surfaces as a bare "Unexpected end of
   input" that says nothing about the real cause. */
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

const S = { SALES: [], PURCHASES: [], WORKERS: [], CASHBOOK: [] };
const ctx = { console, Math, Object, Array, Number, isNaN, S, partyGstin: () => '', String, RegExp };
vm.createContext(ctx);
vm.runInContext([
  /* inPeriod is the month/year filter totS/totP/labourPaid all run rows through.
     Undefined ⇒ all time, which is what every assertion below passes, so these
     stay all-time tests — but the function has to BE here or they ReferenceError
     rather than telling you anything. */
  grabBlock('function inPeriod(date, period)', '\n  }'),
  grabBlock('function labourPaid(p)', '\n  }'), grabLine('const LABOUR_RE ='),
  grabLine('const cS = s =>'), grabLine('const cP = p =>'),
  /* cW (wage maths) is multi-line, so grabLine would take only its first line and
     leave an unbalanced brace — which surfaces as "Unexpected end of input" and
     says nothing about the cause. It is not under test here: S.WORKERS stays empty,
     so totL never calls it. A stub that is never invoked is honest; a truncated
     copy of the real one is not. */
  'const cW = () => { throw new Error("cW is stubbed — this test does not cover labour"); };',
  grabLine('const saleInter ='), grabLine('const notCancelled = x =>'),
  /* totS/totP now take a period ('const totS = p =>'), and getPL/gstSummary take
     one too — so these anchors match the signature, not a frozen copy of it.
     Slicing data.js by exact text is this harness's business, not the guard: the
     assertions below are unchanged and still pin IGST, COGS and trashed rows. */
  grabLine('const totS ='), grabLine('const totP ='), grabLine('const totL ='),
  grabBlock('function getPL(period)', '\n  }'),
  grabBlock('function gstSummary(period)', '\n  }'),
  'this.getPL = getPL; this.gstSummary = gstSummary;'
].join('\n'), ctx);
ok(typeof ctx.getPL === 'function', 'the real getPL + gstSummary loaded out of data.js');

const reset = () => { S.SALES.length = 0; S.PURCHASES.length = 0; S.WORKERS.length = 0; };
// 08 = Rajasthan (the firm's own state) → CGST+SGST. 27 = Maharashtra → IGST.
const INTRA = { qty: 100, rate: 1000, gstR: 5, gstin: '08AAA0000A1Z5', status: 'pending' };
const INTER = { qty: 100, rate: 1000, gstR: 5, gstin: '27AAA0000A1Z5', status: 'pending' };

/* ══════════ 1. IGST — the profit-overstating bug ══════════ */
{
  reset(); S.SALES.push(Object.assign({}, INTER));
  const pl = ctx.getPL(), gs = ctx.gstSummary();
  eq('an inter-state sale produces IGST', Math.round(gs.igst), 5000);
  eq('THE BUG: getPL counts IGST as output GST', Math.round(pl.outGST), 5000);
  eq('  so the P&L and the dashboard card AGREE on one number', Math.round(pl.outGST), Math.round(gs.outGST));
  /* The consequence, stated in money: rev 100000 − cogs 0 − labour 0 − GST 5000. */
  eq('  and net profit is not overstated by the IGST', Math.round(pl.np), 95000);

  reset(); S.SALES.push(Object.assign({}, INTRA));
  const pl2 = ctx.getPL(), gs2 = ctx.gstSummary();
  eq('an intra-state sale still works (cgst+sgst)', Math.round(pl2.outGST), 5000);
  eq('  and still agrees', Math.round(pl2.outGST), Math.round(gs2.outGST));

  /* Mixed: the case that made the discrepancy hard to see. */
  reset(); S.SALES.push(Object.assign({}, INTRA), Object.assign({}, INTER));
  eq('a mix of intra and inter counts BOTH', Math.round(ctx.getPL().outGST), 10000);
  eq('  agreeing with gstSummary', Math.round(ctx.getPL().outGST), Math.round(ctx.gstSummary().outGST));
}

/* ══════════ 2. COGS ══════════ */
{
  reset(); S.PURCHASES.push({ taxable: 50000, grate: 5, status: 'cancelled' });
  eq('a CANCELLED bill is not cost of goods', ctx.getPL().cogs, 0);

  reset(); S.PURCHASES.push({ taxable: 50000, grate: 5, status: 'pending' });
  eq('a real bill IS cost of goods', ctx.getPL().cogs, 50000);

  /* A bill with no taxable field poisoned the whole figure with NaN — and NaN
     renders as "NaN" or silently breaks every downstream margin. */
  reset(); S.PURCHASES.push({ taxable: 50000, grate: 5, status: 'pending' }, { grate: 5, status: 'pending' });
  const c = ctx.getPL().cogs;
  ok(!isNaN(c), 'a bill with NO taxable field does not turn COGS into NaN');
  eq('  it contributes nothing rather than poisoning the total', c, 50000);
  ok(!isNaN(ctx.getPL().gpm), '  and Gross Margin % survives it');
}

/* ══════════ 3. TRASHED RECORDS ══════════ */
{
  reset();
  S.SALES.push(Object.assign({}, INTRA));
  const before = Math.round(ctx.gstSummary().outGST);
  S.SALES.push(Object.assign({}, INTRA, { _del: { at: 'x' } }));
  eq('THE BUG: a TRASHED invoice adds no output GST', Math.round(ctx.gstSummary().outGST), before);
  S.SALES.push(Object.assign({}, INTRA, { _arch: true }));
  eq('  an archived invoice adds none either', Math.round(ctx.gstSummary().outGST), before);
  eq('  and it is not revenue', Math.round(ctx.getPL().rev), 100000);

  reset();
  S.PURCHASES.push({ taxable: 100000, grate: 18, itc: 'Eligible', status: 'pending' });
  const itc0 = Math.round(ctx.gstSummary().itc);
  eq('a real purchase gives ITC', itc0, 18000);
  S.PURCHASES.push({ taxable: 100000, grate: 18, itc: 'Eligible', status: 'pending', _del: { at: 'x' } });
  eq('  a TRASHED purchase does NOT inflate ITC', Math.round(ctx.gstSummary().itc), itc0);
  eq('  nor COGS', ctx.getPL().cogs, 100000);

  /* Both stores had to gain the filter together: fixing sales alone would drop the
     payable while leaving stale ITC — a WRONG net, from a half-fix. */
  reset();
  S.SALES.push(Object.assign({}, INTRA, { _del: { at: 'x' } }));
  S.PURCHASES.push({ taxable: 100000, grate: 18, itc: 'Eligible', status: 'pending', _del: { at: 'x' } });
  eq('trashing both sides leaves no output tax', Math.round(ctx.gstSummary().outGST), 0);
  eq('  and no ITC', Math.round(ctx.gstSummary().itc), 0);
  eq('  so net GST is zero, not a phantom refund', Math.round(ctx.gstSummary().net), 0);
}

/* ══════════ 4. THE CLAMP IS CORRECT — do not "fix" it ══════════
   Verification refuted the claim that Math.max(0, …) hides money: a GST liability
   floors at zero and excess ITC carries forward. gst.html shows the full ladder. */
{
  reset();
  S.SALES.push(Object.assign({}, INTRA));                                        // 5,000 out
  S.PURCHASES.push({ taxable: 1000000, grate: 18, itc: 'Eligible', status: 'pending' });  // 180,000 ITC
  eq('ITC far exceeding output GST floors the PAYABLE at zero (correct)', Math.round(ctx.gstSummary().net), 0);
  /* getPL has its OWN clamp, and it must hold too. Without it netGST goes NEGATIVE
     and `np = ebitda - netGST` SUBTRACTS a negative — inflating profit by the whole
     excess ITC (₹1.75L here). Mutation testing found this: I had broken getPL's
     clamp and only gstSummary's was asserted, so the mutation survived. Two
     functions clamp; both need pinning. */
  eq('  getPL clamps its net GST at zero as well', Math.round(ctx.getPL().netGST), 0);
  ok(ctx.getPL().netGST >= 0, '  it is never negative');
  /* rev 100,000 − cogs 1,000,000 − labour 0 − netGST 0 = −900,000. A negative
     netGST would ADD 175,000 to that and report a smaller loss than is real. */
  eq('  so profit is not inflated by excess ITC', Math.round(ctx.getPL().np), -900000);
  ok(Math.round(ctx.gstSummary().itc) === 180000, '  while the ITC itself is still reported in full, not lost');
  ok(Math.round(ctx.gstSummary().outGST) === 5000, '  and the output tax is still reported');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
