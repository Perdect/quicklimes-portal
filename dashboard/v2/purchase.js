/* ═══════════════════════════════════════════════════════════════
   Purchase Register — premium ERP page (Linear/Zoho-style)
   Summary cards · sticky filters · rich table with inline status,
   quick actions, expandable rows, PDF drawer, attachments, payment
   history, per-bill AI insights, sticky totals footer.
   ═══════════════════════════════════════════════════════════════ */
QLShell.mount({ active: 'purchase', title: 'Purchase Register' });
const Q = window.QLD, fC = Q.fC, fmt = Q.fmt;
const $ = s => document.querySelector(s);
const esc = s => (s == null ? '' : s).toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GCOL = { limestone: ['#f6f0e4', '#8a6d3b'], petcoke: ['#fdeceb', '#c0392b'], packaging: ['#eaf1ff', '#2f5fd0'], labour: ['#e9f9ee', '#1c7c3a'], maintenance: ['#f2eefb', '#6b3fa0'], utilities: ['#fff5e0', '#b7791f'], office: ['#eef2f7', '#475569'], other: ['#f1f5f9', '#64748b'] };
const AVG = ['#0891B2,#155E75', '#7C3AED,#5B21B6', '#16A34A,#15803D', '#F59E0B,#B45309', '#DB2777,#9D174D', '#2563EB,#1D4ED8'];
const PER = 15;
const pF = { group: 'all', item: 'all', sup: 'all', dept: 'all', gst: 'all', status: 'all', from: '', to: '' };
let pQuery = '', pSort = { key: 'date', dir: 'desc' }, pPage = 1, advOpen = false;
const expanded = new Set();
let hiddenCols; try { hiddenCols = new Set(JSON.parse(localStorage.getItem('pr_cols_hidden') || 'null') || ['dept', 'dueDate', 'createdBy']); } catch (_) { hiddenCols = new Set(['dept', 'dueDate', 'createdBy']); }

let _tt; function toast(m, tone) { const el = $('#prToast'); el.textContent = m; el.className = 'fin-toast ' + (tone || ''); el.hidden = false; clearTimeout(_tt); _tt = setTimeout(() => { el.hidden = true; }, 2600); }
const fDS = d => Q.fDS(d);

/* ── Attachments (IndexedDB, per browser) ── */
const ADB = 'ql_pur_docs'; let _adb = null;
function adb() { if (_adb) return _adb; _adb = new Promise((res, rej) => { const r = indexedDB.open(ADB, 1); r.onupgradeneeded = e => { const d = e.target.result; if (!d.objectStoreNames.contains('f')) d.createObjectStore('f'); }; r.onsuccess = e => res(e.target.result); r.onerror = () => rej(r.error); }); return _adb; }
function aOp(mode, fn) { return adb().then(d => new Promise((res, rej) => { const t = d.transaction('f', mode), o = fn(t.objectStore('f')); t.oncomplete = () => res(o && o.result !== undefined ? o.result : o); t.onerror = () => rej(t.error); })); }
async function addAttach(idx, file, kind) {
  const id = 'pa' + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);
  await aOp('readwrite', st => st.put(file, id));
  const p = Q.state.PURCHASES[idx]; const attach = (p.attach || []).concat([{ id, name: file.name, type: file.type || '', kind: kind || 'Invoice', size: file.size, at: new Date().toISOString() }]);
  Q.updatePurchase(idx, { attach });
}
async function openAttach(a, dl) { const b = await aOp('readonly', st => st.get(a.id)); if (!b) { toast('File not found in this browser', 'err'); return; } const url = URL.createObjectURL(b); if (dl) { const x = document.createElement('a'); x.href = url; x.download = a.name; x.click(); } else window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 4000); }
async function delAttach(idx, id) { const p = Q.state.PURCHASES[idx]; Q.updatePurchase(idx, { attach: (p.attach || []).filter(a => a.id !== id) }); try { await aOp('readwrite', st => st.delete(id)); } catch (_) {} }

/* ── Supplier contact lookup ── */
function supContact(name) { const p = Q.partyRows().find(x => (x.name || '').toUpperCase() === (name || '').toUpperCase()); return p || {}; }
function waLink(phone, text) { const d = (phone || '').replace(/\D/g, ''); const n = d.length === 10 ? '91' + d : d; return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text); }

/* ── Columns ── */
const ALLCOLS = [
  { key: 'sr', label: '#' }, { key: 'bill', label: 'Bill No', sort: 1 }, { key: 'date', label: 'Bill Date', sort: 1 },
  { key: 'sup', label: 'Supplier', sort: 1 }, { key: 'item', label: 'Purchase Item', sort: 1 },
  { key: 'dept', label: 'Department', sort: 1, opt: 1 }, { key: 'grate', label: 'GST', sort: 1, num: 1 },
  { key: 'taxable', label: 'Taxable', sort: 1, num: 1 }, { key: 'freightAmt', label: 'Freight', sort: 1, num: 1 },
  { key: 'total', label: 'Total', sort: 1, num: 1 }, { key: 'status', label: 'Status', sort: 1 },
  { key: 'dueDate', label: 'Due Date', sort: 1, opt: 1 }, { key: 'createdBy', label: 'Created By', opt: 1 }, { key: 'actions', label: '' }
];
const visCols = () => ALLCOLS.filter(c => !hiddenCols.has(c.key));

/* ── Filtering ── */
function filtered() {
  let r = Q.purchaseRows();
  if (pF.group !== 'all') r = r.filter(x => x.group === pF.group);
  if (pF.item !== 'all') r = r.filter(x => x.item === pF.item);
  if (pF.sup !== 'all') r = r.filter(x => x.sup === pF.sup);
  if (pF.dept !== 'all') r = r.filter(x => x.dept === pF.dept);
  if (pF.gst !== 'all') r = r.filter(x => String(x.grate) === pF.gst);
  if (pF.status !== 'all') r = r.filter(x => pF.status === 'overdue' ? x.isOverdue : x.status === pF.status);
  if (pF.from) r = r.filter(x => (x.date || '') >= pF.from);
  if (pF.to) r = r.filter(x => (x.date || '') <= pF.to);
  if (pQuery) { const q = pQuery.toLowerCase(); r = r.filter(x => (x.bill + ' ' + x.sup + ' ' + x.item + ' ' + x.groupLabel + ' ' + x.gstin + ' ' + x.dept).toLowerCase().includes(q)); }
  r.sort((a, b) => { let x = a[pSort.key], y = b[pSort.key]; if (typeof x === 'string') { x = x.toLowerCase(); y = (y || '').toLowerCase(); } return x < y ? (pSort.dir === 'asc' ? -1 : 1) : x > y ? (pSort.dir === 'asc' ? 1 : -1) : 0; });
  return r;
}

/* ── Summary cards ── */
function cardsHTML() {
  const rows = Q.purchaseRows(), s = Q.purchaseSummary(), i = Q.purchaseInsights();
  const paid = rows.reduce((a, r) => a + r.paid, 0);
  const now = new Date(), ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const thisMonth = rows.filter(r => (r.date || '').slice(0, 7) === ym).reduce((a, r) => a + r.taxable, 0);
  const trend = i.momPct == null ? '' : `<span class="prcard-tr ${i.momPct >= 0 ? 'up' : 'dn'}">${i.momPct >= 0 ? '▲' : '▼'} ${Math.abs(i.momPct).toFixed(0)}%</span>`;
  const C = [
    { k: 'bills', label: 'Total Bills', v: s.count, sub: rows.filter(r => r.isOverdue).length + ' overdue', ic: '📄', tone: 'brand' },
    { k: 'tot', label: 'Total Purchases', v: fC(s.total), sub: 'excl. GST', ic: '🛒', tone: 'amber' },
    { k: 'itc', label: 'GST Input Credit', v: fC(s.itc), sub: 'available ITC', ic: '🧾', tone: 'ok' },
    { k: 'pend', label: 'Pending Payment', v: fC(s.pending), sub: i.pendCount + ' supplier' + (i.pendCount === 1 ? '' : 's'), ic: '⏳', tone: 'red' },
    { k: 'paid', label: 'Paid Amount', v: fC(paid), sub: 'settled to date', ic: '✅', tone: 'ok' },
    { k: 'month', label: 'This Month', v: fC(thisMonth), sub: 'purchases ' + trend, ic: '📅', tone: 'indigo' }
  ];
  return C.map(c => `<div class="prcard prcard-${c.tone}">
    <div class="prcard-ic">${c.ic}</div>
    <div class="prcard-b"><div class="prcard-l">${c.label}</div><div class="prcard-v">${c.v}</div><div class="prcard-s">${c.sub}</div></div>
  </div>`).join('');
}

/* ── Filter dropdowns ── */
function opt(v, l, sel) { return `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`; }
function fillFilters() {
  const rows = Q.purchaseRows(), G = Q.purchaseGroups;
  $('#pfGroup').innerHTML = opt('all', 'All groups', pF.group) + G.filter(g => rows.some(r => r.group === g.key)).map(g => opt(g.key, g.emoji + ' ' + g.label, pF.group)).join('');
  $('#pfStatus').innerHTML = ['all', 'pending', 'partial', 'paid', 'overdue', 'cancelled'].map(s => opt(s, s === 'all' ? 'All status' : s[0].toUpperCase() + s.slice(1), pF.status)).join('');
  const itemPool = pF.group !== 'all' ? (G.find(g => g.key === pF.group) || { items: [] }).items : [...new Set(rows.map(r => r.item))];
  $('#pfItem').innerHTML = opt('all', 'All items', pF.item) + itemPool.map(it => opt(it, it, pF.item)).join('');
  $('#pfSup').innerHTML = opt('all', 'All suppliers', pF.sup) + [...new Set(rows.map(r => r.sup))].filter(s => s && s !== '—').sort().map(s => opt(s, s, pF.sup)).join('');
  $('#pfDept').innerHTML = opt('all', 'All departments', pF.dept) + Q.departments.filter(d => rows.some(r => r.dept === d)).map(d => opt(d, d, pF.dept)).join('');
  $('#pfGst').innerHTML = opt('all', 'All GST', pF.gst) + [...new Set(rows.map(r => r.grate))].sort((a, b) => a - b).map(g => opt(g, g + '% GST', pF.gst)).join('');
  $('#pfFrom').value = pF.from; $('#pfTo').value = pF.to;
  const any = pF.group !== 'all' || pF.item !== 'all' || pF.sup !== 'all' || pF.dept !== 'all' || pF.gst !== 'all' || pF.status !== 'all' || pF.from || pF.to || pQuery;
  $('#pfReset').hidden = !any;
  $('#pfColsMenu').innerHTML = ALLCOLS.filter(c => c.opt).map(c => `<label class="prf-col-o"><input type="checkbox" data-col="${c.key}" ${hiddenCols.has(c.key) ? '' : 'checked'}> ${c.label}</label>`).join('');
  $('#pfColsMenu').querySelectorAll('input').forEach(inp => inp.onchange = () => { inp.checked ? hiddenCols.delete(inp.dataset.col) : hiddenCols.add(inp.dataset.col); localStorage.setItem('pr_cols_hidden', JSON.stringify([...hiddenCols])); render(); });
}

/* ── Table cell rendering ── */
const STATUSES = ['pending', 'partial', 'paid', 'cancelled'];
function cell(col, r, sr) {
  switch (col.key) {
    case 'sr': return `<td class="prt-sr">${sr}</td>`;
    case 'bill': return `<td><span class="prt-bill">${esc(r.bill || '—')}</span></td>`;
    case 'date': return `<td class="prt-mut">${fDS(r.date)}</td>`;
    case 'sup': { const c = AVG[(r.sup.charCodeAt(0) + r.sup.length) % AVG.length]; return `<td><div class="prt-sup"><span class="prt-av" style="background:linear-gradient(135deg,${c})">${(r.sup || '?').charAt(0).toUpperCase()}</span><span class="prt-sup-n">${esc(r.sup)}</span></div></td>`; }
    case 'item': return `<td><span class="prt-item"><span class="prt-item-ic">${r.itemIconEmoji || r.emoji || '📦'}</span>${esc(r.item)}</span>${r.freight ? ' <span class="pg-frt">freight</span>' : ''}</td>`;
    case 'group': { const gc = GCOL[r.group] || GCOL.other; return `<td><span class="prt-gp" style="background:${gc[0]};color:${gc[1]}">${r.emoji} ${esc(r.groupLabel)}</span></td>`; }
    case 'dept': return `<td><span class="prt-dept">${esc(r.dept || '—')}</span></td>`;
    case 'grate': return `<td class="prt-num prt-mut">${r.grate}%</td>`;
    case 'taxable': return `<td class="prt-num">${fC(r.taxable)}</td>`;
    case 'freightAmt': return `<td class="prt-num" style="color:${r.freightAmt ? '#b7791f' : 'var(--ql-text-muted)'}">${r.freightAmt ? '🚚 ' + fC(r.freightAmt) : '—'}</td>`;
    case 'total': return `<td class="prt-num prt-tot">${fC(r.total)}</td>`;
    case 'status': { const st = r.isOverdue ? 'overdue' : r.status; return `<td class="prt-st-cell"><select class="prt-st s-${st}" data-st="${r.idx}" onclick="event.stopPropagation()">${STATUSES.map(s => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${r.isOverdue && s === 'pending' ? 'Overdue' : s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></td>`; }
    case 'dueDate': return `<td class="prt-mut ${r.isOverdue ? 'prt-over' : ''}">${r.dueDate ? fDS(r.dueDate) : '—'}</td>`;
    case 'createdBy': return `<td class="prt-mut">${esc(r.createdBy)}</td>`;
    case 'actions': return `<td class="prt-act">${actionsHTML(r)}</td>`;
  }
  return '<td></td>';
}
function ic(path) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`; }
function actionsHTML(r) {
  const b = (title, fn, path, cls) => `<button class="prt-ib ${cls || ''}" title="${title}" onclick="event.stopPropagation();${fn}">${ic(path)}</button>`;
  return `<div class="prt-acts">
    ${b('Preview PDF', `pdfDrawer(${r.idx})`, '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>')}
    ${b('Edit bill', `QLShell.openPurchaseForm(${r.idx})`, '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>')}
    ${r.status !== 'paid' && r.status !== 'cancelled' ? b('Mark paid', `markPaid(${r.idx})`, '<path d="M20 6L9 17l-5-5"/>', 'prt-ib-ok') : ''}
    <div class="prt-more"><button class="prt-ib" title="More" onclick="event.stopPropagation();toggleMore(${r.idx},this)">${ic('<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>')}</button></div>
    <button class="prt-ib prt-chev" title="Details" onclick="event.stopPropagation();toggleRow(${r.idx})">${ic('<polyline points="6 9 12 15 18 9"/>')}</button>
  </div>`;
}
let _moreEl = null;
function toggleMore(idx, btn) {
  if (_moreEl) { _moreEl.remove(); const was = _moreEl._idx; _moreEl = null; if (was === idx) return; }
  const r = Q.purchaseRows()[idx]; const m = document.createElement('div'); m.className = 'prt-menu'; m._idx = idx;
  const item = (label, fn, path) => `<button onclick="${fn};closeMore()">${ic(path)} ${label}</button>`;
  m.innerHTML =
    item('Duplicate', `dupBill(${idx})`, '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>') +
    item('Download PDF', `pdfWindow(${idx})`, '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>') +
    item('Print', `pdfWindow(${idx})`, '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>') +
    item('Share', `shareBill(${idx})`, '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/>') +
    item('Copy link', `copyLink(${idx})`, '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>') +
    `<div class="prt-menu-div"></div>` +
    item('Delete', `delBill(${idx})`, '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>');
  m.querySelector('.prt-menu-div').nextElementSibling.classList.add('prt-menu-del');
  document.body.appendChild(m); const rc = btn.getBoundingClientRect();
  m.style.top = (rc.bottom + 6) + 'px'; m.style.left = Math.min(rc.left, window.innerWidth - 190) + 'px';
  _moreEl = m;
}
function closeMore() { if (_moreEl) { _moreEl.remove(); _moreEl = null; } }
document.addEventListener('click', e => { if (_moreEl && !e.target.closest('.prt-menu') && !e.target.closest('.prt-more')) closeMore(); });

/* ── Expandable row (Linear-style) ── */
function expandHTML(r) {
  const co = supContact(r.sup);
  const ins = Q.billInsights(r.idx), rel = Q.relatedBills(r.idx);
  const phone = co.phone || '';
  const commHTML = `<div class="pex-comm">
    ${phone ? `<a class="pex-c wa" href="${waLink(phone, 'Regarding bill ' + (r.bill || '') + ' — ' + r.item)}" target="_blank">${ic('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>')} WhatsApp</a>` : ''}
    ${phone ? `<a class="pex-c call" href="tel:${esc(phone)}">${ic('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1.05.4 2.05.8 3a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.95.4 1.95.67 3 .8A2 2 0 0 1 22 16.92z"/>')} Call</a>` : ''}
    ${co.email ? `<a class="pex-c mail" href="mailto:${esc(co.email)}">${ic('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>')} Email</a>` : ''}
    ${!phone && !co.email ? '<span class="pex-mut">No saved supplier contact — add it in All Parties.</span>' : ''}
  </div>`;
  const kv = (l, v) => `<div class="pex-kv"><span>${l}</span><b>${v}</b></div>`;
  const attachRows = (r.attach || []).map(a => `<div class="pex-att"><span class="pex-att-n">${esc(a.name)}</span><span class="pex-att-k">${esc(a.kind)}</span><button onclick="openAttach2(${r.idx},'${a.id}',0)">View</button><button onclick="openAttach2(${r.idx},'${a.id}',1)">↓</button><button class="pex-att-x" onclick="rmAttach(${r.idx},'${a.id}')">×</button></div>`).join('') || '<div class="pex-mut">No documents attached yet.</div>';
  const payHist = (r.payments || []).length ? r.payments.map(p => `<div class="pex-pay"><span>${fDS(p.date)} · ${esc(p.mode)}</span><b>${fC(p.amount)}</b></div>`).join('') : '<div class="pex-mut">No payments recorded.</div>';
  const relList = arr => arr.length ? arr.map(x => `<button class="pex-rel" onclick="jumpBill(${x.idx})">${x.itemIconEmoji} ${esc(x.item)} · ${fC(x.taxable)}</button>`).join('') : '<span class="pex-mut">None</span>';
  const G = Q.purchaseGroups, curG = G.find(g => g.key === r.group) || G[0];
  return `<div class="pex">
    <div class="pex-grid">
      <div class="pex-col">
        <div class="pex-h">Supplier</div>
        <div class="pex-sup">${esc(r.sup)}</div>
        <div class="pex-mut">${r.gstin ? 'GSTIN ' + esc(r.gstin) : 'No GSTIN on file'}${co.phone ? ' · ' + esc(co.phone) : ''}</div>
        ${commHTML}
        <div class="pex-h" style="margin-top:16px">Payment</div>
        <div class="pex-pay-top">${r.outstanding > 0 ? `<span class="pex-out">Outstanding <b>${fC(r.outstanding)}</b></span>` : `<span class="pex-paid">Fully paid ✓</span>`}</div>
        ${r.status !== 'paid' && r.status !== 'cancelled' ? `<div class="pex-payform">
          <input type="number" id="pay_amt_${r.idx}" placeholder="Amount" value="${r.outstanding}">
          <select id="pay_mode_${r.idx}"><option value="bank">Bank</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="cheque">Cheque</option></select>
          <button class="ql-btn ql-btn-primary" onclick="recPay(${r.idx})">Record payment</button>
        </div>` : ''}
        <div class="pex-payhist">${payHist}</div>
      </div>
      <div class="pex-col">
        <div class="pex-h">Bill details <button class="pex-edit" onclick="editToggle(${r.idx})">Edit</button></div>
        <div id="pex_view_${r.idx}">
          ${kv('Invoice / Bill No', esc(r.bill || '—'))}${kv('Bill date', fDS(r.date))}${kv('Due date', r.dueDate ? fDS(r.dueDate) : '—')}
          ${kv('Group · Item', r.emoji + ' ' + esc(r.groupLabel) + ' → ' + esc(r.item))}${kv('Department', esc(r.dept || '—'))}${kv('Created by', esc(r.createdBy))}
        </div>
        <div id="pex_edit_${r.idx}" hidden class="pex-form">
          <label>Purchase Group<select id="ed_group_${r.idx}" onchange="edItems(${r.idx})">${G.map(g => `<option value="${g.key}" ${g.key === r.group ? 'selected' : ''}>${g.emoji} ${g.label}</option>`).join('')}</select></label>
          <label>Purchase Item<select id="ed_item_${r.idx}">${curG.items.map(it => `<option ${it === r.item ? 'selected' : ''}>${esc(it)}</option>`).join('')}</select></label>
          <label>Supplier<input id="ed_sup_${r.idx}" value="${esc(r.sup)}"></label>
          <label>Department<select id="ed_dept_${r.idx}">${Q.departments.map(d => `<option ${d === r.dept ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          <label>GST %<input type="number" id="ed_gst_${r.idx}" value="${r.grate}"></label>
          <label>Bill date<input type="date" id="ed_date_${r.idx}" value="${esc(r.date)}"></label>
          <label>Due date<input type="date" id="ed_due_${r.idx}" value="${esc(r.dueDate)}"></label>
          <label class="pex-full">Remarks<textarea id="ed_rem_${r.idx}" rows="2">${esc(r.remarks)}</textarea></label>
          <button class="ql-btn ql-btn-primary pex-full" onclick="saveEdit(${r.idx})">Save changes</button>
        </div>
      </div>
      <div class="pex-col">
        <div class="pex-h">Purchase breakdown</div>
        ${kv('Taxable value', fC(r.taxable))}${r.freightAmt ? kv('Freight / transport', '🚚 ' + fC(r.freightAmt)) : ''}${kv('GST @ ' + r.grate + '%', fC(r.gst))}${kv('ITC', r.itc ? fC(r.itc) : '—')}
        <div class="pex-kv pex-kv-tot"><span>Total</span><b>${fC(r.total)}</b></div>
        <div class="pex-h" style="margin-top:14px">✨ AI insights</div>
        <div class="pex-ai">${ins.map(x => `<div class="pex-ai-i t-${x.tone}"><span class="pex-ai-d"></span>${esc(x.text)}</div>`).join('')}</div>
        <div class="pex-h" style="margin-top:14px">Related in ${r.emoji} ${esc(r.groupLabel)}</div>
        <div class="pex-rels">${relList(rel.freight.concat(rel.royalty).length ? rel.freight.concat(rel.royalty) : rel.group.slice(0, 4))}</div>
      </div>
    </div>
    <div class="pex-att-sec">
      <div class="pex-h">Attachments <span class="pex-mut2">Invoice · Scan · Transport slip · Royalty receipt · Weighbridge · Photos</span></div>
      <label class="pex-drop" id="pex_drop_${r.idx}">
        <select id="pex_kind_${r.idx}" onclick="event.stopPropagation()"><option>Invoice PDF</option><option>Scanned Invoice</option><option>Transport Slip</option><option>Royalty Receipt</option><option>Weighbridge Slip</option><option>Photo</option><option>Other</option></select>
        <span class="pex-drop-t">${ic('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>')} Drop files or click to upload</span>
        <input type="file" id="pex_file_${r.idx}" multiple hidden>
      </label>
      <div class="pex-atts">${attachRows}</div>
    </div>
  </div>`;
}

function render() {
  const co = Q.co, s = Q.purchaseSummary();
  $('#prCards').innerHTML = cardsHTML();
  $('#prSub').innerHTML = `<b>${esc(co.short)}</b> · ${s.count} bills · <b>${fC(s.total)}</b> purchase value`;
  fillFilters();
  const cols = visCols();
  $('#prHead').innerHTML = '<tr>' + cols.map(c => { const st = pSort.key === c.key; return `<th class="${c.num ? 'prt-num' : ''} ${c.sort ? 'prt-sortable' : ''} ${st ? 'sorted' : ''}" ${c.sort ? `data-sort="${c.key}"` : ''}>${esc(c.label)}${c.sort ? `<span class="prt-sic">${st ? (pSort.dir === 'asc' ? '↑' : '↓') : ''}</span>` : ''}</th>`; }).join('') + '</tr>';
  $('#prHead').querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => { const k = th.dataset.sort; if (pSort.key === k) pSort.dir = pSort.dir === 'asc' ? 'desc' : 'asc'; else { pSort.key = k; pSort.dir = 'asc'; } pPage = 1; render(); });
  const rows = filtered(), pages = Math.max(1, Math.ceil(rows.length / PER)); pPage = Math.min(pPage, pages);
  const slice = rows.slice((pPage - 1) * PER, pPage * PER);
  let html = '';
  slice.forEach((r, i) => {
    const sr = (pPage - 1) * PER + i + 1, isE = expanded.has(r.idx);
    html += `<tr class="prt-row ${isE ? 'open' : ''}" data-idx="${r.idx}">` + cols.map(c => cell(c, r, sr)).join('') + '</tr>';
    if (isE) html += `<tr class="prt-exp-row"><td colspan="${cols.length}">${expandHTML(r)}</td></tr>`;
  });
  $('#prBody').innerHTML = html || `<tr><td colspan="${cols.length}"><div class="sr-empty" style="padding:40px">${ic('<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/>')}<div style="font-weight:600;color:var(--ql-text-secondary);margin-top:8px">No bills in this view</div></div></td></tr>`;
  wireRows();
  $('#prCount').textContent = rows.length ? `Showing ${(pPage - 1) * PER + 1}–${Math.min(pPage * PER, rows.length)} of ${rows.length}` : '0 bills';
  $('#prPage').textContent = `${pPage} / ${pages}`; $('#prPrev').disabled = pPage <= 1; $('#prNext').disabled = pPage >= pages;
  // sticky footer totals (filtered)
  const t = rows.reduce((a, r) => ({ tax: a.tax + r.taxable, frt: a.frt + r.freightAmt, gst: a.gst + r.gst, tot: a.tot + r.total, paid: a.paid + r.paid, out: a.out + r.outstanding }), { tax: 0, frt: 0, gst: 0, tot: 0, paid: 0, out: 0 });
  $('#prFoot').innerHTML = [['Taxable', t.tax], ['Freight', t.frt], ['GST', t.gst], ['Grand Total', t.tot, 1], ['Paid', t.paid], ['Pending', t.out]].map(([l, v, b]) => `<div class="prfoot-c ${b ? 'prfoot-strong' : ''}"><span>${l}</span><b>${fC(v)}</b></div>`).join('');
  QLShell.paintWorkspace();
}
function wireRows() {
  $('#prBody').querySelectorAll('.prt-row').forEach(tr => tr.addEventListener('click', e => { if (e.target.closest('button,select,input,a,.prt-menu')) return; toggleRow(+tr.dataset.idx); }));
  $('#prBody').querySelectorAll('.prt-st').forEach(sel => sel.onchange = () => setStatus(+sel.dataset.st, sel.value));
  $('#prBody').querySelectorAll('[id^="pex_drop_"]').forEach(drop => {
    const idx = +drop.id.split('_')[2], file = $('#pex_file_' + idx);
    drop.addEventListener('click', e => { if (!e.target.closest('select')) file.click(); });
    file.onchange = () => handleFiles(idx, [...file.files]);
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) handleFiles(idx, [...e.dataTransfer.files]); });
  });
}

/* ── Row actions ── */
function toggleRow(idx) { expanded.has(idx) ? expanded.delete(idx) : expanded.add(idx); render(); }
function setStatus(idx, val) { const r = Q.purchaseRows()[idx]; const patch = { status: val }; if (val === 'paid') patch.paid = r.total; else if (val === 'pending') patch.paid = 0; Q.updatePurchase(idx, patch); toast('Status: ' + val); render(); }
function markPaid(idx) { const r = Q.purchaseRows()[idx]; Q.recordPurchasePayment(idx, r.outstanding, 'bank'); toast('Marked paid', 'ok'); render(); }
function recPay(idx) { const amt = +($('#pay_amt_' + idx) || {}).value || 0, mode = ($('#pay_mode_' + idx) || {}).value || 'bank'; if (!amt) { toast('Enter an amount', 'err'); return; } Q.recordPurchasePayment(idx, amt, mode); toast('Payment recorded', 'ok'); render(); }
function dupBill(idx) { const p = Q.state.PURCHASES[idx]; const copy = Object.assign({}, p, { bill: (p.bill || '') + '-COPY', status: 'pending', paid: 0, payments: [], attach: [] }); Q.addPurchase(copy); toast('Bill duplicated'); render(); }
function delBill(idx) { const r = Q.purchaseRows()[idx]; if (confirm('Delete bill ' + (r.bill || '') + ' from ' + r.sup + '?')) { Q.deletePurchase(idx); expanded.delete(idx); toast('Bill deleted'); render(); } }
function shareBill(idx) { const r = Q.purchaseRows()[idx]; const co = supContact(r.sup); const text = `Purchase bill ${r.bill || ''} — ${r.item} · ${fC(r.total)} · ${r.status}`; window.open(waLink(co.phone || '', text), '_blank'); }
function copyLink(idx) { const r = Q.purchaseRows()[idx]; const text = `${Q.co.short} · Bill ${r.bill || ''} · ${r.sup} · ${r.item} · ${fC(r.total)} · ${r.status}`; (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Bill summary copied'), () => toast('Copy not available', 'err')); }
function jumpBill(idx) { expanded.clear(); expanded.add(idx); pPage = 1; render(); const el = $(`.prt-row[data-idx="${idx}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
async function handleFiles(idx, files) { for (const f of files) { const kind = ($('#pex_kind_' + idx) || {}).value || 'Invoice'; try { await addAttach(idx, f, kind); } catch (e) { toast('Upload failed', 'err'); } } toast(files.length + ' file' + (files.length > 1 ? 's' : '') + ' attached', 'ok'); render(); }
function openAttach2(idx, id, dl) { const a = (Q.state.PURCHASES[idx].attach || []).find(x => x.id === id); if (a) openAttach(a, dl); }
function rmAttach(idx, id) { delAttach(idx, id); render(); }
function editToggle(idx) { const v = $('#pex_view_' + idx), e = $('#pex_edit_' + idx); const show = e.hidden; e.hidden = !show; v.hidden = show; }
function edItems(idx) { const g = Q.purchaseGroups.find(x => x.key === $('#ed_group_' + idx).value) || Q.purchaseGroups[0]; $('#ed_item_' + idx).innerHTML = g.items.map(it => `<option>${esc(it)}</option>`).join(''); }
function saveEdit(idx) {
  const g = $('#ed_group_' + idx).value, patch = { group: g, item: $('#ed_item_' + idx).value, sup: $('#ed_sup_' + idx).value.trim().toUpperCase(), dept: $('#ed_dept_' + idx).value, grate: +$('#ed_gst_' + idx).value || 0, date: $('#ed_date_' + idx).value, dueDate: $('#ed_due_' + idx).value, remarks: $('#ed_rem_' + idx).value };
  Q.updatePurchase(idx, patch); toast('Bill updated', 'ok'); render();
}

/* ── PDF: shared HTML → drawer preview or print window ── */
function billHTML(r) {
  const co = Q.co || {}, cg = r.gst / 2, money = n => '₹' + fmt(n);
  return `<style>*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;color:#0f172a;margin:0;padding:32px;font-size:13px}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:14px}
    .co{font-size:19px;font-weight:800}.mut{color:#64748b;font-size:12px;line-height:1.5}.doc{text-align:right}.doc h1{font-size:15px;margin:0;letter-spacing:2px;color:#2563eb}
    .grid{display:flex;justify-content:space-between;gap:24px;margin:18px 0}.lbl{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#94a3b8;margin-bottom:3px}.nm{font-weight:700;font-size:14px}
    table{width:100%;border-collapse:collapse;margin-top:8px}th,td{padding:9px 10px;text-align:left;border-bottom:1px solid #e2e8f0}th{background:#f8fafc;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#64748b}td.r,th.r{text-align:right}.it{color:#64748b;font-size:11px;margin-top:2px}
    .tot{margin-left:auto;width:280px;margin-top:14px}.tot .row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px}.tot .g{font-weight:800;font-size:16px;border-top:2px solid #0f172a;padding-top:10px;margin-top:4px}
    .pill{display:inline-block;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700}.paid{background:#dcfce7;color:#15803d}.pending,.partial{background:#fef3c7;color:#b45309}.cancelled{background:#fee2e2;color:#b91c1c}
    .ft{margin-top:26px;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:12px}</style>
    <div class="hd"><div><div class="co">${esc(co.name || 'Your Company')}</div><div class="mut">${esc(co.address || '')}${co.gstin ? '<br>GSTIN: ' + esc(co.gstin) : ''}${co.phone ? ' · ' + esc(co.phone) : ''}</div></div>
      <div class="doc"><h1>PURCHASE BILL</h1><div class="mut">Bill No: <b>${esc(r.bill || '—')}</b><br>Date: ${fDS(r.date)}<br><span class="pill ${r.status}">${r.status.toUpperCase()}</span></div></div></div>
    <div class="grid"><div><div class="lbl">Supplier</div><div class="nm">${esc(r.sup)}</div><div class="mut">${r.gstin ? 'GSTIN: ' + esc(r.gstin) : ''}</div></div>
      <div style="text-align:right"><div class="lbl">Department · ITC</div><div class="nm">${esc(r.dept || '—')}</div><div class="mut">ITC: ${r.itc ? 'Eligible' : '—'}</div></div></div>
    <table><thead><tr><th>Purchase Group / Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Taxable</th></tr></thead>
      <tbody><tr><td>${esc(r.emoji + ' ' + r.groupLabel)}<div class="it">${esc(r.item)}${r.desc ? ' — ' + esc(r.desc) : ''}</div></td><td class="r">${r.qty ? fmt(r.qty, 2) + (r.unit ? ' ' + esc(r.unit) : '') : '—'}</td><td class="r">${r.rate ? money(r.rate) : '—'}</td><td class="r">${money(r.taxable)}</td></tr></tbody></table>
    <div class="tot"><div class="row"><span>Taxable value</span><span>${money(r.taxable)}</span></div>${r.freightAmt ? `<div class="row"><span>Freight (incl.)</span><span>${money(r.freightAmt)}</span></div>` : ''}<div class="row"><span>CGST @ ${r.grate / 2}%</span><span>${money(cg)}</span></div><div class="row"><span>SGST @ ${r.grate / 2}%</span><span>${money(cg)}</span></div><div class="row g"><span>Total</span><span>${money(r.total)}</span></div></div>
    <div class="ft">System-generated from ${esc(co.name || 'QuickLimes')} · QuickLimes Purchase Register.</div>`;
}
let _pdfIdx = null;
function pdfDrawer(idx) {
  _pdfIdx = idx; const r = Q.purchaseRows()[idx];
  $('#pdrawer').innerHTML = `<div class="pdrawer-head"><div><div class="pdrawer-t">Bill ${esc(r.bill || '—')}</div><div class="pdrawer-s">${esc(r.sup)} · ${fC(r.total)}</div></div><button class="fin-x" onclick="closeDrawer()">&times;</button></div>
    <div class="pdrawer-bar"><button class="ql-btn ql-btn-secondary" onclick="pdfWindow(${idx})">↓ Download</button><button class="ql-btn ql-btn-secondary" onclick="pdfWindow(${idx})">Print</button><button class="ql-btn ql-btn-secondary" onclick="shareBill(${idx})">Share</button></div>
    <div class="pdrawer-body"><iframe id="pdfFrame" title="bill"></iframe></div>`;
  const f = $('#pdfFrame'); f.srcdoc = billHTML(r);
  $('#pdrawerBack').classList.add('open');
}
function closeDrawer() { $('#pdrawerBack').classList.remove('open'); }
function pdfWindow(idx) { const r = Q.purchaseRows()[idx]; const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to open the PDF'); return; } w.document.write('<html><head><title>Purchase Bill ' + esc(r.bill || '') + '</title></head><body>' + billHTML(r) + '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print()},250)}</scr' + 'ipt></body></html>'); w.document.close(); }
$('#pdrawerBack').addEventListener('click', e => { if (e.target.id === 'pdrawerBack') closeDrawer(); });

/* ── Filter wiring ── */
$('#pfGroup').onchange = e => { pF.group = e.target.value; pF.item = 'all'; pPage = 1; render(); };
$('#pfStatus').onchange = e => { pF.status = e.target.value; pPage = 1; render(); };
$('#pfItem').onchange = e => { pF.item = e.target.value; pPage = 1; render(); };
$('#pfSup').onchange = e => { pF.sup = e.target.value; pPage = 1; render(); };
$('#pfDept').onchange = e => { pF.dept = e.target.value; pPage = 1; render(); };
$('#pfGst').onchange = e => { pF.gst = e.target.value; pPage = 1; render(); };
$('#pfFrom').onchange = e => { pF.from = e.target.value; pPage = 1; render(); };
$('#pfTo').onchange = e => { pF.to = e.target.value; pPage = 1; render(); };
$('#prSearch').oninput = e => { pQuery = e.target.value; pPage = 1; render(); };
$('#pfMore').onclick = () => { advOpen = !advOpen; $('#prfAdv').hidden = !advOpen; $('#pfMore').classList.toggle('on', advOpen); };
$('#pfCols').onclick = e => { e.stopPropagation(); $('#pfColsMenu').hidden = !$('#pfColsMenu').hidden; };
document.addEventListener('click', e => { if (!e.target.closest('.prf-cols-wrap')) $('#pfColsMenu').hidden = true; });
$('#pfReset').onclick = () => { Object.assign(pF, { group: 'all', item: 'all', sup: 'all', dept: 'all', gst: 'all', status: 'all', from: '', to: '' }); pQuery = ''; $('#prSearch').value = ''; pPage = 1; render(); };
$('#prPrev').onclick = () => { if (pPage > 1) { pPage--; render(); } };
$('#prNext').onclick = () => { pPage++; render(); };
$('#puReport').onclick = () => { const r = Q.purchaseByGroup(); const R = { title: 'Purchase by Group (landed cost)', headers: ['Group', 'Items', 'Freight', 'Taxable', 'GST', 'Total'], rows: r.map(g => [g.emoji + ' ' + g.label, g.count, g.freight, g.taxable, g.gst, g.total]) }; QLShell.exportCSV(R.title, R.headers, R.rows); toast('Group report exported'); };
$('#puExport').onclick = () => { const r = filtered(); QLShell.exportCSV('purchases_' + (Q.co.short || 'register').replace(/\s+/g, '_'), ['Bill', 'Date', 'Supplier', 'Group', 'Item', 'Department', 'GSTIN', 'GST%', 'Taxable', 'Freight', 'GST', 'ITC', 'Total', 'Paid', 'Status', 'Due'], r.map(x => [x.bill, x.date, x.sup, x.groupLabel, x.item, x.dept, x.gstin, x.grate, x.taxable, x.freightAmt, x.gst, x.itc, x.total, x.paid, x.status, x.dueDate])); toast('Exported ' + r.length + ' bills'); };

/* ── Import (shared QLFin sheet) ── */
$('#puImport').onclick = () => QLFin.importSheet({
  title: 'Import purchase bills', sub: 'Upload a spreadsheet list — or a photo/PDF of a single bill to scan.',
  dropTitle: 'Choose a file', dropSub: '.csv / .xlsx list, or a photo / PDF of one bill',
  tip: 'A spreadsheet imports many bills; a photo/PDF is read with OCR. A "Purchase Group / Item" column is auto-detected.',
  noun: 'bill', addLabel: 'Add Bill', accept: '.csv,.xlsx,.xls,.pdf,image/*', ocr: true,
  ocrMap: { bill: 'docno', date: 'date', sup: 'name', gstin: 'gstin', taxable: 'taxable', total: 'total', grate: 'rate' },
  errText: 'No usable bills found. Ensure Date, Supplier and a taxable/total column are mapped.',
  headerGroups: [['date', 'bill', 'invoice', 'voucher'], ['supplier', 'vendor', 'party', 'seller', 'name', 'amount', 'taxable', 'total']],
  fields: [{ key: 'bill', label: 'Bill No.' }, { key: 'date', label: 'Date', required: true }, { key: 'sup', label: 'Supplier', required: true }, { key: 'gstin', label: 'GSTIN' }, { key: 'group', label: 'Purchase Group' }, { key: 'item', label: 'Purchase Item' }, { key: 'taxable', label: 'Taxable amount' }, { key: 'total', label: 'Total amount' }, { key: 'grate', label: 'GST %' }, { key: 'itc', label: 'ITC' }],
  requireOneOf: [['taxable', 'total']],
  autoMap: h => ({ bill: QLFin.colOf(h, 'bill no', 'invoice no', 'bill', 'invoice', 'voucher'), date: QLFin.colOf(h, 'bill date', 'invoice date', 'date'), sup: QLFin.colOf(h, 'supplier', 'vendor', 'seller', 'party', 'name'), gstin: QLFin.colOf(h, 'gstin', 'gst no', 'gst number'), group: QLFin.colOf(h, 'purchase group', 'group', 'category', 'head'), item: QLFin.colOf(h, 'purchase item', 'item', 'particular', 'description'), taxable: QLFin.colOf(h, 'taxable', 'basic', 'amount', 'value'), total: QLFin.colOf(h, 'invoice value', 'grand total', 'net amount', 'total'), grate: QLFin.colOf(h, 'gst %', 'gst%', 'gst rate', 'tax %', 'tax%', 'rate of tax', 'tax rate'), itc: QLFin.colOf(h, 'itc') }),
  buildRow: get => {
    const sup = (get('sup') || '').toString().trim(), date = QLFin.parseDate(get('date'));
    let taxable = QLFin.parseNum(get('taxable')), total = QLFin.parseNum(get('total'));
    let grate = QLFin.parseNum(get('grate')); if (!grate) grate = 5; if (grate > 0 && grate < 1) grate *= 100;
    if (!taxable && total) taxable = total / (1 + grate / 100);
    if (!sup && !taxable && !total) return null;
    let itc = 'Eligible'; const iv = (get('itc') || '').toString().toLowerCase().trim();
    if (/rcm/.test(iv)) itc = 'RCM'; else if (/inelig/.test(iv) || iv === 'no' || iv === 'n') itc = 'Ineligible';
    const raw = ((get('group') || '') + ' ' + (get('item') || '')).toLowerCase().trim();
    const out = { bill: (get('bill') || '').toString().trim(), date: date || '', sup, gstin: (get('gstin') || '').toString().trim().toUpperCase(), taxable: +(taxable || 0), grate, itc, status: 'pending' };
    if (raw) { out.cat = raw; const gm = Q.purchaseGroups.find(g => raw.includes(g.label.toLowerCase()) || g.items.some(it => raw.includes(it.toLowerCase()))); if (gm) { out.group = gm.key; out.item = gm.items.find(it => raw.includes(it.toLowerCase())) || gm.items[0]; } }
    return out;
  },
  existing: () => new Set(Q.state.PURCHASES.filter(p => p.bill).map(p => ((p.sup || '') + '|' + p.bill).toUpperCase())),
  keyOf: p => p.bill ? ((p.sup || '') + '|' + p.bill).toUpperCase() : '',
  preview: { headers: ['Bill', 'Date', 'Supplier', 'Group', 'Taxable', 'GST%'], right: [4, 5], row: p => [p.bill || '—', p.date || '—', p.sup || '—', (Q.purchaseGroups.find(g => g.key === p.group) || { label: p.cat || '—' }).label, Q.fC(p.taxable), p.grate + '%'] },
  add: p => Q.addPurchase(p),
  done: n => { toast('Imported ' + n + ' bill' + (n === 1 ? '' : 's'), 'ok'); pPage = 1; render(); }
});

window.__qlOnSwitchCompany = id => Q.switchCompany(id, render);
window.__qlRefresh = render;
Q.init(render);
