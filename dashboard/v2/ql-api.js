/* ═══════════════════════════════════════════════════════════════
   QuickLimes API client — a drop-in replacement for supabase-js.

   It exposes window.supabase.createClient() returning an object with
   the exact .rpc(fn, params) → { data, error } contract the app already
   uses, but backed by the PHP API on Hostinger instead of Supabase.

   Because the interface is identical, NO calling code changes: pages
   just load this file instead of the supabase-js CDN bundle.

   Supported RPCs: login_plant, get_my_data, save_my_data, update_my_plant.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // The API lives on the app subdomain. The app pages are same-origin;
  // the login page (quicklimes.com) reaches it cross-origin via CORS.
  var API = (function () {
    var h = location.hostname;
    if (h === 'app.quicklimes.com') return '/api/';
    return 'https://app.quicklimes.com/api/';
  })();

  function token() {
    try { return (JSON.parse(localStorage.getItem('ql_plant') || 'null') || {}).token || ''; }
    catch (_) { return ''; }
  }

  // fetch → { data, error }. Any JSON body (even an error payload) comes back
  // as `data`; only transport / non-JSON failures set `error`.
  async function jfetch(url, opts) {
    var res, json;
    try { res = await fetch(url, opts); }
    catch (e) { return { data: null, error: { message: 'Network error' } }; }
    /* 401 = this session is DEAD (expired, or the account it names is gone
       because a company removal promoted a new main / deleted the account).
       Every RPC funnels through here, so this is the one place that can catch
       it on EVERY device — not just the tab that pressed Remove. Without it a
       stale phone keeps showing the books and silently drops every edit. */
    if (res.status === 401) { try { if (window.QLAuthLost) window.QLAuthLost(); } catch (_) {} }
    try { json = await res.json(); }
    catch (_) { return { data: null, error: { message: 'Bad response (' + res.status + ')' } }; }
    return { data: json, error: null, status: res.status };
  }

  var JSON_HDR = { 'Content-Type': 'application/json' };

  async function rpc(fn, params) {
    params = params || {};

    if (fn === 'login_plant') {
      // Pass the server payload straight through: the login page reads
      // data.error for a bad password and data.success on success.
      return jfetch(API + 'login.php', {
        method: 'POST', headers: JSON_HDR,
        body: JSON.stringify({ p_owner_phone: params.p_owner_phone, p_password: params.p_password })
      });
    }

    if (fn === 'signup_plant') {
      // Create a brand-new account. The signup page reads data.error for a
      // taken phone / bad input, then calls login_plant on success.
      return jfetch(API + 'signup.php', {
        method: 'POST', headers: JSON_HDR,
        body: JSON.stringify({
          p_plant_name: params.p_plant_name, p_plant_type: params.p_plant_type,
          p_owner_phone: params.p_owner_phone, p_password: params.p_password,
          // The firm's own GSTIN — what tells OUR bills from a supplier's.
          // This list is a whitelist, so a field missing here is dropped silently.
          p_gst_number: params.p_gst_number || null
        })
      });
    }

    if (fn === 'get_my_data') {
      var r = await jfetch(API + 'data.php?plant_id=' + encodeURIComponent(params.p_plant_id) +
        '&token=' + encodeURIComponent(token()), { method: 'GET' });
      // Callers expect an array of rows; surface an { error } object as a real error.
      if (r.data && !Array.isArray(r.data) && r.data.error) return { data: null, error: { message: r.data.error } };
      return r;
    }

    if (fn === 'save_my_data') {
      var body = { p_plant_id: params.p_plant_id, p_id: params.p_id, p_data: params.p_data, token: token() };
      // base_rev drives the server's optimistic-concurrency check (audit M2).
      // Omitted by an old client → the server never blocks it. undefined must
      // not become the string "undefined", so only attach a real number.
      if (typeof params.base_rev === 'number') body.base_rev = params.base_rev;
      var s = await jfetch(API + 'data.php', { method: 'POST', headers: JSON_HDR, body: JSON.stringify(body) });
      if (s.data && s.data.error) return { data: null, error: { message: s.data.error } };
      return s;   // s.data is { success, rev } OR { conflict, rev, data } — the caller reads it
    }

    if (fn === 'update_my_plant') {
      // The frontend checks both `error` and `data.error`, so pass through.
      return jfetch(API + 'plant.php', {
        method: 'POST', headers: JSON_HDR,
        body: JSON.stringify(Object.assign({}, params, { token: token() }))
      });
    }

    // Self-service company management. add_my_company creates a child company
    // (GSTIN required); remove_my_company deletes a secondary company + its
    // data. Both hit /api/company.php, distinguished by `action`. Pass through
    // so the caller reads data.success / data.error like the others.
    if (fn === 'add_my_company' || fn === 'remove_my_company') {
      var action = fn === 'remove_my_company' ? 'remove' : 'add';
      return jfetch(API + 'company.php', {
        method: 'POST', headers: JSON_HDR,
        body: JSON.stringify(Object.assign({ action: action }, params, { token: token() }))
      });
    }

    return { data: null, error: { message: 'Unknown RPC: ' + fn } };
  }

  // Same shape as supabase-js: window.supabase.createClient(url, key) → { rpc }.
  window.supabase = {
    createClient: function () { return { rpc: rpc }; }
  };
})();
