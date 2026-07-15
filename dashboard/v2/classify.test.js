/* classify.test.js — which register does an uploaded bill belong in?

   THE REPORTED BUG (2026-07-15, real IOC petcoke bill 7002052400.pdf):
   The user selected January on the PURCHASE register, uploaded their petcoke
   purchase, and the app said "Saved 1 bill → moved to the sales register". The
   bill left the purchase register entirely, so it "never showed".

   ROOT CAUSE — a category error, not a parsing failure:
   `documentType` is REQUIRED from the AI; `buyerGstin` is NOT. When the model
   returns no buyer GSTIN, classify() fell through to documentType — and the
   model correctly answers 'sales' for an IOC tax invoice, because it IS a sales
   invoice… for IOC. The model cannot know who WE are.

   THE RULE: documentType describes the DOCUMENT, not our relationship to it.
   Only the GSTINs can say which side we are on. When they can't answer, the
   register the user deliberately chose wins — flagged low so the UI asks.

   Run: node classify.test.js */

const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/extract-schema.js', 'utf8');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), a === b);

/* the REAL classify out of the shipping file — never a copy */
const i = src.indexOf('function classify');
ok('classify() found in extract-schema.js', i >= 0);
const ctx = { up: s => String(s == null ? '' : s).toUpperCase(), console };
vm.createContext(ctx);
vm.runInContext(src.slice(i, src.indexOf('\n  }', i) + 4) + '\nthis.classify = classify;', ctx);

const OURS = '08BNAPM0488E1Z3';          // Gotan
const IOC = '24AAACI1681G1ZV';           // a supplier
const CUST = '08AABCS5768D1Z1';          // a customer
const OWN = [OURS];
const C = (sup, buy, dt, own, hint) => ctx.classify({ supplierGstin: sup, buyerGstin: buy, documentType: dt }, own === undefined ? OWN : own, hint);

/* ── 1. THE EXACT REPORTED CASE ── */
const bug = C(IOC, '', 'sales', OWN, 'purchase');
eq('IOC petcoke, AI says documentType=sales, uploaded on Purchase -> stays PURCHASE', bug.kind, 'purchase');
ok('...and explains itself', typeof bug.why === 'string' && bug.why.length > 10);
ok('...at low confidence, so the UI can ask', bug.conf === 'low');
// The reason must be TRUE. Our GSTIN IS on that bill (as buyer) — the model just
// didn't return it. Saying "neither GSTIN is yours" would be a lie the user can
// see through, and a system that explains itself wrongly is worse than silent.
ok('...and the reason is accurate: the BUYER gstin was not read, not "neither is yours"',
  /buyer.*GSTIN could not be read/i.test(bug.why) && !/Neither GSTIN/i.test(bug.why));
ok('...and says where it filed it', /Purchase register/i.test(bug.why));
const neither = C('99AAAAA1111A1Z9', '27BBBBB2222B1Z8', 'sales', OWN, 'purchase');
ok('a bill where genuinely neither side is ours says exactly that', /Neither GSTIN on this bill is yours/i.test(neither.why));
const noGst = C('', '', 'sales', OWN, 'purchase');
ok('a bill with no readable GSTIN at all says that', /No GSTIN could be read/i.test(noGst.why));

/* ── 2. documentType must NEVER decide the register ── */
eq('documentType=sales cannot move a purchase-register upload', C(IOC, '', 'sales', OWN, 'purchase').kind, 'purchase');
eq('documentType=purchase cannot move a sales-register upload', C('99AAAAA1111A1Z9', '', 'purchase', OWN, 'sales').kind, 'sales');
eq('documentType=unknown changes nothing', C(IOC, '', 'unknown', OWN, 'purchase').kind, 'purchase');
eq('an absent documentType changes nothing', C(IOC, '', null, OWN, 'purchase').kind, 'purchase');
// The whole point: the SAME document, uploaded on either register, follows the
// register — never the model's word for the paper.
eq('same doc on the sales register -> sales', C(IOC, '', 'sales', OWN, 'sales').kind, 'sales');
eq('same doc on the purchase register -> purchase', C(IOC, '', 'sales', OWN, 'purchase').kind, 'purchase');

/* ── 3. the GSTINs always win when they can answer ── */
eq('our GSTIN is the buyer -> PURCHASE', C(IOC, OURS, 'sales', OWN, 'purchase').kind, 'purchase');
eq('...high confidence', C(IOC, OURS, 'sales', OWN, 'purchase').conf, 'high');
eq('...even uploaded on the SALES register (auto-route is the point)', C(IOC, OURS, 'sales', OWN, 'sales').kind, 'purchase');
eq('our GSTIN issued it -> SALES', C(OURS, CUST, 'purchase', OWN, 'purchase').kind, 'sales');
eq('...high confidence', C(OURS, CUST, 'purchase', OWN, 'purchase').conf, 'high');
eq('...even uploaded on the PURCHASE register', C(OURS, CUST, 'purchase', OWN, 'purchase').kind, 'sales');
ok('a high-confidence call says why', /GSTIN/i.test(C(IOC, OURS, 'sales', OWN, 'purchase').why || ''));

/* ── 4. no identity: follow the register and SAY so ── */
const none = C(IOC, OURS, 'sales', [], 'purchase');
eq('no own GSTIN -> follow the register, never the model', none.kind, 'purchase');
eq('...low confidence', none.conf, 'low');
ok('...and names the fix', /Settings|Company profile|GSTIN is not set/i.test(none.why || ''));

/* ── 5. odd shapes must not throw or flip ── */
eq('case/space noise in our own GSTIN still matches', C(IOC, ' 08bnapm0488e1z3 ', 'sales', OWN, 'purchase').kind, 'purchase');
eq('both sides ours (inter-firm) -> follow the register, not a coin flip', C(OURS, OURS, 'sales', OWN, 'purchase').kind, 'purchase');
eq('empty everything -> the register', C('', '', '', OWN, 'sales').kind, 'sales');
eq('no hint at all defaults to purchase', C(IOC, '', 'sales', OWN, undefined).kind, 'purchase');

console.log('\n════ upload → which register ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' CLASSIFY TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
