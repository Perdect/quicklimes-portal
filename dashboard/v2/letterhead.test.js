/* letterhead.test.js — whose bill is this?

   THE REPORTED BUG (2026-07-15, real file 7002052400.pdf, reported 4 times):
   The user uploaded an Indian Oil petcoke PURCHASE on the Purchase register and
   the app filed it as their SALE and moved it to the sales register.

   ROOT CAUSE — found only by running the REAL PDF through a REAL browser:
   the bill prints seller and buyer SIDE BY SIDE, and pdf.js reads ACROSS the
   columns, so the extracted text interleaves the two parties:

     "...ASRA NO 1787/7 GOTAN ROAD BARODA   JODHPUR 342604   391320
        RAJASTHAN(08) GUJARAT(24)   C.E.RANGE C.E.DIVISION
        GSTIN 08BNAPM0488E1Z3   GST REGISTRATION NO. GSTIN 24AAACI1681G1ZV"

   OUR GSTIN comes out FIRST. The parser's rule was "the first GSTIN is the
   issuer", so it decided WE issued an Indian Oil invoice.

   Why every earlier test missed it: `pdftotext -layout` re-sorts by position and
   puts IOC first, so the offline parser looked correct in Node. The app never
   sees that text. Testing the wrong input is the same mistake as testing the
   wrong code path.

   THE RULE: the LETTERHEAD decides. The issuer's name is printed at the top —
   line 2 of that PDF is "Indian Oil Corporation Limited" — and it survives
   column interleaving. GSTIN ORDER IS NOT EVIDENCE: a layout decides it, not
   the parties. The position heuristic is a last resort, only when the letterhead
   cannot be read.

   Run: node letterhead.test.js */

const OCR = require('./bill-ocr.js');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), a === b);

const OURS = '08BNAPM0488E1Z3', IOC = '24AAACI1681G1ZV', CUST = '08AABCS5768D1Z1';
const GOTAN = { ownGstins: [OURS], ownNames: ['GOTAN LIME INDUSTRIES'], selfGstin: OURS };

/* VERBATIM pdf.js output shape from the real file — our GSTIN FIRST, because
   the columns interleave. This is what the app actually receives. */
const IOC_PURCHASE = [
  'INVOICE UNDER RULE 46 of GST Rules',
  'Indian Oil Corporation Limited',
  'We hereby certify that the goods covered by this document',
  'have suffered applicable Taxes on clearance',
  'Doc.Name', 'IRN :',
  'TAX INVOICE 20263121B024217',
  'Form No SAP Doc no. 7002052400',
  'ASRA NO 1787/7 GOTAN ROAD BARODA JODHPUR 342604 391320 RAJASTHAN(08) GUJARAT(24) C.E.RANGE C.E.DIVISION GSTIN ' + OURS + ' GST REGISTRATION NO. GSTIN ' + IOC + ' PAN AAACI1681G BNAPM0488E',
  'Pet Coke HSN 2713',
  'Taxable Amount 402226.20',
  'IGST 18% 72400.72',
  'Invoice Value 474627.00',
  'Dated : 15-Jan-2026',
].join('\n');

/* ── 1. THE REPORTED BUG ── */
const r = OCR.parse(IOC_PURCHASE, GOTAN);
const g = OCR.legacy(r);
eq('an IOC petcoke bill is a PURCHASE, even though OUR gstin is printed first', g.dir, 'purchase');
eq('the supplier is Indian Oil, not us', g.name, 'Indian Oil Corporation Limited');
eq('the party gstin is IOC', g.gstin, IOC);
eq('our gstin is recognised as the BUYER', g.buyergstin, OURS);
ok('the letterhead beats GSTIN order — this is the whole fix',
  IOC_PURCHASE.indexOf(OURS) < IOC_PURCHASE.indexOf(IOC) && g.dir === 'purchase');

/* ── 2. our OWN sales bill must still be a sale ── */
const OUR_SALES = [
  'GOTAN LIME INDUSTRIES',
  'TALANPUR ROAD, SH 86B, GOTAN, DISTRICT - NAGAUR',
  'GSTIN ' + OURS,
  'TAX INVOICE',
  'Invoice No : 165/2025-26   Dated : 31-12-2025',
  'Billed To : SHREE CEMENT LIMITED',
  'GSTIN ' + CUST,
  'Quick Lime HSN 25221000',
  'Taxable Value 379560.00', 'CGST 2.5% 9489.00', 'SGST 2.5% 9489.00', 'Grand Total 398538.00',
].join('\n');
const s = OCR.legacy(OCR.parse(OUR_SALES, GOTAN));
eq('our own letterhead -> SALE', s.dir, 'sales');
eq('the party is the customer', s.gstin, CUST);
ok('our gstin is never the party on our own bill', s.gstin !== OURS);

/* ── 3. the same IOC bill seen by a DIFFERENT firm (not a party to it) ── */
const mtc = OCR.legacy(OCR.parse(IOC_PURCHASE, { ownGstins: ['08MTCLM1234A1Z5'], ownNames: ['MTC LIME'], selfGstin: '08MTCLM1234A1Z5' }));
eq('a firm that is on neither side still reads it as a purchase', mtc.dir, 'purchase');

/* ── 4. the letterhead must not be fooled by a document title ── */
ok('"INVOICE UNDER RULE 46 of GST Rules" is not mistaken for the issuer',
  g.name !== 'INVOICE UNDER RULE 46 of GST Rules');
// A bill whose first line IS the seller (the common case) still works.
const plain = OCR.legacy(OCR.parse([
  'Mateshwari Mines and Minerals', 'GSTIN 08ABWFM4111F1Z6', 'TAX INVOICE',
  'Bill No: 222/26-27  Date: 29-06-2026', 'To: GOTAN LIME INDUSTRIES  GSTIN ' + OURS,
  'Limestone HSN 2521', 'Taxable Value 1160333.10', 'CGST 2.5% 29008.33', 'SGST 2.5% 29008.33', 'Grand Total 1218350.00',
].join('\n'), GOTAN));
eq('a normal supplier-letterhead bill is still a purchase', plain.dir, 'purchase');
eq('...with the right supplier', plain.name, 'Mateshwari Mines and Minerals');

/* ── 5. no identity: still refuses to guess (the earlier fix must survive) ── */
const noId = OCR.parse(IOC_PURCHASE, { ownGstins: [], ownNames: [] });
ok('with no GSTIN on file it still will not claim a direction',
  noId.fields.direction !== 'sales' && noId.fields.direction !== 'purchase');

/* ── 6. the letterhead is only a signal when it is READABLE ── */
const noHead = OCR.legacy(OCR.parse([
  '', 'GSTIN ' + IOC, 'TAX INVOICE 123', 'Billed To GSTIN ' + OURS,
  'Pet Coke', 'Taxable Amount 1000', 'Invoice Value 1180', 'Dated : 15-Jan-2026',
].join('\n'), GOTAN));
eq('with no letterhead, the buyer-context/issuer fallback still resolves it', noHead.dir, 'purchase');

console.log('\n════ letterhead vs GSTIN order ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' LETTERHEAD TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
