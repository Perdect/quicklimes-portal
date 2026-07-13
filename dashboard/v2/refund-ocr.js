/* refund-ocr.js — parse a GST RFD-01 "Refund ARN Receipt" (and RFD-02/06 where
   present) into structured fields for the GST Refund tracker. Pure + tested:
   parseRFD(text) → { arn, gstin, tradeName, legalName, appDate, fromPeriod,
   toPeriod, reason, igst, cgst, sgst, cess, total, kind, review }.
   Petcoke refunds are the inverted-duty-structure §54(3) case. */
(function (root) {
  'use strict';

  var GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z])\b/;

  // Pull the amount that follows a head label — the value may sit on the same
  // line ("Integrated Tax   434345") or the next line (label\n value).
  function amtAfter(text, label) {
    // label is wrapped in a NON-capturing group so an alternation inside it
    // (e.g. "State/UT Tax|State Tax") can't swallow the value's capture group.
    var re = new RegExp('(?:' + label + ')[^0-9\\n]*([0-9][0-9,]*)', 'i');
    var m = text.match(re);
    if (m && m[1]) return num(m[1]);
    // fallback: label on its own line, number on the next non-empty line
    var re2 = new RegExp('(?:' + label + ')\\s*\\n\\s*([0-9][0-9,]*)', 'i');
    var m2 = text.match(re2);
    return m2 && m2[1] ? num(m2[1]) : null;
  }
  function num(s) { return s == null ? null : (parseFloat(String(s).replace(/,/g, '')) || 0); }
  function grab(text, re) { var m = text.match(re); return m ? m[1].trim() : null; }

  function parseRFD(text) {
    var T = String(text || '').replace(/\r/g, '');
    var review = [];

    var arn = grab(T, /Application\s+Reference\s+Number\s*\(?ARN\)?\s*[:\-]?\s*([A-Z]{2}\d{10,14}[A-Z0-9])/i)
      || grab(T, /\bARN\b\s*[:\-]?\s*([A-Z]{2}\d{10,14}[A-Z0-9])/i);
    var gm = T.match(GSTIN_RE);
    var gstin = gm ? gm[1] : null;

    var appDate = grab(T, /Date\s+of\s+Application\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i);
    var fromP = grab(T, /From\s+Period\s*[:\-]?\s*([A-Za-z]+\s+\d{4})/i);
    var toP = grab(T, /To\s+Period\s*[:\-]?\s*([A-Za-z]+\s+\d{4})/i);
    var reason = grab(T, /Reason\s+of\s+Refund\s*[:\-]?\s*([^\n]+)/i);
    var trade = grab(T, /Trade\s+Name\s*[:\-]?\s*([^\n]+)/i);
    var legal = grab(T, /Legal\s+Name\s*[:\-]?\s*([^\n]+)/i);

    var igst = amtAfter(T, 'Integrated\\s*Tax');
    var cgst = amtAfter(T, 'Central\\s*Tax');
    var sgst = amtAfter(T, 'State/?\\s*UT\\s*Tax|State\\s*Tax');
    var cess = amtAfter(T, '\\bCESS\\b');
    var totalRead = amtAfter(T, '\\bTotal\\b');

    var parts = [igst, cgst, sgst, cess].map(function (x) { return x || 0; });
    var totalCalc = parts.reduce(function (a, b) { return a + b; }, 0);
    var total = totalCalc || totalRead || 0;
    // If the printed Total disagrees with the sum of heads, trust the sum but flag.
    if (totalRead && totalCalc && Math.abs(totalRead - totalCalc) > 1) review.push('total');

    if (!arn) review.push('arn');
    if (!gstin) review.push('gstin');
    if (!total) review.push('amount');

    var kind = /RFD-?\s*0?6|sanction/i.test(T) ? 'RFD-06'
      : /RFD-?\s*0?2|acknowledge?ment/i.test(T) && /ARN\s+Receipt/i.test(T) === false ? 'RFD-02'
      : 'RFD-01';

    return {
      arn: arn || '', gstin: gstin || '', tradeName: trade || '', legalName: legal || '',
      appDate: appDate || '', fromPeriod: fromP || '', toPeriod: toP || '',
      reason: reason || '', kind: kind,
      igst: igst || 0, cgst: cgst || 0, sgst: sgst || 0, cess: cess || 0, total: total,
      review: review
    };
  }

  var api = { parseRFD: parseRFD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLRefundOCR = api;
})(typeof window !== 'undefined' ? window : this);
