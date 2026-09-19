<?php
/* einvoice.php — GST e-invoicing through the Invoice Registration Portal.

   The IRP is the source of truth. This door:
     config   owner/admin/partner: save the IRP credentials for this firm
              (mode, base URL, client id/secret, API user/password, the
              portal's public key) — server-side only, echoed masked.
     status   is the firm configured; the last session; counts.
     prepare  build + validate the portal JSON for one invoice (no network)
     generate register the invoice: one row per (firm, doc no., FY) so a
              double click, a refresh or two devices cannot register twice;
              stores IRN / Ack No / Ack Date / SignedQRCode / SignedInvoice /
              the raw response exactly as received; a "duplicate IRN"
              refusal is resolved to the existing registration.
     verify   ask the portal for the IRN by document details — the safe way
              to recover from a timeout that lost the response.
     cancel   cancel the IRN (within the portal's 24 h window).
     get      the record for one invoice (never the credentials).
     json     the signed invoice JSON for download.

   NOTHING here manufactures an IRN, a QR or a signature. A failed or timed-out
   registration leaves the row 'failed' with the portal's own message; the
   invoice prints without a QR until the portal has spoken. */
require __DIR__ . '/db.php';
require __DIR__ . '/gstin-lib.php';
require __DIR__ . '/einvoice-lib.php';
ql_cors();
$ctx = ql_token_ctx();
if (!$ctx) ql_out(['ok' => false, 'error' => 'Unauthorized'], 401);
$b = ql_body();
$action = (string)($b['action'] ?? ($_GET['action'] ?? 'get'));
$role = (string)($ctx['role'] ?? 'owner');
$plant = (string)$ctx['plant'];
$co = trim((string)($b['co'] ?? ($_GET['co'] ?? '')));
if ($co === '') $co = $plant;   // the primary firm's blob is keyed by the plant id
$canManage = in_array($role, ['owner', 'admin', 'partner'], true);

ql_einv_tables();

/* ── credentials: plant_secrets, never app_data (data.php returns every app_data row to every role) ── */
if ($action === 'config') {
  if (!$canManage) ql_out(['ok' => false, 'error' => 'Only the owner can set the e-invoice connection'], 403);
  if (!empty($b['clear'])) { foreach (['einv_mode', 'einv_base', 'einv_client_id', 'einv_client_secret', 'einv_user', 'einv_pass', 'einv_pubkey', 'einv_session'] as $k) ql_secret_set($plant, $k, ''); ql_out(['ok' => true, 'cleared' => true]); }
  $mode = (string)($b['mode'] ?? 'sandbox'); if (!in_array($mode, ['sandbox', 'production'], true)) $mode = 'sandbox';
  $base = trim((string)($b['base'] ?? ''));
  if ($base === '') $base = $mode === 'production' ? 'https://einvoice1.gst.gov.in' : 'https://einv-apisandbox.nic.in';
  if (!preg_match('~^https://[a-z0-9.-]+(/[A-Za-z0-9._/-]*)?$~i', $base)) ql_out(['ok' => false, 'error' => 'The base URL must be https://host[/path]'], 400);
  ql_secret_set($plant, 'einv_mode', $mode); ql_secret_set($plant, 'einv_base', rtrim($base, '/'));
  foreach (['client_id' => 'einv_client_id', 'client_secret' => 'einv_client_secret', 'user' => 'einv_user', 'pass' => 'einv_pass', 'pubkey' => 'einv_pubkey'] as $in => $k) {
    if (array_key_exists($in, $b)) { $v = trim((string)$b[$in]); if ($v !== '') ql_secret_set($plant, $k, $v); }   // a blank box keeps the saved value
  }
  ql_secret_set($plant, 'einv_session', '');   // new credentials → new session
  ql_out(['ok' => true] + ql_einv_status_view($plant));
}
if ($action === 'status') {
  if (!$canManage) ql_out(['ok' => false, 'error' => 'Only the owner can see the e-invoice connection'], 403);
  $v = ql_einv_status_view($plant);
  if (!empty($b['test'])) {   // a live auth call proves the credentials — nothing is registered
    $c = ql_einv_creds($plant);
    if (!$c) $v['test'] = ['ok' => false, 'error' => 'Not configured'];
    else { $s = ql_einv_session($plant, $c, true); $v['test'] = $s['ok'] ? ['ok' => true, 'expiry' => $s['expiry']] : ['ok' => false, 'error' => $s['error']]; }
  }
  ql_out(['ok' => true] + $v);
}

/* ── the invoice ── */
$inv = trim((string)($b['inv'] ?? ($_GET['inv'] ?? '')));
if ($inv === '') ql_out(['ok' => false, 'error' => 'Which invoice? (inv)'], 400);
$doc = ql_einv_row($plant, $co, $inv);

if ($action === 'get') ql_out(['ok' => true, 'doc' => ql_einv_public($doc)]);
if ($action === 'json') {
  if (!$doc || empty($doc['signed_invoice'])) ql_out(['ok' => false, 'error' => 'No signed invoice for ' . $inv], 404);
  ql_out(['ok' => true, 'irn' => $doc['irn'], 'signed_invoice' => $doc['signed_invoice'], 'signed_qr' => $doc['signed_qr'], 'decoded' => ql_einv_jws_payload($doc['signed_invoice']), 'response' => json_decode((string)$doc['response_json'], true)]);
}
if (!$canManage) ql_out(['ok' => false, 'error' => 'Only the owner can register or cancel e-invoices'], 403);

$sale = ql_einv_find_sale($plant, $co, $inv);
if (!$sale && in_array($action, ['prepare', 'generate'], true)) ql_out(['ok' => false, 'error' => 'Invoice ' . $inv . ' is not in the saved register — save it first'], 404);

if ($action === 'prepare') {
  $built = ql_einv_build($sale['sale'], $sale['seller'], $sale['party']);
  ql_out(['ok' => $built['ok'], 'errors' => $built['errors'], 'payload' => $built['payload'], 'totals' => $built['totals'], 'state' => $doc ? $doc['status'] : ($built['ok'] ? 'ready' : 'draft'), 'doc' => ql_einv_public($doc)]);
}

if ($action === 'generate') {
  $built = ql_einv_build($sale['sale'], $sale['seller'], $sale['party']);
  if (!$built['ok']) ql_out(['ok' => false, 'error' => 'The invoice is not ready for the portal', 'errors' => $built['errors'], 'state' => 'draft']);
  $creds = ql_einv_creds($plant);
  if (!$creds) ql_out(['ok' => false, 'error' => 'The e-invoice connection is not set up (Settings → e-Invoice)', 'state' => 'draft']);
  $db = ql_db();
  /* ONE row per document, taken under a transaction: the second of two
     concurrent clicks sees 'generating' and stops; a refresh sees 'generated'
     and gets the record back. */
  $db->beginTransaction();
  try {
    $db->prepare('INSERT IGNORE INTO einvoice_docs (plant_id, company_id, doc_type, doc_no, fy, status, created_at) VALUES (?,?,?,?,?,?,NOW())')->execute([$plant, $co, 'INV', $inv, $built['fy'], 'ready']);
    $st = $db->prepare('SELECT * FROM einvoice_docs WHERE plant_id = ? AND company_id = ? AND doc_type = ? AND doc_no = ? AND fy = ? FOR UPDATE');
    $st->execute([$plant, $co, 'INV', $inv, $built['fy']]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if ($row['status'] === 'generated' || $row['status'] === 'cancelled') { $db->commit(); ql_out(['ok' => true, 'already' => true, 'doc' => ql_einv_public($row)]); }
    if ($row['status'] === 'generating' && $row['lock_until'] && strtotime($row['lock_until']) > time()) { $db->commit(); ql_out(['ok' => false, 'error' => 'This invoice is being registered right now — wait a moment, then Refresh', 'state' => 'generating', 'doc' => ql_einv_public($row)], 409); }
    if ((int)$row['attempts'] > 0 && $row['status'] === 'failed' && empty($b['retry'])) { $db->commit(); ql_out(['ok' => false, 'error' => 'The last attempt failed: ' . $row['error'] . ' — use Retry', 'state' => 'failed', 'doc' => ql_einv_public($row)], 409); }
    $db->prepare('UPDATE einvoice_docs SET status = ?, lock_until = DATE_ADD(NOW(), INTERVAL 90 SECOND), attempts = attempts + 1, request_json = ?, error = NULL, updated_at = NOW() WHERE id = ?')
       ->execute(['generating', json_encode($built['payload'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), $row['id']]);
    $db->commit();
  } catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); ql_out(['ok' => false, 'error' => 'Could not lock the invoice record: ' . $e->getMessage()], 500); }
  /* before submitting a RETRY, ask the portal whether it already holds this document (a lost response must not become a second registration) */
  if (!empty($b['retry']) || (int)$row['attempts'] > 0) {
    $found = ql_einv_lookup($plant, $creds, $inv, $built['payload']['DocDtls']['Dt']);
    if ($found['ok'] && !empty($found['data']['Irn'])) { ql_einv_store_success($row['id'], $found['data'], $found['raw'], 'recovered'); ql_out(['ok' => true, 'recovered' => true, 'doc' => ql_einv_public(ql_einv_row($plant, $co, $inv))]); }
  }
  $r = ql_einv_generate($plant, $creds, $built['payload']);
  if ($r['ok']) { ql_einv_store_success($row['id'], $r['data'], $r['raw'], 'generated'); ql_out(['ok' => true, 'doc' => ql_einv_public(ql_einv_row($plant, $co, $inv))]); }
  if (!empty($r['dup'])) {   // the portal says it already has it — fetch and keep the existing registration
    $found = ql_einv_lookup($plant, $creds, $inv, $built['payload']['DocDtls']['Dt']);
    if ($found['ok'] && !empty($found['data']['Irn'])) { ql_einv_store_success($row['id'], $found['data'], $found['raw'], 'recovered'); ql_out(['ok' => true, 'recovered' => true, 'doc' => ql_einv_public(ql_einv_row($plant, $co, $inv))]); }
  }
  ql_db()->prepare('UPDATE einvoice_docs SET status = ?, error = ?, response_json = ?, lock_until = NULL, needs_verify = ?, updated_at = NOW() WHERE id = ?')
         ->execute(['failed', mb_substr($r['error'], 0, 2000), $r['raw'] === null ? null : mb_substr($r['raw'], 0, 60000), !empty($r['timeout']) ? 1 : 0, $row['id']]);
  ql_out(['ok' => false, 'error' => $r['error'], 'state' => 'failed', 'timeout' => !empty($r['timeout']), 'doc' => ql_einv_public(ql_einv_row($plant, $co, $inv))]);
}

if ($action === 'verify') {
  $creds = ql_einv_creds($plant);
  if (!$creds) ql_out(['ok' => false, 'error' => 'The e-invoice connection is not set up (Settings → e-Invoice)']);
  $dt = $sale ? ql_einv_ddmmyyyy($sale['sale']['date'] ?? '') : '';
  if (!$doc && $dt === '') ql_out(['ok' => false, 'error' => 'Nothing to verify for ' . $inv], 404);
  $found = $doc && !empty($doc['irn']) ? ql_einv_by_irn($plant, $creds, $doc['irn']) : ql_einv_lookup($plant, $creds, $inv, $dt);
  if (!$found['ok']) ql_out(['ok' => false, 'error' => $found['error'], 'doc' => ql_einv_public($doc)]);
  if (empty($found['data']['Irn'])) ql_out(['ok' => true, 'registered' => false, 'error' => 'The portal has no registration for ' . $inv, 'doc' => ql_einv_public($doc)]);
  if (!$doc) {
    ql_db()->prepare('INSERT IGNORE INTO einvoice_docs (plant_id, company_id, doc_type, doc_no, fy, status, created_at) VALUES (?,?,?,?,?,?,NOW())')->execute([$plant, $co, 'INV', $inv, ql_einv_fy($sale['sale']['date'] ?? ''), 'ready']);
    $doc = ql_einv_row($plant, $co, $inv);
  }
  $cancelled = strtolower((string)($found['data']['Status'] ?? '')) === 'cnl';
  if ($cancelled) ql_db()->prepare('UPDATE einvoice_docs SET status = ?, response_json = ?, updated_at = NOW(), cancelled_at = COALESCE(cancelled_at, NOW()) WHERE id = ?')->execute(['cancelled', mb_substr($found['raw'], 0, 60000), $doc['id']]);
  else ql_einv_store_success($doc['id'], $found['data'], $found['raw'], 'verified');
  ql_out(['ok' => true, 'registered' => true, 'doc' => ql_einv_public(ql_einv_row($plant, $co, $inv))]);
}

if ($action === 'cancel') {
  if (!$doc || empty($doc['irn']) || $doc['status'] !== 'generated') ql_out(['ok' => false, 'error' => 'No registered IRN to cancel for ' . $inv], 400);
  $creds = ql_einv_creds($plant);
  if (!$creds) ql_out(['ok' => false, 'error' => 'The e-invoice connection is not set up (Settings → e-Invoice)']);
  $rsn = (string)($b['reason'] ?? '1'); if (!in_array($rsn, ['1', '2', '3', '4'], true)) $rsn = '1';   // 1 duplicate · 2 data entry mistake · 3 order cancelled · 4 other
  $rem = mb_substr(trim((string)($b['remarks'] ?? 'Cancelled from QuickLimes')), 0, 100);
  $r = ql_einv_cancel($plant, $creds, $doc['irn'], $rsn, $rem);
  if (!$r['ok']) ql_out(['ok' => false, 'error' => $r['error'], 'doc' => ql_einv_public($doc)]);
  ql_db()->prepare('UPDATE einvoice_docs SET status = ?, cancelled_at = NOW(), cancel_reason = ?, response_json = ?, updated_at = NOW() WHERE id = ?')->execute(['cancelled', $rsn . ': ' . $rem, mb_substr($r['raw'], 0, 60000), $doc['id']]);
  ql_out(['ok' => true, 'doc' => ql_einv_public(ql_einv_row($plant, $co, $inv))]);
}
ql_out(['ok' => false, 'error' => 'Unknown action'], 400);

/* ═══════════════════════ helpers (DB + portal client) ═══════════════════════ */
function ql_einv_tables() {
  static $done = false; if ($done) return; $done = true;
  $db = ql_db();
  $db->exec("CREATE TABLE IF NOT EXISTS plant_secrets (
    plant_id   VARCHAR(64)  NOT NULL,
    skey       VARCHAR(64)  NOT NULL,
    sval       MEDIUMTEXT   NULL,
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (plant_id, skey)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $db->exec("CREATE TABLE IF NOT EXISTS einvoice_docs (
    id             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    plant_id       VARCHAR(64)  NOT NULL,
    company_id     VARCHAR(64)  NOT NULL,
    doc_type       VARCHAR(8)   NOT NULL DEFAULT 'INV',
    doc_no         VARCHAR(32)  NOT NULL,
    fy             VARCHAR(9)   NOT NULL,
    status         VARCHAR(16)  NOT NULL DEFAULT 'ready',
    irn            VARCHAR(64)  NULL,
    ack_no         VARCHAR(32)  NULL,
    ack_date       VARCHAR(32)  NULL,
    signed_qr      MEDIUMTEXT   NULL,
    signed_invoice MEDIUMTEXT   NULL,
    request_json   MEDIUMTEXT   NULL,
    response_json  MEDIUMTEXT   NULL,
    ewb_no         VARCHAR(32)  NULL,
    ewb_date       VARCHAR(32)  NULL,
    ewb_valid      VARCHAR(32)  NULL,
    error          TEXT         NULL,
    needs_verify   TINYINT(1)   NOT NULL DEFAULT 0,
    attempts       INT          NOT NULL DEFAULT 0,
    lock_until     DATETIME     NULL,
    generated_at   DATETIME     NULL,
    cancelled_at   DATETIME     NULL,
    cancel_reason  VARCHAR(160) NULL,
    created_at     DATETIME     NOT NULL,
    updated_at     DATETIME     NULL,
    UNIQUE KEY uq_doc (plant_id, company_id, doc_type, doc_no, fy),
    KEY ix_irn (irn)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
function ql_secret_get($plant, $k) { try { $st = ql_db()->prepare('SELECT sval FROM plant_secrets WHERE plant_id = ? AND skey = ?'); $st->execute([$plant, $k]); $v = $st->fetchColumn(); return $v === false ? '' : (string)$v; } catch (Throwable $e) { return ''; } }
function ql_secret_set($plant, $k, $v) { ql_db()->prepare('INSERT INTO plant_secrets (plant_id, skey, sval) VALUES (?,?,?) ON DUPLICATE KEY UPDATE sval = VALUES(sval)')->execute([$plant, $k, (string)$v]); }
/* operator config.php wins (EINV_* keys), else the firm's Settings */
function ql_einv_creds($plant) {
  $cfg = is_file(__DIR__ . '/config.php') ? ql_config() : [];
  $g = function ($ck, $sk) use ($cfg, $plant) { $v = trim((string)($cfg[$ck] ?? '')); return $v !== '' ? $v : ql_secret_get($plant, $sk); };
  $c = ['mode' => $g('EINV_MODE', 'einv_mode') ?: 'sandbox', 'base' => rtrim($g('EINV_BASE', 'einv_base'), '/'), 'client_id' => $g('EINV_CLIENT_ID', 'einv_client_id'), 'client_secret' => $g('EINV_CLIENT_SECRET', 'einv_client_secret'), 'user' => $g('EINV_USER', 'einv_user'), 'pass' => $g('EINV_PASS', 'einv_pass'), 'pubkey' => $g('EINV_PUBKEY', 'einv_pubkey'), 'gstin' => ''];
  if ($c['base'] === '') $c['base'] = $c['mode'] === 'production' ? 'https://einvoice1.gst.gov.in' : 'https://einv-apisandbox.nic.in';
  foreach (['client_id', 'client_secret', 'user', 'pass', 'pubkey'] as $k) if ($c[$k] === '') return null;
  return $c;
}
function ql_einv_status_view($plant) {
  $c = ql_einv_creds($plant); $mask = function ($s) { $s = (string)$s; return $s === '' ? '' : (strlen($s) > 4 ? str_repeat('•', 6) . substr($s, -4) : '••••'); };
  $sess = json_decode(ql_secret_get($plant, 'einv_session') ?: 'null', true);
  $n = ['generated' => 0, 'failed' => 0, 'cancelled' => 0];
  try { $st = ql_db()->prepare('SELECT status, COUNT(*) c FROM einvoice_docs WHERE plant_id = ? GROUP BY status'); $st->execute([$plant]); foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $n[$r['status']] = (int)$r['c']; } catch (Throwable $e) {}
  return ['configured' => (bool)$c, 'mode' => ql_secret_get($plant, 'einv_mode') ?: 'sandbox', 'base' => $c ? $c['base'] : (ql_secret_get($plant, 'einv_base') ?: ''),
    'client_id' => $mask(ql_secret_get($plant, 'einv_client_id')), 'user' => ql_secret_get($plant, 'einv_user'), 'has_secret' => ql_secret_get($plant, 'einv_client_secret') !== '', 'has_pass' => ql_secret_get($plant, 'einv_pass') !== '', 'has_pubkey' => ql_secret_get($plant, 'einv_pubkey') !== '',
    'session_expiry' => is_array($sess) ? ($sess['expiry'] ?? '') : '', 'counts' => $n, 'source' => (is_file(__DIR__ . '/config.php') && trim((string)(ql_config()['EINV_CLIENT_ID'] ?? '')) !== '') ? 'config.php' : 'settings'];
}
function ql_einv_row($plant, $co, $inv) {
  try { $st = ql_db()->prepare('SELECT * FROM einvoice_docs WHERE plant_id = ? AND company_id = ? AND doc_type = ? AND doc_no = ? ORDER BY id DESC LIMIT 1'); $st->execute([$plant, $co, 'INV', $inv]); $r = $st->fetch(PDO::FETCH_ASSOC); return $r ?: null; } catch (Throwable $e) { return null; }
}
/* what the browser may see: the registration, never the credentials */
function ql_einv_public($r) {
  if (!$r) return null;
  return ['inv' => $r['doc_no'], 'fy' => $r['fy'], 'status' => $r['status'], 'irn' => $r['irn'] ?: '', 'ackNo' => $r['ack_no'] ?: '', 'ackDt' => $r['ack_date'] ?: '', 'signedQr' => $r['signed_qr'] ?: '', 'hasSignedInvoice' => !empty($r['signed_invoice']),
    'ewbNo' => $r['ewb_no'] ?: '', 'ewbDt' => $r['ewb_date'] ?: '', 'ewbValid' => $r['ewb_valid'] ?: '', 'error' => $r['error'] ?: '', 'needsVerify' => (bool)$r['needs_verify'], 'attempts' => (int)$r['attempts'],
    'generatedAt' => $r['generated_at'] ?: '', 'cancelledAt' => $r['cancelled_at'] ?: '', 'cancelReason' => $r['cancel_reason'] ?: ''];
}
function ql_einv_store_success($id, $data, $raw, $how) {
  ql_db()->prepare('UPDATE einvoice_docs SET status = ?, irn = ?, ack_no = ?, ack_date = ?, signed_qr = ?, signed_invoice = ?, response_json = ?, ewb_no = ?, ewb_date = ?, ewb_valid = ?, error = NULL, needs_verify = 0, lock_until = NULL, generated_at = COALESCE(generated_at, NOW()), updated_at = NOW() WHERE id = ?')
         ->execute(['generated', (string)($data['Irn'] ?? ''), (string)($data['AckNo'] ?? ''), (string)($data['AckDt'] ?? ''), (string)($data['SignedQRCode'] ?? ''), (string)($data['SignedInvoice'] ?? ''), $raw === null ? null : mb_substr($raw, 0, 200000),
           (string)($data['EwbNo'] ?? '') ?: null, (string)($data['EwbDt'] ?? '') ?: null, (string)($data['EwbValidTill'] ?? '') ?: null, $id]);
}
/* the sale + seller + party, out of the company blob (the same store data.php serves) */
function ql_einv_find_sale($plant, $co, $inv) {
  $st = ql_db()->prepare('SELECT data FROM app_data WHERE plant_id = ? AND data_id = ? LIMIT 1'); $st->execute([$plant, $co]);
  $row = $st->fetch(PDO::FETCH_ASSOC); if (!$row) return null;
  $d = json_decode($row['data'], true); if (!is_array($d) || empty($d['sales']) || !is_array($d['sales'])) return null;
  $sale = null; foreach ($d['sales'] as $s) { if (is_array($s) && (string)($s['inv'] ?? '') === $inv && empty($s['_del']) && strtolower((string)($s['status'] ?? '')) !== 'cancelled') { $sale = $s; break; } }
  if (!$sale) return null;
  $party = null; $pn = strtoupper(trim((string)($sale['party'] ?? '')));
  foreach ((isset($d['parties']) && is_array($d['parties'])) ? $d['parties'] : [] as $p) { if (is_array($p) && strtoupper(trim((string)($p['name'] ?? ''))) === $pn) { $party = $p; break; } }
  /* the seller: the plant row (name, address, GSTIN, phone) + the profile bits the seed carries (state, pin, email, roundOff) */
  $pl = ql_db()->prepare('SELECT * FROM plants WHERE id = ? LIMIT 1'); $pl->execute([$co]); $p = $pl->fetch(PDO::FETCH_ASSOC) ?: [];
  $prof = (isset($d['profile']) && is_array($d['profile'])) ? $d['profile'] : [];
  $seller = ['name' => (string)($p['plant_name'] ?? ($prof['name'] ?? '')), 'short' => (string)($p['plant_name'] ?? ''), 'gstin' => (string)($p['gst_number'] ?? ($prof['gstin'] ?? '')), 'address' => (string)($p['address'] ?? ($prof['address'] ?? '')),
    'city' => (string)($p['city'] ?? ($prof['city'] ?? '')), 'state' => (string)($prof['state'] ?? ''), 'pin' => (string)($prof['pin'] ?? ''), 'phone' => (string)($p['contact_phone'] ?? ($prof['phone'] ?? '')), 'email' => (string)($prof['email'] ?? ''), 'roundOff' => $prof['roundOff'] ?? true];
  /* the seed that data.js applies by GSTIN is not on the server — the browser sends the profile it prints with, so the portal gets the same facts the paper shows */
  $b = ql_body(); if (isset($b['seller']) && is_array($b['seller'])) foreach (['name', 'short', 'gstin', 'address', 'city', 'state', 'pin', 'phone', 'email', 'roundOff'] as $k) if (array_key_exists($k, $b['seller']) && $b['seller'][$k] !== '' && $b['seller'][$k] !== null) $seller[$k] = $b['seller'][$k];
  return ['sale' => $sale, 'seller' => $seller, 'party' => $party];
}

/* ── the portal client (NIC e-invoice API shape) ── */
function ql_einv_http($method, $url, $headers, $body, &$timedOut, $timeout = 60) {
  $ch = curl_init($url);
  $h = ['Content-Type: application/json', 'Accept: application/json']; foreach ($headers as $k => $v) $h[] = $k . ': ' . $v;
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $h, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_TIMEOUT => $timeout, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_SSL_VERIFYPEER => true]);
  if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_SLASHES));
  $raw = curl_exec($ch); $errno = curl_errno($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch);
  $timedOut = in_array($errno, [CURLE_OPERATION_TIMEOUTED, 7, 28], true);
  if ($raw === false) return ['ok' => false, 'error' => 'Could not reach the portal: ' . $err, 'code' => 0, 'raw' => null];
  $j = json_decode($raw, true);
  return ['ok' => $code >= 200 && $code < 300 && is_array($j), 'code' => $code, 'json' => is_array($j) ? $j : null, 'raw' => $raw, 'error' => is_array($j) ? '' : 'HTTP ' . $code . ' — not JSON'];
}
function ql_einv_headers($creds, $sess = null) {
  $h = ['client_id' => $creds['client_id'], 'client_secret' => $creds['client_secret'], 'Gstin' => $creds['gstin']];
  if ($sess) { $h['user_name'] = $creds['user']; $h['AuthToken'] = $sess['token']; }
  return $h;
}
/* authenticate (cached session per firm, refreshed when within 5 minutes of expiry or on demand) */
function ql_einv_session($plant, $creds, $force = false) {
  $cached = json_decode(ql_secret_get($plant, 'einv_session') ?: 'null', true);
  if (!$force && is_array($cached) && !empty($cached['token']) && !empty($cached['sek']) && !empty($cached['exp_ts']) && $cached['exp_ts'] - 300 > time()) return ['ok' => true, 'token' => $cached['token'], 'sek' => base64_decode($cached['sek']), 'expiry' => $cached['expiry']];
  $appKey = ql_einv_random_key();
  $encPass = ql_einv_rsa_encrypt($creds['pubkey'], $creds['pass']); $encKey = ql_einv_rsa_encrypt($creds['pubkey'], $appKey);
  if ($encPass === null || $encKey === null) return ['ok' => false, 'error' => 'The portal public key could not be used — paste the PEM exactly as downloaded from the portal'];
  $timedOut = false;
  $r = ql_einv_http('POST', $creds['base'] . '/eivital/v1.04/auth', ql_einv_headers($creds), ['UserName' => $creds['user'], 'Password' => $encPass, 'AppKey' => $encKey, 'ForceRefreshAccessToken' => (bool)$force], $timedOut, 30);
  if (!$r['ok']) return ['ok' => false, 'error' => 'Portal sign-in failed: ' . ($r['json'] ? ql_einv_error_text($r['json']) : $r['error'])];
  $j = $r['json'];
  if ((int)($j['Status'] ?? 0) !== 1 || empty($j['Data'])) return ['ok' => false, 'error' => 'Portal sign-in refused: ' . ql_einv_error_text($j)];
  $s = ql_einv_open_auth($appKey, $j['Data']);
  if (!$s) return ['ok' => false, 'error' => 'Portal sign-in reply could not be decrypted (wrong public key?)'];
  $expTs = strtotime($s['expiry']) ?: (time() + 6 * 3600);
  ql_secret_set($plant, 'einv_session', json_encode(['token' => $s['token'], 'sek' => base64_encode($s['sek']), 'expiry' => $s['expiry'], 'exp_ts' => $expTs]));
  return ['ok' => true, 'token' => $s['token'], 'sek' => $s['sek'], 'expiry' => $s['expiry']];
}
function ql_einv_creds_with_gstin($plant, $creds) { if ($creds['gstin'] === '') { $g = ''; $b = ql_body(); if (isset($b['seller']['gstin'])) $g = strtoupper(preg_replace('~[^A-Z0-9]~i', '', (string)$b['seller']['gstin'])); if ($g === '') { $st = ql_db()->prepare('SELECT gst_number FROM plants WHERE id = ? LIMIT 1'); $st->execute([(string)(ql_body()['co'] ?? $plant)]); $g = strtoupper(preg_replace('~[^A-Z0-9]~i', '', (string)$st->fetchColumn())); } $creds['gstin'] = $g; } return $creds; }
/* one encrypted call; a stale session is refreshed once */
function ql_einv_call($plant, $creds, $method, $path, $payloadArray, $timeout = 60) {
  $creds = ql_einv_creds_with_gstin($plant, $creds);
  $sess = ql_einv_session($plant, $creds); if (!$sess['ok']) return ['ok' => false, 'error' => $sess['error'], 'raw' => null];
  $timedOut = false;
  $body = $payloadArray === null ? null : ql_einv_wrap($sess['sek'], $payloadArray);
  $r = ql_einv_http($method, $creds['base'] . $path, ql_einv_headers($creds, $sess), $body, $timedOut, $timeout);
  if ($timedOut) return ['ok' => false, 'error' => 'The portal did not answer in time — it may still have registered the invoice. Use Verify before trying again.', 'timeout' => true, 'raw' => null];
  if (!$r['ok']) return ['ok' => false, 'error' => 'Portal error: ' . ($r['json'] ? ql_einv_error_text($r['json']) : $r['error']), 'raw' => $r['raw']];
  $j = $r['json'];
  if ((int)($j['Status'] ?? 0) !== 1) {
    $txt = ql_einv_error_text($j);
    if (preg_match('~\b1005\b|\b1004\b|invalid token|token expired~i', $txt)) { $sess = ql_einv_session($plant, $creds, true); if ($sess['ok']) { $r = ql_einv_http($method, $creds['base'] . $path, ql_einv_headers($creds, $sess), $payloadArray === null ? null : ql_einv_wrap($sess['sek'], $payloadArray), $timedOut, $timeout); $j = $r['json'] ?: []; if ((int)($j['Status'] ?? 0) === 1) goto ok; $txt = ql_einv_error_text($j); } }
    return ['ok' => false, 'error' => 'Portal: ' . $txt, 'dup' => (bool)preg_match('~\b2150\b|duplicate irn~i', $txt), 'dupInfo' => ql_einv_dup_irn($j), 'raw' => $r['raw']];
  }
  ok:
  $data = ql_einv_unwrap($sess['sek'], (string)($j['Data'] ?? ''));
  if (!is_array($data)) return ['ok' => false, 'error' => 'The portal answered but the reply could not be decrypted', 'raw' => $r['raw']];
  return ['ok' => true, 'data' => $data, 'raw' => $r['raw']];
}
function ql_einv_generate($plant, $creds, $payload) { return ql_einv_call($plant, $creds, 'POST', '/eicore/v1.03/Invoice', $payload, 60); }
function ql_einv_lookup($plant, $creds, $docNo, $docDt) { return ql_einv_call($plant, $creds, 'GET', '/eicore/v1.03/Invoice/irnbydocdetails?doctype=INV&docnum=' . rawurlencode($docNo) . '&docdate=' . rawurlencode($docDt), null, 30); }
function ql_einv_by_irn($plant, $creds, $irn) { return ql_einv_call($plant, $creds, 'GET', '/eicore/v1.03/Invoice/irn/' . rawurlencode($irn), null, 30); }
function ql_einv_cancel($plant, $creds, $irn, $rsn, $rem) { return ql_einv_call($plant, $creds, 'POST', '/eicore/v1.03/Invoice/Cancel', ['Irn' => $irn, 'CnlRsn' => $rsn, 'CnlRem' => $rem], 30); }
