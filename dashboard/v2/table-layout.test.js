/* THE ENTERPRISE TABLE CONTRACT — one scroll container, one sticky system.

   The register tables shipped with TWO scroll systems: the toolbar and the
   totals strip stuck to the PAGE scrollport while the thead stuck to the
   wrap's. When the page scrolled, the pinned toolbar floated over the column
   header and the page-sticky footer floated over the wrap's bottom rows —
   the "content hidden behind the header / footer covers rows" screenshots.

   The contract now: ONE scroll container (.qx-grid-wrap) holds thead, rows
   AND the totals tfoot; heights are measured (sizeGrid), never magic. This
   suite pins the structure in the source and the css so a refactor cannot
   quietly reintroduce a second scroll system. */
'use strict';
const fs = require('fs');
const read = f => fs.readFileSync(__dirname + '/' + f, 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
let pass = 0, fail = 0; const bad = [];
const ok = (m, c) => { if (c) pass++; else { fail++; bad.push(m); } };

const js = strip(read('qlx.js'));
const css = strip(read('qlx.css'));

/* ── 1 · the footer lives INSIDE the table, inside the scroll container ── */
{
  ok('the totals bar renders as a <tfoot> inside .qx-grid', /<tfoot><tr><td class="qx-footcell"/.test(js));
  const line = js.split('\n').find(l => l.includes('qx-grid-wrap') && l.includes('<tfoot') === false && l.includes('return'));
  ok('the table template closes tfoot INSIDE the wrap (single scroll container)',
     /<tbody id="qxBody">\$\{body\}<\/tbody>\$\{foot\}<\/table><\/div>\$\{pagerHTML\(pg\)\}/.test(js));
  ok('no free-floating footer after the wrap any more', !/<\/div>\$\{foot\}\$\{pagerHTML/.test(js));
}

/* ── 2 · css: tfoot cell is the sticky-bottom element, strip pins left ── */
{
  const cell = (css.match(/\.qx-grid tfoot td\.qx-footcell \{[^}]*\}/) || [''])[0];
  ok('tfoot cell is sticky-bottom', /position: sticky/.test(cell) && /bottom: 0/.test(cell));
  ok('  with an opaque background (rows must never bleed through)', /background: var\(--ql-card\)/.test(cell));
  const stripCss = (css.match(/\n\.qx-foot \{[^}]*\}/) || [''])[0];
  ok('the strip pins LEFT so totals survive horizontal panning', /position: sticky/.test(stripCss) && /left: 0/.test(stripCss));
  ok('the old page-sticky footer is gone', !/\.qx-foot \{[^}]*bottom: 0/.test(css));
}

/* ── 3 · thead: sticky within the SAME container ── */
{
  const th = (css.match(/\.qx-grid thead th \{[^}]*\}/) || [''])[0];
  ok('thead th sticky top:0 (its scrollport IS the wrap)', /position: sticky/.test(th) && /top: 0/.test(th));
  ok('  solid background', /background: var\(--ql-card\)/.test(th));
  ok('the wrap is the one scroll container (x and y)', /\.qx-grid-wrap \{ max-height:[^}]*overflow: auto/.test(css));
}

/* ── 4 · measured heights, not magic numbers (§24: no blind constants) ── */
{
  ok('sizeGrid() measures the toolbar and everything below the wrap',
     /function sizeGrid\(\)/.test(js) && /doc\.scrollHeight - wrapBottomAbs/.test(js) && /window\.innerHeight - tbH - below/.test(js));
  ok('  releases the cap before measuring (no feedback loop)', /maxHeight = 'none'/.test(js));
  ok('  re-runs on refresh and on resize', /sizeGrid\(\); \}/.test(js) && /addEventListener\('resize'/.test(js));
  ok('  mobile keeps page scroll (cards-first)', /innerWidth < 769\) \{ wrap\.style\.maxHeight = ''/.test(js));
  ok('no z-index:9999-style hack anywhere in the engine css', !/z-index:\s*9{3,}/.test(css));
}

/* ── 5 · columns: floors, numeric discipline, a11y ── */
{
  ok('every data column gets a min-width floor (c.w overridable)', /min-width:\$\{mw\}px/.test(js) && /c\.w != null \? c\.w/.test(js));
  ok('action/serial columns exempt from the floor', /qx-sr|qx-act/.test((js.match(/const mw =[^;]*;/) || [''])[0]));
  ok('numeric cells right-aligned, never wrapped, tabular figures',
     /\.qx-grid th\.num, \.qx-grid td\.num \{ text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; \}/.test(css));
  ok('header cells carry scope="col"', /<th scope="col"/.test(js));
  ok('party names ellipsise instead of exploding the layout', /\.qx-party-n \{[^}]*text-overflow: ellipsis/.test(css));
}

/* ── 6 · empty state keeps the table header (§21) ── */
{
  ok('an empty result renders INSIDE tbody under the real thead',
     /if \(!rows\.length\) body = `<tr><td colspan="\$\{span\}">\$\{emptyBlock\(\)\}<\/td><\/tr>`;/.test(js));
}

/* ── 7 · grouping: a single group under a picked month adds nothing — skipped ── */
{
  ok('single-group-with-month renders rows without the redundant bar',
     /grouped && !\(groups\.length === 1 && S\.month && S\.month !== 'all'\)/.test(js));
}

/* ── 8 · the toolbar pins FLUSH with the pane edge on desktop ── */
{
  const shell = strip(read("shell.css"));
  ok("the pane padding is a named variable sticky children reference",
     /--ql-main-pad: var\(--ql-space-6\)/.test(shell) && /padding: var\(--ql-main-pad\)/.test(shell));
  ok("the register toolbar pins at the NEGATIVE pane pad on desktop — no exposed band above it",
     /@media \(min-width: 769px\) \{\s*\.qx-tb \{ top: calc\(-1 \* var\(--ql-main-pad/.test(css));
  ok("  while mobile (body scroll) keeps top: 0",
     /\.qx-tb \{ position: sticky; top: 0;/.test(css));
}

console.log('\n════ table layout (one scroll container, one sticky system) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' TABLE-LAYOUT TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
