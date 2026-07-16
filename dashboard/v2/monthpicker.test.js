/* monthpicker.test.js — the ‹ › year arrows must work on EVERY page.
 *
 * Reported: the year arrows do nothing on Bank Reconciliation while working on
 * Sales and Purchase. Cause:
 *
 *     paint() re-renders the menu → the clicked button is detached → the click
 *     bubbles to the document close-handler → that handler sees a target no
 *     longer inside the menu → it closes the picker. Nothing moves.
 *
 * The fix is one call: e.stopPropagation(). What makes this worth a test file is
 * that the bug was ALREADY FOUND, FIXED AND COMMENTED in qlx.js and dashboard.js
 * — and the third copy in reconcile.js still had it. Three implementations of one
 * picker, a fix applied to two of them, and the user finds the third.
 *
 * Static, deliberately. No runtime test visits every page's month picker, and the
 * defect is not in any one handler — it is that the same control exists three
 * times and they drift. Same reasoning as company-switch.test.js and
 * waphone.test.js, both of which caught exactly this shape of bug.
 *
 *   node monthpicker.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

/* Strip comments before asserting: every one of these files EXPLAINS the bug in
   prose, and a bare /stopPropagation/ would match the explanation rather than the
   code. That false positive already bit once in waphone.test.js, where the guard
   matched its own comment and a broken copy sailed through. */
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const files = fs.readdirSync(__dirname).filter(f => /\.js$/.test(f) && !/\.test\.js$/.test(f));

console.log('\n═══ month picker · year arrows ═══\n');

let found = 0;
for (const f of files) {
  const src = strip(fs.readFileSync(path.join(__dirname, f), 'utf8'));

  /* Every handler bound to a [data-yr] button — the ‹ › year arrows. */
  const handlers = src.match(/\[data-yr\][^\n]*onclick[^\n]*/g) || [];
  for (const h of handlers) {
    found++;
    ok(/stopPropagation/.test(h),
      f + ': the ‹ › year arrows do not stopPropagation. paint() detaches the clicked button, ' +
      'the click bubbles to the document close-handler, and the picker shuts instead of changing year. ' +
      'qlx.js and dashboard.js already carry this fix — copy it.');

    /* The handler must take the event to be able to stop it. `() => {...}` cannot. */
    ok(/onclick\s*=\s*(e|ev|event)\s*=>/.test(h),
      f + ': its year-arrow handler takes no event argument, so it cannot stop propagation.');
  }
}
ok(found >= 3, 'found the year-arrow handlers to check (got ' + found + ') — if this drops, a picker was renamed and this guard went blind');

/* The month CELLS are the opposite case and must NOT stop propagation: picking a
   month is meant to close the menu. Pinning it stops someone "fixing" the arrows
   by pasting stopPropagation everywhere and quietly breaking the close. */
for (const f of files) {
  const src = strip(fs.readFileSync(path.join(__dirname, f), 'utf8'));
  const cells = src.match(/\[data-ym\][^\n]*onclick[^\n]*/g) || [];
  for (const c of cells) {
    ok(/close/i.test(c),
      f + ': picking a month should close the picker — this handler never calls close.');
  }
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
