/* selfcheck.test.js — the self-check must actually catch a broken book.
 *
 * He asked: "If you cannot test from here, who will test??" This file exists
 * because the answer must not be "you".
 *
 * selfcheck.js runs in HIS browser against HIS data — the thing I cannot see. That
 * makes it the only thing standing between a wrong number and his GST return, and
 * it makes THIS file important: a self-check that returns green on broken books is
 * worse than no self-check, because it converts "I should verify this" into "the
 * app says it's fine".
 *
 * So every check below is fed DELIBERATELY BROKEN data and must go red. Passing on
 * good data proves nothing on its own — an `ok: true` constant would do that.
 *
 *   node selfcheck.test.js
 */
'use strict';
const SC = require('./selfcheck.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ self-check · does it catch a broken book? ═══\n');

/* A minimal but HONEST QLD: the numbers agree, as they would on healthy books. */
function goodQ(over) {
  const base = {
    gstSummary: () => ({ outGST: 5000, itc: 1800, net: 3200 }),
    getPL:      () => ({ outGST: 5000, itc: 1800, rev: 100000, cogs: 10000 }),
    salesRows:  () => [{ idx: 0, taxable: 100000, outstanding: 40000, status: 'pending' }],
    purchaseRows: () => [{ taxable: 10000, gst: 1800, total: 11800, status: 'pending', bill: 'B/1', sup: 'X' }],
    partyRows:  () => [{ idx: 0, name: 'Aziz' }],
    partyLedger: () => ({ pending: 40000 }),
    accountBalances:  () => ({ cash: 100, bank: 200, upi: 50 }),
    cashbookBalances: () => ({ cash: 100, bank: 200, upi: 50, phonepay: 0 }),
    state: { SALES: [{ taxable: 100000 }] }
  };
  return Object.assign({}, base, over || {});
}
const runWith = q => { global.QLD = q; return SC.run(); };
const find = (r, id) => r.checks.find(c => c.id === id);

/* ══════════ 1. HEALTHY BOOKS ══════════ */
{
  const r = runWith(goodQ());
  ok(r.failed === 0, 'healthy books produce NO failures (got ' + r.failed + ')');
  ok(r.ran >= 6, '  and it actually ran checks (' + r.ran + ') — not silently skipping everything');
  ok(r.error === undefined, '  with no error');
}

/* ══════════ 2. EACH CHECK CATCHES ITS OWN BUG ══════════
   These are the REAL bugs found in this codebase today, replayed as data. */
{
  /* getPL dropped IGST — the P&L showed no output tax on inter-state sales while
     the dashboard's card showed it. Profit overstated by the whole IGST. */
  let r = runWith(goodQ({ getPL: () => ({ outGST: 0, itc: 1800, rev: 100000, cogs: 10000 }) }));
  ok(!find(r, 'gst-output').ok, 'CATCHES: the P&L and the GST page disagree on output tax (the real IGST bug)');
  ok(String(find(r, 'gst-output').a) !== String(find(r, 'gst-output').b), '  and reports BOTH figures so the gap is visible');

  /* A negative GST payable would mean the clamp broke. */
  r = runWith(goodQ({ gstSummary: () => ({ outGST: 5000, itc: 90000, net: -85000 }) }));
  ok(!find(r, 'gst-net').ok, 'CATCHES: a negative GST payable');

  /* ITC counted on one screen and not the other. */
  r = runWith(goodQ({ getPL: () => ({ outGST: 5000, itc: 0, rev: 100000, cogs: 10000 }) }));
  ok(!find(r, 'gst-itc').ok, 'CATCHES: ITC disagrees between the GST page and the P&L');

  /* Revenue on the P&L not matching the register — a cancelled invoice counted. */
  r = runWith(goodQ({ getPL: () => ({ outGST: 5000, itc: 1800, rev: 150000, cogs: 10000 }) }));
  ok(!find(r, 'revenue').ok, 'CATCHES: revenue on the P&L does not match the Sales register');

  /* COGS counting a cancelled bill — the real getPL().cogs bug. */
  r = runWith(goodQ({ getPL: () => ({ outGST: 5000, itc: 1800, rev: 100000, cogs: 60000 }) }));
  ok(!find(r, 'cogs').ok, 'CATCHES: cost of goods does not match the Purchase register (the cancelled-bill bug)');

  /* NaN COGS — one bill with no taxable poisons every margin below it. */
  r = runWith(goodQ({ getPL: () => ({ outGST: 5000, itc: 1800, rev: 100000, cogs: NaN }) }));
  ok(!find(r, 'cogs-nan').ok, 'CATCHES: cost of goods is NaN');

  /* Receivables: the register says 40,000, the ledger says 25,000. This is the
     number he chases customers for. */
  r = runWith(goodQ({ partyLedger: () => ({ pending: 25000 }) }));
  ok(!find(r, 'receivable').ok, 'CATCHES: receivables disagree between the register and the party ledger');

  /* The known UPI bug: one balance function drops mode 'upi' entirely. */
  r = runWith(goodQ({ cashbookBalances: () => ({ cash: 100, bank: 200, phonepay: 0 }) }));
  ok(!find(r, 'cash-total').ok, 'CATCHES: one balance function drops UPI (the real cashbookBalances bug)');

  /* A bill that does not add up — arithmetic, not opinion. */
  r = runWith(goodQ({ purchaseRows: () => [{ taxable: 10000, gst: 1800, total: 99999, status: 'pending', bill: 'B/9', sup: 'Mateshwari' }] }));
  ok(!find(r, 'bill-math').ok, 'CATCHES: a purchase bill whose taxable + GST does not equal its total');
  ok(/B\/9/.test(find(r, 'bill-math').note), '  and NAMES the offending bill, so the next step is obvious');
}

/* ══════════ 3. IT MUST NOT CRY WOLF ══════════
   A check that fires on correct accounting trains him to ignore it — which is the
   same outcome as having no check, but with more noise. */
{
  /* RCM: the total legitimately EXCLUDES GST. Not a broken bill. */
  let r = runWith(goodQ({ purchaseRows: () => [{ taxable: 10000, gst: 1800, total: 10000, itc: 'RCM', status: 'pending' }] }));
  ok(find(r, 'bill-math').ok, 'does NOT flag an RCM bill — its total excludes GST by design');

  /* A cancelled bill is excluded from the arithmetic check. */
  r = runWith(goodQ({ purchaseRows: () => [{ taxable: 10000, gst: 1800, total: 0, status: 'cancelled' }] }));
  ok(find(r, 'bill-math').ok, 'does NOT flag a cancelled bill');

  /* Float dust must not be a finding. */
  r = runWith(goodQ({ getPL: () => ({ outGST: 5000.4, itc: 1800, rev: 100000, cogs: 10000 }) }));
  ok(find(r, 'gst-output').ok, 'does NOT flag a sub-rupee rounding difference');

  /* But two rupees IS a gap. */
  r = runWith(goodQ({ getPL: () => ({ outGST: 5002, itc: 1800, rev: 100000, cogs: 10000 }) }));
  ok(!find(r, 'gst-output').ok, '  yet ₹2 IS reported — the tolerance is dust, not a budget');
}

/* ══════════ 4. SKIPPED IS NOT PASSED ══════════
   The whole point. A check that could not run must say so — a green tick for a
   check that never executed is the exact lie this file exists to prevent. */
{
  const r = runWith({ state: { SALES: [] } });   // almost nothing available
  ok(r.skipped > 0, 'a check that cannot run is reported as SKIPPED');
  ok(r.passed === 0, '  and is NOT counted as passed');
  r.checks.filter(c => c.skipped).forEach(c => ok(c.ok !== true, '  a skipped check never claims ok:true (' + c.id + ')'));

  /* Nothing in the Trash means the trashed check has nothing to prove. */
  const r2 = runWith(goodQ({ state: { SALES: [{ taxable: 1 }] } }));
  const t = find(r2, 'trashed');
  ok(t && t.skipped, 'with an empty Trash, the trashed-records check skips rather than passing vacuously');
}

/* ══════════ 5. IT NEVER WRITES ══════════
   A self-check that repairs is a self-check nobody can trust, and a wrong repair on
   real books is unrecoverable. Static, because the danger is a future edit. */
{
  const src = require('fs').readFileSync(require('path').join(__dirname, 'selfcheck.js'), 'utf8');
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const code = strip(src);
  /* Name the actual mutations. My first version matched `= Q.` — which is a READ
     (`var gs = Q.gstSummary()`) — and failed on correct code. A guard that fires on
     the thing it is meant to permit is worse than no guard: it gets deleted. */
  ok(!/\bcommit\(/.test(code), 'selfcheck NEVER calls commit()');
  ok(!/Q\.(add|update|delete|remove|save|set|import|pay|receive|record)[A-Z]/.test(code),
    'selfcheck calls no QLD mutation (add/update/delete/save/set/pay/record…)');
  ok(!/(localStorage|sessionStorage)\.(setItem|removeItem|clear)/.test(code),
    'selfcheck stores nothing — it does not even remember its own result');
  ok(!/\bS\.[A-Z_]+\s*(=|\.push\(|\.splice\()/.test(code),
    'selfcheck never writes to a store directly');
  /* Its only .push is onto its OWN result array. */
  /* [\w.]* captures the RECEIVER. Without it the match is '.push(o)' with no idea
     what it was pushed onto, and the assertion below can never be true — my first
     version failed against correct code for that reason. */
  const pushes = code.match(/[\w.]*\.push\([^)]*\)/g) || [];
  ok(pushes.every(x => /out\.push\(/.test(x)), 'the only push is onto its own findings list, not onto data (' + pushes.length + ' found)');
}

/* ══════════ 6. IT SURVIVES A BROKEN APP ══════════ */
{
  let r = runWith(null);
  ok(r.error, 'with no QLD it reports an error rather than throwing');
  ok(r.passed === 0, '  and claims nothing passed');

  r = runWith({ gstSummary: () => { throw new Error('boom'); }, state: { SALES: [] } });
  ok(r.error || r.failed >= 0, 'a throwing QLD function does not crash the checker');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
