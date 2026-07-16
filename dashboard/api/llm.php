<?php
/* ═══════════════════════════════════════════════════════════════════════
   llm.php — one interface, many providers.

   extract.php was hardcoded to Anthropic: the URL, the auth header and the
   request shape all baked into one function. So a Gemini key sent to
   api.anthropic.com fails no matter how valid it is — which is exactly where the
   owner was stuck. His key was right; the endpoint was wrong. This is the seam.

   ONE CALL, ql_llm_extract($llm, $prompt, $images, $schema, $toolName), returning
   the SAME shape whatever is behind it:

       ['ok' => bool, 'data' => array|null, 'error' => string, 'http' => int,
        'usage' => ['input_tokens' => int, 'output_tokens' => int]|null,
        'provider' => string, 'model' => string]

   The point of the seam is not elegance — it is that `data` comes back identical
   from every provider, so extract.php never learns which one answered. A second
   provider slots in as one build + one parse function, not a rewrite of the caller.

   STRUCTURED AS BUILD → SEND → PARSE, on purpose. The two halves that can actually
   be wrong (the request we construct, the response we read) are PURE functions with
   no curl in them, so llm.test.php drives the real code with real fixtures and
   stubs nothing. Anything that can only be tested by mocking the network is
   generally a thing that will be tested by nobody.

   ON THE AQ. KEY FORMAT: Google moved AI Studio from `AIza` keys to `AQ.`
   authentication keys — a platform-wide change, not an account restriction. Both
   are valid; the client just has to send them as a header. We do not sniff the
   prefix and we do not validate the shape: a key is whatever the provider says it
   is, and guessing its format is how a working key gets rejected. (It is also how
   I sent the owner back to Google three times for a key that was already correct.)

   THE KEY NEVER TOUCHES A URL. Gemini accepts ?key= as a query parameter — do not
   use it. Query strings land in access logs, proxy logs and browser history. The
   x-goog-api-key header does not. Same reason x-api-key is a header for Anthropic.
   ═══════════════════════════════════════════════════════════════════════ */

/* Provider is explicit config, never inferred from the key's shape. */
function ql_llm_provider($llm) {
  $p = strtolower(trim((string)($llm['provider'] ?? '')));
  /* Unset config on an existing install means the historical behaviour: Anthropic.
     Guessing from the key prefix would be clever and wrong — a provider can change
     its format under you, which is the whole reason this file exists. */
  return $p !== '' ? $p : 'anthropic';
}

function ql_llm_providers() { return ['anthropic', 'gemini']; }

/* ═══════════ ANTHROPIC ═══════════
   Unchanged behaviour: this is the request that shipped, lifted out of extract.php
   so the working path cannot regress while Gemini is added beside it. */
function ql_llm_build_anthropic($llm, $prompt, $images, $schema, $toolName) {
  $content = [['type' => 'text', 'text' => $prompt]];
  foreach ($images as $im) {
    $content[] = ['type' => 'image', 'source' => [
      'type' => 'base64', 'media_type' => $im['media'], 'data' => $im['b64']]];
  }
  return [
    'url' => 'https://api.anthropic.com/v1/messages',
    'headers' => ['content-type: application/json', 'anthropic-version: 2023-06-01',
      'x-api-key: ' . $llm['key']],
    'payload' => [
      'model' => $llm['model'], 'max_tokens' => 2000,
      'tools' => [['name' => $toolName,
        'description' => 'Return the invoice fields exactly as printed.',
        'input_schema' => $schema]],
      'tool_choice' => ['type' => 'tool', 'name' => $toolName],
      'messages' => [['role' => 'user', 'content' => $content]],
    ],
  ];
}

function ql_llm_parse_anthropic($out, $toolName) {
  foreach (($out['content'] ?? []) as $blk) {
    if (($blk['type'] ?? '') === 'tool_use' && ($blk['name'] ?? '') === $toolName) {
      return ['ok' => true, 'data' => $blk['input'] ?? null, 'error' => '', 'usage' => [
        'input_tokens' => (int)($out['usage']['input_tokens'] ?? 0),
        'output_tokens' => (int)($out['usage']['output_tokens'] ?? 0)]];
    }
  }
  /* A refusal or a max_tokens stop returns 200 with no tool_use. Name it, rather
     than reporting the same "bad response" for a truncation and a refusal. */
  $stop = (string)($out['stop_reason'] ?? '');
  return ['ok' => false, 'data' => null, 'usage' => null,
    'error' => $stop && $stop !== 'tool_use' ? 'ai_no_result:' . $stop : 'ai_bad_response'];
}

/* ═══════════ GEMINI ═══════════
   Same job, different vocabulary: function_declarations instead of tools,
   inline_data instead of image blocks, and the answer lands in
   candidates[0].content.parts[].functionCall.args instead of a tool_use block. */
function ql_llm_build_gemini($llm, $prompt, $images, $schema, $toolName) {
  $parts = [['text' => $prompt]];
  foreach ($images as $im) {
    $parts[] = ['inline_data' => ['mime_type' => $im['media'], 'data' => $im['b64']]];
  }
  $model = $llm['model'] !== '' ? $llm['model'] : 'gemini-2.5-flash';
  return [
    /* The key rides in a HEADER, never in ?key= — a query string lands in access
       logs and proxies. Google accepts both; only one of them is safe. */
    'url' => 'https://generativelanguage.googleapis.com/v1beta/models/'
      . rawurlencode($model) . ':generateContent',
    'headers' => ['content-type: application/json', 'x-goog-api-key: ' . $llm['key']],
    'payload' => [
      'contents' => [['role' => 'user', 'parts' => $parts]],
      'tools' => [['function_declarations' => [[
        'name' => $toolName,
        'description' => 'Return the invoice fields exactly as printed.',
        'parameters' => ql_llm_gemini_schema($schema),
      ]]]],
      /* mode ANY forces a function call — the equivalent of Anthropic's tool_choice.
         Without it the model may answer in prose and the caller gets nothing usable. */
      'tool_config' => ['function_calling_config' => [
        'mode' => 'ANY', 'allowed_function_names' => [$toolName]]],
      /* temperature 0: this is transcription of a printed document, not writing.
         The same bill must extract the same way twice or the books are a lottery. */
      'generationConfig' => ['temperature' => 0, 'maxOutputTokens' => 2000],
    ],
  ];
}

function ql_llm_parse_gemini($out, $toolName) {
  foreach (($out['candidates'][0]['content']['parts'] ?? []) as $part) {
    if (isset($part['functionCall']['args']) && ($part['functionCall']['name'] ?? '') === $toolName) {
      /* Gemini counts tokens under different names. Normalised here so the caller
         reports one figure and never learns which provider answered. */
      return ['ok' => true, 'data' => $part['functionCall']['args'], 'error' => '', 'usage' => [
        'input_tokens' => (int)($out['usageMetadata']['promptTokenCount'] ?? 0),
        'output_tokens' => (int)($out['usageMetadata']['candidatesTokenCount'] ?? 0)]];
    }
  }
  /* A blocked prompt returns 200 with no parts — that is not "the AI is down", and
     saying so would send someone hunting the wrong problem for an hour. */
  $why = (string)($out['promptFeedback']['blockReason'] ?? ($out['candidates'][0]['finishReason'] ?? ''));
  return ['ok' => false, 'data' => null, 'usage' => null,
    'error' => $why !== '' ? 'ai_no_result:' . $why : 'ai_bad_response'];
}

/* Gemini's schema dialect is JSON Schema minus some keywords, and it REJECTS the
   ones it does not know rather than ignoring them — so a schema Anthropic accepts
   will 400 here. The real differences:
     · additionalProperties is not supported and must be stripped
     · a union type ['string','null'] must collapse to its non-null member,
       with nullable:true carrying the rest of the meaning
     · type names are UPPERCASE
   Recursive, because the invoice schema nests lineItems. */
function ql_llm_gemini_schema($s) {
  if (!is_array($s)) return $s;
  $out = [];
  foreach ($s as $k => $v) {
    if ($k === 'additionalProperties') continue;
    /* `properties` is a map of FIELD NAMES to schemas — the names are data, not
       keywords. Recursing into it blindly means a field called "type" (or "enum",
       or "required") gets read as the keyword and mangled. Recurse the VALUES;
       never interpret the keys. */
    if ($k === 'properties' && is_array($v)) {
      $props = [];
      foreach ($v as $name => $sub) $props[$name] = ql_llm_gemini_schema($sub);
      $out['properties'] = $props;
      continue;
    }
    if ($k === 'type') {
      if (is_array($v)) {
        $nonNull = array_values(array_filter($v, function ($t) { return $t !== 'null'; }));
        $out['type'] = strtoupper((string)($nonNull[0] ?? 'STRING'));
        /* ['string','null'] means "a string, or absent". Dropping the null half
           silently would tell Gemini every field is mandatory, and a model told a
           field is mandatory INVENTS one — the exact fabrication the prompt spends
           three sentences forbidding. */
        if (count($nonNull) !== count($v)) $out['nullable'] = true;
      } else {
        $out['type'] = strtoupper((string)$v);
      }
      continue;
    }
    $out[$k] = is_array($v) ? ql_llm_gemini_schema($v) : $v;
  }
  return $out;
}

/* ═══════════ the transport, shared ═══════════
   One retry on a transient failure; a 4xx is a bad key or a bad request and
   retrying it just burns the user's quota twice. The key is never logged. */
function ql_llm_http($url, $headers, $payload, $timeout = 70) {
  $attempt = 0; $lastErr = ''; $lastCode = 0;
  while ($attempt < 2) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_POST => true,
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_TIMEOUT => $timeout,
      CURLOPT_HTTPHEADER => $headers,
      CURLOPT_POSTFIELDS => json_encode($payload),
    ]);
    $res = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($code === 200 && $res) return [200, $res, ''];
    $lastCode = $code; $lastErr = 'HTTP ' . $code . ($err ? ' ' . $err : '');
    if ($code === 429 || $code >= 500 || $code === 0) { $attempt++; usleep(700000); continue; }
    break;
  }
  return [$lastCode, null, $lastErr];
}

/* ═══════════ the one entry point every caller uses ═══════════ */
function ql_llm_extract($llm, $prompt, $images, $schema, $toolName) {
  $p = ql_llm_provider($llm);
  $model = (string)($llm['model'] ?? '');
  $fail = function ($err, $http) use ($p, $model) {
    return ['ok' => false, 'data' => null, 'error' => $err, 'http' => $http,
      'usage' => null, 'provider' => $p, 'model' => $model];
  };

  if ((string)($llm['key'] ?? '') === '') return $fail('llm_not_configured', 0);
  /* An unknown provider is a config typo. Say WHICH, rather than falling back to a
     default and having someone wonder for a week why 'gemni' bills Anthropic. */
  if (!in_array($p, ql_llm_providers(), true)) return $fail('llm_unknown_provider:' . $p, 0);

  $req = $p === 'gemini'
    ? ql_llm_build_gemini($llm, $prompt, $images, $schema, $toolName)
    : ql_llm_build_anthropic($llm, $prompt, $images, $schema, $toolName);

  list($code, $res, $err) = ql_llm_http($req['url'], $req['headers'], $req['payload']);
  if ($code !== 200 || !$res) return $fail($err !== '' ? $err : 'ai_unavailable', $code);

  $out = json_decode($res, true);
  if (!is_array($out)) return $fail('ai_bad_response', 200);

  $r = $p === 'gemini' ? ql_llm_parse_gemini($out, $toolName) : ql_llm_parse_anthropic($out, $toolName);
  /* Every return path carries the same keys — a caller that has to check whether a
     field exists is a caller that will forget to. */
  $r['http'] = 200; $r['provider'] = $p; $r['model'] = $model;
  return $r;
}
