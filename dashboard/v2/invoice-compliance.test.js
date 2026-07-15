/* invoice-compliance.test.js — the guardrail for the invoice design system.
 *
 * A template may look like anything. It may not DROP a legally required field.
 * Every template is rendered in both tax modes and checked against Rule 46 of the
 * CGST Rules. If someone adds a fifth design next year and forgets the place of
 * supply, this fails before it ever prints.
 *
 * The point is that the check is per-TEMPLATE, not per-engine: a shared helper
 * being correct proves nothing if a template forgets to CALL it.
 *
 *   node invoice-compliance.test.js
 */
'use strict';
const T = require('./invoice-templates.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ❌ ' + m); } };

/* Real-shaped data, deliberately awkward: a name with an ampersand (escaping),
   a big quantity (thousands separators), a 5% rate that halves to 2.50. */
const SALE = {
  seller: {
    name: 'GOTAN LIME INDUSTRIES', short: 'Gotan',
    address: 'TALANPUR ROAD, SH 86B, CHANDRA TYRE RETREADING GOTAN, DISTRICT-NAGAUR',
    gstin: '08BNAPM0488E1Z3', email: 'gotanlime@gmail.com', phone: '9829069545',
    bank: 'BANK OF BARODA MERTA CITY', ifsc: 'BARB0MERTAC', accNo: '33580500001254',
    bank2: 'HDFC BANK UMAID STADIUM', ifsc2: 'HDFC0001845', accNo2: '50200084904066'
  },
  buyer: { name: 'Shree Cement & Co.', gstin: '08AABCS1429B1ZW', address: 'Beawar, Rajasthan', state: 'Rajasthan (08)' },
  hsn: '25221000', inv: '235/2025-26', date: '2026-07-15',
  product: 'Quick Lime', qty: 10000, rate: 9.7, unit: 'Tonne',
  veh: 'RJ21GA1234', eway: '881234567890', gstR: 5,
  transport: 'By Road', station: 'GOTAN', grrr: 'GR-99',   // present in data, must NOT print
  taxable: 97000, cgst: 2425, sgst: 2425, igst: 0, interState: false,
  total: 101850, roundOff: 0, grand: 101850, words: 'Rupees One Lakh One Thousand Eight Hundred Fifty Only'
};
const INTER = Object.assign({}, SALE, {
  buyer: { name: 'Ambuja Cements Ltd', gstin: '27AAACG0569P1ZP', address: 'Mumbai', state: 'Maharashtra (27)' },
  cgst: 0, sgst: 0, igst: 4850, interState: true
});

/* Rule 46: what a tax invoice must carry. Each entry is [label, needle]. */
function required(d) {
  return [
    ['supplier name',      d.seller.name],
    ['supplier GSTIN',     d.seller.gstin],
    ['invoice number',     d.inv],
    ['invoice date',       '15-07-2026'],            // rendered dd-mm-yyyy, not the ISO input
    ['recipient name',     d.buyer.name.replace('&', '&amp;')],
    ['recipient GSTIN',    d.buyer.gstin],
    ['HSN code',           d.hsn],
    ['description',        d.product],
    ['quantity',           '10,000'],
    ['rate',               '9.70'],
    ['taxable value',      '97,000.00'],
    ['place of supply',    d.buyer.state],
    ['reverse charge',     'No'],
    ['total in words',     d.words],
    ['grand total',        '1,01,850.00']
  ];
}

console.log('\n═══ GST compliance · every template × both tax modes ═══\n');

for (const t of T.TEMPLATES) {
  for (const [mode, d] of [['intra', SALE], ['inter', INTER]]) {
    const html = T.render(d, { template: t.id });
    const label = t.id + '/' + mode;

    for (const [name, needle] of required(d)) {
      ok(html.includes(needle), label + ' — MISSING Rule 46 field: ' + name + ' (' + needle + ')');
    }

    /* The tax split is the field most likely to be WRONG rather than absent.
       Match the tax HEAD ("CGST @ 2.50 %", "CGST Amt.") — a bare /CGST/ also
       matches the statutory declaration "...under RULE 46 OF CGST RULE 2017",
       which is legal boilerplate present on every invoice in both modes. That
       false positive fired on all 4 templates and would have had me "fixing"
       correct code. */
    const HEAD = h => new RegExp(h + '\\s*(@|Amt\\.)');
    if (mode === 'intra') {
      ok(HEAD('CGST').test(html), label + ' — no CGST head');
      ok(HEAD('SGST').test(html), label + ' — no SGST head');
      ok(html.includes('2,425.00'), label + ' — CGST/SGST amount 2,425.00 missing');
      ok(!HEAD('IGST').test(html), label + ' — IGST charged on an INTRA-state invoice (wrong tax head)');
    } else {
      ok(HEAD('IGST').test(html), label + ' — no IGST head');
      ok(html.includes('4,850.00'), label + ' — IGST amount 4,850.00 missing');
      ok(!HEAD('CGST').test(html) && !HEAD('SGST').test(html), label + ' — CGST/SGST charged on an INTER-state invoice (wrong tax head)');
    }

    /* The quantity TOTAL, which must live in the grand-total line.
       A bare /10,000 Tonne/ passes even with the total deleted, because the line
       ITEM cell already reads "10,000 Tonne" — the assertion matched the row it
       was supposed to be distinguished from, and a mutation that removed the
       total entirely survived. Anchor to the totals line specifically. */
    ok(/(Grand Total|Grand total|Total)[^<]*·?\s*(&nbsp;)*\s*10,000 Tonne/.test(html),
      label + ' — quantity total "10,000 Tonne" is not in the grand-total line');
    ok(!/Transport|Station|GR\/RR/.test(html), label + ' — transport/station/GR-RR still printing (asked to be removed)');

    // Kept on purpose when transport went.
    ok(html.includes('RJ21GA1234'), label + ' — Vehicle No. lost (it was meant to stay)');
    ok(html.includes('881234567890'), label + ' — E-Way Bill lost (it was meant to stay)');

    // Never print a column the data cannot fill.
    ok(!/Disc\.|Discount/.test(html), label + ' — a Discount column is printing but no sale record has a discount');

    // Structure.
    ok(/^<!DOCTYPE html>/.test(html), label + ' — not a standalone document');
    ok(/@page\{size:A4/.test(html), label + ' — no A4 print rule');
  }
}

/* Escaping: a buyer named with an ampersand or a script tag must not break out. */
const xss = Object.assign({}, SALE, { buyer: { name: '<script>alert(1)</script>', gstin: '08X', address: '', state: 'X' } });
for (const t of T.TEMPLATES) {
  const html = T.render(xss, { template: t.id });
  ok(!html.includes('<script>alert(1)</script>'), t.id + ' — buyer name is injected UNESCAPED (XSS into the invoice)');
}

/* The default must remain the format Gotan already issues. Changing it silently
   restyles every future invoice — that is a decision for the user, not a deploy. */
ok(T.DEFAULT_CFG.template === 'classic', 'default template is no longer "classic" — this would restyle live invoices without anyone choosing it');
ok(T.TEMPLATES[0].id === 'classic', 'classic is no longer first in the gallery');

/* A QR that scans to nothing is worse than no QR. */
const noQr = T.render(SALE, { template: 'glass', showQR: true, qrData: '' });
ok(!/qrserver|Scan to pay/.test(noQr), 'a QR box renders with no data to encode — it would scan to nothing');
const yesQr = T.render(SALE, { template: 'glass', showQR: true, qrData: 'upi://pay?pa=gotan@sbi' });
ok(/Scan to pay/.test(yesQr), 'QR does not render when real UPI data IS supplied');

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
