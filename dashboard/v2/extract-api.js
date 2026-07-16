/* ═══════════════════════════════════════════════════════════════════════
   QuickLimes — AI extraction client (window.QLExtractAPI).
   Builds a bill's embedded text + page images, calls /api/extract (key stays
   server-side), validates the result with QLExtract, and returns it in the SAME
   generic shape the bulk review drawer already understands. Party master +
   corrections load from /api/parties. Any failure/no-key ⇒ returns null so the
   caller uses the offline regex parser — but the REASON is recorded on status(),
   because a silent fallback is how a valid key sat in config for weeks while every
   upload quietly used the regex reader. Same auth as recon-api (ql_plant token).
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var F = function () { return window.QLFin; };
  var V = function () { return window.QLExtract; };

  function base() { var h = location.hostname; return (h === 'app.quicklimes.com' || h === 'localhost' || h === '127.0.0.1') ? '/api/' : 'https://app.quicklimes.com/api/'; }
  function plant() { try { return JSON.parse(localStorage.getItem('ql_plant') || 'null') || {}; } catch (_) { return {}; } }
  function token() { return plant().token || ''; }
  function plantId() { return plant().id || ''; }
  function companyId() { try { return (window.QLD && QLD.activeCo) || ''; } catch (_) { return ''; } }
  function ready() { return !!(plantId() && token()); }

  async function post(path, body, ms) {
    var ctl = new AbortController(); var to = setTimeout(function () { ctl.abort(); }, ms || 90000);
    try {
      var r = await fetch(base() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ plant_id: plantId(), company_id: companyId(), token: token() }, body)), signal: ctl.signal });
      return await r.json();
    } catch (e) { return { ok: false, error: 'network' }; }
    finally { clearTimeout(to); }
  }

  /* ── party master + corrections (cached per session) ── */
  var _master = null, _corr = null;
  async function loadMaster() {
    if (_master) return { master: _master, corrections: _corr };
    _master = {}; _corr = {};
    try {
      var r = await fetch(base() + 'parties?plant_id=' + encodeURIComponent(plantId()) + '&company_id=' + encodeURIComponent(companyId()) + '&token=' + encodeURIComponent(token()));
      var j = await r.json();
      if (j && j.master) _master = j.master; if (j && j.corrections) _corr = j.corrections;
    } catch (_) {}
    return { master: _master, corrections: _corr };
  }
  function saveParty(gstin, legalName, alias) { if (ready() && gstin && legalName) { if (_master) _master[gstin] = legalName; post('parties', { action: 'save_party', gstin: gstin, legal_name: legalName, alias: alias || '' }, 15000); } }
  function correct(scopeKey, field, value) { if (ready() && scopeKey && field) post('parties', { action: 'correct', scope_key: scopeKey, field: field, value: value || '' }, 15000); }
  async function dedup(fileHash, invKey) { if (!ready()) return { dupFile: false, dupInv: false }; var r = await post('parties', { action: 'dedup', file_hash: fileHash || '', inv_key: invKey || '' }, 15000); return r && !r.error ? r : { dupFile: false, dupInv: false }; }
  function mark(fileHash, invKey, kind, source) { if (ready() && fileHash) post('parties', { action: 'mark', file_hash: fileHash, inv_key: invKey || '', kind: kind || '', source: source || '' }, 15000); }

  async function fileHash(file) {
    try { var buf = await file.arrayBuffer(); var h = await crypto.subtle.digest('SHA-256', buf); return Array.from(new Uint8Array(h)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
    catch (_) { return ''; }
  }

  /* ── WHY the AI didn't fire ─────────────────────────────────
     Returning null is how this client says "use the regex parser", and that null
     used to be the end of the story: no key configured, wrong endpoint, blocked
     prompt and dead network all looked identical from the outside — a bill that
     just quietly read a bit worse. The owner had a VALID Gemini key sitting in
     config while every upload silently used the offline parser, and nothing in the
     app could tell him. The fallback stays; the silence does not.

     Last one wins: this is a status light, not a log. */
  var _last = null;
  function note(ok, reason, res) {
    _last = { ok: !!ok, reason: reason || '', at: Date.now(),
      provider: (res && res.provider) || '', model: (res && res.model) || '' };
    return _last;
  }
  /* Human-readable, because the person reading it configured the key and is trying
     to work out why nothing happened. */
  var WHY = {
    llm_not_configured: 'no AI key is configured on the server',
    ai_unavailable: 'the AI service could not be reached',
    ai_bad_response: 'the AI replied in a shape we could not read',
    network: 'the request never reached the server'
  };
  function explain(r) {
    if (!r) return 'the request never reached the server';
    var e = String(r.error || '');
    if (WHY[e]) return WHY[e];
    if (e.indexOf('llm_unknown_provider:') === 0) return 'the server has an unknown AI provider configured (' + e.split(':')[1] + ')';
    if (e.indexOf('ai_no_result:') === 0) return 'the AI returned no result (' + e.split(':')[1] + ')';
    return e || 'the AI did not answer';
  }
  function status() { return _last; }

  /* ── extract ONE bill via AI; returns a legacy `g` (generic keys + _conf/
     _review/_warn) that bulk.js makeBill already consumes, or null to fall back. */
  async function extract(file, kind) {
    if (!ready() || !V()) return null;
    var name = (file.name || '').toLowerCase(), type = file.type || '';
    var isPdf = name.endsWith('.pdf') || type === 'application/pdf';
    var isImg = /^image\//.test(type) || /\.(png|jpe?g|webp|gif)$/.test(name);
    if (!isPdf && !isImg) return null;                        // spreadsheets don't use AI
    var text = '', images = [];
    try {
      if (isPdf) {
        var pages = await F().pdfPages(file);
        text = (pages || []).join('\n');
        var hasText = text && text.replace(/\s+/g, '').length > 80;
        if (!hasText) { var imgs = await F().pdfToImages(file, 2); images = imgs.map(toImg).filter(Boolean).slice(0, 3); }
      } else {
        images = [await blobToImg(file)].filter(Boolean);
      }
    } catch (_) {}
    if (!text && !images.length) return null;

    var res = await post('extract', { kind: kind || '', fileName: file.name || '', text: text, images: images }, 95000);
    if (!res || res.ok !== true || !res.data) { note(false, explain(res), res); return null; }  // fall back, but SAY SO
    note(true, '', res);

    var mc = await loadMaster();
    var own = []; try { var oi = F().ownInfo(); own = oi.ownGstins || []; } catch (_) {}
    var vr = V().validate(res.data, { ownGstins: own, master: mc.master, hint: kind });
    return toLegacy(vr, text, kind, res.data);
  }

  function toImg(dataUrl) { var m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(dataUrl || ''); return m ? { media: m[1], b64: m[2] } : null; }
  function blobToImg(file) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(toImg(r.result)); }; r.onerror = function () { res(null); }; r.readAsDataURL(file); }); }

  var CL = { high: 0.97, medium: 0.8, low: 0.4, none: 0 };
  /* Map validated fields → the generic keys the review UI uses. For a SALES doc
     the recorded counterparty is the customer (buyer); for a PURCHASE it's the
     supplier. GST% is authoritative from the tax math. */
  function toLegacy(vr, text, kind, rawAI) {
    var f = vr.fields, isSales = vr.cls.kind === 'sales';
    var party = isSales ? { name: vr.buyerParty.name || f.buyerName, gstin: f.buyerGstin } : { name: f.supplierName, gstin: f.supplierGstin };
    var g = {
      _ai: true, _text: text || '', _fields: rawAI, _warn: vr.issues || [], _cls: vr.cls, _dupKey: vr.dupKey, _status: vr.status,
      dir: (vr.cls && (vr.cls.kind === 'sales' || vr.cls.kind === 'purchase')) ? vr.cls.kind : '',
      docno: f.invoiceNo || '', date: f.invoiceDate || '', name: party.name || '', gstin: party.gstin || '',
      taxable: f.taxable != null ? f.taxable : '', total: f.grandTotal != null ? f.grandTotal : '', rate: f.gstRate != null ? f.gstRate : '',
      cgst: f.cgst, sgst: f.sgst, igst: f.igst, roundoff: f.roundOff, totalgst: vr.totalTax,
      qty: '', veh: f.vehicleNo || '', eway: f.ewayBillNo || '',
      itc: vr.isCredit ? 'Ineligible' : (f.reverseCharge ? 'RCM' : 'Eligible'),
      group: '', item: ''
    };
    // group/item from the AI category (mapped by cfg.buildRow downstream)
    try {
      var li = (rawAI.lineItems || [])[0] || {};
      g.group = (li.category || '') + ''; g.item = (li.name || li.category || '') + '';
      if (li.qty != null) g.qty = li.qty; g.hsn = li.hsn || '';
    } catch (_) {}
    // confidence + review, keyed to the GENERIC keys makeBill reads
    var GEN = { invoiceNo: 'docno', invoiceDate: 'date', supplierName: 'name', buyerName: 'name', supplierGstin: 'gstin', buyerGstin: 'gstin', taxable: 'taxable', grandTotal: 'total', gstRate: 'rate', vehicleNo: 'veh' };
    var conf = {}, ver = {}, review = [];
    Object.keys(vr.conf || {}).forEach(function (k) { var gk = GEN[k]; if (!gk) return; conf[gk] = Math.max(conf[gk] || 0, CL[vr.conf[k]] || 0); });
    (vr.review || []).forEach(function (k) { var gk = GEN[k] || k; if (review.indexOf(gk) < 0) review.push(gk); });
    Object.keys(conf).forEach(function (gk) { ver[gk] = 'ai'; });
    if (vr.party && vr.party.source === 'master') { conf.name = 0.98; ver.name = 'party_master'; }
    g._conf = conf; g._verify = ver; g._review = review;
    return g;
  }

  window.QLExtractAPI = { extract: extract, ready: ready, status: status, loadMaster: loadMaster, saveParty: saveParty, correct: correct, dedup: dedup, mark: mark, fileHash: fileHash };
})();
