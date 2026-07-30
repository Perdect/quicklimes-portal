/* quote.test.js — the Price Quotation is a real, wired document, and it can
 * never disagree with the Proposal on price. (Lead Discovery: quote + proposal)
 *
 * WHAT THIS PINS.
 *  1. leadPricing() is the SINGLE source of the delivered ₹/MT — BOTH openQuote
 *     and openProposal compute price through it, so the short quote and the full
 *     proposal can never show a different number for the same lead. (A duplicated
 *     price calc that drifts is a money bug that reaches the customer.)
 *  2. openQuote exists, renders the shared .pr-* letterhead, and offers both
 *     Print/Save-PDF and Send-on-WhatsApp.
 *  3. A "Quote" action is wired everywhere the "Proposal" action is (the company
 *     card AND the pipeline lead panel), or the feature is unreachable.
 *  4. The tofu "🖶" print glyph is gone (replaced by an SVG) in BOTH documents.
 *
 *   node quote.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'discover.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ❌  ' + m); } };
const fn = name => { const i = src.indexOf('function ' + name + '('); if (i < 0) return ''; const o = src.indexOf('{', i); let j = o + 1, d = 1; while (j < src.length && d > 0) { const c = src[j]; if (c === '{') d++; else if (c === '}') d--; j++; } return src.slice(i, j); };

console.log('\n═══ lead discovery · quote + proposal share one price, both wired ═══\n');

/* 1. one pricing source */
ok(!!fn('leadPricing'), 'leadPricing() exists (the shared price computation)');
ok(/return\s*{[^}]*delivered[^}]*}/.test(fn('leadPricing').replace(/\n/g, ' ')), '  it returns the delivered price');
ok(/leadPricing\(r\)/.test(fn('openQuote')), 'openQuote prices through leadPricing()');
ok(/leadPricing\(r\)/.test(fn('openProposal')), 'openProposal prices through leadPricing()');
/* Neither may recompute freight on its own (that is how two numbers drift). */
ok(!/roadKm/.test(fn('openQuote')), '  openQuote does not recompute freight itself');
ok(!/roadKm/.test(fn('openProposal')), '  openProposal does not recompute freight itself');

/* 2. the quote is a real professional document */
const q = fn('openQuote');
ok(!!q, 'openQuote() exists');
ok(/class="pr-doc"|prShell\(/.test(q), '  it renders the shared .pr-* letterhead');
ok(/pr-tbl/.test(q) && /Delivered/.test(q), '  with a delivered-pricing table');
ok(/Print \/ Save PDF/.test(q), '  a Print / Save PDF action');
ok(/Send on WhatsApp/.test(q) && /qtWa/.test(q), '  and a Send-on-WhatsApp action');
ok(/wa\.me|WACore/.test(q), '  the WhatsApp handler builds a real wa link');
ok(/valid for 7 days|valid 7 days|7 days/i.test(q), '  states a validity period');

/* 3. wired everywhere the proposal is */
ok(/id="cdQuote"/.test(src) && /wire\('cdQuote'/.test(src), 'the company card has a Quote button, wired to openQuote');
ok(/id="plQuote"/.test(src) && /on\('plQuote'/.test(src), 'the pipeline lead panel has a Quote button, wired to openQuote');

/* 4. the tofu print glyph is gone in BOTH */
ok(!/🖶/.test(src), 'the "🖶" print glyph (tofu on many systems) is gone from discover.js');
ok(/const IC_PRINT =/.test(src) && /IC_PRINT\}Print \/ Save PDF/.test(src.replace(/\$\{/g, '${')), '  replaced by an SVG printer icon');

console.log(fail ? `\n❌ FAILED — ${fail}\n` : `\n✅ PASSED — ${pass} checks; the quote is wired, professional, and shares the proposal's price\n`);
process.exit(fail ? 1 : 0);
