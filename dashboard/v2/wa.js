/* ═══════════════════════════════════════════════════════════════════════
   wa.js — Reminder Center (UI).  QLWA.open()

   The thin, dumb layer: wa-core.js decides WHO to chase for HOW MUCH and
   composes the text (pure + unit-tested); QLD stores the log; this only
   renders and hands the message to a transport.

   TRANSPORT: two modes, decided by the SERVER, never guessed here.
     'tap'  (default) — no channel connected: open WhatsApp with the message
            ready; a human presses send. We log 'sent', never 'delivered',
            because with one-tap we genuinely cannot know it arrived.
     'api'  — a Whapi channel is connected: /api/wa sends it and returns a
            provider message id. Only then is a send something we can prove.
   The channel token NEVER exists in this file, or any file the browser loads.
   It lives in api/config.php on the server; the browser only asks /api/wa.
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

  /* ── transport ──────────────────────────────────────────────────────────
     Two modes, and the UI never lies about which one is live:
       'api' — a Whapi channel is connected: the server sends, we get a message
               id back, and nothing needs a human.
       'tap' — the default: open WhatsApp with the text ready; a human presses
               send. We log 'sent' because that is all we can honestly claim.
     The token is never here. The browser asks /api/wa to send. */
  var CH = { checked: false, configured: false, status: '', sender: '' };

  function api(payload) {
    var p = JSON.parse(localStorage.getItem('ql_plant') || '{}');
    return fetch('/api/wa', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ plant_id: p.id, token: p.token }, payload))
    }).then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: 'Network error' }; });
  }
  function checkChannel() {
    return api({ action: 'status' }).then(function (r) {
      CH.checked = true;
      CH.configured = !!r.configured && !r.not_configured;
      CH.status = r.status || (r.error || '');
      CH.sender = r.sender || '';
      CH.live = !!r.ok;
      return CH;
    });
  }
  function mode() { return CH.live ? 'api' : 'tap'; }

  /* Send one. Returns a PROMISE of true/false — never a claim we cannot back.
     A provider failure is surfaced and logged as failed, so wa-core will offer
     the same reminder again rather than silently dropping a customer. */
  function sendOne(t) {
    if (!t.sendable) { toast(t.reason || 'Not sendable', 'err'); return Promise.resolve(false); }
    if (!CH.live) {                                   // one-tap: the human sends
      window.open(W.waLink(t.phone, t.text), '_blank');
      Q.waRecord(t, 'tap');
      return Promise.resolve(true);
    }
    return api({ action: 'send', to: t.phone, body: t.text }).then(function (r) {
      if (!r.ok) {
        var rec = Q.waRecord(t, 'whapi'); Q.waSetStatus(rec.id, 'failed');
        toast(r.error || 'Send failed', 'err');
        return false;                                  // failed ⇒ NOT deduped ⇒ retryable
      }
      var rec2 = Q.waRecord(t, 'whapi');
      rec2.providerId = r.id; Q.commit();
      return true;
    });
  }

  /* Sending many: browsers block a burst of window.open, and firing 40 tabs at
     a customer list is how you get a number banned. So it is one at a time,
     deliberately, with the count visible. */
  function sendQueue(list) {
    var q = list.filter(function (t) { return t.sendable; });
    if (!q.length) { toast('Nothing sendable — check the numbers on file', 'err'); return; }
    var i = 0, okN = 0, badN = 0;
    // Deliberately serial with a gap. In api mode this IS the rate limit: a
    // burst of dunning messages off one unofficial number is the fastest way to
    // get it banned. In tap mode a burst of window.open is blocked anyway.
    var gap = CH.live ? 2500 : 900;
    function step() {
      if (i >= q.length) {
        toast(CH.live ? ('Sent ' + okN + (badN ? ' · ' + badN + ' failed' : '')) : ('Opened ' + q.length + ' chats · press send in each'),
              badN ? 'err' : 'ok');
        render(); return;
      }
      var t = q[i++];
      var n = body() && body().querySelector('#waQn'); if (n) n.textContent = i + ' of ' + q.length;
      // await the result — sendOne returns a PROMISE, and a promise is always
      // truthy, so counting it without awaiting would report every send a success.
      sendOne(t).then(function (ok) { ok ? okN++ : badN++; })
                .catch(function () { badN++; })
                .then(function () { setTimeout(step, gap); });
    }
    step();
  }

  /* ── render ── */
  function stat(label, value, tone) {
    return '<div class="wa-stat"><div class="wa-stat-v" style="color:' + (tone || 'var(--ql-text)') + '">' + value + '</div><div class="wa-stat-l">' + esc(label) + '</div></div>';
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
      (CH.checked ? (CH.live
        ? '<div class="wa-mode wa-mode-on">✓ Connected — messages send automatically from ' + esc(CH.sender || 'your channel') + '</div>'
        : '<div class="wa-mode">One-tap mode — WhatsApp opens with the message ready and <b>you press send</b>. '
          + (CH.configured ? 'Channel says: ' + esc(CH.status || 'not ready') + '.' : 'No WhatsApp channel connected yet.') + '</div>')
        : '') +
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
          '<button class="ql-btn ql-btn-secondary" id="waSched">Schedule next 14 days</button>' +
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
      b.onclick = function () {
        b.disabled = true; b.textContent = CH.live ? 'Sending…' : 'Opening…';
        // sendOne is a promise: `if (sendOne(...))` would always be true and
        // would claim success on a failed send. Await it.
        sendOne(tasks[+b.dataset.send]).then(function (ok) {
          if (ok) { b.textContent = CH.live ? 'Sent ✓' : 'Opened ✓'; setTimeout(render, 700); }
          else { b.disabled = false; b.textContent = 'Send'; }
        });
      };
    });
    el.querySelectorAll('[data-fix]').forEach(function (b) {
      b.onclick = function () { location.href = 'parties.html'; };
    });
    var all = el.querySelector('#waAll'); if (all) all.onclick = function () { sendQueue(tasks); };
    var sc = el.querySelector('#waSched');
    if (sc) sc.onclick = function () {
      sc.disabled = true; sc.textContent = 'Scheduling…';
      scheduleAhead(14).then(function (r) {
        sc.disabled = false; sc.textContent = 'Schedule next 14 days';
        if (!r.ok) { toast(r.error || 'Could not schedule', 'err'); return; }
        if (r.none) { toast('Nothing to schedule in the next 14 days'); return; }
        // Say exactly what happened. "skipped" is not a failure — it means
        // already queued, which is the dedupe doing its job.
        toast('Queued ' + r.queued + (r.skipped ? ' · ' + r.skipped + ' already scheduled' : '') +
              (CH.live ? '' : ' — they will only SEND once a channel is connected'), r.queued ? 'ok' : 'err');
      });
    };
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
    '.wa-stat{background:var(--ql-neutral-50);border:1px solid var(--ql-border);border-radius:10px;padding:8px 10px}',
    '.wa-stat-v{font-size:16px;font-weight:800;letter-spacing:-.02em}',
    '.wa-stat-l{font-size:10.5px;color:var(--ql-text-secondary);margin-top:2px}',
    '.wa-tabs{display:flex;gap:6px;margin-bottom:10px}',
    '.wa-tab{border:1px solid var(--ql-border);background:none;border-radius:8px;padding:6px 11px;font:inherit;font-size:12.5px;cursor:pointer;color:var(--ql-text-secondary)}',
    '.wa-tab.on{background:var(--ql-brand-50);border-color:var(--ql-brand-600);color:var(--ql-brand-600);font-weight:600}',
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
    '.wa-mut{color:var(--ql-text-muted)}',
    '.wa-msg{font-size:11.5px;color:var(--ql-text-secondary);background:var(--ql-neutral-50);border-radius:8px;padding:7px 9px;margin-top:6px;white-space:pre-wrap;max-height:74px;overflow:auto}',
    '.wa-why{font-size:12px;color:#b45309;margin-top:5px;font-weight:600}',
    '.wa-act{flex:none}',
    '.wa-mode{font-size:12px;border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:9px;padding:7px 10px;margin-bottom:10px}',
    '.wa-mode-on{border-color:#a7f3d0;background:#ecfdf5;color:#065f46}',
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
    checkChannel().then(render);        // repaint once we know the real transport
  }
  function close() {
    var b = document.getElementById('waBack'), p = document.getElementById('waPanel');
    if (b) b.classList.remove('open'); if (p) p.style.display = 'none';
  }

  /* ── SCHEDULE AHEAD ────────────────────────────────────────────────────
     The browser owns the RULES; the server is a pipe. So we compute the plan
     for the next N days HERE (wa-core, unit-tested) and enqueue concrete jobs.
     No rule is duplicated in PHP — the split that would drift.

     A queued job is an intent, not a promise: /api/cron re-checks the invoice
     is still unpaid AND that the amount still matches before it sends. Pay a
     bill tomorrow and the queued reminder is dropped, not delivered.

     Idempotent: the dedupe key is wa-core's own sendKey (party|invoice|step),
     unique in the DB, so opening the app five times queues one reminder. */
  function scheduleAhead(days) {
    days = days || 14;
    var p = JSON.parse(localStorage.getItem('ql_plant') || '{}');
    var cfg = Q.waCfg(), sent = Q.waSentKeys(), jobs = [];
    var base = new Date();
    for (var d = 0; d < days; d++) {
      var day = new Date(base); day.setDate(day.getDate() + d);
      var iso = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
      W.planReminders({
        sales: Q.salesRows(), parties: Q.partyRows(), today: iso,
        schedule: cfg.schedule, sentKeys: sent, templates: cfg.templates
      }).forEach(function (t) {
        if (!t.sendable) return;                       // no number / broken message ⇒ never queue it
        jobs.push({
          kind: 'wa_reminder', dedupe_key: t.key,
          // 10:00 local — a reminder at 3am reads as a robot and gets ignored.
          send_at: iso + ' 10:00:00',
          payload: { to: t.phone, body: t.text, inv: t.inv, party: t.party, step: t.step, amount: Math.round(t.balance * 100) / 100 }
        });
      });
    }
    if (!jobs.length) return Promise.resolve({ ok: true, queued: 0, skipped: 0, none: true });
    return fetch('/api/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plant_id: p.id, company_id: Q.activeCo, token: p.token, action: 'enqueue', jobs: jobs })
    }).then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: 'Network error' }; });
  }

  window.QLWA = { open: open, close: close, plan: plan, statements: statements, sendOne: sendOne,
    checkChannel: checkChannel, mode: mode, scheduleAhead: scheduleAhead };
})();
