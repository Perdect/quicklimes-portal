/* TDS — on the QLX workspace engine. */
const Q = window.QLD, fC = Q.fC, fDS = d => Q.fDS(d);
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons;
const toast = (m, t) => QLX.toast(m, t);
const IP = { file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>', sum: '<path d="M18 3H6l6 9-6 9h12"/>', cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>', net: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' };
function tabOverview(r) { const kv = (l, v) => `<div class="qx-kv"><span>${l}</span><b>${v}</b></div>`; return kv('Party', esc(r.party)) + kv('PAN', esc(r.pan || '—')) + kv('Section', esc(r.sec)) + kv('Rate', r.rate + '%') + kv('Gross amount', fC(r.amount)) + kv('TDS deducted', fC(r.tds)) + `<div class="qx-kv qx-kv-tot"><span>Net paid</span><b>${fC(r.net)}</b></div>` + (r.remarks ? `<div class="qx-sec-h">Remarks</div><div style="font-size:13px">${esc(r.remarks)}</div>` : ''); }

QLX.mount({
  active: 'tds', title: 'TDS', accent: 'blue', noun: 'entry', nounPl: 'entries',
  icon: IP.file,
  data: () => Q.tdsRows(), rowId: r => r.idx, dateField: r => r.date,
  primary: { label: 'Add TDS', icon: IC.plus, onClick: () => QLShell.openTdsForm() },
  tools: [{ label: 'Export', icon: IC.dl, onClick: () => exportTds() }],
  stats: () => { const s = Q.tdsSummary(); return [
    { label: 'Entries', value: s.count, sub: 'TDS deductions', tint: 'blue', icon: IP.file },
    { label: 'Gross Amount', value: fC(s.amount), sub: 'total billed', tint: 'indigo', icon: IP.sum },
    { label: 'TDS Deducted', value: fC(s.tds), sub: 'to deposit', tint: 'rose', icon: IP.cut },
    { label: 'Net Paid', value: fC(s.net), sub: 'after TDS', tint: 'green', icon: IP.net }
  ]; },
  search: (r, q) => (r.party + ' ' + r.pan + ' ' + r.sec).toLowerCase().includes(q),
  filters: [
    { key: 'sec', label: 'Section', options: rows => [...new Set(rows.map(r => r.sec))].filter(Boolean).sort().map(s => [s, s]), test: (r, v) => r.sec === v },
    { key: 'party', label: 'Party', options: rows => [...new Set(rows.map(r => r.party))].filter(Boolean).sort().map(p => [p, p]), test: (r, v) => r.party === v }
  ],
  dateRange: true,
  groupBy: [{ key: 'sec', label: 'Section', of: r => r.sec, title: r => esc(r.sec), dot: () => 'var(--qx)' }, { key: 'party', label: 'Party', of: r => r.party, title: r => esc(r.party), dot: () => 'var(--qx)' }],
  sortDefault: { key: 'date', dir: 'desc' },
  columns: [
    { key: 'sr', label: '#', cell: (r, sr) => `<span class="qx-sr">${sr}</span>`, cls: 'qx-sr' },
    { key: 'date', label: 'Date', sort: true, cell: r => `<span class="qx-mut">${fDS(r.date)}</span>` },
    { key: 'party', label: 'Party', sort: true, cell: r => `<span class="qx-party-n" style="font-weight:600">${esc(r.party)}</span>` },
    { key: 'pan', label: 'PAN', cell: r => `<span class="qx-mut">${esc(r.pan || '—')}</span>` },
    { key: 'sec', label: 'Section', sort: true, cell: r => `<span class="qx-tag">${esc(r.sec)}</span>` },
    { key: 'rate', label: 'Rate', num: true, cell: r => `<span class="qx-mut qx-num">${r.rate}%</span>` },
    { key: 'amount', label: 'Amount', sort: true, num: true, cell: r => `<span class="qx-num">${fC(r.amount)}</span>` },
    { key: 'tds', label: 'TDS', sort: true, num: true, cell: r => `<span class="qx-num" style="color:var(--ql-danger-600);font-weight:700">${fC(r.tds)}</span>` },
    { key: 'net', label: 'Net', sort: true, num: true, cell: r => `<span class="qx-num qx-strong">${fC(r.net)}</span>` },
    { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
  ],
  rowActions: r => [
    { tt: 'Details', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    { tt: 'Edit', icon: IC.edit, onClick: r => QLShell.openTdsForm(r.idx) }
  ],
  rowMenu: r => [{ label: 'Edit', icon: IC.edit, onClick: r => QLShell.openTdsForm(r.idx) }, { divider: true }, { label: 'Delete', icon: IC.trash, cls: 'del', onClick: r => { if (confirm('Delete this TDS entry?')) { Q.deleteTds(r.idx); toast('Deleted'); QLX.refresh(); } } }],
  card: r => ({ id: r.party, title: esc(r.party), amount: fC(r.tds), party: r.party, partySub: r.sec, rows: [['Amount', fC(r.amount)], ['TDS', fC(r.tds)], ['Net', fC(r.net)]] }),
  footer: rows => { const a = rows.reduce((x, r) => x + r.amount, 0), t = rows.reduce((x, r) => x + r.tds, 0), n = rows.reduce((x, r) => x + r.net, 0); return [{ label: 'Entries', value: rows.length }, { label: 'Gross', value: fC(a) }, { label: 'TDS', value: fC(t), strong: true }, { label: 'Net', value: fC(n) }]; },
  detail: r => ({ eyebrow: 'TDS · ' + esc(r.sec), title: esc(r.party), sub: 'TDS ' + fC(r.tds) + ' · ' + fDS(r.date), actions: [{ label: 'Edit', icon: IC.edit, primary: true, onClick: r => QLShell.openTdsForm(r.idx) }], tabs: [{ label: 'Overview', icon: IC.file, render: tabOverview }] })
});
function exportTds() { const r = Q.tdsRows(); QLShell.exportCSV('tds_' + (Q.co.short || 'entries').replace(/\s+/g, '_'), ['Date', 'Party', 'PAN', 'Section', 'Rate', 'Amount', 'TDS', 'Net', 'Remarks'], r.map(x => [x.date, x.party, x.pan, x.sec, x.rate, x.amount, x.tds, x.net, x.remarks])); toast('Exported ' + r.length + ' entries'); }
