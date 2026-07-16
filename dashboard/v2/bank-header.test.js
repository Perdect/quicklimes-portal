/* bank-header.test.js — statement HEADER parsing + the one BANK_SPECS.

   THE BUG THIS ANSWERS: the user uploaded loan245.pdf and got "Which account is
   this statement from?" with nothing filled in. The app has only ever detected a
   BANK NAME (RC.detectBank) — it never read the account number printed at the top
   of every statement, and the inline "create account" in the import modal did not
   even ask for one, so accounts born there had acctNo:'' forever.

   THE RULE UNDER TEST: a WRONG account number is worse than none. A wrong one
   files a statement against the wrong account and both balances go quietly wrong.
   So most of this file is MUST-NOT-FIRE cases — proving the parser stays silent.

   Run: node bank-header.test.js */

const fs = require('fs'), path = require('path');
const RC = require('./recon-core.js');

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), a === b);

/* ══════════════════════════════════════════════════════════════════════════
   1. REAL HEADER SHAPES — text as the four banks actually print it
   ══════════════════════════════════════════════════════════════════════════ */

// Bank of Baroda — the user's own bank (the loan245.pdf / BOB shape)
const BOB = `
BANK OF BARODA
MERTA CITY BRANCH, NAGAUR, RAJASTHAN
Statement of Account for the period 01-04-2025 to 31-03-2026
Customer Name : GOTAN LIME INDUSTRIES
Account No : 33580500000123
IFSC Code : BARB0MERTAC        MICR : 341012002
Account Type : Current Account
`;
{
  const h = RC.parseStatementHeader(BOB);
  eq('BOB — bank name still detected (reuses detectBank)', h.bank, 'Bank of Baroda');
  eq('BOB — account number read off the header', h.acctNo, '33580500000123');
  eq('BOB — IFSC read off the header', h.ifsc, 'BARB0MERTAC');
}

// HDFC — "Account No" with a masked value, label/value on the same line
const HDFC = `
HDFC BANK LIMITED
Statement of account
Account Branch : NAGAUR
Account No: XXXXXXXX4521   Currency: INR
IFSC : HDFC0001234
Statement From : 01/06/2026 To : 30/06/2026
`;
{
  const h = RC.parseStatementHeader(HDFC);
  eq('HDFC — bank detected', h.bank, 'HDFC');
  eq('HDFC — a MASKED account number is kept as printed', h.acctNo, 'XXXXXXXX4521');
  eq('HDFC — IFSC', h.ifsc, 'HDFC0001234');
}

// SBI — "A/c No." with a full stop, space-grouped digits
const SBI = `
STATE BANK OF INDIA
Account Statement
A/c No. : 3358 0500 001254
IFSC Code: SBIN0000691
Branch : GOTAN
`;
{
  const h = RC.parseStatementHeader(SBI);
  eq('SBI — bank detected', h.bank, 'SBI');
  eq('SBI — space-grouped digits are joined into one number', h.acctNo, '33580500001254');
  eq('SBI — IFSC', h.ifsc, 'SBIN0000691');
}

// ICICI — "Account Number" spelled out, no separator before the value
const ICICI = `
ICICI Bank Ltd
Detailed Statement
Customer A/c No 002105001234
IFSC ICIC0000021
`;
{
  const h = RC.parseStatementHeader(ICICI);
  eq('ICICI — bank detected', h.bank, 'ICICI');
  eq('ICICI — "Customer A/c No" is an account label', h.acctNo, '002105001234');
  eq('ICICI — IFSC with no colon', h.ifsc, 'ICIC0000021');
}

/* ══════════════════════════════════════════════════════════════════════════
   2. MUST NOT FIRE — the whole point. '' beats a guess, every time.
   ══════════════════════════════════════════════════════════════════════════ */

{
  const h = RC.parseStatementHeader(`
    HDFC BANK LIMITED
    Statement of account
    Branch : NAGAUR   Currency : INR
    Statement From : 01/06/2026 To : 30/06/2026`);
  eq('no account label ⇒ acctNo is BLANK, not a guess', h.acctNo, '');
  eq('  ...and no IFSC is invented', h.ifsc, '');
  eq('  ...but the bank name is still detected (blank acctNo never costs us the bank)', h.bank, 'HDFC');
}
{
  // A 12-digit number floating in the header with NO account label. This is the
  // single most dangerous input: it LOOKS exactly like an account number.
  const h = RC.parseStatementHeader('BANK OF BARODA\nCustomer ID 987654321012\nBranch : MERTA CITY');
  eq('a bare 12-digit number with no account label is NOT an account number', h.acctNo, '');
}
{
  const h = RC.parseStatementHeader('HDFC BANK\nUTR No : 123456789012\nCheque No : 000456789012\nRef: BARBT26161997932');
  eq('a UTR is not mistaken for an account number', h.acctNo, '');
}
{
  // THE REGRESSION THIS FUNCTION WAS NEARLY BORN WITH: "Statement of Account for
  // the period 01-04-2025 to 31-03-2026" — the word "Account" is right there, and
  // a hyphen-tolerant value pattern parses the PERIOD as the account number.
  const h = RC.parseStatementHeader('BANK OF BARODA\nStatement of Account for the period 01-04-2025 to 31-03-2026');
  eq('the statement PERIOD after the word "Account" is not an account number', h.acctNo, '');
}
{
  const h = RC.parseStatementHeader('Account Type : Current Account\nAccount Branch : NAGAUR\nHDFC BANK');
  eq('"Account Type"/"Account Branch" carry no number ⇒ blank', h.acctNo, '');
}
{
  // The title "Statement of Account" comes BEFORE the real "Account No" line.
  // A first-label-only parser stops at the title and returns ''.
  const h = RC.parseStatementHeader('BANK OF BARODA\nStatement of Account\nAccount Type : Current\nAccount No : 33580500000123');
  eq('a title "Account" earlier on the page does not hide the real Account No', h.acctNo, '33580500000123');
}
{
  const h = RC.parseStatementHeader('Account No : 1234');
  eq('a too-short number after a real label is still refused', h.acctNo, '');
}
{
  const h = RC.parseStatementHeader('Account No : XXXXXXXXXXXX');
  eq('an entirely masked number identifies nothing ⇒ blank', h.acctNo, '');
}

/* IFSC — the 5th character is ALWAYS the digit zero. */
{
  eq('BARB0MERTAC (digit zero) parses as an IFSC', RC.parseStatementHeader('IFSC: BARB0MERTAC').ifsc, 'BARB0MERTAC');
  eq('BARBOMERTAC (letter O) is NOT an IFSC — the zero-check is the whole test',
    RC.parseStatementHeader('IFSC: BARBOMERTAC').ifsc, '');
  eq('a 10-char code is not an IFSC', RC.parseStatementHeader('IFSC: BARB0MERTA').ifsc, '');
  eq('a plain word is not an IFSC', RC.parseStatementHeader('Branch: MERTA CITY').ifsc, '');
}

/* ══════════════════════════════════════════════════════════════════════════
   3. AUTO-MATCH — masked statement number → the right stored account
   ══════════════════════════════════════════════════════════════════════════ */

const ACCOUNTS = [
  { id: 'BA1', bank: 'HDFC', label: 'HDFC Current', acctNo: '50200012344521' },   // ends 4521
  { id: 'BA2', bank: 'Bank of Baroda', label: 'BOB Current', acctNo: '3358 0500 009999' }, // ends 9999
  { id: 'BA3', bank: 'SBI', label: 'SBI Savings', acctNo: '' },                   // never given one
];

{
  const hit = RC.accountByAcctNo('XXXXXXXX4521', ACCOUNTS);
  ok('a MASKED statement number finds the account ending 4521', hit && hit.id === 'BA1');
}
{
  const hit = RC.accountByAcctNo('XXXXXXXX4521', [ACCOUNTS[1], ACCOUNTS[2]]);
  eq('...and does NOT match the account ending 9999', hit, null);
}
{
  const hit = RC.accountByAcctNo('50200012344521', ACCOUNTS);
  ok('a FULL statement number finds the same account', hit && hit.id === 'BA1');
}
{
  const hit = RC.accountByAcctNo('3358 0500 009999', ACCOUNTS);
  ok('space-grouped stored numbers compare on digits only', hit && hit.id === 'BA2');
}
{
  eq('an account we have never seen matches nothing', RC.accountByAcctNo('XXXXXXXX7777', ACCOUNTS), null);
  eq('a blank statement number never matches (not even the blank-acctNo account)', RC.accountByAcctNo('', ACCOUNTS), null);
  eq('a 3-digit tail is too weak to identify an account', RC.accountByAcctNo('521', ACCOUNTS), null);
}
{
  // AMBIGUITY IS NOT A MATCH: two accounts ending 4521 means we genuinely do not
  // know which — picking one would mis-file the statement, so we ask instead.
  const two = ACCOUNTS.concat([{ id: 'BA9', bank: 'HDFC', label: 'HDFC #2', acctNo: '50200099994521' }]);
  eq('two accounts sharing the tail ⇒ null (ask, never guess)', RC.accountByAcctNo('XXXXXXXX4521', two), null);
  const full = RC.accountByAcctNo('50200012344521', two);
  ok('...but a FULL number still resolves between them', full && full.id === 'BA1');
}

/* ══════════════════════════════════════════════════════════════════════════
   4. ONE definition of the bank-account form
   ══════════════════════════════════════════════════════════════════════════ */

{
  const specs = RC.bankFormSpecs({ current: 'Current', cc_od: 'CC / OD' });
  const keys = specs.map(s => s.k);
  ok('bankFormSpecs exposes every stored field', ['bank', 'label', 'acctNo', 'ifsc', 'type', 'openingBalance', 'openingDate'].every(k => keys.includes(k)));
  ok('  ...bank stays required', specs.find(s => s.k === 'bank').req === true);
  const ty = specs.find(s => s.k === 'type');
  eq('  ...account type is driven by the BANK_TYPES passed in (data.js owns them)', JSON.stringify(ty.opts), JSON.stringify([['current', 'Current'], ['cc_od', 'CC / OD']]));
}

/* THE ANTI-DRIFT PIN. This codebase's recurring bug is the second copy: one
   company switch implemented in 8 of 20 pages, one waLink duplicated 7 times.
   If someone pastes the spec list back into a page, this fails. */
{
  const files = fs.readdirSync(__dirname).filter(f => (/\.(js|html)$/.test(f)) && !/\.test\.js$/.test(f));
  const owners = files.filter(f => /k:\s*'acctNo'|k:\s*"acctNo"/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
  eq('the bank-account form spec is defined in exactly ONE file', owners.join(','), 'recon-core.js');

  const settings = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8');
  const banks = fs.readFileSync(path.join(__dirname, 'banks.html'), 'utf8');
  ok('settings.html renders its form from bankFormSpecs', /bankFormSpecs\s*\(/.test(settings));
  ok('banks.html renders its form from bankFormSpecs', /bankFormSpecs\s*\(/.test(banks));
  ok('settings.html actually LOADS recon-core.js (or the spec call is a ReferenceError)', /recon-core\.js/.test(settings));
  ok('banks.html can add an account without bouncing to Settings', !/onclick="location\.href='settings\.html'"[^>]*>\+ Add accounts in Settings/.test(banks));
}

/* ══════════════════════════════════════════════════════════════════════════
   5. The import modal asks for the account number (reconcile.js)
   ══════════════════════════════════════════════════════════════════════════ */
{
  const rec = fs.readFileSync(path.join(__dirname, 'reconcile.js'), 'utf8');
  ok('the inline "create account" form has an account-number field', /id="rcAccNo"/.test(rec));
  ok('  ...and an IFSC field', /id="rcAccIfsc"/.test(rec));
  ok('  ...and passes acctNo to addBankAccount (else it is typed and thrown away)', /addBankAccount\(\{[^}]*acctNo:/.test(rec));
  ok('the importer calls parseStatementHeader', /parseStatementHeader\s*\(/.test(rec));
  ok('the importer auto-selects by account number', /accountByAcctNo\s*\(/.test(rec));
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail);
if (fail) { console.log('\nFailures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
process.exit(fail ? 1 : 0);
