/* import-wiring.test.js — does the UPLOAD BUTTON actually use the guard?
 *
 * import-guard.test.js proves the engine. This proves the wiring, and the two are
 * not the same test. party-identity.js shipped with 22 green checks while ELEVEN
 * call sites ignored it entirely — the engine was right and the app was wrong, and
 * no engine test could have said so. This file exists so that cannot repeat here.
 *
 * It loads the REAL reconcile.js in a VM, calls the REAL openUpload(), and fires
 * the file input's REAL onchange. Nothing is re-implemented. If someone deletes the
 * ImportGuard call from go() or finishImport(), these fail.
 *
 *   node import-wiring.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ import guard · wired into the upload button ═══\n');

/* ── a DOM real enough to hold state ──────────────────────────────
   The other recon tests use a Proxy that swallows every write. That is fine when
   asserting on a return value, but here the ANSWER IS IN THE DOM — the rejection
   is an innerHTML message. A stub that discards innerHTML would pass whether or
   not the guard fired. So: real objects, keyed by id. */
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
const STATEMENTS = [];
let added = null;
const QLD = {
  fC: n => '₹' + Math.round(+n || 0).toLocaleString('en-IN'),
  fmt: n => String(n), fDS: d => String(d || ''), fL: n => String(n), daysAgo: () => 0,
  co: { name: 'Gotan Lime Industries', short: 'GOTAN' }, COMPANIES: {}, ownFirmNames: ['Gotan Lime Industries'],
  activeCo: 'gotan',
  salesRows: () => [], purchaseRows: () => [], partyRows: () => [], cashbookRows: () => [],
  bankAccounts: () => [], bankAccountById: () => null, bankAccountLabel: () => '',
  recon: { txns: TXNS, aliases: {} }, saveRecon: noop, commit: noop, state: { RECON: { txns: TXNS } },
  uiMonth: () => null, setUiMonth: noop, partyLedger: () => [],
  statementRows: () => STATEMENTS, lastStatement: () => STATEMENTS[0] || null,
  addStatement: s => { added = s; STATEMENTS.push(s); return s; }
};
let toasted = '';
const ctx = {
  console, window: {}, document: doc,
  QLShell: { mount: noop, modal: noop, toast: m => { toasted = m; }, openForm: noop, exportCSV: noop },
  QLD, QLFin: {}, QLMobile: null, QLParty: require('./party-identity.js'),
  ImportGuard: require('./import-guard.js'),
  QLX: { esc: s => String(s == null ? '' : s), svg: () => '', icons: {}, toast: noop, refresh: noop, mount: noop, state: () => ({}) },
  setTimeout: noop, clearTimeout: noop, requestAnimationFrame: noop,
  localStorage: { getItem: () => null, setItem: noop }, sessionStorage: { getItem: () => null, setItem: noop },
  location: { href: 'https://app.quicklimes.com/v2/reconcile', search: '', hash: '', pathname: '/v2/reconcile' },
  history: { replaceState: noop, pushState: noop }, navigator: { userAgent: 'node' }, alert: noop, confirm: () => false,
  crypto: require('crypto').webcrypto,          // the real SHA-256 — this is the identity under test
  Uint8Array, Array, Object, Set, Map, Date, JSON, Math, String, Number, Promise,
  isNaN, parseFloat, parseInt
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.window.QLD = QLD;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'recon-core.js'), 'utf8'), ctx);
/* The REAL QLFin. reconcile.js parses rows through QLFin.colOf/parseDate/parseNum,
   and my first run stubbed only fileToRows — so every row silently failed to parse
   and section 3 passed on ZERO transactions. A vacuous green. Load the real one and
   override only the file READ (there is no disk here); the column mapping, the date
   parsing and the narration parsing are then the code that actually ships. */
try { vm.runInContext(fs.readFileSync(path.join(__dirname, 'finance.js'), 'utf8'), ctx); } catch (e) { console.log('  ⚠ finance.js: ' + e.message); }
ctx.QLFin = ctx.window.QLFin || ctx.QLFin;
vm.runInContext(fs.readFileSync(path.join(__dirname, 'reconcile.js'), 'utf8') + '\n;this.__openUpload = openUpload;', ctx);

/* A File, near enough: the guard only needs name + bytes. */
const BYTES = new TextEncoder().encode('Date,Narration,Debit,Credit,Balance\n');
const mkFile = name => ({ name, type: 'text/csv', arrayBuffer: async () => BYTES.buffer.slice(0) });

const upload = async (file, rows) => {
  toasted = ''; added = null;
  ctx.QLFin.fileToRows = async () => ({ rows: rows || [], kind: 'csv' });
  ctx.__openUpload();
  const inp = els.rcFile;
  inp.files = [file];
  await inp.onchange();
  return els.rcUpMsg.innerHTML || '';
};

(async () => {
  /* ══════════ 1. THE SAME FILE, TWICE ══════════ */
  {
    STATEMENTS.length = 0;
    STATEMENTS.push({ id: 'ST1', file: 'hdfc-january.pdf', rows: 74, sha: 'PLACEHOLDER', uploadedAt: '2026-01-31T10:00:00.000Z' });
    // the real hash of the real bytes, so the fixture cannot drift from the code
    const sha = require('crypto').createHash('sha256').update(Buffer.from(BYTES)).digest('hex');
    STATEMENTS[0].sha = sha;

    const before = TXNS.length;
    const out = await upload(mkFile('hdfc-january (1).pdf'));
    ok(/already imported/i.test(out), 'THE GATE: re-uploading the same file is REFUSED by the upload handler');
    ok(/hdfc-january\.pdf/.test(out), '  and it names the earlier upload, so the user knows which one');
    ok(TXNS.length === before, '  NOTHING was written to the books');
    ok(added === null, '  and no statement was logged');
    /* The rename is the whole point — this is how the same statement gets in twice. */
    ok(/Renaming/i.test(out), '  it explains that renaming the file does not make it new');
  }

  /* ══════════ 2. A NEW FILE IS NOT BLOCKED ══════════ */
  {
    STATEMENTS.length = 0;
    const out = await upload(mkFile('hdfc-february.csv'), [
      ['Date', 'Narration', 'Debit', 'Credit', 'Balance'],
      ['14/12/2025', 'NEFT PRINCE LIME 0012545409', '', '100000', '500000']
    ]);
    ok(!/already imported/i.test(out), 'A FILE NEVER SEEN BEFORE IS NOT BLOCKED — the gate must not eat real work');
  }

  /* ══════════ 3. THE REPORTED BUG, THROUGH THE REAL HANDLER ══════════ */
  {
    STATEMENTS.length = 0; TXNS.length = 0;
    /* Shaped like a real HDFC export — including the Chq/Ref No COLUMN, which is
       where the reference actually lives. My first fixture put the UTR in the
       narration as a bare 10-digit number; parseNarration does not read that as a
       UTR (it wants a bank code like HDFCN5… or a 12-digit UPI id), so the guard
       correctly saw no reference and kept all three rows. The fixture was wrong,
       not the app — but it is worth knowing WHERE the reference comes from: the
       ref column first, the narration second. */
    const rows = [
      ['Date', 'Narration', 'Chq/Ref No', 'Debit', 'Credit', 'Balance'],
      ['14/12/2025', 'NEFT CR PRINCE LIME INDUSTRIES', '0012545409', '', '100000', '600000'],
      ['14/12/2025', 'NEFT CR PRINCE LIME INDUSTRIES', '0012545409', '', '100000', '700000'],
      ['14/12/2025', 'NEFT CR PRINCE LIME INDUSTRIES', '0012545409', '', '100000', '800000']
    ];
    await upload(mkFile('prince.csv'), rows);
    const utrs = TXNS.filter(t => /0012545409/.test((t.utr || '') + (t.ref || '') + (t.raw || '')));
    ok(TXNS.length > 0, 'the import actually stored rows (if this fails the fixture is wrong, not the app)');
    ok(utrs.length <= 1, 'THE BUG: one payment listed three times in one file enters the books ONCE (got ' + utrs.length + ')');
    ok(added !== null, 'the statement is logged, so the NEXT upload of this file can be caught');
    ok(added && added.sha && added.sha.length === 64, '  with the real SHA-256 of its bytes — not blank');
  }

  /* ══════════ 4. NO REFERENCE → BOTH SURVIVE, THROUGH THE REAL HANDLER ══════════
     The dangerous direction. Two real ₹1,00,000 payments from one customer on one
     day, with no reference to tell them apart. If the gate ever eats one of these,
     the books quietly show less than the bank and nobody knows to look. */
  {
    STATEMENTS.length = 0; TXNS.length = 0;
    await upload(mkFile('twopay.csv'), [
      ['Date', 'Narration', 'Debit', 'Credit', 'Balance'],
      ['14/12/2025', 'CASH DEP PRINCE LIME INDUSTRIES', '', '100000', '600000'],
      ['14/12/2025', 'CASH DEP PRINCE LIME INDUSTRIES', '', '100000', '700000']
    ]);
    ok(TXNS.length === 2, 'TWO REAL PAYMENTS with NO reference BOTH survive the real upload path (got ' + TXNS.length + ')');
  }

  console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
  process.exit(fail ? 1 : 0);
})();
