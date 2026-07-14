/* refund-ocr.js — parse a GST RFD-01 "Refund ARN Receipt" (and RFD-02/06 where
   present) into structured fields for the GST Refund tracker. Pure + tested:
   parseRFD(text) → { arn, gstin, tradeName, legalName, appDate, fromPeriod,
   toPeriod, reason, igst, cgst, sgst, cess, total, kind, review }.
   Petcoke refunds are the inverted-duty-structure §54(3) case.

   WHY THIS IS NOT A SIMPLE label→value PARSER: the GST portal's PDF lays the
   refund table out as free-floating text runs, so the extracted text interleaves
   the head labels AWAY from their amounts, and the order differs between
   extractors (pdf.js vs pdftotext). A real receipt extracts as:

       Integrated Tax / 434345 / Central Tax / 50412 /
       State/UT Tax / CESS / 50412 / Total / 0 / 535169
                      ^^^^ SGST's value now sits after the CESS label

   Reading "the number after each label" therefore yields SGST=0, CESS=50412.
   What IS stable is that the VALUES print in canonical order
   [IGST, CGST, SGST, CESS, Total] and that IGST+CGST+SGST+CESS === Total.
   So we take the numbers positionally and use that sum as a checksum, only
   falling back to label-adjacency when no window balances. */
(function (root) {
  'use strict';

  var GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z])\b/;
  var ARN_RE = /\b([A-Z]{2}\d{10,14}[A-Z0-9])\b/;
  // Labels that terminate a field's value (used to capture wrapped multi-line values).
  var STOP = 'Application\\s+Reference|Date\\s+of\\s+Application|Time\\s+of\\s+Filing|GSTIN|Trade\\s+Name|Legal\\s+Name|Reason\\s+of\\s+Refund|Cent(?:er|re)\\s+Jurisdiction|State\\s+Jurisdiction|From\\s+Period|To\\s+Period|Head\\b|Tax\\(ITC\\)|Amount\\s+of\\s+Refund|Note\\s*:';

  function num(s) { return s == null ? null : (parseFloat(String(s).replace(/,/g, '')) || 0); }
  function grab(text, re) { var m = text.match(re); return m ? String(m[1]).trim() : null; }
  function tidy(s) { return s == null ? null : s.replace(/\s+/g, ' ').trim(); }

  /* Capture a label's value even when it wraps onto following lines; stop at the
     next known label so we never swallow the rest of the receipt. */
  function field(text, label) {
    var re = new RegExp(label + '\\s*[:\\-]?\\s*([\\s\\S]*?)(?=\\n\\s*(?:' + STOP + ')|$)', 'i');
    var m = text.match(re);
    return m ? tidy(m[1]) || null : null;
  }

  /* Strategy B — label adjacency (the number nearest after a head label). */
  function amtAfter(text, label) {
    var re = new RegExp('(?:' + label + ')[^0-9\\n]*([0-9][0-9,]*(?:\\.\\d+)?)', 'i');
    var m = text.match(re);
    if (m && m[1]) return num(m[1]);
    var re2 = new RegExp('(?:' + label + ')\\s*\\n\\s*([0-9][0-9,]*(?:\\.\\d+)?)', 'i');
    var m2 = text.match(re2);
    return m2 && m2[1] ? num(m2[1]) : null;
  }

  function balances(h) {
    var sum = (h.igst || 0) + (h.cgst || 0) + (h.sgst || 0) + (h.cess || 0);
    return h.total > 0 && Math.abs(sum - h.total) <= 1;
  }

  /* Strategy A — positional: pull every number from the amounts region and find
     the first 5-number window [a,b,c,d,e] where a+b+c+d === e (e > 0). That
     window is [IGST, CGST, SGST, CESS, Total] regardless of label interleaving. */
  function headsPositional(T) {
    var start = T.search(/Amount\s+of\s+Refund\s+Claimed|Integrated\s*Tax/i);
    if (start < 0) return null;
    var region = T.slice(start);
    var nums = [], m, re = /(?:^|[\s(])([0-9][0-9,]*(?:\.\d+)?)(?=[\s)]|$)/g;
    while ((m = re.exec(region))) nums.push(num(m[1]));
    for (var i = 0; i + 4 < nums.length; i++) {
      var w = { igst: nums[i], cgst: nums[i + 1], sgst: nums[i + 2], cess: nums[i + 3], total: nums[i + 4] };
      if (balances(w)) return w;
    }
    // No printed total? 4 heads whose sum is positive still gives us the refund.
    if (nums.length >= 4) {
      var s = nums[0] + nums[1] + nums[2] + nums[3];
      if (s > 0) return { igst: nums[0], cgst: nums[1], sgst: nums[2], cess: nums[3], total: s, derivedTotal: true };
    }
    return null;
  }

  function headsByLabel(T) {
    var h = {
      igst: amtAfter(T, 'Integrated\\s*Tax') || 0,
      cgst: amtAfter(T, 'Central\\s*Tax') || 0,
      sgst: amtAfter(T, 'State/?\\s*UT\\s*Tax|State\\s*Tax') || 0,
      cess: amtAfter(T, '\\bCESS\\b') || 0
    };
    var read = amtAfter(T, '\\bTotal\\b');
    h.total = read || (h.igst + h.cgst + h.sgst + h.cess);
    return h;
  }

  function parseRFD(text) {
    var T = String(text || '').replace(/\r/g, '');
    var review = [];

    // ARN — the label can print AFTER its value (pdf.js run order), so fall back
    // to a document-wide scan. The pattern can't collide with a GSTIN (digits first).
    var arn = grab(T, /Application\s+Reference\s+Number\s*\(?ARN\)?\s*[:\-]?\s*([A-Z]{2}\d{10,14}[A-Z0-9])/i)
      || grab(T, /\bARN\b\s*[:\-]?\s*([A-Z]{2}\d{10,14}[A-Z0-9])/i)
      || grab(T, ARN_RE);

    var gm = T.match(GSTIN_RE);
    var gstin = gm ? gm[1] : null;

    var appDate = grab(T, /Date\s+of\s+Application\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i);
    var fromP = grab(T, /From\s+Period\s*[:\-]?\s*([A-Za-z]+\s+\d{4})/i);
    var toP = grab(T, /To\s+Period\s*[:\-]?\s*([A-Za-z]+\s+\d{4})/i);
    var reason = field(T, 'Reason\\s+of\\s+Refund');
    var trade = field(T, 'Trade\\s+Name');
    var legal = field(T, 'Legal\\s+Name');

    // Amounts: positional first (checksum-validated), label-adjacency as fallback.
    var pos = headsPositional(T), lab = headsByLabel(T), h, src;
    if (pos && balances(pos)) { h = pos; src = 'positional'; }
    else if (balances(lab)) { h = lab; src = 'label'; }
    else if (pos) { h = pos; src = 'positional-unbalanced'; review.push('amount'); }
    else { h = lab; src = 'label-unbalanced'; if (!h.total) review.push('amount'); }
    // If a Total is printed AND disagrees with the sum of the heads, trust the
    // heads but never let the discrepancy pass silently.
    var printedTotal = amtAfter(T, '\\bTotal\\b');
    if (printedTotal && h.total && Math.abs(printedTotal - h.total) > 1) review.push('total');

    if (!arn) review.push('arn');
    if (!gstin) review.push('gstin');
    if (!h.total) review.push('amount');

    var kind = /RFD-?\s*0?6|sanction/i.test(T) ? 'RFD-06'
      : /RFD-?\s*0?2|acknowledge?ment/i.test(T) && /ARN\s+Receipt/i.test(T) === false ? 'RFD-02'
      : 'RFD-01';

    // Inverted-duty (§54(3)) is the petcoke case — surface it as a clean flag.
    var inverted = /inverted\s+(?:tax\s+)?(?:duty\s+)?structure|54\s*\(\s*3\s*\)/i.test(reason || T);

    return {
      arn: arn || '', gstin: gstin || '', tradeName: trade || '', legalName: legal || '',
      appDate: appDate || '', fromPeriod: fromP || '', toPeriod: toP || '',
      reason: reason || '', kind: kind, inverted: inverted,
      igst: h.igst || 0, cgst: h.cgst || 0, sgst: h.sgst || 0, cess: h.cess || 0,
      total: h.total || 0, amountSource: src, balanced: balances(h),
      review: review.filter(function (v, i, a) { return a.indexOf(v) === i; })
    };
  }

  var api = { parseRFD: parseRFD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLRefundOCR = api;
})(typeof window !== 'undefined' ? window : this);

/* build r2: order-independent RFD-01 amount parsing (positional + checksum) */
