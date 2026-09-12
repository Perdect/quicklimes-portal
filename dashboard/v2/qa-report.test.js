/* qa-report.test.js — the certificate of analysis prints what the lab reported, and nothing else.
   Run:  node dashboard/v2/qa-report.test.js

   WHY THIS EXISTS
   12-09-2026: "I also want to like that quality analysis report option" — a
   supplier's Burnt Lime analysis report on its letterhead. The fixture below IS
   that report's content. The two rules that matter: only parameters with a
   result print (a blank row on a certificate reads as a hidden failure), and
   with no results at all the renderer returns '' so the app opens the form
   instead of printing an empty certificate. Wiring is pinned so the report is
   reachable from the Sales Register row menu and the invoice tab. */
const fs = require('fs'), path = require('path');
const T = require(path.join(__dirname, 'invoice-templates.js'));
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const D = { seller: { name: 'DESHWALI MINERALS', short: 'Deshwali Minerals', product: 'Manufactures of Quick Lime and Hydrated Lime.', logo: '/v2/deshwali-logo.png', tel: '8875020202, 9460767676', email: 'deshwaliminerals@gmail.com', address: 'GROUND FLOOR, KALI TALAI\nNEAR HAFIZ SAHAB KI DRAGHA, MERTA CITY, DISTRICT-NAGAUR' },
  buyer: { name: 'Rashmi Green Hydrogen Steel Pvt. Ltd.', address: 'Khatranga, Changual, Gopinathpur, Kharagpur – 721301, Dist.: Paschim Mednipur (W.B.)' },
  inv: 'RCMPL/26-27/1369', date: '2026-09-02', veh: 'RJ01GE5906', product: 'Burnt Lime 0-3 MM', title: 'Burnt Lime 0-3 MM Analysis Report',
  params: [{ label: 'CaO', value: '86.71', unit: '%' }, { label: 'SiO2', value: '1.5', unit: '%' }, { label: 'LOI', value: '4', unit: '%' }, { label: 'Reactivity', value: '300', unit: '' }, { label: 'MgO', value: '', unit: '%' }],
  chemist: '', reportDate: '2026-09-02', po: '4100004169', poDate: '2026-08-19', remarks: '' };
const h = T.qaReport(D, {});
const has = (n, s) => ok(n + ' — "' + s + '"', h.includes(s));
ok('qaReport is exported and NOT an invoice template', typeof T.qaReport === 'function' && !T.TEMPLATES.some(t => t.id === 'qa'));
has('letterhead: firm name', 'DESHWALI MINERALS'); has('letterhead: tagline', 'Manufactures of Quick Lime and Hydrated Lime.'); has('letterhead: contact', 'Contact : +91 8875020202, 9460767676'); has('letterhead: e-mail', 'e-mail : deshwaliminerals@gmail.com'); has('letterhead: logo', '/v2/deshwali-logo.png');
has('To, the buyer', 'Rashmi Green Hydrogen Steel Pvt. Ltd.'); has('buyer address', 'Kharagpur – 721301');
has('Bill No. and date', '<b>Bill No.:</b> RCMPL/26-27/1369'); has('bill date dd-mm-yyyy', '<b>Dt.:</b> 02-09-2026'); has('Truck No.', '<b>Truck No.:</b> RJ01GE5906'); has('P.O. No. and date', '<b>P.O. No.:</b> 4100004169'); has('PO date', '19-08-2026');
has('the title', 'Burnt Lime 0-3 MM Analysis Report');
has('table head', '<th style="width:46%">Particulars</th><th>Result</th>');
for (const [l, v] of [['CaO', '86.71 %'], ['SiO2', '1.5 %'], ['LOI', '4 %'], ['Reactivity', '300']]) ok('row ' + l + ' = ' + v, h.includes('<td class="p">' + l + '</td><td class="v">' + v + '</td>'));
ok('a parameter WITHOUT a result is not printed (MgO)', !h.includes('MgO'));
ok('watermark logo behind the table', /class="wm"><img src="[^"]*deshwali-logo\.png"[^>]*opacity:\.08/.test(h));
has('For FIRM', 'For <b>DESHWALI MINERALS</b>'); has('Chief Chemist', 'Chief Chemist'); has('date dd.mm.yyyy', 'Date: <b>02.09.2026</b>');
has('REGD. ADDRESS footer', '<b>REGD. ADDRESS</b>: GROUND FLOOR, KALI TALAI, NEAR HAFIZ SAHAB KI DRAGHA, MERTA CITY, DISTRICT-NAGAUR');
ok('no invented values: nothing but the four results appears in the table', (h.match(/<td class="v">/g) || []).length === 4);
ok('with NO results the renderer returns empty (the app opens the form instead)', T.qaReport(Object.assign({}, D, { params: [{ label: 'CaO', value: '', unit: '%' }] }), {}) === '' && T.qaReport(Object.assign({}, D, { params: [] }), {}) === '');
ok('the chemist name prints under the title when given', T.qaReport(Object.assign({}, D, { chemist: 'A. Sharma' }), {}).includes('Chief Chemist<small>A. Sharma</small>'));
ok('a buyer name with markup is escaped', T.qaReport(Object.assign({}, D, { buyer: { name: '<script>alert(1)</script>', address: '' } }), {}).includes('&lt;script&gt;'));
ok('standalone printable document (doctype, A4 rule)', /^<!DOCTYPE html>/.test(h) && /@page\{size:A4/.test(h));
/* wiring */
const shell = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8'), sales = fs.readFileSync(path.join(__dirname, 'sales.js'), 'utf8'), data = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
ok('QLShell exports printQA / openQAForm / qaHTML', /rowMenu, printInvoice, printQA, openQAForm, qaHTML,/.test(shell));
ok('the Sales Register row menu offers "Quality report"', /label: 'Quality report', icon: RICO\.print, onClick: \(\) => printQA\(idx\)/.test(shell));
ok('the invoice tab has a Quality report button', /QLShell\.printQA\(\$\{r\.idx\}\)/.test(sales));
ok('printing with no results opens the form, never a blank certificate', /if \(!html\) \{ if \(skipForm\) toast\('No lab results to print'\); else \{ toast\('Enter the lab results first'\); openQAForm\(idx, true\); \}/.test(shell));
ok('the form refuses to save with no results', /if \(!params\.length\) \{ toast\('Enter at least one lab result', 'err'\); return false; \}/.test(shell));
ok('every lab value starts EMPTY in the form (nothing pre-filled)', /init\['p' \+ i\] = have\[label\] \? have\[label\]\.value : '';/.test(shell));
ok('QLD exports setSaleQA / qaData', /setSaleQA, qaData,/.test(data));
ok('hydrated lime gets its own parameter set', /hydrated: \[\['Ca\(OH\)2', '%'\]/.test(shell) && /qaSetFor\(product\) \{ return \/hydrat\|chuna\/i/.test(shell));
console.log('\n═══ quality analysis report ═══\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' QA-REPORT TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
