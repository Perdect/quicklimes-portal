/* ═══════════════════════════════════════════════════════════════════════
   MANUFACTURING COSTING — the engine.  window.QLCosting

   Pure: rows in, numbers out. No DOM, no storage. costing-core.test.js runs
   the ten QA scenarios against this exact code; expenses.html and
   costing.html only render what it returns.

   ── WHAT THE AUDIT FOUND, WHICH SHAPED EVERYTHING HERE ──────────────────
   · Purchases carry the materials (limestone / petcoke / packaging groups,
     26 bills). They are the ONLY record of material cost. §17 therefore:
     material subcategories in the expense master are marked viaPurchases and
     the expense store REFUSES them — recording limestone twice is the
     double-count this system must make structurally impossible.
   · The live book holds ZERO production runs. Actual per-run costing needs
     runs; until they exist the engine falls back to PERIOD costing — the
     methodology the app's P&L has always used (period purchases as material
     cost, dispatched tonnes as output) — and every result SAYS which method
     produced it. A number that hides its method is how two screens disagree.
   · sales.product is empty on every invoice, so "which product" for a sale
     is unknowable today. Product profitability works from production runs
     (which DO name the product) and states the sales-side assumption.

   ── TRACEABILITY (§19) ──────────────────────────────────────────────────
   Nothing returns a bare number. Cost figures return { total, perT, lines }
   where every line carries {label, amount, source, ref} back to the bill,
   expense or run it came from.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var R2 = function (n) { return Math.round((+n || 0) * 100) / 100; };
  var num = function (n) { return +n || 0; };
  var inYM = function (d, ym) { return String(d || '').slice(0, 7) === ym; };
  var live = function (r) { return !r._del && !r._arch && (r.status || 'pending') !== 'cancelled'; };
  /* a sales row carries either a computed taxable or raw qty×rate */
  var saleVal = function (s) { var t = num(s.taxable); return t > 0 ? t : R2(num(s.qty) * num(s.rate)); };

  /* ── THE EXPENSE MASTER (§2) ─────────────────────────────────────────────
     group        one of the nine costing groups A–I
     treatment    how it enters profitability:
                    direct-production → manufacturing cost of the period
                    factory-overhead  → allocated onto production
                    selling / admin / finance / compliance / employee-indirect
                                      → below gross profit, never in cost/T
     viaPurchases subcategories whose money ALREADY lives in the Purchase
                  Register. The store refuses them (§17). */
  var GROUPS = {
    production: { label: 'Direct Production', treatment: 'direct-production' },
    factory:    { label: 'Factory',           treatment: 'factory-overhead' },
    transport:  { label: 'Transport & Logistics', treatment: 'selling' },
    employee:   { label: 'Employee',          treatment: 'employee' },
    admin:      { label: 'Administrative',    treatment: 'admin' },
    compliance: { label: 'Government & Compliance', treatment: 'compliance' },
    selling:    { label: 'Sales & Distribution', treatment: 'selling' },
    finance:    { label: 'Finance',           treatment: 'finance' },
    overhead:   { label: 'Fixed Overheads',   treatment: 'factory-overhead' }
  };
  var SUBS = {
    production: ['Limestone*', 'Petcoke*', 'Coal / alt fuel', 'Kiln fuel', 'Electricity', 'Diesel (production)',
      'Water', 'Production labour', 'Contract labour', 'Kiln operation', 'RM loading', 'RM unloading',
      'RM handling', 'Packaging bags*', 'Packing labour', 'Stitching / packing', 'Production consumables'],
    factory: ['Factory rent', 'Factory electricity', 'DG fuel', 'DG maintenance', 'Machinery maintenance',
      'Kiln maintenance', 'Crusher maintenance', 'Conveyor maintenance', 'Electrical maintenance',
      'Welding / fabrication', 'Spare parts', 'Lubricants / grease / oil', 'Bearings / belts',
      'Refractory / furnace bricks', 'Tools', 'Factory consumables', 'Safety equipment',
      'Cleaning / waste disposal', 'Pump / water system'],
    transport: ['Inbound freight*', 'Outbound customer freight', 'Transport contractor', 'Truck loading',
      'Truck unloading', 'Weighbridge', 'Toll', 'Diesel (vehicles)', 'Driver salary', 'Vehicle maintenance',
      'Tyres', 'Vehicle insurance', 'Permit / fitness'],
    employee: ['Factory worker salary', 'Supervisor salary', 'Security salary', 'Office staff salary',
      'Accountant salary', 'Manager salary', 'Bonus / incentives', 'Overtime', 'Staff welfare',
      'Uniform', 'Staff meals'],
    admin: ['Office rent', 'Office electricity', 'Internet / telephone', 'Software subscriptions',
      'Printing / stationery', 'Courier', 'CA / accounting fees', 'Legal / consultancy',
      'Bank charges', 'Office maintenance'],
    compliance: ['GST consultant', 'E-way bill', 'Pollution control', 'Factory licence',
      'Mining / royalty', 'Labour compliance', 'Weights & measures', 'Government fees', 'Inspection'],
    selling: ['Sales commission', 'Agent / dealer commission', 'Customer discount', 'Sales incentives',
      'Marketing / advertising', 'Customer visits', 'Samples', 'Sales travel', 'Loading charges', 'Freight subsidy'],
    finance: ['Bank interest', 'CC / working-capital interest', 'Loan interest', 'LC / BG charges',
      'Processing fees', 'Late-payment charges'],
    overhead: ['Depreciation — machinery', 'Depreciation — building', 'Depreciation — vehicles',
      'Insurance', 'Property tax', 'AMC / maintenance contracts', 'General overhead']
  };
  /* '*' = the money for this lives in the Purchase Register. */
  function subInfo(group, sub) {
    var list = SUBS[group] || [];
    for (var i = 0; i < list.length; i++) {
      var raw = list[i], via = raw.slice(-1) === '*';
      if ((via ? raw.slice(0, -1) : raw) === sub) return { ok: true, viaPurchases: via };
    }
    return { ok: false, viaPurchases: false };
  }

  /* §3/§17 gatekeeper. The store calls this before accepting an entry. */
  function classify(e) {
    e = e || {};
    var g = GROUPS[e.group];
    if (!g) return { ok: false, error: 'Unknown expense group' };
    var si = subInfo(e.group, e.sub);
    if (e.sub && !si.ok) return { ok: false, error: 'Unknown subcategory for ' + g.label };
    if (si.viaPurchases) return { ok: false, viaPurchases: true,
      error: (e.sub || 'This material') + ' is bought through the Purchase Register — recording it here would count the same money twice. Add the bill there; production consumes it from there.' };
    if (!(num(e.amount) > 0)) return { ok: false, error: 'Amount must be above zero' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || ''))) return { ok: false, error: 'A full date is required' };
    return { ok: true, treatment: e.treatment || g.treatment,
      direct: (e.treatment || g.treatment) === 'direct-production' };
  }

  /* ── ALLOCATION ENGINE (§15) ─────────────────────────────────────────────
     Splits one overhead amount across products. Bases with no data return an
     explicit failure instead of a silent equal split — an allocation that
     quietly changed method is a cost/T nobody can explain. */
  function allocate(amount, products, method, manual) {
    amount = num(amount);
    var keys = (products || []).map(function (p) { return p.key; });
    if (!keys.length) return { ok: false, error: 'No products to allocate over' };
    var out = {}, basis;
    if (method === 'equal') {
      keys.forEach(function (k) { out[k] = R2(amount / keys.length); });
      basis = 'equal split across ' + keys.length + ' products';
    } else if (method === 'manual') {
      var tot = keys.reduce(function (a, k) { return a + num(manual && manual[k]); }, 0);
      if (Math.abs(tot - 100) > 0.01) return { ok: false, error: 'Manual shares must total 100% (got ' + R2(tot) + '%)' };
      keys.forEach(function (k) { out[k] = R2(amount * num(manual[k]) / 100); });
      basis = 'manual shares';
    } else {   // per-ton / qty% / revenue% — all proportional to a per-product weight
      var wKey = method === 'revenue' ? 'revenue' : 'qty';
      var wTot = (products || []).reduce(function (a, p) { return a + num(p[wKey]); }, 0);
      if (wTot <= 0) return { ok: false, error: 'No ' + (wKey === 'qty' ? 'production quantity' : 'revenue') + ' recorded to allocate by' };
      (products || []).forEach(function (p) { out[p.key] = R2(amount * num(p[wKey]) / wTot); });
      basis = 'in proportion to ' + (wKey === 'qty' ? 'tonnes produced' : 'revenue');
    }
    /* rounding drift lands on the largest share, so the parts always sum back */
    var sum = keys.reduce(function (a, k) { return a + out[k]; }, 0);
    if (Math.abs(sum - amount) >= 0.005) {
      var big = keys.slice().sort(function (a, b) { return out[b] - out[a]; })[0];
      out[big] = R2(out[big] + (amount - sum));
    }
    return { ok: true, shares: out, basis: basis };
  }

  /* ── PRODUCTION COST FOR ONE MONTH (§5–§7) ───────────────────────────────
     inputs: { ym, purchases, expenses, prodRuns, sales, cashbookLabour }
     Two methods, chosen by the data:
       actual — production runs exist for the month: materials are costed at
                the month's average purchase rate per tonne actually CONSUMED,
                output is the tonnes the runs say were produced.
       period — no runs: the methodology this app's P&L has always used —
                the month's material purchases ARE the material cost, and
                dispatched tonnes stand in for output. Labelled, not hidden. */
  function materialRates(purchases, ym) {
    var by = {};
    (purchases || []).filter(function (p) { return live(p) && inYM(p.date, ym); }).forEach(function (p) {
      var g = p.group || 'other';
      var b = by[g] || (by[g] = { taxable: 0, qty: 0, bills: [] });
      b.taxable += num(p.taxable); b.qty += num(p.qty);
      b.bills.push({ ref: p.bill, amount: R2(num(p.taxable)), qty: num(p.qty) });
    });
    Object.keys(by).forEach(function (g) {
      by[g].rate = by[g].qty > 0 ? R2(by[g].taxable / by[g].qty) : null;
      by[g].taxable = R2(by[g].taxable); by[g].qty = R2(by[g].qty);
    });
    return by;
  }

  function productionCost(inp) {
    inp = inp || {};
    var ym = inp.ym;
    var runs = (inp.prodRuns || []).filter(function (r) { return live(r) && inYM(r.date, ym); });
    var exps = (inp.expenses || []).filter(function (e) { return live(e) && inYM(e.date, ym); });
    var sales = (inp.sales || []).filter(function (s) { return live(s) && inYM(s.date, ym); });
    var rates = materialRates(inp.purchases, ym);
    var lines = [], warnings = [];

    var method, outputT, producedByProduct = {};
    if (runs.length) {
      method = 'actual';
      var consLime = 0, consPet = 0, consBags = 0;
      runs.forEach(function (r) {
        consLime += num(r.limestone); consPet += num(r.petcoke); consBags += num(r.bags);
        producedByProduct.quicklime = R2(num(producedByProduct.quicklime) + num(r.quicklime));
        producedByProduct.hydrated = R2(num(producedByProduct.hydrated) + num(r.hydrated));
      });
      outputT = R2(num(producedByProduct.quicklime) + num(producedByProduct.hydrated));
      [['limestone', consLime, 'Limestone consumed'], ['petcoke', consPet, 'Petcoke consumed'],
       ['packaging', consBags, 'Bags used']].forEach(function (m) {
        if (!(m[1] > 0)) return;
        var r = rates[m[0]];
        if (!r || r.rate == null) {
          warnings.push(m[2] + ' (' + R2(m[1]) + ') cannot be costed — no ' + m[0] +
            ' purchase this month carries a quantity, so there is no rate to cost it at.');
          return;
        }
        lines.push({ label: m[2], amount: R2(m[1] * r.rate), source: 'purchases',
          detail: R2(m[1]) + ' @ avg ' + r.rate + '/unit from ' + r.bills.length + ' bill(s)',
          refs: r.bills.map(function (b) { return b.ref; }) });
      });
    } else {
      method = 'period';
      /* Every material purchase of the month IS the material cost — the
         app's long-standing P&L rule, now stated on the line itself. */
      Object.keys(rates).forEach(function (g) {
        if (!(rates[g].taxable > 0)) return;
        lines.push({ label: 'Materials — ' + g, amount: rates[g].taxable, source: 'purchases',
          detail: 'period purchases treated as consumed (no production runs recorded)',
          refs: rates[g].bills.map(function (b) { return b.ref; }) });
      });
      outputT = R2(sales.reduce(function (a, s) { return a + num(s.qty); }, 0));
      if (lines.length) warnings.push('No production runs are recorded for ' + ym +
        ', so this is PERIOD costing: purchases stand in for consumption and dispatched tonnes for output. Record runs on the Production page for actual costing.');
    }

    /* Direct production expenses from the store; labour rule (§17): the
       cashbook figure is used only when no expense-store labour exists. */
    var directExp = exps.filter(function (e) {
      return (e.treatment || (GROUPS[e.group] || {}).treatment) === 'direct-production';
    });
    var expLabour = directExp.filter(function (e) { return /labour/i.test(e.sub || ''); })
      .reduce(function (a, e) { return a + num(e.amount); }, 0);
    directExp.forEach(function (e) {
      lines.push({ label: e.sub || 'Production expense', amount: R2(num(e.amount)),
        source: 'expense', detail: (e.vendor || '') , refs: [e.id] });
    });
    if (!(expLabour > 0) && num(inp.cashbookLabour) > 0) {
      lines.push({ label: 'Production labour (cash book)', amount: R2(num(inp.cashbookLabour)),
        source: 'cashbook', detail: 'labour payments from the cash book — enter labour as an expense here to take over this line', refs: [] });
    } else if (expLabour > 0 && num(inp.cashbookLabour) > 0) {
      warnings.push('Labour exists BOTH as expense entries and in the cash book. Only the expense entries are counted — remove one of the two records if they are the same money.');
    }

    /* Factory + fixed overheads allocated onto the month's production. */
    var ovh = exps.filter(function (e) {
      return (e.treatment || (GROUPS[e.group] || {}).treatment) === 'factory-overhead';
    });
    var ovhTotal = R2(ovh.reduce(function (a, e) { return a + num(e.amount); }, 0));
    if (ovhTotal > 0) lines.push({ label: 'Factory overhead (allocated)', amount: ovhTotal,
      source: 'expense', detail: ovh.length + ' overhead entr' + (ovh.length === 1 ? 'y' : 'ies') + ' for the month',
      refs: ovh.map(function (e) { return e.id; }) });

    var total = R2(lines.reduce(function (a, l) { return a + l.amount; }, 0));
    return {
      ym: ym, method: method, lines: lines, warnings: warnings,
      total: total, outputT: outputT,
      /* zero recorded cost over real tonnage is NOT \u20b90/T \u2014 it is \u201cno cost recorded\u201d */
      perT: outputT > 0 && total > 0 ? R2(total / outputT) : null,
      producedByProduct: producedByProduct,
      overheadTotal: ovhTotal
    };
  }

  /* ── PRODUCT PROFITABILITY (§9) ──────────────────────────────────────────
     Only meaningful under ACTUAL costing (runs name the product). Direct
     material per product from its runs; overhead split by the chosen method. */
  function productProfit(inp, method, manual) {
    var pc = productionCost(inp);
    if (pc.method !== 'actual') {
      return { ok: false, method: pc.method,
        error: 'Per-product costing needs production runs — the run says which product was made. Without them the month has one combined cost only.' };
    }
    var prods = ['quicklime', 'hydrated'].filter(function (k) { return num(pc.producedByProduct[k]) > 0; })
      .map(function (k) { return { key: k, qty: num(pc.producedByProduct[k]), revenue: 0 }; });
    var ovhAlloc = allocate(pc.overheadTotal, prods, method || 'qty', manual);
    var directPerT = pc.outputT > 0 ? (pc.total - pc.overheadTotal) / pc.outputT : 0;
    var out = {};
    prods.forEach(function (p) {
      var ovh = ovhAlloc.ok ? ovhAlloc.shares[p.key] : 0;
      var cost = R2(directPerT * p.qty + ovh);
      out[p.key] = { qty: p.qty, cost: cost, perT: p.qty > 0 ? R2(cost / p.qty) : null,
        overheadShare: ovh, allocationBasis: ovhAlloc.ok ? ovhAlloc.basis : ovhAlloc.error };
    });
    return { ok: true, method: 'actual', products: out,
      note: 'Direct cost is spread per tonne across products; overhead by ' + (ovhAlloc.ok ? ovhAlloc.basis : 'nothing — ' + ovhAlloc.error) };
  }

  /* ── INVOICE PROFITABILITY (§10) ─────────────────────────────────────────
     Sale value − (its tonnes × the month's manufacturing cost/T) − selling
     costs attributed to it. Selling costs are period selling expenses spread
     per dispatched tonne — attributed, and labelled as attributed. */
  function invoiceProfit(sale, inp) {
    var ym = String(sale.date || '').slice(0, 7);
    var pc = productionCost(Object.assign({}, inp, { ym: ym }));
    var sales = (inp.sales || []).filter(function (s) { return live(s) && inYM(s.date, ym); });
    var monthT = sales.reduce(function (a, s) { return a + num(s.qty); }, 0);
    var sellExp = (inp.expenses || []).filter(function (e) {
      return live(e) && inYM(e.date, ym) &&
        (e.treatment || (GROUPS[e.group] || {}).treatment) === 'selling';
    }).reduce(function (a, e) { return a + num(e.amount); }, 0);
    var qty = num(sale.qty), value = saleVal(sale);
    if (pc.perT == null) return { ok: false, error: 'No manufacturing cost/T for ' + ym + ' — ' +
      (pc.total > 0 ? 'no output tonnage to divide by' : 'no cost recorded'), ym: ym };
    var mfg = R2(qty * pc.perT);
    var sell = monthT > 0 ? R2(sellExp * qty / monthT) : 0;
    var profit = R2(value - mfg - sell);
    return { ok: true, ym: ym, method: pc.method,
      qty: qty, value: value, ratePerT: qty > 0 ? R2(value / qty) : null,
      mfgPerT: pc.perT, mfgCost: mfg,
      sellingCost: sell, sellingNote: monthT > 0 ? 'month selling expenses spread over ' + R2(monthT) + ' T dispatched' : '',
      totalCost: R2(mfg + sell), profit: profit,
      profitPerT: qty > 0 ? R2(profit / qty) : null,
      margin: value > 0 ? R2(profit / value * 100) : null };
  }

  /* ── MONTHLY P&L WITH STOCK MOVEMENT (§8) ────────────────────────────────
     Opening/closing finished stock is only computable when runs exist
     (produced − dispatched). Without runs it is null with a reason — never a
     fabricated zero. */
  function monthlyPL(inp) {
    var ym = inp.ym;
    var pc = productionCost(inp);
    var sales = (inp.sales || []).filter(function (s) { return live(s) && inYM(s.date, ym); });
    var salesT = R2(sales.reduce(function (a, s) { return a + num(s.qty); }, 0));
    var salesVal = R2(sales.reduce(function (a, s) { return a + saleVal(s); }, 0));
    var byT = function (t) {
      return R2((inp.expenses || []).filter(function (e) {
        return live(e) && inYM(e.date, ym) && (e.treatment || (GROUPS[e.group] || {}).treatment) === t;
      }).reduce(function (a, e) { return a + num(e.amount); }, 0));
    };
    var selling = byT('selling'), admin = byT('admin') + byT('compliance') + byT('employee'), fin = byT('finance');
    /* COGS: actual → dispatched tonnes at the month's cost/T (stock absorbs
       the rest). period → the whole period cost IS the COGS, by definition
       of that method. */
    var cogs = pc.method === 'actual'
      ? (pc.perT != null ? R2(salesT * pc.perT) : null)
      : pc.total;
    var gross = cogs == null ? null : R2(salesVal - cogs);
    var net = gross == null ? null : R2(gross - selling - admin - fin);
    var stockChangeT = pc.method === 'actual' ? R2(pc.outputT - salesT) : null;
    return {
      ym: ym, method: pc.method, warnings: pc.warnings,
      producedT: pc.method === 'actual' ? pc.outputT : null,
      productionCost: pc.total, mfgPerT: pc.perT,
      salesT: salesT, salesValue: salesVal,
      cogs: cogs, grossProfit: gross,
      grossMargin: gross != null && salesVal > 0 ? R2(gross / salesVal * 100) : null,
      sellingExp: selling, adminExp: R2(admin), financeExp: fin,
      netProfit: net,
      netMargin: net != null && salesVal > 0 ? R2(net / salesVal * 100) : null,
      stockChangeT: stockChangeT,
      stockNote: pc.method === 'actual' ? null :
        'Opening/closing finished stock needs production runs — produced minus dispatched cannot be computed from sales alone.'
    };
  }

  /* ── EXPENSE SUMMARIES + VARIANCE (§13) ──────────────────────────────────*/
  function expenseSummary(expenses, ym) {
    var out = { total: 0, byGroup: {}, count: 0 };
    (expenses || []).filter(function (e) { return live(e) && (!ym || inYM(e.date, ym)); })
      .forEach(function (e) {
        var g = e.group || 'other';
        out.byGroup[g] = R2(num(out.byGroup[g]) + num(e.amount));
        out.total = R2(out.total + num(e.amount)); out.count++;
      });
    return out;
  }
  function variance(expenses, ym, prevYm) {
    var cur = expenseSummary(expenses, ym), prev = expenseSummary(expenses, prevYm);
    var keys = {}; Object.keys(cur.byGroup).concat(Object.keys(prev.byGroup)).forEach(function (k) { keys[k] = 1; });
    return Object.keys(keys).map(function (k) {
      var c = num(cur.byGroup[k]), p = num(prev.byGroup[k]);
      return { group: k, current: c, previous: p,
        /* change from an empty base is undefined, not +100% */
        pct: p > 0 ? R2((c - p) / p * 100) : null };
    }).sort(function (a, b) { return b.current - a.current; });
  }

  /* ── RAW-MATERIAL MOVEMENT FOR ONE MONTH (§8 of the monthly spec) ────────
     opening + purchased − consumed = closing, per material group.
     · purchased  from qty-carrying bills (bills without qty are COUNTED and
       reported as missing — the figure is a floor, not a total; the register
       already treats quantity gaps this way and this must agree with it).
     · consumed   from production runs. No runs ever → consumption is unknown
       → opening/closing are null WITH the reason, never fabricated zeros.
     Opening is cumulative history before the month start, so it needs the
     FULL purchase + run books, not just the month. */
  function rmMovement(inp) {
    var ym = inp.ym, start = ym + "-01";
    var P = (inp.purchases || []).filter(live), R = (inp.prodRuns || []).filter(live);
    var anyRuns = R.length > 0;
    var CONSUME = { limestone: "limestone", petcoke: "petcoke", packaging: "bags" };
    return ["limestone", "petcoke", "packaging"].map(function (g) {
      var runKey = CONSUME[g];
      var buy = function (filter) {
        var got = 0, missing = 0;
        P.filter(function (p) { return (p.group || "") === g && filter(p); }).forEach(function (p) {
          if (num(p.qty) > 0) got += num(p.qty); else missing++;
        });
        return { qty: R2(got), missing: missing };
      };
      var use = function (filter) {
        return R2(R.filter(filter).reduce(function (a, r) { return a + num(r[runKey]); }, 0));
      };
      var before = function (row) { return String(row.date || "") < start; };
      var inMonth = function (row) { return inYM(row.date, ym); };
      var bBuy = buy(before), mBuy = buy(inMonth);
      var mCost = R2(P.filter(function (p) { return (p.group || "") === g && inMonth(p); })
        .reduce(function (a, p) { return a + num(p.taxable); }, 0));
      if (!anyRuns) return { group: g, purchased: mBuy.qty, purchasedMissing: mBuy.missing,
        consumed: null, opening: null, closing: null, cost: mCost,
        note: "Consumption needs production runs — none are recorded, so opening/closing stock cannot be computed." };
      var opening = R2(bBuy.qty - use(before)), consumed = use(inMonth);
      return { group: g, opening: opening, purchased: mBuy.qty, purchasedMissing: mBuy.missing,
        consumed: consumed, closing: R2(opening + mBuy.qty - consumed), cost: mCost,
        note: (bBuy.missing + mBuy.missing) > 0 ?
          (bBuy.missing + mBuy.missing) + " bill(s) carry no quantity — purchased/opening are floors, not totals." : null };
    });
  }

  /* ── YIELD ACROSS MONTHS (§9) ────────────────────────────────────────────
     yield = output ÷ limestone consumed × 100, per month, runs only. */
  function yieldStats(prodRuns, ym) {
    var by = {};
    (prodRuns || []).filter(live).forEach(function (r) {
      var m = String(r.date || "").slice(0, 7); if (m.length !== 7) return;
      var b = by[m] || (by[m] = { lime: 0, out: 0 });
      b.lime += num(r.limestone); b.out += num(r.quicklime) + num(r.hydrated);
    });
    var yOf = function (m) { var b = by[m]; return b && b.lime > 0 ? R2(b.out / b.lime * 100) : null; };
    var months = Object.keys(by).filter(function (m) { return m <= ym; }).sort().slice(-12);
    var vals = months.map(function (m) { return { ym: m, y: yOf(m) }; })
      .filter(function (x) { return x.y != null; });
    var prev = (function () { var d = ym.split("-"), y = +d[0], m = +d[1] - 1;
      if (!m) { y--; m = 12; } return y + "-" + String(m).padStart(2, "0"); })();
    var best = null, worst = null, sum = 0;
    vals.forEach(function (x) { sum += x.y;
      if (!best || x.y > best.y) best = x;
      if (!worst || x.y < worst.y) worst = x; });
    var cur = yOf(ym), pv = yOf(prev);
    return { current: cur, previous: pv, prevYm: prev,
      delta: cur != null && pv != null ? R2(cur - pv) : null,
      avg12: vals.length ? R2(sum / vals.length) : null,
      best: best, worst: worst, months: vals };
  }

  var api = { GROUPS: GROUPS, SUBS: SUBS, subInfo: subInfo, classify: classify,
    allocate: allocate, materialRates: materialRates, productionCost: productionCost,
    productProfit: productProfit, invoiceProfit: invoiceProfit, monthlyPL: monthlyPL,
    expenseSummary: expenseSummary, variance: variance, rmMovement: rmMovement, yieldStats: yieldStats };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLCosting = api;
})(typeof window !== 'undefined' ? window : globalThis);
