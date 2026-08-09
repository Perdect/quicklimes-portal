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
  function kpis(t, consolidated) {
    const stockNote = t.stockComputable.fg ? fT(t.stockClosing.fg) : '—';
    return `<div class="gv-kpis">
      <div class="gv-kpi"><div class="l">Purchases</div><div class="v">${fC(t.purchase.value)}</div><div class="s">${fT(t.purchase.tonnes)} material · excl. GST</div></div>
      <div class="gv-kpi"><div class="l">Production</div><div class="v">${fT(t.production.output)}</div><div class="s">${t.production.runs} runs · QL ${fT(t.production.produced.quicklime)} + HL ${fT(t.production.produced.hydrated)}</div></div>
      <div class="gv-kpi"><div class="l">Sales</div><div class="v">${fC(t.sales.taxable)}</div><div class="s">${fT(t.sales.qty)} · ${t.sales.count} invoices · excl. GST</div></div>
      <div class="gv-kpi"><div class="l">Production cost</div><div class="v">${fC(t.production.cost)}</div><div class="s">materials at avg rates + labour</div></div>
      <div class="gv-kpi"><div class="l">Finished-goods stock</div><div class="v">${stockNote}</div><div class="s">${t.stockComputable.fg ? 'made − dispatched, as at period end' : 'not computable — bills missing quantities'}</div></div>
    </div>`;
  }

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
    return `<div class="gv-h">Kiln-wise production — the partnership's plants</div><div class="gv-wrap"><table class="gv-tbl">
      <thead><tr><th>Kiln</th><th>Runs</th><th>Quick Lime</th><th>Hydrated</th><th>Output</th><th>Limestone used</th><th>Yield</th><th>Cost / tonne</th>${vm.entries.length > 1 ? '<th>Booked by</th>' : ''}</tr></thead><tbody>
      ${kilns.map(k => `<tr${k.kiln === G.UNASSIGNED ? ' style="opacity:.75"' : ''}>
        <td><b>${esc(k.kiln)}</b></td><td>${k.runs}</td><td>${fT(k.quicklime)}</td><td>${fT(k.hydrated)}</td>
        <td><b>${fT(k.output)}</b></td><td>${fT(k.limestone)}</td><td>${k.yield ? k.yield.toFixed(0) + '%' : '—'}</td>
        <td>${k.costPerTon ? fC(k.costPerTon) : '—'}</td>
        ${vm.entries.length > 1 ? `<td style="text-align:left;font-size:var(--ql-text-sm)">${esc((k.firms || []).join(' + ')) || '—'}</td>` : ''}</tr>`).join('')}
      <tr class="tot"><td>Total</td><td>${vm.total.production.runs}</td><td>${fT(vm.total.production.produced.quicklime)}</td><td>${fT(vm.total.production.produced.hydrated)}</td><td>${fT(vm.total.production.output)}</td><td>${fT(vm.total.production.consumed.limestone)}</td><td></td><td></td>${vm.entries.length > 1 ? '<td></td>' : ''}</tr>
    </tbody></table></div>
    ${unassigned ? `<div class="gv-empty" style="margin-top:10px">⚠ <b>${fT(unassigned.output)}</b> of output across ${unassigned.runs} run(s) has no kiln recorded — these ran before kilns were tracked, or the field was left blank. Open the run on the Production page and set its kiln to attribute it.</div>` : ''}`;
  }

  /* ── partnership share: real totals × a ratio the owner sets ── */
  function shareCard(vm) {
    if (vm.entries.length < 2) return '';
    const mineCo = COS.find(c => c.id === part.mine), otherCo = COS.find(c => c.id !== part.mine);
    const sp = G.partnerSplit(vm.total, part.ratio);
    const head = `<div class="gv-h">Partnership share</div>`;
    if (!sp) return head + `<div class="gv-empty">
      <b>Profit-sharing ratio not set.</b> Enter how the partnership result is shared between
      <b>${esc(mineCo ? mineCo.short : 'your firm')}</b> and <b>${esc(otherCo ? otherCo.short : 'the partner firm')}</b>
      and this section will split the figures. Nothing is assumed — a made-up 50/50 has no place next to money.
      <div style="margin-top:10px">${ratioInputs()}</div></div>`;
    const row = (label, k, fmt) => `<tr><td>${label}</td><td>${fmt(sp.mine[k])}</td><td>${fmt(sp.partner[k])}</td><td><b>${fmt(sp.mine[k] + sp.partner[k])}</b></td></tr>`;
    return head + `<div class="gv-wrap"><table class="gv-tbl">
      <thead><tr><th>Figure</th><th>${esc(mineCo ? mineCo.short : 'My firm')} (${sp.mine.pct}%)</th><th>${esc(otherCo ? otherCo.short : 'Partner')} (${sp.partner.pct}%)</th><th>Partnership total</th></tr></thead><tbody>
      ${row('Sales value (excl. GST)', 'sales', fC)}
      ${row('Purchases (excl. GST)', 'purchase', fC)}
      ${row('Production cost', 'prodCost', fC)}
      ${row('Output', 'output', fT)}
      <tr class="tot"><td>Indicative gross margin</td><td>${fC(sp.mine.margin)}</td><td>${fC(sp.partner.margin)}</td><td>${fC(sp.margin)}</td></tr>
    </tbody></table></div>
    <div class="gv-note" style="margin-top:10px">Gross margin here is <b>sales − production cost</b> (materials at average purchase rate + labour). It carries no overheads, interest, depreciation or drawings, so it is <b>not the P&amp;L</b> and not a settlement statement — it is the operating picture, split at the ratio you set. ${ratioInputs()}</div>`;
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
        </table>${s.missing ? `<div class="warn">⚠ ${s.missing} bill(s) missing quantities — closing withheld rather than guessed.</div>` : ''}`).join('')}
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
      </div>
      ${consolidated ? `<div class="gv-note">🤝 <b>Partnership view</b> — ${vm.entries.map(e => `<b>${esc(e.name)}</b> (${esc(roleOf(e.id).toLowerCase())})`).join(' + ')}, consolidated for <b>${esc(rangeLabel)}</b>. Each firm keeps its own books and GSTIN; every figure below keeps its firm breakdown and nothing is mixed at the row level.</div>` : ''}
      ${!consolidated && state.co !== 'all' && COS.length > 1 ? `<div class="gv-note">Showing <b>${esc((COS.find(c => c.id === state.co) || {}).short || '')}</b> only — ${esc(roleOf(state.co).toLowerCase())}. The other firm's books are not read into this view.</div>` : ''}
      ${vm.missing.map(c => `<div class="gv-empty">⚠ <b>${esc(c.short)}</b> has not been opened on this device yet, so its books aren't synced here. Switch to it once from the company menu and come back — it will be included automatically.</div>`).join('')}
      ${vm.entries.length ? kpis(vm.total, consolidated) : '<div class="gv-empty">No company books available yet.</div>'}
      ${comparison(vm)}
      ${vm.entries.length ? kilnTable(vm) : ''}
      ${shareCard(vm)}
      ${vm.entries.length ? productTable(vm) : ''}
      ${vm.entries.length ? ledgers(vm) : ''}
      ${trend(vm.total)}`;

    document.querySelectorAll('.gv-co').forEach(b => b.onclick = () => {
      state.co = b.dataset.co; localStorage.setItem(LS_CO, state.co); render();
    });
    const ps = $('gvPreset'); if (ps) ps.onchange = () => { state.preset = ps.value; persist(); render(); };
    const f = $('gvFrom'), t2 = $('gvTo');
    if (f) f.onchange = () => { state.from = f.value || null; persist(); render(); };
    if (t2) t2.onchange = () => { state.to = t2.value || null; persist(); render(); };
    const rs = $('gvRsave');
    if (rs) rs.onclick = () => {
      const m = parseFloat(($('gvRm') || {}).value), p = parseFloat(($('gvRp') || {}).value);
      /* both sides required and positive — a half-entered ratio is not a ratio */
      part.ratio = (isFinite(m) && isFinite(p) && m + p > 0) ? { mine: m, partner: p } : null;
      savePart(); render();
    };
  }
  function persist() { try { localStorage.setItem(LS_RANGE, JSON.stringify({ preset: state.preset, from: state.from, to: state.to })); } catch (_) {} }

  render();
})();
