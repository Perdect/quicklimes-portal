/* THE ONE DATE GRAMMAR — executed out of data.js.

   Every filter in the app speaks one period language: 'all', 'YYYY',
   'YYYY-MM', 'r:<quick-key>' and 'c:from..to' — resolved by rangeSpan and
   tested by inPeriod with OVERLAP semantics. This suite runs the real
   functions against injected clocks, because the bugs that matter here are
   boundary bugs: FY rollover on 1 April, leap February, IST midnight. */
'use strict';
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/data.js', 'utf8');
let pass = 0, fail = 0; const bad = [];
const ok = (m, c) => { if (c) pass++; else { fail++; bad.push(m); } };
const eq = (m, a, b) => ok(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b));

function grab(a, b) { const i = src.indexOf(a); if (i < 0) throw new Error('missing: ' + a); return src.slice(i, src.indexOf(b, i) + b.length); }
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  grab('const RANGE_KEYS =', '\n') + grab('const RANGE_LABEL =', '\n') +
  grab('const isoOf = d =>', '\n') + grab('const weekStart = n =>', '\n') +
  grab('function rangeSpan(period, now)', '\n  }') +
  grab('function valueSpan(v)', '\n  }') +
  grab('function inPeriod(date, period)', '\n  }') +
  '\nthis.rangeSpan = rangeSpan; this.inPeriod = inPeriod; this.RANGE_KEYS = RANGE_KEYS; this.RANGE_LABEL = RANGE_LABEL;', ctx);
const span = (p, now) => ctx.rangeSpan(p, now);

/* ── FINANCIAL YEAR: 1 April → 31 March, never the calendar year (§7) ── */
{
  eq('This FY on 15 Aug 2026 starts 1 Apr 2026', span('r:fy', '2026-08-15T10:00:00').from, '2026-04-01');
  eq('This FY on 31 MARCH 2026 is still FY 2025-26', span('r:fy', '2026-03-31T10:00:00').from, '2025-04-01');
  eq('This FY on 1 APRIL 2026 rolls to FY 2026-27', span('r:fy', '2026-04-01T10:00:00').from, '2026-04-01');
  eq('Last FY on 15 Aug 2026 = full FY 2025-26', span('r:lastfy', '2026-08-15T10:00:00'), { from: '2025-04-01', to: '2026-03-31' });
  eq('Last FY spans exactly to 31 March even across leap Feb', span('r:lastfy', '2029-06-01T10:00:00'), { from: '2028-04-01', to: '2029-03-31' });
}

/* ── month boundaries: no hardcoded lengths (§24) ── */
{
  eq('June has 30 days', span('2026-06'), { from: '2026-06-01', to: '2026-06-30' });
  eq('leap February has 29', span('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  eq('normal February has 28', span('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  ok('31 May is IN May and NOT in June', ctx.inPeriod('2026-05-31', '2026-05') && !ctx.inPeriod('2026-05-31', '2026-06'));
  ok('1 June is IN June and NOT in May', ctx.inPeriod('2026-06-01', '2026-06') && !ctx.inPeriod('2026-06-01', '2026-05'));
  eq('Last month across a year rollover (Jan → Dec)', span('r:lastmon', '2027-01-10T10:00:00'), { from: '2026-12-01', to: '2026-12-31' });
}

/* ── quick keys ── */
{
  eq('Last week is the full Mon–Sun before this one', span('r:lastweek', '2026-08-19T10:00:00'), { from: '2026-08-10', to: '2026-08-16' });   // 19 Aug 2026 = Wednesday
  eq('Last quarter before Q3 is Apr–Jun', span('r:lastq', '2026-08-19T10:00:00'), { from: '2026-04-01', to: '2026-06-30' });
  eq('Last quarter across a year edge (Q1 → prev Oct–Dec)', span('r:lastq', '2026-02-10T10:00:00'), { from: '2025-10-01', to: '2025-12-31' });
  ok('every RANGE_KEY resolves to a real span', ctx.RANGE_KEYS.every(k => { const s = span('r:' + k, '2026-08-19T10:00:00'); return s.from && s.to && s.from <= s.to; }));
  ok('every RANGE_KEY has a human label', ctx.RANGE_KEYS.every(k => ctx.RANGE_LABEL[k]));
}

/* ── custom ranges (§5) ── */
{
  ok('10–20 June includes the 15th, excludes the 21st',
     ctx.inPeriod('2026-06-15', 'c:2026-06-10..2026-06-20') && !ctx.inPeriod('2026-06-21', 'c:2026-06-10..2026-06-20'));
  ok('  and both endpoints, inclusive',
     ctx.inPeriod('2026-06-10', 'c:2026-06-10..2026-06-20') && ctx.inPeriod('2026-06-20', 'c:2026-06-10..2026-06-20'));
  eq('a backwards pick is tolerated, not exploded', span('c:2026-06-20..2026-06-10'), { from: '2026-06-10', to: '2026-06-20' });
  ok('a half-filled custom filters NOTHING (never a fake span)', ctx.inPeriod('2001-01-01', 'c:garbage'));
}

/* ── overlap semantics: a month-valued row vs a span ── */
{
  ok("the month '2026-07' overlaps a July-containing range", ctx.inPeriod('2026-07', 'c:2026-07-15..2026-08-15'));
  ok("  and does not overlap a range that skips it", !ctx.inPeriod('2026-06', 'c:2026-07-15..2026-08-15'));
}

console.log('\n════ period grammar (one date language, executed) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' GRAMMAR TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
