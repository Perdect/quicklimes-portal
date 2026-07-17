/* mobile-wired.test.js — every mobile class must be APPLIED by something.
 *
 * THE BUG THIS EXISTS FOR is the one that keeps reaching production here:
 * built, but never connected. Not wrong — ABSENT. It survives code review
 * (the code is right there) and it survives a green suite (nothing asserts
 * on a class nobody sets). It is only visible by USING the app, which is how
 * it keeps becoming the owner's job to find:
 *
 *   · purchase.css      — 207 lines, loaded by NOBODY. The freight cell shipped
 *                         with the browser's default grey button.
 *   · .ql-ai-mic.rec    — styled a class no code applies; wireVoice sets `.on`.
 *   · paintWorkspace()  — defined, called by 24 of 30 pages. Six showed "D".
 *   · hideSplash()      — called, with no markup to hide.
 *
 * orphan-css.test.js catches a whole stylesheet nobody links. It says out loud
 * that it "cannot catch every dead class" — this is that gap. A .qlm-* rule
 * that nothing ever puts on an element is CSS written into the void.
 *
 * DYNAMIC CLASSES ARE REAL: mobile.js builds `qlm-tint-${o.tint}`, so the
 * literal "qlm-tint-violet" appears in no JS file. A test that demanded exact
 * literals would fail on correct code and get itself weakened or deleted —
 * so a prefix that is interpolated counts as applied.
 *
 *   node mobile-wired.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ mobile · every styled class is actually applied ═══\n');

const dir = __dirname;
const css = fs.readFileSync(path.join(dir, 'mobile.css'), 'utf8');

/* Anything that can put a class on an element: the mobile chrome, the shell,
   the QLX engine, the dashboard, and the pages themselves. */
const appliers = ['mobile.js', 'shell.js', 'qlx.js', 'dashboard.js', 'bulk.js', 'purchase.js', 'sales.js']
  .filter(f => fs.existsSync(path.join(dir, f)))
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
  .concat(fs.readdirSync(dir).filter(f => f.endsWith('.html'))
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8')))
  .join('\n');

/* Strip comments first — a class named only inside a /* … *​/ note is NOT applied.
   Without this the file's own explanatory prose would vouch for dead code, which
   is precisely the mistake that read "Read quantities: 1" as a live button. */
const code = appliers.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/* Every .qlm-* selector mobile.css defines. */
const defined = new Set();
(css.replace(/\/\*[\s\S]*?\*\//g, ' ').match(/\.qlm-[a-z0-9-]+/g) || [])
  .forEach(c => defined.add(c.slice(1)));
ok(defined.size > 25, 'found the mobile classes (' + defined.size + ')');

/* State classes are toggled by name (classList.add('open')), never written as
   the compound "qlm-sheet-back open" — so they are proven by their base class. */
const STATE = new Set(['qlm-page-in']);   // applied by name; asserted explicitly below

/* ── The ratchet ─────────────────────────────────────────────────
   Dead CSS that was ALREADY here. It is listed, not tolerated: the list may
   only ever SHRINK, and a class that leaves this file must be deleted from
   mobile.css or wired — never quietly re-added.

   Why a list instead of deleting them now: each one is a judgement the owner
   should make, not a cleanup smuggled into a redesign.
     · qlm-h-co        the header company chip. paintCo() is `function(){}` —
                       an EMPTY FUNCTION. The chip was removed; its CSS stayed.
                       Switching companies still works, from the More sheet.
     · qlm-chip(s)     a filter-pill system nothing renders. Deliberately NOT
                       revived: the owner said "use same date filter as second
                       image no need to change design", and "One month picker,
                       not five" is a commit in this repo. Pills would be the
                       second picker.
     · qlm-card*       a generic card list superseded by .qlm-act / .qlm-kpi.
     · qlm-review-row  belongs to wizard(), which has ZERO callers (mobile.js
                       :365 defines it; nothing invokes it).
     · qlm-tab-dot     a bottom-nav unread dot nothing ever sets.
   A NEW dead class is a hard failure — that is the point of the ratchet. */
const KNOWN_DEAD = new Set([
  'qlm-h-co', 'qlm-chips', 'qlm-chip', 'qlm-tab-dot', 'qlm-review-row',
  'qlm-cardlist', 'qlm-card', 'qlm-card-top', 'qlm-card-ttl', 'qlm-card-amt',
  'qlm-card-sub', 'qlm-card-meta'
]);

function applied(cls) {
  if (code.includes(cls)) return true;
  /* Built by interpolation? `qlm-tint-${o.tint}` proves qlm-tint-violet. */
  const seg = cls.split('-');
  for (let i = seg.length - 1; i >= 2; i--) {
    const pre = seg.slice(0, i).join('-') + '-';
    if (new RegExp(pre.replace(/[-]/g, '\\-') + '\\$\\{').test(code)) return true;
  }
  return false;
}

const dead = [...defined].filter(c => !applied(c) && !STATE.has(c));
const fresh = dead.filter(c => !KNOWN_DEAD.has(c));
ok(fresh.length === 0,
  'NO NEW dead mobile class — every .qlm-* rule added since the ratchet reaches an element.' +
  (fresh.length ? '\n     NEW DEAD (' + fresh.length + '): ' + fresh.join(', ') +
   '\n     Styles nothing can ever show. Wire them or delete them — do not add them to KNOWN_DEAD.' : ''));

/* The ratchet must only tighten. A class that got wired (or deleted) has to
   leave KNOWN_DEAD, or the list rots into a permanent excuse and stops
   meaning anything — which is how the debt got here in the first place. */
{
  const stale = [...KNOWN_DEAD].filter(c => !dead.includes(c));
  ok(stale.length === 0,
    'the known-dead list is honest — nothing in it is already fixed' +
    (stale.length ? '\n     STALE: ' + stale.join(', ') + ' — now live or gone. Remove from KNOWN_DEAD.' : ''));
  console.log('     (known dead CSS carried: ' + KNOWN_DEAD.size + ' classes — this number must only go down)');
}

/* ── The new native controls: named, so a rename cannot quietly orphan them ── */
[
  ['qlm-act', 'the action card (icon · title · subtitle · chevron)'],
  ['qlm-act-ic', '  its icon tile'],
  ['qlm-act-ch', '  its chevron'],
  ['qlm-group', 'the grouped settings-style list'],
  ['qlm-field', 'the floating-label form field'],
  ['qlm-ripple', 'the button ripple']
].forEach(([c, what]) => ok(applied(c), what + ' — .' + c + ' is applied by real code, not just defined'));

/* qlm-page-in is added by JS at mount; assert the CALLER, not the definition.
   "It exists" is the claim that has been wrong every single time. */
{
  const mjs = fs.readFileSync(path.join(dir, 'mobile.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok(/classList\.add\(\s*['"]qlm-page-in['"]/.test(mjs),
    'the page-in animation is ADDED by mobile.js — an @keyframes nothing triggers is decoration');
}

/* ── Mutation proof: this checker must be able to fail ── */
{
  const probe = 'qlm-probe-not-real-' + 'zz';
  ok(!applied(probe), 'the checker CAN fail — an unapplied class is detected (probe)');
  ok(applied('qlm-tint-violet'),
    '  and does NOT false-alarm on interpolated classes (qlm-tint-${o.tint} proves qlm-tint-violet)');
}

/* The gradient must be a token, used. Six hand-rolled purples is how it rots. */
{
  const grad = (css.match(/linear-gradient\(135deg,\s*var\(--qlm-violet\)/g) || []).length;
  ok(/--qlm-grad:/.test(css), 'the gradient is defined ONCE as --qlm-grad');
  ok(grad <= 1, '  and not re-declared per call site (found ' + grad + ' literal copies; 1 = the token itself)');
  ok((css.match(/var\(--qlm-grad\)/g) || []).length >= 3, '  and every gradient control consumes the token');
}

/* The FAB stays dead. He asked for its removal repeatedly ("I told you 100 times
   remove this icon"); the reference design that prompted this redesign shows one.
   The owner's standing instruction beats the reference. */
{
  const s = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok(!/\.qlm-fab\b/.test(s), 'NO FAB styles came back with the redesign — he removed it on purpose');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
