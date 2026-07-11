<?php
/* ═══════════════════════════════════════════════════════════════
   /api/parties — GSTIN party master, correction memory, dedup.
   GET  ?plant_id&company_id&token            → { master:{gstin:name}, corrections:{scope|field:value} }
   POST { plant_id, company_id, token, action, … }
     action=save_party  { gstin, legal_name, alias? }
     action=correct     { scope_key, field, value }
     action=dedup       { file_hash?, inv_key? }        → { dupFile, dupInv }
     action=mark        { file_hash, inv_key, kind, source }
   Scoped by (plant_id proven by token). Names are stored verbatim; the client
   already rejected fragments via extract-schema.plausibleName before saving.
   ═══════════════════════════════════════════════════════════════ */
require __DIR__ . '/db.php';
ql_cors();
ql_ensure_tables();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
  $plantId = (string)($_GET['plant_id'] ?? '');
  if (!ql_verify_token(ql_token(), $plantId)) ql_out(['error' => 'Unauthorized'], 401);
  $db = ql_db();
  $master = [];
  $st = $db->prepare('SELECT gstin, legal_name FROM party_master WHERE plant_id = ?');
  $st->execute([$plantId]);
  foreach ($st->fetchAll() as $r) $master[$r['gstin']] = $r['legal_name'];
  $corr = [];
  $st2 = $db->prepare('SELECT scope_key, field, value FROM doc_corrections WHERE plant_id = ?');
  $st2->execute([$plantId]);
  foreach ($st2->fetchAll() as $r) $corr[$r['scope_key'] . '|' . $r['field']] = $r['value'];
  ql_out(['master' => $master, 'corrections' => $corr]);
}

$b = ql_body();
$plantId = (string)($b['plant_id'] ?? '');
$companyId = (string)($b['company_id'] ?? '');
if (!ql_verify_token(ql_token(), $plantId)) ql_out(['error' => 'Unauthorized'], 401);
$action = (string)($b['action'] ?? '');
$db = ql_db();
$GST = '/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/';

if ($action === 'save_party') {
  $gstin = strtoupper(trim((string)($b['gstin'] ?? '')));
  $name  = trim((string)($b['legal_name'] ?? ''));
  if (!preg_match($GST, $gstin) || $name === '') ql_out(['error' => 'valid gstin + legal_name required'], 400);
  $name = mb_substr($name, 0, 190);
  $pan = substr($gstin, 2, 10);
  // merge alias into the JSON list
  $st = $db->prepare('SELECT aliases FROM party_master WHERE plant_id = ? AND gstin = ?');
  $st->execute([$plantId, $gstin]);
  $row = $st->fetch();
  $aliases = $row && $row['aliases'] ? (json_decode($row['aliases'], true) ?: []) : [];
  $alias = trim((string)($b['alias'] ?? ''));
  if ($alias !== '' && !in_array($alias, $aliases, true)) { $aliases[] = mb_substr($alias, 0, 190); $aliases = array_slice($aliases, -20); }
  $up = $db->prepare('INSERT INTO party_master (plant_id, gstin, legal_name, pan, aliases) VALUES (?,?,?,?,?)
    ON DUPLICATE KEY UPDATE legal_name = VALUES(legal_name), pan = VALUES(pan), aliases = VALUES(aliases)');
  $up->execute([$plantId, $gstin, $name, $pan, json_encode($aliases)]);
  ql_out(['ok' => true]);
}

if ($action === 'correct') {
  $scope = mb_substr(trim((string)($b['scope_key'] ?? '')), 0, 190);
  $field = mb_substr(trim((string)($b['field'] ?? '')), 0, 48);
  $value = mb_substr(trim((string)($b['value'] ?? '')), 0, 190);
  if ($scope === '' || $field === '') ql_out(['error' => 'scope_key + field required'], 400);
  $up = $db->prepare('INSERT INTO doc_corrections (plant_id, scope_key, field, value) VALUES (?,?,?,?)
    ON DUPLICATE KEY UPDATE value = VALUES(value)');
  $up->execute([$plantId, $scope, $field, $value]);
  ql_out(['ok' => true]);
}

if ($action === 'dedup') {
  $fh = (string)($b['file_hash'] ?? ''); $ik = (string)($b['inv_key'] ?? '');
  $dupFile = false; $dupInv = false;
  if ($fh !== '') { $st = $db->prepare('SELECT 1 FROM imported_docs WHERE plant_id=? AND company_id=? AND file_hash=? LIMIT 1'); $st->execute([$plantId, $companyId, $fh]); $dupFile = (bool)$st->fetch(); }
  if ($ik !== '') { $st = $db->prepare('SELECT 1 FROM imported_docs WHERE plant_id=? AND company_id=? AND inv_key=? LIMIT 1'); $st->execute([$plantId, $companyId, $ik]); $dupInv = (bool)$st->fetch(); }
  ql_out(['dupFile' => $dupFile, 'dupInv' => $dupInv]);
}

if ($action === 'mark') {
  $fh = mb_substr((string)($b['file_hash'] ?? ''), 0, 64);
  $ik = mb_substr((string)($b['inv_key'] ?? ''), 0, 190);
  $kind = in_array(($b['kind'] ?? ''), ['sales', 'purchase'], true) ? $b['kind'] : null;
  $src = mb_substr((string)($b['source'] ?? ''), 0, 190);
  if ($fh === '') ql_out(['error' => 'file_hash required'], 400);
  $up = $db->prepare('INSERT IGNORE INTO imported_docs (plant_id, company_id, file_hash, inv_key, kind, source) VALUES (?,?,?,?,?,?)');
  $up->execute([$plantId, $companyId, $fh, $ik ?: null, $kind, $src ?: null]);
  ql_out(['ok' => true]);
}

ql_out(['error' => 'unknown action'], 400);
