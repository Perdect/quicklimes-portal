/* ═══════════════════════════════════════════════════════════════════════
   ONE DESIGN SYSTEM, NOT TWENTY COPIES.

   Every page used to hand-write its own header and its own KPI strip. Seven
   pages carried seven copies of the same `<div class="kpi-tile">…` template
   string. That is why the app looked like it was built by different people:
   nothing forced the copies to agree, so they drifted.

   The header and stat row now live in ONE place (QLX.heroHTML /
   QLX.statsHTML). This file exists so they stay there.

   It also pins the failure that actually shipped: purchasedash.html called
   QLX.heroHTML while never loading qlx.js. The guard that was meant to add
   the script matched the words "qlx.js" inside a COMMENT, decided the tag
   was present, and skipped it. The page rendered completely blank. Markup
   that looks right and a missing dependency is exactly the shape of bug a
   visual check waves through.

     node design-system.test.js
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0; const bad = [];
const ok = (m, c) => { if (c) pass++; else { fail++; bad.push(m); } };

const DIR = __dirname;
const pages = fs.readdirSync(DIR).filter(f => f.endsWith('.html') && !f.startsWith('_preview'));
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const src = {};
for (const p of pages) src[p] = read(p);

/* Page scripts may be inline or in a sibling .js — check both. */
function codeOf(page) {
  const js = page.replace(/\.html$/, '.js');
  return src[page] + (fs.existsSync(path.join(DIR, js)) ? fs.readFileSync(path.join(DIR, js), 'utf8') : '');
}

/* ── 1. NOBODY HAND-ROLLS THE CHROME ANY MORE ────────────────────────────── */
{
  const offenders = [];
  for (const p of pages) {
    const code = codeOf(p);
    /* The legacy markup, in the templates that GENERATE it. A page that still
       builds `<div class="kpi-tile">` or `<div class="page-head">` is a page
       that will drift away from the rest. */
    if (/<div class="kpi-tile"/.test(code)) offenders.push(p + ' (kpi-tile)');
    if (/<div class="page-head"/.test(code)) offenders.push(p + ' (page-head)');
  }
  ok('no page hand-writes a KPI tile or a page header — they come from QLX' +
     (offenders.length ? '\n       still doing it: ' + offenders.join(', ') : ''),
     offenders.length === 0);
}

/* ── 2. A PAGE THAT USES THE SHARED CHROME MUST ACTUALLY LOAD IT ──────────
   The purchasedash failure, pinned. Calling QLX.* without the script tag is
   a blank page, and the markup gives no hint that anything is wrong. */
{
  const missingJs = [], missingCss = [];
  for (const p of pages) {
    const code = codeOf(p);
    if (!/QLX\.(heroHTML|statsHTML|wireHero|tint)\s*\(/.test(code)) continue;
    if (!/<script src="\.?\/?qlx\.js\?v=/.test(src[p])) missingJs.push(p);
    if (!/qlx\.css\?v=/.test(src[p])) missingCss.push(p);
  }
  ok('every page calling QLX chrome loads qlx.js' +
     (missingJs.length ? '\n       missing the script tag: ' + missingJs.join(', ') : ''),
     missingJs.length === 0);
  ok('every page calling QLX chrome loads qlx.css' +
     (missingCss.length ? '\n       missing the stylesheet: ' + missingCss.join(', ') : ''),
     missingCss.length === 0);
}

/* ── 3. THE CHROME IS STILL EXPORTED, AND IS STILL ONE IMPLEMENTATION ───── */
{
  const qlx = fs.readFileSync(path.join(DIR, 'qlx.js'), 'utf8');
  ok('QLX exports the page chrome for non-register pages',
     /heroHTML:\s*heroMarkup/.test(qlx) && /statsHTML:\s*statsMarkup/.test(qlx) &&
     /\bwireHero\b/.test(qlx) && /tint:\s*tintOf/.test(qlx));
  ok('the registers render THE SAME header — heroHTML() delegates to heroMarkup',
     /function heroHTML\(\)\s*\{\s*return heroMarkup\(CFG\);\s*\}/.test(qlx));
  ok('the registers render THE SAME stat row — statsHTML() delegates to statsMarkup',
     /function statsHTML\(\)[\s\S]{0,160}?statsMarkup\(/.test(qlx));
  /* skeleton() legitimately mirrors both shapes for the loading state — it
     holds no content, only grey blocks. So: exactly two occurrences of each,
     one of which is the skeleton. More than that is a real second
     implementation. */
  const skel = (() => {
    const i = qlx.indexOf('function skeletonHTML(');
    if (i < 0) return '';
    const open = qlx.indexOf('{', i);
    let j = open + 1, d = 1;
    while (j < qlx.length && d > 0) { const c = qlx[j]; if (c === '{') d++; else if (c === '}') d--; j++; }
    return qlx.slice(i, j);
  })();
  const outside = qlx.replace(skel, '');
  ok('exactly ONE qx-hero template outside the loading skeleton',
     (outside.match(/<div class="qx-hero">/g) || []).length === 1);
  ok('exactly ONE qx-stats template outside the loading skeleton',
     (outside.match(/<div class="qx-stats">/g) || []).length === 1);
  ok('the loading skeleton mirrors both shapes, so the page does not jump',
     /qx-hero/.test(skel) && /qx-stats/.test(skel));
}

/* ── 4. A MISSING HEADER MUST NOT TAKE THE PAGE DOWN ──────────────────────
   The header is decoration; the register beneath it is the product. */
{
  const unguarded = [];
  for (const p of pages) {
    const s = src[p];
    if (!/QLX\.heroHTML\(cfg\)/.test(s)) continue;          // only the mount blocks
    if (!/if \(!window\.QLX \|\| !QLX\.heroHTML\)/.test(s)) unguarded.push(p);
  }
  ok('a page whose chrome fails to load still renders its own content' +
     (unguarded.length ? '\n       unguarded: ' + unguarded.join(', ') : ''),
     unguarded.length === 0);
}

/* ── 5. ICONS: BOTH CONVENTIONS, ONE COMPONENT ───────────────────────────
   The registers pass path bodies; migrated pages pass whole <svg> strings.
   Accepting both is what let those pages keep the icon sets they already had
   instead of having them rewritten for a visual change. */
{
  const qlx = fs.readFileSync(path.join(DIR, 'qlx.js'), 'utf8');
  ok('the shared chrome accepts a path body OR a complete <svg>',
     /function icon\(x\)/.test(qlx) && /\^\\s\*<svg\[\\s>\]/.test(qlx));
}

console.log('\n════ design system (one header, one stat row, everywhere) ════');
console.log('  Pages scanned: ' + pages.length);
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' DESIGN-SYSTEM CHECKS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
