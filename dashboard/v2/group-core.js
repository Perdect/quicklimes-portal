/* ═══════════════════════════════════════════════════════════════════════
   group-core.js — multi-company consolidation math.  Pure, no DOM, no QLD.

   Feeds the Group Overview page: per-company summaries computed from RAW
   company blobs (the same {sales,purchases,prod,chunna} arrays data.js
   saves under ql_data_<companyId>), then consolidated with company
   provenance preserved — never by mixing rows together.

   SEMANTICS ARE MIRRORS, NOT INVENTIONS:
   · liveness    = inventory.html invLive  (not cancelled, not _del/_arch)
   · stock       = inventory.html invStock/invFgStock — a BALANCE as-at a
                   date (inward−consumed cumulatively), and it REFUSES to
                   produce a number when any contributing bill is missing
                   its quantity (missing>0 ⇒ closing:null), because
                   inward-we-know minus consumed-in-full trends negative
                   and looks like theft.
   · sale money  = data.js cS: taxable = qty×rate, gst = taxable×rate%.
   · purchase ₹  = taxable (excl GST), matching every register KPI.
   · avg rates   = data.js avgRate — all-time within the company's own
                   blob, value/qty per purchase group.
   Production cost is materials at own avg purchase rates + labour — the
   same basis as prodStats().costPerTon on the production page.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const live = r => ((r.status || 'pending') !== 'cancelled') && !r._del && !r._arch;
  const hasQty = r => num(r.qty) > 0;
  const isAddon = r => !!r.freight;            // freight add-on rows: value yes, tonnage no
  const inRange = (d, from, to) => !!d && (!from || d >= from) && (!to || d <= to);
  const upto = (d, to) => !!d && (!to || d <= to);
  const round2 = n => Math.round(n * 100) / 100;

  /* Purchase group off the bill's own category text — the same buckets the
     Purchase register and inventory page use. */
  function pgroup(cat) {
    const c = String(cat || '').toLowerCase();
    if (/limestone|lime\s*stone/.test(c)) return 'limestone';
    if (/petcoke|pet\s*coke|\bcoke\b|\bcoal\b/.test(c)) return 'petcoke';
    if (/\bbag|packag|hdpe|plastic/.test(c)) return 'packaging';
    if (/diesel|electric|utilit|water|power/.test(c)) return 'utilities';
    if (/spare|machin|equip|repair/.test(c)) return 'spares';
    return 'other';
  }
  const GROUPS = ['limestone', 'petcoke', 'packaging', 'utilities', 'spares', 'other'];
  const GROUP_LABEL = {
    limestone: 'Limestone', petcoke: 'Petcoke', packaging: 'Packaging (bags)',
    utilities: 'Utilities & Diesel', spares: 'Spares & Machinery', other: 'Other'
  };
  /* Tonnage-bearing groups: qty totals only make sense where the unit is tonnes. */
  const TON_GROUPS = ['limestone', 'petcoke'];

  const saleTaxable = s => round2(num(s.qty) * num(s.rate));
  const saleTotal = s => round2(saleTaxable(s) * (1 + num(s.gstR) / 100));
  const purchVal = p => num(p.taxable) || num(p.total) || 0;

  /* All-time average purchase rate per group, within ONE company's blob. */
  function avgRate(purchases, group) {
    let q = 0, v = 0;
    for (const p of purchases) {
      if (!live(p) || isAddon(p) || pgroup(p.cat) !== group) continue;
      q += num(p.qty); v += purchVal(p);
    }
    return q ? v / q : 0;
  }

  /* Cumulative material balance as-at `to` (mirror of invStock). */
  function materialBal(purchases, prod, group, consumeKey, to) {
    const mat = purchases.filter(p => live(p) && !isAddon(p) && pgroup(p.cat) === group && upto(p.date, to));
    const used = prod.filter(r => live(r) && upto(r.date, to))
      .reduce((a, r) => a + num(r[consumeKey]), 0);
    if (!mat.length && !used) return { inward: 0, used: 0, missing: 0, computable: false, closing: null, empty: true };
    const withQty = mat.filter(hasQty);
    const inward = withQty.reduce((a, r) => a + num(r.qty), 0);
    const missing = mat.length - withQty.length;
    const computable = missing === 0 && mat.length > 0;
    return { inward, used, missing, computable, closing: computable ? round2(inward - used) : null, empty: false };
  }

  /* Cumulative finished-goods balance as-at `to` (mirror of invFgStock):
     made (quicklime+hydrated) − dispatched (sales invoice qty). */
  function fgBal(sales, prod, to) {
    const made = prod.filter(r => live(r) && upto(r.date, to))
      .reduce((a, r) => a + num(r.quicklime) + num(r.hydrated), 0);
    const disp = sales.filter(s => live(s) && upto(s.date, to));
    const withQty = disp.filter(hasQty);
    const out = withQty.reduce((a, r) => a + num(r.qty), 0);
    if (!made && !out) return { inward: 0, used: 0, missing: 0, computable: false, closing: null, empty: true };
    const missing = disp.length - withQty.length;
    return { inward: made, used: out, missing, computable: missing === 0,
             closing: missing === 0 ? round2(made - out) : null, empty: false };
  }

  /* local-date formatting — toISOString() is UTC and shifts IST midnight to
     the previous day, off-by-one-ing every boundary */
  const fmtLocal = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const dayBefore = iso => {
    const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() - 1);
    return fmtLocal(d);
  };

  /* ── one company, one date range → one summary ─────────────────────── */
  function summarize(data, range) {
    data = data || {};
    const from = (range && range.from) || null, to = (range && range.to) || null;
    const sales = data.sales || [], purchases = data.purchases || [];
    const prod = data.prod || [], chunna = data.chunna || [];

    /* SALES (invoiced dispatch — quick/hydrated lime leaves on these) */
    const sIn = sales.filter(s => live(s) && inRange(s.date, from, to));
    const S = {
      count: sIn.length,
      qty: round2(sIn.reduce((a, s) => a + num(s.qty), 0)),
      taxable: round2(sIn.reduce((a, s) => a + saleTaxable(s), 0)),
      total: round2(sIn.reduce((a, s) => a + saleTotal(s), 0)),
      missingQty: sIn.filter(s => !hasQty(s)).length
    };
    S.avgRate = S.qty ? round2(S.taxable / S.qty) : 0;

    /* CHUNNA (separate register, separate product) */
    const cIn = chunna.filter(c => live(c) && inRange(c.date, from, to));
    const C = {
      count: cIn.length,
      qty: round2(cIn.reduce((a, c) => a + num(c.qty), 0)),
      value: round2(cIn.reduce((a, c) => a + num(c.total), 0))
    };

    /* PURCHASES by group */
    const pIn = purchases.filter(p => live(p) && inRange(p.date, from, to));
    const byGroup = {};
    for (const g of GROUPS) byGroup[g] = { key: g, label: GROUP_LABEL[g], qty: 0, value: 0, count: 0, missingQty: 0 };
    for (const p of pIn) {
      const g = byGroup[pgroup(p.cat)];
      g.count++; g.value += purchVal(p);
      if (!isAddon(p)) { hasQty(p) ? g.qty += num(p.qty) : g.missingQty++; }
    }
    for (const g of GROUPS) { byGroup[g].qty = round2(byGroup[g].qty); byGroup[g].value = round2(byGroup[g].value); }
    const P = {
      count: pIn.length,
      value: round2(pIn.reduce((a, p) => a + purchVal(p), 0)),
      tonnes: round2(TON_GROUPS.reduce((a, g) => a + byGroup[g].qty, 0)),
      byGroup
    };

    /* PRODUCTION */
    const rIn = prod.filter(r => live(r) && inRange(r.date, from, to));
    const consumed = {
      limestone: round2(rIn.reduce((a, r) => a + num(r.limestone), 0)),
      petcoke: round2(rIn.reduce((a, r) => a + num(r.petcoke), 0)),
      bags: round2(rIn.reduce((a, r) => a + num(r.bags), 0))
    };
    const produced = {
      quicklime: round2(rIn.reduce((a, r) => a + num(r.quicklime), 0)),
      hydrated: round2(rIn.reduce((a, r) => a + num(r.hydrated), 0))
    };
    const output = round2(produced.quicklime + produced.hydrated);
    const labour = round2(rIn.reduce((a, r) => a + num(r.labour), 0));
    const matCost = round2(
      consumed.limestone * avgRate(purchases, 'limestone') +
      consumed.petcoke * avgRate(purchases, 'petcoke') +
      consumed.bags * avgRate(purchases, 'packaging'));
    const R = {
      runs: rIn.length, consumed, produced, output, labour, matCost,
      cost: round2(matCost + labour),
      costPerTon: output ? round2((matCost + labour) / output) : 0,
      yield: consumed.limestone ? round2(output / consumed.limestone * 100) : 0
    };

    /* STOCK LEDGERS — opening (balance before `from`) → closing (balance at `to`).
       With no `from`, opening is the true zero start of the books. */
    const openTo = from ? dayBefore(from) : null;
    function ledger(key, label, unit, balFn) {
      const open = from ? balFn(openTo) : { closing: 0, computable: true, missing: 0, empty: true };
      const close = balFn(to);
      return {
        key, label, unit,
        opening: from ? open.closing : 0,
        openingComputable: from ? (open.computable || open.empty) : true,
        closing: close.closing, computable: close.computable,
        inward: close.inward, used: close.used, missing: close.missing, empty: close.empty
      };
    }
    const stock = [
      ledger('limestone', 'Limestone', 'T', at => materialBal(purchases, prod, 'limestone', 'limestone', at)),
      ledger('petcoke', 'Petcoke', 'T', at => materialBal(purchases, prod, 'petcoke', 'petcoke', at)),
      ledger('fg', 'Finished goods (Quick + Hydrated lime)', 'T', at => fgBal(sales, prod, at))
    ];

    /* Monthly series for trends (within range) */
    const months = {};
    const bump = (d, k, v) => { const m = String(d || '').slice(0, 7); if (!m) return;
      (months[m] = months[m] || { salesV: 0, purchV: 0, prodT: 0 })[k] += v; };
    sIn.forEach(s => bump(s.date, 'salesV', saleTaxable(s)));
    pIn.forEach(p => bump(p.date, 'purchV', purchVal(p)));
    rIn.forEach(r => bump(r.date, 'prodT', num(r.quicklime) + num(r.hydrated)));

    return { range: { from, to }, sales: S, chunna: C, purchase: P, production: R, stock, months };
  }

  /* ── consolidation: totals + per-company provenance, no row mixing ──── */
  function consolidate(entries) {
    const t = {
      sales: { count: 0, qty: 0, taxable: 0, total: 0 },
      chunna: { count: 0, qty: 0, value: 0 },
      purchase: { count: 0, value: 0, tonnes: 0, byGroup: {} },
      production: { runs: 0, output: 0, labour: 0, matCost: 0, cost: 0,
                    produced: { quicklime: 0, hydrated: 0 },
                    consumed: { limestone: 0, petcoke: 0, bags: 0 } },
      stockClosing: { limestone: 0, petcoke: 0, fg: 0 },
      stockComputable: { limestone: true, petcoke: true, fg: true },
      months: {}
    };
    for (const g of GROUPS) t.purchase.byGroup[g] = { key: g, label: GROUP_LABEL[g], qty: 0, value: 0, count: 0 };
    for (const e of entries) {
      const s = e.summary;
      t.sales.count += s.sales.count; t.sales.qty += s.sales.qty;
      t.sales.taxable += s.sales.taxable; t.sales.total += s.sales.total;
      t.chunna.count += s.chunna.count; t.chunna.qty += s.chunna.qty; t.chunna.value += s.chunna.value;
      t.purchase.count += s.purchase.count; t.purchase.value += s.purchase.value; t.purchase.tonnes += s.purchase.tonnes;
      for (const g of GROUPS) {
        t.purchase.byGroup[g].qty += s.purchase.byGroup[g].qty;
        t.purchase.byGroup[g].value += s.purchase.byGroup[g].value;
        t.purchase.byGroup[g].count += s.purchase.byGroup[g].count;
      }
      t.production.runs += s.production.runs; t.production.output += s.production.output;
      t.production.labour += s.production.labour; t.production.matCost += s.production.matCost;
      t.production.cost += s.production.cost;
      t.production.produced.quicklime += s.production.produced.quicklime;
      t.production.produced.hydrated += s.production.produced.hydrated;
      t.production.consumed.limestone += s.production.consumed.limestone;
      t.production.consumed.petcoke += s.production.consumed.petcoke;
      t.production.consumed.bags += s.production.consumed.bags;
      for (const st of s.stock) {
        const k = st.key === 'fg' ? 'fg' : st.key;
        if (k in t.stockClosing) {
          /* a consolidated balance is only honest if EVERY company's is */
          if (st.computable) t.stockClosing[k] = round2(t.stockClosing[k] + (st.closing || 0));
          else if (!st.empty) t.stockComputable[k] = false;
        }
      }
      for (const m in s.months) {
        const d = t.months[m] = t.months[m] || { salesV: 0, purchV: 0, prodT: 0 };
        d.salesV += s.months[m].salesV; d.purchV += s.months[m].purchV; d.prodT += s.months[m].prodT;
      }
    }
    ['qty', 'taxable', 'total'].forEach(k => t.sales[k] = round2(t.sales[k]));
    t.purchase.value = round2(t.purchase.value); t.purchase.tonnes = round2(t.purchase.tonnes);
    t.production.output = round2(t.production.output); t.production.cost = round2(t.production.cost);
    return t;
  }

  /* ── date presets (§13) ── FY = April–March ─────────────────────────── */
  function presets(nowIso) {
    const now = nowIso ? new Date(nowIso + 'T00:00:00') : new Date();
    const iso = fmtLocal;
    const y = now.getFullYear(), m = now.getMonth();
    const fyStartYear = m >= 3 ? y : y - 1;
    const wk = new Date(now); wk.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
    const yd = new Date(now); yd.setDate(now.getDate() - 1);
    const q = Math.floor(m / 3);
    return [
      { key: 'today', label: 'Today', from: iso(now), to: iso(now) },
      { key: 'yesterday', label: 'Yesterday', from: iso(yd), to: iso(yd) },
      { key: 'week', label: 'This Week', from: iso(wk), to: iso(now) },
      { key: 'month', label: 'This Month', from: iso(new Date(y, m, 1)), to: iso(now) },
      { key: 'lastmonth', label: 'Last Month', from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
      { key: 'quarter', label: 'This Quarter', from: iso(new Date(y, q * 3, 1)), to: iso(now) },
      { key: 'fy', label: 'This FY', from: fyStartYear + '-04-01', to: iso(now) },
      { key: 'lastfy', label: 'Last FY', from: (fyStartYear - 1) + '-04-01', to: fyStartYear + '-03-31' },
      { key: 'all', label: 'All Time', from: null, to: null },
      { key: 'custom', label: 'Custom…', from: null, to: null }
    ];
  }

  const api = { summarize, consolidate, presets, pgroup, GROUPS, GROUP_LABEL,
                _internals: { materialBal, fgBal, avgRate, saleTaxable, saleTotal, live } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GroupCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
