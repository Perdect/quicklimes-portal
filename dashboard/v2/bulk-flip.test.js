/* bulk-flip.test.js — the import review lets you flip Sales⇄Purchase.
 *
 * THE BUG: direction detection defaults to Purchase when it can't recognise the
 * firm's own GSTIN. Deshwali's OWN quick-lime SALES all imported as Purchase,
 * and there was no way to correct it before import — the register showed 0
 * sales while 10 bills sat in the wrong book. Now the Type cell is a toggle.
 * This runs the REAL flipType out of bulk.js so it can't rot.
 *
 *   node bulk-flip.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ bulk import · flip Sales⇄Purchase before import ═══\n');

const src = fs.readFileSync(path.join(__dirname, 'bulk.js'), 'utf8');
function grab(sig) {
  const i = src.indexOf(sig);
  if (i < 0) throw new Error('not found: ' + sig);
  return src.slice(i, src.indexOf('\n  }', i) + 4);
}

/* Run the real flipType + typeCell + typeBadge with recompute/openTable stubbed. */
const ctx = {
  BATCH: null,
  recompute: () => {},              // its output is not what we're testing
  openTable: () => { ctx.__rendered = (ctx.__rendered || 0) + 1; },
  TYPE_META: { purchase: ['Purchase', 'b'], sales: ['Sales', 'g'], unknown: ['Unknown', 'n'], bankstmt: ['Bank Statement', 'n'] },
  esc: s => String(s)
};
vm.createContext(ctx);
vm.runInContext(
  'function typeBadge(b){var m=TYPE_META[b.type]||TYPE_META.unknown;return "<span>"+m[0]+"</span>";}\n'
  + grab('function typeCell(b) {') + '\n'
  + grab('function flipType(id) {') + '\n'
  + 'this.typeCell = typeCell; this.flipType = flipType;', ctx);

/* ── typeCell: a flip control only for sales/purchase ── */
{
  ok(/data-flip=/.test(ctx.typeCell({ id: 'b1', type: 'purchase' })), 'a PURCHASE bill shows a flip control');
  ok(/⇄ Sales/.test(ctx.typeCell({ id: 'b1', type: 'purchase' })), '  offering to make it a Sales bill');
  ok(/⇄ Purchase/.test(ctx.typeCell({ id: 'b2', type: 'sales' })), 'a SALES bill offers to become Purchase');
  ok(!/data-flip=/.test(ctx.typeCell({ id: 'b3', type: 'bankstmt' })), 'a bank statement has NO flip — it has no other side');
}

/* ── flipType: Deshwali's case — on the Sales page, a mis-filed Purchase → Sales ── */
{
  const bill = { id: 'x1', type: 'purchase', crossKind: 'purchase' };   // detected purchase while on Sales page
  ctx.BATCH = { cfg: { kind: 'sales' }, bills: [bill] };
  ctx.flipType('x1');
  eq('flip → type becomes sales', bill.type, 'sales');
  eq('  crossKind CLEARED (sales matches the Sales page → imports here)', bill.crossKind, null);
  ok(ctx.__rendered > 0, '  the table re-renders');
}
/* ── flip the other way: a Sales bill on the Sales page → Purchase ── */
{
  const bill = { id: 'x2', type: 'sales', crossKind: null };
  ctx.BATCH = { cfg: { kind: 'sales' }, bills: [bill] };
  ctx.flipType('x2');
  eq('flip → type becomes purchase', bill.type, 'purchase');
  eq('  crossKind = purchase (differs from the Sales page → routes to Purchase)', bill.crossKind, 'purchase');
}
/* ── a non-directional bill cannot be flipped ── */
{
  const bill = { id: 'x3', type: 'bankstmt', crossKind: null };
  ctx.BATCH = { cfg: { kind: 'sales' }, bills: [bill] };
  ctx.flipType('x3');
  eq('a bank statement is left alone', bill.type, 'bankstmt');
}

/* ── WIRED: the row renders typeCell and the click reaches flipType ── */
{
  const s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok(/typeCell\(b\)/.test(s), 'the review row renders the toggle (typeCell), not a bare badge');
  ok(/data-flip/.test(s) && /flipType\(btn\.dataset\.flip\)/.test(s), '  and a click on it calls flipType');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
