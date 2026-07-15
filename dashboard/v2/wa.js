/* ═══════════════════════════════════════════════════════════════════════
   wa.js — Reminder Center (UI).  QLWA.open()

   The thin, dumb layer: wa-core.js decides WHO to chase for HOW MUCH and
   composes the text (pure + unit-tested); QLD stores the log; this only
   renders and hands the message to a transport.

   TRANSPORT, honestly: no WhatsApp provider is connected, so the only real
   transport is one-tap — we open WhatsApp with the message ready and a human
   presses send. That is why nothing here claims "delivered": with one-tap we
   cannot know. We log 'sent' and say so. When a provider is connected, sendOne
   is the single place that changes.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var Q = window.QLD, W = window.WACore;
  var esc = function (s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var toast = function (m, t) { (window.QLX && QLX.toast) ? QLX.toast(m, t) : (window.QLShell && QLShell.toast) && QLShell.toast(m); };
  var fC = function (n) { return '₹' + W.money(n); };
  var S = { tab: 'due', min: 0, onlyOverdue: false, sel: {} };

  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  /* The plan for today, straight from the engine. */
  function plan() {
    var cfg = Q.waCfg();
    var t = W.planReminders({
      sales: Q.salesRows(), parties: Q.partyRows(), today: today(),
      schedule: cfg.schedule, sentKeys: Q.waSentKeys(), templates: cfg.templates
    });
    if (S.onlyOverdue) t = t.filter(function (x) { return x.step > 0; });
    if (S.min > 0) t = W.filterTasks(t, { minOutstanding: S.min }, Q.partyRows());
    return t;
  }
  function statements() {
    return W.planStatements({ sales: Q.salesRows(), parties: Q.partyRows(), today: today(), templates: Q.waCfg().templates });
  }

  /* ── the only transport there is today ──
     Opens WhatsApp with the text prefilled; the human presses send. We log it
     as 'sent' because that is all we can honestly claim. Returns false if the
     task is not sendable — the caller must not pretend otherwise. */
  function sendOne(t) {
    if (!t.sendable) { toast(t.reason || 'Not sendable', 'err'); return false; }
    window.open(W.waLink(t.phone, t.text), '_blank');
    Q.waRecord(t, 'tap');
    return true;
  }

  /* Sending many: browsers block a burst of window.open, and firing 40 tabs at
     a customer list is how you get a number banned. So it is one at a time,
     deliberately, with the count visible. */
  function sendQueue(list) {
    var q = list.filter(function (t) { return t.sendable; });
    if (!q.length) { toast('Nothing sendable — check the numbers on file', 'err'); return; }
    var i = 0;
    function step() {
      if (i >= q.length) { toast('Done · ' + q.length + ' message' + (q.length > 1 ? 's' : '') + ' opened'); render(); return; }
      var t = q[i++];
      sendOne(t);
      body().querySelector('#waQn').textContent = i + ' of ' + q.length;
      if (i < q.length) setTimeout(step, 900);      // let the tab settle; no burst
      else { toast('Opened ' + q.length + ' chats · press send in each'); render(); }
    }
    step();
  }

  /* ── render ── */
  function stat(label, value, tone) {
    return '<div class="wa-stat"><div class="wa-stat-v" style="color:' + (tone || 'var(--ql-text-primary)') + '">' + value + '</div><div class="wa-stat-l">' + esc(label) + '</div></div>';
  }
  function taskRow(t, i) {
    var tone = t.step > 0 ? '#dc2626' : t.step === 0 ? '#c2610c' : '#15803d';
    return '<div class="wa-row' + (t.sendable ? '' : ' wa-dead') + '">' +
      '<label class="wa-ck"><input type="checkbox" data-i="' + i + '"' + (S.sel[t.key] ? ' checked' : '') + (t.sendable ? '' : ' disabled') + '></label>' +
      '<div class="wa-main">' +
        '<div class="wa-top"><b>' + esc(t.party) + '</b>' +
          '<span class="wa-chip" style="color:' + tone + ';border-color:' + tone + '33">' + esc(t.stepLabel) + '</span></div>' +
        '<div class="wa-sub">' + esc(t.inv) + ' · due ' + esc(W.niceDate(t.due)) + ' · balance <b>' + fC(t.balance) + '</b>' +
          (t.bills > 1 ? ' · <span class="wa-mut">' + t.bills + ' bills, ' + fC(t.outstanding) + ' total</span>' : '') + '</div>' +
        (t.sendable ? '<div class="wa-msg">' + esc(t.text) + '</div>'
                    : '<div class="wa-why">⚠ ' + esc(t.reason) + '</div>') +
      '</div>' +
      '<div class="wa-act">' + (t.sendable
        ? '<button class="ql-btn ql-btn-primary" data-send="' + i + '">Send</button>'
        : '<button class="ql-btn ql-btn-secondary" data-fix="' + esc(t.party) + '">Fix</button>') + '</div>' +
    '</div>';
  }

  function body() { return document.getElementById('waBody'); }
  function render() {
    var el = body(); if (!el) return;
    var tasks = S.tab === 'due' ? plan() : statements();
    var st = Q.waStats();
    var sendable = tasks.filter(function (t) { return t.sendable; });
    var blocked = tasks.length - sendable.length;
    var due = tasks.reduce(function (a, t) { return a + (t.balance || t.outstanding || 0); }, 0);

    el.innerHTML =
      '<div class="wa-stats">' +
        stat('Scheduled today', tasks.length) +
        stat('Ready to send', sendable.length, '#15803d') +
        stat('Blocked', blocked, blocked ? '#dc2626' : undefined) +
        stat('Sent today', st.sent, '#2563EB') +
        stat(S.tab === 'due' ? 'Being chased' : 'Outstanding', fC(due), '#dc2626') +
      '</div>' +
      '<div class="wa-tabs">' +
        '<button class="wa-tab' + (S.tab === 'due' ? ' on' : '') + '" data-tab="due">Reminders due today</button>' +
        '<button class="wa-tab' + (S.tab === 'stmt' ? ' on' : '') + '" data-tab="stmt">Account statements</button>' +
        '<button class="wa-tab' + (S.tab === 'log' ? ' on' : '') + '" data-tab="log">Log</button>' +
      '</div>' +
      (S.tab === 'log' ? logHTML() :
        '<div class="wa-filters">' +
          '<label class="wa-f"><input type="checkbox" id="waOd"' + (S.onlyOverdue ? ' checked' : '') + '> Overdue only</label>' +
          '<label class="wa-f">Outstanding above ₹<input id="waMin" class="wa-min" type="number" value="' + (S.min || '') + '" placeholder="0"></label>' +
          '<span class="wa-grow"></span>' +
          '<span class="wa-mut" id="waQn"></span>' +
          '<button class="ql-btn ql-btn-primary" id="waAll"' + (sendable.length ? '' : ' disabled') + '>Send ' + sendable.length + ' one by one</button>' +
        '</div>' +
        (tasks.length
          ? '<div class="wa-list">' + tasks.map(taskRow).join('') + '</div>'
          : '<div class="wa-empty">' + (S.tab === 'due'
              ? 'Nothing scheduled today. Reminders fire on set days only — 3 and 1 days before the due date, on it, then 3, 7, 15 and 30 days after.'
              : 'No customer owes anything right now.') + '</div>'));

    // wire
    el.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { S.tab = b.dataset.tab; render(); }; });
    var od = el.querySelector('#waOd'); if (od) od.onchange = function () { S.onlyOverdue = od.checked; render(); };
    var mn = el.querySelector('#waMin'); if (mn) mn.onchange = function () { S.min = +mn.value || 0; render(); };
    el.querySelectorAll('[data-send]').forEach(function (b) {
      b.onclick = function () { if (sendOne(tasks[+b.dataset.send])) { b.textContent = 'Sent ✓'; b.disabled = true; setTimeout(render, 600); } };
    });
    el.querySelectorAll('[data-fix]').forEach(function (b) {
      b.onclick = function () { location.href = 'parties.html'; };
    });
    var all = el.querySelector('#waAll'); if (all) all.onclick = function () { sendQueue(tasks); };
    el.querySelectorAll('[data-resend]').forEach(function (b) {
      b.onclick = function () {
        var r = Q.waLogRows().find(function (x) { return x.id === b.dataset.resend; });
        if (!r) return;
        if (!r.phone) { toast('No number on that log entry', 'err'); return; }
        window.open(W.waLink(r.phone, r.text), '_blank');
        toast('Reopened — press send in WhatsApp');
      };
    });
  }

  function logHTML() {
    var rows = Q.waLogRows().slice().reverse();
    if (!rows.length) return '<div class="wa-empty">Nothing sent yet. Every reminder you send is recorded here — who, when, what was said, and by whom.</div>';
    return '<div class="wa-list">' + rows.slice(0, 200).map(function (r) {
      return '<div class="wa-row"><div class="wa-main">' +
        '<div class="wa-top"><b>' + esc(r.party) + '</b><span class="wa-chip">' + esc(r.kind) + '</span>' +
          '<span class="wa-chip" style="color:#2563EB;border-color:#2563EB33">' + esc(r.status) + '</span></div>' +
        '<div class="wa-sub">' + esc(W.niceDate(r.date)) + ' · ' + esc(r.inv || '—') + ' · ' + fC(r.amount) +
          (r.user ? ' · by ' + esc(r.user) : '') + ' · via ' + esc(r.via) + '</div>' +
        '<div class="wa-msg">' + esc(r.text) + '</div>' +
      '</div><div class="wa-act"><button class="ql-btn ql-btn-secondary" data-resend="' + esc(r.id) + '">Resend</button></div></div>';
    }).join('') + '</div>';
  }

  var CSS = [
    '.wa-back{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1300;display:none}',
    '.wa-back.open{display:block}',
    '.wa-panel{position:fixed;top:0;right:0;bottom:0;width:min(720px,96vw);background:var(--ql-card,#fff);z-index:1301;display:flex;flex-direction:column;box-shadow:-14px 0 40px rgba(15,23,42,.18)}',
    '.wa-head{padding:16px 18px;border-bottom:1px solid var(--ql-border);display:flex;align-items:center;gap:10px}',
    '.wa-head h3{margin:0;font-size:16px;font-weight:700}',
    '.wa-head .sub{font-size:12px;color:var(--ql-text-secondary);margin-top:2px}',
    '.wa-x{margin-left:auto;background:none;border:none;font-size:20px;cursor:pointer;color:var(--ql-text-secondary)}',
    '#waBody{overflow:auto;padding:14px 18px 22px}',
    '.wa-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px}',
    '.wa-stat{background:var(--ql-bg-subtle,#f8fafc);border:1px solid var(--ql-border);border-radius:10px;padding:8px 10px}',
    '.wa-stat-v{font-size:16px;font-weight:800;letter-spacing:-.02em}',
    '.wa-stat-l{font-size:10.5px;color:var(--ql-text-secondary);margin-top:2px}',
    '.wa-tabs{display:flex;gap:6px;margin-bottom:10px}',
    '.wa-tab{border:1px solid var(--ql-border);background:none;border-radius:8px;padding:6px 11px;font:inherit;font-size:12.5px;cursor:pointer;color:var(--ql-text-secondary)}',
    '.wa-tab.on{background:var(--ql-primary-50,#eff6ff);border-color:var(--ql-primary-600,#2563EB);color:var(--ql-primary-600,#2563EB);font-weight:600}',
    '.wa-filters{display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap}',
    '.wa-f{font-size:12.5px;color:var(--ql-text-secondary);display:flex;align-items:center;gap:5px}',
    '.wa-min{width:90px;padding:4px 7px;border:1px solid var(--ql-border);border-radius:7px;font:inherit}',
    '.wa-grow{flex:1}',
    '.wa-list{display:flex;flex-direction:column;gap:8px}',
    '.wa-row{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--ql-border);border-radius:11px;padding:10px 12px;background:var(--ql-card,#fff)}',
    '.wa-dead{background:#fffbeb;border-color:#fde68a}',
    '.wa-main{flex:1;min-width:0}',
    '.wa-top{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
    '.wa-chip{font-size:10.5px;border:1px solid var(--ql-border);border-radius:20px;padding:1px 7px;text-transform:capitalize}',
    '.wa-sub{font-size:12px;color:var(--ql-text-secondary);margin-top:3px}',
    '.wa-mut{color:var(--ql-text-tertiary,#94a3b8)}',
    '.wa-msg{font-size:11.5px;color:var(--ql-text-secondary);background:var(--ql-bg-subtle,#f8fafc);border-radius:8px;padding:7px 9px;margin-top:6px;white-space:pre-wrap;max-height:74px;overflow:auto}',
    '.wa-why{font-size:12px;color:#b45309;margin-top:5px;font-weight:600}',
    '.wa-act{flex:none}',
    '.wa-empty{text-align:center;color:var(--ql-text-secondary);font-size:13px;padding:34px 16px;line-height:1.6}',
    '@media(max-width:768px){.wa-stats{grid-template-columns:repeat(2,1fr)}.wa-panel{width:100vw}}'
  ].join('');

  function mount() {
    if (document.getElementById('waPanel')) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var b = document.createElement('div'); b.className = 'wa-back'; b.id = 'waBack';
    var p = document.createElement('div'); p.className = 'wa-panel'; p.id = 'waPanel'; p.style.display = 'none';
    p.innerHTML = '<div class="wa-head"><div><h3>Reminder Center</h3>' +
      '<div class="sub">Scheduled from each customer’s credit days. You press send — no messages go out on their own.</div></div>' +
      '<button class="wa-x" id="waX">✕</button></div><div id="waBody"></div>';
    document.body.appendChild(b); document.body.appendChild(p);
    b.onclick = close; document.getElementById('waX').onclick = close;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }
  function open() {
    if (!window.WACore) { toast('Reminder engine not loaded', 'err'); return; }
    mount();
    document.getElementById('waBack').classList.add('open');
    document.getElementById('waPanel').style.display = 'flex';
    render();
  }
  function close() {
    var b = document.getElementById('waBack'), p = document.getElementById('waPanel');
    if (b) b.classList.remove('open'); if (p) p.style.display = 'none';
  }

  window.QLWA = { open: open, close: close, plan: plan, statements: statements, sendOne: sendOne };
})();
