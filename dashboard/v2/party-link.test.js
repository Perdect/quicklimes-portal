/* party-link.test.js — one way into a customer, and it must never guess.
 * Run: node party-link.test.js */
global.window = global;
const PL = require('./party-link.js');
let pass = 0, fail = 0; const bad = [];
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : (fail++, bad.push(`${n} → got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)); };
const ok = (n, c) => { c ? pass++ : (fail++, bad.push(n)); };

/* the real party list from this business, including its real collisions */
global.QLD = { partyRows: () => ([
  { idx: 0, id: 'p001', name: 'AMAN LIME PRODUCTS',      gstin: '08AMCPM0730H3ZB' },
  { idx: 1, id: 'p002', name: 'AMAN ENTERPRISES',        gstin: '08AAKPI9578B1ZE' },
  { idx: 2, id: 'p003', name: 'DESHWALI MINERALS',       gstin: '08NLIPS9801K1Z5' },
  { idx: 3, id: 'p004', name: 'DESHWALI LIME INDUSTRIES',gstin: '08AGFPA5934N4Z3' },
  { idx: 4, id: 'p005', name: 'ARIF CHEMICAL LIME',      gstin: '08ALAPD1927C1ZR' },
  { idx: 5, id: 'p006', name: 'ARIF CHEMICAL LIME',      gstin: '' }   // duplicate name, no gstin
]) };

/* ══ GSTIN WINS — the two AMANs are different companies ═══════════ */
{
  PL.invalidate();
  const a = PL.resolve({ name: 'AMAN LIME PRODUCTS', gstin: '08AAKPI9578B1ZE' });
  eq('GSTIN · the GSTIN decides, not the printed name', a.party.name, 'AMAN ENTERPRISES');
  eq('GSTIN · and says how', a.how, 'gstin');
  const b = PL.resolve({ name: 'AMAN ENTERPRISES', gstin: '08AMCPM0730H3ZB' });
  eq('GSTIN · works the other way too', b.party.name, 'AMAN LIME PRODUCTS');
}
/* the DESHWALI trap: own firm vs a real external customer */
{
  PL.invalidate();
  const r = PL.resolve({ name: 'DESHWALI LIME INDUSTRIES', gstin: '08AGFPA5934N4Z3' });
  eq('TRAP · the external customer resolves to itself', r.party.name, 'DESHWALI LIME INDUSTRIES');
  eq('TRAP · not to the owner\'s own firm', r.party.id === 'p003', false);
}

/* ══ AN AMBIGUOUS NAME RESOLVES TO NOTHING ════════════════════════
   Two parties named ARIF CHEMICAL LIME. Sending someone to the wrong
   ledger is worse than sending them nowhere. */
{
  PL.invalidate();
  const r = PL.resolve({ name: 'ARIF CHEMICAL LIME', gstin: '' });
  eq('AMBIG · refuses to pick one', r.party, null);
  ok('AMBIG · and says why', /more than one customer/.test(r.why));
  const chip = PL.chip({ name: 'ARIF CHEMICAL LIME' });
  ok('AMBIG · renders unlinked', chip.indexOf('<a ') < 0);
  ok('AMBIG · with the reason in a tooltip', /more than one customer/.test(chip));
  /* but WITH a GSTIN it is no longer ambiguous */
  const g = PL.resolve({ name: 'ARIF CHEMICAL LIME', gstin: '08ALAPD1927C1ZR' });
  eq('AMBIG · a GSTIN breaks the tie', g.party.id, 'p005');
}

/* ══ ROUTING IS BY STABLE ID, NEVER ARRAY INDEX ═══════════════════ */
{
  PL.invalidate();
  const chip = PL.chip({ name: 'AMAN ENTERPRISES', gstin: '08AAKPI9578B1ZE' });
  ok('ROUTE · links to the finance portal', /ledger\.html\?id=p002/.test(chip));
  ok('ROUTE · never routes by array index', !/\?party=\d/.test(chip));
  ok('ROUTE · shows the name from the ROW, not the master', chip.indexOf('AMAN ENTERPRISES') >= 0);
}
/* the row's own spelling is what the document says — never overwritten */
{
  PL.invalidate();
  const chip = PL.chip({ name: 'Aman Enterprises (as printed)', gstin: '08AAKPI9578B1ZE' });
  ok('ROW · the printed name is preserved', chip.indexOf('Aman Enterprises (as printed)') >= 0);
  ok('ROW · but it still links to the right party', /id=p002/.test(chip));
}

/* ══ UNKNOWN PARTY ════════════════════════════════════════════════ */
{
  PL.invalidate();
  const r = PL.resolve({ name: 'SOMEONE NEW', gstin: '08ZZZZZ9999Z1ZZ' });
  eq('NEW · unknown resolves to null', r, null);
  const chip = PL.chip({ name: 'SOMEONE NEW' });
  ok('NEW · renders unlinked', chip.indexOf('<a ') < 0);
  ok('NEW · explains', /not in the customer list/.test(chip));
  eq('NEW · offers no actions', PL.actions({ name: 'SOMEONE NEW' }).length, 0);
}

/* ══ ACTIONS + SAFETY ═════════════════════════════════════════════ */
{
  PL.invalidate();
  const acts = PL.actions({ name: 'x', gstin: '08AAKPI9578B1ZE' });
  eq('ACTIONS · three per customer', acts.length, 3);
  eq('ACTIONS · finance portal first', acts[0].label, 'Finance portal');
  ok('ACTIONS · all callable', acts.every(a => typeof a.onClick === 'function'));
  /* XSS: a party name is user data and reaches innerHTML */
  const chip = PL.chip({ name: '<img src=x onerror=alert(1)>', gstin: '08AAKPI9578B1ZE' });
  ok('XSS · the name is escaped', chip.indexOf('<img') < 0 && chip.indexOf('&lt;img') >= 0);
  /* plain mode for exports and print */
  eq('PLAIN · exports get text only', PL.chip({ name: 'AMAN ENTERPRISES', gstin: '08AAKPI9578B1ZE' }, { plain: true }), 'AMAN ENTERPRISES');
}

/* ══ THE INDEX IS BUILT ONCE, NOT PER ROW ═════════════════════════ */
{
  let calls = 0;
  const real = global.QLD.partyRows;
  global.QLD.partyRows = () => { calls++; return real(); };
  PL.invalidate();
  for (let i = 0; i < 50; i++) PL.chip({ name: 'AMAN ENTERPRISES', gstin: '08AAKPI9578B1ZE' });
  ok('PERF · 50 rows did not rebuild the index 50 times (' + calls + ')', calls <= 2);
  global.QLD.partyRows = real;
}

console.log('\n════ party-link (one way into a customer) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' PARTY-LINK TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
