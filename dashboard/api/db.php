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
  ];
}
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
