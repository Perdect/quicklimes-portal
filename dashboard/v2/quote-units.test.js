/* quote-units.test.js — the Customer 360° module prices a quantity the way
   the GST invoice does: through units-core, never qty × rate.

   The bug this pins: a quotation line of 7,650 Kg at ₹5,300 / Ton used to
   total ₹4,05,45,000. It is ₹40,545 (7.65 Ton × ₹5,300), plus GST — on the
   quotation, on the printed document, on the offer, on the deal, in the
   WhatsApp text and on the public /api/quote page, which is server-rendered
   and must therefore load units-core.js before customer-core.js.

   Run: node quote-units.test.js */
'use strict';
const fs = require('fs'), path = require('path');
const C = require('./customer-core.js');
const D = require('./quote-doc.js');
const U = require('./units-core.js');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b));
const R = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const bare = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ── 1. a quotation of 7,650 Kg @ ₹5,300 / Ton ── */
{
  const q = { no: 'QT-2001', date: '2026-09-18', validUntil: '2026-09-25', gstR: 5, items: [{ product: 'Quick Lime', qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Ton', discount: 0 }] };
  const t = C.quoteTotals(q);
  eq('goods = 7.65 Ton × ₹5,300 = 40,545', t.goods, 40545);
  eq('taxable 40,545 · GST 5% 2,027.25 · total 42,572.25', [t.taxable, t.gst, t.total], [40545, 2027.25, 42572.25]);
  eq('the line knows what it billed', [t.lines[0].qty, t.lines[0].unit, t.lines[0].billableQty, t.lines[0].billableUnit, t.lines[0].rateUnit, t.lines[0].amount], [7650, 'Kg', 7.65, 'Ton', 'Ton', 40545]);
  eq('tonnage counts the Kg line as 7.65 Ton', t.tonnes, 7.65);
  ok('the quotation is priceable', t.ok === true && t.why === '');
  /* the same line with a per-Ton rate stated only by default (no rateUnit) */
  eq('a stored Kg line with no rateUnit is priced per its own unit — as booked, the register rule (7,650 × 5,300)', C.quoteTotals({ items: [{ qty: 7650, unit: 'Kg', rate: 5300 }] }).goods, 40545000);
  /* freight and charges still add on top, GST on the lot */
  const t2 = C.quoteTotals(Object.assign({}, q, { freight: 1000 }));
  eq('freight adds to the taxable value', [t2.taxable, t2.total], [41545, 43622.25]);
}

/* ── 2. a legacy quotation: unit 'MT', no rateUnit — unchanged ── */
{
  const legacy = { items: [{ product: 'Quick Lime', qty: 42, unit: 'MT', rate: 4900 }], freight: 12600, loading: 2100, gstR: 5 };
  const t = C.quoteTotals(legacy);
  eq('42 MT × ₹4,900 = 2,05,800 exactly as booked', t.goods, 205800);
  eq('taxable and total unchanged', [t.taxable, t.gst, t.total], [220500, 11025, 231525]);
  eq('tonnes 42', t.tonnes, 42);
  eq('the line reads MT as a tonne and prices per Ton', [t.lines[0].unit, t.lines[0].rateUnit, t.lines[0].billableQty], ['Ton', 'Ton', 42]);
  eq('legacy KG / BAG spellings fold onto the canonical keys', [C.unitKey('KG'), C.unitKey('BAG'), C.unitKey('MT'), C.unitKey('Tonne')], ['Kg', 'Bag', 'Ton', 'Ton']);
  eq('a legacy Bag line prices per Bag (its own unit), not per Ton', [C.quoteTotals({ items: [{ qty: 400, unit: 'BAG', rate: 120 }] }).goods, C.rateUnitOf('BAG', '')], [48000, 'Bag']);
}

/* ── 3. offer and deal values follow lineAmount ── */
{
  const L = C.priceLine(7650, 'Kg', 5300, 'Ton');
  eq('an offer of 7,650 Kg at ₹5,300 / Ton is worth 40,545', [L.ok, L.amount], [true, 40545]);
  eq('a deal of 7,650 Kg at a ₹5,300 / Ton target is worth 40,545', C.dealValue({ qty: 7650, unit: 'Kg', targetRate: 5300, rateUnit: 'Ton' }), 40545);
  eq('a legacy deal (qty 42, no unit) is 42 × 4,900', C.dealValue({ qty: 42, targetRate: 4900 }), 205800);
  eq('an explicit deal value still wins', C.dealValue({ qty: 7650, unit: 'Kg', targetRate: 5300, rateUnit: 'Ton', value: 40000 }), 40000);
  eq('a per-Ton rate on Bags: the deal value is unknown, not 400 × 5,300', C.dealValue({ qty: 400, unit: 'Bag', targetRate: 5300, rateUnit: 'Ton' }), null);
  const bad = C.priceLine(400, 'Bag', 5300, 'Ton');
  ok('  and priceLine says why', bad.ok === false && /cannot price/.test(bad.why));
  const s = C.pipelineSummary([{ stage: 'quote_sent', qty: 7650, unit: 'Kg', targetRate: 5300, rateUnit: 'Ton' }, { stage: 'negotiation', qty: 400, unit: 'Bag', targetRate: 5300, rateUnit: 'Ton' }]);
  eq('the pipeline sums 40,545 and counts the unpriceable deal as unvalued', [s.gross, s.unvalued], [40545, 1]);
  /* the WhatsApp text says the rate per its unit and the quantity with its unit */
  const vars = C.templateVars({ customer: { name: 'Balaji' }, offer: { product: 'Quick Lime', qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Ton' }, company: { short: 'Deshwali' } });
  eq('template vars carry rate_unit', [vars.rate, vars.rate_unit, vars.quantity, vars.unit], ['5,300', 'Ton', 7650, 'Kg']);
  ok('the offer template reads "₹5,300/Ton for 7650 Kg"', /₹5,300\/Ton for 7650 Kg/.test(C.fillTemplate(C.DEFAULT_TEMPLATES[0].body, vars)));
  ok('no default template still hard-codes /MT', C.DEFAULT_TEMPLATES.every(t => !/\/MT/.test(t.body)));
}

/* ── 4. the quotation document prints the entered quantity, the rate per its unit, the priced amount ── */
{
  const q = { no: 'QT-2001', date: '2026-09-18', validUntil: '2026-09-25', gstR: 5, items: [{ product: 'Quick Lime', qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Ton' }] };
  const html = D.quotationHTML(q, { name: 'Balaji Buildcon', city: 'Jodhpur' }, { name: 'Deshwali Minerals' }, {});
  ok('prints "7,650 Kg"', html.includes('7,650 Kg'));
  ok('prints "₹5,300.00 / Ton"', html.includes('₹5,300.00 / Ton'));
  ok('prints "40,545.00"', html.includes('40,545.00'));
  ok('prints the one arithmetic line "7,650 Kg = 7.65 Ton × ₹5,300"', html.includes('7,650 Kg = 7.65 Ton × ₹5,300'));
  ok('never prints the raw product', !html.includes('4,05,45,000') && !html.includes('40,545,000'));
  ok('GST and total follow', html.includes('2,027.25') && html.includes('42,572.25'));
  /* a Ton line has nothing to convert: no arithmetic line */
  const plain = D.quotationHTML({ no: 'QT-2002', date: '2026-09-18', validUntil: '2026-09-25', gstR: 5, items: [{ product: 'Quick Lime', qty: 42, unit: 'Ton', rate: 4900, rateUnit: 'Ton' }] }, {}, {}, {});
  ok('a Ton line prints "42 Ton" and "₹4,900.00 / Ton" with no conversion line', plain.includes('42 Ton') && plain.includes('₹4,900.00 / Ton') && !plain.includes('qd-conv'));
  ok('a legacy MT line prints as Ton', D.quotationHTML({ items: [{ product: 'Quick Lime', qty: 42, unit: 'MT', rate: 4900 }] }, {}, {}, {}).includes('42 Ton'));
  /* the price offer card */
  const offer = D.offerHTML({ no: 'PO-9', date: '2026-09-18', product: 'Quick Lime', qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Ton', freight: 'extra' }, { name: 'Balaji' }, { name: 'Deshwali' });
  ok('the offer prints "7,650 Kg", "₹5,300.00 / Ton" and the value 40,545.00', offer.includes('7,650 Kg') && offer.includes('₹5,300.00 / Ton') && offer.includes('40,545.00'));
  ok('the offer headline rate is per Ton', /<small>\/ Ton<\/small>/.test(offer));
}

/* ── 5. wiring: the public quotation page loads units-core first; no raw qty × rate survives ── */
{
  const api = R('../api/quote.php');
  const i = api.indexOf('/v2/units-core.js'), j = api.indexOf('/v2/customer-core.js'), k = api.indexOf('/v2/quote-doc.js');
  ok('quote.php loads units-core.js before customer-core.js before quote-doc.js', i > 0 && j > i && k > j);
  ok('  and asks for the new bundles (?v=cu3 on all three)', (api.match(/\?v=cu3/g) || []).length === 3 && !/\?v=cu2/.test(api));
  for (const f of ['customer-core.js', 'customer-store.js', 'customers.js', 'crm-ui.js', 'customer.js', 'quote-doc.js']) {
    const src = bare(R(f));
    ok(f + ' never multiplies a quantity by a rate itself', !/qty\s*\|\|\s*0\)\s*\*|\bqty\s*\*\s*\(?\s*\+?\s*[a-z.]*rate|\.qty\s*\*\s*/i.test(src));
  }
  for (const f of ['customers.html', 'customer.html']) {
    const html = R(f);
    ok(f + ' loads units-core.js before customer-core.js', html.indexOf('units-core.js') > 0 && html.indexOf('units-core.js') < html.indexOf('customer-core.js'));
  }
  const ui = bare(R('crm-ui.js'));
  ok('every CRM form that captures qty + rate has a Quantity unit and a Rate per select', (ui.match(/unitSpec\('unit'/g) || []).length >= 4 && (ui.match(/rateUnitSpec\('rateUnit'/g) || []).length >= 4);
  ok('  the quotation editor has a rate-unit select per line', /data-f="rateUnit"/.test(ui) && /<th>Rate per<\/th>/.test(ui));
  ok('  the forms refuse a rate that cannot price the quantity', (ui.match(/unitsProblem\(/g) || []).length >= 5 && /quoteTotals\(v\); if \(!tt\.ok\)/.test(ui));
  ok('  Rate per follows the quantity unit through QLUnits.defaultRateUnit', /UN\.defaultRateUnit\(u\.value\)/.test(ui));
  ok('units-core UNITS is the CRM vocabulary', JSON.stringify(C.UNITS.map(u => u[0])) === JSON.stringify(U.UNITS.map(u => u.key)));
}

/* ── 6. PIN: one legacy rule for stored rows, one default for new form lines ──
   data.js prices a record with NO rateUnit per its OWN unit (a copy of a legacy
   row passes rateUnit '' so it prices like the original). customer-core must
   read stored rows the same way — a stored quote line {7650 Kg @ 5300} with
   no rateUnit is 40,545,000 as booked — while a line a FORM creates through
   the store is stamped with the business default (Kg → per Ton) and prices
   as 40,545. Two conventions on one record would show two totals. */
{
  const stored = { items: [{ product: 'Quick Lime', qty: 7650, unit: 'Kg', rate: 5300 }], gstR: 5 };
  const t = C.quoteTotals(stored);
  eq('PIN stored line, no rateUnit: priced per Kg, 40,545,000 as booked', [t.lines[0].rateUnit, t.lines[0].billableQty, t.lines[0].billableUnit, t.goods], ['Kg', 7650, 'Kg', 40545000]);
  eq('  rateUnitOf reads blank as the row\'s own unit for every family', [C.rateUnitOf('Kg', ''), C.rateUnitOf('Quintal'), C.rateUnitOf('Bag', ''), C.rateUnitOf('MT', ''), C.rateUnitOf('', '')], ['Kg', 'Quintal', 'Bag', 'Ton', 'Ton']);
  eq('  an explicit rateUnit still wins', [C.rateUnitOf('Kg', 'Ton'), C.rateUnitOf('Kg', 'MT'), C.newRateUnit('Kg', 'Kg')], ['Ton', 'Ton', 'Kg']);
  eq('  newRateUnit (a form\'s new line) gets the business default', [C.newRateUnit('Kg', ''), C.newRateUnit('Quintal'), C.newRateUnit('Bag', ''), C.newRateUnit('Ton', '')], ['Ton', 'Ton', 'Bag', 'Ton']);
  eq('  a stored Kg deal with no rateUnit is valued as booked; the same deal at ₹5,300 / Ton is 40,545', [C.dealValue({ qty: 7650, unit: 'Kg', targetRate: 5300 }), C.dealValue({ qty: 7650, unit: 'Kg', targetRate: 5300, rateUnit: 'Ton' })], [40545000, 40545]);
  ok('  the stored line prints "₹5,300.00 / Kg" — what it was booked at, not a re-priced /Ton', C.fmtRate(5300, '', 'Kg') === '₹5,300.00 / Kg' && C.fmtRate(5300, 'Ton', 'Kg') === '₹5,300.00 / Ton');
  const src = bare(R('customer-store.js'));
  ok('the store stamps NEW lines through C.newRateUnit and reads stored ones through C.rateUnitOf', /out\.rateUnit = C\.newRateUnit\(out\.unit, out\.rateUnit\)/.test(src) && /rateUnit: C\.rateUnitOf\(r\.unit, r\.rateUnit\)/.test(src));
  ok('  updateReq / updateDeal merge onto the record AS STORED so an edit never re-prices a legacy line', (src.match(/withUnits\(Object\.assign\(asStored\(/g) || []).length === 2);
}

console.log('\n═══ quote-units ═══');
fails.forEach(f => console.log('  ❌ ' + f));
console.log((fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
