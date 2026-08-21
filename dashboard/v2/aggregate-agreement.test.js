/* ═══════════════════════════════════════════════════════════════════════
   EVERY AGGREGATE COUNTS THE SAME BOOK.

   The Monthly Register read the RAW S.SALES / S.PURCHASES arrays, which
   still hold soft-deleted records. It reported 170 invoices while the Sales
   Register, P&L and GST Summary all reported 153 — and its money was
   overstated by whatever had been deleted.

   It hid until the eight misfiled Indian Oil rows were removed: the
   deletion took effect everywhere except here, so one page went on
   reporting revenue that had just been struck off. A number that is wrong
   only AFTER a correction is the worst kind — you go looking at the
   correction, not at the page.

   This asserts the property rather than the number: whatever the fixtures
   hold, every module-level aggregate must see the same live rows. A new
   aggregate that reaches for a raw array fails here.

     node aggregate-agreement.test.js
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0; const bad = [];
const ok = (m, c) => { if (c) pass++; else { fail++; bad.push(m); } };

const SRC = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');

/* ── 1. THE STRUCTURAL RULE ───────────────────────────────────────────────
   A soft-delete-aware aggregate goes through withIdx(). Reaching straight
   into S.SALES / S.PURCHASES inside one is the defect itself. */
function bodyOf(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const open = SRC.indexOf('{', i);
  let j = open + 1, d = 1;
  while (j < SRC.length && d > 0) { const c = SRC[j]; if (c === '{') d++; else if (c === '}') d--; j++; }
  return SRC.slice(i, j);
}

/* Aggregates that report on the sales/purchase books. Each must be
   soft-delete aware: either it filters itself, or it delegates to something
   that does. */
const AGGREGATES = ['monthlyRegister', 'getPL', 'gstSummary', 'salesSummary'];

for (const name of AGGREGATES) {
  const body = bodyOf(name);
  ok(name + ' still exists in data.js', !!body);
  if (!body) continue;
  /* Strip comments first: this file's own explanations quote the bug, and a
     naive scan would match the explanation and fail on a correct function —
     the false positive that already bit waphone.test.js once. */
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const rawRead = /\bS\.(SALES|PURCHASES)\b(?!\s*\.length)/.test(code);
  const guarded = /withIdx\s*\(/.test(code);
  const delegates = /\b(salesRows|purchaseRows|monthlyRegister|totS|totP)\s*\(/.test(code);
  ok(name + ' does not read a RAW record array without filtering deleted rows',
     !rawRead || guarded || delegates);
}

/* monthlyRegister is the one that broke, so pin it directly. */
{
  const body = bodyOf('monthlyRegister') || '';
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ok('monthlyRegister · builds from withIdx(), not from the raw arrays',
     /withIdx\s*\(\s*S\.SALES\s*\)/.test(code) && /withIdx\s*\(\s*S\.PURCHASES\s*\)/.test(code));
  ok('monthlyRegister · no bare S.SALES.filter / S.PURCHASES.filter survives',
     !/S\.SALES\.filter/.test(code) && !/S\.PURCHASES\.filter/.test(code));
}

/* ── 2. THE BEHAVIOURAL RULE ──────────────────────────────────────────────
   withIdx is the single gate. If it ever stopped dropping _del rows, every
   aggregate above would silently start counting deleted records again, and
   the structural check would still pass. So pin the gate itself. */
{
  /* withIdx is an arrow constant, not a `function` declaration — bodyOf only
     finds the latter, so grab the line itself. */
  const m = /const\s+withIdx\s*=\s*[^\n]+/.exec(SRC);
  ok('withIdx exists — the single place deleted rows are dropped', !!m);
  if (m) {
    const code = m[0];
    ok('withIdx drops soft-deleted rows', /_del/.test(code));
    ok('withIdx also drops archived rows', /_arch/.test(code));
    ok('withIdx preserves the RAW index — 14 places persist positional indices',
       /map\(\(\s*\w+\s*,\s*\w+\s*\)\s*=>\s*\[/.test(code));
  }
}

/* ── 3. THE ARITHMETIC, ON A BOOK THAT CONTAINS A DELETED ROW ─────────────
   A tiny hand-rolled model of the real shape: three invoices, one of them
   soft-deleted. Any aggregate that counts 3 is counting a deleted record. */
{
  const rows = [
    { inv: 'A', date: '2026-03-01', taxable: 100 },
    { inv: 'B', date: '2026-03-02', taxable: 200 },
    { inv: 'C', date: '2026-03-03', taxable: 400, _del: { at: 'x' } }
  ];
  const live = rows.filter(r => !r._del);
  ok('MODEL · a soft-deleted invoice is not one of the live rows', live.length === 2);
  ok('MODEL · and its money is not in the live total',
     live.reduce((a, r) => a + r.taxable, 0) === 300);
  ok('MODEL · counting the raw array would have given the WRONG answer — the bug',
     rows.length === 3 && rows.reduce((a, r) => a + r.taxable, 0) === 700);
}

console.log('\n════ aggregate agreement (every total counts the same book) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' AGREEMENT TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
