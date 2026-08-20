/* ═══════════════════════════════════════════════════════════════════════
   party-link.js — ONE way to reach a customer, from anywhere.

   THE PROBLEM THIS SOLVES
   The finance portal already existed (ledger.html) and almost nothing
   linked to it: 18 party references in the Sales register, 11 in
   Collections, 9 in Payments, 6 in the Cash book, 3 on the Dashboard —
   and not one was clickable. Four links existed in the entire app.

   So this is not a new screen. It is REACH. One component, used in every
   module, so a customer name is always a way in and never just text.

   IDENTITY IS GSTIN-FIRST
   A row usually carries a NAME, and a name is not an identity — this
   codebase has already proved it, twice. 'AMAN LIME PRODUCTS' and 'AMAN
   ENTERPRISES' are different companies; 'DESHWALI MINERALS' is the
   owner's own firm while 'DESHWALI LIME INDUSTRIES' is a real customer.
   So resolution tries GSTIN first and only falls back to an exact
   normalised name. An ambiguous name resolves to NOTHING rather than to
   a plausible wrong customer, and the chip renders unlinked with the
   reason — because sending someone to the wrong ledger is worse than
   sending them nowhere.

   ROUTING IS BY STABLE ID
   ledger.html?id=<party id>, never ?party=<array index>. An index means
   "the 10th row" and silently repoints when the list changes.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var P = root.QLParty || null;                    // party-identity.js
  var normG = function (g) { return P && P.normGstin ? P.normGstin(g) : String(g == null ? '' : g).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  var normN = function (n) { return P && P.normName ? P.normName(n) : String(n == null ? '' : n).toUpperCase().replace(/\s+/g, ' ').trim(); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /* Built once per render pass, not per row: a 161-row register would
     otherwise rebuild the index 161 times. */
  var _cache = null, _cacheAt = 0;
  function index() {
    var now = (root.performance && root.performance.now) ? root.performance.now() : 0;
    if (_cache && (now - _cacheAt) < 2000) return _cache;
    var rows = (root.QLD && root.QLD.partyRows) ? root.QLD.partyRows() : [];
    var byG = {}, byN = {}, ambN = {};
    rows.forEach(function (r) {
      var g = normG(r.gstin); if (g) byG[g] = r;
      var n = normN(r.name);
      if (!n) return;
      if (byN[n] && byN[n].id !== r.id) ambN[n] = true;   // two parties, one name
      else byN[n] = r;
    });
    _cache = { rows: rows, byG: byG, byN: byN, ambN: ambN }; _cacheAt = now;
    return _cache;
  }
  function invalidate() { _cache = null; }

  /* resolve({name, gstin}) -> {party, how, why} | null
     `how` is 'gstin' | 'name' | null so a caller can show its confidence. */
  function resolve(ref) {
    ref = ref || {};
    var ix = index();
    var g = normG(ref.gstin);
    if (g && ix.byG[g]) return { party: ix.byG[g], how: 'gstin', why: '' };
    var n = normN(ref.name);
    if (!n) return null;
    if (ix.ambN[n]) return { party: null, how: null, why: 'more than one customer is saved under this name' };
    if (ix.byN[n]) return { party: ix.byN[n], how: 'name', why: g ? 'matched by name — the GSTIN on this row is not on file' : '' };
    return null;
  }

  function financeUrl(p) { return './ledger.html?id=' + encodeURIComponent(p.id || '') + (p.id ? '' : '&party=' + p.idx); }
  function profileUrl(p) { return './parties.html?open=' + encodeURIComponent(p.id || p.idx); }

  /* ── the chip ────────────────────────────────────────────────────────
     Renders the name as it appears ON THE ROW (never the master's spelling
     — the row is the document of record), with a link when we are sure who
     it is. opts.plain returns text only, for exports and print. */
  function chip(ref, opts) {
    opts = opts || {};
    var shown = esc(ref && ref.name ? ref.name : '—');
    if (opts.plain) return shown;
    var r = resolve(ref);
    if (!r || !r.party) {
      var why = r && r.why ? r.why : 'not in the customer list yet';
      return '<span class="pl-x" title="' + esc(why) + '">' + shown + '</span>';
    }
    var p = r.party;
    return '<a class="pl" href="' + financeUrl(p) + '" data-pl-id="' + esc(p.id || '') + '" data-pl-idx="' + p.idx +
           '" title="' + esc(p.name + (p.gstin ? ' · ' + p.gstin : '') + ' — open finance portal') + '">' +
           shown + '</a>';
  }

  /* Row-action entries for a QLX rowMenu, so every register gets the same
     four choices without copying them. */
  function actions(ref) {
    var r = resolve(ref);
    if (!r || !r.party) return [];
    var p = r.party;
    return [
      { label: 'Finance portal', onClick: function () { location.href = financeUrl(p); } },
      { label: 'Customer profile', onClick: function () { location.href = profileUrl(p); } },
      { label: 'Record receipt', onClick: function () { location.href = './payments.html?party=' + encodeURIComponent(p.id || p.idx); } }
    ];
  }

  /* A compact context header for any screen showing ONE customer's record. */
  function header(ref) {
    var r = resolve(ref);
    if (!r || !r.party) return '';
    var p = r.party, led = null;
    try { led = root.QLD && root.QLD.partyLedger ? root.QLD.partyLedger(p.idx, {}) : null; } catch (_) {}
    var bal = led && led.closing != null ? led.closing : null;
    var money = function (n) { return '₹' + Math.round(Math.abs(n || 0)).toLocaleString('en-IN'); };
    return '<div class="pl-hdr"><div><b>' + esc(p.name) + '</b>' +
      (p.gstin ? '<span class="pl-g">GSTIN ' + esc(p.gstin) + '</span>' : '') + '</div>' +
      (bal != null ? '<div class="pl-bal ' + (bal > 0 ? 'dr' : bal < 0 ? 'cr' : '') + '">' + money(bal) +
        (bal > 0 ? ' Dr · they owe you' : bal < 0 ? ' Cr · you owe them' : ' · settled') + '</div>' : '') +
      '<a class="ql-btn ql-btn-secondary" href="' + financeUrl(p) + '">Finance portal →</a></div>';
  }


  /* Which customer does this URL mean?  Shared by every page that opens a
     single customer, so the answer is the same everywhere and testable.

     Two rules earned by a real bug:
       · ?id (stable) beats ?party (an array POSITION that moves).
       · An EMPTY party list means "not loaded yet", never "not found". The
         ledger page resolved before the company blob had hydrated, found an
         empty list, and fell back to index 0 — so every id link opened row
         0's customer. Callers must resolve when data is ready; if they call
         early, this returns notReady rather than a confident wrong answer. */
  function route(search, rows) {
    var qs = new (root.URLSearchParams || URLSearchParams)(String(search || '').replace(/^\?/, ''));
    var wantId = qs.get('id'), n = parseInt(qs.get('party'), 10);
    var idx = isNaN(n) ? 0 : n;
    if (wantId) {
      if (!rows || !rows.length) return { idx: idx, notReady: true, badId: '' };
      for (var i = 0; i < rows.length; i++) if (rows[i].id === wantId) return { idx: rows[i].idx, notReady: false, badId: '' };
      return { idx: idx, notReady: false, badId: wantId };
    }
    return { idx: idx, notReady: false, badId: '' };
  }

  var api = { route: route, chip: chip, actions: actions, header: header, resolve: resolve,
              financeUrl: financeUrl, profileUrl: profileUrl, invalidate: invalidate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLPartyLink = api;
})(typeof window !== 'undefined' ? window : globalThis);
