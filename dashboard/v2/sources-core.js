/* ═══════════════════════════════════════════════════════════════════════
   sources-core.js — the FOUR INDEPENDENT DATA SOURCES, and the rule that
   a number is only shown when the data to compute it actually exists.

   Pure. No DOM, no QLD, no localStorage. Runs under node for the tests.

   ── THE BUSINESS RULE THIS FILE EXISTS TO ENFORCE ────────────────────
   Sales, Purchase, Payments/Receipts and the Bank e-statement are FOUR
   SEPARATE SOURCES. Each is uploaded on its own and stands on its own.
   Uploading one must never create, delete or compute another. They may
   be MATCHED afterwards, but a match is a relationship laid on top —
   never the record itself.

   The bug this replaces: salesRows() stamps every imported invoice
   status:'pending' (data.js:763) and then reports
   outstanding = total − paid (data.js:1214). Upload July sales with no
   payment data anywhere and the app confidently announces
   "Collected ₹0 · Outstanding ₹25,44,152". Both numbers are inventions.
   Nothing was collected because nothing was RECORDED, and an unknown is
   not a zero.

   So every figure here carries a STATE, never a bare number:
     'ok'     — we have the inputs; `value` is real (0 is a real 0)
     'nodata' — that source has not been uploaded → "Not uploaded"
     'nocalc' — sources exist but an input this figure needs does not
                → "Cannot calculate"
   The UI renders state first and the number second. ₹0 is only ever
   printed when uploaded data proves the answer is zero.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const round2 = n => Math.round(n * 100) / 100;
  const arr = v => Array.isArray(v) ? v : [];

  /* Liveness — the same rule the registers use (data.js withIdx + the void
     rule). A soft-deleted row is gone as far as every reader is concerned;
     it keeps its array slot only so the persisted indices other modules
     stored (cashbook link.idx, recon m.idx …) never shift under them. */
  const liveRow = r => !!r && !r._del && !r._arch && (r.status || 'pending') !== 'cancelled';
  const liveCash = r => !!r && !r._del && !r._arch && (r.status || '') !== 'cancelled';

  const ymOf = d => { const s = String(d == null ? '' : d); return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : ''; };
  const inRange = (d, from, to) => !!d && (!from || d >= from) && (!to || d <= to);

  /* The four sources, in the order the business thinks about them. */
  const MODULES = ['sales', 'purchase', 'payments', 'bank'];
  const MODULE_LABEL = { sales: 'Sales', purchase: 'Purchase', payments: 'Payments', bank: 'Bank statement' };

  /* Where each source physically lives inside a company blob. Keeping this
     in one table is the point: it is the only place that knows a payment
     is a CASHBOOK row and a bank line is a RECON txn. */
  /* THE KEY IS `reconcile`, NOT `recon`.  In memory the store is S.RECON, but
     blob() persists it as `reconcile` (data.js:552) and loadLocal reads back
     d.reconcile (data.js:466). Reading blob.recon returns undefined for every
     saved book — which is how the Group Overview reported "Bank statement —
     not uploaded" while 656 real transactions sat in the file. Both spellings
     are accepted so a hand-built object (and the tests) still work. */
  function bank(blob) {
    const r = (blob && (blob.reconcile || blob.recon)) || null;
    return arr(r && r.txns);
  }

  /* ── What a bank line's match actually means ──────────────────────────
     The field is m.status, not m.state. Real values in a live book:
       matched · partial · overpayment · review · duplicate · unknown · other
     Two different things get called "reconciled" and they must not be added
     together silently:
       LINKED     — points at a specific invoice or bill (kind sale|purchase
                    with an idx). This is reconciliation in the accounting
                    sense: this money is that document.
       CLASSIFIED — status 'other': bank interest, charges, an own-account
                    transfer. Resolved, but there is no document to point at
                    and there never will be.
     Everything else is still open. */
  const mOf = t => (t && t.m) || null;
  const isLinked = t => { const m = mOf(t); return !!m && (m.kind === 'sale' || m.kind === 'purchase') && m.idx != null; };
  const isClassified = t => { const m = mOf(t); return !!m && m.status === 'other'; };
  const isPosted = t => { const m = mOf(t); return !!(m && m.posted); };

  /* ── invoice money, mirrored from data.js cS/cP ───────────────────────
     Sale: taxable = qty × rate, gst = taxable × rate%.  Purchase: the
     bill's own taxable. Never re-derived differently here — a second
     opinion on arithmetic is how two screens start disagreeing. */
  function saleTaxable(s) { return num(s.taxable) || round2(num(s.qty) * num(s.rate)); }
  function saleTotal(s) { const tx = saleTaxable(s); return round2(tx + tx * num(s.gstR) / 100); }
  function purchTaxable(p) { return num(p.taxable); }

  /* ═══════════════════════════════════════════════════════════════════
     SCAN — what do we actually have?
     Answers, per source: is it there at all, how many rows, over which
     months, and what it totals. Nothing here computes ACROSS sources.
     ═══════════════════════════════════════════════════════════════════ */
  function scan(blob, range) {
    blob = blob || {};
    const from = range && range.from, to = range && range.to;
    const keep = d => inRange(d, from, to);

    /* SALES — invoices, on their own. */
    const sales = arr(blob.sales).filter(liveRow);
    const salesIn = sales.filter(s => keep(s.date));

    /* PURCHASE — bills, on their own. */
    const purch = arr(blob.purchases).filter(liveRow);
    const purchIn = purch.filter(p => keep(p.date));

    /* PAYMENTS / RECEIPTS — the cashbook is the independent payment
       ledger: a receipt may exist with link:null and no invoice at all.
       Receipts recorded ON an invoice (s.payments[]) are payment records
       too — they are just attached at birth. Both count as evidence that
       the payments source has been populated. */
    const cash = arr(blob.cashbook).filter(liveCash);
    const cashIn = cash.filter(e => keep(e.date));

    /* ── ONE payment, recorded TWICE ──────────────────────────────────
       receiveSalesPayment (data.js:2314) writes the same event into BOTH
       s.payments[] and S.CASHBOOK with link:{kind:'sale',idx}. They are one
       receipt mirrored in two places, not two receipts. Adding them up
       doubles the money: three real receipts of ₹3,58,953 reported as
       ₹7,17,906.

       The cashbook IS the payment ledger, so it is the count of record.
       An embedded payment contributes only the part the ledger does not
       already carry — which is how legacy rows (payment on the invoice,
       nothing in the cashbook) still get counted exactly once.

       Indices here are RAW positions in blob.sales / blob.purchases,
       because that is what link.idx means. Walking a pre-filtered array
       would offset every link by the number of deleted rows above it. */
    const ledgerBy = kind => {
      const m = {};
      cashIn.forEach(e => { if (e.link && e.link.kind === kind && e.link.idx != null) m[e.link.idx] = (m[e.link.idx] || 0) + num(e.amount); });
      return m;
    };
    const bySale = ledgerBy('sale'), byPurch = ledgerBy('purchase');
    const embedded = [];
    const gather = (rows, dir, ledger) => arr(rows).forEach((r, i) => {
      if (!liveRow(r)) return;
      const pays = arr(r.payments).filter(p => keep(p.date || r.date));
      if (!pays.length) return;
      const sum = pays.reduce((a, p) => a + num(p.amount), 0);
      const extra = round2(sum - (ledger[i] || 0));       // what the ledger is missing
      if (extra > 0.005) embedded.push({ dir: dir, amount: extra, date: pays[0].date || r.date, idx: i, mirrored: !!ledger[i] });
    });
    gather(blob.sales, 'in', bySale);
    gather(blob.purchases, 'out', byPurch);

    /* BANK E-STATEMENT — raw imported lines. Untouched by matching; a
       match is stored beside the line (t.m), never folded into it. */
    const txns = bank(blob).filter(t => !t._del);
    const txnsIn = txns.filter(t => keep(t.date));
    const stmts = arr(blob.statements);

    const months = rows => { const s = {}; rows.forEach(r => { const m = ymOf(r.date); if (m) s[m] = (s[m] || 0) + 1; }); return s; };

    /* Allocation = a payment that has been tied to a specific bill. This is
       the ONLY thing that licenses an outstanding figure. An unallocated
       receipt is money in, not a settled invoice. */
    const allocIn = cashIn.filter(e => e.link && e.link.kind === 'sale' && e.link.idx != null).length
      + embedded.filter(e => e.dir === 'in' && !e.mirrored).length;
    const allocOut = cashIn.filter(e => e.link && e.link.kind === 'purchase' && e.link.idx != null).length
      + embedded.filter(e => e.dir === 'out' && !e.mirrored).length;

    const credit = e => e.type === 'credit' ? num(e.amount) : 0;
    const debit = e => e.type === 'debit' ? num(e.amount) : 0;
    const inValue = cashIn.reduce((a, e) => a + credit(e), 0) + embedded.filter(e => e.dir === 'in').reduce((a, e) => a + e.amount, 0);
    const outValue = cashIn.reduce((a, e) => a + debit(e), 0) + embedded.filter(e => e.dir === 'out').reduce((a, e) => a + e.amount, 0);

    const linked = txnsIn.filter(isLinked).length;
    const classified = txnsIn.filter(t => !isLinked(t) && isClassified(t)).length;

    return {
      range: { from: from || null, to: to || null },
      sales: {
        key: 'sales', label: MODULE_LABEL.sales, present: salesIn.length > 0,
        count: salesIn.length, months: months(salesIn),
        value: round2(salesIn.reduce((a, s) => a + saleTaxable(s), 0)),
        total: round2(salesIn.reduce((a, s) => a + saleTotal(s), 0)),
        qty: round2(salesIn.reduce((a, s) => a + num(s.qty), 0))
      },
      purchase: {
        key: 'purchase', label: MODULE_LABEL.purchase, present: purchIn.length > 0,
        count: purchIn.length, months: months(purchIn),
        value: round2(purchIn.reduce((a, p) => a + purchTaxable(p), 0))
      },
      payments: {
        key: 'payments', label: MODULE_LABEL.payments,
        present: (cashIn.length + embedded.length) > 0,
        count: cashIn.length + embedded.length, months: months(cashIn),
        inValue: round2(inValue), outValue: round2(outValue),
        allocatedIn: allocIn, allocatedOut: allocOut,
        /* Money that actually settles invoices — NOT the same as money in.
           A walk-in receipt with no link is real cash and belongs in
           inValue, but it cannot reduce anyone's outstanding. */
        allocatedInValue: round2(
          cashIn.reduce((a, e) => a + (e.link && e.link.kind === 'sale' && e.link.idx != null ? credit(e) : 0), 0)
          + embedded.filter(e => e.dir === 'in' && !e.mirrored).reduce((a, e) => a + e.amount, 0)),
        unallocated: cashIn.filter(e => !e.link).length
      },
      bank: {
        key: 'bank', label: MODULE_LABEL.bank, present: txnsIn.length > 0,
        count: txnsIn.length, months: months(txnsIn), statements: stmts.length,
        credits: round2(txnsIn.reduce((a, t) => a + num(t.credit), 0)),
        debits: round2(txnsIn.reduce((a, t) => a + num(t.debit), 0)),
        linked: linked,                       // points at an invoice or bill
        classified: classified,               // interest/charges/transfer — no document
        posted: txnsIn.filter(isPosted).length,
        matched: linked + classified,         // resolved, either way
        unmatched: txnsIn.length - linked - classified
      }
    };
  }

  /* ═══════════════════════════════════════════════════════════════════
     METRICS — every headline figure, each tagged with whether we are
     entitled to state it.  This is §17: "Do we actually have the data
     required for this calculation?" asked once, in one place.
     ═══════════════════════════════════════════════════════════════════ */
  const ok = (value, note) => ({ state: 'ok', value: round2(value), why: note || '' });
  const nodata = why => ({ state: 'nodata', value: null, why: why });
  const nocalc = why => ({ state: 'nocalc', value: null, why: why });

  function metrics(sc) {
    const S = sc.sales, P = sc.purchase, Y = sc.payments, B = sc.bank;
    const m = {};

    m.sales = S.present ? ok(S.value) : nodata('Sales not uploaded');
    m.salesQty = S.present ? ok(S.qty) : nodata('Sales not uploaded');
    m.purchase = P.present ? ok(P.value) : nodata('Purchase not uploaded');

    /* Payments stands alone — it does not need sales to exist. */
    m.received = Y.present ? ok(Y.inValue) : nodata('Payments not recorded');
    m.paidOut = Y.present ? ok(Y.outValue) : nodata('Payments not recorded');

    /* Bank stands alone too. Its credits are NOT "sales collected" until
       something matches them to an invoice (§ Example 3). */
    m.bankIn = B.present ? ok(B.credits) : nodata('Bank statement not uploaded');
    m.bankOut = B.present ? ok(B.debits) : nodata('Bank statement not uploaded');

    /* Collected against sales — needs BOTH sales and allocated receipts.
       Receipts that are not allocated to an invoice cannot settle one. */
    if (!S.present) m.collected = nodata('Sales not uploaded');
    else if (!Y.present) m.collected = nodata('Payments not recorded');
    else if (!Y.allocatedIn) m.collected = nocalc('Receipts exist but none are allocated to an invoice');
    else m.collected = ok(allocatedInValue(sc));

    /* Outstanding — the figure the old code invented. It exists only when
       collected exists. Never "sales minus nothing". */
    m.outstanding = m.collected.state === 'ok'
      ? ok(Math.max(0, S.value - m.collected.value))
      : (m.collected.state === 'nodata' ? nocalc(m.collected.why) : nocalc(m.collected.why));

    /* Reconciliation — meaningless with no bank statement, and equally
       meaningless with a statement and nothing to match it against. */
    if (!B.present) m.reconciled = nodata('Bank statement not uploaded');
    else if (!S.present && !P.present && !Y.present) m.reconciled = nocalc('Nothing to match the statement against');
    else m.reconciled = ok(B.count ? Math.round(B.matched * 100 / B.count) : 0, B.matched + ' of ' + B.count + ' lines');

    return m;
  }

  const allocatedInValue = sc => sc.payments.allocatedInValue;

  /* ═══════════════════════════════════════════════════════════════════
     DELETE PLAN — §10-13.  Deleting one source deletes ONLY that source.
     Payments, bank lines, the other register, parties and vendors all
     survive; the only thing that is destroyed alongside is the now-false
     MATCH, because a link to a row that no longer exists is the orphan
     the spec forbids.

     Deletion is a soft delete (_del) and that is not a compromise, it is
     the only safe option here: fourteen places in this codebase persist a
     row's ARRAY INDEX (cashbook link.idx, recon m.idx, m.allocs[].idx,
     m.posted.lines[].idx, m.partyIdx). recon-apply.js:314 dereferences one
     of them to post money. Splicing a month out of S.SALES shifts every
     index above it and silently re-points a receipt at the wrong invoice.
     Soft delete makes the rows invisible to every reader (withIdx filters
     _del) while the slots stay put, and the import guard already excludes
     deleted rows (data.js:716) so the re-upload lands clean.
     ═══════════════════════════════════════════════════════════════════ */
  function deletePlan(blob, module, ym) {
    blob = blob || {};
    if (MODULES.indexOf(module) < 0) throw new Error('unknown module: ' + module);
    if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) throw new Error('month must be YYYY-MM, got: ' + ym);

    const plan = {
      module: module, label: MODULE_LABEL[module], ym: ym,
      remove: { sales: [], purchases: [], cashbook: [], txnIds: [], statementIds: [] },
      unlink: { cashbook: [], recon: [] },
      keep: {}, warnings: []
    };
    const hit = r => liveRow(r) && ymOf(r.date) === ym;

    if (module === 'sales') {
      arr(blob.sales).forEach((s, i) => { if (hit(s)) plan.remove.sales.push(i); });
    } else if (module === 'purchase') {
      arr(blob.purchases).forEach((p, i) => { if (hit(p)) plan.remove.purchases.push(i); });
    } else if (module === 'payments') {
      arr(blob.cashbook).forEach((e, i) => { if (liveCash(e) && ymOf(e.date) === ym) plan.remove.cashbook.push(i); });
    } else if (module === 'bank') {
      bank(blob).forEach(t => { if (!t._del && ymOf(t.date) === ym) plan.remove.txnIds.push(t.id); });
      /* THE STATEMENT LOG IS THE SHA GATE. ImportGuard.fileVerdict refuses a
         PDF whose sha is already logged, so the log row MUST go or the
         corrected file cannot be re-uploaded — and it must go by splice, not
         _del, because the guard reads the raw array.

         But a statement can span months: the real one in this book runs
         2026-01-31 → 2026-05-31. Removing it while deleting January would
         drop the receipt for February–May's lines too. So a log row is
         removed only when it lies ENTIRELY inside the month; a spanning file
         is kept and reported, because the honest answer is "clear the whole
         file's range, or drop it yourself in Settings", not a silent partial. */
      arr(blob.statements).forEach(s => {
        const from = ymOf(s.from || s.period || s.date), to = ymOf(s.to || s.from || s.period || s.date);
        if (!from && !to) return;
        if (from === ym && to === ym) { plan.remove.statementIds.push(s.id); return; }
        if ((from && from <= ym) && (to && to >= ym)) {
          plan.warnings.push('The statement file "' + (s.file || s.id) + '" covers ' + from + ' to ' + to +
            ', not just ' + ym + '. Its log entry is kept, so re-uploading that exact PDF will still be refused as a duplicate. Delete every month it covers, or remove the file from Settings → Bank statements.');
        }
      });
    }

    /* Which relationships die with it. Note what is NOT here: the payment
       row itself, the bank line itself, the party, the other register. */
    const goneSale = new Set(plan.remove.sales);
    const gonePurch = new Set(plan.remove.purchases);
    const goneCash = new Set(plan.remove.cashbook);
    const goneTxn = new Set(plan.remove.txnIds);

    if (module === 'sales' || module === 'purchase') {
      const kind = module === 'sales' ? 'sale' : 'purchase';
      const gone = module === 'sales' ? goneSale : gonePurch;
      arr(blob.cashbook).forEach((e, i) => {
        if (liveCash(e) && e.link && e.link.kind === kind && gone.has(e.link.idx)) {
          plan.unlink.cashbook.push({ idx: i, was: e.link, amount: num(e.amount), date: e.date });
        }
      });
      bank(blob).forEach(t => {
        const mm = t.m; if (!mm || t._del) return;
        const pointsAt = x => x && x.kind === kind && gone.has(x.idx);
        const direct = (mm.kind === kind && gone.has(mm.idx));
        const allocs = arr(mm.allocs).some(a => pointsAt(a) || (mm.kind === kind && gone.has(a.idx)));
        const posted = arr(mm.posted && mm.posted.lines).some(l => gone.has(l.idx));
        if (direct || allocs || posted) plan.unlink.recon.push({ id: t.id, date: t.date, amount: num(t.credit) || num(t.debit), posted: posted });
      });
    }
    if (module === 'payments') {
      /* A deleted receipt un-settles the invoice it was paying. The invoice
         SURVIVES — it just goes back to "payment unknown". */
      arr(blob.cashbook).forEach((e, i) => {
        if (goneCash.has(i) && e.link) plan.unlink.cashbook.push({ idx: i, was: e.link, amount: num(e.amount), date: e.date });
      });
    }
    if (module === 'bank') {
      bank(blob).forEach(t => { if (goneTxn.has(t.id) && t.m && t.m.posted) plan.warnings.push('Bank line ' + t.id + ' had a posted match — the payment it created stays, only the bank line goes.'); });
    }

    /* What SURVIVES — the real count, not "is this the target module".
       An earlier version reported 0 for the module being edited, so deleting
       one month of April showed "Sales: 0 survive" while 140 invoices across
       seven other months were never in danger. On a delete screen that reads
       as "everything goes", which is the opposite of the truth and exactly
       the kind of number that stops an owner from using the feature at all. */
    const liveN = (a, f) => arr(a).filter(f).length;
    plan.keep = {
      sales: liveN(blob.sales, liveRow) - plan.remove.sales.length,
      purchases: liveN(blob.purchases, liveRow) - plan.remove.purchases.length,
      payments: liveN(blob.cashbook, liveCash) - plan.remove.cashbook.length,
      bank: bank(blob).filter(t => !t._del).length - plan.remove.txnIds.length
    };
    /* Of the source being deleted, how much lives in OTHER months — the
       reassurance line: "140 invoices across 7 other months are untouched." */
    const own = { sales: 'sales', purchase: 'purchases', payments: 'payments', bank: 'bank' }[module];
    const allMonths = availableMonths(blob, module);
    plan.sameSource = {
      months: allMonths.filter(x => x.ym !== ym).length,
      rows: plan.keep[own],
      monthRows: (allMonths.find(x => x.ym === ym) || { count: 0 }).count
    };
    plan.counts = {
      removed: plan.remove.sales.length + plan.remove.purchases.length + plan.remove.cashbook.length + plan.remove.txnIds.length,
      unlinkedPayments: plan.unlink.cashbook.length,
      unlinkedBank: plan.unlink.recon.length,
      statements: plan.remove.statementIds.length
    };
    return plan;
  }

  /* Months a source actually holds rows for — what the delete picker offers.
     Never a hard-coded twelve: you cannot delete a month you never uploaded. */
  function availableMonths(blob, module) {
    const sc = scan(blob, null);
    const m = sc[module] && sc[module].months || {};
    return Object.keys(m).sort().reverse().map(ym => ({ ym: ym, count: m[ym] }));
  }

  const api = { scan, metrics, deletePlan, availableMonths, MODULES, MODULE_LABEL,
                _internals: { ymOf, liveRow, liveCash, saleTaxable, saleTotal, ok, nodata, nocalc } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SourcesCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
