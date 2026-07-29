<?php
/* files.test.php — the document store's contract.

   Loads the REAL helpers (QL_FILES_LIB), so the id/path rules tested here are
   the ones production runs — no drifting copies. The SQL is exercised against
   a throwaway MySQL (port 3399) with the real schema fn; SKIPS cleanly when
   none is running. The endpoint pipeline (auth, mime, caps) is pinned at
   source level, including ORDER: the id must be validated before any path is
   built from it. */

define('QL_FILES_LIB', 1);
require __DIR__ . '/files.php';

$fail = 0;
function ok($c, $m) { global $fail; if ($c) echo "  ok  $m\n"; else { $fail++; echo "  ❌  $m\n"; } }
/* The path checks below create real directories for their hostile inputs.
   Sweep on EVERY exit path — including the no-MySQL skip — so a test run never
   leaves litter that could be committed. */
function sweep() { foreach (glob(__DIR__ . '/files/*', GLOB_ONLYDIR) as $d) { @array_map('unlink', glob("$d/*")); @rmdir($d); } }
register_shutdown_function('sweep');

echo "\n=== document ids become filenames — hostile ids must die first ===\n";
foreach (['../../etc/passwd', 'a/b', 'a\\b', 'UPPER1', 'short', str_repeat('a', 65), "abc\0def", 'has.dot', ''] as $bad)
  ok(!ql_doc_id_ok($bad), 'refused: ' . json_encode(substr($bad, 0, 20)));
foreach (['sa1a2b3c', 'pab4quwz09', str_repeat('z', 64)] as $good)
  ok(ql_doc_id_ok($good), 'accepted: ' . $good);

echo "\n=== even hostile plant/company ids cannot escape the files dir ===\n";
$base = realpath(__DIR__) . '/files/';
foreach ([['../..', '../../x'], ["p\0x", 'co'], ['ok-plant', '../../../etc']] as [$p, $c]) {
  $path = ql_doc_path($p, $c, 'sa1a2b3c');
  ok(strpos($path, $base) === 0 && strpos($path, '..') === false, 'contained: ' . json_encode($p) . ' / ' . json_encode($c));
}

echo "\n=== pipeline order + caps (source pins) ===\n";
$src = file_get_contents(__FILE__ === null ? '' : __DIR__ . '/files.php');
ok(strpos($src, "ql_role_can(\$ctx['role'], 'sales') && !ql_role_can(\$ctx['role'], 'purchase')") !== false,
  'auth requires the sales or purchase capability');
$putBlk = substr($src, strpos($src, "if (\$action === 'put')"), 1400);
ok(strpos($putBlk, 'ql_doc_id_ok') < strpos($putBlk, 'ql_doc_path'), 'the id is validated BEFORE a path is built from it');
ok(strpos($putBlk, 'in_array($mime, QL_DOC_MIMES, true)') !== false, 'mime whitelist enforced');
ok(strpos($putBlk, 'QL_DOC_B64_MAX') !== false, 'size cap enforced');
ok(strpos($putBlk, "base64_decode(\$data, true)") !== false, 'strict base64 (junk is refused, not silently mangled)');
ok(strpos($src, 'Require all denied') !== false, 'the files dir is written with a deny-all .htaccess');
ok((bool)preg_match('/get.{0,400}plant_id = \? AND company_id = \? AND doc_id = \?/s', $src), 'get is tenant-scoped');
ok((bool)preg_match('/DELETE FROM doc_files WHERE plant_id = \? AND company_id = \? AND doc_id = \?/', $src), 'del is tenant-scoped');

echo "\n=== the SQL, against a real MySQL ===\n";
try {
  $pdo = new PDO('mysql:host=127.0.0.1;port=3399;charset=utf8mb4', 'root', '', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 3]);
} catch (Throwable $e) {
  echo "⏭  SKIPPED — no scratch MySQL on 3399; id/path/pipeline checks above still count\n";
  echo $fail ? "\n❌ FAILED — $fail\n" : "\n✅ PASSED (sql skipped)\n";
  exit($fail ? 1 : 0);
}
$pdo->exec('DROP DATABASE IF EXISTS qlfiles'); $pdo->exec('CREATE DATABASE qlfiles'); $pdo->exec('USE qlfiles');
ql_files_table($pdo);                                    // the REAL schema fn

$put = $pdo->prepare('INSERT INTO doc_files (plant_id, company_id, doc_id, name, kind, mime, size)
    VALUES (?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE name = VALUES(name), kind = VALUES(kind), mime = VALUES(mime), size = VALUES(size)');
ok(strpos($src, 'ON DUPLICATE KEY UPDATE name = VALUES(name), kind = VALUES(kind), mime = VALUES(mime), size = VALUES(size)') !== false,
  'harness upsert matches files.php verbatim (drift guard)');

$put->execute(['pA', 'c1', 'sa1a2b3c', 'inv.pdf', 'Invoice', 'application/pdf', 100]);
$put->execute(['pA', 'c1', 'sa1a2b3c', 'inv2.pdf', 'Invoice', 'application/pdf', 200]);   // re-upload = update
$put->execute(['pB', 'c1', 'sa1a2b3c', 'other.pdf', 'Invoice', 'application/pdf', 300]);  // other tenant, same id
$n = (int)$pdo->query("SELECT COUNT(*) FROM doc_files")->fetchColumn();
ok($n === 2, "re-upload updates, other tenant is separate (rows: $n)");
$q = $pdo->prepare('SELECT name, size FROM doc_files WHERE plant_id = ? AND company_id = ? AND doc_id = ? LIMIT 1');
$q->execute(['pA', 'c1', 'sa1a2b3c']); $r = $q->fetch(PDO::FETCH_ASSOC);
ok($r['name'] === 'inv2.pdf' && (int)$r['size'] === 200, '  and the update took the new metadata');
$d = $pdo->prepare('DELETE FROM doc_files WHERE plant_id = ? AND company_id = ? AND doc_id = ?');
$d->execute(['pA', 'c1', 'sa1a2b3c']);
$q->execute(['pA', 'c1', 'sa1a2b3c']);
ok($q->fetch() === false, 'delete removes the scoped row');
$q->execute(['pB', 'c1', 'sa1a2b3c']);
ok($q->fetch() !== false, "  and the other tenant's row survives");

echo "\n=== file roundtrip through the real path builder ===\n";
$p = ql_doc_path('test-plant', 'test-co', 'sa1a2b3c');
file_put_contents($p, 'BYTES');
ok(file_get_contents($p) === 'BYTES', 'write + read through ql_doc_path');
ok(is_file(realpath(__DIR__) . '/files/.htaccess'), '  the deny-all .htaccess exists beside it');
unlink($p); @rmdir(dirname($p));

$pdo->exec('DROP DATABASE qlfiles');
echo $fail ? "\n❌ FAILED — $fail\n" : "\n✅ PASSED — ids die before paths, tenants are walled, uploads round-trip\n";
exit($fail ? 1 : 0);
