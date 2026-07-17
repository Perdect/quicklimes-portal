/* ═══════════════════════════════════════════════════════════════════════
   qty-backfill.js — read the tonnage back off the bills already uploaded.

   "show quantity get from uploeded bills"

   The Qty column shows dashes on old bills because the purchase importer never
   mapped qty — bill-ocr read it off the page and the importer dropped it on the
   floor (fixed today; sales.js had always carried it). New imports are fine. The
   26 bills already in the books are not.

   BUT THE BILLS THEMSELVES ARE STILL HERE. addAttach stores the actual File in
   IndexedDB (purchase.js: aOp('readwrite', st => st.put(file, id))). So the
   tonnage is not gone — it was never READ. We can read it now, off the same PDF,
   with the same tested parser. His Indian Oil bill yields qty 32.49, unit TO,
   rate 12,680 — matching what is printed on it.

   IT RUNS ITSELF NOW. "no need to read quantities separate when uploaded
   documents then read same time" — he is right, and for NEW uploads that is
   already true (the importer maps qty). The button existed only to repair bills
   imported before that fix. A button asking him to go re-run a bug is not a
   feature, so auto() does it in the background, once per bill, and TELLS HIM what
   it read. The gate below is unchanged and still decides every write.

   WRITE ONLY WHAT THE ARITHMETIC PROVES — the same rule as the Tally ledger
   import. It writes only onto bills that have no quantity today:

   · A bill that already HAS a qty is never touched. Someone typed that in; a
     parser is not entitled to overrule a human on his own books.
   · A qty is only offered when the bill's own arithmetic agrees — qty × rate must
     land on the taxable value already stored. That is the check that makes this
     safe: we are not trusting the OCR, we are trusting ARITHMETIC the OCR has to
     satisfy against a number the books already hold.
   · Anything that fails that check is reported as "could not read", never guessed.
     A wrong tonnage silently poisons Inventory, cost-per-tonne and every margin
     below it — worse than the dash it replaces.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* qty × rate must reproduce the taxable the books already hold. Within a rupee
     for float dust, or 0.5% for a bill that rounds its own line items (Indian Oil's
     ZRND line does exactly that: 486128.38 → 486128.00). */
  function arithmeticAgrees(qty, rate, taxable) {
    if (!(qty > 0) || !(rate > 0) || !(taxable > 0)) return false;
    var implied = qty * rate;
    var diff = Math.abs(implied - taxable);
    return diff <= 1 || diff <= taxable * 0.005;
  }

  /* Decide what a single scanned bill yields. Pure — the whole judgement, testable
     without IndexedDB, a PDF or a browser. */
  function verdict(row, f) {
    if (!row) return { ok: false, why: 'no bill' };
    if (+row.qty > 0) return { ok: false, skip: true, why: 'already has a quantity — not overruling it' };
    if (!f) return { ok: false, why: 'could not read the file' };

    var qty = +f.qty || 0, rate = +f.unitRate || 0, taxable = +row.taxable || 0;
    if (!(qty > 0)) return { ok: false, why: 'no quantity found on the bill' };

    /* The arithmetic gate. Without it we would be taking the parser's word for a
       number that changes every cost figure in the app. */
    if (!arithmeticAgrees(qty, rate, taxable)) {
      return { ok: false, why: 'read ' + qty + ' × ₹' + Math.round(rate) + ' = ₹' + Math.round(qty * rate)
        + ', but the bill is booked at ₹' + Math.round(taxable) + ' — does not reconcile, so not applied' };
    }
    return { ok: true, qty: qty, unit: (f.unit || '').toString().trim(), rate: rate,
      why: qty + ' × ₹' + Math.round(rate) + ' = ₹' + Math.round(qty * rate) + ' ✓ matches the booked value' };
  }

  /* Which bills are even worth scanning: no qty, but a file we could read. */
  function candidates(rows) {
    return (rows || []).filter(function (r) {
      return r && r.status !== 'cancelled' && !(+r.qty > 0) && (r.attach || []).length;
    });
  }

  /* A bill's identity for the "already tried" marker. NOT the row index — idx is
     positional and shifts the moment a bill is deleted, which would re-scan some
     bills forever and skip others that were never read. */
  function billKey(r) {
    return [(r.bill || '').toString().trim().toUpperCase(),
      (r.gstin || r.sup || '').toString().trim().toUpperCase(),
      (r.date || '')].join('|');
  }

  /* ── the browser half ───────────────────────────────────────── */
  /* `rows` lets auto() pass the subset it has not tried yet. Defaults to every
     candidate, which is what the manual path always scanned. */
  async function scan(onProgress, rows) {
    var Q = root.QLD, F = root.QLFin, OCR = root.BillOCR;
    if (!Q || !F || !OCR) return { error: 'The bill reader is not loaded on this page.' };
    rows = rows || candidates(Q.purchaseRows());
    var found = [], missed = [], i = 0;

    for (var k = 0; k < rows.length; k++) {
      var r = rows[k];
      if (onProgress) onProgress(++i, rows.length, r.bill || '');
      var f = null;
      try {
        var att = (r.attach || [])[0];
        var file = await root.QLAttach.get(att.id);          // the ORIGINAL upload
        var pages = await F.pdfPages(file);
        var txt = (pages || []).join('\n');
        var p = OCR.parse(txt, 'purchase');
        f = p && p.fields;
      } catch (e) { f = null; }

      var v = verdict(r, f);
      if (v.ok) found.push({ idx: r.idx, bill: r.bill, sup: r.sup, taxable: r.taxable, qty: v.qty, unit: v.unit, rate: v.rate, why: v.why });
      else if (!v.skip) missed.push({ idx: r.idx, bill: r.bill, sup: r.sup, why: v.why });

      /* YIELD. Parsing a PDF is heavy synchronous work, and this runs unasked
         while he is reading the register — a loop that never returns to the event
         loop freezes the page and looks like a crash. One turn per bill lets the
         browser paint and keeps clicks alive. */
      await new Promise(function (res) { setTimeout(res, 0); });
    }
    return { found: found, missed: missed, scanned: rows.length };
  }

  /* ── THE AUTOMATIC PASS ──────────────────────────────────────
     His 26 bills predate the importer mapping qty, so they carry no tonnage and
     Production shows "—" for them. New uploads read it at import. Rather than
     leave a button that means "go fix the old bug yourself", this reads them back
     off their own PDFs on its own, once, in the background.

     THE RULES IT MUST NOT BREAK:
     · Never block the page. Scheduled on idle, and scan() yields between bills.
     · Never overwrite a human's number — apply() re-checks that at write time.
     · Never guess. Only what the arithmetic gate accepts is written; the rest
       stays a dash, which is the honest answer.
     · Never run twice for the same bill. The marker is per BILL, not per page:
       a bill that could not be read is not retried on every load, and a bill that
       arrives later still gets its one chance.
     · NEVER FINISH SILENTLY. A background job that writes to his books and says
       nothing is indistinguishable from one that did nothing — the ai-status bug
       exactly. It reports what it read and what it could not. */
  function markerKey() {
    var co = root.QLD && root.QLD.co;
    return 'ql_qtyscan_' + ((co && co.key) || 'default');
  }
  function tried() {
    try { var v = JSON.parse(localStorage.getItem(markerKey()) || '[]'); return Array.isArray(v) ? v : []; }
    catch (_) { return []; }
  }
  function remember(keys) {
    try {
      var all = tried().concat(keys || []);
      var uniq = all.filter(function (k, i) { return k && all.indexOf(k) === i; });
      localStorage.setItem(markerKey(), JSON.stringify(uniq.slice(-500)));
    } catch (_) {}
  }
  /* Which bills this pass should even look at: a candidate we have never tried. */
  function pending(rows) {
    var seen = tried();
    return candidates(rows).filter(function (r) { return seen.indexOf(billKey(r)) < 0; });
  }

  function idle(fn) {
    if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(fn, { timeout: 4000 });
    else setTimeout(fn, 800);
  }

  /* Returns a promise resolving to what happened — so a test can await it and the
     page does not have to. Never throws into the page: this is unasked-for work
     and must not take the register down with it. */
  function auto(opts) {
    opts = opts || {};
    var Q = root.QLD;
    if (!Q || !root.QLAttach) return Promise.resolve({ ran: false, why: 'not on a page that holds the bills' });
    var todo = pending(Q.purchaseRows());
    if (!todo.length) return Promise.resolve({ ran: false, why: 'nothing to read' });

    return new Promise(function (res) {
      idle(async function () {
        var r;
        try { r = await scan(null, todo); }
        catch (e) { res({ ran: false, why: 'the bill reader failed' }); return; }
        if (r.error) { res({ ran: false, why: r.error }); return; }

        var wrote = apply(r.found);
        /* Mark every bill we TRIED, read or not — including the ones that failed
           the gate. Retrying them on every load would re-parse the same PDFs to
           the same refusal forever. */
        remember(todo.map(billKey));
        var out = { ran: true, wrote: wrote, missed: r.missed.length, scanned: r.scanned };
        if (opts.onDone) { try { opts.onDone(out); } catch (_) {} }
        res(out);
      });
    });
  }

  /* The sentence he sees. Kept next to the logic that produces the numbers so the
     two cannot drift, and exported so a test can pin the wording. */
  function report(o) {
    if (!o || !o.ran || (!o.wrote && !o.missed)) return '';
    if (!o.wrote) return 'Could not read a quantity off ' + o.missed + ' bill' + (o.missed === 1 ? '' : 's') + ' — the figures did not reconcile, so nothing was changed.';
    return 'Read tonnage off ' + o.wrote + ' bill' + (o.wrote === 1 ? '' : 's')
      + (o.missed ? ' · ' + o.missed + ' could not be read' : '');
  }

  /* Writes ONLY what was confirmed. Re-checks each row is still qty-less at write
     time: the scan may be minutes old and a human may have typed one in since —
     and a human beats a parser, always. */
  function apply(found) {
    var Q = root.QLD, n = 0;
    (found || []).forEach(function (x) {
      var cur = Q.state.PURCHASES[x.idx];
      if (!cur || +cur.qty > 0) return;                       // someone got there first
      var patch = { qty: x.qty, rate: x.rate };
      if (x.unit) patch.unit = x.unit;
      Q.updatePurchase(x.idx, patch);
      n++;
    });
    return n;
  }

  var API = { scan: scan, apply: apply, verdict: verdict, candidates: candidates, arithmeticAgrees: arithmeticAgrees,
    auto: auto, pending: pending, billKey: billKey, report: report, markerKey: markerKey, _tried: tried, _remember: remember };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.QLQtyBackfill = API;
})(typeof window !== 'undefined' ? window : globalThis);
