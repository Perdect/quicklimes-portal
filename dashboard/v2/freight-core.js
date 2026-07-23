/* ═══════════════════════════════════════════════════════════════════════════
   FREIGHT CORE — the pure, testable freight & delivered-price engine.
   No DOM, no network. Every rupee the Freight Calculator shows is computed here,
   so it can be mutation-tested in isolation (freight-core.test.js).

   The math is deliberately explicit: freight on a low-value commodity like lime
   decides the deal, so a wrong ₹/MT is a lost or loss-making order. Distance is
   supplied by the caller (Google exact when a key is set, else the free road-km
   estimate from lime-market) — this file never guesses distance.
   ─────────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  /* Products we sell. exworks = default ex-plant ₹/MT (editable per quote; the
     real number comes from the company's own price list over time). gst = the
     GST rate that applies to this product as a composite supply (lime & limestone
     sit at 5% — HSN 2521/2522; editable). */
  var PRODUCTS = [
    { key: 'quick',     label: 'Quick Lime (CaO)',       hsn: '2522', exworks: 8000, gst: 0.05 },
    { key: 'hydrated',  label: 'Hydrated Lime (Ca(OH)₂)', hsn: '2522', exworks: 9000, gst: 0.05 },
    { key: 'limestone', label: 'Limestone',              hsn: '2521', exworks: 3500, gst: 0.05 }
  ];

  /* Packaging adds a per-MT cost (bags cost money + handling). Editable. */
  var PACKAGING = [
    { key: 'loose', label: 'Loose (bulk tipper)', addPerMt: 0 },
    { key: 'jumbo', label: 'Jumbo Bag (1 MT)',    addPerMt: 350 },
    { key: 'small', label: 'Small Bags (25–50 kg)', addPerMt: 700 }
  ];

  /* Trucks/trailers by payload (MT). Recommendation picks the fewest trips with
     the least wasted capacity. */
  var VEHICLES = [
    { key: 't21',  label: '21 MT Truck',   cap: 21 },
    { key: 't25',  label: '25 MT Truck',   cap: 25 },
    { key: 'tr28', label: '28 MT Trailer', cap: 28 },
    { key: 'tr35', label: '35 MT Trailer', cap: 35 }
  ];

  var FREIGHT_METHODS = [
    { key: 'per_ton_km', label: 'Per Ton-KM (₹/MT/km)' },
    { key: 'per_ton',    label: 'Per Ton (₹/MT)' },
    { key: 'per_km',     label: 'Per KM (₹/km, per vehicle)' },
    { key: 'per_truck',  label: 'Per Truck (₹/vehicle)' },
    { key: 'fixed',      label: 'Fixed destination price (₹, whole load)' },
    { key: 'manual',     label: 'Manual / transporter quotation' }
  ];

  function round(n) { return Math.round((+n || 0)); }
  function clampQty(q) { q = +q || 0; return q > 0 ? q : 0; }

  /* Fewest trips, least waste. For qty ≤ a single vehicle, choose the SMALLEST
     vehicle that still fits (cheapest to hire). For bigger loads, choose the
     largest vehicle (fewest trips) and report the trip count. */
  function recommendVehicle(qtyMt) {
    qtyMt = clampQty(qtyMt);
    var sorted = VEHICLES.slice().sort(function (a, b) { return a.cap - b.cap; });
    if (qtyMt <= 0) return { vehicle: sorted[0], trips: 0, fill: 0 };
    var single = sorted.find(function (v) { return v.cap >= qtyMt; });
    if (single) return { vehicle: single, trips: 1, fill: qtyMt / single.cap };
    var largest = sorted[sorted.length - 1];
    var trips = Math.ceil(qtyMt / largest.cap);
    return { vehicle: largest, trips: trips, fill: qtyMt / (largest.cap * trips) };
  }

  function tripsFor(qtyMt, cap) {
    qtyMt = clampQty(qtyMt); cap = +cap || 0;
    if (qtyMt <= 0 || cap <= 0) return 0;
    return Math.ceil(qtyMt / cap);
  }

  /* Loaded commodity trucks average ~400 km/usable-day; +1 day for loading/
     documentation/unloading. Always an estimate, always overridable. */
  function transitDays(km) {
    km = +km || 0;
    if (km <= 0) return 0;
    return Math.max(1, Math.ceil(km / 400) + 1);
  }

  /* THE freight number. Returns { totalFreight, freightPerMt, trucks, perTruck }.
     - qtyMt: order size (MT)
     - km: road distance (caller-supplied; Google or estimate)
     - cap: chosen vehicle payload (MT) — matters only for per-vehicle methods
     - value: the rate/price the user typed for the chosen method
     Every branch is total-first, then perMt = total / qty, so the delivered
     price is always internally consistent regardless of method. */
  function freight(method, params) {
    params = params || {};
    var qty = clampQty(params.qtyMt);
    var km = +params.km || 0;
    var cap = +params.cap || 0;
    var v = +params.value || 0;
    var trucks = tripsFor(qty, cap);
    var total = 0, perTruck = 0;
    switch (method) {
      case 'per_ton_km': total = v * km * qty; break;          // ₹/MT/km
      case 'per_ton':    total = v * qty; break;               // ₹/MT
      case 'per_km':     perTruck = v * km; total = perTruck * (trucks || 1); break;  // ₹/km per vehicle
      case 'per_truck':  perTruck = v; total = perTruck * (trucks || 1); break;       // ₹/vehicle
      case 'fixed':      total = v; break;                     // one price, whole load
      case 'manual':     // v is either total or per-MT depending on manualPerMt flag
        if (params.manualPerMt) total = v * qty; else total = v;
        break;
      default: total = 0;
    }
    total = round(total);
    return {
      method: method,
      totalFreight: total,
      freightPerMt: qty > 0 ? round(total / qty) : 0,
      trucks: trucks,
      perTruck: round(perTruck)
    };
  }

  var CHARGE_KEYS = ['loading', 'unloading', 'toll', 'borderTax', 'diesel', 'labour',
    'waiting', 'night', 'permit', 'insurance', 'fuelSurcharge', 'misc'];

  /* Additional charges are entered as ABSOLUTE ₹ for the whole shipment. */
  function additionalTotal(charges) {
    charges = charges || {};
    var t = 0;
    CHARGE_KEYS.forEach(function (k) { t += +charges[k] || 0; });
    // allow arbitrary extra rows too
    if (Array.isArray(charges.extra)) charges.extra.forEach(function (r) { t += +(r && r.amount) || 0; });
    return round(t);
  }

  /* THE delivered price. All per-MT so it drops straight into a quotation.
     delivered = material(ex-works + packaging) + freight + additional, then GST
     on that pre-tax subtotal (composite supply taxed at the goods' rate). */
  function delivered(inp) {
    inp = inp || {};
    var qty = clampQty(inp.qtyMt) || 1;             // avoid /0; a 0-MT quote is per-MT anyway
    var exworks = +inp.exworksPerMt || 0;
    var pack = +inp.packagingAddPerMt || 0;
    var freightPerMt = +inp.freightPerMt || 0;
    var addTotal = +inp.additionalTotal || 0;
    var addPerMt = qty > 0 ? addTotal / qty : 0;
    var gstRate = inp.gstRate != null ? +inp.gstRate : 0.05;

    var materialPerMt = exworks + pack;
    var preTaxPerMt = materialPerMt + freightPerMt + addPerMt;
    var gstPerMt = preTaxPerMt * gstRate;
    var deliveredPerMt = preTaxPerMt + gstPerMt;

    return {
      qtyMt: clampQty(inp.qtyMt),
      materialPerMt: round(materialPerMt),
      freightPerMt: round(freightPerMt),
      additionalPerMt: round(addPerMt),
      preTaxPerMt: round(preTaxPerMt),
      gstRate: gstRate,
      gstPerMt: round(gstPerMt),
      deliveredPerMt: round(deliveredPerMt),
      // order totals (0 if qty not given)
      materialTotal: round(materialPerMt * clampQty(inp.qtyMt)),
      freightTotal: round(freightPerMt * clampQty(inp.qtyMt)),
      additionalTotal: round(addTotal),
      gstTotal: round(gstPerMt * clampQty(inp.qtyMt)),
      grandTotal: round(deliveredPerMt * clampQty(inp.qtyMt))
    };
  }

  /* Freight as a share of ex-works price → the same margin verdict the Market
     panel uses (reuses lime-market's profitTier when present). */
  function marginVerdict(freightPerMt, exworksPerMt) {
    var share = exworksPerMt > 0 ? freightPerMt / exworksPerMt : null;
    var LM = root.LimeMarket;
    if (share != null && LM && LM.profitTier) {
      var t = LM.profitTier(share);
      return { sharePct: Math.round(share * 100), key: t.key, label: t.label };
    }
    return { sharePct: share != null ? Math.round(share * 100) : null, key: 'unknown', label: '—' };
  }

  /* Compare plants for a destination. Each plant: { name, lat, lon, stock?,
     capacityPerDay?, queueDays? }. distanceFn(plant, dest) → km (caller decides
     Google vs estimate). Returns plants ranked by delivered cost, with the AI
     pick + the reason + savings vs the next option. */
  function bestPlant(plants, dest, opts) {
    opts = opts || {};
    var method = opts.method || 'per_ton_km';
    var rate = opts.rate != null ? opts.rate : 4;
    var qty = clampQty(opts.qtyMt) || 1;
    var exworks = +opts.exworksPerMt || 0;
    var cap = +opts.cap || 25;
    var distanceFn = opts.distanceFn || function () { return 0; };
    var rows = (plants || []).map(function (p) {
      var km = Math.round(distanceFn(p, dest) || 0);
      var f = freight(method, { qtyMt: qty, km: km, cap: cap, value: rate });
      var days = (p.queueDays || 0) + transitDays(km);
      var deliveredPerMt = (+p.exworksPerMt || exworks) + f.freightPerMt;
      return {
        plant: p, km: km, freightPerMt: f.freightPerMt, totalFreight: f.totalFreight,
        transitDays: days, deliveredPerMt: round(deliveredPerMt),
        stock: p.stock != null ? +p.stock : null
      };
    });
    rows.sort(function (a, b) { return a.deliveredPerMt - b.deliveredPerMt; });
    var best = rows[0] || null, second = rows[1] || null;
    var reasons = [];
    if (best) {
      reasons.push('Lowest delivered cost');
      if (second && best.transitDays < second.transitDays) reasons.push((second.transitDays - best.transitDays) + ' day(s) faster');
      if (best.stock != null && (!second || best.stock >= (second.stock || 0))) reasons.push('Stock available');
    }
    return {
      rows: rows,
      best: best,
      savingsPerMt: (best && second) ? Math.max(0, round(second.deliveredPerMt - best.deliveredPerMt)) : 0,
      savingsTotal: (best && second) ? Math.max(0, round((second.deliveredPerMt - best.deliveredPerMt) * qty)) : 0,
      daysFaster: (best && second) ? Math.max(0, second.transitDays - best.transitDays) : 0,
      reasons: reasons
    };
  }

  root.FreightCore = {
    PRODUCTS: PRODUCTS, PACKAGING: PACKAGING, VEHICLES: VEHICLES,
    FREIGHT_METHODS: FREIGHT_METHODS, CHARGE_KEYS: CHARGE_KEYS,
    recommendVehicle: recommendVehicle, tripsFor: tripsFor, transitDays: transitDays,
    freight: freight, additionalTotal: additionalTotal, delivered: delivered,
    marginVerdict: marginVerdict, bestPlant: bestPlant
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FreightCore;
})(typeof window !== 'undefined' ? window : globalThis);
