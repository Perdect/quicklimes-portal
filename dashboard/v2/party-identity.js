/* ═══════════════════════════════════════════════════════════════════════
   party-identity.js — who counts as ONE party.

   The bug this exists to kill: "RAMKARAN AND SONS" and "Ramkaran and Sons" are
   the same firm (GSTIN 08AIUPB9022D1ZB) and appeared as two rows in Top
   Suppliers, with their spend and their OUTSTANDING split between them. Nine
   different screens grouped parties by whatever string the bill happened to
   carry, so the same firm fragmented differently on every page — and "who do I
   owe the most?" answered with half the truth. A reminder built on it would
   have quoted a partial amount to a real supplier.

   THE RULES, in order. Each one is deliberate:

   1. Same GSTIN → same party. CERTAIN. A GSTIN is the legal identity; the name
      printed above it is decoration and vendors spell it differently on every
      bill.

   2. Different GSTIN → DIFFERENT parties, even when the names match exactly.
      A GSTIN is state-specific: Indian Oil 24AAACI... (Gujarat) and an Indian
      Oil 08... (Rajasthan) are separate registrations with separate payables and
      separate ITC. Merging them by name would corrupt both.

   3. No GSTIN anywhere → group by lightly normalised name (case, spacing,
      stray dots). This merges "Ramkaran and Sons" with "RAMKARAN AND SONS."
      and nothing riskier.

   4. A record with no GSTIN adopts its name-twin's GSTIN ONLY if that name maps
      to exactly ONE GSTIN in the data. Two GSTINs share a name → ambiguous →
      leave them apart. Guessing here would silently move money between two real
      companies.

   WHAT THIS DELIBERATELY DOES NOT DO: it does not strip legal suffixes.
   crm-core's normName() turns "Shree Cement Ltd" and "Shree Cement Co" both into
   "SHREE CEMENT" — correct for SUGGESTING a merge to a human (it returns
   certain:false for exactly this reason), wrong for silently doing one. Two
   firms with similar names and no GSTIN stay separate here. A visible duplicate
   is a nuisance; a wrong merge is a wrong payment.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* A GSTIN is 15 alphanumerics. Compare on those only — bills carry it with
     spaces, dashes and lowercase. */
  function normGstin(g) { return String(g == null ? '' : g).toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  /* LIGHT normalisation only — see the note above about not stripping suffixes.
     Case, whitespace runs, and trailing punctuation. Nothing that could fuse two
     different companies. */
  function normName(n) {
    return String(n == null ? '' : n).toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* Build an index over one dataset. Two passes: learn name→GSTIN first, so a
     bill missing its GSTIN can still join the party its twin identified. */
  function index(rows, nameOf, gstinOf) {
    nameOf = nameOf || function (r) { return r.party || r.sup || ''; };
    gstinOf = gstinOf || function (r) { return r.gstin || ''; };
    rows = rows || [];

    var byName = {};
    rows.forEach(function (r) {
      var n = normName(nameOf(r)), g = normGstin(gstinOf(r));
      if (!n) return;
      byName[n] = byName[n] || {};
      if (g) byName[n][g] = 1;
    });

    function resolve(name, gstin) {
      var g = normGstin(gstin);
      if (g) return g;                                  // rule 1
      var n = normName(name), set = (n && byName[n]) ? Object.keys(byName[n]) : [];
      return set.length === 1 ? set[0] : '';            // rule 4: adopt only when unambiguous
    }

    function keyOf(name, gstin) {
      var g = resolve(name, gstin);
      if (g) return 'G:' + g;
      var n = normName(name);
      return n ? 'N:' + n : 'N:—';                 // rule 3
    }

    /* Which spelling to SHOW. Deterministic: most frequent variant wins, then the
       longest (usually the most complete), then alphabetical so the label never
       flickers between renders on a tie. */
    var variants = {};
    rows.forEach(function (r) {
      var nm = String(nameOf(r) == null ? '' : nameOf(r)).trim();
      if (!nm) return;
      var k = keyOf(nm, gstinOf(r));
      variants[k] = variants[k] || {};
      variants[k][nm] = (variants[k][nm] || 0) + 1;
    });

    function labelOf(k) {
      var v = variants[k];
      if (!v) return '—';
      return Object.keys(v).sort(function (a, b) {
        return (v[b] - v[a]) || (b.length - a.length) || a.localeCompare(b);
      })[0];
    }

    function gstinFor(k) { return k.indexOf('G:') === 0 ? k.slice(2) : ''; }

    return { keyOf: keyOf, labelOf: labelOf, gstinFor: gstinFor, resolve: resolve };
  }

  /* Convenience: group rows into one bucket per real party.
     Returns [{ key, label, gstin, rows }] — callers do their own arithmetic. */
  function group(rows, nameOf, gstinOf) {
    var idx = index(rows, nameOf, gstinOf);
    nameOf = nameOf || function (r) { return r.party || r.sup || ''; };
    gstinOf = gstinOf || function (r) { return r.gstin || ''; };
    var out = {}, order = [];
    (rows || []).forEach(function (r) {
      var k = idx.keyOf(nameOf(r), gstinOf(r));
      if (!out[k]) { out[k] = { key: k, label: idx.labelOf(k), gstin: idx.gstinFor(k), rows: [] }; order.push(k); }
      out[k].rows.push(r);
    });
    return order.map(function (k) { return out[k]; });
  }

  var API = { normGstin: normGstin, normName: normName, index: index, group: group };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.QLParty = API;
})(typeof window !== 'undefined' ? window : globalThis);
