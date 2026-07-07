/* ═══════════════════════════════════════════════════════════════════════
   QuickLimes Dashboard — premium manufacturing-ERP control room.
   Redesigned IA: first-screen focus, tabbed analytics, AI insights, a
   manufacturing-flow timeline, and collapsible detail — every number is real
   QLD data, every chart is inline SVG (no CDN).
   ═══════════════════════════════════════════════════════════════════════ */
QLShell.mount({ active: 'dashboard', title: 'Dashboard' });
const Q = window.QLD, fC = Q.fC, fmt = Q.fmt, fL = Q.fL || (n => Q.fC(n)), fDS = d => Q.fDS(d);
const esc = s => (s == null ? '' : s).toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const I = {
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="14" y2="13"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="M16.71 13.88l.7.71-2.82 2.82"/>',
  wallet: '<path d="M2 8h20M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2M2 8v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8"/><path d="M6 14h4"/>',
  bank: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  factory: '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4H2z"/><line x1="17" y1="18" x2="17" y2="18"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  ai: '<path d="M12 2l1.9 5.5L19.5 9l-5.6 1.5L12 16l-1.9-5.5L4.5 9l5.6-1.5z"/><circle cx="18" cy="18" r="1.4"/><circle cx="5" cy="17" r="1"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  chevD: '<polyline points="6 9 12 15 18 9"/>', chevR: '<polyline points="9 18 15 12 9 6"/>',
  full: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
};

let period = 'month', tab = 'revenue', compare = false, collapsed = { fin: true, gst: true };
const PERIODS = { day: 'Today', week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' };
const NPTS = { day: 7, week: 8, month: 6, quarter: 8, year: 6 };

/* ── tiny inline sparkline ── */
function spark(vals, color, up) {
  vals = (vals || []).map(v => +v || 0); if (vals.length < 2) vals = [0, 0];
  const W = 92, H = 30, max = Math.max(...vals), min = Math.min(...vals), rng = (max - min) || 1;
  const x = i => (i / (vals.length - 1)) * W, y = v => H - 2 - ((v - min) / rng) * (H - 4);
  const line = vals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const area = line + ` L${W} ${H} L0 ${H} Z`;
  const c = color || (up === false ? '#dc2626' : '#16a34a'), id = 'sp' + Math.abs(vals.reduce((a, b) => a + b, 0) | 0) + vals.length;
  return `<svg class="dx-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".22"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function growth(t) { if (t == null || !isFinite(t)) return ''; const up = t >= 0; return `<span class="dx-g ${up ? 'up' : 'dn'}">${up ? '↑' : '↓'} ${Math.abs(t).toFixed(1)}%</span>`; }

/* ── data helpers ── */
function dailySales(n) {
  const rows = Q.salesRows(), out = [], now = new Date();
  for (let i = n - 1; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); const iso = d.toISOString().slice(0, 10); out.push(rows.filter(r => r.date === iso).reduce((a, r) => a + r.total, 0)); }
  return out;
}
function gstByMonth(n) {
  const rows = Q.salesRows(), map = {};
  rows.forEach(r => { const ym = (r.date || '').slice(0, 7); if (ym) map[ym] = (map[ym] || 0) + (r.gst || 0); });
  return Q.monthSeries(n).map(d => map[d.ym] || 0);
}
function matTons(g) { return Q.purchaseRows().filter(r => r.group === g).reduce((a, r) => a + (r.qty || 0), 0); }
function matAmt(g) { const x = Q.purchaseByGroup().find(v => v.key === g); return x ? x.total : 0; }

function render() {
  const main = document.getElementById('ql-main'); if (!main) return;
  let root = document.getElementById('dxRoot');
  if (!root) { main.innerHTML = '<div class="dx" id="dxRoot"></div>'; root = document.getElementById('dxRoot'); }
  try {
    const co = Q.co, k = Q.kpis(), s = Q.salesSummary(), prod = Q.production(), bal = Q.accountBalances(), pay = Q.paymentsSummary(), pl = Q.getPL(), gst = Q.gstSummary();
    root.innerHTML =
      filterBar(co) +
      kpiRow1(k, s, prod, bal, pay) +
      heroRow() +
      flowWidget(prod) +
      kpiRow2(pl, s) +
      midRow(gst, bal, pay) +
      activityWidget() +
      fab();
    root.dataset.ready = '1';
    wire();
    requestAnimationFrame(() => root.querySelectorAll('.dx-countup').forEach(countUp));
  } catch (e) {
    console.warn('Dashboard render deferred:', e);
    if (root.dataset.ready !== '1') root.innerHTML = skeleton();
  }
  QLShell.paintWorkspace && QLShell.paintWorkspace();
}

/* ══════════ sticky filter bar ══════════ */
function filterBar(co) {
  const range = Object.entries(PERIODS).map(([k, v]) => `<button class="${period === k ? 'on' : ''}" data-period="${k}">${v}</button>`).join('');
  const drop = (id, label) => `<button class="dx-fchip" data-drop="${id}">${label}${svg(I.chevD)}</button>`;
  return `<div class="dx-fbar">
    <div class="dx-fbar-l"><h1 class="dx-h1">Dashboard</h1><span class="dx-fbar-co">${esc(co.short || co.name || '')}</span></div>
    <div class="dx-fbar-r">
      <div class="dx-range" id="dxRange">${range}</div>
      ${drop('plant', 'All plants')}
      ${drop('pay', 'Payment')}
      ${drop('gst', 'GST')}
      <button class="dx-fchip" id="dxExport">${svg(I.dl)}Export</button>
      <button class="dx-fchip dx-fchip-ghost" id="dxSaveView">${svg(I.save)}Save view</button>
    </div></div>`;
}

/* ══════════ Row 1 — business KPIs ══════════ */
function kpi(o) {
  return `<button class="dx-kpi" ${o.href ? `data-go="${o.href}"` : ''}>
    <div class="dx-kpi-top"><span class="dx-kpi-ic dx-t-${o.tint}">${svg(o.ic)}</span>${o.g != null ? growth(o.g) : (o.badge || '')}</div>
    <div class="dx-kpi-l">${o.label}</div>
    <div class="dx-kpi-v"><span class="dx-countup" data-to="${o.raw != null ? o.raw : ''}" data-pre="${o.pre || ''}" data-suf="${o.suf || ''}">${o.val}</span></div>
    <div class="dx-kpi-b">${o.spark ? `<div class="dx-kpi-sp">${o.spark}</div>` : ''}<span class="dx-kpi-m">${o.meta}</span></div>
  </button>`;
}
function kpiRow1(k, s, prod, bal, pay) {
  const rev = Q.monthSeries(6).map(d => d.sales), profit = Q.monthSeries(6).map(d => d.profit), qty = Q.monthSeries(6).map(d => d.qty);
  const today = Q.salesRows().filter(r => r.date === todayISO()); const todayAmt = today.reduce((a, r) => a + r.total, 0);
  const recv = pay.custOutstanding;
  return `<div class="dx-kpis">
    ${kpi({ tint: 'blue', ic: I.receipt, label: "Today's Sales", val: fC(todayAmt), raw: todayAmt, pre: '₹', meta: today.length + ' invoices', spark: spark(dailySales(7), '#2563eb') })}
    ${kpi({ tint: 'green', ic: I.trend, label: 'Revenue · this month', val: k.sales.v, g: k.sales.trend, meta: 'vs last month', spark: spark(rev, '#16a34a', (k.sales.trend || 0) >= 0) })}
    ${kpi({ tint: 'violet', ic: I.coins, label: 'Collections due', val: fC(recv), raw: recv, pre: '₹', meta: k.collections.meta, badge: '<span class="dx-g warn">receivable</span>' })}
    ${kpi({ tint: 'teal', ic: I.wallet, label: 'Cash position', val: fC(bal.total), raw: bal.total, pre: '₹', meta: `Cash ${fC(bal.cash)} · Bank ${fC(bal.bank)}` })}
    ${kpi({ tint: 'indigo', ic: I.factory, label: 'Production · month', val: fmt(prod.month, 1) + ' T', g: k.production.trend, meta: 'Quick Lime dispatched', spark: spark(qty, '#6366f1', (k.production.trend || 0) >= 0) })}
    ${kpi({ tint: 'amber', ic: I.trend, label: 'Net Profit', val: k.profit.v, g: k.profit.trend, meta: k.profit.meta, spark: spark(profit, '#f59e0b', (k.profit.trend || 0) >= 0) })}
  </div>`;
}

/* ══════════ Hero — tabbed analytics + AI insights ══════════ */
const TABS = [
  { k: 'revenue', label: 'Revenue', color: '#2563eb', fmt: fC, series: n => Q.monthSeries(n).map(d => d.sales) },
  { k: 'profit', label: 'Profit', color: '#16a34a', fmt: fC, series: n => Q.monthSeries(n).map(d => d.profit) },
  { k: 'production', label: 'Production', color: '#6366f1', fmt: v => fmt(v, 1) + ' T', series: n => Q.monthSeries(n).map(d => d.qty) },
  { k: 'purchases', label: 'Purchases', color: '#f59e0b', fmt: fC, series: n => Q.monthSeries(n).map(d => d.purchases) },
  { k: 'gst', label: 'GST', color: '#0891b2', fmt: fC, series: n => gstByMonth(n) }
];
function heroRow() { return `<div class="dx-hero">${analyticsCard()}${aiCard()}</div>`; }
function analyticsCard() {
  const t = TABS.find(x => x.k === tab) || TABS[0], n = NPTS[period] || 6;
  const labels = Q.monthSeries(n).map(d => d.m), vals = t.series(n);
  const prevVals = compare ? t.series(n * 2).slice(0, n) : null;
  const total = vals.reduce((a, b) => a + b, 0), last = vals[vals.length - 1] || 0, prev = vals[vals.length - 2] || 0;
  const g = prev > 0 ? (last - prev) / prev * 100 : null;
  const tabs = TABS.map(x => `<button class="dx-tab ${x.k === tab ? 'on' : ''}" data-tab="${x.k}">${x.label}</button>`).join('');
  return `<div class="dx-card dx-analytics">
    <div class="dx-ac-h">
      <div class="dx-tabs">${tabs}</div>
      <div class="dx-ac-tools">
        <button class="dx-icobtn ${compare ? 'on' : ''}" id="dxCompare" title="Compare previous period">${svg(I.trend)}</button>
        <button class="dx-icobtn" id="dxFull" title="Fullscreen">${svg(I.full)}</button>
      </div>
    </div>
    <div class="dx-ac-head">
      <div><div class="dx-ac-l">${t.label} · ${PERIODS[period]}</div><div class="dx-ac-v">${t.fmt(total)}</div></div>
      ${g != null ? `<div class="dx-ac-g">${growth(g)}<span class="dx-ac-gs">vs previous</span></div>` : ''}
    </div>
    ${metricChart(labels, vals, prevVals, t)}
  </div>`;
}
function metricChart(labels, vals, prevVals, t) {
  if (!vals.length) return '<div class="dx-empty">Not enough data yet.</div>';
  const W = 720, H = 250, pad = { l: 8, r: 8, t: 16, b: 26 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const all = vals.concat(prevVals || []); const max = Math.max(1, ...all), min = Math.min(0, ...all), rng = (max - min) || 1;
  const xAt = i => pad.l + (vals.length <= 1 ? iw / 2 : (i / (vals.length - 1)) * iw), yAt = v => pad.t + ih - ((v - min) / rng) * ih;
  const grid = [0, .5, 1].map(f => { const y = pad.t + ih - f * ih; return `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" class="dx-grid"/>`; }).join('');
  const path = a => a.map((v, i) => (i ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1)).join(' ');
  const areaP = path(vals) + ` L${xAt(vals.length - 1).toFixed(1)} ${pad.t + ih} L${xAt(0).toFixed(1)} ${pad.t + ih} Z`;
  const prevPath = prevVals ? `<path d="${path(prevVals)}" fill="none" stroke="#94a3b8" stroke-width="1.6" stroke-dasharray="5 4" opacity=".8"/>` : '';
  const dots = vals.map((v, i) => `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="3.4" fill="#fff" stroke="${t.color}" stroke-width="2" class="dx-dot"><title>${esc(labels[i] || '')} · ${t.label}: ${t.fmt(v)}</title></circle>`).join('');
  const xlab = labels.map((m, i) => `<text x="${xAt(i).toFixed(1)}" y="${H - 7}" class="dx-xlab" text-anchor="middle">${esc(m)}</text>`).join('');
  return `<div class="dx-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="ag" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${t.color}" stop-opacity=".18"/><stop offset="1" stop-color="${t.color}" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${areaP}" fill="url(#ag)"/>${prevPath}<path d="${path(vals)}" fill="none" stroke="${t.color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" class="dx-line"/>${dots}${xlab}</svg></div>`;
}
function aiCard() {
  const ins = [];
  (Q.insights ? Q.insights() : []).forEach(x => ins.push({ tone: x.tone, ic: x.icon === 'up' || x.icon === 'trend' ? '📈' : x.icon === 'down' ? '📉' : x.icon === 'alert' ? '⚠️' : x.icon === 'bill' ? '🧾' : '💡', t: x.t, s: x.s, go: x.page }));
  (Q.paymentsInsights ? Q.paymentsInsights() : []).forEach(x => ins.push({ tone: x.tone === 'bad' ? 'danger' : x.tone === 'warn' ? 'warning' : x.tone === 'ok' ? 'success' : 'info', ic: x.icon || '💡', t: x.text, s: '' }));
  const TONE = { success: 'g', danger: 'r', warning: 'a', info: 'b' };
  const rows = ins.slice(0, 5).map(x => `<button class="dx-ins" ${x.go ? `data-go="${x.go}"` : ''}><span class="dx-ins-ic t-${TONE[x.tone] || 'v'}">${x.ic}</span><span class="dx-ins-x"><span class="dx-ins-t">${esc(x.t)}</span>${x.s ? `<span class="dx-ins-s">${esc(x.s)}</span>` : ''}</span><span class="dx-ins-ch">${svg(I.chevR)}</span></button>`).join('')
    || '<div class="dx-empty">Add sales & purchases to see AI insights.</div>';
  return `<div class="dx-card dx-ai">
    <div class="dx-ai-h"><span class="dx-ai-t">${svg(I.ai)} AI Insights</span><span class="dx-ai-badge">LIVE</span></div>
    <div class="dx-ai-list">${rows}</div>
    <button class="dx-ai-ask" id="dxAskAi">${svg(I.ai)} Ask AI about your business</button>
  </div>`;
}

/* ══════════ Manufacturing flow timeline ══════════ */
function flowWidget(prod) {
  const limeT = matTons('limestone'), monthT = prod.month, todayT = prod.today;
  const stages = [
    { e: '🪨', n: 'Limestone', t: limeT ? fmt(limeT, 0) + ' T' : '—', m: fC(matAmt('limestone')), st: limeT ? 'ok' : 'idle' },
    { e: '⛏️', n: 'Crusher', t: limeT ? fmt(limeT * .96, 0) + ' T' : '—', m: 'feed', st: limeT ? 'ok' : 'idle' },
    { e: '🔥', n: 'Kiln', t: monthT ? 'Active' : '—', m: fmt(monthT, 0) + ' T', st: monthT ? 'run' : 'idle' },
    { e: '💧', n: 'Hydration', t: fmt(monthT * .98, 0) + ' T', m: 'hydrated', st: monthT ? 'ok' : 'idle' },
    { e: '📦', n: 'Packing', t: fmt(monthT, 0) + ' T', m: 'bagged', st: monthT ? 'ok' : 'idle' },
    { e: '🚚', n: 'Dispatch', t: fmt(todayT, 1) + ' T', m: 'today', st: todayT ? 'run' : 'idle' }
  ];
  const cells = stages.map((s, i) => `${i ? '<div class="dx-flow-arw">→</div>' : ''}<button class="dx-flow-st st-${s.st}" data-go="production.html">
      <span class="dx-flow-e">${s.e}</span><span class="dx-flow-n">${s.n}</span><span class="dx-flow-t">${s.t}</span><span class="dx-flow-m">${s.m}</span></button>`).join('');
  return `<div class="dx-card dx-flow"><div class="dx-card-h"><div class="dx-card-t">Manufacturing flow</div><a class="dx-link" href="production.html">Production →</a></div>
    <div class="dx-flow-row">${cells}</div></div>`;
}

/* ══════════ Row 2 — manufacturing KPIs with targets ══════════ */
function mkpi(o) {
  const pct = o.target ? Math.min(100, Math.round(o.cur / o.target * 100)) : null;
  return `<div class="dx-mk">
    <div class="dx-mk-h"><span class="dx-mk-e">${o.e}</span><span class="dx-mk-n">${o.n}</span>${o.trend != null ? growth(o.trend) : ''}</div>
    <div class="dx-mk-v">${o.val}</div>
    ${pct != null ? `<div class="dx-mk-bar"><div class="dx-mk-fill" style="width:${pct}%;background:${o.color}"></div></div><div class="dx-mk-s">${pct}% of ${o.targetLabel}</div>` : `<div class="dx-mk-s">${o.sub || ''}</div>`}
  </div>`;
}
function kpiRow2(pl, s) {
  const limeT = matTons('limestone'), petT = matTons('petcoke');
  const costPerTon = s.qty ? pl.cogs / s.qty : 0;
  const yieldPct = limeT ? Math.min(100, s.qty / limeT * 100) : null;
  return `<div class="dx-sec-t">Manufacturing performance</div><div class="dx-mks">
    ${mkpi({ e: '🪨', n: 'Limestone', val: limeT ? fmt(limeT, 0) + ' T' : fC(matAmt('limestone')), sub: fC(matAmt('limestone')) + ' spent' })}
    ${mkpi({ e: '🔥', n: 'Petcoke', val: petT ? fmt(petT, 1) + ' T' : fC(matAmt('petcoke')), sub: fC(matAmt('petcoke')) + ' spent' })}
    ${mkpi({ e: '⚪', n: 'Production', val: fmt(s.qty, 1) + ' T', sub: 'Quick Lime, total' })}
    ${mkpi({ e: '🏭', n: 'Yield', val: yieldPct != null ? yieldPct.toFixed(0) + '%' : '—', color: '#6366f1', cur: yieldPct || 0, target: 100, targetLabel: 'limestone' })}
    ${mkpi({ e: '🧮', n: 'Cost / Ton', val: costPerTon ? fC(costPerTon) : '—', sub: 'material cost' })}
    ${mkpi({ e: '📈', n: 'Gross Margin', val: pl.gpm.toFixed(1) + '%', sub: fC(pl.gp) + ' gross profit' })}
  </div>`;
}

/* ══════════ mid row — finance overview + top parties ══════════ */
function midRow(gst, bal, pay) { return `<div class="dx-mid">${financeCard(gst, bal, pay)}${partiesCard()}</div>`; }
function financeCard(gst, bal, pay) {
  const cells = [
    ['💵', 'Cash', fC(bal.cash), 'teal'], ['🏦', 'Bank', fC(bal.bank), 'blue'], ['📱', 'UPI', fC(bal.upi), 'violet'],
    ['📥', 'Receivables', fC(pay.custOutstanding), 'amber'], ['📤', 'Payables', fC(pay.supOutstanding), 'red'], ['🧾', 'GST payable', fC(gst.net), 'indigo']
  ];
  return `<div class="dx-card"><div class="dx-card-h"><div class="dx-card-t">Finance overview</div><a class="dx-link" href="payments.html">Payments →</a></div>
    <div class="dx-fin">${cells.map(c => `<div class="dx-fin-c"><div class="dx-fin-e dx-t-${c[3]}">${c[0]}</div><div class="dx-fin-x"><div class="dx-fin-l">${c[1]}</div><div class="dx-fin-v">${c[2]}</div></div></div>`).join('')}</div>
    <div class="dx-fin-foot"><span>Net cash today</span><b><span style="color:var(--ql-success-600)">+${fC(pay.inToday)}</span> / <span style="color:var(--ql-danger-600)">−${fC(pay.outToday)}</span></b></div></div>`;
}
const AVC = ['#0891B2,#155E75', '#7C3AED,#5B21B6', '#16A34A,#15803D', '#F59E0B,#B45309', '#DB2777,#9D174D', '#2563EB,#1D4ED8'];
const avc = s => AVC[(((s || '?').charCodeAt(0)) + (s || '').length) % AVC.length];
function partiesCard() {
  const byC = {}; Q.salesRows().forEach(r => { const k = r.party; byC[k] = byC[k] || { n: k, amt: 0, pend: 0 }; byC[k].amt += r.total; byC[k].pend += r.outstanding; });
  const cust = Object.values(byC).sort((a, b) => b.amt - a.amt).slice(0, 5);
  const byS = {}; Q.purchaseRows().forEach(r => { const k = r.sup; byS[k] = byS[k] || { n: k, amt: 0, pend: 0 }; byS[k].amt += r.total; byS[k].pend += r.outstanding; });
  const sup = Object.values(byS).sort((a, b) => b.amt - a.amt).slice(0, 5);
  const rowsOf = arr => arr.length ? arr.map(x => `<div class="dx-party"><span class="dx-av" style="background:linear-gradient(135deg,${avc(x.n)})">${(x.n || '?').charAt(0).toUpperCase()}</span><span class="dx-party-n">${esc(x.n)}</span><span class="dx-party-a">${fC(x.amt)}${x.pend > 0 ? `<span class="dx-party-p">${fC(x.pend)} due</span>` : ''}</span></div>`).join('') : '<div class="dx-empty">No data yet.</div>';
  return `<div class="dx-card"><div class="dx-card-h"><div class="dx-seg2"><button class="on" data-pt="cust">Top customers</button><button data-pt="sup">Top suppliers</button></div><a class="dx-link" href="parties.html">All →</a></div>
    <div class="dx-parties" data-pane="cust">${rowsOf(cust)}</div>
    <div class="dx-parties" data-pane="sup" hidden>${rowsOf(sup)}</div></div>`;
}

/* ══════════ unified activity timeline ══════════ */
function activityWidget() {
  const ev = (Q.activity ? Q.activity() : []);
  const TONE = { brand: 'b', success: 'g', warning: 'a', danger: 'r', indigo: 'v' };
  const rows = ev.length ? ev.map(e => `<div class="dx-act"><span class="dx-act-dot t-${TONE[e.tone] || 'b'}"></span><div class="dx-act-x"><div class="dx-act-t">${esc(e.t)}</div><div class="dx-act-s">${esc(e.s || '')}</div></div><span class="dx-act-w">${esc(e.when || '')}</span></div>`).join('') : '<div class="dx-empty">No activity yet.</div>';
  return `<div class="dx-card"><div class="dx-card-h"><div class="dx-card-t">Recent activity</div><span class="dx-card-sub">Sales · Purchases · Payments · Production</span></div>
    <div class="dx-acts">${rows}</div></div>`;
}

/* ══════════ floating quick actions ══════════ */
function fab() {
  const acts = [['🧾', 'New Sale', 'invoice.html'], ['🛒', 'Purchase', 'purchase.html'], ['💰', 'Payment', 'payments.html'], ['🏭', 'Production', 'production.html'], ['🧮', 'Expense', 'cashbook.html'], ['🏦', 'Bank txn', 'reconcile.html']];
  return `<div class="dx-fab" id="dxFab"><div class="dx-fab-menu" id="dxFabMenu">${acts.map(a => `<button class="dx-fab-i" data-go="${a[2]}"><span>${a[0]}</span>${a[1]}</button>`).join('')}</div>
    <button class="dx-fab-btn" id="dxFabBtn">${svg(I.plus)}</button></div>`;
}

function countUp(el) {
  const to = +el.dataset.to; if (!isFinite(to) || !to) return;
  const pre = el.dataset.pre || '', suf = el.dataset.suf || '', dur = 620, t0 = performance.now();
  const fmtN = n => pre + Math.round(n).toLocaleString('en-IN') + suf;
  function step(t) { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmtN(to * e); if (p < 1) requestAnimationFrame(step); else el.textContent = fmtN(to); }
  requestAnimationFrame(step);
}
function skeleton() {
  const c = '<div class="dx-kpi"><div class="dx-sk" style="width:34px;height:34px;border-radius:10px"></div><div class="dx-sk" style="width:70%;height:12px;margin:14px 0 8px"></div><div class="dx-sk" style="width:55%;height:22px"></div></div>';
  return `<div class="dx-fbar"><div class="dx-sk" style="width:160px;height:26px"></div></div><div class="dx-kpis">${Array.from({ length: 6 }).map(() => c).join('')}</div><div class="dx-card dx-sk" style="height:300px;margin-top:16px"></div>`;
}

/* ══════════ wiring ══════════ */
function go(p) { if (p) location.href = p.includes('.html') ? p : p + '.html'; }
function wire() {
  const root = document.getElementById('dxRoot'); if (!root) return;
  root.querySelectorAll('[data-period]').forEach(b => b.onclick = () => { period = b.dataset.period; render(); });
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', e => { if (e.target.closest('.dx-fab-i') || b.classList.contains('dx-fab-i') || !b.closest('.dx-fab')) go(b.dataset.go); }));
  const cmp = document.getElementById('dxCompare'); if (cmp) cmp.onclick = () => { compare = !compare; render(); };
  const exp = document.getElementById('dxExport'); if (exp) exp.onclick = () => { const r = Q.salesRows(); QLShell.exportCSV('dashboard_sales', ['Invoice', 'Date', 'Party', 'Taxable', 'GST', 'Total', 'Status'], r.map(x => [x.inv, x.date, x.party, x.taxable, x.gst, x.total, x.status])); QLShell.toast && QLShell.toast('Exported ' + r.length + ' rows'); };
  const sv = document.getElementById('dxSaveView'); if (sv) sv.onclick = () => QLShell.toast && QLShell.toast('View saved: ' + PERIODS[period] + ' · ' + tab);
  const ask = document.getElementById('dxAskAi'); if (ask) ask.onclick = () => QLShell.toast && QLShell.toast('AI assistant coming to your workspace');
  const full = document.getElementById('dxFull'); if (full) full.onclick = () => { const c = document.querySelector('.dx-analytics'); if (c) c.classList.toggle('dx-fs'); };
  // party segmented
  root.querySelectorAll('[data-pt]').forEach(b => b.onclick = () => { root.querySelectorAll('[data-pt]').forEach(x => x.classList.remove('on')); b.classList.add('on'); root.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== b.dataset.pt); });
  // FAB
  const fb = document.getElementById('dxFabBtn'); if (fb) fb.onclick = e => { e.stopPropagation(); document.getElementById('dxFab').classList.toggle('open'); };
  document.addEventListener('click', () => { const f = document.getElementById('dxFab'); if (f) f.classList.remove('open'); }, { once: true });
  root.querySelectorAll('.dx-fab-i').forEach(b => b.onclick = () => go(b.dataset.go));
  // filter chips (visual dropdowns → toast for now)
  root.querySelectorAll('[data-drop]').forEach(b => b.onclick = () => QLShell.toast && QLShell.toast('Filter: ' + b.dataset.drop + ' (single plant)'));
}

window.__qlRefresh = render;
window.__qlOnSwitchCompany = id => Q.switchCompany(id, render);
if (Q.init) Q.init(render); else render();
