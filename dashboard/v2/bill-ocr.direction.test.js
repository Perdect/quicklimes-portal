/* bill-ocr.direction.test.js — direction must not flip to SALE when a supplier
   bill prints the RECIPIENT (Bill To) block ABOVE the seller block. This is the
   exact IOC petcoke-layout bug that dropped Dec-2025 purchases into Sales.
   Run: node bill-ocr.direction.test.js */
const O = require('./bill-ocr.js');
let pass = 0, fail = 0; const fails = [];
const eq = (n, a, b) => { if (a === b) pass++; else { fail++; fails.push(n + ' → got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); } };

const GOTAN = '08BNAPM0488E1Z3', IOC = '24AAACI1681G1ZV';
const OWN = { ownGstins: [GOTAN, '08NLIPS9801K1Z5'], selfGstin: GOTAN, ownNames: ['GOTAN LIME INDUSTRIES', 'DESHWALI MINERALS'] };

// IOC petcoke bill — recipient (Gotan) printed FIRST, seller (IOC) below.
const iocBuyerFirst = `Tax Invoice
Bill To Party
GOTAN LIME INDUSTRIES
GSTIN: ${GOTAN}
Sold By
INDIAN OIL CORPORATION LIMITED
GSTIN: ${IOC}
Invoice No 20263121B019906
Date 10-Dec-25
Petroleum Coke  32.76 MT`;
let r = O.parse(iocBuyerFirst, OWN);
eq('IOC buyer-block-first → purchase', O.legacy(r).dir, 'purchase');

// Genuine sale — Gotan issues at the top, customer in Bill To below.
const gotanSale = `Tax Invoice
GOTAN LIME INDUSTRIES
GSTIN ${GOTAN}
Bill To
AMAN LIME PRODUCTS
GSTIN 08ABCDE1234F1Z0
Invoice No 150/2025-26
Date 11-Dec-25
Hydrated Lime  20 MT`;
r = O.parse(gotanSale, OWN);
eq('Gotan issues → sale', O.legacy(r).dir, 'sales');

// Purchase where seller IS at the top (normal layout) still works.
const normalPurchase = `Tax Invoice
INDIAN OIL CORPORATION LIMITED
GSTIN ${IOC}
Bill To  GOTAN LIME INDUSTRIES  GSTIN ${GOTAN}
Invoice No 20263121B020885  Date 18-Dec-25`;
r = O.parse(normalPurchase, OWN);
eq('seller-first purchase still purchase', O.legacy(r).dir, 'purchase');

// REAL BUG (Gotan invoice 58/2026-27, GTL JULY.pdf): a copy marker + title are
// printed ABOVE the letterhead. The direction scan used to grab "Original Copy"
// as the letterhead, fail the own-name match, and file the sale as a purchase.
// Our GSTIN is on our own sales bill (as seller), so the buyerG branch is not
// evidence of a purchase. Must be SALES.
const gotanCopyMarker = `Original Copy
GST INVOICE
GOTAN LIME INDUSTRIES
TALANPUR ROAD ,SH 86B,, CHANDRA TYRE RETREADING
GOTAN, DISTRICT -NAGAUR
GSTIN : ${GOTAN}
Invoice No.  : 58/2026-27
Dated  : 02-07-2026
Billed to :
M/S DURGA FLY ASH BRICKS
GSTIN / UIN  : 21AFTPJ3586N1ZT
Quick Lime  25221000  42.10 Tonne  6,000.00  2,52,600.00
Grand Total  2,65,230.00`;
r = O.parse(gotanCopyMarker, OWN);
eq('sale with "Original Copy" atop letterhead → sale', O.legacy(r).dir, 'sales');
eq('  and the party is the CUSTOMER, not us', r.fields.supplierGstin, '21AFTPJ3586N1ZT');

console.log('\n════ direction (buyer-block-first) ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' DIRECTION TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
