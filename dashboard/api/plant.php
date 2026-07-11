<?php
/* POST /api/plant.php — mirrors the Supabase update_my_plant RPC (v1 "Edit profile").
   { p_plant_id, p_plant_name, p_city, p_gst_number, p_address, token }
   The target plant must belong to the token's account (itself or a child). */
require __DIR__ . '/db.php';
ql_cors();

$b       = ql_body();
$plantId = (string)($b['p_plant_id'] ?? '');
$ctx = ql_token_ctx('');                       // any valid token for this account
if (!$ctx)                              ql_out(['error' => 'Unauthorized'], 401);
if (!ql_role_can($ctx['role'], '*'))    ql_out(['error' => 'Forbidden'], 403);   // company profile = owner-level
$tokPid = $ctx['plant'];
if ($plantId === '')                    ql_out(['error' => 'Missing plant id'], 400);

// Ensure the plant being edited is the account's primary or one of its children.
$chk = ql_db()->prepare('SELECT id FROM plants WHERE id = ? AND (id = ? OR parent_plant_id = ?)');
$chk->execute([$plantId, $tokPid, $tokPid]);
if (!$chk->fetch()) ql_out(['error' => 'Forbidden'], 403);

$name = trim((string)($b['p_plant_name'] ?? ''));
if (strlen($name) < 2) ql_out(['error' => 'Company name is required']);

$st = ql_db()->prepare('UPDATE plants SET plant_name = ?, city = ?, gst_number = ?, address = ? WHERE id = ?');
$st->execute([
  $name,
  ($b['p_city']       ?? null) ?: null,
  ($b['p_gst_number'] ?? null) ?: null,
  ($b['p_address']    ?? null) ?: null,
  $plantId,
]);

ql_out(['success' => true]);
