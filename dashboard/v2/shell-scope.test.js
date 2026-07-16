/* shell-scope.test.js — a cosmetic paint must never kill functional wiring.
 *
 * THE BUG (2026-07-16, live in production, reported as "toggle on off not working"):
 *
 *   function paintAvatarLetter(co) {
 *     const name = (Q.plant && Q.plant.owner_name) || ...   // ← Q is not defined HERE
 *
 * `Q` is a LOCAL of paintWorkspace (`const Q = window.QLD`). paintAvatarLetter is a
 * SIBLING function, so it never had Q in scope: it threw ReferenceError on EVERY
 * call, and paintWorkspace calls it near its end. So:
 *
 *   · the rest of paintWorkspace died — collections badge, refreshNotifDot
 *   · the rest of every CALLER died — and there are sixteen, on every page
 *   · on settings.html the caller is render(), whose LAST act is binding the
 *     Feature Management toggle listeners. So every switch rendered DEAD: it moved
 *     (native checkbox), wrote nothing, changed nothing. The owner reported this
 *     twice and I "fixed" it twice without ever reproducing it.
 *
 * WHY THE OLD TESTS PASSED. feature-nav.test.js calls QLShell.setFeature() — the
 * API — which works perfectly. It never called paintWorkspace and never simulated a
 * CLICK. A test that exercises the API while the user exercises the UI will report
 * green through a completely dead screen. That is the lesson this file encodes.
 *
 *   node shell-scope.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ shell scope · the paint that killed the page ═══\n');

const src = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8');

/* ══════════ 1. THE RUNTIME PROOF — paintWorkspace must not throw ══════════
   The REAL shell.js, called the way every page calls it. Before the fix this
   throws ReferenceError and this test fails. */
const noop = () => {};
function harness() {
  const store = { ql_plant: JSON.stringify({ id: 'p1', token: 't', owner_name: 'Sameer', owner_phone: '9876543210' }) };
  const nav = { innerHTML: '', className: 'sb-nav', addEventListener: noop, scrollTop: 0 };
  const made = [];
  const el = () => { const e = {
    innerHTML: '', textContent: '', style: {}, dataset: {}, id: '', hidden: false,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop, addEventListener: noop, setAttribute: noop, getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [], remove: noop, focus: noop, onclick: null
  }; made.push(e); return e; };
  const ctx = {
    console,
    document: {
      getElementById: () => el(), querySelector: s => (s === '.sb-nav' ? nav : el()),
      querySelectorAll: () => [el()], createElement: () => el(), addEventListener: noop,
      body: el(), head: el(), documentElement: el()
    },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem: noop },
    /* A REALISTIC QLD — the real one exposes .plant (data.js: `plant: QL_PLANT`).
       Stubbing it as {} would have hidden the bug just as well as the old test did. */
    QLD: {
      co: { short: 'GOTAN', name: 'Gotan Lime Industries', isPrimary: true },
      plant: { owner_name: 'Sameer', owner_phone: '9876543210' },
      COMPANIES: { gotan: { key: 'gotan', short: 'GOTAN' } },
      activeCo: 'gotan', init: noop, fC: n => '₹' + n, state: {},
      collections: () => ({ parties: 0, rows: [] }), switchCompany: noop
    },
    location: { href: 'https://app.quicklimes.com/v2/settings', pathname: '/v2/settings', search: '' },
    history: { replaceState: noop }, navigator: { userAgent: 'node' },
    setTimeout: noop, clearTimeout: noop, requestAnimationFrame: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    Object, Array, String, Number, Math, JSON, Date, Set, Map, RegExp, isNaN, parseFloat, parseInt, Promise
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, S: ctx.QLShell };
}

{
  const { S } = harness();
  ok(!!S, 'the real shell.js loaded');

  /* THE TEST THAT WOULD HAVE CAUGHT IT. Sixteen call sites do exactly this. */
  let threw = null;
  try { S.paintWorkspace(); } catch (e) { threw = e; }
  ok(!threw, 'THE BUG: paintWorkspace() must not throw — ' + (threw ? threw.name + ': ' + threw.message : 'it does not'));
  ok(!(threw && threw.name === 'ReferenceError'),
    '  specifically NOT a ReferenceError from reading a variable that is out of scope');

  /* Calling it twice must also be safe — pages repaint on every render(). */
  let threw2 = null;
  try { S.paintWorkspace(); S.paintWorkspace(); } catch (e) { threw2 = e; }
  ok(!threw2, '  and it is safe to call repeatedly, which every page does');
}

/* A page with NO company loaded yet must not throw either — paintWorkspace is
   called during init, before data lands. */
{
  const { ctx, S } = harness();
  ctx.QLD.plant = null;
  let threw = null;
  try { S.paintWorkspace(); } catch (e) { threw = e; }
  ok(!threw, 'paintWorkspace survives a missing plant (it runs before data lands)');
}

/* ══════════ 2. THE CLASS, NOT JUST THE INSTANCE ══════════
   Every top-level function in shell.js that reads `Q.` must declare its own
   `const Q = window.QLD`. There is no global Q — it is a per-function alias — so a
   function that uses it without declaring it is a guaranteed ReferenceError. This
   check is what makes the NEXT one of these fail here instead of in production. */
{
  /* Brace-match each top-level (2-space indented) function body. */
  function topLevelFunctions(code) {
    const out = [];
    const re = /^  function ([A-Za-z0-9_$]+)\s*\(/gm;
    let m;
    while ((m = re.exec(code))) {
      const start = code.indexOf('{', m.index);
      let depth = 0, i = start, inStr = null, prev = '';
      for (; i < code.length; i++) {
        const c = code[i];
        if (inStr) {
          if (c === inStr && prev !== '\\') inStr = null;
        } else if (c === '"' || c === "'" || c === '`') inStr = c;
        else if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) break; }
        prev = c;
      }
      out.push({ name: m[1], body: code.slice(start, i + 1), line: code.slice(0, m.index).split('\n').length });
    }
    return out;
  }
  /* Comments and strings mention Q all the time; only real code counts. */
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const fns = topLevelFunctions(src);
  ok(fns.length > 20, 'the scope checker found the top-level functions (' + fns.length + ')');
  ok(fns.some(f => f.name === 'paintAvatarLetter'), '  including paintAvatarLetter, the one that broke');
  ok(fns.some(f => f.name === 'paintWorkspace'), '  and paintWorkspace, which calls it');

  const offenders = [];
  fns.forEach(f => {
    const body = strip(f.body);
    if (!/\bQ\s*\./.test(body)) return;                 // does not use Q at all
    if (/\b(const|let|var)\s+Q\s*=/.test(body)) return; // declares its own — correct
    offenders.push(f.name + ' (shell.js:' + f.line + ')');
  });
  ok(offenders.length === 0,
    'THE CLASS: no top-level function reads Q without declaring it — ' +
    (offenders.length ? 'OFFENDERS: ' + offenders.join(', ') : 'none'));

  /* Prove the checker actually detects the bug rather than always passing —
     a scope checker that cannot fail is worse than none, because it certifies. */
  const broken = src.replace(
    /function paintAvatarLetter\(co\) \{[\s\S]*?const Q = window\.QLD \|\| \{\};/,
    'function paintAvatarLetter(co) {');
  ok(broken !== src, 'the mutation applied (the fix is present to remove)');
  const brokenOffenders = topLevelFunctions(broken).filter(f => {
    const b = strip(f.body);
    return /\bQ\s*\./.test(b) && !/\b(const|let|var)\s+Q\s*=/.test(b);
  }).map(f => f.name);
  ok(brokenOffenders.indexOf('paintAvatarLetter') >= 0,
    '  and with the fix removed the checker CATCHES paintAvatarLetter — it can fail');
}

/* ══════════ 3. THE TAIL OF paintWorkspace ACTUALLY RUNS ══════════
   The throw meant everything after paintAvatarLetter(co) was dead code: the
   collections badge and refreshNotifDot never ran on any page. Proving the
   function reaches its end is what proves the caller does too. */
{
  const { ctx, S } = harness();
  let badgeAsked = false;
  ctx.QLD.collections = () => { badgeAsked = true; return { parties: 3, rows: [] }; };
  S.paintWorkspace();
  ok(badgeAsked,
    'paintWorkspace reaches its END — the collections badge past the avatar line runs again');
}

/* ══════════ 4. THE ORDERING TRAP, PINNED ══════════
   settings.html calls paintWorkspace() and THEN binds the toggle listeners, so any
   throw in the paint silently disarms every switch on the page. The binding must
   not be downstream of a cosmetic repaint. */
{
  const s = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8');
  /* Strip comments FIRST. The comment explaining this very fix contains the word
     "paintWorkspace", so an unstripped indexOf matches the prose and reports the
     order backwards — a test failing on its own documentation. */
  const stripC = x => x.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const r = stripC(s.slice(s.indexOf('function render()'), s.indexOf('$(\'#ftReset\')')));
  const paintAt = r.indexOf('QLShell.paintWorkspace()');
  const bindAt = r.indexOf(".ft-row input[type=checkbox]'");
  ok(paintAt >= 0 && bindAt >= 0, 'settings.html render() has both the paint and the toggle binding');
  ok(bindAt < paintAt,
    'the toggle listeners are bound BEFORE the cosmetic repaint — so a broken paint can never again leave every switch dead');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
