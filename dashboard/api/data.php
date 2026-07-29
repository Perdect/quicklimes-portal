<?php
/* /api/data.php — mirrors the Supabase get_my_data / save_my_data RPCs.

   GET  ?plant_id=<id>&token=<t>
        → [ { id:"<row-key>", data:{…} }, … ]   (array of rows for the account)

   POST { p_plant_id, p_id, p_data, token }
        → { success:true }                      (upserts one row)

   The token (issued by login.php) must match the requested plant_id,
   so an account can only read/write its own data. */
require __DIR__ . '/db.php';
ql_cors();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

/* ── Optimistic-concurrency revision (audit M2) ──────────────────────────
   Each company blob carries a monotonic `rev`. A client sends the rev it last
   read; if the stored rev has moved on (another device saved in between) the
   write is REJECTED as a conflict instead of silently clobbering the other
   device's edits.

   Strictly ADDITIVE and self-migrating: the column is added on first use, and
   if it can't be (old MySQL, no ALTER permission) every path falls back to the
   pre-M2 behaviour. So deploying this code BEFORE the column exists changes
   nothing — it simply behaves as it did until the migration lands. */
function ql_appdata_rev_ok($db) {
  static $ok = null;
  if ($ok !== null) return $ok;
  try {
    try { $db->exec('ALTER TABLE app_data ADD COLUMN rev INT NOT NULL DEFAULT 0'); }
    catch (Throwable $e) { /* already there — expected on every call after the first */ }
    $db->query('SELECT rev FROM app_data LIMIT 0');   // throws if the column truly isn't there
    $ok = true;
  } catch (Throwable $e) { $ok = false; }
  return $ok;
}

if ($method === 'GET') {
  $plantId = (string)($_GET['plant_id'] ?? '');
  $ctx = ql_token_ctx($plantId);
  if (!$ctx) ql_out(['error' => 'Unauthorized'], 401);
  /* Tenant from the TOKEN, not the query/body — the blob store is the most
     sensitive scope in the app. */
  $plantId = (string)$ctx['plant'];
  $hasRev = ql_appdata_rev_ok(ql_db());
  $st = ql_db()->prepare('SELECT data_id, data' . ($hasRev ? ', rev' : '') . ' FROM app_data WHERE plant_id = ?');
  $st->execute([$plantId]);
  $out = [];
  foreach ($st->fetchAll() as $r) {
    // Strip modules this role may not see BEFORE the data leaves the server.
    $data = ql_filter_blob_for_role(json_decode($r['data'], true), $ctx['role']);
    $row = ['id' => $r['data_id'], 'data' => $data];
    if ($hasRev) $row['rev'] = (int)$r['rev'];   // client keeps this as its next base_rev
    $out[] = $row;
  }
  ql_out($out);
}

if ($method === 'POST') {
  $b       = ql_body();
  $plantId = (string)($b['p_plant_id'] ?? '');
  $id      = (string)($b['p_id'] ?? '');
  $data    = $b['p_data'] ?? null;
  $ctx = ql_token_ctx($plantId);
  if (!$ctx) ql_out(['error' => 'Unauthorized'], 401);
  /* Tenant from the TOKEN, not the query/body — the blob store is the most
     sensitive scope in the app. */
  $plantId = (string)$ctx['plant'];
  if ($id === '') ql_out(['error' => 'Missing id'], 400);

  // Restricted roles never full-replace the row: merge their allowed modules
  // into the existing blob so modules their client never loaded aren't wiped.
  if (!ql_role_can($ctx['role'], '*')) {
    $ex = ql_db()->prepare('SELECT data FROM app_data WHERE plant_id = ? AND data_id = ?');
    $ex->execute([$plantId, $id]);
    $row = $ex->fetch();
    $existing = $row ? json_decode($row['data'], true) : [];
    $data = ql_merge_blob_for_role($existing, $data, $ctx['role']);
  }

  $db = ql_db();
  if (ql_appdata_rev_ok($db)) {
    /* Concurrency check (audit M2). base_rev is what the client last read. If
       the stored rev has moved past it, someone else wrote first — reject and
       hand back the authoritative copy so the client can adopt it, rather than
       overwriting their edits. A client that sends no base_rev (old build) is
       never blocked — backward compatible. */
    $baseRev = array_key_exists('base_rev', $b) ? (int)$b['base_rev'] : null;
    $rq = $db->prepare('SELECT rev FROM app_data WHERE plant_id = ? AND data_id = ?');
    $rq->execute([$plantId, $id]);
    $curRev = $rq->fetchColumn();
    $curRev = ($curRev === false) ? null : (int)$curRev;
    if ($baseRev !== null && $curRev !== null && $curRev > $baseRev) {
      $dq = $db->prepare('SELECT data FROM app_data WHERE plant_id = ? AND data_id = ?');
      $dq->execute([$plantId, $id]);
      $curData = ql_filter_blob_for_role(json_decode((string)$dq->fetchColumn(), true), $ctx['role']);
      ql_out(['conflict' => true, 'rev' => $curRev, 'data' => $curData]);   // 200 so the client reads the body
    }
    $newRev = ($curRev === null ? 1 : $curRev + 1);
    $st = $db->prepare('INSERT INTO app_data (plant_id, data_id, data, rev) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE data = VALUES(data), rev = VALUES(rev)');
    $st->execute([$plantId, $id, json_encode($data), $newRev]);
    ql_out(['success' => true, 'rev' => $newRev]);
  }

  // Fallback (no rev column yet): the original unconditional upsert.
  $st = $db->prepare(
    'INSERT INTO app_data (plant_id, data_id, data) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE data = VALUES(data)'
  );
  $st->execute([$plantId, $id, json_encode($data)]);
  ql_out(['success' => true]);
}

ql_out(['error' => 'Method not allowed'], 405);
