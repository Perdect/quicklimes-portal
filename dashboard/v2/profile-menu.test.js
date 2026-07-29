/* profile-menu.test.js — every row in the account menu must actually do something.
 *
 * THE BUG. Three of the six rows — Edit profile, Account settings, Help &
 * support — shipped as bare <button class="profile-menu-item"> with NO id.
 * Nothing could address them, so nothing was ever wired to them. Clicking did
 * nothing at all: the menu did not even close.
 *
 * WHY IT SURVIVED. They were indistinguishable from the working rows. Same
 * class, same markup shape, same cursor:pointer, sitting between two rows that
 * DID work (Change photo above, Working as below). There is no error, no
 * console warning, no visual difference — the only symptom is that a click has
 * no effect, which reads as a slow app rather than a dead control.
 *
 * So the assertion here is deliberately structural rather than per-item: EVERY
 * .profile-menu-item must have an id, and every one of those ids must be
 * referenced by a click handler. A seventh row added later without wiring
 * fails this file on the day it is added, not months later when someone
 * finally clicks it.
 *
 *   node profile-menu.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  ❌  ' + m); } };

console.log('\n═══ account menu · no row is decoration ═══\n');

const V2 = __dirname;
const shell = fs.readFileSync(path.join(V2, 'shell.js'), 'utf8');

/* Every menu row in the markup, with whatever id it carries. */
const rows = [];
const re = /<button class="profile-menu-item[^"]*"([^>]*)>([\s\S]*?)<\/button>/g;
let m;
while ((m = re.exec(shell)) !== null) {
  const attrs = m[1], inner = m[2];
  const idM = /\bid="([^"]+)"/.exec(attrs);
  const labelM = /<span>([\s\S]*?)<\/span>/.exec(inner);
  rows.push({
    id: idM ? idM[1] : null,
    label: (labelM ? labelM[1] : '').replace(/<[^>]*>/g, '').trim()
  });
}

ok(rows.length >= 6, `found the menu rows in shell.js (${rows.length})`);

console.log('\n── every row is addressable ──');
for (const r of rows) ok(!!r.id, `"${r.label}" has an id${r.id ? ' (' + r.id + ')' : ' — NOTHING CAN WIRE TO IT'}`);

console.log('\n── every row is wired ──');
/* A handler means the id is used somewhere OTHER than the markup line that
   declares it. Counting bare occurrences would pass on the id alone, which is
   exactly the state the bug was in. */
for (const r of rows) {
  if (!r.id) continue;
  const declared = `id="${r.id}"`;
  const withoutMarkup = shell.split(declared).join('');
  const referenced = withoutMarkup.includes(`'${r.id}'`) || withoutMarkup.includes(`"${r.id}"`);
  ok(referenced, `"${r.label}" (${r.id}) is referenced by code outside its own markup`);
}

/* The three that were dead, named explicitly. A future refactor that drops one
   of these rows should have to delete its assertion deliberately. */
console.log('\n── the three that were dead go somewhere real ──');
const dest = {
  pmEditProfile: 'settings.html#company',
  pmAccount: 'settings.html',
  pmHelp: 'help.html'
};
for (const [id, url] of Object.entries(dest)) {
  ok(shell.includes(`id="${id}"`), `${id} exists in the markup`);
  /* Match the wiring call itself — go($('pmX'), 'url'). Searching near the
     FIRST occurrence of the id finds the markup line, which is 400 lines above
     the handler, so that check passed on nothing. */
  const call = new RegExp(`go\\(\\s*\\$\\(\\s*['"]${id}['"]\\s*\\)\\s*,\\s*['"]${url.replace(/[.#]/g, '\\$&')}['"]\\s*\\)`);
  ok(call.test(shell), `  ${id} → ${url}`);
}

/* Help is a real page, not a link into nothing — the whole point of the fix. */
console.log('\n── the destinations exist ──');
ok(fs.existsSync(path.join(V2, 'help.html')), 'help.html exists');
ok(fs.existsSync(path.join(V2, 'settings.html')), 'settings.html exists');

const help = fs.existsSync(path.join(V2, 'help.html')) ? fs.readFileSync(path.join(V2, 'help.html'), 'utf8') : '';
ok(/QLShell\.mount\(/.test(help), '  help.html mounts the app shell (so it has nav and the account menu)');
ok(/<\/html>\s*$/.test(help), '  help.html is a complete document');

/* THE CLASSES IT BORROWS MUST BE DECLARED IN IT.
   help.html reuses settings.html's layout class names — .set-wrap, .set-intro,
   .set-ico, .set-grid. Those are declared inside settings.html's OWN <style>
   block, not in tokens/shell/pages.css, so using the names inherits nothing.
   The first build shipped without them: .set-ico had no box and the header SVG
   expanded to fill the entire content column. Every DOM assertion still passed
   — right card count, right FAQ count, no horizontal scroll — because nothing
   about it was structurally wrong. Only a screenshot showed it.

   Cheap rule: any set-* class help.html uses, help.html must also declare. */
const usedClasses = new Set();
for (const m2 of help.matchAll(/class="([^"]*)"/g))
  for (const c of m2[1].split(/\s+/)) if (/^set-/.test(c)) usedClasses.add(c);
const styleBlocks = [...help.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(x => x[1]).join('\n');
/* The class must be the SUBJECT of a rule — `.set-ico {` — not merely appear
   somewhere in a selector. A loose match passed on `.set-ico svg { }` alone,
   which leaves the chip itself unstyled. */
for (const c of [...usedClasses].sort())
  ok(new RegExp('^\\.' + c + '\\s*\\{', 'm').test(styleBlocks),
    `  help.html declares a base rule for .${c} (it is page-scoped in settings.html)`);
ok(/^\.set-ico\s*\{[^}]*width/m.test(styleBlocks),
  '  …and .set-ico has a width, so the icon chip is a fixed box');
ok(/^\.set-ico svg\s*\{[^}]*width/m.test(styleBlocks),
  '  …and .set-ico svg has one too — without it the header icon fills the page');

/* settings.html must honour the #company deep link, or "Edit profile" drops the
   user at the top of a long page with no sign of why they are there. */
const set = fs.readFileSync(path.join(V2, 'settings.html'), 'utf8');
console.log('\n── the deep link is handled at the other end ──');
ok(set.includes("location.hash !== '#company'"), 'settings.html reads the #company hash');
ok(/openCompanyDeepLink\(\)/.test(set.split('function openCompanyDeepLink')[1] || ''),
  '  …and openCompanyDeepLink is actually CALLED, not just defined');
ok((set.split('function openCompanyDeepLink')[1] || '').includes('editCo(c)'),
  '  …and it opens the company form');

/* ── THE DEEP-LINK FUNCTION, ACTUALLY RUN ──────────────────────────────────
   The checks above prove it is wired in. They do not prove it BEHAVES: that it
   opens the active firm, and that it stays shut for a non-owner — whose company
   card renderCo() has already hidden, so opening a form over it would offer an
   edit the server refuses.

   settings.html cannot be loaded against a static server (any 401 trips
   QLAuthLost and bounces to the login page), so the function is lifted out and
   driven here with stubs. */
const vm = require('vm');
console.log('\n── the deep link behaves, not just exists ──');
{
  const src = set.slice(set.indexOf('function openCompanyDeepLink'));
  const fnSrc = src.slice(0, src.indexOf('\n}') + 2);

  const run = (hash, isOwner, companies, activeKey) => {
    const calls = { edit: [], scrolled: 0 };
    const ctx = {
      location: { hash },
      _isOwner: () => isOwner,
      QLD: { COMPANIES: companies, co: activeKey ? { key: activeKey } : null },
      editCo: c => calls.edit.push(c && c.key),
      $: () => ({ scrollIntoView: () => { calls.scrolled++; } })
    };
    vm.createContext(ctx);
    vm.runInContext(fnSrc + '\nopenCompanyDeepLink();', ctx);
    return calls;
  };

  const COS = { gotan: { key: 'gotan' }, deshwali: { key: 'deshwali' } };

  let c = run('#company', true, COS, 'gotan');
  ok(c.edit.length === 1 && c.edit[0] === 'gotan', 'opens the ACTIVE firm, not merely the first one');
  ok(c.scrolled === 1, '  and scrolls the card into view');

  c = run('#company', true, COS, 'deshwali');
  ok(c.edit[0] === 'deshwali', '  follows the active firm when it changes');

  c = run('', true, COS, 'gotan');
  ok(c.edit.length === 0, 'does nothing without the #company hash (a plain Account settings visit)');

  c = run('#company', false, COS, 'gotan');
  ok(c.edit.length === 0, 'STAYS SHUT for a non-owner — renderCo has hidden the card they would be editing');

  c = run('#company', true, {}, null);
  ok(c.edit.length === 0, 'survives an account with no companies loaded yet');
}

console.log(fail ? `\n❌ FAILED — ${fail}\n` : `\n✅ PASSED — ${pass} checks; every account-menu row is wired\n`);
process.exit(fail ? 1 : 0);
