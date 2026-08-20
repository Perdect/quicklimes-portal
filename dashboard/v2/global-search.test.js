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
  /* Two AMANs on purpose: real duplicates that the palette used to collapse
     into one row, hiding a whole customer behind a name it shared. */
  PARTIES: [
    { id: 'p1', name: 'Ambuja Cement', gstin: '08AAACA1111A1Z1', type: 'customer' },
    { id: 'p2', name: 'AMAN ENTERPRISES', gstin: '08AAKPI9578B1ZE', type: 'customer' },
    { id: 'p3', name: 'AMAN LIME PRODUCTS', gstin: '08AAAAL2222B1Z2', type: 'customer' },
    { name: 'LEGACY NO ID', gstin: '', type: 'supplier' },
    { id: 'p9', name: 'Gone Party', _del: { at: 'x' } }
  ],
  SALES: [
    { inv: '57/2026-27', party: 'Quality Chemical', veh: 'RJ21GE7361', gstin: '08AAQCA1234A1Z5', date: '2026-06-29' },
    { inv: '58/2026-27', party: 'Deleted Sale', veh: 'RJ21GE7361', date: '2026-06-30', _del: { at: 'x' } }
  ],
  PURCHASES: [
    { bill: '222/26-27', sup: 'Mateshwari Mines', veh: 'RJ21GE7361', gstin: '24AAACI1681G1ZV', date: '2026-06-29' },
    { bill: '223/26-27', sup: 'Voided Bill', veh: 'RJ21GE7361', date: '2026-06-30', status: 'cancelled' }
  ]
};
/* partyRows mirrors data.js: drops deleted parties and exposes the stable id
   alongside the array position, so the palette can link by identity. */
const partyRows = () => S.PARTIES.map((p, i) => ({ ...p, idx: i, id: p.id || '' })).filter(p => !p._del);
const ctx = { window: { QLD: { state: S, fDS: d => d, partyRows } }, navPages: () => [], Set, JSON, Math, String, encodeURIComponent };
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

/* ── a party hit must OPEN THAT PARTY ─────────────────────────────────────
   It used to send you to sales.html: you searched for a customer, pressed
   Enter, and landed on the sales register with no customer selected. */
{
  const r = pi('ambuja').filter(x => x.group === 'Parties');
  ok(r.length === 1 && /ledger\.html\?id=p1/.test(r[0].href),
     'a party hit opens THAT party\'s finance portal, not the sales register');

  const amans = pi('aman').filter(x => x.group === 'Parties');
  ok(amans.length === 2, 'two real parties sharing a name are BOTH listed, not collapsed into one');
  ok(new Set(amans.map(x => x.href)).size === 2, '  and they go to different places');
  ok(amans.every(x => /08A/.test(x.s)), '  GSTIN in the subtitle tells them apart');

  ok(pi('08aakpi9578').some(x => x.group === 'Parties' && /AMAN ENTERPRISES/.test(x.t)),
     'a GSTIN finds the party it belongs to');

  const legacy = pi('legacy').filter(x => x.group === 'Parties');
  ok(legacy.length === 1 && /party=3/.test(legacy[0].href),
     'a party with no stable id still resolves, by index, rather than vanishing');
  ok(legacy[0].s === 'Supplier · no GSTIN', '  and says plainly that it has no GSTIN');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
