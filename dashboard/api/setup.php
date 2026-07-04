<?php
/* POST /api/setup.php — one-time bootstrap, called by /migrate.html.
   Creates the tables (if missing) and inserts the account's plant rows
   with a login password.

   Body: { owner_phone, password, plants:[{id,plant_name,gst_number,city,
           address,parent_plant_id,plan_limit}], secret? }

   Gate: allowed freely while the plants table is EMPTY (first-run
   bootstrap). Once any plant exists, the correct APP_SECRET must be
   supplied — so nobody can hijack or reset the account later. */
require __DIR__ . '/db.php';
ql_cors();

$b = ql_body();
ql_ensure_tables();

$phone    = trim((string)($b['owner_phone'] ?? ''));
$password = (string)($b['password'] ?? '');
$plants   = $b['plants'] ?? [];
$secret   = (string)($b['secret'] ?? '');

$cfg      = ql_config();
$count    = (int) ql_db()->query('SELECT COUNT(*) AS c FROM plants')->fetch()['c'];
$secretOk = $secret !== '' && hash_equals((string)$cfg['APP_SECRET'], $secret);

if ($count > 0 && !$secretOk) {
  ql_out(['error' => 'Already initialized. To re-run, provide the correct APP_SECRET.'], 403);
}
if ($phone === '' || strlen($password) < 4 || !is_array($plants) || !count($plants)) {
  ql_out(['error' => 'owner_phone, password (4+ chars) and plants[] are required'], 400);
}

$hash = password_hash($password, PASSWORD_DEFAULT);

$ins = ql_db()->prepare(
  'INSERT INTO plants (id, owner_phone, plant_name, gst_number, city, address, parent_plant_id, plan_limit)
   VALUES (:id, :ph, :nm, :gst, :city, :addr, :par, :lim)
   ON DUPLICATE KEY UPDATE owner_phone = VALUES(owner_phone), plant_name = VALUES(plant_name),
     gst_number = VALUES(gst_number), city = VALUES(city), address = VALUES(address),
     parent_plant_id = VALUES(parent_plant_id)'
);
$setpw = ql_db()->prepare('UPDATE plants SET password_hash = ? WHERE id = ?');

$n = 0;
foreach ($plants as $p) {
  $id = (string)($p['id'] ?? '');
  if ($id === '') continue;
  $isPrimary = empty($p['parent_plant_id']);
  $ins->execute([
    ':id'   => $id,
    ':ph'   => $phone,
    ':nm'   => (string)($p['plant_name'] ?? ''),
    ':gst'  => ($p['gst_number'] ?? null) ?: null,
    ':city' => ($p['city'] ?? null) ?: null,
    ':addr' => ($p['address'] ?? null) ?: null,
    ':par'  => ($p['parent_plant_id'] ?? null) ?: null,
    ':lim'  => (int)($p['plan_limit'] ?? 2),
  ]);
  // Only the primary plant carries the login password.
  if ($isPrimary) $setpw->execute([$hash, $id]);
  $n++;
}

ql_out(['success' => true, 'plants' => $n]);
