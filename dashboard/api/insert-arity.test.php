<?php
/* insert-arity.test.php — every INSERT must bind exactly as many values as it
   has placeholders.

   WHY THIS EXISTS: discover.php had 17 columns, 17 placeholders and only 16
   BOUND VALUES. Every execute() threw "Invalid parameter number", the catch
   counted each failure as "already seen", and Lead Discovery reported dozens of
   companies while saving none. A whole feature silently stored nothing. This
   test walks every prepare(...)->execute([...]) pair and proves the arity.

   Run: php insert-arity.test.php */
$pass = 0; $fail = 0; $checked = 0;

/* Count top-level array elements — commas inside (), [] or strings don't split. */
function ql_arity($s) {
  $n = 0; $depth = 0; $q = ''; $seen = false;
  for ($i = 0, $L = strlen($s); $i < $L; $i++) {
    $c = $s[$i];
    if ($q !== '') { if ($c === $q && $s[$i - 1] !== '\\') $q = ''; continue; }
    if ($c === "'" || $c === '"') { $q = $c; $seen = true; continue; }
    if ($c === '(' || $c === '[') { $depth++; $seen = true; continue; }
    if ($c === ')' || $c === ']') { $depth--; continue; }
    if ($c === ',' && $depth === 0) { $n++; continue; }
    if (!ctype_space($c)) $seen = true;
  }
  return $seen ? $n + 1 : 0;
}

foreach (glob(__DIR__ . '/*.php') as $f) {
  if (basename($f) === basename(__FILE__)) continue;
  $s = file_get_contents($f);
  $off = 0;
  /* Walk each prepare( … ) individually: take its SQL string, then the FIRST
     execute([...]) that follows it. Regex alone spans statements and invents
     mismatches — this pairs them exactly. */
  while (($p = strpos($s, 'prepare(', $off)) !== false) {
    $off = $p + 8;
    $i = $p + 8; while ($i < strlen($s) && ctype_space($s[$i])) $i++;
    if ($i >= strlen($s) || ($s[$i] !== "'" && $s[$i] !== '"')) continue;
    $q = $s[$i]; $i++; $sql = '';
    while ($i < strlen($s)) { if ($s[$i] === $q && $s[$i-1] !== '\\') break; $sql .= $s[$i]; $i++; }
    if (stripos($sql, 'INSERT INTO') === false) continue;
    /* If the prepare was assigned to a variable ($x = $db->prepare(...)), find
       THAT variable's execute — not merely the next execute in the file, which
       may belong to a different statement entirely. */
    $var = '';
    $ls = strrpos(substr($s, 0, $p), "\n");
    $line = substr($s, $ls === false ? 0 : $ls + 1, $p - ($ls === false ? 0 : $ls + 1));
    if (preg_match('/(\$\w+)\s*=/', $line, $vm)) $var = $vm[1];
    if ($var !== '') {
      $e = strpos($s, $var . '->execute(', $i);
      if ($e === false) continue;
      $e = strpos($s, 'execute(', $e);
    } else {
      $e = strpos($s, 'execute(', $i);
      if ($e === false || $e - $i > 400) continue;
      if (strpos(substr($s, $i, $e - $i), 'prepare(') !== false) continue;
    }
    $b = strpos($s, '[', $e); if ($b === false || $b - $e > 8) continue;
    $depth = 0; $args = ''; $j = $b;
    for (; $j < strlen($s); $j++) {
      $c = $s[$j];
      if ($c === '[') { $depth++; if ($depth === 1) continue; }
      if ($c === ']') { $depth--; if ($depth === 0) break; }
      $args .= $c;
    }
    $head = preg_replace('/ON DUPLICATE KEY.*/is', '', $sql);
    /* Named placeholders (:id, :pid) are bound by an assoc array, not positionally
       — count those instead of '?' so they are not reported as zero. */
    if (substr_count($head, '?') === 0 && preg_match_all('/:\w+/', $head, $nm)) {
      $sqlPh = count(array_unique($nm[0]));
      $bound = ql_arity($args);
      /* assoc arrays bind key => value pairs; count the pairs */
      if (strpos($args, '=>') !== false) $bound = substr_count($args, '=>');
      $checked++;
      preg_match('/INSERT INTO\s+(\w+)/i', $sql, $t);
      if ($sqlPh === $bound) $pass++;
      else { $fail++; echo "  ❌ " . basename($f) . " — INSERT INTO {$t[1]}: {$sqlPh} named placeholders but {$bound} bound\n"; }
      continue;
    }
    $sqlPh = substr_count($head, '?');
    $bound = ql_arity($args);
    $checked++;
    preg_match('/INSERT INTO\s+(\w+)/i', $sql, $t);
    if ($sqlPh === $bound) { $pass++; }
    else { $fail++; echo "  ❌ " . basename($f) . " — INSERT INTO {$t[1]}: {$sqlPh} placeholders but {$bound} bound values\n"; }
  }
}

echo "\n" . ($fail === 0 ? '✅ PASSED' : '❌ FAILED') . " — INSERTs checked: $checked · arity OK: $pass · mismatched: $fail\n";
exit($fail === 0 ? 0 : 1);
