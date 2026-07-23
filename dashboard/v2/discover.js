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
const Q = window.QLD, IC2 = window.ICPCore, LI = window.LeadImport, LP = window.LeadParse;

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

const SUGGEST = [
  ['AAC block manufacturers', 'Jodhpur'], ['Cement dealers', 'Jodhpur'], ['Construction chemical makers', 'Jaipur'],
  ['Steel plants', 'Jodhpur'], ['Sugar mills', 'Nagaur'], ['Paper mills', 'Jaipur']
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

function paintChips() {
  const el = document.getElementById('dcChips'); if (!el) return;
  el.innerHTML = '<span style="font-size:11.5px;color:var(--ql-text-secondary)">Try:</span>' +
    SUGGEST.map(([w, c]) => `<button class="dc-chip" data-w="${esc(w)}" data-c="${esc(c)}">${esc(w)} · ${esc(c)}</button>`).join('');
  el.querySelectorAll('[data-w]').forEach(b => b.onclick = () => {
    const bar = document.getElementById('dcAi');
    bar.value = 'Find ' + b.dataset.w + ' in ' + b.dataset.c;
    runSearch();
  });
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
        <td class="r">${r.status === 'promoted' ? '<span class="qx-pill" style="background:#dcfce7;color:#15803d">In pipeline</span>' :
          `<button class="ql-btn ql-btn-secondary" data-promote="${r.id}">Promote</button>
           <button class="ql-btn ql-btn-secondary" data-dismiss="${r.id}" title="Not a fit">✕</button>`}</td>
      </tr>`;
    }).join('') + '</tbody></table></div>';

  host.querySelectorAll('[data-promote]').forEach(b => b.onclick = () => promote(+b.dataset.promote));
  host.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = () => dismiss(+b.dataset.dismiss));
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

  const btn = document.getElementById('dcGo'); const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Searching…';
  const r = await api({ action: 'search', what, city, industry: indLabel, radius, source: SRC });
  btn.disabled = false; btn.textContent = label;

  const tag = what + (city ? ' · ' + city : '') + (radius ? ' · ' + radius + 'km' : '');
  if (!r.ok) {
    /* A failure is SHOWN. The whole point: a dead key must never read as "there
       are no such businesses here". */
    RECENT.unshift({ label: tag, ok: false });
    paintRecent();
    if (r.not_configured) notice(r.error + ' Until then, use <b>Paste / import a list</b> — it needs no key.', true);
    else notice('Search failed: <b>' + esc(r.error || 'unknown error') + '</b>'
      + (r.retry ? ' <button class="dc-retry" id="dcRetry">Retry</button>' : ''), true);
    const rb = document.getElementById('dcRetry'); if (rb) rb.onclick = runSearch;
    toast(r.error || 'Search failed', 'err');
    return;
  }
  // Honest about a radius that could not be applied (place would not geocode).
  if (radius && r.radius_fell_back) notice('Couldn’t pin the centre of <b>' + esc(city) + '</b>, so this searched the whole area instead of a ' + radius + ' km circle.', true);
  else notice('');
  RECENT.unshift({ label: tag, ok: true, added: r.added || 0, dupes: r.dupes || 0 });
  paintRecent();
  toast((r.added || 0) + ' new · ' + (r.dupes || 0) + ' already known' + (r.seen ? ' · ' + r.seen + ' seen before' : ''));
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
buildFilters(); setupVoice();
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
