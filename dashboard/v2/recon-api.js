/* ═══════════════════════════════════════════════════════════════════════
   QLReconAPI — thin client for the relational bank-reconciliation store
   (/api/recon). Phase 2 cutover, rolled out safely:

     • mirror()  — dual-WRITE: every local save is ALSO pushed to the
                   relational tables. Fire-and-forget + try/catch, so a
                   backend hiccup can never break the page. The JSON blob
                   stays authoritative until reads are flipped.
     • pull()    — read the relational store (for the read-cutover). Returns
                   null on any failure so callers fall back to the blob.

   Reuses the same auth as ql-api.js: token from localStorage 'ql_plant',
   API base '/api/' on the app subdomain (absolute elsewhere).
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  function base() {
    var h = location.hostname;
    if (h === 'app.quicklimes.com') return '/api/';
    if (h === 'localhost' || h === '127.0.0.1') return '/api/';   // local/dev proxy
    return 'https://app.quicklimes.com/api/';
  }
  function plant() { try { return JSON.parse(localStorage.getItem('ql_plant') || 'null') || {}; } catch (_) { return {}; } }
  function token() { return plant().token || ''; }
  function plantId() { return plant().id || ''; }
  function ready() { return !!(plantId() && token()); }

  // Clean endpoint (no .php) — the rewrite resolves it; POST-safe.
  function url() { return base() + 'recon'; }

  async function post(companyId, body) {
    if (!ready() || !companyId) return null;
    var payload = Object.assign({ plant_id: plantId(), company_id: companyId, token: token() }, body);
    try {
      var res = await fetch(url(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) { return null; }
  }

  var timer = null, pending = null;
  // Debounced dual-write of the whole recon state for a company. Safe to spam.
  function mirror(companyId, recon) {
    if (!ready() || !companyId || !recon) return;
    pending = { companyId: companyId, recon: recon };
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      var job = pending; pending = null;
      if (!job) return;
      var txns = (job.recon.txns || []).map(function (t) {
        return {
          id: t.id, date: t.date, raw: t.raw || t.desc || '', clean: t.clean || '',
          utr: t.utr || '', cheque: t.cheque || '', mode: t.mode || '', bank: t.bank || '',
          debit: t.debit || 0, credit: t.credit || 0, balance: t.balance != null ? t.balance : null,
          dedupe_key: t.dedupe_key || '', m: t.m || null
        };
      });
      if (txns.length) post(job.companyId, { action: 'upsert_txns', txns: txns });
      var aliases = job.recon.aliases || {};
      Object.keys(aliases).forEach(function (k) { post(job.companyId, { action: 'learn_alias', alias_key: k, party: aliases[k] }); });
    }, 1500);
  }

  // Read the relational store. Returns { txns, aliases, accounts, total } or null.
  async function pull(companyId, opts) {
    if (!ready() || !companyId) return null;
    opts = opts || {};
    var qs = 'plant_id=' + encodeURIComponent(plantId()) + '&company_id=' + encodeURIComponent(companyId) +
      '&token=' + encodeURIComponent(token());
    if (opts.month) qs += '&month=' + encodeURIComponent(opts.month);
    if (opts.status) qs += '&status=' + encodeURIComponent(opts.status);
    if (opts.type) qs += '&type=' + encodeURIComponent(opts.type);
    if (opts.q) qs += '&q=' + encodeURIComponent(opts.q);
    if (opts.limit) qs += '&limit=' + opts.limit;
    try {
      var res = await fetch(url() + '?' + qs, { method: 'GET' });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) { return null; }
  }

  window.QLReconAPI = { mirror: mirror, pull: pull, ready: ready };
})();
