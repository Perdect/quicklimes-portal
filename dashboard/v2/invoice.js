/* ═══════════════════════════════════════════════════════════════════════
   GST Invoice builder — old-concept split view: enter bill details on the
   LEFT, live invoice preview (real Gotan format) on the RIGHT.
   Renders through the shared invoiceHTML template (QLShell.renderInvoice).
   ═══════════════════════════════════════════════════════════════════════ */
QLShell.mount({ active: 'invoice', title: 'GST Invoice' });
const Q = window.QLD;
const esc = s => (s == null ? '' : s).toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const g = id => (document.getElementById(id) || {}).value || '';
const toast = (m, t) => QLShell.toast && QLShell.toast(m, t);
function todayISO() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function nextInvNo() {
  let max = 0, fy = '';
  Q.salesRows().forEach(r => { const m = (r.inv || '').match(/^(\d+)\s*\/\s*(.+)$/); if (m && +m[1] > max) { max = +m[1]; fy = m[2]; } });
  if (!fy) { const d = new Date(), y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; fy = y + '-' + String((y + 1) % 100).padStart(2, '0'); }
  return (max + 1) + '/' + fy;
}

function buildData() {
  const qty = +g('i_qty') || 0, rate = +g('i_rate') || 0, gstR = +g('i_gst') || 5;
  /* THE line, through units-core: the quantity converted INTO the rate's unit,
     times the rate. 7,650 Kg @ ₹5,300 / Ton = 7.65 × 5,300 = ₹40,545. */
  const unit = g('i_unit') || 'Ton', rateUnit = g('i_rateUnit') || QLUnits.defaultRateUnit(unit);
  const line = QLUnits.lineAmount({ qty, unit, rate, rateUnit });
  const taxable = line.amount, cgst = taxable * gstR / 200, sgst = cgst, total = taxable + cgst + sgst;
  const bgst = g('i_bgst').toUpperCase().replace(/[^A-Z0-9]/g, '');   // registered form, never with spaces
  const interState = bgst && bgst.length >= 2 && bgst.slice(0, 2) !== '08';
  const grand = (Q.co && Q.co.roundOff === false) ? Math.round(total * 100) / 100 : Math.round(total);   // mirrors invoiceData
  const bState = Q.reconcileState(g('i_bstate'), bgst);
  /* Place of supply — the field was never read before (the seller's state printed
     for every buyer). It is the buyer's state unless the form points elsewhere;
     and on an inter-state sale it can never be the seller's own state, or the
     page would print IGST against a place of supply that says CGST/SGST. */
  const posField = g('i_pos'), pos = (!posField || (interState && posField === (Q.co && Q.co.state))) ? bState : posField;
  return {
    seller: Q.co, noBar: true, hsn: g('i_hsn') || '25221000',
    /* The State is a fact read off the GSTIN's first two digits. The box arrives
       pre-filled with the seller's own state, so a typed/stored state that names a
       DIFFERENT code is the pre-fill, not a fact — the GSTIN wins (reconcileState,
       the same rule invoiceData applies to saved sales). A Maharashtra buyer
       (27…) printed as "Rajasthan (08)" on 18-09-2026 because this read the box. */
    buyer: { name: g('i_bname'), gstin: bgst, address: g('i_baddr'), state: bState, phone: g('i_bphone'), email: '' },
    pos,
    inv: g('i_no'), date: g('i_date'), product: g('i_product') || 'Quick Lime',
    qty, rate, unit, rateUnit, billableQty: line.billableQty, billableUnit: line.billableUnit, lineOk: line.ok, lineWhy: line.why, gstR,
    veh: g('i_veh'), eway: g('i_eway'), transport: g('i_trans'), station: g('i_stn'), grrr: g('i_grrr'),
    taxable, cgst, sgst, igst: interState ? cgst + sgst : 0, interState,
    total, roundOff: grand - total, grand,
    words: Q.amountInWords(grand)
  };
}
/* Live preview. Resetting the iframe's srcdoc reloads it, and the reloading
   iframe steals focus from the field being typed in (→ "type one letter and the
   field goes away"). Instead we patch the iframe document IN PLACE
   (documentElement.innerHTML) which does NOT reload it and never steals focus.
   Debounced so we don't rebuild the preview on every keystroke. */
function previewDoc() { const f = document.getElementById('invFrame'); return f ? (f.contentDocument || (f.contentWindow && f.contentWindow.document)) : null; }
function updatePreview() {
  const html = QLShell.renderInvoice(buildData());
  const doc = previewDoc();
  /* Only patch a STANDARDS-MODE document. A src-less iframe starts as an
     about:blank document in quirks mode (compatMode 'BackCompat'), and patching
     it in place never gives it a doctype — so it stays quirky forever, and in
     quirks mode tables ignore the inherited font size and jump to the browser's
     16px. That is why the goods table came out huge in the preview while the
     printed sheet (which loads with its doctype) was right. The first paint
     goes through srcdoc, which carries the doctype; every keystroke after that
     patches in place as before. */
  try {
    if (doc && doc.documentElement && doc.compatMode === 'CSS1Compat') {
      doc.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
      return;
    }
  } catch (_) {}
  const f = document.getElementById('invFrame'); if (f) f.srcdoc = html;   // fallback (first paint)
}
let _prevTimer = null;
function schedulePreview() { clearTimeout(_prevTimer); _prevTimer = setTimeout(updatePreview, 250); }
function showCalc() {
  const el = document.getElementById('i_calc'); if (!el) return;
  const d = buildData();
  if (!d.qty || !d.rate) { el.innerHTML = ''; return; }
  if (!d.lineOk) { el.innerHTML = '<span style="color:var(--ql-danger-600)">' + esc(d.lineWhy) + '</span>'; return; }
  const conv = QLUnits.normalizeUnit(d.unit) !== QLUnits.normalizeUnit(d.rateUnit) ? esc(QLUnits.fmtQty(d.qty, d.unit)) + ' = <b>' + esc(QLUnits.fmtQty(d.billableQty, d.billableUnit)) + '</b> · ' : '';
  el.innerHTML = conv + esc(QLUnits.fmtQty(d.billableQty, d.billableUnit)) + ' × ' + esc(QLUnits.fmtRate(d.rate, d.rateUnit)) + ' = <b>₹' + d.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</b>';
}

function field(id, label, opts) {
  opts = opts || {};
  const cls = 'if-f' + (opts.full ? ' full' : '');
  if (opts.opts) return `<div class="${cls}"><label>${label}</label><select id="${id}">${opts.opts.map(o => `<option value="${esc(o[0])}" ${o[0] === opts.val ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>`;
  return `<div class="${cls}"><label>${label}</label><input id="${id}" type="${opts.type || 'text'}" value="${esc(opts.val || '')}" placeholder="${esc(opts.ph || '')}" ${opts.list ? `list="${opts.list}"` : ''} ${opts.up ? 'style="text-transform:uppercase"' : ''}></div>`;
}
function formHTML() {
  const co = Q.co || {};
  const parties = Q.partyRows().filter(p => p.type !== 'supplier');
  return `<datalist id="i_parties">${parties.map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>
    <div class="if-sec">Invoice details</div>
    <div class="if-grid">
      ${field('i_no', 'Invoice No.', { val: nextInvNo() })}
      ${field('i_date', 'Date', { type: 'date', val: todayISO() })}
      ${field('i_pos', 'Place of Supply', { val: co.state || '' })}
      ${field('i_rc', 'Reverse Charge', { opts: [['N', 'N'], ['Y', 'Y']], val: 'N' })}
    </div>
    <!-- Despatch. The exact-print format ("GST Invoice (print format)") carries
         Transport, Station and GR/RR exactly as the firm's billing software does;
         the Classic design still prints only Vehicle No. and E-Way Bill. Either
         way the sale record stores all five, so nothing typed here is lost. -->
    <div class="if-sec">Despatch</div>
    <div class="if-grid">
      ${field('i_trans', 'Transport', { val: 'Self', ph: 'Self / By Road' })}
      ${field('i_veh', 'Vehicle No.', { up: 1, ph: 'RJ19 GG 5115' })}
      ${field('i_stn', 'Station', { ph: 'Destination' })}
      ${field('i_eway', 'E-Way Bill No.', {})}
      ${field('i_grrr', 'GR/RR No.', {})}
    </div>
    <div class="if-sec">Billed to / Shipped to</div>
    <div class="if-grid">
      ${field('i_bname', 'Customer name', { full: true, up: 1, list: 'i_parties', ph: 'Start typing…' })}
      ${field('i_bgst', 'GSTIN / UIN', { up: 1, ph: '08XXXXX0000X1ZX' })}
      ${field('i_bstate', 'State', { val: co.state || '' })}
      ${field('i_bphone', 'Mobile', { ph: 'Party mobile no.' })}
      ${field('i_baddr', 'Address', { full: true, ph: 'Khasara / village / district' })}
    </div>
    <div class="if-sec">Item</div>
    <div class="if-grid">
      ${field('i_product', 'Description of goods', { full: true, val: 'Quick Lime' })}
      ${field('i_hsn', 'HSN / SAC', { val: '25221000' })}
      ${field('i_qty', 'Quantity', { type: 'number', ph: '0' })}
      ${field('i_unit', 'Quantity unit', { opts: QLUnits.UNITS.map(u => [u.key, u.label]), val: 'Ton' })}
      ${field('i_rate', 'Rate (₹)', { type: 'number', ph: '0' })}
      ${field('i_rateUnit', 'Rate per', { opts: QLUnits.UNITS.map(u => [u.key, u.label]), val: 'Ton' })}
      <div class="if-f full" id="i_calc" style="font-size:12.5px;color:var(--ql-text-muted);margin-top:-4px"></div>
      ${field('i_gst', 'GST %', { opts: [['0', '0%'], ['5', '5%'], ['12', '12%'], ['18', '18%'], ['28', '28%']], val: '5' })}
    </div>`;
}

function save(andPrint) {
  const d = buildData();
  if (!d.buyer.name) { toast('Enter the customer name', 'err'); document.getElementById('i_bname').focus(); return; }
  if (!d.qty || !d.rate) { toast('Enter quantity and rate', 'err'); return; }
  if (!d.lineOk) { toast(d.lineWhy, 'err'); document.getElementById('i_rateUnit').focus(); return; }
  Q.addSale({ inv: d.inv, date: d.date, party: d.buyer.name, gstin: d.buyer.gstin, addr: d.buyer.address, state: d.buyer.state, product: d.product, qty: d.qty, rate: d.rate, rateUnit: d.rateUnit, gstR: d.gstR, veh: d.veh, eway: d.eway, unit: d.unit, hsn: d.hsn, transport: d.transport, station: d.station, grrr: d.grrr, status: 'pending' });
  toast('Invoice ' + (d.inv || '') + ' saved ✓', 'ok');
  if (andPrint) { const w = window.open('', '_blank'); if (w) { w.document.write(QLShell.renderInvoice(Object.assign({}, d, { noBar: true })) + '<scr' + 'ipt>onload=function(){setTimeout(print,300)}</scr' + 'ipt>'); w.document.close(); } }
  setTimeout(() => location.href = 'sales.html', andPrint ? 400 : 700);
}

/* Design picker, right next to the preview it controls.
   Switching it changes what the preview shows AND what Save & Print produces —
   they go through the same QLShell.renderInvoice, so the two can never disagree.
   The choice sticks per company (see shell.js invoiceTemplateKey). Renders
   nothing at all if invoice-templates.js is not loaded, rather than a dead
   control that silently does nothing. */
function designPicker() {
  const T = window.InvoiceTemplates;
  if (!T || !QLShell.invoiceTemplate) return '';
  const cur = QLShell.invoiceTemplate();
  return `<label class="if-tpl">Design
    <select id="invTpl" title="Changes the preview and the printed invoice">
      ${T.TEMPLATES.map(t => `<option value="${t.id}"${t.id === cur ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
    </select></label>`;
}

function onPickDesign(e) {
  if (!QLShell.setInvoiceTemplate(e.target.value)) { toast('Unknown design', 'err'); return; }
  /* srcdoc, not the in-place innerHTML patch used for typing: a different
     template brings a whole new stylesheet, and patching innerHTML leaves the OLD
     <style> in the document — the new markup would render against the old CSS. */
  const f = document.getElementById('invFrame');
  if (f) f.srcdoc = QLShell.renderInvoice(buildData());
  const t = (window.InvoiceTemplates.get(e.target.value) || {}).name || '';
  toast(t + ' — this design is now used for your invoices', 'ok');
}

function render() {
  const main = document.getElementById('ql-main'); if (!main) return;
  const co = Q.co || {};
  main.innerHTML = `<div class="inv-wrap">
    <div class="inv-hero">
      <div><h1>GST Invoice</h1><div class="sub">Create a tax invoice for <b>${esc(co.short || co.name || '')}</b> — details on the left, live preview on the right.</div></div>
      <div class="inv-hero-r">
        ${designPicker()}
        <span class="if-live">Live preview</span>
        <button class="ql-btn ql-btn-secondary" id="invPrint">Save &amp; Print</button>
        <button class="ql-btn ql-btn-primary" id="invSave">Save invoice</button>
      </div>
    </div>
    <div class="inv-build">
      <div class="inv-form">${formHTML()}</div>
      <div class="inv-prev"><iframe id="invFrame" title="invoice preview"></iframe></div>
    </div>
  </div>`;
  // live update on any input
  main.querySelectorAll('.inv-form input, .inv-form select').forEach(el => { el.addEventListener('input', onInput); el.addEventListener('change', onInput); });
  /* The quantity unit decides the rate's default unit (lime is priced per Ton
     whatever the truck was weighed in); the line under the fields shows the
     arithmetic so the owner sees 7,650 Kg → 7.65 Ton × ₹5,300 = ₹40,545 as he types. */
  const unitEl = document.getElementById('i_unit'), ruEl = document.getElementById('i_rateUnit');
  if (unitEl && ruEl) unitEl.addEventListener('change', () => { ruEl.value = QLUnits.defaultRateUnit(unitEl.value); showCalc(); });
  showCalc();
  const tpl = document.getElementById('invTpl'); if (tpl) tpl.addEventListener('change', onPickDesign);
  document.getElementById('invSave').onclick = () => save(false);
  document.getElementById('invPrint').onclick = () => save(true);
  /* Deep link from the Customer 360 "Record Order": ?party=<id> fills the buyer
     from the master record — the sale then resolves back to that customer. */
  const pid = new URLSearchParams(location.search).get('party');
  if (pid) { const p = Q.partyRows().find(x => x.id === pid); if (p) { const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; }; set('i_bname', p.name); set('i_bgst', p.gstin); set('i_baddr', [p.address, p.city].filter(Boolean).join(', ')); setState(Q.reconcileState(p.state, p.gstin) || (p.gstin ? Q.stateOfGstin(p.gstin) : '')); set('i_bphone', p.wa || p.phone); set('i_stn', p.deliveryLoc || ''); } }
  updatePreview();
  QLShell.paintWorkspace && QLShell.paintWorkspace();
}
/* GSTIN → fill. Type the 15 characters: the State from the code, the name /
   address / mobile from a customer we already know, or from the GST lookup when
   a key is configured (QLShell.gstinLookup). Never overwrites what was typed;
   flags a wrong check digit under the field instead of letting it print. */
/* The buyer's State and the Place of supply move together: goods go to the
   buyer's state unless the user has pointed Place of supply somewhere else. */
let _lastBState = '';
function setState(v) {
  if (!v) return;
  const st = document.getElementById('i_bstate'), pos = document.getElementById('i_pos');
  const was = _lastBState || (Q.co && Q.co.state) || '';
  if (st) st.value = v;
  if (pos && (!pos.value || pos.value === was || pos.value === (Q.co && Q.co.state))) pos.value = v;
  _lastBState = v;
}
let _gstinSeq = 0;
async function gstinAssist(val) {
  const el = document.getElementById('i_bgst'); if (!el) return;
  let hint = document.getElementById('i_bgst_hint');
  if (!hint) { hint = document.createElement('div'); hint.id = 'i_bgst_hint'; hint.style.cssText = 'font-size:11.5px;line-height:1.35;margin-top:4px;min-height:1.2em;color:var(--ql-text-muted)'; el.parentNode.appendChild(hint); }
  const x = window.QLParty ? QLParty.normGstin(val) : String(val || '').toUpperCase();
  hint.style.color = 'var(--ql-text-muted)'; hint.textContent = '';
  if (x.length !== 15 || !QLShell.gstinLookup) return;
  const my = ++_gstinSeq; hint.textContent = 'Checking GSTIN…';
  const r = await QLShell.gstinLookup(x); if (my !== _gstinSeq) return;
  const fill = (id, v) => { const f = document.getElementById(id); if (f && v && !String(f.value || '').trim()) f.value = v; };
  if (r.valid) {
    /* The GSTIN is cleaned in the box (no spaces, upper case) so it prints the
       way it is registered; and the State is SET, not merely filled — it is a
       fact read off the GSTIN's first two digits, and the box arrives pre-filled
       with the seller's own state, which is wrong for any out-of-state buyer. */
    if (el.value !== r.gstin) el.value = r.gstin;
    if (r.state) setState(r.state);
    if (r.party) { fill('i_bname', r.party.name); fill('i_baddr', r.party.address); fill('i_bphone', r.party.phone); }
    const m = r.remote; if (m && m.lookup === 'ok') { fill('i_bname', m.trade || m.name); fill('i_baddr', m.address); }
  }
  const h = QLShell.gstinHint(r); hint.textContent = h.text; hint.style.color = h.tone === 'bad' ? 'var(--ql-danger-600)' : 'var(--ql-text-muted)';
  schedulePreview();
}
function onInput(e) {
  showCalc();
  if (e.target.id === 'i_bgst') gstinAssist(e.target.value);
  if (e.target.id === 'i_bstate') setState(e.target.value);
  // when a known customer is picked, auto-fill GSTIN / address / state
  if (e.target.id === 'i_bname') {
    const p = Q.partyRows().find(x => (x.name || '').toUpperCase() === e.target.value.trim().toUpperCase());
    if (p) { const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; }; set('i_bgst', p.gstin); set('i_baddr', p.address); setState(Q.reconcileState(p.state, p.gstin)); set('i_bphone', p.phone); }
  }
  schedulePreview();
}

window.__qlRefresh = render;
window.__qlOnSwitchCompany = () => render();   // shell owns the switch
if (Q.init) Q.init(render); else render();
