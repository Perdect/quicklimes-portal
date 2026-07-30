/* color-tokens.test.js — a colour that HAS a token must use the token.
 *
 * THE DEBT. The audit measured 134 hardcoded hex colours in JS and hundreds
 * more in CSS — #2563eb 48×, #16a34a 26×, #dc2626 29×, #64748b 28× — every one
 * of which is an exact token value (--ql-brand-600, --ql-success-600, …). Same
 * colour, spelled a dozen literal ways, is the definition of "random colours".
 *
 * P0.3 replaced the STANDALONE hex in CSS with their tokens. This was SAFE with
 * zero rendering change: it only targets the theme-CONSTANT raw scale (neutral-N,
 * brand-N, success-N …), which is identical in light and dark — so nothing moved,
 * it's just named now. (The theme-VARIABLE aliases like --ql-text are deliberately
 * NOT targets: swapping a hardcoded #0f172a on the always-light PDF document for
 * an adapting token would turn its text white in dark mode.)
 *
 * This test fails if any theme-constant token's hex value reappears STANDALONE
 * in CSS (a `var(--token, #hex)` FALLBACK is allowed — the token still wins).
 *
 * SCOPE: CSS files. Hex in JS (some in canvas/chart contexts where var() is
 * invalid) is P0.3b.
 *
 *   node color-tokens.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ❌  ' + m); } };

console.log('\n═══ design tokens · a colour with a token uses the token ═══\n');

const tk = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8');

/* theme-variable tokens (re-defined in the dark block) are NOT replacement
   targets — exclude them so the map holds only theme-constant colours. */
const darkBlock = (tk.match(/\[data-theme="dark"\][^{]*\{([\s\S]*?)\n\}/) || [, ''])[1];
const darkNames = new Set([...darkBlock.matchAll(/(--ql-[a-z0-9-]+):/g)].map(m => m[1]));

const hex2tok = {};
for (const m of tk.matchAll(/(--ql-[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\b/g)) {
  if (darkNames.has(m[1])) continue;
  const h = m[2].toLowerCase();
  if (!(h in hex2tok)) hex2tok[h] = m[1];
}
ok(Object.keys(hex2tok).length >= 20, `built the theme-constant hex→token map (${Object.keys(hex2tok).length})`);

/* For each mapped hex, assert no STANDALONE occurrence in any CSS (fallbacks OK). */
const cssFiles = fs.readdirSync(__dirname).filter(f => f.endsWith('.css') && f !== 'tokens.css');
let offenders = [];
for (const [hex, tok] of Object.entries(hex2tok)) {
  for (const f of cssFiles) {
    const css = fs.readFileSync(path.join(__dirname, f), 'utf8');
    // occurrences of the hex NOT preceded by ", " inside a var() fallback
    const re = new RegExp(hex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    for (const m of css.matchAll(re)) {
      const before = css.slice(Math.max(0, m.index - 40), m.index);
      if (!/var\([^)]*,\s*$/.test(before)) { offenders.push(`${f}: ${hex} (should be var(${tok}))`); break; }
    }
  }
}
ok(offenders.length === 0, 'no theme-constant token colour appears STANDALONE in CSS'
  + (offenders.length ? '\n     ' + offenders.slice(0, 8).join('\n     ') : ''));

/* the tokens actually landed (replacement, not deletion) */
let uses = 0;
for (const f of cssFiles) uses += (fs.readFileSync(path.join(__dirname, f), 'utf8').match(/var\(--ql-(neutral|brand|success|danger|warning|info)-\d+\)/g) || []).length;
ok(uses >= 150, `raw-scale colour tokens are used across components (${uses})`);

console.log(fail ? `\n❌ FAILED — ${fail}\n` : `\n✅ PASSED — ${pass} checks; colours with a token use the token\n`);
process.exit(fail ? 1 : 0);
