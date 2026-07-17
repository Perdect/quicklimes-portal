/* monthpicker.test.js — there is ONE month picker. Exactly one.
 *
 * "calendar or filter or all things will be similar no changes use design system"
 * "I think you're lazzy why you changed design of calendar"
 *
 * Nobody had changed the design of the calendar. There were FIVE calendars, and
 * he was walking between them:
 *
 *   qlx.js .qx-month        Sales, Purchase
 *   dashboard.js .dx-mm-*   a verbatim clone — but keyed data-m, not data-ym
 *   reconcile.js .rc-mm-*   a clone, minus the selected-cell shadow
 *   inventory.html .inv-*   a clone, grey hover instead of blue
 *   purchasedash.html       a <select> wearing .qx-month's CSS
 *
 * Each carried its own CSS clone of the same 264px grid, so they drifted apart
 * without anyone touching a design. All five are gone; QLShell.monthPicker in
 * shell.js is the only one, because shell.js is the only file all 31 pages load.
 *
 * THIS FILE USED TO ASSERT `found >= 3` — it required at least three copies of
 * the year-arrow handler to exist, because back then the goal was "make sure all
 * three copies carry the fix". That is the wrong shape of guard: it made the
 * duplication load-bearing, and it would have FAILED on the consolidation that
 * actually fixes the bug. It now asserts the opposite, and permanently: a second
 * implementation must never come back. (Static, same pattern as no-fab.test.js —
 * the defect is not in any one handler, it is in the second copy nobody greps
 * for.)
 *
 *   node monthpicker.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

/* Strip comments before asserting: every file here EXPLAINS this bug in prose,
   and a bare /stopPropagation/ would match the explanation rather than the code.
   That false positive already bit once in waphone.test.js, where the guard
   matched its own comment and a broken copy sailed through. */
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
  .replace(/<!--[\s\S]*?-->/g, ' ');

const files = fs.readdirSync(__dirname)
  .filter(f => /\.(js|html)$/.test(f) && !/\.test\.js$/.test(f));
const SRC = new Map(files.map(f => [f, strip(fs.readFileSync(path.join(__dirname, f), 'utf8'))]));

console.log('\n═══ month picker · exactly one of it ═══\n');

/* ══════════ 1. THE ONE IMPLEMENTATION ══════════ */
{
  const shell = SRC.get('shell.js') || '';
  ok(/function monthPicker\s*\(/.test(shell), 'shell.js defines monthPicker() — the app\'s one calendar');
  ok(/function monthButton\s*\(/.test(shell), 'shell.js defines monthButton() — so the trigger is shared too, not just the popover');
  ok(/monthPicker\b/.test(shell) && /window\.QLShell\s*=/.test(shell),
    '  and QLShell exports it, so every page can actually reach it');

  /* The year-arrow bug this file was born for. One copy now — it must carry it. */
  const handlers = shell.match(/\[data-yr\][^\n]*onclick[^\n]*/g) || [];
  ok(handlers.length === 1, 'shell.js binds the ‹ › year arrows exactly once (got ' + handlers.length + ')');
  for (const h of handlers) {
    ok(/stopPropagation/.test(h),
      'the ‹ › year arrows must stopPropagation: paint() detaches the clicked button, the click ' +
      'bubbles to the document close-handler, and the picker shuts instead of changing year.');
    ok(/onclick\s*=\s*(e|ev|event)\s*=>/.test(h),
      'the year-arrow handler must take the event argument — `() => {}` cannot stop propagation.');
  }

  /* The opposite case: picking a month is MEANT to close the picker. Pinning it
     stops someone "fixing" the arrows by pasting stopPropagation everywhere. */
  const cells = shell.match(/\[data-ym\][^\n]*onclick[^\n]*/g) || [];
  ok(cells.length === 1, 'shell.js binds the month cells exactly once (got ' + cells.length + ')');
  for (const c of cells) ok(/close/i.test(c), 'picking a month must close the picker — this handler never calls close.');
}

/* ══════════ 2. NO SECOND IMPLEMENTATION, ANYWHERE ══════════
   The real guard, and the whole point of the file. Not "the copies I deleted are
   deleted" — that catches nothing. A SIXTH copy on a sixth surface is exactly how
   this reached five. */
{
  for (const [f, src] of SRC) {
    if (f === 'shell.js') continue;

    /* Building a month grid = building a picker. A page may CALL the shared one;
       it may not paint one. */
    ok(!/\[data-yr\]/.test(src),
      f + ': binds its own ‹ › year-arrow handler — that is a second month picker. ' +
      'Call QLShell.monthPicker(anchor, { month, have, onPick }) instead.');
    ok(!/data-yr\s*=/.test(src),
      f + ': renders its own year-arrow markup — that is a second month picker. Use QLShell.monthPicker.');
    ok(!/mm-grid|mm-cell/.test(src),
      f + ': renders its own month-grid markup — that is a second month picker. Use QLShell.monthPicker.');

    /* A Jan..Dec array turned into BUTTONS is the fingerprint of a hand-rolled
       calendar — it catches a sixth copy that invents fresh class names and so
       slips past the checks above.

       The array alone is NOT the signal: finance.html and wa-core.js both hold
       one to format "12 Mar", which is a date helper, not a picker. Failing them
       would be a false positive, and a guard that cries wolf gets deleted — the
       precise thing this file is trying to prevent. So: array AND buttons. */
    for (const m of src.matchAll(/\[[^\]]*'Jan'[^\]]*'Dec'[^\]]*\]|\[[^\]]*"Jan"[^\]]*"Dec"[^\]]*\]/g)) {
      const after = src.slice(m.index, m.index + 700);
      ok(!/<button/.test(after),
        f + ': builds month <button> cells from a hand-rolled Jan..Dec array — that is a second ' +
        'month picker with new class names. Call QLShell.monthPicker instead. ' +
        '(A Jan..Dec array for FORMATTING a date is fine; this one renders buttons.)');
    }

    /* purchasedash.html's <select> is why this check exists: it was not a copy of
       the popover, it was a DIFFERENT control for the same job — which reads to
       the user as "the calendar changed again". */
    ok(!/<select[^>]*id\s*=\s*["'][^"']*[Mm]onth/.test(src),
      f + ': uses a native <select> to pick a month. Every other page shows the shared calendar — ' +
      'a dropdown here is the inconsistency the owner reported. Use QLShell.monthPicker.');
  }
}

/* ══════════ 3. NO SECOND STYLESHEET ══════════
   Each copy shipped its own CSS clone of the same grid; THAT is what made the
   calendars look different — nobody restyled anything, the clones just never
   agreed. Dead CSS is how a removed thing quietly returns (no-fab.test.js). */
{
  const css = fs.readdirSync(__dirname).filter(f => /\.css$/.test(f));
  for (const f of css) {
    const src = strip(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    const clones = (src.match(/\.(qx|dx|rc|inv|pd)-mm?-[a-z]+\s*\{/g) || []).filter(c => /-mm-/.test(c));
    ok(!clones.length,
      f + ': still carries month-calendar CSS (' + clones.join(' ') + '). The picker is styled ONCE, ' +
      'in shell.css (.ql-mp). Delete these — an overridden clone comes back.');
  }
  const shellCss = fs.readFileSync(path.join(__dirname, 'shell.css'), 'utf8');
  ok(/\.ql-mp-cell\s*\{/.test(shellCss) && /\.ql-mp-btn\s*\{/.test(shellCss),
    'shell.css owns the picker\'s styling (.ql-mp-btn + .ql-mp-cell) — it is the only stylesheet every page loads');
  ok(/\.ql-mp-cell\.has::after/.test(shellCss),
    '  including the has-data dot: seeing which months have books is why this is a calendar and not a <select>');
}

/* ══════════ 4. EVERY SURFACE STILL HAS ITS PICKER ══════════
   Consolidation must not mean a page quietly LOST its month filter. Each of these
   scopes real numbers — his books — and one of them silently going unfiltered is
   worse than five calendars. */
{
  const wired = {
    'qlx.js': 'Sales + Purchase registers',
    'dashboard.js': 'the Dashboard',
    'reconcile.js': 'Bank Reconciliation',
    'inventory.html': 'Inventory',
    'purchasedash.html': 'the Purchase Dashboard'
  };
  for (const [f, what] of Object.entries(wired)) {
    ok(/QLShell\.monthPicker\s*\(/.test(SRC.get(f) || ''),
      f + ' (' + what + '): no longer opens a month picker at all — it must call QLShell.monthPicker.');
    ok(/QLShell\.monthButton\s*\(/.test(SRC.get(f) || ''),
      f + ' (' + what + '): must render the shared trigger via QLShell.monthButton, so the button matches the calendar.');
  }
}

/* ══════════ 5. THE PICK STILL PERSISTS ══════════
   QLD.uiMonth/setUiMonth is the shared month state — it is why picking March on
   Sales keeps you in March on Purchase. A refactor that dropped it would look
   fine on every page and lose his place on every navigation. */
{
  for (const f of ['qlx.js', 'dashboard.js', 'reconcile.js', 'inventory.html', 'purchasedash.html']) {
    ok(/setUiMonth/.test(SRC.get(f) || ''),
      f + ': no longer persists the picked month (QLD.setUiMonth) — the month must ride across pages.');
  }
  /* Inventory's picker genuinely offers MORE (whole-year + "All time"): stock is a
     running position, not a monthly book. That is an OPTION on the shared picker,
     not grounds for a second picker — and not something to quietly drop either. */
  const inv = SRC.get('inventory.html') || '';
  ok(/years:\s*true/.test(inv) && /allLabel:\s*'All time'/.test(inv),
    'inventory.html: keeps its "Whole year" + "All time" options (years/allLabel on the shared picker). ' +
    'Consolidation must not have quietly deleted them.');
  const shell = SRC.get('shell.js') || '';
  ok(/cfg\.years/.test(shell) && /cfg\.allLabel/.test(shell),
    'shell.js: the shared picker supports years/allLabel — the options that made consolidating Inventory safe');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
