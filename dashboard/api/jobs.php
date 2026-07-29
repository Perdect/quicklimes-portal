<?php
/* ═══════════════════════════════════════════════════════════════
   /api/jobs — the browser's window onto the queue.

   The browser owns the RULES (wa-core.js, unit-tested) and enqueues concrete
   intents; /api/cron sends them and re-verifies first. This endpoint is only
   enqueue / list / cancel.

   POST { plant_id, company_id, token, action, ... }
     action=enqueue { jobs:[{kind, dedupe_key, send_at, payload}] } -> { ok, queued, skipped }
     action=list    { limit? }                                      -> { ok, jobs:[…] }
     action=cancel  { id | all:true }                               -> { ok, cancelled }
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
// Scheduling a message to a customer in the firm's name is the same right as
// sending one by hand.
if (!ql_role_can($ctx['role'], 'sales')) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);

ql_ensure_tables();
$db = ql_db();
$action = (string)($b['action'] ?? 'list');

if ($action === 'enqueue') {
  $rows = is_array($b['jobs'] ?? null) ? $b['jobs'] : [];
  if (!$rows) ql_out(['ok' => false, 'error' => 'No jobs given']);
  if (count($rows) > 500) ql_out(['ok' => false, 'error' => 'Too many jobs in one call']);

  // INSERT IGNORE + the UNIQUE dedupe key is what makes enqueue idempotent:
  // opening the app five times in a day must not queue five reminders. The
  // dedupe key is wa-core's own sendKey (party|invoice|step), so "already
  // queued" and "already sent" mean the same thing to the engine.
  $ins = $db->prepare('INSERT IGNORE INTO jobs (plant_id, company_id, kind, dedupe_key, send_at, payload, status)
                       VALUES (?, ?, ?, ?, ?, ?, "queued")');
  $queued = 0; $skipped = 0;
  foreach ($rows as $r) {
    $kind = (string)($r['kind'] ?? '');
    $key  = (string)($r['dedupe_key'] ?? '');
    $at   = (string)($r['send_at'] ?? '');
    $pay  = json_encode($r['payload'] ?? []);
    if ($kind === '' || $key === '' || $at === '') { $skipped++; continue; }
    if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $at)) { $skipped++; continue; }
    if (strlen($pay) > 8000) { $skipped++; continue; }
    $ins->execute([$plantId, $coId, $kind, $key, $at, $pay]);
    $ins->rowCount() ? $queued++ : $skipped++;      // 0 rows = the dedupe key already existed
  }
  ql_out(['ok' => true, 'queued' => $queued, 'skipped' => $skipped]);
}

if ($action === 'list') {
  $lim = max(1, min(200, (int)($b['limit'] ?? 100)));
  $st = $db->prepare("SELECT id, kind, dedupe_key, send_at, status, attempts, last_error, provider_id, payload, done_at
                      FROM jobs WHERE plant_id = ? AND company_id = ? ORDER BY send_at DESC LIMIT $lim");
  $st->execute([$plantId, $coId]);
  $out = [];
  foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $p = json_decode($r['payload'], true);
    $r['payload'] = is_array($p) ? $p : [];
    $out[] = $r;
  }
  ql_out(['ok' => true, 'jobs' => $out]);
}

if ($action === 'cancel') {
  // Only ever cancels what has NOT gone out. A sent message cannot be unsent,
  // and pretending otherwise in the UI would be a lie.
  if (!empty($b['all'])) {
    $st = $db->prepare("UPDATE jobs SET status = 'cancelled' WHERE plant_id = ? AND company_id = ? AND status = 'queued'");
    $st->execute([$plantId, $coId]);
    ql_out(['ok' => true, 'cancelled' => $st->rowCount()]);
  }
  $id = (int)($b['id'] ?? 0);
  if (!$id) ql_out(['ok' => false, 'error' => 'No job id']);
  $st = $db->prepare("UPDATE jobs SET status = 'cancelled' WHERE id = ? AND plant_id = ? AND status = 'queued'");
  $st->execute([$id, $plantId]);
  ql_out(['ok' => true, 'cancelled' => $st->rowCount()]);
}

ql_out(['ok' => false, 'error' => 'Unknown action']);
