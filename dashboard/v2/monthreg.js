/* ═══════════════════════════════════════════════════════════════════════
   MONTHLY REGISTER — the page.

   All arithmetic lives in monthreg-core.js (QLMonthReg), which is tested
   headlessly. This file only chooses a period, calls that engine, and draws
   what it returns. Nothing is computed twice and nothing is computed here.

   Data source: QLD.salesRows() / QLD.purchaseRows() — the SAME rows the Sales
   and Purchase registers show. That is deliberate and it is what makes the
   reconciliation section able to say anything meaningful: if this page and
   those registers ever disagree, they disagree about the same input.

   PERFORMANCE NOTE, honestly: QuickLimes is a local-first app. The books live
   in localStorage and there is no server-side aggregation layer to push this
   into — the API stores and returns one blob per company. So aggregation
   happens here, over 153 sales and 26 purchase rows, and is memoised per
   (company, revision) so switching tabs or toggling a section does not
   recompute it. At this size it is sub-millisecond. If the book grows to tens
   of thousands of rows this is the thing to move server-side.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';
QLShell.mount({ active: 'monthreg', title: 'Monthly Register' });
const Q = window.QLD, MR = window.QLMonthReg;
const $ = id => document.getElementById(id);
const esc = s => (s == null ? '' : s).toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ── formatting ──────────────────────────────────────────────────────────
   The detailed table keeps EXACT rupees (the spec is explicit about that);
   only headline cards use the short form, and never below a lakh where the
   short form loses more than it saves. */
const fC = n => Q.fC(Math.round(+n || 0));
function fShort(n) {
  const v = +n || 0, a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2) + ' Cr';
  if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(2) + ' L';
  return fC(v);
}
const fT = n => (Math.round((+n || 0) * 10) / 10).toLocaleString('en-IN');
const fPct = n => (n == null ? '—' : (n >= 0 ? '' : '−') + Math.abs(n).toFixed(1) + '%');
/* A figure that cannot be known renders as a dash with a reason, never as 0. */
const NA = why => `<span class="mr-na" title="${esc(why)}">—</span>`;

const SVG = {
  chev: '<path d="m6 9 6 6 6-6"/>', dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><polyline points="21 3 21 9 15 9"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  rupee: '<path d="M6 3h12"/><path d="M6 8h12"/><path d="M6 13h4a5 5 0 0 0 0-10"/><path d="m6 13 8 8"/>',
  cart: '<path d="M3 3h2l2 13h11l2-8H6"/><circle cx="9" cy="21" r="1"/><circle cx="18" cy="21" r="1"/>',
  up: '<path d="M12 2v20M5 12l7-7 7 7"/>', pct: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'
};
const ic = (k, cls) => `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SVG[k] || ''}</svg>`;

/* ── state ───────────────────────────────────────────────────────────────
   FY and month are persisted through QLD.setUiMonth so arriving from the
   Sales register in May lands here in May, the way every other page behaves. */
let FY = null, MONTH = null, CMP = 'month', SERIES = { netSales: 1, netPurchases: 1, grossProfit: 1 };
let SORT = { key: 'ym', dir: 'desc' };
let LOADED = false, ERR = null;

/* Memoised per (company, data revision) — see the performance note above. */
let _cache = { key: '', sales: null, purchases: null };
function rows() {
  const key = (Q.co && Q.co.id || '') + '|' + (Q.rev ? Q.rev() : (Q.state.SALES.length + ':' + Q.state.PURCHASES.length));
  if (_cache.key !== key) _cache = { key, sales: Q.salesRows(), purchases: Q.purchaseRows() };
  return _cache;
}
function invalidate() { _cache.key = ''; }

function todayISO() { return new Date().toISOString().slice(0, 10); }

/* ── header ──────────────────────────────────────────────────────────────── */
let HERO = null;
function paintHero() {
  if (HERO) return;
  if (!window.QLX || !QLX.heroHTML) { console.warn('QLX not loaded — shared page header skipped'); return; }
  HERO = {
    title: 'Monthly Register', actionsId: 'mrActions',
    sub: '<span id="mrSub">Monthly sales, purchases, quantities, profitability and business performance</span>',
    tools: [
      { label: 'Refresh', icon: SVG.refresh, onClick: () => { invalidate(); render(); QLShell.toast('Recalculated from the current books', 'ok'); } },
      { label: 'Print / PDF', icon: SVG.print, onClick: () => window.print() },
      { label: 'Export', icon: SVG.dl, onClick: () => openExport() }
    ]
  };
  const host = $('mrHero');
  host.innerHTML = QLX.heroHTML(HERO);
  QLX.wireHero(host, HERO);
}

/* ── period bar ──────────────────────────────────────────────────────────── */
function barHTML(fys, months) {
  const fyOpts = fys.map(f => `<option value="${f}"${f === FY ? ' selected' : ''}>${MR.fyLabel(f)}</option>`).join('');
  const chips = [];
  if (FY) chips.push(`<span class="mr-chip">${MR.fyLabel(FY)}</span>`);
  if (MONTH) chips.push(`<span class="mr-chip">${MR.monthName(MONTH)}<button data-clear="month" title="Clear month">×</button></span>`);
  /* The MONTH control is QLShell.monthButton + monthPicker — the app's one
     calendar, shared with Sales, Purchase, GST and the Dashboard. It was a
     native <select> here for one draft; monthpicker.test.js caught it, and it
     is right to: a dropdown on this page and a calendar on every other is
     exactly the inconsistency the owner reported. The financial YEAR stays a
     select, because an FY is not a month and the calendar cannot express it. */
  return `<div class="mr-bar">
    <select class="ql-select" id="mrFy" aria-label="Financial year">${fyOpts}</select>
    ${QLShell.monthButton({ id: 'mrMonthBtn', label: MONTH ? MR.monthName(MONTH) : 'Whole year', title: 'Pick a month in ' + MR.fyLabel(FY) })}
    <div class="mr-seg" role="group" aria-label="Compare against">
      <button data-cmp="month" class="${CMP === 'month' ? 'on' : ''}">vs prev month</button>
      <button data-cmp="year" class="${CMP === 'year' ? 'on' : ''}">vs last year</button>
      <button data-cmp="off" class="${CMP === 'off' ? 'on' : ''}">No compare</button>
    </div>
    ${chips.join('')}
    <span class="mr-bar-sp"></span>
    <span class="mr-sec-s" id="mrScope"></span>
  </div>`;
}

/* ── KPI cards ───────────────────────────────────────────────────────────── */
function deltaPill(d) {
  if (!d || d.pct == null) return '';
  const cls = Math.abs(d.pct) < 0.05 ? 'flat' : d.pct > 0 ? 'up' : 'dn';
  return ` <span class="mr-d ${cls}">${d.pct > 0 ? '↑' : d.pct < 0 ? '↓' : '·'} ${Math.abs(d.pct).toFixed(1)}%</span>`;
}
function kpiCards(t, cmp) {
  const d = cmp && cmp.hasBase ? cmp.deltas : null;
  /* Four primary cards only. Everything else is a compact metric below —
     eight giant cards is how the old page filled space without adding
     information. */
  return QLX.statsHTML([
    { label: 'Net Sales', value: fShort(t.netSales) + (d ? deltaPill(d.netSales) : ''),
      sub: 'excl. GST · ' + t.invoices + ' invoice' + (t.invoices === 1 ? '' : 's'), tint: 'green', icon: SVG.rupee },
    { label: 'Net Purchases', value: fShort(t.netPurchases) + (d ? deltaPill(d.netPurchases) : ''),
      sub: 'excl. GST · ' + t.bills + ' bill' + (t.bills === 1 ? '' : 's'), tint: 'amber', icon: SVG.cart },
    { label: 'Gross Profit', value: fShort(t.grossProfit) + (d ? deltaPill(d.grossProfit) : ''),
      sub: 'net sales − net purchases', tint: t.grossProfit >= 0 ? 'blue' : 'red', icon: SVG.up },
    { label: 'Gross Margin', value: t.margin == null ? '—' : t.margin.toFixed(1) + '%' +
        (d && d.margin.pts != null ? ` <span class="mr-d ${d.margin.pts >= 0 ? 'up' : 'dn'}">${d.margin.pts >= 0 ? '↑' : '↓'} ${Math.abs(d.margin.pts).toFixed(1)} pts</span>` : ''),
      sub: t.margin == null ? 'no sales in this period' : 'of net sales', tint: 'indigo', icon: SVG.pct }
  ]);
}
function miniHTML(t) {
  const pq = t.purchaseQtyMissing > 0
    ? { v: t.purchaseQtyRecorded ? fT(t.purchaseQty) + ' T' : '—',
        s: t.purchaseQtyMissing + ' of ' + (t.purchaseQtyRecorded + t.purchaseQtyMissing) + ' bills carry no quantity' }
    : { v: fT(t.purchaseQty) + ' T', s: 'every bill recorded' };
  const cell = (l, v, s) => `<div><div class="l">${esc(l)}</div><div class="v">${v}</div><div class="s">${s || ''}</div></div>`;
  return `<div class="mr-mini">
    ${cell('Gross Sales', fC(t.grossSales), 'incl. GST')}
    ${cell('Gross Purchases', fC(t.grossPurchases), 'incl. GST')}
    ${cell('Sales Qty', fT(t.salesQty) + ' T', 'dispatched')}
    ${cell('Purchase Qty', pq.v, pq.s)}
    ${cell('Avg Invoice', t.avgInvoice == null ? '—' : fC(t.avgInvoice), 'net, per invoice')}
    ${cell('Avg Bill', t.avgBill == null ? '—' : fC(t.avgBill), 'net, per bill')}
    ${cell('Profit / Tonne', t.profitPerT == null ? '—' : fC(t.profitPerT), t.salesQty > 0 ? 'on ' + fT(t.salesQty) + ' T sold' : 'no tonnage')}
    ${cell('Net GST', fC(t.netGst), t.netGst >= 0 ? 'payable' : 'credit')}
  </div>`;
}

/* ── comparison strip ────────────────────────────────────────────────────── */
function cmpHTML(cmp) {
  if (!cmp) return '';
  if (!cmp.hasBase) return `<div class="mr-sec"><div class="mr-sec-b" style="border-top:0;padding-top:14px">
    <span class="mr-sec-s">No data for ${esc(cmp.baseLabel)}, so there is nothing to compare against. A percentage change from an empty month would be invented, not measured.</span>
  </div></div>`;
  const F = [['netSales', 'Net Sales', fShort], ['netPurchases', 'Net Purchases', fShort],
             ['grossProfit', 'Gross Profit', fShort], ['salesQty', 'Sales Qty', v => fT(v) + ' T'],
             ['invoices', 'Invoices', v => v], ['collected', 'Collected', fShort]];
  const cells = F.map(([k, label, fmt]) => {
    const d = cmp.deltas[k];
    return `<div><div class="l">${label}</div><div class="v">${fmt(d.now)}${deltaPill(d)}</div>
      <div class="s">was ${fmt(d.was)}</div></div>`;
  }).join('');
  return `<details class="mr-sec" open><summary class="mr-sec-h">
      <span class="mr-sec-t">Compared with ${esc(cmp.baseLabel)}</span>
      <span class="mr-sec-sp"></span>${ic('chev', 'mr-sec-ch')}</summary>
    <div class="mr-sec-b"><div class="mr-mini" style="margin:0">${cells}</div></div></details>`;
}

/* ── chart ───────────────────────────────────────────────────────────────
   Plain SVG — this app carries no chart library and adding one for three
   series would be a large dependency for a small job. Bars for sales and
   purchases, a line for profit, and the selected month called out. */
const SERIES_META = [
  { k: 'netSales', label: 'Net Sales', color: 'var(--ql-success-500)' },
  { k: 'netPurchases', label: 'Net Purchases', color: 'var(--ql-warning-500)' },
  { k: 'grossProfit', label: 'Gross Profit', color: 'var(--ql-brand-500)' }
];
function chartHTML(fyRows) {
  const on = SERIES_META.filter(s => SERIES[s.k]);
  const legend = SERIES_META.map(s => `<button data-series="${s.k}" class="${SERIES[s.k] ? 'on' : 'off'}">
      <span class="dot" style="background:${s.color}"></span>${s.label}</button>`).join('');
  if (!fyRows.some(r => r.invoices || r.bills)) {
    return `<div class="mr-lg">${legend}</div><div class="mr-empty"><div class="t">Nothing to chart yet</div>
      <div>No transactions recorded in ${esc(MR.fyLabel(FY))}.</div></div>`;
  }
  const W = 1000, H = 240, PL = 64, PR = 16, PT = 12, PB = 30;
  const iw = W - PL - PR, ih = H - PT - PB, n = fyRows.length;
  const bandW = iw / n;
  let max = 0;
  fyRows.forEach(r => on.forEach(s => { if (r[s.k] > max) max = r[s.k]; }));
  fyRows.forEach(r => { if (SERIES.grossProfit && r.grossProfit < 0 && -r.grossProfit > max) max = -r.grossProfit; });
  if (max <= 0) max = 1;
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const niceMax = Math.ceil(max / step) * step;
  const y = v => PT + ih - (v / niceMax) * ih;

  const grid = [0, .25, .5, .75, 1].map(f => {
    const gy = PT + ih - f * ih, val = niceMax * f;
    return `<line x1="${PL}" y1="${gy}" x2="${W - PR}" y2="${gy}" stroke="var(--ql-divider)" stroke-width="1"/>
      <text x="${PL - 8}" y="${gy + 4}" text-anchor="end" font-size="11" fill="var(--ql-text-muted)">${f === 0 ? '0' : fShort(val).replace('₹', '')}</text>`;
  }).join('');

  const bars = ['netSales', 'netPurchases'].filter(k => SERIES[k]);
  const bw = bars.length ? Math.min(18, (bandW - 12) / bars.length) : 0;
  let body = '';
  fyRows.forEach((r, i) => {
    const cx = PL + bandW * i + bandW / 2;
    bars.forEach((k, j) => {
      const meta = SERIES_META.find(s => s.k === k);
      const x = cx - (bars.length * bw) / 2 + j * bw;
      const h = Math.max(0, PT + ih - y(Math.max(0, r[k])));
      body += `<rect x="${x.toFixed(1)}" y="${y(Math.max(0, r[k])).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${meta.color}" rx="2"/>`;
    });
  });
  if (SERIES.grossProfit) {
    const pts = fyRows.map((r, i) => (PL + bandW * i + bandW / 2).toFixed(1) + ',' + y(r.grossProfit).toFixed(1)).join(' ');
    body += `<polyline points="${pts}" fill="none" stroke="var(--ql-brand-500)" stroke-width="2.5" stroke-linejoin="round"/>`;
    body += fyRows.map((r, i) => `<circle cx="${(PL + bandW * i + bandW / 2).toFixed(1)}" cy="${y(r.grossProfit).toFixed(1)}" r="3.5" fill="var(--ql-card)" stroke="var(--ql-brand-500)" stroke-width="2"/>`).join('');
  }
  const labels = fyRows.map((r, i) => {
    const cx = PL + bandW * i + bandW / 2, sel = r.ym === MONTH;
    return `${sel ? `<rect x="${(PL + bandW * i).toFixed(1)}" y="${PT}" width="${bandW.toFixed(1)}" height="${ih}" fill="var(--qx-soft)" opacity=".55"/>` : ''}
      <text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11" font-weight="${sel ? 700 : 500}" fill="${sel ? 'var(--qx-ink)' : 'var(--ql-text-muted)'}">${r.label.split(' ')[0]}</text>`;
  }).join('');
  const hit = fyRows.map((r, i) => `<rect class="mr-hit" data-ym="${r.ym}" x="${(PL + bandW * i).toFixed(1)}" y="${PT}" width="${bandW.toFixed(1)}" height="${ih}" fill="transparent" style="cursor:pointer"/>`).join('');

  return `<div class="mr-lg">${legend}</div>
    <div class="mr-chart" id="mrChart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Monthly sales, purchases and gross profit">
        ${labels}${grid}${body}${hit}
      </svg>
      <div class="mr-tip" id="mrTip"></div>
    </div>`;
}

/* ── the register grid ───────────────────────────────────────────────────── */
const COLS = [
  { k: 'ym', label: 'Month', sticky: true, cell: r => `<span class="mr-mon">${esc(r.label)}<small>${r.invoices} inv · ${r.bills} bills</small></span>` },
  { k: 'invoices', label: 'Sales Inv', num: true, cell: r => r.invoices },
  { k: 'bills', label: 'Pur Bills', num: true, cell: r => r.bills },
  { k: 'salesQty', label: 'Sales Qty (T)', num: true, cell: r => fT(r.salesQty) },
  { k: 'purchaseQtyN', label: 'Pur Qty (T)', num: true,
    cell: r => r.purchaseQty.recorded ? fT(r.purchaseQty.qty) + (r.purchaseQty.missing ? '<span class="mr-na" title="' + r.purchaseQty.missing + ' bill(s) carry no quantity"> +?</span>' : '')
                                      : NA(r.purchaseQty.bills ? 'No quantity on any purchase bill this month' : 'No purchase bills') },
  { k: 'grossSales', label: 'Gross Sales', num: true, cell: r => fC(r.grossSales) },
  { k: 'salesReturns', label: 'Sales Ret.', num: true, cell: () => NA('Sales returns are not recorded anywhere in QuickLimes — there is no store for them, so this cannot be 0 either') },
  { k: 'netSales', label: 'Net Sales', num: true, strong: true, cell: r => fC(r.netSales) },
  { k: 'grossPurchases', label: 'Gross Pur.', num: true, cell: r => fC(r.grossPurchases) },
  { k: 'purchaseReturns', label: 'Pur Ret.', num: true, cell: () => NA('Purchase returns are not recorded anywhere in QuickLimes') },
  { k: 'netPurchases', label: 'Net Purchases', num: true, strong: true, cell: r => fC(r.netPurchases) },
  { k: 'gstOut', label: 'GST Output', num: true, cell: r => fC(r.gstOut) },
  { k: 'gstIn', label: 'GST Input', num: true, cell: r => fC(r.gstIn) },
  { k: 'grossProfit', label: 'Gross Profit', num: true, strong: true, cell: r => `<span class="${r.grossProfit >= 0 ? 'mr-pos' : 'mr-neg'}">${fC(r.grossProfit)}</span>` },
  { k: 'margin', label: 'Margin %', num: true, cell: r => r.margin == null ? NA('No sales this month') : `<span class="${r.margin >= 0 ? 'mr-pos' : 'mr-neg'}">${r.margin.toFixed(1)}%</span>` },
  { k: 'collected', label: 'Collected', num: true, cell: r => fC(r.collected) },
  { k: 'outstanding', label: 'Outstanding', num: true, cell: r => fC(r.outstanding) },
  { k: 'status', label: 'Status', cell: r => {
      if (!r.invoices && !r.bills) return '<span class="mr-na">No activity</span>';
      if (r.outstanding <= 0.5) return '<span class="mr-pos">Settled</span>';
      if (r.collected > 0.5) return '<span style="color:var(--ql-warning-700);font-weight:600">Part-collected</span>';
      return '<span class="mr-neg">Uncollected</span>';
    } }
];
const sortVal = (r, k) => k === 'purchaseQtyN' ? r.purchaseQty.qty : (k === 'ym' ? r.ym : (k === 'status' ? r.outstanding : r[k]));

function tableHTML(rows, t) {
  if (!rows.length) return `<div class="mr-wrap"><div class="mr-empty">
    <div class="t">No transactions in ${esc(MONTH ? MR.monthName(MONTH) : MR.fyLabel(FY))}</div>
    <div>Nothing was invoiced or purchased in this period. Pick another period, or record the first entry.</div></div></div>`;
  const sorted = rows.slice().sort((a, b) => {
    const x = sortVal(a, SORT.key), y = sortVal(b, SORT.key);
    const c = (typeof x === 'string') ? x.localeCompare(y) : ((x || 0) - (y || 0));
    return SORT.dir === 'asc' ? c : -c;
  });
  const head = COLS.map(c => `<th class="${c.num ? 'num' : ''}${c.sticky ? ' mr-sticky' : ''}" data-sort="${c.k}">
      ${esc(c.label)}${SORT.key === c.k ? (SORT.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>`).join('');
  const body = sorted.map(r => `<tr data-ym="${r.ym}" class="${r.ym === MONTH ? 'on' : ''}">${
    COLS.map(c => `<td class="${c.num ? 'num' : ''}${c.sticky ? ' mr-sticky' : ''}"${c.strong ? ' style="font-weight:700"' : ''}>${c.cell(r)}</td>`).join('')
  }</tr>`).join('');
  const foot = `<tr>
    <td class="mr-sticky">Total · ${t.months} month${t.months === 1 ? '' : 's'}</td>
    <td class="num">${t.invoices}</td><td class="num">${t.bills}</td>
    <td class="num">${fT(t.salesQty)}</td>
    <td class="num">${t.purchaseQtyRecorded ? fT(t.purchaseQty) : NA('No purchase quantity recorded')}</td>
    <td class="num">${fC(t.grossSales)}</td><td class="num">${NA('Not recorded in QuickLimes')}</td>
    <td class="num">${fC(t.netSales)}</td>
    <td class="num">${fC(t.grossPurchases)}</td><td class="num">${NA('Not recorded in QuickLimes')}</td>
    <td class="num">${fC(t.netPurchases)}</td>
    <td class="num">${fC(t.gstOut)}</td><td class="num">${fC(t.gstIn)}</td>
    <td class="num"><span class="${t.grossProfit >= 0 ? 'mr-pos' : 'mr-neg'}">${fC(t.grossProfit)}</span></td>
    <td class="num">${t.margin == null ? '—' : t.margin.toFixed(1) + '%'}</td>
    <td class="num">${fC(t.collected)}</td><td class="num">${fC(t.outstanding)}</td><td></td></tr>`;
  return `<div class="mr-wrap"><table class="mr">
    <thead><tr>${head}</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
}

/* ── analysis sections ───────────────────────────────────────────────────── */
function shareTable(list, total, cols) {
  if (!list || !list.length) return '<div class="mr-sec-s">Nothing in this period.</div>';
  const top = list.slice(0, 8);
  return `<table class="mr-mini-t"><thead><tr>
      <th>${cols[0]}</th><th class="num">Qty (T)</th><th class="num">Avg ₹/T</th><th class="num">Value</th><th class="num">Share</th>
    </tr></thead><tbody>${top.map(g => {
      const pct = total > 0 ? (g.value / total * 100) : 0;
      return `<tr>
        <td class="mr-share"><i style="width:${Math.max(2, pct).toFixed(1)}%"></i><span>${esc(g.key)}</span></td>
        <td class="num">${g.qty > 0 ? fT(g.qty) : NA('No quantity recorded on these rows')}</td>
        <td class="num">${g.avgRate == null ? NA('Needs a recorded quantity') : fC(g.avgRate)}</td>
        <td class="num" style="font-weight:600">${fC(g.value)}</td>
        <td class="num">${pct.toFixed(1)}%</td></tr>`;
    }).join('')}</tbody></table>
    ${list.length > 8 ? `<div class="mr-sec-s" style="margin-top:8px">Showing the top 8 of ${list.length}.</div>` : ''}`;
}
function section(id, title, sub, body, open) {
  return `<details class="mr-sec" id="${id}"${open ? ' open' : ''}><summary class="mr-sec-h">
    <span class="mr-sec-t">${esc(title)}</span><span class="mr-sec-s">${sub || ''}</span>
    <span class="mr-sec-sp"></span>${ic('chev', 'mr-sec-ch')}</summary>
    <div class="mr-sec-b">${body}</div></details>`;
}
const kv = (k, v, cls) => `<div class="mr-kv ${cls || ''}"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`;

function salesSection(sa, t) {
  const prod = sa.products
    ? shareTable(sa.products, t.netSales, ['Product'])
    : `<div class="mr-sec-s">Sales invoices in QuickLimes carry a <code>product</code> field, but it is empty on every
       invoice in this book — so a product breakdown here would be one unnamed bucket pretending to be analysis.
       Recording the product on each invoice would make this section real.</div>`;
  return section('mrSales', 'Sales analysis', `${sa.count} invoices · ${fShort(t.netSales)} net`,
    `<div class="mr-2col">
      <div><div class="mr-sec-t" style="margin-bottom:10px">By customer</div>${shareTable(sa.customers, t.netSales, ['Customer'])}</div>
      <div><div class="mr-sec-t" style="margin-bottom:10px">By product</div>${prod}
        <div style="margin-top:16px">
          ${kv('Highest invoice', sa.highest == null ? '—' : fC(sa.highest))}
          ${kv('Lowest invoice', sa.lowest == null ? '—' : fC(sa.lowest))}
          ${kv('Average invoice', sa.average == null ? '—' : fC(sa.average))}
          ${kv('Average rate', t.salesRatePerT == null ? NA('No tonnage recorded') : fC(t.salesRatePerT) + '/T')}
        </div></div>
    </div>`);
}
function purchaseSection(pa, t) {
  return section('mrPur', 'Purchase analysis', `${pa.count} bills · ${fShort(t.netPurchases)} net`,
    `<div class="mr-2col">
      <div><div class="mr-sec-t" style="margin-bottom:10px">By supplier</div>${shareTable(pa.suppliers, t.netPurchases, ['Supplier'])}</div>
      <div><div class="mr-sec-t" style="margin-bottom:10px">By material</div>${shareTable(pa.materials, t.netPurchases, ['Material'])}
        <div style="margin-top:16px">
          ${kv('Highest bill', pa.highest == null ? '—' : fC(pa.highest))}
          ${kv('Lowest bill', pa.lowest == null ? '—' : fC(pa.lowest))}
          ${kv('Average bill', pa.average == null ? '—' : fC(pa.average))}
          ${kv('Average rate', t.purchaseRatePerT == null ? NA('No tonnage recorded on any bill') : fC(t.purchaseRatePerT) + '/T')}
        </div></div>
    </div>`);
}
function profitSection(t) {
  return section('mrProfit', 'Profitability', t.margin == null ? 'no sales' : t.margin.toFixed(1) + '% gross margin',
    `<div class="mr-2col"><div>
      ${kv('Net sales (excl. GST)', fC(t.netSales))}
      ${kv('Less: net purchases', '− ' + fC(t.netPurchases))}
      ${kv('Gross profit', `<span class="${t.grossProfit >= 0 ? 'mr-pos' : 'mr-neg'}">${fC(t.grossProfit)}</span>`, 'tot')}
      ${kv('Gross margin', t.margin == null ? '—' : t.margin.toFixed(1) + '%')}
    </div><div>
      ${kv('Quantity sold', fT(t.salesQty) + ' T')}
      ${kv('Quantity purchased', t.purchaseQtyRecorded ? fT(t.purchaseQty) + ' T' + (t.purchaseQtyMissing ? ' (partial)' : '') : NA('No purchase quantity recorded'))}
      ${kv('Sales rate / tonne', t.salesRatePerT == null ? '—' : fC(t.salesRatePerT))}
      ${kv('Purchase cost / tonne', t.purchaseRatePerT == null ? NA('Needs quantities on the purchase bills') : fC(t.purchaseRatePerT))}
      ${kv('Profit / tonne sold', t.profitPerT == null ? '—' : fC(t.profitPerT))}
    </div></div>
    <div class="mr-sec-s" style="margin-top:14px">
      <b>How this is calculated.</b> Gross profit here is <b>net sales − net purchases in the same period</b>, both
      excluding GST — the definition QuickLimes has always used, unchanged. It is not a full accounting profit:
      QuickLimes holds no opening or closing inventory valuation, so purchases are treated as period cost rather than
      cost of goods sold. In a month where you buy more than you burn, this understates profit; where you sell from
      stock bought earlier, it overstates it. Labour, freight and overheads are not deducted here — see Profit &amp; Loss.
    </div>`);
}
function gstSection(t) {
  return section('mrGst', 'GST analysis', 'net ' + fC(Math.abs(t.netGst)) + (t.netGst >= 0 ? ' payable' : ' credit'),
    `<div class="mr-2col"><div>
      <div class="mr-sec-t" style="margin-bottom:10px">Output tax (on sales)</div>
      ${kv('CGST', fC(t.cgstOut))}${kv('SGST', fC(t.sgstOut))}${kv('IGST', fC(t.igstOut))}
      ${kv('Total output GST', fC(t.gstOut), 'tot')}
      ${kv('Taxable sales', fC(t.netSales))}
    </div><div>
      <div class="mr-sec-t" style="margin-bottom:10px">Input tax credit (on purchases)</div>
      ${kv('Eligible ITC', fC(t.gstIn))}
      ${kv('Taxable purchases', fC(t.netPurchases))}
      ${kv('Credit / debit notes', NA('Credit and debit notes do not exist in this data model'))}
      ${kv('Net GST position', `<b>${fC(Math.abs(t.netGst))} ${t.netGst >= 0 ? 'payable' : 'credit'}</b>`, 'tot')}
    </div></div>
    <div class="mr-sec-s" style="margin-top:14px">Output tax is split by the customer's GSTIN state: anything outside
      Rajasthan (code 08) is IGST, the rest CGST + SGST in equal halves. Input tax is <b>eligible ITC</b> — a bill marked
      ineligible or reverse-charge contributes none. Cancelled, deleted and archived documents are excluded from both
      sides, matching the GST Summary page.</div>`);
}
function collectionSection(t, age, srcRows) {
  const B = [['current', 'Current'], ['d30', '1–30 days'], ['d60', '31–60 days'], ['d90', '61–90 days'], ['d90p', '90+ days']];
  const billed = t.netSales + t.gstOut;
  return section('mrColl', 'Collections & outstanding',
    t.collectionPct == null ? 'nothing billed' : t.collectionPct.toFixed(1) + '% collected',
    `<div class="mr-2col"><div>
      ${kv('Total invoiced (incl. GST)', fC(billed))}
      ${kv('Collected', `<span class="mr-pos">${fC(t.collected)}</span>`)}
      ${kv('Outstanding', `<span class="mr-neg">${fC(t.outstanding)}</span>`, 'tot')}
      ${kv('Collection rate', t.collectionPct == null ? '—' : t.collectionPct.toFixed(1) + '%')}
      ${kv('Supplier dues from this period', fC(t.purchaseOutstanding))}
    </div><div>
      <div class="mr-sec-t" style="margin-bottom:10px">Ageing of what is still owed</div>
      <table class="mr-mini-t"><thead><tr><th>Bucket</th><th class="num">Invoices</th><th class="num">Amount</th></tr></thead>
      <tbody>${B.map(([k, l]) => `<tr><td>${l}</td><td class="num">${age[k].count}</td>
        <td class="num" style="font-weight:600">${age[k].amount > 0 ? fC(age[k].amount) : '—'}</td></tr>`).join('')}
        <tr><td style="font-weight:700">Overdue total</td><td class="num"></td>
        <td class="num"><span class="mr-neg">${fC(age.overdue)}</span></td></tr></tbody></table>
      <div class="mr-sec-s" style="margin-top:8px">Aged from the invoice date as at ${esc(Q.fDS(todayISO()))}. QuickLimes
        records no payment-terms field, so "current" means invoiced today; there is no due-date to age against.</div>
    </div></div>`);
}
function insightSection(list) {
  if (!list.length) return '';
  const sym = { up: '↑', down: '↓', info: 'i' };
  return section('mrIns', 'Business insights', list.length + ' from this period',
    list.map(i => `<div class="mr-ins ${i.tone}"><span class="i">${sym[i.tone] || 'i'}</span><span>${esc(i.text)}</span></div>`).join(''), true);
}
function exceptionSection(list) {
  if (!list.length) return section('mrEx', 'Attention required', 'nothing flagged',
    '<div class="mr-sec-s">No unpaid invoices, missing GSTINs, missing quantities or duplicate numbers in this period.</div>');
  const n = list.reduce((a, e) => a + e.count, 0);
  return section('mrEx', 'Attention required', n + ' item' + (n === 1 ? '' : 's') + ' across ' + list.length + ' check' + (list.length === 1 ? '' : 's'),
    list.map(e => `<div class="mr-ex ${e.sev}"><span class="b">${e.count}</span>
      <span class="t">${esc(e.label)}<small>${esc(e.why)}</small></span>
      <span class="a">${e.amount == null ? '' : fC(e.amount)}</span></div>`).join(''), true);
}
function reconSection(rec) {
  return section('mrRec', 'Reconciliation', rec.ok ? 'all ' + rec.checks.length + ' checks agree' : rec.failed.length + ' DISAGREE',
    `<div class="mr-rec">${rec.checks.map(c => `<div class="row ${c.ok ? 'ok' : 'no'}">
        <span class="tick">${c.ok ? '✓' : '!'}</span><span class="k">${esc(c.k)}</span>
        <span class="n">${typeof c.got === 'number' && c.got > 1000 ? fC(c.got) : c.got}${c.ok ? '' : ' vs ' + (typeof c.want === 'number' && c.want > 1000 ? fC(c.want) : c.want)}</span>
      </div>`).join('')}</div>
     <div class="mr-sec-s" style="margin-top:12px">Each figure this page shows is recomputed from the same rows the Sales
       and Purchase registers read, then checked against them. A mismatch is reported here rather than hidden — including
       the property the old page failed, that gross profit must equal net sales minus net purchases.</div>`,
    !rec.ok);
}

/* ── month drill-down ────────────────────────────────────────────────────── */
let DD = { ym: null, tab: 'summary' };
function openDrill(ym) { DD = { ym, tab: 'summary' }; paintDrill(); $('mrDDBack').classList.add('open'); $('mrDD').classList.add('open'); }
function closeDrill() { $('mrDDBack').classList.remove('open'); $('mrDD').classList.remove('open'); DD.ym = null; }
function paintDrill() {
  if (!DD.ym) return;
  const { sales, purchases } = rows();
  const r = MR.monthStats(sales, purchases, DD.ym);
  const sa = MR.salesAnalysis(r), pa = MR.purchaseAnalysis(r);
  const age = MR.ageing(r._sales, todayISO());
  $('mrDDTitle').textContent = r.label;
  $('mrDDSub').textContent = `${r.invoices} invoices · ${r.bills} bills · ${fC(r.netSales)} net sales · ${fC(r.grossProfit)} gross profit`;
  const TABS = [['summary', 'Summary'], ['sales', 'Sales'], ['purchases', 'Purchases'],
                ['customers', 'Customers'], ['suppliers', 'Suppliers'], ['gst', 'GST'], ['coll', 'Collections']];
  $('mrDDTabs').innerHTML = TABS.map(([k, l]) => `<button data-dtab="${k}" class="${DD.tab === k ? 'on' : ''}">${l}</button>`).join('');

  /* Links AT the document, not merely at the register it lives in. QLX reads
     ?find= at mount, so the row arrives already filtered — section 9's
     "clicking an invoice should take the user to the actual invoice". */
  const docHref = (r2, kind) => (kind === 'sale' ? 'sales.html' : 'purchase.html') +
    '?find=' + encodeURIComponent(r2.inv || r2.bill || '');
  const docRow = (r2, kind) => `<tr>
    <td><a class="mr-lnk" href="${docHref(r2, kind)}">${esc(r2.inv || r2.bill || '—')}</a></td>
    <td>${esc(Q.fDS(r2.date))}</td><td>${esc(r2.party || r2.sup || '—')}</td>
    <td class="num">${+r2.qty > 0 ? fT(r2.qty) : NA('No quantity on this document')}</td>
    <td class="num">${fC(r2.taxable)}</td><td class="num">${fC(r2.gst)}</td>
    <td class="num" style="font-weight:600">${fC(r2.total)}</td>
    <td class="num">${+r2.outstanding > 0.5 ? `<span class="mr-neg">${fC(r2.outstanding)}</span>` : '<span class="mr-pos">settled</span>'}</td></tr>`;
  const docTable = (list, kind) => list.length ? `<table class="mr-mini-t"><thead><tr>
      <th>${kind === 'sale' ? 'Invoice' : 'Bill'}</th><th>Date</th><th>${kind === 'sale' ? 'Customer' : 'Supplier'}</th>
      <th class="num">Qty</th><th class="num">Taxable</th><th class="num">GST</th><th class="num">Total</th><th class="num">Outstanding</th>
    </tr></thead><tbody>${list.map(x => docRow(x, kind)).join('')}</tbody></table>`
    : `<div class="mr-empty"><div class="t">Nothing here</div><div>No ${kind === 'sale' ? 'invoices' : 'purchase bills'} in ${esc(r.label)}.</div></div>`;

  let body = '';
  if (DD.tab === 'summary') {
    body = `<div class="mr-2col">
      <div><div class="mr-sec-t" style="margin-bottom:10px">Sales</div>
        ${kv('Invoices', r.invoices)}${kv('Customers', sa.customers.length)}
        ${kv('Gross sales (incl. GST)', fC(r.grossSales))}
        ${kv('Sales returns', NA('Not recorded in QuickLimes'))}
        ${kv('Net sales (excl. GST)', fC(r.netSales), 'tot')}
        ${kv('Quantity', fT(r.salesQty) + ' T')}
        ${kv('Average invoice', r.avgInvoice == null ? '—' : fC(r.avgInvoice))}
        ${kv('Output GST', fC(r.gstOut))}</div>
      <div><div class="mr-sec-t" style="margin-bottom:10px">Purchases</div>
        ${kv('Bills', r.bills)}${kv('Suppliers', pa.suppliers.length)}
        ${kv('Gross purchases (incl. GST)', fC(r.grossPurchases))}
        ${kv('Purchase returns', NA('Not recorded in QuickLimes'))}
        ${kv('Net purchases (excl. GST)', fC(r.netPurchases), 'tot')}
        ${kv('Quantity', r.purchaseQty.recorded ? fT(r.purchaseQty.qty) + ' T' + (r.purchaseQty.missing ? ` (${r.purchaseQty.missing} bill(s) unrecorded)` : '') : NA('No quantity on any bill'))}
        ${kv('Input GST (eligible ITC)', fC(r.gstIn))}</div></div>
      <div class="mr-2col"><div><div class="mr-sec-t" style="margin-bottom:10px">Profitability</div>
        ${kv('Net sales', fC(r.netSales))}${kv('Purchase cost', '− ' + fC(r.netPurchases))}
        ${kv('Gross profit', `<span class="${r.grossProfit >= 0 ? 'mr-pos' : 'mr-neg'}">${fC(r.grossProfit)}</span>`, 'tot')}
        ${kv('Margin', r.margin == null ? '—' : r.margin.toFixed(1) + '%')}
        ${kv('Profit / tonne', r.profitPerT == null ? '—' : fC(r.profitPerT))}</div>
      <div><div class="mr-sec-t" style="margin-bottom:10px">Collections</div>
        ${kv('Collected', fC(r.collected))}${kv('Outstanding', fC(r.outstanding))}
        ${kv('Collection rate', r.collectionPct == null ? '—' : r.collectionPct.toFixed(1) + '%')}</div></div>`;
  } else if (DD.tab === 'sales') body = docTable(r._sales, 'sale');
  else if (DD.tab === 'purchases') body = docTable(r._purchases, 'purchase');
  else if (DD.tab === 'customers') body = shareTable(sa.customers, r.netSales, ['Customer']);
  else if (DD.tab === 'suppliers') body = shareTable(pa.suppliers, r.netPurchases, ['Supplier']);
  else if (DD.tab === 'gst') body = `<div class="mr-2col"><div>
      <div class="mr-sec-t" style="margin-bottom:10px">Output</div>
      ${kv('CGST', fC(r.cgstOut))}${kv('SGST', fC(r.sgstOut))}${kv('IGST', fC(r.igstOut))}${kv('Total', fC(r.gstOut), 'tot')}</div>
      <div><div class="mr-sec-t" style="margin-bottom:10px">Input</div>
      ${kv('Eligible ITC', fC(r.gstIn))}${kv('Net position', `<b>${fC(Math.abs(r.netGst))} ${r.netGst >= 0 ? 'payable' : 'credit'}</b>`, 'tot')}</div></div>`;
  else if (DD.tab === 'coll') {
    const B = [['current', 'Current'], ['d30', '1–30 days'], ['d60', '31–60 days'], ['d90', '61–90 days'], ['d90p', '90+ days']];
    body = `<table class="mr-mini-t"><thead><tr><th>Bucket</th><th class="num">Invoices</th><th class="num">Amount</th></tr></thead>
      <tbody>${B.map(([k, l]) => `<tr><td>${l}</td><td class="num">${age[k].count}</td><td class="num">${age[k].amount > 0 ? fC(age[k].amount) : '—'}</td></tr>`).join('')}</tbody></table>`;
  }
  $('mrDDBody').innerHTML = body;
  $('mrDDTabs').querySelectorAll('[data-dtab]').forEach(b => b.onclick = () => { DD.tab = b.dataset.dtab; paintDrill(); });
}

/* ── export ──────────────────────────────────────────────────────────────── */
function openExport() {
  const { sales, purchases } = rows();
  const reg = MR.register(sales, purchases, { fy: FY });
  const scope = MONTH ? [reg.find(r => r.ym === MONTH)].filter(Boolean) : reg;
  const t = MR.totals(scope);
  const name = base => base + '_' + String(Q.co.short || '').replace(/\s+/g, '_') + '_' +
    (MONTH ? MONTH : MR.fyLabel(FY).replace(/\s+/g, ''));
  const OPTS = [
    ['Monthly summary', () => QLShell.exportCSV(name('monthly_register'),
      ['Month', 'Sales Invoices', 'Purchase Bills', 'Sales Qty (T)', 'Purchase Qty (T)', 'Purchase Qty Missing (bills)',
       'Gross Sales', 'Net Sales', 'Gross Purchases', 'Net Purchases', 'GST Output', 'GST Input',
       'Gross Profit', 'Margin %', 'Collected', 'Outstanding'],
      scope.map(r => [r.label, r.invoices, r.bills, r.salesQty, r.purchaseQty.qty, r.purchaseQty.missing,
        r.grossSales, r.netSales, r.grossPurchases, r.netPurchases, r.gstOut, r.gstIn,
        r.grossProfit, r.margin == null ? '' : r.margin, r.collected, r.outstanding]))],
    ['Sales details', () => QLShell.exportCSV(name('sales_details'),
      ['Invoice', 'Date', 'Customer', 'GSTIN', 'Qty (T)', 'Taxable', 'GST', 'Total', 'Paid', 'Outstanding', 'Status'],
      scope.flatMap(r => r._sales).map(s => [s.inv, s.date, s.party, s.gstin || '', s.qty, s.taxable, s.gst, s.total, s.paid, s.outstanding, s.status]))],
    ['Purchase details', () => QLShell.exportCSV(name('purchase_details'),
      ['Bill', 'Date', 'Supplier', 'GSTIN', 'Material', 'Qty (T)', 'Taxable', 'GST', 'ITC', 'Total', 'Outstanding', 'Status'],
      scope.flatMap(r => r._purchases).map(p => [p.bill, p.date, p.sup, p.gstin || '', p.groupLabel || p.group || '', p.qty, p.taxable, p.gst, p.itc, p.total, p.outstanding, p.status]))],
    ['GST summary', () => QLShell.exportCSV(name('gst_summary'),
      ['Month', 'Taxable Sales', 'CGST', 'SGST', 'IGST', 'Output GST', 'Taxable Purchases', 'Input ITC', 'Net GST'],
      scope.map(r => [r.label, r.netSales, r.cgstOut, r.sgstOut, r.igstOut, r.gstOut, r.netPurchases, r.gstIn, r.netGst]))],
    ['Profitability', () => QLShell.exportCSV(name('profitability'),
      ['Month', 'Net Sales', 'Net Purchases', 'Gross Profit', 'Margin %', 'Sales Qty (T)', 'Sales Rate/T', 'Purchase Rate/T', 'Profit/T'],
      scope.map(r => [r.label, r.netSales, r.netPurchases, r.grossProfit, r.margin == null ? '' : r.margin,
        r.salesQty, r.salesRatePerT == null ? '' : r.salesRatePerT, r.purchaseRatePerT == null ? '' : r.purchaseRatePerT,
        r.profitPerT == null ? '' : r.profitPerT]))],
    ['Collections', () => QLShell.exportCSV(name('collections'),
      ['Month', 'Invoiced (incl GST)', 'Collected', 'Outstanding', 'Collection %'],
      scope.map(r => [r.label, r.netSales + r.gstOut, r.collected, r.outstanding, r.collectionPct == null ? '' : r.collectionPct]))]
  ];
  QLShell.panel({
    title: 'Export', wide: false,
    sub: (MONTH ? MR.monthName(MONTH) : MR.fyLabel(FY)) + ' · ' + t.invoices + ' invoices · ' + t.bills + ' bills',
    body: `<div class="mr-sec-s" style="margin-bottom:12px">Every export respects the period selected above. Amounts are
      exact rupees, not the shortened figures on the cards. Returns and credit notes are omitted because QuickLimes does
      not record them — an empty column would read as "none".</div>
      ${OPTS.map((o, i) => `<button class="ql-btn ql-btn-secondary" data-x="${i}" style="width:100%;justify-content:flex-start;margin-bottom:8px">${esc(o[0])}</button>`).join('')}`,
    actions: [{ label: 'Close', onClick: () => QLShell.closeModal() }],
    onMount: el => el.querySelectorAll('[data-x]').forEach(b => b.onclick = () => {
      OPTS[+b.dataset.x][1](); QLShell.toast('Exported', 'ok'); QLShell.closeModal();
    })
  });
}

/* ── render ──────────────────────────────────────────────────────────────── */
function render() {
  paintHero();
  const main = $('mrBody'); if (!main) return;
  if (ERR) {
    main.innerHTML = `<div class="mr-sec"><div class="mr-sec-b" style="border-top:0">
      <div class="mr-empty"><div class="t">Could not load the register</div><div>${esc(ERR)}</div>
      <button class="ql-btn ql-btn-primary" id="mrRetry" style="margin-top:14px">Retry</button></div></div></div>`;
    $('mrRetry').onclick = () => { ERR = null; invalidate(); render(); };
    return;
  }
  const { sales, purchases } = rows();
  const fys = MR.fysIn(sales, purchases);
  if (!fys.length) {
    $('mrBar').innerHTML = '';
    main.innerHTML = `<div class="mr-sec"><div class="mr-sec-b" style="border-top:0">
      <div class="mr-empty"><div class="t">No transactions yet</div>
      <div>Once sales invoices or purchase bills exist, this register fills itself from them.</div></div></div></div>`;
    return;
  }
  if (!FY || fys.indexOf(FY) < 0) {
    const seed = Q.uiMonth && Q.uiMonth();
    FY = (seed && fys.indexOf(MR.fyOf(seed)) >= 0) ? MR.fyOf(seed) : fys[0];
  }
  const reg = MR.register(sales, purchases, { fy: FY });
  const monthsWith = reg.map(r => r.ym);
  if (MONTH && monthsWith.indexOf(MONTH) < 0) MONTH = null;

  $('mrBar').innerHTML = barHTML(fys, monthsWith);
  const scope = MONTH ? reg.filter(r => r.ym === MONTH) : reg;
  const t = MR.totals(scope);
  const cmp = (MONTH && CMP !== 'off') ? MR.compare(sales, purchases, MONTH, CMP) : null;

  /* The chart always shows the WHOLE financial year, twelve months April→March,
     even when one month is selected — a single bar is not a trend. */
  const fyRows = MR.fyMonths(FY).map(m => MR.monthStats(sales, purchases, m));
  const scopeSales = scope.flatMap(r => r._sales);
  const sa = MR.salesAnalysis({ _sales: scopeSales });
  const pa = MR.purchaseAnalysis({ _purchases: scope.flatMap(r => r._purchases) });
  const age = MR.ageing(scopeSales, todayISO());
  const ins = MR.insights(t.months === 1 ? scope[0] : Object.assign({}, t, { _sales: scopeSales }), cmp, sa, pa);
  const exs = MR.exceptions({ _sales: scopeSales, _purchases: scope.flatMap(r => r._purchases) });
  const rec = MR.reconcile(sales.filter(r => MR.fyOf(r.date) === FY), purchases.filter(r => MR.fyOf(r.date) === FY), reg);

  $('mrScope').textContent = `${t.invoices} invoices · ${t.bills} bills · ${t.months} month${t.months === 1 ? '' : 's'}`;
  $('mrSub').textContent = `${Q.co.short} · ${MR.fyLabel(FY)}${MONTH ? ' · ' + MR.monthName(MONTH) : ''} · ${fC(t.grossProfit)} gross profit`;

  main.innerHTML =
    `<div class="mr-print-head">
      <h1>QUICKLIMES · MONTHLY BUSINESS REGISTER</h1>
      <div class="co">${esc(Q.co.name || Q.co.short || '')}</div>
      <div class="meta">${MR.fyLabel(FY)}${MONTH ? ' · ' + MR.monthName(MONTH) : ' · full year'} · printed ${esc(Q.fDS(todayISO()))}</div>
      <hr></div>` +
    kpiCards(t, cmp) + miniHTML(t) + cmpHTML(cmp) +
    section('mrChartSec', 'Monthly performance', MR.fyLabel(FY) + ' · April to March', chartHTML(fyRows), true) +
    section('mrTable', 'Monthly register', t.months + ' month' + (t.months === 1 ? '' : 's') + ' · click a row for the detail',
      tableHTML(scope, t), true) +
    salesSection(sa, t) + purchaseSection(pa, t) + profitSection(t) + gstSection(t) +
    collectionSection(t, age, scopeSales) + insightSection(ins) + exceptionSection(exs) + reconSection(rec);

  wire(reg);
  LOADED = true;
}

function wire(reg) {
  const fy = $('mrFy'); if (fy) fy.onchange = e => { FY = e.target.value; MONTH = null; render(); };
  const mo = $('mrMonthBtn');
  if (mo) mo.onclick = e => {
    e.stopPropagation();
    QLShell.monthPicker(e.currentTarget, {
      month: MONTH || FY, have: new Set(reg.map(r => r.ym)),
      years: false, allLabel: 'Whole year', quick: false, custom: false,
      onPick: p => {
        MONTH = (p && /^\d{4}-\d{2}$/.test(p)) ? p : null;
        if (MONTH && Q.setUiMonth) Q.setUiMonth(MONTH);
        render();
      }
    });
  };
  document.querySelectorAll('[data-cmp]').forEach(b => b.onclick = () => { CMP = b.dataset.cmp; render(); });
  document.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => { MONTH = null; render(); });
  document.querySelectorAll('[data-series]').forEach(b => b.onclick = () => {
    const k = b.dataset.series;
    /* Never let the last series be switched off — an empty chart is not a view. */
    if (SERIES[k] && Object.keys(SERIES).filter(x => SERIES[x]).length === 1) return;
    SERIES[k] = !SERIES[k]; render();
  });
  document.querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => {
    const k = th.dataset.sort;
    SORT = { key: k, dir: SORT.key === k && SORT.dir === 'desc' ? 'asc' : 'desc' };
    render();
  });
  document.querySelectorAll('tr[data-ym]').forEach(tr => tr.onclick = () => openDrill(tr.dataset.ym));

  /* chart interaction */
  const chart = $('mrChart'), tip = $('mrTip');
  if (chart && tip) {
    chart.querySelectorAll('.mr-hit').forEach(h => {
      h.onclick = () => { MONTH = h.dataset.ym; if (Q.setUiMonth) Q.setUiMonth(MONTH); render(); };
      h.onmouseenter = e => {
        const r = reg.find(x => x.ym === h.dataset.ym) ||
          MR.monthStats(rows().sales, rows().purchases, h.dataset.ym);
        tip.innerHTML = `<b>${esc(r.label)}</b>
          <div class="r"><span>Net sales</span><span>${fC(r.netSales)}</span></div>
          <div class="r"><span>Net purchases</span><span>${fC(r.netPurchases)}</span></div>
          <div class="r"><span>Gross profit</span><span>${fC(r.grossProfit)}</span></div>
          <div class="r"><span>Margin</span><span>${r.margin == null ? '—' : r.margin.toFixed(1) + '%'}</span></div>
          <div class="r"><span>Quantity</span><span>${fT(r.salesQty)} T</span></div>`;
        tip.classList.add('on');
      };
      h.onmousemove = e => {
        const b = chart.getBoundingClientRect();
        const x = e.clientX - b.left, y = e.clientY - b.top;
        tip.style.left = Math.min(b.width - 210, Math.max(0, x + 14)) + 'px';
        tip.style.top = Math.max(0, y - 10) + 'px';
      };
      h.onmouseleave = () => tip.classList.remove('on');
    });
  }
}

/* ── boot ────────────────────────────────────────────────────────────────── */
$('mrDDX').onclick = closeDrill;
$('mrDDBack').onclick = closeDrill;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && DD.ym) closeDrill(); });
window.__qlOnSwitchCompany = () => { invalidate(); FY = null; MONTH = null; render(); };
window.__qlRefresh = () => { invalidate(); render(); };
try { Q.init(render); } catch (e) { ERR = e && e.message ? e.message : String(e); render(); }
