/* ═══════════════════════════════════════════════════════════════════════
   intercompany.js — classify a transaction as EXTERNAL or INTER_COMPANY,
   pair the two sides, and produce the elimination figures.  Pure.

   THE ACCOUNTING RULE THIS ENFORCES
     Company view  — an internal sale stays visible in Gotan's book, and the
                     matching purchase stays visible in Deshwali's. Nothing
                     is deleted, hidden or re-valued.
     Group view    — External = Gross − Inter-company, on BOTH sides, so one
                     lorry of lime moving between our own yards stops
                     counting as revenue AND as cost.

   WHY GSTIN AND NOT NAMES
     "DESHWALI LIME INDUSTRIES" is a real external customer. "DESHWALI
     MINERALS" is the owner's own firm. Any suffix-stripping normaliser
     collapses those two into one and would silently eliminate a paying
     customer's invoices as if they were internal transfers — booking real
     revenue as an intra-group wash. So a firm is identified by its GSTIN,
     which cannot be misspelled into someone else's. A name-only hit is
     never eliminated; it is reported as `suspect` for a human to confirm.

   ONE-SIDED TRANSFERS ARE NOT NETTED
     An internal sale with no matching purchase in the sibling's book is a
     bookkeeping gap, not external revenue. It is excluded from External
     (it is not external) and listed in `exceptions` with the group result
     marked provisional — the same refusal pattern the stock ledger uses
     when a bill is missing its quantity.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var P = (typeof module !== 'undefined' && module.exports) ? require('./party-identity.js') : (root.QLParty || null);
  var normG = function (g) { return P && P.normGstin ? P.normGstin(g) : String(g == null ? '' : g).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  var normN = function (n) { return P && P.normName ? P.normName(n) : String(n == null ? '' : n).toUpperCase().replace(/\s+/g, ' ').trim(); };
  var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  var live = function (r) { return r && !r._del && !r._arch && (r.status || 'pending') !== 'cancelled'; };
  var taxable = function (s) { return num(s.taxable) || r2(num(s.qty) * num(s.rate)); };

  /* ── the canonical company identity layer ────────────────────────────
     firms = [{ id, name, short, gstins:[], pan }]  — GSTINs are the identity;
     names are carried only so a name-only hit can be REPORTED, never netted. */
  function identity(firms) {
    var byG = {}, byN = {}, list = [];
    (firms || []).forEach(function (f) {
      var gs = (f.gstins || [f.gstin]).map(normG).filter(Boolean);
      var e = { id: f.id, name: f.name || f.short || '', short: f.short || f.name || '', gstins: gs,
                pan: gs.length && gs[0].length === 15 ? gs[0].slice(2, 12) : '' };
      list.push(e);
      gs.forEach(function (g) { byG[g] = e; });
      [e.name, e.short].forEach(function (n) { if (n) byN[normN(n)] = e; });
    });
    return { list: list, byG: byG, byN: byN,
             /* Certain only via GSTIN. A name hit returns `suspect`. */
             of: function (gstin, name) {
               var g = normG(gstin);
               if (g && byG[g]) return { firm: byG[g], certain: true };
               var n = normN(name);
               if (n && byN[n]) return { firm: byN[n], certain: false };
               return null;
             } };
  }

  /* ── classify every row in every book ────────────────────────────────
     books = [{ id, name, sales:[], purchases:[] }] */
  function classify(books, ident) {
    var out = { rows: [], byFirm: {}, totals: {
      gross: { salesValue: 0, salesQty: 0, salesCount: 0, purchaseValue: 0, purchaseCount: 0 },
      inter: { salesValue: 0, salesQty: 0, salesCount: 0, purchaseValue: 0, purchaseCount: 0 },
      external: { salesValue: 0, salesQty: 0, salesCount: 0, purchaseValue: 0, purchaseCount: 0 },
      suspect: { salesValue: 0, salesCount: 0, purchaseValue: 0, purchaseCount: 0 }
    } };
    (books || []).forEach(function (b) {
      var f = out.byFirm[b.id] = { id: b.id, name: b.name, sales: [], purchases: [],
        gross: { salesValue: 0, purchaseValue: 0, salesQty: 0, salesCount: 0, purchaseCount: 0 },
        inter: { salesValue: 0, purchaseValue: 0, salesQty: 0, salesCount: 0, purchaseCount: 0 } };
      (b.sales || []).filter(live).forEach(function (s, i) {
        var v = taxable(s), q = num(s.qty);
        var hit = ident.of(s.gstin, s.party);
        var rel = (hit && hit.firm.id !== b.id) ? (hit.certain ? 'inter' : 'suspect') : 'external';
        var row = { kind: 'sale', firm: b.id, firmName: b.name, idx: i, ref: s.inv || '', date: s.date || '',
                    party: s.party || '', gstin: s.gstin || '', value: v, qty: q, rel: rel,
                    counterFirm: hit ? hit.firm.id : null, counterName: hit ? hit.firm.short : '', certain: !!(hit && hit.certain) };
        out.rows.push(row); f.sales.push(row);
        f.gross.salesValue += v; f.gross.salesQty += q; f.gross.salesCount++;
        out.totals.gross.salesValue += v; out.totals.gross.salesQty += q; out.totals.gross.salesCount++;
        if (rel === 'inter') { f.inter.salesValue += v; f.inter.salesQty += q; f.inter.salesCount++;
          out.totals.inter.salesValue += v; out.totals.inter.salesQty += q; out.totals.inter.salesCount++; }
        else if (rel === 'suspect') { out.totals.suspect.salesValue += v; out.totals.suspect.salesCount++; }
      });
      (b.purchases || []).filter(live).forEach(function (p, i) {
        var v = num(p.taxable);
        var hit = ident.of(p.gstin, p.sup || p.name);
        var rel = (hit && hit.firm.id !== b.id) ? (hit.certain ? 'inter' : 'suspect') : 'external';
        var row = { kind: 'purchase', firm: b.id, firmName: b.name, idx: i, ref: p.bill || '', date: p.date || '',
                    party: p.sup || p.name || '', gstin: p.gstin || '', value: v, qty: num(p.qty), rel: rel,
                    counterFirm: hit ? hit.firm.id : null, counterName: hit ? hit.firm.short : '', certain: !!(hit && hit.certain) };
        out.rows.push(row); f.purchases.push(row);
        f.gross.purchaseValue += v; f.gross.purchaseCount++;
        out.totals.gross.purchaseValue += v; out.totals.gross.purchaseCount++;
        if (rel === 'inter') { f.inter.purchaseValue += v; f.inter.purchaseCount++;
          out.totals.inter.purchaseValue += v; out.totals.inter.purchaseCount++; }
        else if (rel === 'suspect') { out.totals.suspect.purchaseValue += v; out.totals.suspect.purchaseCount++; }
      });
    });
    var T = out.totals;
    ['salesValue', 'salesQty', 'salesCount', 'purchaseValue', 'purchaseCount'].forEach(function (k) {
      T.external[k] = r2((T.gross[k] || 0) - (T.inter[k] || 0));
      T.gross[k] = r2(T.gross[k]); T.inter[k] = r2(T.inter[k]);
    });
    return out;
  }

  /* ── pair the two sides ──────────────────────────────────────────────
     A genuine internal transfer is a SALE in one book and a PURCHASE in the
     other. Pairing proves it. An unmatched leg is reported, never assumed. */
  function pair(cls) {
    var sales = cls.rows.filter(function (r) { return r.kind === 'sale' && r.rel === 'inter'; });
    var purch = cls.rows.filter(function (r) { return r.kind === 'purchase' && r.rel === 'inter'; });
    var used = {}, pairs = [], exceptions = [];
    sales.forEach(function (s) {
      var best = null, bestScore = -1;
      purch.forEach(function (p, pi) {
        if (used[pi]) return;
        if (p.firm !== s.counterFirm || s.firm !== p.counterFirm) return;   // must be the mirror direction
        var score = 0;
        if (s.ref && p.ref && normN(s.ref) === normN(p.ref)) score += 5;
        if (s.date && p.date && s.date === p.date) score += 2;
        if (Math.abs(s.value - p.value) < 1) score += 4;
        else if (s.value && Math.abs(s.value - p.value) / s.value < 0.02) score += 2;
        if (s.qty && p.qty && Math.abs(s.qty - p.qty) < 0.01) score += 2;
        if (score > bestScore) { bestScore = score; best = { p: p, pi: pi, score: score }; }
      });
      if (best && best.score >= 4) {
        used[best.pi] = 1;
        var delta = r2(s.value - best.p.value);
        pairs.push({ sale: s, purchase: best.p, score: best.score, delta: delta,
                     status: Math.abs(delta) < 1 ? 'matched' : 'partial' });
        if (Math.abs(delta) >= 1) exceptions.push({ type: 'amount-mismatch', sale: s, purchase: best.p, delta: delta });
      } else {
        exceptions.push({ type: 'sale-without-purchase', sale: s,
          note: 'internal sale of ' + s.value + ' with no matching bill in ' + (s.counterName || 'the sibling book') });
      }
    });
    purch.forEach(function (p, pi) {
      if (!used[pi]) exceptions.push({ type: 'purchase-without-sale', purchase: p,
        note: 'internal bill of ' + p.value + ' with no matching invoice in ' + (p.counterName || 'the sibling book') });
    });
    return { pairs: pairs, exceptions: exceptions,
             matched: pairs.filter(function (x) { return x.status === 'matched'; }).length,
             partial: pairs.filter(function (x) { return x.status === 'partial'; }).length,
             unmatched: exceptions.filter(function (e) { return /without/.test(e.type); }).length,
             provisional: exceptions.length > 0 };
  }

  /* ── the report the group view consumes ──────────────────────────── */
  function report(books, firms) {
    var ident = identity(firms);
    var cls = classify(books, ident);
    var pr = pair(cls);
    return { identity: ident, classification: cls, pairing: pr, totals: cls.totals,
             formula: {
               externalSales: 'gross sales − inter-company sales',
               externalPurchases: 'gross purchases − inter-company purchases',
               note: pr.provisional ? 'PROVISIONAL — ' + pr.exceptions.length + ' inter-company leg(s) have no counterpart' : 'both sides matched'
             } };
  }

  var api = { identity: identity, classify: classify, pair: pair, report: report,
              _internals: { normG: normG, normN: normN, taxable: taxable, live: live } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLInterCo = api;
})(typeof window !== 'undefined' ? window : globalThis);
