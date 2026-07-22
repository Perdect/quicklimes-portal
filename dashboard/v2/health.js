/* ═══════════════════════════════════════════════════════════════════════════
   App Health — renders the audit board.

   Owner-only. This page names open bugs and the files they live in; that is
   useful to whoever maintains the app and is noise (or quiet alarm) to a
   dispatch clerk who cannot act on any of it. The gate here is a COURTESY, not
   a security boundary — the findings are shipped in health-findings.js and any
   logged-in browser can read that file. Nothing on this page is customer data,
   which is why that is acceptable; do not put anything sensitive here on the
   assumption that the gate protects it.

   The content is a static, dated snapshot. It does not read your business data
   and never calls the API.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const H = window.HealthBoard;
  const $ = s => document.querySelector(s);

  /* Same rule the Settings page uses for its owner-only cards. */
  function plant() { try { return JSON.parse(localStorage.getItem('ql_plant') || 'null') || {}; } catch (_) { return {}; } }
  function isOwner() { return ['owner', 'admin', 'partner'].indexOf(plant().role || 'owner') >= 0; }

  const SEV_LABEL = { high: 'High', med: 'Medium', low: 'Low' };
  /* A fixed finding shows a green dot whatever its original severity — the
     severity of something that no longer happens is not information. */
  const dotClass = f => f.status === 'fixed' ? 'fixed' : f.status === 'awaiting' ? 'await' : f.sev;

  const TABS = [
    ['open', 'Still open'],
    ['fixed', 'Fixed'],
    ['unchecked', 'Not re-checked'],
    ['awaiting', 'Never verified'],
    ['all', 'Everything']
  ];
  let TAB = 'open';

  function fDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function paintTally() {
    const c = H.counts();
    const cells = [
      ['high', (c.openBySev.high || 0) + ' high open'],
      ['med', (c.openBySev.med || 0) + ' medium open'],
      ['fixed', (c.fixed || 0) + ' fixed & verified'],
      ['low', (c.unchecked || 0) + ' not re-checked'],
      ['await', (c.awaiting || 0) + ' never verified']
    ];
    $('#hbTally').innerHTML = cells.map(([k, txt]) => {
      const n = txt.split(' ')[0], rest = txt.slice(n.length);
      return `<span class="hb-pill"><span class="hb-dot ${k}"></span><b>${n}</b>${rest}</span>`;
    }).join('');
  }

  function paintNote() {
    const c = H.counts();
    $('#hbNote').innerHTML =
      `<b>How to read this.</b> ${H.MODULES_AUDITED} auditors raised ${H.RAW_FINDINGS} findings on ${fDate(H.AUDIT_DATE)}; each was
       attacked by an independent verifier that had to reproduce it or throw it out. ${H.CONFIRMED} survived,
       ${H.REFUTED} was refuted, and ${c.awaiting} verifiers were cut off by a session limit — those are shown as
       <b>never verified</b> rather than hidden or assumed true.
       <br><br>
       Every status here was re-read against the code on <b>${fDate(H.RECHECK_DATE)}</b>, and each finding carries the
       line that decided it. <b>${c.unchecked} findings were not re-read</b> and say so — they are neither confirmed
       nor cleared. Zero critical findings: nothing here loses data or crashes; every confirmed issue is a wrong
       number on a screen.
       <br><br>
       Almost all of it is one rule applied unevenly — <b>“a deleted or cancelled record is not a live record.”</b>
       The app already states that rule once (<code>notCancelled</code>, data.js:385). Readers built on
       <code>salesRows()</code>/<code>purchaseRows()</code> are already safe from deleted rows and leak only cancelled
       ones; readers that touch <code>S.SALES</code> raw leak both, which is why the Monthly Register is the worst of them.`;
  }

  function paintStats() {
    const c = H.counts();
    const cards = [
      ['', H.MODULES_AUDITED, 'Modules audited'],
      ['red', c.openBySev.high || 0, 'High still open'],
      ['green', c.fixed || 0, 'Fixed & verified'],
      ['amber', c.unchecked || 0, 'Not re-checked'],
      ['violet', c.awaiting || 0, 'Never verified'],
      ['green', 0, 'Critical — data loss / crash']
    ];
    $('#hbStats').innerHTML = cards.map(([t, n, l]) =>
      `<div class="hb-stat ${t}"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
  }

  function paintTabs() {
    $('#hbTabs').innerHTML = TABS.map(([k, label]) => {
      const n = k === 'all' ? H.FINDINGS.length : H.byStatus(k).length;
      return `<button class="hb-tab${TAB === k ? ' active' : ''}" data-t="${k}">${label}<span class="n">${n}</span></button>`;
    }).join('');
    $('#hbTabs').querySelectorAll('[data-t]').forEach(b => b.onclick = () => { TAB = b.dataset.t; paintTabs(); paintList(); });
  }

  const SEV_ORDER = { high: 0, med: 1, low: 2 };

  function paintList() {
    const rows = (TAB === 'all' ? H.FINDINGS.slice() : H.byStatus(TAB))
      .slice().sort((a, b) => (SEV_ORDER[a.sev] - SEV_ORDER[b.sev]));
    if (!rows.length) { $('#hbList').innerHTML = '<div class="hb-empty">Nothing in this group.</div>'; return; }
    $('#hbList').innerHTML = rows.map(f => `
      <details class="hb-item ${f.status === 'fixed' ? 'fixed' : f.status === 'awaiting' ? 'await' : f.sev}">
        <summary class="hb-sum">
          <span class="hb-dot ${dotClass(f)}"></span>
          <span class="hb-t">${f.title}</span>
          <span class="hb-mod">${f.module} · ${SEV_LABEL[f.sev] || f.sev}</span>
        </summary>
        <div class="hb-body">
          <p><b>What happens:</b> ${f.what}</p>
          <p>${f.where}</p>
        </div>
      </details>`).join('') + cleanBlock();
  }

  function cleanBlock() {
    if (TAB !== 'all' && TAB !== 'fixed') return '';
    return `<div class="hb-note" style="margin-top:var(--ql-space-4)"><b>Audited and clean.</b> ` +
      H.CLEAN.map(([m, d]) => `${m} — ${d}`).join(' · ') + `</div>`;
  }

  function boot() {
    QLShell.mount({ active: 'settings', title: 'App Health' });
    if (!isOwner()) {
      $('#hbGate').innerHTML =
        `<div class="hb-denied"><h2 style="font:800 18px var(--ql-font-sans);color:var(--ql-text);margin-bottom:8px">Not available for your login</h2>
         <p>The app health board is for the account owner. Nothing is wrong with your access — there is simply
         nothing here you would be able to act on.</p></div>`;
      return;
    }
    $('#hbSub').textContent =
      'Audit of ' + fDate(H.AUDIT_DATE) + ', re-checked against the code on ' + fDate(H.RECHECK_DATE) + '.';
    $('#hbMain').hidden = false;
    paintTally(); paintNote(); paintStats(); paintTabs(); paintList();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
