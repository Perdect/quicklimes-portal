/* bill-ocr.ackdate.test.js — a Tally e-invoice prints "Ack Date" (the e-invoice
   acknowledgement) ABOVE the real "Dated" value. pdf.js groups text runs by
   y-position, so the label and its value land on SEPARATE lines:

       Ack Date :          <- label alone (a line-based skip matches this)
       3-Jan-26            <- value alone (matches nothing -> sneaks through)
       Invoice No. Dated   <- label row, no value
       58 31-Dec-25        <- the REAL invoice date, no label on the line

   The parser used to fall back to "first date in the document" and pick the Ack
   Date, silently filing a 31-Dec-25 bill into January 2026 where it vanished
   from the December purchase register. The fixture below is the VERBATIM text
   pdf.js produces for the real bill. Run: node bill-ocr.ackdate.test.js */
const O = require("./bill-ocr.js");
let pass = 0, fail = 0; const fails = [];
const eq = (n, a, b) => { if (a === b) pass++; else { fail++; fails.push(n + " -> got " + JSON.stringify(a) + ", want " + JSON.stringify(b)); } };

const OWN = { ownGstins: ["08BNAPM0488E1Z3", "08NLIPS9801K1Z5"], selfGstin: "08BNAPM0488E1Z3", ownNames: ["GOTAN LIME INDUSTRIES", "DESHWALI MINERALS"] };
const REAL_PDFJS = `e-Invoice
Tax Invoice
IRN : f08137783e2d62fecaf9fb1d84914a6a20d5f08c6e0f3f4-
dcec307edcfccd482
Ack No. :
172619202564830
Ack Date :
3-Jan-26
Invoice No. Dated
Ramkaran and Sons
58 31-Dec-25
1349, ML NO 1382, 95, Near Borunda,
Delivery Note Mode/Terms of Payment
Jodhpur
GSTIN/UIN: 08AIUPB9022D1ZB
State Name : Rajasthan, Code : 08
Reference No. & Date. Other References
Consignee (Ship to)
Gotan Lime Industries
Buyer's Order No. Dated
Talanpur Road, Gothan, Reja Colony, SH 86B,
Chandra Tyre Retreading, Gothan, Nagaur
Dispatch Doc No. Delivery Note Date
GSTIN/UIN : 08BNAPM0488E1Z3
State Name : Rajasthan, Code : 08
Dispatched through Destination
Buyer (Bill to)
Gotan Lime Industries
Terms of Delivery
Talanpur Road, Gothan, Reja Colony, SH 86B,
Chandra Tyre Retreading, Gothan, Nagaur
GSTIN/UIN : 08BNAPM0488E1Z3
State Name : Rajasthan, Code : 08
Description of Goods HSN/SAC Quantity Rate per Amount
Sl
No.
1 252100 715.00 MT
Limestone 989.20 MT 7,07,278.00
Output CGST 2.50 % 17,681.95
Output SGST 2.50 % 17,681.95
Round Off 0.10
Total
989.20 MT
₹ 7,42,642.00
Amount Chargeable (in words) E. & O.E
INR Seven Lakh Forty Two Thousand Six Hundred Forty Two Only
HSN/SAC Taxable CGST SGST/UTGST Total
Value Rate Amount Rate Amount Tax Amount
252100 7,07,278.00 2.50% 17,681.95 2.50% 17,681.95 35,363.90
Total 7,07,278.00 17,681.95 17,681.95 35,363.90
Tax Amount (in words) :
INR Thirty Five Thousand Three Hundred Sixty Three and Ninety paise Only
Company's Bank Details
Bank Name : Central Bank of India
A/c No. : 2014775809
Branch & IFS Code: CBIN0280451
Declaration
for Ramkaran and Sons
We declare that this invoice shows the actual price of the
goods described and that all particulars are true and
correct.
Authorised Signatory
This is a Computer Generated Invoice
`;

let g = O.legacy(O.parse(REAL_PDFJS, OWN));
eq("real bill: invoice date, not Ack Date", g.date, "31-Dec-25");
eq("real bill: supplier", g.name, "Ramkaran and Sons");
eq("real bill: supplier GSTIN", g.gstin, "08AIUPB9022D1ZB");
eq("real bill: direction", g.dir, "purchase");

// The trap in isolation: dangling "Ack Date" label, value on the next line.
g = O.legacy(O.parse("Tax Invoice\nAck No. :\n172619202564830\nAck Date :\n3-Jan-26\nInvoice No. Dated\n58 31-Dec-25\nLimestone", OWN));
eq("dangling Ack Date skipped", g.date, "31-Dec-25");

// Ack Date on the SAME line as its value must still be skipped (old behaviour).
g = O.legacy(O.parse("Tax Invoice\nAck Date : 3-Jan-26\nDated : 31-Dec-25\nLimestone", OWN));
eq("inline Ack Date skipped", g.date, "31-Dec-25");

// Same-day e-invoice: blocking must be positional, never by value, or the real
// date would be blocked too.
g = O.legacy(O.parse("Tax Invoice\nAck Date :\n31-Dec-25\nInvoice No. Dated\n58 31-Dec-25\nLimestone", OWN));
eq("same-day ack does not kill the real date", g.date, "31-Dec-25");

// A Due Date must never win over the invoice date.
g = O.legacy(O.parse("Tax Invoice\nDated : 05-Nov-25\nDue Date :\n05-Dec-25\nLimestone", OWN));
eq("due date not taken", g.date, "05-Nov-25");

// No invoice-date label at all -> first real date still works.
g = O.legacy(O.parse("Tax Invoice\n12/06/2025\nLimestone", OWN));
eq("unlabelled date fallback", g.date, "12/06/2025");

console.log("\n==== e-invoice Ack Date trap ====\n  Passed: " + pass + "   Failed: " + fail);
fails.forEach(f => console.log("    x " + f));
console.log(fail === 0 ? "\nALL " + pass + " ACK-DATE TESTS PASSED\n" : "\n" + fail + " FAILED\n");
process.exit(fail === 0 ? 0 : 1);
