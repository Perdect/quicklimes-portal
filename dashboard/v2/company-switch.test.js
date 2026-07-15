/* company-switch.test.js — the company switch cannot be a per-page convention.
 *
 * Reported: "I selected Gotan lime but in the mobile showing Deshwali minerals"
 * and "I can't change company". Two distinct causes, both real:
 *
 *   1. The shell handed the chosen company id to window.__qlOnSwitchCompany(id)
 *      and TRUSTED each page to call QLD.switchCompany itself. Eight of twenty
 *      pages ignored the id — `window.__qlOnSwitchCompany = () => render()` — so
 *      the menu closed, the page redrew, and the PREVIOUS company's money stayed
 *      on screen. Nothing looked broken. That is the worst kind of wrong.
 *   2. mobile.js never mentioned companies at all. The switcher lives in the
 *      desktop sidebar, which mobile hides, so on a phone there was no company
 *      control whatsoever.
 *
 * These are static checks on purpose. The bug was not that any one page had a
 * defect — it was that the CONTRACT let a page be quietly wrong, and no runtime
 * test would ever visit all twenty pages. Grep is the right tool for "no page may
 * do X". Run: node company-switch.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const files = fs.readdirSync(__dirname).filter(f => /\.(js|html)$/.test(f) && !/\.test\.js$/.test(f));

console.log('\n═══ company switch · contract ═══\n');

/* ── 1. The SHELL performs the switch ── */
const shell = read('shell.js');
const wsHandler = (shell.match(/menu\.querySelectorAll\('\.ws-row\[data-co\]'\)[\s\S]{0,700}/) || [''])[0];
ok(/Q\.switchCompany\(/.test(wsHandler),
  'shell.js: the workspace switcher does NOT call Q.switchCompany — picking a company would not change it');
ok(/__qlOnSwitchCompany/.test(wsHandler),
  'shell.js: the switcher never tells the page to redraw');
ok(wsHandler.indexOf('Q.switchCompany(') < wsHandler.indexOf('__qlOnSwitchCompany'),
  'shell.js: the page is told to redraw BEFORE the switch happens — it would redraw the old company');
ok(/location\.reload\(\)/.test(wsHandler),
  'shell.js: a page with no redraw hook is left showing the previous company (no reload fallback)');

/* ── 2. No page may take the switch into its own hands ──
   If a page's hook calls switchCompany, the shell has already switched, so that
   call early-returns on the same id and the page's render() never runs — a stale
   screen. Exactly as bad as the original bug, in the opposite direction. */
for (const f of files) {
  const s = read(f);
  const hooks = s.match(/window\.__qlOnSwitchCompany\s*=\s*[^;]+;/g) || [];
  for (const h of hooks) {
    ok(!/switchCompany/.test(h),
      f + ': its __qlOnSwitchCompany still calls switchCompany. The shell already switched, so this early-returns and render() never fires — the page would show stale data. The hook must ONLY redraw.');
    ok(!/^window\.__qlOnSwitchCompany\s*=\s*(async\s*)?id\s*=>/.test(h),
      f + ': its hook takes an `id`, implying it still thinks it performs the switch. The shell owns it; the hook only redraws.');
  }
}

/* ── 3. Every page that renders company data must have a redraw hook ──
   Without one the shell falls back to location.reload(), which works but throws
   away scroll/filters. Missing hooks are worth knowing about. */
const pages = files.filter(f => /\.html$/.test(f) && /QLShell\.mount/.test(read(f)));
const noHook = pages.filter(f => {
  const s = read(f);
  if (/__qlOnSwitchCompany/.test(s)) return false;
  // Pages whose logic lives in a sibling .js file are covered by that file.
  const sib = f.replace('.html', '.js');
  if (files.includes(sib) && /__qlOnSwitchCompany/.test(read(sib))) return false;
  if (/qlx\.js/.test(s)) return false;                      // QLX mounts define the hook centrally
  return true;
});
ok(noHook.length === 0, 'pages with no company-switch redraw hook (they fall back to a full reload): ' + noHook.join(', '));

/* ── 4. Mobile must have a company switcher ──
   The desktop control is in the sidebar; mobile hides the sidebar. Before this,
   mobile.js did not contain the word "company" anywhere and a phone user simply
   could not change firm. */
/* Strip comments FIRST. These files document themselves heavily, and the prose
   explaining the fix contains every word the check looks for: a bare
   /switchCompany/ matched my own comment, so a mutation that broke the actual
   call still "passed". Same trap as matching /CGST/ against the statutory
   declaration. Assert against CODE. */
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const mob = stripComments(read('mobile.js'));
ok(/\.switchCompany\s*\(/.test(mob), 'mobile.js: no company switcher — a phone user cannot change company at all');
ok(/\.COMPANIES\b/.test(mob), 'mobile.js: never reads the company list');
ok(/['"]qlmCo['"]|id="qlmCo"/.test(mob), 'mobile.js: no company chip in the mobile header');
ok(/__qlOnSwitchCompany\s*\(/.test(mob),
  'mobile.js: switches without telling the page to redraw — the screen would keep the old company\'s figures');
ok(/length\s*<\s*2/.test(mob) || /length\s*>\s*1/.test(mob),
  'mobile.js: the company chip should hide when there is only one company (a one-item menu is noise)');

/* The mobile switch must go through QLD.switchCompany, not reimplement it —
   a second path that writes dm_active_co itself would drift from the desktop. */
ok(!/setItem\(['"]dm_active_co/.test(mob),
  'mobile.js: writes dm_active_co directly instead of going through QLD.switchCompany — two switch paths WILL diverge');

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
