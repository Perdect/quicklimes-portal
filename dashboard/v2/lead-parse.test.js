/* lead-parse.test.js — the smart-search parser turns sentences into filters,
 * and only ever reports what it actually found.
 *
 * It leans on the REAL ICPCore.INDUSTRIES so a recognised industry maps to a
 * real score — the test injects the same list the app does, not a stub.
 *
 *   node lead-parse.test.js
 */
'use strict';
const LP = require('./lead-parse.js');
const ICP = require('./icp-core.js');
const INDUSTRIES = ICP.INDUSTRIES;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (a, b, m) => ok(a === b, m + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
const P = t => LP.parse(t, INDUSTRIES);

console.log('\n═══ Lead Discovery · smart-search parser ═══\n');

/* ── the spec's own examples ── */
{
  const a = P('Find AAC Block Manufacturers in Bangalore');
  eq(a.place, 'Bangalore', 'example 1: city extracted');
  eq(a.businessType, 'manufacturer', 'example 1: business type extracted');
  eq(a.industry && a.industry.key, 'aac', 'example 1: industry resolves to the ICP key');
  eq(a.what, 'AAC', 'example 1: the OSM term is the tight trade word, not the label');
  eq(a.radiusKm, null, 'example 1: no radius mentioned → none invented');

  const b = P('Find Sugar Mills in Maharashtra');
  eq(b.place, 'Maharashtra', 'example 2: a state works as the area name too');
  eq(b.industry && b.industry.key, 'sugar', 'example 2: sugar');
  eq(b.what, 'sugar mill', 'example 2: OSM term');

  const c = P('Find Steel Plants in UAE');
  eq(c.place, 'UAE', 'example 3: an already-uppercase place is left alone (UAE, not Uae)');
  eq(c.industry && c.industry.key, 'steel', 'example 3: steel');
  // "Plants" is a factory-type word, not part of the trade term.
  eq(c.businessType, 'factory', 'example 3: "plants" read as factory type');

  const d = P('Find Paper Mills in Rajasthan');
  eq(d.place, 'Rajasthan', 'example 4: place');
  eq(d.industry && d.industry.key, 'paper', 'example 4: paper');
}

/* ── radius, in all its shapes ── */
{
  const a = P('Find AAC block makers within 100km of Jodhpur');
  eq(a.radiusKm, 100, 'radius: "within 100km of X" → 100');
  eq(a.place, 'Jodhpur', 'radius: the place after "of" is captured');
  eq(a.businessType, 'manufacturer', 'radius: "makers" → manufacturer');
  eq(a.industry && a.industry.key, 'aac', 'radius: industry still found after the radius clause is stripped');

  eq(P('cement dealers within 250 km of Jaipur').radiusKm, 250, 'radius: "250 km" with a space');
  eq(P('steel plants 50km radius Nagaur').radiusKm, 50, 'radius: "50km radius" trailing form');
  eq(P('sugar mills within 500 kilometres of Pune').radiusKm, 500, 'radius: "kilometres" spelled out');
  eq(P('paper mills within 9000km of Delhi').radiusKm, 500, 'radius: clamped to a sane max (500)');
  eq(P('AAC blocks in Bhopal').radiusKm, null, 'no radius phrase → null, never a default');
}

/* ── business types, specificity order ── */
{
  eq(P('cement distributors in Kota').businessType, 'distributor', 'distributor beats the generic trader');
  eq(P('lime traders in Kota').businessType, 'trader', 'trader');
  eq(P('chemical suppliers in Surat').businessType, 'supplier', 'supplier');
  eq(P('glass exporters in Kochi').businessType, 'exporter', 'exporter');
  eq(P('cement in Kota').businessType, null, 'no type word → null, not a guessed default');
}

/* ── honesty: nothing is invented ── */
{
  const a = P('');
  eq(a.what, '', 'empty in → empty what');
  eq(a.industry, null, 'empty in → no industry');
  eq(a.place, null, 'empty in → no place');

  const b = P('widgets in Faridabad');   // not a known industry
  eq(b.industry, null, 'an unknown trade resolves to NO industry (not a wrong guess)');
  eq(b.place, 'Faridabad', '  but the place is still found');
  eq(b.what, 'widgets', '  and the raw trade word is kept as the search term');

  // A recognised industry must map to a real ICP score, end to end.
  const c = P('Find AAC manufacturers in Jodhpur');
  const scored = ICP.scoreLead({ industry: c.industry.key, estTonnesPerMonth: null, distanceKm: null }, []);
  ok(scored && typeof scored.score === 'number', 'a parsed industry key is a REAL ICP key that scoreLead accepts');
}

/* ── the parser is pure: same input, same output, no globals ── */
{
  const x = JSON.stringify(P('AAC block manufacturers within 100km of Jodhpur'));
  const y = JSON.stringify(P('AAC block manufacturers within 100km of Jodhpur'));
  eq(x, y, 'deterministic — same sentence, same parse');
  // Pure: no DOM, no network in the logic. (`window` appears only in the UMD
  // export wrapper, same as icp-core.js — that is the boundary, not the body.)
  const body = require('fs').readFileSync(__dirname + '/lead-parse.js', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  ok(!/document\.|fetch\(|XMLHttpRequest|localStorage/.test(body), 'no DOM/network/storage in the parser (pure module)');
}

console.log(fail ? `\n❌ FAILED — Passed: ${pass} · Failed: ${fail}\n` : `\n✅ PASSED — Passed: ${pass} · Failed: ${fail}\n`);
process.exit(fail ? 1 : 0);
