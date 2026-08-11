/* ═══════════════════════════════════════════════════════════════════════
   gsp-provider.js — the GSP abstraction. Pure. Node-testable.

   The ERP must never name a vendor. Business logic calls this contract;
   a registered adapter satisfies it; config picks which one. Swapping
   ClearTax for Vayana or IRIS must be a config change and an adapter file
   — never an edit to Sales, Purchase, Invoice or the GST module.

   ── THE TRANSPORT SEAM ───────────────────────────────────────────────
   Adapters never call fetch() themselves. They build a request and hand it
   to an injected transport. That is what makes them testable without
   credentials: the same adapter code that will one day talk to
   api-sandbox.clear.in can be driven here against recorded responses, and
   the thing under test is the REAL adapter, not a mock of it.

   ── WHAT IS AND IS NOT PROVEN ────────────────────────────────────────
   Endpoint paths, methods, headers and error shapes below come from
   VERIFIED official documentation. NOTHING here has been executed against
   a live sandbox — no credentials exist yet. Every adapter therefore
   reports `verified: false` until a real token has round-tripped, and
   describeProvider() refuses to call itself connected on documentation
   alone. Do not let a green test suite here be mistaken for a working
   integration; it proves the SHAPE is right, not that the wire works.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* The contract. Every adapter must implement all of it — a partial
     adapter is refused at registration rather than failing mid-filing. */
  var CONTRACT = ['authenticate', 'getToken', 'generateEInvoice', 'cancelEInvoice', 'getEInvoice',
                  'generateEWayBill', 'updateEWayBill', 'extendEWayBill', 'cancelEWayBill',
                  'getEWayBill', 'healthCheck', 'normalizeError'];

  /* ── ONE internal error shape ────────────────────────────────────────
     Every provider invents its own codes. The ERP learns exactly one
     vocabulary; adapters translate into it. `retryable` is the field the
     retry logic reads — and getting it wrong in the unsafe direction
     means re-filing a document that already exists, so the default when
     a code is unrecognised is NOT retryable. */
  var CATEGORY = ['VALIDATION', 'AUTH', 'DUPLICATE', 'NETWORK', 'RATE_LIMIT', 'PROVIDER', 'UNKNOWN'];
  /* Only these are ever safe to retry automatically. DUPLICATE is not a
     failure to retry — it means the document is already filed. VALIDATION
     will fail identically forever. AUTH needs a new token, which is a
     re-authenticate, not a blind repeat of the same call. */
  var RETRYABLE = { NETWORK: 1, RATE_LIMIT: 1, PROVIDER: 1 };

  function gstError(o) {
    o = o || {};
    var cat = CATEGORY.indexOf(o.category) >= 0 ? o.category : 'UNKNOWN';
    return {
      provider: String(o.provider || ''),
      code: String(o.code == null ? '' : o.code),
      message: String(o.message || 'The provider returned an error we could not interpret.'),
      category: cat,
      retryable: o.retryable != null ? !!o.retryable : !!RETRYABLE[cat],
      /* Kept for the audit trail and for a developer to read later. The UI
         shows `message`; this is never rendered to the owner. */
      rawResponse: o.rawResponse == null ? null : o.rawResponse,
      httpStatus: o.httpStatus == null ? null : o.httpStatus,
      requestId: String(o.requestId || ''),
      timestamp: String(o.timestamp || '')
    };
  }

  /* ── registry ────────────────────────────────────────────────────── */
  var _adapters = {};
  function register(name, factory) {
    if (typeof factory !== 'function') throw new Error('adapter factory must be a function: ' + name);
    _adapters[String(name).toLowerCase()] = factory;
  }
  function missingMethods(a) { return CONTRACT.filter(function (m) { return !a || typeof a[m] !== 'function'; }); }

  /* create(config) — the ONLY thing business logic calls.
       config = { provider:'cleartax', env:'sandbox', credentials:{...}, transport, now }
     Credentials are passed in from the server's own config; nothing here
     reads a file, and nothing here logs them. */
  function create(config) {
    config = config || {};
    var key = String(config.provider || '').toLowerCase();
    var factory = _adapters[key];
    if (!factory) {
      return { ok: false, error: gstError({ provider: key, category: 'PROVIDER',
        code: 'NO_ADAPTER', message: 'No adapter is registered for provider "' + key + '".' }) };
    }
    var adapter = factory(config);
    var missing = missingMethods(adapter);
    if (missing.length) {
      return { ok: false, error: gstError({ provider: key, category: 'PROVIDER', code: 'INCOMPLETE_ADAPTER',
        message: 'The "' + key + '" adapter does not implement: ' + missing.join(', ') }) };
    }
    return { ok: true, adapter: adapter };
  }

  function describe(config) {
    var key = String((config || {}).provider || '').toLowerCase();
    if (!_adapters[key]) return { provider: key, status: 'not_configured', connected: false, missing: CONTRACT.slice() };
    var r = create(config);
    if (!r.ok) return { provider: key, status: 'incomplete', connected: false, missing: missingMethods(null) };
    /* An adapter is `connected` ONLY after a real call has succeeded. Having
       code is not having a connection — that distinction is the whole point
       of this file. */
    return { provider: key, status: r.adapter.verified ? 'connected' : 'configured_not_connected',
             connected: !!r.adapter.verified, missing: [] };
  }

  /* ── the transport seam ─────────────────────────────────────────────
     transport(req) -> Promise<{ status, headers, body }> or a thrown Error.
     A missing transport is itself an error rather than a silent no-op. */
  function noTransport() {
    return Promise.reject(Object.assign(new Error('No transport configured — nothing was sent.'), { _noTransport: true }));
  }

  /* Shared helper every adapter uses so retry/normalisation behave the
     same regardless of vendor. */
  function callWith(adapter, transport, req, mapError) {
    var t = transport || noTransport;
    return Promise.resolve()
      .then(function () { return t(req); })
      .then(function (res) {
        res = res || {};
        if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, body: res.body, headers: res.headers || {} };
        return { ok: false, error: mapError(res) };
      })
      .catch(function (e) {
        /* A thrown transport error is a NETWORK problem, not a provider
           verdict — the document's fate is unknown, so the caller must
           check before retrying rather than blindly re-filing. */
        return { ok: false, error: gstError({ provider: adapter.name, category: 'NETWORK',
          code: e && e._noTransport ? 'NO_TRANSPORT' : 'NETWORK_ERROR',
          message: e && e._noTransport ? 'No transport configured — nothing was sent.'
            : 'Could not reach the provider. The document may or may not have been filed — check before retrying.',
          rawResponse: e && e.message ? String(e.message) : null, retryable: true }) };
      });
  }

  /* Never let a credential reach a log. Adapters pass headers through this
     before anything is recorded. */
  var SECRET_HEADERS = /auth|token|secret|password|key|cookie|clientid|client-id/i;
  function redact(headers) {
    var out = {};
    Object.keys(headers || {}).forEach(function (k) { out[k] = SECRET_HEADERS.test(k) ? '[redacted]' : headers[k]; });
    return out;
  }

  var api = { CONTRACT: CONTRACT, CATEGORY: CATEGORY, RETRYABLE: RETRYABLE,
              gstError: gstError, register: register, create: create, describe: describe,
              callWith: callWith, redact: redact, missingMethods: missingMethods,
              _adapters: function () { return Object.keys(_adapters); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLGsp = api;
})(typeof window !== 'undefined' ? window : globalThis);
