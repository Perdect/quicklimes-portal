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

ok('registry is exactly gst, modern, business', T.TEMPLATES.map(t => t.id).join(',') === 'gst,modern,business');
ok('the rejected designs are gone', !T.TEMPLATES.some(t => /mono|compact|classic/.test(t.id)));
ok('modern and business are accentable (the colour picker applies)', T.TEMPLATES.filter(t => t.accentable).map(t => t.id).join(',') === 'modern,business');
ok('neither colour design prints the despatch block', !T.TEMPLATES.filter(t => t.id !== 'gst').some(t => t.despatch));

for (const id of ['modern', 'business']) {
  const purple = T.render(D, { template: id, accent: '#7C3AED' }), blue = T.render(D, { template: id });
  ok(id + ': the picked accent reaches the item-table header', purple.includes('.itm th{background:#7C3AED}'));
  ok(id + ': the tinted surfaces derive from the accent (8-digit hex)', purple.includes('#7C3AED14') || purple.includes('#7C3AED12'));
  ok(id + ': the total is set in the accent', purple.includes('.gt .v{color:#7C3AED}'));
  ok(id + ': default accent is the app blue', blue.includes('.itm th{background:#2563EB}'));
  ok(id + ': item table with zebra rows', purple.includes('.itm tr:nth-child(even) td{background:#7C3AED0A}'));
  ok(id + ': "Invoice total (in words)" block', purple.includes('Invoice total (in words)') && purple.includes(D.words));
  ok(id + ': Terms and conditions, bank and the contact line', purple.includes('Terms and conditions') && purple.includes('Bank Details') && purple.includes('For any enquiries, call us on <b>8875020202, 9460767676</b>'));
  ok(id + ': logo, GSTIN, HSN, vehicle, e-way present', ['/v2/deshwali-logo.png', '08NLIPS9801K1Z5', '25221000', 'RJ37GA1987', '791656947547'].every(s => purple.includes(s)));
  ok(id + ': quantity total marked', /class="qtytot[^"]*">16\.16 Tonne</.test(purple));
  ok(id + ': signature block', purple.includes('Authorised Signatory') && purple.includes('for <b>DESHWALI MINERALS</b>'));
}
const m = T.render(D, { template: 'modern' }), b = T.render(D, { template: 'business' });
ok('modern: tinted header band with the light "Tax Invoice" title and "Invoice by" on the right', /class="band"/.test(m) && m.includes('<div class="ttl">Tax Invoice') && m.includes('Invoice by'));
ok('modern: "Billed to" and "Invoice details" columns', m.includes('>Billed to<') && m.includes('>Invoice details<'));
ok('modern: tinted footer band', /class="foot"/.test(m) && /\.foot\{background:#2563EB14/.test(m));
ok('business: centred TAX INVOICE title', b.includes('<div class="ttl">TAX INVOICE</div>'));
ok('business: "Invoice by" and "Invoice to" tinted boxes with PAN', b.includes('>Invoice by<') && b.includes('>Invoice to<') && b.includes('<b>PAN</b> NLIPS9801K'));
ok('business: Place of supply strip', b.includes('Place of supply<b>Rajasthan (08)</b>'));

console.log('\n═══ the two colour designs ═══\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' DESIGN TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
