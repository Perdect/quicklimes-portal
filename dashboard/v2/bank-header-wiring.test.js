/* bank-header-wiring.test.js — does the IMPORTER actually read the header?
 *
 * bank-header.test.js proves parseStatementHeader. It does NOT prove the app calls
 * it. That distinction is not theoretical in this codebase: party-identity.js
 * shipped with 22 green checks while ELEVEN call sites ignored it, and the
 * bill-direction bug stayed live after its parser was fixed because the router
 * never called the fixed code. A green engine test proves the engine.
 *
 * So this loads the REAL reconcile.js in a VM, hands it a REAL Bank of Baroda
 * statement (header block + transaction table, exactly as fileToRows returns a
 * CSV), fires the REAL file-input onchange, and reads the REAL modal HTML.
 * Nothing is re-implemented.
 *
 *   node bank-header-wiring.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), a === b);

/* ── a DOM real enough to hold the answer ─────────────────────────
   The answer here IS the DOM: the pre-selected <option>, the pre-filled value.
   A Proxy stub that swallows writes would pass whether or not the code ran. */
const noop = () => {};
const els = {};
const mkEl = id => (els[id] = els[id] || {
  id, innerHTML: '', className: '', style: {}, dataset: {}, files: [], value: '',
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  appendChild: noop, remove: noop, focus: noop, setAttribute: noop, addEventListener: noop,
  querySelector: () => mkEl('_q'), querySelectorAll: () => []
});
const doc = {
  getElementById: id => mkEl(id), querySelector: () => mkEl('_q'), querySelectorAll: () => [],
  createElement: () => mkEl('_c'), addEventListener: noop, body: mkEl('_body'), documentElement: mkEl('_html')
};

const TXNS = [];
let ACCOUNTS = [];
let addedAcc = null;
const QLD = {
  fC: n => '₹' + Math.round(+n || 0).toLocaleString('en-IN'),
  fmt: n => String(n), fDS: d => String(d || ''), fL: n => String(n), daysAgo: () => 0,
  co: { name: 'Gotan Lime Industries', short: 'GOTAN' }, COMPANIES: {}, ownFirmNames: ['Gotan Lime Industries'],
  activeCo: 'gotan',
  salesRows: () => [], purchaseRows: () => [], partyRows: () => [], cashbookRows: () => [],
  BANK_TYPES: { current: 'Current', cc_od: 'CC / OD', savings: 'Savings', loan: 'Loan account' },
  bankAccounts: () => ACCOUNTS, bankAccountById: id => ACCOUNTS.find(a => a.id === id) || null, bankAccountLabel: () => '',
  addBankAccount: a => { addedAcc = a; const acc = Object.assign({ id: 'BAnew' }, a); ACCOUNTS.push(acc); return acc; },
  recon: { txns: TXNS, aliases: {} }, saveRecon: noop, commit: noop, state: { RECON: { txns: TXNS } },
  uiMonth: () => null, setUiMonth: noop, partyLedger: () => [],
  statementRows: () => [], lastStatement: () => null, addStatement: s => s
};
const ctx = {
  console, window: {}, document: doc,
  QLShell: { mount: noop, modal: noop, toast: noop, openForm: noop, exportCSV: noop },
  QLD, QLFin: {}, QLMobile: null, QLParty: require('./party-identity.js'),
  ImportGuard: require('./import-guard.js'),
  QLX: { esc: s => String(s == null ? '' : s), svg: () => '', icons: {}, toast: noop, refresh: noop, mount: noop, state: () => ({}) },
  setTimeout: noop, clearTimeout: noop, requestAnimationFrame: noop,
  localStorage: { getItem: () => null, setItem: noop }, sessionStorage: { getItem: () => null, setItem: noop },
  location: { href: 'https://app.quicklimes.com/v2/reconcile', search: '', hash: '', pathname: '/v2/reconcile' },
  history: { replaceState: noop, pushState: noop }, navigator: { userAgent: 'node' }, alert: noop, confirm: () => false,
  crypto: require('crypto').webcrypto,
  Uint8Array, Array, Object, Set, Map, Date, JSON, Math, String, Number, Promise,
  isNaN, parseFloat, parseInt
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.window.QLD = QLD;
vm.createContext(ctx);

vm.runInContext(fs.readFileSync(path.join(__dirname, 'recon-core.js'), 'utf8'), ctx);
/* The REAL QLFin: reconcile.js maps columns through QLFin.colOf/parseDate/parseNum.
   Stubbing only fileToRows (as an earlier version of the sibling test did) makes
   every row fail to parse and the assertions pass on ZERO transactions — a vacuous
   green. Load the real one; override only the file READ, since there is no disk. */
try { vm.runInContext(fs.readFileSync(path.join(__dirname, 'finance.js'), 'utf8'), ctx); } catch (e) { console.log('  ⚠ finance.js: ' + e.message); }
ctx.QLFin = ctx.window.QLFin || ctx.QLFin;
vm.runInContext(fs.readFileSync(path.join(__dirname, 'reconcile.js'), 'utf8') + '\n;this.__openUpload = openUpload;', ctx);

/* ── the fixture: a REAL Bank of Baroda statement shape ──
   Header block ABOVE the table, exactly as fileToRows hands back a CSV/Excel
   statement — bankHeaderRow() finds the "Date,Narration,…" row at index 6, and
   rows 0-5 are the header the parser must read. */
const BOB_ROWS = [
  ['BANK OF BARODA'],
  ['MERTA CITY BRANCH, NAGAUR'],
  ['Statement of Account for the period 01-06-2026 to 30-06-2026'],
  ['Customer Name : GOTAN LIME INDUSTRIES'],
  ['Account No : 33580500004521'],
  ['IFSC Code : BARB0MERTAC'],
  ['Date', 'Narration', 'Debit', 'Credit', 'Balance'],
  ['16/06/2026', 'NEFT-BARBT26161997932-NAGAUR GOLDEN TRANSPORT COMP', '54944', '', '445056'],
  ['22/06/2026', 'RTGS-BARBR52026062200778789-PRINCE LIME', '', '120000', '565056']
];

const BYTES = new TextEncoder().encode('bob-june-2026');
const mkFile = name => ({ name, type: 'text/csv', arrayBuffer: async () => BYTES.buffer.slice(0) });

const E = id => doc.getElementById(id);   // the modal is an HTML string; elements exist only via getElementById

const upload = async (rows, name) => {
  addedAcc = null; TXNS.length = 0;
  ctx.QLFin.fileToRows = async () => ({ rows, kind: 'csv' });
  ctx.__openUpload();
  const inp = els.rcFile;
  inp.files = [mkFile(name || 'bob-june-' + Math.random() + '.csv')];
  await inp.onchange();
  return els.rcUpMsg.innerHTML || '';
};

(async () => {
  /* ══════════ 1. THE HEADER REACHES THE PARSER ══════════ */
  {
    /* ORDER IS THE TEST. The statement belongs to BA1 (…4521), but the WRONG
       account (…9999) is deliberately listed FIRST, because both are "Bank of
       Baroda" and the old bank-NAME match returns the first hit. If the importer
       ignores the account number and falls back to the name, it picks BA2 and
       these fail. Listing BA1 first — as an earlier version of this file did —
       lets the coin flip land on the right answer by luck, and the test cannot
       tell a real match from a lucky one. Mutation testing is what exposed that:
       deleting the acctNo match entirely left this section green. */
    ACCOUNTS = [
      { id: 'BA2', bank: 'Bank of Baroda', label: 'BOB CC/OD', acctNo: '33580500009999', type: 'cc_od' },
      { id: 'BA1', bank: 'Bank of Baroda', label: 'BOB Current', acctNo: '33580500004521', type: 'current' }
    ];
    const html = await upload(BOB_ROWS);
    ok('the account-choice modal is shown', /Which account is this statement from/.test(html));
    ok('THE WIRING: the account number from the header block reaches the modal', /33580500004521/.test(html));

    const selBlock = html.slice(html.indexOf('<select'), html.indexOf('</select>'));
    ok('the RIGHT of two same-bank accounts is auto-selected (by NUMBER, not by name)', /value="BA1"\s+selected/.test(selBlock));
    ok('  ...and the wrong same-bank account, listed first, is NOT selected', !/value="BA2"\s+selected/.test(selBlock));
    ok('  ...and the modal says which account it matched', /matched to/.test(html) && /BOB Current/.test(html));
  }

  /* ══════════ 2. NO HEADER ⇒ NO GUESS, BUT STILL IMPORTABLE ══════════ */
  {
    ACCOUNTS = [
      { id: 'BA1', bank: 'Bank of Baroda', label: 'BOB Current', acctNo: '33580500004521', type: 'current' },
      { id: 'BA2', bank: 'Bank of Baroda', label: 'BOB CC/OD', acctNo: '33580500009999', type: 'cc_od' }
    ];
    const noHdr = [['BANK OF BARODA'], ['Statement of Account for the period 01-06-2026 to 30-06-2026']].concat(BOB_ROWS.slice(6));
    const html = await upload(noHdr);
    ok('a statement with no account number still opens the modal (never blocks the import)', /Which account is this statement from/.test(html));
    ok('  ...and does NOT claim an account number it never read', !/for A\/C/.test(html));
    ok('  ...and does not claim a match it cannot justify', !/matched to/.test(html));
  }

  /* ══════════ 3. AN UNKNOWN ACCOUNT PRE-FILLS THE CREATE FORM ══════════ */
  {
    ACCOUNTS = [];                                   // the user's real situation: no accounts yet
    const html = await upload(BOB_ROWS);
    ok('with no accounts, the create-account form is shown', /rcAccNo/.test(html));
    ok('THE ANSWER TO "where do I enter an account number": the field exists', /id="rcAccNo"/.test(html));
    ok('  ...pre-filled from the statement header', /id="rcAccNo"[^>]*value="33580500004521"/.test(html));
    ok('  ...and the IFSC too', /id="rcAccIfsc"[^>]*value="BARB0MERTAC"/.test(html));
    ok('  ...and the bank name, as before', /id="rcAccBank"[^>]*value="Bank of Baroda"/.test(html));

    /* AND IT IS SAVED. A field the user fills that never reaches addBankAccount is
       worse than no field — this is exactly how accounts created in this modal ended
       up with acctNo:'' while the user believed they had typed one. */
    E('rcAccNo').value = '33580500004521';
    E('rcAccIfsc').value = 'BARB0MERTAC';
    E('rcAccBank').value = 'Bank of Baroda';
    E('rcAccLabel').value = 'BOB Current';
    E('rcAccType').value = 'current';
    E('rcAccSel').value = '__new';
    E('rcAccGo').onclick();
    ok('creating an account from the import modal SAVES the account number', addedAcc && addedAcc.acctNo === '33580500004521');
    ok('  ...and the IFSC', addedAcc && addedAcc.ifsc === 'BARB0MERTAC');
    ok('  ...and still the bank and type it always saved', addedAcc && addedAcc.bank === 'Bank of Baroda' && addedAcc.type === 'current');
    ok('  ...and the transactions landed in that account', TXNS.length === 2 && TXNS.every(t => t.accountId === 'BAnew'));
  }

  /* ══════════ 4. NO REGRESSION: the transactions still parse ══════════ */
  {
    ACCOUNTS = [{ id: 'BA1', bank: 'Bank of Baroda', label: 'BOB Current', acctNo: '33580500004521', type: 'current' }];
    await upload(BOB_ROWS);
    E('rcAccSel').value = 'BA1';
    E('rcAccGo').onclick();
    eq('both real transactions still import', TXNS.length, 2);
    ok('  ...the freight debit kept its amount', TXNS.some(t => t.debit === 54944));
    ok('  ...the customer credit kept its amount', TXNS.some(t => t.credit === 120000));
    ok('  ...and the header did not leak onto the stored transactions', TXNS.every(t => t.acctNo === undefined));
  }

  console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail);
  if (fail) { console.log('\nFailures:'); fails.forEach(f => console.log('  ✗ ' + f)); }
  process.exit(fail ? 1 : 0);
})();
