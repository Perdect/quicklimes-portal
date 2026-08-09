/* ═══════════════════════════════════════════════════════════════════════
   group.js — Group Overview UI.  ONE page, every company.

   Reads each company's book DIRECTLY from its own saved blob
   (localStorage ql_data_<companyId> — the exact bytes data.js persists on
   every commit), summarizes each with GroupCore, and consolidates with
   provenance. No rows are ever mixed: "All Companies" is Σ of per-company
   summaries, and the breakdown IS the per-company summaries.

   Data isolation (§11): selecting one company renders ONLY that blob's
   summary; the other blob is not even read into the view model.

   Honesty rules carried over from the rest of the app:
   · a company whose blob has never been synced to this device is reported
     as missing — not silently rendered as zeros;
   · consolidated stock shows "—" if ANY company's stock is not computable
     (missing bill quantities), same refusal as the Inventory page.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  QLShell.mount({ active: 'group', title: 'Group Overview' });

  const G = window.GroupCore;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fC = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');
  const fT = n => (n == null ? '—' : (Math.round(n * 10) / 10).toLocaleString('en-IN') + ' T');

  /* ── companies straight from the account (same source data.js uses) ── */
  function companies() {
    let P = {};
    try { P = JSON.parse(localStorage.getItem('ql_plant') || '{}'); } catch (_) {}
    const plants = (Array.isArray(P.plants) && P.plants.length) ? P.plants : (P.id ? [P] : []);
    return plants.map(p => ({
      id: p.id,
      name: (p.plant_name || 'Company').toUpperCase(),
      short: p.plant_name || 'Company'
    }));
  }
  function readBlob(id) {
    try { const raw = localStorage.getItem('ql_data_' + id); return raw ? JSON.parse(raw) : null; }
    catch (_) { return null; }
  }

  /* ── state (persisted) ── */
  const LS_CO = 'ql_group_co', LS_RANGE = 'ql_group_range', LS_PART = 'ql_partnership';
  let COS = companies();
  let state = { co: 'all', preset: 'fy', from: null, to: null };
  try { const s = JSON.parse(localStorage.getItem(LS_RANGE) || 'null'); if (s && s.preset) state = Object.assign(state, s); } catch (_) {}
  const savedCo = localStorage.getItem(LS_CO);
  if (savedCo && (savedCo === 'all' || COS.some(c => c.id === savedCo))) state.co = savedCo;

  /* ── PARTNERSHIP: whose firm is whose, and on what share ──────────────
     This is a partnership, not a parent-and-subsidiary: one firm is the
     owner's, the other is the partner's, and the two kilns are run jointly.
     Roles default from the firm name and are editable; the profit-share ratio
     is NEVER assumed — until the owner sets it, the split reads "not set"
     rather than a made-up 50/50 that could be quoted at a settlement. */
  let part = { mine: null, ratio: null };   // ratio = { mine, partner } | null
  try { const p = JSON.parse(localStorage.getItem(LS_PART) || 'null'); if (p) part = Object.assign(part, p); } catch (_) {}
  if (!part.mine || !COS.some(c => c.id === part.mine)) {
    const guess = COS.find(c => /deshwali/i.test(c.short));   // owner's own firm
    part.mine = guess ? guess.id : (COS[0] ? COS[0].id : null);
  }
  const savePart = () => { try { localStorage.setItem(LS_PART, JSON.stringify(part)); } catch (_) {} };
  const roleOf = id => (id === part.mine ? 'My firm' : 'Partner firm');
  const isMine = id => id === part.mine;

  function currentRange() {
    if (state.preset === 'custom') return { from: state.from || null, to: state.to || null };
    const p = G.presets().find(p => p.key === state.preset) || G.presets().find(p => p.key === 'fy');
    return { from: p.from, to: p.to };
  }

  /* ── view model: summaries with provenance, missing blobs reported ── */
  function build() {
    const range = currentRange();
    const wanted = state.co === 'all' ? COS : COS.filter(c => c.id === state.co);
    const entries = [], missing = [];
    for (const c of wanted) {
      const blob = readBlob(c.id);
      if (!blob) { missing.push(c); continue; }
      entries.push({ id: c.id, name: c.short, summary: G.summarize(blob, range) });
    }
    return { range, entries, missing, total: G.consolidate(entries) };
  }

  /* ── renderers ── */
  /* Every card shows the firm split UNDER the combined figure, so a
     consolidated number is never readable without seeing who contributed it. */
  function split(vm, fn, fmt) {
    if (vm.entries.length < 2) return '';
    return `<div class="gv-split">${vm.entries.map(e =>
      `<span><i class="gv-dot ${isMine(e.id) ? 'mine' : 'partner'}"></i>${esc(e.name)} <b>${fmt(fn(e.summary))}</b></span>`).join('')}</div>`;
  }
  function kpis(vm) {
    const t = vm.total;
    const stockNote = t.stockComputable.fg ? fT(t.stockClosing.fg) : '—';
    const margin = round2(t.sales.taxable - t.production.cost);
    return `<div class="gv-kpis">
      <div class="gv-kpi"><div class="l">Production</div><div class="v">${fT(t.production.output)}</div><div class="s">${t.production.runs} runs · QL ${fT(t.production.produced.quicklime)} + HL ${fT(t.production.produced.hydrated)}</div>${split(vm, s => s.production.output, fT)}</div>
      <div class="gv-kpi"><div class="l">Sales</div><div class="v">${fC(t.sales.taxable)}</div><div class="s">${fT(t.sales.qty)} · ${t.sales.count} invoices · excl. GST</div>${split(vm, s => s.sales.taxable, fC)}</div>
      <div class="gv-kpi"><div class="l">Purchases</div><div class="v">${fC(t.purchase.value)}</div><div class="s">${fT(t.purchase.tonnes)} material · excl. GST</div>${split(vm, s => s.purchase.value, fC)}</div>
      <div class="gv-kpi"><div class="l">Production cost</div><div class="v">${fC(t.production.cost)}</div><div class="s">materials at avg rates + labour</div>${split(vm, s => s.production.cost, fC)}</div>
      <div class="gv-kpi"><div class="l">Sales − production cost</div><div class="v">${fC(margin)}</div><div class="s">production margin · not P&amp;L</div>${split(vm, s => round2(s.sales.taxable - s.production.cost), fC)}</div>
      <div class="gv-kpi"><div class="l">Finished-goods stock</div><div class="v">${stockNote}</div><div class="s">${
        t.stockComputable.fg ? 'made − dispatched, as at period end'
          : (vm.entries.some(e => (e.summary.stock.find(s => s.key === 'fg') || {}).noProduction)
              ? 'no production recorded — record runs to get a stock figure'
              : 'not computable — bills missing quantities')}</div></div>
    </div>`;
  }
  const round2 = n => Math.round(n * 100) / 100;

  function comparison(vm) {
    if (vm.entries.length < 2) return '';
    const cols = vm.entries;
    const row = (label, fn, fmt) => `<tr><td>${label}</td>${cols.map(e => `<td>${fmt(fn(e.summary))}</td>`).join('')}<td><b>${fmt(cols.reduce((a, e) => a + fn(e.summary), 0))}</b></td></tr>`;
    const stockRow = (label, key) => `<tr><td>${label}</td>${cols.map(e => {
      const st = e.summary.stock.find(s => s.key === key);
      return `<td>${st && st.computable ? fT(st.closing) : '—'}</td>`;
    }).join('')}<td><b>${vm.total.stockComputable[key === 'fg' ? 'fg' : key] ? fT(vm.total.stockClosing[key === 'fg' ? 'fg' : key]) : '—'}</b></td></tr>`;
    return `<div class="gv-h">Company comparison</div><div class="gv-wrap"><table class="gv-tbl">
      <thead><tr><th>Metric</th>${cols.map(e => `<th>${esc(e.name)}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      <tr class="sec"><td colspan="${cols.length + 2}">Purchases</td></tr>
      ${row('Purchase value (excl. GST)', s => s.purchase.value, fC)}
      ${row('Material tonnes (limestone + petcoke)', s => s.purchase.tonnes, fT)}
      <tr class="sec"><td colspan="${cols.length + 2}">Production</td></tr>
      ${row('Output (QL + HL)', s => s.production.output, fT)}
      ${row('Raw limestone consumed', s => s.production.consumed.limestone, fT)}
      ${row('Production cost', s => s.production.cost, fC)}
      <tr class="sec"><td colspan="${cols.length + 2}">Sales</td></tr>
      ${row('Sales value (excl. GST)', s => s.sales.taxable, fC)}
      ${row('Sales tonnes', s => s.sales.qty, fT)}
      ${row('Chunna sales value', s => s.chunna.value, fC)}
      <tr class="sec"><td colspan="${cols.length + 2}">Stock (as at period end)</td></tr>
      ${stockRow('Limestone closing', 'limestone')}
      ${stockRow('Petcoke closing', 'petcoke')}
      ${stockRow('Finished goods closing', 'fg')}
    </tbody></table></div>`;
  }

  function productTable(vm) {
    const cols = vm.entries;
    const cell = fn => cols.map(e => `<td>${fn(e.summary)}</td>`).join('');
    const tot = fn => cols.reduce((a, e) => a + fn(e.summary), 0);
    return `<div class="gv-h">Product-wise (production &amp; dispatch)</div><div class="gv-wrap"><table class="gv-tbl">
      <thead><tr><th>Product</th>${cols.map(e => `<th>${esc(e.name)}</th>`).join('')}${cols.length > 1 ? '<th>Total</th>' : ''}</tr></thead><tbody>
      <tr><td>Quick Lime produced</td>${cell(s => fT(s.production.produced.quicklime))}${cols.length > 1 ? `<td><b>${fT(tot(s => s.production.produced.quicklime))}</b></td>` : ''}</tr>
      <tr><td>Hydrated Lime produced</td>${cell(s => fT(s.production.produced.hydrated))}${cols.length > 1 ? `<td><b>${fT(tot(s => s.production.produced.hydrated))}</b></td>` : ''}</tr>
      <tr><td>Lime dispatched (invoiced)</td>${cell(s => fT(s.sales.qty))}${cols.length > 1 ? `<td><b>${fT(tot(s => s.sales.qty))}</b></td>` : ''}</tr>
      <tr><td>Chunna sold</td>${cell(s => fT(s.chunna.qty))}${cols.length > 1 ? `<td><b>${fT(tot(s => s.chunna.qty))}</b></td>` : ''}</tr>
    </tbody></table></div>
    ${cols.map(e => materialBreakdown(e)).join('')}`;
  }

  function materialBreakdown(e) {
    const bg = e.summary.purchase.byGroup;
    const rows = Object.values(bg).filter(g => g.count > 0);
    if (!rows.length) return '';
    return `<details class="gv-exp"><summary>${esc(e.name)} — purchases by material (${e.summary.purchase.count} bills) ▾</summary>
      <div class="gv-wrap"><table class="gv-tbl"><thead><tr><th>Material group</th><th>Bills</th><th>Qty</th><th>Value (excl. GST)</th><th>Avg rate</th></tr></thead><tbody>
      ${rows.map(g => `<tr><td>${esc(g.label)}</td><td>${g.count}</td><td>${g.qty ? g.qty.toLocaleString('en-IN') : '—'}${g.missingQty ? ` <span style="color:var(--ql-warning-700)">(+${g.missingQty} bills w/o qty)</span>` : ''}</td><td>${fC(g.value)}</td><td>${g.qty ? fC(g.value / g.qty) : '—'}</td></tr>`).join('')}
      <tr class="tot"><td>Total</td><td>${e.summary.purchase.count}</td><td></td><td>${fC(e.summary.purchase.value)}</td><td></td></tr>
    </tbody></table></div></details>`;
  }

  /* ── the two kilns: physical assets, shown as assets ── */
  function kilnTable(vm) {
    const kilns = Object.values(vm.total.production.byKiln)
      .sort((a, b) => (a.kiln === G.UNASSIGNED ? 1 : b.kiln === G.UNASSIGNED ? -1 : b.output - a.output));
    if (!kilns.length) return `<div class="gv-h">Kilns</div><div class="gv-empty">No production runs in this period. Record a run on the Production page — it now asks which kiln burnt it, so output can be attributed to the right plant.</div>`;
    const unassigned = kilns.find(k => k.kiln === G.UNASSIGNED);
    const multi = vm.entries.length > 1;
    const firmCols = multi ? vm.entries : [];
    const kOf = (k, e) => (k.byFirm && k.byFirm[e.name]) ? k.byFirm[e.name].output : 0;
    return `<div class="gv-h">Kiln-wise production — physical plant output</div>
    ${multi ? `<div class="gv-note" style="margin-bottom:10px">Each kiln row shows what <b>each firm booked</b> and the <b>physical kiln total</b>. The kiln total is the <b>sum</b> of the firm columns — the same furnace recorded in two sets of books is one kiln, counted once.</div>` : ''}
    <div class="gv-wrap"><table class="gv-tbl">
      <thead><tr><th>Kiln</th>${firmCols.map(e => `<th>${esc(e.name)}</th>`).join('')}<th>${multi ? 'Kiln total (physical)' : 'Output'}</th><th>Runs</th><th>Quick Lime</th><th>Hydrated</th><th>Limestone used</th><th>Yield</th><th>Cost / tonne</th></tr></thead><tbody>
      ${kilns.map(k => `<tr${k.kiln === G.UNASSIGNED ? ' style="opacity:.75"' : ''}>
        <td><b>${esc(k.kiln)}</b></td>
        ${firmCols.map(e => `<td>${kOf(k, e) ? fT(kOf(k, e)) : '—'}</td>`).join('')}
        <td><b>${fT(k.output)}</b></td>
        <td>${k.runs}</td><td>${fT(k.quicklime)}</td><td>${fT(k.hydrated)}</td><td>${fT(k.limestone)}</td>
        <td>${k.yield ? k.yield.toFixed(0) + '%' : '—'}</td><td>${k.costPerTon ? fC(k.costPerTon) : '—'}</td></tr>`).join('')}
      <tr class="tot"><td>All kilns</td>
        ${firmCols.map(e => `<td>${fT(e.summary.production.output)}</td>`).join('')}
        <td>${fT(vm.total.production.output)}</td><td>${vm.total.production.runs}</td>
        <td>${fT(vm.total.production.produced.quicklime)}</td><td>${fT(vm.total.production.produced.hydrated)}</td>
        <td>${fT(vm.total.production.consumed.limestone)}</td><td></td><td></td></tr>
    </tbody></table></div>
    ${unassigned ? `<div class="gv-empty" style="margin-top:10px">⚠ <b>${fT(unassigned.output)}</b> of output across ${unassigned.runs} run(s) has no kiln recorded — these ran before kilns were tracked, or the field was left blank. Open the run on the Production page and set its kiln to attribute it.</div>` : ''}`;
  }

  /* ── partnership share: real totals × a ratio the owner sets ── */
  function shareCard(vm) {
    if (vm.entries.length < 2) return '';
    const mineCo = COS.find(c => c.id === part.mine), otherCo = COS.find(c => c.id !== part.mine);
    const sp = G.partnerSplit(vm.total, part.ratio);
    const head = `<div class="gv-h">Partnership share</div>`;
    if (!sp) {
      const r = part.ratio, sum = r ? (Number(r.mine) || 0) + (Number(r.partner) || 0) : null;
      const bad = r && Math.abs(sum - 100) > 1e-9;
      return head + `<div class="gv-empty">
      <b>Profit-sharing ratio ${bad ? 'invalid' : 'not set'}.</b> ${bad
        ? `The two shares total <b>${round2(sum)}%</b> — they must add up to exactly <b>100%</b>. Nothing is allocated until they do.`
        : `Enter how the partnership result is shared between <b>${esc(mineCo ? mineCo.short : 'your firm')}</b> and <b>${esc(otherCo ? otherCo.short : 'the partner firm')}</b> and this section will split the figures. Nothing is assumed — a made-up 50/50 has no place next to money.`}
      <div style="margin-top:10px">${ratioInputs()}</div>
      ${bad ? '<div class="gv-bad">Shares must total 100%.</div>' : ''}</div>`;
    }
    const row = (label, k, fmt) => `<tr><td>${label}</td><td>${fmt(sp.mine[k])}</td><td>${fmt(sp.partner[k])}</td><td><b>${fmt(sp.mine[k] + sp.partner[k])}</b></td></tr>`;
    return head + `<div class="gv-wrap"><table class="gv-tbl">
      <thead><tr><th>Figure</th><th>${esc(mineCo ? mineCo.short : 'My firm')} (${sp.mine.pct}%)</th><th>${esc(otherCo ? otherCo.short : 'Partner')} (${sp.partner.pct}%)</th><th>Partnership total</th></tr></thead><tbody>
      ${row('Sales value (excl. GST)', 'sales', fC)}
      ${row('Purchases (excl. GST)', 'purchase', fC)}
      ${row('Production cost', 'prodCost', fC)}
      ${row('Output', 'output', fT)}
      <tr class="tot"><td>Production margin (sales − production cost)</td><td>${fC(sp.mine.margin)}</td><td>${fC(sp.partner.margin)}</td><td>${fC(sp.margin)}</td></tr>
    </tbody></table></div>
    <div class="gv-note" style="margin-top:10px">Production margin here is <b>sales − production cost</b> (materials at average purchase rate + labour). It carries no overheads, interest, depreciation or drawings, so it is <b>not the P&amp;L</b> and not a settlement statement — it is the operating picture, split at the ratio you set. ${ratioInputs()}</div>`;
  }
  function ratioInputs() {
    const r = part.ratio || { mine: '', partner: '' };
    return `<span style="display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap">
      <label style="font-size:var(--ql-text-sm)">My share
        <input id="gvRm" class="gv-date" style="width:74px" type="number" min="0" step="1" value="${esc(r.mine)}" placeholder="—"></label>
      <label style="font-size:var(--ql-text-sm)">Partner share
        <input id="gvRp" class="gv-date" style="width:74px" type="number" min="0" step="1" value="${esc(r.partner)}" placeholder="—"></label>
      <button class="gv-co" id="gvRsave" style="background:var(--ql-brand-600);color:#fff;height:34px">Save ratio</button></span>`;
  }

  /* ── DETAIL TABLES (§3/§4/§5): the transactions behind the totals ──
     Built from GroupCore.detailRows so they use the same filters, liveness
     rule and money maths as the cards — a table can't disagree with its KPI. */
  function allDetails(vm) {
    const out = { production: [], sales: [], purchases: [] };
    for (const e of vm.entries) {
      const blob = readBlob(e.id); if (!blob) continue;
      const d = G.detailRows(blob, vm.range, { id: e.id, name: e.name });
      out.production.push(...d.production); out.sales.push(...d.sales); out.purchases.push(...d.purchases);
    }
    const byDate = (a, b) => (b.date || '').localeCompare(a.date || '');
    out.production.sort(byDate); out.sales.sort(byDate); out.purchases.sort(byDate);
    return out;
  }
  const CAP = 200;   // render cap: the export carries every row, the DOM doesn't
  function capNote(n, what) {
    return n > CAP ? `<div class="gv-empty" style="margin-top:8px">Showing the first ${CAP} of <b>${n}</b> ${what} — use Export CSV for the complete filtered list.</div>` : '';
  }
  const badge = r => `<span class="gv-badge ${isMine(r.companyId) ? 'mine' : 'partner'}">${esc(r.company)}</span>`;
  const multiCo = vm => vm.entries.length > 1;

  function detailTables(vm, det) {
    const mc = multiCo(vm);
    const prod = `<div class="gv-h">Production runs${det.production.length ? ` <span style="font-weight:500;color:var(--ql-text-muted);font-size:var(--ql-text-sm)">${det.production.length} run(s)</span>` : ''}</div>
      ${det.production.length ? `<div class="gv-wrap"><table class="gv-tbl">
      <thead><tr><th>Date</th><th>Run ID</th>${mc ? '<th>Company</th>' : ''}<th>Kiln</th><th>Quick Lime</th><th>Hydrated</th><th>Output</th><th>Production cost</th><th>Cost / tonne</th><th>Status</th></tr></thead><tbody>
      ${det.production.slice(0, CAP).map(r => `<tr><td>${esc(r.date)}</td><td style="font-size:var(--ql-text-sm)">${esc(r.id || '—')}</td>${mc ? `<td style="text-align:left">${badge(r)}</td>` : ''}<td style="text-align:left">${esc(r.kiln)}</td><td>${fT(r.quicklime)}</td><td>${fT(r.hydrated)}</td><td><b>${fT(r.output)}</b></td><td>${fC(r.cost)}</td><td>${r.costPerTon ? fC(r.costPerTon) : '—'}</td><td style="text-align:left">${esc(r.status)}</td></tr>`).join('')}
      </tbody></table></div>${capNote(det.production.length, 'runs')}` : '<div class="gv-empty">No production runs in this period.</div>'}`;

    const sales = `<div class="gv-h">Sales${det.sales.length ? ` <span style="font-weight:500;color:var(--ql-text-muted);font-size:var(--ql-text-sm)">${det.sales.length} invoice(s)</span>` : ''}</div>
      ${det.sales.length ? `<div class="gv-wrap"><table class="gv-tbl">
      <thead><tr><th>Date</th><th>Invoice</th>${mc ? '<th>Company</th>' : ''}<th>Customer</th><th>Qty</th><th>Rate</th><th>Amount (excl GST)</th><th>Total (incl GST)</th><th>Status</th></tr></thead><tbody>
      ${det.sales.slice(0, CAP).map(r => `<tr><td>${esc(r.date)}</td><td style="text-align:left">${esc(r.inv || '—')}</td>${mc ? `<td style="text-align:left">${badge(r)}</td>` : ''}<td style="text-align:left">${esc(r.party)}</td><td>${r.qty ? fT(r.qty) : '—'}</td><td>${r.rate ? fC(r.rate) : '—'}</td><td>${fC(r.taxable)}</td><td>${fC(r.total)}</td><td style="text-align:left">${esc(r.status)}</td></tr>`).join('')}
      </tbody></table></div>${capNote(det.sales.length, 'invoices')}` : '<div class="gv-empty">No sales invoices in this period.</div>'}`;

    const purch = `<div class="gv-h">Purchases${det.purchases.length ? ` <span style="font-weight:500;color:var(--ql-text-muted);font-size:var(--ql-text-sm)">${det.purchases.length} bill(s)</span>` : ''}</div>
      ${det.purchases.length ? `<div class="gv-wrap"><table class="gv-tbl">
      <thead><tr><th>Date</th><th>Bill</th>${mc ? '<th>Company</th>' : ''}<th>Supplier</th><th>Material</th><th>Qty</th><th>Rate</th><th>Amount (excl GST)</th><th>Status</th></tr></thead><tbody>
      ${det.purchases.slice(0, CAP).map(r => `<tr><td>${esc(r.date)}</td><td style="text-align:left">${esc(r.bill || '—')}</td>${mc ? `<td style="text-align:left">${badge(r)}</td>` : ''}<td style="text-align:left">${esc(r.sup)}</td><td style="text-align:left">${esc(r.material)}${r.addon ? ' <span style="color:var(--ql-text-muted)">(freight)</span>' : ''}</td><td>${r.qty ? r.qty.toLocaleString('en-IN') : '—'}</td><td>${r.rate ? fC(r.rate) : '—'}</td><td>${fC(r.value)}</td><td style="text-align:left">${esc(r.status)}</td></tr>`).join('')}
      </tbody></table></div>${capNote(det.purchases.length, 'bills')}` : '<div class="gv-empty">No purchase bills in this period.</div>'}`;

    return prod + sales + purch;
  }

  /* ── EXPORT (§13): every row that passed the CURRENT filters ── */
  const csvCell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csvRows = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  function exportCSV(vm, det) {
    const r = vm.range, scope = state.co === 'all' ? 'Partnership (' + vm.entries.map(e => e.name).join(' + ') + ')' : (COS.find(c => c.id === state.co) || {}).short || '';
    const L = [];
    L.push(['QuickLimes — Group / Partnership report']);
    L.push(['Scope', scope]);
    L.push(['Period', (r.from || 'start of books') + ' to ' + (r.to || 'today')]);
    L.push(['Generated', new Date().toLocaleString('en-IN')]);
    L.push([]);
    L.push(['CONSOLIDATED TOTALS']);
    L.push(['Figure', ...vm.entries.map(e => e.name), 'Total']);
    const line = (label, fn) => L.push([label, ...vm.entries.map(e => fn(e.summary)), vm.entries.reduce((a, e) => a + fn(e.summary), 0)]);
    line('Production output (T)', s => s.production.output);
    line('Quick lime (T)', s => s.production.produced.quicklime);
    line('Hydrated lime (T)', s => s.production.produced.hydrated);
    line('Production cost (INR)', s => s.production.cost);
    line('Sales value excl GST (INR)', s => s.sales.taxable);
    line('Sales qty (T)', s => s.sales.qty);
    line('Purchases excl GST (INR)', s => s.purchase.value);
    line('Sales - production cost (INR)', s => round2(s.sales.taxable - s.production.cost));
    L.push([]);
    L.push(['KILN-WISE PHYSICAL OUTPUT']);
    L.push(['Kiln', ...vm.entries.map(e => e.name), 'Kiln total (physical)', 'Runs', 'Cost/tonne']);
    Object.values(vm.total.production.byKiln).forEach(k => L.push([k.kiln,
      ...vm.entries.map(e => (k.byFirm && k.byFirm[e.name] ? k.byFirm[e.name].output : 0)), k.output, k.runs, k.costPerTon]));
    const sp = G.partnerSplit(vm.total, part.ratio);
    L.push([]);
    L.push(['PROFIT SHARE']);
    if (!sp) L.push(['Ratio', 'NOT SET — no allocation calculated']);
    else {
      const mineCo = COS.find(c => c.id === part.mine), otherCo = COS.find(c => c.id !== part.mine);
      L.push(['Production margin (sales - production cost)', sp.margin]);
      L.push([(mineCo || {}).short || 'My firm', sp.mine.pct + '%', sp.mine.margin]);
      L.push([(otherCo || {}).short || 'Partner firm', sp.partner.pct + '%', sp.partner.margin]);
    }
    L.push([]); L.push(['PRODUCTION RUNS']);
    L.push(['Date', 'Run ID', 'Company', 'Kiln', 'Quick lime (T)', 'Hydrated (T)', 'Output (T)', 'Limestone (T)', 'Petcoke (T)', 'Bags', 'Labour (INR)', 'Production cost (INR)', 'Cost/tonne (INR)', 'Status']);
    det.production.forEach(r => L.push([r.date, r.id, r.company, r.kiln, r.quicklime, r.hydrated, r.output, r.limestone, r.petcoke, r.bags, r.labour, r.cost, r.costPerTon, r.status]));
    L.push([]); L.push(['SALES']);
    L.push(['Date', 'Invoice', 'Company', 'Customer', 'Product', 'Qty', 'Unit', 'Rate', 'Amount excl GST', 'GST %', 'Total incl GST', 'Status']);
    det.sales.forEach(r => L.push([r.date, r.inv, r.company, r.party, r.product, r.qty, r.unit, r.rate, r.taxable, r.gstR, r.total, r.status]));
    L.push([]); L.push(['PURCHASES']);
    L.push(['Date', 'Bill', 'Company', 'Supplier', 'Material', 'Category', 'Qty', 'Rate', 'Amount excl GST', 'Status']);
    det.purchases.forEach(r => L.push([r.date, r.bill, r.company, r.sup, r.material, r.cat, r.qty, r.rate, r.value, r.status]));

    /* BOM so Excel opens rupee symbols and Devanagari correctly */
    const blob = new Blob(['﻿' + csvRows(L)], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'quicklimes-group-' + (state.co === 'all' ? 'partnership' : state.co.slice(0, 6)) + '-' + (r.from || 'start') + '_to_' + (r.to || 'today') + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function ledgers(vm) {
    const card = e => {
      const led = e.summary.stock.filter(s => !s.empty);
      if (!led.length) return `<div class="gv-led"><h4>${esc(e.name)}</h4><div class="gv-empty">No stock movements in this company's books yet.</div></div>`;
      return `<div class="gv-led"><h4>${esc(e.name)} — stock ledger</h4>
        ${led.map(s => `<table aria-label="${esc(s.label)}">
          <tr><td colspan="2" style="font-weight:700;padding-top:8px">${esc(s.label)}</td></tr>
          <tr><td>Opening</td><td>${s.openingComputable ? fT(s.opening) : '—'}</td></tr>
          <tr><td>+ ${s.key === 'fg' ? 'Produced' : 'Purchased'} (cumulative)</td><td>${fT(s.inward)}</td></tr>
          <tr><td>− ${s.key === 'fg' ? 'Dispatched' : 'Consumed'} (cumulative)</td><td>${fT(s.used)}</td></tr>
          <tr class="cl"><td>Closing (as at period end)</td><td>${s.computable ? fT(s.closing) : '—'}</td></tr>
        </table>${s.noProduction ? `<div class="warn">⚠ No production runs recorded — lime has been dispatched but nothing was booked as produced, so closing stock cannot be derived. Record runs on the Production page.</div>`
          : s.missing ? `<div class="warn">⚠ ${s.missing} bill(s) missing quantities — closing withheld rather than guessed.</div>`
          : s.negative ? `<div class="warn">⚠ Dispatched more than recorded as produced — some runs or opening stock are missing.</div>` : ''}`).join('')}
      </div>`;
    };
    return `<div class="gv-h">Stock ledger — opening + in − out = closing</div><div class="gv-cards">${vm.entries.map(card).join('')}</div>`;
  }

  function trend(t) {
    const keys = Object.keys(t.months).sort();
    if (keys.length < 2) return '';
    const max = Math.max(...keys.map(k => t.months[k].salesV), 1);
    const maxP = Math.max(...keys.map(k => t.months[k].prodT), 1);
    return `<div class="gv-h">Monthly trend — sales value (blue) &amp; production tonnes (green)</div>
      <div class="gv-led"><div class="gv-bars">${keys.map(k => {
        const m = t.months[k];
        return `<div class="b" title="${k}: sales ${fC(m.salesV)} · production ${fT(m.prodT)}">
          <i style="height:${Math.max(3, m.salesV / max * 70)}px"></i>
          <i style="height:${Math.max(2, m.prodT / maxP * 30)}px;background:var(--ql-success-500,#22C55E)"></i>
          <div class="m">${k.slice(2)}</div></div>`;
      }).join('')}</div></div>`;
  }

  function render() {
    const vm = build();
    const det = vm.entries.length ? allDetails(vm) : { production: [], sales: [], purchases: [] };
    const presets = G.presets();
    const consolidated = state.co === 'all' && vm.entries.length > 1;
    const rangeLabel = state.preset === 'custom'
      ? `${state.from || '…'} → ${state.to || '…'}`
      : (presets.find(p => p.key === state.preset) || {}).label || '';
    $('gvRoot').innerHTML = `
      <div class="gv-bar">
        <div class="gv-cos" role="tablist" aria-label="Firm">
          <button class="gv-co all ${state.co === 'all' ? 'on' : ''}" data-co="all">${COS.length > 1 ? 'Partnership (both firms)' : 'All Companies'}</button>
          ${COS.map(c => `<button class="gv-co ${state.co === c.id ? 'on' : ''}" data-co="${esc(c.id)}" title="${esc(roleOf(c.id))}">${esc(c.short)}${COS.length > 1 ? ` <span style="opacity:.6;font-weight:500">· ${isMine(c.id) ? 'mine' : 'partner'}</span>` : ''}</button>`).join('')}
        </div>
        <select class="gv-sel" id="gvPreset" aria-label="Date range">
          ${presets.map(p => `<option value="${p.key}" ${p.key === state.preset ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
        ${state.preset === 'custom' ? `<input type="date" class="gv-date" id="gvFrom" value="${esc(state.from || '')}">
        <input type="date" class="gv-date" id="gvTo" value="${esc(state.to || '')}">` : ''}
        <span style="flex:1"></span>
        <button class="gv-sel" id="gvCsv" title="Every row that passed the current filters">⬇ Export CSV</button>
        <button class="gv-sel" id="gvPrint" title="Print / save as PDF">🖨 Print · PDF</button>
      </div>
      ${consolidated ? `<div class="gv-note">🤝 <b>Partnership view</b> — ${vm.entries.map(e => `<b>${esc(e.name)}</b> (${esc(roleOf(e.id).toLowerCase())})`).join(' + ')}, consolidated for <b>${esc(rangeLabel)}</b>. Each firm keeps its own books and GSTIN; every figure below keeps its firm breakdown and nothing is mixed at the row level.</div>` : ''}
      ${!consolidated && state.co !== 'all' && COS.length > 1 ? `<div class="gv-note">Showing <b>${esc((COS.find(c => c.id === state.co) || {}).short || '')}</b> only — ${esc(roleOf(state.co).toLowerCase())}. The other firm's books are not read into this view.</div>` : ''}
      ${vm.missing.map(c => `<div class="gv-empty">⚠ <b>${esc(c.short)}</b> has not been opened on this device yet, so its books aren't synced here. Switch to it once from the company menu and come back — it will be included automatically.</div>`).join('')}
      ${vm.entries.length ? kpis(vm) : '<div class="gv-empty">No company books available yet.</div>'}
      ${comparison(vm)}
      ${vm.entries.length ? kilnTable(vm) : ''}
      ${shareCard(vm)}
      ${vm.entries.length ? productTable(vm) : ''}
      ${vm.entries.length ? ledgers(vm) : ''}
      ${trend(vm.total)}
      ${vm.entries.length ? detailTables(vm, det) : ''}`;

    document.querySelectorAll('.gv-co').forEach(b => b.onclick = () => {
      state.co = b.dataset.co; localStorage.setItem(LS_CO, state.co); render();
    });
    const ps = $('gvPreset'); if (ps) ps.onchange = () => { state.preset = ps.value; persist(); render(); };
    const f = $('gvFrom'), t2 = $('gvTo');
    if (f) f.onchange = () => { state.from = f.value || null; persist(); render(); };
    if (t2) t2.onchange = () => { state.to = t2.value || null; persist(); render(); };
    const cs = $('gvCsv'); if (cs) cs.onclick = () => exportCSV(vm, det);
    const pr = $('gvPrint'); if (pr) pr.onclick = () => window.print();
    const rs = $('gvRsave');
    if (rs) rs.onclick = () => {
      const m = parseFloat(($('gvRm') || {}).value), p = parseFloat(($('gvRp') || {}).value);
      /* Keep what was typed even when it is wrong, so the page can say WHY it
         was rejected (must total 100%) instead of silently clearing the boxes. */
      part.ratio = (isFinite(m) && isFinite(p)) ? { mine: m, partner: p } : null;
      savePart(); render();
    };
  }
  function persist() { try { localStorage.setItem(LS_RANGE, JSON.stringify({ preset: state.preset, from: state.from, to: state.to })); } catch (_) {} }

  render();
})();
