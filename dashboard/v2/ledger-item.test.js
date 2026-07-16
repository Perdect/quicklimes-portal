/* ledger-item.test.js — the party ledger must name the ITEM, not say "Purchase Bill".
 *
 * Reported: six rows in a supplier's ledger, every Particulars cell reading
 * "Purchase Bill". Useless — the whole point of the column is to tell them apart.
 * The item ("Limestone", "Petcoke", "Bags") was already on the record, unused.
 *
 * Also pins that ONE map produces those names. purchase.js had its own ITEM_SHORT
 * while the ledger had nothing; the fix moved it to data.js. If a second copy
 * reappears, the register and the ledger will drift apart on the same bill — the
 * defect this codebase keeps re-growing (one company switch in 8 of 20 pages, one
 * waLink in 7 copies, one month picker fixed in 2 of 3).
 *
 *   node ledger-item.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ party ledger · item names ═══\n');

/* Pull the REAL itemShort + its map out of data.js — same technique blob.test.js
   uses. A copy here would prove nothing about what ships. */
function grab(startsWith, endsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) throw new Error('not found in data.js: ' + startsWith);
  const j = src.indexOf(endsWith, i);
  return src.slice(i, j + endsWith.length);
}
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(grab('const ITEM_SHORT = {', '\n  }') + ';\n' +
  grab('function itemShort(it)', '}') + '\nthis.itemShort = itemShort;', ctx);

/* ══════════ 1. THE NAMES THE USER ASKED FOR ══════════ */
{
  eq('"Limestone Purchase" shows as Limestone', ctx.itemShort('Limestone Purchase'), 'Limestone');
  eq('"Petcoke Purchase" shows as Petcoke', ctx.itemShort('Petcoke Purchase'), 'Petcoke');
  eq('"Plastic Bags" shows as Bags', ctx.itemShort('Plastic Bags'), 'Bags');
  /* Freight is a separate item in this model, and must stay distinguishable from
     the material it moved — collapsing both to "Petcoke" would hide landed cost. */
  eq('freight keeps its own name', ctx.itemShort('Petcoke Transport Freight'), 'Petcoke Freight');
  ok(ctx.itemShort('Petcoke Transport Freight') !== ctx.itemShort('Petcoke Purchase'),
    '  and is never shown as the same thing as the material');
  /* An unmapped item must show ITSELF, not blank. A ledger row with an empty
     Particulars is worse than "Purchase Bill". */
  eq('an item with no short name shows itself', ctx.itemShort('Machine Repair'), 'Machine Repair');
  eq('a blank item yields blank, not "undefined"', ctx.itemShort(''), '');
  eq('a null item does not throw', ctx.itemShort(null), '');
}

/* ══════════ 2. THE LEDGER USES IT ══════════
   Static: the purchase event in partyLedger() must pass the item through
   itemShort() and keep the generic label only as a FALLBACK. */
{
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const code = strip(src);
  const ev = (code.match(/ev\.push\(\{[^\n]*kind: 'bill'[^\n]*\}\);/) || [''])[0];
  ok(!!ev, 'found the purchase event in partyLedger()');
  ok(/itemShort\(b\.item\)/.test(ev),
    'the ledger no longer names the item — it is back to a hardcoded "Purchase Bill" for every row');
  ok(/\|\| 'Purchase Bill'/.test(ev),
    'the generic label must remain as a FALLBACK — an old bill with no item would otherwise show a blank Particulars');
}

/* ══════════ 3. ONE MAP, NOT TWO ══════════ */
{
  const others = fs.readdirSync(__dirname)
    .filter(f => /\.js$/.test(f) && !/\.test\.js$/.test(f) && f !== 'data.js')
    .filter(f => /'Limestone Purchase'\s*:/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
  eq('no other file keeps its own copy of the item-name map (data.js owns it)', others, []);
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
