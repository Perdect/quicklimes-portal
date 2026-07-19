/* global-search.test.js — ⌘K finds a truck, a GSTIN, a supplier's bill.
 *
 * The owner's example, verbatim: search a vehicle number, get results from
 * Sales AND Purchase. The palette used to match invoice number + party name
 * only — "RJ21GE7361" found nothing, and PURCHASES were never searched at
 * all. The REAL paletteItems is extracted from shell.js and run against
 * fixtures, deleted/voided records included, because a search hit the user
 * taps and cannot find in the register is worse than no hit.
 *
 *   node global-search.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ ⌘K · one keyword, every module ═══\n');

const src = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8');
const i = src.indexOf('function paletteItems(q) {');
const j = src.indexOf('\n  }', i) + 4;
ok(i > 0, 'the REAL paletteItems extracted from shell.js');

const S = {
  PARTIES: [{ name: 'Ambuja Cement' }, { name: 'Gone Party', _del: { at: 'x' } }],
  SALES: [
    { inv: '57/2026-27', party: 'Quality Chemical', veh: 'RJ21GE7361', gstin: '08AAQCA1234A1Z5', date: '2026-06-29' },
    { inv: '58/2026-27', party: 'Deleted Sale', veh: 'RJ21GE7361', date: '2026-06-30', _del: { at: 'x' } }
  ],
  PURCHASES: [
    { bill: '222/26-27', sup: 'Mateshwari Mines', veh: 'RJ21GE7361', gstin: '24AAACI1681G1ZV', date: '2026-06-29' },
    { bill: '223/26-27', sup: 'Voided Bill', veh: 'RJ21GE7361', date: '2026-06-30', status: 'cancelled' }
  ]
};
const ctx = { window: { QLD: { state: S, fDS: d => d } }, navPages: () => [], Set, JSON, Math, String };
vm.createContext(ctx);
vm.runInContext(src.slice(i, j) + '\nthis.__pi = paletteItems;', ctx);
const pi = ctx.__pi;

/* ── the owner's example: a truck number, results from BOTH registers ── */
{
  const r = pi('rj21ge7361');
  const groups = [...new Set(r.map(x => x.group))];
  ok(groups.includes('Invoices'), 'a VEHICLE NUMBER finds the sales invoice it carried');
  ok(groups.includes('Purchase bills'), '  and the purchase bill — purchases are finally searchable');
  ok(r.some(x => /57\/2026-27/.test(x.t)), '  the right invoice');
  ok(r.some(x => /222\/26-27/.test(x.t)), '  the right bill');
  ok(r.every(x => !/Deleted Sale/.test(x.t)), 'a DELETED invoice never surfaces — a hit you cannot find in the register is a lie');
  ok(r.every(x => !/Voided Bill/.test(x.t)), '  nor a voided bill');
  ok(r.some(x => /🚚 RJ21GE7361/.test(x.s)), 'the result SHOWS the truck, so he knows why it matched');
}
/* ── a GSTIN off a bill ── */
{
  ok(pi('24aaaci1681').some(x => /Mateshwari/.test(x.t)), 'a GSTIN finds the supplier\'s bill');
  ok(pi('08aaqca1234').some(x => /Quality Chemical/.test(x.t)), '  and a customer GSTIN finds the invoice');
}
/* ── the old behaviours must survive ── */
{
  ok(pi('ambuja').some(x => x.group === 'Parties'), 'party-name search still works');
  ok(pi('ambuja').every(x => !/Gone Party/.test(x.t)), '  deleted parties stay out');
  ok(pi('57/2026').some(x => x.group === 'Invoices'), 'invoice-number search still works');
  eq('an empty query returns no record noise', pi('').length, 0);
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
