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
      /* The rate's own unit (falls back to the quantity's — legacy rows) and the
         quantity converted into it, for the arithmetic line on the paper. */
      rateUnit: d.rateUnit || d.unit || '', billableQty: d.billableQty != null ? qfmt(d.billableQty) : qfmt(d.qty), billableUnit: d.billableUnit || d.rateUnit || d.unit || '',
      unitsDiffer: unitsDiffer(d.unit, d.rateUnit),
      qty: qfmt(d.qty), rate: fmt(d.rate), taxable: fmt(d.taxable),
      gstR: (+d.gstR || 0).toFixed(2), halfR: halfR.toFixed(2),
      interState: !!d.interState,
      cgst: fmt(d.cgst), sgst: fmt(d.sgst), igst: fmt(d.igst),
      totalTax: fmt(d.interState ? d.igst : (d.cgst + d.sgst)),
      grand: fmt(d.grand), words: d.words || '',
      // Place of supply and reverse charge are Rule 46 items in their own right.
      /* Place of supply. A domestic recipient with no address on record is
         supplied at the supplier's location (that is the GST rule for an
         unknown recipient address). An EXPORT is never in Rajasthan: its place
         of supply is the destination country when known, else "Outside India". */
      pos: (String(d.type || '').toLowerCase() === 'export') ? ((d.export && d.export.country) || 'Outside India') : (d.pos || b.state || s.state || ''), rcm: d.rcm ? 'Yes' : 'No',
      /* The lines every design prints — one line from the sale record unless the
         sale carries items[]. Shared so no design can print a phantom single line
         for a multi-line sale. */
      items: (Array.isArray(d.items) && d.items.length) ? d.items : [{ hsn: d.hsn || '', product: d.product || '', qty: d.qty, unit: d.unit || '', rate: d.rate, rateUnit: d.rateUnit || d.unit || '', taxable: d.taxable }],
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
      iec: s.iec || '', cin: s.cin || '', lut: s.lut || '', unitAddr: s.unitAddress || '', pan: (String(s.gstin || '').length === 15 ? String(s.gstin).slice(2, 12) : ''),
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
  /* Per unit, never across units: "20 MT + 400 Bag" for a mixed sale, "30 MT"
     for a single-unit one, and the sale line's own figure when there are no items. */
  function qtyTotal(f) {
    if (!f.items || f.items.length <= 1) { var one = f.items && f.items[0] ? f.items[0] : { qty: f.qty, unit: f.unit }; return qfmt(one.qty) + (one.unit ? ' ' + one.unit : ''); }
    var by = {}, order = [];
    f.items.forEach(function (it) { var u = String(it.unit || '').trim(); if (!(u in by)) { by[u] = 0; order.push(u); } by[u] += (+it.qty || 0); });
    return order.map(function (u) { return qfmt(by[u]) + (u ? ' ' + u : ''); }).join(' + ');
  }

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
    var Q = QLQROpt(), svg = Q ? Q.svg(f.cfg.qrData, 88, { label: 'Scan to pay', cls: 'qrimg' }) : '';
    return svg ? '<div class="qr">' + svg + '<div class="qrc">Scan to pay</div></div>' : '';
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
      + ".qr{text-align:left}.qrc{font-size:9px}"
      + ".ua{border-top:1px solid #000;padding:5px 8px;font-size:9.5px;line-height:1.5}.ua b{display:inline-block;width:104px;font-weight:700}";

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
      + '<table class="it">' + COLS + '<tr><th>S.N.</th><th>Description of Goods</th><th>HSN/SAC<br>Code</th><th class="r">Qty.</th><th>Unit</th><th class="r">Price' + (f.rateUnit ? '<br>(per ' + esc(f.rateUnit) + ')' : '') + '</th><th class="r">Amount(₹)</th></tr>'
      + '<tr><td class="r">1.</td><td>' + esc(f.product) + (f.unitsDiffer ? '<br><span style="font-size:9px;color:#444">' + f.qty + ' ' + esc(f.unit) + ' = ' + f.billableQty + ' ' + esc(f.billableUnit) + ' × ₹' + f.rate + '</span>' : '') + '</td><td>' + esc(f.hsn) + '</td><td class="r">' + f.qty + '</td><td>' + esc(f.unit) + '</td><td class="r">' + f.rate + '</td><td class="r">' + f.taxable + '</td></tr>'
      + '<tr class="sp"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></table>'
      + '<table>' + COLS + '<tr class="st"><td></td><td></td><td></td><td></td><td></td><td></td><td class="r amt">' + f.taxable + '</td></tr>' + taxes
      + '<tr class="gt"><td></td><td class="r">Grand Total</td><td></td><td colspan="2" class="c">' + qtyTotalEl(f) + '</td><td class="r">₹</td><td class="r amt">' + f.grand + '</td></tr></table>'
      + '<div class="hs bb"><table><tr><th>HSN/SAC</th><th>Tax Rate</th><th>Taxable Amt.</th>' + taxSumHead(f) + '<th>Total Tax</th></tr>'
      + '<tr><td>' + esc(f.hsn) + '</td><td>' + (+f.gstR) + '%</td><td>' + f.taxable + '</td>' + taxSumCells(f) + '<td>' + f.totalTax + '</td></tr></table></div>'
      + '<div class="wd bb">' + esc(f.words) + '</div>'
      + bank
      + (eInvBlock(d, 'einv') ? '<div class="bb" style="padding:6px 8px">' + eInvBlock(d, 'einv') + '</div>' : '')
      + '<div class="ft"><div class="tc br"><u>Terms &amp; Conditions</u><div class="eoe">E.&amp; O.E.</div>'
      + (f.cfg.showDeclaration ? '<ol>' + f.terms.map(function (t, i) { return '<li>' + (i + 1) + '. ' + esc(t) + '</li>'; }).join('') + '</ol>' : '')
      + (f.cfg.footerNote ? '<div style="margin-top:6px;font-size:10px">' + esc(f.cfg.footerNote) + '</div>' : '') + '</div>'
      + '<div class="sg"><div class="rs">Receiver\'s Signature &nbsp;&nbsp;:</div><div class="sf">' + qrBlock(f)
      + (f.cfg.showSignature ? '<div class="for">for ' + esc(f.signatory) + '</div><div class="as">Authorised Signatory</div>' : '') + '</div></div></div>'
      + (f.unitAddr ? '<div class="ua"><b>REGD. ADDRESS</b> : ' + esc(String(s.address || '').replace(/\n/g, ', ')) + '<br><b>UNIT ADDRESS</b> : ' + esc(f.unitAddr) + '</div>' : '')
      + '</div>';
    return doc(f, 'gst', css + EINV_CSS + (eInvBlock(d, 'einv') ? '.it .sp td{height:20px!important}' : '') + '@page{margin:0}@media print{body{padding:10mm}}@media screen and (max-width:760px){.hd{padding:9px 84px 7px 104px}.lg img{height:52px!important}.cn{font-size:21px}.ad,.tg{font-size:10px}}', body);
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

  /* ══════════ modern + business — rebuilt 13-09-2026 to the two Zoho-style
     references the owner picked ("I like this one"), after rejecting the first
     versions ("very bad design"). Same ids, so a stored pick still resolves.

       modern   — a tinted band top and bottom, a light "Tax Invoice" title,
                  the firm on the right with its logo, Billed to / Invoice
                  details, a solid-accent table with zebra rows, totals on the
                  right with the total in the accent and the words beneath,
                  terms / notes / an enquiries line in the tinted footer.
       business — logo and firm top-left, a light title top-right, three
                  columns (Invoice by · Invoice to · invoice meta with Country
                  and Place of supply), a fully ruled table with a lightly
                  tinted header, terms and notes on the left, a ruled totals
                  box with the Total row in the accent and the words inside,
                  the signature line, and a ruled enquiries box at the foot.

     Narrow preview panes SCALE the sheet (zoom) instead of restacking it, so
     the preview looks like the printed page, not a different layout. */
  /* units-core, when present (browser global / Node require) — only for the
     small "7,650 Kg = 7.65 Ton" note; the amounts themselves come from the data. */
  function QLQROpt() { try { if (typeof QLQR !== 'undefined') return QLQR; if (typeof require === 'function') return require('./qr-core.js'); } catch (e) {} return null; }
  function QLUnitsOpt() { try { if (typeof QLUnits !== 'undefined') return QLUnits; if (typeof require === 'function') return require('./units-core.js'); } catch (e) {} return null; }
  /* 'Tonne' and 'Ton' are the same unit — compare canonical keys, never strings. */
  function unitsDiffer(u, ru) { if (!ru || !u) return false; var U = QLUnitsOpt(); var a = U ? (U.normalizeUnit(u) || String(u).trim().toLowerCase()) : String(u).trim().toLowerCase(), b = U ? (U.normalizeUnit(ru) || String(ru).trim().toLowerCase()) : String(ru).trim().toLowerCase(); return a !== b; }
  /* A line's taxable: stored when the record has it, else priced through units-core. */
  function lineTaxable(it) { if (it.taxable != null && it.taxable !== '') return +it.taxable || 0; var U = QLUnitsOpt(); return U ? U.lineAmount(it).amount : (+it.qty || 0) * (+it.rate || 0); }
  function convNote(it) { var U = QLUnitsOpt(); if (!U || !unitsDiffer(it.unit, it.rateUnit) || !(+it.qty)) return ''; var L = U.lineAmount(it); return qfmt(it.qty) + ' ' + esc(it.unit) + ' = ' + qfmt(L.billableQty) + ' ' + esc(L.billableUnit) + ' × ₹' + fmt(it.rate); }
  function itemRows(f, numbered) {
    return f.items.map(function (it, i) {
      var name = esc(it.product || ''), qty = qfmt(it.qty) + (it.unit ? ' ' + esc(it.unit) : ''), ru = it.rateUnit || it.unit || '', note = convNote(it), tx = lineTaxable(it);
      if (note) name += '<br><span style="color:#6B7280;font-size:9.5px;font-weight:400">' + note + '</span>';
      return numbered
        ? '<tr><td><b>' + (i + 1) + '. ' + name + '</b></td><td>' + esc(it.hsn || f.hsn) + '</td><td class="r">' + qty + '</td><td class="r" style="white-space:nowrap">₹ ' + fmt(it.rate) + (ru ? '<span style="color:#6B7280">/' + esc(ru) + '</span>' : '') + '</td><td class="r">₹ ' + fmt(tx) + '</td></tr>'
        : '<tr><td>' + (i + 1) + '.</td><td><b>' + name + '</b></td><td>' + esc(it.hsn || f.hsn) + '</td><td class="r">' + qty + '</td><td class="r" style="white-space:nowrap">₹ ' + fmt(it.rate) + (ru ? '<span style="color:#6B7280">/' + esc(ru) + '</span>' : '') + '</td><td class="r">₹ ' + fmt(tx) + '</td></tr>';
    }).join('');
  }
  /* ── The e-invoice block, shared by EVERY design ──────────────────────
     IRN · Ack No · Ack Date · the OFFICIAL signed QR · "Scan to verify".
     Printed only for a sale that carries an IRN. The QR is the IRP's
     SignedQRCode (d.signedQr — a JWS the portal signed) encoded verbatim,
     in-process, as vector (QLQR): never fetched from a third party, never
     built locally from the IRN or invoice number, never modified. A sale
     with an IRN but no signed QR prints the IRN lines and NO square — a
     square that does not verify is worse than none. d.qrImage (an image the
     caller already holds) is honoured; the legacy d.qrData is treated as a
     signed payload only when it looks like a JWS. */
  /* the portal's '2026-09-19 10:12:33' (or a bare ISO date) → 19-09-2026 10:12:33 */
  function fAckDt(v) { var s = String(v || '').trim(); var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/); return m ? m[3] + '-' + m[2] + '-' + m[1] + (m[4] ? ' ' + m[4] : '') : s; }
  function eInvQrPayload(d) {
    var s = String(d.signedQr || '').trim(); if (s) return s;
    var q = String(d.qrData || '').trim(); return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(q) ? q : '';
  }
  function eInvQr(d, px) {
    if (d.qrImage) return '<img class="qrimg" src="' + esc(d.qrImage) + '" alt="e-Invoice QR" style="width:' + (px || 150) + 'px;height:' + (px || 150) + 'px">';
    var Q = QLQROpt(), p = eInvQrPayload(d);
    return (Q && p) ? Q.svg(p, px || 150, { label: 'GST e-Invoice QR — scan to verify', cls: 'qrimg' }) : '';
  }
  function eInvBlock(d, cls) {
    if (!String(d.irn || '').trim()) return '';
    var row = function (k, v) { return v ? '<div class="ekv"><span>' + k + '</span><b>' + esc(v) + '</b></div>' : ''; };
    var qr = eInvQr(d, 150);
    return '<div class="' + (cls || 'einv') + '"><div class="eid">' + row('IRN', d.irn) + row('Ack No.', d.ackNo) + row('Ack Date', fAckDt(d.ackDt)) + (d.ewbNo ? row('E-Way Bill', d.ewbNo + (d.ewbDt ? ' · ' + d.ewbDt : '')) : '') + '</div>'
      + (qr ? '<div class="eqr">' + qr + '<div class="qrc">Scan to verify e-Invoice</div></div>' : '') + '</div>';
  }
  var EINV_CSS = '.einv{display:flex;gap:14px;align-items:flex-start;justify-content:space-between;border:1px solid #D1D5DB;padding:8px 12px;font-size:9.5px;word-break:break-all;break-inside:avoid}.einv .eid{flex:1;min-width:0}.einv .eqr{flex:none;text-align:center}.einv .qrimg{display:block;width:150px;height:150px}.einv .qrc{font-size:8px;color:#6B7280;margin-top:2px}.ekv{display:flex;gap:8px}.ekv span{color:#6B7280;min-width:56px;flex:none}.ekv b{font-weight:600;color:#111827}';
  function contactLine(f, s) {
    var tel = f.tel, mail = s.email || '';
    if (!tel && !mail) return '';
    return 'For any enquiries, ' + (mail ? 'email us on <b>' + esc(mail) + '</b>' + (tel ? ' or ' : '') : '') + (tel ? 'call us on <b>' + esc(tel) + '</b>' : '');
  }
  function notesLine(f, s) {
    return [f.tagline ? esc(f.tagline) : '', f.msme ? 'MSME: ' + esc(f.msme) : '', f.unitAddr ? 'Unit: ' + esc(f.unitAddr) : '', bankBlock(f)].filter(Boolean).join('<br>');
  }
  function modern(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b, a = f.cfg.accent || '#2563EB';
    var band = tint(a, '14'), zebra = tint(a, '0A'), rule = tint(a, '33');
    var css = "body{font-family:" + f.cfg.font + ";color:#1F2937;font-size:11px;line-height:1.5;padding:0;background:#fff}"
      + ".sheet{max-width:820px;margin:0 auto;background:#fff}"
      + ".band{background:" + band + ";padding:34px 40px 30px;display:flex;justify-content:space-between;align-items:flex-start;gap:24px}"
      + ".ttl{font-size:34px;font-weight:300;color:" + a + ";letter-spacing:-.01em;line-height:1}"
      + ".by{display:flex;gap:18px;align-items:flex-start}.by .k{font-size:9px;color:#9CA3AF;letter-spacing:.06em}.by .n{font-size:13px;font-weight:700;color:#111827;margin-top:2px}.by .l{font-size:10px;color:#4B5563;line-height:1.45;margin-top:3px;max-width:300px}"
      + ".tile{width:56px;height:56px;background:#fff;border-radius:8px;display:flex;align-items:center;justify-content:center;flex:none}"
      + ".sec{padding:24px 40px 0;display:grid;grid-template-columns:1fr auto;gap:30px}"
      + ".lab{font-size:9px;color:" + a + ";border-left:2px solid " + a + ";padding-left:6px;margin-bottom:6px}"
      + ".nm{font-size:12.5px;font-weight:700;color:#111827}.ln{font-size:10px;color:#4B5563;margin-top:2px;line-height:1.45;max-width:320px}.ln b{color:#111827;font-weight:700;margin-right:6px}"
      + ".kv{display:grid;grid-template-columns:auto auto;gap:3px 16px;font-size:10px}.kv span{color:#4B5563;font-weight:600}.kv b{color:#111827;font-weight:600;text-align:right}"
      + ".itmw{padding:22px 40px 0}.itm{width:100%;border-collapse:collapse}"
      + ".itm th{background:" + a + ";color:#fff;font-size:10px;font-weight:500;text-align:left;padding:9px 12px}.itm th:first-child{border-radius:5px 0 0 5px}.itm th:last-child{border-radius:0 5px 5px 0}"
      + ".itm td{padding:9px 12px;font-size:11px;border-bottom:1px solid " + rule + "}.itm tr:nth-child(even) td{background:" + zebra + "}.r{text-align:right}"
      + ".money{padding:22px 40px 0;display:flex;justify-content:flex-end}.tot{width:300px}"
      + ".tl{display:flex;justify-content:space-between;font-size:11.5px;padding:5px 0;color:#374151}.tl span+span{color:#111827}"
      + ".gt{display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid #D1D5DB;margin-top:6px;padding-top:10px}.gt .l{font-size:13px;color:#111827}.gt .v{font-size:17px;font-weight:700;color:" + a + "}"
      + ".gtq{text-align:right;font-size:10px;color:#6B7280;margin-top:4px}"
      + ".wd{margin-top:12px;border-bottom:1px solid #D1D5DB;padding-bottom:12px}.wd span{display:block;font-size:9px;color:#9CA3AF}.wd b{font-size:11.5px;color:#111827;font-weight:500}"
      + ".foot{background:" + band + ";margin-top:30px;padding:28px 40px 30px;display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:30px;align-items:end}"
      + ".foot h5{font-size:10.5px;font-weight:700;color:#111827;margin:0 0 6px}.foot ol{margin:0 0 14px;padding-left:16px;font-size:9.5px;color:#4B5563;line-height:1.6}.foot .nt{font-size:9.5px;color:#4B5563;line-height:1.6;margin-bottom:12px}.foot .ct{font-size:9.5px;color:#4B5563}.foot .ct b{color:#111827}"
      + ".sg{text-align:center}.sg .sfor{font-size:10px;color:#374151}.sg .sline{border-bottom:1px solid #9CA3AF;margin:34px 0 5px}.sg .scap{font-size:9.5px;color:#6B7280}"
      + ".qr{text-align:center;margin-bottom:8px}.qrc{font-size:9px;color:#6B7280}"
      + EINV_CSS + "@media screen and (max-width:760px){.sheet{zoom:.7}}";
    var kv = function (k, v) { return v ? '<span>' + k + '</span><b>' + esc(v) + '</b>' : ''; };
    var body = '<div class="sheet"><div class="band"><div class="ttl">Tax Invoice</div>'
      + '<div class="by"><div><div class="k">Invoice by</div><div class="n">' + esc(s.name) + '</div><div class="l">' + [String(s.address || '').split(/\n/).map(esc).join('<br>'), s.gstin ? 'GSTIN ' + esc(s.gstin) : ''].filter(Boolean).join('<br>') + '</div></div>'
      + (f.logo ? '<div class="tile">' + logoImg(f, 40) + '</div>' : '') + '</div></div>'
      + '<div class="sec"><div><div class="lab">Billed to</div><div class="nm">' + esc(b.name) + '</div>' + (b.address ? '<div class="ln">' + esc(b.address) + '</div>' : '')
      + (b.gstin ? '<div class="ln" style="margin-top:8px"><b>GST</b>' + esc(b.gstin) + '</div>' : '') + (f.bState ? '<div class="ln"><b>State</b>' + esc(f.bState) + '</div>' : '') + (f.bPhone ? '<div class="ln"><b>Contact</b>' + esc(f.bPhone) + '</div>' : '') + '</div>'
      + '<div><div class="lab">Invoice details</div><div class="kv">' + kv('Invoice #', f.inv) + kv('Invoice Date', f.date) + kv('Due Date', fdate(d.due)) + kv('Place of supply', f.pos) + kv('Reverse charge', f.rcm) + kv('Vehicle no.', f.veh) + kv('E-Way Bill no.', f.eway) + '</div></div></div>'
      + '<div class="itmw"><table class="itm"><thead><tr><th style="width:30px">#</th><th>Item description</th><th style="width:84px">HSN/SAC</th><th class="r" style="width:84px">Qty</th><th class="r" style="width:112px">Rate</th><th class="r" style="width:100px">Amount</th></tr></thead>'
      + '<tbody>' + itemRows(f, false) + '</tbody></table>' + (eInvBlock(d, 'einv') ? '<div style="margin-top:12px">' + eInvBlock(d, 'einv') + '</div>' : '') + '</div>'
      + '<div class="money"><div class="tot"><div class="tl"><span>Sub Total</span><span>₹ ' + f.taxable + '</span></div>' + taxRows(f, 'tl')
      + '<div class="gt"><span class="l">Total</span><span class="v">₹ ' + f.grand + '</span></div><div class="gtq">' + qtyTotalEl(f) + '</div>'
      + '<div class="wd"><span>Invoice Total (in words)</span><b>' + esc(f.words) + '</b></div></div></div>'
      + '<div class="foot"><div>' + (f.cfg.showDeclaration && f.terms.length ? '<h5>Terms and Conditions</h5><ol>' + f.terms.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>' : '')
      + (function () { var n = [notesLine(f, s), f.cfg.footerNote ? esc(f.cfg.footerNote) : ''].filter(Boolean).join('<br>'); return n ? '<h5>Additional Notes</h5><div class="nt">' + n + '</div>' : ''; })()
      + (contactLine(f, s) ? '<div class="ct">' + contactLine(f, s) + '</div>' : '') + '</div><div>' + qrBlock(f) + signBlock(f, 'sg') + '</div></div></div>';
    return doc(f, 'modern', css, body);
  }

  function business(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b, a = f.cfg.accent || '#2563EB';
    var head = tint(a, '22'), line = '#D1D5DB';
    var css = "body{font-family:" + f.cfg.font + ";color:#1F2937;font-size:11px;line-height:1.5;padding:0;background:#fff}"
      + ".sheet{max-width:820px;margin:0 auto;padding:36px 40px 40px}"
      + ".top{display:flex;justify-content:space-between;align-items:flex-start}.co{display:flex;gap:12px;align-items:center}.co .n{font-size:15px;font-weight:800;color:#111827;letter-spacing:-.01em}.co .t{font-size:9px;color:#6B7280;letter-spacing:.04em;text-transform:uppercase;margin-top:2px}"
      + ".ttl{font-size:30px;font-weight:300;color:#111827;letter-spacing:-.01em}"
      + ".cols{display:grid;grid-template-columns:1.2fr 1.2fr 1fr;gap:26px;margin-top:26px}.cols h4{font-size:12px;font-weight:700;color:#111827;margin:0 0 6px}.cols .l{font-size:10px;color:#374151;line-height:1.55}.cols .l b{color:#111827}"
      + ".meta{display:grid;grid-template-columns:auto auto;gap:4px 12px;font-size:10px;justify-content:end}.meta span{font-weight:700;color:#111827}.meta b{font-weight:400;color:#111827;text-align:right}.meta .gap{grid-column:1/-1;height:12px}"
      + ".itm{width:100%;border-collapse:collapse;margin-top:24px}.itm th{background:" + head + ";font-size:10px;font-weight:700;color:#111827;text-align:left;padding:9px 12px;border:1px solid " + line + "}.itm td{padding:10px 12px;font-size:10.5px;border:1px solid " + line + ";vertical-align:top}.r{text-align:right}"
      + ".bot{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:30px;margin-top:22px;align-items:start}"
      + "h5{font-size:10.5px;font-weight:700;color:#111827;margin:0 0 6px}ol{margin:0 0 16px;padding-left:16px;font-size:9.5px;color:#4B5563;line-height:1.6}.nt{font-size:9.5px;color:#4B5563;line-height:1.6;margin-bottom:16px}"
      + ".tb{border:1px solid #111827;border-collapse:collapse;width:100%}.tb td{padding:8px 12px;font-size:10.5px;border-bottom:1px solid #111827}.tb td:first-child{text-align:right;color:#374151;border-right:1px solid #111827;width:58%}.tb td:last-child{text-align:right;font-weight:600}"
      + ".tb tr.tot td{background:" + a + ";color:#fff;font-weight:700;border-color:" + a + "}.tb tr.wd td{font-size:9.5px;text-align:left;border-bottom:0;font-weight:400;color:#374151}.tb tr.wd td b{display:block;font-weight:700;color:#111827;margin-bottom:2px}"
      + ".sig{text-align:right;margin-top:56px}.sig .sfor{font-size:10px;color:#374151;margin-bottom:34px}.sig .sline{display:inline-block;min-width:200px;border-top:1px solid #9CA3AF;padding-top:5px;font-size:10px;color:#374151}"
      + ".enq{border:1px solid #111827;padding:12px;text-align:center;font-size:11px;margin-top:40px}.enq b{font-weight:700}.qr{text-align:right}.qrc{font-size:9px;color:#6B7280}"
      + EINV_CSS + "@media screen and (max-width:760px){.sheet{zoom:.7}}";
    var m = function (k, v) { return v ? '<span>' + k + '</span><b>' + esc(v) + '</b>' : ''; };
    var isExportB = String(d.type || '').toLowerCase() === 'export';
    var taxTr = f.interState ? '<tr><td>IGST @ ' + f.gstR + ' %</td><td>₹ ' + f.igst + '</td></tr>'
      : '<tr><td>CGST @ ' + f.halfR + ' %</td><td>₹ ' + f.cgst + '</td></tr><tr><td>SGST @ ' + f.halfR + ' %</td><td>₹ ' + f.sgst + '</td></tr>';
    var body = '<div class="sheet"><div class="top"><div class="co">' + (f.logo ? logoImg(f, 44) : '') + '<div><div class="n">' + esc(s.name) + '</div>' + (f.tagline ? '<div class="t">' + esc(f.tagline) + '</div>' : '') + '</div></div><div class="ttl">Tax Invoice</div></div>'
      + '<div class="cols"><div><h4>Invoice by</h4><div class="l">' + esc(s.name) + (s.address ? '<br>' + String(s.address).split(/\n/).map(esc).join('<br>') : '') + (f.unitAddr ? '<br><b>Unit</b> ' + esc(f.unitAddr) : '') + '<br><b>GSTIN</b> ' + esc(s.gstin || '') + (f.pan ? ' &nbsp; <b>PAN</b> ' + esc(f.pan) : '') + (f.msme ? '<br><b>MSME</b> ' + esc(f.msme) : '') + ((f.tel || s.email) ? '<br>' + esc([f.tel, s.email].filter(Boolean).join(' · ')) : '') + '</div></div>'
      + '<div><h4>Invoice to</h4><div class="l">' + esc(b.name) + (b.address ? '<br>' + esc(b.address) : '') + (b.gstin ? '<br><b>GSTIN</b> ' + esc(b.gstin) : '') + (f.bState ? '<br><b>State</b> ' + esc(f.bState) : '') + (f.bPhone ? '<br>' + esc(f.bPhone) : '') + '</div></div>'
      + '<div><div class="meta">' + m('Invoice No:', f.inv) + m('Invoice Date:', f.date) + m('Due Date:', fdate(d.due)) + '<div class="gap"></div>' + (isExportB ? m('Country of supply:', (d.export && d.export.country) || '') : '') + m('Place of supply:', f.pos) + m('Reverse charge:', f.rcm) + m('Vehicle No:', f.veh) + m('E-Way Bill No:', f.eway) + '</div></div></div>'
      + '<table class="itm"><thead><tr><th>Item #/Item description</th><th style="width:84px">HSN/SAC</th><th class="r" style="width:84px">Quantity</th><th class="r" style="width:112px">Rate</th><th class="r" style="width:100px">Amount</th></tr></thead>'
      + '<tbody>' + itemRows(f, true) + '</tbody></table>' + (eInvBlock(d, 'einv') ? '<div style="margin-top:14px">' + eInvBlock(d, 'einv') + '</div>' : '')
      + '<div class="bot"><div>' + (f.cfg.showDeclaration && f.terms.length ? '<h5>Terms and Conditions</h5><ol>' + f.terms.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>' : '')
      + (function () { var n = [notesLine(f, s), f.cfg.footerNote ? esc(f.cfg.footerNote) : ''].filter(Boolean).join('<br>'); return n ? '<h5>Additional Notes</h5><div class="nt">' + n + '</div>' : ''; })() + '</div>'
      + '<div><table class="tb"><tr><td>Sub Total</td><td>₹ ' + f.taxable + '</td></tr>' + taxTr + '<tr class="tot"><td>Total Amount</td><td>₹ ' + f.grand + '</td></tr>'
      + '<tr class="wd"><td colspan="2"><b>Invoice Total In Words:</b>' + esc(f.words) + '<br>Total quantity: ' + qtyTotalEl(f) + '</td></tr></table>'
      + qrBlock(f) + (f.cfg.showSignature ? '<div class="sig"><div class="sfor">for <b>' + esc(f.signatory) + '</b></div><div class="sline">Authorised Signatory</div></div>' : '') + '</div></div>'
      + (contactLine(f, s) ? '<div class="enq">' + contactLine(f, s) + '</div>' : '') + '</div>';
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
    var eInv = eInvBlock(d, 'einv bb');   // IRN gate + the official signed QR, shared
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
      + '<tr><th>S.No.</th><th>HSN CODE</th><th>DESCRIPTION OF GOODS</th><th>QTY<br>(' + esc(f.unit || '') + ')</th><th>RATE<br>(P.' + esc(f.rateUnit || f.unit || '') + ')</th><th>AMOUNT</th></tr>'
      + '<tr><td class="c">1.</td><td class="c">' + esc(f.hsn) + '</td><td><b>' + esc(f.product) + '</b>' + (f.unitsDiffer ? '<br><span style="font-size:9px;color:#444">' + f.qty + ' ' + esc(f.unit) + ' = ' + f.billableQty + ' ' + esc(f.billableUnit) + ' × ₹' + f.rate + '</span>' : '') + '</td><td class="r">' + f.qty + '</td><td class="r">' + f.rate + '</td><td class="r">' + f.taxable + '</td></tr>'
      + '<tr class="sp"><td></td><td></td><td></td><td></td><td></td><td></td></tr></table></div>'
      + '<div class="low bb"><div class="left br"><div class="rm bb"><b>Remarks :</b></div>' + eInv + '<div class="hs">' + bandTable(f, '') + '</div></div>'
      + '<div class="right">' + taxStack + '</div></div>'
      + '<div class="wd bb"><b>AMOUNT IN WORDS:</b> ' + esc(f.words) + '</div>'
      + '<div class="ft bb"><div class="tc br"><b>TERMS &amp; CONDITIONS:</b>' + (f.cfg.showDeclaration && f.terms.length ? '<ul>' + f.terms.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '<li>E.&amp; O.E.</li></ul>' : '')
      + (bankBlock(f) ? '<div style="margin-top:4px">' + bankBlock(f) + '</div>' : '') + (f.cfg.footerNote ? '<div style="margin-top:4px">' + esc(f.cfg.footerNote) + '</div>' : '') + '</div>'
      + '<div class="sg">' + (f.cfg.showSignature ? '<div class="for">For: ' + esc(f.signatory) + '</div>' + qrBlock(f) + '<div class="as">Authorised Signatory</div>' : qrBlock(f)) + '</div></div>'
      + '<div class="ra"><b>REGD. ADDRESS</b>: ' + esc(String(s.address || '').replace(/\n/g, ', ')) + (s.unitAddress ? '<br><b>UNIT ADDRESS</b>: ' + esc(s.unitAddress) : '') + '</div>'
      + '</div>';
    return doc(f, 'detailed', css + EINV_CSS, body);
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

  /* ══════════ industrial — "Deshwali Professional Industrial Invoice" ══════════
     Commissioned 13-09-2026 as a NEW, additional design; nothing above it
     changed. Black-and-white first with one restrained accent, thin rules, a
     strong header, a compact registration strip, Bill To / Ship To, an order &
     transport grid, a multi-line product table (thead repeats on every printed
     page), an optional quality-specification block fed from the dispatch's
     analysis report, optional charges, a tax block that shows only the heads
     that apply, the total made loud, the words, bank details, editable terms,
     a signature space, and a fixed compliance footer.

     HIDE-EMPTY IS THE RULE: every optional field, cell, column, row and block
     is emitted only when its value exists. IRN / Ack / QR print only for a real
     e-invoice; the export block only when d.type === 'export'. Totals and tax
     heads come from the data model — the template never recomputes GST. */
  var INDUSTRIAL_TERMS = [
    'Goods once sold are subject to the agreed terms and conditions.',
    'Payment terms shall be as mentioned in the invoice / purchase order.',
    'Goods are supplied according to agreed product specifications.',
    'Subject to applicable GST laws and regulations.',
    'Subject to Nagaur, Rajasthan jurisdiction.'
  ];
  function industrial(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b, a = f.cfg.accent || '#1F3A5F';
    var P = function (v) { return v == null ? '' : String(v).trim(); };
    var st = function (x) { var m = P(x).match(/^(.*?)\s*\((\d\d)\)\s*$/); return m ? { name: m[1], code: m[2] } : { name: P(x), code: '' }; };
    var sSt = st(s.state), bSt = st(f.bState || b.state);
    if (!sSt.code && P(s.gstin).length >= 2) sSt.code = P(s.gstin).slice(0, 2);
    if (!bSt.code && P(b.gstin).length >= 2) bSt.code = P(b.gstin).slice(0, 2);
    var bPan = P(b.gstin).length === 15 ? P(b.gstin).slice(2, 12) : '';
    var isExport = P(d.type).toLowerCase() === 'export', ex = d.export || {};
    var eInv = !!P(d.irn);   // an acknowledgement without its IRN is not an e-invoice
    var copy = P(f.cfg.copy) || 'Original for Recipient';
    var tagline = P(s.tagline) || f.tagline;
    var ship = d.shipTo && P(d.shipTo.name) ? d.shipTo : null;
    var shipName = ship ? P(ship.name) : b.name, shipAddr = ship ? P(ship.address) : (b.address || ''), shipSt = ship ? st(ship.state) : bSt, shipG = ship ? P(ship.gstin) : (b.gstin || ''), shipPh = ship ? P(ship.phone) : f.bPhone;
    var items = (Array.isArray(d.items) && d.items.length) ? d.items
      : [{ hsn: f.hsn, product: f.product, grade: d.grade, packing: d.packing, bags: d.bags, qty: d.qty, unit: d.unit, rate: d.rate, rateUnit: d.rateUnit || d.unit || '', taxable: d.taxable }];
    var hasGrade = items.some(function (it) { return P(it.grade); }), hasPack = items.some(function (it) { return P(it.packing); }), hasBags = items.some(function (it) { return P(it.bags); });
    var charges = (d.charges || []).filter(function (c) { return c && P(c.label) && +c.amount; });
    var specRows = [], sp = d.spec || null;
    if (sp) { [['Product', 'product'], ['Grade', 'grade'], ['CaO %', 'cao'], ['MgO %', 'mgo'], ['SiO2 %', 'sio2'], ['LOI %', 'loi'], ['Mesh Size', 'mesh'], ['Reactivity', 'reactivity'], ['Packing', 'packing'], ['Batch No.', 'batch']].forEach(function (p) { if (P(sp[p[1]])) specRows.push([p[0], P(sp[p[1]])]); }); }
    else if (d.qa && Array.isArray(d.qa.params)) { d.qa.params.forEach(function (p) { if (p && P(p.value)) specRows.push([P(p.label) + (P(p.unit) ? ' ' + P(p.unit) : ''), P(p.value)]); }); }
    var roundOff = Math.round((+d.roundOff || 0) * 100) / 100, cess = +d.cess || 0, otherTax = +d.otherTax || 0;   // from the model, not re-derived
    var terms = (f.cfg.terms && f.cfg.terms.length) ? f.cfg.terms : INDUSTRIAL_TERMS;
    var words = /^Rupees /.test(f.words) ? 'Indian ' + f.words : f.words;
    var kv = function (k, v, w) { return P(v) ? '<div class="kv"><span' + (w ? ' style="min-width:' + w + 'px"' : '') + '>' + k + '</span><b>' + esc(P(v)) + '</b></div>' : ''; };
    var cell = function (k, v) { return P(v) ? '<div><span>' + k + '</span><b>' + esc(P(v)) + '</b></div>' : ''; };
    var trow = function (k, v, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + k + '</td><td class="r">' + v + '</td></tr>'; };
    var css = "body{font-family:Helvetica,Arial,sans-serif;color:#111;font-size:10.5px;line-height:1.4;padding:0;background:#fff}"
      + ".sheet{max-width:820px;margin:0 auto;padding:20px 30px 60px;position:relative}"
      + ".hd{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding-bottom:8px;border-bottom:2px solid #111}"
      + ".co{display:flex;gap:14px;align-items:center}.co .n{font-size:21px;font-weight:800;letter-spacing:.03em}.co .t{font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:#444;margin-top:3px;max-width:400px}"
      + ".ti{text-align:right;flex:none}.ti .w{font-size:18px;font-weight:800;letter-spacing:.14em;color:" + a + "}.ti .copy{font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;color:#555;margin:3px 0 6px}"
      + ".ti .kv{display:flex;justify-content:flex-end;gap:10px;font-size:10px;padding:1px 0}.ti .kv span{color:#666}.ti .kv b{min-width:112px;text-align:right;font-weight:700}"
      + ".reg{display:flex;flex-wrap:wrap;border:1px solid #111;border-top:0;font-size:9.5px}.reg div{padding:5px 10px;border-right:1px solid #ccc;flex:1;white-space:nowrap}.reg div:last-child{border-right:0}.reg span{color:#666;margin-right:4px}.reg b{font-weight:700}"
      + ".par{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:9px}.box{border:1px solid #111;padding:7px 12px}"
      + ".box h4,h3{margin:0 0 5px;font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;color:" + a + ";font-weight:800}h3{margin:9px 0 4px}"
      + ".box .nm{font-size:12px;font-weight:700}.box .ad{white-space:pre-line;margin:2px 0 5px;color:#222}"
      + ".kv{display:flex;gap:6px;font-size:10px;padding:1px 0}.kv span{color:#666;min-width:88px;flex:none}.kv b{font-weight:600}"
      + ".ot{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #111}.ot div{padding:4px 9px;border-right:1px solid #ccc;border-bottom:1px solid #ccc;font-size:10px;min-width:0}.ot div:nth-child(4n){border-right:0}.ot div span{display:block;font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#666}.ot div b{font-weight:600;word-break:break-word}"
      + "table.it{width:100%;border-collapse:collapse;margin-top:6px}.it thead{display:table-header-group}.it th{background:#111;color:#fff;font-size:8.5px;letter-spacing:.06em;text-transform:uppercase;padding:7px 8px;text-align:left;border:1px solid #111}"
      + ".it td{border:1px solid #333;padding:6px 8px;font-size:10.5px;vertical-align:top}.it tbody tr{break-inside:avoid}.r{text-align:right}.c{text-align:center}"
      + ".low{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;margin-top:9px;align-items:start}.low>div{break-inside:avoid}"
      + ".spec,.chg{border:1px solid #111;padding:8px 12px;margin-bottom:12px}.spec table,.chg table{width:100%;border-collapse:collapse;font-size:10px}.spec td,.chg td{padding:2px 0;border-bottom:1px dotted #ccc}.spec td:last-child,.chg td:last-child{text-align:right;font-weight:600}"
      + ".tx{width:100%;border-collapse:collapse;border:1px solid #111}.tx td{padding:4px 10px;border-bottom:1px solid #ddd;font-size:10.5px}.tx td.r{font-weight:600}"
      + ".tx tr.tot td{background:#111;color:#fff;font-weight:800;font-size:13.5px;border-bottom:0;padding:8px 10px}.tx tr.tot td small{display:block;font-size:8px;letter-spacing:.12em;font-weight:600;opacity:.85}"
      + ".words{border:1px solid #111;border-top:0;padding:7px 10px;font-size:10.5px}.words span{font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:#666;display:block}.words b{font-weight:700}"
      + ".bank .kv span{min-width:110px}ol{margin:0;padding-left:14px;font-size:9.5px;line-height:1.45;color:#222}"
      + ".auth{text-align:right;border:1px solid #111;padding:8px 12px;min-height:92px;margin-top:10px;display:flex;flex-direction:column;justify-content:space-between}.auth .for{font-weight:800;font-size:11px;letter-spacing:.04em}.auth .sg{font-size:9px;color:#666}.auth .sg b{display:block;color:#111;font-size:10.5px;margin-top:2px}"
      + ".ein{border:1px solid #111;padding:6px 12px;margin-top:9px;display:flex;gap:14px;align-items:flex-start;font-size:9.5px;word-break:break-all;break-inside:avoid}.ein img{width:96px;height:96px;flex:none}"
      + ".ex{border:1px solid " + a + ";padding:8px 12px;margin-top:12px;break-inside:avoid}.ex .kv span{min-width:150px}.ex .decl{font-weight:700;margin-top:4px}"
      + ".ft{margin-top:12px;padding-top:6px;border-top:1px solid #111;font-size:8.5px;color:#444;display:flex;justify-content:space-between;gap:12px}"
      + "@media print{.ft{position:fixed;left:0;right:0;bottom:0;margin:0;padding:6px 30px 0;background:#fff}}@media screen and (max-width:760px){.sheet{zoom:.7}}";
    var qUnit = P(items[0].unit) || f.unit || '';   // never a unit nobody entered
    var rUnit = P(items[0].rateUnit) || ((Array.isArray(d.items) && d.items.length) ? P(items[0].unit) : '') || f.rateUnit || qUnit;   // the rate's OWN unit — a Kg line priced per Ton says so
    /* Only the numeric columns are sized; Product Description — the legally
       required description of goods — takes everything that is left and is
       floored at 150px, so it is always the widest text column on A4. */
    var thead = '<tr><th style="width:32px">Sr. No.</th><th style="width:66px">HSN/SAC</th><th style="min-width:150px">Product Description</th>' + (hasGrade ? '<th style="width:88px">Grade / Specification</th>' : '') + (hasPack ? '<th style="width:66px">Packing</th>' : '') + (hasBags ? '<th class="r" style="width:48px">No. of Bags</th>' : '')
      + '<th class="r" style="width:66px">Qty' + (qUnit ? ' (' + esc(qUnit) + ')' : '') + '</th><th class="r" style="width:70px">Rate' + (rUnit ? ' / ' + esc(rUnit) : '') + '</th><th class="r" style="width:92px">Taxable Value (₹)</th></tr>';
    var rows = items.map(function (it, i) {
      var note = convNote(it), rowRu = P(it.rateUnit) || rUnit;
      return '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(P(it.hsn) || f.hsn) + '</td><td><b>' + esc(P(it.product)) + '</b>' + (P(it.desc) ? '<br><span style="color:#555">' + esc(P(it.desc)) + '</span>' : '') + (note ? '<br><span style="color:#555;font-size:9px">' + note + '</span>' : '') + '</td>'
        + (hasGrade ? '<td>' + esc(P(it.grade)) + '</td>' : '') + (hasPack ? '<td>' + esc(P(it.packing)) + '</td>' : '') + (hasBags ? '<td class="r">' + esc(P(it.bags)) + '</td>' : '')
        + '<td class="r">' + qfmt(it.qty) + '</td><td class="r">' + fmt(it.rate) + (rowRu && rowRu !== rUnit ? '<br><span style="font-size:9px;color:#555">/ ' + esc(rowRu) + '</span>' : '') + '</td><td class="r">' + fmt(lineTaxable(it)) + '</td></tr>';
    }).join('');
    var order = cell('PO Number', d.po) + cell('PO Date', fdate(d.poDate)) + cell('Transport Mode', f.transport) + cell('Vehicle Number', f.veh) + cell('LR / GR/RR No.', f.grrr)
      + cell('Dispatch From', f.unitAddr || s.station || '') + cell('Place of Supply', f.pos) + cell('Delivery Station', f.station) + cell('Reverse Charge', f.rcm);
    var tax = '<table class="tx">' + trow('Subtotal / Taxable Value', f.taxable)
      + (isExport ? trow('IGST — zero-rated export under LUT', f.igst) : f.interState ? trow('IGST @ ' + f.gstR + ' %', f.igst) : trow('CGST @ ' + f.halfR + ' %', f.cgst) + trow('SGST @ ' + f.halfR + ' %', f.sgst))
      + (cess ? trow('Cess', fmt(cess)) : '') + (otherTax ? trow('Other Tax', fmt(otherTax)) : '') + (roundOff ? trow('Round Off', (roundOff > 0 ? '+' : '') + fmt(roundOff)) : '')
      + '<tr class="tot"><td><small>Total Invoice Value</small></td><td class="r">₹ ' + f.grand + '</td></tr>' + trow('Total Quantity', qtyTotalEl(f)) + '</table>'
      + '<div class="words"><span>Amount in words</span><b>' + esc(words) + '</b></div>';
    var eblock = eInvBlock(d, 'einv ein');
    /* Only the export facts that exist; nothing defaulted (no invented
       "Country of Origin: India"). No facts at all → no block: the title and the
       zero-rated IGST line already say what this is. */
    var xrows = isExport ? kv('IEC', f.iec) + kv('LUT No.', ex.lut || f.lut) + kv('Shipping Bill No.', ex.shippingBill) + kv('Port of Loading', ex.portLoading) + kv('Port of Discharge', ex.portDischarge)
      + kv('Country of Destination', ex.country) + kv('Country of Origin', ex.origin) + kv('Currency', ex.currency) + kv('Exchange Rate', ex.fx) + kv('Incoterms', ex.incoterms) + kv('Container No.', ex.container)
      + (P(ex.declaration) ? '<div class="decl">' + esc(P(ex.declaration)) + '</div>' : '') : '';
    var xblock = xrows ? '<div class="ex"><h3>Export Details</h3>' + xrows + '</div>' : '';
    var body = '<div class="sheet">'
      + '<div class="hd"><div class="co">' + (f.logo ? logoImg(f, 50) : '') + '<div><div class="n">' + esc(s.name) + '</div>' + (tagline ? '<div class="t">' + esc(tagline) + '</div>' : '') + '</div></div>'
      + '<div class="ti"><div class="w">' + (isExport ? 'EXPORT TAX INVOICE' : 'TAX INVOICE') + '</div><div class="copy">' + esc(copy) + '</div>'
      + kv('Invoice No.', f.inv) + kv('Invoice Date', f.date) + kv('Due Date', fdate(d.due)) + (eInv ? kv('E-Invoice Status', 'IRN generated') : '') + kv('E-Way Bill No.', f.eway) + kv('E-Way Bill Date', fdate(d.ewayDate)) + '</div></div>'
      + '<div class="reg">' + (s.gstin ? '<div><span>GSTIN</span><b>' + esc(s.gstin) + '</b></div>' : '') + (f.pan ? '<div><span>PAN</span><b>' + esc(f.pan) + '</b></div>' : '') + (f.iec ? '<div><span>IEC</span><b>' + esc(f.iec) + '</b></div>' : '') + (f.msme ? '<div><span>Udyam/MSME</span><b>' + esc(f.msme) + '</b></div>' : '')
      + (sSt.name ? '<div><span>State</span><b>' + esc(sSt.name) + '</b></div>' : '') + (sSt.code ? '<div><span>State Code</span><b>' + esc(sSt.code) + '</b></div>' : '') + '</div>'
      + '<div class="par"><div class="box"><h4>Bill To</h4><div class="nm">' + esc(b.name) + '</div>' + (b.address ? '<div class="ad">' + esc(b.address) + '</div>' : '') + kv('State', bSt.name) + kv('State Code', bSt.code) + kv('GSTIN', b.gstin) + kv('PAN', bPan) + kv('Contact', f.bPhone) + kv('Email', f.bEmail) + '</div>'
      + '<div class="box"><h4>Ship To</h4><div class="nm">' + esc(shipName) + '</div>' + (shipAddr ? '<div class="ad">' + esc(shipAddr) + '</div>' : '') + kv('State', shipSt.name) + kv('State Code', shipSt.code) + kv('GSTIN', shipG) + kv('Place of Supply', f.pos) + kv('Contact', shipPh) + '</div></div>'
      + (order ? '<h3>Order &amp; Transport Details</h3><div class="ot">' + order + '</div>' : '')
      + '<h3>Products</h3><table class="it"><thead>' + thead + '</thead><tbody>' + rows + '</tbody></table>'
      + '<div class="low"><div class="bank">' + (specRows.length ? '<div class="spec"><h3 style="margin-top:0">Product / Quality Specification</h3><table>' + specRows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table></div>' : '')
      + (charges.length ? '<div class="chg"><h3 style="margin-top:0">Additional Charges</h3><table>' + charges.map(function (c) { return '<tr><td>' + esc(P(c.label)) + '</td><td>₹ ' + fmt(c.amount) + '</td></tr>'; }).join('') + '</table></div>' : '')
      + ((s.bank || s.accNo || s.upi) ? '<h3 style="margin-top:0">Bank Details</h3>' + kv('Account Name', s.name) + kv('Bank Name', s.bank) + kv('Account Number', s.accNo) + kv('IFSC', s.ifsc) + kv('Branch', s.bankBranch) + kv('UPI', s.upi) : '')
      + '<h3>Terms &amp; Conditions</h3><ol>' + terms.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol></div>'
      + '<div>' + tax + '<div class="auth"><div class="for">FOR ' + esc(String(s.name || '').toUpperCase()) + '</div>' + qrBlock(f) + '<div class="sg">Digital Signature / Signature<b>Authorized Signatory</b></div></div></div></div>' + eblock + xblock
      + '<div class="ft"><div>' + [s.address ? 'Registered Address: ' + esc(String(s.address).replace(/\n/g, ', ')) : '', f.tel ? 'Phone: ' + esc(f.tel) : '', s.gstin ? 'GSTIN: ' + esc(s.gstin) : ''].filter(Boolean).join(' &nbsp;·&nbsp; ') + '</div><div>This is a computer-generated invoice.</div></div>'
      + '</div>';
    return doc(f, 'industrial', css + EINV_CSS, body);
  }

  /* ══════════ premium — "Deshwali Premium Invoice" ══════════
     Commissioned 18-09-2026 from the firm's own quotation PDF (DM/QT/2026-27/922):
     a navy letterhead band with the logo and the firm name, a gold rule, one
     contact line, a boxed four-cell strip (no. · date · due/e-way · place of
     supply), FROM — SUPPLIER / TO — BUYER boxes, a navy table (description in
     navy bold with a grey sub-line, HSN, packing when present, qty, rate, amount),
     a right-aligned totals block ending in the bold total, the amount in words,
     TERMS AND CONDITIONS as a two-column list, Bank Details + Declaration boxes,
     a closing line, "For <firm>" with a round seal and "Authorised Signatory &
     Seal", and a one-line footer. Because this is a TAX INVOICE and not an
     offer, the quotation's letter paragraph and "To confirm this order" box are
     replaced by the copy label and the invoice declaration.

     Same discipline as every other design: every value comes from the record,
     empty optional fields are not printed, units through units-core (a Kg line
     priced per Ton shows its arithmetic), IRN/QR only for a real e-invoice, the
     export block only when there is something to say. */
  var PREMIUM_NAVY = '#0E2A47', PREMIUM_GOLD = '#C9A227';   // sampled from the firm's quotation PDF (18-09-2026)
  /* "DESHWALI MINERALS" → two lines, as the letterhead sets it. */
  /* The firm's OWN logo, printed white on the band. With logoMark 'gem' (the
     Deshwali diamond) facet lines are drawn over it in the band's navy — any
     part of a line outside the silhouette is navy on navy and vanishes, so no
     mask, nothing that can fail to load. A firm without a logo gets the vector
     gem below. */
  /* The firm's letterhead LOCKUP (logo + wordmark as one white-on-transparent
     vector, the file the owner sent on 18-09-2026) when it has one; else the
     firm's logo printed white beside the two-line wordmark. */
  function bandLockup(f, h) {
    var src = String(f.s.lockup || '').trim(); if (!src) return '';
    if (src.charAt(0) === '/' && typeof location !== 'undefined' && location.origin && /^https?:/.test(location.origin)) src = location.origin + src;
    return '<img class="lockup" src="' + esc(src) + '" alt="' + esc(f.s.name || 'logo') + '" style="height:' + h + 'px;width:auto;display:block">';
  }
  function bandLogo(f, h) {
    if (!f.logo) return gemMark(h);
    var src = f.logo; if (src.charAt(0) === '/' && typeof location !== 'undefined' && location.origin && /^https?:/.test(location.origin)) src = location.origin + src;
    var w = Math.round(h * 1.528), gem = f.s && f.s.logoMark === 'gem';
    return '<span class="lg" style="position:relative;display:inline-block;width:' + w + 'px;height:' + h + 'px;flex:none"><img src="' + esc(src) + '" alt="' + esc(f.s.short || f.s.name || 'logo') + '" style="position:absolute;left:0;top:0;width:' + w + 'px;height:' + h + 'px;object-fit:contain;filter:brightness(0) invert(1)">'
      + (gem ? '<svg style="position:absolute;left:0;top:0" width="' + w + '" height="' + h + '" viewBox="0 0 1000 655" preserveAspectRatio="none" aria-hidden="true"><g stroke="' + PREMIUM_NAVY + '" stroke-width="12" fill="none" stroke-linejoin="round" stroke-linecap="round"><line x1="0" y1="177" x2="1000" y2="177"/><polyline points="176,0 330,177 500,655"/><polyline points="831,0 670,177 500,655"/><line x1="330" y1="177" x2="500" y2="0"/><line x1="670" y1="177" x2="500" y2="0"/><line x1="0" y1="177" x2="176" y2="0"/><line x1="1000" y1="177" x2="831" y2="0"/></g></svg>' : '') + '</span>';
  }
  function gemMark(h) { return '<svg class="gem" width="' + Math.round(h * 1.2) + '" height="' + h + '" viewBox="0 0 120 100" aria-hidden="true"><polygon points="18,36 36,12 84,12 102,36 60,94" fill="#fff" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><g stroke="' + PREMIUM_NAVY + '" stroke-width="2" fill="none" stroke-linejoin="round"><line x1="18" y1="36" x2="102" y2="36"/><polyline points="36,12 46,36 60,94"/><polyline points="84,12 74,36 60,94"/><line x1="46" y1="36" x2="60" y2="12"/><line x1="74" y1="36" x2="60" y2="12"/></g></svg>'; }
  /* "8875020202, 9460767676" → "+91 88750 20202, +91 94607 67676" (the PDF's form). */
  function intlPhones(tel) { return String(tel || '').split(/[,/]/).map(function (p) { var s = p.trim(), d = s.replace(/\D/g, ''); if (d.length === 10) return '+91 ' + d.slice(0, 5) + ' ' + d.slice(5); if (d.length === 12 && d.slice(0, 2) === '91') return '+91 ' + d.slice(2, 7) + ' ' + d.slice(7); return s; }).filter(Boolean).join(', '); }
  function wordmark(name) { var w = String(name || '').trim().split(/\s+/); return w.length >= 2 ? esc(w[0]) + '<br>' + esc(w.slice(1).join(' ')) : esc(name || ''); }
  var PREMIUM_DECL = 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.';
  /* The round seal shared by the Premium and Classic designs — the reference
     stamp, measured (see the notes inside). stampSeal(name, line) → svg. */
  function stampSeal(name, sealLine) {
    /* The seal, measured on the owner's quotation PDF at 5000px (viewBox units,
       outer edge = 50): a 1.75-wide outer ring at r 49.1 with a 0.8 ring at 46.6;
       an inner pair at 33.7 (0.8) and 32.0 (0.6); the firm name on a 39.3 baseline
       spanning 140° of arc in 7.8px bold, the stamp line hanging from a 45.0
       baseline over up to 148° in 6.2px; 5-point stars 3.3 tall at r 41.4 on the
       horizontal; dash-dot marks (8-long lines, r=1 dot) at y 29 and 69; ink
       #0A1F5C (the ring core); 64px on the page (16.9mm on the reference). The
       text is fitted to its arc: spacing opens up to the reference's span, a
       long name is compressed rather than clipped. */
    var SB = '#0A1F5C';
    var TOP_R = 39.3, BOT_R = 45.0;
    /* Centred the one way every renderer agrees on: text-anchor="middle" at
       startOffset="50%" and NO textLength. Two earlier cuts drifted on the
       owner's Mac — textLength + middle (Chrome centres the natural width,
       then stretches), then a computed startOffset + textLength (his renderer
       ignored textLength on a textPath and the text sat where it started).
       The spread is letter-spacing only; a name too long for the arc is the
       one case that still asks for textLength, compressing glyphs rather than
       clipping. */
    var arcText = function (txt, fs, radius, degrees, gap) {
      var target = degrees / 360 * 2 * Math.PI * radius, est = txt.length * fs * 0.72;
      return ' startOffset="50%"' + (est > target ? ' textLength="' + target.toFixed(1) + '" lengthAdjust="spacingAndGlyphs"' : '');
    };
    var star = function (cx, cy) { var p = []; for (var k = 0; k < 10; k++) { var a = (-90 + k * 36) * Math.PI / 180, r = k % 2 ? 1.35 : 3.3; p.push((cx + r * Math.cos(a)).toFixed(2) + ',' + (cy + r * Math.sin(a)).toFixed(2)); } return '<polygon points="' + p.join(' ') + '" fill="' + SB + '"/>'; };
    var mark = function (y) { return '<line x1="38.7" y1="' + y + '" x2="46.8" y2="' + y + '"/><circle cx="50" cy="' + y + '" r="1" fill="' + SB + '" stroke="none"/><line x1="53.2" y1="' + y + '" x2="61.3" y2="' + y + '"/>'; };
    var topTxt = String(name || '').toUpperCase(), botTxt = String(sealLine || '').toUpperCase();
    var seal = '<svg class="seal" width="64" height="64" viewBox="0 0 100 100" aria-hidden="true"><defs><path id="sealTop" d="M' + +(50 - TOP_R).toFixed(1) + ',50 a' + TOP_R + ',' + TOP_R + ' 0 0,1 ' + +(2 * TOP_R).toFixed(1) + ',0"/><path id="sealBot" d="M' + +(50 - BOT_R).toFixed(1) + ',50 a' + BOT_R + ',' + BOT_R + ' 0 0,0 ' + +(2 * BOT_R).toFixed(1) + ',0"/></defs>'
      + '<g fill="none" stroke="' + SB + '"><circle cx="50" cy="50" r="49.1" stroke-width="1.75"/><circle cx="50" cy="50" r="46.6" stroke-width=".8"/><circle cx="50" cy="50" r="33.7" stroke-width=".8"/><circle cx="50" cy="50" r="32" stroke-width=".6"/></g>'
      + '<text font-size="7.8" font-weight="700" fill="' + SB + '" text-anchor="middle" letter-spacing=".2"><textPath href="#sealTop"' + arcText(topTxt, 7.8, TOP_R, 140, 0.9) + '>' + esc(topTxt) + '</textPath></text>'
      + (sealLine ? '<text font-size="6.2" font-weight="700" fill="' + SB + '" text-anchor="middle" letter-spacing=".5"><textPath href="#sealBot"' + arcText(botTxt, 6.2, BOT_R, 148, 0.8) + '>' + esc(botTxt) + '</textPath></text>' : '')
      + star(8.6, 50) + star(91.4, 50)
      + '<g stroke="' + SB + '" stroke-width=".7">' + mark(29) + mark(69) + '</g></svg>';
    return seal;
  }

  /* the Premium sheet's CSS — shared with the quotation, which is the same page */
  function premiumCss() {
    return "@page{size:A4;margin:0}body{font-family:'DejaVu Sans',Verdana,'Bitstream Vera Sans',Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:8.7px;line-height:1.4;padding:0;background:#fff}"
      + ".sheet{max-width:820px;margin:0 auto;padding:0 0 16px}@media print{.sheet{max-width:none;padding:0 0 6mm;min-height:100vh;box-sizing:border-box;display:flex;flex-direction:column}.sheet .in{flex:1;display:flex;flex-direction:column}.sheet .in .close{margin-top:auto;padding-top:12px}}"
      + ".band{background:" + PREMIUM_NAVY + ";color:#fff;padding:22px 5.4% 22px 5.3%;min-height:79px;box-sizing:border-box;display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid " + PREMIUM_GOLD + "}"
      + ".band .co{display:flex;gap:18px;align-items:center}.band .lockup{height:34px!important;width:auto}.band .n{font-size:16px;font-weight:800;letter-spacing:.06em;line-height:1;text-transform:uppercase}"
      + ".band .ti{text-align:right;flex:none;padding-left:20px}.band .ti .w{font-size:16.5px;font-weight:800;letter-spacing:.1em;line-height:1}.band .ti .c{font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:" + PREMIUM_GOLD + ";margin-top:5px}"
      + ".contact{text-align:center;font-size:8px;color:#333;padding:5px 5.2% 4px;border-bottom:1px solid #d6d9de}.contact .pl{font-size:8.6px;letter-spacing:.14em;text-transform:uppercase;color:" + PREMIUM_NAVY + ";font-weight:800;margin-bottom:2px}.contact .sep{color:#6b7280;margin:0 5px}"
      + ".in{padding:14px 5.2% 0}"
      + ".meta{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #c9ced6;margin-bottom:10px}.meta div{padding:5px 9px;border-right:1px solid #c9ced6;min-width:0}.meta div:last-child{border-right:0}.meta span{display:block;font-size:6.6px;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;margin-bottom:1px}.meta b{font-size:9.6px;color:" + PREMIUM_NAVY + ";word-break:break-word}"
      + ".par{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:0 0 12px}.box{border:1px solid #c9ced6}.box h4{margin:0;padding:3px 9px;font-size:6.8px;letter-spacing:.14em;text-transform:uppercase;color:#4b5563;background:#f1f3f6;border-bottom:1px solid #c9ced6}.box .bd{padding:6px 9px 7px}"
      + ".box .nm{font-size:10.5px;font-weight:800;color:" + PREMIUM_NAVY + ";margin-bottom:3px}.box .ad{white-space:pre-line;color:#1a1a1a;margin-bottom:4px;line-height:1.35}.box .kv{font-size:8.4px}.box .kv span{color:#6b7280;margin-right:4px}.box .kv b{font-weight:400;color:#1a1a1a;margin-right:11px}"
      + "h3{margin:10px 0 4px;font-size:7.6px;letter-spacing:.16em;text-transform:uppercase;color:" + PREMIUM_NAVY + ";font-weight:800;border-bottom:2px solid " + PREMIUM_GOLD + ";padding-bottom:3px}"
      + "table.it{width:100%;border-collapse:collapse;border:1px solid #c9ced6}.it thead{display:table-header-group}.it th{background:" + PREMIUM_NAVY + ";color:#fff;font-size:6.8px;letter-spacing:.12em;text-transform:uppercase;padding:5px 6px;text-align:center}"
      + ".it td{padding:7px 7px;border-bottom:1px solid #c9ced6;border-right:1px solid #e3e6ea;font-size:8.7px;vertical-align:middle}.it td:last-child{border-right:0}.it tbody tr{break-inside:avoid}.r{text-align:right}.c{text-align:center}.it td.q{text-align:center;font-weight:800}.it td.r,.it td.q,.it td.c{white-space:nowrap}"
      + ".it .dn{font-weight:800;color:" + PREMIUM_NAVY + ";font-size:9.6px}.it .ds{color:#6b7280;font-size:7.8px;margin-top:1px}"
      + ".tot{width:100%;border-collapse:collapse;border:1px solid #c9ced6;margin-top:9px}.tot td{padding:2.5px 10px;line-height:1.3;border-bottom:1px solid #d6dae0;font-size:8.7px;vertical-align:middle}.tot td.l{text-align:right;font-size:7.4px;letter-spacing:.14em;text-transform:uppercase;color:" + PREMIUM_NAVY + ";font-weight:800;background:#f1f3f6;border-right:1px solid #d6dae0}.tot td.v{text-align:right;font-weight:800;color:" + PREMIUM_NAVY + ";font-size:9.6px;width:1%;white-space:nowrap;padding-left:30px}.tot td.l{padding-top:2.5px}.tot tr.g td.v{font-size:12.4px}.tot tr:last-child td{border-bottom:0}"
      + ".words{margin:7px 0 0;font-size:8.7px}.words b{font-weight:800}"
      + ".tc{width:100%;border-collapse:collapse}.tc td{padding:6px 0;border-bottom:1px solid #e3e6ea;font-size:8.7px;vertical-align:top;line-height:1.45}.tc td.k{width:22%;font-size:7px;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;padding-top:8px}"
      + ".two{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:12px 0 0}.pbox{border:1px solid #c9ced6;border-left:3px solid " + PREMIUM_GOLD + ";padding:8px 10px;font-size:8.6px;line-height:1.45}.pbox b.h{display:block;color:" + PREMIUM_NAVY + ";font-size:9.8px;margin-bottom:3px}"
      + ".close{display:grid;grid-template-columns:1fr auto;gap:20px;align-items:start;margin-top:14px;break-inside:avoid}.close .msg{font-size:8.2px;color:#374151;line-height:1.5;padding-top:4px}"
      + ".sig{text-align:right;min-width:220px}.sig .for{font-weight:800;color:" + PREMIUM_NAVY + ";font-size:9px}.sig .seal{margin:2px 0 0}.sig .cap{border-top:1px solid " + PREMIUM_NAVY + ";padding-top:4px;font-size:8.2px;color:#374151}"
      + ".ft{margin-top:14px;padding:6px 5.2% 0;border-top:1px solid #c9ced6;text-align:center;font-size:7.2px;color:#6b7280}"
      + ".ein{border:1px solid #c9ced6;padding:6px 10px;margin-top:8px;display:flex;gap:14px;align-items:flex-start;font-size:8.2px;word-break:break-all;break-inside:avoid}.ein img{width:88px;height:88px;flex:none}"
      + ".ex{border:1px solid " + PREMIUM_GOLD + ";padding:6px 10px;margin-top:8px;font-size:8.4px;break-inside:avoid}.ex .decl{font-weight:700;margin-top:4px}"
      + "@media screen and (max-width:760px){.sheet{zoom:.7}}";
  }
  /* an address as the reference boxes print it: street, town / State – PIN, India (a hand-broken address is kept) */
  function addrLines(addr, stateName, pin) {
    var a = String(addr || '').trim(); if (!a) return '';
    if (/\n/.test(a)) return a;   // already broken by hand
    var m = a.match(/\b(\d{6})\b/); var pn = pin || (m ? m[1] : '');
    if (!pn && !stateName) return a;
    var rest = a.replace(/\b\d{6}\b/, '');
    if (stateName) rest = rest.replace(new RegExp('\\b' + stateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), '');
    rest = rest.replace(/\bIndia\b/i, '').replace(/[\s,–-]+$/g, '').replace(/,\s*,/g, ',').replace(/\s+,/g, ',').replace(/^[\s,]+/, '').trim();
    var line2 = (stateName ? stateName + (pn ? ' – ' + pn : '') : pn) + ', India';
    return (rest ? rest + '\n' : '') + line2;
  }
  function premium(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b;
    var P = function (v) { return v == null ? '' : String(v).trim(); };
    var st = function (x) { var m = P(x).match(/^(.*?)\s*\((\d\d)\)\s*$/); return m ? { name: m[1], code: m[2] } : { name: P(x), code: '' }; };
    var sSt = st(s.state), bSt = st(f.bState || b.state);
    if (!sSt.code && P(s.gstin).length >= 2) sSt.code = P(s.gstin).slice(0, 2);
    if (!bSt.code && P(b.gstin).length >= 2) bSt.code = P(b.gstin).slice(0, 2);
    var isExport = P(d.type).toLowerCase() === 'export', ex = d.export || {};
    var eInv = !!P(d.irn);
    var copy = P(f.cfg.copy) || 'Original for Recipient';
    var items = (Array.isArray(d.items) && d.items.length) ? d.items
      : [{ hsn: f.hsn, product: f.product, desc: d.desc, grade: d.grade, packing: d.packing, qty: d.qty, unit: d.unit, rate: d.rate, rateUnit: d.rateUnit || d.unit || '', taxable: d.taxable }];
    var hasPack = items.some(function (it) { return P(it.packing); });
    var charges = (d.charges || []).filter(function (c) { return c && P(c.label) && +c.amount; });
    var roundOff = Math.round((+d.roundOff || 0) * 100) / 100, cess = +d.cess || 0, otherTax = +d.otherTax || 0;
    var terms = f.terms || [];
    var words = f.words;   // 'Rupees … Only' — the owner asked for no 'Indian Rupees' on this design
    var unitOfItems = P(items[0].unit) || f.unit || '';
    var qty3 = function (q, u) { var U = QLUnitsOpt(); var mass = U ? U.familyOf(u) === 'mass' : /^(ton|tonne|mt|t|kg|quintal)/i.test(String(u || '')); var n = +q || 0; return mass && !Number.isInteger(n * 1000) === false && mass ? n.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : qfmt(n); };
    var rUnit = P(items[0].rateUnit) || f.rateUnit || unitOfItems;
    /* Sizes are the reference PDF's, measured at 110 dpi and converted to CSS px
       (×0.873): body 8.7px, labels 7px, names 10.5px, table row 45px, totals row
       22px, band 79px. The whole page is that density — that is what makes it
       read as the same document. */
    var css = premiumCss();
    var kv = function (k, v) { return P(v) ? '<span class="kv"><span>' + k + ':</span><b>' + esc(P(v)) + '</b></span>' : ''; };
    var mcell = function (k, v) { return '<div><span>' + k + '</span><b>' + (P(v) ? esc(P(v)) : '—') + '</b></div>'; };
    var contact = [s.website ? esc(s.website) : '', s.email ? esc(s.email) : '', f.tel ? esc(intlPhones(f.tel)) : ''].filter(Boolean).join(' &nbsp;·&nbsp; ');
    /* the four-cell strip: no. · date · (due date or e-way) · place of supply */
    /* dates stay dd-mm-yyyy — the house convention every design and the compliance suite share */
    var third = P(d.due) ? mcell('Due date', fdate(d.due)) : (f.eway ? mcell('E-Way Bill No.', f.eway) : mcell('Vehicle No.', f.veh));
    var meta = '<div class="meta">' + mcell('Invoice No.', f.inv) + mcell('Date', f.date) + third + mcell('Place of supply', f.pos) + '</div>';
    var party = function (title, name, addr, gst, state, phone, email, pan, iec, attn) {
      var l = function (h) { return h ? '<div>' + h + '</div>' : ''; };
      return '<div class="box"><h4>' + title + '</h4><div class="bd"><div class="nm">' + esc(name || '') + '</div>' + (P(attn) ? '<div>' + kv('Attn.', attn) + '</div>' : '') + (P(addr) ? '<div class="ad">' + esc(P(addr)) + '</div>' : '')
        + l(kv('GSTIN', gst) + kv('State', state)) + l(kv('PAN', pan) + kv('IEC', iec)) + l(kv('Mobile', phone)) + l(kv('E-mail', email)) + '</div></div>';
    };
    var sPan = f.pan, bPan = P(b.gstin).length === 15 ? P(b.gstin).slice(2, 12) : '';
    var seller = party('From — Supplier', s.name, addrLines(s.address, sSt.name, s.pin), s.gstin, s.state, intlPhones(f.tel), '', sPan, f.iec, '');   // the e-mail is in the contact strip
    var buyer = party('To — Buyer', b.name, addrLines(b.address, bSt.name, ''), b.gstin, f.bState || b.state, f.bPhone, f.bEmail, bPan, '', b.contact || d.contact || '');
    var thead = '<tr><th style="width:34px">Sr.</th><th>Description</th><th style="width:78px">HSN</th>' + (hasPack ? '<th style="width:100px">Packing</th>' : '')
      + '<th style="width:66px">Qty' + (unitOfItems ? ' (' + esc(unitOfItems) + ')' : '') + '</th><th style="width:92px">Rate' + (rUnit ? ' / ' + esc(rUnit) : '') + '</th><th style="width:112px">Amount</th></tr>';
    var rows = items.map(function (it, i) {
      var note = convNote(it), rowRu = P(it.rateUnit) || rUnit;
      return '<tr><td class="c">' + (i + 1) + '</td><td><div class="dn">' + esc(P(it.product)) + '</div>' + (P(it.desc) || P(it.grade) ? '<div class="ds">' + esc([P(it.grade), P(it.desc)].filter(Boolean).join(' · ')) + '</div>' : '') + (note ? '<div class="ds">' + note + '</div>' : '') + '</td>'
        + '<td class="c">' + esc(P(it.hsn) || f.hsn) + '</td>' + (hasPack ? '<td class="c">' + esc(P(it.packing) || '—') + '</td>' : '')
        + '<td class="q">' + qty3(it.qty, P(it.unit) || unitOfItems) + (P(it.unit) && P(it.unit) !== unitOfItems ? ' ' + esc(P(it.unit)) : '') + '</td><td class="r">' + fmt(it.rate) + (rowRu !== rUnit ? '<br><span class="ds">/ ' + esc(rowRu) + '</span>' : '') + '</td><td class="r"><b>' + fmt(lineTaxable(it)) + '</b></td></tr>';
    }).join('') + charges.map(function (c, i) {
      return '<tr><td class="c">' + (items.length + i + 1) + '</td><td><div class="dn">' + esc(P(c.label)) + '</div>' + (P(c.desc) ? '<div class="ds">' + esc(P(c.desc)) + '</div>' : '') + '</td><td class="c">' + esc(P(c.hsn) || '9965') + '</td>' + (hasPack ? '<td class="c">—</td>' : '') + '<td class="c">—</td><td class="r">—</td><td class="r"><b>' + fmt(c.amount) + '</b></td></tr>';
    }).join('');
    var trow = function (k, v, g) { return '<tr' + (g ? ' class="g"' : '') + '><td class="l">' + k + '</td><td class="v">' + v + '</td></tr>'; };
    var goods = items.reduce(function (a, it) { return a + lineTaxable(it); }, 0), chargeSum = charges.reduce(function (a, c) { return a + (+c.amount || 0); }, 0);
    var tot = '<table class="tot">' + trow('Value of goods' + (items.length === 1 && +items[0].qty && +items[0].rate ? ' (' + qtyTotalEl(f) + ' × ' + (+items[0].rate % 1 ? fmt(items[0].rate) : Number(items[0].rate).toLocaleString('en-IN')) + (rUnit ? '/' + esc(rUnit) : '') + ')' : ''), fmt(goods))
      + (chargeSum ? trow('Charges', fmt(chargeSum)) : '')
      + (isExport ? trow('IGST — zero-rated export under LUT', f.igst) : f.interState ? trow('IGST @ ' + f.gstR + ' %' + (f.hsn ? ' (HSN ' + esc(f.hsn) + ')' : ''), f.igst) : trow('CGST @ ' + f.halfR + ' %', f.cgst) + trow('SGST @ ' + f.halfR + ' %', f.sgst))
      + (cess ? trow('Cess', fmt(cess)) : '') + (otherTax ? trow('Other tax', fmt(otherTax)) : '') + (roundOff ? trow('Round off', (roundOff > 0 ? '+' : '−') + fmt(Math.abs(roundOff))) : '')
      + trow('Total payable (goods incl. GST)', f.grand, true) + '</table>';
    var termsRows = terms.map(function (t, i) { var m = String(t).match(/^([A-Za-z][A-Za-z /&]{2,28}):\s*(.+)$/); return '<tr><td class="k">' + (m ? esc(m[1]) : String(i + 1) + '.') + '</td><td>' + esc(m ? m[2] : t) + '</td></tr>'; }).join('');
    var bank = (s.bank || s.accNo || s.upi) ? '<div class="pbox"><b class="h">Bank Details — for payment</b>' + (s.name ? 'Account name: ' + esc(s.name) + '<br>' : '') + (s.bank ? esc(s.bank) + (s.bankBranch ? ', ' + esc(s.bankBranch) : '') + '<br>' : '') + (s.accNo ? 'A/C No.: ' + esc(s.accNo) : '') + (s.ifsc ? ' &nbsp;|&nbsp; IFSC: ' + esc(s.ifsc) : '') + (s.upi ? '<br>UPI: ' + esc(s.upi) : '') + '</div>' : '';
    var decl = '<div class="pbox"><b class="h">Declaration</b>' + PREMIUM_DECL + (f.rcm === 'Yes' ? '<br>Tax is payable on reverse charge.' : '') + '</div>';
    var sealLine = P(s.sealText) || [s.city, sSt.name].filter(Boolean).join(', ');
    var seal = stampSeal(s.name, sealLine);
    var eblock = eInvBlock(d, 'einv ein');
    var xkv = function (k, v) { return P(v) ? '<div><span style="color:#6b7280;display:inline-block;min-width:150px">' + k + '</span><b>' + esc(P(v)) + '</b></div>' : ''; };
    var xrows = isExport ? xkv('IEC', f.iec) + xkv('LUT No.', ex.lut || f.lut) + xkv('Shipping Bill No.', ex.shippingBill) + xkv('Port of Loading', ex.portLoading) + xkv('Port of Discharge', ex.portDischarge) + xkv('Country of Destination', ex.country) + xkv('Country of Origin', ex.origin) + xkv('Currency', ex.currency) + xkv('Exchange Rate', ex.fx) + xkv('Incoterms', ex.incoterms) + xkv('Container No.', ex.container) + (P(ex.declaration) ? '<div class="decl">' + esc(P(ex.declaration)) + '</div>' : '') : '';
    var xblock = xrows ? '<div class="ex"><h3 style="margin-top:0">Export Details</h3>' + xrows + '</div>' : '';
    var body = '<div class="sheet">'
      + '<div class="band"><div class="co">' + (bandLockup(f, 35) || (bandLogo(f, 36) + '<div class="n">' + wordmark(s.name) + '</div>')) + '</div>'
      + '<div class="ti"><div class="w">' + (isExport ? 'EXPORT TAX INVOICE' : 'TAX INVOICE') + '</div><div class="c">' + esc(copy) + '</div></div></div>'
      + ((contact || f.tagline) ? '<div class="contact">' + (f.tagline ? '<div class="pl">' + esc(f.tagline) + '</div>' : '') + contact.split(' &nbsp;·&nbsp; ').join('<span class="sep">·</span>') + '</div>' : '')
      + '<div class="in">' + meta + '<div class="par">' + seller + buyer + '</div>'
      + ((f.transport || f.veh || f.station || f.grrr || (f.eway && P(d.due))) ? '<div class="meta" style="margin-top:0">' + mcell('Transport', f.transport) + mcell('Vehicle No.', f.veh) + mcell('Station', f.station) + mcell('GR/RR No.', f.grrr) + (f.eway && P(d.due) ? mcell('E-Way Bill No.', f.eway) : '') + '</div>' : '')
      + '<h3>' + (isExport ? 'Export supply' : 'Supply') + '</h3><table class="it"><thead>' + thead + '</thead><tbody>' + rows + '</tbody></table>'
      + tot + '<div class="words"><b>Amount in words:</b> ' + esc(words) + ((+d.igst || +d.cgst || +d.sgst) ? ' (inclusive of ' + (f.interState ? 'IGST' : 'GST') + ')' : '') + (items.length > 1 ? '<br><span style="color:#6b7280">Total quantity: ' + qtyTotalEl(f) + '</span>' : '') + '</div>'
      + eblock + xblock
      + (termsRows ? '<h3>Terms and Conditions</h3><table class="tc">' + termsRows + '</table>' : '')
      + '<div class="two">' + bank + decl + '</div>'
      + '<div class="close"><div class="msg">' + (f.cfg.footerNote ? esc(f.cfg.footerNote) + '<br>' : '') + 'Reverse charge: ' + esc(f.rcm) + (f.jurisdiction ? ' &nbsp;·&nbsp; Subject to ' + esc(f.jurisdiction) + ' jurisdiction' : '') + '</div>'
      + (f.cfg.showSignature ? '<div class="sig"><div class="for">For ' + esc(String(f.signatory || s.name || '').toUpperCase()) + '</div>' + seal + '<div class="cap">Authorised Signatory &amp; Seal</div></div>' : '') + '</div></div>'
      + '<div class="ft">Invoice ' + esc(f.inv) + (f.date ? ' · ' + esc(f.date) : '') + ' · This is a tax invoice under the CGST Rules, 2017.</div>'
      + '</div>';
    return doc(f, 'premium', css + EINV_CSS + '.einv.ein{margin-top:8px}', body);
  }

  /* ══════════ blueink — "Deshwali Classic GST Invoice" (id blueink: 'classic' is a retired id) ══════════
     Commissioned 19-09-2026 from the Raj Chemicals & Minerals tax e-invoice the
     owner photographed — its INFORMATION, in the firm's own modern language
     (his words on the first cut: "no alignment or modern design … looks dummy").
     So: the brand lockup (the navy Dark.svg — never a redrawn name), one grid
     for every block (label column 110px, colon, value), the letterhead's
     registration strip (GSTIN · PAN · IEC · MSME) against the contact line, a
     navy goods table with the diamond watermarked behind it that stretches to
     fill the page, the Raj boxes (invoice / e-way / PO left, transport / GR-RR
     / from / station / place of supply / vehicle right), Billed to / Shipped
     to, No. of Bags, Packing & Forwarding, Total Taxable Value, Remarks / LUT
     / IRN + QR against the tax stack, AMOUNT IN WORDS, terms against the seal
     and signatory, the registered address in the foot.

     HIDE-EMPTY: CIN, PO, GR-RR date, Documents through, No. of Bags, TCS,
     Round Off, LUT (export), IRN / QR, the unit address and the MSME lines
     print only when the firm or the sale carries them — nothing is invented. */
  function blueink(d, cfg) {
    var f = facts(d, cfg), s = f.s, b = f.b;
    var NAVY = '#0E2A47', INK = '#013E5B', SKY = '#44BDEC', RULE = '#c9ced6', FILL = '#f1f3f6', GREY = '#6b7280';
    var ink = (f.cfg.accent && f.cfg.accent !== DEFAULT_CFG.accent) ? f.cfg.accent : INK;
    var P = function (v) { return v == null ? '' : String(v).trim(); };
    var pan = function (g) { g = String(g || ''); return g.length === 15 ? g.slice(2, 12) : ''; };
    var dash = '&ndash;';
    var items = f.items, charges = Array.isArray(d.charges) ? d.charges.filter(function (c) { return c && P(c.label) && +c.amount; }) : [];
    var isExport = P(d.type).toLowerCase() === 'export';
    var bagsOf = function (it) { if (+it.bags) return String(+it.bags); var m = String(it.packing || d.packing || '').match(/(\d+(?:\.\d+)?)\s*kg/i); var U = QLUnitsOpt(); if (!m || !U || !(+it.qty)) return ''; var kg = U.convertQty(+it.qty, it.unit || f.unit, 'Kg'); return kg ? String(Math.round(kg / +m[1])) : ''; };
    var bags = items.map(bagsOf), hasBags = true;   // the reference always carries the column; a line without bags shows a dash
    var unitOfItems = items.length && items.every(function (it) { return (it.unit || f.unit) === (items[0].unit || f.unit); }) ? (items[0].unit || f.unit) : '';
    var rUnit = items.length && items.every(function (it) { return (it.rateUnit || it.unit || f.rateUnit) === (items[0].rateUnit || items[0].unit || f.rateUnit); }) ? (items[0].rateUnit || items[0].unit || f.rateUnit) : '';
    var css = "@page{size:A4;margin:0}body{font-family:Arial,Helvetica,'Liberation Sans',sans-serif;color:#1a1a1a;font-size:9.5px;line-height:1.4;padding:0;background:#fff}@media print{body{padding:0}}"
      + ".sheet{width:820px;margin:0 auto;padding:22px 26px 14px;box-sizing:border-box}@media print{.sheet{width:auto;padding:9mm 10mm 6mm}}@media screen and (max-width:900px){body{overflow-x:hidden}.sheet{zoom:.72}}"
      /* letterhead: lockup left, the document title right, tagline, registration strip */
      + ".lh{display:grid;grid-template-columns:1fr auto 1fr;align-items:start;gap:12px;padding-bottom:8px;border-bottom:2px solid " + ink + "}.lh .ids{font-size:8.6px;line-height:1.55;color:#374151}.lh .ids b{display:inline-block;min-width:38px;color:" + ink + ";font-weight:700}"
      + ".lh .mid{text-align:center}.lh .lk{height:46px;width:auto;display:inline-block}.lh .nm{font-size:22px;font-weight:800;color:" + ink + ";letter-spacing:.04em;text-transform:uppercase;line-height:1}"
      + ".lh .tg{font-size:8.2px;letter-spacing:.14em;text-transform:uppercase;color:" + GREY + ";margin-top:6px}"
      + ".lh .ctc{font-size:8.6px;line-height:1.55;text-align:right;color:#374151}"
      + ".ttl{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:6px 0 4px}.ttl .w{grid-column:2;font-size:12.5px;font-weight:800;letter-spacing:.14em;color:" + ink + ";border-bottom:1.5px solid " + ink + ";padding-bottom:1px}.ttl .c{grid-column:3;text-align:right;font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:" + GREY + "}"
      /* every block on one grid */
      + ".grid2{display:grid;grid-template-columns:1fr 1fr;border:1px solid " + RULE + "}.grid2+.grid2,.grid2+.dt,.dt+.grid2{border-top:0}.grid2>div{padding:5px 10px}.grid2>div:first-child{border-right:1px solid " + RULE + "}"
      + ".kv{display:flex;padding:1.2px 0;font-size:9.5px;line-height:1.35}.kv .k{width:110px;flex:none;color:" + GREY + "}.kv .c{width:10px;flex:none;color:" + GREY + "}.kv .v{flex:1;min-width:0;word-break:break-word;font-weight:700;color:#111}.kv .v .d{float:right;font-weight:400;color:#374151}.kv .v .d b{color:" + GREY + ";font-weight:400;margin-right:4px}"
      + ".ph{font-size:7.6px;letter-spacing:.14em;text-transform:uppercase;color:" + ink + ";font-weight:800;padding:4px 10px;background:" + FILL + ";border-bottom:1px solid " + RULE + "}"
      + ".pc{padding:0!important}.pc .bd{padding:5px 10px 6px}.pc .kv .k{width:64px}.dt{padding:4px 10px;border:1px solid " + RULE + ";border-top:0;font-size:9px}.dt b{color:" + GREY + ";font-weight:400;margin-right:6px;letter-spacing:.08em;text-transform:uppercase;font-size:7.6px}"
      /* the goods table fills the page */
      + ".body{position:relative;margin-top:10px}.body .fill{height:96px;border-left:1px solid " + RULE + ";border-right:1px solid " + RULE + "}"
      + "table{width:100%;border-collapse:collapse;table-layout:fixed}"
      + ".it th{background:" + ink + ";color:#fff;font-size:7.6px;letter-spacing:.12em;text-transform:uppercase;padding:6px 6px;text-align:center;vertical-align:middle;line-height:1.25;position:relative;z-index:1}"
      + ".it td{border-bottom:1px solid " + RULE + ";border-right:1px solid " + RULE + ";padding:6px;vertical-align:top;position:relative;z-index:1;font-size:9.5px}.it td:first-child{border-left:1px solid " + RULE + "}.it tr.ln{height:1px}"
      + ".r{text-align:right}.c{text-align:center}.it .dn{font-weight:700;color:" + NAVY + "}.it .ds{font-size:8.2px;color:" + GREY + ";font-weight:400}"
      + ".wm{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:0}"
      + ".sum td{border:1px solid " + RULE + ";border-top:0;padding:3.5px 8px;font-size:9px}.sum td.l{text-align:right;letter-spacing:.1em;text-transform:uppercase;color:" + ink + ";font-weight:800;font-size:7.6px;background:" + FILL + "}.sum td.v{text-align:right;font-weight:700;color:" + NAVY + ";width:104px}.sum tr:first-child td{border-top:1px solid " + RULE + "}"
      /* below the table */
      + ".low{display:grid;grid-template-columns:56% 44%;border:1px solid " + RULE + ";border-top:0}.left{border-right:1px solid " + RULE + "}"
      + ".rm{padding:5px 10px;min-height:20px;font-size:9px;border-bottom:1px solid " + RULE + "}.rm b{color:" + GREY + ";font-weight:400;margin-right:4px}"
      + ".lut{padding:5px 10px;font-size:9px;border-bottom:1px solid " + RULE + "}.lut b{color:" + GREY + ";font-weight:400;margin-right:4px}"
      + ".irn{padding:6px 10px;font-size:8.6px;line-height:1.45;display:flex;gap:10px;align-items:flex-start;border-bottom:1px solid " + RULE + "}.irn b{color:" + GREY + ";font-weight:400}.irn .id{flex:1;word-break:break-all}.irn .qr{flex:none}.qrc{font-size:7.5px;color:" + GREY + ";text-align:center}"
      + ".hs{padding:5px 10px}.hs table{width:auto}.hs th{font-weight:700;text-align:left;padding:1px 10px 1px 0;font-size:7.6px;letter-spacing:.08em;text-transform:uppercase;color:" + GREY + ";white-space:nowrap}.hs td{padding:1px 10px 1px 0;font-size:8.8px}"
      + ".tx{width:100%}.tx td{border-bottom:1px solid " + RULE + ";padding:4px 10px;font-size:9.5px;vertical-align:middle}.tx td:first-child{font-size:7.6px;letter-spacing:.1em;text-transform:uppercase;color:" + ink + ";font-weight:800;background:" + FILL + ";width:60%;border-right:1px solid " + RULE + "}.tx td:last-child{text-align:right;font-weight:700;color:" + NAVY + "}.tx tr:last-child td{border-bottom:0}"
      + ".tx tr.tot td{font-size:12.5px;font-weight:800}.tx tr.tot td:first-child{font-size:8px}"
      + ".wd{padding:5px 10px;font-size:9.5px;border:1px solid " + RULE + ";border-top:0}.wd b{color:" + GREY + ";font-weight:400;margin-right:4px}"
      + ".ft{display:grid;grid-template-columns:62% 38%;border:1px solid " + RULE + ";border-top:0}.tc{padding:6px 10px;font-size:8.8px;line-height:1.5;border-right:1px solid " + RULE + "}.tc b.h{display:block;font-size:7.6px;letter-spacing:.14em;text-transform:uppercase;color:" + ink + ";margin-bottom:3px}.tc ul{margin:0;padding-left:12px}"
      + ".sg{padding:6px 10px 8px;text-align:right;display:flex;flex-direction:column;align-items:flex-end}.sg .for{font-weight:800;color:" + NAVY + ";font-size:9.5px}.sg .seal{margin:2px 0 0}.sg .tick{display:block;margin:2px 0 0}.sg .reg{font-size:8px;color:#374151;margin-top:2px}.sg .as{font-size:8.2px;color:#374151;border-top:1px solid " + NAVY + ";padding-top:3px;min-width:180px;text-align:center;margin-top:4px}"
      + ".ra{padding:6px 0 0;font-size:8px;color:" + GREY + ";text-align:center}.ra b{color:" + ink + ";font-weight:700;margin-right:4px}";
    var kv = function (k, v, extra) { return '<div class="kv"><span class="k">' + k + '</span><span class="c">:</span><span class="v">' + esc(v) + (extra || '') + '</span></div>'; };
    var withDate = function (iso) { return P(iso) ? '<span class="d"><b>Date</b>' + esc(fdate(iso)) + '</span>' : ''; };
    var partyBox = function (title, p) {
      return '<div class="pc"><div class="ph">' + title + '</div><div class="bd">'
        + kv('Name', p.name || '') + kv('Address', String(p.address || '').replace(/\n/g, ', ')) + kv('State', p.state || '') + kv('PAN No', pan(p.gstin)) + kv('GSTIN', p.gstin || '') + '</div></div>';
    };
    var consignee = (d.consignee && P(d.consignee.name)) ? d.consignee : { name: b.name, address: b.address, state: f.bState, gstin: b.gstin };
    var eInv = eInvBlock(d, 'einv irn');
    var packing = +d.packingCharge || 0;
    var roundOff = Math.round(((+d.grand || 0) - (+d.total || 0)) * 100) / 100, tcs = +d.tcs || 0;
    var rows = items.map(function (it, i) {
      var note = convNote(it), rowRu = P(it.rateUnit) || rUnit;
      return '<tr class="ln"><td class="c">' + (i + 1) + '</td><td class="c">' + esc(P(it.hsn) || f.hsn) + '</td><td><span class="dn">' + esc(P(it.product)) + '</span>' + (P(it.desc) || P(it.grade) ? '<br><span class="ds">' + esc([P(it.grade), P(it.desc)].filter(Boolean).join(' · ')) + '</span>' : '') + (note ? '<br><span class="ds">' + note + '</span>' : '') + '</td>'
        + (hasBags ? '<td class="c">' + (bags[i] ? esc(bags[i]) : dash) + '</td>' : '')
        + '<td class="r">' + qfmt(it.qty) + (P(it.unit) && P(it.unit) !== unitOfItems ? ' ' + esc(P(it.unit)) : '') + '</td><td class="r">' + fmt(it.rate) + (rowRu !== rUnit ? '<br><span class="ds">/ ' + esc(rowRu) + '</span>' : '') + '</td><td class="r"><b>' + fmt(lineTaxable(it)) + '</b></td></tr>';
    }).join('') + charges.map(function (c, i) {
      return '<tr class="ln"><td class="c">' + (items.length + i + 1) + '</td><td class="c">' + esc(P(c.hsn) || '9965') + '</td><td><span class="dn">' + esc(P(c.label)) + '</span>' + (P(c.desc) ? '<br><span class="ds">' + esc(P(c.desc)) + '</span>' : '') + '</td>' + (hasBags ? '<td class="c">' + dash + '</td>' : '') + '<td class="r">' + dash + '</td><td class="r">' + dash + '</td><td class="r"><b>' + fmt(c.amount) + '</b></td></tr>';
    }).join('');
    var taxStack = '<table class="tx">'
      + '<tr><td>CGST' + (f.interState ? '' : ' @ ' + f.halfR + ' %') + '</td><td>' + (f.interState ? dash : f.cgst) + '</td></tr>'
      + '<tr><td>SGST' + (f.interState ? '' : ' @ ' + f.halfR + ' %') + '</td><td>' + (f.interState ? dash : f.sgst) + '</td></tr>'
      + '<tr><td>IGST' + (f.interState ? ' @ ' + f.gstR + ' %' : '') + '</td><td>' + (f.interState ? f.igst : dash) + '</td></tr>'
      + '<tr><td>GST Tax Amount</td><td>' + f.totalTax + '</td></tr>'
      + '<tr><td>Amount After Tax</td><td>' + fmt(d.total) + '</td></tr>'
      + (tcs ? '<tr><td>TCS</td><td>' + fmt(tcs) + '</td></tr>' : '')
      + (roundOff ? '<tr><td>Round Off</td><td>' + (roundOff > 0 ? '+' : '') + fmt(roundOff) + '</td></tr>' : '')
      + '<tr class="tot"><td>Total Amount</td><td>' + f.grand + '</td></tr>'
      + '<tr><td>GST Reverse Charge</td><td>' + (f.rcm === 'Yes' ? 'Yes' : 'N.A.') + '</td></tr></table>';
    /* the seal — the reference stamp, shared with the Premium design */
    var stName = (P(s.state).match(/^(.*?)\s*\((\d\d)\)\s*$/) || [])[1] || P(s.state);
    var sealLine = P(s.sealText) || [s.city, stName].filter(Boolean).join(', ');
    var seal = stampSeal(s.name, sealLine);
    var ids = '<div class="ids"><b>GSTIN</b>: ' + esc(s.gstin || '') + (f.cin ? '<br><b>CIN</b>: ' + esc(f.cin) : '') + (f.pan ? '<br><b>PAN</b>: ' + esc(f.pan) : '') + (f.iec ? '<br><b>IEC</b>: ' + esc(f.iec) : '') + '</div>';
    var ctc = '<div class="ctc">' + (f.tel ? intlTel(f.tel).replace(', ', '<br>') : '') + (s.email ? '<br>' + esc(s.email) : '') + (s.website ? '<br>' + esc(s.website) : '') + '</div>';
    var body = '<div class="sheet">'
      + '<div class="lh">' + ids + '<div class="mid">' + (s.lockupDark ? '<img class="lk" src="' + esc(s.lockupDark) + '" alt="' + esc(s.name) + '">' : (f.logo ? '<div style="display:flex;align-items:center;justify-content:center;gap:10px">' + logoImg(f, 44) + '<div class="nm">' + esc(s.name) + '</div></div>' : '<div class="nm">' + esc(s.name) + '</div>')) + (f.tagline ? '<div class="tg">' + esc(f.tagline) + '</div>' : '') + '</div>' + ctc + '</div>'
      + '<div class="ttl"><div class="w">' + (eInv ? 'TAX E-INVOICE' : (isExport ? 'EXPORT INVOICE' : 'TAX INVOICE')) + '</div><div class="c">Original Copy</div></div>'
      + '<div class="grid2"><div>' + (f.msme ? kv('MSME No', f.msme) + (s.msmeType ? kv('MSME Type', s.msmeType) : '') : '') + kv('Invoice No', f.inv) + kv('Invoice Date', f.date) + kv('E-Way Bill No', f.eway) + '</div>'
      + '<div>' + (P(d.po) ? kv('PO No', d.po, withDate(d.poDate)) : '') + kv('Transport Mode', f.transport) + kv('GR/RR No.', f.grrr, withDate(d.grDate)) + kv('From', s.station || s.city || '', '<span class="d"><b>Place of Supply</b>' + esc(f.pos) + '</span>') + (P(f.station) ? kv('Station', f.station) : '') + kv('Vehicle No', f.veh) + '</div></div>'
      + '<div class="dt"><b>Documents through</b>' + esc(P(s.docsThrough) || s.name || '') + '</div>'
      + '<div class="grid2">' + partyBox('Details of Buyer (Billed to)', { name: b.name, address: b.address, state: f.bState, gstin: b.gstin }) + partyBox('Details of Consignee (Shipped to)', consignee) + '</div>'
      + '<div class="body">' + (f.logo ? '<div class="wm">' + logoImg(f, 230, 'opacity:.06;max-width:400px') + '</div>' : '')
      + '<table class="it"><colgroup><col style="width:36px"><col style="width:72px"><col>' + (hasBags ? '<col style="width:58px">' : '') + '<col style="width:78px"><col style="width:84px"><col style="width:104px"></colgroup>'
      + '<tr class="ln"><th>S.No.</th><th>HSN Code</th><th>Description of Goods</th>' + (hasBags ? '<th>No. of Bags</th>' : '') + '<th>Qty (' + esc(unitOfItems || f.unit || '') + ')</th><th>Rate (P.' + esc(rUnit || f.rateUnit || f.unit || '') + ')</th><th>Amount</th></tr>'
      + rows + '</table><div class="fill"></div>'
      + '<table class="sum"><tr><td class="l">Packing and Forwarding Charges</td><td class="v">' + fmt(packing) + '</td></tr>'
      + '<tr><td class="l">Total Taxable Value &nbsp;(' + qtyTotalEl(f) + ')</td><td class="v">' + f.taxable + '</td></tr></table></div>'
      + '<div class="low"><div class="left"><div class="rm"><b>Remarks</b> ' + esc(d.remarks || '') + '</div><div class="lut"><b>LUT Bond No.</b> ' + esc(isExport ? f.lut : '') + '</div>' + eInv + '<div class="hs">' + bandTable(f, '') + '</div></div>'
      + '<div>' + taxStack + '</div></div>'
      + '<div class="wd"><b>Amount in words</b> ' + esc(f.words) + '</div>'
      + '<div class="ft"><div class="tc"><b class="h">Terms &amp; Conditions</b>' + (f.cfg.showDeclaration && f.terms.length ? '<ul>' + f.terms.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '')
      + (isExport ? '<div style="margin-top:4px"><b>Export</b> Supply meant for export under LUT without payment of IGST' + (f.iec ? ' · IEC ' + esc(f.iec) : '') + '</div>' : '') + '</div>'
      + '<div class="sg">' + (f.cfg.showSignature ? '<div class="for">For ' + esc(String(f.signatory || s.name || '').toUpperCase()) + '</div>' + seal + '<svg class="tick" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#16a34a"/><path d="M6.5 12.5l3.6 3.6L17.5 8.7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' + (eInv && P(d.ackDt) ? '<div class="reg">e-Invoice registered on ' + esc(fAckDt(d.ackDt)) + '</div>' : '') + '<div class="as">Authorised Signatory &amp; Seal</div>' : qrBlock(f)) + '</div></div>'
      + '<div class="ra"><b>Regd. Address</b>' + esc(String(s.address || '').replace(/\n/g, ', ')) + (s.unitAddress ? ' &nbsp;·&nbsp; <b>Unit</b>' + esc(s.unitAddress) : '') + '</div>'
      + '</div>';
    return doc(f, 'blueink', css + EINV_CSS + '.einv.irn{border:0;border-bottom:1px solid ' + RULE + ';padding:6px 10px}', body);
  }
  /* +91 on each phone, as the sample prints them */
  function intlTel(tel) { return String(tel || '').split(/[,/]/).map(function (x) { x = x.replace(/\D/g, ''); return x.length === 10 ? '+91 ' + x : x; }).filter(Boolean).map(esc).join(', '); }


  /* ══════════ quotation — the firm's quotation PDF, from the CRM's quote record ══════════
     The Premium design IS the owner's quotation letterhead (it was measured
     from his DM/QT/2026-27/922 PDF), so the quotation shares its sheet: the
     navy band with QUOTATION · PRICE OFFER, the contact line, Quotation No ·
     Date · Valid until · Delivery basis, From — Supplier / To — Buyer, "Dear
     Sir" and the offer paragraph, the PRICE OFFER table with packing and the
     rate per unit, freight as its own line when quoted, the totals, the words,
     the two-column terms, Bank Details + To confirm this order, the closing
     lines against the seal. Numbers come from CustomerCore.quoteTotals when
     it is loaded — the same figures the register and the WhatsApp text use. */
  var GST_STATE_NAMES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory' };
  function quotationHTML(q, cust, co, opts) {
    q = q || {}; cust = cust || {}; co = co || {}; opts = opts || {};
    /* the buyer's GSTIN is the fact: a stored state that names another code (the
       form's old pre-fill) yields to it, and the GSTIN prints in its registered
       form — the same rule the invoices apply */
    var bg = String(cust.gstin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    cust = Object.assign({}, cust, { gstin: bg });
    if (bg.length === 15 && GST_STATE_NAMES[bg.slice(0, 2)] && String(cust.state || '').indexOf('(' + bg.slice(0, 2) + ')') < 0) cust.state = GST_STATE_NAMES[bg.slice(0, 2)] + ' (' + bg.slice(0, 2) + ')';
    var P = function (v) { return v == null ? '' : String(v).trim(); };
    var U = QLUnitsOpt(), C = (typeof CustomerCore !== 'undefined') ? CustomerCore : (typeof require === 'function' ? (function () { try { return require('./customer-core.js'); } catch (e) { return null; } })() : null);
    var t = C ? C.quoteTotals(q) : null;
    var items = t ? t.lines : (q.items || []).map(function (it) { var L = U ? U.lineAmount({ qty: it.qty, unit: it.unit, rate: it.rate, rateUnit: it.rateUnit }) : { amount: (+it.qty || 0) * (+it.rate || 0), ok: true, billableQty: +it.qty || 0, billableUnit: it.unit }; return { product: it.product, qty: +it.qty || 0, unit: it.unit || 'Ton', rate: +it.rate || 0, rateUnit: it.rateUnit || it.unit || 'Ton', amount: L.amount, ok: L.ok, billableQty: L.billableQty, billableUnit: L.billableUnit, discount: +it.discount || 0 }; });
    var goods = items.reduce(function (a, l) { return a + (l.amount || 0); }, 0);
    var freight = t ? t.freight : (+q.freight || 0), loading = t ? t.loading : (+q.loading || 0), other = t ? t.other : (+q.other || 0);
    var taxable = t ? t.taxable : goods + freight + loading + other;
    var gstR = t ? t.gstR : (q.isExport ? 0 : (q.gstR == null || q.gstR === '' ? 5 : +q.gstR));
    var gst = t ? t.gst : Math.round(taxable * gstR) / 100, total = t ? t.total : Math.round((taxable + gst) * 100) / 100;
    var st = function (x) { var m = P(x).match(/^(.*?)\s*\((\d\d)\)\s*$/); return m ? { name: m[1], code: m[2] } : { name: P(x), code: '' }; };
    var sSt = st(co.state), bSt = st(cust.state);
    if (!sSt.code && P(co.gstin).length >= 2) sSt.code = P(co.gstin).slice(0, 2);
    if (!bSt.code && P(cust.gstin).length >= 2) bSt.code = P(cust.gstin).slice(0, 2);
    var known = !!(sSt.code && bSt.code), inter = !!q.isExport || (known && sSt.code !== bSt.code);   // no buyer state on record → one GST line, not an invented split
    var pan = function (g) { g = P(g); return g.length === 15 ? g.slice(2, 12) : ''; };
    var dLong = function (iso) { var p = String(iso || '').slice(0, 10).split('-'); if (p.length !== 3) return P(iso); var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return (+p[2]) + ' ' + (M[+p[1] - 1] || p[1]) + ' ' + p[0]; };
    var unitOfItems = items.length ? (items[0].unit || 'Ton') : 'Ton', rUnit = items.length ? (items[0].rateUnit || unitOfItems) : unitOfItems;
    var hasPack = !!P(q.packaging) || items.some(function (l) { return P(l.packing); });
    var packLabel = function (l) { return P(l.packing) || (P(q.packaging) && C ? C.labelOf(C.PACKAGING, q.packaging) || P(q.packaging) : P(q.packaging)); };
    var qty3 = function (n, u) { var mass = U ? U.familyOf(u) === 'mass' : /ton|kg|quintal/i.test(u); n = +n || 0; return mass && !Number.isInteger(n) ? n.toFixed(3) : qfmt(n); };
    var f = { s: co, inv: q.no || '', tel: co.tel || co.phone || '', logo: co.logo || '', cfg: cfgOf({}) };
    var mcell = function (k, v) { return '<div><span>' + k + '</span><b>' + (P(v) ? esc(v) : '&mdash;') + '</b></div>'; };
    var party = function (title, name, addr, gst, state, phone, email, panNo, iec, attn) {
      var l = function (h) { return h ? '<div>' + h + '</div>' : ''; }, kvs = function (k, v) { return P(v) ? '<span class="kv"><span>' + k + ':</span><b>' + esc(P(v)) + '</b></span>' : ''; };
      return '<div class="box"><h4>' + title + '</h4><div class="bd"><div class="nm">' + esc(name) + '</div>' + (P(attn) ? '<div class="ad"><span style="color:#6b7280">Attn.:</span> ' + esc(attn) + '</div>' : '') + (addr ? '<div class="ad">' + esc(addr) + '</div>' : '')
        + l(kvs('GSTIN', gst) + kvs('State', state)) + l(kvs('PAN', panNo) + kvs('IEC', iec)) + l(kvs('Mobile', phone)) + l(kvs('E-mail', email)) + '</div></div>';
    };
    var seller = party('From — Supplier', co.name || '', addrLines(co.address, sSt.name, co.pin), co.gstin, co.state, intlPhones(f.tel), '', pan(co.gstin), co.iec, '');
    var buyer = party('To — Buyer', cust.name || '', addrLines([cust.address, [cust.city, cust.pin].filter(Boolean).join(' ')].filter(Boolean).join(', '), bSt.name, cust.pin), cust.gstin, cust.state, cust.phone || cust.wa, cust.email, pan(cust.gstin), '', cust.contact);
    var rows = items.map(function (l, i) {
      var conv = (l.ok && l.billableUnit && l.billableUnit !== l.unit && U) ? '<div class="ds">' + esc(U.fmtQty(l.qty, l.unit) + ' = ' + U.fmtQty(l.billableQty, l.billableUnit) + ' × ₹' + fmt(l.rate)) + '</div>' : '';
      return '<tr><td class="c">' + (i + 1) + '</td><td><div class="dn">' + esc(l.product) + '</div>' + (P(q.spec) ? '<div class="ds">' + esc(q.spec) + '</div>' : '') + conv + '</td><td class="c">' + esc(P(l.hsn) || P(q.hsn) || P(co.hsn) || '25221000') + '</td>' + (hasPack ? '<td class="c">' + esc(packLabel(l) || '—') + '</td>' : '')
        + '<td class="q">' + qty3(l.qty, l.unit) + (l.unit !== unitOfItems ? ' ' + esc(l.unit) : '') + '</td><td class="r">' + fmt(l.rate) + ((l.rateUnit || unitOfItems) !== rUnit ? '<br><span class="ds">/ ' + esc(l.rateUnit) + '</span>' : '') + '</td><td class="r"><b>' + fmt(l.amount) + '</b></td></tr>';
    }).join('');
    var n = items.length;
    var chargeRow = function (label, sub, amt) { n++; return '<tr><td class="c">' + n + '</td><td><div class="dn">' + esc(label) + '</div>' + (sub ? '<div class="ds">' + esc(sub) + '</div>' : '') + '</td><td class="c">9965</td>' + (hasPack ? '<td class="c">—</td>' : '') + '<td class="q">—</td><td class="r">—</td><td class="r"><b>' + fmt(amt) + '</b></td></tr>'; };
    if (freight) rows += chargeRow('Freight' + (P(q.deliveryLoc) ? ' — to ' + P(q.deliveryLoc) : ''), P(q.freightNote), freight);
    if (loading) rows += chargeRow('Loading', '', loading);
    if (other) rows += chargeRow(P(q.otherLabel) || 'Other charges', '', other);
    var trow = function (k, v, g) { return '<tr' + (g ? ' class="g"' : '') + '><td class="l">' + k + '</td><td class="v">' + v + '</td></tr>'; };
    var hsnTot = P(q.hsn) || P(co.hsn) || '25221000';
    var tot = '<table class="tot">' + trow('Basic value of goods' + (items.length === 1 && items[0].qty && items[0].rate ? ' (' + qty3(items[0].qty, items[0].unit) + ' ' + esc(items[0].unit) + ' × INR ' + (+items[0].rate % 1 ? fmt(items[0].rate) : Number(items[0].rate).toLocaleString('en-IN')) + (rUnit ? '/' + esc(rUnit) : '') + ')' : ''), fmt(goods))
      + (freight ? trow('Freight' + (P(q.deliveryLoc) ? ' to ' + esc(P(q.deliveryLoc)) : ''), fmt(freight)) : '') + (loading ? trow('Loading', fmt(loading)) : '') + (other ? trow(esc(P(q.otherLabel) || 'Other charges'), fmt(other)) : '')
      + (q.isExport ? trow('IGST — zero-rated export under LUT', fmt(0)) : inter ? trow('IGST on goods @ ' + gstR + '% (HSN ' + esc(hsnTot) + ')', fmt(gst)) : !known ? trow('GST on goods @ ' + gstR + '% (HSN ' + esc(hsnTot) + ')', fmt(gst)) : trow('CGST @ ' + (gstR / 2) + '% (HSN ' + esc(hsnTot) + ')', fmt(gst / 2)) + trow('SGST @ ' + (gstR / 2) + '%', fmt(gst / 2)))
      + trow('Total payable (goods incl. GST)', fmt(total), true) + '</table>';
    var words = (typeof QLD !== 'undefined' && QLD.amountInWords) ? QLD.amountInWords(total) : wordsINR(total);
    var termRows = (Array.isArray(q.terms) && q.terms.length ? q.terms : defaultQuoteTerms(q, co, cust, { freight: freight, gstR: gstR, deliveryLoc: q.deliveryLoc, validUntil: q.validUntil, C: C })).map(function (x) { var m = String(x).match(/^([A-Za-z][A-Za-z /&]{2,28}):\s*(.+)$/); return '<tr><td class="k">' + (m ? esc(m[1]) : '&nbsp;') + '</td><td>' + esc(m ? m[2] : x) + '</td></tr>'; }).join('');
    var bank = (co.bank || co.accNo || co.upi) ? '<div class="pbox"><b class="h">Bank Details — for advance payment</b>' + (co.name ? 'Account name: ' + esc(co.name) + '<br>' : '') + (co.bank ? esc(co.bank) + (co.bankBranch ? ', ' + esc(co.bankBranch) : '') + '<br>' : '') + (co.accNo ? 'A/C No.: ' + esc(co.accNo) : '') + (co.ifsc ? ' &nbsp;|&nbsp; IFSC: ' + esc(co.ifsc) : '') + (co.upi ? '<br>UPI: ' + esc(co.upi) : '') + '</div>' : '';
    var confirm = '<div class="pbox"><b class="h">To confirm this order</b>1. Reply by WhatsApp or e-mail confirming quantity and delivery address.<br>2. Transfer the advance; send the UTR number.<br>3. We issue the proforma invoice and schedule loading.</div>';
    var sealLine = P(co.sealText) || [co.city, sSt.name].filter(Boolean).join(', ');
    var seal = stampSeal(co.name, sealLine);
    var subject = P(q.subject) || (items.length ? String(items[0].product || '').split(/[(—–]/)[0].trim() : '');
    var basis = P(q.deliveryTerms) || (freight ? 'FOR ' + P(q.deliveryLoc || cust.deliveryLoc || cust.city) : 'Ex-works ' + (P(co.city) || 'Borunda'));
    var intro = P(q.intro) || ('Thank you for your enquiry. We are pleased to quote for the supply of ' + (subject ? subject.toLowerCase() : 'quicklime') + ' from our own kiln at ' + (P(co.city) || 'Borunda') + ', ' + (sSt.name || 'Rajasthan') + ', as follows. Every lot is tested before dispatch and travels with a Certificate of Analysis.');
    var body = '<div class="sheet">'
      + '<div class="band"><div class="co">' + (bandLockup(f, 35) || (bandLogo(f, 36) + '<div class="n">' + wordmark(co.name) + '</div>')) + '</div>'
      + '<div class="ti"><div class="w">QUOTATION</div><div class="c">Price offer' + (subject ? ' — ' + esc(subject) : '') + '</div></div></div>'
      + '<div class="contact">' + (P(co.product) ? '<div class="pl">' + esc(co.product) + '</div>' : '') + [co.website, co.email, intlPhones(f.tel)].filter(Boolean).map(function (x) { return esc(x); }).join('<span class="sep">·</span>') + '</div>'
      + '<div class="in">'
      + '<div class="meta">' + mcell('Quotation No.', q.no) + mcell('Date', dLong(q.date)) + mcell('Valid until', dLong(q.validUntil)) + mcell('Delivery basis', basis) + '</div>'
      + '<div class="par">' + seller + buyer + '</div>'
      + '<div style="margin:2px 0 6px">Dear Sir,</div><div style="margin:0 0 8px;line-height:1.5">' + esc(intro) + '</div>'
      + '<h3>Price offer</h3><table class="it"><thead><tr><th style="width:34px">Sr.</th><th>Description</th><th style="width:78px">HSN</th>' + (hasPack ? '<th style="width:100px">Packing</th>' : '') + '<th style="width:66px">Qty (' + esc(unitOfItems) + ')</th><th style="width:92px">Rate / ' + esc(rUnit) + '</th><th style="width:112px">Amount</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + tot + '<div class="words"><b>Goods value in words:</b> ' + esc(words) + (gst ? ' (inclusive of ' + (inter ? 'IGST' : 'GST') + ')' : '') + '</div>'
      + '<h3>Terms and conditions</h3><table class="tc">' + termRows + '</table>'
      + (q.notes ? '<div style="margin-top:6px;white-space:pre-line">' + esc(q.notes) + '</div>' : '')
      + '<div class="two">' + bank + confirm + '</div>'
      + '<div class="close"><div class="msg">We look forward to supplying you with our products and building a long term, mutually beneficial business relationship.' + (f.tel ? '<br><br>Contact for this quotation: ' + intlPhones(f.tel) + (co.email ? ' · ' + esc(co.email) : '') : '') + '</div>'
      + '<div class="sig"><div class="for">For ' + esc(String(co.name || '').toUpperCase()) + '</div>' + seal + '<div class="cap">Authorised Signatory &amp; Seal</div></div></div>'
      + '</div><div class="ft">Quotation ' + esc(q.no || '') + ' · This is an offer to supply and not a tax invoice.</div></div>';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation ' + esc(q.no || '') + ' — ' + esc(co.short || co.name || '') + '</title><style>' + PRINT + premiumCss() + '</style></head><body>' + body + '</body></html>';
  }
  /* the reference's terms, worded for the offer at hand — used when the quote carries none */
  function defaultQuoteTerms(q, co, cust, x) {
    var C = x.C, rate = (q.items && q.items[0]) ? q.items[0] : {};
    var basisTxt = x.freight ? 'Goods delivered ' + (q.deliveryLoc ? 'to ' + q.deliveryLoc : 'to site') + '; freight as quoted above.' : 'Goods ex-works ' + (co.city || 'Borunda') + (rate.rate ? ' at INR ' + Number(rate.rate).toLocaleString('en-IN') + '/' + (rate.rateUnit || rate.unit || 'Ton') : '') + '; freight extra at actuals.';
    return [
      'Price basis: ' + basisTxt + ' Prices in INR; GST as shown.',
      'Payment: ' + (q.paymentTerms && C ? C.labelOf(C.PAYMENT_TERMS, q.paymentTerms) + (q.paymentNote ? ' — ' + q.paymentNote : '') : '100% advance by NEFT / RTGS to the bank account below, before dispatch. Goods are loaded only after credit is confirmed.'),
      'Dispatch: ' + (q.deliveryTerms || 'Within 5–7 working days of receipt of advance. Vehicle number, LR copy, e-way bill and loading photographs shared on the day of dispatch.'),
      'Quality: Certificate of Analysis (available CaO, reactivity, MgO, SiO2) issued with the lot. Retained sample held for 90 days. Any dispute settled by referee test at an NABL laboratory.',
      'Packing: ' + (q.packaging && C ? C.labelOf(C.PACKAGING, q.packaging) : (q.packaging || 'As agreed; jumbo bags on request.')),
      'Transit: Goods travel at buyer\u2019s risk after loading; transit insurance can be arranged on request at buyer\u2019s cost. Quicklime must be kept dry — please arrange covered unloading and storage.',
      'Validity: This offer is valid until ' + (x.validUntil ? (function (iso) { var p = String(iso).slice(0, 10).split('-'); var M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']; return p.length === 3 ? (+p[2]) + ' ' + M[+p[1] - 1] + ' ' + p[0] : iso; })(x.validUntil) : 'the date above') + '. Rates thereafter subject to reconfirmation.'
    ];
  }
  /* amount in words, Indian numbering — for the public quotation page, which has no QLD */
  function wordsINR(n) {
    var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'], TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    var two = function (k) { return k < 20 ? ONES[k] : TENS[Math.floor(k / 10)] + (k % 10 ? ' ' + ONES[k % 10] : ''); }, three = function (k) { return (k >= 100 ? ONES[Math.floor(k / 100)] + ' Hundred' + (k % 100 ? ' ' : '') : '') + (k % 100 ? two(k % 100) : ''); };
    n = Math.round((+n || 0) * 100) / 100; var r = Math.floor(n), p = Math.round((n - r) * 100); if (!r && !p) return 'Rupees Zero Only';
    var parts = [], cr = Math.floor(r / 1e7), lk = Math.floor((r % 1e7) / 1e5), th = Math.floor((r % 1e5) / 1000), hu = r % 1000;
    if (cr) parts.push(three(cr) + ' Crore'); if (lk) parts.push(three(lk) + ' Lakh'); if (th) parts.push(three(th) + ' Thousand'); if (hu) parts.push(three(hu));
    return 'Rupees ' + (parts.join(' ') || 'Zero') + (p ? ' and Paise ' + two(p) : '') + ' Only';
  }
  var TEMPLATES = [
    { id: 'gst',     name: 'GST Invoice (print format)', category: 'In use now', accentable: false, despatch: true,
      desc: 'Your billing software\'s format, line for line — logo, Tel., Transport / Station / GR-RR, party contact lines, Terms & Conditions, Receiver\'s Signature.', render: gst },
    { id: 'modern',   name: 'Modern',   category: 'Colour', accentable: true,
      desc: 'A tinted header band, a solid-colour item table and a tinted footer — the modern bill layout you sent. Pick the colour.', render: modern },
    { id: 'business', name: 'Business', category: 'Colour', accentable: true,
      desc: 'A centred title, your logo top-left, tinted “Invoice by / Invoice to” boxes and a solid-colour item table. Pick the colour.', render: business },
    { id: 'detailed', name: 'Detailed', category: 'Full detail', accentable: true, despatch: true,
      desc: 'The full-detail layout of the sample you sent: GSTIN / PAN header, MSME, transport block, buyer and consignee, watermark, tax stack, terms, address footer. IRN / QR print only once an e-invoice exists.', render: detailed },
    { id: 'industrial', name: 'Deshwali Professional Industrial Invoice', category: 'Premium', accentable: true, despatch: true,
      desc: 'Black-and-white first with one accent: registration strip, Bill To / Ship To, order & transport grid, multi-line product table, optional quality specification and charges, only the tax heads that apply, editable terms, e-invoice and export blocks only when real.', render: industrial },
    { id: 'premium', name: 'Deshwali Premium Invoice', category: 'Premium', accentable: false, despatch: true,
      desc: 'The firm\'s quotation letterhead as a tax invoice: navy band with the logo, gold rule, boxed invoice strip, From / To boxes, navy table with packing and units, totals block, terms as a list, bank and declaration boxes, seal.', render: premium },
    { id: 'blueink', name: 'Deshwali Classic GST Invoice', category: 'Classic', accentable: true, despatch: true,
      desc: 'The blue-ink billing-software format of the Raj Chemicals bill you photographed: GSTIN / PAN header, ORIGINAL COPY, MSME and PO / transport boxes, Buyer and Consignee, No. of Bags, watermark, tax stack, IRN / QR when e-invoiced, terms, signature, REGD. / UNIT address footer.', render: blueink }
  ];

  function get(id) { for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i]; return TEMPLATES[0]; }
  function render(d, cfg) {
    var c = cfgOf(cfg);
    return get(c.template).render(d, c);
  }

  var API = { TEMPLATES: TEMPLATES, DEFAULT_CFG: DEFAULT_CFG, cfgOf: cfgOf, get: get, render: render, facts: facts, qaReport: qaReport, quotationHTML: quotationHTML, stampSeal: stampSeal, wordsINR: wordsINR };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.InvoiceTemplates = API;
})(typeof window !== 'undefined' ? window : globalThis);
