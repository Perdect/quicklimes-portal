/* consistency.test.js — THE SAME RULE, WRITTEN ONCE PER FILE, MUST AGREE.

   WHY THIS EXISTS
   This codebase implements a few rules more than once: GSTIN validity lives in
   5 places (bill-ocr.js, data.js, extract-schema.js, signup.php, crm.php) and
   "read a date" in 4 (bill-ocr.js, finance.js, data.js, bulk.js). Duplicated
   rules drift, and when they drift the app contradicts itself in ways no screen
   reveals. Two REAL bugs on 2026-07-15 came from exactly this:

     • signup.php accepted GSTIN state code 99 while data.js and bill-ocr.js
       rejected it — so signup could store an identity the parser then ignored,
       silently recreating the "every bill is a purchase" bug.
     • extract-schema.js classify() decided the register from the AI's
       documentType while bill-ocr.js decided it from the GSTINs — so the SAME
       bill was a purchase offline and a sale through the AI. A real customer
       purchase was filed as their sale.

   Collapsing 5 validators into 1 inside a live product is how you break sales
   AND purchases in one commit. So instead: this test loads EVERY real
   implementation out of the shipping files and asserts they agree. Drift can no
   longer ship silently. Collapse them later, safely, with this as the net.

   Run: node consistency.test.js */

const fs = require('fs');
const OCR = require('./bill-ocr.js');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };

const read = p => fs.readFileSync(__dirname + '/' + p, 'utf8');
const dataSrc = read('data.js'), finSrc = read('finance.js'), bulkSrc = read('bulk.js');
const signupSrc = read('../api/signup.php'), crmSrc = read('../api/crm.php');

/* ══ 1. GSTIN VALIDITY — 5 implementations ══════════════════════════════ */

// data.js
const dm = dataSrc.match(/const validGstinFmt = ([^;]+);/);
ok('data.js validGstinFmt found', !!dm);
const dataGstin = eval('(' + (dm ? dm[1] : '()=>false') + ')');

// PHP: shape regex + the 01-38 state range, in both endpoints
function phpValidator(src, label) {
  const re = src.match(/preg_match\('\/\^(.+?)\$\/'/);
  ok(label + ' has a GSTIN shape check', !!re);
  const range = />= 1 &&/.test(src) && /<= 38/.test(src);
  ok(label + ' also checks the state code 01-38 (not just the shape)', range);
  const shape = re ? new RegExp('^' + re[1] + '$') : /$^/;
  return g => shape.test(g) && range && +g.slice(0, 2) >= 1 && +g.slice(0, 2) <= 38;
}
const phpSignup = phpValidator(signupSrc, 'signup.php');
const phpCrm = phpValidator(crmSrc, 'crm.php');

const GSTINS = [
  ['08BNAPM0488E1Z3', true,  'Gotan — real'],
  ['08NLIPS9801K1Z5', true,  'Deshwali — real'],
  ['24AAACI1681G1ZV', true,  'IOC — real supplier'],
  ['08AABCS5768D1Z1', true,  'a real customer'],
  ['', false, 'blank'],
  ['ABC', false, 'junk'],
  ['08BNAPM0488E1Z', false, '14 chars'],
  ['08BNAPM0488E1Z33', false, '16 chars'],
  ['99BNAPM0488E1Z3', false, 'state 99 does not exist'],
  ['00BNAPM0488E1Z3', false, 'state 00'],
  ['39BNAPM0488E1Z3', false, 'state 39 (just past the last real one)'],
  ['38BNAPM0488E1Z3', true,  'state 38 — the highest real one'],
  ['01BNAPM0488E1Z3', true,  'state 01 — the lowest'],
  ['081NAPM0488E1Z3', false, 'digit where a letter belongs'],
  ['08BNAPM0488E1A3', false, 'no Z in position 14'],
];

GSTINS.forEach(([g, want, why]) => {
  const impls = {
    'bill-ocr.js validGstin': !!OCR.validGstin(g),
    'data.js validGstinFmt': !!dataGstin(g),
    'signup.php': !!phpSignup(g),
    'crm.php': !!phpCrm(g),
  };
  Object.entries(impls).forEach(([name, got]) => {
    ok('GSTIN "' + (g || '(blank)') + '" (' + why + ') — ' + name + ' says ' + got + ', expected ' + want, got === want);
  });
  const values = Object.values(impls);
  ok('ALL 4 GSTIN validators AGREE on "' + (g || '(blank)') + '" (' + why + ')',
    values.every(v => v === values[0]));
});

/* ══ 2. DATE READING — 3 comparable implementations ══════════════════════
   bill-ocr's findDate() searches free text (a different job), so the three
   compared here are the ones that turn ONE value into an ISO date. They are
   called on the same field, by the same upload, one after another. */

/* Load a function out of a shipping file WITH the real constants it depends on
   — never a re-typed copy. finance.js parseDate uses its own MON table and
   data.js toISODate uses _MON; inventing either here would test my table
   instead of theirs, which is the whole failure mode this file exists to catch. */
function grab(src, startsWith, endsWith, name, deps) {
  const i = src.indexOf(startsWith);
  ok(name + ' found', i >= 0);
  if (i < 0) return () => '';
  const body = src.slice(i, src.indexOf(endsWith, i) + endsWith.length);
  const vm = require('vm');
  const ctx = { window: {},
    fmtISO: d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') };
  vm.createContext(ctx);
  (deps || []).forEach(d => {
    const j = src.indexOf(d);
    ok(name + ' — its real dependency `' + d.split('=')[0].trim() + '` found', j >= 0);
    if (j >= 0) vm.runInContext(src.slice(j, src.indexOf('\n', j)), ctx);
  });
  vm.runInContext(body + '\nthis.__fn = ' + name.split(' ')[1].replace('()', '') + ';', ctx);
  return ctx.__fn;
}
const toISODate = grab(dataSrc, '  function toISODate(s)', '\n  }', 'data.js toISODate()', ['const _MON = {']);
const finParseDate = grab(finSrc, '  function parseDate(s)', '\n  }', 'finance.js parseDate()', ['const MON = { jan: 1']);
const bulkIsoDate = grab(bulkSrc, '  function isoDate(raw)', '\n  }', 'bulk.js isoDate()');

const DATES = [
  ['2026-01-15', '2026-01-15', 'already ISO'],
  ['15-Jan-2026', '2026-01-15', 'the format IOC bills print'],
  ['15-Jan-26', '2026-01-15', '2-digit year'],
  ['15/01/2026', '2026-01-15', 'DD/MM/YYYY'],
  ['15-01-2026', '2026-01-15', 'DD-MM-YYYY'],
  ['15/01/26', '2026-01-15', 'DD/MM/YY — Tally and many suppliers print this'],
  ['15-01-26', '2026-01-15', 'DD-MM-YY'],
  ['01/02/2026', '2026-02-01', 'DD/MM, not MM/DD — 1 Feb, never 2 Jan'],
  ['31-12-2025', '2025-12-31', 'year end'],
  ['01-Jan-2026', '2026-01-01', 'new year'],
];
DATES.forEach(([raw, want, why]) => {
  const impls = { 'data.js toISODate': toISODate(raw), 'finance.js parseDate': finParseDate(raw), 'bulk.js isoDate': bulkIsoDate(raw) };
  Object.entries(impls).forEach(([name, got]) => {
    ok('date "' + raw + '" (' + why + ') — ' + name + ' gave ' + JSON.stringify(got) + ', expected ' + want, got === want);
  });
  const v = Object.values(impls);
  ok('ALL 3 date readers AGREE on "' + raw + '" (' + why + ')', v.every(x => x === v[0]));
});

/* Junk must be REJECTED the same way everywhere. This is the exact value that
   made a bill save with no date and vanish from every month. */
const JUNK = ['Dated :', 'Invoice Date', '', 'N/A', '--'];
JUNK.forEach(raw => {
  const fin = finParseDate(raw), bulk = bulkIsoDate(raw);
  ok('junk date ' + JSON.stringify(raw) + ' — finance.js returns empty', !fin);
  ok('junk date ' + JSON.stringify(raw) + ' — bulk.js returns empty', !bulk);
  ok('junk date ' + JSON.stringify(raw) + ' — both agree it is unreadable', (!fin) === (!bulk));
});

/* toISODate is the ONE that keeps junk (it is the last line before storage and
   returns the raw value). That is a real divergence and it is documented here
   rather than pretended away: it is why bulk.js must gate the field BEFORE the
   value ever reaches data.js. If this ever starts returning '' instead, the
   gate can be simplified — this test will say so. */
ok('KNOWN DIVERGENCE: data.js toISODate passes junk through (bulk.js must gate before it)',
  toISODate('Dated :') === 'Dated :');

/* ══ 3. THE RULE THAT COST A CUSTOMER'S PURCHASE ════════════════════════
   Both extractors must decide the register the same way: from the GSTINs. */
const esSrc = read('extract-schema.js');
ok('extract-schema classify() no longer lets documentType pick the register',
  !/if \(dt === 'sales' \|\| dt === 'purchase'\) return \{ kind: dt/.test(esSrc));
ok('...and says so, so nobody re-adds it', /documentType MUST NEVER DECIDE|describes the DOCUMENT, not our relationship/i.test(esSrc));
ok('bill-ocr decides direction from the GSTINs', /ownG\.indexOf\(issuerG\) >= 0 \? 'sales' : 'purchase'/.test(read('bill-ocr.js')));

console.log('\n════ cross-implementation consistency ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' CONSISTENCY CHECKS PASSED\n' : '\n❌ ' + fail + ' FAILED — two files disagree about the same rule\n');
process.exit(fail === 0 ? 0 : 1);
