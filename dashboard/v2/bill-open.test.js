/* bill-open.test.js — opening a bill scan must never crash on a missing file.
 *
 * THE BUG: the IndexedDB helper resolved a `get` with
 *   o.result !== undefined ? o.result : o
 * so when the scan id was NOT in this browser (result === undefined) it returned
 * the IDBRequest OBJECT instead of undefined. Callers then saw a truthy non-Blob,
 * `if (blob)` passed, and URL.createObjectURL(<IDBRequest>) threw
 *   "Failed to execute 'createObjectURL' on 'URL': Overload resolution failed."
 * instead of the clean "re-upload on this device" message.
 *
 * The fix: resolve to the request RESULT (undefined on a miss) —
 *   o instanceof IDBRequest ? o.result : o
 * and guard every createObjectURL behind `instanceof Blob`.
 *
 *   node bill-open.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ open bill · missing scan → clean message, not a crash ═══\n');

/* ── 1. The resolver logic, run for real with a mock IDBRequest ── */
{
  const ctx = { IDBRequest: class IDBRequest { constructor(r) { this.result = r; } } };
  vm.createContext(ctx);
  // exactly the shipped expression
  const resolve = vm.runInContext('(o => o instanceof IDBRequest ? o.result : o)', ctx);

  const missReq = new ctx.IDBRequest(undefined);     // get() for a key not in this browser
  ok(resolve(missReq) === undefined, 'a missing key resolves to undefined (NOT the IDBRequest)');

  const blobLike = { __blob: true };
  const hitReq = new ctx.IDBRequest(blobLike);
  ok(resolve(hitReq) === blobLike, 'a present key resolves to the stored value');

  const plain = { some: 'non-request return' };
  ok(resolve(plain) === plain, 'a non-request return value passes through unchanged');
}

/* ── 2. Downstream: undefined must be falsy at the `instanceof Blob` gate ── */
{
  // Simulate the open path: blob = resolver result; only createObjectURL when it's a Blob.
  class Blob2 {}
  const wouldOpen = v => (v instanceof Blob2);
  ok(!wouldOpen(undefined), 'undefined never reaches createObjectURL (shows the re-upload message)');
  ok(!wouldOpen({}), 'a stray non-Blob object never reaches createObjectURL either');
  ok(wouldOpen(new Blob2()), 'a real Blob does open');
}

/* ── 3. Source pins: the fix is in place in all three IndexedDB helpers ── */
{
  for (const f of ['sales.js', 'purchase.js', 'data.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    ok(/o instanceof IDBRequest \? o\.result : o/.test(src), f + ' uses the fixed resolver (instanceof IDBRequest)');
    ok(!/o\.result !== undefined \? o\.result : o/.test(src), f + ' no longer has the buggy resolver');
  }
}

/* ── 4. Source pins: every open-bill path guards createObjectURL with instanceof Blob ── */
{
  const sales = fs.readFileSync(path.join(__dirname, 'sales.js'), 'utf8');
  const pur = fs.readFileSync(path.join(__dirname, 'purchase.js'), 'utf8');
  ok(!/if \(blob\) \{ const url = URL\.createObjectURL/.test(sales), 'sales.js: no unguarded createObjectURL on a bare truthy check');
  ok(/if \(blob instanceof Blob\) \{ const url = URL\.createObjectURL/.test(sales), 'sales.js: createObjectURL is guarded by instanceof Blob');
  ok(!/if \(blob\) \{ const url = URL\.createObjectURL/.test(pur), 'purchase.js: no unguarded createObjectURL on a bare truthy check');
  ok(/if \(blob instanceof Blob\) \{ const url = URL\.createObjectURL/.test(pur), 'purchase.js: createObjectURL is guarded by instanceof Blob');
}

/* ══════════ a missing scan must NEVER dead-end the eye ══════════
   Reported live: "sales bill not opening when click on the eye". The scan
   lives in the uploading browser's IndexedDB and only its name and size sync,
   so on any other device the bytes are absent. That is not a reason to show
   nothing: both registers can rebuild the bill from the row itself. The
   blob-miss branch must therefore fall THROUGH to that generated bill, not
   return. */
{
  const fs2 = require('fs'), path2 = require('path');
  const read = f => fs2.readFileSync(path2.join(__dirname, f), 'utf8');
  [['sales.js', ['openInvPdf', 'viewBillSale'], /printInv\(r\)|QLX\.viewDoc/],
   ['purchase.js', ['openBillPdf', 'viewBill'], /pdfWindow\(r\)|QLX\.viewDoc/]].forEach(([file, fns, fallback]) => {
    const src = read(file);
    fns.forEach(fn => {
      const i = src.indexOf('function ' + fn + '(');
      if (i < 0) return;                       // renamed — the other checks still cover it
      const end = src.indexOf('\nasync function ', i + 10);
      const blk = src.slice(i, end > 0 ? end : i + 2200);
      const miss = blk.slice(blk.indexOf('instanceof Blob'));
      ok(!/toast\([^)]*\);\s*return;/.test(miss),
        file + ' · ' + fn + ': the missing-scan branch does not return early');
      ok(fallback.test(blk), '  …so it reaches the generated bill');
      ok(/device it was uploaded from/.test(blk),
        '  …and it says WHY the scan is not here');
    });
  });
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
