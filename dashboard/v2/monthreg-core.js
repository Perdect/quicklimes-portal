/* ═══════════════════════════════════════════════════════════════════════
   MONTHLY REGISTER — the calculation engine.

   Pure: rows in, numbers out. No DOM, no storage, no QLD. monthreg-core.test.js
   drives this same code, and monthreg.html renders what it returns.

   ── WHAT THE AUDIT FOUND, AND WHAT THIS FIXES ──────────────────────────

   1. THE COLUMNS DID NOT ADD UP. The old table showed "Sales" GST-INCLUSIVE
      (₹2,26,11,271), "Purchases" GST-EXCLUSIVE (₹1,20,98,470) and a "Gross
      Profit" of ₹94,36,073 computed from taxable sales. On screen,
      Sales − Purchases = ₹1,05,12,801 — off by ₹10,76,728, exactly the output
      GST. Three columns, two different bases, no way for the reader to check
      the arithmetic.

      Here both sides are reported on BOTH bases, explicitly named: `netSales`
      / `netPurchases` are taxable (GST-excluded) and are what gross profit is
      built from; `grossSales` / `grossPurchases` include GST. The page labels
      which is which, and grossProfit === netSales − netPurchases, always.

   2. CANCELLED INVOICES WERE COUNTED. monthlyRegister() dropped deleted and
      archived rows but not cancelled ones, while gstSummary and getPL drop all
      three. Same book, two answers. `live()` here applies the same rule as
      data.js's notCancelled.

   3. PURCHASE QUANTITY IS MOSTLY MISSING — 19 of 26 bills carry no tonnage.
      So purchase qty is reported as { qty, recorded, missing } and NEVER as a
      bare number: "0 T" and "nobody wrote it down" are different facts, and
      this app has already shipped that bug once on the Inventory page.

   ── WHAT IS NOT HERE, AND WHY ──────────────────────────────────────────
   Sales returns, purchase returns, credit notes and debit notes DO NOT EXIST
   in this data model — no store, no type, no field. They are reported as
   `null` (unavailable), never as 0. A zero would claim there were none.
   Sales carry a `product` field that is empty on every row, so sales-by-
   product is unavailable too; purchases carry a populated `group`, so
   purchase-by-material is real.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var R2 = function (n) { return Math.round((+n || 0) * 100) / 100; };
  var num = function (n) { return +n || 0; };

  /* Same rule as data.js notCancelled: a row that is deleted, archived or
     cancelled is not in the book. */
  function live(r) { return !r._del && !r._arch && (r.status || 'pending') !== 'cancelled'; }
  function ym(d) { return String(d || '').slice(0, 7); }

  /* ── INDIAN FINANCIAL YEAR ───────────────────────────────────────────────
     April → March. A date in Jan–Mar belongs to the FY that STARTED the
     previous calendar year: 2027-02 is FY 2026-27. Getting this wrong moves
     three months of trade into the wrong year, which is why it is one
     function used everywhere rather than a slice() at each call site. */
  function fyOf(dateOrYm) {
    var s = String(dateOrYm || ''); if (s.length < 7) return '';
    var y = +s.slice(0, 4), m = +s.slice(5, 7);
    return String(m >= 4 ? y : y - 1);
  }
  function fyLabel(fy) { var y = +fy; return isFinite(y) ? 'FY ' + y + '–' + String(y + 1).slice(2) : ''; }
  /* The twelve months of an FY, April first — the order the register reads in. */
  function fyMonths(fy) {
    var y = +fy, out = [];
    for (var i = 0; i < 12; i++) {
      var mm = 4 + i, yy = y;
      if (mm > 12) { mm -= 12; yy = y + 1; }
      out.push(yy + '-' + (mm < 10 ? '0' : '') + mm);
    }
    return out;
  }
  function monthName(m) {
    var N = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var p = String(m || '').split('-');
    return p.length === 2 ? N[+p[1] - 1] + ' ' + p[0] : String(m || '');
  }
  /* Every FY that holds a transaction, newest first. */
  function fysIn(sales, purchases) {
    var s = {};
    (sales || []).concat(purchases || []).forEach(function (r) {
      if (!live(r)) return;
      var f = fyOf(r.date); if (f) s[f] = 1;
    });
    return Object.keys(s).sort().reverse();
  }

  /* ── ONE MONTH ───────────────────────────────────────────────────────────
     Every figure this register can honestly produce for a single month. */
  function monthStats(sales, purchases, m) {
    var sal = (sales || []).filter(function (r) { return live(r) && ym(r.date) === m; });
    var pur = (purchases || []).filter(function (r) { return live(r) && ym(r.date) === m; });

    var netSales = 0, gstOut = 0, grossSales = 0, sQty = 0, collected = 0, outstanding = 0;
    var cgstOut = 0, sgstOut = 0, igstOut = 0;
    sal.forEach(function (r) {
      var tx = num(r.taxable), g = num(r.gst);
      netSales += tx; gstOut += g; grossSales += num(r.total) || (tx + g);
      sQty += num(r.qty);
      collected += num(r.paid); outstanding += num(r.outstanding);
      /* Inter-state is IGST; the seller is in Rajasthan (state code 08). A sale
         with no GSTIN cannot be classified, so it is counted as intra-state —
         the same assumption data.js makes — and surfaced as an exception. */
      var gs = String(r.gstin || '');
      if (gs.length >= 2 && gs.slice(0, 2) !== '08') igstOut += g;
      else { cgstOut += g / 2; sgstOut += g / 2; }
    });

    var netPurch = 0, gstIn = 0, grossPurch = 0, pQtySum = 0, pQtyRecorded = 0, paidOut = 0, purOutstanding = 0;
    pur.forEach(function (r) {
      var tx = num(r.taxable);
      netPurch += tx;
      gstIn += num(r.itc);                       // ITC, not gross tax: RCM/ineligible carry none
      grossPurch += num(r.total) || tx;
      if (num(r.qty) > 0) { pQtySum += num(r.qty); pQtyRecorded++; }
      paidOut += num(r.paid); purOutstanding += num(r.outstanding);
    });

    var grossProfit = netSales - netPurch;
    return {
      ym: m, label: monthName(m), fy: fyOf(m),
      invoices: sal.length, bills: pur.length,

      /* Both bases, named. Gross profit is built from the NET pair and
         nothing else, so the arithmetic on screen always checks out. */
      netSales: R2(netSales), grossSales: R2(grossSales), gstOut: R2(gstOut),
      netPurchases: R2(netPurch), grossPurchases: R2(grossPurch), gstIn: R2(gstIn),
      cgstOut: R2(cgstOut), sgstOut: R2(sgstOut), igstOut: R2(igstOut),
      netGst: R2(gstOut - gstIn),

      grossProfit: R2(grossProfit),
      margin: netSales > 0 ? R2(grossProfit / netSales * 100) : null,
      avgInvoice: sal.length ? R2(netSales / sal.length) : null,
      avgBill: pur.length ? R2(netPurch / pur.length) : null,

      salesQty: R2(sQty),
      /* NEVER a bare number. 19 of 26 purchase bills carry no tonnage. */
      purchaseQty: { qty: R2(pQtySum), recorded: pQtyRecorded, missing: pur.length - pQtyRecorded, bills: pur.length },
      salesRatePerT: sQty > 0 ? R2(netSales / sQty) : null,
      profitPerT: sQty > 0 ? R2(grossProfit / sQty) : null,
      purchaseRatePerT: pQtySum > 0 ? R2(netPurch / pQtySum) : null,

      collected: R2(collected), outstanding: R2(outstanding),
      collectionPct: (netSales + gstOut) > 0 ? R2(collected / (netSales + gstOut) * 100) : null,
      purchasePaid: R2(paidOut), purchaseOutstanding: R2(purOutstanding),

      /* No store exists for any of these. null means "cannot be known", which
         is a different statement from 0. */
      salesReturns: null, purchaseReturns: null, creditNotes: null, debitNotes: null,

      _sales: sal, _purchases: pur
    };
  }

  /* Every month that holds a transaction, newest first (the register's order). */
  function register(sales, purchases, opts) {
    opts = opts || {};
    var set = {};
    (sales || []).concat(purchases || []).forEach(function (r) {
      if (!live(r)) return;
      var m = ym(r.date); if (/^\d{4}-\d{2}$/.test(m)) set[m] = 1;
    });
    var months = Object.keys(set);
    if (opts.fy) months = months.filter(function (m) { return fyOf(m) === String(opts.fy); });
    return months.sort().reverse().map(function (m) { return monthStats(sales, purchases, m); });
  }

  /* Totals across a set of month rows. Sums the same fields the rows carry, so
     the footer can never disagree with the column above it. */
  function totals(rows) {
    var t = { months: rows.length, invoices: 0, bills: 0, netSales: 0, grossSales: 0, gstOut: 0,
      netPurchases: 0, grossPurchases: 0, gstIn: 0, cgstOut: 0, sgstOut: 0, igstOut: 0,
      salesQty: 0, collected: 0, outstanding: 0, purchaseQty: 0, purchaseQtyRecorded: 0,
      purchaseQtyMissing: 0, purchasePaid: 0, purchaseOutstanding: 0 };
    rows.forEach(function (r) {
      t.invoices += r.invoices; t.bills += r.bills;
      t.netSales += r.netSales; t.grossSales += r.grossSales; t.gstOut += r.gstOut;
      t.netPurchases += r.netPurchases; t.grossPurchases += r.grossPurchases; t.gstIn += r.gstIn;
      t.cgstOut += r.cgstOut; t.sgstOut += r.sgstOut; t.igstOut += r.igstOut;
      t.salesQty += r.salesQty; t.collected += r.collected; t.outstanding += r.outstanding;
      t.purchaseQty += r.purchaseQty.qty; t.purchaseQtyRecorded += r.purchaseQty.recorded;
      t.purchaseQtyMissing += r.purchaseQty.missing;
      t.purchasePaid += r.purchasePaid; t.purchaseOutstanding += r.purchaseOutstanding;
    });
    Object.keys(t).forEach(function (k) { if (typeof t[k] === 'number') t[k] = R2(t[k]); });
    t.grossProfit = R2(t.netSales - t.netPurchases);
    t.margin = t.netSales > 0 ? R2(t.grossProfit / t.netSales * 100) : null;
    t.netGst = R2(t.gstOut - t.gstIn);
    t.avgInvoice = t.invoices ? R2(t.netSales / t.invoices) : null;
    t.avgBill = t.bills ? R2(t.netPurchases / t.bills) : null;
    t.profitPerT = t.salesQty > 0 ? R2(t.grossProfit / t.salesQty) : null;
    t.salesRatePerT = t.salesQty > 0 ? R2(t.netSales / t.salesQty) : null;
    t.purchaseRatePerT = t.purchaseQty > 0 ? R2(t.netPurchases / t.purchaseQty) : null;
    t.collectionPct = (t.netSales + t.gstOut) > 0 ? R2(t.collected / (t.netSales + t.gstOut) * 100) : null;
    t.salesReturns = null; t.purchaseReturns = null;
    return t;
  }

  /* ── COMPARISON ──────────────────────────────────────────────────────────
     A percentage change against a base of zero is not 0% and it is not
     infinity — it is undefined, and saying "+100%" because last month was
     nil would be inventing a trend. null, and the page says "no base". */
  function pctChange(now, was) {
    if (was == null || now == null) return null;
    if (Math.abs(was) < 0.005) return null;
    return R2((now - was) / Math.abs(was) * 100);
  }
  function prevMonth(m) {
    var y = +String(m).slice(0, 4), mm = +String(m).slice(5, 7);
    mm--; if (mm < 1) { mm = 12; y--; }
    return y + '-' + (mm < 10 ? '0' : '') + mm;
  }
  function sameMonthLastYear(m) { return (+String(m).slice(0, 4) - 1) + '-' + String(m).slice(5, 7); }

  function compare(sales, purchases, m, mode) {
    var baseM = mode === 'year' ? sameMonthLastYear(m) : prevMonth(m);
    var cur = monthStats(sales, purchases, m), base = monthStats(sales, purchases, baseM);
    var F = ['netSales', 'netPurchases', 'grossProfit', 'salesQty', 'invoices', 'bills', 'gstOut', 'collected', 'outstanding'];
    var d = {};
    F.forEach(function (k) { d[k] = { now: cur[k], was: base[k], pct: pctChange(cur[k], base[k]) }; });
    /* Margin moves in PERCENTAGE POINTS, not percent-of-percent. "+3.2 pts" is
       a statement someone can check; "+18% of a margin" is not. */
    d.margin = { now: cur.margin, was: base.margin,
                 pts: (cur.margin != null && base.margin != null) ? R2(cur.margin - base.margin) : null };
    return { mode: mode === 'year' ? 'year' : 'month', month: m, baseMonth: baseM,
             baseLabel: monthName(baseM), hasBase: base.invoices > 0 || base.bills > 0, deltas: d };
  }

  /* ── BREAKDOWNS ──────────────────────────────────────────────────────────
     Grouped by the identity the row carries. Sorted by value, biggest first. */
  function groupBy(rows, keyFn, opts) {
    opts = opts || {};
    var by = {};
    rows.forEach(function (r) {
      var k = keyFn(r); if (!k) k = opts.blank || '—';
      var g = by[k] || (by[k] = { key: k, count: 0, value: 0, qty: 0, qtyRows: 0 });
      g.count++; g.value += num(r.taxable);
      if (num(r.qty) > 0) { g.qty += num(r.qty); g.qtyRows++; }
    });
    return Object.keys(by).map(function (k) {
      var g = by[k];
      g.value = R2(g.value); g.qty = R2(g.qty);
      g.avgRate = g.qty > 0 ? R2(g.value / g.qty) : null;   // null when no tonnage was recorded
      return g;
    }).sort(function (a, b) { return b.value - a.value; });
  }

  function salesAnalysis(row) {
    var sal = row._sales || [];
    var vals = sal.map(function (r) { return num(r.taxable); });
    /* `product` exists on every sales row and is EMPTY on every one of them,
       so a product breakdown here would be a single "—" bucket pretending to
       be analysis. Reported as unavailable instead. */
    var anyProduct = sal.some(function (r) { return String(r.product || '').trim(); });
    return {
      customers: groupBy(sal, function (r) { return r.party; }),
      products: anyProduct ? groupBy(sal, function (r) { return r.product; }) : null,
      highest: vals.length ? R2(Math.max.apply(null, vals)) : null,
      lowest: vals.length ? R2(Math.min.apply(null, vals)) : null,
      average: vals.length ? R2(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) : null,
      count: sal.length
    };
  }
  function purchaseAnalysis(row) {
    var pur = row._purchases || [];
    var vals = pur.map(function (r) { return num(r.taxable); });
    return {
      suppliers: groupBy(pur, function (r) { return r.sup; }),
      materials: groupBy(pur, function (r) { return r.groupLabel || r.group || r.item; }),
      highest: vals.length ? R2(Math.max.apply(null, vals)) : null,
      lowest: vals.length ? R2(Math.min.apply(null, vals)) : null,
      average: vals.length ? R2(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) : null,
      count: pur.length
    };
  }

  /* ── AGEING ──────────────────────────────────────────────────────────────
     Buckets by how long an unpaid invoice has been outstanding. `asOf` is
     passed in rather than read from the clock, so the same input always gives
     the same answer and the test can pin it. */
  function ageing(rows, asOf) {
    var B = [{ k: 'current', label: 'Current', lo: -1e9, hi: 0 },
             { k: 'd30', label: '1–30 days', lo: 1, hi: 30 },
             { k: 'd60', label: '31–60 days', lo: 31, hi: 60 },
             { k: 'd90', label: '61–90 days', lo: 61, hi: 90 },
             { k: 'd90p', label: '90+ days', lo: 91, hi: 1e9 }];
    var out = {}; B.forEach(function (b) { out[b.k] = { label: b.label, amount: 0, count: 0 }; });
    var today = asOf ? new Date(asOf + 'T00:00') : new Date();
    (rows || []).forEach(function (r) {
      var bal = num(r.outstanding); if (bal <= 0.5) return;
      var d = new Date(String(r.date) + 'T00:00');
      var days = Math.round((today - d) / 86400000);
      for (var i = 0; i < B.length; i++) {
        if (days >= B[i].lo && days <= B[i].hi) { out[B[i].k].amount = R2(out[B[i].k].amount + bal); out[B[i].k].count++; break; }
      }
    });
    out.total = R2(B.reduce(function (a, b) { return a + out[b.k].amount; }, 0));
    out.overdue = R2(out.d30.amount + out.d60.amount + out.d90.amount + out.d90p.amount);
    return out;
  }

  /* ── INSIGHTS ────────────────────────────────────────────────────────────
     Every line is derived from the numbers above and quotes them, so the
     reader can check the claim rather than trust it. Nothing is emitted when
     the data cannot support it. */
  function insights(row, cmp, sa, pa) {
    var out = [], fmtT = function (n) { return (Math.round(n * 10) / 10).toLocaleString('en-IN') + ' T'; };
    if (cmp && cmp.hasBase) {
      var s = cmp.deltas.netSales;
      if (s.pct != null) out.push({ tone: s.pct >= 0 ? 'up' : 'down',
        text: 'Net sales ' + (s.pct >= 0 ? 'rose' : 'fell') + ' ' + Math.abs(s.pct).toFixed(1) + '% against ' + cmp.baseLabel + '.' });
      var g = cmp.deltas.margin;
      if (g.pts != null && Math.abs(g.pts) >= 0.1) out.push({ tone: g.pts >= 0 ? 'up' : 'down',
        text: 'Gross margin ' + (g.pts >= 0 ? 'improved' : 'slipped') + ' ' + Math.abs(g.pts).toFixed(1) + ' percentage points.' });
    }
    if (sa && sa.customers.length && row.netSales > 0) {
      var top = sa.customers[0];
      out.push({ tone: 'info', text: top.key + ' was the largest customer at ' +
        Math.round(top.value / row.netSales * 100) + '% of net sales.' });
    }
    if (pa && pa.materials.length && row.netPurchases > 0) {
      var mt = pa.materials[0];
      out.push({ tone: 'info', text: mt.key + ' was the largest purchase at ' +
        Math.round(mt.value / row.netPurchases * 100) + '% of net purchases.' });
    }
    if (row.salesRatePerT != null) out.push({ tone: 'info',
      text: 'Average selling rate ₹' + Math.round(row.salesRatePerT).toLocaleString('en-IN') + '/T on ' + fmtT(row.salesQty) + ' dispatched.' });
    if (row.collectionPct != null && row.invoices) out.push({ tone: row.collectionPct >= 50 ? 'up' : 'down',
      text: row.collectionPct.toFixed(1) + '% of the month’s billing has been collected.' });
    return out;
  }

  /* ── EXCEPTIONS ──────────────────────────────────────────────────────────
     Things a person should look at. Each carries the count and the money, so
     it can be judged before it is opened. */
  function exceptions(row) {
    var out = [], sal = row._sales || [], pur = row._purchases || [];
    var add = function (sev, label, n, amt, why) { if (n > 0) out.push({ sev: sev, label: label, count: n, amount: amt == null ? null : R2(amt), why: why }); };

    var unpaid = sal.filter(function (r) { return num(r.outstanding) > 0.5; });
    add('warn', 'Invoices not yet paid', unpaid.length, unpaid.reduce(function (a, r) { return a + num(r.outstanding); }, 0),
        'Money billed and still outstanding.');

    var noGst = sal.filter(function (r) { return !String(r.gstin || '').trim(); });
    add('warn', 'Sales with no customer GSTIN', noGst.length, null,
        'Without a GSTIN the sale cannot be classified inter-state, so it is treated as CGST+SGST.');

    var noQty = sal.filter(function (r) { return !(num(r.qty) > 0); });
    add('warn', 'Invoices with no quantity', noQty.length, null, 'Rate and tonnage analysis skip these.');

    var pNoQty = pur.filter(function (r) { return !(num(r.qty) > 0); });
    add('warn', 'Purchase bills with no quantity', pNoQty.length, null,
        'Their value counts in full; the tonnage does not, so purchase rate/T is a partial figure.');

    var pUnpaid = pur.filter(function (r) { return num(r.outstanding) > 0.5; });
    add('info', 'Purchase bills not yet paid', pUnpaid.length, pUnpaid.reduce(function (a, r) { return a + num(r.outstanding); }, 0), 'Supplier dues from this month.');

    var neg = sal.filter(function (r) { return num(r.taxable) < 0; });
    add('bad', 'Negative-value invoices', neg.length, neg.reduce(function (a, r) { return a + num(r.taxable); }, 0), 'A negative sale is usually a correction entered as an invoice.');

    /* Same document number twice in one month, same party — the check that
       found eight copies of an Indian Oil bill sitting in Sales. */
    var seen = {}, dupes = 0;
    sal.forEach(function (r) {
      var k = String(r.inv || '').toUpperCase().replace(/[^A-Z0-9]/g, '') + '~' + String(r.party || '').toUpperCase();
      if (!k.replace('~', '')) return;
      if (seen[k]) dupes++; else seen[k] = 1;
    });
    add('bad', 'Duplicate invoice numbers', dupes, null, 'The same number recorded more than once for the same customer.');
    return out;
  }

  /* ── RECONCILIATION ──────────────────────────────────────────────────────
     The register must agree with the registers it summarises. This compares
     what this engine computed against the source rows it was handed, and
     REPORTS a difference rather than hiding it. */
  function reconcile(sales, purchases, rows) {
    var t = totals(rows);
    var liveS = (sales || []).filter(live), liveP = (purchases || []).filter(live);
    var srcSalesTx = R2(liveS.reduce(function (a, r) { return a + num(r.taxable); }, 0));
    var srcSalesGst = R2(liveS.reduce(function (a, r) { return a + num(r.gst); }, 0));
    var srcPurTx = R2(liveP.reduce(function (a, r) { return a + num(r.taxable); }, 0));
    var srcQty = R2(liveS.reduce(function (a, r) { return a + num(r.qty); }, 0));
    var srcOut = R2(liveS.reduce(function (a, r) { return a + num(r.outstanding); }, 0));
    var eq = function (a, b) { return Math.abs(R2(a) - R2(b)) < 1; };   // within a rupee
    var checks = [
      { k: 'Sales invoice count', got: t.invoices, want: liveS.length, ok: t.invoices === liveS.length },
      { k: 'Purchase bill count', got: t.bills, want: liveP.length, ok: t.bills === liveP.length },
      { k: 'Net sales (taxable)', got: t.netSales, want: srcSalesTx, ok: eq(t.netSales, srcSalesTx) },
      { k: 'Output GST', got: t.gstOut, want: srcSalesGst, ok: eq(t.gstOut, srcSalesGst) },
      { k: 'Net purchases (taxable)', got: t.netPurchases, want: srcPurTx, ok: eq(t.netPurchases, srcPurTx) },
      { k: 'Sales quantity', got: t.salesQty, want: srcQty, ok: Math.abs(t.salesQty - srcQty) < 0.05 },
      { k: 'Outstanding', got: t.outstanding, want: srcOut, ok: eq(t.outstanding, srcOut) },
      /* The property the OLD page failed: the money columns must add up. */
      { k: 'Gross profit = net sales − net purchases', got: t.grossProfit, want: R2(t.netSales - t.netPurchases),
        ok: eq(t.grossProfit, t.netSales - t.netPurchases) },
      { k: 'CGST + SGST + IGST = output GST', got: R2(t.cgstOut + t.sgstOut + t.igstOut), want: t.gstOut,
        ok: eq(t.cgstOut + t.sgstOut + t.igstOut, t.gstOut) }
    ];
    return { checks: checks, ok: checks.every(function (c) { return c.ok; }),
             failed: checks.filter(function (c) { return !c.ok; }) };
  }

  var api = { live: live, fyOf: fyOf, fyLabel: fyLabel, fyMonths: fyMonths, fysIn: fysIn, monthName: monthName,
              monthStats: monthStats, register: register, totals: totals,
              compare: compare, pctChange: pctChange, prevMonth: prevMonth, sameMonthLastYear: sameMonthLastYear,
              groupBy: groupBy, salesAnalysis: salesAnalysis, purchaseAnalysis: purchaseAnalysis,
              ageing: ageing, insights: insights, exceptions: exceptions, reconcile: reconcile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLMonthReg = api;
})(typeof window !== 'undefined' ? window : globalThis);
