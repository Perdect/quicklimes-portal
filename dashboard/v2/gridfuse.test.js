/* gridfuse.test.js — when pdf.js welds two columns into one line.

   THE REPORTED BUG (2026-07-15, real file "29 May Bags.pdf", Pooja Enterprises):
   the Review-bill modal showed Supplier EMPTY and flagged "1 need a look", while
   the GSTIN directly beneath it read at 97%. Uploading the same bill also filed
   the bill number as 342006 — Jodhpur's PIN CODE — at 75% confidence. Wrong
   confidently, which is worse than blank.

   THE TEXT THE APP ACTUALLY GETS (captured from QLFin.pdfPages in the browser,
   NOT from pdftotext — the two disagree, and testing the wrong one is how the
   last parser bug survived a green suite):

     TAX INVOICE                                   <- line 0 is the TITLE
     e-Invoice
     IRN : 789ca3...
     Ack No. : 172517595673499
     Ack Date : 31 MAY 25
     Pooja Enterprises Invoice No. Dated           <- letterhead FUSED with the grid
     Plot No 87, Laxmi Nagar, Paota C Road, 165 29 May 25
     Jodhpur, Rajasthan, 342006

   A Tally/e-invoice header is two columns printed side by side — the seller's
   letterhead left, the "Invoice No. | Dated" grid right. pdf.js reads ACROSS
   them, so the name arrives welded to a label.

   THREE ROOT CAUSES, all of them silent:
     1. the header scan BROKE on /tax invoice/ — which is LINE 0 of almost every
        e-invoice, so it stopped before it ever started;
     2. goodName() ACCEPTS the fused line whole, so the cut must be tried FIRST
        or the supplier is saved as "Pooja Enterprises Invoice No. Dated";
     3. the bill-number picker scores candidates by COLUMN DISTANCE, which
        assumes column-aligned text. pdf.js gives none, so it landed on the PIN
        code (distance 2) over the real number 165 (distance 20).

   Run: node gridfuse.test.js */

const OCR = require('./bill-ocr.js');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), a === b);

const OURS = '08BNAPM0488E1Z3', POOJA = '08BOLPB2694P1ZA';
const GOTAN = { ownGstins: [OURS], ownNames: ['GOTAN LIME INDUSTRIES'], selfGstin: OURS };

/* VERBATIM pdf.js output for the real bill. */
const BAGS = [
  'TAX INVOICE', 'e-Invoice',
  'IRN : 789ca3c509abaebea28830dcb756ef7d1d0d44cc82b839bddb28a60e9922e6ba',
  'Ack No. : 172517595673499', 'Ack Date : 31 MAY 25',
  'Pooja Enterprises Invoice No. Dated',
  'Plot No 87, Laxmi Nagar, Paota C Road, 165 29 May 25',
  'Jodhpur, Rajasthan, 342006',
  'Delivery Note Mode/Terms of Payment',
  'Phone no. : 08875599000', 'Pin code : 342006',
  'Reference No. Other Reference(s)',
  'GSTIN/UIN : ' + POOJA,
  'Consignee (Ship to) Buyer’s Order No. Dated',
  'GOTAN LIME INDUSTRIES, KAKA JI', 'BORUNDA], 9610099006, Rajasthan',
  'Pin code : 342604', 'GSTIN/UIN : ' + OURS, 'State Name: Rajasthan, Code: 08',
  'Buyer (Bill to)', 'GOTAN LIME INDUSTRIES, KAKA JI', 'BORUNDA], 9610099006, Rajasthan',
  'Pin code : 342604', 'GSTIN/UIN : ' + OURS,
  'PLASTIC BAG MIX REPOL 392310 18% 10,000 BAG 9.7 BAG 97,000',
  'Plastic Repol 2nd 391590 18% 1,000 PIECES 7 PIECES 7,000',
  '1,04,000', 'CGST 9% 9,360', 'SGST 9% 9,360', 'Total 1,22,720'
].join('\n');

const g = OCR.legacy(OCR.parse(BAGS, GOTAN));

/* ── 1. THE REPORTED BUG: the supplier is on the page, so read it ── */
eq('the supplier is read off a letterhead fused with the label column', g.name, 'Pooja Enterprises');
ok('...and the label is not welded to the name', !/invoice|dated|no\./i.test(g.name));
ok('...it is never left blank when the name is right there', !!g.name);

/* ── 2. THE SILENT ONE: the bill number is the invoice number, not a PIN ── */
eq('the bill number is the invoice number', g.docno, '165');
ok('...never Jodhpur\'s PIN code, which sat nearer the label column', g.docno !== '342006');
ok('...and never the buyer\'s PIN either', g.docno !== '342604');

/* ── 3. the rest of the bill still reads correctly ── */
eq('direction: we are the buyer -> purchase', g.dir, 'purchase');
eq('supplier GSTIN', g.gstin, POOJA);
eq('our GSTIN is the buyer', g.buyergstin, OURS);
eq('taxable', g.taxable, 104000);
eq('total', g.total, 122720);
eq('date', g.date, '29 May 25');
eq('group auto-mapped from the item', g.group, 'packaging');

/* ── 4. A TITLE ON LINE 0 MUST NOT END THE SEARCH ──
   The old code broke the header scan on /tax invoice/, and "TAX INVOICE" is
   line 0 of nearly every e-invoice. */
const titled = OCR.legacy(OCR.parse(['TAX INVOICE', 'e-Invoice', 'Mateshwari Mines and Minerals',
  'GSTIN 08ABWFM4111F1Z6', 'Bill No: 222/26-27 Date: 29-06-2026',
  'To: GOTAN LIME INDUSTRIES GSTIN ' + OURS, 'Limestone HSN 2521',
  'Taxable Value 100000.00', 'CGST 2.5% 2500.00', 'SGST 2.5% 2500.00', 'Grand Total 105000.00'].join('\n'), GOTAN));
eq('a letterhead BELOW a "TAX INVOICE" title is still found', titled.name, 'Mateshwari Mines and Minerals');
eq('...and its bill number is read', titled.docno, '222/26-27');

/* ── 5. THE GUARD THAT MUST SURVIVE: our own bill is never read as a purchase ──
   Skipping the title (instead of stopping at it) removed the accident that kept
   the header scan out of the block BELOW the title. On our own sales bill the
   party IS the customer — that is correct and is what the register needs — but
   the DIRECTION must still be a sale, and our own name must never be the party.
   Get this wrong and our sales land in the purchase register (a bug this app has
   already shipped once). */
const ourSale = OCR.legacy(OCR.parse(['GOTAN LIME INDUSTRIES', 'TALANPUR ROAD, SH 86B, GOTAN', 'GSTIN ' + OURS,
  'TAX INVOICE', 'Invoice No : 165/2025-26 Dated : 31-12-2025',
  'Billed To : SHREE CEMENT LIMITED', 'GSTIN 08AABCS5768D1Z1',
  'Quick Lime HSN 25221000', 'Taxable Value 379560.00', 'CGST 2.5% 9489.00', 'SGST 2.5% 9489.00', 'Grand Total 398538.00'].join('\n'), GOTAN));
eq('our own sales bill is still a SALE', ourSale.dir, 'sales');
eq('...and its party is the customer, not us', ourSale.gstin, '08AABCS5768D1Z1');
ok('...our own firm is never the party on our own bill', !/gotan/i.test(ourSale.name || ''));
// On a PURCHASE, the buyer (us) must never be read as the supplier.
ok('on a purchase bill the buyer is never the supplier', !/gotan/i.test(g.name || ''));

/* ── 6. the cut must not invent or truncate ──
   NB: these fixtures carry their OWN GSTINs. Reusing a real party's GSTIN makes
   the party master (GSTIN -> official name) override the letterhead — correctly
   — and the test then measures the wrong thing. */
const plain = OCR.legacy(OCR.parse(['Nagour Golden Transport Company', 'GSTIN 08NGTPT7777N1Z4',
  'Bill No: 55/26-27 Date: 15-01-2026', 'To: GOTAN LIME INDUSTRIES GSTIN ' + OURS,
  'Freight charges', 'Taxable Value 55233.00', 'CGST 2.5% 1380.83', 'SGST 2.5% 1380.83', 'Grand Total 57994.66'].join('\n'), GOTAN));
eq('a clean letterhead with no grid label is untouched', plain.name, 'Nagour Golden Transport Company');
// and a name that merely CONTAINS a cut-word inside a word is not chopped at it
const dated = OCR.legacy(OCR.parse(['Updated Minerals Private Limited', 'GSTIN 08AAAAA1111A1Z5',
  'Bill No: 9/26-27 Date: 15-01-2026', 'To: GOTAN LIME INDUSTRIES GSTIN ' + OURS,
  'Limestone', 'Taxable Value 1000.00', 'CGST 2.5% 25.00', 'SGST 2.5% 25.00', 'Grand Total 1050.00'].join('\n'), GOTAN));
ok('a firm whose name contains "dated" inside a word is not truncated', /Updated Minerals/i.test(dated.name || ''));

/* ── 6b. THE GUARD THAT MUST NOT COME BACK ──
   Skipping the title (rather than stopping at it) looks like it should let the
   scan run into "Bill To: …" and read the customer as the supplier, so I added a
   stop-at-the-buyer-block rule. Probing proved it BACKWARDS: goodName() already
   rejects a "Bill To:" line, so the scan walks past it to the real letterhead —
   while breaking there handed the job to a looser later step that returned the
   BUYER. The guard caused the exact bug it was meant to prevent.
   This is that layout. Re-add the guard and this goes red. */
const buyerFirst = OCR.legacy(OCR.parse(['TAX INVOICE',
  'Bill To: Acme Trading Company', 'GSTIN 27AAACA1111A1Z5', 'Mumbai, Maharashtra',
  'Pooja Enterprises', 'GSTIN ' + POOJA,
  'Bill No: 165 Date: 29-05-2025', 'Plastic Bags',
  'Taxable Value 104000.00', 'CGST 9% 9360.00', 'SGST 9% 9360.00', 'Grand Total 122720.00'].join('\n'), GOTAN));
eq('buyer block printed ABOVE the letterhead: the seller still wins', buyerFirst.name, 'Pooja Enterprises');
ok('...the buyer is never the supplier', !/acme/i.test(buyerFirst.name || ''));

/* ── 7. the party master still outranks the letterhead ──
   A known GSTIN is OCR-independent and must win over whatever the scanner read
   off the page. This is the spec's "if GSTIN exists, search party master,
   auto-link supplier" — and it already works; it only needs the party on file. */
const known = OCR.legacy(OCR.parse(['Some Misread Lettrhead Ltd', 'GSTIN 08ABWFM4111F1Z6',
  'Bill No: 77/26-27 Date: 15-01-2026', 'To: GOTAN LIME INDUSTRIES GSTIN ' + OURS,
  'Limestone', 'Taxable Value 1000.00', 'CGST 2.5% 25.00', 'SGST 2.5% 25.00', 'Grand Total 1050.00'].join('\n'), GOTAN));
eq('a GSTIN in the party master names the supplier, whatever the page says', known.name, 'Mateshwari Mines and Minerals');

console.log('\n════ pdf.js column fuse: supplier + bill number ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' GRID-FUSE TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
