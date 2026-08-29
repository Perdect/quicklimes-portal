<?php
/* ═══════════════════════════════════════════════════════════════
   /api/rates.php — the lime-rate store behind quicklimes.com/lime-rates.

   PUBLIC  GET             → published rates + append-only history (JSON).
   ADMIN   POST + token    → list / save / publish / unpublish / remove
                             (owner-level only — the same auth as the app).
   PUBLIC  POST enquiry    → one website enquiry becomes a CRM lead in the
                             owner's pipeline (honeypot + length guards).

   THE RATE RULE: the site never shows an invented number. A product with no
   published rate renders as "on request" — publishing is a human decision
   made in the app's Website Rates page. History is append-only: changing
   today's rate never rewrites what was true last month.
   ═══════════════════════════════════════════════════════════════ */
require __DIR__ . '/db.php';
ql_cors();
ql_ensure_tables();
$db = ql_db();

/* ── PUBLIC READ ─────────────────────────────────────────────── */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  $slug = trim((string)($_GET['slug'] ?? ''));
  $q = $slug === ''
    ? $db->prepare('SELECT slug, name, grade, unit, rate, currency, moq, location, notes, seo_title, seo_desc, effective_from, updated_at FROM lime_rates WHERE published = 1 ORDER BY id')
    : $db->prepare('SELECT slug, name, grade, unit, rate, currency, moq, location, notes, seo_title, seo_desc, effective_from, updated_at FROM lime_rates WHERE published = 1 AND slug = ?');
  $q->execute($slug === '' ? [] : [$slug]);
  $rows = $q->fetchAll(PDO::FETCH_ASSOC);
  /* history: recent, per slug, oldest business detail only — no internals */
  $h = $db->prepare($slug === ''
    ? 'SELECT slug, rate, unit, recorded_at FROM lime_rate_history ORDER BY id DESC LIMIT 60'
    : 'SELECT slug, rate, unit, recorded_at FROM lime_rate_history WHERE slug = ? ORDER BY id DESC LIMIT 24');
  $h->execute($slug === '' ? [] : [$slug]);
  ql_out(['ok' => true, 'products' => $rows, 'history' => $h->fetchAll(PDO::FETCH_ASSOC)]);
}

$b = ql_body();
$action = (string)($b['action'] ?? '');

/* ── PUBLIC ENQUIRY → CRM LEAD ───────────────────────────────── */
if ($action === 'enquiry') {
  if (trim((string)($b['website'] ?? '')) !== '') ql_out(['ok' => true]);   // honeypot: swallow silently
  $name  = mb_substr(trim((string)($b['name'] ?? '')), 0, 120);
  $comp  = mb_substr(trim((string)($b['company'] ?? '')), 0, 160);
  $phone = preg_replace('/[^\d+]/', '', (string)($b['phone'] ?? ''));
  $email = mb_substr(trim((string)($b['email'] ?? '')), 0, 160);
  $prod  = mb_substr(trim((string)($b['product'] ?? '')), 0, 80);
  $qty   = mb_substr(trim((string)($b['qty'] ?? '')), 0, 40);
  $loc   = mb_substr(trim((string)($b['location'] ?? '')), 0, 160);
  $req   = mb_substr(trim((string)($b['requirement'] ?? '')), 0, 1000);
  if ($name === '' || strlen($phone) < 10) ql_out(['ok' => false, 'error' => 'Name and a valid phone number are required']);
  /* the lead lands in the plant that owns the rates (recorded on first save) */
  $p = $db->query("SELECT plant_id FROM lime_rates WHERE plant_id <> '' LIMIT 1")->fetchColumn();
  if (!$p) ql_out(['ok' => false, 'error' => 'Enquiries are not configured yet — please call or WhatsApp us directly']);
  $now = gmdate('Y-m-d H:i:s');
  try {
    $cName = $comp !== '' ? $comp : ($name . ' (website)');
    $db->prepare('INSERT INTO crm_companies (plant_id, company_id, name, city, state, industry, source, created_at)
                  VALUES (?,?,?,?,?,?,?,?)')
       ->execute([$p, $p, $cName, $loc, '', 'Website enquiry', 'website', $now]);
    $cc = (int)$db->lastInsertId();
    /* they typed their own number asking us to contact them — that IS the
       consent basis, recorded as such */
    $db->prepare('INSERT INTO crm_contacts (plant_id, company_id, crm_company, name, phone, email, role, consent_basis, consent_at, consent_note, created_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)')
       ->execute([$p, $p, $cc, $name, $phone, $email, 'Enquiry', 'enquiry', $now, 'Submitted the website rate-enquiry form', $now]);
    $ct = (int)$db->lastInsertId();
    $why = trim('Website rate enquiry — ' . $prod . ($qty !== '' ? ' · ' . $qty : '') . ($loc !== '' ? ' · deliver to ' . $loc : '')
      . ($req !== '' ? "\n" . $req : ''));
    $db->prepare('INSERT INTO crm_leads (plant_id, company_id, crm_company, crm_contact, stage, score_why, owner, next_action, next_action_at, created_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?)')
       ->execute([$p, $p, $cc, $ct, 'new', mb_substr($why, 0, 2000), 'Website', 'Call back — website rate enquiry', gmdate('Y-m-d'), $now]);
    ql_out(['ok' => true]);
  } catch (Throwable $e) {
    ql_out(['ok' => false, 'error' => 'Could not record the enquiry — please call or WhatsApp us directly']);
  }
}

/* ── ADMIN (owner token) ─────────────────────────────────────── */
$ctx = ql_token_ctx();
if (!$ctx)                           ql_out(['ok' => false, 'error' => 'Unauthorized'], 401);
if (!ql_role_can($ctx['role'], '*')) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);
$plantId = $ctx['plant'];

if ($action === 'list') {
  $rows = $db->query('SELECT * FROM lime_rates ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
  ql_out(['ok' => true, 'products' => $rows]);
}

if ($action === 'history') {
  $slug = trim((string)($b['slug'] ?? ''));
  $h = $db->prepare('SELECT slug, rate, unit, recorded_at FROM lime_rate_history WHERE slug = ? ORDER BY id DESC LIMIT 100');
  $h->execute([$slug]);
  ql_out(['ok' => true, 'history' => $h->fetchAll(PDO::FETCH_ASSOC)]);
}

if ($action === 'save') {
  $r = is_array($b['product'] ?? null) ? $b['product'] : [];
  $slug = strtolower(preg_replace('/[^a-z0-9-]/', '', (string)($r['slug'] ?? '')));
  if ($slug === '' || strlen($slug) > 64) ql_out(['ok' => false, 'error' => 'A clean slug is required (a-z, 0-9, dashes)']);
  $name = mb_substr(trim((string)($r['name'] ?? '')), 0, 120);
  if ($name === '') ql_out(['ok' => false, 'error' => 'Product name is required']);
  $rate = $r['rate'] === '' || $r['rate'] === null ? null : (float)$r['rate'];
  if ($rate !== null && ($rate < 0 || $rate > 10000000)) ql_out(['ok' => false, 'error' => 'That rate does not look right']);
  $now = gmdate('Y-m-d H:i:s');
  $cur = $db->prepare('SELECT id, rate FROM lime_rates WHERE slug = ? LIMIT 1');
  $cur->execute([$slug]);
  $ex = $cur->fetch(PDO::FETCH_ASSOC);
  $vals = [$plantId, $name, mb_substr((string)($r['grade'] ?? 'Industrial Grade'), 0, 80),
    mb_substr((string)($r['unit'] ?? 'MT'), 0, 24), $rate, 'INR',
    mb_substr((string)($r['moq'] ?? ''), 0, 64), mb_substr((string)($r['location'] ?? ''), 0, 120),
    mb_substr((string)($r['notes'] ?? ''), 0, 2000),
    mb_substr((string)($r['seo_title'] ?? ''), 0, 200), mb_substr((string)($r['seo_desc'] ?? ''), 0, 300),
    ($r['effective_from'] ?? '') !== '' ? (string)$r['effective_from'] : null, $now];
  if ($ex) {
    $db->prepare('UPDATE lime_rates SET plant_id=?, name=?, grade=?, unit=?, rate=?, currency=?, moq=?, location=?, notes=?, seo_title=?, seo_desc=?, effective_from=?, updated_at=? WHERE slug=' . $db->quote($slug))
       ->execute($vals);
  } else {
    $db->prepare('INSERT INTO lime_rates (plant_id, name, grade, unit, rate, currency, moq, location, notes, seo_title, seo_desc, effective_from, updated_at, slug, published)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,' . $db->quote($slug) . ',0)')
       ->execute($vals);
  }
  /* HISTORY IS APPEND-ONLY, and only on a REAL rate change: the record of
     what was true never mutates when today's number moves (§7/§19). */
  $oldRate = $ex ? ($ex['rate'] === null ? null : (float)$ex['rate']) : null;
  if ($rate !== null && $rate !== $oldRate) {
    $db->prepare('INSERT INTO lime_rate_history (slug, rate, unit, recorded_at) VALUES (?,?,?,?)')
       ->execute([$slug, $rate, mb_substr((string)($r['unit'] ?? 'MT'), 0, 24), $now]);
  }
  ql_out(['ok' => true, 'slug' => $slug]);
}

if ($action === 'publish' || $action === 'unpublish') {
  $slug = strtolower(preg_replace('/[^a-z0-9-]/', '', (string)($b['slug'] ?? '')));
  if ($action === 'publish') {
    /* never publish a rate-less row as if it had a number — "on request" is
       the published state for that, and it needs no flag */
    $chk = $db->prepare('SELECT rate FROM lime_rates WHERE slug = ?');
    $chk->execute([$slug]);
    $row = $chk->fetch(PDO::FETCH_ASSOC);
    if (!$row) ql_out(['ok' => false, 'error' => 'No such product']);
  }
  $db->prepare('UPDATE lime_rates SET published = ?, updated_at = ? WHERE slug = ?')
     ->execute([$action === 'publish' ? 1 : 0, gmdate('Y-m-d H:i:s'), $slug]);
  ql_out(['ok' => true]);
}

if ($action === 'remove') {
  $slug = strtolower(preg_replace('/[^a-z0-9-]/', '', (string)($b['slug'] ?? '')));
  $db->prepare('DELETE FROM lime_rates WHERE slug = ?')->execute([$slug]);
  $db->prepare('DELETE FROM lime_rate_history WHERE slug = ?')->execute([$slug]);
  ql_out(['ok' => true]);
}

ql_out(['ok' => false, 'error' => 'Unknown action'], 400);
