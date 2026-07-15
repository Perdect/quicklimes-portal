<?php
/* ═══════════════════════════════════════════════════════════════
   /api/wa — WhatsApp send proxy (Whapi).

   The channel token lives ONLY in config.php (server-side). It is never sent
   to the browser, never logged, never committed — same rule as LLM_API_KEY.
   The browser asks US to send; it never talks to Whapi and never holds a
   credential it could leak through devtools, a screenshot or the data blob.

   POST { plant_id, token, action:'send'|'status', to, body }
     action=status -> { ok, configured, status, sender }   (channel health)
     action=send   -> { ok, id }                            (message queued at Whapi)
   When no token is configured: { ok:false, not_configured:true } so the client
   falls back to one-tap wa.me sending instead of failing.

   Whapi REST (verified against whapi.readme.io, 2026-07-15):
     POST https://gate.whapi.cloud/messages/text   Bearer <token>   {to, body}
     GET  https://gate.whapi.cloud/health          Bearer <token>
   ═══════════════════════════════════════════════════════════════ */
require __DIR__ . '/db.php';
ql_cors();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') ql_out(['ok' => false, 'error' => 'POST only'], 405);

$b       = ql_body();
$plantId = (string)($b['plant_id'] ?? '');
$ctx     = ql_token_ctx($plantId);
if (!$ctx) ql_out(['ok' => false, 'error' => 'Unauthorized'], 401);
// Messaging a customer in the firm's name is a real-world act, so it is gated
// on the same capability as the money it chases.
if (!ql_role_can($ctx['role'], 'sales')) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);

$wa = ql_whapi();
$action = (string)($b['action'] ?? 'status');

if ($wa['token'] === '') {
  // Not an error the user should be shouted at for — it is the default state.
  // The client uses this to stay in one-tap mode.
  ql_out(['ok' => false, 'not_configured' => true, 'error' => 'whatsapp_not_configured']);
}

/* ── shared HTTP ── */
function ql_wa_http($method, $url, $token, $payload = null) {
  $ch = curl_init($url);
  $h  = ['Authorization: Bearer ' . $token, 'Accept: application/json'];
  if ($payload !== null) $h[] = 'Content-Type: application/json';
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $h,
    CURLOPT_TIMEOUT        => 25,
  ]);
  if ($payload !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
  $raw  = curl_exec($ch);
  $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err  = curl_error($ch);
  curl_close($ch);
  return ['code' => $code, 'raw' => $raw, 'err' => $err, 'json' => json_decode((string)$raw, true)];
}

if ($action === 'status') {
  $r = ql_wa_http('GET', 'https://gate.whapi.cloud/health', $wa['token']);
  if ($r['code'] === 0) ql_out(['ok' => false, 'configured' => true, 'error' => 'Could not reach WhatsApp provider']);
  if ($r['code'] === 401 || $r['code'] === 403) ql_out(['ok' => false, 'configured' => true, 'error' => 'The channel token was rejected — check WHAPI_TOKEN in config.php']);
  // Whapi does not document the health response shape, so do not invent one:
  // pass the status through and let the UI show what the provider actually said.
  $j = is_array($r['json']) ? $r['json'] : [];
  $status = $j['status'] ?? ($j['channel']['status'] ?? null);
  if (is_array($status)) $status = $status['text'] ?? json_encode($status);
  ql_out([
    'ok' => $r['code'] >= 200 && $r['code'] < 300,
    'configured' => true,
    'status' => $status !== null ? (string)$status : 'unknown',
    'sender' => $wa['sender'],
    'http'   => $r['code'],
  ]);
}

if ($action === 'send') {
  $to   = preg_replace('/\D/', '', (string)($b['to'] ?? ''));
  $body = (string)($b['body'] ?? '');
  // Refuse to send junk in the firm's name. A malformed number can reach a
  // stranger; an empty body is a message no customer should receive.
  if (strlen($to) < 10 || strlen($to) > 15) ql_out(['ok' => false, 'error' => 'Bad recipient number']);
  if (trim($body) === '')                   ql_out(['ok' => false, 'error' => 'Empty message']);
  if (strpos($body, '{{') !== false)        ql_out(['ok' => false, 'error' => 'Message still has an unfilled placeholder — refusing to send']);
  if (mb_strlen($body) > 4000)              ql_out(['ok' => false, 'error' => 'Message too long']);

  $r = ql_wa_http('POST', 'https://gate.whapi.cloud/messages/text', $wa['token'], ['to' => $to, 'body' => $body]);
  if ($r['code'] === 0) ql_out(['ok' => false, 'error' => 'Could not reach WhatsApp provider' . ($r['err'] ? ' (' . $r['err'] . ')' : '')]);
  if ($r['code'] === 401 || $r['code'] === 403) ql_out(['ok' => false, 'error' => 'The channel token was rejected']);
  if ($r['code'] === 429) ql_out(['ok' => false, 'retry' => true, 'error' => 'Provider rate limit — slow down']);
  $j  = is_array($r['json']) ? $r['json'] : [];
  $id = $j['message']['id'] ?? ($j['id'] ?? null);
  if ($r['code'] < 200 || $r['code'] >= 300 || !$id) {
    // NEVER report a send we cannot prove. Surface the provider's own words.
    $why = $j['error']['message'] ?? ($j['message'] ?? ('HTTP ' . $r['code']));
    if (is_array($why)) $why = json_encode($why);
    ql_out(['ok' => false, 'error' => (string)$why]);
  }
  ql_out(['ok' => true, 'id' => (string)$id, 'status' => (string)($j['message']['status'] ?? 'pending')]);
}

ql_out(['ok' => false, 'error' => 'Unknown action']);
