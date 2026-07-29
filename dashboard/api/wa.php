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
/* The tenant key comes from the TOKEN, not the body. ql_token_ctx has already
   proven they agree; re-deriving here means no later line can be tricked by a
   body field into scoping rows to another firm. */
$plantId = (string)$ctx['plant'];
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


if ($action === 'status') {
  $ch = curl_init('https://gate.whapi.cloud/health');
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $wa['token'], 'Accept: application/json']]);
  $raw = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  $r = ['code' => $code, 'json' => json_decode((string)$raw, true)];
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
  // One send path, shared with the cron (ql_wa_send in db.php): it validates
  // the number, refuses an empty body or an unfilled {{placeholder}}, and
  // reports ok ONLY with a real provider message id. Two copies of this would
  // drift, and the manual and unattended paths must behave identically.
  $r = ql_wa_send($wa['token'], (string)($b['to'] ?? ''), (string)($b['body'] ?? ''));
  if (!$r['ok']) ql_out(['ok' => false, 'retry' => !empty($r['retry']), 'error' => $r['error']]);
  ql_out(['ok' => true, 'id' => $r['id'], 'status' => 'pending']);
}

ql_out(['ok' => false, 'error' => 'Unknown action']);
