/* dedupe-ui.js — "Find duplicates": show first, remove on the user's word.
 *
 * Compare first, write last — the same shape as the Tally ledger import, and for
 * the same reason: this screen proposes deleting rows the user already has, so it
 * must never act on its own. It lists what it found, what it will KEEP, and what
 * it will remove, and removes nothing until the button is pressed.
 *
 * Entry point: QLDedupe.open(). Wire it to a button; it needs nothing else.
 */
(function () {
  'use strict';
  var Q = window.QLD;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var fC = function (n) { return Q.fC(n); };
  var fDS = function (d) { return Q.fDS(d); };

  function txnAmt(t) { return (+t.credit || 0) + (+t.debit || 0); }

  function scanNow() {
    return Dedupe.scan({
      txns: (Q.recon && Q.recon.txns) || [],
      sales: Q.state.SALES || [],
      purchases: Q.state.PURCHASES || []
    });
  }

  /* One group = one real thing that got entered more than once. Showing the KEEP
     row explicitly matters: "remove 2 duplicates" is only trustworthy if the user
     can see which one stays and that it is the reconciled/paid one. */
  function groupHTML(g, render) {
    var keep = render(g.keep.row);
    var dupes = g.dupes.map(function (e) { return render(e.row); });
    return '<div class="dd-g">' +
      '<div class="dd-keep"><span class="dd-tag dd-tag-keep">Keeping</span>' + keep + '</div>' +
      dupes.map(function (d) { return '<div class="dd-dup"><span class="dd-tag dd-tag-rm">Removing</span>' + d + '</div>'; }).join('') +
      '</div>';
  }

  function txnRender(t) {
    var work = Dedupe.txnWork(t);
    var badge = work === 2 ? '<span class="dd-work">reconciled</span>' : '';
    return '<b>' + fC(txnAmt(t)) + '</b> · ' + esc(fDS(t.date)) + ' · ' + esc((t.clean || t.desc || '').slice(0, 44)) +
      (t.utr || t.ref ? ' <span class="dd-ref">' + esc(t.utr || t.ref) + '</span>' : '') + badge;
  }
  function saleRender(d) {
    return '<b>' + fC(+d.total || 0) + '</b> · ' + esc(d.inv || '') + ' · ' + esc(d.party || '') +
      ((+d.paid || 0) > 0 ? '<span class="dd-work">has payments</span>' : '');
  }
  function billRender(d) {
    return '<b>' + fC(+d.total || 0) + '</b> · ' + esc(d.bill || '') + ' · ' + esc(d.sup || '') +
      ((+d.paid || 0) > 0 ? '<span class="dd-work">has payments</span>' : '');
  }

  function sectionHTML(title, groups, render) {
    if (!groups.length) return '';
    var n = groups.reduce(function (a, g) { return a + g.dupes.length; }, 0);
    return '<div class="dd-sec"><div class="dd-sec-h">' + esc(title) + ' · <b>' + n + '</b> to remove</div>' +
      groups.map(function (g) { return groupHTML(g, render); }).join('') + '</div>';
  }

  function css() {
    if (document.getElementById('ddCSS')) return;
    var s = document.createElement('style'); s.id = 'ddCSS';
    s.textContent = [
      '.dd-sec{margin-bottom:18px}',
      '.dd-sec-h{font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.04em;color:var(--ql-text-muted,#64748b);margin:0 0 8px}',
      '.dd-g{border:1px solid var(--ql-border,#e2e8f0);border-radius:10px;padding:8px 10px;margin-bottom:8px;background:var(--ql-card,#fff)}',
      '.dd-keep,.dd-dup{font-size:13px;padding:4px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dd-dup{color:var(--ql-text-muted,#64748b);text-decoration:line-through}',
      '.dd-tag{font-size:10px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:5px;text-decoration:none;flex:none}',
      '.dd-tag-keep{background:#dcfce7;color:#166534}.dd-tag-rm{background:#fee2e2;color:#991b1b}',
      '.dd-ref{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--ql-text-muted,#64748b)}',
      '.dd-work{font-size:10.5px;background:var(--ql-neutral-100);color:var(--ql-text-muted,#64748b);padding:1px 5px;border-radius:4px;text-decoration:none}',
      '.dd-none{padding:22px;text-align:center;color:var(--ql-text-muted,#64748b);font-size:13.5px}',
      '.dd-note{font-size:12px;color:var(--ql-text-muted,#64748b);margin-top:10px;line-height:1.5}'
    ].join('');
    document.head.appendChild(s);
  }

  function open() {
    css();
    var s = scanNow();
    if (!s.total) {
      QLShell.panel({
        title: 'Find duplicates', sub: 'Bank rows, invoices and bills',
        body: '<div class="dd-none">No duplicates found.<br><span style="font-size:12.5px">Nothing is entered twice under the same reference or invoice number.</span></div>',
        actions: [{ label: 'Close' }]
      });
      return;
    }

    var body = sectionHTML('Bank transactions', s.txns, txnRender)
      + sectionHTML('Sales invoices', s.sales, saleRender)
      + sectionHTML('Purchase bills', s.purchases, billRender)
      /* Say plainly what is NOT here. A cleanup screen that looks exhaustive but
         quietly skips a class of duplicate is worse than one that admits its
         limits — the user would assume the books are clean. */
      + '<div class="dd-note">Only <b>certain</b> duplicates are listed: the same UTR/cheque reference, or the same invoice number from the same firm. '
      + 'Two payments of the same amount from one customer on one day with <b>no reference</b> are not listed — those can be genuine, and deleting one would lose real money.<br>'
      + 'Invoices and bills go to <b>Trash</b> and can be restored. Bank rows are removed outright — but only the extra copies; the original stays.</div>';

    QLShell.panel({
      title: 'Find duplicates', wide: true,
      sub: s.total + ' duplicate ' + (s.total === 1 ? 'row' : 'rows') + ' found · nothing is removed until you choose',
      body: body,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Remove ' + s.total + ' duplicate' + (s.total === 1 ? '' : 's'), primary: true,
          onClick: function () { return apply(s); }
        }
      ]
    });
  }

  /* Re-scan is deliberate: the panel's `s` was computed when it opened, and an
     index captured then could point at a different row by now (another tab, an
     import). Deleting by a stale index is how a cleanup removes the wrong bill. */
  function apply() {
    var s = scanNow();
    var reason = 'Duplicate — removed via Find duplicates';
    var n = 0;

    var ids = [];
    s.txns.forEach(function (g) { g.dupes.forEach(function (e) { if (e.row.id) ids.push(e.row.id); }); });
    if (ids.length && Q.removeReconTxns) n += (Q.removeReconTxns(ids, reason).removed || 0);

    /* Delete by INDEX, highest first. softDelete only sets a flag so indices do not
       shift — but scanDocs already skipped _del rows, so a re-run is idempotent. */
    var byIdxDesc = function (a, b) { return b - a; };
    s.sales.map(function (g) { return g.dupes.map(function (e) { return e.i; }); }).reduce(function (a, b) { return a.concat(b); }, [])
      .sort(byIdxDesc).forEach(function (i) { if (Q.deleteSale(i, reason).ok) n++; });
    s.purchases.map(function (g) { return g.dupes.map(function (e) { return e.i; }); }).reduce(function (a, b) { return a.concat(b); }, [])
      .sort(byIdxDesc).forEach(function (i) { if (Q.deletePurchase(i, reason).ok) n++; });

    QLShell.toast('Removed ' + n + ' duplicate' + (n === 1 ? '' : 's'), 'ok');
    setTimeout(function () { location.reload(); }, 600);
  }

  // apply is exported so the REMOVAL path is testable end-to-end. It deletes real
  // bills; a test that stops at the engine would never see a wrong index.
  window.QLDedupe = { open: open, scanNow: scanNow, apply: apply };
})();
