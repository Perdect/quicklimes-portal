/* ═══════════════════════════════════════════════════════════════════════
   ALLOCATION ENGINE — which invoices does this money pay off?

   A receipt of ₹4,97,490 arrives from AMAN ENTERPRISES. The old app could
   only post it "on account": the balance moved, but no invoice closed, so
   the outstanding list still showed four open bills and nobody could say
   which two had been paid. Two of those bills were ₹2,48,745 each. The
   customer was paying invoices 51 and 52 — and the app had no way to say so.

   This decides that, and it will not guess when guessing would be wrong.

   THREE RULES
     1. Never apply more than an invoice's own balance. Money that has
        nowhere to go stays UNAPPLIED and is posted on-account. An app that
        silently absorbs the excess invents a payment.
     2. An EXACT subset match outranks oldest-first. If some combination of
        open bills sums to exactly the amount received, that is almost
        certainly what the customer paid — a round FIFO spread across three
        bills with a stray partial is the shape of a wrong answer.
     3. Every proposal says WHY it was chosen, because the person approving
        it is the one who knows the customer.

   Pure arithmetic: no DOM, no storage, no side effects. Amounts are rupees
   held to 2dp; comparisons use a half-paisa tolerance so floating point
   never reports a settled bill as ₹0.004 outstanding.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var EPS = 0.005;                                   // half a paisa
  function r2(n) { return Math.round((+n || 0) * 100) / 100; }
  function num(n) { var v = parseFloat(n); return isFinite(v) ? v : 0; }

  /* Open bills, oldest first. Anything already settled is not a target. */
  function open(invoices) {
    return (invoices || [])
      .map(function (i) { return { idx: i.idx, ref: i.ref || '', date: i.date || '', bal: r2(i.bal) }; })
      .filter(function (i) { return i.bal > EPS; })
      .sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
  }

  /* ── EXACT MATCH ────────────────────────────────────────────────────────
     Does some combination of open bills add up to exactly this amount?
     Bounded on purpose: a full subset scan is 2^n, so beyond 18 open bills
     it falls back to the cheap shapes that actually occur in practice —
     one bill, two bills, and a consecutive run (a customer clearing
     everything up to a date). Returning nothing is a fine answer; the
     caller falls back to oldest-first and says so. */
  function exact(amount, invoices) {
    var inv = open(invoices), target = r2(amount), n = inv.length;
    if (n === 0 || target <= EPS) return null;

    var best = null;
    var take = function (picks, why) {
      if (!picks || !picks.length) return;
      /* Fewest bills wins: "these two invoices" is a claim someone can check
         against a remittance advice; "these seven" is noise. */
      if (!best || picks.length < best.picks.length) best = { picks: picks.slice(), why: why };
    };

    if (n <= 18) {
      for (var m = 1; m < (1 << n); m++) {
        var sum = 0, picks = [];
        for (var b = 0; b < n; b++) if (m & (1 << b)) { sum += inv[b].bal; picks.push(inv[b]); }
        if (Math.abs(sum - target) < EPS) take(picks, null);
        if (best && best.picks.length === 1) break;         // cannot do better
      }
    } else {
      for (var i = 0; i < n; i++) {
        if (Math.abs(inv[i].bal - target) < EPS) { take([inv[i]], null); break; }
        for (var j = i + 1; j < n; j++) if (Math.abs(inv[i].bal + inv[j].bal - target) < EPS) take([inv[i], inv[j]], null);
      }
      if (!best) {
        for (var s = 0; s < n; s++) {
          var run = 0, acc = [];
          for (var e = s; e < n; e++) {
            run += inv[e].bal; acc.push(inv[e]);
            if (Math.abs(run - target) < EPS) { take(acc, null); break; }
            if (run > target + EPS) break;
          }
        }
      }
    }
    if (!best) return null;
    var refs = best.picks.map(function (p) { return p.ref || '(no number)'; });
    return {
      rows: best.picks.map(function (p) { return { idx: p.idx, ref: p.ref, date: p.date, bal: p.bal, apply: p.bal }; }),
      why: refs.length === 1
        ? 'this is the exact balance of ' + refs[0]
        : 'these ' + refs.length + ' bills come to exactly this amount (' + refs.join(' + ') + ')'
    };
  }

  /* ── OLDEST FIRST ───────────────────────────────────────────────────────
     The default when nothing matches exactly: clear the oldest debt first,
     which is what both sides usually assume and what ageing reports imply. */
  function fifo(amount, invoices) {
    var inv = open(invoices), left = r2(amount), rows = [];
    for (var i = 0; i < inv.length; i++) {
      if (left <= EPS) break;
      var use = r2(Math.min(left, inv[i].bal));
      rows.push({ idx: inv[i].idx, ref: inv[i].ref, date: inv[i].date, bal: inv[i].bal, apply: use });
      left = r2(left - use);
    }
    return { rows: rows, why: rows.length ? 'oldest bill first — no combination of open bills matches this amount exactly' : '' };
  }

  /* The proposal to show the user: exact if there is one, otherwise oldest-first. */
  function propose(amount, invoices) {
    var e = exact(amount, invoices);
    var p = e || fifo(amount, invoices);
    var applied = p.rows.reduce(function (a, r) { return a + r.apply; }, 0);
    return {
      rows: p.rows, why: p.why, kind: e ? 'exact' : (p.rows.length ? 'fifo' : 'none'),
      applied: r2(applied), unapplied: r2(r2(amount) - applied)
    };
  }

  /* ── VALIDATE WHAT THE USER ACTUALLY TYPED ──────────────────────────────
     The proposal is a suggestion; the user may edit any line. Every edit is
     checked against the same two limits — a line cannot exceed its bill, and
     the lines together cannot exceed the money received. Whatever is left
     over is UNAPPLIED, reported plainly, and posted on-account. It is never
     quietly folded into the last invoice. */
  function validate(amount, invoices, entered) {
    var inv = open(invoices), amt = r2(amount), errors = [], rows = [], applied = 0;
    entered = entered || {};
    if (amt <= EPS) errors.push('Enter the amount received.');
    for (var i = 0; i < inv.length; i++) {
      var v = r2(num(entered[inv[i].idx]));
      if (v < -EPS) { errors.push((inv[i].ref || 'A bill') + ': an allocation cannot be negative.'); v = 0; }
      if (v > inv[i].bal + EPS) {
        errors.push((inv[i].ref || 'A bill') + ' only has ' + inv[i].bal.toFixed(2) + ' outstanding.');
        v = inv[i].bal;
      }
      applied = r2(applied + v);
      rows.push({ idx: inv[i].idx, ref: inv[i].ref, date: inv[i].date, bal: inv[i].bal, apply: v });
    }
    if (applied > amt + EPS) errors.push('Allocated ' + applied.toFixed(2) + ' but only ' + amt.toFixed(2) + ' was received.');
    return {
      rows: rows.filter(function (r) { return r.apply > EPS; }),
      all: rows, applied: applied, unapplied: r2(amt - applied),
      ok: errors.length === 0, errors: errors
    };
  }

  var api = { open: open, exact: exact, fifo: fifo, propose: propose, validate: validate, EPS: EPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLAllocate = api;
})(typeof window !== 'undefined' ? window : globalThis);
