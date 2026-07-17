/* ═══════════════════════════════════════════════════════════════════════
   Payments Center — the ONE place every money movement happens.
   A unified money ledger over QLD.paymentsLedger() (CASHBOOK). Receiving a
   payment marks the invoice paid; paying a bill marks the purchase paid;
   expenses / EMI / transfers post one linked entry each and update balances
   automatically. Not accounting software — money tracking in 10 seconds.
   ═══════════════════════════════════════════════════════════════════════ */
const Q = window.QLD, fC = Q.fC, fDS = d => Q.fDS(d);
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons;

const todayISO = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const weekAgoISO = (() => { const d = new Date(Date.now() - 6 * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const thisMonth = todayISO.slice(0, 7);

/* type + account styling */
const PTYPE = {
  'Sales Payment': ['#ecfdf3', '#15803d', '💰'], 'Purchase Payment': ['#fef6ee', '#b45309', '🧾'],
  'Expense': ['#fff1f3', '#be123c', '💸'], 'Salary': ['#eef2ff', '#4338ca', '👷'],
  'Loan EMI': ['#f4f3ff', '#6d28d9', '🏦'], 'Freight': ['#fff7ed', '#c2410c', '🚚'], 'Cash Deposit': ['#ecfeff', '#0e7490', '🏧'],
  'Cash Withdrawal': ['#ecfeff', '#0e7490', '🏧'], 'Bank Transfer': ['#eff4ff', '#1d4ed8', '🔁'],
  'UPI Transfer': ['#eff4ff', '#1d4ed8', '🔁'], 'Transfer': ['#eff4ff', '#1d4ed8', '🔁'],
  'Partner Withdrawal': ['#fff4ed', '#c2410c', '🤝'], 'Partner Investment': ['#ecfdf3', '#15803d', '🤝'],
  'Receipt': ['#ecfdf3', '#15803d', '💰'], 'Payment': ['#fef6ee', '#b45309', '💸'], 'Other': ['#f1f5f9', '#475569', '•']
};
const ACC = { cash: ['Cash', '#0d9488'], bank: ['Bank', '#2563eb'], upi: ['UPI', '#7c3aed'] };
function ptypePill(r) { const c = PTYPE[r.ptype] || PTYPE.Other; return `<span class="qx-pill" style="background:${c[0]};color:${c[1]}">${c[2]} ${esc(r.ptype)}</span>`; }
function methodTag(r) {
  const a = ACC[r.mode] || ACC.bank;
  // Multi-bank: show WHICH own account the money hit / left when known.
  const acc = r.account ? `<div class="qx-mut" style="font-size:10.5px;margin-top:1px">🏦 ${esc(r.account)}</div>` : '';
  return `<span class="qx-tag" style="color:${a[1]}">${esc(r.method)}</span>${acc}`;
}
/* Optional "Bank account" field for payment modals — only when the firm has
   accounts, and only meaningful for non-cash methods. */
function accSpec() {
  const accounts = Q.bankAccounts ? Q.bankAccounts() : [];
  return accounts.length ? [{ k: 'accountId', label: 'Bank account', type: 'select', opts: [['', '—']].concat(accounts.map(a => [a.id, a.label])) }] : [];
}
function accLabel(mode) { return (ACC[mode] || ACC.bank)[0]; }
function partyCell(r) { return `<span class="qx-party-n" style="font-weight:600">${esc(r.party)}</span>`; }

/* ══════════════════ MODALS ══════════════════ */
function receivePaymentModal() {
  const unpaid = Q.salesRows().filter(r => r.status !== 'cancelled' && r.outstanding > 0).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!unpaid.length) { QLX.toast('No unpaid invoices 🎉', 'ok'); return; }
  QLShell.openForm({
    title: 'Receive Payment', sub: 'Marks the invoice Paid or Partial automatically.',
    specs: [
      { k: 'inv', label: 'Invoice', type: 'searchselect', req: true, full: true, ph: 'Search invoice no. or customer…', opts: unpaid.map(r => [String(r.idx), `${r.inv || '—'} · ${r.party} · ${fC(r.outstanding)} due`]) },
      { k: 'amount', label: 'Amount received (₹)', type: 'number', req: true, reqNonZero: true },
      { k: 'method', label: 'Payment method', type: 'select', opts: Q.paymentMethods.map(m => [m, m]) },
      ...accSpec(),
      { k: 'ref', label: 'Reference no.', ph: 'UTR / cheque / txn id' },
      { k: 'date', label: 'Date', type: 'date', req: true },
      { k: 'notes', label: 'Notes', type: 'textarea', full: true }
    ],
    initial: { inv: String(unpaid[0].idx), amount: Math.round(unpaid[0].outstanding), method: 'Bank', date: todayISO },
    onRender: () => { const s = document.getElementById('qf_inv'), a = document.getElementById('qf_amount'); if (s && a) s.onchange = () => { const r = unpaid.find(x => String(x.idx) === s.value); if (r) a.value = Math.round(r.outstanding); }; },
    saveLabel: 'Receive payment',
    onSave: v => { Q.receiveSalesPayment(+v.inv, { amount: +v.amount, method: v.method, ref: v.ref, date: v.date, notes: v.notes, accountId: v.accountId || '' }); QLX.toast('Payment received — invoice updated', 'ok'); QLX.refresh(); }
  });
}
function payBillModal() {
  const unpaid = Q.purchaseRows().filter(r => r.status !== 'paid' && r.status !== 'cancelled' && r.outstanding > 0).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!unpaid.length) { QLX.toast('No pending bills 🎉', 'ok'); return; }
  QLShell.openForm({
    title: 'Pay Supplier Bill', sub: 'Marks the purchase bill Paid or Partial automatically.',
    specs: [
      { k: 'bill', label: 'Purchase bill', type: 'searchselect', req: true, full: true, ph: 'Search bill no. or supplier…', opts: unpaid.map(r => [String(r.idx), `${r.bill || '—'} · ${r.sup} · ${fC(r.outstanding)} due`]) },
      { k: 'amount', label: 'Amount paid (₹)', type: 'number', req: true, reqNonZero: true },
      { k: 'method', label: 'Payment method', type: 'select', opts: Q.paymentMethods.map(m => [m, m]) },
      ...accSpec(),
      { k: 'ref', label: 'Reference no.' },
      { k: 'date', label: 'Date', type: 'date', req: true },
      { k: 'notes', label: 'Notes', type: 'textarea', full: true }
    ],
    initial: { bill: String(unpaid[0].idx), amount: Math.round(unpaid[0].outstanding), method: 'Bank', date: todayISO },
    onRender: () => { const s = document.getElementById('qf_bill'), a = document.getElementById('qf_amount'); if (s && a) s.onchange = () => { const r = unpaid.find(x => String(x.idx) === s.value); if (r) a.value = Math.round(r.outstanding); }; },
    saveLabel: 'Pay bill',
    onSave: v => { Q.payPurchaseBill(+v.bill, { amount: +v.amount, method: v.method, ref: v.ref, date: v.date, notes: v.notes, accountId: v.accountId || '' }); QLX.toast('Payment made — bill updated', 'ok'); QLX.refresh(); }
  });
}
function transferModal() {
  const A = ['Cash', 'Bank', 'UPI', 'PhonePe', 'Google Pay'];
  QLShell.openForm({
    title: 'Transfer / Deposit', sub: 'Move money between Cash, Bank and UPI — both balances update.',
    specs: [
      { k: 'from', label: 'From account', type: 'select', opts: A.map(a => [a, a]) },
      { k: 'to', label: 'To account', type: 'select', opts: A.map(a => [a, a]) },
      { k: 'amount', label: 'Amount (₹)', type: 'number', req: true, reqNonZero: true },
      { k: 'ref', label: 'Reference / note', full: true },
      { k: 'date', label: 'Date', type: 'date', req: true }
    ],
    initial: { from: 'Cash', to: 'Bank', date: todayISO },
    saveLabel: 'Save transfer',
    onSave: v => {
      if (v.from === v.to) { QLX.toast('Pick two different accounts', 'err'); return false; }
      const ptype = /cash/i.test(v.from) ? 'Cash Deposit' : /cash/i.test(v.to) ? 'Cash Withdrawal' : 'Bank Transfer';
      Q.addTransfer({ fromMethod: v.from, toMethod: v.to, amount: +v.amount, date: v.date, ref: v.ref, ptype });
      QLX.toast('Transfer recorded', 'ok'); QLX.refresh();
    }
  });
}
function recordModal() {
  const loans = Q.loanRows(), TYPES = ['Expense', 'Salary', 'Loan EMI', 'Partner Withdrawal', 'Partner Investment', 'Other'];
  QLShell.openForm({
    title: 'Record Payment', sub: 'Expense, salary, EMI, partner draw or anything else.',
    specs: [
      { k: 'ptype', label: 'Type', type: 'select', req: true, opts: TYPES.map(t => [t, t]) },
      { k: 'party', label: 'Paid to / from', full: true, ph: 'Name or description' },
      { k: 'loan', label: 'Loan (only for EMI)', type: 'select', opts: [['', '—']].concat(loans.map((l, i) => [String(i), `${l.name} · EMI ${fC(l.emi)}`])) },
      { k: 'amount', label: 'Amount (₹)', type: 'number', req: true, reqNonZero: true },
      { k: 'method', label: 'Payment method', type: 'select', opts: Q.paymentMethods.map(m => [m, m]) },
      ...accSpec(),
      { k: 'ref', label: 'Reference' },
      { k: 'date', label: 'Date', type: 'date', req: true },
      { k: 'notes', label: 'Notes', type: 'textarea', full: true }
    ],
    initial: { ptype: 'Expense', method: 'Cash', date: todayISO },
    saveLabel: 'Record',
    onSave: v => {
      if (v.ptype === 'Loan EMI') Q.payLoanEmi(v.loan !== '' ? +v.loan : 0, { amount: +v.amount, method: v.method, ref: v.ref, date: v.date, notes: v.notes, accountId: v.accountId || '' });
      else Q.addLedgerPayment({ ptype: v.ptype, dir: v.ptype === 'Partner Investment' ? 'in' : 'out', party: v.party || v.ptype, amount: +v.amount, method: v.method, ref: v.ref, date: v.date, notes: v.notes, accountId: v.accountId || '' });
      QLX.toast(v.ptype + ' recorded', 'ok'); QLX.refresh();
    }
  });
}
function delPayment(r) { QLShell.confirmDelete({ title: 'Move payment to Trash?', desc: 'This ledger entry will move to Trash (restorable 90 days). The linked invoice/bill status is not reverted.', confirmLabel: 'Move to Trash', onConfirm: reason => { Q.deleteLedgerEntry(r.idx, reason); QLX.close(); QLX.toast('Moved to Trash'); QLX.refresh(); } }); }
function openSource(r) { if (r.link && r.link.kind === 'sale') location.href = 'sales.html'; else if (r.link && r.link.kind === 'purchase') location.href = 'purchase.html'; else if (r.link && r.link.kind === 'loan') location.href = 'loans.html'; }

/* ══════════════════ DETAIL TAB ══════════════════ */
function tabPayOverview(r) {
  const kv = (l, v) => `<div class="qx-kv"><span>${l}</span><b>${v}</b></div>`;
  const dc = r.dir === 'in' ? 'var(--ql-success-600)' : 'var(--ql-danger-600)';
  const link = (r.link && (r.link.kind === 'sale' || r.link.kind === 'purchase' || r.link.kind === 'loan'))
    ? `<div class="qx-sec-h">Linked to</div><button class="qx-btn qx-btn-sm" onclick="openSource(Q.paymentsLedger().find(x=>x.idx===${r.idx}))">${svg(IC.eye)} Open ${r.link.kind === 'sale' ? 'invoice ' + esc(r.ref) : r.link.kind === 'purchase' ? 'bill ' + esc(r.ref) : 'loan'}</button>` : '';
  return `<div style="font-size:28px;font-weight:800;color:${dc};letter-spacing:-.02em">${r.dir === 'in' ? '+' : '−'} ${fC(r.amount)}</div>
    <div class="qx-sec-h">Details</div>
    ${kv('Type', ptypePill(r))}${kv('Party', esc(r.party))}${kv('Method', esc(r.method))}${kv('Account', accLabel(r.mode))}${kv('Reference', esc(r.ref || '—'))}${kv('Date', fDS(r.date))}${kv('Status', `<span class="qx-pill s-paid">${esc(r.status)}</span>`)}
    <div class="qx-kv qx-kv-tot"><span>Running balance</span><b>${fC(r.balance)}</b></div>
    ${r.notes ? `<div class="qx-sec-h">Notes</div><div style="font-size:13px;color:var(--ql-text)">${esc(r.notes)}</div>` : ''}
    ${link}`;
}

/* ══════════════════ CONFIG ══════════════════ */
QLX.mount({
  active: 'finance', title: 'Payments Center', accent: 'blue', noun: 'payment', nounPl: 'payments',
  icon: '<path d="M2 8h20M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2M2 8v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8"/><path d="M6 14h4"/>',
  data: () => Q.paymentsLedger(), rowId: r => r.idx, dateField: r => r.date,
  /* Every payment carries a date, so "show me March" / "show me 2026" is a
     question this ledger can answer honestly — and the numbers below move with
     it. What CANNOT move is the account BALANCES: a balance is a position as of
     today, arrived at by every entry ever made, so scoping it to March would
     invent a number that was never true. Those cards stay all-time and say so. */
  monthFilter: true, monthOf: r => r.date, emptyLabel: 'payment',
  subtitle: () => { const s = Q.paymentsSummary(); return `<b>${esc(Q.co.short)}</b> · ${s.count} transactions · Balance <b>${fC(s.total)}</b>`; },
  primary: { label: 'Receive Payment', icon: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>', onClick: receivePaymentModal },
  tools: [
    { label: 'Pay Bill', icon: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="5 12 12 19 19 12"/>', onClick: payBillModal },
    { label: 'Transfer', icon: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>', onClick: transferModal },
    { label: 'Record', icon: IC.plus, onClick: recordModal },
    { label: 'Export', icon: IC.dl, onClick: () => exportPayments() }
  ],
  /* `rows` is the month/year-scoped set (QLX passes allRows() in). Reading it —
     rather than calling paymentsSummary() again, which is always all-time — is
     the difference between a filter and a decoration. */
  stats: rows => {
    const s = Q.paymentsSummary(), per = QLX.monthLabel().toLowerCase();
    const moneyIn = rows.reduce((a, r) => a + r.credit, 0);
    const moneyOut = rows.reduce((a, r) => a + r.debit, 0);
    return [
      { label: 'Money In', value: fC(moneyIn), sub: 'received · ' + per, tint: 'green', icon: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>' },
      { label: 'Money Out', value: fC(moneyOut), sub: 'paid · ' + per, tint: 'rose', icon: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="5 12 12 19 19 12"/>' },
      /* From here down: positions as of TODAY, not the picked period, and every
         sub says so. What you are owed is what you are owed — it is not a
         March number, and pretending otherwise would be the more dangerous
         "consistency". */
      { label: 'Customer Outstanding', value: fC(s.custOutstanding), sub: 'to collect · today', tint: 'amber', icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
      { label: 'Supplier Outstanding', value: fC(s.supOutstanding), sub: s.pendingBills + ' bills to pay · today', tint: 'orange', icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>' },
      { label: 'Cash Balance', value: fC(s.cash), sub: 'in hand · today', tint: 'teal', icon: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>' },
      { label: 'Bank Balance', value: fC(s.bank), sub: 'current a/c · today', tint: 'blue', icon: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>' },
      { label: 'UPI Balance', value: fC(s.upi), sub: 'PhonePe · GPay · today', tint: 'violet', icon: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/>' },
      { label: 'Pending Bills', value: s.pendingBills, sub: 'awaiting payment', tint: 'indigo', icon: IC.file }
    ];
  },
  banner: () => { const ins = Q.paymentsInsights().slice(0, 3); if (!ins.length) return ''; return `<div class="qx-aibar"><span class="qx-aibar-h">${svg(IC.ai)} AI</span>${ins.map(x => `<span class="qx-aibar-i">${x.icon || ''} ${esc(x.text)}</span>`).join('')}</div>`; },
  quickFilters: [
    { key: 'all', label: 'All', test: () => true },
    { key: 'today', label: 'Today', test: r => r.date === todayISO },
    { key: 'week', label: 'This Week', test: r => r.date >= weekAgoISO && r.date <= todayISO },
    { key: 'month', label: 'This Month', test: r => (r.date || '').slice(0, 7) === thisMonth }
  ],
  search: (r, q) => (r.party + ' ' + r.ptype + ' ' + r.ref + ' ' + r.method + ' ' + r.notes).toLowerCase().includes(q),
  filters: [
    { key: 'dir', label: 'Direction', options: () => [['in', 'Money In'], ['out', 'Money Out']], test: (r, v) => r.dir === v },
    { key: 'ptype', label: 'Type', options: rows => [...new Set(rows.map(r => r.ptype))].map(t => [t, t]), test: (r, v) => r.ptype === v },
    { key: 'mode', label: 'Account', options: () => [['cash', 'Cash'], ['bank', 'Bank'], ['upi', 'UPI']], test: (r, v) => r.mode === v },
    { key: 'method', label: 'Method', options: rows => [...new Set(rows.map(r => r.method))].map(m => [m, m]), test: (r, v) => r.method === v },
    { key: 'party', label: 'Party', options: rows => [...new Set(rows.map(r => r.party))].filter(p => p && p !== '—').sort().map(p => [p, p]), test: (r, v) => r.party === v }
  ],
  dateRange: true,
  groupBy: [
    { key: 'ptype', label: 'Payment type', of: r => r.ptype, title: r => ptypePill(r), dot: r => (PTYPE[r.ptype] || PTYPE.Other)[1] },
    { key: 'mode', label: 'Account', of: r => r.mode, title: r => accLabel(r.mode), dot: r => (ACC[r.mode] || ACC.bank)[1] },
    { key: 'party', label: 'Party', of: r => r.party, title: r => esc(r.party), dot: () => 'var(--qx)' },
    { key: 'date', label: 'Day', of: r => r.date, title: r => fDS(r.date), dot: () => 'var(--qx)' }
  ],
  groupByDefault: 'none', groupSum: r => r.credit - r.debit,
  sortDefault: { key: 'date', dir: 'desc' },
  columns: [
    { key: 'date', label: 'Date', sort: true, cell: r => `<span class="qx-mut">${fDS(r.date)}</span>` },
    { key: 'party', label: 'Party', sort: true, cell: partyCell },
    { key: 'ptype', label: 'Type', sort: true, cell: ptypePill },
    { key: 'ref', label: 'Reference', cell: r => `<span class="qx-mut" style="font-variant-numeric:tabular-nums">${esc(r.ref || '—')}</span>` },
    { key: 'method', label: 'Method', cell: methodTag },
    { key: 'debit', label: 'Debit', sort: true, num: true, cell: r => r.debit ? `<span class="qx-num" style="color:var(--ql-danger-600);font-weight:700">${fC(r.debit)}</span>` : '<span class="qx-mut">—</span>' },
    { key: 'credit', label: 'Credit', sort: true, num: true, cell: r => r.credit ? `<span class="qx-num" style="color:var(--ql-success-600);font-weight:700">${fC(r.credit)}</span>` : '<span class="qx-mut">—</span>' },
    { key: 'balance', label: 'Balance', num: true, cell: r => `<span class="qx-num qx-strong">${fC(r.balance)}</span>` },
    { key: 'status', label: 'Status', cell: r => `<span class="qx-pill s-paid">${esc(r.status)}</span>` },
    { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
  ],
  rowActions: () => [
    { tt: 'Details', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    { tt: 'Delete', icon: IC.trash, onClick: delPayment }
  ],
  footer: rows => { const cin = rows.reduce((s, r) => s + r.credit, 0), cout = rows.reduce((s, r) => s + r.debit, 0); return [{ label: 'Money In', value: fC(cin) }, { label: 'Money Out', value: fC(cout) }, { label: 'Net flow', value: fC(cin - cout), strong: true }, { label: 'Total Balance', value: fC(Q.accountBalances().total) }]; },
  detail: r => ({
    eyebrow: r.ptype, title: (r.dir === 'in' ? '+ ' : '− ') + fC(r.amount), sub: `${esc(r.party)} · ${fDS(r.date)} · ${esc(r.method)}`,
    actions: [
      ...(r.link && (r.link.kind === 'sale' || r.link.kind === 'purchase') ? [{ label: 'Open ' + (r.link.kind === 'sale' ? 'invoice' : 'bill'), icon: IC.eye, onClick: openSource }] : []),
      { label: 'Delete', icon: IC.trash, onClick: delPayment }
    ],
    tabs: [{ label: 'Overview', icon: IC.file, render: tabPayOverview }]
  })
});

/* QLX.rows(), not paymentsLedger(): the export must be the month/year on SCREEN.
   A CSV that quietly holds every month while the page shows March is the way a
   filter gets believed and then disbelieved — sales.js already exports this way. */
function exportPayments() {
  const r = QLX.rows();
  const mo = QLX.month() ? '_' + QLX.month() : '';
  QLShell.exportCSV('payments_' + (Q.co.short || 'ledger').replace(/\s+/g, '_') + mo, ['Date', 'Party', 'Type', 'Reference', 'Method', 'Account', 'Debit', 'Credit', 'Balance', 'Status', 'Notes'], r.map(x => [x.date, x.party, x.ptype, x.ref, x.method, accLabel(x.mode), x.debit || '', x.credit || '', x.balance, x.status, x.notes]));
  QLX.toast('Exported ' + r.length + ' transactions' + (QLX.month() ? ' · ' + QLX.monthLabel() : ''));
}

/* build: bank-account field in payment modals + account line in ledger */

/* build m2c: Freight ptype pill */
