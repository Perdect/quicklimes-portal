/* waphone.test.js — ONE owner decides who we message.
 *
 * The bug: `const n = d.length === 10 ? '91' + d : d`. An Indian number stored
 * with the STD trunk 0 — 09829069545 — is ELEVEN digits, so the rule never fired,
 * no country code was added, and wa.me was handed a number that is not the
 * customer's. Best case WhatsApp rejects it. Worst case it resolves to A REAL
 * DIFFERENT PERSON who receives a demand for ₹1,30,000 in Gotan's name — which
 * also leaks what a customer owes to a stranger.
 *
 * It was copy-pasted into SEVEN places: collections, ledger, purchase, parties,
 * payables, sales (twice, inline) and shell.js. wa-core.js already had the
 * correct, 94-check-tested normalizePhone the whole time — trunk 0, the 0091
 * prefix, the 6-9 mobile rule, and returning '' rather than guessing. icp.js was
 * the only caller that used it.
 *
 * So the fix is not "fix seven copies", it is "there is one owner". These checks
 * are static because that is the only thing that catches an EIGHTH copy being
 * pasted in next month — no runtime test visits every page's WhatsApp button.
 * Same reasoning as company-switch.test.js.
 *
 *   node waphone.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');
const WA = require('./wa-core.js');

let pass = 0, fail = 0;
/* ok(CONDITION, message) — condition first, matching every other test in this
   directory. The first draft declared ok(m, c) but every call site passed
   (condition, message), so `c` received the message STRING — always truthy — and
   the entire static section passed unconditionally. 155 green checks, and the two
   that mattered could not fail. Mutation testing is the only reason I know:
   pasting the broken copy back into ledger.js did not trip a thing. */
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(a === b, m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ who we message · one owner ═══\n');

/* ── 1. The engine's rule, stated where it can be read ── */
eq('a bare 10-digit mobile gets +91', WA.normalizePhone('9829069545'), '919829069545');
eq('THE BUG: an STD trunk 0 is stripped, not passed through', WA.normalizePhone('09829069545'), '919829069545');
eq('  formatted the way a human types it', WA.normalizePhone('098290-69545'), '919829069545');
eq('an 0091 international prefix is stripped', WA.normalizePhone('00919829069545'), '919829069545');
eq('an already-qualified 91 number is untouched', WA.normalizePhone('919829069545'), '919829069545');
eq('+91 with spaces', WA.normalizePhone('+91 98290 69545'), '919829069545');

/* The refusal is the safety property. A wrong recipient is worse than none. */
eq('junk is refused, not guessed', WA.normalizePhone('12345'), '');
eq('a landline is not messaged as a mobile', WA.normalizePhone('0294 2345678'), '');
eq('an Indian mobile cannot start with 0-5', WA.normalizePhone('1234567890'), '');
eq('empty stays empty', WA.normalizePhone(''), '');
eq('null does not become "null"', WA.normalizePhone(null), '');

/* ── 2. NO PAGE MAY RE-IMPLEMENT IT ──
   This is the check that actually matters. The engine being right proved nothing
   for two months while seven pages ignored it. */
const files = fs.readdirSync(__dirname).filter(f => /\.js$/.test(f) && !/\.test\.js$/.test(f) && f !== 'wa-core.js');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');   // prose quotes the old code

for (const f of files) {
  const src = strip(fs.readFileSync(path.join(__dirname, f), 'utf8'));

  ok(!/length\s*===?\s*10\s*\?\s*['"]91['"]/.test(src),
    f + ': re-implements the country-code rule ("length===10 ? \'91\'"). This is the exact copy that dropped the +91 on trunk-0 numbers. Call WACore.waLink / WACore.normalizePhone instead.');

  /* A raw wa.me URL built with a number expression = a page deciding the
     recipient itself. `wa.me/?text=` (no recipient) is the sanctioned fallback:
     it opens WhatsApp's contact picker so a human chooses. */
  const raw = (src.match(/wa\.me\/(?!\?text)[^'"`\s]*/g) || []);
  ok(raw.length === 0,
    f + ': builds a wa.me recipient itself (' + raw.slice(0, 2).join(', ') + '). Only wa-core may decide who gets the message.');
}

/* ── 3. …and the engine must actually BE there when they call it ──
   Every delegation is `window.WACore ? … : no-recipient`. If a page forgets the
   script tag, its WhatsApp button silently degrades to the picker on every send.
   Safe, but not what anyone intended. */
const pages = fs.readdirSync(__dirname).filter(f => /\.html$/.test(f));
for (const p of pages) {
  const src = fs.readFileSync(path.join(__dirname, p), 'utf8');
  if (!/shell\.js/.test(src)) continue;                       // not an app page
  ok(/wa-core\.js/.test(src),
    p + ': loads shell.js (which delegates waLink to WACore) but not wa-core.js — every WhatsApp link on this page would lose its recipient.');
  const w = src.indexOf('wa-core.js'), s = src.indexOf('shell.js');
  if (w >= 0 && s >= 0) ok(w < s, p + ': loads wa-core AFTER shell.js');
}

/* ── 4. The link builder, end to end ── */
ok(/^https:\/\/wa\.me\/919829069545\?text=/.test(WA.waLink('09829069545', 'hi')),
  'waLink puts the NORMALISED number in the URL');
ok(WA.waLink('9829069545', 'a b&c').includes('a%20b%26c'), 'the message is URL-encoded');
eq('an untrusted number yields no recipient — WhatsApp asks', WA.waLink('12345', 'hi'), 'https://wa.me/?text=hi');
ok(!/undefined|NaN/.test(WA.waLink('9829069545', 'hi')), 'no NaN/undefined in a link a customer receives');

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
