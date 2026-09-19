/* QLQR — QR codes rendered IN-PROCESS as inline SVG, for the invoice engine.

   Wraps the vendored qrcode-generator (Kazuhiko Arase, MIT — qrcode-generator.js).
   Nothing is fetched: the old templates built the e-invoice QR as an
   api.qrserver.com URL, which put the signed invoice into a third party's
   query log on every preview, printed blank when the fetch lost the race
   with print(), and at 84px could not hold a ~700-character IRP signature.

   qrSvg(text, px, opts) → an <svg> string: error-correction M by default
   (the IRP signature is a JWS of several hundred bytes — byte mode, the
   version is chosen automatically), a 4-module quiet zone, crisp at any
   print resolution because it is vector. Returns '' for empty input or
   when the text will not fit any version (a truncated QR is worse than
   none — the caller must not print a broken code).

   The SignedQRCode from the IRP is encoded EXACTLY as received (spec: the
   signed payload is never modified, never rebuilt locally). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./qrcode-generator.js'));
  else root.QLQR = factory(root.qrcode);
}(typeof self !== 'undefined' ? self : this, function (qrcode) {
  'use strict';
  /* UTF-8 bytes, not the library's Latin-1 default — a ₹ or a Hindi party name must round-trip */
  if (qrcode && qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  function matrix(text, ecl) {
    if (!qrcode || !text) return null;
    try {
      var qr = qrcode(0, ecl || 'M');   // 0 = auto version
      qr.addData(String(text), 'Byte');
      qr.make();
      var n = qr.getModuleCount(), rows = [];
      for (var r = 0; r < n; r++) { var row = []; for (var c = 0; c < n; c++) row.push(qr.isDark(r, c) ? 1 : 0); rows.push(row); }
      return { size: n, rows: rows };
    } catch (e) { return null; }   // too long for version 40 at this level
  }
  function svg(text, px, opts) {
    opts = opts || {};
    var m = matrix(text, opts.ecl);
    if (!m) return '';
    var q = opts.quiet == null ? 4 : opts.quiet, n = m.size, w = n + 2 * q, size = +px || 160;
    var d = '';
    for (var r = 0; r < n; r++) {
      var c = 0;
      while (c < n) {   // one path segment per run of dark modules — small, crisp, no seams
        if (!m.rows[r][c]) { c++; continue; }
        var s = c; while (c < n && m.rows[r][c]) c++;
        d += 'M' + (s + q) + ' ' + (r + q) + 'h' + (c - s) + 'v1h-' + (c - s) + 'z';
      }
    }
    return '<svg class="' + (opts.cls || 'qr') + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + w + '" width="' + size + '" height="' + size + '" shape-rendering="crispEdges" role="img" aria-label="' + (opts.label || 'QR code') + '"><rect width="' + w + '" height="' + w + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  return { matrix: matrix, svg: svg };
}));
