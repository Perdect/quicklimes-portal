/* nav-targets.test.js — no navigation item may lead to a blank page.
 *
 * THE BUG. The "Attendance" item pointed at attendance.html, a 0-byte file,
 * and was NOT flagged `soon`. So it rendered as a live link and clicking it
 * dropped the user on a blank white page with no shell and no way back but the
 * browser button. It looked exactly like every working link.
 *
 * THE RULE. Every nav item is one of two things:
 *   • a real page  → the .html file exists AND is non-empty, or
 *   • not built yet → href is the SOON sentinel AND soon:true.
 * Anything else — a live href to a missing or empty file — is a dead end and
 * fails here, on the day it is introduced.
 *
 *   node nav-targets.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');
const V2 = __dirname;
const shell = fs.readFileSync(path.join(V2, 'shell.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ❌  ' + m); } };

console.log('\n═══ nav · every item leads somewhere real ═══\n');

const SOON = '#soon';   // must match `const SOON` in shell.js
ok(shell.includes("const SOON = '#soon'"), "SOON sentinel is still '#soon' (assumption of this test)");

/* Pull every nav item object: { id, label, href, ... }. */
const items = [];
const re = /\{\s*id:\s*'([^']+)',\s*label:\s*'([^']*)',\s*href:\s*([^,]+),([^}]*)\}/g;
let m;
while ((m = re.exec(shell)) !== null) {
  const [, id, label, hrefRaw, rest] = m;
  const soon = /\bsoon:\s*true/.test(rest);
  // href is either the SOON identifier or a quoted string
  const href = hrefRaw.trim() === 'SOON' ? SOON : hrefRaw.trim().replace(/^['"]|['"]$/g, '');
  items.push({ id, label, href, soon });
}

ok(items.length >= 10, `parsed the nav items (${items.length})`);

let deadEnds = 0;
for (const it of items) {
  if (it.href === SOON || it.href === '#soon') {
    ok(it.soon, `"${it.label}" uses the SOON href AND is flagged soon:true`);
    continue;
  }
  if (!/\.html$/.test(it.href)) continue;   // external/other links not our concern here
  const p = path.join(V2, it.href);
  const exists = fs.existsSync(p);
  const nonEmpty = exists && fs.statSync(p).size > 0;
  if (!(exists && nonEmpty)) deadEnds++;
  ok(exists, `"${it.label}" → ${it.href} exists`);
  ok(nonEmpty, `"${it.label}" → ${it.href} is non-empty (not a 0-byte stub)`);
}

/* This assertion has flipped, on purpose. It used to pin Attendance as SOON
   because attendance.html was a 0-byte stub and a live link to a blank page
   is worse than a Soon badge. The page is now built (the marking grid over
   the same S.ATT the wages read), so the pin is the opposite: nothing in the
   nav may be parked on Soon any more, because every module now lands on a
   real page. If a future module is genuinely unfinished, park it on SOON and
   update this to name it — do not ship a live link to a stub. */
const soonItems = items.filter(i => i.soon || i.href === SOON || i.href === '#soon');
ok(soonItems.length === 0,
  'no nav item is parked on Soon — every module lands on a real page' +
  (soonItems.length ? ' (still parked: ' + soonItems.map(i => i.label).join(', ') + ')' : ''));
const att = items.find(i => i.id === 'attendance');
ok(att && att.href === 'attendance.html',
  'Attendance is a live link to the built attendance page');
const disp = items.find(i => i.id === 'dispatch');
ok(disp && disp.href === 'dispatch.html',
  'Dispatch is a live link to the built dispatch register');

console.log(fail ? `\n❌ FAILED — ${fail} (${deadEnds} dead-end links)\n`
                 : `\n✅ PASSED — ${pass} checks; no nav item leads to a blank page\n`);
process.exit(fail ? 1 : 0);
