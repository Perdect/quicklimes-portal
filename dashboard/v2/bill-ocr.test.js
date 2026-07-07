/* Automated tests for BillOCR — run: node dashboard/v2/bill-ocr.test.js
   Fixtures are realistic (messy) OCR text for real Indian GST purchase bills.
   The golden rule under test: a LABEL is never a VALUE, and unclear fields go
   to "needs review" (blank) rather than wrong data. */
const OCR = require('./bill-ocr.js');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else { fail++; console.log('  ✗ FAIL:', name, extra != null ? '· ' + JSON.stringify(extra) : ''); } }
function eq(name, a, b) { ok(name + ' (got ' + JSON.stringify(a) + ')', a === b); }
function near(name, a, b, t) { ok(name + ' (got ' + JSON.stringify(a) + ')', a != null && Math.abs(a - b) <= (t || 1)); }

const OWN = { ownGstins: ['08AABCG1234H1Z5', '08AADFD5678K1Z9'], ownNames: ['GOTAN LIME INDUSTRIES', 'DESHWALI MINERALS'] };
const p = (t, o) => OCR.parse(t, Object.assign({}, OWN, o || {}));

/* ═══ 1. THE REPORTED BUG — supplier must NOT be the label "GST Registration No" ═══ */
console.log('the reported bug: label-as-value');
const bug = `INDORAMA CEMENT LIMITED
Plot 42, GIDC Industrial Area, Bharuch, Gujarat
GST Registration No
24AAACI1681G1ZV
TAX INVOICE
Invoice No : 20273121B006913    Dated : 19-Jun-26
Billed To : Gotan Lime Industries
GSTIN : 08AABCG1234H1Z5
HSN 2523   Portland Cement
Taxable Value        84717.00
CGST 2.5 %           2117.93
SGST 2.5 %           2117.93
Grand Total          88952.86`;
let r = p(bug);
ok('supplier is NOT the label', r.fields.supplier !== 'GST Registration No' && r.fields.supplier !== 'GST Registration', r.fields.supplier);
eq('supplier is the real seller', r.fields.supplier, 'INDORAMA CEMENT LIMITED');
eq('supplier GSTIN = seller (not buyer)', r.fields.supplierGstin, '24AAACI1681G1ZV');
eq('buyer GSTIN = our own', r.fields.buyerGstin, '08AABCG1234H1Z5');
eq('bill no', r.fields.billNo, '20273121B006913');
near('taxable', r.fields.taxable, 84717, 1);
near('total', r.fields.total, 88952.86, 1);
eq('gst rate inferred 5%', r.fields.gstRate, 5);
ok('supplier NOT flagged review', r.review.indexOf('supplier') < 0, r.review);

/* ═══ 2. isLabel guard — direct unit coverage ═══ */
console.log('label guard');
['GST Registration No', 'GSTIN', 'Invoice No', 'Bill To', 'Taxable Value', 'HSN/SAC', 'Grand Total', 'Buyer', 'Consignee', 'Party Name', 'State Code', 'Description of Goods']
  .forEach(l => ok('"' + l + '" is a label', OCR.isLabel(l), l));
['ARIF CHEMICAL LIME', 'M/s Mateshwari Mines', 'Indorama Cement Limited', 'Ramkaran And Sons'].forEach(n => ok('"' + n + '" is NOT a label', !OCR.isLabel(n), n));

/* ═══ 3. CGST+SGST intra-state limestone bill ═══ */
console.log('limestone CGST+SGST');
r = p(`M/s Mateshwari Mines and Minerals
Village Gotan, Nagaur, Rajasthan  341027
GSTIN 08ABCFM1234N1ZP
Tax Invoice   Bill No: GJ5534   Date: 15/06/2026
To: Gotan Lime Industries  GSTIN 08AABCG1234H1Z5
Description: Limestone (Kankar)   HSN 2521
Quantity 250.00 MT
Taxable Value   847170.00
CGST @2.5%   21179.25
SGST @2.5%   21179.25
Round Off   0.50
Grand Total   889529.00`);
eq('limestone supplier', r.fields.supplier, 'Mateshwari Mines and Minerals');
eq('limestone group', r.fields.group, 'limestone');
eq('limestone item', r.fields.item, 'Limestone Purchase');
eq('gst rate 5', r.fields.gstRate, 5);
near('cgst', r.fields.cgst, 21179.25, 1);
eq('itc eligible', r.fields.itc, 'Eligible');
eq('hsn', r.fields.hsn, '2521');

/* ═══ 4. IGST inter-state petcoke bill ═══ */
console.log('petcoke IGST');
r = p(`Reliance Industries Limited
Jamnagar, Gujarat
GSTIN: 24AAACR5055K1Z7
TAX INVOICE  No RIL/2026/8842  Dt 02-Jun-2026
Bill To: Deshwali Minerals  GSTIN 08AADFD5678K1Z9
Pet Coke  HSN 2713
Taxable Amount  1000000.00
IGST 18%  180000.00
Invoice Value  1180000.00`);
eq('petcoke supplier', r.fields.supplier, 'Reliance Industries Limited');
eq('petcoke group', r.fields.group, 'petcoke');
eq('igst rate 18', r.fields.gstRate, 18);
near('igst', r.fields.igst, 180000, 1);
near('petcoke total', r.fields.total, 1180000, 1);

/* ═══ 5. No-GST / 0% bill ═══ */
console.log('no-GST bill');
r = p(`Krishna Traders
GSTIN 08AAACK1111A1Z0
Bill No 771  Date 10-Jun-26
To Gotan Lime Industries
Agricultural produce - exempt
Taxable Value 50000.00
Total 50000.00`);
eq('no-gst supplier', r.fields.supplier, 'Krishna Traders');
ok('no-gst rate 0 or blank', r.fields.gstRate === 0 || r.fields.gstRate == null, r.fields.gstRate);
near('no-gst total', r.fields.total, 50000, 1);

/* ═══ 6-9. category detection: plastic / royalty / transport / fuel / bank / labour / electricity ═══ */
console.log('category detection');
eq('plastic bags', OCR.detectGroup('Supply of HDPE Woven Sacks 50kg').group, 'packaging');
eq('royalty', OCR.detectGroup('District Mineral Foundation Royalty on limestone').group, 'royalty');
eq('transport', OCR.detectGroup('Goods Transport Agency freight charges').group, 'transport');
eq('fuel', OCR.detectGroup('High Speed Diesel HSD 2000 ltr').group, 'fuel');
eq('bank', OCR.detectGroup('Bank processing fee and commission').group, 'bank');
eq('labour', OCR.detectGroup('Loading and unloading labour charges').group, 'labour');
eq('electricity', OCR.detectGroup('JVVNL electricity power bill units consumed').group, 'electricity');
eq('unknown → blank group', OCR.detectGroup('Miscellaneous office supplies').group, '');

/* ═══ 10. Transport bill under RCM ═══ */
console.log('transport RCM');
r = p(`M/s Shree Transport Company
GSTIN 08AABCT9999Q1ZX
Consignment Note No TC/551  Date 20/06/2026
To Gotan Lime Industries
Goods Transport Agency - Freight for limestone
Freight 45000.00
Tax payable under RCM by recipient
Total 45000.00`);
eq('transport supplier', r.fields.supplier, 'Shree Transport Company');
eq('transport group', r.fields.group, 'transport');
eq('itc RCM', r.fields.itc, 'RCM');

/* ═══ 11. Blurry / missing-field bill → needs review, never fake ═══ */
console.log('blurry / missing fields → review');
r = p(`T@X 1NV0ICE
S0me Vend0r ???
G$TlN 08 A?BC ????
T0tal ...`);
ok('blurry: no fake supplier', r.fields.supplier == null || r.review.indexOf('supplier') >= 0, r.fields.supplier);
ok('blurry: no fake total', r.fields.total == null, r.fields.total);
ok('blurry: fields flagged for review', r.review.length >= 3, r.review);

/* ═══ 12. own-company must NEVER be picked as the supplier ═══ */
console.log('own-company exclusion');
r = p(`GOTAN LIME INDUSTRIES
GSTIN 08AABCG1234H1Z5
Tax Invoice No 900 Date 12-Jun-26
Sold By: Balaji Minerals
GSTIN 08AAECB2222R1Z3
Limestone  Taxable 100000.00  CGST 2500.00 SGST 2500.00 Total 105000.00`);
eq('supplier is the seller, not us', r.fields.supplier, 'Balaji Minerals');
ok('our own name not used as supplier', r.fields.supplier !== 'GOTAN LIME INDUSTRIES');

/* ═══ 13. GSTIN validation ═══ */
console.log('gstin validation');
ok('valid gstin', OCR.validGstin('24AAACI1681G1ZV'));
ok('bad state code rejected', !OCR.validGstin('99AAACI1681G1ZV'));
ok('malformed rejected', !OCR.validGstin('24AAACI1681G1Z'));

/* ═══ 14. duplicate key parity (supplier|billno) — used by the modal ═══ */
console.log('duplicate key');
const key = (s, b) => (String(s || '') + '|' + String(b || '')).toUpperCase();
ok('same supplier+bill → same key', key('Reliance', 'RIL/2026/8842') === key('reliance', 'ril/2026/8842'));
ok('different bill → different key', key('Reliance', 'A1') !== key('Reliance', 'A2'));

/* ═══ 15. amounts don't reconcile → warning, not silent wrong data ═══ */
console.log('reconciliation warning');
r = p(`ABC Traders  GSTIN 08AAACA1234A1Z0
Bill 12 Date 01-Jun-26  To Gotan Lime Industries
Taxable Value 100000.00  CGST 2500.00 SGST 2500.00
Grand Total 999999.00`);
ok('mismatch produces a warning', r.warnings.some(w => /reconcile/i.test(w)), r.warnings);

/* ═══ 16. REGRESSIONS found by the multi-agent adversarial QA ═══ */
console.log('adversarial-QA regressions');
// (a) date truncation: "Dated : 12/06/2025" must keep the day's leading digit
eq('date not truncated (spacing)', OCR.findDate('Invoice No : SBM/2526/0417   Dated : 12/06/2025'), '12/06/2025');
eq('date 18/02 not 8/02', OCR.findDate('Dated : 18/02/2025'), '18/02/2025');
eq('date named month', OCR.findDate('Date: 3-Aug-2026'), '3-Aug-2026');
// (b) false RCM: a bill that prints "Reverse Charge : No" is ITC-Eligible, not RCM
r = p(`SHRI BALAJI MINERALS PVT LTD
GSTIN 08AAECS4321F1ZP
Tax Invoice  Invoice No SBM/2526/0417  Dated : 12/06/2025
Billed To Gotan Lime Industries  GSTIN 08AABCG1234H1Z5
Limestone HSN 2521  Taxable Value 82200.00
CGST 2.5% 2055.00  SGST 2.5% 2055.00  Grand Total 86310.00
Reverse Charge : No`);
eq('reverse-charge-No → ITC Eligible', r.fields.itc, 'Eligible');
eq('date kept as 12/06/2025', r.fields.date, '12/06/2025');
// (c) transporter line must not hijack a pet-coke bill's group
r = p(`INDIAN OIL CORPORATION LIMITED
GSTIN 24AAACI1681G1ZM
Tax Invoice No GRF/PC/2026/004517 Dated 14-06-2026
Transporter : Gujarat Freight Carriers   Vehicle No GJ06AT4521
Billed To Gotan Lime Industries GSTIN 08AABCG1234H1Z5
Raw Petroleum Coke (Fuel Grade) HSN 27131100
Taxable Value 1134000.00  IGST 18% 204120.00  Grand Total 1338120.00
Reverse Charge : No`);
eq('petcoke not transport', r.fields.group, 'petcoke');
eq('petcoke itc eligible (RC No)', r.fields.itc, 'Eligible');
eq('petcoke date 14 not 4', r.fields.date, '14-06-2026');
// (d) long (51-char) supplier name must not be dropped by a length cap
r = p(`SHREE BALAJI LABOUR CONTRACTOR & MANPOWER SUPPLIERS
GSTIN 08AACFS9012K1Z6
Tax Invoice No SBL/LAB/0271 Dated 18/02/2025
Billed To Gotan Lime Industries GSTIN 08AABCG1234H1Z5
Loading & Unloading of Limestone SAC 998519
Taxable Value 85000.00 CGST 9% 7650.00 SGST 9% 7650.00 Grand Total 100300.00
Reverse Charge : No`);
eq('long supplier name kept', r.fields.supplier, 'SHREE BALAJI LABOUR CONTRACTOR & MANPOWER SUPPLIERS');
eq('labour group', r.fields.group, 'labour');
eq('labour itc eligible', r.fields.itc, 'Eligible');

/* ═══ 17. legacy adapter (bridge to the existing import form / ocrMap) ═══ */
console.log('legacy adapter');
const lg = OCR.legacy(p(bug));
eq('legacy name = supplier (not label)', lg.name, 'INDORAMA CEMENT LIMITED');
eq('legacy docno = billNo', lg.docno, '20273121B006913');
eq('legacy gstin = supplier gstin', lg.gstin, '24AAACI1681G1ZV');
eq('legacy rate = gstRate', String(lg.rate), '5');
ok('legacy blanks review fields (never fake)', (() => { const l = OCR.legacy(p('T@X 1NV0ICE garbled ????')); return l.name === '' && l.total === ''; })());

/* ═══ 18. built-in self-test corpus (powers the "Run Import Test Suite" button) ═══ */
console.log('self-test corpus');
const st = OCR.selfTest();
ok('self-test: every sample bill passes', st.passed === st.total, st.cases.filter(c => !c.pass).map(c => c.name));
ok('self-test: 0 supplier-as-label errors', st.labelErrors === 0);
ok('self-test: 0 fabricated-data errors', st.fakeErrors === 0);
ok('self-test: field accuracy >= 95%', st.fieldAccuracy >= 95, st.fieldAccuracy);
ok('self-test: duplicate detection works', st.duplicateAccuracy === 100);

console.log('\n' + (fail === 0 ? '✅ ALL ' + pass + ' TESTS PASSED' : '❌ ' + fail + ' FAILED, ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
