<?php
/* POST /api/plant.php — edit a company profile (v1 "Edit profile").
   { p_plant_id, p_plant_name, p_gst_number, p_owner_name, p_contact_phone,
     p_city, p_address, token }
   The target plant must belong to the token's account (itself or a child).
   GSTIN and mobile are REQUIRED (a blank GSTIN mis-files every uploaded bill).
   All logic is in ql_plant_update (db.php), unit-tested in company.test.php. */
require __DIR__ . '/db.php';
ql_cors();

$b   = ql_body();
$ctx = ql_token_ctx('');                       // any valid token for this account
$r   = ql_plant_update(ql_db(), $ctx, $b);
ql_out($r['body'], $r['code']);
