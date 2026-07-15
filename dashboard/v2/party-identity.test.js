/* party-identity.test.js — pins the rules that decide who is ONE party.
 *
 * The reported bug is the first test. The rest guard the ways a fix like this
 * goes wrong: merging two companies that merely share a name is a far worse
 * failure than the duplicate row it was meant to remove.
 *
 *   node party-identity.test.js
 */
'use strict';
const P = require('./party-identity.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got:      ' + JSON.stringify(a) + '\n     expected: ' + JSON.stringify(b));

console.log('\n═══ party identity ═══\n');

/* ── THE REPORTED BUG ──
   Two spellings, one GSTIN, split across two rows with the outstanding divided
   between them. */
const RAMKARAN = [
  { sup: 'RAMKARAN AND SONS', gstin: '08AIUPB9022D1ZB', total: 742642, outstanding: 742642 },
  { sup: 'Ramkaran and Sons', gstin: '08AIUPB9022D1ZB', total: 132383, outstanding: 132383 },
  { sup: 'Ramkaran and Sons', gstin: '08AIUPB9022D1ZB', total: 132384, outstanding: 132384 }
];
let g = P.group(RAMKARAN, r => r.sup, r => r.gstin);
eq('the reported bug: 3 bills, 2 spellings, 1 GSTIN → ONE supplier', g.length, 1);
eq('  spend is summed, not split', g[0].rows.reduce((s, r) => s + r.total, 0), 1007409);
eq('  outstanding is summed (the number a payment decision is made on)', g[0].rows.reduce((s, r) => s + r.outstanding, 0), 1007409);
eq('  label = the spelling used most often, not the first seen', g[0].label, 'Ramkaran and Sons');
eq('  the GSTIN survives as the identity', g[0].gstin, '08AIUPB9022D1ZB');

/* ── RULE 2 — the dangerous inverse. Same name, different state registration.
   These are separate legal entities with separate payables; merging is corruption. */
const IOC = [
  { sup: 'Indian Oil Corporation Limited', gstin: '24AAACI1681G1ZV', total: 8877112, outstanding: 8877112 },
  { sup: 'Indian Oil Corporation Limited', gstin: '08AAACI1681G1Z9', total: 100000, outstanding: 0 }
];
g = P.group(IOC, r => r.sup, r => r.gstin);
eq('same name, DIFFERENT GSTIN (Gujarat vs Rajasthan) → stays TWO parties', g.length, 2);
ok(g[0].gstin !== g[1].gstin, 'the two IOC registrations kept distinct GSTINs');

/* ── RULE 1 beats everything: identical GSTIN, wildly different names ── */
g = P.group([
  { sup: 'M/s Mateshwari Mines & Minerals', gstin: '08ABWFM4111F1Z6' },
  { sup: 'MATESHWARI MINES AND MINERALS', gstin: '08abwfm4111f1z6' },   // lowercase in the data
  { sup: 'Mateshwari  Mines   and Minerals.', gstin: '08 ABWFM4111F1Z6' } // spaces + trailing dot
], r => r.sup, r => r.gstin);
eq('GSTIN wins over spelling, case and stray spacing → ONE party', g.length, 1);

/* ── RULE 3 — no GSTIN at all: light normalisation only ── */
g = P.group([
  { sup: 'Ramkaran and Sons' }, { sup: 'RAMKARAN AND SONS' }, { sup: 'Ramkaran and Sons.' }
], r => r.sup, r => r.gstin);
eq('no GSTIN: case/spacing/dot variants of one name → ONE party', g.length, 1);

/* ── RULE 3, the line we do NOT cross ──
   crm-core's normName() would fuse these into "SHREE CEMENT". It is right to
   SUGGEST that to a human (certain:false) and wrong to do it silently. */
g = P.group([{ sup: 'Shree Cement Ltd' }, { sup: 'Shree Cement Co' }], r => r.sup, r => r.gstin);
eq('different firms sharing a stem, no GSTIN → NOT merged (a wrong merge is a wrong payment)', g.length, 2);
g = P.group([{ sup: 'Ramkaran and Sons' }, { sup: 'Ramkaran Traders' }], r => r.sup, r => r.gstin);
eq('similar but distinct names → NOT merged', g.length, 2);

/* ── RULE 4 — adopting a GSTIN from a name-twin ── */
g = P.group([
  { sup: 'Mateshwari Mines', gstin: '08ABWFM4111F1Z6' },
  { sup: 'Mateshwari Mines' }                                   // same firm, GSTIN missing on this bill
], r => r.sup, r => r.gstin);
eq('a bill missing its GSTIN joins its unambiguous name-twin', g.length, 1);
eq('  and inherits the identity', g[0].gstin, '08ABWFM4111F1Z6');

g = P.group([
  { sup: 'Indian Oil', gstin: '24AAACI1681G1ZV' },
  { sup: 'Indian Oil', gstin: '08AAACI1681G1Z9' },
  { sup: 'Indian Oil' }                                          // WHICH of the two? unknowable
], r => r.sup, r => r.gstin);
eq('a name mapping to TWO GSTINs is ambiguous → the blank one is NOT guessed into either', g.length, 3);

/* ── labels ── */
const idx = P.index(RAMKARAN, r => r.sup, r => r.gstin);
eq('label is deterministic across calls', idx.labelOf(idx.keyOf('RAMKARAN AND SONS', '08AIUPB9022D1ZB')), 'Ramkaran and Sons');
g = P.group([{ sup: 'ABC' }, { sup: 'ABC Industries' }], r => r.sup, r => r.gstin);
eq('distinct names are not collapsed by prefix', g.length, 2);
g = P.group([{ sup: 'A Ltd', gstin: 'G1' }, { sup: 'A Limited', gstin: 'G1' }], r => r.sup, r => r.gstin);
eq('tie on frequency → longest (most complete) label', g[0].label, 'A Limited');

/* ── junk in ── */
g = P.group([{ sup: '' }, { sup: null }, { sup: '   ' }], r => r.sup, r => r.gstin);
eq('blank suppliers collapse to one bucket, not three', g.length, 1);
eq('normGstin strips separators', P.normGstin(' 08-abwfm 4111f1z6 '), '08ABWFM4111F1Z6');
eq('normName is case/space/dot only', P.normName('  Ramkaran  and Sons. '), 'RAMKARAN AND SONS');
eq('normName does NOT strip legal suffixes (that is crm-core\'s job, with a human in the loop)', P.normName('Shree Cement Pvt Ltd'), 'SHREE CEMENT PVT LTD');
ok(P.group([], r => r.sup).length === 0, 'empty input → empty output, no throw');

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
