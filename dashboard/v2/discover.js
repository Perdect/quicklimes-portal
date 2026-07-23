/* ═══════════════════════════════════════════════════════════════════════
   discover.js — Lead Discovery.

   Find businesses by trade + city, dedupe them against what you already know,
   score them on YOUR margins, and promote the good ones into the pipeline.

   Two things it refuses to do:
     • pretend a failed search is an empty market — a dead key and "there are no
       AAC plants in Jodhpur" must never look the same, or you write off a city
       full of buyers
     • hand you a firm you already supply as a shiny "new lead"

   The FIT score is NOT a vanity number: it is ICPCore.scoreLead, the same
   engine that ranks an imported list, reading your real margin per industry.
   A directory gives no tonnage and no distance, so the score leans on industry
   — and the "why" says exactly that rather than implying more certainty than
   we have.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const Q = window.QLD, IC2 = window.ICPCore, LI = window.LeadImport, LP = window.LeadParse, LM = window.LimeMarket, OSMQ = window.OSMQuery, LA = window.LeadActions;

/* OpenStreetMap is fetched by the BROWSER, not our server: the free Overpass
   service is slow (30s+) and throttles datacenter IPs, so a PHP curl under the
   30s limit reports "could not reach" while the browser (residential IP, no hard
   limit, CORS allowed) gets through. The server still parses/dedupes/stores via
   the `ingest` action — the browser only carries the raw elements across. */
const OVERPASS_EPS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

async function osmGeocode(place) {
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(place), { headers: { Accept: 'application/json' } });
    const j = await r.json();
    if (j && j[0] && j[0].lat) return { lat: +j[0].lat, lon: +j[0].lon };
  } catch (_) {}
  return null;
}

/* Fetch candidates from Overpass, in the browser. Returns
   { ok, elements, fellBack } or { ok:false, error, retry, hard }. `hard` marks a
   network/CORS failure (worth a server fallback); a timeout/busy is NOT hard —
   the server (slower) would only fail too, so we just ask the user to retry. */
async function osmClientFetch(what, city, radius) {
  let center = null, fellBack = false;
  if (radius > 0) { center = await osmGeocode(city); if (!center) fellBack = true; }
  const q = OSMQ.build(what, city, { max: 40, radiusKm: radius, center });
  let sawBusy = false, sawNet = false;
  for (const ep of OVERPASS_EPS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 38000);   // the browser can wait; Overpass ran ~32s when busy
    try {
      const res = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 429 || res.status === 504) { sawBusy = true; continue; }   // try the mirror
      if (!res.ok) return { ok: false, retry: true, error: 'OpenStreetMap error (HTTP ' + res.status + ')' };
      const j = await res.json();
      return { ok: true, elements: (j && j.elements) || [], fellBack };
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') return { ok: false, retry: true, error: 'OpenStreetMap is slow right now — please try again in a moment' };
      sawNet = true;   // network/CORS — a mirror (or the server) might still work
    }
  }
  return { ok: false, retry: true, hard: sawNet && !sawBusy,
    error: sawBusy ? 'OpenStreetMap is busy (free shared service) — wait a minute and try again'
                   : 'Could not reach OpenStreetMap — check your connection and try again' };
}

/* One (industry × city) discovery. OSM: fetch in the browser, then post the raw
   elements to the server to store. Google: the server does it (the key must stay
   server-side). Normalised to one result shape so the caller can aggregate. */
async function discoverOne(what, city, radius, indLabel) {
  if (SRC === 'osm') {
    const cf = await osmClientFetch(what, city, radius);
    if (cf.ok) {
      const r = await api({ action: 'ingest', city, industry: indLabel, elements: cf.elements });
      if (r && r.ok) r.radius_fell_back = cf.fellBack;
      return r;
    }
    // Hard network/CORS failure only: fall back to the server's own OSM fetch.
    if (cf.hard) return api({ action: 'search', what, city, industry: indLabel, radius, source: 'osm' });
    return { ok: false, error: cf.error, retry: cf.retry };
  }
  return api({ action: 'search', what, city, industry: indLabel, radius, source: SRC });
}

/* Known Rajasthan lime-belt origins with coordinates, so the freight origin can
   be changed without geocoding. Borunda (the user's plant) is the default. */
const LIME_ORIGINS = [
  ['Borunda', 26.35, 73.55], ['Gotan', 26.87, 73.62], ['Jodhpur', 26.29, 73.02],
  ['Beawar', 26.10, 74.32], ['Bhilwara', 25.35, 74.64], ['Jaipur', 26.91, 75.79], ['Bikaner', 28.02, 73.31]
];
const MI = { product: 'quick', origin: 'Borunda', rate: 4, exWorks: {} };
function miLoad() {
  try { const s = JSON.parse(localStorage.getItem('ql_lime_mi') || '{}'); Object.assign(MI, s); } catch (_) {}
  MI.rate = +MI.rate || 4;
  // Ex-works price per product — seeded from the engine's editable estimates so
  // the rupee figures work out of the box, then the user corrects to their real
  // prices (persisted per product).
  MI.exWorks = MI.exWorks || {};
  const def = (LM && LM.DEFAULT_EXWORKS) || {};
  ['quick', 'hydrated', 'powder'].forEach(k => { MI.exWorks[k] = +MI.exWorks[k] || def[k] || 0; });
}
function miEx() { return MI.exWorks[MI.product] || 0; }
function miSave() { try { localStorage.setItem('ql_lime_mi', JSON.stringify(MI)); } catch (_) {} }
function miOriginCoords() { const o = LIME_ORIGINS.find(x => x[0] === MI.origin) || LIME_ORIGINS[0]; return { name: o[0], lat: o[1], lon: o[2] }; }

/* The findable-industry taxonomy for the dropdown. Each entry carries what to
   SEARCH on the map (osm) and which ICP key it SCORES as (icp) — so a picked
   industry maps straight to a real fit score (icp-core.js owns those keys). An
   empty icp means "we can find it but have no margin history to score it", which
   is shown honestly as an unknown tier rather than a faked number. */
const DISCOVER_INDUSTRIES = [
  ['Manufacturing', [
    ['AAC Block', 'AAC', 'aac'], ['Cement / RMC', 'cement', 'cement'], ['Steel', 'steel', 'steel'],
    ['Foundry', 'foundry', 'foundry'], ['Glass', 'glass', 'glass'], ['Chemicals', 'chemical', 'chemical'],
    ['Ceramics', 'ceramic', ''], ['Mining', 'mining', 'mining']
  ]],
  ['Agriculture', [
    ['Sugar Mills', 'sugar mill', 'sugar'], ['Fertilizer', 'fertilizer', 'chemical'], ['Feed Mills', 'feed mill', '']
  ]],
  ['Paper & Packaging', [
    ['Paper Mills', 'paper mill', 'paper'], ['Packaging', 'packaging', '']
  ]],
  ['Construction & Water', [
    ['Builders / Developers', 'builder', 'construction'], ['Water Treatment', 'water treatment', 'water']
  ]]
];
const BIZ_TYPES = ['manufacturer', 'factory', 'supplier', 'dealer', 'distributor', 'trader', 'wholesaler', 'exporter', 'importer'];
const RADII = [[0, 'Whole area'], [50, 'Within 50 km'], [100, 'Within 100 km'], [250, 'Within 250 km'], [500, 'Within 500 km']];
/* When the industry dropdown is on "Any", the search term comes from whatever the
   AI bar last parsed (or the raw bar text) — kept here so both paths agree. */
let PARSED_WHAT = '';
const esc = (window.QLX && QLX.esc) || (s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

let ROWS = [], COUNTS = { new: 0, duplicate: 0, promoted: 0, dismissed: 0 }, TAB = 'new', RECENT = [], ICP = [];
/* OpenStreetMap is the DEFAULT because it is free and needs no key — a user who
   never touches Google Cloud still has a working feature. Google is offered
   only when the server says a key exists, so we never present a dead option. */
let SRC = 'osm', SOURCES = { osm: true, google: false };
let _tt;
function toast(msg, tone) {
  const el = document.getElementById('dcToast'); if (!el) return;
  el.textContent = msg; el.hidden = false; el.style.background = tone === 'err' ? '#b91c1c' : '#0f172a';
  clearTimeout(_tt); _tt = setTimeout(() => { el.hidden = true; }, 3200);
}

/* A search reaches a free, shared, sometimes-slow map service (Overpass) THROUGH
   our PHP, so "it failed" has several shapes and they need different words:
     • the server timed out on a slow Overpass call and returned an HTML error
       page → r.json() throws (this was the real "Network error" the user saw);
     • the browser is offline / the box is unreachable → fetch rejects;
     • the request ran past our own limit → AbortController fires;
     • the server answered honestly with { ok:false, error } → pass it through.
   The old code collapsed ALL of these into "Network error", which read like the
   feature was broken even when the truth was "the free service is busy, retry".
   Each branch below returns the real reason and marks whether a retry makes
   sense, so the UI can offer one. */
async function api(body, opts) {
  opts = opts || {};
  const p = JSON.parse(localStorage.getItem('ql_plant') || '{}');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 35000);
  let res;
  try {
    res = await fetch('/api/discover', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify(Object.assign({ plant_id: p.id, company_id: Q.activeCo, token: p.token }, body))
    });
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') {
      console.warn('[discover] request aborted after timeout', body && body.action);
      return { ok: false, error: 'The search took too long and was stopped — the free map service is slow right now. Try again, or search a smaller area.', retry: true };
    }
    console.warn('[discover] fetch failed', e);
    return { ok: false, error: 'Could not reach the server — check your internet connection.', retry: true };
  }
  clearTimeout(timer);
  const text = await res.text().catch(() => '');
  let j = null; try { j = JSON.parse(text); } catch (_) {}
  if (!j) {
    // Non-JSON means the server died mid-request — almost always a PHP timeout
    // while Overpass was still thinking — and returned an error page.
    console.warn('[discover] non-JSON reply', res.status, text.slice(0, 200));
    return {
      ok: false, retry: true, httpStatus: res.status,
      error: res.ok
        ? 'The server sent an unreadable reply — please try again.'
        : 'Server error (HTTP ' + res.status + ') — the search likely timed out. Try again, or search a smaller area.'
    };
  }
  return j;
}

/* The ICP is rebuilt from your sales each load, so the ranking reflects today's
   margins rather than whatever they were when a search was first run. */
function buildIcp() {
  try {
    const tonnes = (Q.production && Q.production().tonnes) || null;
    const cpt = IC2 ? IC2.costPerTonne(Q.getPL ? Q.getPL() : null, tonnes) : null;
    ICP = IC2 ? IC2.icpByIndustry({ sales: Q.salesRows(), parties: Q.partyRows(), costPerTonne: cpt }) : [];
  } catch (_) { ICP = []; }
}
function fitOf(r) {
  if (!IC2 || !IC2.scoreLead) return { score: 0, tier: 'unknown', why: [] };
  const key = LI ? LI.resolveIndustry(r.industry, IC2.INDUSTRIES) : (r.industry || '');
  try { return IC2.scoreLead({ industry: key, estTonnesPerMonth: null, distanceKm: null }, ICP) || { score: 0, tier: 'unknown', why: [] }; }
  catch (_) { return { score: 0, tier: 'unknown', why: [] }; }
}

/* Fallback suggestions ONLY if the market brain is unavailable. National, not
   local — the earlier all-Jodhpur/Jaipur list is exactly what this feature is
   meant to move the user away from. */
const SUGGEST = [
  ['sugar mill', 'Maharashtra'], ['steel', 'Chhattisgarh'], ['paper mill', 'Tamil Nadu'],
  ['chemical', 'Gujarat'], ['aluminium', 'Odisha'], ['AAC', 'Karnataka']
];

function paintSources() {
  const el = document.getElementById('dcSrc'); if (!el) return;
  const S = [
    ['osm', 'OpenStreetMap', true],
    ['google', 'Google Maps', SOURCES.google]
  ];
  el.innerHTML = S.map(([k, label, avail]) =>
    `<button class="dc-s${SRC === k ? ' on' : ''}" data-s="${k}"${avail ? '' : ' disabled title="Not connected yet — the account owner can switch Google Maps on in Settings"'}>
      <span class="dot${avail ? '' : ' off'}"></span>${label}${k === 'osm' ? ' <span class="free">free</span>' : ''}
    </button>`).join('');
  el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
    if (b.disabled) return;
    SRC = b.dataset.s; paintSources();
  });
  const at = document.getElementById('dcAttrib');
  if (at) at.style.display = SRC === 'osm' ? '' : 'none';
}

/* Populate the structured filters once. Native <select>s are used on purpose:
   they are type-ahead searchable, keyboard- and screen-reader-friendly, perfect
   on mobile, and cannot drift out of sync the way a hand-rolled combobox can. */
function buildFilters() {
  const ind = document.getElementById('dcIndSel');
  if (ind) {
    ind.innerHTML = '<option value="">Any industry</option>' + DISCOVER_INDUSTRIES.map(([grp, items]) =>
      `<optgroup label="${esc(grp)}">` + items.map(([label, osm, icp]) =>
        `<option value="${esc(osm)}" data-icp="${esc(icp)}">${esc(label)}</option>`).join('') + '</optgroup>').join('');
  }
  const biz = document.getElementById('dcBiz');
  if (biz) biz.innerHTML = '<option value="">Any type</option>' +
    BIZ_TYPES.map(t => `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('');
  const rad = document.getElementById('dcRadius');
  if (rad) rad.innerHTML = RADII.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
}

/* Parse the AI bar into the structured filters and show, in plain words, what
   was understood. Nothing is hidden: if a field could not be read it simply is
   not set, and the chip for it does not appear. */
function applyParse(text) {
  if (!LP) return;
  const p = LP.parse(text, IC2 ? IC2.INDUSTRIES : []);
  PARSED_WHAT = p.what || '';
  // Industry: match the parsed ICP key to a dropdown option (by its data-icp).
  const ind = document.getElementById('dcIndSel');
  if (ind) {
    ind.value = '';
    if (p.industry) {
      const opt = [...ind.options].find(o => o.getAttribute('data-icp') === p.industry.key);
      if (opt) ind.value = opt.value;
    }
  }
  const biz = document.getElementById('dcBiz'); if (biz) biz.value = p.businessType || '';
  const city = document.getElementById('dcCity'); if (city && p.place) city.value = p.place;
  const rad = document.getElementById('dcRadius');
  if (rad) rad.value = p.radiusKm ? String([50, 100, 250, 500].reduce((a, b) => Math.abs(b - p.radiusKm) < Math.abs(a - p.radiusKm) ? b : a)) : '0';
  paintUnderstood(p);
}

function paintUnderstood(p) {
  const el = document.getElementById('dcUnderstood'); if (!el) return;
  const chips = [];
  if (p.industry) chips.push(['Industry', p.industry.label]);
  else if (p.what) chips.push(['Looking for', p.what]);
  if (p.businessType) chips.push(['Type', p.businessType]);
  if (p.place) chips.push(['Area', p.place]);
  if (p.radiusKm) chips.push(['Radius', p.radiusKm + ' km']);
  el.innerHTML = chips.length
    ? '<span class="lbl">Understood:</span>' + chips.map(([k, v]) => `<span class="dc-u">${esc(k)}: ${esc(v)}</span>`).join('')
    : '';
}

/* Voice search — browser-native Web Speech API, no data cost. Only shown when
   the browser supports it, so it never sits there dead. It fills the AI bar and
   runs the same parse+search path a typed query does. */
function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = document.getElementById('dcMic'); if (!mic || !SR) return;
  mic.hidden = false;
  let rec = null, on = false;
  mic.onclick = () => {
    if (on && rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'en-IN'; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onstart = () => { on = true; mic.classList.add('rec'); };
    rec.onend = () => { on = false; mic.classList.remove('rec'); };
    rec.onerror = () => { on = false; mic.classList.remove('rec'); toast('Could not hear that — try again', 'err'); };
    rec.onresult = e => {
      const said = (e.results[0] && e.results[0][0] && e.results[0][0].transcript || '').trim();
      if (said) { document.getElementById('dcAi').value = said; runSearch(); }
    };
    try { rec.start(); } catch (_) {}
  };
}

/* ── Market Intelligence panel: the sales-manager layer ──
   Renders the national targeting plan for the chosen product from the chosen
   origin/freight, and lets a click on any (industry × state) launch the real
   company discovery below. This is what stops the tool being "search Jodhpur". */
function buildMarketPanel() {
  if (!LM) { const c = document.getElementById('miCard'); if (c) c.style.display = 'none'; return; }
  miLoad();
  const p = document.getElementById('miProduct');
  p.innerHTML = LM.PRODUCTS.map(x => `<option value="${x.key}">${esc(x.label)}</option>`).join('');
  p.value = MI.product;
  const o = document.getElementById('miOrigin');
  o.innerHTML = LIME_ORIGINS.map(x => `<option value="${esc(x[0])}">${esc(x[0])}</option>`).join('');
  o.value = MI.origin;
  document.getElementById('miRate').value = MI.rate;
  const ex = document.getElementById('miEx'); if (ex) ex.value = miEx();
  p.onchange = () => { MI.product = p.value; miSave(); if (ex) ex.value = miEx(); renderMarket(); };
  o.onchange = () => { MI.origin = o.value; miSave(); renderMarket(); };
  document.getElementById('miRate').onchange = e => { MI.rate = Math.min(20, Math.max(1, +e.target.value || 4)); e.target.value = MI.rate; miSave(); renderMarket(); };
  if (ex) ex.onchange = e => { MI.exWorks[MI.product] = Math.max(0, +e.target.value || 0); e.target.value = miEx(); miSave(); renderMarket(); };
  renderMarket();
}

function renderMarket() {
  const opts = { origin: miOriginCoords(), freightRate: MI.rate, exWorks: miEx() };
  const plan = LM.plan(MI.product, opts);
  const stEl = document.getElementById('miStates');
  stEl.innerHTML = plan.map((r, i) => {
    const inds = r.industries.slice(0, 3).map(ind =>
      `<button class="dc-chip" style="padding:2px 8px;font-size:11px" data-find data-what="${esc(LM.osmTerm(ind.key))}" data-state="${esc(r.state)}">${esc(ind.label.replace(/ (Plants|Mills|Manufacturers|Industries|Companies|Refineries|Smelters|Units)$/, ''))}</button>`).join(' ');
    // Rupee line only when a price is set (it always is, via defaults) — delivered
    // cost + how much of the price freight eats + an honest margin verdict.
    const money = r.deliveredPerTonne != null
      ? `<div class="mi-money">₹<b>${r.deliveredPerTonne.toLocaleString('en-IN')}</b>/t delivered · freight ${r.freightSharePct}% of price <span class="mi-prof ${r.profit.key}">${r.profit.label}</span></div>`
      : '';
    return `<div class="mi-s">
      <span class="mi-rank">${i + 1}</span>
      <div class="mi-si">
        <div class="mi-sn">${esc(r.state)}<span class="mi-tier ${r.tier.tier}">${r.tier.label} · ${r.km}km · ₹${r.freightPerTonne}/t</span></div>
        <div class="mi-sd">${inds}</div>
        ${money}
      </div>
      <div class="mi-score"><span class="n">${r.score}</span><span class="b"><i style="width:${r.score}%"></i></span></div>
    </div>`;
  }).join('');
  stEl.querySelectorAll('[data-find]').forEach(b => b.onclick = () => findInMarket(b.dataset.what, b.dataset.state));
  paintChips();   // keep the "Try:" examples in step with the selected product/origin

  const indEl = document.getElementById('miInds');
  indEl.innerHTML = LM.industriesForProduct(MI.product).slice(0, 10).map(ind => {
    const dots = [1, 2, 3, 4, 5].map(n => `<i class="${n <= ind.demand ? 'on' : ''}"></i>`).join('');
    return `<details class="mi-i">
      <summary><span class="mi-dem">${dots}</span>${esc(ind.label)}<span class="mi-imeta">${esc(ind.consumption)}</span></summary>
      <div class="mi-ibody">
        <p><b>Lime is used for:</b> ${esc(ind.use)}</p>
        <p><b>Buying:</b> ${esc(ind.frequency)} · <b>Ask for:</b> ${esc(ind.roles.join(', '))}</p>
      </div>
    </details>`;
  }).join('');
}

/* Bridge intelligence → discovery: fill the search with an (industry, state) and
   run it. State names work as OSM areas, so this searches the whole state. */
function findInMarket(what, state) {
  document.getElementById('dcAi').value = '';        // structured path, not the bar
  LAST_PARSED = null;
  const ind = document.getElementById('dcIndSel');
  const opt = [...ind.options].find(o => o.value.toLowerCase() === (what || '').toLowerCase());
  ind.value = opt ? opt.value : '';
  PARSED_WHAT = what;
  document.getElementById('dcCity').value = state;
  document.getElementById('dcRadius').value = '0';   // whole state, no circle
  paintUnderstood({ industry: opt ? { label: opt.text } : null, what: what, place: state, businessType: null, radiusKm: null });
  document.getElementById('dcAi').scrollIntoView({ behavior: 'smooth', block: 'center' });
  runSearch();
}

/* "Try:" suggestions come from the MARKET BRAIN, not a fixed local list — the
   top margin-ranked (industry × state) targets for the product you sell, so the
   examples themselves point across India rather than back at Jodhpur. Falls back
   to a national static list only if the engine is missing. */
function marketSuggestions() {
  if (!LM) return SUGGEST.map(([w, c]) => ({ what: w, state: c, label: w }));
  const plan = LM.plan((typeof MI !== 'undefined' && MI.product) || 'quick', { origin: miOriginCoords(), freightRate: (typeof MI !== 'undefined' && MI.rate) || 4 });
  // Skip Rajasthan (home) — the whole point is to look beyond it — and take the
  // best non-home markets, each with its top relevant industry.
  return plan.filter(r => r.state !== 'Rajasthan').slice(0, 6).map(r => {
    const top = r.industries[0];
    return { what: LM.osmTerm(top.key), state: r.state, label: top.label.replace(/ (Plants|Mills|Manufacturers|Industries|Companies|Refineries|Smelters|Units)$/, '') };
  });
}
function paintChips() {
  const el = document.getElementById('dcChips'); if (!el) return;
  const sug = marketSuggestions();
  el.innerHTML = '<span style="font-size:11.5px;color:var(--ql-text-secondary)">Try:</span>' +
    sug.map(s => `<button class="dc-chip" data-w="${esc(s.what)}" data-c="${esc(s.state)}">${esc(s.label)} · ${esc(s.state)}</button>`).join('');
  el.querySelectorAll('[data-w]').forEach(b => b.onclick = () => findInMarket(b.dataset.w, b.dataset.c));
}
function paintRecent() {
  const el = document.getElementById('dcRecent'); if (!el) return;
  if (!RECENT.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<span>Recent:</span>' + RECENT.slice(0, 6).map(r =>
    `<span class="dc-r${r.ok ? '' : ' bad'}">${esc(r.label)}${r.ok ? ' → ' + r.added + ' new / ' + r.dupes + ' dup' : ' — failed'}</span>`).join('');
}
function paintTabs() {
  const el = document.getElementById('dcTabs'); if (!el) return;
  const T = [['new', 'New'], ['duplicate', 'Duplicates'], ['promoted', 'Promoted'], ['dismissed', 'Dismissed']];
  el.innerHTML = T.map(([k, l]) => `<button class="dc-tab${TAB === k ? ' active' : ''}" data-t="${k}">${l}<span class="n">${COUNTS[k] || 0}</span></button>`).join('');
  el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { TAB = b.dataset.t; paintTabs(); paintTable(); });
}

function paintKpis() {
  document.getElementById('kNew').textContent = COUNTS.new || 0;
  document.getElementById('kProm').textContent = COUNTS.promoted || 0;
  document.getElementById('kDup').textContent = COUNTS.duplicate || 0;
  document.getElementById('kAll').textContent = ROWS.length;
}

function paintTable() {
  const host = document.getElementById('dcBody'); if (!host) return;
  const rows = ROWS.filter(r => r.status === TAB);
  if (!rows.length) {
    host.innerHTML = `<div class="dc-empty">
      <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <div><b>${TAB === 'new' ? 'Nothing found yet' : 'Nothing here'}</b></div>
      <div style="font-size:12.5px">${TAB === 'new' ? 'Search a trade and a city above — every result is checked against your customers and pipeline first.' : ''}</div>
    </div>`;
    return;
  }
  const scored = rows.map(r => ({ r, f: fitOf(r) }))
    .sort((a, b) => (b.f.score - a.f.score) || String(a.r.name).localeCompare(String(b.r.name)));

  host.innerHTML = `<div class="sr-table-wrap"><table class="sr"><thead><tr>
      <th>Company</th><th>Industry · Location</th><th>Contact</th><th>Fit</th><th class="r">Actions</th>
    </tr></thead><tbody>` +
    scored.map(({ r, f }) => {
      const tier = f.tier || 'unknown';
      const pct = Math.max(0, Math.min(100, f.score || 0));
      const dupNote = r.status === 'duplicate'
        ? `<span class="qx-pill" style="background:var(--ql-danger-50);color:var(--ql-danger-700)">${r.dupe_of === 'customer' ? 'Already your customer' : 'Already in pipeline'}</span>` : '';
      return `<tr>
        <td><div class="dc-name">${esc(r.name)}${r.rating ? ' <span style="color:#d97706;font-size:12px">★ ' + esc(r.rating) + '</span>' : ''}</div>
            <div class="dc-sub">${esc(r.website || '')}</div></td>
        <td><div class="dc-sub" style="color:var(--ql-text)">${esc(r.industry || '—')}</div><div class="dc-sub">${esc(r.address || r.city || '')}</div>${dupNote}</td>
        <td>${r.phone ? `<a class="dc-ico" href="tel:${esc(r.phone)}" title="${esc(r.phone)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>` : ''}
            ${r.website ? `<a class="dc-ico" href="${esc(r.website)}" target="_blank" rel="noopener noreferrer" title="Website"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></a>` : ''}</td>
        <td><span class="dc-fit" title="${esc((f.why || []).join(' · '))}"><span class="dc-bar ${tier}"><i style="width:${pct}%"></i></span>
            <span class="dc-score${tier === 'unknown' ? ' unknown' : ''}">${tier === 'unknown' ? '—' : Math.round(f.score)}</span></span></td>
        <td class="r"><span style="display:inline-flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
          ${LA ? `<button class="ql-btn ql-btn-secondary" data-assess="${r.id}" title="Why they fit + how to approach">Assess</button>
           <button class="ql-btn ql-btn-secondary" data-msg="${r.id}" title="Draft an outreach message">Message</button>` : ''}
          ${r.status === 'promoted' ? '<span class="qx-pill" style="background:#dcfce7;color:#15803d">In pipeline</span>' :
          `<button class="ql-btn ql-btn-primary" data-promote="${r.id}">Promote</button>
           <button class="ql-btn ql-btn-secondary" data-dismiss="${r.id}" title="Not a fit">✕</button>`}</span></td>
      </tr>`;
    }).join('') + '</tbody></table></div>';

  host.querySelectorAll('[data-promote]').forEach(b => b.onclick = () => promote(+b.dataset.promote));
  host.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = () => dismiss(+b.dataset.dismiss));
  host.querySelectorAll('[data-assess]').forEach(b => b.onclick = () => openAssess(ROWS.find(x => x.id === +b.dataset.assess)));
  host.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => openMessage(ROWS.find(x => x.id === +b.dataset.msg)));
}

/* Seller identity for the outreach draft — the active company profile. */
function sellerInfo() { const c = (Q && Q.co) || {}; return { name: c.short || c.name || 'Gotan Lime Industries', city: c.city || 'Gotan, Rajasthan', phone: c.phone || '' }; }

/* Assess — a local briefing (no API key): fit, the lime playbook for their
   industry, who to ask for, and how to approach. Live Claude can replace this
   text later via llm.php; the button calls the fallback today. */
function openAssess(r) {
  if (!r || !LA) return;
  const a = LA.assess(r, LM ? LM.INDUSTRIES : [], fitOf(r));
  const body = `<div class="la-assess">
    <div class="la-row"><span class="la-k">Industry</span><span class="la-v">${esc(a.industry)}${a.matched ? '' : ' <span style="color:var(--ql-text-muted)">(unconfirmed)</span>'}</span></div>
    ${a.points.map(p => `<div class="la-row"><span class="la-k">${esc(p.k)}</span><span class="la-v">${esc(p.v)}</span></div>`).join('')}
    <div class="la-approach"><b>How to approach:</b> ${esc(a.approach)}</div>
    <div class="la-note">Built from your Market Intelligence playbook — local rules, no AI key needed. Add an Anthropic key in Settings to upgrade this to live Claude analysis.</div>
  </div>`;
  QLShell.panel({ title: 'Assess — ' + r.name, sub: r.city || r.address || '', body,
    actions: [{ label: 'Draft a message', primary: true, onClick: () => { QLShell.closeModal(); openMessage(r); } }] });
}

/* Message — a ready outreach draft the user reviews, then sends themselves via
   WhatsApp or email (we never auto-send). Falls back to copy when there is no
   contact on file. */
function openMessage(r) {
  if (!r || !LA) return;
  const d = LA.draft(r, sellerInfo(), LM ? LM.INDUSTRIES : []);
  // wa-core owns the recipient: a landline or junk number normalises to '' and
  // is NOT a WhatsApp target. That decides the channel, not "has a phone field".
  const WA = window.WACore;
  const waOk = d.hasPhone && WA && WA.normalizePhone && WA.normalizePhone(r.phone) !== '';
  const channel = waOk ? 'whatsapp' : d.hasEmail ? 'email' : 'none';
  const body = `<div class="la-msg">
    <div class="la-note">${channel === 'whatsapp' ? 'Opens WhatsApp with this text — you review and send.' : channel === 'email' ? 'Opens your email with this drafted — you review and send.' : 'No messageable phone or email on file — copy the text and send it however you reach them.'}</div>
    <textarea id="laText" class="la-text" rows="9">${esc(d.text)}</textarea>
  </div>`;
  const actions = [{ label: 'Copy text', onClick: (bodyEl) => { const t = bodyEl.querySelector('#laText'); t.select(); try { navigator.clipboard.writeText(t.value); } catch (_) { document.execCommand('copy'); } toast('Copied'); } }];
  if (channel === 'whatsapp') actions.unshift({ label: 'Open in WhatsApp', primary: true, onClick: (bodyEl) => { const t = bodyEl.querySelector('#laText').value; window.open(WA.waLink(r.phone, t), '_blank', 'noopener'); } });
  else if (channel === 'email') actions.unshift({ label: 'Open email', primary: true, onClick: (bodyEl) => { const t = bodyEl.querySelector('#laText').value; window.location.href = 'mailto:' + encodeURIComponent(r.email) + '?subject=' + encodeURIComponent(d.subject) + '&body=' + encodeURIComponent(t); } });
  QLShell.panel({ title: 'Message — ' + r.name, sub: (waOk ? r.phone : r.email) || 'no contact on file', body, actions });
}

async function promote(id) {
  const r = await api({ action: 'promote', id });
  if (!r.ok) { toast(r.error || 'Could not promote', 'err'); return; }
  toast('Promoted to your pipeline'); await load();
}
async function dismiss(id) {
  const r = await api({ action: 'dismiss', id });
  if (!r.ok) { toast(r.error || 'Could not dismiss', 'err'); return; }
  await load();
}

function notice(html, warn) {
  const el = document.getElementById('dcNotice'); if (!el) return;
  el.innerHTML = html ? `<div class="dc-note${warn ? ' warn' : ''}">${html}</div>` : '';
}

let LAST_PARSED = null;   // the bar text last turned into filters (avoids re-parsing over a user's dropdown edits)

async function runSearch() {
  // Re-parse the bar only when it CHANGED — so editing a dropdown after parsing,
  // then hitting Search, respects the edit instead of being overwritten.
  const bar = (document.getElementById('dcAi').value || '').trim();
  if (bar && bar !== LAST_PARSED) { applyParse(bar); LAST_PARSED = bar; }

  const indSel = document.getElementById('dcIndSel');
  const indTerm = (indSel.value || '').trim();                       // the OSM search term for the picked industry
  const indLabel = indSel.value ? indSel.options[indSel.selectedIndex].text : '';
  const city = (document.getElementById('dcCity').value || '').trim();
  const radius = parseInt(document.getElementById('dcRadius').value || '0', 10) || 0;
  // What to actually search: the industry's trade word, else whatever the bar
  // parsed to, else the raw bar text. The hidden field keeps them in one place.
  const what = indTerm || PARSED_WHAT || bar;
  document.getElementById('dcWhat').value = what;
  if (!what) { toast('Type what to look for, or pick an industry', 'err'); return; }

  /* A whole STATE is too heavy for the free Overpass service (it times out), so
     when the target is a state we fan the search across its industrial HUB
     CITIES instead — fast, and where the plants actually are. A plain city is
     searched directly. */
  const st = LM && LM.stateByName(city);
  const targets = st ? LM.hubsFor(city, 3) : [city];
  const stateLabel = st ? city : '';

  const btn = document.getElementById('dcGo'); const label = btn.textContent;
  btn.disabled = true;

  let added = 0, dupes = 0, seen = 0, okAny = false, lastErr = '', lastRetry = false, fellBack = false;
  for (let i = 0; i < targets.length; i++) {
    btn.textContent = targets.length > 1 ? `Searching ${targets[i]}… (${i + 1}/${targets.length})` : 'Searching…';
    if (stateLabel) notice(`Searching <b>${esc(stateLabel)}</b> across its industrial hubs: ${targets.map((t, j) => j <= i ? '<b>' + esc(t) + '</b>' : esc(t)).join(' · ')}`);
    const r = await discoverOne(what, targets[i], radius, indLabel);
    if (r.ok) { okAny = true; added += r.added || 0; dupes += r.dupes || 0; seen += r.seen || 0; if (r.radius_fell_back) fellBack = true; }
    else { lastErr = r.error || 'unknown error'; lastRetry = !!r.retry; if (r.not_configured) { lastErr = r.error; lastRetry = false; okAny = false; break; } }
  }
  btn.disabled = false; btn.textContent = label;

  const tag = what + (city ? ' · ' + city : '') + (radius ? ' · ' + radius + 'km' : '');
  if (!okAny) {
    /* A failure is SHOWN. The whole point: a dead source must never read as
       "there are no such businesses here". */
    RECENT.unshift({ label: tag, ok: false });
    paintRecent();
    /* OSM is a free, shared, often-overloaded service with thin coverage of
       Indian industry — a failure here is EXPECTED, not a broken app. Say so, and
       point at the paths that always work rather than leaving the user retrying. */
    const freeNudge = SRC === 'osm'
      ? ' <br><span style="font-weight:500">The free OpenStreetMap service is often slow or sparse for Indian firms. For dependable prospecting, use <b>Paste / import a list</b>, or the <b>Market Intelligence</b> targets above.</span>'
      : '';
    notice('Search failed: <b>' + esc(lastErr) + '</b>'
      + (lastRetry ? ' <button class="dc-retry" id="dcRetry">Retry</button>' : '') + freeNudge, true);
    const rb = document.getElementById('dcRetry'); if (rb) rb.onclick = runSearch;
    toast(lastErr, 'err');
    return;
  }
  if (radius && fellBack) notice('Couldn’t pin the centre of <b>' + esc(city) + '</b>, so this searched the whole area instead of a ' + radius + ' km circle.', true);
  else if (added === 0 && dupes === 0) {
    /* Reached the source fine but it had nothing — with OSM that is coverage, not
       "no such businesses". Be honest and redirect to what works. */
    notice('No matches in OpenStreetMap for <b>' + esc(tag) + '</b> — its coverage of Indian industry is thin, so this rarely means the businesses don’t exist. Try <b>Paste / import a list</b>, or aim with <b>Market Intelligence</b> above.', true);
  }
  else if (stateLabel) notice(`Searched <b>${esc(stateLabel)}</b> across ${targets.join(', ')}. Want more towns there? Tell me and I’ll widen the hub list.`);
  else notice('');
  RECENT.unshift({ label: tag, ok: true, added, dupes });
  paintRecent();
  toast(added + ' new · ' + dupes + ' already known' + (seen ? ' · ' + seen + ' seen before' : ''));
  TAB = 'new'; await load();
}

async function loadSources() {
  const r = await api({ action: 'sources' });
  if (r && r.ok) {
    SOURCES = { osm: !!r.osm, google: !!r.google };
    if (!SOURCES.google && SRC === 'google') SRC = 'osm';   // never sit on a dead source
    paintSources();
  }
}

async function load() {
  const r = await api({ action: 'list' });
  if (!r.ok) {
    if (/unauthor/i.test(r.error || '')) return;                 // the shell handles a dead session
    notice('Could not load discovered businesses: <b>' + esc(r.error || 'unknown') + '</b>', true);
    return;
  }
  ROWS = r.rows || []; COUNTS = r.counts || COUNTS;
  paintKpis(); paintTabs(); paintTable();
}

/* Pasting a list is the no-key path — the same ranked import the pipeline uses. */
function openPaste() {
  if (window.location) window.location.href = 'crm.html';
}

QLShell.mount({ active: 'discover', title: 'Lead Discovery' });
buildIcp();
buildFilters(); setupVoice(); buildMarketPanel();
paintSources(); paintChips(); paintTabs(); paintTable();
document.getElementById('dcGo').addEventListener('click', runSearch);
// Enter in the AI bar or the city field searches; typing in the bar re-parses.
document.getElementById('dcAi').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
document.getElementById('dcCity').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
// Picking an industry live-previews what will be searched (the understood row).
document.getElementById('dcIndSel').addEventListener('change', () => {
  const s = document.getElementById('dcIndSel');
  paintUnderstood({
    industry: s.value ? { label: s.options[s.selectedIndex].text } : null,
    businessType: document.getElementById('dcBiz').value || null,
    place: (document.getElementById('dcCity').value || '').trim() || null,
    radiusKm: parseInt(document.getElementById('dcRadius').value || '0', 10) || null,
    what: s.value || PARSED_WHAT
  });
});
document.getElementById('dcImport').addEventListener('click', openPaste);
window.__qlOnSwitchCompany = () => { buildIcp(); load(); };
Q.init(() => {}).then(() => { buildIcp(); loadSources(); load(); }).catch(() => { loadSources(); load(); });
