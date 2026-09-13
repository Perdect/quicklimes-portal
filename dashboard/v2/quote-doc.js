/* ═══════════════════════════════════════════════════════════════════════
   quote-doc.js — the printed QUOTATION and PRICE OFFER, one renderer.

   Pure (browser: window.QuoteDoc · Node: module.exports). Takes the quotation
   row, the customer and the seller's own company record; returns HTML with
   its CSS inlined, so the same function prints from the app, previews in a
   modal, and renders the customer-facing link the server serves. The totals
   come from CustomerCore.quoteTotals — never re-added here — so the paper can
   never disagree with the register or the WhatsApp text.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory(typeof require === 'function' ? require('./customer-core.js') : root.CustomerCore);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QuoteDoc = api;
}(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) { return '₹' + Math.round(+n || 0).toLocaleString('en-IN'); };
  var money2 = function (n) { return '₹' + (+n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var dLong = function (s) { var d = C.parseD(s); return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : (s || ''); };

  var CSS = '\n' +
    '.qd{font:13px/1.5 "Geist",Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;background:#fff;max-width:820px;margin:0 auto;padding:36px 42px}' +
    '.qd *{box-sizing:border-box}.qd-head{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #0f4c81;padding-bottom:16px}' +
    '.qd-co{font-size:22px;font-weight:800;letter-spacing:-.02em;color:#0f4c81}.qd-co-s{font-size:12px;color:#475569;margin-top:2px;white-space:pre-line}' +
    '.qd-doc{text-align:right}.qd-doc-t{font-size:20px;font-weight:800;letter-spacing:.08em;color:#0f172a}.qd-doc-m{font-size:12px;color:#475569;margin-top:6px}.qd-doc-m b{color:#0f172a}' +
    '.qd-meta{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:18px 0}.qd-box{border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px}.qd-box-l{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin-bottom:4px}' +
    '.qd-box-n{font-size:15px;font-weight:800}.qd-box-s{font-size:12px;color:#475569;white-space:pre-line}' +
    '.qd table{width:100%;border-collapse:collapse;margin-top:6px}.qd th{font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:#64748b;text-align:left;padding:8px 10px;border-bottom:2px solid #e2e8f0}' +
    '.qd td{padding:9px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top}.qd .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}' +
    '.qd table.qd-tot{margin-left:auto;width:340px;margin-top:8px}.qd-tot td{padding:6px 10px;border:0}.qd-tot .g td{font-weight:800;font-size:15px;border-top:2px solid #0f4c81;padding-top:10px}' +
    '.qd-terms{margin-top:22px;display:grid;grid-template-columns:1fr 1fr;gap:18px}.qd-terms h4{margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b}.qd-terms ul{margin:0;padding-left:18px;font-size:12.5px;color:#334155}.qd-terms li{margin:3px 0}' +
    '.qd-notes{margin-top:14px;font-size:12.5px;color:#334155;white-space:pre-line}' +
    '.qd-sign{display:flex;justify-content:space-between;align-items:flex-end;margin-top:38px;padding-top:14px;border-top:1px solid #e2e8f0}.qd-sign-l{font-size:12px;color:#475569}.qd-sign-r{text-align:center;font-size:12px;color:#475569}.qd-sign-r b{display:block;color:#0f172a;margin-bottom:38px}' +
    '.qd-status{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:999px;background:#eff6ff;color:#1d4ed8;margin-left:8px}' +
    '.qd-offer .qd-big{font-size:34px;font-weight:800;color:#0f4c81;letter-spacing:-.02em}.qd-offer .qd-big small{font-size:14px;color:#475569;font-weight:600}' +
    '@media print{.qd{padding:0;max-width:none}@page{margin:16mm}}';

  function sellerBlock(co) {
    co = co || {};
    var addr = String(co.address || '');
    var cityLine = co.city && addr.toLowerCase().indexOf(String(co.city).toLowerCase()) < 0 ? co.city + (co.state ? ', ' + co.state : '') + (co.pin ? ' – ' + co.pin : '') : (co.pin && addr.indexOf(co.pin) < 0 ? 'PIN ' + co.pin : '');
    var lines = [addr, cityLine, co.gstin ? 'GSTIN ' + co.gstin : '', [co.phone ? '☎ ' + co.phone : '', co.email || ''].filter(Boolean).join(' · ')].filter(Boolean);
    return '<div><div class="qd-co">' + esc(co.name || co.short || 'Deshwali Minerals') + '</div><div class="qd-co-s">' + esc(lines.join('\n')) + '</div></div>';
  }
  function customerBlock(c, label) {
    c = c || {};
    var lines = [c.contact ? 'Attn: ' + c.contact : '', c.address || '', [c.city, c.state, c.pin].filter(Boolean).join(', '), c.gstin ? 'GSTIN ' + c.gstin : '', [c.phone || c.wa ? '☎ ' + (c.phone || c.wa) : '', c.email || ''].filter(Boolean).join(' · ')].filter(Boolean);
    return '<div class="qd-box"><div class="qd-box-l">' + esc(label || 'Quotation to') + '</div><div class="qd-box-n">' + esc(c.name || '') + '</div><div class="qd-box-s">' + esc(lines.join('\n')) + '</div></div>';
  }

  /* ── the QUOTATION ─────────────────────────────────────────────────── */
  function quotationHTML(q, cust, co, opts) {
    opts = opts || {};
    var t = C.quoteTotals(q);
    var st = C.effectiveQuoteStatus(q, opts.today);
    var rows = t.lines.map(function (l, i) {
      return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(l.product) + '</b>' + (q.spec ? '<div style="font-size:11.5px;color:#475569">' + esc(q.spec) + '</div>' : '') + '</td><td class="n">' + l.qty + ' ' + esc(l.unit) + '</td><td class="n">' + money(l.rate) + '</td>' + (t.lines.some(function (x) { return x.discount; }) ? '<td class="n">' + (l.discount ? money(l.discount) : '—') + '</td>' : '') + '<td class="n">' + money2(l.amount) + '</td></tr>';
    }).join('');
    var hasDisc = t.lines.some(function (x) { return x.discount; });
    var charge = function (label, v) { return v ? '<tr><td>' + esc(label) + '</td><td class="n">' + money2(v) + '</td></tr>' : ''; };
    var terms = [
      q.paymentTerms ? 'Payment: ' + C.labelOf(C.PAYMENT_TERMS, q.paymentTerms) + (q.paymentNote ? ' — ' + q.paymentNote : '') : '',
      q.deliveryTerms ? 'Delivery: ' + q.deliveryTerms : '',
      q.freightNote ? 'Freight: ' + q.freightNote : (t.freight ? 'Freight as quoted above' : 'Freight extra, at actuals'),
      'GST ' + (t.gstR ? t.gstR + '%' : 'nil') + (q.isExport ? ' (export, zero-rated under LUT)' : ' as applicable, shown above'),
      'Validity: until ' + dLong(q.validUntil),
      q.packaging ? 'Packaging: ' + C.labelOf(C.PACKAGING, q.packaging) : '',
      'Test certificate accompanies every dispatch'
    ].filter(Boolean);
    return '<div class="qd">' +
      '<div class="qd-head">' + sellerBlock(co) + '<div class="qd-doc"><div class="qd-doc-t">QUOTATION' + (opts.showStatus ? '<span class="qd-status">' + esc(C.labelOf(C.QUOTE_STATUS, st)) + '</span>' : '') + '</div><div class="qd-doc-m">No. <b>' + esc(q.no || '') + '</b><br>Date <b>' + esc(dLong(q.date)) + '</b><br>Valid until <b>' + esc(dLong(q.validUntil)) + '</b></div></div></div>' +
      '<div class="qd-meta">' + customerBlock(cust, 'Quotation to') + '<div class="qd-box"><div class="qd-box-l">Delivery</div><div class="qd-box-n">' + esc(q.deliveryLoc || (cust && (cust.deliveryLoc || cust.city)) || 'As advised') + '</div><div class="qd-box-s">' + esc([q.deliveryTerms || '', q.transport ? C.labelOf(C.TRANSPORT, q.transport) : ''].filter(Boolean).join('\n')) + '</div></div></div>' +
      (q.intro ? '<p style="margin:0 0 10px">' + esc(q.intro) + '</p>' : '<p style="margin:0 0 10px">Thank you for your enquiry. We are pleased to quote as follows:</p>') +
      '<table><thead><tr><th>#</th><th>Product</th><th class="n">Quantity</th><th class="n">Rate</th>' + (hasDisc ? '<th class="n">Discount</th>' : '') + '<th class="n">Amount</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<table class="qd-tot"><tbody><tr><td>Goods</td><td class="n">' + money2(t.goods) + '</td></tr>' + charge('Freight', t.freight) + charge('Loading', t.loading) + charge(q.otherLabel || 'Other charges', t.other) +
      '<tr><td>Taxable value</td><td class="n">' + money2(t.taxable) + '</td></tr><tr><td>GST @ ' + t.gstR + '%</td><td class="n">' + money2(t.gst) + '</td></tr><tr class="g"><td>Total</td><td class="n">' + money2(t.total) + '</td></tr></tbody></table>' +
      '<div class="qd-terms"><div><h4>Terms</h4><ul>' + terms.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
      (q.notes ? '<div><h4>Notes</h4><div class="qd-notes">' + esc(q.notes) + '</div></div>' : '<div></div>') + '</div>' +
      '<div class="qd-sign"><div class="qd-sign-l">' + esc((co && (co.phone ? 'Questions: ' + co.phone : '')) || '') + '</div><div class="qd-sign-r"><b>For ' + esc((co && (co.name || co.short)) || 'Deshwali Minerals') + '</b>Authorised Signatory</div></div>' +
      '</div>';
  }

  /* ── the PRICE OFFER — a one-page card ─────────────────────────────── */
  function offerHTML(o, cust, co) {
    var facts = [
      ['Product', o.product], ['Quantity', (o.qty || '—') + ' ' + (o.unit || 'MT')], ['Freight', C.labelOf(C.FREIGHT, o.freight)],
      ['GST', o.gstText || 'As applicable'], ['Validity', o.validUntil ? 'until ' + dLong(o.validUntil) : (o.validDays ? o.validDays + ' days' : '—')],
      ['Delivery', o.delivery || '—'], ['Payment', C.labelOf(C.PAYMENT_TERMS, o.payment) || '—'], ['Delivery location', o.deliveryLoc || (cust && (cust.deliveryLoc || cust.city)) || '—']
    ];
    return '<div class="qd qd-offer">' +
      '<div class="qd-head">' + sellerBlock(co) + '<div class="qd-doc"><div class="qd-doc-t">PRICE OFFER</div><div class="qd-doc-m">No. <b>' + esc(o.no || '') + '</b><br>Date <b>' + esc(dLong(o.date)) + '</b></div></div></div>' +
      '<div class="qd-meta">' + customerBlock(cust, 'Offer to') + '<div class="qd-box"><div class="qd-box-l">Our offer</div><div class="qd-big">' + money(o.rate) + ' <small>/ ' + esc(o.unit || 'MT') + '</small></div><div class="qd-box-s">' + esc(o.product || '') + (o.qty ? ' · ' + o.qty + ' ' + (o.unit || 'MT') : '') + '</div></div></div>' +
      '<table><tbody>' + facts.map(function (f) { return '<tr><td style="width:180px;color:#64748b">' + esc(f[0]) + '</td><td><b>' + esc(f[1] || '—') + '</b></td></tr>'; }).join('') + '</tbody></table>' +
      (o.notes ? '<div class="qd-notes">' + esc(o.notes) + '</div>' : '') +
      '<div class="qd-sign"><div class="qd-sign-l">' + esc((co && co.phone) ? 'Confirm on ' + co.phone : '') + '</div><div class="qd-sign-r"><b>For ' + esc((co && (co.name || co.short)) || 'Deshwali Minerals') + '</b>Authorised Signatory</div></div>' +
      '</div>';
  }

  /* a complete printable page (used by print and by the customer link) */
  function page(bodyHTML, title) {
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title || 'Quotation') + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700;800&display=swap" rel="stylesheet"><style>body{margin:0;background:#f1f5f9}' + CSS + '</style></head><body>' + bodyHTML + '</body></html>';
  }

  return { CSS: CSS, quotationHTML: quotationHTML, offerHTML: offerHTML, page: page, money: money };
}));
