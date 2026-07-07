/* ═══════════════════════════════════════════════════════════════════════
   Collections — dedicated receivables tool on the QLX workspace engine.
   Who owes money, how much, and how old — with one-tap WhatsApp reminders.
   Every number is real: unpaid sales invoices aggregated per customer.
   ═══════════════════════════════════════════════════════════════════════ */
const Q = window.QLD, fC = Q.fC;
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons;
const toast = (m, t) => QLX.toast(m, t);
function waLink(phone, text) { const d = (phone || '').replace(/\D/g, ''); const n = d.length === 10 ? '91' + d : d; return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text || ''); }
function fmtPlain(n) { return Math.round(n || 0).toLocaleString('en-IN'); }

function ageOf(dateStr) { const d = new Date((dateStr || '') + 'T00:00:00'); const n = Math.floor((new Date() - d) / 86400000); return isFinite(n) && n >= 0 ? n : 0; }
function bucketOf(days) { return days > 60 ? 'critical' : days > 30 ? 'overdue' : 'recent'; }
const BUCKET = { recent: ['On track', '#ecfdf3', '#15803d'], overdue: ['Overdue', '#fef6ee', '#c2610c'], critical: ['Critical', '#fef2f2', '#dc2626'] };
function agePill(r) { const b = BUCKET[r.bucket]; return `<span class="qx-pill" style="background:${b[1]};color:${b[2]}">${b[0]} · ${r.days}d</span>`; }

/* Aggregate every unpaid sales invoice into one row per customer. */
function collectRows() {
  const byP = {}, phoneOf = {};
  Q.partyRows().forEach(p => { phoneOf[(p.name || '').toUpperCase()] = p.phone || ''; });
  Q.salesRows().forEach(s => {
    if (s.status === 'cancelled' || (s.outstanding || 0) <= 0) return;
    const k = s.party || '—';
    (byP[k] = byP[k] || { party: k, out: 0, bills: 0, oldest: s.date, last: s.date, invs: [] });
    byP[k].out += s.outstanding; byP[k].bills++; byP[k].invs.push(s);
    if ((s.date || '') < byP[k].oldest) byP[k].oldest = s.date;
    if ((s.date || '') > byP[k].last) byP[k].last = s.date;
  });
  return Object.values(byP).map((r, i) => {
    const days = ageOf(r.oldest);
    return Object.assign(r, { idx: i, days, bucket: bucketOf(days), phone: phoneOf[(r.party || '').toUpperCase()] || '' });
  }).sort((a, b) => b.out - a.out);
}

function reminderMsg(r) {
  return `Dear ${r.party}, a gentle reminder from ${Q.co.short || 'us'}: ₹${fmtPlain(r.out)} is pending against ${r.bills} invoice${r.bills > 1 ? 's' : ''} (oldest ${r.days} days). Kindly arrange the payment at your earliest convenience. Thank you.`;
}

function tabBills(r) {
  const kv = (l, v) => `<div class="qx-kv"><span>${l}</span><b>${v}</b></div>`;
  const comm = `<div class="qx-comm">
    ${r.phone ? `<a class="wa" href="${waLink(r.phone, reminderMsg(r))}" target="_blank">${svg(IC.wa)} Send reminder</a>` : ''}
    ${r.phone ? `<a class="call" href="tel:${esc(r.phone)}">${svg(IC.call)} Call</a>` : ''}
    ${!r.phone ? '<span class="qx-mut" style="font-size:12px">No phone on file — add it in All Parties to enable reminders.</span>' : ''}</div>`;
  const bills = r.invs.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map(s => `<div class="qx-kv"><span>${esc(s.inv || '—')} · ${Q.fDS(s.date)}${s.status === 'partial' ? ' · <span style="color:#b45309">partial</span>' : ''}</span><b style="color:var(--ql-danger-600)">${fC(s.outstanding)}</b></div>`).join('');
  return `<div class="qx-sec-h">Customer</div>
    <div style="font-weight:700;font-size:15px">${esc(r.party)}</div>
    <div class="qx-mut" style="font-size:12.5px;margin-top:4px">${agePill(r)}</div>
    ${comm}
    <div class="qx-sec-h">Outstanding</div>
    ${kv('Total to collect', `<span style="color:var(--ql-danger-600);font-weight:700">${fC(r.out)}</span>`)}${kv('Pending invoices', r.bills)}${kv('Oldest', Q.fDS(r.oldest) + ' · ' + r.days + ' days')}${kv('Last sale', Q.fDS(r.last))}
    <div class="qx-sec-h">Pending invoices</div>${bills}`;
}

QLX.mount({
  active: 'collections', title: 'Collections', accent: 'blue', noun: 'customer', nounPl: 'customers',
  icon: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  data: collectRows, rowId: r => r.idx,
  subtitle: () => { const c = collectRows(), tot = c.reduce((a, r) => a + r.out, 0), od = c.filter(r => r.days > 30).length; return `<b>${esc(Q.co.short)}</b> · ${fC(tot)} to collect from ${c.length} customer${c.length === 1 ? '' : 's'} · ${od} overdue`; },
  tools: [{ label: 'Export', icon: IC.dl, onClick: () => exportColl() }],
  stats: () => {
    const c = collectRows();
    const tot = c.reduce((a, r) => a + r.out, 0);
    const od = c.filter(r => r.days > 30), odAmt = od.reduce((a, r) => a + r.out, 0);
    const crit = c.filter(r => r.days > 60), critAmt = crit.reduce((a, r) => a + r.out, 0);
    const oldest = c.reduce((m, r) => Math.max(m, r.days), 0);
    return [
      { label: 'Total to collect', value: fC(tot), sub: c.length + ' customers', tint: 'blue', icon: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>' },
      { label: 'Overdue > 30 days', value: fC(odAmt), sub: od.length + ' customers', tint: 'amber', icon: IC.clock || '<circle cx="12" cy="12" r="9"/>' },
      { label: 'Critical > 60 days', value: fC(critAmt), sub: crit.length + ' customers', tint: 'rose', icon: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
      { label: 'Oldest receivable', value: oldest + ' days', sub: 'since invoice', tint: 'violet', icon: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>' }
    ];
  },
  quickFilters: [
    { key: 'all', label: 'All', test: () => true },
    { key: 'recent', label: 'On track', test: r => r.bucket === 'recent' },
    { key: 'overdue', label: 'Overdue', test: r => r.days > 30 },
    { key: 'critical', label: 'Critical', test: r => r.days > 60 }
  ],
  search: (r, q) => (r.party || '').toLowerCase().includes(q),
  sortDefault: { key: 'out', dir: 'desc' },
  columns: [
    { key: 'sr', label: '#', cell: (r, sr) => `<span class="qx-sr">${sr}</span>`, cls: 'qx-sr' },
    { key: 'party', label: 'Customer', sort: true, cell: r => `<span class="qx-party-n" style="font-weight:600">${esc(r.party)}</span>` },
    { key: 'bills', label: 'Bills', sort: true, num: true, cell: r => `<span class="qx-mut">${r.bills}</span>` },
    { key: 'days', label: 'Aging', sort: true, cell: agePill },
    { key: 'last', label: 'Last sale', sort: true, cell: r => `<span class="qx-mut">${Q.fDS(r.last)}</span>` },
    { key: 'out', label: 'Outstanding', sort: true, num: true, cell: r => `<span class="qx-num" style="color:var(--ql-danger-600);font-weight:700">${fC(r.out)}</span>` },
    { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
  ],
  rowActions: r => [
    { tt: 'Details', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    ...(r.phone ? [{ tt: 'Send WhatsApp reminder', icon: IC.wa, cls: 'qx-ib-ok', onClick: r => window.open(waLink(r.phone, reminderMsg(r)), '_blank') }] : [])
  ],
  rowMenu: r => [
    { label: 'Details', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    ...(r.phone ? [{ label: 'WhatsApp reminder', icon: IC.wa, onClick: r => window.open(waLink(r.phone, reminderMsg(r)), '_blank') }, { label: 'Call', icon: IC.call, onClick: r => location.href = 'tel:' + r.phone }] : [])
  ],
  card: r => ({ id: r.party, title: esc(r.party), amount: fC(r.out), party: r.party, partySub: r.bills + ' bills · ' + r.days + 'd', status: agePill(r), rows: [['Bills', r.bills], ['Oldest', r.days + ' days'], ['Outstanding', fC(r.out)]] }),
  footer: rows => { const t = rows.reduce((a, r) => a + r.out, 0); return [{ label: 'Customers', value: rows.length }, { label: 'To collect', value: fC(t), strong: true }]; },
  detail: r => ({
    eyebrow: 'Collection', title: esc(r.party), sub: fC(r.out) + ' across ' + r.bills + ' invoice' + (r.bills > 1 ? 's' : ''),
    actions: [
      ...(r.phone ? [{ label: 'Send reminder', icon: IC.wa, primary: true, onClick: r => window.open(waLink(r.phone, reminderMsg(r)), '_blank') }, { label: 'Call', icon: IC.call, onClick: r => location.href = 'tel:' + r.phone }] : [])
    ],
    tabs: [{ label: 'Outstanding', icon: IC.file, render: tabBills }]
  })
});

/* deep-link: #overdue / #critical pre-filter (from dashboard / badge). */
(function () { const h = (location.hash || '').slice(1); if (['overdue', 'critical', 'recent'].includes(h)) { const S = QLX.state(); S.quick = h; QLX.refresh(); } })();
window.addEventListener('hashchange', () => { const h = (location.hash || '').slice(1); const S = QLX.state(); S.quick = ['overdue', 'critical', 'recent'].includes(h) ? h : 'all'; QLX.refresh(); });

function exportColl() { const r = collectRows(); QLShell.exportCSV('collections_' + (Q.co.short || 'list').replace(/\s+/g, '_'), ['Customer', 'Pending Bills', 'Oldest (days)', 'Last Sale', 'Outstanding'], r.map(x => [x.party, x.bills, x.days, x.last, x.out])); toast('Exported ' + r.length + ' customers'); }
