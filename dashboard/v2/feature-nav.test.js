/* feature-nav.test.js — turning a module OFF must hide it EVERYWHERE.
 *
 * Reported: "from setting toggle on off not working after off still showing in the
 * sidebar".
 *
 * The toggle was never broken. setFeature writes localStorage, refreshes and
 * persists — proven below. FOUR surfaces render navigation, and only THREE asked
 * whether the module was on:
 *
 *   desktop sidebar (navHTML)   → filtered ✓
 *   ⌘K palette      (navPages)  → filtered ✓
 *   mobile More sheet (openMore)→ filtered ✓
 *   mobile BOTTOM NAV (TABS)    → rendered five hardcoded tabs, never asked ✗
 *
 * So on a phone you switch Sales off and it sits there, exactly as reported. This
 * is the defect this codebase keeps re-growing: one rule, many surfaces, one left
 * behind — the company switch fixed in 8 of 20 pages, waLink in 7 copies, the month
 * picker fixed in 2 of 3 until the user found the third.
 *
 *   node feature-nav.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ feature toggle · every nav surface ═══\n');

/* ── the REAL shell.js, driven through the REAL toggle ────────────── */
const noop = () => {};
/* `seed` matters: shell.js reads localStorage AT LOAD TIME, so a store populated
   after construction is already too late — which is exactly what a real browser
   does NOT do (the storage is there before the script runs). My first reload test
   seeded late and failed against correct code. */
function harness(seed) {
  const store = Object.assign({}, seed || {});
  const nav = { innerHTML: '', className: 'sb-nav' };
  const el = () => ({
    innerHTML: '', style: {}, dataset: {}, id: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop, addEventListener: noop, setAttribute: noop, getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [], remove: noop, focus: noop, onclick: null
  });
  const ctx = {
    console,
    document: {
      getElementById: () => el(), querySelector: s => (s === '.sb-nav' ? nav : el()),
      querySelectorAll: () => [], createElement: () => el(), addEventListener: noop,
      body: el(), head: el(), documentElement: el()
    },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem: noop },
    QLD: { co: { short: 'GOTAN' }, COMPANIES: {}, init: noop, fC: n => '₹' + n, state: {} },
    location: { href: 'https://app.quicklimes.com/v2/settings', pathname: '/v2/settings', search: '' },
    history: { replaceState: noop }, navigator: { userAgent: 'node' },
    setTimeout: noop, clearTimeout: noop, requestAnimationFrame: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    Object, Array, String, Number, Math, JSON, Date, Set, Map, RegExp, isNaN, parseFloat, parseInt, Promise
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8'), ctx);
  return { ctx, store, nav, S: ctx.QLShell };
}

/* ══════════ 1. THE TOGGLE ITSELF WORKS ══════════ */
{
  const { S, store, nav } = harness();
  ok(!!S, 'the real shell.js loaded and exposed QLShell');
  S.refreshNav();
  ok(/inventory/i.test(nav.innerHTML), 'Inventory starts visible in the sidebar');

  S.setFeature('inventory', false);
  ok(!/inventory/i.test(nav.innerHTML), 'turning it off hides it from the sidebar IMMEDIATELY');
  ok(/"inventory":false/.test(store['ql_features'] || ''), '  and the choice is persisted');

  /* It must survive a RELOAD — a flag that forgets is the same bug wearing a hat.
     A fresh shell, reading the storage the first one wrote. (The `ok(true)` I first
     wrote here was padding: it could not fail, so it proved nothing.) */
  const reloaded = harness({ ql_features: store['ql_features'] });
  reloaded.S.refreshNav();
  ok(!/inventory/i.test(reloaded.nav.innerHTML), '  and it is STILL hidden after a page reload');

  S.setFeature('inventory', true);
  ok(/inventory/i.test(nav.innerHTML), 'turning it back on restores it');
}

/* ══════════ 2. A LOCKED MODULE CANNOT BE HIDDEN ══════════
   setFeat returns early for locked ones. That is correct — you cannot hide
   Settings and then have no way back — but it must not LOOK like it worked. */
{
  const { S, nav } = harness();
  S.setFeature('settings', false);
  S.refreshNav();
  ok(/settings/i.test(nav.innerHTML), 'Settings is locked on — it cannot be hidden (you would be stranded)');
  const f = S.features().find(x => x.key === 'settings');
  ok(f && f.active, '  and features() still reports it active, so the UI can show the truth');
}

/* ══════════ 3. EVERY SURFACE OBEYS THE SAME RULE — the actual bug ══════════ */
{
  const shell = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8');
  const mob = fs.readFileSync(path.join(__dirname, 'mobile.js'), 'utf8');
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const navHTML = (strip(shell).match(/function navHTML[\s\S]{0,900}/) || [''])[0];
  ok(/featOn\(/.test(navHTML), 'the desktop sidebar asks featOn()');

  const navPages = (strip(shell).match(/function navPages[\s\S]{0,700}/) || [''])[0];
  ok(/featOn\(/.test(navPages), 'the ⌘K palette asks featOn()');

  const more = (strip(mob).match(/function openMore[\s\S]{0,700}/) || [''])[0];
  ok(/feat\(/.test(more), 'the mobile More sheet asks QLShell.feat()');

  /* THE BUG. The bottom nav rendered TABS.map(...) with no question asked. */
  ok(/visibleTabs\(\)/.test(strip(mob)), 'the mobile BOTTOM NAV filters through visibleTabs() — it used to render all five tabs blind');
  const tabsHTML = (strip(mob).match(/const tabsHTML[^\n]*/) || [''])[0];
  ok(/visibleTabs\(\)/.test(tabsHTML), '  and its markup is built from the FILTERED list');
  ok(!/TABS\.map\(t => `<button class="qlm-tab"/.test(strip(mob)), '  the raw unfiltered TABS.map is gone');

  /* The stale-index trap my own fix would otherwise have created. */
  ok(!/TABS\[4\]/.test(strip(mob)),
    'tabForActive no longer uses TABS[4] — a hardcoded index is only right while the list is hardcoded; filtering it would silently return the wrong tab');
  ok(/find\(t => t\.key === 'more'\)/.test(strip(mob)), '  it finds "more" by key instead');

  /* One binding, not two — the repaint must not grow a second copy of the rule. */
  eq('the tab click handler is bound in exactly ONE place', (strip(mob).match(/onclick = \(\) => onTab\(/g) || []).length, 1);

  /* And the toggle must repaint the phone, not just the desktop. */
  const refresh = (strip(shell).match(/refreshNav\(\)\s*\{[\s\S]{0,400}/) || [''])[0];
  ok(/QLMobile[\s\S]{0,60}paintTabs/.test(refresh),
    'refreshNav repaints the MOBILE bottom nav too — otherwise the phone is only correct on the next page load');
}

/* ══════════ 4. "more" IS NEVER HIDDEN ══════════
   It is the route to everything else, not a module. Filtering it away would strand
   the user with no way to reach the modules that are still on. */
{
  const mob = fs.readFileSync(path.join(__dirname, 'mobile.js'), 'utf8');
  const vt = (mob.match(/const visibleTabs[^\n]*/) || [''])[0];
  ok(/'more'/.test(vt), '"more" is exempt from filtering — it is the way to everything else');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
