<?php
/* POST /api/maintenance.php — ONE-OFF, to be deleted after use.

   Raises the CALLER'S OWN account family limit from 2 to 3 so a demo company
   ("Gotan Lime DEMO") can be added beside the two real firms. Guarded by the
   owner's login token — no APP_SECRET, no cross-account reach: it can only
   ever touch the family the valid token belongs to, and only in one
   direction (2 → 3). Idempotent: a second call reports the current state.

     { op:'demo-plan', token } → { success:true, plan_limit:3 }                */
require __DIR__ . '/db.php';
ql_cors();

$b   = ql_body();
$ctx = ql_token_ctx();
if (!$ctx)                           ql_out(['error' => 'Unauthorized'], 401);
if (!ql_role_can($ctx['role'], '*')) ql_out(['error' => 'Forbidden'], 403);   // owner only
if ((string)($b['op'] ?? '') !== 'demo-plan') ql_out(['error' => 'Unknown op'], 200);

$db   = ql_db();
$acct = ql_account_primary($db, $ctx['plant']);
if (!$acct) ql_out(['error' => 'Account not found'], 404);
$primaryId = $acct[0]; $limit = $acct[2];

if ($limit < 3) {
  $db->prepare('UPDATE plants SET plan_limit = 3 WHERE id = ? OR parent_plant_id = ?')
     ->execute([$primaryId, $primaryId]);
  $limit = 3;
}
ql_out(['success' => true, 'plan_limit' => $limit], 200);
