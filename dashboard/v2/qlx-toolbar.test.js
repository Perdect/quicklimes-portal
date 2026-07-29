/* qlx-toolbar.test.js — the month/date filter lives in the TABLE toolbar, not
 * the page header. (register toolbar standard)
 *
 * THE UX RULE. Filters change table state, so they belong to the table. The
 * page header holds only the title and page actions (add/upload/export/AI). The
 * month filter used to sit in the hero header, forcing the eye between header
 * and table on every period change. It now opens the toolbar as the FIRST
 * element, and because the toolbar is sticky it stays visible while scrolling.
 *
 * QLX renders the toolbar for every register (Sales, Purchase, Payments,
 * Cashbook, TDS…), so this one change is the standard for all of them. Pinned
 * here so it can't silently drift back into the header.
 *
 *   node qlx-toolbar.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'qlx.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ❌  ' + m); } };

console.log('\n═══ register toolbar · the month filter is in the toolbar, not the header ═══\n');

const fnBody = name => {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  const open = src.indexOf('{', i);
  let j = open + 1, depth = 1;
  while (j < src.length && depth > 0) { const c = src[j]; if (c === '{') depth++; else if (c === '}') depth--; j++; }
  return src.slice(i, j);
};

const hero = fnBody('heroHTML');
const toolbar = fnBody('toolbarHTML');

/* 1. the header no longer renders the month button */
ok(!/QLShell\.monthButton/.test(hero), 'heroHTML (the page header) no longer renders the month button');
ok(/qx-hero-r">\$\{tools\}\$\{prim\}/.test(hero.replace(/\s+/g, '')) ||
   /\$\{tools\}\$\{prim\}/.test(hero), '  the header right side is just tools + primary action');

/* 2. the toolbar renders it, as the FIRST element */
ok(/QLShell\.monthButton\(\{ id: 'qxMonthBtn'/.test(toolbar), 'toolbarHTML renders the month button');
const ret = toolbar.slice(toolbar.indexOf('return `<div class="qx-tb">'));
const monthPos = ret.indexOf('${month}');
const tabsPos = ret.indexOf('${showTabs');
const searchPos = ret.indexOf('${search}');
ok(monthPos > 0, '  it appears in the toolbar markup');
ok(tabsPos === -1 || monthPos < tabsPos, '  BEFORE the status tabs (first element)');
ok(searchPos === -1 || monthPos < searchPos, '  and before search');

/* 3. the button id is unchanged, so the existing click wiring still finds it */
ok(/\$\('qxMonthBtn'\)\.onclick\s*=\s*e\s*=>\s*openMonthMenu/.test(src),
  'the qxMonthBtn click wiring is intact (id unchanged)');

/* 4. the toolbar is sticky, so the moved filter stays visible while scrolling */
const css = fs.readFileSync(path.join(__dirname, 'qlx.css'), 'utf8');
const tb = css.slice(css.indexOf('.qx-tb {'), css.indexOf('}', css.indexOf('.qx-tb {')));
ok(/position:\s*sticky/.test(tb) && /top:\s*0/.test(tb), 'the toolbar is sticky (top:0) — the month filter stays on screen');

console.log(fail ? `\n❌ FAILED — ${fail}\n` : `\n✅ PASSED — ${pass} checks; the month filter lives in the sticky toolbar, header-free\n`);
process.exit(fail ? 1 : 0);
