/* import-guard-loaded.test.js — the gate must exist on every page that can write.
 *
 * data.js refuses a duplicate invoice via:
 *
 *     if (!(typeof ImportGuard !== 'undefined' && ImportGuard.docVerdict)) return null;
 *
 * That line is a kindness to Node tests and a LOADED GUN in the browser: on any
 * page that loads data.js but forgets import-guard.js, the check evaluates to
 * "no opinion" and every duplicate sails straight into the books. Silently. The
 * page still works, the tests still pass, and the bug is back.
 *
 * This is the same defect shape that has bitten repeatedly here — one rule, many
 * pages, one page left behind (the company switch fixed in 8 of 20, the month
 * picker fixed in 2 of 3 until the user found the third). A static check is the
 * only thing that sees it, because no runtime test visits all 31 pages.
 *
 *   node import-guard-loaded.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ import guard · loaded wherever data.js is ═══\n');

const pages = fs.readdirSync(__dirname).filter(f => /\.html$/.test(f))
  .map(f => ({ f, src: fs.readFileSync(path.join(__dirname, f), 'utf8') }))
  .filter(p => /data\.js\?v=/.test(p.src));

ok(pages.length >= 25, 'found the pages that load data.js (got ' + pages.length + ') — if this collapses the guard went blind');

for (const p of pages) {
  ok(/import-guard\.js/.test(p.src),
    p.f + ': loads data.js but NOT import-guard.js. addSale()/addPurchase() will silently accept ' +
    'duplicate invoices on this page — the check degrades to "no opinion" when ImportGuard is undefined.');

  /* Two copies at different ?v= is how a cache serves the old one forever. */
  const tags = (p.src.match(/import-guard\.js/g) || []).length;
  ok(tags <= 1, p.f + ': loads import-guard.js ' + tags + ' times — drop the duplicate tag.');
}

/* The gate itself must still be IN data.js. Deleting the call would make every
   check above pass while nothing is guarded. */
const data = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const code = strip(data);
ok(/ImportGuard\.docVerdict/.test(code), 'data.js no longer calls ImportGuard.docVerdict — the gate is gone');
ok(/function addSale[\s\S]{0,220}dupCheck/.test(code), 'addSale() no longer runs dupCheck() before pushing');
ok(/function addPurchase[\s\S]{0,220}dupCheck/.test(code), 'addPurchase() no longer runs dupCheck() before pushing');

/* hydrate() must NOT be gated: it is the server's own saved data coming back, and
   screening it would DELETE rows the user already has. */
ok(/if \(d\.sales\)\s+S\.SALES\.push/.test(code),
  'hydrate() no longer pushes sales directly — if the gate was added there, loading the app would drop existing invoices');

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + ' · ' + pages.length + ' pages\n');
process.exit(fail ? 1 : 0);
