/* ═══════════════════════════════════════════════════════════════════════
   units-core.js — THE quantity / rate-unit arithmetic. Pure.

   Browser (window.QLUnits) + Node (module.exports). Every place a quantity
   meets a rate — the GST invoice form, saleTaxable() in data.js, the print
   designs, quotations and offers, the purchase register, imports and the
   server mirror in db.php (ql_line_amount) — goes through lineAmount() so
   the paper, the books, the e-way value, the reports and the dashboard can
   never disagree.

   THE RULE. A rate has a unit of its own (rateUnit). The amount is
       billableQty × rate, where billableQty = qty converted INTO the rate's unit.
   7,650 Kg @ ₹5,300 / Ton  →  7.65 Ton × 5,300 = ₹40,545. Never 7,650 × 5,300.
   When the record carries no rateUnit (every row written before this file
   existed), the rate is per the quantity's own unit — so legacy rows keep
   exactly the figure they were booked with.

   Units are FAMILIES. Mass: Kg · Quintal · Ton (Tonne, MT, T). Count: Nos ·
   Bag. Volume: Litre. A rate in one family cannot price a quantity in another
   (a rate per Ton cannot price 400 Bags without a bag weight) — lineAmount
   says so (ok:false, why) instead of multiplying raw numbers.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QLUnits = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* Canonical units. `toBase` = how many BASE units (Ton for mass, Litre for
     volume, 1 for count) one unit is. Aliases map what people type / what
     OCR reads onto the canonical key. Labels are what prints. */
  var UNITS = [
    { key: 'Ton',     label: 'Ton',     family: 'mass',   toBase: 1,     aliases: ['ton', 'tonne', 'tonnes', 'tons', 'mt', 'mts', 't', 'to', 'metric ton', 'metric tonne', 'm.t', 'm.t.', 'tn'] },
    { key: 'Kg',      label: 'Kg',      family: 'mass',   toBase: 0.001, aliases: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramme'] },
    { key: 'Quintal', label: 'Quintal', family: 'mass',   toBase: 0.1,   aliases: ['quintal', 'quintals', 'qtl', 'qntl', 'q'] },
    { key: 'Bag',     label: 'Bag',     family: 'count',  toBase: 1,     aliases: ['bag', 'bags', 'bora', 'boras', 'sack', 'sacks'] },
    { key: 'Nos',     label: 'Nos',     family: 'count',  toBase: 1,     aliases: ['nos', 'no', 'no.', 'nos.', 'pcs', 'pc', 'piece', 'pieces', 'unit', 'units', 'each', 'ea'] },
    { key: 'Litre',   label: 'Litre',   family: 'volume', toBase: 1,     aliases: ['litre', 'litres', 'liter', 'liters', 'ltr', 'ltrs', 'l', 'lt'] },
    { key: 'Other',   label: 'Other',   family: 'other',  toBase: 1,     aliases: ['other', 'misc'] }
  ];
  var byKey = {}, byAlias = {};
  UNITS.forEach(function (u) { byKey[u.key] = u; byAlias[u.key.toLowerCase()] = u; u.aliases.forEach(function (a) { byAlias[a] = u; }); });

  function unitOf(u) {
    var s = String(u == null ? '' : u).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return null;
    return byAlias[s] || byAlias[s.replace(/[.\s]/g, '')] || null;
  }
  /* Canonical key for anything a person typed; '' when unknown/blank. */
  function normalizeUnit(u) { var x = unitOf(u); return x ? x.key : ''; }
  function familyOf(u) { var x = unitOf(u); return x ? x.family : ''; }
  function sameFamily(a, b) { var x = unitOf(a), y = unitOf(b); return !!(x && y && x.family === y.family && x.family !== 'other'); }

  var round = function (n, p) { var m = Math.pow(10, p == null ? 6 : p); return Math.round((+n + Number.EPSILON) * m) / m; };

  /* qty in `from` expressed in `to`; null when the units are not convertible.
     Same unit (or same canonical unit) → the quantity unchanged. */
  function convertQty(qty, from, to) {
    var q = +qty; if (!isFinite(q)) return null;
    var f = unitOf(from), t = unitOf(to);
    if (!f || !t) return (String(from || '').trim().toLowerCase() === String(to || '').trim().toLowerCase()) ? q : null;
    if (f.key === t.key) return q;
    if (f.family !== t.family || f.family === 'other' || f.family === 'count') return null;   // a Bag is not a Nos; a Ton is not a Bag
    return round(q * f.toBase / t.toBase, 9);
  }

  /* The line. Input: { qty, unit, rate, rateUnit }. rateUnit '' / undefined
     means "per the quantity's own unit" (legacy rows). Output always carries
     an amount so nothing downstream sees NaN; `ok:false` + `why` when the
     units cannot price each other (amount is then the raw product, flagged —
     the form refuses to save it, the print shows it as entered). */
  function lineAmount(o) {
    o = o || {};
    var qty = +o.qty || 0, rate = +o.rate || 0;
    var unit = String(o.unit == null ? '' : o.unit).trim();
    var rateUnit = String(o.rateUnit == null ? '' : o.rateUnit).trim() || unit;
    var bq = convertQty(qty, unit, rateUnit);
    if (bq == null) {
      return { qty: qty, unit: unit, rate: rate, rateUnit: rateUnit, billableQty: qty, billableUnit: unit, amount: round(qty * rate, 2), ok: false,
               why: 'A rate per ' + (normalizeUnit(rateUnit) || rateUnit || 'unit') + ' cannot price a quantity in ' + (normalizeUnit(unit) || unit || 'unknown units') + ' — pick a rate unit in the same family, or enter the quantity in ' + (normalizeUnit(rateUnit) || rateUnit) + '.' };
    }
    return { qty: qty, unit: unit, rate: rate, rateUnit: rateUnit, billableQty: bq, billableUnit: normalizeUnit(rateUnit) || rateUnit, amount: round(bq * rate, 2), ok: true, why: '' };
  }

  /* Inverse: the rate per `rateUnit` implied by a booked amount — for imports
     and OCR, where the bill shows taxable + quantity but the rate is derived.
     null when it cannot be derived (zero quantity, incompatible units). */
  function impliedRate(amount, qty, unit, rateUnit) {
    var bq = convertQty(qty, unit, rateUnit || unit);
    if (bq == null || !bq) return null;
    return round((+amount || 0) / bq, 2);
  }

  /* Tonnes for reporting: a mass quantity in Ton, else null (a Bag count is
     not a tonnage — the report must not add it to tonnes). */
  function toTonnes(qty, unit) { var f = unitOf(unit); if (!f) return null; if (f.family !== 'mass') return null; return convertQty(qty, unit, 'Ton'); }

  /* The default rate unit for a quantity unit in THIS business: lime is
     priced per Ton whatever the truck was weighed in; bags and pieces are
     priced per bag / piece. */
  function defaultRateUnit(unit) { var f = unitOf(unit); if (!f) return unit || ''; return f.family === 'mass' ? 'Ton' : f.key; }

  /* GST on a taxable amount — the only other arithmetic on a line. */
  function taxOn(taxable, gstR, interState) {
    var tx = round(+taxable || 0, 2), r = +gstR || 0, g = round(tx * r / 100, 2);
    return interState ? { taxable: tx, cgst: 0, sgst: 0, igst: g, gst: g, total: round(tx + g, 2) } : { taxable: tx, cgst: round(g / 2, 2), sgst: round(g / 2, 2), igst: 0, gst: g, total: round(tx + g, 2) };
  }

  /* "7,650 Kg" / "7.65 Ton" for the paper. */
  function fmtQty(qty, unit) { var q = +qty || 0; var s = Number.isInteger(q) ? q.toLocaleString('en-IN') : q.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 3 }); var u = normalizeUnit(unit) || unit || ''; return u ? s + ' ' + u : s; }
  function fmtRate(rate, rateUnit) { var r = +rate || 0; return '₹' + r.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (rateUnit ? ' / ' + (normalizeUnit(rateUnit) || rateUnit) : ''); }

  return { UNITS: UNITS, unitOf: unitOf, normalizeUnit: normalizeUnit, familyOf: familyOf, sameFamily: sameFamily, convertQty: convertQty, lineAmount: lineAmount, impliedRate: impliedRate, toTonnes: toTonnes, defaultRateUnit: defaultRateUnit, taxOn: taxOn, fmtQty: fmtQty, fmtRate: fmtRate, round: round };
}));
