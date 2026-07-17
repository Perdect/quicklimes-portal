/* bulk-attach.test.js — the uploaded scan must go where the bill goes.
 *
 * THE BUG. Bulk-uploaded bills were saving without their document, so the eye /
 * "View bill" button opened nothing. The drawer says as much in a comment —
 * "(The original scan stays attached to the bill on save.)" — and for a bill that
 * stays on the register you uploaded it from, that was true: cfg.add(row, file)
 * carries it. What was NOT true, and what nothing in the app said, is the
 * CROSS-REGISTER route. bulk.js auto-routes a sales invoice uploaded on the
 * Purchase register into Sales via QLD.importGenericBill(kind, fields) — which
 * takes fields ONLY. The File was simply never passed. The bill landed in the
 * right register with no document at all, and the importer reported "Imported 1".
 *
 * THE TRAP THIS FILE EXISTS TO PIN. The two registers have SEPARATE stores —
 * purchase docs in ql_pur_docs, sales docs in ql_sal_docs. A scan attached to the
 * store of the page you uploaded FROM rather than the register the bill went TO is
 * filed where nothing will ever look for it. That failure is invisible: the row
 * saves, the attach record exists, and only the eye button — months later —
 * discovers the blob is in the wrong database. So every case here asserts the
 * blob's store, not merely that "an attach happened".
 *
 * SECOND RULE: a scan that cannot be stored must not take the bill down with it,
 * and must not be silent either. The bill stands; the user is told.
 *
 *   node bulk-attach.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ bulk upload · the scan goes where the bill goes ═══\n');

const V2 = __dirname;
const dsrc = fs.readFileSync(path.join(V2, 'data.js'), 'utf8');
const bsrc = fs.readFileSync(path.join(V2, 'bulk.js'), 'utf8');
const psrc = fs.readFileSync(path.join(V2, 'purchase.js'), 'utf8');
const ssrc = fs.readFileSync(path.join(V2, 'sales.js'), 'utf8');

/* ── a fake IndexedDB that records which DATABASE each blob landed in ──
   The whole point of the test is store routing, so the fake must keep the stores
   apart the way the browser does. FAILDB simulates a store that refuses writes.

   The store is looked up LAZILY on every operation, never captured at open() time.
   data.js caches its db connection per database name for the life of the module,
   so a fake that closed over the store object kept writing into the object that
   was there during the first test — and reset() then read a fresh empty one and
   reported "no blob" for writes that had actually happened. That is a test lying
   about the code, which is worse than no test. */
const DBS = {}; let FAILDB = null;
const store = name => (DBS[name] = DBS[name] || {});
function makeIDB() {
  return {
    open(name) {
      const req = {};
      setTimeout(() => {
        const db = {
          objectStoreNames: { contains: () => true }, createObjectStore() {},
          transaction() {
            const t = {};
            const o = {
              put(val, key) { if (FAILDB === name) { setTimeout(() => t.onerror && t.onerror(), 0); return {}; } store(name)[key] = val; return { result: key }; },
              get(key) { return { result: store(name)[key] }; }
            };
            setTimeout(() => { if (FAILDB !== name) t.oncomplete && t.oncomplete(); }, 0);
            return {
              objectStore: () => o,
              set oncomplete(f) { t.oncomplete = f; }, set onerror(f) { t.onerror = f; },
              get error() { return { name: 'QuotaExceededError', message: 'this browser is out of storage' }; }
            };
          }
        };
        req.onsuccess && req.onsuccess({ target: { result: db } });
      }, 0);
      return req;
    }
  };
}

/* ══════════ THE REAL attachDoc + register mutations, out of data.js ══════════ */
const S = { SALES: [], PURCHASES: [], PARTIES: [] };
const grabBlock = (src, k, end) => { const i = src.indexOf(k); if (i < 0) throw new Error('not found in source: ' + k); return src.slice(i, src.indexOf(end, i) + end.length); };
const grabLine = (src, k) => { const i = src.indexOf(k); if (i < 0) throw new Error('not found in source: ' + k); return src.slice(i, src.indexOf('\n', i)); };

const D = {
  console, Math, Object, Array, Number, String, JSON, Date, Promise, setTimeout,
  isFinite, parseFloat, isNaN, S,
  indexedDB: makeIDB(),
  dupCheck: () => null, upsertParty: () => {}, commit: () => {}, toISODate: d => d, fmtISO: () => '2026-07-17'
};
vm.createContext(D);
vm.runInContext([
  grabLine(dsrc, "const DOC_DB = {"),
  grabLine(dsrc, "const DOC_PFX = {"),
  grabLine(dsrc, "const _docDb = {};"),
  grabBlock(dsrc, 'function docDb(kind) {', '\n  }'),
  grabBlock(dsrc, 'function docOp(kind, mode, fn) {', '\n  }'),
  grabBlock(dsrc, 'async function attachDoc(kind, idx, file, label) {', '\n  }'),
  grabLine(dsrc, 'function getDoc(kind, id)'),
  grabBlock(dsrc, 'function addSale(e) {', '\n  }'),
  grabBlock(dsrc, 'function addPurchase(e) {', '\n  }'),
  grabLine(dsrc, 'function updateSale(i, e)'),
  grabLine(dsrc, 'function updatePurchase(i, e)'),
  grabBlock(dsrc, 'function importGenericBill(kind, g) {', '\n  }'),
  'this.attachDoc = attachDoc; this.getDoc = getDoc; this.importGenericBill = importGenericBill;',
  'this.addSale = addSale; this.addPurchase = addPurchase;',
  'this.updateSale = updateSale; this.updatePurchase = updatePurchase;'
].join('\n'), D);
ok(typeof D.attachDoc === 'function', 'the REAL attachDoc loaded out of data.js');
ok(typeof D.importGenericBill === 'function', 'the REAL importGenericBill loaded out of data.js');

/* THE SEPARATION, asserted on the real config rather than assumed. */
{
  const dbLine = grabLine(dsrc, "const DOC_DB = {");
  ok(/purchase:\s*'ql_pur_docs'/.test(dbLine) && /sales:\s*'ql_sal_docs'/.test(dbLine),
    'purchase docs and sales docs live in DIFFERENT stores — routing is the thing that can go wrong');
  const pfx = grabLine(dsrc, "const DOC_PFX = {");
  ok(/purchase:\s*'pa'/.test(pfx) && /sales:\s*'sa'/.test(pfx), '  and keep the id prefixes the registers already read back');
}

/* ══════════ THE REAL Q, and the REAL cfg.add out of each register ══════════ */
const Q = {
  state: S,
  addSale: D.addSale, addPurchase: D.addPurchase,
  updateSale: D.updateSale, updatePurchase: D.updatePurchase,
  importGenericBill: D.importGenericBill,
  attachDoc: D.attachDoc, getDoc: D.getDoc
};

/* Both registers' addAttach must be the ONE writer — not a private copy that has
   to agree with data.js forever about six field names and an id prefix. */
ok(/function addAttach\(idx, file, kind\) \{ return Q\.attachDoc\('purchase', idx, file, kind\); \}/.test(psrc),
  'purchase.js addAttach delegates to the one writer (no second implementation)');
ok(/function addAttach\(idx, file, kind\) \{ return Q\.attachDoc\('sales', idx, file, kind\); \}/.test(ssrc),
  'sales.js addAttach delegates to the one writer');
ok(/if \(file\) return addAttach\(Q\.state\.PURCHASES\.length - 1, file, 'Invoice'\);/.test(psrc),
  'purchase cfg.add RETURNS the attach promise — a swallowed promise is a scan nobody can await');
ok(/if \(file\) return addAttach\(Q\.state\.SALES\.length - 1, file, 'Invoice'\);/.test(ssrc),
  'sales cfg.add RETURNS the attach promise');
ok(!/try \{ addAttach\([^)]*\); \} catch \(_\) \{\}/.test(psrc + ssrc),
  'NEITHER register still fires addAttach into a sync try/catch that cannot catch its rejection');

/* Rebuild each register's cfg.add exactly as the page defines it. */
const purAdd = (p, file) => { const r = Q.addPurchase(p); if (r && r.ok === false) throw new Error(r.reason); if (file) return Q.attachDoc('purchase', Q.state.PURCHASES.length - 1, file, 'Invoice'); };
const salAdd = (s, file) => { const r = Q.addSale(s); if (r && r.ok === false) throw new Error(r.reason); if (file) return Q.attachDoc('sales', Q.state.SALES.length - 1, file, 'Invoice'); };

/* ══════════ THE REAL postOne, out of bulk.js ══════════ */
/* QLD is referenced BARE in bulk.js (`window.QLD && QLD.importGenericBill`) — in a
   browser the two are the same object. Bind both, or the test proves nothing about
   the real page. */
const B = {
  console, Math, Object, Array, Number, String, JSON, Date, Promise, setTimeout, isFinite, parseFloat,
  window: { QLD: Q }, QLD: Q, TOASTS: []
};
B.window.window = B.window;
vm.createContext(B);
vm.runInContext([
  'var toast = function (m, t) { TOASTS.push([m, t]); };',
  grabBlock(bsrc, 'function valsToGeneric(bill, cfg) {', '\n  }'),
  grabBlock(bsrc, 'async function postOne(bill, cfg) {', '\n  }'),
  grabBlock(bsrc, 'async function attachScan(bill, p) {', '\n  }'),
  grabBlock(bsrc, 'function scanNote(bills) {', '\n  }'),
  'this.postOne = postOne; this.scanNote = scanNote;'
].join('\n'), B);
ok(typeof B.postOne === 'function', 'the REAL postOne loaded out of bulk.js');
ok(B.postOne.constructor.name === 'AsyncFunction', 'postOne is async — the attach is an IndexedDB write and must be awaited');

const purCfg = {
  kind: 'purchase', noun: 'bill',
  ocrMap: { bill: 'docno', sup: 'name', taxable: 'taxable', gstin: 'gstin' },
  buildRow: get => ({ bill: get('bill'), sup: get('sup'), taxable: +get('taxable') || 0, status: 'pending' }),
  add: purAdd
};
const salCfg = {
  kind: 'sales', noun: 'invoice',
  ocrMap: { inv: 'docno', party: 'name', qty: 'qty', gstin: 'gstin' },
  buildRow: get => ({ inv: get('inv'), party: get('party'), qty: +get('qty') || 1, rate: 100, gstR: 18, status: 'pending' }),
  add: salAdd
};

const mkFile = (name, type) => ({ name: name, type: type || 'application/pdf', size: 2048, _tag: name });
const reset = () => { S.SALES.length = 0; S.PURCHASES.length = 0; Object.keys(DBS).forEach(k => delete DBS[k]); FAILDB = null; B.TOASTS.length = 0; };
const keys = db => Object.keys(DBS[db] || {});

(async () => {

  /* ══════════ 1. SAME-REGISTER — the path that already worked, pinned ══════════ */
  {
    reset();
    const f = mkFile('acme-bill.pdf');
    const bill = { id: 'b1', kind: 'ocr', file: f, g: {}, vals: { bill: 'INV-1', sup: 'Acme', taxable: '1000' }, status: 'ready' };
    const okd = await B.postOne(bill, purCfg);
    ok(okd === true, 'a purchase bill on the Purchase register saves');
    eq('  the row is there', S.PURCHASES.length, 1);
    const att = (S.PURCHASES[0] || {}).attach || [];
    eq('  and it carries exactly one attachment', att.length, 1);
    ok(att[0] && att[0].id, '  THE ATTACH RECORD HAS AN ID — without it the eye button has nothing to fetch');
    eq('  the record names the real file', att[0].name, 'acme-bill.pdf');
    eq('  and its type, so the viewer knows whether to use an <img> or an <iframe>', att[0].type, 'application/pdf');
    ok(att[0].at, '  and when it was attached');
    /* THE BLOB, in the RIGHT database — the assertion that catches mis-routing. */
    eq('  THE BLOB IS IN THE PURCHASE STORE', keys('ql_pur_docs').length, 1);
    eq('  and NOT in the sales store', keys('ql_sal_docs').length, 0);
    const blob = await Q.getDoc('purchase', att[0].id);
    ok(blob && blob._tag === 'acme-bill.pdf', '  and the id in the record fetches back the FILE THAT WAS UPLOADED');
    ok(/^pa/.test(att[0].id), '  the id is prefixed pa — a purchase doc');
    ok(!bill.scanErr, '  no scan error reported');
  }
  {
    reset();
    const f = mkFile('gotan-inv.jpg', 'image/jpeg');
    const bill = { id: 'b2', kind: 'ocr', file: f, g: {}, vals: { inv: 'S-1', party: 'Buyer', qty: '2' }, status: 'ready' };
    ok(await B.postOne(bill, salCfg) === true, 'a sales invoice on the Sales register saves');
    const att = (S.SALES[0] || {}).attach || [];
    eq('  with its attachment', att.length, 1);
    eq('  THE BLOB IS IN THE SALES STORE', keys('ql_sal_docs').length, 1);
    eq('  and NOT in the purchase store', keys('ql_pur_docs').length, 0);
    const blob = await Q.getDoc('sales', att[0].id);
    ok(blob && blob._tag === 'gotan-inv.jpg', '  and fetches back the uploaded photo');
    ok(/^sa/.test(att[0].id), '  the id is prefixed sa — a sales doc');
  }

  /* ══════════ 2. THE BUG — CROSS-REGISTER ══════════
     A sales invoice uploaded on the Purchase register. bulk.js routes the ROW to
     Sales; before this fix the FILE went nowhere at all. */
  {
    reset();
    const f = mkFile('routed-sale.pdf');
    const bill = { id: 'b3', kind: 'ocr', file: f, g: {}, crossKind: 'sales', vals: { bill: 'S-77', sup: 'Customer Co', taxable: '5000' }, status: 'ready' };
    ok(await B.postOne(bill, purCfg) === true, 'THE BUG: a sales invoice uploaded on the Purchase register saves');
    eq('  the ROW is routed to Sales', S.SALES.length, 1);
    eq('  and does NOT land in Purchase', S.PURCHASES.length, 0);
    eq('  bulk reports where it went', bill.routed, 'sales');
    const att = (S.SALES[0] || {}).attach || [];
    eq('  THE SCAN FOLLOWS IT — the routed bill carries its document', att.length, 1);
    ok(att[0] && att[0].id, '  the attach record has an id');
    /* The heart of it: the scan must be in the DESTINATION register's store. */
    eq('  THE BLOB IS IN THE SALES STORE — the register the bill went TO', keys('ql_sal_docs').length, 1);
    eq('  NOT in the purchase store of the page it was uploaded FROM', keys('ql_pur_docs').length, 0);
    const blob = await Q.getDoc('sales', att[0].id);
    ok(blob && blob._tag === 'routed-sale.pdf', '  and the sales register can fetch the original file back');
    ok(/^sa/.test(att[0].id), '  filed with a sales id, so sales.js reads it as its own');
  }
  {
    reset();
    const f = mkFile('routed-purchase.pdf');
    const bill = { id: 'b4', kind: 'ocr', file: f, g: {}, crossKind: 'purchase', vals: { inv: 'P-9', party: 'Supplier Co', qty: '1' }, status: 'ready' };
    ok(await B.postOne(bill, salCfg) === true, 'the mirror: a purchase bill uploaded on the Sales register saves');
    eq('  the ROW is routed to Purchase', S.PURCHASES.length, 1);
    const att = (S.PURCHASES[0] || {}).attach || [];
    eq('  THE SCAN FOLLOWS IT', att.length, 1);
    eq('  THE BLOB IS IN THE PURCHASE STORE', keys('ql_pur_docs').length, 1);
    eq('  NOT in the sales store of the page it came from', keys('ql_sal_docs').length, 0);
    const blob = await Q.getDoc('purchase', att[0].id);
    ok(blob && blob._tag === 'routed-purchase.pdf', '  and the purchase register fetches the original back');
  }

  /* ══════════ 3. A FAILED ATTACH MUST NOT LOSE THE BILL ══════════
     Storage is out / private mode / the store refuses. The bill is real and the
     user typed it; losing it because its photo would not save turns a missing
     document into a missing purchase. It must be kept AND reported. */
  {
    reset(); FAILDB = 'ql_pur_docs';
    const bill = { id: 'b5', kind: 'ocr', file: mkFile('nostore.pdf'), g: {}, vals: { bill: 'INV-9', sup: 'Acme', taxable: '900' }, status: 'ready' };
    const okd = await B.postOne(bill, purCfg);
    ok(okd === true, 'the scan store refuses the write → the bill still SAVES');
    eq('  the row is in the register', S.PURCHASES.length, 1);
    eq('  and is marked imported, not failed', bill.status, 'imported');
    ok(!(S.PURCHASES[0].attach || []).length, '  it carries no attachment — honestly, rather than a record pointing at nothing');
    ok(bill.scanErr, '  THE FAILURE IS RECORDED — not swallowed');
    ok(/storage|store|scan/i.test(bill.scanErr), '  and says something the user can act on: ' + JSON.stringify(bill.scanErr));
    /* And it is SPOKEN, not merely recorded on an object nobody reads. */
    B.TOASTS.length = 0; B.scanNote([bill]);
    eq('  the user is told', B.TOASTS.length, 1);
    ok(/WITHOUT the scan/.test(B.TOASTS[0][0]), '  in plain words: ' + JSON.stringify(B.TOASTS[0][0]));
    eq('  as an error, not a cheerful notice', B.TOASTS[0][1], 'err');
    FAILDB = null;
  }
  {
    /* The same rule on the routed path — the bill is already committed there. */
    reset(); FAILDB = 'ql_sal_docs';
    const bill = { id: 'b6', kind: 'ocr', file: mkFile('x.pdf'), g: {}, crossKind: 'sales', vals: { bill: 'S-5', sup: 'Cust', taxable: '100' }, status: 'ready' };
    ok(await B.postOne(bill, purCfg) === true, 'a routed bill whose scan will not store still saves');
    eq('  the routed row survives', S.SALES.length, 1);
    ok(bill.scanErr, '  and the lost scan is reported');
    FAILDB = null;
  }
  {
    /* A row that vanished before the attach — the index race. attachDoc must
       refuse to dereference it, and the refusal must not read as a lost bill. */
    reset();
    let threw = '';
    try { await Q.attachDoc('purchase', 999, mkFile('ghost.pdf'), 'Invoice'); } catch (e) { threw = e.message; }
    ok(threw, 'attaching to a row that is not there THROWS rather than crashing on undefined.attach');
    ok(/no longer there/.test(threw), '  and says what happened: ' + JSON.stringify(threw));
  }

  /* ══════════ 4. A ROW THAT WILL NOT SAVE IS STILL A FAILURE ══════════
     The scan rule must not have quietly turned a rejected bill into a success. */
  {
    reset();
    const dupCfg = Object.assign({}, purCfg, { add: () => { throw new Error('This bill already exists'); } });
    const bill = { id: 'b7', kind: 'ocr', file: mkFile('d.pdf'), g: {}, vals: { bill: 'INV-1', sup: 'Acme', taxable: '1' }, status: 'ready' };
    ok(await B.postOne(bill, dupCfg) === false, 'a REFUSED row still reports failure (the dup gate is not softened)');
    eq('  and is marked failed', bill.status, 'failed');
    ok(/already exists/.test(bill.err || ''), '  with the register\'s own reason');
  }
  {
    reset();
    const badCfg = Object.assign({}, purCfg, { buildRow: () => null });
    const bill = { id: 'b8', kind: 'ocr', file: mkFile('d.pdf'), g: {}, vals: {}, status: 'ready' };
    ok(await B.postOne(bill, badCfg) === false, 'a row that cannot be built is not saved');
    eq('  and is marked failed', bill.status, 'failed');
  }

  /* ══════════ 5. A SPREADSHEET ROW HAS NO SCAN — and that is not an error ══════════ */
  {
    reset();
    const bill = { id: 'b9', kind: 'sheet', file: null, g: null, vals: { bill: 'CSV-1', sup: 'Acme', taxable: '500' }, status: 'ready' };
    ok(await B.postOne(bill, purCfg) === true, 'a spreadsheet row saves');
    ok(!(S.PURCHASES[0].attach || []).length, '  with no attachment — there was never a scan to attach');
    ok(!bill.scanErr, '  and NO scan error: a CSV row is not a missing document');
    eq('  nothing was written to the doc store', keys('ql_pur_docs').length, 0);
  }

  /* ══════════ 6. MULTI-BILL PDF — each page carries ITS OWN slice ══════════
     bulk.js splits a multi-invoice PDF and sets bill.file = slices[i] || file, so
     each page attaches its own page rather than all of them sharing the 18-page
     original. Pinned here because that line is one `|| file` away from every bill
     in the batch pointing at the same document. */
  {
    ok(/var pf = slices\[pi\] \|\| file/.test(bsrc), 'a split page attaches ITS OWN page slice, falling back to the whole PDF only when the split failed');
    ok(/bills\.push\(makeBill\(pg, pf, src, cfg\)\)/.test(bsrc), '  and that slice is the file the bill carries');
    reset();
    const p1 = mkFile('run-p1.pdf'), p2 = mkFile('run-p2.pdf');
    const b1 = { id: 'm1', kind: 'ocr', file: p1, g: {}, vals: { bill: 'A/1', sup: 'IOC', taxable: '100' }, status: 'ready' };
    const b2 = { id: 'm2', kind: 'ocr', file: p2, g: {}, vals: { bill: 'A/2', sup: 'IOC', taxable: '200' }, status: 'ready' };
    await B.postOne(b1, purCfg); await B.postOne(b2, purCfg);
    eq('two pages of one PDF → two bills', S.PURCHASES.length, 2);
    eq('  two separate blobs, not one shared', keys('ql_pur_docs').length, 2);
    const a1 = S.PURCHASES[0].attach[0], a2 = S.PURCHASES[1].attach[0];
    ok(a1.id !== a2.id, '  each bill has its OWN attachment id');
    const f1 = await Q.getDoc('purchase', a1.id), f2 = await Q.getDoc('purchase', a2.id);
    eq('  page 1 fetches back page 1', f1._tag, 'run-p1.pdf');
    eq('  page 2 fetches back page 2 — not page 1 again', f2._tag, 'run-p2.pdf');
  }

  /* ══════════ 7. SEQUENTIAL POSTING — the index race ══════════
     Each post pushes a row then attaches to the index it just created. Run
     concurrently, one post's push lands between another's push and its index
     read, and a scan attaches to the wrong bill. */
  {
    ok(/for \(var i = 0; i < ready\.length; i\+\+\) \{ if \(await postOne\(ready\[i\], cfg\)\) n\+\+; \}/.test(bsrc),
      'importReady posts SEQUENTIALLY and awaits each — a forEach of un-awaited posts races on length-1');
    ok(/async function importReady\(cfg\)/.test(bsrc), '  and is itself async');
    ok(!/ready\.forEach\(function \(b\) \{ if \(postOne\(b, cfg\)\) n\+\+; \}\);/.test(bsrc), '  the old un-awaited forEach is gone');
    ok(/scanNote\(ready\)/.test(bsrc), 'a batch import reports any scans that did not attach');

    /* Drive it: many bills through the real postOne, each must keep its own scan. */
    reset();
    const bills = [];
    for (let i = 1; i <= 6; i++) bills.push({ id: 'r' + i, kind: 'ocr', file: mkFile('bill-' + i + '.pdf'), g: {}, vals: { bill: 'B/' + i, sup: 'Acme', taxable: '' + (i * 100) }, status: 'ready' });
    for (const b of bills) await B.postOne(b, purCfg);
    eq('six bills posted', S.PURCHASES.length, 6);
    eq('  six blobs stored', keys('ql_pur_docs').length, 6);
    let matched = 0;
    for (let i = 0; i < 6; i++) {
      const a = (S.PURCHASES[i].attach || [])[0];
      if (!a) continue;
      const blob = await Q.getDoc('purchase', a.id);
      if (blob && blob._tag === 'bill-' + (i + 1) + '.pdf') matched++;
    }
    eq('  EVERY bill fetches back ITS OWN scan — none crossed over', matched, 6);
  }

  /* ══════════ 8. THE DRAWER'S SOLO SAVE AWAITS THE ATTACH ══════════ */
  {
    ok(/postOne\(bill, cfg\)\.then\(function \(okd\) \{/.test(bsrc),
      'the drawer\'s Save awaits postOne — it cannot report on a write it did not wait for');
    ok(/if \(bill\.scanErr\) toast\('Saved 1 ' \+ noun \+ ' — but WITHOUT the scan/.test(bsrc),
      '  and a solo save that lost its scan says so instead of a plain "Saved"');
    ok(/btn\.disabled = true/.test(bsrc), '  the button is disabled while the save is in flight — no double-post');
  }

  console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
  process.exit(fail ? 1 : 0);
})();
