/* monthlabel.test.js — "March 2026", written once.
 *
 * The Sales Register's month group header rendered "2026-03". The user asked for
 * "March". Turning that into a label is trivial; the trap is that FIVE places were
 * already building this same string by hand, so a sixth copy in sales.js was the
 * obvious move and the wrong one — that is precisely how one screen ends up saying
 * "March 2026" while the screen beside it says "2026-03". data.js owns it now and
 * reconcile.js / dashboard.js defer to it.
 *
 *   node monthlabel.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
// JSON-compare, not ===: two arrays are never === and this reported "got: [] expected: []" as a FAILURE.
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ month labels ═══\n');

/* The REAL function out of data.js. */
const i = src.indexOf('function monthLabel(ym, opts)');
ok(i > 0, 'data.js defines monthLabel');
const ctx = { console, Date, String, RegExp, isNaN };
vm.createContext(ctx);
vm.runInContext(src.slice(i, src.indexOf('\n  }', i) + 4) + '\nthis.monthLabel = monthLabel;', ctx);
const L = ctx.monthLabel;

/* ══════════ 1. WHAT THE USER ASKED FOR ══════════ */
{
  eq('a month reads as a MONTH, not "2026-03"', L('2026-03'), 'March 2026');
  eq('April', L('2026-04'), 'April 2026');
  eq('December of the previous year keeps its year', L('2025-12'), 'December 2025');
  eq('a full ISO date is accepted too (the group key is a date)', L('2026-03-31'), 'March 2026');
  eq('short form for tight chrome', L('2026-03', { short: true }), 'Mar 2026');
}

/* ══════════ 2. IT MUST NOT INVENT A MONTH ══════════
   These land in a GROUP HEADER, so a bad input is not a silent '' — the user reads
   it. "Invalid Date" as a heading is worse than no heading. */
{
  eq('month 99 does not exist', L('2026-99', { blank: 'No date' }), 'No date');
  eq('month 00 does not exist', L('2026-00', { blank: 'No date' }), 'No date');
  eq('month 13 does not exist', L('2026-13', { blank: 'No date' }), 'No date');
  eq('junk is not a month', L('hello', { blank: 'No date' }), 'No date');
  eq('blank', L('', { blank: 'No date' }), 'No date');
  eq('null does not throw', L(null, { blank: 'No date' }), 'No date');
  eq('undefined does not throw', L(undefined, { blank: 'No date' }), 'No date');
  eq('with no blank option, nothing is better than a lie', L('2026-99'), '');
  /* The specific trap: an invalid Date does NOT throw. toLocaleDateString returns
     the STRING "Invalid Date", so a try/catch never fires. My first version had a
     shape check and a catch, passed both, and still rendered "Invalid Date". */
  ok(!/Invalid/i.test(L('2026-99', { blank: 'No date' })), 'a bad month never renders the words "Invalid Date" as a heading');
}

/* ══════════ 3. TIMEZONE ══════════
   new Date('2026-03-01') is UTC midnight; west of Greenwich that renders as
   FEBRUARY. The '-01T00:00:00' suffix forces local parsing. A March invoice filed
   under February is a real, quiet accounting error. */
{
  ok(/T00:00:00/.test(src.slice(i, i + 700)),
    'monthLabel parses as LOCAL time — a bare "2026-03-01" is UTC and can render as February');
  eq('March is March', L('2026-03'), 'March 2026');
  eq('January is January (the year-boundary case)', L('2026-01'), 'January 2026');
}

/* ══════════ 4. ONE IMPLEMENTATION ══════════ */
{
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const others = fs.readdirSync(__dirname)
    .filter(f => /\.js$/.test(f) && !/\.test\.js$/.test(f) && f !== 'data.js')
    .filter(f => {
      const code = strip(fs.readFileSync(path.join(__dirname, f), 'utf8'));
      /* "March 2026" = month + year and NO DAY. Without the day exclusion this
         matched "14 Jan 2026" in reconcile.js — a full date, not a month label,
         and a false positive that would have had me "fixing" correct code. */
      const opts = code.match(/\{[^{}]*month:\s*'(long|short)'[^{}]*\}/g) || [];
      return opts.some(o => /year:\s*'numeric'/.test(o) && !/day:/.test(o));
    });
  eq('no page builds its own "March 2026" — data.js owns it', others, []);
}

/* ══════════ 5. THE REGISTERS USE IT ══════════ */
{
  const sales = fs.readFileSync(path.join(__dirname, 'sales.js'), 'utf8');
  ok(/groupByDefault:\s*'month'/.test(sales), 'the Sales Register groups by month BY DEFAULT (it was "none" — a flat list)');
  ok(/key:\s*'month'[\s\S]{0,160}Q\.monthLabel/.test(sales), '  and its month header reads "March 2026", not "2026-03"');
  const pur = fs.readFileSync(path.join(__dirname, 'purchase.js'), 'utf8');
  ok(/key:\s*'month'[\s\S]{0,160}Q\.monthLabel/.test(pur), 'the Purchase Register offers Month grouping too, with the same label');
  ok(/groupSum/.test(sales) && /groupSum/.test(pur), 'both registers total each group — the number the user is looking for');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
