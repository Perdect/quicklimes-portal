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
  /* The `./` was REQUIRED here, so `src="ql-api.js?v=a5"` — written without the
     prefix — matched nothing and that asset was never version-checked at all.
     It could have changed under a cached URL forever without this test noticing.
     Both spellings are the same file; both are tracked now. */
  const re = /(?:src|href)="\.?\/?([\w.-]+\.(?:js|css))\?v=([\w.-]+)"/g;
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

/* ══════════ THE OTHER HALF: a file that CHANGED must get a NEW ?v= ══════════
   Agreement across pages is not enough. Ten files were edited in one session and
   only one got a bumped version — so every page kept asking for the OLD url, and a
   browser holding that url in cache keeps the OLD file. The specific way that bites:
   reconcile.js came to depend on Q.monthLabel in data.js. Fetch the new reconcile.js
   against a cached data.js?v=m28 that predates monthLabel, and monthName throws —
   the month groups on Bank Reconciliation render nothing at all.

   So: a manifest of content hashes. If a file's bytes changed and its ?v= did not,
   fail and say so. Regenerate after bumping with:
       node version-sync.test.js --update
*/
const MANIFEST = path.join(__dirname, 'asset-versions.json');
const crypto = require('crypto');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, f))).digest('hex').slice(0, 12);

const current = {};
for (const asset of Object.keys(seen)) {
  if (!fs.existsSync(path.join(__dirname, asset))) continue;    // externally hosted
  current[asset] = { v: Object.keys(seen[asset])[0], sha: sha(asset) };
}

if (process.argv.includes('--update')) {
  fs.writeFileSync(MANIFEST, JSON.stringify(current, null, 2) + '\n');
  console.log('  ✎ asset-versions.json updated — ' + Object.keys(current).length + ' assets\n');
  process.exit(0);
}

if (!fs.existsSync(MANIFEST)) {
  fail++; console.log('  ❌ asset-versions.json is missing — run: node version-sync.test.js --update');
} else {
  const prev = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  for (const asset of Object.keys(current).sort()) {
    const p0 = prev[asset];
    if (!p0) continue;                                          // a new file — nothing to compare
    const changed = p0.sha !== current[asset].sha;
    const bumped = p0.v !== current[asset].v;
    ok(!changed || bumped,
      asset + ' CHANGED but still ships as ?v=' + current[asset].v + '. Every page will keep asking for that ' +
      'url, so a cached browser keeps the OLD file — and if another module now depends on something new in ' +
      'this one, that page breaks with no error. Bump the ?v= on every page, then: node version-sync.test.js --update');
    /* Bumping a version without touching the file is also wrong: it busts every
       user's cache for nothing and hides which change actually shipped. */
    ok(!bumped || changed,
      asset + ' had its ?v= bumped to ' + current[asset].v + ' but its contents are identical — that evicts every ' +
      'user\'s cache for no reason. Revert the bump, or run --update if this is a legitimate re-issue.');
  }
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + ' · ' + checked + ' assets\n');
process.exit(fail ? 1 : 0);
