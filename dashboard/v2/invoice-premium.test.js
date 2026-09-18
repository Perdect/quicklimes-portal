/* invoice-premium.test.js — "Deshwali Premium Invoice": the firm's quotation
   letterhead (PDF DM/QT/2026-27/922, 18-09-2026) as a tax invoice.
   Run:  node dashboard/v2/invoice-premium.test.js

   Pins the layout the owner pointed at — navy band, gold rule, contact line,
   boxed strip, From/To boxes, navy table with packing, totals block, words,
   terms list, bank + declaration boxes, seal — and the same honesty rules as
   every design: nothing invented, nothing empty printed, units through
   units-core, IRN/QR only when real, export block only when there is one. */
const fs = require('fs'), path = require('path');
const T = require(path.join(__dirname, 'invoice-templates.js'));
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const seller = { name: 'DESHWALI MINERALS', short: 'Deshwali', sealText: 'BORUNDA, GOTAN, RAJASTHAN', logoMark: 'gem', lockup: '/v2/deshwali-lockup.svg?v=1', address: 'Near Dharam Kanta Gotan Road, Borunda 342604, Rajasthan', state: 'Rajasthan (08)', gstin: '08NLIPS9801K1Z5', tel: '8875020202, 9460767676', email: 'deshwaliminerals@gmail.com', website: 'www.deshwaliminerals.com', product: 'Manufacturer & Exporter of Premium Quick Lime and Hydrated Lime', logo: '/v2/deshwali-logo.png', iec: 'NLIPS9801K', lut: 'AD080826023319U', bank: 'HDFC Bank', bankBranch: 'Merta City', accNo: '50200089605146', ifsc: 'HDFC0002670', upi: '8875020202@hdfcbank', jurisdiction: 'RAJASTHAN', terms: ['Goods once sold will not be taken back.', 'Interest @ 18% p.a. will be charged if the payment is not made with in the 30days.', "Subject to 'RAJASTHAN' Jurisdiction only."] };
const BASE = { seller, buyer: { name: 'PHANTOM CHEMICALS', gstin: '19FNSPA3224G1ZY', address: 'Near More Shopping Mall, Haroa Road, Haroa, North 24 Parganas, West Bengal – 743425', state: 'West Bengal (19)', phone: '7872532502', email: '' },
  hsn: '25221000', inv: '2/2026-27', date: '2026-09-18', product: 'Quicklime (Calcium Oxide) — Lumps', desc: 'Industrial grade · high calcium, low silica · sized 20–80 mm', packing: '50 kg HDPE bags', qty: 42, unit: 'MT', rate: 5500, rateUnit: 'Ton', veh: 'RJ19GA1234', transport: 'By Road', station: 'Haroa, W.B.', eway: '', gstR: 5,
  taxable: 231000, cgst: 0, sgst: 0, igst: 11550, interState: true, total: 242550, roundOff: 0, grand: 242550, words: 'Rupees Two Lakh Forty Two Thousand Five Hundred Fifty Only' };
const R = (extra, cfg) => T.render(Object.assign({}, BASE, extra || {}), Object.assign({ template: 'premium' }, cfg || {}));
const h = R(), t = h.replace(/<[^>]+>/g, ' ');

console.log('\n═══ Deshwali Premium Invoice ═══');
const reg = T.get('premium');
ok('registered as "Deshwali Premium Invoice", fixed colours (not accentable), with despatch fields', reg && reg.name === 'Deshwali Premium Invoice' && reg.accentable === false && reg.despatch === true);
ok('the existing designs are untouched (registry order)', T.TEMPLATES.map(x => x.id).join(',') === 'gst,modern,business,detailed,industrial,premium');
ok('navy band (#0E2A47, sampled from the PDF): gem + two-line wordmark left, TAX INVOICE + copy label right — nothing else in it', /\.band\{background:#0E2A47/.test(h) && /class="band"/.test(h) && /TAX INVOICE/.test(t) && /Original for Recipient/.test(t) && !/class="t"/.test(h.slice(h.indexOf('class="band"'), h.indexOf('class="contact"'))));
ok('the product line sits under the band above the contact line, not inside the band', /class="contact"><div class="pl">Manufacturer &amp; Exporter of Premium Quick Lime and Hydrated Lime<\/div>/.test(h));
ok('gold rule under the band', /border-bottom:4px solid #C9A227/.test(h));
ok('the band prints the firm\'s letterhead LOCKUP (the owner\'s SVG: diamond + wordmark, white on transparent) with alt text, and no separate text wordmark', /<img class="lockup" src="[^"]*deshwali-lockup\.svg\?v=1" alt="DESHWALI MINERALS"/.test(h) && !/class="n">/.test(h));
ok('the lockup file is the owner\'s vector, white with #ECECEC facets, no scripts', (function () { const svg = fs.readFileSync(path.join(__dirname, 'deshwali-lockup.svg'), 'utf8'); return /viewBox="0 0 284 51"/.test(svg) && /fill="#ECECEC"/.test(svg) && (svg.match(/fill="white"/g) || []).length >= 10 && !/<script|<image|href=/.test(svg); })());
ok('a firm WITHOUT a lockup gets its own logo printed white (facets only with logoMark gem) beside the two-line wordmark', (function () { const x = R({ seller: Object.assign({}, seller, { lockup: '' }) }); return /class="lg"[^>]*><img src="[^"]*deshwali-logo\.png"[^>]*filter:brightness\(0\) invert\(1\)/.test(x) && /viewBox="0 0 1000 655"/.test(x) && /class="n">DESHWALI<br>MINERALS</.test(x); })());
ok('another firm\'s logo gets a clean white silhouette (no facet lines); a firm with no logo and no lockup gets the vector gem', !/viewBox="0 0 1000 655"/.test(R({ seller: Object.assign({}, seller, { lockup: '', logoMark: '', logo: '/v2/gotan-logo.png' }) })) && /<svg class="gem"/.test(R({ seller: Object.assign({}, seller, { lockup: '', logo: '' }) })));
ok('contact line: website · e-mail · phones in the PDF\'s form (+91 88750 20202, +91 94607 67676)', /www\.deshwaliminerals\.com/.test(t) && /deshwaliminerals@gmail\.com/.test(t) && /\+91 88750 20202, \+91 94607 67676/.test(t));
ok('the boxed strip: Invoice No. · Date · Vehicle No. · Place of supply; despatch strip carries Transport · Vehicle · Station · GR/RR', /Invoice No\./.test(t) && /2\/2026-27/.test(t) && /18-09-2026/.test(t) && /RJ19GA1234/.test(t) && /Place of supply/.test(t) && /West Bengal \(19\)/.test(t));
ok('the third cell prefers the due date, then the e-way number, then the vehicle', /Due date/.test(R({ due: '2026-10-03' }).replace(/<[^>]+>/g, ' ')) && /E-Way Bill No\.[\s\S]*791656947547/.test(R({ eway: '791656947547' }).replace(/<[^>]+>/g, ' ')));
ok('FROM — SUPPLIER and TO — BUYER boxes with GSTIN, State, PAN, Mobile', /From — Supplier/.test(t) && /To — Buyer/.test(t) && /08NLIPS9801K1Z5/.test(t) && /19FNSPA3224G1ZY/.test(t) && /Rajasthan \(08\)/.test(t) && /FNSPA3224G/.test(t) && /7872532502/.test(t));
ok('supplier address prints as one line', /Near Dharam Kanta Gotan Road, Borunda 342604, Rajasthan/.test(t));
ok('no E-mail for a buyer without one; no Packing column when no line has packing', !/E-mail:/.test(h.slice(h.indexOf('To — Buyer'), h.indexOf('class="meta" style="margin-top:0"'))) && /E-mail:/.test(h.slice(h.indexOf('From — Supplier'), h.indexOf('To — Buyer'))) && !/Packing/.test(R({ packing: '' }).replace(/<[^>]+>/g, ' ')));
ok('navy table: Sr · Description · HSN · Packing · Qty (MT) · Rate / Ton · Amount', /Description/.test(t) && /HSN/.test(t) && /Packing/.test(t) && /50 kg HDPE bags/.test(t) && /Qty \(MT\)/.test(t) && /Rate \/ Ton/.test(t));
ok('description in navy bold with the grey sub-line', /class="dn">Quicklime \(Calcium Oxide\) — Lumps</.test(h) && /class="ds">Industrial grade/.test(h));
ok('the line: 42 · INR 5,500.00 · INR 2,31,000.00', /INR 5,500\.00/.test(t) && /INR 2,31,000\.00/.test(t));
ok('totals block: value of goods with its arithmetic, IGST @ 5.00 % (HSN), total payable, total quantity', /Value of goods \(42 MT × INR 5,500\.00\/Ton\)/.test(t) && /IGST @ 5\.00 % \(HSN 25221000\)/.test(t) && /INR 11,550\.00/.test(t) && /Total payable \(goods incl\. GST\)/.test(t) && /INR 2,42,550\.00/.test(t) && /Total quantity/.test(t) && /42 MT/.test(t));
ok('intra-state prints CGST + SGST instead', (function () { const x = R({ interState: false, igst: 0, cgst: 5775, sgst: 5775, buyer: Object.assign({}, BASE.buyer, { gstin: '08BPLPS6684F1Z6', state: 'Rajasthan (08)' }) }).replace(/<[^>]+>/g, ' '); return /CGST @ 2\.50 %/.test(x) && /SGST @ 2\.50 %/.test(x) && !/IGST/.test(x); })());
ok('amount in words as "Indian Rupees … Only"', /Indian Rupees Two Lakh Forty Two Thousand Five Hundred Fifty Only/.test(t));
ok('terms as a two-column list (Term 1..3), the jurisdiction term included', /Term 1/.test(t) && /Term 3/.test(t) && /Subject to 'RAJASTHAN' Jurisdiction only\./.test(t));
ok('a term written "LABEL: text" uses its own label', /Price basis/.test(R({}, { terms: ['Price basis: Goods ex-works Borunda.'] }).replace(/<[^>]+>/g, ' ')));
ok('Bank Details — for payment box with account name, bank, A/C, IFSC, UPI', /Bank Details — for payment/.test(t) && /Account name: DESHWALI MINERALS/.test(t) && /HDFC Bank, Merta City/.test(t) && /A\/C No\.: 50200089605146/.test(t) && /IFSC: HDFC0002670/.test(t) && /UPI: 8875020202@hdfcbank/.test(t));
ok('no bank box for a firm with nothing on file', !/Bank Details/.test(R({ seller: Object.assign({}, seller, { bank: '', accNo: '', upi: '' }) }).replace(/<[^>]+>/g, ' ')));
ok('Declaration box replaces the quotation\'s "To confirm this order"', /Declaration/.test(t) && /We declare that this invoice shows the actual price/.test(t) && !/To confirm this order/.test(t));
ok('no "Dear Sir" letter — this is an invoice, not an offer', !/Dear Sir/.test(t) && !/Thank you for your enquiry/.test(t));
ok('"For DESHWALI MINERALS", a round seal, "Authorised Signatory & Seal"', /For DESHWALI MINERALS/.test(t) && /<svg class="seal"/.test(h) && /textPath/.test(h) && /Authorised Signatory &amp; Seal/.test(h));
ok('the seal: firm name on the top arc, the stamp\'s own line on the bottom arc, stars and dash-dot marks — never an invented registration', (function () { const si = h.indexOf('<svg class="seal"'); const sv = h.slice(si, h.indexOf('</svg>', si)); return /sealTop[\s\S]*DESHWALI MINERALS/.test(sv) && /sealBot[\s\S]*BORUNDA, GOTAN, RAJASTHAN/.test(sv) && (sv.match(/★/g) || []).length === 2 && /<line /.test(sv) && !/Regd\. No|Reg\. No|GSTIN/.test(sv); })());
ok('a firm with no seal line falls back to city + state on the bottom arc', /sealBot[\s\S]*MERTA, RAJASTHAN/.test(R({ seller: Object.assign({}, seller, { sealText: '', city: 'Merta' }) })));
ok('footer: invoice no., date, "tax invoice under the CGST Rules, 2017", E&OE', /Invoice 2\/2026-27 · 18-09-2026 · This is a tax invoice under the CGST Rules, 2017\. Errors and omissions excepted\./.test(t));
ok('reverse charge and jurisdiction on the closing line', /Reverse charge: No/.test(t) && /Subject to RAJASTHAN jurisdiction/.test(t));
ok('no undefined / NaN / null', !/undefined|NaN|\bnull\b/.test(t));
ok('buyer markup is escaped', R({ buyer: Object.assign({}, BASE.buyer, { name: '<script>x</script>' }) }).includes('&lt;script&gt;'));
ok('A4 standalone document; narrow previews scale', /^<!DOCTYPE html>/.test(h) && /@page\{size:A4/.test(h) && /max-width:760px\)\{\.sheet\{zoom:\.7\}/.test(h));

console.log('═══ units, multi-line, e-invoice, export ═══');
const kg = R({ qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Ton', billableQty: 7.65, billableUnit: 'Ton', taxable: 40545, igst: 2027.25, total: 42572.25, grand: 42572.25, packing: '', words: 'Rupees Forty Two Thousand Five Hundred Seventy Two and Paisa Twenty Five Only' }).replace(/<[^>]+>/g, ' ');
ok('a Kg line priced per Ton: Qty (Kg), Rate / Ton, the conversion note, INR 40,545.00', /Qty \(Kg\)/.test(kg) && /Rate \/ Ton/.test(kg) && /7,650 Kg = 7\.65 Ton × ₹5,300\.00/.test(kg) && /INR 40,545\.00/.test(kg) && !/4,05,45,000/.test(kg));
const ml = R({ items: [{ hsn: '25221000', product: 'Quick Lime Powder', grade: 'Industrial Grade', packing: '50 KG Bags', qty: 20, unit: 'MT', rate: 5000, rateUnit: 'Ton', taxable: 100000 }, { hsn: '25221000', product: 'Quick Lime Lumps', qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Ton' }], charges: [{ label: 'Freight — Borunda to Haroa', desc: 'By road, full truck load', amount: 12000 }], taxable: 152545, igst: 7627.25, total: 160172.25, grand: 160172.25, words: 'Rupees One Lakh Sixty Thousand One Hundred Seventy Two and Paisa Twenty Five Only' }).replace(/<[^>]+>/g, ' ');
ok('multi-line: both items, the Kg line priced through units-core (INR 40,545.00), the charge as its own row with HSN 9965', /Quick Lime Powder/.test(ml) && /Quick Lime Lumps/.test(ml) && /INR 40,545\.00/.test(ml) && /Freight — Borunda to Haroa/.test(ml) && /9965/.test(ml) && /Charges[\s\S]*INR 12,000\.00/.test(ml));
ok('multi-line quantity total is per unit: 20 MT + 7,650 Kg', /20 MT \+ 7,650 Kg/.test(ml));
ok('no IRN / QR without an IRN', !/IRN|Ack No|e-Invoice QR/.test(t));
const ei = R({ irn: 'abc123def', ackNo: '172621081606743', ackDt: '2026-09-18', qrData: 'signed' });
ok('with a real IRN: IRN, Ack No., Ack Date (dd-mm-yyyy) and the QR', /abc123def/.test(ei) && /172621081606743/.test(ei) && /18-09-2026/.test(ei) && /e-Invoice QR/.test(ei));
ok('no export block on a domestic invoice', !/Export Details/.test(t));
const xp = R({ type: 'export', export: { country: 'Nepal', incoterms: 'EXW', currency: 'INR' }, buyer: { name: 'NEW NEPAL ELECTRICALS', address: 'Surkhet, Nepal', gstin: '', state: '' }, igst: 0, gstR: 0 }).replace(/<[^>]+>/g, ' ');
ok('export: EXPORT TAX INVOICE, zero-rated IGST line, Export Details with only the given facts, place of supply Nepal', /EXPORT TAX INVOICE/.test(xp) && /zero-rated export under LUT/.test(xp) && /Export Details/.test(xp) && /Nepal/.test(xp) && /EXW/.test(xp) && !/Shipping Bill/.test(xp) && !/Rajasthan \(08\)[\s\S]*Place of supply/.test(xp.slice(xp.indexOf('Place of supply'))));

/* print: one A4 page for a one-line invoice (Chrome when present) */
(function () {
  const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!fs.existsSync(CH)) { ok('SKIPPED (no Chrome): one-line invoice prints on one page', true); return; }
  const os = require('os'), cp = require('child_process'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prem-'));
  const pages = htmlStr => { const hp = path.join(tmp, 'x.html'), pp = path.join(tmp, 'x.pdf'); fs.writeFileSync(hp, htmlStr); cp.execFileSync(CH, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--print-to-pdf=' + pp, 'file://' + hp], { stdio: 'ignore' }); return (fs.readFileSync(pp, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length; };
  ok('a one-line invoice prints on ONE A4 page', pages(R()) === 1);
  ok('a one-line e-invoice with IRN + Ack (no QR) prints on ONE page', pages(R({ irn: 'a'.repeat(64), ackNo: '172621081606743', ackDt: '18-09-2026' })) === 1);
})();

console.log('\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' PREMIUM TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
