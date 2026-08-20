/* ═══════════════════════════════════════════════════════════════════════
   Customer Intelligence — AI-powered CRM on the QLX workspace engine.
   Every number is derived from the real sales & purchase registers:
   health score, RFM segments, receivable aging, monthly trend, AI insights.
   #supplier / #customer deep-links pre-filter by party type.
   ═══════════════════════════════════════════════════════════════════════ */
const Q = window.QLD, fC = Q.fC;
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons;
const toast = (m, t) => QLX.toast(m, t);
const up = s => (s || '').toUpperCase();
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
/* Compose the WhatsApp message from real data: pending amount + oldest overdue invoice. */
function waReminder(r) {
  const co = Q.co.short || Q.co.name || 'us';
  if (r && r.salesDue > 0.5) {
    const oldest = (r.invoices || []).filter(s => s.outstanding > 0.5).sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0];
    const ref = oldest ? `\nOldest pending: invoice #${oldest.inv || '—'} dated ${Q.fDS(oldest.date)} — ${fC(oldest.outstanding)}.` : '';
    return `Dear ${r.name},\nGentle reminder from ${co}: ${fC(r.salesDue)} is currently outstanding on your account.${ref}\nKindly arrange the payment at your convenience. Thank you.`;
  }
  return `Dear ${r ? r.name : 'Sir/Madam'},\nThank you for your business with ${co}. Please let us know if you need a fresh quote or a dispatch — happy to help.`;
}
const hash = () => (location.hash || '').toLowerCase();
const isSup = () => hash().indexOf('supplier') >= 0, isCust = () => hash().indexOf('customer') >= 0;

/* ── reference "now" = latest SALES activity (this is customer/sales intelligence, so
      recency, aging & the monthly window anchor on sales; falls back to purchases, then
      the wall clock). Keeps a historical dataset meaningful instead of all-dormant. ── */
function refNow() {
  let mx = ''; Q.salesRows().forEach(s => { if (s.date > mx) mx = s.date; });
  if (!mx) Q.purchaseRows().forEach(p => { if (p.date > mx) mx = p.date; });
  return mx ? new Date(mx) : new Date();
}
// recomputed on every render (data.js can settle its rows after this script first runs)
let NOW = refNow();
function syncNow() { NOW = refNow(); }
function dDays(d) { if (!d) return 99999; const t = new Date(d); return isNaN(t) ? 99999 : Math.max(0, Math.round((NOW - t) / 864e5)); }
function relDays(n) { if (n >= 99999) return 'never'; if (n <= 0) return 'today'; if (n === 1) return 'yesterday'; if (n < 30) return n + 'd ago'; if (n < 60) return '1mo ago'; if (n < 365) return Math.round(n / 30) + 'mo ago'; return Math.round(n / 365) + 'y ago'; }

/* ── monthly buckets (last n months, index 0 = oldest) ── */
function monthly(rows, n) {
  const arr = Array.from({ length: n }, () => 0);
  const base = new Date(NOW.getFullYear(), NOW.getMonth(), 1);
  rows.forEach(s => { const d = new Date(s.date); if (isNaN(d)) return; const mi = (base.getFullYear() - d.getFullYear()) * 12 + (base.getMonth() - d.getMonth()); const i = n - 1 - mi; if (i >= 0 && i < n) arr[i] += s.total; });
  return arr;
}

/* ── resolve a transaction (name + GSTIN) to a party record: GSTIN → normalized
      name → first significant token. In production upsertParty keeps names identical,
      but hand-entered data can use short forms ("ARIF" ↔ "ARIF CHEMICAL LIME"). ── */
const _norm = s => up(s).replace(/[^A-Z0-9]+/g, ' ').trim();
const _tok = s => _norm(s).split(' ')[0] || '';
function buildResolver(parties) {
  const byGst = {}, byNorm = {}, byTok = {};
  parties.forEach(p => {
    if (p.gstin) byGst[up(p.gstin)] = p.idx;
    const nm = _norm(p.name); if (nm) byNorm[nm] = p.idx;
    const t = _tok(p.name); if (t && byTok[t] === undefined) byTok[t] = p.idx;
  });
  return (name, gstin) => {
    if (gstin && byGst[up(gstin)] !== undefined) return byGst[up(gstin)];
    const nm = _norm(name); if (nm && byNorm[nm] !== undefined) return byNorm[nm];
    const t = _tok(name); if (t && byTok[t] !== undefined) return byTok[t];
    return -1;
  };
}

/* ═══════════ ENRICHMENT — turn each party into an intelligence record ═══════════ */
function enriched() {
  syncNow();
  const parties = Q.partyRows();
  const resolve = buildResolver(parties);
  const salesBy = {}, purBy = {};
  Q.salesRows().forEach(s => {
    const k = resolve(s.party, s.gstin); if (k < 0) return;
    const b = salesBy[k] || (salesBy[k] = { amt: 0, due: 0, paid: 0, n: 0, last: '', rows: [], overdue: 0 });
    b.amt += s.total; b.due += s.outstanding; b.paid += s.paid; b.n++; if (s.date > b.last) b.last = s.date; b.rows.push(s);
    if (s.outstanding > 0.5 && dDays(s.date) > 30) b.overdue += s.outstanding;
  });
  Q.purchaseRows().forEach(p => {
    const k = resolve(p.sup, p.gstin); if (k < 0) return;
    const b = purBy[k] || (purBy[k] = { amt: 0, due: 0, paid: 0, n: 0, last: '', rows: [] });
    b.amt += p.total; b.due += p.outstanding; b.paid += (p.paid || 0); b.n++; if (p.date > b.last) b.last = p.date; b.rows.push(p);
  });
  const totalRev = Object.values(salesBy).reduce((a, b) => a + b.amt, 0) || 1;
  const revSorted = Object.values(salesBy).map(b => b.amt).sort((a, b) => b - a);
  const top20cut = revSorted.length ? revSorted[Math.max(0, Math.floor(revSorted.length * 0.2) - 1)] : Infinity;

  return parties.map(r => {
    const s = salesBy[r.idx] || { amt: 0, due: 0, paid: 0, n: 0, last: '', rows: [], overdue: 0 };
    const p = purBy[r.idx] || { amt: 0, due: 0, paid: 0, n: 0, last: '', rows: [] };
    const salesRec = s.last ? dDays(s.last) : 99999;
    const recDays = s.last ? salesRec : (p.last ? dDays(p.last) : 99999);
    const collRate = s.amt > 0 ? Math.min(1, s.paid / s.amt) : 1;
    // health = payments(40) + timeliness(25) + recency(20) + loyalty(15)
    const hPay = s.amt > 0 ? collRate * 40 : 20;
    const hTime = s.amt > 0 ? 25 - Math.min(25, (s.overdue / s.amt) * 50) : 25;
    const hRec = s.n > 0 ? 20 - Math.min(20, salesRec / 7) : 8;
    const hLoy = Math.min(15, s.n * 3);
    const health = Math.max(0, Math.min(100, Math.round(hPay + hTime + hRec + hLoy)));
    const avgOrder = s.n ? s.amt / s.n : 0;
    const share = s.amt / totalRev;
    const spark = monthly(s.rows, 6);
    let seg;
    if (s.n === 0) seg = 'prospect';
    else if (s.overdue > 0 && s.overdue / s.amt > 0.12 && health < 62) seg = 'atrisk';
    else if (salesRec > 75) seg = 'dormant';
    else if (s.amt >= top20cut && health >= 64) seg = 'vip';
    else if (s.n <= 1 && salesRec <= 45) seg = 'new';
    else seg = 'regular';
    // ── Running account (bank-ledger model): receivable-positive convention ──
    const opening = +r.opening || 0;
    const currentBalance = opening + s.amt - s.paid - p.amt + p.paid + (Q.ledgerNet ? Q.ledgerNet(r.idx) : 0);  // + = they owe us, − = we owe them
    const advance = currentBalance < 0 ? -currentBalance : 0;
    const creditLimit = +r.creditLimit || 0;
    const creditUtil = creditLimit > 0 ? Math.max(0, currentBalance) / creditLimit : null;
    return Object.assign({}, r, {
      salesAmt: s.amt, salesDue: s.due, salesPaid: s.paid, salesN: s.n, salesLast: s.last, overdue: s.overdue,
      invoices: s.rows.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')),
      purAmt: p.amt, purDue: p.due, purPaid: p.paid, purN: p.n, purLast: p.last, purRows: p.rows,
      business: s.amt + p.amt, due: s.due + p.due, recDays, salesRec, collRate, health,
      hc: { pay: hPay, time: hTime, rec: hRec, loy: hLoy }, avgOrder, share, spark, seg,
      opening, currentBalance, advance, creditLimit, creditUtil
    });
  });
}

/* ═══════════ visual atoms ═══════════ */
const SEG = {
  vip: { label: 'VIP', bg: '#fef3c7', fg: '#b45309', dot: '#f59e0b' },
  regular: { label: 'Regular', bg: '#eff4ff', fg: '#1d4ed8', dot: '#3b82f6' },
  new: { label: 'New', bg: '#ecfdf3', fg: '#15803d', dot: '#22c55e' },
  atrisk: { label: 'At-risk', bg: '#fef2f2', fg: '#b91c1c', dot: '#ef4444' },
  dormant: { label: 'Dormant', bg: '#f1f5f9', fg: '#475569', dot: '#94a3b8' },
  prospect: { label: 'Prospect', bg: '#f5f3ff', fg: '#6d28d9', dot: '#8b5cf6' }
};
function segPill(r) { const c = SEG[r.seg] || SEG.regular; return `<span class="crm-seg" style="--sb:${c.bg};--sf:${c.fg}"><i style="background:${c.dot}"></i>${c.label}</span>`; }
const AV_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
function initials(n) { const p = (n || '?').trim().split(/\s+/); const a = (p[0] || '')[0] || ''; const b = p[1] ? (p[1][0] || '') : ''; return (a + b).toUpperCase() || '?'; }
function avColor(n) { let h = 0; for (let i = 0; i < (n || '').length; i++) h = (h * 31 + n.charCodeAt(i)) & 0xffff; return AV_COLORS[h % AV_COLORS.length]; }
function avatar(r, size) { const c = avColor(r.name); return `<span class="crm-av" style="--av:${c};width:${size || 34}px;height:${size || 34}px;font-size:${(size || 34) * 0.38}px">${esc(initials(r.name))}</span>`; }
function healthColor(h) { return h >= 75 ? '#16a34a' : h >= 55 ? '#d97706' : '#dc2626'; }
function healthBar(h) { const c = healthColor(h); return `<div class="crm-hb"><div class="crm-hb-t"><div class="crm-hb-f" style="width:${h}%;background:${c}"></div></div><b style="color:${c}">${h}</b></div>`; }
function healthRing(h, size) {
  const c = healthColor(h), sz = size || 88, r = sz / 2 - 7, C = 2 * Math.PI * r, off = C * (1 - h / 100);
  return `<div class="crm-ring" style="width:${sz}px;height:${sz}px"><svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}">
    <circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="var(--ql-neutral-150,#eef1f6)" stroke-width="7"/>
    <circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${sz / 2} ${sz / 2})"/></svg>
    <div class="crm-ring-v"><b style="color:${c}">${h}</b><span>/100</span></div></div>`;
}
function sparkSVG(arr, w, h, color) {
  w = w || 84; h = h || 26; const mx = Math.max(1, ...arr), n = arr.length;
  const pts = arr.map((v, i) => [(n < 2 ? w : i / (n - 1) * w), h - 2 - (v / mx) * (h - 5)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1], col = color || 'var(--qx,#2563eb)';
  const gid = 'sg' + Math.round(arr.reduce((a, v) => a + v, 0)) + '_' + n + '_' + Math.round(mx);
  return `<svg class="crm-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs><path d="${line} L ${w} ${h} L 0 ${h} Z" fill="url(#${gid})"/><path d="${line}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.1" fill="${col}"/></svg>`;
}
function miniBars(arr, labels) {
  const mx = Math.max(1, ...arr);
  return `<div class="crm-mbars">${arr.map((v, i) => `<div class="crm-mbar"><div class="crm-mbar-t"><div class="crm-mbar-f" style="height:${Math.max(3, v / mx * 100)}%"></div></div><span>${labels ? labels[i] : ''}</span></div>`).join('')}</div>`;
}
function monLabel(i, n) { const d = new Date(NOW.getFullYear(), NOW.getMonth() - (n - 1 - i), 1); return d.toLocaleDateString('en-IN', { month: 'short' }); }

/* ═══════════ AI insights (rule-based, on real data) ═══════════ */
function insights(rows) {
  const cust = rows.filter(r => r.salesN > 0);
  const out = [];
  if (cust.length) {
    const top = cust.slice().sort((a, b) => b.salesAmt - a.salesAmt)[0];
    out.push({ ic: '🏆', tone: 'blue', t: `${top.name} is your top customer`, d: `${fC(top.salesAmt)} · ${Math.round(top.share * 100)}% of all revenue across ${top.salesN} orders.` });
  }
  const over = cust.filter(r => r.overdue > 0).sort((a, b) => b.overdue - a.overdue);
  if (over.length) { const sum = over.reduce((a, r) => a + r.overdue, 0); out.push({ ic: '⏰', tone: 'rose', t: `${over.length} customer${over.length > 1 ? 's' : ''} overdue >30 days`, d: `${fC(sum)} to collect — ${over[0].name} owes the most (${fC(over[0].overdue)}).` }); }
  const dorm = cust.filter(r => r.seg === 'dormant').sort((a, b) => b.salesAmt - a.salesAmt);
  if (dorm.length) { const sum = dorm.reduce((a, r) => a + r.salesAmt, 0); out.push({ ic: '😴', tone: 'slate', t: `${dorm.length} dormant customer${dorm.length > 1 ? 's' : ''} to win back`, d: `No orders in 75+ days · ${fC(sum)} of past business — ${dorm[0].name} was the biggest.` }); }
  const vip = cust.filter(r => r.seg === 'vip'); if (vip.length) { const ah = Math.round(vip.reduce((a, r) => a + r.health, 0) / vip.length); out.push({ ic: '⭐', tone: 'amber', t: `${vip.length} VIP customer${vip.length > 1 ? 's' : ''}`, d: `Avg health ${ah}/100 — your most valuable, reliable buyers. Protect these.` }); }
  const fresh = cust.filter(r => r.seg === 'new'); if (fresh.length) out.push({ ic: '🌱', tone: 'green', t: `${fresh.length} new customer${fresh.length > 1 ? 's' : ''}`, d: `Recently acquired — a follow-up now builds the repeat habit.` });
  return out.slice(0, 3);
}
function bannerHTML(all) {
  const cards = insights(all); if (!cards.length) return '';
  return `<div class="crm-ai">
    <div class="crm-ai-head">${svg('<path d="M12 2l1.9 5.8L20 9.5l-4.9 3.6L16.8 19 12 15.4 7.2 19l1.7-5.9L4 9.5l6.1-1.7z"/>')}<span>AI Insights</span><em>auto-generated from your registers</em></div>
    <div class="crm-ai-grid">${cards.map(c => `<div class="crm-ai-c t-${c.tone}"><div class="crm-ai-ic">${c.ic}</div><div class="crm-ai-tx"><b>${esc(c.t)}</b><span>${esc(c.d)}</span></div></div>`).join('')}</div>
  </div>`;
}

/* ═══════════ drawer tabs ═══════════ */
function kv(l, v) { return `<div class="qx-kv"><span>${l}</span><b>${v}</b></div>`; }
function statusPill(st) { const m = { paid: ['#dcfce7', '#166534'], cash: ['#dcfce7', '#166534'], partial: ['#fef9c3', '#854d0e'], pending: ['#fee2e2', '#991b1b'], cancelled: ['#f1f5f9', '#64748b'] }; const c = m[st] || m.pending; const lbl = (st || 'pending'); return `<span class="crm-st" style="background:${c[0]};color:${c[1]}">${esc(lbl[0].toUpperCase() + lbl.slice(1))}</span>`; }

function tabOverview(r) {
  const comm = `<div class="qx-comm">
    ${r.phone ? `<a class="wa" href="${waLink(r.phone, waReminder(r))}" target="_blank">${svg(IC.wa)} WhatsApp</a>` : ''}
    ${r.phone ? `<a class="call" href="tel:${esc(r.phone)}">${svg(IC.call)} Call</a>` : ''}
    ${!r.phone ? '<span class="qx-mut" style="font-size:12px">No phone on file — add it to enable contact.</span>' : ''}</div>`;
  const bc = r.currentBalance > 0.5 ? 'var(--ql-danger-600)' : r.currentBalance < -0.5 ? '#16a34a' : 'var(--ql-text)';
  const hero = `<div class="crm-dhero">
    ${healthRing(r.health)}
    <div class="crm-dhero-x">
      <div>${segPill(r)}</div>
      <div class="crm-dhero-m"><b style="color:${bc}">${drcr(r.currentBalance)}</b><span>current balance</span></div>
      <div class="crm-dhero-sub">${fC(r.business)} lifetime · ${r.salesN} orders${r.advance > 0.5 ? ' · <span style="color:#16a34a">' + fC(Math.round(r.advance)) + ' advance</span>' : ''}</div>
    </div></div>`;
  return hero +
    `<div class="qx-sec-h">Contact</div>
    <div class="crm-mut" style="font-size:12.5px">${r.gstin ? 'GSTIN ' + esc(r.gstin) : 'No GSTIN'}${r.state ? ' · ' + esc(r.state) : ''}${r.phone ? ' · ' + esc(r.phone) : ''}</div>
    ${comm}
    ${r.address ? `<div class="qx-sec-h">Address</div><div style="font-size:13px">${esc(r.address)}</div>` : ''}
    ${r.salesN ? `<div class="qx-sec-h">As customer</div>${kv('Orders', r.salesN)}${kv('Total sales', fC(r.salesAmt))}${kv('Avg order', fC(Math.round(r.avgOrder)))}${kv('Collected', fC(Math.round(r.salesPaid)))}${kv('Receivable', r.salesDue ? `<span style="color:var(--ql-danger-600)">${fC(r.salesDue)}</span>` : '—')}${kv('Revenue share', Math.round(r.share * 100) + '%')}` : ''}
    ${r.purN ? `<div class="qx-sec-h">As supplier</div>${kv('Bills', r.purN)}${kv('Total purchases', fC(r.purAmt))}${kv('Payable', r.purDue ? `<span style="color:var(--ql-danger-600)">${fC(r.purDue)}</span>` : '—')}` : ''}
    ${r.notes ? `<div class="qx-sec-h">Notes</div><div style="font-size:13px">${esc(r.notes)}</div>` : ''}`;
}

function tabHealth(r) {
  if (!r.salesN) return `<div class="qx-empty" style="padding:30px">No sales history yet — health score needs orders to score.</div>`;
  const comp = [
    ['Payment behaviour', r.hc.pay, 40, `${Math.round(r.collRate * 100)}% of billed value collected`],
    ['Timeliness', r.hc.time, 25, r.overdue > 0 ? `${fC(r.overdue)} overdue >30 days` : 'No overdue balances'],
    ['Recency', r.hc.rec, 20, `Last order ${relDays(r.salesRec)}`],
    ['Loyalty', r.hc.loy, 15, `${r.salesN} order${r.salesN > 1 ? 's' : ''} placed`]
  ];
  return `<div class="crm-dhero" style="justify-content:center;padding:6px 0 14px">${healthRing(r.health, 104)}</div>
    <div class="qx-sec-h">Score breakdown</div>
    ${comp.map(c => { const pct = Math.round(c[1] / c[2] * 100), col = pct >= 70 ? '#16a34a' : pct >= 45 ? '#d97706' : '#dc2626'; return `<div class="crm-comp"><div class="crm-comp-h"><span>${c[0]}</span><b>${Math.round(c[1])}/${c[2]}</b></div><div class="crm-hb-t"><div class="crm-hb-f" style="width:${pct}%;background:${col}"></div></div><div class="crm-comp-d">${c[3]}</div></div>`; }).join('')}
    <div class="crm-note">Health blends how reliably a customer pays, how current they are, and how often they buy — a quick read on account risk &amp; value.</div>`;
}

function tabPayments(r) {
  if (!r.salesN) return `<div class="qx-empty" style="padding:30px">No invoices yet.</div>`;
  const buckets = [['0–30 days', 0, '#22c55e'], ['31–60 days', 0, '#f59e0b'], ['61–90 days', 0, '#f97316'], ['90+ days', 0, '#ef4444']];
  r.invoices.forEach(s => { if (s.outstanding <= 0.5) return; const a = dDays(s.date); const i = a <= 30 ? 0 : a <= 60 ? 1 : a <= 90 ? 2 : 3; buckets[i][1] += s.outstanding; });
  const anyDue = buckets.some(b => b[1] > 0), agMax = Math.max(1, ...buckets.map(x => x[1]));
  const collPct = Math.round(r.collRate * 100);
  return `<div class="crm-paygrid">
      <div class="crm-paycard"><span>Total billed</span><b>${fC(Math.round(r.salesAmt))}</b></div>
      <div class="crm-paycard"><span>Collected</span><b style="color:#16a34a">${fC(Math.round(r.salesPaid))}</b></div>
      <div class="crm-paycard"><span>Receivable</span><b style="color:${r.salesDue ? 'var(--ql-danger-600)' : 'inherit'}">${r.salesDue ? fC(Math.round(r.salesDue)) : '—'}</b></div>
      <div class="crm-paycard"><span>Avg order</span><b>${fC(Math.round(r.avgOrder))}</b></div>
    </div>
    <div class="qx-sec-h">Collection rate</div>
    <div class="crm-hb" style="margin-bottom:2px"><div class="crm-hb-t"><div class="crm-hb-f" style="width:${collPct}%;background:${collPct >= 80 ? '#16a34a' : collPct >= 50 ? '#d97706' : '#dc2626'}"></div></div><b>${collPct}%</b></div>
    <div class="qx-sec-h">Receivable aging</div>
    ${anyDue ? buckets.map(b => `<div class="qx-bar-row"><span class="qx-bar-lbl">${b[0]}</span><div class="qx-bar-track"><div class="qx-bar-fill" style="width:${Math.round(b[1] / agMax * 100)}%;background:${b[2]}"></div></div><span class="qx-bar-val">${b[1] ? fC(Math.round(b[1])) : '—'}</span></div>`).join('') : '<div class="crm-note" style="margin-top:0">✅ No outstanding balance — fully paid up.</div>'}`;
}

function tabOrders(r) {
  if (!r.invoices.length) return `<div class="qx-empty" style="padding:30px">No orders on record.</div>`;
  const bars = monthly(r.invoices, 6);
  const chart = bars.some(v => v > 0) ? `<div class="qx-sec-h">Last 6 months</div>${miniBars(bars, bars.map((_, i) => monLabel(i, 6)))}` : '';
  const list = r.invoices.slice(0, 40).map(s => `<div class="crm-tl">
      <div class="crm-tl-dot" style="background:${s.outstanding > 0.5 ? '#f59e0b' : '#22c55e'}"></div>
      <div class="crm-tl-b">
        <div class="crm-tl-r"><b>#${esc(s.inv || '—')}</b><span class="crm-num">${fC(s.total)}</span></div>
        <div class="crm-tl-r"><span class="crm-mut">${Q.fDS(s.date)}${s.veh ? ' · ' + esc(s.veh) : ''}</span>${statusPill(s.status)}</div>
        ${s.outstanding > 0.5 ? `<div class="crm-mut" style="color:var(--ql-danger-600);font-size:11.5px">${fC(s.outstanding)} outstanding</div>` : ''}
      </div></div>`).join('');
  return chart + `<div class="qx-sec-h">Order history (${r.invoices.length})</div><div class="crm-tlwrap">${list}</div>`;
}

/* ═══════════ RUNNING ACCOUNT LEDGER (bank-statement model) ═══════════
   Merges every money event chronologically into one running balance — NOT
   1-payment-1-invoice. Receivable-positive convention:
     Sales invoice = Debit (they owe more) · Receipt = Credit
     Purchase bill = Credit (we owe them) · Payment made = Debit
   Opening balance seeds the running total; advances fall out naturally as a
   negative balance. */
function buildLedger(r) {
  const ev = [];
  (r.invoices || []).forEach(s => {
    ev.push({ date: s.date, o: 1, ref: s.inv, desc: 'Sales Invoice', dr: s.total, cr: 0 });
    const pays = (s.payments && s.payments.length) ? s.payments : (s.paid > 0.5 ? [{ date: s.paidDate || s.date, amount: s.paid }] : []);
    pays.forEach(p => ev.push({ date: p.date || s.date, o: 2, ref: s.inv, desc: 'Payment received', dr: 0, cr: +p.amount || 0 }));
  });
  (r.purRows || []).forEach(b => {
    ev.push({ date: b.date, o: 1, ref: b.bill, desc: 'Purchase Bill', dr: 0, cr: b.total });
    const pays = (b.payments && b.payments.length) ? b.payments : (b.paid > 0.5 ? [{ date: b.date, amount: b.paid }] : []);
    pays.forEach(p => ev.push({ date: p.date || b.date, o: 2, ref: b.bill, desc: 'Payment made', dr: +p.amount || 0, cr: 0 }));
  });
  ev.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.o - b.o);
  let bal = +r.opening || 0;
  ev.forEach(e => { bal += e.dr - e.cr; e.bal = bal; });
  return { opening: +r.opening || 0, rows: ev, closing: bal };
}
function drcr(v) { const a = Math.round(Math.abs(v)); if (a < 1) return '₹0'; return fC(a) + ' ' + (v >= 0 ? 'Dr' : 'Cr'); }
function creditBar(r) {
  if (!(r.creditLimit > 0)) return '';
  const util = Math.max(0, r.currentBalance) / r.creditLimit, pct = Math.round(util * 100), over = util > 1;
  const col = over ? '#dc2626' : util > 0.8 ? '#d97706' : '#16a34a';
  return `<div class="qx-sec-h">Credit utilization</div><div class="crm-hb" style="margin-bottom:2px"><div class="crm-hb-t"><div class="crm-hb-f" style="width:${Math.min(100, pct)}%;background:${col}"></div></div><b style="color:${col}">${pct}%</b></div>` +
    (over ? `<div class="crm-note" style="margin-top:6px;color:#b91c1c">⚠️ Over credit limit by ${fC(Math.round(r.currentBalance - r.creditLimit))}.</div>` : '');
}
/* Record a receipt / payment straight against the party's running balance. */
function recordReceipt(r) {
  const isSupp = r.type === 'supplier';
  QLShell.openForm({
    title: isSupp ? 'Record payment made' : 'Record receipt', sub: r.name + ' · posts to the running balance',
    specs: [
      { k: 'amount', label: (isSupp ? 'Amount paid' : 'Amount received') + ' (₹)', type: 'number', req: true, reqNonZero: true },
      { k: 'date', label: 'Date', type: 'date', req: true },
      { k: 'mode', label: 'Mode', type: 'select', opts: Q.paymentMethods.map(m => [m, m]) },
      { k: 'ref', label: 'Reference no.', ph: 'UTR / cheque / txn id' },
      { k: 'desc', label: 'Note', type: 'textarea', full: true, ph: 'e.g. advance for July dispatch' }
    ],
    initial: { date: new Date().toISOString().slice(0, 10), mode: 'Bank' },
    saveLabel: isSupp ? 'Record payment' : 'Record receipt',
    onSave: v => {
      Q.recordLedgerEntry(r.idx, isSupp ? { dr: +v.amount, date: v.date, mode: v.mode, ref: v.ref, desc: v.desc } : { cr: +v.amount, date: v.date, mode: v.mode, ref: v.ref, desc: v.desc });
      toast(isSupp ? 'Payment recorded' : 'Receipt recorded', 'ok'); QLX.refresh();
    }
  });
}
function tabLedger(r) {
  const L = Q.partyLedger(r.idx) || { opening: 0, rows: [], closing: 0 };
  const bal = L.closing;
  const balCol = bal > 0.5 ? 'var(--ql-danger-600)' : bal < -0.5 ? '#16a34a' : 'var(--ql-text)';
  const head = `<div class="crm-ledger-act">
      <button class="ql-btn ql-btn-primary" onclick="PartiesLedger.receipt(${r.idx})">${svg(IC.plus)} ${r.type === 'supplier' ? 'Record payment' : 'Record receipt'}</button>
      <button class="ql-btn ql-btn-secondary" onclick="LedgerImport.open(${r.idx})">${svg(IC.dl)} Import ledger from Tally</button>
      <button class="ql-btn ql-btn-secondary" onclick="location.href='ledger.html?party=${r.idx}'">Full statement →</button>
    </div>
    <div class="crm-paygrid">
      <div class="crm-paycard"><span>Opening balance</span><b>${drcr(L.opening)}</b></div>
      <div class="crm-paycard"><span>Current balance</span><b style="color:${balCol}">${drcr(bal)}</b></div>
      ${r.advance > 0.5 ? `<div class="crm-paycard"><span>Advance held</span><b style="color:#16a34a">${fC(Math.round(r.advance))}</b></div>` : ''}
      ${r.creditLimit > 0 ? `<div class="crm-paycard"><span>Credit limit</span><b>${fC(r.creditLimit)}</b></div>` : ''}
    </div>${creditBar(r)}`;
  if (!L.rows.length) return head + `<div class="qx-empty" style="padding:24px">No ledger entries yet.</div>`;
  const rows = L.rows.slice().reverse().map(e => {
    const amt = e.dr ? `<span class="crm-num" style="color:var(--ql-danger-600)">+${fC(e.dr)}</span>` : `<span class="crm-num" style="color:#16a34a">−${fC(e.cr)}</span>`;
    return `<div class="crm-lrow"><div class="crm-ldot" style="background:${e.cr ? '#22c55e' : '#f59e0b'}"></div>
      <div class="crm-lmain"><div class="crm-lr"><b>${esc(e.desc)}${e.ref ? ' · #' + esc(e.ref) : ''}</b>${amt}</div>
      <div class="crm-lr"><span class="crm-mut">${Q.fDS(e.date)} · ${e.dr ? 'Debit' : 'Credit'}</span><span class="crm-mut">Bal ${drcr(e.bal)}</span></div></div></div>`;
  }).join('');
  return head + `<div class="qx-sec-h">Running statement (${L.rows.length})</div><div class="crm-ledger">${rows}</div>
    <div class="crm-note">Every invoice, receipt and payment posts to one running balance — partial payments, advances and overpayments all settle automatically against the account, not a single invoice.</div>`;
}

/* ═══════════ MOUNT ═══════════ */
QLX.mount({
  active: isSup() ? 'suppliers' : isCust() ? 'customers' : 'parties',
  title: isSup() ? 'Suppliers' : 'Customer Intelligence', accent: 'blue', noun: 'customer', nounPl: 'customers',
  icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  data: enriched, rowId: r => r.idx,
  subtitle: () => { const rows = enriched(), cust = rows.filter(r => r.salesN > 0), active = cust.filter(r => r.salesRec <= 45).length; return `<b>${esc(Q.co.short)}</b> · ${cust.length} customers · ${active} active · AI health scoring live`; },
  primary: { label: 'Add Party', icon: IC.plus, onClick: () => QLShell.openPartyForm() },
  emptySub: 'Add a customer or supplier to start tracking invoices, payments and ledgers.',
  tools: [
    // Count = customers past their OWN reorder rhythm. "Sales Intelligence" is a
    // menu item; "Sales Intelligence (4)" is a reason to open it.
    { label: () => { try { const n = QLICP.board().filter(r => r.status === 'overdue' || r.status === 'due').length; return 'Sales Intelligence' + (n ? ' (' + n + ')' : ''); } catch (_) { return 'Sales Intelligence'; } },
      icon: IC.spark || IC.eye, onClick: () => window.QLICP && QLICP.open() },
{ label: 'Export', icon: IC.dl, onClick: () => exportParties() }],
  views: ['table', 'cards', 'analytics'],
  banner: rows => bannerHTML(rows),
  stats: () => {
    const rows = enriched(), cust = rows.filter(r => r.salesN > 0);
    const active = cust.filter(r => r.salesRec <= 45).length;
    // portfolio receivable/overdue straight from the register (authoritative)
    let recv = 0, overdue = 0;
    Q.salesRows().forEach(s => { if (s.status === 'cancelled' || s.outstanding <= 0.5) return; recv += s.outstanding; if (dDays(s.date) > 30) overdue += s.outstanding; });
    const overN = rows.filter(r => r.overdue > 0).length;
    const avgH = cust.length ? Math.round(cust.reduce((a, r) => a + r.health, 0) / cust.length) : 0;
    const atrisk = rows.filter(r => r.seg === 'atrisk').length;
    const mom2 = monthly(Q.salesRows(), 2); const mom = mom2[0] ? (mom2[1] - mom2[0]) / mom2[0] * 100 : null;
    return [
      { label: 'Customers', value: cust.length, sub: active + ' active', tint: 'blue', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' },
      { label: 'Monthly Sales', value: fC(Math.round(mom2[1] || 0)), sub: 'vs last month', trend: mom, tint: 'green', icon: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>' },
      { label: 'Receivable', value: fC(recv), sub: overN + ' overdue · ' + fC(overdue), tint: 'amber', icon: IC.clock },
      { label: 'Avg Health', value: avgH + '/100', sub: 'portfolio health', tint: 'violet', icon: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>' },
      { label: 'At-risk', value: atrisk, sub: 'need attention', tint: 'rose', icon: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' }
    ];
  },
  quickFilters: [
    { key: 'all', label: 'All', test: () => true },
    { key: 'vip', label: '⭐ VIP', test: r => r.seg === 'vip' },
    { key: 'regular', label: 'Regular', test: r => r.seg === 'regular' },
    { key: 'new', label: 'New', test: r => r.seg === 'new' },
    { key: 'atrisk', label: 'At-risk', test: r => r.seg === 'atrisk' },
    { key: 'dormant', label: 'Dormant', test: r => r.seg === 'dormant' }
  ],
  search: (r, q) => (r.name + ' ' + r.gstin + ' ' + r.phone + ' ' + r.state + ' ' + (SEG[r.seg] || {}).label).toLowerCase().includes(q),
  filters: [
    { key: 'type', label: 'Type', options: () => [['customer', 'Customer'], ['supplier', 'Supplier'], ['both', 'Both']], test: (r, v) => r.type === v },
    { key: 'health', label: 'Health', options: () => [['hi', 'Healthy (75+)'], ['mid', 'Watch (55–74)'], ['lo', 'Weak (<55)']], test: (r, v) => v === 'hi' ? r.health >= 75 : v === 'mid' ? r.health >= 55 && r.health < 75 : r.salesN > 0 && r.health < 55 },
    { key: 'due', label: 'Receivable', options: () => [['due', 'Has receivable'], ['over', 'Overdue >30d'], ['clear', 'Fully paid']], test: (r, v) => v === 'due' ? r.salesDue > 0.5 : v === 'over' ? r.overdue > 0.5 : r.salesN > 0 && r.salesDue <= 0.5 },
    { key: 'state', label: 'State', options: rows => [...new Set(rows.map(r => r.state))].filter(Boolean).sort().map(s => [s, s]), test: (r, v) => r.state === v }
  ],
  groupBy: [
    { key: 'seg', label: 'Segment', of: r => r.seg, title: r => (SEG[r.seg] || SEG.regular).label, dot: r => (SEG[r.seg] || SEG.regular).dot },
    { key: 'type', label: 'Type', of: r => r.type, title: r => r.type[0].toUpperCase() + r.type.slice(1) + 's', dot: () => 'var(--qx)' },
    { key: 'state', label: 'State', of: r => r.state || '—', title: r => esc(r.state || '—'), dot: () => 'var(--qx)' }
  ],
  sortDefault: { key: 'salesAmt', dir: 'desc' },
  columns: [
    { key: 'sr', label: '#', cell: (r, sr) => `<span class="qx-sr">${sr}</span>`, cls: 'qx-sr' },
    { key: 'name', label: 'Customer', sort: true, cell: r => `<div class="crm-cust">${avatar(r)}<div class="crm-cust-t"><span class="crm-cust-n">${window.QLPartyLink ? QLPartyLink.chip({ name: r.name, gstin: r.gstin }) : esc(r.name)}</span><span class="crm-cust-s">${esc(r.state || r.gstin || r.phone || 'No GSTIN')}</span></div></div>` },
    { key: 'seg', label: 'Segment', sort: true, cell: segPill },
    { key: 'health', label: 'Health', sort: true, num: true, cell: r => r.salesN ? healthBar(r.health) : '<span class="qx-mut">—</span>' },
    { key: 'salesAmt', label: 'Business', sort: true, num: true, cell: r => `<span class="qx-num qx-strong">${fC(r.business)}</span>` },
    { key: 'salesDue', label: 'Receivable', sort: true, num: true, cell: r => r.salesDue ? `<span class="qx-num" style="color:var(--ql-danger-600);font-weight:600">${fC(r.salesDue)}${r.overdue ? ' <i class="crm-flag" title="overdue">!</i>' : ''}</span>` : '<span class="qx-mut">—</span>' },
    { key: 'salesN', label: 'Orders', sort: true, num: true, cell: r => r.salesN ? `<span class="qx-num">${r.salesN}</span><span class="crm-mut" style="display:block;font-size:11px">${relDays(r.salesRec)}</span>` : '<span class="qx-mut">—</span>' },
    { key: 'trend', label: 'Trend', cell: r => r.salesN ? sparkSVG(r.spark, 84, 26, avColor(r.name)) : '<span class="qx-mut">—</span>' },
    { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
  ],
  rowActions: r => [
    { tt: 'Profile', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    ...(r.phone ? [{ tt: 'WhatsApp', icon: IC.wa, cls: 'qx-ib-ok', onClick: r => window.open(waLink(r.phone, waReminder(r)), '_blank') }] : []),
    { tt: 'Edit', icon: IC.edit, onClick: r => QLShell.openPartyForm(r.idx) }
  ],
  rowMenu: r => [
    { label: 'Open profile', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    { label: 'Edit', icon: IC.edit, onClick: r => QLShell.openPartyForm(r.idx) },
    ...(r.phone ? [{ label: 'Call', icon: IC.call, onClick: r => location.href = 'tel:' + r.phone }] : []),
    ...(r.salesDue ? [{ label: 'Send reminder', icon: IC.wa, onClick: r => window.open(waLink(r.phone, `Dear ${r.name}, a gentle reminder — ${fC(r.salesDue)} is pending on your account. Thank you.`), '_blank') }] : []),
    { divider: true },
    { label: 'Archive', icon: IC.file, onClick: r => { Q.archiveRecord('party', r.idx, true); toast('Party archived — see Settings → Data Management → Archived'); QLX.refresh(); } },
    { label: 'Delete', icon: IC.trash, cls: 'del', onClick: r => { QLShell.confirmDelete({ title: 'Move party to Trash?', desc: r.name + ' will move to Trash and can be restored for 90 days. Their invoices and bills are not deleted.', confirmLabel: 'Move to Trash', onConfirm: reason => { Q.deleteParty(r.idx, reason); toast('Moved to Trash'); QLX.refresh(); } }); } }
  ],
  card: r => ({ id: r.name, title: esc(r.name), amount: fC(r.business), party: r.name, partySub: (SEG[r.seg] || SEG.regular).label + (r.salesN ? ' · health ' + r.health : ''), status: segPill(r), rows: [['Health', r.salesN ? healthBar(r.health) : '—'], ['Receivable', r.salesDue ? fC(r.salesDue) : '—'], ['Orders', r.salesN || '—']] }),
  footer: rows => { const b = rows.reduce((a, r) => a + r.business, 0), d = rows.reduce((a, r) => a + r.salesDue, 0); return [{ label: 'Customers', value: rows.length }, { label: 'Total Business', value: fC(b), strong: true }, { label: 'Receivable', value: fC(d) }]; },
  analytics: rows => {
    const cust = rows.filter(r => r.salesN > 0);
    const bars = cust.slice().sort((a, b) => b.salesAmt - a.salesAmt).slice(0, 8).map(r => ({ label: r.name, value: r.salesAmt, display: fC(r.salesAmt), color: avColor(r.name) }));
    const segCount = {}; cust.forEach(r => segCount[r.seg] = (segCount[r.seg] || 0) + 1);
    const donut = Object.keys(segCount).map(k => ({ label: (SEG[k] || SEG.regular).label, value: segCount[k], display: String(segCount[k]), color: (SEG[k] || SEG.regular).dot }));
    const ag = [['0–30 days', 0, '#22c55e'], ['31–60 days', 0, '#f59e0b'], ['61–90 days', 0, '#f97316'], ['90+ days', 0, '#ef4444']];
    Q.salesRows().forEach(s => { if (s.outstanding <= 0.5 || s.status === 'cancelled') return; const a = dDays(s.date); const i = a <= 30 ? 0 : a <= 60 ? 1 : a <= 90 ? 2 : 3; ag[i][1] += s.outstanding; });
    const agMax = Math.max(1, ...ag.map(x => x[1]));
    const trend = monthly(Q.salesRows(), 6);
    const extra = `<div class="qx-an-h">Receivable aging</div>
      ${ag.map(b => `<div class="qx-bar-row"><span class="qx-bar-lbl">${b[0]}</span><div class="qx-bar-track"><div class="qx-bar-fill" style="width:${Math.round(b[1] / agMax * 100)}%;background:${b[2]}"></div></div><span class="qx-bar-val">${b[1] ? fC(Math.round(b[1])) : '—'}</span></div>`).join('')}
      <div class="qx-an-h" style="margin-top:16px">Monthly sales — last 6 months</div>${miniBars(trend, trend.map((_, i) => monLabel(i, 6)))}`;
    return { barsTitle: 'Top customers by revenue', bars, donutTitle: 'Segment mix', donut, donutCenter: cust.length + '<span style="font-size:9px;display:block;font-weight:600;color:var(--ql-text-secondary)">customers</span>', extra };
  },
  detail: r => ({
    eyebrow: (SEG[r.seg] || SEG.regular).label + (r.type === 'supplier' ? ' · Supplier' : r.type === 'both' ? ' · Customer & Supplier' : ' · Customer'),
    title: esc(r.name), sub: (r.gstin ? 'GSTIN ' + esc(r.gstin) : 'No GSTIN') + (r.phone ? ' · ' + esc(r.phone) : ''),
    actions: [
      ...(r.phone ? [{ label: 'WhatsApp', icon: IC.wa, onClick: r => window.open(waLink(r.phone, waReminder(r)), '_blank') }, { label: 'Call', icon: IC.call, onClick: r => location.href = 'tel:' + r.phone }] : []),
      { label: r.type === 'supplier' ? 'Pay' : 'Receipt', icon: IC.plus, onClick: r => recordReceipt(r) },
      { label: 'Statement', icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="9" y1="7" x2="15" y2="7"/>', onClick: r => location.href = 'ledger.html?party=' + r.idx },
      { label: 'Edit', icon: IC.edit, primary: true, onClick: r => QLShell.openPartyForm(r.idx) }
    ],
    tabs: [
      { label: 'Overview', icon: IC.file, render: tabOverview },
      { label: 'Ledger', icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="9" y1="7" x2="15" y2="7"/>', render: tabLedger },
      { label: 'Health', icon: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l7.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>', render: tabHealth },
      { label: 'Payments', icon: (IC.cash || IC.clock), render: tabPayments },
      { label: 'Orders', icon: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/>', render: tabOrders }
    ]
  })
});

/* deep-link pre-filter (#supplier / #customer) → type filter */
(function () { const S = QLX.state(); if (isSup()) S.adv.type = 'supplier'; else if (isCust()) S.adv.type = 'customer'; QLX.refresh(); })();
window.addEventListener('hashchange', () => { const S = QLX.state(); S.adv.type = isSup() ? 'supplier' : isCust() ? 'customer' : ''; QLX.refresh(); });

// global for inline onclick in the ledger tab
window.PartiesLedger = { receipt(idx) { const r = enriched().find(x => x.idx === idx); if (r) recordReceipt(r); } };

function exportParties() { const r = enriched(); QLShell.exportCSV('customers_' + (Q.co.short || 'list').replace(/\s+/g, '_'), ['Name', 'Type', 'Segment', 'Health', 'GSTIN', 'Phone', 'State', 'Orders', 'Business', 'Receivable', 'Overdue', 'LastOrder'], r.map(x => [x.name, x.type, (SEG[x.seg] || {}).label, x.salesN ? x.health : '', x.gstin, x.phone, x.state, x.salesN, Math.round(x.business), Math.round(x.salesDue), Math.round(x.overdue), x.salesLast])); toast('Exported ' + r.length + ' parties'); }
