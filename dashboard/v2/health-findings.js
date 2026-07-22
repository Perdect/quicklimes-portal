/* ═══════════════════════════════════════════════════════════════════════════
   App Health — the findings themselves.

   Source: the 18 Jul 2026 audit (12 parallel auditors → 36 raw findings → each
   independently re-verified → 25 confirmed, 1 refuted, 10 cut off by a session
   limit and therefore never checked at all).

   Every `status` below was RE-CHECKED against the code on 22 Jul 2026 and each
   one carries the evidence that decided it. The distinction that matters:

     fixed     — re-read the code today, the bug is gone, `where` says why
     open      — re-read the code today, the bug is still there
     unchecked — confirmed on 18 Jul, NOT re-read today; may or may not be live
     awaiting  — never verified by anyone; a claim, not a finding

   `unchecked` and `awaiting` are deliberately not merged into `open`. A board
   that guesses is worse than no board — the whole point of the audit was that
   77 green test suites had pinned two of these bugs as documented behaviour.

   ── The one rule behind almost all of it ──
   `notCancelled` (data.js:385) and `liveMoney` (data.js:796) say what a live
   record is. `withIdx` (data.js:790) already strips _del/_arch, so anything
   built on salesRows()/purchaseRows() is deleted-safe and leaks only CANCELLED
   rows. Anything reading S.SALES / S.PURCHASES raw leaks both. That single
   split explains which findings below are bad and which are worse.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const AUDIT_DATE = '2026-07-18';
  const RECHECK_DATE = '2026-07-22';

  const FINDINGS = [
    /* ── fixed & verified ─────────────────────────────────────────────── */
    {
      id: 'cashbook-deleted', sev: 'high', status: 'fixed', module: 'Cashbook + Payments',
      title: 'Cash & bank balances counted deleted entries',
      what: 'Deleting a wrong payment removed the row but never the money — the header could read “0 entries · Balance ₹1,000”, and because payments can never be purged, no user action could ever correct it.',
      where: 'Fixed. <code>liveMoney</code> (data.js:796) now filters the cashbook, and <code>accountBalances</code> (data.js:2134) uses it — trashed entries leave the balance, not just the list.'
    },
    {
      id: 'reupload-gate', sev: 'high', status: 'fixed', module: 'Bulk import + OCR',
      title: 'A deleted bill passed review, then the save gate refused it',
      what: 'The review screen was fixed first, but the gate behind it still compared against every record including deleted ones — so a re-upload got a green review and then failed at save.',
      where: 'Fixed. <code>dupCheck</code> (data.js:638) applies the same live-record rule as the review: <code>!x._del &amp;&amp; !x._arch &amp;&amp; status !== "cancelled"</code>. One rule, both doors.'
    },
    {
      id: 'upi-bucket', sev: 'med', status: 'fixed', module: 'Data core',
      title: 'UPI money fell out of the cash-mode split',
      what: 'The splitter looked for a mode named “phonepay” while payments were saved as “upi”, so every UPI rupee landed in no bucket at all.',
      where: 'Fixed. <code>methodToMode</code> (data.js:2126) now matches <code>/phonep|google|gpay|upi/</code> → <code>upi</code>.'
    },
    {
      id: 'sales-footer', sev: 'med', status: 'fixed', module: 'Sales register',
      title: 'Register footer and month subtotals included voided invoices',
      what: 'The table footer disagreed with the stat cards directly above it — the cards excluded voided invoices, the footer did not.',
      where: 'Fixed. Both the on-screen stats (sales.js:230) and the printable report (sales.js:361) build totals from <code>rows.filter(r =&gt; r.status !== "cancelled")</code>.'
    },
    {
      id: 'finance-outstanding', sev: 'med', status: 'fixed', module: 'GST + Finance',
      title: 'Customer outstanding / overdue included deleted invoices',
      what: 'The Finance receivables tiles counted invoices that had been thrown away.',
      where: 'Fixed. <code>customerOutstanding</code> (finance.js:617) reads <code>salesRows()</code>, which is deleted-safe via <code>withIdx</code>, and filters to <code>status === "pending"</code> so cancelled rows drop out too.'
    },
    {
      id: 'dashboard-gst-tab', sev: 'med', status: 'fixed', module: 'Dashboard',
      title: 'GST analytics tab included cancelled invoices',
      what: 'One tab disagreed with every other tab on the same page.',
      where: 'Fixed. The dashboard month slices (dashboard.js:72–73 and 101–102) all filter <code>r.status !== "cancelled"</code>.'
    },

    /* ── still open, re-confirmed today ───────────────────────────────── */
    {
      id: 'monthly-register', sev: 'high', status: 'open', module: 'Data core',
      title: 'Monthly Register counts cancelled AND trashed documents',
      what: 'The month table reports sales, tonnage, GST and profit for documents you cancelled or deleted, and so contradicts the Dashboard beside it. A month containing nothing but cancelled invoices still shows as a month with activity.',
      where: 'Still open — the worst of the family. <code>monthlyRegister</code> (data.js:2350–2351) reads <code>S.SALES</code> / <code>S.PURCHASES</code> <b>raw</b>, filtering only by month, so it leaks deleted <em>and</em> cancelled rows.'
    },
    {
      id: 'party-ledger', sev: 'high', status: 'open', module: 'Parties + CRM',
      title: 'Party ledger balances include cancelled invoices and bills',
      what: 'The running account you keep per customer and supplier posts cancelled documents into the balance, so the outstanding on a statement is wrong.',
      where: 'Still open. <code>partyLedger</code> (data.js:1524, 1531) walks <code>salesRows()</code> / <code>purchaseRows()</code> with no status test. Deleted rows are already excluded by <code>withIdx</code>; cancelled ones are not.'
    },
    {
      id: 'parties-health', sev: 'high', status: 'open', module: 'Parties + CRM',
      title: 'Customer health scores & dues built on cancelled invoices',
      what: 'A customer’s sales total, dues, current balance and health score all count invoices you voided — so a good customer can be shown as a defaulter.',
      where: 'Still open. The aggregation at parties.js:82–88 sums every row from <code>Q.salesRows()</code> without a cancelled test — even though the same file does test for it at lines 370 and 437.'
    },
    {
      id: 'gst-tracker', sev: 'med', status: 'open', module: 'GST + Finance',
      title: 'GST tracker counts cancelled and deleted bills in Collected / ITC / Net',
      what: 'Input credit reads higher than what you could actually claim.',
      where: 'Still open. <code>gstMonths</code> (finance.js:647–648) reads <code>QLD.state.SALES</code> / <code>PURCHASES</code> raw. <code>finance.js</code> does not contain the word “cancelled” anywhere.'
    },
    {
      id: 'manufacturing-tiles', sev: 'med', status: 'open', module: 'Dashboard',
      title: 'Manufacturing tiles count cancelled purchase bills',
      what: 'Tonnage, spend, yield and cost-per-ton include bills you voided.',
      where: 'Still open. <code>matTons</code> (dashboard.js:55) filters <code>purchaseRows()</code> by group only — no status test — while the tabs above it do test. Same page, two answers.'
    },
    {
      id: 'purchase-by-group', sev: 'med', status: 'open', module: 'Purchase register',
      title: 'Cancelled bills leak into spend-by-group analytics',
      what: 'The group bars, and the dashboard card fed by them, include voided bills.',
      where: 'Still open. <code>purchaseByGroup</code> (data.js:1430) consumes all of <code>purchaseRows()</code>.'
    },
    {
      id: 'activity-feed', sev: 'low', status: 'open', module: 'Data core',
      title: 'Activity feed lists trashed and cancelled records as live',
      what: 'The recent-activity feed shows documents that no longer exist.',
      where: 'Still open. <code>activity</code> (data.js:1060, 1064) iterates <code>S.SALES</code> / <code>S.PURCHASES</code> raw.'
    },
    {
      id: 'count-vs-tonnage', sev: 'low', status: 'open', module: 'Sales register',
      title: '“Total invoices” disagrees with the tonnage printed under it',
      what: 'The headline count includes cancelled invoices while its own sub-line excludes them, so the two numbers in a single card contradict each other.',
      where: 'Still open. sales.js:236 — <code>value: rows.length</code> (every status) beside <code>sub: fmt(qty)</code> built from the cancelled-free <code>nc</code>. The printable report repeats it.'
    },
    {
      id: 'production-period-dead', sev: 'low', status: 'open', module: 'Production',
      title: 'productionPeriod() is built but never called',
      what: 'Dead code — no behaviour, but it reads as a feature that exists.',
      where: 'Still open. Defined and exported in data.js; no caller anywhere in the app.'
    },

    /* ── confirmed 18 Jul, NOT re-checked today ───────────────────────── */
    {
      id: 'insights-trashed', sev: 'med', status: 'unchecked', module: 'Data core',
      title: 'Insights & notifications count trashed pending bills',
      what: '“Bills pending” nudges may include bills already thrown away.',
      where: 'Not re-checked on ' + RECHECK_DATE + '. The counter lives near data.js:2158 (<code>pendingBills</code>); its <code>openBills</code> source was not traced.'
    },
    {
      id: 'sales-ai-banner', sev: 'med', status: 'unchecked', module: 'Sales register',
      title: 'AI insights banner counted voided invoices',
      what: 'Tons, trucks, sales and invoice counts in the banner included voided documents.',
      where: 'Not re-checked — no separate insights banner was found in sales.js today, so this may have been removed or folded into the cards rather than fixed. Needs a look before it is called either way.'
    },
    {
      id: 'dashboard-top-parties', sev: 'med', status: 'unchecked', module: 'Dashboard',
      title: 'Top customers / suppliers count cancelled and show a fake “due”',
      what: 'The leaderboard totals include voided documents and display an outstanding that is not real.',
      where: 'Not re-checked on ' + RECHECK_DATE + '. Reported at dashboard.js:351; the nearby month slices were fixed, this one was not confirmed either way.'
    },
    {
      id: 'loan-emi', sev: 'low', status: 'unchecked', module: 'GST + Finance',
      title: 'Loan EMI marked fully paid whatever amount you enter',
      what: 'Pay a partial EMI and the whole installment is marked paid, dropping the outstanding by the full amount.',
      where: 'Not re-checked on ' + RECHECK_DATE + '.'
    },
    {
      id: 'recon-self-filter', sev: 'low', status: 'unchecked', module: 'Reconciliation',
      title: 'An inert self-exclusion filter',
      what: 'Harmless — a filter that never matches. Tidy-up only.',
      where: 'Not re-checked on ' + RECHECK_DATE + '. Reported at reconcile.js:116.'
    },

    /* ── never verified by anyone (verifier hit a session limit) ──────── */
    { id: 'aw-mobile-recent', sev: 'med', status: 'awaiting', module: 'Dashboard + Mobile',
      title: 'Mobile “Recent invoices” may list cancelled invoices',
      what: 'Claimed but never reproduced.', where: 'Verifier was cut off before confirming.' },
    { id: 'aw-rcm', sev: 'high', status: 'awaiting', module: 'Invoice builder',
      title: 'Reverse-charge selector may be dead (always prints “No”)',
      what: 'If true, RCM invoices print wrong — which is a compliance problem, not a cosmetic one.', where: 'Verifier was cut off before confirming.' },
    { id: 'aw-pos', sev: 'med', status: 'awaiting', module: 'Invoice builder',
      title: 'Place of Supply collected but possibly never printed',
      what: 'Rule 46 requires it on the invoice.', where: 'Verifier was cut off before confirming.' },
    { id: 'aw-igst', sev: 'high', status: 'awaiting', module: 'Invoice builder',
      title: 'CGST/IGST split may rely on the buyer GSTIN prefix alone',
      what: 'If true, an unregistered out-of-state sale is taxed intra-state.', where: 'Verifier was cut off before confirming.' },
    { id: 'aw-ai-rates', sev: 'med', status: 'awaiting', module: 'Shell + wiring',
      title: 'AI assistant’s supplier-rate compare may average deleted bills',
      what: 'Same deleted-records family if confirmed.', where: 'Verifier was cut off before confirming.' },
    { id: 'aw-cmdk', sev: 'med', status: 'awaiting', module: 'Shell + wiring',
      title: 'Cmd+K search may surface trashed records as live',
      what: 'Claimed but never reproduced.', where: 'Verifier was cut off before confirming.' },
    { id: 'aw-pay-modal', sev: 'low', status: 'awaiting', module: 'Shell + wiring',
      title: 'A payment modal that may be dead',
      what: 'Low if confirmed.', where: 'Verifier was cut off before confirming.' },
    { id: 'aw-breadcrumb', sev: 'low', status: 'awaiting', module: 'Shell + wiring',
      title: 'No-op breadcrumb / notification dot',
      what: 'Low if confirmed.', where: 'Verifier was cut off before confirming.' },
    { id: 'aw-donut', sev: 'low', status: 'awaiting', module: 'Shell + wiring',
      title: 'Dark-mode donut rendering',
      what: 'Low if confirmed.', where: 'Verifier was cut off before confirming.' },
    { id: 'aw-helper', sev: 'low', status: 'awaiting', module: 'Shell + wiring',
      title: 'An unused helper',
      what: 'Low if confirmed.', where: 'Verifier was cut off before confirming.' }
  ];

  /* Clean modules — audited, nothing confirmed. Worth showing: an audit that
     only ever lists problems reads as if the whole app is broken. */
  const CLEAN = [
    ['Invoice PDF', 'GST maths & Rule 46 compliance passed with no confirmed findings'],
    ['Recon engine', 'Bank-statement parsing passed — 44-test engine, 3 suites'],
    ['OCR reading', 'Field-reading passed its audit with no confirmed findings'],
    ['Production + Inventory', 'Derived tonnage correctly excludes deleted bills']
  ];

  const counts = () => FINDINGS.reduce((a, f) => {
    a[f.status] = (a[f.status] || 0) + 1;
    if (f.status === 'open') a.openBySev[f.sev] = (a.openBySev[f.sev] || 0) + 1;
    return a;
  }, { openBySev: {} });

  root.HealthBoard = {
    AUDIT_DATE, RECHECK_DATE, FINDINGS, CLEAN, counts,
    MODULES_AUDITED: 12,
    RAW_FINDINGS: 36,
    CONFIRMED: 25,
    REFUTED: 1,
    byStatus: s => FINDINGS.filter(f => f.status === s)
  };
})(typeof window !== 'undefined' ? window : globalThis);
