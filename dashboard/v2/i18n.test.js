/* i18n.test.js — Hindi that a factory owner can trust.
 *
 * The app had ZERO Hindi and no translation layer. This pins the two rules that
 * matter before 34 pages get retrofitted onto it:
 *
 *   1. AN UNTRANSLATED PHRASE FALLS BACK TO ENGLISH. Not to '', not to a key.
 *      With 450+ strings to convert, misses are certain — the question is only
 *      whether a miss shows readable English or a blank cell to a 55-year-old
 *      plant owner who switched to Hindi expecting the app to still work.
 *
 *   2. THE OWNER'S GLOSSARY IS REPRODUCED VERBATIM. Sameer supplied these terms;
 *      he knows what his purchase manager says. If I typo'd or "improved" one, no
 *      test I write from my own Hindi would catch it — so the list below is
 *      transcribed from HIS message and compared character by character.
 *
 *   node i18n.test.js
 */
'use strict';
const I = require('./i18n.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
// JSON-compare, not ===: two arrays are never === . I wrote this exact bug in
// monthlabel.test.js earlier today and it reported "got: [] expected: []" as a FAILURE.
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ i18n · Hindi ═══\n');

let LS = {};
global.localStorage = { getItem: k => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = v; } };
const hi = () => { LS['ql_lang'] = 'hi'; };
const en = () => { LS['ql_lang'] = 'en'; };

/* ══════════ 1. THE OWNER'S GLOSSARY, VERBATIM ══════════
   Transcribed from his message. Any drift is a defect in MY transcription. */
{
  hi();
  const GLOSSARY = [
    ['Sales', 'बिक्री'], ['Purchase', 'खरीद'], ['Inventory', 'स्टॉक'],
    ['Customer', 'ग्राहक'], ['Supplier', 'आपूर्तिकर्ता'], ['Outstanding', 'बकाया राशि'],
    ['Payment Received', 'भुगतान प्राप्त'], ['Payment Due', 'भुगतान लंबित'],
    ['Dispatch', 'माल रवाना'], ['Production', 'उत्पादन'], ['Profit', 'लाभ'], ['Loss', 'हानि'],
    ['GST Summary', 'GST सारांश'], ['E-Way Bill', 'ई-वे बिल'], ['Ledger', 'खाता बही'],
    ['Bank Reconciliation', 'बैंक मिलान'], ['Manufacturing Cost', 'उत्पादन लागत'],
    ['Quick Lime Production', 'क्विक लाइम उत्पादन'], ['Hydrated Lime Production', 'हाइड्रेटेड लाइम उत्पादन']
  ];
  GLOSSARY.forEach(([enS, hiS]) => eq('◆ ' + enS, I.t(enS), hiS));

  const MODULES = [
    ['Purchase Management', 'खरीद प्रबंधन'], ['Sales Management', 'बिक्री प्रबंधन'],
    ['Production Management', 'उत्पादन प्रबंधन'], ['Stock Management', 'स्टॉक प्रबंधन'],
    ['Transport Management', 'परिवहन प्रबंधन'], ['Finance & Accounts', 'वित्त एवं लेखा'],
    ['Customer Management', 'ग्राहक प्रबंधन'], ['Supplier Management', 'आपूर्तिकर्ता प्रबंधन']
  ];
  MODULES.forEach(([enS, hiS]) => eq('◆ module ' + enS, I.t(enS), hiS));

  const NOTIFS = [
    ['Payment received', 'भुगतान प्राप्त हुआ'], ['New order received', 'नया ऑर्डर मिला'],
    ['Goods dispatched', 'माल डिस्पैच हो गया'], ['GST return due date is near', 'GST रिटर्न की अंतिम तिथि निकट है'],
    ['Customer payment is pending', 'ग्राहक का भुगतान लंबित है'], ['Production target met', 'उत्पादन लक्ष्य पूरा हुआ']
  ];
  NOTIFS.forEach(([enS, hiS]) => eq('◆ notification ' + enS, I.t(enS), hiS));
}

/* ══════════ 2. THE FALLBACK IS ENGLISH — never blank, never a key ══════════
   The rule that decides whether a partial retrofit is usable or humiliating. */
{
  hi();
  eq('an UNTRANSLATED phrase renders in English, not blank', I.t('Reconciliation confidence'), 'Reconciliation confidence');
  ok(I.t('Some brand new label') !== '', '  a missing phrase is never an empty string');
  ok(!/^[a-z]+\.[a-z]+$/.test(I.t('Anything')), '  and never a symbolic key like "nav.sales"');
  eq('null does not throw', I.t(null), '');
  eq('undefined does not throw', I.t(undefined), '');
  eq('a number is stringified, not dropped', I.t(0), '0');
  eq('an empty string stays empty', I.t(''), '');

  en();
  eq('in English mode a known phrase is untouched', I.t('Sales'), 'Sales');
  eq('  and so is an unknown one', I.t('Whatever'), 'Whatever');
}

/* ══════════ 3. HINDI + ENGLISH TOGETHER ══════════
   The owner asked for both "where necessary" — GST and E-Way Bill are printed in
   English on the forms he actually handles. */
{
  hi();
  eq('both() pairs Hindi with the English on the real form', I.both('E-Way Bill'), 'ई-वे बिल / E-Way Bill');
  eq('both() does not double up an untranslated phrase', I.both('Reconciliation'), 'Reconciliation');
  en();
  eq('both() is plain English in English mode', I.both('E-Way Bill'), 'E-Way Bill');
}

/* ══════════ 4. THE SWITCH ══════════ */
{
  en(); eq('default is English', I.lang(), 'en');
  hi(); eq('Hindi is remembered', I.lang(), 'hi');
  LS = {}; eq('with nothing stored, English', I.lang(), 'en');
  LS['ql_lang'] = 'xx'; eq('an unknown language falls back to English, not blank', I.lang(), 'en');
}

/* ══════════ 5. THE DICTIONARY IS SANE ══════════ */
{
  const D = I.DICT;
  const keys = Object.keys(D);
  ok(keys.length >= 60, 'the dictionary has real coverage (got ' + keys.length + ' phrases)');
  /* Every value must actually BE Hindi. A key accidentally mapped to English would
     silently render English while claiming to be translated. GST/E-Way keep their
     Latin initialisms on purpose — they are printed that way on the form. */
  const noDeva = keys.filter(k => !/[ऀ-ॿ]/.test(D[k]));
  eq('every translation actually contains Devanagari', noDeva, []);
  /* A translation identical to its key is a no-op that looks done. */
  const same = keys.filter(k => D[k] === k);
  eq('no phrase "translates" to itself', same, []);
  /* Blank values are the worst case — they would render an empty label. */
  const blank = keys.filter(k => !String(D[k]).trim());
  eq('no phrase translates to blank', blank, []);
}

/* ══════════ 6. NO GLOBAL `t` ══════════
   `t` is the most common local name in this codebase (txn, toast, tab, timer). A
   global would be one undeclared assignment away from silently clobbering the
   translator, with a failure nobody could trace. */
{
  ok(typeof globalThis.t === 'undefined', 'i18n does NOT define a global `t` — pages alias it locally');
  ok(typeof I.t === 'function', '  the translator is reached through QLI18n.t');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
