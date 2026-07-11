<?php
/* POST /api/login.php  { p_owner_phone, p_password }
   Mirrors the old Supabase login_plant RPC. Returns, on success:
     { success:true, plant:{…}, plants:[…], plan_limit:N, token:"…" }
   On bad credentials it returns HTTP 200 with { error:"…" } so the
   frontend shows the message (not a generic "Network error"). */
require __DIR__ . '/db.php';
ql_cors();

$b = ql_body();
$phone    = trim((string)($b['p_owner_phone'] ?? $b['phone'] ?? ''));
$password = (string)($b['p_password'] ?? $b['password'] ?? '');
if ($phone === '' || $password === '') {
  ql_out(['error' => 'Please enter phone and password']);
}

$role = 'owner';       // owner login = full access (legacy token shape)
$userId = '';
$userName = '';

try {
  // The account = the plant that carries the password (the primary, no parent).
  $st = ql_db()->prepare(
    "SELECT * FROM plants WHERE owner_phone = ? AND password_hash <> ''
     ORDER BY (parent_plant_id IS NULL) DESC LIMIT 1"
  );
  $st->execute([$phone]);
  $primary = $st->fetch();
} catch (Throwable $e) {
  ql_out(['error' => 'Server error'], 500);
}

// Owner credentials didn't match → try an employee account (users table).
if (!$primary || !password_verify($password, $primary['password_hash'])) {
  $primary = null;
  try {
    ql_ensure_tables();                         // idempotent — users table may not exist yet
    $us = ql_db()->prepare('SELECT * FROM users WHERE phone = ? AND active = 1');
    $us->execute([$phone]);
    foreach ($us->fetchAll() as $u) {
      if (password_verify($password, $u['password_hash'])) {
        $pp = ql_db()->prepare('SELECT * FROM plants WHERE id = ? LIMIT 1');
        $pp->execute([$u['plant_id']]);
        $primary = $pp->fetch();
        if ($primary) { $role = $u['role']; $userId = $u['id']; $userName = $u['name']; }
        break;
      }
    }
  } catch (Throwable $e) { /* fall through to invalid */ }
}

if (!$primary) {
  ql_out(['error' => 'Invalid phone or password']);
}

// The whole family: the primary plus every child plant under it.
$fam = ql_db()->prepare(
  "SELECT * FROM plants WHERE id = ? OR parent_plant_id = ?
   ORDER BY (parent_plant_id IS NULL) DESC, plant_name ASC"
);
$fam->execute([$primary['id'], $primary['id']]);
$rows = $fam->fetchAll();

$pub = function ($p) {
  return [
    'id'              => $p['id'],
    'owner_phone'     => $p['owner_phone'],
    'plant_name'      => $p['plant_name'],
    'gst_number'      => $p['gst_number'],
    'city'            => $p['city'],
    'address'         => $p['address'],
    'parent_plant_id' => $p['parent_plant_id'],
  ];
};

ql_out([
  'success'    => true,
  'plant'      => $pub($primary),
  'plants'     => array_map($pub, $rows),
  'plan_limit' => (int)$primary['plan_limit'],
  'role'       => $role,
  'user'       => $userId ? ['id' => $userId, 'name' => $userName, 'role' => $role] : null,
  'token'      => ql_sign_token($primary['id'], 2592000, $userId, $role),
]);
