/* qty-inline.test.js — Qty & Rate are READ-ONLY; only Freight is inline-editable.
 *
 * Owner's instruction (2026-07-19): "QTY or Rate will not editable, only Freight
 * will editable, make sure for all." Qty comes from the bill and Rate is derived
 * (taxable ÷ qty); neither may be hand-edited on the row, so an accidental tap
 * can't change what the bill says. Rates are still filled by the upload reader,
 * the auto-backfill, and the deliberate bulk "Set rate ₹/T" action — never by a
 * single cell. This runs the REAL column cells out of purchase.js.
 *
 *   node qty-inline.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ Qty & Rate read-only · Freight editable ═══\n');

const src = fs.readFileSync(path.join(__dirname, 'purchase.js'), 'utf8');
function cellOf(key) {
  const start = src.indexOf("{ key: '" + key + "',");
  const body = src.indexOf('cell: r =>', start) + 'cell: r =>'.length;
  // next column starts at the following "{ key: '"
  const nxt = src.indexOf("{ key: '", body);
  const expr = src.slice(body, src.lastIndexOf('},', nxt)).trim();
  const ctx = { fmt: (n, d) => Number(n).toFixed(d), fC: n => '₹' + Number(n).toLocaleString('en-IN'), t: x => x, Math };
  vm.createContext(ctx);
  return { cell: vm.runInContext('(r => ' + expr + ')', ctx), expr };
}

/* ── Qty: read-only value, no editor ── */
{
  const { cell, expr } = cellOf('qty');
  const withQty = cell({ idx: 1, qty: 32.06, taxable: 566180 });
  const noQty = cell({ idx: 2, qty: 0, taxable: 566180 });
  ok(/32\.06/.test(withQty), 'Qty shows the tonnage');
  ok(/qx-dash|—/.test(noQty), 'a bill with no tonnage shows a plain dash');
  ok(!/data-qy|pfr-edit|pfr-add|<button/.test(expr), 'Qty cell is NOT editable — no button, no pencil, no data-qy');
}
/* ── Rate: read-only derived value, no editor ── */
{
  const { cell, expr } = cellOf('rate');
  const priced = cell({ idx: 1, qty: 32.06, taxable: 566180 });
  const noRate = cell({ idx: 2, qty: 0, taxable: 566180 });
  ok(/17,6\d\d/.test(priced), 'Rate shows the derived ₹/T (566180 ÷ 32.06 ≈ ₹17,660)');
  ok(/qx-dash|—/.test(noRate), 'no tonnage → a plain dash');
  ok(!/data-rt|pfr-edit|pfr-add|<button/.test(expr), 'Rate cell is NOT editable — no button, no pencil, no data-rt');
}
/* ── Freight: STILL editable inline ── */
{
  const s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok(/data-fr=/.test(src), 'Freight cell keeps its inline editor (data-fr)');
  ok(/function editFreight\(idx, cell\)/.test(s), 'editFreight still exists');
  ok(/closest\('\[data-fr\]'\)/.test(s), '  and the click delegation reaches it');
}
/* ── the qty/rate editors and their wiring are GONE, not just hidden ── */
{
  ok(!/function editQty/.test(src) && !/function editRate/.test(src), 'editQty / editRate are removed (no dead code)');
  ok(!/data-qy|data-rt/.test(src), 'no [data-qy]/[data-rt] anywhere — the click handlers went too');
}
/* ── the bulk "Set rate ₹/T" tool remains (the deliberate way to fill rates) ── */
{
  const s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok(/label: 'Set rate ₹\/T'/.test(s), 'the bulk "Set rate ₹/T" action still exists (fills rates without per-cell edits)');
  ok(/\(\+r\.taxable\) \/ rate/.test(s) && /Q\.updatePurchase\(r\.idx, \{ qty \}\)/.test(s), '  and derives each bill\'s own qty from the one rate');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
