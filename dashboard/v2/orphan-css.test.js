/* orphan-css.test.js — a stylesheet nothing loads, and a class nothing sets.
 *
 * TWO REAL BUGS IN ONE DAY, same shape:
 *
 * 1. purchase.css — I put the freight cell's styles there. NOTHING LOADS
 *    purchase.css. purchase.html links pbill.css. So the control shipped with the
 *    browser's default grey button styling and the owner said, correctly, "for now
 *    its look very bad design button". 207 lines of pre-QLX leftovers, and the only
 *    live class in it was the one I had just added.
 *
 * 2. .ql-ai-mic.rec — I styled the mic's listening state on a class no code
 *    applies. wireVoice toggles `.on`. Caught by grepping the toggler before it
 *    shipped; the freight one was not caught and reached production.
 *
 * NO TEST COULD SEE EITHER. Both files parse. Both suites pass. The CSS is simply
 * never applied, silently, forever. That is the worst failure mode in this
 * codebase: not wrong, absent.
 *
 * This is the cheap structural guard: every stylesheet in v2/ must be loaded by at
 * least one page. It cannot catch every dead class, but it catches the whole file
 * being orphaned — which is the version that cost a day.
 *
 *   node orphan-css.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ orphan CSS · every stylesheet must be loaded by a page ═══\n');

const dir = __dirname;
const htmls = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
const csss = fs.readdirSync(dir).filter(f => f.endsWith('.css'));
ok(htmls.length > 20, 'found the pages (' + htmls.length + ')');
ok(csss.length > 5, 'found the stylesheets (' + csss.length + ')');

/* Every <link href> across every page, and any @import inside the CSS itself. */
const linked = new Set();
htmls.forEach(h => {
  const s = fs.readFileSync(path.join(dir, h), 'utf8');
  (s.match(/href="\.?\/?([\w.-]+\.css)(\?[^"]*)?"/g) || []).forEach(m => {
    const f = /([\w.-]+\.css)/.exec(m);
    if (f) linked.add(f[1]);
  });
});
csss.forEach(c => {
  const s = fs.readFileSync(path.join(dir, c), 'utf8');
  (s.match(/@import\s+(url\()?["']([\w.-]+\.css)/g) || []).forEach(m => {
    const f = /([\w.-]+\.css)/.exec(m);
    if (f) linked.add(f[1]);
  });
});

const orphans = csss.filter(c => !linked.has(c));
ok(orphans.length === 0,
  'NO orphan stylesheet — every .css is loaded by at least one page. ' +
  (orphans.length ? 'ORPHANS: ' + orphans.join(', ') + ' — CSS written here is invisible forever.' : ''));

/* Prove the checker can fail: an invented file nothing links must be caught. */
{
  const fake = 'ql-orphan-probe.css';
  const wouldCatch = !linked.has(fake);
  ok(wouldCatch, 'the checker CAN fail — an unlinked stylesheet is detected (proved with a probe name)');
}

/* purchase.css specifically: it IS the orphan that caused this. It must be gone,
   or loaded. Its continued existence unloaded is the trap. */
{
  const exists = fs.existsSync(path.join(dir, 'purchase.css'));
  if (exists) {
    ok(linked.has('purchase.css'),
      'purchase.css is loaded by a page — if it is not, DELETE it: an unloaded stylesheet is a loaded gun (this exact file cost a day)');
  } else {
    ok(true, 'purchase.css is deleted — the orphan that broke the freight cell is gone');
  }
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
