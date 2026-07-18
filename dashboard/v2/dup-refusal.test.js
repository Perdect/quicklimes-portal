/* dup-refusal.test.js — "we can not upload duplicates file, show error its
 * already uploaded, no need to read quantities separate when uploaded documents
 * then read same time"
 *
 * Two buttons came off the Purchase register: "Read quantities" and "Find
 * duplicates". Both were brooms for bugs that are fixed at the source now — the
 * importer reads qty at import, and the register REFUSES a duplicate before it is
 * stored. This file pins that the things that replaced them actually work, because
 * deleting a button whose replacement is broken is how a fixed bug comes back
 * looking like a missing feature.
 *
 * THE BUG THIS FILE WAS WRITTEN FOR. The gate worked the whole time — addPurchase
 * called ImportGuard and refused the duplicate. What did NOT work was TELLING HIM.
 * postOne() wrote the guard's sentence to `bill.err`; the batch table renders
 * `bill.reason` and the drawer renders `bill.error`. Three names, and the one the
 * message was in was printed by nothing. So a re-uploaded bill landed in the
 * Failed tab as a bare red badge with no reason, and the owner — correctly — read
 * that as the app silently not saving his bill. He asked for an error message for
 * a refusal that was already happening; it just had no voice.
 *
 * SECOND, SUBTLER BUG. The review table had its OWN duplicate opinion (cfg.keyOf =
 * bill|gstin|amount|date on Purchase) which is NARROWER than the gate it has to
 * predict (ImportGuard.docKey = number|party). Re-upload a bill whose OCR read the
 * amount a rupee differently and the pre-pass called it "ready" — then the register
 * refused it at save. A pre-pass that disagrees with the gate promises an import
 * that cannot happen. It asks the gate now.
 *
 *   node dup-refusal.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ duplicates are refused — and he is TOLD ═══\n');

const V2 = __dirname;
const dsrc = fs.readFileSync(path.join(V2, 'data.js'), 'utf8');
const bsrc = fs.readFileSync(path.join(V2, 'bulk.js'), 'utf8');
const psrc = fs.readFileSync(path.join(V2, 'purchase.js'), 'utf8');
const ssrc = fs.readFileSync(path.join(V2, 'sales.js'), 'utf8');
const gsrc = fs.readFileSync(path.join(V2, 'import-guard.js'), 'utf8');
const grabBlock = (src, k, end) => { const i = src.indexOf(k); if (i < 0) throw new Error('not found in source: ' + k); return src.slice(i, src.indexOf(end, i) + end.length); };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ══════════ 1. THE BUTTONS ARE GONE ══════════
   Not "hidden" — gone. A hidden button is a phantom that the next person re-wires. */
{
  const pcode = strip(psrc), scode = strip(ssrc);
  ok(!/label:\s*t?\(?'Read quantities'/.test(pcode), 'the "Read quantities" button is gone from the Purchase toolbar');
  ok(!/label:\s*t?\(?'Find duplicates'/.test(pcode), 'the "Find duplicates" button is gone from the Purchase toolbar');
  ok(!/QLDedupe/.test(pcode), '  and nothing on the page calls QLDedupe any more');
  ok(!/openQtyBackfill/.test(pcode), '  the manual backfill panel is gone with its button');
  ok(!/Read quantities|Find duplicates|QLDedupe/.test(scode), 'neither button ever existed on Sales, and still does not');

  /* The REPLACEMENT is wired. This is the half-wired bug class: a feature that is
     built and never called is invisible to reading and to green tests. Grep the
     CALLER, not the definition. */
  ok(/runQtyBackfill\(\);/.test(pcode), 'the automatic backfill is CALLED on the Purchase page (not merely defined)');
  ok(/QLQtyBackfill\.auto\(\)/.test(pcode), '  and it calls QLQtyBackfill.auto()');
  ok(/QLQtyBackfill\.report\(o\)/.test(pcode), '  and reports the result — a silent background write is the ai-status bug');
}

/* ══════════ 2. THE DEDUPE MODULE IS DELETED, NOT ORPHANED ══════════
   Dead files are how removed things come back. */
{
  ['dedupe.js', 'dedupe-ui.js', 'dedupe.test.js', 'dedupe-wiring.test.js'].forEach(f => {
    ok(!fs.existsSync(path.join(V2, f)), f + ' is deleted, not left lying around');
  });
  const pages = fs.readdirSync(V2).filter(f => /\.html$/.test(f));
  const still = pages.filter(f => /dedupe/.test(fs.readFileSync(path.join(V2, f), 'utf8')));
  eq('NO page still loads a dedupe script (' + pages.length + ' pages checked)', still, []);

  /* removeReconTxns existed only to serve dedupe's broom, and it HARD-deletes bank
     rows — no soft-delete, no Trash, no restore. With no caller it is a loaded gun
     sitting on the API. */
  ok(!/function removeReconTxns/.test(dsrc), 'removeReconTxns (hard-splice of bank rows) went with the broom that used it');
  ok(!/\bremoveReconTxns\b/.test(strip(dsrc)), '  and is off the QLD API surface entirely');
}

/* ══════════ 3. THE GATE STILL REFUSES ══════════
   The whole removal rests on this. If the gate ever stops refusing, the button we
   deleted was load-bearing after all — so this is the assertion that must never be
   weakened to make something else pass. */
const G = {}; vm.createContext(G);
vm.runInContext(gsrc + '\nthis.ImportGuard = ImportGuard;', G);

const S = { SALES: [], PURCHASES: [], PARTIES: [] };
const D = {
  console, Math, Object, Array, Number, String, JSON, Date, Promise, setTimeout, isFinite, parseFloat, S,
  ImportGuard: G.ImportGuard, upsertParty: () => {}, commit: () => {}, toISODate: d => d, fmtISO: () => '2026-07-17'
};
vm.createContext(D);
vm.runInContext([
  grabBlock(dsrc, 'function dupCheck(e, existing) {', '\n  }'),
  grabBlock(dsrc, 'function addSale(e) {', '\n  }'),
  grabBlock(dsrc, 'function addPurchase(e) {', '\n  }'),
  'this.addPurchase = addPurchase; this.addSale = addSale;'
].join('\n'), D);

const BILL = { bill: 'INV-77', sup: 'Indian Oil', gstin: '24AAACI1681G1ZV', date: '2026-05-01', taxable: 100000, total: 105000 };
{
  S.PURCHASES.length = 0;
  eq('the first upload of a bill is stored', D.addPurchase(Object.assign({}, BILL)).ok, true);
  eq('  the register has it', S.PURCHASES.length, 1);

  const r = D.addPurchase(Object.assign({}, BILL));
  eq('THE SAME BILL AGAIN IS REFUSED', r.ok, false);
  eq('  it is refused AS a duplicate', r.dup, true);
  eq('  and NOTHING was stored — the refusal is real, not a badge', S.PURCHASES.length, 1);
  ok(/already recorded/.test(r.reason || ''), '  with a sentence a human can read: “' + r.reason + '”');

  /* The amount-differs case: the one the old pre-pass let through. */
  const r2 = D.addPurchase(Object.assign({}, BILL, { taxable: 100001, total: 105002 }));
  eq('the same invoice with a DIFFERENT amount is still refused', r2.ok, false);
  ok(/different amount/.test(r2.reason || ''), '  and names both figures: “' + r2.reason + '”');
  eq('  still nothing stored', S.PURCHASES.length, 1);

  /* It must not refuse things that are NOT duplicates. A gate that eats real bills
     is worse than the duplicates it stops. */
  eq('a different bill number from the same supplier goes in', D.addPurchase(Object.assign({}, BILL, { bill: 'INV-78' })).ok, true);
  eq('the same number from a DIFFERENT supplier goes in', D.addPurchase(Object.assign({}, BILL, { gstin: '08BNAPM0488E1Z3', sup: 'Acme' })).ok, true);
  eq('  both stored', S.PURCHASES.length, 3);
}

/* ══════════ 4. THE REFUSAL REACHES THE SCREEN ══════════ */
const B = {
  console, Math, Object, Array, Number, String, JSON, Date, Promise, setTimeout, isFinite, parseFloat,
  window: {}, QLD: {}, ImportGuard: G.ImportGuard, TOASTS: [], BATCH: {},
  hideProgress: () => {}, aiNote: () => {}, openDrawer: () => {}, openTable: () => {}
};
B.window.window = B.window;
vm.createContext(B);
vm.runInContext([
  'var toast = function (m, t) { TOASTS.push([m, t]); };',
  grabBlock(bsrc, 'function valsToGeneric(bill, cfg) {', '\n  }'),
  grabBlock(bsrc, 'async function postOne(bill, cfg) {', '\n  }'),
  grabBlock(bsrc, 'async function attachScan(bill, p) {', '\n  }'),
  grabBlock(bsrc, 'function dupNote(reason)', '\n'),
  grabBlock(bsrc, 'function finishBatch(cfg) {', '\n  }'),
  'this.postOne = postOne; this.finishBatch = finishBatch; this.dupNote = dupNote;'
].join('\n'), B);
ok(typeof B.postOne === 'function', 'the REAL postOne loaded out of bulk.js');
ok(typeof B.finishBatch === 'function', 'the REAL finishBatch loaded out of bulk.js');

/* The REAL cfg.add, as purchase.js defines it — it is what turns the gate's
   {ok:false} into the throw postOne catches. */
ok(/const r = Q\.addPurchase\(p\);\s*\n\s*if \(r && r\.ok === false\) throw new Error\(r\.reason\);/.test(psrc),
  'purchase cfg.add RAISES the gate\'s refusal (addPurchase RETURNS it — a caller that ignores the return imports duplicates)');
ok(/const r = Q\.addSale\(s\);\s*\n\s*if \(r && r\.ok === false\) throw new Error\(r\.reason\);/.test(ssrc),
  'sales cfg.add does too');

/* THE DELETED-BILL FIX, pinned at the source. existing() (the dedup set) and
   rows() (the gate's list) must share one "live" predicate — when they diverged,
   a deleted bill was refused on re-upload. Assert both files derive both from the
   same livePurchases()/liveSales(), so no future edit can un-sync them. */
ok(/const livePurchases = \(\) => Q\.state\.PURCHASES\.filter\(p => !p\._del && !p\._arch && \(p\.status \|\| 'pending'\) !== 'cancelled'\)/.test(psrc),
  'purchase.js defines ONE livePurchases() predicate — deleted, archived AND voided are all retired');
ok(/existing: \(\) => new Set\(livePurchases\(\)/.test(psrc) && /rows: livePurchases/.test(psrc),
  '  and BOTH existing() and rows() use it — they cannot disagree about a retired bill');
ok(/const liveSales = \(\) => Q\.state\.SALES\.filter\(s => !s\._del && !s\._arch && \(s\.status \|\| 'pending'\) !== 'cancelled'\)/.test(ssrc),
  'sales.js defines ONE liveSales() predicate — deleted, archived AND voided are all retired');
ok(/existing: \(\) => new Set\(liveSales\(\)/.test(ssrc) && /rows: liveSales/.test(ssrc),
  '  and BOTH existing() and rows() use it');

/* bulk.js must not seed the within-batch set from existing() — that seeding is
   exactly what let a deleted bill flag its own re-upload as "twice in this
   upload". The within-batch set starts empty; existing() is a guard-absent
   backstop only. */
ok(/var batchSeen = new Set\(\);/.test(bsrc) && !/batchSeen[\s\S]{0,60}cfg\.existing/.test(bsrc),
  'bulk.js within-batch set (batchSeen) is NOT seeded from existing() — the gate owns register-dup');
ok(/if \(!guard\) \{[\s\S]{0,120}cfg\.existing/.test(bsrc),
  '  existing() is consulted ONLY as a backstop when there is no ImportGuard');

const purAdd = (p) => { const r = D.addPurchase(p); if (r && r.ok === false) throw new Error(r.reason); };
const cfg = {
  kind: 'purchase', noun: 'bill', ocrMap: {},
  buildRow: get => ({ bill: get('bill'), sup: get('sup'), gstin: get('gstin'), date: get('date'), taxable: +get('taxable') || 0, total: +get('total') || 0 }),
  add: purAdd,
  keyOf: p => (String(p.bill || '') + '|' + String(p.gstin || p.sup || '') + '|' + Math.round(+p.taxable || 0) + '|' + (p.date || '')).toUpperCase(),
  /* existing() and rows() must agree on what "live" means — a deleted bill is
     neither. Mirrors the real purchase.js: both derive from the SAME predicate. */
  existing: () => new Set(S.PURCHASES.filter(p => !p._del && p.bill).map(p => (String(p.bill || '') + '|' + String(p.gstin || p.sup || '') + '|' + Math.round(+p.taxable || 0) + '|' + (p.date || '')).toUpperCase())),
  rows: () => S.PURCHASES.filter(p => !p._del)
};
const vals = o => ({ bill: o.bill, sup: o.sup, gstin: o.gstin, date: o.date, taxable: String(o.taxable), total: String(o.total) });
const mk = (id, o) => ({ id, kind: 'ocr', file: null, g: {}, vals: vals(o), status: 'ready', reviewFields: [], built: null });

/* ── the field the TABLE actually prints ── */
const rowRender = bsrc.slice(bsrc.indexOf('rowsFor().map(function (b) {'), bsrc.indexOf("}).join('')", bsrc.indexOf('rowsFor().map(function (b) {')));
ok(/b\.reason/.test(rowRender), 'the batch table prints b.reason under the status badge');

(async () => {
  /* ── a refused bill carries its reason into the field that gets RENDERED ── */
  {
    S.PURCHASES.length = 0;
    const first = mk('b1', BILL);
    await B.postOne(first, cfg);
    eq('first upload saves', S.PURCHASES.length, 1);

    const dup = mk('b2', BILL);
    const okd = await B.postOne(dup, cfg);
    eq('THE SAME BILL AGAIN: postOne reports failure', okd, false);
    eq('  it is not saved', S.PURCHASES.length, 1);
    eq('  the row goes to the Failed tab', dup.status, 'failed');
    ok(/already recorded/.test(dup.err || ''), '  the guard\'s sentence is on bill.err');
    /* THE FIX. Before this, bill.reason was undefined and the Failed row was a bare
       badge — the refusal happened and said nothing. */
    ok(/already recorded/.test(dup.reason || ''), '  AND ON bill.reason — the field the table renders: “' + dup.reason + '”');
    eq('  err and reason agree — one message, not two that can drift', dup.reason, dup.err);
  }

  /* ── the pre-pass now predicts the gate instead of guessing ── */
  {
    S.PURCHASES.length = 0;
    D.addPurchase(Object.assign({}, BILL));            // already in the books

    /* Same invoice, amount read a rupee differently by the OCR. cfg.keyOf's key
       includes the amount, so the OLD pre-pass called this "ready" and let the
       register refuse it at save. */
    const b = mk('b3', Object.assign({}, BILL, { taxable: 100001, total: 105002 }));
    b.built = cfg.buildRow(k => b.vals[k] != null ? b.vals[k] : '');
    B.BATCH = { bills: [b], cfg: cfg, dropped: [] };
    B.finishBatch(cfg);

    eq('a re-upload the OCR read slightly differently is caught BEFORE import', b.status, 'duplicate');
    ok(b.dupe === true, '  flagged as a duplicate');
    ok(b.dupHard === true, '  and as one already in the register — no click can store it');
    ok(/^Already uploaded — /.test(b.reason || ''), '  the row SAYS "Already uploaded": “' + b.reason + '”');
    ok(/different amount/.test(b.reason || ''), '  and carries the gate\'s own words, both figures included');

    /* Proof it is the GATE'S key doing this, not cfg.keyOf: keyOf's key differs. */
    const k1 = cfg.keyOf(cfg.buildRow(kk => vals(BILL)[kk] || ''));
    ok(k1 !== cfg.keyOf(b.built), '  (cfg.keyOf alone would NOT have matched these two — the guard is what caught it)');
  }

  /* ── the same file twice in ONE batch: the gate cannot see this, keyOf must ── */
  {
    S.PURCHASES.length = 0;
    const a = mk('c1', BILL), c = mk('c2', BILL);
    [a, c].forEach(x => { x.built = cfg.buildRow(k => x.vals[k] != null ? x.vals[k] : ''); });
    B.BATCH = { bills: [a, c], cfg: cfg, dropped: [] };
    B.finishBatch(cfg);
    eq('the first copy in the batch stays importable', a.status, 'ready');
    eq('  the second copy is flagged', c.status, 'duplicate');
    ok(/twice in this upload/.test(c.reason || ''), '  and says why: “' + c.reason + '”');
    ok(c.dupHard === false, '  but NOT as hard — neither copy is saved yet, so this one is genuinely overridable');
  }

  /* ── DELETE, then re-upload the same bill. It must be importable again. ──
     The owner deleted a bill, uploaded the same file, and the app still said
     "Already uploaded". Delete is soft (data.js sets _del), so the record keeps
     its bill number. rows() excludes _del, so the GATE correctly says not-dup —
     but the dedup `seen` set was seeded from existing(), which did NOT exclude
     _del, so a deleted bill's key lingered and flagged the re-upload as a dup
     "twice in this upload" (a within-batch message, for a bill not in the batch).
     A deleted thing is not an existing thing. */
  {
    S.PURCHASES.length = 0;
    D.addPurchase(Object.assign({}, BILL));
    S.PURCHASES[0]._del = { at: 'now', by: 'owner' };        // the user hits Delete

    /* ADVERSARIAL cfg: its existing() deliberately still reports the deleted
       bill's key (the exact bug the real code had). finishBatch must IGNORE
       existing() for register-dup and trust rows() (the gate), which excludes
       _del. This pins the root fix: within-batch dedup no longer trusts
       existing(), so a wrong existing() can never resurrect a deleted bill. */
    const advCfg = Object.assign({}, cfg, {
      existing: () => new Set(S.PURCHASES.filter(p => p.bill).map(cfg.keyOf))   // NO !_del — on purpose
    });
    const again = mk('e1', Object.assign({}, BILL));         // same file, uploaded again
    again.built = cfg.buildRow(k => again.vals[k] != null ? again.vals[k] : '');
    B.BATCH = { bills: [again], cfg: advCfg, dropped: [] };
    B.finishBatch(advCfg);
    eq('a DELETED bill re-uploaded is importable again, even when existing() lies', again.status, 'ready');
    ok(!again.dupe, '  not flagged as a duplicate');
    ok(!again.reason, '  and no "Already uploaded" message: “' + (again.reason || '') + '”');
  }

  /* ── THE SECOND DOOR: the SAVE GATE itself must ignore deleted records. ──
     Yesterday's fix corrected the review pre-pass (cfg.existing/rows exclude
     _del) — but addSale/addPurchase run dupCheck against the RAW arrays, so a
     deleted bill sailed through review and was then refused at save: "still I
     can't upload sales bill". The two doors MUST agree on what "live" means. */
  {
    S.PURCHASES.length = 0;
    D.addPurchase(Object.assign({}, BILL));
    S.PURCHASES[0]._del = { at: 'now', by: 'owner' };          // user deletes the bill
    const r = D.addPurchase(Object.assign({}, BILL));           // same bill, uploaded again
    ok(r && r.ok === true, 'SAVE GATE (purchase): a deleted bill can be added again — got ' + JSON.stringify(r && r.reason || r));
    eq('  and it is really saved', S.PURCHASES.filter(p => !p._del).length, 1);
  }
  {
    S.SALES.length = 0;
    const INV = { inv: 'INV-7', date: '2026-06-08', party: 'Ambuja Cement', gstin: '24AAACA1234A1Z5', qty: 10, rate: 100, gstR: 5 };
    D.addSale(Object.assign({}, INV));
    S.SALES[0]._del = { at: 'now', by: 'owner' };
    const r = D.addSale(Object.assign({}, INV));
    ok(r && r.ok === true, 'SAVE GATE (sales): a deleted invoice can be added again — got ' + JSON.stringify(r && r.reason || r));
    eq('  and it is really saved', S.SALES.filter(s => !s._del).length, 1);
    /* the gate still refuses a LIVE duplicate — the fix must not open the door to real dups */
    const again = D.addSale(Object.assign({}, INV));
    ok(again && again.ok === false, '  but a LIVE duplicate is still refused: ' + JSON.stringify(again && again.reason));
  }

  /* ── VOIDED is not live either. Sales offers TWO removal actions — Delete
     (Trash, _del) and Void/Cancel (status 'cancelled') — and the void dialog
     itself promises the invoice "drops out of live sales totals". The gate
     kept counting voided documents, so a voided invoice blocked its own
     re-upload exactly like the deleted one did: "still I can't upload sales
     bill". One rule for every door: not live ⇒ cannot block an upload. ── */
  /* voidRecord itself needs half of data.js (TRASHABLE, whoami, audit) — so pin
     its exact writes from SOURCE, then apply those same writes here. If voiding
     ever changes shape, the pin fails and this simulation must follow. */
  {
    const vsrc = grabBlock(dsrc, 'function voidRecord(module, idx, reason) {', '\n  }');
    ok(/rec\._void = \{/.test(vsrc) && /rec\.status = 'cancelled';/.test(vsrc),
      'voidRecord marks a record with _void + status "cancelled" (the writes simulated below)');
  }
  {
    S.SALES.length = 0;
    const INV = { inv: 'INV-9', date: '2026-06-10', party: 'Ultratech', gstin: '24AAACU5678B1Z9', qty: 5, rate: 200, gstR: 5 };
    D.addSale(Object.assign({}, INV));
    S.SALES[0]._void = { at: 'now', by: 'owner', reason: 'wrong party' };   // exactly what voidRecord writes
    S.SALES[0].status = 'cancelled';
    const r = D.addSale(Object.assign({}, INV));
    ok(r && r.ok === true, 'SAVE GATE (sales): a VOIDED invoice can be uploaded again — got ' + JSON.stringify(r && r.reason || r));
  }
  {
    S.PURCHASES.length = 0;
    D.addPurchase(Object.assign({}, BILL));
    S.PURCHASES[0]._void = { at: 'now', by: 'owner', reason: 'duplicate entry' };
    S.PURCHASES[0].status = 'cancelled';
    const r = D.addPurchase(Object.assign({}, BILL));
    ok(r && r.ok === true, 'SAVE GATE (purchase): a VOIDED bill can be uploaded again — got ' + JSON.stringify(r && r.reason || r));
  }

  /* ── a clean bill is untouched. The gate must not eat real work. ── */
  {
    S.PURCHASES.length = 0;
    D.addPurchase(Object.assign({}, BILL));
    const fresh = mk('d1', Object.assign({}, BILL, { bill: 'INV-99' }));
    fresh.built = cfg.buildRow(k => fresh.vals[k] != null ? fresh.vals[k] : '');
    B.BATCH = { bills: [fresh], cfg: cfg, dropped: [] };
    B.finishBatch(cfg);
    eq('a genuinely new bill is still READY', fresh.status, 'ready');
    ok(!fresh.dupe, '  not flagged');
    ok(!fresh.reason, '  and no scary message on a bill that is fine');
  }

  /* ── the drawer shows it too ── */
  {
    const drawer = grabBlock(bsrc, 'function openDrawer(bill, opts) {', '\n  }');
    ok(/bill\.err \?/.test(drawer), 'the review drawer prints bill.err — the register\'s refusal');
    ok(/bill\.dupe && bill\.dupWhy/.test(drawer), '  and the "Already uploaded" note on a flagged duplicate');
  }

  /* ── the solo drawer no longer promises an override it cannot deliver ── */
  {
    const code = strip(bsrc);
    ok(/if \(bill\.dupHard\) \{ toast\(dupNote\(bill\.dupWhy\), 'err'\); return; \}/.test(code),
      'a bill already IN the register: the drawer says "already uploaded" and stops');
    ok(!/toast\('This bill already exists in the register\. Click Save again to add it anyway\.'/.test(code),
      '  the old unconditional "Click Save again to add it anyway" is gone — the gate refuses the second click too, so it was a lie');
  }

  console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
  process.exit(fail ? 1 : 0);
})();
