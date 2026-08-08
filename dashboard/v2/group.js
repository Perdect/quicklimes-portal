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
  const LS_CO = 'ql_group_co', LS_RANGE = 'ql_group_range';
  let COS = companies();
  let state = { co: 'all', preset: 'fy', from: null, to: null };
  try { const s = JSON.parse(localStorage.getItem(LS_RANGE) || 'null'); if (s && s.preset) state = Object.assign(state, s); } catch (_) {}
  const savedCo = localStorage.getItem(LS_CO);
  if (savedCo && (savedCo === 'all' || COS.some(c => c.id === savedCo))) state.co = savedCo;

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
        <div class="gv-cos" role="tablist" aria-label="Company">
          <button class="gv-co all ${state.co === 'all' ? 'on' : ''}" data-co="all">All Companies</button>
          ${COS.map(c => `<button class="gv-co ${state.co === c.id ? 'on' : ''}" data-co="${esc(c.id)}">${esc(c.short)}</button>`).join('')}
        </div>
        <select class="gv-sel" id="gvPreset" aria-label="Date range">
          ${presets.map(p => `<option value="${p.key}" ${p.key === state.preset ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
        ${state.preset === 'custom' ? `<input type="date" class="gv-date" id="gvFrom" value="${esc(state.from || '')}">
        <input type="date" class="gv-date" id="gvTo" value="${esc(state.to || '')}">` : ''}
      </div>
      ${consolidated ? `<div class="gv-note">📊 <b>Consolidated view</b> — totals combine ${vm.entries.map(e => esc(e.name)).join(' + ')} for <b>${esc(rangeLabel)}</b>. Every figure below keeps its company breakdown; nothing is mixed at the row level.</div>` : ''}
      ${vm.missing.map(c => `<div class="gv-empty">⚠ <b>${esc(c.short)}</b> has not been opened on this device yet, so its books aren't synced here. Switch to it once from the company menu and come back — it will be included automatically.</div>`).join('')}
      ${vm.entries.length ? kpis(vm.total, consolidated) : '<div class="gv-empty">No company books available yet.</div>'}
      ${comparison(vm)}
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
  }
  function persist() { try { localStorage.setItem(LS_RANGE, JSON.stringify({ preset: state.preset, from: state.from, to: state.to })); } catch (_) {} }

  render();
})();
