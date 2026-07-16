/* ═══════════════════════════════════════════════════════════════════════
   dedupe.js — find what is ALREADY duplicated in the books.

   import-guard.js stops new duplicates at the door. It cannot help with what is
   already inside: the user re-uploaded the same statements and bills before the
   gate existed, so one PRINCE LIME payment sits there three times. This finds
   those. It does not remove anything — it reports, and the user decides.

   IT USES THE GATE'S OWN KEYS. Not a second opinion: if `dedupe` called something
   a duplicate that `import-guard` would have let in, the app would be deleting
   rows it would happily re-import a minute later. One definition of "the same
   transaction", used by both. That is why refKey/docKey are imported rather than
   re-derived here — this codebase's recurring bug is one rule written twice.

   SO IT INHERITS THE GATE'S CAUTION, WHICH IS THE POINT:
     · a repeated UTR / cheque / RRN IS the same transaction        → reported
     · a repeated invoice number from the same party IS the same doc → reported
     · same date + same party + same amount, no reference            → NOT reported
   A customer really can pay ₹1,00,000 twice in one day. Listing that as a
   duplicate invites the user to delete real money with one click, and a cleanup
   screen is exactly where they would trust it.

   WHICH COPY SURVIVES is not arbitrary. The user has reconciled some of these
   rows — matched them to bills, split them, taught the app an alias. Keeping the
   bare copy and deleting the reconciled one would silently destroy that work, so
   the most-worked row wins and ties go to the earliest (the original).
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var G = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./import-guard.js')
    : root.ImportGuard;

  /* How much work is invested in a bank row. Higher survives. */
  function txnWork(t) {
    if (!t) return 0;
    var m = t.m || {};
    var linked = m.idx != null || m.entryId || (Array.isArray(m.allocs) && m.allocs.length) || m.status === 'other' || m.manual;
    if (linked) return 2;                       // reconciled — never throw this away for a bare copy
    if (m.confidence != null && m.confidence >= 0) return 1;   // the engine has an opinion
    return 0;
  }

  /* Group rows by a key function, keeping only groups with more than one member.
     `work` scores which member survives; ties go to the EARLIEST (lowest index),
     because the first import is the original and later ones are the re-uploads. */
  function groupDupes(entries, keyOf, work) {
    var by = {}, out = [];
    (entries || []).forEach(function (e) {
      var k = keyOf(e.row);
      if (!k) return;                            // no certain identity → never grouped
      (by[k] || (by[k] = [])).push(e);
    });
    Object.keys(by).forEach(function (k) {
      var g = by[k];
      if (g.length < 2) return;
      var best = g[0];
      g.forEach(function (e) {
        var w = work(e.row), bw = work(best.row);
        if (w > bw || (w === bw && e.i < best.i)) best = e;
      });
      out.push({
        key: k,
        keep: best,
        dupes: g.filter(function (e) { return e !== best; }),
        count: g.length
      });
    });
    return out;
  }

  /* `i` is the index into the CALLER'S array and must stay that way: the UI deletes
     by index (deleteSale(i)), so an index into some filtered copy would delete a
     DIFFERENT bill. Pairing the index at the source and filtering the pairs — never
     filtering first and indexing after — is what keeps that honest. This was a real
     bug here: live() filtered, then groupDupes re-indexed, so one already-deleted
     row shifted every index by one. */
  function entriesOf(rows) { return (rows || []).map(function (r, i) { return { row: r, i: i }; }); }

  function scanTxns(txns) { return groupDupes(entriesOf(txns), G.refKey, txnWork); }

  /* A voided/deleted row is already gone — re-reporting it would have the user
     "removing" the same thing forever, and the count would never reach zero. */
  function live(entries) { return entries.filter(function (e) { return e.row && !e.row._del && !e.row._void; }); }

  function scanDocs(docs) {
    return groupDupes(live(entriesOf(docs)), G.docKey, function (d) {
      /* A bill with payments recorded against it is the one the books know about.
         Deleting it and keeping the untouched copy would strand the payments. */
      var paid = (+d.paid || 0) > 0 || (d.payments && d.payments.length);
      return paid ? 2 : ((d.attach && d.attach.length) ? 1 : 0);
    });
  }

  /* The whole picture, for a review screen. */
  function scan(state) {
    state = state || {};
    var t = scanTxns(state.txns), s = scanDocs(state.sales), p = scanDocs(state.purchases);
    var n = function (gs) { return gs.reduce(function (a, g) { return a + g.dupes.length; }, 0); };
    return {
      txns: t, sales: s, purchases: p,
      counts: { txns: n(t), sales: n(s), purchases: n(p) },
      total: n(t) + n(s) + n(p)
    };
  }

  var API = { txnWork: txnWork, groupDupes: groupDupes, entriesOf: entriesOf, scanTxns: scanTxns, scanDocs: scanDocs, scan: scan };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.Dedupe = API;
})(typeof window !== 'undefined' ? window : globalThis);
