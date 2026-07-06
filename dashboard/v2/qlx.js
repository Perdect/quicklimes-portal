/* ═══════════════════════════════════════════════════════════════════════
   QLX — QuickLimes Workspace engine (config-driven, Monday-style)
   One engine powers EVERY module. A module is just a config object:
   columns, groups, views, stats, filters, quick-actions, a right-side
   detail panel (tabbed), bulk actions and per-row comments.
   Depends on: QLShell (shell/nav/topbar), QLD (data), qlx.css.
   Public: QLX.mount(config), QLX.refresh(), QLX.open(id), QLX.toast()
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  const Q = window.QLD;
  const esc = s => (s == null ? '' : s).toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fC = Q ? Q.fC : (n => '₹' + n);
  const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const AVG = ['#0891B2,#155E75', '#7C3AED,#5B21B6', '#16A34A,#15803D', '#F59E0B,#B45309', '#DB2777,#9D174D', '#2563EB,#1D4ED8', '#0d9488,#0f766e', '#ea580c,#c2410c'];
  const avColor = s => AVG[((s || '?').charCodeAt(0) + (s || '').length) % AVG.length];

  /* icon library (Feather-ish) */
  const IC = {
    table: '<line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><rect x="3" y="3" width="18" height="18" rx="2"/>',
    board: '<rect x="3" y="3" width="6" height="18" rx="1.5"/><rect x="10.5" y="3" width="6" height="12" rx="1.5"/><rect x="18" y="3" width="3" height="18" rx="1.5"/>',
    cards: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    an: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    group: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.5"/><circle cx="3.5" cy="12" r="1.5"/><circle cx="3.5" cy="18" r="1.5"/>',
    cols: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
    sort: '<path d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 18V4"/>',
    chev: '<polyline points="6 9 12 15 18 9"/>',
    left: '<polyline points="15 18 9 12 15 6"/>', right: '<polyline points="9 18 15 12 9 6"/>',
    check: '<polyline points="20 6 9 17 4 12"/>', x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    dots: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
    eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    wa: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    call: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1.05.4 2.05.8 3a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.95.4 1.95.67 3 .8A2 2 0 0 1 22 16.92z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>',
    ai: '<path d="M12 2l1.9 5.5L19.5 9l-5.6 1.5L12 16l-1.9-5.5L4.5 9l5.6-1.5z"/><circle cx="18" cy="18" r="1.5"/><circle cx="5" cy="17" r="1"/>',
    doc2: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
    comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'
  };

  /* ── engine state ── */
  let CFG = null, S = null, DP = null, BULK = null, TOAST = null, _tt = null;

  function freshState() {
    return {
      view: (CFG.views && CFG.views[0]) || 'table',
      quick: 'all', q: '', groupBy: (CFG.groupByDefault || (CFG.groupBy && CFG.groupBy[0] && CFG.groupBy[0].key) || 'none'),
      sort: Object.assign({}, CFG.sortDefault || { key: null, dir: 'desc' }),
      adv: {}, advOpen: false, page: 1,
      hidden: loadHidden(), collapsed: new Set(), sel: new Set(),
      calMonth: null, openId: null, dpTab: 0
    };
  }
  function loadHidden() {
    try { const s = JSON.parse(localStorage.getItem('qx_hidden_' + CFG.active) || 'null'); if (s) return new Set(s); } catch (_) {}
    return new Set((CFG.columns || []).filter(c => c.hidden).map(c => c.key));
  }
  function saveHidden() { try { localStorage.setItem('qx_hidden_' + CFG.active, JSON.stringify([...S.hidden])); } catch (_) {} }

  /* ══════════════════ MOUNT ══════════════════ */
  function mount(config) {
    CFG = config; S = freshState();
    QLShell.mount({ active: CFG.active, title: CFG.title });
    const main = document.getElementById('ql-main');
    const root = document.createElement('div');
    root.className = 'qx qx-a-' + 'blue';
    root.id = 'qxRoot';
    main.innerHTML = ''; main.appendChild(root);
    root.innerHTML = skeletonHTML();          // instant glass skeleton — never blank
    ensureChrome();
    // QLD.init() runs loadLocal() (which resolves the active company) and THEN
    // fires our callback, so the first real paint always has valid data. Register
    // it as the paint driver — do NOT render before this, or a not-yet-loaded
    // company would throw and skip this registration, leaving the page blank.
    if (Q && Q.init) {
      Q.init(() => refresh());
      window.__qlRefresh = () => refresh();
      window.__qlOnSwitchCompany = id => Q.switchCompany(id, () => refresh());
    } else { render(); }
    QLShell.paintWorkspace && QLShell.paintWorkspace();
  }

  function ensureChrome() {
    if (!document.getElementById('qxDpBack')) {
      DP = document.createElement('div'); DP.id = 'qxDpBack'; DP.className = 'qx-dp-back ' + 'qx-a-' + 'blue';
      DP.innerHTML = '<aside class="qx-dp" id="qxDp"></aside>';
      document.body.appendChild(DP);
      DP.addEventListener('click', e => { if (e.target.id === 'qxDpBack') closeDetail(); });
    } else { DP = document.getElementById('qxDpBack'); DP.className = 'qx-dp-back qx-a-' + 'blue'; }
    if (!document.getElementById('qxBulk')) {
      BULK = document.createElement('div'); BULK.id = 'qxBulk'; BULK.className = 'qx-bulk qx-a-' + 'blue';
      document.body.appendChild(BULK);
    } else { BULK = document.getElementById('qxBulk'); BULK.className = 'qx-bulk qx-a-' + 'blue'; }
    if (!document.getElementById('qxToast')) {
      TOAST = document.createElement('div'); TOAST.id = 'qxToast'; TOAST.className = 'qx-toast'; TOAST.hidden = true;
      document.body.appendChild(TOAST);
    } else TOAST = document.getElementById('qxToast');
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (DP.classList.contains('open')) closeDetail(); closeMenu(); } });
  }

  /* ══════════════════ DATA PIPELINE ══════════════════ */
  function allRows() { return (CFG.data ? CFG.data() : []) || []; }
  function rowId(r) { return CFG.rowId ? CFG.rowId(r) : (r.idx != null ? r.idx : r.id); }
  function rowById(id) { return allRows().find(r => String(rowId(r)) === String(id)); }

  function filtered() {
    let r = allRows();
    if (S.quick !== 'all' && CFG.quickFilters) { const qf = CFG.quickFilters.find(x => x.key === S.quick); if (qf && qf.test) r = r.filter(qf.test); }
    (CFG.filters || []).forEach(f => { const v = S.adv[f.key]; if (Array.isArray(v)) { if (v.length) r = r.filter(x => v.some(val => f.test(x, val))); } else if (v && v !== 'all') r = r.filter(x => f.test(x, v)); });
    if (S.adv._from) r = r.filter(x => (CFG.dateField ? CFG.dateField(x) : x.date || '') >= S.adv._from);
    if (S.adv._to) r = r.filter(x => (CFG.dateField ? CFG.dateField(x) : x.date || '') <= S.adv._to);
    if (S.q && CFG.search) { const q = S.q.toLowerCase(); r = r.filter(x => CFG.search(x, q)); }
    if (S.sort.key) {
      const k = S.sort.key, dir = S.sort.dir === 'asc' ? 1 : -1;
      r = r.slice().sort((a, b) => { let x = a[k], y = b[k]; if (x == null) x = ''; if (y == null) y = ''; if (typeof x === 'string') { x = x.toLowerCase(); y = (y || '').toString().toLowerCase(); } return x < y ? -dir : x > y ? dir : 0; });
    }
    return r;
  }
  function anyFilter() { return S.quick !== 'all' || S.q || Object.keys(S.adv).some(k => S.adv[k] && S.adv[k] !== 'all'); }

  /* ══════════════════ RENDER ══════════════════ */
  function render() {
    const root = document.getElementById('qxRoot'); if (!root) return;
    try {
      const rows = filtered();
      const banner = CFG.banner ? (CFG.banner(allRows()) || '') : '';
      const html = heroHTML() + statsHTML() + banner + `<div class="qx-panel">${toolbarHTML(rows)}<div id="qxView">${viewHTML(rows)}</div></div>`;
      root.innerHTML = html;         // atomic — if building `html` throws, prior content stays
      root.dataset.ready = '1';
      wire(rows);
      renderBulk();
    } catch (e) {
      console.warn('QLX render deferred (data not ready yet?):', e);
      if (root.dataset.ready !== '1') root.innerHTML = skeletonHTML();
    }
  }
  function skeletonHTML() {
    const sk = (w, h, r) => `<span class="qx-sk" style="display:inline-block;width:${w};height:${h}${r ? ';border-radius:' + r : ''}"></span>`;
    const stat = `<div class="qx-stat"><div class="qx-stat-top">${sk('30px', '30px', '9px')}${sk('80px', '12px')}</div><div style="margin:2px 0 8px">${sk('110px', '24px')}</div>${sk('70px', '11px')}</div>`;
    const row = `<div style="display:flex;gap:16px;align-items:center;padding:14px;border-bottom:1px solid var(--ql-divider)">${['30px', '110px', '150px', '80px', '80px', '90px'].map(w => sk(w, '14px')).join('')}</div>`;
    return `<div class="qx-hero"><div class="qx-hero-l">${sk('46px', '46px', '14px')}<div>${sk('200px', '24px')}<div style="margin-top:8px">${sk('260px', '12px')}</div></div></div></div>
      <div class="qx-stats">${Array.from({ length: 6 }).map(() => stat).join('')}</div>
      <div class="qx-panel"><div class="qx-tb">${sk('220px', '22px')}<div class="qx-tb-sp"></div>${sk('190px', '22px')}</div>${Array.from({ length: 6 }).map(() => row).join('')}</div>`;
  }
  function refresh() { render(); if (S.openId != null && rowById(S.openId)) renderDetailBody(); else if (S.openId != null) closeDetail(); }

  function heroHTML() {
    const tools = (CFG.tools || []).map((t, i) => `<button class="qx-btn" data-tool="${i}">${t.icon ? svg(t.icon) : ''}<span>${esc(t.label)}</span></button>`).join('');
    const prim = CFG.primary ? `<button class="qx-btn qx-btn-primary" id="qxPrimary">${svg(CFG.primary.icon || IC.plus)}<span>${esc(CFG.primary.label)}</span></button>` : '';
    return `<div class="qx-hero">
      <div class="qx-hero-l">
        <div class="qx-badge">${svg(CFG.icon || IC.table)}</div>
        <div class="qx-hero-tt"><div class="qx-title">${esc(CFG.title)}</div></div>
      </div>
      <div class="qx-hero-r">${tools}${prim}</div>
    </div>`;
  }

  function statsHTML() {
    if (!CFG.stats) return '';
    const cards = CFG.stats(allRows()) || [];
    return `<div class="qx-stats">${cards.map(c => `<div class="qx-stat qx-tint-${c.tint || 'blue'}">
      <div class="qx-stat-top"><span class="qx-stat-ic t-${c.tint || 'blue'}">${svg(c.icon || IC.file)}</span><span class="qx-stat-l">${esc(c.label)}</span></div>
      <div class="qx-stat-v">${c.value}</div>
      <div class="qx-stat-s">${c.sub || ''}${c.trend != null ? ` <span class="qx-tr ${c.trend >= 0 ? 'up' : 'dn'}">${c.trend >= 0 ? '↑' : '↓'} ${Math.abs(c.trend).toFixed(0)}%</span>` : ''}</div>
    </div>`).join('')}</div>`;
  }

  function toolbarHTML(rows) {
    const showTabs = CFG.quickFilters && CFG.quickFilters.length > 1;
    const qf = showTabs ? CFG.quickFilters.map(f => {
      const n = f.test ? allRows().filter(f.test).length : allRows().length;
      return `<button class="qx-tab ${S.quick === f.key ? 'active' : ''}" data-qf="${f.key}">${esc(f.label)}<span class="qx-tab-ct">${n}</span></button>`;
    }).join('') : '';
    const showViews = (CFG.views || []).length > 1;
    const views = showViews ? CFG.views.map(v => `<button class="qx-view ${S.view === v ? 'active' : ''}" data-view="${v}" title="${v[0].toUpperCase() + v.slice(1)} view">${svg(IC[v === 'analytics' ? 'an' : v] || IC.table)}</button>`).join('') : '';
    const gbActive = S.groupBy && S.groupBy !== 'none';
    const grpBtn = (CFG.groupBy && CFG.groupBy.length) ? `<button class="qx-tool ${gbActive ? 'on' : ''}" id="qxGroupBtn">${svg(IC.group)} Group</button>` : '';
    const colBtn = (CFG.columns && S.view === 'table') ? `<button class="qx-tool" id="qxColBtn">${svg(IC.cols)} Columns</button>` : '';
    const advActive = Object.keys(S.adv).some(k => S.adv[k] && S.adv[k] !== 'all');
    const filBtn = (CFG.filters && CFG.filters.length) || CFG.dateRange ? `<button class="qx-tool ${advActive ? 'on' : ''}" id="qxFilBtn">${svg(IC.filter)} Filters</button>` : '';
    const resetBtn = anyFilter() ? `<button class="qx-tool" id="qxReset">${svg(IC.x)} Reset</button>` : '';
    const search = CFG.search ? `<div class="qx-search">${svg(IC.search)}<input id="qxSearch" placeholder="Search ${esc(CFG.nounPl || 'records')}" value="${esc(S.q)}"></div>` : '';
    return `<div class="qx-tb">
      ${showTabs ? `<div class="qx-tabs">${qf}</div><div class="qx-tb-sp"></div>${search}` : `${search}<div class="qx-tb-sp"></div>`}
      ${grpBtn}${filBtn}${colBtn}${resetBtn}
      ${showViews ? `<div class="qx-views">${views}</div>` : ''}
    </div>`;
  }

  function advHTML() {
    if (!S.advOpen) return '';
    const sels = (CFG.filters || []).map(f => {
      const opts = [['all', f.allLabel || ('All ' + f.label.toLowerCase())]].concat(f.options ? f.options(allRows()) : []);
      return `<select class="qx-sel" data-fk="${f.key}">${opts.map(o => `<option value="${esc(o[0])}" ${String(S.adv[f.key] || 'all') === String(o[0]) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
    }).join('');
    const dr = CFG.dateRange ? `<input class="qx-date" type="date" id="qxFrom" value="${S.adv._from || ''}"><span class="qx-dash">–</span><input class="qx-date" type="date" id="qxTo" value="${S.adv._to || ''}">` : '';
    return `<div class="qx-adv">${sels}${dr}</div>`;
  }

  function viewHTML(rows) {
    switch (S.view) {
      case 'board': return boardHTML(rows);
      case 'cards': return cardsHTML(rows);
      case 'calendar': return calHTML(rows);
      case 'analytics': return analyticsHTML(rows);
      default: return tableHTML(rows);
    }
  }

  /* ── grouping helper ── */
  function grouper() { return (CFG.groupBy || []).find(g => g.key === S.groupBy); }
  function groupRows(rows) {
    const g = grouper(); if (!g || S.groupBy === 'none') return [{ key: '__all', rows }];
    const map = new Map();
    rows.forEach(r => { const k = g.of(r); if (!map.has(k)) map.set(k, []); map.get(k).push(r); });
    return [...map.entries()].map(([key, rs]) => ({ key, rows: rs, g }));
  }

  /* ══════════════════ TABLE VIEW ══════════════════ */
  const PER = 40;
  function visCols() { return (CFG.columns || []).filter(c => !S.hidden.has(c.key)); }
  function tableHTML(rows) {
    const cols = visCols(), hasSel = !!CFG.bulkActions;
    const head = '<tr>' + (hasSel ? `<th class="qx-ck"><span class="qx-cbx ${allSel(rows) ? 'on' : ''}" id="qxAll">${svg(IC.check)}</span></th>` : '') +
      cols.map(c => { const st = S.sort.key === c.key; return `<th class="${c.num ? 'num' : ''} ${c.sort ? 'sortable' : ''} ${st ? 'sorted' : ''}" ${c.sort ? `data-sort="${c.key}"` : ''}>${esc(c.label)}${c.sort ? `<span class="qx-sic">${st ? (S.sort.dir === 'asc' ? '↑' : '↓') : ''}</span>` : ''}</th>`; }).join('') + '</tr>';
    const groups = groupRows(rows);
    const span = cols.length + (hasSel ? 1 : 0);
    let body = '', sr = 0;
    if (!rows.length) body = `<tr><td colspan="${span}"><div class="qx-empty">No ${esc(CFG.nounPl || 'records')} in this view</div></td></tr>`;
    groups.forEach((grp, gi) => {
      const grouped = grp.key !== '__all';
      const collapsed = S.collapsed.has(grp.key);
      if (grouped) {
        const g = grp.g, tot = grp.rows.reduce((a, r) => a + (CFG.groupSum ? CFG.groupSum(r) : 0), 0);
        body += `<tr class="qx-grp ${collapsed ? 'collapsed' : ''}" data-grp="${esc(grp.key)}"><td colspan="${span}"><div class="qx-grp-bar ${gi === 0 ? 'first' : ''}">
          <span class="qx-grp-chev">${svg(IC.chev)}</span>
          ${g.dot ? `<span class="qx-grp-dot" style="background:${g.dot(grp.rows[0])}"></span>` : ''}
          <span class="qx-grp-name">${g.title ? g.title(grp.rows[0]) : esc(grp.key)}</span>
          <span class="qx-grp-ct">${grp.rows.length}</span>
          ${CFG.groupSum ? `<div class="qx-grp-sum"><span>Total <b>${fC(tot)}</b></span></div>` : ''}
        </div></td></tr>`;
      }
      if (!collapsed) grp.rows.forEach(r => {
        sr++; const id = rowId(r), sel = S.sel.has(String(id));
        body += `<tr class="qx-row ${sel ? 'sel' : ''}" data-id="${esc(id)}">` +
          (hasSel ? `<td class="qx-ck"><span class="qx-cbx ${sel ? 'on' : ''}" data-ck="${esc(id)}">${svg(IC.check)}</span></td>` : '') +
          cols.map(c => `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.cell ? c.cell(r, sr) : esc(r[c.key])}</td>`).join('') + '</tr>';
      });
    });
    const foot = CFG.footer ? footHTML(rows) : '';
    return `<div class="qx-grid-wrap"><table class="qx-grid"><thead>${head}</thead><tbody id="qxBody">${body}</tbody></table></div>${foot}`;
  }
  function footHTML(rows) {
    const cells = CFG.footer(rows) || [];
    return `<div class="qx-foot">${cells.map(c => `<div class="qx-foot-c ${c.strong ? 'strong' : ''}"><span>${esc(c.label)}</span><b>${c.value}</b></div>`).join('')}</div>`;
  }
  function allSel(rows) { return rows.length && rows.every(r => S.sel.has(String(rowId(r)))); }

  /* ══════════════════ BOARD / KANBAN ══════════════════ */
  function boardHTML(rows) {
    // columns = status options if defined, else groupBy
    let cols;
    if (CFG.status && CFG.status.options) cols = CFG.status.options.map(o => ({ key: o[0], label: o[1], color: (CFG.status.dot && CFG.status.dot(o[0])) || 'var(--qx)', of: r => CFG.status.of(r) === o[0] }));
    else { const g = grouper() || (CFG.groupBy || [])[0]; if (!g) return cardsHTML(rows); const keys = [...new Set(rows.map(g.of))]; cols = keys.map(k => ({ key: k, label: k, color: 'var(--qx)', of: r => g.of(r) === k })); }
    return `<div class="qx-board">${cols.map(col => {
      const cr = rows.filter(col.of), sum = cr.reduce((a, r) => a + (CFG.groupSum ? CFG.groupSum(r) : 0), 0);
      return `<div class="qx-col"><div class="qx-col-h"><span class="qx-col-dot" style="background:${col.color}"></span><span class="qx-col-n">${esc(col.label)}</span><span class="qx-col-ct">${cr.length}</span>${CFG.groupSum ? `<span class="qx-col-sum">${fC(sum)}</span>` : ''}</div>
        <div class="qx-col-body">${cr.map(kcardHTML).join('') || '<div class="qx-empty" style="padding:16px">—</div>'}</div></div>`;
    }).join('')}</div>`;
  }
  function kcardHTML(r) {
    const c = CFG.card ? CFG.card(r) : { id: rowId(r), title: '', amount: '' };
    const id = rowId(r);
    return `<div class="qx-kcard" data-id="${esc(id)}">
      <div class="qx-kcard-top"><span class="qx-kcard-ttl">${c.title || esc(c.id)}</span>${c.amount ? `<span class="qx-kcard-amt">${c.amount}</span>` : ''}</div>
      ${c.party ? `<div class="qx-kcard-meta"><span class="qx-av" style="background:linear-gradient(135deg,${avColor(c.party)})">${esc((c.party || '?').charAt(0).toUpperCase())}</span>${esc(c.party)}</div>` : ''}
      ${(c.chips && c.chips.length) ? `<div class="qx-kcard-foot">${c.chips.join('')}</div>` : ''}
    </div>`;
  }

  /* ══════════════════ CARDS / GALLERY ══════════════════ */
  function cardsHTML(rows) {
    if (!rows.length) return `<div class="qx-empty" style="padding:44px">No ${esc(CFG.nounPl || 'records')}</div>`;
    return `<div class="qx-cards">${rows.map(r => {
      const c = CFG.card ? CFG.card(r) : { id: rowId(r) }; const id = rowId(r);
      return `<div class="qx-card" data-id="${esc(id)}">
        <div class="qx-card-top"><span class="qx-card-id">${c.title || esc(c.id)}</span>${c.status || ''}</div>
        ${c.party ? `<div class="qx-card-party"><span class="qx-av" style="background:linear-gradient(135deg,${avColor(c.party)})">${esc((c.party || '?').charAt(0).toUpperCase())}</span><div><div class="qx-card-nm">${esc(c.party)}</div>${c.partySub ? `<div class="qx-card-nm-s">${esc(c.partySub)}</div>` : ''}</div></div>` : ''}
        ${(c.rows && c.rows.length) ? `<div class="qx-card-rows">${c.rows.map(x => `<div class="qx-card-r"><span>${esc(x[0])}</span><b>${x[1]}</b></div>`).join('')}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  /* ══════════════════ CALENDAR ══════════════════ */
  function calHTML(rows) {
    const df = CFG.dateField || (r => r.date);
    const base = S.calMonth ? new Date(S.calMonth + '-01') : (() => { const d = firstDate(rows, df); return d || new Date(2026, 6, 1); })();
    const y = base.getFullYear(), m = base.getMonth();
    S.calMonth = y + '-' + String(m + 1).padStart(2, '0');
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    const byDay = {};
    rows.forEach(r => { const d = df(r); if (d && d.slice(0, 7) === S.calMonth) { const dn = +d.slice(8, 10); (byDay[dn] = byDay[dn] || []).push(r); } });
    const monthName = base.toLocaleString('en-US', { month: 'long' }) + ' ' + y;
    let cells = '';
    for (let i = 0; i < first; i++) cells += '<div class="qx-cal-cell blank"></div>';
    for (let d = 1; d <= days; d++) {
      const evs = byDay[d] || [];
      const shown = evs.slice(0, 3).map(r => { const c = CFG.card ? CFG.card(r) : {}; return `<div class="qx-cal-ev" data-id="${esc(rowId(r))}">${esc(c.calLabel || c.party || c.title || rowId(r))}</div>`; }).join('');
      cells += `<div class="qx-cal-cell"><div class="qx-cal-dn">${d}</div>${shown}${evs.length > 3 ? `<div class="qx-cal-more">+${evs.length - 3} more</div>` : ''}</div>`;
    }
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="qx-cal-dow">${d}</div>`).join('');
    return `<div class="qx-cal"><div class="qx-cal-h"><button class="qx-cal-nav" id="qxCalPrev">${svg(IC.left)}</button><b>${monthName}</b><button class="qx-cal-nav" id="qxCalNext">${svg(IC.right)}</button></div><div class="qx-cal-grid">${DOW}${cells}</div></div>`;
  }
  function firstDate(rows, df) { const ds = rows.map(df).filter(Boolean).sort(); return ds.length ? new Date(ds[ds.length - 1] + 'T00:00') : null; }

  /* ══════════════════ ANALYTICS ══════════════════ */
  function analyticsHTML(rows) {
    if (!CFG.analytics) return `<div class="qx-empty" style="padding:44px">Analytics not configured for this module.</div>`;
    const a = CFG.analytics(rows) || {};
    const maxBar = Math.max(1, ...(a.bars || []).map(b => b.value));
    const bars = (a.bars || []).map(b => `<div class="qx-bar-row"><span class="qx-bar-lbl">${b.icon || ''}${esc(b.label)}</span><div class="qx-bar-track"><div class="qx-bar-fill" style="width:${Math.round(b.value / maxBar * 100)}%${b.color ? ';background:' + b.color : ''}"></div></div><span class="qx-bar-val">${b.display || fC(b.value)}</span></div>`).join('');
    const donutTot = (a.donut || []).reduce((s, d) => s + d.value, 0) || 1;
    let acc = 0; const segs = (a.donut || []).map(d => { const pct = d.value / donutTot * 100, from = acc; acc += pct; return `${d.color} ${from}% ${acc}%`; }).join(', ');
    const legend = (a.donut || []).map(d => `<div class="qx-legend-i"><span class="qx-legend-dot" style="background:${d.color}"></span>${esc(d.label)}<b>${d.display || fC(d.value)}</b></div>`).join('');
    return `<div class="qx-an">
      <div class="qx-an-card"><div class="qx-an-h">${esc(a.barsTitle || 'Breakdown')}</div><div class="qx-bars">${bars || '<div class="qx-empty">No data</div>'}</div></div>
      <div class="qx-an-card"><div class="qx-an-h">${esc(a.donutTitle || 'Distribution')}</div><div class="qx-donut-wrap"><div style="width:132px;height:132px;border-radius:99px;background:conic-gradient(${segs || '#e2e8f0 0 100%'})"><div style="width:82px;height:82px;border-radius:99px;background:#fff;position:relative;top:25px;left:25px;display:grid;place-items:center;font-weight:800;font-size:13px">${a.donutCenter || ''}</div></div><div class="qx-legend">${legend}</div></div></div>
      ${a.extra ? `<div class="qx-an-card full">${a.extra}</div>` : ''}
    </div>`;
  }

  /* ══════════════════ WIRING ══════════════════ */
  function wire(rows) {
    const $ = s => document.getElementById(s), root = document.getElementById('qxRoot');
    if ($('qxPrimary') && CFG.primary) $('qxPrimary').onclick = () => CFG.primary.onClick();
    root.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => CFG.tools[+b.dataset.tool].onClick());
    root.querySelectorAll('[data-qf]').forEach(b => b.onclick = () => { S.quick = b.dataset.qf; S.page = 1; render(); });
    root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { S.view = b.dataset.view; render(); });
    if ($('qxSearch')) { const inp = $('qxSearch'); inp.oninput = () => { S.q = inp.value; S.page = 1; renderViewOnly(); }; }
    if ($('qxFilBtn')) $('qxFilBtn').onclick = e => openFilterMenu(e.currentTarget);
    if ($('qxReset')) $('qxReset').onclick = () => { S.quick = 'all'; S.q = ''; S.adv = {}; S.page = 1; render(); };
    if ($('qxGroupBtn')) $('qxGroupBtn').onclick = e => openGroupMenu(e.currentTarget);
    if ($('qxColBtn')) $('qxColBtn').onclick = e => openColMenu(e.currentTarget);
    root.querySelectorAll('[data-fk]').forEach(sel => sel.onchange = () => { S.adv[sel.dataset.fk] = sel.value; S.page = 1; render(); });
    if ($('qxFrom')) $('qxFrom').onchange = e => { S.adv._from = e.target.value; render(); };
    if ($('qxTo')) $('qxTo').onchange = e => { S.adv._to = e.target.value; render(); };
    // sorting
    root.querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => { const k = th.dataset.sort; if (S.sort.key === k) S.sort.dir = S.sort.dir === 'asc' ? 'desc' : 'asc'; else { S.sort.key = k; S.sort.dir = 'asc'; } render(); });
    // group collapse
    root.querySelectorAll('.qx-grp-bar').forEach(bar => bar.onclick = () => { const key = bar.closest('.qx-grp').dataset.grp; S.collapsed.has(key) ? S.collapsed.delete(key) : S.collapsed.add(key); render(); });
    // selection
    if ($('qxAll')) $('qxAll').onclick = () => { const all = allSel(rows); rows.forEach(r => { const id = String(rowId(r)); all ? S.sel.delete(id) : S.sel.add(id); }); render(); };
    root.querySelectorAll('[data-ck]').forEach(cb => cb.onclick = e => { e.stopPropagation(); const id = cb.dataset.ck; S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); render(); });
    // row / card / kanban / cal open
    root.querySelectorAll('.qx-row, .qx-kcard, .qx-card, .qx-cal-ev').forEach(el => el.addEventListener('click', e => {
      if (e.target.closest('button,select,input,a,.qx-cbx,[data-act]')) return;
      openDetail(el.dataset.id);
    }));
    // inline status pill
    root.querySelectorAll('[data-st]').forEach(sel => sel.onchange = e => { e.stopPropagation(); if (CFG.status && CFG.status.set) { CFG.status.set(rowById(sel.dataset.st), sel.value); refresh(); toast('Status updated'); } });
    // per-row quick actions
    root.querySelectorAll('[data-act]').forEach(b => b.onclick = e => { e.stopPropagation(); const [id, i] = b.dataset.act.split('|'); const acts = CFG.rowActions(rowById(id)); acts[+i] && acts[+i].onClick(rowById(id)); });
    root.querySelectorAll('[data-more]').forEach(b => b.onclick = e => { e.stopPropagation(); openRowMenu(rowById(b.dataset.more), b); });
    // calendar nav
    if ($('qxCalPrev')) $('qxCalPrev').onclick = () => { S.calMonth = shiftMonth(S.calMonth, -1); renderViewOnly(); };
    if ($('qxCalNext')) $('qxCalNext').onclick = () => { S.calMonth = shiftMonth(S.calMonth, 1); renderViewOnly(); };
  }
  function renderViewOnly() { const v = document.getElementById('qxView'); if (v) { v.innerHTML = viewHTML(filtered()); wire(filtered()); } }
  function shiftMonth(ym, d) { const [y, m] = ym.split('-').map(Number); const dt = new Date(y, m - 1 + d, 1); return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'); }

  /* row quick-action cell (used by configs via QLX.actions) */
  function actionsCell(r) {
    const acts = CFG.rowActions ? CFG.rowActions(r) : [];
    const id = rowId(r);
    const inline = acts.map((a, i) => `<button class="qx-ib ${a.cls || ''}" data-tt="${esc(a.tt)}" data-act="${esc(id)}|${i}">${svg(a.icon)}</button>`).join('');
    const more = CFG.rowMenu ? `<button class="qx-ib" data-tt="More" data-more="${esc(id)}">${svg(IC.dots)}</button>` : '';
    return `<div class="qx-acts">${inline}${more}</div>`;
  }

  /* ══════════════════ MENUS ══════════════════ */
  let _menu = null;
  function closeMenu() { if (_menu) { _menu.remove(); _menu = null; } }
  document.addEventListener('click', e => { if (_menu && !e.target.closest('.qx-menu') && !e.target.closest('#qxGroupBtn,#qxColBtn,#qxFilBtn')) closeMenu(); });
  function placeMenu(m, anchor) { document.body.appendChild(m); const r = anchor.getBoundingClientRect(); m.style.top = (r.bottom + 6) + 'px'; m.style.left = Math.min(r.left, window.innerWidth - m.offsetWidth - 12) + 'px'; _menu = m; }
  function openGroupMenu(anchor) {
    closeMenu(); const m = document.createElement('div'); m.className = 'qx-menu';
    const opts = [{ key: 'none', label: 'No grouping' }].concat(CFG.groupBy);
    m.innerHTML = `<div class="qx-menu-h">Group by</div>` + opts.map(o => `<button class="qx-menu-i ${S.groupBy === o.key ? 'on' : ''}" data-gb="${o.key}">${o.label}<span class="qx-menu-chk">${svg(IC.check)}</span></button>`).join('');
    m.querySelectorAll('[data-gb]').forEach(b => b.onclick = () => { S.groupBy = b.dataset.gb; S.collapsed.clear(); closeMenu(); render(); });
    placeMenu(m, anchor);
  }
  function anyAdv() { return Object.keys(S.adv).some(k => { const v = S.adv[k]; return Array.isArray(v) ? v.length : (v && v !== 'all'); }); }
  function selOf(key) { const v = S.adv[key]; return Array.isArray(v) ? v.map(String) : (v && v !== 'all' ? [String(v)] : []); }
  function openFilterMenu(anchor) {
    closeMenu(); const m = document.createElement('div'); m.className = 'qx-menu qx-filter-menu';
    let inner = '';
    (CFG.filters || []).forEach(f => {
      const opts = f.options ? f.options(allRows()) : [], sel = selOf(f.key);
      inner += `<div class="qx-fm-h">${esc(f.label)}</div>`;
      if (opts.length && opts.length <= 12) {   // small set → multi-select checkboxes
        inner += opts.map(o => { const on = sel.indexOf(String(o[0])) >= 0; return `<button class="qx-menu-i qx-fm-chk ${on ? 'on' : ''}" data-fk="${esc(f.key)}" data-val="${esc(o[0])}"><span class="qx-cbx ${on ? 'on' : ''}">${svg(IC.check)}</span>${esc(o[1])}</button>`; }).join('');
      } else {                                   // large set → single select
        inner += `<div class="qx-fm-f"><select class="qx-sel" data-single="${esc(f.key)}"><option value="all">All ${esc(f.label.toLowerCase())}</option>${opts.map(o => `<option value="${esc(o[0])}" ${String(S.adv[f.key]) === String(o[0]) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>`;
      }
    });
    if (CFG.dateRange) inner += `<div class="qx-fm-h">Date range</div><div class="qx-fm-f"><div class="qx-fm-row"><input class="qx-date" type="date" id="qxFmFrom" value="${S.adv._from || ''}"><span class="qx-dash">–</span><input class="qx-date" type="date" id="qxFmTo" value="${S.adv._to || ''}"></div></div>`;
    inner += `<div class="qx-menu-div"></div><button class="qx-menu-i" id="qxFmReset">${svg(IC.x)} Clear all filters</button>`;
    m.innerHTML = inner;
    const apply = () => { const b = document.getElementById('qxFilBtn'); if (b) b.classList.toggle('on', anyAdv()); renderViewOnly(); };
    m.querySelectorAll('.qx-fm-chk').forEach(btn => btn.onclick = () => {
      const k = btn.dataset.fk, val = btn.dataset.val, arr = selOf(k).slice(), i = arr.indexOf(val);
      if (i >= 0) arr.splice(i, 1); else arr.push(val);
      if (arr.length) S.adv[k] = arr; else delete S.adv[k];
      btn.classList.toggle('on'); btn.querySelector('.qx-cbx').classList.toggle('on');
      S.page = 1; apply();
    });
    m.querySelectorAll('[data-single]').forEach(sel => sel.onchange = () => { if (sel.value === 'all') delete S.adv[sel.dataset.single]; else S.adv[sel.dataset.single] = sel.value; S.page = 1; apply(); });
    const from = m.querySelector('#qxFmFrom'), to = m.querySelector('#qxFmTo');
    if (from) from.onchange = () => { S.adv._from = from.value; S.page = 1; apply(); };
    if (to) to.onchange = () => { S.adv._to = to.value; S.page = 1; apply(); };
    m.querySelector('#qxFmReset').onclick = () => { S.adv = {}; S.page = 1; closeMenu(); render(); };
    placeMenu(m, anchor);
  }
  function openColMenu(anchor) {
    closeMenu(); const m = document.createElement('div'); m.className = 'qx-menu';
    m.innerHTML = `<div class="qx-menu-h">Columns</div>` + CFG.columns.filter(c => c.label).map(c => `<button class="qx-menu-i ${!S.hidden.has(c.key) ? 'on' : ''}" data-col="${c.key}">${esc(c.label)}<span class="qx-menu-chk">${svg(IC.check)}</span></button>`).join('');
    m.querySelectorAll('[data-col]').forEach(b => b.onclick = () => { const k = b.dataset.col; S.hidden.has(k) ? S.hidden.delete(k) : S.hidden.add(k); saveHidden(); b.classList.toggle('on'); renderViewOnly(); });
    placeMenu(m, anchor);
  }
  function openRowMenu(r, anchor) {
    closeMenu(); const items = CFG.rowMenu(r) || []; const m = document.createElement('div'); m.className = 'qx-menu';
    m.innerHTML = items.map(it => it.divider ? '<div class="qx-menu-div"></div>' : `<button class="qx-menu-i ${it.cls || ''}">${svg(it.icon)} ${esc(it.label)}</button>`).join('');
    let bi = 0; m.querySelectorAll('.qx-menu-i').forEach(btn => { const it = items.filter(x => !x.divider)[bi++]; btn.onclick = () => { closeMenu(); it.onClick(r); }; });
    placeMenu(m, anchor);
  }

  /* ══════════════════ DETAIL PANEL ══════════════════ */
  function openDetail(id) { S.openId = id; S.dpTab = 0; renderDetailBody(); DP.classList.add('open'); }
  function closeDetail() { DP.classList.remove('open'); S.openId = null; }
  function renderDetailBody() {
    const r = rowById(S.openId); if (!r || !CFG.detail) return;
    const d = CFG.detail(r);
    let tabs = (d.tabs || []).slice();
    if (CFG.comments !== false) tabs.push(commentsTab(r));
    if (S.dpTab >= tabs.length) S.dpTab = 0;
    const dp = document.getElementById('qxDp');
    const actions = (d.actions || []).map((a, i) => `<button class="qx-btn ${a.primary ? 'qx-btn-primary' : ''} qx-btn-sm" data-dpa="${i}">${a.icon ? svg(a.icon) : ''}${esc(a.label)}</button>`).join('');
    dp.innerHTML = `<div class="qx-dp-head">
        <div class="qx-dp-top"><div>
          <div class="qx-dp-eyebrow"><span class="qx-badge">${svg(CFG.icon || IC.file)}</span>${esc(d.eyebrow || CFG.title)}</div>
          <div class="qx-dp-t">${d.title || ''}</div><div class="qx-dp-s">${d.sub || ''}</div>
        </div><button class="qx-dp-x" id="qxDpX">${svg(IC.x)}</button></div>
        <div class="qx-dp-actions">${actions}</div>
      </div>
      <div class="qx-dp-tabs">${tabs.map((t, i) => `<button class="qx-dp-tab ${i === S.dpTab ? 'active' : ''}" data-dpt="${i}">${t.icon ? svg(t.icon) : ''}${esc(t.label)}${t.count != null ? `<span class="qx-dp-tab-ct">${t.count}</span>` : ''}</button>`).join('')}</div>
      <div class="qx-dp-body" id="qxDpBody"></div>`;
    document.getElementById('qxDpX').onclick = closeDetail;
    dp.querySelectorAll('[data-dpa]').forEach(b => b.onclick = () => (d.actions[+b.dataset.dpa].onClick(r)));
    dp.querySelectorAll('[data-dpt]').forEach(b => b.onclick = () => { S.dpTab = +b.dataset.dpt; renderDetailBody(); });
    const body = document.getElementById('qxDpBody');
    const tab = tabs[S.dpTab];
    body.innerHTML = typeof tab.render === 'function' ? tab.render(r) : (tab.html || '');
    if (tab.onMount) tab.onMount(body, r);
  }

  /* built-in Comments tab (localStorage per module+row) */
  function cmKey(id) { return 'qx_cm_' + CFG.active + '_' + id; }
  function getComments(id) { try { return JSON.parse(localStorage.getItem(cmKey(id)) || '[]'); } catch (_) { return []; } }
  function addComment(id, text) { const list = getComments(id); list.push({ who: (Q && Q.co && Q.co.short) || 'You', txt: text, at: new Date().toISOString() }); localStorage.setItem(cmKey(id), JSON.stringify(list)); }
  function commentsTab(r) {
    const id = rowId(r), list = getComments(id);
    return {
      label: 'Comments', icon: IC.comment, count: list.length || null,
      render() {
        const items = list.length ? list.map(c => `<div class="qx-cm"><span class="qx-cm-av">${esc((c.who || '?').charAt(0).toUpperCase())}</span><div class="qx-cm-body"><div class="qx-cm-top"><span class="qx-cm-who">${esc(c.who)}</span><span class="qx-cm-when">${fmtWhen(c.at)}</span></div><div class="qx-cm-txt">${esc(c.txt)}</div></div></div>`).join('') : '<div class="qx-empty">No comments yet. Start the thread — add a note, tag a teammate, log a call.</div>';
        return items + `<div class="qx-cm-box"><textarea id="qxCmIn" placeholder="Write a comment…  @mention, notes, follow-ups"></textarea><button class="qx-btn qx-btn-primary" id="qxCmAdd">${svg(IC.plus)}</button></div>`;
      },
      onMount(body) {
        const inp = body.querySelector('#qxCmIn'), btn = body.querySelector('#qxCmAdd');
        const submit = () => { const v = inp.value.trim(); if (!v) return; addComment(id, v); renderDetailBody(); };
        btn.onclick = submit;
        inp.onkeydown = e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(); };
      }
    };
  }
  function fmtWhen(iso) { try { const d = new Date(iso); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; } }

  /* ══════════════════ BULK BAR ══════════════════ */
  function renderBulk() {
    if (!CFG.bulkActions || !S.sel.size) { BULK.classList.remove('on'); return; }
    BULK.classList.add('on');
    const acts = CFG.bulkActions.map((a, i) => `<button class="qx-bulk-btn ${a.cls || ''}" data-ba="${i}">${a.icon ? svg(a.icon) : ''}${esc(a.label)}</button>`).join('');
    BULK.innerHTML = `<span class="qx-bulk-ct"><b>${S.sel.size}</b> selected</span>${acts}<button class="qx-bulk-x" id="qxBulkX">${svg(IC.x)}</button>`;
    BULK.querySelector('#qxBulkX').onclick = () => { S.sel.clear(); render(); };
    BULK.querySelectorAll('[data-ba]').forEach(b => b.onclick = () => { const chosen = allRows().filter(r => S.sel.has(String(rowId(r)))); CFG.bulkActions[+b.dataset.ba].onClick(chosen); });
  }

  /* ══════════════════ TOAST ══════════════════ */
  function toast(m, tone) { TOAST.textContent = m; TOAST.className = 'qx-toast ' + (tone || ''); TOAST.hidden = false; clearTimeout(_tt); _tt = setTimeout(() => { TOAST.hidden = true; }, 2600); }

  /* ══════════════════ BILL / DOC VIEWER ══════════════════
     Opens an uploaded file (image/PDF) or a generated bill (HTML) in a
     right-side drawer with Download / Print / Close. */
  function viewDoc(opts) {
    opts = opts || {};
    let back = document.getElementById('qxDocBack');
    if (!back) {
      back = document.createElement('div'); back.id = 'qxDocBack'; back.className = 'qx-dp-back qx-a-blue';
      back.innerHTML = '<aside class="qx-dp" id="qxDoc"></aside>';
      document.body.appendChild(back);
      back.addEventListener('click', e => { if (e.target.id === 'qxDocBack') close(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    }
    function close() { back.classList.remove('open'); }
    let body;
    if (opts.fileUrl) {
      body = /image\//.test(opts.fileType || '') || /\.(png|jpe?g|gif|webp)$/i.test(opts.fileName || '')
        ? `<img src="${opts.fileUrl}" alt="bill" style="max-width:100%;border-radius:10px;border:1px solid var(--ql-border)">`
        : `<iframe src="${opts.fileUrl}" class="qx-inv-frame" style="height:76vh" title="bill"></iframe>`;
    } else body = `<iframe class="qx-inv-frame" style="height:76vh" srcdoc="${esc(opts.html || '')}" title="bill"></iframe>`;
    const dl = opts.fileUrl ? `<a class="qx-btn qx-btn-sm" href="${opts.fileUrl}" download="${esc(opts.fileName || 'bill')}">${svg(IC.dl)} Download</a>` : '';
    const pr = opts.onPrint ? `<button class="qx-btn qx-btn-sm" id="qxDocPr">${svg(IC.print)} Print</button>` : '';
    const dp = document.getElementById('qxDoc');
    dp.innerHTML = `<div class="qx-dp-head"><div class="qx-dp-top"><div><div class="qx-dp-eyebrow">${svg(IC.file)} ${esc(opts.eyebrow || 'Bill')}</div><div class="qx-dp-t">${esc(opts.title || '')}</div><div class="qx-dp-s">${esc(opts.sub || '')}</div></div><button class="qx-dp-x" id="qxDocX">${svg(IC.x)}</button></div><div class="qx-dp-actions">${dl}${pr}</div></div><div class="qx-dp-body">${body}</div>`;
    document.getElementById('qxDocX').onclick = close;
    if (opts.onPrint) document.getElementById('qxDocPr').onclick = () => opts.onPrint();
    back.classList.add('open');
  }

  /* ══════════════════ PUBLIC API ══════════════════ */
  window.QLX = {
    mount, refresh, toast, viewDoc,
    open: openDetail, close: closeDetail,
    actionsCell, icons: IC, svg, esc, avColor,
    // helpers configs can use to build cells
    statusPill(val, label, cls) { return `<select class="qx-st ${cls || 's-' + val}" data-st="__ID__">${label}</select>`; },
    getComments, addComment,
    config: () => CFG, state: () => S
  };
})();
