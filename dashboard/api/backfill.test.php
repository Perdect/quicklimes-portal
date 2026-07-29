<?php
/* backfill.test.php — proves the backfillLeads SQL against a REAL MySQL with
   the production schema. Rewrites nothing in the user's data: runs on a
   throwaway server (port 3399) and SKIPS cleanly when none is running.

     mysqld --initialize-insecure --datadir=/tmp/qlmy && \
     mysqld --datadir=/tmp/qlmy --port=3399 --socket=/tmp/qlmy.sock &
     php backfill.test.php

   What it must prove:
     1. every company without a lead gains exactly one stage-'new' lead
     2. a company that already has a lead gains nothing
     3. another tenant's companies are untouched
     4. a second run creates zero (idempotent)                                */

try {
  $pdo = new PDO('mysql:host=127.0.0.1;port=3399;charset=utf8mb4', 'root', '', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 3]);
} catch (Throwable $e) {
  echo "⏭  SKIPPED — no scratch MySQL on port 3399 (see the header for how to start one)\n";
  exit(0);
}
$pdo->exec('DROP DATABASE IF EXISTS qlbftest'); $pdo->exec('CREATE DATABASE qlbftest'); $pdo->exec('USE qlbftest');

/* production schema, trimmed to the columns the statements touch */
$pdo->exec("CREATE TABLE crm_companies (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  plant_id VARCHAR(64) NOT NULL, company_id VARCHAR(96) NOT NULL DEFAULT '',
  name VARCHAR(190) NOT NULL) ENGINE=InnoDB");
$pdo->exec("CREATE TABLE crm_leads (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  plant_id VARCHAR(64) NOT NULL, company_id VARCHAR(96) NOT NULL DEFAULT '',
  crm_company BIGINT NOT NULL, stage VARCHAR(24) NOT NULL DEFAULT 'new',
  score INT DEFAULT NULL, score_why TEXT) ENGINE=InnoDB");

$P = 'plantA'; $C = 'co-1'; $OTHER = 'plantB';
$ic = $pdo->prepare('INSERT INTO crm_companies (plant_id, company_id, name) VALUES (?,?,?)');
$ic->execute([$P, $C, 'Has a lead']);      $withLead = (int)$pdo->lastInsertId();
$ic->execute([$P, $C, 'Orphan one']);      $o1 = (int)$pdo->lastInsertId();
$ic->execute([$P, $C, 'Orphan two']);      $o2 = (int)$pdo->lastInsertId();
$ic->execute([$OTHER, $C, 'Other tenant orphan']);
$pdo->prepare('INSERT INTO crm_leads (plant_id, company_id, crm_company, stage) VALUES (?,?,?,?)')
    ->execute([$P, $C, $withLead, 'quoted']);

$fail = 0;
function ok($c, $m) { global $fail; if ($c) echo "  ok  $m\n"; else { $fail++; echo "  ❌  $m\n"; } }

/* ── the statements crm.php runs, verbatim ── */
function runBackfill($pdo, $plantId, $coId) {
  $ins = $pdo->prepare("INSERT INTO crm_leads (plant_id, company_id, crm_company, stage, score_why)
    SELECT c.plant_id, c.company_id, c.id, 'new', 'Backfilled: promoted before pipeline rows existed'
      FROM crm_companies c
      LEFT JOIN crm_leads l ON l.crm_company = c.id AND l.plant_id = c.plant_id AND l.company_id = c.company_id
     WHERE c.plant_id = ? AND c.company_id = ? AND l.id IS NULL");
  $ins->execute([$plantId, $coId]);
  return $ins->rowCount();
}

echo "\n=== backfillLeads: the real SQL, the real schema ===\n";
/* DRIFT GUARD: the harness runs a copy of crm.php's statements. A copy that
   drifts proves nothing, so both statements must appear in crm.php verbatim. */
$live = file_get_contents(__DIR__ . '/crm.php');
ok(strpos($live, 'LEFT JOIN crm_leads l ON l.crm_company = c.id AND l.plant_id = c.plant_id AND l.company_id = c.company_id') !== false
   && strpos($live, "WHERE c.plant_id = ? AND c.company_id = ? AND l.id IS NULL") !== false,
   'the harness SQL matches crm.php verbatim (drift guard)');
/* One statement, not SELECT-then-loop: two concurrent clicks must not both
   read "no lead yet" and both insert. */
ok(strpos($live, 'INSERT INTO crm_leads (plant_id, company_id, crm_company, stage, score_why)
    SELECT c.plant_id') !== false, 'backfill is a single INSERT..SELECT (no read-then-write race)');
$n1 = runBackfill($pdo, $P, $C);
ok($n1 === 2, "first run creates exactly the two orphans (created $n1)");
$q = $pdo->prepare("SELECT stage, score FROM crm_leads WHERE crm_company = ?"); $q->execute([$o1]);
$r = $q->fetch(PDO::FETCH_ASSOC);
ok($r && $r['stage'] === 'new' && $r['score'] === null, '  each lands at stage new, unscored (no invented figure)');
$q2 = $pdo->prepare("SELECT COUNT(*) FROM crm_leads WHERE crm_company = ?"); $q2->execute([$withLead]);
ok((int)$q2->fetchColumn() === 1, '  the company that had a lead still has exactly one');
$q3 = $pdo->prepare("SELECT COUNT(*) FROM crm_leads WHERE plant_id = ?"); $q3->execute([$OTHER]);
ok((int)$q3->fetchColumn() === 0, 'the other tenant gained nothing');
$n2 = runBackfill($pdo, $P, $C);
ok($n2 === 0, "a second run creates zero — idempotent (created $n2)");

echo "\n" . ($fail ? "❌ FAILED — $fail\n" : "✅ PASSED — backfill is scoped, honest and idempotent\n") . "\n";
$pdo->exec('DROP DATABASE qlbftest');
exit($fail ? 1 : 0);
