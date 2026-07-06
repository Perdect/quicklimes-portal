/* Labour — on the QLX workspace engine. */
const Q = window.QLD, fC = Q.fC;
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons;
const toast = (m, t) => QLX.toast(m, t);
const IP = { users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>', cash: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>', wallet: '<path d="M2 8h20M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2M2 8v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8"/>', minus: '<line x1="5" y1="12" x2="19" y2="12"/>' };
function tabOverview(r) { const kv = (l, v) => `<div class="qx-kv"><span>${l}</span><b>${v}</b></div>`; return kv('Designation', esc(r.desig || '—')) + kv('Wage', fC(r.wage) + ' / ' + esc(r.freq)) + kv('Days worked', r.days) + kv('Gross', fC(r.gross)) + kv('Advance', fC(r.adv)) + `<div class="qx-kv qx-kv-tot"><span>Net payable</span><b>${fC(r.net)}</b></div>`; }

QLX.mount({
  active: 'labour', title: 'Labour', accent: 'blue', noun: 'worker', nounPl: 'workers',
  icon: IP.users,
  data: () => Q.labourRows(), rowId: r => r.idx,
  primary: { label: 'Add Worker', icon: IC.plus, onClick: () => QLShell.openWorkerForm() },
  tools: [{ label: 'Export', icon: IC.dl, onClick: () => exportLabour() }],
  stats: () => { const s = Q.labourSummary(); return [
    { label: 'Workers', value: s.count, sub: 'on the roll', tint: 'blue', icon: IP.users },
    { label: 'Gross Wages', value: fC(s.gross), sub: 'this period', tint: 'green', icon: IP.cash },
    { label: 'Advances', value: fC(s.adv), sub: 'paid out', tint: 'amber', icon: IP.minus },
    { label: 'Net Payable', value: fC(s.net), sub: 'to disburse', tint: 'violet', icon: IP.wallet }
  ]; },
  search: (r, q) => (r.name + ' ' + r.desig).toLowerCase().includes(q),
  filters: [
    { key: 'desig', label: 'Designation', options: rows => [...new Set(rows.map(r => r.desig))].filter(Boolean).sort().map(d => [d, d]), test: (r, v) => r.desig === v },
    { key: 'freq', label: 'Wage type', options: () => [['daily', 'Daily'], ['monthly', 'Monthly'], ['weekly', 'Weekly']], test: (r, v) => r.freq === v }
  ],
  groupBy: [{ key: 'desig', label: 'Designation', of: r => r.desig || '—', title: r => esc(r.desig || 'Unassigned'), dot: () => 'var(--qx)' }],
  sortDefault: { key: 'net', dir: 'desc' },
  columns: [
    { key: 'sr', label: '#', cell: (r, sr) => `<span class="qx-sr">${sr}</span>`, cls: 'qx-sr' },
    { key: 'name', label: 'Name', sort: true, cell: r => `<span class="qx-party-n" style="font-weight:600">${esc(r.name)}</span>` },
    { key: 'desig', label: 'Designation', sort: true, cell: r => `<span class="qx-tag">${esc(r.desig || '—')}</span>` },
    { key: 'wage', label: 'Wage', sort: true, num: true, cell: r => `<span class="qx-num">${fC(r.wage)}<span class="qx-mut" style="font-size:11px">/${esc((r.freq || 'day')[0])}</span></span>` },
    { key: 'days', label: 'Days', sort: true, num: true, cell: r => `<span class="qx-num">${r.days}</span>` },
    { key: 'gross', label: 'Gross', sort: true, num: true, cell: r => `<span class="qx-num">${fC(r.gross)}</span>` },
    { key: 'adv', label: 'Advance', sort: true, num: true, cell: r => r.adv ? `<span class="qx-num" style="color:var(--ql-warning-700)">${fC(r.adv)}</span>` : '<span class="qx-mut">—</span>' },
    { key: 'net', label: 'Net Payable', sort: true, num: true, cell: r => `<span class="qx-num qx-strong">${fC(r.net)}</span>` },
    { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
  ],
  rowActions: r => [
    { tt: 'Details', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    { tt: 'Edit', icon: IC.edit, onClick: r => QLShell.openWorkerForm(r.idx) }
  ],
  rowMenu: r => [{ label: 'Edit', icon: IC.edit, onClick: r => QLShell.openWorkerForm(r.idx) }, { divider: true }, { label: 'Delete', icon: IC.trash, cls: 'del', onClick: r => { if (confirm('Delete ' + r.name + '?')) { Q.deleteWorker(r.idx); toast('Deleted'); QLX.refresh(); } } }],
  card: r => ({ id: r.name, title: esc(r.name), amount: fC(r.net), party: r.name, partySub: r.desig, rows: [['Wage', fC(r.wage)], ['Days', r.days], ['Net', fC(r.net)]] }),
  footer: rows => { const g = rows.reduce((a, r) => a + r.gross, 0), a2 = rows.reduce((a, r) => a + r.adv, 0), n = rows.reduce((a, r) => a + r.net, 0); return [{ label: 'Workers', value: rows.length }, { label: 'Gross', value: fC(g) }, { label: 'Advance', value: fC(a2) }, { label: 'Net Payable', value: fC(n), strong: true }]; },
  detail: r => ({ eyebrow: 'Worker', title: esc(r.name), sub: (r.desig || '—') + ' · Net ' + fC(r.net), actions: [{ label: 'Edit', icon: IC.edit, primary: true, onClick: r => QLShell.openWorkerForm(r.idx) }], tabs: [{ label: 'Overview', icon: IC.file, render: tabOverview }] })
});
function exportLabour() { const r = Q.labourRows(); QLShell.exportCSV('labour_' + (Q.co.short || 'roll').replace(/\s+/g, '_'), ['Name', 'Designation', 'Wage', 'Freq', 'Days', 'Gross', 'Advance', 'Net'], r.map(x => [x.name, x.desig, x.wage, x.freq, x.days, x.gross, x.adv, x.net])); toast('Exported ' + r.length + ' workers'); }
