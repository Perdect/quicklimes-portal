/* ═══════════════════════════════════════════════════════════════════════
   customers.js — the Customers workspace: CRM + sales intelligence.

   Five registers on one page, each a QLX config remounted in place:
     Customers   the master list — table / cards / kanban-by-status / analytics
     Pipeline    the deal board (13 stages, drag-and-drop)
     Follow-ups  today · overdue · upcoming, plus a calendar
     Quotations  every quotation, by status
     Offers      the quick price offers

   Every number comes from CustomerCore.enrich() over the real registers; the
   AI Insights band is portfolioInsights() — sentences with a figure behind
   each one, and a click on any of them filters the list to those customers.
   ═══════════════════════════════════════════════════════════════════════ */
const Q = window.QLD, C = window.CustomerCore, M = window.QLCRM, U = window.CRMUI;
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons, fC = Q.fC;
const toast = (m, t) => QLX.toast(m, t);

const TABS = [['customers', 'Customers'], ['pipeline', 'Pipeline'], ['followups', 'Follow-ups'], ['quotes', 'Quotations'], ['offers', 'Offers']];
let TAB = (() => { try { const h = (location.hash || '').replace('#', ''); if (TABS.some(t => t[0] === h)) return h; return localStorage.getItem('ql_cu_tab') || 'customers'; } catch (_) { return 'customers'; } })();
let FOCUS = null;                       // { key, ids } from a clicked insight
let CACHE = { t: 0, rows: null };
function rows() { if (!CACHE.rows || Date.now() - CACHE.t > 400) { CACHE.rows = M.enriched(); CACHE.t = Date.now(); } return CACHE.rows; }
function invalidate() { CACHE.t = 0; CACHE.rows = null; }
const byId = id => rows().find(r => r.id === id);
const today = () => C.iso(new Date());
const profile = id => 'customer.html?id=' + encodeURIComponent(id);
const relDays = n => n == null ? 'never' : n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 30 ? n + 'd ago' : n < 365 ? Math.round(n / 30) + 'mo ago' : Math.round(n / 365) + 'y ago';

/* ── visual atoms (shared look with parties.js) ── */
const AV = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
function initials(n) { const p = (n || '?').trim().split(/\s+/); return ((p[0] || '')[0] + (p[1] ? p[1][0] : '')).toUpperCase() || '?'; }
function avColor(n) { let h = 0; for (let i = 0; i < (n || '').length; i++) h = (h * 31 + n.charCodeAt(i)) & 0xffff; return AV[h % AV.length]; }
function avatar(r, size) { return `<span class="crm-av" style="--av:${avColor(r.name)};width:${size || 34}px;height:${size || 34}px;font-size:${(size || 34) * 0.38}px">${esc(initials(r.name))}</span>`; }
function segPill(key) { const c = C.SEGMENTS[key] || C.SEGMENTS.regular; return `<span class="crm-seg" style="--sb:${c.bg};--sf:${c.fg}"><i style="background:${c.dot}"></i>${c.label}</span>`; }
const STATUS_TONE = { active: ['#dcfce7', '#166534'], new: ['#dbeafe', '#1d4ed8'], prospect: ['#f5f3ff', '#6d28d9'], inactive: ['#f1f5f9', '#475569'], blocked: ['#fee2e2', '#991b1b'] };
function statusPill(k) { const c = STATUS_TONE[k] || STATUS_TONE.active; return `<span class="crm-st" style="background:${c[0]};color:${c[1]}">${esc(C.labelOf(C.CUSTOMER_STATUS, k))}</span>`; }
function healthColor(h) { return h >= 75 ? '#16a34a' : h >= 55 ? '#d97706' : '#dc2626'; }
function healthBar(h) { const c = healthColor(h); return `<div class="crm-hb"><div class="crm-hb-t"><div class="crm-hb-f" style="width:${h}%;background:${c}"></div></div><b style="color:${c}">${h}</b></div>`; }
const QSTATUS_TONE = { draft: ['#f1f5f9', '#475569'], sent: ['#dbeafe', '#1d4ed8'], viewed: ['#e0f2fe', '#0369a1'], negotiation: ['#fef3c7', '#b45309'], accepted: ['#dcfce7', '#166534'], rejected: ['#fee2e2', '#991b1b'], expired: ['#f1f5f9', '#64748b'], converted: ['#ede9fe', '#6d28d9'], saved: ['#f1f5f9', '#475569'] };
function qPill(st, list) { const c = QSTATUS_TONE[st] || QSTATUS_TONE.draft; return `<span class="crm-st" style="background:${c[0]};color:${c[1]}">${esc(C.labelOf(list || C.QUOTE_STATUS, st))}</span>`; }
const stageDot = k => k === 'completed' ? '#16a34a' : k === 'lost' ? '#dc2626' : ['delivered', 'payment_pending', 'dispatched', 'production', 'order_confirmed'].includes(k) ? '#0ea5e9' : ['price_confirmed', 'negotiation'].includes(k) ? '#f59e0b' : '#94a3b8';

/* ── the tab strip + quick actions, above every register ── */
function tabsHTML() {
  const all = rows();
  const counts = {
    customers: all.length, pipeline: Q.state.DEALS.filter(d => C.isOpenStage(d.stage)).length,
    followups: C.followupBuckets(Q.state.FOLLOWUPS, today()).overdue.length + C.followupBuckets(Q.state.FOLLOWUPS, today()).today.length,
    quotes: Q.state.QUOTES.filter(q => C.isOpenQuote(q, today())).length, offers: Q.state.OFFERS.filter(o => o.status === 'sent' || o.status === 'saved').length
  };
  return `<div class="cu-tabs">${TABS.map(t => `<button class="cu-tab${TAB === t[0] ? ' on' : ''}" data-tab="${t[0]}">${esc(t[1])}<span>${counts[t[0]] || 0}</span></button>`).join('')}
    <div class="cu-tabs-sp"></div>
    <button class="ql-btn ql-btn-secondary" id="cuTplBtn">${svg(IC.comment)} Templates</button>
    <button class="ql-btn ql-btn-primary" id="cuQuickBtn">${svg(IC.plus)} Quick actions <kbd>n</kbd></button></div>`;
}
function wireTabs() {
  document.querySelectorAll('.cu-tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  const qb = document.getElementById('cuQuickBtn'); if (qb) qb.onclick = e => { e.stopPropagation(); U.quickMenu(qb); };
  const tb = document.getElementById('cuTplBtn'); if (tb) tb.onclick = () => U.openTemplates();
  document.querySelectorAll('[data-insight]').forEach(b => b.onclick = () => { const ins = C.portfolioInsights(rows(), today()).find(i => i.key === b.dataset.insight); if (!ins) return; FOCUS = FOCUS && FOCUS.key === ins.key ? null : { key: ins.key, ids: ins.ids }; if (TAB !== 'customers') switchTab('customers'); else { QLX.state().quick = FOCUS ? 'focus' : 'all'; QLX.refresh(); } });
}
function switchTab(t) {
  TAB = t; try { localStorage.setItem('ql_cu_tab', t); history.replaceState(null, '', '#' + t); } catch (_) {}
  QLX.remount(CFG[t]());
  setTimeout(wireTabs, 0);
}

/* ── AI insights band ── */
function insightsHTML() {
  const list = C.portfolioInsights(rows(), today());
  if (!list.length) return '';
  const cards = list.slice(0, 6).map(i => `<button class="crm-ai-c t-${i.tone} cu-ins${FOCUS && FOCUS.key === i.key ? ' on' : ''}" data-insight="${i.key}"><div class="crm-ai-ic">${i.ic}</div><div class="crm-ai-tx"><b>${esc(i.t)}</b><span>${esc(i.d)}</span></div></button>`).join('');
  return `<div class="crm-ai"><div class="crm-ai-head">${svg('<path d="M12 2l1.9 5.8L20 9.5l-4.9 3.6L16.8 19 12 15.4 7.2 19l1.7-5.9L4 9.5l6.1-1.7z"/>')}<span>AI Customer Intelligence</span><em>computed from your registers — click one to see those customers</em></div><div class="crm-ai-grid cu-ai-grid">${cards}</div></div>`;
}

/* ═══════════════════════ 1. CUSTOMERS ═══════════════════════ */
function customersCfg() {
  return {
    active: 'customers', stateKey: 'cu_customers', title: 'Customers', accent: 'blue', noun: 'customer', nounPl: 'customers',
    icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    data: () => rows(), rowId: r => r.id, comments: false,
    subtitle: () => { const all = rows(); return `<b>${esc(Q.co.short)}</b> · ${all.length} customers · ${all.filter(r => r.statusEff === 'active').length} active · ${all.filter(r => r.dueFollowups > 0).length} need a follow-up`; },
    primary: { label: 'Add customer', icon: IC.plus, onClick: () => U.openCustomerForm(null, id => location.href = profile(id)) },
    emptySub: 'Add your first customer, or import invoices — every party on a sale becomes a customer here.',
    tools: [{ label: 'Export', icon: IC.dl, onClick: () => U.exportCustomers() }],
    views: ['table', 'cards', 'board', 'analytics'],
    banner: () => tabsHTML() + insightsHTML(),
    onOpen: r => { location.href = profile(r.id); return true; },
    stats: () => {
      const all = rows(), cust = all.filter(r => r.salesN > 0);
      const ym = today().slice(0, 7);
      let mSales = 0, outstanding = 0; Q.salesRows().forEach(s => { if (s.status === 'cancelled') return; if ((s.date || '').slice(0, 7) === ym) mSales += s.total; outstanding += s.outstanding; });
      const openQ = Q.state.QUOTES.filter(q => C.isOpenQuote(q, today()));
      const decided = Q.state.QUOTES.filter(q => ['accepted', 'converted', 'rejected', 'expired'].includes(C.effectiveQuoteStatus(q, today())));
      const won = Q.state.QUOTES.filter(q => ['accepted', 'converted'].includes(C.effectiveQuoteStatus(q, today())));
      const potential = all.reduce((a, r) => a + (r.monthlyPotential || 0), 0);
      const newN = all.filter(r => r.statusEff === 'new' || (r.since && C.daysBetween(r.since, today()) <= 30)).length;
      return [
        { label: 'Total customers', value: all.length, sub: cust.length + ' have bought', tint: 'blue', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' },
        { label: 'Active', value: all.filter(r => r.statusEff === 'active').length, sub: 'ordered in 90 days', tint: 'green', icon: IC.check },
        { label: 'New', value: newN, sub: 'last 30 days', tint: 'cyan', icon: IC.plus },
        { label: 'Monthly sales', value: fC(mSales), sub: Q.periodLabel ? Q.periodLabel(ym) : ym, tint: 'green', icon: IC.an },
        { label: 'Monthly potential', value: fC(potential), sub: all.reduce((a, r) => a + r.monthlyDemand, 0).toLocaleString('en-IN') + ' MT/month on record', tint: 'violet', icon: IC.activity },
        { label: 'Outstanding', value: fC(outstanding), sub: fC(all.reduce((a, r) => a + r.overdue, 0)) + ' overdue', tint: 'amber', icon: IC.clock },
        { label: 'Open quotations', value: openQ.length, sub: fC(openQ.reduce((a, q) => a + C.quoteTotals(q).total, 0)), tint: 'indigo', icon: IC.doc2 },
        { label: 'Conversion', value: decided.length ? Math.round(won.length / decided.length * 100) + '%' : '—', sub: won.length + ' of ' + decided.length + ' decided', tint: 'teal', icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>' },
        { label: 'At risk', value: all.filter(r => r.seg === 'at_risk' || r.seg === 'credit_risk').length, sub: 'overdue or over limit', tint: 'rose', icon: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/>' }
      ];
    },
    quickFilters: [
      { key: 'all', label: 'All', test: () => true },
      { key: 'focus', label: () => FOCUS ? '✨ ' + FOCUS.key : '✨ Insight', test: r => FOCUS ? FOCUS.ids.includes(r.id) : true },
      { key: 'active', label: 'Active', test: r => r.statusEff === 'active' },
      { key: 'prospect', label: 'Prospects', test: r => r.statusEff === 'prospect' || r.seg === 'high_potential' },
      { key: 'fu', label: 'Follow-up due', test: r => r.dueFollowups > 0 },
      { key: 'reorder', label: 'Reorder due', test: r => r.rhythm && (r.rhythm.status === 'due' || r.rhythm.status === 'overdue') && r.rhythm.orders >= 3 },
      { key: 'overdue', label: 'Overdue', test: r => r.overdue > 0.5 },
      { key: 'vip', label: '⭐ VIP', test: r => r.seg === 'vip' },
      { key: 'risk', label: 'At risk', test: r => r.seg === 'at_risk' || r.seg === 'credit_risk' }
    ].map(f => Object.assign({}, f, { label: typeof f.label === 'function' ? f.label() : f.label })).filter(f => f.key !== 'focus' || FOCUS),
    search: (r, q) => (r.name + ' ' + r.code + ' ' + r.gstin + ' ' + r.phone + ' ' + r.city + ' ' + r.state + ' ' + r.contact + ' ' + r.salesperson + ' ' + (C.SEGMENTS[r.seg] || {}).label).toLowerCase().includes(q),
    filters: [
      { key: 'seg', label: 'Segment', options: () => Object.keys(C.SEGMENTS).map(k => [k, C.SEGMENTS[k].label]), test: (r, v) => r.seg === v || (r.tags || []).includes(v) },
      { key: 'ctype', label: 'Type', options: () => C.CUSTOMER_TYPES, test: (r, v) => r.ctype === v },
      { key: 'status', label: 'Status', options: () => C.CUSTOMER_STATUS, test: (r, v) => r.statusEff === v },
      { key: 'sp', label: 'Sales person', options: rs => [...new Set(rs.map(r => r.salesperson))].filter(Boolean).sort().map(s => [s, s]), test: (r, v) => r.salesperson === v },
      { key: 'city', label: 'City', options: rs => [...new Set(rs.map(r => r.city))].filter(Boolean).sort().map(s => [s, s]), test: (r, v) => r.city === v },
      { key: 'state', label: 'State', options: rs => [...new Set(rs.map(r => r.state))].filter(Boolean).sort().map(s => [s, s]), test: (r, v) => r.state === v },
      { key: 'health', label: 'Health', options: () => [['hi', 'Healthy (75+)'], ['mid', 'Watch (55–74)'], ['lo', 'Weak (<55)']], test: (r, v) => v === 'hi' ? r.health >= 75 : v === 'mid' ? r.health >= 55 && r.health < 75 : r.health < 55 },
      { key: 'due', label: 'Receivable', options: () => [['due', 'Has outstanding'], ['over', 'Overdue'], ['clear', 'Fully paid']], test: (r, v) => v === 'due' ? r.salesDue > 0.5 : v === 'over' ? r.overdue > 0.5 : r.salesN > 0 && r.salesDue <= 0.5 }
    ],
    groupBy: [
      { key: 'seg', label: 'Segment', of: r => r.seg, title: r => (C.SEGMENTS[r.seg] || {}).label || r.seg, dot: r => (C.SEGMENTS[r.seg] || {}).dot || '#94a3b8' },
      { key: 'status', label: 'Status', of: r => r.statusEff, title: r => C.labelOf(C.CUSTOMER_STATUS, r.statusEff), dot: r => (STATUS_TONE[r.statusEff] || [])[1] || '#94a3b8' },
      { key: 'ctype', label: 'Type', of: r => r.ctype || '—', title: r => C.labelOf(C.CUSTOMER_TYPES, r.ctype) || 'No type set', dot: () => 'var(--qx)' },
      { key: 'sp', label: 'Sales person', of: r => r.salesperson || '—', title: r => esc(r.salesperson || 'Unassigned'), dot: () => 'var(--qx)' },
      { key: 'city', label: 'City', of: r => r.city || '—', title: r => esc(r.city || '—'), dot: () => 'var(--qx)' },
      { key: 'state', label: 'State', of: r => r.state || '—', title: r => esc(r.state || '—'), dot: () => 'var(--qx)' }
    ],
    groupSum: r => r.salesAmt,
    status: { options: C.CUSTOMER_STATUS, of: r => r.statusEff, dot: k => (STATUS_TONE[k] || [])[1], set: (r, k) => { M.setStatus(r.id, k); invalidate(); toast(r.name + ' → ' + C.labelOf(C.CUSTOMER_STATUS, k)); } },
    sortDefault: { key: 'salesAmt', dir: 'desc' },
    columns: [
      { key: 'sr', label: '#', cell: (r, sr) => `<span class="qx-sr">${sr}</span>`, cls: 'qx-sr' },
      { key: 'name', label: 'Customer', sort: true, cell: r => `<div class="crm-cust">${avatar(r)}<div class="crm-cust-t"><a class="crm-cust-n cu-link" href="${profile(r.id)}">${esc(r.name)}</a><span class="crm-cust-s">${esc(r.code || '')}${r.contact ? ' · ' + esc(r.contact) : ''}${r.phone ? ' · ' + esc(r.phone) : ''}</span></div></div>` },
      { key: 'ctype', label: 'Type', sort: true, cell: r => r.ctype ? esc(C.labelOf(C.CUSTOMER_TYPES, r.ctype)) : '<span class="qx-mut">—</span>' },
      { key: 'city', label: 'City', sort: true, cell: r => esc(r.city || r.state || '—') },
      { key: 'seg', label: 'Segment', sort: true, cell: r => segPill(r.seg) + (r.tags || []).slice(0, 2).map(t => ' ' + segPill(t)).join('') },
      { key: 'health', label: 'Health', sort: true, num: true, cell: r => healthBar(r.health) },
      { key: 'monthlyDemand', label: 'Monthly demand', sort: true, num: true, cell: r => r.monthlyDemand ? `<span class="qx-num">${r.monthlyDemand} MT</span><span class="crm-mut" style="display:block;font-size:11px">${r.monthlyPotential ? fC(r.monthlyPotential) : ''}</span>` : '<span class="qx-mut">—</span>' },
      { key: 'salesLast', label: 'Last order', sort: true, cell: r => r.salesLast ? `<span>${Q.fDS(r.salesLast)}</span><span class="crm-mut" style="display:block;font-size:11px">${relDays(r.salesRec)}${r.rhythm && r.rhythm.status === 'due' ? ' · <b style="color:#1d4ed8">reorder due</b>' : r.rhythm && r.rhythm.status === 'overdue' ? ' · <b style="color:#b45309">reorder late</b>' : ''}</span>` : '<span class="qx-mut">—</span>' },
      { key: 'salesAmt', label: 'Total sales', sort: true, num: true, cell: r => r.salesN ? `<span class="qx-num qx-strong">${fC(r.salesAmt)}</span><span class="crm-mut" style="display:block;font-size:11px">${r.salesN} orders</span>` : '<span class="qx-mut">—</span>' },
      { key: 'salesDue', label: 'Outstanding', sort: true, num: true, cell: r => r.salesDue > 0.5 ? `<span class="qx-num" style="color:var(--ql-danger-600);font-weight:600">${fC(r.salesDue)}${r.overdue ? ' <i class="crm-flag" title="overdue">!</i>' : ''}</span>` : '<span class="qx-mut">—</span>' },
      { key: 'openQuotes', label: 'Open quote', sort: true, num: true, cell: r => r.openQuotes ? `<span class="qx-num">${r.openQuotes}</span><span class="crm-mut" style="display:block;font-size:11px">${fC(r.openQuoteValue)}</span>` : '<span class="qx-mut">—</span>' },
      { key: 'salesperson', label: 'Sales person', sort: true, cell: r => esc(r.salesperson || '—') },
      { key: 'lastActivity', label: 'Last activity', sort: true, cell: r => r.lastActivity ? `<span>${Q.fDS(r.lastActivity)}</span><span class="crm-mut" style="display:block;font-size:11px">${relDays(r.recDays)}${r.dueFollowups ? ' · <b style="color:#b45309">' + r.dueFollowups + ' due</b>' : ''}</span>` : '<span class="qx-mut">—</span>' },
      { key: 'statusEff', label: 'Status', sort: true, cell: r => statusPill(r.statusEff) },
      { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
    ],
    rowActions: r => [
      { tt: 'Open profile', icon: IC.eye, onClick: r => location.href = profile(r.id) },
      ...(U.phoneOf(r) ? [{ tt: 'WhatsApp', icon: IC.wa, cls: 'qx-ib-ok', onClick: r => U.openComposer(r.id, { channel: 'whatsapp' }) }] : []),
      { tt: 'Price offer', icon: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>', onClick: r => U.openOffer(r.id) }
    ],
    rowMenu: r => [
      { label: 'Open profile', icon: IC.eye, onClick: r => location.href = profile(r.id) },
      { label: 'Edit', icon: IC.edit, onClick: r => U.openCustomerForm(r.id) },
      { label: 'Add requirement', icon: IC.plus, onClick: r => U.openReqForm(r.id) },
      { label: 'New quotation', icon: IC.doc2, onClick: r => U.openQuoteEditor(r.id) },
      { label: 'Send price offer', icon: IC.share, onClick: r => U.openOffer(r.id) },
      { label: 'Record order', icon: IC.truck, onClick: r => U.openRecordOrder(r.id) },
      { label: 'Record payment', icon: IC.check, onClick: r => U.openRecordPayment(r.id) },
      { label: 'Add follow-up', icon: IC.clock, onClick: r => U.openFollowupForm(r.id) },
      ...(U.phoneOf(r) ? [{ label: 'Call', icon: IC.call, onClick: r => location.href = 'tel:' + U.phoneOf(r) }] : []),
      { divider: true },
      { label: 'Archive', icon: IC.file, onClick: r => { Q.archiveRecord('party', r.idx, true); toast('Customer archived'); invalidate(); QLX.refresh(); } },
      { label: 'Delete', icon: IC.trash, cls: 'del', onClick: r => QLShell.confirmDelete({ title: 'Move customer to Trash?', desc: r.name + ' can be restored for 90 days. Invoices are not deleted.', confirmLabel: 'Move to Trash', onConfirm: reason => { Q.deleteParty(r.idx, reason); toast('Moved to Trash'); invalidate(); QLX.refresh(); } }) }
    ],
    bulkActions: [
      { label: 'Assign sales person', icon: IC.edit, onClick: sel => QLShell.openForm({ title: 'Assign sales person', sub: sel.length + ' customers', specs: [{ k: 'sp', label: 'Sales person', req: true, full: true }], initial: {}, saveLabel: 'Assign', onSave(v) { sel.forEach(r => M.setSalesperson(r.id, v.sp)); toast('Assigned'); invalidate(); QLX.refresh(); } }) },
      { label: 'Set status', icon: IC.check, onClick: sel => QLShell.openForm({ title: 'Set status', sub: sel.length + ' customers', specs: [{ k: 'st', label: 'Status', type: 'select', full: true, opts: C.CUSTOMER_STATUS }], initial: { st: 'active' }, saveLabel: 'Apply', onSave(v) { sel.forEach(r => M.setStatus(r.id, v.st)); toast('Status updated'); invalidate(); QLX.refresh(); } }) },
      { label: 'Add segment tag', icon: IC.tag || IC.plus, onClick: sel => QLShell.openForm({ title: 'Add segment tag', sub: sel.length + ' customers', specs: [{ k: 'tag', label: 'Tag', type: 'select', full: true, opts: Object.keys(C.SEGMENTS).filter(k => !C.SEGMENTS[k].auto).map(k => [k, C.SEGMENTS[k].label]) }], initial: {}, saveLabel: 'Tag', onSave(v) { sel.forEach(r => M.toggleTag(r.id, v.tag, true)); toast('Tagged'); invalidate(); QLX.refresh(); } }) },
      { label: 'Schedule follow-up', icon: IC.clock, onClick: sel => QLShell.openForm({ title: 'Schedule a follow-up', sub: sel.length + ' customers', specs: [{ k: 'date', label: 'Date', type: 'date', req: true }, { k: 'type', label: 'Type', type: 'select', opts: C.FOLLOWUP_TYPES }, { k: 'notes', label: 'Notes', full: true }], initial: { date: today(), type: 'call' }, saveLabel: 'Schedule', onSave(v) { sel.forEach(r => M.addFollowup(Object.assign({ cust: r.id }, v))); toast(sel.length + ' follow-ups scheduled'); invalidate(); QLX.refresh(); } }) },
      { label: 'Export selected', icon: IC.dl, onClick: sel => { QLShell.exportCSV('customers_selected', ['Code', 'Customer', 'City', 'Phone', 'Email', 'TotalSales', 'Outstanding'], sel.map(x => [x.code, x.name, x.city, x.phone, x.email, Math.round(x.salesAmt), Math.round(x.salesDue)])); toast('Exported ' + sel.length); } }
    ],
    card: r => ({ id: r.id, title: esc(r.name), amount: r.salesN ? fC(r.salesAmt) : (r.monthlyPotential ? fC(r.monthlyPotential) + '/mo' : ''), party: r.name, partySub: [C.labelOf(C.CUSTOMER_TYPES, r.ctype), r.city].filter(Boolean).join(' · ') || (C.SEGMENTS[r.seg] || {}).label, status: statusPill(r.statusEff), chips: [segPill(r.seg)], rows: [['Health', healthBar(r.health)], ['Monthly demand', r.monthlyDemand ? r.monthlyDemand + ' MT' : '—'], ['Outstanding', r.salesDue > 0.5 ? fC(r.salesDue) : '—'], ['Last order', r.salesLast ? relDays(r.salesRec) : '—']] }),
    footer: rs => [{ label: 'Customers', value: rs.length }, { label: 'Total sales', value: fC(rs.reduce((a, r) => a + r.salesAmt, 0)), strong: true }, { label: 'Outstanding', value: fC(rs.reduce((a, r) => a + r.salesDue, 0)) }, { label: 'Monthly potential', value: fC(rs.reduce((a, r) => a + r.monthlyPotential, 0)) }],
    analytics: rs => {
      const cust = rs.filter(r => r.salesN > 0);
      const bars = cust.slice().sort((a, b) => b.salesAmt - a.salesAmt).slice(0, 8).map(r => ({ label: r.name, value: r.salesAmt, display: fC(r.salesAmt), color: avColor(r.name) }));
      const segCount = {}; rs.forEach(r => segCount[r.seg] = (segCount[r.seg] || 0) + 1);
      const donut = Object.keys(segCount).map(k => ({ label: (C.SEGMENTS[k] || {}).label || k, value: segCount[k], display: String(segCount[k]), color: (C.SEGMENTS[k] || {}).dot || '#94a3b8' }));
      const pot = rs.filter(r => r.monthlyPotential > 0).sort((a, b) => b.monthlyPotential - a.monthlyPotential).slice(0, 8);
      const mx = Math.max(1, ...pot.map(r => r.monthlyPotential));
      const extra = `<div class="qx-an-h">Monthly potential — top customers</div>${pot.map(r => `<div class="qx-bar-row"><span class="qx-bar-lbl">${esc(r.name)}</span><div class="qx-bar-track"><div class="qx-bar-fill" style="width:${Math.round(r.monthlyPotential / mx * 100)}%;background:#8b5cf6"></div></div><span class="qx-bar-val">${r.monthlyDemand} MT · ${fC(r.monthlyPotential)}</span></div>`).join('') || '<div class="qx-mut">Record requirements to see potential.</div>'}
        <div class="qx-an-h" style="margin-top:16px">By customer type</div>${(() => { const m = {}; rs.forEach(r => { const k = C.labelOf(C.CUSTOMER_TYPES, r.ctype) || 'No type'; m[k] = (m[k] || 0) + r.salesAmt; }); const arr = Object.entries(m).sort((a, b) => b[1] - a[1]); const mm = Math.max(1, ...arr.map(x => x[1])); return arr.map(x => `<div class="qx-bar-row"><span class="qx-bar-lbl">${esc(x[0])}</span><div class="qx-bar-track"><div class="qx-bar-fill" style="width:${Math.round(x[1] / mm * 100)}%"></div></div><span class="qx-bar-val">${fC(x[1])}</span></div>`).join(''); })()}`;
      return { barsTitle: 'Top customers by revenue', bars, donutTitle: 'Segment mix', donut, donutCenter: rs.length + '<span style="font-size:9px;display:block;font-weight:600;color:var(--ql-text-secondary)">customers</span>', extra };
    }
  };
}

/* ═══════════════════════ 2. PIPELINE ═══════════════════════ */
function dealRows() {
  const cs = rows();
  return Q.state.DEALS.filter(d => !d._del).map(d => {
    const c = cs.find(x => x.id === d.cust) || {};
    return Object.assign({}, d, { custName: c.name || '—', custCode: c.code || '', valueN: C.dealValue(d), stageL: C.stageLabel(d.stage), open: C.isOpenStage(d.stage), last: d.lastActivityAt || d.updatedAt || d.at, health: c.health });
  });
}
function pipelineCfg() {
  return {
    active: 'customers', stateKey: 'cu_pipeline', title: 'Sales Pipeline', accent: 'blue', noun: 'deal', nounPl: 'deals',
    icon: '<rect x="3" y="3" width="6" height="18" rx="1.5"/><rect x="10.5" y="3" width="6" height="12" rx="1.5"/><rect x="18" y="3" width="3" height="18" rx="1.5"/>',
    data: () => dealRows(), rowId: r => r.id, comments: false,
    subtitle: () => { const s = C.pipelineSummary(Q.state.DEALS); return `${s.open} open deals · ${fC(s.gross)} gross · <b>${fC(s.weighted)} weighted</b>${s.unvalued ? ' · ' + s.unvalued + ' without a price' : ''}`; },
    primary: { label: 'New deal', icon: IC.plus, onClick: () => U.openDealForm(null) },
    emptySub: 'A deal appears when you add a requirement, prepare a quotation or send an offer — or add one by hand.',
    views: ['board', 'table'], banner: () => tabsHTML(),
    stats: () => { const s = C.pipelineSummary(Q.state.DEALS); return [
      { label: 'Open deals', value: s.open, sub: 'in the pipeline', tint: 'blue', icon: IC.board },
      { label: 'Pipeline (gross)', value: fC(s.gross), sub: 'sum of open values', tint: 'indigo', icon: IC.an },
      { label: 'Weighted', value: fC(s.weighted), sub: 'plan against this', tint: 'green', icon: IC.check },
      { label: 'Won / lost', value: s.won + ' / ' + s.lost, sub: 'completed vs lost', tint: 'teal', icon: IC.activity },
      { label: 'Unpriced', value: s.unvalued, sub: 'no rate or qty yet', tint: 'amber', icon: IC.clock }
    ]; },
    quickDefault: 'open', quickFilters: [{ key: 'open', label: 'Open', test: r => r.open }, { key: 'all', label: 'Everything', test: () => true }, { key: 'won', label: 'Completed', test: r => r.stage === 'completed' }, { key: 'lost', label: 'Lost', test: r => r.stage === 'lost' }],
    search: (r, q) => (r.custName + ' ' + (r.product || '') + ' ' + (r.owner || '') + ' ' + r.stageL).toLowerCase().includes(q),
    filters: [
      { key: 'product', label: 'Product', options: rs => [...new Set(rs.map(r => r.product))].filter(Boolean).map(p => [p, p]), test: (r, v) => r.product === v },
      { key: 'owner', label: 'Sales person', options: rs => [...new Set(rs.map(r => r.owner))].filter(Boolean).map(p => [p, p]), test: (r, v) => r.owner === v }
    ],
    groupBy: [{ key: 'stage', label: 'Stage', of: r => r.stage, title: r => r.stageL, dot: r => stageDot(r.stage) }],
    groupSum: r => r.valueN || 0,
    status: { options: C.STAGES.map(s => [s.key, s.label]), of: r => r.stage, dot: stageDot, set: (r, k) => {
      if (k === 'lost') { QLShell.openForm({ title: 'Mark as lost', sub: r.custName, specs: [{ k: 'why', label: 'Reason', full: true, req: true }], initial: {}, saveLabel: 'Mark lost', onSave(v) { M.moveDeal(r.id, 'lost', v.why); invalidate(); QLX.refresh(); } }); return false; }
      M.moveDeal(r.id, k); invalidate(); toast(r.custName + ' → ' + C.stageLabel(k)); } },
    sortDefault: { key: 'last', dir: 'desc' },
    columns: [
      { key: 'custName', label: 'Customer', sort: true, cell: r => `<a class="cu-link" href="${profile(r.cust)}">${esc(r.custName)}</a><span class="crm-mut" style="display:block;font-size:11px">${esc(r.custCode)}</span>` },
      { key: 'product', label: 'Product', sort: true, cell: r => esc(r.product || '—') },
      { key: 'qty', label: 'Qty', sort: true, num: true, cell: r => r.qty ? r.qty + ' ' + (r.unit || 'MT') : '—' },
      { key: 'valueN', label: 'Expected value', sort: true, num: true, cell: r => r.valueN == null ? '<span class="qx-mut">no price</span>' : `<span class="qx-num qx-strong">${fC(r.valueN)}</span>` },
      { key: 'targetRate', label: 'Target price', sort: true, num: true, cell: r => r.targetRate ? fC(r.targetRate) + '/MT' : '—' },
      { key: 'stage', label: 'Stage', sort: true, cell: r => `<span class="qx-pill" style="background:${stageDot(r.stage)}22;color:${stageDot(r.stage)}">${esc(r.stageL)}</span>` },
      { key: 'expectedClose', label: 'Expected close', sort: true, cell: r => r.expectedClose ? Q.fDS(r.expectedClose) : '—' },
      { key: 'owner', label: 'Sales person', sort: true, cell: r => esc(r.owner || '—') },
      { key: 'last', label: 'Last activity', sort: true, cell: r => U.when(r.last) },
      { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
    ],
    rowActions: r => [{ tt: 'Edit', icon: IC.edit, onClick: r => U.openDealForm(r.cust, r.id) }, { tt: 'Profile', icon: IC.eye, onClick: r => location.href = profile(r.cust) }],
    rowMenu: r => [
      { label: 'Edit deal', icon: IC.edit, onClick: r => U.openDealForm(r.cust, r.id) },
      { label: 'New quotation', icon: IC.doc2, onClick: r => U.openQuoteEditor(r.cust) },
      { label: 'Send price offer', icon: IC.share, onClick: r => U.openOffer(r.cust, { product: r.product, qty: r.qty, rate: r.targetRate }) },
      { label: 'Record order', icon: IC.truck, onClick: r => U.openRecordOrder(r.cust, { quoteId: r.quoteId, dealId: r.id }) },
      { label: 'Add follow-up', icon: IC.clock, onClick: r => U.openFollowupForm(r.cust) },
      { divider: true },
      { label: 'Mark lost', icon: IC.x, cls: 'del', onClick: r => QLShell.openForm({ title: 'Mark as lost', sub: r.custName, specs: [{ k: 'why', label: 'Reason', full: true, req: true }], initial: {}, saveLabel: 'Mark lost', onSave(v) { M.moveDeal(r.id, 'lost', v.why); invalidate(); QLX.refresh(); } }) }
    ],
    onOpen: r => { U.openDealForm(r.cust, r.id); return true; },
    card: r => ({ id: r.id, title: esc(r.custName), amount: r.valueN == null ? 'no price' : fC(r.valueN), party: r.custName, partySub: (r.product || '') + (r.qty ? ' · ' + r.qty + ' ' + (r.unit || 'MT') : ''), chips: [
      r.targetRate ? `<span class="qx-tag">₹${Math.round(r.targetRate).toLocaleString('en-IN')}/MT</span>` : '', r.expectedClose ? `<span class="qx-tag">${Q.fDS(r.expectedClose)}</span>` : '', r.owner ? `<span class="qx-tag">${esc(r.owner)}</span>` : '', `<span class="qx-tag">${U.when(r.last)}</span>` ].filter(Boolean) }),
    footer: rs => { const s = C.pipelineSummary(rs); return [{ label: 'Deals', value: rs.length }, { label: 'Gross', value: fC(s.gross), strong: true }, { label: 'Weighted', value: fC(s.weighted) }]; }
  };
}

/* ═══════════════════════ 3. FOLLOW-UPS ═══════════════════════ */
function fuRows() {
  const cs = rows(); const t = today();
  return Q.state.FOLLOWUPS.filter(f => !f._del).map(f => {
    const c = cs.find(x => x.id === f.cust) || {};
    const d = String(f.date || '').slice(0, 10);
    const bucket = f.status === 'done' ? 'done' : f.status === 'skipped' ? 'skipped' : d < t ? 'overdue' : d === t ? 'today' : 'upcoming';
    return Object.assign({}, f, { custName: c.name || '—', phone: U.phoneOf(c), bucket, typeL: C.labelOf(C.FOLLOWUP_TYPES, f.type), days: C.daysBetween(d, t) });
  });
}
const BUCKET_TONE = { overdue: '#dc2626', today: '#d97706', upcoming: '#2563eb', done: '#16a34a', skipped: '#94a3b8' };
function followupsCfg() {
  return {
    active: 'customers', stateKey: 'cu_followups', title: 'Follow-ups', accent: 'blue', noun: 'follow-up', nounPl: 'follow-ups', icon: IC.clock,
    data: () => fuRows(), rowId: r => r.id, comments: false, dateField: r => String(r.date || '').slice(0, 10),
    subtitle: () => { const b = C.followupBuckets(Q.state.FOLLOWUPS, today()); return `<b>${b.overdue.length} overdue</b> · ${b.today.length} today · ${b.upcoming.length} upcoming`; },
    primary: { label: 'Add follow-up', icon: IC.plus, onClick: () => U.openFollowupForm(null) },
    emptySub: 'Schedule a call, a WhatsApp or a payment follow-up — it shows here on the day.',
    views: ['table', 'board', 'calendar'], banner: () => tabsHTML(),
    stats: () => { const b = C.followupBuckets(Q.state.FOLLOWUPS, today()); return [
      { label: "Today's follow-ups", value: b.today.length, sub: 'scheduled for today', tint: 'amber', icon: IC.clock },
      { label: 'Overdue', value: b.overdue.length, sub: 'past their date', tint: 'rose', icon: IC.activity },
      { label: 'Upcoming', value: b.upcoming.length, sub: 'later this month and beyond', tint: 'blue', icon: IC.cal },
      { label: 'Done this month', value: Q.state.FOLLOWUPS.filter(f => f.status === 'done' && String(f.doneAt || '').slice(0, 7) === today().slice(0, 7)).length, sub: 'completed', tint: 'green', icon: IC.check }
    ]; },
    quickDefault: 'open', quickFilters: [{ key: 'open', label: 'Open', test: r => r.bucket === 'overdue' || r.bucket === 'today' || r.bucket === 'upcoming' }, { key: 'overdue', label: 'Overdue', test: r => r.bucket === 'overdue' }, { key: 'today', label: 'Today', test: r => r.bucket === 'today' }, { key: 'upcoming', label: 'Upcoming', test: r => r.bucket === 'upcoming' }, { key: 'done', label: 'Done', test: r => r.bucket === 'done' }, { key: 'all', label: 'All', test: () => true }],
    search: (r, q) => (r.custName + ' ' + (r.notes || '') + ' ' + (r.assignee || '') + ' ' + r.typeL).toLowerCase().includes(q),
    filters: [
      { key: 'type', label: 'Type', options: () => C.FOLLOWUP_TYPES, test: (r, v) => r.type === v },
      { key: 'assignee', label: 'Assigned to', options: rs => [...new Set(rs.map(r => r.assignee))].filter(Boolean).map(p => [p, p]), test: (r, v) => r.assignee === v }
    ],
    groupBy: [{ key: 'bucket', label: 'When', of: r => r.bucket, title: r => ({ overdue: 'Overdue', today: 'Today', upcoming: 'Upcoming', done: 'Done', skipped: 'Skipped' })[r.bucket], dot: r => BUCKET_TONE[r.bucket] }, { key: 'assignee', label: 'Assigned to', of: r => r.assignee || '—', title: r => esc(r.assignee || 'Unassigned'), dot: () => 'var(--qx)' }],
    groupByDefault: 'bucket',
    status: { options: [['overdue', 'Overdue'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['done', 'Done']], of: r => r.bucket, dot: k => BUCKET_TONE[k], set: (r, k) => { if (k === 'done') { U.completeFollowup(r.id, () => { invalidate(); QLX.refresh(); }); return false; } if (k === 'today') { M.updateFollowup(r.id, { date: today(), status: 'open' }); invalidate(); return; } if (k === 'upcoming') { M.updateFollowup(r.id, { date: C.addDays(today(), 1), status: 'open' }); invalidate(); return; } return 'Drag to Today, Upcoming or Done'; } },
    sortDefault: { key: 'date', dir: 'asc' },
    columns: [
      { key: 'date', label: 'When', sort: true, cell: r => `<b style="color:${BUCKET_TONE[r.bucket]}">${Q.fDS(r.date)}${r.time ? ' ' + esc(r.time) : ''}</b><span class="crm-mut" style="display:block;font-size:11px">${r.bucket === 'overdue' ? r.days + 'd overdue' : r.bucket === 'today' ? 'today' : r.bucket === 'upcoming' ? 'in ' + (-r.days) + 'd' : r.bucket}</span>` },
      { key: 'custName', label: 'Customer', sort: true, cell: r => `<a class="cu-link" href="${profile(r.cust)}">${esc(r.custName)}</a>` },
      { key: 'type', label: 'Type', sort: true, cell: r => esc(r.typeL) },
      { key: 'notes', label: 'Notes', cell: r => esc(r.notes || '—') + (r.nextAction ? `<span class="crm-mut" style="display:block;font-size:11px">→ ${esc(r.nextAction)}</span>` : '') },
      { key: 'assignee', label: 'Assigned', sort: true, cell: r => esc(r.assignee || '—') },
      { key: 'status', label: 'Status', sort: true, cell: r => `<span class="crm-st" style="background:${BUCKET_TONE[r.bucket]}22;color:${BUCKET_TONE[r.bucket]}">${esc(r.bucket)}</span>` },
      { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
    ],
    rowActions: r => r.status === 'done' || r.status === 'skipped' ? [{ tt: 'Profile', icon: IC.eye, onClick: r => location.href = profile(r.cust) }] : [
      { tt: 'Mark done', icon: IC.check, cls: 'qx-ib-ok', onClick: r => U.completeFollowup(r.id, () => { invalidate(); QLX.refresh(); }) },
      ...(r.phone ? [{ tt: 'Call', icon: IC.call, onClick: r => location.href = 'tel:' + r.phone }, { tt: 'WhatsApp', icon: IC.wa, onClick: r => U.openComposer(r.cust, { channel: 'whatsapp', templateId: 'tpl_followup' }) }] : []),
      { tt: 'Edit', icon: IC.edit, onClick: r => U.openFollowupForm(r.cust, r.id, () => { invalidate(); QLX.refresh(); }) }
    ],
    rowMenu: r => [
      { label: 'Mark done', icon: IC.check, onClick: r => U.completeFollowup(r.id, () => { invalidate(); QLX.refresh(); }) },
      { label: 'Reschedule to tomorrow', icon: IC.clock, onClick: r => { M.updateFollowup(r.id, { date: C.addDays(today(), 1) }); invalidate(); QLX.refresh(); } },
      { label: 'Edit', icon: IC.edit, onClick: r => U.openFollowupForm(r.cust, r.id, () => { invalidate(); QLX.refresh(); }) },
      { label: 'Open profile', icon: IC.eye, onClick: r => location.href = profile(r.cust) },
      { divider: true },
      { label: 'Skip', icon: IC.x, cls: 'del', onClick: r => { M.skipFollowup(r.id); invalidate(); QLX.refresh(); } }
    ],
    onOpen: r => { if (r.status === 'open') U.completeFollowup(r.id, () => { invalidate(); QLX.refresh(); }); else location.href = profile(r.cust); return true; },
    card: r => ({ id: r.id, title: esc(r.custName), amount: r.time || '', party: r.custName, partySub: r.typeL + (r.assignee ? ' · ' + r.assignee : ''), calLabel: r.custName + ' · ' + r.typeL, chips: [`<span class="qx-tag">${Q.fDS(r.date)}</span>`, r.notes ? `<span class="qx-tag">${esc(r.notes.slice(0, 40))}</span>` : ''].filter(Boolean) })
  };
}

/* ═══════════════════════ 4. QUOTATIONS ═══════════════════════ */
function quoteRows() {
  const cs = rows(); const t = today();
  return Q.state.QUOTES.filter(q => !q._del).map(q => { const c = cs.find(x => x.id === q.cust) || {}; const tt = C.quoteTotals(q); const st = C.effectiveQuoteStatus(q, t); return Object.assign({}, q, { custName: c.name || '—', total: tt.total, tonnes: tt.tonnes, st, stL: C.labelOf(C.QUOTE_STATUS, st), open: C.isOpenQuote(q, t), firstProduct: (q.items[0] || {}).product || '', firstRate: (q.items[0] || {}).rate || 0, daysLeft: C.daysBetween(t, q.validUntil) }); });
}
function quotesCfg() {
  return {
    active: 'customers', stateKey: 'cu_quotes', title: 'Quotations', accent: 'blue', noun: 'quotation', nounPl: 'quotations', icon: IC.doc2,
    data: () => quoteRows(), rowId: r => r.id, comments: false, dateField: r => r.date,
    subtitle: () => { const rs = quoteRows(); const open = rs.filter(r => r.open); return `${open.length} open · ${fC(open.reduce((a, r) => a + r.total, 0))} · ${rs.filter(r => r.st === 'converted' || r.st === 'accepted').length} won`; },
    primary: { label: 'New quotation', icon: IC.plus, onClick: () => U.openQuoteEditor(null) },
    emptySub: 'Prepare a quotation from a customer profile or from here.',
    views: ['table', 'board', 'cards'], banner: () => tabsHTML(),
    stats: () => { const rs = quoteRows(); const open = rs.filter(r => r.open); const dec = rs.filter(r => ['accepted', 'converted', 'rejected', 'expired'].includes(r.st)); const won = rs.filter(r => ['accepted', 'converted'].includes(r.st)); return [
      { label: 'Open quotations', value: open.length, sub: fC(open.reduce((a, r) => a + r.total, 0)), tint: 'blue', icon: IC.doc2 },
      { label: 'Expiring in 3 days', value: open.filter(r => r.daysLeft != null && r.daysLeft <= 3).length, sub: 'follow up now', tint: 'amber', icon: IC.clock },
      { label: 'Won', value: won.length, sub: fC(won.reduce((a, r) => a + r.total, 0)), tint: 'green', icon: IC.check },
      { label: 'Conversion', value: dec.length ? Math.round(won.length / dec.length * 100) + '%' : '—', sub: won.length + ' of ' + dec.length + ' decided', tint: 'teal', icon: IC.activity },
      { label: 'Tonnage quoted (open)', value: open.reduce((a, r) => a + r.tonnes, 0).toLocaleString('en-IN') + ' MT', sub: 'across open quotations', tint: 'violet', icon: IC.truck }
    ]; },
    quickDefault: 'open', quickFilters: [{ key: 'open', label: 'Open', test: r => r.open }, { key: 'all', label: 'All', test: () => true }, { key: 'won', label: 'Won', test: r => r.st === 'accepted' || r.st === 'converted' }, { key: 'lost', label: 'Rejected / expired', test: r => r.st === 'rejected' || r.st === 'expired' }],
    search: (r, q) => (r.no + ' ' + r.custName + ' ' + r.firstProduct + ' ' + r.stL).toLowerCase().includes(q),
    filters: [{ key: 'st', label: 'Status', options: () => C.QUOTE_STATUS, test: (r, v) => r.st === v }, { key: 'product', label: 'Product', options: rs => [...new Set(rs.map(r => r.firstProduct))].filter(Boolean).map(p => [p, p]), test: (r, v) => r.firstProduct === v }],
    groupBy: [{ key: 'st', label: 'Status', of: r => r.st, title: r => r.stL, dot: r => (QSTATUS_TONE[r.st] || [])[1] }, { key: 'cust', label: 'Customer', of: r => r.cust, title: r => esc(r.custName), dot: () => 'var(--qx)' }],
    groupSum: r => r.total,
    status: { options: C.QUOTE_STATUS, of: r => r.st, dot: k => (QSTATUS_TONE[k] || [])[1], set: (r, k) => { if (k === 'converted') { U.openRecordOrder(r.cust, { quoteId: r.id }); return false; } M.setQuoteStatus(r.id, k, {}); invalidate(); } },
    sortDefault: { key: 'date', dir: 'desc' },
    columns: [
      { key: 'no', label: 'No.', sort: true, cell: r => `<b class="cu-link" data-open-quote="${esc(r.id)}">${esc(r.no)}</b>${r.rev > 1 ? `<span class="crm-mut" style="display:block;font-size:11px">revision ${r.rev}</span>` : ''}` },
      { key: 'date', label: 'Date', sort: true, cell: r => Q.fDS(r.date) },
      { key: 'custName', label: 'Customer', sort: true, cell: r => `<a class="cu-link" href="${profile(r.cust)}">${esc(r.custName)}</a>` },
      { key: 'firstProduct', label: 'Product', sort: true, cell: r => esc(r.firstProduct) + (r.items.length > 1 ? ` <span class="crm-mut">+${r.items.length - 1}</span>` : '') },
      { key: 'tonnes', label: 'Qty', sort: true, num: true, cell: r => r.tonnes + ' MT' },
      { key: 'firstRate', label: 'Rate', sort: true, num: true, cell: r => fC(r.firstRate) + '/MT' },
      { key: 'total', label: 'Total', sort: true, num: true, cell: r => `<span class="qx-num qx-strong">${fC(r.total)}</span>` },
      { key: 'validUntil', label: 'Valid until', sort: true, cell: r => `${Q.fDS(r.validUntil)}${r.open && r.daysLeft != null ? `<span class="crm-mut" style="display:block;font-size:11px;${r.daysLeft <= 3 ? 'color:#b45309' : ''}">${r.daysLeft < 0 ? 'expired' : r.daysLeft + 'd left'}</span>` : ''}` },
      { key: 'st', label: 'Status', sort: true, cell: r => qPill(r.st) },
      { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
    ],
    rowActions: r => [{ tt: 'Open', icon: IC.eye, onClick: r => U.openQuoteDoc(r.id) }, { tt: 'WhatsApp', icon: IC.wa, cls: 'qx-ib-ok', onClick: r => U.openQuoteDoc(r.id) }],
    rowMenu: r => [
      { label: 'Open / send', icon: IC.eye, onClick: r => U.openQuoteDoc(r.id) },
      { label: 'Edit', icon: IC.edit, onClick: r => U.openQuoteEditor(r.cust, { quoteId: r.id }) },
      { label: 'Duplicate', icon: IC.copy, onClick: r => { const n = M.duplicateQuote(r.id); invalidate(); QLX.refresh(); U.openQuoteEditor(r.cust, { quoteId: n.id }); } },
      { label: 'Revise', icon: IC.edit, onClick: r => { const n = M.reviseQuote(r.id); invalidate(); QLX.refresh(); U.openQuoteEditor(r.cust, { quoteId: n.id }); } },
      { label: 'Record order', icon: IC.truck, onClick: r => U.openRecordOrder(r.cust, { quoteId: r.id }) },
      { label: 'Customer profile', icon: IC.eye, onClick: r => location.href = profile(r.cust) },
      { divider: true },
      { label: 'Delete draft', icon: IC.trash, cls: 'del', onClick: r => { const x = M.removeQuote(r.id); if (x && x.ok === false) toast(x.reason, 'err'); invalidate(); QLX.refresh(); } }
    ],
    onOpen: r => { U.openQuoteDoc(r.id); return true; },
    card: r => ({ id: r.id, title: esc(r.no), amount: fC(r.total), party: r.custName, partySub: r.firstProduct + ' · ' + r.tonnes + ' MT @ ' + fC(r.firstRate), status: qPill(r.st), chips: [`<span class="qx-tag">${Q.fDS(r.date)}</span>`, `<span class="qx-tag">valid ${Q.fDS(r.validUntil)}</span>`], rows: [['Total', fC(r.total)], ['Valid until', Q.fDS(r.validUntil)]] }),
    footer: rs => [{ label: 'Quotations', value: rs.length }, { label: 'Value', value: fC(rs.reduce((a, r) => a + r.total, 0)), strong: true }, { label: 'Tonnage', value: rs.reduce((a, r) => a + r.tonnes, 0).toLocaleString('en-IN') + ' MT' }]
  };
}

/* ═══════════════════════ 5. OFFERS ═══════════════════════ */
function offerRows() {
  const cs = rows(); const t = today();
  return Q.state.OFFERS.filter(o => !o._del).map(o => { const c = cs.find(x => x.id === o.cust) || {}; const st = (o.status === 'sent' || o.status === 'saved') && o.validUntil && o.validUntil < t ? 'expired' : (o.status || 'sent'); return Object.assign({}, o, { custName: c.name || '—', st, stL: C.labelOf(C.OFFER_STATUS, st), value: (+o.qty || 0) * (+o.rate || 0) }); });
}
function offersCfg() {
  return {
    active: 'customers', stateKey: 'cu_offers', title: 'Price Offers', accent: 'blue', noun: 'offer', nounPl: 'offers', icon: IC.share,
    data: () => offerRows(), rowId: r => r.id, comments: false, dateField: r => r.date,
    subtitle: () => { const rs = offerRows(); return `${rs.filter(r => r.st === 'sent').length} live offers · ${rs.filter(r => r.st === 'accepted').length} accepted`; },
    primary: { label: 'Send price offer', icon: IC.plus, onClick: () => U.openOffer(null) },
    emptySub: 'A price offer is the fast way — product, quantity, rate, send on WhatsApp.',
    views: ['table', 'cards'], banner: () => tabsHTML(),
    stats: () => { const rs = offerRows(); return [
      { label: 'Live offers', value: rs.filter(r => r.st === 'sent').length, sub: 'sent, within validity', tint: 'blue', icon: IC.share },
      { label: 'Accepted', value: rs.filter(r => r.st === 'accepted').length, sub: 'turned into orders', tint: 'green', icon: IC.check },
      { label: 'Expired', value: rs.filter(r => r.st === 'expired').length, sub: 'no answer in time', tint: 'slate', icon: IC.clock },
      { label: 'Avg offered rate', value: rs.length ? fC(rs.reduce((a, r) => a + r.rate, 0) / rs.length) + '/MT' : '—', sub: 'all offers', tint: 'violet', icon: IC.an }
    ]; },
    quickFilters: [{ key: 'all', label: 'All', test: () => true }, { key: 'live', label: 'Live', test: r => r.st === 'sent' }, { key: 'accepted', label: 'Accepted', test: r => r.st === 'accepted' }, { key: 'expired', label: 'Expired', test: r => r.st === 'expired' }],
    search: (r, q) => (r.no + ' ' + r.custName + ' ' + (r.product || '')).toLowerCase().includes(q),
    filters: [{ key: 'product', label: 'Product', options: rs => [...new Set(rs.map(r => r.product))].filter(Boolean).map(p => [p, p]), test: (r, v) => r.product === v }],
    groupBy: [{ key: 'st', label: 'Status', of: r => r.st, title: r => r.stL, dot: r => (QSTATUS_TONE[r.st] || [])[1] }],
    sortDefault: { key: 'date', dir: 'desc' },
    columns: [
      { key: 'no', label: 'No.', sort: true, cell: r => `<b>${esc(r.no)}</b>` },
      { key: 'date', label: 'Date', sort: true, cell: r => Q.fDS(r.date) },
      { key: 'custName', label: 'Customer', sort: true, cell: r => `<a class="cu-link" href="${profile(r.cust)}">${esc(r.custName)}</a>` },
      { key: 'product', label: 'Product', sort: true, cell: r => esc(r.product || '') },
      { key: 'qty', label: 'Qty', sort: true, num: true, cell: r => r.qty ? r.qty + ' ' + (r.unit || 'MT') : '—' },
      { key: 'rate', label: 'Offer price', sort: true, num: true, cell: r => `<span class="qx-num qx-strong">${fC(r.rate)}/MT</span>` },
      { key: 'freight', label: 'Freight', cell: r => esc(C.labelOf(C.FREIGHT, r.freight)) },
      { key: 'validUntil', label: 'Valid until', sort: true, cell: r => Q.fDS(r.validUntil) },
      { key: 'via', label: 'Sent by', cell: r => esc(r.via || '—') },
      { key: 'st', label: 'Status', sort: true, cell: r => qPill(r.st, C.OFFER_STATUS) },
      { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
    ],
    rowActions: r => [{ tt: 'Resend on WhatsApp', icon: IC.wa, cls: 'qx-ib-ok', onClick: r => U.openComposer(r.cust, { channel: 'whatsapp', templateId: 'tpl_offer', vars: C.templateVars({ customer: M.byId(r.cust), offer: r, company: U.coProfile() }), ref: { type: 'offer', id: r.id } }) }, { tt: 'Record order', icon: IC.truck, onClick: r => U.openRecordOrder(r.cust, { offerId: r.id }) }],
    rowMenu: r => [
      { label: 'Mark accepted', icon: IC.check, onClick: r => { M.setOfferStatus(r.id, 'accepted'); invalidate(); QLX.refresh(); } },
      { label: 'Mark rejected', icon: IC.x, onClick: r => { M.setOfferStatus(r.id, 'rejected'); invalidate(); QLX.refresh(); } },
      { label: 'Turn into quotation', icon: IC.doc2, onClick: r => U.openQuoteEditor(r.cust, { offerId: r.id }) },
      { label: 'Print / PDF', icon: IC.print, onClick: r => U.printHTML(QuoteDoc.offerHTML(r, M.byId(r.cust), U.coProfile()), 'Price offer ' + r.no) },
      { label: 'Customer profile', icon: IC.eye, onClick: r => location.href = profile(r.cust) }
    ],
    onOpen: r => { U.printHTML(QuoteDoc.offerHTML(r, M.byId(r.cust), U.coProfile()), 'Price offer ' + r.no); return true; },
    card: r => ({ id: r.id, title: esc(r.no), amount: fC(r.rate) + '/MT', party: r.custName, partySub: (r.product || '') + (r.qty ? ' · ' + r.qty + ' MT' : ''), status: qPill(r.st, C.OFFER_STATUS), rows: [['Valid until', Q.fDS(r.validUntil)], ['Freight', C.labelOf(C.FREIGHT, r.freight)]] })
  };
}

const CFG = { customers: customersCfg, pipeline: pipelineCfg, followups: followupsCfg, quotes: quotesCfg, offers: offersCfg };

/* ── mount ── */
QLX.mount(CFG[TAB]());
Q.init(() => {});   // QLX registered the paint driver; make sure ids/codes exist once data is in
const onReady = () => { try { if (M.ensureIds()) invalidate(); } catch (_) {} setTimeout(wireTabs, 0); };
document.addEventListener('crm:changed', () => { invalidate(); QLX.refresh(); setTimeout(wireTabs, 0); });
window.addEventListener('ql:data', onReady);
setTimeout(onReady, 300);
/* the tab strip lives inside the register's banner, so it is re-rendered on
   every refresh — re-wire after each paint */
const _obs = new MutationObserver(() => { if (document.querySelector('.cu-tab') && !document.querySelector('.cu-tab').dataset.wired) { document.querySelectorAll('.cu-tab').forEach(b => b.dataset.wired = '1'); wireTabs(); } });
_obs.observe(document.getElementById('ql-page') || document.body, { childList: true, subtree: true });
document.addEventListener('click', e => { const b = e.target.closest('[data-open-quote]'); if (b) { e.preventDefault(); e.stopPropagation(); U.openQuoteDoc(b.dataset.openQuote); } }, true);
