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
  const taxable = qty * rate, cgst = taxable * gstR / 200, sgst = cgst, total = taxable + cgst + sgst;
  const bgst = g('i_bgst').trim().toUpperCase();
  const interState = bgst && bgst.length >= 2 && bgst.slice(0, 2) !== '08';
  return {
    seller: Q.co, noBar: true, hsn: g('i_hsn') || '25221000',
    buyer: { name: g('i_bname'), gstin: bgst, address: g('i_baddr'), state: g('i_bstate') },
    inv: g('i_no'), date: g('i_date'), product: g('i_product') || 'Quick Lime',
    qty, rate, unit: g('i_unit') || 'Tonne', gstR,
    veh: g('i_veh'), eway: g('i_eway'), transport: g('i_trans') || 'By Road', station: g('i_stn'), grrr: g('i_grrr'),
    taxable, cgst, sgst, igst: interState ? cgst + sgst : 0, interState,
    total, roundOff: Math.round(total) - total, grand: Math.round(total),
    words: Q.amountInWords(Math.round(total))
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
  try {
    if (doc && doc.documentElement) {
      doc.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
      return;
    }
  } catch (_) {}
  const f = document.getElementById('invFrame'); if (f) f.srcdoc = html;   // fallback (first paint)
}
let _prevTimer = null;
function schedulePreview() { clearTimeout(_prevTimer); _prevTimer = setTimeout(updatePreview, 250); }

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
    <!-- Despatch. Transport / Station / GR-RR were dropped from the printed
         invoice, so asking for them here would be a form collecting data nobody
         will ever see. Vehicle No. and E-Way Bill still print, so they stay. -->
    <div class="if-sec">Despatch</div>
    <div class="if-grid">
      ${field('i_veh', 'Vehicle No.', { up: 1, ph: 'RJ19 GG 5115' })}
      ${field('i_eway', 'E-Way Bill No.', {})}
    </div>
    <div class="if-sec">Billed to / Shipped to</div>
    <div class="if-grid">
      ${field('i_bname', 'Customer name', { full: true, up: 1, list: 'i_parties', ph: 'Start typing…' })}
      ${field('i_bgst', 'GSTIN / UIN', { up: 1, ph: '08XXXXX0000X1ZX' })}
      ${field('i_bstate', 'State', { val: co.state || '' })}
      ${field('i_baddr', 'Address', { full: true, ph: 'Khasara / village / district' })}
    </div>
    <div class="if-sec">Item</div>
    <div class="if-grid">
      ${field('i_product', 'Description of goods', { full: true, val: 'Quick Lime' })}
      ${field('i_hsn', 'HSN / SAC', { val: '25221000' })}
      ${field('i_unit', 'Unit', { opts: [['Tonne', 'Tonne'], ['Bag', 'Bag'], ['MT', 'MT'], ['Kg', 'Kg']], val: 'Tonne' })}
      ${field('i_qty', 'Quantity', { type: 'number', ph: '0' })}
      ${field('i_rate', 'Rate (₹)', { type: 'number', ph: '0' })}
      ${field('i_gst', 'GST %', { opts: [['0', '0%'], ['5', '5%'], ['12', '12%'], ['18', '18%'], ['28', '28%']], val: '5' })}
    </div>`;
}

function save(andPrint) {
  const d = buildData();
  if (!d.buyer.name) { toast('Enter the customer name', 'err'); document.getElementById('i_bname').focus(); return; }
  if (!d.qty || !d.rate) { toast('Enter quantity and rate', 'err'); return; }
  Q.addSale({ inv: d.inv, date: d.date, party: d.buyer.name, gstin: d.buyer.gstin, addr: d.buyer.address, state: d.buyer.state, product: d.product, qty: d.qty, rate: d.rate, gstR: d.gstR, veh: d.veh, eway: d.eway, unit: d.unit, hsn: d.hsn, transport: d.transport, station: d.station, grrr: d.grrr, status: 'pending' });
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
  const tpl = document.getElementById('invTpl'); if (tpl) tpl.addEventListener('change', onPickDesign);
  document.getElementById('invSave').onclick = () => save(false);
  document.getElementById('invPrint').onclick = () => save(true);
  updatePreview();
  QLShell.paintWorkspace && QLShell.paintWorkspace();
}
function onInput(e) {
  // when a known customer is picked, auto-fill GSTIN / address / state
  if (e.target.id === 'i_bname') {
    const p = Q.partyRows().find(x => (x.name || '').toUpperCase() === e.target.value.trim().toUpperCase());
    if (p) { const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; }; set('i_bgst', p.gstin); set('i_baddr', p.address); set('i_bstate', p.state); }
  }
  schedulePreview();
}

window.__qlRefresh = render;
window.__qlOnSwitchCompany = () => render();   // shell owns the switch
if (Q.init) Q.init(render); else render();
