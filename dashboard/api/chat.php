<?php
/* ═══════════════════════════════════════════════════════════════
   /api/chat — the internal WhatsApp inbox.

   POST { plant_id, company_id, token, action, … }
     qr        -> { ok, connected, qr }   QR PNG as a data: URI, or connected
     chats     -> { ok, chats:[…] }
     messages  { chat_id, since_id?, before_id? } -> { ok, messages:[…] }
     send      { chat_id|phone, body }    -> { ok, id }
     read      { chat_id }                -> { ok }
     media     { media_id }               -> { ok, data }  (proxied download)

   WHY THE QR IS PROXIED: the channel token must never reach the browser. So we
   fetch Whapi's QR server-side and hand back only the image. The user scans it
   inside QuickLimes and the token stays where it belongs.

   WHY POLLING, NOT WEBSOCKETS: LiteSpeed + PHP on shared hosting cannot hold an
   open socket — the same reason the WhatsApp session itself cannot live here.
   `since_id` makes the poll cheap: it returns only what is new.
   ═══════════════════════════════════════════════════════════════ */
require __DIR__ . '/db.php';
ql_cors();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') ql_out(['ok' => false, 'error' => 'POST only'], 405);

$b       = ql_body();
$plantId = (string)($b['plant_id'] ?? '');
$coId    = (string)($b['company_id'] ?? '');
$ctx     = ql_token_ctx($plantId);
if (!$ctx) ql_out(['ok' => false, 'error' => 'Unauthorized'], 401);
/* The tenant key comes from the TOKEN, not the body. ql_token_ctx has already
   proven they agree; re-deriving here means no later line can be tricked by a
   body field into scoping rows to another firm. */
$plantId = (string)$ctx['plant'];
if (!ql_role_can($ctx['role'], 'sales')) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);

$wa = ql_whapi();
$action = (string)($b['action'] ?? 'chats');

if ($wa['token'] === '' && in_array($action, ['qr', 'send', 'media'], true)) {
  ql_out(['ok' => false, 'not_configured' => true, 'error' => 'whatsapp_not_configured']);
}

ql_ensure_tables();
$db = ql_db();

/* ── QR / connection ───────────────────────────────────────────────────
   Ask health first: if the channel is already authenticated there is no QR to
   show, and rendering one anyway would tell the user to fix what isn't broken. */
if ($action === 'qr') {
  $ch = curl_init('https://gate.whapi.cloud/health');
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $wa['token'], 'Accept: application/json']]);
  $raw = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  if ($code === 401 || $code === 403) ql_out(['ok' => false, 'error' => 'The channel token was rejected — check WHAPI_TOKEN in config.php']);
  $j = is_array(json_decode((string)$raw, true)) ? json_decode((string)$raw, true) : [];
  $status = $j['status'] ?? ($j['channel']['status'] ?? null);
  if (is_array($status)) $status = $status['text'] ?? json_encode($status);
  $status = (string)($status ?? '');
  // Whapi does not document the health shape, so do not hard-code its
  // vocabulary: anything that looks authenticated counts, and we pass the raw
  // status through for the UI to show rather than inventing one.
  $connected = (bool)preg_match('/auth|connect|ready|online/i', $status);
  if ($connected) ql_out(['ok' => true, 'connected' => true, 'status' => $status, 'sender' => $wa['sender']]);

  $ch = curl_init('https://gate.whapi.cloud/users/login/image?wakeup=true&size=360');
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $wa['token'], 'Accept: image/png']]);
  $img = curl_exec($ch); $icode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $ctype = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE); curl_close($ch);
  if ($icode < 200 || $icode >= 300 || !$img) ql_out(['ok' => false, 'connected' => false, 'status' => $status, 'error' => 'Could not get a QR code from the provider (HTTP ' . $icode . ')']);
  // Whapi can answer png OR json depending on Accept — handle both rather than
  // rendering a broken image.
  if (stripos($ctype, 'json') !== false) {
    $jj = json_decode($img, true);
    $b64 = is_array($jj) ? ($jj['qr'] ?? ($jj['image'] ?? ($jj['base64'] ?? null))) : null;
    if (!$b64) ql_out(['ok' => false, 'connected' => false, 'error' => 'Provider returned no QR image']);
    $data = (strpos($b64, 'data:') === 0) ? $b64 : 'data:image/png;base64,' . $b64;
  } else {
    $data = 'data:image/png;base64,' . base64_encode($img);
  }
  ql_out(['ok' => true, 'connected' => false, 'status' => $status, 'qr' => $data]);
}

if ($action === 'chats') {
  $st = $db->prepare('SELECT id, chat_id, is_group, phone, name, party, last_at, last_body, last_from_me, unread
                      FROM wa_chats WHERE plant_id = ? AND company_id = ? ORDER BY last_at DESC LIMIT 200');
  $st->execute([$plantId, $coId]);
  ql_out(['ok' => true, 'chats' => $st->fetchAll(PDO::FETCH_ASSOC), 'configured' => $wa['token'] !== '']);
}

if ($action === 'messages') {
  $chat = (string)($b['chat_id'] ?? '');
  if ($chat === '') ql_out(['ok' => false, 'error' => 'No chat']);
  $since = (int)($b['since_id'] ?? 0);
  if ($since > 0) {
    // The poll: only what is new. Ascending, so the client just appends.
    $st = $db->prepare('SELECT * FROM wa_messages WHERE plant_id = ? AND company_id = ? AND chat_id = ? AND id > ?
                        ORDER BY id ASC LIMIT 200');
    $st->execute([$plantId, $coId, $chat, $since]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
  } else {
    // First open / infinite scroll upwards: newest page, reversed for display.
    $before = (int)($b['before_id'] ?? 0);
    $sql = 'SELECT * FROM wa_messages WHERE plant_id = ? AND company_id = ? AND chat_id = ?'
         . ($before > 0 ? ' AND id < ?' : '') . ' ORDER BY id DESC LIMIT 40';
    $st = $db->prepare($sql);
    $st->execute($before > 0 ? [$plantId, $coId, $chat, $before] : [$plantId, $coId, $chat]);
    $rows = array_reverse($st->fetchAll(PDO::FETCH_ASSOC));
  }
  ql_out(['ok' => true, 'messages' => $rows]);
}

if ($action === 'read') {
  $chat = (string)($b['chat_id'] ?? '');
  $db->prepare('UPDATE wa_chats SET unread = 0 WHERE plant_id = ? AND company_id = ? AND chat_id = ?')
     ->execute([$plantId, $coId, $chat]);
  ql_out(['ok' => true]);
}

if ($action === 'send') {
  $chat = (string)($b['chat_id'] ?? '');
  $phone = preg_replace('/\D/', '', (string)($b['phone'] ?? ''));
  $body = (string)($b['body'] ?? '');
  // A chat_id may be a group; sending needs the chat_id itself, a DM needs the
  // number. Prefer the explicit chat_id so a group reply lands in the group.
  $to = $chat !== '' ? $chat : $phone;
  if ($to === '') ql_out(['ok' => false, 'error' => 'No recipient']);
  $r = ql_wa_send($wa['token'], $to, $body);
  if (!$r['ok']) ql_out(['ok' => false, 'error' => $r['error']]);

  $chatId = $chat !== '' ? $chat : ($phone . '@s.whatsapp.net');
  $now = gmdate('Y-m-d H:i:s');
  // Store our own message immediately so it appears at once. Whapi's echo will
  // arrive on the webhook with the same id and update this row rather than
  // duplicate it (UNIQUE on plant_id+wa_id).
  $db->prepare('INSERT INTO wa_messages (plant_id, company_id, chat_id, wa_id, from_me, from_phone, from_name, type, body, status, at)
                VALUES (?,?,?,?,1,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status = VALUES(status)')
     ->execute([$plantId, $coId, $chatId, $r['id'], $wa['sender'] ?: null, '', 'text', $body, 'sent', $now]);
  $db->prepare('INSERT INTO wa_chats (plant_id, company_id, chat_id, is_group, phone, last_at, last_body, last_from_me, unread)
                VALUES (?,?,?,?,?,?,?,1,0)
                ON DUPLICATE KEY UPDATE last_at = VALUES(last_at), last_body = VALUES(last_body), last_from_me = 1')
     ->execute([$plantId, $coId, $chatId, (strpos($chatId, '@g.us') !== false) ? 1 : 0,
       $phone ?: null, $now, mb_substr($body, 0, 200)]);
  ql_out(['ok' => true, 'id' => $r['id']]);
}

if ($action === 'media') {
  // Media is stored BY REFERENCE. Fetch it on demand, server-side, so the token
  // stays here and nothing large is ever copied onto this host.
  $mid = (string)($b['media_id'] ?? '');
  if ($mid === '') ql_out(['ok' => false, 'error' => 'No media id']);
  $own = $db->prepare('SELECT media_mime FROM wa_messages WHERE plant_id = ? AND company_id = ? AND media_id = ? LIMIT 1');
  $own->execute([$plantId, $coId, $mid]);
  $mime = $own->fetchColumn();
  // Never proxy an arbitrary id: it must belong to THIS firm's own thread.
  if ($mime === false) ql_out(['ok' => false, 'error' => 'Not found'], 404);
  $ch = curl_init('https://gate.whapi.cloud/media/' . rawurlencode($mid));
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 45,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $wa['token']]]);
  $raw = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  if ($code < 200 || $code >= 300 || !$raw) ql_out(['ok' => false, 'error' => 'Could not fetch the file (HTTP ' . $code . ')']);
  if (strlen($raw) > 12000000) ql_out(['ok' => false, 'error' => 'File is too large to open here — it stays on the phone']);
  ql_out(['ok' => true, 'data' => 'data:' . ($mime ?: 'application/octet-stream') . ';base64,' . base64_encode($raw)]);
}

ql_out(['ok' => false, 'error' => 'Unknown action']);
