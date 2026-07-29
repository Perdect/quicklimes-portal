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

   WHICH model answers is llm.php's business, not this file's. This used to hold one
   provider's endpoint and request shape hardcoded, which is why a perfectly valid
   Gemini key failed here — the key was never the problem, the endpoint was. This
   file now describes the JOB (the prompt, the schema, the limits); llm.php knows the
   providers. Keep it that way: llm.test.php fails if a provider URL reappears here.
   ═══════════════════════════════════════════════════════════════ */
require __DIR__ . '/db.php';
require __DIR__ . '/llm.php';
ql_cors();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') ql_out(['ok' => false, 'error' => 'POST only'], 405);

$b = ql_body();
$plantId = (string)($b['plant_id'] ?? '');
$ctx = ql_token_ctx($plantId);
if (!$ctx) ql_out(['ok' => false, 'error' => 'Unauthorized'], 401);
/* The tenant key comes from the TOKEN, not the body. ql_token_ctx has already
   proven they agree; re-deriving here means no later line can be tricked by a
   body field into scoping rows to another firm. */
$plantId = (string)$ctx['plant'];
if (!ql_role_can($ctx['role'], 'extract')) ql_out(['ok' => false, 'error' => 'Forbidden'], 403);

$llm = ql_llm();
if ($llm['key'] === '') ql_out(['ok' => false, 'fallback' => true, 'error' => 'llm_not_configured']);

/* ── input limits (cost + abuse control) ── */
$text   = (string)($b['text'] ?? '');
$kind   = in_array(($b['kind'] ?? ''), ['sales', 'purchase'], true) ? $b['kind'] : '';
$images = is_array($b['images'] ?? null) ? $b['images'] : [];
if (strlen($text) > 60000) $text = substr($text, 0, 60000);
$images = array_slice($images, 0, max(0, $llm['maxImg']));
$MEDIA_OK = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

$prompt =
  "You are extracting fields from ONE Indian GST tax invoice / bill for a lime-manufacturing firm " .
  "(own GSTINs 08BNAPM0488E1Z3 Gotan Lime Industries, 08NLIPS9801K1Z5 Deshwali Minerals — they are the " .
  "recipient/buyer on purchases and the seller on sales).\n" .
  "Rules: return ONLY what is printed. If a field is not on the document, return null — NEVER guess or " .
  "fabricate. The supplier/buyer NAME must be the legal firm name, never a label like 'Buyer', 'For', " .
  "'Authorised Signatory', a declaration, an address, or a transport route. Give a confidence " .
  "(high|medium|low) per field. Amounts are numbers (no currency symbols/commas).\n\n" .
  ($text !== '' ? "Embedded document text:\n" . $text : "The document text could not be extracted; read the image(s).");

/* Sanitise here, not in the adapter: this is the untrusted-input boundary. The
   adapter's job is to speak a provider's dialect, not to police what reaches it. */
$safeImages = [];
foreach ($images as $im) {
  $media = (string)($im['media'] ?? ''); $data = (string)($im['b64'] ?? '');
  if (!in_array($media, $MEDIA_OK, true) || $data === '' || strlen($data) > 6000000) continue;
  $safeImages[] = ['media' => $media, 'b64' => $data];
}

/* ── strict tool schema (mirrors extract-schema.js FIELDS) ── */
$conf = ['type' => 'string', 'enum' => ['high', 'medium', 'low']];
$numOrNull = ['type' => ['number', 'null']];
$strOrNull = ['type' => ['string', 'null']];

/* The confidence map, keyed EXPLICITLY — one entry per field in extract-schema.js
   FIELDS. It used to be additionalProperties (a free-form map), which Anthropic
   accepts and Gemini cannot express at all: Gemini's OBJECT needs declared
   properties, so a stripped additionalProperties leaves a bare {type:OBJECT} and
   every field silently comes back with no confidence — which extract-schema.js
   would then default to 'medium', quietly presenting a guess as a fair-confidence
   read. Spelling the keys out is stricter for BOTH providers, not a Gemini workaround. */
$CONF_FIELDS = ['documentType', 'invoiceNo', 'invoiceDate', 'dueDate', 'poNo', 'ewayBillNo',
  'vehicleNo', 'placeOfSupply', 'stateCode', 'reverseCharge', 'paymentTerms',
  'supplierName', 'supplierGstin', 'buyerName', 'buyerGstin',
  'taxable', 'cgst', 'sgst', 'igst', 'cess', 'freight', 'discount', 'roundOff', 'grandTotal', 'gstRate'];
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
    'confidence' => ['type' => 'object', 'properties' => array_fill_keys($CONF_FIELDS, $conf)],
  ],
  'required' => ['documentType', 'supplierName', 'invoiceNo', 'taxable', 'grandTotal', 'confidence'],
];

/* ── the call. Which provider, which URL, which request shape: llm.php's problem. ── */
$r = ql_llm_extract($llm, $prompt, $safeImages, $schema, 'extract_invoice');

if (!$r['ok'] || $r['data'] === null) {
  /* The provider and the reason, never the key. "ai_unavailable" alone sent me
     chasing an imaginary bad key for an hour — the log has to say WHICH provider
     said WHAT. */
  error_log('[extract] ' . $r['provider'] . '/' . $r['model'] . ' failed: ' . $r['error'] . ' (http ' . $r['http'] . ')');
  ql_out(['ok' => false, 'fallback' => true, 'error' => $r['error'] ?: 'ai_unavailable']);
}

ql_out(['ok' => true, 'data' => $r['data'], 'usage' => $r['usage'], 'provider' => $r['provider'], 'model' => $r['model']]);
