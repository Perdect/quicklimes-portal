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
      pos: (String(d.type || '').toLowerCase() === 'export') ? ((d.export && d.export.country) || 'Outside India') : (b.state || s.state || ''), rcm: d.rcm ? 'Yes' : 'No',
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
      + '<div class="ft"><div class="tc br"><u>Terms &amp; Conditions</u><div class="eoe">E.&amp; O.E.</div>'
      + (f.cfg.showDeclaration ? '<ol>' + f.terms.map(function (t, i) { return '<li>' + (i + 1) + '. ' + esc(t) + '</li>'; }).join('') + '</ol>' : '')
      + (f.cfg.footerNote ? '<div style="margin-top:6px;font-size:10px">' + esc(f.cfg.footerNote) + '</div>' : '') + '</div>'
      + '<div class="sg"><div class="rs">Receiver\'s Signature &nbsp;&nbsp;:</div><div class="sf">' + qrBlock(f)
      + (f.cfg.showSignature ? '<div class="for">for ' + esc(f.signatory) + '</div><div class="as">Authorised Signatory</div>' : '') + '</div></div></div>'
      + (f.unitAddr ? '<div class="ua"><b>REGD. ADDRESS</b> : ' + esc(String(s.address || '').replace(/\n/g, ', ')) + '<br><b>UNIT ADDRESS</b> : ' + esc(f.unitAddr) + '</div>' : '')
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
  /* IRN / Ack / QR — only for a sale that actually carries an IRN. */
  function eInvBlock(d, cls) {
    if (!String(d.irn || '').trim()) return '';
    var row = function (k, v) { return v ? '<div class="ekv"><span>' + k + '</span><b>' + esc(v) + '</b></div>' : ''; };
    var qr = d.qrImage ? '<img src="' + esc(d.qrImage) + '" alt="e-Invoice QR">' : (d.qrData ? '<img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=' + encodeURIComponent(d.qrData) + '" alt="e-Invoice QR">' : '');
    return '<div class="' + cls + '"><div>' + row('IRN', d.irn) + row('Ack No.', d.ackNo) + row('Ack Date', fdate(d.ackDt)) + '</div>' + qr + '</div>';
  }
  var EINV_CSS = '.einv{display:flex;gap:14px;align-items:flex-start;border:1px solid #D1D5DB;padding:8px 12px;font-size:9.5px;word-break:break-all}.einv img{width:84px;height:84px;flex:none}.ekv{display:flex;gap:8px}.ekv span{color:#6B7280;min-width:56px;flex:none}.ekv b{font-weight:600;color:#111827}';
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
    var eblock = eInv ? '<div class="ein"><div>' + kv('IRN', d.irn, 100) + kv('Ack No.', d.ackNo, 100) + kv('Ack Date', fdate(d.ackDt), 100) + '</div>'
      + (P(d.qrImage) ? '<img src="' + esc(P(d.qrImage)) + '" alt="e-Invoice QR">' : (P(d.qrData) ? '<img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=' + encodeURIComponent(P(d.qrData)) + '" alt="e-Invoice QR">' : '')) + '</div>' : '';
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
    return doc(f, 'industrial', css, body);
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
    var words = /^Rupees /.test(f.words) ? 'Indian ' + f.words : f.words;
    var unitOfItems = P(items[0].unit) || f.unit || '';
    var rUnit = P(items[0].rateUnit) || f.rateUnit || unitOfItems;
    var css = "body{font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:10.5px;line-height:1.45;padding:0;background:#fff}"
      + ".sheet{max-width:820px;margin:0 auto;padding:0 0 16px}"
      + ".band{background:" + PREMIUM_NAVY + ";color:#fff;padding:20px 40px 18px;display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid " + PREMIUM_GOLD + "}"
      + ".band .co{display:flex;gap:20px;align-items:center}.band .gem{flex:none;display:block}.band .n{font-size:30px;font-weight:800;letter-spacing:.06em;line-height:1;text-transform:uppercase}"
      + ".band .ti{text-align:right;flex:none;padding-left:20px}.band .ti .w{font-size:24px;font-weight:800;letter-spacing:.12em;line-height:1}.band .ti .c{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:" + PREMIUM_GOLD + ";margin-top:6px}"
      + ".contact{text-align:center;font-size:9.5px;color:#333;padding:5px 32px;border-bottom:1px solid #d6d9de}.contact .pl{font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;color:" + PREMIUM_NAVY + ";font-weight:700;margin-bottom:2px}"
      + ".in{padding:8px 32px 0}"
      + ".meta{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #c9ced6;margin-bottom:8px}.meta div{padding:3px 10px;border-right:1px solid #c9ced6;min-width:0}.meta div:last-child{border-right:0}.meta span{display:block;font-size:7.5px;letter-spacing:.12em;text-transform:uppercase;color:#6b7280}.meta b{font-size:11px;color:" + PREMIUM_NAVY + ";word-break:break-word}"
      + ".par{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px}.box{border:1px solid #c9ced6}.box h4{margin:0;padding:5px 10px;font-size:7.5px;letter-spacing:.14em;text-transform:uppercase;color:#4b5563;background:#f1f3f6;border-bottom:1px solid #c9ced6}.box .bd{padding:5px 10px}"
      + ".box .nm{font-size:12px;font-weight:800;color:" + PREMIUM_NAVY + ";margin-bottom:2px}.box .ad{white-space:pre-line;color:#222}.box .kv{font-size:9.5px;margin-top:2px}.box .kv span{color:#6b7280;margin-right:4px}.box .kv b{font-weight:600;margin-right:10px}"
      + "h3{margin:9px 0 5px;font-size:8.5px;letter-spacing:.16em;text-transform:uppercase;color:" + PREMIUM_NAVY + ";font-weight:800;border-bottom:2px solid " + PREMIUM_GOLD + ";padding-bottom:3px}"
      + "table.it{width:100%;border-collapse:collapse;border:1px solid #c9ced6}.it thead{display:table-header-group}.it th{background:" + PREMIUM_NAVY + ";color:#fff;font-size:7.5px;letter-spacing:.12em;text-transform:uppercase;padding:7px 8px;text-align:left}"
      + ".it td{padding:6px 8px;border-bottom:1px solid #c9ced6;border-right:1px solid #e3e6ea;font-size:10px;vertical-align:middle}.it td:last-child{border-right:0}.it tbody tr{break-inside:avoid}.r{text-align:right}.c{text-align:center}"
      + ".it .dn{font-weight:800;color:" + PREMIUM_NAVY + ";font-size:10.5px}.it .ds{color:#6b7280;font-size:9px}"
      + ".tot{width:100%;border-collapse:collapse;border:1px solid #c9ced6;margin-top:8px}.tot td{padding:3px 10px;border-bottom:1px solid #e3e6ea;font-size:9.5px}.tot td.l{text-align:right;font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:#374151;font-weight:700;background:#f7f8fa;width:70%}.tot td.v{text-align:right;font-weight:700;color:" + PREMIUM_NAVY + "}.tot tr.g td{background:#eef1f5}.tot tr.g td.v{font-size:14px;font-weight:800}.tot tr:last-child td{border-bottom:0}"
      + ".words{margin:6px 0 0;font-size:10px}.words b{font-weight:800}"
      + ".tc{width:100%;border-collapse:collapse}.tc td{padding:4px 0;border-bottom:1px solid #e3e6ea;font-size:9.5px;vertical-align:top}.tc td.k{width:22%;font-size:7.5px;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;padding-top:7px}"
      + ".two{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:8px}.pbox{border:1px solid #c9ced6;padding:7px 10px;font-size:9.5px}.pbox b.h{display:block;color:" + PREMIUM_NAVY + ";font-size:10.5px;margin-bottom:4px}"
      + ".close{display:grid;grid-template-columns:1fr auto;gap:20px;align-items:end;margin-top:6px;break-inside:avoid}.close .msg{font-size:9.5px;color:#374151;line-height:1.55}"
      + ".sig{text-align:right;min-width:220px}.sig .for{font-weight:800;color:" + PREMIUM_NAVY + ";font-size:10px}.sig .seal{margin:2px 0 0}.sig .cap{border-top:1px solid " + PREMIUM_NAVY + ";padding-top:4px;font-size:9px;color:#374151}"
      + ".ft{margin-top:8px;padding:5px 32px 0;border-top:1px solid #c9ced6;text-align:center;font-size:8px;color:#6b7280}"
      + ".ein{border:1px solid #c9ced6;padding:6px 12px;margin-top:8px;display:flex;gap:14px;align-items:flex-start;font-size:9.5px;word-break:break-all;break-inside:avoid}.ein img{width:96px;height:96px;flex:none}"
      + ".ex{border:1px solid " + PREMIUM_GOLD + ";padding:6px 12px;margin-top:8px;font-size:9.5px;break-inside:avoid}.ex .decl{font-weight:700;margin-top:4px}"
      + "@media screen and (max-width:760px){.sheet{zoom:.7}}";
    var kv = function (k, v) { return P(v) ? '<span class="kv"><span>' + k + ':</span><b>' + esc(P(v)) + '</b></span>' : ''; };
    var mcell = function (k, v) { return '<div><span>' + k + '</span><b>' + (P(v) ? esc(P(v)) : '—') + '</b></div>'; };
    var contact = [s.website ? esc(s.website) : '', s.email ? esc(s.email) : '', f.tel ? esc(intlPhones(f.tel)) : ''].filter(Boolean).join(' &nbsp;·&nbsp; ');
    /* the four-cell strip: no. · date · (due date or e-way) · place of supply */
    var third = P(d.due) ? mcell('Due date', fdate(d.due)) : (f.eway ? mcell('E-Way Bill No.', f.eway) : mcell('Vehicle No.', f.veh));
    var meta = '<div class="meta">' + mcell('Invoice No.', f.inv) + mcell('Date', f.date) + third + mcell('Place of supply', f.pos) + '</div>';
    var party = function (title, name, addr, gst, state, phone, email, pan) {
      return '<div class="box"><h4>' + title + '</h4><div class="bd"><div class="nm">' + esc(name || '') + '</div>' + (P(addr) ? '<div class="ad">' + esc(P(addr)) + '</div>' : '')
        + '<div>' + kv('GSTIN', gst) + kv('State', state) + '</div>' + '<div>' + kv('PAN', pan) + kv('Mobile', phone) + kv('E-mail', email) + '</div></div></div>';
    };
    var sPan = f.pan, bPan = P(b.gstin).length === 15 ? P(b.gstin).slice(2, 12) : '';
    var seller = party('From — Supplier', s.name, String(s.address || '').replace(/\n/g, ', '), s.gstin, s.state, intlPhones(f.tel), s.email, sPan);
    var buyer = party('To — Buyer', b.name, b.address, b.gstin, f.bState || b.state, f.bPhone, f.bEmail, bPan);
    var thead = '<tr><th style="width:30px">Sr.</th><th>Description</th><th style="width:76px">HSN</th>' + (hasPack ? '<th style="width:96px">Packing</th>' : '')
      + '<th class="r" style="width:74px">Qty' + (unitOfItems ? ' (' + esc(unitOfItems) + ')' : '') + '</th><th class="r" style="width:88px">Rate' + (rUnit ? ' / ' + esc(rUnit) : '') + '</th><th class="r" style="width:104px">Amount</th></tr>';
    var rows = items.map(function (it, i) {
      var note = convNote(it), rowRu = P(it.rateUnit) || rUnit;
      return '<tr><td class="c">' + (i + 1) + '</td><td><div class="dn">' + esc(P(it.product)) + '</div>' + (P(it.desc) || P(it.grade) ? '<div class="ds">' + esc([P(it.grade), P(it.desc)].filter(Boolean).join(' · ')) + '</div>' : '') + (note ? '<div class="ds">' + note + '</div>' : '') + '</td>'
        + '<td>' + esc(P(it.hsn) || f.hsn) + '</td>' + (hasPack ? '<td>' + esc(P(it.packing) || '—') + '</td>' : '')
        + '<td class="r">' + qfmt(it.qty) + (P(it.unit) && P(it.unit) !== unitOfItems ? ' ' + esc(P(it.unit)) : '') + '</td><td class="r">INR ' + fmt(it.rate) + (rowRu !== rUnit ? '<br><span class="ds">/ ' + esc(rowRu) + '</span>' : '') + '</td><td class="r"><b>INR ' + fmt(lineTaxable(it)) + '</b></td></tr>';
    }).join('') + charges.map(function (c, i) {
      return '<tr><td class="c">' + (items.length + i + 1) + '</td><td><div class="dn">' + esc(P(c.label)) + '</div>' + (P(c.desc) ? '<div class="ds">' + esc(P(c.desc)) + '</div>' : '') + '</td><td>' + esc(P(c.hsn) || '9965') + '</td>' + (hasPack ? '<td>—</td>' : '') + '<td class="r">—</td><td class="r">—</td><td class="r"><b>INR ' + fmt(c.amount) + '</b></td></tr>';
    }).join('');
    var trow = function (k, v, g) { return '<tr' + (g ? ' class="g"' : '') + '><td class="l">' + k + '</td><td class="v">' + v + '</td></tr>'; };
    var goods = items.reduce(function (a, it) { return a + lineTaxable(it); }, 0), chargeSum = charges.reduce(function (a, c) { return a + (+c.amount || 0); }, 0);
    var tot = '<table class="tot">' + trow('Value of goods' + (items.length === 1 && +items[0].qty && +items[0].rate ? ' (' + qfmt(items[0].qty) + ' ' + esc(P(items[0].unit) || unitOfItems) + ' × INR ' + fmt(items[0].rate) + (rUnit ? '/' + esc(rUnit) : '') + ')' : ''), 'INR ' + fmt(goods))
      + (chargeSum ? trow('Charges', 'INR ' + fmt(chargeSum)) : '')
      + (isExport ? trow('IGST — zero-rated export under LUT', 'INR ' + f.igst) : f.interState ? trow('IGST @ ' + f.gstR + ' %' + (f.hsn ? ' (HSN ' + esc(f.hsn) + ')' : ''), 'INR ' + f.igst) : trow('CGST @ ' + f.halfR + ' %', 'INR ' + f.cgst) + trow('SGST @ ' + f.halfR + ' %', 'INR ' + f.sgst))
      + (cess ? trow('Cess', 'INR ' + fmt(cess)) : '') + (otherTax ? trow('Other tax', 'INR ' + fmt(otherTax)) : '') + (roundOff ? trow('Round off', (roundOff > 0 ? '+' : '−') + fmt(Math.abs(roundOff))) : '')
      + trow('Total payable (goods incl. GST)', 'INR ' + f.grand, true) + trow('Total quantity', qtyTotalEl(f)) + '</table>';
    var termsRows = terms.map(function (t, i) { var m = String(t).match(/^([A-Za-z][A-Za-z /&]{2,28}):\s*(.+)$/); return '<tr><td class="k">' + (m ? esc(m[1]) : 'Term ' + (i + 1)) + '</td><td>' + esc(m ? m[2] : t) + '</td></tr>'; }).join('');
    var bank = (s.bank || s.accNo || s.upi) ? '<div class="pbox"><b class="h">Bank Details — for payment</b>' + (s.name ? 'Account name: ' + esc(s.name) + '<br>' : '') + (s.bank ? esc(s.bank) + (s.bankBranch ? ', ' + esc(s.bankBranch) : '') + '<br>' : '') + (s.accNo ? 'A/C No.: ' + esc(s.accNo) : '') + (s.ifsc ? ' &nbsp;|&nbsp; IFSC: ' + esc(s.ifsc) : '') + (s.upi ? '<br>UPI: ' + esc(s.upi) : '') + '</div>' : '';
    var decl = '<div class="pbox"><b class="h">Declaration</b>' + PREMIUM_DECL + (f.rcm === 'Yes' ? '<br>Tax is payable on reverse charge.' : '') + '</div>';
    var sealLine = P(s.sealText) || [s.city, sSt.name].filter(Boolean).join(', ');
    var SB = '#1F3A68';   // the seal's blue, as stamped
    var seal = '<svg class="seal" width="68" height="68" viewBox="0 0 100 100" aria-hidden="true"><defs><path id="sealTop" d="M14,50 a36,36 0 0,1 72,0"/><path id="sealBot" d="M14,50 a36,36 0 0,0 72,0"/></defs>'
      + '<circle cx="50" cy="50" r="47" fill="none" stroke="' + SB + '" stroke-width="2.2"/><circle cx="50" cy="50" r="43.5" fill="none" stroke="' + SB + '" stroke-width=".8"/><circle cx="50" cy="50" r="28" fill="none" stroke="' + SB + '" stroke-width="1.4"/>'
      + '<text font-size="8.2" font-weight="700" fill="' + SB + '" letter-spacing="1.2" text-anchor="middle"><textPath href="#sealTop" startOffset="50%">' + esc(String(s.name || '').toUpperCase()) + '</textPath></text>'
      + (sealLine ? '<text font-size="5.6" font-weight="700" fill="' + SB + '" letter-spacing=".9" text-anchor="middle"><textPath href="#sealBot" startOffset="50%">' + esc(sealLine.toUpperCase()) + '</textPath></text>' : '')
      + '<text x="11" y="53" font-size="9" fill="' + SB + '">★</text><text x="81" y="53" font-size="9" fill="' + SB + '">★</text>'
      + '<g stroke="' + SB + '" stroke-width="1.2"><line x1="40" y1="43" x2="46" y2="43"/><circle cx="50" cy="43" r="1.1" fill="' + SB + '"/><line x1="54" y1="43" x2="60" y2="43"/><line x1="40" y1="57" x2="46" y2="57"/><circle cx="50" cy="57" r="1.1" fill="' + SB + '"/><line x1="54" y1="57" x2="60" y2="57"/></g></svg>';
    var eblock = eInv ? '<div class="ein"><div>' + [['IRN', d.irn], ['Ack No.', d.ackNo], ['Ack Date', fdate(d.ackDt)]].map(function (x) { return P(x[1]) ? '<div><span style="color:#6b7280;display:inline-block;min-width:64px">' + x[0] + '</span><b>' + esc(P(x[1])) + '</b></div>' : ''; }).join('') + '</div>'
      + (P(d.qrImage) ? '<img src="' + esc(P(d.qrImage)) + '" alt="e-Invoice QR">' : (P(d.qrData) ? '<img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=' + encodeURIComponent(P(d.qrData)) + '" alt="e-Invoice QR">' : '')) + '</div>' : '';
    var xkv = function (k, v) { return P(v) ? '<div><span style="color:#6b7280;display:inline-block;min-width:150px">' + k + '</span><b>' + esc(P(v)) + '</b></div>' : ''; };
    var xrows = isExport ? xkv('IEC', f.iec) + xkv('LUT No.', ex.lut || f.lut) + xkv('Shipping Bill No.', ex.shippingBill) + xkv('Port of Loading', ex.portLoading) + xkv('Port of Discharge', ex.portDischarge) + xkv('Country of Destination', ex.country) + xkv('Country of Origin', ex.origin) + xkv('Currency', ex.currency) + xkv('Exchange Rate', ex.fx) + xkv('Incoterms', ex.incoterms) + xkv('Container No.', ex.container) + (P(ex.declaration) ? '<div class="decl">' + esc(P(ex.declaration)) + '</div>' : '') : '';
    var xblock = xrows ? '<div class="ex"><h3 style="margin-top:0">Export Details</h3>' + xrows + '</div>' : '';
    var body = '<div class="sheet">'
      + '<div class="band"><div class="co">' + (bandLockup(f, 60) || (bandLogo(f, 66) + '<div class="n">' + wordmark(s.name) + '</div>')) + '</div>'
      + '<div class="ti"><div class="w">' + (isExport ? 'EXPORT TAX INVOICE' : 'TAX INVOICE') + '</div><div class="c">' + esc(copy) + '</div></div></div>'
      + ((contact || f.tagline) ? '<div class="contact">' + (f.tagline ? '<div class="pl">' + esc(f.tagline) + '</div>' : '') + contact + '</div>' : '')
      + '<div class="in">' + meta + '<div class="par">' + seller + buyer + '</div>'
      + ((f.transport || f.veh || f.station || f.grrr || (f.eway && P(d.due))) ? '<div class="meta" style="margin-top:0">' + mcell('Transport', f.transport) + mcell('Vehicle No.', f.veh) + mcell('Station', f.station) + mcell('GR/RR No.', f.grrr) + (f.eway && P(d.due) ? mcell('E-Way Bill No.', f.eway) : '') + '</div>' : '')
      + '<h3>' + (isExport ? 'Export supply' : 'Supply') + '</h3><table class="it"><thead>' + thead + '</thead><tbody>' + rows + '</tbody></table>'
      + tot + '<div class="words"><b>Amount in words:</b> ' + esc(words) + '</div>'
      + eblock + xblock
      + (termsRows ? '<h3>Terms and Conditions</h3><table class="tc">' + termsRows + '</table>' : '')
      + '<div class="two">' + bank + decl + '</div>'
      + '<div class="close"><div class="msg">' + (f.cfg.footerNote ? esc(f.cfg.footerNote) + '<br>' : '') + 'Reverse charge: ' + esc(f.rcm) + (f.jurisdiction ? ' &nbsp;·&nbsp; Subject to ' + esc(f.jurisdiction) + ' jurisdiction' : '') + '</div>'
      + (f.cfg.showSignature ? '<div class="sig"><div class="for">For ' + esc(String(f.signatory || s.name || '').toUpperCase()) + '</div>' + seal + '<div class="cap">Authorised Signatory &amp; Seal</div></div>' : '') + '</div></div>'
      + '<div class="ft">Invoice ' + esc(f.inv) + (f.date ? ' · ' + esc(f.date) : '') + ' · This is a tax invoice under the CGST Rules, 2017. Errors and omissions excepted.</div>'
      + '</div>';
    return doc(f, 'premium', css, body);
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
      desc: 'The firm\'s quotation letterhead as a tax invoice: navy band with the logo, gold rule, boxed invoice strip, From / To boxes, navy table with packing and units, totals block, terms as a list, bank and declaration boxes, seal.', render: premium }
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
