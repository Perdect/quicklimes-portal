<?php
/* POST /api/signup.php — mirrors the old Supabase signup_plant RPC.
   Creates a brand-new account (one primary plant carrying the password).
   { p_plant_name, p_plant_type, p_owner_phone, p_password }
   On success: { success:true, id:"<new-plant-id>" }
   On a taken phone / bad input: HTTP 200 with { error:"…" } so the
   signup page shows the message (not a generic "Network error"). */
require __DIR__ . '/db.php';
ql_cors();

$b     = ql_body();
$name  = trim((string)($b['p_plant_name']  ?? ''));
$phone = trim((string)($b['p_owner_phone'] ?? ''));
$pass  = (string)($b['p_password'] ?? '');

if ($name === '' || $phone === '') {
  ql_out(['error' => 'Please enter your company name and phone number']);
}
if (strlen($pass) < 8) {
  ql_out(['error' => 'Password must be at least 8 characters']);
}

// Tables may not exist yet on a fresh install — create them (idempotent).
ql_ensure_tables();

// One account per phone (matches the old unique-phone rule).
$chk = ql_db()->prepare("SELECT id FROM plants WHERE owner_phone = ? AND password_hash <> '' LIMIT 1");
$chk->execute([$phone]);
if ($chk->fetch()) {
  ql_out(['error' => 'An account with this phone already exists — please log in instead.']);
}

// RFC-4122 v4 id (same shape as the existing Supabase uuids).
function ql_uuid_v4() {
  $d = random_bytes(16);
  $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
  $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);
  $h = bin2hex($d);
  return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4) . '-' .
         substr($h, 16, 4) . '-' . substr($h, 20, 12);
}

try {
  $id   = ql_uuid_v4();
  $hash = password_hash($pass, PASSWORD_DEFAULT);
  $ins  = ql_db()->prepare(
    'INSERT INTO plants (id, owner_phone, password_hash, plant_name, plan_limit)
     VALUES (?, ?, ?, ?, 2)'
  );
  $ins->execute([$id, $phone, $hash, $name]);
} catch (Throwable $e) {
  ql_out(['error' => 'Could not create the account — please try again'], 500);
}

ql_out(['success' => true, 'id' => $id]);
