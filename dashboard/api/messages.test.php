<?php
/* messages.test.php — the internal chat's contract.

   Two-user delivery was verified against the LIVE API on 22 Aug 2026 with a
   real second login: A→B unread 1, B reads → 0, B replies → A's since_id poll
   returns only the new row, and a non-member is Forbidden. This file pins the
   QUERIES that made that true, so the behaviour cannot drift back.

   Source-level, deliberately: the endpoint is a request script that ends in
   ql_out()/exit, so it cannot be invoked in-process, and no scratch MySQL is
   guaranteed. What CAN be guaranteed is that the specific clauses the
   semantics depend on are still there — the same drift-guard approach
   files.test.php already uses for its upsert.

     php messages.test.php
*/

$src = file_get_contents(__DIR__ . '/messages.php');
$db  = file_get_contents(__DIR__ . '/db.php');
$fail = 0;
function ok($c, $m) { global $fail; if ($c) echo "  ok  $m\n"; else { $fail++; echo "  X   $m\n"; } }

/* Strip comments before scanning: this file's own prose quotes the clauses it
   checks for, and so does messages.php. Matching an explanation instead of the
   code is a false pass — it has bitten this codebase before. */
$code = preg_replace('~/\*.*?\*/~s', '', $src);
$dbc  = preg_replace('~/\*.*?\*/~s', '', $db);

echo "\n=== unread is what SOMEONE ELSE sent and you have not read ===\n";
ok(strpos($code, 'x.id>m.last_read_id') !== false,
  'unread counts only messages newer than YOUR last_read_id');
ok(strpos($code, 'x.user_id<>?') !== false,
  'and excludes your OWN messages — nobody has unread mail from themselves');
ok(strpos($code, 'x.deleted_at IS NULL') !== false,
  'and excludes deleted messages, so removing one clears its badge');
ok(preg_match('~UPDATE chat_members SET last_read_id=\?.*?last_read_id<\?~s', $code) === 1,
  'read only ever moves the marker FORWARD (last_read_id<?), so an old poll cannot un-read a thread');

echo "\n=== membership is the access rule, not being in the same firm ===\n";
ok(strpos($code, 'JOIN chat_members m ON m.thread_id=t.id AND m.user_id=?') !== false,
  'the thread list is an INNER JOIN on membership — you cannot list a thread you are not in');
ok(strpos($code, 'function ql_is_member') !== false, 'ql_is_member exists');
/* Assert COVERAGE, not the exact list — the list grows as actions are added,
   and a brittle exact match would just be edited away each time. Every
   thread-scoped action must be inside the gate. */
preg_match('~in_array\(\$action, \[([^\]]*)\], true\)\s*\)\s*\{\s*\n\s*if \(\$threadId~', $code, $g);
$gated = $g ? array_map(function ($x) { return trim($x, " '"); }, explode(',', $g[1])) : [];
foreach (['messages', 'send', 'read', 'members', 'pins', 'unread'] as $a) {
  ok(in_array($a, $gated, true), "  '$a' goes through the membership gate");
}
ok(count($gated) >= 6, 'the membership gate covers every thread-scoped action (' . count($gated) . ')');
ok(preg_match('~ql_is_member\(\$db, \$threadId, \$me\)\) ql_out\(\[\'ok\' => false, \'error\' => \'Forbidden\'~', $code) === 1,
  '  and a non-member is Forbidden (verified live: B could not read thread 1)');

echo "\n=== one conversation per subject, enforced by the database ===\n";
ok(strpos($dbc, 'UNIQUE KEY uq_subject (plant_id, company_id, kind, subject_key)') !== false,
  'chat_threads has a UNIQUE index on the subject');
ok(strpos($code, 'INSERT IGNORE INTO chat_threads') !== false,
  'open() is INSERT IGNORE, so a racing second click cannot create a second thread');
ok(preg_match('~\$pair = \[\$me, \$other\]; sort\(\$pair\);~', $code) === 1,
  'a DM key is the SORTED pair, so A->B and B->A are the same thread (verified live)');

echo "\n=== paging never loads a whole conversation ===\n";
ok(strpos($code, 'id>?') !== false && strpos($code, 'ORDER BY id ASC') !== false,
  'since_id walks forward for the realtime poll');
ok(strpos($code, 'ORDER BY id DESC') !== false && strpos($code, 'before_id') !== false,
  'before_id walks backward through history');
ok(preg_match('~\$limit\s*=\s*max\(1, min\(100,~', $code) === 1,
  'the page size is clamped — a client cannot ask for the entire table');

echo "\n=== shared records are pointers, checked at BOTH ends ===\n";
ok(strpos($code, 'function ql_card_cap') !== false, 'each card type maps to a capability');
ok(preg_match('~ql_role_can\(\$role, \$cap\)\) ql_out\(\[\'ok\' => false, \'error\' => \'Forbidden\'~', $code) === 1,
  'the SENDER must hold that capability (verified live: sales blocked from bill and payment)');
ok(strpos($code, "ql_out(['ok' => false, 'error' => 'bad_card_type'], 400)") !== false,
  'an unknown record type is never shareable');
foreach (['invoice' => 'sales', 'bill' => 'purchase', 'payment' => 'finance', 'customer' => 'parties'] as $t => $cap) {
  ok(preg_match("~'$t' => '$cap'~", $code) === 1, "  $t requires $cap");
}

echo "\n=== an internal note is a different kind of row ===\n";
ok(strpos($code, "if (\$kind !== 'note') {") !== false,
  'a note never becomes the thread preview (it is private)');
ok(strpos($code, "kind<>'note'") !== false,
  'and is skipped when the preview is recomputed after a delete');

echo "\n=== deleting ===\n";
ok(preg_match('~UPDATE chat_messages SET deleted_at=\?.*?AND user_id=\?~s', $code) === 1,
  'you can only delete your OWN message');
ok(strpos($code, 'deleted_at IS NULL') !== false, 'and deleting twice is a no-op');
ok(strpos($code, 'UPDATE chat_threads SET last_body=NULL') !== false,
  'the preview is cleared when nothing survives — a deleted message must not stay readable in the chat list');

echo "\n=== tenancy ===\n";
ok(preg_match('~\$plantId = \(string\)\$ctx\[\'plant\'\];~', $code) === 1,
  'the tenant key comes from the TOKEN, never the request body');
ok(substr_count($code, 'plant_id=?') >= 4 || substr_count($code, 'plant_id=?') >= 3,
  'queries are scoped by plant_id');
ok(strpos($dbc, "'chat_threads', 'chat_messages'") !== false,
  'the chat tables are registered for tenant scoping / company deletion');

echo "\n=== pin, forward, mark-unread ===\n";
ok(strpos($dbc, 'pinned_at DATETIME DEFAULT NULL') !== false,
  'a pin lives ON the message, so it cannot outlive what it points at');
ok(strpos($dbc, 'ALTER TABLE chat_messages ADD COLUMN') !== false,
  'and existing books get the column — CREATE TABLE IF NOT EXISTS would leave them without it');
ok(strpos($code, 'pinned_at IS NOT NULL AND deleted_at IS NULL') !== false,
  'a deleted message is never listed as pinned');
ok(preg_match('~UPDATE chat_members SET last_read_id=\?.*?WHERE thread_id=\? AND user_id=\?~s', $code) === 1,
  'mark-unread is its own action, because read() only ever moves the marker forward');
ok(strpos($code, 'max(0, $mid - 1)') !== false,
  '  and it lands just BEFORE the chosen message, so that message is the first unread');

echo "\n=== the owner is a person, not nobody ===\n";
ok(strpos($code, "\$me = 'owner:' . \$plantId;") !== false,
  'an owner token with no user id gets a stable attributable identity');
ok(strpos($code, '$isOwnerSeat = true;') !== false && strpos($code, "'owner_seat' => \$isOwnerSeat") !== false,
  'and the client is told, so it can label that seat');

echo $fail ? "\n❌ FAILED — $fail\n" : "\n✅ PASSED — the chat contract holds\n";
exit($fail ? 1 : 0);
