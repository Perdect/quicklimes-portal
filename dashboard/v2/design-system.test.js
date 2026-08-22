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
/* attendance.html is a deliberate 0-byte stub — the nav already marks it
   "Soon" and routes it to SOON rather than to the file. An empty file is not
   a page with a design problem, so it is not scanned. */
const pages = fs.readdirSync(DIR).filter(f =>
  f.endsWith('.html') && !f.startsWith('_preview') &&
  fs.statSync(path.join(DIR, f)).size > 0);
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
    /* The legacy TYPOGRAPHY can outlive the legacy wrapper: settings and help
       had no page-head at all, just `<h1 class="page-title">` inside their own
       intro block. Same drift, one level down. */
    if (/class="page-title"/.test(code)) offenders.push(p + ' (page-title)');
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

/* ── 6. EVERY PAGE'S INLINE SCRIPT STILL PARSES ──────────────────────────
   finance.html has TWO </body> tags: the real one, and one inside a JS
   template literal that builds a print-popup document. A mount block
   inserted before the FIRST terminated the page's script mid-function, and
   the rest of the JavaScript rendered onto the screen as text. The markup
   looked fine, the design-system checks passed, and the page was ruined.

   Parsing each inline block catches it in a second. */
{
  const broken = [];
  for (const p of pages) {
    const html = src[p];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    let m, n = 0;
    while ((m = re.exec(html))) {
      n++;
      const code = m[1];
      if (!code.trim()) continue;
      try {
        /* Parse only — never run. Wrapped in an async body so a top-level
           await is legal, and so a page that legitimately uses one is not
           reported as broken. */
        new Function('return (async () => {' + code + '\n})');
      } catch (e) {
        broken.push(p + ' [block ' + n + ']: ' + e.message);
      }
    }
  }
  ok('every inline <script> on every page parses as JavaScript' +
     (broken.length ? '\n       ' + broken.join('\n       ') : ''),
     broken.length === 0);
}

/* ── 7. THE CLOSING </body> IS THE LAST THING ON THE PAGE ────────────────
   The direct cause above. If a page's final </body> is not the real one,
   anything appended to "the end of the body" lands inside a string. */
{
  const odd = [];
  for (const p of pages) {
    const html = src[p];
    const last = html.lastIndexOf('</body>');
    if (last < 0) { odd.push(p + ' (no </body>)'); continue; }
    const after = html.slice(last + 7).replace(/\s|<\/html>/g, '');
    if (after) odd.push(p + ' (content after the final </body>)');
  }
  ok('nothing follows the final </body> except </html>' +
     (odd.length ? '\n       ' + odd.join(', ') : ''), odd.length === 0);
}

/* ── 8. THE HEADER MUST EXIST BEFORE render() RUNS ───────────────────────
   QLD.init(render) calls render() DURING script execution when the data is
   already cached — before DOMContentLoaded. A header mounted only on that
   event does not exist yet, so a render() that writes into it (every one of
   these pages writes its subtitle) throws and aborts before filling the
   page body. The header looked perfect and everything under it was gone.

   So: the mount must be called synchronously, not only from a listener. */
{
  const late = [];
  for (const p of pages) {
    const html = src[p];
    if (!/QLX\.heroHTML\(cfg\)/.test(html)) continue;
    /* A bare go() call outside the listener — that is the synchronous mount. */
    const sync = /\n\s*go\(\);/.test(html);
    if (!sync) late.push(p);
  }
  ok('every shared header mounts synchronously, not only on DOMContentLoaded' +
     (late.length ? '\n       waits for the event: ' + late.join(', ') : ''),
     late.length === 0);
}

/* ── 9. THE PRIMARY BUTTON MUST BE VISIBLE ───────────────────────────────
   .qx-btn-primary is `background: var(--qx-grad); color: #fff`. The accent
   variables were defined only under `.qx`, which held while the chrome lived
   inside a mounted register — but any page can render the shared header now,
   and a page without that wrapper got NO accent, so its primary action was
   white text on nothing. On Banks, "Import statement" was invisible: present
   in the DOM, correct in the markup, unreadable on screen. */
{
  const qlx = fs.readFileSync(path.join(DIR, 'qlx.css'), 'utf8');
  ok('the accent variables default at :root, so a primary button is never colourless',
     /:root,\s*\.qx\s*\{[^}]*--qx-grad:/.test(qlx));

  /* Belt and braces: a page that renders the chrome should still carry the
     accent wrapper, so a module accent (.qx-a-green etc.) has something to
     attach to. */
  const missing = [];
  for (const p of pages) {
    const code = codeOf(p);
    if (!/QLX\.(heroHTML|statsHTML)\s*\(/.test(code)) continue;
    /* The wrapper may be built in the sibling script (ledger renders its whole
       page from JS), so check the page's full code, not just its markup. */
    if (!/class="[^"]*\bqx\b[^"]*"/.test(code)) missing.push(p);
  }
  ok('every page rendering QLX chrome carries the accent wrapper' +
     (missing.length ? '\n       missing .qx: ' + missing.join(', ') : ''),
     missing.length === 0);
}

console.log('\n════ design system (one header, one stat row, everywhere) ════');
console.log('  Pages scanned: ' + pages.length);
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' DESIGN-SYSTEM CHECKS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
