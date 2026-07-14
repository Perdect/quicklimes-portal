/* Loans & Partner Ledger — on the QLX workspace engine. */
const Q = window.QLD, fC = Q.fC, fDS = d => Q.fDS(d);
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons;
const toast = (m, t) => QLX.toast(m, t);
const IP = { bank: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>', cash: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5h5M9.5 12.5h5M12 8v8"/>', clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>', pct: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>' };
function progCell(r) { const pct = r.total ? Math.round(r.paid / r.total * 100) : 0; return `<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;min-width:70px;height:7px;border-radius:99px;background:var(--ql-neutral-100);overflow:hidden"><div style="height:100%;width:${pct}%;border-radius:99px;background:var(--qx-grad)"></div></div><span class="qx-mut" style="font-size:11px">${r.paid}/${r.total}</span></div>`; }
function payEmi(r) {
  QLShell.formPrompt('Pay EMI — ' + r.name, [
    { k: 'amount', label: 'Amount (₹)', type: 'number', req: true, reqNonZero: true },
    { k: 'method', label: 'Payment method', type: 'select', opts: Q.paymentMethods.map(m => [m, m]) },
    { k: 'date', label: 'Date', type: 'date' },
    { k: 'ref', label: 'Reference' }
  ], v => { Q.payLoanEmi(r.idx, { amount: +v.amount, method: v.method, date: v.date, ref: v.ref }); toast('EMI recorded — loan reduced', 'ok'); QLX.refresh(); }, 'Marks the next instalment paid and posts to the Payments ledger.');
}
function tabOverview(r) {
  const kv = (l, v) => `<div class="qx-kv"><span>${l}</span><b>${v}</b></div>`;
  return kv('Lender / bank', esc(r.bank || '—')) + kv('Principal', fC(r.principal)) + kv('Monthly EMI', fC(r.emi)) + kv('Instalments paid', r.paid + ' / ' + r.total) + kv('Next due', r.nextDue ? fDS(r.nextDue) + (r.nextAmt ? ' · ' + fC(r.nextAmt) : '') : '—') +
    `<div class="qx-kv qx-kv-tot"><span>Outstanding</span><b style="color:var(--ql-danger-600)">${fC(r.outstanding)}</b></div>`;
}

QLX.mount({
  active: 'loans', title: 'Loans & Partner Ledger', accent: 'blue', noun: 'loan', nounPl: 'loans',
  icon: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M9 9h6M9 13h4"/>',
  data: () => Q.loanRows(), rowId: r => r.idx,
  subtitle: () => { const s = Q.loanSummary(); return `<b>${esc(Q.co.short)}</b> · ${s.count} loans · Outstanding <b>${fC(s.outstanding)}</b>`; },
  tools: [
    // Loan-account statements go through the same Bank Reconciliation pipeline:
    // this deep-links to reconcile with the upload modal open, where the user
    // picks (or creates) a "Loan account" so EMIs land under it.
    { label: 'Upload statement', icon: IC.up || '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', onClick: () => { location.href = 'reconcile.html?upload=1'; } },
    { label: 'Export', icon: IC.dl, onClick: () => exportLoans() }
  ],
  stats: () => {
    const s = Q.loanSummary();
    return [
      { label: 'Active Loans', value: s.count, sub: 'total accounts', tint: 'blue', icon: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>' },
      { label: 'Principal', value: fC(s.principal), sub: 'borrowed', tint: 'indigo', icon: IP.bank },
      { label: 'Outstanding', value: fC(s.outstanding), sub: 'to repay', tint: 'rose', icon: IP.cash },
      { label: 'Monthly EMI', value: fC(s.monthlyEmi), sub: 'per month', tint: 'amber', icon: IP.clock }
    ];
  },
  search: (r, q) => (r.name + ' ' + r.bank).toLowerCase().includes(q),
  sortDefault: { key: 'outstanding', dir: 'desc' },
  columns: [
    { key: 'sr', label: '#', cell: (r, sr) => `<span class="qx-sr">${sr}</span>`, cls: 'qx-sr' },
    { key: 'name', label: 'Loan', sort: true, cell: r => `<span class="qx-party-n" style="font-weight:600">${esc(r.name)}</span>` },
    { key: 'bank', label: 'Lender', cell: r => `<span class="qx-mut">${esc(r.bank || '—')}</span>` },
    { key: 'principal', label: 'Principal', sort: true, num: true, cell: r => `<span class="qx-num">${fC(r.principal)}</span>` },
    { key: 'emi', label: 'EMI', sort: true, num: true, cell: r => `<span class="qx-num">${fC(r.emi)}</span>` },
    { key: 'prog', label: 'Progress', cell: progCell },
    { key: 'outstanding', label: 'Outstanding', sort: true, num: true, cell: r => `<span class="qx-num qx-strong" style="color:var(--ql-danger-600)">${fC(r.outstanding)}</span>` },
    { key: 'nextDue', label: 'Next Due', sort: true, cell: r => r.nextDue ? `<span class="qx-mut ${r.nextDays != null && r.nextDays > 0 ? '' : ''}">${fDS(r.nextDue)}</span>` : '<span class="qx-mut">—</span>' },
    { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
  ],
  rowActions: r => [
    { tt: 'Details', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    ...(r.outstanding > 0 ? [{ tt: 'Pay EMI', icon: IC.check, cls: 'qx-ib-ok', onClick: payEmi }] : [])
  ],
  card: r => ({ id: r.name, title: esc(r.name), amount: fC(r.outstanding), party: r.name, partySub: r.bank || '', rows: [['EMI', fC(r.emi)], ['Paid', r.paid + '/' + r.total], ['Outstanding', fC(r.outstanding)]] }),
  footer: rows => { const p = rows.reduce((a, r) => a + r.principal, 0), o = rows.reduce((a, r) => a + r.outstanding, 0), e = rows.reduce((a, r) => a + r.emi, 0); return [{ label: 'Principal', value: fC(p) }, { label: 'Monthly EMI', value: fC(e) }, { label: 'Outstanding', value: fC(o), strong: true }]; },
  detail: r => ({
    eyebrow: 'Loan', title: esc(r.name), sub: (r.bank || '—') + ' · Outstanding ' + fC(r.outstanding),
    actions: r.outstanding > 0 ? [{ label: 'Pay EMI', icon: IC.check, primary: true, onClick: payEmi }] : [],
    tabs: [{ label: 'Overview', icon: IC.file, render: tabOverview }]
  })
});
function exportLoans() { const r = Q.loanRows(); QLShell.exportCSV('loans_' + (Q.co.short || 'list').replace(/\s+/g, '_'), ['Loan', 'Lender', 'Principal', 'EMI', 'Paid', 'Total', 'Outstanding', 'Next Due'], r.map(x => [x.name, x.bank, x.principal, x.emi, x.paid, x.total, x.outstanding, x.nextDue])); toast('Exported ' + r.length + ' loans'); }
