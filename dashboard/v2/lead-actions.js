/* ═══════════════════════════════════════════════════════════════════════════
   lead-actions.js — the "work this lead" layer: Assess + Message.

   Ported in spirit from the user's other project (per-candidate Assess / Message
   with an AI-fallback), but done for a LIME seller: both run on local rules that
   reuse the Market Intelligence playbook (what lime does for the buyer's
   industry, who to ask for), so they work with NO API key and NO network. When
   the owner later sets an Anthropic key, live Claude can replace assess()/draft()
   text — the UI already calls these as the "fallback".

   Pure: no DOM, no network. Testable, and never fabricates a contact it wasn't
   given (a lead with no phone/email is told so, not handed a fake number).
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function norm(s) { return String(s == null ? '' : s).toLowerCase().trim(); }

  /* Map a lead's free-text industry ("Steel", "Chemicals", "sugar mill") to a
     Market Intelligence industry, so the playbook applies. Null if unknown. */
  function matchIndustry(industryStr, industries) {
    var q = norm(industryStr);
    if (!q || !industries || !industries.length) return null;
    for (var i = 0; i < industries.length; i++) {
      var ind = industries[i], key = norm(ind.key), lbl = norm(ind.label), head = lbl.split(' ')[0];
      if (q.indexOf(key) >= 0 || key.indexOf(q) >= 0 || lbl.indexOf(q) >= 0 || (head && q.indexOf(head) >= 0)) return ind;
    }
    return null;
  }

  /* A quick briefing: does this lead fit, what does lime do for them, who to ask
     for, and how to approach. `fit` is the ICP score object already computed. */
  function assess(lead, industries, fit) {
    lead = lead || {};
    var ind = matchIndustry(lead.industry, industries);
    var contact = [];
    if (lead.phone) contact.push('phone'); if (lead.email) contact.push('email'); if (lead.website) contact.push('website');
    var points = [];
    if (fit && typeof fit.score === 'number' && fit.tier !== 'unknown') {
      points.push({ k: 'Fit', v: Math.round(fit.score) + '/100' + (fit.why && fit.why.length ? ' — ' + fit.why.join('; ') : '') });
    }
    if (ind) {
      points.push({ k: 'Lime is used for', v: ind.use });
      points.push({ k: 'Typical consumption', v: ind.consumption });
      points.push({ k: 'Buying pattern', v: ind.frequency });
      points.push({ k: 'Ask for', v: ind.roles.join(', ') });
    } else {
      points.push({ k: 'Industry', v: 'Not identified from the listing — confirm what they make before pitching.' });
    }
    points.push({ k: 'Contact on file', v: contact.length ? contact.join(', ') : 'none — you may need to find a number first' });
    var approach = ind
      ? 'Lead with how lime fits their ' + baseLabel(ind.label) + ' process, ask for the ' + (ind.roles[0] || 'purchase manager') + ', and offer a trial supply at a landed price.'
      : 'Confirm their process first; if they consume lime, offer a sample and a landed-price quote.';
    return { industry: ind ? ind.label : (lead.industry || 'Unknown'), matched: !!ind, points: points, approach: approach };
  }

  function baseLabel(label) {
    return String(label || '').toLowerCase().replace(/ (plants|mills|manufacturers|industries|companies|refineries|smelters|units)$/, '');
  }

  /* Draft the outreach TEXT only. It does NOT build a wa.me link or a mailto —
     who-gets-the-message is wa-core's job (WA.waLink / WA.normalizePhone owns
     Indian mobile rules: strips the STD 0, refuses landlines), enforced by
     waphone.test.js. The caller pairs this text with the lead's phone/email. */
  function draft(lead, seller, industries) {
    lead = lead || {}; seller = seller || {};
    var ind = matchIndustry(lead.industry, industries);
    var who = lead.name || 'Sir/Madam';
    var sellerName = seller.name || 'Gotan Lime Industries';
    var sellerCity = seller.city || 'Gotan, Rajasthan';
    var sellerPhone = seller.phone ? ('\n' + seller.phone) : '';
    var useLine = ind ? (' Lime is essential in the ' + baseLabel(ind.label) + ' process (' + norm(ind.use) + ').') : '';
    var askLine = ind ? (' Could you connect me with your ' + (ind.roles[0] || 'purchase team').toLowerCase() + '?') : '';
    var text = 'Dear ' + who + ',\n\n'
      + 'We are ' + sellerName + ' from ' + sellerCity + ', manufacturers of Quick Lime, Hydrated Lime and Lime Powder.'
      + useLine + '\n\n'
      + 'We supply consistent-quality lime in bulk with reliable dispatch across India. May I share our current grades and landed rates?' + askLine + '\n\n'
      + 'Thank you,\n' + sellerName + sellerPhone;
    // Presence only — the caller validates the phone through wa-core.
    return { text: text, hasPhone: !!lead.phone, hasEmail: !!lead.email, subject: 'Lime supply — ' + sellerName };
  }

  root.LeadActions = { assess: assess, draft: draft, matchIndustry: matchIndustry };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LeadActions;
})(typeof window !== 'undefined' ? window : globalThis);
