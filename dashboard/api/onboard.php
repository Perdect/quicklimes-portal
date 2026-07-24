<?php
/* POST /api/onboard.php — no-login buyer onboarding.

   The owner generates a tokenised link; the buyer opens it WITHOUT logging in
   and submits their GST / license / bank details + documents directly.

     OWNER (needs a valid session token):
       { action:'create', lead_name, crm_lead_id?, company_id }  -> { ok, token, url }
       { action:'list', company_id }                             -> { ok, rows[] }
       { action:'view', token }                                  -> { ok, row }
       { action:'doc',  token, i }  (GET/POST)                   -> streams the i-th file
     BUYER (PUBLIC — only the unguessable token, no session):
       { action:'get',    token }                 -> { ok, lead_name, seller, status }
       multipart { action:'submit', token, ...fields, docs[] } -> { ok }

   Security: token = 48 hex chars (random_bytes(24)); uploaded files are
   extension+MIME allow-listed, size/count capped, stored under random names in
   a dir that denies direct web access — served ONLY through the auth-gated
   'doc' action. Public actions never expose another tenant's data. */
require __DIR__ . '/db.php';
ql_cors();

$db = ql_db();
$db->exec("CREATE TABLE IF NOT EXISTS onboarding (
  token        VARCHAR(64)  NOT NULL PRIMARY KEY,
  plant_id     VARCHAR(64)  NOT NULL,
  company_id   VARCHAR(64)  NOT NULL DEFAULT '',
  crm_lead_id  VARCHAR(64)  DEFAULT NULL,
  lead_name    VARCHAR(190) NOT NULL DEFAULT '',
  status       VARCHAR(16)  NOT NULL DEFAULT 'sent',
  payload      LONGTEXT     DEFAULT NULL,
  docs         LONGTEXT     DEFAULT NULL,
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  submitted_at TIMESTAMP    NULL DEFAULT NULL,
  KEY idx_plant (plant_id, company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

$isMultipart = stripos((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data') !== false;
$b = $isMultipart ? $_POST : ql_body();
$action = (string)($b['action'] ?? ($_GET['action'] ?? ''));

/* Documents are stored base64 IN THE DATABASE (not on disk) so they survive
   deploys and need no filesystem/.htaccess. Caps keep row size sane. */
$ALLOW_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'webp'];
$ALLOW_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
$MAX_BYTES = 3 * 1024 * 1024;   // 3 MB / file
$MAX_FILES = 6;

/* ── owner-only helper ── */
function ql_ob_ctx($b) {
  $ctx = ql_token_ctx((string)($b['plant_id'] ?? ''));
  if (!$ctx) ql_out(['ok' => false, 'error' => 'Unauthorized'], 401);
  return $ctx;
}
function ql_ob_row($db, $token) {
  if (!preg_match('/^[a-f0-9]{24,64}$/', (string)$token)) return null;
  $q = $db->prepare('SELECT * FROM onboarding WHERE token = ? LIMIT 1');
  $q->execute([$token]);
  $r = $q->fetch(PDO::FETCH_ASSOC);
  return $r ?: null;
}
function ql_ob_seller($db, $plantId) {
  $q = $db->prepare('SELECT plant_name, owner_name, city FROM plants WHERE id = ? LIMIT 1');
  $q->execute([$plantId]);
  $p = $q->fetch(PDO::FETCH_ASSOC) ?: [];
  return ['name' => $p['plant_name'] ?: 'Gotan Lime Industries', 'city' => $p['city'] ?: '', 'contact' => $p['owner_name'] ?: ''];
}

/* ─────────────── OWNER: create a link ─────────────── */
if ($action === 'create') {
  $ctx = ql_ob_ctx($b);
  $token = bin2hex(random_bytes(24));
  $ins = $db->prepare('INSERT INTO onboarding (token, plant_id, company_id, crm_lead_id, lead_name, status) VALUES (?,?,?,?,?,?)');
  $ins->execute([$token, $ctx['plant'], (string)($b['company_id'] ?? ''), (string)($b['crm_lead_id'] ?? '') ?: null, trim((string)($b['lead_name'] ?? '')), 'sent']);
  $host = $_SERVER['HTTP_HOST'] ?? 'app.quicklimes.com';
  ql_out(['ok' => true, 'token' => $token, 'url' => 'https://' . $host . '/v2/onboard?t=' . $token]);
}

/* ─────────────── OWNER: list submissions ─────────────── */
if ($action === 'list') {
  $ctx = ql_ob_ctx($b);
  $q = $db->prepare('SELECT token, lead_name, status, created_at, submitted_at FROM onboarding WHERE plant_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 200');
  $q->execute([$ctx['plant'], (string)($b['company_id'] ?? '')]);
  ql_out(['ok' => true, 'rows' => $q->fetchAll(PDO::FETCH_ASSOC)]);
}

/* ─────────────── OWNER: view one submission ─────────────── */
if ($action === 'view') {
  $ctx = ql_ob_ctx($b);
  $r = ql_ob_row($db, (string)($b['token'] ?? ''));
  if (!$r || $r['plant_id'] !== $ctx['plant']) ql_out(['ok' => false, 'error' => 'Not found'], 404);
  $r['payload'] = json_decode($r['payload'] ?? 'null', true);
  $docs = json_decode($r['docs'] ?? '[]', true) ?: [];
  // strip the base64 blob — the owner streams each file via action:'doc'
  $r['docs'] = array_map(function ($d) { return ['name' => $d['name'] ?? 'document', 'mime' => $d['mime'] ?? '', 'size' => $d['size'] ?? 0]; }, $docs);
  ql_out(['ok' => true, 'row' => $r]);
}

/* ─────────────── OWNER: stream a stored document (from the DB) ─────────────── */
if ($action === 'doc') {
  $ctx = ql_ob_ctx($b);
  $token = (string)($b['token'] ?? ($_GET['token'] ?? ''));
  $i = (int)($b['i'] ?? ($_GET['i'] ?? 0));
  $r = ql_ob_row($db, $token);
  if (!$r || $r['plant_id'] !== $ctx['plant']) ql_out(['ok' => false, 'error' => 'Not found'], 404);
  $docs = json_decode($r['docs'] ?? '[]', true) ?: [];
  $d = $docs[$i] ?? null;
  if (!$d || empty($d['data'])) ql_out(['ok' => false, 'error' => 'No such file'], 404);
  $bytes = base64_decode($d['data'], true);
  if ($bytes === false) ql_out(['ok' => false, 'error' => 'Corrupt file'], 500);
  header('Content-Type: ' . ($d['mime'] ?? 'application/octet-stream'));
  header('Content-Disposition: inline; filename="' . preg_replace('/[^\w.\- ]/', '', (string)($d['name'] ?? 'document')) . '"');
  header('Content-Length: ' . strlen($bytes));
  header('X-Content-Type-Options: nosniff');
  echo $bytes;
  exit;
}

/* ─────────────── BUYER (PUBLIC): read the link's context ─────────────── */
if ($action === 'get') {
  $r = ql_ob_row($db, (string)($b['token'] ?? ($_GET['token'] ?? '')));
  if (!$r) ql_out(['ok' => false, 'error' => 'This onboarding link is invalid or has expired.'], 404);
  ql_out(['ok' => true, 'lead_name' => $r['lead_name'], 'status' => $r['status'], 'seller' => ql_ob_seller($db, $r['plant_id'])]);
}

/* ─────────────── BUYER (PUBLIC): submit details + documents ─────────────── */
if ($action === 'submit') {
  $r = ql_ob_row($db, (string)($b['token'] ?? ''));
  if (!$r) ql_out(['ok' => false, 'error' => 'Invalid link.'], 404);

  // Whitelisted text fields only — nothing else is stored.
  $fields = ['legal_name', 'gstin', 'pan', 'address', 'contact_person', 'phone', 'email', 'bank_name', 'account_no', 'ifsc', 'notes'];
  $payload = [];
  foreach ($fields as $f) $payload[$f] = trim((string)($b[$f] ?? ''));

  // Files (optional): allow-list extension + MIME, cap size/count, base64 into the DB.
  $docs = [];
  if ($isMultipart && !empty($_FILES['docs']) && is_array($_FILES['docs']['name'])) {
    $finfo = function_exists('finfo_open') ? finfo_open(FILEINFO_MIME_TYPE) : null;
    $n = count($_FILES['docs']['name']);
    for ($k = 0; $k < $n && count($docs) < $MAX_FILES; $k++) {
      if (($_FILES['docs']['error'][$k] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) continue;
      $tmp = $_FILES['docs']['tmp_name'][$k];
      if (!is_uploaded_file($tmp)) continue;
      $orig = (string)($_FILES['docs']['name'][$k] ?? 'file');
      $size = (int)($_FILES['docs']['size'][$k] ?? 0);
      if ($size <= 0 || $size > $MAX_BYTES) continue;
      $ext = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
      if (!in_array($ext, $ALLOW_EXT, true)) continue;
      $mime = $finfo ? finfo_file($finfo, $tmp) : ($_FILES['docs']['type'][$k] ?? '');
      if (!in_array($mime, $ALLOW_MIME, true)) continue;
      $raw = file_get_contents($tmp);
      if ($raw === false) continue;
      $docs[] = ['name' => mb_substr(preg_replace('/[^\w.\- ]/u', '', $orig), 0, 120), 'mime' => $mime, 'size' => $size, 'data' => base64_encode($raw)];
    }
    if ($finfo) finfo_close($finfo);
  }

  $up = $db->prepare('UPDATE onboarding SET payload = ?, docs = ?, status = ?, submitted_at = CURRENT_TIMESTAMP WHERE token = ?');
  $up->execute([json_encode($payload, JSON_UNESCAPED_UNICODE), json_encode($docs), 'submitted', $r['token']]);
  ql_out(['ok' => true]);
}

ql_out(['ok' => false, 'error' => 'Unknown action'], 400);
