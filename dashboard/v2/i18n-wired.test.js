/* i18n-wired.test.js — Hindi must actually reach the screen.
 *
 * THE BUG THIS EXISTS FOR: i18n.js shipped complete — dictionary, t(), a
 * Settings switcher that saved the choice and reloaded — and had ZERO call
 * sites. Nothing anywhere invoked QLI18n.t(), and the file was loaded by 3
 * pages of 34. Picking हिन्दी reloaded the page into perfect English. The
 * owner's report was four words: "hindi language not working".
 *
 * The fix is the DOM translator (applyTo + a MutationObserver): ONE wiring
 * point instead of 450 call sites. So this suite pins three things:
 *   1. the translator's contract (exact match, honest fallback, user data
 *      untouched),
 *   2. the WIRING — every app page loads i18n.js and boot() actually arms
 *      the observer,
 *   3. the switcher still saves + reloads.
 *
 *   node i18n-wired.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ i18n · Hindi reaches the screen ═══\n');

/* lang() reads localStorage at CALL time — stub it before require, flip it per case. */
let LANG = 'hi';
globalThis.localStorage = { getItem: k => (k === 'ql_lang' ? LANG : null), setItem: () => {}, removeItem: () => {} };
const I = require(path.join(__dirname, 'i18n.js'));

/* ── 1. the contract ── */
eq('t() translates a glossary phrase', I.t('Sales'), 'बिक्री');
eq('t() translates a full multi-word key', I.t('Purchase Register'), 'खरीद रजिस्टर');
eq('an unknown phrase falls back to ITSELF — readable English, never a key or blank', I.t('Not a phrase yet'), 'Not a phrase yet');
eq('both() pairs Hindi with the printed-form English', I.both('E-Way Bill'), 'ई-वे बिल / E-Way Bill');
LANG = 'en';
eq('in English, t() is identity', I.t('Sales'), 'Sales');
LANG = 'hi';

/* ── 2. the DOM translator ──
   A hand-rolled node tree with exactly the surface applyTo() walks:
   nodeType, nodeValue, tagName, getAttribute/setAttribute, firstChild,
   nextSibling. No jsdom — the point is the walker's DECISIONS, not the DOM. */
function text(s) { return { nodeType: 3, nodeValue: s, nextSibling: null }; }
function el(tag, attrs, children) {
  const store = Object.assign({}, attrs || {});
  const node = {
    nodeType: 1, tagName: tag, nextSibling: null, firstChild: null,
    getAttribute: k => (k in store ? store[k] : null),
    setAttribute: (k, v) => { store[k] = v; },
    _attrs: store
  };
  (children || []).forEach((c, i) => { if (i === 0) node.firstChild = c; else children[i - 1].nextSibling = c; });
  return node;
}
{
  const t1 = text('  Sales Register  ');
  const t2 = text('Sales Register of Gotan');           // NOT an exact key
  const inp = el('INPUT', { value: 'Sales', placeholder: 'Search' }, []);
  const keep = el('DIV', { 'data-no-i18n': '' }, [text('Sales')]);
  const btn = el('BUTTON', { title: 'Filters' }, [text('Filters')]);
  const root = el('DIV', {}, [t1, t2, inp, keep, btn]);
  const n = I.applyTo(root);
  ok(/खरीद रजिस्टर|बिक्री रजिस्टर/.test(t1.nodeValue), 'an exact text match translates in place: “' + t1.nodeValue.trim() + '”');
  ok(/^\s/.test(t1.nodeValue), '  and the surrounding whitespace survives (layout-significant in inline runs)');
  eq('a SENTENCE containing a key is left alone — exact match only, no partial rewrites', t2.nodeValue, 'Sales Register of Gotan');
  eq('an INPUT is never entered — the user\'s data is not ours to rewrite', inp._attrs.value, 'Sales');
  eq('  though its UI placeholder does translate', inp._attrs.placeholder, 'खोजें');
  eq('data-no-i18n keeps its subtree in English (the invoice preview\'s printed format)', keep.firstChild.nodeValue, 'Sales');
  eq('a button translates its text', btn.firstChild.nodeValue, 'छाँटें');
  eq('  and its title attribute', btn._attrs.title, 'छाँटें');
  ok(n >= 4, 'applyTo reports its work (' + n + ' replacements)');
  eq('  a second pass finds nothing — translated text matches no key, so the observer loop starves', I.applyTo(root), 0);
  LANG = 'en';
  eq('in English the walker does nothing at all', I.applyTo(el('DIV', {}, [text('Sales')])), 0);
  LANG = 'hi';
}

/* ── 3. THE WIRING — what was actually missing ── */
{
  /* Strip BOTH comment styles — a `//boot();` would satisfy a block-only strip
     and let a disarmed translator pass. That exact mutation slipped through the
     first version of this pin. */
  const src = fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1 ');
  ok(/boot\(\);/.test(src), 'boot() is CALLED at load — a translator nothing starts is the bug this file had');
  ok(/new MutationObserver\(/.test(src), '  and arms a MutationObserver, so re-renders re-translate');
  ok(/applyTo\(document\.body\)/.test(src), '  over the real page body');

  const pages = fs.readdirSync(__dirname).filter(f => f.endsWith('.html'));
  const appPages = pages.filter(f => /data\.js\?v=/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
  const missing = appPages.filter(f => !/i18n\.js\?v=/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
  ok(appPages.length >= 28, 'the sweep covered the app (' + appPages.length + ' data-loading pages)');
  eq('EVERY app page loads i18n.js — it was 3 of 34, which is why Hindi "did not work"', missing, []);

  const st = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8');
  ok(/QLI18n\.setLang\(sel\.value\)/.test(st), 'the Settings switcher still calls setLang (save + reload)');
}

/* ── 4. the checker can fail (probe) ── */
{
  const probe = el('DIV', {}, [text('zz-not-a-key-zz')]);
  eq('probe: an untranslatable node yields 0', I.applyTo(probe), 0);
  ok(!I.has('zz-not-a-key-zz') && I.has('Sales'), 'has() distinguishes real keys from probes');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
