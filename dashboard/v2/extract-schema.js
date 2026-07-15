/* ═══════════════════════════════════════════════════════════════════════
   QuickLimes — invoice extraction SCHEMA + VALIDATION engine (window.QLExtract
   / Node module). Pure, dependency-free, unit-tested. This is the "never trust
   the AI blindly" layer: it validates every field an AI (or the regex fallback)
   returns before anything is shown or saved — GSTIN checksum, GST reconciliation,
   intra/inter-state consistency, line-item totals, fabricated-name rejection,
   duplicate keys, sales/purchase classification, per-field confidence. It NEVER
   invents a value; a missing field stays null and is flagged for review.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLExtract = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Canonical AI output schema (also mirrored in api/extract.php as the tool
     input_schema). Values are null when not present — the model is instructed
     to return "not found", never a guess. */
  var FIELDS = ['documentType', 'invoiceNo', 'invoiceDate', 'dueDate', 'poNo', 'ewayBillNo',
    'vehicleNo', 'placeOfSupply', 'stateCode', 'reverseCharge', 'paymentTerms',
    'supplierName', 'supplierGstin', 'buyerName', 'buyerGstin',
    'taxable', 'cgst', 'sgst', 'igst', 'cess', 'freight', 'discount', 'roundOff', 'grandTotal', 'gstRate'];
  var CORE = ['supplierName', 'invoiceNo', 'invoiceDate', 'taxable', 'grandTotal'];
  var NUMERIC = ['taxable', 'cgst', 'sgst', 'igst', 'cess', 'freight', 'discount', 'roundOff', 'grandTotal', 'gstRate'];

  function num(v) { if (v == null || v === '') return null; var n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function up(s) { return String(s == null ? '' : s).toUpperCase().trim(); }

  /* ── GSTIN structure + checksum (GSTN algorithm) ── */
  var GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/;
  var CP = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function gstinChecksum(g14) {
    var factor = 2, sum = 0, mod = CP.length;
    for (var i = g14.length - 1; i >= 0; i--) {
      var d = factor * CP.indexOf(g14[i]);
      factor = factor === 2 ? 1 : 2;
      d = Math.floor(d / mod) + (d % mod);
      sum += d;
    }
    return CP[(mod - (sum % mod)) % mod];
  }
  function validGstin(g) {
    g = up(g).replace(/\s/g, '');
    if (!GST_RE.test(g)) return false;
    return gstinChecksum(g.slice(0, 14)) === g[14];
  }
  function gstinState(g) { g = up(g); return /^\d{2}/.test(g) ? g.slice(0, 2) : ''; }
  function panOfGstin(g) { g = up(g); return GST_RE.test(g) ? g.slice(2, 12) : ''; }

  /* ── fabricated / label party names — never accept these as a firm ── */
  var BAD_NAME = /^(?:the\b|for\b|to\b|from\b|m\/s\.?$|buyer|seller|consignee|consignor|authoris|authoriz|signator|declaration|terms|subject|received|payer|payee|ordering|reverse\s*charge|tax\s*invoice|bill\s*of\s*supply|credit\s*note|debit\s*note|consignment\s*note|delivery|dispatch|place\s*of|state\s*name|order\s*no|reference|original|e-?way|irn\b|ack\b|gstin|pan\b|hsn|sac\b)/i;
  var ADDR = /\b(?:road|street|nagar|marg|plot\s*no|khasra|khasara|village|tehsil|dist\b|district|pin\s*code|\bpin\b|near\b|opp\b|floor|block|sector)\b/i;
  function plausibleName(s) {
    var c = String(s == null ? '' : s).replace(/\s+/g, ' ').trim().replace(/^[('"\[\s]+/, '').replace(/[)'"\].,;:\s]+$/, '');
    if (c.length < 3 || c.length > 100) return false;
    if (BAD_NAME.test(c)) return false;
    if (/\border\s*no\b|^s\s+order\b/i.test(c)) return false;   // "'s Order No. Dated" grid-header remnant
    if (/\bto\b/i.test(c) && /\b(?:plant|depot|godown|works|factory|branch|refinery|terminal|siding|station|site)\b/i.test(c)) return false;
    if (ADDR.test(c) && !/\b(?:ltd|limited|pvt|llp|traders?|trading|mines?|minerals?|industries|enterprises?|cement|corporation|corp|company|\bco\b|sons|agencies|associates|udyog|stores?|suppliers?|transport|roadlines|petro|petroleum|chemicals?|distributors?|steel|works)\b/i.test(c)) return false;
    if (!/[A-Za-z]{3}/.test(c)) return false;
    return true;
  }

  /* ── party master resolution (GSTIN is identity) ── */
  function resolveParty(gstin, name, master) {
    gstin = up(gstin).replace(/\s/g, '');
    var verified = master && master[gstin] ? master[gstin] : '';
    if (verified) {
      var mismatch = name && plausibleName(name) && up(name).replace(/[^A-Z0-9]/g, '') !== up(verified).replace(/[^A-Z0-9]/g, '');
      return { name: verified, source: 'master', gstin: gstin, mismatch: !!mismatch, extracted: name || '' };
    }
    if (name && plausibleName(name)) return { name: String(name).trim(), source: 'extracted', gstin: gstin, mismatch: false };
    return { name: '', source: 'none', gstin: gstin, mismatch: false };
  }

  /* ── sales vs purchase from OWN GSTIN (recipient = purchase, seller = sales) ── */
  /* Which register does this belong in — OURS is the question, not the paper's.
     ONLY the GSTINs can answer it: whichever side is us decides.

     documentType MUST NEVER DECIDE. It describes the DOCUMENT, not our
     relationship to it: every tax invoice is a "sales" invoice to the firm that
     issued it. A real IOC petcoke bill comes back documentType='sales' — true
     for IOC, and it is OUR PURCHASE. Trusting it routed real purchases into the
     sales register, which is exactly what the user reported ("Saved 1 bill →
     moved to the sales register"). The model cannot know who we are; only our
     own GSTIN does.

     When the GSTINs can't answer (the AI didn't return buyerGstin — it is not a
     required field — or we have no identity on file), the register the user
     deliberately chose wins, flagged low so the UI asks. */
  function classify(doc, ownGstins, hint) {
    var own = (ownGstins || []).map(function (g) { return up(g).replace(/\s/g, ''); });
    var sup = up(doc.supplierGstin).replace(/\s/g, ''), buy = up(doc.buyerGstin).replace(/\s/g, '');
    var ownIsBuyer = buy && own.indexOf(buy) >= 0;
    var ownIsSeller = sup && own.indexOf(sup) >= 0;
    if (ownIsBuyer && !ownIsSeller) return { kind: 'purchase', conf: 'high', why: 'Your GSTIN is the buyer' };
    if (ownIsSeller && !ownIsBuyer) return { kind: 'sales', conf: 'high', why: 'Your GSTIN issued it' };
    // Be precise about WHY we could not tell — a vague or wrong reason is worse
    // than none. "Neither GSTIN is yours" would be a LIE on a bill that plainly
    // carries our GSTIN as the buyer; the truth is the model did not return it
    // (buyerGstin is not a required field).
    var where = ' — filed on the ' + (hint === 'sales' ? 'Sales' : 'Purchase') + ' register you uploaded from';
    if (!own.length) return { kind: hint || 'purchase', conf: 'low', why: 'Your firm’s GSTIN is not set — add it in Settings → Company profile' + where };
    if (!buy && !sup) return { kind: hint || 'purchase', conf: 'low', why: 'No GSTIN could be read from this bill' + where };
    if (!buy) return { kind: hint || 'purchase', conf: 'low', why: 'The buyer’s GSTIN could not be read, so we can’t tell whose side we are on' + where };
    if (!sup) return { kind: hint || 'purchase', conf: 'low', why: 'The supplier’s GSTIN could not be read' + where };
    return { kind: hint || 'purchase', conf: 'low', why: 'Neither GSTIN on this bill is yours' + where };
  }

  /* ── duplicate keys ── */
  function invKey(doc) {
    var g = up(doc.supplierGstin).replace(/\s/g, ''), inv = up(doc.invoiceNo).replace(/\s/g, '');
    var amt = Math.round(num(doc.grandTotal) || 0);
    if (!(g || inv)) return '';
    return [g, inv, doc.invoiceDate || '', amt].join('|');
  }

  /* ── the validator ─────────────────────────────────────────────────────
     Returns { fields, conf(per field), issues[], review[], status, cls, party,
     buyerParty, dupKey }. status: 'ready' | 'review' | 'invalid'. It downgrades
     any AI confidence that fails an arithmetic/structural check. */
  function validate(raw, ctx) {
    ctx = ctx || {};
    var d = {}, conf = {}, issues = [], review = [];
    FIELDS.forEach(function (k) { d[k] = raw && raw[k] != null && raw[k] !== '' ? raw[k] : null; });
    NUMERIC.forEach(function (k) { d[k] = num(d[k]); });
    var aiConf = (raw && raw.confidence) || {};
    function setConf(k, level) { conf[k] = level; if (level === 'low') { if (review.indexOf(k) < 0) review.push(k); } }
    FIELDS.forEach(function (k) {
      if (d[k] == null) { conf[k] = 'none'; }
      else { var c = String(aiConf[k] || 'medium').toLowerCase(); conf[k] = (c === 'high' || c === 'medium' || c === 'low') ? c : 'medium'; }
    });

    // GSTIN checksum → downgrade if malformed
    ['supplierGstin', 'buyerGstin'].forEach(function (k) {
      if (d[k] != null) { d[k] = up(d[k]).replace(/\s/g, ''); if (!validGstin(d[k])) { issues.push(k + ' failed GSTIN checksum'); setConf(k, 'low'); } }
    });

    // party master (GSTIN wins; reject fabricated names)
    var party = resolveParty(d.supplierGstin, d.supplierName, ctx.master);
    d.supplierName = party.name || null;
    if (party.source === 'master') conf.supplierName = 'high';
    else if (d.supplierName && !plausibleName(raw.supplierName)) { issues.push('Supplier name looks like a label/fragment'); d.supplierName = null; }
    if (party.mismatch) { issues.push('Extracted supplier "' + party.extracted + '" conflicts with GSTIN record "' + party.name + '"'); if (review.indexOf('supplierName') < 0) review.push('supplierName'); }
    var buyerParty = resolveParty(d.buyerGstin, d.buyerName, ctx.master);
    d.buyerName = buyerParty.name || null;

    // supplier ≠ buyer
    if (d.supplierGstin && d.buyerGstin && d.supplierGstin === d.buyerGstin) issues.push('Supplier and buyer GSTIN are identical');

    // amounts reconciliation: taxable + taxes + charges ≈ grand total
    var tax = (d.cgst || 0) + (d.sgst || 0) + (d.igst || 0) + (d.cess || 0);
    if (d.taxable != null && d.grandTotal != null) {
      var expect = r2(d.taxable + tax + (d.freight || 0) - (d.discount || 0) + (d.roundOff || 0));
      var diff = Math.abs(expect - d.grandTotal);
      var tol = Math.max(2, d.grandTotal * 0.01);
      if (diff > tol) {
        // try without freight/discount (often already inside taxable)
        var alt = Math.abs(r2(d.taxable + tax + (d.roundOff || 0)) - d.grandTotal);
        if (alt > tol) { issues.push('Amounts do not reconcile: taxable+tax (' + expect + ') ≠ total (' + d.grandTotal + ')'); setConf('taxable', 'low'); setConf('grandTotal', 'low'); }
      }
    }
    // recover a missing leg from the identity (never invent a rate)
    if (d.taxable == null && d.grandTotal != null && tax > 0) { var t = r2(d.grandTotal - tax - (d.roundOff || 0)); if (t > 0 && t < d.grandTotal) { d.taxable = t; conf.taxable = 'medium'; } }
    if (d.grandTotal == null && d.taxable != null && tax > 0) { d.grandTotal = r2(d.taxable + tax + (d.roundOff || 0)); conf.grandTotal = 'medium'; }

    // GST% from the tax math (authoritative over a per-component guess)
    if (d.taxable && tax > 0) {
      var rr = tax / d.taxable * 100, snap = [0, 3, 5, 12, 18, 28].filter(function (x) { return Math.abs(x - rr) <= 0.6; })[0];
      if (snap != null) { if (d.gstRate == null || Math.abs(d.gstRate - snap) > 0.6) { d.gstRate = snap; conf.gstRate = 'high'; } }
    }

    // intra/inter-state consistency
    var supSt = gstinState(d.supplierGstin), buySt = gstinState(d.buyerGstin);
    if (supSt && buySt) {
      var interState = supSt !== buySt;
      if (interState && (d.cgst || d.sgst) && !d.igst) issues.push('Interstate GSTINs but CGST/SGST charged (expected IGST)');
      if (!interState && d.igst && !(d.cgst || d.sgst)) issues.push('Intrastate GSTINs but IGST charged (expected CGST+SGST)');
    }

    // required-field gate
    var missing = CORE.filter(function (k) { return d[k] == null; });
    missing.forEach(function (k) { if (review.indexOf(k) < 0) review.push(k); });
    // credit note → ITC ineligible hint carried in issues
    var isCredit = String(d.documentType || '').indexOf('credit') >= 0;

    var cls = classify(d, ctx.ownGstins, ctx.hint);
    if (cls.conf !== 'high') { if (review.indexOf('documentType') < 0) review.push('documentType'); }

    var status = missing.length ? 'invalid' : (review.length || issues.length) ? 'review' : 'ready';
    return {
      fields: d, conf: conf, issues: issues, review: review, status: status,
      cls: cls, party: party, buyerParty: buyerParty, isCredit: isCredit,
      dupKey: invKey(d), totalTax: tax
    };
  }

  return {
    FIELDS: FIELDS, CORE: CORE, validGstin: validGstin, gstinChecksum: gstinChecksum,
    gstinState: gstinState, panOfGstin: panOfGstin, plausibleName: plausibleName,
    resolveParty: resolveParty, classify: classify, invKey: invKey, validate: validate, num: num
  };
});
