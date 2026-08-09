/* ═══════════════════════════════════════════════════════════════════════
   month-apply.js — execute a SourcesCore.deletePlan against a live book.

   Same split recon-apply.js uses: the pure module decides WHAT (deletePlan),
   this one does it. Kept out of page code deliberately — the applier is the
   part that must not be rewritten when a fifth source is added, and it is
   the part that has to be node-testable.

   WHAT THIS DOES, AND EQUALLY WHAT IT REFUSES TO DO
   · Rows are marked _del. Never spliced. Fourteen places in this codebase
     persist a row's ARRAY INDEX (cashbook link.idx, recon m.idx,
     m.allocs[].idx, m.posted.lines[].idx, m.partyIdx) and recon-apply.js
     dereferences one to post real money. Splicing a month out of S.SALES
     shifts every index above it and silently re-points a receipt at the
     wrong invoice. data.js withIdx already hides _del rows from every
     reader, so this is invisible to the user and safe for us.
   · A linked receipt is UNLINKED, never deleted. The money stays in the
     cash book. And we clear only link.idx — never the whole link object,
     because link.freightId and link.ledgerId are the only handles
     deleteFreightPayment and reverseLedgerEntry have; dropping them
     strands a freight payment or an on-account entry forever.
   · Statement log rows ARE spliced, because ImportGuard.fileVerdict reads
     the raw array: a _del row would still refuse the corrected PDF.
   · ONE commit and ONE audit line for the whole month. QLD.softDelete
     commits and writes an audit row per call, and the audit log evicts its
     oldest entries past 3000 — a 38-invoice month would burn 38 of them and
     push out real history.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const SRC = (typeof module !== 'undefined' && module.exports) ? require('./sources-core.js') : root.SourcesCore;
  const arr = v => Array.isArray(v) ? v : [];
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

  /* The plan the user approved must still describe the book we are about to
     change. Between the preview and the click the owner can switch firm, a
     second tab can sync, or an import can land. Re-derive and compare — a
     stale plan holds raw indices and would soft-delete whatever now sits in
     those slots. */
  function verify(plan, blob) {
    const fresh = SRC.deletePlan(blob, plan.module, plan.ym);
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const ok = same(fresh.remove.sales, plan.remove.sales)
      && same(fresh.remove.purchases, plan.remove.purchases)
      && same(fresh.remove.cashbook, plan.remove.cashbook)
      && same(fresh.remove.txnIds, plan.remove.txnIds);
    return { ok: ok, fresh: fresh };
  }

  /* ctx supplies the live arrays and the few impure hooks. Everything else
     is done here so the whole thing runs under node in the tests.
       ctx = { sales, purchases, cashbook, txns, statements,
               who:{by,role}, at:'ISO', reason:'', logAudit(), commit() } */
  function applyPlan(plan, ctx) {
    ctx = ctx || {};
    const at = ctx.at || '';
    const who = ctx.who || { by: '', role: '' };
    const stamp = { at: at, by: who.by, role: who.role, reason: ctx.reason || ('Replace month · ' + plan.ym) };
    const receipt = { module: plan.module, ym: plan.ym, removed: 0, unlinkedPayments: 0, unlinkedBank: 0, postedKept: 0, statements: 0, money: { unlinked: 0 } };

    const kill = (list, idxs) => idxs.forEach(i => { const r = arr(list)[i]; if (r && !r._del) { r._del = stamp; receipt.removed++; } });
    kill(ctx.sales, plan.remove.sales);
    kill(ctx.purchases, plan.remove.purchases);
    kill(ctx.cashbook, plan.remove.cashbook);

    /* Release the receipts that pointed at rows now gone. The row survives,
       the amount survives, only the claim "this money is that invoice" goes. */
    plan.unlink.cashbook.forEach(u => {
      const e = arr(ctx.cashbook)[u.idx]; if (!e || !e.link) return;
      if (e.link.idx == null) return;
      e.link._wasIdx = e.link.idx;
      e.link.idx = null;
      e.link._unlinkedAt = at;
      e.link._unlinkedWhy = plan.module + ' ' + plan.ym + ' removed';
      receipt.unlinkedPayments++;
      receipt.money.unlinked += num(e.amount);
    });

    /* Bank lines go back to "needs review", keeping the posted stamp so the
       same line can never post its money twice. */
    plan.unlink.recon.forEach(u => {
      const t = arr(ctx.txns).find(x => x && x.id === u.id); if (!t) return;
      const r = SRC.unmatchTxn(t, { ym: plan.ym, module: plan.module, at: at });
      if (r) { receipt.unlinkedBank++; if (r.postedKept) receipt.postedKept++; }
    });

    /* Bank month delete: drop the lines by id, and SPLICE the statement log
       rows so the sha gate lets the corrected PDF back in. */
    if (plan.remove.txnIds.length && Array.isArray(ctx.txns)) {
      const gone = new Set(plan.remove.txnIds);
      for (let i = ctx.txns.length - 1; i >= 0; i--) if (gone.has(ctx.txns[i].id)) { ctx.txns.splice(i, 1); receipt.removed++; }
    }
    if (plan.remove.statementIds.length && Array.isArray(ctx.statements)) {
      const gone = new Set(plan.remove.statementIds);
      for (let i = ctx.statements.length - 1; i >= 0; i--) if (gone.has(ctx.statements[i].id)) { ctx.statements.splice(i, 1); receipt.statements++; }
    }

    /* ONE line in the audit log for the whole month, not one per row. */
    if (ctx.logAudit) {
      ctx.logAudit('delete', plan.module === 'payments' ? 'payment' : plan.module,
        { id: 'MONTH:' + plan.ym },
        { ref: 'MONTH:' + plan.ym, amount: 0,
          reason: 'Replace month · ' + plan.label + ' · ' + plan.ym + ' · ' + receipt.removed + ' rows'
            + (receipt.unlinkedPayments ? ' · ' + receipt.unlinkedPayments + ' receipts unlinked' : '')
            + (receipt.unlinkedBank ? ' · ' + receipt.unlinkedBank + ' bank lines un-matched' : '')
            + (ctx.reason ? ' · ' + ctx.reason : '') });
    }
    if (ctx.commit) ctx.commit();
    return receipt;
  }

  const api = { applyPlan, verify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLMonthApply = api;
})(typeof window !== 'undefined' ? window : globalThis);
