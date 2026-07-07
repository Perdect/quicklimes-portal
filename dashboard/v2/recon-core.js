/* ═══════════════════════════════════════════════════════════════════════
   ReconCore — pure, dependency-free bank-reconciliation intelligence.
   No DOM, no globals: usable in the browser (window.ReconCore) AND in Node
   (module.exports) so every function is unit-tested. This is the matching
   brain: narration parsing (raw + clean + structured refs), weighted
   confidence scoring, alias resolution, classification, dedupe, bank detect.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReconCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── text utilities ─────────────────────────────────────────────────── */
  function normName(s) { return (s || '').toString().toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function tokens(s) { return normName(s).split(' ').filter(Boolean); }
  // Generic entity words that carry no identifying power for an Indian firm.
  var STOP = new Set(('AND THE OF FOR CO PVT LTD LIMITED PRIVATE COMPANY INDUSTRIES INDUSTRY ENTERPRISES ENTERPRISE ' +
    'TRADERS TRADING MINERALS MINERAL CHEMICAL CHEMICALS LIME HYDRATED CORPORATION CORP LLP HUF SONS BROS BROTHERS ' +
    'AGENCIES AGENCY STORES STORE SUPPLIERS SUPPLIER ASSOCIATES UDYOG FIRM PRODUCTS PRODUCT ALLIED GROUP INDIA').split(' '));
  function distinctive(toks) { return toks.filter(function (t) { return t.length >= 3 && !STOP.has(t); }); }
  function daysBetween(a, b) { var x = new Date(a + 'T00:00'), y = new Date(b + 'T00:00'); var n = Math.round((x - y) / 86400000); return isFinite(n) ? n : 999; }

  /* ── narration parsing ──────────────────────────────────────────────────
     Splits raw narration into { raw, clean, utr, cheque, mode }.  Multi-line
     safe (caller concatenates wrapped lines before calling).  Never loses the
     party text: bank codes / reference blobs / mode words are stripped, the
     human name is kept.  Raw is preserved verbatim. */
  var MODE_WORDS = ['RTGS', 'NEFT', 'IMPS', 'UPI', 'ACH', 'NACH', 'ECS', 'CMS', 'MMT', 'POS', 'ATM', 'CHQ', 'CHEQUE', 'CASH', 'EMI', 'INT', 'CHRG', 'CHARGES', 'GST', 'TDS'];
  var NOISE = new Set(('RTGS NEFT IMPS UPI ACH NACH ECS CMS MMT POS ATM IB MB IMB BIL BILLDESK PAYU RAZORPAY COLL CR DR TO ' +
    'FROM BY REF TXN TRF TRANSFER PAYMENT PYMT PAY PURPOSE NA INB NB CASH WITHDRAWAL WDL CWDR SELF DEPOSIT DEP CHQ CHEQUE NO NUM').split(' '));
  var RE_GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]Z[A-Z\d]\b/;
  function looksRef(s) {                      // bank ref / UTR / txn-id blob
    if (/^\d{6,}$/.test(s)) return true;                       // long pure number
    if (/[A-Z]/.test(s) && /\d/.test(s) && s.length >= 8) {    // mixed alnum, mostly digits
      var digits = (s.match(/\d/g) || []).length;
      if (digits / s.length >= 0.4) return true;
    }
    return false;
  }
  function parseNarration(raw) {
    raw = (raw == null ? '' : String(raw)).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    var U = raw.toUpperCase();
    var mode = (U.match(new RegExp('\\b(' + MODE_WORDS.join('|') + ')\\b')) || [])[1] || '';
    // structured references
    var utr = '';
    var m = U.match(/\b(?:UTR|RRN|TXN|REF|RTGS|NEFT|IMPS)[:# ]*([A-Z0-9]{10,22})\b/);
    if (m) utr = m[1];
    if (!utr) { var m2 = U.match(/\b([A-Z]{2,6}[A-Z0-9]{9,20})\b/); if (m2 && /\d/.test(m2[1])) utr = m2[1]; }
    if (!utr) { var m3 = U.match(/\b(\d{12,22})\b/); if (m3) utr = m3[1]; }
    var cheque = (U.match(/\b(?:CHQ|CHEQUE|CHECK)\s*(?:NO|NUM|NUMBER|#)?[ :.#-]*(\d{5,8})\b/) || [])[1] || '';
    // clean party text
    var segs = raw.split(/[\-\/|*:>_]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var parts = [];
    segs.forEach(function (seg) {
      // strip a leading mode/junk word inside the segment ("RTGS CR ARIF" -> "ARIF")
      var s = seg.replace(new RegExp('^(' + MODE_WORDS.join('|') + '|CR|DR|BY|TO|FROM|REF|A\\/C|AC)\\b\\s*', 'i'), '').trim();
      if (!s) return;
      if (RE_GSTIN.test(s.replace(/\s/g, ''))) return;
      var kept = s.split(/\s+/).filter(function (w) {
        var wu = w.toUpperCase();
        if (/^\d+$/.test(w)) return false;            // pure number token
        if (NOISE.has(wu)) return false;               // mode / junk word
        if (looksRef(wu)) return false;                // ref blob
        return /[A-Za-z]/.test(w);
      }).join(' ').trim();
      if (kept && /[A-Za-z]{2,}/.test(kept)) parts.push(kept);
    });
    var clean = normName(parts.join(' '));
    if (!clean) {   // fallback: keep alphabetic tokens from the whole raw
      clean = normName(U.split(/\s+/).filter(function (w) { return /^[A-Z][A-Z.&]{1,}$/.test(w) && !NOISE.has(w) && MODE_WORDS.indexOf(w) < 0; }).join(' '));
    }
    return { raw: raw, clean: clean, utr: utr, cheque: cheque, mode: mode };
  }

  /* ── name matching ──────────────────────────────────────────────────────
     Score 0..1 of how strongly `clean` narration identifies `party`.
     Rewards distinctive-token overlap + containment (so a distinctive prefix
     like "ARIF" fully matches "ARIF CHEMICAL LIME"), ignores generic words. */
  function nameMatch(clean, party) {
    var cToks = tokens(clean), pToks = tokens(party);
    if (!cToks.length || !pToks.length) return { s: 0, shared: [] };
    var cSet = new Set(cToks);
    var pDist = distinctive(pToks), cDist = distinctive(cToks);
    var sharedDist = pDist.filter(function (t) { return cSet.has(t); });
    // ALL of the party's distinctive tokens are present → certain
    if (pDist.length && sharedDist.length === pDist.length) return { s: 1, shared: sharedDist };
    var distRatio = pDist.length ? sharedDist.length / pDist.length : 0;
    // containment, but only trusted when a distinctive token is shared
    var cJoin = cToks.join(' '), pJoin = pToks.join(' ');
    var contain = (cJoin.indexOf(pJoin) >= 0 || pJoin.indexOf(cJoin) >= 0) && sharedDist.length > 0 ? 0.9 : 0;
    var allShared = pToks.filter(function (t) { return cSet.has(t); }).length / pToks.length;
    return { s: Math.max(distRatio, contain, allShared * 0.75), shared: sharedDist };
  }

  /* ── debit classification (non-bill outflows) ──────────────────────────── */
  function classifyDebit(np) {
    var d = normName(np.raw) + ' ' + normName(np.clean);
    var rules = [
      ['Interest', /\bINT(EREST)?\b|\bINTT\b/], ['Loan EMI', /\bEMI\b/], ['Loan principal', /PRINCIPAL/],
      ['Processing charges', /PROCESS(ING)? (CHG|CHARGE|FEE)/], ['Bank charges', /\b(CHG|CHRG|CHARGE|CHARGES|SMS CHG|AMC|FOLIO|MIN BAL|PENAL)\b/],
      ['OD / CC charges', /\b(OD|CC)\b.*(CHARGE|INT|CHG)/], ['GST payment', /\bGST\b|GSTIN|\bCGST\b|\bSGST\b|\bIGST\b/], ['TDS', /\bTDS\b|194[A-Z]/],
      ['Salary', /SALARY|\bSAL\b|WAGES|PAYROLL/], ['Fuel', /FUEL|PETROL|DIESEL|HPCL|BPCL|\bIOC\b/],
      ['Royalty', /ROYALTY/], ['Pet Coke', /PET ?COKE|PETCOKE/], ['Limestone', /LIME ?STONE|LIMESTONE/],
      ['Labour', /LABOUR|LABOR|MAZDOOR|WAGE/], ['Electricity', /ELECTRIC|POWER|JVVNL|DISCOM|BILL(ING)? ?DESK.*ELEC/],
      ['Cash withdrawal', /ATM|CASH ?WDL|CASH ?WITHDRAW|CWDR|SELF ?WD/], ['Partner transfer', /\bSELF\b|OWN A\/C|OWN AC|INTERNAL/],
      ['UPI', /\bUPI\b/]
    ];
    for (var i = 0; i < rules.length; i++) if (rules[i][1].test(d)) return rules[i][0];
    return null;
  }

  /* ── weighted confidence match of one transaction against one bill ─────── */
  function scoreMatch(np, txn, bill, opts) {
    opts = opts || {};
    var isCr = (txn.credit || 0) > 0, amt = isCr ? txn.credit : txn.debit;
    var name = isCr ? bill.party : bill.sup;
    var reasons = [], score = 0;
    var nm = nameMatch(np.clean, name).s;
    if (opts.aliasParty && normName(opts.aliasParty) === normName(name)) { nm = Math.max(nm, 1); reasons.push('Learned alias → ' + name); }
    if (nm >= 0.99) { score += 55; reasons.push('Party name matched'); }
    else if (nm >= 0.6) { score += Math.round(48 * nm); reasons.push('Party name likely (' + Math.round(nm * 100) + '%)'); }
    else if (nm > 0) { score += Math.round(22 * nm); }
    // amount
    var total = bill.total || 0, out = (bill.outstanding != null ? bill.outstanding : total);
    var dExact = Math.min(Math.abs(amt - total), Math.abs(amt - out));
    var amtKind = 'none';
    if (dExact < 1 || dExact < amt * 0.01) { score += 30; reasons.push('Amount matches exactly'); amtKind = 'exact'; }
    else if (amt < out - 1 && amt >= out * 0.1) { score += 15; reasons.push('Partial payment (' + Math.round(amt / out * 100) + '% of due)'); amtKind = 'partial'; }
    else if (amt > total + 1 && total > 0 && nm >= 0.6) { score += 8; reasons.push('Exceeds the bill (overpayment/advance?)'); amtKind = 'over'; }
    // corroboration bonus when strong name AND exact amount agree
    if (nm >= 0.99 && amtKind === 'exact') { score += 12; reasons.push('Name + amount corroborate'); }
    // references
    var ref = isCr ? bill.inv : bill.bill;
    if (ref && String(ref).length >= 2 && normName(np.raw).indexOf(normName(ref)) >= 0) { score += 22; reasons.push('Invoice/Bill no. found in narration'); }
    if (bill.gstin && normName(np.raw).indexOf(normName(bill.gstin)) >= 0) { score += 18; reasons.push('GSTIN found in narration'); }
    if (np.utr && bill.payRef && normName(bill.payRef).indexOf(normName(np.utr)) >= 0) { score += 25; reasons.push('UTR/Ref matches recorded payment'); }
    // date proximity
    var dd = Math.abs(daysBetween(txn.date, bill.date || txn.date));
    if (dd <= 3) { score += 10; reasons.push('Dates close (' + dd + 'd)'); } else if (dd <= 20) score += 4; else if (dd > 75) score -= 8;
    // a certain party name floors confidence into "review" even without amount
    var confidence = Math.max(0, Math.min(100, Math.round(score)));
    if (nm >= 0.99) confidence = Math.max(confidence, 76);
    return { confidence: confidence, nm: nm, amtKind: amtKind, reasons: reasons, dExact: dExact };
  }

  /* ── best match of a txn across all candidate bills ────────────────────── */
  function bestMatch(np, txn, bills, opts) {
    opts = opts || {};
    var isCr = (txn.credit || 0) > 0;
    var best = null;
    for (var i = 0; i < bills.length; i++) {
      var b = bills[i]; if (b.status === 'cancelled') continue;
      var r = scoreMatch(np, txn, b, opts);
      if (!best || r.confidence > best.r.confidence) best = { bill: b, r: r };
    }
    if (!best || best.r.confidence < 40) {
      // debit that isn't a purchase → classify; else unknown/unmatched
      if (!isCr) { var cat = classifyDebit(np); if (cat) return { idx: null, kind: 'other', status: 'other', cat: cat, confidence: 90, tier: 'green', matchedBy: 'rule', reasons: ['Classified as ' + cat] }; }
      var anyName = false;
      for (var j = 0; j < bills.length; j++) { if (nameMatch(np.clean, isCr ? bills[j].party : bills[j].sup).s >= 0.6) { anyName = true; break; } }
      return { idx: null, kind: isCr ? 'sale' : 'purchase', status: anyName ? 'unmatched' : 'unknown', confidence: best ? best.r.confidence : 0, tier: 'red', matchedBy: 'ai', reasons: ['No confident bill match'] };
    }
    var r = best.r, conf = r.confidence, tier = conf >= 95 ? 'green' : conf >= 75 ? 'yellow' : 'red';
    var status;
    if (r.amtKind === 'partial') status = 'partial';
    else if (r.amtKind === 'over') status = 'overpayment';
    else if (tier === 'green') status = 'matched';
    else if (tier === 'yellow') status = 'review';
    else status = r.nm >= 0.6 ? 'unmatched' : 'unknown';
    // green auto-links; yellow suggests (still links idx but flagged review); red no link
    var linkIdx = (tier === 'red') ? null : best.bill.idx;
    return { idx: linkIdx, kind: isCr ? 'sale' : 'purchase', status: status, confidence: conf, tier: tier, matchedBy: 'ai', reasons: r.reasons, cat: isCr ? undefined : best.bill.group };
  }

  /* ── duplicate key ──────────────────────────────────────────────────────
     A duplicate is the SAME bank line appearing twice (re-import, double
     post) — so the key must use the FULL raw narration, not the lossy clean
     name. Using clean wrongly merged distinct lines that differ only in a
     stripped word/ref: e.g. "…/BOB to BOb Cr" vs "…/BOB to BOb Dr" (the two
     legs of a self-transfer share a reference) collapsed to one key and the
     second was flagged Duplicate. Full-raw + direction + amount + date keeps
     genuinely different lines apart while still catching real duplicates. */
  function dedupeKey(np, txn) {
    var dir = (txn.credit || 0) > 0 ? 'C' : 'D', amt = Math.round((txn.credit || 0) + (txn.debit || 0));
    var sig = normName(np.raw || np.clean || '');
    if (np.utr) return dir + '|UTR|' + np.utr + '|' + amt + '|' + sig;
    return dir + '|' + amt + '|' + (txn.date || '') + '|' + sig;
  }

  /* ── bank auto-detection from statement text ───────────────────────────── */
  var BANKS = [['ICICI', /ICICI/], ['HDFC', /HDFC/], ['SBI', /\bSBI\b|STATE BANK/], ['Bank of Baroda', /BANK OF BARODA|\bBOB\b|BARB0/],
    ['Axis', /AXIS/], ['Kotak', /KOTAK/], ['Canara', /CANARA/], ['Union', /UNION BANK/], ['PNB', /PUNJAB NATIONAL|\bPNB\b/],
    ['IDFC', /IDFC/], ['IndusInd', /INDUSIND/], ['Federal', /FEDERAL BANK/], ['YES', /\bYES BANK\b/], ['AU', /\bAU (SMALL|BANK)/], ['IOB', /INDIAN OVERSEAS/]];
  function detectBank(text) { var U = (text || '').toString().toUpperCase(); for (var i = 0; i < BANKS.length; i++) if (BANKS[i][1].test(U)) return BANKS[i][0]; return ''; }

  /* ── split: allocate one payment across many bills ─────────────────────── */
  // Decide the status of a split. allocs = [{amount}]. tol absorbs rounding.
  function splitStatus(payment, allocs, tol) {
    tol = tol == null ? 1 : tol;
    var total = 0; for (var i = 0; i < (allocs || []).length; i++) total += (+allocs[i].amount || 0);
    total = Math.round(total * 100) / 100;
    var rem = Math.round((payment - total) * 100) / 100;
    var status = rem < -tol ? 'over' : (Math.abs(rem) <= tol ? 'matched' : 'partial');
    return { total: total, remaining: rem, status: status, valid: total > 0 && rem >= -tol };
  }
  // Suggest an amount for the next bill: fill the remaining, capped at its due.
  function suggestAlloc(payment, allocatedTotal, billDue) {
    var rem = Math.round((payment - allocatedTotal) * 100) / 100;
    if (rem <= 0) return 0;
    var due = (+billDue || 0);
    return Math.round((due > 0 ? Math.min(rem, due) : rem) * 100) / 100;
  }

  return {
    normName: normName, tokens: tokens, distinctive: distinctive, daysBetween: daysBetween,
    parseNarration: parseNarration, nameMatch: nameMatch, classifyDebit: classifyDebit,
    scoreMatch: scoreMatch, bestMatch: bestMatch, dedupeKey: dedupeKey, detectBank: detectBank,
    splitStatus: splitStatus, suggestAlloc: suggestAlloc, STOP: STOP
  };
});
