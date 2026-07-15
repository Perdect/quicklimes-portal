/* ledger-core.test.js — reading Ram Karan & Sons' real Tally ledger.

   THE FILE: "ramkaran & sons.pdf", Gotan Lime Industries' books, 1-Apr-25 to
   31-Mar-26. Limestone supplier. Every line below is VERBATIM pdf.js output
   captured from QLFin.pdfPages() in the browser — NOT pdftotext, which re-sorts
   by position and hides the scrambling the app actually receives. Testing the
   wrong text is how the last parser bug survived a green suite.

   WHAT THE FILE PROVES ABOUT ITSELF (its own printed arithmetic):
     opening    12,76,711.00 Cr
     debits     62,01,505.60      (28 payments)
     credits    71,46,139.00      (opening + 8 monthly purchases)
     closing     9,44,633.40 Cr
   Every one of those is a checkable claim, which is why the importer can refuse
   to write when it has misread the page.

   THE TRAP THIS PINS: "9-Apr-25 Cr ... Payment ... 1,00,000.00" is marked Cr,
   but the balance FALLS — the Cr belongs to the contra account (the bank), not
   to the party. Reading that letter as the party's direction inverts every
   payment in the file. Direction comes from the balance chain.

   Run: node ledger-core.test.js */

const L = require('./ledger-core.js');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), a === b);
const near = (n, a, b) => ok(n + ' — got ' + a + ', want ' + b, Math.abs(a - b) < 0.01);

const TEXT = [
  'Gotan Lime Industries', 'Talanpur Road, Reja Colony, SH 86B,', 'Chandra Tyre Retreading, Gotan',
  'Ram Karan & Sons', 'Ledger Account', 'Ml No 1382', '1349', '95', 'Near', 'Borunda', 'Jodhpur',
  '1-Apr-25 to 31-Mar-26', 'Page 1', 'Date Particulars Vch Type Vch No. Debit Credit Balance',
  '1-Apr-25 Dr Opening Balance 12,76,711.00',
  '9-Apr-25 Cr Payment 22 1,00,000.00 11,76,711.00 Cr', 'BOB Ac 254', '23',
  'Cr Payment 5.60 11,76,705.40 Cr', 'BOB Ac 254',
  '31-May-25 11', 'Dr Purchase 10,502.00 11,87,207.40 Cr', 'Purchase Local 5%',
  '10-Jun-25 101', 'Cr BOB Ac 254 Payment 46,500.00 11,40,707.40 Cr',
  '30-Jun-25 Purchase 17', 'Dr Purchase Local 5% 12,63,616.00 24,04,323.40 Cr',
  '9-Jul-25 Payment 123', 'Cr BOB Ac 254 3,50,000.00 20,54,323.40 Cr',
  '11-Jul-25 Payment 125', 'Cr BOB Ac 254 80,000.00 19,74,323.40 Cr',
  '14-Jul-25 Payment 131', 'Cr BOB Ac 254 2,50,000.00 17,24,323.40 Cr',
  '31-Jul-25 Dr Purchase 26 6,83,325.00 24,07,648.40 Cr', 'Purchase Local 5%',
  '11-Aug-25 152', 'Cr Payment 2,05,000.00 22,02,648.40 Cr', 'BOB Ac 254',
  '31-Aug-25 31', 'Dr Purchase 7,91,358.00 29,94,006.40 Cr', 'Purchase Local 5%',
  '12-Sep-25 161', 'Cr BOB Ac 254 Payment 2,00,000.00 27,94,006.40 Cr',
  '30-Sep-25 Purchase 43', 'Dr Purchase Local 5% 8,69,811.00 36,63,817.40 Cr',
  '4-Oct-25 Payment 162', 'Cr BOB Ac 254 50,000.00 36,13,817.40 Cr',
  '11-Oct-25 Payment 163', 'Cr BOB Ac 254 3,50,000.00 32,63,817.40 Cr',
  '16-Oct-25 Payment 164', 'Cr BOB Ac 254 1,00,000.00 31,63,817.40 Cr',
  '31-Oct-25 Dr Purchase 52 7,51,110.00 39,14,927.40 Cr', 'Purchase Local 5%',
  '10-Nov-25 Cr Payment 252 2,45,000.00 36,69,927.40 Cr', 'BOB Ac 254',
  '12-Nov-25 264', 'Cr Payment 3,50,000.00 33,19,927.40 Cr', 'BOB Ac 254',
  '14-Nov-25 266', 'Cr BOB Ac 254 Payment 2,80,000.00 30,39,927.40 Cr',
  '30-Nov-25 58', 'Dr Purchase Local 5% Purchase 7,57,064.00 37,96,991.40 Cr',
  '2-Dec-25 Payment 283', 'Cr BOB Ac 254 40,000.00 37,56,991.40 Cr',
  'Payment 285', 'Cr BOB Ac 254 1,50,000.00 36,06,991.40 Cr',
  '10-Dec-25 Payment 293', 'Cr BOB Ac 254 1,00,000.00 35,06,991.40 Cr',
  '15-Dec-25 Payment 295', 'Cr BOB Ac 254 1,00,000.00 34,06,991.40 Cr',
  '16-Dec-25 Cr Payment 297 1,90,000.00 32,16,991.40 Cr', 'BOB Ac 254',
  '17-Dec-25 302', 'Cr Payment 2,10,000.00 30,06,991.40 Cr', 'BOB Ac 254',
  '304', 'Cr Payment 4,80,000.00 25,26,991.40 Cr', 'BOB Ac 254',
  '25-Dec-25 316', 'Cr BOB Ac 254 Payment 3,00,000.00 22,26,991.40 Cr',
  '31-Dec-25 Purchase 67', 'Dr Purchase Local 5% 7,42,642.00 29,69,633.40 Cr',
  '1-Jan-26 Payment 335', 'Cr BOB Ac 254 5,00,000.00 24,69,633.40 Cr',
  'Payment 337', 'Cr BOB Ac 254 1,00,000.00 23,69,633.40 Cr',
  '10-Jan-26 Payment 341', 'Cr BOB Ac 254 2,00,000.00 21,69,633.40 Cr',
  '12-Jan-26 Cr Payment 350 4,00,000.00 17,69,633.40 Cr', 'BOB Ac 254',
  '19-Jan-26 364', 'Cr Payment 4,25,000.00 13,44,633.40 Cr', 'BOB Ac 254',
  '28-Jan-26 374', 'Cr Payment 4,00,000.00 9,44,633.40 Cr', 'BOB Ac 254',
  '62,01,505.60 71,46,139.00', 'Cr 9,44,633.40', 'Closing Balance',
  '71,46,139.00 71,46,139.00', ''
].join('\n');

const P = L.parse(TEXT);

/* ── 1. whose ledger, and for when ── */
eq('the account is the supplier, not our own letterhead at the top', P.party, 'Ram Karan & Sons');
eq('the ledger is printed from OUR books', P.self, 'Gotan Lime Industries');
eq('period from', P.from, '2025-04-01');
eq('period to', P.to, '2026-03-31');

/* ── 2. THE GATE: it ties to the ledger's own printed arithmetic ── */
ok('the file ties to its own totals — the import may proceed', P.check.ok);
eq('...with nothing to explain', P.check.reasons.length, 0);
near('opening balance', P.opening, 1276711);
eq('...and we OWE it (Cr)', P.openingType, 'Cr');
near('closing balance', P.closing, 944633.40);
eq('...still owed (Cr)', P.closingType, 'Cr');
near('debits total — matches the ledger foot 62,01,505.60', P.check.debits, 6201505.60);
near('opening + credits — matches the ledger foot 71,46,139.00', P.opening + P.check.credits, 7146139);
eq('every row read', P.check.count, 36);
eq('...and every row ties to the balance chain', P.entries.filter(e => !e.tie).length, 0);

/* ── 3. THE TRAP: a row marked "Cr" is a payment we MADE ──
   The balance falls, so the party is debited. Trusting the letter inverts every
   payment in the file and turns ₹62L of payments into ₹62L of purchases. */
const first = P.entries[0];
eq('the 9-Apr row is a DEBIT — we paid him', first.dir, 'debit');
near('...₹1,00,000', first.amount, 100000);
eq('...on 2025-04-09', first.date, '2025-04-09');
near('...leaving 11,76,711 owed', first.balance, 1176711);
ok('...even though the line is marked "Cr"', /Cr/.test('9-Apr-25 Cr Payment 22 1,00,000.00 11,76,711.00 Cr'));

/* ── 4. purchases: 8, monthly, month-end ── */
const bills = P.entries.filter(e => e.dir === 'credit');
const pays = P.entries.filter(e => e.dir === 'debit');
eq('8 purchases', bills.length, 8);
eq('28 payments', pays.length, 28);
near('purchases total', bills.reduce((a, b) => a + b.amount, 0), 5869428);
near('payments total', pays.reduce((a, b) => a + b.amount, 0), 6201505.60);
eq('the biggest purchase is June', bills.reduce((a, b) => b.amount > a.amount ? b : a).date, '2025-06-30');
ok('every purchase falls on a month end', bills.every(b => /-(?:31|30)$/.test(b.date)));

/* ── 5. a date is carried forward when Tally omits it ──
   "23" / "Cr Payment 5.60 ..." has no date of its own: it is the second voucher
   of 9-Apr. Losing that would file ₹5.60 under no date at all. */
eq('the undated second row inherits 9-Apr', P.entries[1].date, '2025-04-09');
near('...and it is the ₹5.60 bank charge', P.entries[1].amount, 5.60);
// the ₹4,80,000 row on 17-Dec has neither date nor its own date line
const dec = P.entries.filter(e => e.date === '2025-12-17');
eq('both 17-Dec vouchers are dated 17-Dec', dec.length, 2);
near('...including the undated ₹4,80,000', dec[1].amount, 480000);

/* ── 6. THE GATE MUST BITE ──
   A gate that never refuses is decoration. Corrupt one amount so the chain and
   the printed foot disagree, and the import must refuse — loudly. */
const broken = L.parse(TEXT.replace('12,63,616.00 24,04,323.40 Cr', '12,63,616.00 24,04,999.99 Cr'));
ok('a ledger that does not tie is REFUSED', !broken.check.ok);
ok('...and says why, in figures', broken.check.reasons.join(' ').length > 20);
const truncated = L.parse(TEXT.split('\n').slice(0, 40).concat(['62,01,505.60 71,46,139.00', 'Cr 9,44,633.40', 'Closing Balance']).join('\n'));
ok('a half-read ledger is REFUSED, never half-imported', !truncated.check.ok);
ok('...naming the missing rows', /missing|totals/i.test(truncated.check.reasons.join(' ')));

/* A clean file must also be clean of DOUBTS. Without this the opening-side
   arithmetic can be disabled and nothing goes red: the fallback happens to
   return the same answer for this ledger — while quietly recording that it
   could not settle the side. A silent guess that is right today is a guess. */
eq('a file that ties raises no doubts either', P.warnings.length, 0);

/* THE PRINTED FOOT IS AN INDEPENDENT WITNESS.
   Rows the parser silently SKIPS still leave a self-consistent chain — the
   remaining rows tie to each other and to the closing balance perfectly. Only
   Tally's own printed totals reveal that something never made it in. Here the
   foot alone is wrong: chain intact, closing intact, totals disagree. Nothing
   but the cross-check can catch this, and this is the case that proves it. */
const footWrong = L.parse(TEXT.replace('62,01,505.60 71,46,139.00', '62,01,999.99 71,46,139.00'));
ok('every row still ties to the chain', footWrong.entries.every(e => e.tie));
near('...and the closing still matches', footWrong.closing, 944633.40);
ok('...but the ledger\'s own debit total disagrees, so it is REFUSED', !footWrong.check.ok);
ok('...naming the two figures', /62,?01,?999|6201999|6201505/.test(footWrong.check.reasons.join(' ').replace(/\s/g, '')) || /totals/i.test(footWrong.check.reasons.join(' ')));

/* ── 7. the rhythm — his own file describes the arrangement ── */
const R = L.rhythm(P);
eq('he bills once a month', R.consolidatedMonthly, true);
eq('...across 8 months', R.months, 8);
near('...median bill', R.medianBill, 754087);
ok('...and we pay him many times per bill — never invoice-wise', R.payPerBill >= 3);

console.log('\n════ Tally party ledger · Ram Karan & Sons ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' LEDGER TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
