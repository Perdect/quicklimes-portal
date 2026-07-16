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

   COMPARE FIRST, WRITE LAST — the same rule as the Tally ledger import and the
   duplicate cleanup. This SCANS and reports. It writes only what he confirms, and
   only onto bills that have no quantity today:

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

  /* ── the browser half ───────────────────────────────────────── */
  async function scan(onProgress) {
    var Q = root.QLD, F = root.QLFin, OCR = root.BillOCR;
    if (!Q || !F || !OCR) return { error: 'The bill reader is not loaded on this page.' };
    var rows = candidates(Q.purchaseRows());
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
    }
    return { found: found, missed: missed, scanned: rows.length };
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

  var API = { scan: scan, apply: apply, verdict: verdict, candidates: candidates, arithmeticAgrees: arithmeticAgrees };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.QLQtyBackfill = API;
})(typeof window !== 'undefined' ? window : globalThis);
