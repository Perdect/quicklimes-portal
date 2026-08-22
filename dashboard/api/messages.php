<?php
/* ═══════════════════════════════════════════════════════════════════════
   /api/messages — QuickLimes' OWN chat.

   Not /api/chat. That one mirrors an external WhatsApp channel through Whapi;
   this is the firm's internal communication and is the source of truth for it.
   Both can eventually write into the same thread — chat_messages carries a
   `source` column for exactly that — but the internal system does not depend
   on WhatsApp being connected, configured, or reachable.

   POST { plant_id, company_id, token, action, … }
     threads                                  -> { ok, threads:[…], unread }
     open      { kind, subject_key, title, subtitle, meta } -> { ok, thread }
     messages  { thread_id, before_id?, since_id? }         -> { ok, messages:[…] }
     send      { thread_id, kind, body, card?, file? }      -> { ok, message }
     read      { thread_id, last_id }         -> { ok }
     react     { message_id, emoji, off? }    -> { ok }
     remove    { message_id }                 -> { ok }        (own, soft)
     users                                    -> { ok, users:[…] }
     members   { thread_id, add[], remove[] } -> { ok, members:[…] }

   WHY POLLING, NOT WEBSOCKETS: LiteSpeed + PHP on shared hosting cannot hold
   an open socket. `since_id` makes the poll cheap — it returns only what is
   new, and the client only polls the thread it is looking at. This is the same
   decision chat.php already made for the same reason; introducing a second
   realtime technology for this one feature would be the wrong trade.
   ═══════════════════════════════════════════════════════════════════════ */
require __DIR__ . '/db.php';
ql_cors();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') ql_out(['ok' => false, 'error' => 'POST only'], 405);

$b       = ql_body();
$plantId = (string)($b['plant_id'] ?? '');
$ctx     = ql_token_ctx($plantId);
if (!$ctx) ql_out(['ok' => false, 'error' => 'Unauthorized'], 401);

/* Tenant key from the TOKEN, never the body — the same rule every other
   endpoint here follows, so no later line can be tricked into another firm. */
$plantId = (string)$ctx['plant'];
$coId    = (string)($b['company_id'] ?? '');
$me      = (string)($ctx['user'] ?? '');
$role    = (string)($ctx['role'] ?? 'sales');

/* Every signed-in user of the firm may hold a conversation. Chat is not a
   privileged module: what is GUARDED is the records shared inside it, checked
   per record type below and again when the record itself is opened. */
/* An owner token minted before per-user login carries no user id. The owner is
   still a real person, so rather than refuse — which locks the account holder
   out of their own chat — give them a STABLE identity derived from the plant.
   'owner:<plant>' is attributable, survives re-login, and can never collide
   with a users.id (those are generated without a colon). What is never done is
   attributing a message to nobody. */
$isOwnerSeat = false;
if ($me === '') {
  $me = 'owner:' . $plantId;
  $isOwnerSeat = true;
}

ql_ensure_tables();
$db  = ql_db();
$now = gmdate('Y-m-d H:i:s');
$action = (string)($b['action'] ?? 'threads');

/* ── which ERP records may this role SHARE, and may a viewer OPEN one ──────
   A card carries a safe summary, never a database row. Opening the record
   still goes through that module's own capability-checked endpoint, so a chat
   message can never become a way around permissions — it is a pointer, and
   the pointer is checked when followed. */
function ql_card_cap($type) {
  $map = [
    'invoice' => 'sales', 'quotation' => 'sales', 'collection' => 'sales',
    'customer' => 'parties', 'supplier' => 'parties', 'lead' => 'sales', 'business' => 'sales',
    'bill' => 'purchase', 'payment' => 'finance', 'report' => 'reports'
  ];
  return $map[$type] ?? null;
}

/* A shared record, as text a person can read in WhatsApp. The interactive
   card cannot travel outside QuickLimes, and sending a bare id would be
   meaningless — so it becomes the same few allow-listed fields, written out. */
function ql_card_text($card) {
  if (!is_array($card)) return '';
  $skip = ['type' => 1, 'id' => 1];
  $lines = [strtoupper((string)($card['type'] ?? 'record')) . ' ' . (string)($card['ref'] ?? $card['name'] ?? $card['id'] ?? '')];
  foreach ($card as $k => $v) {
    if (isset($skip[$k]) || $v === '' || $v === null) continue;
    if ($k === 'ref' || $k === 'name') continue;
    $lines[] = ucfirst($k) . ': ' . (is_scalar($v) ? (string)$v : json_encode($v));
  }
  return implode("\n", $lines);
}

function ql_thread_row($db, $plantId, $id) {
  $st = $db->prepare("SELECT * FROM chat_threads WHERE id=? AND plant_id=? LIMIT 1");
  $st->execute([$id, $plantId]);
  return $st->fetch(PDO::FETCH_ASSOC) ?: null;
}
/* Membership is the access rule for a thread. Being in the same firm is not
   enough — a private DM between two colleagues is not readable by a third. */
function ql_is_member($db, $threadId, $uid) {
  $st = $db->prepare("SELECT 1 FROM chat_members WHERE thread_id=? AND user_id=? LIMIT 1");
  $st->execute([$threadId, $uid]);
  return (bool)$st->fetchColumn();
}
function ql_touch_thread($db, $threadId, $body, $by, $now) {
  $st = $db->prepare("UPDATE chat_threads SET last_at=?, last_body=?, last_by=? WHERE id=?");
  $st->execute([$now, mb_substr((string)$body, 0, 250), $by, $threadId]);
}

/* ── WHATSAPP CHANNEL ─────────────────────────────────────────────────────
   The bridge section 24 anticipated. The internal thread stays the source of
   truth; WhatsApp is one CHANNEL a message can leave by, recorded on the same
   row via `source`. Nothing here is required for internal chat to work — with
   no channel connected the rest of the system is unaffected, and this reports
   that state plainly instead of failing at send time. */
if ($action === 'wa_status') {
  $wa = ql_whapi($plantId);
  if ($wa['token'] === '') ql_out(['ok' => true, 'configured' => false, 'connected' => false]);
  $h = ql_wa_health($wa['token']);
  ql_out(['ok' => true, 'configured' => true, 'connected' => !empty($h['connected']),
          'status' => (string)($h['status'] ?? ''), 'sender' => $wa['sender']]);
}
/* Owner/admin only: a channel token is an account-wide credential, not
   something a sales seat should be able to point elsewhere. */
if ($action === 'wa_connect') {
  if (!in_array($role, ['owner', 'admin', 'partner'], true)) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);
  $tok = trim((string)($b['whapi_token'] ?? ''));
  $snd = preg_replace('/\D/', '', (string)($b['whapi_sender'] ?? ''));
  if ($tok !== '' && strlen($tok) < 20) ql_out(['ok' => false, 'error' => 'That does not look like a Whapi channel token']);
  ql_save_plant_integration($plantId, 'whapi_token', $tok);
  ql_save_plant_integration($plantId, 'whapi_sender', $snd);
  /* Verify immediately rather than reporting success for a token that cannot
     talk to anything — "saved" and "working" are different claims. */
  if ($tok === '') ql_out(['ok' => true, 'configured' => false, 'connected' => false]);
  $h = ql_wa_health($tok);
  ql_out(['ok' => true, 'configured' => true, 'connected' => !empty($h['connected']),
          'status' => (string)($h['status'] ?? '')]);
}

/* ── PRESENCE ─────────────────────────────────────────────────────────────
   Stamped by the client's own poll, so it costs one small write on a request
   that was happening anyway. Reported ONLY for QuickLimes users: an external
   business never gets a fabricated "online", because it is not a user of this
   app and saying otherwise would be a lie repeated on every open. */
if ($action === 'presence') {
  $typing = (int)($b['typing_in'] ?? 0);
  $db->prepare("INSERT INTO chat_presence (plant_id, user_id, seen_at, typing_in, typing_at)
                VALUES (?,?,?,?,?)
                ON DUPLICATE KEY UPDATE seen_at=VALUES(seen_at), typing_in=VALUES(typing_in), typing_at=VALUES(typing_at)")
     ->execute([$plantId, $me, $now, $typing ?: null, $typing ? $now : null]);

  /* 90 seconds for "online" and 8 for "typing" — both are how long the claim
     stays true after the last poll, and a stale claim is worse than none. */
  $st = $db->prepare("SELECT user_id, seen_at, typing_in,
      TIMESTAMPDIFF(SECOND, seen_at, ?) AS ago,
      TIMESTAMPDIFF(SECOND, COALESCE(typing_at, seen_at), ?) AS typing_ago
      FROM chat_presence WHERE plant_id=? AND user_id<>?");
  $st->execute([$now, $now, $plantId, $me]);
  $out = [];
  foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $out[] = ['user_id' => $r['user_id'], 'online' => ((int)$r['ago'] <= 90),
              'ago' => (int)$r['ago'],
              'typing_in' => ((int)$r['typing_ago'] <= 8) ? (int)$r['typing_in'] : null];
  }
  ql_out(['ok' => true, 'presence' => $out]);
}

/* ── THREADS: everything I am a member of ─────────────────────────────── */
if ($action === 'threads') {
  $st = $db->prepare(
    "SELECT t.*, m.last_read_id, m.muted,
            (SELECT COUNT(*) FROM chat_messages x
              WHERE x.thread_id=t.id AND x.id>m.last_read_id
                AND x.user_id<>? AND x.deleted_at IS NULL) AS unread,
            (SELECT COUNT(*) FROM chat_messages y
              WHERE y.thread_id=t.id AND y.id>m.last_read_id AND y.user_id<>?
                AND y.deleted_at IS NULL AND y.mentions LIKE ?) AS mentions_unread
       FROM chat_threads t
       JOIN chat_members m ON m.thread_id=t.id AND m.user_id=?
      WHERE t.plant_id=? AND t.company_id=? AND t.archived=0
      ORDER BY COALESCE(t.last_at, t.created_at) DESC
      LIMIT 200");
  $st->execute([$me, $me, '%,' . $me . ',%', $me, $plantId, $coId]);
  $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
  $total = 0;
  foreach ($rows as &$r) {
    $r['id'] = (int)$r['id']; $r['unread'] = (int)$r['unread'];
    $r['mentions_unread'] = (int)$r['mentions_unread'];
    $r['meta'] = $r['meta'] ? json_decode($r['meta'], true) : null;
    $total += $r['unread'];
  }
  ql_out(['ok' => true, 'threads' => $rows, 'unread' => $total]);
}

/* ── OPEN: get-or-create by SUBJECT ───────────────────────────────────────
   §8: "Never create duplicate conversations every time Message is clicked."
   That is enforced by UNIQUE(plant_id, company_id, kind, subject_key) — an
   INSERT IGNORE followed by a SELECT, so two clicks racing produce one row.
   A client-side "does it exist?" check would not. */
if ($action === 'open') {
  $kind = (string)($b['kind'] ?? 'dm');
  if (!in_array($kind, ['dm', 'group', 'lead', 'customer', 'supplier', 'business'], true)) {
    ql_out(['ok' => false, 'error' => 'bad_kind'], 400);
  }
  $subject = trim((string)($b['subject_key'] ?? ''));
  $members = (array)($b['members'] ?? []);

  if ($kind === 'dm') {
    /* A DM's identity is the PAIR, sorted — so A→B and B→A are one thread. */
    $other = (string)($b['user_id'] ?? '');
    if ($other === '' || $other === $me) ql_out(['ok' => false, 'error' => 'bad_user'], 400);
    $pair = [$me, $other]; sort($pair);
    $subject = implode('|', $pair);
    $members = $pair;
  }
  if ($subject === '') ql_out(['ok' => false, 'error' => 'no_subject'], 400);

  $title    = mb_substr(trim((string)($b['title'] ?? '')), 0, 180);
  $subtitle = mb_substr(trim((string)($b['subtitle'] ?? '')), 0, 180);
  $meta     = isset($b['meta']) && is_array($b['meta']) ? json_encode($b['meta']) : null;
  /* Denormalised so an inbound WhatsApp message can find this thread by number
     without scanning JSON. Normalised the same way wa-core does it: digits
     only, and a bare 10-digit Indian number gains its country code — otherwise
     "9829069545" and "919829069545" would be two different customers. */
  $phoneKey = preg_replace('/\D/', '', (string)(($b['meta']['phone'] ?? '')));
  if (strlen($phoneKey) === 10) $phoneKey = '91' . $phoneKey;
  if ($phoneKey === '') $phoneKey = null;

  $ins = $db->prepare(
    "INSERT IGNORE INTO chat_threads (plant_id, company_id, kind, subject_key, title, subtitle, meta, phone_key, created_by, created_at, last_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  $ins->execute([$plantId, $coId, $kind, $subject, $title, $subtitle, $meta, $phoneKey, $me, $now, $now]);

  $st = $db->prepare("SELECT * FROM chat_threads WHERE plant_id=? AND company_id=? AND kind=? AND subject_key=? LIMIT 1");
  $st->execute([$plantId, $coId, $kind, $subject]);
  $t = $st->fetch(PDO::FETCH_ASSOC);
  if (!$t) ql_out(['ok' => false, 'error' => 'open_failed'], 500);

  /* Keep the display fields fresh — a lead's name or city can change after the
     thread was first opened, and the conversation should not keep the old one. */
  if ($title !== '' && ($t['title'] !== $title || $t['subtitle'] !== $subtitle)) {
    $u = $db->prepare("UPDATE chat_threads SET title=?, subtitle=?, meta=COALESCE(?, meta), phone_key=COALESCE(?, phone_key) WHERE id=?");
    $u->execute([$title, $subtitle, $meta, $phoneKey, $t['id']]);
    $t['title'] = $title; $t['subtitle'] = $subtitle;
  }

  $add = array_values(array_unique(array_filter(array_merge([$me], array_map('strval', $members)))));
  $mi = $db->prepare("INSERT IGNORE INTO chat_members (thread_id, user_id, role, joined_at) VALUES (?,?,?,?)");
  foreach ($add as $uid) $mi->execute([$t['id'], $uid, $uid === $t['created_by'] ? 'admin' : 'member', $now]);

  $t['id'] = (int)$t['id'];
  $t['meta'] = $t['meta'] ? json_decode($t['meta'], true) : null;
  ql_out(['ok' => true, 'thread' => $t]);
}

/* Everything below acts on one thread and requires membership. */
$threadId = (int)($b['thread_id'] ?? 0);
if (in_array($action, ['messages', 'send', 'read', 'members', 'pins', 'unread', 'archive'], true)) {
  if ($threadId <= 0) ql_out(['ok' => false, 'error' => 'no_thread'], 400);
  if (!ql_thread_row($db, $plantId, $threadId)) ql_out(['ok' => false, 'error' => 'not_found'], 404);
  if (!ql_is_member($db, $threadId, $me)) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);
}

/* ── MESSAGES: cursor paging both ways ────────────────────────────────────
   `before_id` walks backwards through history a page at a time; `since_id` is
   the realtime poll. Neither ever loads a whole conversation — §21. */
if ($action === 'messages') {
  $limit  = max(1, min(100, (int)($b['limit'] ?? 40)));
  $before = (int)($b['before_id'] ?? 0);
  $since  = (int)($b['since_id'] ?? 0);

  if ($since > 0) {
    $st = $db->prepare("SELECT * FROM chat_messages WHERE thread_id=? AND plant_id=? AND id>? ORDER BY id ASC LIMIT ?");
    $st->bindValue(1, $threadId, PDO::PARAM_INT); $st->bindValue(2, $plantId);
    $st->bindValue(3, $since, PDO::PARAM_INT); $st->bindValue(4, $limit, PDO::PARAM_INT);
  } else {
    $sql = "SELECT * FROM chat_messages WHERE thread_id=? AND plant_id=?" . ($before > 0 ? " AND id<?" : "") . " ORDER BY id DESC LIMIT ?";
    $st = $db->prepare($sql);
    $i = 1; $st->bindValue($i++, $threadId, PDO::PARAM_INT); $st->bindValue($i++, $plantId);
    if ($before > 0) $st->bindValue($i++, $before, PDO::PARAM_INT);
    $st->bindValue($i, $limit, PDO::PARAM_INT);
  }
  $st->execute();
  $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
  if ($since <= 0) $rows = array_reverse($rows);

  $ids = array_map(function ($r) { return (int)$r['id']; }, $rows);
  $reacts = [];
  if ($ids) {
    $in = implode(',', array_fill(0, count($ids), '?'));
    $rs = $db->prepare("SELECT message_id, user_id, emoji FROM chat_reactions WHERE message_id IN ($in)");
    $rs->execute($ids);
    foreach ($rs->fetchAll(PDO::FETCH_ASSOC) as $r) $reacts[(int)$r['message_id']][] = $r;
  }
  foreach ($rows as &$r) {
    $r['id'] = (int)$r['id']; $r['thread_id'] = (int)$r['thread_id'];
    $r['card_json'] = $r['card_json'] ? json_decode($r['card_json'], true) : null;
    $r['reactions'] = $reacts[$r['id']] ?? [];
    /* A deleted message keeps its place in the thread so replies still make
       sense, but its content never leaves the server. */
    if ($r['deleted_at']) { $r['body'] = null; $r['card_json'] = null; $r['file_id'] = null; }
  }
  ql_out(['ok' => true, 'messages' => $rows, 'has_more' => count($rows) === $limit && $since <= 0]);
}

/* ── SEND ─────────────────────────────────────────────────────────────── */
if ($action === 'send') {
  $kind = (string)($b['kind'] ?? 'text');
  if (!in_array($kind, ['text', 'note', 'card', 'file'], true)) ql_out(['ok' => false, 'error' => 'bad_kind'], 400);
  $body = trim((string)($b['body'] ?? ''));
  $card = is_array($b['card'] ?? null) ? $b['card'] : null;
  $file = is_array($b['file'] ?? null) ? $b['file'] : null;

  if ($kind === 'card') {
    $type = (string)($card['type'] ?? '');
    $cap  = ql_card_cap($type);
    if (!$cap) ql_out(['ok' => false, 'error' => 'bad_card_type'], 400);
    /* The SENDER must be allowed to see the record they are sharing. The
       viewer is checked again when they open it — a card is a pointer, and
       both ends of the pointer are guarded. */
    if (!ql_role_can($role, $cap)) ql_out(['ok' => false, 'error' => 'Forbidden', 'need' => $cap], 403);
  }
  if ($kind === 'text' && $body === '') ql_out(['ok' => false, 'error' => 'empty'], 400);
  if ($kind === 'note' && $body === '') ql_out(['ok' => false, 'error' => 'empty'], 400);

  /* Mentions are validated against the thread's MEMBERS, not against the
     firm: @-ing somebody who cannot see the conversation would notify them
     about a thread they are then refused entry to. */
  $mentions = null;
  $want = array_filter(array_map('strval', (array)($b['mentions'] ?? [])));
  if ($want) {
    $in = implode(',', array_fill(0, count($want), '?'));
    $mq = $db->prepare("SELECT user_id FROM chat_members WHERE thread_id=? AND user_id IN ($in)");
    $mq->execute(array_merge([$threadId], $want));
    $okIds = array_column($mq->fetchAll(PDO::FETCH_ASSOC), 'user_id');
    if ($okIds) $mentions = ',' . implode(',', $okIds) . ',';
  }

  /* CHANNEL. 'internal' stays inside QuickLimes; 'whatsapp' also leaves by the
     connected channel and is recorded on the same row, so one thread carries
     both and the history stays in one place. A note is never sendable
     outward — that is the whole point of a note. */
  $channel = (string)($b['channel'] ?? 'internal');
  $waId = null;
  if ($channel === 'whatsapp') {
    if ($kind === 'note') ql_out(['ok' => false, 'error' => 'note_not_sendable',
      'message' => 'An internal note is never sent to the customer.'], 400);
    $wa = ql_whapi($plantId);
    if ($wa['token'] === '') ql_out(['ok' => false, 'error' => 'wa_not_configured',
      'message' => 'No WhatsApp channel is connected yet.'], 400);
    $t = ql_thread_row($db, $plantId, $threadId);
    $meta = $t && $t['meta'] ? json_decode($t['meta'], true) : [];
    $phone = preg_replace('/\D/', '', (string)($meta['phone'] ?? ''));
    if (strlen($phone) === 10) $phone = '91' . $phone;          // India, same rule wa-core uses
    if ($phone === '') ql_out(['ok' => false, 'error' => 'no_phone',
      'message' => 'This conversation has no phone number to send to.'], 400);
    $text = $kind === 'card'
      ? trim(($body !== '' ? $body . "\n" : '') . ql_card_text($card))
      : $body;
    if ($text === '') ql_out(['ok' => false, 'error' => 'empty'], 400);
    $r = ql_wa_send($wa['token'], $phone, $text);
    /* If the provider refuses, NOTHING is stored. A message that shows in the
       thread but never left is the worst outcome here — the user believes the
       customer has been told. */
    if (empty($r['ok'])) ql_out(['ok' => false, 'error' => 'wa_send_failed',
      'message' => (string)($r['error'] ?? 'WhatsApp refused the message')], 502);
    $waId = (string)($r['id'] ?? '');
  }

  $st = $db->prepare(
    "INSERT INTO chat_messages
      (plant_id, company_id, thread_id, user_id, kind, source, body, card_type, card_id, card_json,
       file_id, file_name, file_mime, file_size, reply_to, created_at, wa_id, mentions)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  $st->execute([
    $plantId, $coId, $threadId, $me, $kind,
    $channel === 'whatsapp' ? 'whatsapp' : 'internal',
    $body !== '' ? mb_substr($body, 0, 8000) : null,
    $card ? mb_substr((string)($card['type'] ?? ''), 0, 24) : null,
    $card ? mb_substr((string)($card['id'] ?? ''), 0, 190) : null,
    $card ? json_encode($card) : null,
    $file ? mb_substr((string)($file['id'] ?? ''), 0, 64) : null,
    $file ? mb_substr((string)($file['name'] ?? ''), 0, 190) : null,
    $file ? mb_substr((string)($file['mime'] ?? ''), 0, 80) : null,
    $file ? (int)($file['size'] ?? 0) : null,
    ((int)($b['reply_to'] ?? 0)) ?: null,
    $now, $waId, $mentions
  ]);
  $id = (int)$db->lastInsertId();

  /* An internal note is NOT the conversation's last message. It is a private
     annotation; letting it become the thread preview is how a note ends up
     read as something that was said to the customer. */
  if ($kind !== 'note') {
    $preview = $kind === 'card' ? ('Shared ' . (string)($card['type'] ?? 'record'))
             : ($kind === 'file' ? ('📎 ' . (string)($file['name'] ?? 'file')) : $body);
    ql_touch_thread($db, $threadId, $preview, $me, $now);
  }
  /* Sending marks it read for the sender — nobody has unread messages from
     themselves. */
  $mr = $db->prepare("UPDATE chat_members SET last_read_id=? WHERE thread_id=? AND user_id=? AND last_read_id<?");
  $mr->execute([$id, $threadId, $me, $id]);

  ql_out(['ok' => true, 'id' => $id, 'at' => $now]);
}

if ($action === 'read') {
  $last = (int)($b['last_id'] ?? 0);
  $st = $db->prepare("UPDATE chat_members SET last_read_id=? WHERE thread_id=? AND user_id=? AND last_read_id<?");
  $st->execute([$last, $threadId, $me, $last]);
  ql_out(['ok' => true]);
}

if ($action === 'react') {
  $mid = (int)($b['message_id'] ?? 0);
  $emoji = mb_substr(trim((string)($b['emoji'] ?? '')), 0, 8);
  if ($mid <= 0 || $emoji === '') ql_out(['ok' => false, 'error' => 'bad_input'], 400);
  $st = $db->prepare("SELECT thread_id FROM chat_messages WHERE id=? AND plant_id=? LIMIT 1");
  $st->execute([$mid, $plantId]);
  $tid = (int)$st->fetchColumn();
  if (!$tid || !ql_is_member($db, $tid, $me)) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);
  if (!empty($b['off'])) {
    $d = $db->prepare("DELETE FROM chat_reactions WHERE message_id=? AND user_id=? AND emoji=?");
    $d->execute([$mid, $me, $emoji]);
  } else {
    $i = $db->prepare("INSERT IGNORE INTO chat_reactions (message_id, user_id, emoji, at) VALUES (?,?,?,?)");
    $i->execute([$mid, $me, $emoji, $now]);
  }
  ql_out(['ok' => true]);
}

/* ARCHIVE — hide a conversation from the list without destroying its history.
   The thread list already filters archived=0. Any member may archive for the
   whole thread: these are shared conversations, and a per-person hide would
   need a column on chat_members and a story about what the others see. */
if ($action === 'archive') {
  if ($threadId <= 0 || !ql_is_member($db, $threadId, $me)) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);
  $st = $db->prepare("UPDATE chat_threads SET archived=? WHERE id=? AND plant_id=?");
  $st->execute([empty($b['off']) ? 1 : 0, $threadId, $plantId]);
  ql_out(['ok' => true]);
}

/* PIN — any member may pin; the thread's important messages are a shared
   artefact, not a private bookmark. Pinning is idempotent. */
if ($action === 'pin') {
  $mid = (int)($b['message_id'] ?? 0);
  $st = $db->prepare("SELECT thread_id FROM chat_messages WHERE id=? AND plant_id=? AND deleted_at IS NULL LIMIT 1");
  $st->execute([$mid, $plantId]);
  $tid = (int)$st->fetchColumn();
  if (!$tid || !ql_is_member($db, $tid, $me)) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);
  if (!empty($b['off'])) {
    $u = $db->prepare("UPDATE chat_messages SET pinned_at=NULL, pinned_by=NULL WHERE id=? AND plant_id=?");
    $u->execute([$mid, $plantId]);
  } else {
    $u = $db->prepare("UPDATE chat_messages SET pinned_at=?, pinned_by=? WHERE id=? AND plant_id=?");
    $u->execute([$now, $me, $mid, $plantId]);
  }
  ql_out(['ok' => true]);
}

/* The pinned messages of a thread, newest pin first. */
if ($action === 'pins') {
  if ($threadId <= 0 || !ql_is_member($db, $threadId, $me)) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);
  $st = $db->prepare("SELECT * FROM chat_messages WHERE thread_id=? AND plant_id=? AND pinned_at IS NOT NULL AND deleted_at IS NULL ORDER BY pinned_at DESC LIMIT 20");
  $st->execute([$threadId, $plantId]);
  $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
  foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['card_json'] = $r['card_json'] ? json_decode($r['card_json'], true) : null; }
  ql_out(['ok' => true, 'pins' => $rows]);
}

/* MARK UNREAD — walk the read marker BACK to just before this message, so the
   thread reappears in Unread with a truthful count. `read` deliberately only
   moves forward, so this is its own action rather than a smaller number
   passed to that one. */
if ($action === 'unread') {
  $mid = (int)($b['message_id'] ?? 0);
  if ($threadId <= 0 || !ql_is_member($db, $threadId, $me)) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);
  $st = $db->prepare("UPDATE chat_members SET last_read_id=? WHERE thread_id=? AND user_id=?");
  $st->execute([max(0, $mid - 1), $threadId, $me]);
  ql_out(['ok' => true]);
}

/* Own messages only. Soft — the row stays so replies above it still resolve,
   but the content is cleared on read. */
if ($action === 'remove') {
  $mid = (int)($b['message_id'] ?? 0);
  /* Which thread, before the update — needed to refresh its preview. */
  $tq = $db->prepare("SELECT thread_id FROM chat_messages WHERE id=? AND plant_id=? LIMIT 1");
  $tq->execute([$mid, $plantId]);
  $tid = (int)$tq->fetchColumn();

  $st = $db->prepare("UPDATE chat_messages SET deleted_at=? WHERE id=? AND plant_id=? AND user_id=? AND deleted_at IS NULL");
  $st->execute([$now, $mid, $plantId, $me]);
  $done = $st->rowCount() > 0;

  /* THE PREVIEW MUST NOT OUTLIVE THE MESSAGE. chat_threads.last_body is a
     denormalised copy, so deleting the newest message left its text sitting
     in the chat list — the one place a "deleted" message stayed readable.
     Recompute from the newest surviving message, and blank it if none is
     left. Internal notes are skipped here for the same reason they never
     become a preview in the first place. */
  if ($done && $tid) {
    $lq = $db->prepare(
      "SELECT kind, body, card_type, file_name, user_id, created_at
         FROM chat_messages
        WHERE thread_id=? AND plant_id=? AND deleted_at IS NULL AND kind<>'note'
        ORDER BY id DESC LIMIT 1");
    $lq->execute([$tid, $plantId]);
    $l = $lq->fetch(PDO::FETCH_ASSOC);
    if ($l) {
      $prev = $l['kind'] === 'card' ? ('Shared ' . (string)$l['card_type'])
            : ($l['kind'] === 'file' ? ('📎 ' . (string)$l['file_name']) : (string)$l['body']);
      $u = $db->prepare("UPDATE chat_threads SET last_at=?, last_body=?, last_by=? WHERE id=?");
      $u->execute([$l['created_at'], mb_substr($prev, 0, 250), $l['user_id'], $tid]);
    } else {
      $u = $db->prepare("UPDATE chat_threads SET last_body=NULL, last_by=NULL WHERE id=?");
      $u->execute([$tid]);
    }
  }
  ql_out(['ok' => true, 'removed' => $done]);
}

/* The firm's people, for starting a DM or building a group. Phone and role
   only — no password material, no cross-plant rows. */
if ($action === 'users') {
  $st = $db->prepare("SELECT id, name, phone, role FROM users WHERE plant_id=? AND active=1 ORDER BY name");
  $st->execute([$plantId]);
  $users = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
  /* The owner seat is a real person with no users row. Include it so their
     name resolves on their own messages instead of reading "Someone". */
  $on = $db->prepare("SELECT owner_name, plant_name, owner_phone FROM plants WHERE id=? LIMIT 1");
  $on->execute([$plantId]);
  $pl = $on->fetch(PDO::FETCH_ASSOC) ?: [];
  $ownerId = 'owner:' . $plantId;
  $already = false;
  foreach ($users as $u) if ($u['id'] === $ownerId) $already = true;
  if (!$already) {
    array_unshift($users, ['id' => $ownerId,
      'name' => ($pl['owner_name'] ?: ($pl['plant_name'] ?: 'Owner')),
      'phone' => (string)($pl['owner_phone'] ?? ''), 'role' => 'owner']);
  }
  ql_out(['ok' => true, 'users' => $users, 'me' => $me, 'owner_seat' => $isOwnerSeat]);
}

if ($action === 'members') {
  $t = ql_thread_row($db, $plantId, $threadId);
  $addl = array_filter(array_map('strval', (array)($b['add'] ?? [])));
  $reml = array_filter(array_map('strval', (array)($b['remove'] ?? [])));
  if ($addl || $reml) {
    /* Only a thread admin changes the membership of a group. A DM's pair is
       fixed by its subject_key and cannot be added to at all. */
    if ($t['kind'] === 'dm') ql_out(['ok' => false, 'error' => 'dm_fixed'], 400);
    $st = $db->prepare("SELECT role FROM chat_members WHERE thread_id=? AND user_id=? LIMIT 1");
    $st->execute([$threadId, $me]);
    if ((string)$st->fetchColumn() !== 'admin') ql_out(['ok' => false, 'error' => 'Forbidden'], 403);
    $ai = $db->prepare("INSERT IGNORE INTO chat_members (thread_id, user_id, role, joined_at) VALUES (?,?, 'member', ?)");
    foreach ($addl as $u) $ai->execute([$threadId, $u, $now]);
    $rd = $db->prepare("DELETE FROM chat_members WHERE thread_id=? AND user_id=? AND role<>'admin'");
    foreach ($reml as $u) $rd->execute([$threadId, $u]);
  }
  $st = $db->prepare(
    "SELECT m.user_id, m.role, u.name, u.phone
       FROM chat_members m LEFT JOIN users u ON u.id=m.user_id
      WHERE m.thread_id=?");
  $st->execute([$threadId]);
  ql_out(['ok' => true, 'members' => $st->fetchAll(PDO::FETCH_ASSOC) ?: []]);
}

ql_out(['ok' => false, 'error' => 'unknown_action'], 400);
