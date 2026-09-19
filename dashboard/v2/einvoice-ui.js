/* QLEInvoice — the "E-Invoice" tab on a sale, and the bridge between the
   portal's answer (einvoice.php) and the printed invoice (invoiceData).

   States, as the owner specified them:
     DRAFT      no registration yet; the portal JSON does not validate
     READY      validates — "Generate e-Invoice" is enabled
     GENERATING a request is in flight (the server holds the lock too)
     GENERATED  IRN · Ack No · Ack Date · the portal's signed QR
     FAILED     the portal's own message, Retry (which first asks the portal
                whether it already holds the document) and Verify
     CANCELLED

   After GENERATED the facts are copied onto the sale record (irn, ackNo,
   ackDt, signedQr, ewbNo, ewbDt, einvStatus) so EVERY print — today's and a
   reprint next year — carries the official QR without asking the portal
   again. The server row stays the source of truth; "Refresh" re-reads it.

   The e-way bill is separate: the portal returns EwbNo only when the request
   carried transport details; this never assumes one exists.

   Pure pieces (state(), view()) take plain objects so they are unit-tested;
   the DOM/network glue is thin. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QLEInvoice = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  /* the state of a sale: from the server's row when it exists, else from the sale record, else from the validation */
  function state(sale, doc, prep) {
    var d = doc || null;
    if (d && d.status === 'cancelled') return 'cancelled';
    if (d && d.status === 'generated' && d.irn) return 'generated';
    if (d && d.status === 'generating') return 'generating';
    if (d && d.status === 'failed') return 'failed';
    if (!d && sale && sale.irn && sale.signedQr) return 'generated';   // registered earlier; the row is what the sale carries
    if (prep && prep.ok === false) return 'draft';
    if (prep && prep.ok) return 'ready';
    return 'draft';
  }
  /* what the sale record should carry after the portal spoke — null when nothing changes */
  function saleFacts(doc) {
    if (!doc || !doc.irn) return null;
    return { irn: doc.irn, ackNo: doc.ackNo || '', ackDt: doc.ackDt || '', signedQr: doc.signedQr || '', ewbNo: doc.ewbNo || '', ewbDt: doc.ewbDt || '', einvStatus: doc.status || 'generated' };
  }
  function pill(s) {
    var m = { generated: ['✓ E-Invoice Generated', '#dcfce7', '#15803d'], failed: ['E-Invoice Generation Failed', '#fee2e2', '#b91c1c'], generating: ['Generating…', '#dbeafe', '#1d4ed8'], cancelled: ['Cancelled', '#f3f4f6', '#374151'], ready: ['Ready for e-Invoice', '#fef3c7', '#92400e'], draft: ['Not Generated', '#f3f4f6', '#374151'] }[s] || ['—', '#f3f4f6', '#374151'];
    return '<span class="einv-pill" style="background:' + m[1] + ';color:' + m[2] + '">' + m[0] + '</span>';
  }
  /* the tab body. opts: {sale, doc, prep, canManage, qrSvg(payload)->svg} */
  function view(o) {
    var s = state(o.sale, o.doc, o.prep), d = o.doc || {}, sale = o.sale || {};
    var irn = d.irn || sale.irn || '', ackNo = d.ackNo || sale.ackNo || '', ackDt = d.ackDt || sale.ackDt || '', qr = d.signedQr || sale.signedQr || '';
    var kv = function (k, v) { return v ? '<div class="einv-kv"><span>' + k + '</span><b>' + esc(v) + '</b></div>' : ''; };
    var h = '<div class="einv-tab"><div class="einv-head"><div class="einv-status">Status: ' + pill(s) + '</div>';
    if (s === 'failed' && (d.error || '')) h += '<div class="einv-err">' + esc(d.error) + (d.needsVerify ? '<br><small>The portal may have registered it before the connection dropped — press Verify before Retry.</small>' : '') + '</div>';
    if (s === 'draft' && o.prep && o.prep.errors && o.prep.errors.length) h += '<div class="einv-err"><b>Not ready for the portal:</b><ul>' + o.prep.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>';
    if (s === 'cancelled') h += '<div class="einv-err">' + esc(d.cancelReason ? 'Cancelled — ' + d.cancelReason : 'Cancelled on the portal') + (d.cancelledAt ? ' · ' + esc(d.cancelledAt) : '') + '</div>';
    h += '</div>';
    if (irn) {
      h += '<div class="einv-body"><div class="einv-facts">' + kv('IRN', irn) + kv('Ack No', ackNo) + kv('Ack Date', ackDt) + kv('E-Way Bill', d.ewbNo || sale.ewbNo ? (d.ewbNo || sale.ewbNo) + ((d.ewbDt || sale.ewbDt) ? ' · ' + (d.ewbDt || sale.ewbDt) : '') + (d.ewbValid ? ' · valid till ' + d.ewbValid : '') : '') + '</div>';
      var svg = qr && o.qrSvg ? o.qrSvg(qr) : '';
      h += '<div class="einv-qr">' + (svg ? svg + '<div class="einv-qrc">Official GST e-Invoice QR · scan to verify</div>' : '<div class="einv-qrc">' + (qr ? 'QR could not be drawn' : 'No signed QR on record — press Verify to fetch it from the portal') + '</div>') + '</div></div>';
    }
    var btn = function (act, label, cls) { return '<button class="qx-btn qx-btn-sm' + (cls ? ' ' + cls : '') + '" data-einv="' + act + '">' + label + '</button>'; };
    var acts = [];
    if (o.canManage) {
      if (s === 'ready' || s === 'draft') acts.push(btn('generate', 'Generate e-Invoice', s === 'ready' ? 'qx-btn-primary' : ''));
      if (s === 'failed') { acts.push(btn('verify', 'Verify')); acts.push(btn('retry', 'Retry', 'qx-btn-primary')); }
      if (s === 'generating') acts.push(btn('refresh', 'Refresh status'));
      if (s === 'generated') { acts.push(btn('refresh', 'Verify / Refresh')); acts.push(btn('cancel', 'Cancel e-Invoice', 'qx-btn-danger')); }
    }
    if (irn) { acts.push(btn('json', 'Download e-Invoice JSON')); acts.push(btn('pdf', 'Download PDF')); if (qr) acts.push(btn('qr', 'View QR')); }
    if (!o.canManage && !irn) acts.push('<span class="einv-note">Only the owner can register e-invoices.</span>');
    h += '<div class="einv-actions">' + acts.join(' ') + '</div></div>';
    return h;
  }
  var CSS = '.einv-tab{padding:14px 16px;font-size:13px}.einv-head{display:flex;flex-direction:column;gap:8px}.einv-status{font-weight:600}.einv-pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;margin-left:6px}'
    + '.einv-err{background:var(--ql-danger-50,#fef2f2);color:var(--ql-danger-700,#b91c1c);border:1px solid var(--ql-danger-100,#fecaca);border-radius:var(--ql-radius-md,8px);padding:8px 10px;font-size:12.5px;line-height:1.5}.einv-err ul{margin:4px 0 0;padding-left:18px}'
    + '.einv-body{display:flex;gap:18px;align-items:flex-start;margin-top:12px;flex-wrap:wrap}.einv-facts{flex:1;min-width:240px}.einv-kv{display:flex;gap:10px;padding:4px 0;border-bottom:1px solid var(--ql-border,#e5e7eb);font-size:12.5px}.einv-kv span{color:var(--ql-text-muted);min-width:78px;flex:none}.einv-kv b{word-break:break-all;font-family:var(--ql-font-mono);font-weight:600}'
    + '.einv-qr{flex:none;text-align:center}.einv-qr svg{display:block;width:176px;height:176px;border:1px solid var(--ql-border,#e5e7eb);border-radius:var(--ql-radius-md,8px);background:#fff}.einv-qrc{font-size:11px;color:var(--ql-text-muted);margin-top:4px;max-width:200px}'
    + '.einv-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.einv-note{font-size:12px;color:var(--ql-text-muted)}';
  return { state: state, view: view, saleFacts: saleFacts, CSS: CSS, esc: esc };
}));
