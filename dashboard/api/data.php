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

if ($method === 'GET') {
  $plantId = (string)($_GET['plant_id'] ?? '');
  if (!ql_verify_token(ql_token(), $plantId)) ql_out(['error' => 'Unauthorized'], 401);
  $st = ql_db()->prepare('SELECT data_id, data FROM app_data WHERE plant_id = ?');
  $st->execute([$plantId]);
  $out = [];
  foreach ($st->fetchAll() as $r) {
    $out[] = ['id' => $r['data_id'], 'data' => json_decode($r['data'], true)];
  }
  ql_out($out);
}

if ($method === 'POST') {
  $b       = ql_body();
  $plantId = (string)($b['p_plant_id'] ?? '');
  $id      = (string)($b['p_id'] ?? '');
  $data    = $b['p_data'] ?? null;
  if (!ql_verify_token(ql_token(), $plantId)) ql_out(['error' => 'Unauthorized'], 401);
  if ($id === '') ql_out(['error' => 'Missing id'], 400);
  $st = ql_db()->prepare(
    'INSERT INTO app_data (plant_id, data_id, data) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE data = VALUES(data)'
  );
  $st->execute([$plantId, $id, json_encode($data)]);
  ql_out(['success' => true]);
}

ql_out(['error' => 'Method not allowed'], 405);
