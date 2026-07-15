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
    // Drop a TRAILING segment that is the beneficiary's BANK, not the party:
    // "SHUBHAM MINCHEM PVT LTD-AXIS" / "MATESHWARI MINES-PUNJAB NATI" — the
    // last dash-segment names the receiving bank on NEFT/RTGS narrations.
    while (parts.length > 1 && BANK_TAIL.test(normName(parts[parts.length - 1]))) parts.pop();
    var clean = normName(parts.join(' '));
    if (!clean) {   // fallback: keep alphabetic tokens from the whole raw
      clean = normName(U.split(/\s+/).filter(function (w) { return /^[A-Z][A-Z.&]{1,}$/.test(w) && !NOISE.has(w) && MODE_WORDS.indexOf(w) < 0; }).join(' '));
    }
    return { raw: raw, clean: clean, utr: utr, cheque: cheque, mode: mode };
  }
  // Trailing beneficiary-bank segments (whole-segment match only, so a party
  // genuinely named "AXIS ROADLINES" is never touched).
  var BANK_TAIL = /^(AXIS|HDFC|ICICI?|SBI N?|SBIN|PNB|PUNJAB NATI(ONAL)?( BANK)?|KOTAK( MAH(INDRA)?)?|YES( BANK)?|IDBI|BOB|BARODA|BANK OF BARODA|CANARA|UNION( BANK)?( OF INDIA)?|INDUSIND|FEDERAL|BANDHAN|AU SMALL( FIN(ANCE)?)?( BANK)?|UCO|CENTRAL BANK( OF INDIA)?|IOB|INDIAN OVERSEAS( BANK)?|IDFC( FIRST)?|RBL|DBS|HSBC|CITI|STANDARD CHARTERED|KARUR VYSYA|KVB|SOUTH INDIAN( BANK)?)( BANK)?( LTD| LIMITED)?$/;

  /* ── balance signing + direction inference ──────────────────────────────
     Indian statements print running balance as "26,836.73Cr" / "9,57,515.37Dr".
     A Cash-Credit account runs a Dr balance that GROWS with withdrawals, so any
     direction guess that ignores the Dr/Cr suffix inverts every transaction.
     signedBalance: Cr → +, Dr → −.  inferDirections: walks the balance chain
     (tries both latest-first and oldest-first row orders) and returns the
     arithmetically-certain direction of each row. */
  function signedBalance(s) {
    if (s == null) return null;
    var str = String(s).trim(); if (!str) return null;
    var neg = /D\s*R\.?\s*$/i.test(str) || /^-/.test(str);
    var n = parseFloat(str.replace(/[^0-9.]/g, ''));
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  }
  function inferDirections(rows) {
    var n = rows.length;
    function attempt(prevOf) {
      var ok = 0, dirs = new Array(n).fill('');
      for (var i = 0; i < n; i++) {
        var j = prevOf(i); if (j < 0 || j >= n) continue;
        var b = rows[i].bal, pb = rows[j].bal, a = +rows[i].amt || 0;
        if (b == null || pb == null || !a) continue;
        var d = Math.round((b - pb) * 100) / 100;
        if (Math.abs(d - a) <= 0.05) { dirs[i] = 'C'; ok++; }
        else if (Math.abs(d + a) <= 0.05) { dirs[i] = 'D'; ok++; }
      }
      return { ok: ok, dirs: dirs };
    }
    var desc = attempt(function (i) { return i + 1; });   // latest-first: balance before txn i sits on the NEXT row
    var asc = attempt(function (i) { return i - 1; });    // oldest-first
    var best = desc.ok >= asc.ok ? desc : asc;
    return { dirs: best.dirs, ok: best.ok, order: desc.ok >= asc.ok ? 'desc' : 'asc', n: n };
  }

  /* ── full-transaction classifier (both directions) ──────────────────────
     Hard rules that identify NON-BILL money movements before any invoice
     matching runs — bank charges, interest, loan EMIs, GST, self transfers,
     cash. Built from real Bank-of-Baroda narrations. Order matters: loan
     keywords beat SELF ("EBANK:SELF/…/Icic Loaninstalment" is a loan, not a
     self transfer); charges beat cash ("CHARGES FOR :ATM/CASH" is a fee). */
  // Each rule: [label, key, dir, regex]. dir gates by direction so a debit-only
  // marker never fires on a credit and vice-versa ('D' debit, 'C' credit, ''
  // both). Patterns are STRUCTURAL bank markers only — deliberately NOT generic
  // brand/word tokens like bare "EMI" or "SHRIRAM" that collide with real party
  // names (freight to "Shriram Transport" is a purchase, a customer named "EMI
  // Transport" is a receipt). The caller additionally lets a confident invoice
  // match override any rule, so a party payment is never swallowed as a fee.
  var TXN_RULES = [
    ['Bank charges', 'charges', 'D', /CHARGES? FOR PORD|PORD CUSTOMER PAYMENT|LEDGER FOLIO|FOLIO CHARGE|PENAL CHARGE|HRETCHARGE|DCARDFEE|ANNUAL ?FEE|CHARGES? FOR ?:? ?ATM|SMS (CHG|CHARGE)|\bAMC\b|MIN(IMUM)? ?BAL|PROCESSING (FEE|CHG|CHARGE)|SERVICE CHARGE|CHRG COLL/],
    ['Interest (CC/OD)', 'interest', 'D', /\bINT\.? ?COLL\b|\bINTEREST (COLL|DEBIT|CHARGED|RECOVER|APPLIED)/],
    ['Loan recovery', 'loanrec', 'D', /LOAN ?RECOVERY/],
    ['Loan / EMI', 'loan', 'D', /LOAN ?INSTAL|LOANINSTAL|\bACHDR\b|CMS\/ ?CHOLA|CHOLACSEL|CHOLAMANDALAM|HDB ?FIN|LOAN A\/?C\b/],
    ['GST refund', 'gst', 'C', /GST REFUNDS?( THRO)?|\bPAO GST|E ?PAO GST/],
    ['GST payment', 'gst', 'D', /\bGST\b.{0,12}(PAYMENT|EPAY|CHALLAN)|EPAY.{0,8}GST|\bCBIC\b/],
    ['Cash', 'cash', '', /^ ?TO CASH\b|ATM ?\/ ?CASH|CASH ?WDL|CASH ?WITHDRAW|\bCWDR\b|SELF ?WD/],
    ['Self transfer', 'self', '', /EBANK ?:? ?SELF|\bSELF\b.{0,24}(TRF|TRANSFER)|BOB TO BOB|OWN A\/?C|INTERNAL TRANSFER/]
  ];
  function classifyTxn(np, txn) {
    var U = ' ' + String(np.raw || '').toUpperCase().replace(/\s+/g, ' ') + ' ';
    var isCr = (txn.credit || 0) > 0;
    for (var i = 0; i < TXN_RULES.length; i++) {
      var rule = TXN_RULES[i], dir = rule[2];
      if (dir === 'D' && isCr) continue;                 // debit-only rule, credit txn
      if (dir === 'C' && !isCr) continue;                // credit-only rule, debit txn
      if (!rule[3].test(U)) continue;
      var cat = rule[0], key = rule[1];
      if (key === 'gst') cat = isCr ? 'GST refund' : 'GST payment';
      if (key === 'cash') cat = isCr ? 'Cash deposit' : 'Cash withdrawal';
      if (key === 'loanrec') key = 'loan';
      return { cat: cat, key: key, internal: key === 'self' || key === 'cash', confidence: 96, reasons: ['Recognized from narration: ' + cat] };
    }
    return null;
  }
  /* Residual classifier — runs AFTER invoice matching fails. Own sister firms
     (e.g. Deshwali Minerals ↔ Gotan Lime) often pay each other's invoices, so
     invoice matching must win; only an UNMATCHED own-firm transfer becomes an
     "Inter-firm transfer" instead of a scary "Unknown party". */
  function classifyResidual(np, txn, opts) {
    var own = (opts && opts.ownNames) || [];
    var cDist = distinctive(tokens(np.clean));
    if (!cDist.length) return null;
    var cSet = new Set(cDist);
    for (var i = 0; i < own.length; i++) {
      var oDist = distinctive(tokens(own[i]));
      if (!oDist.length) continue;
      // Own firm fully present AND the narration carries NO extra distinctive
      // token — so "DESHWALI MINERALS" matches our Deshwali, but "GOTAN STONE
      // AND LIME COMPANY" (foreign token STONE) does NOT match "Gotan Lime".
      var allOwnPresent = oDist.every(function (t) { return cSet.has(t); });
      var noForeign = cDist.every(function (t) { return oDist.indexOf(t) >= 0; });
      if (allOwnPresent && noForeign) {
        // review-level ONLY (never auto-hidden): a real third-party receipt that
        // happens to share our root token still surfaces for the accountant.
        return { cat: 'Inter-firm transfer', key: 'interfirm', internal: true, review: true, confidence: 62, reasons: ['Narration matches your own firm "' + own[i] + '" — confirm it is an inter-firm transfer, or link it to a bill'] };
      }
    }
    return null;
  }
  /* Pair the two legs of a self transfer across accounts: same EBANK:SELF id
     (or same amount within 3 days, both self-ish), opposite directions. */
  function selfPairs(list) {
    var selfish = function (t) { return /EBANK ?:? ?SELF|BOB TO BOB|OWN A\/?C/i.test(String(t.raw || t.desc || '')); };
    var idOf = function (t) { var m = String(t.raw || '').toUpperCase().match(/SELF ?\/ ?(\d{6,})/); return m ? m[1] : ''; };
    var cr = [], dr = [];
    list.forEach(function (t, i) { if (!selfish(t)) return; ((t.credit || 0) > 0 ? cr : dr).push({ t: t, i: i, id: idOf(t), amt: (t.credit || t.debit || 0) }); });
    var used = {}, pairs = [];
    cr.forEach(function (c) {
      // id match is authoritative; the amount+date fallback only applies when
      // NEITHER leg carries an id — different ids are different transfers
      // ("EBANK:SELF/…/Icic Loaninstalment" must never pair with "Bob to Bob").
      var hit = dr.find(function (d) { return !used[d.i] && c.id && d.id === c.id && Math.abs(d.amt - c.amt) < 0.5; })
             || dr.find(function (d) { return !used[d.i] && !c.id && !d.id && Math.abs(d.amt - c.amt) < 0.5 && Math.abs(daysBetween(c.t.date, d.t.date)) <= 3; });
      if (hit) { used[hit.i] = 1; pairs.push({ creditIdx: c.i, debitIdx: hit.i, id: c.id || hit.id || '' }); }
    });
    return pairs;
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

  /* ── direction fallback ────────────────────────────────────────────────
     Last resort for an UNMATCHED bank line that still names a real party:
     money IN from a party = customer receipt, money OUT = supplier payment.
     Keeps anything with a counterparty out of a bare "Unknown". Runs only
     AFTER classifyTxn (charges/interest/self/loan) and invoice matching. */
  function directionCat(np, txn) {
    var party = distinctive(tokens(np.clean));
    if (!party.length) return null;                    // no party token → truly unknown
    var isCr = (txn.credit || 0) > 0;
    var who = np.clean || 'a party';
    return isCr
      ? { cat: 'Customer receipt', key: 'receipt', confidence: 60, reasons: ['Credit from ' + who + ' — not yet linked to a sales invoice'] }
      : { cat: 'Supplier payment', key: 'payment', confidence: 60, reasons: ['Debit to ' + who + ' — not yet linked to a purchase bill'] };
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

  /* ══ ALREADY-RECORDED PAYMENTS ═══════════════════════════════════════════
     THE DISTINCTION THAT MATTERS, AND THE ONE THAT LOSES MONEY IF CONFUSED:

       a bank line PAYS a bill      -> the money has not been recorded yet.
                                       Matching it POSTS a payment.
       a bank line IS an entry      -> the money is ALREADY in the cashbook
                                       (a freight payment, labour, royalty, an
                                       EMI). Matching it may only LINK. Posting
                                       again pays the party twice in the books,
                                       and it is wrong in the direction that
                                       HIDES money — the cashbook looks fuller
                                       than the bank.

     Why this exists: reconcile.js only ever offered PURCHASE BILLS as
     candidates for a debit —
         const bills = (t.credit||0) > 0 ? Q.salesRows() : Q.purchaseRows();
     — so ₹55,233 paid to "Nagour Golden Transport" (a freight payment on an IOC
     petcoke bill) could never match anything: the transporter's name was never
     in the candidate list. Every freight, labour, royalty and loan debit sat
     unmatched forever. The name was there all along on the cashbook entry.

     RULE: an ENTRY match always beats a BILL match. If the money is already
     recorded, the bank line is that record — never a fresh payment. */

  /* scoreEntry(np, txn, entry, opts) -> { confidence, reasons, nm }
     `entry` is a cashbook row: { id, date, amount, party, method, ref, kind } */
  function scoreEntry(np, txn, entry, opts) {
    opts = opts || {};
    var isCr = (txn.credit || 0) > 0, amt = isCr ? txn.credit : txn.debit;
    var reasons = [], score = 0;
    var nm = nameMatch(np.clean, entry.party).s;
    if (opts.aliasParty && normName(opts.aliasParty) === normName(entry.party)) { nm = Math.max(nm, 1); reasons.push('Learned alias → ' + entry.party); }
    if (nm >= 0.99) { score += 50; reasons.push('Paid-to name matched'); }
    else if (nm >= 0.6) { score += Math.round(42 * nm); reasons.push('Paid-to name likely (' + Math.round(nm * 100) + '%)'); }
    else if (nm > 0) score += Math.round(18 * nm);

    /* An already-recorded payment has ONE true amount — there is no "partial".
       Either this bank line is that payment or it is not. Anything less than an
       exact amount is not this entry. */
    var d = Math.abs(amt - (+entry.amount || 0));
    var exact = d < 1 || d < amt * 0.005;
    if (exact) { score += 38; reasons.push('Amount matches the recorded payment exactly'); }
    else return { confidence: 0, nm: nm, exact: false, reasons: ['Amount differs from the recorded payment'] };

    if (np.utr && entry.ref && normName(entry.ref).indexOf(normName(np.utr)) >= 0) { score += 25; reasons.push('UTR matches the recorded reference'); }
    /* THE DATE IS THE ONLY THING THAT SEPARATES ONE MONTH'S PAYMENT FROM THE NEXT.
       For a bill, name+amount nearly identify the match. For an already-recorded
       payment to a MONTHLY payee they identify nothing: the same party and the
       same ~amount recur by design. January's ₹1,00,000 to Mateshwari and
       February's are indistinguishable except by date — so a wide gap must pull
       the score below the auto-link line and let a human look, instead of
       silently reconciling this month's bank line against last month's entry. */
    var dd = Math.abs(daysBetween(txn.date, entry.date || txn.date));
    if (dd <= 2) { score += 12; reasons.push('Same day (±' + dd + 'd)'); }
    else if (dd <= 7) { score += 6; }
    else if (dd <= 14) { /* plausible lag between paying and recording */ }
    else if (dd <= 45) { score -= 20; reasons.push('Recorded ' + dd + ' days away — could be a different month\'s payment'); }
    else { score -= 35; reasons.push('Recorded ' + dd + ' days away — probably a different payment'); }

    /* A cash payment never appears on a bank statement. If the entry says Cash,
       this bank line is NOT it — matching them would reconcile money that never
       moved through this account. Both `method` ('Cash') and `mode` ('cash') are
       checked: method is free-text and is sometimes blank, and a guard that
       silently stops firing when a field is empty is not a guard. */
    if (/^cash$/i.test(entry.method || '') || /^cash$/i.test(entry.mode || '')) { score -= 40; reasons.push('Recorded as CASH — a bank line cannot be a cash payment'); }

    /* Money in one bank account is not money in another. When the statement line
       and the recorded payment both name an account and they differ, this is a
       different payment — regardless of how well the name and amount agree.
       Only applied when BOTH are known: rows imported before multi-bank have no
       accountId, and absence must not be read as disagreement. */
    if (opts.accountId && entry.accountId && opts.accountId !== entry.accountId) {
      score -= 45; reasons.push('Recorded against a different bank account');
    }
    return { confidence: Math.max(0, Math.min(100, Math.round(score))), nm: nm, exact: exact, reasons: reasons };
  }

  /* bestEntry(np, txn, entries, opts) -> { entry, r } | null */
  function bestEntry(np, txn, entries, opts) {
    var best = null;
    for (var i = 0; i < (entries || []).length; i++) {
      var e = entries[i];
      if (!e || !(+e.amount > 0)) continue;
      // direction must agree: a debit can only be money we PAID out.
      var isCr = (txn.credit || 0) > 0;
      if (isCr && e.dir === 'out') continue;
      if (!isCr && e.dir === 'in') continue;
      if (e.linked) continue;                     // already reconciled to another line
      var r = scoreEntry(np, txn, e, opts);
      if (r.confidence > 0 && (!best || r.confidence > best.r.confidence)) best = { entry: e, r: r };
    }
    return best;
  }

  /* ── the one decision point ──────────────────────────────────────────────
     resolve(np, txn, { bills, entries, opts }) -> a bill match, an entry LINK,
     or nothing. An entry ALWAYS wins a tie and beats a weaker bill match,
     because posting over an existing record double-counts real money. */
  function resolve(np, txn, ctx) {
    ctx = ctx || {};
    var opts = ctx.opts || {};
    var e = bestEntry(np, txn, ctx.entries || [], opts);
    if (e && e.r.confidence >= 70) {
      var tier = e.r.confidence >= 90 ? 'green' : 'yellow';
      return {
        action: 'link',                    // NEVER 'post' — the money is already recorded
        kind: 'entry', entryId: e.entry.id, idx: null,
        party: e.entry.party || '', entryDate: e.entry.date || '', entryAmount: +e.entry.amount || 0,
        status: tier === 'green' ? 'matched' : 'review',
        confidence: e.r.confidence, tier: tier, matchedBy: 'entry',
        cat: e.entry.kind || 'payment',
        reasons: ['Already recorded: ' + (e.entry.kind || 'payment') + ' to ' + (e.entry.party || '—')].concat(e.r.reasons)
      };
    }
    var b = bestMatch(np, txn, ctx.bills || [], opts);
    // A bill match POSTS money, so it must never fire when a plausible existing
    // record is sitting right there — ask instead.
    if (e && e.r.confidence >= 40 && b && b.idx != null) {
      return Object.assign({}, b, {
        action: 'ask', status: 'review', tier: 'yellow',
        reasons: ['Could be an already-recorded payment to ' + (e.entry.party || '—') + ' — confirm before posting'].concat(b.reasons || [])
      });
    }
    return Object.assign({ action: b && b.idx != null ? 'post' : 'none' }, b);
  }

  /* ── recurring payees ────────────────────────────────────────────────────
     "the party we pay every month". Learned from the firm's OWN cashbook, not a
     rule: same payee, a repeatable amount, a repeatable day. Used to raise
     confidence on a familiar debit and to spot a missed month.

     MIN_RUNS: below 3 payments there is no rhythm — the same rule the reorder
     engine uses. Two payments to a transporter is not "every month". */
  var MIN_RUNS = 3;
  function recurringPayees(entries, opts) {
    opts = opts || {};
    var by = {};
    (entries || []).forEach(function (e) {
      if (!e || !e.party || !(+e.amount > 0) || e.dir === 'in') return;
      var k = normName(e.party); if (!k) return;
      (by[k] = by[k] || { party: e.party, runs: [] }).runs.push(e);
    });
    return Object.keys(by).map(function (k) {
      var g = by[k];
      var rows = g.runs.slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
      if (rows.length < MIN_RUNS) {
        return { party: g.party, count: rows.length, confident: false,
                 why: rows.length + ' payment(s) — need ' + MIN_RUNS + ' before calling it monthly' };
      }
      var months = {};
      rows.forEach(function (r) { months[(r.date || '').slice(0, 7)] = 1; });
      var amts = rows.map(function (r) { return +r.amount || 0; }).sort(function (a, b) { return a - b; });
      var days = rows.map(function (r) { return +(r.date || '').slice(8, 10) || 0; }).filter(Boolean).sort(function (a, b) { return a - b; });
      var med = function (a) { var m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2); };
      var distinctMonths = Object.keys(months).length;
      return {
        party: g.party, count: rows.length, months: distinctMonths,
        medianAmount: med(amts), medianDay: med(days),
        lastDate: rows[rows.length - 1].date,
        // Monthly means one payment in each of several DIFFERENT months — three
        // payments in one week is a busy week, not a standing arrangement.
        monthly: distinctMonths >= MIN_RUNS,
        confident: distinctMonths >= MIN_RUNS,
        why: distinctMonths >= MIN_RUNS
          ? 'Paid in ' + distinctMonths + ' different months, usually around day ' + med(days)
          : rows.length + ' payments but only ' + distinctMonths + ' month(s) — not a monthly pattern'
      };
    }).filter(Boolean).sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
  }

  /* Is this debit a familiar monthly payee? Used only to RAISE confidence and
     to explain — never to invent a match on its own. */
  function knownPayee(np, txn, recurring) {
    var amt = (txn.debit || 0);
    for (var i = 0; i < (recurring || []).length; i++) {
      var r = recurring[i];
      if (!r.confident) continue;
      if (nameMatch(np.clean, r.party).s < 0.6) continue;
      var near = r.medianAmount > 0 && Math.abs(amt - r.medianAmount) <= r.medianAmount * 0.25;
      return { party: r.party, monthly: true, amountUsual: !!near,
               why: near ? 'You pay ' + r.party + ' about every month (~₹' + Math.round(r.medianAmount).toLocaleString('en-IN') + ')'
                         : 'You pay ' + r.party + ' about every month, but this amount is unusual' };
    }
    return null;
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
    // ACCOUNT-SCOPED (multi-bank): the same UTR landing in TWO DIFFERENT own
    // accounts is two real transactions (e.g. a customer paying BOB once and
    // HDFC once with the bank reusing a ref), never a duplicate — so the key
    // carries the account. Legacy txns without accountId keep the exact old
    // key; the caller handles legacy-vs-scoped compatibility (see reconcile.js).
    var scope = txn.accountId ? 'A' + txn.accountId + '|' : '';
    return scope + dedupeKeyBase(np, txn);
  }
  function dedupeKeyBase(np, txn) {
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

  /* ── multi-bank backfill (Phase 6) ────────────────────────────────────────
     Pure planner: given the stored txns and the firm's BANK_ACCOUNTS, decide
     which txns get which accountId (matching each txn's import-time t.bank to
     an account by bank name, label as fallback) and which accounts must be
     created first (a distinct t.bank with no matching account). Blank-bank
     txns are left untouched — they stay in the "Unassigned" bucket for manual
     reassignment. NO-REGRESSION RULE: a firm with zero accounts and at most
     one distinct bank keeps today's single-implicit-account behaviour. */
  function bankAccountMatch(bank, accounts) {
    var bl = (bank || '').toLowerCase().trim();
    if (!bl) return null;
    for (var i = 0; i < (accounts || []).length; i++) {
      var ab = (accounts[i].bank || '').toLowerCase().trim();
      if (ab && (ab.indexOf(bl) >= 0 || bl.indexOf(ab) >= 0)) return accounts[i];
    }
    for (var j = 0; j < (accounts || []).length; j++) {
      if (((accounts[j].label || '').toLowerCase()).indexOf(bl) >= 0) return accounts[j];
    }
    return null;
  }
  function backfillPlan(txns, accounts) {
    txns = txns || []; accounts = accounts || [];
    var pending = txns.filter(function (t) { return !t.accountId; });
    var banks = {};
    pending.forEach(function (t) { var b = (t.bank || '').trim(); if (b) banks[b] = (banks[b] || 0) + 1; });
    var names = Object.keys(banks);
    if (!accounts.length && names.length <= 1) return { creates: [], assigns: [], map: {}, skipped: 'implicit-single-bank' };
    var creates = [], map = {};
    names.forEach(function (b) {
      var hit = bankAccountMatch(b, accounts);
      if (hit) map[b] = hit.id; else { creates.push(b); map[b] = ''; }   // '' → create, then fill in
    });
    var assigns = [];
    pending.forEach(function (t) { var b = (t.bank || '').trim(); if (b && b in map) assigns.push({ id: t.id, bank: b }); });
    return { creates: creates, assigns: assigns, map: map, blank: pending.length - assigns.length };
  }

  /* ── per-account overview (multi-bank Phase 4) ──────────────────────────
     Pure math for the Banks dashboard. For each account:
       • statedBal   — the running balance printed on the LATEST imported row
                       (statement truth; already signed for CC/OD/loan rows).
       • computedBal — openingBalance + Σcredits − Σdebits (rows on/after the
                       opening date). With no rows at all it IS the opening.
       • balance     — stated wins when present, computed otherwise.
       • drift       — stated − computed when BOTH are known and an opening
                       was configured: a non-zero drift means rows are missing
                       between the opening date and the first statement.
       • ym / in / out — the account's LATEST data month and its gross flows.
       • toReview    — rows still needing a human (review/unmatched/unknown).
     Totals NET OF INTERNAL TRANSFERS: a self-transfer A→B moves money between
     own accounts, so the combined in/out excludes those legs — otherwise the
     firm's "money in" inflates by every internal move. Balances are unaffected
     (the legs cancel across accounts). */
  function isSelfLeg(t) { var m = t && t.m || {}; return m.catKey === 'self' || /self\s*transfer/i.test(m.cat || ''); }
  function needsHuman(t) { var s = (t && t.m || {}).status; return !s || s === 'review' || s === 'unmatched' || s === 'unknown'; }
  function accountOverview(txns, accounts) {
    txns = txns || []; accounts = accounts || [];
    var ymOf = function (d) { return (d || '').slice(0, 7); };
    var rows = accounts.map(function (a) {
      var mine = txns.filter(function (t) { return t.accountId === a.id; });
      mine.sort(function (x, y) { return (x.date || '').localeCompare(y.date || ''); });
      var last = mine.length ? mine[mine.length - 1] : null;
      var lastDate = last ? last.date : '';
      // stated balance: the balance on the latest DATED row that carries one
      var statedBal = null;
      for (var i = mine.length - 1; i >= 0; i--) { if (mine[i].balance != null && mine[i].date === lastDate) { statedBal = mine[i].balance; break; } }
      if (statedBal == null) for (var j = mine.length - 1; j >= 0; j--) { if (mine[j].balance != null) { statedBal = mine[j].balance; break; } }
      var open = +a.openingBalance || 0, openDate = a.openingDate || '';
      var flowRows = openDate ? mine.filter(function (t) { return (t.date || '') >= openDate; }) : mine;
      var computedBal = flowRows.reduce(function (s, t) { return s + (t.credit || 0) - (t.debit || 0); }, open);
      var ym = mine.length ? ymOf(lastDate) : '';
      var inM = mine.filter(function (t) { return ymOf(t.date) === ym; });
      return {
        id: a.id, n: mine.length, lastDate: lastDate, ym: ym,
        statedBal: statedBal, computedBal: computedBal,
        balance: statedBal != null ? statedBal : computedBal,
        drift: (statedBal != null && (open || openDate)) ? Math.round((statedBal - computedBal) * 100) / 100 : null,
        monthIn: inM.reduce(function (s, t) { return s + (t.credit || 0); }, 0),
        monthOut: inM.reduce(function (s, t) { return s + (t.debit || 0); }, 0),
        toReview: mine.filter(needsHuman).length
      };
    });
    // combined flows for the latest overall data month, EXCLUDING self-transfer legs
    var ymAll = txns.reduce(function (m, t) { var y = ymOf(t.date); return y > m ? y : m; }, '');
    var extern = txns.filter(function (t) { return ymOf(t.date) === ymAll && !isSelfLeg(t); });
    return {
      accounts: rows,
      total: {
        balance: rows.reduce(function (s, r) { return s + (r.balance || 0); }, 0),
        ym: ymAll,
        monthIn: extern.reduce(function (s, t) { return s + (t.credit || 0); }, 0),
        monthOut: extern.reduce(function (s, t) { return s + (t.debit || 0); }, 0),
        internalMoved: txns.filter(function (t) { return ymOf(t.date) === ymAll && isSelfLeg(t); }).reduce(function (s, t) { return s + (t.credit || 0); }, 0),
        unassigned: txns.filter(function (t) { return !t.accountId; }).length
      }
    };
  }

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
    scoreMatch: scoreMatch, bestMatch: bestMatch, dedupeKey: dedupeKey, dedupeKeyBase: dedupeKeyBase, detectBank: detectBank,
    // already-recorded payments (freight/labour/royalty/EMI) + "who we pay every month"
    scoreEntry: scoreEntry, bestEntry: bestEntry, resolve: resolve,
    recurringPayees: recurringPayees, knownPayee: knownPayee, MIN_RUNS: MIN_RUNS,
    bankAccountMatch: bankAccountMatch, backfillPlan: backfillPlan,
    accountOverview: accountOverview, isSelfLeg: isSelfLeg,
    splitStatus: splitStatus, suggestAlloc: suggestAlloc, STOP: STOP,
    signedBalance: signedBalance, inferDirections: inferDirections,
    classifyTxn: classifyTxn, classifyResidual: classifyResidual, directionCat: directionCat, selfPairs: selfPairs
  };
});

/* build: account-scoped dedupeKey + dedupeKeyBase */

/* build: backfillPlan + bankAccountMatch */

/* build rc3d: accountOverview (per-account balances + net-of-transfer totals) */
