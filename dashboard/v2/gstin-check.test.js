/* gstin-check.test.js — GSTIN check digit, State from the code, and the auto-fill wiring.
   Run:  node dashboard/v2/gstin-check.test.js

   WHY THIS EXISTS
   The owner asked for "type the GST number and the name / address come by
   themselves, like other platforms". Three sources feed that: the check digit
   and State are computed here, our own customer records are matched, and a
   GST lookup provider fills the rest when a key is configured. The first two
   must be right on their own — a wrong State on an invoice is a wrong tax head.
   The vectors are the firm's own GSTINs; gstin-lib.test.php pins the same ones
   on the PHP side so the two implementations cannot drift apart. */
const path = require('path'), fs = require('fs');
const P = require(path.join(__dirname, 'party-identity.js'));
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };

for (const [g, who] of [['08NLIPS9801K1Z5', 'Deshwali Minerals'], ['08BNAPM0488E1Z3', 'Gotan Lime Industries'], ['08BPLPS6684F1Z6', 'Lekhraj Chemical Industries']]) {
  const r = P.gstinCheck(g);
  ok(who + ' — ' + g + ' passes', r.ok === true && r.reason === '' && r.stateCode === '08');
}
ok('a typo in the last character → checksum',  P.gstinCheck('08NLIPS9801K1Z4').reason === 'checksum');
ok('a typo in the middle → checksum',          P.gstinCheck('08NLIPS9891K1Z5').reason === 'checksum');
ok('14 characters → length',                   P.gstinCheck('08NLIPS9801K1Z').reason === 'length');
ok('wrong shape → format',                     P.gstinCheck('0ANLIPS9801K1Z5').reason === 'format');
ok('state 00 → format',                        P.gstinCheck('00NLIPS9801K1Z5').reason === 'format');
ok('lowercase / spaces normalised',            P.gstinCheck(' 08nlips9801k1z5 ').ok === true);
ok('PAN lifted from characters 3–12',          P.gstinCheck('08NLIPS9801K1Z5').pan === 'NLIPS9801K');

/* stateOfGstin lives in data.js's closure — lift the table and the function */
const src = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
const s0 = src.indexOf('  const GST_STATES = {'), s1 = src.indexOf('\n', src.indexOf('function stateOfGstin', s0)) + 1;
ok('GST_STATES and stateOfGstin found in data.js', s0 > 0 && s1 > s0);
const stateOfGstin = new Function(src.slice(s0, s1) + '\nreturn stateOfGstin;')();
ok('08 → Rajasthan (08)',        stateOfGstin('08BPLPS6684F1Z6') === 'Rajasthan (08)');
ok('27 → Maharashtra (27)',      stateOfGstin('27AAACG0569P1ZP') === 'Maharashtra (27)');
ok('24 → Gujarat (24)',          stateOfGstin('24AAACG0569P1ZP') === 'Gujarat (24)');
ok('36 → Telangana (36)',        stateOfGstin('36AAACG0569P1ZP') === 'Telangana (36)');
ok('unknown code → empty',       stateOfGstin('99AAACG0569P1ZP') === '');
ok('empty → empty',              stateOfGstin('') === '');
/* the PHP side carries the identical table — same 38 codes, same names */
const php = fs.readFileSync(path.join(__dirname, '..', 'api', 'gstin-lib.php'), 'utf8');
const jsTable = src.slice(s0, src.indexOf('};', s0)), phpTable = php.slice(php.indexOf('QL_GST_STATES = ['), php.indexOf('];', php.indexOf('QL_GST_STATES = [')));
const jsPairs = [...jsTable.matchAll(/'(\d\d)': '([^']+)'/g)].map(m => m[1] + '=' + m[2]);
const phpPairs = [...phpTable.matchAll(/'(\d\d)' => '([^']+)'/g)].map(m => m[1] + '=' + m[2]);
ok('JS and PHP state tables are identical (' + jsPairs.length + ' codes)', jsPairs.length === 39 && jsPairs.join('|') === phpPairs.join('|'));

/* wiring — the behaviour must be reachable from both places a GSTIN is typed */
const shell = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8');
const inv = fs.readFileSync(path.join(__dirname, 'invoice.js'), 'utf8');
ok('QLShell exports gstinLookup and gstinHint', /\bgstinLookup, gstinHint,/.test(shell));
ok('every openForm — internal callers included — wires the GSTIN auto-fill', /function openForm\(cfg\) \{ const r = openFormInner\(cfg\); try \{ wireGstinAutofill\(\); \}/.test(shell) && !/openForm\(cfg\) \{ const r = openForm\(cfg\)/.test(shell));
ok('the form wiring fills only EMPTY fields (never overwrites typing)', /if \(el && v && !String\(el\.value \|\| ''\)\.trim\(\)\) el\.value = v;/.test(shell));
ok('the invoice form wires i_bgst to the assist', /if \(e\.target\.id === 'i_bgst'\) gstinAssist\(e\.target\.value\);/.test(inv));
ok('the invoice assist fills only EMPTY fields too', /if \(f && v && !String\(f\.value \|\| ''\)\.trim\(\)\) f\.value = v;/.test(inv));
/* State is a FACT off the GSTIN, so it is set, not filled — the invoice form
   arrives with the seller's state pre-filled, and a 27 GSTIN was printing
   "Rajasthan (08)" (seen live 12-09-2026). The box is also cleaned. */
ok('the invoice assist SETS the State from the GSTIN (overrides the pre-fill)', /const st = document\.getElementById\('i_bstate'\); if \(st && r\.state\) st\.value = r\.state;/.test(inv));
ok('the invoice assist cleans the GSTIN in the box', /if \(el\.value !== r\.gstin\) el\.value = r\.gstin;/.test(inv));
ok('the form wiring SETS qf_state from the GSTIN too', /const st = document\.getElementById\('qf_state'\); if \(st && r\.state\) st\.value = r\.state;/.test(shell));
ok('the form wiring cleans the GSTIN in the box', /if \(g\.value !== r\.gstin\) g\.value = r\.gstin;/.test(shell));
ok('the lookup posts the session token to /api/gstin.php', /fetch\('\/api\/gstin\.php'/.test(shell) && /token: tok, gstin: x/.test(shell));
ok('the hint is honest when no lookup key is configured', /needs a GST lookup key \(not configured yet\)/.test(shell));
ok('the hint names a mistyped GSTIN', /Check digit does not match/.test(shell));

console.log('\n═══ GSTIN check digit · State · auto-fill wiring ═══\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' GSTIN TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
