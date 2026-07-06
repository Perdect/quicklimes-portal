/* ═══════════════════════════════════════════════════════════════════════
   Customers & Suppliers (All Parties) — on the QLX workspace engine.
   #supplier / #customer deep-links pre-filter. Business totals + outstanding
   pulled from the sales & purchase registers.
   ═══════════════════════════════════════════════════════════════════════ */
const Q = window.QLD, fC = Q.fC;
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons;
const toast = (m, t) => QLX.toast(m, t);
function waLink(phone, text) { const d = (phone || '').replace(/\D/g, ''); const n = d.length === 10 ? '91' + d : d; return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text || ''); }
const hash = () => (location.hash || '').toLowerCase();
const isSup = () => hash().indexOf('supplier') >= 0, isCust = () => hash().indexOf('customer') >= 0;

function enriched() {
  const salesBy = {}, purBy = {};
  Q.salesRows().forEach(s => { const k = (s.party || '').toUpperCase(); (salesBy[k] = salesBy[k] || { amt: 0, due: 0, n: 0, last: '' }); salesBy[k].amt += s.total; salesBy[k].due += s.outstanding; salesBy[k].n++; if (s.date > salesBy[k].last) salesBy[k].last = s.date; });
  Q.purchaseRows().forEach(p => { const k = (p.sup || '').toUpperCase(); (purBy[k] = purBy[k] || { amt: 0, due: 0, n: 0, last: '' }); purBy[k].amt += p.total; purBy[k].due += p.outstanding; purBy[k].n++; if (p.date > purBy[k].last) purBy[k].last = p.date; });
  return Q.partyRows().map(r => {
    const s = salesBy[(r.name || '').toUpperCase()] || { amt: 0, due: 0, n: 0, last: '' }, p = purBy[(r.name || '').toUpperCase()] || { amt: 0, due: 0, n: 0, last: '' };
    return Object.assign({}, r, { salesAmt: s.amt, salesDue: s.due, salesN: s.n, salesLast: s.last, purAmt: p.amt, purDue: p.due, purN: p.n, purLast: p.last, business: s.amt + p.amt, due: s.due + p.due });
  });
}
const TCOL = { customer: ['#ecfdf3', '#15803d'], supplier: ['#f4f3ff', '#6d28d9'], both: ['#eff4ff', '#1d4ed8'] };
function typePill(r) { const c = TCOL[r.type] || TCOL.customer; return `<span class="qx-pill" style="background:${c[0]};color:${c[1]}">${r.type[0].toUpperCase() + r.type.slice(1)}</span>`; }

function tabOverview(r) {
  const kv = (l, v) => `<div class="qx-kv"><span>${l}</span><b>${v}</b></div>`;
  const comm = `<div class="qx-comm">
    ${r.phone ? `<a class="wa" href="${waLink(r.phone, 'Dear ' + r.name + ', ')}" target="_blank">${svg(IC.wa)} WhatsApp</a>` : ''}
    ${r.phone ? `<a class="call" href="tel:${esc(r.phone)}">${svg(IC.call)} Call</a>` : ''}
    ${!r.phone ? '<span class="qx-mut" style="font-size:12px">No phone on file — add it to enable contact.</span>' : ''}</div>`;
  return `<div class="qx-sec-h">Contact</div>
    <div style="font-weight:700;font-size:15px">${esc(r.name)}</div>
    <div class="qx-mut" style="font-size:12.5px;margin-top:2px">${r.gstin ? 'GSTIN ' + esc(r.gstin) : 'No GSTIN'}${r.state ? ' · ' + esc(r.state) : ''}</div>
    ${comm}
    ${r.address ? `<div class="qx-sec-h">Address</div><div style="font-size:13px">${esc(r.address)}</div>` : ''}
    ${(r.type === 'customer' || r.type === 'both') ? `<div class="qx-sec-h">As customer</div>${kv('Invoices', r.salesN)}${kv('Total sales', fC(r.salesAmt))}${kv('Outstanding', r.salesDue ? `<span style="color:var(--ql-danger-600)">${fC(r.salesDue)}</span>` : '—')}${r.salesLast ? kv('Last sale', Q.fDS(r.salesLast)) : ''}` : ''}
    ${(r.type === 'supplier' || r.type === 'both') ? `<div class="qx-sec-h">As supplier</div>${kv('Bills', r.purN)}${kv('Total purchases', fC(r.purAmt))}${kv('Payable', r.purDue ? `<span style="color:var(--ql-danger-600)">${fC(r.purDue)}</span>` : '—')}${r.purLast ? kv('Last bill', Q.fDS(r.purLast)) : ''}` : ''}
    ${r.notes ? `<div class="qx-sec-h">Notes</div><div style="font-size:13px">${esc(r.notes)}</div>` : ''}`;
}

QLX.mount({
  active: isSup() ? 'suppliers' : 'parties',
  title: isSup() ? 'Suppliers' : isCust() ? 'Customers' : 'All Parties', accent: 'blue', noun: 'party', nounPl: 'parties',
  icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  data: enriched, rowId: r => r.idx,
  subtitle: () => { const s = Q.partySummary(); return `<b>${esc(Q.co.short)}</b> · ${s.count} parties · ${s.customers} customers · ${s.suppliers} suppliers`; },
  primary: { label: 'Add Party', icon: IC.plus, onClick: () => QLShell.openPartyForm() },
  tools: [{ label: 'Export', icon: IC.dl, onClick: () => exportParties() }],
  stats: () => {
    const rows = enriched(), s = Q.partySummary();
    const recv = rows.reduce((a, r) => a + r.salesDue, 0), pay = rows.reduce((a, r) => a + r.purDue, 0);
    return [
      { label: 'Total Parties', value: s.count, sub: s.customers + ' cust · ' + s.suppliers + ' supp', tint: 'blue', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' },
      { label: 'Customers', value: s.customers, sub: 'buyers', tint: 'green', icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
      { label: 'Suppliers', value: s.suppliers, sub: 'vendors', tint: 'violet', icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>' },
      { label: 'Receivable', value: fC(recv), sub: 'from customers', tint: 'amber', icon: IC.clock },
      { label: 'Payable', value: fC(pay), sub: 'to suppliers', tint: 'rose', icon: IC.cash }
    ];
  },
  quickFilters: [
    { key: 'all', label: 'All', test: () => true },
    { key: 'customer', label: 'Customers', test: r => r.type === 'customer' || r.type === 'both' },
    { key: 'supplier', label: 'Suppliers', test: r => r.type === 'supplier' || r.type === 'both' }
  ],
  search: (r, q) => (r.name + ' ' + r.gstin + ' ' + r.phone + ' ' + r.state).toLowerCase().includes(q),
  filters: [
    { key: 'type', label: 'Type', options: () => [['customer', 'Customer'], ['supplier', 'Supplier'], ['both', 'Both']], test: (r, v) => r.type === v },
    { key: 'state', label: 'State', options: rows => [...new Set(rows.map(r => r.state))].filter(Boolean).sort().map(s => [s, s]), test: (r, v) => r.state === v }
  ],
  groupBy: [
    { key: 'type', label: 'Type', of: r => r.type, title: r => r.type[0].toUpperCase() + r.type.slice(1) + 's', dot: r => (TCOL[r.type] || TCOL.customer)[1] },
    { key: 'state', label: 'State', of: r => r.state || '—', title: r => esc(r.state || '—'), dot: () => 'var(--qx)' }
  ],
  sortDefault: { key: 'business', dir: 'desc' },
  columns: [
    { key: 'sr', label: '#', cell: (r, sr) => `<span class="qx-sr">${sr}</span>`, cls: 'qx-sr' },
    { key: 'name', label: 'Name', sort: true, cell: r => `<span class="qx-party-n" style="font-weight:600">${esc(r.name)}</span>` },
    { key: 'gstin', label: 'GSTIN', cell: r => `<span class="qx-mut">${esc(r.gstin || '—')}</span>` },
    { key: 'phone', label: 'Phone', cell: r => `<span class="qx-mut">${esc(r.phone || '—')}</span>` },
    { key: 'type', label: 'Type', sort: true, cell: typePill },
    { key: 'business', label: 'Business', sort: true, num: true, cell: r => `<span class="qx-num qx-strong">${fC(r.business)}</span>` },
    { key: 'due', label: 'Outstanding', sort: true, num: true, cell: r => r.due ? `<span class="qx-num" style="color:var(--ql-danger-600);font-weight:600">${fC(r.due)}</span>` : '<span class="qx-mut">—</span>' },
    { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
  ],
  rowActions: r => [
    { tt: 'Details', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    ...(r.phone ? [{ tt: 'WhatsApp', icon: IC.wa, cls: 'qx-ib-ok', onClick: r => window.open(waLink(r.phone, 'Dear ' + r.name + ', '), '_blank') }] : []),
    { tt: 'Edit', icon: IC.edit, onClick: r => QLShell.openPartyForm(r.idx) }
  ],
  rowMenu: r => [
    { label: 'Edit', icon: IC.edit, onClick: r => QLShell.openPartyForm(r.idx) },
    ...(r.phone ? [{ label: 'Call', icon: IC.call, onClick: r => location.href = 'tel:' + r.phone }] : []),
    { divider: true },
    { label: 'Delete', icon: IC.trash, cls: 'del', onClick: r => { if (confirm('Delete ' + r.name + '?')) { Q.deleteParty(r.idx); toast('Party deleted'); QLX.refresh(); } } }
  ],
  card: r => ({ id: r.name, title: esc(r.name), amount: fC(r.business), party: r.name, partySub: r.gstin || r.phone || '', status: typePill(r), rows: [['Type', typePill(r)], ['Business', fC(r.business)], ['Outstanding', r.due ? fC(r.due) : '—']] }),
  footer: rows => { const b = rows.reduce((a, r) => a + r.business, 0), d = rows.reduce((a, r) => a + r.due, 0); return [{ label: 'Parties', value: rows.length }, { label: 'Total Business', value: fC(b), strong: true }, { label: 'Outstanding', value: fC(d) }]; },
  detail: r => ({
    eyebrow: r.type === 'supplier' ? 'Supplier' : r.type === 'both' ? 'Customer & Supplier' : 'Customer', title: esc(r.name), sub: (r.gstin ? 'GSTIN ' + esc(r.gstin) : 'No GSTIN') + (r.phone ? ' · ' + esc(r.phone) : ''),
    actions: [
      ...(r.phone ? [{ label: 'WhatsApp', icon: IC.wa, onClick: r => window.open(waLink(r.phone, 'Dear ' + r.name + ', '), '_blank') }, { label: 'Call', icon: IC.call, onClick: r => location.href = 'tel:' + r.phone }] : []),
      { label: 'Edit', icon: IC.edit, primary: true, onClick: r => QLShell.openPartyForm(r.idx) }
    ],
    tabs: [{ label: 'Overview', icon: IC.file, render: tabOverview }]
  })
});

/* deep-link pre-filter (#supplier / #customer) */
(function () { const S = QLX.state(); if (isSup()) S.quick = 'supplier'; else if (isCust()) S.quick = 'customer'; QLX.refresh(); })();
window.addEventListener('hashchange', () => { const S = QLX.state(); S.quick = isSup() ? 'supplier' : isCust() ? 'customer' : 'all'; QLX.refresh(); });

function exportParties() { const r = enriched(); QLShell.exportCSV('parties_' + (Q.co.short || 'list').replace(/\s+/g, '_'), ['Name', 'Type', 'GSTIN', 'Phone', 'State', 'Business', 'Outstanding'], r.map(x => [x.name, x.type, x.gstin, x.phone, x.state, x.business, x.due])); toast('Exported ' + r.length + ' parties'); }
