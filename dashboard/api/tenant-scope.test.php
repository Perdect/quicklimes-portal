<?php
/* tenant-scope.test.php — the tenant key never comes from the request.

   WHY THIS EXISTS. Two independent defects made one hole:

     1. ql_token_ctx('') skipped the plant comparison entirely, so a request
        that simply OMITTED plant_id passed auth with any valid token.
     2. Every endpoint then used that same request-supplied value as the scope
        key for its SQL — and, in files.php, for a filesystem path.

   Together: one missing field addressed a namespace shared by every tenant on
   the server, readable and writable by anyone with a login.

   Both halves are now closed, and BOTH are pinned here, because either one
   alone would be enough to reopen it. Static analysis, no DB needed. */

$API = __DIR__;
$fail = 0;
function ok($c, $m) { global $fail; if ($c) echo "  ok  $m\n"; else { $fail++; echo "  ❌  $m\n"; } }

echo "\n=== half 1: an explicit empty plant id is refused ===\n";
$db = file_get_contents("$API/db.php");
ok(strpos($db, "if (func_num_args() > 0 && \$plantId === '') return null;") !== false,
  'ql_token_ctx rejects an EXPLICIT empty plant id');
/* company.php and plant.php legitimately mean "any valid token for this
   account" — they must ask with NO argument, or they break. */
foreach (['company.php', 'plant.php'] as $f) {
  $s = file_get_contents("$API/$f");
  ok(strpos($s, "ql_token_ctx('')") === false && strpos($s, 'ql_token_ctx()') !== false,
    "  $f asks with no argument (the deliberate any-plant case)");
}

echo "\n=== half 2: every endpoint re-derives the tenant from the token ===\n";
/* Endpoints that scope rows by plant. company/plant/onboard are excluded on
   purpose: they are account-level and hold no plant-scoped tables. */
$SCOPED = ['chat.php', 'crm.php', 'data.php', 'discover.php', 'extract.php',
           'files.php', 'freight.php', 'jobs.php', 'users.php', 'wa.php'];
foreach ($SCOPED as $f) {
  $s = file_get_contents("$API/$f");
  $derive = strpos($s, "\$plantId = (string)\$ctx['plant'];");
  ok($derive !== false, "$f derives \$plantId from the token context");
  if ($derive === false) continue;

  /* ORDER MATTERS: a body read AFTER the derivation would silently win. */
  $bodyReads = [];
  foreach (["\$plantId = (string)(\$b['plant_id']", "\$plantId = (string)(\$b['p_plant_id']",
            "\$plantId = (string)(\$_GET['plant_id']"] as $pat) {
    $off = 0;
    while (($p = strpos($s, $pat, $off)) !== false) { $bodyReads[] = $p; $off = $p + 1; }
  }
  $lastDerive = strrpos($s, "\$plantId = (string)\$ctx['plant'];");
  $after = array_filter($bodyReads, fn($p) => $p > $lastDerive);
  ok(count($after) === 0, "  …and never re-reads it from the request afterwards");
}

echo "\n=== no endpoint queries app_data with a request-supplied plant ===\n";
$d = file_get_contents("$API/data.php");
/* data.php holds the whole business blob — both verbs must be covered. */
ok(substr_count($d, "\$plantId = (string)\$ctx['plant'];") >= 2,
  'data.php derives the tenant in BOTH the GET and the POST path');

echo $fail ? "\n❌ FAILED — $fail\n" : "\n✅ PASSED — the tenant key is the token's, everywhere\n";
exit($fail ? 1 : 0);
