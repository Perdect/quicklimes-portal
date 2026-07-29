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
  /* Drop any OPcache-cached copy of config.php before reading it. Without this,
     a shared host with opcache.validate_timestamps off keeps serving the OLD
     config after you edit it — so a freshly-added key (e.g. MAPBOX_TOKEN) never
     takes effect until PHP restarts. Invalidating here makes config edits live
     on the very next request, no restart needed. Config is tiny — the cost is nil. */
  if (function_exists('opcache_invalidate')) { @opcache_invalidate($f, true); }
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
  /* Security headers on every API response too, not only on the pages via
     .htaccess — so they hold even if a server config doesn't apply .htaccess to
     PHP output (audit H2). API replies are JSON, so these can't break rendering. */
  header('X-Content-Type-Options: nosniff');
  header('X-Frame-Options: DENY');
  header('Referrer-Policy: strict-origin-when-cross-origin');
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

/* ── Client IP, proxy-aware ──────────────────────────────────────────────
   Behind LiteSpeed/CDN, REMOTE_ADDR is the proxy, so the real client is in
   X-Forwarded-For (first hop). XFF is spoofable, so it is ONLY used to spread
   rate-limit buckets — never for auth — and we fall back to REMOTE_ADDR. */
function ql_client_ip() {
  $xff = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
  if ($xff !== '') {
    $first = trim(explode(',', $xff)[0]);
    if (filter_var($first, FILTER_VALIDATE_IP)) return $first;
  }
  return (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

/* ── Fixed-window rate limiter (audit H1/M4/M5) ──────────────────────────
   Counts hits per key within a time window; returns false once $max is
   exceeded so the caller can 429. One tiny counter row per (key, window),
   upserted atomically.

   FAILS OPEN. A limiter that fails closed would turn a transient DB hiccup
   into a lockout of the ENTIRE user base — a self-inflicted outage far worse
   than the abuse it guards against. On any error it returns true (allowed).

   The limit key must be the STABLE TARGET (a phone, a plant id), which an
   attacker can't rotate — not a spoofable header. $db is injectable for tests. */
function ql_rate_limit($key, $max, $windowSec, $db = null) {
  try {
    $db = $db ?: ql_db();
    $db->exec("CREATE TABLE IF NOT EXISTS rate_limits (
      rl_key       VARCHAR(190) NOT NULL PRIMARY KEY,
      window_start INT          NOT NULL,
      hits         INT          NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $now = time();
    $win = $now - ($now % $windowSec);
    /* Atomic: same window → increment; a newer window → reset to 1. */
    $st = $db->prepare('INSERT INTO rate_limits (rl_key, window_start, hits) VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE
        hits = IF(window_start < VALUES(window_start), 1, hits + 1),
        window_start = IF(window_start < VALUES(window_start), VALUES(window_start), window_start)');
    $st->execute([(string)$key, $win]);
    $rd = $db->prepare('SELECT hits FROM rate_limits WHERE rl_key = ?');
    $rd->execute([(string)$key]);
    $hits = (int)$rd->fetchColumn();
    return $hits <= $max;
  } catch (Throwable $e) {
    error_log('[rate_limit] ' . $e->getMessage());
    return true;   // fail OPEN — never lock everyone out on a DB error
  }
}

/* Guard a request: 429 with a friendly message once the limit is hit. */
function ql_rate_guard($key, $max, $windowSec, $msg = 'Too many attempts. Please wait a few minutes and try again.') {
  if (!ql_rate_limit($key, $max, $windowSec)) {
    header('Retry-After: ' . (int)$windowSec);
    ql_out(['error' => $msg], 429);
  }
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

/* THE signing key, or a hard stop. Tokens are the entire auth system: anyone
   who knows APP_SECRET can forge a token for ANY plant id and take over every
   account on the server. config.example.php ships a public placeholder, so an
   install that copied it and forgot to change the key would be trivially
   forgeable by anyone who read the repo.

   This refuses to run at all with a weak key — empty, under 32 chars, or the
   placeholder itself. It fails CLOSED (503): a misconfigured server that hands
   out no tokens is safe; one that hands out forgeable tokens is not. It guards
   BOTH signing and verifying, so the check cannot be skipped by any path. */
function ql_app_secret() {
  $s = (string)(ql_config()['APP_SECRET'] ?? '');
  $placeholder = 'change-me-to-a-long-random-string-of-at-least-32-characters';
  if ($s === '' || strlen($s) < 32 || $s === $placeholder) {
    ql_out(['error' => 'Backend not configured: set a strong APP_SECRET (32+ random chars) in api/config.php'], 503);
  }
  return $s;
}

function ql_sign_token($plantId, $ttl = 2592000, $userId = '', $role = 'owner') {   // 30 days
  $exp = time() + $ttl;
  $payload = ($userId === '' && $role === 'owner')
    ? $plantId . '|' . $exp                                      // legacy shape (unchanged for owners)
    : 'v2|' . $plantId . '|' . $userId . '|' . $role . '|' . $exp;
  $sig = hash_hmac('sha256', $payload, ql_app_secret());         // hex string
  return ql_b64url($payload) . '.' . ql_b64url($sig);
}

/* Verify signature + expiry, return the auth context, else null.
   ['plant'=>id, 'user'=>id|'', 'role'=>role, 'exp'=>int]. Plant scoping is
   left to the caller. */
function ql_parse_token($token) {
  $secret = ql_app_secret();                         // halts if the key is weak
  $parts = explode('.', (string)$token);
  if (count($parts) !== 2) return null;
  $payload = ql_b64url_dec($parts[0]);
  $sig     = ql_b64url_dec($parts[1]);
  $expect  = hash_hmac('sha256', $payload, $secret);
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

/* Does this plant row still exist? Cached per request (one indexed PK lookup).
   A QUERY error fails OPEN: a transient DB hiccup must not sign the whole user
   base out. A missing ROW fails CLOSED — that is the actual security answer. */
function ql_plant_exists($plantId) {
  static $seen = [];
  if ($plantId === '') return false;
  if (array_key_exists($plantId, $seen)) return $seen[$plantId];
  try {
    $q = ql_db()->prepare('SELECT 1 FROM plants WHERE id = ? LIMIT 1');
    $q->execute([$plantId]);
    $ok = (bool)$q->fetchColumn();
  } catch (Throwable $e) { $ok = true; }
  return $seen[$plantId] = $ok;
}

/* Full auth context for the CURRENT request's token (or null), optionally
   scoped to a required plant id.

   THE TOKEN MUST NAME A LIVE ACCOUNT. Tokens are stateless 30-day HMACs, so
   they outlive the account they name: after a company removal promotes a new
   main (or deletes the account outright) the old plants row is gone, yet its
   tokens still verify. Without this check every write endpoint would keep
   accepting them and INSERT rows under the dead plant id — edits made on a
   second device would vanish into a namespace nothing ever reads again, and a
   deleted account could be re-uploaded from a stale phone for up to 30 days.
   One lookup here closes it for data.php, recon, wa, chat, crm, users, jobs,
   extract, plant and company alike. Pinned by auth-live.test.php. */
function ql_token_ctx($plantId = '') {
  /* An EXPLICIT empty plant id is a request that forgot to say which firm it
     meant — and every caller then uses that '' as the scope key for its rows
     AND its file paths, so one omitted field silently opens a bucket shared by
     every tenant on the server. Reject it.

     ql_token_ctx() with NO argument still means "any valid token for this
     account" — company.php and plant.php need that, and they now call it
     without an argument so the two cases cannot be confused. */
  if (func_num_args() > 0 && $plantId === '') return null;
  $ctx = ql_parse_token(ql_token());
  if (!$ctx) return null;
  if ($plantId !== '' && $ctx['plant'] !== $plantId) return null;
  if (!ql_plant_exists($ctx['plant'])) return null;
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
    owner_name      VARCHAR(190) DEFAULT NULL,
    contact_phone   VARCHAR(20)  DEFAULT NULL,
    gst_number      VARCHAR(20)  DEFAULT NULL,
    city            VARCHAR(120) DEFAULT NULL,
    address         VARCHAR(255) DEFAULT NULL,
    parent_plant_id VARCHAR(64)  DEFAULT NULL,
    plan_limit      INT          NOT NULL DEFAULT 2,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    KEY idx_owner (owner_phone),
    KEY idx_parent (parent_plant_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  /* owner_name + contact_phone were added later (company profile: manager name
     and a per-company mobile that prints on invoices, kept SEPARATE from
     owner_phone so it can never affect the login). CREATE TABLE IF NOT EXISTS
     leaves an existing table untouched, so add the columns if they're missing.
     MySQL has no portable "ADD COLUMN IF NOT EXISTS", so try it and ignore the
     duplicate-column error. */
  foreach (['owner_name VARCHAR(190) DEFAULT NULL', 'contact_phone VARCHAR(20) DEFAULT NULL'] as $col) {
    try { $db->exec("ALTER TABLE plants ADD COLUMN $col"); } catch (Throwable $e) { /* already there */ }
  }
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
  /* ══ Lead Discovery ═════════════════════════════════════════════════
     Businesses found through a data source (Google Places), BEFORE they are
     anything to you. A candidate is not a lead: it is a row you have not yet
     decided about, so it lives here rather than polluting the pipeline.

     CACHING NOTE (Google Places terms): the place_id may be retained
     indefinitely, but the rest of the place data must not be cached long-term.
     These rows exist so you can review a search and promote from it; once a
     candidate is PROMOTED it becomes your own crm_companies record (your note
     about a business relationship, not a mirror of Google's database), and the
     rest can be pruned. dismissed/duplicate rows keep name+place_id so the same
     firm does not come back every single search — that is the dedupe memory. */
  $db->exec("CREATE TABLE IF NOT EXISTS discovered (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    plant_id    VARCHAR(64)  NOT NULL,
    company_id  VARCHAR(96)  NOT NULL DEFAULT '',
    source      VARCHAR(24)  NOT NULL DEFAULT 'google',
    place_id    VARCHAR(190) DEFAULT NULL,
    name        VARCHAR(190) NOT NULL,
    name_key    VARCHAR(190) NOT NULL DEFAULT '',
    industry    VARCHAR(32)  NOT NULL DEFAULT '',
    address     VARCHAR(255) DEFAULT NULL,
    city        VARCHAR(120) DEFAULT NULL,
    phone       VARCHAR(32)  DEFAULT NULL,
    website     VARCHAR(190) DEFAULT NULL,
    rating      DECIMAL(2,1) DEFAULT NULL,
    lat         DECIMAL(10,7) DEFAULT NULL,
    lng         DECIMAL(10,7) DEFAULT NULL,
    fit_score   INT          DEFAULT NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'new',
    dupe_of     VARCHAR(190) DEFAULT NULL,
    query       VARCHAR(190) DEFAULT NULL,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    KEY idx_co (plant_id, company_id, status),
    UNIQUE KEY uq_place (plant_id, company_id, place_id),
    KEY idx_namekey (plant_id, company_id, name_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  /* CREATE TABLE IF NOT EXISTS leaves an EXISTING table untouched, so a table
     created before these columns existed never gains them — and the list query,
     which ORDERs BY fit_score, then throws while the dedupe query (which does
     not touch it) keeps working. Symptom: "30 seen before" but zero rows in
     every tab. Add the columns if they are missing; ignore duplicate errors. */
  foreach (['fit_score INT DEFAULT NULL', 'fit_tier VARCHAR(12) DEFAULT NULL'] as $col) {
    try { $db->exec("ALTER TABLE discovered ADD COLUMN $col"); } catch (Throwable $e) { /* already there */ }
  }

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
  /* Provider is EXPLICIT config — never sniffed from the key's prefix. Google moved
     AI Studio keys from AIza to AQ. mid-life; any code that guessed the provider from
     the shape of the key would have started rejecting valid keys that morning.
     Unset means the historical default, Anthropic, so existing installs do not move. */
  $provider = strtolower(trim((string)($c['LLM_PROVIDER'] ?? 'anthropic')));
  /* The default model FOLLOWS the provider. A flat 'claude-sonnet-5' default would
     mean setting LLM_PROVIDER=gemini without LLM_MODEL sends an Anthropic model name
     to Google — a 404 that reads like a bad key and sends you hunting the wrong thing. */
  $fallbackModel = ['anthropic' => 'claude-sonnet-5', 'gemini' => 'gemini-2.5-flash'];
  return [
    'provider' => $provider,
    'key'   => (string)($c['LLM_API_KEY'] ?? ''),
    'model' => (string)($c['LLM_MODEL'] ?? ($fallbackModel[$provider] ?? '')),
    'maxImg'=> (int)($c['LLM_MAX_IMAGES'] ?? 3),
  ];
}

/* ═══════════════════════════════════════════════════════════════════
   Self-service company management (Add / Remove a company).

   A firm's OWN GSTIN is what tells its SALES from its PURCHASES — the bill
   parser uses it to decide whether OUR firm is the issuer (a sale) or the
   recipient (a purchase). A company created WITHOUT one files every uploaded
   bill as a Purchase (that is exactly what happened to Deshwali Minerals).
   So the self-service "Add company" REQUIRES a valid GSTIN — the missing
   field is the whole bug this closes.

   The logic lives here as pure functions taking a PDO so company.test.php can
   drive the full add/remove flow against an in-memory SQLite, no HTTP or live
   DB needed (same philosophy as ql_wa_parse_message). company.php is a thin
   wrapper that only does auth + ql_out.
   ═══════════════════════════════════════════════════════════════════ */

/* GSTIN shape + state-code check. MUST agree with signup.php's inline rule
   and the JS side (data.js validGstinFmt / bill-ocr.js validGstin) — a rule
   accepted here but rejected there would store an identity the parser ignores,
   silently reviving the bug. company.test.php pins this against signup.php. */
function ql_gstin_valid($g) {
  $g = strtoupper(preg_replace('/\s+/', '', (string)$g));
  if (preg_match('/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/', $g) !== 1) return false;
  $st = (int)substr($g, 0, 2);
  return $st >= 1 && $st <= 38;                       // valid GST state codes
}

/* A usable mobile number: at least 7 digits (kept lenient so a +country-code or
   landline isn't wrongly rejected). Must agree with data.js validPhone. */
function ql_phone_valid($p) {
  return strlen(preg_replace('/\D/', '', (string)$p)) >= 7;
}

/* Resolve the account's PRIMARY plant (the one that carries the password and
   parents the family). The login token is signed with the primary id, but
   resolve defensively so a child id can never spawn a grandchild — the family
   must stay one level deep (login lists id = primary OR parent_plant_id =
   primary). Returns [primaryId, ownerPhone, planLimit] or null. */
function ql_account_primary($db, $plantId) {
  $q = $db->prepare('SELECT id, owner_phone, parent_plant_id, plan_limit FROM plants WHERE id = ? LIMIT 1');
  $q->execute([$plantId]);
  $row = $q->fetch(PDO::FETCH_ASSOC);
  if (!$row) return null;
  $par = $row['parent_plant_id'];
  $primaryId = ($par !== null && $par !== '') ? $par : $row['id'];
  if ($primaryId === $row['id']) {
    return [$primaryId, (string)$row['owner_phone'], ((int)$row['plan_limit'] ?: 2)];
  }
  $p = $db->prepare('SELECT owner_phone, plan_limit FROM plants WHERE id = ? LIMIT 1');
  $p->execute([$primaryId]);
  $pr = $p->fetch(PDO::FETCH_ASSOC);
  if (!$pr) return null;
  return [$primaryId, (string)$pr['owner_phone'], ((int)$pr['plan_limit'] ?: 2)];
}

/* RFC-4122 v4 uuid (same shape as the existing plant ids). */
function ql_uuid4() {
  $d = random_bytes(16);
  $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
  $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);
  $h = bin2hex($d);
  return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4) . '-' .
         substr($h, 16, 4) . '-' . substr($h, 20, 12);
}

/* Add a company (child plant) under $ctx's account.
   Returns ['code'=>int, 'body'=>array]; pure except for $db. */
function ql_company_add($db, $ctx, $in) {
  if (!$ctx)                           return ['code' => 401, 'body' => ['error' => 'Unauthorized']];
  if (!ql_role_can($ctx['role'], '*')) return ['code' => 403, 'body' => ['error' => 'Forbidden']];   // owner-level only

  $name  = trim((string)($in['p_plant_name'] ?? ''));
  $gst   = strtoupper(preg_replace('/\s+/', '', (string)($in['p_gst_number'] ?? '')));
  $oname = trim((string)($in['p_owner_name'] ?? ''));       // manager / owner — optional
  $phone = trim((string)($in['p_contact_phone'] ?? ''));    // company mobile — required
  $city  = trim((string)($in['p_city'] ?? ''));
  $addr  = trim((string)($in['p_address'] ?? ''));

  if (strlen($name) < 2)      return ['code' => 200, 'body' => ['error' => 'Company name is required']];
  if ($gst === '')            return ['code' => 200, 'body' => ['error' => 'GSTIN is required — it is what tells this firm’s sales from its purchases']];
  if (!ql_gstin_valid($gst))  return ['code' => 200, 'body' => ['error' => 'That GSTIN doesn’t look right — it should be 15 characters, like 08BNAPM0488E1Z3']];
  if ($phone === '')          return ['code' => 200, 'body' => ['error' => 'Mobile number is required']];
  if (!ql_phone_valid($phone)) return ['code' => 200, 'body' => ['error' => 'That mobile number doesn’t look right']];

  $acct = ql_account_primary($db, $ctx['plant']);
  if (!$acct) return ['code' => 404, 'body' => ['error' => 'Account not found']];
  $primaryId = $acct[0]; $ownerPhone = $acct[1]; $limit = $acct[2];

  $fam = $db->prepare('SELECT id, gst_number FROM plants WHERE id = ? OR parent_plant_id = ?');
  $fam->execute([$primaryId, $primaryId]);
  $members = $fam->fetchAll(PDO::FETCH_ASSOC);
  if (count($members) >= $limit) {
    return ['code' => 200, 'body' => ['error' => 'Your plan allows ' . $limit . ' companies. Contact support to add more.']];
  }
  foreach ($members as $m) {                          // one firm per GSTIN (party-identity rule)
    if (strtoupper((string)$m['gst_number']) === $gst) {
      return ['code' => 200, 'body' => ['error' => 'A company with GSTIN ' . $gst . ' already exists in your account.']];
    }
  }

  $id  = ql_uuid4();
  $ins = $db->prepare(
    'INSERT INTO plants (id, owner_phone, plant_name, owner_name, contact_phone, gst_number, city, address, parent_plant_id, plan_limit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  $ins->execute([$id, $ownerPhone, $name, ($oname ?: null), $phone, $gst, ($city ?: null), ($addr ?: null), $primaryId, $limit]);
  return ['code' => 200, 'body' => ['success' => true, 'plant' => [
    'id' => $id, 'owner_phone' => $ownerPhone, 'plant_name' => $name, 'owner_name' => $oname,
    'contact_phone' => $phone, 'gst_number' => $gst, 'city' => $city, 'address' => $addr, 'parent_plant_id' => $primaryId,
  ]]];
}

/* Update a company's profile (name / GSTIN / mobile / manager / city / address).
   Mirrors the old plant.php inline UPDATE, but as a testable function with the
   new required-field rules: GSTIN and mobile are mandatory (a profile with a
   blank GSTIN is the exact bug that mis-files every bill). The target must be
   the account's primary or one of its children. Returns ['code','body']. */
function ql_plant_update($db, $ctx, $in) {
  if (!$ctx)                           return ['code' => 401, 'body' => ['error' => 'Unauthorized']];
  if (!ql_role_can($ctx['role'], '*')) return ['code' => 403, 'body' => ['error' => 'Forbidden']];

  $target = (string)($in['p_plant_id'] ?? '');
  if ($target === '') return ['code' => 400, 'body' => ['error' => 'Missing plant id']];

  $name  = trim((string)($in['p_plant_name'] ?? ''));
  $gst   = strtoupper(preg_replace('/\s+/', '', (string)($in['p_gst_number'] ?? '')));
  $oname = trim((string)($in['p_owner_name'] ?? ''));
  $phone = trim((string)($in['p_contact_phone'] ?? ''));
  $city  = trim((string)($in['p_city'] ?? ''));
  $addr  = trim((string)($in['p_address'] ?? ''));

  if (strlen($name) < 2)       return ['code' => 200, 'body' => ['error' => 'Company name is required']];
  if ($gst === '')             return ['code' => 200, 'body' => ['error' => 'GSTIN is required — it is what tells this firm’s sales from its purchases']];
  if (!ql_gstin_valid($gst))   return ['code' => 200, 'body' => ['error' => 'That GSTIN doesn’t look right — it should be 15 characters, like 08BNAPM0488E1Z3']];
  if ($phone === '')           return ['code' => 200, 'body' => ['error' => 'Mobile number is required']];
  if (!ql_phone_valid($phone)) return ['code' => 200, 'body' => ['error' => 'That mobile number doesn’t look right']];

  // The plant must belong to the token's account (itself or a child).
  $tok = $ctx['plant'];
  $chk = $db->prepare('SELECT id FROM plants WHERE id = ? AND (id = ? OR parent_plant_id = ?) LIMIT 1');
  $chk->execute([$target, $tok, $tok]);
  if (!$chk->fetch(PDO::FETCH_ASSOC)) return ['code' => 403, 'body' => ['error' => 'That company is not part of your account.']];

  // One GSTIN per account (never let two of the user's firms share one).
  $dup = $db->prepare('SELECT id FROM plants WHERE id <> ? AND (id = ? OR parent_plant_id = ?) AND UPPER(gst_number) = ? LIMIT 1');
  $dup->execute([$target, $tok, $tok, $gst]);
  if ($dup->fetch(PDO::FETCH_ASSOC)) return ['code' => 200, 'body' => ['error' => 'A company with GSTIN ' . $gst . ' already exists in your account.']];

  $st = $db->prepare('UPDATE plants SET plant_name = ?, owner_name = ?, contact_phone = ?, gst_number = ?, city = ?, address = ? WHERE id = ?');
  $st->execute([$name, ($oname ?: null), $phone, $gst, ($city ?: null), ($addr ?: null), $target]);
  return ['code' => 200, 'body' => ['success' => true]];
}

/* Remove ANY company and its data — the user is never told "you can't".
   (Owner's product rule: "if user want to delete they can delete, we can't
   restrict our user.") Three cases, all owner-role only, all atomic:

   1. A SECONDARY company: delete its row, its blob, its company-scoped rows.
   2. The MAIN company while another exists: the other company is PROMOTED to
      main first — it inherits the login (password hash), the plan, the family
      parent pointer and every plant-keyed row (app_data + side tables) — then
      the target is deleted. One transaction: there is no half-state where the
      login has moved but the old main still exists. The caller must sign in
      again (tokens are bound to the old main id, which no longer exists).
   3. The ONLY company: this IS account deletion — everything goes, including
      the login row. Deliberate: the data is the user's to destroy.

   Returns ['code','body']; body carries 'promoted' => <newMainId> for case 2
   and 'account_deleted' => true for case 3 so the client knows to sign out. */
function ql_company_remove($db, $ctx, $in) {
  if (!$ctx)                           return ['code' => 401, 'body' => ['error' => 'Unauthorized']];
  if (!ql_role_can($ctx['role'], '*')) return ['code' => 403, 'body' => ['error' => 'Forbidden']];

  $target = (string)($in['p_plant_id'] ?? '');
  if ($target === '') return ['code' => 200, 'body' => ['error' => 'Which company? (missing id)']];

  $acct = ql_account_primary($db, $ctx['plant']);
  if (!$acct) return ['code' => 404, 'body' => ['error' => 'Account not found']];
  $primaryId = $acct[0];

  // Tables scoped per company (company_id) and per account (plant_id).
  $coTables    = ['bank_txns', 'bank_accounts', 'wa_chats', 'wa_messages', 'party_master', 'party_aliases', 'doc_corrections', 'imported_docs'];
  $plantTables = ['bank_txns', 'bank_accounts', 'wa_chats', 'wa_messages', 'party_master', 'party_aliases', 'doc_corrections', 'imported_docs',
                  'crm_companies', 'crm_contacts', 'crm_leads', 'crm_activities', 'jobs', 'users'];

  /* ── Case 1: a secondary company ── */
  if ($target !== $primaryId) {
    $chk = $db->prepare('SELECT id FROM plants WHERE id = ? AND parent_plant_id = ? LIMIT 1');
    $chk->execute([$target, $primaryId]);
    if (!$chk->fetch(PDO::FETCH_ASSOC)) {
      return ['code' => 403, 'body' => ['error' => 'That company is not part of your account.']];
    }
    $db->prepare('DELETE FROM plants WHERE id = ? AND parent_plant_id = ?')->execute([$target, $primaryId]);
    $db->prepare('DELETE FROM app_data WHERE plant_id = ? AND data_id = ?')->execute([$primaryId, $target]);
    // Best-effort: a missing table/column on an older install must not fail the
    // removal, and company_id = target (a uuid) can never match another account.
    foreach ($coTables as $t) {
      try { $db->prepare("DELETE FROM $t WHERE company_id = ?")->execute([$target]); }
      catch (Throwable $e) { /* table absent — ignore */ }
    }
    return ['code' => 200, 'body' => ['success' => true, 'id' => $target]];
  }

  /* ── The target IS the main company ── */
  $sib = $db->prepare('SELECT id, plant_name FROM plants WHERE parent_plant_id = ? ORDER BY plant_name ASC');
  $sib->execute([$primaryId]);
  $siblings = $sib->fetchAll(PDO::FETCH_ASSOC);

  $cur = $db->prepare('SELECT password_hash, plan_limit FROM plants WHERE id = ? LIMIT 1');
  $cur->execute([$primaryId]);
  $prow = $cur->fetch(PDO::FETCH_ASSOC);
  if (!$prow) return ['code' => 404, 'body' => ['error' => 'Account not found']];

  /* ── Case 3: the only company → account deletion ── */
  if (!count($siblings)) {
    try {
      $db->beginTransaction();
      $db->prepare('DELETE FROM app_data WHERE plant_id = ?')->execute([$primaryId]);
      foreach ($plantTables as $t) {
        try { $db->prepare("DELETE FROM $t WHERE plant_id = ?")->execute([$primaryId]); }
        catch (Throwable $e) { /* table absent — ignore */ }
      }
      $db->prepare('DELETE FROM plants WHERE id = ?')->execute([$primaryId]);
      $db->commit();
    } catch (Throwable $e) {
      try { $db->rollBack(); } catch (Throwable $e2) {}
      return ['code' => 500, 'body' => ['error' => 'Could not delete the account — nothing was changed. Please try again.']];
    }
    return ['code' => 200, 'body' => ['success' => true, 'id' => $target, 'account_deleted' => true]];
  }

  /* ── Case 2: promote a sibling, then delete the old main ── */
  $promote = (string)($in['p_promote_id'] ?? '');
  if ($promote !== '') {
    $ok = false; foreach ($siblings as $s2) { if ($s2['id'] === $promote) { $ok = true; break; } }
    if (!$ok) return ['code' => 403, 'body' => ['error' => 'That company is not part of your account.']];
  } else {
    $promote = $siblings[0]['id'];               // deterministic: first by name
  }

  try {
    $db->beginTransaction();
    // The new main inherits the login and the plan, and becomes the family root.
    $db->prepare('UPDATE plants SET password_hash = ?, plan_limit = ?, parent_plant_id = NULL WHERE id = ?')
       ->execute([$prow['password_hash'], (int)$prow['plan_limit'] ?: 2, $promote]);
    $db->prepare('UPDATE plants SET parent_plant_id = ? WHERE parent_plant_id = ? AND id <> ?')
       ->execute([$promote, $primaryId, $promote]);
    // Every account-keyed row follows the new main (blobs first — they hold the books).
    $db->prepare('UPDATE app_data SET plant_id = ? WHERE plant_id = ?')->execute([$promote, $primaryId]);
    foreach ($plantTables as $t) {
      try { $db->prepare("UPDATE $t SET plant_id = ? WHERE plant_id = ?")->execute([$promote, $primaryId]); }
      catch (Throwable $e) { /* table absent — ignore */ }
    }
    // Now the old main is an orphan row: delete it and its own company data.
    $db->prepare('DELETE FROM plants WHERE id = ?')->execute([$primaryId]);
    $db->prepare('DELETE FROM app_data WHERE plant_id = ? AND data_id = ?')->execute([$promote, $target]);
    foreach ($coTables as $t) {
      try { $db->prepare("DELETE FROM $t WHERE company_id = ?")->execute([$target]); }
      catch (Throwable $e) { /* table absent — ignore */ }
    }
    $db->commit();
  } catch (Throwable $e) {
    try { $db->rollBack(); } catch (Throwable $e2) {}
    return ['code' => 500, 'body' => ['error' => 'Could not remove the company — nothing was changed. Please try again.']];
  }
  return ['code' => 200, 'body' => ['success' => true, 'id' => $target, 'promoted' => $promote]];
}

/* ═══════════════════════════════════════════════════════════════════════
   Lead Discovery — find businesses by city + trade, dedupe, score, promote.

   ONE DOOR to the provider (same discipline as ql_llm): the key never leaves
   the server, the provider is explicit config, and a failure is REPORTED, not
   swallowed — a silent zero-result search is indistinguishable from "there are
   no such businesses", which is how you conclude a market is empty when really
   your key expired.
   ═══════════════════════════════════════════════════════════════════════ */

/* The key, or '' when discovery simply is not set up. Deliberately does NOT go
   through ql_config() blindly: ql_config() ABORTS the whole request when
   config.php is absent, so an optional feature asking "do I have a key?" would
   kill the process instead of answering "no". An optional feature must never be
   able to take the app down. */
function ql_places_key() {
  if (!is_file(__DIR__ . '/config.php')) return '';
  $c = ql_config();
  return trim((string)($c['GOOGLE_PLACES_KEY'] ?? ''));
}

/* Is Google configured? Callers that only need to KNOW whether a key exists ask
   this and get a bool. They must never call ql_places_key() for the purpose —
   an endpoint that holds the secret in a variable is one typo away from
   returning it in a response body. */
function ql_has_places_key() { return ql_places_key() !== ''; }

/* ── Mapbox (a FREE-tier alternative source) ─────────────────────────────
   Mapbox's Search Box API has a generous free tier and far more reliable infra
   than the free Overpass service (which times out / has thin Indian data). The
   token lives ONLY in config.php (MAPBOX_TOKEN), never in a response. */
function ql_mapbox_key() {
  if (!is_file(__DIR__ . '/config.php')) return '';
  $c = ql_config();   // central loader: statically cached + OPcache-invalidated so a fresh token is read live
  return trim((string)($c['MAPBOX_TOKEN'] ?? ''));
}
function ql_has_mapbox_key() { return ql_mapbox_key() !== ''; }

/* Parse a Mapbox Search Box FeatureCollection into the same place shape the
   rest of discovery consumes (identical keys to ql_places_parse). */
function ql_mapbox_parse($json, $city) {
  $out = [];
  $feats = (is_array($json) && isset($json['features']) && is_array($json['features'])) ? $json['features'] : [];
  foreach ($feats as $f) {
    $p = is_array($f['properties'] ?? null) ? $f['properties'] : [];
    $name = trim((string)($p['name'] ?? ($p['name_preferred'] ?? '')));
    if ($name === '') continue;
    $lng = null; $lat = null;
    $coords = $f['geometry']['coordinates'] ?? null;
    if (is_array($coords) && count($coords) >= 2) { $lng = (float)$coords[0]; $lat = (float)$coords[1]; }
    elseif (isset($p['coordinates']['longitude'])) { $lng = (float)$p['coordinates']['longitude']; $lat = (float)$p['coordinates']['latitude']; }
    $meta = is_array($p['metadata'] ?? null) ? $p['metadata'] : [];
    $out[] = [
      'place_id' => (string)($p['mapbox_id'] ?? ''),
      'name'     => $name,
      'name_key' => ql_norm_name($name),
      'address'  => (string)($p['full_address'] ?? ($p['place_formatted'] ?? '')),
      'city'     => (string)$city,
      'phone'    => (string)($meta['phone'] ?? ''),
      'website'  => (string)($meta['website'] ?? ''),
      'rating'   => null,
      'lat'      => $lat,
      'lng'      => $lng,
    ];
  }
  return $out;
}

/* Search Mapbox for businesses: geocode the city to a proximity centre, then a
   Search Box forward query for the trade. Same {ok,places,error} contract as
   ql_places_search, so discover.php treats every source identically. */
function ql_mapbox_search($what, $city, $opts = [], $http = null) {
  // token can be passed in (per-plant, stored in the DB via the app) or fall
  // back to the global config.php token.
  $token = trim((string)($opts['token'] ?? '')); if ($token === '') $token = ql_mapbox_key();
  if ($token === '') return ['ok' => false, 'places' => [], 'error' => 'not_configured'];
  $what = trim((string)$what); $city = trim((string)$city);
  if ($what === '') return ['ok' => false, 'places' => [], 'error' => 'Say what to look for'];
  /* Mapbox Search Box /forward caps limit at 10 — sending 25 returns a hard
     HTTP 400 ("Limit must be in range [1,10]"), i.e. every search fails. */
  $max = max(1, min(10, (int)($opts['max'] ?? 10)));
  $get = $http ?: function ($url) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 6]);
    $r = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch);
    return ['code' => $code, 'body' => $r, 'err' => $err];
  };
  // 1) geocode the city → proximity centre (better POI ranking)
  $prox = '';
  if ($city !== '') {
    $g = $get('https://api.mapbox.com/search/geocode/v6/forward?country=in&limit=1&q=' . rawurlencode($city) . '&access_token=' . rawurlencode($token));
    $gj = json_decode((string)($g['body'] ?? ''), true);
    $c0 = $gj['features'][0]['geometry']['coordinates'] ?? null;
    if (is_array($c0) && count($c0) === 2) $prox = $c0[0] . ',' . $c0[1];
  }
  // 2) Search Box forward for the businesses
  $url = 'https://api.mapbox.com/search/searchbox/v1/forward?country=in&limit=' . $max
       . '&q=' . rawurlencode($what) . ($prox !== '' ? '&proximity=' . rawurlencode($prox) : '')
       . '&access_token=' . rawurlencode($token);
  $r = $get($url);
  if (!empty($r['err'])) return ['ok' => false, 'places' => [], 'error' => 'Network error contacting Mapbox'];
  $j = json_decode((string)$r['body'], true);
  if ((int)$r['code'] !== 200) {
    /* Mapbox nests the reason: {"message":{"status_code":400,"error":"Limit must
       be in range [1,10]"}}. Casting that to a string prints the literal word
       "Array" — which is what the user saw, and it says nothing. Dig out the
       human sentence, whatever shape it arrives in. */
    $m = $j['message'] ?? ($j['error'] ?? null);
    if (is_array($m)) $m = $m['error'] ?? ($m['message'] ?? json_encode($m));
    $msg = trim((string)($m ?? '')) !== '' ? (string)$m : ('HTTP ' . $r['code']);
    return ['ok' => false, 'places' => [], 'error' => 'Mapbox: ' . $msg];
  }
  return ['ok' => true, 'places' => ql_mapbox_parse($j, $city), 'error' => ''];
}

/* Normalised company name — the dedupe spine. MUST match CRMCore.normName and
   LeadImport.normName in the browser, or the server and the UI will disagree
   about what "the same company" is. */
function ql_norm_name($s) {
  $s = strtoupper((string)$s);
  $s = preg_replace('/\b(PVT|PRIVATE|LTD|LIMITED|LLP|INC|CO|COMPANY|THE|M\/S|AND|&)\b/', ' ', $s);
  $s = preg_replace('/[^A-Z0-9]+/', ' ', $s);
  return trim($s);
}

/* Places API (New) searchText response → our candidate rows. Pure: takes the
   decoded JSON, returns rows. A place with no name is dropped (never a lead). */
function ql_places_parse($json, $city) {
  $out = [];
  $places = (is_array($json) && isset($json['places']) && is_array($json['places'])) ? $json['places'] : [];
  foreach ($places as $p) {
    $name = trim((string)($p['displayName']['text'] ?? ''));
    if ($name === '') continue;
    $out[] = [
      'place_id' => (string)($p['id'] ?? ''),
      'name'     => $name,
      'name_key' => ql_norm_name($name),
      'address'  => (string)($p['formattedAddress'] ?? ''),
      'city'     => (string)$city,
      'phone'    => (string)($p['nationalPhoneNumber'] ?? ''),
      'website'  => (string)($p['websiteUri'] ?? ''),
      'rating'   => isset($p['rating']) ? (float)$p['rating'] : null,
      'lat'      => isset($p['location']['latitude']) ? (float)$p['location']['latitude'] : null,
      'lng'      => isset($p['location']['longitude']) ? (float)$p['location']['longitude'] : null,
    ];
  }
  return $out;
}

/* Decide each candidate's status against what you already know.
   $crmKeys / $partyKeys are sets of normalised names (CRM prospects, and REAL
   customers from the ledger — a firm you already supply is the worst possible
   "new lead" to hand a salesman). $seen is place_ids/name_keys already
   discovered before, so a repeated search does not re-offer dismissed rows. */
function ql_discover_classify($cands, $crmKeys, $partyKeys, $seenPlaceIds, $seenNameKeys) {
  $out = [];
  foreach ($cands as $c) {
    $k = $c['name_key'];
    $st = 'new'; $of = null;
    if ($k !== '' && isset($partyKeys[$k]))      { $st = 'duplicate'; $of = 'customer'; }
    elseif ($k !== '' && isset($crmKeys[$k]))    { $st = 'duplicate'; $of = 'crm'; }
    elseif (($c['place_id'] !== '' && isset($seenPlaceIds[$c['place_id']])) || ($k !== '' && isset($seenNameKeys[$k]))) {
      $st = 'seen';                              // already discovered in an earlier search
    }
    $c['status'] = $st; $c['dupe_of'] = $of;
    $out[] = $c;
  }
  return $out;
}

/* The provider call, with the key PASSED IN. Split from ql_places_search so
   every branch — bad key, quota, network death, malformed body — is testable
   without a config.php and without touching the network. Returns
   ['ok'=>bool,'places'=>array,'error'=>string]. */
function ql_places_request($key, $what, $city, $opts = [], $http = null) {
  $key = trim((string)$key);
  if ($key === '') return ['ok' => false, 'places' => [], 'error' => 'not_configured'];
  $what = trim((string)$what); $city = trim((string)$city);
  if ($what === '') return ['ok' => false, 'places' => [], 'error' => 'Say what to look for'];
  /* INDIA-ONLY. Without a region bias Google happily returns "steel plants" in
     China or Turkey — wasted requests, wasted screen, useless to an Indian lime
     seller. regionCode biases the search and the appended country term anchors
     the text query. Pass opts['region'] to override when Global Search ships. */
  $region = strtoupper(trim((string)($opts['region'] ?? 'IN')));
  $q = $what . ($city !== '' ? ' in ' . $city : '');
  if ($region === 'IN' && !preg_match('/\bindia\b/i', $q)) $q .= ' India';

  $body = ['textQuery' => $q, 'maxResultCount' => (int)($opts['max'] ?? 20)];
  if ($region !== '') $body['regionCode'] = $region;
  $fields = 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.location';

  if ($http === null) {
    $http = function ($url, $payload, $headers) {
      $ch = curl_init($url);
      curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload, CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 20,
      ]);
      $res = curl_exec($ch);
      $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
      $err = curl_error($ch);
      curl_close($ch);
      return ['code' => $code, 'body' => $res, 'err' => $err];
    };
  }
  $r = $http('https://places.googleapis.com/v1/places:searchText', json_encode($body),
    ['Content-Type: application/json', 'X-Goog-Api-Key: ' . $key, 'X-Goog-FieldMask: ' . $fields]);

  if (!empty($r['err'])) return ['ok' => false, 'places' => [], 'error' => 'Network error contacting Google'];
  $j = json_decode((string)$r['body'], true);
  if ((int)$r['code'] !== 200) {
    /* REPORT the provider's own message. "no results" and "your key is dead"
       must never look the same — otherwise a dead key reads as an empty market
       and you conclude there are no buyers in a city full of them. */
    $msg = (string)($j['error']['message'] ?? ('HTTP ' . $r['code']));
    return ['ok' => false, 'places' => [], 'error' => $msg];
  }
  return ['ok' => true, 'places' => ql_places_parse($j, $city), 'error' => ''];
}

/* ── OpenStreetMap (Overpass API) — the FREE source ──────────────────────
   No key, no billing account, no card. Open data, so it costs nothing forever;
   the trade-off is thinner coverage than Google — especially phone numbers.
   It is good at exactly what this business needs though: factories, works and
   industrial units are among the best-mapped things in OSM.

   LICENCE: OSM data is ODbL. Anything that DISPLAYS it must credit
   "© OpenStreetMap contributors" — discover.html does, and discover-wired
   asserts it, because dropping the credit is a licence breach, not a nitpick.

   FAIR USE: the public Overpass endpoint is donated infrastructure. We cap the
   result count, set a timeout and identify ourselves; hammering it would get
   every QuickLimes user blocked. */
function ql_osm_parse($json, $city) {
  $out = [];
  $els = (is_array($json) && isset($json['elements']) && is_array($json['elements'])) ? $json['elements'] : [];
  foreach ($els as $e) {
    $t = (isset($e['tags']) && is_array($e['tags'])) ? $e['tags'] : [];
    $name = trim((string)($t['name'] ?? ''));
    if ($name === '') continue;                       // unnamed geometry is not a business

    // A readable address out of the addr:* tags, else fall back to the city.
    $parts = [];
    foreach (['addr:housenumber', 'addr:street', 'addr:suburb', 'addr:city', 'addr:postcode'] as $k) {
      $v = trim((string)($t[$k] ?? '')); if ($v !== '') $parts[] = $v;
    }
    $addr = $parts ? implode(', ', $parts) : '';

    // Ways/relations carry no lat/lon of their own — "out center" supplies one.
    $lat = isset($e['lat']) ? (float)$e['lat'] : (isset($e['center']['lat']) ? (float)$e['center']['lat'] : null);
    $lng = isset($e['lon']) ? (float)$e['lon'] : (isset($e['center']['lon']) ? (float)$e['center']['lon'] : null);

    $out[] = [
      'place_id' => 'osm:' . (string)($e['type'] ?? 'n') . '/' . (string)($e['id'] ?? ''),
      'name'     => $name,
      'name_key' => ql_norm_name($name),
      'address'  => $addr,
      'city'     => (string)$city,
      'phone'    => trim((string)($t['phone'] ?? ($t['contact:phone'] ?? ''))),
      'website'  => trim((string)($t['website'] ?? ($t['contact:website'] ?? ''))),
      'rating'   => null,                             // OSM has no ratings — never invent one
      'lat'      => $lat,
      'lng'      => $lng,
    ];
  }
  return $out;
}

/* Search OSM. Same return shape as ql_places_request, so the endpoint and the
   page treat both sources identically. $http is injectable for tests. */
/* Geocode a place name to a centre point via Nominatim (OSM's free geocoder),
   used only for radius search. Returns ['lat'=>.., 'lon'=>..] or null. Kept
   small and fast (6s cap): in radius mode it runs BEFORE the Overpass call, so
   geocode + one Overpass query must still fit under PHP's 30s. $http is injected
   for tests, same contract as ql_osm_search. */
function ql_osm_geocode($place, $http = null) {
  $place = trim((string)$place);
  if ($place === '') return null;
  if ($http === null) {
    $http = function ($url) {
      $ch = curl_init($url);
      curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 6,
        CURLOPT_USERAGENT => 'QuickLimes/1.0 (ERP lead discovery; app.quicklimes.com)',
      ]);
      $res = curl_exec($ch);
      $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
      $err = curl_error($ch);
      curl_close($ch);
      return ['code' => $code, 'body' => $res, 'err' => $err];
    };
  }
  $url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' . rawurlencode($place);
  $r = $http($url);
  if (!empty($r['err']) || (int)$r['code'] !== 200) return null;
  $j = json_decode((string)$r['body'], true);
  if (!is_array($j) || !isset($j[0]['lat'], $j[0]['lon'])) return null;
  return ['lat' => (float)$j[0]['lat'], 'lon' => (float)$j[0]['lon']];
}

function ql_osm_search($what, $city, $opts = [], $http = null) {
  $what = trim((string)$what); $city = trim((string)$city);
  if ($what === '') return ['ok' => false, 'places' => [], 'error' => 'Say what to look for'];
  if ($city === '') return ['ok' => false, 'places' => [], 'error' => 'OpenStreetMap needs a city to search inside'];
  $max = max(1, min(60, (int)($opts['max'] ?? 40)));
  $radiusKm = (int)($opts['radiusKm'] ?? 0);
  /* geocoder is injected separately in tests; falls back to the default above. */
  $geo = $opts['geocode'] ?? null;

  /* Overpass QL. Quotes and backslashes are escaped because the query is a
     STRING the server parses: an unescaped quote in "what" would break out of
     the regex and could rewrite the whole query. */
  $esc = function ($v) { return str_replace(['\\', '"'], ['\\\\', '\\"'], (string)$v); };

  /* RADIUS MODE. If the caller asked for "within N km of <place>", geocode the
     place to a centre and search a circle around it instead of a whole admin
     area. Geocoding is a SEPARATE free service (Nominatim) and can fail; if it
     does, we fall back to the area search rather than error out, and tell the
     caller (radius_fell_back) so the UI can say the circle was ignored. The time
     budget: geocode (6s) + ONE Overpass try (12s) = 18s, so radius mode does NOT
     also try the mirror — that would risk PHP's 30s limit. */
  $radiusFellBack = false;
  $centre = null;
  if ($radiusKm > 0) {
    $centre = $geo ? $geo($city) : ql_osm_geocode($city);
    if (!$centre) $radiusFellBack = true;   // couldn't pin a centre → area search
  }

  /* We may try TWO endpoints in one request, so the budget is per-endpoint and
     both must fit under PHP's 30s: query [timeout:10] + a 12s curl cap → at most
     ~24s for two attempts, leaving PHP room to always return real JSON. A larger
     value here is not "more results", it is "the second attempt pushes us past
     PHP's limit and the browser gets an HTML error page again". */
  if ($centre) {
    $metres = min(500000, max(1000, $radiusKm * 1000));
    $q = "[out:json][timeout:10];\n"
       . '( nwr["name"~"' . $esc($what) . '",i](around:' . $metres . ',' . $centre['lat'] . ',' . $centre['lon'] . '); );' . "\n"
       . 'out center ' . $max . ';';
  } else {
    $q = "[out:json][timeout:10];\n"
       . 'area["name"~"^' . $esc($city) . '$",i]["boundary"="administrative"]->.a;' . "\n"
       . '( nwr["name"~"' . $esc($what) . '",i](area.a); );' . "\n"
       . 'out center ' . $max . ';';
  }

  if ($http === null) {
    $http = function ($url, $payload, $headers) {
      $ch = curl_init($url);
      curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_TIMEOUT => 12,        // two of these (24s) still fit under PHP's 30s
        CURLOPT_USERAGENT => 'QuickLimes/1.0 (ERP lead discovery; app.quicklimes.com)',
      ]);
      $res = curl_exec($ch);
      $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
      $err = curl_error($ch);
      curl_close($ch);
      return ['code' => $code, 'body' => $res, 'err' => $err];
    };
  }

  /* The main Overpass endpoint 504s often on big cities (it is donated infra).
     Try a mirror before giving up — a 504/429/transport-error on the first is
     worth one more attempt elsewhere; a clean non-200 (e.g. 400 bad query) is
     not, so we stop rather than hammer every mirror with the same broken query.
     In RADIUS mode we already spent ~6s geocoding, so we allow only ONE endpoint
     to stay under PHP's 30s (6 + 12 = 18s; a second 12s try would risk 30s). */
  $endpoints = $centre
    ? ['https://overpass-api.de/api/interpreter']
    : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  $r = ['code' => 0, 'body' => '', 'err' => 'no endpoint tried'];
  foreach ($endpoints as $ep) {
    $r = $http($ep, 'data=' . urlencode($q), ['Content-Type: application/x-www-form-urlencoded']);
    $code = (int)$r['code'];
    if (empty($r['err']) && $code === 200) break;                 // success
    if (empty($r['err']) && $code !== 429 && $code !== 504) break; // real HTTP error — a mirror won't help
    // otherwise (transport error, 429, or 504) fall through and try the mirror
  }

  if (!empty($r['err'])) return ['ok' => false, 'places' => [], 'error' => 'Could not reach OpenStreetMap — please try again in a moment'];
  $code = (int)$r['code'];
  if ($code === 429 || $code === 504) {
    /* Overpass is a donated free service and throttles. Say so plainly: this is
       "try again in a minute", NOT "there are no such businesses here". */
    return ['ok' => false, 'places' => [], 'error' => 'OpenStreetMap is busy (it is a free shared service) — wait a minute and try again, or search a smaller area'];
  }
  if ($code !== 200) return ['ok' => false, 'places' => [], 'error' => 'OpenStreetMap error (HTTP ' . $code . ')'];
  $j = json_decode((string)$r['body'], true);
  if (!is_array($j)) return ['ok' => false, 'places' => [], 'error' => 'OpenStreetMap sent an unreadable reply'];
  /* radius_fell_back: a radius was asked for but the place could not be geocoded,
     so this is an area search. The UI says so rather than pretending the circle
     was honoured. */
  return ['ok' => true, 'places' => ql_osm_parse($j, $city), 'error' => '', 'radius_fell_back' => $radiusFellBack];
}

/* The one door the app uses: reads the key from config, then delegates. */
function ql_places_search($what, $city, $opts = [], $http = null) {
  /* The key may be passed in (per-plant, saved from inside the app) or come from
     config.php. Same precedence rule as Mapbox: an explicit key wins. */
  $key = trim((string)($opts['key'] ?? ''));
  if ($key === '') $key = ql_places_key();
  return ql_places_request($key, $what, $city, $opts, $http);
}

