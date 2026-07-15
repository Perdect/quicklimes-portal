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
// The firm's own GSTIN. Optional, but it is what lets the bill parser tell OUR
// bills from a supplier's — i.e. a Sale from a Purchase. Signup never asked for
// it, so every new account started with no identity and every uploaded bill was
// filed as a Purchase. Editable later in Settings → Company profile.
$gstin = strtoupper(preg_replace('/\s+/', '', (string)($b['p_gst_number'] ?? '')));

if ($name === '' || $phone === '') {
  ql_out(['error' => 'Please enter your company name and phone number']);
}
// Reject a malformed GSTIN rather than store it: a WRONG own-GSTIN is worse
// than none, because it makes the app mis-identify the firm's own bills.
// The shape AND the state code must match data.js validGstinFmt + bill-ocr.js
// validGstin exactly — a rule accepted here but rejected there would store an
// identity the parser ignores, silently reviving the bug this fixes.
// (identity.test.js proves all three agree.)
$gstShapeOk = preg_match('/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/', $gstin) === 1;
$gstStateOk = $gstShapeOk && (int)substr($gstin, 0, 2) >= 1 && (int)substr($gstin, 0, 2) <= 38;
if ($gstin !== '' && !$gstStateOk) {
  ql_out(['error' => 'That GSTIN doesn’t look right — it should be 15 characters, like 08BNAPM0488E1Z3']);
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
    'INSERT INTO plants (id, owner_phone, password_hash, plant_name, gst_number, plan_limit)
     VALUES (?, ?, ?, ?, ?, 2)'
  );
  $ins->execute([$id, $phone, $hash, $name, $gstin !== '' ? $gstin : null]);
} catch (Throwable $e) {
  ql_out(['error' => 'Could not create the account — please try again'], 500);
}

ql_out(['success' => true, 'id' => $id]);
