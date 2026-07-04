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

/* ── Stateless HMAC tokens: base64url(payload).base64url(hex-sig) ── */
function ql_b64url($s)     { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function ql_b64url_dec($s) { return base64_decode(strtr($s, '-_', '+/')); }

function ql_sign_token($plantId, $ttl = 2592000) {   // 30 days
  $c = ql_config();
  $payload = $plantId . '|' . (time() + $ttl);
  $sig = hash_hmac('sha256', $payload, $c['APP_SECRET']);   // hex string
  return ql_b64url($payload) . '.' . ql_b64url($sig);
}

/* Returns the plant id encoded in the token if valid, else false.
   When $plantId is non-empty it must equal the token's plant id. */
function ql_verify_token($token, $plantId = '') {
  $c = ql_config();
  $parts = explode('.', (string)$token);
  if (count($parts) !== 2) return false;
  $payload = ql_b64url_dec($parts[0]);
  $sig     = ql_b64url_dec($parts[1]);
  $expect  = hash_hmac('sha256', $payload, $c['APP_SECRET']);
  if (!hash_equals($expect, $sig)) return false;
  $bits = explode('|', $payload);
  if (count($bits) !== 2) return false;
  [$pid, $exp] = $bits;
  if ((int)$exp < time()) return false;
  if ($plantId !== '' && $pid !== $plantId) return false;
  return $pid;
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
}
