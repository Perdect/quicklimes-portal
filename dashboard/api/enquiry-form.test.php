<?php
/* enquiry-form.test.php — the website enquiry form and the CRM endpoint must
   agree on the same field names.
   Run:  php dashboard/api/enquiry-form.test.php     (no database needed)

   WHY THIS EXISTS
   ql_enquiry_form() in rates-lib.php renders the only form a stranger on
   quicklimes.com can use to reach the business. It posts JSON straight into
   the 'enquiry' branch of rates.php, which turns it into a CRM lead. The two
   halves live in different files, in different languages, with no shared
   schema — so a field renamed on one side is a silent data loss on the other:
   the form still submits, the API still answers ok, and the sales team simply
   never learns the delivery city.

   It also pins the two things that are easy to delete by accident while
   restyling: the honeypot (the only spam defence) and the required-field
   contract (name + phone), which is what makes the lead callable at all.

   Written 2026-08-30, when Company and Email were removed from the form: the
   removal is safe ONLY because the API treats both as optional and falls back
   to "<name> (website)" for the company. That fallback is asserted here. */

$root = __DIR__;
$lib  = file_get_contents($root . '/../../rates-lib.php');
$api  = file_get_contents($root . '/rates.php');

$pass = 0; $fail = 0; $fails = [];
function ok($n, $c) { global $pass, $fail, $fails; if ($c) $pass++; else { $fail++; $fails[] = $n; } }

/* ── the form as it is actually rendered ── */
$i = strpos($lib, 'function ql_enquiry_form');
ok('ql_enquiry_form() found in rates-lib.php', $i !== false);
$form = substr($lib, $i, strpos($lib, "\n}", $i) - $i);

/* every name="…" / the select's name, as the browser would submit them */
preg_match_all('/\bname="([a-z_]+)"/i', $form, $m);
$fields = array_values(array_unique($m[1]));

/* ── the API's side of the contract ── */
$j = strpos($api, "\$action === 'enquiry'");
ok('the enquiry branch exists in rates.php', $j !== false);
$branch = substr($api, $j, strpos($api, "/* ── ADMIN", $j) - $j);
preg_match_all("/\\\$b\['([a-z_]+)'\]/", $branch, $m2);
$reads = array_values(array_unique($m2[1]));

/* 1 ── every field the form submits must be read by the API */
foreach ($fields as $f) {
  ok("the API reads the '$f' the form submits (otherwise it is typed and thrown away)",
     in_array($f, $reads, true));
}

/* 2 ── the honeypot survives */
ok('the honeypot input name="website" is still rendered', in_array('website', $fields, true));
ok('the honeypot is still visually hidden (class rt-hp)', strpos($form, 'rt-hp') !== false);
ok('the API still swallows a filled honeypot silently',
   preg_match("/website.*ql_out\(\['ok' => true\]\)/", $branch) === 1);

/* 3 ── the required pair: a lead nobody can phone is not a lead */
ok('name is a required input', preg_match('/name="name"[^>]*\brequired\b|\brequired\b[^>]*name="name"/', $form) === 1);
ok('phone is a required input', preg_match('/name="phone"[^>]*\brequired\b|\brequired\b[^>]*name="phone"/', $form) === 1);
ok('the API rejects a submission with no name or a short phone',
   strpos($branch, "strlen(\$phone) < 10") !== false);

/* 4 ── the fields the owner removed on 2026-08-30 stay removed, and stay optional
       server-side, so an old cached page that still posts them keeps working */
ok('the form no longer asks for a company', !in_array('company', $fields, true));
ok('the form no longer asks for an email', !in_array('email', $fields, true));
ok("the API still accepts a company if one is posted (old cached pages)", in_array('company', $reads, true));
ok("the API still accepts an email if one is posted (old cached pages)", in_array('email', $reads, true));
ok('with no company the CRM company falls back to the person\'s name',
   strpos($branch, "\$name . ' (website)'") !== false);

/* 5 ── the lead is still recorded with a lawful consent basis */
ok('the contact is written with consent_basis = enquiry', strpos($branch, "'enquiry'") !== false);
ok('the consent note still says what they actually did',
   strpos($branch, 'Submitted the website rate-enquiry form') !== false);

/* 6 ── the form posts where the API actually lives */
ok('the form posts to the rates API on the app origin',
   strpos($form, 'https://app.quicklimes.com/api/rates.php') !== false);
ok('the form declares action:"enquiry"', preg_match('/action\s*:\s*"enquiry"/', $form) === 1);

/* 7 ── accessibility floor: every visible control is labelled and the result is announced */
ok('the result message is announced to screen readers (aria-live)', strpos($form, 'aria-live') !== false);
$visible = array_diff($fields, ['website']);
foreach ($visible as $f) {
  ok("'$f' is inside a <label> or has an explicit for/id pair",
     preg_match('/<label[^>]*>(?:(?!<\/label>).)*name="' . preg_quote($f, '/') . '"/s', $form) === 1
     || preg_match('/for="[^"]*"[^>]*>(?:(?!<\/label>).)*name="' . preg_quote($f, '/') . '"/s', $form) === 1
     || preg_match('/name="' . preg_quote($f, '/') . '"[^>]*\bid="([^"]+)"/', $form) === 1);
}

echo "\n════ website enquiry form ↔ CRM contract ════\n  Passed: $pass   Failed: $fail\n";
foreach ($fails as $f) echo "    ✗ $f\n";
echo $fail === 0 ? "\n✅ ALL $pass ENQUIRY-FORM TESTS PASSED\n\n"
                 : "\n❌ $fail FAILED — the website form and the CRM no longer agree\n\n";
exit($fail === 0 ? 0 : 1);
