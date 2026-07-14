/* refund-ocr.test.js — REAL GST RFD-01 receipt (Gotan Lime Industries, Petcoke
   inverted-duty refund, Jul-Sep 2025, ARN AA081225056452C).

   Both fixtures below are the VERBATIM text of the same PDF as produced by two
   different extractors. The portal free-floats the refund table, so the head
   labels interleave away from their amounts and the run order differs:
   reading "the number after each label" gives SGST=0 / CESS=50412 on the pdf.js
   order. The parser must return identical, correct values for both.
   Run: node refund-ocr.test.js */
const O = require("./refund-ocr.js");
let pass = 0, fail = 0; const fails = [];
const eq = (n, a, b) => { if (a === b) pass++; else { fail++; fails.push(n + " -> got " + JSON.stringify(a) + ", want " + JSON.stringify(b)); } };

const PDFJS_ORDER = `Refund ARN Receipt
This is an application receipt for Refund application GST RFD-01 filed by you at the common
portal:
AA081225056452C

Date of Application:

13/12/2025

Time of Filing of Application:

08:07 PM

GSTIN/ UIN/ Temporary ID:

08BNAPM0488E1Z3

Trade Name :

GOTAN LIME INDUSTRIES

Legal Name:

AJIJ MOHAMMED

Reason of Refund:

ITC accumulated due to Inverted Tax Structure [clause
(ii) of first proviso to section 54(3)]

Center Jurisdiction:

-

State Jurisdiction:

-

From Period:

JULY 2025

To Period:

SEPTEMBER 2025

A

Application Reference Number (ARN):

Amount of Refund Claimed (In INR)
Head
Tax(ITC)

Integrated Tax

434345

Central Tax

50412

State/UT Tax

CESS

50412

Total

0

535169

IN

Note: It is a system generated application receipt and does not require any signature. The
Acknowledgement (RFD- 02) shall be issued after verification of the completeness of the application by the
Refund Processing Officer.

`;
const LAYOUT_ORDER = `                                   Refund ARN Receipt
This is an application receipt for Refund application GST RFD-01 filed by you at the common
portal:

 Application Reference Number (ARN):          AA081225056452C
 Date of Application:                         13/12/2025
 Time of Filing of Application:               08:07 PM
 GSTIN/ UIN/ Temporary ID:                    08BNAPM0488E1Z3
 Trade Name :                                 GOTAN LIME INDUSTRIES
 Legal Name:                                  AJIJ MOHAMMED
 Reason of Refund:                            ITC accumulated due to Inverted Tax Structure [clause
                                              (ii) of first proviso to section 54(3)]
 Center Jurisdiction:                         -
 State Jurisdiction:                          -
 From Period:                                 JULY 2025
 To Period:                                   SEPTEMBER 2025




 Head
 Tax(ITC)

                                  A
                              Amount of Refund Claimed (In INR)
                 Integrated Tax
                           434345
                                      Central Tax
                                             50412
                                                      State/UT Tax
                                                                  50412
                                                                           CESS
                                                                                      0


Note: It is a system generated application receipt and does not require any signature. The
                                                                                          Total
                                                                                             535169



Acknowledgement (RFD- 02) shall be issued after verification of the completeness of the application by the
Refund Processing Officer.




IN
`;

const EXPECT = {
  arn: "AA081225056452C", gstin: "08BNAPM0488E1Z3",
  tradeName: "GOTAN LIME INDUSTRIES", legalName: "AJIJ MOHAMMED",
  appDate: "13/12/2025", fromPeriod: "JULY 2025", toPeriod: "SEPTEMBER 2025",
  igst: 434345, cgst: 50412, sgst: 50412, cess: 0, total: 535169,
  kind: "RFD-01", inverted: true, balanced: true
};

[["pdf.js order", PDFJS_ORDER], ["pdftotext -layout order", LAYOUT_ORDER]].forEach(([name, txt]) => {
  const r = O.parseRFD(txt);
  Object.keys(EXPECT).forEach(k => eq(name + " / " + k, r[k], EXPECT[k]));
  eq(name + " / heads sum to total", r.igst + r.cgst + r.sgst + r.cess, r.total);
  eq(name + " / no review flags", r.review.length, 0);
  eq(name + " / full reason kept", /inverted tax structure/i.test(r.reason) && /54\(3\)/.test(r.reason), true);
});

// The exact interleaving that used to break it, in isolation.
const interleaved = "Amount of Refund Claimed (In INR)\nIntegrated Tax\n434345\nCentral Tax\n50412\nState/UT Tax\nCESS\n50412\nTotal\n0\n535169";
let r = O.parseRFD(interleaved);
eq("interleaved SGST not stolen by CESS label", r.sgst, 50412);
eq("interleaved CESS is 0", r.cess, 0);
eq("interleaved total", r.total, 535169);

// Tidy layout (value directly after each label) must still work.
r = O.parseRFD("Integrated Tax 100\nCentral Tax 20\nState/UT Tax 20\nCESS 0\nTotal 140");
eq("tidy layout total", r.total, 140);
eq("tidy layout sgst", r.sgst, 20);

// IGST-only refund.
r = O.parseRFD("Amount of Refund Claimed\nIntegrated Tax\n5000\nCentral Tax\n0\nState/UT Tax\n0\nCESS\n0\nTotal\n5000");
eq("IGST-only total", r.total, 5000);
eq("IGST-only igst", r.igst, 5000);

// Unbalanced numbers must be flagged, never silently wrong.
r = O.parseRFD("Amount of Refund Claimed\nIntegrated Tax\n100\nCentral Tax\n20\nState/UT Tax\n20\nCESS\n0\nTotal\n999");
eq("unbalanced printed total flagged", r.review.indexOf("total") >= 0, true);
eq("unbalanced still uses head sum", r.total, 140);

console.log("\n==== GST RFD-01 parser (real file) ====\n  Passed: " + pass + "   Failed: " + fail);
fails.forEach(f => console.log("    x " + f));
console.log(fail === 0 ? "\nALL " + pass + " RFD-01 TESTS PASSED\n" : "\n" + fail + " FAILED\n");
process.exit(fail === 0 ? 0 : 1);
