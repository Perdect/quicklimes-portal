/* refund-ocr.test.js — real GST RFD-01 receipt fixture (Gotan Lime Industries,
   Petcoke inverted-duty refund, Jul–Sep 2025). Run: node refund-ocr.test.js */
const O = require('./refund-ocr.js');
let pass = 0, fail = 0; const fails = [];
const eq = (n, a, b) => { if (a === b) pass++; else { fail++; fails.push(n + ' → got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); } };

const RFD01 = `Refund ARN Receipt
This is an application receipt for Refund application GST RFD-01 filed by you at the common portal:
Application Reference Number (ARN):          AA081225056452C
Date of Application:                         13/12/2025
Time of Filing of Application:               08:07 PM
GSTIN/ UIN/ Temporary ID:                    08BNAPM0488E1Z3
Trade Name :                                 GOTAN LIME INDUSTRIES
Legal Name:                                  AJIJ MOHAMMED
Reason of Refund:                            ITC accumulated due to Inverted Tax Structure [clause (ii) of first proviso to section 54(3)]
From Period:                                 JULY 2025
To Period:                                   SEPTEMBER 2025
Head
Tax(ITC)
Amount of Refund Claimed (In INR)
Integrated Tax
434345
Central Tax
50412
State/UT Tax
50412
CESS
0
Total
535169`;

const r = O.parseRFD(RFD01);
eq('ARN', r.arn, 'AA081225056452C');
eq('GSTIN', r.gstin, '08BNAPM0488E1Z3');
eq('trade name', r.tradeName, 'GOTAN LIME INDUSTRIES');
eq('from period', r.fromPeriod, 'JULY 2025');
eq('to period', r.toPeriod, 'SEPTEMBER 2025');
eq('app date', r.appDate, '13/12/2025');
eq('IGST', r.igst, 434345);
eq('CGST', r.cgst, 50412);
eq('SGST', r.sgst, 50412);
eq('CESS', r.cess, 0);
eq('total (sum of heads)', r.total, 535169);
eq('kind', r.kind, 'RFD-01');
eq('no review flags', r.review.length, 0);

// same amounts on one line (some portal exports render the head + value inline)
const inline = O.parseRFD('ARN : AA081225056452C\nIntegrated Tax 434345\nCentral Tax 50412\nState/UT Tax 50412\nCESS 0');
eq('inline layout total', inline.total, 535169);
eq('inline ARN', inline.arn, 'AA081225056452C');

console.log('\n════ GST RFD-01 parser ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' RFD-01 TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
