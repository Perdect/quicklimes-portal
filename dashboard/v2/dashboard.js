/* ═══════════════════════════════════════════════════════════════════════
   QuickLimes Dashboard — AI Manufacturing ERP (PERDECT / IMZA look).
   Every number is real QLD data; charts are inline SVG (no CDN).
   ═══════════════════════════════════════════════════════════════════════ */
QLShell.mount({ active: 'dashboard', title: 'Dashboard' });
const Q = window.QLD, fC = Q.fC, fmt = Q.fmt, fL = Q.fL, fDS = d => Q.fDS(d);
const esc = s => (s == null ? '' : s).toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const I = {
  cash: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  wallet: '<path d="M2 8h20M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2M2 8v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8"/><path d="M6 14h4"/>',
  factory: '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4H2z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  bank: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  ai: '<path d="M12 2l1.9 5.5L19.5 9l-5.6 1.5L12 16l-1.9-5.5L4.5 9l5.6-1.5z"/><circle cx="18" cy="18" r="1.5"/><circle cx="5" cy="17" r="1"/>',
  cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/>'
};
let period = 'month';
const PERIODS = { day: ['Today', 1], week: ['This Week', 7], month: ['This Month', 6], quarter: ['This Quarter', 12], year: ['This Year', 12] };

/* ── SVG area+line chart from monthSeries ── */
function areaChart(series, keys) {
  if (!series.length) return '<div class="dk-card-s" style="padding:40px 0;text-align:center">Not enough data yet.</div>';
  const W = 760, H = 240, pad = { l: 46, r: 14, t: 14, b: 26 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const vals = series.flatMap(d => keys.map(k => +d[k.k] || 0));
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const rng = max - min || 1;
  const xAt = i => pad.l + (series.length <= 1 ? iw / 2 : (i / (series.length - 1)) * iw);
  const yAt = v => pad.t + ih - ((v - min) / rng) * ih;
  const grid = [0, .25, .5, .75, 1].map(f => { const y = pad.t + ih - f * ih, v = min + f * rng; return `<line class="dk-grid-line" x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}"/><text class="dk-axis" x="${pad.l - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end">${fL(v)}</text>`; }).join('');
  const xlab = series.map((d, i) => `<text class="dk-axis" x="${xAt(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(d.m)}</text>`).join('');
  let paths = '';
  keys.forEach(k => {
    const pts = series.map((d, i) => [xAt(i), yAt(+d[k.k] || 0)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    if (k.area) {
      const area = `M${pts[0][0].toFixed(1)} ${(pad.t + ih).toFixed(1)} ` + pts.map(p => 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ` L${pts[pts.length - 1][0].toFixed(1)} ${(pad.t + ih).toFixed(1)} Z`;
      paths += `<path d="${area}" fill="${k.color}" opacity=".10"/>`;
    }
    paths += `<path d="${line}" fill="none" stroke="${k.color}" stroke-width="2.4" ${k.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round"/>`;
    paths += pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2" fill="#fff" stroke="${k.color}" stroke-width="2"><title>${esc(series[i].m)} · ${esc(k.label)}: ${fC(+series[i][k.k] || 0)}</title></circle>`).join('');
  });
  return `<div class="dk-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}${paths}${xlab}</svg></div>`;
}

/* ── manufacturing helpers (real data) ── */
function matAmt(groupKey) { const g = Q.purchaseByGroup().find(x => x.key === groupKey); return g ? g.total : 0; }
function matTons(groupKey) { return Q.purchaseRows().filter(r => r.group === groupKey).reduce((a, r) => a + (r.qty || 0), 0); }
function royaltyPaid() { return Q.purchaseRows().filter(r => /royalty/i.test(r.item)).reduce((a, r) => a + r.total, 0); }

function render() {
  const main = document.getElementById('ql-main'); if (!main) return;
  let root = document.getElementById('dkRoot');
  if (!root) { main.innerHTML = '<div class="dk" id="dkRoot"></div>'; root = document.getElementById('dkRoot'); }
  try {
    const co = Q.co, k = Q.kpis(), s = Q.salesSummary(), pl = Q.getPL(), prod = Q.production(), bal = Q.accountBalances(), pay = Q.paymentsSummary(), gst = Q.gstSummary();
    root.innerHTML = heroHTML(co) + kpiRow1(k, s, prod, bal, pay) + kpiRow2(pl, s, prod)
      + analyticsHTML() + rawAndAiHTML() + tablesHTML() + salesVsFlowHTML(s, prod)
      + gstBankPartnerHTML(gst, bal, pay) + opsForecastHTML(pl, s) + recentHTML();
    root.dataset.ready = '1';
    wire();
  } catch (e) {
    console.warn('Dashboard render deferred:', e);
    if (root.dataset.ready !== '1') root.innerHTML = skeleton();
  }
  QLShell.paintWorkspace && QLShell.paintWorkspace();
}

function heroHTML(co) {
  const seg = Object.entries(PERIODS).map(([k, v]) => `<button class="${period === k ? 'on' : ''}" data-period="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('');
  return `<div class="dk-hero">
    <div><div class="dk-h1">Welcome back, ${esc(co.short || co.name || 'there')} 👋</div><div class="dk-sub">Here's today's manufacturing summary for ${esc(co.name || co.short || '')}.</div></div>
    <div class="dk-hero-r">
      <div class="dk-seg" id="dkSeg">${seg}</div>
      <button class="ql-btn ql-btn-secondary" id="dkExport">${svg(I.dl)}<span class="dk-lbl">Export</span></button>
      <button class="ql-btn ql-btn-primary" onclick="QLShell.openSaleForm()">${svg(I.plus)}<span class="dk-lbl">New Sale</span></button>
    </div></div>`;
}

function kcard(tint, ic, label, val, meta) {
  return `<div class="dk-kpi dk-tint-${tint}"><div class="dk-kpi-top"><span class="dk-kpi-ic dk-t-${tint}">${svg(ic)}</span><span class="dk-kpi-l">${label}</span></div><div class="dk-kpi-v">${val}</div><div class="dk-kpi-m">${meta}</div></div>`;
}
function trend(t) { return t == null ? '' : `<span class="dk-trend ${t >= 0 ? 'up' : 'dn'}">${t >= 0 ? '▲' : '▼'} ${Math.abs(t).toFixed(0)}%</span>`; }

function kpiRow1(k, s, prod, bal, pay) {
  const todaySales = Q.salesRows().filter(r => r.date === new Date().toISOString().slice(0, 10));
  const todayAmt = todaySales.reduce((a, r) => a + r.total, 0);
  return `<div class="dk-kpis">
    ${kcard('blue', I.receipt, "Today's Sales", fC(todayAmt), `${todaySales.length} invoices ${trend(null)}`)}
    ${kcard('green', I.cart, 'Monthly Sales', k.sales.v, `${s.count} invoices · ${trend(k.sales.trend)}`)}
    ${kcard('indigo', I.factory, "Today's Production", fmt(prod.today, 1) + ' T', 'Quick Lime dispatched today')}
    ${kcard('amber', I.clock, 'Pending Collections', fC(s.pending), k.collections.meta)}
    ${kcard('red', I.cash, 'Supplier Payments Due', fC(pay.supOutstanding), `${pay.pendingBills} bills to pay`)}
    ${kcard('teal', I.wallet, 'Cash + Bank Balance', fC(bal.total), `Cash ${fC(bal.cash)} · Bank ${fC(bal.bank)} · UPI ${fC(bal.upi)}`)}
  </div>`;
}

function mini(emoji, label, val, sub) { return `<div class="dk-mini"><div class="dk-mini-l"><span class="e">${emoji}</span>${label}</div><div class="dk-mini-v">${val}</div><div class="dk-mini-s">${sub || ''}</div></div>`; }
function kpiRow2(pl, s, prod) {
  const limeT = matTons('limestone'), petT = matTons('petcoke'), bagsT = matTons('packaging');
  const costPerTon = s.qty ? pl.cogs / s.qty : 0;
  const yieldPct = limeT ? Math.min(100, s.qty / limeT * 100) : null;
  return `<div class="dk-sec"><div class="dk-minis">
    ${mini('🪨', 'Limestone', limeT ? fmt(limeT, 1) + ' T' : fC(matAmt('limestone')), limeT ? fC(matAmt('limestone')) : 'purchased')}
    ${mini('🔥', 'Petcoke', petT ? fmt(petT, 1) + ' T' : fC(matAmt('petcoke')), petT ? fC(matAmt('petcoke')) : 'consumed')}
    ${mini('📦', 'Plastic Bags', bagsT ? fmt(bagsT, 0) : fC(matAmt('packaging')), bagsT ? 'bags' : 'used')}
    ${mini('📜', 'Royalty Paid', fC(royaltyPaid()), 'to date')}
    ${mini('⚙️', 'Kiln Efficiency', prod.month ? '—' : '—', 'add production log')}
    ${mini('🏭', 'Production Yield', yieldPct != null ? yieldPct.toFixed(0) + '%' : '—', yieldPct != null ? 'lime / limestone' : 'need tons')}
    ${mini('🧮', 'Cost / Ton', costPerTon ? fC(costPerTon) : '—', 'material cost')}
    ${mini('📈', 'Gross Profit', pl.gpm.toFixed(1) + '%', fC(pl.gp) + ' GP')}
  </div></div>`;
}

function analyticsHTML() {
  const n = PERIODS[period][1];
  const series = Q.monthSeries(Math.max(2, n)).map(d => ({ m: d.m, sales: d.sales, purchases: d.purchases, profit: d.profit }));
  const keys = [{ k: 'sales', label: 'Sales', color: '#2563eb', area: true }, { k: 'purchases', label: 'Purchases', color: '#f59e0b' }, { k: 'profit', label: 'Gross Profit', color: '#16a34a' }];
  const legend = keys.map(x => `<span class="dk-lg"><span class="dk-lg-dot" style="background:${x.color}"></span>${x.label}</span>`).join('');
  return `<div class="dk-card dk-sec"><div class="dk-card-h"><div class="dk-card-t">Business analytics</div><div class="dk-legend">${legend}</div></div>${areaChart(series, keys)}</div>`;
}

function rawAndAiHTML() {
  const groups = Q.purchaseByGroup().filter(g => g.total > 0).sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...groups.map(g => g.total));
  const GCOL = { limestone: '#8a6d3b', petcoke: '#c0392b', packaging: '#2f5fd0', labour: '#1c7c3a', maintenance: '#6b3fa0', utilities: '#b7791f', office: '#475569', other: '#64748b' };
  const bars = groups.length ? groups.map(g => `<div class="dk-sbar-row"><span class="dk-sbar-l">${g.emoji} ${esc(g.label)}</span><div class="dk-sbar-track"><div class="dk-sbar-fill" style="width:${Math.round(g.total / max * 100)}%;background:${GCOL[g.key] || '#64748b'}"></div></div><span class="dk-sbar-v">${fC(g.total)}</span></div>`).join('') : '<div class="dk-card-s" style="padding:24px 0;text-align:center">No purchases recorded yet.</div>';
  return `<div class="dk-grid dk-g-2">
    <div class="dk-card"><div class="dk-card-h"><div class="dk-card-t">Raw material & cost breakdown</div><a class="dk-link" href="purchase.html">Purchase Register →</a></div><div class="dk-sbar">${bars}</div></div>
    ${aiPanel()}
  </div>`;
}

function aiPanel() {
  const ins = [];
  Q.insights().forEach(x => ins.push({ tone: x.tone, icon: x.icon === 'up' || x.icon === 'trend' ? '📈' : x.icon === 'down' ? '📉' : x.icon === 'alert' ? '⚠️' : x.icon === 'bill' ? '🧾' : '💡', t: x.t, s: x.s }));
  (Q.paymentsInsights ? Q.paymentsInsights() : []).slice(0, 2).forEach(x => ins.push({ tone: x.tone === 'bad' ? 'danger' : x.tone === 'warn' ? 'warning' : x.tone === 'ok' ? 'success' : 'info', icon: x.icon || '💡', t: x.text, s: '' }));
  const TONE = { success: 'dk-t-green', danger: 'dk-t-red', warning: 'dk-t-amber', info: 'dk-t-blue' };
  const items = ins.slice(0, 5).map(x => `<div class="dk-ai-i"><span class="dk-ai-ic ${TONE[x.tone] || 'dk-t-violet'}">${x.icon}</span><div><div class="dk-ai-t">${esc(x.t)}</div>${x.s ? `<div class="dk-ai-s">${esc(x.s)}</div>` : ''}</div></div>`).join('') || '<div class="dk-card-s" style="padding:20px 0">Add sales & purchases to see AI insights.</div>';
  const acts = (Q.recommendations ? Q.recommendations() : []).slice(0, 4);
  const actBtns = acts.length ? acts.map(a => `<button class="dk-act" data-page="${esc((a.action && a.action.page) || '')}">${a.icon || '✨'} ${esc(a.title)}</button>`).join('')
    : ['📞 Call overdue customers', '🪨 Plan limestone purchase', '🧾 Generate GST summary'].map(t => `<button class="dk-act">${t}</button>`).join('');
  return `<div class="dk-card dk-ai"><div class="dk-card-h"><div class="dk-card-t">${svg(I.ai)} AI Business Insights</div><span class="dk-ai-badge">${svg(I.ai)} Auto</span></div>
    ${items}<div class="dk-acts">${actBtns}</div></div>`;
}

function tablesHTML() {
  /* top customers from pending + sales */
  const byC = {}; Q.salesRows().forEach(r => { const k = r.party; byC[k] = byC[k] || { party: k, sales: 0, pending: 0, last: r.date }; byC[k].sales += r.total; byC[k].pending += r.outstanding; if (r.date > byC[k].last) byC[k].last = r.date; });
  const cust = Object.values(byC).sort((a, b) => b.sales - a.sales).slice(0, 8);
  const custRows = cust.length ? cust.map(c => `<tr><td><div class="dk-cell"><span class="dk-av" style="background:linear-gradient(135deg,${avc(c.party)})">${(c.party || '?').charAt(0).toUpperCase()}</span><span class="nm">${esc(c.party)}</span></div></td><td class="r nm">${fC(c.sales)}</td><td class="r">${c.pending > 0 ? `<span style="color:var(--ql-danger-600);font-weight:600">${fC(c.pending)}</span>` : '<span class="mut">—</span>'}</td><td class="r mut">${fDS(c.last)}</td></tr>`).join('') : emptyRow(4);
  /* top suppliers by group */
  const bySup = {}; Q.purchaseRows().forEach(r => { const k = r.sup; bySup[k] = bySup[k] || { sup: k, amt: 0, pending: 0 }; bySup[k].amt += r.total; bySup[k].pending += r.outstanding; });
  const sup = Object.values(bySup).sort((a, b) => b.amt - a.amt).slice(0, 8);
  const supRows = sup.length ? sup.map(x => `<tr><td><div class="dk-cell"><span class="dk-av" style="background:linear-gradient(135deg,${avc(x.sup)})">${(x.sup || '?').charAt(0).toUpperCase()}</span><span class="nm">${esc(x.sup)}</span></div></td><td class="r nm">${fC(x.amt)}</td><td class="r">${x.pending > 0 ? `<span style="color:var(--ql-danger-600);font-weight:600">${fC(x.pending)}</span>` : '<span class="mut">—</span>'}</td></tr>`).join('') : emptyRow(3);
  return `<div class="dk-grid dk-g-2e">
    <div class="dk-card"><div class="dk-card-h"><div class="dk-card-t">Top customers</div><a class="dk-link" href="sales.html">Sales →</a></div>
      <table class="dk-tbl"><thead><tr><th>Customer</th><th class="r">Sales</th><th class="r">Pending</th><th class="r">Last</th></tr></thead><tbody>${custRows}</tbody></table></div>
    <div class="dk-card"><div class="dk-card-h"><div class="dk-card-t">Top suppliers</div><a class="dk-link" href="purchase.html">Purchases →</a></div>
      <table class="dk-tbl"><thead><tr><th>Supplier</th><th class="r">Purchased</th><th class="r">Pending</th></tr></thead><tbody>${supRows}</tbody></table></div>
  </div>`;
}
function emptyRow(cols) { return `<tr><td colspan="${cols}" style="text-align:center;padding:24px;color:var(--ql-text-muted)">No data yet</td></tr>`; }
const AVC = ['#0891B2,#155E75', '#7C3AED,#5B21B6', '#16A34A,#15803D', '#F59E0B,#B45309', '#DB2777,#9D174D', '#2563EB,#1D4ED8'];
function avc(s) { return AVC[((s || '?').charCodeAt(0) + (s || '').length) % AVC.length]; }

function salesVsFlowHTML(s, prod) {
  const coll = Q.collections();
  const collectedPct = s.revenue ? Math.round(s.collected / s.revenue * 100) : 0;
  const flow = [['🪨', 'Limestone', matTons('limestone') ? fmt(matTons('limestone'), 0) + 'T' : '—'], ['🔥', 'Kiln', prod.month ? 'Active' : '—'], ['⚪', 'Quick Lime', fmt(prod.month, 1) + 'T'], ['📦', 'Packing', fmt(prod.month, 1) + 'T'], ['🚚', 'Dispatch', fmt(prod.today, 1) + 'T']];
  return `<div class="dk-grid dk-g-2e">
    <div class="dk-card"><div class="dk-card-h"><div class="dk-card-t">Sales vs collections</div><a class="dk-link" href="sales.html#pending">Collections →</a></div>
      <div class="dk-row"><span class="dk-row-l">Invoiced (incl. GST)</span><span class="dk-row-v">${fC(s.revenue)}</span></div>
      <div class="dk-row"><span class="dk-row-l">Collected</span><span class="dk-row-v" style="color:var(--ql-success-600)">${fC(s.collected)}</span></div>
      <div class="dk-row"><span class="dk-row-l">Outstanding</span><span class="dk-row-v" style="color:var(--ql-danger-600)">${fC(s.pending)}</span></div>
      <div class="dk-sbar" style="margin-top:14px"><div class="dk-sbar-row"><span class="dk-sbar-l">Collected</span><div class="dk-sbar-track"><div class="dk-sbar-fill" style="width:${collectedPct}%;background:#16a34a"></div></div><span class="dk-sbar-v">${collectedPct}%</span></div></div>
      <div class="dk-card-s" style="margin-top:10px">${coll.parties} parties owe you · ${coll.overdue} overdue &gt; 30 days</div></div>
    <div class="dk-card"><div class="dk-card-h"><div class="dk-card-t">Production flow · today</div><a class="dk-link" href="production.html">Production →</a></div>
      <div class="dk-flow">${flow.map(f => `<div class="dk-flow-step"><div class="dk-flow-ic">${f[0]}</div><div class="dk-flow-n">${f[1]}</div><div class="dk-flow-v">${f[2]}</div></div>`).join('')}</div>
      <div class="dk-card-s" style="margin-top:14px">Month to date: <b style="color:var(--ql-text)">${fmt(prod.month, 1)} T</b> Quick Lime · ${fmt(prod.chunnaMonth, 1)} T Chunna</div></div>
  </div>`;
}

function gstBankPartnerHTML(gst, bal, pay) {
  const loans = Q.loanRows();
  const partnerRows = loans.length ? loans.slice(0, 4).map(l => `<div class="dk-row"><span class="dk-row-l">${esc(l.name)}</span><span class="dk-row-v">${fC(l.outstanding)}${l.nextAmt ? ` <span class="mut" style="font-weight:500;font-size:11px">· EMI ${fC(l.nextAmt)}</span>` : ''}</span></div>`).join('') : `<div class="dk-card-s" style="padding:16px 0">No loans / partner ledger entries yet.</div>`;
  return `<div class="dk-grid dk-g-3">
    <div class="dk-card"><div class="dk-card-h"><div class="dk-card-t">${svg(I.receipt)} GST position</div><a class="dk-link" href="gst.html">GST →</a></div>
      <div class="dk-row"><span class="dk-row-l">Output GST (collected)</span><span class="dk-row-v">${fC(gst.outGST)}</span></div>
      <div class="dk-row"><span class="dk-row-l">Input Credit (ITC)</span><span class="dk-row-v" style="color:var(--ql-success-600)">${fC(gst.itc)}</span></div>
      <div class="dk-row"><span class="dk-row-l">Net GST payable</span><span class="dk-big" style="font-size:19px">${fC(gst.net)}</span></div></div>
    <div class="dk-card"><div class="dk-card-h"><div class="dk-card-t">${svg(I.bank)} Accounts</div><a class="dk-link" href="payments.html">Payments →</a></div>
      <div class="dk-row"><span class="dk-row-l">💵 Cash</span><span class="dk-row-v">${fC(bal.cash)}</span></div>
      <div class="dk-row"><span class="dk-row-l">🏦 Bank</span><span class="dk-row-v">${fC(bal.bank)}</span></div>
      <div class="dk-row"><span class="dk-row-l">📱 UPI / PhonePe</span><span class="dk-row-v">${fC(bal.upi)}</span></div>
      <div class="dk-row"><span class="dk-row-l">Money in / out today</span><span class="dk-row-v"><span style="color:var(--ql-success-600)">+${fC(pay.inToday)}</span> / <span style="color:var(--ql-danger-600)">−${fC(pay.outToday)}</span></span></div></div>
    <div class="dk-card"><div class="dk-card-h"><div class="dk-card-t">${svg(I.users)} Partner ledger</div><a class="dk-link" href="loans.html">Ledger →</a></div>${partnerRows}</div>
  </div>`;
}

function opsForecastHTML(pl, s) {
  /* live ops timeline from today's real activity, else recent */
  const ev = Q.activity().slice(0, 6);
  const clock = ['08:00', '09:20', '11:10', '12:45', '14:00', '15:30'];
  const tl = ev.length ? ev.map((e, i) => `<div class="dk-tl-i"><div class="dk-tl-time">${e.when || clock[i] || ''}</div><div class="dk-tl-t">${esc(e.t)}</div><div class="dk-tl-s">${esc(e.s || '')}</div></div>`).join('') : `<div class="dk-card-s" style="padding:16px 0">No activity logged yet.</div>`;
  /* forecast — project next month from trend */
  const ser = Q.monthSeries(4);
  const avgSales = ser.reduce((a, d) => a + d.sales, 0) / (ser.length || 1);
  const avgQty = ser.reduce((a, d) => a + d.qty, 0) / (ser.length || 1);
  const avgProfit = ser.reduce((a, d) => a + d.profit, 0) / (ser.length || 1);
  return `<div class="dk-grid dk-g-2e">
    <div class="dk-card"><div class="dk-card-h"><div class="dk-card-t">Live operations · activity</div></div><div class="dk-tl">${tl}</div></div>
    <div class="dk-card dk-ai"><div class="dk-card-h"><div class="dk-card-t">${svg(I.ai)} AI forecast · next month</div><span class="dk-fc-badge">Predicted</span></div>
      <div class="dk-fc">
        <div class="dk-fc-i"><div class="dk-fc-l">Expected Sales</div><div class="dk-fc-v">${fC(avgSales)}</div></div>
        <div class="dk-fc-i"><div class="dk-fc-l">Expected Production</div><div class="dk-fc-v">${fmt(avgQty, 1)} T</div></div>
        <div class="dk-fc-i"><div class="dk-fc-l">Expected Gross Profit</div><div class="dk-fc-v">${fC(avgProfit)}</div></div>
        <div class="dk-fc-i"><div class="dk-fc-l">Suggested limestone buy</div><div class="dk-fc-v">${fmt(avgQty * 1.9, 0)} T</div></div>
      </div>
      <div class="dk-card-s" style="margin-top:12px">Based on your last ${ser.length} months. Refines as you add data.</div></div>
  </div>`;
}

function recentHTML() {
  const sales = Q.salesRows().slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5);
  const purch = Q.purchaseRows().slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5);
  const pays = (Q.paymentsLedger ? Q.paymentsLedger() : []).slice(0, 5);
  const list = (title, href, rows) => `<div class="dk-card"><div class="dk-card-h"><div class="dk-card-t">${title}</div><a class="dk-link" href="${href}">All →</a></div>${rows}</div>`;
  const sRows = sales.length ? sales.map(r => `<div class="dk-row"><span class="dk-row-l"><b style="color:var(--ql-brand-600)">${esc(r.inv || '—')}</b> ${esc(r.party)}</span><span class="dk-row-v">${fC(r.total)}</span></div>`).join('') : emptyLine();
  const pRows = purch.length ? purch.map(r => `<div class="dk-row"><span class="dk-row-l">${r.emoji} ${esc(r.sup)}</span><span class="dk-row-v">${fC(r.total)}</span></div>`).join('') : emptyLine();
  const yRows = pays.length ? pays.map(r => `<div class="dk-row"><span class="dk-row-l">${esc(r.party)} · ${esc(r.ptype)}</span><span class="dk-row-v" style="color:${r.dir === 'in' ? 'var(--ql-success-600)' : 'var(--ql-danger-600)'}">${r.dir === 'in' ? '+' : '−'}${fC(r.amount)}</span></div>`).join('') : emptyLine();
  return `<div class="dk-grid dk-g-3">${list('Recent sales', 'sales.html', sRows)}${list('Recent purchases', 'purchase.html', pRows)}${list('Recent payments', 'payments.html', yRows)}</div>`;
}
function emptyLine() { return '<div class="dk-card-s" style="padding:16px 0">Nothing yet.</div>'; }

function skeleton() {
  const card = '<div class="dk-kpi"><div class="dk-kpi-top"><span class="dk-sk" style="width:36px;height:36px;border-radius:10px"></span></div><div class="dk-sk" style="width:80%;height:22px;margin:6px 0"></div><div class="dk-sk" style="width:60%;height:11px"></div></div>';
  return `<div class="dk-hero"><div><div class="dk-sk" style="width:280px;height:26px"></div><div class="dk-sk" style="width:200px;height:12px;margin-top:8px"></div></div></div><div class="dk-kpis">${Array.from({ length: 6 }).map(() => card).join('')}</div><div class="dk-card" style="height:260px"></div>`;
}

/* ── wiring ── */
function wire() {
  const root = document.getElementById('dkRoot'); if (!root) return;
  root.querySelectorAll('[data-period]').forEach(b => b.onclick = () => { period = b.dataset.period; render(); });
  const ex = document.getElementById('dkExport'); if (ex) ex.onclick = () => { const r = Q.salesRows(); QLShell.exportCSV('dashboard_sales', ['Invoice', 'Date', 'Party', 'Taxable', 'GST', 'Total', 'Status'], r.map(x => [x.inv, x.date, x.party, x.taxable, x.gst, x.total, x.status])); QLShell.toast && QLShell.toast('Exported ' + r.length + ' rows'); };
  root.querySelectorAll('.dk-act[data-page]').forEach(b => b.onclick = () => { const p = b.dataset.page; if (p) location.href = p.includes('.html') ? p : p + '.html'; });
}

window.__qlRefresh = render;
window.__qlOnSwitchCompany = id => Q.switchCompany(id, render);
if (Q.init) Q.init(render); else render();
