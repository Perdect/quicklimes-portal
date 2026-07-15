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

  /* ══════════════════════════════════════════════════════════════════════
     THE THREE NON-CLASSIC DESIGNS — professional, not decorative.

     Brief, in the user's words: "professional, not fancy", built to what Zoho
     Books and Tally Prime actually print. What that ruled OUT, and why:

       gradients, glass panels, skewed colour slabs, a company name rotated 90°
       up the page edge, tri-colour footer bars

     Those were graphic-design moves on a document that is, in the end, a legal
     demand for money. Decoration on an invoice does not read as premium — it
     reads as less trustworthy, and no CA or cement buyer wants a nameplate
     printed sideways. The craft has to show up as STRUCTURE instead:

       - one restrained accent, used only on the table header and the total
       - real typographic hierarchy (size and weight, not colour and shapes)
       - generous, consistent spacing; everything on a shared grid
       - hairline rules, never heavy boxes-within-boxes
       - the total is the loudest thing on the page, because it is the point

     The three differ in DENSITY and INK, not in ornament — a real choice for a
     real reason, rather than three costumes:
       modern  — the default recommendation; accent header, roomy, screen + PDF
       mono    — identical structure, zero colour; safe on any office laser
       compact — Tally-grade density; fits long invoices on one page
     ══════════════════════════════════════════════════════════════════════ */

  /* Shared skeleton. All three professional templates are the same DOCUMENT with
     different density/ink, so they share one builder — three near-copies would be
     three chances to drift apart, and the compliance test would only tell us
     after the fact. `k` carries the knobs each variant actually differs on. */
  function proDoc(d, cfg, k) {
    var f = facts(d, cfg), s = f.s, b = f.b;
    var a = k.ink === 'none' ? '#111827' : f.cfg.accent;
    var P = k.pad, FS = k.fs;

    var css = "body{font-family:" + f.cfg.font + ";color:#111827;font-size:" + FS + "px;line-height:1.45;padding:0;background:#fff}"
      + ".sheet{max-width:820px;margin:0 auto;padding:" + P + "px}"
      /* Header: logo, company, then the invoice's own identity as a small titled
         block on the right — the shape every accounting package prints. */
      + ".hd{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:" + (P * .55) + "px;border-bottom:2px solid " + a + "}"
      + ".co{display:flex;gap:13px;align-items:flex-start;min-width:0}"
      + ".co h1{font-size:" + (FS + 6.5) + "px;font-weight:700;letter-spacing:-.2px;line-height:1.2;color:#111827}"
      + ".co .tag{font-size:" + (FS - 2.5) + "px;color:#6B7280;margin-top:2px;font-weight:600;letter-spacing:.02em}"
      + ".co .ad{font-size:" + (FS - 1.5) + "px;color:#4B5563;margin-top:5px;line-height:1.45;max-width:330px}"
      + ".co .gs{font-size:" + (FS - 1) + "px;color:#111827;margin-top:4px;font-weight:600}"
      + ".ttl{text-align:right;flex:none}"
      + ".ttl .w{font-size:" + (FS + 4) + "px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:" + a + "}"
      + ".ttl table{border-collapse:collapse;margin-top:7px;margin-left:auto}"
      + ".ttl td{font-size:" + (FS - 1) + "px;padding:2px 0 2px 14px;text-align:right;white-space:nowrap}"
      + ".ttl td:first-child{color:#6B7280;padding-left:0;text-align:left}"
      + ".ttl td b{font-weight:700}"
      /* Parties: two columns separated by whitespace and a hairline, not by boxes. */
      + ".pp{display:grid;grid-template-columns:1fr 1fr;gap:" + (P * .8) + "px;padding:" + (P * .55) + "px 0;border-bottom:1px solid #E5E7EB}"
      + ".pp h4{font-size:" + (FS - 3) + "px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:#9CA3AF;margin-bottom:6px}"
      + ".pp .nm{font-size:" + (FS + 1.5) + "px;font-weight:700;color:#111827}"
      + ".pp .ln{font-size:" + (FS - 1) + "px;color:#4B5563;margin-top:2px;line-height:1.45}"
      + ".kv{display:flex;justify-content:space-between;gap:12px;font-size:" + (FS - 1) + "px;padding:1.5px 0}"
      + ".kv span{color:#6B7280}.kv b{font-weight:600;color:#111827;text-align:right}"
      /* Items: the accent earns its keep once, here. */
      + ".itm{width:100%;border-collapse:collapse;margin-top:" + (P * .55) + "px}"
      + ".itm thead th{background:" + a + ";color:#fff;font-size:" + (FS - 2.5) + "px;font-weight:700;letter-spacing:.06em;"
      +   "text-transform:uppercase;padding:" + k.cell + "px 9px;text-align:left}"
      + ".itm tbody td{padding:" + (k.cell + 3) + "px 9px;border-bottom:1px solid #E5E7EB;font-size:" + FS + "px;vertical-align:top}"
      + ".itm tbody td.d{font-weight:600}"
      + ".r{text-align:right}.c{text-align:center}"
      /* Money: HSN summary left (Rule 46), totals right. The total is the loudest
         thing on the sheet — everything else is quieter than it on purpose. */
      + ".money{display:grid;grid-template-columns:minmax(0,1fr) 268px;gap:" + (P * .8) + "px;padding-top:" + (P * .55) + "px;align-items:start}"
      + ".band{width:100%;border-collapse:collapse;font-size:" + (FS - 2.5) + "px}"
      + ".band th{background:#F9FAFB;color:#6B7280;font-weight:700;text-transform:uppercase;letter-spacing:.05em;"
      +   "padding:5px 7px;text-align:left;border:1px solid #E5E7EB;white-space:nowrap}"
      + ".band td{padding:5px 7px;border:1px solid #E5E7EB;color:#374151}"
      + ".tl{display:flex;justify-content:space-between;padding:4px 0;font-size:" + FS + "px}"
      + ".tl span{color:#6B7280}.tl b{font-weight:600}"
      + ".gt{display:flex;justify-content:space-between;align-items:baseline;margin-top:7px;padding:9px 12px;"
      +   "background:" + (k.ink === 'none' ? '#111827' : a) + ";color:#fff;border-radius:" + k.rad + "px}"
      + ".gt .l{font-size:" + (FS - 2.5) + "px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.92}"
      + ".gt .v{font-size:" + (FS + 6) + "px;font-weight:700;letter-spacing:-.3px}"
      + ".gtq{text-align:right;font-size:" + (FS - 2) + "px;color:#6B7280;margin-top:4px}"
      + ".words{margin-top:" + (P * .5) + "px;padding-top:" + (P * .4) + "px;border-top:1px solid #E5E7EB;font-size:" + (FS - 1) + "px;color:#374151}"
      + ".words b{font-weight:600}"
      + ".ft{display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:" + (P * .8) + "px;margin-top:" + (P * .5) + "px;"
      +   "padding-top:" + (P * .5) + "px;border-top:1px solid #E5E7EB;align-items:start}"
      + ".ft .t{font-size:" + (FS - 2.5) + "px;color:#6B7280;line-height:1.65}"
      + ".ft .t b{color:#374151}"
      + ".sg{text-align:center}.sg .sfor{font-size:" + (FS - 1) + "px;color:#374151}"
      + ".sg .sline{border-bottom:1px solid #9CA3AF;margin:38px 0 5px}"
      + ".sg .scap{font-size:" + (FS - 2.5) + "px;color:#6B7280}"
      + ".qr{text-align:center;margin-bottom:8px}.qrc{font-size:" + (FS - 3) + "px;color:#6B7280}"
      /* The sheet is designed for 820px of A4. It is also shown in the GST Invoice
         page's preview pane, which is roughly half that, and on phones. There,
         minmax(0,1fr) does its job too well: the left track shrinks BELOW the
         rate-band table's own width and the table spills across the totals column
         — the two overlapped and became unreadable. Below the width where the
         two-column money zone stops fitting, stack instead. Print is unaffected:
         @page is A4, always wider than this breakpoint. */
      + "@media screen and (max-width:700px){"
      +   ".money{grid-template-columns:1fr;gap:14px}"
      +   ".ft{grid-template-columns:1fr;gap:14px}"
      +   ".pp{grid-template-columns:1fr;gap:14px}"
      +   ".hd{flex-direction:column;gap:14px}.ttl{text-align:left}.ttl table{margin-left:0}"
      +   ".ttl td{padding-left:0;padding-right:14px;text-align:left}"
      +   ".band{display:block;overflow-x:auto;white-space:nowrap}"
      + "}";

    var body = '<div class="sheet"><div class="hd">'
      + '<div class="co">' + (f.logo ? logoImg(f, k.logo) : '')
      + '<div><h1>' + esc(s.name) + '</h1>'
      + (f.tagline ? '<div class="tag">' + esc(f.tagline) + '</div>' : '')
      + '<div class="ad">' + esc(s.address || '') + '</div>'
      + '<div class="gs">GSTIN ' + esc(s.gstin || '') + '</div>'
      + ((s.phone || s.email) ? '<div class="ad" style="margin-top:2px">' + esc([s.phone, s.email].filter(Boolean).join('  ·  ')) + '</div>' : '')
      + '</div></div>'
      + '<div class="ttl"><div class="w">Tax Invoice</div><table>'
      + '<tr><td>Invoice no.</td><td><b>' + esc(f.inv) + '</b></td></tr>'
      + '<tr><td>Date</td><td><b>' + esc(f.date) + '</b></td></tr>'
      + '<tr><td>Place of supply</td><td><b>' + esc(f.pos) + '</b></td></tr>'
      + '<tr><td>Reverse charge</td><td><b>' + esc(f.rcm) + '</b></td></tr>'
      + '</table></div></div>'
      + '<div class="pp"><div><h4>Bill to</h4><div class="nm">' + esc(b.name) + '</div>'
      + (b.address ? '<div class="ln">' + esc(b.address) + '</div>' : '')
      + '<div class="ln"><b>GSTIN ' + esc(b.gstin || '—') + '</b></div></div>'
      + '<div><h4>Details</h4>'
      + (f.veh ? '<div class="kv"><span>Vehicle no.</span><b>' + esc(f.veh) + '</b></div>' : '')
      + (f.eway ? '<div class="kv"><span>E-Way Bill no.</span><b>' + esc(f.eway) + '</b></div>' : '')
      /* No HSN row here: the code already prints in the line item AND in the
         rate-band summary below. Three copies of one number is the duplication we
         deleted from the summary rail — a "details" block should hold what is not
         already on the page, not repeat what is. */
      + (f.msme ? '<div class="kv"><span>MSME</span><b>' + esc(f.msme) + '</b></div>' : '')
      + '</div></div>'
      + '<table class="itm"><thead><tr><th style="width:30px">#</th><th>Description of goods</th><th style="width:82px">HSN/SAC</th>'
      + '<th class="r" style="width:96px">Qty</th><th class="r" style="width:74px">Rate</th><th class="r" style="width:104px">Amount (₹)</th></tr></thead>'
      + '<tbody><tr><td>1</td><td class="d">' + esc(f.product) + '</td><td>' + esc(f.hsn) + '</td>'
      + '<td class="r">' + f.qty + ' ' + esc(f.unit) + '</td><td class="r">' + f.rate + '</td><td class="r">' + f.taxable + '</td></tr></tbody></table>'
      + '<div class="money"><div>' + bandTable(f, 'band') + '</div>'
      + '<div><div class="tl"><span>Taxable value</span><b>' + f.taxable + '</b></div>' + taxRows(f, 'tl')
      + '<div class="gt"><span class="l">Total</span><span class="v">₹ ' + f.grand + '</span></div>'
      + '<div class="gtq">' + qtyTotalEl(f) + '</div></div></div>'
      + '<div class="words">Amount in words: <b>' + esc(f.words) + '</b></div>'
      + '<div class="ft"><div class="t">' + (bankBlock(f) ? bankBlock(f) + '<br><br>' : '')
      + (f.cfg.showDeclaration ? '<b>Declaration</b><br>' + f.terms.map(function (t, i) { return (i + 1) + '. ' + esc(t); }).join('<br>') : '')
      + (f.cfg.footerNote ? '<br><br>' + esc(f.cfg.footerNote) : '') + '</div>'
      + '<div>' + qrBlock(f) + signBlock(f, 'sg') + '</div></div></div>';

    return doc(f, k.id, css, body);
  }

  /* modern — the recommendation. Roomy, one accent, reads well on screen and PDF. */
  function modern(d, cfg) { return proDoc(d, cfg, { id: 'modern', pad: 34, fs: 11.5, cell: 9, rad: 8, logo: 46, ink: 'accent' }); }

  /* mono — same document, no colour at all. A cheap office laser renders a mid
     blue as muddy grey; this one is designed for that printer instead of fighting
     it, so it looks intentional in black and white rather than drained. */
  function mono(d, cfg) { return proDoc(d, cfg, { id: 'mono', pad: 34, fs: 11.5, cell: 9, rad: 0, logo: 44, ink: 'none' }); }

  /* compact — Tally-grade density. Same structure, tighter everything, for firms
     that want the whole invoice on one page without a second sheet. */
  function compact(d, cfg) { return proDoc(d, cfg, { id: 'compact', pad: 24, fs: 10.5, cell: 6, rad: 4, logo: 38, ink: 'accent' }); }

  var TEMPLATES = [
    { id: 'classic', name: 'Classic (current)', category: 'In use now', accentable: false,
      desc: 'The bordered format you issue today. Your customers and your CA already recognise it.', render: classic },
    { id: 'modern',  name: 'Modern',           category: 'Recommended', accentable: true,
      desc: 'What Zoho Books and Tally Prime print. Clean structure, one accent colour, no decoration.', render: modern },
    { id: 'mono',    name: 'Monochrome',       category: 'Any printer', accentable: false,
      desc: 'The same document with no colour at all. Designed for a plain office laser.', render: mono },
    { id: 'compact', name: 'Compact',          category: 'Dense', accentable: true,
      desc: 'Tally-grade density. Same structure, tighter — keeps long invoices on one page.', render: compact }
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
