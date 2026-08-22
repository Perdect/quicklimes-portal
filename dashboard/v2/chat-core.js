/* ═══════════════════════════════════════════════════════════════════════
   INTERNAL CHAT — the pure parts.

   Thread identity, date grouping, filtering, preview text, ERP card
   summaries. No DOM, no network. chat-core.test.js drives this, and chat.js
   renders what it returns.

   The one idea worth stating up front: a conversation is identified by its
   SUBJECT, not by its title. `subjectKey` turns a lead, a customer, a
   supplier or a pair of colleagues into a stable string, and the server has
   a UNIQUE index on it. That is what makes "click Message twice" open one
   conversation instead of two — the database refuses the second, rather than
   the client checking first and racing itself.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var S = function (x) { return String(x == null ? '' : x); };
  var norm = function (x) { return S(x).toUpperCase().replace(/\s+/g, ' ').trim(); };

  /* ── SUBJECT IDENTITY ────────────────────────────────────────────────────
     A discovered business has a place_id from Google and a name. Prefer the
     id: two sugar mills can share a name, and a name can be re-typed. Fall
     back to the normalised name only when there is no id, and say which was
     used so a caller can tell a certain match from a probable one. */
  function subjectKey(ref) {
    ref = ref || {};
    var kind = ref.kind || 'business';
    if (kind === 'dm') {
      var pair = [S(ref.me), S(ref.user)].filter(Boolean).sort();
      return pair.length === 2 ? { key: pair.join('|'), how: 'pair' } : null;
    }
    var id = S(ref.id || ref.placeId || ref.leadId || ref.gstin).trim();
    if (id) return { key: kind + ':' + id, how: 'id' };
    var n = norm(ref.name);
    if (!n) return null;
    return { key: kind + ':name:' + n, how: 'name' };
  }

  /* What the conversation header shows. Subtitle is the business's own
     description — industry and place — because that is how the user
     recognises which of four sugar mills this is. */
  function threadTitle(ref) {
    ref = ref || {};
    var bits = [ref.industry, ref.city || ref.state].filter(Boolean);
    return { title: S(ref.name).trim(), subtitle: bits.join(' · ') };
  }

  /* ── DATE GROUPING ───────────────────────────────────────────────────────
     Messages carry a full timestamp; a reader wants "Today", "Yesterday", or
     a date. `now` is passed in so the grouping is deterministic and testable
     rather than depending on when the test happens to run. */
  function dayLabel(iso, now) {
    var d = S(iso).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
    var today = S(now || new Date().toISOString()).slice(0, 10);
    if (d === today) return 'Today';
    /* UTC throughout. 'T00:00' parses as LOCAL midnight and toISOString()
       then converts back to UTC, which in IST (+5:30) lands on the PREVIOUS
       day — so yesterday's messages were labelled with a date instead of
       "Yesterday". Anchoring both sides at 'T00:00:00Z' keeps the arithmetic
       in one frame. */
    var y = new Date(today + 'T00:00:00Z'); y.setUTCDate(y.getUTCDate() - 1);
    if (d === y.toISOString().slice(0, 10)) return 'Yesterday';
    var dt = new Date(d + 'T00:00:00Z');
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function groupByDay(messages, now) {
    var out = [], last = null;
    (messages || []).forEach(function (m) {
      var lbl = dayLabel(m.created_at, now);
      if (lbl !== last) { out.push({ day: lbl, messages: [] }); last = lbl; }
      out[out.length - 1].messages.push(m);
    });
    return out;
  }
  /* Consecutive messages from one person within a few minutes read as one
     turn; repeating the avatar and name on each is noise. */
  function isRun(prev, m) {
    if (!prev || !m) return false;
    if (prev.user_id !== m.user_id || prev.kind !== m.kind) return false;
    var a = Date.parse(S(prev.created_at).replace(' ', 'T') + 'Z');
    var b = Date.parse(S(m.created_at).replace(' ', 'T') + 'Z');
    return isFinite(a) && isFinite(b) && (b - a) < 5 * 60 * 1000;
  }
  function timeLabel(iso) {
    var t = Date.parse(S(iso).replace(' ', 'T') + 'Z');
    if (!isFinite(t)) return '';
    return new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }

  /* ── THREAD LIST ─────────────────────────────────────────────────────── */
  var FILTERS = [
    { key: 'all', label: 'All', test: function () { return true; } },
    { key: 'unread', label: 'Unread', test: function (t) { return (t.unread || 0) > 0; } },
    { key: 'lead', label: 'Leads', test: function (t) { return t.kind === 'lead' || t.kind === 'business'; } },
    { key: 'customer', label: 'Customers', test: function (t) { return t.kind === 'customer'; } },
    { key: 'supplier', label: 'Suppliers', test: function (t) { return t.kind === 'supplier'; } },
    { key: 'dm', label: 'Internal', test: function (t) { return t.kind === 'dm'; } },
    { key: 'group', label: 'Groups', test: function (t) { return t.kind === 'group'; } }
  ];
  function filterThreads(threads, filterKey, query) {
    var f = FILTERS.find(function (x) { return x.key === filterKey; }) || FILTERS[0];
    var q = norm(query);
    return (threads || []).filter(function (t) {
      if (!f.test(t)) return false;
      if (!q) return true;
      return norm(t.title).indexOf(q) >= 0 || norm(t.subtitle).indexOf(q) >= 0 ||
             norm(t.last_body).indexOf(q) >= 0;
    });
  }
  /* Unread badges are per THREAD; the global badge is their sum. Counting
     only threads I am a member of is the server's job — this just adds up
     what it returned. */
  function totalUnread(threads) {
    return (threads || []).reduce(function (a, t) { return a + (+t.unread || 0); }, 0);
  }

  function initials(name) {
    var parts = S(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  /* Stable colour from the name, so one business always looks the same. */
  function avatarTint(name) {
    var s = S(name), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  /* ── ERP CARDS ───────────────────────────────────────────────────────────
     §7: "Do not send raw database information." A card carries a SUMMARY —
     the few fields a person needs to recognise the record — plus its type and
     id. Opening it goes back through that module, where permissions are
     checked again. Anything not in this list is not shareable. */
  var CARD_FIELDS = {
    invoice:   ['ref', 'party', 'date', 'amount', 'status'],
    bill:      ['ref', 'party', 'date', 'amount', 'status'],
    customer:  ['name', 'gstin', 'phone', 'balance'],
    supplier:  ['name', 'gstin', 'phone', 'balance'],
    lead:      ['name', 'industry', 'city', 'phone', 'status'],
    business:  ['name', 'industry', 'city', 'phone', 'rating'],
    payment:   ['ref', 'party', 'date', 'amount', 'mode'],
    collection:['ref', 'party', 'date', 'amount', 'status'],
    quotation: ['ref', 'party', 'date', 'amount', 'status'],
    report:    ['name', 'period']
  };
  function cardSummary(type, record) {
    var allow = CARD_FIELDS[type];
    if (!allow) return null;                     // unknown type — never shared
    var out = { type: type, id: S(record && (record.id != null ? record.id : record.ref)) };
    allow.forEach(function (k) {
      if (record && record[k] != null && record[k] !== '') out[k] = record[k];
    });
    return out;
  }
  /* Which capability a viewer needs to OPEN the record behind a card. Mirrors
     the server's map; the server is the enforcement, this only decides
     whether to draw the button. */
  var CARD_CAP = {
    invoice: 'sales', quotation: 'sales', collection: 'sales', lead: 'sales', business: 'sales',
    customer: 'parties', supplier: 'parties', bill: 'purchase', payment: 'finance', report: 'reports'
  };
  var ROLE_CAPS = {
    owner: ['*'], admin: ['*'], partner: ['*'],
    accountant: ['sales', 'purchase', 'finance', 'gst', 'recon', 'reports', 'parties', 'extract'],
    sales: ['sales', 'parties', 'reports', 'extract'],
    purchase: ['purchase', 'parties', 'inventory', 'extract'],
    production: ['production', 'inventory'],
    dispatch: ['sales', 'production', 'inventory']
  };
  function roleCan(role, cap) {
    var a = ROLE_CAPS[S(role)] || [];
    return a.indexOf('*') >= 0 || a.indexOf(cap) >= 0;
  }
  function canOpenCard(role, type) {
    var cap = CARD_CAP[type];
    return !!cap && roleCan(role, cap);
  }

  /* What the thread list shows under the name. An internal note is never a
     preview — it is private, and a note surfacing in the list is how one gets
     read as something that was said to the customer. */
  function previewOf(thread) {
    var b = S(thread && thread.last_body).trim();
    return b || 'No messages yet';
  }

  var api = {
    subjectKey: subjectKey, threadTitle: threadTitle,
    dayLabel: dayLabel, groupByDay: groupByDay, isRun: isRun, timeLabel: timeLabel,
    FILTERS: FILTERS, filterThreads: filterThreads, totalUnread: totalUnread,
    initials: initials, avatarTint: avatarTint,
    cardSummary: cardSummary, canOpenCard: canOpenCard, roleCan: roleCan,
    CARD_FIELDS: CARD_FIELDS, CARD_CAP: CARD_CAP, previewOf: previewOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLChatCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
