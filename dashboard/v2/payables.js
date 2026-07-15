/* ═══════════════════════════════════════════════════════════════════════
   Payments Due — supplier payables tool (mirror of Collections, for money
   YOU owe). Unpaid purchase bills aggregated per supplier, with one-tap
   Pay-bill (oldest first, posts to the cashbook).
   ═══════════════════════════════════════════════════════════════════════ */
const Q = window.QLD, fC = Q.fC;
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons;
const toast = (m, t) => QLX.toast(m, t);
/* Delegates to wa-core's normalizePhone — the tested engine — never a local copy.
   The copy that was here read `d.length === 10 ? '91' + d : d`, so a number stored
   with the STD trunk 0 (09829069545, ELEVEN digits) got no country code and wa.me
   was handed a number that is not the customer's. wa-core handles the trunk 0, the
   0091 prefix and the 6-9 mobile check, and returns '' rather than guess — which
   opens WhatsApp's contact picker instead of messaging a stranger. */
function waLink(phone, text) {
  if (window.WACore) return WACore.waLink(phone, text);
  return 'https://wa.me/?text=' + encodeURIComponent(text || '');
}

function ageOf(dateStr) { const d = new Date((dateStr || '') + 'T00:00:00'); const n = Math.floor((new Date() - d) / 86400000); return isFinite(n) && n >= 0 ? n : 0; }
function bucketOf(days) { return days > 60 ? 'critical' : days > 30 ? 'overdue' : 'recent'; }
const BUCKET = { recent: ['On time', '#ecfdf3', '#15803d'], overdue: ['Overdue', '#fef6ee', '#c2610c'], critical: ['Critical', '#fef2f2', '#dc2626'] };
function agePill(r) { const b = BUCKET[r.bucket]; return `<span class="qx-pill" style="background:${b[1]};color:${b[2]}">${b[0]} · ${r.days}d</span>`; }

/* Aggregate every unpaid purchase bill into one row per supplier. */
function payRows() {
  const byS = {}, phoneOf = {};
  Q.partyRows().forEach(p => { phoneOf[(p.name || '').toUpperCase()] = p.phone || ''; });
  Q.purchaseRows().forEach(s => {
    if (s.status === 'cancelled' || (s.outstanding || 0) <= 0) return;
    const k = s.sup || '—';
    (byS[k] = byS[k] || { sup: k, out: 0, bills: 0, oldest: s.date, last: s.date, emoji: s.emoji || '📦', invs: [] });
    byS[k].out += s.outstanding; byS[k].bills++; byS[k].invs.push(s);
    if ((s.date || '') < byS[k].oldest) byS[k].oldest = s.date;
    if ((s.date || '') > byS[k].last) byS[k].last = s.date;
  });
  return Object.values(byS).map((r, i) => {
    const days = ageOf(r.oldest);
    return Object.assign(r, { idx: i, days, bucket: bucketOf(days), phone: phoneOf[(r.sup || '').toUpperCase()] || '' });
  }).sort((a, b) => b.out - a.out);
}

/* Apply a paid amount oldest-bill-first across a supplier's open bills. */
function applyPayment(r, amount, method) {
  let remaining = amount, applied = 0;
  r.invs.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(b => {
    if (remaining <= 0.5) return;
    const pay = Math.min(remaining, b.outstanding);
    if (pay > 0.5) { Q.payPurchaseBill(b.idx, { amount: pay, method }); remaining -= pay; applied += pay; }
  });
  return applied;
}
function payBill(r) {
  let back = document.getElementById('payBillBack');
  if (!back) { back = document.createElement('div'); back.id = 'payBillBack'; document.body.appendChild(back); }
  back.setAttribute('style', 'position:fixed;inset:0;z-index:4000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(2px)');
  const inp = 'width:100%;font:inherit;font-size:15px;padding:11px 13px;border:1.5px solid var(--ql-border);border-radius:10px;outline:none;background:var(--ql-card);color:var(--ql-text);margin-top:6px';
  const lbl = 'display:block;font-size:12.5px;font-weight:600;color:var(--ql-text-secondary);margin-top:14px';
  back.innerHTML = `<div style="background:var(--ql-card);border-radius:16px;max-width:400px;width:100%;box-shadow:0 24px 60px rgba(15,23,42,.28);overflow:hidden;font-family:inherit">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--ql-border)">
      <div style="font-size:15px;font-weight:700;color:var(--ql-text)">Pay supplier</div>
      <button id="pbX" style="border:none;background:transparent;font-size:22px;line-height:1;color:var(--ql-text-muted);cursor:pointer">&times;</button>
    </div>
    <div style="padding:18px 20px">
      <div style="font-size:12.5px;color:var(--ql-text-muted)">${esc(r.sup)} · ${r.bills} open bill${r.bills > 1 ? 's' : ''} · <b style="color:var(--ql-danger-600)">${fC(r.out)}</b> payable</div>
      <label style="${lbl}">Amount paid<input id="pbAmt" type="number" min="0" value="${Math.round(r.out)}" style="${inp}"></label>
      <label style="${lbl}">Paid from<select id="pbMode" style="${inp}"><option>Bank</option><option>Cash</option><option>UPI</option><option>Cheque</option></select></label>
      <div style="font-size:11.5px;color:var(--ql-text-muted);margin-top:10px">Applied to the oldest bill first across their open bills, and posted to the cashbook.</div>
      <button id="pbGo" class="ql-btn ql-btn-primary" style="width:100%;margin-top:16px;justify-content:center">Pay bill</button>
    </div></div>`;
  const close = () => back.remove();
  back.onclick = e => { if (e.target === back) close(); };
  document.getElementById('pbX').onclick = close;
  document.getElementById('pbGo').onclick = () => {
    const amt = +document.getElementById('pbAmt').value || 0, method = document.getElementById('pbMode').value;
    if (amt <= 0) { toast('Enter an amount', 'err'); return; }
    const applied = applyPayment(r, amt, method);
    close(); if (QLX.close) QLX.close();
    toast('Paid ' + fC(applied) + ' to ' + r.sup, 'ok');
    QLX.refresh();
  };
}

function tabBills(r) {
  const kv = (l, v) => `<div class="qx-kv"><span>${l}</span><b>${v}</b></div>`;
  const comm = `<div class="qx-comm">
    ${r.phone ? `<a class="wa" href="${waLink(r.phone, 'Dear ' + r.sup + ', regarding pending payment.')}" target="_blank">${svg(IC.wa)} WhatsApp</a>` : ''}
    ${r.phone ? `<a class="call" href="tel:${esc(r.phone)}">${svg(IC.call)} Call</a>` : ''}
    ${!r.phone ? '<span class="qx-mut" style="font-size:12px">No phone on file — add it in Suppliers.</span>' : ''}</div>`;
  const bills = r.invs.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map(s => `<div class="qx-kv"><span>${esc(s.bill || '—')} · ${Q.fDS(s.date)}${s.status === 'partial' ? ' · <span style="color:#b45309">partial</span>' : ''}</span><b style="color:var(--ql-danger-600)">${fC(s.outstanding)}</b></div>`).join('');
  return `<div class="qx-sec-h">Supplier</div>
    <div style="font-weight:700;font-size:15px">${r.emoji} ${esc(r.sup)}</div>
    <div class="qx-mut" style="font-size:12.5px;margin-top:4px">${agePill(r)}</div>
    ${comm}
    <div class="qx-sec-h">Payable</div>
    ${kv('Total to pay', `<span style="color:var(--ql-danger-600);font-weight:700">${fC(r.out)}</span>`)}${kv('Open bills', r.bills)}${kv('Oldest', Q.fDS(r.oldest) + ' · ' + r.days + ' days')}${kv('Last bill', Q.fDS(r.last))}
    <div class="qx-sec-h">Open bills</div>${bills}`;
}

QLX.mount({
  active: 'payables', title: 'Payments Due', accent: 'blue', noun: 'supplier', nounPl: 'suppliers',
  icon: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  data: payRows, rowId: r => r.idx,
  subtitle: () => { const c = payRows(), tot = c.reduce((a, r) => a + r.out, 0), od = c.filter(r => r.days > 30).length; return `<b>${esc(Q.co.short)}</b> · ${fC(tot)} to pay across ${c.length} supplier${c.length === 1 ? '' : 's'} · ${od} overdue`; },
  tools: [{ label: 'Export', icon: IC.dl, onClick: () => exportPay() }],
  stats: () => {
    const c = payRows();
    const tot = c.reduce((a, r) => a + r.out, 0);
    const od = c.filter(r => r.days > 30), odAmt = od.reduce((a, r) => a + r.out, 0);
    const crit = c.filter(r => r.days > 60), critAmt = crit.reduce((a, r) => a + r.out, 0);
    const oldest = c.reduce((m, r) => Math.max(m, r.days), 0);
    return [
      { label: 'Total to pay', value: fC(tot), sub: c.length + ' suppliers', tint: 'blue', icon: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>' },
      { label: 'Overdue > 30 days', value: fC(odAmt), sub: od.length + ' suppliers', tint: 'amber', icon: IC.clock || '<circle cx="12" cy="12" r="9"/>' },
      { label: 'Critical > 60 days', value: fC(critAmt), sub: crit.length + ' suppliers', tint: 'rose', icon: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
      { label: 'Oldest bill', value: oldest + ' days', sub: 'since bill date', tint: 'violet', icon: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>' }
    ];
  },
  quickFilters: [
    { key: 'all', label: 'All', test: () => true },
    { key: 'recent', label: 'On time', test: r => r.bucket === 'recent' },
    { key: 'overdue', label: 'Overdue', test: r => r.days > 30 },
    { key: 'critical', label: 'Critical', test: r => r.days > 60 }
  ],
  search: (r, q) => (r.sup || '').toLowerCase().includes(q),
  sortDefault: { key: 'out', dir: 'desc' },
  columns: [
    { key: 'sr', label: '#', cell: (r, sr) => `<span class="qx-sr">${sr}</span>`, cls: 'qx-sr' },
    { key: 'sup', label: 'Supplier', sort: true, cell: r => `<span class="qx-party-n" style="font-weight:600">${esc(r.sup)}</span>` },
    { key: 'bills', label: 'Bills', sort: true, num: true, cell: r => `<span class="qx-mut">${r.bills}</span>` },
    { key: 'days', label: 'Aging', sort: true, cell: agePill },
    { key: 'last', label: 'Last bill', sort: true, cell: r => `<span class="qx-mut">${Q.fDS(r.last)}</span>` },
    { key: 'out', label: 'Payable', sort: true, num: true, cell: r => `<span class="qx-num" style="color:var(--ql-danger-600);font-weight:700">${fC(r.out)}</span>` },
    { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
  ],
  rowActions: r => [
    { tt: 'Details', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    { tt: 'Pay bill', icon: IC.check, cls: 'qx-ib-ok', onClick: r => payBill(r) }
  ],
  rowMenu: r => [
    { label: 'Pay bill', icon: IC.check, onClick: r => payBill(r) },
    { label: 'Details', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    ...(r.phone ? [{ label: 'WhatsApp', icon: IC.wa, onClick: r => window.open(waLink(r.phone, 'Dear ' + r.sup + ', '), '_blank') }, { label: 'Call', icon: IC.call, onClick: r => location.href = 'tel:' + r.phone }] : [])
  ],
  card: r => ({ id: r.sup, title: esc(r.sup), amount: fC(r.out), party: r.sup, partySub: r.bills + ' bills · ' + r.days + 'd', status: agePill(r), rows: [['Bills', r.bills], ['Oldest', r.days + ' days'], ['Payable', fC(r.out)]] }),
  footer: rows => { const t = rows.reduce((a, r) => a + r.out, 0); return [{ label: 'Suppliers', value: rows.length }, { label: 'To pay', value: fC(t), strong: true }]; },
  detail: r => ({
    eyebrow: 'Payable', title: esc(r.sup), sub: fC(r.out) + ' across ' + r.bills + ' bill' + (r.bills > 1 ? 's' : ''),
    actions: [
      { label: 'Pay bill', icon: IC.check, primary: true, onClick: r => payBill(r) },
      ...(r.phone ? [{ label: 'WhatsApp', icon: IC.wa, onClick: r => window.open(waLink(r.phone, 'Dear ' + r.sup + ', '), '_blank') }, { label: 'Call', icon: IC.call, onClick: r => location.href = 'tel:' + r.phone }] : [])
    ],
    tabs: [{ label: 'Open bills', icon: IC.file, render: tabBills }]
  })
});

(function () { const h = (location.hash || '').slice(1); if (['overdue', 'critical', 'recent'].includes(h)) { const S = QLX.state(); S.quick = h; QLX.refresh(); } })();
window.addEventListener('hashchange', () => { const h = (location.hash || '').slice(1); const S = QLX.state(); S.quick = ['overdue', 'critical', 'recent'].includes(h) ? h : 'all'; QLX.refresh(); });

function exportPay() { const r = payRows(); QLShell.exportCSV('payables_' + (Q.co.short || 'list').replace(/\s+/g, '_'), ['Supplier', 'Open Bills', 'Oldest (days)', 'Last Bill', 'Payable'], r.map(x => [x.sup, x.bills, x.days, x.last, x.out])); toast('Exported ' + r.length + ' suppliers'); }
