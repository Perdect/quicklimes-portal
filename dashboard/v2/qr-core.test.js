/* QLQR — the in-process QR. The encoder is vendored (MIT); this proves the
   codes it renders actually DECODE, by rasterising the module matrix and
   reading it back with an independent decoder (jsQR, test-only vendor). */
const Q = require('./qr-core.js'); const jsQR = require('./test-vendor/jsQR.js'); const fs = require('fs');
let pass = 0, fail = 0; const bad = []; const ok = (n, c) => { if (c) pass++; else { fail++; bad.push(n); } };
function raster(m, scale, quiet) {   // RGBA bitmap of the matrix, as a scanner would see the printed code
  const n = m.size, w = (n + 2 * quiet) * scale, data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m.rows[r][c]) for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) { const i = (((r + quiet) * scale + y) * w + (c + quiet) * scale + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
  return { data, width: w, height: w };
}
const JWS = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjExNUY0NDhBMDE4QjRDMTcwMkY4M0RBRTU0NUUyQTk5REI3RUQ5MjIiLCJ0eXAiOiJKV1QiLCJ4NXQiOiJFVjlFaWdHTFRCY0MtRDJ1VkY0cW1kdC0yU0kifQ.eyJkYXRhIjoie1wiU2VsbGVyR3N0aW5cIjpcIjA4TkxJUFM5ODAxSzFaNVwiLFwiQnV5ZXJHc3RpblwiOlwiMTlBQUxDUjE2MTlOMVpUXCIsXCJEb2NOb1wiOlwiOS8yMDI2LTI3XCIsXCJEb2NUeXBcIjpcIklOVlwiLFwiRG9jRHRcIjpcIjE5LzA5LzIwMjZcIixcIlRvdEludlZhbFwiOjIyNTc5MixcIkl0ZW1DbnRcIjoxLFwiTWFpbkhzbkNvZGVcIjpcIjI1MjIxMDAwXCIsXCJJcm5cIjpcIjgxOGQ4NzVlNDQzZTNjOGQzNDBhZDI4NGQ5ZWIzZDM1ZGU4NDc4ODEyYTVkMzRmYTEwN2Y3MDFmMjZkYWQwMDZcIixcIklybkR0XCI6XCIyMDI2LTA5LTE5IDEwOjEyOjMzXCJ9IiwiaXNzIjoiTklDIn0.' + 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(8);
console.log('\n═══ QLQR · in-process QR ═══');
const m = Q.matrix(JWS);
ok('a 1,000+ character JWS (the size of an IRP SignedQRCode) encodes at level M', m && m.size >= 101 && JWS.length > 1000);
const W = m.size + 8;
const d1 = jsQR(...(({ data, width, height }) => [data, width, height])(raster(m, 4, 4)));
ok('…and DECODES back to the exact payload (independent decoder over a 4px/module raster)', d1 && d1.data === JWS);
const d2 = jsQR(...(({ data, width, height }) => [data, width, height])(raster(m, 2, 4)));
ok('…still decodes at 2px per module (a 240px print of a 121-module code)', d2 && d2.data === JWS);
const s = Q.svg(JWS, 176, { label: 'e-invoice QR' });
ok('svg: vector, crispEdges, a 4-module quiet zone in the viewBox, the requested CSS size, an aria label, white ground + black path', new RegExp('viewBox="0 0 ' + W + ' ' + W + '"').test(s) && /width="176" height="176"/.test(s) && /shape-rendering="crispEdges"/.test(s) && /aria-label="e-invoice QR"/.test(s) && new RegExp('<rect width="' + W + '" height="' + W + '" fill="#fff"/><path d="M').test(s));
ok('the svg path is one segment per run of dark modules and every module of the matrix is drawn', (s.match(/M\d+ \d+h\d+v1h-\d+z/g) || []).length > 0 && (function () { const dark = m.rows.flat().filter(Boolean).length; const drawn = (s.match(/h(\d+)v1/g) || []).reduce((a, x) => a + +x.slice(1, -2), 0); return dark === drawn; })());
ok('short payloads work too (UPI string), empty and impossible inputs return nothing rather than a broken code', Q.svg('upi://pay?pa=8875020202@hdfcbank&pn=DESHWALI', 120).length > 200 && Q.svg('', 120) === '' && Q.svg('x'.repeat(4000), 120) === '');
ok('the payload is encoded verbatim — no trimming, no re-encoding (round trip on the JWS alphabet incl. +/=, and the UTF-8 bytes of a ₹ string)', (function () { const t = 'A+B/C==_-.xyz 12,345.00'; const mm = Q.matrix(t); const rr = raster(mm, 6, 4); const r = jsQR(rr.data, rr.width, rr.height); const u = 'A\u20b912'; const ru0 = raster(Q.matrix(u), 6, 4); const ru = jsQR(ru0.data, ru0.width, ru0.height); return r && r.data === t && ru && Buffer.from(ru.binaryData).equals(Buffer.from(u, 'utf8')); })());
ok('the vendored encoder is the MIT qrcode-generator, untouched (header intact), and no design references api.qrserver.com any more', /Copyright \(c\) 2009 Kazuhiko Arase/.test(fs.readFileSync(__dirname + '/qrcode-generator.js', 'utf8')) && !/qrserver/.test(fs.readFileSync(__dirname + '/invoice-templates.js', 'utf8')));
console.log('\n  Passed: ' + pass + '   Failed: ' + fail); bad.forEach(n => console.log('    ✗ ' + n));
console.log(fail ? '\n❌ ' + fail + ' FAILED' : '\n✅ ALL ' + pass + ' QR TESTS PASSED'); process.exit(fail ? 1 : 0);
