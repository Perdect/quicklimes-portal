<?php
/* llm.test.php — the provider adapter: the request we build, the response we read.
 *
 * WHY THIS EXISTS. extract.php was hardcoded to api.anthropic.com. A valid Gemini
 * key sent there fails — and the failure looks exactly like a bad key, which is how
 * the owner ended up deleting two perfectly good keys on my say-so. The adapter is
 * the fix; these tests are what stop the next silent mis-shaped request.
 *
 * NOTHING IS STUBBED. build/parse are pure, so every test below drives the REAL
 * functions with real fixtures and the REAL schema read out of extract.php. The
 * only untested line is curl itself.
 *
 *   php llm.test.php
 */
require __DIR__ . '/llm.php';

$pass = 0; $fail = 0;
function ok($c, $m) { global $pass, $fail; if ($c) $pass++; else { $fail++; echo "  ❌ $m\n"; } }
function eq($m, $a, $b) {
  ok($a === $b, $m . "\n     got: " . json_encode($a) . "  expected: " . json_encode($b));
}
/* Deep search — proves a value is ABSENT from the whole structure, which is how you
   test "the key is not in the URL" honestly rather than checking the one place you
   remembered to look. */
function jhas($hay, $needle) { return strpos(json_encode($hay), $needle) !== false; }

echo "\n═══ llm.php · one interface, two providers ═══\n\n";

$KEY = 'AQ.test-key-not-a-real-secret';
$GEM = ['provider' => 'gemini', 'key' => $KEY, 'model' => 'gemini-2.5-flash', 'maxImg' => 3];
$ANT = ['provider' => 'anthropic', 'key' => 'sk-ant-test', 'model' => 'claude-sonnet-5', 'maxImg' => 3];
$IMG = [['media' => 'image/png', 'b64' => 'AAAA']];

/* ══════════ 1. THE KEY NEVER LANDS IN A URL ══════════
   The whole reason ?key= is not used. A query string is logged by every proxy and
   web server between here and Google. */
{
  $g = ql_llm_build_gemini($GEM, 'p', [], ['type' => 'object'], 'extract_invoice');
  ok(strpos($g['url'], $KEY) === false, 'THE RULE: the Gemini key is NOT in the URL');
  ok(strpos($g['url'], 'key=') === false, '  and there is no ?key= parameter at all');
  ok(in_array('x-goog-api-key: ' . $KEY, $g['headers'], true), '  it travels in the x-goog-api-key header');
  ok(!jhas($g['payload'], $KEY), '  and never in the request body');

  $a = ql_llm_build_anthropic($ANT, 'p', [], ['type' => 'object'], 'extract_invoice');
  ok(strpos($a['url'], 'sk-ant-test') === false, 'the Anthropic key is NOT in the URL either');
  ok(in_array('x-api-key: sk-ant-test', $a['headers'], true), '  it travels in the x-api-key header');
}

/* ══════════ 2. EACH PROVIDER GETS ITS OWN ENDPOINT ══════════
   The original bug, pinned: a Gemini call must not reach Anthropic. */
{
  $g = ql_llm_build_gemini($GEM, 'p', [], ['type' => 'object'], 'x');
  ok(strpos($g['url'], 'generativelanguage.googleapis.com') !== false, 'Gemini goes to Google');
  ok(strpos($g['url'], 'anthropic') === false, '  THE ORIGINAL BUG: a Gemini call never reaches api.anthropic.com');
  ok(strpos($g['url'], 'gemini-2.5-flash:generateContent') !== false, '  at the configured model');
  ok(!jhas($g['headers'], 'anthropic-version'), '  and carries no Anthropic headers');

  /* A model name with a slash or a space must not break out of the path. */
  $odd = ql_llm_build_gemini(['provider' => 'gemini', 'key' => 'k', 'model' => 'a/../b'], 'p', [], [], 'x');
  ok(strpos($odd['url'], 'a/../b') === false, 'a model name cannot inject path segments into the URL');

  $a = ql_llm_build_anthropic($ANT, 'p', [], ['type' => 'object'], 'x');
  eq('Anthropic goes to Anthropic', $a['url'], 'https://api.anthropic.com/v1/messages');
  ok(in_array('anthropic-version: 2023-06-01', $a['headers'], true), '  with the version header it requires');
}

/* ══════════ 3. THE MODEL IS FORCED TO USE THE TOOL ══════════
   Without this the model may reply in prose and the caller gets nothing usable. */
{
  $g = ql_llm_build_gemini($GEM, 'p', [], ['type' => 'object'], 'extract_invoice');
  eq('Gemini is FORCED to call the function (mode ANY)',
    $g['payload']['tool_config']['function_calling_config']['mode'], 'ANY');
  eq('  and only the one we asked for',
    $g['payload']['tool_config']['function_calling_config']['allowed_function_names'], ['extract_invoice']);
  eq('  the function is declared under Gemini\'s own key name',
    $g['payload']['tools'][0]['function_declarations'][0]['name'], 'extract_invoice');
  eq('  temperature 0 — transcribing a bill twice must give the same answer twice',
    $g['payload']['generationConfig']['temperature'], 0);

  $a = ql_llm_build_anthropic($ANT, 'p', [], ['type' => 'object'], 'extract_invoice');
  eq('Anthropic is forced via tool_choice', $a['payload']['tool_choice'], ['type' => 'tool', 'name' => 'extract_invoice']);
}

/* ══════════ 4. IMAGES SURVIVE THE CROSSING ══════════
   The bills that matter are photos. If images silently drop, the AI reads a blank
   page and confidently returns nulls. */
{
  $g = ql_llm_build_gemini($GEM, 'the prompt', $IMG, [], 'x');
  $parts = $g['payload']['contents'][0]['parts'];
  eq('Gemini: the prompt goes first', $parts[0], ['text' => 'the prompt']);
  eq('  the image follows, as inline_data with Gemini\'s own key names',
    $parts[1], ['inline_data' => ['mime_type' => 'image/png', 'data' => 'AAAA']]);
  eq('  two images, two parts', count(ql_llm_build_gemini($GEM, 'p',
    [$IMG[0], $IMG[0]], [], 'x')['payload']['contents'][0]['parts']), 3);
  eq('  no images: just the prompt', count(ql_llm_build_gemini($GEM, 'p', [], [], 'x')['payload']['contents'][0]['parts']), 1);

  $a = ql_llm_build_anthropic($ANT, 'the prompt', $IMG, [], 'x');
  $c = $a['payload']['messages'][0]['content'];
  eq('Anthropic: the same image, in Anthropic\'s shape',
    $c[1], ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => 'image/png', 'data' => 'AAAA']]);
}

/* ══════════ 5. THE SCHEMA TRANSLATION ══════════
   Gemini REJECTS JSON Schema keywords it does not know instead of ignoring them —
   so an untranslated schema is a 400, not a degraded read. */
{
  eq('a union type collapses to its non-null member, + nullable',
    ql_llm_gemini_schema(['type' => ['string', 'null']]), ['type' => 'STRING', 'nullable' => true]);
  eq('  numbers too', ql_llm_gemini_schema(['type' => ['number', 'null']]), ['type' => 'NUMBER', 'nullable' => true]);
  eq('  a plain type is just uppercased, and is NOT marked nullable',
    ql_llm_gemini_schema(['type' => 'string']), ['type' => 'STRING']);
  eq('additionalProperties is stripped — Gemini rejects it',
    ql_llm_gemini_schema(['type' => 'object', 'additionalProperties' => ['type' => 'string']]), ['type' => 'OBJECT']);
  eq('enum survives — it is how the model is pinned to high|medium|low',
    ql_llm_gemini_schema(['type' => 'string', 'enum' => ['high', 'low']]), ['type' => 'STRING', 'enum' => ['high', 'low']]);
  eq('nesting is translated all the way down (lineItems is 3 deep)',
    ql_llm_gemini_schema(['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
      'qty' => ['type' => ['number', 'null']]]]]),
    ['type' => 'ARRAY', 'items' => ['type' => 'OBJECT', 'properties' => ['qty' => ['type' => 'NUMBER', 'nullable' => true]]]]);
  eq('required survives', ql_llm_gemini_schema(['type' => 'object', 'required' => ['a']])['required'], ['a']);
  eq('a non-array input is returned untouched', ql_llm_gemini_schema('x'), 'x');

  /* A field named "type" inside properties must not be mistaken for a type keyword.
     This is the trap the recursion invites: properties is a map of FIELD NAMES. */
  $r = ql_llm_gemini_schema(['type' => 'object', 'properties' => ['type' => ['type' => 'string']]]);
  eq('a FIELD called "type" is not confused with the type keyword',
    $r, ['type' => 'OBJECT', 'properties' => ['type' => ['type' => 'STRING']]]);
}

/* ══════════ 6. THE REAL SCHEMA, OUT OF THE REAL extract.php ══════════
   Not a copy. If extract.php's schema drifts into something Gemini rejects, this
   fails — which is the only way this stays true six months from now. */
{
  $src = file_get_contents(__DIR__ . '/extract.php');
  /* Lift the literal schema block and eval it — the alternative is duplicating 20
     lines here, and a duplicated schema is a schema that silently diverges. */
  $i = strpos($src, '$conf = ['); $j = strpos($src, "];", strpos($src, "'required' => ["));
  $block = substr($src, $i, $j - $i + 2);
  eval($block);
  ok(isset($schema['properties']), 'the REAL schema loaded out of extract.php');

  $gs = ql_llm_gemini_schema($schema);
  ok(!jhas($gs, 'additionalProperties'), 'THE GATE: no additionalProperties survives anywhere in the real schema');
  ok(!preg_match('/"type":"(string|number|object|array|boolean)"/', json_encode($gs)),
    '  every type is uppercased — a lowercase one 400s');
  ok(!jhas($gs, '"null"'), '  no bare "null" type survives — Gemini has no such type');

  eq('  a nullable field is nullable', $gs['properties']['invoiceNo'], ['type' => 'STRING', 'nullable' => true]);
  eq('  documentType keeps its enum', $gs['properties']['documentType']['enum'],
    ['sales', 'purchase', 'credit_note', 'debit_note', 'unknown']);
  eq('  lineItems.qty survives 3 levels down',
    $gs['properties']['lineItems']['items']['properties']['qty'], ['type' => 'NUMBER', 'nullable' => true]);
  eq('  required is preserved', $gs['required'],
    ['documentType', 'supplierName', 'invoiceNo', 'taxable', 'grandTotal', 'confidence']);

  /* THE CONFIDENCE MAP. It used to be additionalProperties — free-form, which Gemini
     cannot express. Stripped, it would leave a bare {type:OBJECT} and every field
     would come back with NO confidence, which extract-schema.js defaults to
     'medium' — presenting a guess as a fair-confidence read. Explicit keys fix it
     for both providers. */
  ok(isset($schema['properties']['confidence']['properties']),
    'confidence declares its keys EXPLICITLY, not as a free-form map');
  ok(count($schema['properties']['confidence']['properties']) === 25,
    '  one per field in extract-schema.js FIELDS (25)');
  eq('  and each is pinned to the three levels',
    $schema['properties']['confidence']['properties']['taxable'],
    ['type' => 'string', 'enum' => ['high', 'medium', 'low']]);
  ok(count($gs['properties']['confidence']['properties']) === 25,
    '  and all 25 survive the Gemini translation');

  /* The field list here must match the client's, or the client silently defaults
     the missing ones to 'medium'. Read BOTH, compare. */
  $js = file_get_contents(__DIR__ . '/../v2/extract-schema.js');
  preg_match('/var FIELDS = \[([\s\S]*?)\];/', $js, $m);
  preg_match_all("/'([a-zA-Z]+)'/", $m[1], $fm);
  $clientFields = $fm[1];
  eq('THE CONTRACT: the confidence keys match extract-schema.js FIELDS exactly',
    array_values(array_diff($clientFields, array_keys($schema['properties']['confidence']['properties']))), []);
  eq('  and no extra ones the client would ignore',
    array_values(array_diff(array_keys($schema['properties']['confidence']['properties']), $clientFields)), []);
}

/* ══════════ 7. READING THE ANSWER ══════════ */
{
  /* Gemini's real success shape. */
  $gOut = ['candidates' => [['content' => ['parts' => [
      ['functionCall' => ['name' => 'extract_invoice', 'args' => ['invoiceNo' => 'X-1', 'taxable' => 411973.2]]]]]]],
    'usageMetadata' => ['promptTokenCount' => 1200, 'candidatesTokenCount' => 300]];
  $r = ql_llm_parse_gemini($gOut, 'extract_invoice');
  ok($r['ok'], 'a Gemini functionCall is read');
  eq('  the args come through as the data', $r['data'], ['invoiceNo' => 'X-1', 'taxable' => 411973.2]);
  eq('  usage is NORMALISED to the same names Anthropic uses', $r['usage'],
    ['input_tokens' => 1200, 'output_tokens' => 300]);

  /* Anthropic's real success shape → the SAME normalised result. That identity is
     the entire promise of this file. */
  $aOut = ['content' => [['type' => 'tool_use', 'name' => 'extract_invoice',
      'input' => ['invoiceNo' => 'X-1', 'taxable' => 411973.2]]],
    'usage' => ['input_tokens' => 1200, 'output_tokens' => 300]];
  $ra = ql_llm_parse_anthropic($aOut, 'extract_invoice');
  eq('THE PROMISE: both providers return byte-identical results for the same bill',
    $ra, $r);

  /* Text alongside the call (Gemini often narrates) must not shadow the args. */
  $chatty = ['candidates' => [['content' => ['parts' => [
    ['text' => 'Here are the fields:'],
    ['functionCall' => ['name' => 'extract_invoice', 'args' => ['invoiceNo' => 'X-2']]]]]]]];
  eq('a chatty preamble before the call does not hide it',
    ql_llm_parse_gemini($chatty, 'extract_invoice')['data'], ['invoiceNo' => 'X-2']);

  /* A DIFFERENT function must not be accepted as our answer. */
  $wrong = ['candidates' => [['content' => ['parts' => [
    ['functionCall' => ['name' => 'something_else', 'args' => ['invoiceNo' => 'X']]]]]]]];
  ok(!ql_llm_parse_gemini($wrong, 'extract_invoice')['ok'], 'a call to a DIFFERENT function is not our answer');
  $wrongA = ['content' => [['type' => 'tool_use', 'name' => 'other', 'input' => ['a' => 1]]]];
  ok(!ql_llm_parse_anthropic($wrongA, 'extract_invoice')['ok'], '  same on Anthropic');

  /* Missing usage must not fatal. */
  $noU = ['candidates' => [['content' => ['parts' => [['functionCall' => ['name' => 'x', 'args' => ['a' => 1]]]]]]]];
  eq('a response with no usage block reports zeros, not a crash',
    ql_llm_parse_gemini($noU, 'x')['usage'], ['input_tokens' => 0, 'output_tokens' => 0]);
}

/* ══════════ 8. FAILURE MUST NAME ITSELF ══════════
   "ai_unavailable" for everything is what sent me hunting an imaginary bad key.
   A blocked prompt, a truncation and a dead endpoint are three different problems. */
{
  $blocked = ['promptFeedback' => ['blockReason' => 'SAFETY']];
  $r = ql_llm_parse_gemini($blocked, 'x');
  ok(!$r['ok'], 'a blocked Gemini prompt fails');
  eq('  and says it was BLOCKED — not "unavailable"', $r['error'], 'ai_no_result:SAFETY');

  $trunc = ['candidates' => [['finishReason' => 'MAX_TOKENS', 'content' => ['parts' => []]]]];
  eq('a truncated Gemini answer names the truncation',
    ql_llm_parse_gemini($trunc, 'x')['error'], 'ai_no_result:MAX_TOKENS');

  eq('an empty Gemini response is a bad response', ql_llm_parse_gemini([], 'x')['error'], 'ai_bad_response');

  $refuse = ['content' => [['type' => 'text', 'text' => 'I cannot']], 'stop_reason' => 'end_turn'];
  eq('an Anthropic refusal names the stop reason',
    ql_llm_parse_anthropic($refuse, 'x')['error'], 'ai_no_result:end_turn');
  eq('an empty Anthropic response is a bad response', ql_llm_parse_anthropic([], 'x')['error'], 'ai_bad_response');

  ok(ql_llm_parse_gemini($blocked, 'x')['data'] === null, 'a failed parse returns NO data — never a half-read bill');
  ok(ql_llm_parse_gemini($blocked, 'x')['usage'] === null, '  and no usage');
}

/* ══════════ 9. ROUTING ══════════ */
{
  eq('the configured provider is used', ql_llm_provider(['provider' => 'gemini']), 'gemini');
  eq('  case and whitespace do not matter', ql_llm_provider(['provider' => ' Gemini ']), 'gemini');
  eq('an UNSET provider means Anthropic — existing installs do not move', ql_llm_provider([]), 'anthropic');
  eq('  an empty string is the same as unset', ql_llm_provider(['provider' => '']), 'anthropic');

  /* THE RULE I BROKE THREE TIMES: never infer the provider from the key's shape.
     Google moved AI Studio from AIza to AQ. mid-life. Any code that sniffed the
     prefix started rejecting valid keys that morning. */
  eq('an AQ. key with no provider set does NOT get guessed as Gemini',
    ql_llm_provider(['key' => 'AQ.abc']), 'anthropic');
  eq('  nor an AIza one — the key\'s shape is never consulted',
    ql_llm_provider(['key' => 'AIzaSyABC']), 'anthropic');

  /* No key, and a typo'd provider: both must fail WITHOUT touching the network. */
  $r = ql_llm_extract(['provider' => 'gemini', 'key' => '', 'model' => 'm'], 'p', [], [], 'x');
  ok(!$r['ok'] && $r['error'] === 'llm_not_configured', 'no key configured → refuses before any network call');
  eq('  and still reports the full shape', array_keys($r),
    ['ok', 'data', 'error', 'http', 'usage', 'provider', 'model']);

  $t = ql_llm_extract(['provider' => 'gemni', 'key' => 'k', 'model' => 'm'], 'p', [], [], 'x');
  ok(!$t['ok'], 'a TYPO\'d provider fails');
  eq('  and names the typo instead of silently billing the default', $t['error'], 'llm_unknown_provider:gemni');
  eq('every provider in the list is routable', ql_llm_providers(), ['anthropic', 'gemini']);
}

/* ══════════ 10. THE CALLER IS OFF THE NETWORK ══════════
   extract.php must not know a provider URL exists. If a second call site ever
   hardcodes one, this is what catches it. */
{
  $ex = file_get_contents(__DIR__ . '/extract.php');
  ok(strpos($ex, 'curl_init') === false, 'extract.php contains NO curl — the adapter owns the network');
  ok(strpos($ex, 'anthropic.com') === false, '  and no hardcoded Anthropic URL (the original bug)');
  ok(strpos($ex, 'googleapis.com') === false, '  and no hardcoded Google URL either');
  ok(strpos($ex, 'ql_llm_extract(') !== false, '  it goes through the one entry point');
  ok(strpos($ex, "require __DIR__ . '/llm.php'") !== false, '  and requires the adapter');

  /* The key must never be logged, on any path. */
  ok(!preg_match("/error_log\([^)]*\\\$llm\['key'\]/", $ex), 'the key is never written to the error log');
  ok(!preg_match("/error_log\([^)]*key/i", file_get_contents(__DIR__ . '/llm.php')),
    '  nor anywhere in llm.php');

  /* Sanity: no OTHER api file quietly talks to a provider directly. */
  foreach (glob(__DIR__ . '/*.php') as $f) {
    if (basename($f) === 'llm.php' || substr(basename($f), -9) === '.test.php') continue;
    $s = file_get_contents($f);
    ok(strpos($s, 'api.anthropic.com') === false && strpos($s, 'generativelanguage.googleapis.com') === false,
      basename($f) . ' does not talk to a model provider directly — llm.php is the only door');
  }
}

/* ══════════ 11. THE DEFAULT MODEL FOLLOWS THE PROVIDER ══════════
   Setting LLM_PROVIDER=gemini without LLM_MODEL must not send an Anthropic model
   name to Google — that is a 404 that reads exactly like a bad key. */
{
  $db = file_get_contents(__DIR__ . '/db.php');
  ok(strpos($db, "'LLM_PROVIDER'") !== false, 'db.php reads LLM_PROVIDER from config');
  ok(preg_match('/fallbackModel\s*=\s*\[[^\]]*gemini/', $db),
    'the default model is provider-aware — gemini has its own fallback');
  ok(!preg_match("/'model'\s*=>\s*\(string\)\(\\\$c\['LLM_MODEL'\] \?\? 'claude-sonnet-5'\)/", $db),
    '  the old flat claude-sonnet-5 default is gone');

  /* An empty model on Gemini still resolves to something valid rather than a URL
     with an empty path segment. */
  $g = ql_llm_build_gemini(['provider' => 'gemini', 'key' => 'k', 'model' => ''], 'p', [], [], 'x');
  ok(strpos($g['url'], 'gemini-2.5-flash:generateContent') !== false,
    'an empty model still produces a valid Gemini URL, not models/:generateContent');
}

echo "\n" . ($fail ? '❌ FAILED' : '✅ PASSED') . " — Passed: $pass · Failed: $fail\n\n";
exit($fail ? 1 : 0);
