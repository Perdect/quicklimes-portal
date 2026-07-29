<?php
/* POST /api/company.php — self-service company management.

   Adds or removes a company under the caller's OWN account, authenticated by
   the owner's login token (not the APP_SECRET the admin bootstrap needs). The
   "Add company" button in the app switcher used to be a dead stub ("contact
   support"); this is what makes it real — and it REQUIRES a valid GSTIN so a
   company can never again be created without the one field that tells its sales
   from its purchases.

     add:    { action:'add', p_plant_name, p_gst_number, p_city?, p_address?, token }
             → { success:true, plant:{…} }
     remove: { action:'remove', p_plant_id, token }
             → { success:true, id }
     On bad input / plan limit / not-yours: HTTP 200 { error:"…" } so the UI
     shows the message (matches login.php / signup.php / plant.php convention).

   All logic lives in db.php (ql_company_add / ql_company_remove), driven
   end-to-end by company.test.php against an in-memory DB. */
require __DIR__ . '/db.php';
ql_cors();

$b   = ql_body();
$ctx = ql_token_ctx('');                               // any valid token for this account
$act = (string)($b['action'] ?? 'add');

$r = ($act === 'remove')
  ? ql_company_remove(ql_db(), $ctx, $b)
  : ql_company_add(ql_db(), $ctx, $b);

ql_out($r['body'], $r['code']);
