/* qty-backfill.test.js — reading the tonnage back off bills already uploaded.
 *
 * "show quantity get from uploeded bills"
 *
 * The Qty column dashes on old bills because the importer never mapped qty — the
 * OCR read it and the importer dropped it. Fixed for new imports. The 26 bills
 * already in the books still need it, and the bills THEMSELVES are still in
 * IndexedDB, so the tonnage is not gone: it was never read.
 *
 * WHY THIS FILE MATTERS MORE THAN MOST. It writes a number onto real bills, and
 * that number drives Inventory, cost-per-tonne and every margin below it. A WRONG
 * tonnage is far worse than the dash it replaces: a dash says "unknown" and stops
 * you; a wrong 32.49 says "known" and quietly poisons your costing. So the tests
 * that matter here are the ones proving it REFUSES.
 *
 *   node qty-backfill.test.js
 */
'use strict';
const B = require('./qty-backfill.js');
const OCR = require('./bill-ocr.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ qty backfill · reading the tonnage back ═══\n');

/* ══════════ 1. THE REAL BILL ══════════
   Text lifted from the Indian Oil petcoke invoice he sent. If the parser stops
   reading this, the feature is dead and this test says so. */
const REAL = 'GSTIN 24AAACI1681G1ZV\nGSTIN 08BNAPM0488E1Z3\nGOTAN LIME INDUSTRIES\n'
  + 'Item Material Code / Material Description Quantity Unit Rate Unit HSN code Total\n'
  + '10 178100 FUEL GRADE PET COKE (BULK) 32.490 TO 271311\n'
  + 'ZAVL Transaction Value 32.490 TO 12680.000 TO 411973.20\n'
  + 'Taxable Value 32.490 TO 12680.000 TO 411973.20\n'
  + 'JOIG IN: Integrated Tax 18.000 % 74155.18\nTotal 486128.00';
{
  const f = OCR.parse(REAL, 'purchase').fields;
  eq('the REAL Indian Oil bill still yields its tonnage', f.qty, 32.49);
  eq('  and its unit', f.unit, 'TO');
  eq('  and the rate printed on it', f.unitRate, 12680);
  eq('  and the taxable value', f.taxable, 411973.2);

  /* End to end: the bill as booked, against the bill as printed. */
  const row = { idx: 0, bill: '20273121B007217', sup: 'Indian Oil Corporation Limited', taxable: 411973.2, qty: 0 };
  const v = B.verdict(row, f);
  ok(v.ok, 'THE POINT: his real bill backfills — 32.49 T at ₹12,680');
  eq('  the tonnage', v.qty, 32.49);
  eq('  the unit', v.unit, 'TO');
  ok(/matches the booked value/.test(v.why), '  and it says WHY it is safe to apply');
}

/* ══════════ 2. IT MUST REFUSE — the tests that keep the books honest ══════════ */
{
  /* THE MOST IMPORTANT ONE. A human typed that quantity in. A parser does not get
     to overrule a person about their own bill. */
  const v = B.verdict({ idx: 1, taxable: 411973.2, qty: 40 }, { qty: 32.49, unitRate: 12680 });
  ok(!v.ok, 'a bill that ALREADY has a quantity is never touched');
  ok(v.skip, '  and it is a SKIP, not a failure — nothing is wrong with it');

  /* The arithmetic gate. This is what makes the whole feature safe: we do not trust
     the parser, we trust arithmetic it must satisfy against a number already in the
     books. A misread tonnage cannot pass. */
  const bad = B.verdict({ idx: 2, taxable: 411973.2, qty: 0 }, { qty: 3.249, unitRate: 12680 });
  ok(!bad.ok, 'a MISREAD tonnage (decimal point wrong) is refused, not applied');
  ok(/does not reconcile/.test(bad.why), '  and says exactly why, with both figures');

  const bad2 = B.verdict({ idx: 3, taxable: 411973.2, qty: 0 }, { qty: 324.90, unitRate: 12680 });
  ok(!bad2.ok, 'a tonnage 10x too big is refused');

  /* No quantity on the page at all. */
  /* The MESSAGE matters, not just the refusal. Both this and a misread end in "not
     applied", but he has to know WHICH: "no quantity on the bill" means type it in;
     "does not reconcile" means the parser misread a bill that HAS one. Asserting
     only .ok let a mutation through that collapsed the two into one confusing
     message — refusing correctly for the wrong stated reason. */
  const noQ = B.verdict({ idx: 4, taxable: 5000, qty: 0 }, { taxable: 5000 });
  ok(!noQ.ok, 'a bill with no quantity on it is left alone');
  ok(/no quantity found/.test(noQ.why), '  and says so plainly — NOT a confusing arithmetic failure');
  ok(!/does not reconcile/.test(noQ.why), '  a bill without a quantity did not "fail to reconcile" — it had nothing to reconcile');

  const zero = B.verdict({ idx: 4.5, taxable: 5000, qty: 0 }, { qty: 0, unitRate: 100 });
  ok(/no quantity found/.test(zero.why), 'a literal 0 on the bill reads as "no quantity", not as bad arithmetic');
  ok(!B.verdict({ idx: 5, taxable: 5000, qty: 0 }, null).ok, 'an unreadable file is reported, not guessed');
  ok(!B.verdict(null, { qty: 5, unitRate: 1000 }).ok, 'a missing row does not throw');

  /* A rate the parser never found means nothing to check the qty against. */
  ok(!B.verdict({ idx: 6, taxable: 411973.2, qty: 0 }, { qty: 32.49 }).ok,
    'a quantity with NO rate is refused — there is nothing to reconcile it against');

  /* Zero and negative are not tonnages. */
  ok(!B.verdict({ idx: 7, taxable: 5000, qty: 0 }, { qty: 0, unitRate: 100 }).ok, 'zero is not a tonnage');
  ok(!B.verdict({ idx: 8, taxable: 5000, qty: 0 }, { qty: -5, unitRate: 100 }).ok, 'a negative is not a tonnage');
}

/* ══════════ 3. THE ARITHMETIC GATE ══════════ */
{
  ok(B.arithmeticAgrees(32.49, 12680, 411973.2), 'exact arithmetic passes');
  ok(B.arithmeticAgrees(32.49, 12680, 411973), '  sub-rupee dust passes');
  /* Indian Oil's own bill carries a ZRND rounding line (486128.38 → 486128.00), so
     a real bill legitimately misses by a fraction of a percent. */
  ok(B.arithmeticAgrees(32.49, 12680, 411000), '  a bill that rounds its own lines passes (0.24% off)');
  ok(!B.arithmeticAgrees(32.49, 12680, 400000), 'a 3% gap does NOT pass — that is a misread, not rounding');
  ok(!B.arithmeticAgrees(32.49, 12680, 41197), 'a 10x gap does not pass');
  ok(!B.arithmeticAgrees(0, 12680, 411973), 'no qty, no pass');
  ok(!B.arithmeticAgrees(32.49, 0, 411973), 'no rate, no pass');
  ok(!B.arithmeticAgrees(32.49, 12680, 0), 'no booked value to check against, no pass');
}

/* ══════════ 4. WHICH BILLS ARE EVEN SCANNED ══════════ */
{
  const rows = [
    { idx: 0, qty: 0, attach: [{ id: 'a' }], status: 'pending' },      // scan
    { idx: 1, qty: 32, attach: [{ id: 'b' }], status: 'pending' },     // has qty — skip
    { idx: 2, qty: 0, attach: [], status: 'pending' },                 // no file — skip
    { idx: 3, qty: 0, attach: [{ id: 'c' }], status: 'cancelled' },    // cancelled — skip
    { idx: 4, qty: 0, attach: [{ id: 'd' }], status: 'pending' }       // scan
  ];
  eq('only qty-less bills WITH a file are scanned', B.candidates(rows).map(r => r.idx), [0, 4]);
  eq('nothing to do on an empty book', B.candidates([]), []);
  eq('null does not throw', B.candidates(null), []);
}

/* ══════════ 5. IT NEVER OVERWRITES A HUMAN ══════════
   The scan may be minutes old. If someone typed a quantity in meanwhile, the write
   must stand down — a person beats a parser, always. */
{
  const src = require('fs').readFileSync(require('path').join(__dirname, 'qty-backfill.js'), 'utf8');
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const code = strip(src);
  ok(/if \(!cur \|\| \+cur\.qty > 0\) return;/.test(code),
    'apply() RE-CHECKS at write time that the bill is still quantity-less');
  ok(/updatePurchase/.test(code) && !/S\.PURCHASES\[/.test(code),
    '  and writes through the real QLD mutation, not into the store directly');
  ok(!/addPurchase|deletePurchase|commit\(/.test(code),
    '  it only ever updates an existing bill — it cannot create or delete one');
}

/* ══════════ 6. IT RUNS ITSELF — once per bill, in the background ══════════
   The button is gone: "no need to read quantities separate when uploaded documents
   then read same time". So auto() has to do the old bills on its own. Three ways
   that goes wrong and this section exists to stop:
   · it re-scans every load, re-parsing 26 PDFs forever
   · it never scans a bill that arrives later
   · it finishes SILENTLY, having written numbers into his books and said nothing */
{
  const path = require('path');
  const V2 = __dirname;

  /* A fake browser just big enough: localStorage, an idle callback, QLD, the
     attachment store, a PDF reader and the REAL parser. */
  function harness(rows, textFor) {
    const LS = {};
    const store = {
      QLD: {
        co: { key: 'gotan' },
        state: { PURCHASES: rows },
        purchaseRows: () => rows,
        updatePurchase: (i, patch) => { Object.assign(rows[i], patch); store.writes.push([i, patch]); }
      },
      writes: [],
      QLAttach: { get: id => Promise.resolve({ _id: id }) },
      QLFin: { pdfPages: f => Promise.resolve([textFor(f._id)]) },
      BillOCR: require('./bill-ocr.js'),
      localStorage: {
        getItem: k => (k in LS ? LS[k] : null),
        setItem: (k, v) => { LS[k] = String(v); },
        removeItem: k => { delete LS[k]; }
      },
      setTimeout, requestIdleCallback: null, _LS: LS
    };
    return store;
  }

  /* Load the module against that fake root, the way the page loads it. */
  function load(root) {
    const vm = require('vm'), fs = require('fs');
    const ctx = { module: { exports: {} }, console, Math, Object, Array, Number, String, JSON, Date, Promise, setTimeout, isFinite, parseFloat };
    Object.assign(ctx, root);
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(V2, 'qty-backfill.js'), 'utf8'), ctx);
    return ctx.QLQtyBackfill;
  }

  const GOOD = 'GSTIN 24AAACI1681G1ZV\nItem Material Code / Material Description Quantity Unit Rate Unit HSN code Total\n'
    + 'ZAVL Transaction Value 32.490 TO 12680.000 TO 411973.20\nTaxable Value 32.490 TO 12680.000 TO 411973.20\nTotal 486128.00';
  const JUNK = 'a scanned page with no numbers on it at all';

  /* One readable bill, one unreadable — the real mix in his books. */
  const mkRows = () => ([
    { idx: 0, bill: 'B-1', sup: 'Indian Oil', gstin: '24AAACI1681G1ZV', date: '2026-05-01', qty: 0, taxable: 411973.20, attach: [{ id: 'good' }], status: 'pending' },
    { idx: 1, bill: 'B-2', sup: 'Acme', gstin: '08BNAPM0488E1Z3', date: '2026-05-02', qty: 0, taxable: 5000, attach: [{ id: 'junk' }], status: 'pending' }
  ]);
  const text = id => (id === 'good' ? GOOD : JUNK);

  (async () => {
    /* ── it reads what it can, refuses what it cannot ── */
    {
      const rows = mkRows(), root = harness(rows, text), B2 = load(root);
      const out = await B2.auto();
      ok(out.ran === true, 'auto() runs when there are old bills with no quantity');
      eq('  it WROTE the bill whose arithmetic proves the read', out.wrote, 1);
      eq('  and refused the one it could not read', out.missed, 1);
      eq('  the tonnage landed on the right bill', rows[0].qty, 32.49);
      ok(!(rows[1].qty > 0), '  THE UNREADABLE BILL STAYS A DASH — never 0, never a guess');
      eq('  and it never wrote to it at all', root.writes.map(w => w[0]), [0]);

      /* THE REPORT. A background job that writes to his books in silence is the
         ai-status bug: indistinguishable from one that did nothing. */
      const msg = B2.report(out);
      ok(/Read tonnage off 1 bill/.test(msg), 'it SAYS what it read: “' + msg + '”');
      ok(/1 could not be read/.test(msg), '  and admits what it could not, in the same breath');
    }

    /* ── ONCE. Not on every load. ── */
    {
      const rows = mkRows(), root = harness(rows, text), B2 = load(root);
      await B2.auto();
      const first = root.writes.length;
      const again = await B2.auto();
      ok(again.ran === false, 'a SECOND load does not re-scan — the marker holds');
      eq('  and writes nothing more', root.writes.length, first);
      eq('  including the bill it FAILED to read — it is not retried forever', B2.pending(rows).length, 0);
    }

    /* ── but a bill that arrives later still gets its one chance ── */
    {
      const rows = mkRows(), root = harness(rows, text), B2 = load(root);
      await B2.auto();
      rows.push({ idx: 2, bill: 'B-3', sup: 'Indian Oil', gstin: '24AAACI1681G1ZV', date: '2026-06-09', qty: 0, taxable: 411973.20, attach: [{ id: 'good' }], status: 'pending' });
      eq('a NEW old-style bill is still pending after the first pass', B2.pending(rows).map(r => r.idx), [2]);
      const out = await B2.auto();
      eq('  and auto() reads it', out.wrote, 1);
      eq('  onto the new bill', rows[2].qty, 32.49);
    }

    /* ── the marker is keyed per bill, not per row position ── */
    {
      const rows = mkRows(), root = harness(rows, text), B2 = load(root);
      await B2.auto();
      rows.splice(0, 1);                       // he deletes a bill; every idx below shifts
      rows.forEach((r, i) => { r.idx = i; });
      eq('deleting a bill does not make the survivors look unscanned again', B2.pending(rows).length, 0);
    }

    /* ── nothing to do = it does not run, and says nothing ── */
    {
      const rows = [{ idx: 0, bill: 'B-9', sup: 'X', date: '2026-05-01', qty: 12, taxable: 100, attach: [{ id: 'good' }], status: 'pending' }];
      const root = harness(rows, text), B2 = load(root);
      const out = await B2.auto();
      ok(out.ran === false, 'every bill already has its quantity → auto() does not run');
      eq('  and there is NO toast — silence is right when nothing happened', B2.report(out), '');
    }

    /* ── it does not overrule a human, even in the background ── */
    {
      const rows = mkRows(), root = harness(rows, text), B2 = load(root);
      rows[0].qty = 99;                        // he typed it in himself
      const out = await B2.auto();
      eq('a quantity a HUMAN typed is never overwritten by the background pass', rows[0].qty, 99);
      eq('  it was not even a candidate', out.wrote, 0);
    }

    /* ── the marker is per COMPANY: one account's scan is not another's ── */
    {
      const rows = mkRows(), root = harness(rows, text), B2 = load(root);
      await B2.auto();
      const k1 = B2.markerKey();
      root.QLD.co = { key: 'other-co' };
      ok(B2.markerKey() !== k1, 'a different company gets a different marker');
      eq('  so its bills are all still pending', B2.pending(mkRows()).length, 2);
    }

    /* ── IT MUST NOT FREEZE THE PAGE ── */
    {
      const src = require('fs').readFileSync(path.join(V2, 'qty-backfill.js'), 'utf8');
      const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
      const code = strip(src);
      ok(/await new Promise\(function \(res\) \{ setTimeout\(res, 0\); \}\);/.test(code),
        'scan() YIELDS between bills — parsing 26 PDFs in one unbroken loop is a frozen page');
      ok(/requestIdleCallback/.test(code), '  and the whole pass is scheduled on idle, not on load');
      ok(/idle\(async function \(\)/.test(code), '  auto() runs its scan INSIDE the idle callback');
    }

    /* ── MUTATION: break the gate, the tests must scream ── */
    {
      const rows = mkRows(), root = harness(rows, text), B2 = load(root);
      /* If the arithmetic gate were removed, the junk bill's absent qty would still
         be refused — but a bill whose numbers DISAGREE would be written. Prove the
         gate is what stops it. */
      const bad = { idx: 0, qty: 0, taxable: 999999, attach: [{ id: 'good' }], status: 'pending' };
      const v = B2.verdict(bad, { qty: 32.49, unitRate: 12680 });
      ok(v.ok === false, 'MUTATION CHECK: a read that does not reconcile is REFUSED');
      ok(/does not reconcile/.test(v.why), '  and says so in the words he will read');
      ok(B2.arithmeticAgrees(32.49, 12680, 411973.2), '  the gate still accepts a bill that DOES reconcile');
      ok(!B2.arithmeticAgrees(32.49, 12680, 411973.2 * 1.02), '  and rejects one 2% out');
    }

    console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
    process.exit(fail ? 1 : 0);
  })();
}
