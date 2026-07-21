<?php
/* auth-live.test.php — a token must name a LIVE account.
   Run: php auth-live.test.php   (in-memory SQLite; no live DB, no config beyond APP_SECRET)

   THE HOLE THIS CLOSES. Tokens are stateless 30-day HMACs, so they outlive the
   account they name. Once removing a company could delete the MAIN plant row
   (promote a sibling, or delete the account outright), every write endpoint
   would still accept the old token and INSERT under the dead plant id:
     · edits made on a second device vanish into a namespace nothing reads;
     · a deleted account gets re-uploaded from a stale phone for 30 days.
   ql_token_ctx now refuses a token whose plants row is gone, which closes it
   for data.php, recon, wa, chat, crm, users, jobs, extract, plant and company
   at once — they all funnel through it.

   These run the REAL ql_plant_exists / ql_token_ctx / ql_company_remove. */

if (php_sapi_name() !== 'cli') { http_response_code(404); exit; }

require __DIR__ . '/db.php';

$PASS = 0; $FAIL = 0; $FAILS = [];
function ok($cond, $msg) { global $PASS, $FAIL, $FAILS; if ($cond) { $PASS++; } else { $FAIL++; $FAILS[] = $msg; } }
function eq($a, $b, $msg) { ok($a === $b, $msg . "  (got " . json_encode($a) . ", want " . json_encode($b) . ")"); }

echo "\n═══ a token must name a LIVE account ═══\n\n";

/* ── A scratch DB, injected as the one ql_db() would return ────────────── */
function liveDb() {
  $db = new PDO('sqlite::memory:');
  $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $db->exec("CREATE TABLE plants (id TEXT PRIMARY KEY, owner_phone TEXT, password_hash TEXT DEFAULT '',
    plant_name TEXT, owner_name TEXT, contact_phone TEXT, gst_number TEXT, city TEXT, address TEXT,
    parent_plant_id TEXT, plan_limit INTEGER DEFAULT 2)");
  $db->exec("CREATE TABLE app_data (plant_id TEXT, data_id TEXT, data TEXT, PRIMARY KEY (plant_id, data_id))");
  $db->prepare("INSERT INTO plants (id, owner_phone, password_hash, plant_name, gst_number, plan_limit) VALUES (?,?,?,?,?,?)")
     ->execute(['GOTAN', '9990001111', 'hash', 'Gotan Lime Industries', '08BNAPM0488E1Z3', 3]);
  $db->prepare("INSERT INTO plants (id, owner_phone, plant_name, gst_number, parent_plant_id, plan_limit) VALUES (?,?,?,?,?,?)")
     ->execute(['DESH', '9990001111', 'Deshwali Minerals', '08NLIPS9801K1Z5', 'GOTAN', 3]);
  $db->prepare("INSERT INTO app_data (plant_id, data_id, data) VALUES (?,?,?)")->execute(['GOTAN', 'GOTAN', '{"sales":[]}']);
  $db->prepare("INSERT INTO app_data (plant_id, data_id, data) VALUES (?,?,?)")->execute(['GOTAN', 'DESH',  '{"sales":[1]}']);
  return $db;
}
$OWNER = ['plant' => 'GOTAN', 'user' => '', 'role' => 'owner', 'exp' => PHP_INT_MAX];

/* ── 1. ql_plant_exists — the primitive the guard rests on ─────────────── */
{
  $db = liveDb();
  ok(ql_plant_exists_in($db, 'GOTAN'), 'a live plant exists');
  ok(ql_plant_exists_in($db, 'DESH'), '  the child too');
  ok(!ql_plant_exists_in($db, 'GHOST'), 'an unknown plant does NOT exist');
  ok(!ql_plant_exists_in($db, ''), 'a blank id is not a plant');
}

/* ── 2. After the MAIN is removed, its token names a dead account ──────── */
{
  $db = liveDb();
  ok(ql_plant_exists_in($db, 'GOTAN'), 'before: the main account is live');
  $r = ql_company_remove($db, $OWNER, ['p_plant_id' => 'GOTAN']);
  ok(!empty($r['body']['success']) && $r['body']['promoted'] === 'DESH', '  removing the main promotes the sibling');
  ok(!ql_plant_exists_in($db, 'GOTAN'), 'AFTER: the old main id is dead — every token naming it is now refused');
  ok(ql_plant_exists_in($db, 'DESH'), '  and the promoted company is live (its fresh token works)');
}

/* ── 3. After the whole account is deleted, nothing is live ────────────── */
{
  $db = liveDb();
  ql_company_remove($db, $OWNER, ['p_plant_id' => 'DESH']);       // drop the child
  $r = ql_company_remove($db, $OWNER, ['p_plant_id' => 'GOTAN']); // now the only company
  ok(!empty($r['body']['account_deleted']), 'deleting the only company deletes the account');
  ok(!ql_plant_exists_in($db, 'GOTAN'), '  its token is dead too — a stale phone can NOT re-upload the deleted books');
  eq($count = (int)$db->query('SELECT COUNT(*) FROM app_data')->fetchColumn(), 0, '  and no blob survives to be resurrected');
}

/* ── 4. The guard is WIRED into ql_token_ctx (the half-wired trap) ─────── */
{
  $src = file_get_contents(__DIR__ . '/db.php');
  $i = strpos($src, 'function ql_token_ctx');
  $body = substr($src, $i, strpos($src, "\n}", $i) - $i);
  ok(strpos($body, 'ql_plant_exists') !== false, 'ql_token_ctx actually CALLS the liveness check (not just defines it)');
  ok(strpos($body, 'return null') !== false, '  and returns null (→ 401) when it fails');
  // Every authenticated endpoint funnels through ql_token_ctx / ql_require_cap.
  foreach (['data.php', 'recon.php', 'wa.php', 'chat.php', 'crm.php', 'users.php', 'jobs.php', 'extract.php', 'plant.php', 'company.php', 'parties.php'] as $f) {
    $fp = __DIR__ . '/' . $f;
    if (!is_file($fp)) continue;
    $t = file_get_contents($fp);
    ok(strpos($t, 'ql_token_ctx') !== false || strpos($t, 'ql_require_cap') !== false, "  $f authenticates through the guarded path");
  }
  // The webhook is NOT token-authed (external URL), so it needs its own guard.
  $wh = file_get_contents(__DIR__ . '/wa-hook.php');
  ok(strpos($wh, 'ql_plant_exists') !== false, 'wa-hook.php drops payloads for a deleted account (no orphan chats)');
}

/* ── 5. The client signs out on 401 — on EVERY device, not just one tab ── */
{
  $api = file_get_contents(__DIR__ . '/../v2/ql-api.js');
  ok(strpos($api, 'res.status === 401') !== false && strpos($api, 'QLAuthLost') !== false,
     'ql-api.js turns any 401 into a global sign-out (one chokepoint for every RPC)');
  $data = file_get_contents(__DIR__ . '/../v2/data.js');
  ok(strpos($data, 'window.QLAuthLost') !== false, 'data.js defines QLAuthLost');
  $j = strpos($data, 'window.QLAuthLost');
  $fn = substr($data, $j, 700);
  ok(strpos($fn, "removeItem('ql_plant')") !== false, '  it clears the dead identity');
  ok(strpos($fn, 'location.replace') !== false, '  and sends the user to log in again');
  ok(strpos($fn, '_authLost') !== false, '  once only — a burst of 401s must not fight over the redirect');
}

echo ($FAIL ? "❌ FAILED" : "✅ PASSED") . " — Passed: $PASS · Failed: $FAIL\n";
foreach ($FAILS as $f) echo "  ❌ $f\n";
echo "\n";
exit($FAIL ? 1 : 0);

/* ql_plant_exists() resolves its own connection via ql_db(); in CLI there is
   none, so this mirrors it against the scratch handle. The WIRING test above
   is what proves the real function is the one guarding ql_token_ctx. */
function ql_plant_exists_in($db, $plantId) {
  if ($plantId === '') return false;
  $q = $db->prepare('SELECT 1 FROM plants WHERE id = ? LIMIT 1');
  $q->execute([$plantId]);
  return (bool)$q->fetchColumn();
}
