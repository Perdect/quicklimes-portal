/* ═══════════════════════════════════════════════════════════════════════
   ledger-import.js — "Import ledger from Tally" on a party.

   COMPARE FIRST, WRITE LAST. That ordering is the whole design.

   recordLedgerEntry() also posts a row to the CASHBOOK. So blind-importing a
   supplier's ledger would duplicate every payment already recorded from the bank
   statement — and the bank matcher would then find two candidates for one line.
   The register would look reconciled and be inflated. So this screen never
   writes what it reads: it reads, ties the file to its own printed totals,
   compares it against our books, and shows the difference. Only what the user
   ticks is written.

   The prize is step 3. A supplier ledger is a BALANCE CONFIRMATION — the thing
   normally reconciled by hand once a year. It answers "do we agree on
   ₹9,44,633?" and, when we don't, names the entry that explains it.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var Q = window.QLD, fC = Q.fC, fDS = function (d) { return Q.fDS(d); };
  var esc = function (s) { return (s == null ? '' : s).toString().replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var toast = function (m, t) { try { QLShell.toast(m, t); } catch (_) {} };

  /* What OUR books hold for this party, in the shape reconcile() compares:
     credit = a bill he raised on us · debit = money we paid him.
     Sales bills and receipts are included too — a party can be both — so the
     comparison never silently ignores half the relationship. */
  function ours(idx) {
    var p = Q.partyRows()[idx]; if (!p) return [];
    var name = (p.name || '').toUpperCase(), out = [];
    (Q.purchaseRows() || []).forEach(function (b) {
      if ((b.sup || '').toUpperCase() !== name || b.status === 'cancelled') return;
      out.push({ date: b.date, amount: b.total, dir: 'credit', ref: b.bill || '', src: 'purchase bill' });
      (b.payments || []).forEach(function (pay) { out.push({ date: pay.date, amount: +pay.amount || 0, dir: 'debit', ref: b.bill || '', src: 'payment on ' + (b.bill || 'bill') }); });
    });
    (Q.salesRows() || []).forEach(function (s) {
      if ((s.party || '').toUpperCase() !== name || s.status === 'cancelled') return;
      out.push({ date: s.date, amount: s.total, dir: 'debit', ref: s.inv || '', src: 'sales invoice' });
    });
    ((p.ledger || (Q.state.PARTIES[idx] || {}).ledger) || []).forEach(function (l) {
      out.push({ date: l.date, amount: (+l.dr || 0) || (+l.cr || 0), dir: (+l.dr || 0) > 0 ? 'debit' : 'credit', ref: l.ref || '', src: 'on-account entry' });
    });
    return out;
  }

  /* `file` is optional: without it the native picker opens (the real button),
     with it the same path runs headlessly. That is not a test hook bolted on —
     it is the only way to drive this screen end to end without a human clicking
     a file dialog, and a screen that writes to the books deserves to be driven
     end to end before it ships. */
  function open(idx, file) {
    var p = Q.partyRows()[idx]; if (!p) return;
    if (file) return read(idx, file);
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.pdf,application/pdf';
    inp.onchange = function () { var f = inp.files && inp.files[0]; if (f) read(idx, f); };
    inp.click();
  }

  async function read(idx, file) {
    var p = Q.partyRows()[idx];
    QLShell.panel({ title: 'Reading ledger…', sub: file.name, body: '<div class="pb-empty"><div class="pb-empty-t">Reading the file…</div><div class="pb-empty-s">Checking it against the totals printed on the page before anything is written.</div></div>' });
    var text = '';
    try {
      var pages = await QLFin.pdfPages(file);
      text = Array.isArray(pages) ? pages.join('\n') : String(pages);
    } catch (e) { return fail('That file could not be read as a PDF.', e && e.message); }
    if (!text || text.length < 60) return fail('No text could be read from that PDF.', 'It may be a scan — a Tally ledger must be exported as a PDF, not photographed.');

    var P;
    try { P = LedgerCore.parse(text); } catch (e) { return fail('That file could not be read as a ledger.', e && e.message); }
    show(idx, P, file.name);
  }
  function fail(t, s) {
    QLShell.panel({ title: 'Could not read it', body: '<div class="pb-empty"><div class="pb-empty-t">' + esc(t) + '</div><div class="pb-empty-s">' + esc(s || '') + '</div></div>' });
  }

  function show(idx, P, fname) {
    var p = Q.partyRows()[idx];
    var R = LedgerCore.reconcile(P, ours(idx));
    var rh = LedgerCore.rhythm(P);
    var nameMatch = norm(P.party) && norm(p.name) && (norm(P.party).indexOf(norm(p.name)) >= 0 || norm(p.name).indexOf(norm(P.party)) >= 0);

    /* THE GATE. A ledger that does not tie to its own printed totals is not
       imported at all — not partially, not "with warnings". A half-read ledger
       posted into the books would look like a reconciliation and be a
       fabrication. */
    if (!P.check.ok) {
      QLShell.panel({
        title: 'This ledger does not add up', sub: fname,
        body: '<div class="pb-card" style="border-color:var(--ql-danger-500)">' +
          '<div class="pb-card-h">Nothing has been imported</div>' +
          '<div class="qx-mut" style="font-size:12.5px;line-height:1.6">The figures read from the page do not agree with the totals Tally printed on it. Rather than import a partial ledger, nothing was written.</div>' +
          '<ul style="margin:10px 0 0;padding-left:18px;font-size:12.5px;line-height:1.7">' + P.check.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>' +
          '<div class="qx-mut" style="font-size:11.5px">Read: ' + P.check.count + ' rows · opening ' + fC(P.opening) + ' ' + P.openingType + ' · closing ' + fC(P.closing) + ' ' + P.closingType + '</div>',
        actions: [{ label: 'Close', onClick: function () { QLShell.closeModal(); } }]
      });
      return;
    }

    var theirs = P.closingType === 'Cr' ? P.closing : -P.closing;     // + = we owe him
    var mineNet = Q.ledgerNet ? 0 : 0;
    var oursBal = balanceOf(idx);
    var gap = round2(theirs - oursBal);

    var row = function (l, v, cls) { return '<div class="pb-row"><span>' + l + '</span><b' + (cls ? ' style="color:' + cls + '"' : '') + '>' + v + '</b></div>'; };
    var list = function (arr, kind) {
      if (!arr.length) return '<div class="qx-mut" style="font-size:12px;padding:6px 0">None.</div>';
      return arr.slice(0, 40).map(function (e, i) {
        var d = e.date || e.ledger && e.ledger.date;
        return '<label class="lgi-row"><input type="checkbox" ' + (kind === 'ledger' ? 'data-imp="' + i + '" checked' : 'disabled') + '>' +
          '<span class="lgi-d">' + esc(fDS(d)) + '</span>' +
          '<span class="lgi-t">' + esc(e.desc || e.src || '') + (e.vch ? ' · vch ' + esc(e.vch) : '') + '</span>' +
          '<b class="lgi-a ' + (e.dir === 'credit' ? 'lgi-cr' : 'lgi-dr') + '">' + (e.dir === 'credit' ? '+' : '−') + fC(e.amount) + '</b></label>';
      }).join('');
    };

    QLShell.panel({
      // NOT esc()'d: QLShell.panel escapes title and sub itself, and escaping
      // twice renders the ampersand in "Ram Karan & Sons" as "&amp;" on screen.
      title: 'Ledger from ' + (P.party || 'Tally'), sub: fname + ' · ' + P.from + ' → ' + P.to,
      wide: true,
      body:
        (!nameMatch ? '<div class="pb-card" style="border-color:var(--ql-warning-500)"><div class="pb-card-h">Check the party</div><div class="qx-mut" style="font-size:12.5px">This ledger is headed <b>' + esc(P.party) + '</b> but you opened <b>' + esc(p.name) + '</b>. Import only if they are the same account.</div></div>' : '') +

        '<div class="pb-card"><div class="pb-card-h">The file ties to its own totals ✓</div>' +
          row('Opening (' + esc(P.from) + ')', fC(P.opening) + ' ' + P.openingType) +
          row('His bills · ' + P.entries.filter(function (e) { return e.dir === 'credit'; }).length, '+' + fC(P.check.credits)) +
          row('Our payments · ' + P.entries.filter(function (e) { return e.dir === 'debit'; }).length, '−' + fC(P.check.debits)) +
          '<div class="pb-row pb-row-tot"><span>Closing — what HE says we owe</span><b>' + fC(P.closing) + ' ' + P.closingType + '</b></div></div>' +

        '<div class="pb-card"><div class="pb-card-h">His answer vs ours</div>' +
          row('He says we owe', fC(Math.abs(theirs))) +
          row('Our books say', fC(Math.abs(oursBal))) +
          '<div class="pb-row pb-row-tot"><span>Difference</span><b style="color:' + (Math.abs(gap) < 1 ? 'var(--ql-success-600)' : 'var(--ql-danger-600)') + '">' + (Math.abs(gap) < 1 ? 'Agreed ✓' : fC(Math.abs(gap))) + '</b></div>' +
          (Math.abs(gap) >= 1 ? '<div class="qx-mut" style="font-size:11.5px;margin-top:8px">The entries below explain the difference.</div>' : '') +
        '</div>' +

        '<div class="pb-card"><div class="pb-card-h">In his ledger, not in ours · ' + R.onlyLedger.length + '<span class="pb-h-act"><button class="pb-ask" id="lgiAll">Select all</button><button class="pb-ask" id="lgiNone">None</button></span></div>' +
          '<div class="qx-mut" style="font-size:11.5px;margin-bottom:8px">Tick what to add to this party\'s running account. Payments post to the cashbook — leave a row unticked if it is already there under another name.</div>' +
          list(R.onlyLedger, 'ledger') + '</div>' +

        '<div class="pb-card"><div class="pb-card-h">In our books, not in his · ' + R.onlyOurs.length + '</div>' +
          '<div class="qx-mut" style="font-size:11.5px;margin-bottom:8px">Nothing is written for these — they are for you to query with him.</div>' +
          list(R.onlyOurs, 'ours') + '</div>' +

        '<div class="pb-card"><div class="pb-card-h">Matched · ' + R.both.length + '</div>' +
          '<div class="qx-mut" style="font-size:12px">' + R.both.length + ' entries appear in both and are left alone.</div></div>' +

        '<div class="pb-ai"><div class="pb-card-h" style="margin-bottom:6px">What his ledger shows</div>' +
          '<div class="pb-ins"><span>' + (rh.consolidatedMonthly
            ? 'He bills once a month (' + rh.months + ' months, median ' + fC(rh.medianBill) + ') and you pay him about ' + rh.payPerBill + ' times per bill — this is a running credit account, not invoice-by-invoice.'
            : rh.bills + ' bills across ' + rh.months + ' months.') + '</span></div></div>',
      actions: [
        { label: 'Cancel', onClick: function () { QLShell.closeModal(); } },
        { label: 'Set opening balance only', onClick: function () { writeOpening(idx, P); } },
        { label: 'Import ticked entries', primary: true, onClick: function () { writeTicked(idx, P, R); } }
      ],
      onMount: function (body) {
        var b1 = body.querySelector('#lgiAll'), b0 = body.querySelector('#lgiNone');
        var boxes = function () { return body.querySelectorAll('[data-imp]'); };
        if (b1) b1.onclick = function () { boxes().forEach(function (b) { b.checked = true; }); };
        if (b0) b0.onclick = function () { boxes().forEach(function (b) { b.checked = false; }); };
        window.__lgiBody = body;
      }
    });
  }

  /* The opening balance is a FIELD, not a transaction — setting it posts nothing
     to the cashbook and can be done on its own. For a party we have never
     tracked, this one number plus the existing bills is often the whole job. */
  function writeOpening(idx, P) {
    var rec = Q.state.PARTIES[idx]; if (!rec) return;
    rec.opening = P.openingType === 'Cr' ? -P.opening : P.opening;   // − = we owe them (party rows: + = they owe us)
    Q.commit();
    toast('Opening balance set to ' + fC(P.opening) + ' ' + P.openingType, 'ok');
    QLShell.closeModal();
    try { QLX.refresh(); QLX.open(idx); } catch (_) {}
  }

  function writeTicked(idx, P, R) {
    var body = window.__lgiBody; if (!body) return;
    var picked = [];
    body.querySelectorAll('[data-imp]').forEach(function (b) { if (b.checked) picked.push(R.onlyLedger[+b.dataset.imp]); });
    if (!picked.length) return toast('Nothing ticked — nothing imported.', 'warn');
    confirmWrite(idx, P, picked);
  }
  function confirmWrite(idx, P, picked) {
    var cr = picked.filter(function (e) { return e.dir === 'credit'; }).length;
    var dr = picked.filter(function (e) { return e.dir === 'debit'; }).length;
    QLShell.panel({
      title: 'Import ' + picked.length + ' entr' + (picked.length === 1 ? 'y' : 'ies') + '?',
      body: '<div class="pb-card"><div class="qx-mut" style="font-size:12.5px;line-height:1.7">' +
        '<b>' + dr + ' payment' + (dr === 1 ? '' : 's') + '</b> will be recorded against this party <b>and posted to the cashbook</b>. If any of them is already in your cashbook from the bank statement, it will be counted twice — go back and untick it.<br><br>' +
        '<b>' + cr + ' bill' + (cr === 1 ? '' : 's') + '</b> will be added to the running account. They will NOT create purchase bills or GST entries — this is his statement, not his invoices.' +
        '</div></div>',
      actions: [
        { label: 'Back', onClick: function () { QLShell.closeModal(); } },
        { label: 'Import', primary: true, onClick: function () { commitEntries(idx, P, picked); } }
      ]
    });
  }
  function commitEntries(idx, P, picked) {
    var n = 0;
    picked.forEach(function (e) {
      var r = Q.recordLedgerEntry(idx, {
        date: e.date, desc: e.desc + ' · from Tally ledger', ref: e.vch ? 'vch ' + e.vch : '',
        mode: 'Bank', kind: 'ledger-import',
        dr: e.dir === 'debit' ? e.amount : 0,
        cr: e.dir === 'credit' ? e.amount : 0
      });
      if (r) n++;
    });
    toast('Imported ' + n + ' entr' + (n === 1 ? 'y' : 'ies') + ' from the ledger', 'ok');
    QLShell.closeModal();
    try { QLX.refresh(); QLX.open(idx); } catch (_) {}
  }

  /* What OUR books say this party's balance is. + = we owe them. */
  function balanceOf(idx) {
    var p = Q.partyRows()[idx]; if (!p) return 0;
    // partyRows.currentBalance: + = they owe us. Flip it: this screen talks in
    // "what we owe him", because that is what a supplier's ledger states.
    return round2(-(+p.currentBalance || 0));
  }
  function round2(n) { return Math.round(n * 100) / 100; }
  function norm(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  window.LedgerImport = { open: open, ours: ours, balanceOf: balanceOf };
})();
