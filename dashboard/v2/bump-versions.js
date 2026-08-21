#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
   BUMP WHAT ACTUALLY CHANGED.

   version-sync.test.js already detects "this file's bytes changed but its
   ?v= did not" — the failure that ships an edited file under a cached URL,
   so browsers keep the OLD copy and the page breaks with no error.

   The trap is the fix it recommends: `node version-sync.test.js --update`
   rewrites the manifest to the CURRENT state, which records the new hash
   against the OLD version string and turns the alarm off without fixing
   anything. I did that twice in one session. Both times a page went live
   broken — 'QLX.heroHTML is not a function', then a period filter that
   silently vanished because the header it mounts into had no id yet.

   So: this does the bump, instead of asking a human to remember to.
   For every asset whose bytes differ from the manifest, it appends a
   character to its ?v= across every page that references it, then updates
   the manifest. Nothing to remember, nothing to forget.

     node bump-versions.js            # bump changed assets, update manifest
     node bump-versions.js --dry      # say what would change, touch nothing
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const DIR = __dirname;
const MANIFEST = path.join(DIR, 'asset-versions.json');
const DRY = process.argv.includes('--dry');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, f))).digest('hex').slice(0, 12);

const pages = fs.readdirSync(DIR).filter(f => f.endsWith('.html'));

/* Which ?v= does each asset ship under, and which pages reference it? */
const seen = {};                                   // asset -> { version -> [pages] }
const RE = /(?:src|href)="\.?\/?([\w.-]+\.(?:js|css))\?v=([\w.-]+)"/g;
for (const p of pages) {
  const src = fs.readFileSync(path.join(DIR, p), 'utf8');
  let m;
  while ((m = RE.exec(src))) {
    const [, asset, v] = m;
    (seen[asset] = seen[asset] || {})[v] = (seen[asset][v] || []).concat(p);
  }
}

if (!fs.existsSync(MANIFEST)) {
  console.error('asset-versions.json is missing — run: node version-sync.test.js --update');
  process.exit(1);
}
const prev = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

/* A new suffix character, so the URL changes but stays readable and the
   history of an asset's versions is still legible at a glance. */
const nextV = v => {
  const m = /^(.*?)(\d*)$/.exec(v);
  return /[a-z]$/.test(v) && v.length < 24 ? v + 'a' : (m[1] + ((+m[2] || 0) + 1));
};

const changed = [];
for (const asset of Object.keys(seen)) {
  const file = path.join(DIR, asset);
  if (!fs.existsSync(file)) continue;                          // externally hosted
  const versions = Object.keys(seen[asset]);
  const rec = prev[asset];
  if (!rec) { changed.push({ asset, from: versions[0], to: nextV(versions[0]), why: 'not in the manifest yet' }); continue; }
  if (rec.sha === sha(asset)) continue;                        // unchanged — leave it alone
  if (versions.length > 1) {
    console.error('  ⚠ ' + asset + ' ships under ' + versions.length + ' different versions (' + versions.join(', ') +
                  ') — fix that by hand first; bumping would hide it.');
    process.exitCode = 1; continue;
  }
  if (versions[0] !== rec.v) { changed.push({ asset, from: rec.v, to: versions[0], why: 'already bumped by hand' }); continue; }
  changed.push({ asset, from: versions[0], to: nextV(versions[0]), why: 'content changed' });
}

if (!changed.length) {
  console.log('\n  Nothing to bump — every asset matches the version it ships under.\n');
  process.exit(process.exitCode || 0);
}

console.log('\n  ' + (DRY ? 'Would bump' : 'Bumping') + ' ' + changed.length + ' asset' + (changed.length === 1 ? '' : 's') + ':');
for (const c of changed) {
  console.log('    ' + c.asset.padEnd(22) + c.from + '  →  ' + c.to + '   (' + c.why + ')');
  if (DRY || c.from === c.to) continue;
  const esc = c.asset.replace(/\./g, '\\.');
  const find = new RegExp('(' + esc + '\\?v=)' + c.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=")', 'g');
  for (const p of pages) {
    const f = path.join(DIR, p), src = fs.readFileSync(f, 'utf8');
    const out = src.replace(find, '$1' + c.to);
    if (out !== src) fs.writeFileSync(f, out);
  }
}

if (DRY) { console.log('\n  (dry run — nothing written)\n'); process.exit(0); }

/* Re-read after rewriting, so the manifest records what the pages now say. */
const current = {};
for (const p of pages) {
  const src = fs.readFileSync(path.join(DIR, p), 'utf8');
  let m; const re = new RegExp(RE.source, 'g');
  while ((m = re.exec(src))) {
    const [, asset, v] = m;
    if (fs.existsSync(path.join(DIR, asset))) current[asset] = { v, sha: sha(asset) };
  }
}
fs.writeFileSync(MANIFEST, JSON.stringify(current, null, 2) + '\n');
console.log('\n  ✎ asset-versions.json updated — ' + Object.keys(current).length + ' assets');
console.log('  Remember the service-worker CACHE constant in sw.js if shell assets moved.\n');
