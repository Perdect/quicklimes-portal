/* ═══════════════════════════════════════════════════════════════
   QuickLimes — MOBILE APP LAYER  (window.QLMobile)
   A native-feeling business app on phones (iOS / Linear / Stripe /
   banking), sharing the same QLD data + QLX modules as desktop.
   Reusable components:
     MobileHeader · BottomNav · MobileActionSheet · MobileBottomSheet
     MobileCardList · MobileFilterSheet · MobileFormWizard
     MobileInvoiceViewer · MobileDashboard · pull-to-refresh · skeleton
   Desktop is never touched — every build path is gated by isMobile().
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const MQ = window.matchMedia('(max-width: 768px)');
  const isMobile = () => MQ.matches;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const Q = () => window.QLD;
  const fc = v => (window.QLD ? window.QLD.fC(v) : '₹' + v);

  /* ── Icons ─────────────────────────────────────────────────── */
  const S = (p, w) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 2}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const IC = {
    dashboard: S('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    sales: S('<path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 5-6"/>'),
    purchase: S('<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>'),
    finance: S('<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/><path d="M6 15h4"/>'),
    more: S('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'),
    search: S('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
    bell: S('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
    back: S('<polyline points="15 18 9 12 15 6"/>', 2.4),
    plus: S('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    x: S('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 2.2),
    invoice: S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>'),
    bank: S('<line x1="3" y1="21" x2="21" y2="21"/><path d="M4 10v9M20 10v9M9 10v9M15 10v9"/><path d="M3 10l9-6 9 6z"/>'),
    ledger: S('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
    reports: S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M8 13l2 2 4-4"/>'),
    coll: S('<path d="M20 6 9 17l-5-5"/>'),
    due: S('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    expense: S('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>'),
    parties: S('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>'),
    production: S('<path d="M2 20h20"/><path d="M4 20V8l6 4V8l6 4V4l4 3v13"/>'),
    attendance: S('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><path d="M9 15l2 2 4-4"/>'),
    settings: S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
    command: S('<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>'),
    gst: S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'),
    download: S('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
    print: S('<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
    share: S('<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>'),
    fit: S('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>'),
    refresh: S('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
    trend: S('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
    wallet: S('<path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>'),
    box: S('<path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22" x2="12" y2="12"/>'),
    cal: S('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    chev: S('<polyline points="9 18 15 12 9 6"/>', 2.2),
    truck: S('<rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>')
  };

  /* ── Bottom-nav tab config ─────────────────────────────────── */
  const TABS = [
    { key: 'dashboard', label: 'Dashboard', icon: IC.dashboard, href: 'dashboard.html', match: ['dashboard'] },
    { key: 'sales', label: 'Sales', icon: IC.sales, href: 'sales.html', match: ['sales', 'invoice', 'collections', 'monthreg'] },
    { key: 'purchase', label: 'Purchase', icon: IC.purchase, href: 'purchase.html', match: ['purchase', 'payables', 'suppliers'] },
    { key: 'finance', label: 'Finance', icon: IC.finance, href: 'payments.html', match: ['finance', 'reconcile', 'cashbook', 'loans', 'gst', 'tds', 'pl'] },
    { key: 'more', label: 'More', icon: IC.more, href: '#more', match: [] }
  ];
  const tabForActive = a => (TABS.find(t => t.match.includes(a)) || TABS[4]).key;

  /* “More” library — curated, respects Feature Management via QLShell.nav() */
  const MORE_ICON = {
    invoice: IC.invoice, gst: IC.gst, tds: IC.gst, pl: IC.reports, reports: IC.reports,
    reconcile: IC.bank, finance: IC.finance, loans: IC.ledger, cashbook: IC.expense,
    collections: IC.coll, payables: IC.due, parties: IC.parties, suppliers: IC.parties,
    labour: IC.parties, attendance: IC.attendance, settings: IC.settings, command: IC.command,
    'ql-prod': IC.production, chunna: IC.production, monthreg: IC.reports
  };

  /* ── State ─────────────────────────────────────────────────── */
  let _active = 'dashboard', _title = '', _built = false, _dashTab = 'overview', _dashObs = null, _guard = false;

  /* ═══════════════ CHROME (header · bottom-nav · fab) ═══════════════ */
  function build() {
    if (_built) return;
    // header
    const h = el('header', 'qlm-header');
    h.innerHTML =
      `<button class="qlm-h-back" id="qlmBack" aria-label="Back">${IC.back}</button>
       <div class="qlm-h-titles">
         <div class="qlm-h-title" id="qlmTitle">QuickLimes</div>
         <button class="qlm-h-co" id="qlmCo" hidden></button>
       </div>
       <div class="qlm-h-actions">
         <button class="qlm-h-btn" id="qlmSearch" aria-label="Search">${IC.search}</button>
         <button class="qlm-h-btn" id="qlmBell" aria-label="Notifications">${IC.bell}<span class="qlm-h-badge" id="qlmBellBadge" hidden>0</span></button>
         <button class="qlm-h-avatar" id="qlmAvatar" data-avatar>D</button>
       </div>`;
    /* NOTE: no data-profile-trigger on the mobile avatar. The shell binds that
       attribute to openProfileMenu(), which positions a DESKTOP dropdown with
       `top = trigger.top - 8 - menuHeight` — against a header at y≈10 that is a
       negative top, so the menu hung off the top of the screen, clipped, floating
       over the title. Mobile opens a native sheet instead (openProfileSheet). */
    // pull-to-refresh indicator
    const ptr = el('div', 'qlm-ptr', IC.refresh);
    ptr.id = 'qlmPtr';
    // bottom nav
    const nav = el('nav', 'qlm-bottomnav');
    nav.innerHTML = TABS.map(t => `<button class="qlm-tab" data-tab="${t.key}">${t.icon}<span>${t.label}</span></button>`).join('');
    /* No FAB. Removed by request, and it had not earned its place: it floated over
       the content on every screen, covered the last table row, and every page it
       appeared on already has its own add/upload button. A permanent button that
       guesses what you meant to create is worse than the specific one already on
       the page. fabAction() is gone with it rather than left dangling. */

    document.body.appendChild(h);
    document.body.appendChild(ptr);
    document.body.appendChild(nav);

    // wire
    $('qlmSearch').onclick = () => window.QLShell && QLShell.openPalette();
    $('qlmBell').onclick = () => window.QLShell && QLShell.openNotifications();
    $('qlmAvatar').onclick = openProfileSheet;
    $('qlmCo').onclick = openCoSwitch;
    $('qlmBack').onclick = () => history.length > 1 ? history.back() : (location.href = 'dashboard.html');
    nav.querySelectorAll('.qlm-tab').forEach(b => b.onclick = () => onTab(b.dataset.tab));
    wirePullToRefresh();
    _built = true;
  }

  /* ═══════════════ COMPANY SWITCHER ═══════════════
     The desktop switcher lives in the sidebar, and mobile hides the sidebar — so
     on a phone there was NO company control at all. Not "broken": absent. This
     file did not mention companies once. Whichever firm happened to be active was
     the one you were stuck with, and every figure on screen belonged to it, which
     is how you end up reading Deshwali's money while believing it is Gotan's.

     Shown only when there is a real choice: with one company a chip that opens a
     one-item menu is noise. The switch itself goes through QLD.switchCompany —
     the same path the desktop uses — so the two can never drift. */
  function coList() {
    const Q = window.QLD;
    return (Q && Q.COMPANIES) ? Object.values(Q.COMPANIES) : [];
  }
  function paintCo() {
    const btn = $('qlmCo'); if (!btn) return;
    const Q = window.QLD, list = coList();
    if (!Q || !Q.co || list.length < 2) { btn.hidden = true; return; }
    btn.hidden = false;
    btn.innerHTML = esc(Q.co.short || Q.co.name || '') + IC.chev;
  }
  function openCoSwitch() {
    const Q = window.QLD, list = coList();
    if (!Q || list.length < 2) return;
    actionSheet('Switch company', list.map(c => ({
      label: c.short || c.name,
      active: c.key === Q.activeCo,
      onClick: () => {
        if (c.key === Q.activeCo) return;
        Q.switchCompany(c.key, () => {
          paintCo();
          /* Repaint the SHELL's own chrome too — its name, avatar letter and
             profile menu. The desktop switcher calls this; mobile did not, so
             after a phone switch the profile sheet could still show the previous
             firm's name and initial while the page underneath was correct. */
          if (window.QLShell && QLShell.paintWorkspace) QLShell.paintWorkspace();
          paintChrome();
          /* And the MOBILE dashboard, which this file renders itself. The page's
             own __qlOnSwitchCompany redraws the DESKTOP dashboard (dashboard.js);
             nothing redrew this one, so "Welcome back — Deshwali Minerals" stayed
             on screen after switching to Gotan, under a header that correctly said
             Gotan. Two dashboards, one hook, and only one of them was listening. */
          buildDashboard();
          /* Re-render whatever this page draws. Every page defines this hook and
             the shell calls it after a desktop switch; mobile must not invent a
             second, divergent refresh path. Reload only if a page has no hook —
             a stale screen showing another firm's money is not an option. */
          if (typeof window.__qlOnSwitchCompany === 'function') window.__qlOnSwitchCompany(c.key);
          else location.reload();
          if (window.QLShell && QLShell.toast) QLShell.toast('Switched to ' + (c.short || c.name), 'ok');
        });
      }
    })));
  }

  /* ═══════════════ PROFILE — a native sheet, not a stray dropdown ═══════════════
     The shell's #profileMenu is a desktop dropdown. On a phone it opened clipped
     against the top of the screen, floating over the title, with no company
     switcher in it — the thing that looked "broken".

     This MIRRORS that menu rather than re-listing it: every real item is read off
     #profileMenu and each sheet row clicks the underlying button, so the shell
     keeps its handlers, nothing is duplicated, and an item added to the desktop
     menu later shows up here on its own instead of quietly going missing. */
  function profileItems() {
    return [...document.querySelectorAll('#profileMenu .profile-menu-item')]
      .filter(b => b.offsetParent !== null || !b.hasAttribute('hidden'))
      .map(b => ({
        label: (b.textContent || '').replace(/\s+/g, ' ').trim(),
        danger: b.classList.contains('profile-menu-item-danger'),
        onClick: () => b.click()          // reuse the shell's own handler
      }))
      .filter(it => it.label);
  }
  function openProfileSheet() {
    const Q = window.QLD, list = coList();
    const nm = (document.getElementById('pmName') || {}).textContent || 'Account';
    const items = [];
    /* Company switching lives here TOO, not only on the header chip. The chip is
       easy to miss, and "how can I select my second company" is the question that
       proves it: the answer must be somewhere people already look. */
    if (Q && list.length > 1) {
      items.push({
        label: 'Switch company · ' + (Q.co.short || Q.co.name),
        onClick: () => setTimeout(openCoSwitch, 60)
      });
    }
    items.push(...profileItems());
    if (!items.length) return;
    actionSheet(nm, items);
  }

  function onTab(key) {
    if (key === 'more') return openMore();
    const t = TABS.find(x => x.key === key);
    if (t && t.key !== tabForActive(_active)) location.href = t.href;
    else if (t) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function paintChrome() {
    if (!_built) return;
    $('qlmTitle').textContent = _title || (window.QLShell && document.querySelector('.tb-crumb-active')?.textContent) || 'QuickLimes';
    paintCo();                       // company chip: appears only when there is a real choice
    const cur = tabForActive(_active);
    document.querySelectorAll('.qlm-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === cur));
    // notif badge mirror
    try {
      const n = (Q() && Q().notifications) ? Q().notifications().filter(x => !x.done).length : 0;
      const b = $('qlmBellBadge'); if (b) { if (n > 0) { b.hidden = false; b.textContent = n > 9 ? '9+' : n; } else b.hidden = true; }
    } catch (_) {}
    // avatar photo/initial mirror from shell
    const av = $('qlmAvatar'); const src = document.querySelector('.tb-avatar');
    if (av && src) { av.textContent = src.textContent; if (src.style.backgroundImage) { av.style.backgroundImage = src.style.backgroundImage; av.textContent = ''; } }
    // FAB visibility (hide where there's no obvious create action)

  }


  const isVisible = e => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));

  /* ═══════════════ MORE (app library sheet) ═══════════════ */
  function openMore() {
    const nav = (window.QLShell && QLShell.nav) ? QLShell.nav() : [];
    const feat = window.QLShell && QLShell.feat;
    const primaryHrefs = new Set(['dashboard.html', 'sales.html', 'purchase.html', 'payments.html']);
    let html = '';
    nav.forEach(sec => {
      if (sec.feat && feat && !feat(sec.feat)) return;
      const items = (sec.type === 'solo' ? [sec] : sec.items).filter(it => !it.soon && !(it.feat && feat && !feat(it.feat)) && !primaryHrefs.has(it.href));
      if (!items.length) return;
      html += `<div class="qlm-more-sec">${esc(sec.type === 'solo' ? sec.label : sec.label)}</div><div class="qlm-more-grid">` +
        items.map(it => `<a class="qlm-more-tile" href="${it.href}"><span class="qlm-more-ic">${MORE_ICON[it.id] || IC.box}</span><span>${esc(it.label)}</span></a>`).join('') +
        `</div>`;
    });
    sheet({ title: 'All modules', bodyHTML: `<div class="qlm-more">${html}</div>` });
  }

  /* ═══════════════ BOTTOM SHEET ═══════════════ */
  function sheet(opts) {
    opts = opts || {};
    let back = $('qlmSheetBack');
    if (!back) {
      back = el('div', 'qlm-sheet-back'); back.id = 'qlmSheetBack';
      back.innerHTML = `<div class="qlm-sheet" id="qlmSheet"><div class="qlm-sheet-grab" id="qlmGrab"></div><div class="qlm-sheet-head"><div class="qlm-sheet-title" id="qlmSheetTitle"></div><button class="qlm-sheet-x" id="qlmSheetX">${IC.x}</button></div><div class="qlm-sheet-body" id="qlmSheetBody"></div><div class="qlm-sheet-foot" id="qlmSheetFoot" style="display:none"></div></div>`;
      document.body.appendChild(back);
      back.addEventListener('click', e => { if (e.target === back) close(); });
      $('qlmSheetX').onclick = close;
      wireSwipeDown($('qlmGrab'), $('qlmSheet'), close);
    }
    $('qlmSheetTitle').textContent = opts.title || '';
    $('qlmSheetBody').innerHTML = opts.bodyHTML || '';
    const foot = $('qlmSheetFoot');
    if (opts.footHTML) { foot.style.display = 'flex'; foot.innerHTML = opts.footHTML; } else { foot.style.display = 'none'; foot.innerHTML = ''; }
    if (typeof opts.onMount === 'function') opts.onMount($('qlmSheetBody'), close);
    requestAnimationFrame(() => back.classList.add('open'));
    function close() { back.classList.remove('open'); if (typeof opts.onClose === 'function') opts.onClose(); }
    return { close, body: $('qlmSheetBody') };
  }

  /* ═══════════════ ACTION SHEET (iOS) ═══════════════ */
  function actionSheet(title, items) {
    let back = $('qlmAsBack');
    if (!back) { back = el('div', 'qlm-as-back'); back.id = 'qlmAsBack'; document.body.appendChild(back); back.addEventListener('click', e => { if (e.target === back) close(); }); }
    const grp = items.map((it, i) => `<button class="qlm-as-item ${it.danger ? 'danger' : ''} ${it.active ? 'active' : ''}" data-i="${i}">${it.icon || ''}<span>${esc(it.label)}</span></button>`).join('');
    back.innerHTML = `<div class="qlm-as"><div class="qlm-as-group">${title ? `<div class="qlm-as-title">${esc(title)}</div>` : ''}${grp}</div><div class="qlm-as-cancel"><button class="qlm-as-item" data-cancel>Cancel</button></div></div>`;
    back.querySelectorAll('.qlm-as-item[data-i]').forEach(b => b.onclick = () => { const it = items[+b.dataset.i]; close(); setTimeout(() => it.onClick && it.onClick(), 120); });
    back.querySelector('[data-cancel]').onclick = close;
    requestAnimationFrame(() => back.classList.add('open'));
    function close() { back.classList.remove('open'); }
    return { close };
  }

  /* ═══════════════ SWIPE-DOWN-TO-DISMISS ═══════════════ */
  function wireSwipeDown(handle, panel, onClose) {
    let sy = 0, dy = 0, drag = false;
    const start = e => { sy = (e.touches ? e.touches[0].clientY : e.clientY); drag = true; panel.style.transition = 'none'; };
    const move = e => { if (!drag) return; dy = (e.touches ? e.touches[0].clientY : e.clientY) - sy; if (dy < 0) dy = 0; panel.style.transform = `translateY(${dy}px)`; };
    const end = () => { if (!drag) return; drag = false; panel.style.transition = ''; if (dy > 90) onClose(); else panel.style.transform = ''; dy = 0; };
    handle.addEventListener('touchstart', start, { passive: true });
    handle.addEventListener('touchmove', move, { passive: true });
    handle.addEventListener('touchend', end);
  }

  /* ═══════════════ FORM WIZARD ═══════════════ */
  /* wizard({ title, steps:[{ title, fields:[{key,label,type,options,value,placeholder,required}] , validate }],
             onComplete(values) }) — sticky Back / Next / Finish */
  function wizard(cfg) {
    const steps = cfg.steps || []; let i = 0; const values = Object.assign({}, cfg.initial || {});
    const s = sheet({ title: cfg.title || 'New', bodyHTML: '<div id="qlmWizBody"></div>', footHTML: '<button class="ql-btn ql-btn-secondary" id="qlmWizBack">Back</button><button class="ql-btn ql-btn-primary" id="qlmWizNext">Next</button>' });
    function fieldHTML(f) {
      const v = values[f.key] != null ? values[f.key] : (f.value != null ? f.value : '');
      if (f.type === 'select') return `<div class="qlm-field"><label>${esc(f.label)}</label><select data-k="${f.key}">${(f.options || []).map(o => { const val = Array.isArray(o) ? o[0] : o, lab = Array.isArray(o) ? o[1] : o; return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select></div>`;
      if (f.type === 'textarea') return `<div class="qlm-field"><label>${esc(f.label)}</label><textarea data-k="${f.key}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea></div>`;
      if (f.type === 'review') return f.render ? f.render(values) : '';
      return `<div class="qlm-field"><label>${esc(f.label)}</label><input data-k="${f.key}" type="${f.type || 'text'}" inputmode="${f.inputmode || (f.type === 'number' ? 'decimal' : 'text')}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}"></div>`;
    }
    function paint() {
      const st = steps[i];
      const dots = steps.map((_, k) => `<div class="qlm-wiz-dot ${k < i ? 'done' : k === i ? 'cur' : ''}"></div>`).join('');
      s.body.innerHTML =
        `<div class="qlm-wiz-head"><div class="qlm-wiz-steps">${dots}</div><div class="qlm-wiz-step">Step ${i + 1} of ${steps.length}<b>${esc(st.title || '')}</b></div></div>` +
        `<div>${(st.fields || []).map(fieldHTML).join('')}</div>`;
      s.body.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('input', () => { values[inp.dataset.k] = inp.value; }));
      s.body.querySelectorAll('select[data-k]').forEach(sel => sel.addEventListener('change', () => { values[sel.dataset.k] = sel.value; if (cfg.onChange) cfg.onChange(sel.dataset.k, values); }));
      $('qlmWizBack').style.visibility = i === 0 ? 'hidden' : 'visible';
      $('qlmWizNext').textContent = i === steps.length - 1 ? (cfg.finishLabel || 'Generate Invoice') : 'Next';
    }
    document.getElementById('qlmSheetFoot').onclick = e => {
      if (e.target.id === 'qlmWizBack') { if (i > 0) { i--; paint(); } }
      else if (e.target.id === 'qlmWizNext') {
        s.body.querySelectorAll('[data-k]').forEach(inp => values[inp.dataset.k] = inp.value);
        const st = steps[i];
        if (st.validate) { const err = st.validate(values); if (err) { QLShell.toast(err); return; } }
        if (i < steps.length - 1) { i++; paint(); if (cfg.onChange) cfg.onChange(null, values); }
        else { s.close(); cfg.onComplete && cfg.onComplete(values); }
      }
    };
    paint();
    return s;
  }

  /* ═══════════════ INVOICE VIEWER (fit · zoom · pdf · print · share) ═══════════════ */
  function invoiceViewer(cfg) {
    cfg = cfg || {};
    let iv = $('qlmIv');
    if (!iv) {
      iv = el('div', 'qlm-iv'); iv.id = 'qlmIv';
      iv.innerHTML =
        `<div class="qlm-iv-bar"><button class="qlm-iv-x" id="qlmIvX">${IC.x}</button><div class="qlm-iv-ttl" id="qlmIvTtl">Invoice</div><div class="qlm-iv-zoom" id="qlmIvZoom">100%</div></div>
         <div class="qlm-iv-stage" id="qlmIvStage"><div class="qlm-iv-doc" id="qlmIvDoc"></div></div>
         <div class="qlm-iv-foot">
           <button class="qlm-iv-btn" id="qlmIvFit">${IC.fit}<span>Fit</span></button>
           <button class="qlm-iv-btn pdf" id="qlmIvPdf">${IC.download}<span>PDF</span></button>
           <button class="qlm-iv-btn" id="qlmIvPrint">${IC.print}<span>Print</span></button>
           <button class="qlm-iv-btn share" id="qlmIvShare">${IC.share}<span>WhatsApp</span></button>
         </div>`;
      document.body.appendChild(iv);
      $('qlmIvX').onclick = closeIv;
      wirePinchZoom($('qlmIvStage'), $('qlmIvDoc'));
    }
    $('qlmIvTtl').textContent = cfg.title || 'Invoice';
    // render the A4 invoice HTML into a shadow-free container (strip the outer print bar via noBar HTML)
    const doc = $('qlmIvDoc');
    doc.innerHTML = `<iframe id="qlmIvFrame" style="width:794px;border:0;display:block" scrolling="no"></iframe>`;
    const frame = $('qlmIvFrame');
    iv.classList.add('open'); document.documentElement.style.overflow = 'hidden';
    // write invoice doc into iframe, then size the iframe to content & fit-to-width
    frame.onload = () => { try { const b = frame.contentWindow.document.body; frame.style.height = (b.scrollHeight + 4) + 'px'; setFit(); } catch (_) {} };
    frame.srcdoc = cfg.html;
    setTimeout(() => { try { const b = frame.contentWindow.document.body; if (b) { frame.style.height = (b.scrollHeight + 4) + 'px'; setFit(); } } catch (_) {} }, 250);

    $('qlmIvFit').onclick = setFit;
    $('qlmIvPdf').onclick = () => cfg.onPdf ? cfg.onPdf() : printDoc();
    $('qlmIvPrint').onclick = () => cfg.onPrint ? cfg.onPrint() : printDoc();
    $('qlmIvShare').onclick = () => cfg.onShare ? cfg.onShare() : shareDoc();

    function printDoc() { const w = window.open('', '_blank'); if (!w) { QLShell.toast('Allow pop-ups to print'); return; } w.document.write(cfg.printHtml || cfg.html); w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 350); }
    async function shareDoc() {
      const txt = cfg.shareText || (cfg.title + ' — QuickLimes');
      try { if (navigator.share) { await navigator.share({ title: cfg.title, text: txt }); return; } } catch (_) { return; }
      window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank');
    }
    return { close: closeIv };
  }
  function closeIv() { const iv = $('qlmIv'); if (iv) iv.classList.remove('open'); document.documentElement.style.overflow = ''; }

  // fit-to-width + double-tap + pinch zoom
  let _ivScale = 1, _ivFit = 1;
  function setFit() {
    const stage = $('qlmIvStage'), doc = $('qlmIvDoc'); if (!stage || !doc) return;
    const avail = stage.clientWidth - 32;
    _ivFit = Math.min(1, avail / 794); _ivScale = _ivFit; applyIvScale();
  }
  function applyIvScale() { const doc = $('qlmIvDoc'); if (!doc) return; doc.style.transform = `scale(${_ivScale})`; const stage = $('qlmIvStage'); if (stage) stage.style.height = ''; const z = $('qlmIvZoom'); if (z) z.textContent = Math.round(_ivScale / _ivFit * 100) + '%'; }
  function wirePinchZoom(stage, doc) {
    let d0 = 0, s0 = 1, lastTap = 0;
    stage.addEventListener('touchstart', e => {
      if (e.touches.length === 2) { d0 = dist(e.touches); s0 = _ivScale; doc.classList.add('dragging'); }
      else if (e.touches.length === 1) { const now = Date.now(); if (now - lastTap < 300) { _ivScale = (Math.abs(_ivScale - _ivFit) < 0.02) ? _ivFit * 2.2 : _ivFit; applyIvScale(); } lastTap = now; }
    }, { passive: true });
    stage.addEventListener('touchmove', e => { if (e.touches.length === 2 && d0) { const sc = s0 * dist(e.touches) / d0; _ivScale = Math.max(_ivFit * 0.8, Math.min(_ivFit * 4, sc)); applyIvScale(); } }, { passive: true });
    stage.addEventListener('touchend', e => { if (e.touches.length < 2) { d0 = 0; doc.classList.remove('dragging'); } });
    function dist(t) { const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.hypot(dx, dy); }
  }

  /* convenience: open the saved invoice #idx (used by shell/QLX on mobile) */
  function showInvoice(idx) {
    const s = window.QLShell; if (!s || !s.getInvoiceHTML) return false;
    const full = s.getInvoiceHTML(idx); if (!full) return false;
    // a bareless copy for the in-app viewer (hide the print bar)
    const d = Q() && Q().invoiceData ? Q().invoiceData(idx) : null;
    const bare = (d && s.renderInvoice) ? s.renderInvoice(Object.assign({}, d, { noBar: true })) : full;
    const title = d ? ('Invoice ' + (d.inv || '')) : 'Invoice';
    const shareText = d ? `${d.seller ? d.seller.name : 'Invoice'} · ${d.inv || ''} · ${fc(d.grand)} — ${d.buyer ? d.buyer.name : ''}` : title;
    invoiceViewer({ html: bare, printHtml: full, title, shareText,
      onPdf: () => s.printInvoice && s.printInvoice(idx, true), onPrint: () => { const w = window.open('', '_blank'); if (w) { w.document.write(full); w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 350); } } });
    return true;
  }

  /* ═══════════════ PULL TO REFRESH ═══════════════ */
  function wirePullToRefresh() {
    let sy = 0, pulling = false, dist = 0; const ptr = $('qlmPtr'); const TH = 72;
    document.addEventListener('touchstart', e => { if (window.scrollY <= 0 && !document.querySelector('.qlm-sheet-back.open, .qlm-as-back.open, .qlm-iv.open')) { sy = e.touches[0].clientY; pulling = true; dist = 0; } else pulling = false; }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!pulling) return; dist = e.touches[0].clientY - sy;
      if (dist > 0 && window.scrollY <= 0) { ptr.style.height = Math.min(dist * 0.5, 56) + 'px'; ptr.style.opacity = Math.min(1, dist / TH); if (dist > 8) e.preventDefault(); }
    }, { passive: false });
    document.addEventListener('touchend', () => {
      if (!pulling) return; pulling = false;
      if (dist > TH) { ptr.classList.add('spin'); ptr.style.height = '44px'; setTimeout(() => { doRefresh(); ptr.classList.remove('spin'); ptr.style.height = '0'; ptr.style.opacity = '0'; }, 650); }
      else { ptr.style.height = '0'; ptr.style.opacity = '0'; }
    });
  }
  function doRefresh() {
    try {
      if (_active === 'dashboard') { buildDashboard(); }
      else if (window.QLX && QLX.refresh) QLX.refresh();
      else if (window.QLFin && QLFin.render) QLFin.render();
    } catch (_) {}
    QLShell && QLShell.toast && QLShell.toast('Updated');
  }

  /* ═══════════════ MOBILE DASHBOARD ═══════════════ */
  const DTABS = [
    { key: 'overview', label: 'Overview' }, { key: 'sales', label: 'Sales' },
    { key: 'purchase', label: 'Purchase' }, { key: 'finance', label: 'Finance' }, { key: 'production', label: 'Production' }
  ];
  function trendHTML(t) {
    if (t == null) return `<span class="qlm-kpi-t flat">—</span>`;
    const up = t >= 0; return `<span class="qlm-kpi-t ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(t).toFixed(1)}%</span>`;
  }
  function kpiCard(o) {
    return `<div class="qlm-kpi" ${o.href ? `onclick="location.href='${o.href}'"` : ''}>
      <div class="qlm-kpi-ic qlm-tint-${o.tint}">${o.icon}</div>
      <div class="qlm-kpi-l">${esc(o.label)}</div>
      <div class="qlm-kpi-v">${o.value}</div>
      ${o.trend !== undefined ? trendHTML(o.trend) : ''}
      ${o.meta ? `<div class="qlm-kpi-m">${esc(o.meta)}</div>` : ''}
    </div>`;
  }
  function overviewCards() {
    const q = Q(); const k = q.kpis(); const bal = q.accountBalances ? q.accountBalances() : { cash: 0, bank: 0 };
    const ps = q.purchaseSummary ? q.purchaseSummary() : { pending: 0 };
    return [
      kpiCard({ label: 'Sales (month)', value: k.sales.v, tint: 'blue', icon: IC.sales, trend: k.sales.trend, href: 'sales.html' }),
      kpiCard({ label: 'Collections due', value: k.collections.v, tint: 'amber', icon: IC.coll, meta: k.collections.meta, href: 'collections.html' }),
      kpiCard({ label: 'Cash + Bank', value: fc((bal.cash || 0) + (bal.bank || 0)), tint: 'green', icon: IC.wallet, meta: 'Cash ' + fc(bal.cash || 0), href: 'payments.html' }),
      kpiCard({ label: 'Purchase due', value: fc(ps.pending || 0), tint: 'red', icon: IC.due, meta: 'To suppliers', href: 'payables.html' }),
      kpiCard({ label: 'Production', value: k.production.v, tint: 'violet', icon: IC.production, trend: k.production.trend, meta: k.production.meta }),
      kpiCard({ label: 'Profit (net)', value: k.profit.v, tint: 'cyan', icon: IC.trend, trend: k.profit.trend, meta: k.profit.meta, href: 'pl.html' })
    ].join('');
  }
  function miniBars(series, valFn, fmt) {
    const max = Math.max(1, ...series.map(valFn));
    return `<div class="qlm-bars">${series.map(s => `<div class="qlm-bar"><div class="qlm-bar-fill" style="height:${Math.max(4, valFn(s) / max * 100)}%"></div><div class="qlm-bar-lbl">${esc(s.label || s.month || '')}</div></div>`).join('')}</div>`;
  }
  function monthSeriesSafe(n) { try { const s = Q().monthSeries(n); return s.map(m => ({ label: (m.month || m.label || '').slice(5), sales: m.sales, purchases: m.purchases, qty: m.qty, profit: m.profit })); } catch (_) { return []; } }
  /* Shared native list row (avatar · name · vehicle/sub · date · amount · status · chevron).
     Used by the mobile dashboard AND the QLX mobile lists so Sales/Purchase match. */
  function listRow(c, opts) {
    opts = opts || {};
    const name = c.party || c.id || '';
    const attrs = (opts.id != null ? ` data-id="${esc(opts.id)}"` : '') + (opts.onclick ? ` onclick="${opts.onclick}"` : '');
    return `<div class="qlm-lrow"${attrs}>
      <div class="qlm-lrow-av" style="background:${avc(name)}">${esc((name || '?').charAt(0).toUpperCase())}</div>
      <div class="qlm-lrow-mid">
        <div class="qlm-lrow-name">${esc(name)}</div>
        ${c.sub ? `<div class="qlm-lrow-l1">${esc(c.sub)}</div>` : ''}
        ${c.date ? `<div class="qlm-lrow-l2">${IC.cal}${esc(c.date)}</div>` : ''}
      </div>
      <div class="qlm-lrow-right">${c.amount ? `<div class="qlm-lrow-amt">${c.amount}</div>` : ''}${c.status || ''}</div>
      <div class="qlm-lrow-chev">${IC.chev}</div>
    </div>`;
  }
  // vehicle number is the headline sub-line; fall back to the invoice/bill no. if none
  const vehSub = (veh, docLabel, doc) => veh ? ('🚚 ' + veh) : (docLabel + ': ' + (doc || '—'));

  function recentSales() {
    const rows = (Q().salesRows ? Q().salesRows() : []).slice(0, 6);
    if (!rows.length) return '';
    return `<div class="qlm-sec"><h3>Recent invoices</h3><a href="sales.html">View All</a></div><div class="qlm-list">` +
      rows.map(r => listRow({ party: r.party || '—', sub: vehSub(r.veh, 'Invoice', r.inv), date: r.date, amount: fc(r.total), status: statusPill(r.status) },
        { onclick: `QLMobile.showInvoice(${r.idx})` })).join('') +
      `</div>`;
  }
  function statusPill(s) { s = s || 'pending'; const map = { paid: ['ok', 'Paid'], cash: ['ok', 'Cash'], pending: ['warn', 'Pending'] }; const m = map[s] || ['mut', s]; return `<span class="qlm-pill ${m[0]}">${m[1]}</span>`; }
  function avc(name) { const p = ['#2563EB', '#16A34A', '#D97706', '#7C3AED', '#DB2777', '#0891B2']; let h = 0; for (const c of String(name || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return p[h % p.length]; }

  function dashTabContent(tab) {
    const q = Q(); if (!q) return '';
    if (tab === 'overview') return `<div class="qlm-kpis">${overviewCards()}</div>` + salesChartCard() + recentSales();
    if (tab === 'sales') { const s = q.salesSummary(); return `<div class="qlm-kpis">
        ${kpiCard({ label: 'Sales (excl GST)', value: fc(s.taxable), tint: 'blue', icon: IC.sales })}
        ${kpiCard({ label: 'Collected', value: fc(s.collected), tint: 'green', icon: IC.coll })}
        ${kpiCard({ label: 'Pending', value: fc(s.pending), tint: 'amber', icon: IC.due })}
        ${kpiCard({ label: 'Invoices', value: s.count, tint: 'violet', icon: IC.invoice })}
      </div>` + salesChartCard() + recentSales(); }
    if (tab === 'purchase') { const p = q.purchaseSummary(); return `<div class="qlm-kpis">
        ${kpiCard({ label: 'Purchases', value: fc(p.total), tint: 'blue', icon: IC.purchase })}
        ${kpiCard({ label: 'ITC', value: fc(p.itc), tint: 'green', icon: IC.finance })}
        ${kpiCard({ label: 'Payable', value: fc(p.pending), tint: 'red', icon: IC.due })}
        ${kpiCard({ label: 'Bills', value: p.count, tint: 'violet', icon: IC.box })}
      </div>` + chartCard('Purchases · last 3 months', monthSeriesSafe(3), s => s.purchases || 0); }
    if (tab === 'finance') { const b = q.accountBalances ? q.accountBalances() : { cash: 0, bank: 0, upi: 0, total: 0 }; return `<div class="qlm-kpis">
        ${kpiCard({ label: 'Cash', value: fc(b.cash), tint: 'green', icon: IC.wallet })}
        ${kpiCard({ label: 'Bank', value: fc(b.bank), tint: 'blue', icon: IC.bank })}
        ${kpiCard({ label: 'UPI', value: fc(b.upi), tint: 'violet', icon: IC.finance })}
        ${kpiCard({ label: 'Total balance', value: fc(b.total), tint: 'cyan', icon: IC.trend })}
      </div>`; }
    if (tab === 'production') { const k = q.kpis(); return `<div class="qlm-kpis">
        ${kpiCard({ label: 'Total dispatched', value: k.production.v, tint: 'violet', icon: IC.production, trend: k.production.trend })}
        ${kpiCard({ label: 'This month', value: k.dispatch.v, tint: 'blue', icon: IC.box, meta: k.dispatch.meta })}
      </div>` + chartCard('Quantity · last 3 months (T)', monthSeriesSafe(3), s => s.qty || 0); }
    return '';
  }
  function salesChartCard() { return chartCard('Sales · last 3 months', monthSeriesSafe(3), s => s.sales || 0); }
  function chartCard(title, series, valFn) {
    if (!series.length) return '';
    const tot = series.reduce((a, s) => a + valFn(s), 0);
    return `<div class="qlm-chartcard"><div class="qlm-chartcard-h"><span class="t">${esc(title)}</span><span class="s">${fc(tot)}</span></div>${miniBars(series, valFn)}</div>`;
  }

  function buildDashboard() {
    if (!isMobile()) return;                 // desktop keeps its own .dx dashboard
    const main = $('ql-main'); if (!main || !Q()) return;
    if (_dashObs) _dashObs.disconnect();     // our own mutations must not re-trigger us
    // desktop .dx is hidden purely by CSS (#ql-main > .dx) — no inline mutation, so
    // nothing to undo if the viewport later widens
    let root = main.querySelector('.qlm-dash');
    if (!root) { root = el('div', 'qlm-dash'); main.appendChild(root); }
    const co = Q().co ? Q().co.short : '';
    root.innerHTML =
      `<div class="qlm-dash-greet"><h1>Welcome back</h1><p>${esc(co)} · here's today</p></div>
       <div class="qlm-seg">${DTABS.map(t => `<button class="qlm-seg-btn ${t.key === _dashTab ? 'active' : ''}" data-dt="${t.key}">${t.label}</button>`).join('')}</div>
       <div id="qlmDashBody">${dashTabContent(_dashTab)}</div>`;
    root.querySelectorAll('[data-dt]').forEach(b => b.onclick = () => { _dashTab = b.dataset.dt; root.querySelectorAll('[data-dt]').forEach(x => x.classList.toggle('active', x === b)); $('qlmDashBody').innerHTML = dashTabContent(_dashTab); animateBars(); });
    animateBars();
    // rebuild whenever the desktop dashboard re-renders into #ql-main (fresh data)
    if (!_dashObs) _dashObs = new MutationObserver(() => { clearTimeout(_dashObs._t); _dashObs._t = setTimeout(buildDashboard, 50); });
    _dashObs.observe(main, { childList: true });
  }
  function animateBars() { requestAnimationFrame(() => document.querySelectorAll('.qlm-bar-fill').forEach(b => { const h = b.style.height; b.style.height = '0'; requestAnimationFrame(() => b.style.height = h); })); }

  /* ═══════════════ SKELETON ═══════════════ */
  function skeleton(container) {
    if (!container) return;
    container.innerHTML = `<div class="qlm-skel-wrap"><div class="qlm-skel" style="height:96px"></div><div class="qlm-skel" style="height:96px"></div><div class="qlm-skel" style="height:180px;margin-top:6px"></div><div class="qlm-skel" style="height:64px"></div><div class="qlm-skel" style="height:64px"></div></div>`;
  }

  /* ═══════════════ INIT ═══════════════ */
  function init(opts) {
    opts = opts || {};
    _active = opts.active || _active;
    if (opts.title != null) _title = opts.title;
    if (!isMobile()) return;             // desktop: do nothing
    build();
    paintChrome();
    if (_active === 'dashboard') buildDashboard();
    // repaint chrome shortly after (avatar/badges settle post-data)
    setTimeout(paintChrome, 400);
  }

  // keep chrome correct if the viewport crosses the breakpoint
  MQ.addEventListener && MQ.addEventListener('change', () => { if (isMobile()) { build(); paintChrome(); if (_active === 'dashboard') buildDashboard(); } });

  // fallback init (in case a page doesn't route through QLShell.mount)
  function fallback() { if (isMobile() && document.querySelector('.shell') && !_built) init({ active: (window.QLShell && QLShell._active) || guessActive() }); if (_built) paintChrome(); }
  function guessActive() { const f = (location.pathname.split('/').pop() || '').replace('.html', ''); return f || 'dashboard'; }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(fallback, 350));
  else setTimeout(fallback, 350);

  window.QLMobile = {
    init, isMobile, sheet, actionSheet, wizard, invoiceViewer, showInvoice, listRow,
    buildDashboard, skeleton, refresh: doRefresh, paintChrome,
    openMore, filterSheet: sheet    // filterSheet is a themed bottom sheet
  };
})();
