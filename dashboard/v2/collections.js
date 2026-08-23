/* ═══════════════════════════════════════════════════════════════════════
   Collections — dedicated receivables tool on the QLX workspace engine.
   Who owes money, how much, and how old — with one-tap WhatsApp reminders.
   Every number is real: unpaid sales invoices aggregated per customer.
   ═══════════════════════════════════════════════════════════════════════ */
const Q = window.QLD, fC = Q.fC;
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons;
const toast = (m, t) => QLX.toast(m, t);
/* Who we message is decided by wa-core's normalizePhone — the tested engine —
   never by a local copy. The copy that used to live here read:
     const n = d.length === 10 ? '91' + d : d;
   A number stored with the STD trunk 0 (09829069545) is ELEVEN digits, so the
   ===10 rule never fired, no country code was added, and wa.me was handed a
   number that is not the customer's. Best case it fails; worst case a stranger
   gets a demand for ₹1,30,000 in Gotan's name.
   wa-core already handled the trunk 0, the 0091 prefix, and the 6-9 mobile
   check, and it returns '' rather than GUESS — which degrades to WhatsApp's own
   contact picker instead of a wrong recipient. The same broken copy still exists
   in ledger/purchase/parties/payables; they are being moved onto this too. */
function waLink(phone, text) {
  if (window.WACore) return WACore.waLink(phone, text);
  return 'https://wa.me/?text=' + encodeURIComponent(text || '');   // engine absent: let the user pick, never guess a number
}
function fmtPlain(n) { return Math.round(n || 0).toLocaleString('en-IN'); }

function ageOf(dateStr) { const d = new Date((dateStr || '') + 'T00:00:00'); const n = Math.floor((new Date() - d) / 86400000); return isFinite(n) && n >= 0 ? n : 0; }
function bucketOf(days) { return days > 60 ? 'critical' : days > 30 ? 'overdue' : 'recent'; }
const BUCKET = { recent: ['On track', '#ecfdf3', '#15803d'], overdue: ['Overdue', '#fef6ee', '#c2610c'], critical: ['Critical', '#fef2f2', '#dc2626'] };
function agePill(r) { const b = BUCKET[r.bucket]; return `<span class="qx-pill" style="background:${b[1]};color:${b[2]}">${b[0]} · ${r.days}d</span>`; }

/* Aggregate every unpaid sales invoice into one row per customer. */
/* `period` narrows to invoices DATED in that month/year — "what of June's
   sales is still uncollected". Aging stays vs today; no period = everything. */
function collectRows(period) {
  /* One row per REAL customer, resolved by GSTIN — not per spelling.
     This is the highest-stakes grouping in the app: reminderMsg() turns each row
     into a WhatsApp message stating "₹X is pending against N invoices". Keying by
     the raw name split one customer into two rows, so that message went out
     quoting PART of what was owed — to a real person, over a real number.
     The party index spans sales AND the party master together, so an invoice and
     the contact record resolve to the same key and the phone is found even when
     the two spell the name differently. */
  const sales = Q.salesRows().filter(s => s.status !== 'cancelled' && (s.outstanding || 0) > 0 &&
    (!period || Q.inPeriod(s.date, period)));
  const parties = Q.partyRows();
  const idx = QLParty.index(
    sales.map(s => ({ n: s.party, g: s.gstin })).concat(parties.map(p => ({ n: p.name, g: p.gstin }))),
    r => r.n, r => r.g);

  const phoneOf = {};
  parties.forEach(p => { const k = idx.keyOf(p.name, p.gstin); if (p.phone && !phoneOf[k]) phoneOf[k] = p.phone; });

  const byP = {};
  sales.forEach(s => {
    const k = idx.keyOf(s.party, s.gstin);
    (byP[k] = byP[k] || { key: k, party: idx.labelOf(k), gstin: idx.gstinFor(k), out: 0, bills: 0, oldest: s.date, last: s.date, invs: [] });
    byP[k].out += s.outstanding; byP[k].bills++; byP[k].invs.push(s);
    if ((s.date || '') < byP[k].oldest) byP[k].oldest = s.date;
    if ((s.date || '') > byP[k].last) byP[k].last = s.date;
  });
  return Object.values(byP).map((r, i) => {
    const days = ageOf(r.oldest);
    return Object.assign(r, { idx: i, days, bucket: bucketOf(days), phone: phoneOf[r.key] || '' });
  }).sort((a, b) => b.out - a.out);
}

/* MONEY ACTIONS NEVER INHERIT THE VIEW'S PERIOD. A June-scoped row says what
   June still owes; a reminder built from it would tell a real customer that
   PART of their debt is the whole of it, and a receive dialog would prefill a
   partial amount. Every reminder/receipt path resolves the party's COMPLETE
   row first. The table stays scoped — only the actions reach for everything. */
function fullRow(r) {
  if (!QLX.month()) return r;
  return collectRows(null).find(x => x.key === r.key) || r;
}
function reminderMsg(rr) {
  const r = fullRow(rr);
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
  return `${QLX.month() ? '<div style="font-size:11.5px;color:var(--ql-text-muted);padding:4px 0 8px">Showing ' + esc(Q.periodLabel(QLX.month())) + ' invoices only — reminders and receipts always use the complete account.</div>' : ''}<div class="qx-sec-h">Customer</div>
    <div style="font-weight:700;font-size:15px">${esc(r.party)}</div>
    <div class="qx-mut" style="font-size:12.5px;margin-top:4px">${agePill(r)}</div>
    ${comm}
    <div class="qx-sec-h">Outstanding</div>
    ${kv('Total to collect', `<span style="color:var(--ql-danger-600);font-weight:700">${fC(r.out)}</span>`)}${kv('Pending invoices', r.bills)}${kv('Oldest', Q.fDS(r.oldest) + ' · ' + r.days + ' days')}${kv('Last sale', Q.fDS(r.last))}
    <div class="qx-sec-h">Pending invoices</div>${bills}`;
}

/* Apply a received amount oldest-bill-first across a customer's pending
   invoices (each posts to the cashbook via receiveSalesPayment). */
function applyReceipt(r, amount, method) {
  let remaining = amount, applied = 0;
  r.invs.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(b => {
    if (remaining <= 0.5) return;
    const pay = Math.min(remaining, b.outstanding);
    if (pay > 0.5) { Q.receiveSalesPayment(b.idx, { amount: pay, method }); remaining -= pay; applied += pay; }
  });
  return applied;
}
function receivePayment(rr) {
  const r = fullRow(rr);   // receive against the whole account, not the month's slice
  let back = document.getElementById('collPayBack');
  if (!back) { back = document.createElement('div'); back.id = 'collPayBack'; document.body.appendChild(back); }
  back.setAttribute('style', 'position:fixed;inset:0;z-index:4000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(2px)');
  const inp = 'width:100%;font:inherit;font-size:15px;padding:11px 13px;border:1.5px solid var(--ql-border);border-radius:10px;outline:none;background:var(--ql-card);color:var(--ql-text);margin-top:6px';
  const lbl = 'display:block;font-size:12.5px;font-weight:600;color:var(--ql-text-secondary);margin-top:14px';
  back.innerHTML = `<div style="background:var(--ql-card);border-radius:16px;max-width:400px;width:100%;box-shadow:0 24px 60px rgba(15,23,42,.28);overflow:hidden;font-family:inherit">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--ql-border)">
      <div style="font-size:15px;font-weight:700;color:var(--ql-text)">Receive payment</div>
      <button id="cpX" style="border:none;background:transparent;font-size:22px;line-height:1;color:var(--ql-text-muted);cursor:pointer">&times;</button>
    </div>
    <div style="padding:18px 20px">
      <div style="font-size:12.5px;color:var(--ql-text-muted)">${esc(r.party)} · ${r.bills} pending invoice${r.bills > 1 ? 's' : ''} · <b style="color:var(--ql-danger-600)">${fC(r.out)}</b> due</div>
      <label style="${lbl}">Amount received<input id="cpAmt" type="number" min="0" value="${Math.round(r.out)}" style="${inp}"></label>
      <label style="${lbl}">Method<select id="cpMode" style="${inp}"><option>Bank</option><option>Cash</option><option>UPI</option><option>Cheque</option></select></label>
      <div style="font-size:11.5px;color:var(--ql-text-muted);margin-top:10px">Applied to the oldest bill first across their pending invoices, and posted to the cashbook.</div>
      <button id="cpGo" class="ql-btn ql-btn-primary" style="width:100%;margin-top:16px;justify-content:center">Receive payment</button>
    </div></div>`;
  const close = () => back.remove();
  back.onclick = e => { if (e.target === back) close(); };
  document.getElementById('cpX').onclick = close;
  document.getElementById('cpGo').onclick = () => {
    const amt = +document.getElementById('cpAmt').value || 0, method = document.getElementById('cpMode').value;
    if (amt <= 0) { toast('Enter an amount', 'err'); return; }
    const applied = applyReceipt(r, amt, method);
    close(); if (QLX.close) QLX.close();
    toast('Received ' + fC(applied) + ' from ' + r.party, 'ok');
    QLX.refresh();
  };
}

QLX.mount({
  active: 'collections', title: 'Collections', accent: 'blue', noun: 'customer', nounPl: 'customers',
  icon: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  data: () => collectRows(QLX.month()), rowId: r => r.idx,
  monthFilter: 'self', monthDefault: 'all',
  monthsOf: () => [...new Set(Q.salesRows()
    .filter(s => s.status !== 'cancelled' && (s.outstanding || 0) > 0)
    .map(s => (s.date || '').slice(0, 7)).filter(m => m.length === 7))],
  subtitle: () => { const m = QLX.month(), c = collectRows(m), tot = c.reduce((a, r) => a + r.out, 0), od = c.filter(r => r.days > 30).length; return `<b>${esc(Q.co.short)}</b> · ${fC(tot)} to collect from ${c.length} customer${c.length === 1 ? '' : 's'} · ${od} overdue${m ? ' · invoices of ' + esc(Q.periodLabel(m)) : ''}`; },
  // The count is the point: "Reminders" is a chore, "Reminders (7)" is a to-do.
  // Computed from the real plan, so it can never promise work that isn't there.
  tools: [
    { label: () => { const n = (window.QLWA ? QLWA.plan().length : 0); return 'Reminders' + (n ? ' (' + n + ')' : ''); }, icon: IC.wa, onClick: () => openReminders() },
    { label: 'Export', icon: IC.dl, onClick: () => exportColl() }
  ],
  stats: () => {
    const m = QLX.month(), c = collectRows(m);
    const tot = c.reduce((a, r) => a + r.out, 0);
    const od = c.filter(r => r.days > 30), odAmt = od.reduce((a, r) => a + r.out, 0);
    const crit = c.filter(r => r.days > 60), critAmt = crit.reduce((a, r) => a + r.out, 0);
    const oldest = c.reduce((m, r) => Math.max(m, r.days), 0);
    return [
      { label: 'Total to collect', value: fC(tot), sub: c.length + ' customers' + (m ? ' · ' + Q.periodLabel(m) + ' invoices' : ''), tint: 'blue', icon: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>' },
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
    { key: 'party', label: 'Customer', sort: true,
      cell: r => window.QLPartyLink ? QLPartyLink.chip({ name: r.party, gstin: r.gstin })
                                    : `<span class="qx-party-n" style="font-weight:600">${esc(r.party)}</span>` },
    { key: 'bills', label: 'Bills', sort: true, num: true, cell: r => `<span class="qx-mut">${r.bills}</span>` },
    { key: 'days', label: 'Aging', sort: true, cell: agePill },
    { key: 'last', label: 'Last sale', sort: true, cell: r => `<span class="qx-mut">${Q.fDS(r.last)}</span>` },
    { key: 'out', label: 'Outstanding', sort: true, num: true, cell: r => `<span class="qx-num" style="color:var(--ql-danger-600);font-weight:700">${fC(r.out)}</span>` },
    { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
  ],
  rowActions: r => [
    { tt: 'Details', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    ...(r.phone ? [{ tt: 'Send WhatsApp reminder', icon: IC.wa, onClick: r => window.open(waLink(r.phone, reminderMsg(r)), '_blank') }] : []),
    { tt: 'Receive payment', icon: IC.check, cls: 'qx-ib-ok', onClick: r => receivePayment(r) }
  ],
  rowMenu: r => [
    /* Every row reaches the customer: one shared definition, so the
       menu cannot drift between registers. Empty when the party
       cannot be identified with certainty. */
    ...(window.QLPartyLink ? QLPartyLink.actions({ name: r.party, gstin: r.gstin }) : []),

    { label: 'Receive payment', icon: IC.check, onClick: r => receivePayment(r) },
    { label: 'Details', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    ...(r.phone ? [{ label: 'WhatsApp reminder', icon: IC.wa, onClick: r => window.open(waLink(r.phone, reminderMsg(r)), '_blank') }, { label: 'Call', icon: IC.call, onClick: r => location.href = 'tel:' + r.phone }] : [])
  ],
  card: r => ({ id: r.party, title: esc(r.party), amount: fC(r.out), party: r.party, partySub: r.bills + ' bills · ' + r.days + 'd', status: agePill(r), rows: [['Bills', r.bills], ['Oldest', r.days + ' days'], ['Outstanding', fC(r.out)]] }),
  footer: rows => { const t = rows.reduce((a, r) => a + r.out, 0); return [{ label: 'Customers', value: rows.length }, { label: 'To collect', value: fC(t), strong: true }]; },
  detail: r => ({
    eyebrow: 'Collection', title: esc(r.party), sub: fC(r.out) + ' across ' + r.bills + ' invoice' + (r.bills > 1 ? 's' : ''),
    actions: [
      { label: 'Receive payment', icon: IC.check, primary: true, onClick: r => receivePayment(r) },
      ...(r.phone ? [{ label: 'Send reminder', icon: IC.wa, onClick: r => window.open(waLink(r.phone, reminderMsg(r)), '_blank') }, { label: 'Call', icon: IC.call, onClick: r => location.href = 'tel:' + r.phone }] : [])
    ],
    tabs: [{ label: 'Outstanding', icon: IC.file, render: tabBills }]
  })
});

/* deep-link: #overdue / #critical pre-filter (from dashboard / badge). */
(function () { const h = (location.hash || '').slice(1); if (['overdue', 'critical', 'recent'].includes(h)) { const S = QLX.state(); S.quick = h; QLX.refresh(); } })();
window.addEventListener('hashchange', () => { const h = (location.hash || '').slice(1); const S = QLX.state(); S.quick = ['overdue', 'critical', 'recent'].includes(h) ? h : 'all'; QLX.refresh(); });

/* Reminder Center — the scheduled, deduped, logged view of who to chase today.
   The table below stays party-level ("who owes what"); this is day-level
   ("who is due a nudge today"), driven by wa-core.js. */
function openReminders() { if (window.QLWA) QLWA.open(); else toast('Reminder engine not loaded', 'err'); }

function exportColl() { const m = QLX.month(), r = collectRows(m); QLShell.exportCSV('collections_' + (Q.co.short || 'list').replace(/\s+/g, '_') + (m ? '_' + m : ''), ['Customer', 'Pending Bills', 'Oldest (days)', 'Last Sale', 'Outstanding'], r.map(x => [x.party, x.bills, x.days, x.last, x.out])); toast('Exported ' + r.length + ' customers'); }
