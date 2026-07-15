/* identity.test.js — "new company profile sales or purchase not working"

   THE BUG (reported 2026-07-15, from a real MTC Lime account):
   A brand-new company signs up. signup.html never asks for a GST number, and
   SELLER_DEFAULTS only hardcodes GOTAN / DESHWALI — so COMPANIES[id].gstin is
   '' and ownGstins reaches the parser EMPTY. With no identity to anchor on:
     - sellerG = the first valid GSTIN on the page = the bill's own ISSUER,
       so the user's own firm shows up as the "Party / Customer"
     - direction falls back to `ownG.indexOf(issuerG) >= 0 ? sales : purchase`,
       which is ALWAYS false when ownG is empty → EVERY bill becomes a PURCHASE
   So for any new customer, a sales upload can never work. Deterministic, 100%.

   THE RULE: with no identity, the parser must say "I don't know" — never guess
   a direction. A wrong direction silently misfiles money into the wrong register
   and corrupts GST; an honest "unknown" just asks the user.
   Run: node identity.test.js */

const OCR = require('./bill-ocr.js');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), a === b);

/* The real bill from the screenshot: GOTAN issues it (Gotan is the SELLER). */
const GOTAN_SALES_BILL = [
  'GOTAN LIME INDUSTRIES',
  'TALANPUR ROAD, SH 86B, GOTAN, DISTRICT - NAGAUR',
  'GSTIN 08BNAPM0488E1Z3',
  'TAX INVOICE',
  'Invoice No : 165/2025-26   Dated : 31-12-2025',
  'Billed To : SHREE CEMENT LIMITED',
  'GSTIN 08AABCS5768D1Z1',
  'Quick Lime HSN 25221000',
  'Quantity 31.63 TO',
  'Taxable Value 379560.00',
  'CGST 2.5% 9489.00',
  'SGST 2.5% 9489.00',
  'Grand Total 398538.00',
].join('\n');

/* ── 1. THE REPORTED BUG: a new company with no GSTIN on file ── */
const newCo = OCR.parse(GOTAN_SALES_BILL, { ownGstins: [], ownNames: [] });

ok('new company: parser must NOT claim a direction it cannot know',
  newCo.fields.direction !== 'purchase' && newCo.fields.direction !== 'sales');
ok('new company: must warn that the firm GSTIN is not set',
  (newCo.warnings || []).some(w => /gstin|company profile|settings|identity/i.test(w)));
// NOT "blank the supplier": with no identity the issuer is still the best guess
// for the common case (a purchase bill), and blanking a probably-correct value
// helps nobody. The harm in the screenshot was the CONFIDENCE — the user's own
// firm asserted as the party at 99%. So it must be flagged for review, not
// asserted, until the firm has an identity.
ok('new company: the party guess must be flagged for review, not asserted',
  (newCo.review || []).includes('supplierGstin') || (newCo.review || []).includes('supplier'));
ok('new company: the party must not carry high confidence',
  (newCo.confidence || {}).supplierGstin == null || newCo.confidence.supplierGstin <= 0.6);

/* ── 2. THE FIX: once the firm's GSTIN is set, everything resolves ── */
const gotan = OCR.parse(GOTAN_SALES_BILL, {
  ownGstins: ['08BNAPM0488E1Z3'], ownNames: ['GOTAN LIME INDUSTRIES'], selfGstin: '08BNAPM0488E1Z3',
});
eq('Gotan issued it -> SALE', gotan.fields.direction, 'sales');
eq('the party is the CUSTOMER, not us', gotan.fields.supplierGstin, '08AABCS5768D1Z1');
ok('our own GSTIN is never the party', gotan.fields.supplierGstin !== '08BNAPM0488E1Z3');
ok('a resolved identity produces no identity warning',
  !(gotan.warnings || []).some(w => /gstin.*not set|company profile/i.test(w)));

/* ── 3. MTC Lime (a genuinely different firm) receiving Gotan's bill ── */
const mtc = OCR.parse(GOTAN_SALES_BILL, {
  ownGstins: ['08MTCLM1234A1Z5'], ownNames: ['MTC LIME'], selfGstin: '08MTCLM1234A1Z5',
});
eq('someone else issued it -> PURCHASE', mtc.fields.direction, 'purchase');
eq('the party is the issuer Gotan', mtc.fields.supplierGstin, '08BNAPM0488E1Z3');

/* ── 4. the direction rule must hold regardless of who we are ── */
ok('same bill, opposite direction for issuer vs recipient',
  gotan.fields.direction === 'sales' && mtc.fields.direction === 'purchase');

/* ── 5. an unknown identity must not silently become a purchase anywhere ── */
[[], undefined, null].forEach((g, i) => {
  const r = OCR.parse(GOTAN_SALES_BILL, { ownGstins: g, ownNames: [] });
  ok('no-identity variant #' + i + ' never guesses "purchase"', r.fields.direction !== 'purchase');
});

/* ── 6. ONE GSTIN rule everywhere ──────────────────────────────────────
   The GSTIN is validated in three places: signup.php (PHP), data.js
   (Settings → Company profile) and bill-ocr.js (the parser). If they disagree,
   signup happily stores an identity that Settings then refuses to edit, or the
   parser ignores. Load the REAL rules and prove they agree — never a copy. */
const fs = require('fs');
const dataSrc = fs.readFileSync(__dirname + '/data.js', 'utf8');
const phpSrc = fs.readFileSync(__dirname + '/../api/signup.php', 'utf8');

const m = dataSrc.match(/const validGstinFmt = ([^;]+);/);
ok('data.js exposes validGstinFmt', !!m);
const validGstinFmt = eval('(' + (m ? m[1] : '() => false') + ')');

// signup.php's rule, mirrored: the shape regex AND the state-code range. The
// range matters — without it signup accepted state code 99, storing an identity
// the parser would then ignore. (This test caught exactly that.)
const phpRe = phpSrc.match(/preg_match\('\/\^(.+?)\$\/'/);
ok('signup.php validates the GSTIN shape', !!phpRe);
ok('signup.php also validates the state code (01-38), not just the shape',
  /substr\(\$gstin, 0, 2\) >= 1/.test(phpSrc) && /substr\(\$gstin, 0, 2\) <= 38/.test(phpSrc));
const phpShape = phpRe ? new RegExp('^' + phpRe[1] + '$') : /$^/;
const phpJs = { test: g => phpShape.test(g) && +g.slice(0, 2) >= 1 && +g.slice(0, 2) <= 38 };

const CASES = [
  ['08BNAPM0488E1Z3', true, 'Gotan (real)'],
  ['08NLIPS9801K1Z5', true, 'Deshwali (real)'],
  ['08AABCS5768D1Z1', true, 'a customer'],
  ['', false, 'blank'],
  ['ABC', false, 'junk'],
  ['08BNAPM0488E1Z', false, '14 chars (one short)'],
  ['08BNAPM0488E1Z33', false, '16 chars (one long)'],
  ['99BNAPM0488E1Z3', false, 'state code 99 does not exist'],
  ['00BNAPM0488E1Z3', false, 'state code 00'],
  ['081NAPM0488E1Z3', false, 'digit where a letter belongs'],
];
CASES.forEach(([g, want, why]) => {
  eq('data.js: ' + why, !!validGstinFmt(g), want);
  eq('signup.php agrees: ' + why, !!phpJs.test(g), want);
  // The parser's own rule must agree too, or a GSTIN we store is one it ignores.
  if (g) eq('parser agrees: ' + why, !!OCR.validGstin(g), want);
});

/* ── 7. THE IMPORTER MUST HONOUR "no identity" ─────────────────────────
   Found by an adversarial audit AFTER the first fix shipped: making the PARSER
   refuse to guess was not enough. bulk.js detectType did
     var type = cfg.kind || 'purchase'
   so an unknown direction silently became "whatever register you're standing
   on". Worse, recompute() keeps review-flags only for EMPTY fields, so the
   parser's flagged (but non-empty) GSTIN guess was stripped and the bill went
   status 'ready' — and the batch table (2+ bills) renders only bill.reason,
   never the parser's _warn. Net: a no-identity batch posted SILENTLY.
   The fix must hold at the IMPORTER, not just the parser. */
const vm = require('vm');
const bulkSrc = fs.readFileSync(__dirname + '/bulk.js', 'utf8');
const cut = (a, b) => { const i = bulkSrc.indexOf(a); return bulkSrc.slice(i, bulkSrc.indexOf(b, i) + b.length); };
const bulkCtx = { window: { QLExtract: { validGstin: OCR.validGstin } }, SEQ: 1, console };
vm.createContext(bulkCtx);
vm.runInContext([cut('function detectType', '\n  }'), cut('function makeBill', '\n  }'),
  cut('function recompute', '\n  }'), cut('function nameKey', '\n  }'), cut('function invKey', '\n  }'),
  // isoDate: the date gate recompute() depends on. It must be loaded here too,
  // or the harness fails in a way that says nothing about the real code.
  cut('function isoDate', '\n  }'),
  'this.makeBill = makeBill;'].join('\n'), bulkCtx);

const CFG = kind => ({
  kind, noun: 'bill',
  fields: [{ key: 'date', required: true }, { key: 'party', required: true }, { key: 'billno' }, { key: 'amount', required: true }],
  ocrMap: { date: 'date', party: 'name', billno: 'docno', amount: 'total', gstin: 'gstin' },
  buildRow: get => ({ date: get('date'), party: get('party'), amount: +get('amount') || 0 }),
});
const mkBill = (opts, kind) => bulkCtx.makeBill(OCR.legacy(OCR.parse(GOTAN_SALES_BILL, opts)), { name: 'Sales Bill.pdf' }, 'ocr', CFG(kind));

const noId = mkBill({ ownGstins: [] }, 'purchase');
ok('no identity: the importer must NOT mark the bill ready to post',
  noId.status !== 'ready');
eq('no identity: bill is held for review', noId.status, 'review');
ok('no identity: the user is TOLD why (bill.reason is what the batch table renders)',
  /GSTIN is not set/i.test(noId.reason || ''));
ok('no identity: the reason names where to fix it',
  /Settings/i.test(noId.reason || '') && /Company profile/i.test(noId.reason || ''));

// The parser's own flag must survive to the importer — a warning string alone
// was not enough, because openTable never renders _warn.
ok('legacy() exposes noid so the importer can BRANCH, not just print prose',
  OCR.legacy(OCR.parse(GOTAN_SALES_BILL, { ownGstins: [] })).noid === true);
ok('noid is false once the firm has an identity',
  OCR.legacy(OCR.parse(GOTAN_SALES_BILL, { ownGstins: ['08BNAPM0488E1Z3'], selfGstin: '08BNAPM0488E1Z3' })).noid === false);

// A company WITH an identity must be completely unaffected by all of the above.
const gotanBill = mkBill({ ownGstins: ['08BNAPM0488E1Z3'], selfGstin: '08BNAPM0488E1Z3' }, 'purchase');
eq('identity set: normal bill still imports cleanly', gotanBill.status, 'ready');
ok('identity set: no GSTIN nag on a bill we CAN classify',
  !/GSTIN is not set/i.test(gotanBill.reason || ''));
eq('identity set: our own sales bill auto-routes to the Sales register', gotanBill.crossKind, 'sales');

// Same, on the Sales register — the register must not silently win either way.
const noIdOnSales = mkBill({ ownGstins: [] }, 'sales');
ok('no identity on the Sales register is held for review too', noIdOnSales.status === 'review');

console.log('\n════ company identity / bill direction ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' IDENTITY TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
