/* invoice-designs.test.js — the two colour designs are the ones the owner asked for.
   Run:  node dashboard/v2/invoice-designs.test.js

   WHY THIS EXISTS
   12-09-2026: "I don't like Modern, Monochrome, Compact. I like attached format
   design" — two Zoho-style bill layouts. The compliance suite proves every
   design is legal; this one proves these two are the designs he pointed at:
   the header band / boxes, the accent flowing from the colour picker into the
   table header, the tinted surfaces derived from it, and that the rejected
   designs are gone. */
const path = require('path');
const T = require(path.join(__dirname, 'invoice-templates.js'));
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const D = { seller: { name: 'DESHWALI MINERALS', address: 'Merta City', gstin: '08NLIPS9801K1Z5', tel: '8875020202, 9460767676', product: 'Manufactures of Quick Lime', logo: '/v2/deshwali-logo.png', bank: 'HDFC Bank', ifsc: 'HDFC0002670', accNo: '50200089605146', terms: ['Goods once sold will not be taken back.'] },
  buyer: { name: 'Lekhraj Chemical Industries', gstin: '08BPLPS6684F1Z6', address: 'Borunda', state: 'Rajasthan (08)', phone: '', email: '' },
  hsn: '25221000', inv: '36', date: '2026-08-01', product: 'Quick Lime', qty: 16.16, rate: 4950, unit: 'Tonne', veh: 'RJ37GA1987', eway: '791656947547', gstR: 5,
  taxable: 79992, cgst: 1999.8, sgst: 1999.8, igst: 0, interState: false, total: 83991.6, roundOff: 0, grand: 83991.6, words: 'Rupees Eighty Three Thousand Nine Hundred Ninety One and Paisa Sixty Only' };

ok('registry is gst, modern, business, detailed, industrial — in that order', T.TEMPLATES.map(t => t.id).join(',') === 'gst,modern,business,detailed,industrial');
ok('the rejected designs are gone', !T.TEMPLATES.some(t => /mono|compact|classic/.test(t.id)));
ok('modern, business and detailed are accentable (the colour picker applies)', T.TEMPLATES.filter(t => t.accentable).map(t => t.id).join(',') === 'modern,business,detailed,industrial');
ok('modern and business do not print the despatch block; detailed does (it is the full-detail layout)', !T.TEMPLATES.filter(t => /modern|business/.test(t.id)).some(t => t.despatch) && T.get('detailed').despatch === true);

for (const id of ['modern', 'business']) {
  const purple = T.render(D, { template: id, accent: '#7C3AED' }), blue = T.render(D, { template: id });
  ok(id + ': the picked accent reaches the item-table header', purple.includes(id === 'modern' ? '.itm th{background:#7C3AED;' : '.itm th{background:#7C3AED22;'));
  ok(id + ': the tinted surfaces derive from the accent (8-digit hex)', purple.includes('#7C3AED14') || purple.includes('#7C3AED22'));
  ok(id + ': the total is set in the accent', purple.includes(id === 'modern' ? '.gt .v{font-size:17px;font-weight:700;color:#7C3AED}' : '.tb tr.tot td{background:#7C3AED;'));
  ok(id + ': default accent is the app blue', blue.includes('#2563EB'));
  ok(id + ': zebra rows on modern; fully ruled rows on business', id === 'modern' ? purple.includes('.itm tr:nth-child(even) td{background:#7C3AED0A}') : purple.includes('.itm td{padding:10px 12px;font-size:10.5px;border:1px solid #D1D5DB'));
  ok(id + ': the words block', /Invoice Total (\(in words\)|In Words:)/.test(purple) && purple.includes(D.words));
  ok(id + ': Terms and Conditions, bank in the notes, and the enquiries line', purple.includes('Terms and Conditions') && purple.includes('Bank Details') && purple.includes('For any enquiries, call us on <b>8875020202, 9460767676</b>'));
  ok(id + ': logo, GSTIN, HSN, vehicle, e-way present', ['/v2/deshwali-logo.png', '08NLIPS9801K1Z5', '25221000', 'RJ37GA1987', '791656947547'].every(s => purple.includes(s)));
  ok(id + ': quantity total marked', /class="qtytot[^"]*">16\.16 Tonne</.test(purple));
  ok(id + ': signature block', purple.includes('Authorised Signatory') && purple.includes('for <b>DESHWALI MINERALS</b>'));
}
const m = T.render(D, { template: 'modern' }), b = T.render(D, { template: 'business' });
ok('modern: tinted header band with the light "Tax Invoice" title and "Invoice by" on the right', /class="band"/.test(m) && m.includes('<div class="ttl">Tax Invoice') && m.includes('Invoice by') && m.includes('.ttl{font-size:34px;font-weight:300'));
ok('modern: "Billed to" and "Invoice details" columns', m.includes('>Billed to<') && m.includes('>Invoice details<'));
ok('modern: tinted footer band', /class="foot"/.test(m) && /\.foot\{background:#2563EB14/.test(m));
ok('business: light "Tax Invoice" title top-right, logo and firm top-left', b.includes('<div class="ttl">Tax Invoice</div>') && b.includes('.ttl{font-size:30px;font-weight:300'));
ok('business: "Invoice by" and "Invoice to" columns with PAN, and the ruled totals box', b.includes('>Invoice by<') && b.includes('>Invoice to<') && b.includes('<b>PAN</b> NLIPS9801K') && b.includes('<tr class="tot"><td>Total Amount</td>') && b.includes('<b>Invoice Total In Words:</b>'));
ok('business: Country and Place of supply in the meta column', b.includes('<span>Country of supply:</span><b>India</b>') && b.includes('<span>Place of supply:</span><b>Rajasthan (08)</b>'));

/* detailed — the photographed sample, honestly */
const DT = Object.assign({}, D, { transport: 'Self', station: 'TEH PIPAR CITY', grrr: '' });
const x = T.render(DT, { template: 'detailed' });
ok('detailed: GSTIN and PAN top-left', x.includes('<b>GSTIN</b>: 08NLIPS9801K1Z5') && x.includes('<b>PAN</b>: NLIPS9801K'));
ok('detailed: contact top-right', x.includes('+91 8875020202, 9460767676'));
const xx = T.render(Object.assign({}, DT, { seller: Object.assign({}, D.seller, { iec: 'NLIPS9801K' }) }), { template: 'detailed' });
ok('detailed: IEC line under PAN when the firm has one; no CIN line for a proprietorship', xx.includes('<b>PAN</b>: NLIPS9801K<br><b>IEC</b>: NLIPS9801K') && !xx.includes('<b>CIN</b>'));
ok('detailed: a firm with a CIN gets the CIN line', T.render(Object.assign({}, DT, { seller: Object.assign({}, D.seller, { cin: 'U17299RJ2022PTC081212' }) }), { template: 'detailed' }).includes('<b>CIN</b>: U17299RJ2022PTC081212'));
ok('detailed: firm name in the accent (the engine default), ORIGINAL COPY, TAX INVOICE title', x.includes('.cn{font-size:22px;font-weight:800;color:#2563EB') && x.includes('ORIGINAL COPY') && x.includes('<span>TAX INVOICE</span>'));
ok('detailed: a picked accent colours the firm name', T.render(DT, { template: 'detailed', accent: '#7C3AED' }).includes('.cn{font-size:22px;font-weight:800;color:#7C3AED'));
ok('detailed: transport block with Transport mode / GR/RR / Station / Place of Supply / Vehicle', ['Transport mode', 'GR/RR No.', 'Station', 'Place of Supply', 'Vehicle No.'].every(k => x.includes(k)));
ok('detailed: buyer AND consignee blocks with PAN from the GSTIN', x.includes('Details of Buyer (Billed to)') && x.includes('Details of Consignee (Shipped to)') && x.split('<span class="v">BPLPS6684F</span>').length - 1 === 2);
ok('detailed: watermark logo behind the goods', /class="wm"><img src="[^"]*deshwali-logo\.png"[^>]*opacity:\.07/.test(x));
ok('detailed: tax stack — taxable, CGST, SGST, IGST as a dash, GST amount, after tax, total, reverse charge', ['Total Taxable Value', 'ADD: CGST @ 2.50 %', 'ADD: SGST @ 2.50 %', 'ADD: IGST</td><td>&ndash;', 'GST Tax Amount', 'Amount After Tax', 'Total Amount', 'GST Reverse Charge'].every(k => x.includes(k)));
ok('detailed: no round-off row when the firm does not round', !x.includes('Round Off'));
ok('detailed: AMOUNT IN WORDS and REGD. ADDRESS', x.includes('<b>AMOUNT IN WORDS:</b> ' + D.words) && x.includes('<b>REGD. ADDRESS</b>: Merta City'));
ok('detailed: NO IRN / QR / "Signature valid" when no e-invoice exists', !/IRN:|Ack No|qrserver|Signature valid|Digitally Signed/.test(x) && x.includes('TAX INVOICE') && !x.includes('E-INVOICE'));
const xe = T.render(Object.assign({}, DT, { irn: 'abc123', ackNo: '1726', ackDt: '02-09-2026', qrData: 'x' }), { template: 'detailed' });
ok('detailed: with a real IRN the title becomes TAX E-INVOICE and the IRN / Ack / QR block prints', xe.includes('TAX E-INVOICE') && xe.includes('<b>IRN:</b> abc123') && xe.includes('e-invoice QR'));
const xr = T.render(Object.assign({}, DT, { total: 101849.6, grand: 101850 }), { template: 'detailed' });
ok('detailed: a rounding firm gets a Round Off row', xr.includes('Round Off') && xr.includes('+0.40'));
const xi = T.render(Object.assign({}, DT, { interState: true, cgst: 0, sgst: 0, igst: 3999.6, buyer: Object.assign({}, D.buyer, { gstin: '27CMVPC2808M1ZK', state: 'Maharashtra (27)' }) }), { template: 'detailed' });
ok('detailed inter-state: IGST carries the rate, CGST / SGST are dashes', xi.includes('ADD: IGST @ 5.00 %') && xi.includes('ADD: CGST</td><td>&ndash;') && xi.includes('ADD: SGST</td><td>&ndash;'));

/* the unit address rides along in every design */
const DU = Object.assign({}, DT, { seller: Object.assign({}, D.seller, { unitAddress: 'Khasra No.1787/7, Borunda, Jodhpur, Rajasthan, 342601' }) });
ok('modern: Unit line in the notes', T.render(DU, { template: 'modern' }).includes('Unit: Khasra No.1787/7, Borunda, Jodhpur, Rajasthan, 342601'));
ok('business: Unit line in the Invoice-by box', T.render(DU, { template: 'business' }).includes('<b>Unit</b> Khasra No.1787/7, Borunda, Jodhpur, Rajasthan, 342601'));
ok('detailed: UNIT ADDRESS in the footer', T.render(DU, { template: 'detailed' }).includes('<b>UNIT ADDRESS</b>: Khasra No.1787/7, Borunda, Jodhpur, Rajasthan, 342601'));
ok('no design prints a Unit line when the firm has none', !['modern', 'business', 'detailed'].some(id => /Unit|UNIT ADDRESS/.test(T.render(DT, { template: id }))));

console.log('\n═══ the two colour designs ═══\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' DESIGN TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
