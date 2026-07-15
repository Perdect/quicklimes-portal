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
    { key: 'reports',    label: 'Reports & Analytics', desc: 'Reports hub and analytics' },
    { key: 'ai',         label: 'AI Assistant',      desc: 'Ask about your business — invoices, dues, GST, production' }
  ];
  // Business-process default sidebar (matches the ERP spec's main nav):
  // Dashboard · Sales · Purchase · Finance · Production · Inventory · Reports · AI · Settings.
  const FEAT_DEFAULT_ON = { dashboard: 1, sales: 1, purchase: 1, finance: 1, production: 1, inventory: 1, reports: 1, ai: 1, settings: 1 };
  const FEAT_KEY = 'ql_features';
  function loadFeatures() {
    const f = {}; FEATURES.forEach(x => { f[x.key] = !!FEAT_DEFAULT_ON[x.key]; });
    try { const s = JSON.parse(localStorage.getItem(FEAT_KEY) || '{}'); Object.keys(s).forEach(k => { if (k in f) f[k] = !!s[k]; }); } catch (_) {}
    FEATURES.forEach(x => { if (x.locked) f[x.key] = true; });   // core-locked always on
    return f;
  }
  let FEAT = loadFeatures();

  /* ── Roles & access (frontend RBAC layer; each role = a preset of modules).
        Real server-enforced multi-user is the backend follow-up — this is the
        access layer + a "work as role" switcher, always reachable from the
        profile menu so you can never lock yourself out. ── */
  const ROLES = [
    { key: 'admin',      label: 'Admin',      desc: 'Full access to every module',                 feats: '*' },
    { key: 'partner',    label: 'Partner',    desc: 'Owner-level view of the whole business',       feats: '*' },
    { key: 'accountant', label: 'Accountant', desc: 'Sales, purchase, finance, GST/TDS/P&L, reports', feats: ['sales', 'purchase', 'finance', 'advfinance', 'monthreg', 'reports', 'people'] },
    { key: 'sales',      label: 'Sales',      desc: 'GST invoices, sales register, customers',      feats: ['sales', 'people', 'reports'] },
    { key: 'purchase',   label: 'Purchase',   desc: 'Purchase register, suppliers, stock',          feats: ['purchase', 'people', 'inventory'] },
    { key: 'production', label: 'Production',  desc: 'Production, kiln & stock',                     feats: ['production', 'inventory', 'monthreg'] },
    { key: 'dispatch',   label: 'Dispatch',   desc: 'Dispatch, invoices & stock',                   feats: ['sales', 'production', 'inventory'] }
  ];
  const ROLE_KEY = 'ql_role';
  const FULL_ROLES = ['owner', 'admin', 'partner'];
  // The server-issued role from login (employees carry a restricted role in
  // their token). For a real employee this is AUTHORITATIVE — the UI can't
  // widen it, and the backend enforces it regardless. The owner (full role)
  // keeps the personal "work as role" view switcher below.
  function serverRole() { try { return (JSON.parse(localStorage.getItem('ql_plant') || 'null') || {}).role || ''; } catch (_) { return ''; } }
  function isEmployee() { const r = serverRole(); return !!r && FULL_ROLES.indexOf(r) < 0; }
  function currentRole() {
    if (isEmployee()) return serverRole();                       // locked to server role
    try { return localStorage.getItem(ROLE_KEY) || 'admin'; } catch (_) { return 'admin'; }
  }
  function roleDef() { return ROLES.find(r => r.key === currentRole()) || ROLES[0]; }
  function roleAllows(k) { const r = roleDef(); if (r.feats === '*') return true; if (k === 'dashboard') return true; return r.feats.indexOf(k) >= 0; }
  function setRole(k) { if (isEmployee()) return; if (!ROLES.some(r => r.key === k)) return; try { localStorage.setItem(ROLE_KEY, k); } catch (_) {} }

  /* ── Data-management permission matrix ───────────────────────────
     Frontend gate for Archive/Trash/Void/Purge/Backup. The account OWNER (not an
     employee sub-login) is super-admin. Employee logins are gated by their
     server-assigned role; permanent delete is never granted below admin.
     (Server-side enforcement of these is the employee-RBAC fast-follow.) */
  const PERMS = {
    admin:      ['viewArchived', 'archive', 'restoreArchived', 'trash', 'viewTrash', 'restore', 'void', 'viewAudit', 'backup', 'purge'],
    partner:    ['*'],
    accountant: ['viewArchived', 'archive', 'restoreArchived', 'trash', 'viewTrash', 'restore', 'void', 'viewAudit', 'backup'],
    sales:      ['trash', 'viewTrash', 'restore', 'void'],
    purchase:   ['trash', 'viewTrash', 'restore', 'void'],
    production: ['trash', 'viewTrash', 'restore'],
    dispatch:   ['trash', 'viewTrash', 'restore']
  };
  function can(perm) {
    if (!isEmployee()) return true;                                // account owner = super-admin
    const p = PERMS[serverRole()] || PERMS.sales;
    return p.indexOf('*') >= 0 || p.indexOf(perm) >= 0;
  }

  const featOn = k => FEAT[k] !== false && roleAllows(k);
  function setFeat(k, on) { const x = FEATURES.find(y => y.key === k); if (!x || x.locked) return; FEAT[k] = !!on; try { localStorage.setItem(FEAT_KEY, JSON.stringify(FEAT)); } catch (_) {} }

  const NAV = [
    { type: 'solo', id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: I.grid, feat: 'dashboard' },
    { type: 'solo', id: 'command', label: 'Command Center', href: 'command.html', icon: I.pulse, feat: 'command' },
    { type: 'group', label: 'Sales', feat: 'sales', items: [
      { id: 'invoice',     label: 'GST Invoice',     href: 'invoice.html', icon: I.invoice },
      { id: 'sales',       label: 'Sales Register',  href: 'sales.html', icon: I.sales },
      { id: 'customers',   label: 'Customers',       href: 'parties.html#customer', icon: I.users },
      { id: 'collections', label: 'Collections',     href: 'collections.html', icon: I.coll, badgeKey: 'collections' },
      { id: 'crm',         label: 'Sales Pipeline',  href: 'crm.html', icon: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>' },
      { id: 'monthreg',    label: 'Monthly Register', href: 'monthreg.html', icon: I.cal, feat: 'monthreg' }
    ]},
    { type: 'group', label: 'Purchase', feat: 'purchase', items: [
      { id: 'purchasedash', label: 'Purchase Dashboard', href: 'purchasedash.html', icon: I.grid },
      { id: 'purchase',  label: 'Purchase Register', href: 'purchase.html', icon: I.bag },
      { id: 'payables',  label: 'Payments Due',      href: 'payables.html', icon: I.card, badgeKey: 'payables' },
      { id: 'suppliers', label: 'Suppliers',         href: 'parties.html#supplier', icon: I.factory }
    ]},
    { type: 'group', label: 'Finance', feat: 'finance', items: [
      { id: 'finance',  label: 'Payments Center',          href: 'payments.html', icon: I.bank },
      { id: 'banks',    label: 'Banks',                    href: 'banks.html', icon: I.bank },
      { id: 'reconcile', label: 'Bank Reconciliation',     href: 'reconcile.html', icon: I.bank },
      { id: 'refunds',  label: 'GST Refunds',              href: 'refunds.html', icon: I.receipt },
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
      { id: 'inventory', label: 'Overview',         href: 'inventory.html', icon: I.box },
      { id: 'stock',    label: 'Stock Management',  href: SOON, icon: I.layers, soon: true },
      { id: 'dispatch', label: 'Dispatch',          href: SOON, icon: I.truck, soon: true }
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
    { type: 'solo', id: 'ai', label: 'AI Assistant', href: 'ai.html', icon: I.pulse, feat: 'ai' },
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
  <button class="profile-menu-item" id="pmRole"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span>Working as: <b id="pmRoleName">Admin</b></span></button>
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
      // ⌘/Ctrl+J toggles the assistant (⌘K is the command palette)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        const open = $('qlDrawerBack').classList.contains('open') && $('qlDrawer').dataset.mode === 'ai';
        open ? closeDrawer() : openAssistant();
      }
      if (e.key === 'Escape') {
        closePalette();
        if ($('qlDrawerBack') && $('qlDrawerBack').classList.contains('open')) closeDrawer();
      }
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
  function updateRoleLabel() {
    const el = $('pmRoleName'); if (el) el.textContent = roleDef().label;
    // Employees can't switch their view — lock the "Work as role" control.
    const pr = $('pmRole');
    if (pr && isEmployee()) {
      pr.style.opacity = '.55'; pr.style.pointerEvents = 'none'; pr.title = 'Your role is set by the account owner';
    }
  }
  function openRolePicker() {
    openForm({
      title: 'Work as role', sub: 'The sidebar shows only this role’s modules. Switch back anytime from here.',
      specs: [{ k: 'role', label: 'Role', type: 'select', full: true, opts: ROLES.map(r => [r.key, r.label + ' — ' + r.desc]) }],
      initial: { role: currentRole() }, saveLabel: 'Apply role',
      onSave(v) {
        setRole(v.role);
        const nav = document.querySelector('.sb-nav'); if (nav) nav.innerHTML = navHTML(_active);
        document.querySelectorAll('[data-feat]').forEach(el => { el.style.display = featOn(el.getAttribute('data-feat')) ? '' : 'none'; });
        updateRoleLabel(); refreshNotifDot(); toast('Now working as ' + roleDef().label);
      }
    });
  }
  function wireProfile() {
    const m = $('profileMenu');
    updateRoleLabel();
    const pr = $('pmRole'); if (pr) pr.addEventListener('click', () => { m.classList.remove('open'); openRolePicker(); });
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
    // Layout-only specs: a section divider, or a raw read-only HTML block (used
    // by importers to show exactly what was read off the document). Neither
    // carries a value, so readForm skips them.
    if (f.type === 'section') return `<div class="qlf-section"><span>${esc(f.label)}</span></div>`;
    if (f.type === 'html') return `<div class="qlf-html">${f.html || ''}</div>`;
    const id = 'qf_' + f.k;
    const val = v == null ? '' : v;
    // opts may be a FUNCTION so a field can build its list at open time from a
    // live source (e.g. the industry list owned by ICPCore). f.opts.map would
    // throw on a function, so resolve it once, here, for every field type.
    if (typeof f.opts === 'function') f = Object.assign({}, f, { opts: f.opts() || [] });
    const lbl = `<label class="qlf-label" for="${id}">${f.label}${f.req ? ' <span class="qlf-req">*</span>' : ''}</label>`;
    let ctrl;
    if (f.type === 'select') {
      ctrl = `<select class="qlf-input" id="${id}">${f.opts.map(o => { const ov = Array.isArray(o) ? o[0] : o, ol = Array.isArray(o) ? o[1] : o; return `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`;
    } else if (f.type === 'searchselect') {
      const hit = f.opts.find(o => String(Array.isArray(o) ? o[0] : o) === String(val));
      const selLabel = hit ? (Array.isArray(hit) ? hit[1] : hit) : '';
      const optsHtml = f.opts.map(o => { const ov = Array.isArray(o) ? o[0] : o, ol = Array.isArray(o) ? o[1] : o; return `<div class="qlf-combo-opt${String(ov) === String(val) ? ' sel' : ''}" role="option" data-v="${esc(ov)}" data-l="${esc(ol)}" onmousedown="QLShell._comboPick(event,'${esc(f.k)}')">${esc(ol)}</div>`; }).join('');
      ctrl = `<div class="qlf-combo">
        <input type="hidden" id="${id}" value="${esc(val)}">
        <input class="qlf-input qlf-combo-search" id="${id}_s" autocomplete="off" role="combobox" aria-expanded="false" placeholder="${esc(f.ph || 'Search…')}" value="${esc(selLabel)}"
          oninput="QLShell._comboFilter('${esc(f.k)}')" onfocus="QLShell._comboFocus('${esc(f.k)}')" onblur="QLShell._comboBlur('${esc(f.k)}')" onkeydown="QLShell._comboKey(event,'${esc(f.k)}')">
        <div class="qlf-combo-list" id="${id}_l">${optsHtml}</div>
      </div>`;
    } else if (f.type === 'textarea') {
      ctrl = `<textarea class="qlf-input" id="${id}" rows="2" placeholder="${esc(f.ph || '')}">${esc(val)}</textarea>`;
    } else {
      ctrl = `<input class="qlf-input" id="${id}" type="${f.type || 'text'}" value="${esc(val)}" placeholder="${esc(f.ph || '')}" ${f.type === 'number' ? 'inputmode="decimal" step="any"' : ''}>`;
    }
    // hint: a short line under the control explaining WHY a field matters
    // (e.g. what the GSTIN is actually used for). Optional — omit and nothing renders.
    const hint = f.hint ? `<div class="qlf-hint">${esc(f.hint)}</div>` : '';
    return `<div class="qlf-field ${f.full ? 'qlf-full' : ''}${f.quarter ? ' qlf-quarter' : ''}">${lbl}${ctrl}${hint}</div>`;
  }
  function readForm(specs) {
    const out = {};
    for (const f of specs) {
      if (f.type === 'section' || f.type === 'html') continue;
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
    $('qlModal').classList.toggle('wide', !!cfg.wide);
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
    save.onclick = async () => {
      const v = readForm(specs);
      const miss = specs.find(f => f.req && (v[f.k] === '' || v[f.k] === 0 && f.reqNonZero));
      if (miss) { toast(miss.label + ' is required'); $('qf_' + miss.k).focus(); return; }
      // An onSave that saves over the network returns a PROMISE. A promise is
      // never === false, so the old code closed the modal the instant it was
      // called — reporting success before the write had even happened, and
      // throwing away a `return false` meant to keep the form open on failure.
      // Await a thenable; synchronous callers behave exactly as before.
      let ok = cfg.onSave(v);
      if (ok && typeof ok.then === 'function') {
        const label = save.textContent;
        save.disabled = true; save.textContent = 'Saving…';       // and no double-submit in flight
        try { ok = await ok; }
        finally { save.disabled = false; save.textContent = label; }
      }
      if (ok !== false) closeModal();
    };
    if (cfg.onRender) cfg.onRender();
    $('qlModalBack').classList.add('open');
    const first = $('qlModal').querySelector('.qlf-input'); if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() { $('qlModalBack').classList.remove('open'); }
  /* ── Recoverable-deletion modal (replaces browser confirm/prompt) ──
     o: { title, desc, confirmLabel, reason (default true), needType, onConfirm(reason) }.
     Reuses the form modal: an optional reason field, plus a typed-confirmation
     for destructive actions (permanent delete / clear all). */
  function confirmDelete(o) {
    o = o || {};
    const specs = [];
    if (o.reason !== false) specs.push({ k: 'reason', label: o.reasonLabel || 'Reason (optional)', full: true, ph: o.reasonPh || 'e.g. duplicate · entered by mistake' });
    if (o.needType) specs.push({ k: '_confirm', label: 'Type ' + o.needType + ' to confirm', full: true, up: true, ph: o.needType });
    openForm({
      title: o.title || 'Move to Trash?',
      sub: o.desc || 'This record will move to Trash and can be restored from Settings → Data Management → Trash.',
      specs, saveLabel: o.confirmLabel || 'Move to Trash', initial: {},
      onSave(v) {
        if (o.needType && (v._confirm || '').trim().toUpperCase() !== o.needType.toUpperCase()) { toast('Please type ' + o.needType + ' to confirm'); return false; }
        try { o.onConfirm && o.onConfirm(v.reason || ''); } catch (e) { toast('Action failed'); }
        return true;
      }
    });
  }
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
    const GROUPS = window.QLD.purchaseGroups;
    const init = row || { date: today(), group: 'limestone', item: 'Limestone Purchase', grate: 5, itc: 'Eligible', unit: 'MT' };
    const curG = GROUPS.find(g => g.key === init.group) || GROUPS[0];
    const specs = [
      { k: 'bill', label: 'Bill No.', req: true, ph: 'e.g. 328' },
      { k: 'date', label: 'Date', type: 'date', req: true },
      { k: 'sup', label: 'Supplier', req: true, ph: 'Supplier name', upper: true, full: true },
      { k: 'gstin', label: 'GSTIN', upper: true },
      { k: 'group', label: 'Purchase Group', type: 'select', opts: GROUPS.map(g => [g.key, g.emoji + '  ' + g.label]) },
      { k: 'item', label: 'Purchase Item', type: 'select', opts: curG.items },
      { k: 'desc', label: 'Description', ph: 'optional' },
      { k: 'qty', label: 'Qty', type: 'number' },
      { k: 'unit', label: 'Unit', ph: 'MT' },
      { k: 'rate', label: 'Rate', type: 'number' },
      { k: 'taxable', label: 'Taxable (₹)', type: 'number', req: true, reqNonZero: true },
      { k: 'freightAmt', label: 'Freight / transport (₹)', type: 'number', ph: 'optional — you enter this directly' },
      { k: 'grate', label: 'GST rate', type: 'select', opts: GST_OPTS },
      { k: 'itc', label: 'ITC', type: 'select', opts: [['Eligible', 'ITC Eligible'], ['Ineligible', 'ITC Ineligible'], ['RCM', 'RCM']] },
      { k: 'veh', label: 'Vehicle No.', upper: true, ph: 'e.g. RJ19GE8199' }
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
    // Industry drives the ICP model: which markets actually earn you money, and
    // what a good new lead looks like. Options come from ICPCore so this list
    // can never drift from what the scorer understands.
    { k: 'industry', label: 'Industry', type: 'select',
      opts: () => [['', 'Not set — we\'ll guess from the name']].concat(
        (window.ICPCore ? ICPCore.INDUSTRIES : []).map(i => [i.key, i.label])),
      hint: 'What they use lime for. Confirming this turns a guess into a fact and sharpens every sales insight.' },
    { k: 'phone', label: 'Phone' },
    { k: 'state', label: 'State' },
    { k: 'opening', label: 'Opening balance (₹)', type: 'number', ph: '+ they owe you · − you owe them' },
    { k: 'creditLimit', label: 'Credit limit (₹)', type: 'number', ph: '0 = none' },
    { k: 'creditDays', label: 'Credit days', type: 'number', ph: 'e.g. 30', hint: 'Invoice date + credit days = the due date every reminder is scheduled from.' },
    { k: 'address', label: 'Address', type: 'textarea', full: true },
    { k: 'notes', label: 'Notes', type: 'textarea', full: true },
    // ── WhatsApp: reachability + consent. Reminders are opt-OUT (most parties
    // want the invoice), but "Auto reminders = No" is absolute — wa-core drops
    // that party from the plan entirely.
    { k: 'wa', label: 'WhatsApp number', ph: 'Leave blank to use the phone above', full: true,
      hint: 'Only used if it differs from Phone. Indian mobiles only — a landline can’t receive WhatsApp.' },
    { k: 'waAlt', label: 'Alternate WhatsApp number', ph: 'Optional' },
    { k: 'lang', label: 'Preferred language', type: 'select', opts: [['en', 'English'], ['hi', 'हिन्दी Hindi']] },
    { k: 'autoRemind', label: 'Auto payment reminders', type: 'select', opts: [['yes', 'Yes'], ['no', 'No — never message this party']] },
    { k: 'autoInvoice', label: 'Send invoice automatically', type: 'select', opts: [['yes', 'Yes'], ['no', 'No']] },
    { k: 'autoStatement', label: 'Send statement automatically', type: 'select', opts: [['yes', 'Yes'], ['no', 'No']] }
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
        else {
          window.QLD.upsertParty(v.name, v.gstin, v.phone, v.address, v.state, v.type);
          const p = window.QLD.state.PARTIES.find(x => (x.name || '').toUpperCase() === (v.name || '').toUpperCase());
          // upsertParty only takes the core identity fields, so everything the
          // form collects beyond them has to be copied on explicitly — a field
          // added to PARTY_SPECS but not listed here is silently dropped on a
          // NEW party (it would still save on an edit, which hides the bug).
          if (p) {
            p.opening = +v.opening || 0; p.creditLimit = +v.creditLimit || 0; p.creditDays = +v.creditDays || 0;
            if (v.notes) p.notes = v.notes;
            ['industry', 'wa', 'waAlt', 'lang', 'autoRemind', 'autoInvoice', 'autoStatement'].forEach(k => { if (v[k] !== undefined && v[k] !== '') p[k] = v[k]; });
            window.QLD.commit();
          }
        }
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
  function printInvoice(idx, forceWindow) {
    // on phones, open the in-app viewer (fit / zoom / PDF / print / WhatsApp)
    if (!forceWindow && isMobile() && window.QLMobile && QLMobile.showInvoice(idx)) return;
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
    const Q = window.QLD;
    // Recoverable delete: opens a modal (no browser confirm), soft-deletes to
    // Trash, records the reason. `title` = "Move invoice AC1315 to Trash?".
    const del = (what, fn, extra) => ({ label: 'Move to Trash', icon: RICO.del, danger: true, onClick() {
      confirmDelete({ title: 'Move ' + what + ' to Trash?', desc: (extra ? extra + ' — ' : '') + 'It will be removed from active records and kept for 90 days. Restore anytime from Settings → Data Management → Trash.',
        onConfirm(reason) { fn(reason); refresh('Moved to Trash'); } });
    } });
    if (type === 'sale') { const r = Q.state.SALES[idx]; const it = [{ label: 'Print invoice', icon: RICO.print, onClick: () => printInvoice(idx) }, { label: 'Edit invoice', icon: RICO.edit, onClick: () => openSaleForm(idx) }]; if ((r.status || 'pending') !== 'paid') it.push({ label: 'Mark paid', icon: RICO.pay, onClick: () => openPaymentForm('sale', idx) }); it.push(del('invoice ' + (r.inv || ''), reason => Q.deleteSale(idx, reason), (r.party || '') + (r.date ? ' · ' + r.date : ''))); return it; }
    if (type === 'purchase') { const r = Q.state.PURCHASES[idx]; const it = [{ label: 'Edit bill', icon: RICO.edit, onClick: () => openPurchaseForm(idx) }]; if ((r.status || 'pending') !== 'paid') it.push({ label: 'Mark paid', icon: RICO.pay, onClick: () => openPaymentForm('purchase', idx) }); it.push(del('bill ' + (r.bill || ''), reason => Q.deletePurchase(idx, reason), r.sup || r.name || '')); return it; }
    if (type === 'party') { const r = Q.state.PARTIES[idx]; return [{ label: 'Edit party', icon: RICO.edit, onClick: () => openPartyForm(idx) }, del('party ' + (r.name || ''), reason => Q.deleteParty(idx, reason))]; }
    if (type === 'worker') { const r = Q.state.WORKERS[idx]; return [{ label: 'Edit worker', icon: RICO.edit, onClick: () => openWorkerForm(idx) }, del('worker ' + (r.name || ''), reason => Q.deleteWorker(idx, reason))]; }
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
    const dr = $('qlDrawer');
    dr.dataset.mode = mode;
    dr.classList.toggle('ai', mode === 'ai');
    $('qlDrawerBack').classList.add('open');
    // The floating AI button would sit on top of the assistant's own input bar.
    document.body.classList.toggle('ql-ai-open', mode === 'ai');
    const head = dr.querySelector('.ql-drawer-head');
    let tools = document.getElementById('qlAiTools');
    if (mode === 'notif') {
      $('qlDrawerTitle').textContent = 'Notifications';
      if (tools) tools.remove();
      renderNotifications();
    } else {
      $('qlDrawerTitle').innerHTML = `<span class="ql-ai-hicon">${AI_MARK}</span>Business Assistant`;
      if (!tools) {
        tools = document.createElement('div');
        tools.id = 'qlAiTools'; tools.className = 'ql-ai-tools';
        tools.innerHTML = `<button class="ql-ai-ib" id="qlAiNew" title="New chat">${ICO.plus}</button>
          <button class="ql-ai-ib" id="qlAiHist" title="Conversation history">${ICO.hist}</button>
          <button class="ql-ai-ib" id="qlAiTheme" title="Light / dark">${ICO.theme}</button>`;
        head.insertBefore(tools, head.querySelector('.ql-drawer-x'));
      }
      renderAssistant();
      $('qlAiNew').onclick = () => convNew();
      $('qlAiHist').onclick = () => { if (!_histOpen) convTouch(); _histOpen = !_histOpen; _histQ = ''; renderAssistant(); };
      $('qlAiTheme').onclick = () => {
        const root = document.documentElement;
        const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        try { localStorage.setItem('ql_theme', next); } catch (_) {}
        toast(next === 'dark' ? 'Dark mode on' : 'Light mode on');
      };
    }
  }
  function closeDrawer() {
    convTouch();                                   // never lose the open thread
    $('qlDrawerBack').classList.remove('open');
    document.body.classList.remove('ql-ai-open');
  }
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

  /* ══════════ AI ASSISTANT — conversation store (localStorage) ══════════
     Conversations are per-company so switching firms never mixes threads. */
  const CONV_KEY = () => 'ql_ai_convs_' + ((window.QLD && QLD.activeCo) || 'x');
  let _convId = null, _histOpen = false, _histQ = '';
  function convAll() { try { return JSON.parse(localStorage.getItem(CONV_KEY()) || '[]'); } catch (_) { return []; } }
  function convSave(list) { try { localStorage.setItem(CONV_KEY(), JSON.stringify(list.slice(0, 60))); } catch (_) {} }
  function convTouch() {
    if (!_assistLog.filter(m => m.who === 'me').length) return;           // never save an empty thread
    const list = convAll(), first = _assistLog.find(m => m.who === 'me');
    const title = (first ? first.text || first.html : 'Conversation').replace(/<[^>]+>/g, '').slice(0, 48);
    let c = list.find(x => x.id === _convId);
    if (!c) { c = { id: _convId = 'c' + Date.now().toString(36), title, pinned: false, at: Date.now(), log: [] }; list.unshift(c); }
    c.log = _assistLog; c.at = Date.now(); if (!c.renamed) c.title = title;
    convSave(list.sort((a, b) => (b.pinned - a.pinned) || (b.at - a.at)));
  }
  function convOpen(id) { const c = convAll().find(x => x.id === id); if (!c) return; _convId = id; _assistLog = c.log || []; _histOpen = false; renderAssistant(); }
  function convNew() { convTouch(); _convId = null; _assistLog = []; _histOpen = false; renderAssistant(); const i = $('qlAiInput'); if (i) i.focus(); }
  function convDel(id) {
    const c = convAll().find(x => x.id === id);
    confirmDelete({
      title: 'Delete this conversation?', reason: false,
      desc: '“' + esc((c && c.title) || '') + '” will be removed from this device. Your business records are untouched.',
      confirmLabel: 'Delete',
      onConfirm() { convSave(convAll().filter(x => x.id !== id)); if (_convId === id) { _convId = null; _assistLog = []; } renderAssistant(); }
    });
  }
  function convPin(id) { const l = convAll(); const c = l.find(x => x.id === id); if (c) { c.pinned = !c.pinned; convSave(l.sort((a, b) => (b.pinned - a.pinned) || (b.at - a.at))); renderAssistant(); } }
  function convRename(id) {
    const l = convAll(), c = l.find(x => x.id === id); if (!c) return;
    openForm({
      title: 'Rename conversation', specs: [{ k: 'title', label: 'Name', req: true, full: true }], initial: { title: c.title }, saveLabel: 'Save',
      onSave(v) { c.title = (v.title || '').slice(0, 60); c.renamed = true; convSave(l); renderAssistant(); }
    });
  }

  /* Suggested prompts, grouped the way the business thinks about them. */
  const PROMPT_CATS = [
    ['📊', 'Sales', ["Today's sales", 'Compare monthly sales', 'Top customers this month']],
    ['💰', 'Finance', ['Net profit & margin', 'Pending supplier payments', 'Overdue above 90 days']],
    ['📦', 'Inventory', ['Stock summary', 'Low stock', 'Production report']],
    ['👥', 'CRM', ['Customer ledger', 'Supplier ledger', 'Predict next month']]
  ];
  function welcomeHTML() {
    const co = (window.QLD && QLD.co && QLD.co.short) || 'your business';
    const can = ['Sales reports', 'Profit analysis', 'Invoice lookup', 'Customer ledger', 'Supplier payments', 'Production reports', 'Inventory', 'Business forecasting'];
    const recent = aiRecent().slice(0, 3);
    return `<div class="ql-ai-welcome">
      <div class="ql-ai-wc">
        <div class="ql-ai-wc-ic">${AI_MARK}</div>
        <h3>Hello 👋</h3>
        <p>I'm your Business AI Copilot for <b>${esc(co)}</b>. I can help with:</p>
        <div class="ql-ai-wc-grid">${can.map(c => `<span>${esc(c)}</span>`).join('')}</div>
        <em>Ask me anything — every answer comes from your own live data.</em>
      </div>
      ${recent.length ? `<div class="ql-ai-cat"><div class="ql-ai-cat-h">🕘 Recent</div><div class="ql-ai-cat-b">${recent.map(c => `<button class="ql-ai-chip" data-ask="${esc(c)}">${esc(c.length > 30 ? c.slice(0, 28) + '…' : c)}</button>`).join('')}</div></div>` : ''}
      ${PROMPT_CATS.map(([em, name, items]) => `<div class="ql-ai-cat">
        <div class="ql-ai-cat-h">${em} ${name}</div>
        <div class="ql-ai-cat-b">${items.map(i => `<button class="ql-ai-chip" data-ask="${esc(i)}">${esc(i)}</button>`).join('')}</div>
      </div>`).join('')}
    </div>`;
  }
  const AI_MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.9 5.5L19.5 9l-5.6 1.5L12 16l-1.9-5.5L4.5 9l5.6-1.5z"/><circle cx="18" cy="18" r="1.4"/><circle cx="5" cy="17" r="1"/></svg>';
  const ICO = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    hist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
    theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.5-3V8a5.5 5.5 0 0 0-11 0v6z"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    dn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>'
  };
  function histHTML() {
    const q = _histQ.toLowerCase();
    const list = convAll().filter(c => !q || (c.title || '').toLowerCase().includes(q));
    return `<div class="ql-ai-hist">
      <input class="ql-ai-hsearch" id="qlAiHSearch" placeholder="Search conversations…" value="${esc(_histQ)}" autocomplete="off">
      ${list.length ? list.map(c => `<div class="ql-ai-hrow${c.id === _convId ? ' on' : ''}">
        <button class="ql-ai-hopen" data-open="${c.id}">
          <span class="ql-ai-ht">${c.pinned ? '📌 ' : ''}${esc(c.title || 'Conversation')}</span>
          <span class="ql-ai-hd">${new Date(c.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${(c.log || []).filter(m => m.who === 'me').length} question${(c.log || []).filter(m => m.who === 'me').length === 1 ? '' : 's'}</span>
        </button>
        <span class="ql-ai-hacts">
          <button class="ql-ai-ib" data-pin="${c.id}" title="${c.pinned ? 'Unpin' : 'Pin'}">${ICO.pin}</button>
          <button class="ql-ai-ib" data-ren="${c.id}" title="Rename">${ICO.pen}</button>
          <button class="ql-ai-ib danger" data-del="${c.id}" title="Delete">${ICO.trash}</button>
        </span>
      </div>`).join('') : `<div class="ql-ai-hempty">${_histQ ? 'No conversations match “' + esc(_histQ) + '”.' : 'No saved conversations yet. Ask something and it will appear here.'}</div>`}
    </div>`;
  }
  function msgHTML(m, i) {
    if (m.who === 'me') return `<div class="ql-ai-row me"><div class="ql-ai-msg me">${m.html}</div></div>`;
    return `<div class="ql-ai-row ai">
      <span class="ql-ai-av">${AI_MARK}</span>
      <div style="min-width:0;flex:1">
        <div class="ql-ai-msg ai">${m.html}</div>
        <div class="ql-ai-macts">
          <button class="ql-ai-ib" data-copy="${i}" title="Copy">${ICO.copy}</button>
          ${m.q ? `<button class="ql-ai-ib" data-regen="${esc(m.q)}" title="Regenerate">${ICO.redo}</button>` : ''}
          <button class="ql-ai-ib${m.vote === 1 ? ' on' : ''}" data-vote="${i}:1" title="Good answer">${ICO.up}</button>
          <button class="ql-ai-ib${m.vote === -1 ? ' on' : ''}" data-vote="${i}:-1" title="Not helpful">${ICO.down}</button>
        </div>
      </div>
    </div>`;
  }
  function paintLog() {
    const log = $('qlAiLog'); if (!log) return;
    log.innerHTML = _assistLog.length
      ? _assistLog.map((m, i) => msgHTML(m, i)).join('')
      : welcomeHTML();
    log.scrollTop = log.scrollHeight;
  }
  function renderAssistant() {
    const co = (window.QLD && QLD.co && QLD.co.short) || '';
    $('qlDrawerBody').innerHTML = `
      <div class="ql-ai-sub">Your AI Copilot for <b>${esc(co)}</b></div>
      ${_histOpen ? histHTML() : `<div class="ql-ai-log" id="qlAiLog"></div>
      <button class="ql-ai-tobottom" id="qlAiDown" title="Jump to latest" hidden>${ICO.dn}</button>`}
      <div class="ql-ai-input">
        <button class="ql-ai-mic" id="qlAiMic" title="Speak" aria-label="Voice input"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></button>
        <textarea id="qlAiInput" rows="1" placeholder="Ask anything about your business…" autocomplete="off" aria-label="Ask the assistant"></textarea>
        <button class="ql-ai-send" id="qlAiSend" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
      </div>`;
    if (!_histOpen) paintLog();
    wireAssistant();
    wireVoice();
  }
  function wireAssistant() {
    const body = $('qlDrawerBody'); if (!body) return;
    const inp = $('qlAiInput'), send = $('qlAiSend'), log = $('qlAiLog'), down = $('qlAiDown');
    const fire = () => { const v = (inp.value || '').trim(); if (!v) return; inp.value = ''; inp.style.height = 'auto'; assistAsk(v); };
    if (send) send.onclick = fire;
    if (inp) {
      inp.oninput = () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 120) + 'px'; };
      // Enter sends · Shift+Enter makes a new line (ChatGPT behaviour)
      inp.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fire(); } };
      setTimeout(() => inp.focus(), 60);
    }
    // scroll-to-bottom button appears only when scrolled away from the latest
    if (log && down) {
      const upd = () => { down.hidden = log.scrollHeight - log.scrollTop - log.clientHeight < 60; };
      log.onscroll = upd; upd();
      down.onclick = () => log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
    }
    body.querySelectorAll('[data-ask]').forEach(b => b.onclick = () => assistAsk(b.dataset.ask));
    body.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
      const m = _assistLog[+b.dataset.copy]; if (!m) return;
      const tmp = document.createElement('div'); tmp.innerHTML = m.html;
      const txt = (tmp.textContent || '').trim();
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Answer copied'), () => toast('Copy not available', 'err'));
    });
    body.querySelectorAll('[data-regen]').forEach(b => b.onclick = () => assistAsk(b.dataset.regen, true));
    body.querySelectorAll('[data-vote]').forEach(b => b.onclick = () => {
      const [i, v] = b.dataset.vote.split(':'); const m = _assistLog[+i]; if (!m) return;
      m.vote = m.vote === +v ? 0 : +v; convTouch(); paintLog(); wireAssistant();
      if (m.vote === -1) toast('Thanks — flagged as not helpful');
    });
    // history list
    const hs = $('qlAiHSearch');
    if (hs) hs.oninput = () => { _histQ = hs.value; const s = hs.selectionStart; renderAssistant(); const n = $('qlAiHSearch'); if (n) { n.focus(); try { n.setSelectionRange(s, s); } catch (_) {} } };
    body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => convOpen(b.dataset.open));
    body.querySelectorAll('[data-pin]').forEach(b => b.onclick = () => convPin(b.dataset.pin));
    body.querySelectorAll('[data-ren]').forEach(b => b.onclick = () => convRename(b.dataset.ren));
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => convDel(b.dataset.del));
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
  function assistAsk(q, regen) {
    q = (q || '').trim(); if (!q) return;
    if (_histOpen) { _histOpen = false; renderAssistant(); }
    aiPushRecent(q);
    // Regenerate replaces the previous answer instead of stacking a duplicate.
    if (regen && _assistLog.length && _assistLog[_assistLog.length - 1].who === 'ai') _assistLog.pop();
    else _assistLog.push({ who: 'me', html: esc(q), text: q });
    if (_assistLog.length > 60) _assistLog = _assistLog.slice(-60);
    paintLog(); wireAssistant();

    // Typing indicator, then reveal — answers are computed locally and return
    // instantly, so the short beat is what makes it read as a reply rather
    // than a flicker. It is NOT faked latency for its own sake.
    const log = $('qlAiLog');
    if (log) {
      const t = document.createElement('div');
      t.className = 'ql-ai-row ai'; t.id = 'qlAiTyping';
      t.innerHTML = `<span class="ql-ai-av">${AI_MARK}</span><div class="ql-ai-msg ai ql-ai-typing"><i></i><i></i><i></i></div>`;
      log.appendChild(t); log.scrollTop = log.scrollHeight;
    }
    setTimeout(() => {
      let ans; try { ans = assistAnswer(q); } catch (e) { ans = `<p>Sorry, I hit a snag answering that. Try rephrasing?</p>`; }
      _assistLog.push({ who: 'ai', html: ans, q });
      convTouch();
      paintLog(); wireAssistant();
    }, 260);
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
  /* ══════════ CSV export — ONE rule for every download ══════════
     Money in this app is computed (qty × rate, ± GST), so raw JS floats carry
     binary noise: 18.15 * 12385 === 224787.74999999997, not 224787.75. Writing
     String(value) into a file leaks that noise, and a spreadsheet then renders
     every digit ("244282.500000000000"). The UI never shows it because every
     screen formats through fC(). So exports must format too — csvCell is that
     single choke point, and every exporter MUST go through it.

     Numbers → rounded to 2 dp (paise) and emitted UNQUOTED so spreadsheets
     treat them as numbers, not text. Everything else (invoice/bill numbers,
     GSTIN, refs) is quoted and preserved byte-for-byte — never coerced. */
  function csvCell(c) {
    if (c == null) return '""';
    if (typeof c === 'number') {
      if (!isFinite(c)) return '""';                       // NaN/Infinity → blank, never "NaN"
      return String(Math.round(c * 100) / 100);            // unquoted → a real number in Excel
    }
    // A numeric STRING stays text (leading zeros / long IDs like a UTR survive).
    return '"' + String(c).replace(/"/g, '""') + '"';
  }
  const csvRow = cells => cells.map(csvCell).join(',');
  function downloadCSV(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    a.download = /\.csv$/i.test(name) ? name : name + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function exportCSV(name, headers, rows) {
    downloadCSV(name, [csvRow(headers), ...rows.map(csvRow)].join('\r\n'));
  }
  // Pages can register their own copilot intents (first match wins) — e.g.
  // reconcile.html answers "which payments are duplicates" from live recon state.
  const _assistIntents = [];
  function registerAssistIntent(fn) { if (typeof fn === 'function') _assistIntents.push(fn); }
  function assistAnswer(q) {
    const Q = window.QLD, t = q.toLowerCase(), fc = Q.fC, ym = new Date().toISOString().slice(0, 7), todayISO = new Date().toISOString().slice(0, 10);
    const party = findPartyInQuery(t);
    const list = (rows, cols) => `<table class="ql-ai-tbl"><tbody>${rows.map(r => '<tr>' + cols.map(c => `<td${c.r ? ' class="r"' : ''}>${c.v(r)}</td>`).join('') + '</tr>').join('')}</tbody></table>`;
    const acts = btns => `<div class="ql-ai-acts">${btns}</div>`;
    // Page-registered intents run FIRST (first match wins) — e.g. the Bank
    // Reconciliation page answers "which payments are duplicates" with live
    // recon state the shell knows nothing about.
    for (const h of _assistIntents) { try { const r = h(q, t, { list, acts, esc, fc }); if (r) return r; } catch (_) {} }
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
        return `<p><b>${esc(nm)}</b> ledger — ${all.length} invoices, ${fc(billed)} billed, <b>${fc(pendT)} outstanding</b>.</p>` + list(all.slice(0, 10), [{ v: r => '<b>' + esc(r.inv) + '</b>' }, { v: r => Q.fDS(r.date) }, { r: 1, v: r => fc(r.total) }, { r: 1, v: r => '<span class="ql-ai-pill ' + r.status + '">' + r.status + '</span>' }, { r: 1, v: r => '<button class="ql-ai-dl" onclick="QLShell.printInvoice(' + r.idx + ')" title="Download invoice ' + esc(r.inv) + '" aria-label="Download invoice">⬇</button>' }]);
      }
      // default party summary
      return `<p><b>${esc(nm)}</b> — ${all.length} invoice${all.length !== 1 ? 's' : ''}, ${fc(all.reduce((a, r) => a + r.total, 0))} billed, <b>${pend.length} pending</b> (${fc(pend.reduce((a, r) => a + r.total, 0))}).</p>` + (pend.length ? list(pend.slice(0, 6), [{ v: r => '<b>' + esc(r.inv) + '</b>' }, { v: r => Q.fDS(r.date) }, { r: 1, v: r => fc(r.total) }, { r: 1, v: r => '<button class="ql-ai-dl" onclick="QLShell.printInvoice(' + r.idx + ')" title="Download invoice ' + esc(r.inv) + '" aria-label="Download invoice">⬇</button>' }]) : '') + acts(waBtn(nm, pend.reduce((a, r) => a + r.total, 0), pend.length));
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
  /* ════════════════════════ Searchable combobox (type: 'searchselect') ══════════════════════════ */
  function _combo(k) { return { s: $('qf_' + k + '_s'), l: $('qf_' + k + '_l'), h: $('qf_' + k) }; }
  function _comboFilter(k) {
    const c = _combo(k); if (!c.l) return;
    const q = (c.s.value || '').toLowerCase().trim();
    c.l.classList.add('open'); c.s.setAttribute('aria-expanded', 'true');
    let any = false;
    c.l.querySelectorAll('.qlf-combo-opt').forEach(o => {
      const show = !q || (o.getAttribute('data-l') || o.textContent).toLowerCase().includes(q);
      o.style.display = show ? '' : 'none'; o.classList.remove('active'); if (show) any = true;
    });
    let empty = c.l.querySelector('.qlf-combo-empty');
    if (!any && !empty) { empty = document.createElement('div'); empty.className = 'qlf-combo-empty'; empty.textContent = 'No matches'; c.l.appendChild(empty); }
    if (empty) empty.style.display = any ? 'none' : '';
  }
  function _comboFocus(k) {
    const c = _combo(k); if (!c.l) return;
    if (c.s) c.s.select();                 // text is selected → about to be replaced, so show ALL options
    c.l.classList.add('open'); c.s && c.s.setAttribute('aria-expanded', 'true');
    c.l.querySelectorAll('.qlf-combo-opt').forEach(o => { o.style.display = ''; o.classList.remove('active'); });
    const empty = c.l.querySelector('.qlf-combo-empty'); if (empty) empty.style.display = 'none';
    const sel = c.l.querySelector('.qlf-combo-opt.sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  function _comboBlur(k) { const c = _combo(k); if (c.l) setTimeout(() => { c.l.classList.remove('open'); c.s && c.s.setAttribute('aria-expanded', 'false'); }, 150); }
  function _comboPick(e, k) {
    e.preventDefault();
    const el = e.currentTarget, c = _combo(k);
    c.h.value = el.getAttribute('data-v');
    c.s.value = el.getAttribute('data-l') || el.textContent;
    c.l.querySelectorAll('.qlf-combo-opt').forEach(o => o.classList.remove('sel')); el.classList.add('sel');
    c.l.classList.remove('open'); c.s.setAttribute('aria-expanded', 'false');
    c.h.dispatchEvent(new Event('change', { bubbles: true }));   // fire so onRender autofill (amount) runs
  }
  function _comboKey(e, k) {
    const c = _combo(k); if (!c.l) return;
    const vis = [].slice.call(c.l.querySelectorAll('.qlf-combo-opt')).filter(o => o.style.display !== 'none');
    let i = vis.findIndex(o => o.classList.contains('active'));
    if (e.key === 'ArrowDown') { e.preventDefault(); c.l.classList.add('open'); i = Math.min(i + 1, vis.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); i = Math.max(i - 1, 0); }
    else if (e.key === 'Enter') { if (i >= 0 && vis[i]) { e.preventDefault(); _comboPick({ preventDefault() {}, currentTarget: vis[i] }, k); } return; }
    else if (e.key === 'Escape') { c.l.classList.remove('open'); return; }
    else return;
    vis.forEach(o => o.classList.remove('active')); if (vis[i]) { vis[i].classList.add('active'); vis[i].scrollIntoView({ block: 'nearest' }); }
  }

  /* ════════════════════════ Launch splash ══════════════════════════ */
  // Fade out the branded splash once the shell + first page paint are done.
  // Kept on screen a minimum time so it reads as intentional, not a flash.
  function hideSplash() {
    const s = document.getElementById('ql-splash'); if (!s || s.classList.contains('qs-hide')) return;
    const go = () => requestAnimationFrame(() => {
      s.classList.add('qs-hide');
      setTimeout(() => { if (s && s.parentNode) s.parentNode.removeChild(s); const css = document.getElementById('ql-splash-css'); if (css) css.remove(); }, 600);
    });
    // ensure the page has actually painted content, and a graceful minimum dwell
    setTimeout(go, 450);
  }

  /* ════════════════════════ PWA (installable app) ══════════════════════════ */
  let _pwaDone = false, _deferredInstall = null;
  function initPWA() {
    if (_pwaDone) { refreshInstallItem(); return; }
    _pwaDone = true;
    // Register the service worker (scope /v2/) once.
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/v2/sw.js', { scope: '/v2/' }).catch(() => {});
      });
    }
    // Capture the install prompt so we can offer "Install app" in the profile menu.
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      _deferredInstall = e;
      refreshInstallItem();
    });
    window.addEventListener('appinstalled', () => {
      _deferredInstall = null;
      refreshInstallItem();
      try { toast('QuickLimes installed 🎉'); } catch (_) {}
    });
    refreshInstallItem();
  }
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }
  // Add / remove an "Install app" item at the top of the profile menu.
  function refreshInstallItem() {
    const menu = $('profileMenu'); if (!menu) return;
    let item = $('pmInstall');
    const want = !!_deferredInstall && !isStandalone();
    if (want && !item) {
      const sep = menu.querySelector('.profile-menu-head');
      item = document.createElement('button');
      item.className = 'profile-menu-item'; item.id = 'pmInstall';
      item.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg><span>Install app</span>';
      item.onclick = promptInstall;
      if (sep && sep.nextSibling) menu.insertBefore(item, sep.nextSibling); else menu.appendChild(item);
    } else if (!want && item) {
      item.remove();
    }
  }
  async function promptInstall() {
    if (!_deferredInstall) { try { toast('Use your browser menu → “Add to Home screen”.'); } catch (_) {} return; }
    const e = _deferredInstall; _deferredInstall = null;
    try { e.prompt(); await e.userChoice; } catch (_) {}
    refreshInstallItem();
  }

  /* ════════════════════════ PUBLIC API ══════════════════════════ */
  window.QLShell = {
    toggleSidebar, toggleMobileSidebar, toggleGroup, openPalette, closePalette, toast,
    openNotifications, openAssistant, closeDrawer, assistAsk, assistAnswer,
    notifOpen, notifWA, notifDone, notifSnooze, addRenewal, refreshNotifDot,
    registerAssistIntent, can, permMatrix: () => PERMS, currentRole,
    closePhotoModal() { $('photoBack').classList.remove('open'); },
    savePhoto() {}, removePhoto() {},
    paintWorkspace,
    setBreadcrumb(label) { const c = document.querySelector('.tb-crumb-active'); if (c) c.textContent = label; },
    setNotifDot(on) { const d = $('tbNotifDot'); if (d) d.style.display = on ? '' : 'none'; },
    // form modals + row action menus
    closeModal, openForm, confirmDelete, openSaleForm, openPurchaseForm, openPartyForm, openWorkerForm, openCashForm, openChunnaForm, openTdsForm, openPaymentForm,
    rowMenu, printInvoice, exportCSV, csvCell, csvRow, downloadCSV,
    _comboFilter, _comboFocus, _comboBlur, _comboPick, _comboKey,
    formPrompt(title, specs, onSave, sub) { openForm({ title, sub, specs, saveLabel: 'Save', initial: {}, onSave(v) { onSave(v); } }); },
    getInvoiceHTML(idx) { const d = window.QLD.invoiceData(idx); return d ? invoiceHTML(d) : ''; },
    renderInvoice(d) { return invoiceHTML(d); },

    // ── Feature Management (Settings) ──
    feat: featOn,
    features() { return FEATURES.map(x => ({ key: x.key, label: x.label, desc: x.desc, core: !!x.core, locked: !!x.locked, active: featOn(x.key) })); },
    // Roles & access
    openRolePicker, currentRole, setRole,
    roles() { return ROLES.map(r => ({ key: r.key, label: r.label, desc: r.desc, modules: r.feats === '*' ? FEATURES.map(f => f.key) : r.feats.slice() })); },
    applyRole(k) { setRole(k); this.refreshNav(); this.applyFeatureVisibility(); const el = $('pmRoleName'); if (el) el.textContent = roleDef().label; },
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
      // mobile app layer (no-op on desktop)
      try { if (window.QLMobile) QLMobile.init({ active: _active, title: opts.title }); } catch (_) {}
      // restore the chosen theme (assistant header toggles it)
      try { const t = localStorage.getItem('ql_theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (_) {}
      // installable PWA (service worker + install prompt)
      try { initPWA(); } catch (_) {}
      // Floating AI button — the Business Assistant is one tap away on EVERY
      // page (not just the dashboard). Hidden on the full AI page itself and
      // when the AI feature is switched off.
      try {
        if (_active !== 'ai' && featOn('ai') && !$('qlAiFab')) {
          const fab = document.createElement('button');
          fab.id = 'qlAiFab'; fab.className = 'ql-ai-fab'; fab.title = 'Ask AI about your business';
          fab.setAttribute('aria-label', 'Open the AI Business Assistant');
          fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.9 5.5L19.5 9l-5.6 1.5L12 16l-1.9-5.5L4.5 9l5.6-1.5z"/><circle cx="18" cy="18" r="1.4"/><circle cx="5" cy="17" r="1"/></svg><span>AI</span>';
          fab.onclick = () => openAssistant();
          document.body.appendChild(fab);
        }
      } catch (_) {}
      // fade out the launch splash now the app is on screen
      try { hideSplash(); } catch (_) {}
    },
    promptInstall, hideSplash,
    // expose nav + active for the mobile layer (bottom-nav "More" respects Feature Management)
    nav() { return NAV; },
    get _active() { return _active; }
  };
  let _active = 'dashboard';
})();

/* build: confirmDelete 1783845386 */

/* build: archive-perms 1783930681 */

/* build: refunds 1783950533 */

/* build m25: openForm section/html/quarter specs + wide modal */

/* build m26: Customers (Customer Intelligence) in the Sales sidebar group */

/* build m27: Banks nav item (multi-bank Phase 4) */

/* build m28: floating AI button on every page + invoice download in assistant answers */

/* build m29: Business Assistant — full AI workspace (history, welcome, categories, actions) */
