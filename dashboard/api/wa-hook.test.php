<?php
/* wa-hook.test.php — the Whapi webhook parser.
   Run:  php dashboard/api/wa-hook.test.php     (no database, no network)

   THE SHAPE IS REAL, THE DATA IS NOT.
   Whapi does not publish its message schema, so these fixtures were built from
   payloads captured off a LIVE channel (50 real webhooks). The field names,
   nesting and types below are exactly what arrives. The phone numbers, names
   and message bodies are invented: the captured data belongs to real third
   parties, and copying their conversations into this repo to serve as test
   fixtures would be a worse privacy breach than anything this code prevents.

   What real data already corrected, which docs and our own old comments got
   wrong:
     • `from` is a BARE number ("919460034743"), NOT a JID
     • `timestamp` is UNIX SECONDS, not milliseconds
     • a media caption is the message text — dropping it loses what was said */

$src = file_get_contents(__DIR__ . '/db.php');
foreach (['ql_wa_parse_message', 'ql_wa_preview_text'] as $fn) {
  if (!preg_match('/function ' . $fn . '\(\$m\) \{.*?\n\}/s', $src, $m)) {
    fwrite(STDERR, "✗ $fn not found in db.php\n"); exit(1);
  }
  eval($m[0]);   // load the REAL function, never a copy
}

$pass = 0; $fail = 0; $fails = [];
function ok($n, $c) { global $pass, $fail, $fails; if ($c) $pass++; else { $fail++; $fails[] = $n; } }
function eq($n, $a, $b) { ok($n . ' — got ' . json_encode($a) . ', want ' . json_encode($b), $a === $b); }

/* ── a real-shaped inbound TEXT from a customer ── */
$text = ql_wa_parse_message([
  'id' => 'ABC123xyz', 'from_me' => false, 'type' => 'text',
  'chat_id' => '919460034743@s.whatsapp.net', 'timestamp' => 1776067633,
  'source' => 'mobile', 'from' => '919460034743', 'from_name' => 'R Sharma',
  'text' => ['body' => 'Please send 20 tonnes quick lime'],
]);
eq('text body is extracted', $text['body'], 'Please send 20 tonnes quick lime');
eq('wa id', $text['wa_id'], 'ABC123xyz');
eq('from is a bare number, not a JID', $text['from_phone'], '919460034743');
eq('a 1:1 chat is not a group', $text['is_group'], 0);
eq('inbound is not from_me', $text['from_me'], 0);
eq('type', $text['type'], 'text');
// UNIX SECONDS. Read as ms and every message lands in 1970 — the thread would
// silently sort into nonsense.
eq('timestamp is parsed as SECONDS', $text['at'], gmdate('Y-m-d H:i:s', 1776067633));
ok('...and is not 1970', substr($text['at'], 0, 4) === '2026');

/* ── a GROUP message: chat_id ends @g.us ── */
$grp = ql_wa_parse_message([
  'id' => 'G1', 'from_me' => false, 'type' => 'text', 'chat_id' => '120363425328429796@g.us',
  'timestamp' => 1776067633, 'from' => '919812345678', 'from_name' => 'A Patel',
  'chat_name' => 'Lime buyers group', 'text' => ['body' => 'rate?'],
]);
eq('a @g.us chat IS a group', $grp['is_group'], 1);
eq('the sender inside a group is still the person', $grp['from_phone'], '919812345678');

/* ── OUTBOUND (sent from the phone, echoed back to us) ── */
$out = ql_wa_parse_message([
  'id' => 'O1', 'from_me' => true, 'type' => 'text', 'chat_id' => '919460034743@s.whatsapp.net',
  'timestamp' => 1776067700, 'from' => '919460034743', 'text' => ['body' => 'Dispatching tomorrow'],
]);
eq('from_me is honoured — this is OUR message', $out['from_me'], 1);

/* ── IMAGE: real shape has id/mime_type/file_size/width/height/preview ── */
$img = ql_wa_parse_message([
  'id' => 'I1', 'from_me' => false, 'type' => 'image', 'chat_id' => '919460034743@s.whatsapp.net',
  'timestamp' => 1776067633, 'from' => '919460034743',
  'image' => ['id' => 'jpeg-abc123', 'mime_type' => 'image/jpeg', 'file_size' => 52131,
              'width' => 1280, 'height' => 909, 'preview' => 'data:image/jpeg;base64,/9j/4AAQSkZ',
              'caption' => 'Bags loaded'],
]);
eq('image media id is kept (media is stored BY REFERENCE)', $img['media_id'], 'jpeg-abc123');
eq('mime', $img['media_mime'], 'image/jpeg');
eq('size', $img['media_size'], 52131);
eq('the caption IS the message text — never dropped', $img['body'], 'Bags loaded');
eq('the inline thumbnail is kept', $img['preview'], 'data:image/jpeg;base64,/9j/4AAQSkZ');

/* ── DOCUMENT: has file_name ── */
$doc = ql_wa_parse_message([
  'id' => 'D1', 'from_me' => false, 'type' => 'document', 'chat_id' => '919460034743@s.whatsapp.net',
  'timestamp' => 1776067633, 'from' => '919460034743',
  'document' => ['id' => 'pdf-xyz', 'mime_type' => 'application/pdf', 'file_size' => 46340800,
                 'file_name' => 'PO-2026-118.pdf', 'caption' => 'Our purchase order'],
]);
eq('file name', $doc['media_name'], 'PO-2026-118.pdf');
eq('document caption', $doc['body'], 'Our purchase order');
eq('a 46MB document keeps its real size', $doc['media_size'], 46340800);

/* ── VOICE: a type with no caption ── */
$voice = ql_wa_parse_message([
  'id' => 'V1', 'from_me' => false, 'type' => 'voice', 'chat_id' => '919460034743@s.whatsapp.net',
  'timestamp' => 1776067633, 'from' => '919460034743',
  'voice' => ['id' => 'ogg-1', 'mime_type' => 'audio/ogg', 'file_size' => 6000, 'seconds' => 7],
]);
eq('voice keeps its media id', $voice['media_id'], 'ogg-1');
eq('voice has no body', $voice['body'], '');
eq('voice type survives', $voice['type'], 'voice');

/* ── junk must never become a message ── */
eq('no id -> not a message', ql_wa_parse_message(['type' => 'text']), null);
eq('not an array -> null', ql_wa_parse_message('hello'), null);
eq('null -> null', ql_wa_parse_message(null), null);
// 'unknown' and 'action' both arrive on a live channel. They must parse, not crash.
$unk = ql_wa_parse_message(['id' => 'U1', 'type' => 'unknown', 'chat_id' => 'x@s.whatsapp.net', 'timestamp' => 1776067633, 'from' => '91']);
ok('an unknown type still parses rather than throwing', $unk !== null && $unk['type'] === 'unknown');

/* ── a huge preview must not be stored: it bloats every row AND every poll ── */
$big = ql_wa_parse_message([
  'id' => 'B1', 'type' => 'image', 'chat_id' => 'x@s.whatsapp.net', 'timestamp' => 1776067633,
  'from' => '91', 'image' => ['id' => 'i', 'preview' => str_repeat('A', 50000)],
]);
eq('an oversized thumbnail is dropped, not stored', $big['preview'], null);
$okpv = ql_wa_parse_message([
  'id' => 'B2', 'type' => 'image', 'chat_id' => 'x@s.whatsapp.net', 'timestamp' => 1776067633,
  'from' => '91', 'image' => ['id' => 'i', 'preview' => str_repeat('A', 100)],
]);
ok('a sane thumbnail is kept', $okpv['preview'] !== null);

/* ── chat-list previews read like a human wrote them ── */
eq('text preview', ql_wa_preview_text($text), 'Please send 20 tonnes quick lime');
ok('image preview names it', strpos(ql_wa_preview_text($img), 'Photo') !== false);
ok('image preview keeps the caption', strpos(ql_wa_preview_text($img), 'Bags loaded') !== false);
ok('document preview shows the file name', strpos(ql_wa_preview_text($doc), 'PO-2026-118.pdf') !== false);
ok('voice preview says voice note', strpos(ql_wa_preview_text($voice), 'Voice note') !== false);
ok('a preview is never longer than the column', mb_strlen(ql_wa_preview_text(
  ql_wa_parse_message(['id' => 'L', 'type' => 'text', 'chat_id' => 'x', 'timestamp' => 1, 'from' => '9',
    'text' => ['body' => str_repeat('word ', 200)]]))) <= 200);

echo "\n════ Whapi webhook parser ════\n  Passed: $pass   Failed: $fail\n";
foreach ($fails as $f) echo "    ✗ $f\n";
echo $fail === 0 ? "\n✅ ALL $pass PARSER TESTS PASSED\n\n" : "\n❌ $fail FAILED\n\n";
exit($fail === 0 ? 0 : 1);
