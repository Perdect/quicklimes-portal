<?php
/* /api/recon.php — relational store for Bank Reconciliation (Phase 2).

   Bank transactions live in their own indexed table (bank_txns) instead of
   the per-company JSON blob, so month / status / type filtering and paging
   run in SQL and the store scales to millions of rows across multiple bank
   accounts per company. Learned party aliases and bank accounts have their
   own tables too.

   Every request is scoped by (plant_id — proven by the login token) and
   (company_id — the active firm), so an account only ever touches its own
   data. This endpoint is ADDITIVE: the app keeps working on the JSON blob
   until the front-end opts in, so shipping it cannot break anything.

   GET  ?plant_id=&company_id=[&month=YYYY-MM][&status=][&type=credit|debit]
        [&q=][&limit=500][&offset=0]
        → { txns:[…], aliases:{key:party}, accounts:[…], total }

   POST { plant_id, company_id, token, action, … }
        action = upsert_txns { txns:[…] }        bulk import / sync
               = save_txn    { txn:{…} }          one txn (match/link/split/unlink)
               = learn_alias { alias_key, party }
               = delete_txn  { id }
               = add_account { account:{…} }
*/
require __DIR__ . '/db.php';
ql_cors();
ql_ensure_tables();   // idempotent — creates the recon tables on first hit

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

/* Cast a DB numeric string to a JSON number (or null). */
function ql_num($v) { return $v === null ? null : (float)$v; }

/* Shape one bank_txns row into the front-end transaction object. */
function ql_txn_row($r) {
  return [
    'id'      => $r['id'],
    'date'    => $r['txn_date'],
    'raw'     => $r['raw'],
    'desc'    => $r['raw'],
    'clean'   => $r['clean'],
    'utr'     => $r['utr'],
    'cheque'  => $r['cheque'],
    'mode'    => $r['mode'],
    'bank'    => $r['bank'],
    'debit'   => ql_num($r['debit']),
    'credit'  => ql_num($r['credit']),
    'balance' => ql_num($r['balance']),
    'm'       => $r['m'] ? json_decode($r['m'], true) : null,
  ];
}

if ($method === 'GET') {
  $plantId   = (string)($_GET['plant_id'] ?? '');
  $companyId = (string)($_GET['company_id'] ?? '');
  if (!ql_verify_token(ql_token(), $plantId)) ql_out(['error' => 'Unauthorized'], 401);
  if ($companyId === '') ql_out(['error' => 'Missing company_id'], 400);

  $where  = 'plant_id = ? AND company_id = ?';
  $params = [$plantId, $companyId];

  $month = (string)($_GET['month'] ?? '');
  if (preg_match('/^\d{4}-\d{2}$/', $month)) { $where .= " AND DATE_FORMAT(txn_date, '%Y-%m') = ?"; $params[] = $month; }

  $status = (string)($_GET['status'] ?? '');
  if ($status !== '' && $status !== 'all') { $where .= ' AND status = ?'; $params[] = $status; }

  $type = (string)($_GET['type'] ?? '');
  if ($type === 'credit') $where .= ' AND credit > 0';
  elseif ($type === 'debit') $where .= ' AND debit > 0';

  $q = trim((string)($_GET['q'] ?? ''));
  if ($q !== '') { $like = '%' . $q . '%'; $where .= ' AND (clean LIKE ? OR raw LIKE ? OR utr LIKE ?)'; array_push($params, $like, $like, $like); }

  $db = ql_db();
  $ct = $db->prepare("SELECT COUNT(*) AS c FROM bank_txns WHERE $where");
  $ct->execute($params);
  $total = (int) $ct->fetch()['c'];

  $limit  = min(2000, max(1, (int)($_GET['limit'] ?? 500)));
  $offset = max(0, (int)($_GET['offset'] ?? 0));
  $sql = "SELECT * FROM bank_txns WHERE $where ORDER BY txn_date DESC, id DESC LIMIT $limit OFFSET $offset";
  $st = $db->prepare($sql);
  $st->execute($params);
  $txns = array_map('ql_txn_row', $st->fetchAll());

  $al = $db->prepare('SELECT alias_key, party FROM party_aliases WHERE plant_id = ? AND company_id = ?');
  $al->execute([$plantId, $companyId]);
  $aliases = [];
  foreach ($al->fetchAll() as $a) $aliases[$a['alias_key']] = $a['party'];

  $ac = $db->prepare('SELECT id, bank, acct_no, ifsc, label FROM bank_accounts WHERE plant_id = ? AND company_id = ? ORDER BY created_at');
  $ac->execute([$plantId, $companyId]);
  $accounts = $ac->fetchAll();

  ql_out(['txns' => $txns, 'aliases' => $aliases, 'accounts' => $accounts, 'total' => $total]);
}

if ($method === 'POST') {
  $b         = ql_body();
  $plantId   = (string)($b['plant_id'] ?? '');
  $companyId = (string)($b['company_id'] ?? '');
  $action    = (string)($b['action'] ?? '');
  if (!ql_verify_token(ql_token(), $plantId)) ql_out(['error' => 'Unauthorized'], 401);
  if ($companyId === '') ql_out(['error' => 'Missing company_id'], 400);
  $db = ql_db();

  /* Upsert a list of transactions (import or full sync). */
  if ($action === 'upsert_txns' || $action === 'save_txn') {
    $txns = $action === 'save_txn' ? [$b['txn'] ?? null] : ($b['txns'] ?? []);
    if (!is_array($txns)) ql_out(['error' => 'txns must be an array'], 400);
    $ins = $db->prepare(
      'INSERT INTO bank_txns
         (id, plant_id, company_id, account_id, txn_date, raw, clean, utr, cheque, mode, bank,
          debit, credit, balance, dedupe_key, status, confidence, m)
       VALUES (:id, :pid, :cid, :acc, :dt, :raw, :clean, :utr, :chq, :mode, :bank,
          :deb, :cred, :bal, :dk, :status, :conf, :m)
       ON DUPLICATE KEY UPDATE
          account_id = VALUES(account_id), txn_date = VALUES(txn_date), raw = VALUES(raw),
          clean = VALUES(clean), utr = VALUES(utr), cheque = VALUES(cheque), mode = VALUES(mode),
          bank = VALUES(bank), debit = VALUES(debit), credit = VALUES(credit), balance = VALUES(balance),
          dedupe_key = VALUES(dedupe_key), status = VALUES(status), confidence = VALUES(confidence), m = VALUES(m)'
    );
    $n = 0;
    $db->beginTransaction();
    try {
      foreach ($txns as $t) {
        if (!is_array($t) || empty($t['id'])) continue;
        $m    = $t['m'] ?? null;
        $date = (string)($t['date'] ?? '');
        $ins->execute([
          ':id'     => (string)$t['id'],
          ':pid'    => $plantId,
          ':cid'    => $companyId,
          ':acc'    => ($t['account_id'] ?? null) ?: null,
          ':dt'     => preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? $date : null,
          ':raw'    => (string)($t['raw'] ?? $t['desc'] ?? ''),
          ':clean'  => mb_substr((string)($t['clean'] ?? ''), 0, 255),
          ':utr'    => mb_substr((string)($t['utr'] ?? ''), 0, 64),
          ':chq'    => mb_substr((string)($t['cheque'] ?? ''), 0, 20),
          ':mode'   => mb_substr((string)($t['mode'] ?? ''), 0, 12),
          ':bank'   => mb_substr((string)($t['bank'] ?? ''), 0, 80),
          ':deb'    => (float)($t['debit'] ?? 0),
          ':cred'   => (float)($t['credit'] ?? 0),
          ':bal'    => isset($t['balance']) && $t['balance'] !== null ? (float)$t['balance'] : null,
          ':dk'     => mb_substr((string)($t['dedupe_key'] ?? ''), 0, 140),
          ':status' => is_array($m) ? mb_substr((string)($m['status'] ?? ''), 0, 20) : null,
          ':conf'   => is_array($m) && isset($m['confidence']) ? (int)$m['confidence'] : null,
          ':m'      => $m !== null ? json_encode($m) : null,
        ]);
        $n++;
      }
      $db->commit();
    } catch (Throwable $e) {
      $db->rollBack();
      ql_out(['error' => 'Write failed'], 500);
    }
    ql_out(['success' => true, 'n' => $n]);
  }

  /* Learn (or update) a party alias. */
  if ($action === 'learn_alias') {
    $key = trim((string)($b['alias_key'] ?? ''));
    $party = trim((string)($b['party'] ?? ''));
    if ($key === '' || $party === '') ql_out(['error' => 'alias_key and party required'], 400);
    $st = $db->prepare(
      'INSERT INTO party_aliases (plant_id, company_id, alias_key, party) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE party = VALUES(party)'
    );
    $st->execute([$plantId, $companyId, mb_substr($key, 0, 190), mb_substr($party, 0, 190)]);
    ql_out(['success' => true]);
  }

  /* Delete one transaction. */
  if ($action === 'delete_txn') {
    $id = (string)($b['id'] ?? '');
    if ($id === '') ql_out(['error' => 'Missing id'], 400);
    $st = $db->prepare('DELETE FROM bank_txns WHERE id = ? AND plant_id = ? AND company_id = ?');
    $st->execute([$id, $plantId, $companyId]);
    ql_out(['success' => true]);
  }

  /* Register a bank account. */
  if ($action === 'add_account') {
    $a = $b['account'] ?? [];
    $id = (string)($a['id'] ?? '');
    if ($id === '') ql_out(['error' => 'Missing account id'], 400);
    $st = $db->prepare(
      'INSERT INTO bank_accounts (id, plant_id, company_id, bank, acct_no, ifsc, label)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE bank = VALUES(bank), acct_no = VALUES(acct_no),
          ifsc = VALUES(ifsc), label = VALUES(label)'
    );
    $st->execute([$id, $plantId, $companyId,
      mb_substr((string)($a['bank'] ?? ''), 0, 80), mb_substr((string)($a['acct_no'] ?? ''), 0, 40),
      mb_substr((string)($a['ifsc'] ?? ''), 0, 20), mb_substr((string)($a['label'] ?? ''), 0, 120)]);
    ql_out(['success' => true]);
  }

  ql_out(['error' => 'Unknown action'], 400);
}

ql_out(['error' => 'Method not allowed'], 405);
