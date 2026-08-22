/* ═══════════════════════════════════════════════════════════════════════
   PER-PERSON DATA IS KEYED BY ACCOUNT.

   A new client account showed the previous owner's face as its own profile
   photo. The photo was stored under a browser-wide localStorage key
   ('dm_profile_pic' / 'ql_v2_profile_photo'), and localStorage is per ORIGIN
   — so every account signed into that browser shared one photo. On a shared
   machine that shows one customer another customer's photograph.

   The cloud copy was always correct: profile_pic lives in the per-company
   blob. Only the LOCAL bridge was global, and it leaked in both directions —
   pulling A's blob wrote A's photo where B would read it.

   This pins the rule rather than the fix: anything identifying a PERSON must
   carry the account id in its key.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0; const bad = [];
const ok = (m, c) => { if (c) pass++; else { fail++; bad.push(m); } };

const DIR = __dirname;
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const shell = strip(read('shell.js'));
const data = strip(read('data.js'));

/* ── 1. THE KEY CARRIES THE ACCOUNT ──────────────────────────────────────── */
{
  ok('shell.js derives the photo key from the signed-in account',
     /function photoKey\(\)/.test(shell) && /'dm_profile_pic:' \+ id/.test(shell));
  ok('data.js derives it the same way — one key, not two',
     /function picKey\(\)/.test(data) && /'dm_profile_pic:' \+ p\.id/.test(data));
  ok('both read the account id from ql_plant',
     /ql_plant/.test(shell) && /ql_plant/.test(data));
}

/* ── 2. NOTHING WRITES THE BROWSER-WIDE KEY ANY MORE ─────────────────────
   A single setItem to the unscoped key reopens the leak for every account on
   the machine, so writes are what this checks — reads and removals of the
   legacy key are the cleanup and are fine. */
{
  const writes = [];
  for (const [name, src] of [['shell.js', shell], ['data.js', data]]) {
    const re = /localStorage\.setItem\(\s*'(dm_profile_pic|ql_v2_profile_photo)'/g;
    let m; while ((m = re.exec(src))) writes.push(name + ' -> ' + m[1]);
  }
  ok('no code writes the unscoped photo key' + (writes.length ? '\n       ' + writes.join(', ') : ''),
     writes.length === 0);

  /* The photo that goes to the cloud must be THIS account's. */
  ok('the cloud blob takes the photo from the scoped key',
     /b\.profile_pic = localStorage\.getItem\(picKey\(\)\)/.test(data));
  ok('and a cloud pull writes it back to the scoped key',
     /localStorage\.setItem\(picKey\(\), cd\.profile_pic\)/.test(data));
}

/* ── 3. SWITCHING ACCOUNTS MUST CLEAR, NOT KEEP ──────────────────────────
   `if (photo) applyAvatarPhoto(photo)` was half the bug: an account with no
   photo never overwrote what the previous one had painted, so the face stayed
   on screen after the switch. */
{
  ok('the avatar is repainted even when this account has NO photo',
     /applyAvatarPhoto\(localStorage\.getItem\(photoKey\(\)\) \|\| null\)/.test(shell));
  ok('  and applyAvatarPhoto clears the photo when given nothing',
     /function applyAvatarPhoto\(url\)[\s\S]{0,300}removeProperty\('--ql-photo'\)/.test(shell));
}

/* ── 4. A PULL WITH NO PHOTO REMOVES THE OLD ONE ─────────────────────────
   Otherwise "remove photo" comes back on the next device that syncs — which
   is a bug this codebase has already had once. */
{
  ok('a blob without a photo clears the local copy rather than leaving it',
     /else localStorage\.removeItem\(picKey\(\)\)/.test(data));
}

/* ── 5. SIGN-OUT CLEARS THIS ACCOUNT'S PHOTO ─────────────────────────────── */
{
  ok('sign-out removes the scoped key, not only the legacy one',
     /kill\.push\([^)]*picKey\(\)/.test(data));
}

/* ── 6. THE LEGACY GLOBAL KEYS ARE DROPPED ───────────────────────────────
   They are not migrated: nothing records which account a globally-stored
   photo belonged to, so adopting it into whichever account loads first is a
   guess, and the wrong guess is exactly the bug. The cloud repopulates the
   right one per account. */
{
  ok('the browser-wide keys are cleared on load, so the leak stops immediately',
     /removeItem\(PHOTO_KEY_LEGACY\)/.test(shell) && /removeItem\('dm_profile_pic'\)/.test(shell));
}

console.log('\n════ account scoping (one person, one account, one photo) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' SCOPING TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
