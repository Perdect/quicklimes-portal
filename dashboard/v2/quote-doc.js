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
  var C = root.CustomerCore || (typeof require === 'function' ? require('./customer-core.js') : null);
  var U = root.QLUnits || (typeof require === 'function' ? require('./units-core.js') : null);
  var api = factory(C, U);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QuoteDoc = api;
}(typeof self !== 'undefined' ? self : this, function (C, U) {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) { return '₹' + Math.round(+n || 0).toLocaleString('en-IN'); };
  var money2 = function (n) { return '₹' + (+n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var dLong = function (s) { var d = C.parseD(s); return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : (s || ''); };

  var CSS = '\n' +
    '.qd.qd-offer{font:13px/1.5 "Geist",Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;background:#fff;max-width:820px;margin:0 auto;padding:36px 42px;display:block;min-height:0}' +
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
    '.qd-conv{font-size:.88em;color:var(--ql-text-secondary,#475569);white-space:nowrap}' +
    '@media print{.qd.qd-offer{padding:0;max-width:none}}';

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

  /* ── amount in words, Indian numbering — pure, so the public page has it too ── */
  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function two(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''); }
  function three(n) { return (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : ''); }
  function wordsOf(n) {
    n = Math.round((+n || 0) * 100) / 100; var r = Math.floor(n), p = Math.round((n - r) * 100);
    if (!r && !p) return 'Rupees Zero Only';
    var parts = [], cr = Math.floor(r / 1e7), lk = Math.floor((r % 1e7) / 1e5), th = Math.floor((r % 1e5) / 1000), hu = r % 1000;
    if (cr) parts.push(three(cr) + ' Crore'); if (lk) parts.push(three(lk) + ' Lakh'); if (th) parts.push(three(th) + ' Thousand'); if (hu) parts.push(three(hu));
    return 'Rupees ' + (parts.join(' ') || 'Zero') + (p ? ' and Paise ' + two(p) : '') + ' Only';
  }
  var ICON = { pin: '<svg viewBox="0 0 24 24"><path d="M12 22s7-7.1 7-12a7 7 0 1 0-14 0c0 4.9 7 12 7 12z"/><circle cx="12" cy="10" r="2.6" fill="#fff"/></svg>', tel: '<svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8z"/></svg>', mail: '<svg viewBox="0 0 24 24"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1.4 2 7.6 5.3L19.6 7H4.4z"/></svg>', web: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 9h-3a15.6 15.6 0 0 0-1.3-5.6A8 8 0 0 1 18.9 11zM12 4c1.2 1.4 2.2 3.9 2.5 7h-5c.3-3.1 1.3-5.6 2.5-7zM5.1 11a8 8 0 0 1 4.3-5.6A15.6 15.6 0 0 0 8.1 11h-3zm0 2h3c.2 2.1.7 4 1.3 5.6A8 8 0 0 1 5.1 13zM12 20c-1.2-1.4-2.2-3.9-2.5-7h5c-.3 3.1-1.3 5.6-2.5 7zm2.6-1.4c.6-1.6 1.1-3.5 1.3-5.6h3a8 8 0 0 1-4.3 5.6z"/></svg>' };
  var BLUE = '#1B5FA8', INK = '#0E2A47', RULE = '#c9d3e0', GREY = '#5b6b7f';
  /* the mock's page: lockup + product line, icon contact block, blue title
     band, four boxes, BILL TO / SHIP TO, blue-header table with the diamond
     watermarked, Total Quantity + words beside the totals with a blue Grand
     Total, numbered terms against the signature, GSTIN | PAN foot, the blue
     website band. Shared with the Classic GST Invoice design. */
  var QCSS = '\n' +
    '.qd{font:9.6px/1.4 "Segoe UI",Roboto,Arial,Helvetica,sans-serif;color:' + INK + ';background:#fff;width:820px;margin:0 auto;padding:22px 26px 0;box-sizing:border-box;display:flex;flex-direction:column;min-height:1130px}.qd *{box-sizing:border-box}' +
    '.qd-lh{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:8px}.qd-lh .lk{height:52px;width:auto;display:block}.qd-lh .nm{font-size:24px;font-weight:800;color:' + INK + ';letter-spacing:.04em;text-transform:uppercase;line-height:1}.qd-lh .tg{font-size:8.6px;letter-spacing:.08em;text-transform:uppercase;color:' + INK + ';margin-top:6px;font-weight:600}' +
    '.qd-ctc{font-size:9.6px;line-height:1.5;flex:none}.qd-ctc div{display:flex;align-items:center;gap:8px;padding:2px 0}.qd-ctc svg{width:13px;height:13px;fill:' + BLUE + ';flex:none}' +
    '.qd-band{background:' + BLUE + ';color:#fff;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:8px 14px;margin-top:4px}.qd-band .t{grid-column:2;text-align:center}.qd-band .w{font-size:22px;font-weight:800;letter-spacing:.08em;line-height:1.05}.qd-band .sl{font-size:8.4px;letter-spacing:.16em;text-transform:uppercase;margin-top:3px;opacity:.92}.qd-band .c{grid-column:3;text-align:right;font-size:8.6px;font-weight:700;letter-spacing:.06em;align-self:start}' +
    '.qd-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px}.qd-strip div{border:1px solid ' + RULE + ';padding:5px 9px;min-width:0}.qd-strip span{display:block;font-size:7.6px;letter-spacing:.06em;text-transform:uppercase;color:' + BLUE + ';font-weight:700}.qd-strip b{display:block;font-size:10.5px;font-weight:700;color:' + INK + ';margin-top:2px;word-break:break-word}' +
    '.qd-par{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}.qd-box{border:1px solid ' + RULE + ';padding:7px 10px 8px}.qd-box h4{margin:0 0 4px;font-size:8.4px;letter-spacing:.08em;text-transform:uppercase;color:' + BLUE + ';font-weight:800}.qd-box .nm{font-size:11.5px;font-weight:800;color:' + INK + '}.qd-box .ad{white-space:pre-line;line-height:1.4;margin:2px 0 6px}' +
    '.qd-kv{display:flex;padding:1.4px 0;font-size:9.6px}.qd-kv .k{width:64px;flex:none;font-weight:700}.qd-kv .c{width:12px;flex:none}.qd-kv .v{flex:1;min-width:0;word-break:break-word}' +
    '.qd-body{position:relative;flex:1;display:flex;flex-direction:column;margin-top:8px}.qd-fill{flex:1;min-height:60px;border-left:1px solid ' + RULE + ';border-right:1px solid ' + RULE + '}.qd-wm{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:0;opacity:.06}.qd-wm img{width:400px;height:auto}' +
    '.qd table{width:100%;border-collapse:collapse;table-layout:fixed}.qd .it th{background:' + BLUE + ';color:#fff;font-size:8.6px;letter-spacing:.06em;text-transform:uppercase;padding:7px 6px;text-align:center;vertical-align:middle;border-right:1px solid rgba(255,255,255,.25);position:relative;z-index:1}.qd .it th:last-child{border-right:0}' +
    '.qd .it td{border-bottom:1px solid ' + RULE + ';border-right:1px solid ' + RULE + ';padding:7px 6px;vertical-align:top;position:relative;z-index:1;font-size:10px}.qd .it td:first-child{border-left:1px solid ' + RULE + '}.qd .r{text-align:right}.qd .c{text-align:center}.qd .dn{font-weight:800;color:' + INK + ';text-transform:uppercase}.qd .ds{font-size:8.8px;color:' + GREY + ';font-weight:400;text-transform:none}.qd-conv{font-size:8.8px;color:' + GREY + ';white-space:nowrap}' +
    '.qd-tots{display:grid;grid-template-columns:1fr 340px;border:1px solid ' + RULE + ';border-top:0}.qd-tots .lft{border-right:1px solid ' + RULE + '}.qd-tq{display:flex;border-bottom:1px solid ' + RULE + '}.qd-tq div{padding:6px 10px;font-weight:800;font-size:10.5px}.qd-tq div:first-child{width:40%;border-right:1px solid ' + RULE + '}' +
    '.qd-wd{padding:8px 10px}.qd-wd span{display:block;font-weight:700}.qd-wd b{display:block;font-size:11.5px;font-weight:800;margin-top:2px}' +
    '.qd .tx td{border-bottom:1px solid ' + RULE + ';padding:5px 10px;font-size:10px;vertical-align:middle}.qd .tx td:first-child{font-weight:700;border-right:1px solid ' + RULE + ';width:58%}.qd .tx td:last-child{text-align:right;font-weight:700}.qd .tx tr.gt td{background:' + BLUE + ';color:#fff;font-size:12px;font-weight:800;border-color:' + BLUE + '}' +
    '.qd-ft{display:grid;grid-template-columns:1fr 240px;border:1px solid ' + RULE + ';border-top:0}.qd-tc{padding:8px 10px;font-size:9.6px;line-height:1.55}.qd-tc b.h{display:block;letter-spacing:.04em;text-transform:uppercase;margin-bottom:3px}.qd-tc ol{margin:0;padding-left:16px}.qd-notes{margin-top:6px;white-space:pre-line;color:#334155}' +
    '.qd-sg{padding:10px 12px 8px;text-align:center;display:flex;flex-direction:column;justify-content:space-between;align-items:center}.qd-sg .for{font-weight:800;font-size:10.5px}.qd-sg .sp{flex:1;min-height:44px}.qd-sg .as{border-top:1px solid ' + INK + ';padding-top:4px;font-size:10px;font-weight:700;min-width:170px}' +
    '.qd-foot{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:10px 4px 8px;font-size:9.6px}.qd-foot .ids{white-space:nowrap}.qd-foot .ids b{font-weight:800;margin-right:4px}.qd-foot .ids .sep{margin:0 8px;color:' + GREY + '}.qd-foot .pa{text-align:right}.qd-foot .pa b{font-weight:800}.qd-foot .pa i{display:block;color:' + GREY + ';margin-top:2px}' +
    '.qd-site{background:' + BLUE + ';color:#fff;text-align:center;font-size:11px;font-weight:700;letter-spacing:.3em;text-transform:uppercase;padding:8px 10px;margin:0 -26px}' +
    '.qd-status{display:inline-block;font-size:8px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;border-radius:999px;background:#fff;color:' + BLUE + ';margin-left:8px;vertical-align:middle}' +
    '@media print{@page{size:A4;margin:0}.qd{width:auto;padding:8mm 9mm 0;min-height:100vh}.qd-site{margin:0 -9mm}}@media screen and (max-width:900px){.qd{zoom:.72}}';

  /* ── the QUOTATION ─────────────────────────────────────────────────── */
  function quotationHTML(q, cust, co, opts) {
    opts = opts || {}; cust = cust || {}; co = co || {};
    /* The quotation IS the firm's navy letterhead (the Premium design was measured
       from the owner's quotation PDF); the print engine renders it as a full page.
       Callers that inject the document into their own page take the sheet's body. */
    var IT = (typeof InvoiceTemplates !== 'undefined') ? InvoiceTemplates : (typeof require === 'function' ? (function () { try { return require('./invoice-templates.js'); } catch (e) { return null; } })() : null);
    if (IT && IT.quotationHTML && !opts.legacy) {
      var full = IT.quotationHTML(q, cust, co, opts);
      if (opts.fullPage) return full;
      var css = full.slice(full.indexOf('<style>') + 7, full.indexOf('</style>')), body = full.slice(full.indexOf('<body>') + 6, full.lastIndexOf('</body>'));
      return '<div class="qd-premium"><style>' + css.replace(/body\{/g, '.qd-premium{').replace(/@page\{[^}]*\}/g, '') + '</style>' + body + '</div>';
    }
    var t = C.quoteTotals(q);
    var st = C.effectiveQuoteStatus(q, opts.today);
    var stCode = function (x) { var m = String(x || '').match(/\((\d\d)\)/); return m ? m[1] : ''; };
    var gCode = function (g) { g = String(g || '').replace(/[^A-Za-z0-9]/g, ''); return g.length === 15 ? g.slice(0, 2) : ''; };
    var sCode = gCode(co.gstin) || stCode(co.state), bCode = gCode(cust.gstin) || stCode(cust.state);
    var inter = !!q.isExport || (sCode !== '' && bCode !== '' && sCode !== bCode);
    var pan = function (g) { g = String(g || '').replace(/[^A-Za-z0-9]/g, ''); return g.length === 15 ? g.slice(2, 12) : ''; };
    var kv = function (k, v) { return '<div class="qd-kv"><span class="k">' + k + '</span><span class="c">:</span><span class="v">' + (v ? esc(v) : '--') + '</span></div>'; };
    var cell = function (k, v) { return '<div><span>' + k + '</span><b>' + (v ? esc(v) : '--') + '</b></div>'; };
    var hsn = q.hsn || co.hsn || '25221000';
    var rows = t.lines.map(function (l, i) {
      /* the quantity AS ENTERED with its unit, the rate with the unit it is
         per, and — only when the two differ — one small line of arithmetic
         so the customer sees how 7,650 Kg became ₹40,545 at ₹5,300 / Ton */
      var conv = (l.ok && l.billableUnit !== l.unit) ? '<div class="qd-conv">' + esc(U.fmtQty(l.qty, l.unit) + ' = ' + U.fmtQty(l.billableQty, l.billableUnit) + ' × ' + money(l.rate)) + '</div>' : '';
      return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + esc(hsn) + '</td><td><span class="dn">' + esc(l.product) + '</span>' + (q.spec ? '<div class="ds">' + esc(q.spec) + '</div>' : '') + conv + '</td><td class="c">' + esc(l.unit) + '</td><td class="c">' + esc(U.fmtQty(l.qty, l.unit).replace(/\s*\S+$/, '')) + '</td><td class="r">' + esc(U.fmtRate(l.rate, l.rateUnit)) + '</td>' + (l.discount ? '<td class="r">' + money2(l.discount) + '</td>' : '') + '<td class="r">' + money2(l.amount).replace('₹', '') + '</td></tr>';
    }).join('');
    var hasDisc = t.lines.some(function (x) { return x.discount; });
    var charge = function (label, v) { return v ? '<tr><td>' + esc(label) + '</td><td>' + money2(v).replace('₹', '') + '</td></tr>' : ''; };
    var half = (t.gstR / 2).toFixed(2);
    var tax = q.isExport ? '<tr><td>IGST — zero-rated export under LUT</td><td>0.00</td></tr>' : inter ? '<tr><td>Add: IGST @ ' + t.gstR.toFixed(2) + '%</td><td>' + money2(t.gst).replace('₹', '') + '</td></tr>' : '<tr><td>Add: CGST @ ' + half + '%</td><td>' + money2(t.gst / 2).replace('₹', '') + '</td></tr><tr><td>Add: SGST @ ' + half + '%</td><td>' + money2(t.gst / 2).replace('₹', '') + '</td></tr>';
    var terms = (Array.isArray(q.terms) && q.terms.length) ? q.terms : [
      'Goods once sold will not be taken back.',
      'Prices are valid up to the above validity date.',
      q.paymentTerms ? 'Payment: ' + C.labelOf(C.PAYMENT_TERMS, q.paymentTerms) + (q.paymentNote ? ' — ' + q.paymentNote : '') : 'Interest @ 18% p.a. will be charged if the payment is not made within 30 days.',
      q.deliveryTerms ? 'Delivery: ' + q.deliveryTerms : 'Delivery subject to availability and production schedule.',
      q.freightNote ? 'Freight: ' + q.freightNote : (t.freight ? 'Transportation charges as mentioned above.' : 'Freight extra, at actuals.'),
      'Any statutory dues (GST, etc.) will be charged as applicable.',
      'Subject to ' + (co.jurisdiction || 'Rajasthan') + ' jurisdiction only.',
      q.packaging ? 'Packaging: ' + C.labelOf(C.PACKAGING, q.packaging) : '',
      'This is a computer generated quotation and does not require a signature.'
    ].filter(Boolean);
    var addr = String(co.address || '').replace(/\n/g, ', ');
    var qtyTotal = t.tonnes ? U.fmtQty(t.tonnes, 'Ton') : (t.lines.length === 1 ? U.fmtQty(t.lines[0].qty, t.lines[0].unit) : '');
    var party = function (title, p) {
      return '<div class="qd-box"><h4>' + title + '</h4><div class="nm">' + esc(p.name || '') + '</div><div class="ad">' + esc([p.address || '', [p.city, p.state, p.pin].filter(Boolean).join(', ')].filter(Boolean).join('\n')) + '</div>'
        + kv('GSTIN', p.gstin) + kv('PAN', pan(p.gstin)) + kv('STATE', p.state) + kv('CONTACT', p.contact || p.phone || p.wa) + '</div>';
    };
    var ship = (q.shipTo && q.shipTo.name) ? q.shipTo : (q.deliveryLoc ? { name: cust.name, address: q.deliveryLoc, state: cust.state, gstin: cust.gstin, contact: cust.contact, phone: cust.phone } : cust);
    return '<div class="qd">' +
      '<div class="qd-lh"><div>' + (co.lockupDark ? '<img class="lk" src="' + esc(co.lockupDark) + '" alt="' + esc(co.name || '') + '">' : '<div class="nm">' + esc(co.name || co.short || 'Deshwali Minerals') + '</div>') + ((co.product || co.tagline) ? '<div class="tg">' + esc(co.product || co.tagline) + '</div>' : '') + '</div>' +
      '<div class="qd-ctc">' + (addr ? '<div>' + ICON.pin + '<span>' + esc(addr) + (addr.indexOf('India') < 0 ? ', India' : '') + '</span></div>' : '') + ((co.tel || co.phone) ? '<div>' + ICON.tel + '<span>' + esc(String(co.tel || co.phone).split(/[,/]/).map(function (x) { x = x.replace(/\D/g, ''); return x.length === 10 ? '+91 ' + x : x; }).filter(Boolean).join(', ')) + '</span></div>' : '') + (co.email ? '<div>' + ICON.mail + '<span>' + esc(co.email) + '</span></div>' : '') + (co.website ? '<div>' + ICON.web + '<span>' + esc(co.website) + '</span></div>' : '') + '</div></div>' +
      '<div class="qd-band"><div class="t"><div class="w">QUOTATION' + (opts.showStatus ? '<span class="qd-status">' + esc(C.labelOf(C.QUOTE_STATUS, st)) + '</span>' : '') + '</div>' + (co.slogan ? '<div class="sl">' + esc(co.slogan) + '</div>' : '') + '</div><div class="c">ORIGINAL COPY</div></div>' +
      '<div class="qd-strip">' + cell('Quotation No.', q.no) + cell('Quotation Date', dLong(q.date)) + cell('Valid Upto', dLong(q.validUntil)) + cell('Reference', q.reference || q.ref) + '</div>' +
      '<div class="qd-par">' + party('Bill To', cust) + party('Ship To', ship) + '</div>' +
      '<div class="qd-body">' + (co.logo ? '<div class="qd-wm"><img src="' + esc(co.logo) + '" alt=""></div>' : '') +
      '<table class="it"><colgroup><col style="width:42px"><col style="width:76px"><col><col style="width:54px"><col style="width:62px"><col style="width:96px">' + (hasDisc ? '<col style="width:70px">' : '') + '<col style="width:100px"></colgroup>' +
      '<tr><th>S.No.</th><th>HSN Code</th><th>Description of Goods</th><th>Unit</th><th>Qty</th><th>Rate (₹)</th>' + (hasDisc ? '<th>Discount</th>' : '') + '<th>Amount (₹)</th></tr>' + rows + '</table><div class="qd-fill"></div>' +
      '<div class="qd-tots"><div class="lft"><div class="qd-tq"><div>Total Quantity</div><div>' + esc(qtyTotal) + '</div></div><div class="qd-wd"><span>Amount in Words :</span><b>' + esc(wordsOf(t.total)) + '</b></div>' + (q.intro ? '<div class="qd-wd" style="padding-top:0;font-weight:400">' + esc(q.intro) + '</div>' : '') + '</div>' +
      '<div><table class="tx"><tr><td>Goods (₹)</td><td>' + money2(t.goods).replace('₹', '') + '</td></tr>' + charge('Freight', t.freight) + charge('Loading', t.loading) + charge(q.otherLabel || 'Other charges', t.other) + '<tr><td>Total (₹)</td><td>' + money2(t.taxable).replace('₹', '') + '</td></tr>' + tax + '<tr><td>Total Tax Amount</td><td>' + money2(t.gst).replace('₹', '') + '</td></tr><tr class="gt"><td>Grand Total (₹)</td><td>' + money2(t.total).replace('₹', '') + '</td></tr></table></div></div></div>' +
      '<div class="qd-ft"><div class="qd-tc"><b class="h">Terms &amp; Conditions :</b><ol>' + terms.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' + (q.notes ? '<div class="qd-notes">' + esc(q.notes) + '</div>' : '') + '</div>' +
      '<div class="qd-sg"><div class="for">For ' + esc(String(co.name || co.short || 'Deshwali Minerals').toUpperCase()) + '</div><div class="sp"></div><div class="as">Authorised Signatory</div></div></div>' +
      '<div class="qd-foot"><div class="ids">' + (co.gstin ? '<b>GSTIN :</b>' + esc(co.gstin) : '') + (pan(co.gstin) ? '<span class="sep">|</span><b>PAN :</b>' + esc(pan(co.gstin)) : '') + (co.msme ? '<span class="sep">|</span><b>MSME :</b>' + esc(co.msme) : '') + '</div>' +
      '<div class="pa"><b>Plant Address :</b> ' + esc(co.unitAddress || addr) + ((co.product || co.tagline) ? '<i>' + esc(co.product || co.tagline) + '</i>' : '') + '</div></div>' +
      (co.website ? '<div class="qd-site">' + esc(co.website) + '</div>' : '') +
      '</div>';
  }

  /* ── the PRICE OFFER — a one-page card ─────────────────────────────── */
  function offerHTML(o, cust, co) {
    var unit = C.unitKey(o.unit) || C.LEGACY_UNIT, rateUnit = C.rateUnitOf(unit, o.rateUnit);
    var L = (+o.qty > 0 && +o.rate > 0) ? C.priceLine(o.qty, unit, o.rate, rateUnit) : null;
    var facts = [
      ['Product', o.product], ['Quantity', o.qty ? U.fmtQty(o.qty, unit) : '—'], ['Price', U.fmtRate(o.rate, rateUnit)],
      ['Value', L && L.ok ? money2(L.amount) + (L.billableUnit !== C.unitKey(unit) ? ' (' + U.fmtQty(L.billableQty, L.billableUnit) + ' × ' + money(o.rate) + ')' : '') + ' + GST' : '—'],
      ['Freight', C.labelOf(C.FREIGHT, o.freight)],
      ['GST', o.gstText || 'As applicable'], ['Validity', o.validUntil ? 'until ' + dLong(o.validUntil) : (o.validDays ? o.validDays + ' days' : '—')],
      ['Delivery', o.delivery || '—'], ['Payment', C.labelOf(C.PAYMENT_TERMS, o.payment) || '—'], ['Delivery location', o.deliveryLoc || (cust && (cust.deliveryLoc || cust.city)) || '—']
    ];
    return '<div class="qd qd-offer">' +
      '<div class="qd-head">' + sellerBlock(co) + '<div class="qd-doc"><div class="qd-doc-t">PRICE OFFER</div><div class="qd-doc-m">No. <b>' + esc(o.no || '') + '</b><br>Date <b>' + esc(dLong(o.date)) + '</b></div></div></div>' +
      '<div class="qd-meta">' + customerBlock(cust, 'Offer to') + '<div class="qd-box"><div class="qd-box-l">Our offer</div><div class="qd-big">' + money(o.rate) + ' <small>/ ' + esc(U.normalizeUnit(rateUnit) || rateUnit) + '</small></div><div class="qd-box-s">' + esc(o.product || '') + (o.qty ? ' · ' + esc(U.fmtQty(o.qty, unit)) : '') + '</div></div></div>' +
      '<table><tbody>' + facts.map(function (f) { return '<tr><td style="width:180px;color:#64748b">' + esc(f[0]) + '</td><td><b>' + esc(f[1] || '—') + '</b></td></tr>'; }).join('') + '</tbody></table>' +
      (o.notes ? '<div class="qd-notes">' + esc(o.notes) + '</div>' : '') +
      '<div class="qd-sign"><div class="qd-sign-l">' + esc((co && co.phone) ? 'Confirm on ' + co.phone : '') + '</div><div class="qd-sign-r"><b>For ' + esc((co && (co.name || co.short)) || 'Deshwali Minerals') + '</b>Authorised Signatory</div></div>' +
      '</div>';
  }

  /* a complete printable page (used by print and by the customer link) */
  function page(bodyHTML, title) {
    if (/^<!DOCTYPE html>/.test(String(bodyHTML))) return bodyHTML;   // already a full page (the Premium quotation)
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title || 'Quotation') + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700;800&display=swap" rel="stylesheet"><style>body{margin:0;background:#f1f5f9}' + CSS + QCSS + '</style></head><body>' + bodyHTML + '</body></html>';
  }

  return { CSS: CSS + QCSS, quotationHTML: quotationHTML, offerHTML: offerHTML, page: page, money: money, wordsOf: wordsOf };
}));
