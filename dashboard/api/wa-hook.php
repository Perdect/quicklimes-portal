<?php
/* ═══════════════════════════════════════════════════════════════
   /api/wa-hook.php — Whapi's webhook lands here. This is how messages get IN.

   Configure in the Whapi channel settings:
     https://app.quicklimes.com/api/wa-hook.php?key=YOUR_WA_HOOK_SECRET&p=<plant_id>&c=<company_id>
   WA_HOOK_SECRET goes in api/config.php. Blank ⇒ this refuses everything: it is
   an unauthenticated public URL, so it fails CLOSED. Without that, anyone who
   found the URL could inject messages into your customers' threads.

   Idempotent: Whapi retries, and a UNIQUE on (plant_id, wa_id) means a retry
   updates rather than duplicating. A chat thread that double-prints every
   message is worse than one that lags.

   The PARSER is ql_wa_parse_message in db.php — pure, and tested against 50
   real captured webhooks (wa-hook.test.php). This file only stores.
   ═══════════════════════════════════════════════════════════════ */
require __DIR__ . '/db.php';

/* One inbound WhatsApp message into its QuickLimes thread, if that thread
   exists. Returns 1 when it wrote a row.

   Idempotent on wa_id: Whapi retries, and our own outbound already carries the
   provider id, so the echo of a message we sent UPDATES that row rather than
   printing it a second time. */
function ql_wa_bridge_into_thread($db, $plantId, $coId, $p) {
  $phone = preg_replace('/\D/', '', (string)($p['from_phone'] ?? ''));
  if (strlen($phone) === 10) $phone = '91' . $phone;
  if ($phone === '' || !empty($p['is_group'])) return 0;
  try {
    $q = $db->prepare("SELECT id FROM chat_threads WHERE plant_id=? AND company_id=? AND phone_key=? ORDER BY id LIMIT 1");
    $q->execute([$plantId, $coId, $phone]);
    $tid = (int)$q->fetchColumn();
    if (!$tid) return 0;

    $waId = (string)($p['wa_id'] ?? '');
    if ($waId !== '') {
      $ex = $db->prepare("SELECT id FROM chat_messages WHERE plant_id=? AND wa_id=? LIMIT 1");
      $ex->execute([$plantId, $waId]);
      if ($ex->fetchColumn()) return 0;                       // already here (retry, or our own echo)
    }
    $body = (string)($p['body'] ?? '');
    if ($body === '') $body = ql_wa_preview_text($p);
    $ins = $db->prepare(
      "INSERT INTO chat_messages (plant_id, company_id, thread_id, user_id, kind, source, body, created_at, wa_id)
       VALUES (?,?,?,?,?, 'whatsapp', ?,?,?)");
    /* Authored by the counterparty, not by any QuickLimes user. 'wa:<phone>'
       can never collide with a users.id and reads as what it is. */
    $ins->execute([$plantId, $coId, $tid, empty($p['from_me']) ? ('wa:' . $phone) : '', 'text',
      mb_substr($body, 0, 8000), (string)($p['at'] ?? gmdate('Y-m-d H:i:s')), $waId ?: null]);

    $db->prepare("UPDATE chat_threads SET last_at=?, last_body=?, last_by=? WHERE id=?")
       ->execute([(string)($p['at'] ?? gmdate('Y-m-d H:i:s')), mb_substr($body, 0, 250),
                  empty($p['from_me']) ? ('wa:' . $phone) : '', $tid]);
    return 1;
  } catch (Throwable $e) {
    /* The inbox write above already succeeded. A bridge failure must never
       make the webhook 500, or Whapi retries the whole batch forever. */
    return 0;
  }
}


header('Content-Type: application/json');

$secret = ql_wa_hook_secret();
if ($secret === '') { http_response_code(503); exit(json_encode(['ok' => false, 'error' => 'WA_HOOK_SECRET not set'])); }
if (!hash_equals($secret, (string)($_GET['key'] ?? ''))) { http_response_code(403); exit(json_encode(['ok' => false, 'error' => 'bad key'])); }

$plantId = (string)($_GET['p'] ?? '');
$coId    = (string)($_GET['c'] ?? '');
if ($plantId === '') { http_response_code(400); exit(json_encode(['ok' => false, 'error' => 'missing plant'])); }

$raw  = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) { http_response_code(400); exit(json_encode(['ok' => false, 'error' => 'bad json'])); }

ql_ensure_tables();
$db = ql_db();

/* The webhook URL is registered externally with the plant id baked into the
   query string, so it long outlives the account. If that account is gone (a
   company removal promoted a new main, or deleted it outright), inserting here
   would pile orphan chats/messages under a dead id that nothing ever reads.
   Ack with 200 so the provider stops retrying, and drop the payload. */
if (!ql_plant_exists($plantId)) { exit(json_encode(['ok' => true, 'skipped' => 'unknown plant'])); }

$n = 0; $st = 0; $bridged = 0;

/* ── messages ── */
if (!empty($body['messages']) && is_array($body['messages'])) {
  $insM = $db->prepare('INSERT INTO wa_messages
      (plant_id, company_id, chat_id, wa_id, from_me, from_phone, from_name, type, body, media_id, media_mime, media_name, media_size, preview, status, at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE body = VALUES(body), status = VALUES(status)');
  $upC = $db->prepare('INSERT INTO wa_chats (plant_id, company_id, chat_id, is_group, phone, name, last_at, last_body, last_from_me, unread)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        name = COALESCE(NULLIF(VALUES(name), ""), name),
        last_at = GREATEST(COALESCE(last_at, "1970-01-01"), VALUES(last_at)),
        last_body = IF(VALUES(last_at) >= COALESCE(last_at, "1970-01-01"), VALUES(last_body), last_body),
        last_from_me = IF(VALUES(last_at) >= COALESCE(last_at, "1970-01-01"), VALUES(last_from_me), last_from_me),
        unread = unread + VALUES(unread)');

  foreach ($body['messages'] as $m) {
    $p = ql_wa_parse_message($m);
    if (!$p) continue;
    $insM->execute([$plantId, $coId, $p['chat_id'], $p['wa_id'], $p['from_me'], $p['from_phone'], $p['from_name'],
      $p['type'], $p['body'], $p['media_id'], $p['media_mime'], $p['media_name'], $p['media_size'], $p['preview'],
      $p['from_me'] ? 'sent' : 'received', $p['at']]);
    // Only a NEW inbound message adds to unread — a retry must not inflate the
    // badge, and our own outbound is never unread.
    $fresh = $insM->rowCount() === 1;
    $upC->execute([$plantId, $coId, $p['chat_id'], $p['is_group'], $p['from_me'] ? null : $p['from_phone'],
      $p['from_name'], $p['at'], ql_wa_preview_text($p), $p['from_me'],
      (!$p['from_me'] && $fresh) ? 1 : 0]);
    $n++;

    /* ── BRIDGE INTO THE INTERNAL THREAD ─────────────────────────────────
       If this number already has a QuickLimes conversation, the reply lands
       IN it — so one thread carries both the team's discussion and what the
       customer actually said, and the history is in one place.

       Only when a thread already exists: a webhook must not conjure
       conversations for every number that ever messages the channel. The
       wa_chats inbox above still receives everything regardless. */
    $bridged += ql_wa_bridge_into_thread($db, $plantId, $coId, $p);
  }
}

/* ── statuses: sent -> delivered -> read. Never go backwards: webhooks arrive
   out of order, and a message that shows "delivered" after "read" reads as a
   bug to the one person who cares. ── */
if (!empty($body['statuses']) && is_array($body['statuses'])) {
  $rank = ['pending' => 0, 'sent' => 1, 'delivered' => 2, 'read' => 3, 'played' => 4, 'failed' => 9];
  $up = $db->prepare('UPDATE wa_messages SET status = ? WHERE plant_id = ? AND wa_id = ?');
  $get = $db->prepare('SELECT status FROM wa_messages WHERE plant_id = ? AND wa_id = ? LIMIT 1');
  foreach ($body['statuses'] as $s) {
    $id = (string)($s['id'] ?? ''); $new = strtolower((string)($s['status'] ?? ''));
    if ($id === '' || !isset($rank[$new])) continue;
    $get->execute([$plantId, $id]);
    $cur = $get->fetchColumn();
    if ($cur !== false && isset($rank[$cur]) && $rank[$new] <= $rank[$cur] && $new !== 'failed') continue;
    $up->execute([$new, $plantId, $id]);
    $st++;
  }
}

echo json_encode(['ok' => true, 'messages' => $n, 'statuses' => $st, 'bridged' => $bridged]);
