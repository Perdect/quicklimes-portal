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
      /* The firm's own identity, straight off the company profile. The templates
         used to read only cfg.logo — which nobody sets — so Gotan's actual logo
         (COMPANIES[].logo → seller.logo) never rendered and every design came out
         anonymous. cfg.logo now only OVERRIDES; the company's own is the default.
         Same for the tagline and MSME number: they are already on the profile and
         already on the paper invoice, so a design that omits them is a downgrade. */
      logo: cfg.showLogo === false ? '' : (cfg.logo || s.logo || ''),
      tagline: s.product || '',
      msme: s.msme || '',
      jurisdiction: s.jurisdiction || '',
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
      /* The default declaration is what Gotan's paper invoice actually prints —
         MSME registration FIRST, then the three standard clauses. I had shipped
         only the three and silently dropped the MSME line; the compliance test
         caught it. An MSME registration on the invoice is not decoration: it is
         what puts a buyer on the clock under the MSMED Act's 45-day payment rule.
         Templates number the list themselves, so dropping the line when a firm has
         no MSME number renumbers cleanly — same as the original renderer did. */
      terms: (cfg.terms && cfg.terms.length) ? cfg.terms
        : (s.msme ? ['REGISTERED IN MSME NO. ' + s.msme] : []).concat([
          'Supply of goods under RULE 46 OF CGST RULE 2017.',
          'No complaint will be entertained after 10 Days from the Date.',
          'Interest at 18% per annum will be charged for amount not paid in time'
        ])
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

  /* The quantity total carries a class naming what it IS, not how it looks.
     Without it the compliance check had to pattern-match "Total ... 10,000 Tonne"
     against raw HTML, which (a) broke the moment a design moved the figure out of
     the total's own line and (b) could be satisfied by the LINE ITEM cell, which
     prints the same string — a mutation deleting the total once passed because of
     exactly that. Marking the element lets the test ask the real question:
     "is the quantity total present in the totals block?" */
  function qtyTotalEl(f, cls) { return '<span class="qtytot' + (cls ? ' ' + cls : '') + '">' + esc(qtyTotal(f)) + '</span>'; }

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
  function logoImg(f, h, extra) {
    if (!f.logo) return '';
    return '<img src="' + esc(f.logo) + '" alt="' + esc(f.s.short || f.s.name) + '" style="height:' + (h || 44) + 'px;width:auto;max-width:190px;object-fit:contain;' + (extra || '') + '">';
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
      + (f.logo ? '<div style="position:absolute;top:8px;left:12px">' + logoImg(f, 62) + '</div>' : '')
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
      + '<div class="gt b-b"><span>Grand Total&nbsp;&nbsp;' + qtyTotalEl(f) + '</span><span>₹ ' + f.grand + '</span></div>'
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

  /* ── shared design furniture ──
     The rate-band summary (HSN · rate · taxable · tax) is the GST equivalent of
     the TAUX/BASE/MONTANT block on the reference invoices, and it is also the
     Rule 46 HSN summary — one element serving the design AND the law. */
  function bandTable(f, cls) {
    return '<table class="' + cls + '"><thead><tr><th>HSN/SAC</th><th>Rate</th><th>Taxable</th>' + taxSumHead(f) + '<th>Total tax</th></tr></thead>'
      + '<tbody><tr><td>' + esc(f.hsn) + '</td><td>' + f.gstR + '%</td><td>' + f.taxable + '</td>' + taxSumCells(f) + '<td>' + f.totalTax + '</td></tr></tbody></table>';
  }
  /* A signature block with an actual RULE to sign above — the reference invoices
     all have one; an "Authorised Signatory" caption floating in space does not
     read as a place to sign. */
  function signBlock(f, cls) {
    if (!f.cfg.showSignature) return '';
    return '<div class="' + cls + '"><div class="sfor">for <b>' + esc(f.signatory) + '</b></div><div class="sline"></div><div class="scap">Authorised Signatory</div></div>';
  }

  /* ══════════════ V1 · glass — premium SaaS ══════════════ */
  function glass(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b, a = f.cfg.accent;
    var css = "body{font-family:" + f.cfg.font + ";color:#0F172A;font-size:11.5px;line-height:1.5;padding:16px;background:linear-gradient(140deg,#EEF2FF 0%,#F8FAFC 45%,#ECFEFF 100%)}"
      + ".inv{max-width:820px;margin:0 auto;border-radius:20px;overflow:hidden;background:#fff;box-shadow:0 24px 60px -22px rgba(15,23,42,.3)}"
      /* Header: a real graphic device — deep gradient, a light sweep, and the logo
         on its own white tile so a dark logo never disappears into a dark header. */
      + ".hd{padding:24px 28px 22px;color:#fff;background:linear-gradient(125deg," + a + " 0%,#111C3A 130%);position:relative;overflow:hidden}"
      + ".hd::after{content:'';position:absolute;top:-90px;right:-60px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.20),transparent 68%)}"
      + ".hd::before{content:'';position:absolute;left:-40px;bottom:-120px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.09),transparent 70%)}"
      /* The header is a flex ROW, not a block with an absolutely-positioned stamp.
         Absolute took the stamp out of flow, so the moment the address wrapped to
         a second line the two collided — and Gotan's address is long enough that
         it always would. min-width:0 lets the middle column actually shrink. */
      + ".hrow{display:flex;gap:16px;align-items:flex-start;position:relative;z-index:1}"
      + ".ltile{background:#fff;border-radius:12px;padding:8px 10px;flex:none;box-shadow:0 6px 18px -6px rgba(0,0,0,.4)}"
      + ".cinfo{flex:1;min-width:0}"
      + ".hd h1{font-size:22px;letter-spacing:-.4px;font-weight:800;line-height:1.15}"
      + ".hd .tl2{font-size:9px;letter-spacing:.12em;text-transform:uppercase;opacity:.82;margin-top:4px;font-weight:600}"
      + ".hd .sub{opacity:.86;font-size:10.5px;margin-top:6px;line-height:1.45}"
      + ".hd .g{font-weight:700;margin-top:5px;font-size:10.5px;word-break:break-word}"
      + ".stamp{text-align:right;flex:none;max-width:170px}"
      + ".stamp .p{display:inline-block;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);padding:5px 13px;border-radius:99px;font-size:10px;font-weight:700;letter-spacing:.1em;white-space:nowrap}"
      + ".stamp .no{font-size:16px;font-weight:800;margin-top:8px;letter-spacing:-.3px}.stamp .dt{font-size:10.5px;opacity:.85}"
      + ".grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:20px 28px 14px}"
      + ".card{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:14px;padding:13px 15px}"
      + ".card h4{font-size:9px;text-transform:uppercase;letter-spacing:.11em;color:" + a + ";margin-bottom:7px;font-weight:800}"
      + ".kv{display:flex;justify-content:space-between;gap:10px;padding:2.5px 0;font-size:11px}.kv span{color:#64748B}.kv b{font-weight:650}"
      + ".itm{width:100%;border-collapse:collapse}"
      + ".itm thead th{background:" + a + ";color:#fff;font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;padding:10px;text-align:left}"
      + ".itm thead th:first-child{border-radius:9px 0 0 9px}.itm thead th:last-child{border-radius:0 9px 9px 0}"
      + ".itm tbody td{padding:13px 10px;border-bottom:1px solid #EEF2F7;font-size:11.5px}"
      + ".r{text-align:right}.c{text-align:center}"
      /* Money zone: breakdown left, the ONE number that matters in a filled block
         on the right — the "NET À PAYER" idea from the reference.
         minmax(0,1fr), not 1fr: a grid track defaults to min-width:auto, so the
         wide rate-band table refused to shrink and shoved the totals column clean
         off the page — the figures were CUT OFF at the card edge. */
      + ".money{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:16px;padding:14px 28px 4px;align-items:start}"
      + ".band{width:100%;border-collapse:collapse;font-size:10px}"
      + ".band thead th{background:#F1F5F9;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:6px 8px;text-align:left;border:1px solid #E2E8F0}"
      + ".band tbody td{padding:6px 8px;border:1px solid #E2E8F0;color:#334155}"
      + ".tot{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:14px;padding:12px 14px}"
      + ".tl{display:flex;justify-content:space-between;padding:3px 0;font-size:11.5px}.tl span{color:#64748B}"
      + ".due{margin-top:10px;border-radius:12px;padding:12px 14px;color:#fff;background:linear-gradient(125deg," + a + ",#111C3A 150%)}"
      + ".due .l{font-size:9px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;font-weight:700}"
      + ".due .v{font-size:20px;font-weight:800;letter-spacing:-.5px;margin-top:2px}.due .q{font-size:10px;opacity:.85;margin-top:2px}"
      + ".words{margin:12px 28px 0;padding:9px 13px;background:#F8FAFC;border-left:3px solid " + a + ";border-radius:0 8px 8px 0;font-size:10.5px;color:#475569}"
      + ".ft{margin-top:14px;padding:15px 28px 20px;background:#F8FAFC;border-top:1px solid #E2E8F0;display:flex;gap:18px;align-items:flex-start}"
      + ".ft .t{flex:1;font-size:9.5px;color:#64748B;line-height:1.7}"
      + ".sg{text-align:center;min-width:165px;flex:none}.sg .sfor{font-size:10.5px;color:#334155}"
      + ".sg .sline{border-bottom:1px solid #94A3B8;margin:34px 0 5px}.sg .scap{font-size:9.5px;color:#64748B}"
      + ".qr{text-align:center;flex:none}.qrc{font-size:9px;color:#64748B;margin-top:2px}";
    var body = '<div class="inv"><div class="hd">'
      + '<div class="hrow">' + (f.logo ? '<div class="ltile">' + logoImg(f, 46) + '</div>' : '')
      + '<div class="cinfo"><h1>' + esc(s.name) + '</h1>'
      + (f.tagline ? '<div class="tl2">' + esc(f.tagline) + '</div>' : '')
      + '<div class="sub">' + esc(s.address || '') + '</div>'
      + '<div class="g">GSTIN ' + esc(s.gstin || '') + (s.phone ? ' · ' + esc(s.phone) : '') + (s.email ? ' · ' + esc(s.email) : '') + '</div></div>'
      + '<div class="stamp"><span class="p">TAX INVOICE</span><div class="no">' + esc(f.inv) + '</div><div class="dt">' + esc(f.date) + '</div></div>'
      + '</div></div>'
      + '<div class="grid"><div class="card"><h4>Billed to</h4><div style="font-weight:700;font-size:13.5px">' + esc(b.name) + '</div>'
      + (b.address ? '<div style="color:#64748B;font-size:10.5px;margin:2px 0 6px">' + esc(b.address) + '</div>' : '<div style="height:6px"></div>')
      + '<div class="kv"><span>GSTIN / UIN</span><b>' + esc(b.gstin || '—') + '</b></div>'
      + '<div class="kv"><span>Place of supply</span><b>' + esc(f.pos) + '</b></div></div>'
      + '<div class="card"><h4>Invoice details</h4>'
      + '<div class="kv"><span>Reverse charge</span><b>' + esc(f.rcm) + '</b></div>'
      + (f.veh ? '<div class="kv"><span>Vehicle</span><b>' + esc(f.veh) + '</b></div>' : '')
      + (f.eway ? '<div class="kv"><span>E-Way Bill</span><b>' + esc(f.eway) + '</b></div>' : '')
      + (f.msme ? '<div class="kv"><span>MSME</span><b>' + esc(f.msme) + '</b></div>' : '') + '</div></div>'
      + '<div style="padding:0 28px"><table class="itm"><thead><tr><th>Description of goods</th><th>HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount (₹)</th></tr></thead>'
      + '<tbody><tr><td style="font-weight:600">' + esc(f.product) + '</td><td class="c">' + esc(f.hsn) + '</td><td class="r">' + f.qty + ' ' + esc(f.unit) + '</td><td class="r">' + f.rate + '</td><td class="r">' + f.taxable + '</td></tr></tbody></table></div>'
      + '<div class="money"><div>' + bandTable(f, 'band') + '</div>'
      + '<div><div class="tot"><div class="tl"><span>Taxable value</span><b>' + f.taxable + '</b></div>' + taxRows(f, 'tl') + '</div>'
      + '<div class="due"><div class="l">Amount payable</div><div class="v">₹ ' + f.grand + '</div><div class="q">' + qtyTotalEl(f) + '</div></div></div></div>'
      + '<div class="words">' + esc(f.words) + '</div>'
      + '<div class="ft">' + qrBlock(f) + '<div class="t">' + (bankBlock(f) ? bankBlock(f) + '<br><br>' : '')
      + (f.cfg.showDeclaration ? f.terms.map(function (t, i) { return (i + 1) + '. ' + esc(t); }).join('<br>') : '')
      + (f.cfg.footerNote ? '<br><br>' + esc(f.cfg.footerNote) : '') + '</div>'
      + signBlock(f, 'sg') + '</div></div>';
    return doc(f, 'glass', css, body);
  }

  /* ══════════════ V2 · mono — minimal black & white luxury ══════════════ */
  function mono(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b;
    /* The nameplate runs vertically up the left edge (the Adam Kozel device) and
       the figures are monospaced so columns align on the digit. Both are strong
       moves that spend no colour — which is the whole point of this template:
       it must look deliberate on the cheapest office laser printer. */
    var css = "body{font-family:" + f.cfg.font + ";color:#111;font-size:11px;line-height:1.6;padding:0;background:#fff}"
      + ".sheet{max-width:840px;margin:0 auto;display:flex;min-height:1040px}"
      + ".rail{width:62px;flex:none;border-right:1px solid #111;padding:26px 0 26px;display:flex;flex-direction:column;align-items:center;justify-content:space-between}"
      + ".plate{writing-mode:vertical-rl;transform:rotate(180deg);font-size:19px;font-weight:700;letter-spacing:5px;text-transform:uppercase;white-space:nowrap}"
      + ".railg{writing-mode:vertical-rl;transform:rotate(180deg);font-family:'Courier New',monospace;font-size:8.5px;letter-spacing:2px;color:#999}"
      + ".main{flex:1;padding:26px 30px}"
      + ".hd{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}"
      + ".hd .a{font-size:10px;color:#555;margin-top:6px;max-width:340px;line-height:1.5}"
      + ".hd .tag{font-size:8.5px;letter-spacing:.24em;text-transform:uppercase;color:#111;margin-top:8px;font-weight:700}"
      + ".ti{text-align:right;flex:none}.ti .t{font-size:26px;font-weight:700;letter-spacing:-.5px}"
      + ".ti .n{font-family:'Courier New',monospace;font-size:14px;margin-top:2px}.ti .d{font-size:10px;color:#666;margin-top:2px}"
      + ".band0{background:#F4F4F5;margin:22px -30px 0;padding:18px 30px;display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:22px}"
      + "h4{font-size:8px;letter-spacing:.22em;text-transform:uppercase;color:#999;margin-bottom:6px;font-weight:400}"
      + ".v{font-size:11px}.v b{font-weight:700;font-size:13px}.mono{font-family:'Courier New',monospace}"
      + "table.itm{width:100%;border-collapse:collapse;margin:24px 0 0}"
      + ".itm thead th{font-size:8px;letter-spacing:.2em;text-transform:uppercase;color:#999;padding:9px 0;text-align:left;border-bottom:1px solid #111;font-weight:400}"
      + ".itm tbody td{padding:15px 0;border-bottom:1px solid #EEE;font-size:11.5px}"
      + ".r{text-align:right}.c{text-align:center}"
      + ".money{display:flex;justify-content:space-between;gap:30px;margin-top:20px;align-items:flex-start}.money>div:first-child{min-width:0;overflow:hidden}"
      + ".band{border-collapse:collapse;font-size:9px;font-family:'Courier New',monospace}"
      + ".band th{text-align:left;color:#999;font-weight:400;padding:5px 10px 5px 0;border-bottom:1px solid #DDD;letter-spacing:.1em;text-transform:uppercase}"
      + ".band td{padding:5px 10px 5px 0;border-bottom:1px solid #F0F0F0}"
      + ".tot{width:280px;flex:none}"
      + ".tl{display:flex;justify-content:space-between;padding:4px 0;font-size:11px;color:#555}.tl b,.tl span:last-child{font-family:'Courier New',monospace;color:#111}"
      + ".gt{margin-top:10px;padding:12px 14px;background:#111;color:#fff;display:flex;justify-content:space-between;align-items:baseline}"
      + ".gt .l{font-size:8.5px;letter-spacing:.2em;text-transform:uppercase;opacity:.75}"
      + ".gt .v2{font-size:18px;font-weight:700;font-family:'Courier New',monospace}"
      + ".gtq{text-align:right;font-size:9px;color:#666;margin-top:5px;letter-spacing:.05em}"
      + ".words{margin-top:20px;padding:12px 0;border-top:1px solid #DDD;border-bottom:1px solid #DDD;font-size:10px;color:#666;letter-spacing:.04em}"
      + ".ft{display:flex;gap:26px;padding-top:20px;font-size:9.5px;color:#666;line-height:1.7;align-items:flex-start}.ft .t{flex:1}"
      + ".sg{text-align:center;min-width:170px;flex:none;color:#111}.sg .sfor{font-size:10.5px}"
      + ".sg .sline{border-bottom:1px solid #111;margin:38px 0 5px}.sg .scap{font-size:9px;color:#999;letter-spacing:.1em;text-transform:uppercase}"
      + ".qr{text-align:center;flex:none}.qrc{font-size:8.5px;color:#999}";
    var body = '<div class="sheet"><div class="rail">'
      + '<div class="plate">' + esc(s.short || s.name) + '</div>'
      + (s.gstin ? '<div class="railg">GSTIN ' + esc(s.gstin) + '</div>' : '<div></div>') + '</div>'
      + '<div class="main"><div class="hd"><div>'
      + (f.logo ? '<div style="margin-bottom:12px">' + logoImg(f, 40) + '</div>' : '')
      + '<div style="font-size:15px;font-weight:700;letter-spacing:1px">' + esc(s.name) + '</div>'
      + '<div class="a">' + esc(s.address || '') + '</div>'
      + '<div class="a mono">GSTIN ' + esc(s.gstin || '') + (s.email ? '<br>' + esc(s.email) : '') + '</div>'
      + (f.tagline ? '<div class="tag">' + esc(f.tagline) + '</div>' : '') + '</div>'
      + '<div class="ti"><div class="t">Invoice</div><div class="n">' + esc(f.inv) + '</div><div class="d">' + esc(f.date) + '</div></div></div>'
      + '<div class="band0"><div><h4>Billed to</h4><div class="v"><b>' + esc(b.name) + '</b>'
      + (b.address ? '<br>' + esc(b.address) : '') + '<br><span class="mono">GSTIN ' + esc(b.gstin || '—') + '</span></div></div>'
      + '<div><h4>Place of supply</h4><div class="v">' + esc(f.pos) + '</div>'
      + '<h4 style="margin-top:12px">Reverse charge</h4><div class="v">' + esc(f.rcm) + '</div></div>'
      + '<div><h4>Despatch</h4><div class="v mono">' + (f.veh ? esc(f.veh) : '—') + (f.eway ? '<br>E-Way ' + esc(f.eway) : '') + '</div>'
      + (f.msme ? '<h4 style="margin-top:12px">MSME</h4><div class="v mono">' + esc(f.msme) + '</div>' : '') + '</div></div>'
      + '<table class="itm"><thead><tr><th>Description</th><th>HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>'
      + '<tbody><tr><td style="font-weight:600">' + esc(f.product) + '</td><td class="c mono">' + esc(f.hsn) + '</td><td class="r mono">' + f.qty + ' ' + esc(f.unit) + '</td><td class="r mono">' + f.rate + '</td><td class="r mono">' + f.taxable + '</td></tr></tbody></table>'
      + '<div class="money"><div>' + bandTable(f, 'band') + '</div>'
      + '<div class="tot"><div class="tl"><span>Taxable value</span><span>' + f.taxable + '</span></div>' + taxRows(f, 'tl')
      + '<div class="gt"><span class="l">Amount payable</span><span class="v2">₹ ' + f.grand + '</span></div>'
      + '<div class="gtq">' + qtyTotalEl(f) + '</div></div></div>'
      + '<div class="words">' + esc(f.words) + '</div>'
      + '<div class="ft">' + qrBlock(f) + '<div class="t">' + (bankBlock(f) ? bankBlock(f) + '<br><br>' : '')
      + (f.cfg.showDeclaration ? f.terms.map(function (t, i) { return (i + 1) + '. ' + esc(t); }).join('<br>') : '')
      + (f.cfg.footerNote ? '<br><br>' + esc(f.cfg.footerNote) : '') + '</div>'
      + signBlock(f, 'sg') + '</div></div></div>';
    return doc(f, 'mono', css, body);
  }

  /* ══════════════ V3 · vivid — colourful, brand-forward ══════════════ */
  function vivid(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b, a = f.cfg.accent;
    /* The angled banner + oversized INVOICE wordmark is the Johan Samit device;
       the tri-colour foot is from the purple reference. Both are drawn with plain
       CSS shapes rather than images, so they survive a PDF export. */
    var css = "body{font-family:" + f.cfg.font + ";color:#1F2937;font-size:11.5px;line-height:1.5;padding:16px;background:#F3F4F6}"
      + ".inv{max-width:820px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 10px 34px -10px rgba(0,0,0,.16)}"
      /* Angled banner: a skewed accent slab behind the company block. */
      + ".hd{position:relative;padding:24px 26px 20px;overflow:hidden;background:#fff}"
      + ".slab{position:absolute;top:0;left:0;width:62%;height:100%;background:linear-gradient(100deg," + a + " 0%," + a + "D9 100%);transform:skewX(-11deg);transform-origin:top left;margin-left:-40px}"
      + ".slab2{position:absolute;top:0;left:58%;width:10px;height:100%;background:" + a + "33;transform:skewX(-11deg)}"
      + ".hrow{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:flex-start;gap:18px}"
      + ".cob{color:#fff;max-width:60%}"
      + ".ltile{background:#fff;border-radius:9px;padding:6px 9px;display:inline-block;margin-bottom:9px}"
      + ".cob h1{font-size:19px;font-weight:800;letter-spacing:-.2px;line-height:1.2}"
      + ".cob .tl2{font-size:8.5px;letter-spacing:.13em;text-transform:uppercase;opacity:.9;margin-top:4px;font-weight:700}"
      + ".cob .a{font-size:10px;opacity:.92;margin-top:6px;line-height:1.45}"
      + ".cob .g{font-size:10.5px;font-weight:700;margin-top:4px}"
      + ".wm{text-align:right;flex:none;padding-top:4px}"
      + ".wm .big{font-size:34px;font-weight:800;letter-spacing:-1px;color:#111827;line-height:1}"
      + ".wm .n{font-size:12.5px;font-weight:700;margin-top:6px;color:#111827}.wm .d{font-size:10.5px;color:#6B7280}"
      + ".pp{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:18px 26px 14px}"
      + ".pc{border-radius:11px;padding:12px 14px;background:" + a + "0F;border-left:4px solid " + a + "}"
      + ".pc.alt{background:#F3F4F6;border-left-color:#9CA3AF}"
      + ".pc h4{font-size:8.5px;text-transform:uppercase;letter-spacing:.11em;color:#6B7280;margin-bottom:5px;font-weight:800}"
      + ".pc .n2{font-weight:700;font-size:13px}.pc .l{font-size:10.5px;color:#4B5563;margin-top:2px}"
      + ".itm{width:100%;border-collapse:collapse}"
      + ".itm thead th{background:" + a + ";color:#fff;font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;padding:11px 10px;text-align:left}"
      + ".itm tbody td{padding:13px 10px;border-bottom:1px solid #F3F4F6;font-size:11.5px}"
      + ".itm tbody tr:nth-child(even){background:" + a + "08}"
      + ".r{text-align:right}.c{text-align:center}"
      + ".money{display:grid;grid-template-columns:minmax(0,1fr) 285px;gap:16px;padding:16px 26px 6px;align-items:start}"
      + ".band{width:100%;border-collapse:collapse;font-size:9.5px}"
      + ".band thead th{background:#F3F4F6;color:#6B7280;font-weight:800;text-transform:uppercase;letter-spacing:.05em;padding:6px 8px;text-align:left;border:1px solid #E5E7EB}"
      + ".band tbody td{padding:6px 8px;border:1px solid #E5E7EB;color:#374151}"
      + ".tl{display:flex;justify-content:space-between;padding:4px 0;font-size:11.5px;color:#4B5563}"
      + ".gt{margin-top:9px;padding:12px 15px;border-radius:11px;background:" + a + ";color:#fff}"
      + ".gt .l{font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;opacity:.9;font-weight:800}"
      + ".gt .v{font-size:20px;font-weight:800;letter-spacing:-.5px;margin-top:1px}.gt .q{font-size:10px;opacity:.9}"
      + ".words{margin:12px 26px 0;padding:9px 13px;background:#FFFBEB;border-left:3px solid #F59E0B;border-radius:0 8px 8px 0;font-size:10.5px;color:#92400E}"
      + ".ft{margin-top:14px;padding:15px 26px 18px;background:#FAFAFA;border-top:1px solid #F3F4F6;display:flex;gap:18px;align-items:flex-start}"
      + ".ft .t{flex:1;font-size:9.5px;color:#6B7280;line-height:1.7}"
      + ".sg{text-align:center;min-width:165px;flex:none}.sg .sfor{font-size:10.5px;color:#374151}"
      + ".sg .sline{border-bottom:1px solid #9CA3AF;margin:34px 0 5px}.sg .scap{font-size:9.5px;color:#6B7280}"
      + ".qr{text-align:center;flex:none}.qrc{font-size:9px;color:#6B7280}"
      + ".foot3{display:flex;height:9px}.foot3 i{flex:1}.foot3 i:nth-child(1){background:" + a + "}.foot3 i:nth-child(2){background:#EC4899}.foot3 i:nth-child(3){background:#F59E0B}";
    var body = '<div class="inv"><div class="hd"><div class="slab"></div><div class="slab2"></div>'
      + '<div class="hrow"><div class="cob">'
      + (f.logo ? '<div class="ltile">' + logoImg(f, 38) + '</div>' : '')
      + '<h1>' + esc(s.name) + '</h1>'
      + (f.tagline ? '<div class="tl2">' + esc(f.tagline) + '</div>' : '')
      + '<div class="a">' + esc(s.address || '') + '</div>'
      + '<div class="g">GSTIN ' + esc(s.gstin || '') + (s.phone ? ' · ' + esc(s.phone) : '') + '</div></div>'
      + '<div class="wm"><div class="big">INVOICE</div><div class="n">' + esc(f.inv) + '</div><div class="d">' + esc(f.date) + '</div>'
      + '<div class="d">Reverse charge: ' + esc(f.rcm) + '</div></div></div></div>'
      + '<div class="pp"><div class="pc"><h4>Billed to</h4><div class="n2">' + esc(b.name) + '</div>'
      + (b.address ? '<div class="l">' + esc(b.address) + '</div>' : '')
      + '<div class="l"><b>GSTIN ' + esc(b.gstin || '—') + '</b></div><div class="l">Place of supply: ' + esc(f.pos) + '</div></div>'
      + '<div class="pc alt"><h4>Despatch</h4><div class="n2">' + (f.veh ? esc(f.veh) : '—') + '</div>'
      + (f.eway ? '<div class="l">E-Way Bill: ' + esc(f.eway) + '</div>' : '')
      + (f.msme ? '<div class="l">MSME: ' + esc(f.msme) + '</div>' : '') + '</div></div>'
      + '<table class="itm"><thead><tr><th>Description of goods</th><th>HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount (₹)</th></tr></thead>'
      + '<tbody><tr><td style="font-weight:600">' + esc(f.product) + '</td><td class="c">' + esc(f.hsn) + '</td><td class="r">' + f.qty + ' ' + esc(f.unit) + '</td><td class="r">' + f.rate + '</td><td class="r">' + f.taxable + '</td></tr></tbody></table>'
      + '<div class="money"><div>' + bandTable(f, 'band') + '</div>'
      + '<div><div class="tl"><span>Taxable value</span><b>' + f.taxable + '</b></div>' + taxRows(f, 'tl')
      + '<div class="gt"><div class="l">Total amount</div><div class="v">₹ ' + f.grand + '</div><div class="q">' + qtyTotalEl(f) + '</div></div></div></div>'
      + '<div class="words"><b>' + esc(f.words) + '</b></div>'
      + '<div class="ft">' + qrBlock(f) + '<div class="t">' + (bankBlock(f) ? bankBlock(f) + '<br><br>' : '')
      + (f.cfg.showDeclaration ? f.terms.map(function (t, i) { return (i + 1) + '. ' + esc(t); }).join('<br>') : '')
      + (f.cfg.footerNote ? '<br><br>' + esc(f.cfg.footerNote) : '') + '</div>'
      + signBlock(f, 'sg') + '</div>'
      + '<div class="foot3"><i></i><i></i><i></i></div></div>';
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
