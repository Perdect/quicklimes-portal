/* sales-rate.test.js — Rate ₹/T on the Sales register, agreeing with Purchase.
 *
 * The business rule, in the owner's own example: 16.78 T at ₹88,934 taxable is
 * ₹5,300/T. Purchase has carried this column from the start; Sales never did —
 * the same firm's two registers answered "what rate?" differently (one said
 * nothing at all). The cells are extracted from BOTH files and RUN, so the two
 * can never drift: if either formula changes alone, the agreement check fails.
 *
 *   node sales-rate.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ Rate ₹/T · both registers, one formula ═══\n');

const ssrc = fs.readFileSync(path.join(__dirname, 'sales.js'), 'utf8');
const psrc = fs.readFileSync(path.join(__dirname, 'purchase.js'), 'utf8');

/* Pull each register's rate CELL out of its columns config and compile it for
   real — a regex pin alone would pass on a formula that no longer computes. */
function cellOf(src, what) {
  const m = src.match(/\{ key: 'rate',[^\n]*?cell: (r => \([^\n]*?\)) \},/);
  if (!m) throw new Error('rate column not found in ' + what);
  const ctx = { fC: n => '₹' + Number(n).toLocaleString('en-IN'), Math };
  vm.createContext(ctx);
  return vm.runInContext('(' + m[1] + ')', ctx);
}
const sCell = cellOf(ssrc, 'sales.js'), pCell = cellOf(psrc, 'purchase.js');

/* ── the owner's example, verbatim ── */
{
  const r = { qty: 16.78, taxable: 88934 };
  ok(/5,300/.test(sCell(r)), 'SALES: 16.78 T at ₹88,934 → ₹5,300/T (the owner\'s own example)');
  ok(/5,300/.test(pCell(r)), 'PURCHASE: same numbers, same answer');
  eq('  the two registers render the SAME cell for the same row', sCell(r), pCell(r));
}
{
  const r = { qty: 20, taxable: 110000 };
  ok(/5,500/.test(sCell(r)), '20 T at ₹1,10,000 → ₹5,500/T (the brief\'s second example)');
}
/* ── the guards: no tonnage, no rate — never ₹Infinity, never ₹NaN ── */
{
  ok(/qx-dash/.test(sCell({ qty: 0, taxable: 88934 })), 'no quantity → a dash, not ₹Infinity');
  ok(/qx-dash/.test(sCell({ qty: 16.78, taxable: 0 })), 'no taxable → a dash, not ₹0 pretending to be a rate');
  ok(!/NaN|Infinity/.test(sCell({ qty: undefined, taxable: undefined })), 'missing fields cannot render garbage');
}

/* ── placement: his specified order — Qty, then Rate, then Taxable ── */
{
  const qty = ssrc.indexOf("key: 'qty'"), rate = ssrc.indexOf("key: 'rate'"), tax = ssrc.indexOf("key: 'taxable'");
  ok(qty > 0 && qty < rate && rate < tax, 'Sales column order is Qty (T) → Rate ₹/T → Taxable, as specified');
}

/* ── the other surfaces the brief names ── */
{
  ok(/'Qty \(MT\)', 'Rate ₹\/T', 'Taxable'/.test(ssrc), 'CSV export carries Rate between Qty and Taxable');
  ok(/Math\.round\(x\.taxable \/ x\.qty\)/.test(ssrc), '  with the same derivation, not a second formula');
  ok(/@ ' \+ fC\(Math\.round\(r\.taxable \/ r\.qty\)\) \+ '\/T'/.test(ssrc), 'the mobile card reads "16.78 T @ ₹5,300/T"');
  const hi = fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8');
  ok(/'Rate ₹\/T': 'भाव ₹\/टन'/.test(hi), 'and the column translates — भाव ₹/टन (the owner\'s glossary)');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
