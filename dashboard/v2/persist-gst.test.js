/* persist-gst.test.js — two silent-data-loss bugs from the audit.
 *
 * 1. A 1-character party name discarded the whole invoice. addSale delegated its
 *    commit to upsertParty, which returns early WITHOUT committing on a name under
 *    two characters. The invoice went into memory, the toast said "Invoice
 *    created", and a reload showed nothing. Silent, and the user's word for it was
 *    "these types of issues not expected".
 *
 * 2. importGenericBill stamped 5% GST on a nil-rated bill. `if (!rate) rate = 5`
 *    read an explicit 0% as "missing", inventing ₹5,000 of ITC on a ₹1,00,000 bill
 *    that carried none.
 *
 *   node persist-gst.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(a === b, m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ persist + GST rate ═══\n');

function grabBlock(startsWith, endsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) throw new Error('not found: ' + startsWith);
  return src.slice(i, src.indexOf(endsWith, i) + endsWith.length);
}
function grabLine(startsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) throw new Error('not found: ' + startsWith);
  return src.slice(i, src.indexOf('\n', i));
}

/* Real functions out of data.js, with a commit() that COUNTS instead of saving —
   the whole bug is "did commit run?". */
let commits = 0;
const S = { SALES: [], PURCHASES: [], PARTIES: [] };
const ctx = {
  console, Math, Object, Array, Number, String, isFinite, parseFloat, isNaN, Date, JSON, RegExp,
  S, commit: () => { commits++; },
  upper: x => (x == null ? '' : String(x)).toUpperCase(),
  idStamp: () => 'ID', toISODate: d => d || '', fmtISO: () => '2026-07-16',
  ImportGuard: require('./import-guard.js'),
  cS: s => ({ tx: 0, tot: 0 }), partyGstin: () => ''
};
vm.createContext(ctx);
vm.runInContext([
  grabLine('const SUP_LEAK ='),
  grabBlock('function upsertParty(', '\n  }'),
  grabBlock('function dupCheck(', '\n  }'),
  grabBlock('function addSale(', '\n  }'),
  grabLine('function updateSale(i, e)'),
  grabBlock('function addPurchase(', '\n  }'),
  grabBlock('function importGenericBill(', '\n  }'),
  'this.addSale = addSale; this.addPurchase = addPurchase; this.importGenericBill = importGenericBill;'
].join('\n'), ctx);
ok(typeof ctx.addSale === 'function', 'the real addSale / addPurchase / importGenericBill loaded');

const reset = () => { S.SALES.length = 0; S.PURCHASES.length = 0; S.PARTIES.length = 0; commits = 0; };

/* ══════════ 1. THE INVOICE MUST PERSIST ══════════ */
{
  reset();
  const r = ctx.addSale({ inv: 'S/1', party: 'A', gstin: '', qty: 1, rate: 1000, gstR: 5 });
  eq('a 1-char customer name still SAVES the invoice', r.ok, true);
  eq('  the invoice is in the store', S.SALES.length, 1);
  ok(commits >= 1, '  and commit() actually ran — without it the reload loses the invoice');
  /* The party legitimately is NOT created (too short to be a real name) — but that
     must not take the invoice down with it. */
  eq('  the too-short party is not created', S.PARTIES.length, 0);

  reset();
  ctx.addSale({ inv: 'S/2', party: 'Mateshwari Mines', gstin: '08AAA0000A1Z5', qty: 1, rate: 1000, gstR: 5 });
  eq('a normal name still creates the party', S.PARTIES.length, 1);
  ok(commits >= 1, '  and still commits');

  reset();
  ctx.addPurchase({ bill: 'B/1', sup: 'X', gstin: '', taxable: 5000, grate: 5 });
  eq('a 1-char SUPPLIER name still saves the bill', S.PURCHASES.length, 1);
  ok(commits >= 1, '  and commits');
}

/* ══════════ 2. AN EXPLICIT 0% RATE MUST SURVIVE ══════════ */
{
  reset();
  ctx.importGenericBill('purchase', { docno: 'N/1', name: 'Nil Co', taxable: 100000, rate: 0, itc: 'Eligible' });
  eq('THE BUG: a bill imported at 0% GST stays 0%, not 5%', S.PURCHASES[0].grate, 0);

  reset();
  ctx.importGenericBill('purchase', { docno: 'N/2', name: 'Nil Co', taxable: 100000, rate: '0' });
  eq('  "0" as a string also stays 0%', S.PURCHASES[0].grate, 0);

  /* Default 5% ONLY when the rate is genuinely absent — a sensible default for lime. */
  reset();
  ctx.importGenericBill('purchase', { docno: 'M/1', name: 'No Rate Co', taxable: 100000 });
  eq('a bill with NO rate column defaults to 5%', S.PURCHASES[0].grate, 5);
  reset();
  ctx.importGenericBill('purchase', { docno: 'M/2', name: 'Blank Co', taxable: 100000, rate: '' });
  eq('  a blank rate also defaults to 5%', S.PURCHASES[0].grate, 5);

  /* A real rate is preserved, and a fraction is normalised. */
  reset();
  ctx.importGenericBill('purchase', { docno: 'R/1', name: 'Co', taxable: 100000, rate: 18 });
  eq('a real 18% rate is preserved', S.PURCHASES[0].grate, 18);
  reset();
  ctx.importGenericBill('purchase', { docno: 'R/2', name: 'Co', taxable: 100000, rate: 0.18 });
  eq('a fractional 0.18 is normalised to 18%', S.PURCHASES[0].grate, 18);
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
