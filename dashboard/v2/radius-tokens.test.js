/* radius-tokens.test.js — every corner radius comes from the token scale.
 *
 * THE DEBT THIS CLOSES. The audit measured 20 distinct border-radius values in
 * the CSS (2,3,5,6,7,8,9,10,11,12,13,14,15,16,18,20,22,24,99,999 px) — 17 uses
 * of 7px, 33 of 9px, 21 of 11px, none of them tokens. That is the "inconsistent
 * by 1px" drift: the same visual role rounded three slightly different ways.
 *
 * They are now collapsed onto ONE scale in tokens.css:
 *   xs 4 · sm 6 · md 8 · lg 8 · xl 10 · 2xl 12 · 3xl 14 · 4xl 16 · 5xl 20 · pill.
 * This test fails the moment a NEW single-value hardcoded px radius appears, so
 * the scale stays the source of truth instead of drifting again.
 *
 * Multi-value radii (e.g. `12px 12px 0 0` for top-only rounding) are allowed to
 * stay literal — they express a shape a single token can't, and there are only
 * a handful. They are counted and capped so they can't quietly multiply.
 *
 *   node radius-tokens.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ❌  ' + m); } };

console.log('\n═══ design tokens · every radius is on the scale ═══\n');

/* 1. the scale is defined, once, in tokens.css */
const tokens = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8');
for (const t of ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', 'pill']) {
  ok(new RegExp('--ql-radius-' + t.replace(/[^a-z0-9]/g, m => '\\' + m) + ':').test(tokens),
    `tokens.css defines --ql-radius-${t}`);
}

/* 2. no CSS file carries a SINGLE-VALUE hardcoded px radius any more.
   Single-value = `border-radius: Npx;` or `...Npx}` (a digit-then-space, i.e.
   a multi-value list, is deliberately NOT matched). */
const single = /border-radius:\s*\d+px\s*[;}]/g;
const multi = /border-radius:\s*\d+px\s+\d/g;   // the allowed partial-rounding form
let offenders = [], multiCount = 0;
for (const f of fs.readdirSync(__dirname)) {
  if (!f.endsWith('.css') || f === 'tokens.css') continue;
  const css = fs.readFileSync(path.join(__dirname, f), 'utf8');
  const hits = css.match(single) || [];
  if (hits.length) offenders.push(f + ': ' + hits.slice(0, 4).join(' · '));
  multiCount += (css.match(multi) || []).length;
}
ok(offenders.length === 0, 'no single-value hardcoded px radius remains in any CSS'
  + (offenders.length ? '\n     ' + offenders.join('\n     ') : ''));

/* 3. the escape hatch (multi-value literals) stays small — a cap, not a ban. */
ok(multiCount <= 10, `multi-value literal radii stay few (${multiCount} ≤ 10) — they don't creep back into drift`);

/* 4. token radii ARE used (the replacement actually landed, not just deleted). */
let tokenUses = 0;
for (const f of fs.readdirSync(__dirname)) {
  if (!f.endsWith('.css')) continue;
  tokenUses += (fs.readFileSync(path.join(__dirname, f), 'utf8').match(/border-radius:\s*var\(--ql-radius-/g) || []).length;
}
ok(tokenUses >= 250, `the scale is actually used across components (${tokenUses} token radii)`);

console.log(fail ? `\n❌ FAILED — ${fail}\n` : `\n✅ PASSED — ${pass} checks; every radius is on the token scale\n`);
process.exit(fail ? 1 : 0);
