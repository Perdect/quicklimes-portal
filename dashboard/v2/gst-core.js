/* ═══════════════════════════════════════════════════════════════════════
   gst-core.js — GST compliance foundation.  Pure. Node-testable.
   Validation · status models · E-Way Bill eligibility · provider contract.

   WHAT THIS DELIBERATELY IS NOT
   It makes no network call and returns no IRN, no acknowledgement number,
   no QR and no EWB number. There is no authorized IRP/GSP connected yet,
   and a hardcoded IRN would be worse than nothing: it would look like a
   filed document, print on an invoice, and be discovered at an audit. The
   provider contract below is an INTERFACE with no implementation — when
   real credentials arrive, an adapter satisfies it and nothing else moves.

   WHY THE VALIDATOR COMES FIRST
   Everything else waits on paperwork; this does not. Its job is to refuse
   a submission before it is ever attempted, and specifically to stop an
   OCR-imported invoice reaching a government filing. This app has already
   proved it can put a letterhead tagline in the customer field — filing
   that would be a legal document naming a customer who does not exist.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var PR = (typeof module !== 'undefined' && module.exports) ? require('./party-resolve.js') : (root.QLPartyResolve || null);
  var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  var S = function (v) { return String(v == null ? '' : v).trim(); };

  /* ── status models — three SEPARATE lifecycles ───────────────────────
     An invoice being "paid" says nothing about whether its IRN exists, and
     an IRN says nothing about the E-Way Bill. Collapsing them is how a
     dispatch leaves the yard against an invoice whose EWB failed. */
  var EINV_STATUS = ['not_generated', 'ready', 'generating', 'generated', 'failed', 'cancelled', 'blocked', 'not_applicable'];
  var EWB_STATUS = ['not_required', 'not_generated', 'ready', 'generating', 'generated', 'failed', 'expired', 'cancelled', 'closed', 'blocked'];
  var SEVERITY = { blocker: 'blocker', warning: 'warning' };

  /* GSTIN: 2-digit state code, 10-char PAN, entity digit, 'Z', checksum. */
  var GSTIN_RE = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  var STATE_OK = function (g) { var c = parseInt(S(g).slice(0, 2), 10); return c >= 1 && c <= 38; };
  var panOf = function (g) { var s = S(g).toUpperCase(); return s.length === 15 ? s.slice(2, 12) : ''; };
  /* A vehicle number as the EWB portal accepts it. State (2 letters), RTO
     district (1-2 digits), series, then 4 digits. The SERIES IS
     ALPHANUMERIC, not letters-only: RJ19-1R-1049 is a real plate from this
     book and a letters-only pattern rejected it. RJ14GQ6403 and RJ191R1049
     must both pass; "TRUCK-1" must not. */
  var VEHICLE_RE = /^[A-Z]{2}[0-9]{1,2}[A-Z0-9]{0,3}[0-9]{4}$/;

  function issue(list, sev, code, field, message, fix) {
    list.push({ severity: sev, code: code, field: field, message: message, fix: fix || '' });
  }

  /* ── validate ────────────────────────────────────────────────────────
       inv = { inv, date, party, gstin, qty, rate, gstR, hsn, unit, veh,
               taxable, cgst, sgst, igst, total, interState,
               shipTo:{name,gstin}, _ocrParty, _partyResolve }
       ctx = { seller:{name,gstin,state}, forEwb:bool, today:'YYYY-MM-DD' }
     Returns { state:'READY'|'REVIEW'|'BLOCKED', issues:[], blockers, warnings }.  */
  function validate(inv, ctx) {
    inv = inv || {}; ctx = ctx || {};
    var out = [], seller = ctx.seller || {};

    /* ── seller ── */
    var sg = S(seller.gstin).toUpperCase();
    if (!sg) issue(out, SEVERITY.blocker, 'SELLER_GSTIN_MISSING', 'seller.gstin', 'This company has no GSTIN set.', 'Add it in Settings → Company');
    else if (!GSTIN_RE.test(sg) || !STATE_OK(sg)) issue(out, SEVERITY.blocker, 'SELLER_GSTIN_INVALID', 'seller.gstin', 'The company GSTIN is not a valid format: ' + sg, 'Correct it in Settings → Company');

    /* ── buyer identity — the part this app has actually got wrong ── */
    var bg = S(inv.gstin).toUpperCase(), party = S(inv.party);
    if (!party) issue(out, SEVERITY.blocker, 'BUYER_NAME_MISSING', 'party', 'The invoice has no customer name.', 'Open the invoice and set the customer');
    else if (PR && PR.suspect && PR.suspect(party)) {
      issue(out, SEVERITY.blocker, 'BUYER_NAME_NOT_A_NAME', 'party',
        'The customer reads "' + party + '", which is a ' + PR.suspect(party) + ' — not a business name.',
        'Fix the customer before filing; a wrong name on a filed invoice is a legal document naming someone who does not exist');
    }
    /* An OCR-imported invoice whose party was never verified must not be
       filed on the strength of the parser's opinion. */
    var res = inv._partyResolve || null;
    if (inv._ocrParty && !res) issue(out, SEVERITY.blocker, 'PARTY_UNVERIFIED', 'party',
      'This customer came from OCR and has not been verified against the party master.', 'Confirm the customer, then file');
    if (res && num(res.confidence) < 0.85) issue(out, SEVERITY.warning, 'PARTY_LOW_CONFIDENCE', 'party',
      'The customer was matched at ' + Math.round(num(res.confidence) * 100) + '% confidence (' + S(res.method) + ').', 'Confirm before filing');

    if (bg) {
      if (!GSTIN_RE.test(bg) || !STATE_OK(bg)) issue(out, SEVERITY.blocker, 'BUYER_GSTIN_INVALID', 'gstin', 'The customer GSTIN is not valid: ' + bg, 'Correct the GSTIN on the invoice');
      else if (sg && bg === sg) issue(out, SEVERITY.blocker, 'BUYER_IS_SELLER', 'gstin', 'The customer GSTIN is this company\'s own — a firm cannot invoice itself.', 'Check the buyer/seller sides');
    }
    /* No buyer GSTIN is legitimate (B2C / unregistered), so it is not a
       blocker — but it changes the document type and must be deliberate. */
    if (!bg) issue(out, SEVERITY.warning, 'BUYER_UNREGISTERED', 'gstin', 'No customer GSTIN — this files as B2C / URP, not B2B.', 'Add the GSTIN if the customer is registered');

    /* ── document ── */
    if (!S(inv.inv)) issue(out, SEVERITY.blocker, 'DOCNO_MISSING', 'inv', 'The invoice has no number.', '');
    else if (S(inv.inv).length > 16) issue(out, SEVERITY.blocker, 'DOCNO_TOO_LONG', 'inv', 'Invoice numbers may be at most 16 characters.', '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(S(inv.date))) issue(out, SEVERITY.blocker, 'DATE_INVALID', 'date', 'The invoice date is missing or not a real date.', '');
    else if (ctx.today && S(inv.date) > ctx.today) issue(out, SEVERITY.blocker, 'DATE_FUTURE', 'date', 'The invoice is dated in the future.', '');

    /* ── line + tax ── */
    if (num(inv.qty) <= 0) issue(out, SEVERITY.blocker, 'QTY_MISSING', 'qty', 'The invoice has no quantity.', '');
    if (num(inv.rate) <= 0) issue(out, SEVERITY.blocker, 'RATE_MISSING', 'rate', 'The invoice has no rate.', '');
    var hsn = S(inv.hsn);
    if (!hsn) issue(out, SEVERITY.blocker, 'HSN_MISSING', 'hsn', 'No HSN code on the line.', 'Set the product HSN');
    else if (!/^\d{4}(\d{2})?(\d{2})?$/.test(hsn)) issue(out, SEVERITY.blocker, 'HSN_INVALID', 'hsn', 'HSN must be 4, 6 or 8 digits — got "' + hsn + '".', '');
    if (!S(inv.unit)) issue(out, SEVERITY.warning, 'UOM_MISSING', 'unit', 'No unit of measure on the line.', '');

    /* Arithmetic is checked, not trusted. A taxable value that disagrees
       with qty×rate means the invoice and its own line have drifted apart,
       and the portal will reject it — better to catch that here. */
    var expTax = r2(num(inv.qty) * num(inv.rate));
    if (num(inv.taxable) && Math.abs(num(inv.taxable) - expTax) > 1) {
      issue(out, SEVERITY.blocker, 'TAXABLE_MISMATCH', 'taxable',
        'Taxable value ' + num(inv.taxable) + ' does not equal quantity × rate (' + expTax + ').', 'Recheck the line');
    }
    var rate = inv.gstR == null ? null : num(inv.gstR);
    if (rate == null) issue(out, SEVERITY.blocker, 'GSTRATE_MISSING', 'gstR', 'No GST rate on the invoice.', '');
    else if ([0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28].indexOf(rate) < 0)
      issue(out, SEVERITY.blocker, 'GSTRATE_INVALID', 'gstR', rate + '% is not a valid GST rate.', '');
    /* Intra-state must be CGST+SGST, inter-state must be IGST. Filing the
       wrong pair is one of the most common portal rejections. */
    var inter = !!inv.interState || (sg && bg && sg.slice(0, 2) !== bg.slice(0, 2));
    if (inter && num(inv.igst) <= 0 && num(inv.taxable) > 0 && rate)
      issue(out, SEVERITY.blocker, 'IGST_EXPECTED', 'igst', 'Buyer is in another state, so this must carry IGST, not CGST+SGST.', '');
    if (!inter && num(inv.igst) > 0)
      issue(out, SEVERITY.blocker, 'IGST_UNEXPECTED', 'igst', 'Buyer is in the same state, so this must carry CGST+SGST, not IGST.', '');

    /* ── transport, only when an EWB is being prepared ── */
    if (ctx.forEwb) {
      var veh = S(inv.veh).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!veh) issue(out, SEVERITY.blocker, 'VEHICLE_MISSING', 'veh', 'An E-Way Bill needs a vehicle number.', 'Add the vehicle');
      else if (!VEHICLE_RE.test(veh)) issue(out, SEVERITY.blocker, 'VEHICLE_INVALID', 'veh', '"' + S(inv.veh) + '" is not a valid vehicle number.', '');
      /* Ship-to is its own party. When it differs from bill-to, the current
         EWB rules want its GSTIN captured separately. */
      var st = inv.shipTo || null;
      if (st && S(st.name) && S(st.name) !== party && !S(st.gstin))
        issue(out, SEVERITY.blocker, 'SHIPTO_GSTIN_MISSING', 'shipTo.gstin', 'Ship-to differs from bill-to, so its GSTIN is required (or URP if unregistered).', '');
    }

    var blockers = out.filter(function (i) { return i.severity === SEVERITY.blocker; });
    var warnings = out.filter(function (i) { return i.severity === SEVERITY.warning; });
    return {
      state: blockers.length ? 'BLOCKED' : (warnings.length ? 'REVIEW' : 'READY'),
      issues: out, blockers: blockers.length, warnings: warnings.length
    };
  }

  /* ── E-Way Bill eligibility ──────────────────────────────────────────
     Rules change and differ by state, so the threshold is CONFIGURATION,
     never a constant compiled into the app. An unset threshold yields
     REVIEW, not a guess — the app does not get to decide a legal question
     on the owner's behalf. */
  function ewbRequired(inv, rules) {
    rules = rules || {};
    var value = num(inv.total) || r2(num(inv.qty) * num(inv.rate));
    if (rules.threshold == null) {
      return { verdict: 'REVIEW', why: 'No E-Way Bill threshold configured — set it in GST settings so this can be decided automatically.', value: value };
    }
    if (rules.exemptHsn && rules.exemptHsn.indexOf(S(inv.hsn)) >= 0)
      return { verdict: 'NOT_REQUIRED', why: 'HSN ' + S(inv.hsn) + ' is on the exempt list.', value: value };
    if (value < num(rules.threshold))
      return { verdict: 'NOT_REQUIRED', why: 'Invoice value ' + value + ' is below the ' + num(rules.threshold) + ' threshold.', value: value };
    return { verdict: 'REQUIRED', why: 'Invoice value ' + value + ' is at or above the ' + num(rules.threshold) + ' threshold.', value: value };
  }

  /* ── idempotency key ─────────────────────────────────────────────────
     Two clicks of "Generate" must never file twice. The key is derived
     from what identifies the document to the government, so a retry after
     a timeout is recognisably the SAME request rather than a new one. */
  function requestKey(companyId, gstin, docType, docNo, docDate) {
    return [S(companyId), S(gstin).toUpperCase(), S(docType) || 'INV', S(docNo).toUpperCase(), S(docDate)].join('|');
  }

  /* ── provider contract ───────────────────────────────────────────────
     An INTERFACE, deliberately unimplemented. Every method must be served
     by a backend adapter holding the credentials — never the browser. A
     provider that cannot satisfy `healthCheck` is not connected, and the
     UI must say "Not connected" rather than implying readiness. */
  var PROVIDER_CONTRACT = ['authenticate', 'healthCheck', 'generateIRN', 'getIRN', 'cancelIRN',
                           'generateEWB', 'getEWB', 'updateVehicle', 'extendEWB', 'cancelEWB', 'closeEWB'];
  function describeProvider(p) {
    var missing = PROVIDER_CONTRACT.filter(function (m) { return !p || typeof p[m] !== 'function'; });
    return { connected: missing.length === 0 && !!(p && p.connected),
             missing: missing,
             status: (!p ? 'not_configured' : (missing.length ? 'incomplete' : (p.connected ? 'connected' : 'configured_not_connected'))) };
  }

  var api = { validate: validate, ewbRequired: ewbRequired, requestKey: requestKey,
              describeProvider: describeProvider,
              EINV_STATUS: EINV_STATUS, EWB_STATUS: EWB_STATUS, PROVIDER_CONTRACT: PROVIDER_CONTRACT,
              _internals: { GSTIN_RE: GSTIN_RE, VEHICLE_RE: VEHICLE_RE, panOf: panOf, STATE_OK: STATE_OK } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLGst = api;
})(typeof window !== 'undefined' ? window : globalThis);
