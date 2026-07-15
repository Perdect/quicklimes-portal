/* ═══════════════════════════════════════════════════════════════════════
   invoice-templates.js — the invoice design system.

   ONE RULE OUTRANKS EVERY DESIGN CHOICE IN THIS FILE.
   A GST tax invoice is a legal document. Rule 46 of the CGST Rules lists what it
   MUST carry: supplier name/address/GSTIN, a consecutive invoice number, the
   date, the recipient's name/address/GSTIN, HSN, description, quantity, taxable
   value, the tax RATE and AMOUNT split by head (CGST/SGST or IGST), the total,
   place of supply, and whether tax is on reverse charge. A template may move
   those anywhere, letterspace them, or paint them — it may never DROP one.
   Prettier is not a defence at a GST audit. invoice-compliance.test.js renders
   every template, in both intra- and inter-state modes, and fails if a single
   required field goes missing. That test is the point of this file.

   THE DEFAULT DOES NOT CHANGE. `classic` is the bordered format Gotan already
   issues — the one its customers and its CA recognise. A design system that
   silently restyles every future invoice the day it ships is a surprise, not a
   feature. Nothing moves until the user picks another template.

   No React, no build step: each template is a function (d, cfg) -> HTML string,
   printable to A4 as-is. `d` is QLD.invoiceData(idx) — see the contract below.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* d = { seller{name,short,address,gstin,phone,email,bank,bankBranch,ifsc,accNo,
                  bank2,bankBranch2,ifsc2,accNo2},
          buyer{name,gstin,address,state}, hsn, inv, date, product, qty, rate,
          unit, veh, eway, gstR, transport, station, grrr,
          taxable, cgst, sgst, igst, interState, total, roundOff, grand, words }

     NOTE: the sale record holds ONE line item and has no discount field. No
     template invents a "Discount" column that would always print blank — an
     empty column on a legal document invites the question "discount of what?". */

  var esc = function (s) { return (s == null ? '' : s).toString().replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var fmt = function (n) { return (+n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  /* Quantity is not money and must not be formatted like it. Money always carries
     two decimals — ₹97,000.00 is correct. A quantity does not: "10,000.00 Bags"
     claims a precision that bags do not have, and the old invoice printed a bare
     "0.00 Tonne" that read like a rounding error rather than an empty draft.
     But 10.5 tonnes IS real, so truncating everything would be just as wrong.
     Show the decimals the number actually has: 10,000 Bags, 10.50 Tonne. */
  var qfmt = function (n) {
    var v = +n || 0;
    return Number.isInteger(v) ? v.toLocaleString('en-IN')
      : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  };
  var fdate = function (iso) { if (!iso) return ''; var p = String(iso).split('-'); return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : iso; };

  /* Customisation. Every key is optional; a template that ignores one still
     renders. Colours/fonts are presentation. The FIELDS are not customisable —
     see the rule at the top. */
  var DEFAULT_CFG = {
    template: 'classic',
    accent: '#2563EB',
    font: "Arial, 'Helvetica Neue', sans-serif",
    logo: '',                    // dataURL
    showLogo: true,
    showQR: false,               // rendered only when a payment UPI/QR string exists
    qrData: '',
    showSignature: true,
    signatory: '',               // defaults to the seller's name
    footerNote: '',
    terms: [],                   // string[]; falls back to the statutory declaration
    showBank: true,
    showDeclaration: true
  };
  function cfgOf(c) {
    var o = {}; for (var k in DEFAULT_CFG) o[k] = DEFAULT_CFG[k];
    for (var j in (c || {})) if (c[j] !== undefined && c[j] !== null && c[j] !== '') o[j] = c[j];
    return o;
  }

  /* ── the facts every template must show, computed once ──
     Templates differ in how they LOOK, never in what they say. Deriving these
     here (rather than in each template) is what makes that true by construction:
     four copies of this arithmetic would be four chances to disagree. */
  function facts(d, cfg) {
    var s = d.seller || {}, b = d.buyer || {};
    var halfR = (+d.gstR || 0) / 2;
    return {
      s: s, b: b, cfg: cfg,
      inv: d.inv || '', date: fdate(d.date),
      hsn: d.hsn || '', product: d.product || '', unit: d.unit || '',
      qty: qfmt(d.qty), rate: fmt(d.rate), taxable: fmt(d.taxable),
      gstR: (+d.gstR || 0).toFixed(2), halfR: halfR.toFixed(2),
      interState: !!d.interState,
      cgst: fmt(d.cgst), sgst: fmt(d.sgst), igst: fmt(d.igst),
      totalTax: fmt(d.interState ? d.igst : (d.cgst + d.sgst)),
      grand: fmt(d.grand), words: d.words || '',
      // Place of supply and reverse charge are Rule 46 items in their own right.
      pos: b.state || s.state || '', rcm: d.rcm ? 'Yes' : 'No',
      /* Despatch. The transporter name, station and GR/RR number were dropped by
         request — they said nothing the buyer needed and ate a third of the header.
         Vehicle No. and E-Way Bill stayed on purpose: the E-Way number is what a
         driver produces at a checkpoint, and the vehicle ties this invoice to the
         weighbridge slip the buyer reconciles against. Those two earn their space.
         The sale record still stores transport/station/grrr — dropped from the
         PRINT, not from the data, so nothing is lost and this is reversible. */
      veh: d.veh || '', eway: d.eway || '',
      signatory: cfg.signatory || s.name || '',
      terms: (cfg.terms && cfg.terms.length) ? cfg.terms : [
        'Supply of goods under RULE 46 OF CGST RULE 2017.',
        'No complaint will be entertained after 10 Days from the Date.',
        'Interest at 18% per annum will be charged for amount not paid in time'
      ]
    };
  }

  /* Tax rows, in both modes. Intra-state splits CGST+SGST; inter-state is IGST.
     Getting this wrong is not a design bug, it is a wrong tax return. */
  function taxRows(f, cls) {
    return f.interState
      ? '<div class="' + cls + '"><span>IGST @ ' + f.gstR + ' %</span><span>' + f.igst + '</span></div>'
      : '<div class="' + cls + '"><span>CGST @ ' + f.halfR + ' %</span><span>' + f.cgst + '</span></div>' +
        '<div class="' + cls + '"><span>SGST @ ' + f.halfR + ' %</span><span>' + f.sgst + '</span></div>';
  }
  /* Total quantity — "10,000 Tonne", not just the rupee total.
     A lime buyer reconciles TONNES against the weighbridge slip before they ever
     look at the money, so the quantity total is a headline number, not a footnote.

     It is a single figure only because a sale record holds ONE line item. The day
     invoices carry several lines this must total PER UNIT: 10,000 BAG and 1,000
     PIECES cannot be added into "11,000" — that number would be a lie about two
     different things. summarise() below refuses to sum across units for exactly
     that reason; it is not being fussy, it is refusing to invent a unit. */
  function qtyTotal(f) { return f.qty + (f.unit ? ' ' + f.unit : ''); }

  /* Where the quantity total goes: INSIDE the grand-total line, never on a row of
     its own. A sale record holds one line item, so a separate "Total quantity:
     10,000 Tonne" row would print the exact number already sitting in the line
     above it — the duplication we just spent a commit deleting from the summary
     rail. Riding along on the grand total costs no row and reads the way the
     Classic format already reads: "Grand Total 10,000 Tonne ... ₹1,01,850".
     When multi-line invoices land this becomes a real sum and may earn its own
     row — per unit, never across units. */
  function grandLabel(f, word) { return esc(word) + (f.qty ? ' · ' + esc(qtyTotal(f)) : ''); }

  function taxSumHead(f) { return f.interState ? '<th>IGST Amt.</th>' : '<th>CGST Amt.</th><th>SGST Amt.</th>'; }
  function taxSumCells(f) { return f.interState ? '<td>' + f.igst + '</td>' : '<td>' + f.cgst + '</td><td>' + f.sgst + '</td>'; }

  function bankBlock(f) {
    var s = f.s; if (!f.cfg.showBank || !s.bank) return '';
    var two = s.bank2 ? '<br>' + esc(s.bank2) + (s.bankBranch2 ? ' ' + esc(s.bankBranch2) : '') + ', IFSC CODE-' + esc(s.ifsc2 || '') + ', AC NO-' + esc(s.accNo2 || '') : '';
    return '<b>Bank Details :</b> ' + esc(s.bank) + (s.bankBranch ? ' ' + esc(s.bankBranch) : '') + ', IFSC CODE-' + esc(s.ifsc || '') + ', AC NO-' + esc(s.accNo || '') + two;
  }
  function logoImg(f, h) {
    if (!f.cfg.showLogo || !f.cfg.logo) return '';
    return '<img src="' + esc(f.cfg.logo) + '" alt="" style="height:' + (h || 44) + 'px;width:auto;object-fit:contain">';
  }
  /* A QR is only drawn when there is something real to encode. An ornamental
     square that scans to nothing is worse than no QR. */
  function qrBlock(f) {
    if (!f.cfg.showQR || !f.cfg.qrData) return '';
    return '<div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=' + encodeURIComponent(f.cfg.qrData) + '" alt="Scan to pay" style="width:88px;height:88px"><div class="qrc">Scan to pay</div></div>';
  }

  /* Shared print setup. Colour templates must ask the browser to KEEP their
     colour when printing, or they arrive at the customer as grey mush. */
  var PRINT = '@page{size:A4;margin:10mm}@media print{body{padding:0}.inv{box-shadow:none!important}}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box;margin:0;padding:0}';

  function doc(f, title, css, body) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ' + esc(f.inv) + ' — ' + esc(f.s.short || f.s.name) + '</title><style>' + PRINT + css + '</style></head><body>' + body + '</body></html>';
  }

  /* ══════════════ V4 · classic — the format Gotan already issues ══════════════
     Kept byte-compatible in look with what customers receive today. It is the
     default precisely because it is unremarkable: nobody's invoice changes the
     day this system ships. */
  function classic(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b;
    var css = "body{font-family:" + f.cfg.font + ";color:#000;font-size:11.5px;line-height:1.35;padding:20px;background:#fff}"
      + ".inv{max-width:820px;margin:0 auto;border:1.5px solid #000}.row{display:flex}.b-b{border-bottom:1px solid #000}.b-r{border-right:1px solid #000}.pad{padding:6px 10px}"
      + ".ihd{position:relative;text-align:center;padding:10px 12px 8px}.orig{position:absolute;top:6px;right:10px;font-style:italic;font-size:11px}"
      + ".gi{font-weight:700;font-size:12px}.cn{font-weight:700;font-size:26px;letter-spacing:.5px;margin:2px 0}.ca{font-size:11px}.cg{font-weight:700;margin-top:3px}"
      + ".meta{width:50%}.meta .l{display:flex;justify-content:space-between;gap:8px;padding:1px 0}.meta .l b{font-weight:700}"
      + ".pcol{width:50%;padding:8px 10px;min-height:64px}.pi{font-style:italic;font-weight:700;margin-bottom:3px}.pn{font-weight:700}"
      + "table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:4px 6px;font-size:11px}th{font-weight:700;text-align:center}td.r{text-align:right}td.c{text-align:center}"
      + ".items td{height:22px}.spacer td{border-top:none;border-bottom:none;height:110px}"
      + ".tl{display:flex;justify-content:space-between;gap:20px;padding:1px 10px}.gt{display:flex;justify-content:space-between;font-weight:700;font-size:13px;padding:5px 10px}"
      + ".decl{text-align:center;padding:6px 10px}.decl u{font-weight:700}.decl ol{margin:3px auto;padding-left:0;list-style:none;font-size:10.5px}"
      + ".bank{padding:6px 10px;font-size:10.5px}.sign{text-align:right;padding:18px 10px 6px;font-size:11px}.qr{text-align:center}.qrc{font-size:9px}";
    var body = '<div class="inv">'
      + '<div class="ihd b-b"><div class="orig">Original Copy</div><div class="gi">GST INVOICE</div>'
      + (f.cfg.showLogo && f.cfg.logo ? '<div style="position:absolute;top:8px;left:10px">' + logoImg(f, 40) + '</div>' : '')
      + '<div class="cn">' + esc(s.name) + '</div><div class="ca">' + esc(s.address || '') + '</div>'
      + '<div class="cg">GSTIN : ' + esc(s.gstin || '') + '</div>'
      + (s.email ? '<div style="font-size:10.5px">email : ' + esc(s.email) + '</div>' : '')
      + '<div class="gi" style="margin-top:3px">MANUFACTURES OF QUICK LIME AND HYDRATED LIME</div></div>'
      + '<div class="row b-b"><div class="meta pad b-r">'
      + '<div class="l"><span>Invoice No.</span><b>: ' + esc(f.inv) + '</b></div>'
      + '<div class="l"><span>Dated</span><b>: ' + esc(f.date) + '</b></div>'
      + '<div class="l"><span>Place of Supply</span><b>: ' + esc(f.pos) + '</b></div>'
      + '<div class="l"><span>Reverse Charge</span><b>: ' + esc(f.rcm) + '</b></div></div>'
      + '<div class="meta pad">'
      + '<div class="l"><span>Vehicle No.</span><b>: ' + esc(f.veh) + '</b></div>'
      + '<div class="l"><span>E-Way Bill No.</span><b>: ' + esc(f.eway) + '</b></div></div></div>'
      + '<div class="row b-b"><div class="pcol b-r"><div class="pi">Billed to :</div><div class="pn">' + esc(b.name) + '</div>' + (b.address ? '<div>' + esc(b.address) + '</div>' : '') + '<div style="margin-top:6px">GSTIN / UIN&nbsp;&nbsp;: <b>' + esc(b.gstin || '—') + '</b></div></div>'
      + '<div class="pcol"><div class="pi">Shipped to :</div><div class="pn">' + esc(b.name) + '</div>' + (b.address ? '<div>' + esc(b.address) + '</div>' : '') + '<div style="margin-top:6px">GSTIN / UIN&nbsp;&nbsp;: <b>' + esc(b.gstin || '—') + '</b></div></div></div>'
      + '<table class="items"><tr><th style="width:34px">S.N.</th><th>Description of Goods</th><th style="width:70px">HSN/SAC<br>Code</th><th style="width:52px">Qty.</th><th style="width:52px">Unit</th><th style="width:70px">Price</th><th style="width:92px">Amount(₹)</th></tr>'
      + '<tr><td class="c">1</td><td>' + esc(f.product) + '</td><td class="c">' + esc(f.hsn) + '</td><td class="r">' + f.qty + '</td><td class="c">' + esc(f.unit) + '</td><td class="r">' + f.rate + '</td><td class="r">' + f.taxable + '</td></tr>'
      + '<tr class="spacer"><td class="b-r"></td><td></td><td></td><td></td><td></td><td></td><td class="r" style="vertical-align:bottom">' + f.taxable + '</td></tr></table>'
      + '<div class="b-b">' + taxRows(f, 'tl') + '</div>'
      + '<div class="gt b-b"><span>Grand Total&nbsp;&nbsp;' + f.qty + ' ' + esc(f.unit) + '</span><span>₹ ' + f.grand + '</span></div>'
      + '<table><tr><th>HSN/SAC</th><th>Tax Rate</th><th>Taxable Amt.</th>' + taxSumHead(f) + '<th>Total Tax</th></tr>'
      + '<tr><td class="c">' + esc(f.hsn) + '</td><td class="c">' + f.gstR + '%</td><td class="c">' + f.taxable + '</td>' + taxSumCells(f) + '<td class="c">' + f.totalTax + '</td></tr></table>'
      + '<div class="pad b-b"><b>' + esc(f.words) + '</b></div>'
      + (f.cfg.showDeclaration ? '<div class="decl b-b"><u>Declaration</u><ol>' + f.terms.map(function (t, i) { return '<li>' + (i + 1) + '. ' + esc(t) + '</li>'; }).join('') + '</ol></div>' : '')
      + (bankBlock(f) ? '<div class="bank b-b">' + bankBlock(f) + '</div>' : '')
      + '<div class="row">' + (qrBlock(f) ? '<div class="pad" style="width:120px">' + qrBlock(f) + '</div>' : '')
      + '<div style="flex:1">' + (f.cfg.footerNote ? '<div class="pad" style="font-size:10.5px">' + esc(f.cfg.footerNote) + '</div>' : '')
      + (f.cfg.showSignature ? '<div class="sign">for <b>' + esc(f.signatory) + '</b><div style="margin-top:26px">Authorised Signatory</div></div>' : '') + '</div></div>'
      + '</div>';
    return doc(f, 'classic', css, body);
  }

  /* ══════════════ V1 · glass — premium SaaS ══════════════ */
  function glass(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b, a = f.cfg.accent;
    var css = "body{font-family:" + f.cfg.font + ";color:#0F172A;font-size:11.5px;line-height:1.5;padding:18px;background:linear-gradient(135deg,#EEF2FF 0%,#F8FAFC 40%,#F0F9FF 100%)}"
      + ".inv{max-width:820px;margin:0 auto;border-radius:22px;overflow:hidden;background:rgba(255,255,255,.82);backdrop-filter:blur(18px);box-shadow:0 24px 60px -20px rgba(15,23,42,.28),0 0 0 1px rgba(255,255,255,.6) inset}"
      + ".hd{padding:22px 26px;color:#fff;background:linear-gradient(135deg," + a + " 0%,#1E293B 140%);position:relative;overflow:hidden}"
      + ".hd::after{content:'';position:absolute;top:-70px;right:-40px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.22),transparent 70%)}"
      + ".hd h1{font-size:24px;letter-spacing:-.5px;font-weight:800}.hd .sub{opacity:.9;font-size:11px;margin-top:3px}.hd .g{font-weight:700;margin-top:6px;font-size:11.5px}"
      + ".tag{position:absolute;top:22px;right:26px;background:rgba(255,255,255,.2);padding:5px 12px;border-radius:99px;font-size:10.5px;font-weight:700;letter-spacing:.08em;z-index:1}"
      + ".grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:18px 26px}"
      + ".card{background:rgba(255,255,255,.7);border:1px solid #E2E8F0;border-radius:14px;padding:12px 14px}"
      + ".card h4{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:#64748B;margin-bottom:6px}"
      + ".kv{display:flex;justify-content:space-between;gap:10px;padding:2px 0;font-size:11px}.kv span{color:#64748B}.kv b{font-weight:650}"
      + "table{width:100%;border-collapse:collapse;margin:4px 0}thead th{background:" + a + "12;color:" + a + ";font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;padding:9px 10px;text-align:left;border-bottom:2px solid " + a + "}"
      + "tbody td{padding:11px 10px;border-bottom:1px solid #E2E8F0;font-size:11.5px}.r{text-align:right}.c{text-align:center}"
      + ".tot{margin:0 26px 6px;background:rgba(255,255,255,.7);border:1px solid #E2E8F0;border-radius:14px;padding:12px 14px}"
      + ".tl{display:flex;justify-content:space-between;padding:3px 0;font-size:11.5px}.tl span{color:#64748B}"
      + ".gt{display:flex;justify-content:space-between;margin-top:8px;padding-top:9px;border-top:2px solid #0F172A;font-weight:800;font-size:15px}"
      + ".words{padding:0 26px 10px;font-size:11px;color:#475569;font-style:italic}"
      + ".ft{padding:14px 26px 20px;border-top:1px solid #E2E8F0;display:flex;gap:16px;align-items:flex-start}"
      + ".ft .t{flex:1;font-size:10px;color:#64748B;line-height:1.6}.sign{text-align:right;font-size:11px;min-width:150px}.qr{text-align:center}.qrc{font-size:9px;color:#64748B}";
    var body = '<div class="inv"><div class="hd"><div class="tag">TAX INVOICE</div>'
      + (f.cfg.showLogo && f.cfg.logo ? '<div style="margin-bottom:8px">' + logoImg(f, 38) + '</div>' : '')
      + '<h1>' + esc(s.name) + '</h1><div class="sub">' + esc(s.address || '') + '</div>'
      + '<div class="g">GSTIN ' + esc(s.gstin || '') + (s.email ? ' · ' + esc(s.email) : '') + '</div></div>'
      + '<div class="grid"><div class="card"><h4>Billed to</h4><div style="font-weight:700;font-size:13px">' + esc(b.name) + '</div>'
      + (b.address ? '<div style="color:#64748B;font-size:10.5px;margin-top:2px">' + esc(b.address) + '</div>' : '')
      + '<div class="kv" style="margin-top:6px"><span>GSTIN / UIN</span><b>' + esc(b.gstin || '—') + '</b></div>'
      + '<div class="kv"><span>Place of supply</span><b>' + esc(f.pos) + '</b></div></div>'
      + '<div class="card"><h4>Invoice</h4>'
      + '<div class="kv"><span>Number</span><b>' + esc(f.inv) + '</b></div>'
      + '<div class="kv"><span>Date</span><b>' + esc(f.date) + '</b></div>'
      + '<div class="kv"><span>Reverse charge</span><b>' + esc(f.rcm) + '</b></div>'
      + (f.veh ? '<div class="kv"><span>Vehicle</span><b>' + esc(f.veh) + '</b></div>' : '')
      + (f.eway ? '<div class="kv"><span>E-Way Bill</span><b>' + esc(f.eway) + '</b></div>' : '') + '</div></div>'
      + '<div style="padding:0 26px"><table><thead><tr><th>Description</th><th>HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>'
      + '<tbody><tr><td style="font-weight:600">' + esc(f.product) + '</td><td class="c">' + esc(f.hsn) + '</td><td class="r">' + f.qty + ' ' + esc(f.unit) + '</td><td class="r">' + f.rate + '</td><td class="r">' + f.taxable + '</td></tr></tbody></table></div>'
      + '<div class="tot"><div class="tl"><span>Taxable value</span><b>' + f.taxable + '</b></div>' + taxRows(f, 'tl')
      + '<div class="gt"><span>' + grandLabel(f, 'Grand total') + '</span><span>₹ ' + f.grand + '</span></div></div>'
      + '<div class="words">' + esc(f.words) + '</div>'
      + '<div class="ft">' + qrBlock(f) + '<div class="t">' + (bankBlock(f) ? bankBlock(f) + '<br><br>' : '')
      + (f.cfg.showDeclaration ? f.terms.map(function (t, i) { return (i + 1) + '. ' + esc(t); }).join('<br>') : '')
      + (f.cfg.footerNote ? '<br><br>' + esc(f.cfg.footerNote) : '') + '</div>'
      + (f.cfg.showSignature ? '<div class="sign">for <b>' + esc(f.signatory) + '</b><div style="margin-top:34px;color:#64748B">Authorised Signatory</div></div>' : '') + '</div></div>';
    return doc(f, 'glass', css, body);
  }

  /* ══════════════ V2 · mono — minimal black & white luxury ══════════════ */
  function mono(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b;
    var css = "body{font-family:" + f.cfg.font + ";color:#111;font-size:11px;line-height:1.6;padding:26px;background:#fff}"
      + ".inv{max-width:780px;margin:0 auto}"
      + ".hd{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:2px solid #111}"
      + ".hd h1{font-size:19px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase}"
      + ".hd .a{font-size:10px;color:#555;margin-top:5px;max-width:330px;line-height:1.5}"
      + ".ti{text-align:right}.ti .t{font-size:9.5px;letter-spacing:.28em;text-transform:uppercase;color:#666}.ti .n{font-size:17px;font-weight:600;margin-top:3px}"
      + ".meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:22px;padding:18px 0;border-bottom:1px solid #DDD}"
      + ".meta h4{font-size:8.5px;letter-spacing:.2em;text-transform:uppercase;color:#999;margin-bottom:5px}"
      + ".meta .v{font-size:11px}.meta .v b{font-weight:600}"
      + "table{width:100%;border-collapse:collapse;margin:16px 0}thead th{font-size:8.5px;letter-spacing:.18em;text-transform:uppercase;color:#999;padding:8px 0;text-align:left;border-bottom:1px solid #111;font-weight:400}"
      + "tbody td{padding:14px 0;border-bottom:1px solid #EEE;font-size:11.5px}.r{text-align:right}.c{text-align:center}"
      + ".tot{margin-left:auto;width:290px;padding-top:6px}.tl{display:flex;justify-content:space-between;padding:4px 0;font-size:11px;color:#555}"
      + ".gt{display:flex;justify-content:space-between;margin-top:8px;padding-top:10px;border-top:2px solid #111;font-size:15px;font-weight:600}"
      + ".words{padding:14px 0;font-size:10px;color:#666;letter-spacing:.03em;border-bottom:1px solid #DDD}"
      + ".ft{display:flex;gap:24px;padding-top:18px;font-size:9.5px;color:#666;line-height:1.7}.ft .t{flex:1}"
      + ".sign{text-align:right;min-width:160px;font-size:10.5px;color:#111}.qr{text-align:center}.qrc{font-size:8.5px;color:#999}";
    var body = '<div class="inv"><div class="hd"><div>'
      + (f.cfg.showLogo && f.cfg.logo ? '<div style="margin-bottom:10px">' + logoImg(f, 34) + '</div>' : '')
      + '<h1>' + esc(s.name) + '</h1><div class="a">' + esc(s.address || '') + '</div>'
      + '<div class="a" style="margin-top:4px">GSTIN ' + esc(s.gstin || '') + '</div></div>'
      + '<div class="ti"><div class="t">Tax Invoice</div><div class="n">' + esc(f.inv) + '</div><div class="a" style="margin-top:4px">' + esc(f.date) + '</div></div></div>'
      + '<div class="meta"><div><h4>Billed to</h4><div class="v"><b>' + esc(b.name) + '</b>' + (b.address ? '<br>' + esc(b.address) : '') + '<br>GSTIN ' + esc(b.gstin || '—') + '</div></div>'
      + '<div><h4>Place of supply</h4><div class="v">' + esc(f.pos) + '</div><h4 style="margin-top:10px">Reverse charge</h4><div class="v">' + esc(f.rcm) + '</div></div>'
      + '<div><h4>Despatch</h4><div class="v">' + (f.veh ? esc(f.veh) : '—') + (f.eway ? '<br>E-Way ' + esc(f.eway) : '') + '</div></div></div>'
      + '<table><thead><tr><th>Description</th><th>HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>'
      + '<tbody><tr><td>' + esc(f.product) + '</td><td class="c">' + esc(f.hsn) + '</td><td class="r">' + f.qty + ' ' + esc(f.unit) + '</td><td class="r">' + f.rate + '</td><td class="r">' + f.taxable + '</td></tr></tbody></table>'
      + '<div class="tot"><div class="tl"><span>Taxable value</span><span>' + f.taxable + '</span></div>' + taxRows(f, 'tl')
      + '<div class="gt"><span>' + grandLabel(f, 'Total') + '</span><span>₹ ' + f.grand + '</span></div></div>'
      + '<div class="words">' + esc(f.words) + '</div>'
      + '<div class="ft">' + qrBlock(f) + '<div class="t">' + (bankBlock(f) ? bankBlock(f) + '<br><br>' : '')
      + (f.cfg.showDeclaration ? f.terms.map(function (t, i) { return (i + 1) + '. ' + esc(t); }).join('<br>') : '')
      + (f.cfg.footerNote ? '<br><br>' + esc(f.cfg.footerNote) : '') + '</div>'
      + (f.cfg.showSignature ? '<div class="sign">for <b>' + esc(f.signatory) + '</b><div style="margin-top:40px;color:#999">Authorised Signatory</div></div>' : '') + '</div></div>';
    return doc(f, 'mono', css, body);
  }

  /* ══════════════ V3 · vivid — colourful, brand-forward ══════════════ */
  function vivid(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b, a = f.cfg.accent;
    var css = "body{font-family:" + f.cfg.font + ";color:#1F2937;font-size:11.5px;line-height:1.5;padding:18px;background:#F9FAFB}"
      + ".inv{max-width:820px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px -8px rgba(0,0,0,.12)}"
      + ".band{height:8px;background:linear-gradient(90deg," + a + ",#F59E0B 55%,#10B981)}"
      + ".hd{display:flex;justify-content:space-between;align-items:flex-start;padding:20px 24px;gap:16px}"
      + ".hd h1{font-size:21px;font-weight:800;color:" + a + ";letter-spacing:-.3px}.hd .a{font-size:10.5px;color:#6B7280;margin-top:3px;max-width:340px}"
      + ".chip{display:inline-block;background:" + a + ";color:#fff;padding:6px 14px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.06em}"
      + ".ib{text-align:right}.ib .n{font-size:15px;font-weight:800;margin-top:6px}.ib .d{font-size:10.5px;color:#6B7280}"
      + ".pp{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 24px 16px}"
      + ".pc{border-radius:12px;padding:12px 14px;background:" + a + "0D;border-left:4px solid " + a + "}"
      + ".pc.alt{background:#F3F4F6;border-left-color:#9CA3AF}"
      + ".pc h4{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#6B7280;margin-bottom:5px}"
      + ".pc .n2{font-weight:700;font-size:12.5px}.pc .l{font-size:10.5px;color:#4B5563;margin-top:2px}"
      + "table{width:100%;border-collapse:collapse}thead th{background:" + a + ";color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.05em;padding:10px;text-align:left}"
      + "tbody td{padding:12px 10px;border-bottom:1px solid #F3F4F6;font-size:11.5px}tbody tr:nth-child(even){background:#FAFAFA}.r{text-align:right}.c{text-align:center}"
      + ".tw{display:flex;justify-content:flex-end;padding:12px 24px}.tot{width:300px}"
      + ".tl{display:flex;justify-content:space-between;padding:4px 0;font-size:11.5px;color:#4B5563}"
      + ".gt{display:flex;justify-content:space-between;margin-top:8px;padding:10px 14px;border-radius:10px;background:" + a + ";color:#fff;font-weight:800;font-size:14px}"
      + ".words{margin:0 24px 12px;padding:9px 12px;background:#FFFBEB;border-radius:8px;font-size:10.5px;color:#92400E}"
      + ".ft{padding:14px 24px 20px;background:#F9FAFB;border-top:1px solid #F3F4F6;display:flex;gap:16px}"
      + ".ft .t{flex:1;font-size:9.5px;color:#6B7280;line-height:1.7}.sign{text-align:right;min-width:150px;font-size:11px}.qr{text-align:center}.qrc{font-size:9px;color:#6B7280}";
    var body = '<div class="inv"><div class="band"></div><div class="hd"><div>'
      + (f.cfg.showLogo && f.cfg.logo ? '<div style="margin-bottom:8px">' + logoImg(f, 40) + '</div>' : '')
      + '<h1>' + esc(s.name) + '</h1><div class="a">' + esc(s.address || '') + '</div>'
      + '<div class="a"><b>GSTIN ' + esc(s.gstin || '') + '</b>' + (s.phone ? ' · ' + esc(s.phone) : '') + '</div></div>'
      + '<div class="ib"><span class="chip">TAX INVOICE</span><div class="n">' + esc(f.inv) + '</div><div class="d">' + esc(f.date) + '</div>'
      + '<div class="d">Reverse charge: ' + esc(f.rcm) + '</div></div></div>'
      + '<div class="pp"><div class="pc"><h4>Billed to</h4><div class="n2">' + esc(b.name) + '</div>'
      + (b.address ? '<div class="l">' + esc(b.address) + '</div>' : '')
      + '<div class="l"><b>GSTIN ' + esc(b.gstin || '—') + '</b></div><div class="l">Place of supply: ' + esc(f.pos) + '</div></div>'
      + '<div class="pc alt"><h4>Despatch</h4><div class="n2">' + (f.veh ? esc(f.veh) : '—') + '</div>'
      + (f.eway ? '<div class="l">E-Way Bill: ' + esc(f.eway) + '</div>' : '') + '</div></div>'
      + '<table><thead><tr><th>Description of goods</th><th>HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount (₹)</th></tr></thead>'
      + '<tbody><tr><td style="font-weight:600">' + esc(f.product) + '</td><td class="c">' + esc(f.hsn) + '</td><td class="r">' + f.qty + ' ' + esc(f.unit) + '</td><td class="r">' + f.rate + '</td><td class="r">' + f.taxable + '</td></tr></tbody></table>'
      + '<div class="tw"><div class="tot"><div class="tl"><span>Taxable value</span><b>' + f.taxable + '</b></div>' + taxRows(f, 'tl')
      + '<div class="gt"><span>' + grandLabel(f, 'Grand total') + '</span><span>₹ ' + f.grand + '</span></div></div></div>'
      + '<div class="words"><b>' + esc(f.words) + '</b></div>'
      + '<div class="ft">' + qrBlock(f) + '<div class="t">' + (bankBlock(f) ? bankBlock(f) + '<br><br>' : '')
      + (f.cfg.showDeclaration ? f.terms.map(function (t, i) { return (i + 1) + '. ' + esc(t); }).join('<br>') : '')
      + (f.cfg.footerNote ? '<br><br>' + esc(f.cfg.footerNote) : '') + '</div>'
      + (f.cfg.showSignature ? '<div class="sign">for <b>' + esc(f.signatory) + '</b><div style="margin-top:34px;color:#9CA3AF">Authorised Signatory</div></div>' : '') + '</div></div>';
    return doc(f, 'vivid', css, body);
  }

  var TEMPLATES = [
    { id: 'classic',    name: 'Classic (current)', category: 'Compliance', accentable: false,
      desc: 'The bordered format you issue today. Your customers and your CA already recognise it.', render: classic },
    { id: 'glass',      name: 'Premium Glass',     category: 'Corporate', accentable: true,
      desc: 'Soft gradients and glass cards. For corporate buyers who read invoices on a screen.', render: glass },
    { id: 'mono',       name: 'Minimal Mono',      category: 'Luxury', accentable: false,
      desc: 'Typography only, no colour. Prints beautifully on any printer.', render: mono },
    { id: 'vivid',      name: 'Vivid Business',    category: 'Retail', accentable: true,
      desc: 'Your logo and accent colour up front. Friendly for retail and trade counters.', render: vivid }
  ];

  function get(id) { for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i]; return TEMPLATES[0]; }
  function render(d, cfg) {
    var c = cfgOf(cfg);
    return get(c.template).render(d, c);
  }

  var API = { TEMPLATES: TEMPLATES, DEFAULT_CFG: DEFAULT_CFG, cfgOf: cfgOf, get: get, render: render, facts: facts };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.InvoiceTemplates = API;
})(typeof window !== 'undefined' ? window : globalThis);
