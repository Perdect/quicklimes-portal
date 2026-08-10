/* party-resolve.test.js — the party resolution engine.
 * Built from the REAL data in both books: the 8 corrupted rows, their true
 * GSTINs, and the two poisoned party-master entries.
 * Run: node party-resolve.test.js */
const R = require('./party-resolve.js');
let pass = 0, fail = 0; const bad = [];
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : (fail++, bad.push(`${n} → got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)); };
const close = (n, a, b) => { Math.abs(a - b) < 0.005 ? pass++ : (fail++, bad.push(`${n} → got ${a}, want ${b}`)); };

const STRAP = 'MANUFACTURES OF QUICK LIME AND HYDRATED LIME';

/* The real index: Gotan's party master (incl. its poisoned entry) + history */
const IDX = R.buildIndex([
  { company: 'gotan',
    parties: [
      { id: 'p1', name: 'AMAN LIME PRODUCTS', gstin: '08AMCPM0730H3ZB' },
      { id: 'p2', name: 'AMAN ENTERPRISES', gstin: '08AAKPI9578B1ZE' },
      { id: 'p3', name: 'KIRTI LIME PRODUCTS', gstin: '08AOTPS8291Q1ZF' },
      { id: 'p4', name: 'ARIF CHEMICAL LIME', gstin: '08AAAAA1111A1Z5' },
      { id: 'p22', name: STRAP, gstin: '08AZLPR8978G1ZD' }        // POISONED
    ],
    rows: [
      { name: 'AMAN LIME PRODUCTS', gstin: '08AMCPM0730H3ZB' },
      { name: 'ARIF CHEMICAL LIME', gstin: '08AAAAA1111A1Z5' },
      { name: 'LUXMI CHEMICAL INDUSTRIES', gstin: '' }             // history only, no GSTIN
    ] },
  { company: 'deshwali', parties: [{ id: 'd1', name: STRAP, gstin: '08ABYPS4357F1ZX' }], rows: [] }
]);
const OWN = ['08NLIPS9801K1Z5', '08BNAPM0488E1Z3'];

/* ══ THE HEADLINE CASE — the 8 corrupted rows ═══════════════════════════
   Correct GSTIN, garbage name. The GSTIN must win outright. */
{
  const r = R.resolve({ name: STRAP, gstin: '08AMCPM0730H3ZB' }, { index: IDX, ownGstins: OWN });
  eq('BUG · resolves by GSTIN, not by the printed name', r.matchMethod, 'gstin_exact');
  eq('BUG · to the real customer', r.canonicalName, 'AMAN LIME PRODUCTS');
  close('BUG · at full confidence', r.matchConfidence, 0.99);
  eq('BUG · auto band', r.band, 'auto');
  eq('BUG · no review needed', r.needsReview, false);
  eq('BUG · the printed name is KEPT as evidence, not discarded', r.detectedName, STRAP);
  eq('BUG · and is called out as a strapline', r.detectedNameSuspect, 'trade strapline');
  eq('BUG · the evidence names both sides', /the document said/.test(r.evidence.join(' ')), true);
}
{ /* the other two that resolve from existing records */
  eq('BUG · 08AAKPI9578B1ZE', R.resolve({ name: STRAP, gstin: '08AAKPI9578B1ZE' }, { index: IDX }).canonicalName, 'AMAN ENTERPRISES');
  eq('BUG · 08AOTPS8291Q1ZF', R.resolve({ name: STRAP, gstin: '08AOTPS8291Q1ZF' }, { index: IDX }).canonicalName, 'KIRTI LIME PRODUCTS');
}

/* ══ THE POISON LOOP — the whole reason this module exists ═════════════
   GSTIN 08AZLPR8978G1ZD IS in the master, but the only name stored for it
   is the strapline. Serving that would launder a bad OCR read into a fact. */
{
  const r = R.resolve({ name: STRAP, gstin: '08AZLPR8978G1ZD' }, { index: IDX, ownGstins: OWN });
  eq('POISON · refuses to serve the poisoned master entry', r.matchMethod, 'gstin_poisoned');
  eq('POISON · does NOT hand back the junk name', r.canonicalName, '');
  eq('POISON · but reports that the GSTIN itself is known', r.gstinKnown, true);
  eq('POISON · names the offending value for repair', r.poisonedName, STRAP);
  eq('POISON · sends it to review', r.needsReview, true);
  eq('POISON · and refuses to create a party', r.mayCreateParty, false);
  eq('POISON · explains why', /is a trade strapline/.test(r.evidence.join(' ')), true);
}
{ /* frequency must NOT entrench a poisoned name */
  const spam = R.buildIndex([{ company: 'x', parties: [{ id: 'g', name: 'GOOD LIME CO', gstin: '08ZZZZZ9999Z1ZZ' }],
    rows: Array.from({ length: 40 }, () => ({ name: STRAP, gstin: '08ZZZZZ9999Z1ZZ' })) }]);
  const r = R.resolve({ name: STRAP, gstin: '08ZZZZZ9999Z1ZZ' }, { index: spam });
  eq('POISON · 40 bad bookings never outvote 1 clean name', r.canonicalName, 'GOOD LIME CO');
}

/* ══ GSTIN OUTRANKS NAME, even a plausible name ════════════════════════ */
{
  const r = R.resolve({ name: 'AMAN ENTERPRISES', gstin: '08AMCPM0730H3ZB' }, { index: IDX });
  eq('RANK · the GSTIN decides, not the printed name', r.canonicalName, 'AMAN LIME PRODUCTS');
  eq('RANK · method is the identifier', r.matchMethod, 'gstin_exact');
}

/* ══ PAN — two GSTINs, one legal entity ════════════════════════════════ */
{
  const r = R.resolve({ name: 'AMAN LIME PRODUCTS BRANCH', gstin: '27AMCPM0730H1Z9' }, { index: IDX });
  eq('PAN · a second state registration matches on PAN', r.matchMethod, 'pan_exact');
  eq('PAN · to the same legal entity', r.canonicalName, 'AMAN LIME PRODUCTS');
  eq('PAN · accept-evidence band', r.band, 'accept-evidence');
}

/* ══ NAME PATHS when there is no GSTIN ═════════════════════════════════ */
{
  const m = R.resolve({ name: 'AMAN LIME PRODUCTS', gstin: '' }, { index: IDX });
  eq('NAME · exact master name matches', m.matchMethod, 'name_exact');
  close('NAME · 0.90', m.matchConfidence, 0.90);
  const h = R.resolve({ name: 'LUXMI CHEMICAL INDUSTRIES', gstin: '' }, { index: IDX });
  eq('NAME · a party known only from history still matches', h.matchMethod, 'history');
  eq('NAME · history is enough to accept', h.needsReview, false);
}

/* ══ NEVER SILENTLY CREATE A PARTY ═════════════════════════════════════ */
{
  const withG = R.resolve({ name: 'BRAND NEW LIME CO', gstin: '08NEWNE1234N1Z5' }, { index: IDX });
  eq('NEW · a new name + new GSTIN is a new party', withG.matchMethod, 'new_party');
  eq('NEW · but 0.80 is below the creation floor', withG.mayCreateParty, false);
  eq('NEW · so it goes to review', withG.needsReview, true);
  eq('NEW · and says so', /held for confirmation/.test(withG.evidence.join(' ')), true);
  const noG = R.resolve({ name: 'SOME TRADER', gstin: '' }, { index: IDX });
  close('NEW · no GSTIN scores lower still', noG.matchConfidence, 0.62);
  eq('NEW · review required', noG.band, 'review-required');
  eq('NEW · never creates', noG.mayCreateParty, false);
}

/* ══ A JUNK NAME NEVER MATCHES ANYTHING ════════════════════════════════ */
{
  const cases = [
    [STRAP, 'trade strapline'],
    ['AN ISO 9001:2015 CERTIFIED COMPANY', 'ISO certification line'],
    ['TAX INVOICE', 'document title'],
    ['Original Copy', 'copy marker'],
    ['www.gotanlime.com', 'web/email line'],
    ['Gotan Road, Nagaur 341022', 'contains a pincode']
  ];
  cases.forEach(([s, why]) => eq('JUNK · "' + s.slice(0, 26) + '" → ' + why, R.suspect(s), why));
  /* and the ones that must SURVIVE */
  ['AMAN TRADERS', 'Bombay Metal Traders LLP', 'TRADERS ASSOCIATION OF NAGAUR',
   'Manufacturers of Quick Lime Pvt Ltd', 'Rajasthan Dealers Corporation',
   'KIRTI LIME PRODUCTS', 'Indian Oil Corporation Limited', 'QUALITY CHEMICAL AND ALLIED PRODUCT'
  ].forEach(s => eq('KEEP · "' + s.slice(0, 30) + '" is a real name', R.suspect(s), null));
  const r = R.resolve({ name: 'TAX INVOICE', gstin: '' }, { index: IDX });
  eq('JUNK · a document title resolves to nothing', r.matchMethod, 'name_rejected');
  eq('JUNK · and creates nothing', r.mayCreateParty, false);
}

/* ══ OUR OWN FIRM AS COUNTERPARTY = the sides are swapped ══════════════ */
{
  const r = R.resolve({ name: 'GOTAN LIME INDUSTRIES', gstin: '08BNAPM0488E1Z3' }, { index: IDX, ownGstins: OWN });
  eq('OWN · detected', r.matchMethod, 'own_firm');
  eq('OWN · refuses to resolve', r.canonicalName, '');
  eq('OWN · flags the swap', /sides are swapped/.test(r.evidence.join(' ')), true);
  eq('OWN · review required', r.band, 'review-required');
}

/* ══ BANDS ═════════════════════════════════════════════════════════════ */
{
  eq('BAND · 0.99 auto', R.bandOf(0.99).band, 'auto');
  eq('BAND · 0.90 accept-evidence', R.bandOf(0.90).band, 'accept-evidence');
  eq('BAND · 0.72 review-suggested', R.bandOf(0.72).band, 'review-suggested');
  eq('BAND · 0.40 review-required', R.bandOf(0.40).band, 'review-required');
  eq('BAND · a 0.55 name — the exact score that sailed through — now holds', R.bandOf(0.55).action, 'hold');
}

/* ══ INDEX HEALTH — finds what needs repairing ═════════════════════════ */
{
  eq('INDEX · both poisoned master entries are detected', IDX.stats.suspect, 2);
  eq('INDEX · GSTINs indexed', IDX.stats.gstins >= 6, true);
}

console.log('\n════ party-resolve (GSTIN-first identity) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' PARTY-RESOLVE TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
