/* type-tokens.test.js — every standalone font-size comes from the type scale.
 *
 * THE DEBT. The audit measured 28 distinct font-size px values in the CSS,
 * including ~180 HALF-PIXEL sizes (9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5) —
 * the same text role rendered a fraction of a pixel apart across components.
 *
 * All standalone `font-size:` declarations are now snapped to the token scale
 * in tokens.css (2xs 10 · xs 11 · sm 12 · base 13 · md 14 · lg 16 · xl 18 ·
 * 2xl 22 · 3xl 28 · 4xl 32). This fails the moment a NEW hardcoded px font-size
 * appears, so the scale stays the source of truth.
 *
 * SCOPE: standalone `font-size:` AND the `font:` shorthand (font: 700 11.5px …)
 * — both are now on the scale (P0.2 + P0.2b). Neither may carry a literal px
 * size again.
 *
 *   node type-tokens.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ❌  ' + m); } };

console.log('\n═══ design tokens · every font-size is on the type scale ═══\n');

/* 1. the scale is defined once */
const tokens = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8');
for (const t of ['2xs', 'xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl']) {
  ok(new RegExp('--ql-text-' + t + ':').test(tokens), `tokens.css defines --ql-text-${t}`);
}

/* 2. no standalone hardcoded px font-size remains in any CSS */
const standalone = /font-size:\s*[\d.]+px/g;
let offenders = [];
for (const f of fs.readdirSync(__dirname)) {
  if (!f.endsWith('.css') || f === 'tokens.css') continue;
  const hits = fs.readFileSync(path.join(__dirname, f), 'utf8').match(standalone) || [];
  if (hits.length) offenders.push(f + ': ' + hits.slice(0, 4).join(' · '));
}
ok(offenders.length === 0, 'no standalone hardcoded px font-size remains'
  + (offenders.length ? '\n     ' + offenders.join('\n     ') : ''));

/* 3. the scale is actually used (replacement landed, not deleted) */
let uses = 0;
for (const f of fs.readdirSync(__dirname)) {
  if (!f.endsWith('.css')) continue;
  uses += (fs.readFileSync(path.join(__dirname, f), 'utf8').match(/font-size:\s*var\(--ql-text-/g) || []).length;
}
ok(uses >= 400, `the scale is used across components (${uses} token font-sizes)`);

/* 4. the `font:` shorthand carries NO literal px size either (P0.2b). */
let shorthand = 0;
for (const f of fs.readdirSync(__dirname)) {
  if (!f.endsWith('.css') || f === 'tokens.css') continue;
  shorthand += (fs.readFileSync(path.join(__dirname, f), 'utf8').match(/font:\s*\d+\s+[\d.]+px/g) || []).length;
}
ok(shorthand === 0, `the font: shorthand carries no literal px size (${shorthand} found) — the whole type scale is enforced`);

console.log(fail ? `\n❌ FAILED — ${fail}\n` : `\n✅ PASSED — ${pass} checks; every standalone font-size is on the type scale\n`);
process.exit(fail ? 1 : 0);
