/* ═══════════════════════════════════════════════════════════════════════
   Sales Register — mounted on the QLX workspace engine (PERDECT / IMZA look).
   Modern data grid, collapsible groups, right-side detail panel (Overview /
   Invoice / Payments / Comments), receive-payment flow that marks the invoice
   Paid/Partial and posts to the Payments ledger, import + PDF reused.
   ═══════════════════════════════════════════════════════════════════════ */
const Q = window.QLD, fC = Q.fC, fmt = Q.fmt, fDS = d => Q.fDS(d);
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons;
const todayISO = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const STATUSES = [['pending', 'Pending'], ['partial', 'Partial'], ['paid', 'Paid'], ['cash', 'Cash']];
const STDOT = { pending: '#f59e0b', partial: '#2563eb', paid: '#16a34a', cash: '#0d9488', cancelled: '#ef4444' };
const toast = (m, t) => QLX.toast(m, t);

/* ── cells ── */
function stCell(r) { return `<select class="qx-st s-${r.status}" data-st="${r.idx}" onclick="event.stopPropagation()">${STATUSES.map(s => `<option value="${s[0]}" ${s[0] === r.status ? 'selected' : ''}>${s[1]}</option>`).join('')}</select>`; }
function stPill(r) { const st = r.status; return `<span class="qx-pill s-${st}">${st[0].toUpperCase() + st.slice(1)}</span>`; }
function partyCell(r) {
  const sub = r.gstin || r.veh || '';
  const od = r.status === 'pending' && r.days > 30 ? `<span style="color:var(--ql-danger-600);font-weight:600"> · ${r.days}d overdue</span>` : '';
  return `<span class="qx-party"><span class="qx-av" style="background:linear-gradient(135deg,${QLX.avColor(r.party)})">${(r.party || '?').charAt(0).toUpperCase()}</span><span class="qx-party-c"><span class="qx-party-n">${esc(r.party)}</span><span class="qx-party-s">${esc(sub) || '—'}${od}</span></span></span>`;
}

/* ── mutations ── */
function printInv(r) { QLShell.printInvoice(r.idx); }
function setStatus(r, val) { Q.setSaleStatus(r.idx, val, (val === 'paid' || val === 'cash') ? { paidDate: todayISO, paidMode: val === 'cash' ? 'Cash' : 'Bank' } : {}); }
function delInv(r) { if (confirm('Delete invoice ' + (r.inv || '') + ' for ' + r.party + '?')) { Q.deleteSale(r.idx); toast('Invoice deleted'); QLX.refresh(); } }
function dupInv(r) { const s = Q.state.SALES[r.idx]; Q.addSale(Object.assign({}, s, { inv: (s.inv || '') + '-COPY', status: 'pending', paid: 0, payments: [] })); toast('Invoice duplicated'); QLX.refresh(); }
function shareInv(r) { const co = (Q.partyRows().find(x => (x.name || '').toUpperCase() === (r.party || '').toUpperCase()) || {}); const d = (co.phone || '').replace(/\D/g, ''); const n = d.length === 10 ? '91' + d : d; window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(`Invoice ${r.inv || ''} — ${fC(r.total)} · ${r.status}`), '_blank'); }

/* ── detail tabs ── */
function tabOverview(r) {
  const kv = (l, v) => `<div class="qx-kv"><span>${l}</span><b>${v}</b></div>`;
  const co = Q.partyRows().find(x => (x.name || '').toUpperCase() === (r.party || '').toUpperCase()) || {};
  const phone = co.phone || '';
  const comm = `<div class="qx-comm">
    ${phone ? `<a class="wa" href="https://wa.me/${(phone.replace(/\D/g,'').length===10?'91':'')+phone.replace(/\D/g,'')}?text=${encodeURIComponent('Invoice '+(r.inv||''))}" target="_blank">${svg(IC.wa)} WhatsApp</a>` : ''}
    ${phone ? `<a class="call" href="tel:${esc(phone)}">${svg(IC.call)} Call</a>` : ''}
    ${co.email ? `<a class="mail" href="mailto:${esc(co.email)}">${svg(IC.mail)} Email</a>` : ''}
    ${!phone && !co.email ? '<span class="qx-mut" style="font-size:12px">No saved contact — add it in All Parties.</span>' : ''}</div>`;
  return `<div class="qx-sec-h">Customer</div>
    <div style="font-weight:700;font-size:15px">${esc(r.party)}</div>
    <div class="qx-mut" style="font-size:12.5px;margin-top:2px">${r.gstin ? 'GSTIN ' + esc(r.gstin) : 'No GSTIN on file'}${phone ? ' · ' + esc(phone) : ''}</div>
    ${comm}
    <div class="qx-sec-h">Invoice</div>
    ${kv('Invoice No', esc(r.inv || '—'))}${kv('Date', fDS(r.date))}${kv('Vehicle', esc(r.veh || '—'))}${kv('Qty', fmt(r.qty, 2) + ' T')}
    <div class="qx-sec-h">Amount</div>
    ${kv('Taxable value', fC(r.taxable))}${kv('GST', fC(r.gst))}
    <div class="qx-kv qx-kv-tot"><span>Grand total</span><b>${fC(r.total)}</b></div>
    ${kv('Received', fC(r.paid))}${r.outstanding > 0 ? kv('Outstanding', `<span style="color:var(--ql-danger-600)">${fC(r.outstanding)}</span>`) : ''}`;
}
function tabPayments(r) {
  const hist = (r.payments || []).length ? r.payments.map(p => `<div class="qx-kv"><span>${fDS(p.date)} · ${esc(p.method || p.mode || '—')}</span><b>${fC(p.amount)}</b></div>`).join('') : '<div class="qx-empty">No payments recorded yet.</div>';
  const form = (r.status !== 'paid' && r.status !== 'cash' && r.outstanding > 0) ? `<div class="qx-sec-h">Receive a payment</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input type="number" id="sxPayAmt" value="${r.outstanding}" placeholder="Amount" style="flex:1;min-width:120px;height:38px;border:1px solid var(--ql-border);border-radius:8px;padding:0 12px;font-size:13px">
      <select id="sxPayMode" class="qx-sel" style="height:38px">${Q.paymentMethods.map(m => `<option>${m}</option>`).join('')}</select>
      <button class="qx-btn qx-btn-primary" id="sxPayBtn">Receive</button>
    </div>` : '';
  return `<div class="qx-sec-h">Status</div>
    <div>${r.outstanding > 0 ? `Outstanding <b style="color:var(--ql-danger-600)">${fC(r.outstanding)}</b> of ${fC(r.total)}` : `<b style="color:var(--ql-success-600)">Fully collected ✓</b>`}</div>
    ${form}
    <div class="qx-sec-h">Payment history</div>${hist}`;
}
function wirePayments(body, r) {
  const btn = body.querySelector('#sxPayBtn'); if (!btn) return;
  btn.onclick = () => { const amt = +body.querySelector('#sxPayAmt').value || 0, method = body.querySelector('#sxPayMode').value; if (!amt) { toast('Enter an amount', 'err'); return; } Q.receiveSalesPayment(r.idx, { amount: amt, method }); toast('Payment received — invoice updated', 'ok'); QLX.refresh(); };
}

/* ══════════════════ CONFIG ══════════════════ */
QLX.mount({
  active: 'sales', title: 'Sales Register', accent: 'blue', noun: 'invoice', nounPl: 'invoices',
  icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  data: () => Q.salesRows(), rowId: r => r.idx, dateField: r => r.date,
  subtitle: () => { const s = Q.salesSummary(); return `<b>${esc(Q.co.short)}</b> · ${s.count} invoices · <b>${fC(s.taxable)}</b> sales`; },
  primary: { label: 'New invoice', icon: IC.plus, onClick: () => QLShell.openSaleForm() },
  tools: [
    { label: 'Import', icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', onClick: () => importInvoices() },
    { label: 'Export', icon: IC.dl, onClick: () => exportInvoices() }
  ],
  stats: () => {
    const s = Q.salesSummary();
    return [
      { label: 'Total Invoices', value: s.count, sub: fmt(s.qty, 1) + ' T dispatched', tint: 'blue', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' },
      { label: 'Total Sales', value: fC(s.taxable), sub: 'excl. GST', tint: 'green', icon: '<path d="M3 3h2l2 13h11l2-8H6"/><circle cx="9" cy="21" r="1"/><circle cx="18" cy="21" r="1"/>' },
      { label: 'Collected', value: fC(s.collected), sub: 'paid + cash', tint: 'indigo', icon: '<polyline points="20 6 9 17 4 12"/>' },
      { label: 'Pending', value: fC(s.pending), sub: 'awaiting payment', tint: 'amber', icon: IC.clock },
      { label: 'GST Output', value: fC(s.gst), sub: 'collected GST', tint: 'violet', icon: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><line x1="8" y1="8" x2="16" y2="8"/>' }
    ];
  },
  quickFilters: [
    { key: 'all', label: 'All', test: () => true },
    { key: 'pending', label: 'Pending', test: r => r.status === 'pending' },
    { key: 'partial', label: 'Partial', test: r => r.status === 'partial' },
    { key: 'paid', label: 'Paid', test: r => r.status === 'paid' },
    { key: 'cash', label: 'Cash', test: r => r.status === 'cash' }
  ],
  search: (r, q) => (r.inv + ' ' + r.party + ' ' + r.gstin + ' ' + r.veh).toLowerCase().includes(q),
  filters: [
    { key: 'party', label: 'Party', options: rows => [...new Set(rows.map(r => r.party))].filter(p => p && p !== '—').sort().map(p => [p, p]), test: (r, v) => r.party === v },
    { key: 'status', label: 'Status', options: () => STATUSES, test: (r, v) => r.status === v }
  ],
  dateRange: true,
  groupBy: [
    { key: 'status', label: 'Status', of: r => r.status, title: r => r.status[0].toUpperCase() + r.status.slice(1), dot: r => STDOT[r.status] },
    { key: 'party', label: 'Customer', of: r => r.party, title: r => esc(r.party), dot: () => 'var(--qx)' },
    { key: 'month', label: 'Month', of: r => (r.date || '').slice(0, 7), title: r => (r.date || '').slice(0, 7), dot: () => 'var(--qx)' }
  ],
  groupByDefault: 'none', groupSum: r => r.total,
  sortDefault: { key: 'date', dir: 'desc' },
  columns: [
    { key: 'sr', label: '#', cell: (r, sr) => `<span class="qx-sr">${sr}</span>`, cls: 'qx-sr' },
    { key: 'inv', label: 'Invoice', sort: true, cell: r => `<span class="qx-ref">${esc(r.inv || '—')}</span>` },
    { key: 'date', label: 'Date', sort: true, cell: r => `<span class="qx-mut">${fDS(r.date)}</span>` },
    { key: 'party', label: 'Party', sort: true, cell: partyCell },
    { key: 'qty', label: 'Qty (T)', sort: true, num: true, cell: r => `<span class="qx-num">${fmt(r.qty, 2)}</span>` },
    { key: 'taxable', label: 'Taxable', sort: true, num: true, cell: r => `<span class="qx-num">${fC(r.taxable)}</span>` },
    { key: 'gst', label: 'GST', sort: true, num: true, cell: r => `<span class="qx-num qx-mut">${fC(r.gst)}</span>` },
    { key: 'total', label: 'Total', sort: true, num: true, cell: r => `<span class="qx-num qx-strong">${fC(r.total)}</span>` },
    { key: 'status', label: 'Status', sort: true, cell: stCell },
    { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
  ],
  status: { options: STATUSES, of: r => r.status, set: setStatus, dot: v => STDOT[v] },
  rowActions: r => [
    { tt: 'Open', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    { tt: 'Print invoice', icon: IC.print, onClick: printInv },
    { tt: 'Edit', icon: IC.edit, onClick: r => QLShell.openSaleForm(r.idx) }
  ],
  rowMenu: r => [
    { label: 'Print / PDF', icon: IC.print, onClick: printInv },
    { label: 'Edit', icon: IC.edit, onClick: r => QLShell.openSaleForm(r.idx) },
    { label: 'Duplicate', icon: IC.copy, onClick: dupInv },
    { label: 'Share', icon: IC.share, onClick: shareInv },
    { divider: true },
    { label: 'Delete', icon: IC.trash, cls: 'del', onClick: delInv }
  ],
  bulkActions: [
    { label: 'Mark paid', icon: IC.check, onClick: rows => { rows.forEach(r => r.outstanding > 0 && Q.receiveSalesPayment(r.idx, { amount: r.outstanding, method: 'Bank' })); toast(rows.length + ' invoices collected', 'ok'); QLX.refresh(); } },
    { label: 'Export', icon: IC.dl, onClick: rows => exportRows(rows) },
    { label: 'Delete', icon: IC.trash, cls: 'del', onClick: rows => { if (confirm('Delete ' + rows.length + ' invoices?')) { rows.map(r => r.idx).sort((a, b) => b - a).forEach(i => Q.deleteSale(i)); toast(rows.length + ' deleted'); QLX.refresh(); } } }
  ],
  card: r => ({ id: r.inv || '—', title: `<span style="color:var(--qx)">${esc(r.inv || '—')}</span>`, amount: fC(r.total), party: r.party, partySub: r.gstin || '', calLabel: r.party, status: stPill(r), rows: [['Qty', fmt(r.qty, 2) + ' T'], ['Taxable', fC(r.taxable)], ['GST', fC(r.gst)], ['Status', stPill(r)]] }),
  footer: rows => { const t = rows.reduce((a, r) => ({ qty: a.qty + r.qty, tax: a.tax + r.taxable, gst: a.gst + r.gst, tot: a.tot + r.total, paid: a.paid + r.paid, out: a.out + r.outstanding }), { qty: 0, tax: 0, gst: 0, tot: 0, paid: 0, out: 0 }); return [{ label: 'Qty', value: fmt(t.qty, 1) + ' T' }, { label: 'Taxable', value: fC(t.tax) }, { label: 'GST', value: fC(t.gst) }, { label: 'Grand Total', value: fC(t.tot), strong: true }, { label: 'Collected', value: fC(t.paid) }, { label: 'Pending', value: fC(t.out) }]; },
  analytics: () => {
    const rows = Q.salesRows();
    const byParty = {}; rows.forEach(r => { byParty[r.party] = (byParty[r.party] || 0) + r.total; });
    const bars = Object.entries(byParty).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, v]) => ({ label: p, value: v, display: fC(v) }));
    const byStatus = {}; rows.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + r.total; });
    const donut = Object.keys(byStatus).map(k => ({ label: k[0].toUpperCase() + k.slice(1), value: byStatus[k], color: STDOT[k] || '#94a3b8' }));
    return { barsTitle: 'Top customers by sales', bars, donutTitle: 'Sales by status', donut, donutCenter: fC(Q.salesSummary().revenue) };
  },
  detail: r => ({
    eyebrow: 'GST Invoice', title: `${esc(r.inv || '—')} · ${esc(r.party)}`, sub: `${fDS(r.date)} · ${fmt(r.qty, 2)} T · ${fC(r.total)}`,
    actions: [
      { label: 'Print', icon: IC.print, onClick: printInv },
      { label: 'Edit', icon: IC.edit, onClick: r => QLShell.openSaleForm(r.idx) },
      ...(r.status !== 'paid' && r.status !== 'cash' && r.outstanding > 0 ? [{ label: 'Receive', icon: IC.check, primary: true, onClick: r => { Q.receiveSalesPayment(r.idx, { amount: r.outstanding, method: 'Bank' }); toast('Payment received', 'ok'); QLX.refresh(); } }] : [])
    ],
    tabs: [
      { label: 'Overview', icon: IC.file, render: tabOverview },
      { label: 'Payments', icon: IC.clock, render: tabPayments, onMount: wirePayments }
    ]
  })
});

/* handle #new (GST Invoice sidebar link) + #pending/#paid/#cash (Collections) */
(function () {
  const h = (location.hash || '').slice(1);
  if (h === 'new') { history.replaceState(null, '', location.pathname); QLShell.openSaleForm(); }
  else if (['pending', 'paid', 'cash'].includes(h)) { const S = QLX.state(); S.quick = h; QLX.refresh(); }
})();
window.addEventListener('hashchange', () => {
  const h = (location.hash || '').slice(1);
  if (h === 'new') { history.replaceState(null, '', location.pathname); QLShell.openSaleForm(); }
  else if (['pending', 'paid', 'cash', 'partial', 'all'].includes(h)) { const S = QLX.state(); S.quick = h; QLX.refresh(); }
});

/* Export / Import */
function exportRows(rows) { QLShell.exportCSV('sales_' + (Q.co.short || 'register').replace(/\s+/g, '_'), ['Invoice', 'Date', 'Party', 'GSTIN', 'Qty (MT)', 'Taxable', 'GST', 'Total', 'Status'], rows.map(x => [x.inv, x.date, x.party, x.gstin, x.qty, x.taxable, x.gst, x.total, x.status])); toast('Exported ' + rows.length + ' invoices'); }
function exportInvoices() { exportRows(Q.salesRows()); }
function importInvoices() {
  QLFin.importSheet({
    title: 'Import sales bills', sub: 'Upload a spreadsheet list — or a photo/PDF of a single bill to scan.',
    dropTitle: 'Choose a file', dropSub: '.csv / .xlsx list, or a photo / PDF of one bill',
    tip: 'A spreadsheet imports many invoices at once. A photo or PDF of one bill is read with OCR.',
    noun: 'invoice', addLabel: 'New invoice', accept: '.csv,.xlsx,.xls,.pdf,image/*', ocr: true,
    ocrMap: { inv: 'docno', date: 'date', party: 'name', gstin: 'gstin', qty: 'qty', taxable: 'taxable', total: 'total', gstr: 'rate', veh: 'veh' },
    errText: 'No usable invoices found. Check that Date, Party and an amount column are mapped.',
    headerGroups: [['date', 'invoice', 'bill', 'voucher'], ['party', 'customer', 'buyer', 'consignee', 'name', 'amount', 'taxable', 'total', 'rate']],
    fields: [{ key: 'inv', label: 'Invoice No.' }, { key: 'date', label: 'Date', required: true }, { key: 'party', label: 'Party / Customer', required: true }, { key: 'gstin', label: 'GSTIN' }, { key: 'qty', label: 'Quantity' }, { key: 'rate', label: 'Rate' }, { key: 'gstr', label: 'GST %' }, { key: 'taxable', label: 'Taxable amount' }, { key: 'total', label: 'Total amount' }, { key: 'veh', label: 'Vehicle No.' }],
    requireOneOf: [['taxable', 'rate', 'total']],
    autoMap: h => ({ inv: QLFin.colOf(h, 'invoice no', 'bill no', 'invoice', 'voucher', 'inv no', 'inv'), date: QLFin.colOf(h, 'invoice date', 'bill date', 'date'), party: QLFin.colOf(h, 'party', 'customer', 'buyer', 'consignee', 'name'), gstin: QLFin.colOf(h, 'gstin', 'gst no', 'gst number', 'gst in'), qty: QLFin.colOf(h, 'qty', 'quantity', 'weight', 'tonne', 'ton', 'mt'), rate: QLFin.colOf(h, 'rate', 'price', 'unit'), gstr: QLFin.colOf(h, 'gst %', 'gst%', 'gst rate', 'tax %', 'tax%', 'rate of tax', 'tax rate'), taxable: QLFin.colOf(h, 'taxable', 'basic', 'amount', 'value'), total: QLFin.colOf(h, 'invoice value', 'grand total', 'net amount', 'total'), veh: QLFin.colOf(h, 'vehicle', 'truck', 'lorry') }),
    buildRow: get => {
      const party = (get('party') || '').toString().trim(), date = QLFin.parseDate(get('date'));
      let qty = QLFin.parseNum(get('qty')), rate = QLFin.parseNum(get('rate'));
      let taxable = QLFin.parseNum(get('taxable')), total = QLFin.parseNum(get('total'));
      let gstR = QLFin.parseNum(get('gstr')); if (!gstR) gstR = 5; if (gstR > 0 && gstR < 1) gstR *= 100;
      if (!taxable && !(qty && rate) && total) taxable = total / (1 + gstR / 100);
      if (!qty || !rate) { if (taxable) { qty = qty || 1; rate = taxable / (qty || 1); } }
      if (!party && !qty && !taxable && !total) return null;
      return { inv: (get('inv') || '').toString().trim(), date: date || '', party, gstin: (get('gstin') || '').toString().trim().toUpperCase(), qty: +(qty || 0), rate: +(rate || 0), gstR, veh: (get('veh') || '').toString().trim(), status: 'pending' };
    },
    existing: () => new Set(Q.state.SALES.map(s => (s.inv || '').toString().toUpperCase()).filter(Boolean)),
    keyOf: s => s.inv ? s.inv.toUpperCase() : '',
    preview: { headers: ['Invoice', 'Date', 'Party', 'Qty', 'Taxable', 'GST%'], right: [3, 4, 5], row: s => [s.inv || '—', s.date || '—', s.party || '—', s.qty || '', Q.fC(s.qty * s.rate), s.gstR + '%'] },
    add: s => Q.addSale(s),
    done: n => { toast('Imported ' + n + ' invoice' + (n === 1 ? '' : 's'), 'ok'); QLX.refresh(); }
  });
}
