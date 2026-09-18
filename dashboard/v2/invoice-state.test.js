/* GST Invoice page — the buyer's State and the Place of supply are facts read
   off the GSTIN, not the seller's pre-fill. On 18-09-2026 a Maharashtra buyer
   (27CMVPC2808M1ZK) printed "State: Rajasthan (08) · Place of supply: Rajasthan
   (08)" under IGST because buildData read the State box as typed and never read
   the Place of supply box at all. These run the page's real buildData/setState
   over a stub DOM. */
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0; const bad = [];
const ok = (n, c) => { if (c) pass++; else { fail++; bad.push(n); } };

const src = fs.readFileSync(path.join(__dirname, 'invoice.js'), 'utf8');
const dsrc = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
const lift = (s, start, endRe) => { const i = s.indexOf(start); if (i < 0) throw new Error('missing ' + start); const m = s.slice(i).match(endRe); return s.slice(i, i + m.index + m[0].length); };
const fn = (s, name) => lift(s, 'function ' + name + '(', /\n}\n/);
const blk = (s, start) => lift(s, start, /\n  }\n/);

/* data.js: the GST state table + reconcileState/stateOfGstin, as the page gets them from QLD */
const dctx = { console }; vm.createContext(dctx);
vm.runInContext(dsrc.slice(dsrc.indexOf('  const GST_STATES = {'), dsrc.indexOf('  function partyPhone(name)')) + '\nthis.reconcileState = reconcileState; this.stateOfGstin = stateOfGstin; this.cleanGstin = cleanGstin; this.stateCanon = stateCanon; this.stateCode = stateCode;', dctx);

/* a stub DOM: every field is an object with a .value */
function page(fields) {
  const els = {}; Object.keys(fields).forEach(k => { els[k] = { value: fields[k] }; });
  const ctx = {
    console, document: { getElementById: id => els[id] || null },
    QLUnits: require('./units-core.js'),
    Q: { co: { state: 'Rajasthan (08)', gstin: '08NLIPS9801K1Z5', roundOff: false }, reconcileState: dctx.reconcileState, stateOfGstin: dctx.stateOfGstin, stateCanon: dctx.stateCanon, stateCode: dctx.stateCode, amountInWords: n => 'Rupees ' + n + ' Only' },
    QLShell: {}, els
  };
  vm.createContext(ctx);
  vm.runInContext("const g = id => (document.getElementById(id) || {}).value || '';\n" + fn(src, 'buildData') + '\n' + src.slice(src.indexOf('let _lastBState = '), src.indexOf('let _gstinSeq = 0;')) + '\nthis.buildData = buildData; this.setState = setState;', ctx);
  return ctx;
}
const base = { i_qty: '42', i_rate: '5500', i_unit: 'Ton', i_rateUnit: 'Ton', i_gst: '5', i_bname: 'Balaji Buildcon and Suppliers', i_baddr: 'Sangli, MAHARASHTRA 416415', i_no: '4/2026-27', i_date: '2026-09-18', i_bphone: '', i_bstate: 'Rajasthan (08)', i_pos: 'Rajasthan (08)' };

console.log('\n═══ GST Invoice page · buyer State and Place of supply are GSTIN-first ═══');
let p = page(Object.assign({}, base, { i_bgst: '27CMVPC2808M1ZK' })), d = p.buildData();
ok('the 18-09-2026 case: Maharashtra GSTIN with the seller pre-fill still in the State box → State Maharashtra (27)', d.buyer.state === 'Maharashtra (27)');
ok('…and Place of supply Maharashtra (27), not the seller\'s own state, on an IGST invoice', d.pos === 'Maharashtra (27)' && d.interState === true && d.igst === 11550 && d.cgst === 5775);
ok('the GSTIN prints clean (no spaces) and the arithmetic is unchanged (42 × 5,500 = 2,31,000; grand 2,42,550)', d.buyer.gstin === '27CMVPC2808M1ZK' && d.taxable === 231000 && d.grand === 242550);

p = page(Object.assign({}, base, { i_bgst: '27CMVPC2808M1ZK', i_pos: 'Gujarat (24)' })); d = p.buildData();
ok('a Place of supply the user pointed elsewhere (ship-to Gujarat) is respected', d.pos === 'Gujarat (24)' && d.buyer.state === 'Maharashtra (27)');

p = page(Object.assign({}, base, { i_bgst: '08BPLPS6684F1Z6' })); d = p.buildData();
ok('a Rajasthan buyer keeps Rajasthan (08) for both, CGST/SGST', d.buyer.state === 'Rajasthan (08)' && d.pos === 'Rajasthan (08)' && d.interState === false && d.igst === 0);

p = page(Object.assign({}, base, { i_bgst: '', i_bstate: 'Gujarat (24)', i_pos: '' })); d = p.buildData();
ok('an unregistered buyer (no GSTIN): the typed State stands and an empty Place of supply follows it', d.buyer.state === 'Gujarat (24)' && d.pos === 'Gujarat (24)');

p = page(Object.assign({}, base, { i_bgst: '27CMVPC2808M1ZK', i_bstate: '', i_pos: '' })); d = p.buildData();
ok('blank boxes: both come from the GSTIN', d.buyer.state === 'Maharashtra (27)' && d.pos === 'Maharashtra (27)');

/* 18-09-2026, second case: an Odisha buyer (21AFTPJ3586N1ZT) printed
   'Place of supply: Rajasthan' — the box held 'Rajasthan' typed without the
   code, which the text comparison did not recognise as the seller's own state */
p = page(Object.assign({}, base, { i_bgst: '21AFTPJ3586N1ZT', i_bstate: 'Rajasthan (08)', i_pos: 'Rajasthan' })); d = p.buildData();
ok('the Durga Fly Ash case: "Rajasthan" typed without the code is still the seller\'s state → Place of supply Odisha (21)', d.buyer.state === 'Odisha (21)' && d.pos === 'Odisha (21)' && d.interState === true);
p = page(Object.assign({}, base, { i_bgst: '21AFTPJ3586N1ZT', i_pos: 'orissa' })); d = p.buildData();
ok('a state typed by name or old name is printed canonically: "orissa" → Odisha (21)', d.pos === 'Odisha (21)');
p = page(Object.assign({}, base, { i_bgst: '21AFTPJ3586N1ZT', i_pos: 'gujarat' })); d = p.buildData();
ok('a different state typed by name (ship-to) is respected and canonicalised: "gujarat" → Gujarat (24)', d.pos === 'Gujarat (24)');
p = page(Object.assign({}, base, { i_bgst: '08BPLPS6684F1Z6', i_pos: 'Rajasthan' })); d = p.buildData();
ok('a Rajasthan buyer with "Rajasthan" typed prints Rajasthan (08) — CGST/SGST', d.pos === 'Rajasthan (08)' && d.interState === false);
p = page(Object.assign({}, base, { i_bgst: '21AFTPJ3586N1ZT', i_pos: 'Site 4, Sambalpur yard' })); d = p.buildData();
ok('text that is not a state is kept as typed (the user\'s call)', d.pos === 'Site 4, Sambalpur yard');
ok('stateCanon: codes, names, aliases, garbage', dctx.stateCanon('08') === 'Rajasthan (08)' && dctx.stateCanon('rajasthan (08)') === 'Rajasthan (08)' && dctx.stateCanon(' West  Bengal ') === 'West Bengal (19)' && dctx.stateCanon('Pondicherry') === 'Puducherry (34)' && dctx.stateCanon('Mars') === '' && dctx.stateCanon('') === '' && dctx.stateCode('Odisha') === '21');

/* setState — what the GSTIN assist / party pick / deep link call: State box set,
   Place of supply follows while it is still the pre-fill or the previous state */
p = page(Object.assign({}, base, { i_bgst: '27CMVPC2808M1ZK' }));
p.setState('Maharashtra (27)');
ok('setState moves the pre-filled Place of supply along with the State', p.els.i_bstate.value === 'Maharashtra (27)' && p.els.i_pos.value === 'Maharashtra (27)');
p = page(Object.assign({}, base, { i_bgst: '21AFTPJ3586N1ZT', i_pos: 'rajasthan' })); p.setState('Odisha (21)');
ok('setState treats "rajasthan" typed without the code as the pre-fill and moves it', p.els.i_pos.value === 'Odisha (21)');
p.els.i_pos.value = 'Gujarat (24)'; p.setState('Karnataka (29)');
ok('…but leaves a Place of supply the user changed by hand', p.els.i_bstate.value === 'Karnataka (29)' && p.els.i_pos.value === 'Gujarat (24)');
p.els.i_pos.value = 'Karnataka (29)'; p.setState('Delhi (07)');
ok('…and follows again once it equals the previous State', p.els.i_pos.value === 'Delhi (07)');
p.setState('');
ok('an empty value is ignored', p.els.i_bstate.value === 'Delhi (07)');

/* the page's own wiring, pinned in the source */
ok('the party-pick by name and the ?party= deep link set the State through reconcileState, not the record as stored', (src.match(/setState\(Q\.reconcileState\(p\.state, p\.gstin\)/g) || []).length === 2);
ok('the GSTIN assist sets the State through setState (so Place of supply follows)', /if \(r\.state\) setState\(r\.state\);/.test(src));
ok('a hand-typed State also moves the Place of supply', /if \(e\.target\.id === 'i_bstate'\) setState\(e\.target\.value\);/.test(src));
ok('buildData passes pos and the templates print d.pos first', /^\s*pos,$/m.test(src) && /pos: \(String\(d\.type \|\| ''\)\.toLowerCase\(\) === 'export'\) \? [^:]+: \(d\.pos \|\| b\.state \|\| s\.state \|\| ''\)/.test(fs.readFileSync(path.join(__dirname, 'invoice-templates.js'), 'utf8')));

/* the rendered document, end to end through the Premium design */
const T = require('./invoice-templates.js');
p = page(Object.assign({}, base, { i_bgst: '27CMVPC2808M1ZK' })); d = p.buildData();
d.seller = { name: 'DESHWALI MINERALS', address: 'Near Dharam Kanta Gotan Road, Borunda 342604, Rajasthan', state: 'Rajasthan (08)', pin: '342604', gstin: '08NLIPS9801K1Z5', terms: [] };
const h = T.render(d, { template: 'premium' }), t = h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
ok('Premium prints State: Maharashtra (27) and Place of supply Maharashtra (27) for the Sangli buyer — no Rajasthan on the buyer side', /GSTIN:\s*27CMVPC2808M1ZK\s*State:\s*Maharashtra \(27\)/.test(t) && /Place of supply\s*Maharashtra \(27\)/.test(t) && !/Sangli[^|]*Rajasthan/.test(t));
ok('…and the address breaks as "Sangli" / "Maharashtra – 416415, India" (the state name is not repeated)', /class="ad">Sangli\nMaharashtra – 416415, India</.test(h));
ok('every block on the same left and right edge — party boxes and bank/declaration boxes are no longer inset', /\.par\{[^}]*margin:0 0 12px\}/.test(h) && /\.two\{[^}]*margin:12px 0 0\}/.test(h));

console.log('\n  Passed: ' + pass + '   Failed: ' + fail); bad.forEach(n => console.log('    ✗ ' + n));
console.log(fail ? '\n❌ ' + fail + ' FAILED' : '\n✅ ALL ' + pass + ' INVOICE-STATE TESTS PASSED');
process.exit(fail ? 1 : 0);
