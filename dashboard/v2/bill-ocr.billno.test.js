/* Bill number must never be a DATE — run: node dashboard/v2/bill-ocr.billno.test.js

   THE REPORTED BUG: a purchase bill's REF column showed "30-Apr-26" — a date —
   where sibling rows correctly showed "392/25-26", "222/26-27". Both bill-number
   guards excluded only NUMERIC dates, so Tally's alpha-month "30-Apr-26" cleared
   every filter and landed in billNo → docno → p.bill.

   Two directions are under test and they pull against each other:
     1. a date must never be accepted as a bill number, and
     2. a real bill number must never be rejected as a date.
   (2) is the dangerous one: Indian fiscal-year numbers look date-ish
   ("392/25-26", "1/25-26") and dedupe keys on bill number + supplier, so eating
   one is worse than admitting a date. Every value below is real. */
const OCR = require('./bill-ocr.js');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else { fail++; console.log('  ✗ FAIL:', name, extra != null ? '· ' + JSON.stringify(extra) : ''); } }
function eq(name, a, b) { ok(name + ' (got ' + JSON.stringify(a) + ')', a === b); }

const OWN = { ownGstins: ['08AABCG1234H1Z5'], ownNames: ['GOTAN LIME INDUSTRIES'] };
const billNoOf = t => OCR.parse(t, OWN).fields.billNo;

/* ═══ 1. The predicate — dates ARE dates ═══════════════════════════════════ */
console.log('date tokens are rejected');
[
  '30-Apr-26', '29-Jun-26', '10-Dec-2025', '1-Jan-25',   // alpha month, 3-letter (the bug)
  '30-April-2026', '10-December-2025',                    // full month name
  '30/04/2026', '30-04-26', '1/1/25',                     // numeric (already handled — pinned)
  '30-APR-26', '30-apr-26', '30-ApR-26',                  // case variants
  '30.04.2026', '30.Apr.26',                              // dot separator
  '30 Apr 26', '30 04 2026'                               // space separator
].forEach(d => ok('"' + d + '" is a date', OCR.isDateToken(d), d));

/* ═══ 2. The predicate — real bill numbers SURVIVE ═════════════════════════ */
console.log('real bill numbers are not dates');
[
  '392/25-26', '222/26-27', '151/26-27',                  // real, from this user's bills
  '165/2025-26', '272/25-26', '328/25-26',
  'B-9021', 'GST/2025/001', 'INV-2026-14',
  '20273121B006913', 'GJ5534', '58',                      // SAP / Tally serial
  '1/25-26', '12/25-26'                                   // date-SHAPED but month 25>12 ⇒ invoice 1 of FY25-26
].forEach(n => ok('"' + n + '" is NOT a date', !OCR.isDateToken(n), n));

console.log('predicate edges');
ok('empty is not a date', !OCR.isDateToken(''));
ok('null is not a date', !OCR.isDateToken(null));
ok('undefined is not a date', !OCR.isDateToken(undefined));
ok('day 32 is not a date', !OCR.isDateToken('32-Apr-26'));
ok('month 13 is not a date', !OCR.isDateToken('30-13-26'));
ok('"Apr" alone is not a date', !OCR.isDateToken('Apr'));
ok('not a substring match', !OCR.isDateToken('X30-Apr-26'), 'anchored both ends');
ok('not a substring match (tail)', !OCR.isDateToken('30-Apr-26X'));

/* ═══ 3. END-TO-END through the real parser ════════════════════════════════
   Tally / e-invoice grids print the label and its value on separate lines, and
   the value line carries BOTH the invoice number and the date. */
console.log('end-to-end: Tally grid, one value line holds number AND date');

// 3a. Column-aligned: the number sits under the label. (Honest note: this shape
// passed BEFORE the fix too — the date lost on column distance. It pins the
// direction that must not regress: the fix must not eat the invoice number.)
eq('aligned grid → invoice number, not the date', billNoOf(`SHREE MINERALS
GSTIN 08ABCFM1234N1ZP
Tax Invoice
Invoice No.        Dated
222/26-27          29-Jun-26
Billed to Gotan Lime Industries
GSTIN 08AABCG1234H1Z5
Taxable Value 1000.00
Grand Total 1180.00`), '222/26-27');

// 3b. pdf.js fuses columns, so the date can land NEARER the label column than the
// real number and win on distance. This is the shape that actually shipped the
// bug: it returned "30-Apr-26" before the fix.
eq('fused grid, date first → still the invoice number', billNoOf(`SHREE MINERALS
GSTIN 08ABCFM1234N1ZP
Tax Invoice
Invoice No.        Dated
30-Apr-26          392/25-26
Billed to Gotan Lime Industries
GSTIN 08AABCG1234H1Z5
Grand Total 1180.00`), '392/25-26');

// 3c. The inline scan (the OTHER guard) — proves both call sites are covered.
// Nothing but a date is on offer, so blank/needs-review is correct: the golden
// rule is that unclear fields go blank rather than wrong.
ok('inline "Invoice No : <date>" → never the date', !billNoOf(`SHREE MINERALS
GSTIN 08ABCFM1234N1ZP
Invoice No : 30-Apr-26
Billed to Gotan Lime Industries
GSTIN 08AABCG1234H1Z5`), billNoOf(`SHREE MINERALS
GSTIN 08ABCFM1234N1ZP
Invoice No : 30-Apr-26
Billed to Gotan Lime Industries
GSTIN 08AABCG1234H1Z5`));

// 3d. Grid where the date is the ONLY candidate → blank, not a fake number.
ok('grid with only a date under the label → blank', !billNoOf(`SHREE MINERALS
GSTIN 08ABCFM1234N1ZP
Invoice No.   Dated
30-Apr-26
Billed to Gotan Lime Industries
GSTIN 08AABCG1234H1Z5`));

// 3e. The fix must not cost us the real number on an ordinary inline bill.
eq('inline bill number still extracted', billNoOf(`SHREE MINERALS
GSTIN 08ABCFM1234N1ZP
Tax Invoice   Invoice No: 392/25-26   Dated: 30-Apr-26
Billed to Gotan Lime Industries
GSTIN 08AABCG1234H1Z5`), '392/25-26');

// 3f. ...and the DATE field must still be found on that same bill. (Kept verbatim
// as printed — data.js toISODate parses "30-Apr-26" downstream.)
eq('and the date still lands in the date field', OCR.parse(`SHREE MINERALS
GSTIN 08ABCFM1234N1ZP
Tax Invoice   Invoice No: 392/25-26   Dated: 30-Apr-26
Billed to Gotan Lime Industries
GSTIN 08AABCG1234H1Z5`, OWN).fields.date, '30-Apr-26');

console.log((fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail);
process.exit(fail ? 1 : 0);
