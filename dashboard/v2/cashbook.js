/* Expenses & Cash Book — on the QLX workspace engine. */
const Q = window.QLD, fC = Q.fC, fDS = d => Q.fDS(d);
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons;
const toast = (m, t) => QLX.toast(m, t);
const IP = { cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>', bank: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>', upi: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/>', wallet: '<path d="M2 8h20M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2M2 8v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8"/>', out: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="5 12 12 19 19 12"/>' };
const MODE = { cash: ['Cash', '#0d9488'], phonepay: ['PhonePe', '#7c3aed'], upi: ['UPI', '#7c3aed'], bank: ['Bank', '#2563eb'] };
function modeTag(r) { const m = MODE[r.mode] || MODE.bank; return `<span class="qx-tag" style="color:${m[1]}">${m[0]}</span>`; }
function amtCell(r) { const cr = r.type === 'credit'; return `<span class="qx-num" style="color:${cr ? 'var(--ql-success-600)' : 'var(--ql-danger-600)'};font-weight:700">${cr ? '+' : '−'}${fC(r.amount)}</span>`; }
function tabOverview(r) { const kv = (l, v) => `<div class="qx-kv"><span>${l}</span><b>${v}</b></div>`; return kv('Category', esc(r.category || '—')) + kv('Party', esc(r.party || '—')) + kv('Account', (MODE[r.mode] || MODE.bank)[0]) + kv('Direction', r.type === 'credit' ? 'Money In' : 'Money Out') + kv('Reference', esc(r.ref || '—')) + kv('Date', fDS(r.date)) + `<div class="qx-kv qx-kv-tot"><span>Amount</span><b>${r.type === 'credit' ? '+' : '−'}${fC(r.amount)}</b></div>` + (r.notes ? `<div class="qx-sec-h">Notes</div><div style="font-size:13px">${esc(r.notes)}</div>` : ''); }

QLX.mount({
  active: 'cashbook', title: 'Expenses & Cash Book', accent: 'blue', noun: 'entry', nounPl: 'entries',
  icon: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  data: () => Q.cashbookRows(), rowId: r => r.idx, dateField: r => r.date,
  subtitle: () => { const b = Q.accountBalances(); return `<b>${esc(Q.co.short)}</b> · ${Q.cashbookRows().length} entries · Balance <b>${fC(b.total)}</b>`; },
  primary: { label: 'Add Entry', icon: IC.plus, onClick: () => QLShell.openCashForm() },
  tools: [{ label: 'Export', icon: IC.dl, onClick: () => exportCash() }],
  stats: () => {
    const b = Q.accountBalances(), rows = Q.cashbookRows();
    const cout = rows.filter(r => r.type === 'debit').reduce((a, r) => a + r.amount, 0);
    return [
      { label: 'Cash', value: fC(b.cash), sub: 'in hand', tint: 'teal', icon: IP.cash },
      { label: 'Bank', value: fC(b.bank), sub: 'current a/c', tint: 'blue', icon: IP.bank },
      { label: 'UPI', value: fC(b.upi), sub: 'PhonePe · GPay', tint: 'violet', icon: IP.upi },
      { label: 'Total Balance', value: fC(b.total), sub: 'all accounts', tint: 'green', icon: IP.wallet },
      { label: 'Money Out', value: fC(cout), sub: 'total debits', tint: 'rose', icon: IP.out }
    ];
  },
  quickFilters: [
    { key: 'all', label: 'All', test: () => true },
    { key: 'credit', label: 'Money In', test: r => r.type === 'credit' },
    { key: 'debit', label: 'Money Out', test: r => r.type === 'debit' }
  ],
  search: (r, q) => ((r.category || '') + ' ' + (r.party || '') + ' ' + (r.ref || '') + ' ' + (r.notes || '')).toLowerCase().includes(q),
  filters: [
    { key: 'mode', label: 'Account', options: () => [['cash', 'Cash'], ['bank', 'Bank'], ['phonepay', 'PhonePe / UPI']], test: (r, v) => r.mode === v },
    { key: 'category', label: 'Category', options: rows => [...new Set(rows.map(r => r.category))].filter(Boolean).sort().map(c => [c, c]), test: (r, v) => r.category === v },
    { key: 'party', label: 'Party', options: rows => [...new Set(rows.map(r => r.party))].filter(Boolean).sort().map(p => [p, p]), test: (r, v) => r.party === v }
  ],
  dateRange: true,
  groupBy: [
    { key: 'category', label: 'Category', of: r => r.category || '—', title: r => esc(r.category || 'Uncategorised'), dot: () => 'var(--qx)' },
    { key: 'mode', label: 'Account', of: r => r.mode, title: r => (MODE[r.mode] || MODE.bank)[0], dot: r => (MODE[r.mode] || MODE.bank)[1] },
    { key: 'type', label: 'Direction', of: r => r.type, title: r => r.type === 'credit' ? 'Money In' : 'Money Out', dot: r => r.type === 'credit' ? '#16a34a' : '#ef4444' }
  ],
  groupByDefault: 'none', groupSum: r => r.type === 'credit' ? r.amount : -r.amount,
  sortDefault: { key: 'date', dir: 'desc' },
  columns: [
    { key: 'sr', label: '#', cell: (r, sr) => `<span class="qx-sr">${sr}</span>`, cls: 'qx-sr' },
    { key: 'date', label: 'Date', sort: true, cell: r => `<span class="qx-mut">${fDS(r.date)}</span>` },
    { key: 'category', label: 'Category', sort: true, cell: r => `<span class="qx-strong">${esc(r.category || '—')}</span>` },
    { key: 'party', label: 'Party', cell: r => `<span class="qx-party-n">${esc(r.party || '—')}</span>` },
    { key: 'mode', label: 'Account', cell: modeTag },
    { key: 'ref', label: 'Reference', cell: r => `<span class="qx-mut">${esc(r.ref || '—')}</span>` },
    { key: 'amount', label: 'Amount', sort: true, num: true, cell: amtCell },
    { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
  ],
  rowActions: r => [
    { tt: 'Edit', icon: IC.edit, onClick: r => QLShell.openCashForm(r.idx) },
    { tt: 'Delete', icon: IC.trash, onClick: r => { if (confirm('Delete this entry?')) { Q.deleteCashEntry(r.idx); toast('Deleted'); QLX.refresh(); } } }
  ],
  card: r => ({ id: r.category || r.type, title: esc(r.category || 'Entry'), amount: (r.type === 'credit' ? '+' : '−') + fC(r.amount), party: r.party || '—', partySub: (MODE[r.mode] || MODE.bank)[0], rows: [['Date', fDS(r.date)], ['Account', (MODE[r.mode] || MODE.bank)[0]], ['Amount', (r.type === 'credit' ? '+' : '−') + fC(r.amount)]] }),
  footer: rows => { const cin = rows.filter(r => r.type === 'credit').reduce((a, r) => a + r.amount, 0), cout = rows.filter(r => r.type === 'debit').reduce((a, r) => a + r.amount, 0); return [{ label: 'Money In', value: fC(cin) }, { label: 'Money Out', value: fC(cout) }, { label: 'Net', value: fC(cin - cout), strong: true }]; },
  detail: r => ({ eyebrow: r.type === 'credit' ? 'Money In' : 'Money Out', title: (r.type === 'credit' ? '+ ' : '− ') + fC(r.amount), sub: (r.category || '—') + ' · ' + fDS(r.date), actions: [{ label: 'Edit', icon: IC.edit, primary: true, onClick: r => QLShell.openCashForm(r.idx) }], tabs: [{ label: 'Overview', icon: IC.file, render: tabOverview }] })
});
function exportCash() { const r = Q.cashbookRows(); QLShell.exportCSV('cashbook_' + (Q.co.short || 'entries').replace(/\s+/g, '_'), ['Date', 'Type', 'Category', 'Party', 'Account', 'Amount', 'Reference', 'Notes'], r.map(x => [x.date, x.type, x.category, x.party, x.mode, x.amount, x.ref, x.notes])); toast('Exported ' + r.length + ' entries'); }
