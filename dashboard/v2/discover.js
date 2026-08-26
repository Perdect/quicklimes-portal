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
/* Full-planet Overpass mirrors that actually carry India (regional mirrors like
   overpass.osm.ch are Europe-only and return nothing for Indian coordinates).
   Tried in order until one answers; the two we shipped before were both down. */
const OVERPASS_EPS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

async function osmGeocode(place) {
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&limit=1&q=' + encodeURIComponent(place), { headers: { Accept: 'application/json' } });
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
  /* Prefer an AROUND (radius) search. The admin-AREA query — resolve the city's
     boundary, then scan inside it — is far heavier on the free Overpass service
     and frequently returns 504. Geocoding the city and searching a radius around
     it is the query Overpass can actually serve. We only fall back to the area
     query if geocoding the city fails. */
  center = await osmGeocode(city);
  const effRadius = radius > 0 ? radius : (center ? 40 : 0);   // default 40 km around a city when no radius was set
  if (radius > 0 && !center) fellBack = true;
  const q = OSMQ.build(what, city, { max: 40, radiusKm: effRadius, center: (effRadius > 0 && center) ? center : null });
  let sawBusy = false, sawNet = false;
  for (const ep of OVERPASS_EPS) {
    const ctrl = new AbortController();
    /* 18s, not 38s. Three mirrors x 38s meant a failing OSM search could hold the
       user for nearly two minutes before saying so. A mirror that has not
       answered in 18s is not about to. */
    const timer = setTimeout(() => ctrl.abort(), 18000);
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
/* LEVEL 2 — which rows are expanded inline. A click opens the detail UNDER the
   row instead of throwing a drawer over the list, so the salesperson keeps
   their place in the results while reading. View state only. */
const EXPANDED = new Set();
/* LEVEL-1 FILTERS. India hierarchy: State -> City. There is no state column on
   a discovered row, so state is DERIVED from the full Google address against
   the known state list — real data, not a guess. District/PIN are deliberately
   absent: nothing in the row carries them, and a filter that silently matches
   nothing is worse than no filter. */
const FLT = { state: '', city: '', industry: '', phone: false, web: false, minRating: 0 };
function rowState(r) {
  const hay = ((r.address || '') + ' ' + (r.state || '')).toLowerCase();
  const list = (LM && LM.STATES) ? LM.STATES : [];
  for (let i = 0; i < list.length; i++) if (hay.indexOf(list[i].name.toLowerCase()) >= 0) return list[i].name;
  return '';
}
function passesFilters(r) {
  if (FLT.state && rowState(r) !== FLT.state) return false;
  if (FLT.city && String(r.city || '').toLowerCase() !== FLT.city.toLowerCase()) return false;
  if (FLT.industry && String(r.industry || '') !== FLT.industry) return false;
  if (FLT.phone && !r.phone) return false;
  if (FLT.web && !r.website) return false;
  if (FLT.minRating && !(+r.rating >= FLT.minRating)) return false;
  return true;
}
function filterBarHTML(all, shown) {
  const states = [...new Set(all.map(rowState).filter(Boolean))].sort();
  const cities = [...new Set(all.filter(r => !FLT.state || rowState(r) === FLT.state)
    .map(r => r.city).filter(Boolean))].sort();
  /* The industry list is drawn from the rows themselves, and the control only
     appears when there is an actual choice to make — a one-option dropdown is
     furniture, not a filter. */
  const inds = [...new Set(all.map(r => r.industry).filter(Boolean))].sort();
  const opt = (v, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(v)}</option>`;
  const chip = (k, label) => `<button class="lf-chip${FLT[k] ? ' on' : ''}" data-flt="${k}">${label}</button>`;
  const active = FLT.state || FLT.city || FLT.industry || FLT.phone || FLT.web || FLT.minRating;
  return `<div class="lf">
    <select class="lf-sel" data-flt-state><option value="">All states</option>${states.map(v => opt(v, FLT.state)).join('')}</select>
    <select class="lf-sel" data-flt-city><option value="">All cities</option>${cities.map(v => opt(v, FLT.city)).join('')}</select>
    ${inds.length > 1 ? `<select class="lf-sel" data-flt-ind><option value="">All industries</option>${inds.map(v => opt(v, FLT.industry)).join('')}</select>` : ''}
    ${chip('phone', 'Has phone')}${chip('web', 'Has website')}
    <select class="lf-sel" data-flt-rating><option value="0">Any rating</option>${[4.5, 4, 3.5, 3].map(v => `<option value="${v}"${+FLT.minRating === v ? ' selected' : ''}>★ ${v}+</option>`).join('')}</select>
    <span class="lf-count">${shown} of ${all.length}</span>
    ${active ? '<button class="lf-clear" data-flt-clear>Clear</button>' : ''}
  </div>`;
}
/* OpenStreetMap is the DEFAULT because it is free and needs no key — a user who
   never touches Google Cloud still has a working feature. Google is offered
   only when the server says a key exists, so we never present a dead option. */
/* The user's EXPLICIT source choice is remembered; until they make one we pick
   the best AVAILABLE source ourselves (see loadSources). OSM stays the fallback
   because it needs no key — but it must never be the default when a fast,
   connected source exists. */
let SRC = 'osm', SOURCES = { osm: true, google: false, mapbox: false };
let SRC_PINNED = false;
try { const p = localStorage.getItem('ql_dc_src'); if (p) { SRC = p; SRC_PINNED = true; } } catch (_) {}
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

/* Self-serve Mapbox connect — the owner pastes a free Mapbox public token; it is
   stored server-side against the account (no config-file editing needed). */
function connectGoogle() {
  QLShell.panel({ title: 'Connect Google Places', body:
    '<div class="mi-sub" style="margin-bottom:10px">Paste your Google Maps Platform API key (starts with <b>AIza</b>) with <b>Places API (New)</b> enabled. Stored securely on your account — never shown in the browser. Set a budget cap in Google Cloud Billing; Places text search is billed per request.</div>'
    + '<input id="ggKey" class="os-input" placeholder="AIza..." autocomplete="off" spellcheck="false" style="width:100%;margin-bottom:10px">'
    + '<div id="ggErr" style="color:var(--ql-danger-600,#dc2626);font:600 12px var(--ql-font-sans);margin-bottom:10px;min-height:14px"></div>'
    + '<div style="display:flex;gap:8px"><button class="ql-btn ql-btn-primary" id="ggSave" type="button">Connect</button><button class="ql-btn ql-btn-secondary" id="ggClear" type="button">Remove</button></div>' });
  const inp = document.getElementById('ggKey'), errEl = document.getElementById('ggErr'), save = document.getElementById('ggSave');
  if (inp) inp.focus();
  async function send(key) {
    save.disabled = true; save.textContent = 'Connecting…';
    // field is google_key — NOT `token`, which carries the session (see save_mapbox)
    const r = await api({ action: 'save_google', google_key: key });
    if (r && r.ok) { QLShell.closeModal(); toast(key ? 'Google Places connected' : 'Google removed'); await loadSources(); if (key) { SRC = 'google'; SRC_PINNED = true; try { localStorage.setItem('ql_dc_src', SRC); } catch (_) {} } paintSources(); }
    else { save.disabled = false; save.textContent = 'Connect'; if (errEl) errEl.textContent = (r && r.error) || 'Could not save — try again.'; }
  }
  if (save) save.addEventListener('click', () => {
    const k = (inp.value || '').trim();
    if (!/^AIza/.test(k)) { if (errEl) errEl.textContent = 'That should start with "AIza" — copy the API key from Google Cloud credentials.'; return; }
    send(k);
  });
  const clr = document.getElementById('ggClear'); if (clr) clr.addEventListener('click', () => send(''));
}
function connectMapbox() {
  QLShell.panel({ title: 'Connect Mapbox', body:
    '<div class="mi-sub" style="margin-bottom:10px">Paste your free Mapbox <b>public</b> token (starts with <b>pk.</b>). Get one free at <b>account.mapbox.com/access-tokens</b>. Stored securely on your account — never shown in the browser.</div>'
    + '<input id="mbTok" class="os-input" placeholder="pk...." autocomplete="off" spellcheck="false" style="width:100%;margin-bottom:10px">'
    + '<div id="mbErr" style="color:var(--ql-danger-600,#dc2626);font:600 12px var(--ql-font-sans);margin-bottom:10px;min-height:14px"></div>'
    + '<div style="display:flex;gap:8px"><button class="ql-btn ql-btn-primary" id="mbSave" type="button">Connect</button><button class="ql-btn ql-btn-secondary" id="mbClear" type="button">Remove</button></div>' });
  const inp = document.getElementById('mbTok'), errEl = document.getElementById('mbErr'), save = document.getElementById('mbSave');
  if (inp) inp.focus();
  async function send(token) {
    save.disabled = true; save.textContent = 'Connecting…';
    // NB: the field MUST NOT be named `token` — api() injects the session token
    // under `token`, and the body key would overwrite it → the server would see
    // the Mapbox token as the session and reject the call as Unauthorized.
    const r = await api({ action: 'save_mapbox', mapbox_token: token });
    if (r && r.ok) { QLShell.closeModal(); toast(token ? 'Mapbox connected' : 'Mapbox removed'); await loadSources(); if (token) { SRC = 'mapbox'; } paintSources(); }
    else { save.disabled = false; save.textContent = 'Connect'; if (errEl) errEl.textContent = (r && r.error) || 'Could not save — try again.'; }
  }
  if (save) save.addEventListener('click', () => {
    const tok = (inp.value || '').trim();
    if (!/^pk\./.test(tok)) { if (errEl) errEl.textContent = 'That should start with "pk." — copy the DEFAULT public token from Mapbox.'; return; }
    send(tok);
  });
  const clr = document.getElementById('mbClear'); if (clr) clr.addEventListener('click', () => send(''));
}
function paintSources() {
  const el = document.getElementById('dcSrc'); if (!el) return;
  const S = [
    ['osm', 'OpenStreetMap', true, 'free'],
    ['mapbox', 'Mapbox', SOURCES.mapbox, SOURCES.mapbox ? 'free tier' : 'connect'],
    ['google', 'Google Maps', SOURCES.google, SOURCES.google ? 'richest' : 'connect']
  ];
  el.innerHTML = S.map(([k, label, avail, tag]) => {
    // Mapbox is self-serve: if not connected, the pill opens a paste-token flow
    // (no dead end). Google still needs a backend key the owner sets.
    const connectable = (k === 'mapbox' || k === 'google') && !avail;
    const disabled = !avail && !connectable;
    return `<button class="dc-s${SRC === k ? ' on' : ''}" data-s="${k}"${connectable ? ' data-connect="1"' : ''}${disabled ? ' disabled title="Not connected — the owner adds a Google key in the backend config"' : ''}>
      <span class="dot${avail ? '' : ' off'}"></span>${label}${tag ? ' <span class="free">' + tag + '</span>' : ''}
    </button>`;
  }).join('');
  el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
    if (b.dataset.connect) { (b.dataset.s === 'google' ? connectGoogle : connectMapbox)(); return; }
    if (b.disabled) return;
    SRC = b.dataset.s; SRC_PINNED = true;
    try { localStorage.setItem('ql_dc_src', SRC); } catch (_) {}
    paintSources();
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
  if (typeof renderCopilot === 'function') renderCopilot();   // the top pick may have changed
  if (typeof renderHeatMap === 'function') renderHeatMap();
  if (typeof renderHero === 'function') renderHero();

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

/* ONE compact summary strip, not four large cards.

   The cards cost ~140px of vertical space above the leads and said very little:
   four numbers a salesperson glances at once. This says more in ~40px, and
   sits between the search and the results rather than pushing them down.

   Every figure is counted from the rows on screen. Deliberately ABSENT:
   decision-maker counts, GST status, "verified", "open now" — a directory
   result carries none of that, and a confident number nobody can source is
   worse in front of a customer than no number. */
function summaryStats() {
  const withPhone = ROWS.filter(r => r.phone).length;
  const withEmail = ROWS.filter(r => r.email).length;
  const withWeb   = ROWS.filter(r => r.website).length;
  const reachable = ROWS.filter(r => r.phone || r.email || r.website).length;
  const pct = ROWS.length ? Math.round(reachable / ROWS.length * 100) : 0;
  let newest = '';
  ROWS.forEach(r => { const t = String(r.created_at || ''); if (t > newest) newest = t; });
  return { withPhone, withEmail, withWeb, reachable, pct, newest };
}
function agoText(ts) {
  if (!ts) return '';
  const t = Date.parse(String(ts).replace(' ', 'T') + (/[Z+]/.test(String(ts)) ? '' : 'Z'));
  if (!isFinite(t)) return '';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const h = Math.floor(mins / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.floor(h / 24);
  return d + (d === 1 ? ' day ago' : ' days ago');
}
/* ── Export what is ON SCREEN ───────────────────────────────────────────────
   Exports the CURRENT tab and filters, not everything ever discovered — if the
   list says "12 of 58" the file has 12 rows. An export that silently disagrees
   with the screen is how people end up working the wrong list. */
function csvCell(v) {
  const t = v == null ? '' : String(v);
  return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
function exportRows(rows, label) {
  if (!rows.length) { toast('Nothing to export in this view', 'err'); return; }
  const cols = [['name', 'Company'], ['industry', 'Industry'], ['city', 'City'], ['state', 'State'],
    ['address', 'Address'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'],
    ['rating', 'Google rating'], ['source', 'Source'], ['status', 'Status']];
  const head = cols.map(c => csvCell(c[1])).join(',');
  const body = rows.map(r => cols.map(c => csvCell(c[0] === 'state' ? rowState(r) : r[c[0]])).join(',')).join('\n');
  /* BOM so Excel opens Indian names and ₹ correctly instead of mojibake. */
  const blob = new Blob(['\ufeff' + head + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'leads-' + (label || 'discovered') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  toast('Exported ' + rows.length + ' ' + (rows.length === 1 ? 'business' : 'businesses'));
}
function visibleRows() { return ROWS.filter(r => r.status === TAB).filter(passesFilters); }

/* ── AI summary of THIS result set ─────────────────────────────────────────
   Opens beside the list and answers "what did I just find, and what is worth
   doing next" — from the rows themselves. Four honest sections:
     • where they are            (states, counted)
     • what they are             (industries, counted, with the lime use-case)
     • what we can reach them on (phone/email/website coverage)
     • what is missing           (named plainly, with why we cannot fill it)
   Nothing here is a model's opinion; it is arithmetic over the rows, which is
   why it can be shown to a customer. */
function insightData() {
  const rows = visibleRows();
  const tally = (key) => {
    const m = {};
    rows.forEach(r => { const k = (key === 'state' ? rowState(r) : r[key]) || ''; if (k) m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map(k => ({ k, n: m[k] })).sort((a, b) => b.n - a.n);
  };
  const states = tally('state'), industries = tally('industry');
  const noPhone = rows.filter(r => !r.phone).length;
  const noEmail = rows.filter(r => !r.email).length;
  const noWeb   = rows.filter(r => !r.website).length;
  const noRate  = rows.filter(r => r.rating == null || r.rating === '').length;
  const waAble  = rows.filter(r => waReachable(r.phone)).length;
  /* Which of these actually consume lime — via the same industry engine the
     rest of the page uses, not a guess. */
  const limeFit = industries.map(x => {
    const ind = (LA && LM) ? LA.matchIndustry(x.k, LM.INDUSTRIES) : null;
    return { k: x.k, n: x.n, use: ind ? ind.use : '', demand: ind ? +ind.demand || 0 : null };
  });
  const matched = limeFit.filter(x => x.demand != null).reduce((a, x) => a + x.n, 0);
  return { rows, states, industries: limeFit, noPhone, noEmail, noWeb, noRate, waAble, matched };
}
function insightHTML() {
  const d = insightData();
  if (!d.rows.length) return '<div class="pd-none">No rows in this view yet — run a search first.</div>';
  const total = d.rows.length;
  const bar = (n) => '<span class="in-bar"><i style="width:' + Math.round(n / total * 100) + '%"></i></span>';
  const list = (arr, extra) => arr.slice(0, 6).map(x =>
    '<div class="in-row"><span class="in-k">' + esc(x.k) + '</span>' + bar(x.n)
    + '<span class="in-n">' + x.n + '</span></div>'
    + (extra && x.use ? '<div class="in-sub">' + esc(x.use) + '</div>' : '')).join('');
  const miss = [];
  if (d.noPhone) miss.push(d.noPhone + ' with no phone');
  if (d.noEmail) miss.push(d.noEmail + ' with no email');
  if (d.noWeb)   miss.push(d.noWeb + ' with no website');
  if (d.noRate)  miss.push(d.noRate + ' with no Google rating');
  return `
    <div class="pd-sec"><div class="pd-sec-t">Where they are</div>${list(d.states)}</div>
    <div class="pd-sec"><div class="pd-sec-t">What they are · and why they buy lime</div>${list(d.industries, true)}
      <div class="in-note">${d.matched} of ${total} match a known lime use-case. The rest are listed as found — the industry engine has no entry for them, so nothing is claimed.</div></div>
    <div class="pd-sec"><div class="pd-sec-t">How you can reach them</div>
      <div class="in-row"><span class="in-k">Phone</span>${bar(total - d.noPhone)}<span class="in-n">${total - d.noPhone}</span></div>
      <div class="in-row"><span class="in-k">WhatsApp-able</span>${bar(d.waAble)}<span class="in-n">${d.waAble}</span></div>
      <div class="in-row"><span class="in-k">Email</span>${bar(total - d.noEmail)}<span class="in-n">${total - d.noEmail}</span></div>
      <div class="in-row"><span class="in-k">Website</span>${bar(total - d.noWeb)}<span class="in-n">${total - d.noWeb}</span></div>
      <div class="in-note">WhatsApp-able counts mobiles only — a landline cannot receive a WhatsApp message.</div></div>
    <div class="pd-sec"><div class="pd-sec-t">What is missing</div>
      <div class="cd-why">${miss.length ? esc(miss.join(' · ')) : 'Every row has a phone, an email and a website.'}</div>
      <div class="in-note">GST numbers, decision-maker names and company size are <b>not</b> in this data. Map and directory sources do not carry them, and this page will not invent them — they need a paid business-data provider.</div></div>`;
}
function openInsights() {
  const pane = QLShell.panel({ title: 'What this search found', sub: TAB + ' · ' + visibleRows().length + ' businesses', body: insightHTML() });
  return pane;
}

function paintKpis() {
  const host = document.getElementById('dcSum'); if (!host) return;
  if (!ROWS.length) { host.hidden = true; host.innerHTML = ''; return; }
  const st = summaryStats();
  const n = (v, l, cls) => `<span class="ds-n ${cls || ''}"><b>${v}</b>${l}</span>`;
  const ago = agoText(st.newest);
  host.hidden = false;
  host.innerHTML = `
    <div class="ds-counts">
      ${n(COUNTS.new || 0, 'new')}
      ${n(COUNTS.promoted || 0, 'promoted', 'g')}
      ${n(COUNTS.duplicate || 0, 'duplicate', 'a')}
      ${n(ROWS.length, 'total', 'm')}
    </div>
    <div class="ds-reach" title="Counted from the rows on this page">
      <span class="ds-bar"><i style="width:${st.pct}%"></i></span>
      <span class="ds-reach-t"><b>${st.pct}%</b> reachable</span>
      <span class="ds-ch">${IC_PHONE}${st.withPhone}</span>
      <span class="ds-ch">${IC_MAIL}${st.withEmail}</span>
      <span class="ds-ch">${IC_WEB}${st.withWeb}</span>
    </div>
    ${ago ? `<span class="ds-ago">${IC_CLOCK}updated ${esc(ago)}</span>` : ''}
    <button class="ds-act" id="dsInsight" type="button" title="What this search found">${IC_SPARK}AI summary</button>
    <button class="ds-act" id="dsExport" type="button" title="Export the rows this view is showing">${IC_DOC}Export CSV</button>`;
  const ex = document.getElementById('dsExport');
  if (ex) ex.onclick = () => exportRows(visibleRows(), TAB);
  const ins = document.getElementById('dsInsight');
  if (ins) ins.onclick = () => openInsights();
}

/* Per-lead economics — real, only when we have the lead's coordinates (OSM rows
   carry lat/lng). Freight from the plant to the lead, delivered cost, margin
   verdict. No coords (e.g. a pasted CSV) → null, and the card just omits it. */
function leadEconomics(r) {
  if (!LM || r == null || r.lat == null || r.lng == null) return null;
  const km = LM.roadKm(miOriginCoords(), { lat: +r.lat, lon: +r.lng });
  const freight = Math.round(km * MI.rate);
  const ex = miEx();
  return { km, freight, delivered: ex ? ex + freight : null, share: ex ? Math.round(freight / ex * 100) : null, tier: ex ? LM.profitTier(freight / ex) : null };
}
const IC_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
const IC_WEB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
const IC_BLDG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/></svg>';
const IC_FLAME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2s4 4 4 8a4 4 0 0 1-8 0c0-1.5.5-2.5 1-3 0 2 1 3 2 3 1.5 0 1-4 1-8z"/><path d="M6 14a6 6 0 0 0 12 0c0-2-1-3.5-2-5"/></svg>';
const IC_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const IC_SNOW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19"/></svg>';
const IC_LAYERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/></svg>';
const IC_TROPHY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12v5a6 6 0 0 1-12 0z"/><path d="M6 6H3v1a4 4 0 0 0 3 3.9M18 6h3v1a4 4 0 0 1-3 3.9M9 20h6M12 15v5"/></svg>';
const IC_RUPEE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12M6 9h12M15 4c0 4-3 5-6 5h-.5L15 20"/></svg>';
const IC_TARGET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>';
const IC_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>';
const IC_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const IC_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>';
/* A real printer glyph as SVG — the old emoji print character rendered as an
   empty tofu box on many systems. */
const IC_PRINT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
const IC_USERPLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>';
const IC_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const IC_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/></svg>';
const IC_SPARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>';
const IC_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>';
const IC_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
const IC_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const IC_WA = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.5A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-2.9.9.9-2.8-.2-.3A8 8 0 1 1 12 20zm4.4-6c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1-.6.8-.8 1-.3.2-.5.1a6.5 6.5 0 0 1-3.2-2.8c-.2-.4.2-.4.6-1.2.1-.1 0-.3 0-.4l-.7-1.7c-.2-.5-.4-.4-.5-.4h-.5a1 1 0 0 0-.7.3A2.8 2.8 0 0 0 6 8.9c0 1.7 1.2 3.3 1.4 3.5s2.4 3.7 5.8 5c2.2.8 2.2.5 2.6.5s1.4-.6 1.6-1.1.2-1 .1-1.1z"/></svg>';

/* ── LEVEL 2: the inline expansion ──────────────────────────────────────
   What a salesperson wants BEFORE deciding to call, and nothing more. The
   why-they-buy line comes from the tested lead-actions/lime-market rules — it
   is never an invented claim. Freight, market analysis and timeline are Level 3
   (the profile), deliberately not here. */
/* ── BUYER PROBABILITY (an estimate, and labelled as one) ─────────────────
   Built from signals we actually hold, never invented:
     • industry demand 1-5  — lime-market's playbook (how much this sector
       consumes), the single strongest predictor
     • ICP fit              — icp-core, learned from YOUR OWN invoices
     • contactability       — a buyer you cannot reach converts at zero
   Deliberately NOT a fabricated "96%". When we have no industry match we say
   so rather than printing a confident number over nothing. */
function buyerProbability(r, f) {
  const ind = (LA && LM) ? LA.matchIndustry(r.industry, LM.INDUSTRIES) : null;
  if (!ind) return { pct: null, why: 'No lime use-case matched for this industry, so there is nothing honest to score.' };
  const demand = Math.max(0, Math.min(5, +ind.demand || 0));        // 0..5
  const fit = (f && f.tier !== 'unknown') ? Math.max(0, Math.min(100, f.score)) : null;
  const reach = (r.phone ? 1 : 0) + (r.email ? 1 : 0) + (r.website ? 1 : 0);   // 0..3
  /* demand carries most of the weight, fit adjusts it, reachability nudges. */
  let pct = (demand / 5) * 70 + (fit != null ? (fit / 100) * 20 : 10) + (reach / 3) * 10;
  pct = Math.round(Math.max(5, Math.min(97, pct)));
  const why = [];
  why.push(ind.label + ' consume lime ' + (demand >= 5 ? 'very heavily' : demand >= 4 ? 'heavily' : demand >= 3 ? 'moderately' : 'lightly'));
  if (fit != null) why.push('fit ' + Math.round(fit) + '/100 against your own sales');
  why.push(reach ? reach + ' way' + (reach > 1 ? 's' : '') + ' to reach them' : 'no contact details yet');
  return { pct: pct, ind: ind, why: why.join(' · ') };
}
function recommendedProduct(ind) {
  const map = { quick: 'Quick Lime (CaO)', hydrated: 'Hydrated Lime (Ca(OH)₂)', powder: 'Lime Powder' };
  if (!ind || !ind.products || !ind.products.length) return '';
  return ind.products.map(k => map[k] || k).join(' · ');
}
function aiPaneHTML(r, f) {
  const bp = buyerProbability(r, f);
  const ind = bp.ind;
  const others = ROWS.filter(x => x.id !== r.id);
  const similar = others.filter(x => (x.industry || '') === (r.industry || '')).slice(0, 4);
  const nearby = others.filter(x => x.city && r.city && x.city.toLowerCase() === r.city.toLowerCase()).slice(0, 4);
  const pitch = (LA && LA.compose)
    ? LA.compose(r, sellerInfo(), LM ? LM.INDUSTRIES : [], { channel: 'whatsapp', type: 'intro' }).text.split('\n\n')[0]
    : '';
  const list = (arr, empty) => arr.length
    ? '<ul class="ai-list">' + arr.map(x => `<li>${esc(x.name)}${x.city ? ' <span class="lx-miss">· ' + esc(x.city) + '</span>' : ''}</li>`).join('') + '</ul>'
    : `<div class="lx-miss">${empty}</div>`;
  const bar = bp.pct != null
    ? `<div class="ai-prob"><div class="ai-prob-n">${bp.pct}<small>%</small></div>
         <div class="ai-prob-b"><i style="width:${bp.pct}%"></i></div>
         <div class="ai-prob-w">${esc(bp.why)}</div>
         <div class="lx-miss" style="margin-top:6px">An estimate from industry demand, your ICP fit and contactability — not a measured conversion rate.</div></div>`
    : `<div class="lx-miss">${esc(bp.why)}</div>`;
  return `<div class="cd-sec"><div class="cd-sec-t">Buying probability</div>${bar}</div>
    ${ind ? `<div class="cd-sec"><div class="cd-sec-t">Recommended product</div>
      <div class="cd-why"><b>${esc(recommendedProduct(ind))}</b><br>${esc(ind.consumption || '')}</div></div>` : ''}
    ${pitch ? `<div class="cd-sec"><div class="cd-sec-t">Suggested opening</div><div class="cd-why">${esc(pitch)}</div>
      <button class="ql-btn ql-btn-secondary" id="cdPitch" style="margin-top:8px">Open Outreach Studio</button></div>` : ''}
    <div class="cd-sec"><div class="cd-sec-t">Similar buyers you found</div>${list(similar, 'None in this list yet.')}</div>
    <div class="cd-sec"><div class="cd-sec-t">Nearby buyers${r.city ? ' in ' + esc(r.city) : ''}</div>${list(nearby, 'None in this list yet.')}</div>`;
}

function leadExpandHTML(r, f) {
  const ind = (LA && LA.matchIndustry) ? LA.matchIndustry(r.industry, LM ? LM.INDUSTRIES : []) : null;
  const kv = (k, v) => v ? `<div class="lx-kv"><span>${k}</span><b>${v}</b></div>` : '';
  const miss = t => `<span class="lx-miss">${t}</span>`;
  return `<div class="lx">
    <div class="lx-cols">
      <div class="lx-col">
        <div class="lx-h">Company</div>
        ${kv('Address', esc(r.address || [r.city, r.state].filter(Boolean).join(', ')) || miss('not on file'))}
        ${kv('GST', r.gstin ? esc(r.gstin) : miss('not on file — needs a paid source'))}
        ${kv('Source', esc(r.source === 'osm' ? 'OpenStreetMap' : r.source === 'mapbox' ? 'Mapbox' : 'Google Places'))}
      </div>
      <div class="lx-col">
        <div class="lx-h">Why they buy lime</div>
        ${ind ? `<div class="lx-why">${esc(ind.use)}</div>` : `<div class="lx-miss">No lime use-case matched for this industry.</div>`}
        ${ind ? kv('Typical consumption', esc(ind.consumption || '')) : ''}
        ${ind && ind.roles ? kv('Ask for', esc(ind.roles.slice(0, 2).join(' · '))) : ''}
        ${kv('Fit score', (f && f.tier !== 'unknown') ? Math.round(f.score) + ' / 100' : miss('not scored yet'))}
      </div>
    </div>
    <input class="lx-in" data-note="${r.id}" placeholder="Add a note…" value="${esc(noteFor(r.id))}">
    <div class="lx-acts"><button class="lr-b" data-profile="${r.id}">Open full profile</button></div>
  </div>`;
}
/* Notes stay on this device until the profile page owns them server-side. */
function noteKey() { return 'ql_dc_notes_' + (Q && Q.activeCo != null ? Q.activeCo : '0'); }
function allNotes() { try { return JSON.parse(localStorage.getItem(noteKey()) || '{}'); } catch (_) { return {}; } }
function noteFor(id) { return allNotes()[String(id)] || ''; }
function saveNote(id, v) { const n = allNotes(); n[String(id)] = v; try { localStorage.setItem(noteKey(), JSON.stringify(n)); } catch (_) {} }

/* A WhatsApp button must only appear where a WhatsApp chat can actually open.
   Directory results are full of landlines, and a landline that survives
   normalizePhone (079 4023 5235 → 7940235235) sends the user to "this number
   isn't on WhatsApp". Call stays available on every number either way. */
function waReachable(phone) {
  const W = window.WACore;
  if (!phone || !W || !W.normalizePhone) return false;
  if (W.isMobileNumber && !W.isMobileNumber(phone)) return false;
  return W.normalizePhone(phone) !== '';
}

function paintTable() {
  const host = document.getElementById('dcBody'); if (!host) return;
  const inTab = ROWS.filter(r => r.status === TAB);
  const rows = inTab.filter(passesFilters);
  if (!rows.length) {
    paintFloatCount(0, inTab.length);
    host.innerHTML = (inTab.length ? filterBarHTML(inTab, 0) : '') + `<div class="dc-empty">
      <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <div><b>${TAB === 'new' ? 'Nothing found yet' : 'Nothing here'}</b></div>
      <div style="font-size:12.5px">${TAB === 'new' ? 'Search a trade and a city above — every result is checked against your customers and pipeline first.' : ''}</div>
    </div>`;
    wireTable(host);   /* the bar is DEAD without this — you could filter to zero
                          rows and then never unselect the chip that did it. */
    return;
  }
  const scored = rows.map(r => ({ r, f: fitOf(r) }))
    .sort((a, b) => (b.f.score - a.f.score) || String(a.r.name).localeCompare(String(b.r.name)));

  /* SALES ROWS, NOT FREIGHT CARDS. These rows exist so a salesperson can CALL a
     company — so the row leads with who they are and how to reach them. Distance
     and freight were the old lead: a red "Freight too high" badge on every row
     discouraged calling companies that should be called, and freight is a
     question for the Freight tab, not for prospecting. */
  paintFloatCount(rows.length, inTab.length);
  host.innerHTML = filterBarHTML(inTab, rows.length) + '<div class="lc-list">' + scored.map(({ r, f }) => {
    const tier = f.tier || 'unknown';
    const dup = r.status === 'duplicate' ? `<span class="lc-dup">${r.dupe_of === 'customer' ? 'Already your customer' : 'Already in pipeline'}</span>` : '';
    const rating = (r.rating != null && r.rating !== '') ? `<span class="lr-rate" title="Google rating">★ ${(+r.rating).toFixed(1)}</span>` : '';
    const src = '';   /* provenance lives in the expanded pane, not on every row */
    const addr = esc(r.address || [r.city, r.state].filter(Boolean).join(', ') || '');
    const line = [];
    if (r.phone)   line.push(`<a class="lr-c" href="tel:${esc(r.phone)}" data-stop title="Call">${IC_PHONE}${esc(r.phone)}</a>`);
    if (r.website) line.push(`<a class="lr-c" href="${esc(r.website)}" target="_blank" rel="noopener noreferrer" data-stop title="Open website">${IC_WEB}${esc(String(r.website).replace(/^https?:\/\/(www\.)?/, '').slice(0, 46))}</a>`);
    if (r.email)   line.push(`<a class="lr-c" href="mailto:${esc(r.email)}" data-stop title="Email">${IC_MAIL}${esc(r.email)}</a>`);
    const contacts = line.length ? line.join('') : '<span class="lr-nocontact">No phone or website on file</span>';
    /* Every row gets the SAME five action slots, in the same order and at the
       same widths — a row without WhatsApp renders an empty slot rather than
       shifting Promote left. Uneven wrapping is what made the list look
       unaligned; identical geometry is what makes a list scannable. */
    const wa = (r.phone && waReachable(r.phone))
      ? `<a class="lr-b ico wa" href="${esc(WACore.waLink(r.phone, ''))}" target="_blank" rel="noopener noreferrer" data-stop title="WhatsApp ${esc(r.phone)}" aria-label="WhatsApp">${IC_WA}</a>`
      : '<span class="lr-b-slot" aria-hidden="true"></span>';
    /* No Maps button. Removed at the user's request — a circle that only ever
       opened Google Maps was cost without a decision behind it. The full
       address is still on the row, and "Open in Maps" is one copy away; there
       is deliberately no map link left anywhere in this module. */
    const acts = (LA ? `<button class="lr-b assess" data-assess="${r.id}" title="Why they buy lime">${IC_SPARK}Assess</button><button class="lr-b msg" data-msg="${r.id}" title="Open a QuickLimes conversation about this business">${IC_SEND}Message</button>` : '');
    const promo = r.status === 'promoted'
      ? '<span class="lr-inpipe">In pipeline</span>'
      : `<button class="lr-b pri" data-promote="${r.id}" title="Promote to pipeline">${IC_USERPLUS}Promote</button>`;
    /* Dismiss lives on the row because the whole point of this list is triage:
       the fastest judgement a salesperson makes is "not a buyer". */
    const drop = r.status === 'dismissed' ? '<span class="lr-b-slot" aria-hidden="true"></span>'
      : `<button class="lr-b ico ghost" data-dismiss="${r.id}" title="Not a buyer — dismiss" aria-label="Dismiss">${IC_X}</button>`;
    return `<div class="lr" data-open="${r.id}" tabindex="0" role="button">
      <div class="lr-fit ${tier}" title="Buyer fit score">${tier === 'unknown' ? '—' : Math.round(f.score)}</div>
      <div class="lr-main">
        <div class="lr-top"><span class="lr-name">${esc(r.name)}</span>${rating}${dup}</div>
        <div class="lr-meta">${esc(r.industry || '—')}${src}</div>
        ${addr ? `<div class="lr-addr">${IC_PIN}${addr}</div>` : ''}
        <div class="lr-cts">${contacts}</div>
      </div>
      <div class="lr-acts">${wa}${acts}${promo}${drop}</div>
    </div>${EXPANDED.has(String(r.id)) ? leadExpandHTML(r, f) : ''}`;
  }).join('') + '</div>';

  wireTable(host);
}

function wireTable(host) {
  const q = sel => host.querySelector(sel);
  const st = q('[data-flt-state]'); if (st) st.onchange = () => { FLT.state = st.value; FLT.city = ''; paintTable(); };
  const ct = q('[data-flt-city]');  if (ct) ct.onchange = () => { FLT.city = ct.value; paintTable(); };
  const iv = q('[data-flt-ind]'); if (iv) iv.onchange = () => { FLT.industry = iv.value; paintTable(); };
  const rt = q('[data-flt-rating]'); if (rt) rt.onchange = () => { FLT.minRating = +rt.value || 0; paintTable(); };
  host.querySelectorAll('[data-flt]').forEach(b => b.onclick = () => { FLT[b.dataset.flt] = !FLT[b.dataset.flt]; paintTable(); });
  const cl = q('[data-flt-clear]'); if (cl) cl.onclick = () => { FLT.state = FLT.city = FLT.industry = ''; FLT.phone = FLT.web = false; FLT.minRating = 0; paintTable(); };
  const find = id => ROWS.find(x => x.id === +id);
  host.querySelectorAll('[data-stop]').forEach(a => a.addEventListener('click', e => e.stopPropagation()));
  host.querySelectorAll('[data-promote]').forEach(b => b.onclick = e => { e.stopPropagation(); promote(+b.dataset.promote); });
  host.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = e => { e.stopPropagation(); dismiss(+b.dataset.dismiss); });
  host.querySelectorAll('[data-assess]').forEach(b => b.onclick = e => { e.stopPropagation(); openAssess(find(b.dataset.assess)); });
  host.querySelectorAll('[data-msg]').forEach(b => b.onclick = e => { e.stopPropagation(); openMessage(find(b.dataset.msg)); });
  const toggle = id => { const k = String(id); EXPANDED.has(k) ? EXPANDED.delete(k) : EXPANDED.add(k); paintTable(); };
  host.querySelectorAll('.lr[data-open]').forEach(c => {
    c.onclick = e => { if (e.target.closest('a,button,input')) return; toggle(c.dataset.open); };
    c.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); toggle(c.dataset.open); } };
  });
  host.querySelectorAll('[data-profile]').forEach(b => b.onclick = e => { e.stopPropagation(); openLeadDrawer(find(b.dataset.profile)); });
  host.querySelectorAll('[data-note]').forEach(i => { i.onclick = e => e.stopPropagation(); i.onchange = () => saveNote(i.dataset.note, i.value); });
}

/* Company 360° — a slide-in drawer with the REAL profile: fit + why, per-lead
   freight economics, the lime playbook for their industry, contacts, and every
   action. Honest about what it does NOT have (firmographics need a paid source),
   so a blank field never reads as fabricated. */
function closeLeadDrawer() { const b = document.getElementById('lcBack'); if (b) { b.classList.remove('open'); setTimeout(() => { b.hidden = true; }, 220); } }
function openLeadDrawer(r) {
  if (!r) return;
  const back = document.getElementById('lcBack'), d = document.getElementById('lcDrawer'); if (!d) return;
  const f = fitOf(r), tier = f.tier || 'unknown', e = leadEconomics(r);
  const ind = (LA && LM) ? LA.matchIndustry(r.industry, LM.INDUSTRIES) : null;
  const WA = window.WACore;
  const waOk = waReachable(r.phone);
  const row = (k, v) => `<div class="cd-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const econSec = e ? `<div class="cd-sec"><div class="cd-sec-t">Delivery economics · estimate</div>
      ${row('Distance from your plant', e.km + ' km')}
      ${row('Freight', '₹' + e.freight.toLocaleString('en-IN') + '/t')}
      ${e.delivered != null ? row('Delivered cost', '₹' + e.delivered.toLocaleString('en-IN') + '/t') : ''}
      ${e.tier ? row('Margin', '<span class="lc-econ"><span class="pt ' + e.tier.key + '">' + esc(e.tier.label) + '</span></span>' + (e.share != null ? ' · freight ' + e.share + '% of price' : '')) : ''}</div>` : '';
  const playSec = ind ? `<div class="cd-sec"><div class="cd-sec-t">Lime playbook · ${esc(ind.label)}</div>
      <div class="cd-why"><b>Uses lime for:</b> ${esc(ind.use)}<br><b>Typical consumption:</b> ${esc(ind.consumption)}<br><b>Buying:</b> ${esc(ind.frequency)}<br><b>Ask for:</b> ${esc(ind.roles.join(', '))}</div></div>` : '';
  d.innerHTML = `
    <div class="cd-head">
      <div class="lc-fit ${tier}">${tier === 'unknown' ? '—' : Math.round(f.score)}</div>
      <div class="cd-h-id"><div class="cd-name">${esc(r.name)}</div><div class="cd-sub">${esc(r.industry || 'Industry not confirmed')}${r.city ? ' · ' + esc(r.city) : ''}</div></div>
      <button class="cd-x" id="cdX" aria-label="Close">✕</button>
    </div>
    <div class="cd-tabs" id="cdTabs">
      <button class="cd-tab active" data-tab="overview">Overview</button>
      <button class="cd-tab" data-tab="fit">Lime fit</button>
      <button class="cd-tab" data-tab="freight">Freight</button>
      <button class="cd-tab" data-tab="ai">AI</button>
      <button class="cd-tab" data-tab="notes">Notes</button>
    </div>
    <div class="cd-body">
      <div class="cd-pane" data-pane="overview">
      <div class="cd-sec"><div class="cd-sec-t">Contact</div>
        ${r.phone ? row('Phone', esc(r.phone)) : ''}
        ${r.email ? row('Email', esc(r.email)) : ''}
        ${r.website ? row('Website', `<a href="${esc(r.website)}" target="_blank" rel="noopener noreferrer">${esc(r.website.replace(/^https?:\/\//, ''))}</a>`) : ''}
        ${r.address ? row('Address', esc(r.address)) : ''}
        ${(!r.phone && !r.email && !r.website) ? '<div class="cd-why">No contact details on this listing yet — a website search or a call to the switchboard is the next step.</div>' : ''}
      </div>
      <div class="cd-sec"><div class="cd-sec-t">Actions</div>
        <div class="cd-cta">
          ${LA ? '<button class="ql-btn ql-btn-secondary" id="cdAssess">' + IC_SPARK + 'Assess</button><button class="ql-btn ql-btn-secondary" id="cdMsg">' + IC_MAIL + 'Message</button><button class="ql-btn ql-btn-secondary" id="cdDraft">' + IC_SEND + 'Draft outreach</button><button class="ql-btn ql-btn-secondary" id="cdQuote">' + IC_DOC + 'Quote</button><button class="ql-btn ql-btn-secondary" id="cdProposal">' + IC_DOC + 'Proposal</button><button class="ql-btn ql-btn-secondary" id="cdOnboard">' + IC_LINK + 'Onboarding link</button>' : ''}
          ${waOk ? '<button class="ql-btn ql-btn-secondary" id="cdWa">WhatsApp</button>' : ''}
          ${r.phone ? `<a class="ql-btn ql-btn-secondary" href="tel:${esc(r.phone)}" style="justify-content:center">Call</a>` : ''}
          ${r.status !== 'promoted' ? '<button class="ql-btn ql-btn-primary" id="cdPromote">Promote to pipeline</button>' : '<div class="lc-dup" style="color:#15803d;background:#dcfce7;align-self:center">In your pipeline</div>'}
        </div>
      </div>
      <div class="cd-missing"><b>Not on file:</b> revenue, employee count, GST number, decision-maker names, credit history. Firmographics like these need a paid data provider — this page never invents them.</div>
      </div>

      <div class="cd-pane" data-pane="fit" hidden>
        <div class="cd-sec"><div class="cd-sec-t">Fit for your lime</div>
          <div class="cd-why">${f.why && f.why.length ? esc(f.why.join('. ')) + '.' : 'Scored against your own sales history (ICP).'}</div></div>
        ${playSec || '<div class="cd-sec"><div class="cd-why">No lime use-case matched for this industry yet.</div></div>'}
      </div>

      <div class="cd-pane" data-pane="freight" hidden>
        ${econSec || '<div class="cd-sec"><div class="cd-why">No coordinates on this listing, so freight cannot be estimated. Use the Freight tab to quote from a full address.</div></div>'}
        <div class="cd-sec"><div class="cd-why">Freight lives here, not in the lead list — it decides the <b>quote</b>, not whether the company is worth calling.</div></div>
      </div>

      <div class="cd-pane" data-pane="ai" hidden>${aiPaneHTML(r, f)}</div>

      <div class="cd-pane" data-pane="notes" hidden>
        <div class="cd-sec"><div class="cd-sec-t">Notes</div>
          <textarea class="cd-note" id="cdNote" rows="6" placeholder="Call notes, who you spoke to, what they asked for…">${esc(noteFor(r.id))}</textarea>
          <div class="cd-why" style="margin-top:8px">Saved on this device.</div></div>
      </div>
    </div>`;
  back.hidden = false; requestAnimationFrame(() => back.classList.add('open'));
  document.getElementById('cdX').onclick = closeLeadDrawer;
  d.querySelectorAll('.cd-tab').forEach(b => b.onclick = () => {
    d.querySelectorAll('.cd-tab').forEach(x => x.classList.toggle('active', x === b));
    d.querySelectorAll('.cd-pane').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  });
  const nt = document.getElementById('cdNote'); if (nt) nt.onchange = () => saveNote(r.id, nt.value);
  const pb = document.getElementById('cdPitch'); if (pb) pb.onclick = () => openStudio(r);
  back.onclick = ev => { if (ev.target === back) closeLeadDrawer(); };
  const wire = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  wire('cdAssess', () => openAssess(r));
  wire('cdMsg', () => openMessage(r));
  wire('cdDraft', () => openOutreachDraft(r));
  wire('cdQuote', () => openQuote(r));
  wire('cdProposal', () => openProposal(r));
  wire('cdOnboard', () => openOnboardLink(r));
  wire('cdWa', () => window.open(WA.waLink(r.phone, ''), '_blank', 'noopener'));
  wire('cdPromote', () => { promote(r.id); closeLeadDrawer(); });
}

/* Seller identity for the outreach draft — the active company profile. */
/* The signature is the company's OWN identity, from Settings → Company profile
   — never a hardcoded number, because two companies use this app and each must
   sign as itself. A missing field simply drops out of the sign-off. */
function sellerInfo() {
  const c = (Q && Q.co) || {};
  return { name: c.short || c.name || 'Gotan Lime Industries', city: c.city || 'Gotan, Rajasthan',
    phone: c.phone || '', address: c.address || '', owner: c.ownerName || '' };
}

/* The lead fields we send to the server AI (never any invented data). */
function leadPayload(r) { return { name: r.name, industry: r.industry || '', city: r.city || '', phone: r.phone || '', email: r.email || '', website: r.website || '' }; }

/* ═══ PROPOSAL GENERATOR — a branded Gotan Lime supply proposal, print/PDF-ready
   (like ZOG's). Delivered ₹/MT comes from the real freight engine when the lead
   has coordinates; otherwise it is honestly quoted "on address confirmation".
   Numbers are labelled estimates — never invented certainties. ═══ */
/* ONE pricing computation for BOTH the Quote and the Proposal — a single source
   of truth for the delivered ₹/MT, so the short quote and the full proposal can
   never show a different number for the same lead. */
function leadPricing(r) {
  r = r || {};
  const FC = window.FreightCore;
  const origin = LM ? LM.DEFAULT_ORIGIN : { lat: 26.35, lon: 73.55, name: 'Borunda, Rajasthan' };
  const prod = (FC && FC.PRODUCTS[0]) || { label: 'Quick Lime (CaO)', exworks: 8000, gst: 0.05 };
  const exworks = prod.exworks;
  const rate = LM ? LM.DEFAULT_FREIGHT : 4;
  const hasGeo = (r.lat != null && (r.lng != null || r.lon != null));
  const lon = r.lng != null ? r.lng : r.lon;
  let km = null, freight = null, delivered = null;
  if (hasGeo && LM) { km = LM.roadKm({ lat: origin.lat, lon: origin.lon }, { lat: +r.lat, lon: +lon }); freight = Math.round(km * rate); delivered = exworks + freight; }
  const tpm = +r.tonnes || +r.est_tpm || 0;
  return { prod, origin, exworks, rate, hasGeo, km, freight, delivered, tpm, gst: prod.gst || 0.05 };
}

/* The shared document shell — the same .pr-* design the proposal uses, so the
   quote reads as the same professional letterhead. Takes the ready-made body. */
function prShell(id, seller, sub, metaTitle, metaSub, rightBtns, bodyHTML, metaRows) {
  const back = document.createElement('div');
  back.className = 'pr-back'; back.id = 'prBack';
  const co = (Q && Q.co) || {};
  /* the identity line a real letterhead carries: GSTIN · works · phone */
  const idBits = [co.gstin ? 'GSTIN ' + co.gstin : '', co.address || co.station || co.city || '', co.phone ? '☎ ' + co.phone : '']
    .filter(Boolean).map(esc).join('<span class="pr-dot">·</span>');
  const mono = esc((seller || 'G').trim().charAt(0).toUpperCase());
  const panel = metaRows && metaRows.length
    ? `<div class="pr-panel"><div class="pr-panel-t">${esc(metaTitle)}</div>${metaRows.map(r => `<div class="pr-panel-r"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}</div>`
    : `<div class="pr-meta">${esc(metaTitle)}${metaSub ? `<span class="pr-meta-s">${esc(metaSub)}</span>` : ''}</div>`;
  back.innerHTML = `<div class="pr-bar"><button class="pr-close" id="prClose">← Back to lead</button><div class="pr-bar-r">${rightBtns}</div></div>
    <div class="pr-doc" id="prDoc">
      <div class="pr-head">
        <div class="pr-brand-w"><div class="pr-mono">${mono}</div>
          <div><div class="pr-brand">${esc(seller)}</div><div class="pr-brand-s">${esc(sub)}</div>
          ${idBits ? `<div class="pr-id">${idBits}</div>` : ''}</div></div>
        ${panel}
      </div>
      <hr class="pr-hr">
      ${bodyHTML}
    </div>`;
  document.body.appendChild(back);
  document.getElementById('prClose').addEventListener('click', () => back.remove());
  const pp = document.getElementById('prPrint'); if (pp) pp.addEventListener('click', () => window.print());
  const onKey = e => { if (e.key === 'Escape') { back.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  return back;
}

/* PRICE QUOTATION — the short, professional PDF (just the number and terms), a
   sibling of the full proposal. Same letterhead; sendable straight to WhatsApp. */
function openQuote(r) {
  r = r || {};
  const co = (Q && Q.co) || {};
  const seller = co.short || 'Gotan Lime Industries';
  const P = leadPricing(r);
  const fmt = n => '₹' + Math.round(+n || 0).toLocaleString('en-IN');
  const city = r.city || 'your site';
  const dateStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const priceRows = P.hasGeo
    ? `<tr><td>Ex-works (${esc(P.prod.label)})</td><td>${fmt(P.exworks)}/MT</td></tr>
        <tr><td>Freight — ${esc(P.origin.name.split(',')[0])} → ${esc(city)} (~${P.km.toLocaleString('en-IN')} km, est.)</td><td>${fmt(P.freight)}/MT</td></tr>
        <tr class="pr-tot"><td>Delivered price</td><td>${fmt(P.delivered)} / MT <span class="pr-tot-gst">+ GST</span></td></tr>`
    : `<tr><td>Ex-works (${esc(P.prod.label)})</td><td>${fmt(P.exworks)}/MT</td></tr>
        <tr><td>Freight to ${esc(city)}</td><td>on address confirmation</td></tr>
        <tr class="pr-tot"><td>Delivered price</td><td>ex-works + freight + GST</td></tr>`;
  const vol = (P.tpm > 0 && P.delivered)
    ? `<div class="pr-earn"><div><div class="pr-earn-l">Estimated monthly supply value at ${P.tpm} MT/month</div><div class="pr-earn-s">Delivered ${fmt(P.delivered)}/MT × ${P.tpm} MT (indicative)</div></div><div class="pr-earn-v">${fmt(P.delivered * P.tpm)}</div></div>`
    : '';
  const validStr = new Date(Date.now() + 7 * 864e5).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  /* a stable, human document number: date + the lead's own digits */
  const qno = 'Q-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + ((String(r.id || r.phone || '').replace(/\D/g, '').slice(-3)) || '001');
  const body = `
    <div class="pr-to"><div class="pr-to-l">Prepared for</div>
      <div class="pr-to-n">${esc(r.name || 'Your organisation')}</div>
      ${[r.city, r.phone].filter(Boolean).length ? `<div class="pr-to-s">${[r.city, r.phone].filter(Boolean).map(esc).join(' · ')}</div>` : ''}</div>
    <p class="pr-lede">Thank you for your enquiry. Our delivered price for <b>${esc(P.prod.label)}</b> to ${esc(city)} is below — freight included.</p>
    <h2 class="pr-h2">Delivered pricing</h2>
    <table class="pr-tbl"><tr><th>Item</th><th>Rate (₹/MT)</th></tr>${priceRows}</table>
    ${vol}
    <p class="pr-fine">${P.hasGeo ? 'Freight is a road-distance estimate; the exact figure is confirmed against your delivery point and load size.' : 'Share your exact delivery point and we will confirm a delivered ₹/MT within the day.'}</p>
    <h2 class="pr-h2">Terms</h2>
    <ul class="pr-ul pr-ul-2">
      <li>GST extra as applicable (${Math.round(P.gst * 100)}%)</li>
      <li>Valid until ${esc(validStr)}; prices subject to change after</li>
      <li>Minimum order by vehicle load</li>
      <li>Dispatch schedule agreed on confirmation</li>
      <li>Payment terms as mutually agreed</li>
      <li>Test certificate accompanies every dispatch</li>
    </ul>
    <div class="pr-signrow">
      <div class="pr-contact"><div class="pr-contact-l">Questions / confirmation</div><div class="pr-contact-v">${co.phone ? '☎ ' + esc(co.phone) : esc(seller)}</div></div>
      <div class="pr-sig"><div class="pr-sig-for">For ${esc(seller)}</div><div class="pr-sig-space"></div><div class="pr-sig-line">Authorised Signatory</div></div>
    </div>`;
  const btns = `<button class="ql-btn ql-btn-secondary" id="qtWa">${IC_SEND || ''}Send on WhatsApp</button><button class="ql-btn ql-btn-primary" id="prPrint">${IC_PRINT}Print / Save PDF</button>`;
  prShell('prBack', seller, 'Quick Lime · Hydrated Lime · Limestone — ' + (co.city || 'Gotan, Rajasthan'), 'PRICE QUOTATION', dateStr, btns, body,
    [['Quotation No', qno], ['Date', dateStr], ['Valid until', validStr]]);
  const wa = document.getElementById('qtWa');
  if (wa) wa.addEventListener('click', () => {
    const line = P.hasGeo
      ? 'Delivered ' + fmt(P.delivered) + '/MT + GST to ' + city + ' (' + P.prod.label + ').'
      : 'Ex-works ' + fmt(P.exworks) + '/MT for ' + P.prod.label + '; freight quoted on address confirmation.';
    const msg = seller + ' — Price Quotation' + (r.name ? ' for ' + r.name : '') + '\n\n' + line + '\nValid 7 days. Full quotation PDF available on request.';
    const WA = window.WACore; const link = (WA && WA.waLink) ? WA.waLink(r.phone || '', msg) : 'https://wa.me/?text=' + encodeURIComponent(msg);
    window.open(link, '_blank', 'noopener');
  });
}

function openProposal(r) {
  r = r || {};
  const co = (Q && Q.co) || {};
  const seller = co.short || 'Gotan Lime Industries';
  const P = leadPricing(r);
  const prod = P.prod, origin = P.origin, exworks = P.exworks, hasGeo = P.hasGeo, km = P.km, freight = P.freight, delivered = P.delivered, tpm = P.tpm;
  const fmt = n => '₹' + Math.round(+n || 0).toLocaleString('en-IN');
  const city = r.city || 'your site';
  const priceBlock = hasGeo
    ? `<table class="pr-tbl"><tr><th>Item</th><th>Rate</th></tr>
        <tr><td>Ex-works (${esc(prod.label)})</td><td>${fmt(exworks)}/MT</td></tr>
        <tr><td>Freight — ${esc(origin.name.split(',')[0])} → ${esc(city)} (~${km.toLocaleString('en-IN')} km, est.)</td><td>${fmt(freight)}/MT</td></tr>
        <tr class="pr-tot"><td>Delivered price</td><td>${fmt(delivered)}/MT + GST</td></tr></table>
        <p class="pr-fine">Freight is a road-distance estimate; the exact figure is confirmed against your delivery point and load size.</p>`
    : `<table class="pr-tbl"><tr><th>Item</th><th>Rate</th></tr>
        <tr><td>Ex-works (${esc(prod.label)})</td><td>${fmt(exworks)}/MT</td></tr>
        <tr><td>Freight to ${esc(city)}</td><td>quoted on address confirmation</td></tr>
        <tr class="pr-tot"><td>Delivered price</td><td>ex-works + freight + GST</td></tr></table>
        <p class="pr-fine">Share your exact delivery point and we will confirm a delivered ₹/MT within the day.</p>`;
  const volBlock = (tpm > 0 && delivered)
    ? `<div class="pr-earn"><div><div class="pr-earn-l">Estimated monthly supply value at ${tpm} MT/month</div><div class="pr-earn-s">Delivered ${fmt(delivered)}/MT × ${tpm} MT (indicative)</div></div><div class="pr-earn-v">${fmt(delivered * tpm)}</div></div>`
    : '';
  const back = document.createElement('div');
  back.className = 'pr-back'; back.id = 'prBack';
  back.innerHTML = `<div class="pr-bar"><button class="pr-close" id="prClose">← Back to lead</button><button class="ql-btn ql-btn-primary" id="prPrint">${IC_PRINT}Print / Save PDF</button></div>
    <div class="pr-doc" id="prDoc">
      <div class="pr-head"><div><div class="pr-brand">${esc(seller)}</div><div class="pr-brand-s">Quick Lime · Hydrated Lime · Limestone — ${esc(co.city || 'Gotan, Rajasthan')}</div></div>
        <div class="pr-meta">Lime Supply Proposal</div></div>
      <hr class="pr-hr">
      <h1 class="pr-h1">Lime Supply Proposal for ${esc(r.name || 'your plant')}</h1>
      <p class="pr-lede">Dear Partner, thank you for considering ${esc(seller)}. This proposal outlines how we can supply consistent-quality lime to ${esc(r.name || 'your plant')}${r.city ? ' (' + esc(r.city) + ')' : ''} with reliable dispatch and a delivered price quoted upfront — freight included.</p>
      <h2 class="pr-h2">Delivered pricing</h2>
      ${priceBlock}
      ${volBlock}
      <h2 class="pr-h2">What you get</h2>
      <ul class="pr-ul"><li>Consistent CaO %, tested every batch, with a test certificate per dispatch</li><li>Reliable bulk dispatch across India (loose / jumbo / small bags)</li><li>A delivered ₹/MT quoted upfront — no surprise freight</li><li>GST-compliant billing & documentation</li></ul>
      <h2 class="pr-h2">Terms</h2>
      <ul class="pr-ul"><li>Grades & quantities per your requirement; minimum order by vehicle load</li><li>Dispatch schedule agreed on confirmation</li><li>Payment terms as mutually agreed</li></ul>
      <p class="pr-sign">We look forward to supplying you.<br><b>${esc(seller)}</b>${co.phone ? ' · ' + esc(co.phone) : ''}</p>
    </div>`;
  document.body.appendChild(back);
  document.getElementById('prClose').addEventListener('click', () => back.remove());
  document.getElementById('prPrint').addEventListener('click', () => window.print());
  const onKey = e => { if (e.key === 'Escape') { back.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

/* ═══ ONBOARDING LINK — generate a no-login link the buyer uses to submit its
   GST/license/bank details + documents directly (server: /api/onboard). ═══ */
async function openOnboardLink(r) {
  r = r || {};
  const p = JSON.parse(localStorage.getItem('ql_plant') || '{}');
  const res = await fetch('/api/onboard', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', plant_id: p.id, company_id: Q ? Q.activeCo : '', token: p.token, lead_name: r.name || '', crm_lead_id: r.id || '' }) })
    .then(x => x.json()).catch(() => ({ ok: false, error: 'Network error' }));
  if (!res || !res.ok) { toast((res && res.error) || 'Could not create link', 'err'); return; }
  const url = res.url;
  QLShell.panel({ title: 'Onboarding link — ' + (r.name || ''), body:
    '<div class="mi-sub" style="margin-bottom:10px">Share this no-login link so ' + esc(r.name || 'the buyer') + ' uploads its GST, license, bank details &amp; documents directly.</div>'
    + '<input id="obUrl" class="os-input" readonly value="' + esc(url) + '" style="width:100%;margin-bottom:12px">'
    + '<div style="display:flex;gap:8px"><button class="ql-btn ql-btn-primary" id="obCopyLink" type="button">Copy link</button><button class="ql-btn ql-btn-secondary" id="obWaLink" type="button">Share on WhatsApp</button></div>' });
  const u = document.getElementById('obUrl');
  const c = document.getElementById('obCopyLink'); if (c) c.addEventListener('click', () => { if (u) u.select(); (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied')).catch(() => { try { document.execCommand('copy'); } catch (_) {} toast('Link copied'); }); });
  const w = document.getElementById('obWaLink'); if (w) w.addEventListener('click', () => { const msg = 'Please complete your onboarding with us here: ' + url; const WA = window.WACore; const link = (WA && WA.waLink) ? WA.waLink(r.phone || '', msg) : 'https://wa.me/?text=' + encodeURIComponent(msg); window.open(link, '_blank', 'noopener'); });
}

function assessBody(points, approach, note) {
  return `<div class="la-assess">
    ${points.map(p => `<div class="la-row"><span class="la-k">${esc(p.k)}</span><span class="la-v">${esc(p.v)}</span></div>`).join('')}
    <div class="la-approach"><b>How to approach:</b> ${esc(approach)}</div>
    <div class="la-note">${note}</div>
  </div>`;
}

/* Assess — LIVE Claude when a provider key is set on the server, else the local
   rule-based briefing (lead-actions.js). The server answers instantly with a
   fallback flag when there's no key, so the "Thinking…" state only shows when
   Claude is genuinely running. */
async function openAssess(r) {
  if (!r || !LA) return;
  const sub = r.city || r.address || '';
  QLShell.panel({ title: 'Assess — ' + r.name, sub, body: '<div class="la-note">Analysing this lead…</div>' });
  const resp = await api({ action: 'assess', lead: leadPayload(r), product: (typeof MI !== 'undefined' && MI.product) || 'quick', seller: sellerInfo() }, { timeout: 60000 });

  let points, approach, note;
  if (resp && resp.ok && resp.data) {
    const d = resp.data;
    points = (d.points || []).map(p => ({ k: p.label || p.k || '', v: p.value || p.v || '' }));
    if (d.summary) points.unshift({ k: 'Verdict', v: d.summary });
    approach = d.approach || '';
    note = 'Live analysis by Claude (' + esc(resp.model || resp.provider || 'AI') + ').';
  } else {
    const a = LA.assess(r, LM ? LM.INDUSTRIES : [], fitOf(r));
    points = [{ k: 'Industry', v: a.industry + (a.matched ? '' : ' (unconfirmed)') }].concat(a.points);
    approach = a.approach;
    note = (resp && resp.error && resp.error !== 'llm_not_configured')
      ? 'Live AI was unavailable, so this is the built-in rule-based read.'
      : 'Built from your Market Intelligence playbook — local rules, no AI key needed. Add an Anthropic key in Settings to upgrade this to live Claude analysis.';
  }
  QLShell.panel({ title: 'Assess — ' + r.name, sub, body: assessBody(points, approach, note),
    actions: [{ label: 'Draft a message', primary: true, onClick: () => { QLShell.closeModal(); openOutreachDraft(r); } }] });
}

/* Message — a ready outreach draft the user reviews, then sends themselves via
   WhatsApp or email (we never auto-send). Falls back to copy when there is no
   contact on file. */
/* ═══ OUTREACH STUDIO — the ZOG-style composer. Channel (Email/WhatsApp) ×
   type (Intro/Follow-up/Proposal/Meeting), editable, with local refiner chips
   (Improve/Shorten/Personalize/Professional). All lime-framed via LA.compose.
   Copy / Open-in-email / Open-in-WhatsApp; wa-core owns the recipient. ═══ */
function openStudio(r) {
  if (!r || !LA || !LA.compose) return;
  const seller = sellerInfo();
  const inds = LM ? LM.INDUSTRIES : [];
  const WA = window.WACore;
  const waOk = waReachable(r.phone);
  let ch = waOk ? 'whatsapp' : (r.email ? 'email' : 'whatsapp');
  let type = 'intro';
  const TYPES = [['intro', 'Intro'], ['followup', 'Follow-up'], ['proposal', 'Proposal'], ['meeting', 'Meeting']];
  const REFS = [['improve', 'Improve'], ['shorten', 'Shorten'], ['personalize', 'Personalize'], ['professional', 'Professional tone']];
  const back = document.createElement('div');
  back.className = 'os-back'; back.id = 'osBack';
  back.innerHTML = `<div class="os-modal" role="dialog" aria-modal="true" aria-label="Outreach Studio">
    <div class="os-head"><div class="os-head-ic">${IC_SPARK}</div>
      <div class="os-head-t"><div class="os-title">Outreach Studio</div><div class="os-sub" id="osEngine">Writing for ${esc(r.name || '')}…</div></div>
      <button class="os-x" id="osX" aria-label="Close">×</button></div>
    <div class="os-chan">
      <button class="os-chan-b" data-ch="email">${IC_MAIL}Email</button>
      <button class="os-chan-b" data-ch="whatsapp">${IC_WA}WhatsApp</button></div>
    <div class="os-types">${TYPES.map(t => `<button class="os-type" data-type="${t[0]}">${t[1]}</button>`).join('')}</div>
    <div class="os-field os-subj-wrap"><label>Subject</label><input id="osSubj" class="os-input"></div>
    <div class="os-field"><label>Message</label><textarea id="osMsg" class="os-textarea" rows="9"></textarea></div>
    <div class="os-refiners">${REFS.map(x => `<button class="os-ref" data-ref="${x[0]}">${x[1]}</button>`).join('')}</div>
    <div class="os-foot"><button class="ql-btn ql-btn-secondary" id="osCopy" type="button">Copy</button>
      <button class="ql-btn ql-btn-primary" id="osOpen" type="button"></button></div></div>`;
  document.body.appendChild(back);
  const $$ = s => back.querySelector(s);
  const subj = $$('#osSubj'), msg = $$('#osMsg');
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', e => { if (e.target === back) close(); });
  $$('#osX').addEventListener('click', close);
  function paint() {
    back.querySelectorAll('.os-chan-b').forEach(b => b.classList.toggle('on', b.dataset.ch === ch));
    back.querySelectorAll('.os-type').forEach(b => b.classList.toggle('on', b.dataset.type === type));
    $$('.os-subj-wrap').style.display = ch === 'email' ? 'block' : 'none';
    const ob = $$('#osOpen'); ob.textContent = ch === 'email' ? 'Open in email' : 'Open WhatsApp'; ob.classList.toggle('os-wa', ch === 'whatsapp');
  }
  /* THE MESSAGE ENGINE. /api/discover has had a real LLM writer behind
     action:'message' since it was built and NOTHING ever called it — which is
     why every draft came out of the local template and the refine chips only
     ever swapped a few words. The server is tried first; the template is the
     fallback, not the product.

     The subtitle always says which one you are reading. A template presented
     as "AI-personalised" is the kind of small lie that costs trust in front of
     a customer. */
  const engineEl = $$('#osEngine');
  let busy = false;
  function setEngine(txt, spin) { if (engineEl) engineEl.innerHTML = (spin ? '<span class="dc-spin"></span> ' : '') + esc(txt); }
  function localDraft() { const c = LA.compose(r, seller, inds, { channel: ch, type }); subj.value = c.subject; msg.value = c.text; paint(); return c; }

  async function serverDraft(refine) {
    if (busy) return false;
    busy = true; setEngine(refine ? 'Rewriting…' : 'Writing a fresh message…', true);
    let ok = false;
    try {
      const resp = await api({ action: 'message', lead: leadPayload(r), seller: sellerInfo(),
        product: (typeof MI !== 'undefined' && MI.product) || 'quick',
        type, channel: ch, refine: refine || '', text: refine ? msg.value : '' }, { timeout: 60000 });
      const t = resp && resp.ok && resp.data && String(resp.data.message || '').trim();
      if (t) { msg.value = t; setEngine('Written by AI · ' + (resp.model || resp.provider || 'model')); ok = true; }
      else if (resp && resp.error === 'llm_not_configured') setEngine('Smart template — no AI key set in Settings');
      else setEngine('Smart template — AI unavailable' + (resp && resp.error ? ' (' + resp.error + ')' : ''));
    } catch (_) { setEngine('Smart template — AI unavailable'); }
    busy = false;
    return ok;
  }

  async function regen() { localDraft(); await serverDraft(''); }

  back.querySelectorAll('.os-chan-b').forEach(b => b.addEventListener('click', () => { ch = b.dataset.ch; regen(); }));
  back.querySelectorAll('.os-type').forEach(b => b.addEventListener('click', () => { type = b.dataset.type; regen(); }));
  back.querySelectorAll('.os-ref').forEach(b => b.addEventListener('click', async () => {
    const before = msg.value;
    const done = await serverDraft(b.dataset.ref);
    /* Without a key the chips still do something honest — the local transform,
       labelled as one — instead of appearing broken. */
    if (!done) { msg.value = LA.refine(before, b.dataset.ref, r); setEngine('Smart template — edited locally'); }
  }));
  $$('#osCopy').addEventListener('click', () => {
    const t = (ch === 'email' && subj.value ? subj.value + '\n\n' : '') + msg.value;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('Copied')).catch(() => { msg.select(); document.execCommand('copy'); toast('Copied'); });
  });
  $$('#osOpen').addEventListener('click', () => {
    if (ch === 'whatsapp') { const url = (WA && WA.waLink) ? WA.waLink(r.phone || '', msg.value) : 'https://wa.me/?text=' + encodeURIComponent(msg.value); window.open(url, '_blank', 'noopener'); }
    else { window.location.href = 'mailto:' + encodeURIComponent(r.email || '') + '?subject=' + encodeURIComponent(subj.value) + '&body=' + encodeURIComponent(msg.value); }
    /* An OPENED draft, not a delivered message — the board labels it that way. */
    logTouch({ kind: ch === 'whatsapp' ? 'whatsapp' : 'email', crm_company: r.crm_company, crm_lead: r.crm_lead,
      body: (ch === 'email' && subj.value ? subj.value + ' — ' : '') + msg.value });
  });
  regen();
}
/* MESSAGE now opens QuickLimes' OWN conversation for this business, not an
   outreach draft that ends at wa.me. The conversation is identified by the
   business's place id, so clicking Message twice opens the SAME thread — the
   server has a unique index on that key, so even two fast clicks cannot make
   two conversations.

   The AI outreach composer is not lost: it is still available as "Draft" from
   the row menu, for the user who wants a first message written for them. What
   changed is which one is the primary action. */
function openMessage(r) {
  if (!r) return;
  if (!window.QLIM || !window.QLChatCore) { openStudio(r); return; }
  QLIM.openFor({
    kind: 'business',
    id: r.id || r.place_id || '',
    name: r.name || '',
    industry: r.industry_label || r.industry || '',
    city: r.city || r.state || '',
    meta: {
      phone: r.phone || '', website: r.website || '', address: r.address || '',
      city: r.city || '', industry: r.industry_label || r.industry || '',
      rating: r.rating || '', placeId: r.place_id || r.id || '', source: r.source || 'discover',
      leadId: r.crm_lead_id || r.lead_id || ''
    }
  });
}
/* The old behaviour, kept and reachable. */
function openOutreachDraft(r) { openStudio(r); }

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
  if (typeof switchSection === 'function') switchSection('leads');   // a search always lands on results

  /* A whole STATE is too heavy for the free Overpass service (it times out), so
     when the target is a state we fan the search across its industrial HUB
     CITIES instead — fast, and where the plants actually are. A plain city is
     searched directly. */
  const st = LM && LM.stateByName(city);
  const targets = st ? LM.hubsFor(city, 3) : [city];
  const stateLabel = st ? city : '';

  const btn = document.getElementById('dcGo'); const label = btn.textContent;
  btn.disabled = true; btn.classList.add('is-busy');

  let added = 0, dupes = 0, seen = 0, okAny = false, lastErr = '', lastRetry = false, fellBack = false;
  for (let i = 0; i < targets.length; i++) {
    /* A SPINNER, not just a word. "Searching…" alone reads as frozen on a slow
       source; a moving indicator is the difference between "it is working" and
       "it has hung". The label still says WHERE, so multi-hub runs show progress. */
    btn.innerHTML = '<span class="dc-spin" aria-hidden="true"></span>' +
      esc(targets.length > 1 ? `Searching ${targets[i]}… (${i + 1}/${targets.length})` : 'Searching…');
    if (stateLabel) notice(`Searching <b>${esc(stateLabel)}</b> across its industrial hubs: ${targets.map((t, j) => j <= i ? '<b>' + esc(t) + '</b>' : esc(t)).join(' · ')}`);
    const r = await discoverOne(what, targets[i], radius, indLabel);
    if (r.ok) { okAny = true; added += r.added || 0; dupes += r.dupes || 0; seen += r.seen || 0; if (r.radius_fell_back) fellBack = true; }
    else { lastErr = r.error || 'unknown error'; lastRetry = !!r.retry; if (r.not_configured) { lastErr = r.error; lastRetry = false; okAny = false; break; } }
  }
  btn.disabled = false; btn.classList.remove('is-busy'); btn.textContent = label;

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
  else if (added === 0 && dupes === 0 && seen > 0) {
    /* THE SOURCE FOUND BUSINESSES — every one of them is already in your list from
       an earlier search. Calling that "no matches" was flatly wrong and made a
       working source look broken. Say what actually happened, and point at them. */
    notice('Found <b>' + seen + '</b> business' + (seen === 1 ? '' : 'es') + ' for <b>' + esc(tag) + '</b> — all of them are <b>already in your list</b> from an earlier search, so nothing new was added. They are in the tabs below. Search a different city to find more.');
  }
  else if (added === 0 && dupes === 0) {
    /* Reached the source fine but it genuinely returned nothing. Name the source
       that was ACTUALLY used — this said "OpenStreetMap" even when the search ran
       on Mapbox, which reads as a broken app. */
    const srcName = SRC === 'mapbox' ? 'Mapbox' : SRC === 'google' ? 'Google Maps' : 'OpenStreetMap';
    const thin = SRC === 'osm' ? ' — its coverage of Indian industry is thin, so this rarely means the businesses don’t exist' : '';
    const nextTry = SRC === 'osm' && SOURCES.mapbox ? ' Try the <b>Mapbox</b> source above — it has better Indian coverage.'
      : ' Try a nearby city or a broader trade word (e.g. “paper” instead of “paper mill”).';
    notice('No matches in ' + srcName + ' for <b>' + esc(tag) + '</b>' + thin + '.' + nextTry, true);
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
    SOURCES = { osm: !!r.osm, google: !!r.google, mapbox: !!r.mapbox };
    /* No basemap to swap any more — the demand map draws India itself. */
    /* AUTO-PICK THE FAST SOURCE. The free Overpass service waits ~20s per mirror
       and frequently fails — landing on it by default made every first search
       feel broken while a connected, 1-3s source sat one click away. Google is
       richest, Mapbox next, OSM last. Only when the user has PINNED a source
       (by clicking one) do we leave their choice alone. */
    if (!SRC_PINNED) SRC = SOURCES.google ? 'google' : (SOURCES.mapbox ? 'mapbox' : 'osm');
    if ((SRC === 'google' && !SOURCES.google) || (SRC === 'mapbox' && !SOURCES.mapbox)) SRC = 'osm';   // never sit on a dead source
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
  /* SHOW THE MISMATCH instead of an empty page. If the plant HAS discovered rows
     but none under the company this page is asking for, the list is empty for a
     reason the user can act on — say it, with the numbers. */
  const dg = r.diag;
  /* ALWAYS report when the list is empty — whatever the reason. An empty page
     that explains nothing is what wasted the user's day. */
  if (dg && ROWS.length === 0 && !(dg.plant > 0)) {
    notice('The list is empty and your account has <b>0</b> saved businesses under company <b>' + esc(dg.company_id || '(blank)') + '</b>. If a search just said “already in your list”, those rows were stored under a different company — tell me and I will move them.', true);
  }
  if (dg && dg.plant > 0 && dg.scope === 0) {
    const others = dg.other_ids || [];
    const ids = others.map(o => (o.company_id === '' ? '(blank)' : o.company_id) + ' → ' + o.c + ' rows').join(' · ');
    /* "Tell me and I will move them" used to be a sentence with nothing behind
       it. Now the biggest holding gets a button, because switching company in
       the header is not what the user wants when THIS is their main company. */
    const big = others.slice().sort((a, b) => (b.c || 0) - (a.c || 0))[0];
    const btn = big ? ' <button class="dc-move" data-move-from="' + esc(big.company_id) + '" data-move-n="' + big.c + '">Move ' + big.c + ' businesses to this company</button>' : '';
    notice('You have <b>' + dg.plant + '</b> discovered businesses saved, but none under the company this page is asking for (<b>' + esc(dg.company_id || '(blank)') + '</b>).'
      + (ids ? ' They are stored under: <b>' + esc(ids) + '</b>.' : '')
      + ' Switch company from the header, or move them here.' + btn, true);
    const mv = document.querySelector('[data-move-from]');
    if (mv) mv.onclick = async () => {
      const n = mv.dataset.moveN;
      if (!confirm('Move ' + n + ' discovered businesses into this company?\n\nThey stay in your account either way — this only changes which company they are filed under.')) return;
      mv.disabled = true; mv.textContent = 'Moving…';
      const res = await api({ action: 'move', from: mv.dataset.moveFrom });
      if (!res || !res.ok) { mv.disabled = false; mv.textContent = 'Move ' + n + ' businesses to this company'; toast((res && res.error) || 'Could not move them', 'err'); return; }
      toast('Moved ' + res.moved + ' businesses here' + (res.skipped ? ' · ' + res.skipped + ' left behind as duplicates' : ''));
      await load();
    };
  }
  paintKpis(); paintTabs(); paintTable();
  renderHero(); renderCopilot();   // real counts + the recommendation reflect the loaded data
}

/* ═══ Phase 1 — AI-first hero, Copilot, and progressive-disclosure sections ═══ */
function greetName() {
  try { const p = JSON.parse(localStorage.getItem('ql_plant') || '{}'); if (p.user && p.user.name) return p.user.name; } catch (_) {}
  const c = (Q && Q.co) || {}; return c.ownerName || (c.short || '').split(' ')[0] || '';
}
function timeGreeting() { const h = new Date().getHours(); return h < 5 ? 'Assalamu Alaikum' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function baseIndustry(label) { return String(label || '').replace(/ (Plants|Mills|Manufacturers|Industries|Companies|Refineries|Smelters|Units)$/, ''); }
/* The best non-home market for the current product, at the current freight/price. */
function topMarket() {
  if (!LM) return null;
  const plan = LM.plan(MI.product, { origin: miOriginCoords(), freightRate: MI.rate, exWorks: miEx() });
  return plan.find(r => r.state !== 'Rajasthan') || plan[0] || null;
}

/* Hero — greeting by name + REAL pipeline counts + one labelled market estimate. */
function renderHero() {
  const g = document.getElementById('dcHeroGreet'); if (!g) return;
  const nm = greetName();
  g.innerHTML = (nm ? esc(timeGreeting() + ', ' + nm) : 'Lead Discovery') + ' <span style="font-weight:400">👋</span>';
  const hot = ROWS.filter(r => r.status === 'new' && (fitOf(r).score || 0) >= 75).length;
  const tm = topMarket();
  const stats = [[(COUNTS.new || 0), 'new candidates', ''], [hot, 'hot · fit ≥ 75', 'hot'], [(COUNTS.promoted || 0), 'promoted', '']];
  let html = stats.map(([n, l, c]) => `<span class="dc-stat ${c}"><b>${n}</b><span>${l}</span></span>`).join('');
  if (tm) html += `<span class="dc-stat est" title="Industry estimate, not a quote"><b>${esc(tm.state)}</b><span>top market · est. ₹${(tm.deliveredPerTonne || 0).toLocaleString('en-IN')}/t delivered</span></span>`;
  const stEl = document.getElementById('dcHeroStats'); if (stEl) stEl.innerHTML = html;
  const n = document.getElementById('dcSecLeadsN'); if (n) n.textContent = COUNTS.new || '';
}

/* AI Copilot — a live recommendation off the market brain. Real computed rupees,
   never a fabricated confidence %; every figure is a labelled estimate. */
function renderCopilot() {
  const host = document.getElementById('dcCopilot'); if (!host || !LM) return;
  const opts = { origin: miOriginCoords(), freightRate: MI.rate, exWorks: miEx() };
  const plan = LM.plan(MI.product, opts).filter(r => r.state !== 'Rajasthan');
  const tm = plan[0]; if (!tm) { host.innerHTML = ''; return; }
  const prod = (LM.PRODUCTS.find(p => p.key === MI.product) || {}).label || 'lime';
  const topInd = tm.industries[0] || {};
  const profit = tm.profit ? tm.profit.label : '';
  host.innerHTML = `<div class="cp">
    <div class="cp-top">
      <div class="cp-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/></svg>AI Sales Copilot</div>
      <div class="cp-head">${esc(timeGreeting())}. Your best-margin market for ${esc(prod)} right now is <b>${esc(tm.state)}</b>.</div>
      <div class="cp-why">${esc(tm.tier.label)} · ${tm.km} km · freight ${tm.freightSharePct != null ? tm.freightSharePct + '% of your price' : '₹' + tm.freightPerTonne + '/t'}${profit ? ' · ' + esc(profit) : ''}. Ranked on demand balanced against freight from ${esc(miOriginCoords().name)}.</div>
    </div>
    <div class="cp-metrics">
      <div class="cp-metric"><div class="l">Delivered cost</div><div class="v">₹${(tm.deliveredPerTonne || 0).toLocaleString('en-IN')}</div><div class="s">per tonne · est.</div></div>
      <div class="cp-metric"><div class="l">Freight share</div><div class="v ${tm.freightSharePct != null && tm.freightSharePct <= 40 ? 'good' : ''}">${tm.freightSharePct != null ? tm.freightSharePct + '%' : '—'}</div><div class="s">of ex-works price</div></div>
      <div class="cp-metric"><div class="l">Top buyers</div><div class="v" style="font-size:14px">${esc(baseIndustry(topInd.label || '—'))}</div><div class="s">demand-ranked</div></div>
      <div class="cp-metric"><div class="l">Opportunity</div><div class="v">${tm.score}<span style="font-size:12px;color:var(--ql-text-muted)">/100</span></div><div class="s">demand × reach</div></div>
    </div>
    <div class="cp-list">${plan.slice(0, 4).map((r, i) => `<div class="cp-li"><span class="rk">${i + 1}</span><span class="mkt">${esc(r.state)}</span><span class="pl">${esc(r.tier.label)} · ₹${(r.deliveredPerTonne || 0).toLocaleString('en-IN')}/t</span><button class="go" data-cp-find data-what="${esc(LM.osmTerm((r.industries[0] || {}).key))}" data-state="${esc(r.state)}">Find buyers</button></div>`).join('')}</div>
    <div class="cp-actions">
      <button class="ql-btn ql-btn-primary" id="cpFind">Find ${esc(baseIndustry(topInd.label || 'buyers'))} in ${esc(tm.state)}</button>
      <button class="ql-btn ql-btn-secondary" id="cpMarkets">See all markets</button>
      <button class="ql-btn ql-btn-secondary" id="cpLeads">Review leads</button>
    </div>
    <div class="cp-note">Figures are industry estimates that sharpen as you log real sales — never a fabricated confidence score, and it never invents a company or a price.</div>
  </div>`;
  host.querySelectorAll('[data-cp-find]').forEach(b => b.onclick = () => findInMarket(b.dataset.what, b.dataset.state));
  const f = document.getElementById('cpFind'); if (f) f.onclick = () => findInMarket(LM.osmTerm(topInd.key), tm.state);
  const m = document.getElementById('cpMarkets'); if (m) m.onclick = () => switchSection('markets');
  const l = document.getElementById('cpLeads'); if (l) l.onclick = () => switchSection('leads');
}

/* India demand map — states plotted at their real centroids, coloured by the
   same demand×freight score the rest of the page uses. A schematic (positioned
   by coordinate, not exact borders), honest and computed. Click → discover. */
const STATE_ABBR = { Gujarat: 'GJ', Maharashtra: 'MH', Chhattisgarh: 'CG', Odisha: 'OD', 'Tamil Nadu': 'TN', Karnataka: 'KA', 'Uttar Pradesh': 'UP', 'Andhra Pradesh': 'AP', Telangana: 'TG', Jharkhand: 'JH', 'West Bengal': 'WB', 'Madhya Pradesh': 'MP', Punjab: 'PB', Haryana: 'HR', Rajasthan: 'RJ' };
function hmTierColor(r) {
  const k = r.profit ? r.profit.key : (r.score >= 45 ? 'strong' : r.score >= 30 ? 'workable' : r.score >= 15 ? 'thin' : 'unviable');
  return ({ strong: ['#16a34a', '#dcfce7'], workable: ['#0369a1', '#e0f2fe'], thin: ['#b45309', '#fff7ed'], unviable: ['#dc2626', '#fef2f2'] })[k] || ['#64748b', '#f1f5f9'];
}
/* India demand map — a REAL interactive map (Leaflet + OpenStreetMap/CARTO
   tiles): pan / zoom / scroll like Google Maps, with each demand state shaded by
   its live profit tier on top and the plant marked. Click a state → discover
   buyers there. Falls back to a message if Leaflet can't load (offline). */
let HM_MAP = null, HM_LAYER = null, HM_FITTED = false, HM_BOUNDS = null;
function ringsToLatLng(rings) {
  return rings.map(fl => { const a = []; for (let i = 0; i < fl.length; i += 2) a.push([fl[i + 1], fl[i]]); return a; });
}
function renderHeatMap() {
  const host = document.getElementById('dcMap'); if (!host || !LM) return;
  const geo = window.INDIA_GEO;
  if (!window.L || !geo) { host.innerHTML = '<div class="mi-sub" style="padding:24px">Interactive map unavailable — check your connection.</div>'; return; }
  const opts = { origin: miOriginCoords(), freightRate: MI.rate, exWorks: miEx() };
  const origin = miOriginCoords();
  const byState = {}; LM.plan(MI.product, opts).forEach(r => { byState[r.state] = r; });

  if (!HM_MAP) {
    /* NO BASEMAP, INDIA ONLY. A world raster under an India choropleth is why
       this kept coming back as "still showing world map": the state polygons
       only cover India and every pixel around them was Pakistan, China, the
       Gulf and South-East Asia. No clamp fixes that — India's bbox is roughly
       square and this card is wide, so fitting India's height always leaves
       ~69° of longitude to fill with neighbours. Drawing the states from
       INDIA_GEO on the card background is the only thing that actually answers
       "only India"; it also drops a per-view tile bill and stops a third party
       drawing this country's borders for us.

       ORIGINAL NOTE, still true of the clamp: Fitting the India bbox into a very wide container letterboxes
       horizontally and fills the spare width with Pakistan, China, the Gulf and
       South-East Asia — a map of Asia with a few Indian labels on it. maxBounds
       hard-clips the view to the subcontinent and stops the user panning away;
       fitBounds then fills the SHORTER axis so India dominates the frame. */
    HM_MAP = L.map(host, { zoomControl: true, scrollWheelZoom: true, attributionControl: false,
      minZoom: 3, maxZoom: 11, maxBounds: INDIA_BBOX, maxBoundsViscosity: 1 }).setView([22.8, 80.5], 5);
    HM_LAYER = L.layerGroup().addTo(HM_MAP);
  }
  HM_LAYER.clearLayers();
  for (const nm in geo) {
    const g = geo[nm]; const r = byState[nm];
    const latlngs = ringsToLatLng(g.r);
    // No stroke → the state's district rings tile into one clean filled region
    // (adjacent same-colour districts show no seam); colour change marks the border.
    /* ONE POLYGON PER RING, never one polygon holding every ring. g.r is a
       state's DISTRICT rings; handing them to a single L.polygon makes Leaflet
       treat all but the first as HOLES, so the fill cancels itself out and the
       state renders as bare hairlines. The basemap used to hide that; without
       it the map came out as an outline drawing. */
    const drawRings = (style) => latlngs.map(ring => L.polygon(ring, style).addTo(HM_LAYER));
    if (!r) { drawRings({ color: '#cbd5e1', weight: .5, fillColor: '#e2e8f0', fillOpacity: .95, interactive: false }); continue; }
    const [stroke, fill] = hmTierColor(r);
    const parts = drawRings({ color: stroke, weight: .5, opacity: .35, fillColor: stroke, fillOpacity: .78 });
    const poly = L.featureGroup(parts);
    const tip = '<b>' + esc(nm) + '</b> · score ' + r.score + '<br>₹' + (r.deliveredPerTonne || 0).toLocaleString('en-IN') + '/t delivered · ' + esc(r.tier.label);
    poly.bindTooltip(tip, { className: 'hm-tt', sticky: true });
    const what = LM.osmTerm((r.industries[0] || {}).key);
    poly.on('click', () => findInMarket(what, nm));
    poly.on('mouseover', () => poly.setStyle({ fillOpacity: .95 }));
    poly.on('mouseout', () => poly.setStyle({ fillOpacity: .78 }));
    const c = LM.STATES.find(s => s.name === nm);
    if (c) {
      const ab = g.a || STATE_ABBR[nm] || nm.slice(0, 2).toUpperCase();
      L.marker([c.lat, c.lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'hm-lbl', html: '<b>' + ab + '</b><i>' + r.score + '</i>', iconSize: [30, 26] }) }).addTo(HM_LAYER);
    }
  }
  // Plant marker — always on top.
  L.circleMarker([origin.lat, origin.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#0f172a', fillOpacity: 1 })
    .addTo(HM_LAYER).bindTooltip('▲ ' + esc(origin.name.split(',')[0]) + ' — your plant', { className: 'hm-tt', direction: 'top' });
  // Fit to a fixed India view once the container is actually visible + sized.
  if (!HM_FITTED && host.offsetParent) { HM_MAP.invalidateSize(); HM_MAP.fitBounds(INDIA_BBOX); HM_MAP.setMinZoom(HM_MAP.getZoom()); HM_FITTED = true; }
}
const INDIA_BBOX = [[6.7, 68.0], [35.6, 97.4]];
/* Leaflet needs a size recalc + first fit once its container becomes visible (it
   was hidden under another section tab when the map was created at 0×0). */
function hmOnShow() {
  if (!HM_MAP) return;
  setTimeout(() => {
    try {
      HM_MAP.invalidateSize();
      if (!HM_FITTED) { HM_MAP.fitBounds(INDIA_BBOX); HM_MAP.setMinZoom(HM_MAP.getZoom()); HM_FITTED = true; }
    } catch (_) {}
  }, 80);
}

/* Progressive disclosure: exactly one section visible at a time. */
function switchSection(name) {
  ['copilot', 'markets', 'leads', 'freight', 'pipeline'].forEach(s => {
    const el = document.getElementById('sec' + s.charAt(0).toUpperCase() + s.slice(1));
    if (el) el.hidden = (s !== name);
  });
  document.querySelectorAll('#dcSecTabs .dc-sectab').forEach(b => b.classList.toggle('active', b.dataset.sec === name));
  try { localStorage.setItem('ql_dc_sec', name); } catch (_) {}
  document.dispatchEvent(new CustomEvent('ql-section', { detail: name }));
  if (name === 'markets') hmOnShow();
  if (name === 'freight' && window.FreightUI) FreightUI.init();
  if (name === 'pipeline' && typeof renderPipeline === 'function') renderPipeline();
}

/* Pasting a list is the no-key path — the same ranked import the pipeline uses. */
function openPaste() {
  if (window.location) window.location.href = 'crm.html';
}

/* ═══ PIPELINE tab — the full Sales Pipeline board, embedded in Lead Discovery.
   Reuses crm-core.js (the tested pipeline rules + forecast) and /api/crm, so the
   money maths match the standalone CRM exactly. View + add + stage-move here;
   deep multi-field edits still open cleanly through the same form. ═══ */
let PIPE = { companies: [], contacts: [], leads: [], activities: [] }, PIPE_LOADED = false, PIPE_SEARCH = '', PIPE_TEMP = 'all';
function pipeApi(body) {
  const p = JSON.parse(localStorage.getItem('ql_plant') || '{}');
  return fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ plant_id: p.id, company_id: Q ? Q.activeCo : undefined, token: p.token }, body)) })
    .then(r => r.json()).catch(() => ({ ok: false, error: 'Network error' }));
}
function pipeCoOf(id) { return PIPE.companies.find(c => +c.id === +id) || {}; }
function pipeFmt(n) { return n == null || !isFinite(n) ? '—' : '₹' + Math.round(n).toLocaleString('en-IN'); }
/* Temperature from the lead's ICP fit score (margin-based). Unscored stays
   honest — no fake heat. Hot/Warm/Cold thresholds mirror the discovery fit tiers. */
function pipeTemp(l) {
  const s = (l && l.score != null && isFinite(l.score)) ? +l.score : null;
  if (s == null) return { key: 'none', label: 'Unscored', c: '#94a3b8', bg: '#f1f5f9' };
  if (s >= 67) return { key: 'hot', label: 'Hot', c: '#dc2626', bg: '#fef2f2' };
  if (s >= 34) return { key: 'warm', label: 'Warm', c: '#b45309', bg: '#fff7ed' };
  return { key: 'cold', label: 'Cold', c: '#0284c7', bg: '#eff6ff' };
}
function pipeKpi(icon, label, value, tone) {
  return '<div class="pk-card"><div class="pk-ic" style="background:' + (tone ? tone[1] : 'var(--ql-brand-50,#eff6ff)') + ';color:' + (tone ? tone[0] : 'var(--ql-brand-600,#2563eb)') + '">' + icon + '</div>'
    + '<div class="pk-l">' + label + '</div><div class="pk-v">' + value + '</div></div>';
}
/* ═══ TOUCH LOG ═══════════════════════════════════════════════════════════
   crm_activities has existed (with a working /api/crm write endpoint) since
   the CRM was built, and NOTHING ever wrote to it. Every outreach the user
   opens from this app now lands there, so the acquisition board counts real
   events instead of guesses.

   What this can and cannot know: opening a WhatsApp draft or a mailto: is an
   ATTEMPT. Delivery and replies are invisible to us — no connected channel
   observes them — so nothing here is ever labelled "sent" or "replied". */
async function logTouch(a) {
  try {
    const r = await pipeApi({ action: 'activity', activity: {
      crm_company: a.crm_company || 0, crm_lead: a.crm_lead || null,
      kind: a.kind || 'note', direction: a.direction || 'out', body: String(a.body || '').slice(0, 2000)
    } });
    if (r && r.ok) { PIPE_LOADED = false; return true; }
    toast((r && r.error) || 'Could not log that touch', 'err');
  } catch (_) { toast('Could not log that touch', 'err'); }
  return false;
}
function actLabel(k) {
  return k === 'whatsapp' ? 'WhatsApp draft' : k === 'email' ? 'Email draft' : k === 'proposal' ? 'Proposal'
    : k === 'meeting' ? 'Meeting' : k === 'call' ? 'Call' : 'Note';
}
async function renderPipeline(force) {
  const root = document.getElementById('pipeRoot'); const CC = window.CRMCore;
  if (!root || !CC) { if (root) root.innerHTML = '<div class="pl-empty">Pipeline unavailable.</div>'; return; }
  if (!PIPE_LOADED || force) {
    root.innerHTML = '<div class="pl-empty">Loading pipeline…</div>';
    const r = await pipeApi({ action: 'list' });
    if (r && r.ok) { PIPE = { companies: r.companies || [], contacts: r.contacts || [], leads: r.leads || [], activities: r.activities || [] }; PIPE_LOADED = true; }
    else { root.innerHTML = '<div class="pl-empty">Could not load the pipeline. ' + esc((r && r.error) || '') + '</div>'; return; }
  }
  const all = PIPE.leads;
  const acts = PIPE.activities || [];
  // ── KPI band (all real, derived from the leads) ──
  const temps = all.map(pipeTemp);
  const hot = temps.filter(t => t.key === 'hot').length, warm = temps.filter(t => t.key === 'warm').length, cold = temps.filter(t => t.key === 'cold').length;
  const open = all.filter(l => CC.isOpen(l.stage)).length;
  const won = all.filter(l => l.stage === 'won').length, lost = all.filter(l => l.stage === 'lost').length;
  const f = CC.forecast(all);
  const conv = (won + lost) > 0 ? Math.round(won / (won + lost) * 100) : (won > 0 ? 100 : 0);
  const band = '<div class="pk-band">'
    + pipeKpi(IC_BLDG, 'Total leads', all.length, ['#2563eb', '#eff6ff'])
    + pipeKpi(IC_FLAME, 'Hot', hot, ['#dc2626', '#fef2f2'])
    + pipeKpi(IC_SUN, 'Warm', warm, ['#b45309', '#fff7ed'])
    + pipeKpi(IC_SNOW, 'Cold', cold, ['#0284c7', '#eff6ff'])
    + pipeKpi(IC_LAYERS, 'Open', open, ['#7c3aed', '#f5f3ff'])
    + pipeKpi(IC_TROPHY, 'Won', won, ['#15803d', '#dcfce7'])
    + pipeKpi(IC_RUPEE, 'Pipeline value', pipeFmt(f.gross), ['#0f766e', '#ccfbf1'])
    + pipeKpi(IC_TARGET, 'Conversion', conv + '%', ['#15803d', '#dcfce7'])
    + '</div>';
  /* ── OUTREACH BAND ──────────────────────────────────────────────────────
     Every number here is a row in crm_activities that this app wrote when the
     user did something. There is deliberately NO "emails sent", "delivered" or
     "reply rate": no channel is connected, so nothing in this system can
     observe a delivery or a reply, and a made-up figure in front of a customer
     is worse than an absent one. The wording says "opened", and the footnote
     says why. */
  const nk = k => acts.filter(a => a.kind === k).length;
  const today = new Date().toISOString().slice(0, 10);
  const due = all.filter(l => CC.isOpen(l.stage) && l.next_action_at && String(l.next_action_at).slice(0, 10) <= today).length;
  const band2 = '<div class="pk-band pk-band-2">'
    + pipeKpi(IC_WA, 'WhatsApp drafts opened', nk('whatsapp'), ['#16a34a', '#f0fdf4'])
    + pipeKpi(IC_MAIL, 'Email drafts opened', nk('email'), ['#2563eb', '#eff6ff'])
    + pipeKpi(IC_DOC, 'Proposals generated', nk('proposal'), ['#7c3aed', '#f5f3ff'])
    + pipeKpi(IC_CAL, 'Meetings logged', nk('meeting'), ['#b45309', '#fff7ed'])
    + pipeKpi(IC_PHONE, 'Calls & notes logged', nk('call') + nk('note'), ['#0f766e', '#ccfbf1'])
    + pipeKpi(IC_CLOCK, 'Follow-ups due', due, due ? ['#dc2626', '#fef2f2'] : ['#64748b', '#f1f5f9'])
    + '</div>'
    + '<div class="pk-note">Counted when you open a draft or log a touch here. Delivery and replies are not counted — no email or WhatsApp channel is connected to this app, so nothing can observe them.</div>';
  /* CRMCore.nextActions() has existed since the CRM was written with NOTHING
     calling it, so "follow-ups due" was a number you could not act on. This is
     its caller: the overdue-first call list, straight above the board. */
  const dueList = CC.nextActions ? CC.nextActions(all, today) : [];
  const dueStrip = dueList.length ? '<div class="pd-due"><div class="pd-due-t">' + IC_CLOCK
    + '<span>Follow up now · ' + dueList.length + '</span></div><div class="pd-due-l">'
    + dueList.slice(0, 8).map(x => {
        const c = pipeCoOf(x.lead.crm_company);
        return '<button class="pd-due-i' + (x.overdue ? ' od' : '') + '" data-due="' + x.lead.id + '">'
          + '<b>' + esc(c.name || '—') + '</b><span>' + esc(x.lead.next_action || 'follow up') + '</span>'
          + '<i>' + (x.overdue ? x.days + 'd overdue' : 'today') + '</i></button>';
      }).join('') + '</div></div>' : '';
  // ── controls ──
  const controls = '<div class="pk-controls">'
    + '<input id="plSearch" class="pk-search" placeholder="Search companies, cities, industries…" value="' + esc(PIPE_SEARCH) + '">'
    + '<select id="plTemp" class="pk-sel"><option value="all">All temps</option><option value="hot"' + (PIPE_TEMP === 'hot' ? ' selected' : '') + '>Hot</option><option value="warm"' + (PIPE_TEMP === 'warm' ? ' selected' : '') + '>Warm</option><option value="cold"' + (PIPE_TEMP === 'cold' ? ' selected' : '') + '>Cold</option></select>'
    + '<button class="ql-btn ql-btn-secondary" id="plImport" type="button">Import</button>'
    + '<button class="ql-btn ql-btn-primary" id="plAdd" type="button">+ Add lead</button></div>';
  /* Companies promoted before pipeline rows existed have no lead — the board
     cannot show them. Offer the one-tap backfill instead of a silent gap. */
  const orphanCos = (PIPE.companies || []).filter(c => !(PIPE.leads || []).some(l => +l.crm_company === +c.id));
  const orphanBar = orphanCos.length ? `<div class="pd-due" style="margin-bottom:14px"><div class="pd-due-t">${IC_USERPLUS}<span>${orphanCos.length} promoted compan${orphanCos.length === 1 ? 'y is' : 'ies are'} not on this board</span></div>
    <div class="in-note" style="margin:0 0 8px">They were promoted before the board existed, so no pipeline row was created. Adding them starts each at the New stage, unscored.</div>
    <button class="lr-b pri" id="plBackfill" type="button">${IC_USERPLUS}Add ${orphanCos.length} to the board</button></div>` : '';
  if (!all.length) { root.innerHTML = band + band2 + dueStrip + orphanBar + controls + '<div class="pl-empty">No leads yet. Promote a discovered company from the Leads tab, or add one.</div>'; wirePipe(); return; }
  // ── filtered leads for the board ──
  const q = PIPE_SEARCH.toLowerCase().trim();
  let leads = all.filter(l => {
    if (PIPE_TEMP !== 'all' && pipeTemp(l).key !== PIPE_TEMP) return false;
    if (!q) return true;
    const co = pipeCoOf(l.crm_company);
    return (co.name || '').toLowerCase().indexOf(q) >= 0 || (co.city || '').toLowerCase().indexOf(q) >= 0 || (co.industry || '').toLowerCase().indexOf(q) >= 0;
  });
  // ── temperature kanban: every stage a column, value per lead + per-column total ──
  const cols = CC.STAGES.map((s, si) => {
    const ls = leads.filter(l => l.stage === s.key);
    const total = ls.reduce((a, l) => a + (CC.leadValue(l) || 0), 0);
    const next = CC.STAGES[si + 1];
    const cards = ls.map(l => {
      const co = pipeCoOf(l.crm_company), v = CC.leadValue(l), t = pipeTemp(l);
      const moveBtn = (s.open && next) ? '<button class="pl-move" data-lead="' + l.id + '" data-to="' + next.key + '">Move to ' + esc(next.label) + ' ›</button>' : '';
      return '<div class="pl-card" data-lead="' + l.id + '"><div class="pl-card-top"><div class="n">' + esc(co.name || '—') + '</div><span class="pl-temp" style="color:' + t.c + ';background:' + t.bg + '">' + t.label + '</span></div>'
        + '<div class="m">' + esc(co.industry || '') + (co.city ? ' · ' + esc(co.city) : '') + '</div>'
        + '<div class="pl-card-foot"><span class="v">' + pipeFmt(v) + '</span></div>' + moveBtn + '</div>';
    }).join('') || '<div class="pl-col-empty">Empty</div>';
    return '<div class="pl-col"><div class="pl-col-h"><span class="pl-col-dot" style="background:' + (s.key === 'won' ? '#16a34a' : s.key === 'lost' ? '#dc2626' : '#94a3b8') + '"></span><span>' + esc(s.label) + '</span><span class="pl-col-n">' + ls.length + ' · ' + pipeFmt(total) + '</span></div>' + cards + '</div>';
  }).join('');
  root.innerHTML = band + band2 + dueStrip + orphanBar + controls + '<div class="pl-board"><div class="pl-cols">' + cols + '</div></div>';
  wirePipe();
}
/* upsertLead's UPDATE writes EVERY column it picks, so a partial payload is a
   silent delete: sending only {id, stage} nulls the score, the next action and
   the expected close date. Always send the lead we already hold, with the
   change layered on top. */
function leadPatch(l, changes) { return Object.assign({}, l, changes || {}); }

function wirePipe() {
  const bf = document.getElementById('plBackfill');
  if (bf) bf.onclick = async () => {
    bf.disabled = true; bf.textContent = 'Adding…';
    const r = await pipeApi({ action: 'backfillLeads' });
    if (r && r.ok) { toast('Added ' + r.created + ' to the board'); renderPipeline(true); }
    else { bf.disabled = false; toast((r && r.error) || 'Could not backfill', 'err'); }
  };
  const add = document.getElementById('plAdd'); if (add) add.addEventListener('click', pipeAddLead);
  const imp = document.getElementById('plImport'); if (imp) imp.addEventListener('click', () => { switchSection('leads'); const b = document.getElementById('dcImport'); if (b) b.click(); });
  const srch = document.getElementById('plSearch'); if (srch) { srch.addEventListener('input', () => { PIPE_SEARCH = srch.value; renderPipeline(); srch.focus(); srch.setSelectionRange(srch.value.length, srch.value.length); }); }
  const temp = document.getElementById('plTemp'); if (temp) temp.addEventListener('change', () => { PIPE_TEMP = temp.value; renderPipeline(); });
  document.querySelectorAll('#pipeRoot [data-due]').forEach(b => b.addEventListener('click', () => pipeOpenLead(+b.dataset.due)));
  document.querySelectorAll('#pipeRoot .pl-card').forEach(c => c.addEventListener('click', e => { if (e.target.closest('.pl-move')) return; pipeOpenLead(+c.dataset.lead); }));
  document.querySelectorAll('#pipeRoot .pl-move').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    const l = PIPE.leads.find(x => +x.id === +b.dataset.lead); if (!l) return;
    const chk = window.CRMCore.canMove(l.stage, b.dataset.to, l); if (chk && chk.ok === false) return alert(chk.why);
    const r = await pipeApi({ action: 'upsertLead', lead: leadPatch(l, { stage: b.dataset.to }) });
    if (r && r.ok) renderPipeline(true); else alert('Could not move: ' + ((r && r.error) || ''));
  }));
}
function pipeAddLead() {
  QLShell.openForm({
    title: 'Add lead', saveLabel: 'Add', initial: { stage: 'new' },
    specs: [
      { k: 'name', label: 'Company', req: true, full: true },
      { k: 'industry', label: 'Industry' },
      { k: 'city', label: 'City' },
      { k: 'tonnes', label: 'Tonnes (MT)', type: 'number' },
      { k: 'price_per_tonne', label: 'Price ₹/MT', type: 'number' },
      { k: 'stage', label: 'Stage', type: 'select', opts: CRMCore.STAGES.map(s => [s.key, s.label]) }
    ],
    async onSave(v) {
      const c = await pipeApi({ action: 'upsertCompany', company: { name: v.name, industry: v.industry || '', city: v.city || '' } });
      if (!c || !c.ok) return alert('Could not save company: ' + ((c && c.error) || ''));
      const cid = c.id || (c.company && c.company.id);
      const l = await pipeApi({ action: 'upsertLead', lead: { id: 0, crm_company: cid, tonnes: +v.tonnes || null, price_per_tonne: +v.price_per_tonne || null, stage: v.stage || 'new' } });
      if (!l || !l.ok) return alert('Could not save lead: ' + ((l && l.error) || ''));
      renderPipeline(true);
    }
  });
}
function pipeOpenLead(id) {
  const l = PIPE.leads.find(x => +x.id === +id); if (!l) return;
  const CC = window.CRMCore, co = pipeCoOf(l.crm_company);
  const t = pipeTemp(l), v = CC.leadValue(l);
  const contact = (PIPE.contacts || []).find(c => +c.crm_company === +l.crm_company) || {};
  const tl = (PIPE.activities || []).filter(a => +a.crm_company === +l.crm_company)
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 12);
  const stages = CC.STAGES.map(st =>
    `<button class="pd-stage${st.key === l.stage ? ' on' : ''}" data-stage="${st.key}">${esc(st.label)}</button>`).join('');
  const card = (ic, label, val) => `<div class="pd-kpi"><div class="pd-kpi-t">${ic}<span>${label}</span></div><div class="pd-kpi-v">${val}</div></div>`;
  const nextDue = l.next_action_at ? String(l.next_action_at).slice(0, 10) : '';
  const body = `
    <div class="pd-head">
      <div class="pd-head-ic">${IC_BLDG}</div>
      <div class="pd-head-t">
        <div class="pd-name">${esc(co.name || '—')}<span class="pd-chip">${esc((CC.STAGES.find(x => x.key === l.stage) || {}).label || l.stage)}</span><span class="pd-chip" style="color:${t.c};background:${t.bg}">${t.label}</span></div>
        <div class="pd-sub">${esc(co.industry || '—')}${co.city ? ' · ' + esc(co.city) : ''}${co.source ? ' · via ' + esc(co.source) : ''}</div>
      </div>
      <div class="pd-head-a">
        ${contact.phone ? `<a class="lr-b" href="tel:${esc(contact.phone)}">${IC_PHONE}Call</a>` : ''}
        ${waReachable(contact.phone) ? `<a class="lr-b wa" href="${esc((window.WACore && WACore.waLink) ? WACore.waLink(contact.phone, '') : '#')}" target="_blank" rel="noopener noreferrer">${IC_WA}WhatsApp</a>` : ''}
      </div>
    </div>
    <div class="pd-kpis">
      ${card(IC_RUPEE, 'Est. value', v == null ? '<span class="pd-none">no price yet</span>' : pipeFmt(v))}
      ${card(IC_TARGET, 'Fit score', l.score == null ? '<span class="pd-none">unscored</span>' : l.score + '<small>/100</small>')}
      ${card(IC_USERPLUS, 'Owner', esc(l.owner || '') || '<span class="pd-none">unassigned</span>')}
      ${card(IC_CLOCK, 'Next action', nextDue ? esc(nextDue) : '<span class="pd-none">none set</span>')}
    </div>
    <div class="pd-sec"><div class="pd-sec-t">Pipeline stage</div><div class="pd-stages">${stages}</div></div>
    <div class="pd-sec"><div class="pd-sec-t">${IC_SPARK}Outreach</div>
      <div class="pd-btns">
        <button class="lr-b assess" id="plStudio" type="button">${IC_SEND}Draft message</button>
        <button class="lr-b" id="plQuote" type="button">${IC_DOC}Send quotation</button>
        <button class="lr-b msg" id="plProposal" type="button">${IC_DOC}Generate proposal</button>
        <button class="lr-b" id="plOnboard" type="button">${IC_LINK}Onboarding link</button>
      </div></div>
    <div class="pd-sec"><div class="pd-sec-t">Next step</div>
      <div class="pd-next">
        <input id="plNextAct" class="pd-in" placeholder="What is the next move? e.g. send a 1MT sample quote" value="${esc(l.next_action || '')}">
        <input id="plNextAt" class="pd-in pd-in-d" type="date" value="${esc(nextDue)}">
        <button class="lr-b pri" id="plNextSave" type="button">Save</button>
      </div></div>
    <div class="pd-sec"><div class="pd-sec-t">Log a touch</div>
      <textarea id="plTouch" class="pd-note" rows="2" placeholder="What happened? A call summary, a note, a meeting…"></textarea>
      <div class="pd-btns" style="margin-top:8px">
        <button class="lr-b" data-touch="call" type="button">${IC_PHONE}Log call</button>
        <button class="lr-b" data-touch="meeting" type="button">${IC_CAL}Log meeting</button>
        <button class="lr-b pri" data-touch="note" type="button">Save note</button>
      </div></div>
    <div class="pd-sec"><div class="pd-sec-t">History</div>
      ${tl.length ? '<div class="pd-tl">' + tl.map(a => `<div class="pd-tl-i"><span class="pd-tl-k">${esc(actLabel(a.kind))}</span><span class="pd-tl-d">${esc(String(a.at || '').slice(0, 16).replace('T', ' '))}</span><div class="pd-tl-b">${esc(String(a.body || '').slice(0, 220))}</div></div>`).join('') + '</div>'
        : '<div class="pd-none">Nothing logged yet. Every draft you open and every touch you log here shows up in this list.</div>'}
    </div>`;
  const pane = QLShell.panel({ title: co.name || 'Lead', body: body }) || document;
  /* The composer needs the CRM ids so what it opens is logged against THIS lead. */
  const leadR = { name: co.name, industry: co.industry, city: co.city, tonnes: l.tonnes,
    contact: contact.name || '', phone: contact.phone || '', email: contact.email || '',
    website: co.website || '', crm_company: l.crm_company, crm_lead: l.id };
  const on = (id, fn) => { const b = pane.querySelector('#' + id) || document.getElementById(id); if (b) b.addEventListener('click', fn); };
  on('plStudio', () => { QLShell.closeModal(); openStudio(leadR); });
  on('plQuote', () => { QLShell.closeModal(); openQuote(leadR); logTouch({ kind: 'quote', crm_company: l.crm_company, crm_lead: l.id, body: 'Quotation generated for ' + (co.name || '') }); });
  on('plProposal', () => { QLShell.closeModal(); openProposal(leadR); logTouch({ kind: 'proposal', crm_company: l.crm_company, crm_lead: l.id, body: 'Proposal generated for ' + (co.name || '') }); });
  on('plOnboard', () => { QLShell.closeModal(); openOnboardLink(leadR); });
  on('plNextSave', async () => {
    const act = (pane.querySelector('#plNextAct') || {}).value || '';
    const at = (pane.querySelector('#plNextAt') || {}).value || '';
    if (!act.trim() && !at) { toast('Write the next step, or pick a date', 'err'); return; }
    const r = await pipeApi({ action: 'upsertLead', lead: leadPatch(l, { next_action: act.trim(), next_action_at: at || null }) });
    if (r && r.ok) { toast('Next step saved'); QLShell.closeModal(); renderPipeline(true); }
    else toast((r && r.error) || 'Could not save the next step', 'err');
  });
  pane.querySelectorAll('[data-touch]').forEach(b => b.addEventListener('click', async () => {
    const box = pane.querySelector('#plTouch'), txt = box ? box.value.trim() : '';
    if (!txt) { toast('Write what happened first', 'err'); return; }
    const okd = await logTouch({ kind: b.dataset.touch, crm_company: l.crm_company, crm_lead: l.id, body: txt });
    if (okd) { toast('Logged'); QLShell.closeModal(); renderPipeline(true); }
  }));
  pane.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', async () => {
    const to = b.dataset.stage;
    const chk = CC.canMove(l.stage, to, l); if (chk && chk.ok === false) return alert(chk.why);
    const r = await pipeApi({ action: 'upsertLead', lead: leadPatch(l, { stage: to }) });
    if (r && r.ok) { QLShell.closeModal(); renderPipeline(true); } else alert('Could not move: ' + ((r && r.error) || ''));
  }));
}

QLShell.mount({ active: 'discover', title: 'Lead Discovery' });
buildIcp();
buildFilters(); setupVoice(); buildMarketPanel();
paintSources(); paintTabs(); paintTable();
renderHero(); renderCopilot(); renderHeatMap();
/* LEADS is the default section. This page exists to hand a salesperson people
   to call; the Copilot is a place you choose to go, not the thing you want in
   front of you when the page opens. A stored preference still wins. */
try { switchSection(localStorage.getItem('ql_dc_sec') || 'leads'); } catch (_) { switchSection('leads'); }

/* Section tabs (Copilot / Markets / Leads) — progressive disclosure. */
document.querySelectorAll('#dcSecTabs .dc-sectab').forEach(b => b.addEventListener('click', () => switchSection(b.dataset.sec)));
/* Advanced filters collapse by default — one intelligent search is the primary. */
document.getElementById('dcFiltToggle').addEventListener('click', e => {
  const f = document.getElementById('dcFilters'); const open = f.hidden;
  f.hidden = !open; e.currentTarget.setAttribute('aria-expanded', String(open));
});
/* Hero actions. */
/* The hero is gone — these buttons lived in it. Guarded so their absence can
   never throw and take the rest of the page's wiring down with it. */
const _heroDisc = document.getElementById('dcHeroDiscover');
if (_heroDisc) _heroDisc.addEventListener('click', () => {
  const tm = topMarket();
  if (tm && LM) findInMarket(LM.osmTerm((tm.industries[0] || {}).key), tm.state);
  else { switchSection('leads'); document.getElementById('dcAi').focus(); }
});
const _heroAsk = document.getElementById('dcHeroAsk');
if (_heroAsk) _heroAsk.addEventListener('click', () => { document.getElementById('dcAi').focus(); document.getElementById('dcAi').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
const _heroRev = document.getElementById('dcHeroReview');
if (_heroRev) _heroRev.addEventListener('click', () => switchSection('leads'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const b = document.getElementById('lcBack'); if (b && !b.hidden) closeLeadDrawer(); } });
document.getElementById('dcGo').addEventListener('click', runSearch);

/* ── the floating search ──────────────────────────────────────────────────
   Appears only once the hero has scrolled away, so it never competes with it.
   Typing here fills the real AI input and runs the same runSearch() — one
   search path, not a second implementation that drifts from the first. */
(function floatingSearch() {
  const hero = document.querySelector('.dc-search-hero');
  const bar  = document.getElementById('dcFloat');
  const inp  = document.getElementById('dcFloatIn');
  const ai   = document.getElementById('dcAi');
  if (!hero || !bar || !inp || !ai) return;

  const go = () => { if (inp.value.trim()) ai.value = inp.value.trim(); runSearch(); };
  document.getElementById('dcFloatGo').addEventListener('click', go);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  document.getElementById('dcFloatTop').addEventListener('click', () => {
    hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => ai.focus(), 300);
  });

  /* A plain scroll listener, not IntersectionObserver. The page scrolls inside
     #ql-main rather than the document, and an observer's async delivery is
     invisible to a headless check — this is measurable at any instant, which
     means it can actually be tested. */
  function sync() {
    const gone = hero.getBoundingClientRect().bottom <= 8;
    /* Only while looking at leads — over the Markets map or the Acquisition
       board it would just be clutter. */
    const leads = document.getElementById('secLeads');
    const onLeads = leads && !leads.hidden;
    bar.hidden = !(gone && onLeads);
  }
  const scroller = document.getElementById('ql-main') || window;
  scroller.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync);
  document.addEventListener('ql-section', sync);
  sync();
  window.__dcFloatSync = sync;   // so a test can assert without racing a frame
})();

/* The count in the floating bar tracks what the table is actually showing. */
function paintFloatCount(shown, total) {
  const el = document.getElementById('dcFloatN'); if (!el) return;
  el.textContent = total ? (shown === total ? total + ' results' : shown + ' of ' + total) : '';
}
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
const _imp = document.getElementById('dcImport');
if (_imp) _imp.addEventListener('click', openPaste);
window.__qlOnSwitchCompany = () => { buildIcp(); load(); };
Q.init(() => {}).then(() => { buildIcp(); loadSources(); load(); }).catch(() => { loadSources(); load(); });
