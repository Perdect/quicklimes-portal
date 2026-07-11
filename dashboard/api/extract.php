<?php
/* ═══════════════════════════════════════════════════════════════
   /api/extract — AI invoice extraction (vision) proxy.
   The provider key lives ONLY in config.php (server-side); it is never
   sent to the browser, logged, or committed. The browser sends the bill's
   embedded text + up to N page images; we forward to the model with a
   STRICT JSON tool schema and return the structured result. When no key is
   configured we return {ok:false, fallback:true} so the client uses the
   offline regex parser. All validation happens client-side (extract-schema.js).
   POST { plant_id, company_id, token, kind, fileName, text, images:[{media,b64}] }
   ═══════════════════════════════════════════════════════════════ */
require __DIR__ . '/db.php';
ql_cors();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') ql_out(['ok' => false, 'error' => 'POST only'], 405);

$b = ql_body();
$plantId = (string)($b['plant_id'] ?? '');
if (!ql_verify_token(ql_token(), $plantId)) ql_out(['ok' => false, 'error' => 'Unauthorized'], 401);

$llm = ql_llm();
if ($llm['key'] === '') ql_out(['ok' => false, 'fallback' => true, 'error' => 'llm_not_configured']);

/* ── input limits (cost + abuse control) ── */
$text   = (string)($b['text'] ?? '');
$kind   = in_array(($b['kind'] ?? ''), ['sales', 'purchase'], true) ? $b['kind'] : '';
$images = is_array($b['images'] ?? null) ? $b['images'] : [];
if (strlen($text) > 60000) $text = substr($text, 0, 60000);
$images = array_slice($images, 0, max(0, $llm['maxImg']));
$MEDIA_OK = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

$content = [];
$content[] = ['type' => 'text', 'text' =>
  "You are extracting fields from ONE Indian GST tax invoice / bill for a lime-manufacturing firm " .
  "(own GSTINs 08BNAPM0488E1Z3 Gotan Lime Industries, 08NLIPS9801K1Z5 Deshwali Minerals — they are the " .
  "recipient/buyer on purchases and the seller on sales).\n" .
  "Rules: return ONLY what is printed. If a field is not on the document, return null — NEVER guess or " .
  "fabricate. The supplier/buyer NAME must be the legal firm name, never a label like 'Buyer', 'For', " .
  "'Authorised Signatory', a declaration, an address, or a transport route. Give a confidence " .
  "(high|medium|low) per field. Amounts are numbers (no currency symbols/commas).\n\n" .
  ($text !== '' ? "Embedded document text:\n" . $text : "The document text could not be extracted; read the image(s).")];
foreach ($images as $im) {
  $media = (string)($im['media'] ?? ''); $data = (string)($im['b64'] ?? '');
  if (!in_array($media, $MEDIA_OK, true) || $data === '' || strlen($data) > 6000000) continue;
  $content[] = ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $media, 'data' => $data]];
}

/* ── strict tool schema (mirrors extract-schema.js FIELDS) ── */
$conf = ['type' => 'string', 'enum' => ['high', 'medium', 'low']];
$numOrNull = ['type' => ['number', 'null']];
$strOrNull = ['type' => ['string', 'null']];
$schema = [
  'type' => 'object',
  'properties' => [
    'documentType' => ['type' => 'string', 'enum' => ['sales', 'purchase', 'credit_note', 'debit_note', 'unknown']],
    'invoiceNo' => $strOrNull, 'invoiceDate' => $strOrNull, 'dueDate' => $strOrNull, 'poNo' => $strOrNull,
    'ewayBillNo' => $strOrNull, 'vehicleNo' => $strOrNull, 'placeOfSupply' => $strOrNull, 'stateCode' => $strOrNull,
    'reverseCharge' => ['type' => ['boolean', 'null']], 'paymentTerms' => $strOrNull,
    'supplierName' => $strOrNull, 'supplierGstin' => $strOrNull, 'buyerName' => $strOrNull, 'buyerGstin' => $strOrNull,
    'taxable' => $numOrNull, 'cgst' => $numOrNull, 'sgst' => $numOrNull, 'igst' => $numOrNull, 'cess' => $numOrNull,
    'freight' => $numOrNull, 'discount' => $numOrNull, 'roundOff' => $numOrNull, 'grandTotal' => $numOrNull, 'gstRate' => $numOrNull,
    'lineItems' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
      'name' => $strOrNull, 'category' => $strOrNull, 'description' => $strOrNull, 'hsn' => $strOrNull,
      'qty' => $numOrNull, 'unit' => $strOrNull, 'rate' => $numOrNull, 'taxable' => $numOrNull,
      'gstRate' => $numOrNull, 'tax' => $numOrNull, 'total' => $numOrNull]]],
    'confidence' => ['type' => 'object', 'additionalProperties' => $conf],
  ],
  'required' => ['documentType', 'supplierName', 'invoiceNo', 'taxable', 'grandTotal', 'confidence'],
];

$payload = [
  'model' => $llm['model'], 'max_tokens' => 2000,
  'tools' => [['name' => 'extract_invoice', 'description' => 'Return the invoice fields exactly as printed.', 'input_schema' => $schema]],
  'tool_choice' => ['type' => 'tool', 'name' => 'extract_invoice'],
  'messages' => [['role' => 'user', 'content' => $content]],
];

/* ── call the model (1 retry on transient failure); key never logged ── */
function ql_llm_call($key, $payload) {
  $ch = curl_init('https://api.anthropic.com/v1/messages');
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 70,
    CURLOPT_HTTPHEADER => ['content-type: application/json', 'anthropic-version: 2023-06-01', 'x-api-key: ' . $key],
    CURLOPT_POSTFIELDS => json_encode($payload),
  ]);
  $res = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err = curl_error($ch);
  curl_close($ch);
  return [$code, $res, $err];
}

$attempt = 0; $out = null; $httpErr = '';
while ($attempt < 2) {
  list($code, $res, $err) = ql_llm_call($llm['key'], $payload);
  if ($code === 200 && $res) { $out = json_decode($res, true); break; }
  $httpErr = 'HTTP ' . $code . ($err ? ' ' . $err : '');
  if ($code === 429 || $code >= 500 || $code === 0) { $attempt++; usleep(700000); continue; }
  break; // 4xx (bad key/request) — don't retry
}
if (!$out) { error_log('[extract] upstream failed: ' . $httpErr); ql_out(['ok' => false, 'fallback' => true, 'error' => 'ai_unavailable']); }

/* pull the tool_use block */
$data = null;
foreach (($out['content'] ?? []) as $blk) { if (($blk['type'] ?? '') === 'tool_use' && ($blk['name'] ?? '') === 'extract_invoice') { $data = $blk['input']; break; } }
if ($data === null) { error_log('[extract] no tool_use in response'); ql_out(['ok' => false, 'fallback' => true, 'error' => 'ai_bad_response']); }

ql_out(['ok' => true, 'data' => $data, 'usage' => $out['usage'] ?? null]);
