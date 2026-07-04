<?php
// Feasibility probe: confirms PHP runs on Hostinger and the MySQL drivers exist.
header('Content-Type: application/json');
header('Cache-Control: no-store');
echo json_encode([
  'ok'        => true,
  'php'       => PHP_VERSION,
  'mysqli'    => extension_loaded('mysqli'),
  'pdo_mysql' => extension_loaded('pdo_mysql'),
  'json'      => extension_loaded('json'),
  'openssl'   => extension_loaded('openssl'),
  'server'    => $_SERVER['SERVER_SOFTWARE'] ?? '',
  'time'      => date('c'),
]);
