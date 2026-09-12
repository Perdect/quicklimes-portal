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

   THE DEFAULT IS `gst` — the firm's own Tally/Busy print format, built line for
   line from the invoice it actually issues (see the gst() comment). The old
   `classic` design, a loose rendering of Gotan's paper, was removed on
   2026-09-12 at the owner's instruction ("very bad design"); both firms now
   print the same format from their own profile data, and gst is TEMPLATES[0],
   the fallback for any unknown or retired id.

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
    template: 'gst',
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
      /* The full despatch block and the party contact lines. Only the `gst`
         print format shows them; the others read what they always read. */
      transport: d.transport || '', station: d.station || '', grrr: d.grrr || '',
      tel: s.tel || s.phone || '',
      iec: s.iec || '', cin: s.cin || '', lut: s.lut || '', pan: (String(s.gstin || '').length === 15 ? String(s.gstin).slice(2, 12) : ''),
      bPhone: b.phone || '', bEmail: b.email || '', bState: b.state || '',
      signatory: cfg.signatory || s.name || '',
      /* The default declaration is what Gotan's paper invoice actually prints —
         MSME registration FIRST, then the three standard clauses. I had shipped
         only the three and silently dropped the MSME line; the compliance test
         caught it. An MSME registration on the invoice is not decoration: it is
         what puts a buyer on the clock under the MSMED Act's 45-day payment rule.
         Templates number the list themselves, so dropping the line when a firm has
         no MSME number renumbers cleanly — same as the original renderer did. */
      terms: (cfg.terms && cfg.terms.length) ? cfg.terms
        : (s.terms && s.terms.length) ? s.terms.slice()   // the firm's own, off its profile
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
    var src = (f.logo.charAt(0) === '/' && typeof location !== 'undefined' && location.origin && /^https?:/.test(location.origin)) ? location.origin + f.logo : f.logo;
    return '<img src="' + esc(src) + '" alt="' + esc(f.s.short || f.s.name) + '" style="height:' + (h || 44) + 'px;width:auto;max-width:190px;object-fit:contain;' + (extra || '') + '">';
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

  /* ══════════ gst — the firm's own print format, line for line ══════════
     Built against Deshwali Minerals' issued invoice no. 36 of 01-08-2026, the
     way a customer and a CA actually receive it from the billing software:
     "GST INVOICE" · logo left, "Original Copy" right · name / address / GSTIN /
     Tel. / tagline · a two-column despatch block (Invoice No., Dated, Place of
     Supply, Reverse Charge, GR/RR | Transport, Vehicle, Station, E-Way) · Billed
     to / Shipped to with Party E-Mail, Party Mobile, State, GSTIN · the goods
     table · "Add : CGST @ 2.50 %" rows · Grand Total with the tonnage · the HSN
     tax summary · the amount in words WITH paise · Bank Details · Terms &
     Conditions with E.&O.E. · Receiver's Signature / Authorised Signatory.

     ALIGNMENT IS THE DESIGN. Every value column here is a real table column with
     a fixed width, and the tax rows and Grand Total reuse the goods table's
     colgroup — so "@ 2.50 %" sits in the Price column and every amount is flush
     under "Amount(₹)", the way the original lines up. Flexbox rows that merely
     look aligned drift the moment a number is one digit longer. */
  function gst(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b;
    var FONT = "Verdana, Geneva, Tahoma, 'DejaVu Sans', Arial, sans-serif";
    var css = "body{font-family:" + FONT + ";color:#000;font-size:10.5px;line-height:1.35;padding:20px;background:#fff}"
      + ".inv{max-width:820px;margin:0 auto;border:1px solid #000}.row{display:flex}.bb{border-bottom:1px solid #000}.br{border-right:1px solid #000}"
      + ".hd{position:relative;text-align:center;padding:9px 130px 7px}"
      + ".orig{position:absolute;top:5px;right:10px;font-style:italic;font-size:10.5px}.lg{position:absolute;top:16px;left:18px}"
      + ".gi{display:inline-block;font-weight:700;font-size:11px;border-bottom:1px solid #000;line-height:1.1;padding-bottom:1px}"
      + ".cn{font-weight:700;font-size:25px;letter-spacing:.3px;line-height:1.15;margin-top:3px}"
      + ".ad{font-size:11px;text-transform:uppercase;line-height:1.3;margin-top:1px}"
      + ".gs{font-weight:700;font-size:11.5px;margin-top:2px}.tel{font-weight:700;font-style:italic;font-size:10px;margin-top:1px}"
      + ".tg{font-weight:700;font-size:11px;text-transform:uppercase;margin-top:4px}"
      + ".meta{width:50%;padding:5px 8px 5px 6px}.kv{display:flex;padding:1px 0}"
      + ".kv .k{width:114px;flex:none}.kv .c{width:12px;flex:none}.kv .v{flex:1;min-width:0;word-break:break-word}"
      + ".pc{width:50%;padding:6px 8px 8px 6px}.pt{font-weight:700;font-style:italic;margin-bottom:2px}.pg{margin-top:13px}"
      + "table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:inherit;font-family:inherit}"   /* quirks-mode tables reset font-size to 16px; inherit puts it back */
      + ".it th{border-right:1px solid #000;border-bottom:1px solid #000;padding:5px 5px 4px;font-weight:700;text-align:left;vertical-align:top;line-height:1.25}"
      + ".it td{border-right:1px solid #000;padding:4px 5px;vertical-align:top}.it th:last-child,.it td:last-child{border-right:0}"
      + ".it .sp td{height:190px;padding:0;border-bottom:1px solid #000}.st td{padding:4px 5px 0;font-weight:700;font-size:11.5px}.st td.amt{border-left:1px solid #000}.gap{height:32px}"
      + ".r{text-align:right}.c{text-align:center}"
      + ".tx td{padding:2px 5px;font-style:italic}.tx td.lab{text-align:right;padding-right:26%}.tx td.amt,.gt td.amt{border-left:1px solid #000;font-style:normal}"
      + ".gt td{padding:6px 5px 5px;font-weight:700;font-size:12px;border-top:1px solid #000;border-bottom:1px solid #000}.gt td.amt{font-size:12.5px}"
      + ".gt .qtytot{font-weight:700;border-bottom:1px solid #000}"
      + ".hs{padding:3px 6px}.hs table{width:auto;table-layout:auto}.hs th{font-weight:700;text-decoration:underline;text-align:left;padding:1px 9px 1px 0;font-size:9.5px;white-space:nowrap}"
      + ".hs td{padding:1px 9px 1px 0;font-size:10px}"
      + ".wd{padding:5px 6px;font-weight:700;font-size:11px}.bk{padding:5px 6px}.bk b{margin-right:6px}"
      + ".ft{display:flex;min-height:150px}.tc{width:44%;padding:5px 6px}.tc u{font-weight:700;font-size:9.5px}"
      + ".tc .eoe{font-size:10px;margin:4px 0 3px}.tc ol{list-style:none;padding:0;margin:0;font-size:10px;line-height:1.45}"
      + ".sg{width:56%;display:flex;flex-direction:column}.rs{padding:5px 6px;font-weight:700;font-size:9.5px;border-bottom:1px solid #000;min-height:44px}"
      + ".sf{flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:8px 8px 6px}"
      + ".sf .for{text-align:right;font-weight:700;font-size:12.5px}.sf .as{text-align:right;font-weight:700;font-size:12px;margin-top:38px}"
      + ".qr{text-align:left}.qrc{font-size:9px}";

    var kv = function (k, v) { return '<div class="kv"><span class="k">' + k + '</span><span class="c">:</span><span class="v">' + esc(v) + '</span></div>'; };
    var COLS = '<colgroup><col style="width:34px"><col><col style="width:72px"><col style="width:58px"><col style="width:54px"><col style="width:78px"><col style="width:98px"></colgroup>';
    var party = function (title, cls) {
      return '<div class="pc' + (cls ? ' ' + cls : '') + '"><div class="pt">' + title + ' :</div><div>' + esc(b.name) + '</div>'
        + (b.address ? '<div>' + esc(b.address) + '</div>' : '')
        + '<div class="pg">' + kv('Party E-Mail ID', f.bEmail) + kv('Party Mobile No', f.bPhone) + kv('State', f.bState) + kv('GSTIN / UIN', b.gstin || '') + '</div></div>';
    };
    var taxRow = function (head, rate, amt) {
      return '<tr class="tx"><td></td><td class="lab">Add : ' + head + '</td><td></td><td></td><td class="c">@</td><td class="r">' + rate + ' %</td><td class="r amt">' + amt + '</td></tr>';
    };
    var taxes = f.interState ? taxRow('IGST', f.gstR, f.igst) : taxRow('CGST', f.halfR, f.cgst) + taxRow('SGST', f.halfR, f.sgst);
    /* "HDFC BANK & HDFC0002670 AC NO-50200089605146 MERTA CITY" — bank, IFSC, account, branch, in that order, as printed */
    var bankLine = function (bk, br, ifsc, ac) { return [bk, ifsc ? '& ' + ifsc : '', ac ? 'AC NO-' + ac : '', br].filter(Boolean).join(' ').toUpperCase(); };
    var bank = (f.cfg.showBank && s.bank)
      ? '<div class="bk bb"><b>Bank Details :</b>' + esc(bankLine(s.bank, s.bankBranch, s.ifsc, s.accNo))
        + (s.bank2 ? '<br><b style="visibility:hidden">Bank Details :</b>' + esc(bankLine(s.bank2, s.bankBranch2, s.ifsc2, s.accNo2)) : '') + '</div>'
      : '';

    var body = '<div class="inv">'
      + '<div class="hd bb"><div class="orig">Original Copy</div>' + (f.logo ? '<div class="lg">' + logoImg(f, 64) + '</div>' : '')
      + '<div><span class="gi">GST INVOICE</span></div><div class="cn">' + esc(s.name) + '</div>'
      + '<div class="ad">' + String(s.address || '').split(/\n/).map(esc).join('<br>') + '</div>'
      + '<div class="gs">GSTIN : ' + esc(s.gstin || '') + '</div>'
      + (f.tel ? '<div class="tel">Tel. : ' + esc(f.tel) + '</div>' : '')
      + (f.tagline ? '<div class="tg">' + esc(f.tagline) + '</div>' : '') + '</div>'
      + '<div class="row bb"><div class="meta br">' + kv('Invoice No.', f.inv) + kv('Dated', f.date) + kv('Place of Supply', f.pos) + kv('Reverse Charge', f.rcm === 'Yes' ? 'Y' : 'N') + kv('GR/RR No.', f.grrr) + '</div>'
      + '<div class="meta">' + kv('Transport', f.transport) + kv('Vehicle No.', f.veh) + kv('Station', f.station) + kv('E-Way Bill No.', f.eway) + '</div></div>'
      + '<div class="row bb">' + party('Billed to', 'br') + party('Shipped to', '') + '</div>'
      + '<div class="gap bb"></div>'
      + '<table class="it">' + COLS + '<tr><th>S.N.</th><th>Description of Goods</th><th>HSN/SAC<br>Code</th><th class="r">Qty.</th><th>Unit</th><th class="r">Price</th><th class="r">Amount(₹)</th></tr>'
      + '<tr><td class="r">1.</td><td>' + esc(f.product) + '</td><td>' + esc(f.hsn) + '</td><td class="r">' + f.qty + '</td><td>' + esc(f.unit) + '</td><td class="r">' + f.rate + '</td><td class="r">' + f.taxable + '</td></tr>'
      + '<tr class="sp"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></table>'
      + '<table>' + COLS + '<tr class="st"><td></td><td></td><td></td><td></td><td></td><td></td><td class="r amt">' + f.taxable + '</td></tr>' + taxes
      + '<tr class="gt"><td></td><td class="r">Grand Total</td><td></td><td colspan="2" class="c">' + qtyTotalEl(f) + '</td><td class="r">₹</td><td class="r amt">' + f.grand + '</td></tr></table>'
      + '<div class="hs bb"><table><tr><th>HSN/SAC</th><th>Tax Rate</th><th>Taxable Amt.</th>' + taxSumHead(f) + '<th>Total Tax</th></tr>'
      + '<tr><td>' + esc(f.hsn) + '</td><td>' + (+f.gstR) + '%</td><td>' + f.taxable + '</td>' + taxSumCells(f) + '<td>' + f.totalTax + '</td></tr></table></div>'
      + '<div class="wd bb">' + esc(f.words) + '</div>'
      + bank
      + '<div class="ft"><div class="tc br"><u>Terms &amp; Conditions</u><div class="eoe">E.&amp; O.E.</div>'
      + (f.cfg.showDeclaration ? '<ol>' + f.terms.map(function (t, i) { return '<li>' + (i + 1) + '. ' + esc(t) + '</li>'; }).join('') + '</ol>' : '')
      + (f.cfg.footerNote ? '<div style="margin-top:6px;font-size:10px">' + esc(f.cfg.footerNote) + '</div>' : '') + '</div>'
      + '<div class="sg"><div class="rs">Receiver\'s Signature &nbsp;&nbsp;:</div><div class="sf">' + qrBlock(f)
      + (f.cfg.showSignature ? '<div class="for">for ' + esc(f.signatory) + '</div><div class="as">Authorised Signatory</div>' : '') + '</div></div></div>'
      + '</div>';
    return doc(f, 'gst', css + '@page{margin:0}@media print{body{padding:10mm}}@media screen and (max-width:760px){.hd{padding:9px 84px 7px 104px}.lg img{height:52px!important}.cn{font-size:21px}.ad,.tg{font-size:10px}}', body);
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
     THE TWO COLOUR DESIGNS — modelled on the bill templates the owner sent
     (12-09-2026): the Zoho-style "Modern" and "Business" quotation layouts.
     He rejected the previous Modern / Monochrome / Compact outright.

       modern   — a tinted header band with a light title, the firm on the
                  right, a solid-colour item table with zebra rows, totals on
                  the right with the total in the accent, a tinted footer with
                  terms, bank details and a contact line.
       business — a centred coloured title, the logo top-left with invoice #
                  and date on the right, two tinted "Invoice by / Invoice to"
                  boxes, a Place of supply strip, the same item table, terms on
                  the left and totals on the right.

     Both are ACCENTABLE: every colour is derived from cfg.accent (the gallery's
     colour picker), so the purple / green / orange variants in the reference
     are one click, not four templates. Both carry every Rule 46 field and the
     branding the compliance test demands; neither prints Transport / Station /
     GR-RR (despatch:false) — those belong to the print format. */
  function tint(hex, aa) {
    return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex + aa : 'rgba(37,99,235,' + (parseInt(aa, 16) / 255).toFixed(2) + ')';
  }
  function itemTable(f) {
    return '<table class="itm"><thead><tr><th style="width:28px">#</th><th>Item description</th><th style="width:78px">HSN/SAC</th>'
      + '<th class="r" style="width:96px">Qty</th><th class="r" style="width:84px">Rate</th><th class="r" style="width:104px">Amount</th></tr></thead>'
      + '<tbody><tr><td>1.</td><td><b>' + esc(f.product) + '</b></td><td>' + esc(f.hsn) + '</td><td class="r">' + f.qty + ' ' + esc(f.unit) + '</td>'
      + '<td class="r">₹ ' + f.rate + '</td><td class="r">₹ ' + f.taxable + '</td></tr></tbody></table>';
  }
  function totalsBlock(f) {
    return '<div class="tl"><span>Sub total</span><span>₹ ' + f.taxable + '</span></div>' + taxRows(f, 'tl')
      + '<div class="gt"><span class="l">Total</span><span class="v">₹ ' + f.grand + '</span></div>'
      + '<div class="gtq">' + qtyTotalEl(f) + '</div>'
      + '<div class="wd">Invoice total (in words)<b>' + esc(f.words) + '</b></div>';
  }
  function termsBlock(f) {
    var s = f.s;
    return (f.cfg.showDeclaration && f.terms.length ? '<h5>Terms and conditions</h5><ol>' + f.terms.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>' : '')
      + (bankBlock(f) ? '<div class="bk">' + bankBlock(f) + '</div>' : '')
      + (f.tel ? '<div class="ct">For any enquiries, call us on <b>' + esc(f.tel) + '</b>' + (s.email ? ' or email <b>' + esc(s.email) + '</b>' : '') + '</div>' : '')
      + (f.cfg.footerNote ? '<div class="ct">' + esc(f.cfg.footerNote) + '</div>' : '');
  }
  var COMMON = ".r{text-align:right}"
    + ".itm{width:100%;border-collapse:collapse}.itm th{color:#fff;font-size:9.5px;font-weight:600;letter-spacing:.04em;text-align:left;padding:8px 10px}"
    + ".itm th:first-child{border-radius:4px 0 0 4px}.itm th:last-child{border-radius:0 4px 4px 0}"
    + ".itm td{padding:9px 10px;font-size:11px}"
    + ".band2{width:100%;border-collapse:collapse;font-size:9.5px}.band2 th{color:#6B7280;font-weight:600;text-align:left;padding:4px 6px}.band2 td{padding:4px 6px;color:#374151}"
    + ".tl{display:flex;justify-content:space-between;font-size:11px;padding:4px 0}.tl span{color:#6B7280}.tl span+span{font-weight:600;color:#111827}"
    + ".gt{display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid #D1D5DB;margin-top:6px;padding-top:9px}.gt .l{font-size:12px;font-weight:700;color:#111827}.gt .v{font-size:16px;font-weight:700}"
    + ".gtq{text-align:right;font-size:10px;color:#6B7280;margin-top:3px}"
    + ".wd{margin-top:12px;font-size:10px;color:#6B7280}.wd b{display:block;font-size:11.5px;color:#111827;margin-top:2px;font-weight:700}"
    + "h5{font-size:10.5px;font-weight:700;margin:0 0 5px}ol{margin:0 0 12px;padding-left:16px;font-size:10px;color:#4B5563;line-height:1.55}"
    + ".bk,.ct{font-size:10px;color:#4B5563;margin-bottom:8px}.ct b,.bk b{color:#111827}"
    + ".sg{text-align:center}.sg .sfor{font-size:10.5px;color:#374151}.sg .sline{border-bottom:1px solid #9CA3AF;margin:34px 0 5px}.sg .scap{font-size:9.5px;color:#6B7280}"
    + ".qr{text-align:center;margin-bottom:8px}.qrc{font-size:9px;color:#6B7280}";

  function modern(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b, a = f.cfg.accent || '#2563EB';
    var band = tint(a, '14'), zebra = tint(a, '0A'), rule = tint(a, '33');
    var css = "body{font-family:" + f.cfg.font + ";color:#1F2937;font-size:11px;line-height:1.5;padding:0;background:#fff}"
      + ".sheet{max-width:820px;margin:0 auto;background:#fff}"
      + ".band{background:" + band + ";padding:30px 36px 26px;display:flex;justify-content:space-between;align-items:flex-start;gap:24px}"
      + ".ttl{font-size:30px;font-weight:300;color:" + a + ";letter-spacing:-.01em;line-height:1.1}"
      + ".ttl small{display:block;font-size:9.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#6B7280;margin-top:8px}"
      + ".by{display:flex;gap:16px;align-items:flex-start;justify-content:flex-end;text-align:right}"
      + ".by .k{font-size:9px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.08em}.by .n{font-size:13px;font-weight:700;color:#111827;margin-top:2px}.by .l{font-size:10px;color:#4B5563;max-width:320px}.by .l b{color:#111827}"
      + ".sec{padding:22px 36px 0;display:grid;grid-template-columns:1fr 1fr;gap:28px}"
      + ".lab{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:" + a + ";border-left:2px solid " + a + ";padding-left:6px;margin-bottom:6px}"
      + ".nm{font-size:12.5px;font-weight:700;color:#111827}.ln{font-size:10.5px;color:#4B5563;margin-top:2px}.ln b{color:#111827}"
      + ".kv{display:grid;grid-template-columns:110px 1fr;gap:3px 10px;font-size:10.5px}.kv span{color:#6B7280}.kv b{color:#111827;font-weight:600}"
      + ".itmw{padding:20px 36px 0}.itm th{background:" + a + "}.itm td{border-bottom:1px solid " + rule + "}.itm tr:nth-child(even) td{background:" + zebra + "}"
      + ".money{padding:18px 36px 0;display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:28px;align-items:start}.band2 th{border-bottom:1px solid " + rule + "}"
      + ".gt .v{color:" + a + "}"
      + ".foot{background:" + band + ";margin-top:26px;padding:22px 36px 26px;display:grid;grid-template-columns:minmax(0,1fr) 200px;gap:28px;align-items:end}.foot h5{color:#111827}"
      + COMMON
      + "@media screen and (max-width:700px){.sec,.money,.foot{grid-template-columns:1fr}.band{flex-direction:column}.by{text-align:left;justify-content:flex-start}}";
    var body = '<div class="sheet">'
      + '<div class="band"><div><div class="ttl">Tax Invoice<small>' + (f.interState ? 'Inter-state supply · IGST' : 'Intra-state supply · CGST + SGST') + '</small></div></div>'
      + '<div class="by"><div><div class="k">Invoice by</div><div class="n">' + esc(s.name) + '</div><div class="l">' + esc(s.address || '') + '</div>'
      + (f.tagline ? '<div class="l">' + esc(f.tagline) + '</div>' : '')
      + '<div class="l"><b>GSTIN ' + esc(s.gstin || '') + '</b>' + (f.msme ? ' · MSME ' + esc(f.msme) : '') + '</div>'
      + ((f.tel || s.email) ? '<div class="l">' + esc([f.tel, s.email].filter(Boolean).join(' · ')) + '</div>' : '') + '</div>'
      + (f.logo ? logoImg(f, 46) : '') + '</div></div>'
      + '<div class="sec"><div><div class="lab">Billed to</div><div class="nm">' + esc(b.name) + '</div>'
      + (b.address ? '<div class="ln">' + esc(b.address) + '</div>' : '')
      + '<div class="ln"><b>GSTIN ' + esc(b.gstin || '—') + '</b>' + (f.bState ? ' · ' + esc(f.bState) : '') + '</div>'
      + (f.bPhone ? '<div class="ln">' + esc(f.bPhone) + '</div>' : '') + '</div>'
      + '<div><div class="lab">Invoice details</div><div class="kv">'
      + '<span>Invoice #</span><b>' + esc(f.inv) + '</b><span>Invoice date</span><b>' + esc(f.date) + '</b>'
      + '<span>Place of supply</span><b>' + esc(f.pos) + '</b><span>Reverse charge</span><b>' + esc(f.rcm) + '</b>'
      + (f.veh ? '<span>Vehicle no.</span><b>' + esc(f.veh) + '</b>' : '') + (f.eway ? '<span>E-Way Bill no.</span><b>' + esc(f.eway) + '</b>' : '')
      + '</div></div></div>'
      + '<div class="itmw">' + itemTable(f) + '</div>'
      + '<div class="money"><div>' + bandTable(f, 'band2') + '</div><div>' + totalsBlock(f) + '</div></div>'
      + '<div class="foot"><div>' + termsBlock(f) + '</div><div>' + qrBlock(f) + signBlock(f, 'sg') + '</div></div></div>';
    return doc(f, 'modern', css, body);
  }

  function business(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b, a = f.cfg.accent || '#2563EB';
    var box = tint(a, '12'), zebra = tint(a, '0A'), rule = tint(a, '33');
    var pan = (s.gstin || '').length === 15 ? s.gstin.slice(2, 12) : '';
    var css = "body{font-family:" + f.cfg.font + ";color:#1F2937;font-size:11px;line-height:1.5;padding:0;background:#fff}"
      + ".sheet{max-width:820px;margin:0 auto;padding:30px 36px 34px}"
      + ".ttl{text-align:center;font-size:20px;font-weight:700;color:" + a + ";letter-spacing:.02em;margin-bottom:16px}"
      + ".top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}"
      + ".top .co{display:flex;gap:12px;align-items:center}.top .co .n{font-size:15px;font-weight:800;color:#111827;letter-spacing:-.01em}.top .co .t{font-size:9.5px;color:#6B7280;text-transform:uppercase;letter-spacing:.06em}"
      + ".top .kv{display:grid;grid-template-columns:auto auto;gap:2px 14px;font-size:10.5px;text-align:right}.top .kv span{color:#6B7280}.top .kv b{color:#111827}"
      + ".boxes{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px}"
      + ".box{background:" + box + ";border-radius:6px;padding:12px 14px}.box h5{color:" + a + "}"
      + ".box .n{font-size:12px;font-weight:700;color:#111827}.box .l{font-size:10px;color:#4B5563;margin-top:2px}.box .l b{color:#111827}"
      + ".strip{display:flex;justify-content:flex-end;gap:26px;font-size:10px;color:#6B7280;padding:10px 4px 0}.strip b{color:#111827;margin-left:6px}"
      + ".itmw{margin-top:12px}.itm th{background:" + a + "}.itm td{border-bottom:1px solid " + rule + "}.itm tr:nth-child(even) td{background:" + zebra + "}"
      + ".bot{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:30px;margin-top:20px;align-items:start}.bot h5{color:" + a + "}"
      + ".band2{margin:0 0 14px}.band2 th{border-bottom:1px solid " + rule + "}.gt .v{color:" + a + "}.sg{margin-top:28px}"
      + COMMON
      + "@media screen and (max-width:700px){.boxes,.bot{grid-template-columns:1fr}.top{flex-direction:column}.top .kv{text-align:left}.strip{justify-content:flex-start;flex-wrap:wrap}}";
    var body = '<div class="sheet"><div class="ttl">TAX INVOICE</div>'
      + '<div class="top"><div class="co">' + (f.logo ? logoImg(f, 46) : '') + '<div><div class="n">' + esc(s.name) + '</div>' + (f.tagline ? '<div class="t">' + esc(f.tagline) + '</div>' : '') + '</div></div>'
      + '<div class="kv"><span>Invoice #</span><b>' + esc(f.inv) + '</b><span>Invoice date</span><b>' + esc(f.date) + '</b>'
      + (f.veh ? '<span>Vehicle no.</span><b>' + esc(f.veh) + '</b>' : '') + (f.eway ? '<span>E-Way Bill no.</span><b>' + esc(f.eway) + '</b>' : '') + '</div></div>'
      + '<div class="boxes"><div class="box"><h5>Invoice by</h5><div class="n">' + esc(s.name) + '</div><div class="l">' + esc(s.address || '') + '</div>'
      + '<div class="l"><b>GSTIN</b> ' + esc(s.gstin || '') + (pan ? ' &nbsp; <b>PAN</b> ' + esc(pan) : '') + '</div>'
      + (f.msme ? '<div class="l"><b>MSME</b> ' + esc(f.msme) + '</div>' : '')
      + ((f.tel || s.email) ? '<div class="l">' + esc([f.tel, s.email].filter(Boolean).join(' · ')) + '</div>' : '') + '</div>'
      + '<div class="box"><h5>Invoice to</h5><div class="n">' + esc(b.name) + '</div>' + (b.address ? '<div class="l">' + esc(b.address) + '</div>' : '')
      + '<div class="l"><b>GSTIN</b> ' + esc(b.gstin || '—') + (f.bState ? ' &nbsp; <b>State</b> ' + esc(f.bState) : '') + '</div>'
      + (f.bPhone ? '<div class="l">' + esc(f.bPhone) + '</div>' : '') + '</div></div>'
      + '<div class="strip"><span>Place of supply<b>' + esc(f.pos) + '</b></span><span>Reverse charge<b>' + esc(f.rcm) + '</b></span></div>'
      + '<div class="itmw">' + itemTable(f) + '</div>'
      + '<div class="bot"><div>' + bandTable(f, 'band2') + termsBlock(f) + '</div>'
      + '<div>' + totalsBlock(f) + qrBlock(f) + signBlock(f, 'sg') + '</div></div></div>';
    return doc(f, 'business', css, body);
  }

  /* ══════════ detailed — the full-detail layout of the printed sample ══════════
     Modelled on the supplier e-invoice the owner photographed (12-09-2026):
     GSTIN / PAN top-left, contact top-right, the firm's name in the accent with
     the tagline under it, ORIGINAL COPY, a two-column MSME / invoice / transport
     block, buyer AND consignee blocks with Name / Address / State / PAN / GSTIN,
     a tall goods table with the logo watermarked behind it, a tax stack on the
     right (taxable, CGST, SGST, IGST, GST amount, amount after tax, round off,
     total, reverse charge), the amount in words, terms, "For: firm" with the
     signatory, and REGD. ADDRESS in the footer.

     HONEST BY CONSTRUCTION. The sample carries an IRN, an acknowledgement and a
     QR because the supplier generates e-invoices on the government IRP. This
     design prints that block ONLY when the sale record actually carries irn /
     ackNo / ackDt — never a placeholder, never a decorative QR — and the
     signature area is a place to sign, not a "Signature valid" tick. */
  function detailed(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b, a = f.cfg.accent || '#1D4ED8';
    var pan = function (g) { g = String(g || ''); return g.length === 15 ? g.slice(2, 12) : ''; };
    var dash = '&ndash;';
    var css = "body{font-family:" + f.cfg.font + ";color:#111;font-size:10.5px;line-height:1.35;padding:20px;background:#fff}"
      + ".inv{max-width:820px;margin:0 auto;border:1px solid #000;position:relative}.bb{border-bottom:1px solid #000}.br{border-right:1px solid #000}.row{display:flex}"
      + ".top{display:flex;justify-content:space-between;align-items:flex-start;padding:8px 10px 4px;gap:10px}"
      + ".ids{font-size:9.5px;line-height:1.5;color:#222;min-width:170px}.ids b{display:inline-block;width:42px;font-weight:400;color:#555}"
      + ".ctc{font-size:9.5px;line-height:1.5;text-align:right;min-width:170px;color:#222}"
      + ".mid{text-align:center;flex:1}.co{display:flex;align-items:center;justify-content:center;gap:12px}"
      + ".cn{font-size:22px;font-weight:800;color:" + a + ";letter-spacing:.02em;text-transform:uppercase;line-height:1.1}"
      + ".tg{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#333;margin-top:4px}"
      + ".orig{text-align:right;padding:0 10px 2px;font-size:10px;font-weight:700;letter-spacing:.04em}"
      + ".ttl{text-align:center;padding:2px 0 6px}.ttl span{display:inline-block;font-weight:800;font-size:12.5px;letter-spacing:.04em;border-bottom:1.5px solid #000}"
      + ".meta{width:50%;padding:6px 8px}.kv{display:flex;padding:1.5px 0;font-size:10.5px}.kv .k{width:118px;flex:none;font-weight:700;color:#222}.kv .c{width:12px;flex:none}.kv .v{flex:1;min-width:0;word-break:break-word}"
      + ".ph{font-size:9.5px;font-weight:700;text-align:center;padding:3px;background:#f3f4f6;letter-spacing:.03em}"
      + ".pc{width:50%;padding:5px 8px 6px}.pc .kv .k{width:64px;font-weight:400;color:#444}.pc .kv .v{font-weight:600}"
      + "table{width:100%;border-collapse:collapse;table-layout:fixed}"
      + ".it th{border-right:1px solid #000;border-bottom:1px solid #000;padding:5px 5px;font-weight:800;font-size:10px;text-align:center;vertical-align:middle;line-height:1.2;background:#fff;position:relative;z-index:1}"
      + ".it td{border-right:1px solid #000;padding:5px;vertical-align:top;position:relative;z-index:1}.it th:last-child,.it td:last-child{border-right:0}"
      + ".it .sp td{height:210px;padding:0}.r{text-align:right}.c{text-align:center}"
      + ".wm{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:0}"
      + ".body{position:relative}"
      + ".low{display:flex}.left{width:56%;padding:0}.right{width:44%}"
      + ".rm{padding:5px 8px;min-height:22px;font-size:10px}.rm b{color:#444}"
      + ".irn{padding:6px 8px;font-size:10px;line-height:1.45}.irn b{font-weight:800}.irn .qr{display:inline-block;vertical-align:top;margin-left:10px}"
      + ".hs{padding:5px 8px}.hs table{width:auto}.hs th{font-weight:700;text-decoration:underline;text-align:left;padding:1px 8px 1px 0;font-size:9px;white-space:nowrap}.hs td{padding:1px 8px 1px 0;font-size:9.5px}"
      + ".tx{width:100%}.tx td{border-bottom:1px solid #000;padding:3.5px 6px;font-size:10.5px}.tx td:first-child{font-weight:700;border-right:1px solid #000;width:62%}.tx td:last-child{text-align:right;font-weight:700}"
      + ".tx tr.tot td{font-size:12px;font-weight:800}"
      + ".wd{padding:5px 8px;font-size:10.5px}.wd b{font-weight:800;margin-right:4px}"
      + ".ft{display:flex}.tc{width:62%;padding:6px 8px;font-size:9.5px;line-height:1.5}.tc b{display:block;font-size:10px;margin-bottom:2px}.tc ul{margin:0;padding-left:12px}"
      + ".sg{width:38%;padding:6px 8px;text-align:center;display:flex;flex-direction:column;justify-content:space-between}.sg .for{font-weight:800;font-size:11px}.sg .as{font-weight:700;font-size:10.5px;margin-top:40px}"
      + ".ra{padding:5px 10px;font-size:10px;line-height:1.5}.ra b{display:inline-block;width:118px;color:" + a + ";font-weight:800}"
      + ".qrc{font-size:8px;color:#555}";
    var kv = function (k, v) { return '<div class="kv"><span class="k">' + k + '</span><span class="c">:</span><span class="v">' + esc(v) + '</span></div>'; };
    var party = function (title, cls) {
      return '<div class="pc' + (cls ? ' ' + cls : '') + '"><div class="ph">' + title + '</div>'
        + kv('Name', b.name) + kv('Address', b.address || '') + kv('State', f.bState) + kv('PAN No', pan(b.gstin)) + kv('GSTIN', b.gstin || '') + '</div>';
    };
    var eInv = (d.irn || d.ackNo || d.ackDt)
      ? '<div class="irn bb"><b>IRN:</b> ' + esc(d.irn || '') + '<br><b>Ack No:</b> ' + esc(d.ackNo || '') + ' &nbsp; <b>Ack Dt:</b> ' + esc(d.ackDt || '')
        + (d.qrData ? '<div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=' + encodeURIComponent(d.qrData) + '" alt="e-invoice QR" style="width:88px;height:88px"><div class="qrc">e-Invoice QR</div></div>' : '') + '</div>'
      : '';
    var roundOff = Math.round(((+d.grand || 0) - (+d.total || 0)) * 100) / 100;
    var taxStack = '<table class="tx">'
      + '<tr><td>Total Taxable Value</td><td>' + f.taxable + '</td></tr>'
      + '<tr><td>ADD: CGST' + (f.interState ? '' : ' @ ' + f.halfR + ' %') + '</td><td>' + (f.interState ? dash : f.cgst) + '</td></tr>'
      + '<tr><td>ADD: SGST' + (f.interState ? '' : ' @ ' + f.halfR + ' %') + '</td><td>' + (f.interState ? dash : f.sgst) + '</td></tr>'
      + '<tr><td>ADD: IGST' + (f.interState ? ' @ ' + f.gstR + ' %' : '') + '</td><td>' + (f.interState ? f.igst : dash) + '</td></tr>'
      + '<tr><td>GST Tax Amount</td><td>' + f.totalTax + '</td></tr>'
      + '<tr><td>Amount After Tax</td><td>' + fmt(d.total) + '</td></tr>'
      + (roundOff ? '<tr><td>Round Off</td><td>' + (roundOff > 0 ? '+' : '') + fmt(roundOff) + '</td></tr>' : '')
      + '<tr class="tot"><td>Total Amount</td><td>&#8377; ' + f.grand + '</td></tr>'
      + '<tr><td>Total Quantity</td><td>' + qtyTotalEl(f) + '</td></tr>'
      + '<tr><td>GST Reverse Charge</td><td>' + esc(f.rcm) + '</td></tr></table>';
    var body = '<div class="inv">'
      + '<div class="top"><div class="ids"><b>GSTIN</b>: ' + esc(s.gstin || '') + (f.cin ? '<br><b>CIN</b>: ' + esc(f.cin) : '') + (f.pan ? '<br><b>PAN</b>: ' + esc(f.pan) : '') + (f.iec ? '<br><b>IEC</b>: ' + esc(f.iec) : '') + '</div>'
      + '<div class="mid"><div class="co">' + (f.logo ? logoImg(f, 54) : '') + '<div><div class="cn">' + esc(s.name) + '</div>' + (f.tagline ? '<div class="tg">' + esc(f.tagline) + '</div>' : '') + '</div></div></div>'
      + '<div class="ctc">' + (f.tel ? '+91 ' + esc(f.tel) : '') + (s.email ? '<br>' + esc(s.email) : '') + '</div></div>'
      + '<div class="orig">ORIGINAL COPY</div>'
      + '<div class="ttl bb"><span>' + (eInv ? 'TAX E-INVOICE' : 'TAX INVOICE') + '</span></div>'
      + '<div class="row bb"><div class="meta br">' + (f.msme ? kv('MSME No.', f.msme) : '') + kv('Invoice No', f.inv) + kv('Invoice Date', f.date) + kv('Eway Bill No.', f.eway) + '</div>'
      + '<div class="meta">' + (d.po ? kv('PO No.', d.po) : '') + kv('Transport mode', f.transport) + kv('GR/RR No.', f.grrr) + kv('Station', f.station) + kv('Place of Supply', f.pos) + kv('Vehicle No.', f.veh) + '</div></div>'
      + '<div class="row bb">' + party('Details of Buyer (Billed to)', 'br') + party('Details of Consignee (Shipped to)', '') + '</div>'
      + '<div class="body">' + (f.logo ? '<div class="wm">' + logoImg(f, 240, 'opacity:.07;max-width:420px') + '</div>' : '')
      + '<table class="it"><colgroup><col style="width:44px"><col style="width:78px"><col><col style="width:88px"><col style="width:84px"><col style="width:104px"></colgroup>'
      + '<tr><th>S.No.</th><th>HSN CODE</th><th>DESCRIPTION OF GOODS</th><th>QTY<br>(' + esc(f.unit || '') + ')</th><th>RATE<br>(P.' + esc(f.unit || '') + ')</th><th>AMOUNT</th></tr>'
      + '<tr><td class="c">1.</td><td class="c">' + esc(f.hsn) + '</td><td><b>' + esc(f.product) + '</b></td><td class="r">' + f.qty + '</td><td class="r">' + f.rate + '</td><td class="r">' + f.taxable + '</td></tr>'
      + '<tr class="sp"><td></td><td></td><td></td><td></td><td></td><td></td></tr></table></div>'
      + '<div class="low bb"><div class="left br"><div class="rm bb"><b>Remarks :</b></div>' + eInv + '<div class="hs">' + bandTable(f, '') + '</div></div>'
      + '<div class="right">' + taxStack + '</div></div>'
      + '<div class="wd bb"><b>AMOUNT IN WORDS:</b> ' + esc(f.words) + '</div>'
      + '<div class="ft bb"><div class="tc br"><b>TERMS &amp; CONDITIONS:</b>' + (f.cfg.showDeclaration && f.terms.length ? '<ul>' + f.terms.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '<li>E.&amp; O.E.</li></ul>' : '')
      + (bankBlock(f) ? '<div style="margin-top:4px">' + bankBlock(f) + '</div>' : '') + (f.cfg.footerNote ? '<div style="margin-top:4px">' + esc(f.cfg.footerNote) + '</div>' : '') + '</div>'
      + '<div class="sg">' + (f.cfg.showSignature ? '<div class="for">For: ' + esc(f.signatory) + '</div>' + qrBlock(f) + '<div class="as">Authorised Signatory</div>' : qrBlock(f)) + '</div></div>'
      + '<div class="ra"><b>REGD. ADDRESS</b>: ' + esc(String(s.address || '').replace(/\n/g, ', ')) + (s.unitAddress ? '<br><b>UNIT ADDRESS</b>: ' + esc(s.unitAddress) : '') + '</div>'
      + '</div>';
    return doc(f, 'detailed', css, body);
  }

  /* ══════════ qaReport — the certificate of analysis for one dispatch ══════════
     Modelled on the supplier's "Burnt Lime 0-3 MM Analysis Report" the owner
     photographed (12-09-2026): the firm's letterhead, "To," the buyer, the bill
     number and date, truck and PO on the right, the product's analysis title,
     a Particulars / Result table with the logo watermarked behind it, "For
     FIRM", the chemist's signature space, the date, and the registered address.

     NOT an invoice template — it is not in TEMPLATES and the compliance suite
     does not apply. It prints ONLY the parameters that carry a result; with
     none it returns '' and the caller opens the results form instead. A
     certificate with invented numbers is worse than no certificate. */
  function qaReport(d, cfg) {
    var c = cfgOf(cfg), s = d.seller || {}, b = d.buyer || {}, a = c.accent || '#2563EB';
    var params = (d.params || []).filter(function (p) { return p && String(p.value == null ? '' : p.value).trim() !== ''; });
    if (!params.length) return '';
    var f = { logo: c.showLogo === false ? '' : (c.logo || s.logo || ''), s: s };
    var tel = s.tel || s.phone || '';
    var dot = function (iso) { return fdate(iso).replace(/-/g, '.'); };
    var css = "body{font-family:Verdana,Geneva,Tahoma,Arial,sans-serif;color:#111;font-size:11px;line-height:1.45;padding:20px;background:#fff}"
      + ".sheet{max-width:820px;margin:0 auto;position:relative;min-height:1040px;padding:0 0 60px}"
      + ".lh{display:flex;align-items:center;gap:16px;border-bottom:2px solid " + a + ";padding-bottom:10px}"
      + ".lh .mid{flex:1;text-align:center}.lh .cn{font-size:22px;font-weight:800;color:" + a + ";text-transform:uppercase;letter-spacing:.04em;line-height:1.15}"
      + ".lh .tg{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#333;margin-top:4px}"
      + ".lh .ct{font-size:9.5px;text-align:right;color:#333;line-height:1.5;min-width:150px}"
      + ".meta{display:flex;margin-top:26px;border:1px solid #000}.to{width:50%;padding:8px 10px;border-right:1px solid #000}.ref{width:50%;padding:8px 10px}"
      + ".to .t{font-size:10.5px}.to .n{font-weight:700;font-size:12px;margin-top:2px}.to .ad{margin-top:2px;white-space:pre-line}"
      + ".ref div{padding:2px 0}.ref b{font-weight:700}.ref .dt{float:right}"
      + ".ttl{text-align:center;font-weight:800;font-size:15px;margin:18px 0 8px;letter-spacing:.02em}"
      + ".tw{position:relative}.wm{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:0}"
      + ".qa{width:100%;border-collapse:collapse;position:relative;z-index:1}.qa th,.qa td{border:1px solid #000;padding:9px 12px;font-size:12px}"
      + ".qa th{font-weight:800;text-align:center;background:rgba(255,255,255,.85)}.qa td.p{text-align:center;font-weight:700;width:46%}.qa td.v{font-weight:600;background:rgba(255,255,255,.6)}"
      + ".rm{margin-top:10px;font-size:10.5px}.rm b{margin-right:6px}"
      + ".for{text-align:right;margin-top:30px;font-size:12px}.for b{font-weight:800}"
      + ".sig{height:78px}.chem{text-align:right;font-size:12px;font-weight:700}.chem small{display:block;font-weight:400;font-size:10.5px;color:#333}.dt2{text-align:right;margin-top:8px;font-size:11px}.dt2 b{font-weight:800}"
      + ".ft{position:absolute;left:0;right:0;bottom:0;border-top:1px solid #000;padding-top:6px;font-size:9.5px;line-height:1.55}.ft b{display:inline-block;width:110px;color:" + a + ";font-weight:800}"
      + "@page{margin:0}@media print{body{padding:10mm}}";
    var body = '<div class="sheet">'
      + '<div class="lh">' + (f.logo ? logoImg(f, 64) : '') + '<div class="mid"><div class="cn">' + esc(s.name) + '</div>' + (s.product ? '<div class="tg">' + esc(s.product) + '</div>' : '') + '</div>'
      + '<div class="ct">' + (tel ? 'Contact : +91 ' + esc(tel) : '') + (s.email ? '<br>e-mail : ' + esc(s.email) : '') + '</div></div>'
      + '<div class="meta"><div class="to"><div class="t">To,</div><div class="n">' + esc(b.name) + '</div>' + (b.address ? '<div class="ad">' + esc(b.address) + '</div>' : '') + '</div>'
      + '<div class="ref"><div><b>Bill No.:</b> ' + esc(d.inv) + '<span class="dt"><b>Dt.:</b> ' + esc(fdate(d.date)) + '</span></div>'
      + '<div><b>Truck No.:</b> ' + esc(d.veh || '') + '</div>'
      + (d.po ? '<div><b>P.O. No.:</b> ' + esc(d.po) + (d.poDate ? '<span class="dt"><b>Dt.:</b> ' + esc(fdate(d.poDate)) + '</span>' : '') + '</div>' : '') + '</div></div>'
      + '<div class="ttl">' + esc(d.title || (d.product + ' Analysis Report')) + '</div>'
      + '<div class="tw">' + (f.logo ? '<div class="wm">' + logoImg(f, 260, 'opacity:.08;max-width:460px') + '</div>' : '')
      + '<table class="qa"><tr><th style="width:46%">Particulars</th><th>Result</th></tr>'
      + params.map(function (p) { return '<tr><td class="p">' + esc(p.label) + '</td><td class="v">' + esc(String(p.value).trim()) + (p.unit ? ' ' + esc(p.unit) : '') + '</td></tr>'; }).join('')
      + '</table></div>'
      + (d.remarks ? '<div class="rm"><b>Remarks:</b>' + esc(d.remarks) + '</div>' : '')
      + '<div class="for">For <b>' + esc(s.name) + '</b></div><div class="sig"></div>'
      + '<div class="chem">Chief Chemist' + (d.chemist ? '<small>' + esc(d.chemist) + '</small>' : '') + '</div>'
      + '<div class="dt2">Date: <b>' + esc(dot(d.reportDate || d.date)) + '</b></div>'
      + '<div class="ft"><b>REGD. ADDRESS</b>: ' + esc(String(s.address || '').replace(/\n/g, ', ')) + (s.unitAddress ? '<br><b>UNIT ADDRESS</b>: ' + esc(s.unitAddress) : '') + '</div>'
      + '</div>';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(d.title || 'Analysis Report') + ' — ' + esc(s.short || s.name || '') + '</title><style>' + PRINT + css + '</style></head><body>' + body + '</body></html>';
  }

  var TEMPLATES = [
    { id: 'gst',     name: 'GST Invoice (print format)', category: 'In use now', accentable: false, despatch: true,
      desc: 'Your billing software\'s format, line for line — logo, Tel., Transport / Station / GR-RR, party contact lines, Terms & Conditions, Receiver\'s Signature.', render: gst },
    { id: 'modern',   name: 'Modern',   category: 'Colour', accentable: true,
      desc: 'A tinted header band, a solid-colour item table and a tinted footer — the modern bill layout you sent. Pick the colour.', render: modern },
    { id: 'business', name: 'Business', category: 'Colour', accentable: true,
      desc: 'A centred title, your logo top-left, tinted “Invoice by / Invoice to” boxes and a solid-colour item table. Pick the colour.', render: business },
    { id: 'detailed', name: 'Detailed', category: 'Full detail', accentable: true, despatch: true,
      desc: 'The full-detail layout of the sample you sent: GSTIN / PAN header, MSME, transport block, buyer and consignee, watermark, tax stack, terms, address footer. IRN / QR print only once an e-invoice exists.', render: detailed }
  ];

  function get(id) { for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i]; return TEMPLATES[0]; }
  function render(d, cfg) {
    var c = cfgOf(cfg);
    return get(c.template).render(d, c);
  }

  var API = { TEMPLATES: TEMPLATES, DEFAULT_CFG: DEFAULT_CFG, cfgOf: cfgOf, get: get, render: render, facts: facts, qaReport: qaReport };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.InvoiceTemplates = API;
})(typeof window !== 'undefined' ? window : globalThis);
