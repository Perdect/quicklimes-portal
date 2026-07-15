<?php
/* ═══════════════════════════════════════════════════════════════
   /api/crm — the CRM spine (companies, contacts, leads, activities).

   Relational, not the blob: leads and activities are high-volume and queryable,
   and the blob is loaded whole into a phone.

   The RULES (stages, forecast, consent, de-dup) live in crm-core.js and are
   unit-tested there. This endpoint stores and returns; it does not re-decide.
   The one thing it DOES enforce is what must never depend on a browser being
   honest: authorisation, ownership, and the consent columns existing.

   POST { plant_id, company_id, token, action, ... }
     list      -> { ok, companies, contacts, leads }   (everything for this firm)
     upsertCompany { company:{…} }  -> { ok, id }
     upsertContact { contact:{…} }  -> { ok, id }
     upsertLead    { lead:{…} }     -> { ok, id }
     activity      { activity:{…} } -> { ok, id }
     optOut        { contact_id }   -> { ok }          (never reversible here)
     del           { what, id }     -> { ok }
   ═══════════════════════════════════════════════════════════════ */
require __DIR__ . '/db.php';
ql_cors();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') ql_out(['ok' => false, 'error' => 'POST only'], 405);

$b       = ql_body();
$plantId = (string)($b['plant_id'] ?? '');
$coId    = (string)($b['company_id'] ?? '');
$ctx     = ql_token_ctx($plantId);
if (!$ctx) ql_out(['ok' => false, 'error' => 'Unauthorized'], 401);
if (!ql_role_can($ctx['role'], 'sales')) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);

ql_ensure_tables();
$db     = ql_db();
$action = (string)($b['action'] ?? 'list');
$user   = (string)($ctx['name'] ?? ($ctx['phone'] ?? ''));
$now    = gmdate('Y-m-d H:i:s');

/* Every row is scoped to (plant_id, company_id). A row belonging to another
   firm must be invisible AND unwritable — never trust an id from the browser. */
function ql_owns($db, $table, $id, $plantId, $coId) {
  $st = $db->prepare("SELECT id FROM $table WHERE id = ? AND plant_id = ? AND company_id = ? LIMIT 1");
  $st->execute([(int)$id, $plantId, $coId]);
  return (bool)$st->fetch();
}
function pick($src, $keys) {
  $o = [];
  foreach ($keys as $k) $o[$k] = array_key_exists($k, $src) ? $src[$k] : null;
  return $o;
}

if ($action === 'list') {
  $out = [];
  foreach ([['companies', 'crm_companies'], ['contacts', 'crm_contacts'], ['leads', 'crm_leads']] as $t) {
    $st = $db->prepare("SELECT * FROM {$t[1]} WHERE plant_id = ? AND company_id = ? ORDER BY id DESC LIMIT 2000");
    $st->execute([$plantId, $coId]);
    $out[$t[0]] = $st->fetchAll(PDO::FETCH_ASSOC);
  }
  ql_out(['ok' => true] + $out);
}

if ($action === 'timeline') {
  $cc = (int)($b['crm_company'] ?? 0);
  $st = $db->prepare("SELECT * FROM crm_activities WHERE plant_id = ? AND company_id = ? AND crm_company = ? ORDER BY at DESC LIMIT 200");
  $st->execute([$plantId, $coId, $cc]);
  ql_out(['ok' => true, 'activities' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

if ($action === 'upsertCompany') {
  $c = is_array($b['company'] ?? null) ? $b['company'] : [];
  $name = trim((string)($c['name'] ?? ''));
  if (strlen($name) < 2) ql_out(['ok' => false, 'error' => 'Company name is required']);
  $gstin = strtoupper(preg_replace('/\s/', '', (string)($c['gstin'] ?? '')));
  // A wrong GSTIN is worse than none — it is the only true company identity in
  // India, and a bad one silently breaks de-duplication.
  if ($gstin !== '' && !(preg_match('/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/', $gstin)
      && (int)substr($gstin, 0, 2) >= 1 && (int)substr($gstin, 0, 2) <= 38)) {
    ql_out(['ok' => false, 'error' => 'That GSTIN doesn’t look right — 15 characters, like 08BNAPM0488E1Z3']);
  }
  $f = pick($c, ['industry', 'website', 'state', 'city', 'distance_km', 'est_tpm', 'current_supplier', 'source', 'party_id', 'notes']);
  $id = (int)($c['id'] ?? 0);
  if ($id) {
    if (!ql_owns($db, 'crm_companies', $id, $plantId, $coId)) ql_out(['ok' => false, 'error' => 'Not found'], 404);
    $st = $db->prepare('UPDATE crm_companies SET name=?, industry=?, gstin=?, website=?, state=?, city=?, distance_km=?, est_tpm=?, current_supplier=?, party_id=?, notes=? WHERE id=?');
    $st->execute([$name, (string)$f['industry'], $gstin ?: null, $f['website'], $f['state'], $f['city'],
      $f['distance_km'] !== null ? (int)$f['distance_km'] : null, $f['est_tpm'] !== null ? (float)$f['est_tpm'] : null,
      $f['current_supplier'], $f['party_id'], $f['notes'], $id]);
    ql_out(['ok' => true, 'id' => $id]);
  }
  try {
    $st = $db->prepare('INSERT INTO crm_companies (plant_id, company_id, name, industry, gstin, website, state, city, distance_km, est_tpm, current_supplier, source, party_id, notes)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $st->execute([$plantId, $coId, $name, (string)$f['industry'], $gstin ?: null, $f['website'], $f['state'], $f['city'],
      $f['distance_km'] !== null ? (int)$f['distance_km'] : null, $f['est_tpm'] !== null ? (float)$f['est_tpm'] : null,
      $f['current_supplier'], (string)($f['source'] ?: 'manual'), $f['party_id'], $f['notes']]);
  } catch (Throwable $e) {
    // The UNIQUE on (plant, company, gstin) is the last line of defence against
    // two rows for one buyer — crm-core.dupeOf warns first, this makes it true.
    ql_out(['ok' => false, 'dupe' => true, 'error' => 'A company with that GSTIN is already in your CRM']);
  }
  ql_out(['ok' => true, 'id' => (int)$db->lastInsertId()]);
}

if ($action === 'upsertContact') {
  $c = is_array($b['contact'] ?? null) ? $b['contact'] : [];
  $cc = (int)($c['crm_company'] ?? 0);
  if (!$cc || !ql_owns($db, 'crm_companies', $cc, $plantId, $coId)) ql_out(['ok' => false, 'error' => 'Unknown company'], 404);
  $basis = (string)($c['consent_basis'] ?? 'none');
  // Mirrors crm-core.mayContact's vocabulary. An unrecognised basis must not
  // become a silent 'none' that someone later reads as "fine to message".
  if (!in_array($basis, ['none', 'purchased', 'inbound', 'consent', 'contract'], true)) {
    ql_out(['ok' => false, 'error' => 'Unknown consent basis']);
  }
  $f = pick($c, ['name', 'role', 'email', 'phone', 'whatsapp', 'linkedin', 'consent_note']);
  $consentAt = ($basis === 'none') ? null : (string)($c['consent_at'] ?? $now);
  $id = (int)($c['id'] ?? 0);
  if ($id) {
    if (!ql_owns($db, 'crm_contacts', $id, $plantId, $coId)) ql_out(['ok' => false, 'error' => 'Not found'], 404);
    // opted_out_at is NEVER cleared here. Un-opting-out someone must be a
    // deliberate, separate act — not a side effect of editing their name.
    $st = $db->prepare('UPDATE crm_contacts SET name=?, role=?, email=?, phone=?, whatsapp=?, linkedin=?, consent_basis=?, consent_at=?, consent_note=? WHERE id=?');
    $st->execute([(string)$f['name'], $f['role'], $f['email'], $f['phone'], $f['whatsapp'], $f['linkedin'], $basis, $consentAt, $f['consent_note'], $id]);
    ql_out(['ok' => true, 'id' => $id]);
  }
  $st = $db->prepare('INSERT INTO crm_contacts (plant_id, company_id, crm_company, name, role, email, phone, whatsapp, linkedin, consent_basis, consent_at, consent_note)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  $st->execute([$plantId, $coId, $cc, (string)$f['name'], $f['role'], $f['email'], $f['phone'], $f['whatsapp'], $f['linkedin'], $basis, $consentAt, $f['consent_note']]);
  ql_out(['ok' => true, 'id' => (int)$db->lastInsertId()]);
}

if ($action === 'optOut') {
  $id = (int)($b['contact_id'] ?? 0);
  if (!$id || !ql_owns($db, 'crm_contacts', $id, $plantId, $coId)) ql_out(['ok' => false, 'error' => 'Not found'], 404);
  // One-way on purpose. A person who said "stop" said it once and for all;
  // the app must not offer a button that quietly undoes that.
  $st = $db->prepare('UPDATE crm_contacts SET opted_out_at = ? WHERE id = ? AND opted_out_at IS NULL');
  $st->execute([$now, $id]);
  ql_out(['ok' => true]);
}

if ($action === 'upsertLead') {
  $l = is_array($b['lead'] ?? null) ? $b['lead'] : [];
  $cc = (int)($l['crm_company'] ?? 0);
  if (!$cc || !ql_owns($db, 'crm_companies', $cc, $plantId, $coId)) ql_out(['ok' => false, 'error' => 'Unknown company'], 404);
  $stage = (string)($l['stage'] ?? 'new');
  if (!in_array($stage, ['new', 'contacted', 'qualified', 'sampled', 'quoted', 'negotiat', 'won', 'lost'], true)) {
    ql_out(['ok' => false, 'error' => 'Unknown stage']);
  }
  $f = pick($l, ['crm_contact', 'tonnes', 'price_per_tonne', 'score', 'score_why', 'owner', 'next_action', 'next_action_at', 'expected_close', 'lost_reason']);
  $won  = $stage === 'won'  ? $now : null;
  $lost = $stage === 'lost' ? $now : null;
  $id = (int)($l['id'] ?? 0);
  $args = [$cc, $f['crm_contact'] ? (int)$f['crm_contact'] : null, $stage,
    $f['tonnes'] !== null ? (float)$f['tonnes'] : null, $f['price_per_tonne'] !== null ? (float)$f['price_per_tonne'] : null,
    $f['score'] !== null ? (int)$f['score'] : null, $f['score_why'], $f['owner'] ?: $user,
    $f['next_action'], $f['next_action_at'] ?: null, $f['expected_close'] ?: null, $f['lost_reason']];
  if ($id) {
    if (!ql_owns($db, 'crm_leads', $id, $plantId, $coId)) ql_out(['ok' => false, 'error' => 'Not found'], 404);
    $st = $db->prepare('UPDATE crm_leads SET crm_company=?, crm_contact=?, stage=?, tonnes=?, price_per_tonne=?, score=?, score_why=?, owner=?, next_action=?, next_action_at=?, expected_close=?, lost_reason=?,
                        won_at = COALESCE(won_at, ?), lost_at = COALESCE(?, NULL) WHERE id=?');
    $st->execute(array_merge($args, [$won, $lost, $id]));
    ql_out(['ok' => true, 'id' => $id]);
  }
  $st = $db->prepare('INSERT INTO crm_leads (plant_id, company_id, crm_company, crm_contact, stage, tonnes, price_per_tonne, score, score_why, owner, next_action, next_action_at, expected_close, lost_reason, won_at, lost_at)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  $st->execute(array_merge([$plantId, $coId], $args, [$won, $lost]));
  ql_out(['ok' => true, 'id' => (int)$db->lastInsertId()]);
}

if ($action === 'activity') {
  $a = is_array($b['activity'] ?? null) ? $b['activity'] : [];
  $cc = (int)($a['crm_company'] ?? 0);
  if ($cc && !ql_owns($db, 'crm_companies', $cc, $plantId, $coId)) ql_out(['ok' => false, 'error' => 'Unknown company'], 404);
  $st = $db->prepare('INSERT INTO crm_activities (plant_id, company_id, crm_company, crm_lead, kind, direction, body, status, provider_id, user, at)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  $st->execute([$plantId, $coId, $cc ?: null, ($a['crm_lead'] ?? null) ? (int)$a['crm_lead'] : null,
    (string)($a['kind'] ?? 'note'), (string)($a['direction'] ?? 'out'), (string)($a['body'] ?? ''),
    $a['status'] ?? null, $a['provider_id'] ?? null, $user, (string)($a['at'] ?? $now)]);
  ql_out(['ok' => true, 'id' => (int)$db->lastInsertId()]);
}

if ($action === 'del') {
  $what = (string)($b['what'] ?? '');
  $map = ['company' => 'crm_companies', 'contact' => 'crm_contacts', 'lead' => 'crm_leads'];
  if (!isset($map[$what])) ql_out(['ok' => false, 'error' => 'Unknown type']);
  $id = (int)($b['id'] ?? 0);
  if (!$id || !ql_owns($db, $map[$what], $id, $plantId, $coId)) ql_out(['ok' => false, 'error' => 'Not found'], 404);
  $db->prepare("DELETE FROM {$map[$what]} WHERE id = ?")->execute([$id]);
  ql_out(['ok' => true]);
}

ql_out(['ok' => false, 'error' => 'Unknown action']);
