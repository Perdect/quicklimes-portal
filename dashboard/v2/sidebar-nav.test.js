/* sidebar-nav.test.js — the sidebar must not fight the person using it.
 *
 * Two reports, one screenshot:
 *
 *  1. "when I scroll down and select any sidebar option ten again going down after
 *     click no need to go down" — every page here is a full HTML load, so the
 *     sidebar is rebuilt and lands back at the top. Scroll down to Inventory, click
 *     a page, and you are at the top again. Scroll down again. Every single time.
 *
 *  2. The URL in the screenshot ends `/v2/reconcile#soon`. He clicked "Stock
 *     Management" — a Soon item — and it went nowhere: `href="#soon"` is a dead
 *     anchor, so the browser appended #soon and jumped. Six items in the sidebar
 *     did this. The ⌘K palette and the mobile More sheet already skip them; only
 *     the sidebar offered a control that cannot do anything.
 *
 *   node sidebar-nav.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ sidebar · scroll + dead links ═══\n');

/* The REAL shell.js. A nav object that records scrollTop and its listener, so the
   assertions are about what the shipped code actually does to the DOM. */
const noop = () => {};
function harness(seed) {
  const session = Object.assign({}, seed || {});
  let scrollHandler = null;
  const nav = {
    innerHTML: '', className: 'sb-nav', scrollTop: 0,
    addEventListener: (ev, fn) => { if (ev === 'scroll') scrollHandler = fn; },
    querySelectorAll: () => []
  };
  const el = () => ({
    innerHTML: '', style: {}, dataset: {}, id: '', scrollTop: 0,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop, addEventListener: noop, setAttribute: noop, getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [], remove: noop, focus: noop, onclick: null
  });
  const timers = [];
  const ctx = {
    console,
    document: {
      getElementById: () => el(), querySelector: s => (s === '.sb-nav' ? nav : el()),
      querySelectorAll: () => [], createElement: () => el(), addEventListener: noop,
      body: el(), head: el(), documentElement: el()
    },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: {
      getItem: k => (k in session ? session[k] : null),
      setItem: (k, v) => { session[k] = v; }, removeItem: k => { delete session[k]; }
    },
    QLD: { co: { short: 'GOTAN' }, COMPANIES: {}, init: noop, fC: n => '₹' + n, state: {} },
    location: { href: 'https://app.quicklimes.com/v2/reconcile', pathname: '/v2/reconcile', search: '' },
    history: { replaceState: noop }, navigator: { userAgent: 'node' },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: noop,
    requestAnimationFrame: noop, matchMedia: () => ({ matches: false, addEventListener: noop }),
    Object, Array, String, Number, Math, JSON, Date, Set, Map, RegExp, isNaN, parseFloat, parseInt, Promise
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  /* shell.js is an IIFE, so its internals are unreachable from outside. Inject the
     handles just before its close rather than re-implement anything: the code under
     test stays the code that ships. */
  let src = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8');
  const close = src.lastIndexOf('})();');
  src = src.slice(0, close) + '\n  globalThis.__wireNavScroll = wireNavScroll; globalThis.__navHTML = navHTML;\n' + src.slice(close);
  vm.runInContext(src, ctx);
  return { ctx, session, nav, S: ctx.QLShell, flush: () => timers.splice(0).forEach(f => f()) };
}

/* ══════════ 1. THE SIDEBAR REMEMBERS WHERE YOU WERE ══════════ */
{
  const h = harness();
  ok(typeof h.ctx.__wireNavScroll === 'function', 'the real wireNavScroll loaded');

  /* Capture the scroll listener the real code registers. */
  let onScroll = null;
  h.nav.addEventListener = (ev, fn) => { if (ev === 'scroll') onScroll = fn; };
  h.ctx.__wireNavScroll();
  eq('a fresh session starts at the top', h.nav.scrollTop, 0);
  ok(typeof onScroll === 'function', 'it listens for scroll on the nav');

  /* The user scrolls down to Inventory. */
  h.nav.scrollTop = 420;
  onScroll();
  h.flush();                       // its debounce
  eq('THE FIX: scrolling down is remembered', h.session['ql_sb_scroll'], '420');

  /* THE REPORTED BUG: clicking a page is a full HTML load. The new page must NOT
     dump you back at the top to scroll down all over again. */
  const reloaded = harness({ ql_sb_scroll: '420' });
  reloaded.ctx.__wireNavScroll();
  eq('after clicking through to a new page, the sidebar is where you left it', reloaded.nav.scrollTop, 420);

  /* Junk must not throw or scroll somewhere absurd. */
  const junk = harness({ ql_sb_scroll: 'banana' });
  junk.ctx.__wireNavScroll();
  eq('a junk stored value is ignored, not applied', junk.nav.scrollTop, 0);

  /* sessionStorage, not localStorage: a scroll position is per-tab state, not a
     preference that should follow the user into next week. */
  const shellSrc = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8');
  const fn = (shellSrc.match(/function wireNavScroll[\s\S]{0,600}/) || [''])[0];
  ok(/sessionStorage/.test(fn) && !/localStorage/.test(fn), '  the position lives in sessionStorage (per tab), not localStorage');
}

/* ══════════ 2. A "SOON" ITEM IS NOT A LINK ══════════ */
{
  const h = harness();
  const html = h.ctx.__navHTML('dashboard');
  ok(!!html && html.length > 200, 'the real navHTML rendered');

  /* THE BUG: six items rendered href="#soon" — a dead anchor. */
  ok(!/href="#soon"/.test(html), 'THE BUG: no sidebar item links to the dead #soon anchor — a click cannot put #soon in the address bar or jump the page');
  eq('  and there are zero of them, not merely fewer', (html.match(/#soon/g) || []).length, 0);

  /* FLIPPED, deliberately. These two used to require an inert is-soon item
     with aria-disabled, because six modules were parked and a dead link is
     worse than an honest badge. Every module now lands on a real page —
     Attendance and Dispatch were built, the rest resolve to the pages that
     already answer them — so the pin is now the absence: nothing renders
     inert. The MACHINERY (is-soon, aria-disabled) stays in shell.js for the
     next genuinely unfinished module; what must not exist is a CURRENT item
     using it. */
  ok(/Stock Management/.test(html), 'Stock Management is still listed — now as a live link (Inventory computes stock)');
  ok(!/is-soon/.test(html), 'no sidebar item renders inert any more — every module is a real page');
  ok(!/aria-disabled="true"/.test(html), '  and none is announced as disabled to a screen reader');
  /* Dispatch renders here because its section's feature is on by default.
     Attendance sits in the People section, which this harness (no
     localStorage) has off — its live link is pinned in nav-targets.test.js,
     which reads the nav CONFIG rather than one feature-gated render. */
  ok(/href="dispatch\.html"/.test(html),
    '  Dispatch is an ordinary link to its built page');

  /* A real page must still be a real link — do not disable the whole sidebar. */
  ok(/<a class="sb-link[^"]*" href="reconcile\.html"/.test(html) || /href="[a-z-]+\.html"/.test(html),
    'real pages are still ordinary links');
  const anchors = (html.match(/<a class="sb-link/g) || []).length;
  ok(anchors >= 8, '  and there are still plenty of them (got ' + anchors + ') — the fix did not disable the sidebar');
}

/* ══════════ 3. THE OTHER SURFACES ALREADY AGREED ══════════
   navPages (⌘K) and the mobile More sheet skip Soon items. Pinned so the sidebar's
   new behaviour is the CONSISTENT one, not a fourth opinion. */
{
  const shell = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8');
  const mob = fs.readFileSync(path.join(__dirname, 'mobile.js'), 'utf8');
  ok(/it\.href !== SOON/.test(shell), 'the ⌘K palette skips Soon pages');
  ok(/!it\.soon/.test(mob), 'the mobile More sheet skips Soon pages');
  ok(/if \(it\.soon\) return/.test(shell), 'and now the sidebar does too — all four surfaces agree');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
