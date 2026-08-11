/* ═══════════════════════════════════════════════════════════════════════
   gst-store.js — compliance records for E-Invoice and E-Way Bill.
   Pure state machine + audit trail. No network, no DOM.

   WHY THE RECORD IS SEPARATE FROM THE INVOICE
   An IRN is not a property of a sale any more than a receipt is. It is a
   government artefact with its own lifecycle, its own failures and its own
   cancellation rules, and an invoice can outlive several attempts at one.
   Stuffing irn/ackNo/ewbNo onto the sale row would mean a failed attempt
   overwriting a successful one, and no way to answer "what did we send,
   when, and what came back".

   THE RULES THIS FILE ENFORCES, because they are the ones that cost money
   · A status may only become `generated` WITH a government reference.
     Marking success before the response arrives is how a lorry leaves
     against an E-Way Bill that does not exist.
   · A government reference, once stored, is IMMUTABLE. No later call may
     overwrite an IRN or an EWB number — that is destroying the only proof
     the filing happened.
   · Every attempt is keyed. Two clicks of Generate produce one filing.
   · Nothing is ever deleted. A cancellation is a new state on the same
     record, not the removal of history.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var GST = (typeof module !== 'undefined' && module.exports) ? require('./gst-core.js') : (root.QLGst || null);
  var S = function (v) { return String(v == null ? '' : v).trim(); };

  /* Legal transitions. Anything absent is refused — a state machine that
     accepts an undeclared move is not a state machine. */
  var EINV_NEXT = {
    not_generated: ['ready', 'blocked', 'not_applicable'],
    ready:         ['generating', 'blocked', 'not_generated'],
    generating:    ['generated', 'failed'],
    generated:     ['cancelled'],
    failed:        ['ready', 'generating', 'blocked'],
    blocked:       ['ready', 'not_generated'],
    cancelled:     [],
    not_applicable: ['not_generated']
  };
  var EWB_NEXT = {
    not_required:  ['not_generated'],
    not_generated: ['ready', 'blocked', 'not_required'],
    ready:         ['generating', 'blocked', 'not_generated'],
    generating:    ['generated', 'failed'],
    generated:     ['expired', 'cancelled', 'closed'],
    failed:        ['ready', 'generating', 'blocked'],
    blocked:       ['ready', 'not_generated'],
    expired:       ['closed'],
    cancelled:     [],
    closed:        []
  };
  /* The states that assert a government document exists. Reaching one
     without a reference is the lie this module exists to prevent. */
  var NEEDS_REF = { generated: 1 };

  function newRecord(kind, o) {
    o = o || {};
    return {
      kind: kind,                       // 'einvoice' | 'ewb'
      companyId: S(o.companyId), gstin: S(o.gstin).toUpperCase(),
      invoiceRef: S(o.invoiceRef), docNo: S(o.docNo), docDate: S(o.docDate),
      status: kind === 'ewb' ? 'not_generated' : 'not_generated',
      requestKey: GST ? GST.requestKey(o.companyId, o.gstin, o.docType || 'INV', o.docNo, o.docDate) : '',
      gov: null,                        // the government reference, once and only once
      provider: S(o.provider), environment: S(o.environment) || 'sandbox',
      /* ── RECONCILIATION FIELDS ─────────────────────────────────────
         These exist so that after a lost response we can answer "what did
         we send, when, what came back, and what does the provider think
         now" without guessing. providerStatus is the vendor's OWN word,
         kept beside our normalised `status` because the two disagreeing is
         itself the signal that a reconciliation is needed.
         providerRef is whatever correlation id the vendor returns — the
         only handle their support team will accept when something is
         stuck. sanitizedResponse is the payload with credentials stripped;
         it is what a developer reads at 11pm, and storing a raw response
         with an auth header in it would put a token in the database. */
      providerStatus: '',               // the vendor's own status word
      providerRef: '',                  // vendor request/correlation id
      sanitizedResponse: null,          // last response, credentials removed
      lastAttemptAt: '',                // when we last tried
      lastError: null, attempts: 0, history: [],
      createdAt: S(o.at), updatedAt: S(o.at)
    };
  }

  /* Strip anything credential-shaped before a response is persisted. The
     database is not a place for tokens, and a support ticket should be
     copy-pasteable without leaking one. */
  var SECRETY = /auth|token|secret|password|key|cookie|signature|sek|clientid|client_id/i;
  function sanitize(v, depth) {
    depth = depth || 0;
    if (v == null || depth > 6) return v;
    if (Array.isArray(v)) return v.slice(0, 50).map(function (x) { return sanitize(x, depth + 1); });
    if (typeof v === 'object') {
      var out = {};
      Object.keys(v).slice(0, 60).forEach(function (k) {
        out[k] = SECRETY.test(k) ? '[redacted]' : sanitize(v[k], depth + 1);
      });
      return out;
    }
    if (typeof v === 'string' && v.length > 2000) return v.slice(0, 2000) + '…[truncated]';
    return v;
  }

  function log(rec, action, meta) {
    rec.history.push({ at: (meta && meta.at) || '', action: action, by: (meta && meta.by) || '',
      from: (meta && meta.from) || '', to: (meta && meta.to) || '',
      note: (meta && meta.note) || '', requestId: (meta && meta.requestId) || '' });
    /* Bounded so a retry storm cannot grow the blob without limit, but the
       FIRST entries are kept — the original filing matters more than the
       hundredth retry. */
    if (rec.history.length > 200) rec.history.splice(100, rec.history.length - 200);
  }

  /* ── the only way a status changes ──────────────────────────────────
       transition(rec, to, opts) -> {ok, err}
     opts.gov  = { irn, ackNo, ackDate, qr } | { ewbNo, ewbDate, validUpto }
     A move to `generated` REQUIRES opts.gov. Everything else refuses it. */
  function transition(rec, to, opts) {
    opts = opts || {};
    var table = rec.kind === 'ewb' ? EWB_NEXT : EINV_NEXT;
    var allowed = table[rec.status] || [];
    if (allowed.indexOf(to) < 0) {
      return { ok: false, err: 'Cannot go from "' + rec.status + '" to "' + to + '"' +
        (allowed.length ? ' — only ' + allowed.join(', ') : ' — it is a final state') };
    }
    if (NEEDS_REF[to]) {
      var g = opts.gov || null;
      var ref = g && (S(g.irn) || S(g.ewbNo));
      if (!ref) return { ok: false, err: 'Refusing to mark this "generated" without a government reference — nothing came back to prove it was filed' };
      /* IMMUTABLE. A second filing cannot overwrite the first. */
      if (rec.gov && (S(rec.gov.irn) || S(rec.gov.ewbNo))) {
        return { ok: false, err: 'This document already carries a government reference; it can never be overwritten' };
      }
      rec.gov = Object.assign({}, g);
      rec.lastError = null;
    }
    /* The full error record, category included — the retry policy reads
       category, and a stored error without one cannot be re-decided later. */
    if (to === 'failed') {
      rec.lastError = { code: S(opts.code), message: S(opts.message),
                        category: S(opts.category) || 'UNKNOWN', at: S(opts.at) };
    }
    if (to === 'generating') { rec.attempts++; rec.lastAttemptAt = S(opts.at); }
    if (opts.providerStatus != null) rec.providerStatus = S(opts.providerStatus);
    if (opts.providerRef != null) rec.providerRef = S(opts.providerRef);
    if (opts.response !== undefined) rec.sanitizedResponse = sanitize(opts.response);
    rec.updatedAt = S(opts.at) || rec.updatedAt;
    var from = rec.status;
    rec.status = to;
    log(rec, to, { at: opts.at, by: opts.by, from: from, to: to, note: opts.note, requestId: opts.requestId });
    return { ok: true };
  }

  /* ── idempotency ────────────────────────────────────────────────────
     Before any provider call: has this exact document already been filed,
     or is a filing in flight? Two clicks must produce one document. */
  function guard(records, rec) {
    var mine = (records || []).filter(function (r) {
      return r !== rec && r.kind === rec.kind && r.requestKey && r.requestKey === rec.requestKey;
    });
    var done = mine.filter(function (r) { return r.gov && (S(r.gov.irn) || S(r.gov.ewbNo)); })[0];
    if (done) return { proceed: false, reason: 'already_generated', existing: done };
    if (rec.gov && (S(rec.gov.irn) || S(rec.gov.ewbNo))) return { proceed: false, reason: 'already_generated', existing: rec };
    if (rec.status === 'generating') return { proceed: false, reason: 'in_flight', existing: rec };
    if (mine.some(function (r) { return r.status === 'generating'; })) return { proceed: false, reason: 'in_flight', existing: mine[0] };
    return { proceed: true, reason: '' };
  }

  /* ── the gate every filing passes ───────────────────────────────────
     Validation, then idempotency, then provider readiness — in that order,
     because a bad invoice should be rejected before we even look at
     whether the provider is up. */
  function prepare(rec, invoice, ctx) {
    ctx = ctx || {};
    if (!GST) return { ok: false, stage: 'internal', err: 'gst-core not loaded' };
    var v = GST.validate(invoice, { seller: ctx.seller, today: ctx.today, forEwb: rec.kind === 'ewb' });
    if (v.state === 'BLOCKED') return { ok: false, stage: 'validation', err: 'The invoice is not fit to file', validation: v };
    var g = guard(ctx.records || [], rec);
    if (!g.proceed) return { ok: false, stage: 'idempotency', err: g.reason === 'already_generated'
      ? 'This document has already been filed' : 'A filing for this document is already in progress', guard: g, validation: v };
    var p = GST.describeProvider(ctx.provider);
    if (!p.connected) return { ok: false, stage: 'provider', err: 'No authorized provider is connected (' + p.status + ')', provider: p, validation: v };
    return { ok: true, validation: v, provider: p };
  }

  var api = { newRecord: newRecord, transition: transition, guard: guard, prepare: prepare,
              sanitize: sanitize,
              EINV_NEXT: EINV_NEXT, EWB_NEXT: EWB_NEXT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLGstStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
