/* ═══════════════════════════════════════════════════════════════════════
   BillOCR — pure, dependency-free purchase-bill parser.
   No DOM, no globals: runs in the browser (window.BillOCR) AND Node
   (module.exports), so every rule is unit-tested against real-invoice text.

   parse(text, opts) → {
     fields:     { billNo, date, supplier, supplierGstin, buyerGstin, group,
                   item, hsn, qty, rate, taxable, cgst, sgst, igst, gstRate,
                   totalGst, total, roundOff, itc, vehicle },
     confidence: { <field>: 0..1 },        // per-field certainty
     review:     [ <field> … ],            // low-confidence / unresolved → BLANK + "Needs review"
     warnings:   [ <string> … ],           // validation problems
     raw:        text
   }

   Hard rules (the reported bug):
     • A LABEL is never used as a VALUE. "GST Registration No" can never
       become the supplier name.
     • Purchase bill → we want the SELLER (supplier), told apart from the
       BUYER (our own firm) by name + GSTIN.
     • If a field isn't clearly readable → it's left BLANK and flagged for
       review. Never fabricate.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BillOCR = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── text utils ──────────────────────────────────────────────────────── */
  function norm(s) { return (s == null ? '' : String(s)).toUpperCase().replace(/\s+/g, ' ').trim(); }
  function clean(s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); }
  function nMoney(s) { s = String(s == null ? '' : s).replace(/[^0-9.,]/g, ''); if (!s) return null; var last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(',')); if (last >= 0 && s.length - last <= 3 && (s.match(/[.,]/g) || []).length) { s = s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1); } else { s = s.replace(/[.,]/g, ''); } var n = parseFloat(s); return isFinite(n) ? n : null; }
  function money(s) { return (String(s).match(/\d[\d,]*\.?\d{0,2}/g) || []).map(function (x) { return parseFloat(x.replace(/,/g, '')); }).filter(function (n) { return isFinite(n); }); }
  function round2(n) { return Math.round(n * 100) / 100; }

  /* ── label detector: the anti-"GST Registration No" guard ────────────────
     A value candidate is rejected if it IS a label (or begins with one). */
  var LABEL_RE = new RegExp('^(?:' + [
    'gst\\s*(?:registration|reg)?\\s*(?:no|number|in)?', 'gstin', 'g\\s*s\\s*t\\s*i\\s*n',
    'pan(?:\\s*no)?', 'tax\\s*invoice', 'invoice(?:\\s*(?:no|number|date|value|cum)?)?', 'bill(?:\\s*(?:no|number|of\\s*supply|to|date))?',
    'billed\\s*to', 'bill\\s*to', 'ship(?:ped)?\\s*to', 'sold\\s*(?:to|by)', 'buyer', 'seller', 'supplier', 'vendor',
    'consignee', 'consignor', 'party(?:\\s*name)?', 'name(?:\\s*of\\s*\\w+)?', 'm/s',
    'hsn(?:\\s*(?:code|/sac|sac))?', 'sac', 'description(?:\\s*of\\s*goods)?', 'particulars?', 'goods',
    'state(?:\\s*(?:code|name))?', 'place\\s*of\\s*supply', 'address', 'contact', 'mobile', 'phone', 'email', 'e-?mail',
    'date[d]?', 'due\\s*date', 'qty', 'quantity', 'unit', 'per', 'rate', 'mrp', 'disc(?:ount)?',
    'amount', 'taxable(?:\\s*(?:value|amount|amt))?', 'basic(?:\\s*(?:value|amount))?', 'sub\\s*-?\\s*total', 'total(?:\\s*(?:amount|value|gst|invoice|qty)?)?',
    'grand\\s*total', 'c\\s*gst', 'cgst', 's\\s*gst', 'sgst', 'i\\s*gst', 'igst', 'ugst', 'cess', 'gst\\s*%', 'tax(?:\\s*(?:amount|%|rate))?',
    'round(?:\\s*(?:off|ed))?', 'freight', 'transport(?:ation)?', 'vehicle(?:\\s*no)?', 'e-?way(?:\\s*bill)?', 'lr\\s*no', 'transporter',
    'terms', 'reverse\\s*charge', 'sr\\.?\\s*no', 's\\.?\\s*no', 'sl\\.?\\s*no', 'code', 'no\\.?', 'for\\b', 'from', 'to',
    'declaration', 'bank', 'a/c', 'account', 'ifsc', 'branch', 'signature', 'authorised', 'authorized', 'received', 'jurisdiction',
    'cin', 'phone\\s*no', 'website', 'www', 'http'
  ].join('|') + ')\\b', 'i');
  // value that is JUST a label (optionally trailed by ":" and nothing meaningful)
  function isLabel(s) {
    var n = clean(s).replace(/[:\-–].*$/, '').trim();     // text before a colon/dash
    if (!n) return true;
    if (LABEL_RE.test(n)) {
      // "M/s ACME TRADERS" is NOT a bare label — it has a real name after it.
      var rest = n.replace(LABEL_RE, '').replace(/^[\s:.\-]+/, '').trim();
      if (rest.length >= 3 && /[A-Za-z]{3}/.test(rest) && !LABEL_RE.test(rest)) return false;
      return true;
    }
    return false;
  }

  /* ── GSTIN ───────────────────────────────────────────────────────────── */
  var GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d])\b/g;
  function validGstin(g) { if (!g || !/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/.test(g)) return false; var st = +g.slice(0, 2); return st >= 1 && st <= 38; }

  /* ── purchase group / item from item text ────────────────────────────── */
  // Ordered MOST-specific first: a "royalty on limestone" or "freight for
  // limestone" bill must classify as royalty/transport, not the material.
  var GROUPS = [
    { group: 'royalty', item: 'Royalty', kw: /royalty|\bdmf\b|district\s*mineral|mineral\s*fund|\bnmet\b/i },
    { group: 'transport', item: 'Transport / Freight', kw: /transport|freight|lorry|truck\s*(?:hire|freight)|carriage|goods\s*transport|\bgta\b|cartage/i },
    { group: 'labour', item: 'Labour', kw: /labour|\blabor\b|wages|mazdoor|manpower|loading\s*(?:&|and)?\s*unloading|hamali/i },
    { group: 'fuel', item: 'Diesel', kw: /\bdiesel\b|\bhsd\b|\bpetrol\b|furnace\s*oil|\bfuel\s*oil\b|high\s*speed\s*diesel/i },
    { group: 'electricity', item: 'Electricity', kw: /electricity|power\s*bill|discom|jvvnl|avvnl|energy\s*charges|units?\s*consumed|kwh/i },
    { group: 'bank', item: 'Bank Charges', kw: /bank\s*charge|processing\s*fee|commission|neft\s*charge|folio|\brtgs\s*charge/i },
    { group: 'packaging', item: 'Plastic Bags', kw: /plastic\s*bag|hdpe|\bpp\s*bag|woven\s*sack|packing\s*(?:bag|material)|laminated\s*bag|bopp/i },
    { group: 'petcoke', item: 'Pet Coke', kw: /pet\s*coke|petcoke|petroleum\s*coke|\bcoke\b/i },
    { group: 'limestone', item: 'Limestone Purchase', kw: /lime\s*stone|limestone|l[\. ]?stone|\bkankar\b|agricultural\s*lime|liming\s*material|hydrated\s*lime|quick\s*lime/i }
  ];
  function detectGroup(text) { var T = String(text || ''); for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].kw.test(T)) return { group: GROUPS[i].group, item: GROUPS[i].item }; return { group: '', item: '' }; }

  /* ── date ────────────────────────────────────────────────────────────── */
  var MON = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
  var DATE_RE = new RegExp('(\\d{1,2})[\\/\\-. ](\\d{1,2}|' + MON + ')[a-z]*[\\/\\-. ](\\d{2,4})', 'i');
  function firstDate(s) { var re = new RegExp(DATE_RE.source, 'ig'), m; while ((m = re.exec(s))) { var v = validateDate(m[0]); if (v) return v; } return null; }
  function findDate(text) {
    // Prefer the value on a "Date/Dated" line — but scan the WHOLE line with the
    // date regex (never a fixed-width filler, which used to eat the day's first
    // digit: "Dated : 12/06/2025" → "2/06/2025").
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var mi = lines[i].search(/\bdate[d]?\b/i);
      if (mi >= 0 && !/due\s*date/i.test(lines[i])) { var v = firstDate(lines[i].slice(mi).replace(/^date[d]?/i, '')); if (v) return v; }
    }
    return firstDate(text);
  }
  function validateDate(s) {
    var m = String(s).match(DATE_RE); if (!m) return null;
    var day = +m[1], named = /[a-z]/i.test(m[2]), mo = named ? 1 : +m[2];
    if (day < 1 || day > 31) return null; if (!named && (mo < 1 || mo > 12)) return null;
    return clean(m[0]);
  }

  /* ── main ────────────────────────────────────────────────────────────── */
  function parse(text, opts) {
    opts = opts || {};
    var T = String(text || '').replace(/\r/g, '');
    var lines = T.split('\n').map(clean).filter(Boolean);
    var f = {}, conf = {}, review = [], warn = [];
    function set(k, v, c) { if (v === '' || v == null) return; f[k] = v; conf[k] = c; }
    var ownG = (opts.ownGstins || []).map(norm);
    var ownNames = (opts.ownNames || []).map(norm);
    var aliases = opts.aliases || {};      // learned corrections: normalized text → canonical value

    /* GSTINs — seller (party) vs buyer (own). */
    var gstins = norm(T).match(GSTIN_RE) || [];
    gstins = gstins.filter(function (g, i) { return gstins.indexOf(g) === i; });
    var buyerG = gstins.filter(function (g) { return ownG.indexOf(g) >= 0; })[0] || '';
    var sellerG = gstins.filter(function (g) { return ownG.indexOf(g) < 0 && validGstin(g); })[0] || '';
    if (sellerG) { set('supplierGstin', sellerG, validGstin(sellerG) ? 0.97 : 0.5); if (!validGstin(sellerG)) warn.push('Supplier GSTIN format looks off'); }
    if (buyerG) set('buyerGstin', buyerG, 0.9);

    /* Bill number — labelled, must contain a digit and not be a date/GSTIN. */
    var billNo = '', re = /(?:invoice|bill|inv|voucher|challan|document)[ \t]*(?:no\.?|number|#|id)?[ \t]*[:\-.#]?[ \t]*([A-Za-z0-9][A-Za-z0-9\/\-]{2,24})/ig, mm;
    while ((mm = re.exec(T))) { var cand = mm[1].replace(/[^A-Za-z0-9\/\-]/g, ''); var digits = (cand.match(/\d/g) || []).length; if (digits && (digits >= 2 || /[\/\-]/.test(cand)) && !/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/i.test(cand) && !/^\d{1,2}[\/\-]\d/.test(cand)) { billNo = cand; break; } }
    if (billNo) set('billNo', billNo, /no|number|#/i.test(T.slice(Math.max(0, T.toUpperCase().indexOf(billNo.toUpperCase()) - 24), T.toUpperCase().indexOf(billNo.toUpperCase()))) ? 0.9 : 0.7);

    /* Date */
    var dt = findDate(T); if (dt) set('date', dt, 0.85);

    /* ── SELLER (supplier) name — the crux. Never a label. ──────────────── */
    var supplier = pickSupplier(lines, sellerG, ownNames, aliases);
    if (supplier.name) set('supplier', supplier.name, supplier.conf);

    /* Buyer name (separate) */
    var buyer = pickBuyer(lines, ownNames);
    if (buyer.name) set('buyer', buyer.name, buyer.conf);

    /* ── amounts ────────────────────────────────────────────────────────── */
    var A = pickAmounts(T, lines);
    ['taxable', 'cgst', 'sgst', 'igst', 'total', 'roundOff'].forEach(function (k) { if (A[k] != null) set(k, A[k], A.conf[k]); });

    /* GST total + rate + ITC */
    var totalGst = null;
    if (A.cgst != null || A.sgst != null || A.igst != null) totalGst = round2((A.cgst || 0) + (A.sgst || 0) + (A.igst || 0));
    if (totalGst != null) set('totalGst', totalGst, 0.8);
    var rate = pickRate(T, A);
    if (rate != null) set('gstRate', rate, A.rateFromMath ? 0.85 : 0.7);

    /* reconcile: taxable + gst ≈ total */
    if (A.taxable != null && totalGst != null && A.total != null) {
      var expect = round2(A.taxable + totalGst + (A.roundOff || 0));
      if (Math.abs(expect - A.total) <= 2) { conf.total = Math.max(conf.total || 0, 0.95); conf.taxable = Math.max(conf.taxable || 0, 0.95); }
      else warn.push('Amounts don\'t reconcile: taxable + GST (' + expect + ') ≠ total (' + A.total + ')');
    }
    /* fill a missing leg ONLY when we can compute it exactly (never guess a rate) */
    if (f.taxable == null && A.total != null && rate != null) { var tx = round2(A.total / (1 + rate / 100)); set('taxable', tx, 0.55); }
    if (f.total == null && A.taxable != null && totalGst != null) { set('total', round2(A.taxable + totalGst + (A.roundOff || 0)), 0.6); }

    /* HSN, qty, rate/unit, vehicle */
    var hsn = (T.match(/\bHSN(?:\s*\/?\s*SAC)?\s*(?:code|no)?\s*[:\-]?\s*(\d{4,8})\b/i) || [])[1] || (T.match(/\b(2521|2522|2523|2701|2713|3923|6305|4819)\d{0,4}\b/) || [])[0];
    if (hsn) set('hsn', hsn, 0.75);
    var qm = T.match(/([\d,]+\.?\d*)\s*(?:m\.?t\.?|tonne?s?|\bton\b|kgs?|nos|bags?|ltr|litre|units?)\b/i);
    if (qm) set('qty', nMoney(qm[1]), 0.6);
    var vm = norm(T).match(/\b([A-Z]{2}[\s\-]?\d{1,2}[\s\-]?[A-Z]{1,3}[\s\-]?\d{3,4})\b/);
    if (vm) set('vehicle', vm[1].replace(/[\s\-]/g, ''), 0.6);

    /* Purchase group / item — from the DESCRIPTION lines only. Strip metadata
       lines first ("Transporter: …", "Vehicle No: …") so a transporter's name
       can't hijack the material classification. */
    var giText = lines.filter(function (l) {
      return !/^(?:transporter|vehicle|transport\s*mode|lorry|lr\s*no|e-?way|place\s*of\s*supply|reverse\s*charge|state\s*code|pan\b|cin\b|mobile|phone|email|gstin|billed\s*to|bill\s*to|ship\s*to|consignee)\b/i.test(l);
    }).join('\n');
    var gi = detectGroup(giText);
    if (gi.group) { set('group', gi.group, 0.75); set('item', gi.item, 0.7); }

    /* ITC — RCM only when reverse charge is AFFIRMATIVELY yes (bills mandatorily
       print "Reverse Charge : No", which must NOT flip a normal bill to RCM). */
    var rcmNo = /reverse\s*charge[^\n]*[:\-]?\s*(?:no|not\s*applicable|nil|n)\b/i.test(T);
    var rcmYes = /reverse\s*charge[^\n]*[:\-]?\s*(?:yes|applicable)\b/i.test(T) || /payable\s*(?:by\s*recipient\s*)?under\s*(?:rcm|reverse\s*charge)/i.test(T) || /\bunder\s*rcm\b/i.test(T) || /rcm\s*applicable/i.test(T);
    if (rcmYes && !rcmNo) set('itc', 'RCM', 0.7);
    else if (/itc\s*(?:not\s*(?:eligible|available)|inelig|blocked)|input\s*tax\s*credit\s*(?:not\s*available|blocked)|ineligible|exempt(?:ed)?\s*supply|nil\s*rated/i.test(T)) set('itc', 'Ineligible', 0.7);
    else if (totalGst != null && totalGst > 0) set('itc', 'Eligible', 0.65);

    /* ── needs-review: any field we couldn't pin down confidently ───────── */
    var CORE = ['supplier', 'date', 'taxable', 'total', 'gstRate'];
    CORE.forEach(function (k) { if (f[k] == null || (conf[k] || 0) < 0.5) if (review.indexOf(k) < 0) review.push(k); });
    Object.keys(conf).forEach(function (k) { if ((conf[k] || 0) < 0.5 && review.indexOf(k) < 0) review.push(k); });
    /* validation */
    if (f.supplierGstin && !validGstin(f.supplierGstin) && warn.indexOf('Supplier GSTIN format looks off') < 0) warn.push('Supplier GSTIN invalid');

    return { fields: f, confidence: conf, review: review, warnings: warn, raw: T };
  }

  /* ── supplier picker ─────────────────────────────────────────────────── */
  var CO_SUFFIX = /\b(ltd|limited|pvt|private|llp|traders?|trading|mines?|minerals?|industries|enterprises?|cement|company|corporation|corp|sons|agencies|associates|udyog|stores?|suppliers?|transport|roadlines|petro|petroleum|\boil\b|chemicals?|distributors?|marketing|steel|works)\b/i;
  var ADDR_RE = /road|street|nagar|\bdist\b|district|\bpin\b|tehsil|ward|khasra|khasara|colony|\bmarg\b|sector|village|\bgidc\b|industrial|\barea\b|plot|\bnear\b|\bopp\b|behind|\bstate\b|rajasthan|gujarat|maharashtra|\bindia\b|\d{6}/i;
  function isCompanyish(s) { return CO_SUFFIX.test(s) || (/^[A-Z0-9 &.'()\-]{4,}$/.test(clean(s)) && clean(s).split(' ').length >= 2); }
  function goodName(s, ownNames) {
    var c = clean(s).replace(/[.,;:]+$/, '');
    if (c.length < 3 || c.length > 72) return '';               // long Indian firm names are valid
    if (isLabel(c)) return '';                                   // <-- the fix: never a label
    if (!/[A-Za-z]{3}/.test(c)) return '';
    if (/^\d/.test(c) || /\d{6}/.test(c)) return '';             // starts with a number / has a pin
    if (ADDR_RE.test(c)) return '';                              // address line, not a name
    if (/\b(?:from|to)\s*:/i.test(c) || /\bconsign(?:or|ee)\b/i.test(c) || /\broute\b/i.test(c)) return '';   // transport route line
    if (/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/i.test(norm(c).replace(/\s/g, ''))) return '';
    var n = norm(c); for (var i = 0; i < (ownNames || []).length; i++) { if (ownNames[i] && (n.indexOf(ownNames[i]) >= 0 || ownNames[i].indexOf(n) >= 0)) return ''; }
    return c;
  }
  function pickSupplier(lines, sellerG, ownNames, aliases) {
    // 0) learned alias: if any header line was previously corrected → use it
    for (var a = 0; a < lines.length; a++) { var key = norm(lines[a]); if (aliases[key]) return { name: aliases[key], conf: 1 }; }
    // 1) explicit seller block ("Seller / Supplier / Sold By / From : NAME")
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^(?:seller|supplier|sold\s*by|vendor|from|billed\s*by)\s*[:\-]?\s*(.*)$/i);
      if (m) { var v = goodName(m[1], ownNames); if (v) return { name: v, conf: 0.9 }; var nx = lines[i + 1] && goodName(lines[i + 1], ownNames); if (nx) return { name: nx, conf: 0.85 }; }
    }
    // 2) "M/s NAME" anywhere (strong seller signal on Indian bills)
    for (var j = 0; j < lines.length; j++) { var ms = lines[j].match(/\bm\/?s\.?\s+(.+)$/i); if (ms) { var v2 = goodName(ms[1], ownNames); if (v2) return { name: v2, conf: 0.88 }; } }
    // 3) header company name — first company-like line at the top, before "Invoice".
    for (var h = 0; h < Math.min(lines.length, 6); h++) {
      if (/tax\s*invoice|bill\s*of\s*supply|estimate|quotation|proforma/i.test(lines[h])) break;
      var v3 = goodName(lines[h], ownNames);
      if (v3 && isCompanyish(lines[h])) return { name: v3, conf: CO_SUFFIX.test(lines[h]) ? 0.75 : 0.55 };
    }
    // 4) near the seller GSTIN — name sits in the seller block; prefer a company-
    //    suffix line, skip labels ("GST Registration No") and addresses.
    if (sellerG) {
      var gi = lines.findIndex(function (l) { return norm(l).indexOf(sellerG) >= 0; });
      if (gi >= 0) {
        var best = '';
        for (var k = Math.max(0, gi - 5); k <= gi; k++) {
          var line = lines[k].replace(new RegExp(sellerG, 'i'), '').replace(/gst.*$/i, '').trim();
          var v4 = goodName(line, ownNames); if (!v4) continue;
          if (CO_SUFFIX.test(v4)) return { name: v4, conf: 0.72 };
          if (!best) best = v4;
        }
        if (best) return { name: best, conf: 0.5 };
      }
    }
    return { name: '', conf: 0 };
  }
  function pickBuyer(lines, ownNames) {
    var bi = lines.findIndex(function (l) { return /^(?:billed\s*to|bill\s*to|buyer|consignee|ship\s*to|sold\s*to)\b/i.test(l); });
    if (bi >= 0) {
      var head = lines[bi].replace(/^(?:billed\s*to|bill\s*to|buyer|consignee|ship\s*to|sold\s*to)\b\s*[:\-]?\s*/i, '');
      var v = goodNameAny(head); if (v) return { name: v, conf: 0.8 };
      for (var k = bi + 1; k <= bi + 2 && k < lines.length; k++) { var v2 = goodNameAny(lines[k]); if (v2) return { name: v2, conf: 0.75 }; }
    }
    return { name: '', conf: 0 };
  }
  // buyer can BE our own firm, so don't exclude own names here
  function goodNameAny(s) { var c = clean(s).replace(/[.,;:]+$/, ''); if (c.length < 3 || c.length > 48 || isLabel(c) || !/[A-Za-z]{3}/.test(c) || /^\d/.test(c) || /\d{6}/.test(c)) return ''; if (/road|street|nagar|\bpin\b|tehsil/i.test(c)) return ''; return c; }

  /* ── amount picker ───────────────────────────────────────────────────── */
  function labelled(text, re) { var m = text.match(re); return m ? nMoney(m[1]) : null; }
  // Amounts on a line, with inline percentage rates ("2.5%", "18 %") removed —
  // so "CGST @2.5% 21179.25" yields the amount 21179.25, never the rate 2.5.
  function amountsOnLine(line) { return money(String(line).replace(/\d[\d.,]*\s*%/g, ' ')); }
  function pickAmounts(T, lines) {
    var out = { conf: {} };
    function amtOf(re) { for (var i = 0; i < lines.length; i++) { if (re.test(lines[i])) { var a = amountsOnLine(lines[i]); if (a.length) return Math.max.apply(null, a); } } return null; }
    out.taxable = amtOf(/taxable\s*(?:value|amount|amt)|total\s*taxable|basic\s*(?:value|amount)|amount\s*before\s*tax/i);
    if (out.taxable != null) out.conf.taxable = 0.85;
    out.cgst = amtOf(/\bc\s*gst\b/i); if (out.cgst != null) out.conf.cgst = 0.8;
    out.sgst = amtOf(/\bs\s*gst\b/i); if (out.sgst != null) out.conf.sgst = 0.8;
    out.igst = amtOf(/\bi\s*gst\b/i); if (out.igst != null) out.conf.igst = 0.8;
    out.roundOff = labelled(T, /round(?:ed)?\s*off[^0-9\-]{0,10}(-?[0-9][0-9,]*\.?[0-9]{0,2})/i);
    // Grand total — a "total / invoice value / amount payable" line, but NOT a
    // sub-total, taxable-total or amount-in-words line.
    var tl = lines.filter(function (l) {
      return /grand\s*total|invoice\s*value|amount\s*payable|net\s*(?:amount|payable)|bill\s*(?:amount|total)|(?:^|\s)total(?:\s|:|$)/i.test(l)
        && !/sub\s*-?\s*total|taxable|before\s*tax|in\s*words|qty|quantity/i.test(l);
    });
    var tv = []; tl.forEach(function (l) { amountsOnLine(l).forEach(function (n) { tv.push(n); }); });
    if (tv.length) { out.total = Math.max.apply(null, tv); out.conf.total = 0.8; }
    return out;
  }
  function pickRate(T, A) {
    // rate from tax math (most reliable)
    if (A.taxable && (A.cgst != null || A.igst != null)) {
      var gst = (A.cgst || 0) + (A.sgst || 0) + (A.igst || 0);
      var r = gst / A.taxable * 100;
      var snap = [0, 3, 5, 12, 18, 28].filter(function (x) { return Math.abs(x - r) <= 0.7; })[0];
      if (snap != null) { A.rateFromMath = true; return snap; }
    }
    var m = norm(T).match(/\b(0|3|5|12|18|28)\s?%/); if (m) return +m[1];
    m = T.match(/[ci]?gst\s*@?\s*(\d{1,2})(?:\.0+)?\s*%/i); if (m) return +m[1];
    return null;
  }

  /* ── legacy adapter: feed the existing ocrMap (docno/name/taxable/…) ────
     Also re-keys confidence + review onto the GENERIC keys the import form
     uses, so the UI can badge each field. */
  var GEN = { billNo: 'docno', date: 'date', supplier: 'name', supplierGstin: 'gstin', taxable: 'taxable', total: 'total', gstRate: 'rate', group: 'group', item: 'item' };
  function legacy(res) {
    var f = res.fields, rev = res.review || [];
    function ok(k, v) { return rev.indexOf(k) >= 0 ? '' : (v == null ? '' : v); }   // blank if needs-review
    var gconf = {}, grev = [];
    Object.keys(res.confidence || {}).forEach(function (k) { gconf[GEN[k] || k] = res.confidence[k]; });
    rev.forEach(function (k) { grev.push(GEN[k] || k); });
    return {
      _text: res.raw, _conf: gconf, _review: grev, _warn: res.warnings, _fields: f,
      docno: ok('billNo', f.billNo), date: ok('date', f.date),
      name: ok('supplier', f.supplier), gstin: ok('supplierGstin', f.supplierGstin), buyergstin: f.buyerGstin || '',
      taxable: ok('taxable', f.taxable), total: ok('total', f.total), rate: ok('gstRate', f.gstRate),
      cgst: f.cgst, sgst: f.sgst, igst: f.igst, totalgst: f.totalGst, roundoff: f.roundOff,
      group: ok('group', f.group), item: ok('item', f.item), hsn: f.hsn, qty: f.qty, veh: f.vehicle, itc: f.itc
    };
  }

  return {
    parse: parse, legacy: legacy, isLabel: isLabel, validGstin: validGstin,
    detectGroup: detectGroup, goodName: goodName, findDate: findDate, nMoney: nMoney, LABEL_RE: LABEL_RE
  };
});
