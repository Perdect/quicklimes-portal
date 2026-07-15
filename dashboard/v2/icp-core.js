/* ═══════════════════════════════════════════════════════════════════════
   icp-core.js — the ICP engine. Learns what a good lime customer looks like
   FROM YOUR OWN INVOICES, instead of a bought industry benchmark.

   Pure: no DOM, no network. Browser (window.ICPCore) + Node (module.exports),
   so every rule that ranks a customer or predicts a reorder is unit-tested.

   Why this exists: every prospecting vendor guesses "estimated lime
   consumption" from generic benchmarks and guesses badly. You already know
   what a real AAC plant of a given size buys from you — in tonnes, how often,
   at what price. That is ground truth from your own kiln. Calibrate here, and
   every rupee later spent on lead data is aimed at companies that resemble the
   customers who ALREADY pay you.

   HARD RULES (a wrong answer here sends a man in a truck to the wrong town):
     • A GUESS IS NEVER A FACT. An industry inferred from a company name is
       marked `guess` with a confidence, never presented as known. Same
       discipline as the bill parser: unclear ⇒ flagged, not fabricated.
     • NEVER predict a reorder from too little history. Two orders is not a
       pattern. Below MIN_ORDERS the profile says 'unknown' and says why.
     • Cancelled invoices are not sales. Ever.
     • Cost per tonne is a PLANT AVERAGE (one kiln, one product). Margin by
       industry is therefore an estimate driven by realised PRICE, which is the
       part that genuinely varies by customer. Callers must not present it as
       per-customer costing.
     • Money is rounded before it is shown, never after.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ICPCore = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_ORDERS = 3;          // below this there is no interval worth trusting

  /* ── industries ───────────────────────────────────────────────────────
     ORDER MATTERS — most specific first. "Autoclaved aerated CONCRETE" must
     match AAC before the cement rule sees the word "concrete"; the same
     ordered-specificity trick the purchase-group classifier uses.
     `trader` is deliberately last and low-confidence: half the firms in India
     are "<something> Enterprises" regardless of what they actually do. */
  var INDUSTRIES = [
    { key: 'aac',          label: 'AAC Blocks',        conf: 0.85, re: /\baac\b|autoclav|aerated\s*concrete|light\s*weight\s*block|siporex/i },
    { key: 'sugar',        label: 'Sugar Mills',       conf: 0.85, re: /\bsugar\b|sakhar|shakkar|\bchini\b|khandsari|sahakari.*sakhar/i },
    { key: 'paper',        label: 'Paper Mills',       conf: 0.85, re: /\bpaper\b|\bpulp\b|kagaz|board\s*mill/i },
    { key: 'steel',        label: 'Steel Plants',      conf: 0.80, re: /\bsteel\b|ispat|\btmt\b|rolling\s*mill|\balloy/i },
    { key: 'foundry',      label: 'Foundries',         conf: 0.85, re: /foundr|casting|\bforge/i },
    { key: 'water',        label: 'Water Treatment',   conf: 0.75, re: /water\s*treat|\betp\b|\bstp\b|effluent|sewage|\bwtp\b/i },
    { key: 'glass',        label: 'Glass',             conf: 0.80, re: /\bglass\b|float\s*glass/i },
    { key: 'cement',       label: 'Cement',            conf: 0.80, re: /\bcement\b|\brmc\b|ready\s*mix/i },
    { key: 'chemical',     label: 'Chemicals',         conf: 0.70, re: /chemical|\bchem\b|\bacid\b|caustic|\bsoda\b|fertili[sz]/i },
    { key: 'mining',       label: 'Mining',            conf: 0.70, re: /mining|\bmines\b|mineral|quarr|granite|marble/i },
    { key: 'construction', label: 'Construction',      conf: 0.65, re: /construct|infra|builder|developer|\bprojects?\b|contractor/i },
    { key: 'export',       label: 'Export / Import',   conf: 0.70, re: /export|import|overseas|\bexim\b|international/i },
    { key: 'trader',       label: 'Traders / Dealers', conf: 0.45, re: /trader|trading|agenc|distribut|\bsuppliers?\b|enterprise|\bcorporation\b|\bsales\b/i }
  ];
  function industryLabel(key) { var m = INDUSTRIES.filter(function (i) { return i.key === key; })[0]; return m ? m.label : (key || 'Unknown'); }

  /* industryOf(party) -> { key, label, source:'set'|'guess'|'unknown', confidence }
     `set` means a human confirmed it. A guess NEVER becomes a fact just because
     it was rendered once — the caller must show it as a guess and let the user
     confirm, which then writes party.industry and makes it 'set' forever. */
  function industryOf(p) {
    p = p || {};
    var explicit = String(p.industry || '').trim();
    if (explicit) return { key: explicit, label: industryLabel(explicit), source: 'set', confidence: 1 };
    var name = String(p.name || '');
    for (var i = 0; i < INDUSTRIES.length; i++) {
      if (INDUSTRIES[i].re.test(name)) {
        return { key: INDUSTRIES[i].key, label: INDUSTRIES[i].label, source: 'guess', confidence: INDUSTRIES[i].conf };
      }
    }
    return { key: '', label: 'Unknown', source: 'unknown', confidence: 0 };
  }

  /* ── small stats ── */
  function median(a) {
    var v = (a || []).filter(function (x) { return typeof x === 'number' && isFinite(x); }).sort(function (x, y) { return x - y; });
    if (!v.length) return null;
    var m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  function parseD(s) { if (!s) return null; var p = String(s).split('T')[0].split('-').map(Number); if (p.length !== 3 || !p[0]) return null; var d = new Date(p[0], p[1] - 1, p[2]); return isNaN(d) ? null : d; }
  function daysBetween(a, b) { var x = parseD(a), y = parseD(b); return (x && y) ? Math.round((y - x) / 86400000) : null; }
  function fmtD(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today() { return fmtD(new Date()); }
  var norm = function (s) { return String(s == null ? '' : s).trim().toUpperCase(); };
  function live(sales) { return (sales || []).filter(function (s) { return s && s.status !== 'cancelled' && s.date; }); }

  /* ── reorder profile ──────────────────────────────────────────────────
     orderProfile(salesForOneParty, today) -> {
       orders, tonnes, revenue, medianTonnes, medianDays, lastDate, daysSince,
       dueInDays, status, confident, why }

     status:
       'unknown'  — fewer than MIN_ORDERS invoices: no pattern exists yet.
                    We say so. A confident-sounding prediction off two orders
                    is how a sales team learns to ignore the system.
       'ontrack'  — not due yet
       'due'      — at/after the usual gap
       'overdue'  — well past it: they should have ordered and haven't
       'dormant'  — long gone; treat as win-back, not a reorder */
  function orderProfile(sales, todayISO) {
    var t = todayISO || today();
    var rows = live(sales).slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    var tonnes = rows.reduce(function (a, r) { return a + (+r.qty || 0); }, 0);
    var revenue = rows.reduce(function (a, r) { return a + (+r.total || 0); }, 0);
    var last = rows.length ? rows[rows.length - 1].date : null;
    var daysSince = last ? daysBetween(last, t) : null;

    var out = {
      orders: rows.length, tonnes: tonnes, revenue: revenue,
      medianTonnes: median(rows.map(function (r) { return +r.qty || 0; })),
      medianDays: null, lastDate: last, daysSince: daysSince,
      dueInDays: null, status: 'unknown', confident: false, why: ''
    };
    if (!rows.length) { out.why = 'No invoices'; return out; }
    if (rows.length < MIN_ORDERS) {
      out.status = 'unknown';
      out.why = rows.length + ' order' + (rows.length > 1 ? 's' : '') + ' — need ' + MIN_ORDERS + ' to know their rhythm';
      return out;
    }

    var gaps = [];
    for (var i = 1; i < rows.length; i++) {
      var g = daysBetween(rows[i - 1].date, rows[i].date);
      if (g !== null && g > 0) gaps.push(g);       // same-day split invoices are one order, not a gap
    }
    var med = median(gaps);
    if (!med) { out.why = 'All invoices on one day — no interval'; return out; }

    out.medianDays = med; out.confident = true;
    out.dueInDays = med - daysSince;
    if (daysSince > Math.max(90, med * 3)) { out.status = 'dormant'; out.why = 'Last order ' + daysSince + ' days ago vs a usual ' + Math.round(med) + '-day cycle — likely lost'; }
    else if (daysSince >= med * 1.5)       { out.status = 'overdue'; out.why = Math.round(daysSince - med) + ' days past their usual ' + Math.round(med) + '-day cycle'; }
    else if (daysSince >= med * 0.9)       { out.status = 'due';     out.why = 'Due now — they order about every ' + Math.round(med) + ' days'; }
    else                                    { out.status = 'ontrack'; out.why = 'Next order expected in about ' + Math.round(out.dueInDays) + ' days'; }
    return out;
  }

  /* ── the ICP: what your real customers look like, by industry ──────────
     icpByIndustry({sales, parties, costPerTonne}) -> [row]
     costPerTonne is the PLANT average (one kiln, one product). Price per tonne
     is what varies by customer, so margin/T here is driven by realised price —
     which is exactly the lever a sales decision turns on. */
  function icpByIndustry(o) {
    o = o || {};
    var cpt = (typeof o.costPerTonne === 'number' && isFinite(o.costPerTonne)) ? o.costPerTonne : null;
    var byName = {};
    (o.parties || []).forEach(function (p) { byName[norm(p.name)] = p; });

    var groups = {};
    live(o.sales).forEach(function (s) {
      var p = byName[norm(s.party)] || { name: s.party };
      var ind = industryOf(p);
      var k = ind.key || '_unknown';
      groups[k] = groups[k] || { key: ind.key, label: ind.label, customers: {}, orders: 0, tonnes: 0, revenue: 0, prices: [], guessed: 0, known: 0 };
      var g = groups[k];
      g.orders++;
      g.tonnes += (+s.qty || 0);
      g.revenue += (+s.total || 0);
      if ((+s.qty || 0) > 0) g.prices.push((+s.taxable || +s.total || 0) / (+s.qty));   // ex-GST where available
      g.customers[norm(s.party)] = 1;
      ind.source === 'set' ? g.known++ : g.guessed++;
    });

    var rows = Object.keys(groups).map(function (k) {
      var g = groups[k];
      var priceT = median(g.prices);
      var marginT = (cpt !== null && priceT !== null) ? priceT - cpt : null;
      // per-industry reorder rhythm: the median of each customer's own median
      var perCustGaps = Object.keys(g.customers).map(function (cn) {
        var pr = orderProfile(live(o.sales).filter(function (s) { return norm(s.party) === cn; }), o.today);
        return pr.confident ? pr.medianDays : null;
      }).filter(function (x) { return x !== null; });
      return {
        key: g.key, label: g.label,
        customers: Object.keys(g.customers).length,
        orders: g.orders, tonnes: g.tonnes, revenue: g.revenue,
        pricePerTonne: priceT, marginPerTonne: marginT,
        totalMargin: (marginT !== null) ? marginT * g.tonnes : null,
        medianReorderDays: median(perCustGaps),
        // How much of this row is a NAME GUESS rather than a confirmed industry.
        // A row built mostly from guesses must not be trusted for strategy, and
        // the UI has to be able to say so.
        confirmedPct: g.known + g.guessed ? Math.round(g.known / (g.known + g.guessed) * 100) : 0
      };
    });
    // Rank by what the business actually earns, not by turnover. Chasing revenue
    // instead of margin is how a plant gets busy and poor.
    rows.sort(function (a, b) {
      if (a.totalMargin !== null && b.totalMargin !== null) return b.totalMargin - a.totalMargin;
      return b.revenue - a.revenue;
    });
    return rows;
  }

  /* Plant-average cost per tonne, from the P&L + tonnes actually sold. */
  function costPerTonne(pl, tonnesSold) {
    if (!pl || !tonnesSold || tonnesSold <= 0) return null;
    var cost = (+pl.cogs || 0) + (+pl.labour || 0);
    if (cost <= 0) return null;
    return cost / tonnesSold;
  }

  /* ── who to contact today ─────────────────────────────────────────────
     reorderBoard({sales, parties, today}) -> [row] ranked by money at stake.
     Only customers with a real rhythm can be 'due'; the rest are surfaced
     honestly as 'unknown' so the owner can decide, not be misled. */
  function reorderBoard(o) {
    o = o || {};
    var t = o.today || today();
    var byName = {};
    (o.parties || []).forEach(function (p) { byName[norm(p.name)] = p; });
    var names = {};
    live(o.sales).forEach(function (s) { names[norm(s.party)] = s.party; });

    return Object.keys(names).map(function (k) {
      var mine = live(o.sales).filter(function (s) { return norm(s.party) === k; });
      var p = byName[k] || { name: names[k] };
      var pr = orderProfile(mine, t);
      var ind = industryOf(p);
      // Expected value of the next order = what they usually take, at what they
      // usually pay. Used only to RANK the call list.
      var lastPrice = null;
      for (var i = mine.length - 1; i >= 0; i--) { if ((+mine[i].qty || 0) > 0) { lastPrice = (+mine[i].taxable || +mine[i].total || 0) / +mine[i].qty; break; } }
      var expected = (pr.medianTonnes && lastPrice) ? pr.medianTonnes * lastPrice : null;
      return {
        party: names[k], phone: p.phone || '', industry: ind.label, industryKey: ind.key,
        industryGuessed: ind.source !== 'set',
        orders: pr.orders, tonnes: pr.tonnes, revenue: pr.revenue,
        medianTonnes: pr.medianTonnes, medianDays: pr.medianDays,
        lastDate: pr.lastDate, daysSince: pr.daysSince, dueInDays: pr.dueInDays,
        status: pr.status, confident: pr.confident, why: pr.why,
        expectedValue: expected
      };
    }).sort(function (a, b) {
      var rank = { overdue: 0, due: 1, dormant: 2, ontrack: 3, unknown: 4 };
      var d = rank[a.status] - rank[b.status];
      if (d) return d;
      return (b.expectedValue || 0) - (a.expectedValue || 0);
    });
  }

  /* ── the calibrated lead scorer (used by discovery, later) ────────────
     scoreLead(candidate, icp, opts) -> { score, tier, why[] }
     "High priority" here means: LOOKS LIKE THE CUSTOMERS WHO ALREADY MAKE YOU
     MONEY — not "matched a keyword". If an industry earns you nothing, a
     perfect keyword match in it still scores low. That is the whole point. */
  function scoreLead(cand, icp, opts) {
    cand = cand || {}; opts = opts || {};
    var why = [];
    var row = (icp || []).filter(function (r) { return r.key === cand.industry; })[0];
    if (!row) {
      return { score: 0, tier: 'unknown', why: ['You have never sold to this industry — no evidence either way'] };
    }
    var ranked = (icp || []).filter(function (r) { return r.totalMargin !== null; });
    var best = ranked.length ? ranked[0].totalMargin : null;

    // 1. industry, weighted by what it actually earns YOU (0-55)
    var indScore;
    if (best && row.totalMargin !== null && best > 0) {
      indScore = Math.max(0, Math.min(55, row.totalMargin / best * 55));
      why.push(row.label + ' earns you ' + Math.round(row.totalMargin / best * 100) + '% of your best industry\'s margin');
    } else {
      indScore = Math.min(55, (row.revenue > 0 ? 30 : 0));
      why.push('Ranked on revenue — no cost data to compute margin');
    }
    // LOSS-MAKING INDUSTRY: capping the industry component is NOT enough — size
    // and proximity still added up to a 'medium' score in testing (43/100) and
    // recommended a lead that bleeds money. The logic is the wrong way round:
    // if you lose money per tonne, a BIGGER order loses you MORE, and being
    // close just means you lose it faster. Nothing rescues negative unit
    // economics, so this returns immediately and caps the whole score.
    if (row.marginPerTonne !== null && row.marginPerTonne <= 0) {
      why.unshift('⚠ You currently LOSE about ₹' + Math.round(Math.abs(row.marginPerTonne)).toLocaleString('en-IN') +
        ' per tonne in ' + row.label + ' — a bigger order here loses you more, not less. Fix the price before chasing volume.');
      return { score: Math.min(12, Math.round(indScore)), tier: 'low', why: why };
    }

    // 2. size (0-25) — bigger plant, more lime, but only vs what you've SEEN
    var sizeScore = 0;
    if (cand.estTonnesPerMonth && row.tonnes && row.customers) {
      var typical = row.tonnes / row.customers;
      var ratio = cand.estTonnesPerMonth / (typical || 1);
      sizeScore = Math.max(0, Math.min(25, ratio * 12));
      why.push('At ~' + Math.round(cand.estTonnesPerMonth) + ' T/month they would be ' +
        (ratio >= 1.2 ? 'bigger than' : ratio <= 0.8 ? 'smaller than' : 'about') + ' your typical ' + row.label + ' customer');
    }

    // 3. freight (0-20, and it can go negative) — lime is heavy and low-value.
    // Distance is the quiet killer of a lime deal: a great customer 900km away
    // can be worth less than an average one down the road.
    var freight = 20;
    if (typeof cand.distanceKm === 'number') {
      if (cand.distanceKm <= 150)      { freight = 20; why.push('Close to the plant (' + cand.distanceKm + ' km) — freight barely bites'); }
      else if (cand.distanceKm <= 400) { freight = 12; why.push(cand.distanceKm + ' km — freight is manageable'); }
      else if (cand.distanceKm <= 800) { freight = 4;  why.push(cand.distanceKm + ' km — freight will eat the margin'); }
      else                             { freight = -10; why.push('⚠ ' + cand.distanceKm + ' km — freight probably kills this deal'); }
    }

    var score = Math.max(0, Math.min(100, Math.round(indScore + sizeScore + freight)));
    var tier = score >= 65 ? 'high' : score >= 40 ? 'medium' : 'low';
    return { score: score, tier: tier, why: why };
  }

  return {
    INDUSTRIES: INDUSTRIES, MIN_ORDERS: MIN_ORDERS,
    industryOf: industryOf, industryLabel: industryLabel,
    orderProfile: orderProfile, icpByIndustry: icpByIndustry,
    costPerTonne: costPerTonne, reorderBoard: reorderBoard, scoreLead: scoreLead,
    median: median, daysBetween: daysBetween
  };
}));
