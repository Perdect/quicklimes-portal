/* ═══════════════════════════════════════════════════════════════════════
   import-guard.js — what may NOT enter the books twice.

   Reported: one ₹1,00,000 payment from PRINCE LIME appeared three times, two
   badged "Duplicate". The badge was working; the rows should never have been
   there. This decides that, before anything is stored.

   THE RULE, and it is the whole file:

       REJECT WHEN CERTAIN. FLAG WHEN NOT. NEVER SILENTLY DROP REAL MONEY.

   A reference — UTR, cheque number, RRN — is unique by construction. If it
   repeats, it IS the same transaction, and dropping the copy is free of risk.
   That is the PRINCE LIME case: same ref 0012545409, three times.

   Without a reference, "same date + same party + same amount" is NOT proof. A
   customer really can pay ₹1,00,000 twice in one day. Dropping the second would
   remove a real payment permanently, with no badge and no message — the books
   would quietly show less than the bank, and nobody would know to look. So those
   are imported and FLAGGED for a human, exactly as before.

   Same shape as the two rules already in this codebase: a GSTIN match merges
   parties and a NAME match only suggests (party-identity.js); a normalised phone
   is dialled and an un-normalisable one is refused rather than guessed
   (wa-core.js). Certainty decides whether the machine may act alone.

   File-level: a SHA-256 of the bytes. Same hash = same file, whatever it was
   renamed to. Rejected outright — there is no legitimate reading of "import this
   identical file again".

   NOTE ON THE SPEC THIS IMPLEMENTS: it asked for backend validation, HTTP 409
   and DB unique constraints. Statement files are parsed ENTIRELY in the browser
   and never uploaded (see reconcile.js: the PDF password "stays in this tab …
   and is never stored or uploaded") — so there is no upload to 409, and adding
   one would mean shipping the firm's statements and passwords to a server to
   gain nothing. And sales/purchases live inside one JSON blob, not rows, so
   there is no column to make UNIQUE. This is the same guarantee enforced where
   the data actually is.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var norm = function (s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); };

  /* A reference is only usable as an identity if it is actually distinguishing.
     "0", "NA", "-" and 3-digit sequence numbers appear on every line of some
     statement formats; treating those as a UTR would make every line a duplicate
     of the first and silently delete a whole statement. */
  function usableRef(ref) {
    var r = norm(ref);
    if (r.length < 6) return '';                 // too short to be a UTR/RRN/cheque
    if (/^0+$/.test(r)) return '';               // 000000
    if (/^(NA|NIL|NONE|NULL)$/.test(r)) return '';
    return r;
  }

  /* ── BANK STATEMENT ROWS ────────────────────────────────────────
     Returns { keep: [], dropped: [] }. `existing` are the rows already stored.
     Only a REFERENCE match drops. Everything else is the caller's problem — and
     reconcile.js already badges those as "Duplicate" for a human. */
  function refKey(t) {
    var ref = usableRef(t.utr || t.ref || t.chq || '');
    if (!ref) return '';
    var dir = (+t.credit || 0) > 0 ? 'C' : 'D';
    var amt = Math.round((+t.credit || 0) + (+t.debit || 0));
    /* The amount and direction ride along with the ref on purpose: some banks
       reuse an RRN across the two legs of a reversal (a credit and a debit of the
       same value). Those are two real entries and both must survive. */
    var acc = t.accountId ? 'A' + t.accountId : 'A?';
    return acc + '|' + dir + '|' + ref + '|' + amt;
  }

  function screenTxns(incoming, existing) {
    var seen = {}, keep = [], dropped = [];
    (existing || []).forEach(function (t) { var k = refKey(t); if (k) seen[k] = t; });
    (incoming || []).forEach(function (t) {
      var k = refKey(t);
      if (k && seen[k]) { dropped.push({ txn: t, because: 'reference ' + usableRef(t.utr || t.ref || t.chq) + ' is already imported' }); return; }
      if (k) seen[k] = t;          // also catches repeats WITHIN one file
      keep.push(t);
    });
    return { keep: keep, dropped: dropped };
  }

  /* ── FILE ────────────────────────────────────────────────────────
     Same bytes = same file. Renaming does not change the hash, which is the
     point: "statement.pdf" and "statement (1).pdf" are caught. */
  function fileVerdict(sha, statements) {
    if (!sha) return { dup: false };
    var hit = (statements || []).find(function (s) { return s.sha && s.sha === sha; });
    return hit ? { dup: true, of: hit } : { dup: false };
  }

  /* ── LEDGER DOCUMENTS (sales invoice / purchase bill) ────────────
     An invoice NUMBER is the reference here, and within one firm's own series it
     is unique by law — Rule 46 requires a consecutive serial number. So a repeat
     of (number + party) IS the same document.

     The AMOUNT is deliberately NOT part of the key. If the same invoice number
     arrives with a different amount, that is not a new invoice — it is the same
     invoice, corrected or misread by OCR. Including the amount would let both
     versions in and leave two conflicting records of one legal document. */
  function docKey(d) {
    var no = norm(d.inv || d.bill || d.no || '');
    if (!no) return '';                            // no number → cannot be certain → never reject
    var party = norm(d.gstin || d.party || d.sup || '');
    if (!party) return '';                         // unknown counterparty → not certain
    return no + '|' + party;
  }
  function docVerdict(incoming, existing) {
    var k = docKey(incoming);
    if (!k) return { dup: false, reason: 'not enough identity to be sure — imported for review' };
    var hit = (existing || []).find(function (d) { return docKey(d) === k; });
    if (!hit) return { dup: false };
    var amtIn = Math.round(+incoming.total || +incoming.amount || 0);
    var amtHit = Math.round(+hit.total || +hit.amount || 0);
    return {
      dup: true, of: hit,
      amountDiffers: amtIn !== amtHit,
      reason: amtIn !== amtHit
        ? 'Invoice ' + (incoming.inv || incoming.bill) + ' already exists with a different amount (₹' + amtHit + ' vs ₹' + amtIn + '). Same invoice, not a new one — check which figure is right.'
        : 'Invoice ' + (incoming.inv || incoming.bill) + ' from this party is already recorded.'
    };
  }

  /* ── CUSTOMER PAYMENT ────────────────────────────────────────────
     A reference again. Without one, two identical payments on one day are
     possible and must both survive. */
  function payKey(p) {
    var ref = usableRef(p.ref || p.utr || p.chq || '');
    if (!ref) return '';
    return norm(p.party || '') + '|' + ref + '|' + Math.round(+p.amount || 0);
  }
  function payVerdict(incoming, existing) {
    var k = payKey(incoming);
    if (!k) return { dup: false, reason: 'no reference — two identical payments in a day are possible, so this is not rejected' };
    var hit = (existing || []).find(function (p) { return payKey(p) === k; });
    return hit ? { dup: true, of: hit, reason: 'A payment of ₹' + Math.round(+incoming.amount || 0) + ' with reference ' + usableRef(incoming.ref || incoming.utr) + ' is already recorded.' } : { dup: false };
  }

  var API = {
    usableRef: usableRef, refKey: refKey, screenTxns: screenTxns,
    fileVerdict: fileVerdict, docKey: docKey, docVerdict: docVerdict,
    payKey: payKey, payVerdict: payVerdict
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.ImportGuard = API;
})(typeof window !== 'undefined' ? window : globalThis);
