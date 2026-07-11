/* Guards the "first pages OK, later pages Unknown" regression. Proves the parser
   is STATELESS across calls (no regex/lastIndex/object leak) and that a
   counterparty resolves from its own block even when many bills are parsed in
   sequence — exactly the multi-page-PDF import path. Run: node dashboard/v2/bill-ocr.multipage.test.js */
const O = require('./bill-ocr.js');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗', n, x != null ? '· ' + JSON.stringify(x) : ''); } };

const own = { ownGstins: ['08BNAPM0488E1Z3'], ownNames: ['GOTAN LIME INDUSTRIES'], partyMaster: {} };
// Gotan SALES invoices (own = seller) to DIFFERENT customers — one "page" each.
function inv(no, cust, cgstin, tot) {
  return 'GOTAN LIME INDUSTRIES\nMerta Road, Gotan\nGSTIN 08BNAPM0488E1Z3\nTAX INVOICE\nInvoice No ' + no +
    ' Dated 15-Jun-2026\nBuyer (Bill to)\n' + cust + '\nGSTIN ' + cgstin + '\nConsignee (Ship to)\n' + cust +
    '\nGSTIN ' + cgstin + '\nHydrated Lime HSN 2522\nTaxable Value ' + tot + ' CGST 2.5% ' + (tot * 0.025) +
    ' SGST 2.5% ' + (tot * 0.025) + ' Grand Total ' + (tot * 1.05);
}
const pages = [
  ['39/2026-27', 'ARIF CHEMICAL LIME', '08ALAPD1927C1ZR', 172200],
  ['40/2026-27', 'ARIF CHEMICAL LIME', '08ALAPD1927C1ZR', 224659],
  ['41/2026-27', 'ARIF CHEMICAL LIME', '08ALAPD1927C1ZR', 224930],
  ['42/2026-27', 'QUALITY CHEMICAL AND ALLIED PRODUCT', '08AAACK1111A1Z0', 190850],
  ['43/2026-27', 'AMAN ENTERPRISES', '24AABCI2929N1ZK', 129480],
  ['44/2026-27', 'BHERU LIME UDYOG', '08AAAFB2222C1Z5', 84420],
  ['45/2026-27', 'SHREE RAM TRADERS', '08AAACS3333D1Z6', 190960],
  ['46/2026-27', 'MAHADEV MINERALS', '08AAKFM4455H1Z2', 150500]
].map(a => ({ meta: a, text: inv.apply(null, a) }));

console.log('multi-page: every page resolves ITS OWN counterparty (no page becomes Unknown)');
pages.forEach(function (p, i) {
  var f = O.parse(p.text, own).fields;
  var want = p.meta[1].replace(/[^A-Z ]/gi, '').trim();
  var got = String(f.supplier || '').replace(/[^A-Z ]/gi, '').trim();
  ok('page ' + (i + 1) + ' → "' + p.meta[1] + '"', got.indexOf(want.split(' ')[0]) >= 0 && f.supplierGstin === p.meta[2], { got: f.supplier, gstin: f.supplierGstin });
});

console.log('stateless: interleaving order does not change any result');
// parse in a shuffled/repeated sequence; each must match its standalone result
var baseline = pages.map(p => JSON.stringify(O.parse(p.text, own).fields));
var seq = [0, 4, 1, 7, 2, 5, 3, 6, 0, 4, 3, 7, 1, 2, 6, 5];
seq.forEach(function (idx) {
  var now = JSON.stringify(O.parse(pages[idx].text, own).fields);
  ok('page ' + (idx + 1) + ' identical regardless of call order', now === baseline[idx]);
});

console.log('stateless: re-parsing the SAME text twice is byte-identical');
for (var r = 0; r < pages.length; r++) ok('page ' + (r + 1) + ' deterministic', JSON.stringify(O.parse(pages[r].text, own).fields) === JSON.stringify(O.parse(pages[r].text, own).fields));

console.log('inter-firm: counterparty is the OWN sister firm (Gotan → Deshwali), not Unknown');
var own2 = { ownGstins: ['08BNAPM0488E1Z3', '08NLIPS9801K1Z5'], ownNames: ['GOTAN LIME INDUSTRIES', 'DESHWALI MINERALS'], selfGstin: '08BNAPM0488E1Z3', partyMaster: { '08NLIPS9801K1Z5': 'Deshwali Minerals', '08BNAPM0488E1Z3': 'Gotan Lime Industries' } };
// Gotan's GST invoice to its own sister firm — BOTH GSTINs are own; the printed
// name may even be absent. Must resolve to Deshwali, never "Unknown/no GSTIN".
var interFirm = 'GOTAN LIME INDUSTRIES\nGSTIN : 08BNAPM0488E1Z3\nGST INVOICE\nInvoice No. : 42/2026-27\nGSTIN / UIN : 08NLIPS9801K1Z5\nGSTIN / UIN : 08NLIPS9801K1Z5\nHydrated Lime HSN 2522\nTaxable Value 190850 CGST 2.5% 4771.25 SGST 2.5% 4771.25 Grand Total 200392.50';
var iff = O.parse(interFirm, own2).fields;
ok('inter-firm resolves to Deshwali Minerals', /deshwali/i.test(iff.supplier || ''), { supplier: iff.supplier, gstin: iff.supplierGstin });
ok('inter-firm keeps the counterparty GSTIN', iff.supplierGstin === '08NLIPS9801K1Z5', iff.supplierGstin);

console.log('doubled-name collapse (Bill-To | Ship-To merged on one line)');
var dbl = 'ARIF CHEMICAL LIME ARIF CHEMICAL LIME\nGSTIN 08ALAPD1927C1ZR\nTAX INVOICE\nInvoice No 39/2026-27 Dated 15-Jun-2026\nGOTAN LIME INDUSTRIES GSTIN 08BNAPM0488E1Z3\nLimestone HSN 2521\nTaxable Value 172200 CGST 2.5% 4305 SGST 2.5% 4305 Grand Total 180810';
var df = O.parse(dbl, own).fields;
ok('doubled name collapses to single', df.supplier === 'ARIF CHEMICAL LIME', df.supplier);

console.log('direction: issuer decides sale vs purchase');
ok('own firm issues → SALE', O.legacy(O.parse(interFirm, own2)).dir === 'sales');
ok('external issuer → PURCHASE', O.legacy(O.parse('INDIAN OIL CORPORATION LIMITED\nGSTIN 24AAACI1681G1ZV\nTAX INVOICE X1\nGOTAN LIME INDUSTRIES GSTIN 08BNAPM0488E1Z3\nPetcoke Taxable 100000 IGST 18% 18000 Total 118000', own2)).dir === 'purchase');

console.log('\n' + (fail === 0 ? '✅ ALL ' + pass + ' TESTS PASSED' : '❌ ' + fail + ' FAILED, ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
