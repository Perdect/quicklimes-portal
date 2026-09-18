/* invoice-gst-format.test.js — the "GST Invoice (print format)" design must
   reproduce the firm's real invoice, line for line.
   Run:  node dashboard/v2/invoice-gst-format.test.js     (no browser, no database)

   WHY THIS EXISTS
   The fixture below IS Deshwali Minerals' invoice no. 36 of 01-08-2026, copied
   from the paper the customer received: 16.16 Tonne of Quick Lime at 4,950.00,
   CGST and SGST at 2.50 %, Grand Total ₹83,991.60, "Rupees Eighty Three
   Thousand Nine Hundred Ninety One and Paisa Sixty Only". If the app cannot
   print THAT invoice from THAT data, the design is decoration. Every label,
   every value and the order they appear in are pinned here — including the two
   things the other designs never had to get right: paise in the words, and the
   Transport / Station / GR-RR block. */

const path = require('path');
const fs = require('fs');
const T = require(path.join(__dirname, 'invoice-templates.js'));

/* amountInWords lives inside data.js's closure; lift the function out by its
   source. It touches nothing but Math, so it runs as-is. */
const src = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
const w0 = src.indexOf('function amountInWords(n) {'), w1 = src.indexOf('\n  }', w0) + 4;
const amountInWords = new Function('return ' + src.slice(w0, w1))();

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };

/* ── the paper invoice ── */
const SALE = {
  seller: {
    name: 'DESHWALI MINERALS', short: 'Deshwali Minerals',
    address: 'GROUND FLOOR, KALI TALAI\nNEAR HAFIZ SAHAB KI DRAGHA, MERTA CITY, DISTRICT-NAGAUR',
    state: 'Rajasthan (08)', gstin: '08NLIPS9801K1Z5', phone: '9460767676', tel: '8875020202, 9460767676',
    product: 'Manufactures of Quick Lime and Hydrated Lime.', logo: '/v2/deshwali-logo.png', jurisdiction: 'MERTA CITY',
    bank: 'HDFC Bank', bankBranch: 'Merta City', accNo: '50200089605146', ifsc: 'HDFC0002670',
    terms: ['Goods once sold will not be taken back.',
            'Interest @ 18% p.a. will be charged if the payment is not made with in the 30days.',
            "Subject to 'MERTA CITY' Jurisdiction only."],
    roundOff: false
  },
  buyer: { name: 'Lekhraj Chemical Industries', gstin: '08BPLPS6684F1Z6',
           address: 'KHASRA NO 80/4/1, BORUNDA, TEH PIPAR CITY, Jodhpur, Rajasthan, 342604', state: 'Rajasthan (08)', phone: '', email: '' },
  hsn: '25221000', inv: '36', date: '2026-08-01', product: 'Quick Lime', qty: 16.16, rate: 4950, unit: 'Tonne',
  transport: 'Self', veh: 'RJ37GA1987', station: 'TEH PIPAR CITY', eway: '791656947547', grrr: '', gstR: 5,
  taxable: 79992, cgst: 1999.8, sgst: 1999.8, igst: 0, interState: false,
  total: 83991.6, roundOff: 0, grand: 83991.6, words: amountInWords(83991.6)
};

console.log('\n═══ GST Invoice (print format) × Deshwali invoice no. 36 ═══\n');

/* 1 ── the words, with paise — and whole rupees untouched */
ok('83,991.60 in words matches the paper exactly',
   SALE.words === 'Rupees Eighty Three Thousand Nine Hundred Ninety One and Paisa Sixty Only');
ok('a whole-rupee amount reads as it always did (no "and Paisa Zero")',
   amountInWords(101850) === 'Rupees One Lakh One Thousand Eight Hundred Fifty Only');
ok('binary float does not leak into the paise (0.1 + 0.2 territory)',
   amountInWords(1999.8 + 1999.8 + 79992) === SALE.words);
ok('a lone paisa amount still reads', amountInWords(0.05) === 'Rupees Zero and Paisa Five Only');

/* 2 ── the template is registered and declares its despatch block */
const tpl = T.TEMPLATES.find(t => t.id === 'gst');
ok('the gst template is registered', !!tpl);
ok('it declares despatch:true (Transport / Station / GR-RR print)', !!(tpl && tpl.despatch));
ok('gst is TEMPLATES[0] — the default and the fallback for an unknown id (classic retired 2026-09-12)', T.TEMPLATES[0].id === 'gst' && T.get('classic').id === 'gst');
ok('no template is named classic any more', !T.TEMPLATES.some(t => t.id === 'classic'));

const html = T.render(SALE, { template: 'gst' });
const has = (n, s) => ok(n + ' — "' + s + '"', html.includes(s));
const after = (n, a, b) => ok(n + ' — "' + a + '" comes before "' + b + '"', html.indexOf(a) > -1 && html.indexOf(b) > html.indexOf(a));

/* 3 ── header, top to bottom as printed */
has('title', 'GST INVOICE');
has('copy marker', 'Original Copy');
has('the logo', '/v2/deshwali-logo.png');
has('firm name', 'DESHWALI MINERALS');
has('GSTIN line', 'GSTIN : 08NLIPS9801K1Z5');
has('Tel. line with both numbers the owner asked for', 'Tel. : 8875020202, 9460767676');
ok('the seed in data.js carries the same Tel. line', /tel: '8875020202, 9460767676'/.test(src));
ok('the logo is an absolute URL when rendered in a browser (self-contained sheet)', (function () { global.location = { origin: 'https://app.quicklimes.com' }; const h = T.render(SALE, { template: 'gst' }); delete global.location; return h.includes('src="https://app.quicklimes.com/v2/deshwali-logo.png"'); })());
has('tagline', 'Manufactures of Quick Lime and Hydrated Lime.');
has('address breaks where the paper breaks it', 'GROUND FLOOR, KALI TALAI<br>NEAR HAFIZ SAHAB KI DRAGHA, MERTA CITY, DISTRICT-NAGAUR');
ok('the subtotal sits in the totals table under the rule, in the Amount column', /<tr class="st">(<td><\/td>){6}<td class="r amt">79,992\.00<\/td>/.test(html));
after('order', 'GST INVOICE', 'DESHWALI MINERALS');
after('order', 'GSTIN : 08NLIPS9801K1Z5', 'Tel. :');

/* 4 ── the despatch block, both columns */
for (const [k, v] of [['Invoice No.', '36'], ['Dated', '01-08-2026'], ['Place of Supply', 'Rajasthan (08)'], ['Reverse Charge', 'N'],
                      ['Transport', 'Self'], ['Vehicle No.', 'RJ37GA1987'], ['Station', 'TEH PIPAR CITY'], ['E-Way Bill No.', '791656947547']]) {
  const rx = s => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  ok('despatch: ' + k + ' : ' + v, new RegExp(rx(k) + '[\\s\\S]{0,120}>' + rx(v) + '<').test(html));
  ok('despatch: ' + k + ' : ' + v, new RegExp(rx(k) + '[\\s\\S]{0,120}>' + rx(v) + '<').test(html));
}
has('GR/RR No. label prints even when empty, as on paper', 'GR/RR No.');

/* 5 ── the parties, with the contact lines */
has('Billed to', 'Billed to');
has('Shipped to', 'Shipped to');
ok('the buyer appears twice (billed AND shipped)', html.split('Lekhraj Chemical Industries').length - 1 === 2);
has('buyer address', 'KHASRA NO 80/4/1, BORUNDA, TEH PIPAR CITY, Jodhpur, Rajasthan, 342604');
for (const k of ['Party E-Mail ID', 'Party Mobile No', 'State', 'GSTIN / UIN']) has('party line: ' + k, k);
ok('buyer State value', /State<\/span><span class="c">:<\/span><span class="v">Rajasthan \(08\)/.test(html));
has('buyer GSTIN', '08BPLPS6684F1Z6');

/* 6 ── the goods table */
for (const h of ['S.N.', 'Description of Goods', 'HSN/SAC', 'Qty.', 'Unit', 'Price', 'Amount(₹)']) has('column: ' + h, h);
has('HSN', '25221000');
has('quantity as typed, not as money', '>16.16<');
has('unit', '>Tonne<');
has('rate', '4,950.00');
ok('taxable 79,992.00 prints twice — the line and the column subtotal', html.split('79,992.00').length - 1 >= 2);

/* 7 ── taxes and the grand total */
has('CGST row', 'Add : CGST');
has('SGST row', 'Add : SGST');
ok('the rate sits in its own cell as "2.50 %"', /2\.50 %<\/td>/.test(html));
ok('each tax amount is 1,999.80', html.split('1,999.80').length - 1 >= 2);
has('Grand Total', 'Grand Total');
ok('the quantity total is the marked element, "16.16 Tonne"', /class="qtytot[^"]*">16\.16 Tonne</.test(html));
has('the grand total with paise', '83,991.60');
ok('no rupee-rounded 83,992 anywhere', !html.includes('83,992'));

/* 8 ── the HSN tax summary */
for (const h of ['Tax Rate', 'Taxable Amt.', 'CGST Amt.', 'SGST Amt.', 'Total Tax']) has('summary column: ' + h, h);
has('tax rate as "5%", not "5.00%"', '>5%<');
has('total tax 3,999.60', '3,999.60');
after('order', 'Grand Total', 'Tax Rate');

/* 9 ── words, bank, terms, signatures */
has('amount in words', SALE.words);
has('bank details, formatted as printed', 'HDFC BANK &amp; HDFC0002670 AC NO-50200089605146 MERTA CITY');
has('Terms &amp; Conditions heading', 'Terms &amp; Conditions');
has('E.&amp; O.E.', 'E.&amp; O.E.');
has('term 1', '1. Goods once sold will not be taken back.');
has('term 2', '2. Interest @ 18% p.a. will be charged if the payment is not made with in the 30days.');
has('term 3', "3. Subject to 'MERTA CITY' Jurisdiction only.");
ok('the Gotan MSME / Rule 46 boilerplate does NOT leak onto Deshwali\'s invoice', !/MSME|RULE 46/.test(html));
has("Receiver's Signature", "Receiver's Signature");
has('for DESHWALI MINERALS', 'for DESHWALI MINERALS');
has('Authorised Signatory', 'Authorised Signatory');
after('order', SALE.words, 'Bank Details');
after('order', 'Bank Details', 'Terms &amp; Conditions');
after('order', "Receiver's Signature", 'Authorised Signatory');

/* 10 ── alignment is structural: the tax rows and the Grand Total reuse the goods
       table's colgroup, so the amounts cannot drift from the Amount column */
ok('three tables share one 7-column colgroup (goods, taxes+total)',
   (html.match(/<colgroup><col style="width:34px">/g) || []).length === 2);
ok('the Amount column keeps its left rule through subtotal, tax rows and total', (html.match(/class="r amt"/g) || []).length === 4);

/* 10b ── the live preview must be a standards-mode document.
   A src-less iframe is about:blank = quirks mode, where tables ignore the
   inherited font size and render at 16px: the goods table came out huge in the
   GST Invoice preview (seen 12-09-2026) while the printed sheet was right. The
   page must load the first paint through srcdoc (doctype) and patch in place
   only a CSS1Compat document; the template also asks tables to inherit. */
const invPage = fs.readFileSync(path.join(__dirname, 'invoice.js'), 'utf8');
ok('invoice.js patches the preview in place ONLY when compatMode is CSS1Compat', /doc\.compatMode === 'CSS1Compat'/.test(invPage));
ok('the template makes tables inherit font-size (quirks-proof)', html.includes('font-size:inherit;font-family:inherit'));

/* 10c ── the unit (kiln) address, on every bill, next to the registered one */
const xu = T.render(Object.assign({}, SALE, { seller: Object.assign({}, SALE.seller, { unitAddress: 'Khasra No.1787/7, Borunda, Jodhpur, Rajasthan, 342601' }) }), { template: 'gst' });
ok('gst: REGD. ADDRESS and UNIT ADDRESS strip when the firm has a unit address', xu.includes('<b>REGD. ADDRESS</b> : GROUND FLOOR, KALI TALAI, NEAR HAFIZ SAHAB KI DRAGHA, MERTA CITY, DISTRICT-NAGAUR<br><b>UNIT ADDRESS</b> : Khasra No.1787/7, Borunda, Jodhpur, Rajasthan, 342601'));
ok('gst: no strip for a firm without one (the paper stays as it is)', !html.includes('UNIT ADDRESS') && !html.includes('REGD. ADDRESS'));
ok('the seed carries the registered office the owner gave on 18-09-2026 (with the State, jurisdiction Rajasthan)', /address: 'Near Dharam Kanta Gotan Road, Borunda 342604, Rajasthan',\n\s+state: 'Rajasthan \(08\)', pin: '342604'/.test(src) && !/KALI TALAI/.test(src) && /jurisdiction: 'RAJASTHAN'/.test(src) && /Jurisdiction: All disputes shall be subject to the exclusive jurisdiction of courts in Rajasthan, India\./.test(src) && /Goods once sold will not be taken back or exchanged\./.test(src) && /Payment Terms: Payment must be made within 30 days/.test(src) && /Acceptance: Placement of an order/.test(src) && (src.match(/Jurisdiction: All disputes/g) || []).length === 1);
ok('the seed says Manufacturer & Exporter of Premium Quick Lime and Hydrated Lime (owner, 18-09-2026)', /product: 'Manufacturer & Exporter of Premium Quick Lime and Hydrated Lime'/.test(src));
ok('the seed carries the stamp line and the website the Premium design prints', /sealText: 'BORUNDA, GOTAN', website: 'www\.deshwaliminerals\.com'/.test(src) && /sealText: seller\.sealText \|\| '', website: seller\.website \|\| '', logoMark: seller\.logoMark \|\| ''/.test(src) && /logoMark: 'gem'/.test(src) && /lockup: '\/v2\/deshwali-lockup\.svg\?v=1'/.test(src) && /lockup: seller\.lockup \|\| ''/.test(src));
ok('the seed carries NO unit address (strip removed at the owner\'s request, 18-09-2026)', /unitAddress: ''/.test(src) && !/Khasra No\.1787/.test(src));

/* 11 ── a firm with no tel / terms of its own still renders (Gotan through this design) */
const GOTAN = Object.assign({}, SALE, { seller: { name: 'GOTAN LIME INDUSTRIES', gstin: '08BNAPM0488E1Z3', phone: '9460767676', msme: 'UDYAM-RJ -25-0061325', address: 'GOTAN', bank: 'BANK OF BARODA', ifsc: 'BARB0MERTAC', accNo: '33580500001254', bankBranch: 'MERTA CITY' } });
const g = T.render(GOTAN, { template: 'gst' });
ok('no tel → the profile phone prints as Tel.', g.includes('Tel. : 9460767676'));
ok('no terms → the MSME line and the statutory clauses print', g.includes('REGISTERED IN MSME NO.') && g.includes('RULE 46'));

console.log('  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' PRINT-FORMAT TESTS PASSED — invoice no. 36 reproduces from its data\n'
                       : '\n❌ ' + fail + ' FAILED — the print does not match the paper\n');
process.exit(fail === 0 ? 0 : 1);
