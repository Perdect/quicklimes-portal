/* ═══════════════════════════════════════════════════════════════════════
   BillOCR — pure, dependency-free purchase-bill parser.
   No DOM, no globals: runs in the browser (window.BillOCR) AND Node
   (module.exports), so every rule is unit-tested against real-invoice text.

   parse(text, opts) → {
     fields:     { billNo, date, supplier, supplierGstin, buyerGstin, group,
                   item, hsn, qty, rate, taxable, cgst, sgst, igst, gstRate,
                   totalGst, total, roundOff, itc, vehicle },
     confidence: { <field>: 0..1 },        // per-field certainty
     review:     [ <field> … ],            // low-confidence / unresolved → BLANK + "Needs review"
     warnings:   [ <string> … ],           // validation problems
     raw:        text
   }

   Hard rules (the reported bug):
     • A LABEL is never used as a VALUE. "GST Registration No" can never
       become the supplier name.
     • Purchase bill → we want the SELLER (supplier), told apart from the
       BUYER (our own firm) by name + GSTIN.
     • If a field isn't clearly readable → it's left BLANK and flagged for
       review. Never fabricate.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BillOCR = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── text utils ──────────────────────────────────────────────────────── */
  function norm(s) { return (s == null ? '' : String(s)).toUpperCase().replace(/\s+/g, ' ').trim(); }
  function clean(s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); }
  function nMoney(s) { s = String(s == null ? '' : s).replace(/[^0-9.,]/g, ''); if (!s) return null; var last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(',')); if (last >= 0 && s.length - last <= 3 && (s.match(/[.,]/g) || []).length) { s = s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1); } else { s = s.replace(/[.,]/g, ''); } var n = parseFloat(s); return isFinite(n) ? n : null; }
  function money(s) { return (String(s).match(/\d[\d,]*\.?\d{0,2}/g) || []).map(function (x) { return parseFloat(x.replace(/,/g, '')); }).filter(function (n) { return isFinite(n); }); }
  function round2(n) { return Math.round(n * 100) / 100; }
  // Remove percentages and quantities (a number followed by a unit) from a string
  // so only true monetary amounts remain. Handles MT / MTS / M.T. / TON / KG / etc.
  function stripUnits(s) {
    return String(s)
      .replace(/\d[\d.,]*\s*%/g, ' ')
      .replace(/\d[\d.,]*\s*(?:m\.?t\.?s?\.?|mts?|tonnes?|\bton\b|kgs?|nos\.?|ltrs?|litres?|bags?|pcs?|units?|qtls?|\bkl\b|cbm|\bto\b|sq\.?\s*(?:ft|mt|m)|cu\.?\s*(?:ft|mt|m))\b/gi, ' ');
  }
  // Every monetary amount in the text (values with paise, or round totals with .00).
  // Excludes HSN codes / pincodes / GSTIN fragments (bare 4+ digit integers) and,
  // via stripUnits, quantities — so a quantity can never be mistaken for money.
  function moneyAmounts(T) {
    return (stripUnits(String(T)).match(/\d[\d,]*\.\d{1,2}\b/g) || [])
      .map(function (x) { return round2(parseFloat(x.replace(/,/g, ''))); })
      .filter(function (n) { return isFinite(n) && n > 0; });
  }

  /* ── label detector: the anti-"GST Registration No" guard ────────────────
     A value candidate is rejected if it IS a label (or begins with one). */
  var LABEL_RE = new RegExp('^(?:' + [
    'gst\\s*(?:registration|reg)?\\s*(?:no|number|in)?', 'gstin', 'g\\s*s\\s*t\\s*i\\s*n',
    'pan(?:\\s*no)?', 'tax\\s*invoice', 'invoice(?:\\s*(?:no|number|date|value|cum)?)?', 'bill(?:\\s*(?:no|number|of\\s*supply|to|date))?',
    'billed\\s*to', 'bill\\s*to', 'ship(?:ped)?\\s*to', 'sold\\s*(?:to|by)', 'buyer', 'seller', 'supplier', 'vendor',
    'consignee', 'consignor', 'recipient', 'receiver', 'party(?:\\s*name)?', 'name(?:\\s*of\\s*\\w+)?', 'm/s',
    'hsn(?:\\s*(?:code|/sac|sac))?', 'sac', 'description(?:\\s*of\\s*goods)?', 'particulars?', 'goods',
    'state(?:\\s*(?:code|name))?', 'place\\s*of\\s*supply', 'address', 'contact', 'mobile', 'phone', 'email', 'e-?mail',
    'date[d]?', 'due\\s*date', 'qty', 'quantity', 'unit', 'per', 'rate', 'mrp', 'disc(?:ount)?',
    'amount', 'taxable(?:\\s*(?:value|amount|amt))?', 'basic(?:\\s*(?:value|amount))?', 'sub\\s*-?\\s*total', 'total(?:\\s*(?:amount|value|gst|invoice|qty)?)?',
    'grand\\s*total', 'c\\s*gst', 'cgst', 's\\s*gst', 'sgst', 'i\\s*gst', 'igst', 'ugst', 'cess', 'gst\\s*%', 'tax(?:\\s*(?:amount|%|rate))?',
    'round(?:\\s*(?:off|ed))?', 'freight', 'transport(?:ation)?', 'vehicle(?:\\s*no)?', 'e-?way(?:\\s*bill)?', 'lr\\s*no', 'transporter',
    // Tally / e-invoice header cells — never a supplier name
    'delivery\\s*note(?:\\s*date)?', 'mode\\s*/?\\s*terms', 'terms\\s*of\\s*(?:payment|delivery)', 'reference(?:\\s*no)?', 'other\\s*reference', 'buyer\'?s?\\s*order', 'dispatch(?:ed)?(?:\\s*(?:doc|through))?', 'destination', 'motor\\s*vehicle', 'ack(?:nowledgement)?\\s*(?:no|date)', 'irn', 'bill\\s*of\\s*lading',
    'terms', 'reverse\\s*charge', 'sr\\.?\\s*no', 's\\.?\\s*no', 'sl\\.?\\s*no', 'code', 'no\\.?', 'for\\b', 'from', 'to',
    'declaration', 'bank', 'a/c', 'account', 'ifsc', 'branch', 'signature', 'authorised', 'authorized', 'received', 'jurisdiction',
    'cin', 'phone\\s*no', 'website', 'www', 'http'
  ].join('|') + ')\\b', 'i');
  // value that is JUST a label (optionally trailed by ":" and nothing meaningful)
  function isLabel(s) {
    var n = clean(s).replace(/[:\-–].*$/, '').trim();     // text before a colon/dash
    if (!n) return true;
    if (LABEL_RE.test(n)) {
      // "M/s ACME TRADERS" is NOT a bare label — it has a real NAME after it.
      // But "GSTIN 08AAAFS2222B1Z4" is a label + a CODE, not a name.
      var rest = n.replace(LABEL_RE, '').replace(/^[\s:.\-]+/, '').trim();
      var lettersOnly = (rest.match(/[A-Za-z]/g) || []).length;
      var nameLike = rest.length >= 3 && /^[A-Za-z]/.test(rest) && !/\d{4}/.test(rest) &&
        lettersOnly >= rest.replace(/\s/g, '').length * 0.6 && !LABEL_RE.test(rest);
      if (nameLike) return false;
      return true;
    }
    return false;
  }

  /* ── Party master: a known GSTIN → the official company name (Step 4). This is
     the strongest, OCR-INDEPENDENT supplier signal — when the supplier GSTIN is
     recognised we use the master name and ignore whatever the text scanner found
     (so footer/declaration text can never win). Callers can extend it with their
     own parties via opts.partyMaster (GSTIN → name). ── */
  var PARTY_MASTER = {
    '24AAACI1681G1ZV': 'Indian Oil Corporation Limited',
    '08ABWFM4111F1Z6': 'Mateshwari Mines and Minerals'
  };
  /* Is this string a believable company name — as opposed to a declaration
     fragment ("the buyer. For"), a label, or an address? Used to gate BOTH the
     user party-master and learned aliases: a bill saved under the OLD buggy
     parser can poison the party list with fragment names, and without this
     check that poison re-applies itself to every future bill at 99%. */
  function plausibleName(s) {
    var c = String(s == null ? '' : s).replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
    if (c.length < 3 || c.length > 72) return false;
    if (isLabel(c)) return false;
    if (!/[A-Za-z]{3}/.test(c) || /^\d/.test(c) || /\d{6}/.test(c)) return false;
    if (/^(?:the|for|to|from|as|we|i|received|certified|authoris|authoriz|payer|payee|ordering|declaration|subject|being|goods|value|amount|total|net|place|date|terms|note|remarks?)\b/i.test(c)) return false;
    if (/\b(?:buyer|signator|signature|hereby|certif|declaration|digitally signed)\b/i.test(c)) return false;
    if (/\bfor\b/i.test(c) && !CO_SUFFIX.test(c)) return false;
    return true;
  }
  function masterName(gstin, extra) {
    if (!gstin) return '';
    var g = norm(gstin).replace(/\s/g, '');
    // The user's own party list wins ONLY when it holds a believable name;
    // otherwise the built-in verified name heals the poisoned entry.
    if (extra && extra[g] && plausibleName(extra[g])) return extra[g];
    return PARTY_MASTER[g] || '';
  }

  /* ── GSTIN ───────────────────────────────────────────────────────────── */
  var GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d])\b/g;
  function validGstin(g) { if (!g || !/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/.test(g)) return false; var st = +g.slice(0, 2); return st >= 1 && st <= 38; }

  /* ── purchase group / item from item text ────────────────────────────── */
  // Ordered MOST-specific first: a "royalty on limestone" or "freight for
  // limestone" bill must classify as royalty/transport, not the material.
  var GROUPS = [
    { group: 'royalty', item: 'Royalty', kw: /royalty|\bdmf\b|district\s*mineral|mineral\s*fund|\bnmet\b/i },
    { group: 'transport', item: 'Transport / Freight', kw: /transport|freight|lorry|truck\s*(?:hire|freight)|carriage|goods\s*transport|\bgta\b|cartage/i },
    { group: 'labour', item: 'Labour', kw: /labour|\blabor\b|wages|mazdoor|manpower|loading\s*(?:&|and)?\s*unloading|hamali/i },
    { group: 'maintenance', item: 'Maintenance', kw: /maintenance|repair(?:s|ing)?|servicing|spare\s*parts?|\bamc\b|overhaul|refractory|kiln\s*(?:repair|lining)|conveyor\s*belt|welding\s*(?:job|work)/i },
    { group: 'fuel', item: 'Diesel', kw: /\bdiesel\b|\bhsd\b|\bpetrol\b|furnace\s*oil|\bfuel\s*oil\b|high\s*speed\s*diesel/i },
    { group: 'electricity', item: 'Electricity', kw: /electricity|power\s*bill|discom|jvvnl|avvnl|energy\s*charges|units?\s*consumed|kwh/i },
    { group: 'bank', item: 'Bank Charges', kw: /bank\s*charge|processing\s*fee|commission|neft\s*charge|folio|\brtgs\s*charge/i },
    { group: 'packaging', item: 'Plastic Bags', kw: /plastic\s*bag|hdpe|\bpp\s*bag|woven\s*sack|packing\s*(?:bag|material)|laminated\s*bag|bopp/i },
    { group: 'petcoke', item: 'Pet Coke', kw: /pet\s*coke|petcoke|petroleum\s*coke|\bcoke\b/i },
    { group: 'limestone', item: 'Limestone Purchase', kw: /lime\s*stone|limestone|l[\. ]?stone|\bkankar\b|agricultural\s*lime|liming\s*material|hydrated\s*lime|quick\s*lime/i }
  ];
  // Materials are goods; services are charges levied on/for a material.
  var MATERIAL = { petcoke: 1, limestone: 1, packaging: 1, fuel: 1, electricity: 1 };
  // A material keyword is a REAL line item (not just "freight FOR limestone" or
  // "royalty ON limestone") when at least one occurrence isn't the grammatical
  // object of a service word. This lets a pet-coke MATERIAL bill that merely
  // carries a "Mode of Transport" / "Freight 0.00" noise line stay petcoke,
  // while a genuine "Freight for limestone" bill still classifies as transport.
  function materialStrong(T, kw) {
    var re = new RegExp(kw.source, 'gi'), m;
    while ((m = re.exec(T)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++;
      var before = T.slice(Math.max(0, m.index - 16), m.index).toLowerCase();
      if (!/(?:for|on|of|against|towards|freight|carriage|cartage|royalty|labour|labor|loading|unloading|transport(?:ation)?)\s*$/.test(before)) return true;
    }
    return false;
  }
  function detectGroup(text) {
    var T = String(text || ''), matHit = null, svcHit = null, i, g;
    // A royalty / DMF / NMET mining challan IS a royalty charge even though it
    // names the mineral (limestone) — the mineral is a description, not the
    // billed item, so it must not be classified as a limestone purchase.
    if (/\broyalty\s*(?:charges?|amount|on\b)|\bdmf\s*(?:contribution|fund)|\bnmet\b|mineral\s*despatch|district\s*mineral\s*found/i.test(T)) return { group: 'royalty', item: 'Royalty' };
    for (i = 0; i < GROUPS.length; i++) {
      g = GROUPS[i]; if (!g.kw.test(T)) continue;
      if (MATERIAL[g.group]) { if (!matHit && materialStrong(T, g.kw)) matHit = g; }
      else if (!svcHit) svcHit = g;
    }
    if (matHit) return { group: matHit.group, item: matHit.item };   // real material line wins over stray freight/mode noise
    if (svcHit) return { group: svcHit.group, item: svcHit.item };   // otherwise the service being billed
    for (i = 0; i < GROUPS.length; i++) if (GROUPS[i].kw.test(T)) return { group: GROUPS[i].group, item: GROUPS[i].item };
    return { group: '', item: '' };
  }

  /* ── date ────────────────────────────────────────────────────────────── */
  var MON = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
  var DATE_RE = new RegExp('(\\d{1,2})[\\/\\-. ](\\d{1,2}|' + MON + ')[a-z]*[\\/\\-. ](\\d{2,4})', 'i');
  function firstDate(s) { var re = new RegExp(DATE_RE.source, 'ig'), m; while ((m = re.exec(s))) { var v = validateDate(m[0]); if (v) return v; } return null; }
  function findDate(text) {
    // Prefer the value on a "Date/Dated" line — but scan the WHOLE line with the
    // date regex (never a fixed-width filler, which used to eat the day's first
    // digit: "Dated : 12/06/2025" → "2/06/2025"). SKIP e-invoice / logistics dates
    // ("Ack Date", "Delivery Note Date", "Due Date", "E-Way") so the INVOICE date wins.
    //
    // A line-based skip is NOT enough. pdf.js groups text runs by y-position, so a
    // Tally e-invoice header extracts with the label and its value on SEPARATE lines:
    //     Ack Date :        ← label alone, matches skip
    //     3-Jan-26          ← value alone, matches nothing → sneaks through
    //     Invoice No. Dated ← label row, no value
    //     58 31-Dec-25      ← the REAL invoice date, no label on the line
    // The old fallback took "first date in the doc" = the Ack Date, silently filing
    // a 31-Dec bill into January. So we (1) block the follower line of a dangling
    // skip label, and (2) let a "Dated" label reach forward to its value row.
    // Blocking is BY LINE POSITION, never by value: e-invoices are often acked the
    // same day, and blocking the string would kill the real date too.
    var lines = text.split('\n').map(function (l) { return clean(l); });
    var skip = /due\s*date|ack(?:nowledgement)?\s*(?:date|no)|delivery\s*note\s*date|e-?way|\birn\b/i;
    var noReach = /buyer'?s?\s*order|delivery\s*note|reference\s*no/i;

    var blocked = {};
    for (var i = 0; i < lines.length; i++) {
      if (!skip.test(lines[i])) continue;
      blocked[i] = 1;
      if (firstDate(lines[i])) continue;            // label carried its own value
      for (var k = i + 1; k < Math.min(i + 3, lines.length); k++) {
        if (!lines[k]) continue;
        if (firstDate(lines[k])) blocked[k] = 1;    // dangling label → next line is its value
        break;                                       // only the first follower can hold it
      }
    }
    var free = function (n) { return !blocked[n] && !skip.test(lines[n]); };

    // pass 1 — an explicit invoice/bill "Dated" label: on the line, else the value row below it
    var lab = /invoice\s*date|bill\s*date|\bdated\b/i;
    for (var j = 0; j < lines.length; j++) {
      if (!free(j) || !lab.test(lines[j])) continue;
      var mi1 = lines[j].search(/\bdate[d]?\b/i);
      var v1 = firstDate(lines[j].slice(mi1).replace(/^date[d]?/i, ''));
      if (v1) return v1;
      if (noReach.test(lines[j])) continue;
      for (var n = j + 1; n < Math.min(j + 4, lines.length); n++) {
        if (!free(n)) continue;
        var v2 = firstDate(lines[n]);
        if (v2) return v2;
      }
    }
    // pass 2 — any other date-labelled line that isn't ack/due/delivery-note/e-way
    for (var p = 0; p < lines.length; p++) {
      if (!free(p)) continue;
      var mi = lines[p].search(/\bdate[d]?\b/i);
      if (mi >= 0) { var v = firstDate(lines[p].slice(mi).replace(/^date[d]?/i, '')); if (v) return v; }
    }
    // fallback — first date on a line that isn't blocked
    for (var q = 0; q < lines.length; q++) {
      if (!free(q)) continue;
      var v3 = firstDate(lines[q]);
      if (v3) return v3;
    }
    return null;
  }
  function validateDate(s) {
    var m = String(s).match(DATE_RE); if (!m) return null;
    var day = +m[1], named = /[a-z]/i.test(m[2]), mo = named ? 1 : +m[2];
    if (day < 1 || day > 31) return null; if (!named && (mo < 1 || mo > 12)) return null;
    return clean(m[0]);
  }

  /* ── main ────────────────────────────────────────────────────────────── */
  function parse(text, opts) {
    opts = opts || {};
    var T = String(text || '').replace(/\r/g, '');
    var lines = T.split('\n').map(clean).filter(Boolean);
    var f = {}, conf = {}, review = [], warn = [], ver = {};
    function set(k, v, c) { if (v === '' || v == null) return; f[k] = v; conf[k] = c; }
    var ownG = (opts.ownGstins || []).map(norm);
    var ownNames = (opts.ownNames || []).map(norm);
    var aliases = opts.aliases || {};      // learned corrections: normalized text → canonical value

    /* GSTINs — seller (party) vs buyer (own). */
    var gstins = norm(T).match(GSTIN_RE) || [];
    gstins = gstins.filter(function (g, i) { return gstins.indexOf(g) === i; });
    var buyerG = gstins.filter(function (g) { return ownG.indexOf(g) >= 0; })[0] || '';
    var sellerG = gstins.filter(function (g) { return ownG.indexOf(g) < 0 && validGstin(g); })[0] || '';
    // INTER-FIRM: both parties are OWN firms (e.g. Gotan → Deshwali Minerals).
    // The counterparty is the own firm that is NOT the active company, so the
    // bill resolves to that sister firm instead of "Unknown / no GSTIN".
    if (!sellerG && ownG.length >= 2) {
      var selfG = norm(opts.selfGstin || '') || ownG[0];
      var otherOwn = gstins.filter(function (g) { return ownG.indexOf(g) >= 0 && g !== selfG && validGstin(g); });
      if (otherOwn.length) { sellerG = otherOwn[0]; buyerG = selfG; }
    }
    // NO IDENTITY: the firm has no GSTIN on file (a fresh signup — signup never
    // asked, and only Gotan/Deshwali are seeded). Without it we cannot tell OUR
    // GSTIN from THEIRS, so "seller = first valid GSTIN" is a coin flip: on our
    // OWN sales bill it picks US as the party. Guess quietly and every bill lands
    // in the wrong register with the wrong party. Say so instead.
    var noIdentity = ownG.length === 0;
    if (noIdentity) warn.push('Your firm\'s GSTIN is not set, so Sales and Purchase cannot be told apart — add it in Settings → Company profile.');

    if (sellerG) { set('supplierGstin', sellerG, noIdentity ? 0.5 : (validGstin(sellerG) ? 0.97 : 0.5)); if (!validGstin(sellerG)) warn.push('Supplier GSTIN format looks off'); }
    if (noIdentity && sellerG) review.push('supplierGstin');
    if (buyerG) set('buyerGstin', buyerG, 0.9);
    // DIRECTION — is OUR firm the RECIPIENT (buyer) or the ISSUER (seller)?
    // Primary signal: if our own GSTIN is printed in a buyer / bill-to / consignee
    // context, we bought it → PURCHASE. This must come first because some SAP / IOC
    // petcoke layouts print the RECIPIENT block ABOVE the seller block, so the naive
    // "first GSTIN = issuer" test wrongly flips a purchase into a sale.
    // Fallback: the issuer (first valid GSTIN) decides — our GSTIN issuing → SALE.
    var dir = '';
    var selfG = norm(opts.selfGstin || '');
    var meG = (selfG && ownG.indexOf(selfG) >= 0) ? selfG : buyerG;
    if (meG) {
      var nT = norm(T), bi = nT.indexOf(meG);
      var ctx = bi >= 0 ? nT.slice(Math.max(0, bi - 90), bi) : '';
      if (/BILL\s*TO|BILLED\s*TO|BUYER|CONSIGNEE|SHIP\s*TO|RECIPIENT|RECEIVER|DETAILS\s*OF\s*RECEIVER/.test(ctx)) dir = 'purchase';
    }
    // The issuer decides — but ONLY if we know which GSTIN is ours. With ownG
    // empty this test is `[].indexOf(x) >= 0`, always false, so EVERY bill came
    // out "purchase" (the reported bug). Unknown must stay unknown: the review
    // modal then asks, instead of silently misfiling money and GST.
    if (!dir && !noIdentity) {
      var issuerG = gstins.filter(function (g) { return validGstin(g); })[0] || gstins[0] || '';
      if (issuerG) dir = ownG.indexOf(issuerG) >= 0 ? 'sales' : 'purchase';
    }
    if (dir) f.direction = dir;

    /* Bill number — labelled, must contain a digit and not be a date/GSTIN. */
    var billNo = '', re = /(?:invoice|bill(?:\s*of\s*supply)?|inv|voucher|challan|document|consignment(?:\s*note)?|note)[ \t]*(?:no\.?|number|#|id)?[ \t]*[:\-.#]?[ \t]*([A-Za-z0-9\/\-]{0,22}\d[A-Za-z0-9\/\-]{0,6})/ig, mm;
    while ((mm = re.exec(T))) {
      // Never take the E-WAY BILL / IRN / Ack / ORIGINAL-invoice number as THIS
      // bill's number — those labels also contain "bill/invoice no".
      var pre = T.slice(T.lastIndexOf('\n', mm.index - 1) + 1, mm.index);   // same line only
      if (/e-?\s*way|\birn\b|ack\b|original/i.test(pre)) continue;
      var cand = mm[1].replace(/[^A-Za-z0-9\/\-]/g, ''); var digits = (cand.match(/\d/g) || []).length;
      if (digits && (digits >= 2 || /[\/\-]/.test(cand)) && !/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/i.test(cand) && !/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(cand)) { billNo = cand; break; }
    }
    // Tally / e-invoice grids print the label ("Invoice No.") and its value on
    // SEPARATE lines ("Invoice No.  Dated" ↵ "222/26-27  29-Jun-26"). If the
    // inline scan missed it, find the label line and take the first invoice-ish
    // token from that line or the next two.
    if (!billNo) {
      var BL = T.split('\n');
      var LBL = /invoice\s*(?:no|number|#)|bill\s*no|voucher\s*no|(?:credit|debit|consignment)\s*note\s*(?:no|number)|challan\s*(?:no|number)/i;
      for (var _bi = 0; _bi < BL.length && !billNo; _bi++) {
        var lm = LBL.exec(BL[_bi]);
        if (!lm || /purchase|order|e-?way|original|reference|\back\b|\birn\b/i.test(BL[_bi])) continue;
        // In a column grid ("Invoice No." with the value one line below), the value
        // sits roughly UNDER the label. A left-column fragment on the value line
        // ("Plot No 87", "ML No 349/2005") must not win over the real number, so
        // pick the valid token whose column is nearest the label's column.
        var labelCol = lm.index, best = null, bestDist = 1e9;
        for (var _si = 0; _si < 3; _si++) {
          var ln = BL[_bi + _si] || '', tre = /[A-Za-z0-9][A-Za-z0-9\/\-]*/g, tm2;
          while ((tm2 = tre.exec(ln))) {
            var tk = tm2[0].replace(/[^A-Za-z0-9\/\-]/g, '');
            if (!/\d/.test(tk) || tk.length < 2 || tk.length > 24) continue;
            if ((tk.match(/\d/g) || []).length < 2 && !/[\/\-]/.test(tk)) continue;
            if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(tk)) continue;                 // date
            if (/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/i.test(tk)) continue;              // GSTIN
            if (/^(?:invoice|no|dated|date|number)$/i.test(tk)) continue;
            var dist = Math.abs(tm2.index - labelCol);
            if (dist < bestDist) { bestDist = dist; best = tk; }
          }
        }
        if (best) billNo = best;
      }
    }
    // SAP / IOC tax-invoice number ("20273121B005870") — a run of digits, one or
    // two letters, then more digits — printed under "Doc.Name TAX INVOICE / & number"
    // with NO "Invoice No" label. Last resort only, and never the IRN / Ack / e-way.
    if (!billNo) {
      var DL = T.split('\n');
      for (var _di = 0; _di < DL.length && !billNo; _di++) {
        if (!/doc\.?\s*name|tax\s*invoice|&\s*number/i.test(DL[_di])) continue;
        for (var _dj = 0; _dj <= 2 && !billNo; _dj++) {
          var dline = DL[_di + _dj] || '';
          if (/\birn\b|\back\b|e-?\s*way/i.test(dline)) continue;
          var dmm = dline.match(/\b(\d{6,10}[A-Z]{1,2}\d{4,8})\b/);
          if (dmm) { billNo = dmm[1]; break; }
        }
      }
    }
    if (billNo) set('billNo', billNo, /no|number|#/i.test(T.slice(Math.max(0, T.toUpperCase().indexOf(billNo.toUpperCase()) - 24), T.toUpperCase().indexOf(billNo.toUpperCase()))) ? 0.9 : 0.75);

    /* Date */
    var dt = findDate(T); if (dt) set('date', dt, 0.85);

    /* ── SELLER (supplier) name — the crux. Never a label. ──────────────── */
    var master = masterName(sellerG, opts.partyMaster);
    if (master) { set('supplier', master, 0.99); ver.supplier = 'party_master'; }
    else {
      var supplier = pickSupplier(lines, sellerG, ownNames, aliases);
      if (supplier.name) { set('supplier', supplier.name, supplier.conf); if (supplier.conf >= 0.7) ver.supplier = 'layout'; }
    }

    /* Buyer name (separate) */
    var buyer = pickBuyer(lines, ownNames);
    if (buyer.name) set('buyer', buyer.name, buyer.conf);

    /* ── Multi-pass counterparty fallback ──────────────────────────────────
       The COUNTERPARTY (supplier on a purchase, customer on a sale) is "the
       party that isn't us". If the seller-name pass came up blank (unusual
       customer-block layout on a sales invoice, a wrapped name, etc.) fall back
       to the Bill-To / Consignee name — as long as it is NOT one of our own
       firms. GSTIN remains the identity, so a recognised GSTIN never yields
       "Unknown" even when the printed name is unreadable. */
    if (!f.supplier) {
      var cands = [];
      if (buyer.name && !isOwnName(buyer.name, ownNames)) cands.push([buyer.name, buyer.conf]);
      var cn = pickNamedBlock(lines, /^(?:consignee|ship(?:ped)?\s*to|receiver)\b/i, ownNames); if (cn.name) cands.push([cn.name, 0.6]);
      var bn = pickNamedBlock(lines, /^(?:bill(?:ed)?\s*to|buyer|sold\s*to|customer|party)\b/i, ownNames); if (bn.name) cands.push([bn.name, 0.6]);
      for (var _ci = 0; _ci < cands.length; _ci++) { if (plausibleName(cands[_ci][0])) { set('supplier', cands[_ci][0], Math.min(cands[_ci][1] || 0.55, 0.6)); ver.supplier = 'counterparty'; break; } }
    }

    /* ── amounts ────────────────────────────────────────────────────────── */
    var A = pickAmounts(T, lines);
    ['taxable', 'cgst', 'sgst', 'igst', 'total', 'roundOff'].forEach(function (k) { if (A[k] != null) set(k, A[k], A.conf[k]); });

    /* GST total + rate + ITC */
    var totalGst = null;
    if (A.cgst != null || A.sgst != null || A.igst != null) totalGst = round2((A.cgst || 0) + (A.sgst || 0) + (A.igst || 0));
    if (totalGst != null) set('totalGst', totalGst, 0.8);
    var rate = pickRate(T, A);
    if (rate != null) set('gstRate', rate, A.rateFromMath ? 0.85 : 0.7);

    /* HSN, qty, rate/unit, vehicle (moved up: qty is needed for the amount guards) */
    var hsn = (T.match(/\bHSN(?:\s*\/?\s*SAC)?\s*(?:code|no)?\s*[:\-]?\s*(\d{4,8})\b/i) || [])[1] || (T.match(/\b(2521|2522|2523|2701|2713|3923|6305|4819)\d{0,4}\b/) || [])[0];
    if (hsn) set('hsn', hsn, 0.75);
    // Quantity + unit. Try unambiguous units first (MT/TON/KG/NOS/BAGS/…); only
    // then the ambiguous tonne "TO" (decimal qty, not the preposition "To:").
    var qm = T.match(/([\d,]+(?:\.\d+)?)\s*(m\.?t\.?s?|tonnes?|\bton\b|kgs?|nos|bags?|ltrs?|litres?|units?|qtls?)\b/i)
      || T.match(/([\d,]+\.\d{1,3})\s*(to)\b(?!\s*[:.])/i);
    if (qm) set('qty', parseFloat(qm[1].replace(/,/g, '')), 0.6);

    /* ── cross-validation & business rules (Steps 4–5) ──────────────────────
       The grand total is the amount that satisfies taxable + CGST + SGST + IGST
       + round-off. It can NEVER be smaller than the taxable value, and never the
       quantity — this is what stops a quantity being stored as the total. */
    var qtyVal = f.qty != null ? f.qty : null;
    var expect = (A.taxable != null && totalGst != null) ? round2(A.taxable + totalGst + (A.roundOff || 0)) : null;
    // (a) reject an IMPOSSIBLE total — below taxable, or equal to the quantity.
    //     (A valid grand total that merely disagrees with `expect` is NOT rejected
    //      here; the taxable could be the wrong leg — see (c2).)
    if (A.total != null && ((A.taxable != null && A.total < A.taxable - 1) || (qtyVal != null && Math.abs(A.total - qtyVal) < 0.5))) {
      warn.push('Rejected total ' + A.total + ' — not a valid grand total (below taxable / equals quantity)');
      A.total = null; delete f.total; delete conf.total;
    }
    // (b) recover a missing/rejected total: prefer an amount on the bill equal to
    //     taxable + GST + round-off; else the computed sum; else the largest amount.
    if (A.total == null) {
      if (expect != null) {
        var hit = moneyAmounts(T).filter(function (n) { return Math.abs(n - expect) <= 2 && (qtyVal == null || Math.abs(n - qtyVal) > 0.5); })[0];
        var chosen = hit != null ? hit : expect;
        set('total', chosen, hit != null ? 0.95 : 0.85); A.total = chosen; ver.total = hit != null ? 'gst_calc' : 'gst_sum';
      } else {
        var all = moneyAmounts(T).filter(function (n) { return qtyVal == null || Math.abs(n - qtyVal) > 0.5; });
        if (all.length) { var mx = Math.max.apply(null, all); if (A.taxable == null || mx >= A.taxable - 1) { set('total', mx, 0.7); A.total = mx; } }
      }
    }
    // (c1) total present AND reconciles → verified by GST calculation
    if (A.total != null && expect != null && Math.abs(A.total - expect) <= 2) {
      conf.total = Math.max(conf.total || 0, 0.96); ver.total = 'gst_calc';
      conf.taxable = Math.max(conf.taxable || 0, 0.95); ver.taxable = 'gst_calc';
    }
    // (c2) total present but does NOT reconcile → keep it, but warn (a leg is off)
    else if (A.total != null && expect != null && Math.abs(A.total - expect) > 2) {
      warn.push('Amounts don\'t reconcile: taxable + GST (' + expect + ') ≠ total (' + A.total + ')');
    }
    // (d) recover a missing taxable. Prefer the GST accounting identity —
    //     taxable = total − totalGST − round-off — which is EXACT when the tax
    //     amounts were read (Tally/e-invoice bills list CGST/SGST amounts but
    //     print the taxable value only in the HSN summary table, which the
    //     amount scan can miss). Fall back to backing it out of the rate.
    if (f.taxable == null && A.total != null && totalGst != null && totalGst > 0) {
      var txg = round2(A.total - totalGst - (A.roundOff || 0));
      // Only trust the identity when the implied rate (GST ÷ taxable) is a REAL
      // GST slab — this rejects a garbage/partial GST leg (e.g. a mis-read
      // "S G S T" that captured 8 instead of 9,360, which would otherwise make
      // taxable ≈ total). A bad leg falls through to the rate-based recovery.
      var impRate = txg > 0 ? totalGst / txg * 100 : -1;
      var std = [3, 5, 12, 18, 28].filter(function (x) { return Math.abs(x - impRate) <= 0.7; })[0];
      if (txg > 0 && txg < A.total && std != null) { set('taxable', txg, 0.85); A.taxable = txg; ver.taxable = 'gst_sum'; }
    }
    if (f.taxable == null && A.total != null && rate != null) { var txv = round2(A.total / (1 + rate / 100)); set('taxable', txv, 0.6); A.taxable = txv; }
    if (f.total == null && A.taxable != null && totalGst != null) { set('total', round2(A.taxable + totalGst + (A.roundOff || 0)), 0.7); A.total = f.total; ver.total = 'gst_sum'; }
    // (e) taxable must be < total
    if (f.taxable != null && f.total != null && f.taxable > f.total + 1) { warn.push('Taxable exceeds total'); if (review.indexOf('taxable') < 0) review.push('taxable'); if (review.indexOf('total') < 0) review.push('total'); }
    // (f) GST% from the now-trusted taxable + GST amounts. The tax MATH is the
    //     source of truth, so it also OVERRIDES a rate that was only read from a
    //     single "CGST 9%" token — which is HALF the combined 18% on an intra-
    //     state (CGST+SGST) bill. It never overrides a rate already derived from
    //     math (A.rateFromMath).
    if (f.taxable && totalGst != null && totalGst > 0 && (f.gstRate == null || !A.rateFromMath)) { var rr = totalGst / f.taxable * 100; var snap = [3, 5, 12, 18, 28].filter(function (x) { return Math.abs(x - rr) <= 0.7; })[0]; if (snap != null) { set('gstRate', snap, 0.9); ver.gstRate = 'gst_calc'; } }

    // Vehicle number — prefer the value explicitly labelled "Vehicle No /
    // Motor Vehicle No" (handles ANY plate, incl. a digit inside the series like
    // RJ191R1049 = RJ-19-1R-1049); else fall back to a structural plate match
    // whose series may contain a digit but must end in a letter.
    var vlab = norm(T).match(/\b(?:motor\s*)?vehicle\s*(?:no\.?)?\s*[:.\-]?\s*([A-Z]{2}[\s\-]?[A-Z0-9]{5,9})\b/i);
    var vm = vlab || norm(T).match(/\b([A-Z]{2}[\s\-]?\d{1,2}[\s\-]?[A-Z0-9]{0,2}[A-Z][\s\-]?\d{3,4})\b/);
    if (vm) set('vehicle', vm[1].replace(/[\s\-]/g, '').toUpperCase(), vlab ? 0.85 : 0.6);
    // Document type
    var bt = /\bcredit\s*note\b/i.test(T) ? 'Credit Note' : /\bdebit\s*note\b/i.test(T) ? 'Debit Note'
      : /\bbill\s*of\s*supply\b/i.test(T) ? 'Bill of Supply' : /\btax\s*invoice\b/i.test(T) ? 'Tax Invoice'
        : /\binvoice\b/i.test(T) ? 'Invoice' : '';
    if (bt) set('billType', bt, /credit\s*note|debit\s*note|bill\s*of\s*supply|tax\s*invoice/i.test(T) ? 0.9 : 0.5);
    // Unit (captured with the quantity) + unit rate (taxable ÷ qty is most reliable)
    if (qm && qm[2]) set('unit', qm[2].toUpperCase().replace(/\./g, ''), 0.6);
    if (f.taxable != null && f.qty) set('unitRate', round2(f.taxable / f.qty), 0.55);
    // LR / consignment note number
    var lr = (T.match(/\b(?:l\.?r\.?|lorry\s*receipt)\s*(?:no|number)?\s*[:.\-#]*\s*([A-Z0-9\/\-]{3,20})/i) || [])[1];
    if (lr && /\d/.test(lr)) set('lrNo', lr, 0.6);
    // Payment terms
    var pt = (T.match(/(?:payment\s*terms?|terms?\s*of\s*payment)\s*[:\-]?\s*([^\n]{2,40})/i) || [])[1];
    if (!pt) { var pm = T.match(/\b(net\s*\d{1,3}\s*days?|due\s*on\s*receipt|advance\s*payment|\d{1,3}\s*days?\s*credit)\b/i); if (pm) pt = pm[1]; }
    if (pt) set('paymentTerms', clean(pt).replace(/[.;].*$/, ''), 0.55);
    // Remarks / narration
    var rm = (T.match(/(?:remarks?|narration)\s*[:\-]?\s*([^\n]{2,60})/i) || [])[1];
    if (rm) set('remarks', clean(rm), 0.5);

    /* Purchase group / item — from the DESCRIPTION lines only. Strip metadata
       lines first ("Transporter: …", "Vehicle No: …") so a transporter's name
       can't hijack the material classification. */
    var giText = lines.filter(function (l) {
      return !/^(?:transporter|vehicle|transport\s*mode|mode\s*of\s*transport|del\s*mode|t\.?t\.?\s*no|tank\s*truck|bay\s*no|density|nomination|dispatch|lorry|lr\s*no|e-?way|place\s*of\s*supply|reverse\s*charge|state\s*code|pan\b|cin\b|tan\b|mobile|phone|email|gstin|billed\s*to|bill\s*to|ship\s*to|consignee)\b/i.test(l);
    }).join('\n');
    var gi = detectGroup(giText);
    if (gi.group) { set('group', gi.group, 0.75); set('item', gi.item, 0.7); }

    /* ITC — RCM only when reverse charge is AFFIRMATIVELY yes (bills mandatorily
       print "Reverse Charge : No", which must NOT flip a normal bill to RCM). */
    // "no|not applicable|nil" ONLY — a bare "n\b" wrongly matched the trailing n
    // of "Section 9(3)" on a GTA/RCM bill and cancelled a real RCM.
    var rcmNo = /reverse\s*charge[^\n]{0,20}[:\-]?\s*(?:no|not\s*applicable|nil)\b/i.test(T);
    var rcmYes = /reverse\s*charge[^\n]*[:\-]?\s*(?:yes|applicable)\b/i.test(T) || /payable\s*(?:by\s*recipient\s*)?under\s*(?:rcm|reverse\s*charge)/i.test(T) || /\bunder\s*rcm\b/i.test(T) || /rcm\s*applicable/i.test(T) || /tax\s*(?:to\s*be\s*)?paid\s*by\s*(?:the\s*)?(?:recipient|consignee)/i.test(T);
    // A CREDIT note (sales return) reverses input tax — not a fresh eligible
    // input. A DEBIT note ADDS liability (e.g. bank charges) and keeps normal
    // ITC, so only a genuine credit-note DOCUMENT flips ITC (a bill that merely
    // carries a "Debit Note No." label does not).
    var isCreditNote = /\bcredit\s*note\b/i.test(T);   // a DEBIT note (bank charges) says "debit", so this is credit-only
    if (rcmYes && !rcmNo) set('itc', 'RCM', 0.7);
    else if (isCreditNote) set('itc', 'Ineligible', 0.7);
    else if (/itc\s*(?:not\s*(?:eligible|available)|inelig|blocked)|input\s*tax\s*credit\s*(?:not\s*available|blocked)|ineligible|exempt(?:ed)?(?:\s*(?:supply|goods|produce))?|nil\s*rated|bill\s*of\s*supply|total\s*tax\s*[:\-]?\s*nil/i.test(T)) set('itc', 'Ineligible', 0.7);
    else if (totalGst != null && totalGst > 0) set('itc', 'Eligible', 0.65);

    /* Grand total = the final payable (same as total on most bills). */
    if (f.total != null) set('grandTotal', f.total, conf.total || 0.7);

    /* ── needs-review: any field we couldn't pin down confidently ───────── */
    var CORE = ['supplier', 'date', 'taxable', 'total', 'gstRate'];
    CORE.forEach(function (k) { if (f[k] == null || (conf[k] || 0) < 0.5) if (review.indexOf(k) < 0) review.push(k); });
    Object.keys(conf).forEach(function (k) { if ((conf[k] || 0) < 0.5 && review.indexOf(k) < 0) review.push(k); });
    /* validation */
    if (f.supplierGstin && !validGstin(f.supplierGstin) && warn.indexOf('Supplier GSTIN format looks off') < 0) warn.push('Supplier GSTIN invalid');

    // noIdentity travels OUT as a first-class flag, not just prose in warnings[].
    // The importer has to be able to BRANCH on it: a warning string it never
    // renders (openTable shows only bill.reason) is not a safeguard.
    return { fields: f, confidence: conf, review: review, warnings: warn, verify: ver, raw: T, noIdentity: noIdentity };
  }

  /* ── supplier picker ─────────────────────────────────────────────────── */
  var CO_SUFFIX = /\b(ltd|limited|pvt|private|llp|traders?|trading|mines?|minerals?|industries|enterprises?|cement|company|corporation|corp|sons|agencies|associates|udyog|stores?|suppliers?|transport|roadlines|petro|petroleum|\boil\b|chemicals?|distributors?|marketing|steel|works)\b/i;
  var ADDR_RE = /\broad\b|street|\bnagar\b|\bdist\b|district|\bpin\b|tehsil|\bward\b|khasra|khasara|colony|\bmarg\b|\bsector\b|village|\bgidc\b|industrial|\barea\b|\bplot\b|\bnear\b|\bopp\b|behind|\bstate\b|rajasthan|gujarat|maharashtra|\bindia\b|\d{6}/i;
  function isCompanyish(s) { return CO_SUFFIX.test(s) || (/^[A-Z0-9 &.'()\-]{4,}$/.test(clean(s)) && clean(s).split(' ').length >= 2); }
  // Collapse a phrase repeated twice — side-by-side "Bill To | Ship To" columns
  // merge on one visual line as "ARIF CHEMICAL LIME ARIF CHEMICAL LIME".
  function dedupePhrase(s) {
    var w = String(s || '').trim().split(/\s+/), n = w.length;
    if (n < 2 || n % 2) return s;
    var h = n / 2;
    for (var i = 0; i < h; i++) {           // each token pair between halves must match (exactly or by prefix — OCR typos like "ENTERPRISES" vs "ENTERPRIES")
      var a = w[i].toUpperCase(), b = w[h + i].toUpperCase();
      if (a === b) continue;
      var p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
      if (p >= 4 || p >= Math.min(a.length, b.length) * 0.7) continue;
      return s;                             // a genuine multi-word name, not a doubled column
    }
    return w.slice(0, h).join(' ');
  }
  function goodName(s, ownNames) {
    var c = dedupePhrase(clean(s).replace(/[.,;:]+$/, ''));
    if (c.length < 3 || c.length > 72) return '';               // long Indian firm names are valid
    if (isLabel(c)) return '';                                   // <-- the fix: never a label
    if (/^(?:tan|pan|cin|tin|iec|code|no\.?|id|ref|regn?|gst(?:in)?|hsn|sac|state|udyam|msme|drug|lic|tel|ph)\b\s*[:.\-#]/i.test(c)) return '';   // "Supplier TAN: DEL…" → a label:value, never a name
    if (/^[A-Za-z]{4,5}\d{4,5}[A-Za-z]?\d?[A-Za-z]?$/.test(c.replace(/[\s:]/g, ''))) return '';   // a bare TAN/PAN-style token
    if (!/[A-Za-z]{3}/.test(c)) return '';
    if (/^\d/.test(c) || /\d{6}/.test(c)) return '';             // starts with a number / has a pin
    if (ADDR_RE.test(c)) return '';                              // address line, not a name
    if (/\b(?:from|to)\s*:/i.test(c) || /\bconsign(?:or|ee)\b/i.test(c) || /\broute\b/i.test(c)) return '';   // transport route line
    if (/\bto\b/i.test(c) && /\b(?:plant|depot|godown|works|factory|branch|refinery|terminal|siding|station|site)\b/i.test(c)) return '';   // "Gotan To Beawar Plant" — a route, not a firm
    // Declaration / footer / signature fragments — never a supplier name (Step 10).
    if (/^(?:the|for|to|from|as|we|i|received|certified|authoris|authoriz|payer|payee|ordering|declaration|subject|being|goods|value|amount|total|net|place|date|terms|note|remarks?)\b/i.test(c)) return '';
    if (/\b(?:buyer|signator|signature|hereby|certif|received|good\s*condition|amount\s*indicated|terms\s*(?:and|&|of)\b|payer\b|ordering\s*party|declaration|reconciliation|subject\s*to|digitally\s*signed|e-?way|original\s*for|duplicate\s*for|triplicate)\b/i.test(c)) return '';
    if (/\bfor\b/i.test(c) && !CO_SUFFIX.test(c)) return '';   // "the buyer. For", "For & on behalf" — not a company unless it carries a real suffix
    if (/^(?:tax\s*invoice|consignment\s*note|credit\s*note|debit\s*note|delivery\s*challan|bill\s*of\s*supply|proforma|quotation|estimate|cash\s*memo|receipt|challan)\b/i.test(c)) return '';   // a document TITLE, not a firm
    if (/\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]/i.test(norm(c).replace(/\s/g, ''))) return '';    // contains a GSTIN → not a name
    var n = norm(c); for (var i = 0; i < (ownNames || []).length; i++) { if (ownNames[i] && (n.indexOf(ownNames[i]) >= 0 || ownNames[i].indexOf(n) >= 0)) return ''; }
    return c;
  }
  function pickSupplier(lines, sellerG, ownNames, aliases) {
    // 0) learned alias: if any header line was previously corrected → use it
    //    (gated by plausibleName — an alias learned while the old parser was
    //    saving fragments like "the buyer. For" must never re-apply itself)
    for (var a = 0; a < lines.length; a++) { var key = norm(lines[a]); if (aliases[key] && plausibleName(aliases[key])) return { name: aliases[key], conf: 1 }; }
    // 1) explicit seller block ("Seller / Supplier / Sold By / From : NAME")
    for (var i = 0; i < lines.length; i++) {
      // "From" as a seller label needs a colon/dash — bare "From Gotan To Beawar
      // Plant" is a transport route, not "From: <seller>".
      var m = lines[i].match(/^(?:(?:seller|supplier|sold\s*by|vendor|billed\s*by)\s*[:\-]?|from\s*[:\-])\s*(.*)$/i);
      if (m) { var v = goodName(m[1], ownNames); if (v) return { name: v, conf: 0.9 }; var nx = lines[i + 1] && goodName(lines[i + 1], ownNames); if (nx) return { name: nx, conf: 0.85 }; }
    }
    // 2) "M/s NAME" anywhere (strong seller signal on Indian bills)
    for (var j = 0; j < lines.length; j++) { var ms = lines[j].match(/\bm\/?s\.?\s+(.+)$/i); if (ms) { var v2 = goodName(ms[1], ownNames); if (v2) return { name: v2, conf: 0.88 }; } }
    // 3) header company name — first company-like line at the top, before "Invoice".
    for (var h = 0; h < Math.min(lines.length, 6); h++) {
      if (/tax\s*invoice|bill\s*of\s*supply|estimate|quotation|proforma/i.test(lines[h])) break;
      var v3 = goodName(lines[h], ownNames);
      if (v3 && isCompanyish(lines[h])) return { name: v3, conf: CO_SUFFIX.test(lines[h]) ? 0.75 : 0.55 };
    }
    // 4) near the seller GSTIN — name sits in the seller block; prefer a company-
    //    suffix line, skip labels ("GST Registration No") and addresses.
    if (sellerG) {
      var gi = lines.findIndex(function (l) { return norm(l).indexOf(sellerG) >= 0; });
      if (gi >= 0) {
        var best = '';
        for (var k = Math.max(0, gi - 5); k <= gi; k++) {
          var line = lines[k].replace(new RegExp(sellerG, 'i'), '').replace(/gst.*$/i, '').trim();
          var v4 = goodName(line, ownNames); if (!v4) continue;
          if (CO_SUFFIX.test(v4)) return { name: v4, conf: 0.72 };
          if (!best) best = v4;
        }
        if (best) return { name: best, conf: 0.5 };
      }
    }
    return { name: '', conf: 0 };
  }
  function pickBuyer(lines, ownNames) {
    // Skip the Tally header cell "Buyer's Order No." — it's a grid label, not the
    // buyer-name line (it was yielding buyer="'s Order No. Dated").
    var bi = lines.findIndex(function (l) { return /^(?:billed\s*to|bill\s*to|buyer|consignee|ship\s*to|sold\s*to)\b/i.test(l) && !/buyer'?s\s*order|order\s*no|\bp\.?o\.?\s*no|reference\s*no/i.test(l); });
    if (bi >= 0) {
      var head = lines[bi].replace(/^(?:billed\s*to|bill\s*to|buyer|consignee|ship\s*to|sold\s*to)\b\s*[:\-]?\s*/i, '');
      var v = goodNameAny(head); if (v) return { name: v, conf: 0.8 };
      for (var k = bi + 1; k <= bi + 2 && k < lines.length; k++) { var v2 = goodNameAny(lines[k]); if (v2) return { name: v2, conf: 0.75 }; }
    }
    return { name: '', conf: 0 };
  }
  function isOwnName(s, ownNames) { var n = norm(s); for (var i = 0; i < (ownNames || []).length; i++) { var o = norm(ownNames[i]); if (o && (n.indexOf(o) >= 0 || o.indexOf(n) >= 0)) return true; } return false; }
  // Find the name inside a labelled block ("Consignee", "Bill To", …) that is
  // NOT one of our own firms — the counterparty on a sales invoice.
  function pickNamedBlock(lines, labelRe, ownNames) {
    var bi = lines.findIndex(function (l) { return labelRe.test(l) && !/order\s*no|reference/i.test(l); });
    if (bi < 0) return { name: '' };
    var head = lines[bi].replace(labelRe, '').replace(/^[\s:().\-]+/, '');
    var v = goodNameAny(head); if (v && !isOwnName(v, ownNames)) return { name: v };
    for (var k = bi + 1; k <= bi + 2 && k < lines.length; k++) { var v2 = goodNameAny(lines[k]); if (v2 && !isOwnName(v2, ownNames)) return { name: v2 }; }
    return { name: '' };
  }
  // buyer can BE our own firm, so don't exclude own names here
  function goodNameAny(s) { var c = dedupePhrase(clean(s).replace(/^['`\s(\[{]+/, '').replace(/[\s)\]}.,;:'`]+$/, '')); if (c.length < 3 || c.length > 48 || isLabel(c) || /^s\s+order|order\s*no|\bdated\b|reference\s*no/i.test(c) || !/[A-Za-z]{3}/.test(c) || /^\d/.test(c) || /\d{6}/.test(c)) return ''; if (/road|street|nagar|\bpin\b|tehsil/i.test(c)) return ''; return c; }

  /* ── amount picker ───────────────────────────────────────────────────── */
  function labelled(text, re) { var m = text.match(re); return m ? nMoney(m[1]) : null; }
  // Amounts on a line, with inline percentage rates ("2.5%", "18 %") removed —
  // so "CGST @2.5% 21179.25" yields the amount 21179.25, never the rate 2.5.
  function amountsOnLine(line) { return money(String(line).replace(/\d[\d.,]*\s*%/g, ' ')); }
  function pickAmounts(T, lines) {
    var out = { conf: {} };
    // The amount is the FIRST money that appears AFTER the label (on the same
    // line, or the next line if the label stands alone) — robust to a whole
    // tax block flattened onto one OCR line, and it never grabs the % rate.
    // Strip numbers that are a rate/percentage OR a quantity (a number followed
    // by a unit like TO/MT/KG/%): on "Taxable Value 32.380 TO 16220.000 TO
    // 525203.60" this leaves only the true amount 525203.60, never the qty/rate.
    function strip(s) { return stripUnits(s); }
    // Prefer a DECIMAL-bearing amount (real GST amounts carry paise, e.g.
    // 11,60,333.10) over a bare integer — so a leading HSN code / pincode in the
    // data row (e.g. "25210010  11,60,333.10 …") is never taken as the amount.
    function decimals(s) { return (String(s).match(/\d[\d,]*\.\d{1,2}\b/g) || []).map(function (x) { return round2(parseFloat(x.replace(/,/g, ''))); }).filter(function (n) { return isFinite(n); }); }
    // The HSN/SAC code sits in the first column of the tax-summary rows and looks
    // like a bare 4–8 digit number (e.g. 392310). Detect it once and never let it
    // be read as taxable / CGST / SGST — that produced taxable = 392310 on bags.
    var _hsn = (T.match(/\bHSN(?:\s*\/?\s*SAC)?\s*(?:code|no)?\s*[:\-]?\s*(\d{4,8})\b/i) || [])[1]
      || (T.match(/\b(2521|2522|2523|2701|2713|3923|6305|4819)\d{0,4}\b/) || [])[0];
    var _hsnNum = _hsn ? parseInt(_hsn, 10) : null;
    function notHsn(n) { return !(n >= 1000000 && n === Math.floor(n)) && !(_hsnNum != null && n === _hsnNum); }   // drop bare 7+ digit integers + the HSN code
    function firstAmtAfter(re, skip) {
      for (var i = 0; i < lines.length; i++) {
        if (skip && skip.test(lines[i])) continue;
        var m = re.exec(lines[i]); if (!m) continue;
        var tail = strip(lines[i].slice(m.index + m[0].length));
        var d = decimals(tail); if (d.length) return d[0];
        var mo = money(tail).filter(notHsn); if (mo.length) return mo[0];
        // Value on a LATER line: a Tally/Busy grid can wrap a quantity line
        // BETWEEN the label and its amount ("Grand Total" ↵ "26,000 Nos" ↵
        // "1,22,720.00"). Scan the next few lines, skipping quantity-only lines
        // (nothing left after stripUnits), and take the first real amount. Stop
        // if a line introduces a DIFFERENT amount label so "Taxable" never drifts
        // into the CGST value.
        for (var j = i + 1; j <= i + 3 && j < lines.length; j++) {
          var nx = strip(lines[j]);
          var d2 = decimals(nx); if (d2.length) return d2[0];
          var mo2 = money(nx).filter(notHsn); if (mo2.length) return mo2[0];
          if (/\b(?:c\s*gst|s\s*gst|i\s*gst|central\s*tax|state\s*tax|integrated\s*tax|grand\s*total|round)/i.test(lines[j])) break;
        }
      }
      return null;
    }
    // A tax-summary COLUMN HEADER ("HSN/SAC  Taxable  Central Tax  State Tax  Total")
    // must never be read as a data row — its amounts belong to the HSN line below
    // it, so "Taxable"/"Central Tax" there would grab the HSN code or the first
    // line-item, not the summary totals. Skip any line that pairs Taxable/tax
    // labels together like a header.
    var HEAD = /taxable[^\n]*?(?:central|state|integrated)\s*tax|(?:central|integrated)\s*tax[^\n]*?state\s*tax/i;
    out.taxable = firstAmtAfter(/taxable(?:\s*(?:value|amount|amt))?|total\s*taxable|basic\s*(?:value|amount)|assessable\s*value|amount\s*before\s*tax/i, HEAD);
    if (out.taxable != null) out.conf.taxable = 0.85;
    // Skip declaration / notification / legal-citation lines — "Notification No.
    // 2/2017-Central Tax (Rate)" and "Section 31(3)(c)" must NEVER be read as a
    // CGST amount (that fabricated cgst=31 on an exempt Bill of Supply).
    var LEGAL = /notification|declaration|vide|under\s*section|section\s*\d|\(rate\)|computer\s*gen|subject\s*to|certif/i;
    var SKIP = new RegExp(LEGAL.source + '|' + HEAD.source, 'i');
    // Letter-spaced headers ("C G S T", "S G S T") are common on e-invoice grids,
    // so allow whitespace between every letter of the tax label.
    out.cgst = firstAmtAfter(/\bc\s*g\s*s\s*t\b|central\s*tax/i, SKIP); if (out.cgst != null) out.conf.cgst = 0.8;
    out.sgst = firstAmtAfter(/\bs\s*g\s*s\s*t\b|state\s*tax|\bu\s*g\s*s\s*t\b/i, SKIP); if (out.sgst != null) out.conf.sgst = 0.8;
    out.igst = firstAmtAfter(/\bi\s*g\s*s\s*t\b|integrated\s*tax/i, SKIP); if (out.igst != null) out.conf.igst = 0.8;
    // Round-off keeps its SIGN — a SAP "ZRND Rounding Difference -0.18" is
    // negative; nMoney() strips the minus, so parse it sign-aware here.
    var roM = T.match(/round(?:ed|ing)?\s*(?:off|difference)?[^0-9\-]{0,12}(-?[0-9][0-9,]*\.?[0-9]{0,2})/i);
    out.roundOff = roM ? round2(parseFloat(roM[1].replace(/,/g, ''))) : null;
    // Grand total first; then a bare "Total" — skipping sub-total / "total for
    // material" / taxable / qty lines.
    out.total = firstAmtAfter(/grand\s*total|invoice\s*(?:value|total)|amount\s*payable|net\s*(?:amount|payable)|bill\s*(?:amount|total)/i);
    if (out.total == null) out.total = firstAmtAfter(/\btotal\b/i, /sub\s*-?\s*total|in\s*words|qty|quantity|total\s*for\b/i);
    if (out.total != null) out.conf.total = 0.8;
    return out;
  }
  function pickRate(T, A) {
    // rate from tax math (most reliable)
    if (A.taxable && (A.cgst != null || A.igst != null)) {
      var gst = (A.cgst || 0) + (A.sgst || 0) + (A.igst || 0);
      var r = gst / A.taxable * 100;
      var snap = [0, 3, 5, 12, 18, 28].filter(function (x) { return Math.abs(x - r) <= 0.7; })[0];
      if (snap != null) { A.rateFromMath = true; return snap; }
    }
    var m = norm(T).match(/\b(0|3|5|12|18|28)\s?%/); if (m) return +m[1];
    m = T.match(/[ci]?gst\s*@?\s*(\d{1,2})(?:\.0+)?\s*%/i); if (m) return +m[1];
    return null;
  }

  /* ── legacy adapter: feed the existing ocrMap (docno/name/taxable/…) ────
     Also re-keys confidence + review onto the GENERIC keys the import form
     uses, so the UI can badge each field. */
  var GEN = { billNo: 'docno', date: 'date', supplier: 'name', supplierGstin: 'gstin', taxable: 'taxable', total: 'total', gstRate: 'rate', group: 'group', item: 'item' };
  function legacy(res) {
    var f = res.fields, rev = res.review || [];
    // Fill the best-guess value for every field (so nothing is silently empty);
    // the UI still flags low-confidence fields for review via _review.
    function ok(k, v) { return v == null ? '' : v; }
    var gconf = {}, grev = [], gver = {};
    Object.keys(res.confidence || {}).forEach(function (k) { gconf[GEN[k] || k] = res.confidence[k]; });
    Object.keys(res.verify || {}).forEach(function (k) { gver[GEN[k] || k] = res.verify[k]; });
    rev.forEach(function (k) { grev.push(GEN[k] || k); });
    return {
      _text: res.raw, _conf: gconf, _review: grev, _verify: gver, _warn: res.warnings, _fields: f,
      docno: ok('billNo', f.billNo), date: ok('date', f.date),
      name: ok('supplier', f.supplier), gstin: ok('supplierGstin', f.supplierGstin), buyergstin: f.buyerGstin || '', dir: f.direction || '',
      noid: !!res.noIdentity,          // "we have no GSTIN, so dir is unknowable" — NOT "dir was merely unreadable"
      taxable: ok('taxable', f.taxable), total: ok('total', f.total), rate: ok('gstRate', f.gstRate),
      cgst: f.cgst, sgst: f.sgst, igst: f.igst, totalgst: f.totalGst, roundoff: f.roundOff,
      group: ok('group', f.group), item: ok('item', f.item), hsn: f.hsn, qty: f.qty, veh: f.vehicle, itc: f.itc
    };
  }

  /* ── built-in sample corpus + one-click self-test ─────────────────────
     Real-shaped Indian GST purchase bills across every category, each with
     ground-truth. Powers the "Run Import Test Suite" button. */
  var OWN = { ownGstins: ['08AABCG1234H1Z5', '08AADFD5678K1Z9'], ownNames: ['GOTAN LIME INDUSTRIES', 'DESHWALI MINERALS'] };
  var SAMPLES = [
    { name: 'Label-trap (the reported bug)', cat: 'limestone/CGST+SGST', text: 'INDORAMA CEMENT LIMITED\nPlot 42, GIDC Industrial Area, Bharuch, Gujarat\nGST Registration No\n24AABCI2929N1ZK\nTAX INVOICE\nInvoice No : 20273121B006913   Dated : 19-Jun-2026\nBilled To : Gotan Lime Industries  GSTIN 08AABCG1234H1Z5\nLimestone HSN 2521\nTaxable Value 84717.00\nCGST 2.5% 2117.93\nSGST 2.5% 2117.93\nGrand Total 88952.86\nReverse Charge : No', expect: { supplier: 'INDORAMA CEMENT LIMITED', supplierGstin: '24AABCI2929N1ZK', billNo: '20273121B006913', date: '19-Jun-2026', taxable: 84717, total: 88952.86, gstRate: 5, itc: 'Eligible' } },
    { name: 'Limestone (M/s)', cat: 'limestone/CGST+SGST', text: 'M/s Mateshwari Mines and Minerals\nGSTIN 08ABCFM1234N1ZP\nBill No: GJ5534   Date: 15/06/2026\nTo: Gotan Lime Industries GSTIN 08AABCG1234H1Z5\nLimestone (Kankar) HSN 2521\nTaxable Value 847170.00 CGST 2.5% 21179.25 SGST 2.5% 21179.25 Grand Total 889529.00\nReverse Charge : No', expect: { supplier: 'Mateshwari Mines and Minerals', group: 'limestone', gstRate: 5, taxable: 847170, itc: 'Eligible' } },
    { name: 'Petcoke IGST inter-state', cat: 'petcoke/IGST', text: 'Reliance Industries Limited\nJamnagar Gujarat\nGSTIN 24AAACR5055K1Z7\nTax Invoice No RIL/2026/8842 Dt 02-Jun-2026\nBill To Deshwali Minerals GSTIN 08AADFD5678K1Z9\nPet Coke HSN 2713\nTaxable Amount 1000000.00 IGST 18% 180000.00 Invoice Value 1180000.00', expect: { supplier: 'Reliance Industries Limited', group: 'petcoke', gstRate: 18, igst: 180000, total: 1180000 } },
    { name: 'Zero-GST exempt', cat: 'no-GST', text: 'Krishna Traders\nGSTIN 08AAACK1111A1Z0\nBill No 771 Date 10-Jun-26\nTo Gotan Lime Industries\nExempt agricultural produce\nTaxable Value 50000.00 Total 50000.00', expect: { supplier: 'Krishna Traders', total: 50000 } },
    { name: 'Plastic bags', cat: 'packaging', text: 'Shree Balaji Polysack Industries\nGSTIN 24AAECS7777P1ZR\nInvoice No SBP/771 Date 12-Jun-2026\nBill To Gotan Lime Industries GSTIN 08AABCG1234H1Z5\nHDPE Woven Sack Bags HSN 6305\nTaxable Value 174000.00 CGST 9% 15660.00 SGST 9% 15660.00 Grand Total 205320.00\nReverse Charge : No', expect: { supplier: 'Shree Balaji Polysack Industries', group: 'packaging', gstRate: 18, itc: 'Eligible' } },
    { name: 'Royalty on limestone', cat: 'royalty', text: 'Department of Mines and Geology\nGSTIN 08AAAGD0001A1Z5\nChallan No DMG/RY/551 Date 09-Jun-2026\nTo Gotan Lime Industries\nRoyalty on Limestone (Mineral) DMF NMET\nTaxable Value 300000.00 CGST 9% 27000.00 SGST 9% 27000.00 Grand Total 354000.00', expect: { group: 'royalty', gstRate: 18 } },
    { name: 'GTA freight RCM', cat: 'transport/RCM', text: 'M/s Shree Balaji Roadlines\nGSTIN 08AABCT9999Q1ZX\nConsignment Note TC/551 Date 20/06/2026\nTo Gotan Lime Industries\nGoods Transport Agency - Freight for limestone\nFreight 45000.00\nTax payable by recipient under RCM\nTotal 45000.00', expect: { supplier: 'Shree Balaji Roadlines', group: 'transport', itc: 'RCM' } },
    { name: 'Diesel / HSD', cat: 'fuel', text: 'Shree Balaji Filling Station\nGSTIN 08AAAFS2222B1Z4\nInvoice No FS/8890 Date 11-Jun-2026\nTo Gotan Lime Industries\nHigh Speed Diesel HSD 2000 Ltr\nTaxable Value 178840.00 Total 178840.00', expect: { supplier: 'Shree Balaji Filling Station', group: 'fuel' } },
    { name: 'Bank charges 18%', cat: 'bank', text: 'HDFC Bank Limited\nGST Registration No 07AAACH2702H1ZS\nTax Invoice / Debit Note No BC/2211 Date 30-Jun-2026\nTo Gotan Lime Industries GSTIN 08AABCG1234H1Z5\nProcessing fee and bank commission\nTaxable Value 5000.00 CGST 9% 450.00 SGST 9% 450.00 Grand Total 5900.00\nReverse Charge : No', expect: { supplier: 'HDFC Bank Limited', group: 'bank', gstRate: 18, itc: 'Eligible' } },
    { name: 'Long supplier name', cat: 'labour', text: 'SHREE BALAJI LABOUR CONTRACTOR & MANPOWER SUPPLIERS\nGSTIN 08AACFS9012K1Z6\nInvoice No SBL/LAB/0271 Dated 18/02/2025\nBilled To Gotan Lime Industries GSTIN 08AABCG1234H1Z5\nLoading & Unloading of Limestone SAC 998519\nTaxable Value 85000.00 CGST 9% 7650.00 SGST 9% 7650.00 Grand Total 100300.00\nReverse Charge : No', expect: { supplier: 'SHREE BALAJI LABOUR CONTRACTOR & MANPOWER SUPPLIERS', group: 'labour', itc: 'Eligible' } },
    { name: 'Blurry (must blank, not fake)', cat: 'low-confidence', text: 'T@X 1NV0ICE\nS0me Vend0r ???\nG$TlN 08 A?BC ????\nT0tal ...', expect: { supplier: null, total: null, taxable: null } },
    { name: 'Duplicate of #2 (same supplier+bill)', cat: 'duplicate', text: 'M/s Mateshwari Mines and Minerals\nGSTIN 08ABCFM1234N1ZP\nBill No: GJ5534   Date: 15/06/2026\nTo: Gotan Lime Industries\nLimestone Taxable Value 847170.00 CGST 21179.25 SGST 21179.25 Grand Total 889529.00', expect: { supplier: 'Mateshwari Mines and Minerals', _dupOf: 1 } }
  ];
  function eqVal(exp, got) {
    if (exp === null) return got == null || got === '';                  // expected blank
    if (typeof exp === 'number') return got != null && Math.abs(+got - exp) <= 2;
    return String(got || '').toLowerCase().trim() === String(exp).toLowerCase().trim();
  }
  function selfTest() {
    var GROUPS_OF = { supplier: ['supplier'], amount: ['taxable', 'total'], gst: ['gstRate', 'cgst', 'sgst', 'igst'] };
    var rep = { total: 0, passed: 0, failed: 0, labelErrors: 0, fakeErrors: 0, fieldPass: 0, fieldTot: 0, byGroup: { supplier: [0, 0], amount: [0, 0], gst: [0, 0], total: [0, 0] }, cases: [] };
    var dupKeys = {};
    SAMPLES.forEach(function (s) {
      var r = parse(s.text, OWN), f = r.fields, fr = [], allOk = true;
      Object.keys(s.expect).forEach(function (k) {
        if (k[0] === '_') return;
        var exp = s.expect[k], got = f[k], ok = eqVal(exp, got);
        rep.fieldTot++; if (ok) rep.fieldPass++; else allOk = false;
        if (k === 'supplier' && got && isLabel(String(got))) rep.labelErrors++;
        if (exp === null && got != null && got !== '') rep.fakeErrors++;
        ['supplier', 'amount', 'gst'].forEach(function (g) { if (GROUPS_OF[g].indexOf(k) >= 0) { rep.byGroup[g][1]++; if (ok) rep.byGroup[g][0]++; } });
        if (k === 'total') { rep.byGroup.total[1]++; if (ok) rep.byGroup.total[0]++; }
        fr.push({ name: k, exp: exp === null ? '(blank)' : exp, got: got == null ? '(blank)' : got, pass: ok });
      });
      // duplicate-key check
      if (s.expect._dupOf != null) { var key = String(f.supplier || '') + '|' + String(f.billNo || ''); rep.dup = rep.dup || { n: 0, ok: 0 }; rep.dup.n++; if (dupKeys[key.toUpperCase()]) rep.dup.ok++; }
      var key2 = String(f.supplier || '') + '|' + String(f.billNo || ''); if (f.billNo) dupKeys[key2.toUpperCase()] = 1;
      rep.total++; if (allOk) rep.passed++; else rep.failed++;
      rep.cases.push({ name: s.name, cat: s.cat, pass: allOk, supplier: f.supplier || '', fields: fr });
    });
    var pc = function (a) { return a[1] ? Math.round(a[0] / a[1] * 100) : 100; };
    rep.fieldAccuracy = rep.fieldTot ? Math.round(rep.fieldPass / rep.fieldTot * 100) : 0;
    rep.supplierAccuracy = pc(rep.byGroup.supplier);
    rep.amountAccuracy = pc(rep.byGroup.amount);
    rep.gstAccuracy = pc(rep.byGroup.gst);
    rep.totalAccuracy = pc(rep.byGroup.total);
    rep.duplicateAccuracy = rep.dup ? Math.round(rep.dup.ok / rep.dup.n * 100) : 100;
    return rep;
  }

  return {
    parse: parse, legacy: legacy, isLabel: isLabel, validGstin: validGstin, plausibleName: plausibleName,
    detectGroup: detectGroup, goodName: goodName, findDate: findDate, nMoney: nMoney, LABEL_RE: LABEL_RE,
    SAMPLES: SAMPLES, selfTest: selfTest
  };
});

/* build ocr22: direction uses buyer-context on own GSTIN before issuer heuristic (IOC petcoke buyer-block-first layout no longer flips purchase→sale) */

/* build ocr23: e-invoice Ack Date (dangling label, value on next line) no longer taken as the bill date */
