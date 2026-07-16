/* version-sync.test.js — one asset, one ?v= across every page.
 *
 * This shipped broken and nobody would have seen it: banks.html and settings.html
 * loaded recon-core.js?v=rc5 while reconcile.html still asked for rc4. A browser
 * holding rc4 in cache would hand the RECON PAGE a recon-core without
 * parseStatementHeader — and the calling code guards with `&&`, so it degrades to
 * the old behaviour instead of throwing. The feature would simply not happen, on
 * the one page it exists for, with no error anywhere.
 *
 * A mismatch is always a bug: the ?v= exists precisely to bust the cache, so two
 * values for one file mean one page is pinned to a version that no longer matches
 * the code the other pages run.
 *
 *   node version-sync.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ asset versions agree across pages ═══\n');

const pages = fs.readdirSync(__dirname).filter(f => /\.html$/.test(f));
const seen = {};   // asset -> { version -> [pages] }
for (const f of pages) {
  const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
  const re = /(?:src|href)="\.\/([\w.-]+\.(?:js|css))\?v=([\w.-]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    const [, asset, ver] = m;
    (seen[asset] || (seen[asset] = {}));
    (seen[asset][ver] || (seen[asset][ver] = [])).push(f);
  }
}

let checked = 0;
for (const asset of Object.keys(seen).sort()) {
  const vers = Object.keys(seen[asset]);
  checked++;
  ok(vers.length === 1,
    asset + ' is loaded at ' + vers.length + ' different versions — a cached older copy will silently ' +
    'hand some page a stale module:\n       ' +
    vers.map(v => '?v=' + v + ' → ' + seen[asset][v].join(', ')).join('\n       '));
}
ok(checked > 10, 'found the versioned assets to check (got ' + checked + ')');

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + ' · ' + checked + ' assets\n');
process.exit(fail ? 1 : 0);
