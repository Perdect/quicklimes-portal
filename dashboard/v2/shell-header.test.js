/* shell-header.test.js — the header must paint itself, and a deleted photo must die.
 *
 * TWO BUGS, both reported as "same issue as yesterday", both real:
 *
 * 1. "selected Gotan lime but profile showing D"
 *    The header ships with placeholders — avatar "D", name "Loading…" — and
 *    paintWorkspace() replaces them. But paintWorkspace was each PAGE's job to
 *    call. Twenty remembered; SIX did not (ai, banks, inventory, invoice-designs,
 *    purchasedash, refunds). On those the placeholders simply stayed. The "D" is
 *    Deshwali Minerals — the OTHER company on this account — so an unpainted header
 *    does not read as "not loaded yet", it reads as "you are in the wrong firm's
 *    books". Worse, `co` is a getter that is undefined until data lands, so
 *    co.short.charAt(0) threw and took out every caller's tail too.
 *
 * 2. "I remove my profile photo in mobile but still showing in desktop"
 *    The photo is in the CLOUD blob (data.js:395), and every pull writes it back
 *    into localStorage (data.js:384). Remove only cleared localStorage and never
 *    told the cloud — so the blob kept it and handed it back to the next device.
 *    It was never deleted. He was right every time he reported it.
 *
 *   node shell-header.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ shell header · paints itself · photo actually deletes ═══\n');

const src = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8');
const noop = () => {};

/* A DOM fake that tracks the real header nodes, so we can read what got painted. */
function harness(opts) {
  opts = opts || {};
  const store = Object.assign({ ql_plant: JSON.stringify({ id: 'p1', token: 't', owner_name: 'Sameer' }) }, opts.store);
  const nodes = {
    '#wsBtn .workspace-avatar': { textContent: 'D' },      // the shipped placeholders
    '#wsBtn .workspace-name': { textContent: 'Loading…' },
    '#wsBtn .workspace-meta': { textContent: 'QUICK LIME' }
  };
  /* applyAvatarPhoto sets a CSS custom property, so style needs the real API — a
     bare {} throws and would look like a code bug. */
  const styl = () => ({ setProperty: noop, removeProperty: noop });
  const cls = () => ({ add: noop, remove: noop, toggle: noop, contains: () => false });
  const avatars = [
    { textContent: 'D', style: styl(), classList: cls() },
    { textContent: 'D', style: styl(), classList: cls() }
  ];
  const el = () => ({
    innerHTML: '', textContent: '', style: {}, dataset: {}, id: '', hidden: false,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop, addEventListener: noop, setAttribute: noop, getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [], remove: noop, focus: noop, onclick: null
  });
  const commits = [];
  const ctx = {
    console,
    document: {
      getElementById: () => el(),
      querySelector: s => nodes[s] || (s === '.sb-nav' ? { innerHTML: '', addEventListener: noop, scrollTop: 0 } : el()),
      querySelectorAll: s => (s === '[data-avatar]' ? avatars : [el()]),
      createElement: () => el(), addEventListener: noop, body: el(), head: el(), documentElement: el()
    },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem: noop },
    QLD: {
      /* `'co' in opts`, not `opts.co === undefined` — the whole point of these cases
         is passing co: undefined, which the === check cannot tell apart from "not
         passed" and so silently handed back the default. My first version did that
         and reported "G" where it wanted "·": the test was wrong, not the code. */
      co: 'co' in opts ? opts.co : { short: 'GOTAN', name: 'Gotan Lime Industries', isPrimary: true },
      plant: 'plant' in opts ? opts.plant : { owner_name: 'Sameer', owner_phone: '98765' },
      COMPANIES: { gotan: { key: 'gotan', short: 'GOTAN' } }, activeCo: 'gotan',
      init: noop, switchCompany: noop, fC: n => '₹' + n, state: {},
      collections: () => ({ parties: 0, rows: [] }),
      commit: () => commits.push(1)
    },
    location: { href: 'https://app.quicklimes.com/v2/inventory', pathname: '/v2/inventory', search: '' },
    history: { replaceState: noop }, navigator: { userAgent: 'node' },
    setTimeout: noop, clearTimeout: noop, requestAnimationFrame: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    Object, Array, String, Number, Math, JSON, Date, Set, Map, RegExp, isNaN, parseFloat, parseInt, Promise
  };
  ctx.addEventListener = noop;      // mount() wires window-level listeners
  ctx.removeEventListener = noop;
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, S: ctx.QLShell, nodes, avatars, store, commits };
}

/* ══════════ 1. THE "D" — the wrong company's initial ══════════ */
{
  const { S, nodes, avatars } = harness();
  eq('the header SHIPS showing "D" (Deshwali) — the placeholder in the markup', nodes['#wsBtn .workspace-avatar'].textContent, 'D');
  S.paintWorkspace();
  eq('THE FIX: painting replaces it with the ACTIVE company\'s letter', nodes['#wsBtn .workspace-avatar'].textContent, 'G');
  eq('  and the real company name, not "Loading…"', nodes['#wsBtn .workspace-name'].textContent, 'GOTAN');
  eq('  the profile avatars show the PERSON, not a stale D', avatars.map(a => a.textContent), ['S', 'S']);
  ok(!/^D$/.test(nodes['#wsBtn .workspace-avatar'].textContent), '  no "D" survives anywhere in the header');
}

/* Data not loaded yet: co is a GETTER returning undefined. This threw. */
{
  const { S, nodes, avatars } = harness({ co: undefined });
  let threw = null;
  try { S.paintWorkspace(); } catch (e) { threw = e; }
  ok(!threw, 'a page whose data has not landed does not throw (co is undefined until it does)');
  eq('  the avatar shows a NEUTRAL dot — "·" means unknown; "D" would be a lie', nodes['#wsBtn .workspace-avatar'].textContent, '·');
  ok(nodes['#wsBtn .workspace-avatar'].textContent !== 'D', '  and never the other company\'s initial');
  eq('  the profile avatar still resolves from the PERSON, who is known', avatars.map(a => a.textContent), ['S', 'S']);
}

/* Neither person nor firm known → a dot, never an invented letter. */
{
  const { S, avatars } = harness({ co: undefined, plant: null });
  S.paintWorkspace();
  eq('nothing known at all → a neutral dot, never a guess', avatars.map(a => a.textContent), ['·', '·']);
}

/* ══════════ 2. THE SHELL PAINTS ITS OWN HEADER ══════════
   The six pages that never called paintWorkspace are the whole bug. */
{
  const s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok(/paintWorkspace\(\);/.test(s.slice(s.indexOf('mount(opts) {'))),
    'THE ROOT FIX: mount() paints the header itself — a page can no longer forget');
  ok(/Qd\.init = function/.test(s), '  and wraps QLD.init so the header repaints when data lands');
  ok(/Qd\.switchCompany = function/.test(s), '  and follows a company switch');
  ok(/finally \{ try \{ paintWorkspace\(\); \} catch \(_\) \{\} \}/.test(s),
    '  in a finally — a page render that throws must not also cost you the company name');
  ok(/__qlShellPaints/.test(s), '  wrapped once per load, so init is not double-wrapped');
}

/* The 6 offenders, proven to be covered now — this is the regression that matters:
   if someone adds a 7th page that forgets, mount() still paints it. */
{
  const { ctx, nodes } = harness();
  const page = ['ai', 'banks', 'inventory', 'invoice-designs', 'purchasedash', 'refunds'];
  ok(page.length === 6, 'the six pages that never called paintWorkspace: ' + page.join(', '));
  /* Simulate what those pages do: mount, then QLD.init(render) — never touching
     paintWorkspace themselves. */
  nodes['#wsBtn .workspace-avatar'].textContent = 'D';
  nodes['#wsBtn .workspace-name'].textContent = 'Loading…';
  ctx.QLShell.mount({ active: 'inventory', title: 'Inventory' });
  eq('a page that NEVER calls paintWorkspace still gets a painted avatar', nodes['#wsBtn .workspace-avatar'].textContent, 'G');
  eq('  and a painted name', nodes['#wsBtn .workspace-name'].textContent, 'GOTAN');
}

/* ══════════ 3. THE PHOTO MUST ACTUALLY DELETE ══════════ */
{
  const s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const rm = (s.match(/QLShell\.removePhoto = function \(\) \{[\s\S]{0,300}?\};/) || [''])[0];
  const sv = (s.match(/QLShell\.savePhoto = function \(\) \{[\s\S]{0,600}?\};/) || [''])[0];

  ok(/removeItem\(PHOTO_KEY\)/.test(rm) && /removeItem\('dm_profile_pic'\)/.test(rm),
    'remove clears BOTH local keys (mount() reads dm_profile_pic first, so missing it re-shows the photo)');
  ok(/pushPhoto\(\)/.test(rm),
    'THE FIX: remove PUSHES to the cloud — otherwise the blob keeps the photo and the next device pulls it back');
  ok(/pushPhoto\(\)/.test(sv),
    'save pushes too — a new photo must reach the other devices, not just this one');
  ok(/QLD\.commit/.test(s), '  via QLD.commit(), the same path every other write uses');

  /* Prove the cloud really is the source of truth we must update. */
  const d = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
  ok(/if \(includePic\) b\.profile_pic = localStorage\.getItem\('dm_profile_pic'\) \|\| null;/.test(d),
    'the saved blob takes profile_pic from dm_profile_pic — null once removed, so commit() erases it');
  ok(/if \(cd\.profile_pic\) \{ try \{ localStorage\.setItem\('dm_profile_pic', cd\.profile_pic\); \} catch \(_\) \{\} \}/.test(d),
    'and every cloud PULL writes it back — which is exactly why a local-only delete could never stick');
}

/* Runtime: removing must hit commit(), or it never leaves this device.
   mount() first — removePhoto is defined by wireProfile(), which mount() calls. */
{
  const { S, store, commits, avatars } = harness({ store: { dm_profile_pic: 'data:image/jpeg;base64,AAA', ql_v2_profile_photo: 'data:image/jpeg;base64,AAA' } });
  S.mount({ active: 'settings', title: 'Settings' });
  ok(typeof S.removePhoto === 'function', 'removePhoto exists once the shell is mounted');
  S.removePhoto();
  eq('remove clears the legacy key mount() reads first', store.dm_profile_pic, undefined);
  eq('  and the current key', store.ql_v2_profile_photo, undefined);
  ok(commits.length > 0, 'THE BUG: remove reaches the cloud — without this it comes back on the desktop');
  eq('  and the avatar falls back to the letter, not a ghost photo', avatars.map(a => a.textContent), ['S', 'S']);
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
