/* no-fab.test.js — the "+" floating button stays gone. All of them.
 *
 * "I told you 100 times remove this icon but still showing in some pages"
 *
 * He was right, and "some pages" is the whole lesson. There were TWO floating "+"
 * buttons, built independently:
 *
 *   · mobile.js  .qlm-fab   — removed "by request" (its own comment says so)
 *   · dashboard.js .dx-fab  — LEFT STANDING
 *
 * So the request half-landed. Removing one copy of a duplicated idea looks like
 * done and reads to the user as ignored — for the hundredth time. On the dashboard
 * it also stacked right on top of the AI pill: a "+" circle sitting over "Ask AI
 * about your business", two floating buttons fighting for the same corner. That is
 * what his screenshot showed.
 *
 * This test does not check "the FAB I removed is removed". It checks that NO
 * floating add-button exists on ANY surface — because the bug was never one button,
 * it was the second copy nobody grepped for.
 *
 *   node no-fab.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ no FAB · the "+" stays gone, on every surface ═══\n');

const read = f => { try { return fs.readFileSync(path.join(__dirname, f), 'utf8'); } catch (_) { return ''; } };
/* Comments explain the removal and NAME the classes — so strip them, or the test
   fails on its own documentation. (Hit this exact trap in shell-scope.test.js.) */
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ══════════ 1. THE DASHBOARD "+" — the one he screenshotted ══════════ */
{
  const js = strip(read('dashboard.js'));
  ok(!/function fab\s*\(/.test(js), 'dashboard.js: the fab() builder is DELETED, not left returning \'\'');
  ok(!/\bfab\(\)/.test(js), '  and nothing calls it — the render no longer appends a FAB');
  ok(!/dx-fab/.test(js), '  no .dx-fab markup survives');
  ok(!/dxFab/.test(js), '  and no #dxFab wiring is left dangling');

  const css = strip(read('dash.css'));
  ok(!/\.dx-fab/.test(css),
    'dash.css: the .dx-fab styles are gone too — dead CSS is how a removed thing quietly returns');
}

/* ══════════ 2. THE MOBILE "+" — stays gone (it was removed once already) ══════════ */
{
  const js = strip(read('mobile.js'));
  ok(!/qlm-fab/.test(js), 'mobile.js: still renders no .qlm-fab');
  ok(!/fabAction/.test(js), '  and fabAction() is still gone, not left dangling');
}

/* ══════════ 3. NO NEW ONE, ANYWHERE ══════════
   The real guard. A third copy on a third surface is exactly how this reached
   "100 times" — so scan every shipping file, not just the two I know about. */
{
  const files = fs.readdirSync(__dirname)
    .filter(f => (/\.(js|css)$/.test(f)) && !/\.test\.js$|\.regression\.js$/.test(f));
  ok(files.length > 20, 'scanning every shipping js/css file (' + files.length + ')');

  const offenders = [];
  files.forEach(f => {
    const s = strip(read(f));
    /* A class named *-fab that is NOT the AI assistant pill. The AI FAB is the one
       floating button that earned its place: it is the assistant, on every page,
       and he has never asked for it to go — his screenshot shows the "+" sitting ON
       it, not it. */
    const m = s.match(/[.#][\w-]*fab[\w-]*/gi) || [];
    m.forEach(hit => {
      if (/ai-?fab/i.test(hit)) return;          // .ql-ai-fab / #qlAiFab — allowed
      offenders.push(f + ' → ' + hit);
    });
  });
  ok(offenders.length === 0,
    'NO floating add-button on ANY surface — ' + (offenders.length ? 'FOUND: ' + offenders.join(', ') : 'none'));
}

/* ══════════ 4. NOTHING WAS LOST WITH IT ══════════
   The FAB's six destinations must each still be reachable. Removing a shortcut is
   only safe if the real route exists — otherwise "remove the icon" silently costs
   him a feature, which is a worse bug than the icon. */
{
  const shell = read('shell.js');
  const dests = [
    ['invoice.html', 'New Sale / GST Invoice'],
    ['purchase.html', 'Purchase'],
    ['payments.html', 'Payment'],
    ['production.html', 'Production'],
    ['cashbook.html', 'Expense'],
    ['reconcile.html', 'Bank txn']
  ];
  dests.forEach(([href, label]) => {
    ok(shell.indexOf("href: '" + href + "'") >= 0,
      label + ' is still in the sidebar (' + href + ') — the FAB was a shortcut, not the only way');
  });
}

/* ══════════ 5. THE AI PILL IS ALONE IN THE CORNER NOW ══════════ */
{
  const shell = strip(read('shell.js'));
  ok(/qlAiFab/.test(shell), 'the AI assistant button still exists — it is not what he asked to remove');
  ok(/_active !== 'ai' && featOn\('ai'\)/.test(shell),
    '  and still hides on the AI page itself and when the AI module is switched off');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
