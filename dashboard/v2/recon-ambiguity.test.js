/* recon-ambiguity.test.js — two different customers must never be matched
 * to each other because they share one word.
 *
 * THE REAL INCIDENT this pins: a ₹4,97,490 RTGS whose narration read
 * "RTGS-ICICR42026062100511668-AMAN ENTERPRISES" was matched to invoice
 * 171/2025-26, which belongs to AMAN LIME PRODUCTS (a different company,
 * GSTIN 08AMCPM0730H3ZB vs 08AAKPI9578B1ZE) and is worth ₹1,32,489 with
 * GST. The app booked it as a ₹3,65,001 overpayment while AMAN
 * ENTERPRISES' own ledger still read "no payment received yet".
 * Run: node recon-ambiguity.test.js */
const R = require('./recon-core.js');
let pass = 0, fail = 0; const bad = [];
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : (fail++, bad.push(`${n} → got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)); };
const ok = (n, c) => { c ? pass++ : (fail++, bad.push(n)); };

/* the real party list from this book */
const PARTIES = [
  { name: 'AMAN LIME PRODUCTS', gstin: '08AMCPM0730H3ZB' },
  { name: 'AMAN ENTERPRISES', gstin: '08AAKPI9578B1ZE' },
  { name: 'ARIF CHEMICAL LIME', gstin: '08ALAPD1927C1ZR' },
  { name: 'KIRTI LIME PRODUCTS', gstin: '08AOTPS8291Q1ZF' },
  { name: 'DESHWALI MINERALS', gstin: '08NLIPS9801K1Z5' },
  { name: 'DESHWALI LIME INDUSTRIES', gstin: '08AGFPA5934N4Z3' }
];
const amb = R.ambiguousSet(PARTIES);

/* ══ THE COLLAPSE ══════════════════════════════════════════════════
   STOP strips LIME / PRODUCTS / ENTERPRISES / MINERALS — reasonable in
   general, ruinous here. */
eq('FINGERPRINT · AMAN LIME PRODUCTS collapses to AMAN', R.fingerprint('AMAN LIME PRODUCTS'), 'AMAN');
eq('FINGERPRINT · AMAN ENTERPRISES collapses to the SAME token', R.fingerprint('AMAN ENTERPRISES'), 'AMAN');
eq('FINGERPRINT · DESHWALI MINERALS → DESHWALI', R.fingerprint('DESHWALI MINERALS'), 'DESHWALI');
eq('FINGERPRINT · DESHWALI LIME INDUSTRIES → the same', R.fingerprint('DESHWALI LIME INDUSTRIES'), 'DESHWALI');
ok('AMBIGUOUS · AMAN is detected', amb.has('AMAN'));
ok('AMBIGUOUS · DESHWALI is detected', amb.has('DESHWALI'));
ok('AMBIGUOUS · ARIF is NOT — only one party owns it', !amb.has('ARIF'));
ok('AMBIGUOUS · KIRTI is NOT', !amb.has('KIRTI'));

/* ══ THE BRAKE ═════════════════════════════════════════════════════ */
const NARR = 'RTGS-ICICR42026062100511668-AMAN ENTERPRISES';
{
  const wrong = R.nameMatch(NARR, 'AMAN LIME PRODUCTS', amb);
  ok('INCIDENT · the wrong party no longer scores certain', wrong.s < 0.6);
  eq('INCIDENT · and is flagged ambiguous', wrong.ambiguous, true);
  ok('INCIDENT · with a reason a human can act on', /cannot identify/.test(wrong.why || ''));
  /* the old behaviour, for contrast — no ambiguity set supplied */
  eq('INCIDENT · WITHOUT the brake it scored 1.00 (the bug)', R.nameMatch(NARR, 'AMAN LIME PRODUCTS').s, 1);
}
{
  const right = R.nameMatch(NARR, 'AMAN ENTERPRISES', amb);
  eq('CORRECT · the RIGHT party is still certain', right.s, 1);
  ok('CORRECT · and not flagged ambiguous', !right.ambiguous);
}
/* the own-firm trap: DESHWALI MINERALS is ours, DESHWALI LIME INDUSTRIES is a customer */
{
  const trap = R.nameMatch('NEFT-DESHWALI LIME INDUSTRIES', 'DESHWALI MINERALS', amb);
  ok('OWN-FIRM · a customer payment cannot be matched to our own firm by name', trap.s < 0.6);
  eq('OWN-FIRM · flagged', trap.ambiguous, true);
  const real = R.nameMatch('NEFT-DESHWALI LIME INDUSTRIES', 'DESHWALI LIME INDUSTRIES', amb);
  eq('OWN-FIRM · but the genuine customer still matches exactly', real.s, 1);
}
/* unambiguous parties are completely unaffected — no collateral damage */
['ARIF CHEMICAL LIME', 'KIRTI LIME PRODUCTS'].forEach(n => {
  eq('UNAFFECTED · ' + n + ' still matches at 1.00', R.nameMatch('NEFT-' + n, n, amb).s, 1);
});
/* an empty/absent ambiguity set preserves the old behaviour exactly */
eq('COMPAT · no ambiguity set = unchanged behaviour', R.nameMatch(NARR, 'AMAN LIME PRODUCTS', new Set()).s, 1);
eq('COMPAT · undefined too', R.nameMatch(NARR, 'AMAN LIME PRODUCTS', undefined).s, 1);
/* a party with no distinctive token at all must not become everyone's match */
eq('EDGE · a name that is ALL stopwords has an empty fingerprint', R.fingerprint('LIME PRODUCTS PVT LTD'), '');
ok('EDGE · and an empty fingerprint is never ambiguous', !amb.has(''));

/* ══ THE WIRING — the fix must not be inert ═════════════════════════
   A brake nobody pulls is not a brake. These assert reconcile.js actually
   builds the set and hands it to the matcher. Learned the hard way: QLX
   pagination shipped with 21 green tests and never executed once. */
{
  const fs = require('fs');
  const rj = fs.readFileSync(__dirname + '/reconcile.js', 'utf8');
  ok('WIRED · reconcile builds an ambiguity set', /function ambiguousParties\(\)/.test(rj));
  ok('WIRED · from the live party list', /Q\.state && Q\.state\.PARTIES/.test(rj));
  ok('WIRED · and passes it into the matcher opts', /ambiguous: ambiguousParties\(\)/.test(rj));
  ok('WIRED · cached, not rebuilt per transaction', /_ambCache/.test(rj));
  const rc = fs.readFileSync(__dirname + '/recon-core.js', 'utf8');
  ok('WIRED · scoreMatch forwards opts.ambiguous to nameMatch', /nameMatch\(np\.clean, name, opts\.ambiguous\)/.test(rc));
  ok('WIRED · and the cashbook-entry path too', /nameMatch\(np\.clean, entry\.party, opts\.ambiguous\)/.test(rc));
  ok('WIRED · an ambiguous hit is surfaced in the reasons a human reads', /reasons\.push\('Ambiguous: '/.test(rc));
}

console.log('\n════ recon ambiguity brake ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' AMBIGUITY TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);

