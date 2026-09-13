<?php
/* ═══════════════════════════════════════════════════════════════
   /api/quote — the customer-facing quotation link.

   POST { action:'link', plant_id, company_id, token, quote }  -> { ok, url }
        Signs a read-only URL for one quotation. The token proves the caller
        may see the firm's books; the signature (HMAC of plant|company|quote
        with APP_SECRET) is what a customer later presents — it names one
        quotation and nothing else, and cannot be altered to reach another.
   POST { action:'views', plant_id, company_id, token, quotes:[…] } -> { ok, views:{id:{n,last}} }
        How many times each link was opened (so the app can mark "Viewed").
   GET  ?t=<token>
        Renders the quotation as a page. Reads the firm's blob, finds the
        quotation and its customer, and hands them to quote-doc.js — the SAME
        renderer the app prints from, so the customer sees exactly the paper.
        Every open is counted in quote_views.

   Nothing here writes to the blob: the app owns it (and its revision lock).
   ═══════════════════════════════════════════════════════════════ */
require __DIR__ . '/db.php';
ql_cors();

function ql_quote_views_table($db) {
  $db->exec("CREATE TABLE IF NOT EXISTS quote_views (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    plant_id    VARCHAR(64)  NOT NULL,
    company_id  VARCHAR(96)  NOT NULL DEFAULT '',
    quote_id    VARCHAR(64)  NOT NULL,
    viewed_at   DATETIME     NOT NULL,
    ip          VARCHAR(64)  DEFAULT NULL,
    KEY idx_q (plant_id, company_id, quote_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
function b64u($s) { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64u_dec($s) { return base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }
function ql_quote_sign($plant, $co, $quote) {
  $cfg = ql_config();
  return hash_hmac('sha256', $plant . '|' . $co . '|' . $quote, (string)$cfg['APP_SECRET']);
}
function ql_quote_blob($db, $plant, $co) {
  $st = $db->prepare('SELECT data FROM app_data WHERE plant_id = ? AND data_id = ? LIMIT 1');
  $st->execute([$plant, $co !== '' ? $co : $plant]);
  $r = $st->fetch();
  if (!$r) { $st = $db->prepare('SELECT data FROM app_data WHERE plant_id = ? LIMIT 1'); $st->execute([$plant]); $r = $st->fetch(); }
  return $r ? json_decode($r['data'], true) : null;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'POST') {
  $b = ql_body();
  $plantId = (string)($b['plant_id'] ?? '');
  $coId    = (string)($b['company_id'] ?? '');
  $ctx = ql_token_ctx($plantId);
  if (!$ctx) ql_out(['ok' => false, 'error' => 'Unauthorized'], 401);
  $plantId = (string)$ctx['plant'];
  if (!ql_role_can($ctx['role'], 'sales')) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);
  $action = (string)($b['action'] ?? '');
  $db = ql_db();
  if ($action === 'link') {
    $q = (string)($b['quote'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_-]{4,64}$/', $q)) ql_out(['ok' => false, 'error' => 'Bad quotation id']);
    $t = b64u($plantId . '|' . $coId . '|' . $q) . '.' . ql_quote_sign($plantId, $coId, $q);
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'app.quicklimes.com';
    ql_out(['ok' => true, 'url' => $scheme . '://' . $host . '/api/quote?t=' . $t]);
  }
  if ($action === 'views') {
    ql_quote_views_table($db);
    $ids = is_array($b['quotes'] ?? null) ? array_values(array_filter($b['quotes'], fn($x) => is_string($x) && preg_match('/^[A-Za-z0-9_-]{4,64}$/', $x))) : [];
    $out = [];
    if ($ids) {
      $ph = implode(',', array_fill(0, count($ids), '?'));
      $st = $db->prepare("SELECT quote_id, COUNT(*) AS n, MAX(viewed_at) AS last FROM quote_views WHERE plant_id = ? AND company_id = ? AND quote_id IN ($ph) GROUP BY quote_id");
      $st->execute(array_merge([$plantId, $coId], $ids));
      foreach ($st->fetchAll() as $r) $out[$r['quote_id']] = ['n' => (int)$r['n'], 'last' => $r['last']];
    }
    ql_out(['ok' => true, 'views' => $out]);
  }
  ql_out(['ok' => false, 'error' => 'Unknown action']);
}

/* ── GET: the customer opens the link ─────────────────────────── */
$t = (string)($_GET['t'] ?? '');
$parts = explode('.', $t, 2);
if (count($parts) !== 2) { http_response_code(404); echo 'This quotation link is not valid.'; exit; }
$payload = b64u_dec($parts[0]);
$seg = explode('|', (string)$payload, 3);
if (count($seg) !== 3) { http_response_code(404); echo 'This quotation link is not valid.'; exit; }
[$plantId, $coId, $quoteId] = $seg;
if (!hash_equals(ql_quote_sign($plantId, $coId, $quoteId), $parts[1])) { http_response_code(403); echo 'This quotation link is not valid.'; exit; }

$db = ql_db();
$data = ql_quote_blob($db, $plantId, $coId);
$quote = null;
foreach ((array)($data['quotes'] ?? []) as $q) { if (($q['id'] ?? '') === $quoteId) { $quote = $q; break; } }
if (!$quote) { http_response_code(404); echo 'This quotation is no longer available.'; exit; }
$cust = null;
foreach ((array)($data['parties'] ?? []) as $p) { if (($p['id'] ?? '') === ($quote['cust'] ?? '')) { $cust = $p; break; } }
$st = $db->prepare('SELECT plant_name, gst_number, city, address, contact_phone, owner_phone FROM plants WHERE id = ? LIMIT 1');
$st->execute([$coId !== '' ? $coId : $plantId]);
$pl = $st->fetch() ?: [];
$company = ['name' => $pl['plant_name'] ?? 'Deshwali Minerals', 'short' => $pl['plant_name'] ?? '', 'gstin' => $pl['gst_number'] ?? '', 'city' => $pl['city'] ?? '', 'address' => $pl['address'] ?? '', 'phone' => $pl['contact_phone'] ?? ($pl['owner_phone'] ?? '')];

try {
  ql_quote_views_table($db);
  $db->prepare('INSERT INTO quote_views (plant_id, company_id, quote_id, viewed_at, ip) VALUES (?,?,?,?,?)')
     ->execute([$plantId, $coId, $quoteId, gmdate('Y-m-d H:i:s'), substr((string)ql_client_ip(), 0, 64)]);
} catch (Throwable $e) { /* a view count is a nicety; the page still renders */ }

/* strip what the customer must never see: internal history, links to other records */
$public = $quote;
unset($public['history'], $public['reqId'], $public['offerId'], $public['convertedSale'], $public['link'], $public['by']);
$custPublic = $cust ? ['name' => $cust['name'] ?? '', 'contact' => $cust['contact'] ?? '', 'address' => $cust['address'] ?? '', 'city' => $cust['city'] ?? '', 'state' => $cust['state'] ?? '', 'pin' => $cust['pin'] ?? '', 'gstin' => $cust['gstin'] ?? '', 'deliveryLoc' => $cust['deliveryLoc'] ?? ''] : [];

header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex');
$json = json_encode(['quote' => $public, 'customer' => $custPublic, 'company' => $company], JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP);
echo '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Quotation ' . htmlspecialchars((string)($quote['no'] ?? '')) . ' — ' . htmlspecialchars($company['name']) . '</title>'
   . '<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700;800&display=swap" rel="stylesheet"><style>body{margin:0;background:#f1f5f9;font-family:Geist,system-ui,sans-serif}.bar{max-width:820px;margin:14px auto 0;padding:0 12px;display:flex;justify-content:flex-end}.bar button{border:0;background:#0f4c81;color:#fff;font:600 13px Geist,sans-serif;padding:9px 14px;border-radius:9px;cursor:pointer}@media print{.bar{display:none}}</style></head><body>'
   . '<div class="bar"><button onclick="window.print()">Save as PDF / Print</button></div><div id="doc"></div>'
   . '<script src="/v2/customer-core.js?v=cu2"></script><script src="/v2/quote-doc.js?v=cu2"></script>'
   . '<script>(function(){var d=' . $json . ';var s=document.createElement("style");s.textContent=QuoteDoc.CSS;document.head.appendChild(s);document.getElementById("doc").innerHTML=QuoteDoc.quotationHTML(d.quote,d.customer,d.company,{});})();</script></body></html>';
