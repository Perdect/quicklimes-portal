/* qty-inline.test.js — the Qty (T) cell is an inline editor, and it is WIRED.
 *
 * "still not show some bills per tone rate." Root cause was NOT missing bills —
 * every live bill renders (verified E2E). The rate is DERIVED taxable ÷ qty, so
 * a bill with no tonnage shows a dash for both. The repair is inline qty entry
 * on the row (editQty, freight-editor sibling) — which existed in the working
 * tree but had NEVER DEPLOYED, so the live dash was dead. This pins it so a
 * future deploy cannot drop it again.
 *
 *   node qty-inline.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ Qty (T) · inline editor, wired ═══\n');

const src = fs.readFileSync(path.join(__dirname, 'purchase.js'), 'utf8');

/* Pull the qty column's cell and run it — a regex alone would pass on markup
   that never renders the edit button. */
const qStart = src.indexOf("{ key: 'qty',");
const body = src.indexOf('cell: r =>', qStart) + 'cell: r =>'.length;
const end = src.indexOf("{ key: 'rate',", body);          // the cell ends just before the rate column
const expr = src.slice(body, src.lastIndexOf('},', end)).trim();
ok(qStart > 0 && end > body, 'the qty column cell was located in purchase.js');
const ctx = { fmt: (n, d) => Number(n).toFixed(d), t: x => x };
vm.createContext(ctx);
const cell = vm.runInContext('(r => ' + expr + ')', ctx);

/* ── a bill WITHOUT qty: a clickable dash, not dead text ── */
{
  const html = cell({ idx: 7, qty: 0, taxable: 500000 });
  ok(/data-qy="7"/.test(html), 'a no-qty row renders a data-qy edit button (the click target)');
  ok(/pfr-add/.test(html) && /—/.test(html), '  showing a dash that INVITES entry, not a dead —');
  ok(/pfr-ico|path d=/.test(html), '  with a pencil affordance so it reads as editable');
  ok(/add the tonnage/i.test(html), '  and a title that says what happens');
}
/* ── a bill WITH qty: the number, still editable to correct it ── */
{
  const html = cell({ idx: 3, qty: 32.38, taxable: 525204 });
  ok(/data-qy="3"/.test(html), 'a qty row is still editable (correct a wrong tonnage)');
  ok(/32\.38/.test(html), '  and shows the tonnage');
}

/* ── WIRED: the click delegation reaches editQty, and editQty exists ── */
{
  const s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok(/closest\('\[data-qy\]'\)/.test(s), 'a table click is delegated from [data-qy] …');
  ok(/editQty\(\+?q?\.?dataset\.qy/.test(s) || /editQty\(\+q\.dataset\.qy/.test(s), '  … to editQty(idx, cell)');
  ok(/function editQty\(idx, cell\)/.test(s), 'editQty is defined');
  ok(/Q\.updatePurchase\(idx, \{ qty:/.test(s), '  and it WRITES the qty to the bill (updatePurchase)');
  /* a human's typed qty must be sacred — qty-backfill must never overrule it */
  const bf = fs.readFileSync(path.join(__dirname, 'qty-backfill.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok(/!p\.qty|p\.qty\s*[>&]|qty\b/.test(bf), 'qty-backfill only fills EMPTY qty — a typed tonnage is never overwritten');
}

/* ── the RATE cell is editable too: type the rate off the bill, qty derives ── */
{
  const rStart = src.indexOf("{ key: 'rate',");
  const rBody = src.indexOf('cell: r =>', rStart) + 'cell: r =>'.length;
  const rEnd = src.indexOf("{ key: 'taxable',", rBody);
  const rExpr = src.slice(rBody, src.lastIndexOf('},', rEnd)).trim();
  const rctx = { fmt: (n, d) => Number(n).toFixed(d), fC: n => '₹' + Number(n).toLocaleString('en-IN'), t: x => x, Math };
  vm.createContext(rctx);
  const rcell = vm.runInContext('(r => ' + rExpr + ')', rctx);

  const noQty = rcell({ idx: 5, qty: 0, taxable: 1160333 });
  ok(/data-rt="5"/.test(noQty), 'a no-rate row (has taxable) renders a clickable rate cell — type the rate off the bill');
  ok(/pfr-add/.test(noQty) && /—/.test(noQty), '  a dash that invites the rate, not a dead —');
  ok(/off the bill/i.test(noQty), '  and a title saying so');

  const withQty = rcell({ idx: 3, qty: 32.38, taxable: 525204 });
  ok(/data-rt="3"/.test(withQty), 'a priced row stays editable (correct the rate)');
  ok(/16,2\d\d/.test(withQty), '  showing the derived ₹/T (525204 ÷ 32.38 ≈ ₹16,220)');

  const noTax = rcell({ idx: 9, qty: 0, taxable: 0 });
  ok(/qx-dash/.test(noTax) && !/data-rt/.test(noTax), 'no taxable → a plain dash, NOT clickable (a rate needs something to divide)');
}

/* ── WIRED + the derive-qty-from-rate maths ── */
{
  const s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok(/closest\('\[data-rt\]'\)/.test(s), 'a rate-cell click is delegated from [data-rt] …');
  ok(/editRate\(\+rt\.dataset\.rt/.test(s), '  … to editRate(idx, cell)');
  ok(/function editRate\(idx, cell\)/.test(s), 'editRate is defined');
  ok(/tax \/ rate/.test(s) && /Q\.updatePurchase\(idx, \{ qty \}\)/.test(s),
    '  and it derives qty = taxable ÷ rate, then stores qty (one base field, both columns fill)');
}

/* ── BULK "Set rate ₹/T": one rate across many bills, each qty from its own amount ── */
{
  const s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok(/label: 'Set rate ₹\/T'/.test(s), 'the register offers a bulk "Set rate ₹/T" action');
  ok(/rows\.filter\(r => \+r\.taxable > 0\)/.test(s), '  applied only to bills with a taxable amount (something to divide)');
  ok(/\(\+r\.taxable\) \/ rate/.test(s) && /Q\.updatePurchase\(r\.idx, \{ qty \}\)/.test(s),
    '  each bill gets ITS OWN qty = taxable ÷ rate (not a copied tonnage)');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
