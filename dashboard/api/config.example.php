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

  // ── WhatsApp reminders (optional) — Whapi channel.
  //    Setup:  whapi.cloud -> create a channel -> scan the QR with the phone
  //    that will SEND (use a separate number, not your main business one) ->
  //    copy the channel token here. Server-side only: never in the browser,
  //    never committed, never pasted into a chat.
  //    Leave blank and QuickLimes stays in one-tap mode (you press send).
  //    ⚠ Whapi drives a real WhatsApp number unofficially. Meta can ban a
  //    number for bulk unsolicited messages. Do not point this at the number
  //    you cannot afford to lose.
  'WHAPI_TOKEN'  => '',                          // from your Whapi channel page
  'WHAPI_SENDER' => '',                          // the sending number, e.g. 919460034743 (display only)

  // ── Unattended reminders (optional) — the cron secret.
  //    /api/cron.php is reachable from the internet, so it is USELESS without
  //    this and refuses to run when blank. Generate one:  openssl rand -hex 24
  //    Then in hPanel -> Advanced -> Cron Jobs, hourly:
  //      curl -s "https://app.quicklimes.com/api/cron.php?key=THE-SAME-SECRET"
  'CRON_SECRET' => '',
];
