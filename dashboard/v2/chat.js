/* ═══════════════════════════════════════════════════════════════════════
   chat.js — the internal WhatsApp inbox.  QLChat.open() / QLChat.openWith(party)

   Nothing here ever leaves the app: no wa.me, no api.whatsapp.com, no
   window.open. Click WhatsApp on a customer and the conversation opens HERE.

   REALITY, STATED PLAINLY IN THE UI RATHER THAN HIDDEN:
     • Not connected  -> the QR panel. You scan it inside QuickLimes; the
       channel token never touches this browser (the QR is proxied by /api/chat).
     • Connected      -> real chats, real history, send + receive.
     • Polling, not WebSockets — LiteSpeed + PHP cannot hold a socket. ~3s while
       a chat is open, and only messages NEWER than the last id come down.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var Q = window.QLD;
  var esc = function (s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var toast = function (m, t) { (window.QLX && QLX.toast) ? QLX.toast(m, t) : (window.QLShell && QLShell.toast) && QLShell.toast(m); };

  var S = { chats: [], msgs: [], chat: null, lastId: 0, poll: null, qr: null, connected: null, q: '', sending: false, oldest: 0 };

  function api(p) {
    var pl = JSON.parse(localStorage.getItem('ql_plant') || '{}');
    return fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ plant_id: pl.id, company_id: Q.activeCo, token: pl.token }, p))
    }).then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: 'Network error' }; });
  }

  var digits = function (s) { return String(s || '').replace(/\D/g, ''); };
  function jidFor(phone) {
    var d = digits(phone);
    if (d.length === 10) d = '91' + d;
    return d ? d + '@s.whatsapp.net' : '';
  }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso.replace(' ', 'T') + 'Z'), now = new Date();
    var same = d.toDateString() === now.toDateString();
    return same ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : d.toLocaleDateString([], { day: '2-digit', month: 'short' });
  }
  // Ticks mean what WhatsApp means by them. Never show a tick we cannot back:
  // 'sent' is one tick because that is all the provider has confirmed.
  var TICK = { pending: '🕐', sent: '✓', delivered: '✓✓', read: '✓✓', played: '✓✓', failed: '⚠' };

  /* ── connection ── */
  function checkConn() {
    return api({ action: 'qr' }).then(function (r) {
      if (r.not_configured) { S.connected = false; S.qr = null; S.notConfigured = true; return; }
      S.notConfigured = false;
      S.connected = !!r.connected; S.qr = r.qr || null; S.status = r.status || r.error || '';
      return r;
    });
  }

  /* ── data ── */
  function loadChats() {
    return api({ action: 'chats' }).then(function (r) {
      if (r.ok) S.chats = r.chats || [];
      return r;
    });
  }
  function openChat(c) {
    S.chat = c; S.msgs = []; S.lastId = 0; S.oldest = 0;
    render();
    return api({ action: 'messages', chat_id: c.chat_id }).then(function (r) {
      if (!r.ok) { toast(r.error || 'Could not load the chat', 'err'); return; }
      S.msgs = r.messages || [];
      if (S.msgs.length) { S.lastId = S.msgs[S.msgs.length - 1].id; S.oldest = S.msgs[0].id; }
      if (c.unread) { api({ action: 'read', chat_id: c.chat_id }); c.unread = 0; }
      render(); scrollDown();
      startPoll();
    });
  }
  function startPoll() {
    stopPoll();
    // Only while a chat is open, and only what is new. A blanket refresh would
    // re-download the whole thread every 3 seconds.
    S.poll = setInterval(function () {
      if (!S.chat || document.hidden) return;
      api({ action: 'messages', chat_id: S.chat.chat_id, since_id: S.lastId }).then(function (r) {
        if (!r.ok || !r.messages || !r.messages.length) return;
        S.msgs = S.msgs.concat(r.messages);
        S.lastId = S.msgs[S.msgs.length - 1].id;
        var near = nearBottom();
        renderThread();
        if (near) scrollDown();          // don't yank the view if they're reading history
        if (r.messages.some(function (m) { return !+m.from_me; })) {
          api({ action: 'read', chat_id: S.chat.chat_id });
          ping();
        }
      });
    }, 3000);
  }
  function stopPoll() { if (S.poll) { clearInterval(S.poll); S.poll = null; } }

  var _audio = null;
  function ping() {
    // A short blip, synthesised — no asset to ship, no CDN to be blocked.
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      _audio = _audio || new AC();
      var o = _audio.createOscillator(), g = _audio.createGain();
      o.connect(g); g.connect(_audio.destination);
      o.frequency.value = 880; g.gain.value = 0.05;
      o.start(); o.stop(_audio.currentTime + 0.08);
    } catch (_) {}
  }

  function send() {
    var box = document.getElementById('chIn'); if (!box) return;
    var body = box.value.trim();
    if (!body || !S.chat || S.sending) return;
    S.sending = true;
    var optimistic = { id: 'tmp' + Date.now(), from_me: 1, type: 'text', body: body, status: 'pending', at: new Date().toISOString().slice(0, 19).replace('T', ' ') };
    S.msgs.push(optimistic); box.value = ''; renderThread(); scrollDown();
    api({ action: 'send', chat_id: S.chat.chat_id, phone: S.chat.phone, body: body }).then(function (r) {
      S.sending = false;
      if (!r.ok) {
        // Never leave a failed message looking sent. Mark it and say why.
        optimistic.status = 'failed'; optimistic.error = r.error;
        toast(r.error || 'Could not send', 'err'); renderThread(); return;
      }
      optimistic.status = 'sent'; optimistic.wa_id = r.id;
      renderThread(); loadChats().then(renderList);
    });
  }

  /* ── render ── */
  function listHTML() {
    var q = S.q.toLowerCase();
    var rows = S.chats.filter(function (c) {
      return !q || (c.name || '').toLowerCase().indexOf(q) >= 0 || (c.phone || '').indexOf(q) >= 0 || (c.party || '').toLowerCase().indexOf(q) >= 0;
    });
    if (!rows.length) {
      return '<div class="ch-empty-s">' + (S.chats.length ? 'No chat matches “' + esc(S.q) + '”'
        : 'No conversations yet. They appear here as soon as a customer messages you — or when you start one from their profile.') + '</div>';
    }
    return rows.map(function (c) {
      var on = S.chat && S.chat.chat_id === c.chat_id;
      return '<button class="ch-li' + (on ? ' on' : '') + '" data-chat="' + esc(c.chat_id) + '">' +
        '<div class="ch-av">' + esc(initials(c.name || c.phone || '?')) + (c.is_group == 1 ? '<i class="ch-g">👥</i>' : '') + '</div>' +
        '<div class="ch-li-b">' +
          '<div class="ch-li-t"><b>' + esc(c.name || c.party || c.phone || 'Unknown') + '</b>' +
            '<span class="ch-when">' + when(c.last_at) + '</span></div>' +
          '<div class="ch-li-s">' + (+c.last_from_me ? '<span class="ch-you">You:</span> ' : '') + esc(c.last_body || '') + '</div>' +
        '</div>' +
        (+c.unread ? '<span class="ch-badge">' + c.unread + '</span>' : '') +
      '</button>';
    }).join('');
  }
  function initials(n) {
    var p = String(n).trim().split(/\s+/);
    return ((p[0] || '')[0] || '' + ((p[1] || '')[0] || '')).toUpperCase().slice(0, 2) || '?';
  }

  // "45255 KB" is not a size a human reads — a 46MB PO should say 44 MB.
  function fileSize(n) {
    n = +n || 0;
    if (n >= 1048576) return (Math.round(n / 104857.6) / 10) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function bubble(m) {
    var mine = !!+m.from_me;
    var media = '';
    if (m.type === 'image' && m.preview) {
      media = '<img class="ch-img" src="' + esc(m.preview) + '" alt="Photo"' + (m.media_id ? ' data-media="' + esc(m.media_id) + '"' : '') + '>';
    } else if (m.media_id || m.type !== 'text') {
      var icon = { document: '📄', voice: '🎤', audio: '🎵', video: '🎬', image: '📷', poll: '📊', location: '📍' }[m.type] || '📎';
      media = '<button class="ch-file"' + (m.media_id ? ' data-media="' + esc(m.media_id) + '"' : ' disabled') + '>' +
        icon + ' <span>' + esc(m.media_name || (m.type.charAt(0).toUpperCase() + m.type.slice(1))) + '</span>' +
        (m.media_size ? '<i>' + fileSize(m.media_size) + '</i>' : '') + '</button>';
    }
    return '<div class="ch-row' + (mine ? ' me' : '') + '">' +
      '<div class="ch-bub' + (mine ? ' me' : '') + (m.status === 'failed' ? ' bad' : '') + '">' +
        (!mine && +S.chat.is_group && m.from_name ? '<div class="ch-who">' + esc(m.from_name) + '</div>' : '') +
        media +
        (m.body ? '<div class="ch-tx">' + esc(m.body) + '</div>' : '') +
        '<div class="ch-meta">' + when(m.at) +
          (mine ? ' <span class="ch-tick' + (m.status === 'read' || m.status === 'played' ? ' blue' : '') + '">' + (TICK[m.status] || '') + '</span>' : '') +
        '</div>' +
        (m.status === 'failed' ? '<div class="ch-fail">Not sent' + (m.error ? ' — ' + esc(m.error) : '') + '</div>' : '') +
      '</div></div>';
  }

  function renderList() { var el = document.getElementById('chList'); if (el) el.innerHTML = listHTML(); wireList(); }
  function renderThread() {
    var el = document.getElementById('chThread'); if (!el) return;
    el.innerHTML = (S.oldest ? '<button class="ch-more" id="chMore">Load earlier messages</button>' : '') +
      (S.msgs.length ? S.msgs.map(bubble).join('') : '<div class="ch-empty-s">No messages yet. Say hello.</div>');
    var mo = document.getElementById('chMore'); if (mo) mo.onclick = loadOlder;
    el.querySelectorAll('[data-media]').forEach(function (x) { x.onclick = function () { openMedia(x.dataset.media); }; });
  }
  function loadOlder() {
    api({ action: 'messages', chat_id: S.chat.chat_id, before_id: S.oldest }).then(function (r) {
      if (!r.ok || !r.messages || !r.messages.length) { S.oldest = 0; renderThread(); return; }
      S.msgs = r.messages.concat(S.msgs); S.oldest = r.messages[0].id;
      renderThread();
    });
  }
  /* Files open IN the app — no new tab, no window.open. An image shows, a PDF
     renders in-frame, anything else offers a download. The brief said the user
     must never leave QuickLimes; a popped tab is leaving. */
  function openMedia(id) {
    var m = S.msgs.filter(function (x) { return x.media_id === id; })[0] || {};
    var v = document.getElementById('chView');
    v.innerHTML = '<div class="ch-view-in"><button class="ch-view-x" id="chVx">✕</button>' +
      '<div class="ch-view-b" id="chVb">Fetching…</div></div>';
    v.classList.add('open');
    document.getElementById('chVx').onclick = closeMedia;
    api({ action: 'media', media_id: id }).then(function (r) {
      var b = document.getElementById('chVb'); if (!b) return;
      if (!r.ok) { b.textContent = r.error || 'Could not open the file'; return; }
      var mime = String(m.media_mime || '');
      if (/^image\//.test(mime)) b.innerHTML = '<img src="' + esc(r.data) + '" alt="' + esc(m.media_name || 'Photo') + '">';
      else if (/pdf/.test(mime)) b.innerHTML = '<iframe src="' + esc(r.data) + '" title="' + esc(m.media_name || 'Document') + '"></iframe>';
      else if (/^audio\//.test(mime)) b.innerHTML = '<audio controls src="' + esc(r.data) + '"></audio>';
      else if (/^video\//.test(mime)) b.innerHTML = '<video controls src="' + esc(r.data) + '"></video>';
      else b.innerHTML = '<a class="ql-btn ql-btn-primary" download="' + esc(m.media_name || 'file') + '" href="' + esc(r.data) + '">Download ' + esc(m.media_name || 'file') + '</a>';
    });
  }
  function closeMedia() { var v = document.getElementById('chView'); if (v) { v.classList.remove('open'); v.innerHTML = ''; } }
  function nearBottom() {
    var el = document.getElementById('chThread'); if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }
  function scrollDown() { var el = document.getElementById('chThread'); if (el) el.scrollTop = el.scrollHeight; }

  function qrHTML() {
    if (S.notConfigured) {
      return '<div class="ch-qr"><h3>WhatsApp isn’t set up yet</h3>' +
        '<p>This inbox needs a channel. Create one at <b>whapi.cloud</b>, then put its token in <code>api/config.php</code> as <code>WHAPI_TOKEN</code> — on the server, never here.</p>' +
        '<p class="ch-qr-warn">Use a <b>separate number</b>. Whapi drives WhatsApp unofficially and Meta bans numbers for bulk messaging — don’t risk your main line.</p>' +
        '<p>Until then the WhatsApp buttons still work the old way: they open WhatsApp with the message ready and you press send.</p></div>';
    }
    if (S.qr) {
      return '<div class="ch-qr"><h3>Connect WhatsApp</h3>' +
        '<img class="ch-qr-img" src="' + esc(S.qr) + '" alt="QR code to link WhatsApp" width="300" height="300">' +
        '<ol class="ch-steps"><li>Open <b>WhatsApp</b> on the phone that will send</li><li>Tap <b>Settings</b></li>' +
        '<li>Tap <b>Linked Devices</b></li><li>Tap <b>Link a Device</b></li><li>Scan this code</li></ol>' +
        '<p class="ch-qr-warn">Scan with the <b>separate number</b> you set aside for this — not your main business line.</p>' +
        '<button class="ql-btn ql-btn-secondary" id="chQrNew">New code</button>' +
        '<p class="ch-mut">The code expires after about a minute. This screen checks every few seconds and closes itself the moment you’re linked.</p></div>';
    }
    return '<div class="ch-qr"><h3>Checking the channel…</h3>' +
      (S.status ? '<p>Provider says: <b>' + esc(S.status) + '</b></p>' : '') + '</div>';
  }

  function render() {
    var el = document.getElementById('chBody'); if (!el) return;
    if (S.connected !== true) { el.innerHTML = qrHTML(); wireQr(); return; }
    el.innerHTML =
      '<div class="ch-wrap">' +
        '<div class="ch-side">' +
          '<div class="ch-search"><input id="chQ" placeholder="Search chats" value="' + esc(S.q) + '"></div>' +
          '<div class="ch-list" id="chList">' + listHTML() + '</div>' +
        '</div>' +
        '<div class="ch-main">' + (S.chat ? (
          '<div class="ch-head">' +
            '<div class="ch-av">' + esc(initials(S.chat.name || S.chat.phone || '?')) + '</div>' +
            '<div><b>' + esc(S.chat.name || S.chat.party || S.chat.phone || 'Unknown') + '</b>' +
              '<div class="ch-mut">' + esc(S.chat.phone || (S.chat.is_group == 1 ? 'Group' : '')) + '</div></div>' +
            '<button class="ch-ico" id="chRefresh" title="Refresh">⟳</button>' +
          '</div>' +
          '<div class="ch-thread" id="chThread"></div>' +
          '<div class="ch-in">' +
            '<textarea id="chIn" rows="1" placeholder="Type a message"></textarea>' +
            '<button class="ch-send" id="chSend" title="Send">➤</button>' +
          '</div>'
        ) : '<div class="ch-empty">Pick a conversation on the left.<br><span class="ch-mut">Or open a customer and press WhatsApp — the chat starts here.</span></div>') +
        '</div>' +
      '</div>';
    wireList(); wireMain();
    if (S.chat) { renderThread(); scrollDown(); }
  }
  function wireQr() {
    var n = document.getElementById('chQrNew');
    if (n) n.onclick = function () { S.qr = null; render(); checkConn().then(render); };
  }
  function wireList() {
    var q = document.getElementById('chQ');
    if (q) q.oninput = function () { S.q = q.value; renderList(); };
    document.querySelectorAll('[data-chat]').forEach(function (b) {
      b.onclick = function () {
        var c = S.chats.filter(function (x) { return x.chat_id === b.dataset.chat; })[0];
        if (c) openChat(c);
      };
    });
  }
  function wireMain() {
    var s = document.getElementById('chSend'); if (s) s.onclick = send;
    var i = document.getElementById('chIn');
    if (i) {
      i.focus();
      i.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
      i.oninput = function () { i.style.height = 'auto'; i.style.height = Math.min(120, i.scrollHeight) + 'px'; };
    }
    var r = document.getElementById('chRefresh');
    if (r) r.onclick = function () { if (S.chat) openChat(S.chat); };
  }

  var CSS = [
    '.ch-back{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:1400;display:none}.ch-back.open{display:block}',
    '.ch-panel{position:fixed;inset:3vh 3vw;background:var(--ql-card,#fff);z-index:1401;border-radius:16px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 30px 80px rgba(15,23,42,.35)}',
    '.ch-panel.open{display:flex}',
    '.ch-top{padding:12px 16px;border-bottom:1px solid var(--ql-border);display:flex;align-items:center;gap:10px;flex:none}',
    '.ch-top h3{margin:0;font-size:15px;font-weight:700}.ch-top .sub{font-size:11.5px;color:var(--ql-text-secondary)}',
    '.ch-x{margin-left:auto;background:none;border:none;font-size:20px;cursor:pointer;color:var(--ql-text-secondary)}',
    '#chBody{flex:1;min-height:0;display:flex}',
    '.ch-wrap{display:flex;flex:1;min-height:0;width:100%}',
    '.ch-side{width:300px;border-right:1px solid var(--ql-border);display:flex;flex-direction:column;flex:none}',
    '.ch-search{padding:9px;border-bottom:1px solid var(--ql-border)}',
    '.ch-search input{width:100%;padding:7px 11px;border:1px solid var(--ql-border);border-radius:20px;font:inherit;font-size:13px;background:var(--ql-neutral-50);color:inherit}',
    '.ch-list{overflow:auto;flex:1}',
    '.ch-li{display:flex;gap:10px;align-items:center;width:100%;border:none;background:none;padding:9px 11px;cursor:pointer;text-align:left;border-bottom:1px solid var(--ql-border)}',
    '.ch-li:hover{background:var(--ql-neutral-50)}.ch-li.on{background:var(--ql-brand-50)}',
    '.ch-av{width:38px;height:38px;border-radius:50%;background:var(--ql-brand-600);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex:none;position:relative}',
    '.ch-g{position:absolute;bottom:-2px;right:-2px;font-size:10px;font-style:normal}',
    '.ch-li-b{flex:1;min-width:0}.ch-li-t{display:flex;justify-content:space-between;gap:6px;align-items:baseline}',
    '.ch-li-t b{font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ch-when{font-size:10.5px;color:var(--ql-text-muted);flex:none}',
    '.ch-li-s{font-size:12px;color:var(--ql-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}',
    '.ch-you{color:var(--ql-text-muted)}',
    '.ch-badge{background:#25D366;color:#fff;border-radius:20px;font-size:10.5px;font-weight:700;padding:1px 6px;flex:none}',
    '.ch-main{flex:1;display:flex;flex-direction:column;min-width:0}',
    '.ch-head{padding:9px 14px;border-bottom:1px solid var(--ql-border);display:flex;align-items:center;gap:10px;flex:none}',
    '.ch-ico{margin-left:auto;background:none;border:1px solid var(--ql-border);border-radius:8px;width:30px;height:30px;cursor:pointer;color:var(--ql-text-secondary);font-size:15px}',
    '.ch-thread{flex:1;overflow:auto;padding:14px;background:var(--ql-neutral-50);display:flex;flex-direction:column;gap:6px}',
    '.ch-row{display:flex}.ch-row.me{justify-content:flex-end}',
    '.ch-bub{max-width:min(68%,520px);background:var(--ql-card,#fff);border:1px solid var(--ql-border);border-radius:12px 12px 12px 3px;padding:7px 10px}',
    '.ch-bub.me{background:#d9fdd3;border-color:#c5f0bd;border-radius:12px 12px 3px 12px;color:#0f172a}',
    '.ch-bub.bad{border-color:#fecaca;background:#fef2f2}',
    '.ch-who{font-size:11px;font-weight:700;color:var(--ql-brand-600);margin-bottom:2px}',
    '.ch-tx{font-size:13.5px;white-space:pre-wrap;word-break:break-word;line-height:1.45}',
    '.ch-meta{font-size:10px;color:#64748b;text-align:right;margin-top:3px}',
    '.ch-tick.blue{color:#53bdeb}',
    '.ch-fail{font-size:10.5px;color:#b91c1c;margin-top:3px}',
    '.ch-img{max-width:100%;border-radius:8px;display:block;margin-bottom:4px;cursor:pointer}',
    '.ch-file{display:flex;align-items:center;gap:7px;background:rgba(0,0,0,.04);border:1px solid var(--ql-border);border-radius:8px;padding:7px 9px;font:inherit;font-size:12.5px;cursor:pointer;width:100%;margin-bottom:4px;color:inherit}',
    '.ch-file i{margin-left:auto;font-style:normal;font-size:10.5px;opacity:.6}',
    '.ch-more{display:block;margin:0 auto 8px;background:none;border:1px solid var(--ql-border);border-radius:20px;padding:4px 12px;font:inherit;font-size:11.5px;cursor:pointer;color:var(--ql-text-secondary)}',
    '.ch-in{display:flex;gap:8px;align-items:flex-end;padding:10px 12px;border-top:1px solid var(--ql-border);flex:none}',
    '.ch-in textarea{flex:1;resize:none;border:1px solid var(--ql-border);border-radius:18px;padding:9px 13px;font:inherit;font-size:13.5px;max-height:120px;background:var(--ql-neutral-50);color:inherit}',
    '.ch-send{width:38px;height:38px;border-radius:50%;border:none;background:#25D366;color:#fff;font-size:15px;cursor:pointer;flex:none}',
    '.ch-empty,.ch-empty-s{display:flex;align-items:center;justify-content:center;flex:1;color:var(--ql-text-secondary);font-size:13.5px;text-align:center;padding:30px;line-height:1.7}',
    '.ch-empty-s{padding:22px;font-size:12.5px}',
    '.ch-mut{color:var(--ql-text-muted);font-size:11.5px}',
    '.ch-qr{margin:auto;text-align:center;max-width:420px;padding:26px}',
    '.ch-qr h3{font-size:18px;margin:0 0 10px}.ch-qr p{font-size:13px;color:var(--ql-text-secondary);line-height:1.6;margin:0 0 10px}',
    '.ch-qr-img{border:1px solid var(--ql-border);border-radius:12px;padding:8px;background:#fff;margin:6px 0 12px}',
    '.ch-steps{text-align:left;display:inline-block;font-size:13px;color:var(--ql-text-secondary);line-height:1.9;margin:0 0 12px}',
    '.ch-qr-warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:9px;padding:9px 11px;font-size:12.5px!important}',
    '.ch-view{position:absolute;inset:0;background:rgba(15,23,42,.86);z-index:5;display:none;align-items:center;justify-content:center;padding:24px}',
    '.ch-view.open{display:flex}',
    '.ch-view-in{position:relative;max-width:min(900px,92%);max-height:88%;width:100%;display:flex;flex-direction:column}',
    '.ch-view-x{position:absolute;top:-34px;right:0;background:none;border:none;color:#fff;font-size:22px;cursor:pointer}',
    '.ch-view-b{background:var(--ql-card,#fff);border-radius:12px;overflow:auto;display:flex;align-items:center;justify-content:center;min-height:180px;padding:14px;color:var(--ql-text-secondary)}',
    '.ch-view-b img,.ch-view-b video{max-width:100%;max-height:76vh;border-radius:8px}',
    '.ch-view-b iframe{border:0;width:100%;height:76vh;border-radius:8px}',
    '@media(max-width:820px){.ch-side{width:100%;display:' + '' + 'flex}.ch-wrap{flex-direction:column}.ch-panel{inset:0;border-radius:0}.ch-side{height:38%;border-right:none;border-bottom:1px solid var(--ql-border)}}'
  ].join('');

  function mount() {
    if (document.getElementById('chPanel')) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var b = document.createElement('div'); b.className = 'ch-back'; b.id = 'chBack';
    var p = document.createElement('div'); p.className = 'ch-panel'; p.id = 'chPanel';
    p.innerHTML = '<div class="ch-top"><div><h3>WhatsApp</h3><div class="sub">Inside QuickLimes — nothing opens outside.</div></div>' +
      '<button class="ch-x" id="chX">✕</button></div><div id="chBody"></div><div class="ch-view" id="chView"></div>';
    document.body.appendChild(b); document.body.appendChild(p);
    b.onclick = close; document.getElementById('chX').onclick = close;
    document.addEventListener('keydown', function (e) { if (e.key !== 'Escape') return;
      var v = document.getElementById('chView');
      if (v && v.classList.contains('open')) { closeMedia(); return; }   // Esc closes the file first, not the whole inbox
      if (document.getElementById('chPanel').classList.contains('open')) close(); });
  }

  function open(chat) {
    mount();
    document.getElementById('chBack').classList.add('open');
    document.getElementById('chPanel').classList.add('open');
    S.connected = null; render();
    checkConn().then(function () {
      render();
      if (S.connected) loadChats().then(function () {
        render();
        if (chat) { var c = S.chats.filter(function (x) { return x.chat_id === chat.chat_id; })[0] || chat; openChat(c); }
      });
    });
  }
  /* Open (or start) the conversation with an ERP party. This is what the
     WhatsApp button on a customer calls — no wa.me, no window.open. */
  function openWith(party) {
    var phone = digits(party && (party.wa || party.phone));
    if (!phone) { toast('No WhatsApp number on file for ' + ((party && party.name) || 'this customer'), 'err'); return; }
    var jid = jidFor(phone);
    mount();
    document.getElementById('chBack').classList.add('open');
    document.getElementById('chPanel').classList.add('open');
    S.connected = null; render();
    checkConn().then(function () {
      if (!S.connected) { render(); return; }         // QR first — then they can chat
      loadChats().then(function () {
        // If the conversation doesn't exist yet, create it locally. It becomes
        // real on the server the moment the first message is sent.
        var c = S.chats.filter(function (x) { return x.chat_id === jid; })[0] ||
          { chat_id: jid, phone: phone, name: party.name, party: party.name, is_group: 0, unread: 0 };
        if (S.chats.indexOf(c) < 0) S.chats.unshift(c);
        render(); openChat(c);
      });
    });
  }
  function close() {
    stopPoll();
    var b = document.getElementById('chBack'), p = document.getElementById('chPanel');
    if (b) b.classList.remove('open'); if (p) p.classList.remove('open');
  }

  window.QLChat = { open: open, openWith: openWith, close: close, connected: function () { return S.connected === true; } };
})();
