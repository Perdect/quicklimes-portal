/* dedupe-wiring.test.js — the REMOVAL actually removes the right rows.
 *
 * dedupe.test.js proves the engine picks the right rows. This proves the button
 * deletes THOSE rows and not their neighbours. The two are different tests, and
 * only this one can see a wrong index: an engine test compares objects, while the
 * real removal goes through Q.deleteSale(i) — an INDEX. Get that wrong and the app
 * deletes a different invoice and reports "Removed 2 duplicates" while doing it.
 *
 * That is not hypothetical here. scanDocs originally filtered deleted rows and then
 * indexed, so one _del row shifted every index by one. Thirty-four engine tests
 * passed before and after the fix.
 *
 * Loads the REAL data.js mutations (softDelete/deleteSale/deletePurchase/
 * removeReconTxns) and the REAL dedupe-ui.js apply(). Nothing re-implemented.
 *
 *   node dedupe-wiring.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ dedupe · the removal path ═══\n');

function grab(startsWith, endsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) throw new Error('not found in data.js: ' + startsWith);
  const j = src.indexOf(endsWith, i);
  return src.slice(i, j + endsWith.length);
}
/* For the ONE-LINERS. grab() to the first ';' or '\n  }' runs straight past the end
   of a single-line function and swallows the next one — which failed here as a bare
   "Unexpected end of input", not as anything resembling the real cause. */
function grabLine(startsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) throw new Error('not found in data.js: ' + startsWith);
  return src.slice(i, src.indexOf('\n', i));
}

const INV = { inv: '165/2025-26', party: 'PRINCE LIME', gstin: '08AAA0000A1Z5', total: 144470 };
const BILL = { bill: 'B-9021', sup: 'RAMKARAN', gstin: '08CCC0000C1Z5', total: 400000 };
const TXN = { id: 't1', date: '2025-12-14', clean: 'PRINCE LIME', utr: '0012545409', credit: 100000, accountId: 'BA1' };

let committed = 0, audits = [];
const S = {
  SALES: [
    /* An ALREADY-TRASHED row at index 0, because real books have them. Without it
       every index happens to line up and the filter-then-index bug is invisible
       end-to-end — it survived mutation testing on this file until this row existed. */
    { inv: 'OLD', party: 'GONE', gstin: '08WWW0000W1Z5', total: 1, _del: { at: 'x', reason: 'earlier' } },
    { inv: 'KEEP-ME', party: 'OTHER FIRM', gstin: '08YYY0000Y1Z5', total: 999 },   // 1 — must survive
    Object.assign({}, INV),                                                          // 2 — keeper
    Object.assign({}, INV)                                                           // 3 — duplicate
  ],
  PURCHASES: [
    Object.assign({}, BILL),                                                         // 0 — keeper
    Object.assign({}, BILL),                                                         // 1 — duplicate
    { bill: 'B-OTHER', sup: 'X', gstin: '08ZZZ0000Z1Z5', total: 5 }                  // 2 — must survive
  ],
  RECON: { txns: [Object.assign({}, TXN), Object.assign({}, TXN, { id: 't2' }), { id: 't3', utr: 'UNIQUE99', debit: 50 }] }
};

const ctx = {
  console, ImportGuard: require('./import-guard.js'), Dedupe: require('./dedupe.js'),
  S, commit: () => { committed++; },
  logAudit: (action, module, rec, meta) => { audits.push({ action, module, meta }); },
  nowISO: () => '2026-07-16T00:00:00.000Z',
  QL_PLANT: { owner_name: 'Sameer' },
  Object, Array, String, Number, Math, JSON, Set, Date, isNaN, parseFloat, parseInt
};
vm.createContext(ctx);
vm.runInContext([
  // TRASHABLE's audit meta calls cS/cP — the real ones, not a stub that could lie.
  grabLine('const cS = s =>'),
  grabLine('const cP = p =>'),
  grab('function whoami()', '\n  }'),
  grab('const TRASHABLE = {', '\n  };'),
  grabLine('const isDel  = r =>'),
  grabLine('function _meta('),
  grab('function softDelete(module, idx, reason)', '\n  }'),
  grabLine('function deleteSale(i, reason)'),
  grabLine('function deletePurchase(i, reason)'),
  grab('function removeReconTxns(ids, reason)', '\n  }'),
  'this.deleteSale = deleteSale; this.deletePurchase = deletePurchase; this.removeReconTxns = removeReconTxns;'
].join('\n'), ctx);
ok(typeof ctx.deleteSale === 'function', 'the real data.js mutations loaded and are executable');

/* The real dedupe-ui.js, driven through the real QLD surface. */
const noop = () => {};
const els = {};
const mkEl = id => (els[id] = els[id] || { id, innerHTML: '', appendChild: noop, classList: { toggle: noop, add: noop, remove: noop } });
let toasted = '';
const ui = {
  console, Dedupe: ctx.Dedupe,
  document: { getElementById: id => (id === 'ddCSS' ? mkEl('ddCSS') : mkEl(id)), createElement: () => mkEl('_c'), head: mkEl('_head') },
  QLShell: { panel: noop, toast: m => { toasted = m; } },
  QLD: {
    fC: n => '₹' + Math.round(+n || 0), fDS: d => String(d || ''),
    state: S, recon: S.RECON,
    deleteSale: ctx.deleteSale, deletePurchase: ctx.deletePurchase, removeReconTxns: ctx.removeReconTxns
  },
  setTimeout: noop, location: { reload: noop },
  Object, Array, String, Number, Math, JSON, Set, Date
};
ui.window = ui; ui.globalThis = ui;
vm.createContext(ui);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'dedupe-ui.js'), 'utf8'), ui);
ok(typeof ui.QLDedupe.apply === 'function', 'the real dedupe-ui apply() loaded');

/* ══════════ what it says it will do ══════════ */
{
  const s = ui.QLDedupe.scanNow();
  eq('it finds 1 duplicate bank row, 1 invoice, 1 bill', [s.counts.txns, s.counts.sales, s.counts.purchases], [1, 1, 1]);
  eq('  and offers to remove exactly 3', s.total, 3);
}

/* ══════════ what it actually does ══════════ */
{
  ui.QLDedupe.apply();

  eq('the duplicate BANK row is gone', S.RECON.txns.map(t => t.id), ['t1', 't3']);
  ok(S.RECON.txns.some(t => t.id === 't3'), '  the unrelated bank row is untouched');

  /* The keeper stays LIVE and the duplicate is flagged — by the right index. */
  ok(!S.SALES[2]._del, 'the kept invoice is still live');
  ok(!!S.SALES[3]._del, 'the duplicate invoice is trashed');
  ok(!S.SALES[1]._del, 'THE NEIGHBOUR IS UNTOUCHED — a wrong index would have taken this one');
  eq('  and the neighbour is still the invoice it always was', S.SALES[1].inv, 'KEEP-ME');

  ok(!S.PURCHASES[0]._del, 'the kept bill is still live');
  ok(!!S.PURCHASES[1]._del, 'the duplicate bill is trashed');
  ok(!S.PURCHASES[2]._del, 'the unrelated bill is untouched');

  /* Soft, so it is recoverable — and it says why. */
  ok(/Duplicate/i.test(S.SALES[3]._del.reason || ''), 'the trashed invoice records WHY it went, for Trash');
  eq('  and the row trashed EARLIER keeps its own reason (not overwritten)', S.SALES[0]._del.reason, 'earlier');
  ok(audits.some(a => a.action === 'trash'), '  and it is audited');
  ok(audits.some(a => a.module === 'bankTxn'), '  the bank row removal is audited too (it is a hard delete)');

  eq('the toast reports the number it actually removed', toasted, 'Removed 3 duplicates');
}

/* ══════════ running it twice is safe ══════════
   If a second run still saw the rows it just trashed, the count would never reach
   zero and the user would "remove" the same rows forever. */
{
  eq('a second scan finds nothing left', ui.QLDedupe.scanNow().total, 0);
  toasted = '';
  ui.QLDedupe.apply();
  eq('  and a second apply removes nothing', toasted, 'Removed 0 duplicates');
  eq('  leaving the books exactly as they were', S.SALES.filter(r => !r._del).length, 2);
}

/* ══════════ A STALE SCAN MUST NOT BE TRUSTED ══════════
   open() renders a panel from a scan taken at open time and its button calls
   apply(s) with it. Those indices are already history — another tab or an import
   can move a row underneath them, and deleting by a stale index takes the wrong
   bill. apply() re-scans and ignores the argument; this pins that, because the
   argument is right there and looks convenient. */
{
  const stale = { txns: [], sales: [{ key: 'x', keep: { i: 0 }, dupes: [{ i: 0 }, { i: 1 }], count: 3 }], purchases: [], counts: { txns: 0, sales: 2, purchases: 0 }, total: 2 };
  const before = S.SALES.map(r => !!r._del);
  toasted = '';
  ui.QLDedupe.apply(stale);
  eq('apply() ignores a stale scan handed to it and re-scans', toasted, 'Removed 0 duplicates');
  eq('  so no live invoice is trashed on stale indices', S.SALES.map(r => !!r._del), before);
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
