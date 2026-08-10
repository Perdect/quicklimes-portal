<?php
/* data-rev.test.php — the blob store rejects a stale write instead of clobbering
   a newer one. (audit M2)   Run: php data-rev.test.php   (in-memory SQLite; no config)

   THE HOLE. save_my_data replaced the whole company row unconditionally, so two
   devices editing the same account = last-writer-wins: whoever saved second
   silently erased the other's edits. The fix gives each blob a monotonic `rev`;
   a client sends the rev it last read (base_rev) and the server refuses the
   write if the stored rev has moved past it.

   Two things are pinned:
     1. the decision + increment logic, exercised against a real (sqlite) table;
     2. that data.php actually WIRES it — the guard, the increment, AND the
        additive fallback so deploying before the column exists changes nothing. */

if (php_sapi_name() !== 'cli') { http_response_code(404); exit; }

$fail = 0;
function ok($c, $m) { global $fail; if ($c) echo "  ok  $m\n"; else { $fail++; echo "  ❌  $m\n"; } }

echo "\n═══ blob store · a stale write is rejected, not silently applied ═══\n\n";

/* ── 1. the algorithm, against a real table ───────────────────────────────
   Mirrors data.php's POST path: reject when base_rev is given and the stored
   rev is ahead; otherwise write and bump rev to stored+1. */
$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec("CREATE TABLE app_data (plant_id TEXT, data_id TEXT, data TEXT, rev INT DEFAULT 0, PRIMARY KEY (plant_id, data_id))");

$save = function ($plant, $id, $data, $baseRev) use ($db) {
  $rq = $db->prepare('SELECT rev FROM app_data WHERE plant_id=? AND data_id=?');
  $rq->execute([$plant, $id]);
  $cur = $rq->fetchColumn();
  $cur = ($cur === false) ? null : (int)$cur;
  /* A missing base_rev against an EXISTING row is a conflict, not consent:
     a client with no revision has not read this row and cannot know what it
     would destroy. Only a genuinely new row may be written without one. */
  if ($cur !== null && ($baseRev === null || $cur > $baseRev)) return ['conflict' => true, 'rev' => $cur];
  $new = ($cur === null ? 1 : $cur + 1);
  $db->prepare('INSERT INTO app_data (plant_id, data_id, data, rev) VALUES (?,?,?,?)
    ON CONFLICT(plant_id, data_id) DO UPDATE SET data=excluded.data, rev=excluded.rev')
    ->execute([$plant, $id, $data, $new]);
  return ['success' => true, 'rev' => $new];
};

// First write to a fresh row: no base, becomes rev 1.
$r = $save('P', 'CO', '{"v":1}', null);
ok(($r['rev'] ?? 0) === 1, 'first write establishes rev 1');

// Device A loaded rev 1, saves → rev 2.
$r = $save('P', 'CO', '{"v":2}', 1);
ok(($r['rev'] ?? 0) === 2 && empty($r['conflict']), 'a save from the current rev succeeds and bumps to 2');

// Device B ALSO loaded rev 1 (before A's write) and now saves → CONFLICT.
$r = $save('P', 'CO', '{"v":99}', 1);
ok(!empty($r['conflict']) && $r['rev'] === 2, 'a save from a STALE base_rev is rejected as a conflict (not applied)');

// The rejected write left the data untouched — B did not clobber A.
$cur = $db->query("SELECT data FROM app_data WHERE plant_id='P' AND data_id='CO'")->fetchColumn();
ok($cur === '{"v":2}', "  and the stored data is still device A's — no clobber");

// Device B re-pulls (now at rev 2) and retries → succeeds, rev 3.
$r = $save('P', 'CO', '{"v":3}', 2);
ok(($r['rev'] ?? 0) === 3, 'after adopting the new rev, the retry succeeds');

/* THE HOLE THAT LET A VERIFIED DELETE COME BACK.
   This once asserted that a client sending NO base_rev "is never blocked
   (backward compatible)". That waved through an unconditional whole-blob
   overwrite: a tab hydrated from localStorage rather than the cloud holds no
   revision, so it sent none, so it could silently replace a NEWER server copy
   — data, audit rows and all — while being told the save succeeded.
   Backward compatibility is not worth a silent financial rollback. A client
   with no revision has not read the row and must pull before it may write. */
$r = $save('P', 'CO', '{"v":4}', null);
ok(!empty($r['conflict']), 'a client with NO base_rev is refused on an existing row');
$cur = $db->query("SELECT data FROM app_data WHERE plant_id='P' AND data_id='CO'")->fetchColumn();
ok($cur === '{"v":3}', '  and the stored data is untouched — no silent rollback');

// A genuinely NEW row still writes without a base_rev; there is nothing to lose.
$r = $save('P', 'NEWCO', '{"v":1}', null);
ok(($r['rev'] ?? 0) === 1 && empty($r['conflict']), 'a brand-new row still writes with no base_rev');

// And the normal path still works: pull the current rev, then save.
$r = $save('P', 'CO', '{"v":5}', 3);
ok(($r['rev'] ?? 0) === 4 && empty($r['conflict']), 'after pulling rev 3, the write succeeds');

/* ── 2. data.php wires the guard, the bump, and the fallback ───────────────*/
$src = file_get_contents(__DIR__ . '/data.php');
ok(strpos($src, 'function ql_appdata_rev_ok') !== false, 'data.php has the self-migrating rev-column check');
ok(strpos($src, 'ADD COLUMN rev') !== false, '  which adds the column on first use');
ok(strpos($src, "'conflict' => true") !== false, 'the POST path returns a conflict on a stale base_rev');
ok(strpos($src, '$curRev > $baseRev') !== false, '  guarded by stored-rev > base_rev');
ok(preg_match('/rev\s*=\s*VALUES\(rev\)/', $src) === 1, 'a successful write advances the stored rev');
/* The fallback MUST remain: the original unconditional upsert, reached when the
   column isn\'t there, so deploying before the migration is a no-op. */
$post = substr($src, strpos($src, "if (\$method === 'POST')"));
ok(strpos($post, 'Fallback (no rev column yet)') !== false, 'the pre-M2 unconditional upsert survives as the fallback');
ok(strpos($post, 'if (ql_appdata_rev_ok($db)) {') !== false, '  and the rev path is taken ONLY when the column exists');

echo $fail ? "\n❌ FAILED — $fail\n" : "\n✅ PASSED — stale writes are rejected; the guard is additive and reversible\n";
exit($fail ? 1 : 0);
