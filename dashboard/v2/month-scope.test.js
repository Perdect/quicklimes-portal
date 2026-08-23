/* MONTH SCOPE ON AGGREGATE PAGES — executed, not grep'd.

   Payables / Collections / Customer Intelligence rows are per-party AGGREGATES,
   so the month control must scope the underlying DOCUMENTS before aggregation
   (qlx.js monthFilter:'self'). This extracts the real builders out of the real
   files and runs them: a copy in the test would prove only the copy. */
'use strict';
const fs = require('fs'), vm = require('vm');
const read = f => fs.readFileSync(__dirname + '/' + f, 'utf8');
let pass = 0, fail = 0; const bad = [];
const ok = (m, c) => { if (c) pass++; else { fail++; bad.push(m); } };
const near = (m, a, b) => ok(m + ' (got ' + a + ', want ' + b + ')', Math.abs(a - b) < 0.01);

function grab(src, start, end, file) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error('not found in ' + file + ': ' + start);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error('no end marker in ' + file);
  return src.slice(i, j + end.length);
}
/* one inPeriod for every stub — same prefix rule as data.js */
const inPeriod = (d, p) => !p || p === 'all' || String(d || '').startsWith(p);

/* ── 1 · THE ENGINE: monthFilter 'self' skips row filtering, defaults right ── */
{
  const qx = read('qlx.js');
  const code = grab(qx, 'function monthOf(r)', '\n', 'qlx.js')
    + grab(qx, 'function latestMonth(rows)', '\n', 'qlx.js')
    + grab(qx, 'function rawRows()', 'function selfLatest() { const ms = [...selfMonths()].sort(); return ms.length ? ms[ms.length - 1] : \'all\'; }', 'qlx.js')
    + '\n' + grab(qx, 'const dateOf = r =>', '\n', 'qlx.js')
    + grab(qx, 'const rowInPeriod = r =>', '\n  }', 'qlx.js');
  const mk = (cfg, month) => {
    const ctx = { CFG: cfg, S: { month: month, monthInit: month != null }, QLD: { inPeriod, uiMonth: () => '2026-05' }, window: { QLD: { inPeriod, uiMonth: () => '2026-05' } } };
    vm.createContext(ctx);
    vm.runInContext(code + '\nthis.allRows = allRows; this.selfLatest = selfLatest;', ctx);
    return ctx;
  };
  const DOCS = [{ date: '2026-06-01' }, { date: '2026-07-02' }];
  /* self mode: rows come back UNFILTERED (data() already scoped itself) */
  const self1 = mk({ monthFilter: 'self', monthDefault: 'all', data: () => DOCS, monthsOf: () => ['2026-06', '2026-07'] }, null);
  const rows1 = self1.allRows();
  ok('self mode: engine never re-filters the aggregates', rows1.length === 2);
  ok('self mode + monthDefault all: lands on the COMPLETE view, ignoring the cross-page saved month', self1.S.month === 'all');
  const self2 = mk({ monthFilter: 'self', data: () => DOCS, monthsOf: () => ['2026-04', '2026-06'] }, null);
  self2.allRows();
  ok('self mode without monthDefault: saved cross-page pick wins', self2.S.month === '2026-05');
  ok('selfLatest reads the DOCUMENT months', self2.selfLatest() === '2026-06');
  /* classic mode still filters rows — the old behaviour must not have moved */
  const classic = mk({ monthFilter: true, data: () => DOCS, monthOf: r => r.date }, '2026-06');
  ok('classic mode still filters by row month', classic.allRows().length === 1);
}

/* ── 1b · SUB-MONTH RANGES: the engine filters by FULL date, never the
   YYYY-MM truncation (which made every row of a month "overlap" any range
   inside that month — a ten-day label over a whole-month table) ── */
{
  const qx = read("qlx.js");
  const code = grab(qx, "function monthOf(r)", "\n", "qlx.js")
    + grab(qx, "const dateOf = r =>", "\n", "qlx.js")
    + grab(qx, "const rowInPeriod = r =>", "\n", "qlx.js");
  const inP = (d, p) => {
    if (!p || p === "all") return true;
    if (/^c:/.test(p)) { const m = /^c:(.+)\.\.(.+)$/.exec(p); return d >= m[1] && d <= m[2]; }
    return String(d).slice(0, p.length) === p;
  };
  const ctx = { CFG: { monthOf: r => r.date }, S: { month: "c:2026-06-10..2026-06-20" }, QLD: { inPeriod: inP } };
  vm.createContext(ctx);
  vm.runInContext(code + "this.rowInPeriod = rowInPeriod;", ctx);
  ok("a 5 June row is OUTSIDE the 10–20 June range", !ctx.rowInPeriod({ date: "2026-06-05" }));
  ok("a 15 June row is INSIDE it", ctx.rowInPeriod({ date: "2026-06-15" }));
  ctx.S.month = "2026-06";
  ok("month prefixes still match full dates", ctx.rowInPeriod({ date: "2026-06-05" }));
}

/* ── 2 · PAYABLES: bills of the period, aggregated per supplier ── */
{
  const src = read('payables.js');
  const ctx = {
    Q: { inPeriod,
      partyRows: () => [{ name: 'SHREE PETCOKE SUPPLIERS', phone: '98290' }],
      purchaseRows: () => [
        { sup: 'Shree Petcoke Suppliers', date: '2026-06-07', outstanding: 1000, status: 'pending' },
        { sup: 'Shree Petcoke Suppliers', date: '2026-05-14', outstanding: 500, status: 'pending' },
        { sup: 'Marwar Minerals & Mining', date: '2026-06-18', outstanding: 200, status: 'pending' },
        { sup: 'Paid Supplier', date: '2026-06-02', outstanding: 0, status: 'paid' },
        { sup: 'Cancelled Co', date: '2026-06-03', outstanding: 300, status: 'cancelled' }
      ] }
  };
  vm.createContext(ctx);
  vm.runInContext(grab(src, 'function ageOf(', '\n', 'payables.js')
    + 'function bucketOf(days) { return days > 60 ? "critical" : days > 30 ? "overdue" : "recent"; }\n'
    + grab(src, '/* Aggregate every unpaid purchase bill', '.sort((a, b) => b.out - a.out);\n}', 'payables.js')
    + '\nthis.payRows = payRows;', ctx);
  const all = ctx.payRows(null), jun = ctx.payRows('2026-06'), may = ctx.payRows('2026-05');
  near('no period → complete debt (1000+500+200)', all.reduce((a, r) => a + r.out, 0), 1700);
  near('June → June bills only (1000+200)', jun.reduce((a, r) => a + r.out, 0), 1200);
  ok('  and the supplier aggregate re-forms per period (Shree: 1 June bill, 2 overall)',
     jun.find(r => /Shree/.test(r.sup)).bills === 1 && all.find(r => /Shree/.test(r.sup)).bills === 2);
  near('May → the other bill alone', may.reduce((a, r) => a + r.out, 0), 500);
  ok('cancelled and settled bills never enter, any period', all.every(r => !/Cancelled|Paid/.test(r.sup)));
  ok('year period works too', ctx.payRows('2026').reduce((a, r) => a + r.out, 0) === 1700);
}

/* ── 3 · COLLECTIONS: same rule on the sales side ── */
{
  const src = read('collections.js');
  const ctx = {
    Q: { inPeriod, salesRows: () => [
        { party: 'ARIF', gstin: 'G1', date: '2026-06-10', outstanding: 700, status: 'pending' },
        { party: 'ARIF', gstin: 'G1', date: '2026-04-01', outstanding: 900, status: 'partial' },
        { party: 'BALA', gstin: 'G2', date: '2026-06-20', outstanding: 100, status: 'pending' }
      ], partyRows: () => [{ name: 'ARIF', gstin: 'G1', phone: '98290' }] },
    QLParty: { index: () => ({ keyOf: (n) => n, labelOf: k => k, gstinFor: () => '' }) }
  };
  vm.createContext(ctx);
  vm.runInContext(grab(src, 'function ageOf(', '\n', 'collections.js')
    + 'function bucketOf(days) { return days > 60 ? "critical" : days > 30 ? "overdue" : "recent"; }\n'
    + grab(src, '/* Aggregate every unpaid sales invoice', '.sort((a, b) => b.out - a.out);\n}', 'collections.js')
    + '\nthis.collectRows = collectRows;', ctx);
  near('no period → all outstanding', ctx.collectRows(null).reduce((a, r) => a + r.out, 0), 1700);
  near('June → June invoices only', ctx.collectRows('2026-06').reduce((a, r) => a + r.out, 0), 800);
  ok('ARIF re-aggregates per period (1 June invoice, 2 overall)',
     ctx.collectRows('2026-06').find(r => r.party === 'ARIF').bills === 1);
}

/* ── 3b · MONEY ACTIONS: the reminder quotes the WHOLE account, never the slice ── */
{
  const src = read("collections.js");
  const ctx = {
    Q: { inPeriod, co: { short: "Gotan" }, salesRows: () => [
        { party: "ARIF", gstin: "G1", date: "2026-06-10", outstanding: 700, status: "pending" },
        { party: "ARIF", gstin: "G1", date: "2026-04-01", outstanding: 900, status: "partial" }
      ], partyRows: () => [] },
    QLParty: { index: () => ({ keyOf: n => n, labelOf: k => k, gstinFor: () => "" }) },
    QLX: { month: () => "2026-06" }                              // a month IS picked
  };
  const vm2 = require("vm"); vm2.createContext(ctx);
  vm2.runInContext(grab(src, "function ageOf(", "\n", "collections.js")
    + "function bucketOf(days) { return days > 60 ? \"critical\" : days > 30 ? \"overdue\" : \"recent\"; }\n"
    + "function fmtPlain(n) { return Math.round(n || 0).toLocaleString(\"en-IN\"); }\n"
    + grab(src, "/* Aggregate every unpaid sales invoice", ".sort((a, b) => b.out - a.out);\n}", "collections.js")
    + "\n" + grab(src, "function fullRow(r)", "function reminderMsg(rr) {", "collections.js")
    + "  const r = fullRow(rr);\n" + grab(src, "  return `Dear ", ";\n}", "collections.js")
    + "\nthis.reminderMsg = reminderMsg; this.fullRow = fullRow; this.collectRows = collectRows;", ctx);
  const juneRow = ctx.collectRows("2026-06")[0];
  ok("the June view shows the June slice (700)", juneRow.out === 700);
  const msg = ctx.reminderMsg(juneRow);
  ok("but the reminder quotes the COMPLETE debt (1,600), never the slice", /1,600/.test(msg) && !/(^|[^,\d])700/.test(msg));
  ok("  across both invoices", /2 invoices/.test(msg));
}

/* ── 4 · CUSTOMER INTELLIGENCE: scoped business, LIFETIME balance ── */
{
  const src = read('parties.js');
  const ctx = {
    Q: { inPeriod,
      partyRows: () => [{ idx: 0, name: 'ARIF CHEMICAL', gstin: 'G1', opening: 0, creditLimit: 0 }],
      salesRows: () => [
        { party: 'ARIF CHEMICAL', gstin: 'G1', date: '2026-06-10', total: 1000, outstanding: 0, paid: 1000, status: 'paid' },
        { party: 'ARIF CHEMICAL', gstin: 'G1', date: '2026-03-01', total: 5000, outstanding: 5000, paid: 0, status: 'pending' }
      ],
      purchaseRows: () => [], ledgerNet: () => 0 }
  };
  vm.createContext(ctx);
  const code = grab(src, 'const up = s =>', 'const up = s => (s || \'\').toUpperCase();', 'parties.js')
    + '\n' + grab(src, 'function refNow()', 'function syncNow(period) { NOW = period ? periodEnd(period) : refNow(); }', 'parties.js')
    + '\n' + grab(src, 'function dDays(d)', 'function relDays(n)', 'parties.js').replace(/function relDays\(n\)$/, '')
    + '\nfunction relDays() { return ""; }\n'
    + grab(src, '/* ── monthly buckets', 'return arr;\n}', 'parties.js')
    + '\n' + grab(src, 'const _norm = s =>', 'return -1;\n  };\n}', 'parties.js')
    + '\n' + grab(src, 'function enriched(period)', '\n  });\n}', 'parties.js')
    + '\nthis.enriched = enriched; this.periodEnd = periodEnd;';
  vm.runInContext(code, ctx);
  const life = ctx.enriched(null)[0], jun = ctx.enriched('2026-06')[0];
  near('lifetime business = both invoices', life.salesAmt, 6000);
  near('June scope: only the June invoice counts as business', jun.salesAmt, 1000);
  ok('  order count follows (1 in June, 2 lifetime)', jun.salesN === 1 && life.salesN === 2);
  near('the RUNNING BALANCE ignores the month — the account owes what it owes', jun.currentBalance, 5000);
  near('  and matches the unscoped balance exactly', jun.currentBalance, life.currentBalance);
  ok('recency anchors at PERIOD END (June invoice is 20 days old on 30 June, not months-vs-today)',
     jun.salesRec === 20);
  ok('period end computes month + year forms',
     ctx.periodEnd('2026-06').getDate() === 30 && ctx.periodEnd('2026').getMonth() === 11);
  /* a customer with no June orders but real history must not demote to prospect */
  ctx.Q.salesRows = () => [{ party: 'ARIF CHEMICAL', gstin: 'G1', date: '2026-03-01', total: 5000, outstanding: 0, paid: 5000, status: 'paid' }];
  const off = ctx.enriched('2026-06')[0];
  ok('no orders in the period + real history → dormant, never "prospect"', off.seg === 'dormant');
}

console.log('\n════ month scope on aggregate pages (executed) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' MONTH-SCOPE TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
