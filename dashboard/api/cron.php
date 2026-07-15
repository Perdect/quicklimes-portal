<?php
/* ═══════════════════════════════════════════════════════════════
   /api/cron.php — the unattended worker. Hostinger cron hits this hourly.

   Setup (hPanel → Advanced → Cron Jobs), hourly:
     curl -s "https://app.quicklimes.com/api/cron.php?key=YOUR_CRON_SECRET"
   CRON_SECRET goes in api/config.php. Blank ⇒ this endpoint refuses to run:
   it is reachable from the internet, so it fails CLOSED, never open.

   ── WHY THIS IS A DUMB PIPE ──────────────────────────────────────────────
   The rules that decide who gets chased live in wa-core.js and are unit-tested
   there. They are NOT reimplemented here. Two copies of the same rules is
   exactly how a system starts contradicting itself — the bug that filed every
   new company's sales as purchases came from precisely that kind of split.
   So the browser enqueues a concrete job (this party, this invoice, this
   step, this text) and this file only:
       1. re-checks the invoice is STILL unpaid and unchanged
       2. sends it
       3. records what happened

   ── THE FRESHNESS CHECK IS THE WHOLE POINT ───────────────────────────────
   A queued reminder is a promise about the past. If the customer paid after it
   was queued, sending it is worse than useless — it is rude, wrong, and it
   teaches them to ignore the next one. So every job is re-verified against the
   CURRENT blob at send time and dropped if the money moved. Skipping a real
   reminder costs a day. Chasing a man who already paid costs the relationship.
   ═══════════════════════════════════════════════════════════════ */
require __DIR__ . '/db.php';

header('Content-Type: text/plain; charset=utf-8');

$secret = ql_cron_secret();
if ($secret === '') { http_response_code(503); exit("cron: CRON_SECRET is not set in config.php — refusing to run\n"); }
$key = (string)($_GET['key'] ?? '');
// hash_equals: constant-time, so the secret can't be guessed a byte at a time.
if (!hash_equals($secret, $key)) { http_response_code(403); exit("cron: bad key\n"); }

$BATCH   = 40;      // per run — a burst off one unofficial WhatsApp number gets it banned
$GAP_US  = 2500000; // 2.5s between sends, same pacing as the manual bulk path
$MAX_TRY = 3;

$db  = ql_db();
$now = gmdate('Y-m-d H:i:s');

$due = $db->prepare("SELECT * FROM jobs WHERE status = 'queued' AND send_at <= ? ORDER BY send_at ASC LIMIT $BATCH");
$due->execute([$now]);
$jobs = $due->fetchAll(PDO::FETCH_ASSOC);
if (!$jobs) exit("cron: nothing due at $now\n");

$wa = ql_whapi();
if ($wa['token'] === '') exit("cron: no WhatsApp channel configured — " . count($jobs) . " job(s) left queued\n");

$sent = 0; $stale = 0; $failed = 0; $log = [];

/* Current outstanding for one invoice, straight from the live blob.
   Mirrors QLD's own rule: total − paid, and a cancelled bill owes nothing. */
function ql_invoice_state($db, $plantId, $companyId, $invNo) {
  $st = $db->prepare('SELECT data FROM app_data WHERE plant_id = ? AND data_id = ? LIMIT 1');
  $st->execute([$plantId, $companyId]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  if (!$row) return null;
  $d = json_decode($row['data'], true);
  if (!is_array($d) || !isset($d['sales']) || !is_array($d['sales'])) return null;
  foreach ($d['sales'] as $s) {
    if (!isset($s['inv']) || (string)$s['inv'] !== (string)$invNo) continue;
    // ql_sale_outstanding is shared + unit-tested (cron.test.php) so this check
    // cannot drift from what the app itself calls "still owed".
    $status = strtolower((string)($s['status'] ?? 'pending'));
    return ['found' => true, 'outstanding' => ql_sale_outstanding($s), 'why' => $status];
  }
  return ['found' => false, 'outstanding' => 0.0, 'why' => 'invoice no longer exists'];
}

foreach ($jobs as $j) {
  $p = json_decode($j['payload'], true); $p = is_array($p) ? $p : [];
  $mark = function ($status, $err = null, $pid = null) use ($db, $j) {
    $db->prepare('UPDATE jobs SET status = ?, attempts = attempts + 1, last_error = ?, provider_id = ?, done_at = ? WHERE id = ?')
       ->execute([$status, $err, $pid, gmdate('Y-m-d H:i:s'), $j['id']]);
  };

  if ($j['kind'] !== 'wa_reminder') { $mark('failed', 'unknown job kind'); $failed++; continue; }

  // ── freshness ──
  $inv = (string)($p['inv'] ?? '');
  $want = (float)($p['amount'] ?? 0);
  if ($inv !== '') {
    $state = ql_invoice_state($db, $j['plant_id'], $j['company_id'], $inv);
    if ($state === null) { $mark('stale', 'no data for this company'); $stale++; $log[] = "stale  $inv (no data)"; continue; }
    if (!$state['found'] || $state['outstanding'] <= 0.5) {
      $mark('stale', 'already settled: ' . $state['why']);
      $stale++; $log[] = "stale  $inv — {$state['why']}, not chasing";
      continue;
    }
    // Part-paid since queueing ⇒ the message names the WRONG figure. Never send
    // a number that is no longer true; the browser re-queues with a fresh one.
    if ($want > 0 && abs($state['outstanding'] - $want) > 1.0) {
      $mark('stale', 'amount changed: queued ' . round($want) . ', now ' . round($state['outstanding']));
      $stale++; $log[] = "stale  $inv — was " . round($want) . ", now " . round($state['outstanding']);
      continue;
    }
  }

  $r = ql_wa_send($wa['token'], (string)($p['to'] ?? ''), (string)($p['body'] ?? ''));
  if ($r['ok']) {
    $mark('sent', null, $r['id']); $sent++; $log[] = "sent   $inv → " . ($p['to'] ?? '');
  } elseif (!empty($r['retry']) && (int)$j['attempts'] + 1 < $MAX_TRY) {
    // Transient: back off an hour and let the next run take it.
    $db->prepare("UPDATE jobs SET attempts = attempts + 1, last_error = ?, send_at = ? WHERE id = ?")
       ->execute([$r['error'], gmdate('Y-m-d H:i:s', time() + 3600), $j['id']]);
    $log[] = "retry  $inv — " . $r['error'];
  } else {
    $mark('failed', substr((string)$r['error'], 0, 250)); $failed++; $log[] = "FAIL   $inv — " . $r['error'];
  }
  usleep($GAP_US);
}

echo "cron $now · sent=$sent stale=$stale failed=$failed of " . count($jobs) . "\n";
foreach ($log as $l) echo "  $l\n";
