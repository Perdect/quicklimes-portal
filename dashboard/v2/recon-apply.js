/* ═══════════════════════════════════════════════════════════════════════
   recon-apply.js — "Update Payments": turn reconciled bank lines into real
   payments against real bills.

   THE HAZARD THIS FILE EXISTS TO NOT CAUSE
   ────────────────────────────────────────
   A bank line is one of two completely different things:

     (a) a payment ALREADY RECORDED. The user entered the receipt/payment when
         it happened — freight, labour, royalty, an EMI. The cashbook already
         holds it. recon-core matches these with kind:'entry' and returns
         action:'link' — "NEVER 'post' — the money is already recorded"
         (recon-core.js:422). Posting one AGAIN pays the party twice in the
         books: the bill goes over-paid, the cashbook double-counts, and
         receivables drop by money that never came in. It is wrong in the
         direction that HIDES money.

     (b) a payment NOT YET RECORDED. It matches a BILL/INVOICE and there is no
         cashbook entry behind it. This is the ONLY kind this file may post.

   The engine already draws that line. This file does not re-draw it, does not
   second-guess it, and does not invent a competing rule: kind:'entry' (and
   kind:'ledger', which recorded money into the running account) is skipped,
   full stop, at the very top of the decision, before confidence is even read.

   WHAT IS PURE HERE
   ─────────────────
   plan(txns, opts) decides. It touches no DOM, no QLD, no storage — it reads
   transactions and a billOf() lookup and returns the whole intent as data, so
   the confirmation dialog can show exactly what will happen BEFORE anything is
   written, and so every rule below is a Node test rather than a hope.

   applyPlan(plan, ctx) executes that intent through the EXISTING QLD mutations
   (receiveSalesPayment / payPurchaseBill) — which already update status,
   outstanding, cashbook, party ledger and audit. Nothing is hand-rolled here.

   Run the tests: node recon-apply.test.js
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── the thresholds are the ENGINE's, not ours ─────────────────────────
     recon-core.js:305 —  conf >= 95 ? 'green' : conf >= 75 ? 'yellow' : 'red'
     Auto-posting money is the most consequential thing this app does, so it
     rides the engine's OWN top tier: green only. Yellow is 'review' — the
     engine is literally saying a human should look — and a human looking is
     exactly what a `manual` confirmation is. So:

         green (>=95)            → post
         manual (user confirmed) → post, whatever the score
         everything else         → skipped, and the dialog says so

     recon-apply.test.js pins these numbers against recon-core.js's source, so
     if the engine ever re-tunes its tiers this file cannot silently drift into
     a threshold nobody chose. */
  var GREEN = 95, YELLOW = 75;

  var r2 = function (n) { return Math.round((+n || 0) * 100) / 100; };
  /* data.js settles a bill at `paid >= total - 0.5` (recordPurchasePayment /
     receiveSalesPayment). Any "is it settled" question here MUST use the same
     epsilon, or the dialog promises Paid and the mutation writes Partial. */
  var EPS = 0.5;

  /* Mirror of reconcile.js allocsOf(): a txn links to ONE bill (m.idx) or MANY
     (m.allocs). Overridable via opts.allocsOf so the page hands in its own and
     the two can never drift apart. */
  function defaultAllocsOf(t) {
    if (!t || !t.m) return [];
    if (Array.isArray(t.m.allocs) && t.m.allocs.length) return t.m.allocs;
    if (t.m.idx != null) return [{ kind: t.m.kind, idx: t.m.idx, amount: (t.credit || t.debit || 0) }];
    return [];
  }

  /* Money already recorded, in any of its shapes. Each of these means the
     cashbook / running ledger ALREADY holds this money — a post would be the
     second one. */
  function isAlreadyRecorded(m) {
    return !!(m && (m.kind === 'entry' || m.entryId || m.action === 'link' ||
                    m.kind === 'ledger' || m.ledgerEntryId));
  }

  function outstandingOf(b) {
    if (!b) return 0;
    if (b.outstanding != null) return +b.outstanding || 0;
    return Math.max(0, (+b.total || 0) - (+b.paid || 0));
  }
  function refOf(b, kind) { return (kind === 'sale' ? b.inv : b.bill) || ''; }
  function nameOf(b, kind) { return (kind === 'sale' ? b.party : b.sup) || ''; }

  /* ── plan(txns, opts) ────────────────────────────────────────────────────
     opts:
       billOf(kind, idx) -> bill row { idx, total, paid, outstanding, status, inv|bill, party|sup }
       allocsOf(t)       -> [{ kind, idx, amount }]        (default: mirror above)
       minConfidence     -> default GREEN (95). Lower it and you are choosing
                            to post the engine's "needs review" guesses.

     Returns a complete, inspectable intent:
       { post, skipEntry, skipPosted, skipLowConf, skipDuplicate, skipNoBill,
         overpay, totals }

     post / skip* PARTITION the input — every txn lands in exactly one. `overpay`
     is an OVERLAY on top (a posted txn with excess appears in both), because
     "we posted ₹60,000 of this ₹75,000" is one event with two things to say. */
  function plan(txns, opts) {
    opts = opts || {};
    var billOf = opts.billOf || function () { return null; };
    var allocsOf = opts.allocsOf || defaultAllocsOf;
    var min = opts.minConfidence != null ? +opts.minConfidence : GREEN;

    var out = { post: [], skipEntry: [], skipPosted: [], skipLowConf: [],
                skipDuplicate: [], skipNoBill: [], overpay: [], totals: null };

    /* Two bank lines can pay ONE bill (instalments). The bill row's own
       `outstanding` is the state BEFORE this run, so it is stale the moment the
       first line consumes it. Without this ledger the dialog would promise
       "0 Paid" and the second ₹30,000 against a ₹60,000 bill would settle it —
       a dialog that says 110 and posts 111. Remaining is tracked per bill FOR
       THE WHOLE PLAN, so the counts shown are the counts written. */
    var remaining = {};
    var remOf = function (kind, idx, b) {
      var k = kind + ':' + idx;
      if (remaining[k] == null) remaining[k] = outstandingOf(b);
      return remaining[k];
    };

    (txns || []).forEach(function (t) {
      var m = t && t.m;
      var brief = { txnId: t && t.id, date: t && t.date, desc: (t && t.desc) || '',
                    amount: (t && ((+t.credit || 0) + (+t.debit || 0))) || 0,
                    party: (m && m.party) || (t && t.clean) || '' };

      /* ── 1. THE MOST IMPORTANT BRANCH IN THIS FILE ──────────────────────
         Money already in the books. Checked FIRST, unconditionally, before
         confidence, before anything — so no later clause, no threshold tweak
         and no future edit further down can ever route it into `post`. */
      if (isAlreadyRecorded(m)) {
        out.skipEntry.push(Object.assign({}, brief, {
          reason: m.kind === 'ledger' || m.ledgerEntryId ? 'ledger' : 'entry',
          entryId: m.entryId || m.ledgerEntryId || '',
          why: 'Already recorded in the cashbook — linking only, never posting again'
        }));
        return;
      }

      /* ── 2. already applied by a previous run ───────────────────────────
         The user WILL double-click. The stamp is the only thing between them
         and a second payment. */
      if (m && m.posted) {
        out.skipPosted.push(Object.assign({}, brief, {
          reason: 'posted', batch: m.posted.batch || '', at: m.posted.at || '',
          why: 'Already posted' + (m.posted.at ? ' on ' + String(m.posted.at).slice(0, 10) : '')
        }));
        return;
      }

      /* ── 3. a re-imported copy of a line ────────────────────────────────
         The engine flagged this as the same money appearing twice. Posting it
         pays the bill twice for one real transfer. */
      if (m && m.status === 'duplicate') {
        out.skipDuplicate.push(Object.assign({}, brief, {
          reason: 'duplicate', why: 'Flagged as a duplicate of an earlier transaction'
        }));
        return;
      }

      var allocs = allocsOf(t) || [];
      if (!m || !allocs.length) {
        out.skipNoBill.push(Object.assign({}, brief, {
          reason: 'unmatched', why: 'No bill linked — nothing to post'
        }));
        return;
      }

      /* ── 4. the confidence gate ─────────────────────────────────────────
         action:'ask' is excluded no matter how high it scores: the engine
         raises 'ask' precisely because an existing record might be this money.
         Auto-posting it would post the payment the ask exists to prevent. */
      var manual = !!m.manual;
      var conf = m.confidence != null ? +m.confidence : 0;
      if (!manual && (m.action === 'ask' || !(conf >= min))) {
        out.skipLowConf.push(Object.assign({}, brief, {
          reason: m.action === 'ask' ? 'ask' : 'low_confidence',
          confidence: conf, tier: m.tier || '',
          why: m.action === 'ask'
            ? 'Might be an already-recorded payment — confirm it first'
            : 'Confidence ' + conf + '% is below ' + min + '% — confirm it first'
        }));
        return;
      }

      /* ── 5. build the lines ─────────────────────────────────────────────── */
      var isCr = (+t.credit || 0) > 0;
      var bank = r2(isCr ? t.credit : t.debit);
      var budget = bank;                 // a split may never exceed the bank line
      var lines = [], notes = [];

      allocs.forEach(function (a) {
        var b = billOf(a.kind, a.idx);
        if (!b) { notes.push({ kind: a.kind, idx: a.idx, reason: 'bill_missing' }); return; }
        if (b.status === 'cancelled') { notes.push({ kind: a.kind, idx: a.idx, reason: 'cancelled', ref: refOf(b, a.kind) }); return; }
        /* A credit is money IN — it can only pay a sale. A debit is money OUT —
           only a purchase. A mismatch is corrupt state, and paying a supplier
           out of a customer receipt is not a thing to guess at. */
        if (isCr !== (a.kind === 'sale')) { notes.push({ kind: a.kind, idx: a.idx, reason: 'direction' }); return; }

        var rem = remOf(a.kind, a.idx, b);
        var want = Math.min(r2(a.amount), budget);          // never exceed the bank line
        var pay = r2(Math.min(want, rem));                  // never exceed what is owed
        if (pay <= 0) { notes.push({ kind: a.kind, idx: a.idx, reason: 'already_settled', ref: refOf(b, a.kind) }); return; }

        var left = r2(rem - pay);
        remaining[a.kind + ':' + a.idx] = left;
        budget = r2(budget - pay);

        lines.push({
          kind: a.kind, idx: a.idx, amount: pay,
          ref: refOf(b, a.kind), party: nameOf(b, a.kind),
          billTotal: r2(b.total), outstandingBefore: r2(rem), outstandingAfter: left,
          /* NEVER Paid for less than the total. Same epsilon data.js settles on,
             so what the dialog promises is what the mutation writes. */
          resultStatus: left <= EPS ? 'paid' : 'partial'
        });
      });

      var applied = r2(lines.reduce(function (s, l) { return s + l.amount; }, 0));
      var excess = r2(bank - applied);

      /* ── 6. money that could not land on a bill ─────────────────────────
         ₹75,000 against a ₹60,000 debt is ₹15,000 of real money. It is not
         posted (it would over-pay the bill) and it is NOT dropped on the floor
         — it is named here, counted, and shown in the dialog. */
        if (excess > EPS) {
        out.overpay.push(Object.assign({}, brief, {
          bankAmount: bank, applied: applied, excess: excess,
          reason: lines.length ? (budget > EPS ? 'unallocated' : 'over_bill') : 'unapplied',
          bills: lines.map(function (l) { return { kind: l.kind, idx: l.idx, ref: l.ref, amount: l.amount }; }),
          why: (lines.length ? 'Bank line is ' : 'None of ')
             + (lines.length ? 'more than the bill(s) it pays' : 'this line could be applied')
             + ' — ' + excess + ' is not posted anywhere. Record it as an advance or link another bill.'
        }));
      }

      if (!lines.length) {
        out.skipNoBill.push(Object.assign({}, brief, {
          reason: (notes[0] && notes[0].reason) || 'unmatched',
          notes: notes, why: 'Nothing postable on this line'
        }));
        return;
      }

      out.post.push(Object.assign({}, brief, {
        txn: t, bankAmount: bank, applied: applied, excess: excess,
        accountId: t.accountId || '', ref: t.utr || t.ref || '',
        lines: lines, notes: notes
      }));
    });

    var paid = 0, partial = 0, bills = 0, amount = 0;
    out.post.forEach(function (p) {
      p.lines.forEach(function (l) {
        bills++; amount = r2(amount + l.amount);
        if (l.resultStatus === 'paid') paid++; else partial++;
      });
    });

    out.totals = {
      txns: (txns || []).length,
      post: out.post.length,
      bills: bills,          // one payment will be written per bill line
      paid: paid,            // bills that will end up fully Paid
      partial: partial,      // bills that will end up Partial
      amount: amount,        // total money that will be posted
      excess: r2(out.overpay.reduce(function (s, o) { return s + o.excess; }, 0)),
      overpay: out.overpay.length,
      skipEntry: out.skipEntry.length,
      skipPosted: out.skipPosted.length,
      skipLowConf: out.skipLowConf.length,
      skipDuplicate: out.skipDuplicate.length,
      skipNoBill: out.skipNoBill.length,
      minConfidence: min
    };
    return out;
  }

  /* ── applyPlan(plan, ctx) ────────────────────────────────────────────────
     Executes the plan through the EXISTING mutations. Writes nothing itself.
       ctx.Q       — QLD (receiveSalesPayment / payPurchaseBill)
       ctx.cashIds — () => [cashbook ids]  (optional; lets us record WHICH
                     cashbook rows this run created, so a run is traceable)
       ctx.batch   — batch id (default generated)

     Idempotency is a WRITE, not a check: every txn that got at least one
     payment is stamped m.posted before we move on. If a later line throws, the
     stamp still covers what was written — a re-run skips the whole txn rather
     than retrying the failed line and risking a second payment on the ones that
     succeeded. The errors are reported instead. Money errs toward "did less". */
  function applyPlan(pl, ctx) {
    ctx = ctx || {};
    var Q = ctx.Q || {};
    var batch = ctx.batch || ('rb' + Date.now().toString(36));
    var at = ctx.at || new Date().toISOString();
    var cashIds = typeof ctx.cashIds === 'function' ? ctx.cashIds : null;

    var res = { batch: batch, at: at, applied: [], bills: 0, amount: 0, paid: 0, partial: 0, errors: [] };

    (pl && pl.post || []).forEach(function (p) {
      var t = p.txn, done = [];
      p.lines.forEach(function (l) {
        try {
          var before = cashIds ? cashIds() : null;
          var o = { amount: l.amount, date: p.date, method: 'Bank', ref: p.ref || l.ref || '',
                    accountId: p.accountId || '',
                    notes: 'Bank reconciliation · ' + batch };
          if (l.kind === 'sale') Q.receiveSalesPayment(l.idx, o);
          else Q.payPurchaseBill(l.idx, o);

          var cbId = '';
          if (cashIds) {
            var seen = {}; (before || []).forEach(function (x) { seen[x] = 1; });
            var fresh = (cashIds() || []).filter(function (x) { return x && !seen[x]; });
            cbId = fresh[fresh.length - 1] || '';
          }
          done.push({ kind: l.kind, idx: l.idx, amount: l.amount, cashbookId: cbId });
          res.bills++; res.amount = r2(res.amount + l.amount);
          if (l.resultStatus === 'paid') res.paid++; else res.partial++;
        } catch (e) {
          res.errors.push({ txnId: p.txnId, kind: l.kind, idx: l.idx, amount: l.amount,
                            error: (e && e.message) || String(e) });
        }
      });

      if (done.length && t) {
        t.m = t.m || {};
        /* THE STAMP. Everything about not paying twice hangs off this object. */
        t.m.posted = { batch: batch, at: at, lines: done,
                       cashbookIds: done.map(function (x) { return x.cashbookId; }).filter(Boolean) };
        /* Re-matching must not undo a decision that moved money. `manual` stops
           runMatchAll() from rewriting m — and reconcile.js additionally carries
           m.posted across a FORCED re-match, which ignores `manual`. */
        t.m.manual = true;
        res.applied.push(p.txnId);
      }
    });
    return res;
  }

  var api = { plan: plan, applyPlan: applyPlan, GREEN: GREEN, YELLOW: YELLOW,
              allocsOf: defaultAllocsOf, isAlreadyRecorded: isAlreadyRecorded, outstandingOf: outstandingOf };
  if (typeof window !== 'undefined') window.RCApply = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
