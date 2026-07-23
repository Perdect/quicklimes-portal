/* lime-market.test.js — the market-intelligence brain ranks honestly.
 *
 * The one insight that makes this worth building: for a low-value/high-volume
 * commodity, a nearer strong market can beat a farther top-demand market. If
 * that ever stops being true, the engine is just a demand list and the ranking
 * is lying about profitability. Pinned here, hard.
 *
 *   node lime-market.test.js
 */
'use strict';
const LM = require('./lime-market.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (a, b, m) => ok(a === b, m + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
const S = n => LM.STATES.find(s => s.name === n);

console.log('\n═══ Lime market intelligence · demand × freight ═══\n');

/* ── distance & freight model ── */
{
  const guj = LM.roadKm(LM.DEFAULT_ORIGIN, S('Gujarat'));
  const odi = LM.roadKm(LM.DEFAULT_ORIGIN, S('Odisha'));
  const tn = LM.roadKm(LM.DEFAULT_ORIGIN, S('Tamil Nadu'));
  ok(guj < odi && odi < tn, 'road distance grows Gujarat < Odisha < Tamil Nadu (geography sane)');
  ok(guj > 100 && guj < 800, 'Gujarat is a near market (' + guj + ' km)');
  ok(tn > 1400, 'Tamil Nadu is a very-far market (' + tn + ' km)');
  eq(LM.transportTier(300).tier, 'near', 'tier: 300km = near');
  eq(LM.transportTier(700).tier, 'regional', 'tier: 700km = regional');
  eq(LM.transportTier(1200).tier, 'far', 'tier: 1200km = far');
  eq(LM.transportTier(1700).tier, 'veryfar', 'tier: 1700km = very far');
  ok(LM.feasibility(200) > LM.feasibility(1500), 'feasibility falls with distance');
  ok(LM.feasibility(3000) >= 0.05, 'feasibility never goes to zero (a floor, so nothing is impossible)');
}

/* ── the core insight: freight can outrank raw demand ── */
{
  // Odisha is a 5-star steel/aluminium state (huge lime demand) but ~1,400km.
  // Gujarat is a 5-star chemical/paper/water state and far nearer. For a
  // Rajasthan seller, Gujarat must rank above Odisha despite equal demand stars.
  const p = LM.plan('quick');
  const gujRank = p.findIndex(r => r.state === 'Gujarat');
  const odiRank = p.findIndex(r => r.state === 'Odisha');
  ok(gujRank >= 0 && odiRank >= 0, 'both states are in the plan');
  ok(gujRank < odiRank, 'a near 5-star market (Gujarat) outranks an equal-demand far one (Odisha) — freight counted');

  const guj = LM.stateOpportunity(S('Gujarat'), 'quick');
  const odi = LM.stateOpportunity(S('Odisha'), 'quick');
  ok(odi.demand >= guj.demand - 5, 'Odisha demand is not lower than Gujarat (so ranking is NOT just demand)');
  ok(guj.score > odi.score, '  yet Gujarat scores higher — because reachability is in the score');
  ok(odi.freightPerTonne > guj.freightPerTonne, '  and Odisha freight/tonne is higher (the reason)');
}

/* ── plan is sorted, and filtered to relevant states ── */
{
  const p = LM.plan('quick');
  let sorted = true; for (let i = 1; i < p.length; i++) if (p[i].score > p[i - 1].score) sorted = false;
  ok(sorted, 'plan() is ranked best-opportunity first');
  ok(p.every(r => r.industries.length > 0), 'every ranked state has at least one relevant industry');
}

/* ── product relevance really differs ── */
{
  const quick = LM.industriesForProduct('quick').map(i => i.key);
  const hyd = LM.industriesForProduct('hydrated').map(i => i.key);
  ok(quick.includes('steel'), 'Quick Lime targets steel');
  ok(!hyd.includes('steel'), '  Hydrated Lime does not (steel is a quick-lime buyer)');
  ok(hyd.includes('water') && hyd.includes('etp'), 'Hydrated Lime targets water & effluent treatment');
  ok(LM.industriesForProduct('quick')[0].demand >= LM.industriesForProduct('quick')[1].demand, 'industries come back demand-ranked');
}

/* ── origin & freight rate are parameters, not baked in ── */
{
  const fromRaj = LM.stateOpportunity(S('Odisha'), 'quick', { origin: LM.DEFAULT_ORIGIN });
  const fromKol = LM.stateOpportunity(S('Odisha'), 'quick', { origin: { lat: 22.57, lon: 88.36 } }); // Kolkata, next door to Odisha
  ok(fromKol.km < fromRaj.km, 'moving the origin changes distances (origin is a real parameter)');
  ok(fromKol.score > fromRaj.score, '  Odisha is a better opportunity from a nearer origin');

  const cheap = LM.stateOpportunity(S('Odisha'), 'quick', { freightRate: 2 });
  const dear = LM.stateOpportunity(S('Odisha'), 'quick', { freightRate: 8 });
  ok(dear.freightPerTonne > cheap.freightPerTonne, 'the freight rate is applied (₹8 costs more than ₹2)');
}

/* ── honesty: cement is not sold a false story, and nothing is a per-company fact ── */
{
  ok(!LM.industriesForProduct('quick').some(i => i.key === 'cement'), 'cement (rarely a buyer) is excluded, not padded in to look bigger');
  const src = require('fs').readFileSync(__dirname + '/lime-market.js', 'utf8');
  ok(/est\.|est\b|estimate/i.test(src) && LM.INDUSTRIES.every(i => /est|Low|Medium|High|rare/i.test(i.consumption)),
    'every consumption figure is an ESTIMATE band, never a fake precise number');
  ok(LM.INDUSTRIES.every(i => Array.isArray(i.roles) && i.roles.every(r => typeof r === 'string')),
    'decision-makers are ROLES (titles to ask for), never invented person names');
  ok(!/fetch\(|document\.|localStorage/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')), 'pure engine — no network/DOM/storage');
}

console.log(fail ? `\n❌ FAILED — Passed: ${pass} · Failed: ${fail}\n` : `\n✅ PASSED — Passed: ${pass} · Failed: ${fail}\n`);
process.exit(fail ? 1 : 0);
