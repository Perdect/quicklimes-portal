/* invoice-template-choice.test.js — which invoice design a firm gets, and why.
   Run:  node dashboard/v2/invoice-template-choice.test.js

   WHY THIS EXISTS
   Deshwali declares its own print format on its profile (invoiceTemplate:'gst').
   The first cut let ANY stored per-browser value beat that — and every browser
   already held a bare 'classic' from the days when that was the only default.
   Result, seen live on 12-09-2026: the firm's invoice still came out in the old
   Classic design on the owner's own machine. This pins the precedence:
   an explicit pick ('!id') wins; a legacy bare 'classic' yields to the firm's
   declared format; any other legacy id was a real choice and stays; nothing
   stored means the firm's format, else 'classic'. */
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };

/* lift the two resolvers out of the shell's closure */
const k0 = src.indexOf('  function invoiceTemplateKey()');
const k1 = src.indexOf('\n  }', src.indexOf('  function invoiceTemplateId()')) + 4;
ok('both resolver functions found in shell.js', k0 > 0 && k1 > k0);
const TEMPLATES = ['gst', 'modern', 'mono', 'compact'].map(id => ({ id }));   // classic retired 2026-09-12; gst is first = the fallback
function resolve(stored, own) {
  const store = {}; if (stored != null) store['ql_inv_tpl_co1'] = stored;
  const window = { QLD: { co: { key: 'co1', invoiceTemplate: own } }, InvoiceTemplates: { TEMPLATES } };
  const localStorage = { getItem: k => (k in store ? store[k] : null) };
  return new Function('window', 'localStorage', src.slice(k0, k1) + '\nreturn invoiceTemplateId();')(window, localStorage);
}
/* the cases */
ok("nothing stored, firm declares gst → gst",                       resolve(null, 'gst') === 'gst');
ok("nothing stored, firm declares nothing → gst (first registered)", resolve(null, '') === 'gst');
ok("LEGACY bare 'classic', firm declares gst → the firm's gst",     resolve('classic', 'gst') === 'gst');
ok("LEGACY bare 'classic' (retired), firm declares nothing → gst",   resolve('classic', '') === 'gst');
ok("LEGACY bare 'modern' was a real choice → modern, even for gst", resolve('modern', 'gst') === 'modern');
ok("EXPLICIT '!classic' is now an unknown id → the firm's format",  resolve('!classic', 'gst') === 'gst');
ok("EXPLICIT '!mono' → mono",                                       resolve('!mono', 'gst') === 'mono');
ok("an unknown explicit id falls back to the firm's format",        resolve('!retired', 'gst') === 'gst');
ok("an unknown explicit id with no firm format falls back to gst",  resolve('!retired', '') === 'gst');
ok("an unknown legacy id falls back to the firm's format",          resolve('retired', 'gst') === 'gst');
ok("a firm declaring an unknown format still gets gst",             resolve(null, 'nope') === 'gst');
/* the setter marks picks explicitly, so a new pick of Classic really sticks */
ok("setInvoiceTemplate stores '!' + id", /localStorage\.setItem\(invoiceTemplateKey\(\), '!' \+ id\)/.test(src));

console.log('\n═══ invoice design precedence ═══\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' TEMPLATE-CHOICE TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED — a firm can get the wrong invoice design\n');
process.exit(fail === 0 ? 0 : 1);
