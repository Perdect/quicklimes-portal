/* ═══════════════════════════════════════════════════════════════════════
   DATA INTEGRITY — findings the books cannot see about themselves.

   Found in the live Gotan book: Indian Oil's purchase bill 20263121B024217
   (₹4,74,627 of petcoke, correctly recorded in Purchases) had ALSO been
   written into SALES eight times. ₹37,97,015 of revenue that never
   happened — 14% of the reported sales total — against a company that is a
   registered SUPPLIER. Nothing in the app said a word about it.

   This engine says it. Two checks, both grounded in evidence rather than
   suspicion, because a false accusation about someone's books is expensive:

     DUPLICATE      the same document number, from the same party, recorded
                    more than once in one register.
     WRONG DIRECTION a sale whose counterparty is a supplier. On its own that
                    is only a WARNING — you can genuinely sell lime to a firm
                    you buy bags from. It becomes CERTAIN only when the same
                    document number also exists as a purchase bill from that
                    same party: a supplier's own bill number cannot be your
                    invoice number.

   Severity is earned by evidence, never assumed. Findings carry the raw row
   indices so a caller can act, and a plain-English `why` so the person
   deciding can check the reasoning rather than trust it.

   Pure: no DOM, no storage, no mutation. It reports; it never deletes.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var G = function (x) { return String(x == null ? '' : x).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  var N = function (x) { return String(x == null ? '' : x).toUpperCase().replace(/\s+/g, ' ').trim(); };
  var D = function (x) { return String(x == null ? '' : x).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  var money = function (n) { return Math.round(+n || 0); };

  /* One party, one key. GSTIN when there is one — it is the only identifier
     that is actually unique — otherwise the normalised name. */
  function idOf(gstin, name) { var g = G(gstin); return g ? 'G:' + g : 'N:' + N(name); }

  /* ── DUPLICATES ─────────────────────────────────────────────────────────
     Same document number, same party, more than once. Amounts are compared
     but NOT required to match: a re-typed bill with a corrected total is
     still one bill entered twice, and hiding that behind an amount check is
     how eight identical rows survived. */
  function duplicates(rows, opts) {
    opts = opts || {};
    var docKey = opts.doc || 'inv', partyKey = opts.party || 'party', label = opts.label || 'invoice';
    var by = {};
    (rows || []).forEach(function (r, i) {
      var d = D(r[docKey]); if (!d) return;                 // no number ⇒ nothing to match on
      var k = d + '~' + idOf(r.gstin, r[partyKey]);
      (by[k] = by[k] || []).push({ row: r, at: i });
    });
    var out = [];
    Object.keys(by).forEach(function (k) {
      var g = by[k]; if (g.length < 2) return;
      var first = g[0].row;
      var amounts = g.map(function (x) { return money(x.row.total); });
      var same = amounts.every(function (a) { return a === amounts[0]; });
      var extra = g.length - 1;
      out.push({
        type: 'duplicate', severity: 'certain', kind: opts.kind || 'sale',
        doc: first[docKey], party: first[partyKey] || '', gstin: first.gstin || '',
        count: g.length, idxs: g.map(function (x) { return x.row.idx != null ? x.row.idx : x.at; }),
        each: amounts[0], overstatedBy: amounts.slice(1).reduce(function (a, b) { return a + b; }, 0),
        why: label + ' ' + (first[docKey] || '') + ' is recorded ' + g.length + ' times for ' +
             (first[partyKey] || 'the same party') +
             (same ? ' — every copy identical at ' + amounts[0] : ' — amounts differ (' + amounts.join(', ') + ')') +
             '. ' + extra + ' of them ' + (extra === 1 ? 'is a duplicate' : 'are duplicates') + '.'
      });
    });
    return out.sort(function (a, b) { return b.overstatedBy - a.overstatedBy; });
  }

  /* ── WRONG DIRECTION ────────────────────────────────────────────────────
     A sale billed to one of our suppliers. Proof, not suspicion: only the
     document number appearing on BOTH sides makes it certain. */
  function wrongDirection(sales, purchases, parties) {
    var supplier = {};
    (parties || []).forEach(function (p) {
      if ((p.type || 'customer') === 'supplier') supplier[idOf(p.gstin, p.name)] = p;
    });
    var purchByDoc = {};
    (purchases || []).forEach(function (b) {
      var d = D(b.bill); if (!d) return;
      purchByDoc[d + '~' + idOf(b.gstin, b.sup)] = b;
    });
    /* GROUPED by document + party. Eight copies of one misfiled bill is ONE
       thing that went wrong, not eight. The first live run listed it eight
       times and the panel was unreadable. */
    var by = {}, order = [];
    (sales || []).forEach(function (s, i) {
      var pid = idOf(s.gstin, s.party);
      if (!supplier[pid]) return;
      var k = D(s.inv) + '~' + pid;
      if (!by[k]) { by[k] = { rows: [], twin: purchByDoc[D(s.inv) + '~' + pid] || null, first: s }; order.push(k); }
      by[k].rows.push({ r: s, at: i });
    });
    return order.map(function (k) {
      var g = by[k], s = g.first, twin = g.twin, n = g.rows.length;
      var each = money(s.total);
      var total = g.rows.reduce(function (a, x) { return a + money(x.r.total); }, 0);
      return {
        type: 'wrong-direction', severity: twin ? 'certain' : 'warning', kind: 'sale',
        doc: s.inv || '', party: s.party || '', gstin: s.gstin || '',
        count: n, idxs: g.rows.map(function (x) { return x.r.idx != null ? x.r.idx : x.at; }),
        each: each, overstatedBy: twin ? total : 0,
        why: twin
          ? (n > 1 ? n + ' rows book this as a SALE' : 'This is booked as a SALE') + ' to ' + (s.party || 'a supplier') +
            ', but ' + (s.inv || 'the same number') + ' is also their purchase bill to us, dated ' + (twin.date || '?') +
            ' for ' + money(twin.total) + '. A supplier\'s own bill number cannot be our invoice number — this is their ' +
            'bill, entered on the wrong side' + (n > 1 ? ', ' + n + ' times' : '') + '.'
          : (s.party || 'This party') + ' is saved as a SUPPLIER, so a sales invoice to them is unusual' +
            (n > 1 ? ' (' + n + ' rows)' : '') + '. It can be legitimate — you may sell to a firm you also buy from — ' +
            'so check it rather than assume.'
      };
    }).sort(function (a, b) { return b.overstatedBy - a.overstatedBy; });
  }

  /* Everything, worst first. Certain findings outrank warnings; within a
     tier, the one distorting the books most comes first. */
  function scan(data) {
    data = data || {};
    var sales = data.sales || [], purchases = data.purchases || [], parties = data.parties || [];

    var wd = wrongDirection(sales, purchases, parties);

    /* NO DOUBLE COUNTING. The first live run reported 71,19,405 overstated
       when the true figure was 37,97,016: the eight misfiled Indian Oil rows
       were counted once as a duplicate (seven extra copies) AND again as
       eight wrong-direction rows. A row that should not be in this register
       at all cannot ALSO be an extra copy of something that belongs here.
       Wrong-direction wins, and the duplicate check simply does not see
       those rows — so the headline is the money, counted once. */
    var claimed = {};
    wd.forEach(function (f) {
      if (f.severity !== 'certain') return;
      f.idxs.forEach(function (i) { claimed[i] = 1; });
    });
    var remaining = sales.filter(function (s, i) { return !claimed[s.idx != null ? s.idx : i]; });

    var f = []
      .concat(duplicates(remaining, { doc: 'inv', party: 'party', kind: 'sale', label: 'Invoice' }))
      .concat(duplicates(purchases, { doc: 'bill', party: 'sup', kind: 'purchase', label: 'Bill' }))
      .concat(wd);
    var rank = { certain: 0, warning: 1 };
    f.sort(function (a, b) { return (rank[a.severity] - rank[b.severity]) || (b.overstatedBy - a.overstatedBy); });
    return {
      findings: f,
      certain: f.filter(function (x) { return x.severity === 'certain'; }).length,
      warnings: f.filter(function (x) { return x.severity === 'warning'; }).length,
      /* What the books overstate if every CERTAIN finding is real. Warnings
         contribute nothing — an unconfirmed suspicion is not a number. */
      overstated: f.reduce(function (a, x) { return a + (x.severity === 'certain' ? x.overstatedBy : 0); }, 0)
    };
  }

  /* Which rows a caller would remove to clear one finding, and which it
     KEEPS. A duplicate leaves the first copy standing — the record is real,
     it was simply entered more than once. A wrong-direction row is not ours
     at all, so all of it goes. Never returns every copy of a duplicate:
     deleting all of them would erase a real transaction. */
  function fixPlan(finding) {
    if (!finding) return { remove: [], keep: [], why: '' };
    if (finding.type === 'duplicate') {
      return {
        remove: finding.idxs.slice(1), keep: finding.idxs.slice(0, 1), kind: finding.kind,
        why: 'Keeps the first copy — the transaction is real — and removes the ' +
             (finding.idxs.length - 1) + ' extra ' + (finding.idxs.length === 2 ? 'copy' : 'copies') + '.'
      };
    }
    var n = finding.idxs.length;
    return {
      remove: finding.idxs.slice(), keep: [], kind: finding.kind,
      why: 'Removes ' + (n === 1 ? 'the row' : 'all ' + n + ' rows') + ' entirely: it is the supplier\'s bill, ' +
           'already recorded in Purchases, and was never a sale.'
    };
  }

  var api = { scan: scan, duplicates: duplicates, wrongDirection: wrongDirection, fixPlan: fixPlan, idOf: idOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLIntegrity = api;
})(typeof window !== 'undefined' ? window : globalThis);
