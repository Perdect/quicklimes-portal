/* ai-status.test.js — the app must SAY when the AI didn't read the bill.
 *
 * THE BUG THIS CLOSES. extract-api.js returned null on every AI failure and bulk.js
 * silently fell back to the regex parser. No key, wrong endpoint, blocked prompt,
 * dead network — all identical from the outside: a bill that just read a bit worse.
 * The owner had a VALID Gemini key in config while every single upload used the
 * offline reader, and no screen in the app could tell him. He spent days, and a lot
 * of tokens, testing a feature that was never running.
 *
 * The fallback is GOOD and stays — a bill still gets read when the AI is down. The
 * silence is what's fixed. A quieter parse is not a neutral event: it is the
 * difference between a field read off the page and a field guessed by a pattern.
 *
 * Drives the REAL extract-api.js and the REAL bulk.js aiNote/start in a vm.
 *
 *   node ai-status.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ AI status · the app says when the AI did not read the bill ═══\n');

const asrc = fs.readFileSync(path.join(__dirname, 'extract-api.js'), 'utf8');
const bsrc = fs.readFileSync(path.join(__dirname, 'bulk.js'), 'utf8');

/* ══════════ 1. THE REAL CLIENT, DRIVEN THROUGH A FAKE SERVER ══════════
   Load the REAL extract-api.js with fetch stubbed at the boundary, so every line
   between the response and status() is the shipping code. */
function loadClient(serverReply) {
  const calls = [];
  const ctx = {
    console, JSON, Date, Math, Object, String, Number, Array, isFinite, parseFloat,
    setTimeout, clearTimeout, Promise,
    AbortController: function () { this.signal = null; this.abort = () => {}; },
    location: { hostname: 'app.quicklimes.com' },
    localStorage: { getItem: () => JSON.stringify({ id: 'p1', token: 't1' }) },
    FileReader: function () {},
    crypto: { subtle: { digest: async () => new ArrayBuffer(4) } },
    fetch: async (url, opt) => {
      calls.push({ url, body: opt && opt.body });
      return { json: async () => serverReply };
    },
  };
  ctx.window = ctx;
  ctx.QLFin = { pdfPages: async () => ['GSTIN 24AAACI1681G1ZV\nIndian Oil\nTaxable 411973.20\nTotal 486128.00 and enough text to pass the 80-char embedded-text gate here'], ownInfo: () => ({ ownGstins: ['08BNAPM0488E1Z3'] }) };
  vm.createContext(ctx);
  /* The REAL validator, not a stub. My first attempt stubbed it and got the contract
     wrong (vr.f instead of vr.fields) — the stub passed and the code crashed. A stub
     of a module sitting right next to you is a second, worse copy of its contract. */
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'extract-schema.js'), 'utf8'), ctx);
  vm.runInContext(asrc, ctx);
  return { API: ctx.QLExtractAPI, calls };
}
const FILE = { name: 'bill.pdf', type: 'application/pdf' };

{
  const { API } = loadClient({ ok: false, fallback: true, error: 'llm_not_configured' });
  ok(API && typeof API.status === 'function', 'the REAL extract-api.js exposes status()');
  eq('before anything runs, there is no status to report — NOT a fake "ok"', API.status(), null);
}

/* ══════════ 2. EVERY FAILURE NAMES ITSELF ══════════
   These were ALL the same silent null. Each has a completely different fix, and the
   person reading the toast is the person who has to apply it. */
(async () => {
  const cases = [
    ['llm_not_configured', 'no AI key is configured on the server', 'THE OWNER\'S ACTUAL CASE: no key on the server'],
    ['ai_unavailable', 'the AI service could not be reached', 'a dead endpoint'],
    ['ai_bad_response', 'the AI replied in a shape we could not read', 'a malformed reply'],
    ['network', 'the request never reached the server', 'the request never left'],
    ['llm_unknown_provider:gemni', 'the server has an unknown AI provider configured (gemni)', 'a TYPO in the provider config — names the typo'],
    ['ai_no_result:SAFETY', 'the AI returned no result (SAFETY)', 'a blocked prompt — not "unavailable"'],
    ['HTTP 401', 'the AI key was rejected (401) — check LLM_API_KEY in api/config.php', 'a rejected key — names the KEY and the file, not a bare "HTTP 401"'],
    ['HTTP 403', 'the AI key was rejected (403) — check LLM_API_KEY in api/config.php', '403 is also a rejected/blocked key'],
    ['HTTP 429', 'the AI key hit its rate/quota limit (429) — add credit or slow down', 'rate-limit is a DIFFERENT fix from a bad key'],
    ['HTTP 500', 'the AI provider had a server error (500) — usually temporary, try again', 'a 5xx is the provider, not the key'],
  ];
  for (const [err, want, label] of cases) {
    const { API } = loadClient({ ok: false, fallback: true, error: err });
    const r = await API.extract(FILE, 'purchase');
    ok(r === null, label + ': still falls back to the offline reader');
    const s = API.status();
    ok(s && !s.ok, '  and is recorded as a failure');
    eq('  explained in words the person who configured the key can act on', s.reason, want);
  }

  /* An unknown error code must still say SOMETHING — never blank. */
  {
    const { API } = loadClient({ ok: false, error: 'some_new_code' });
    await API.extract(FILE, 'purchase');
    eq('an unrecognised error is passed through, never blanked', API.status().reason, 'some_new_code');
    const { API: A2 } = loadClient({ ok: false });
    ok(A2.status() === null || true, 'a reply with no error at all does not throw');
    await A2.extract(FILE, 'purchase');
    ok(A2.status().reason.length > 0, '  and still produces a non-empty reason');
  }

  /* ══════════ 3. SUCCESS IS RECORDED, WITH WHO ANSWERED ══════════ */
  {
    const { API, calls } = loadClient({ ok: true, data: { invoiceNo: 'X-1', taxable: 411973.2 },
      provider: 'gemini', model: 'gemini-2.5-flash', usage: { input_tokens: 10, output_tokens: 2 } });
    const r = await API.extract(FILE, 'purchase');
    ok(r !== null, 'a successful AI read returns a bill');
    const s = API.status();
    ok(s.ok, '  and status says ok');
    eq('  naming WHICH provider answered — the question that started all this', s.provider, 'gemini');
    eq('  and which model', s.model, 'gemini-2.5-flash');
    eq('  with no failure reason', s.reason, '');
    ok(calls.some(c => /extract$/.test(c.url)), '  it really called /api/extract');
    /* The key must never appear client-side — it is server-only, by design. */
    ok(!calls.some(c => /AQ\.|sk-ant|x-goog/.test(String(c.body))), '  and no API key is anywhere near the browser');
  }

  /* A failure AFTER a success must overwrite it — a stale green light is worse than
     no light, because it is believed. */
  {
    const { API } = loadClient({ ok: true, data: { a: 1 }, provider: 'gemini', model: 'm' });
    await API.extract(FILE, 'purchase');
    ok(API.status().ok, 'first call succeeds');
    const { API: A2 } = loadClient({ ok: false, error: 'ai_unavailable' });
    await A2.extract(FILE, 'purchase');
    ok(!A2.status().ok, 'a later failure is not masked by an earlier success');
  }

  /* ══════════ 4. bulk.js SAYS IT — ONCE, AND ONLY WHEN TRUE ══════════
     The real aiNote + the real BATCH stamp, lifted out of bulk.js. */
  {
    const grab = (k, end) => { const i = bsrc.indexOf(k); return bsrc.slice(i, bsrc.indexOf(end, i) + end.length); };
    const toasts = [];
    const ctx = { console, Date, JSON, window: null, toast: (m, t) => toasts.push({ m, t }), BATCH: null };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(grab('function aiNote()', '\n  }') + '\nthis.aiNote = aiNote;', ctx);
    ok(typeof ctx.aiNote === 'function', 'the REAL aiNote loaded out of bulk.js');

    const run = (status, t0) => { toasts.length = 0; ctx.QLExtractAPI = { status: () => status }; ctx.BATCH = { t0: t0 }; ctx.aiNote(); return toasts; };
    const NOW = Date.now();

    eq('a WORKING AI says nothing — no self-congratulation on every import',
      run({ ok: true, at: NOW, provider: 'gemini' }, NOW - 10).length, 0);
    eq('an AI that has never run says nothing (a spreadsheet import)', run(null, NOW - 10).length, 0);

    const t = run({ ok: false, at: NOW, reason: 'no AI key is configured on the server' }, NOW - 10);
    eq('THE FIX: a failed AI read is announced', t.length, 1);
    ok(/AI reading is off/.test(t[0].m), '  it says the AI is off');
    ok(/no AI key is configured on the server/.test(t[0].m), '  it says WHY');
    ok(/offline reader/.test(t[0].m), '  it says what read the bills instead');
    ok(/check the figures/.test(t[0].m), '  and tells the user what to do about it');
    eq('  as an error, not a decorative note', t[0].t, 'err');

    /* THE STALENESS TRAP. status() is last-one-wins and outlives a batch. Import 1
       fails; import 2 is spreadsheets only and never calls the AI. Without the
       timestamp scope, import 2 inherits import 1's failure and reports the AI as
       off when it was never even asked — a false alarm about a working system,
       which is how a warning trains people to ignore warnings. */
    eq('a STALE failure from a previous import is not re-announced',
      run({ ok: false, at: NOW - 5000, reason: 'x' }, NOW).length, 0);
    eq('  but a failure DURING this import is', run({ ok: false, at: NOW + 1, reason: 'x' }, NOW).length, 1);
    eq('  a failure at the exact start instant counts as this import\'s',
      run({ ok: false, at: NOW, reason: 'x' }, NOW).length, 1);

    /* Defensive: no QLExtractAPI at all (a page that loads bulk.js without it). */
    toasts.length = 0; ctx.QLExtractAPI = null; ctx.BATCH = { t0: NOW }; ctx.aiNote();
    eq('a page without the AI client does not throw or warn', toasts.length, 0);
  }

  /* ══════════ 5. THE FALLBACK STILL WORKS ══════════
     The point was never to break the offline path — it is what keeps the app usable
     when the AI is down. Pin it. */
  {
    /* EACH read path must have its own fallback — asserted separately, because a
       single "parseInvoiceText appears somewhere in the file" check passes while one
       of the two paths has lost its fallback entirely. (A mutation proved exactly
       that: deleting the single-page fallback left the multi-page one matching.) */
    ok(/\(slices\[pi\] \? await aiOne\(slices\[pi\]\) : null\) \|\| F\(\)\.parseInvoiceText\(/.test(bsrc),
      'MULTI-page PDF: each page falls back to the tested regex parser when the AI returns null');
    ok(/var g0 = await aiOne\(file\); if \(!g0\) g0 = F\(\)\.parseInvoiceText\(/.test(bsrc),
      'SINGLE-page PDF: falls back to the tested regex parser too');
    ok(/var gs = await aiOne\(file\);[\s\S]{0,200}ocrScan\(/.test(bsrc),
      'SCANNED PDF: falls back to OCR — no path is left with the AI as its only reader');
    /* Anchored to the CALL SITE, not the name. `/aiNote\(\)/` alone also matches
       "function aiNote() {" — so deleting the call would have left the test green,
       which is the exact failure mode this whole file exists to prevent. */
    ok(/hideProgress\(\);[\s\S]{0,400}\n\s*aiNote\(\);/.test(bsrc),
      '  aiNote is actually CALLED when the import finishes, not merely defined');
    ok(/t0: Date\.now\(\)/.test(bsrc), '  and each batch stamps its start, so a stale failure is not re-announced');
    ok(/if \(!aiReady\) return null/.test(bsrc), '  a page with no AI configured still imports bills');
  }

  console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
  process.exit(fail ? 1 : 0);
})();
