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

  /* norm() lowercases for MATCHING. Prose that reaches a customer must keep the
     industry's own capitalisation — "ph control" in a message to a chemicals
     buyer reads as sloppy, and it is the sender who looks careless. */
  var KEEP_CASE = ['pH', 'CaO', 'Ca(OH)2', 'GST', 'MT', 'AAC', 'DRI', 'PCC', 'BOD', 'COD', 'FGD', 'India'];
  function prose(s) {
    var t = String(s == null ? '' : s).trim();
    KEEP_CASE.forEach(function (w) {
      t = t.replace(new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), w);
    });
    return t;
  }

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
    var useLine = ind ? (' Lime is essential in the ' + baseLabel(ind.label) + ' process (' + prose(ind.use) + ').') : '';
    var askLine = ind ? (' Could you connect me with your ' + (ind.roles[0] || 'purchase team').toLowerCase() + '?') : '';
    var text = 'Dear ' + who + ',\n\n'
      + 'We are ' + sellerName + ' from ' + sellerCity + ', manufacturers of Quick Lime, Hydrated Lime and Lime Powder.'
      + useLine + '\n\n'
      + 'We supply consistent-quality lime in bulk with reliable dispatch across India. May I share our current grades and landed rates?' + askLine + '\n\n'
      + 'Thank you,\n' + sellerName + sellerPhone;
    // Presence only — the caller validates the phone through wa-core.
    return { text: text, hasPhone: !!lead.phone, hasEmail: !!lead.email, subject: 'Lime supply — ' + sellerName };
  }

  /* ── Outreach Studio composer (pure) ──────────────────────────────────
     compose(lead, seller, industries, {channel,type}) -> { subject, text }
     channel: 'email' | 'whatsapp'   type: 'intro'|'followup'|'proposal'|'meeting'
     Lime-framed for Gotan Lime. Email is formal + has a subject; WhatsApp is
     shorter with tick bullets. Recipient/link is still wa-core's job. */
  function compose(lead, seller, industries, opts) {
    lead = lead || {}; seller = seller || {}; opts = opts || {};
    var wa = opts.channel === 'whatsapp';
    var type = opts.type || 'intro';
    var ind = matchIndustry(lead.industry, industries);
    /* Greet a PERSON when we know one. Addressing a firm by its registered
       name ("Hi Alps Chemicals Pvt. Ltd. 👋") reads like a mail-merge, which
       is exactly what a cold buyer discards. */
    var contact = lead.contact || lead.contactName || '';
    var who = contact || (wa ? 'there' : 'Sir/Madam');
    var sellerName = seller.name || 'Gotan Lime Industries';
    var sellerCity = seller.city || 'Gotan, Rajasthan';
    var sellerPhone = seller.phone || '';
    var sellerAddr = seller.address || '';
    /* A buyer cannot act on a message with no way back. The sign-off carries
       the sender's name, phone and address whenever the company profile holds
       them; anything missing is simply left out rather than faked. */
    var sign = sellerName
      + (sellerPhone ? '\n📞 ' + sellerPhone : '')
      + (sellerAddr ? '\n📍 ' + sellerAddr : (sellerCity ? '\n📍 ' + sellerCity : ''));
    var signPlain = sellerName
      + (sellerPhone ? '\n' + sellerPhone : '')
      + (sellerAddr ? '\n' + sellerAddr : (sellerCity ? '\n' + sellerCity : ''));
    var city = lead.city || 'your site';
    var useLine = ind ? ('Lime is essential in the ' + baseLabel(ind.label) + ' process — ' + prose(ind.use) + '.') : '';
    var role = ind ? (ind.roles[0] || 'purchase team') : 'purchase team';
    var benefits = wa
      ? '✅ Consistent CaO %, tested every batch\n✅ Bulk dispatch across India\n✅ Delivered ₹/MT quoted upfront\n✅ GST-compliant billing'
      : '• Consistent CaO %, tested every batch\n• Reliable bulk dispatch across India\n• A delivered ₹/MT quoted upfront (freight included)\n• GST-compliant billing & documentation';
    var subject = '', text = '';
    if (type === 'followup') {
      subject = 'Following up — lime supply for ' + (lead.name || 'your plant');
      text = wa
        ? 'Hi ' + who + ' 👋 Just following up on my note about lime supply from ' + sellerName + '. Happy to share a delivered ₹/MT to ' + city + ' whenever you have a minute.\n\n— ' + sign
        : 'Dear ' + who + ',\n\nI wanted to gently follow up on my earlier note about supplying lime to ' + (lead.name || 'your plant') + '. We can quote a delivered ₹/MT to ' + city + ' and share our grades at your convenience.\n\nWould later this week suit a quick call?\n\nThank you,\n' + signPlain;
    } else if (type === 'proposal') {
      subject = 'Lime supply proposal — ' + sellerName + ' → ' + (lead.name || 'your plant');
      text = wa
        ? 'Hi ' + who + ' 👋 Here’s what we can offer ' + (lead.name || 'you') + ':\n\n' + benefits + '\n\nShare your monthly tonnage and delivery point and I’ll send an exact delivered ₹/MT + terms.\n\n— ' + sign
        : 'Dear ' + who + ',\n\nThank you for considering ' + sellerName + '. Here is what we propose for ' + (lead.name || 'your plant') + ':\n\n' + benefits + '\n\nShare your indicative monthly tonnage and delivery location and we will send an exact delivered ₹/MT, minimum order, dispatch schedule and payment terms.\n\nWe look forward to supplying you.\n\nThank you,\n' + signPlain;
    } else if (type === 'meeting') {
      subject = 'A quick call about your lime supply — ' + sellerName;
      text = wa
        ? 'Hi ' + who + ' 👋 Could we do a quick 10-min call this week about your lime requirement? I can bring a delivered ₹/MT for ' + city + '.\n\n— ' + sign
        : 'Dear ' + who + ',\n\nCould we schedule a brief call this week to discuss ' + (lead.name || 'your plant') + '’s lime requirement? I will come prepared with a delivered ₹/MT for ' + city + ' and our current grades.\n\nWhat day and time works for you?\n\nThank you,\n' + signPlain;
    } else { // intro
      subject = 'Lime supply for ' + (lead.name || 'your plant') + ' — ' + sellerName;
      text = wa
        ? 'Hi ' + who + ' 👋 I’m from ' + sellerName + ' — we manufacture Quick Lime, Hydrated Lime & Limestone in ' + sellerCity + '.' + (useLine ? '\n\n' + useLine : '') + '\n\n' + benefits + '\n\nCan I share our grades and a delivered ₹/MT to ' + city + '?\n\n— ' + sign
        : 'Dear ' + who + ',\n\nWe are ' + sellerName + ' from ' + sellerCity + ', manufacturers of Quick Lime, Hydrated Lime and Limestone.' + (useLine ? ' ' + useLine : '') + '\n\nWe supply consistent-quality lime in bulk with reliable dispatch across India:\n\n' + benefits + '\n\nMay I share our current grades and a delivered ₹/MT to ' + city + '? Could you connect me with your ' + role.toLowerCase() + '?\n\nThank you,\n' + signPlain;
    }
    return { subject: subject, text: text };
  }

  /* refine(text, kind, lead) — local, deterministic transforms so the refiner
     chips work even without a live LLM (Claude replaces these when a key is set). */
  function refine(text, kind, lead) {
    text = String(text || ''); lead = lead || {};
    if (kind === 'shorten') {
      var paras = text.split(/\n\n+/).filter(Boolean);
      if (paras.length <= 3) return text;
      // keep the opener, the call-to-action (2nd-last), and the sign-off — drop the middle.
      return [paras[0], paras[paras.length - 2], paras[paras.length - 1]].join('\n\n');
    }
    if (kind === 'professional') {
      return text
        .replace(/\bHi\b/g, 'Dear').replace(/\bCan I\b/g, 'May I').replace(/\bwe help\b/gi, 'we supply')
        .replace(/[\u{1F300}-\u{1FAFF}✅✔️☀-➿]/gu, '').replace(/[ \t]{2,}/g, ' ').replace(/ \n/g, '\n').trim();
    }
    if (kind === 'personalize') {
      var tag = [lead.name, lead.industry, lead.city].filter(Boolean).join(', ');
      if (!tag) return text;
      var lead1 = 'I looked up ' + (lead.name || 'your firm') + (lead.city ? ' in ' + lead.city : '') + (lead.industry ? ' — a ' + String(lead.industry).toLowerCase() + ' operation' : '') + ', which is exactly who we supply.';
      if (text.indexOf(lead1) >= 0) return text;
      var lines = text.split('\n');
      lines.splice(text.indexOf('Dear') === 0 || text.indexOf('Hi') === 0 ? 2 : 0, 0, lead1, '');
      return lines.join('\n');
    }
    if (kind === 'improve') {
      var add = '\n\nWe are already trusted by plants across the region for on-time, spec-consistent lime — and there is no cost to get a delivered quote.';
      if (text.indexOf('trusted by plants') >= 0) return text;
      // insert before the sign-off (last paragraph)
      var p = text.split(/\n\n+/);
      if (p.length >= 2) { p.splice(p.length - 1, 0, add.trim()); return p.join('\n\n'); }
      return text + add;
    }
    return text;
  }

  root.LeadActions = { assess: assess, draft: draft, compose: compose, refine: refine, matchIndustry: matchIndustry };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LeadActions;
})(typeof window !== 'undefined' ? window : globalThis);
