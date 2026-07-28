<?php
/* move.test.php — proves the `move` action's SQL against a REAL MySQL using the
   production schema for `discovered`.

   Moving rows rewrites real data, so reading the statement is not enough: this
   runs it and checks what happened to every row. Needs a throwaway MySQL; it
   SKIPS (exit 0) when there is none, so a normal test run is unaffected.

     mysqld --initialize-insecure --datadir=/tmp/qlmy
     mysqld --datadir=/tmp/qlmy --port=3399 --socket=/tmp/qlmy.sock &
     php move.test.php
*/

try {
  $pdo = new PDO('mysql:host=127.0.0.1;port=3399;charset=utf8mb4', 'root', '', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 3]);
} catch (Throwable $e) {
  echo "⏭  SKIPPED — no scratch MySQL on port 3399 (see the header for how to start one)
";
  exit(0);
}

$pdo->exec('DROP DATABASE IF EXISTS qlmovetest');
$pdo->exec('CREATE DATABASE qlmovetest');
$pdo->exec('USE qlmovetest');

/* the production schema, copied verbatim from db.php */
$pdo->exec("CREATE TABLE discovered (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  plant_id    VARCHAR(64)  NOT NULL,
  company_id  VARCHAR(96)  NOT NULL DEFAULT '',
  source      VARCHAR(24)  NOT NULL DEFAULT 'google',
  place_id    VARCHAR(190) DEFAULT NULL,
  name        VARCHAR(190) NOT NULL,
  name_key    VARCHAR(190) NOT NULL DEFAULT '',
  industry    VARCHAR(32)  NOT NULL DEFAULT '',
  address     VARCHAR(255) DEFAULT NULL,
  city        VARCHAR(120) DEFAULT NULL,
  phone       VARCHAR(32)  DEFAULT NULL,
  website     VARCHAR(190) DEFAULT NULL,
  rating      DECIMAL(2,1) DEFAULT NULL,
  lat         DECIMAL(10,7) DEFAULT NULL,
  lng         DECIMAL(10,7) DEFAULT NULL,
  fit_score   INT          DEFAULT NULL,
  status      VARCHAR(16)  NOT NULL DEFAULT 'new',
  dupe_of     VARCHAR(190) DEFAULT NULL,
  query       VARCHAR(190) DEFAULT NULL,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_co (plant_id, company_id, status),
  UNIQUE KEY uq_place (plant_id, company_id, place_id),
  KEY idx_namekey (plant_id, company_id, name_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

$PLANT = 'plantA'; $OTHER_PLANT = 'plantB';
$FROM  = '09f9dca7-6069-42cd-aa58-fa3d0fb97e88';   // where the user's 200 sit
$TO    = 'cfc9dce8-7f85-4344-a2c7-20ad17ce27ce';   // DESHWALI MINERALS
$THIRD = 'third-company';

$ins = $pdo->prepare('INSERT INTO discovered (plant_id, company_id, place_id, name, name_key) VALUES (?,?,?,?,?)');
for ($i = 1; $i <= 200; $i++) $ins->execute([$PLANT, $FROM, 'pl' . $i, 'Biz ' . $i, 'biz' . $i]);
$ins->execute([$PLANT, $TO, 'plDUP', 'Already here', 'dup']);        // target already holds plDUP
$ins->execute([$PLANT, $FROM, 'plDUP', 'Same place', 'dup']);        // 201st source row: will collide
$ins->execute([$PLANT, $THIRD, 'plX', 'Third co', 'x']);             // same plant, another company
for ($i = 1; $i <= 5; $i++) $ins->execute([$OTHER_PLANT, $FROM, 'op' . $i, 'Other plant ' . $i, 'op']);

$fail = 0;
function ok($c, $m) { global $fail; if ($c) echo "  ok  $m\n"; else { $fail++; echo "  ❌  $m\n"; } }

$count = function ($p, $c) use ($pdo) {
  $q = $pdo->prepare('SELECT COUNT(*) FROM discovered WHERE plant_id = ? AND company_id = ?');
  $q->execute([$p, $c]); return (int)$q->fetchColumn();
};

echo "\n=== move: the real SQL, the real schema ===\n";
ok($count($PLANT, $FROM) === 201, 'setup: 201 rows under the source company');
ok($count($PLANT, $TO) === 1,     'setup: 1 row already under the target');
ok($count($OTHER_PLANT, $FROM) === 5, 'setup: 5 rows under the SAME company id in another plant');

/* ── the statement discover.php runs ── */
$up = $pdo->prepare('UPDATE IGNORE discovered SET company_id = ? WHERE plant_id = ? AND company_id = ?');
$up->execute([$TO, $PLANT, $FROM]);
$moved = (int)$up->rowCount();
$left  = $count($PLANT, $FROM);

echo "\n  moved={$moved} left_behind={$left}\n\n";
ok($moved === 200, 'exactly the 200 non-colliding rows moved');
ok($count($PLANT, $TO) === 201, '  the target now holds its original row + the 200');
ok($left === 1, '  the colliding row is LEFT BEHIND, not deleted');

$q = $pdo->prepare("SELECT name FROM discovered WHERE plant_id = ? AND company_id = ? AND place_id = 'plDUP'");
$q->execute([$PLANT, $TO]);
ok($q->fetchColumn() === 'Already here', '  and the target keeps ITS row, not the incoming duplicate');

ok($count($OTHER_PLANT, $FROM) === 5, 'the other plant is untouched (tenant isolation holds)');
ok($count($PLANT, $THIRD) === 1, 'a third company in the same plant is untouched');

$tot = (int)$pdo->query('SELECT COUNT(*) FROM discovered')->fetchColumn();
ok($tot === 208, 'nothing was destroyed: 208 rows in, 208 rows out');

echo "\n" . ($fail ? "❌ FAILED — $fail\n" : "✅ PASSED — move is scoped, lossless and duplicate-safe\n") . "\n";
$pdo->exec('DROP DATABASE qlmovetest');
exit($fail ? 1 : 0);
