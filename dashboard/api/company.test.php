<?php
/* company.test.php — self-service Add / Remove company, driven end-to-end.
   Run: php company.test.php   (no live DB, no config — uses in-memory SQLite).

   The whole flow (auth guards, GSTIN rule, plan limit, one-GSTIN-per-firm,
   primary-vs-child resolution, the actual INSERT/DELETE and blob cleanup)
   runs through the REAL ql_company_add / ql_company_remove in db.php against a
   throwaway SQLite that mirrors the plants + app_data tables. Nothing is
   re-implemented here, so the test cannot quietly drift from the endpoint. */

if (php_sapi_name() !== 'cli') { http_response_code(404); exit; }

require __DIR__ . '/db.php';

$PASS = 0; $FAIL = 0; $FAILS = [];
function ok($cond, $msg) { global $PASS, $FAIL, $FAILS; if ($cond) { $PASS++; } else { $FAIL++; $FAILS[] = $msg; } }
function eq($a, $b, $msg) { ok($a === $b, $msg . "  (got " . json_encode($a) . ", want " . json_encode($b) . ")"); }

/* A fresh account each time: primary GOTAN + one child DESHWALI, plan_limit 3
   (room to add one more), and a data blob for each company. */
function freshDb($limit = 3) {
  $db = new PDO('sqlite::memory:');
  $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $db->exec("CREATE TABLE plants (id TEXT PRIMARY KEY, owner_phone TEXT, password_hash TEXT DEFAULT '',
    plant_name TEXT, owner_name TEXT, contact_phone TEXT, gst_number TEXT, city TEXT, address TEXT,
    parent_plant_id TEXT, plan_limit INTEGER DEFAULT 2)");
  $db->exec("CREATE TABLE app_data (plant_id TEXT, data_id TEXT, data TEXT, PRIMARY KEY (plant_id, data_id))");
  $db->prepare("INSERT INTO plants (id, owner_phone, password_hash, plant_name, gst_number, plan_limit) VALUES (?,?,?,?,?,?)")
     ->execute(['GOTAN', '9990001111', 'hash', 'Gotan Lime Industries', '08BNAPM0488E1Z3', $limit]);
  $db->prepare("INSERT INTO plants (id, owner_phone, plant_name, gst_number, parent_plant_id, plan_limit) VALUES (?,?,?,?,?,?)")
     ->execute(['DESH', '9990001111', 'Deshwali Minerals', '', 'GOTAN', $limit]);   // child, GSTIN blank (the bug)
  $db->prepare("INSERT INTO app_data (plant_id, data_id, data) VALUES (?,?,?)")->execute(['GOTAN', 'GOTAN', '{"sales":[]}']);
  $db->prepare("INSERT INTO app_data (plant_id, data_id, data) VALUES (?,?,?)")->execute(['GOTAN', 'DESH',  '{"sales":[1]}']);
  return $db;
}
// Every add needs the now-mandatory fields; helper keeps the older cases terse.
function addInput($over = []) { return array_merge(['p_plant_name' => 'New Lime Co', 'p_gst_number' => '08AABCG1234H1Z5', 'p_contact_phone' => '9876543210'], $over); }
$OWNER = ['plant' => 'GOTAN', 'user' => '', 'role' => 'owner', 'exp' => PHP_INT_MAX];
$count = function ($db, $sql, $args = []) { $s = $db->prepare($sql); $s->execute($args); return (int)$s->fetchColumn(); };

echo "\n═══ Self-service Add / Remove company ═══\n\n";

/* ══════════ GSTIN rule agrees with signup.php ══════════ */
{
  ok(ql_gstin_valid('08BNAPM0488E1Z3'), 'a real GSTIN is accepted');
  ok(!ql_gstin_valid('08BNAPM0488E1Z'), 'a 14-char GSTIN is rejected');
  ok(!ql_gstin_valid('99BNAPM0488E1Z3'), 'an out-of-range state code (99) is rejected');
  ok(!ql_gstin_valid(''), 'blank is rejected');
  ok(ql_gstin_valid(' 08bnapm0488e1z3 '), 'spaces + lowercase are normalised, then accepted');
  // Drift guard: the endpoint's rule must match the one signup.php enforces.
  $sign = file_get_contents(__DIR__ . '/signup.php');
  ok(strpos($sign, '/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/') !== false,
     'signup.php still uses the SAME GSTIN regex (else the two would disagree)');
}

/* ══════════ ADD — the happy path ══════════ */
{
  $db = freshDb();
  $r = ql_company_add($db, $OWNER, addInput(['p_city' => 'Jodhpur', 'p_owner_name' => 'Sameer', 'p_contact_phone' => '9876543210']));
  eq($r['code'], 200, 'add returns 200');
  ok(!empty($r['body']['success']), 'add succeeds');
  $newId = $r['body']['plant']['id'] ?? '';
  ok($newId !== '', '  a new id is returned');
  eq($count($db, 'SELECT COUNT(*) FROM plants WHERE id = ? AND parent_plant_id = ?', [$newId, 'GOTAN']), 1, '  the company is a CHILD of the account');
  eq($r['body']['plant']['gst_number'], '08AABCG1234H1Z5', '  it carries the GSTIN it was given');
  eq($r['body']['plant']['owner_phone'], '9990001111', '  and inherits the account phone (so it logs in under the same account)');
  // The new profile fields are stored, not dropped.
  $row = $db->prepare('SELECT owner_name, contact_phone FROM plants WHERE id = ?'); $row->execute([$newId]); $got = $row->fetch(PDO::FETCH_ASSOC);
  eq($got['owner_name'], 'Sameer', '  the manager/owner name is stored');
  eq($got['contact_phone'], '9876543210', '  the company mobile is stored (separate from the login phone)');
}

/* ══════════ ADD — mobile is mandatory ══════════ */
{
  $db = freshDb();
  $r = ql_company_add($db, $OWNER, addInput(['p_contact_phone' => '']));
  ok(empty($r['body']['success']) && strpos($r['body']['error'], 'Mobile number is required') !== false, 'a blank mobile is refused');
  $r2 = ql_company_add($db, $OWNER, addInput(['p_contact_phone' => '123']));
  ok(empty($r2['body']['success']) && strpos($r2['body']['error'], 'doesn’t look right') !== false, 'a too-short mobile is refused');
  eq($count($db, 'SELECT COUNT(*) FROM plants', []), 2, '  nothing was written');
}

/* ══════════ ADD — GSTIN is mandatory and validated ══════════ */
{
  $db = freshDb();
  $r = ql_company_add($db, $OWNER, ['p_plant_name' => 'No GST Co', 'p_gst_number' => '']);
  ok(empty($r['body']['success']) && strpos($r['body']['error'], 'GSTIN is required') !== false, 'a blank GSTIN is REFUSED (the whole point)');
  eq($count($db, 'SELECT COUNT(*) FROM plants', []), 2, '  nothing was written');

  $r2 = ql_company_add($db, $OWNER, ['p_plant_name' => 'Bad GST Co', 'p_gst_number' => '08BNAPM0488E1Z']);
  ok(empty($r2['body']['success']) && strpos($r2['body']['error'], 'doesn’t look right') !== false, 'a malformed GSTIN is refused');

  $r3 = ql_company_add($db, $OWNER, ['p_plant_name' => 'A', 'p_gst_number' => '08AABCG1234H1Z5']);
  ok(empty($r3['body']['success']) && strpos($r3['body']['error'], 'name is required') !== false, 'a 1-char name is refused');
}

/* ══════════ ADD — one GSTIN per firm ══════════ */
{
  $db = freshDb();
  // DESH's GSTIN is blank; set it, then adding a company with the same GSTIN must clash.
  $db->prepare('UPDATE plants SET gst_number = ? WHERE id = ?')->execute(['08AABCG1234H1Z5', 'DESH']);
  $r = ql_company_add($db, $OWNER, addInput(['p_plant_name' => 'Dup Co']));
  ok(empty($r['body']['success']) && strpos($r['body']['error'], 'already exists') !== false, 'a GSTIN already in the account is refused');
}

/* ══════════ ADD — plan limit ══════════ */
{
  $db = freshDb(2);                                    // plan of 2, already holding GOTAN + DESH
  $r = ql_company_add($db, $OWNER, addInput(['p_plant_name' => 'Third Co']));
  ok(empty($r['body']['success']) && strpos($r['body']['error'], 'plan allows 2') !== false, 'at the plan limit, add is refused with a clear message');
  eq($count($db, 'SELECT COUNT(*) FROM plants', []), 2, '  and nothing is written');
}

/* ══════════ ADD — auth guards ══════════ */
{
  $db = freshDb();
  eq(ql_company_add($db, null, ['p_plant_name' => 'X', 'p_gst_number' => '08AABCG1234H1Z5'])['code'], 401, 'no token → 401');
  eq(ql_company_add($db, ['plant' => 'GOTAN', 'role' => 'clerk'], ['p_plant_name' => 'X', 'p_gst_number' => '08AABCG1234H1Z5'])['code'], 403, 'a non-owner role → 403');
}

/* ══════════ REMOVE — a child, with its data ══════════ */
{
  $db = freshDb();
  $r = ql_company_remove($db, $OWNER, ['p_plant_id' => 'DESH']);
  ok(!empty($r['body']['success']), 'removing a child company succeeds');
  eq($count($db, 'SELECT COUNT(*) FROM plants WHERE id = ?', ['DESH']), 0, '  the company row is gone');
  eq($count($db, 'SELECT COUNT(*) FROM app_data WHERE data_id = ?', ['DESH']), 0, '  its financial blob is gone');
  eq($count($db, 'SELECT COUNT(*) FROM app_data WHERE data_id = ?', ['GOTAN']), 1, '  the OTHER company\'s data is untouched');
}

/* ══════════ REMOVE — the MAIN company: the sibling is promoted ══════════
   Owner's rule: "if user want to delete they can delete." Removing the main
   company must NOT be refused — the other company inherits the login and every
   account-keyed row, atomically, and the old main goes. */
{
  $db = freshDb();
  // Give each company distinct data so we can prove what moved and what died.
  $db->prepare("INSERT INTO plants (id, owner_phone, plant_name, parent_plant_id, plan_limit) VALUES (?,?,?,?,?)")
     ->execute(['THIRD', '9990001111', 'Zinc Works', 'GOTAN', 3]);   // a second sibling, sorts after Deshwali
  $r = ql_company_remove($db, $OWNER, ['p_plant_id' => 'GOTAN']);
  ok(!empty($r['body']['success']), 'removing the MAIN company succeeds');
  eq($r['body']['promoted'], 'DESH', '  the first sibling (by name) is promoted');
  $row = $db->prepare('SELECT password_hash, plan_limit, parent_plant_id FROM plants WHERE id = ?'); $row->execute(['DESH']); $g = $row->fetch(PDO::FETCH_ASSOC);
  eq($g['password_hash'], 'hash', '  the login (password hash) moved to the new main');
  eq((int)$g['plan_limit'], 3, '  the plan moved too');
  ok($g['parent_plant_id'] === null || $g['parent_plant_id'] === '', '  the new main is the family root');
  $row2 = $db->prepare('SELECT parent_plant_id FROM plants WHERE id = ?'); $row2->execute(['THIRD']); $g2 = $row2->fetch(PDO::FETCH_ASSOC);
  eq($g2['parent_plant_id'], 'DESH', '  the other sibling is re-parented under the new main');
  eq($count($db, 'SELECT COUNT(*) FROM plants WHERE id = ?', ['GOTAN']), 0, '  the old main row is gone');
  eq($count($db, 'SELECT COUNT(*) FROM app_data WHERE plant_id = ? AND data_id = ?', ['DESH', 'DESH']), 1, '  the survivor\'s books moved to the new key');
  eq($count($db, 'SELECT COUNT(*) FROM app_data WHERE data_id = ?', ['GOTAN']), 0, '  the removed company\'s books are gone');
  eq($count($db, 'SELECT COUNT(*) FROM app_data WHERE plant_id = ?', ['GOTAN']), 0, '  nothing is left under the old key');
}
/* explicit promote target — and it must be one of OUR companies */
{
  $db = freshDb();
  $r = ql_company_remove($db, $OWNER, ['p_plant_id' => 'GOTAN', 'p_promote_id' => 'DESH']);
  ok(!empty($r['body']['success']) && $r['body']['promoted'] === 'DESH', 'an explicit promote target is honoured');
  $db2 = freshDb();
  $r2 = ql_company_remove($db2, $OWNER, ['p_plant_id' => 'GOTAN', 'p_promote_id' => 'OUTSIDER']);
  eq($r2['code'], 403, 'promoting a company outside the account → 403');
  eq($count($db2, 'SELECT COUNT(*) FROM plants WHERE id = ?', ['GOTAN']), 1, '  and nothing was touched');
}
/* ══════════ REMOVE — the ONLY company = account deletion ══════════ */
{
  $db = freshDb();
  ql_company_remove($db, $OWNER, ['p_plant_id' => 'DESH']);            // drop the child first
  $r = ql_company_remove($db, $OWNER, ['p_plant_id' => 'GOTAN']);      // now the only company
  ok(!empty($r['body']['success']) && !empty($r['body']['account_deleted']), 'removing the only company deletes the account (the user\'s right)');
  eq($count($db, 'SELECT COUNT(*) FROM plants', []), 0, '  the login row is gone');
  eq($count($db, 'SELECT COUNT(*) FROM app_data', []), 0, '  and every blob with it');
}

/* ══════════ REMOVE — never another account's company ══════════ */
{
  $db = freshDb();
  // A second, unrelated account with its own child.
  $db->prepare("INSERT INTO plants (id, owner_phone, password_hash, plant_name, plan_limit) VALUES (?,?,?,?,?)")->execute(['OTHER', '8887776666', 'h', 'Rival Co', 3]);
  $db->prepare("INSERT INTO plants (id, owner_phone, plant_name, parent_plant_id, plan_limit) VALUES (?,?,?,?,?)")->execute(['OTHERKID', '8887776666', 'Rival Child', 'OTHER', 3]);
  $r = ql_company_remove($db, $OWNER, ['p_plant_id' => 'OTHERKID']);   // GOTAN's owner tries to nuke a rival's company
  eq($r['code'], 403, 'removing another account\'s company → 403');
  eq($count($db, 'SELECT COUNT(*) FROM plants WHERE id = ?', ['OTHERKID']), 1, '  the rival\'s company is untouched');
}

/* ══════════ REMOVE — auth guards ══════════ */
{
  $db = freshDb();
  eq(ql_company_remove($db, null, ['p_plant_id' => 'DESH'])['code'], 401, 'no token → 401');
  eq(ql_company_remove($db, ['plant' => 'GOTAN', 'role' => 'clerk'], ['p_plant_id' => 'DESH'])['code'], 403, 'a non-owner role → 403');
}

/* ══════════ EDIT PROFILE (ql_plant_update) ══════════ */
$upd = function ($over = []) { return array_merge(['p_plant_id' => 'DESH', 'p_plant_name' => 'Deshwali Minerals', 'p_gst_number' => '08NLIPS9801K1Z5', 'p_contact_phone' => '9876500000'], $over); };
{
  $db = freshDb();
  $r = ql_plant_update($db, $OWNER, $upd(['p_owner_name' => 'Kayyum', 'p_city' => 'Merta City']));
  ok(!empty($r['body']['success']), 'edit: a valid profile saves');
  $row = $db->prepare('SELECT gst_number, owner_name, contact_phone, city FROM plants WHERE id = ?'); $row->execute(['DESH']); $g = $row->fetch(PDO::FETCH_ASSOC);
  eq($g['gst_number'], '08NLIPS9801K1Z5', '  the GSTIN is written (Deshwali finally gets an identity)');
  eq($g['owner_name'], 'Kayyum', '  the manager name is written');
  eq($g['contact_phone'], '9876500000', '  the mobile is written');
}
{
  $db = freshDb();
  ok(strpos(ql_plant_update($db, $OWNER, $upd(['p_gst_number' => '']))['body']['error'], 'GSTIN is required') !== false, 'edit: a blank GSTIN is refused (was optional before)');
  ok(strpos(ql_plant_update($db, $OWNER, $upd(['p_contact_phone' => '']))['body']['error'], 'Mobile number is required') !== false, 'edit: a blank mobile is refused');
  ok(strpos(ql_plant_update($db, $OWNER, $upd(['p_plant_name' => 'A']))['body']['error'], 'name is required') !== false, 'edit: a 1-char name is refused');
}
{
  $db = freshDb();
  // editing to a GSTIN already used by the sibling (GOTAN) must clash
  $r = ql_plant_update($db, $OWNER, $upd(['p_gst_number' => '08BNAPM0488E1Z3']));
  ok(strpos($r['body']['error'], 'already exists') !== false, 'edit: reusing a sibling\'s GSTIN is refused (one firm per GSTIN)');
}
{
  $db = freshDb();
  eq(ql_plant_update($db, null, $upd())['code'], 401, 'edit: no token → 401');
  eq(ql_plant_update($db, ['plant' => 'GOTAN', 'role' => 'clerk'], $upd())['code'], 403, 'edit: a non-owner role → 403');
  eq(ql_plant_update($db, ['plant' => 'GOTAN', 'role' => 'owner'], $upd(['p_plant_id' => 'OUTSIDER']))['code'], 403, 'edit: a plant outside the account → 403');
}

echo ($FAIL ? "❌ FAILED" : "✅ PASSED") . " — Passed: $PASS · Failed: $FAIL\n";
foreach ($FAILS as $f) echo "  ❌ $f\n";
echo "\n";
exit($FAIL ? 1 : 0);
