<?php
/* ═══════════════════════════════════════════════════════════════
   QuickLimes backend config — TEMPLATE.

   👉 COPY THIS FILE TO  config.php  (same folder) AND FILL IN YOUR VALUES.

   config.php holds your database password and app secret. It stays ONLY
   on your Hostinger server — it is git-ignored, never committed, and Claude
   never sees it. The deploy never overwrites it (clean-slate is off).
   ═══════════════════════════════════════════════════════════════ */
return [
  // ── MySQL — from hPanel → Databases → MySQL Databases ──
  'DB_HOST' => 'localhost',                 // Hostinger shared hosting is almost always 'localhost'
  'DB_NAME' => 'uXXXXXXXX_quicklimes',      // the database name you created
  'DB_USER' => 'uXXXXXXXX_quicklimes',      // the database user you created
  'DB_PASS' => 'YOUR-DATABASE-PASSWORD',    // the password you set for that user

  // ── App secret — signs the login tokens. Make it long and random. ──
  // Generate one with:   openssl rand -hex 32
  // (or just type 50+ random characters). Keep it secret.
  'APP_SECRET' => 'change-me-to-a-long-random-string-of-at-least-32-characters',

  // ── AI invoice extraction (optional) — the vision model that reads any bill.
  //    Paste your Anthropic key here (server-side only; never committed, never
  //    sent to the browser). Leave blank to keep the offline regex parser.
  'LLM_API_KEY' => '',                          // sk-ant-...  (from console.anthropic.com)
  'LLM_MODEL'   => 'claude-sonnet-5',           // vision-capable model id
  'LLM_MAX_IMAGES' => 3,                         // page images per bill (cost cap)
];
