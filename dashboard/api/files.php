<?php
/* ═══════════════════════════════════════════════════════════════
   /api/files — server-side bill documents.

   WHY: uploaded scans lived only in the uploading browser's IndexedDB, so the
   eye on another device said "re-upload it on this device". The browser store
   stays (fast, offline); this endpoint is the shared copy behind it.

   POST { plant_id, company_id, token, action, ... }
     put { id, name, kind, mime, data }  -> { ok }          (data = base64)
     get { id }                          -> { ok, name, mime, kind, size, data }
     del { id }                          -> { ok }

   Rules that must never depend on a browser being honest:
     • auth + role (sales or purchase — the two registers that own documents);
     • ownership: every row and every file path is (plant_id, company_id)-scoped;
     • the doc id is [a-z0-9]{6,64} — it becomes a FILENAME, so anything else
       is refused before it can traverse;
     • mime whitelist (pdf/jpeg/png/webp) and an 8 MB base64 cap;
     • files land under files/<plantId>/ behind a deny-all .htaccess — the only
       way to read one is THIS endpoint, with a valid token.
   ═══════════════════════════════════════════════════════════════ */
const QL_DOC_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const QL_DOC_B64_MAX = 8 * 1024 * 1024;   // ~6 MB decoded

function ql_files_table($db) {
  $db->exec("CREATE TABLE IF NOT EXISTS doc_files (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    plant_id    VARCHAR(64)  NOT NULL,
    company_id  VARCHAR(96)  NOT NULL DEFAULT '',
    doc_id      VARCHAR(64)  NOT NULL,
    name        VARCHAR(190) NOT NULL DEFAULT '',
    kind        VARCHAR(40)  NOT NULL DEFAULT '',
    mime        VARCHAR(64)  NOT NULL DEFAULT '',
    size        INT          NOT NULL DEFAULT 0,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_doc (plant_id, company_id, doc_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
/* The id becomes a filename: refuse anything that is not plain [a-z0-9]. */
function ql_doc_id_ok($id) { return is_string($id) && preg_match('/^[a-z0-9]{6,64}$/', $id) === 1; }
function ql_doc_dir($plantId) {
  $safe = preg_replace('/[^A-Za-z0-9_-]/', '_', $plantId);
  $dir = __DIR__ . '/files/' . $safe;
  if (!is_dir($dir)) {
    @mkdir($dir, 0755, true);
    /* raw URLs must never serve these — the endpoint is the only door */
    @file_put_contents(__DIR__ . '/files/.htaccess', "Require all denied\nDeny from all\n");
  }
  return $dir;
}
function ql_doc_path($plantId, $coId, $docId) {
  $co = preg_replace('/[^A-Za-z0-9_-]/', '_', $coId);
  return ql_doc_dir($plantId) . '/' . $co . '_' . $docId . '.bin';
}

/* Test harness loads the real helpers with:  define('QL_FILES_LIB', 1);  */
if (defined('QL_FILES_LIB')) return;

require __DIR__ . '/db.php';
ql_cors();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') ql_out(['ok' => false, 'error' => 'POST only'], 405);

$b       = ql_body();
$plantId = (string)($b['plant_id'] ?? '');
$coId    = (string)($b['company_id'] ?? '');
$ctx     = ql_token_ctx($plantId);
if (!$ctx) ql_out(['ok' => false, 'error' => 'Unauthorized'], 401);
if (!ql_role_can($ctx['role'], 'sales') && !ql_role_can($ctx['role'], 'purchase')) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);

ql_ensure_tables();
$db = ql_db();
ql_files_table($db);
$action = (string)($b['action'] ?? '');

if ($action === 'put') {
  $id = (string)($b['id'] ?? '');
  if (!ql_doc_id_ok($id)) ql_out(['ok' => false, 'error' => 'Bad document id']);
  $mime = (string)($b['mime'] ?? '');
  if (!in_array($mime, QL_DOC_MIMES, true)) ql_out(['ok' => false, 'error' => 'Only PDF, JPEG, PNG or WebP documents are stored']);
  $data = (string)($b['data'] ?? '');
  if ($data === '' || strlen($data) > QL_DOC_B64_MAX) ql_out(['ok' => false, 'error' => 'File is empty or over the 6 MB limit']);
  $raw = base64_decode($data, true);
  if ($raw === false) ql_out(['ok' => false, 'error' => 'Broken upload — not valid base64']);

  $path = ql_doc_path($plantId, $coId, $id);
  if (@file_put_contents($path, $raw) === false) ql_out(['ok' => false, 'error' => 'Could not store the file'], 500);

  $st = $db->prepare('INSERT INTO doc_files (plant_id, company_id, doc_id, name, kind, mime, size)
    VALUES (?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE name = VALUES(name), kind = VALUES(kind), mime = VALUES(mime), size = VALUES(size)');
  $st->execute([$plantId, $coId, $id,
    mb_substr((string)($b['name'] ?? ''), 0, 190), mb_substr((string)($b['kind'] ?? ''), 0, 40), $mime, strlen($raw)]);
  ql_out(['ok' => true, 'size' => strlen($raw)]);
}

if ($action === 'get') {
  $id = (string)($b['id'] ?? '');
  if (!ql_doc_id_ok($id)) ql_out(['ok' => false, 'error' => 'Bad document id']);
  $st = $db->prepare('SELECT name, kind, mime, size FROM doc_files WHERE plant_id = ? AND company_id = ? AND doc_id = ? LIMIT 1');
  $st->execute([$plantId, $coId, $id]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  if (!$row) ql_out(['ok' => false, 'error' => 'not_found'], 404);
  $raw = @file_get_contents(ql_doc_path($plantId, $coId, $id));
  if ($raw === false) ql_out(['ok' => false, 'error' => 'not_found'], 404);
  ql_out(['ok' => true, 'name' => $row['name'], 'kind' => $row['kind'], 'mime' => $row['mime'],
          'size' => (int)$row['size'], 'data' => base64_encode($raw)]);
}

if ($action === 'del') {
  $id = (string)($b['id'] ?? '');
  if (!ql_doc_id_ok($id)) ql_out(['ok' => false, 'error' => 'Bad document id']);
  $st = $db->prepare('DELETE FROM doc_files WHERE plant_id = ? AND company_id = ? AND doc_id = ?');
  $st->execute([$plantId, $coId, $id]);
  @unlink(ql_doc_path($plantId, $coId, $id));
  ql_out(['ok' => true, 'removed' => $st->rowCount()]);
}

ql_out(['ok' => false, 'error' => 'Unknown action']);
