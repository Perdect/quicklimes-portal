/* osm-query.test.js — the browser's Overpass query is well-formed and safe.
 *
 * OSM discovery runs in the browser now; this pins the query it sends so the
 * area/around logic and the injection-safe escaping can't silently drift from
 * the server's builder.
 *
 *   node osm-query.test.js
 */
'use strict';
const Q = require('./osm-query.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ OSM query builder (browser-side) ═══\n');

/* ── area search (default) ── */
{
  const q = Q.build('steel', 'Jamshedpur', { max: 30 });
  ok(/\[out:json\]\[timeout:25\]/.test(q), 'declares JSON output + a 25s Overpass timeout');
  ok(/area\["name"~"\^Jamshedpur\$",i\]\["boundary"="administrative"\]/.test(q), 'looks up the city as an administrative area (anchored ^…$)');
  ok(/nwr\["name"~"steel",i\]\(area\.a\)/.test(q), 'searches nodes/ways/relations named like the trade, inside that area');
  ok(/out center 30;/.test(q), 'honours the max and asks for centre points');
  ok(!/around:/.test(q), 'no radius given → NOT an around-search');
}

/* ── around search (radius mode) ── */
{
  const q = Q.build('AAC', 'ignored', { center: { lat: 26.3, lon: 73.05 }, radiusKm: 100 });
  ok(/around:100000,26\.3,73\.05/.test(q), '100km → a 100000m circle on the centre point');
  ok(!/boundary="administrative"/.test(q), '  and NOT an area lookup');
  ok(/around:500000/.test(Q.build('x', 'y', { center: { lat: 1, lon: 1 }, radiusKm: 99999 })), 'radius clamped to 500km (never a planet-wide scan)');
  ok(/around:1000/.test(Q.build('x', 'y', { center: { lat: 1, lon: 1 }, radiusKm: 0 }) + Q.build('x', 'y', { center: { lat: 1, lon: 1 }, radiusKm: -5 })), 'radius floored to 1km');
}

/* ── injection safety: a quote in the search text must not break out ── */
{
  const q = Q.build('AAC" ; out count; //', 'City', {});
  ok(q.includes('\\"'), 'a double-quote in the trade text is escaped, not left to rewrite the query');
  ok(Q.build('a\\b', 'C', {}).includes('a\\\\b'), 'a backslash is escaped too');
  // the max is a NUMBER, never interpolated user text
  ok(/out center \d+;/.test(Q.build('x', 'y', { max: 40 })), 'the result cap is always numeric');
}

/* ── pure module ── */
{
  const src = require('fs').readFileSync(__dirname + '/osm-query.js', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  ok(!/document\.|fetch\(|localStorage/.test(src), 'the builder is pure — no DOM/network/storage (the fetch lives in discover.js)');
}

console.log(fail ? `\n❌ FAILED — Passed: ${pass} · Failed: ${fail}\n` : `\n✅ PASSED — Passed: ${pass} · Failed: ${fail}\n`);
process.exit(fail ? 1 : 0);
