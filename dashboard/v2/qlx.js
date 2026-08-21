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
  const esc = s => (s == null ? '' : s).toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    ban: '<circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/>',
    dots: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
    eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    wa: '<path d="M3 21l1.65 -3.8a9 9 0 1 1 3.4 2.9l-5.05 .9"/><path d="M9 10a.5 .5 0 0 0 1 0v-1a.5 .5 0 0 0 -1 0v1a5 5 0 0 0 5 5h1a.5 .5 0 0 0 0 -1h-1a.5 .5 0 0 0 0 1"/>',
    call: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1.05.4 2.05.8 3a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.95.4 1.95.67 3 .8A2 2 0 0 1 22 16.92z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>',
    ai: '<path d="M12 2l1.9 5.5L19.5 9l-5.6 1.5L12 16l-1.9-5.5L4.5 9l5.6-1.5z"/><circle cx="18" cy="18" r="1.5"/><circle cx="5" cy="17" r="1"/>',
    doc2: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
    comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'
  };

  /* ── engine state ── */
  let CFG = null, S = null, DP = null, BULK = null, TOAST = null, _tt = null;

  const qxMobile = () => window.matchMedia('(max-width: 768px)').matches;
  function freshState() {
    return {
      // phones are card-first: a squeezed data-grid is never shown when the
      // module defines a card() renderer
      view: (qxMobile() && CFG.card) ? 'cards' : ((CFG.views && CFG.views[0]) || 'table'),
      quick: 'all', q: '', groupBy: (CFG.groupByDefault || (CFG.groupBy && CFG.groupBy[0] && CFG.groupBy[0].key) || 'none'),
      sort: Object.assign({}, CFG.sortDefault || { key: null, dir: 'desc' }),
      adv: {}, advOpen: false, page: 1,
      hidden: loadHidden(), collapsed: new Set(), sel: new Set(),
      calMonth: null, openId: null, dpTab: 0,
      month: null, monthInit: false   // global Month filter (opt-in via CFG.monthFilter)
    };
  }
  /* The namespace for anything this register persists. Defaults to CFG.active,
     which is what every existing page has always used — so nothing moves. A
     multi-tab workspace passes its own stateKey per tab, otherwise seven tabs
     sharing one `active` would share one set of hidden columns and one comment
     thread, and hiding a column on Sales would hide it on Bank. */
  function stateKey() { return CFG.stateKey || CFG.active; }
  function loadHidden() {
    try { const s = JSON.parse(localStorage.getItem('qx_hidden_' + stateKey()) || 'null'); if (s) return new Set(s); } catch (_) {}
    return new Set((CFG.columns || []).filter(c => c.hidden).map(c => c.key));
  }
  function saveHidden() { try { localStorage.setItem('qx_hidden_' + stateKey(), JSON.stringify([...S.hidden])); } catch (_) {} }

  /* ══════════════════ MOUNT ══════════════════ */
  function mount(config) {
    CFG = config; S = freshState();
    _mounted = true;
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
      window.__qlOnSwitchCompany = () => { S.monthInit = false; S._saved = false; S.month = null; refresh(); };   // shell already switched; re-read the new company's saved month
    } else { render(); }
    QLShell.paintWorkspace && QLShell.paintWorkspace();
  }

  /* ── REMOUNT — swap the register in place, on a page already mounted ───
     For a tabbed workspace. mount() cannot be called twice: it re-enters
     QLShell.mount(), which on its second call finds #ql-page already removed,
     so `content` is '' and a WHOLE SECOND SHELL is prepended to document.body
     — duplicate sidebar, duplicate #ql-main, and getElementById then resolves
     to the new one while the old page sits stranded below it.

     So remount does the three things mount does that are still needed — new
     config, fresh state, re-render — and none of the three that must not
     happen twice: the shell, the QLD.init paint-driver registration, and the
     keydown listeners inside ensureChrome().

     Per-tab state stays isolated because freshState() re-reads hidden columns
     through stateKey(). Sharing one QLX instance is not a compromise here: it
     is the only shape the engine supports, since CFG and S are module-level
     singletons (there is exactly one of each, by design). */
  let _mounted = false;
  function remount(config) {
    if (!_mounted || !document.getElementById('qxRoot')) return mount(config);
    CFG = config; S = freshState();
    const root = document.getElementById('qxRoot');
    root.innerHTML = skeletonHTML();
    refresh();
    return true;
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
  // The Month filter (opt-in via CFG.monthFilter + CFG.monthOf) narrows EVERY
  // downstream consumer at once — stats, AI insights, table, export, report —
  // because they all read allRows(). Default = the latest month that has data.
  function monthOf(r) { return ((CFG.monthOf ? CFG.monthOf(r) : r.date) || '').slice(0, 7); }
  function latestMonth(rows) { const ms = rows.map(monthOf).filter(Boolean).sort(); return ms.length ? ms[ms.length - 1] : 'all'; }
  /* S.month holds a PERIOD, not just a month: the shared picker offers "Whole
     year 2026" (cfg.years) alongside the grid, so the value can be 'YYYY'. A
     `monthOf(r) === S.month` equality test — what this was — matches nothing at
     all for a year, i.e. the year button would EMPTY the table instead of
     widening it. QLD.inPeriod is the one prefix rule.

     No `QLD ? … : monthOf(r) === S.month` fallback, deliberately: data.js loads
     before qlx.js on every register, so the fallback could only ever run in a
     world where allRows() has already thrown — while quietly reintroducing the
     exact broken comparison this line exists to delete. A dead wrong branch is
     still a wrong branch, and it is the copy nobody greps for. */
  const rowInPeriod = r => QLD.inPeriod(monthOf(r), S.month);
  function allRows() {
    let rows = (CFG.data ? CFG.data() : []) || [];
    if (!CFG.monthFilter) return rows;
    // Always default to the LATEST month that has data. Re-snap when a newer
    // month appears (e.g. after importing bills) or when the selected month has
    // become empty — but never override a deliberate pick of an EXISTING month.
    const dl = latestMonth(rows);
    if (rows.length) {
      if (!S.monthInit) {
        // First mount: a saved pick (survives navigation/refresh) wins even if
        // that month is empty; otherwise default to the latest month with data.
        const saved = (window.QLD && QLD.uiMonth) ? QLD.uiMonth() : null;
        S.month = saved || dl; S.monthInit = true; S._saved = !!saved;
      } else if (!S._saved && dl !== 'all' && dl > (S._dl || '') && dl !== S.month) {
        S.month = dl;                                                        // no explicit pick yet → follow newly-imported later data
      }
      S._dl = dl;
    }
    if (S.month && S.month !== 'all') rows = rows.filter(rowInPeriod);
    return rows;
  }
  function rawRows() { return (CFG.data ? CFG.data() : []) || []; }   // pre-month, for the picker
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
    return `<div class="qx-hero"><div class="qx-hero-l"><div>${sk('200px', '24px')}</div></div></div>
      <div class="qx-stats">${Array.from({ length: 6 }).map(() => stat).join('')}</div>
      <div class="qx-panel"><div class="qx-tb">${sk('220px', '22px')}<div class="qx-tb-sp"></div>${sk('190px', '22px')}</div>${Array.from({ length: 6 }).map(() => row).join('')}</div>`;
  }
  function refresh() { render(); if (S.openId != null && rowById(S.openId)) renderDetailBody(); else if (S.openId != null) closeDetail(); }

  /* ── PAGE CHROME, USABLE WITHOUT MOUNTING ────────────────────────────────
     heroMarkup and statsMarkup are pure: config in, HTML out, no CFG, no S.
     They are exported as QLX.heroHTML / QLX.statsHTML so a page that is NOT a
     register — Inventory is cards, not rows — can wear the app's header and
     stat row without pretending to be a table. Before this, the only way to
     look like the rest of the app was to mount the whole table engine or to
     hand-copy the markup, and the copy is what makes pages drift apart. */
  function heroMarkup(cfg) {
    cfg = cfg || {};
    /* actionsId lets a migrating page keep the id its own code already targets
       — QLShell.periodFilter('gsActions', …) prepends the month button INTO
       that container. Without it, moving a page onto this header would silently
       delete its period picker: the markup would look right and the control
       would be gone. */
    // label may be a function so a tool can show a live count ("Reminders (7)").
    // esc() would otherwise stringify the function body into the button.
    const tlabel = t => esc(typeof t.label === 'function' ? t.label() : t.label);
    const tools = (cfg.tools || []).map((t, i) => `<button class="qx-btn" data-tool="${i}">${t.icon ? icon(t.icon) : ''}<span>${tlabel(t)}</span></button>`).join('');
    const prim = cfg.primary ? `<button class="qx-btn qx-btn-primary" id="qxPrimary">${icon(cfg.primary.icon || IC.plus)}<span>${esc(cfg.primary.label)}</span></button>` : '';
    /* The page header holds only the title and PAGE actions (add/upload/export/
       AI). The month/date filter changes TABLE state, so it lives in the table
       toolbar now, not here — see toolbarHTML. "The table controls the table."
       Moving it in QLX moves it for every register at once. */
    return `<div class="qx-hero">
      <div class="qx-hero-l">
        <div class="qx-hero-tt"><div class="qx-title">${esc(cfg.title)}</div>${cfg.sub ? `<div class="qx-hero-sub">${cfg.sub}</div>` : ''}</div>
      </div>
      <div class="qx-hero-r"${cfg.actionsId ? ` id="${cfg.actionsId}"` : ''}>${tools}${prim}</div>
    </div>`;
  }
  function heroHTML() { return heroMarkup(CFG); }
  /* "March 2026" / "Year 2026" / "All months" — QLD.periodLabel owns all three.
     QLD.monthLabel alone cannot: it validates a MONTH and returns blank for a
     bare 'YYYY', so the year pick would have shown an empty button. */
  function monthLabel() {
    return (window.QLD && QLD.periodLabel) ? QLD.periodLabel(S.month, CFG.allLabel) : (S.month || 'All months');
  }
  function emptyMsg() {
    if (CFG.monthFilter && S.month && S.month !== 'all') return `No ${esc(CFG.emptyLabel || CFG.noun || 'record')} data found for ${esc(monthLabel())}`;
    return `No ${esc(CFG.nounPl || 'records')} in this view`;
  }
  // Rich empty state: icon + message + primary "Add" call-to-action (wired to
  // the same action as the toolbar's + button). Used wherever a list is empty.
  function emptyBlock(pad) {
    const ic = CFG.emptyIcon || IC.inbox;
    const add = CFG.primary ? `<button class="qx-btn qx-btn-primary" id="qxEmptyAdd" style="margin-top:14px">${svg(CFG.primary.icon || IC.plus)}<span>${esc(CFG.primary.label)}</span></button>` : '';
    /* These carried var(--qx-text,#0f172a) / var(--qx-hover,#f1f5f9) /
       var(--qx-muted,#94a3b8) — three --qx-* names that have never been
       defined, so the hardcoded LIGHT fallback was always the real value.
       "No bills in this view" rendered #0F172A on a #020617 page: contrast
       1.13, i.e. invisible. An inline style in a template literal is the one
       place no stylesheet can reach and no [data-theme] rule can override,
       which is why it outlived every dark rule in the app.
       Each is now the real token whose LIGHT value is byte-identical to the
       fallback it replaces (ql-text #0F172A, neutral-100 #F1F5F9,
       text-muted = neutral-400 #94A3B8), so light does not move. */
    const sub = CFG.emptySub ? `<div style="font-size:12.5px;color:var(--ql-text-muted);max-width:360px;margin-top:2px">${esc(CFG.emptySub)}</div>` : '';
    return `<div class="qx-empty" style="padding:${pad || 48}px 20px;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center">
      <div style="width:56px;height:56px;border-radius:16px;display:grid;place-items:center;background:var(--ql-neutral-100);color:var(--ql-text-muted);margin-bottom:8px"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ic}</svg></div>
      <div style="font-weight:600;color:var(--ql-text)">${esc(emptyMsg())}</div>${sub}${add}</div>`;
  }
  function setMonth(ym) {
    if (S.month === ym) return;
    S.month = ym; S.monthInit = true; S._saved = true; S.page = 1; S.sel = new Set();
    if (window.QLD && QLD.setUiMonth) QLD.setUiMonth(ym);   // persist the deliberate pick (survives navigation/refresh)
    const root = document.getElementById('qxRoot');
    if (root) { root.innerHTML = skeletonHTML(); root.dataset.ready = ''; }   // loading skeleton on change
    setTimeout(() => refresh(), 230);
  }
  /* The picker itself is QLShell.monthPicker — the app's ONE calendar. This used
     to be a hand-rolled clone of it (and dashboard.js, reconcile.js and
     inventory.html each had their own). All that belongs here is the wiring:
     which months have data, and what to do with the pick. */
  function openMonthMenu(anchor) {
    closeMenu();
    QLShell.monthPicker(anchor, {
      month: S.month,
      have: new Set(rawRows().map(monthOf).filter(Boolean)),
      /* "how can I filter month or year give option calendar fo all" — the year
         button, on every QLX register, not just Inventory. It is one option on
         the shared picker; opting out (CFG.years: false) is for a page whose
         data cannot honestly answer a year, not a default. */
      years: CFG.years !== false, allLabel: CFG.allLabel,
      onPick: setMonth
    });
  }

  /* An icon may be PATH BODY (the registers' convention) or a whole <svg>…</svg>
     (what every legacy page's KPI strip already holds). Accepting both is what
     lets those pages move onto this component by passing the icon strings they
     already have, instead of having their icon sets rewritten — a rewrite is
     where working code gets broken for a visual change. */
  /* Legacy KPI strips carry a CSS-variable background ("var(--ql-success-50)")
     where this component wants an accent name. Mapping it here means a page can
     migrate by passing the colour it already has, and every page maps the same
     way — the alternative was each page inventing its own tint table. */
  function tintOf(bg) {
    const m = /--ql-(\w+?)-\d+/.exec(String(bg || ''));
    const k = m ? m[1] : '';
    return ({ brand: 'blue', success: 'green', danger: 'red', warning: 'amber',
              violet: 'violet', indigo: 'indigo', teal: 'teal', lime: 'green' })[k] || 'blue';
  }
  function icon(x) {
    const v = x || IC.file;
    return /^\s*<svg[\s>]/i.test(v) ? v : svg(v);
  }
  function statsMarkup(cards) {
    cards = cards || [];
    if (!cards.length) return '';
    return `<div class="qx-stats">${cards.map(c => `<div class="qx-stat qx-tint-${c.tint || 'blue'}">
      <div class="qx-stat-top"><span class="qx-stat-ic t-${c.tint || 'blue'}">${icon(c.icon)}</span><span class="qx-stat-l">${esc(c.label)}</span></div>
      <div class="qx-stat-v">${c.value}</div>
      <div class="qx-stat-s">${c.sub || ''}${c.trend != null ? ` <span class="qx-tr ${c.trend >= 0 ? 'up' : 'dn'}">${c.trend >= 0 ? '↑' : '↓'} ${Math.abs(c.trend).toFixed(0)}%</span>` : ''}</div>
    </div>`).join('')}</div>`;
  }
  function statsHTML() {
    if (!CFG.stats) return '';
    return statsMarkup(CFG.stats(allRows()) || []);
  }
  /* Wires a hero built by heroMarkup on a page that never mounted QLX. */
  function wireHero(el, cfg) {
    if (!el || !cfg) return;
    (cfg.tools || []).forEach((t, i) => {
      const b = el.querySelector(`[data-tool="${i}"]`);
      if (b && t.onClick) b.onclick = t.onClick;
    });
    const p = el.querySelector('#qxPrimary');
    if (p && cfg.primary && cfg.primary.onClick) p.onclick = cfg.primary.onClick;
  }

  function toolbarHTML(rows) {
    const showTabs = CFG.quickFilters && CFG.quickFilters.length > 1;
    /* Hide EMPTY status tabs (count 0) — an "Partial 0 · Cash 0" that can never
       be clicked to anything is noise. Always keep the first tab ("All") and
       whichever tab is currently active, so the current filter never vanishes. */
    const qf = showTabs ? CFG.quickFilters.map((f, i) => {
      const n = f.test ? allRows().filter(f.test).length : allRows().length;
      if (n === 0 && i !== 0 && S.quick !== f.key) return '';
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
    /* The month/date filter is the FIRST element of the toolbar (moved out of the
       page header). The toolbar is sticky, so it stays visible while scrolling —
       the accountant never loses the period they're looking at. Same QLShell
       control the dashboard/recon use; only its home changed. */
    const month = CFG.monthFilter ? QLShell.monthButton({ id: 'qxMonthBtn', label: monthLabel() }) : '';
    return `<div class="qx-tb">
      ${month}
      ${showTabs ? `<div class="qx-tabs">${qf}</div>` : ''}
      <div class="qx-tb-sp"></div>
      ${search}${grpBtn}${filBtn}${colBtn}${resetBtn}
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

  /* Mobile: advanced filters as a native bottom sheet (Material/Party/Status/… + date range). */
  function openMobileFilters() {
    const fields = (CFG.filters || []).map(f => {
      const opts = [['all', f.allLabel || ('All ' + f.label.toLowerCase())]].concat(f.options ? f.options(allRows()) : []);
      return `<div class="qlm-field"><label>${esc(f.label)}</label><select data-fk="${f.key}">${opts.map(o => `<option value="${esc(o[0])}" ${String(S.adv[f.key] || 'all') === String(o[0]) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>`;
    }).join('');
    const dr = CFG.dateRange ? `<div class="qlm-field"><label>From date</label><input type="date" data-dk="_from" value="${S.adv._from || ''}"></div><div class="qlm-field"><label>To date</label><input type="date" data-dk="_to" value="${S.adv._to || ''}"></div>` : '';
    window.QLMobile.sheet({
      title: 'Filters',
      bodyHTML: `<div style="padding-top:4px">${fields}${dr}</div>`,
      footHTML: '<button class="ql-btn ql-btn-secondary" data-clear>Clear all</button><button class="ql-btn ql-btn-primary" data-apply>Show results</button>',
      onMount(body, close) {
        body.querySelectorAll('select[data-fk]').forEach(sel => sel.onchange = () => { S.adv[sel.dataset.fk] = sel.value; S.page = 1; render(); });
        body.querySelectorAll('input[data-dk]').forEach(inp => inp.onchange = () => { S.adv[inp.dataset.dk] = inp.value; render(); });
        const foot = document.getElementById('qlmSheetFoot');
        foot.querySelector('[data-clear]').onclick = () => { S.adv = {}; S.page = 1; render(); close(); };
        foot.querySelector('[data-apply]').onclick = close;
      }
    });
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
  /* ── PAGINATION ───────────────────────────────────────────────────────
     S.page has been declared and reset in a dozen handlers since forever
     and READ in none, and `.qx-pager`/`.qx-pg` have been styled in qlx.css
     (with a dark override and a mobile flex-wrap rule) with no JS consumer.
     The socket existed; this fills it, so all fifteen registers gain it at
     once rather than Group Overview growing a private one.

     TWO RULES THAT MATTER MORE THAN THE SLICING:
     · FOOTER TOTALS USE THE WHOLE FILTERED SET, never the visible page. A
       "Grand Total" that changes when you turn the page is worse than no
       total at all — it looks authoritative and is wrong.
     · GROUPED VIEWS ARE NOT PAGINATED. groupRows() builds section headers
       with per-group counts and sums; slicing underneath them would print
       "42" over three visible rows. A grouped register shows everything,
       exactly as it does today. */
  const PER_DEFAULT = 25;
  function perPage() { const n = +CFG.perPage || PER_DEFAULT; return n > 0 ? n : PER_DEFAULT; }
  /* 'none' is the OFF value for grouping and it is a truthy string — so
     `CFG.groupBy && S.groupBy` was true even with grouping switched off, and
     pagination silently never engaged on any register that merely DEFINES
     group options. Test the active grouping, not the presence of the config. */
  function grouped() { return !!(CFG.groupBy && S.groupBy && S.groupBy !== 'none'); }
  function paged() { return !!CFG.paginate && !grouped(); }
  function pageOf(rows) {
    if (!paged()) return { rows: rows, page: 1, pages: 1, from: rows.length ? 1 : 0, to: rows.length, total: rows.length };
    const per = perPage(), total = rows.length, pages = Math.max(1, Math.ceil(total / per));
    const page = Math.min(Math.max(1, S.page || 1), pages);
    if (page !== S.page) S.page = page;                       // clamp a stale page after filtering
    const from = (page - 1) * per;
    return { rows: rows.slice(from, from + per), page: page, pages: pages,
             from: total ? from + 1 : 0, to: Math.min(from + per, total), total: total };
  }
  /* The markup contract qlx.css already expects. */
  function pagerHTML(p) {
    if (!paged() || p.total <= perPage()) return '';
    const btn = (dir, label, off) => `<button data-pg="${dir}" ${off ? 'disabled' : ''} aria-label="${label}">${label === 'Previous' ? '‹' : '›'}</button>`;
    return `<div class="qx-pager">
      <span>Showing ${p.from}–${p.to} of ${p.total}</span>
      <div class="qx-pg">${btn('prev', 'Previous', p.page <= 1)}<span>${p.page} / ${p.pages}</span>${btn('next', 'Next', p.page >= p.pages)}</div>
    </div>`;
  }
  function visCols() { return (CFG.columns || []).filter(c => !S.hidden.has(c.key)); }
  function tableHTML(allRows) {
    const pg = pageOf(allRows);
    const rows = pg.rows;
    const cols = visCols(), hasSel = !!CFG.bulkActions;
    const head = '<tr>' + (hasSel ? `<th class="qx-ck"><span class="qx-cbx ${allSel(rows) ? 'on' : ''}" id="qxAll">${svg(IC.check)}</span></th>` : '') +
      cols.map(c => { const st = S.sort.key === c.key; return `<th class="${c.num ? 'num' : ''} ${c.sort ? 'sortable' : ''} ${st ? 'sorted' : ''}" ${c.sort ? `data-sort="${c.key}"` : ''}>${esc(c.label)}${c.sort ? `<span class="qx-sic">${st ? (S.sort.dir === 'asc' ? '↑' : '↓') : ''}</span>` : ''}</th>`; }).join('') + '</tr>';
    const groups = groupRows(rows);
    const span = cols.length + (hasSel ? 1 : 0);
    let body = '', sr = 0;
    if (!rows.length) body = `<tr><td colspan="${span}">${emptyBlock()}</td></tr>`;
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
    /* allRows, NOT rows: the footer is the total for everything the current
       filters select, not for the twenty-five lines you happen to be looking
       at. A Grand Total that changes when you turn the page is worse than no
       total — it reads as authoritative and is wrong. */
    const foot = CFG.footer ? footHTML(allRows) : '';
    return `<div class="qx-grid-wrap"><table class="qx-grid"><thead>${head}</thead><tbody id="qxBody">${body}</tbody></table></div>${foot}${pagerHTML(pg)}`;
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
    if (!rows.length) return emptyBlock();
    // phones: native list rows (avatar · name · vehicle · date · amount · status · ›)
    if (qxMobile() && window.QLMobile && QLMobile.listRow) {
      return `<div class="qx-cards">${rows.map(r => QLMobile.listRow(CFG.card ? CFG.card(r) : { id: rowId(r) }, { id: rowId(r) })).join('')}</div>`;
    }
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
    const monthName = (window.QLD && QLD.monthLabel) ? QLD.monthLabel(y + '-' + String(base.getMonth() + 1).padStart(2, '0'), { blank: String(y) }) : (base.toLocaleString('en-IN', { month: 'long' }) + ' ' + y);
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
    if ($('qxEmptyAdd') && CFG.primary) $('qxEmptyAdd').onclick = () => CFG.primary.onClick();
    root.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => CFG.tools[+b.dataset.tool].onClick());
    if ($('qxMonthBtn')) $('qxMonthBtn').onclick = e => openMonthMenu(e.currentTarget);
    root.querySelectorAll('[data-qf]').forEach(b => b.onclick = () => { S.quick = b.dataset.qf; S.page = 1; render(); });
    root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { S.view = b.dataset.view; render(); });
    if ($('qxSearch')) { const inp = $('qxSearch'); inp.oninput = () => { S.q = inp.value; S.page = 1; renderViewOnly(); }; }
    if ($('qxFilBtn')) $('qxFilBtn').onclick = e => (qxMobile() && window.QLMobile) ? openMobileFilters() : openFilterMenu(e.currentTarget);
    if ($('qxReset')) $('qxReset').onclick = () => { S.quick = 'all'; S.q = ''; S.adv = {}; S.page = 1; render(); };
    if ($('qxGroupBtn')) $('qxGroupBtn').onclick = e => openGroupMenu(e.currentTarget);
    if ($('qxColBtn')) $('qxColBtn').onclick = e => openColMenu(e.currentTarget);
    root.querySelectorAll('[data-fk]').forEach(sel => sel.onchange = () => { S.adv[sel.dataset.fk] = sel.value; S.page = 1; render(); });
    if ($('qxFrom')) $('qxFrom').onchange = e => { S.adv._from = e.target.value; render(); };
    if ($('qxTo')) $('qxTo').onchange = e => { S.adv._to = e.target.value; render(); };
    // sorting
    root.querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => { const k = th.dataset.sort; if (S.sort.key === k) S.sort.dir = S.sort.dir === 'asc' ? 'desc' : 'asc'; else { S.sort.key = k; S.sort.dir = 'asc'; } S.page = 1; render(); });
    /* Sorting resets to page 1 above for the same reason every filter handler
       already does: page 4 of a differently-ordered list is a different set of
       rows, and landing there silently is disorienting. */
    root.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => {
      S.page = Math.max(1, (S.page || 1) + (b.dataset.pg === 'next' ? 1 : -1)); render();
    });
    // group collapse
    root.querySelectorAll('.qx-grp-bar').forEach(bar => bar.onclick = () => { const key = bar.closest('.qx-grp').dataset.grp; S.collapsed.has(key) ? S.collapsed.delete(key) : S.collapsed.add(key); render(); });
    // selection
    if ($('qxAll')) $('qxAll').onclick = () => { const all = allSel(rows); rows.forEach(r => { const id = String(rowId(r)); all ? S.sel.delete(id) : S.sel.add(id); }); render(); };
    root.querySelectorAll('[data-ck]').forEach(cb => cb.onclick = e => { e.stopPropagation(); const id = cb.dataset.ck; S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); render(); });
    // row / card / kanban / cal open
    root.querySelectorAll('.qx-row, .qx-kcard, .qx-card, .qx-cal-ev, .qlm-lrow').forEach(el => el.addEventListener('click', e => {
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
  document.addEventListener('click', e => { if (_menu && !e.target.closest('.qx-menu') && !e.target.closest('#qxGroupBtn,#qxColBtn,#qxFilBtn,#qxMonthBtn')) closeMenu(); });
  function placeMenu(m, anchor) {
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    // Clamp both axes to the viewport; flip above the anchor if it would spill below.
    const mh = m.offsetHeight, mw = m.offsetWidth;
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, (r.top - 6 - mh) > 8 ? r.top - 6 - mh : window.innerHeight - mh - 8);
    m.style.top = top + 'px';
    m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 12)) + 'px';
    _menu = m;
  }
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
    /* OPT-IN GLASS VARIANT.
       This drawer is shared by every module mounted on QLX, so restyling it
       outright would silently redesign Sales, Parties and Reconciliation too —
       modules whose content assumes the current surface. A module asks for the
       new treatment by returning `variant: 'glass'` from detail(), and rolls
       over when its content has been checked against it. Everything below is
       additive: with no variant the markup is byte-for-byte what it always was.

       The extras (avatar, badge, amount, aside) are opt-in for the same reason —
       a module that returns none of them renders exactly as before. */
    const glass = d.variant === 'glass';
    DP.className = 'qx-dp-back qx-a-blue' + (glass ? ' qx-glass' : '') + (DP.classList.contains('open') ? ' open' : '');
    const head = glass ? `<div class="qx-dp-head">
        <div class="qx-dp-top">
          ${d.avatar ? `<div class="qx-dp-av">${d.avatar}</div>` : ''}
          <div class="qx-dp-idt">
            <div class="qx-dp-eyebrow"><span class="qx-badge">${svg(CFG.icon || IC.file)}</span>${esc(d.eyebrow || CFG.title)}</div>
            <div class="qx-dp-t">${d.title || ''}</div><div class="qx-dp-s">${d.sub || ''}</div>
          </div>
          <div class="qx-dp-hr">${d.badge || ''}${d.amount ? `<div class="qx-dp-amt">${d.amount}</div>` : ''}</div>
          <button class="qx-dp-x" id="qxDpX">${svg(IC.x)}</button>
        </div>
        <div class="qx-dp-actions">${actions}</div>
      </div>` : `<div class="qx-dp-head">
        <div class="qx-dp-top"><div>
          <div class="qx-dp-eyebrow"><span class="qx-badge">${svg(CFG.icon || IC.file)}</span>${esc(d.eyebrow || CFG.title)}</div>
          <div class="qx-dp-t">${d.title || ''}</div><div class="qx-dp-s">${d.sub || ''}</div>
        </div><button class="qx-dp-x" id="qxDpX">${svg(IC.x)}</button></div>
        <div class="qx-dp-actions">${actions}</div>
      </div>`;
    const tabbar = `<div class="qx-dp-tabs">${tabs.map((t, i) => `<button class="qx-dp-tab ${i === S.dpTab ? 'active' : ''}" data-dpt="${i}">${t.icon ? svg(t.icon) : ''}${esc(t.label)}${t.count != null ? `<span class="qx-dp-tab-ct">${t.count}</span>` : ''}</button>`).join('')}</div>`;
    dp.innerHTML = head + tabbar + (glass && d.aside
      ? `<div class="qx-dp-split"><div class="qx-dp-body" id="qxDpBody"></div><aside class="qx-dp-aside">${d.aside}</aside></div>`
      : `<div class="qx-dp-body" id="qxDpBody"></div>`);
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
    const chosen = allRows().filter(r => S.sel.has(String(rowId(r))));
    const fmtC = (window.QLD && QLD.fC) ? QLD.fC : (n => '₹' + Math.round(n || 0).toLocaleString('en-IN'));
    const noun = S.sel.size === 1 ? (CFG.noun || 'item') : (CFG.nounPl || 'items');
    const sub = CFG.groupSum ? (fmtC(chosen.reduce((a, r) => a + (CFG.groupSum(r) || 0), 0)) + ' total') : (S.sel.size + ' ' + noun);
    const acts = CFG.bulkActions.map((a, i) => {
      const tone = a.cls === 'del' ? 'del' : (/paid|receiv|collect|approv|done|complete|check|mark/i.test(a.label || '') ? 'ok' : 'info');
      return `<button class="qx-bulk-card ${tone}" data-ba="${i}" title="${esc(a.label)}"><span class="qx-bulk-ic">${a.icon ? svg(a.icon) : ''}</span><span class="qx-bulk-lbl">${esc(a.label)}</span></button>`;
    }).join('');
    BULK.innerHTML =
      `<div class="qx-bulk-head"><span class="qx-bulk-badge">${S.sel.size}<span class="qx-bulk-spark">${svg('<path d="M12 2l1.4 5.2L19 9l-5.6 1.8L12 16l-1.4-5.2L5 9l5.6-1.8z"/>')}</span></span><div class="qx-bulk-txt"><b>Selected</b><span>${esc(sub)}</span></div></div>` +
      `<div class="qx-bulk-acts">${acts}</div>` +
      `<button class="qx-bulk-x" id="qxBulkX" title="Clear selection">${svg(IC.x)}</button>`;
    BULK.querySelector('#qxBulkX').onclick = () => { S.sel.clear(); render(); };
    BULK.querySelectorAll('[data-ba]').forEach(b => b.onclick = () => { const c = allRows().filter(r => S.sel.has(String(rowId(r)))); CFG.bulkActions[+b.dataset.ba].onClick(c); });
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
    const isImg = /image\//.test(opts.fileType || '') || /\.(png|jpe?g|gif|webp|heic)$/i.test(opts.fileName || '');
    if (opts.fileUrl) {
      body = isImg
        ? `<img src="${opts.fileUrl}" alt="bill" style="max-width:100%;border-radius:10px;border:1px solid var(--ql-border)">`
        : `<iframe src="${opts.fileUrl}" class="qx-inv-frame" style="height:76vh" title="bill"></iframe>`;
    } else body = `<iframe class="qx-inv-frame" style="height:76vh" srcdoc="${esc(opts.html || '')}" title="bill"></iframe>`;
    const dl = opts.fileUrl ? `<a class="qx-btn qx-btn-sm" href="${opts.fileUrl}" download="${esc(opts.fileName || 'bill')}">${svg(IC.dl)} Download</a>` : '';
    const sh = (opts.file || opts.fileUrl || opts.onShare) ? `<button class="qx-btn qx-btn-sm" id="qxDocSh">${svg(IC.share)} Share</button>` : '';
    const pr = opts.onPrint ? `<button class="qx-btn qx-btn-sm" id="qxDocPr">${svg(IC.print)} Print</button>` : '';
    const dp = document.getElementById('qxDoc');
    dp.innerHTML = `<div class="qx-dp-head"><div class="qx-dp-top"><div><div class="qx-dp-eyebrow">${svg(IC.file)} ${esc(opts.eyebrow || 'Bill')}</div><div class="qx-dp-t">${esc(opts.title || '')}</div><div class="qx-dp-s">${esc(opts.sub || '')}</div></div><button class="qx-dp-x" id="qxDocX">${svg(IC.x)}</button></div><div class="qx-dp-actions">${dl}${sh}${pr}</div></div><div class="qx-dp-body">${body}</div>`;
    document.getElementById('qxDocX').onclick = close;
    if (opts.onPrint) document.getElementById('qxDocPr').onclick = () => opts.onPrint();
    const shBtn = document.getElementById('qxDocSh');
    if (shBtn) shBtn.onclick = async () => {
      try {
        if (opts.file && navigator.canShare) {
          const f = new File([opts.file], opts.fileName || 'bill', { type: opts.file.type || opts.fileType || 'application/octet-stream' });
          if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: opts.title || 'Bill' }); return; }
        }
      } catch (_) {}
      if (opts.onShare) { opts.onShare(); return; }
      try { if (navigator.share) { await navigator.share({ title: opts.title || 'Bill', text: opts.title || 'Bill' }); return; } } catch (_) {}
      if (opts.fileUrl) window.open(opts.fileUrl, '_blank');
    };
    back.classList.add('open');
  }

  /* ══════════════════ PUBLIC API ══════════════════ */
  window.QLX = {
    mount, remount, refresh, toast, viewDoc,
    open: openDetail, close: closeDetail,
    actionsCell, icons: IC, svg, esc, avColor,
    // Page chrome for non-register pages — same header and stat row, no table.
    heroHTML: heroMarkup, statsHTML: statsMarkup, wireHero, tint: tintOf,
    // helpers configs can use to build cells
    statusPill(val, label, cls) { return `<select class="qx-st ${cls || 's-' + val}" data-st="__ID__">${label}</select>`; },
    getComments, addComment,
    // Month filter — configs use these for month-scoped export / report.
    rows: () => allRows(),                               // current month's rows (all statuses)
    month: () => (S.month && S.month !== 'all') ? S.month : null,
    monthLabel, setMonth,
    // Same prefix rule as the row filter — a `slice(0,7) ===` here matched no
    // date at all once the picker could return a year.
    inMonth: date => !CFG.monthFilter || (window.QLD && QLD.inPeriod ? QLD.inPeriod(date, S.month) : true),
    config: () => CFG, state: () => S
  };
})();

/* build: void-protect 1783929898 */

/* build m12: truck icon */
