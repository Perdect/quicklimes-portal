/* ═══════════════════════════════════════════════════════════════════════
   gsp-health.js — provider status, and the retry policy for statutory
   documents.  Pure. Node-testable.

   TWO RULES, BOTH LEARNED FROM WHAT GOES WRONG IN PRODUCTION.

   1. NEVER SHOW A FALSE GREEN.
      ClearTax publishes no health endpoint. The honest answer is then
      UNKNOWN — "we cannot verify provider health" — which is a different
      statement from "provider is healthy" and must render differently.
      A dashboard that shows green because it has nothing to show is worse
      than one showing a question mark: it stops people checking.

   2. A LOST RESPONSE IS NOT A FAILED REQUEST.
      If generateEInvoice times out, the IRN may already exist at the IRP.
      Retrying blind mints a second statutory document for one sale. So
      GENERATE operations are never auto-retried on a network error — the
      only safe move is to go and LOOK (getEInvoice / getEWayBill by the
      document key) and let the answer decide. That reconciliation step is
      the difference between an ERP and an accident.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* The full status vocabulary the ERP renders. */
  var STATUS = ['CONNECTED', 'DEGRADED', 'PROVIDER_DOWN', 'GSTN_DOWN', 'AUTH_FAILED', 'NOT_CONFIGURED', 'UNKNOWN'];
  var LABEL = {
    CONNECTED:      { text: 'Connected', tone: 'ok',   detail: 'The GST provider answered normally.' },
    DEGRADED:       { text: 'Slow',      tone: 'warn', detail: 'The provider is responding, but slowly. Filing may take longer than usual.' },
    PROVIDER_DOWN:  { text: 'Provider down', tone: 'bad', detail: 'The GST provider is not responding. Filing is paused.' },
    GSTN_DOWN:      { text: 'Government system down', tone: 'bad', detail: 'The provider is up but the government system is not. Nothing can be filed until it returns.' },
    AUTH_FAILED:    { text: 'Credentials rejected', tone: 'bad', detail: 'The provider rejected our credentials. Filing is paused until they are corrected.' },
    NOT_CONFIGURED: { text: 'Not connected', tone: 'mut', detail: 'No GST provider is configured yet.' },
    /* Deliberately NOT green. */
    UNKNOWN:        { text: 'Cannot verify', tone: 'mut', detail: 'This provider offers no health check, so its status cannot be confirmed without attempting a filing.' }
  };

  /* Probe result -> status. `supportsHealth` is the honesty switch: a
     provider with no health endpoint can never reach CONNECTED from a
     probe alone, only from a real call that actually succeeded. */
  function assess(o) {
    o = o || {};
    if (!o.configured) return mk('NOT_CONFIGURED', o);
    if (o.lastError && o.lastError.category === 'AUTH') return mk('AUTH_FAILED', o);

    if (!o.supportsHealth) {
      /* No probe available. A recent SUCCESSFUL real call is the only
         evidence that counts — and it is evidence about the past, so it
         expires. */
      if (o.lastSuccessAgeMs != null && o.lastSuccessAgeMs <= (o.freshMs || 15 * 60 * 1000)) return mk('CONNECTED', o, 'last successful filing');
      if (o.lastError && o.lastError.category === 'NETWORK') return mk('PROVIDER_DOWN', o);
      if (o.lastError && o.lastError.category === 'PROVIDER') return mk('PROVIDER_DOWN', o);
      return mk('UNKNOWN', o);
    }

    /* A real health probe ran. */
    if (o.probe && o.probe.ok) {
      /* Vayana distinguishes its own health from GSTN's — use it. */
      if (o.probe.gstnDown) return mk('GSTN_DOWN', o);
      if (o.probe.latencyMs != null && o.probe.latencyMs > (o.slowMs || 3000)) return mk('DEGRADED', o, 'probe took ' + o.probe.latencyMs + 'ms');
      return mk('CONNECTED', o, 'health probe');
    }
    if (o.probe && o.probe.error) {
      var c = o.probe.error.category;
      if (c === 'AUTH') return mk('AUTH_FAILED', o);
      if (c === 'NETWORK' || c === 'PROVIDER') return mk('PROVIDER_DOWN', o);
      if (c === 'RATE_LIMIT') return mk('DEGRADED', o, 'rate limited');
    }
    return mk('UNKNOWN', o);
  }
  function mk(status, o, because) {
    var l = LABEL[status];
    return { status: status, label: l.text, tone: l.tone, detail: l.detail,
             because: because || '', provider: (o && o.provider) || '',
             canFile: status === 'CONNECTED' || status === 'DEGRADED' || status === 'UNKNOWN',
             /* UNKNOWN can still file — we just cannot promise it will work.
                Blocking on "cannot verify" would make ClearTax unusable. */
             verified: status === 'CONNECTED' && !!because };
  }

  /* ── retry policy ────────────────────────────────────────────────────
     op: 'generate' | 'cancel' | 'get' | 'update' | 'auth' | 'health'
     Returns what to DO, not merely whether the error was retryable. */
  var GENERATES = { generateEInvoice: 1, generateEWayBill: 1 };

  function retryPlan(op, error, attempt) {
    attempt = attempt || 1;
    var e = error || {};
    var creates = !!GENERATES[op];

    if (e.category === 'DUPLICATE') {
      return { action: 'stop', retry: false, reconcile: true,
        why: 'The government says this document already exists. Fetch it and store its reference — do not file again.' };
    }
    if (e.category === 'VALIDATION') {
      return { action: 'stop', retry: false, reconcile: false,
        why: 'The document was rejected on its contents. Retrying sends the identical payload and fails identically — fix the invoice.' };
    }
    if (e.category === 'AUTH') {
      return { action: 'reauth', retry: false, reconcile: false,
        why: 'Credentials were rejected. Re-authenticate; do not repeat the call with the same dead token.' };
    }
    /* THE CRITICAL ONE. A network failure on a CREATE means the outcome is
       genuinely unknown: the IRP may hold an IRN we never saw. */
    if (e.category === 'NETWORK' && creates) {
      return { action: 'reconcile', retry: false, reconcile: true,
        why: 'The connection dropped mid-filing, so the document may already exist at the IRP. Look it up by document number before any retry — a blind retry would create a second statutory record for one sale.' };
    }
    if (e.category === 'NETWORK' || e.category === 'PROVIDER' || e.category === 'RATE_LIMIT') {
      /* Safe to repeat: reads and idempotent operations. */
      if (attempt >= 4) return { action: 'stop', retry: false, reconcile: creates,
        why: 'Four attempts failed. Stopping so a human can look, rather than hammering the provider.' };
      return { action: 'retry', retry: true, reconcile: false,
        delayMs: Math.min(30000, 1000 * Math.pow(2, attempt - 1)),
        why: 'A transient provider or network problem on a repeatable operation.' };
    }
    return { action: 'stop', retry: false, reconcile: creates,
      why: 'The provider returned something we do not recognise. Stopping rather than guessing.' };
  }

  /* ── reconcile ───────────────────────────────────────────────────────
     After an unknown outcome, ASK the provider what exists before doing
     anything else. This is the function that prevents duplicate filings. */
  function reconcilePlan(rec) {
    rec = rec || {};
    if (rec.gov && (rec.gov.irn || rec.gov.ewbNo)) {
      return { action: 'already_have', why: 'We already hold a government reference for this document; nothing to reconcile.' };
    }
    if (rec.kind === 'ewb') {
      return { action: 'lookup', method: 'getEWayBill', by: 'docNo',
        why: 'Ask the provider whether an E-Way Bill already exists for this document before generating another.' };
    }
    return { action: 'lookup', method: 'getEInvoice', by: 'docNo',
      why: 'Ask the provider whether an IRN already exists for this document before generating another.' };
  }

  var api = { STATUS: STATUS, LABEL: LABEL, assess: assess, retryPlan: retryPlan,
              reconcilePlan: reconcilePlan, GENERATES: GENERATES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLGspHealth = api;
})(typeof window !== 'undefined' ? window : globalThis);
