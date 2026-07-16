/* ═══════════════════════════════════════════════════════════════════════
   i18n.js — Hindi as a first-class language.

   The app had ZERO Hindi and no translation layer. (The one Devanagari string
   in the codebase was a PER-CUSTOMER "preferred language" on the party form,
   for WhatsApp reminders — and nothing reads that either.) This is the layer.

   KEYED BY THE ENGLISH STRING, deliberately — t('Sales'), not t('nav.sales').
   With 34 pages and 450+ hardcoded strings to retrofit, a symbolic key means a
   missed translation renders "nav.sales" to a factory owner. A natural key means
   the worst case is READABLE ENGLISH. Falling back to English is a small failure;
   falling back to a key, or to blank, is the app lying about what it is.

       t('Sales')            → 'बिक्री'      (hi)  ·  'Sales'  (en)
       t('Not a phrase yet') → 'Not a phrase yet'  in BOTH — never '' and never a key.

   THE GLOSSARY IS THE OWNER'S, NOT MINE. Every term below came from Sameer, who
   runs the lime plant and knows what his purchase manager actually says. Where he
   gave a word, it is used verbatim. I have not "improved" any of them — a
   translator's better Hindi that his operators do not use is worse Hindi.

   NUMBERS AND MONEY ARE NOT TRANSLATED. ₹12,45,000 is already rendered with the
   en-IN locale, which is the Indian grouping (lakh/crore) in both languages. Money
   formatting stays in data.js (fC) — a second opinion about ₹ here is how the same
   figure ends up formatted two ways on one screen.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var LANG_KEY = 'ql_lang';

  /* ── The dictionary ────────────────────────────────────────────
     Owner-supplied terms are marked ◆. Anything unmarked is mine and should be
     checked by a native business speaker before it is trusted. */
  var HI = {
    /* ◆ the owner's glossary, verbatim */
    'Sales': 'बिक्री',
    'Purchase': 'खरीद',
    'Inventory': 'स्टॉक',
    'Customer': 'ग्राहक',
    'Customers': 'ग्राहक',
    'Supplier': 'आपूर्तिकर्ता',
    'Suppliers': 'आपूर्तिकर्ता',
    'Outstanding': 'बकाया राशि',
    'Payment Received': 'भुगतान प्राप्त',
    'Payment Due': 'भुगतान लंबित',
    'Dispatch': 'माल रवाना',
    'Production': 'उत्पादन',
    'Profit': 'लाभ',
    'Loss': 'हानि',
    'GST Summary': 'GST सारांश',
    'E-Way Bill': 'ई-वे बिल',
    'Ledger': 'खाता बही',
    'Bank Reconciliation': 'बैंक मिलान',
    'Manufacturing Cost': 'उत्पादन लागत',
    'Quick Lime Production': 'क्विक लाइम उत्पादन',
    'Hydrated Lime Production': 'हाइड्रेटेड लाइम उत्पादन',

    /* ◆ module names, the owner's list */
    'Purchase Management': 'खरीद प्रबंधन',
    'Sales Management': 'बिक्री प्रबंधन',
    'Production Management': 'उत्पादन प्रबंधन',
    'Stock Management': 'स्टॉक प्रबंधन',
    'Transport Management': 'परिवहन प्रबंधन',
    'Finance & Accounts': 'वित्त एवं लेखा',
    'Customer Management': 'ग्राहक प्रबंधन',
    'Supplier Management': 'आपूर्तिकर्ता प्रबंधन',

    /* ◆ notifications, the owner's phrasing */
    'Payment received': 'भुगतान प्राप्त हुआ',
    'New order received': 'नया ऑर्डर मिला',
    'Goods dispatched': 'माल डिस्पैच हो गया',
    'GST return due date is near': 'GST रिटर्न की अंतिम तिथि निकट है',
    'Customer payment is pending': 'ग्राहक का भुगतान लंबित है',
    'Production target met': 'उत्पादन लक्ष्य पूरा हुआ',

    /* the registers — the two pilot pages */
    'Sales Register': 'बिक्री रजिस्टर',
    'Purchase Register': 'खरीद रजिस्टर',
    'Invoice': 'बिल',
    'Invoices': 'बिल',
    'Bill': 'बिल',
    'Bills': 'बिल',
    'Date': 'तारीख',
    'Party': 'पार्टी',
    'Amount': 'राशि',
    'Total': 'कुल',
    'Taxable': 'कर योग्य',
    'Status': 'स्थिति',
    'Paid': 'भुगतान हो गया',
    'Pending': 'बाकी',
    'Partial': 'आंशिक',
    'Overdue': 'समय बीत गया',
    'Cancelled': 'रद्द',
    'Vehicle': 'गाड़ी',
    'Quantity': 'मात्रा',
    'Rate': 'भाव',
    'Item': 'सामान',
    'Month': 'महीना',
    'All': 'सभी',
    'Add Bill': 'बिल जोड़ें',
    'New Sale': 'नई बिक्री',
    'Export': 'डाउनलोड',
    'Report': 'रिपोर्ट',
    'Search': 'खोजें',
    'Filters': 'छाँटें',
    'Upload Bills': 'बिल अपलोड करें',
    'Find duplicates': 'दोहरे बिल खोजें',
    'Purchase Item': 'खरीद सामान',
    'Purchase Group': 'खरीद समूह',
    'Payment status': 'भुगतान स्थिति',

    /* materials — the plant's own vocabulary */
    'Limestone': 'चूना पत्थर',
    'Petcoke': 'पेटकोक',
    'Bags': 'बोरी',
    'Quick Lime': 'क्विक लाइम',
    'Freight': 'भाड़ा',
    'Royalty': 'रॉयल्टी'
  };

  /* Read once. The setter reloads, so nothing can hold a stale value. */
  function lang() {
    try { return localStorage.getItem(LANG_KEY) === 'hi' ? 'hi' : 'en'; } catch (_) { return 'en'; }
  }

  /* The whole contract in four lines. An unknown phrase returns ITSELF — never
     '', never a key, never undefined. English is the honest fallback. */
  function t(s) {
    if (s == null) return '';
    if (lang() !== 'hi') return String(s);
    var k = String(s);
    return Object.prototype.hasOwnProperty.call(HI, k) ? HI[k] : k;
  }

  /* Hindi + English together, for terms where the English is what is printed on
     the form the user is holding (GST, E-Way Bill) or where the Hindi alone would
     be ambiguous. Never doubles up when the two are identical. */
  function both(s) {
    var h = t(s);
    return (lang() === 'hi' && h !== String(s)) ? h + ' / ' + s : String(s);
  }

  function setLang(l) {
    l = l === 'hi' ? 'hi' : 'en';
    try { localStorage.setItem(LANG_KEY, l); } catch (_) {}
    /* A full reload, not a repaint: every page renders its strings at build time
       inside template literals, so there is no live binding to update. Reloading is
       honest — a half-translated screen would be worse than either language. */
    try { document.documentElement.setAttribute('lang', l); } catch (_) {}
    if (typeof location !== 'undefined' && location.reload) location.reload();
  }

  /* Coverage, for the tests and for an honest progress number — the count of
     phrases actually translated, not a claim. */
  function stats() { return { phrases: Object.keys(HI).length }; }
  function has(s) { return Object.prototype.hasOwnProperty.call(HI, String(s)); }

  var API = { t: t, both: both, lang: lang, setLang: setLang, stats: stats, has: has, DICT: HI, LANG_KEY: LANG_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.QLI18n = API;
  /* NO global `t`. It was tempting — this is called hundreds of times — but `t` is
     the most common local name in this codebase (txn, toast, tab, timer), and one
     future undeclared `t = ...` anywhere would silently clobber the translator with
     a failure nobody could trace. Pages alias it locally instead:
         const t = QLI18n.t;
     Scoped, explicit, and impossible to collide with. */
})(typeof window !== 'undefined' ? window : globalThis);
