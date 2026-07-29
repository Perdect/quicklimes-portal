<?php
/* /api/users.php — employee account management (owner/admin only).
   All calls are POST { action, token, ... }. The token must belong to the
   account and carry a full-access role ('*'); an employee token is rejected.

   Actions:
     list                                  → { users:[{id,name,phone,role,active}] }
     create  { name, phone, password, role } → { success, id }
     update  { id, name?, role?, active? }    → { success }
     setpw   { id, password }                  → { success }
   The `role` must be one of the known roles (ql_role_caps keys), never 'owner'. */
require __DIR__ . '/db.php';
ql_cors();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') ql_out(['error' => 'POST only'], 405);

$b       = ql_body();
$plantId = (string)($b['plant_id'] ?? '');
$ctx     = ql_token_ctx($plantId);
if (!$ctx) ql_out(['error' => 'Unauthorized'], 401);
/* The tenant key comes from the TOKEN, not the body. ql_token_ctx has already
   proven they agree; re-deriving here means no later line can be tricked by a
   body field into scoping rows to another firm. */
$plantId = (string)$ctx['plant'];
if (!ql_role_can($ctx['role'], '*')) ql_out(['error' => 'Forbidden'], 403);   // only owner/admin/partner manage users
$account = $ctx['plant'];                                                      // scope every row to the token's account

ql_ensure_tables();
$db = ql_db();

/* Roles an owner may assign (never 'owner' itself — that's the plant credential). */
$ASSIGNABLE = array_values(array_diff(array_keys(ql_role_caps()), ['owner']));

$action = (string)($b['action'] ?? '');

if ($action === 'list') {
  $st = $db->prepare('SELECT id, name, phone, role, active FROM users WHERE plant_id = ? ORDER BY created_at');
  $st->execute([$account]);
  $rows = array_map(function ($u) {
    return ['id' => $u['id'], 'name' => $u['name'], 'phone' => $u['phone'], 'role' => $u['role'], 'active' => (int)$u['active']];
  }, $st->fetchAll());
  ql_out(['users' => $rows]);
}

if ($action === 'create') {
  $name = trim((string)($b['name'] ?? ''));
  $phone = trim((string)($b['phone'] ?? ''));
  $pass = (string)($b['password'] ?? '');
  $role = (string)($b['role'] ?? '');
  if ($phone === '' || strlen($pass) < 6) ql_out(['error' => 'Phone and a 6+ char password are required']);
  if (!in_array($role, $ASSIGNABLE, true)) ql_out(['error' => 'Unknown role']);
  // Phone must be unique within the account and must not collide with the owner phone.
  $own = $db->prepare('SELECT id FROM plants WHERE id = ? AND owner_phone = ?');
  $own->execute([$account, $phone]);
  if ($own->fetch()) ql_out(['error' => 'That phone is the owner login']);
  $dup = $db->prepare('SELECT id FROM users WHERE plant_id = ? AND phone = ?');
  $dup->execute([$account, $phone]);
  if ($dup->fetch()) ql_out(['error' => 'An employee with that phone already exists']);
  $id = bin2hex(random_bytes(16));
  $ins = $db->prepare('INSERT INTO users (id, plant_id, name, phone, password_hash, role, active) VALUES (?,?,?,?,?,?,1)');
  $ins->execute([$id, $account, $name, $phone, password_hash($pass, PASSWORD_DEFAULT), $role]);
  ql_out(['success' => true, 'id' => $id]);
}

if ($action === 'update') {
  $id = (string)($b['id'] ?? '');
  if ($id === '') ql_out(['error' => 'Missing id']);
  $cur = $db->prepare('SELECT * FROM users WHERE id = ? AND plant_id = ?');
  $cur->execute([$id, $account]);
  $u = $cur->fetch();
  if (!$u) ql_out(['error' => 'Not found'], 404);
  $name = array_key_exists('name', $b) ? trim((string)$b['name']) : $u['name'];
  $role = array_key_exists('role', $b) ? (string)$b['role'] : $u['role'];
  if (!in_array($role, $ASSIGNABLE, true)) ql_out(['error' => 'Unknown role']);
  $active = array_key_exists('active', $b) ? ((int)!!$b['active']) : (int)$u['active'];
  $st = $db->prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ? AND plant_id = ?');
  $st->execute([$name, $role, $active, $id, $account]);
  ql_out(['success' => true]);
}

if ($action === 'setpw') {
  $id = (string)($b['id'] ?? '');
  $pass = (string)($b['password'] ?? '');
  if ($id === '' || strlen($pass) < 6) ql_out(['error' => 'A 6+ char password is required']);
  $st = $db->prepare('UPDATE users SET password_hash = ? WHERE id = ? AND plant_id = ?');
  $st->execute([password_hash($pass, PASSWORD_DEFAULT), $id, $account]);
  ql_out(['success' => true]);
}

ql_out(['error' => 'Unknown action'], 400);
