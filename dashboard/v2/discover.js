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
const Q = window.QLD, IC2 = window.ICPCore, LI = window.LeadImport;
const esc = (window.QLX && QLX.esc) || (s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

let ROWS = [], COUNTS = { new: 0, duplicate: 0, promoted: 0, dismissed: 0 }, TAB = 'new', RECENT = [], ICP = [];
let _tt;
function toast(msg, tone) {
  const el = document.getElementById('dcToast'); if (!el) return;
  el.textContent = msg; el.hidden = false; el.style.background = tone === 'err' ? '#b91c1c' : '#0f172a';
  clearTimeout(_tt); _tt = setTimeout(() => { el.hidden = true; }, 3200);
}

function api(body) {
  const p = JSON.parse(localStorage.getItem('ql_plant') || '{}');
  return fetch('/api/discover', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ plant_id: p.id, company_id: Q.activeCo, token: p.token }, body))
  }).then(r => r.json()).catch(() => ({ ok: false, error: 'Network error' }));
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

function paintChips() {
  const el = document.getElementById('dcChips'); if (!el) return;
  el.innerHTML = '<span style="font-size:11.5px;color:var(--ql-text-secondary)">Try:</span>' +
    SUGGEST.map(([w, c]) => `<button class="dc-chip" data-w="${esc(w)}" data-c="${esc(c)}">${esc(w)} · ${esc(c)}</button>`).join('');
  el.querySelectorAll('[data-w]').forEach(b => b.onclick = () => {
    document.getElementById('dcWhat').value = b.dataset.w;
    document.getElementById('dcCity').value = b.dataset.c;
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

async function runSearch() {
  const what = (document.getElementById('dcWhat').value || '').trim();
  const city = (document.getElementById('dcCity').value || '').trim();
  const ind = (document.getElementById('dcInd').value || '').trim();
  if (!what) { toast('Say what to look for', 'err'); return; }
  const btn = document.getElementById('dcGo'); const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Searching…';
  const r = await api({ action: 'search', what, city, industry: ind });
  btn.disabled = false; btn.textContent = label;

  const tag = what + (city ? ' · ' + city : '');
  if (!r.ok) {
    /* A failure is SHOWN. The whole point: a dead key must never read as "there
       are no such businesses here". */
    RECENT.unshift({ label: tag, ok: false });
    paintRecent();
    if (r.not_configured) notice(r.error + ' Until then, use <b>Paste / import a list</b> — it needs no key.', true);
    else notice('Search failed: <b>' + esc(r.error || 'unknown error') + '</b>', true);
    toast(r.error || 'Search failed', 'err');
    return;
  }
  notice('');
  RECENT.unshift({ label: tag, ok: true, added: r.added || 0, dupes: r.dupes || 0 });
  paintRecent();
  toast((r.added || 0) + ' new · ' + (r.dupes || 0) + ' already known' + (r.seen ? ' · ' + r.seen + ' seen before' : ''));
  TAB = 'new'; await load();
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
paintChips(); paintTabs(); paintTable();
document.getElementById('dcGo').addEventListener('click', runSearch);
['dcWhat', 'dcCity', 'dcInd'].forEach(id => document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); }));
document.getElementById('dcImport').addEventListener('click', openPaste);
window.__qlOnSwitchCompany = () => { buildIcp(); load(); };
Q.init(() => {}).then(() => { buildIcp(); load(); }).catch(() => load());
