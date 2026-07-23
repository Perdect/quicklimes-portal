/* discover-wired.test.js — Lead Discovery is actually reachable and honest.
 *
 * The backend logic is proven in api/discover.test.php (40 checks). This pins
 * the CLIENT half against the dominant bug class here — built but never
 * connected — plus the one behaviour that decides whether the feature is
 * trustworthy: a failed search must be SHOWN, never rendered as an empty market.
 *
 *   node discover-wired.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ Lead Discovery · wired, and honest about failure ═══\n');

const js = R('discover.js'), html = R('discover.html'), shell = R('shell.js');
const bare = js.replace(/\/\*[\s\S]*?\*\//g, ' ');

/* ── reachable from the app ── */
{
  ok(/id: 'discover'/.test(shell) && /discover\.html/.test(shell), 'the sidebar has a Lead Discovery entry');
  ok(/QLShell\.mount\(\{ active: 'discover'/.test(bare), 'the page mounts as the "discover" nav item (so it highlights)');
}

/* ── the four server actions are all driven ── */
{
  ['search', 'list', 'promote', 'dismiss'].forEach(a =>
    ok(new RegExp("action: '" + a + "'").test(bare), 'the page calls the "' + a + '" action'));
  ok(/fetch\('\/api\/discover'/.test(bare), 'it posts to /api/discover (the .htaccess rewrite serves discover.php)');
  ok(/token: p\.token/.test(bare), '  authenticated with the session token');
}

/* ── scoring is the REAL engine, not a decorative number ── */
{
  ok(/IC2\.scoreLead/.test(bare), 'FIT comes from ICPCore.scoreLead');
  ok(/icpByIndustry/.test(bare), '  against an ICP rebuilt from your own sales');
  ok(/LI\.resolveIndustry/.test(bare), '  and the industry is resolved, never invented');
  ok(/sort\(\(a, b\) => \(b\.f\.score - a\.f\.score\)/.test(bare), '  the table is ordered best-fit first');
}

/* ── THE promise: a failed search is never an empty market ── */
{
  const i = bare.indexOf('async function runSearch');
  const block = i > 0 ? bare.slice(i, bare.indexOf('async function load', i)) : '';
  ok(i > 0, 'runSearch exists');
  ok(/if \(!okAny\)/.test(block), '  it branches on failure (no hub succeeded)');
  ok(/notice\(/.test(block) && /warn|true/.test(block), '  and SHOWS the failure as a notice');
  ok(/ok: false/.test(block), '  the recent-search chip records it as failed');
  ok(/not_configured/.test(block), '  a missing key gets its own explicit message');
  // The failure branch must return BEFORE anything that reads as success.
  const failIdx = block.indexOf('if (!okAny)'), okIdx = block.indexOf("RECENT.unshift({ label: tag, ok: true");
  ok(failIdx > 0 && okIdx > failIdx, '  and it returns before the success path can run');
}

/* ── a no-key user still has a way through ── */
{
  ok(/Paste \/ import/.test(html), 'the page offers the no-key path (paste / import a list)');
  ok(/dcImport/.test(bare) && /crm\.html/.test(bare), '  wired to the ranked importer');
}

/* ── the half-wired trap: the page must load what it uses ── */
{
  ['icp-core.js', 'lead-import.js', 'lead-parse.js', 'lime-market.js', 'osm-query.js', 'data.js', 'shell.js', 'discover.js'].forEach(f =>
    ok(new RegExp('src="\\./?' + f.replace('.', '\\.')).test(html), 'discover.html loads ' + f));
  ok(html.indexOf('icp-core.js') < html.indexOf('discover.js'), '  icp-core loads before discover.js uses it');
  ok(html.indexOf('lead-import.js') < html.indexOf('discover.js'), '  lead-import too');
  ok(html.indexOf('lead-parse.js') < html.indexOf('discover.js'), '  lead-parse (the AI bar brain) before discover.js');
}

/* ── Phase 1: the AI search bar → structured filters, wired end to end ── */
{
  // The controls exist in the page…
  ['dcAi', 'dcIndSel', 'dcBiz', 'dcCity', 'dcRadius', 'dcUnderstood'].forEach(id =>
    ok(new RegExp('id="' + id + '"').test(html), '  the page has #' + id));
  // …and discover.js actually drives them (not a decorative bar).
  ok(/LP\s*=\s*window\.LeadParse/.test(bare), 'discover.js binds the LeadParse parser');
  ok(/function applyParse\(/.test(bare) && /LP\.parse\(/.test(bare), '  applyParse() runs the parser on the bar text');
  ok(/function buildFilters\(/.test(bare) && /buildFilters\(\)/.test(bare), '  the industry/type/radius dropdowns are populated at init (not empty)');
  ok(/data-icp=/.test(bare), '  each industry option carries its ICP key, so a pick maps to a real score');
  // runSearch must READ the structured filters and SEND the radius — the new capability.
  const i = bare.indexOf('async function runSearch');
  const rs = i > 0 ? bare.slice(i, bare.indexOf('async function loadSources', i)) : '';
  ok(/getElementById\('dcIndSel'\)/.test(rs), '  runSearch reads the industry dropdown');
  ok(/getElementById\('dcRadius'\)/.test(rs), '  and the radius dropdown');
  ok(/discoverOne\(what, targets\[i\], radius/.test(rs), '  and passes what/city/radius into each discovery');
  // Re-parse only when the bar changed, so dropdown edits are not clobbered.
  ok(/bar !== LAST_PARSED/.test(rs), '  the bar is re-parsed only when it changed (edits to dropdowns survive)');
  // Voice is offered only when the browser supports it (never a dead button).
  ok(/SpeechRecognition/.test(bare) && /mic\.hidden = false/.test(bare), '  voice search reveals itself only where supported');
}

/* ── Market Intelligence panel: the brain is on the page and drives discovery ── */
{
  ok(/id="miCard"/.test(html) && /id="miStates"/.test(html) && /id="miInds"/.test(html), 'the page has the Market Intelligence panel');
  ok(/LM\s*=\s*window\.LimeMarket/.test(bare), 'discover.js binds the LimeMarket engine');
  ok(/function buildMarketPanel\(/.test(bare) && /buildMarketPanel\(\)/.test(bare), '  the panel is built at init (not dead markup)');
  ok(/LM\.plan\(/.test(bare), '  it renders the ranked national plan (LM.plan)');
  ok(/function findInMarket\(/.test(bare) && /runSearch\(\)/.test(bare), '  and a market row can launch real discovery (findInMarket → runSearch)');
  ok(/data-find/.test(bare) && /data-state/.test(bare), '  each (industry × state) is a launchable target');
  // The whole point of this request: NOT limited to Rajasthan.
  ok(/dcCity'\)\.value = state/.test(bare), '  findInMarket searches the TARGET STATE, not the home city');
  // The "Try:" suggestions must come from the market brain and aim nationally —
  // the old hardcoded Jodhpur/Jaipur/Nagaur list is what this feature replaces.
  ok(/function marketSuggestions\(/.test(bare) && /LM\.plan\(/.test(bare.slice(bare.indexOf('function marketSuggestions'))), 'the "Try:" chips are derived from the market plan');
  ok(/state !== 'Rajasthan'/.test(bare), '  and skip the home state (the point is to look beyond Rajasthan)');
  ok(!/\['[^']*', 'Jodhpur'\]/.test(bare) && !/, 'Nagaur'\]/.test(bare), '  no hardcoded local-only Rajasthan suggestions remain');
  ok(!/within 100km of Jodhpur/.test(html), '  the search placeholder no longer pushes a local Jodhpur example');
}

/* ── OSM is fetched by the BROWSER, then ingested (server curl was too slow) ── */
{
  ok(/OSMQ\s*=\s*window\.OSMQuery/.test(bare), 'discover.js binds the OSM query builder');
  ok(/async function osmClientFetch\(/.test(bare) && /OVERPASS_EPS/.test(bare), '  it fetches Overpass from the browser (residential IP, no PHP 30s cap)');
  ok(/action: 'ingest'/.test(bare), '  and posts the raw elements to the server to store');
  ok(/function discoverOne\(/.test(bare), '  one path per (industry × city)');
  // Google still goes server-side (its key must never reach the browser).
  const doFn = bare.slice(bare.indexOf('async function discoverOne'), bare.indexOf('async function runSearch'));
  ok(/SRC === 'osm'/.test(doFn) && /action: 'ingest'/.test(doFn), '  OSM → browser-fetch + ingest');
  ok(/source: SRC/.test(doFn), '  non-OSM (Google) → still the server search action');
  ok(!/GOOGLE_PLACES_KEY/.test(js), '  the Google key is never named client-side');
  // The server must accept the ingested results.
  const php = R('../api/discover.php');
  ok(/\$action === 'ingest'/.test(php) && /ql_osm_parse/.test(php), 'discover.php has an ingest action that parses the posted elements');
  ok(/function ql_discover_store/.test(php), '  store/classify/dedupe is shared by search and ingest (one judgment)');
}

/* ── a STATE target fans out across hub cities (whole-state times out) ── */
{
  const i = bare.indexOf('async function runSearch');
  const rs = i > 0 ? bare.slice(i, bare.indexOf('async function loadSources', i)) : '';
  ok(/LM\.stateByName\(city\)/.test(rs), 'runSearch detects when the target is a whole state');
  ok(/LM\.hubsFor\(/.test(rs), '  and expands it to industrial hub cities');
  ok(/for \(let i = 0; i < targets\.length/.test(rs), '  searching each target (a loop, not one whole-state query)');
  ok(/discoverOne\(what, targets\[i\]/.test(rs), '  each request goes to a hub CITY, not the state');
  ok(/added \+= r\.added/.test(rs), '  results are aggregated across the hubs');
}

/* ── radius is honest when it cannot be applied ── */
{
  const i = bare.indexOf('async function runSearch');
  const rs = i > 0 ? bare.slice(i, bare.indexOf('async function loadSources', i)) : '';
  ok(/radius_fell_back/.test(rs), 'a radius that could not be geocoded is reported (not silently dropped)');
}

/* ── the key never reaches the browser ── */
{
  ok(!/GOOGLE_PLACES_KEY/.test(js), 'discover.js never names the API key');
  ok(!/places\.googleapis\.com/.test(js), '  and never calls Google directly — only our own server does');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
