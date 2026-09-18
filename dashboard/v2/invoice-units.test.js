/* invoice-units.test.js — the owner's example, end to end: a sale of 7,650 Kg
   priced ₹5,300 per Ton is ₹40,545 in the books, on every print design, in the
   GST split and at the e-way gate. Run:  node dashboard/v2/invoice-units.test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const U = require(path.join(__dirname, 'units-core.js'));
const T = require(path.join(__dirname, 'invoice-templates.js'));
const G = require(path.join(__dirname, 'gst-core.js'));
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };

/* the books: lift the real helpers out of data.js */
const dsrc = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
const grabLine = k => { const i = dsrc.indexOf(k); if (i < 0) throw new Error('not in data.js: ' + k); return dsrc.slice(i, dsrc.indexOf('\n', i)).trim(); };
const ctx = { console, Math, Object, Array, Number, isNaN, String, QLUnits: U };
vm.createContext(ctx);
vm.runInContext([grabLine('const saleTaxable = s =>'), grabLine('const saleTonnes = s =>'), grabLine('const saleGstRate = s =>'), grabLine('const cS = s =>'), 'this.saleTaxable = saleTaxable; this.saleTonnes = saleTonnes; this.cS = cS;'].join('\n'), ctx);

console.log('\n═══ the books (data.js) ═══');
const sale = { inv: '36', date: '2026-09-18', party: 'Test Buyer', qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Ton', gstR: 5, status: 'pending' };
ok('saleTaxable: 7,650 Kg @ ₹5,300/Ton = ₹40,545 (not ₹4,05,45,000)', ctx.saleTaxable(sale) === 40545);
const c = ctx.cS(sale);
ok('GST is computed AFTER the correct taxable: cgst 1,013.625 + sgst 1,013.625 = 2,027.25', Math.abs(c.cgst + c.sgst - 2027.25) < 1e-9);
ok('total 42,572.25', Math.abs(c.tot - 42572.25) < 1e-9);
ok('the same row without rateUnit (legacy) is per Kg — untouched history', ctx.saleTaxable({ qty: 7650, unit: 'Kg', rate: 5300 }) === 40545000);
ok('a Tonne row without rateUnit is exactly what it always was', ctx.saleTaxable({ qty: 16.16, unit: 'Tonne', rate: 4950 }) === 79992);
ok('saleTonnes: the Kg sale is 7.65 T for reports, a legacy blank-unit row is tonnes, a Bag row is 0', ctx.saleTonnes(sale) === 7.65 && ctx.saleTonnes({ qty: 30, rate: 1 }) === 30 && ctx.saleTonnes({ qty: 400, unit: 'Bag', rate: 1 }) === 0);
ok('multi-line: an item without taxable is priced through units-core, one with taxable is trusted', ctx.saleTaxable({ items: [{ qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Ton' }, { qty: 2, unit: 'Ton', rate: 5000, taxable: 10000 }] }) === 50545);

console.log('═══ the paper (every design) ═══');
const d = { seller: { name: 'DESHWALI MINERALS', address: 'Merta City', gstin: '08NLIPS9801K1Z5', tel: '8875020202', state: 'Rajasthan (08)' },
  buyer: { name: 'Test Buyer', gstin: '08BPLPS6684F1Z6', address: 'Borunda', state: 'Rajasthan (08)' },
  hsn: '25221000', inv: '36', date: '2026-09-18', product: 'Quick Lime', qty: 7650, unit: 'Kg', rate: 5300, rateUnit: 'Ton', billableQty: 7.65, billableUnit: 'Ton', gstR: 5,
  taxable: 40545, cgst: 1013.625, sgst: 1013.625, igst: 0, interState: false, total: 42572.25, roundOff: 0, grand: 42572.25, words: 'Rupees Forty Two Thousand Five Hundred Seventy Two and Paisa Twenty Five Only' };
for (const id of ['gst', 'modern', 'business', 'detailed', 'industrial']) {
  const h = T.render(d, { template: id });
  ok(id + ': prints the entered quantity 7,650 Kg', /7,650/.test(h) && /Kg/.test(h));
  ok(id + ': prints the amount 40,545.00 and never 4,05,45,000', /40,545\.00/.test(h) && !/4,05,45,000/.test(h));
  ok(id + ': the rate 5,300.00 is labelled per Ton somewhere on the line/header', /5,300\.00/.test(h) && /(per Ton|\/ *Ton|P\.Ton|\/Ton)/.test(h));
  ok(id + ': GST 2,027.25 / total 42,572.25 as given', /1,013\.63|2,027\.25/.test(h) && /42,572\.25/.test(h));
}
ok('gst design shows the arithmetic 7,650 Kg = 7.65 Ton × ₹5,300.00', /7,650 Kg = 7\.65 Ton × ₹5,300\.00/.test(T.render(d, { template: 'gst' })));
ok('a same-unit line prints no conversion note', !/= .* × ₹/.test(T.render(Object.assign({}, d, { unit: 'Ton', rateUnit: 'Ton', qty: 7.65, billableQty: 7.65 }), { template: 'gst' })));

console.log('═══ the e-way / e-invoice gate (gst-core) ═══');
const inv = { inv: '36', date: '2026-09-18', hsn: '25221000', unit: 'Kg', qty: 7650, rate: 5300, rateUnit: 'Ton', taxable: 40545, gstR: 5, total: 42572.25, buyer: { gstin: '08BPLPS6684F1Z6', state: 'Rajasthan (08)' }, seller: { gstin: '08NLIPS9801K1Z5', state: 'Rajasthan (08)' } };
const fnName = ['validateInvoice', 'validate', 'check', 'lint'].find(k => typeof G[k] === 'function');
if (fnName) {
  const res = G[fnName](inv, {});
  const issues = JSON.stringify(res);
  ok('gst-core (' + fnName + '): a Kg line priced per Ton is NOT flagged TAXABLE_MISMATCH', !/TAXABLE_MISMATCH/.test(issues));
  const bad = G[fnName](Object.assign({}, inv, { taxable: 40545000 }), {});
  ok('gst-core: the OLD wrong figure (7650 × 5300) IS flagged as a mismatch', /TAXABLE_MISMATCH/.test(JSON.stringify(bad)));
} else ok('gst-core exposes a validator (' + Object.keys(G).join(',') + ')', false);
if (typeof G.ewbRequired === 'function') { const e = G.ewbRequired(Object.assign({}, inv, { total: 0 }), { threshold: 50000 }); ok('ewbRequired falls back to the CORRECT line value (₹40,545 < ₹50,000 → not required)', e.value === 40545 && e.verdict !== 'REQUIRED'); }

console.log('═══ the form contract (invoice.js) ═══');
const isrc = fs.readFileSync(path.join(__dirname, 'invoice.js'), 'utf8');
ok('buildData prices through QLUnits.lineAmount, never qty * rate', /QLUnits\.lineAmount\(\{ qty, unit, rate, rateUnit \}\)/.test(isrc) && !/const taxable = qty \* rate/.test(isrc));
ok('the form has a Quantity unit and a Rate per select from the one vocabulary', /field\('i_unit', 'Quantity unit', \{ opts: QLUnits\.UNITS/.test(isrc) && /field\('i_rateUnit', 'Rate per', \{ opts: QLUnits\.UNITS/.test(isrc));
ok('save refuses a line the units cannot price', /if \(!d\.lineOk\) \{ toast\(d\.lineWhy, 'err'\)/.test(isrc));
ok('the saved sale carries unit and rateUnit', /rateUnit: d\.rateUnit, gstR: d\.gstR/.test(isrc));
ok('the live arithmetic line exists', /function showCalc\(\)/.test(isrc));
ok('every page loads units-core.js before data.js', fs.readdirSync(__dirname).filter(f => f.endsWith('.html') && /src="\.\/data\.js\?v=/.test(fs.readFileSync(path.join(__dirname, f), 'utf8'))).every(f => { const h = fs.readFileSync(path.join(__dirname, f), 'utf8'); return h.indexOf('units-core.js') > 0 && h.indexOf('units-core.js') < h.indexOf('src="./data.js?v='); }));

console.log('═══ the register edit form (shell.js) ═══');
const ssrc = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8');
ok('editing a legacy row opens with rateUnit = its own unit (saving untouched changes nothing)', /rateUnit: row\.rateUnit \|\| \(\(window\.QLUnits && row\.unit\)/.test(ssrc));
ok('a new invoice defaults to Ton / per Ton', /gstR: 5, unit: 'Ton', rateUnit: 'Ton' \}/.test(ssrc));
ok('the edit form refuses a line the units cannot price', /if \(!L\.ok\) \{ toast\(L\.why, 'err'\); return false; \}/.test(ssrc));
ok('SALE_SPECS carry Quantity unit and Rate per selects from the one vocabulary', /k: 'unit', label: 'Quantity unit'/.test(ssrc) && /k: 'rateUnit', label: 'Rate per'/.test(ssrc));

console.log('\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' INVOICE-UNIT TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
