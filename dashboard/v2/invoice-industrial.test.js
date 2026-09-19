/* invoice-industrial.test.js — "Deshwali Professional Industrial Invoice" keeps the brief's promises.
   Run:  node dashboard/v2/invoice-industrial.test.js

   WHY THIS EXISTS
   The brief (13-09-2026) is long and mostly about ABSENCE: hide every empty
   optional field, show only the tax heads that apply, no IRN/QR unless real,
   no export block unless the invoice is an export, nothing invented. Absence is
   what a screenshot cannot prove and what a later edit breaks silently. The
   compliance suite proves the design is legal; this proves it is honest and
   that the existing designs are untouched. */
const fs = require('fs'), path = require('path');
const T = require(path.join(__dirname, 'invoice-templates.js'));
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const seller = { name: 'DESHWALI MINERALS', short: 'Deshwali', address: 'GROUND FLOOR, KALI TALAI\nNEAR HAFIZ SAHAB KI DRAGHA, MERTA CITY, DISTRICT-NAGAUR', state: 'Rajasthan (08)', gstin: '08NLIPS9801K1Z5', tel: '8875020202, 9460767676', product: 'Manufactures of Quick Lime and Hydrated Lime.', tagline: 'Manufacturer & Supplier of Quick Lime, Hydrated Lime, Lime Stone & Industrial Minerals', logo: '/v2/deshwali-logo.png', iec: 'NLIPS9801K', unitAddress: 'Khasra No.1787/7, Borunda, Jodhpur, Rajasthan, 342601', bank: 'HDFC Bank', bankBranch: 'Merta City', accNo: '50200089605146', ifsc: 'HDFC0002670', upi: '8875020202@hdfcbank', terms: ['Tally term one'] };
const BASE = { seller, buyer: { name: 'Lekhraj Chemical Industries', gstin: '08BPLPS6684F1Z6', address: 'KHASRA NO 80/4/1, BORUNDA', state: 'Rajasthan (08)', phone: '', email: '' },
  hsn: '25221000', inv: '36', date: '2026-08-01', product: 'Quick Lime', qty: 16.16, rate: 4950, unit: 'Tonne', transport: 'Self', veh: 'RJ37GA1987', station: 'TEH PIPAR CITY', eway: '791656947547', grrr: '', gstR: 5,
  taxable: 79992, cgst: 1999.8, sgst: 1999.8, igst: 0, interState: false, total: 83991.6, roundOff: 0, grand: 83991.6, words: 'Rupees Eighty Three Thousand Nine Hundred Ninety One and Paisa Sixty Only' };
const R = (extra, cfg) => T.render(Object.assign({}, BASE, extra || {}), Object.assign({ template: 'industrial' }, cfg || {}));
const h = R();

/* the existing designs are untouched, this one is additional */
ok('registry: existing ids in their order, industrial then premium then blueink appended', T.TEMPLATES.map(t => t.id).join(',') === 'gst,modern,business,detailed,industrial,premium,blueink');
ok('gst is still TEMPLATES[0] (the default and the fallback)', T.TEMPLATES[0].id === 'gst');
const reg = T.get('industrial'); ok('registered under the exact name from the brief', reg.name === 'Deshwali Professional Industrial Invoice' && reg.accentable === true && reg.despatch === true);

/* header + registration strip */
ok('TAX INVOICE title and copy label', h.includes('>TAX INVOICE<') && h.includes('Original for Recipient'));
ok('copy label follows cfg.copy', R({}, { copy: 'Duplicate for Transporter' }).includes('Duplicate for Transporter'));
ok('the industrial tagline from the profile', h.includes('Manufacturer &amp; Supplier of Quick Lime, Hydrated Lime, Lime Stone &amp; Industrial Minerals'));
ok('logo', h.includes('/v2/deshwali-logo.png'));
for (const s of ['<span>GSTIN</span><b>08NLIPS9801K1Z5</b>', '<span>PAN</span><b>NLIPS9801K</b>', '<span>IEC</span><b>NLIPS9801K</b>', '<span>State</span><b>Rajasthan</b>', '<span>State Code</span><b>08</b>']) ok('registration strip has ' + s.replace(/<[^>]+>/g, ' ').trim(), h.includes(s));
ok('no Udyam cell when the firm has no MSME number', !h.includes('Udyam/MSME'));
ok('Udyam cell when it has one', R({ seller: Object.assign({}, seller, { msme: 'UDYAM-RJ-00-0000000' }) }).includes('<span>Udyam/MSME</span><b>UDYAM-RJ-00-0000000</b>'));

/* hide-empty */
ok('no Due Date, no E-Way Bill Date, no PO when absent', !/Due Date|E-Way Bill Date|PO Number|PO Date/.test(h));
ok('they appear when present', /Due Date.*15-08-2026/.test(R({ due: '2026-08-15' })) && /PO Number<\/span><b>4100004169/.test(R({ po: '4100004169' })) && /E-Way Bill Date.*01-08-2026/.test(R({ ewayDate: '2026-08-01' })));
ok('no Contact / Email rows for a buyer without them', !/<span>Contact<\/span>|<span>Email<\/span>/.test(h));
ok('no "undefined", no "NaN", no "null" anywhere', !/\bundefined\b|\bNaN\b|\bnull\b/.test(h));
ok('no LR / GR/RR cell when empty; present when set', !h.includes('LR / GR/RR No.') && R({ grrr: 'GR-7' }).includes('<span>LR / GR/RR No.</span><b>GR-7</b>'));
ok('Dispatch From is the unit (kiln) address', h.includes('<span>Dispatch From</span><b>Khasra No.1787/7, Borunda, Jodhpur, Rajasthan, 342601</b>'));

/* bill to / ship to */
ok('Bill To with State, State Code, GSTIN, PAN from the GSTIN', h.includes('<h4>Bill To</h4>') && h.includes('<span>State</span><b>Rajasthan</b>') && h.includes('<span>State Code</span><b>08</b>') && h.includes('<span>PAN</span><b>BPLPS6684F</b>'));
ok('Ship To falls back to the buyer with Place of Supply', h.includes('<h4>Ship To</h4>') && h.split('Lekhraj Chemical Industries').length - 1 === 2 && h.includes('<span>Place of Supply</span><b>Rajasthan (08)</b>'));
const hs = R({ shipTo: { name: 'Site Store, Beawar', address: 'Plot 9, RIICO, Beawar', state: 'Rajasthan (08)', gstin: '', phone: '9000000000' } });
ok('an explicit consignee replaces the fallback', hs.includes('Site Store, Beawar') && hs.includes('Plot 9, RIICO, Beawar') && hs.includes('<span>Contact</span><b>9000000000</b>'));

/* product table */
ok('core columns only when no grade / packing / bags exist', !/Grade \/ Specification|>Packing<|No\. of Bags/.test(h) && h.includes('Qty (Tonne)') && h.includes('Rate / Tonne') && h.includes('Taxable Value (₹)'));
ok('single line printed from the sale record', h.includes('<td>25221000</td><td><b>Quick Lime</b></td>') && h.includes('<td class="r">16.16</td><td class="r">4,950.00</td><td class="r">79,992.00</td>'));
const hm = R({ items: [{ hsn: '25221000', product: 'Quick Lime Powder', grade: 'Industrial Grade', packing: '50 KG Bags', bags: 400, qty: 20, unit: 'MT', rate: 5000, taxable: 100000 }, { hsn: '25221000', product: 'Quick Lime Lumps', qty: 10, unit: 'MT', rate: 4800, taxable: 48000 }] });
ok('the Qty / Rate headers take the unit from the items, not the sale line', hm.includes('Qty (MT)') && hm.includes('Rate / MT'));
ok('Product Description is floored at 150px so it stays the widest text column', hm.includes('<th style="min-width:150px">Product Description</th>'));
ok('multi-line items with the optional columns appearing because a row has them', hm.includes('Grade / Specification') && hm.includes('>Packing<') && hm.includes('No. of Bags') && hm.includes('Quick Lime Powder') && hm.includes('Quick Lime Lumps') && hm.includes('<td>Industrial Grade</td>') && hm.includes('<td class="r">400</td>'));
ok('thead repeats on every printed page', h.includes('.it thead{display:table-header-group}'));

/* specification + charges */
ok('no specification block without data', !h.includes('Product / Quality Specification'));
const hq = R({ qa: { params: [{ label: 'CaO', value: '86.71', unit: '%' }, { label: 'MgO', value: '', unit: '%' }, { label: 'Reactivity', value: '300', unit: '' }] } });
ok('specification block from the analysis report, only the parameters with a result', hq.includes('Product / Quality Specification') && hq.includes('<td>CaO %</td><td>86.71</td>') && hq.includes('<td>Reactivity</td><td>300</td>') && !hq.includes('MgO'));
ok('no charges block without data; charges listed when given', !h.includes('Additional Charges') && R({ charges: [{ label: 'Freight / Transportation Charges', amount: 12000 }, { label: 'Loading Charges', amount: 0 }] }).includes('<td>Freight / Transportation Charges</td><td>₹ 12,000.00</td>') && !R({ charges: [{ label: 'Loading Charges', amount: 0 }] }).includes('Additional Charges'));

/* tax block */
ok('intra-state: CGST + SGST rows, no IGST', h.includes('<td>CGST @ 2.50 %</td><td class="r">1,999.80</td>') && h.includes('<td>SGST @ 2.50 %</td>') && !/IGST/.test(h));
const hi = R({ buyer: Object.assign({}, BASE.buyer, { gstin: '27CMVPC2808M1ZK', state: 'Maharashtra (27)' }), interState: true, cgst: 0, sgst: 0, igst: 3999.6 });
ok('inter-state: IGST row only', hi.includes('<td>IGST @ 5.00 %</td><td class="r">3,999.60</td>') && !/CGST|SGST/.test(hi));
ok('no Cess / Other Tax / Round Off rows when zero', !/<td>Cess<\/td>|Other Tax|Round Off/.test(h));
ok('Round Off row for a rounding firm (read from the model, never re-derived)', R({ total: 101849.6, grand: 101850, roundOff: 0.4 }).includes('<td>Round Off</td><td class="r">+0.40</td>') && !R({ total: 101849.6, grand: 101850 }).includes('Round Off'));
ok('the total is loud and correct', h.includes('<small>Total Invoice Value</small></td><td class="r">₹ 83,991.60</td>'));
ok('quantity total marked', /class="qtytot[^"]*">16\.16 Tonne</.test(h));
ok('amount in words as "Indian Rupees … Only"', h.includes('<b>Indian Rupees Eighty Three Thousand Nine Hundred Ninety One and Paisa Sixty Only</b>'));

/* e-invoice + export */
ok('no IRN / Ack / QR / e-invoice status without an IRN', !/IRN|Ack No|E-Invoice Status|qrserver|e-Invoice QR/.test(h));
const he = R({ irn: 'abc123', ackNo: '1726', ackDt: '02-09-2026', qrData: 'signed' });
ok('with a real IRN: status, IRN, Ack, QR area', he.includes('IRN generated') && he.includes('<b>abc123</b>') && he.includes('e-Invoice QR'));
ok('the IRN, Ack No. and Ack Date print exactly ONCE (header carries only the status)', he.split('abc123').length - 1 === 1 && he.split('<span style="min-width:100px">Ack No.</span>').length - 1 === 1 && !/<span>IRN<\/span>/.test(he));
(function () {
  const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!fs.existsSync(CH)) { ok('SKIPPED (no Chrome here): one-line e-invoice prints on one page', true); return; }
  const os = require('os'), cp = require('child_process'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ind-'));
  const pages = htmlStr => { const hp = path.join(tmp, 'x.html'), pp = path.join(tmp, 'x.pdf'); fs.writeFileSync(hp, htmlStr); cp.execFileSync(CH, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--print-to-pdf=' + pp, 'file://' + hp], { stdio: 'ignore' }); return (fs.readFileSync(pp, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length; };
  ok('a one-line invoice with IRN + Ack prints on ONE A4 page', pages(R({ irn: 'a'.repeat(64), ackNo: '172621081606743', ackDt: '02-09-2026' })) === 1);
  ok('a one-line invoice with IRN + QR + spec + charges prints on at most two pages', pages(R({ irn: 'a'.repeat(64), ackNo: '1', ackDt: '02-09-2026', qrData: 'x', charges: [{ label: 'Freight', amount: 1000 }], qa: { params: [{ label: 'CaO', value: '86', unit: '%' }] } })) <= 2);
})();
ok('no export block on a domestic invoice', !/Export Details|Shipping Bill|Incoterms/.test(h));
ok('export with NO export facts and no IEC/LUT on the profile: title + zero-rated line only, no block', (function () { const x = R({ type: 'export', export: null, seller: Object.assign({}, seller, { iec: '', lut: '' }), buyer: { name: 'Himalaya Lime Traders', address: 'Birgunj, Nepal', gstin: '', state: '' }, interState: true, cgst: 0, sgst: 0, igst: 0, gstR: 0 }); return x.includes('EXPORT TAX INVOICE') && x.includes('zero-rated export under LUT') && !x.includes('Export Details') && !x.includes('Country of Origin') && !x.includes('Rajasthan (08)') && x.includes('Outside India'); })());
ok('export with only the profile IEC: the block carries IEC and nothing invented', (function () { const x = R({ type: 'export', export: null, buyer: { name: 'H', address: '', gstin: '', state: '' }, interState: true, cgst: 0, sgst: 0, igst: 0, gstR: 0 }); return x.includes('Export Details') && x.includes('<b>NLIPS9801K</b>') && !x.includes('Country of Origin') && !x.includes('Currency'); })());
ok('an Ack No. WITHOUT an IRN is not called an e-invoice', !/IRN generated|Ack No/.test(R({ ackNo: '1726', ackDt: '02-09-2026' })));
ok('Ack Date prints dd-mm-yyyy like every other date', R({ irn: 'abc', ackNo: '1', ackDt: '2026-09-02' }).includes('<b>02-09-2026</b>'));
ok('footer prints the phone verbatim — no "+91" bolted on', h.includes('Phone: 8875020202, 9460767676') && !h.includes('+91'));
ok('a multi-line sale totals quantity from the items (30 MT), not the sale line', /class="qtytot[^"]*">30 MT</.test(R({ items: [{ product: 'A', qty: 20, unit: 'MT', rate: 1, taxable: 20 }, { product: 'B', qty: 10, unit: 'MT', rate: 1, taxable: 10 }], qty: 0 })));
ok('items with no unit print "Qty" / "Rate", never an invented MT', (function () { const x = R({ items: [{ product: 'A', qty: 5, unit: '', rate: 1, taxable: 5 }], unit: '' }); return x.includes('>Qty</th>') && x.includes('>Rate</th>') && !x.includes('(MT)'); })());
const hx = R({ type: 'export', export: { lut: 'AD080826023319U', country: 'Nepal', currency: 'INR', incoterms: 'EXW', declaration: 'Supply meant for export under LUT without payment of IGST.' } });
ok('export invoice: no CGST / SGST rows — a single zero-rated IGST line', hx.includes('<td>IGST — zero-rated export under LUT</td>') && !/CGST|SGST/.test(hx));
ok('export invoice: title, block with only the given fields, declaration', hx.includes('EXPORT TAX INVOICE') && hx.includes('<span>LUT No.</span><b>AD080826023319U</b>') && hx.includes('<b>Nepal</b>') && hx.includes('<b>EXW</b>') && !/Shipping Bill|Port of Loading|Container/.test(hx) && hx.includes('Supply meant for export under LUT without payment of IGST.'));

/* bank, terms, authorisation, footer */
ok('bank details from the profile, account name = the firm', h.includes('<span style="min-width:110px">Account Name</span><b>DESHWALI MINERALS</b>') || h.includes('<span>Account Name</span><b>DESHWALI MINERALS</b>'));
ok('bank rows present, UPI included', /Bank Name<\/span><b>HDFC Bank/.test(h) && /Account Number<\/span><b>50200089605146/.test(h) && /IFSC<\/span><b>HDFC0002670/.test(h) && /UPI<\/span><b>8875020202@hdfcbank/.test(h));
ok('no Bank Details HEADING either for a firm with no bank on file', !R({ seller: Object.assign({}, seller, { bank: '', accNo: '', ifsc: '', bankBranch: '', upi: '' }) }).includes('Bank Details'));
ok('no bank block rows for a firm with no bank on file', !/Bank Name|Account Number/.test(R({ seller: Object.assign({}, seller, { bank: '', accNo: '', ifsc: '', bankBranch: '', upi: '' }) })));
ok('the five default terms from the brief (not the Tally paper terms)', h.includes('<li>Subject to Nagaur, Rajasthan jurisdiction.</li>') && h.includes('<li>Goods once sold are subject to the agreed terms and conditions.</li>') && !h.includes('Tally term one'));
ok('terms editable: cfg.terms replaces them', R({}, { terms: ['Custom one', 'Custom two'] }).includes('<li>Custom two</li>') && !R({}, { terms: ['Custom one'] }).includes('Subject to Nagaur'));
ok('authorisation block', h.includes('FOR DESHWALI MINERALS') && h.includes('Authorized Signatory') && h.includes('Digital Signature / Signature'));
ok('footer: registered address, phone verbatim, GSTIN, computer-generated line', h.includes('Registered Address: GROUND FLOOR, KALI TALAI, NEAR HAFIZ SAHAB KI DRAGHA, MERTA CITY, DISTRICT-NAGAUR') && h.includes('Phone: 8875020202, 9460767676') && h.includes('GSTIN: 08NLIPS9801K1Z5') && h.includes('This is a computer-generated invoice.'));
ok('footer omits segments the profile lacks (no dangling "Registered Address:")', !R({ seller: Object.assign({}, seller, { address: '', tel: '' }) }).includes('Registered Address:'));
ok('footer is fixed on print (repeats per page)', h.includes('@media print{.ft{position:fixed'));
ok('A4 standalone document', /^<!DOCTYPE html>/.test(h) && /@page\{size:A4/.test(h));
ok('buyer markup is escaped', R({ buyer: Object.assign({}, BASE.buyer, { name: '<script>alert(1)</script>' }) }).includes('&lt;script&gt;'));

/* wiring */
const shell = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8'), gal = fs.readFileSync(path.join(__dirname, 'invoice-designs.html'), 'utf8'), data = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
ok('renderInvoice feeds the firm\'s edited terms as cfg.terms', /const own = invoiceTerms\(\);/.test(shell) && /own\.length \? \{ terms: own \} : \{\}/.test(shell));
ok('QLShell exports invoiceTerms / setInvoiceTerms', /invoiceTemplate: invoiceTemplateId, invoiceTerms, setInvoiceTerms,/.test(shell));
ok('the Invoice Designs page has the terms editor', gal.includes('id="idTerms"') && gal.includes('function saveTerms()'));
ok('invoiceData passes the optional fields through (items gain their rate unit and a materialised taxable, nothing else changes)', /po: s\.po \|\| \(s\.qa && s\.qa\.po\) \|\| ''/.test(data) && /items: Array\.isArray\(s\.items\) \? s\.items\.map\(it => Object\.assign\(\{\}, it, \{ rateUnit: it\.rateUnit \|\| it\.unit \|\| '', taxable: /.test(data) && /export: s\.export \|\| null, spec: s\.spec \|\| null, qa: s\.qa \|\| null/.test(data));
console.log('\n═══ Deshwali Professional Industrial Invoice ═══\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' INDUSTRIAL TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
