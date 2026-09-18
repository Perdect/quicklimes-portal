/* ═══════════════════════════════════════════════════════════════════════
   customer-core.js — the Customer 360° brain. Pure.

   Browser (window.CustomerCore) + Node (module.exports), so every number the
   Customers module shows — health, segment, demand, reorder window, price
   history, quotation totals, the insights — is unit-tested rather than trusted.

   THE RULE THAT MATTERS MOST
   Nothing in here invents a figure. Every function takes the firm's real rows
   (parties, sales, requirements, quotations, offers, follow-ups, timeline) and
   derives from them. Where the data cannot answer — a customer with no orders
   has no reorder rhythm — the answer is null and the caller says "not enough
   history", never a made-up estimate.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  /* units-core.js is THE quantity / rate-unit arithmetic (window.QLUnits in
     the browser, require()-able in Node). Resolved ONCE here so every quote,
     offer, requirement and deal figure below prices a line the same way the
     GST invoice does. A page that forgets to load it fails loudly, not with a
     silently wrong total. */
  var U = root.QLUnits || (typeof require === 'function' ? require('./units-core.js') : null);
  if (!U) throw new Error('customer-core.js needs units-core.js loaded first (window.QLUnits)');
  var api = factory(U);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CustomerCore = api;
}(typeof self !== 'undefined' ? self : this, function (U) {
  'use strict';

  /* ── vocabularies — the ONE place each list lives ──────────────────── */
  var CUSTOMER_TYPES = [
    ['dealer', 'Dealer'], ['distributor', 'Distributor'], ['manufacturer', 'Manufacturer'], ['trader', 'Trader'],
    ['construction', 'Construction Company'], ['steel', 'Steel Plant'], ['chemical', 'Chemical Industry'],
    ['paper', 'Paper Industry'], ['sugar', 'Sugar Industry'], ['water', 'Water Treatment'],
    ['export', 'Export Customer'], ['other', 'Other']
  ];
  var CUSTOMER_STATUS = [
    ['active', 'Active'], ['new', 'New'], ['prospect', 'Prospect'], ['inactive', 'Inactive'], ['blocked', 'Blocked']
  ];
  /* Products the firm sells today. "Other" keeps a free-text name so a new
     grade can be sold before it earns a row here. */
  var PRODUCTS = [
    ['Quick Lime', 'Quick Lime'], ['Quick Lime Powder', 'Quick Lime Powder'], ['Hydrated Lime', 'Hydrated Lime'], ['Other', 'Other']
  ];
  /* Quantity units come from units-core (Ton · Kg · Quintal · Bag · Nos ·
     Litre · Other). Records written before this list existed carry 'MT' /
     'KG' / 'BAG' — unitKey() folds those onto the canonical key, so a stored
     'MT' still reads, prints and prices as a tonne. */
  var UNITS = U.UNITS.map(function (u) { return [u.key, u.label]; });
  var LEGACY_UNIT = 'MT';                                   // what every CRM row meant before it carried a unit
  function unitKey(u) { return U.normalizeUnit(u) || String(u == null ? '' : u).trim(); }
  /* The rate unit a STORED row was priced in — the legacy rule, the same one
     data.js applies to the register: an explicit rateUnit wins; a row with no
     rateUnit (written before rateUnit existed) is priced per its OWN unit, so
     a stored Kg line at 5,300 keeps the ₹40,545,000 it was booked with.
     Never guess per Ton here: that silently re-prices old records. */
  function rateUnitOf(unit, rateUnit) { return U.normalizeUnit(rateUnit) || String(rateUnit || '').trim() || unitKey(unit || LEGACY_UNIT); }
  /* The rate unit a NEW line gets when a form leaves it blank — the business
     default (mass → per Ton, bags → per Bag). Only the store's add* / form
     paths use this; reading an existing record goes through rateUnitOf. */
  function newRateUnit(unit, rateUnit) { return U.normalizeUnit(rateUnit) || String(rateUnit || '').trim() || U.defaultRateUnit(unitKey(unit || LEGACY_UNIT)); }
  /* One line, priced the way the invoice prices it: billable qty (converted
     INTO the rate's unit) × rate. Never qty × rate. */
  function priceLine(qty, unit, rate, rateUnit) { var u = unitKey(unit || LEGACY_UNIT); return U.lineAmount({ qty: qty, unit: u, rate: rate, rateUnit: rateUnitOf(u, rateUnit) }); }
  function tonnesOf(qty, unit) { var t = U.toTonnes(+qty || 0, unitKey(unit || LEGACY_UNIT)); return t == null ? 0 : t; }
  var fmtQty = function (qty, unit) { return U.fmtQty(qty, unitKey(unit || LEGACY_UNIT)); };
  var fmtRate = function (rate, rateUnit, unit) { return U.fmtRate(rate, rateUnitOf(unit, rateUnit)); };
  var REQ_FREQ = [['monthly', 'Monthly'], ['weekly', 'Weekly'], ['one-time', 'One-time']];
  var FORMS = [['lump', 'Lump'], ['powder', 'Powder']];
  var PACKAGING = [['25kg', '25 KG Bag'], ['40kg', '40 KG Bag'], ['50kg', '50 KG Bag'], ['jumbo', 'Jumbo Bag'], ['bulk', 'Bulk (loose)'], ['custom', 'Custom']];
  var FREIGHT = [['extra', 'Freight extra'], ['included', 'Freight included']];
  var PAYMENT_TERMS = [
    ['advance', 'Advance'], ['against_delivery', 'Against delivery'], ['7d', '7 days'], ['15d', '15 days'],
    ['30d', '30 days'], ['45d', '45 days'], ['custom', 'Custom']
  ];
  var TRANSPORT = [['own', 'Our transport'], ['customer', "Customer's transport"], ['transporter', 'Transporter'], ['any', 'Any']];
  var QUOTE_STATUS = [
    ['draft', 'Draft'], ['sent', 'Sent'], ['viewed', 'Viewed'], ['negotiation', 'Negotiation'],
    ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['expired', 'Expired'], ['converted', 'Converted to order']
  ];
  var OFFER_STATUS = [['saved', 'Saved'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['expired', 'Expired']];
  /* The order-lifecycle pipeline. `open` = still in play; `p` = a default
     prior for weighting the pipeline value, never a fact. */
  var STAGES = [
    { key: 'new_lead',        label: 'New Lead',             p: 0.05, open: true },
    { key: 'req_received',    label: 'Requirement Received', p: 0.15, open: true },
    { key: 'quote_prepared',  label: 'Quotation Prepared',   p: 0.25, open: true },
    { key: 'quote_sent',      label: 'Quotation Sent',       p: 0.35, open: true },
    { key: 'negotiation',     label: 'Negotiation',          p: 0.50, open: true },
    { key: 'price_confirmed', label: 'Price Confirmed',      p: 0.75, open: true },
    { key: 'order_confirmed', label: 'Order Confirmed',      p: 0.90, open: true },
    { key: 'production',      label: 'Production',           p: 0.95, open: true },
    { key: 'dispatched',      label: 'Dispatched',           p: 0.98, open: true },
    { key: 'delivered',       label: 'Delivered',            p: 1.00, open: true },
    { key: 'payment_pending', label: 'Payment Pending',      p: 1.00, open: true },
    { key: 'completed',       label: 'Completed',            p: 1.00, open: false },
    { key: 'lost',            label: 'Lost',                 p: 0.00, open: false }
  ];
  var FOLLOWUP_TYPES = [
    ['call', 'Call'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['meeting', 'Meeting'],
    ['price', 'Price follow-up'], ['payment', 'Payment follow-up'], ['requirement', 'Requirement follow-up']
  ];
  /* Segments: the first block is COMPUTED from the registers, the second is a
     tag a person sets. A manual tag is never overwritten by the computation. */
  var SEGMENTS = {
    vip: { label: 'VIP', auto: true, bg: '#fef3c7', fg: '#b45309', dot: '#f59e0b' },
    high_value: { label: 'High Value', auto: true, bg: '#ede9fe', fg: '#6d28d9', dot: '#8b5cf6' },
    regular: { label: 'Regular', auto: true, bg: '#eff4ff', fg: '#1d4ed8', dot: '#3b82f6' },
    new: { label: 'New', auto: true, bg: '#ecfdf3', fg: '#15803d', dot: '#22c55e' },
    high_potential: { label: 'High Potential', auto: true, bg: '#ecfeff', fg: '#0e7490', dot: '#06b6d4' },
    inactive: { label: 'Inactive', auto: true, bg: '#f1f5f9', fg: '#475569', dot: '#94a3b8' },
    at_risk: { label: 'At Risk', auto: true, bg: '#fef2f2', fg: '#b91c1c', dot: '#ef4444' },
    credit_risk: { label: 'Credit Risk', auto: true, bg: '#fff1f2', fg: '#9f1239', dot: '#f43f5e' },
    prospect: { label: 'Prospect', auto: true, bg: '#f5f3ff', fg: '#6d28d9', dot: '#a78bfa' },
    price_sensitive: { label: 'Price Sensitive', auto: false, bg: '#fff7ed', fg: '#c2410c', dot: '#f97316' },
    export: { label: 'Export', auto: false, bg: '#f0f9ff', fg: '#0369a1', dot: '#0ea5e9' },
    dealer: { label: 'Dealer', auto: false, bg: '#f8fafc', fg: '#334155', dot: '#64748b' },
    distributor: { label: 'Distributor', auto: false, bg: '#f8fafc', fg: '#334155', dot: '#64748b' }
  };
  var TIMELINE_KINDS = {
    created: 'Customer created', requirement: 'Requirement added', quote_sent: 'Quotation sent', quote_status: 'Quotation updated',
    price_revised: 'Price revised', price_request: 'Customer asked for a lower price', whatsapp: 'WhatsApp message sent', email: 'Email sent',
    call: 'Call', meeting: 'Meeting', offer_sent: 'Offer sent', followup_done: 'Follow-up completed', followup_due: 'Follow-up scheduled',
    order: 'Order received', invoice: 'Invoice created', payment: 'Payment received', overdue: 'Payment overdue',
    delivered: 'Delivery completed', complaint: 'Complaint / issue', note: 'Internal note', status: 'Status changed', document: 'Document added',
    edit: 'Details updated'
  };
  var DOC_KINDS = [['gst', 'GST Certificate'], ['pan', 'PAN'], ['po', 'Purchase Order'], ['contract', 'Contract'],
    ['quality', 'Quality Requirement'], ['test', 'Test Report'], ['other', 'Other']];

  function labelOf(list, key) { for (var i = 0; i < list.length; i++) if (list[i][0] === key) return list[i][1]; return key || ''; }
  function stage(key) { for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === key) return STAGES[i]; return null; }
  function stageLabel(key) { var s = stage(key); return s ? s.label : (key || ''); }
  function isOpenStage(key) { var s = stage(key); return s ? s.open : false; }

  /* ── small date helpers (ISO strings in, never Date objects out) ────── */
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseD(s) { if (!s) return null; var p = String(s).slice(0, 10).split('-').map(Number); if (p.length < 3 || !p[0]) return null; return new Date(p[0], p[1] - 1, p[2]); }
  function daysBetween(a, b) { var da = parseD(a), db = parseD(b); if (!da || !db) return null; return Math.round((db - da) / 864e5); }
  function addDays(s, n) { var d = parseD(s); if (!d) return null; d.setDate(d.getDate() + n); return iso(d); }
  /* An event stamp is stored as UTC ISO ("…Z"). The day it belongs to is the
     LOCAL day — 01:12 IST on the 14th is not the 13th, whatever UTC says. */
  function localIso(at) {
    if (!at) return '';
    var s = String(at);
    if (!/[zZ]$|[+-]\d\d:\d\d$/.test(s)) return s;              // already local / naive
    var d = new Date(s); if (isNaN(d)) return s;
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function median(arr) { if (!arr.length) return null; var s = arr.slice().sort(function (a, b) { return a - b; }); var m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function round(n, d) { var f = Math.pow(10, d || 0); return Math.round((+n || 0) * f) / f; }

  /* ── customer code: C-0001, C-0002 … the next after the highest on file ── */
  function nextCode(parties, prefix) {
    prefix = prefix || 'C-';
    var mx = 0;
    (parties || []).forEach(function (p) {
      var m = /^(?:[A-Z]+-)?C-(\d+)$/.exec(String(p.code || '').toUpperCase());
      if (m) mx = Math.max(mx, parseInt(m[1], 10));
    });
    return prefix + String(mx + 1).padStart(4, '0');
  }

  /* ── quotation maths — one place, so the PDF, the WhatsApp text and the
        register can never disagree ──────────────────────────────────────
     items: [{ qty, rate, discount }] discount is ₹ per line (absolute).
     charges: freight, loading, other are ₹ absolute on the quotation.
     GST applies to goods AND charges billed with them (the invoice does the
     same via saleTaxable). An export quotation is zero-rated. */
  function quoteTotals(q) {
    q = q || {};
    var items = Array.isArray(q.items) ? q.items : [];
    var goods = 0;
    var lines = items.map(function (it) {
      var qty = +it.qty || 0, rate = +it.rate || 0, disc = +it.discount || 0;
      /* 7,650 Kg @ ₹5,300 / Ton is 7.65 × 5,300 = ₹40,545 — the line is priced
         through units-core, exactly as the GST invoice prices it. A rate that
         cannot price the quantity (per Ton on Bags) is flagged, not multiplied. */
      var L = priceLine(qty, it.unit, rate, it.rateUnit);
      var amt = Math.max(0, L.amount - disc);
      goods += amt;
      return { product: it.product || '', qty: qty, unit: unitKey(it.unit || LEGACY_UNIT), rate: rate, rateUnit: L.rateUnit, billableQty: L.billableQty, billableUnit: L.billableUnit, discount: disc, amount: round(amt, 2), ok: L.ok, why: L.why };
    });
    var freight = +q.freight || 0, loading = +q.loading || 0, other = +q.other || 0;
    var taxable = goods + freight + loading + other;
    var gstR = q.isExport ? 0 : (q.gstR == null || q.gstR === '' ? 5 : +q.gstR);
    var gst = taxable * gstR / 100;
    var total = taxable + gst;
    var bad = lines.filter(function (l) { return !l.ok; });
    return { lines: lines, goods: round(goods, 2), freight: freight, loading: loading, other: other, taxable: round(taxable, 2), gstR: gstR, gst: round(gst, 2), total: round(total, 2), ok: !bad.length, why: bad.length ? bad[0].why : '',
             tonnes: round(items.reduce(function (a, it) { return a + tonnesOf(it.qty, it.unit); }, 0), 3) };
  }
  /* A quotation past its validity is expired unless it has already been
     decided — accepted, rejected, converted keep their word. */
  function effectiveQuoteStatus(q, today) {
    if (!q) return 'draft';
    var st = q.status || 'draft';
    if (['accepted', 'rejected', 'converted', 'expired'].indexOf(st) >= 0) return st;
    if (q.validUntil && today && String(q.validUntil).slice(0, 10) < String(today).slice(0, 10)) return 'expired';
    return st;
  }
  function isOpenQuote(q, today) { return ['draft', 'sent', 'viewed', 'negotiation'].indexOf(effectiveQuoteStatus(q, today)) >= 0; }

  /* ── requirement → monthly demand ──────────────────────────────────────
     A monthly requirement counts as-is, a weekly one ×4.33, a one-time one is
     not a rhythm and contributes nothing to the monthly figure. */
  function monthlyOf(req) {
    if (!req || req.status === 'closed') return 0;
    var q = +req.qty || 0;
    var t = U.toTonnes(q, unitKey(req.unit || LEGACY_UNIT)); if (t != null) q = t;     // a Kg requirement is a tonnage; a Bag one stays a count
    if (req.freq === 'monthly') return q;
    if (req.freq === 'weekly') return round(q * 4.33, 2);
    return 0;
  }

  /* ── purchase rhythm from real orders of one product (or all) ───────── */
  function rhythm(salesRows, today) {
    var dates = (salesRows || []).map(function (s) { return String(s.date || '').slice(0, 10); }).filter(Boolean).sort();
    // one order per day at most for cadence purposes
    dates = dates.filter(function (d, i) { return i === 0 || d !== dates[i - 1]; });
    if (dates.length < 2) return { orders: dates.length, gapDays: null, last: dates[dates.length - 1] || null, next: null, status: dates.length ? 'insufficient' : 'none' };
    var gaps = []; for (var i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
    var recent = gaps.slice(-6);                       // the last six intervals decide the rhythm
    var gap = Math.max(1, Math.round(median(recent)));
    var lo = Math.min.apply(null, recent), hi = Math.max.apply(null, recent);
    var last = dates[dates.length - 1];
    var next = addDays(last, gap);
    var sinceLast = today ? daysBetween(last, today) : null;
    var status = 'ok';
    if (sinceLast != null) {
      if (sinceLast > gap * 1.5 + 3) status = 'overdue';
      else if (sinceLast >= gap * 0.8) status = 'due';
    }
    return { orders: dates.length, gapDays: gap, gapLo: lo, gapHi: hi, last: last, next: next, sinceLast: sinceLast, status: status };
  }

  /* A sale's tonnage and its rate PER TON, whatever the truck was weighed in.
     Register rows (salesRows) already carry `tonnes`; raw rows are converted
     from their unit (blank = Ton, the register's convention). */
  function saleTonnes(s) { if (s && s.tonnes != null && s.tonnes !== '') return +s.tonnes || 0; return tonnesOf(s && s.qty, s && s.unit); }
  function ratePerTon(s) {
    if (!s) return null;
    var u = unitKey(s.unit || LEGACY_UNIT);
    if (U.familyOf(u) !== 'mass') return +s.rate || null;                                   // bags / pieces: the rate is per that unit
    var amt = (+s.taxable > 0) ? +s.taxable : priceLine(s.qty, u, s.rate, s.rateUnit).amount;
    var r = U.impliedRate(amt, s.qty, u, 'Ton');
    return r == null ? (+s.rate || null) : r;
  }

  /* ── per-product demand intelligence ───────────────────────────────────
     sales: this customer's invoices [{date, product, qty, rate, total}]
     reqs:  this customer's requirements */
  function demandByProduct(sales, reqs, today) {
    var out = {};
    var touch = function (p) { p = p || 'Quick Lime'; return out[p] || (out[p] = { product: p, monthlyDemand: 0, demandUnit: null, targetRate: null, prefRate: null, moq: null, orders: 0, qtyTotal: 0, avgOrderQty: null, lastQty: null, lastDate: null, lastRate: null, frequency: null, nextWindow: null, reqCount: 0 }); };
    /* What monthlyDemand is counted in: tonnes for any mass unit (monthlyOf
       and saleTonnes convert), the unit itself for bags / pieces. */
    var demandUnitOf = function (unit) { var u = unitKey(unit || LEGACY_UNIT); return U.familyOf(u) === 'mass' ? 'Ton' : u; };
    (reqs || []).forEach(function (r) {
      var d = touch(r.product);
      d.reqCount++;
      if (!d.demandUnit) d.demandUnit = demandUnitOf(r.unit);
      d.monthlyDemand = round(d.monthlyDemand + monthlyOf(r), 2);
      if (r.targetRate && (d.targetRate == null || r.updatedAt > (d._tAt || ''))) { d.targetRate = +r.targetRate; d.rateUnit = rateUnitOf(r.unit, r.rateUnit); d._tAt = r.updatedAt || ''; }
      if (r.prefRate && d.prefRate == null) d.prefRate = +r.prefRate;
      if (r.moq && d.moq == null) d.moq = +r.moq;
    });
    (sales || []).forEach(function (s) {
      var d = touch(s.product);
      var t = saleTonnes(s);
      if (!d.demandUnit) d.demandUnit = demandUnitOf(s.unit);
      d.orders++; d.qtyTotal = round(d.qtyTotal + t, 3);
      if (!d.lastDate || s.date > d.lastDate) { d.lastDate = s.date; d.lastQty = t; d.lastRate = ratePerTon(s); if (!d.rateUnit) d.rateUnit = U.familyOf(unitKey(s.unit || LEGACY_UNIT)) === 'mass' ? 'Ton' : rateUnitOf(s.unit, s.rateUnit); }
    });
    Object.keys(out).forEach(function (k) {
      var d = out[k]; delete d._tAt;
      d.avgOrderQty = d.orders ? round(d.qtyTotal / d.orders, 2) : null;
      var rh = rhythm((sales || []).filter(function (s) { return (s.product || 'Quick Lime') === k; }), today);
      d.frequency = rh.gapDays; d.nextWindow = rh.next; d.rhythmStatus = rh.status; d.sinceLast = rh.sinceLast;
      /* When no requirement says otherwise, the observed rhythm IS the demand:
         average order every N days ≈ avg × 30/N per month. Labelled 'observed'
         so the UI can say where the number came from. */
      if (!d.monthlyDemand && d.frequency && d.avgOrderQty) { d.monthlyDemand = round(d.avgOrderQty * 30 / d.frequency, 1); d.demandSource = 'observed'; }
      else if (d.monthlyDemand) d.demandSource = 'requirement';
      else d.demandSource = 'none';
      /* The potential is the monthly demand PRICED at the rate — through
         units-core, never demand × rate: 7,650 Kg/month is 7.65 Ton, and a
         target of ₹5.30 / Kg prices it as 7,650 Kg × 5.30 = ₹40,545, not
         7.65 × 5.30 = ₹41. The rate's unit is d.rateUnit (the target's, else
         the last sale's — per Ton for a mass). A rate that cannot price the
         demand (per Ton on Bags) leaves the potential unknown. */
      var rate = d.targetRate || d.lastRate || null;
      var P = (d.monthlyDemand && rate) ? U.lineAmount({ qty: d.monthlyDemand, unit: d.demandUnit || 'Ton', rate: rate, rateUnit: rateUnitOf(d.demandUnit || 'Ton', d.rateUnit) }) : null;
      d.monthlyPotential = (P && P.ok) ? round(P.amount, 0) : null;
    });
    return out;
  }

  /* ── price history: every rate this customer ever saw, per product ──── */
  function priceHistory(sales, quotes, offers, product) {
    var rows = [];
    /* Every row says what its quantity is in and what its rate is per, so the
       table can print "7,650 Kg" beside "₹5,300.00 / Ton" instead of two bare
       numbers. A sold rate is normalised to per Ton (a Kg invoice booked at
       ₹5,300 / Ton compares with a Ton one). */
    (sales || []).forEach(function (s) { if (product && (s.product || 'Quick Lime') !== product) return; var u = unitKey(s.unit || LEGACY_UNIT); var perTon = U.familyOf(u) === 'mass'; rows.push({ date: s.date, product: s.product || 'Quick Lime', qty: +s.qty || 0, unit: u, rate: (perTon ? ratePerTon(s) : +s.rate) || 0, rateUnit: perTon ? 'Ton' : rateUnitOf(u, s.rateUnit), status: 'sold', ref: s.inv ? '#' + s.inv : '', kind: 'sale', id: s.idx }); });
    (quotes || []).forEach(function (q) {
      (q.items || []).forEach(function (it) {
        if (product && it.product !== product) return;
        rows.push({ date: q.date, product: it.product, qty: +it.qty || 0, unit: unitKey(it.unit || LEGACY_UNIT), rate: +it.rate || 0, rateUnit: rateUnitOf(it.unit, it.rateUnit), status: 'quoted', sub: q.status || 'draft', ref: q.no || '', kind: 'quote', id: q.id });
      });
    });
    (offers || []).forEach(function (o) { if (product && o.product !== product) return; rows.push({ date: o.date || String(o.at || '').slice(0, 10), product: o.product, qty: +o.qty || 0, unit: unitKey(o.unit || LEGACY_UNIT), rate: +o.rate || 0, rateUnit: rateUnitOf(o.unit, o.rateUnit), status: 'offered', sub: o.status || 'sent', ref: o.no || '', kind: 'offer', id: o.id }); });
    rows = rows.filter(function (r) { return r.rate > 0; }).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var sold = rows.filter(function (r) { return r.status === 'sold'; });
    var offered = rows.filter(function (r) { return r.status !== 'sold'; });
    var stats = {
      current: sold.length ? sold[0].rate : null,
      last: sold.length > 1 ? sold[1].rate : null,
      avg: sold.length ? round(sold.reduce(function (a, r) { return a + r.rate; }, 0) / sold.length, 0) : null,
      lowest: sold.length ? Math.min.apply(null, sold.map(function (r) { return r.rate; })) : null,
      highest: sold.length ? Math.max.apply(null, sold.map(function (r) { return r.rate; })) : null,
      lastOffered: offered.length ? offered[0].rate : null,
      lastOfferedOn: offered.length ? offered[0].date : null
    };
    /* the price line: sold rates in date order, for the small chart */
    var series = sold.slice().reverse().map(function (r) { return { date: r.date, rate: r.rate }; });
    return { rows: rows, stats: stats, series: series };
  }

  /* ── HEALTH SCORE (0–100) ────────────────────────────────────────────────
     Six ingredients, each honest about missing data (neutral middle, never a
     penalty for being new):
       payment behaviour 25 · outstanding 15 · order frequency 15 ·
       revenue 15 · recent activity 15 · quotation conversion 15
     `f` is the enriched customer (see enrich()) */
  function healthScore(f) {
    var comp = {};
    // payment behaviour: collection rate blended with avg days to pay vs terms
    if (f.salesN > 0) {
      var coll = f.salesAmt > 0 ? Math.min(1, f.salesPaid / f.salesAmt) : 1;
      var termDays = f.creditDays > 0 ? f.creditDays : 30;
      var speed = f.avgPayDays == null ? 0.7 : Math.max(0, Math.min(1, 1 - Math.max(0, f.avgPayDays - termDays) / (termDays * 2)));
      comp.payment = round(25 * (coll * 0.6 + speed * 0.4), 1);
    } else comp.payment = 14;
    // outstanding: overdue as a share of billed
    comp.outstanding = f.salesAmt > 0 ? round(15 - Math.min(15, (f.overdue / f.salesAmt) * 40), 1) : 10;
    // order frequency: 2+ orders/month is full marks; measured on the last 6 months
    comp.frequency = f.salesN > 0 ? round(Math.min(15, (f.ordersLast6m / 6) * 7.5), 1) : 4;
    // revenue: share of the book, capped so one giant customer is not "healthier" for size alone
    comp.revenue = f.salesN > 0 ? round(Math.min(15, f.share * 60), 1) : 3;
    // recent activity: last order OR last touch, whichever is fresher
    var rec = f.recDays == null ? 9999 : f.recDays;
    comp.activity = rec >= 9999 ? 5 : round(Math.max(0, 15 - rec / 6), 1);
    // quotation conversion: neutral until there is a decided quotation
    if (f.quotesDecided > 0) comp.conversion = round(15 * (f.quotesWon / f.quotesDecided), 1);
    else comp.conversion = 8;
    var total = Object.keys(comp).reduce(function (a, k) { return a + comp[k]; }, 0);
    return { score: Math.max(0, Math.min(100, Math.round(total))), comp: comp };
  }

  /* ── automatic segment ─────────────────────────────────────────────────── */
  function autoSegment(f, ctx) {
    ctx = ctx || {};
    if (f.salesN === 0 && f.lifetimeN === 0) return (f.monthlyPotential > 0 || f.openQuotes > 0) ? 'high_potential' : 'prospect';
    if (f.creditLimit > 0 && f.currentBalance > f.creditLimit) return 'credit_risk';
    if (f.overdue > 0 && f.salesAmt > 0 && f.overdue / f.salesAmt > 0.12 && f.health < 62) return 'at_risk';
    if (f.salesRec != null && f.salesRec > 90) return 'inactive';
    if (ctx.top20cut != null && f.salesAmt >= ctx.top20cut && f.health >= 64) return 'vip';
    if (ctx.avgSales != null && f.salesAmt >= ctx.avgSales * 2) return 'high_value';
    if (f.lifetimeN <= 1 && f.salesRec != null && f.salesRec <= 45) return 'new';
    if (f.monthlyPotential > 0 && f.salesAmt < (ctx.avgSales || 0) && f.monthlyPotential * 3 > f.salesAmt) return 'high_potential';
    return 'regular';
  }

  /* ── ENRICH: parties + the registers → the customer records the UI reads ──
     input: { parties, sales, reqs, quotes, offers, followups, timeline, deals, today }
       sales rows carry: party, gstin, date, product, qty, rate, total, paid, outstanding, status, payments[]
     output: one record per party (customer types only unless includeAll) */
  function enrich(input) {
    input = input || {};
    var today = input.today || iso(new Date());
    var parties = input.parties || [];
    var resolve = buildResolver(parties);
    var salesBy = {}, lifeBy = {};
    (input.sales || []).forEach(function (s) {
      if (s.status === 'cancelled') return;
      var k = resolve(s.party, s.gstin); if (k < 0) return;
      var b = salesBy[k] || (salesBy[k] = { amt: 0, due: 0, paid: 0, n: 0, last: '', rows: [], overdue: 0, payDays: [], lastPay: null, n6: 0, amt30: 0, amtPrev30: 0, due30: 0 });
      var L = lifeBy[k] || (lifeBy[k] = { n: 0 });
      L.n++;
      b.amt += s.total; b.due += s.outstanding; b.paid += s.paid; b.n++;
      if (s.date > b.last) b.last = s.date;
      b.rows.push(s);
      var age = daysBetween(s.date, today);
      if (age != null && age <= 183) b.n6++;
      if (age != null && age <= 30) b.amt30 += s.total; else if (age != null && age <= 60) b.amtPrev30 += s.total;
      var terms = (parties[k] && +parties[k].creditDays) || 30;
      if (s.outstanding > 0.5 && age != null && age > terms) b.overdue += s.outstanding;
      (s.payments || []).forEach(function (p) {
        var d = daysBetween(s.date, p.date || s.date);
        if (d != null && d >= 0) b.payDays.push(d);
        if (p.date && (!b.lastPay || p.date > b.lastPay.date)) b.lastPay = { date: p.date, amount: +p.amount || 0 };
      });
      if (!(s.payments || []).length && s.paid > 0.5) {
        var pd = s.paidDate || s.date;
        var dd = daysBetween(s.date, pd); if (dd != null && dd >= 0) b.payDays.push(dd);
        if (!b.lastPay || pd > b.lastPay.date) b.lastPay = { date: pd, amount: s.paid };
      }
    });
    var byCust = function (arr) { var m = {}; (arr || []).forEach(function (x) { var k = x.cust; if (!m[k]) m[k] = []; m[k].push(x); }); return m; };
    var reqsBy = byCust(input.reqs), quotesBy = byCust(input.quotes), offersBy = byCust(input.offers), fuBy = byCust(input.followups), tlBy = byCust(input.timeline), dealsBy = byCust(input.deals);

    var amts = Object.keys(salesBy).map(function (k) { return salesBy[k].amt; }).sort(function (a, b) { return b - a; });
    var totalRev = amts.reduce(function (a, b) { return a + b; }, 0) || 1;
    var top20cut = amts.length ? amts[Math.max(0, Math.floor(amts.length * 0.2) - 1)] : null;
    var avgSales = amts.length ? totalRev / amts.length : null;

    var out = parties.map(function (p, i) {
      var s = salesBy[i] || { amt: 0, due: 0, paid: 0, n: 0, last: '', rows: [], overdue: 0, payDays: [], lastPay: null, n6: 0, amt30: 0, amtPrev30: 0 };
      var id = p.id || ('idx' + i);
      var reqs = reqsBy[id] || [], quotes = quotesBy[id] || [], offers = offersBy[id] || [], fus = fuBy[id] || [], tl = tlBy[id] || [], deals = dealsBy[id] || [];
      var salesRec = s.last ? daysBetween(s.last, today) : null;
      var lastTouch = null;
      tl.forEach(function (e) { var d = localIso(e.at).slice(0, 10); if (d && (!lastTouch || d > lastTouch)) lastTouch = d; });
      fus.forEach(function (f) { if (f.status === 'done' && f.doneAt) { var d = String(f.doneAt).slice(0, 10); if (!lastTouch || d > lastTouch) lastTouch = d; } });
      var touchRec = lastTouch ? daysBetween(lastTouch, today) : null;
      /* how often each kind of event happened in the last 60 days — the
         "asked for a lower price 3 times" insight reads this */
      var tlKinds = {};
      tl.forEach(function (e) { var age = daysBetween(localIso(e.at).slice(0, 10), today); if (age != null && age <= 60) tlKinds[e.kind] = (tlKinds[e.kind] || 0) + 1; });
      var recDays = salesRec == null ? touchRec : (touchRec == null ? salesRec : Math.min(salesRec, touchRec));
      var demand = demandByProduct(s.rows, reqs, today);
      var monthlyDemand = 0, monthlyPotential = 0, observedOnly = true;
      Object.keys(demand).forEach(function (k) { monthlyDemand += demand[k].monthlyDemand || 0; monthlyPotential += demand[k].monthlyPotential || 0; if (demand[k].demandSource === 'requirement') observedOnly = false; });
      var openQuotes = quotes.filter(function (q) { return isOpenQuote(q, today); });
      var decided = quotes.filter(function (q) { return ['accepted', 'converted', 'rejected', 'expired'].indexOf(effectiveQuoteStatus(q, today)) >= 0; });
      var won = quotes.filter(function (q) { return ['accepted', 'converted'].indexOf(effectiveQuoteStatus(q, today)) >= 0; });
      var openFu = fus.filter(function (f) { return f.status !== 'done' && f.status !== 'skipped'; });
      var dueFu = openFu.filter(function (f) { return String(f.date || '').slice(0, 10) <= today; });
      var opening = +p.opening || 0;
      var currentBalance = opening + s.amt - s.paid + (input.ledgerNet ? (input.ledgerNet(i) || 0) : 0);
      var creditLimit = +p.creditLimit || 0;
      var avgPayDays = s.payDays.length ? round(s.payDays.reduce(function (a, b) { return a + b; }, 0) / s.payDays.length, 0) : null;
      var rh = rhythm(s.rows, today);
      var f = {
        idx: i, id: id, name: p.name, code: p.code || '', type: p.type || 'customer', ctype: p.ctype || '', cstatus: p.cstatus || '',
        gstin: p.gstin || '', phone: p.phone || '', wa: p.wa || '', email: p.email || '', contact: p.contact || '', city: p.city || '', state: p.state || '',
        salesperson: p.salesperson || '', creditDays: +p.creditDays || 0, creditLimit: creditLimit, opening: opening,
        since: p.since || '', tags: Array.isArray(p.segments) ? p.segments : [],
        salesAmt: s.amt, salesDue: s.due, salesPaid: s.paid, salesN: s.n, salesLast: s.last || null, overdue: s.overdue,
        lifetimeN: (lifeBy[i] || { n: 0 }).n, ordersLast6m: s.n6, amt30: s.amt30, amtPrev30: s.amtPrev30,
        invoices: s.rows.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }),
        avgOrder: s.n ? round(s.amt / s.n, 0) : 0, share: s.amt / totalRev, avgPayDays: avgPayDays, lastPay: s.lastPay,
        salesRec: salesRec, touchRec: touchRec, recDays: recDays, lastTouch: lastTouch,
        currentBalance: currentBalance, availableCredit: creditLimit > 0 ? round(creditLimit - Math.max(0, currentBalance), 0) : null,
        reqs: reqs, quotes: quotes, offers: offers, followups: fus, deals: deals, demand: demand,
        monthlyDemand: round(monthlyDemand, 2), monthlyPotential: round(monthlyPotential, 0),
        openQuotes: openQuotes.length, openQuoteValue: round(openQuotes.reduce(function (a, q) { return a + quoteTotals(q).total; }, 0), 0),
        quotesDecided: decided.length, quotesWon: won.length, conversion: decided.length ? round(won.length / decided.length * 100, 0) : null,
        openFollowups: openFu.length, dueFollowups: dueFu.length, nextFollowup: openFu.map(function (f) { return f.date; }).sort()[0] || null,
        rhythm: rh, timelineKinds: tlKinds, demandSourceObserved: observedOnly && monthlyDemand > 0
      };
      var h = healthScore(f); f.health = h.score; f.hc = h.comp;
      f.reliability = f.salesN > 0 ? (f.avgPayDays == null ? 'no payment history' : f.avgPayDays <= (f.creditDays || 30) ? 'pays on time' : f.avgPayDays <= (f.creditDays || 30) * 1.5 ? 'pays late' : 'pays very late') : 'no orders yet';
      f.seg = autoSegment(f, { top20cut: top20cut, avgSales: avgSales });
      /* the derived status when the owner has not set one */
      f.statusEff = f.cstatus || (f.salesN === 0 ? 'prospect' : (f.salesRec != null && f.salesRec > 90 ? 'inactive' : (f.lifetimeN <= 1 ? 'new' : 'active')));
      f.lastActivity = [s.last, lastTouch].filter(Boolean).sort().pop() || null;
      return f;
    });
    return input.includeAll ? out : out.filter(function (f) { return f.type !== 'supplier'; });
  }

  /* resolve a sale (name + GSTIN) to a party index: GSTIN → normalised name → first token */
  function norm(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(); }
  function buildResolver(parties) {
    var byGst = {}, byNorm = {}, byTok = {};
    parties.forEach(function (p, i) {
      if (p.gstin) byGst[String(p.gstin).toUpperCase()] = i;
      var nm = norm(p.name); if (nm) byNorm[nm] = i;
      var t = nm.split(' ')[0]; if (t && byTok[t] === undefined) byTok[t] = i;
    });
    return function (name, gstin) {
      if (gstin && byGst[String(gstin).toUpperCase()] !== undefined) return byGst[String(gstin).toUpperCase()];
      var nm = norm(name); if (nm && byNorm[nm] !== undefined) return byNorm[nm];
      var t = nm.split(' ')[0]; if (t && byTok[t] !== undefined) return byTok[t];
      return -1;
    };
  }

  /* ── TIMELINE: explicit events + the registers, merged, newest first ──── */
  function timeline(f, explicit, today) {
    var ev = (explicit || []).map(function (e) { return { id: e.id, at: localIso(e.at), kind: e.kind, title: e.title || TIMELINE_KINDS[e.kind] || e.kind, detail: e.detail || '', by: e.by || '', ref: e.ref || null, amount: e.amount || null, src: 'log' }; });
    (f.invoices || []).forEach(function (s) {
      ev.push({ at: s.date + 'T09:00:00', kind: 'invoice', title: 'Invoice #' + (s.inv || '—') + ' created', detail: (s.product || 'Quick Lime') + (s.qty ? ' · ' + fmtQty(s.qty, s.unit) : '') + (s.rate ? ' · ' + fmtRate(s.rate, s.rateUnit, s.unit) : ''), amount: s.total, ref: { type: 'sale', id: s.idx }, src: 'sales' });
      var pays = (s.payments && s.payments.length) ? s.payments : (s.paid > 0.5 ? [{ date: s.paidDate || s.date, amount: s.paid }] : []);
      pays.forEach(function (p) { ev.push({ at: (p.date || s.date) + 'T18:00:00', kind: 'payment', title: 'Payment received', detail: 'against #' + (s.inv || '—') + (p.mode ? ' · ' + p.mode : ''), amount: +p.amount || 0, ref: { type: 'sale', id: s.idx }, src: 'sales' }); });
      var terms = f.creditDays || 30;
      if (s.outstanding > 0.5 && today && daysBetween(s.date, today) > terms) {
        ev.push({ at: addDays(s.date, terms) + 'T23:59:00', kind: 'overdue', title: 'Payment overdue', detail: '#' + (s.inv || '—') + ' — ' + (daysBetween(s.date, today) - terms) + ' days past ' + terms + '-day terms', amount: s.outstanding, ref: { type: 'sale', id: s.idx }, src: 'sales' });
      }
    });
    ev.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    return ev;
  }
  function filterTimeline(events, opts) {
    opts = opts || {};
    var q = String(opts.q || '').toLowerCase();
    return events.filter(function (e) {
      if (opts.kind && opts.kind !== 'all' && e.kind !== opts.kind) return false;
      if (q && (String(e.title) + ' ' + String(e.detail) + ' ' + String(e.by)).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  /* ── PER-CUSTOMER INSIGHTS — sentences, each one traceable to a number ── */
  function customerInsights(f, today) {
    var out = [];
    if (!f) return out;
    var rh = f.rhythm || {};
    if (rh.gapDays && rh.orders >= 3) {
      if (rh.status === 'due') out.push({ tone: 'blue', t: f.name + ' normally orders every ' + rh.gapLo + '–' + rh.gapHi + ' days. The expected reorder window is approaching (last order ' + rh.sinceLast + ' days ago).', action: 'offer' });
      else if (rh.status === 'overdue') out.push({ tone: 'amber', t: 'Expected reorder passed — the usual gap is ~' + rh.gapDays + ' days and it has been ' + rh.sinceLast + '. Worth a call.', action: 'call' });
      else out.push({ tone: 'slate', t: 'Orders every ~' + rh.gapDays + ' days on average; the next is expected around ' + rh.next + '.' });
    } else if (f.salesN > 0 && f.salesRec != null && f.salesRec >= 30) {
      out.push({ tone: 'amber', t: 'No order for ' + f.salesRec + ' days.', action: 'call' });
    }
    var asks = (f.timelineKinds || {}).price_request || 0;
    if (asks >= 2) out.push({ tone: 'amber', t: 'Customer has asked for a lower price ' + asks + ' times in the last 60 days — price sensitive; lead with freight and payment terms, not rate.' });
    if (f.monthlyDemand > 0) out.push({ tone: 'green', t: 'Monthly potential is approximately ' + f.monthlyDemand + ' MT' + (f.monthlyPotential ? ' (≈ ₹' + Math.round(f.monthlyPotential).toLocaleString('en-IN') + ')' : '') + (f.demandSourceObserved ? ', from the order rhythm.' : ' from the recorded requirements.') });
    if (f.overdue > 0.5) out.push({ tone: 'rose', t: '₹' + Math.round(f.overdue).toLocaleString('en-IN') + ' is overdue beyond ' + (f.creditDays || 30) + '-day terms.', action: 'payment' });
    if (f.amt30 > 0 && f.amtPrev30 > 0 && f.amt30 < f.amtPrev30 * 0.6) out.push({ tone: 'amber', t: 'Orders are declining: ₹' + Math.round(f.amt30).toLocaleString('en-IN') + ' in the last 30 days vs ₹' + Math.round(f.amtPrev30).toLocaleString('en-IN') + ' in the 30 before.' });
    if (f.creditLimit > 0 && f.currentBalance > f.creditLimit) out.push({ tone: 'rose', t: 'Over the credit limit by ₹' + Math.round(f.currentBalance - f.creditLimit).toLocaleString('en-IN') + '.' });
    if (f.openQuotes > 0) out.push({ tone: 'blue', t: f.openQuotes + ' open quotation' + (f.openQuotes > 1 ? 's' : '') + ' worth ₹' + Math.round(f.openQuoteValue).toLocaleString('en-IN') + ' — follow up before validity lapses.', action: 'followup' });
    if (f.dueFollowups > 0) out.push({ tone: 'amber', t: f.dueFollowups + ' follow-up' + (f.dueFollowups > 1 ? 's' : '') + ' due.', action: 'followup' });
    if (f.recDays != null && f.recDays > 30 && f.salesN > 0) out.push({ tone: 'slate', t: 'No contact recorded for ' + f.recDays + ' days.' });
    // the recommended next move — the first actionable line wins
    var rec = out.filter(function (i) { return i.action; })[0];
    if (rec) {
      var wording = { offer: 'Recommended: send a fresh price offer for ' + (Object.keys(f.demand || {})[0] || 'Quick Lime') + '.', call: 'Recommended: call and ask about the next lift.', payment: 'Recommended: a payment follow-up before the next dispatch.', followup: 'Recommended: complete the pending follow-up today.' };
      out.push({ tone: 'green', t: wording[rec.action], rec: rec.action });
    }
    return out;
  }

  /* ── PORTFOLIO INSIGHTS for the dashboard ─────────────────────────────── */
  function portfolioInsights(rows, today) {
    var cust = rows.filter(function (r) { return r.salesN > 0; });
    var out = [];
    var byAmt = cust.slice().sort(function (a, b) { return b.salesAmt - a.salesAmt; });
    if (byAmt.length) out.push({ key: 'top', ic: '🏆', tone: 'blue', t: byAmt[0].name + ' is your top customer', d: '₹' + Math.round(byAmt[0].salesAmt).toLocaleString('en-IN') + ' · ' + Math.round(byAmt[0].share * 100) + '% of revenue · ' + byAmt[0].salesN + ' orders', ids: [byAmt[0].id] });
    var pot = rows.filter(function (r) { return r.monthlyPotential > 0; }).sort(function (a, b) { return b.monthlyPotential - a.monthlyPotential; });
    if (pot.length) out.push({ key: 'potential', ic: '🚀', tone: 'green', t: pot[0].name + ' has the highest monthly potential', d: pot[0].monthlyDemand + ' MT/month ≈ ₹' + Math.round(pot[0].monthlyPotential).toLocaleString('en-IN'), ids: [pot[0].id] });
    var reorder = cust.filter(function (r) { return r.rhythm && (r.rhythm.status === 'due' || r.rhythm.status === 'overdue') && r.rhythm.orders >= 3; });
    if (reorder.length) out.push({ key: 'reorder', ic: '🔁', tone: 'blue', t: reorder.length + ' customer' + (reorder.length > 1 ? 's are' : ' is') + ' likely to reorder now', d: reorder.slice(0, 3).map(function (r) { return r.name; }).join(', ') + (reorder.length > 3 ? ' +' + (reorder.length - 3) : ''), ids: reorder.map(function (r) { return r.id; }) });
    var decl = cust.filter(function (r) { return r.amt30 > 0 && r.amtPrev30 > 0 && r.amt30 < r.amtPrev30 * 0.6; });
    if (decl.length) out.push({ key: 'declining', ic: '📉', tone: 'amber', t: decl.length + ' customer' + (decl.length > 1 ? 's' : '') + ' ordering less than last month', d: decl.slice(0, 3).map(function (r) { return r.name; }).join(', '), ids: decl.map(function (r) { return r.id; }) });
    var over = cust.filter(function (r) { return r.overdue > 0.5; }).sort(function (a, b) { return b.overdue - a.overdue; });
    if (over.length) out.push({ key: 'overdue', ic: '⏰', tone: 'rose', t: over.length + ' customer' + (over.length > 1 ? 's' : '') + ' with overdue payments', d: '₹' + Math.round(over.reduce(function (a, r) { return a + r.overdue; }, 0)).toLocaleString('en-IN') + ' to collect · ' + over[0].name + ' owes the most', ids: over.map(function (r) { return r.id; }) });
    var fu = rows.filter(function (r) { return r.dueFollowups > 0; });
    if (fu.length) out.push({ key: 'followup', ic: '📞', tone: 'amber', t: fu.length + ' customer' + (fu.length > 1 ? 's' : '') + ' need a follow-up today', d: fu.slice(0, 3).map(function (r) { return r.name; }).join(', '), ids: fu.map(function (r) { return r.id; }) });
    var quiet = rows.filter(function (r) { return r.statusEff !== 'blocked' && r.statusEff !== 'inactive' && r.recDays != null && r.recDays > 30; });
    if (quiet.length) out.push({ key: 'quiet', ic: '🤫', tone: 'slate', t: quiet.length + " haven't been contacted in 30+ days", d: quiet.slice(0, 3).map(function (r) { return r.name; }).join(', '), ids: quiet.map(function (r) { return r.id; }) });
    var ps = rows.filter(function (r) { return (r.tags || []).indexOf('price_sensitive') >= 0 || ((r.timelineKinds || {}).price_request || 0) >= 2; });
    if (ps.length) out.push({ key: 'price', ic: '🏷️', tone: 'amber', t: ps.length + ' price-sensitive customer' + (ps.length > 1 ? 's' : ''), d: ps.slice(0, 3).map(function (r) { return r.name; }).join(', '), ids: ps.map(function (r) { return r.id; }) });
    var hd = rows.filter(function (r) { return r.monthlyDemand >= 50; }).sort(function (a, b) { return b.monthlyDemand - a.monthlyDemand; });
    if (hd.length) out.push({ key: 'demand', ic: '🏭', tone: 'green', t: hd.length + ' customer' + (hd.length > 1 ? 's' : '') + ' with 50+ MT monthly demand', d: hd.slice(0, 3).map(function (r) { return r.name + ' (' + r.monthlyDemand + ' MT)'; }).join(', '), ids: hd.map(function (r) { return r.id; }) });
    return out;
  }

  /* ── message templates — {{variable}} substitution, unknowns blank ──── */
  var DEFAULT_TEMPLATES = [
    { id: 'tpl_offer', name: 'Price offer', channel: 'whatsapp', body: 'Hello {{customer_name}},\n\nWe can offer {{product}} at ₹{{rate}}/{{rate_unit}} for {{quantity}} {{unit}}.\n\nDelivery Location: {{location}}\nFreight: {{freight}}\nGST: {{gst}}\nPayment Terms: {{payment_terms}}\nDelivery: {{delivery}}\nOffer valid until: {{validity}}\n\nRegards,\n{{company}}' },
    { id: 'tpl_quote', name: 'Quotation sent', channel: 'whatsapp', body: 'Dear {{customer_name}},\n\nPlease find our quotation {{quote_no}} for {{product}} — {{quantity}} {{unit}} at ₹{{rate}}/{{rate_unit}}.\nTotal: ₹{{total}} (incl. GST)\nValid until: {{validity}}\nPayment: {{payment_terms}}\n\n{{link}}\n\nRegards,\n{{company}}' },
    { id: 'tpl_followup', name: 'Follow-up', channel: 'whatsapp', body: 'Hello {{customer_name}},\n\nFollowing up on our {{product}} offer of ₹{{rate}}/{{rate_unit}}. Shall we schedule the dispatch?\n\nRegards,\n{{company}}' },
    { id: 'tpl_payment', name: 'Payment reminder', channel: 'whatsapp', body: 'Dear {{customer_name}},\n\nGentle reminder: ₹{{outstanding}} is outstanding on your account with {{company}}. Kindly arrange payment at your convenience.\n\nThank you.' },
    { id: 'tpl_reorder', name: 'Reorder check-in', channel: 'whatsapp', body: 'Hello {{customer_name}},\n\nYour last {{product}} lift was on {{last_order}}. Shall we plan the next dispatch? Current rate ₹{{rate}}/{{rate_unit}}.\n\nRegards,\n{{company}}' }
  ];
  function fillTemplate(body, vars) {
    vars = vars || {};
    return String(body || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, function (_, k) { var v = vars[k]; return v == null ? '' : String(v); });
  }
  function templateVars(ctx) {
    ctx = ctx || {};
    var c = ctx.customer || {}, o = ctx.offer || ctx.quote || {}, co = ctx.company || {};
    var q = ctx.quote ? quoteTotals(ctx.quote) : null;
    var first = (ctx.quote && ctx.quote.items && ctx.quote.items[0]) || {};
    var fmt = function (n) { return n == null || n === '' ? '' : Math.round(+n).toLocaleString('en-IN'); };
    return {
      customer_name: c.name || '', contact_person: c.contact || c.name || '', company: co.short || co.name || '',
      product: o.product || first.product || '', rate: fmt(o.rate != null ? o.rate : first.rate), quantity: o.qty != null ? o.qty : (first.qty || ''), unit: unitKey(o.unit || first.unit || LEGACY_UNIT),
      rate_unit: rateUnitOf(o.unit || first.unit, o.rateUnit || first.rateUnit),
      location: o.deliveryLoc || c.deliveryLoc || c.city || '', payment_terms: labelOf(PAYMENT_TERMS, o.payment || c.payTerms) || (o.payment || ''),
      validity: o.validUntil || '', delivery: o.delivery || '', freight: labelOf(FREIGHT, o.freight) || (o.freight || ''), gst: o.gstText || (o.gstR != null ? o.gstR + '%' : 'As applicable'),
      quote_no: o.no || '', total: q ? fmt(q.total) : '', outstanding: fmt(c.salesDue), last_order: c.salesLast || '', link: o.link || ''
    };
  }

  /* ── pipeline value ────────────────────────────────────────────────────── */
  /* A deal's expected value: the explicit figure when a person typed one,
     else the quantity priced at the target rate — through units-core, so a
     42,000 Kg deal at ₹4,900 / Ton is ₹2,05,800, not ₹20.58 Cr. Unpriceable
     (a per-Ton rate on Bags) is unknown, never a raw product. */
  function dealValue(d) {
    if (!d) return null;
    if (d.value != null && d.value !== '') return +d.value;
    var q = +d.qty || 0, r = +d.targetRate || 0;
    if (!(q > 0 && r > 0)) return null;
    var L = priceLine(q, d.unit, r, d.rateUnit);
    return L.ok ? L.amount : null;
  }
  function pipelineSummary(deals) {
    var open = (deals || []).filter(function (d) { return isOpenStage(d.stage); });
    var gross = 0, weighted = 0, unvalued = 0;
    open.forEach(function (d) { var v = dealValue(d); if (v == null) unvalued++; else { gross += v; weighted += v * (stage(d.stage) || { p: 0 }).p; } });
    return { open: open.length, gross: round(gross, 0), weighted: round(weighted, 0), unvalued: unvalued, won: (deals || []).filter(function (d) { return d.stage === 'completed'; }).length, lost: (deals || []).filter(function (d) { return d.stage === 'lost'; }).length };
  }

  /* ── follow-up buckets ─────────────────────────────────────────────────── */
  function followupBuckets(fus, today) {
    var open = (fus || []).filter(function (f) { return f.status !== 'done' && f.status !== 'skipped'; });
    var d = function (f) { return String(f.date || '').slice(0, 10); };
    return {
      overdue: open.filter(function (f) { return d(f) < today; }).sort(function (a, b) { return d(a).localeCompare(d(b)); }),
      today: open.filter(function (f) { return d(f) === today; }).sort(function (a, b) { return String(a.time || '').localeCompare(String(b.time || '')); }),
      upcoming: open.filter(function (f) { return d(f) > today; }).sort(function (a, b) { return d(a).localeCompare(d(b)); })
    };
  }

  return {
    CUSTOMER_TYPES: CUSTOMER_TYPES, CUSTOMER_STATUS: CUSTOMER_STATUS, PRODUCTS: PRODUCTS, UNITS: UNITS, REQ_FREQ: REQ_FREQ, FORMS: FORMS,
    PACKAGING: PACKAGING, FREIGHT: FREIGHT, PAYMENT_TERMS: PAYMENT_TERMS, TRANSPORT: TRANSPORT, QUOTE_STATUS: QUOTE_STATUS, OFFER_STATUS: OFFER_STATUS,
    STAGES: STAGES, FOLLOWUP_TYPES: FOLLOWUP_TYPES, SEGMENTS: SEGMENTS, TIMELINE_KINDS: TIMELINE_KINDS, DOC_KINDS: DOC_KINDS, DEFAULT_TEMPLATES: DEFAULT_TEMPLATES,
    labelOf: labelOf, stage: stage, stageLabel: stageLabel, isOpenStage: isOpenStage,
    iso: iso, localIso: localIso, parseD: parseD, daysBetween: daysBetween, addDays: addDays, median: median,
    nextCode: nextCode, quoteTotals: quoteTotals, effectiveQuoteStatus: effectiveQuoteStatus, isOpenQuote: isOpenQuote,
    monthlyOf: monthlyOf, rhythm: rhythm, demandByProduct: demandByProduct, priceHistory: priceHistory,
    healthScore: healthScore, autoSegment: autoSegment, enrich: enrich, buildResolver: buildResolver,
    timeline: timeline, filterTimeline: filterTimeline, customerInsights: customerInsights, portfolioInsights: portfolioInsights,
    fillTemplate: fillTemplate, templateVars: templateVars, dealValue: dealValue, pipelineSummary: pipelineSummary, followupBuckets: followupBuckets,
    /* units — one vocabulary, shared with the invoice (units-core) */
    unitKey: unitKey, rateUnitOf: rateUnitOf, newRateUnit: newRateUnit, priceLine: priceLine, tonnesOf: tonnesOf, saleTonnes: saleTonnes, ratePerTon: ratePerTon, fmtQty: fmtQty, fmtRate: fmtRate, LEGACY_UNIT: LEGACY_UNIT
  };
}));
