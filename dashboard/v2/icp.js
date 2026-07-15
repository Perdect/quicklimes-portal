/* ═══════════════════════════════════════════════════════════════════════
   icp.js — Sales Intelligence panel.  QLICP.open()

   Renders two questions off your own invoices:
     1. WHO DO I CALL TODAY?  — customers past their own reorder rhythm
     2. WHICH MARKET PAYS?    — industries ranked by margin, not turnover

   All maths lives in icp-core.js (pure, 79 tests). This only renders, and it
   is careful about one thing above all: a GUESS IS SHOWN AS A GUESS. An
   industry inferred from a company name is labelled and one tap confirms it.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var Q = window.QLD, C = window.ICPCore;
  var esc = function (s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var toast = function (m, t) { (window.QLX && QLX.toast) ? QLX.toast(m, t) : 0; };
  var money = function (n) { return (n == null || !isFinite(n)) ? '—' : '₹' + Math.round(n).toLocaleString('en-IN'); };
  var S = { tab: 'call' };

  function costPerTonne() {
    try {
      var pl = Q.getPL ? Q.getPL() : null;
      var tonnes = Q.salesRows().filter(function (s) { return s.status !== 'cancelled'; })
        .reduce(function (a, s) { return a + (+s.qty || 0); }, 0);
      return C.costPerTonne(pl, tonnes);
    } catch (_) { return null; }
  }
  function board() { return C.reorderBoard({ sales: Q.salesRows(), parties: Q.partyRows() }); }
  function icp() { return C.icpByIndustry({ sales: Q.salesRows(), parties: Q.partyRows(), costPerTonne: costPerTonne() }); }

  var TONE = { overdue: '#dc2626', due: '#c2410c', dormant: '#7c3aed', ontrack: '#15803d', unknown: '#8a827b' };
  var LABEL = { overdue: 'Overdue', due: 'Due now', dormant: 'Likely lost', ontrack: 'On track', unknown: 'Not enough history' };

  function confirmIndustry(partyName, key) {
    var p = (Q.state.PARTIES || []).filter(function (x) { return (x.name || '').toUpperCase() === partyName.toUpperCase(); })[0];
    if (!p) { toast('Party not found', 'err'); return; }
    p.industry = key; Q.commit();
    toast(partyName + ' confirmed as ' + C.industryLabel(key));
    render();
  }

  function callRow(r) {
    var t = TONE[r.status], guess = r.industryGuessed && r.industryKey;
    return '<div class="icp-row">' +
      '<div class="icp-main">' +
        '<div class="icp-top"><b>' + esc(r.party) + '</b>' +
          '<span class="icp-chip" style="color:' + t + ';border-color:' + t + '33">' + LABEL[r.status] + '</span>' +
          (r.industryKey
            ? '<span class="icp-chip' + (guess ? ' icp-guess' : '') + '" ' + (guess ? 'title="Guessed from the company name — confirm it"' : '') + '>' +
                esc(r.industry) + (guess ? ' · guess?' : '') + '</span>'
            : '<span class="icp-chip icp-guess">Industry not set</span>') +
        '</div>' +
        '<div class="icp-sub">' + esc(r.why) + '</div>' +
        '<div class="icp-facts">' +
          (r.medianDays ? '<span>orders every <b>' + Math.round(r.medianDays) + 'd</b></span>' : '') +
          (r.medianTonnes ? '<span>usually <b>' + (Math.round(r.medianTonnes * 10) / 10) + ' T</b></span>' : '') +
          (r.lastDate ? '<span>last <b>' + esc(Q.fDS(r.lastDate)) + '</b></span>' : '') +
          (r.expectedValue ? '<span>next order ≈ <b>' + money(r.expectedValue) + '</b></span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="icp-act">' +
        (guess ? '<button class="ql-btn ql-btn-secondary" data-conf="' + esc(r.party) + '|' + esc(r.industryKey) + '">Yes, ' + esc(r.industry) + '</button>' : '') +
        (r.phone ? '<a class="ql-btn ql-btn-primary" target="_blank" href="' + waHref(r) + '">WhatsApp</a>' : '') +
      '</div>' +
    '</div>';
  }
  // A reorder nudge is NOT a dunning message — it goes to a customer who is
  // already yours and is late ordering, not late paying. Different message,
  // different tone.
  function waHref(r) {
    var msg = 'Dear ' + r.party + ',\nHope you are well. You usually take about ' +
      (r.medianTonnes ? (Math.round(r.medianTonnes * 10) / 10) + ' T' : 'a load') +
      ' around this time. Shall we plan your next dispatch?\nThank you.';
    /* The fallback used to paste the raw digits straight into wa.me with NO
       country code at all — the worst of the copies. If wa-core is missing we
       open WhatsApp with no recipient and let the human choose, rather than
       dial a number we have not normalised. */
    return window.WACore ? WACore.waLink(r.phone, msg)
      : 'https://wa.me/?text=' + encodeURIComponent(msg);
  }

  function marketHTML() {
    var rows = icp(), cpt = costPerTonne();
    if (!rows.length) return '<div class="icp-empty">No sales yet — this fills in as you invoice.</div>';
    var unconfirmed = rows.reduce(function (a, r) { return a + (r.confirmedPct < 100 ? 1 : 0); }, 0);
    var best = rows[0];
    return (cpt === null
      ? '<div class="icp-note icp-warn">Margin needs your costs. Once purchases and labour are recorded, this ranks markets by <b>what you actually earn</b> instead of turnover — which is the whole point.</div>'
      : '<div class="icp-note">Cost is a plant average of <b>' + money(cpt) + '/tonne</b> (one kiln, one product). What varies by customer is the <b>price</b> — that is the lever.</div>') +
    (unconfirmed ? '<div class="icp-note icp-warn">' + unconfirmed + ' row(s) are built partly from <b>industry guesses</b>. Confirm them on the “Who to call” tab and these numbers get sharper.</div>' : '') +
    '<div class="icp-scroll"><table class="icp-t"><thead><tr>' +
      '<th>Industry</th><th class="r">Customers</th><th class="r">Tonnes</th><th class="r">₹/tonne</th>' +
      '<th class="r">Margin/tonne</th><th class="r">Total margin</th><th class="r">Reorders</th><th class="r">Confirmed</th>' +
    '</tr></thead><tbody>' +
    rows.map(function (r) {
      var neg = r.marginPerTonne !== null && r.marginPerTonne <= 0;
      return '<tr>' +
        '<td><b>' + esc(r.label) + '</b></td>' +
        '<td class="r">' + r.customers + '</td>' +
        '<td class="r">' + (Math.round(r.tonnes * 10) / 10) + '</td>' +
        '<td class="r">' + money(r.pricePerTonne) + '</td>' +
        '<td class="r"' + (neg ? ' style="color:#dc2626;font-weight:700"' : '') + '>' + money(r.marginPerTonne) + '</td>' +
        '<td class="r"' + (neg ? ' style="color:#dc2626;font-weight:700"' : '') + '>' + money(r.totalMargin) + '</td>' +
        '<td class="r">' + (r.medianReorderDays ? Math.round(r.medianReorderDays) + 'd' : '—') + '</td>' +
        '<td class="r">' + r.confirmedPct + '%</td>' +
      '</tr>';
    }).join('') + '</tbody></table></div>' +
    (best.totalMargin !== null
      ? '<div class="icp-note icp-ok"><b>' + esc(best.label) + '</b> earns you the most — ' + money(best.totalMargin) +
        ' from ' + best.customers + ' customer(s) at ' + money(best.marginPerTonne) + '/tonne. ' +
        'When you start buying leads, this is the industry to buy first.</div>' : '');
  }

  function body() { return document.getElementById('icpBody'); }
  function render() {
    var el = body(); if (!el) return;
    var b = board();
    var act = b.filter(function (r) { return r.status === 'overdue' || r.status === 'due'; });
    var dorm = b.filter(function (r) { return r.status === 'dormant'; });
    var atRisk = act.reduce(function (a, r) { return a + (r.expectedValue || 0); }, 0);
    var noInd = b.filter(function (r) { return !r.industryKey || r.industryGuessed; }).length;

    el.innerHTML =
      '<div class="icp-stats">' +
        st('Due or overdue', act.length, act.length ? '#c2410c' : null) +
        st('Order value waiting', money(atRisk), '#15803d') +
        st('Gone quiet', dorm.length, dorm.length ? '#7c3aed' : null) +
        st('Industry unconfirmed', noInd, noInd ? '#8a827b' : null) +
      '</div>' +
      '<div class="icp-tabs">' +
        '<button class="icp-tab' + (S.tab === 'call' ? ' on' : '') + '" data-t="call">Who to call today</button>' +
        '<button class="icp-tab' + (S.tab === 'market' ? ' on' : '') + '" data-t="market">Which market pays</button>' +
        '<button class="icp-tab' + (S.tab === 'quiet' ? ' on' : '') + '" data-t="quiet">Gone quiet</button>' +
      '</div>' +
      (S.tab === 'market' ? marketHTML()
       : S.tab === 'quiet'
         ? (dorm.length ? '<div class="icp-list">' + dorm.map(callRow).join('') + '</div>'
                        : '<div class="icp-empty">Nobody has gone quiet. Every customer is still ordering to their usual rhythm.</div>')
         : (act.length ? '<div class="icp-list">' + act.map(callRow).join('') + '</div>'
                       : '<div class="icp-empty">Nobody is due today. A customer only appears here once they have <b>' + C.MIN_ORDERS +
                         ' orders</b> — below that there is no rhythm to predict, and a confident guess off two invoices is worse than silence.</div>'));

    el.querySelectorAll('[data-t]').forEach(function (x) { x.onclick = function () { S.tab = x.dataset.t; render(); }; });
    el.querySelectorAll('[data-conf]').forEach(function (x) {
      x.onclick = function () { var p = x.dataset.conf.split('|'); confirmIndustry(p[0], p[1]); };
    });
  }
  function st(l, v, tone) {
    return '<div class="icp-stat"><div class="icp-stat-v"' + (tone ? ' style="color:' + tone + '"' : '') + '>' + v + '</div><div class="icp-stat-l">' + esc(l) + '</div></div>';
  }

  var CSS = [
    '.icp-back{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1300;display:none}.icp-back.open{display:block}',
    '.icp-panel{position:fixed;top:0;right:0;bottom:0;width:min(860px,97vw);background:var(--ql-card,#fff);z-index:1301;display:flex;flex-direction:column;box-shadow:-14px 0 40px rgba(15,23,42,.18)}',
    '.icp-head{padding:16px 18px;border-bottom:1px solid var(--ql-border);display:flex;align-items:center;gap:10px}',
    '.icp-head h3{margin:0;font-size:16px;font-weight:700}.icp-head .sub{font-size:12px;color:var(--ql-text-secondary);margin-top:2px}',
    '.icp-x{margin-left:auto;background:none;border:none;font-size:20px;cursor:pointer;color:var(--ql-text-secondary)}',
    '#icpBody{overflow:auto;padding:14px 18px 22px}',
    '.icp-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}',
    '.icp-stat{background:var(--ql-bg-subtle,#f8fafc);border:1px solid var(--ql-border);border-radius:10px;padding:8px 10px}',
    '.icp-stat-v{font-size:17px;font-weight:800;letter-spacing:-.02em}.icp-stat-l{font-size:10.5px;color:var(--ql-text-secondary);margin-top:2px}',
    '.icp-tabs{display:flex;gap:6px;margin-bottom:11px;flex-wrap:wrap}',
    '.icp-tab{border:1px solid var(--ql-border);background:none;border-radius:8px;padding:6px 11px;font:inherit;font-size:12.5px;cursor:pointer;color:var(--ql-text-secondary)}',
    '.icp-tab.on{background:var(--ql-primary-50,#eff6ff);border-color:var(--ql-primary-600,#2563EB);color:var(--ql-primary-600,#2563EB);font-weight:600}',
    '.icp-list{display:flex;flex-direction:column;gap:8px}',
    '.icp-row{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--ql-border);border-radius:11px;padding:10px 12px}',
    '.icp-main{flex:1;min-width:0}.icp-top{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
    '.icp-chip{font-size:10.5px;border:1px solid var(--ql-border);border-radius:20px;padding:1px 7px;white-space:nowrap}',
    '.icp-guess{border-style:dashed;color:var(--ql-text-secondary)}',
    '.icp-sub{font-size:12.5px;color:var(--ql-text-secondary);margin-top:4px}',
    '.icp-facts{display:flex;gap:12px;flex-wrap:wrap;margin-top:5px;font-size:11.5px;color:var(--ql-text-tertiary,#94a3b8)}',
    '.icp-act{flex:none;display:flex;gap:6px;align-items:center}',
    '.icp-note{font-size:12px;border:1px solid var(--ql-border);background:var(--ql-bg-subtle,#f8fafc);border-radius:9px;padding:8px 11px;margin-bottom:9px;line-height:1.5}',
    '.icp-warn{border-color:#fde68a;background:#fffbeb;color:#92400e}',
    '.icp-ok{border-color:#a7f3d0;background:#ecfdf5;color:#065f46}',
    '.icp-scroll{overflow-x:auto;border:1px solid var(--ql-border);border-radius:10px}',
    '.icp-t{border-collapse:collapse;width:100%;font-size:12.5px;min-width:640px}',
    '.icp-t th{background:var(--ql-bg-subtle,#f8fafc);text-align:left;padding:8px 10px;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ql-text-secondary);border-bottom:1px solid var(--ql-border);white-space:nowrap}',
    '.icp-t td{padding:8px 10px;border-bottom:1px solid var(--ql-border)}.icp-t tr:last-child td{border-bottom:none}',
    '.icp-t .r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.icp-empty{text-align:center;color:var(--ql-text-secondary);font-size:13px;padding:34px 16px;line-height:1.6}',
    '@media(max-width:768px){.icp-stats{grid-template-columns:repeat(2,1fr)}.icp-panel{width:100vw}.icp-row{flex-direction:column}.icp-act{width:100%}}'
  ].join('');

  function mount() {
    if (document.getElementById('icpPanel')) return;
    var s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
    var b = document.createElement('div'); b.className = 'icp-back'; b.id = 'icpBack';
    var p = document.createElement('div'); p.className = 'icp-panel'; p.id = 'icpPanel'; p.style.display = 'none';
    p.innerHTML = '<div class="icp-head"><div><h3>Sales Intelligence</h3>' +
      '<div class="sub">Learned from your own invoices — not a bought benchmark.</div></div>' +
      '<button class="icp-x" id="icpX">✕</button></div><div id="icpBody"></div>';
    document.body.appendChild(b); document.body.appendChild(p);
    b.onclick = close; document.getElementById('icpX').onclick = close;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }
  function open() {
    if (!window.ICPCore) { toast('Sales engine not loaded', 'err'); return; }
    mount();
    document.getElementById('icpBack').classList.add('open');
    document.getElementById('icpPanel').style.display = 'flex';
    render();
  }
  function close() {
    var b = document.getElementById('icpBack'), p = document.getElementById('icpPanel');
    if (b) b.classList.remove('open'); if (p) p.style.display = 'none';
  }
  window.QLICP = { open: open, close: close, board: board, icp: icp, costPerTonne: costPerTonne };
})();
