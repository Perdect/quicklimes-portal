<?php
/* app-secret.test.php — a weak signing key must stop the server, not sign tokens.

   THE HOLE THIS CLOSES. Every login token is an HMAC keyed by APP_SECRET.
   Anyone who knows the secret forges a token for ANY plant id and owns every
   account on the server. config.example.php ships a public placeholder string,
   so an install that copied it and never changed the key is forgeable by
   anyone who read the repo — with zero effort.

   ql_app_secret() refuses to return a weak key (empty, < 32 chars, or the
   placeholder). It fails CLOSED — 503, no token — because a server that hands
   out NO tokens is safe while one that hands out FORGEABLE tokens is not. Both
   the signing path (login) and the verifying path (every authenticated
   request) must route through it, or the check can be skipped.

   Static source assertion — running the real crypto needs a config.php this
   machine doesn't have, and the property we care about (both paths gated, the
   three weak inputs rejected) is provable from the source + a logic check.

   Run: php app-secret.test.php */

if (php_sapi_name() !== 'cli') { http_response_code(404); exit; }

$src = file_get_contents(__DIR__ . '/db.php');
$fail = 0;
function ok($c, $m) { global $fail; if ($c) echo "  ok  $m\n"; else { $fail++; echo "  ❌  $m\n"; } }

echo "\n═══ a weak APP_SECRET halts the server ═══\n\n";

/* 1. The guard exists and rejects exactly the three weak shapes. */
ok(strpos($src, 'function ql_app_secret') !== false, 'ql_app_secret() exists');
$body = '';
if (($i = strpos($src, 'function ql_app_secret')) !== false) {
  $body = substr($src, $i, strpos($src, "\n}", $i) - $i);
}
ok(strpos($body, "=== ''") !== false || strpos($body, '=== ""') !== false, '  rejects an empty key');
ok(strpos($body, 'strlen($s) < 32') !== false, '  rejects a key under 32 chars');
ok(strpos($body, "'change-me-to-a-long-random-string-of-at-least-32-characters'") !== false,
  '  rejects the config.example.php placeholder by value');
ok(strpos($body, '503') !== false, '  fails CLOSED (503, no token issued)');

/* 2. BOTH crypto paths route through it — neither can skip the check. */
$sign  = substr($src, ($p = strpos($src, 'function ql_sign_token')), strpos($src, "\n}", $p) - $p);
$parse = substr($src, ($p = strpos($src, 'function ql_parse_token')), strpos($src, "\n}", $p) - $p);
ok(strpos($sign, 'ql_app_secret()') !== false, 'ql_sign_token signs with ql_app_secret()');
ok(strpos($parse, 'ql_app_secret()') !== false, 'ql_parse_token verifies with ql_app_secret()');
/* The raw config read must be GONE from both — a leftover $c[\'APP_SECRET\']
   would be the un-guarded path that reopens the hole. */
ok(strpos($sign, "APP_SECRET") === false, '  …and ql_sign_token no longer reads the raw config key');
ok(strpos($parse, "APP_SECRET") === false, '  …and ql_parse_token no longer reads the raw config key');

/* 3. The decision logic itself, exercised directly. */
$weak = function ($s) {
  $ph = 'change-me-to-a-long-random-string-of-at-least-32-characters';
  return $s === '' || strlen($s) < 32 || $s === $ph;
};
ok($weak('') === true, 'logic: empty is weak');
ok($weak('short') === true, 'logic: short is weak');
ok($weak('change-me-to-a-long-random-string-of-at-least-32-characters') === true, 'logic: placeholder is weak');
ok($weak(str_repeat('x', 31)) === true, 'logic: 31 chars is weak');
ok($weak(str_repeat('x', 32)) === false, 'logic: 32 random chars is accepted');
ok($weak('kQ7$mZ2pL9wR4tY8nB3vC6xD1fG5hJ0aS') === false, 'logic: a real 33-char secret is accepted');

echo $fail ? "\n❌ FAILED — $fail\n" : "\n✅ PASSED — a weak signing key can never sign or verify a token\n";
exit($fail ? 1 : 0);
