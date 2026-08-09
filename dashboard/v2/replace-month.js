/* ═══════════════════════════════════════════════════════════════════════
   replace-month.js — "Replace a month" card in Settings.

   The job is never "delete". It is: the wrong file went in, take that month
   out, put the right one in. So the wizard ends at the upload screen, not at
   a success toast.

   WHY IT LOOKS LIKE THIS
   · FOUR SEPARATE BOXES, NO SOURCE DROPDOWN. Source independence has to be
     readable in half a second, before anything is clicked. A dropdown is what
     makes one delete feel like it could hit everything.
   · The STAYS block is bigger than the GOES block, and names the other three
     sources with live counts. plan.sameSource exists for its reassurance line.
   · Not QLShell.confirmDelete. Two disqualifiers, both in the source: its
     desc runs through esc() (shell.js:925) so a preview table would print as
     literal <table> text, and its onSave swallows any exception behind a
     generic toast and closes anyway (shell.js:1003) — a half-finished
     replace must never look like it worked. panel() passes body through
     unescaped (shell.js:977) and openForm honours `return false`.
   · The month is TYPED to confirm, not the word DELETE. The month is the
     variable a mis-click gets wrong; typing DELETE confirms nothing.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const SRC = window.SourcesCore, MA = window.QLMonthApply;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fC = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');
  const nowISO = () => new Date().toISOString();

  /* Assemble the blob EXPLICITLY. QLD.blob() is a whitelist that also drags
     in photos and renames keys; this is the one place that must know exactly
     which live array is which. */
  function liveBlob() {
    const S = window.QLD.state;
    return { sales: S.SALES, purchases: S.PURCHASES, cashbook: S.CASHBOOK,
             reconcile: S.RECON || { txns: [] }, statements: S.STATEMENTS || [] };
  }
  const co = () => (window.QLD.co || {});

  /* Shipped vs held back, and the honest reason for each. Both holds are
     correctness holes in the app, not missing UI — saying so is the point. */
  const READY = {
    sales: { on: true },
    purchase: { on: true },
    payments: { on: false, why: 'Not yet — deleting a receipt would leave its invoice still ticked as paid. ' +
      'receiveSalesPayment writes the payment onto the invoice as well as into the cash book, and there is no reversal for that half yet. ' +
      'Removing the receipts alone would overstate what you have collected.' },
    bank: { on: false, why: 'Not yet — a statement file can cover several months, and its upload record is what stops the same PDF going in twice. ' +
      'Until removing one month can release that record safely, deleting bank lines could lock you out of re-uploading the corrected file.' }
  };

  const MODULE_NOUN = { sales: 'invoice', purchase: 'bill', payments: 'entry', bank: 'line' };
  const ICON = { sales: '🧾', purchase: '📦', payments: '💰', bank: '🏦' };

  /* ── the card ── */
  function render() {
    const host = $('#rmBody'); if (!host) return;
    const B = liveBlob(), sc = SRC.scan(B, null);
    const c = co();
    const box = key => {
      const months = SRC.availableMonths(B, key), s = sc[key], r = READY[key];
      const latest = months[0];
      const sub = months.length
        ? months.length + ' month' + (months.length === 1 ? '' : 's') + ' on file · latest ' +
          window.QLD.monthLabel(latest.ym) + ' (' + latest.count + ')'
        : 'Nothing uploaded yet — nothing to replace';
      return `<div class="rm-box${months.length && r.on ? '' : ' off'}">
        <div class="rm-ico">${ICON[key]}</div>
        <div class="rm-txt"><div class="rm-t">${esc(s.label)}</div><div class="rm-s">${esc(sub)}</div>
          ${!r.on ? `<div class="rm-hold">${esc(r.why)}</div>` : ''}</div>
        ${months.length && r.on ? `<button class="ql-btn ql-btn-secondary rm-go" data-mod="${key}">Replace a month</button>` : ''}
      </div>`;
    };
    host.innerHTML = `
      <div class="rm-firm"><b>${esc(c.short || c.name || 'This firm')}</b>${c.gstin ? ' · GSTIN ' + esc(c.gstin) : ''}
        <span>Every other company keeps its own separate book — nothing on this card can reach them.</span></div>
      ${SRC.MODULES.map(box).join('')}`;
    host.querySelectorAll('.rm-go').forEach(b => b.onclick = () => pickMonth(b.dataset.mod));
  }

  /* ── step 1 · pick the month (computes nothing destructive) ── */
  function pickMonth(mod) {
    const B = liveBlob(), months = SRC.availableMonths(B, mod), sc = SRC.scan(B, null);
    const others = SRC.MODULES.filter(k => k !== mod)
      .map(k => `${esc(sc[k].label)} <b>${sc[k].count}</b>`).join(' · ');
    QLShell.panel({
      title: 'Replace a month of ' + sc[mod].label,
      sub: (co().short || '') + ' · this touches the ' + sc[mod].label + ' register only',
      body: `<div class="rm-pick">
        <p>Which month went in wrong?</p>
        <div class="rm-months">${months.map(m =>
          `<button class="rm-m" data-ym="${m.ym}">${esc(window.QLD.monthLabel(m.ym))}<span>${m.count} ${MODULE_NOUN[mod]}${m.count === 1 ? '' : 's'}</span></button>`).join('')}</div>
        <div class="rm-safe">Not touched by this: ${others}</div>
      </div>`,
      onMount(el) { el.querySelectorAll('.rm-m').forEach(b => b.onclick = () => preview(mod, b.dataset.ym)); }
    });
  }

  /* ── step 2 · the preview: what goes, what stays, what merely changes ── */
  function preview(mod, ym) {
    const B = liveBlob();
    if (!/^\d{4}-\d{2}$/.test(ym)) { QLShell.toast('Pick a single month'); return; }
    const plan = SRC.deletePlan(B, mod, ym), sc = SRC.scan(B, null);
    const label = window.QLD.monthLabel(ym);
    const rows = mod === 'sales' ? plan.remove.sales.map(i => B.sales[i])
      : mod === 'purchase' ? plan.remove.purchases.map(i => B.purchases[i]) : [];
    const money = rows.reduce((a, r) => a + (mod === 'sales'
      ? (+r.taxable || (+r.qty || 0) * (+r.rate || 0)) : (+r.taxable || 0)), 0);
    const ref = r => mod === 'sales' ? r.inv : r.bill;
    const party = r => mod === 'sales' ? r.party : (r.sup || r.name);

    const goes = `<div class="rm-blk goes"><h4>Goes — ${rows.length} ${MODULE_NOUN[mod]}${rows.length === 1 ? '' : 's'} · ${fC(money)}</h4>
      <div class="rm-list">${rows.slice(0, 40).map(r =>
        `<div><span>${esc(ref(r) || '—')}</span><span>${esc(r.date)}</span><span>${esc(party(r) || '—')}</span><span>${fC(mod === 'sales' ? (+r.taxable || (+r.qty || 0) * (+r.rate || 0)) : r.taxable)}</span></div>`).join('')}
      ${rows.length > 40 ? `<div class="rm-more">+ ${rows.length - 40} more</div>` : ''}</div>
      <p class="rm-note">They move to Trash — restorable from Data Management, just below.</p></div>`;

    const stays = `<div class="rm-blk stays"><h4>Stays — nothing else is touched</h4>
      <table class="rm-tbl">
        ${SRC.MODULES.filter(k => k !== mod).map(k =>
          `<tr><td>${esc(sc[k].label)}</td><td><b>all ${sc[k].count} stay</b></td><td class="rm-zero">0 deleted</td></tr>`).join('')}
        <tr><td>${esc(sc[mod].label)} · every other month</td><td><b>all ${plan.sameSource.rows} stay</b></td><td class="rm-zero">${plan.sameSource.months} other month${plan.sameSource.months === 1 ? '' : 's'}</td></tr>
        <tr><td>Customers &amp; suppliers</td><td><b>all stay</b></td><td class="rm-zero">0 deleted</td></tr>
      </table></div>`;

    const un = plan.unlink.cashbook, bank = plan.unlink.recon;
    const changes = (un.length || bank.length) ? `<div class="rm-blk changes">
      <h4>YOUR MONEY IS NOT DELETED</h4>
      <p>${un.length ? `${un.length} receipt${un.length === 1 ? '' : 's'} in your cash book ${un.length === 1 ? 'was' : 'were'} ticked against ${un.length === 1 ? 'one of these bills' : 'these bills'}. The money stays exactly where it is — not reduced, not moved, not deleted. Only the tick that said "this money belongs to that bill" is removed, so you can tick it against the corrected bill afterwards.` : ''}</p>
      ${un.length ? `<div class="rm-list">${un.map(u =>
        `<div><span>${esc(u.date)}</span><span>${fC(u.amount)} received</span><span class="rm-arrow">→ stays in cash book, no longer ticked</span></div>`).join('')}</div>` : ''}
      ${bank.length ? `<p>${bank.length} bank line${bank.length === 1 ? '' : 's'} go back to <b>To review</b> so you can match ${bank.length === 1 ? 'it' : 'them'} again. The lines themselves are untouched — they are what the bank told you.</p>` : ''}
      ${bank.some(x => x.posted) ? `<p class="rm-warn">⚠ A payment was already posted from ${bank.filter(x => x.posted).length} of those bank lines. That payment stays in your cash book and can never be posted twice.</p>` : ''}
    </div>` : `<div class="rm-blk changes"><h4>YOUR MONEY IS NOT DELETED</h4>
      <p>No receipt or bank line is ticked against this month, so nothing in your cash book changes at all.</p></div>`;

    QLShell.panel({
      wide: true,
      title: label + ' · ' + sc[mod].label + ' — exactly what happens',
      sub: co().short || '',
      body: goes + stays + changes + (plan.warnings.length
        ? `<div class="rm-blk"><h4>Also worth knowing</h4>${plan.warnings.map(w => `<p class="rm-warn">${esc(w)}</p>`).join('')}</div>` : ''),
      actions: [
        { label: '← Back', onClick: () => pickMonth(mod) },
        { label: rows.length ? 'Continue — replace ' + label : 'Nothing to replace',
          primary: true, onClick: () => { if (rows.length) gate(mod, ym, plan, rows.length, money); } }
      ]
    });
  }

  /* ── step 3 · the gate ── */
  function gate(mod, ym, plan, n, money) {
    const label = window.QLD.monthLabel(ym);
    const firmAtStart = window.QLD.activeCo;
    const sc = SRC.scan(liveBlob(), null);
    QLShell.openForm({
      title: 'Replace ' + label,
      sub: (co().short || '') + ' · ' + sc[mod].label,
      note: `<b>${n} ${MODULE_NOUN[mod]}${n === 1 ? '' : 's'} · ${fC(money)}</b> move to Trash.
        ${plan.unlink.cashbook.length ? `<b>${plan.unlink.cashbook.length}</b> receipt(s) stay in your cash book, un-ticked. ` : ''}
        ${plan.unlink.recon.length ? `<b>${plan.unlink.recon.length}</b> bank line(s) go back to To review. ` : ''}
        Nothing in ${SRC.MODULES.filter(k => k !== mod).map(k => sc[k].label).join(', ')} changes.`,
      specs: [
        { k: 'confirm', label: 'Type ' + label.toUpperCase() + ' to confirm', full: true, upper: true, ph: label.toUpperCase() },
        { k: 'reason', label: 'Why are you replacing it? (optional)', full: true, ph: 'e.g. uploaded the wrong folder' }
      ],
      saveLabel: 'Remove ' + label + ' · ' + sc[mod].label,
      onSave(v) {
        if (String(v.confirm || '').trim().toUpperCase() !== label.toUpperCase()) {
          QLShell.toast('That is not the month you picked. You picked ' + label, 'err'); return false;
        }
        if (window.QLD.activeCo !== firmAtStart) {
          QLShell.toast('You switched company while this was open — nothing was changed', 'err'); return false;
        }
        /* Re-derive against the book as it is RIGHT NOW. The plan holds raw
           indices; an import or a second tab landing since the preview would
           make them point at different rows. */
        const B = liveBlob(), chk = MA.verify(plan, B);
        if (!chk.ok) {
          QLShell.toast('The book changed while this was open — reopening with fresh numbers', 'err');
          setTimeout(() => preview(mod, ym), 300); return false;
        }
        const S = window.QLD.state;
        const receipt = MA.applyPlan(chk.fresh, {
          sales: S.SALES, purchases: S.PURCHASES, cashbook: S.CASHBOOK,
          txns: (S.RECON || {}).txns || [], statements: S.STATEMENTS || [],
          at: nowISO(), reason: v.reason || '',
          who: { by: (window.QLD.co || {}).short || '', role: 'owner' },
          logAudit: (a, m, r, meta) => window.QLD.logAudit(a, m, r, meta),
          commit: () => { try { window.QLD.saveRecon(); } catch (_) {} }
        });
        done(mod, ym, receipt);
        return false;                       // we replace the modal ourselves
      }
    });
  }

  /* ── step 4 · the receipt, which is also the next step ── */
  function done(mod, ym, r) {
    const label = window.QLD.monthLabel(ym);
    const sc = SRC.scan(liveBlob(), null);
    const dest = mod === 'sales' ? './sales.html?upload=1' : './purchase.html?upload=1';
    QLShell.panel({
      title: label + ' is now empty in ' + sc[mod].label,
      sub: co().short || '',
      body: `<div class="rm-done">
        <div>✓ <b>${r.removed}</b> ${MODULE_NOUN[mod]}${r.removed === 1 ? '' : 's'} moved to Trash — restore any of them from Data Management, just below.</div>
        ${r.unlinkedPayments ? `<div>✓ <b>${r.unlinkedPayments}</b> receipt${r.unlinkedPayments === 1 ? '' : 's'} (${fC(r.money.unlinked)}) kept in your cash book, now waiting to be ticked again.</div>` : ''}
        ${r.unlinkedBank ? `<div>✓ <b>${r.unlinkedBank}</b> bank line${r.unlinkedBank === 1 ? '' : 's'} back in To review.</div>` : ''}
        ${r.postedKept ? `<div>✓ <b>${r.postedKept}</b> already-posted payment${r.postedKept === 1 ? '' : 's'} left alone — it can never be posted twice.</div>` : ''}
        <div>✓ ${SRC.MODULES.filter(k => k !== mod).map(k => sc[k].label).join(', ')} and every party — untouched.</div>
        <p class="rm-next">Now put the corrected file in.</p>
      </div>`,
      actions: [
        { label: "I'll upload later", onClick: () => { QLShell.closeModal(); render(); } },
        { label: 'Upload the corrected ' + label + ' file', primary: true, onClick: () => { location.href = dest; } }
      ]
    });
  }

  window.QLReplaceMonth = { render };
})();
