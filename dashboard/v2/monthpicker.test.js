/* monthpicker.test.js — there is ONE month picker. Exactly one.
 *
 * "calendar or filter or all things will be similar no changes use design system"
 * "I think you're lazzy why you changed design of calendar"
 *
 * Nobody had changed the design of the calendar. There were FIVE calendars, and
 * he was walking between them:
 *
 *   qlx.js .qx-month        Sales, Purchase
 *   dashboard.js .dx-mm-*   a verbatim clone — but keyed data-m, not data-ym
 *   reconcile.js .rc-mm-*   a clone, minus the selected-cell shadow
 *   inventory.html .inv-*   a clone, grey hover instead of blue
 *   purchasedash.html       a <select> wearing .qx-month's CSS
 *
 * Each carried its own CSS clone of the same 264px grid, so they drifted apart
 * without anyone touching a design. All five are gone; QLShell.monthPicker in
 * shell.js is the only one, because shell.js is the only file all 31 pages load.
 *
 * THIS FILE USED TO ASSERT `found >= 3` — it required at least three copies of
 * the year-arrow handler to exist, because back then the goal was "make sure all
 * three copies carry the fix". That is the wrong shape of guard: it made the
 * duplication load-bearing, and it would have FAILED on the consolidation that
 * actually fixes the bug. It now asserts the opposite, and permanently: a second
 * implementation must never come back. (Static, same pattern as no-fab.test.js —
 * the defect is not in any one handler, it is in the second copy nobody greps
 * for.)
 *
 *   node monthpicker.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
// Value-comparing form: a bare ok() on a number reports "failed" without saying
// what it got, which is useless when the whole point is which number appeared.
const eq2 = (m, a, b) => ok(a === b, m + '\n     got: ' + a + '  expected: ' + b);

/* Strip comments before asserting: every file here EXPLAINS this bug in prose,
   and a bare /stopPropagation/ would match the explanation rather than the code.
   That false positive already bit once in waphone.test.js, where the guard
   matched its own comment and a broken copy sailed through. */
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
  .replace(/<!--[\s\S]*?-->/g, ' ');

const files = fs.readdirSync(__dirname)
  .filter(f => /\.(js|html)$/.test(f) && !/\.test\.js$/.test(f));
const SRC = new Map(files.map(f => [f, strip(fs.readFileSync(path.join(__dirname, f), 'utf8'))]));

console.log('\n═══ month picker · exactly one of it ═══\n');

/* ══════════ 1. THE ONE IMPLEMENTATION ══════════ */
{
  const shell = SRC.get('shell.js') || '';
  ok(/function monthPicker\s*\(/.test(shell), 'shell.js defines monthPicker() — the app\'s one calendar');
  ok(/function monthButton\s*\(/.test(shell), 'shell.js defines monthButton() — so the trigger is shared too, not just the popover');
  ok(/monthPicker\b/.test(shell) && /window\.QLShell\s*=/.test(shell),
    '  and QLShell exports it, so every page can actually reach it');

  /* The year-arrow bug this file was born for. One copy now — it must carry it. */
  const handlers = shell.match(/\[data-yr\][^\n]*onclick[^\n]*/g) || [];
  ok(handlers.length === 1, 'shell.js binds the ‹ › year arrows exactly once (got ' + handlers.length + ')');
  for (const h of handlers) {
    ok(/stopPropagation/.test(h),
      'the ‹ › year arrows must stopPropagation: paint() detaches the clicked button, the click ' +
      'bubbles to the document close-handler, and the picker shuts instead of changing year.');
    ok(/onclick\s*=\s*(e|ev|event)\s*=>/.test(h),
      'the year-arrow handler must take the event argument — `() => {}` cannot stop propagation.');
  }

  /* The opposite case: picking a month is MEANT to close the picker. Pinning it
     stops someone "fixing" the arrows by pasting stopPropagation everywhere. */
  const cells = shell.match(/\[data-ym\][^\n]*onclick[^\n]*/g) || [];
  ok(cells.length === 1, 'shell.js binds the month cells exactly once (got ' + cells.length + ')');
  for (const c of cells) ok(/close/i.test(c), 'picking a month must close the picker — this handler never calls close.');
}

/* ══════════ 2. NO SECOND IMPLEMENTATION, ANYWHERE ══════════
   The real guard, and the whole point of the file. Not "the copies I deleted are
   deleted" — that catches nothing. A SIXTH copy on a sixth surface is exactly how
   this reached five. */
{
  for (const [f, src] of SRC) {
    if (f === 'shell.js') continue;

    /* Building a month grid = building a picker. A page may CALL the shared one;
       it may not paint one. */
    ok(!/\[data-yr\]/.test(src),
      f + ': binds its own ‹ › year-arrow handler — that is a second month picker. ' +
      'Call QLShell.monthPicker(anchor, { month, have, onPick }) instead.');
    ok(!/data-yr\s*=/.test(src),
      f + ': renders its own year-arrow markup — that is a second month picker. Use QLShell.monthPicker.');
    ok(!/mm-grid|mm-cell/.test(src),
      f + ': renders its own month-grid markup — that is a second month picker. Use QLShell.monthPicker.');

    /* A Jan..Dec array turned into BUTTONS is the fingerprint of a hand-rolled
       calendar — it catches a sixth copy that invents fresh class names and so
       slips past the checks above.

       The array alone is NOT the signal: finance.html and wa-core.js both hold
       one to format "12 Mar", which is a date helper, not a picker. Failing them
       would be a false positive, and a guard that cries wolf gets deleted — the
       precise thing this file is trying to prevent. So: array AND buttons. */
    for (const m of src.matchAll(/\[[^\]]*'Jan'[^\]]*'Dec'[^\]]*\]|\[[^\]]*"Jan"[^\]]*"Dec"[^\]]*\]/g)) {
      const after = src.slice(m.index, m.index + 700);
      ok(!/<button/.test(after),
        f + ': builds month <button> cells from a hand-rolled Jan..Dec array — that is a second ' +
        'month picker with new class names. Call QLShell.monthPicker instead. ' +
        '(A Jan..Dec array for FORMATTING a date is fine; this one renders buttons.)');
    }

    /* purchasedash.html's <select> is why this check exists: it was not a copy of
       the popover, it was a DIFFERENT control for the same job — which reads to
       the user as "the calendar changed again". */
    ok(!/<select[^>]*id\s*=\s*["'][^"']*[Mm]onth/.test(src),
      f + ': uses a native <select> to pick a month. Every other page shows the shared calendar — ' +
      'a dropdown here is the inconsistency the owner reported. Use QLShell.monthPicker.');
  }
}

/* ══════════ 3. NO SECOND STYLESHEET ══════════
   Each copy shipped its own CSS clone of the same grid; THAT is what made the
   calendars look different — nobody restyled anything, the clones just never
   agreed. Dead CSS is how a removed thing quietly returns (no-fab.test.js). */
{
  const css = fs.readdirSync(__dirname).filter(f => /\.css$/.test(f));
  for (const f of css) {
    const src = strip(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    const clones = (src.match(/\.(qx|dx|rc|inv|pd)-mm?-[a-z]+\s*\{/g) || []).filter(c => /-mm-/.test(c));
    ok(!clones.length,
      f + ': still carries month-calendar CSS (' + clones.join(' ') + '). The picker is styled ONCE, ' +
      'in shell.css (.ql-mp). Delete these — an overridden clone comes back.');
  }
  const shellCss = fs.readFileSync(path.join(__dirname, 'shell.css'), 'utf8');
  ok(/\.ql-mp-cell\s*\{/.test(shellCss) && /\.ql-mp-btn\s*\{/.test(shellCss),
    'shell.css owns the picker\'s styling (.ql-mp-btn + .ql-mp-cell) — it is the only stylesheet every page loads');
  ok(/\.ql-mp-cell\.has::after/.test(shellCss),
    '  including the has-data dot: seeing which months have books is why this is a calendar and not a <select>');
}

/* ══════════ 4. EVERY SURFACE STILL HAS ITS PICKER ══════════
   Consolidation must not mean a page quietly LOST its month filter. Each of these
   scopes real numbers — his books — and one of them silently going unfiltered is
   worse than five calendars. */
{
  const wired = {
    'qlx.js': 'Sales + Purchase registers',
    'dashboard.js': 'the Dashboard',
    'reconcile.js': 'Bank Reconciliation',
    'inventory.html': 'Inventory',
    'purchasedash.html': 'the Purchase Dashboard'
  };
  for (const [f, what] of Object.entries(wired)) {
    ok(/QLShell\.monthPicker\s*\(/.test(SRC.get(f) || ''),
      f + ' (' + what + '): no longer opens a month picker at all — it must call QLShell.monthPicker.');
    ok(/QLShell\.monthButton\s*\(/.test(SRC.get(f) || ''),
      f + ' (' + what + '): must render the shared trigger via QLShell.monthButton, so the button matches the calendar.');
  }
}

/* ══════════ 6. THE PICKER REACHES EVERY PERIOD-SCOPED PAGE ══════════
   "how can I filter month or year give option calendar fo all". It reached 2 of
   13 QLX pages. These are the pages whose numbers are built from DATED rows, so
   "show me March" is a question they can answer honestly — listed by name
   because the failure mode is a page quietly never getting one, which no generic
   check can see. Pages deliberately WITHOUT it are section 8; that list is the
   other half of this one, and a page must appear in exactly one of them. */
const QLX_SCOPED = {
  'sales.js': 'Sales Register', 'purchase.js': 'Purchase Register',
  'payments.js': 'Payments Center', 'cashbook.js': 'Cash Book', 'tds.js': 'TDS'
};
const HTML_SCOPED = {
  'gst.html': 'GST Summary', 'pl.html': 'Profit & Loss',
  'chunna.html': 'Chunna Sales', 'monthreg.html': 'Monthly Register'
};
{
  for (const [f, what] of Object.entries(QLX_SCOPED)) {
    const src = SRC.get(f) || '';
    ok(/monthFilter:\s*true/.test(src),
      f + ' (' + what + '): every row here is dated, but the page never opts into the month filter ' +
      '(monthFilter: true). qlx.js renders the shared picker only for pages that ask.');
    ok(/monthOf:/.test(src),
      f + ' (' + what + '): declares monthFilter but no monthOf — qlx.js would not know which field dates a row.');
  }
  for (const [f, what] of Object.entries(HTML_SCOPED)) {
    ok(/QLShell\.periodFilter\s*\(/.test(SRC.get(f) || ''),
      f + ' (' + what + '): shows period-scoped numbers with no month picker. Call QLShell.periodFilter ' +
      '(shell.js) — it is the shared wiring around the shared calendar.');
  }
}

/* ══════════ 7. THE PICKER MUST ACTUALLY RESCOPE ══════════
   The signature bug of this codebase: built, not wired. A calendar that renders
   and filters nothing is WORSE than no calendar — it is a wrong number the owner
   has been invited to trust. Every check below is a specific way that happens. */
{
  /* (a) qlx.js hands the month-scoped rows to CFG.stats(). A page that declares
     `stats: () =>` and re-reads an all-time summary renders six cards that never
     move while the table beneath them does. payments/cashbook/tds all did. */
  for (const [f, what] of Object.entries(QLX_SCOPED)) {
    const src = SRC.get(f) || '';
    if (!/stats:/.test(src)) continue;
    ok(!/stats:\s*\(\s*\)\s*=>/.test(src),
      f + ' (' + what + '): `stats: () =>` ignores the month-scoped rows qlx.js passes in, so the ' +
      'stat cards keep showing all-time totals while the table shows one month. Take the rows: `stats: rows => …`.');
  }

  /* (b) The export must be what is ON SCREEN. QLX.rows() is the scoped set; the
     raw row builder is every month ever. A CSV that disagrees with the page is
     how a filter gets believed and then disbelieved. */
  const exports = {
    'payments.js': 'paymentsLedger', 'cashbook.js': 'cashbookRows', 'tds.js': 'tdsRows'
  };
  for (const [f, builder] of Object.entries(exports)) {
    const src = SRC.get(f) || '';
    const fn = (src.match(/function export\w+\([^)]*\)\s*\{[\s\S]{0,600}?\n\}/) || [''])[0]
      || (src.match(/function export\w+\([^)]*\)\s*\{[^\n]*\}/) || [''])[0];
    if (!fn) continue;
    ok(/QLX\.rows\(\)/.test(fn),
      f + ': its export reads ' + builder + '() — every row ever — while the page shows one month. ' +
      'Export QLX.rows(), the scoped set (sales.js already does).');
  }

  /* (c) The plain pages must PASS the period to the data layer. Mounting the
     button and then calling the all-time summary is the same bug wearing the
     shared control's clothes — and it would look completely correct. */
  const feeds = {
    'gst.html': /gstSummary\(\s*PF\.period\(\)\s*\)/,
    'pl.html': /getPL\(\s*PF\.period\(\)\s*\)/,
    'chunna.html': /chunnaSummary\(\s*PF\.period\(\)\s*\)/,
    'monthreg.html': /monthlyRegister\(\s*per\s*\)/
  };
  for (const [f, re] of Object.entries(feeds)) {
    ok(re.test(SRC.get(f) || ''),
      f + ': renders the picker but never passes the picked period to its data call — the numbers ' +
      'would not move. This is the "built, not wired" failure the whole change exists to avoid.');
  }

  /* (d) An equality test cannot read a YEAR. `slice(0,7) === period` matches
     NOTHING for '2026', so the year button would EMPTY the page instead of
     widening it — a filter that renders and lies. QLD.inPeriod is the one rule. */
  const qlx = SRC.get('qlx.js') || '';
  ok(!/monthOf\(r\)\s*===\s*S\.month/.test(qlx),
    'qlx.js: filters rows with `monthOf(r) === S.month`, which matches nothing when the picker ' +
    'returns a year. Use QLD.inPeriod — the shared prefix rule.');
  ok(/QLD\.inPeriod/.test(qlx),
    'qlx.js: must run rows through QLD.inPeriod so "Whole year 2026" widens the table instead of emptying it.');
}

/* ══════════ 8. THE PAGES THAT MUST *NOT* BE MONTH-SCOPED ══════════
   The other half of section 6, and the more important half. Forcing the picker
   onto these would be a bug wearing a consistency costume: a running balance or
   an outstanding position is arrived at by every entry EVER, so scoping it to
   March invents a number that was never true on any day. The reason is recorded
   against each page so the next person adding "the missing pickers" reads WHY
   before deciding these were an oversight. */
{
  const NOT_SCOPED = {
    'collections.js': 'one row per CUSTOMER = what they owe TODAY, not what they bought in March',
    'payables.js': 'one row per SUPPLIER = what we owe TODAY; same position, other direction',
    'loans.js': 'one row per LOAN; outstanding is a running balance, meaningless per month',
    'labour.js': 'one row per WORKER — no date on the record at all, and attendance is keyed by day-number inside one unlabelled month grid, so there is nothing to filter'
  };
  for (const [f, why] of Object.entries(NOT_SCOPED)) {
    const src = SRC.get(f) || '';
    ok(!/monthFilter:\s*true/.test(src),
      f + ': took the month filter, but ' + why + '. A picker here would produce a number that was ' +
      'never true. If the data model changed to make this honest, move it to QLX_SCOPED above.');
  }
  /* Reports owns a RANGE picker — "what span" is a different question from "which
     month", and replacing it would be a downgrade dressed as consistency. */
  ok(!/QLShell\.periodFilter\s*\(/.test(SRC.get('reports.html') || ''),
    'reports.html: has its own from/to RANGE picker. "What span" ≠ "which month" — do not replace it.');
  /* A page cannot be in both lists. Reads as pedantic; it is the check that fires
     when someone resolves "why has this no picker?" by adding one and leaving the
     reason behind. */
  for (const f of Object.keys(NOT_SCOPED)) {
    ok(!QLX_SCOPED[f] && !HTML_SCOPED[f],
      f + ': is listed as both month-scoped and deliberately-not. Decide which, in one place.');
  }
}

/* ══════════ 5. THE PICK STILL PERSISTS ══════════
   QLD.uiMonth/setUiMonth is the shared month state — it is why picking March on
   Sales keeps you in March on Purchase. A refactor that dropped it would look
   fine on every page and lose his place on every navigation. */
{
  for (const f of ['qlx.js', 'dashboard.js', 'reconcile.js', 'inventory.html', 'purchasedash.html']) {
    ok(/setUiMonth/.test(SRC.get(f) || ''),
      f + ': no longer persists the picked month (QLD.setUiMonth) — the month must ride across pages.');
  }
  /* Inventory's picker genuinely offers MORE (whole-year + "All time"): stock is a
     running position, not a monthly book. That is an OPTION on the shared picker,
     not grounds for a second picker — and not something to quietly drop either. */
  const inv = SRC.get('inventory.html') || '';
  ok(/years:\s*true/.test(inv) && /allLabel:\s*'All time'/.test(inv),
    'inventory.html: keeps its "Whole year" + "All time" options (years/allLabel on the shared picker). ' +
    'Consolidation must not have quietly deleted them.');
  const shell = SRC.get('shell.js') || '';
  ok(/cfg\.years/.test(shell) && /cfg\.allLabel/.test(shell),
    'shell.js: the shared picker supports years/allLabel — the options that made consolidating Inventory safe');
}

/* ══════════ 9. THE RULE ITSELF, RUN ══════════
   Sections 6–8 are static: they prove the wiring exists. They cannot prove it
   WORKS. QLD.inPeriod is what every one of those pages now filters through, so
   it is the single point where "month or year" is either right or silently
   wrong everywhere at once. Run the real one out of data.js. */
const vm = require('vm');
const dsrc = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
const grab = (start, end) => {
  const i = dsrc.indexOf(start);
  if (i < 0) throw new Error('not found in data.js: ' + start);
  return dsrc.slice(i, dsrc.indexOf(end, i) + end.length);
};
const S = { SALES: [], PURCHASES: [], WORKERS: [], CASHBOOK: [], CHUNNA: [] };
const dctx = { console, Math, Object, Array, Number, String, Date, RegExp, isNaN, parseFloat, S, partyGstin: () => '' };
vm.createContext(dctx);
vm.runInContext([
  grab('const RANGE_KEYS =', '\n'), grab('const RANGE_LABEL =', '\n'),
  grab('const isoOf =', '\n'), grab('const weekStart =', '\n'),
  grab('const parseD = s =>', '\n'), grab('const fDS = s =>', '\n'), grab('function fDS2(s)', '\n'),
  grab('function rangeSpan(period, now)', '\n  }'),
  grab('function valueSpan(v)', '\n  }'),
  grab('function inPeriod(date, period)', '\n  }'),
  grab('function monthLabel(ym, opts)', '\n  }'),
  grab('function periodLabel(p, allLabel)', '\n  }'),
  grab('const notCancelled = x =>', '\n'),
  grab('const cS = s =>', '\n'), grab('const cP = p =>', '\n'),
  grab('const saleInter =', '\n'),
  grab('const totS =', '\n'), grab('const totP =', '\n'),
  grab('function gstSummary(period)', '\n  }'),
  'this.P = { inPeriod, periodLabel, gstSummary, rangeSpan, RANGE_KEYS };'
].join('\n'), dctx);
const P = dctx.P;

{
  const I = P.inPeriod;
  /* A month. */
  ok(I('2026-03-14', '2026-03'), 'inPeriod: a March date is in March');
  ok(!I('2026-04-01', '2026-03'), 'inPeriod: an April date is not in March');
  ok(!I('2025-03-14', '2026-03'), 'inPeriod: same month, WRONG YEAR, is not in March 2026');
  /* A year — the thing the owner asked for, and the case a `slice(0,7) ===`
     implementation silently answers NO to for every row on earth. */
  ok(I('2026-03-14', '2026'), 'inPeriod: a March date is in the year 2026');
  ok(I('2026-12-31', '2026'), 'inPeriod: December too — the year is the whole year');
  ok(!I('2025-12-31', '2026'), 'inPeriod: last New Year\'s Eve is not in 2026 (the off-by-one-day boundary)');
  /* All / empty. */
  ok(I('2026-03-14', 'all'), 'inPeriod: "all" takes everything');
  ok(I('2026-03-14', null) && I('2026-03-14', ''), 'inPeriod: no period takes everything (the default every old caller relies on)');
  /* Junk must not throw — these run over rows whose date may be missing. */
  ok(!I('', '2026-03') && !I(null, '2026-03') && !I(undefined, '2026-03'),
    'inPeriod: a row with NO date is in no month — and does not throw');

  const L = P.periodLabel;
  ok(L('2026-03') === 'March 2026', 'periodLabel: a month reads as a month');
  ok(L('2026') === 'Year 2026', 'periodLabel: a YEAR reads as "Year 2026" — QLD.monthLabel alone returns blank here, which is how the year button ends up with an empty label');
  ok(L('all') === 'All months' && L(null) === 'All months', 'periodLabel: the unfiltered case');
  ok(L('all', 'All time') === 'All time', 'periodLabel: Inventory\'s "All time" is still expressible (allLabel)');
}

/* ══════════ 11. THE RANGES REPORTS USED TO OWN ══════════
   "make sure we will use same date filter as second image" — the calendar goes
   everywhere, and reports.html's pill row goes away. The pills carried Today /
   Yesterday / This week / Quarter / Custom Range, which the month grid cannot
   say. Deleting them WOULD have deleted five real capabilities from his books,
   silently: every assertion below is one of those capabilities, now expressed by
   the shared control instead of by reports' private copy.

   `now` is injected so a boundary can be tested AT the boundary. The app never
   passes it — see the note on rangeSpan. */
{
  const R = (p, now) => P.rangeSpan(p, now);
  const at = s => new Date(s);                        // a fixed "now", local time

  /* ── the relative ranges, resolved against a known Tuesday ──
     Tue 14 Jul 2026. Week starts Monday (13th), quarter Q3 (1 Jul), year 1 Jan. */
  const tue = at('2026-07-14T15:30:00');
  eq2('r:today  → just today', JSON.stringify(R('r:today', tue)), JSON.stringify({ from: '2026-07-14', to: '2026-07-14' }));
  eq2('r:yday   → just yesterday', JSON.stringify(R('r:yday', tue)), JSON.stringify({ from: '2026-07-13', to: '2026-07-13' }));
  eq2('r:week   → Monday to today', JSON.stringify(R('r:week', tue)), JSON.stringify({ from: '2026-07-13', to: '2026-07-14' }));
  eq2('r:month  → the 1st to today (month-TO-DATE, not the whole month)', JSON.stringify(R('r:month', tue)), JSON.stringify({ from: '2026-07-01', to: '2026-07-14' }));
  eq2('r:lastmon→ the whole PREVIOUS month, both ends', JSON.stringify(R('r:lastmon', tue)), JSON.stringify({ from: '2026-06-01', to: '2026-06-30' }));
  eq2('r:quarter→ Q3 starts 1 Jul', JSON.stringify(R('r:quarter', tue)), JSON.stringify({ from: '2026-07-01', to: '2026-07-14' }));
  eq2('r:year   → 1 Jan to today', JSON.stringify(R('r:year', tue)), JSON.stringify({ from: '2026-01-01', to: '2026-07-14' }));

  /* ── week: the Sunday trap ──
     JS getDay() is 0 for SUNDAY. `now.getDate() - now.getDay()` (the obvious
     line) makes Sunday its OWN week start, so on Sunday "This week" would show
     one day and the six days he actually worked would vanish. (n.getDay()+6)%7
     is the Monday-start fix; this is the assertion that pins it. */
  eq2('r:week on a SUNDAY reaches back to the Monday BEFORE it, not to itself',
    JSON.stringify(R('r:week', at('2026-07-19T10:00:00'))), JSON.stringify({ from: '2026-07-13', to: '2026-07-19' }));
  eq2('r:week on a MONDAY is that Monday alone',
    JSON.stringify(R('r:week', at('2026-07-13T10:00:00'))), JSON.stringify({ from: '2026-07-13', to: '2026-07-13' }));

  /* ── quarter boundaries: all four, at the first instant of each ──
     Math.floor(m/3)*3 is the whole rule; a wrong quarter start misstates GST. */
  for (const [d, qs] of [['2026-01-01', '2026-01-01'], ['2026-03-31', '2026-01-01'],
                         ['2026-04-01', '2026-04-01'], ['2026-06-30', '2026-04-01'],
                         ['2026-07-01', '2026-07-01'], ['2026-09-30', '2026-07-01'],
                         ['2026-10-01', '2026-10-01'], ['2026-12-31', '2026-10-01']]) {
    eq2('r:quarter on ' + d + ' starts ' + qs, R('r:quarter', at(d + 'T12:00:00')).from, qs);
  }

  /* ── year rollover: the arithmetic that only breaks one day a year ──
     `new Date(y, m-1, 1)` with m=0 is DECEMBER OF LAST YEAR, which is correct and
     is why the code does not hand-roll `y - (m===0)`. On 1 Jan, "last month" must
     be last December, and "yesterday" must be last New Year's Eve. */
  const jan1 = at('2026-01-01T09:00:00');
  eq2('r:lastmon on 1 Jan is DECEMBER, of the previous year', JSON.stringify(R('r:lastmon', jan1)), JSON.stringify({ from: '2025-12-01', to: '2025-12-31' }));
  eq2('r:yday on 1 Jan is 31 Dec, of the previous year', R('r:yday', jan1).from, '2025-12-31');
  eq2('r:week across the rollover reaches into December', R('r:week', jan1).from, '2025-12-29');
  eq2('r:year on 1 Jan is that one day, not the old year', JSON.stringify(R('r:year', jan1)), JSON.stringify({ from: '2026-01-01', to: '2026-01-01' }));
  /* Leap day: Feb 2028 has 29 days. `new Date(y, m, 0)` asks the calendar rather
     than a 30/31 table, so this is free — but only if nobody replaces it. */
  eq2('r:lastmon in March 2028 ends on the LEAP day', R('r:lastmon', at('2028-03-10T12:00:00')).to, '2028-02-29');

  /* ── the month grid + year button, through the SAME resolver ──
     This is what let reports delete its private ranges(): a month IS a span. */
  eq2('a grid cell resolves to the whole month, last day and all', JSON.stringify(R('2026-02')), JSON.stringify({ from: '2026-02-01', to: '2026-02-28' }));
  eq2('  including a leap February — asked of the calendar, not a table', R('2028-02').to, '2028-02-29');
  eq2('the year button resolves to the whole year', JSON.stringify(R('2026')), JSON.stringify({ from: '2026-01-01', to: '2026-12-31' }));
  eq2('all time has no bounds (buildReport reads null as unbounded)', JSON.stringify(R('all')), JSON.stringify({ from: null, to: null }));

  /* ── custom range ── */
  eq2('c:FROM..TO is the span it says', JSON.stringify(R('c:2026-04-01..2026-06-30')), JSON.stringify({ from: '2026-04-01', to: '2026-06-30' }));
  eq2('a BACKWARDS custom pick is swapped, not silently empty', JSON.stringify(R('c:2026-06-30..2026-04-01')), JSON.stringify({ from: '2026-04-01', to: '2026-06-30' }));
  eq2('a half-filled custom range is NOT a span — it must filter nothing yet, not everything from one date', JSON.stringify(R('c:2026-04-01..')), JSON.stringify({ from: null, to: null }));
  eq2('an unknown range key invents no span', JSON.stringify(R('r:fortnight')), JSON.stringify({ from: null, to: null }));
  eq2('the object form is accepted as-is (buildReport already speaks it)', JSON.stringify(R({ from: '2026-04-01', to: '2026-06-30' })), JSON.stringify({ from: '2026-04-01', to: '2026-06-30' }));

  /* ══ inPeriod over a span — BOTH endpoints inclusive ══
     An exclusive `to` drops every sale made on the last day of the range, which
     for "Today" is every sale he has made today: the filter would read empty all
     morning and he would think the app lost his books. */
  const I = P.inPeriod;
  const q = 'c:2026-04-01..2026-06-30';
  ok(I('2026-04-01', q), 'custom range INCLUDES its first day');
  ok(I('2026-06-30', q), 'custom range INCLUDES its last day — an exclusive `to` silently drops today\'s sales');
  ok(I('2026-05-15', q), 'custom range includes the middle');
  ok(!I('2026-03-31', q), 'custom range excludes the day before it');
  ok(!I('2026-07-01', q), 'custom range excludes the day after it');
  ok(!I('', q) && !I(null, q), 'a row with no date is in no span — and does not throw');
  ok(I('2026-04-10T14:00:00', q), 'a date carrying a time still lands inside the span');

  /* ══ THE TRUNCATION TRAP ══
     inPeriod is called with a bare 'YYYY-MM' on two surfaces (monthlyRegister IS
     a list of months). A naive string compare reads '2026-05' as BEFORE
     '2026-05-01' and drops it — the month vanishes from the register the moment a
     span is picked. A stored value is a span too, and the test is OVERLAP. */
  ok(I('2026-05', q), 'a bare MONTH value overlaps a span that covers it — not dropped by a string compare');
  ok(I('2026-06', q), '  the span\'s LAST month overlaps even though "2026-06" < "2026-06-30"');
  ok(I('2026-04', q), '  and its first, even though "2026-04" > "2026-04-01" is false');
  ok(!I('2026-07', q), '  a month wholly outside the span is still out');
  ok(I('2026-03', 'c:2026-03-31..2026-04-02'), 'a month overlapping by ONE day is in (the register lists that month)');
  ok(I('2026', q), 'a bare YEAR value overlaps a span inside it');
  ok(!I('2025', q), '  but a year that does not is out');

  /* ══ THE PREFIX FORMS STILL WORK ══
     Every page depends on these. The span dispatch runs FIRST, so if it were too
     eager ('2026-03' mistaken for a range) it would take the whole app down at
     once. Re-asserted here against the range-aware implementation. */
  ok(I('2026-03-14', '2026-03'), 'prefix form: a March date is still in March');
  ok(!I('2026-04-01', '2026-03'), 'prefix form: an April date is still not in March');
  ok(I('2026-03-14', '2026'), 'prefix form: the year still widens');
  ok(I('2026-03-14', 'all') && I('2026-03-14', null), 'prefix form: all/null still take everything');
  ok(I('2026-03', '2026-03') && I('2026-03', '2026'), 'prefix form: the bare-month VALUE still matches its month and year (qlx + monthlyRegister)');

  /* ══ RELATIVE MEANS RELATIVE TO NOW ══
     "a tab left open overnight must not still mean yesterday". rangeSpan reads
     the clock on every call; a table computed once at load would not. */
  eq2('r:today is resolved from the clock at CALL time, not cached at load (before midnight)', R('r:today', at('2026-07-14T23:59:59')).from, '2026-07-14');
  eq2('  and after midnight the SAME period string means the new day', R('r:today', at('2026-07-15T00:00:01')).from, '2026-07-15');
  ok(P.RANGE_KEYS.every(k => { const s = R('r:' + k, tue); return s.from && s.to && s.from <= s.to; }),
    'every named range resolves to a real, non-inverted span (from <= to)');

  /* ══ THE LABEL FOLLOWS THE PICK ══
     The button is the only place he can see WHAT he is looking at. */
  const L = P.periodLabel;
  eq2('label: a named range says its name', L('r:week'), 'This week');
  eq2('label: Quarter', L('r:quarter'), 'Quarter');
  eq2('label: a custom span reads as a span, with the year', L('c:2026-04-01..2026-06-30'), '01 Apr – 30 Jun 2026');
  eq2('label: a span ACROSS a year shows both years — "01 Dec – 31 Jan" would read as impossible', L('c:2025-12-01..2026-01-31'), '01 Dec 2025 – 31 Jan 2026');
  eq2('label: a one-day custom span is a date, not "x – x"', L('c:2026-04-01..2026-04-01'), '01 Apr 2026');
  eq2('label: a half-picked custom range says so — never a fake span', L('c:2026-04-01..'), 'Custom range');
  eq2('label: the month grid is untouched by any of this', L('2026-06'), 'June 2026');
}

/* ══════════ 12. THE NUMBERS MOVE FOR A RANGE TOO ══════════
   Section 10 proves a month rescopes the money. A span must too — through the
   same gstSummary(), i.e. through every page's data path, not a reports-only one. */
{
  S.SALES.length = 0;
  const sale = (date, rate) => ({ date, qty: 100, rate, gstR: 5, gstin: '08AAA0000A1Z5', status: 'pending' });
  S.SALES.push(sale('2026-04-10', 100));   // taxable 10,000 — Q1 (Apr–Jun)
  S.SALES.push(sale('2026-06-30', 200));   // taxable 20,000 — Q1, LAST day
  S.SALES.push(sale('2026-07-01', 400));   // taxable 40,000 — the day AFTER

  eq2('a custom span sums only what is inside it', Math.round(P.gstSummary('c:2026-04-01..2026-06-30').taxable), 30000);
  eq2('  the boundary sale is IN (inclusive `to`, through the real data path)', Math.round(P.gstSummary('c:2026-06-30..2026-06-30').taxable), 20000);
  eq2('  and the next day is OUT', Math.round(P.gstSummary('c:2026-04-01..2026-06-29').taxable), 10000);
  eq2('a span with no books is ₹0, not all-time', Math.round(P.gstSummary('c:2026-01-01..2026-01-31').taxable), 0);
  eq2('all time still sees every sale', Math.round(P.gstSummary('all').taxable), 70000);
}

/* ══════════ 10. THE NUMBERS MOVE ══════════
   The proof the static checks cannot give: pick a month, and the money CHANGES.
   Two sales in two different months and one in another year — if any assertion
   below reads the all-time total, the filter is decorative. */
{
  S.SALES.length = 0;
  const sale = (date, rate) => ({ date, qty: 100, rate, gstR: 5, gstin: '08AAA0000A1Z5', status: 'pending' });
  S.SALES.push(sale('2026-03-10', 100));   // taxable 10,000 · GST 500
  S.SALES.push(sale('2026-07-10', 200));   // taxable 20,000 · GST 1,000
  S.SALES.push(sale('2025-07-10', 400));   // taxable 40,000 · GST 2,000 — LAST year

  eq2('all time is every sale', Math.round(P.gstSummary('all').taxable), 70000);
  eq2('March 2026 is March 2026 alone', Math.round(P.gstSummary('2026-03').taxable), 10000);
  eq2('July 2026 is a DIFFERENT number — the picker moves the money', Math.round(P.gstSummary('2026-07').taxable), 20000);
  /* The year: wider than a month, narrower than all time. A `slice(0,7) ===`
     filter returns 0 here, and an unwired one returns 70000. Both are wrong, and
     only this assertion tells them apart. */
  eq2('Year 2026 WIDENS to both 2026 months', Math.round(P.gstSummary('2026').taxable), 30000);
  eq2('  and excludes 2025 — a year is a year, not "everything"', Math.round(P.gstSummary('2025').taxable), 40000);
  eq2('the output GST scopes with it (not just the taxable value)', Math.round(P.gstSummary('2026-03').outGST), 500);
  eq2('a month with no books is ₹0, not all-time', Math.round(P.gstSummary('2026-01').taxable), 0);
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
