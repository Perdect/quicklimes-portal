/* ═══════════════════════════════════════════════════════════════════════
   INTERNAL CHAT — the global drawer.  window.QLIM

   NOT chat.js. That file is the WhatsApp inbox (window.QLChat): it renders a
   conversation held on an external Whapi channel and needs that channel
   connected to do anything. This is QuickLimes' OWN messaging — it works with
   no WhatsApp at all, and it is the source of truth for the firm's
   communication history. The two coexist; if a WhatsApp bridge is added later
   it writes into chat_messages with source='whatsapp' so one thread can carry
   both.

   Loaded on every page through shell.js, so a conversation is one click away
   from wherever the user is and closing it returns them exactly where they
   were. The page underneath is never navigated away from.

   All arithmetic and identity logic lives in chat-core.js (QLChatCore), which
   is tested headlessly. This file talks to /api/messages and draws.

   REALTIME: polling, not websockets. LiteSpeed + PHP on shared hosting cannot
   hold an open socket — the same constraint the existing WhatsApp inbox
   already documented. `since_id` makes it cheap: the open conversation asks
   only for what is newer than the last message it holds. Introducing a second
   realtime stack for this one feature would be the wrong trade.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const C = window.QLChatCore;
  if (!C) return;

  const esc = s => (s == null ? '' : s).toString().replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const S = {
    open: false, threads: [], threadId: null, messages: [], hasMore: false,
    filter: 'all', q: '', me: '', role: 'sales', users: [], noteMode: false,
    loading: false, error: '', pollTimer: null, lastId: 0, unread: 0, details: false,
    replyTo: null, find: '', finding: false
  };

  /* ── api ──────────────────────────────────────────────────────────────── */
  function api(body) {
    const p = JSON.parse(localStorage.getItem('ql_plant') || '{}');
    const Q = window.QLD;
    return fetch('/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ plant_id: p.id, company_id: Q ? Q.activeCo : '', token: p.token }, body))
    }).then(r => r.json()).catch(() => ({ ok: false, error: 'Network error' }));
  }

  const ICO = {
    chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    back: '<polyline points="15 18 9 12 15 6"/>',
    note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    reply: '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
  };
  const ic = (k, cls) => `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO[k] || ''}</svg>`;

  /* ── shell ────────────────────────────────────────────────────────────── */
  function mount() {
    if (document.getElementById('qlImBack')) return;
    const el = document.createElement('div');
    el.innerHTML = `
      <div class="qc-back" id="qlImBack"></div>
      <aside class="qc" id="qlIm" role="dialog" aria-label="QuickLimes chat">
        <div class="qc-list" id="qcList"></div>
        <div class="qc-conv" id="qcConv"></div>
      </aside>`;
    while (el.firstElementChild) document.body.appendChild(el.firstElementChild);
    document.getElementById('qlImBack').onclick = close;
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.open) close(); });
  }

  function open() {
    mount();
    askNotifyOnce();
    S.open = true;
    document.getElementById('qlImBack').classList.add('on');
    document.getElementById('qlIm').classList.add('on');
    loadThreads();
  }
  function close() {
    S.open = false;
    const b = document.getElementById('qlImBack'), c = document.getElementById('qlIm');
    if (b) b.classList.remove('on');
    if (c) { c.classList.remove('on'); c.classList.remove('conv'); }
    /* `conv` is the MOBILE one-pane-at-a-time switch. Leaving it set meant the
       next open jumped straight back into the last conversation with the chat
       list hidden — and if that thread had gone, an empty pane with no way
       back. The drawer always reopens on the list; openThread puts it back. */
    stopPoll();
  }

  /* ── threads ──────────────────────────────────────────────────────────── */
  async function loadThreads() {
    S.loading = true; paintList();
    const r = await api({ action: 'threads' });
    S.loading = false;
    if (!r.ok) { S.error = r.error === 'no_user' ? r.message : (r.error || 'Could not load chats'); paintList(); return; }
    S.error = '';
    S.threads = r.threads || [];
    S.unread = r.unread || 0;
    badge();
    paintList();
  }

  function avatar(name, cls) {
    return `<span class="qc-av ${cls || ''}" style="--h:${C.avatarTint(name)}">${esc(C.initials(name))}</span>`;
  }

  function paintList() {
    const host = document.getElementById('qcList'); if (!host) return;
    const chips = C.FILTERS.map(f =>
      `<button class="qc-f ${S.filter === f.key ? 'on' : ''}" data-f="${f.key}">${esc(f.label)}</button>`).join('');
    let rows;
    if (S.error) {
      rows = `<div class="qc-empty"><div class="t">Chat unavailable</div><div>${esc(S.error)}</div></div>`;
    } else if (S.loading) {
      rows = Array.from({ length: 5 }).map(() =>
        `<div class="qc-row"><span class="qc-sk qc-sk-av"></span><div style="flex:1"><div class="qc-sk" style="width:60%;height:12px"></div><div class="qc-sk" style="width:85%;height:10px;margin-top:7px"></div></div></div>`).join('');
    } else {
      const list = C.filterThreads(S.threads, S.filter, S.q);
      rows = list.length ? list.map(t => `
        <button class="qc-row ${t.id === S.threadId ? 'on' : ''}" data-t="${t.id}">
          ${avatar(t.title)}
          <div class="qc-row-b">
            <div class="qc-row-1"><span class="qc-row-n">${esc(t.title)}</span>
              <span class="qc-row-t">${esc(C.timeLabel(t.last_at))}</span></div>
            <div class="qc-row-2"><span class="qc-row-p">${esc(C.previewOf(t))}</span>
              ${t.unread ? `<span class="qc-badge">${t.unread}</span>` : ''}</div>
          </div>
        </button>`).join('')
        : `<div class="qc-empty"><div class="t">${S.q || S.filter !== 'all' ? 'Nothing matches' : 'No conversations yet'}</div>
             <div>${S.q || S.filter !== 'all' ? 'Try another filter or search.' : 'Open one from Lead Discovery, a customer, or a colleague.'}</div></div>`;
    }
    host.innerHTML = `
      <div class="qc-list-h">
        <div class="qc-list-t">Chats${S.unread ? ` <span class="qc-badge">${S.unread}</span>` : ''}</div>
        <button class="qc-icon" id="qcNew" title="Message a colleague">${ic('plus')}</button>
        <button class="qc-icon qc-only-mob" id="qcClose1" title="Close">${ic('x')}</button>
      </div>
      <div class="qc-search">${ic('search')}<input id="qcQ" placeholder="Search chats" value="${esc(S.q)}"></div>
      <div class="qc-filters">${chips}</div>
      <div class="qc-rows">${rows}</div>`;
    host.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.filter = b.dataset.f; paintList(); });
    host.querySelectorAll('[data-t]').forEach(b => b.onclick = () => openThread(+b.dataset.t));
    const q = document.getElementById('qcQ');
    if (q) q.oninput = e => { S.q = e.target.value; paintList(); q.focus(); };
    const nb = document.getElementById('qcNew');
    if (nb) nb.onclick = () => QLShell.panel({
      title: 'New conversation',
      body: `<div class="qc-att">
        <button class="qc-att-b" data-n="dm">💬 Message a colleague</button>
        <button class="qc-att-b" data-n="group">👥 Create a group <small>Sales Team, Accounts Team…</small></button>
      </div>`,
      actions: [{ label: 'Cancel', onClick: () => QLShell.closeModal() }],
      onMount: el => el.querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
        const k = b.dataset.n; QLShell.closeModal();
        if (k === 'dm') newDirect(); else newGroup();
      })
    });
    const cb = document.getElementById('qcClose1'); if (cb) cb.onclick = close;
  }

  /* ── conversation ─────────────────────────────────────────────────────── */
  async function openThread(id) {
    S.threadId = id; S.messages = []; S.lastId = 0; S.details = false;
    paintList(); paintConv();
    const r = await api({ action: 'messages', thread_id: id, limit: 40 });
    if (!r.ok) { S.error = r.error || 'Could not load messages'; paintConv(); return; }
    S.messages = r.messages || [];
    S.hasMore = !!r.has_more;
    S.lastId = S.messages.length ? S.messages[S.messages.length - 1].id : 0;
    paintConv(); scrollEnd();
    markRead();
    startPoll();
  }

  function thread() { return S.threads.find(t => t.id === S.threadId) || null; }

  async function markRead() {
    if (!S.threadId || !S.lastId) return;
    await api({ action: 'read', thread_id: S.threadId, last_id: S.lastId });
    const t = thread(); if (t) { S.unread -= (t.unread || 0); t.unread = 0; }
    badge(); paintList();
  }

  function msgHTML(m, prev) {
    const mine = m.user_id === S.me;
    if (m.deleted_at) return `<div class="qc-m ${mine ? 'me' : ''}"><div class="qc-bub gone">This message was deleted</div></div>`;
    if (m.kind === 'note') {
      /* An internal note must never be mistakable for something said to the
         customer. Different colour, different alignment, and it says so. */
      return `<div class="qc-m note"><div class="qc-bub qc-note">
        <div class="qc-note-h">${ic('note')} Internal note · not sent to the customer</div>
        <div class="qc-txt">${linkify(m.body)}</div>
        <div class="qc-meta">${esc(C.timeLabel(m.created_at))}</div></div></div>`;
    }
    let inner = '';
    if (m.kind === 'card' && m.card_json) {
      const c = m.card_json, can = C.canOpenCard(S.role, c.type);
      const money = v => '₹' + Math.round(+v || 0).toLocaleString('en-IN');
      const rows = Object.keys(c).filter(k => k !== 'type' && k !== 'id').map(k =>
        `<div class="qc-card-r"><span>${esc(k)}</span><b>${esc(k === 'amount' || k === 'balance' ? money(c[k]) : c[k])}</b></div>`).join('');
      inner = `<div class="qc-card">
        <div class="qc-card-h">${ic('doc')}<span>${esc((c.type || '').toUpperCase())}</span><b>${esc(c.ref || c.name || c.id)}</b></div>
        ${rows}
        <div class="qc-card-a">${can
          ? `<button class="qc-card-b" data-card="${esc(c.type)}|${esc(c.id)}">Open ${esc(c.type)}</button>`
          : `<span class="qc-card-no">You do not have access to open a ${esc(c.type)}</span>`}</div>
      </div>`;
    } else if (m.kind === 'file') {
      inner = `<a class="qc-file" href="#" data-file="${esc(m.file_id)}|${esc(m.file_name)}">
        ${ic('doc')}<span><b>${esc(m.file_name)}</b><small>${fmtSize(m.file_size)}</small></span></a>`;
    } else {
      inner = `<div class="qc-txt">${linkify(m.body)}</div>`;
    }
    const run = C.isRun(prev, m);
    const who = (!mine && !run) ? `<div class="qc-who">${esc(nameOf(m.user_id))}</div>` : '';
    const ticks = mine ? ' <span class="qc-tick">✓✓</span>' : '';

    /* A reply shows what it answers. The quoted text is looked up in the
       messages already loaded; if that message is older than the current page
       we say so rather than render a blank quote. */
    let quote = '';
    if (m.reply_to) {
      const src = S.messages.find(x => +x.id === +m.reply_to);
      quote = `<div class="qc-quote"><b>${esc(src ? nameOf(src.user_id) : 'Earlier message')}</b>
        <span>${esc(src ? (src.body || '(attachment)') : 'Scroll up to load it').slice(0, 90)}</span></div>`;
    }

    /* Reactions, grouped by emoji with a count. Mine is highlighted so a
       second click reads as "remove mine", which is what it does. */
    const byEmoji = {};
    (m.reactions || []).forEach(r => { (byEmoji[r.emoji] = byEmoji[r.emoji] || []).push(r.user_id); });
    const reacts = Object.keys(byEmoji).length
      ? `<div class="qc-reacts">${Object.keys(byEmoji).map(e =>
          `<button class="qc-react ${byEmoji[e].indexOf(S.me) >= 0 ? 'on' : ''}" data-react="${m.id}|${esc(e)}"
             title="${esc(byEmoji[e].map(nameOf).join(', '))}">${esc(e)} ${byEmoji[e].length}</button>`).join('')}</div>`
      : '';

    const acts = `<div class="qc-acts">
      <button class="qc-act" data-reply="${m.id}" title="Reply">${ic('reply')}</button>
      <button class="qc-act" data-emoji="${m.id}" title="React">🙂</button>
      ${mine ? `<button class="qc-act" data-del="${m.id}" title="Delete for everyone">${ic('trash')}</button>` : ''}
    </div>`;

    const hit = S.find && new RegExp(S.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(m.body || '');
    return `<div class="qc-m ${mine ? 'me' : ''} ${run ? 'run' : ''} ${hit ? 'hit' : ''}" data-mid="${m.id}">
      <div class="qc-bub">${quote}${who}${inner}<div class="qc-meta">${esc(C.timeLabel(m.created_at))}${ticks}</div>${reacts}</div>
      ${acts}</div>`;
  }
  function fmtSize(n) {
    n = +n || 0;
    return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
  }
  function nameOf(uid) {
    const u = S.users.find(x => x.id === uid);
    return u ? u.name : 'Someone';
  }
  /* Links, phone numbers and emails become clickable — escaped FIRST, so a
     message body can never inject markup. */
  function linkify(text) {
    let s = esc(text || '');
    s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\b([\w.+-]+@[\w-]+\.[\w.]+)\b/g, '<a href="mailto:$1">$1</a>');
    s = s.replace(/(^|\s)(\+?\d[\d\s-]{8,14}\d)(?=\s|$)/g, (mm, a, p) => a + '<a href="tel:' + p.replace(/\s/g, '') + '">' + p + '</a>');
    return s.replace(/\n/g, '<br>');
  }

  function paintConv() {
    const host = document.getElementById('qcConv'); if (!host) return;
    const t = thread();
    if (!t) {
      host.innerHTML = `<div class="qc-empty qc-center"><div class="t">Pick a conversation</div>
        <div>Every message about a lead, a customer or a colleague lives in QuickLimes.</div></div>`;
      return;
    }
    const groups = C.groupByDay(S.messages, new Date().toISOString());
    let body = '';
    groups.forEach(g => {
      body += `<div class="qc-day"><span>${esc(g.day)}</span></div>`;
      let prev = null;
      g.messages.forEach(m => { body += msgHTML(m, prev); prev = m; });
    });
    if (!S.messages.length) {
      body = `<div class="qc-empty qc-center"><div class="t">No messages yet</div>
        <div>Say hello, or share a quotation.</div></div>`;
    }
    host.innerHTML = `
      <div class="qc-conv-h">
        <button class="qc-icon qc-only-mob" id="qcBack">${ic('back')}</button>
        ${avatar(t.title, 'sm')}
        <div class="qc-conv-t"><b>${esc(t.title)}</b><small>${esc(t.subtitle || kindLabel(t.kind))}</small></div>
        <button class="qc-icon" id="qcFind" title="Search in this conversation">${ic('search')}</button>
        <button class="qc-icon" id="qcInfo" title="Conversation details">${ic('info')}</button>
        <button class="qc-icon" id="qcClose2" title="Close">${ic('x')}</button>
      </div>
      ${S.finding ? `<div class="qc-find">${ic('search')}
        <input id="qcFindIn" placeholder="Search in this conversation" value="${esc(S.find)}">
        <span class="qc-find-n" id="qcFindN"></span>
        <button class="qc-icon" id="qcFindX">${ic('x')}</button></div>` : ''}
      ${S.details ? detailsHTML(t) : ''}
      <div class="qc-msgs" id="qcMsgs">
        ${S.hasMore ? '<button class="qc-more" id="qcMore">Load earlier messages</button>' : ''}
        ${body}
      </div>
      <div class="qc-comp">
        ${S.replyTo ? `<div class="qc-replying">
          <div><b>Replying to ${esc(nameOf((S.messages.find(x => +x.id === +S.replyTo) || {}).user_id))}</b>
          <span>${esc(((S.messages.find(x => +x.id === +S.replyTo) || {}).body || '(attachment)')).slice(0, 80)}</span></div>
          <button class="qc-icon" id="qcReplyX" title="Cancel reply">${ic('x')}</button></div>` : ''}
        <div class="qc-comp-r">
          <button class="qc-icon" id="qcAttach" title="Attach or share a record">${ic('plus')}</button>
          <button class="qc-note-t ${S.noteMode ? 'on' : ''}" id="qcNote" title="Internal note — not sent to the customer">${ic('note')}Note</button>
          <textarea id="qcIn" rows="1" placeholder="${S.noteMode ? 'Write an internal note…' : 'Type a message…'}"></textarea>
          <button class="qc-send" id="qcSend" title="Send">${ic('send')}</button>
        </div>
        ${S.noteMode ? '<div class="qc-note-hint">This will be saved as an internal note. It is never sent to the customer.</div>' : ''}
      </div>`;

    const $ = id => document.getElementById(id);
    if ($('qcBack')) $('qcBack').onclick = () => {
      S.threadId = null; stopPoll();
      document.getElementById('qlIm').classList.remove('conv');
      paintConv(); paintList();
    };
    if ($('qcClose2')) $('qcClose2').onclick = close;
    if ($('qcInfo')) $('qcInfo').onclick = () => { S.details = !S.details; paintConv(); };
    if ($('qcNote')) $('qcNote').onclick = () => { S.noteMode = !S.noteMode; paintConv(); $('qcIn').focus(); };
    if ($('qcSend')) $('qcSend').onclick = send;
    if ($('qcMore')) $('qcMore').onclick = loadEarlier;
    if ($('qcAttach')) $('qcAttach').onclick = attachMenu;
    const inp = $('qcIn');
    if (inp) {
      inp.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
      inp.oninput = () => { inp.style.height = 'auto'; inp.style.height = Math.min(120, inp.scrollHeight) + 'px'; };
      inp.focus();
    }
    if ($('qcFind')) $('qcFind').onclick = () => { S.finding = !S.finding; if (!S.finding) S.find = ''; paintConv(); };
    if ($('qcFindX')) $('qcFindX').onclick = () => { S.finding = false; S.find = ''; paintConv(); };
    if ($('qcReplyX')) $('qcReplyX').onclick = () => { S.replyTo = null; paintConv(); };
    const fi = $('qcFindIn');
    if (fi) {
      fi.oninput = e => {
        S.find = e.target.value;
        /* Repaint only the matches rather than the whole thread on every
           keystroke — the bubbles are already in the DOM. */
        let n = 0;
        host.querySelectorAll('.qc-m').forEach(el => {
          const txt = (el.innerText || '');
          const on = S.find && txt.toLowerCase().indexOf(S.find.toLowerCase()) >= 0;
          el.classList.toggle('hit', !!on); if (on) n++;
        });
        const c = $('qcFindN'); if (c) c.textContent = S.find ? (n + ' found') : '';
        const first = host.querySelector('.qc-m.hit'); if (first) first.scrollIntoView({ block: 'center' });
      };
      fi.focus();
    }
    host.querySelectorAll('[data-reply]').forEach(b => b.onclick = () => { S.replyTo = +b.dataset.reply; paintConv(); });
    host.querySelectorAll('[data-del]').forEach(b => b.onclick = () => removeMsg(+b.dataset.del));
    host.querySelectorAll('[data-react]').forEach(b => b.onclick = () => {
      const [id, emoji] = b.dataset.react.split('|');
      toggleReact(+id, emoji, b.classList.contains('on'));
    });
    host.querySelectorAll('[data-emoji]').forEach(b => b.onclick = () => emojiPicker(+b.dataset.emoji));
    host.querySelectorAll('[data-card]').forEach(b => b.onclick = () => {
      const [type, id] = b.dataset.card.split('|'); openRecord(type, id);
    });
    host.querySelectorAll('[data-file]').forEach(a => a.onclick = e => {
      e.preventDefault(); const [id, name] = a.dataset.file.split('|'); downloadFile(id, name);
    });
    document.getElementById('qlIm').classList.add('conv');
  }
  function kindLabel(k) {
    return ({ dm: 'Direct message', group: 'Group', lead: 'Lead', customer: 'Customer',
              supplier: 'Supplier', business: 'Business' })[k] || '';
  }
  function detailsHTML(t) {
    const m = t.meta || {};
    const row = (k, v) => v ? `<div class="qc-d-r"><span>${esc(k)}</span><b>${esc(v)}</b></div>` : '';
    const links = [];
    if (m.leadId) links.push(`<button class="qc-d-b" data-go="lead|${esc(m.leadId)}">View lead</button>`);
    if (t.kind === 'customer' || t.kind === 'supplier') links.push(`<button class="qc-d-b" data-go="party|${esc(t.subject_key || '')}">View ${esc(t.kind)}</button>`);
    if (m.website) links.push(`<a class="qc-d-b" href="${esc(m.website)}" target="_blank" rel="noopener noreferrer">Website</a>`);
    if (m.phone) links.push(`<a class="qc-d-b" href="tel:${esc(m.phone)}">Call ${esc(m.phone)}</a>`);
    const out = `<div class="qc-details">
      ${row('Industry', m.industry)}${row('Location', m.city || m.address)}
      ${row('Phone', m.phone)}${row('Rating', m.rating)}${row('Lead status', m.status)}
      ${row('Conversation', kindLabel(t.kind))}
      ${links.length ? `<div class="qc-d-a">${links.join('')}</div>` : ''}
      ${!Object.keys(m).length ? '<div class="qc-d-none">No business details were captured when this conversation was opened.</div>' : ''}
    </div>`;
    setTimeout(() => {
      document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
        const [what, id] = b.dataset.go.split('|');
        if (what === 'lead') location.href = 'discover.html';
        else location.href = 'parties.html';
      });
    }, 0);
    return out;
  }

  async function loadEarlier() {
    if (!S.messages.length) return;
    const r = await api({ action: 'messages', thread_id: S.threadId, before_id: S.messages[0].id, limit: 40 });
    if (!r.ok) return;
    S.messages = (r.messages || []).concat(S.messages);
    S.hasMore = !!r.has_more;
    paintConv();
  }

  async function send() {
    const inp = document.getElementById('qcIn'); if (!inp) return;
    const body = inp.value.trim(); if (!body) return;
    inp.value = ''; inp.style.height = 'auto';
    const kind = S.noteMode ? 'note' : 'text';
    /* Optimistic: the message appears immediately with the id the server will
       confirm on the next poll. A chat that waits for a round trip before
       showing your own words feels broken even when it is working. */
    const tmp = { id: 'tmp' + Date.now(), user_id: S.me, kind, body,
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' ') };
    S.messages.push(tmp); paintConv(); scrollEnd();
    const replyTo = S.replyTo; S.replyTo = null;
    tmp.reply_to = replyTo || null;
    const r = await api({ action: 'send', thread_id: S.threadId, kind, body, reply_to: replyTo || 0 });
    if (!r.ok) {
      S.messages = S.messages.filter(m => m.id !== tmp.id);
      paintConv();
      QLShell.toast(r.error === 'Forbidden' ? 'You do not have permission to send that' : 'Message not sent', 'err');
      return;
    }
    tmp.id = r.id; S.lastId = Math.max(S.lastId, r.id);
    const t = thread();
    if (t && kind !== 'note') { t.last_body = body; t.last_at = r.at; }
    paintList();
  }

  const QUICK = ['👍', '✅', '🙏', '🔥', '❓', '😀'];
  function emojiPicker(id) {
    QLShell.panel({ title: 'React', body: `<div class="qc-emo">${QUICK.map(e =>
      `<button class="qc-emo-b" data-e="${e}">${e}</button>`).join('')}</div>`,
      actions: [{ label: 'Cancel', onClick: () => QLShell.closeModal() }],
      onMount: el => el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => {
        QLShell.closeModal(); toggleReact(id, b.dataset.e, false);
      }) });
  }
  async function toggleReact(id, emoji, off) {
    const m = S.messages.find(x => +x.id === +id); if (!m) return;
    m.reactions = m.reactions || [];
    /* Optimistic, then reconciled by the poll — a reaction that waits for a
       round trip feels unresponsive for what is a one-tap gesture. */
    if (off) m.reactions = m.reactions.filter(r => !(r.user_id === S.me && r.emoji === emoji));
    else if (!m.reactions.some(r => r.user_id === S.me && r.emoji === emoji)) m.reactions.push({ user_id: S.me, emoji });
    paintConv();
    await api({ action: 'react', message_id: id, emoji, off: !!off });
  }
  async function removeMsg(id) {
    if (!confirm('Delete this message for everyone?')) return;
    const r = await api({ action: 'remove', message_id: id });
    if (!r.ok || !r.removed) { QLShell.toast('Could not delete that message', 'err'); return; }
    const m = S.messages.find(x => +x.id === +id);
    if (m) { m.deleted_at = '1'; m.body = null; m.card_json = null; }
    paintConv();
  }

  function scrollEnd() {
    const m = document.getElementById('qcMsgs');
    if (m) m.scrollTop = m.scrollHeight;
  }

  /* ── realtime (polling) ───────────────────────────────────────────────── */
  function startPoll() {
    stopPoll();
    S.pollTimer = setInterval(async () => {
      if (!S.open || !S.threadId) return;
      const r = await api({ action: 'messages', thread_id: S.threadId, since_id: S.lastId, limit: 50 });
      if (!r.ok || !r.messages || !r.messages.length) return;
      const fresh = r.messages.filter(m => !S.messages.some(x => x.id === m.id));
      if (!fresh.length) return;
      S.messages = S.messages.concat(fresh);
      S.lastId = S.messages[S.messages.length - 1].id;
      paintConv(); scrollEnd(); markRead();
    }, 5000);
  }
  function stopPoll() { if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; } }

  /* ── attachments and record sharing ───────────────────────────────────── */
  function attachMenu() {
    QLShell.panel({
      title: 'Attach or share', sub: 'Everything stays inside QuickLimes',
      body: `<div class="qc-att">
        <button class="qc-att-b" data-a="file">📎 Upload a file <small>PDF, image, Excel, Word</small></button>
        <button class="qc-att-b" data-a="invoice">🧾 Share a sales invoice</button>
        <button class="qc-att-b" data-a="bill">📥 Share a purchase bill</button>
        <button class="qc-att-b" data-a="customer">👤 Share a customer</button>
        <button class="qc-att-b" data-a="supplier">🏭 Share a supplier</button>
      </div>`,
      actions: [{ label: 'Cancel', onClick: () => QLShell.closeModal() }],
      onMount: el => el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
        const a = b.dataset.a;
        QLShell.closeModal();
        if (a === 'file') pickFile(); else pickRecord(a);
      })
    });
  }
  function pickFile() {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.doc,.docx';
    i.onchange = async () => {
      const f = i.files && i.files[0]; if (!f) return;
      if (f.size > 15 * 1024 * 1024) { QLShell.toast('That file is over 15 MB', 'err'); return; }
      QLShell.toast('Uploading…');
      try {
        const buf = await f.arrayBuffer();
        let bin = ''; const b = new Uint8Array(buf);
        for (let k = 0; k < b.length; k++) bin += String.fromCharCode(b[k]);
        const p = JSON.parse(localStorage.getItem('ql_plant') || '{}');
        const up = await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'put', plant_id: p.id, company_id: window.QLD ? QLD.activeCo : '',
            token: p.token, name: f.name, mime: f.type, data: btoa(bin) }) }).then(r => r.json());
        if (!up || !up.ok) { QLShell.toast('Upload failed', 'err'); return; }
        const r = await api({ action: 'send', thread_id: S.threadId, kind: 'file',
          file: { id: up.id, name: f.name, mime: f.type, size: f.size } });
        if (r.ok) { await openThread(S.threadId); QLShell.toast('Sent', 'ok'); }
        else QLShell.toast('Could not send the file', 'err');
      } catch (e) { QLShell.toast('Upload failed', 'err'); }
    };
    i.click();
  }
  /* Only records this ROLE may see are offered, and the server checks again. */
  function pickRecord(type) {
    const Q = window.QLD;
    if (!C.canOpenCard(S.role, type)) { QLShell.toast('You do not have access to ' + type + ' records', 'err'); return; }
    let list = [];
    if (type === 'invoice') list = (Q.salesRows() || []).slice(0, 60).map(r =>
      ({ id: r.inv, ref: r.inv, party: r.party, date: r.date, amount: r.total, status: r.status }));
    else if (type === 'bill') list = (Q.purchaseRows() || []).slice(0, 60).map(r =>
      ({ id: r.bill, ref: r.bill, party: r.sup, date: r.date, amount: r.total, status: r.status }));
    else if (type === 'customer' || type === 'supplier') list = (Q.partyRows() || [])
      .filter(p => (p.type || 'customer') === (type === 'supplier' ? 'supplier' : 'customer'))
      .slice(0, 80).map(p => ({ id: p.id || p.name, name: p.name, gstin: p.gstin, phone: p.phone }));
    if (!list.length) { QLShell.toast('Nothing to share yet', 'err'); return; }
    QLShell.panel({
      title: 'Share a ' + type, wide: true,
      body: `<div class="qc-pick">${list.map((r, i) =>
        `<button class="qc-pick-b" data-i="${i}"><b>${esc(r.ref || r.name)}</b>
          <small>${esc(r.party || r.gstin || '')}${r.amount != null ? ' · ₹' + Math.round(r.amount).toLocaleString('en-IN') : ''}</small></button>`).join('')}</div>`,
      actions: [{ label: 'Cancel', onClick: () => QLShell.closeModal() }],
      onMount: el => el.querySelectorAll('[data-i]').forEach(b => b.onclick = async () => {
        const card = C.cardSummary(type, list[+b.dataset.i]);
        QLShell.closeModal();
        if (!card) { QLShell.toast('That record cannot be shared', 'err'); return; }
        const r = await api({ action: 'send', thread_id: S.threadId, kind: 'card', card });
        if (r.ok) { await openThread(S.threadId); } else QLShell.toast(r.error === 'Forbidden' ? 'Not permitted' : 'Could not share', 'err');
      })
    });
  }
  function openRecord(type, id) {
    const go = { invoice: 'sales.html', bill: 'purchase.html', customer: 'parties.html',
                 supplier: 'parties.html', payment: 'payments.html', lead: 'discover.html' }[type];
    if (go) location.href = go;
  }
  async function downloadFile(id, name) {
    const p = JSON.parse(localStorage.getItem('ql_plant') || '{}');
    const r = await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get', plant_id: p.id, company_id: window.QLD ? QLD.activeCo : '', token: p.token, id }) })
      .then(x => x.json()).catch(() => null);
    if (!r || !r.ok || !r.data) { QLShell.toast('That file is no longer available', 'err'); return; }
    const bin = atob(r.data), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: r.mime || 'application/octet-stream' }));
    const a = document.createElement('a'); a.href = url; a.download = name || 'file'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ── create a group ───────────────────────────────────────────────────── */
  async function newGroup() {
    const r = await api({ action: 'users' });
    if (!r.ok) { QLShell.toast('Could not load your team', 'err'); return; }
    S.users = r.users || []; S.me = r.me || S.me;
    const others = S.users.filter(u => u.id !== S.me);
    QLShell.panel({
      title: 'New group', sub: 'Sales Team, Accounts Team, Management…',
      body: `<input class="qlf-input" id="qcGName" placeholder="Group name" style="width:100%;margin-bottom:12px">
        <div class="qc-pick">${others.map(u =>
          `<label class="qc-pick-b" style="display:flex;gap:10px;align-items:center;cursor:pointer">
            <input type="checkbox" value="${esc(u.id)}" class="qc-gm">
            <span><b>${esc(u.name || u.phone)}</b><small>${esc(u.role)}</small></span></label>`).join('')}</div>`,
      actions: [
        { label: 'Cancel', onClick: () => QLShell.closeModal() },
        { label: 'Create', primary: true, onClick: async el => {
            const name = (document.getElementById('qcGName') || {}).value || '';
            const picked = [...el.querySelectorAll('.qc-gm:checked')].map(x => x.value);
            if (!name.trim()) { QLShell.toast('Give the group a name'); return; }
            if (!picked.length) { QLShell.toast('Pick at least one member'); return; }
            QLShell.closeModal();
            /* The subject key is the name — so "Sales Team" is one group, not a
               new one each time somebody creates it again. */
            const t = await api({ action: 'open', kind: 'group',
              subject_key: 'group:' + name.trim().toUpperCase(), title: name.trim(),
              subtitle: (picked.length + 1) + ' members', members: picked });
            if (!t.ok) { QLShell.toast('Could not create the group', 'err'); return; }
            await loadThreads(); openThread(t.thread.id);
          } }
      ]
    });
  }

  /* ── start a direct message ───────────────────────────────────────────── */
  async function newDirect() {
    const r = await api({ action: 'users' });
    if (!r.ok) { QLShell.toast('Could not load your team', 'err'); return; }
    S.users = r.users || []; S.me = r.me || S.me;
    const others = S.users.filter(u => u.id !== S.me);
    if (!others.length) { QLShell.toast('No other users on this account yet — add them in Settings', 'err'); return; }
    QLShell.panel({
      title: 'Message a colleague',
      body: `<div class="qc-pick">${others.map(u =>
        `<button class="qc-pick-b" data-u="${esc(u.id)}"><b>${esc(u.name || u.phone)}</b><small>${esc(u.role)}</small></button>`).join('')}</div>`,
      actions: [{ label: 'Cancel', onClick: () => QLShell.closeModal() }],
      onMount: el => el.querySelectorAll('[data-u]').forEach(b => b.onclick = async () => {
        QLShell.closeModal();
        const u = others.find(x => x.id === b.dataset.u);
        const t = await api({ action: 'open', kind: 'dm', user_id: u.id, title: u.name || u.phone, subtitle: u.role });
        if (!t.ok) { QLShell.toast('Could not open that chat', 'err'); return; }
        await loadThreads(); openThread(t.thread.id);
      })
    });
  }

  /* ── public: open a conversation ABOUT something ──────────────────────── */
  async function openFor(ref) {
    const key = C.subjectKey(ref);
    if (!key) { QLShell.toast('This record has nothing to identify it, so a conversation cannot be opened', 'err'); return; }
    const h = C.threadTitle(ref);
    open();
    const r = await api({ action: 'open', kind: ref.kind || 'business', subject_key: key.key,
      title: h.title, subtitle: h.subtitle, meta: ref.meta || {} });
    if (!r.ok) {
      S.error = r.error === 'no_user' ? r.message : (r.error || 'Could not open the conversation');
      paintList(); return;
    }
    await loadThreads();
    openThread(r.thread.id);
  }

  function badge() {
    const b = document.getElementById('qlImBadge');
    if (!b) return;
    b.textContent = S.unread > 99 ? '99+' : String(S.unread || '');
    b.style.display = S.unread ? '' : 'none';
  }

  /* ── NOTIFICATIONS ───────────────────────────────────────────────────────
     A short synthesised blip — no asset to ship and nothing for an ad blocker
     to refuse. Deliberately quiet and deliberately rate-limited: one sound per
     poll however many messages arrived, because six pings in a row is how a
     notification gets muted permanently. */
  let _ac = null, _lastPing = 0;
  function ping() {
    const now = Date.now(); if (now - _lastPing < 4000) return; _lastPing = now;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      _ac = _ac || new AC();
      const o = _ac.createOscillator(), g = _ac.createGain();
      o.connect(g); g.connect(_ac.destination);
      o.frequency.value = 760; g.gain.value = 0.04;
      o.start(); o.stop(_ac.currentTime + 0.09);
    } catch (_) {}
  }
  /* Desktop notification only if the user already granted it. Asking on page
     load is the prompt everybody denies; chat asks the first time YOU open it. */
  function desktopNote(title, body, threadId) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const n = new Notification(title, { body: body, tag: 'qlim-' + threadId });
      n.onclick = () => { window.focus(); open(); openThread(threadId); n.close(); };
    } catch (_) {}
  }
  function askNotifyOnce() {
    try {
      if (!('Notification' in window) || Notification.permission !== 'default') return;
      if (localStorage.getItem('ql_im_asked')) return;
      localStorage.setItem('ql_im_asked', '1');
      Notification.requestPermission();
    } catch (_) {}
  }

  /* Unread poll while the drawer is CLOSED, so the header badge is live
     without holding a conversation open. Cheap: one query, no message bodies. */
  let _seenUnread = null;
  async function pollUnread() {
    const p = JSON.parse(localStorage.getItem('ql_plant') || '{}');
    if (!p.id || !p.token) return;
    const r = await api({ action: 'threads' });
    if (!r || !r.ok) return;
    const before = _seenUnread;
    S.threads = r.threads || []; S.unread = r.unread || 0; badge();
    /* Announce only a RISE, and only after a first baseline — otherwise the
       first poll of every page load would announce mail you already read. */
    if (before != null && S.unread > before) {
      const t = S.threads.find(x => (x.unread || 0) > 0);
      const n = S.unread - before;
      ping();
      if (t) {
        QLShell.toast(n + ' new message' + (n === 1 ? '' : 's') + ' · ' + t.title, 'ok');
        desktopNote(t.title, C.previewOf(t), t.id);
      }
    }
    _seenUnread = S.unread;
  }

  window.QLIM = {
    open, close, openFor, toggle: () => (S.open ? close() : open()),
    unread: () => S.unread, refreshBadge: pollUnread
  };

  /* Identity, once, on load — the composer needs to know who "me" is before
     the first message is drawn. */
  (async function boot() {
    const p = JSON.parse(localStorage.getItem('ql_plant') || '{}');
    if (!p.id || !p.token) return;
    S.role = p.role || 'sales';
    const r = await api({ action: 'users' });
    if (r && r.ok) { S.users = r.users || []; S.me = r.me || ''; }
    pollUnread();
    setInterval(pollUnread, 60000);
  })();
})();
