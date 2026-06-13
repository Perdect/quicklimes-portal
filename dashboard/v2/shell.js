/* ═══════════════════════════════════════════════════════════════
   QuickLimes v2 — Shared App Shell
   Injects the sidebar + topbar + command palette + profile menu +
   photo modal around each page's content, wires every interaction,
   and integrates with the QLD data layer (workspace switcher,
   profile, palette search). One copy, used by every v2 page.

   Usage in a page:
     <body class="ql-v2">
       <div id="ql-page"> …page content… </div>
       <script src="./data.js"></script>
       <script src="./shell.js"></script>
       <script> QLShell.mount({ active:'sales', title:'Sales Register' });
                 // ...then the page render code... </script>
     </body>
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── SVG icon set ────────────────────────────────────────────── */
  const I = {
    grid:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    invoice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    sales:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
    coll:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
    bag:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
    factory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V8.5a1 1 0 0 1 .5-.87L12 4l6.5 3.63a1 1 0 0 1 .5.87V21M9 9v12M15 9v12M9 13h6"/></svg>',
    clock:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>',
    flame:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 4 13V8h14v5a7 7 0 0 1-7 7Z"/><line x1="9" y1="3" x2="9" y2="6"/><line x1="13" y1="3" x2="13" y2="6"/></svg>',
    bars:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V12M9 21V8M13 21V4M17 21V11M21 21V14"/></svg>',
    cal:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    layers:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5z"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    box:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    truck:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    card:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>',
    bank:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h18M3 8l9-6 9 6M6 14v4M10 14v4M14 14v4M18 14v4M3 21h18"/></svg>',
    receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7"/><polyline points="14 14 14 19 19 19"/></svg>',
    chart:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>',
    users:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    check:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    wallet:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 10h20M7 15h2M13 15h4"/></svg>',
    dl:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    pulse:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    gear:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
  };

  /* ── Navigation registry — single source of truth ───────────── */
  const SOON = '#soon';
  const NAV = [
    { type: 'solo', id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: I.grid },
    { type: 'group', label: 'Sales', items: [
      { id: 'invoice',     label: 'GST Invoice',     href: SOON,         icon: I.invoice },
      { id: 'sales',       label: 'Sales Register',  href: 'sales.html', icon: I.sales },
      { id: 'collections', label: 'Collections',     href: 'sales.html?filter=pending', icon: I.coll, badgeKey: 'collections' }
    ]},
    { type: 'group', label: 'Purchases', items: [
      { id: 'purchase',  label: 'Purchase Register', href: SOON, icon: I.bag },
      { id: 'suppliers', label: 'Suppliers',         href: SOON, icon: I.factory }
    ]},
    { type: 'group', label: 'Production', items: [
      { id: 'ql-prod',  label: 'Quick Lime Production', href: SOON, icon: I.clock },
      { id: 'chunna',   label: 'Chunna Production',     href: SOON, icon: I.flame },
      { id: 'kiln',     label: 'Kiln Management',       href: SOON, icon: I.bars, badge: { text: 'soon', tone: 'info' } },
      { id: 'daily',    label: 'Daily Production',      href: SOON, icon: I.cal }
    ]},
    { type: 'group', label: 'Inventory', items: [
      { id: 'raw',      label: 'Raw Material',     href: SOON, icon: I.layers },
      { id: 'stock',    label: 'Stock Management', href: SOON, icon: I.box },
      { id: 'dispatch', label: 'Dispatch',         href: SOON, icon: I.truck }
    ]},
    { type: 'group', label: 'Finance', items: [
      { id: 'expenses', label: 'Expenses',      href: SOON, icon: I.card },
      { id: 'loans',    label: 'Loans',         href: SOON, icon: I.bank },
      { id: 'gst',      label: 'GST',           href: SOON, icon: I.receipt },
      { id: 'pl',       label: 'Profit & Loss', href: SOON, icon: I.chart }
    ]},
    { type: 'group', label: 'People', items: [
      { id: 'labour',     label: 'Labour',     href: SOON, icon: I.users },
      { id: 'attendance', label: 'Attendance', href: SOON, icon: I.check },
      { id: 'payroll',    label: 'Payroll',    href: SOON, icon: I.wallet }
    ]},
    { type: 'group', label: 'Reports', items: [
      { id: 'biz-an',  label: 'Business Analytics',   href: SOON, icon: I.dl },
      { id: 'prod-an', label: 'Production Analytics', href: SOON, icon: I.pulse }
    ]},
    { type: 'solo', id: 'settings', label: 'Settings', href: SOON, icon: I.gear, soloTop: true }
  ];

  /* ── Build sidebar nav HTML ──────────────────────────────────── */
  function navHTML(active) {
    let h = '';
    NAV.forEach(sec => {
      if (sec.type === 'solo') {
        h += `<div class="sb-solo"${sec.soloTop ? ' style="margin-top:var(--ql-space-2)"' : ''}>
          <a class="sb-link${sec.id === active ? ' active' : ''}" href="${sec.href}" data-page="${sec.id}">
            ${sec.icon}<span class="sb-link-text">${sec.label}</span>
          </a></div>`;
      } else {
        const open = sec.items.some(it => it.id === active);
        h += `<div class="sb-group${open ? '' : ''}">
          <button class="sb-group-title" onclick="QLShell.toggleGroup(this)"><span>${sec.label}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
          <div class="sb-group-body">` +
          sec.items.map(it => {
            let badge = '';
            if (it.badge) badge = `<span class="sb-link-badge"${it.badge.tone === 'info' ? ' style="background:var(--ql-brand-100);color:var(--ql-brand-700)"' : it.badge.tone === 'success' ? ' style="background:var(--ql-success-100);color:var(--ql-success-700)"' : ''}>${it.badge.text}</span>`;
            else if (it.badgeKey) badge = `<span class="sb-link-badge" data-badge="${it.badgeKey}" hidden></span>`;
            return `<a class="sb-link${it.id === active ? ' active' : ''}" href="${it.href}" data-page="${it.id}">${it.icon}<span class="sb-link-text">${it.label}</span>${badge}</a>`;
          }).join('') +
          `</div></div>`;
      }
    });
    return h;
  }

  /* ── Full shell markup ───────────────────────────────────────── */
  function shellHTML(active, pageContent) {
    return `
<div class="shell" data-collapsed="false" id="shell">
  <aside class="sidebar" id="sidebar">
    <div class="sb-head">
      <button class="workspace" id="wsBtn" aria-expanded="false">
        <span class="workspace-avatar">D</span>
        <span class="workspace-text">
          <span class="workspace-name">Loading…</span>
          <span class="workspace-meta">Quick Lime</span>
        </span>
        <svg class="workspace-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="ws-menu" id="wsMenu"></div>
      <button class="sb-search" onclick="QLShell.openPalette()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span class="sb-search-text">Search</span><span class="sb-search-kbd">⌘K</span>
      </button>
    </div>
    <nav class="sb-nav">${navHTML(active)}</nav>
    <div class="sb-foot">
      <div class="sb-upgrade">
        <div class="sb-upgrade-title"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 9 9 2 9.5l5 5L5.5 22 12 18l6.5 4-1.5-7.5 5-5L15 9z"/></svg><span>Trial · 14 days left</span></div>
        <div class="sb-upgrade-text">Upgrade to unlock production analytics, AI insights and unlimited child plants.</div>
        <button class="sb-upgrade-btn">Upgrade plan</button>
      </div>
      <button class="sb-profile" id="sbProfile" data-profile-trigger>
        <span class="sb-profile-av" data-avatar>D</span>
        <span class="sb-profile-text"><span class="sb-profile-name">Owner</span><span class="sb-profile-role">Owner</span></span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>
      </button>
    </div>
  </aside>

  <div class="mobile-backdrop" id="mobBack" onclick="QLShell.toggleMobileSidebar(false)"></div>

  <header class="topbar">
    <button class="tb-toggle" onclick="QLShell.toggleSidebar()" aria-label="Toggle sidebar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
    <nav class="tb-crumb" aria-label="Breadcrumb">
      <span>QuickLimes</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="tb-crumb-active">Dashboard</span>
    </nav>
    <div class="tb-spacer"></div>
    <button class="tb-search-bar" onclick="QLShell.openPalette()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <span>Search anything…</span><span class="sb-search-kbd">⌘K</span>
    </button>
    <button class="tb-action" title="New (N)" onclick="QLShell.openPalette()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
    <button class="tb-action" title="Notifications" onclick="QLShell.openPalette()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span class="tb-action-dot" id="tbNotifDot" style="display:none"></span>
    </button>
    <button class="tb-action is-ai" title="Ask AI" onclick="QLShell.openPalette()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15 9 22 12 15 15 12 22 9 15 2 12 9 9 12 2"/></svg>
    </button>
    <button class="tb-avatar" id="tbAvatar" data-profile-trigger data-avatar>D</button>
  </header>

  <main class="main" id="ql-main"></main>
</div>

<!-- profile menu -->
<div class="profile-menu" id="profileMenu" role="menu">
  <div class="profile-menu-head">
    <div class="profile-menu-av" data-avatar>D</div>
    <div class="profile-menu-text"><div class="profile-menu-name" id="pmName">Owner</div><div class="profile-menu-email" id="pmEmail">—</div></div>
  </div>
  <button class="profile-menu-item" id="pmChangePhoto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><span>Change photo</span></button>
  <button class="profile-menu-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span>Edit profile</span></button>
  <button class="profile-menu-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 4.29 16.96l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg><span>Account settings</span></button>
  <div class="profile-menu-sep"></div>
  <button class="profile-menu-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span>Help & support</span></button>
  <button class="profile-menu-item profile-menu-item-danger" id="pmSignout"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span>Sign out</span></button>
</div>

<!-- photo crop modal -->
<input type="file" id="photoInput" accept="image/*" style="display:none" />
<div class="photo-backdrop" id="photoBack" onclick="if(event.target===this)QLShell.closePhotoModal()">
  <div class="photo-modal" role="dialog" aria-label="Change profile photo">
    <h3>Change profile photo</h3>
    <div id="photoEmpty" class="photo-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      <span>Pick a square photo — at least 256×256.</span>
      <button class="ql-btn ql-btn-primary photo-pick-btn" onclick="document.getElementById('photoInput').click()">Choose image</button>
    </div>
    <div id="photoCropUI" style="display:none;flex-direction:column;gap:var(--ql-space-4)">
      <div class="photo-stage" id="photoStage"><canvas id="photoCanvas" width="280" height="280"></canvas><div class="photo-mask"></div></div>
      <div class="photo-zoom"><span class="photo-zoom-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg></span><input type="range" id="photoZoom" min="1" max="3" step="0.01" value="1" /></div>
      <div class="photo-actions">
        <button class="ql-btn ql-btn-ghost" onclick="document.getElementById('photoInput').click()">Change image</button>
        <button class="ql-btn ql-btn-secondary" id="photoRemoveBtn" onclick="QLShell.removePhoto()">Remove</button>
        <button class="ql-btn ql-btn-secondary" onclick="QLShell.closePhotoModal()">Cancel</button>
        <button class="ql-btn ql-btn-primary" onclick="QLShell.savePhoto()">Save photo</button>
      </div>
    </div>
  </div>
</div>

<!-- command palette -->
<div class="palette-backdrop" id="paletteBack" onclick="if(event.target===this)QLShell.closePalette()">
  <div class="palette" id="palette" role="dialog" aria-label="Command palette">
    <div class="palette-input-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input class="palette-input" id="paletteInput" placeholder="Search invoices, parties, suppliers, labour or actions…" />
      <span class="palette-input-kbd">ESC</span>
    </div>
    <div class="palette-list" id="paletteList"></div>
    <div class="palette-foot"><span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span><kbd>ESC</kbd> close</span></div>
  </div>
</div>`;
  }

  /* ── Toast ───────────────────────────────────────────────────── */
  let toastTimer;
  function toast(msg) {
    let t = document.getElementById('ql-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'ql-toast';
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--ql-neutral-900);color:#fff;padding:11px 18px;border-radius:12px;font-size:13px;font-weight:600;font-family:Inter,sans-serif;box-shadow:var(--ql-shadow-lg);z-index:9999;opacity:0;transition:opacity .2s,transform .2s;pointer-events:none';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(20px)'; }, 2200);
  }

  /* ════════════════════════ INTERACTIONS ════════════════════════ */
  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
  const $ = id => document.getElementById(id);

  /* sidebar */
  function toggleSidebar() {
    if (isMobile()) toggleMobileSidebar();
    else { const s = $('shell'); s.dataset.collapsed = s.dataset.collapsed === 'true' ? 'false' : 'true'; }
  }
  function toggleMobileSidebar(force) {
    const open = (typeof force === 'boolean') ? force : !$('sidebar').classList.contains('open');
    $('sidebar').classList.toggle('open', open);
    $('mobBack').classList.toggle('open', open);
  }
  function toggleGroup(btn) { btn.parentElement.classList.toggle('collapsed'); }

  /* "coming soon" link interception */
  function wireNav() {
    document.querySelectorAll('.sb-link').forEach(link => {
      link.addEventListener('click', e => {
        const href = link.getAttribute('href');
        if (href === SOON) {
          e.preventDefault();
          toast((link.querySelector('.sb-link-text')?.textContent || 'This page') + ' — coming soon in v2');
        }
        if (isMobile()) toggleMobileSidebar(false);
      });
    });
  }

  /* ── Workspace switcher (from QLD) ───────────────────────────── */
  const AVG = ['#2563EB,#1D4ED8', '#F59E0B,#D97706', '#16A34A,#15803D', '#7C3AED,#5B21B6', '#DB2777,#9D174D', '#0891B2,#155E75'];
  function paintWorkspace() {
    const Q = window.QLD; if (!Q) return;
    const co = Q.co;
    const wsAv = document.querySelector('#wsBtn .workspace-avatar');
    const wsNm = document.querySelector('#wsBtn .workspace-name');
    const wsMeta = document.querySelector('#wsBtn .workspace-meta');
    if (wsAv) wsAv.textContent = co.short.charAt(0).toUpperCase();
    if (wsNm) wsNm.textContent = co.short;
    if (wsMeta) wsMeta.textContent = (co.isPrimary ? 'Primary' : 'Linked') + ' · Quick Lime';
    const menu = $('wsMenu');
    menu.innerHTML = Object.values(Q.COMPANIES).map((c, i) => `
      <button class="ws-row ${c.key === Q.activeCo ? 'active' : ''}" data-co="${c.key}">
        <span class="ws-row-av" style="background:linear-gradient(135deg,${AVG[i % AVG.length]})">${c.short.charAt(0).toUpperCase()}</span>
        <span>${c.short}</span>
        ${c.key === Q.activeCo ? '<svg style="margin-left:auto;width:14px;height:14px;color:var(--ql-brand-600)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
      </button>`).join('') +
      `<div style="height:1px;background:var(--ql-border);margin:var(--ql-space-1) var(--ql-space-2)"></div>
       <button class="ws-row ws-add"><span class="ws-row-av"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span><span>Add company</span></button>`;
    menu.querySelectorAll('.ws-row[data-co]').forEach(row => row.addEventListener('click', () => {
      menu.classList.remove('open');
      if (typeof window.__qlOnSwitchCompany === 'function') window.__qlOnSwitchCompany(row.dataset.co);
    }));
    const addBtn = menu.querySelector('.ws-add');
    if (addBtn) addBtn.addEventListener('click', () => { menu.classList.remove('open'); toast('Add company — contact support to link a plant'); });
    // profile name
    const sbName = document.querySelector('.sb-profile-name');
    if (sbName) sbName.textContent = co.short;
    const pmName = $('pmName'); if (pmName) pmName.textContent = Q.plant.owner_name || co.short;
    const pmEmail = $('pmEmail'); if (pmEmail) pmEmail.textContent = Q.plant.owner_phone ? ('+91 ' + Q.plant.owner_phone) : '—';
    // collections badge
    try {
      const c = Q.collections('overdue');
      document.querySelectorAll('[data-badge="collections"]').forEach(b => {
        if (c.parties > 0) { b.hidden = false; b.textContent = c.parties; } else { b.hidden = true; }
      });
    } catch (_) {}
  }
  function wireWorkspace() {
    const wsBtn = $('wsBtn'), menu = $('wsMenu');
    wsBtn.addEventListener('click', e => { e.stopPropagation(); const o = menu.classList.toggle('open'); wsBtn.setAttribute('aria-expanded', o); });
    document.addEventListener('click', e => { if (!menu.contains(e.target) && e.target !== wsBtn && !wsBtn.contains(e.target)) menu.classList.remove('open'); });
  }

  /* ── Command palette (real QLD data) ─────────────────────────── */
  const PAGE_HREF = {}; NAV.forEach(s => s.type === 'solo' ? (PAGE_HREF[s.label] = s.href) : s.items.forEach(it => PAGE_HREF[it.label] = it.href));
  let pFocus = 0;
  const PIC = {
    grid: I.grid, sales: I.sales, bag: I.bag, users: I.users, spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15 9 22 12 15 15 12 22 9 15 2 12 9 9 12 2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
  };
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function paletteItems(q) {
    const Q = window.QLD;
    const res = [];
    // pages always
    [['Dashboard', 'dashboard.html', 'grid'], ['Sales Register', 'sales.html', 'sales'], ['Collections', 'sales.html?filter=pending', 'sales']]
      .forEach(([t, href, ic]) => { if (!q || t.toLowerCase().includes(q)) res.push({ group: 'Go to', icon: ic, t, s: 'Page', href }); });
    if (Q && q) {
      const ql = q;
      [...new Set(Q.state.PARTIES.map(p => p.name))].filter(n => n.toLowerCase().includes(ql)).slice(0, 5)
        .forEach(n => res.push({ group: 'Parties', icon: 'users', t: n, s: 'Customer / supplier', href: 'sales.html' }));
      Q.state.SALES.filter(s => (s.inv + ' ' + s.party).toLowerCase().includes(ql)).slice(0, 6)
        .forEach(s => res.push({ group: 'Invoices', icon: 'sales', t: s.inv + ' — ' + s.party, s: Q.fDS(s.date), href: 'sales.html' }));
    }
    return res.slice(0, 18);
  }
  function renderPalette(q) {
    q = (q || '').trim().toLowerCase();
    const items = paletteItems(q);
    const list = $('paletteList');
    if (!items.length) { list.innerHTML = `<div style="padding:var(--ql-space-6);text-align:center;color:var(--ql-text-muted);font-size:var(--ql-text-md)">No results for "${esc(q)}"</div>`; return; }
    let h = '', last = '', idx = 0;
    items.forEach(it => {
      if (it.group !== last) { h += `<div class="palette-group-title">${it.group}</div>`; last = it.group; }
      h += `<a class="palette-row${idx === pFocus ? ' is-focused' : ''}" data-idx="${idx}" href="${it.href}">
        <span class="palette-row-ic">${PIC[it.icon] || PIC.grid}</span>
        <span class="palette-row-body"><div class="palette-row-title">${esc(it.t)}</div><div class="palette-row-meta">${esc(it.s)}</div></span></a>`;
      idx++;
    });
    list.innerHTML = h;
  }
  function openPalette() { pFocus = 0; $('paletteBack').classList.add('open'); renderPalette(''); setTimeout(() => $('paletteInput').focus(), 0); }
  function closePalette() { $('paletteBack').classList.remove('open'); $('paletteInput').value = ''; }
  function wirePalette() {
    $('paletteInput').addEventListener('input', e => { pFocus = 0; renderPalette(e.target.value); });
    $('paletteInput').addEventListener('keydown', e => {
      const rows = [...document.querySelectorAll('.palette-row')];
      if (e.key === 'ArrowDown') { e.preventDefault(); pFocus = Math.min(pFocus + 1, rows.length - 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); pFocus = Math.max(pFocus - 1, 0); }
      else if (e.key === 'Enter') { e.preventDefault(); rows[pFocus]?.click(); return; }
      else return;
      rows.forEach((r, i) => r.classList.toggle('is-focused', i === pFocus));
      rows[pFocus]?.scrollIntoView({ block: 'nearest' });
    });
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
      if (e.key === 'Escape') { closePalette(); }
    });
  }

  /* ── Profile menu + photo (ported) ───────────────────────────── */
  const PHOTO_KEY = 'ql_v2_profile_photo';
  function applyAvatarPhoto(url) {
    document.querySelectorAll('[data-avatar]').forEach(el => {
      if (url) { el.style.setProperty('--ql-photo', `url('${url}')`); el.classList.add('has-photo'); }
      else { el.style.removeProperty('--ql-photo'); el.classList.remove('has-photo'); }
    });
  }
  function openProfileMenu(trigger) {
    const m = $('profileMenu'), r = trigger.getBoundingClientRect();
    if (trigger.classList.contains('tb-avatar')) { m.style.top = (r.bottom + 8) + 'px'; m.style.left = (r.right - 240) + 'px'; }
    else { m.classList.add('open'); m.style.top = (r.top - 8 - m.offsetHeight) + 'px'; m.style.left = r.left + 'px'; return; }
    m.classList.add('open');
  }
  function wireProfile() {
    const m = $('profileMenu');
    document.querySelectorAll('[data-profile-trigger]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      if (m.classList.contains('open')) m.classList.remove('open'); else openProfileMenu(btn);
    }));
    document.addEventListener('click', e => { if (!m.contains(e.target) && !e.target.closest('[data-profile-trigger]')) m.classList.remove('open'); });
    $('pmSignout').addEventListener('click', () => {
      localStorage.removeItem('ql_plant'); localStorage.removeItem('dm_active_co');
      const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
      location.replace(isLocal ? '/quicklime.html' : 'https://quicklimes.com/portal');
    });
    // photo
    const crop = { img: null, scale: 1, base: 1, dx: 0, dy: 0 };
    const stage = $('photoStage'), canvas = $('photoCanvas'), zoom = $('photoZoom');
    function draw() {
      if (!crop.img) return;
      const ctx = canvas.getContext('2d'), size = 280;
      ctx.fillStyle = '#0F172A'; ctx.fillRect(0, 0, size, size);
      const s = crop.base * crop.scale, dw = crop.img.width * s, dh = crop.img.height * s;
      crop.dx = Math.min(0, Math.max(size - dw - (size - dw) / 2, crop.dx));
      crop.dy = Math.min(0, Math.max(size - dh - (size - dh) / 2, crop.dy));
      ctx.drawImage(crop.img, (size - dw) / 2 + crop.dx, (size - dh) / 2 + crop.dy, dw, dh);
    }
    $('pmChangePhoto').addEventListener('click', () => {
      m.classList.remove('open');
      $('photoBack').classList.add('open');
      $('photoRemoveBtn').style.display = localStorage.getItem(PHOTO_KEY) ? '' : 'none';
      $('photoEmpty').style.display = crop.img ? 'none' : 'flex';
      $('photoCropUI').style.display = crop.img ? 'flex' : 'none';
    });
    $('photoInput').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = ev => { const im = new Image(); im.onload = () => { crop.img = im; crop.base = Math.max(280 / im.width, 280 / im.height); crop.scale = 1; crop.dx = crop.dy = 0; zoom.value = 1; $('photoEmpty').style.display = 'none'; $('photoCropUI').style.display = 'flex'; draw(); }; im.src = ev.target.result; };
      rd.readAsDataURL(f); e.target.value = '';
    });
    zoom.addEventListener('input', e => { crop.scale = parseFloat(e.target.value); draw(); });
    let drag = null;
    stage.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, dx: crop.dx, dy: crop.dy }; });
    window.addEventListener('pointermove', e => { if (!drag) return; crop.dx = drag.dx + (e.clientX - drag.x); crop.dy = drag.dy + (e.clientY - drag.y); draw(); });
    window.addEventListener('pointerup', () => drag = null);
    QLShell.savePhoto = function () {
      if (!crop.img) { $('photoBack').classList.remove('open'); return; }
      const out = document.createElement('canvas'); out.width = out.height = 200;
      out.getContext('2d').drawImage(canvas, 0, 0, 280, 280, 0, 0, 200, 200);
      const url = out.toDataURL('image/jpeg', 0.88);
      localStorage.setItem(PHOTO_KEY, url); localStorage.setItem('dm_profile_pic', url);
      applyAvatarPhoto(url); $('photoBack').classList.remove('open');
    };
    QLShell.removePhoto = function () {
      localStorage.removeItem(PHOTO_KEY); localStorage.removeItem('dm_profile_pic');
      crop.img = null; applyAvatarPhoto(null); $('photoBack').classList.remove('open');
    };
  }

  /* ════════════════════════ PUBLIC API ══════════════════════════ */
  window.QLShell = {
    toggleSidebar, toggleMobileSidebar, toggleGroup, openPalette, closePalette, toast,
    closePhotoModal() { $('photoBack').classList.remove('open'); },
    savePhoto() {}, removePhoto() {},
    paintWorkspace,
    setBreadcrumb(label) { const c = document.querySelector('.tb-crumb-active'); if (c) c.textContent = label; },
    setNotifDot(on) { const d = $('tbNotifDot'); if (d) d.style.display = on ? '' : 'none'; },

    mount(opts) {
      opts = opts || {};
      const page = document.getElementById('ql-page');
      const content = page ? page.innerHTML : '';
      if (page) page.remove();
      // inject shell
      const wrap = document.createElement('div');
      wrap.innerHTML = shellHTML(opts.active || 'dashboard', '');
      while (wrap.firstChild) document.body.insertBefore(wrap.firstChild, document.body.firstChild);
      $('ql-main').innerHTML = content;
      // wire
      wireNav(); wireWorkspace(); wirePalette(); wireProfile();
      // restore photo
      const photo = localStorage.getItem('dm_profile_pic') || localStorage.getItem(PHOTO_KEY);
      if (photo) applyAvatarPhoto(photo);
      // breadcrumb
      if (opts.title) this.setBreadcrumb(opts.title);
      renderPalette('');
    }
  };
})();
