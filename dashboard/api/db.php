<?php
/* ═══════════════════════════════════════════════════════════════
   QuickLimes backend — shared helpers.
   PDO connection, CORS, JSON output, request parsing, and stateless
   HMAC login tokens. Included by login.php / data.php / plant.php /
   setup.php. Requires config.php (copy from config.example.php).
   ═══════════════════════════════════════════════════════════════ */

/* ── Config loader (config.php returns an assoc array) ──────────── */
function ql_config() {
  static $c = null;
  if ($c !== null) return $c;
  $f = __DIR__ . '/config.php';
  if (!is_file($f)) {
    ql_out(['error' => 'Backend not configured yet — create api/config.php from config.example.php'], 503);
  }
  $c = require $f;
  return $c;
}

/* ── PDO (MySQL) — connected lazily, reused per request ────────── */
function ql_db() {
  static $pdo = null;
  if ($pdo) return $pdo;
  $c = ql_config();
  $dsn = "mysql:host={$c['DB_HOST']};dbname={$c['DB_NAME']};charset=utf8mb4";
  try {
    $pdo = new PDO($dsn, $c['DB_USER'], $c['DB_PASS'], [
      PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
      PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
  } catch (Throwable $e) {
    ql_out(['error' => 'Database connection failed'], 500);
  }
  return $pdo;
}

/* ── CORS — the login page lives on quicklimes.com, the API on the
      app subdomain, so allow the known QuickLimes origins (and any
      localhost port for dev). Token auth travels in the body, not a
      cookie, so credentials are not needed. ──────────────────────── */
function ql_cors() {
  $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
  $ok = in_array($origin, [
    'https://quicklimes.com',
    'https://www.quicklimes.com',
    'https://app.quicklimes.com',
  ], true) || preg_match('#^https?://(localhost|127\.0\.0\.1)(:\d+)?$#', $origin);
  if ($ok) {
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
  }
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type, Authorization');
  header('Access-Control-Max-Age: 86400');
  if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
}

/* ── JSON response + halt ──────────────────────────────────────── */
function ql_out($obj, $code = 200) {
  http_response_code($code);
  header('Content-Type: application/json');
  header('Cache-Control: no-store');
  echo json_encode($obj);
  exit;
}

/* ── Parse a JSON request body once ────────────────────────────── */
function ql_body() {
  static $b = null;
  if ($b !== null) return $b;
  $raw = file_get_contents('php://input');
  $d = json_decode($raw, true);
  $b = is_array($d) ? $d : [];
  return $b;
}

/* ── Extract the login token (Authorization header, ?token=, or body) ── */
function ql_token() {
  $h = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
  if ($h && preg_match('/Bearer\s+(.+)/i', $h, $m)) return trim($m[1]);
  if (!empty($_GET['token'])) return (string)$_GET['token'];
  $b = ql_body();
  return (string)($b['token'] ?? '');
}

/* ── Stateless HMAC tokens: base64url(payload).base64url(hex-sig) ──
   Two payload shapes, both signed the same way (backward compatible):
     legacy : "<plantId>|<exp>"                     → role owner, no user
     v2     : "v2|<plantId>|<userId>|<role>|<exp>"   → per-employee, role-bearing
   Plant/user ids are UUIDs and roles are alphanumeric, so '|' is a safe
   delimiter. Existing owner logins keep issuing the legacy shape, so tokens
   already in the wild stay valid. ─────────────────────────────────────── */
function ql_b64url($s)     { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function ql_b64url_dec($s) { return base64_decode(strtr($s, '-_', '+/')); }

function ql_sign_token($plantId, $ttl = 2592000, $userId = '', $role = 'owner') {   // 30 days
  $c = ql_config();
  $exp = time() + $ttl;
  $payload = ($userId === '' && $role === 'owner')
    ? $plantId . '|' . $exp                                      // legacy shape (unchanged for owners)
    : 'v2|' . $plantId . '|' . $userId . '|' . $role . '|' . $exp;
  $sig = hash_hmac('sha256', $payload, $c['APP_SECRET']);        // hex string
  return ql_b64url($payload) . '.' . ql_b64url($sig);
}

/* Verify signature + expiry, return the auth context, else null.
   ['plant'=>id, 'user'=>id|'', 'role'=>role, 'exp'=>int]. Plant scoping is
   left to the caller. */
function ql_parse_token($token) {
  $c = ql_config();
  $parts = explode('.', (string)$token);
  if (count($parts) !== 2) return null;
  $payload = ql_b64url_dec($parts[0]);
  $sig     = ql_b64url_dec($parts[1]);
  $expect  = hash_hmac('sha256', $payload, $c['APP_SECRET']);
  if (!hash_equals($expect, $sig)) return null;
  $bits = explode('|', $payload);
  if (count($bits) === 2) {                          // legacy: plant|exp
    $pid = $bits[0]; $exp = $bits[1]; $uid = ''; $role = 'owner';
  } elseif (count($bits) === 5 && $bits[0] === 'v2') {
    $pid = $bits[1]; $uid = $bits[2]; $role = $bits[3]; $exp = $bits[4];
  } else {
    return null;
  }
  if ($pid === '' || (int)$exp < time()) return null;
  return ['plant' => $pid, 'user' => $uid, 'role' => ($role ?: 'owner'), 'exp' => (int)$exp];
}

/* Returns the plant id encoded in the token if valid, else false.
   When $plantId is non-empty it must equal the token's plant id.
   (Backward-compatible wrapper — existing endpoints call this.) */
function ql_verify_token($token, $plantId = '') {
  $ctx = ql_parse_token($token);
  if (!$ctx) return false;
  if ($plantId !== '' && $ctx['plant'] !== $plantId) return false;
  return $ctx['plant'];
}

/* Full auth context for the CURRENT request's token (or null), optionally
   scoped to a required plant id. */
function ql_token_ctx($plantId = '') {
  $ctx = ql_parse_token(ql_token());
  if (!$ctx) return null;
  if ($plantId !== '' && $ctx['plant'] !== $plantId) return null;
  return $ctx;
}

/* ── Role → capability map (THE server-side authorization boundary). ──
   '*' = every capability. Mirrors the frontend ROLES preset in shell.js,
   but only this map is enforced. Unknown roles get no capabilities. */
function ql_role_caps() {
  return [
    'owner'      => ['*'],
    'admin'      => ['*'],
    'partner'    => ['*'],
    'accountant' => ['sales', 'purchase', 'finance', 'gst', 'recon', 'reports', 'parties', 'extract'],
    'sales'      => ['sales', 'parties', 'reports', 'extract'],
    'purchase'   => ['purchase', 'parties', 'inventory', 'extract'],
    'production'  => ['production', 'inventory'],
    'dispatch'   => ['sales', 'production', 'inventory'],
  ];
}
function ql_role_can($role, $cap) {
  $allow = ql_role_caps()[$role] ?? [];
  return in_array('*', $allow, true) || in_array($cap, $allow, true);
}

/* Require a valid token scoped to $plantId whose role has $cap; halts with
   401/403 otherwise. Returns the auth context on success. */
function ql_require_cap($cap, $plantId = '') {
  $ctx = ql_token_ctx($plantId);
  if (!$ctx) ql_out(['error' => 'Unauthorized'], 401);
  if ($cap !== '' && !ql_role_can($ctx['role'], $cap)) ql_out(['error' => 'Forbidden'], 403);
  return $ctx;
}

/* ── Blob module-key → capability, for role-scoped data.php read/write.
   Keys not listed are metadata (profile_pic, etc.): readable by all, and on
   a restricted-role write they are retained from the existing row. ─────── */
function ql_blob_caps() {
  return [
    'sales' => 'sales', 'chunna' => 'sales',
    'purchases' => 'purchase',
    'parties' => 'parties',
    'finance' => 'finance', 'cashbook' => 'finance', 'loans' => 'finance',
    'reconcile' => 'recon',
    'tds' => 'gst', 'challans' => 'gst',
    'workers' => 'labour', 'workLog' => 'labour', 'att' => 'labour',
    'prod' => 'production',
    'refunds' => 'finance',
    'audit' => 'reports',
    // Bank account numbers + IFSC. Money detail — finance only. Was missing, so
    // every role (production, dispatch) could read the firm's bank details.
    'bankAccounts' => 'finance',
    // The WhatsApp store: customers' phone numbers AND the content of what was
    // said to them. Sales-only. Was missing, so any logged-in employee could
    // read the whole customer conversation log.
    'wa' => 'sales',
    // Statement upload history: which bank, which file, which period, who
    // uploaded it. It names the firm's bank accounts and its statement periods,
    // so it belongs with the money detail — same capability as bankAccounts.
    'statements' => 'finance',
  ];
}

/* Every module key blob() writes MUST appear in ql_blob_caps(), or it is
   readable by every role — a whitelist you must remember to extend fails
   OPEN here, which is the worst direction for it to fail. Two keys had already
   slipped through (bankAccounts, wa). blob-caps.test.php compares this map
   against data.js's blob() and fails when a new store is added without a
   capability, so nobody has to remember. */
/* Read filter: drop module keys the role may not see (full-access → untouched). */
function ql_filter_blob_for_role($data, $role) {
  if (!is_array($data) || ql_role_can($role, '*')) return $data;
  foreach (ql_blob_caps() as $key => $cap) {
    if (array_key_exists($key, $data) && !ql_role_can($role, $cap)) unset($data[$key]);
  }
  return $data;
}
/* Write merge: start from the existing row, overwrite ONLY module keys the
   role may write. Stops a restricted employee's partial save from wiping the
   modules their client never loaded. Full-access → straight replace. */
function ql_merge_blob_for_role($existing, $incoming, $role) {
  if (ql_role_can($role, '*') || !is_array($existing)) return $incoming;   // full replace
  if (!is_array($incoming)) return $existing;
  $caps = ql_blob_caps();
  $out  = $existing;
  foreach ($incoming as $key => $val) {
    $cap = $caps[$key] ?? null;
    if ($cap !== null && ql_role_can($role, $cap)) $out[$key] = $val;       // else keep existing
  }
  return $out;
}

/* ── Create tables if missing (idempotent; called by setup.php) ──── */
function ql_ensure_tables() {
  $db = ql_db();
  $db->exec("CREATE TABLE IF NOT EXISTS plants (
    id              VARCHAR(64)  NOT NULL PRIMARY KEY,
    owner_phone     VARCHAR(20)  NOT NULL DEFAULT '',
    password_hash   VARCHAR(255) NOT NULL DEFAULT '',
    plant_name      VARCHAR(190) NOT NULL DEFAULT '',
    gst_number      VARCHAR(20)  DEFAULT NULL,
    city            VARCHAR(120) DEFAULT NULL,
    address         VARCHAR(255) DEFAULT NULL,
    parent_plant_id VARCHAR(64)  DEFAULT NULL,
    plan_limit      INT          NOT NULL DEFAULT 2,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    KEY idx_owner (owner_phone),
    KEY idx_parent (parent_plant_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $db->exec("CREATE TABLE IF NOT EXISTS app_data (
    plant_id   VARCHAR(64) NOT NULL,
    data_id    VARCHAR(96) NOT NULL,
    data       LONGTEXT    NOT NULL,
    updated_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (plant_id, data_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  /* ── Bank Reconciliation (Phase 2): bank transactions scale out of the
        per-company JSON blob into their own indexed tables, scoped by
        (plant_id, company_id), so month/status/type filtering and paging
        happen in SQL and the store can hold millions of rows. ─────────── */
  /* ══ WhatsApp inbox ═════════════════════════════════════════════════
     Real conversations, stored so the chat lives INSIDE the ERP.

     PRIVACY: this stores customers' message content, which is a bigger DPDP
     question than a phone number. It is per-firm scoped, never cross-company,
     and media is stored BY REFERENCE (Whapi's media id + a small preview),
     not by copying files onto this host.

     chat_id is WhatsApp's own: "<number>@s.whatsapp.net" for a person,
     "<id>@g.us" for a group. Both are real and both arrive. */
  $db->exec("CREATE TABLE IF NOT EXISTS wa_chats (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    plant_id    VARCHAR(64)  NOT NULL,
    company_id  VARCHAR(96)  NOT NULL DEFAULT '',
    chat_id     VARCHAR(128) NOT NULL,
    is_group    TINYINT(1)   NOT NULL DEFAULT 0,
    phone       VARCHAR(24)  DEFAULT NULL,
    name        VARCHAR(190) DEFAULT NULL,
    party       VARCHAR(190) DEFAULT NULL,
    last_at     DATETIME     DEFAULT NULL,
    last_body   VARCHAR(255) DEFAULT NULL,
    last_from_me TINYINT(1)  NOT NULL DEFAULT 0,
    unread      INT          NOT NULL DEFAULT 0,
    KEY idx_recent (plant_id, company_id, last_at),
    UNIQUE KEY uq_chat (plant_id, company_id, chat_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  $db->exec("CREATE TABLE IF NOT EXISTS wa_messages (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    plant_id    VARCHAR(64)  NOT NULL,
    company_id  VARCHAR(96)  NOT NULL DEFAULT '',
    chat_id     VARCHAR(128) NOT NULL,
    wa_id       VARCHAR(128) NOT NULL,
    from_me     TINYINT(1)   NOT NULL DEFAULT 0,
    from_phone  VARCHAR(24)  DEFAULT NULL,
    from_name   VARCHAR(190) DEFAULT NULL,
    type        VARCHAR(16)  NOT NULL DEFAULT 'text',
    body        TEXT,
    media_id    VARCHAR(190) DEFAULT NULL,
    media_mime  VARCHAR(80)  DEFAULT NULL,
    media_name  VARCHAR(190) DEFAULT NULL,
    media_size  BIGINT       DEFAULT NULL,
    preview     MEDIUMTEXT   DEFAULT NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'received',
    at          DATETIME     NOT NULL,
    KEY idx_thread (plant_id, company_id, chat_id, at),
    KEY idx_poll (plant_id, company_id, id),
    UNIQUE KEY uq_wa (plant_id, wa_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  /* ══ CRM spine ══════════════════════════════════════════════════════
     Relational, NOT in the per-company JSON blob: leads and activities are
     high-volume and queryable, and the blob is loaded whole into a phone.

     NOTE ON `deals`: the architecture called for a separate deals table. It is
     deliberately NOT here yet. For a single-product plant a lead IS the deal —
     tonnes, price and stage on the lead say everything a deal row would, and a
     second table would add a step that carries no information. A deals table
     earns its place when one company runs several concurrent negotiations;
     until then it would be ceremony. crm_leads.company_id makes that a later
     migration, not a rewrite.

     NOTE ON `crm_companies.party_id`: a converted lead POINTS AT the ERP party
     rather than copying it. A CRM that duplicates the customer list is how
     sales and accounts start disagreeing about who owes what. */
  $db->exec("CREATE TABLE IF NOT EXISTS crm_companies (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    plant_id    VARCHAR(64)  NOT NULL,
    company_id  VARCHAR(96)  NOT NULL DEFAULT '',
    name        VARCHAR(190) NOT NULL,
    industry    VARCHAR(32)  NOT NULL DEFAULT '',
    gstin       VARCHAR(20)  DEFAULT NULL,
    website     VARCHAR(190) DEFAULT NULL,
    state       VARCHAR(80)  DEFAULT NULL,
    city        VARCHAR(80)  DEFAULT NULL,
    distance_km INT          DEFAULT NULL,
    est_tpm     DECIMAL(10,2) DEFAULT NULL,
    current_supplier VARCHAR(190) DEFAULT NULL,
    source      VARCHAR(24)  NOT NULL DEFAULT 'manual',
    party_id    VARCHAR(96)  DEFAULT NULL,
    notes       TEXT,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    KEY idx_co (plant_id, company_id),
    KEY idx_party (party_id),
    UNIQUE KEY uq_gstin (plant_id, company_id, gstin)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  /* Consent is a COLUMN, not an afterthought. India's DPDP Act 2023 treats a
     purchase manager's mobile as personal data even in B2B, and buying a list
     does not create a lawful basis to message them. Retrofitting this after
     10,000 contacts is painful; the penalties are not small. */
  $db->exec("CREATE TABLE IF NOT EXISTS crm_contacts (
    id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    plant_id      VARCHAR(64)  NOT NULL,
    company_id    VARCHAR(96)  NOT NULL DEFAULT '',
    crm_company   BIGINT       NOT NULL,
    name          VARCHAR(190) NOT NULL DEFAULT '',
    role          VARCHAR(120) DEFAULT NULL,
    email         VARCHAR(190) DEFAULT NULL,
    phone         VARCHAR(24)  DEFAULT NULL,
    whatsapp      VARCHAR(24)  DEFAULT NULL,
    linkedin      VARCHAR(190) DEFAULT NULL,
    consent_basis VARCHAR(24)  NOT NULL DEFAULT 'none',
    consent_at    DATETIME     DEFAULT NULL,
    consent_note  VARCHAR(255) DEFAULT NULL,
    opted_out_at  DATETIME     DEFAULT NULL,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    KEY idx_cc (plant_id, company_id, crm_company)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  $db->exec("CREATE TABLE IF NOT EXISTS crm_leads (
    id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    plant_id      VARCHAR(64)  NOT NULL,
    company_id    VARCHAR(96)  NOT NULL DEFAULT '',
    crm_company   BIGINT       NOT NULL,
    crm_contact   BIGINT       DEFAULT NULL,
    stage         VARCHAR(24)  NOT NULL DEFAULT 'new',
    tonnes        DECIMAL(10,2) DEFAULT NULL,
    price_per_tonne DECIMAL(12,2) DEFAULT NULL,
    score         INT          DEFAULT NULL,
    score_why     TEXT,
    owner         VARCHAR(120) DEFAULT NULL,
    next_action   VARCHAR(255) DEFAULT NULL,
    next_action_at DATE        DEFAULT NULL,
    expected_close DATE        DEFAULT NULL,
    lost_reason   VARCHAR(255) DEFAULT NULL,
    won_at        DATETIME     DEFAULT NULL,
    lost_at       DATETIME     DEFAULT NULL,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_stage (plant_id, company_id, stage),
    KEY idx_next (plant_id, company_id, next_action_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  /* One timeline per company. The WhatsApp log writes here too, so "what have
     we ever said to this customer" has a single answer. */
  $db->exec("CREATE TABLE IF NOT EXISTS crm_activities (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    plant_id    VARCHAR(64)  NOT NULL,
    company_id  VARCHAR(96)  NOT NULL DEFAULT '',
    crm_company BIGINT       DEFAULT NULL,
    crm_lead    BIGINT       DEFAULT NULL,
    kind        VARCHAR(16)  NOT NULL,
    direction   VARCHAR(8)   NOT NULL DEFAULT 'out',
    body        TEXT,
    status      VARCHAR(16)  DEFAULT NULL,
    provider_id VARCHAR(128) DEFAULT NULL,
    user        VARCHAR(120) DEFAULT NULL,
    at          DATETIME     NOT NULL,
    KEY idx_tl (plant_id, company_id, crm_company, at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  // The work queue. A job is an INTENT ("remind ARIF about 147/2025-26 at
  // step 7"), never a promise: cron re-checks the invoice before sending, so a
  // bill paid after queueing is never chased. send_at is UTC.
  $db->exec("CREATE TABLE IF NOT EXISTS jobs (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    plant_id    VARCHAR(64)  NOT NULL,
    company_id  VARCHAR(96)  NOT NULL DEFAULT '',
    kind        VARCHAR(32)  NOT NULL,
    dedupe_key  VARCHAR(190) NOT NULL DEFAULT '',
    send_at     DATETIME     NOT NULL,
    payload     TEXT         NOT NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'queued',
    attempts    INT          NOT NULL DEFAULT 0,
    last_error  VARCHAR(255) DEFAULT NULL,
    provider_id VARCHAR(128) DEFAULT NULL,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    done_at     DATETIME     DEFAULT NULL,
    KEY idx_due (status, send_at),
    KEY idx_plant (plant_id, company_id),
    UNIQUE KEY uq_dedupe (plant_id, company_id, dedupe_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $db->exec("CREATE TABLE IF NOT EXISTS bank_accounts (
    id          VARCHAR(64)  NOT NULL PRIMARY KEY,
    plant_id    VARCHAR(64)  NOT NULL,
    company_id  VARCHAR(96)  NOT NULL,
    bank        VARCHAR(80)  DEFAULT NULL,
    acct_no     VARCHAR(40)  DEFAULT NULL,
    ifsc        VARCHAR(20)  DEFAULT NULL,
    label       VARCHAR(120) DEFAULT NULL,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ba_scope (plant_id, company_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $db->exec("CREATE TABLE IF NOT EXISTS bank_txns (
    id          VARCHAR(64)   NOT NULL PRIMARY KEY,
    plant_id    VARCHAR(64)   NOT NULL,
    company_id  VARCHAR(96)   NOT NULL,
    account_id  VARCHAR(64)   DEFAULT NULL,
    txn_date    DATE          DEFAULT NULL,
    raw         TEXT,
    clean       VARCHAR(255)  DEFAULT NULL,
    utr         VARCHAR(64)   DEFAULT NULL,
    cheque      VARCHAR(20)   DEFAULT NULL,
    mode        VARCHAR(12)   DEFAULT NULL,
    bank        VARCHAR(80)   DEFAULT NULL,
    debit       DECIMAL(16,2) NOT NULL DEFAULT 0,
    credit      DECIMAL(16,2) NOT NULL DEFAULT 0,
    balance     DECIMAL(16,2) DEFAULT NULL,
    dedupe_key  VARCHAR(140)  DEFAULT NULL,
    status      VARCHAR(20)   DEFAULT NULL,
    confidence  INT           DEFAULT NULL,
    m           LONGTEXT,
    updated_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_bt_scope  (plant_id, company_id, txn_date),
    KEY idx_bt_status (plant_id, company_id, status),
    KEY idx_bt_dedupe (plant_id, company_id, dedupe_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $db->exec("CREATE TABLE IF NOT EXISTS party_aliases (
    plant_id    VARCHAR(64)  NOT NULL,
    company_id  VARCHAR(96)  NOT NULL,
    alias_key   VARCHAR(190) NOT NULL,
    party       VARCHAR(190) NOT NULL,
    updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (plant_id, company_id, alias_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  // GSTIN-keyed party master — the authoritative legal name for a GSTIN, so a
  // recognised GSTIN never gets a declaration/footer fragment as its name.
  $db->exec("CREATE TABLE IF NOT EXISTS party_master (
    plant_id    VARCHAR(64)  NOT NULL,
    gstin       VARCHAR(20)  NOT NULL,
    legal_name  VARCHAR(190) NOT NULL,
    pan         VARCHAR(12)  DEFAULT NULL,
    aliases     TEXT         DEFAULT NULL,   -- JSON array of seen spellings
    updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (plant_id, gstin)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  // Correction memory — a field the user fixed on a given supplier/pattern is
  // reused next time (application-level learning, NOT model retraining).
  $db->exec("CREATE TABLE IF NOT EXISTS doc_corrections (
    plant_id    VARCHAR(64)  NOT NULL,
    scope_key   VARCHAR(190) NOT NULL,   -- gstin or normalized supplier
    field       VARCHAR(48)  NOT NULL,
    value       VARCHAR(190) NOT NULL,
    updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (plant_id, scope_key, field)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  // Employee accounts — per-user logins under an account (the primary plant),
  // each carrying a role. The owner (plants.password_hash) is implicit and
  // always has full access; rows here are the additional restricted staff.
  $db->exec("CREATE TABLE IF NOT EXISTS users (
    id            VARCHAR(64)  NOT NULL PRIMARY KEY,
    plant_id      VARCHAR(64)  NOT NULL,          -- account = primary plant id
    name          VARCHAR(120) NOT NULL DEFAULT '',
    phone         VARCHAR(20)  NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(24)  NOT NULL DEFAULT 'sales',
    active        TINYINT      NOT NULL DEFAULT 1,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_phone (plant_id, phone),
    KEY idx_user_plant (plant_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  // Imported-document ledger — file-hash + invoice-key dedup + audit trail.
  $db->exec("CREATE TABLE IF NOT EXISTS imported_docs (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    plant_id    VARCHAR(64)  NOT NULL,
    company_id  VARCHAR(96)  NOT NULL,
    file_hash   CHAR(64)     NOT NULL,
    inv_key     VARCHAR(190) DEFAULT NULL,   -- gstin|invno|date|amount
    kind        VARCHAR(12)  DEFAULT NULL,
    source      VARCHAR(190) DEFAULT NULL,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_file (plant_id, company_id, file_hash),
    KEY k_inv (plant_id, company_id, inv_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

/* ── What one sale row still owes. PURE (no DB), so it can be tested, and
   shared by the cron's freshness check. Mirrors QLD's cS(): a cancelled bill
   owes nothing, 'paid'/'cash' are settled in full, otherwise total − paid. */
function ql_sale_outstanding($s) {
  if (!is_array($s)) return 0.0;
  $status = strtolower((string)($s['status'] ?? 'pending'));
  if ($status === 'cancelled') return 0.0;
  $qty     = (float)($s['qty'] ?? 0);
  $rate    = (float)($s['rate'] ?? 0);
  $taxable = isset($s['taxable']) ? (float)$s['taxable'] : $qty * $rate;
  $gst     = (float)($s['gst'] ?? 0);
  $total   = isset($s['total']) ? (float)$s['total'] : $taxable * (1 + $gst / 100);
  $paid    = ($status === 'paid' || $status === 'cash') ? $total : (float)($s['paid'] ?? 0);
  return max(0.0, $total - $paid);
}

/* ── Webhook secret. /api/wa-hook.php is an UNAUTHENTICATED public URL (Whapi
   calls it), so this is the only thing standing between a stranger and your
   customers' chat threads. Blank ⇒ the endpoint refuses everything. */
function ql_wa_hook_secret() { $c = ql_config(); return (string)($c['WA_HOOK_SECRET'] ?? ''); }

/* ── Whapi webhook parsing. PURE (no DB, no network) so it is tested against
   the REAL payload shape captured from a live channel, not from the docs —
   which do not publish the message schema at all.

   Observed envelope:  { channel_id, event:{type,event}, messages:[ … ] }
   Observed message:   { id, from_me, type, chat_id, timestamp, from,
                         from_name, text:{body} | image:{…} | document:{…} }
   Note `from` is a BARE number ("971543307707"), NOT a JID — the docs and even
   an older proxy of ours claimed otherwise. Real data wins. */
function ql_wa_parse_message($m) {
  if (!is_array($m) || empty($m['id'])) return null;
  $type = (string)($m['type'] ?? 'unknown');
  $chat = (string)($m['chat_id'] ?? '');
  $out = [
    'wa_id'      => (string)$m['id'],
    'chat_id'    => $chat,
    'is_group'   => (strpos($chat, '@g.us') !== false) ? 1 : 0,
    'from_me'    => !empty($m['from_me']) ? 1 : 0,
    'from_phone' => preg_replace('/\D/', '', (string)($m['from'] ?? '')),
    'from_name'  => (string)($m['from_name'] ?? ($m['chat_name'] ?? '')),
    'type'       => $type,
    'body'       => '',
    'media_id'   => null, 'media_mime' => null, 'media_name' => null,
    'media_size' => null, 'preview' => null,
    // timestamp is UNIX SECONDS. Treating it as ms puts every message in 1970.
    'at'         => gmdate('Y-m-d H:i:s', (int)($m['timestamp'] ?? time())),
  ];
  $media = null;
  if ($type === 'text') {
    $out['body'] = (string)($m['text']['body'] ?? '');
  } elseif (isset($m[$type]) && is_array($m[$type])) {
    $media = $m[$type];
    // A caption IS the message text for media; dropping it loses what was said.
    $out['body'] = (string)($media['caption'] ?? '');
  }
  if ($media) {
    $out['media_id']   = isset($media['id']) ? (string)$media['id'] : null;
    $out['media_mime'] = isset($media['mime_type']) ? (string)$media['mime_type'] : null;
    $out['media_name'] = isset($media['file_name']) ? (string)$media['file_name'] : null;
    $out['media_size'] = isset($media['file_size']) ? (int)$media['file_size'] : null;
    // The inline preview is a base64 thumbnail. Cap it: a huge one bloats every
    // row and the poll response that carries it.
    $pv = (string)($media['preview'] ?? '');
    $out['preview'] = ($pv !== '' && strlen($pv) < 40000) ? $pv : null;
  }
  return $out;
}

/* One-line summary for the chat list. */
function ql_wa_preview_text($m) {
  $t = $m['type'];
  if ($t === 'text') return mb_substr((string)$m['body'], 0, 200);
  $icon = ['image' => '📷 Photo', 'document' => '📄 Document', 'voice' => '🎤 Voice note',
           'audio' => '🎵 Audio', 'video' => '🎬 Video', 'sticker' => 'Sticker',
           'poll' => '📊 Poll', 'action' => 'Action', 'location' => '📍 Location'];
  $base = $icon[$t] ?? ucfirst($t);
  $cap = trim((string)$m['body']);
  if ($m['media_name']) $base .= ' · ' . $m['media_name'];
  return mb_substr($cap !== '' ? ($base . ' — ' . $cap) : $base, 0, 200);
}

/* ── Cron secret. The cron endpoint is reachable from the internet, so it is
   useless without this. Blank ⇒ the endpoint refuses to run at all rather
   than defaulting to open. */
function ql_cron_secret() { $c = ql_config(); return (string)($c['CRON_SECRET'] ?? ''); }

/* ── Whapi send — ONE implementation, used by both /api/wa (manual) and
   /api/cron (unattended). Two copies of a send path is how one of them
   quietly stops matching the other. Returns [ok, id|error]. */
function ql_wa_send($token, $to, $body) {
  $to = preg_replace('/\D/', '', (string)$to);
  if (strlen($to) < 10 || strlen($to) > 15) return ['ok' => false, 'error' => 'Bad recipient number'];
  if (trim((string)$body) === '')          return ['ok' => false, 'error' => 'Empty message'];
  if (strpos($body, '{{') !== false)       return ['ok' => false, 'error' => 'Unfilled placeholder — refusing to send'];
  $ch = curl_init('https://gate.whapi.cloud/messages/text');
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_TIMEOUT => 25,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token, 'Content-Type: application/json', 'Accept: application/json'],
    CURLOPT_POSTFIELDS => json_encode(['to' => $to, 'body' => $body]),
  ]);
  $raw = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch);
  curl_close($ch);
  if ($code === 0)  return ['ok' => false, 'retry' => true, 'error' => 'Provider unreachable' . ($err ? ": $err" : '')];
  if ($code === 429) return ['ok' => false, 'retry' => true, 'error' => 'Provider rate limit'];
  $j = json_decode((string)$raw, true); $j = is_array($j) ? $j : [];
  $id = $j['message']['id'] ?? ($j['id'] ?? null);
  if ($code < 200 || $code >= 300 || !$id) {
    $why = $j['error']['message'] ?? ($j['message'] ?? ('HTTP ' . $code));
    if (is_array($why)) $why = json_encode($why);
    // 4xx (other than 429) is our fault and will fail again — do not retry.
    return ['ok' => false, 'retry' => ($code >= 500), 'error' => (string)$why];
  }
  return ['ok' => true, 'id' => (string)$id];
}

/* ── WhatsApp channel (Whapi) from config (server-side only; '' when unset) ──
   Same rule as the AI key: the token NEVER goes to the browser. The client
   asks /api/wa to send; it never sees or holds this value. */
function ql_whapi() {
  $c = ql_config();
  return [
    'token'  => (string)($c['WHAPI_TOKEN'] ?? ''),
    'sender' => (string)($c['WHAPI_SENDER'] ?? ''),
  ];
}

/* ── AI key + model from config (server-side only; '' when unconfigured) ── */
function ql_llm() {
  $c = ql_config();
  return [
    'key'   => (string)($c['LLM_API_KEY'] ?? ''),
    'model' => (string)($c['LLM_MODEL'] ?? 'claude-sonnet-5'),
    'maxImg'=> (int)($c['LLM_MAX_IMAGES'] ?? 3),
  ];
}
