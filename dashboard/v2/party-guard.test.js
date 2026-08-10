/* party-guard.test.js — THE POISON LOOP MUST BE UNREACHABLE.
 *
 * The loop was: OCR reads a strapline -> upsertParty() makes it a party ->
 * ownInfo()/history feeds it back to the parser at 0.99 -> every later bill
 * "confidently" agrees -> the mistake entrenches itself.
 *
 * These tests assert the boundary at the one choke point every automatic
 * path funnels through, so no call site can reopen it.
 * Run: node party-guard.test.js */
const fs = require('fs');
const D = fs.readFileSync(__dirname + '/data.js', 'utf8');
const SH = fs.readFileSync(__dirname + '/shell.js', 'utf8');
const R = require('./party-resolve.js');
let pass = 0, fail = 0; const bad = [];
const ok = (n, c) => { c ? pass++ : (fail++, bad.push(n)); };
const eq = (n, a, b) => { const c = JSON.stringify(a) === JSON.stringify(b);
  c ? pass++ : (fail++, bad.push(`${n} → got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)); };

/* ── the guard exists, at the choke point ── */
ok('upsertParty takes a `trusted` flag', /function upsertParty\(name, gstin, phone, address, state, type, trusted\)/.test(D));
ok('it screens via the SHARED definition, not a private copy', /QLPartyResolve[\s\S]{0,80}suspect/.test(D));
ok('a trusted call skips the screen entirely', /!trusted && PR && PR\.suspect/.test(D));
ok('creation is REFUSED when the name is junk', /if \(junk\) \{/.test(D));
ok('  and the refusal is written to the audit log', /logAudit\('refused', 'party'/.test(D));
ok('  naming what was rejected', /the detected name is a ' \+ junk/.test(D));
ok('  and returns a machine-readable verdict', /refused: junk/.test(D));

/* ── the refusal blocks CREATION only, never an update ──
   A real party that happens to carry a bad label still deserves its phone
   number filled in; the block is on minting canonical identity, not on
   enriching something that already exists. */
const body = D.slice(D.indexOf('function upsertParty('), D.indexOf('function upsertParty(') + 2400);
ok('the junk check sits in the CREATE branch, after the existing-party branch',
   body.indexOf('if (junk)') > body.indexOf('if (idx >= 0)'));
ok('the update branch has no junk gate', !/if \(idx >= 0\)[\s\S]{0,400}if \(junk\)/.test(body));

/* ── every automatic caller is covered BY the choke point ── */
['if (e.party) upsertParty(e.party', 'if (e.sup) upsertParty(e.sup'].forEach(c =>
  ok('automatic caller routes through the guard: ' + c.slice(0, 34), D.includes(c)));
ok('addSale does not pass trusted', !/upsertParty\(e\.party[^)]*, true\)/.test(D));
ok('addPurchase does not pass trusted', !/upsertParty\(e\.sup[^)]*, true\)/.test(D));

/* ── the human path IS trusted ── */
ok('the manual party form passes trusted=true', /upsertParty\(v\.name, v\.gstin, v\.phone, v\.address, v\.state, v\.type, true\)/.test(SH));

/* ── no second creation path exists ──
   S.PARTIES.push outside upsertParty would reopen the loop. The only other
   push is the bulk hydrate in loadLocal, which replays already-saved data. */
const pushes = (D.match(/S\.PARTIES\.push\(/g) || []).length;
eq('exactly two S.PARTIES.push sites (hydrate + guarded create)', pushes, 2);
ok('one of them is the loadLocal hydrate', /if \(d\.parties\)\s+S\.PARTIES\.push\(\.\.\.d\.parties\)/.test(D));

/* ── the shared screen actually catches what corrupted this book ── */
[['MANUFACTURES OF QUICK LIME AND HYDRATED LIME', 'trade strapline'],
 ['AN ISO 9001:2015 CERTIFIED COMPANY', 'ISO certification line'],
 ['TAX INVOICE', 'document title'],
 ['Duplicate for Transporter', 'copy marker'],
 ['Gotan Road, Nagaur 341022', 'contains a pincode']
].forEach(([s, why]) => eq('SCREEN · rejects "' + s.slice(0, 30) + '"', R.suspect(s), why));

/* ── and spares every real customer in this book ── */
['AMAN LIME PRODUCTS', 'AMAN ENTERPRISES', 'KIRTI LIME PRODUCTS', 'ARIF CHEMICAL LIME',
 'QUALITY CHEMICAL AND ALLIED PRODUCT', 'Indian Oil Corporation Limited',
 'LUXMI CHEMICAL INDUSTRIES', 'AFRA AQUA', 'DESHWALI MINERALS', 'Pooja Enterprises',
 'Mateshwari Mines and Minerals', 'AMAN TRADERS', 'Bombay Metal Traders LLP',
 'TRADERS ASSOCIATION OF NAGAUR', 'Manufacturers of Quick Lime Pvt Ltd'
].forEach(s => eq('SPARE · "' + s.slice(0, 32) + '"', R.suspect(s), null));

/* ── the loop, end to end: junk can never become high-confidence ── */
{
  const STRAP = 'MANUFACTURES OF QUICK LIME AND HYDRATED LIME';
  const idx = R.buildIndex([{ company: 'x',
    parties: [{ id: 'bad', name: STRAP, gstin: '08AZLPR8978G1ZD' }],
    rows: Array.from({ length: 25 }, () => ({ name: STRAP, gstin: '08AZLPR8978G1ZD' })) }]);
  const r = R.resolve({ name: STRAP, gstin: '08AZLPR8978G1ZD' }, { index: idx });
  eq('LOOP · a poisoned master entry never returns as canonical', r.canonicalName, '');
  eq('LOOP · it is reported for repair instead', r.matchMethod, 'gstin_poisoned');
  ok('LOOP · confidence stays below the auto band', r.matchConfidence < 0.95);
  eq('LOOP · and it can never mint a party', r.mayCreateParty, false);
  ok('LOOP · 25 repetitions do not promote it', r.matchConfidence <= 0.5);
}

console.log('\n════ party-guard (the poison loop is unreachable) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' PARTY-GUARD TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
