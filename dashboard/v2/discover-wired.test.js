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
  /* The hero (greeting + stat pills + Run discovery / Ask AI / Review leads /
     Paste-import) was REMOVED at the user's request — it pushed the search and
     the leads below the fold. The import path still exists inside the Pipeline
     tab, so the no-key route is not lost. */
  ok(/plImport/.test(bare) && /crm\.html|dcImport/.test(bare), 'the no-key import path is still reachable (pipeline tab)');
}

/* ── the half-wired trap: the page must load what it uses ── */
{
  ['icp-core.js', 'lead-import.js', 'lead-parse.js', 'lime-market.js', 'osm-query.js', 'lead-actions.js', 'data.js', 'shell.js', 'discover.js'].forEach(f =>
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

/* ── Phase 1: AI-first compact layout (hero · sections · copilot) ── */
{
  ok(!/id="dcHero"/.test(html) && !/dc-hero-actions/.test(html), 'the hero block is gone (removed on request) — search leads the page');
  ok(html.split('<div class="dash"').length === 2 && (html.slice(html.indexOf('<div id="ql-page">'), html.indexOf('<script src=')).split('<div').length === html.slice(html.indexOf('<div id="ql-page">'), html.indexOf('<script src=')).split('</div>').length), '  and the markup is still balanced (no stray </div> closing .dash early)');
  ok(/id="dcSecTabs"/.test(html) && /data-sec="copilot"/.test(html) && /data-sec="markets"/.test(html) && /data-sec="leads"/.test(html), 'three progressive-disclosure sections (Copilot / Markets / Leads)');
  ok(/id="secMarkets" hidden/.test(html) && /id="secLeads" hidden/.test(html), '  Markets & Leads start hidden — one section visible at a time');
  ok(/id="dcFilters" hidden/.test(html) && /dc-row\[hidden\] \{ display: none/.test(html), '  advanced filters collapse by default (and the [hidden] grid rule is restored)');
  ok(/function renderHero\(/.test(bare) && /function switchSection\(/.test(bare) && /function renderCopilot\(/.test(bare), 'discover.js has the hero / copilot / section-switch logic');
  // Honesty: real counts, labelled estimates, NO fabricated confidence %.
  const rh = bare.slice(bare.indexOf('function renderHero'), bare.indexOf('function renderCopilot'));
  ok(/COUNTS\.new/.test(rh) && /COUNTS\.promoted/.test(rh), '  hero stats are REAL pipeline counts');
  ok(/est\.|estimate/i.test(rh), '  and the market figure is labelled an estimate');
  ok(!/confidence/i.test(bare) || /never a fabricated confidence/i.test(bare), '  no fabricated AI-confidence score is invented');
  // A search jumps to the Leads section so results are seen.
  const rs2 = bare.slice(bare.indexOf('async function runSearch'), bare.indexOf('async function loadSources'));
  ok(/switchSection\('leads'\)/.test(rs2), '  running a search lands the user on the Leads section');
}

/* ── Phase 2: India demand map — REAL interactive Leaflet map, click-to-discover ── */
{
  ok(/id="dcMap"/.test(html) && /India demand map/.test(html), 'the Markets section has an India demand map');
  ok(/function renderHeatMap\(/.test(bare), 'discover.js renders the map');
  const hm = bare.slice(bare.indexOf('function renderHeatMap'), bare.indexOf('function switchSection'));
  ok(/LM\.plan\(/.test(hm) && /LM\.STATES/.test(hm), '  states are shaded from the market plan + real centroids');
  ok(/findInMarket\(/.test(hm), '  clicking a state runs discovery there');
  // Now a real interactive map: Leaflet + tiles, demand states as polygons from INDIA_GEO.
  ok(/L\.map\(|L\.tileLayer\(|L\.polygon\(/.test(hm), '  built on Leaflet (interactive pan/zoom map, not a static SVG)');
  ok(/INDIA_GEO/.test(hm), '  demand states drawn from the real India geometry (INDIA_GEO)');
  ok(/leaflet@1\.9\.4\/dist\/leaflet\.js/.test(html) && /leaflet@1\.9\.4\/dist\/leaflet\.css/.test(html), '  the page loads Leaflet (css + js)');
  ok(/india-geo\.js/.test(html), '  the page loads the India geometry data file');
  ok(/invalidateSize\(/.test(hm), '  fixes Leaflet size when its section becomes visible');
  ok(/renderHeatMap\(\)/.test(bare.slice(bare.indexOf('function renderMarket'))), '  it re-renders when product/freight/price change');
}

/* ── Phase 3: lead cards + Company 360° drawer ── */
{
  /* v4: contact-first SALES ROWS, not freight cards. A lead row exists so a
     salesperson can call the company — freight belongs in the Freight tab. */
  ok(/lc-list/.test(bare) && /class="lr"/.test(bare) && /data-open=/.test(bare), 'results render as clickable sales rows');
  /* `bare` already has comments stripped, so this checks CODE — a comment that
     merely explains the removal must not fail the test. */
  const pt = bare.slice(bare.indexOf('function paintTable'));
  const ptBody = pt.slice(0, pt.indexOf('\n}\n'));
  ok(!/leadEconomics/.test(ptBody), '  no freight/distance computed for the row');
  ok(!/freight/i.test(ptBody), '  no freight text rendered on the row');
  ok(/href="tel:/.test(bare) && /mailto:/.test(bare) && /google\.com\/maps\/search/.test(bare), '  phone dials, email composes, Maps opens navigation');
  ok(/lr-addr/.test(bare) && /r\.address/.test(bare), '  the FULL Google address is shown, not a truncated city');
  ok(/lr-rate/.test(bare) && /r\.rating/.test(bare), '  the Google rating is shown');
  ok(/data-promote=/.test(bare) && /data-assess=/.test(bare) && /data-msg=/.test(bare), '  Promote / Assess / Message stay wired');
  ok(/function leadEconomics\(/.test(bare) && /r\.lat == null \|\| r\.lng == null/.test(bare), 'per-lead freight is computed ONLY when the lead has coordinates (never invented)');
  ok(/function openLeadDrawer\(/.test(bare) && /id="lcDrawer"/.test(html), 'a Company 360° side-drawer exists');
  const od = bare.slice(bare.indexOf('function openLeadDrawer'), bare.indexOf('function closeLeadDrawer') > 0 ? bare.length : bare.length);
  ok(/Delivery economics/.test(bare) && /Lime playbook/.test(bare) && /Fit for your lime/.test(bare), '  drawer shows fit, delivery economics, and the lime playbook');
  ok(/Not on file/.test(bare) && /paid data provider/.test(bare), '  and is HONEST about the firmographics it does not have (no fabrication)');
  ok(/function closeLeadDrawer\(/.test(bare) && /Escape/.test(bare), '  the drawer closes (X / backdrop / Escape)');
  ok(/openAssess\(r\)/.test(bare) && /openMessage\(r\)/.test(bare) && /WA\.waLink/.test(bare), '  drawer actions reuse Assess / Message / WhatsApp');
}

/* ── Assess + Message: the lead-working actions (local, key-free) ── */
{
  ok(/LA\s*=\s*window\.LeadActions/.test(bare), 'discover.js binds LeadActions');
  ok(/data-assess=/.test(bare) && /data-msg=/.test(bare), 'each candidate row offers Assess and Message');
  ok(/function openAssess\(/.test(bare) && /LA\.assess\(/.test(bare), 'Assess opens a briefing from LA.assess (local rules)');
  ok(/function openMessage\(r\) \{ openStudio/.test(bare), 'Message opens the Outreach Studio composer');
  // We never auto-send — the Studio opens WhatsApp/email for the user to send,
  // and the WhatsApp recipient goes through wa-core (never a hand-rolled wa.me).
  ok(/WA\.waLink\(/.test(bare) && /mailto:/.test(bare), '  it hands off to WhatsApp (via wa-core) / email; the user sends');
  ok(/normalizePhone\(/.test(bare), '  a landline/junk number is not treated as a WhatsApp target');
  ok(/waLink\(r\.phone \|\| ''/.test(bare), '  the Studio still routes WhatsApp through wa-core even with no phone on file');
  ok(/Anthropic key/i.test(bare) && /local rules/i.test(bare), '  Assess says it is the local fallback, upgradable to live Claude');

  // Live path (Assess): try the server AI first, fall back to LA.* when it isn't ok.
  ok(/action: 'assess'/.test(bare), 'Assess tries the live server AI first (Message uses smart templates)');
  ok(/resp && resp\.ok && resp\.data/.test(bare), '  and use the live result only when the server says ok');
  const oa = bare.slice(bare.indexOf('async function openAssess'), bare.indexOf('function openStudio'));
  ok(/resp\.ok/.test(oa) && /LA\.assess\(/.test(oa) && oa.indexOf('resp.ok') < oa.indexOf('LA.assess('), '  live is tried BEFORE the local fallback (never instead of it)');
  ok(/leadPayload\(/.test(bare) && !/price|gstin|revenue/.test(bare.match(/function leadPayload[^}]+}/)[0]), '  only real lead fields are sent to the AI (no invented data)');

  // Server: the AI door is key-gated, falls back cleanly, and names no provider.
  /* upsertLead's UPDATE rewrites every column it picks, so a partial payload
     is a silent delete — a stage move that omits score/next_action wipes them.
     Every call must therefore layer the change onto the lead we already hold. */
  /* ── the message engine: real LLM first, template as fallback ──
     /api/discover has had an LLM writer behind action:'message' since it was
     built, with NOTHING calling it — so every draft came from the local
     template and the refine chips only swapped words. */
  ok(/action: 'message'/.test(bare), "the LLM message writer has a caller (action:'message')");
  ok(/refine: refine/.test(bare) || /refine: refine \|\| ''/.test(bare), '  the refine chips go through it too');
  ok(/type, channel: ch/.test(bare), '  and it is told which message type and channel to write');
  ok(/function localDraft\(/.test(bare) && /LA\.refine\(before/.test(bare),
    '  the local template still runs when the server cannot answer');

  /* Honesty: a template must never be presented as AI. The user is showing
     this to customers; "AI-personalised" over template text is a small lie
     that costs trust. */
  {
    const i = bare.indexOf('async function serverDraft');
    const blk = i > 0 ? bare.slice(i, bare.indexOf('async function regen', i)) : '';
    ok(blk.length > 100, '  (the server-draft path is where it should be)');
    ok(/setEngine\('Written by AI/.test(blk), '  it claims AI only on a successful model reply');
    ok(/llm_not_configured/.test(blk) && /Smart template/.test(blk),
      '  and says "smart template" plainly when there is no key or the model fails');
    const claims = blk.split('\n').filter(l => /Written by AI/.test(l));
    ok(claims.length === 1 && /resp\.model \|\| resp\.provider/.test(claims[0]),
      '  the AI label is emitted once, next to the model that produced it');
  }

  /* CRMCore.nextActions() shipped with no caller — a "follow-ups due" count you
     could not act on. Pin the caller AND the way to set a next step, or this
     silently reverts to a decorative number. */
  ok(/CC\.nextActions\(/.test(bare), 'the follow-up engine has a caller (nextActions)');
  ok(/pd-due-i/.test(bare) && /data-due=/.test(bare), '  overdue leads render as a clickable call list');
  ok(/plNextSave/.test(bare) && /next_action_at:/.test(bare), '  and a next step can actually be set from the lead panel');

  ok(/function leadPatch\(/.test(bare), 'stage moves send the whole lead, not a partial patch (leadPatch)');
  {
    const calls = bare.match(/action: 'upsertLead', lead: [^}]*\}/g) || [];
    const partial = calls.filter(c => !/leadPatch\(/.test(c) && !/id: 0/.test(c));
    ok(partial.length === 0, '  no upsertLead call builds a partial lead literal'
      + (partial.length ? ' — found: ' + partial[0].slice(0, 90) : ''));
  }

  const php = R('../api/discover.php');
  ok(/\$action === 'assess' \|\| \$action === 'message'/.test(php), 'discover.php has the assess/message actions');
  ok(/ql_llm\(\)/.test(php) && /'fallback' => true/.test(php) && /llm_not_configured/.test(php), '  no key → { fallback:true } so the client uses local rules');
  ok(/ql_llm_extract\(/.test(php), '  the model call goes through llm.php (the one door)');
  ok(!/anthropic\.com/.test(php) && !/googleapis\.com/.test(php), '  discover.php names NO provider URL (llm.php owns that; the key never leaks)');
  ok(/NEVER invent|never invent/i.test(php), '  the prompt forbids inventing contacts/prices');
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

/* ── Outreach Studio composer ── */
{
  ok(/function openStudio\(/.test(bare), 'discover.js has the Outreach Studio composer');
  ok(/LA\.compose\(/.test(bare) && /LA\.refine\(/.test(bare), '  it composes + refines via lead-actions (tested pure engine)');
  ok(/data-ch="email"/.test(bare) && /data-ch="whatsapp"/.test(bare), '  Email + WhatsApp channels');
  ok(/'intro'.*'followup'.*'proposal'.*'meeting'/.test(bare.replace(/\n/g, ' ')) || (/intro/.test(bare) && /followup/.test(bare) && /proposal/.test(bare) && /meeting/.test(bare)), '  Intro/Follow-up/Proposal/Meeting types');
  ok(/'improve'.*'shorten'.*'personalize'.*'professional'/.test(bare.replace(/\n/g, ' ')) || (/improve/.test(bare) && /shorten/.test(bare) && /professional/.test(bare)), '  Improve/Shorten/Personalize/Professional refiners');
  ok(/os-back/.test(html) && /os-modal/.test(html), '  the Outreach Studio modal is styled');
  ok(/WA\.waLink\(/.test(bare), '  WhatsApp send goes through wa-core (owns the recipient)');
  ok(/function openMessage\(r\) \{ openStudio\(r\)/.test(bare), '  the Message action opens the Studio');
}

/* ── Proposal generator (branded, print/PDF) ── */
{
  ok(/function openProposal\(/.test(bare), 'discover.js has the proposal generator');
  ok(/Lime Supply Proposal/.test(bare), '  it is a Gotan-Lime supply proposal (not a stray brand)');
  ok(/LM\.roadKm\(/.test(bare.slice(bare.indexOf('function openProposal'))) && /DEFAULT_FREIGHT/.test(bare), '  delivered price comes from the real freight engine (road-km × rate)');
  ok(/on address confirmation/.test(bare), '  and stays honest when there are no coordinates (no invented freight)');
  ok(/window\.print\(\)/.test(bare) && /@media print/.test(html) && /pr-doc/.test(html), '  Print/Save PDF prints just the branded document');
  ok(/cdProposal/.test(bare) && /plProposal/.test(bare), '  reachable from the Company 360 drawer + the pipeline lead panel');
}

/* ── No-login onboarding portal ── */
{
  ok(/function openOnboardLink\(/.test(bare), 'discover.js generates a no-login onboarding link');
  ok(/\/api\/onboard/.test(bare) && /action: 'create'/.test(bare), '  via /api/onboard create');
  ok(/cdOnboard/.test(bare) && /plOnboard/.test(bare), '  reachable from the drawer + pipeline lead panel');
  const ob = R('../api/onboard.php');
  ok(/action === 'create'/.test(ob) && /action === 'get'/.test(ob) && /action === 'submit'/.test(ob), 'onboard.php has create (owner) + get/submit (public)');
  ok(/random_bytes\(24\)/.test(ob), '  the token is high-entropy (unguessable)');
  ok(/ql_token_ctx/.test(ob), '  owner actions (create/list/view/doc) require a session');
  ok(/ALLOW_EXT|ALLOW_MIME/.test(ob) && /is_uploaded_file\(/.test(ob) && /finfo/.test(ob), '  uploads are extension+MIME allow-listed');
  ok(/base64_encode\(/.test(ob) && !/move_uploaded_file/.test(ob), '  documents are stored base64 in the DB (deploy-safe, no filesystem/traversal risk)');
  ok(!/\$_(GET|POST|REQUEST)\[[^\]]+\]\s*\)?\s*;?\s*\$db->(query|exec)\(/.test(ob), '  no raw request value concatenated into SQL');
  const oh = R('onboard.html');
  ok(/action.*get|append\('action','get'\)/.test(oh) && /docs\[\]/.test(oh), 'onboard.html (public page) submits fields + documents');
  ok(/no-login|no login/i.test(oh), '  and tells the buyer it is a no-login form');
}

/* ── Mapbox source (free-tier alternative to OSM) ── */
{
  ok(/mapbox: false/.test(bare) && /SOURCES\.mapbox/.test(bare), 'discover.js knows the Mapbox source');
  ok(/'mapbox', 'Mapbox'/.test(bare), '  and offers it in the source toggle');
  const dp = R('../api/discover.php');
  ok(/ql_mapbox_search\(/.test(dp) && /'mapbox'/.test(dp), 'discover.php dispatches the mapbox source');
  ok(/ql_effective_mapbox_token\(/.test(dp) && /'mapbox' =>/.test(dp), '  reports mapbox availability (config OR the DB-stored per-plant token)');
  ok(/action === 'save_mapbox'/.test(dp) && /app_data/.test(dp) && /pk\\\.\[A-Za-z0-9/.test(dp), '  owner can save a Mapbox token IN THE APP (validated pk., stored in app_data)');
  ok(/function connectMapbox\(/.test(bare) && /'save_mapbox'/.test(bare), '  discover.js has the self-serve Mapbox connect flow');
  // REGRESSION GUARD: api() injects the session under `token`; the Mapbox token
  // must ride a DIFFERENT field or it overwrites the session → Unauthorized.
  ok(/save_mapbox', mapbox_token:/.test(bare) && !/save_mapbox', token/.test(bare), '  the Mapbox token is sent as mapbox_token (never `token`, which is the session)');
  ok(/\$b\['mapbox_token'\]/.test(dp), '  and discover.php reads mapbox_token');
  const db = R('../api/db.php');
  ok(/function ql_mapbox_search\(/.test(db) && /function ql_mapbox_parse\(/.test(db), 'db.php has ql_mapbox_search + parse');
  ok(/MAPBOX_TOKEN/.test(db) && /ql_norm_name\(/.test(db.slice(db.indexOf('function ql_mapbox_parse'))), '  token stays server-side; parse uses the shared name-key (same dedupe spine)');
  ok(/searchbox\/v1\/forward/.test(db) && /country=in/.test(db), '  calls the Mapbox Search Box API, scoped to India');
}

/* ── Google self-serve connect (same pattern as Mapbox) ── */
{
  ok(/function connectGoogle\(/.test(bare) && /'save_google'/.test(bare), 'discover.js has the self-serve Google connect flow');
  ok(/save_google', google_key:/.test(bare) && !/save_google', token/.test(bare), '  the key rides `google_key`, never `token` (which is the session)');
  const dp2 = R('../api/discover.php');
  ok(/action === 'save_google'/.test(dp2) && /AIza/.test(dp2), '  discover.php validates + stores an AIza key');
  ok(/ql_effective_google_key\(/.test(dp2), '  search + sources use config OR the DB-stored key');
  /* Saving one provider must never wipe the other out of the shared row. */
  ok(/ql_plant_google_key\(\$db, \$plantId\)[\s\S]{0,200}mapbox_token/.test(dp2) || /'google_key' => ql_plant_google_key/.test(dp2), '  saving Mapbox preserves the Google key (shared row)');
}

/* ── the empty/seen notice must tell the TRUTH (2026-07-28 regression) ── */
{
  ok(!/No matches in OpenStreetMap for/.test(bare) || /srcName/.test(bare), 'the empty notice names the source that ACTUALLY ran (not hardcoded OpenStreetMap)');
  ok(/SRC === 'mapbox' \? 'Mapbox'/.test(bare) && /'Google Maps'/.test(bare), '  Mapbox / Google / OSM each named correctly');
  ok(/added === 0 && dupes === 0 && seen > 0/.test(bare), '  results that are ALL already-known are reported as found, never as "no matches"');
  ok(/already in your list/.test(bare), '  and the user is told where they are');
}

/* ── the key never reaches the browser ── */
{
  ok(!/GOOGLE_PLACES_KEY/.test(js), 'discover.js never names the API key');
  ok(!/places\.googleapis\.com/.test(js), '  and never calls Google directly — only our own server does');
}

/* ── Freight + Pipeline folded in as tabs (no separate pages) ── */
{
  ok(/data-sec="freight"/.test(html) && /data-sec="pipeline"/.test(html), 'Lead Discovery has Freight + Pipeline section tabs');
  ok(/id="secFreight"/.test(html) && /id="secPipeline"/.test(html), '  and their section containers');
  ok(/id="frPlants"/.test(html) && /id="frProduct"/.test(html), '  the Freight tab embeds the calculator markup');
  ok(/freight-core\.js/.test(html) && /freight\.js/.test(html), '  loads the freight engine + UI');
  ok(/FreightUI\.init\(\)/.test(bare), '  inits the freight calculator when its tab opens');
  ok(/crm-core\.js/.test(html), '  loads crm-core for the pipeline');
  ok(/function renderPipeline\(/.test(bare) && /\.forecast\(/.test(bare) && /window\.CRMCore/.test(bare), '  the Pipeline tab renders a real board from crm-core forecast');
  ok(/action: 'list'/.test(bare) && /\/api\/crm/.test(bare), '  reads live pipeline data from /api/crm');
  ok(/canMove\(/.test(bare), '  stage moves are validated by crm-core (no dishonest wins)');
}

/* ── Acquisition dashboard (ZOG-style): KPI band + temperature kanban ── */
{
  ok(/function pipeTemp\(/.test(bare), 'temperature is derived from the ICP fit score (pipeTemp)');
  ok(/l\.score/.test(bare) && /Unscored/.test(bare), '  temperature reads lead.score and stays honest when unscored');
  ok(/pk-band/.test(html) && /class="pk-card"/.test(bare), '  renders a KPI band (Total/Hot/Warm/Cold/Open/Onboarded/value/conversion)');
  /* "Won" not "Onboarded" — the tile has to say the same word as the stage
     chip it counts, or the board contradicts itself. */
  ok(/Pipeline value/.test(bare) && /Conversion/.test(bare) && /'Won'/.test(bare), '  the KPI band has the acquisition metrics');

  /* ── the outreach band may only count what actually happened ──
     No channel is connected, so nothing in this app can observe a delivery or
     a reply. The tiles say "opened"/"logged", and the words that would imply
     observation we do not have must never appear as a metric label. */
  ok(/WhatsApp drafts opened/.test(bare) && /Email drafts opened/.test(bare), '  outreach tiles say "opened", never "sent"');
  /* Scoped to the outreach band itself — "Delivered cost ₹/MT" elsewhere in
     this file is freight pricing and has nothing to do with message delivery. */
  const band2 = bare.slice(bare.indexOf('const band2 ='), bare.indexOf('// ── controls'));
  ok(band2.length > 100, '  (the outreach band is where it should be)');
  ok(!/sent'/i.test(band2) && !/reply rate/i.test(band2) && !/delivered/i.test(band2) && !/opened rate/i.test(band2),
    '  no "sent" / "reply rate" / "delivered" metric is invented');
  ok(/pk-note/.test(bare) && /no email or WhatsApp channel is connected/.test(bare), '  and the band says why in plain words');

  /* Counts come from crm_activities, which this app now actually writes to. */
  ok(/action: 'activity'/.test(bare) && /function logTouch/.test(bare), '  touches are logged to the server (crm_activities)');
  ok(/PIPE\.activities/.test(bare), '  and the tiles count those rows, not a guess');
  ok(/kind: ch === 'whatsapp'/.test(bare), '  opening a draft in the Outreach Studio logs a touch');

  /* A promoted company must ENTER the pipeline — without a crm_leads row the
     board stays empty however many leads you promote. */
  const php = R('../api/discover.php');
  ok(/INSERT INTO crm_leads/.test(php), 'promoting a lead creates the pipeline row (not just the CRM company)');
  ok(/'lead_id' => \$leadId/.test(php), '  and the response says which lead it made');
  ok(/pl-temp/.test(bare) && /pl-move/.test(bare), '  cards show a temperature badge + a Move-to-next-stage button');
  ok(/pk-search/.test(html) && /PIPE_SEARCH/.test(bare) && /PIPE_TEMP/.test(bare), '  the board has search + temperature filter');
  ok(/pl-board/.test(html), '  the kanban scrolls horizontally (all stages as columns)');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
