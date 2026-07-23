/* ═══════════════════════════════════════════════════════════════════════════
   lead-parse.js — the "smart search" brain for Lead Discovery.

   Turns a plain sentence — "Find AAC block manufacturers within 100km of
   Jodhpur" — into the structured filters the search actually runs on:
   { what, industry, businessType, place, radiusKm }.

   HONEST FRAMING: this is a deterministic phrase parser, not a language model.
   It is called an "AI search" in the UI because that is what the pattern is to
   the user (type a sentence, get structured intent), but it invents nothing and
   calls nothing — it runs offline, for free, and always the same way. That
   matters here: the whole module is pure and unit-tested, so what the search bar
   understood can be pinned exactly.

   It leans on ICPCore.INDUSTRIES for the industry vocabulary rather than keeping
   a second list, so a recognised industry maps straight to a real fit score
   (icp-core.js owns those keys). The caller injects that list, keeping this
   module free of globals and testable in node.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* Words that only announce a search — dropped before anything else. */
  var LEAD_RE = /^\s*(find|search( for)?|get|show( me)?|list|discover|look( for)?|give me|need|want)\b[\s:,-]*/i;

  /* Business type: metadata the user sees as a chip. Kept OUT of the OSM search
     term on purpose — few businesses carry "manufacturer" in their map name, so
     folding it into the name-regex would shrink real results. Order matters:
     the more specific pattern must win (a "distributor" is not a "trader"). */
  var BIZ = [
    ['manufacturer', /manufactur\w*|\bmakers?\b|\bmfg\b|\bmfrs?\b|producers?/i],
    ['factory',      /factor(?:y|ies)|\bplants?\b|\bunits?\b/i],
    ['distributor',  /distributors?|distribution/i],
    ['wholesaler',   /wholesalers?|wholesale/i],
    ['exporter',     /exporters?|\bexport\b/i],
    ['importer',     /importers?|\bimport\b/i],
    ['supplier',     /suppliers?|supply/i],
    ['dealer',       /dealers?|dealership/i],
    ['trader',       /traders?|trading/i]
  ];

  /* A short OSM-friendly search term per ICP industry key. The name-regex sent
     to Overpass wants the tight trade word, not the pretty label ("AAC", not
     "AAC Blocks"). Keys must exist in ICPCore.INDUSTRIES. */
  var OSM_TERM = {
    aac: 'AAC', sugar: 'sugar mill', paper: 'paper mill', steel: 'steel',
    foundry: 'foundry', water: 'water treatment', glass: 'glass',
    cement: 'cement', chemical: 'chemical', mining: 'mining',
    construction: 'builder', export: 'export', trader: 'traders'
  };

  /* Prepositions that introduce the place. "of" is included only for the
     "within N km OF <place>" shape, handled before the generic pass. */
  var PLACE_RE = /\b(?:in|at|near|around|within|across|for)\s+([a-z][a-z .&'-]*[a-z])\s*$/i;
  var RADIUS_OF_RE = /\bwithin\s+(\d{1,4})\s*k(?:m|ms|ilomet(?:er|re)s?)?\b(?:\s+(?:of|from|around|near))?\s*/i;
  var RADIUS_BARE_RE = /\b(\d{1,4})\s*k(?:m|ms|ilomet(?:er|re)s?)?\b(?:\s+radius)?/i;

  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function titleish(s) {
    s = clean(s);
    return s.replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); });
  }

  /* parse(text, industries) -> { what, industry, businessType, place, radiusKm, raw }
       industries : ICPCore.INDUSTRIES ([{ key, label, re }, …]); may be omitted,
                    in which case no industry is resolved (what still works).     */
  function parse(text, industries) {
    var raw = clean(text);
    var t = ' ' + raw + ' ';
    var out = { what: '', industry: null, businessType: null, place: null, radiusKm: null, raw: raw };
    if (!raw) return out;

    // 1) radius first — it carries the place with it ("within 100km of Jodhpur").
    var m = t.match(RADIUS_OF_RE);
    if (m) {
      out.radiusKm = Math.min(500, Math.max(1, parseInt(m[1], 10)));
      // Whatever follows the radius phrase, to end of string, is the place.
      var after = t.slice(t.indexOf(m[0]) + m[0].length);
      var placeTail = clean(after);
      if (placeTail) { out.place = titleish(placeTail); }
      t = t.slice(0, t.indexOf(m[0])) + ' ';   // strip the radius+place clause
    } else {
      var mb = t.match(RADIUS_BARE_RE);
      if (mb) { out.radiusKm = Math.min(500, Math.max(1, parseInt(mb[1], 10))); t = t.replace(mb[0], ' '); }
    }

    // 2) drop the lead word ("Find …").
    t = ' ' + clean(t).replace(LEAD_RE, '') + ' ';

    // 3) place, if not already taken from the radius clause.
    if (!out.place) {
      var mp = clean(t).match(PLACE_RE);
      if (mp) { out.place = titleish(mp[1]); t = ' ' + clean(t).replace(PLACE_RE, '') + ' '; }
    }

    // 4) business type (first match wins on the specificity-ordered list).
    for (var i = 0; i < BIZ.length; i++) {
      if (BIZ[i][1].test(t)) { out.businessType = BIZ[i][0]; t = t.replace(BIZ[i][1], ' '); break; }
    }

    // 5) industry, via the injected ICP vocabulary — so it maps to a real score.
    var leftover = clean(t);
    if (industries && industries.length) {
      for (var j = 0; j < industries.length; j++) {
        if (industries[j].re && industries[j].re.test(leftover)) {
          out.industry = { key: industries[j].key, label: industries[j].label };
          break;
        }
      }
    }

    // 6) the actual OSM search term: the tight trade word for a known industry,
    //    else whatever trade words are left after place/type/lead were removed.
    if (out.industry && OSM_TERM[out.industry.key]) out.what = OSM_TERM[out.industry.key];
    else out.what = leftover;

    // A parse that found a place/type but no trade word at all still needs SOME
    // "what" (the search requires it); fall back to the raw minus the place.
    if (!out.what) out.what = leftover || raw;
    return out;
  }

  root.LeadParse = { parse: parse, BIZ_TYPES: BIZ.map(function (b) { return b[0]; }), OSM_TERM: OSM_TERM };

  if (typeof module !== 'undefined' && module.exports) module.exports = root.LeadParse;
})(typeof window !== 'undefined' ? window : globalThis);
