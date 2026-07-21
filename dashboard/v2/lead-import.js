/* ═══════════════════════════════════════════════════════════════════════
   lead-import.js — turn a LIST into a ranked call list.

   You already have lists: exhibition visitors, an IndiaMART export, a bought
   CSV, a distributor's customer sheet. What you do NOT have is an answer to
   "which twenty of these 500 do I call first?" The ICP engine already knows
   what a good lime customer looks like — learned from your own invoices, by
   MARGIN, not turnover. This is the missing pipe between the two.

   Pure: no DOM, no network. Browser (window.LeadImport) + Node
   (module.exports), so the column-guessing and the ranking are unit-tested.

   HARD RULES (each exists because the opposite causes real damage):
     • A ROW WITHOUT A COMPANY NAME IS NOT A LEAD. It is dropped, and counted,
       never imported as "Unknown" to be called by a confused salesman.
     • NEVER INVENT AN INDUSTRY. If the sheet does not say, industry is '' and
       the scorer returns tier 'unknown' — an honest "we have no evidence"
       beats a confident guess that sends a truck to the wrong town. (Same
       discipline as the bill parser: unclear ⇒ flagged, not fabricated.)
     • A BOUGHT LIST IS NOT CONSENT. Every imported row carries
       consent_basis 'purchased', which CRMCore.mayContact already refuses to
       cold-WhatsApp. Importing must never quietly upgrade a lawful basis.
     • ORDER BY MARGIN, NOT SIZE. Ranking is whatever ICPCore.scoreLead says,
       and it caps loss-making industries — a 500 t/mo lead in an industry you
       lose money on must NOT outrank a 40 t/mo lead in one you profit from.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* Columns we try to find. `keys` are matched against the lowercased header
     cell with `includes`, so put the MOST specific first — 'company name'
     before 'name', or a "Contact Name" column steals the company. */
  var FIELDS = [
    /* `avoid`: a bare 'name' column IS usually the company — but only after
       ruling out the person columns. Without this, "Contact Name" (which
       contains "name") is taken as the company and every call goes out
       addressed to a firm that does not exist. */
    { key: 'name',     label: 'Company name', required: true,
      keys: ['company name', 'company', 'firm', 'organisation', 'organization', 'party', 'buyer', 'customer', 'name of', 'name'],
      avoid: ['contact', 'person', 'owner', 'proprietor', 'director', 'concerned', 'first', 'last'] },
    { key: 'industry', label: 'Industry',     keys: ['industry', 'sector', 'segment', 'category', 'business type', 'nature of business'] },
    { key: 'city',     label: 'City',         keys: ['city', 'town', 'district', 'location', 'place'] },
    { key: 'state',    label: 'State',        keys: ['state', 'region', 'province'] },
    { key: 'distance', label: 'Distance (km)',keys: ['distance', 'km', 'kms'] },
    { key: 'tonnes',   label: 'Tonnes / month', keys: ['tonne', 'tonnes', 'tpm', 'ton', 'mt/month', 'qty', 'quantity', 'volume', 'requirement', 'consumption'] },
    { key: 'gstin',    label: 'GSTIN',        keys: ['gstin', 'gst no', 'gst number', 'gst'] },
    { key: 'phone',    label: 'Phone',        keys: ['phone', 'mobile', 'contact no', 'contact number', 'whatsapp', 'tel'] },
    { key: 'person',   label: 'Contact person', keys: ['contact person', 'contact name', 'person', 'owner name', 'proprietor', 'director', 'concerned'] },
    { key: 'supplier', label: 'Currently buys from', keys: ['supplier', 'currently buys', 'current supplier', 'vendor', 'buying from'] },
    { key: 'website',  label: 'Website',      keys: ['website', 'url', 'web'] },
    { key: 'notes',    label: 'Notes',        keys: ['note', 'remark', 'comment', 'description'] }
  ];

  var GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/;

  function txt(v) { return v == null ? '' : String(v).trim(); }

  /* A number out of a messy cell: "1,200 MT", "approx 45", "40-60" → 1200/45/40.
     Returns null when there is no number, never 0 — 0 t/mo and "not stated"
     are different facts and the scorer treats them differently. */
  function num(v) {
    var s = txt(v).replace(/,/g, '');
    var m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    var n = parseFloat(m[0]);
    return isFinite(n) ? n : null;
  }

  /* Header auto-map. Returns { fieldKey: columnIndex } for what it recognised;
     a field it cannot find is simply absent, and the import wizard then asks
     the user to map it by hand rather than guessing. */
  function autoMap(header) {
    var cells = (header || []).map(function (h) { return txt(h).toLowerCase(); });
    var used = {}, map = {};
    FIELDS.forEach(function (f) {
      var avoid = f.avoid || [];
      for (var ki = 0; ki < f.keys.length; ki++) {
        var kw = f.keys[ki];
        for (var i = 0; i < cells.length; i++) {
          if (used[i] || !cells[i]) continue;
          if (cells[i].indexOf(kw) === -1) continue;
          var blocked = false;
          for (var ai = 0; ai < avoid.length; ai++) { if (cells[i].indexOf(avoid[ai]) !== -1) { blocked = true; break; } }
          if (blocked) continue;
          map[f.key] = i; used[i] = 1; return;
        }
      }
    });
    return map;
  }

  /* One sheet row → one lead candidate. `get(key)` returns the mapped cell.
     Returns null for a row with no company name (a blank line, a totals row,
     a stray footer) — the caller counts those, it never imports them. */
  function buildLead(get) {
    var name = txt(get('name'));
    if (!name || name.length < 2) return null;
    // A totals/footer row is not a company.
    if (/^(total|grand total|sub ?total|s\.?no\.?|sr\.?no\.?)$/i.test(name)) return null;

    var gst = txt(get('gstin')).toUpperCase().replace(/\s/g, '');
    if (gst && !GSTIN_RE.test(gst)) gst = '';        // a wrong GSTIN is worse than none

    return {
      name: name,
      industry: txt(get('industry')),                // raw; resolved by resolveIndustry
      city: txt(get('city')),
      state: txt(get('state')),
      distanceKm: num(get('distance')),
      tonnes: num(get('tonnes')),
      gstin: gst,
      phone: txt(get('phone')),
      person: txt(get('person')),
      supplier: txt(get('supplier')),
      website: txt(get('website')),
      notes: txt(get('notes'))
    };
  }

  /* Map the sheet's free-text industry onto an ICP industry key.
     `icpIndustries` is ICPCore.INDUSTRIES ([{key,label}]). An unrecognised or
     empty value yields '' — deliberately NOT a guess (see HARD RULES). */
  function resolveIndustry(raw, icpIndustries) {
    var s = txt(raw).toLowerCase();
    if (!s) return '';
    var list = icpIndustries || [];
    for (var i = 0; i < list.length; i++) {
      var k = String(list[i].key || '').toLowerCase();
      var l = String(list[i].label || '').toLowerCase();
      if (k && (s === k || s.indexOf(k) !== -1)) return list[i].key;
      if (l && (s === l || s.indexOf(l) !== -1)) return list[i].key;
    }
    return '';
  }

  /* Rank candidates by what they are actually worth to YOU.
     score(cand, icp) is injected (ICPCore.scoreLead) so this file stays pure
     and the ranking is testable without the whole ICP engine.
     Sort: score desc, then bigger tonnage, then nearer — a stable, explainable
     order. Rows the scorer knows nothing about ('unknown') sink below scored
     ones rather than being dropped: no evidence is not the same as bad. */
  var TIER_RANK = { high: 3, medium: 2, low: 1, unknown: 0 };
  function rank(cands, icp, score) {
    var out = (cands || []).map(function (c) {
      var s = { score: 0, tier: 'unknown', why: [] };
      if (typeof score === 'function') {
        try {
          s = score({ industry: c.industry, estTonnesPerMonth: c.tonnes, distanceKm: c.distanceKm }, icp) || s;
        } catch (e) { s = { score: 0, tier: 'unknown', why: ['Could not score this row'] }; }
      }
      return {
        lead: c,
        score: +s.score || 0,
        tier: s.tier || 'unknown',
        why: s.why || []
      };
    });
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      var tr = (TIER_RANK[b.tier] || 0) - (TIER_RANK[a.tier] || 0);
      if (tr) return tr;
      var bt = b.lead.tonnes == null ? -1 : b.lead.tonnes, at = a.lead.tonnes == null ? -1 : a.lead.tonnes;
      if (bt !== at) return bt - at;
      var ad = a.lead.distanceKm == null ? Infinity : a.lead.distanceKm;
      var bd = b.lead.distanceKm == null ? Infinity : b.lead.distanceKm;
      if (ad !== bd) return ad - bd;
      return String(a.lead.name).localeCompare(String(b.lead.name));
    });
    return out;
  }

  /* Dedupe key for the import wizard's "already added" check. GSTIN is the
     only true identity; otherwise a normalised name (same rule as
     CRMCore.dupeOf, so the two agree about what "the same company" means). */
  function normName(s) {
    return String(s == null ? '' : s).toUpperCase()
      .replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|INC|CO|COMPANY|THE|M\/S|AND|&)\b/g, ' ')
      .replace(/[^A-Z0-9]+/g, ' ').trim();
  }
  function keyOf(lead) {
    if (!lead) return '';
    var g = String(lead.gstin || '').toUpperCase().replace(/\s/g, '');
    if (g) return 'G:' + g;
    var n = normName(lead.name);
    return n ? 'N:' + n : '';
  }

  /* The record we hand to crm.php upsertCompany. A COMPANY carries no consent
     basis — consent under the DPDP Act belongs to a PERSON, and crm_companies
     has no such column. `source` records how the list was obtained. */
  function toCompany(lead, industryKey, source) {
    return {
      name: lead.name,
      industry: industryKey || '',
      gstin: lead.gstin || '',
      website: lead.website || '',
      state: lead.state || '',
      city: lead.city || '',
      distance_km: lead.distanceKm,
      est_tpm: lead.tonnes,
      current_supplier: lead.supplier || '',
      source: source || 'apollo',
      notes: lead.notes || ''
    };
  }

  /* The contact row — THIS is where the lawful basis lives and is stored.
     Pinned to 'purchased': a bought or scraped number is legitimate to HOLD
     and to phone, but CRMCore.mayContact must keep refusing cold WhatsApp.
     Importing must never quietly upgrade a basis (see HARD RULES).
     Returns null when the sheet had no person and no number — an empty
     contact row is noise that makes the consent ledger meaningless. */
  function toContact(lead, crmCompanyId) {
    if (!lead) return null;
    var phone = String(lead.phone || '').trim();
    var person = String(lead.person || '').trim();
    if (!phone && !person) return null;
    return {
      crm_company: crmCompanyId,
      name: person || lead.name,
      phone: phone,
      consent_basis: 'purchased'
    };
  }

  var api = {
    FIELDS: FIELDS, autoMap: autoMap, buildLead: buildLead, resolveIndustry: resolveIndustry,
    rank: rank, keyOf: keyOf, normName: normName, toCompany: toCompany, toContact: toContact, num: num
  };
  if (typeof window !== 'undefined') window.LeadImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
