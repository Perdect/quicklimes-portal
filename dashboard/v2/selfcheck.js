/* ═══════════════════════════════════════════════════════════════════════
   selfcheck.js — the app checks its own books, against the OWNER'S data.

   He asked: "If you cannot test from here, who will test??"

   Fair. My tests prove the code is right against fixtures I invent. They cannot
   prove it is right against HIS 26 bills and 74 bank lines, because I never see
   those — they live in a blob on his server. So I kept saying "I can't verify your
   books", which put the job back on him. He is a lime manufacturer. He is not the
   test harness.

   THIS RUNS IN HIS BROWSER, WHERE THE REAL DATA ALREADY IS.

   The principle: any figure computed TWO ways must agree. The app is full of such
   pairs — that is exactly how today's real bugs were found (the P&L dropped IGST
   while the dashboard's card had it; Inventory and the Purchase Dashboard valued
   the same 16 bills ₹13.5L apart). Each was one screen disagreeing with another.
   A check that compares them needs no fixture and no tester: the data is the
   fixture, and it is his.

   RULES THIS FILE LIVES BY:
   · It NEVER writes. Read-only, always — a self-check that repairs is a self-check
     nobody can trust, and a wrong "repair" on real books is unrecoverable.
   · A check that CANNOT run (a missing store, an empty month) reports "skipped",
     never "passed". A green tick for a check that never executed is the exact lie
     this file exists to catch.
   · Tolerance is one rupee, for float dust — never more. A ₹2 gap is a real gap.
   · Every failure names BOTH figures and BOTH sources, so the next step is obvious
     rather than a hunt.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var RS = 1;   // one rupee — float dust only, never a real difference

  function n(x) { return Math.round(+x || 0); }
  function near(a, b) { return Math.abs(n(a) - n(b)) <= RS; }

  /* Each check returns { id, what, ok, skipped, a, b, srcA, srcB, note }.
     `skipped` is a first-class outcome: it means "this could not be evaluated",
     which is information, not success. */
  function CHECKS(Q) {
    var out = [];
    var add = function (o) { out.push(o); };
    var have = function (fn) { return Q && typeof Q[fn] === 'function'; };

    /* ── 1. GST: the ladder must reconcile ────────────────────────
       Output − ITC = net payable, floored at zero. Two functions compute output
       tax (gstSummary and getPL) and they disagreed until today: getPL summed
       cgst+sgst and dropped IGST entirely, so every inter-state sale showed no
       output tax there while the dashboard card showed it. This is that exact bug,
       as a check that runs on his own invoices. */
    if (have('gstSummary') && have('getPL')) {
      var gs = Q.gstSummary(), pl = Q.getPL();
      add({ id: 'gst-output', what: 'GST output tax agrees between the GST summary and the P&L',
        ok: near(gs.outGST, pl.outGST), a: gs.outGST, b: pl.outGST,
        srcA: 'GST page (gstSummary)', srcB: 'P&L (getPL)',
        note: 'If these differ, one screen is dropping a tax head — IGST is the usual one.' });
      add({ id: 'gst-net', what: 'Net GST payable is never negative',
        ok: n(gs.net) >= 0, a: gs.net, b: 0, srcA: 'gstSummary().net', srcB: 'zero floor',
        note: 'A liability floors at zero; excess ITC carries forward, it does not become a refund here.' });
      add({ id: 'gst-itc', what: 'ITC agrees between the GST summary and the P&L',
        ok: near(gs.itc, pl.itc), a: gs.itc, b: pl.itc, srcA: 'gstSummary().itc', srcB: 'getPL().itc',
        note: 'Both read purchase bills; a gap means one is counting cancelled or trashed bills.' });
    } else add({ id: 'gst-output', what: 'GST checks', skipped: true, note: 'gstSummary/getPL unavailable' });

    /* ── 2. Revenue: the P&L and the register must sum the same invoices ── */
    if (have('getPL') && have('salesRows')) {
      var rows = Q.salesRows().filter(function (r) { return r.status !== 'cancelled'; });
      var regTaxable = rows.reduce(function (a, r) { return a + (+r.taxable || 0); }, 0);
      var p = Q.getPL();
      add({ id: 'revenue', what: 'Revenue on the P&L equals the Sales register',
        ok: near(p.rev, regTaxable), a: p.rev, b: regTaxable,
        srcA: 'P&L revenue', srcB: 'Sales register (taxable, cancelled excluded)',
        note: 'Both are ex-GST. A gap means one includes cancelled or trashed invoices.' });
    } else add({ id: 'revenue', what: 'Revenue check', skipped: true, note: 'getPL/salesRows unavailable' });

    /* ── 3. Cost of goods: the P&L and the Purchase register ────── */
    if (have('getPL') && have('purchaseRows')) {
      var pr = Q.purchaseRows().filter(function (r) { return r.status !== 'cancelled'; });
      var regCost = pr.reduce(function (a, r) { return a + (+r.taxable || 0); }, 0);
      var p2 = Q.getPL();
      add({ id: 'cogs', what: 'Cost of goods on the P&L equals the Purchase register',
        ok: near(p2.cogs, regCost), a: p2.cogs, b: regCost,
        srcA: 'P&L cogs', srcB: 'Purchase register (taxable, cancelled excluded)',
        note: 'Both ex-GST — the GST on a purchase is reclaimable input credit, not a cost.' });
      add({ id: 'cogs-nan', what: 'Cost of goods is a real number, not NaN',
        ok: isFinite(p2.cogs), a: p2.cogs, b: 'a number', srcA: 'P&L cogs', srcB: '—',
        note: 'One bill with no taxable amount can poison the whole figure and every margin below it.' });
    } else add({ id: 'cogs', what: 'COGS check', skipped: true, note: 'getPL/purchaseRows unavailable' });

    /* ── 4. Outstanding: the register vs the party ledger ─────────
       The riskiest number in the app — it is what he chases customers for. */
    if (have('salesRows') && have('partyLedger') && have('partyRows')) {
      var recv = Q.salesRows().filter(function (r) { return r.status !== 'cancelled'; })
        .reduce(function (a, r) { return a + (+r.outstanding || 0); }, 0);
      var ledSum = 0, ledOk = true;
      try {
        Q.partyRows().forEach(function (pt) {
          var L = Q.partyLedger(pt.idx);
          if (L && typeof L.pending === 'number' && L.pending > 0) ledSum += L.pending;
        });
      } catch (_) { ledOk = false; }
      if (ledOk) {
        add({ id: 'receivable', what: 'Receivables agree between the Sales register and the party ledgers',
          ok: near(recv, ledSum), a: recv, b: ledSum,
          srcA: 'Sales register (sum of outstanding)', srcB: 'Party ledgers (sum of pending)',
          note: 'This is what you chase customers for. A gap means an invoice or a receipt is counted on one side only.' });
      } else add({ id: 'receivable', what: 'Receivables check', skipped: true, note: 'partyLedger threw' });
    } else add({ id: 'receivable', what: 'Receivables check', skipped: true, note: 'salesRows/partyLedger unavailable' });

    /* ── 5. Cash: two functions bucket the same entries ───────────
       accountBalances() and cashbookBalances() now share one rule (liveMoney +
       methodToMode). cashbookBalances returns the UPI money under BOTH `upi`
       and the legacy `phonepay` key — the same number twice, an alias, so this
       check must count it ONCE or it manufactures the very mismatch it exists
       to catch. accountBalances alone carries opening balances; compare the
       moved money, not the openings. */
    if (have('accountBalances') && have('cashbookBalances')) {
      var ab = Q.accountBalances(), cb = Q.cashbookBalances();
      var opening = (Q.state && Q.state.FINANCE && Q.state.FINANCE.opening) || {};
      var openSum = (+opening.cash || 0) + (+opening.bank || 0) + (+opening.upi || 0);
      add({ id: 'cash-total', what: 'The cash book totals the same on the dashboard and the Command Center',
        ok: near((ab.cash || 0) + (ab.bank || 0) + (ab.upi || 0) - openSum, (cb.cash || 0) + (cb.bank || 0) + (cb.upi || 0)),
        a: (ab.cash || 0) + (ab.bank || 0) + (ab.upi || 0) - openSum,
        b: (cb.cash || 0) + (cb.bank || 0) + (cb.upi || 0),
        srcA: 'Dashboard (accountBalances, openings excluded)', srcB: 'Command Center (cashbookBalances)',
        note: 'Two functions bucket the same entries. If they differ, one is dropping a payment mode.' });
    } else add({ id: 'cash-total', what: 'Cash check', skipped: true, note: 'balance functions unavailable' });

    /* ── 6. Trashed records must not count anywhere ───────────────
       Bin a ₹10L invoice: it leaves the register. It must also leave the tax.
       This one is only meaningful if he HAS trashed something. */
    if (have('salesRows') && Q.state && Q.state.SALES) {
      var trashed = Q.state.SALES.filter(function (s) { return s._del || s._arch; }).length;
      if (!trashed) {
        add({ id: 'trashed', what: 'Trashed invoices are excluded from GST', skipped: true,
          note: 'Nothing is in the Trash, so there is nothing to check.' });
      } else {
        var visible = Q.salesRows().length;
        var live = Q.state.SALES.filter(function (s) { return !s._del && !s._arch; }).length;
        add({ id: 'trashed', what: 'Trashed invoices stay out of the Sales register',
          ok: visible <= live, a: visible, b: live,
          srcA: 'salesRows() count', srcB: 'live records in the store',
          note: trashed + ' invoice(s) in the Trash. They must not appear in the register or in your GST.' });
      }
    }

    /* ── 7. A bill's own arithmetic ───────────────────────────────
       total = taxable + GST. Not an opinion — arithmetic. Catches a corrupted row
       that every summary above would then quietly carry. */
    if (have('purchaseRows')) {
      var bad = Q.purchaseRows().filter(function (r) {
        if (r.status === 'cancelled') return false;
        if (r.itc === 'RCM') return false;                       // RCM total excludes GST by design
        return !near((+r.taxable || 0) + (+r.gst || 0), +r.total || 0);
      });
      add({ id: 'bill-math', what: 'Every purchase bill adds up (taxable + GST = total)',
        ok: bad.length === 0, a: bad.length + ' bill(s) do not add up', b: '0',
        srcA: 'purchaseRows()', srcB: 'arithmetic',
        note: bad.length ? 'First: ' + (bad[0].bill || '(no number)') + ' — ' + (bad[0].sup || '') : 'RCM bills are excluded: their total legitimately excludes GST.' });
    }

    return out;
  }

  function run() {
    var Q = root.QLD;
    if (!Q) return { ran: 0, passed: 0, failed: 0, skipped: 0, checks: [], error: 'QLD not loaded' };
    var checks;
    try { checks = CHECKS(Q); }
    catch (e) { return { ran: 0, passed: 0, failed: 0, skipped: 0, checks: [], error: (e && e.message) || 'check run failed' }; }
    var passed = checks.filter(function (c) { return !c.skipped && c.ok; }).length;
    var failed = checks.filter(function (c) { return !c.skipped && !c.ok; }).length;
    var skipped = checks.filter(function (c) { return c.skipped; }).length;
    return { ran: passed + failed, passed: passed, failed: failed, skipped: skipped, checks: checks };
  }

  var API = { run: run, RUPEE_TOLERANCE: RS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.QLSelfCheck = API;
})(typeof window !== 'undefined' ? window : globalThis);
