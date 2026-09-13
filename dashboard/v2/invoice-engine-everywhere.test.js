/* invoice-engine-everywhere.test.js — every page that can print an invoice must load the design engine.
   Run:  node dashboard/v2/invoice-engine-everywhere.test.js

   WHY THIS EXISTS
   QLShell.renderInvoice() falls back to a built-in layout when
   invoice-templates.js is not on the page. The GST Invoice page loaded it; the
   Sales Register did not — so "Print" from the register produced a different
   invoice from the one previewed: no Tel. line, Gotan's declaration on
   Deshwali's paper, the old bank format. Found 12-09-2026 from a PDF the owner
   printed ("where is my mobile number??"). Printing is reachable from any page
   with a row menu or the command palette, so the engine goes wherever the shell
   goes, and this fails the day a page forgets it. */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const pages = fs.readdirSync(__dirname).filter(f => f.endsWith('.html'));
let withShell = 0;
for (const f of pages) {
  const h = fs.readFileSync(path.join(__dirname, f), 'utf8');
  if (!/src="\.\/shell\.js\?v=/.test(h)) continue;
  withShell++;
  ok(f + ' loads invoice-templates.js', /src="\.\/invoice-templates\.js\?v=/.test(h));
  const a = h.indexOf('invoice-templates.js'), b = h.indexOf('./shell.js?v=');
  ok(f + ' loads the engine BEFORE shell.js (renderInvoice must find it)', a > 0 && b > a);
}
ok('the sweep actually covered the app (' + withShell + ' shell pages)', withShell >= 30);
ok('sales.html — the page the owner printed from — is among them', pages.includes('sales.html'));
const shell = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8');
ok('printInvoice (the row menu) goes through the design engine, not the legacy layout', /w\.document\.write\(\(window\.QLShell && window\.QLShell\.renderInvoice\) \? window\.QLShell\.renderInvoice\(d\) : invoiceHTML\(d\)\);/.test(shell));
ok('renderInvoice still has its fallback (a page with no engine prints SOMETHING, not nothing)', /if \(!T\) return invoiceHTML\(d\);/.test(shell));
console.log('\n═══ invoice engine on every page ═══\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' ENGINE-COVERAGE TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED — a page prints the wrong invoice design\n');
process.exit(fail === 0 ? 0 : 1);
