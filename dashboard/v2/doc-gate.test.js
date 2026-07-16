/* doc-gate.test.js — the REAL addSale()/addPurchase() must refuse a duplicate.
 *
 * import-guard.test.js proves the engine decides right. import-guard-loaded.test.js
 * proves every page loads it. Neither proves that data.js — the one chokepoint every
 * invoice enters through (add form, bulk importer, cross-register router) — actually
 * consults it before pushing. This does, on the REAL functions pulled out of data.js.
 *
 * The three-file split is deliberate and earned: party-identity.js shipped with 22
 * green engine checks while ELEVEN call sites ignored it entirely. An engine test
 * cannot see a call site that never calls.
 *
 *   node doc-gate.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/data.js', 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ data.js · the document gate ═══\n');

/* Pull the REAL functions out of data.js — same technique blob.test.js uses. A
   re-implementation here would prove nothing about what ships. */
function grab(startsWith, endsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) throw new Error('not found in data.js: ' + startsWith);
  const j = src.indexOf(endsWith, i);
  return src.slice(i, j + endsWith.length);
}
const F_DUP = grab('function dupCheck(e, existing)', '\n  }');
const F_SALE = grab('function addSale(e)', '\n  }');
const F_PUR = grab('function addPurchase(e)', '\n  }');

let committed = 0, upserted = 0;
const ctx = {
  console, ImportGuard: require('./import-guard.js'),
  S: { SALES: [], PURCHASES: [] },
  toISODate: d => d,
  upsertParty: () => { upserted++; },
  commit: () => { committed++; },
  Object, Array, String, Number, Math, JSON
};
vm.createContext(ctx);
vm.runInContext([F_DUP, F_SALE, F_PUR,
  'this.addSale = addSale; this.addPurchase = addPurchase;'].join('\n'), ctx);
ok(typeof ctx.addSale === 'function', 'the real addSale/addPurchase loaded and are executable');

const INV = { inv: '165/2025-26', party: 'PRINCE LIME INDUSTRIES', gstin: '08AAA0000A1Z5', total: 144470, date: '2025-12-14' };

/* ══════════ 1. THE GATE ══════════ */
{
  ctx.S.SALES.length = 0;
  const first = ctx.addSale(Object.assign({}, INV));
  ok(first.ok === true, 'a new invoice saves');
  ok(ctx.S.SALES.length === 1, '  and is in the books');

  const again = ctx.addSale(Object.assign({}, INV));
  ok(again.ok === false, 'THE GATE: the same invoice number from the same party is REFUSED');
  ok(ctx.S.SALES.length === 1, '  and NOTHING was pushed — refused, not stored-and-badged');
  ok(/already recorded/i.test(again.reason || ''), '  with a reason a human can act on');
  /* It must not throw: shell.js calls onSave outside a try/catch, so a throw would
     leave the modal open with no message at all — worse than the duplicate. */
  ok(again.ok === false && typeof again.reason === 'string', '  returned, not thrown (shell.js has no catch around onSave)');
}

/* ══════════ 2. MUST NOT FIRE ══════════ */
{
  ctx.S.SALES.length = 0;
  ctx.addSale(Object.assign({}, INV));
  ok(ctx.addSale(Object.assign({}, INV, { inv: '166/2025-26' })).ok === true, 'a DIFFERENT invoice number saves');
  ok(ctx.addSale(Object.assign({}, INV, { gstin: '27BBB0000B1Z5', party: 'OTHER FIRM' })).ok === true,
    'the same number from a DIFFERENT firm saves — two firms number their invoices independently');
  /* dupInv() in sales.js copies an invoice with a -COPY suffix. That is a
     deliberate user action and must keep working. */
  ok(ctx.addSale(Object.assign({}, INV, { inv: '165/2025-26-COPY' })).ok === true, 'the "Duplicate invoice" action (-COPY suffix) still works');
  ok(ctx.S.SALES.length === 4, '  all four are in the books');

  /* No identity → cannot be certain → must save, never silently vanish. */
  ctx.S.SALES.length = 0;
  ok(ctx.addSale({ party: 'WALK IN', total: 5000 }).ok === true, 'an invoice with NO number saves — uncertainty must never delete work');
  ok(ctx.addSale({ party: 'WALK IN', total: 5000 }).ok === true, '  and so does a second one');
  ok(ctx.S.SALES.length === 2, '  both are in the books');
}

/* ══════════ 3. PURCHASES, same rule ══════════ */
{
  ctx.S.PURCHASES.length = 0;
  const BILL = { bill: 'B-9021', sup: 'RAMKARAN AND SONS', gstin: '08CCC0000C1Z5', total: 400000, date: '2026-01-28' };
  ok(ctx.addPurchase(Object.assign({}, BILL)).ok === true, 'a new purchase bill saves');
  ok(ctx.addPurchase(Object.assign({}, BILL)).ok === false, 'the same bill number from the same supplier is REFUSED');
  ok(ctx.S.PURCHASES.length === 1, '  and nothing was pushed');
}

/* ══════════ 4. NO GUARD ON THE PAGE → NO OPINION, NOT A CRASH ══════════
   dupCheck returns null when ImportGuard is undefined. That degradation is why
   import-guard-loaded.test.js exists; here we only prove it does not throw. */
{
  const bare = { console, S: { SALES: [], PURCHASES: [] }, toISODate: d => d, upsertParty: () => {}, commit: () => {}, Object, Array, String, Number, Math, JSON };
  vm.createContext(bare);
  vm.runInContext([F_DUP, F_SALE, 'this.addSale = addSale;'].join('\n'), bare);
  let threw = null;
  try { bare.addSale(Object.assign({}, INV)); } catch (e) { threw = e; }
  ok(threw === null, 'a page without ImportGuard still saves rather than crashing (it just cannot screen)');
  ok(bare.S.SALES.length === 1, '  the invoice is stored');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
