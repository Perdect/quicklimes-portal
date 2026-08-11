/* ═══════════════════════════════════════════════════════════════════════
   gsp-adapters.js — ClearTax and Vayana, behind one contract.

   Every path, method and header below is from VERIFIED official
   documentation (fetched, not recalled). NOTHING has been executed against
   a live sandbox: no credentials exist yet, and probing showed
   api-sandbox.clear.in returns 504 and solo.enriched-api.vayana.com 503 to
   an unauthenticated request. So every adapter ships `verified: false`.

   The point of having TWO adapters before either is live is the swap test:
   if the ERP can drive both through the identical interface, then choosing
   ClearTax today does not marry us to it. That is provable now, without
   credentials, and it is the thing that actually protects the business.

   CREDENTIALS come in through config from the server. Nothing here reads a
   file, nothing here logs a secret, and redact() covers anything that does
   get recorded.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var GSP = (typeof module !== 'undefined' && module.exports) ? require('./gsp-provider.js') : root.QLGsp;
  var err = GSP.gstError;

  /* ── ClearTax ────────────────────────────────────────────────────────
     Docs: docs.cleartax.in. Base URLs VERIFIED:
       sandbox    https://api-sandbox.clear.in
       production https://api.clear.in
     Auth header VERIFIED: X-Cleartax-Auth-Token, plus a mandatory `gstin`
     header and an optional `branch` header — which is how multi-GSTIN and
     multi-branch work here, and why one adapter instance serves both firms
     rather than needing two.
     We deliberately bind to the GOVERNMENT SCHEMA paths where they exist,
     because a payload shaped like NIC's own is the part a future provider
     will also accept. */
  function cleartax(cfg) {
    cfg = cfg || {};
    var creds = cfg.credentials || {};
    var host = cfg.env === 'production' ? 'https://api.clear.in' : 'https://api-sandbox.clear.in';
    var transport = cfg.transport;

    function headers(gstin) {
      var h = { 'Content-Type': 'application/json' };
      if (creds.authToken) h['X-Cleartax-Auth-Token'] = creds.authToken;
      if (gstin) h.gstin = gstin;                      // mandatory per docs
      if (creds.branch) h.branch = creds.branch;       // optional, multi-branch
      return h;
    }
    /* ClearTax returns per-invoice results in an array; a 2xx does NOT mean
       every document succeeded. Errors carry NIC codes (2150 = duplicate
       IRN, 2172, 3028 …) which we translate into our own categories. */
    function mapError(res) {
      var b = res && res.body, first = null;
      try { first = b && (b.error || (b.errors && b.errors[0]) || (Array.isArray(b) && b[0] && b[0].error)); } catch (_) {}
      var code = String((first && (first.code || first.errorCode)) || (b && b.code) || res.status || '');
      var msg = (first && (first.message || first.desc)) || (b && b.message) || '';
      var cat = 'PROVIDER';
      if (res.status === 401 || res.status === 403) cat = 'AUTH';
      else if (res.status === 429) cat = 'RATE_LIMIT';
      else if (res.status >= 500) cat = 'PROVIDER';
      else if (/^2150$/.test(code) || /duplicate/i.test(msg)) cat = 'DUPLICATE';
      else if (res.status >= 400) cat = 'VALIDATION';
      return err({ provider: 'cleartax', code: code, httpStatus: res.status, category: cat,
        message: human(cat, msg, code), rawResponse: b, timestamp: cfg.now ? cfg.now() : '' });
    }
    var call = function (req) { return GSP.callWith(A, transport, req, mapError); };

    var A = {
      name: 'cleartax', env: cfg.env || 'sandbox',
      /* false until a real token has round-tripped against a live sandbox */
      verified: false,
      capabilities: { closeEWB: true, extendEWB: true, healthCheck: false, govtSchema: true },

      /* ClearTax issues a long-lived auth token from the console rather than
         a login call, so authenticate() validates what we were given instead
         of pretending there is a handshake. */
      authenticate: function () {
        if (!creds.authToken) return Promise.resolve({ ok: false, error: err({ provider: 'cleartax',
          category: 'AUTH', code: 'NO_CREDENTIALS', message: 'No ClearTax auth token is configured.' }) });
        return Promise.resolve({ ok: true, token: '[redacted]' });
      },
      getToken: function () { return Promise.resolve(creds.authToken ? { ok: true, token: '[redacted]' }
        : { ok: false, error: err({ provider: 'cleartax', category: 'AUTH', code: 'NO_CREDENTIALS', message: 'No ClearTax auth token is configured.' }) }); },

      generateEInvoice: function (inv, o) { o = o || {};
        return call({ method: 'PUT', url: host + '/einv/v2/eInvoice/generate' + (o.dryRun ? '?dryRun=true' : ''),
                      headers: headers(o.gstin), body: [inv] }); },
      cancelEInvoice: function (p, o) { o = o || {};
        return call({ method: 'PUT', url: host + '/einv/v2/eInvoice/cancel', headers: headers(o.gstin), body: [p] }); },
      getEInvoice: function (irn, o) { o = o || {};
        return call({ method: 'GET', url: host + '/einv/v2/eInvoice/get?irn=' + encodeURIComponent(irn), headers: headers(o.gstin) }); },

      generateEWayBill: function (p, o) { o = o || {};
        return call({ method: 'POST', url: host + '/einv/v2/eInvoice/ewaybill', headers: headers(o.gstin), body: [p] }); },
      updateEWayBill: function (p, o) { o = o || {};
        return call({ method: 'POST', url: host + '/einv/v1/ewaybill/update?action=PARTB', headers: headers(o.gstin), body: p }); },
      extendEWayBill: function (p, o) { o = o || {};
        return call({ method: 'POST', url: host + '/einv/v1/ewaybill/update?action=EXTEND_VALIDITY', headers: headers(o.gstin), body: p }); },
      cancelEWayBill: function (p, o) { o = o || {};
        return call({ method: 'POST', url: host + '/einv/v2/eInvoice/ewaybill/cancel', headers: headers(o.gstin), body: [p] }); },
      getEWayBill: function (ewbNo, o) { o = o || {};
        return call({ method: 'GET', url: host + '/einv/ewaybills?ewbNo=' + encodeURIComponent(ewbNo), headers: headers(o.gstin) }); },

      /* ClearTax publishes NO health endpoint. Saying so is more useful
         than inventing one: the ERP shows "unknown" rather than a green
         light it cannot justify. This is a real point in Vayana's favour. */
      healthCheck: function () {
        return Promise.resolve({ ok: false, unsupported: true, error: err({ provider: 'cleartax',
          category: 'PROVIDER', code: 'NO_HEALTH_ENDPOINT',
          message: 'ClearTax publishes no health endpoint — provider status cannot be checked independently.' }) });
      },
      normalizeError: mapError
    };
    return A;
  }

  /* ── Vayana ──────────────────────────────────────────────────────────
     Docs: Enriched API Service. Base URLs VERIFIED:
       sandbox    https://solo.enriched-api.vayana.com
       production https://live.enriched-api.vayana.com
     Auth VERIFIED as a JWT flow with an X-FLYNN-* header namespace, and
     {irp}/{ewb_provider} as client-supplied path segments. Vayana is the
     only provider in the field with a genuine health probe. */
  function vayana(cfg) {
    cfg = cfg || {};
    var creds = cfg.credentials || {};
    var host = cfg.env === 'production' ? 'https://live.enriched-api.vayana.com' : 'https://solo.enriched-api.vayana.com';
    var irp = creds.irp || 'nic';
    var transport = cfg.transport;

    function headers(gstin) {
      var h = { 'Content-Type': 'application/json' };
      if (creds.jwt) h.Authorization = 'Bearer ' + creds.jwt;
      if (creds.orgId) h['X-FLYNN-ORGANISATION-ID'] = creds.orgId;
      if (gstin) h['X-FLYNN-GSTIN'] = gstin;
      return h;
    }
    function mapError(res) {
      var b = res && res.body;
      var code = String((b && (b.errorCode || b.code)) || res.status || '');
      var msg = (b && (b.message || b.error_description || b.error)) || '';
      var cat = 'PROVIDER';
      if (res.status === 401 || res.status === 403) cat = 'AUTH';
      else if (res.status === 429) cat = 'RATE_LIMIT';
      else if (res.status >= 500) cat = 'PROVIDER';
      else if (/^2150$/.test(code) || /duplicate/i.test(msg)) cat = 'DUPLICATE';
      else if (res.status >= 400) cat = 'VALIDATION';
      return err({ provider: 'vayana', code: code, httpStatus: res.status, category: cat,
        message: human(cat, msg, code), rawResponse: b, timestamp: cfg.now ? cfg.now() : '' });
    }
    var call = function (req) { return GSP.callWith(A, transport, req, mapError); };

    var A = {
      name: 'vayana', env: cfg.env || 'sandbox',
      verified: false,
      capabilities: { closeEWB: true, extendEWB: true, healthCheck: true, govtSchema: false },

      authenticate: function () {
        if (!creds.clientId || !creds.clientSecret) return Promise.resolve({ ok: false, error: err({ provider: 'vayana',
          category: 'AUTH', code: 'NO_CREDENTIALS', message: 'No Vayana client credentials are configured.' }) });
        return call({ method: 'POST', url: host + '/theodore/v1/token',
                      headers: { 'Content-Type': 'application/json' },
                      body: { client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: 'client_credentials' } });
      },
      getToken: function () { return Promise.resolve(creds.jwt ? { ok: true, token: '[redacted]' }
        : { ok: false, error: err({ provider: 'vayana', category: 'AUTH', code: 'NO_CREDENTIALS', message: 'No Vayana token is configured.' }) }); },

      generateEInvoice: function (inv, o) { o = o || {};
        return call({ method: 'POST', url: host + '/gus/irp/' + irp + '/v1/invoices', headers: headers(o.gstin), body: inv }); },
      cancelEInvoice: function (p, o) { o = o || {};
        return call({ method: 'POST', url: host + '/gus/irp/' + irp + '/v1/invoices/cancel', headers: headers(o.gstin), body: p }); },
      getEInvoice: function (irn, o) { o = o || {};
        return call({ method: 'GET', url: host + '/gus/irp/' + irp + '/v1/invoices/' + encodeURIComponent(irn), headers: headers(o.gstin) }); },

      generateEWayBill: function (p, o) { o = o || {};
        return call({ method: 'POST', url: host + '/gus/ewb/' + irp + '/v1/ewaybills', headers: headers(o.gstin), body: p }); },
      updateEWayBill: function (p, o) { o = o || {};
        return call({ method: 'POST', url: host + '/gus/ewb/' + irp + '/v1/ewaybills/vehicle', headers: headers(o.gstin), body: p }); },
      extendEWayBill: function (p, o) { o = o || {};
        return call({ method: 'POST', url: host + '/gus/ewb/' + irp + '/v1/ewaybills/extend', headers: headers(o.gstin), body: p }); },
      cancelEWayBill: function (p, o) { o = o || {};
        return call({ method: 'POST', url: host + '/gus/ewb/' + irp + '/v1/ewaybills/cancel', headers: headers(o.gstin), body: p }); },
      getEWayBill: function (ewbNo, o) { o = o || {};
        return call({ method: 'GET', url: host + '/gus/ewb/' + irp + '/v1/ewaybills/' + encodeURIComponent(ewbNo), headers: headers(o.gstin) }); },

      /* The one genuine health probe in the field — and it distinguishes
         "Vayana is down" from "GSTN is down", which is the diagnostic you
         cannot get anywhere else. */
      healthCheck: function () {
        return call({ method: 'GET', url: host + '/gus/gstn-health/main', headers: headers(null) });
      },
      normalizeError: mapError
    };
    return A;
  }

  /* One human sentence per category. The owner reads this; the raw provider
     payload stays in rawResponse for a developer and for the audit log. */
  function human(cat, msg, code) {
    switch (cat) {
      case 'AUTH': return 'The GST provider rejected our credentials. Filing is paused until they are corrected.';
      case 'DUPLICATE': return 'This document has already been filed with the government — it was not filed again.';
      case 'RATE_LIMIT': return 'The GST provider is rate-limiting us. This will be retried automatically.';
      case 'NETWORK': return 'Could not reach the GST provider. The document may or may not have been filed — check before retrying.';
      case 'VALIDATION': return 'The government rejected this document: ' + (msg || 'code ' + code) + '.';
      case 'PROVIDER': return 'The GST provider had a problem at their end. This will be retried automatically.';
      default: return msg || 'The provider returned an error we could not interpret.';
    }
  }


  /* ── IRIS (Sovos) ────────────────────────────────────────────────────
     Two surfaces, and this matters:
       Onyx/Topaz  https://stage-api.irisgst.com  — plain JSON, no payload
                   encryption. Covers e-invoicing AND the full E-Way Bill
                   set including extend and closure.
       Zircon/IRP  https://stage.gsp.portal.irisgst.com — carries the only
                   genuine heartbeat of the three providers.
     LIVE-VERIFIED 2026-08-12 (unauthenticated, read-only):
       GET /irisirpapi/v1.04/heartbeat/ping -> HTTP 200
          body "e-Invoice Vital: 12-08-2026 03:37:05"
       GET /irisgst/mgmt/login -> HTTP 405 Method Not Allowed (correct: POST-only)
     That is the ONLY provider endpoint anywhere in this integration that has
     answered a real request. Everything else remains BLOCKED on credentials.

     IRIS is the only one of the three covering all 12 contract methods, and
     the E-Way Bill surface is one endpoint driven by an `action` field
     rather than separate paths — which is why update/extend/cancel/close all
     share a URL here. */
  function iris(cfg) {
    cfg = cfg || {};
    var creds = cfg.credentials || {};
    var host = cfg.env === 'production' ? 'https://api.irisgst.com' : 'https://stage-api.irisgst.com';
    var irpHost = cfg.env === 'production' ? 'https://gsp.portal.irisgst.com' : 'https://stage.gsp.portal.irisgst.com';
    var transport = cfg.transport;

    function headers(gstin) {
      var h = { 'Content-Type': 'application/json' };
      if (creds.token) h.Authorization = creds.token;      /* IRIS sends the raw JWT, no Bearer prefix */
      if (gstin) h.gstin = gstin;
      return h;
    }
    /* IRIS answers 200 with {"status":"FAILURE"} on business errors, so an
       HTTP status alone is not the verdict — the body must be read. That is
       a real difference from ClearTax and Vayana and the adapter absorbs it
       so the ERP never learns about it. */
    function mapError(res) {
      var b = res && res.body;
      var code = String((b && (b.errorCode || b.errorCd || b.code)) || res.status || '');
      var msg = (b && (b.errorMessage || b.message || b.errorDesc)) || '';
      var cat = 'PROVIDER';
      if (res.status === 401 || res.status === 403 || /token|unauthor/i.test(msg)) cat = 'AUTH';
      else if (res.status === 429) cat = 'RATE_LIMIT';
      else if (res.status >= 500) cat = 'PROVIDER';
      else if (/^2150$/.test(code) || /duplicate/i.test(msg)) cat = 'DUPLICATE';
      else if (res.status >= 400 || /FAILURE/i.test(String(b && b.status))) cat = 'VALIDATION';
      return err({ provider: 'iris', code: code, httpStatus: res.status, category: cat,
        message: human(cat, msg, code), rawResponse: b, timestamp: cfg.now ? cfg.now() : '' });
    }
    /* A 200 carrying status:FAILURE is an error, not a success. */
    function call(req) {
      return GSP.callWith(A, transport, req, mapError).then(function (out) {
        if (out.ok && out.body && String(out.body.status).toUpperCase() === 'FAILURE') {
          return { ok: false, error: mapError({ status: out.status, body: out.body }) };
        }
        return out;
      });
    }
    var EWB = '/irisgst/topaz/api/v0.3/ewb';

    var A = {
      name: 'iris', env: cfg.env || 'sandbox',
      verified: false,     /* health probe answered, but no AUTHENTICATED call yet */
      capabilities: { closeEWB: true, extendEWB: true, healthCheck: true, govtSchema: false },

      authenticate: function () {
        if (!creds.email || !creds.password) return Promise.resolve({ ok: false, error: err({ provider: 'iris',
          category: 'AUTH', code: 'NO_CREDENTIALS', message: 'No IRIS credentials are configured.' }) });
        return call({ method: 'POST', url: host + '/irisgst/mgmt/login',
                      headers: { 'Content-Type': 'application/json' },
                      body: { email: creds.email, password: creds.password } });
      },
      getToken: function () { return Promise.resolve(creds.token ? { ok: true, token: '[redacted]' }
        : { ok: false, error: err({ provider: 'iris', category: 'AUTH', code: 'NO_CREDENTIALS', message: 'No IRIS token is configured.' }) }); },

      generateEInvoice: function (inv, o) { o = o || {};
        return call({ method: 'POST', url: host + '/irisgst/onyx/irn/addInvoice', headers: headers(o.gstin), body: inv }); },
      cancelEInvoice: function (p, o) { o = o || {};
        return call({ method: 'PUT', url: host + '/irisgst/onyx/irn/cancel', headers: headers(o.gstin), body: p }); },
      getEInvoice: function (irn, o) { o = o || {};
        return call({ method: 'GET', url: host + '/irisgst/onyx/irn/getInvByIrn?irn=' + encodeURIComponent(irn), headers: headers(o.gstin) }); },

      generateEWayBill: function (p, o) { o = o || {};
        return call({ method: 'POST', url: host + EWB, headers: headers(o.gstin), body: p }); },
      /* update / extend / cancel / close are ONE endpoint with an action. */
      updateEWayBill: function (p, o) { o = o || {};
        return call({ method: 'PUT', url: host + EWB, headers: headers(o.gstin), body: Object.assign({ action: 'UPDATEVEHICLE' }, p) }); },
      extendEWayBill: function (p, o) { o = o || {};
        return call({ method: 'PUT', url: host + EWB, headers: headers(o.gstin), body: Object.assign({ action: 'EXTENDVALIDITY' }, p) }); },
      cancelEWayBill: function (p, o) { o = o || {};
        return call({ method: 'PUT', url: host + EWB, headers: headers(o.gstin), body: Object.assign({ action: 'CANCEL' }, p) }); },
      closeEWayBill: function (p, o) { o = o || {};
        return call({ method: 'PUT', url: host + EWB, headers: headers(o.gstin), body: Object.assign({ action: 'CLOSURE' }, p) }); },
      getEWayBill: function (ewbNo, o) { o = o || {};
        return call({ method: 'GET', url: host + '/irisgst/topaz/api/v0.3/getewb/' + encodeURIComponent(ewbNo), headers: headers(o.gstin) }); },

      /* The one genuinely working probe in this integration. */
      healthCheck: function () {
        return GSP.callWith(A, transport, { method: 'GET', url: irpHost + '/irisirpapi/v1.04/heartbeat/ping',
                                            headers: { Accept: 'text/plain' } }, mapError);
      },
      normalizeError: mapError
    };
    return A;
  }

  GSP.register('cleartax', cleartax);
  GSP.register('vayana', vayana);
  GSP.register('iris', iris);

  var api = { cleartax: cleartax, vayana: vayana, iris: iris, human: human };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLGspAdapters = api;
})(typeof window !== 'undefined' ? window : globalThis);
