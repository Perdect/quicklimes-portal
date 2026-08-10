/* ═══════════════════════════════════════════════════════════════════════
   party-resolve.js — the PARTY RESOLUTION ENGINE.  Pure. Node-testable.

   One question: given what the OCR thinks it read, WHO is this party really?

   The answer is never "whatever the OCR typed". It is the canonical party,
   found by the strongest identifier available, with the evidence recorded
   and a confidence that decides whether a human needs to look.

   ── THE LADDER, strongest first ──────────────────────────────────────
     gstin_exact      0.99  a GSTIN is a government-issued identity; it
                            cannot be misspelled into someone else's
     pan_exact        0.88  GSTIN chars 3-12 ARE the PAN, so two GSTINs
                            sharing a PAN are the same legal entity in
                            different states
     name_exact       0.90  normalised legal name already in the master
     history          0.85  this exact name has been booked before
     fuzzy_name       0.72  same name after light normalisation only
     none             0.00  nothing matched
   A GSTIN match OUTRANKS every name signal. That is the whole point: on
   the 8 bad rows the GSTIN was right on every single one while the name
   was the seller's own letterhead tagline.

   ── THE POISON-LOOP RULE ─────────────────────────────────────────────
   The party master is NOT automatically trustworthy. A bad OCR read gets
   written in by upsertParty and is then fed BACK to the parser as a
   0.99-confidence canonical name — which is exactly how "MANUFACTURES OF
   QUICK LIME AND HYDRATED LIME" became a customer in two books. So every
   master entry is screened before it is allowed to act as canonical, and
   a suspect one resolves to REVIEW rather than laundering itself.

   ── THE CREATION RULE ────────────────────────────────────────────────
   Below the review floor nothing is auto-created. A blank the owner fills
   in is recoverable; a confident wrong name silently becomes a customer.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var P = (typeof module !== 'undefined' && module.exports) ? require('./party-identity.js')
        : (root.QLParty || null);

  /* ── confidence bands ────────────────────────────────────────────────
     Calibrated against the real failure, not copied from a template. The
     decisive lesson from this bug: the OCR was CONFIDENT AND WRONG (0.55
     name confidence still sailed through as "ready"), so a name score can
     never authorise a party on its own. Only a cross-check against an
     identifier reaches the auto band. */
  var BANDS = [
    { min: 0.95, band: 'auto',            action: 'accept',        review: false },
    { min: 0.85, band: 'accept-evidence', action: 'accept',        review: false },
    { min: 0.70, band: 'review-suggested', action: 'accept-flag',  review: true },
    { min: 0.00, band: 'review-required',  action: 'hold',         review: true }
  ];
  function bandOf(c) { for (var i = 0; i < BANDS.length; i++) if (c >= BANDS[i].min) return BANDS[i]; return BANDS[BANDS.length - 1]; }

  var normGstin = function (g) { return P && P.normGstin ? P.normGstin(g) : String(g == null ? '' : g).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  var normName = function (n) { return P && P.normName ? P.normName(n) : String(n == null ? '' : n).toUpperCase().replace(/\s+/g, ' ').replace(/[.]/g, '').trim(); };
  var panOf = function (g) { var n = normGstin(g); return n.length === 15 ? n.slice(2, 12) : ''; };

  /* ── is this string even a party name? ───────────────────────────────
     The same grammar the parser now uses, restated here because this module
     must be able to screen the EXISTING master without importing bill-ocr.
     A trade-role word followed by of|in|for is a description of a trade,
     not the name of a business — unless a legal form ends the line, which
     makes it a registered name. */
  var TRADE = 'manufacturers?|manufactures|manufacturing|mfrs?|mfg|makers?|producers?|processors?|dealers?|traders?|suppliers?|stockists?|exporters?|importers?|distributors?|wholesalers?|retailers?|fabricators?|converters?|crushers?';
  var STRAP = new RegExp('^(?:' + TRADE + ')(?:\\s*(?:,|&|and)\\s*(?:' + TRADE + '))*\\.?\\s+(?:of|in|for)\\b', 'i');
  var LEGAL = /\b(?:ltd|limited|pvt|private|llp|inc|corp|corporation|company|co)\.?$/i;
  var NOT_A_NAME = [
    [STRAP, 'trade strapline'],
    [/^(?:an\s+)?iso\s*[\d:]/i, 'ISO certification line'],
    [/^(?:tax|gst|proforma|retail)?\s*invoice\b/i, 'document title'],
    [/^(?:original|duplicate|triplicate|office|customer|transport(?:er)?)\s+(?:copy|for)\b/i, 'copy marker'],
    [/^(?:e-?mail|www\.|http)/i, 'web/email line'],
    [/^(?:for|the|to|from|we|being|subject|terms|declaration|authoris|authoriz)\b/i, 'footer fragment'],
    [/\d{6}/, 'contains a pincode'],
    [/^\d/, 'starts with a number']
  ];
  function suspect(name) {
    var s = String(name == null ? '' : name).trim();
    if (!s) return 'blank';
    if (s.length < 3) return 'too short';
    if (STRAP.test(s) && LEGAL.test(s)) return null;          // registered name, not a boast
    for (var i = 0; i < NOT_A_NAME.length; i++) if (NOT_A_NAME[i][0].test(s)) return NOT_A_NAME[i][1];
    return null;
  }

  /* ── the index the ladder walks ──────────────────────────────────────
     Built from the party master PLUS the transaction history, because a
     counterparty seen on 30 bills is a known party whether or not anyone
     ever opened the Parties screen. Suspect names are indexed but marked,
     so they can be FOUND (to repair them) and never SERVED as canonical. */
  function buildIndex(sources) {
    var byG = {}, byPan = {}, byName = {}, all = [];
    (sources || []).forEach(function (src) {
      (src.parties || []).forEach(function (p, i) {
        add({ id: p.id || (src.company + ':party:' + i), name: p.name, gstin: p.gstin,
              company: src.company, from: 'party-master', seen: 0 });
      });
      (src.rows || []).forEach(function (r) {
        add({ id: null, name: r.name, gstin: r.gstin, company: src.company, from: 'history', seen: 1 });
      });
    });
    function add(e) {
      if (!e.name && !e.gstin) return;
      e.bad = suspect(e.name);
      e.nkey = normName(e.name); e.gkey = normGstin(e.gstin); e.pan = panOf(e.gstin);
      all.push(e);
      if (e.gkey) (byG[e.gkey] = byG[e.gkey] || []).push(e);
      if (e.pan) (byPan[e.pan] = byPan[e.pan] || []).push(e);
      if (e.nkey) (byName[e.nkey] = byName[e.nkey] || []).push(e);
    }
    /* The canonical name for a key is the most-seen CLEAN name. A suspect
       name never wins, however many times it was booked — frequency is how
       a poisoned entry would otherwise entrench itself. */
    function pick(list) {
      if (!list || !list.length) return null;
      var clean = list.filter(function (e) { return !e.bad; });
      if (!clean.length) return { entry: list[0], poisoned: true };
      var tally = {}, best = null;
      clean.forEach(function (e) { var k = e.nkey; tally[k] = (tally[k] || 0) + 1 + (e.from === 'party-master' ? 2 : 0) + (e.seen || 0); });
      clean.forEach(function (e) { if (!best || tally[e.nkey] > tally[best.nkey]) best = e; });
      return { entry: best, poisoned: false };
    }
    return { byG: byG, byPan: byPan, byName: byName, all: all, pick: pick,
             stats: { entries: all.length, gstins: Object.keys(byG).length, suspect: all.filter(function (e) { return e.bad; }).length } };
  }

  /* ── resolve ─────────────────────────────────────────────────────────
     cand = { name, gstin }  — what the document appeared to say
     opts = { index, direction, ownGstins }                              */
  function resolve(cand, opts) {
    cand = cand || {}; opts = opts || {};
    var idx = opts.index || buildIndex([]);
    var detected = String(cand.name == null ? '' : cand.name).trim();
    var g = normGstin(cand.gstin);
    var out = {
      detectedName: detected, gstin: cand.gstin || '',
      partyId: null, canonicalName: '', matchMethod: 'none', matchConfidence: 0,
      evidence: [], detectedNameSuspect: suspect(detected)
    };

    /* Our own GSTIN as the counterparty means the direction is wrong — a
       bill cannot be sold to ourselves. Say so rather than resolving it. */
    var own = (opts.ownGstins || []).map(normGstin).filter(Boolean);
    if (g && own.indexOf(g) >= 0) {
      out.matchMethod = 'own_firm'; out.matchConfidence = 0;
      out.evidence.push('the counterparty GSTIN is one of our own firms — the buyer/seller sides are swapped');
      return finish(out);
    }

    if (g) {
      var hitG = idx.pick(idx.byG[g]);
      if (hitG && !hitG.poisoned) {
        out.partyId = hitG.entry.id; out.canonicalName = hitG.entry.name;
        out.matchMethod = 'gstin_exact'; out.matchConfidence = 0.99;
        out.evidence.push('GSTIN ' + g + ' is already booked as "' + hitG.entry.name + '"');
        if (detected && normName(detected) !== normName(hitG.entry.name)) {
          out.evidence.push('the document said "' + detected + '" — the GSTIN wins, the printed name is kept as evidence');
        }
        return finish(out);
      }
      if (hitG && hitG.poisoned) {
        /* The only name we hold against this GSTIN is itself junk. This is
           the poison loop: serving it would launder a bad OCR read into a
           canonical fact. Refuse, and say what is wrong. */
        out.matchMethod = 'gstin_poisoned'; out.matchConfidence = 0.40;
        out.gstinKnown = true; out.poisonedName = hitG.entry.name;
        out.evidence.push('GSTIN ' + g + ' is known, but the only name stored for it ("' + hitG.entry.name + '") is a ' + hitG.entry.bad + ' — needs a real name before it can be used');
        return finish(out);
      }
      var hitP = idx.pick(idx.byPan[panOf(g)]);
      if (hitP && !hitP.poisoned && panOf(g)) {
        out.partyId = hitP.entry.id; out.canonicalName = hitP.entry.name;
        out.matchMethod = 'pan_exact'; out.matchConfidence = 0.88;
        out.evidence.push('same PAN ' + panOf(g) + ' as "' + hitP.entry.name + '" (a second state registration of the same legal entity)');
        return finish(out);
      }
    }

    /* Name signals only run when the identifier gave us nothing — and a
       detected name that is itself junk never gets to match anything. */
    if (detected && !out.detectedNameSuspect) {
      var hitN = idx.pick(idx.byName[normName(detected)]);
      if (hitN && !hitN.poisoned) {
        out.partyId = hitN.entry.id; out.canonicalName = hitN.entry.name;
        out.matchMethod = hitN.entry.from === 'party-master' ? 'name_exact' : 'history';
        out.matchConfidence = hitN.entry.from === 'party-master' ? 0.90 : 0.85;
        out.evidence.push('name matches "' + hitN.entry.name + '" already in the ' + (hitN.entry.from === 'party-master' ? 'party master' : 'transaction history'));
        if (!g) out.evidence.push('no GSTIN on this document, so the name is the only identifier');
        return finish(out);
      }
      out.matchMethod = 'new_party'; out.matchConfidence = g ? 0.80 : 0.62;
      out.canonicalName = detected;
      out.evidence.push(g ? 'a name and a GSTIN we have not seen before — looks like a genuinely new party'
                          : 'a name we have not seen before, and no GSTIN to confirm it');
      return finish(out);
    }

    if (out.detectedNameSuspect) {
      out.matchMethod = 'name_rejected'; out.matchConfidence = g ? 0.35 : 0.10;
      out.evidence.push('the printed name is a ' + out.detectedNameSuspect + ', not a party');
      if (g) out.evidence.push('GSTIN ' + g + ' was read but is not on file — the party can be created once its real name is known');
      return finish(out);
    }
    out.evidence.push('no usable name and no GSTIN on the document');
    return finish(out);
  }

  function finish(o) {
    var b = bandOf(o.matchConfidence);
    o.band = b.band; o.action = b.action; o.needsReview = b.review;
    /* Auto-creating a party is a stronger act than accepting one, so it has
       its own floor: nothing below the accept-evidence band may mint a new
       canonical party. This is the rule that stops an OCR slip becoming a
       permanent customer. */
    o.mayCreateParty = (o.matchMethod === 'new_party') && o.matchConfidence >= 0.85;
    if (o.matchMethod === 'new_party' && !o.mayCreateParty) {
      o.evidence.push('not confident enough to create a party on its own — held for confirmation');
    }
    return o;
  }

  var api = { resolve: resolve, buildIndex: buildIndex, suspect: suspect, bandOf: bandOf,
              BANDS: BANDS, _internals: { normGstin: normGstin, normName: normName, panOf: panOf } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLPartyResolve = api;
})(typeof window !== 'undefined' ? window : globalThis);
