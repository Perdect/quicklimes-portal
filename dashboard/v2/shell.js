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
  /* ── Feature flags (managed from Settings → Feature Management) ───
     Hide/show whole modules without deleting anything. Persisted in
     localStorage so the choice survives refresh/login on this device.
     Sidebar, command palette and dashboard all respect these flags. */
  const FEATURES = [
    { key: 'dashboard',  label: 'Dashboard',        desc: 'Business overview & KPIs',                    core: true, locked: true },
    { key: 'sales',      label: 'Sales',            desc: 'GST Invoice · Sales Register · Collections',  core: true },
    { key: 'purchase',   label: 'Purchase',         desc: 'Purchase Register · Suppliers',               core: true },
    { key: 'finance',    label: 'Finance',          desc: 'Payments · Expenses · Partner Ledger / Loans', core: true },
    { key: 'settings',   label: 'Settings',         desc: 'App settings & Feature Management',            core: true, locked: true },
    { key: 'command',    label: 'Command Center',   desc: 'Owner command dashboard' },
    { key: 'monthreg',   label: 'Monthly Register', desc: 'Combined monthly sales & purchase register' },
    { key: 'advfinance', label: 'GST · TDS · P&L',  desc: 'GST filing, TDS and Profit & Loss' },
    { key: 'people',     label: 'Parties & Labour', desc: 'All parties, labour and attendance' },
    { key: 'production', label: 'Production',        desc: 'Quick Lime, Chunna, Kiln & Daily production' },
    { key: 'inventory',  label: 'Inventory',         desc: 'Raw material, stock and dispatch' },
    { key: 'reports',    label: 'Reports & Analytics', desc: 'Reports hub and analytics' }
  ];
  const FEAT_DEFAULT_ON = { dashboard: 1, sales: 1, purchase: 1, finance: 1, settings: 1 };
  const FEAT_KEY = 'ql_features';
  function loadFeatures() {
    const f = {}; FEATURES.forEach(x => { f[x.key] = !!FEAT_DEFAULT_ON[x.key]; });
    try { const s = JSON.parse(localStorage.getItem(FEAT_KEY) || '{}'); Object.keys(s).forEach(k => { if (k in f) f[k] = !!s[k]; }); } catch (_) {}
    FEATURES.forEach(x => { if (x.locked) f[x.key] = true; });   // core-locked always on
    return f;
  }
  let FEAT = loadFeatures();
  const featOn = k => FEAT[k] !== false;
  function setFeat(k, on) { const x = FEATURES.find(y => y.key === k); if (!x || x.locked) return; FEAT[k] = !!on; try { localStorage.setItem(FEAT_KEY, JSON.stringify(FEAT)); } catch (_) {} }

  const NAV = [
    { type: 'solo', id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: I.grid, feat: 'dashboard' },
    { type: 'solo', id: 'command', label: 'Command Center', href: 'command.html', icon: I.pulse, feat: 'command' },
    { type: 'group', label: 'Sales', feat: 'sales', items: [
      { id: 'invoice',     label: 'GST Invoice',     href: 'invoice.html', icon: I.invoice },
      { id: 'sales',       label: 'Sales Register',  href: 'sales.html', icon: I.sales },
      { id: 'collections', label: 'Collections',     href: 'collections.html', icon: I.coll, badgeKey: 'collections' },
      { id: 'monthreg',    label: 'Monthly Register', href: 'monthreg.html', icon: I.cal, feat: 'monthreg' }
    ]},
    { type: 'group', label: 'Purchase', feat: 'purchase', items: [
      { id: 'purchase',  label: 'Purchase Register', href: 'purchase.html', icon: I.bag },
      { id: 'payables',  label: 'Payments Due',      href: 'payables.html', icon: I.card, badgeKey: 'payables' },
      { id: 'suppliers', label: 'Suppliers',         href: 'parties.html#supplier', icon: I.factory }
    ]},
    { type: 'group', label: 'Finance', feat: 'finance', items: [
      { id: 'finance',  label: 'Payments Center',          href: 'payments.html', icon: I.bank },
      { id: 'reconcile', label: 'Bank Reconciliation',     href: 'reconcile.html', icon: I.bank },
      { id: 'cashbook', label: 'Expenses',                 href: 'cashbook.html', icon: I.card },
      { id: 'loans',    label: 'Partner Ledger / Loans',   href: 'loans.html',    icon: I.receipt },
      { id: 'gst',      label: 'GST Filing', href: 'gst.html', icon: I.receipt, feat: 'advfinance' },
      { id: 'tds',      label: 'TDS',        href: 'tds.html', icon: I.receipt, feat: 'advfinance' },
      { id: 'pl',       label: 'Profit & Loss', href: 'pl.html', icon: I.chart, feat: 'advfinance' }
    ]},
    { type: 'group', label: 'Production', feat: 'production', items: [
      { id: 'ql-prod',  label: 'Quick Lime Production', href: 'production.html', icon: I.clock },
      { id: 'chunna',   label: 'Chunna Production',     href: 'chunna.html', icon: I.flame },
      { id: 'kiln',     label: 'Kiln Management',       href: SOON, icon: I.bars, soon: true },
      { id: 'daily',    label: 'Daily Production',      href: SOON, icon: I.cal, soon: true }
    ]},
    { type: 'group', label: 'Inventory', feat: 'inventory', items: [
      { id: 'raw',      label: 'Raw Material',     href: SOON, icon: I.layers, soon: true },
      { id: 'stock',    label: 'Stock Management', href: SOON, icon: I.box, soon: true },
      { id: 'dispatch', label: 'Dispatch',         href: SOON, icon: I.truck, soon: true }
    ]},
    { type: 'group', label: 'People', feat: 'people', items: [
      { id: 'parties',    label: 'All Parties', href: 'parties.html', icon: I.users },
      { id: 'labour',     label: 'Labour',      href: 'labour.html',  icon: I.users },
      { id: 'attendance', label: 'Attendance',  href: 'attendance.html', icon: I.check }
    ]},
    { type: 'group', label: 'Reports', feat: 'reports', items: [
      { id: 'reports', label: 'Reports Hub',          href: 'reports.html', icon: I.dl },
      { id: 'biz-an',  label: 'Business Analytics',   href: SOON, icon: I.pulse, soon: true },
      { id: 'prod-an', label: 'Production Analytics', href: SOON, icon: I.pulse, soon: true }
    ]},
    { type: 'solo', id: 'settings', label: 'Settings', href: 'settings.html', icon: I.gear, feat: 'settings', soloTop: true }
  ];

  /* ── Build sidebar nav HTML ──────────────────────────────────── */
  function navHTML(active) {
    let h = '';
    NAV.forEach(sec => {
      if (sec.feat && !featOn(sec.feat)) return;   // whole module turned off
      if (sec.type === 'solo') {
        h += `<div class="sb-solo"${sec.soloTop ? ' style="margin-top:var(--ql-space-2)"' : ''}>
          <a class="sb-link${sec.id === active ? ' active' : ''}" href="${sec.href}" data-page="${sec.id}">
            ${sec.icon}<span class="sb-link-text">${sec.label}</span>
          </a></div>`;
      } else {
        const items = sec.items.filter(it => !it.feat || featOn(it.feat));
        if (!items.length) return;   // nothing visible in this group
        const open = items.some(it => it.id === active);
        h += `<div class="sb-group${open ? '' : ''}">
          <button class="sb-group-title" onclick="QLShell.toggleGroup(this)"><span>${sec.label}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
          <div class="sb-group-body">` +
          items.map(it => {
            let badge = '';
            if (it.soon) badge = `<span class="sb-link-badge" style="background:var(--ql-brand-100);color:var(--ql-brand-700)">Soon</span>`;
            else if (it.badge) badge = `<span class="sb-link-badge"${it.badge.tone === 'info' ? ' style="background:var(--ql-brand-100);color:var(--ql-brand-700)"' : it.badge.tone === 'success' ? ' style="background:var(--ql-success-100);color:var(--ql-success-700)"' : ''}>${it.badge.text}</span>`;
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
    </div>
    <nav class="sb-nav">${navHTML(active)}</nav>
  </aside>

  <div class="mobile-backdrop" id="mobBack" onclick="QLShell.toggleMobileSidebar(false)"></div>

  <header class="topbar">
    <button class="tb-toggle" onclick="QLShell.toggleSidebar()" aria-label="Toggle sidebar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
    <div class="tb-spacer"></div>
    <button class="tb-search" onclick="QLShell.openPalette()" aria-label="Search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <span>Search…</span><kbd>⌘K</kbd>
    </button>
    <button class="tb-action tb-bell" title="Notifications" onclick="QLShell.openNotifications()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span class="tb-badge" id="tbNotifBadge" hidden>0</span>
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
      <div style="text-align:center;font-size:var(--ql-text-xs);color:var(--ql-text-secondary);margin-top:calc(-1*var(--ql-space-2))">Drag the photo to reposition · slider to zoom</div>
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
</div>

<!-- generic form modal (new sale / purchase / party / worker / cashbook / payment) -->
<div class="ql-modal-backdrop" id="qlModalBack" onclick="if(event.target===this)QLShell.closeModal()">
  <div class="ql-modal" id="qlModal" role="dialog" aria-modal="true"></div>
</div>

<!-- right-side drawer (notifications + AI assistant) -->
<div class="ql-drawer-backdrop" id="qlDrawerBack" onclick="if(event.target===this)QLShell.closeDrawer()">
  <aside class="ql-drawer" id="qlDrawer" role="dialog" aria-modal="true">
    <div class="ql-drawer-head">
      <div class="ql-drawer-title" id="qlDrawerTitle">Notifications</div>
      <button class="ql-drawer-x" onclick="QLShell.closeDrawer()" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="ql-drawer-body" id="qlDrawerBody"></div>
  </aside>
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
    refreshNotifDot();   // light the bell when high-priority alerts exist
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
  // Pages to offer in the palette — derived from the ACTIVE nav (respects Feature Management).
  function navPages() {
    const pIcon = id => id === 'dashboard' ? 'grid' : /sale|invoice|collection/.test(id) ? 'sales' : /purchase|supplier/.test(id) ? 'bag' : /part|labour|attend|people/.test(id) ? 'users' : 'grid';
    const out = [];
    NAV.forEach(sec => {
      if (sec.feat && !featOn(sec.feat)) return;
      if (sec.type === 'solo') { if (sec.href && sec.href !== SOON) out.push([sec.label, sec.href, pIcon(sec.id)]); }
      else sec.items.forEach(it => { if ((!it.feat || featOn(it.feat)) && it.href && it.href !== SOON) out.push([it.label, it.href, pIcon(it.id)]); });
    });
    return out;
  }
  function paletteItems(q) {
    const Q = window.QLD;
    const res = [];
    // pages (active modules only)
    navPages().forEach(([t, href, ic]) => { if (!q || t.toLowerCase().includes(q)) res.push({ group: 'Go to', icon: ic, t, s: 'Page', href }); });
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
      // Symmetric clamp: pan freely in BOTH directions while the image still
      // covers the 280px frame (max offset = half the overflow on each axis).
      const maxX = Math.max(0, (dw - size) / 2), maxY = Math.max(0, (dh - size) / 2);
      crop.dx = Math.max(-maxX, Math.min(maxX, crop.dx));
      crop.dy = Math.max(-maxY, Math.min(maxY, crop.dy));
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
    stage.style.touchAction = 'none'; stage.style.cursor = 'grab';   // drag to reposition (no page-scroll on touch)
    stage.addEventListener('pointerdown', e => { if (!crop.img) return; drag = { x: e.clientX, y: e.clientY, dx: crop.dx, dy: crop.dy }; stage.style.cursor = 'grabbing'; try { stage.setPointerCapture(e.pointerId); } catch (_) {} });
    window.addEventListener('pointermove', e => { if (!drag) return; crop.dx = drag.dx + (e.clientX - drag.x); crop.dy = drag.dy + (e.clientY - drag.y); draw(); });
    window.addEventListener('pointerup', () => { drag = null; stage.style.cursor = 'grab'; });
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

  /* ════════════════════════ FORM MODALS ═════════════════════════
     Generic spec-driven forms. Each field: {k,label,type,req,ph,opts,
     half,full}. On save we read+parse values and hand a plain object to
     the caller's onSave, which routes to a QLD mutation. After a save we
     fire window.__qlRefresh() so the active page re-renders. */
  const today = () => new Date().toISOString().slice(0, 10);

  function fieldHTML(f, v) {
    const id = 'qf_' + f.k;
    const val = v == null ? '' : v;
    const lbl = `<label class="qlf-label" for="${id}">${f.label}${f.req ? ' <span class="qlf-req">*</span>' : ''}</label>`;
    let ctrl;
    if (f.type === 'select') {
      ctrl = `<select class="qlf-input" id="${id}">${f.opts.map(o => { const ov = Array.isArray(o) ? o[0] : o, ol = Array.isArray(o) ? o[1] : o; return `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`;
    } else if (f.type === 'textarea') {
      ctrl = `<textarea class="qlf-input" id="${id}" rows="2" placeholder="${esc(f.ph || '')}">${esc(val)}</textarea>`;
    } else {
      ctrl = `<input class="qlf-input" id="${id}" type="${f.type || 'text'}" value="${esc(val)}" placeholder="${esc(f.ph || '')}" ${f.type === 'number' ? 'inputmode="decimal" step="any"' : ''}>`;
    }
    return `<div class="qlf-field ${f.full ? 'qlf-full' : ''}">${lbl}${ctrl}</div>`;
  }
  function readForm(specs) {
    const out = {};
    for (const f of specs) {
      const el = $('qf_' + f.k); if (!el) continue;
      let val = el.value;
      if (f.type === 'number') val = parseFloat(val) || 0;
      else val = (val || '').trim();
      if (f.upper && typeof val === 'string') val = val.toUpperCase();
      out[f.k] = val;
    }
    return out;
  }
  function openForm(cfg) {
    const specs = cfg.specs, init = cfg.initial || {};
    const grid = specs.map(f => fieldHTML(f, init[f.k])).join('');
    $('qlModal').innerHTML = `
      <div class="ql-modal-head">
        <div><h3 class="ql-modal-title">${esc(cfg.title)}</h3>${cfg.sub ? `<div class="ql-modal-sub">${esc(cfg.sub)}</div>` : ''}</div>
        <button class="ql-modal-x" onclick="QLShell.closeModal()" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="qlf-grid">${grid}</div>
      ${cfg.note ? `<div class="ql-modal-note" id="qlModalNote">${cfg.note}</div>` : ''}
      <div class="ql-modal-foot">
        <button class="ql-btn ql-btn-secondary" onclick="QLShell.closeModal()">Cancel</button>
        <button class="ql-btn ql-btn-primary" id="qlModalSave">${esc(cfg.saveLabel || 'Save')}</button>
      </div>`;
    const save = $('qlModalSave');
    save.onclick = () => {
      const v = readForm(specs);
      const miss = specs.find(f => f.req && (v[f.k] === '' || v[f.k] === 0 && f.reqNonZero));
      if (miss) { toast(miss.label + ' is required'); $('qf_' + miss.k).focus(); return; }
      const ok = cfg.onSave(v);
      if (ok !== false) closeModal();
    };
    if (cfg.onRender) cfg.onRender();
    $('qlModalBack').classList.add('open');
    const first = $('qlModal').querySelector('.qlf-input'); if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() { $('qlModalBack').classList.remove('open'); }
  function refresh(msg) { if (msg) toast(msg); if (typeof window.__qlRefresh === 'function') window.__qlRefresh(); }
  const GST_OPTS = [[0, 'GST 0%'], [5, 'GST 5%'], [12, 'GST 12%'], [18, 'GST 18%'], [28, 'GST 28%']];

  /* ── Sale / GST invoice ──────────────────────────────────────── */
  const SALE_SPECS = [
    { k: 'inv', label: 'Invoice No.', req: true, ph: 'e.g. 142', upper: true },
    { k: 'date', label: 'Date', type: 'date', req: true },
    { k: 'party', label: 'Party', req: true, ph: 'Customer name', upper: true, full: true },
    { k: 'gstin', label: 'GSTIN', ph: '08AAAAA0000A1Z5', upper: true },
    { k: 'product', label: 'Product', ph: 'Quick Lime' },
    { k: 'qty', label: 'Qty (T)', type: 'number', req: true, reqNonZero: true },
    { k: 'rate', label: 'Rate (₹/T)', type: 'number', req: true, reqNonZero: true },
    { k: 'gstR', label: 'GST rate', type: 'select', opts: GST_OPTS },
    { k: 'veh', label: 'Vehicle No.', upper: true },
    { k: 'eway', label: 'E-way bill' }
  ];
  function openSaleForm(idx) {
    const editing = idx != null && idx >= 0;
    const row = editing ? window.QLD.state.SALES[idx] : null;
    openForm({
      title: editing ? 'Edit invoice' : 'New GST invoice', sub: 'Sales register',
      specs: SALE_SPECS, saveLabel: editing ? 'Save changes' : 'Create invoice',
      initial: row || { date: today(), product: 'Quick Lime', gstR: 5 },
      onSave(v) { v.product = v.product || 'Quick Lime'; if (editing) window.QLD.updateSale(idx, v); else window.QLD.addSale(v); refresh(editing ? 'Invoice updated' : 'Invoice created'); }
    });
  }

  /* ── Purchase bill (Group → Item taxonomy, dependent dropdown) ─── */
  function openPurchaseForm(idx) {
    const editing = idx != null && idx >= 0;
    const row = editing ? window.QLD.state.PURCHASES[idx] : null;
    const GROUPS = window.QLD.purchaseGroups, DEPTS = window.QLD.departments;
    const init = row || { date: today(), group: 'limestone', item: 'Limestone Purchase', dept: 'Production', grate: 5, itc: 'Eligible', unit: 'MT' };
    const curG = GROUPS.find(g => g.key === init.group) || GROUPS[0];
    const specs = [
      { k: 'bill', label: 'Bill No.', req: true, ph: 'e.g. 328' },
      { k: 'date', label: 'Date', type: 'date', req: true },
      { k: 'sup', label: 'Supplier', req: true, ph: 'Supplier name', upper: true, full: true },
      { k: 'gstin', label: 'GSTIN', upper: true },
      { k: 'group', label: 'Purchase Group', type: 'select', opts: GROUPS.map(g => [g.key, g.emoji + '  ' + g.label]) },
      { k: 'item', label: 'Purchase Item', type: 'select', opts: curG.items },
      { k: 'dept', label: 'Department', type: 'select', opts: DEPTS },
      { k: 'desc', label: 'Description', ph: 'optional' },
      { k: 'qty', label: 'Qty', type: 'number' },
      { k: 'unit', label: 'Unit', ph: 'MT' },
      { k: 'rate', label: 'Rate', type: 'number' },
      { k: 'taxable', label: 'Taxable (₹)', type: 'number', req: true, reqNonZero: true },
      { k: 'grate', label: 'GST rate', type: 'select', opts: GST_OPTS },
      { k: 'itc', label: 'ITC', type: 'select', opts: [['Eligible', 'ITC Eligible'], ['Ineligible', 'ITC Ineligible'], ['RCM', 'RCM']] }
    ];
    openForm({
      title: editing ? 'Edit bill' : 'New purchase bill', sub: 'Purchase register',
      specs, saveLabel: editing ? 'Save changes' : 'Add bill', initial: init,
      // Purchase Item options depend on the chosen Purchase Group — no unrelated items.
      onRender() {
        const gsel = $('qf_group'), isel = $('qf_item');
        if (!gsel || !isel) return;
        gsel.onchange = () => {
          const g = GROUPS.find(x => x.key === gsel.value) || GROUPS[0];
          isel.innerHTML = g.items.map(it => `<option value="${esc(it)}">${esc(it)}</option>`).join('');
        };
      },
      onSave(v) { if (editing) window.QLD.updatePurchase(idx, v); else window.QLD.addPurchase(v); refresh(editing ? 'Bill updated' : 'Bill added'); }
    });
  }

  /* ── Party ───────────────────────────────────────────────────── */
  const PARTY_SPECS = [
    { k: 'name', label: 'Name', req: true, ph: 'Party name', full: true },
    { k: 'type', label: 'Type', type: 'select', opts: [['customer', 'Customer'], ['supplier', 'Supplier'], ['both', 'Both']] },
    { k: 'gstin', label: 'GSTIN', upper: true },
    { k: 'phone', label: 'Phone' },
    { k: 'state', label: 'State' },
    { k: 'address', label: 'Address', type: 'textarea', full: true },
    { k: 'notes', label: 'Notes', type: 'textarea', full: true }
  ];
  function openPartyForm(idx) {
    const editing = idx != null && idx >= 0;
    const row = editing ? window.QLD.state.PARTIES[idx] : null;
    openForm({
      title: editing ? 'Edit party' : 'Add party', sub: 'Contact directory',
      specs: PARTY_SPECS, saveLabel: editing ? 'Save changes' : 'Add party',
      initial: row || { type: 'customer' },
      onSave(v) {
        if (editing) { Object.assign(window.QLD.state.PARTIES[idx], v); window.QLD.commit(); }
        else window.QLD.upsertParty(v.name, v.gstin, v.phone, v.address, v.state, v.type);
        refresh(editing ? 'Party updated' : 'Party added');
      }
    });
  }

  /* ── Worker ──────────────────────────────────────────────────── */
  const WORKER_SPECS = [
    { k: 'name', label: 'Name', req: true, full: true },
    { k: 'desig', label: 'Designation', ph: 'Worker' },
    { k: 'freq', label: 'Pay type', type: 'select', opts: [['daily', 'Daily wage'], ['monthly', 'Monthly salary']] },
    { k: 'wage', label: 'Wage / Salary (₹)', type: 'number', req: true, reqNonZero: true },
    { k: 'adv', label: 'Advance (₹)', type: 'number' }
  ];
  function openWorkerForm(idx) {
    const editing = idx != null && idx >= 0;
    const row = editing ? window.QLD.state.WORKERS[idx] : null;
    openForm({
      title: editing ? 'Edit worker' : 'Add worker', sub: 'Labour',
      specs: WORKER_SPECS, saveLabel: editing ? 'Save changes' : 'Add worker',
      initial: row || { freq: 'daily', desig: 'Worker' },
      onSave(v) { v.desig = v.desig || 'Worker'; if (editing) window.QLD.updateWorker(idx, v); else window.QLD.addWorker(v); refresh(editing ? 'Worker updated' : 'Worker added'); }
    });
  }

  /* ── Cashbook entry ──────────────────────────────────────────── */
  const CASH_SPECS = [
    { k: 'date', label: 'Date', type: 'date', req: true },
    { k: 'type', label: 'Direction', type: 'select', opts: [['credit', 'Money In'], ['debit', 'Money Out']] },
    { k: 'mode', label: 'Mode', type: 'select', opts: [['cash', 'Cash'], ['phonepay', 'PhonePe'], ['bank', 'Bank']] },
    { k: 'amount', label: 'Amount (₹)', type: 'number', req: true, reqNonZero: true },
    { k: 'category', label: 'Category', ph: 'e.g. Sales Receipt' },
    { k: 'party', label: 'Party / Note', full: true },
    { k: 'ref', label: 'Reference' }
  ];
  function openCashForm() {
    openForm({
      title: 'New cash entry', sub: 'Cash book',
      specs: CASH_SPECS, saveLabel: 'Add entry',
      initial: { date: today(), type: 'credit', mode: 'cash' },
      onSave(v) { window.QLD.addCashEntry(v); refresh('Entry added'); }
    });
  }

  /* ── Chunna sale ─────────────────────────────────────────────── */
  const CHUNNA_SPECS = [
    { k: 'date', label: 'Date', type: 'date', req: true },
    { k: 'customer', label: 'Customer', ph: 'Walk-in', full: true },
    { k: 'qty', label: 'Qty (T)', type: 'number', req: true, reqNonZero: true },
    { k: 'rate', label: 'Rate (₹/T)', type: 'number', req: true, reqNonZero: true },
    { k: 'mode', label: 'Mode', type: 'select', opts: [['cash', 'Cash'], ['phonepay', 'PhonePe'], ['bank', 'Bank']] }
  ];
  function openChunnaForm() {
    openForm({
      title: 'New chunna sale', sub: 'Cash / PhonePe sale',
      specs: CHUNNA_SPECS, saveLabel: 'Add sale',
      initial: { date: today(), mode: 'cash' },
      onSave(v) { v.customer = v.customer || 'Walk-in'; window.QLD.addChunna(v); refresh('Chunna sale added'); }
    });
  }

  /* ── TDS entry ───────────────────────────────────────────────── */
  const TDS_SPECS = [
    { k: 'date', label: 'Date', type: 'date', req: true },
    { k: 'party', label: 'Deductee / Party', req: true, full: true },
    { k: 'pan', label: 'PAN', upper: true },
    { k: 'sec', label: 'Section', type: 'select', opts: ['194C', '194Q', '194J', '194H', '194I', '206C', '194A'] },
    { k: 'amount', label: 'Amount (₹)', type: 'number', req: true, reqNonZero: true },
    { k: 'rate', label: 'TDS rate (%)', type: 'number', req: true, reqNonZero: true },
    { k: 'remarks', label: 'Remarks', type: 'textarea', full: true }
  ];
  function openTdsForm(idx) {
    const editing = idx != null && idx >= 0;
    const row = editing ? window.QLD.state.TDS[idx] : null;
    openForm({
      title: editing ? 'Edit TDS entry' : 'New TDS entry', sub: 'Tax deducted at source',
      specs: TDS_SPECS, saveLabel: editing ? 'Save changes' : 'Add entry',
      initial: row || { date: today(), sec: '194C' },
      note: 'TDS = Amount × rate%, computed on save.',
      onSave(v) { if (editing) window.QLD.updateTds(idx, v); else window.QLD.addTds(v); refresh(editing ? 'TDS updated' : 'TDS entry added'); }
    });
  }

  /* ── Payment (mark a sale/purchase paid) ─────────────────────── */
  function openPaymentForm(kind, idx) {
    const Q = window.QLD;
    const row = kind === 'sale' ? Q.state.SALES[idx] : Q.state.PURCHASES[idx];
    if (!row) return;
    const tot = kind === 'sale' ? Q.cS(row).tot : (row.taxable + row.taxable * (row.grate || 0) / 100);
    const billNo = kind === 'sale' ? row.inv : row.bill;
    const who = kind === 'sale' ? row.party : row.sup;
    openForm({
      title: 'Record payment', sub: billNo + ' · ' + who + ' · ' + Q.fC(tot),
      specs: [
        { k: 'paidDate', label: 'Payment date', type: 'date', req: true },
        { k: 'paidAmt', label: 'Amount (₹)', type: 'number', req: true, reqNonZero: true },
        { k: 'paidMode', label: 'Mode', type: 'select', opts: ['Bank Transfer', 'Cash', 'PhonePe', 'Cheque', 'UPI'] },
        { k: 'paidRef', label: 'Reference', full: true }
      ],
      saveLabel: 'Mark paid',
      initial: { paidDate: today(), paidAmt: Number(tot.toFixed(2)), paidMode: 'Bank Transfer' },
      onSave(v) {
        if (kind === 'sale') Q.setSaleStatus(idx, 'paid', v); else Q.setPurchaseStatus(idx, 'paid', v);
        refresh('Payment recorded');
      }
    });
  }

  /* ── GST tax invoice (print / save as PDF) ───────────────────── */
  function invoiceHTML(d) {
    const Q = window.QLD, amt = n => Q.fmt(n, 2), s = d.seller, b = d.buyer;
    const fdate = iso => { if (!iso) return ''; const p = iso.split('-'); return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : iso; };
    const totalTax = d.interState ? d.igst : d.cgst + d.sgst;
    const gstCols = d.interState
      ? `<div class="tl"><span>Add : IGST @ ${(+d.gstR).toFixed(2)} %</span><span>${amt(d.igst)}</span></div>`
      : `<div class="tl"><span>Add : CGST @ ${(d.gstR / 2).toFixed(2)} %</span><span>${amt(d.cgst)}</span></div><div class="tl"><span>Add : SGST @ ${(d.gstR / 2).toFixed(2)} %</span><span>${amt(d.sgst)}</span></div>`;
    const taxSumHead = d.interState ? '<th>IGST Amt.</th>' : '<th>CGST Amt.</th><th>SGST Amt.</th>';
    const taxSumCells = d.interState ? `<td>${amt(d.igst)}</td>` : `<td>${amt(d.cgst)}</td><td>${amt(d.sgst)}</td>`;
    const party = who => `<div class="pcol"><div class="pi">${who} :</div><div class="pn">${esc(b.name)}</div>${b.address ? `<div>${esc(b.address)}</div>` : ''}<div style="margin-top:6px">GSTIN / UIN&nbsp;&nbsp;: <b>${esc(b.gstin || '—')}</b></div></div>`;
    const bank2 = s.bank2 ? `<br>${esc(s.bank2)}${s.bankBranch2 ? ' ' + esc(s.bankBranch2) : ''}, IFSC CODE-${esc(s.ifsc2 || '')}, AC NO-${esc(s.accNo2 || '')}` : '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${esc(d.inv)} — ${esc(s.short || s.name)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,'Helvetica Neue',sans-serif;color:#000;font-size:11.5px;line-height:1.35;padding:20px;background:#fff}
  .inv{max-width:820px;margin:0 auto;border:1.5px solid #000}
  .row{display:flex}
  .b-b{border-bottom:1px solid #000}.b-r{border-right:1px solid #000}
  .pad{padding:6px 10px}
  /* header */
  .ihd{position:relative;text-align:center;padding:10px 12px 8px}
  .orig{position:absolute;top:6px;right:10px;font-style:italic;font-size:11px}
  .gi{font-weight:700;font-size:12px}
  .co{font-size:22px;font-weight:800;letter-spacing:.3px;margin-top:1px}
  .ca{font-size:11px}
  .gstln{font-weight:700;font-size:12px;margin-top:1px}
  .tagline{font-weight:700;font-size:12px;margin-top:3px}
  .logo{position:absolute;left:12px;top:8px;height:62px;width:auto;max-width:190px;object-fit:contain}
  /* meta / party rows */
  .half{width:50%}
  .mline{display:flex;justify-content:space-between}
  .mline span:first-child{min-width:120px}
  .pi{font-weight:700;font-style:italic;margin-bottom:3px}
  .pn{font-weight:700;font-size:12px}
  /* items */
  table{width:100%;border-collapse:collapse}
  .it th,.it td{border:1px solid #000;padding:5px 7px;font-size:11px}
  .it th{background:#fff;text-align:center;font-weight:700}
  .it td.l{text-align:left}.it td.c{text-align:center}.it td.r{text-align:right}
  .it .fill td{height:120px;border-top:none;border-bottom:none}
  /* totals */
  .tot{padding:6px 10px}
  .tl{display:flex;justify-content:flex-end;gap:24px;padding:2px 0}
  .tl span:last-child{min-width:110px;text-align:right}
  .grand{display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:13px;border-top:1px solid #000;margin-top:4px;padding-top:5px}
  /* tax summary */
  .ts th,.ts td{border:1px solid #000;padding:4px 7px;font-size:10.5px;text-align:center}
  .ts th{font-weight:700}
  .words{font-weight:700;padding:6px 10px}
  .decl{padding:6px 10px;text-align:center}
  .decl-h{font-weight:700;text-decoration:underline;margin-bottom:2px}
  .decl div{font-size:10.5px}
  .bank{padding:6px 10px;font-size:11px}
  .terms{font-size:10px;width:55%}
  .terms b{font-size:11px}
  .sig{width:45%;text-align:center;display:flex;flex-direction:column}
  .sig .for{font-weight:700;margin-top:auto;padding-top:34px}
  @media print{body{padding:0}.inv{border:1.5px solid #000}.noprint{display:none}}
  .bar{display:flex;justify-content:center;gap:10px;padding:0 0 14px}
  .btn{padding:8px 16px;border-radius:6px;border:none;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit}
  .btn-p{background:#2563EB;color:#fff}.btn-s{background:#e2e8f0;color:#000}
</style></head><body>
${d.noBar ? '' : '<div class="bar noprint"><button class="btn btn-p" onclick="window.print()">Print / Save PDF</button><button class="btn btn-s" onclick="window.close()">Close</button></div>'}
<div class="inv">
  <div class="ihd b-b">
    ${s.logo ? `<img class="logo" src="${esc(s.logo)}" alt="">` : ''}
    <div class="orig">Original Copy</div>
    <div class="gi">GST INVOICE</div>
    <div class="co">${esc(s.name)}</div>
    <div class="ca">${esc(s.address || '')}</div>
    <div class="gstln">GSTIN : ${esc(s.gstin || '—')}</div>
    ${s.email ? `<div class="ca">email : ${esc(s.email)}</div>` : ''}
    <div class="tagline">${esc(s.product || 'MANUFACTURER')}</div>
  </div>
  <div class="row b-b">
    <div class="half b-r pad">
      <div class="mline"><span>Invoice No.</span><b>: ${esc(d.inv || '')}</b></div>
      <div class="mline"><span>Dated</span><b>: ${fdate(d.date)}</b></div>
      <div class="mline"><span>Place of Supply</span><b>: ${esc(s.state || b.state || '')}</b></div>
      <div class="mline"><span>Reverse Charge</span><b>: N</b></div>
      <div class="mline"><span>GR/RR No.</span><b>: ${esc(d.grrr || '')}</b></div>
    </div>
    <div class="half pad">
      <div class="mline"><span>Transport</span><b>: ${esc(d.transport || 'By Road')}</b></div>
      <div class="mline"><span>Vehicle No.</span><b>: ${esc(d.veh || '')}</b></div>
      <div class="mline"><span>Station</span><b>: ${esc(s.station || s.city || '')}</b></div>
      <div class="mline"><span>E-Way Bill No.</span><b>: ${esc(d.eway || '')}</b></div>
    </div>
  </div>
  <div class="row b-b">
    <div class="half b-r pad">${party('Billed to')}</div>
    <div class="half pad">${party('Shipped to')}</div>
  </div>
  <table class="it">
    <thead><tr><th style="width:36px">S.N.</th><th>Description of Goods</th><th style="width:74px">HSN/SAC<br>Code</th><th style="width:56px">Qty.</th><th style="width:56px">Unit</th><th style="width:82px">Price</th><th style="width:100px">Amount(₹)</th></tr></thead>
    <tbody>
      <tr><td class="c">1</td><td class="l">${esc(d.product)}</td><td class="c">${esc(d.hsn)}</td><td class="r">${amt(d.qty)}</td><td class="c">${esc(d.unit || 'Tonne')}</td><td class="r">${amt(d.rate)}</td><td class="r">${amt(d.taxable)}</td></tr>
      <tr class="fill"><td class="l" colspan="7"></td></tr>
    </tbody>
  </table>
  <div class="tot b-b">
    <div class="tl"><span></span><span>${amt(d.taxable)}</span></div>
    ${gstCols}
    <div class="grand"><span>Grand Total&nbsp;&nbsp;${amt(d.qty)} ${esc(d.unit || 'Tonne')}</span><span>₹ ${amt(d.grand)}</span></div>
  </div>
  <table class="ts b-b">
    <thead><tr><th>HSN/SAC</th><th>Tax Rate</th><th>Taxable Amt.</th>${taxSumHead}<th>Total Tax</th></tr></thead>
    <tbody><tr><td>${esc(d.hsn)}</td><td>${d.gstR}%</td><td>${amt(d.taxable)}</td>${taxSumCells}<td>${amt(totalTax)}</td></tr></tbody>
  </table>
  <div class="words b-b">${esc(d.words)}</div>
  <div class="decl b-b">
    <div class="decl-h">Declaration</div>
    ${s.msme ? `<div>1. REGISTERED IN MSME NO. ${esc(s.msme)}</div>` : ''}
    <div>${s.msme ? '2' : '1'}. Supply of goods under RULE 46 OF CGST RULE 2017 .</div>
    <div>${s.msme ? '3' : '2'}. No complaint will be entertained after 10 Days from the Date</div>
    <div>${s.msme ? '4' : '3'}. Interest at 18% per annum will be charged for amount not paid in time</div>
  </div>
  <div class="bank b-b"><b>Bank Details :</b> ${esc(s.bank || '—')}${s.bankBranch ? ' ' + esc(s.bankBranch) : ''}${s.ifsc ? ', IFSC CODE-' + esc(s.ifsc) : ''}${s.accNo ? ', AC NO-' + esc(s.accNo) : ''}${bank2}</div>
  <div class="row">
    <div class="terms b-r pad">
      <b>Terms &amp; Conditions</b>
      <div style="margin-top:2px">E.&amp; O.E.</div>
      <div>1. Goods once sold will not be taken back.</div>
      <div>2. Interest @ 18% p.a. will be charged if the payment is not made within the stipulated time.</div>
      <div>3. Subject to ${esc(s.jurisdiction || (s.station || s.city || 'local'))} Jurisdiction only.</div>
      ${s.msme ? `<div>4. REGISTERED IN MSME NO. ${esc(s.msme)}</div>` : ''}
    </div>
    <div class="sig pad">
      <div style="text-align:left">Receiver's Signature&nbsp;&nbsp;:</div>
      <div class="for">for ${esc(s.name)}<br><br>Authorised Signatory</div>
    </div>
  </div>
</div>
<script>setTimeout(function(){try{window.focus()}catch(e){}},50)</script>
</body></html>`;
  }
  function printInvoice(idx) {
    const d = window.QLD.invoiceData(idx);
    if (!d) { toast('Invoice not found'); return; }
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print the invoice'); return; }
    w.document.write(invoiceHTML(d));
    w.document.close();
  }

  /* ── Row action menu (table kebabs) ──────────────────────────── */
  const RICO = {
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
    pay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>'
  };
  let _rowMenu = null;
  function closeRowMenu() { if (_rowMenu) { _rowMenu.remove(); _rowMenu = null; } }
  function rowItems(type, idx) {
    const Q = window.QLD, del = (msg, fn) => ({ label: 'Delete', icon: RICO.del, danger: true, onClick() { if (confirm(msg)) { fn(); refresh('Deleted'); } } });
    if (type === 'sale') { const r = Q.state.SALES[idx]; const it = [{ label: 'Print invoice', icon: RICO.print, onClick: () => printInvoice(idx) }, { label: 'Edit invoice', icon: RICO.edit, onClick: () => openSaleForm(idx) }]; if ((r.status || 'pending') !== 'paid') it.push({ label: 'Mark paid', icon: RICO.pay, onClick: () => openPaymentForm('sale', idx) }); it.push(del('Delete invoice ' + r.inv + '?', () => Q.deleteSale(idx))); return it; }
    if (type === 'purchase') { const r = Q.state.PURCHASES[idx]; const it = [{ label: 'Edit bill', icon: RICO.edit, onClick: () => openPurchaseForm(idx) }]; if ((r.status || 'pending') !== 'paid') it.push({ label: 'Mark paid', icon: RICO.pay, onClick: () => openPaymentForm('purchase', idx) }); it.push(del('Delete bill ' + r.bill + '?', () => Q.deletePurchase(idx))); return it; }
    if (type === 'party') { const r = Q.state.PARTIES[idx]; return [{ label: 'Edit party', icon: RICO.edit, onClick: () => openPartyForm(idx) }, del('Delete party ' + r.name + '?', () => Q.deleteParty(idx))]; }
    if (type === 'worker') { const r = Q.state.WORKERS[idx]; return [{ label: 'Edit worker', icon: RICO.edit, onClick: () => openWorkerForm(idx) }, del('Delete worker ' + r.name + '?', () => Q.deleteWorker(idx))]; }
    if (type === 'cash') { return [del('Delete this entry?', () => Q.deleteCashEntry(idx))]; }
    if (type === 'chunna') { return [del('Delete this chunna sale?', () => Q.deleteChunna(idx))]; }
    if (type === 'tds') { return [{ label: 'Edit entry', icon: RICO.edit, onClick: () => openTdsForm(idx) }, del('Delete this TDS entry?', () => Q.deleteTds(idx))]; }
    return [];
  }
  function rowMenu(ev, type, idx) {
    ev.stopPropagation();
    const wasFor = _rowMenu && _rowMenu._key === type + idx;
    closeRowMenu();
    if (wasFor) return;                               // toggle off if same kebab
    const items = rowItems(type, idx); if (!items.length) return;
    const menu = document.createElement('div');
    menu.className = 'ql-rowmenu'; menu._key = type + idx;
    menu.innerHTML = items.map((it, i) => `<button class="ql-rowmenu-item ${it.danger ? 'danger' : ''}" data-i="${i}">${it.icon}<span>${esc(it.label)}</span></button>`).join('');
    document.body.appendChild(menu);
    const r = ev.currentTarget.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - mh - 8)) + 'px';
    // right-align to the kebab, but never let it run off either edge
    menu.style.left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8) + 'px';
    menu.querySelectorAll('.ql-rowmenu-item').forEach((b, i) => b.addEventListener('click', () => { closeRowMenu(); items[i].onClick(); }));
    _rowMenu = menu;
    setTimeout(() => document.addEventListener('click', closeRowMenu, { once: true }), 0);
    window.addEventListener('resize', closeRowMenu, { once: true });
  }

  /* ════════════════════ RIGHT-SIDE DRAWER ═══════════════════════
     Shared slide-in panel hosting Notifications and the AI assistant. */
  function openDrawer(mode) {
    $('qlDrawer').dataset.mode = mode;
    $('qlDrawerBack').classList.add('open');
    if (mode === 'notif') { $('qlDrawerTitle').textContent = 'Notifications'; renderNotifications(); }
    else { $('qlDrawerTitle').innerHTML = '<span class="ql-ai-dot"></span>Business Assistant'; renderAssistant(); }
  }
  function closeDrawer() { $('qlDrawerBack').classList.remove('open'); }
  function openNotifications() { openDrawer('notif'); }
  function openAssistant() { openDrawer('ai'); }

  /* ── Notifications ───────────────────────────────────────────── */
  const NOTIF_META = {
    collection: { ic: '💰', label: 'Collection', cls: 'c-amber' },
    payment: { ic: '🧾', label: 'Supplier payment', cls: 'c-blue' },
    gst: { ic: '🏛️', label: 'GST', cls: 'c-red' },
    loan: { ic: '🏦', label: 'Loan EMI', cls: 'c-red' },
    renewal: { ic: '🔔', label: 'Renewal', cls: 'c-violet' }
  };
  let _notifById = {};
  function notifState() { try { return JSON.parse(localStorage.getItem('ql_notif_state') || '{}'); } catch (_) { return {}; } }
  function saveNotifState(s) { localStorage.setItem('ql_notif_state', JSON.stringify(s)); }
  function notifActive() {
    const st = notifState(), now = Date.now(), DONE_TTL = 7 * 864e5;
    return window.QLD.notifications().filter(n => {
      if (st.snooze && st.snooze[n.id] && now < st.snooze[n.id]) return false;
      if (st.done && st.done[n.id] && (now - st.done[n.id]) < DONE_TTL) return false;
      return true;
    });
  }
  function waLink(phone, msg) {
    let p = (phone || '').replace(/\D/g, '');
    if (p.length === 10) p = '91' + p;
    return 'https://wa.me/' + p + '?text=' + encodeURIComponent(msg || '');
  }
  function notifCard(n) {
    const m = NOTIF_META[n.type] || { ic: '🔔', label: n.type, cls: 'c-grey' };
    const amt = n.amount ? `<span class="ql-nc-amt">${window.QLD.fC(n.amount)}</span>` : '';
    const overdue = n.days != null && n.days > 0 && (n.type === 'collection' || n.type === 'loan');
    const dueBadge = n.days != null ? `<span class="ql-nc-due ${overdue ? 'over' : ''}">${overdue ? n.days + 'd overdue' : (n.due ? window.QLD.fDS(n.due) : '')}</span>` : '';
    const acts = [];
    if (n.page) acts.push(`<button onclick="QLShell.notifOpen('${esc(n.id)}')">Open</button>`);
    if (n.phone) acts.push(`<button onclick="QLShell.notifWA('${esc(n.id)}')">WhatsApp</button>`);
    acts.push(`<button onclick="QLShell.notifSnooze('${esc(n.id)}')">Snooze</button>`);
    acts.push(`<button class="done" onclick="QLShell.notifDone('${esc(n.id)}')">✓ Done</button>`);
    return `<div class="ql-nc prio-${n.priority}">
      <div class="ql-nc-top"><span class="ql-nc-dot"></span><span class="ql-nc-ic ${m.cls}">${m.ic}</span>
        <div class="ql-nc-body"><div class="ql-nc-title">${esc(n.title)}</div><div class="ql-nc-sub">${esc(n.sub)}</div></div>
        <div class="ql-nc-right">${amt}${dueBadge}</div></div>
      <div class="ql-nc-acts">${acts.join('')}</div></div>`;
  }
  function renderNotifications() {
    const active = notifActive();
    _notifById = {}; active.forEach(n => _notifById[n.id] = n);
    const hi = active.filter(n => n.priority === 'high').length;
    let html = `<div class="ql-notif-bar"><span>${active.length} active${hi ? ' · ' + hi + ' high priority' : ''}</span><button class="ql-notif-add" onclick="QLShell.addRenewal()">+ Reminder</button></div>`;
    html += active.length ? active.map(notifCard).join('')
      : `<div class="ql-drawer-empty"><div style="font-size:34px">✅</div><div style="font-weight:700;color:var(--ql-text)">All caught up</div><div>No pending alerts right now.</div></div>`;
    $('qlDrawerBody').innerHTML = html;
  }
  function refreshNotifDot() {
    try {
      const n = notifActive().length;
      const badge = $('tbNotifBadge'), bell = document.querySelector('.tb-bell');
      if (badge) { badge.textContent = n > 99 ? '99+' : n; badge.hidden = n === 0; }
      if (bell) bell.classList.toggle('has-notif', n > 0);
    } catch (_) {}
  }
  // actions
  function notifOpen(id) { const n = _notifById[id]; if (n && n.page) { closeDrawer(); location.href = n.page; } }
  function notifWA(id) { const n = _notifById[id]; if (n) window.open(waLink(n.phone, n.wa || `Dear ${n.party || ''}, regarding ${window.QLD.fC(n.amount || 0)} — `), '_blank'); }
  function notifDone(id) { const s = notifState(); s.done = s.done || {}; s.done[id] = Date.now(); saveNotifState(s); renderNotifications(); refreshNotifDot(); toast('Marked done'); }
  function notifSnooze(id) { const s = notifState(); s.snooze = s.snooze || {}; s.snooze[id] = Date.now() + 3 * 864e5; saveNotifState(s); renderNotifications(); refreshNotifDot(); toast('Snoozed 3 days'); }
  function addRenewal() {
    openForm({
      title: 'Add reminder', sub: 'Domain · hosting · subscription renewals',
      specs: [{ k: 'title', label: 'What renews?', req: true, ph: 'e.g. Domain quicklimes.com', full: true }, { k: 'date', label: 'Renewal date', type: 'date' }, { k: 'amount', label: 'Amount (₹)', type: 'number' }],
      saveLabel: 'Add reminder', initial: {},
      onSave(v) { window.QLD.addRenewal(v); if ($('qlDrawerBack').classList.contains('open')) renderNotifications(); refreshNotifDot(); toast('Reminder added'); }
    });
  }

  /* ════════════════ AI BUSINESS COPILOT ════════════════════════
     Rule-based NLU over live ERP data + manual-assist actions. */
  let _assistLog = [];
  const RECENT_KEY = 'ql_ai_recent';
  function aiRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (_) { return []; } }
  function aiPushRecent(q) { let a = aiRecent().filter(x => x.toLowerCase() !== q.toLowerCase()); a.unshift(q); localStorage.setItem(RECENT_KEY, JSON.stringify(a.slice(0, 8))); }
  function smartChips() {
    const Q = window.QLD, out = [];
    try { const top = Q.collections('all').rows[0]; if (top) out.push('Remind ' + top.party); } catch (_) {}
    out.push("Today's sales", 'Top customers this month', 'Overdue above 90 days', 'Pending supplier payments', 'Predict next month', 'Compare monthly sales', 'Net profit & margin');
    return out.slice(0, 8);
  }
  function renderAssistant() {
    const recent = aiRecent();
    const chips = smartChips().map(c => `<button class="ql-ai-chip" onclick="QLShell.assistAsk(this.textContent)">${esc(c)}</button>`).join('');
    const recentHtml = recent.length ? `<div class="ql-ai-recent"><span class="ql-ai-recent-h">Recent</span>${recent.slice(0, 5).map(c => `<button class="ql-ai-chip recent" onclick="QLShell.assistAsk(this.dataset.q)" data-q="${esc(c)}">${esc(c.length > 26 ? c.slice(0, 24) + '…' : c)}</button>`).join('')}</div>` : '';
    $('qlDrawerBody').innerHTML = `
      <div class="ql-ai-log" id="qlAiLog"></div>
      ${recentHtml}
      <div class="ql-ai-chips" id="qlAiChips">${chips}</div>
      <div class="ql-ai-input">
        <button class="ql-ai-mic" id="qlAiMic" title="Speak" aria-label="Voice input"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></button>
        <input id="qlAiInput" placeholder="Ask anything about your business…" autocomplete="off"
          onkeydown="if(event.key==='Enter'){QLShell.assistAsk(this.value);this.value=''}">
        <button class="ql-ai-send" onclick="var i=document.getElementById('qlAiInput');QLShell.assistAsk(i.value);i.value=''" aria-label="Send"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
      </div>`;
    const log = $('qlAiLog');
    if (!_assistLog.length) _assistLog.push({ who: 'ai', html: `<p>Hi 👋 I'm your business copilot for <b>${esc(window.QLD.co.short)}</b>. Ask me anything — invoices, a party's bills, overdue, top customers, supplier rates, profit, production, "predict next month" — or say <b>"create invoice"</b>, <b>"download invoice 142"</b>, <b>"export sales"</b>. Tap 🎤 to speak.</p>` });
    log.innerHTML = _assistLog.map(m => `<div class="ql-ai-msg ${m.who}">${m.html}</div>`).join('');
    log.scrollTop = log.scrollHeight;
    wireVoice();
  }
  function wireVoice() {
    const mic = $('qlAiMic'); if (!mic) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { mic.style.display = 'none'; return; }
    let rec = null, on = false;
    mic.onclick = () => {
      if (on) { rec && rec.stop(); return; }
      rec = new SR(); rec.lang = 'en-IN'; rec.interimResults = true; rec.continuous = false;
      rec.onstart = () => { on = true; mic.classList.add('on'); $('qlAiInput').placeholder = 'Listening…'; };
      rec.onresult = e => { $('qlAiInput').value = [...e.results].map(r => r[0].transcript).join(''); };
      rec.onend = () => { on = false; mic.classList.remove('on'); const i = $('qlAiInput'); i.placeholder = 'Ask anything about your business…'; const v = (i.value || '').trim(); if (v) { assistAsk(v); i.value = ''; } };
      rec.onerror = () => { on = false; mic.classList.remove('on'); $('qlAiInput').placeholder = 'Ask anything about your business…'; };
      rec.start();
    };
  }
  function assistAsk(q) {
    q = (q || '').trim(); if (!q) return;
    aiPushRecent(q);
    _assistLog.push({ who: 'me', html: esc(q) });
    let ans; try { ans = assistAnswer(q); } catch (e) { ans = `<p>Sorry, I hit a snag answering that. Try rephrasing?</p>`; }
    _assistLog.push({ who: 'ai', html: ans });
    if (_assistLog.length > 40) _assistLog = _assistLog.slice(-40);
    const log = $('qlAiLog');
    if (log) { log.innerHTML = _assistLog.map(m => `<div class="ql-ai-msg ${m.who}">${m.html}</div>`).join(''); log.scrollTop = log.scrollHeight; }
    else renderAssistant();
  }
  function findPartyInQuery(t) {
    const ps = window.QLD.partyRows(); let best = null;
    ps.forEach(p => { const nm = (p.name || '').toLowerCase(); if (nm && t.includes(nm.split(' ')[0]) && (!best || nm.length > best.name.length)) best = p; });
    return best;
  }
  function parseAmount(t) {
    let m = t.match(/([\d.,]+)\s*(crore|cr\b|lakh|lac|lk\b|l\b|k\b|thousand)/i);
    if (m) { let n = parseFloat(m[1].replace(/,/g, '')); const u = m[2].toLowerCase(); if (/cr|crore/.test(u)) n *= 1e7; else if (/lakh|lac|lk|^l$/.test(u)) n *= 1e5; else n *= 1e3; return n; }
    m = t.match(/(?:above|over|more than|greater than|exceeding|>|₹|rs\.?)\s*₹?\s*([\d,]{4,})/i);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
    return null;
  }
  function exportCSV(name, headers, rows) {
    // Round numeric cells (and numeric strings) to 2 dp so floating-point noise
    // like 1765.1500000000001 / 35303.00000000000 exports as 1765.15 / 35303.
    const num = c => {
      if (typeof c === 'number' && isFinite(c)) return Math.round(c * 100) / 100;
      if (typeof c === 'string' && /^-?\d+(\.\d+)?$/.test(c.trim())) { const n = parseFloat(c); if (isFinite(n)) return Math.round(n * 100) / 100; }
      return c;
    };
    const esc2 = c => { c = num(c); return `"${String(c == null ? '' : c).replace(/"/g, '""')}"`; };
    const csv = [headers.join(','), ...rows.map(r => r.map(esc2).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function assistAnswer(q) {
    const Q = window.QLD, t = q.toLowerCase(), fc = Q.fC, ym = new Date().toISOString().slice(0, 7), todayISO = new Date().toISOString().slice(0, 10);
    const party = findPartyInQuery(t);
    const list = (rows, cols) => `<table class="ql-ai-tbl"><tbody>${rows.map(r => '<tr>' + cols.map(c => `<td${c.r ? ' class="r"' : ''}>${c.v(r)}</td>`).join('') + '</tr>').join('')}</tbody></table>`;
    const acts = btns => `<div class="ql-ai-acts">${btns}</div>`;
    const pPhone = nm => { const p = Q.partyRows().find(x => (x.name || '').toUpperCase() === (nm || '').toUpperCase()); return p ? p.phone : ''; };
    const waBtn = (nm, amt, bills) => { const ph = pPhone(nm); if (!ph) return ''; const msg = `Dear ${nm},\nGentle reminder: ${fc(amt)} is pending with us${bills ? ` (${bills} bill${bills > 1 ? 's' : ''})` : ''}. Kindly arrange payment.\nThank you,\n${Q.co.short}`; return `<button onclick="window.open('${waLink(ph, msg)}','_blank')">WhatsApp ${esc(nm.split(' ')[0])}</button>`; };

    /* ───── ACTIONS (manual-assist) ───── */
    if (/\b(create|new|add|make|raise)\b.*(invoice|bill|sale)\b/.test(t)) { closeDrawer(); openSaleForm(); return `<p>Opening a new GST invoice form…</p>`; }
    if (/\b(create|new|add)\b.*(supplier|vendor)\b/.test(t)) { closeDrawer(); openPartyForm(); return `<p>Opening the add-party form — set <b>Type: Supplier</b>.</p>`; }
    if (/\b(create|new|add)\b.*(party|customer|client)\b/.test(t)) { closeDrawer(); openPartyForm(); return `<p>Opening the add-party form…</p>`; }
    if (/\b(create|new|add|schedule|set)\b.*(reminder|renewal|follow.?up|task)/.test(t)) { addRenewal(); return `<p>Opening the reminder form — it'll show in your notifications.</p>`; }
    if (/\b(download|get|print|pdf|open)\b.*(invoice|bill)\b|invoice\s*#?\s*\w*\d/.test(t) && /\b(download|get|print|pdf|open|show)\b/.test(t)) {
      const m = q.match(/(?:invoice|bill|#)\s*#?\s*([A-Za-z0-9/\-]*\d[A-Za-z0-9/\-]*)/i);
      if (m) { const row = Q.salesRows().find(r => (r.inv || '').toLowerCase() === m[1].toLowerCase() || (r.inv || '').toLowerCase().includes(m[1].toLowerCase())); if (row) { printInvoice(row.idx); return `<p>Generating the PDF for invoice <b>${esc(row.inv)}</b> — use Print / Save PDF in the new tab.</p>`; } return `<p>No invoice matching "${esc(m[1])}".</p>`; }
    }
    if (/\bexport\b|download.*(report|register|sheet|csv|excel|data)/.test(t)) {
      if (/purchase|supplier/.test(t)) { const r = Q.purchaseRows(); exportCSV('purchases_' + Q.co.short, ['Bill', 'Date', 'Supplier', 'Category', 'Taxable', 'GST', 'Total', 'Status'], r.map(x => [x.bill, x.date, x.sup, x.cat, x.taxable, x.gst, x.total, x.status])); return `<p>Exported <b>${r.length}</b> purchase rows to CSV (opens in Excel).</p>`; }
      const r = Q.salesRows(); exportCSV('sales_' + Q.co.short, ['Invoice', 'Date', 'Party', 'Qty', 'Taxable', 'GST', 'Total', 'Status'], r.map(x => [x.inv, x.date, x.party, x.qty, x.taxable, x.gst, x.total, x.status])); return `<p>Exported <b>${r.length}</b> sales rows to CSV (opens in Excel).</p>`;
    }

    /* ───── INSIGHTS / ANALYSIS ───── */
    if (/(why|explain|reason).*(profit|margin|low|down|loss)|profit.*(low|down|why)/.test(t)) {
      const p = Q.getPL(), ser = Q.monthSeries(2), cur = ser[1] || {}, prev = ser[0] || {}, bits = [];
      bits.push(`Net profit is <b>${fc(p.np)}</b> at <b>${p.npm.toFixed(1)}%</b> (gross ${p.gpm.toFixed(1)}%).`);
      if (p.cogs) bits.push(`Material cost ${fc(p.cogs)} = ${(p.rev ? p.cogs / p.rev * 100 : 0).toFixed(0)}% of sales.`);
      bits.push(`Labour ${fc(p.labour)}, net GST ${fc(p.netGST)}.`);
      if (cur.sales != null && prev.sales) { const mom = (cur.sales - prev.sales) / prev.sales * 100; bits.push(`Sales ${mom >= 0 ? 'up' : 'down'} <b>${Math.abs(mom).toFixed(0)}%</b> vs last month.`); }
      return `<p>${bits.join(' ')}</p><p class="ql-ai-tip">Biggest levers: collect overdue dues and watch material cost vs sale price.</p>`;
    }
    // predict next month
    if (/(predict|forecast|projection|next month|expected|requirement)/.test(t)) {
      const ser = Q.monthSeries(4).slice(0, 3), n = ser.length || 1;
      const avgQty = ser.reduce((a, m) => a + (m.qty || 0), 0) / n, avgSales = ser.reduce((a, m) => a + (m.sales || 0), 0) / n, avgPur = ser.reduce((a, m) => a + (m.purchases || 0), 0) / n;
      return `<p>Based on the last ${n} months' average, next month is likely:</p>`
        + list([{ l: 'Dispatch / production', v: Q.fmt(avgQty, 1) + ' T' }, { l: 'Sales', v: fc(avgSales) }, { l: 'Material purchases', v: fc(avgPur) }, { l: 'Est. limestone needed', v: Q.fmt(avgQty * 1.8, 0) + ' T' }],
          [{ v: r => r.l }, { r: 1, v: r => '<b>' + r.v + '</b>' }])
        + `<p class="ql-ai-tip">Rough projection from trend — adjust for known orders.</p>`;
    }

    /* ───── COLLECTIONS / OVERDUE ───── */
    const overDays = t.match(/(?:above|over|more than|older than|>)\s*(\d{2,3})\s*day/);
    if (/(overdue|outstanding|pending|collection|receivable)/.test(t) && (overDays || /highest|most|top|biggest|above|over \d/.test(t)) && !party) {
      let rows = Q.collections('all').rows;
      if (overDays) rows = rows.filter(r => r.days > +overDays[1]);
      const amt = parseAmount(t); if (amt && /\b(above|over|more)\b/.test(t) && !overDays) rows = rows.filter(r => r.total > amt);
      rows = rows.slice(0, 10);
      if (!rows.length) return `<p>No matching overdue collections 🎉</p>`;
      const tot = rows.reduce((a, r) => a + r.total, 0);
      return `<p><b>${rows.length}</b> ${overDays ? 'parties over ' + overDays[1] + ' days' : 'top overdue'} · <b>${fc(tot)}</b> total.</p>`
        + list(rows, [{ v: r => esc(r.party) }, { r: 1, v: r => fc(r.total) }, { r: 1, v: r => r.days + 'd' }])
        + acts(`<button onclick="location.href='sales.html?filter=pending'">Open collections</button>${waBtn(rows[0].party, rows[0].total, rows[0].bills)}`);
    }
    if (/(remind|reminder|whatsapp|message|follow.?up|chase)/.test(t)) {
      const tgt = party || Q.collections('all').rows[0];
      if (!tgt) return `<p>No overdue party to remind right now 🎉</p>`;
      const nm = tgt.name || tgt.party, coll = Q.collections('all').rows.find(r => (r.party || '').toUpperCase() === (nm || '').toUpperCase()), amt = coll ? coll.total : 0;
      const msg = `Dear ${nm},\nGentle reminder: ${fc(amt)} is pending with us${coll ? ` (${coll.bills} bill${coll.bills > 1 ? 's' : ''})` : ''}. Kindly arrange payment at your earliest.\nThank you,\n${Q.co.short}`;
      return `<p>Reminder for <b>${esc(nm)}</b>${amt ? ` — ${fc(amt)} pending` : ''}:</p><div class="ql-ai-quote">${esc(msg).replace(/\n/g, '<br>')}</div>` + acts(waBtn(nm, amt, coll ? coll.bills : 0) || '<span class="ql-ai-tip">No phone saved for this party.</span>');
    }

    /* ───── PARTY-SPECIFIC ───── */
    if (party) {
      const nm = party.name, all = Q.salesRows().filter(r => (r.party || '').toUpperCase() === nm.toUpperCase());
      // last month
      if (/last month|previous month/.test(t)) {
        const d = new Date(); const lm = new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().slice(0, 7);
        const rows = all.filter(r => (r.date || '').slice(0, 7) === lm);
        return `<p><b>${esc(nm)}</b> — ${rows.length} invoice${rows.length !== 1 ? 's' : ''} last month (${fc(rows.reduce((a, r) => a + r.total, 0))}).</p>` + (rows.length ? list(rows.slice(0, 8), [{ v: r => '<b>' + esc(r.inv) + '</b>' }, { v: r => Q.fDS(r.date) }, { r: 1, v: r => fc(r.total) }]) : '');
      }
      // highest value
      if (/highest|biggest|largest|max|top value/.test(t)) {
        if (!all.length) return `<p>No invoices for ${esc(nm)}.</p>`;
        const top = all.slice().sort((a, b) => b.total - a.total)[0];
        return `<p><b>${esc(nm)}</b>'s highest invoice: <b>${esc(top.inv)}</b> — ${fc(top.total)} (${Q.fDS(top.date)}, ${top.status}).</p>` + acts(`<button onclick="QLShell.printInvoice(${top.idx})">Download PDF</button>`);
      }
      // unpaid / ledger / all
      const pend = all.filter(r => r.status === 'pending');
      if (/unpaid|pending|outstanding|due/.test(t)) {
        return `<p><b>${esc(nm)}</b> — <b>${pend.length} unpaid</b> (${fc(pend.reduce((a, r) => a + r.total, 0))}) of ${all.length} invoices.</p>` + (pend.length ? list(pend.slice(0, 8), [{ v: r => '<b>' + esc(r.inv) + '</b>' }, { v: r => Q.fDS(r.date) }, { r: 1, v: r => fc(r.total) }, { r: 1, v: r => r.days + 'd' }]) : '') + acts(waBtn(nm, pend.reduce((a, r) => a + r.total, 0), pend.length));
      }
      if (/ledger|statement|account|history|all (bill|invoice)|all sales/.test(t)) {
        const billed = all.reduce((a, r) => a + r.total, 0), pendT = pend.reduce((a, r) => a + r.total, 0);
        return `<p><b>${esc(nm)}</b> ledger — ${all.length} invoices, ${fc(billed)} billed, <b>${fc(pendT)} outstanding</b>.</p>` + list(all.slice(0, 10), [{ v: r => '<b>' + esc(r.inv) + '</b>' }, { v: r => Q.fDS(r.date) }, { r: 1, v: r => fc(r.total) }, { r: 1, v: r => '<span class="ql-ai-pill ' + r.status + '">' + r.status + '</span>' }]);
      }
      // default party summary
      return `<p><b>${esc(nm)}</b> — ${all.length} invoice${all.length !== 1 ? 's' : ''}, ${fc(all.reduce((a, r) => a + r.total, 0))} billed, <b>${pend.length} pending</b> (${fc(pend.reduce((a, r) => a + r.total, 0))}).</p>` + (pend.length ? list(pend.slice(0, 6), [{ v: r => '<b>' + esc(r.inv) + '</b>' }, { v: r => Q.fDS(r.date) }, { r: 1, v: r => fc(r.total) }]) : '') + acts(waBtn(nm, pend.reduce((a, r) => a + r.total, 0), pend.length));
    }

    /* ───── TOP CUSTOMERS / SUPPLIERS ───── */
    if (/top.*(customer|client|buyer|party)|best.*(customer|buyer)|biggest customer/.test(t)) {
      let rows = Q.salesRows(); let scope = '';
      if (/month/.test(t)) { rows = rows.filter(r => (r.date || '').slice(0, 7) === ym); scope = ' this month'; }
      const by = {}; rows.forEach(r => { const k = r.party || '—'; by[k] = (by[k] || 0) + r.total; });
      const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (!top.length) return `<p>No sales${scope} yet.</p>`;
      return `<p>Top customers${scope}:</p>` + list(top, [{ v: r => esc(r[0]) }, { r: 1, v: r => fc(r[1]) }]);
    }
    if (/compare.*(supplier|vendor|rate|price)|supplier.*(rate|price|compare)/.test(t)) {
      const by = {}; Q.state.PURCHASES.forEach(p => { const k = p.sup || '—'; const rate = p.rate || (p.qty ? p.taxable / p.qty : 0); if (!rate) return; by[k] = by[k] || { sum: 0, n: 0, cat: p.cat }; by[k].sum += rate; by[k].n++; });
      const rows = Object.entries(by).map(([s, v]) => [s, v.sum / v.n]).sort((a, b) => a[1] - b[1]);
      if (!rows.length) return `<p>Not enough purchase rate data to compare.</p>`;
      return `<p>Average purchase rate by supplier (lowest first):</p>` + list(rows.slice(0, 10), [{ v: r => esc(r[0]) }, { r: 1, v: r => fc(Math.round(r[1])) + '/unit' }]);
    }
    if (/(supplier|vendor).*(payment|pending|due|pay|owe)|pending.*(supplier|payment)|pay.*supplier|accounts payable/.test(t)) {
      const by = {}; Q.state.PURCHASES.filter(p => (p.status || 'pending') === 'pending').forEach(p => { const k = p.sup || '—'; by[k] = by[k] || { total: 0, bills: 0 }; by[k].total += Q.cS ? 0 : 0; });
      const map = {}; Q.purchaseRows().filter(r => r.status === 'pending').forEach(r => { map[r.sup] = map[r.sup] || { total: 0, bills: 0 }; map[r.sup].total += r.total; map[r.sup].bills++; });
      const rows = Object.entries(map).sort((a, b) => b[1].total - a[1].total);
      if (!rows.length) return `<p>No pending supplier payments 🎉</p>`;
      const tot = rows.reduce((a, r) => a + r[1].total, 0);
      return `<p><b>${fc(tot)}</b> due to <b>${rows.length}</b> suppliers.</p>` + list(rows.slice(0, 8), [{ v: r => esc(r[0]) }, { r: 1, v: r => r[1].bills + ' bill' + (r[1].bills > 1 ? 's' : '') }, { r: 1, v: r => fc(r[1].total) }]) + acts(`<button onclick="location.href='purchase.html'">Open purchases</button>`);
    }

    /* ───── COMPARE / REPORTS ───── */
    if (/compare.*(month|sales)|month.*(compar|by month|over month|wise)|monthly (sales|comparison|trend)/.test(t)) {
      const ser = Q.monthSeries(6);
      return `<p>Monthly comparison (sales · gross profit):</p>` + list(ser.slice().reverse(), [{ v: r => esc(r.m) }, { r: 1, v: r => fc(r.sales) }, { r: 1, v: r => fc(r.profit) }]);
    }
    if (/production|dispatch|output|tonn|capacity/.test(t)) {
      const pr = Q.production(), ser = Q.monthSeries(4);
      return list([{ l: 'Today', v: Q.fmt(pr.today, 1) + ' T' }, { l: 'This week', v: Q.fmt(pr.week, 1) + ' T' }, { l: 'This month', v: Q.fmt(pr.month, 1) + ' T' }, { l: 'Chunna (month)', v: Q.fmt(pr.chunnaMonth, 1) + ' T' }], [{ v: r => r.l }, { r: 1, v: r => '<b>' + r.v + '</b>' }])
        + `<p style="margin-top:6px">Recent dispatch:</p>` + list(ser.slice().reverse(), [{ v: r => esc(r.m) }, { r: 1, v: r => Q.fmt(r.qty, 1) + ' T' }]) + acts(`<button onclick="location.href='production.html'">Open Production</button>`);
    }

    /* ───── FINANCE ───── */
    if (/(net profit|profit|margin|p&l|p and l|income statement)/.test(t)) {
      const p = Q.getPL();
      return list([{ l: 'Revenue (taxable)', v: fc(p.rev) }, { l: 'Material cost', v: '−' + fc(p.cogs) }, { l: 'Gross profit', v: fc(p.gp) + ` (${p.gpm.toFixed(1)}%)` }, { l: 'Labour', v: '−' + fc(p.labour) }, { l: 'Net GST', v: '−' + fc(p.netGST) }, { l: 'Net profit', v: '<b>' + fc(p.np) + `</b> (${p.npm.toFixed(1)}%)` }], [{ v: r => r.l }, { r: 1, v: r => r.v }]) + acts(`<button onclick="location.href='pl.html'">Open P&amp;L</button>`);
    }
    if (/\bgst\b|tax payable|gstr/.test(t)) {
      const g = Q.gstSummary();
      return `<p>Output GST <b>${fc(g.outGST)}</b> − ITC ${fc(g.itc)} = <b>net payable ${fc(g.net)}</b>.</p>` + acts(`<button onclick="location.href='gst.html'">Open GST</button>`);
    }
    if (/(collection|receivable|to collect|who.*owe)/.test(t)) {
      const c = Q.collections('all');
      return `<p><b>${fc(c.total)}</b> pending across <b>${c.parties}</b> parties (${c.overdue} overdue 30d+).</p>` + list(c.rows.slice(0, 7), [{ v: r => esc(r.party) }, { r: 1, v: r => fc(r.total) }, { r: 1, v: r => r.days + 'd' }]) + acts(`<button onclick="location.href='sales.html?filter=pending'">Open collections</button>`);
    }

    /* ───── INVOICE SEARCH / FILTERS ───── */
    const amtAbove = (/\b(above|over|more than|greater|exceeding|>)\b/.test(t)) ? parseAmount(t) : null;
    if (amtAbove && /(invoice|bill|sale|order)/.test(t)) {
      const rows = Q.salesRows().filter(r => r.total > amtAbove).sort((a, b) => b.total - a.total).slice(0, 12);
      return `<p><b>${rows.length}</b> invoice${rows.length !== 1 ? 's' : ''} above ${fc(amtAbove)}:</p>` + list(rows, [{ v: r => '<b>' + esc(r.inv) + '</b>' }, { v: r => esc(r.party) }, { r: 1, v: r => fc(r.total) }]);
    }
    if (/today.*(sale|sales|invoice|bill)|sales today|today.*business/.test(t)) {
      const rows = Q.salesRows().filter(r => r.date === todayISO);
      return `<p><b>${rows.length}</b> invoice${rows.length !== 1 ? 's' : ''} today · <b>${fc(rows.reduce((a, r) => a + r.total, 0))}</b>.</p>` + (rows.length ? list(rows, [{ v: r => '<b>' + esc(r.inv) + '</b>' }, { v: r => esc(r.party) }, { r: 1, v: r => fc(r.total) }]) : '<p class="ql-ai-tip">No invoices recorded today yet.</p>');
    }
    if (/(find|search|show|locate).*(invoice|bill)|invoice (no|number|#)|bill (no|number|#)/.test(t)) {
      const m = q.match(/([A-Za-z0-9/\-]*\d[A-Za-z0-9/\-]*)/);
      let rows = Q.salesRows();
      if (m) { const k = m[1].toLowerCase(); rows = rows.filter(r => (r.inv || '').toLowerCase().includes(k)); }
      rows = rows.slice(0, 8);
      if (!rows.length) return `<p>No matching invoice found.</p>`;
      return list(rows, [{ v: r => '<b>' + esc(r.inv) + '</b>' }, { v: r => esc(r.party) }, { r: 1, v: r => fc(r.total) }, { r: 1, v: r => `<button class="ql-ai-mini" onclick="QLShell.printInvoice(${r.idx})">PDF</button>` }]);
    }

    /* ───── PURCHASES / SALES (general) ───── */
    if (/purchase|supplier|bought|raw material|petcoke/.test(t)) {
      let rows = Q.purchaseRows(); const dm = t.match(/(\d+)\s*day/); if (dm) rows = rows.filter(r => r.days <= +dm[1]);
      const tot = rows.reduce((a, r) => a + r.taxable, 0);
      return `<p>${rows.length} purchase bill${rows.length !== 1 ? 's' : ''}${dm ? ` in last ${dm[1]} days` : ''} · <b>${fc(tot)}</b> taxable.</p>` + list(rows.slice(0, 7), [{ v: r => '<b>' + esc(r.bill) + '</b>' }, { v: r => esc(r.sup) }, { r: 1, v: r => fc(r.taxable) }]) + acts(`<button onclick="location.href='purchase.html'">Open purchases</button><button onclick="QLShell.assistAsk('export purchases')">Export CSV</button>`);
    }
    if (/(sales|sale|revenue|invoice|turnover|business)/.test(t)) {
      const s = Q.salesSummary(); let rows = Q.salesRows(), scope = '';
      if (/month/.test(t)) { rows = rows.filter(r => (r.date || '').slice(0, 7) === ym); scope = ' this month'; }
      const tx = rows.reduce((a, r) => a + r.taxable, 0);
      return `<p>${rows.length} invoice${rows.length !== 1 ? 's' : ''}${scope} · <b>${fc(tx)}</b> sales (excl. GST). ${fc(s.pending)} pending.</p>` + list(rows.slice(0, 6), [{ v: r => '<b>' + esc(r.inv) + '</b>' }, { v: r => esc(r.party) }, { r: 1, v: r => fc(r.total) }]) + acts(`<button onclick="location.href='sales.html'">Open sales</button><button onclick="QLShell.assistAsk('export sales')">Export CSV</button>`);
    }
    /* ───── FALLBACK ───── */
    return `<p>I can pull invoices, a party's bills/ledger, overdue & collections, top customers, supplier rates & payments, profit, GST, production, comparisons and forecasts — and create invoices/parties, draft reminders, download PDFs or export CSV. Try a suggestion below 👇</p>`;
  }
  /* ════════════════════════ PUBLIC API ══════════════════════════ */
  window.QLShell = {
    toggleSidebar, toggleMobileSidebar, toggleGroup, openPalette, closePalette, toast,
    openNotifications, openAssistant, closeDrawer, assistAsk,
    notifOpen, notifWA, notifDone, notifSnooze, addRenewal, refreshNotifDot,
    closePhotoModal() { $('photoBack').classList.remove('open'); },
    savePhoto() {}, removePhoto() {},
    paintWorkspace,
    setBreadcrumb(label) { const c = document.querySelector('.tb-crumb-active'); if (c) c.textContent = label; },
    setNotifDot(on) { const d = $('tbNotifDot'); if (d) d.style.display = on ? '' : 'none'; },
    // form modals + row action menus
    closeModal, openForm, openSaleForm, openPurchaseForm, openPartyForm, openWorkerForm, openCashForm, openChunnaForm, openTdsForm, openPaymentForm,
    rowMenu, printInvoice, exportCSV,
    formPrompt(title, specs, onSave, sub) { openForm({ title, sub, specs, saveLabel: 'Save', initial: {}, onSave(v) { onSave(v); } }); },
    getInvoiceHTML(idx) { const d = window.QLD.invoiceData(idx); return d ? invoiceHTML(d) : ''; },
    renderInvoice(d) { return invoiceHTML(d); },

    // ── Feature Management (Settings) ──
    feat: featOn,
    features() { return FEATURES.map(x => ({ key: x.key, label: x.label, desc: x.desc, core: !!x.core, locked: !!x.locked, active: featOn(x.key) })); },
    setFeature(k, on) { setFeat(k, on); this.refreshNav(); this.applyFeatureVisibility(); },
    resetFeatures() { try { localStorage.removeItem(FEAT_KEY); } catch (_) {} FEAT = loadFeatures(); this.refreshNav(); this.applyFeatureVisibility(); },
    refreshNav() { const nav = document.querySelector('.sb-nav'); if (nav) { nav.innerHTML = navHTML(_active); refreshNotifDot(); } },
    applyFeatureVisibility() { document.querySelectorAll('[data-feat]').forEach(el => { el.style.display = featOn(el.getAttribute('data-feat')) ? '' : 'none'; }); },

    mount(opts) {
      opts = opts || {};
      _active = opts.active || 'dashboard';
      const page = document.getElementById('ql-page');
      const content = page ? page.innerHTML : '';
      if (page) page.remove();
      // inject shell
      const wrap = document.createElement('div');
      wrap.innerHTML = shellHTML(_active, '');
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
      this.applyFeatureVisibility();
    }
  };
  let _active = 'dashboard';
})();
