/* ═══════════════════════════════════════════════════════════════════════
   QuickLimes — Bulk Bill Upload  (window.QLBulk)
   ───────────────────────────────────────────────────────────────────────
   Fast, "invisible" upload. Click → native file picker (no modal first) →
   background OCR with a small floating progress chip → then:
      • 1 bill  → right-side Review DRAWER (stay on the register page)
      • N bills → compact Bulk Review TABLE (row → same drawer)
   Reuses the tested QLFin engine (fileToRows / pdfPages / splitPdfPages /
   ocrScan / parseInvoiceText) and each register's own field config, so the
   single-file flow and the bulk flow share ONE extraction + posting path.

   Per-file: independent status; one failure never stops the batch.
   Auto-detect: purchase vs sales (own-GSTIN = buyer→purchase), plus credit/
   debit note, e-way bill and bank statement are recognised and held for
   review — never silently imported as an invoice.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LIMITS = { files: 100, perFileMB: 25, batchMB: 500 };
  var SEQ = 1;
  var BATCH = null;                          // { cfg, bills:[], total, done, url }
  var F = function () { return window.QLFin; };
  var toast = function (m, t) { if (window.QLShell && QLShell.toast) QLShell.toast(m, t); };
  function esc(s) { return (s == null ? '' : s).toString().replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function fC(n) { try { return window.QLD && QLD.fC ? QLD.fC(n) : '₹' + Math.round(+n || 0).toLocaleString('en-IN'); } catch (_) { return '₹' + Math.round(+n || 0); } }
  function num(v) { try { return F().parseNum(v) || 0; } catch (_) { return +String(v || '').replace(/[^0-9.\-]/g, '') || 0; } }

  /* Read a date the way the app does, WITHOUT depending on QLFin being loaded.
     The first version of the date gate called QLFin.parseDate and fell back to
     the RAW string when it was absent — which then failed the ISO check, so
     every bill came out invalid. A validator that blocks everything when a
     neighbour is missing is worse than no validator. Returns '' if genuinely
     unreadable; only then is the bill held. */
  function isoDate(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    try { if (window.QLFin && QLFin.parseDate) { var v = QLFin.parseDate(s); if (/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return v; } } catch (_) {}
    var m;
    if ((m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/)))                       // 2026-01-15
      return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) {              // 15/01/2026 · 15-01-2026
      var y = m[3].length === 2 ? '20' + m[3] : m[3];
      return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    }
    var MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    if ((m = s.match(/^(\d{1,2})[-\/ .]([A-Za-z]{3,})[-\/ .](\d{2,4})$/))) {           // 15-Jan-2026
      var mm = MON[m[2].slice(0, 3).toLowerCase()];
      if (mm) { var yy = m[3].length === 2 ? '20' + m[3] : m[3]; return yy + '-' + mm + '-' + m[1].padStart(2, '0'); }
    }
    return '';
  }

  /* which field key carries the doc-no / party name (reverse of ocrMap) */
  function invKey(cfg) { var m = cfg.ocrMap || {}; return Object.keys(m).filter(function (k) { return m[k] === 'docno'; })[0]; }
  function nameKey(cfg) { var m = cfg.ocrMap || {}; return Object.keys(m).filter(function (k) { return m[k] === 'name'; })[0]; }

  /* ── PUBLIC ENTRY — open the native picker immediately (no modal) ── */
  function open(cfg) {
    cfg = cfg || {};
    var inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true;
    inp.accept = cfg.accept || '.csv,.xlsx,.xls,.pdf,image/*,.zip';
    // folder pick where supported (Chromium) — harmless elsewhere
    try { if (cfg.folders !== false) { /* left off by default; folder picker hides normal files */ } } catch (_) {}
    inp.style.position = 'fixed'; inp.style.left = '-9999px';
    document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      var files = Array.from(inp.files || []);
      try { inp.remove(); } catch (_) {}
      if (files.length) start(files, cfg);
    });
    inp.click();
  }

  /* ── batch orchestration ── */
  async function start(files, cfg) {
    injectCSS();
    // enforce configurable limits, honestly
    var dropped = [];
    files = files.filter(function (f) {
      if (f.size > LIMITS.perFileMB * 1048576) { dropped.push(f.name + ' (>' + LIMITS.perFileMB + 'MB)'); return false; }
      return true;
    });
    if (files.length > LIMITS.files) { dropped.push((files.length - LIMITS.files) + ' file(s) over the ' + LIMITS.files + '-file limit'); files = files.slice(0, LIMITS.files); }
    var totalMB = files.reduce(function (a, f) { return a + f.size; }, 0) / 1048576;
    if (totalMB > LIMITS.batchMB) { toast('Batch is ' + Math.round(totalMB) + 'MB — over the ' + LIMITS.batchMB + 'MB limit. Upload fewer files.', 'err'); return; }

    // unzip any archives → flat supported-file list
    var flat = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (/\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') {
        try { var inner = await unzip(f); flat = flat.concat(inner); } catch (e) { dropped.push(f.name + ' (couldn\'t open zip)'); }
      } else flat.push(f);
    }
    if (!flat.length) { toast('No readable files found' + (dropped.length ? ' — ' + dropped.length + ' skipped' : ''), 'err'); return; }

    /* t0 scopes the AI status check to THIS import. QLExtractAPI.status() is
       last-one-wins and outlives a batch, so without a start time a spreadsheet-only
       import (where the AI is never called) would inherit the previous import's
       failure and report the AI as off when it was never asked. */
    BATCH = { cfg: cfg, bills: [], total: flat.length, done: 0, dropped: dropped, t0: Date.now() };
    showProgress();
    // sequential (Tesseract is heavy) but fully async — the page stays live.
    for (var j = 0; j < flat.length; j++) {
      var file = flat[j];
      try {
        var got = await processFile(file, cfg);
        got.forEach(function (b) { BATCH.bills.push(b); });
      } catch (e) {
        BATCH.bills.push(failBill(file, cfg, 'Could not read this file'));
      }
      BATCH.done = j + 1;
      updateProgress(file.name);
    }
    finishBatch(cfg);
  }

  async function unzip(file) {
    var JSZip = await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'JSZip');
    var zip = await JSZip.loadAsync(file);
    var out = [], names = Object.keys(zip.files);
    for (var i = 0; i < names.length; i++) {
      var entry = zip.files[names[i]];
      if (entry.dir) continue;
      var nm = names[i].split('/').pop();
      if (!/\.(pdf|png|jpe?g|webp|gif|bmp|tiff?|csv|xlsx|xls)$/i.test(nm)) continue;
      if (/^__MACOSX/.test(names[i]) || /^\./.test(nm)) continue;
      var blob = await entry.async('blob');
      out.push(new File([blob], nm, { type: blob.type || '' }));
    }
    return out;
  }

  function loadScript(src, globalKey) {
    return new Promise(function (res, rej) {
      if (window[globalKey]) return res(window[globalKey]);
      var s = document.createElement('script'); s.src = src;
      s.onload = function () { window[globalKey] ? res(window[globalKey]) : rej(new Error('load')); };
      s.onerror = rej; document.head.appendChild(s);
    });
  }

  /* ── read ONE file → 0..N bills (independent; never throws to caller) ── */
  async function processFile(file, cfg) {
    var name = (file.name || '').toLowerCase(), type = file.type || '';
    var isImg = /^image\//.test(type) || /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/.test(name);
    var isPdf = name.endsWith('.pdf') || type === 'application/pdf';
    var isSheet = /\.(csv|xlsx|xls)$/.test(name) || /csv|excel|spreadsheet/.test(type);
    var bills = [];

    var aiReady = window.QLExtractAPI && QLExtractAPI.ready();
    // AI on ONE file (a whole file or a single split page) → g, or null to fall back.
    async function aiOne(f) { if (!aiReady) return null; try { return await QLExtractAPI.extract(f, cfg.kind); } catch (_) { return null; } }

    if (isPdf) {
      var pages = [];
      try { pages = await F().pdfPages(file); } catch (_) {}
      var hasText = function (t) { return t && /\d/.test(t) && t.replace(/\s+/g, '').length > 60; };
      var textPages = [];
      pages.forEach(function (t, i) { if (hasText(t)) textPages.push({ text: t, page: i }); });

      // MULTI-invoice PDF (2+ text pages): split, then read EACH page independently
      // — AI per page when configured, else the tested regex per-page parser.
      if (textPages.length >= 2) {
        var slices = [];
        try { slices = await F().splitPdfPages(file, textPages.map(function (x) { return x.page; }), name.replace(/\.[^.]+$/, '')); } catch (_) {}
        for (var pi = 0; pi < textPages.length; pi++) {
          var pf = slices[pi] || file, src = file.name + ' · page ' + (textPages[pi].page + 1);
          var pg = (slices[pi] ? await aiOne(slices[pi]) : null) || F().parseInvoiceText(textPages[pi].text);
          bills.push(makeBill(pg, pf, src, cfg));
        }
        inheritParty(bills, cfg);      // same-PDF pages share a supplier → fill the unread ones
        return bills;
      }

      // Single-invoice PDF: AI whole-file → else embedded text → else scanned OCR.
      if (textPages.length === 1) {
        var g0 = await aiOne(file); if (!g0) g0 = F().parseInvoiceText(textPages[0].text);
        bills.push(makeBill(g0, file, file.name, cfg)); return bills;
      }
      var gs = await aiOne(file);
      if (gs) { bills.push(makeBill(gs, file, file.name, cfg)); return bills; }
      try { var g1 = await F().ocrScan(file, function () {}); bills.push(makeBill(g1, file, file.name, cfg)); }
      catch (_) { bills.push(failBill(file, cfg, 'OCR failed on this scan')); }
      return bills;
    }

    if (isImg) {
      var gi = await aiOne(file);
      if (gi) { bills.push(makeBill(gi, file, file.name, cfg)); return bills; }
      try { var g2 = await F().ocrScan(file, function () {}); bills.push(makeBill(g2, file, file.name, cfg)); }
      catch (_) { bills.push(failBill(file, cfg, 'Couldn\'t read this photo — try a clearer, straight shot')); }
      return bills;
    }

    if (isSheet) {
      var parsed;
      try { parsed = await F().fileToRows(file); } catch (_) { return [failBill(file, cfg, 'Couldn\'t read the spreadsheet')]; }
      var rows = parsed.rows || [];
      if (rows.length < 2) return [failBill(file, cfg, 'No rows found — need a header + one row per bill')];
      var hi = cfg.headerGroups ? F().findHeaderRow(rows, cfg.headerGroups) : -1;
      if (hi < 0) hi = 0;
      var mapping = cfg.autoMap ? cfg.autoMap(rows[hi] || []) : {};
      for (var r = hi + 1; r < rows.length; r++) {
        var row = rows[r]; if (!row) continue;
        var get = (function (rr) { return function (k) { var idx = mapping[k]; return (idx != null && idx >= 0 && idx < rr.length) ? rr[idx] : ''; }; })(row);
        var built; try { built = cfg.buildRow(get); } catch (_) { built = null; }
        if (built) bills.push(makeSheetBill(built, file.name + ' · row ' + r, cfg));
      }
      return bills.length ? bills : [failBill(file, cfg, 'No rows matched — check the columns')];
    }

    return [failBill(file, cfg, 'Unsupported file type')];
  }

  /* ── bill object from an OCR/parsed generic-field set ── */
  function makeBill(g, file, source, cfg) {
    var vals = {};
    (cfg.fields || []).forEach(function (f) {
      var k = cfg.ocrMap ? cfg.ocrMap[f.key] : f.key;
      vals[f.key] = (k && g[k] != null) ? String(g[k]) : '';
    });
    var bill = { id: 'b' + (SEQ++), kind: 'ocr', g: g, file: file, source: source, vals: vals };
    var det = detectType(g, cfg); bill.type = det.type; bill.typeWhy = det.why || '';
    // A confidently-detected opposite register is AUTO-ROUTED on import (not a
    // blocker): a purchase uploaded on Sales still lands in Purchase.
    if ((det.type === 'purchase' || det.type === 'sales') && cfg.kind && det.type !== cfg.kind) { bill.crossKind = det.type; bill.flag = ''; }
    else bill.flag = det.flag;
    bill.reviewFields = (cfg.fields || []).filter(function (f) { var k = cfg.ocrMap ? cfg.ocrMap[f.key] : f.key; return k && g._review && g._review.indexOf(k) >= 0; }).map(function (f) { return f.key; });
    recompute(bill, cfg);
    return bill;
  }

  /* ── bill object from a spreadsheet row (already built; no OCR meta) ── */
  function makeSheetBill(built, source, cfg) {
    var vals = {};
    (cfg.fields || []).forEach(function (f) {
      var v = built[f.key];
      if (v == null) { var alt = Object.keys(built).filter(function (k) { return k.toLowerCase() === f.key.toLowerCase(); })[0]; if (alt) v = built[alt]; }
      vals[f.key] = (v == null ? '' : String(v));
    });
    var bill = { id: 'b' + (SEQ++), kind: 'sheet', g: null, file: null, source: source, vals: vals, type: cfg.kind, flag: '', reviewFields: [] };
    recompute(bill, cfg);
    return bill;
  }

  /* Cross-page inheritance: a single PDF is usually ONE supplier's invoice run
     (sequential invoice numbers). If some pages resolved a party and they are
     UNANIMOUS (one supplier), fill that supplier into pages whose name/GSTIN
     couldn't be read — so an 18-invoice run doesn't leave later pages "Unknown".
     Only fires when the resolved pages agree, so a mixed-supplier PDF is never
     mis-labelled. Inherited pages are importable but clearly flagged. */
  function inheritParty(bills, cfg) {
    var nk = nameKey(cfg); if (!nk) return;
    var gk = Object.keys(cfg.ocrMap || {}).filter(function (k) { return cfg.ocrMap[k] === 'gstin'; })[0];
    var norm = function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    var resolved = bills.filter(function (b) { return b.kind === 'ocr' && String(b.vals[nk] || '').trim(); });
    if (resolved.length < 1) return;
    var names = {}; resolved.forEach(function (b) { names[norm(b.vals[nk])] = b.vals[nk]; });
    var keys = Object.keys(names); if (keys.length !== 1) return;      // mixed suppliers → do NOT guess
    var name = names[keys[0]];
    var gstins = {}; if (gk) resolved.forEach(function (b) { var g = norm(b.vals[gk]); if (g) gstins[g] = b.vals[gk]; });
    var gk1 = Object.keys(gstins); var gstin = gk1.length === 1 ? gstins[gk1[0]] : '';
    bills.forEach(function (b) {
      if (b.status === 'failed' || String(b.vals[nk] || '').trim()) return;
      if (gk && String(b.vals[gk] || '').trim()) return;   // has its OWN GSTIN → let it resolve on its own, never inherit
      b.vals[nk] = name; if (gstin && gk && !String(b.vals[gk] || '').trim()) b.vals[gk] = gstin;
      b.inherited = true; recompute(b, cfg);
      b.reason = 'Supplier inherited from same PDF — ' + name + ' (confirm)';
      if (b.status === 'invalid') b.status = 'review';                // resolvable, not blocked
    });
  }

  function failBill(file, cfg, reason) {
    return { id: 'b' + (SEQ++), kind: 'fail', g: null, file: file || null, source: (file && file.name) || 'file', vals: {}, type: 'unknown', flag: '', reviewFields: [], error: reason || 'Failed', status: 'failed' };
  }

  /* auto-classify document type + a review flag when it doesn't fit the register */
  function detectType(g, cfg) {
    var t = (g._text || '').toLowerCase();
    // A document that carries real invoice content (taxable / GST amounts / HSN /
    // grand total) IS an invoice — an E-Way-Bill NUMBER printed on it does not
    // make it an e-way bill. Only call it a non-invoice when that content is absent.
    var hasInvoiceContent = /taxable|c\s*gst|s\s*gst|i\s*gst|\bhsn\b|grand\s*total|invoice\s*(?:no|value)/.test(t) || (g.taxable || g.total);
    if (/credit\s*note/.test(t)) return { type: 'creditnote', flag: 'Credit note — confirm before posting' };
    if (/debit\s*note/.test(t) && !/tax\s*invoice/.test(t)) return { type: 'debitnote', flag: 'Debit note — confirm before posting' };
    if (!hasInvoiceContent && /e-?\s?way\s*bill/.test(t)) return { type: 'ewaybill', flag: 'Looks like an E-way bill, not an invoice' };
    if (!hasInvoiceContent && /bank\s*statement|account\s*statement|(opening|closing)\s*balance/.test(t)) return { type: 'bankstmt', flag: 'Looks like a bank statement — use Reconciliation' };
    // Direction from the parser: the ISSUER decides. If OUR firm issued the bill
    // → SALE (we're the seller); else PURCHASE. Falls back to the buyer-GSTIN
    // heuristic, then the register we're on.
    var type = cfg.kind || 'purchase';
    var why = 'No signal — filed on the ' + (cfg.kind === 'sales' ? 'Sales' : 'Purchase') + ' register you uploaded from';
    if (g.dir === 'sales' || g.dir === 'purchase') {
      type = g.dir;
      // The AI path carries its own reason (extract-schema classify); the
      // offline parser decides from the GSTINs. Say which, in the user's words —
      // a register decision that cannot be questioned is one that cannot be
      // debugged, and this exact decision silently moved a real purchase into
      // the sales register.
      why = (g._cls && g._cls.why) ? ('AI: ' + g._cls.why)
          : (type === 'sales' ? 'Your GSTIN issued this bill' : 'Your GSTIN is the buyer on this bill');
    } else if (g.buyergstin) { type = 'purchase'; why = 'Your GSTIN appears as the buyer'; }
    var flag = '';
    if ((type === 'purchase' || type === 'sales') && cfg.kind && type !== cfg.kind) {
      flag = 'Looks like a ' + (type === 'sales' ? 'Sales invoice' : 'Purchase bill') + ' — you\'re on the ' + (cfg.kind === 'sales' ? 'Sales' : 'Purchase') + ' register';
    }
    // NO IDENTITY: the parser did not "fail to read" the direction — it REFUSED to
    // guess, because with no GSTIN on file our own bill and a supplier's are
    // indistinguishable. Falling through to `cfg.kind` above silently files by
    // whichever page the upload started from, which is exactly the reported bug
    // (a sales invoice booked as a Purchase, ITC claimed, party = our own firm).
    // A flag is what the rest of the pipeline already understands: recompute()
    // turns it into bill.reason (rendered by the batch table) AND status
    // 'review', and importReady() posts only 'ready' — so these can never be
    // blind-imported. Left last: this outranks the cross-register hint, since
    // without an identity that hint is not knowable either.
    if (g.noid) {
      flag = 'Your firm’s GSTIN is not set, so Sales and Purchase can’t be told apart — filed as ' +
             (type === 'sales' ? 'Sales' : 'Purchase') + ' for now. Add your GSTIN in Settings → Company profile, then check this.';
    }
    return { type: type, flag: flag, why: why };
  }

  /* rebuild the domain row from current vals; set validity status (NOT dupes) */
  function recompute(bill, cfg) {
    if (bill.status === 'failed') return;
    var built = null; try { built = cfg.buildRow(function (k) { return bill.vals[k] != null ? bill.vals[k] : ''; }); } catch (_) {}
    bill.built = built;
    var missing = (cfg.fields || []).filter(function (f) { return f.required && !String(bill.vals[f.key] || '').trim(); });

    // A REQUIRED DATE MUST PARSE, NOT MERELY EXIST.
    // The reported bug: OCR reads the label instead of the value ("Dated :"),
    // which is not empty, so the required check passes. buildRow then runs it
    // through parseDate, gets '', and the bill saves with NO DATE — belonging to
    // no month, invisible in every one, while the app cheerfully says "Saved".
    // Uploaded, stored, and gone. Treat an unparseable date as missing so the
    // user is asked for it instead of losing the bill.
    (cfg.fields || []).forEach(function (f) {
      if (!(f.type === 'date' || f.key === 'date')) return;
      var raw = String(bill.vals[f.key] || '').trim();
      if (!raw) return;                                    // already counted as missing above
      if (!isoDate(raw)) {
        bill.badDate = raw;
        if (missing.indexOf(f) < 0) missing.push(f);
      } else { bill.badDate = null; }
    });
    var oneOfFail = (cfg.requireOneOf || []).some(function (grp) { return !grp.some(function (k) { return String(bill.vals[k] || '').trim(); }); });
    bill.missing = missing.map(function (f) { return f.label; });
    // live review-field recompute (a field the user filled is no longer "review")
    bill.reviewFields = (bill.reviewFields || []).filter(function (k) { return !String(bill.vals[k] || '').trim() ? true : false; });
    var nonInvoice = ['creditnote', 'debitnote', 'ewaybill', 'bankstmt', 'unknown'].indexOf(bill.type) >= 0;

    // GSTIN-first resolvability: a missing PARTY NAME is only blocking-invalid
    // when there is ALSO no counterparty GSTIN to identify it by. If a valid
    // GSTIN is present (name just unreadable), keep it REVIEWABLE — the user
    // confirms the customer once and the GSTIN→name mapping is remembered.
    var nk = nameKey(cfg), gk = Object.keys(cfg.ocrMap || {}).filter(function (k) { return cfg.ocrMap[k] === 'gstin'; })[0];
    var hasName = nk && String(bill.vals[nk] || '').trim();
    var gv = gk ? String(bill.vals[gk] || '').toUpperCase().replace(/\s/g, '') : '';
    var hasGstin = gv && window.QLExtract && QLExtract.validGstin(gv);
    // "only the party name is missing" must mean exactly that: missing === [name].
    // This used to re-filter for EMPTY required fields and call .every() on the
    // result — and [].every() is vacuously TRUE, so ANY single missing field
    // that wasn't empty (e.g. a date that is present but unreadable) was
    // misreported as "Customer name unread". Compare the field directly.
    var onlyPartyMissing = missing.length === 1 && nk && missing[0] && missing[0].key === nk;

    bill.reason = '';
    if (!built) bill.reason = 'Could not build the row (check amounts).';
    else if (missing.length) {
      if (onlyPartyMissing && hasGstin) { bill.reason = 'Customer name unread — recognised by GSTIN ' + gv + '. Confirm the party.'; }
      else if (bill.badDate) bill.reason = 'Couldn’t read the bill date (“' + bill.badDate + '”) — type it in, or the bill saves with no date and shows in no month.';
      else bill.reason = 'Missing: ' + bill.missing.join(', ') + (hasGstin ? '' : (nk && !hasName ? ' · no GSTIN detected either' : ''));
    } else if (bill.crossKind) bill.reason = '→ imports to ' + (bill.crossKind === 'purchase' ? 'Purchase' : 'Sales') + ' register';
    else if (bill.flag) bill.reason = bill.flag;

    if (!built) bill.status = 'invalid';
    else if (missing.length) bill.status = (onlyPartyMissing && hasGstin) ? 'review' : 'invalid';   // GSTIN present ⇒ resolvable
    else if (oneOfFail) bill.status = 'invalid';
    else if (bill.reviewFields.length || bill.flag || nonInvoice) bill.status = 'review';
    else bill.status = 'ready';
  }

  /* second pass: duplicate detection (against saved data + within this batch) */
  function finishBatch(cfg) {
    var seen = new Set();
    try { (cfg.existing ? cfg.existing() : []).forEach(function (k) { if (k) seen.add(k); }); } catch (_) {}
    BATCH.bills.forEach(function (b) {
      if (b.status === 'failed' || !b.built || !cfg.keyOf) return;
      var k; try { k = cfg.keyOf(b.built); } catch (_) { k = ''; }
      if (!k) return;
      if (seen.has(k)) { b.dupe = true; if (b.status === 'ready' || b.status === 'review') b.status = 'duplicate'; }
      else seen.add(k);
    });
    hideProgress();
    var n = BATCH.bills.length;
    if (BATCH.dropped && BATCH.dropped.length) toast(BATCH.dropped.length + ' file(s) skipped: ' + BATCH.dropped.slice(0, 3).join(', '), 'err');
    aiNote();
    if (n === 1) openDrawer(BATCH.bills[0], { solo: true });
    else openTable();
  }

  /* Say ONCE per import whether the AI actually read the bills.
     The fallback to the offline regex parser is deliberate and good — a bill still
     gets read when the AI is down. What was not good is that it happened in total
     silence: a valid Gemini key sat in the owner's config while every upload used
     the regex reader, and no screen in the app could tell him. A quieter parse is
     not a neutral event; it is the difference between a field read off the page and
     a field guessed by a pattern.

     Only speak when there is something to say — a working AI stays quiet rather
     than congratulating itself on every import. */
  function aiNote() {
    if (!window.QLExtractAPI || !QLExtractAPI.status) return;
    var s = QLExtractAPI.status();
    if (!s || s.ok) return;                          // worked, or has never run at all
    if (!BATCH || !(s.at >= BATCH.t0)) return;       // stale — this import never asked the AI
    toast('AI reading is off — ' + s.reason + '. Bills were read by the offline reader; check the figures.', 'err');
  }

  /* ════════════════ FLOATING PROGRESS CHIP ════════════════ */
  function progEl() { return document.getElementById('qlbProg'); }
  function showProgress() {
    var e = progEl();
    if (!e) { e = document.createElement('div'); e.id = 'qlbProg'; e.className = 'qlb-prog'; document.body.appendChild(e); }
    e.hidden = false; updateProgress('');
  }
  function updateProgress(label) {
    var e = progEl(); if (!e || !BATCH) return;
    var pct = BATCH.total ? Math.round(BATCH.done / BATCH.total * 100) : 0;
    e.innerHTML =
      '<div class="qlb-prog-h"><span class="qlb-spin"></span><b>Reading bills…</b><span class="qlb-prog-x" id="qlbProgHide">Hide</span></div>' +
      '<div class="qlb-prog-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="qlb-prog-s">' + BATCH.done + ' / ' + BATCH.total + ' processed' + (label ? ' · ' + esc(label.slice(0, 26)) : '') + '</div>';
    var x = document.getElementById('qlbProgHide'); if (x) x.onclick = function () { e.hidden = true; };
  }
  function hideProgress() { var e = progEl(); if (e) e.hidden = true; }

  /* ════════════════ SHARED OVERLAY + DRAWER ════════════════ */
  function scrim() {
    var s = document.getElementById('qlbScrim');
    if (!s) { s = document.createElement('div'); s.id = 'qlbScrim'; s.className = 'qlb-scrim'; document.body.appendChild(s); s.addEventListener('click', function (e) { if (e.target === s) closeAll(); }); }
    return s;
  }
  function closeAll() {
    ['qlbScrim', 'qlbTable', 'qlbDrawer'].forEach(function (id) { var e = document.getElementById(id); if (e) e.remove(); });
    if (BATCH && BATCH.url) { try { URL.revokeObjectURL(BATCH.url); } catch (_) {} BATCH.url = ''; }
    document.body.style.overflow = '';
  }

  var TYPE_META = {
    purchase: ['Purchase', 'b'], sales: ['Sales', 'g'], creditnote: ['Credit Note', 'a'],
    debitnote: ['Debit Note', 'a'], ewaybill: ['E-way Bill', 'n'], bankstmt: ['Bank Statement', 'n'], unknown: ['Unknown', 'n']
  };
  var STAT_META = {
    ready: ['Ready', 'g'], review: ['Needs review', 'a'], duplicate: ['Duplicate', 'p'], invalid: ['Invalid', 'r'], failed: ['Failed', 'r']
  };
  function typeBadge(b) { var m = TYPE_META[b.type] || TYPE_META.unknown; return '<span class="qlb-tag qlb-' + m[1] + '">' + m[0] + '</span>'; }
  function statBadge(b) { var m = STAT_META[b.status] || STAT_META.review; return '<span class="qlb-tag qlb-' + m[1] + '">' + m[0] + '</span>'; }

  /* ── REVIEW DRAWER (single bill; also opened per table row) ── */
  function openDrawer(bill, opts) {
    opts = opts || {};
    var cfg = BATCH.cfg, noun = cfg.noun || 'bill';
    if (BATCH.url) { try { URL.revokeObjectURL(BATCH.url); } catch (_) {} BATCH.url = ''; }
    scrim().hidden = false; document.body.style.overflow = 'hidden';
    var old = document.getElementById('qlbDrawer'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'qlbDrawer'; d.className = 'qlb-drawer';

    // No document preview — the file is already uploaded; just show the fields
    // to confirm. (The original scan stays attached to the bill on save.)

    var fields = cfg.fields || [];
    var g = bill.g || {};
    var pct = function (c) { return Math.round(c * 100) + '%'; };
    var badge = function (f) {
      if (bill.kind !== 'ocr') return '';
      var k = cfg.ocrMap ? cfg.ocrMap[f.key] : f.key;
      if (bill.reviewFields.indexOf(f.key) >= 0) return '<span class="qlb-cf qlb-cf-r">⚠ review</span>';
      var c = g._conf && k ? g._conf[k] : null; if (c == null) return '';
      var v = g._verify && k ? g._verify[k] : '';
      if (v === 'gst_calc' || v === 'gst_sum') return '<span class="qlb-cf qlb-cf-g">✓ GST · ' + pct(c) + '</span>';
      if (v === 'layout') return '<span class="qlb-cf qlb-cf-g">✓ layout · ' + pct(c) + '</span>';
      if (c >= 0.8) return '<span class="qlb-cf qlb-cf-g">✓ ' + pct(c) + '</span>';
      return '<span class="qlb-cf qlb-cf-y">' + pct(c) + '</span>';
    };
    var got = fields.filter(function (f) { return String(bill.vals[f.key] || '').trim(); }).length;

    d.innerHTML =
      '<div class="qlb-dh">' +
        '<div class="qlb-dh-l">' + (opts.back ? '<button class="qlb-back" id="qlbBack">‹ Back</button>' : '') +
          '<div><div class="qlb-dh-t">Review ' + esc(noun) + ' ' + typeBadge(bill) + ' ' + statBadge(bill) + '</div>' +
          // WHY this register, in plain words. A "Sales" badge on a purchase bill
          // with no explanation is exactly how a real customer purchase was
          // quietly filed as their sale and nobody could see why.
          (bill.typeWhy ? '<div class="qlb-dh-w">' + esc(bill.typeWhy) + '</div>' : '') +
          '<div class="qlb-dh-s">' + esc(bill.source || '') + '</div></div></div>' +
        '<button class="qlb-x" id="qlbDX">&times;</button>' +
      '</div>' +
      (bill.error ? '<div class="qlb-warn qlb-warn-r">✕ ' + esc(bill.error) + '</div>' : '') +
      (bill.flag ? '<div class="qlb-warn">⚠ ' + esc(bill.flag) + '</div>' : '') +
      (g._warn && g._warn.length ? '<div class="qlb-warn">⚠ ' + g._warn.map(esc).join(' · ') + '</div>' : '') +
      '<div class="qlb-dbody">' +
        '<div class="qlb-dform">' +
          '<div class="qlb-dform-h"><b>' + got + ' of ' + fields.length + '</b> fields read' + (bill.reviewFields.length ? ' · <span class="qlb-hr">' + bill.reviewFields.length + ' need a look</span>' : '') + '</div>' +
          fields.map(function (f) {
            return '<label class="qlb-f' + (bill.reviewFields.indexOf(f.key) >= 0 ? ' rev' : '') + '"><span class="qlb-fl">' + esc(f.label) + (f.required ? ' <b class="qlb-req">*</b>' : '') + ' ' + badge(f) + '</span>' +
              '<input data-k="' + f.key + '" value="' + esc(bill.vals[f.key] || '') + '"></label>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="qlb-dfoot">' +
        (opts.solo ? '' : '<span class="qlb-dfoot-n" id="qlbNext"></span>') +
        '<button class="qlb-btn" id="qlbCancel">Cancel</button>' +
        '<button class="qlb-btn qlb-btn-p" id="qlbSave">' + (opts.solo ? 'Save ' + esc(noun) : 'Confirm ' + esc(noun)) + '</button>' +
      '</div>';
    document.body.appendChild(d);

    // live re-validate as the user edits
    d.querySelectorAll('input[data-k]').forEach(function (inp) {
      inp.addEventListener('input', function () { bill.vals[inp.dataset.k] = inp.value; });
    });
    d.querySelector('#qlbDX').onclick = closeAll;
    d.querySelector('#qlbCancel').onclick = opts.back ? function () { openTable(); } : closeAll;
    if (d.querySelector('#qlbBack')) d.querySelector('#qlbBack').onclick = function () { openTable(); };

    d.querySelector('#qlbSave').onclick = function () {
      // pull latest values
      d.querySelectorAll('input[data-k]').forEach(function (i) { bill.vals[i.dataset.k] = i.value; });
      recompute(bill, cfg);
      if (bill.status === 'invalid') { toast('Please fill: ' + (bill.missing.join(', ') || 'required fields'), 'err'); return; }
      // learn a supplier correction for next time (local alias + GSTIN party master)
      try {
        var nk = nameKey(cfg);
        if (bill.kind === 'ocr' && nk && g._text) { var first = (g._text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean)[0]) || ''; var orig = g[cfg.ocrMap[nk]] || ''; var now = bill.vals[nk] || ''; if (first && now && now !== orig) F().learnBillAlias(first, now); }
        // GSTIN → verified legal name: pin the confirmed name to the party master
        var gk = Object.keys(cfg.ocrMap || {}).filter(function (k) { return cfg.ocrMap[k] === 'gstin'; })[0];
        var gv = gk ? String(bill.vals[gk] || '').toUpperCase().replace(/\s/g, '') : '';
        var nv = nk ? String(bill.vals[nk] || '').trim() : '';
        if (window.QLExtractAPI && gv && nv && window.QLExtract && QLExtract.validGstin(gv) && QLExtract.plausibleName(nv)) {
          QLExtractAPI.saveParty(gv, nv, g._ai ? (g._fields && (g._fields.supplierName || g._fields.buyerName) || '') : '');
        }
      } catch (_) {}
      bill.confirmed = true;
      if (opts.solo) {
        // Duplicate guard: this exact bill (bill no + supplier identity) already
        // exists. First click warns; a deliberate second click saves anyway.
        if (bill.dupe && !bill.forceDupe) {
          bill.forceDupe = true;
          toast('This bill already exists in the register. Click Save again to add it anyway.', 'err');
          return;
        }
        // Only claim "Saved" when the save actually happened; on failure keep
        // the drawer open and say exactly why. Awaited so the scan's write has
        // landed (or honestly failed) before we say a word about it.
        var btn = this; btn.disabled = true;
        postOne(bill, cfg).then(function (okd) {
          btn.disabled = false;
          if (okd) {
            if (bill.scanErr) toast('Saved 1 ' + noun + ' — but WITHOUT the scan (' + bill.scanErr + '). Attach it from the bill\'s Documents tab.', 'err');
            else toast('Saved 1 ' + noun + (bill.routed ? ' → moved to the ' + bill.routed + ' register' : ''), 'ok');
            if (cfg.done) cfg.done(1, bill);
            closeAll();
          } else {
            toast('NOT saved — ' + (bill.err || 'could not build the record') + '.', 'err');
          }
        });
      } else {
        bill.status = 'ready';
        openTable(nextReview(bill));   // return to table, optionally jump to next needy bill
      }
    };
  }

  function nextReview(afterBill) {
    var arr = BATCH.bills, i = arr.indexOf(afterBill);
    for (var j = i + 1; j < arr.length; j++) if (arr[j].status === 'review' || arr[j].status === 'invalid') return arr[j];
    return null;
  }

  /* ── BULK REVIEW TABLE (many bills) ── */
  var TFILTER = 'all';
  function openTable(jumpTo) {
    var cfg = BATCH.cfg, noun = cfg.noun || 'bill', pl = noun + 's';
    scrim().hidden = false; document.body.style.overflow = 'hidden';
    var old = document.getElementById('qlbDrawer'); if (old) old.remove();
    var old2 = document.getElementById('qlbTable'); if (old2) old2.remove();

    var count = function (st) { return BATCH.bills.filter(function (b) { return st === 'all' ? true : st === 'sales' || st === 'purchase' ? b.type === st : b.status === st; }).length; };
    var rowsFor = function () { return BATCH.bills.filter(function (b) { return TFILTER === 'all' ? true : TFILTER === 'sales' || TFILTER === 'purchase' ? b.type === TFILTER : b.status === TFILTER; }); };
    var readyN = count('ready');
    var nk = nameKey(cfg), ik = invKey(cfg);
    var amtOf = function (b) { var t = num(b.vals.total); if (t) return t; var tx = num(b.vals.taxable); if (tx) return tx; return num(b.vals.qty) * num(b.vals.rate); };

    var t = document.createElement('div'); t.id = 'qlbTable'; t.className = 'qlb-table-wrap';
    var tabs = [['all', 'All'], ['ready', 'Ready'], ['review', 'Needs review'], ['duplicate', 'Duplicates'], ['invalid', 'Invalid'], ['failed', 'Failed']];
    var typeTabs = [['purchase', 'Purchase'], ['sales', 'Sales']];

    t.innerHTML =
      '<div class="qlb-th">' +
        '<div><div class="qlb-th-t">Review ' + BATCH.bills.length + ' ' + pl + '</div>' +
        '<div class="qlb-th-s">' + count('ready') + ' ready · ' + count('review') + ' need review · ' + count('duplicate') + ' duplicate · ' + count('failed') + ' failed</div></div>' +
        '<button class="qlb-x" id="qlbTX">&times;</button>' +
      '</div>' +
      '<div class="qlb-filters">' +
        tabs.map(function (f) { return '<button class="qlb-ftab' + (TFILTER === f[0] ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '<i>' + count(f[0]) + '</i></button>'; }).join('') +
        '<span class="qlb-fsep"></span>' +
        typeTabs.map(function (f) { return '<button class="qlb-ftab' + (TFILTER === f[0] ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '<i>' + count(f[0]) + '</i></button>'; }).join('') +
      '</div>' +
      '<div class="qlb-tscroll"><table class="qlb-tbl"><thead><tr>' +
        '<th>Type</th><th>' + (cfg.kind === 'sales' ? 'Customer' : 'Supplier') + '</th><th>' + (cfg.kind === 'sales' ? 'Invoice No' : 'Bill No') + '</th><th class="r">Amount</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' +
        rowsFor().map(function (b) {
          return '<tr data-id="' + b.id + '" class="' + (b.status === 'failed' ? 'qlb-trf' : '') + '">' +
            '<td>' + typeBadge(b) + '</td>' +
            '<td class="qlb-tname"><b>' + esc(b.vals[nk] || (b.error ? '—' : 'Unknown')) + '</b><span>' + esc(b.source || '') + (b.vals.veh ? ' · 🚚 ' + esc(b.vals.veh) : '') + '</span></td>' +
            '<td>' + esc(b.vals[ik] || '—') + '</td>' +
            '<td class="r">' + (b.error ? '—' : fC(amtOf(b))) + '</td>' +
            '<td>' + statBadge(b) + (b.reason ? '<div class="qlb-miss ' + (b.status === 'ready' ? 'qlb-miss-i' : b.status === 'review' ? 'qlb-miss-r' : '') + '">' + esc(b.reason) + '</div>' : '') + '</td>' +
            '<td class="r">' + (b.status === 'failed' ? '' : '<button class="qlb-rev" data-id="' + b.id + '">Review ›</button>') + '</td>' +
          '</tr>';
        }).join('') +
        (rowsFor().length ? '' : '<tr><td colspan="6" class="qlb-empty">Nothing in this filter.</td></tr>') +
      '</tbody></table></div>' +
      '<div class="qlb-cbar">' +
        '<div class="qlb-cbar-l">' + readyN + ' of ' + BATCH.bills.length + ' ready to import' + (count('duplicate') ? ' · ' + count('duplicate') + ' duplicate blocked' : '') + '</div>' +
        '<div><button class="qlb-btn" id="qlbTClose">Close</button>' +
        '<button class="qlb-btn qlb-btn-p" id="qlbImport"' + (readyN ? '' : ' disabled') + '>Import ' + readyN + ' ' + pl + '</button></div>' +
      '</div>';
    document.body.appendChild(t);

    t.querySelector('#qlbTX').onclick = closeAll;
    t.querySelector('#qlbTClose').onclick = closeAll;
    t.querySelectorAll('.qlb-ftab').forEach(function (b) { b.onclick = function () { TFILTER = b.dataset.f; openTable(); }; });
    var openRow = function (id) { var b = BATCH.bills.filter(function (x) { return x.id === id; })[0]; if (b && b.status !== 'failed') openDrawer(b, { back: true }); };
    t.querySelectorAll('tr[data-id]').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('.qlb-rev')) return; openRow(tr.dataset.id); }; });
    t.querySelectorAll('.qlb-rev').forEach(function (btn) { btn.onclick = function (e) { e.stopPropagation(); openRow(btn.dataset.id); }; });
    t.querySelector('#qlbImport').onclick = function () { importReady(cfg); };

    if (jumpTo) openDrawer(jumpTo, { back: true });
  }

  // Map the (possibly edited) review-table vals back to GENERIC OCR keys, so a
  // cross-register bill can be rebuilt for the OTHER register.
  function valsToGeneric(bill, cfg) {
    var g = Object.assign({}, bill.g || {});
    Object.keys(cfg.ocrMap || {}).forEach(function (fk) { var gk = cfg.ocrMap[fk]; if (gk && bill.vals[fk] != null && bill.vals[fk] !== '') g[gk] = bill.vals[fk]; });
    return g;
  }
  /* THE SCAN GOES WITH THE BILL.
     A bill saved without its scan is a bill you cannot check against the paper —
     the eye button opens nothing and the only copy of the document is in the
     owner's downloads folder, if it is anywhere. The same-register path carries
     it through cfg.add(row, file), which each register turns into an attachment.
     The CROSS-register path did not: importGenericBill takes fields only, so any
     bill auto-routed to the opposite register was filed with no document at all
     and nothing said so. It returns the new row's index precisely so the scan can
     follow it — into the DESTINATION register's store, not this page's.

     async, and awaited by every caller: the attach is an IndexedDB write, and the
     old code fired it into the void from inside a synchronous try/catch that could
     not have caught its rejection anyway. A save that reports success before the
     write lands is not reporting on the write. */
  async function postOne(bill, cfg) {
    var file = bill.file || null;
    bill.scanErr = '';
    // route a confidently-detected opposite-register bill to the CORRECT register
    if (bill.crossKind && window.QLD && QLD.importGenericBill) {
      try {
        var idx = QLD.importGenericBill(bill.crossKind, valsToGeneric(bill, cfg));
        bill.status = 'imported'; bill.routed = bill.crossKind;
        // The bill IS saved at this point. If the scan will not attach, say so —
        // but never undo the bill over it: losing the record too would turn a
        // missing document into a missing bill.
        if (file && QLD.attachDoc && idx != null && idx >= 0) await attachScan(bill, QLD.attachDoc(bill.crossKind, idx, file, 'Invoice'));
        return true;
      }
      catch (e) { bill.err = (e && e.message) || 'cross-register import failed'; }
    }
    // NEVER swallow a failure silently — the caller must know, or the UI says
    // "Saved" while the table stays empty (the exact bug users reported).
    try {
      var row = cfg.buildRow(function (k) { return bill.vals[k] != null ? bill.vals[k] : ''; });
      if (row) {
        // cfg.add pushes the row SYNCHRONOUSLY and throws there if the register
        // refuses it (the duplicate gate) — so a throw from this call is a bill
        // that was never saved. It then RETURNS the attach promise.
        var p = cfg.add(row, file || undefined);
        // The row is in the register from this line on. Mark it saved BEFORE
        // awaiting the scan: a scan that will not store must never walk back a
        // bill that is already committed — that trades a missing document for a
        // missing purchase, which is far worse and much harder to notice.
        bill.status = 'imported'; bill.savedRow = row;
        await attachScan(bill, p);
        return true;
      }
      bill.err = 'missing supplier / amount — nothing to save';
    } catch (e) { bill.err = (e && e.message) || 'could not save the bill'; }
    bill.status = 'failed';
    return false;
  }

  /* Await the scan's write. Called ONLY once the row is committed, so a failure
     here is never a lost bill — it is a saved bill with no document, which is a
     different fact and gets reported as itself. Recorded rather than thrown: the
     caller's job is to finish saving and then tell the truth about the scan. */
  async function attachScan(bill, p) {
    if (!p || typeof p.then !== 'function') return;
    try { await p; }
    catch (e) { bill.scanErr = (e && e.message) || 'could not store the scan'; }
  }

  /* One honest line about scans that did not attach. The bills saved; their
     documents did not, and the user is the only one who can still do something
     about it (the file is still on their disk). Silence here is what turns a
     failed write into a discovery months later. */
  function scanNote(bills) {
    var bad = (bills || []).filter(function (b) { return b.scanErr; });
    if (!bad.length) return;
    toast(bad.length + ' bill' + (bad.length === 1 ? '' : 's') + ' saved WITHOUT the scan — ' + bad[0].scanErr + '. Attach the file from the bill\'s Documents tab.', 'err');
  }

  async function importReady(cfg) {
    var ready = BATCH.bills.filter(function (b) { return b.status === 'ready'; });
    if (!ready.length) { toast('Nothing ready to import', 'err'); return; }
    var n = 0;
    // SEQUENTIAL, and awaited. Each post pushes a row and then attaches to the
    // index it just created; run concurrently they interleave that push with each
    // other's index read, and a scan lands on the wrong bill.
    for (var i = 0; i < ready.length; i++) { if (await postOne(ready[i], cfg)) n++; }
    var failedN = ready.length - n;
    toast('Imported ' + n + ' ' + (cfg.noun || 'bill') + (n === 1 ? '' : 's') + (failedN ? ' · ' + failedN + ' FAILED — see the Failed tab' : ''), failedN ? 'err' : 'ok');
    scanNote(ready);
    if (cfg.done) cfg.done(n, ready.filter(function (b) { return b.status === 'imported'; }).slice(-1)[0]);
    // any leftover (review/invalid/duplicate) stay open so the user can resolve them
    var left = BATCH.bills.filter(function (b) { return b.status !== 'imported' && b.status !== 'failed'; });
    if (left.length) { toast(left.length + ' left to review', ''); openTable(); }
    else closeAll();
  }

  /* ════════════════ STYLES (injected once) ════════════════ */
  function injectCSS() {
    if (document.getElementById('qlbCSS')) return;
    var s = document.createElement('style'); s.id = 'qlbCSS';
    s.textContent = [
      /* progress chip */
      '.qlb-prog{position:fixed;right:18px;bottom:18px;z-index:1200;width:260px;background:var(--ql-card,#fff);border:1px solid var(--ql-border,#e2e8f0);border-radius:14px;box-shadow:0 10px 34px rgba(15,23,42,.16);padding:13px 14px;font-size:13px}',
      '.qlb-prog-h{display:flex;align-items:center;gap:8px;font-size:13px}.qlb-prog-h b{font-weight:650}.qlb-prog-x{margin-left:auto;font-size:11.5px;color:var(--ql-text-muted,#94a3b8);cursor:pointer}',
      '.qlb-spin{width:14px;height:14px;border:2px solid var(--ql-border,#e2e8f0);border-top-color:var(--ql-brand-600,#2563eb);border-radius:50%;animation:qlbspin .7s linear infinite}',
      '@keyframes qlbspin{to{transform:rotate(360deg)}}',
      '.qlb-prog-bar{height:6px;border-radius:999px;background:var(--ql-neutral-100);margin:9px 0 6px;overflow:hidden}.qlb-prog-bar>i{display:block;height:100%;background:var(--ql-brand-600,#2563eb);border-radius:999px;transition:width .25s}',
      '.qlb-prog-s{font-size:11.5px;color:var(--ql-text-muted,#64748b)}',
      /* scrim + panels */
      '.qlb-scrim{position:fixed;inset:0;background:rgba(15,23,42,.42);z-index:1300;backdrop-filter:blur(2px)}',
      '.qlb-drawer{position:fixed;top:0;right:0;bottom:0;width:min(560px,96vw);background:var(--ql-card,#fff);z-index:1320;display:flex;flex-direction:column;box-shadow:-14px 0 40px rgba(15,23,42,.18);animation:qlbslide .22s cubic-bezier(.2,.7,.3,1)}',
      '@keyframes qlbslide{from{transform:translateX(30px);opacity:.4}to{transform:none;opacity:1}}',
      '.qlb-table-wrap{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(920px,96vw);max-height:90vh;background:var(--ql-card,#fff);z-index:1310;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(15,23,42,.28)}',
      /* headers */
      '.qlb-dh,.qlb-th{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:15px 18px;border-bottom:1px solid var(--ql-border,#e2e8f0)}',
      '.qlb-dh-l{display:flex;align-items:flex-start;gap:10px}.qlb-dh-t,.qlb-th-t{font-size:15.5px;font-weight:700;letter-spacing:-.01em;display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
      '.qlb-dh-s,.qlb-th-s{font-size:12px;color:var(--ql-text-muted,#64748b);margin-top:3px}',
      '.qlb-x{background:none;border:none;font-size:24px;line-height:1;color:var(--ql-text-muted,#94a3b8);cursor:pointer;padding:0 2px}',
      '.qlb-back{background:var(--ql-neutral-100);border:none;border-radius:8px;padding:5px 9px;font-size:12.5px;font-weight:600;color:var(--ql-text-secondary,#475569);cursor:pointer}',
      /* warnings */
      '.qlb-dh-w{font-size:11.5px;color:#64748b;margin-top:3px;line-height:1.4}',
      '.qlb-warn{margin:10px 18px 0;background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:12.5px;border-radius:9px;padding:8px 11px}',
      '.qlb-warn-r{background:#fef2f2;border-color:#fecaca;color:#b91c1c}',
      /* drawer body */
      '.qlb-dbody{flex:1;overflow:auto;padding:14px 18px}',
      '.qlb-dprev{margin-bottom:14px}.qlb-doc{width:100%;height:230px;border:1px solid var(--ql-border,#e2e8f0);border-radius:11px;background:#f8fafc;object-fit:contain;display:block}',
      '.qlb-nodoc{height:90px;display:grid;place-items:center;color:var(--ql-text-muted,#94a3b8);border:1px dashed var(--ql-border,#e2e8f0);border-radius:11px;font-size:12.5px}',
      '.qlb-dform-h{font-size:12.5px;color:var(--ql-text-secondary,#475569);margin-bottom:10px}.qlb-hr{color:#b45309;font-weight:600}',
      '.qlb-f{display:flex;flex-direction:column;gap:5px;margin-bottom:11px}',
      '.qlb-fl{font-size:11.5px;font-weight:600;color:var(--ql-text-secondary,#475569);display:flex;align-items:center;gap:7px}',
      '.qlb-f input{border:1.5px solid var(--ql-border,#e2e8f0);border-radius:9px;padding:9px 11px;font:inherit;font-size:13.5px;width:100%}',
      '.qlb-f input:focus{outline:none;border-color:var(--ql-brand-500,#3b82f6);box-shadow:0 0 0 3px var(--ql-brand-50,#eff6ff)}',
      '.qlb-f.rev input{border-color:#f59e0b;background:#fffdf5}',
      '.qlb-req{color:#dc2626}',
      '.qlb-cf{font-size:9.5px;font-weight:700;letter-spacing:.02em;padding:2px 6px;border-radius:999px}',
      '.qlb-cf-g{background:#dcfce7;color:#15803d}.qlb-cf-y{background:#fef9c3;color:#a16207}.qlb-cf-r{background:#fee2e2;color:#b91c1c}',
      /* foot bars */
      '.qlb-dfoot,.qlb-cbar{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:13px 18px;border-top:1px solid var(--ql-border,#e2e8f0);background:var(--ql-card,#fff)}',
      '.qlb-cbar{justify-content:space-between}.qlb-cbar-l{font-size:12.5px;color:var(--ql-text-secondary,#475569)}.qlb-cbar>div{display:flex;gap:10px}',
      '.qlb-dfoot-n{margin-right:auto;font-size:12px;color:var(--ql-text-muted,#94a3b8)}',
      '.qlb-btn{border:1px solid var(--ql-border,#e2e8f0);background:var(--ql-card,#fff);border-radius:9px;padding:9px 15px;font:inherit;font-size:13px;font-weight:600;color:var(--ql-text-secondary,#475569);cursor:pointer}',
      '.qlb-btn-p{background:var(--ql-brand-600,#2563eb);border-color:var(--ql-brand-600,#2563eb);color:#fff}.qlb-btn-p:disabled{opacity:.45;cursor:not-allowed}',
      /* filters + table */
      '.qlb-filters{display:flex;align-items:center;gap:6px;padding:10px 18px;border-bottom:1px solid var(--ql-border,#e2e8f0);flex-wrap:wrap}',
      '.qlb-fsep{width:1px;height:20px;background:var(--ql-border,#e2e8f0);margin:0 3px}',
      '.qlb-ftab{border:none;background:var(--ql-neutral-100);border-radius:8px;padding:6px 10px;font-size:12.5px;font-weight:600;color:var(--ql-text-secondary,#475569);cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
      '.qlb-ftab.on{background:var(--ql-brand-600,#2563eb);color:#fff}.qlb-ftab i{font-style:normal;font-size:10.5px;background:rgba(0,0,0,.09);border-radius:999px;padding:1px 6px;font-weight:700}.qlb-ftab.on i{background:rgba(255,255,255,.24)}',
      '.qlb-tscroll{flex:1;overflow:auto}',
      '.qlb-tbl{width:100%;border-collapse:collapse;font-size:13px}',
      '.qlb-tbl th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--ql-text-muted,#94a3b8);padding:9px 14px;position:sticky;top:0;background:var(--ql-card,#fff);border-bottom:1px solid var(--ql-border,#e2e8f0);z-index:1}',
      '.qlb-tbl td{padding:10px 14px;border-bottom:1px solid var(--ql-divider);vertical-align:middle}',
      '.qlb-tbl tr[data-id]{cursor:pointer}.qlb-tbl tr[data-id]:hover td{background:var(--ql-neutral-50)}',
      '.qlb-tbl .r{text-align:right}.qlb-trf td{opacity:.6}',
      '.qlb-tname b{display:block;font-weight:650;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.qlb-tname span{font-size:10.5px;color:var(--ql-text-muted,#94a3b8);display:block;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.qlb-miss{font-size:10px;color:#b91c1c;margin-top:2px;max-width:260px}.qlb-miss-r{color:#b45309}.qlb-miss-i{color:#64748b}',
      '.qlb-rev{border:none;background:none;color:var(--ql-brand-600,#2563eb);font-weight:650;font-size:12.5px;cursor:pointer;white-space:nowrap}',
      '.qlb-empty{text-align:center;color:var(--ql-text-muted,#94a3b8);padding:34px !important;font-size:13px}',
      /* tags */
      '.qlb-tag{font-size:10px;font-weight:700;letter-spacing:.01em;padding:2px 8px;border-radius:999px;white-space:nowrap}',
      '.qlb-b{background:#dbeafe;color:#1d4ed8}.qlb-g{background:#dcfce7;color:#15803d}.qlb-a{background:#fef3c7;color:#b45309}.qlb-p{background:#f3e8ff;color:#7e22ce}.qlb-r{background:#fee2e2;color:#b91c1c}.qlb-n{background:#f1f5f9;color:#64748b}',
      /* mobile: drawer full-width, table → cards */
      '@media(max-width:720px){',
      '.qlb-drawer{width:100vw}',
      '.qlb-table-wrap{width:100vw;height:100vh;max-height:100vh;border-radius:0;top:0;left:0;transform:none}',
      '.qlb-tbl thead{display:none}.qlb-tbl,.qlb-tbl tbody,.qlb-tbl tr,.qlb-tbl td{display:block;width:auto}',
      '.qlb-tbl tr[data-id]{border:1px solid var(--ql-border,#e2e8f0);border-radius:12px;margin:10px 14px;padding:6px 4px;position:relative}',
      '.qlb-tbl td{border:none;padding:4px 14px}.qlb-tbl td.r{text-align:left}',
      '.qlb-tbl td:nth-child(1){position:absolute;top:10px;right:12px;padding:0}',
      '.qlb-dbody{padding:12px 14px}.qlb-doc{height:180px}',
      '}'
    ].join('');
    document.head.appendChild(s);
  }

  // ingest(files, cfg): process an already-obtained File[]/FileList (drag-drop,
  // programmatic, or tests) through the same pipeline as the picker.
  function ingest(files, cfg) { injectCSS(); start(Array.from(files || []), cfg || {}); }

  window.QLBulk = { open: open, ingest: ingest, LIMITS: LIMITS };
})();

/* build b7: postOne reports failures; solo save honest + dup guard */

/* build b7: postOne reports failures; solo save honest + dup guard */
