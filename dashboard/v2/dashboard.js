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

let dashMonth = null, tab = 'revenue', compare = false, collapsed = { fin: true, gst: true };

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
function gstByMonth(n, end) {
  const rows = Q.salesRows(), map = {};
  rows.forEach(r => { const ym = (r.date || '').slice(0, 7); if (ym) map[ym] = (map[ym] || 0) + (r.gst || 0); });
  return Q.monthSeries(n, end).map(d => map[d.ym] || 0);
}
/* the dashboard's picked period, as data.js inPeriod understands it */
function dashPeriod() { return (typeof dashMonth === 'string' && dashMonth && dashMonth !== 'all') ? dashMonth : null; }
function inDashP(d) { const p = dashPeriod(); return !p || Q.inPeriod(d, p); }
function matTons(g) { return Q.purchaseRows().filter(r => r.group === g && inDashP(r.date)).reduce((a, r) => a + (r.qty || 0), 0); }
function matAmt(g) { return Q.purchaseRows().filter(r => r.group === g && inDashP(r.date)).reduce((a, r) => a + (r.taxable || r.total || 0), 0); }

/* ── month filter (matches the Sales/Purchase registers) ── */
function availMonths() {
  const set = new Set();
  Q.salesRows().forEach(r => { const m = (r.date || '').slice(0, 7); if (m) set.add(m); });
  Q.purchaseRows().forEach(r => { const m = (r.date || '').slice(0, 7); if (m) set.add(m); });
  return [...set].sort().reverse();
}
function monthSel() { return dashMonth && dashMonth !== 'all' ? dashMonth : null; }
function dashMonthLabel() {
  if (!monthSel()) return 'All months';
  return Q.monthLabel(dashMonth, { blank: dashMonth });
}
function monthMetrics() {
  const m = monthSel(), inM = r => !m || (r.date || '').slice(0, 7) === m;
  const ms = Q.salesRows().filter(r => inM(r) && r.status !== 'cancelled');
  const mp = Q.purchaseRows().filter(r => inM(r) && r.status !== 'cancelled');
  const salesTax = ms.reduce((a, r) => a + r.taxable, 0), purchTax = mp.reduce((a, r) => a + r.taxable, 0);
  return {
    salesTax, purchTax, invoices: ms.length, bills: mp.length,
    collected: ms.reduce((a, r) => a + r.paid, 0), pending: ms.reduce((a, r) => a + r.outstanding, 0),
    qty: ms.reduce((a, r) => a + r.qty, 0), gst: ms.reduce((a, r) => a + r.gst, 0),
    profit: salesTax - purchTax,
    /* itc / payable are additive — nothing on the desktop dashboard reads them.
       The mobile dashboard shows both and must scope them the SAME way as every
       other number here, so they are computed off the same filtered `mp` rather
       than from QLD.purchaseSummary(), which is all-time and has no period. */
    itc: mp.reduce((a, r) => a + (r.itc || 0), 0),
    payable: mp.reduce((a, r) => a + (r.outstanding || 0), 0)
  };
}
/* ── Month report — everything the dashboard shows for the selected month (or
   all months) as ONE CSV: summary, sales, purchases, payments. Cancelled
   records are excluded, same as every on-screen number.

   BUILD and DELIVER are split because the phone delivers it differently: a
   mobile browser has no Downloads shelf to point at, so mobile.js hands the
   same bytes to navigator.share() instead. Splitting is what stopped that from
   becoming a second CSV writer with its own column order — the report a phone
   shares and the report a desktop downloads are byte-identical by construction,
   not by two authors agreeing to stay in step. ── */
function buildMonthReport() {
  const m = monthSel(), lbl = dashMonthLabel();
  const inM = d => !m || (d || '').slice(0, 7) === m;
  const S = Q.salesRows().filter(r => inM(r.date) && r.status !== 'cancelled');
  const P = Q.purchaseRows().filter(r => inM(r.date) && r.status !== 'cancelled');
  const L = (Q.paymentsLedger ? Q.paymentsLedger() : []).filter(e => inM(e.date));
  const M = monthMetrics();
  // One shared rule for every export (rounds floats to paise, preserves text).
  const row = a => QLShell.csvRow(a);
  const out = [];
  out.push(row(['QuickLimes month report', Q.co.short || '', lbl]));
  out.push(row(['Generated', new Date().toLocaleString('en-IN')]));
  out.push('');
  out.push(row(['SUMMARY']));
  out.push(row(['Sales (taxable)', M.salesTax]));
  out.push(row(['Invoices', M.invoices]));
  out.push(row(['Collected', M.collected]));
  out.push(row(['Pending', M.pending]));
  out.push(row(['GST collected', M.gst]));
  out.push(row(['Purchases (taxable)', M.purchTax]));
  out.push(row(['Purchase bills', M.bills]));
  out.push(row(['Gross margin (sales − purchases)', M.profit]));
  out.push('');
  out.push(row(['SALES (' + S.length + ')']));
  out.push(row(['Invoice', 'Date', 'Party', 'GSTIN', 'Vehicle', 'Qty (T)', 'Taxable', 'GST', 'Total', 'Paid', 'Outstanding', 'Status']));
  S.forEach(r => out.push(row([r.inv, r.date, r.party, r.gstin, r.veh, r.qty, r.taxable, r.gst, r.total, r.paid, r.outstanding, r.status])));
  out.push('');
  out.push(row(['PURCHASES (' + P.length + ')']));
  out.push(row(['Bill', 'Date', 'Supplier', 'GSTIN', 'Group', 'Item', 'Taxable', 'GST', 'ITC', 'Freight', 'Landed cost', 'Total', 'Paid', 'Status']));
  P.forEach(r => out.push(row([r.bill, r.date, r.sup, r.gstin, r.groupLabel, r.item, r.taxable, r.gst, r.itc, r.freightAmt || 0, r.total + (r.freightAddon || 0), r.total, r.paid, r.status])));
  out.push('');
  out.push(row(['PAYMENTS (' + L.length + ')']));
  out.push(row(['Date', 'Party', 'Type', 'Method', 'Bank account', 'Reference', 'In', 'Out']));
  L.forEach(e => out.push(row([e.date, e.party, e.ptype, e.method, e.account || '', e.ref, e.credit || '', e.debit || ''])));
  const name = 'QuickLimes_' + (Q.co.short || 'report').replace(/\s+/g, '') + '_' + (m || 'AllMonths') + '.csv';
  // '﻿' = the BOM Excel needs to read ₹ and Devanagari as UTF-8 — part of the
  // bytes, so it must live in the builder, not in the download path.
  return { name, lbl, text: '﻿' + out.join('\r\n'), counts: { sales: S.length, purchases: P.length, payments: L.length } };
}
const reportToast = r => 'Report downloaded — ' + r.lbl + ' (' + r.counts.sales + ' sales · ' + r.counts.purchases + ' purchases · ' + r.counts.payments + ' payments)';
function exportMonthReport() {
  const r = buildMonthReport();
  const blob = new Blob([r.text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = r.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  if (QLShell.toast) QLShell.toast(reportToast(r), 'ok');
  return r;
}

/* ── The period, as an ADDRESS the mobile layer can reach ──────────
   `dashMonth` is a module-local `let`, so mobile.js could not read it — and
   reading QLD.uiMonth() instead is NOT the same thing: uiMonth is null until
   the first deliberate pick, and this page then seeds itself to the LATEST DATA
   MONTH (see render()). A phone that read uiMonth directly would show all-time
   next to a desktop showing June, which is the disagreement this exists to end.
   So the seed has exactly one owner and mobile asks it what the period is. */
window.__qlDashPeriod = {
  get: () => dashMonth,
  months: availMonths,
  metrics: monthMetrics,
  label: dashMonthLabel,
  report: exportMonthReport,
  buildReport: buildMonthReport,
  /* One writer for a pick, whichever surface it came from: store it in the
     shared uiMonth key AND re-render the desktop dashboard, so the two views
     can never hold different periods. */
  set(p) { dashMonth = p; if (Q.setUiMonth) Q.setUiMonth(p); render(); }
};

/* The calendar is QLShell.monthPicker — the app's ONE picker, shared with Sales,
   Purchase, Reconciliation and Inventory. This function used to be a verbatim
   copy of it that had drifted (it keyed cells `data-m` instead of `data-ym`,
   which also made monthpicker.test.js blind to this file). Only the wiring
   lives here now. */
function openDashMonthMenu(anchor) {
  QLShell.monthPicker(anchor, {
    month: monthSel() || 'all',
    have: new Set(availMonths()),
    onPick(m) { dashMonth = m; if (Q.setUiMonth) Q.setUiMonth(m); render(); }
  });
}

function render() {
  const main = document.getElementById('ql-main'); if (!main) return;
  let root = document.getElementById('dxRoot');
  if (!root) { main.innerHTML = '<div class="dx" id="dxRoot"></div>'; root = document.getElementById('dxRoot'); }
  try {
    if (dashMonth === null) { const saved = Q.uiMonth ? Q.uiMonth() : null; const ms = availMonths(); dashMonth = saved || ms[0] || 'all'; }   // saved pick (shared, persisted) → else latest data month
    const co = Q.co, k = Q.kpis(), s = Q.salesSummary(), prod = Q.production(), bal = Q.accountBalances(), pay = Q.paymentsSummary(), pl = Q.getPL(), gst = Q.gstSummary();
    root.innerHTML =
      filterBar(co) +
      integrityCard() +
      kpiRow1() +
      heroRow() +
      flowWidget(prod) +
      kpiRow2() +
      midRow(gst, bal, pay) +
      activityWidget();
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
  return `<div class="dx-fbar">
    <div class="dx-fbar-l"><h1 class="dx-h1">Dashboard</h1><span class="dx-fbar-co">${esc(co.short || co.name || '')}</span></div>
    <div class="dx-fbar-r">
      ${QLShell.monthButton({ id: 'dxMonth', label: dashMonthLabel() })}
      <button class="qx-btn" id="dxExport" title="Download a report of the selected month">${svg(I.dl)}<span>Report</span></button>
    </div></div>`;
}

/* ══════════ Row 1 — business KPIs ══════════ */
function kpi(o) {
  return `<button class="dx-kpi" ${o.href ? `data-go="${o.href}"` : ''}>
    <div class="dx-kpi-top"><span class="dx-kpi-ic dx-t-${o.tint}">${svg(o.ic)}</span>${o.g != null ? growth(o.g) : (o.badge || '')}</div>
    <div class="dx-kpi-l">${o.label}</div>
    <div class="dx-kpi-v"><span class="dx-countup" data-to="${o.raw != null ? o.raw : ''}" data-pre="${o.pre || ''}" data-suf="${o.suf || ''}">${o.val}</span></div>
    ${o.spark ? `<div class="dx-kpi-b"><div class="dx-kpi-sp">${o.spark}</div></div>` : ''}
  </button>`;
}
function kpiRow1() {
  const M = monthMetrics(), lbl = dashMonthLabel();
  const sparkEnd = (typeof dashMonth === 'string' && /^\d{4}-\d{2}$/.test(dashMonth)) ? dashMonth : (Q.latestDataYm ? Q.latestDataYm() : undefined);
  const rev = Q.monthSeries(6, sparkEnd).map(d => d.sales), pur = Q.monthSeries(6, sparkEnd).map(d => d.purchases), qty = Q.monthSeries(6, sparkEnd).map(d => d.qty);
  return `<div class="dx-kpis">
    ${kpi({ tint: 'blue', ic: I.receipt, label: 'Sales · ' + lbl, val: fC(M.salesTax), raw: M.salesTax, pre: '₹', meta: M.invoices + ' invoices', spark: spark(rev, '#2563eb') })}
    ${kpi({ tint: 'green', ic: I.wallet, label: 'Collected', val: fC(M.collected), raw: M.collected, pre: '₹', meta: 'money received' })}
    ${kpi({ tint: 'violet', ic: I.coins, label: 'Pending', val: fC(M.pending), raw: M.pending, pre: '₹', meta: 'still receivable', badge: '<span class="dx-g warn">receivable</span>' })}
    ${kpi({ tint: 'amber', ic: I.receipt, label: 'Purchases', val: fC(M.purchTax), raw: M.purchTax, pre: '₹', meta: M.bills + ' bills', spark: spark(pur, '#f59e0b') })}
    ${kpi({ tint: 'indigo', ic: I.factory, label: 'Production', val: fmt(M.qty, 1) + ' T', raw: M.qty, suf: ' T', meta: 'Quick Lime dispatched', spark: spark(qty, '#6366f1') })}
    ${kpi({ tint: 'teal', ic: I.trend, label: 'Gross Profit', val: fC(M.profit), raw: M.profit, pre: '₹', meta: 'sales − purchases' })}
  </div>`;
}

/* ══════════ Hero — tabbed analytics + AI insights ══════════ */
const TABS = [
  { k: 'revenue', label: 'Revenue', color: '#2563eb', fmt: fC, series: (n, end) => Q.monthSeries(n, end).map(d => d.sales) },
  { k: 'profit', label: 'Profit', color: '#16a34a', fmt: fC, series: (n, end) => Q.monthSeries(n, end).map(d => d.profit) },
  { k: 'production', label: 'Production', color: '#6366f1', fmt: v => fmt(v, 1) + ' T', series: (n, end) => Q.monthSeries(n, end).map(d => d.qty) },
  { k: 'purchases', label: 'Purchases', color: '#f59e0b', fmt: fC, series: (n, end) => Q.monthSeries(n, end).map(d => d.purchases) },
  { k: 'gst', label: 'GST', color: '#0891b2', fmt: fC, series: (n, end) => gstByMonth(n, end) }
];
function heroRow() { return `<div class="dx-hero">${analyticsCard()}${aiCard()}</div>`; }
function analyticsCard() {
  const t = TABS.find(x => x.k === tab) || TABS[0], n = 6;
  /* End the chart at the PICKED month; with no pick, at the latest month that
     HAS data. Bills arrive in month-end batches here, so the wall-clock month
     is empty for most of its life — plotting it as ₹0 painted a cliff and a
     "↓100%" every month until the upload, which describes the upload rhythm,
     not the business. */
  const nowYm = new Date().toISOString().slice(0, 7);
  const endYm = (typeof dashMonth === 'string' && /^\d{4}-\d{2}$/.test(dashMonth)) ? dashMonth
    : (Q.latestDataYm ? Q.latestDataYm() : undefined);
  const labels = Q.monthSeries(n, endYm).map(d => d.m), vals = t.series(n, endYm);
  const prevVals = compare ? t.series(n * 2, endYm).slice(0, n) : null;
  const total = vals.reduce((a, b) => a + b, 0), last = vals[vals.length - 1] || 0, prev = vals[vals.length - 2] || 0;
  const g = prev > 0 ? (last - prev) / prev * 100 : null;
  const spanLbl = (!endYm || endYm === nowYm) ? 'last 6 months' : '6 months to ' + (Q.periodLabel ? Q.periodLabel(endYm) : endYm);
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
      <div><div class="dx-ac-l">${t.label} · ${spanLbl}</div><div class="dx-ac-v">${t.fmt(total)}</div></div>
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
  (Q.insights ? Q.insights(typeof dashMonth === 'string' && /^\d{4}-\d{2}$/.test(dashMonth) ? dashMonth : null) : []).forEach(x => ins.push({ tone: x.tone, ic: x.icon === 'up' || x.icon === 'trend' ? '📈' : x.icon === 'down' ? '📉' : x.icon === 'alert' ? '⚠️' : x.icon === 'bill' ? '🧾' : '💡', t: x.t, s: x.s, go: x.page }));
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
  const p = dashPeriod();
  const limeT = matTons('limestone');
  const monthT = p ? Q.salesRows().filter(r => r.status !== 'cancelled' && inDashP(r.date)).reduce((a, r) => a + (r.qty || 0), 0) : prod.month;
  const todayT = prod.today;
  const stages = [
    { e: '🪨', n: 'Limestone', t: limeT ? fmt(limeT, 0) + ' T' : '—', m: fC(matAmt('limestone')), st: limeT ? 'ok' : 'idle' },
    { e: '⛏️', n: 'Crusher', t: limeT ? fmt(limeT, 0) + ' T' : '—', m: 'feed', st: limeT ? 'ok' : 'idle' },
    { e: '🔥', n: 'Kiln', t: monthT ? 'Active' : '—', m: fmt(monthT, 0) + ' T', st: monthT ? 'run' : 'idle' },
    { e: '💧', n: 'Hydration', t: monthT ? fmt(monthT, 0) + ' T' : '—', m: p ? 'dispatched' : 'hydrated', st: monthT ? 'ok' : 'idle' },
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
function kpiRow2() {
  const p = dashPeriod(), pLbl = p ? (Q.periodLabel ? Q.periodLabel(p) : p) : 'all time';
  const pl = Q.getPL(p || undefined);
  const limeT = matTons('limestone'), petT = matTons('petcoke');
  const runs = (Q.productionRows ? Q.productionRows() : []).filter(r => inDashP(r.date));
  const runsOut = runs.reduce((a, r) => a + r.quicklime + r.hydrated, 0);
  const runsLime = runs.reduce((a, r) => a + r.limestone, 0);
  const dispatched = Q.salesRows().filter(r => r.status !== 'cancelled' && inDashP(r.date)).reduce((a, r) => a + (r.qty || 0), 0);
  const outT = runsOut > 0 ? runsOut : dispatched;
  const costPerTon = outT ? pl.cogs / outT : 0;
  /* yield only from measured runs — dispatch ÷ purchases is not a yield */
  const yieldPct = runsOut > 0 && runsLime > 0 ? runsOut / runsLime * 100 : null;
  return `<div class="dx-sec-t">Manufacturing performance · ${esc(pLbl)}</div><div class="dx-mks">
    ${mkpi({ e: '🪨', n: 'Limestone', val: limeT ? fmt(limeT, 0) + ' T' : '—', sub: fC(matAmt('limestone')) + ' spent' })}
    ${mkpi({ e: '🔥', n: 'Petcoke', val: petT ? fmt(petT, 1) + ' T' : '—', sub: fC(matAmt('petcoke')) + ' spent' })}
    ${mkpi({ e: '⚪', n: runsOut > 0 ? 'Production' : 'Dispatched', val: fmt(outT, 1) + ' T', sub: runsOut > 0 ? 'from production runs' : 'from invoices — no runs recorded' })}
    ${mkpi(yieldPct != null
      ? { e: '🏭', n: 'Yield', val: yieldPct.toFixed(1) + '%', color: '#6366f1', cur: yieldPct, target: 100, targetLabel: 'limestone consumed' }
      : { e: '🏭', n: 'Yield', val: '—', sub: 'needs production runs' })}
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
/* A customer's name on the dashboard is the shortest route to their finances,
   so it opens the finance portal — resolved through QLPartyLink by identity
   (GSTIN first), never by array position. A name that cannot be resolved to
   exactly one saved party stays plain text rather than linking to a guess. */
function pHref(name, gstin) {
  const PL = window.QLPartyLink;
  if (!PL || !PL.resolve) return '';
  const r = PL.resolve({ name: name, gstin: gstin });
  return (r && r.party) ? PL.financeUrl(r.party) : '';
}
function partiesCard() {
  const byC = {}; Q.salesRows().forEach(r => { const k = r.party; byC[k] = byC[k] || { n: k, g: '', amt: 0, pend: 0 }; byC[k].g = byC[k].g || r.gstin || ''; byC[k].amt += r.total; byC[k].pend += r.outstanding; });
  const cust = Object.values(byC).sort((a, b) => b.amt - a.amt).slice(0, 5);
  const byS = {}; Q.purchaseRows().forEach(r => { const k = r.sup; byS[k] = byS[k] || { n: k, g: '', amt: 0, pend: 0 }; byS[k].g = byS[k].g || r.gstin || ''; byS[k].amt += r.total; byS[k].pend += r.outstanding; });
  const sup = Object.values(byS).sort((a, b) => b.amt - a.amt).slice(0, 5);
  const rowsOf = arr => arr.length ? arr.map(x => {
    const href = pHref(x.n, x.g);
    const inner = `<span class="dx-av" style="background:linear-gradient(135deg,${avc(x.n)})">${(x.n || '?').charAt(0).toUpperCase()}</span><span class="dx-party-n">${esc(x.n)}</span><span class="dx-party-a">${fC(x.amt)}${x.pend > 0 ? `<span class="dx-party-p">${fC(x.pend)} due</span>` : ''}</span>`;
    return href
      ? `<a class="dx-party dx-party-l" href="${href}" title="Open finance portal">${inner}</a>`
      : `<div class="dx-party">${inner}</div>`;
  }).join('') : '<div class="dx-empty">No data yet.</div>';
  return `<div class="dx-card"><div class="dx-card-h"><div class="dx-seg2"><button class="on" data-pt="cust">Top customers</button><button data-pt="sup">Top suppliers</button></div><a class="dx-link" href="parties.html">All →</a></div>
    <div class="dx-parties" data-pane="cust">${rowsOf(cust)}</div>
    <div class="dx-parties" data-pane="sup" hidden>${rowsOf(sup)}</div></div>`;
}


/* ══════════ data integrity — what the books cannot see about themselves ══════════
   Silent when the book is clean: a health widget that is always on screen
   stops being read. It appears only when QLIntegrity has evidence, and it
   leads with the number that matters — how much the books are overstated by
   if every CERTAIN finding is real. */
function integrityCard() {
  const I = window.QLIntegrity; if (!I) return '';
  const r = I.scan({ sales: Q.salesRows(), purchases: Q.purchaseRows(), parties: Q.partyRows() });
  if (!r.findings.length) return '';
  const certain = r.findings.filter(f => f.severity === 'certain');
  const warn = r.findings.filter(f => f.severity === 'warning');
  const head = certain.length
    ? `<b>${fC(r.overstated)}</b> of the books looks wrong`
    : `${warn.length} thing${warn.length === 1 ? '' : 's'} worth checking`;
  const sub = [
    certain.length ? certain.length + ' confirmed' : '',
    warn.length ? warn.length + ' to check' : ''
  ].filter(Boolean).join(' · ');
  return `<div class="dx-card dx-integ${certain.length ? ' bad' : ''}">
    <div class="dx-card-h"><div class="dx-card-t">Data check</div><span class="dx-card-sub">${esc(sub)}</span></div>
    <div class="dx-integ-b"><div class="dx-integ-h">${head}</div>
      <div class="dx-integ-s">${esc(certain.length ? certain[0].why : warn[0].why)}</div>
      <button class="ql-btn ql-btn-primary" id="dxInteg">Review ${r.findings.length} finding${r.findings.length === 1 ? '' : 's'}</button>
    </div></div>`;
}
function openIntegrity() {
  const I = window.QLIntegrity;
  const r = I.scan({ sales: Q.salesRows(), purchases: Q.purchaseRows(), parties: Q.partyRows() });
  const card = (f, i) => {
    const plan = I.fixPlan(f);
    return `<div class="ig-f ${f.severity}">
      <div class="ig-f-h"><span class="ig-sev ${f.severity}">${f.severity === 'certain' ? 'Confirmed' : 'Check this'}</span>
        <b class="mono">${esc(f.doc || '(no number)')}</b><span class="ig-p">${esc(f.party)}</span></div>
      <div class="ig-why">${esc(f.why)}</div>
      ${f.overstatedBy ? `<div class="ig-amt">Overstates the books by <b>${fC(f.overstatedBy)}</b></div>` : ''}
      ${plan.remove.length ? `<div class="ig-act">
        <button class="ql-btn ql-btn-secondary ig-fix" data-f="${i}">Remove ${plan.remove.length} row${plan.remove.length === 1 ? '' : 's'}</button>
        <span class="ig-plan">${esc(plan.why)}</span></div>` : ''}
    </div>`;
  };
  QLShell.panel({
    title: 'Data check', wide: true,
    sub: r.certain + ' confirmed · ' + r.warnings + ' to check' + (r.overstated ? ' · ' + fC(r.overstated) + ' overstated' : ''),
    body: `<div class="ig">
      <div class="ig-note">Removals are reversible — rows go to Trash with a reason on the audit trail, and can be restored.</div>
      ${r.findings.map(card).join('')}</div>`,
    actions: [{ label: 'Close', onClick: () => QLShell.closeModal() }],
    onMount: el => el.querySelectorAll('.ig-fix').forEach(b => b.onclick = () => {
      const f = r.findings[+b.dataset.f], plan = I.fixPlan(f);
      /* Raw indices, and soft-delete does not splice the array — so removing
         several rows in one pass cannot make the later indices point at the
         wrong record. Descending order anyway, because relying on that
         invariant silently is how index bugs get written. */
      const reason = f.type === 'duplicate'
        ? 'Duplicate of ' + (f.doc || 'the same document') + ' — kept one copy'
        : 'Supplier bill entered as a sale — already recorded in Purchases';
      let n = 0;
      plan.remove.slice().sort((x, y) => y - x).forEach(idx => {
        const res = (plan.kind === 'purchase') ? Q.deletePurchase(idx, reason) : Q.deleteSale(idx, reason);
        if (!res || res.ok !== false) n++;
      });
      QLShell.toast(n + ' row' + (n === 1 ? '' : 's') + ' moved to Trash', 'ok');
      QLShell.closeModal();
      if (window.__qlRefresh) window.__qlRefresh(); else location.reload();
    })
  });
}

/* ══════════ unified activity timeline ══════════ */
function activityWidget() {
  const ev = (Q.activity ? Q.activity() : []);
  const TONE = { brand: 'b', success: 'g', warning: 'a', danger: 'r', indigo: 'v' };
  const rows = ev.length ? ev.map(e => `<div class="dx-act"><span class="dx-act-dot t-${TONE[e.tone] || 'b'}"></span><div class="dx-act-x"><div class="dx-act-t">${esc(e.t)}</div><div class="dx-act-s">${esc(e.s || '')}</div></div><span class="dx-act-w">${esc(e.when || '')}</span></div>`).join('') : '<div class="dx-empty">No activity yet.</div>';
  return `<div class="dx-card"><div class="dx-card-h"><div class="dx-card-t">Recent activity</div><span class="dx-card-sub">Sales · Purchases · Payments · Production</span></div>
    <div class="dx-acts">${rows}</div></div>`;
}

/* ══════════ floating quick actions — REMOVED ══════════
   The "+" FAB is gone. He asked for it repeatedly ("I told you 100 times remove
   this icon but still showing in some pages") and he was right every time: I only
   ever removed ONE of the two. mobile.js dropped its .qlm-fab "by request" and this
   one, on the dashboard, was left standing — same button, second implementation,
   so the request only half-landed. That is this codebase's oldest failure mode.

   It also stacked directly on top of the AI pill in the bottom-right corner: a "+"
   circle over "Ask AI about your business", two floating buttons fighting for the
   same 60 pixels. That is what his screenshot showed.

   The reasoning mobile.js already recorded holds here too: every destination it
   offered (New Sale, Purchase, Payment, Production, Expense, Bank txn) is one click
   away in the sidebar and has its own specific add button on its own page. A
   permanent button that guesses what you meant to create is worse than the exact
   one already in front of you. Nothing is lost; a duplicate is.

   fab() is deleted rather than left returning '' — a dead function is the thing
   someone re-wires by accident later. The .dx-fab CSS goes with it. */

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
  const mo = document.getElementById('dxMonth'); if (mo) mo.onclick = e => { e.stopPropagation(); openDashMonthMenu(mo); };
  const ex = document.getElementById('dxExport'); if (ex) ex.onclick = () => exportMonthReport();
  const ig = document.getElementById('dxInteg'); if (ig) ig.onclick = () => openIntegrity();
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  /* Was guarded against double-firing inside the FAB menu; with the FAB gone every
     [data-go] is a plain navigation. */
  root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  const cmp = document.getElementById('dxCompare'); if (cmp) cmp.onclick = () => { compare = !compare; render(); };
  const ask = document.getElementById('dxAskAi'); if (ask) ask.onclick = () => { if (QLShell.openAssistant) QLShell.openAssistant(); else if (QLShell.toast) QLShell.toast('AI assistant unavailable'); };
  const full = document.getElementById('dxFull'); if (full) full.onclick = () => { const c = document.querySelector('.dx-analytics'); if (c) c.classList.toggle('dx-fs'); };
  // party segmented
  root.querySelectorAll('[data-pt]').forEach(b => b.onclick = () => { root.querySelectorAll('[data-pt]').forEach(x => x.classList.remove('on')); b.classList.add('on'); root.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== b.dataset.pt); });
  // (the FAB and its wiring are gone — see the note above fab()'s old home)
}

window.__qlRefresh = render;
window.__qlOnSwitchCompany = () => { dashMonth = null; render(); };   // shell already switched; re-read the new company's saved month
if (Q.init) Q.init(render); else render();

/* build m16: dashboard month-picker year-nav stopPropagation (can now reach 2025) */

/* build m17: month Report download on the dashboard */
