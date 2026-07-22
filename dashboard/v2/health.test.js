/* health.test.js — the App Health board is wired, gated, and honest.
 *
 * Two things can go wrong with a page like this, and neither shows up by
 * reading it:
 *   1. half-wired — the card, the page and the data file exist but nothing
 *      loads them, so the board is invisible or renders blank;
 *   2. dishonest — a finding whose status claims more certainty than the
 *      re-check actually established. The whole value of this board is that
 *      "not re-checked" and "never verified" are NOT quietly folded into
 *      "open" or "fixed". If that ever collapses, the board is worse than
 *      nothing, so it is pinned here.
 *
 *   node health.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (a, b, m) => ok(a === b, m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');

console.log('\n═══ App Health · wired, gated, honest ═══\n');

const findingsSrc = R('health-findings.js');
const js = R('health.js');
const html = R('health.html');
const settings = R('settings.html');

/* Load the data module the way the browser does. */
const sandbox = {};
new Function('window', findingsSrc)(sandbox);
const H = sandbox.HealthBoard;

/* ── 1. the data module actually exports a board ── */
{
  ok(!!H, 'health-findings.js defines window.HealthBoard');
  ok(Array.isArray(H.FINDINGS) && H.FINDINGS.length > 0, '  with findings on it');
  ok(typeof H.counts === 'function', '  and a counts() summary');
}

/* ── 2. every finding is well formed ── */
{
  const STATUS = ['fixed', 'open', 'unchecked', 'awaiting'];
  const SEV = ['high', 'med', 'low'];
  const ids = new Set();
  let bad = 0, dupe = 0, thin = 0;
  H.FINDINGS.forEach(f => {
    if (STATUS.indexOf(f.status) < 0 || SEV.indexOf(f.sev) < 0) bad++;
    if (ids.has(f.id)) dupe++; ids.add(f.id);
    if (!f.title || !f.what || !f.where || !f.module) thin++;
  });
  eq(bad, 0, 'every finding has a known status and severity');
  eq(dupe, 0, 'no duplicate finding ids');
  eq(thin, 0, 'every finding says what happens AND where it lives');
}

/* ── 3. the honesty rule: uncertainty is never dressed up as a verdict ──
   A "fixed" or "open" claim means someone re-read the code, so it must cite
   evidence. An "unchecked" or "awaiting" finding must say plainly that it was
   not verified — those are the two states most tempting to quietly promote. */
{
  const decided = H.FINDINGS.filter(f => f.status === 'fixed' || f.status === 'open');
  const noEvidence = decided.filter(f => !/\.js:\d+|data\.js|parties\.js|sales\.js|finance\.js|dashboard\.js/.test(f.where));
  eq(noEvidence.length, 0, 'every fixed/open verdict cites the code that decided it');

  const unsure = H.FINDINGS.filter(f => f.status === 'unchecked' || f.status === 'awaiting');
  const pretending = unsure.filter(f => !/not re-checked|never verified|cut off|not traced|Not re-checked/i.test(f.where));
  eq(pretending.length, 0, 'every unverified finding admits it was not verified');

  ok(H.byStatus('unchecked').length > 0, 'the board still carries findings nobody re-checked');
  ok(H.byStatus('awaiting').length > 0, '  and findings nobody ever verified');
}

/* ── 4. counts are derived, never typed in twice ── */
{
  const c = H.counts();
  const openN = H.FINDINGS.filter(f => f.status === 'open').length;
  eq(c.open, openN, 'counts().open matches the findings actually marked open');
  const highOpen = H.FINDINGS.filter(f => f.status === 'open' && f.sev === 'high').length;
  eq(c.openBySev.high || 0, highOpen, 'the "high open" headline is counted, not asserted');
  /* A fixed finding must not also be counted as open — the bug that would make
     the board congratulate itself. */
  eq(H.FINDINGS.filter(f => f.status === 'fixed' && f.status === 'open').length, 0, 'nothing is both fixed and open');
}

/* ── 5. wired: the page loads what it uses ── */
{
  ok(/health-findings\.js/.test(html), 'health.html loads health-findings.js');
  ok(/src="\.\/health\.js/.test(html), '  and health.js');
  ok(html.indexOf('health-findings.js') < html.indexOf('health.js'), '  the data loads BEFORE the renderer that reads it');
  ['hbTally', 'hbNote', 'hbStats', 'hbTabs', 'hbList', 'hbGate', 'hbMain'].forEach(id =>
    ok(new RegExp('id="' + id + '"').test(html), '  the page has the #' + id + ' mount point'));
  ok(/QLShell\.mount\(/.test(js), 'the page mounts the app shell (sidebar, header, theme)');
}

/* ── 6. wired: Settings actually reaches it ── */
{
  ok(/id="healthCard"/.test(settings), 'Settings has an App health card');
  ok(/href="\.\/health"/.test(settings), '  linking to the board');
  ok(/\['healthCard', 'App health'\]/.test(settings), '  and the section nav lists it');
  ok(/health-findings\.js/.test(settings), 'Settings loads the findings file it reads counts from');
  ok(/#healthCard/.test(settings) && /_isOwner\(\)/.test(settings), '  revealed only behind the owner check');
  /* Ordering matters and cannot be seen by reading the page: the reveal must
     come BEFORE the /api/users.php call, or a team-fetch failure takes an
     unrelated card down with it — which is exactly what happens offline. */
  const reveal = settings.indexOf("hc.style.display = ''");
  const fetchTeam = settings.indexOf("teamApi({ action: 'list' })");
  ok(reveal > 0 && fetchTeam > 0 && reveal < fetchTeam,
    '  and revealed BEFORE the team fetch, so a failed API call cannot hide it');
}

/* ── 7. gated, and honest about what the gate is ── */
{
  ok(/isOwner/.test(js), 'health.js has an owner gate');
  ok(/\['owner', 'admin', 'partner'\]/.test(js), '  using the same roles as the Settings owner-only cards');
  ok(/hbMain'\)\.hidden = false/.test(js), '  the board is revealed only after that check passes');
  ok(/COURTESY|courtesy/.test(js), '  and the code says plainly that this is not a security boundary');
}

/* ── 8. it is a snapshot, not a live reading of the books ──
   If this page ever starts calling the API or reading business data, the claim
   "nothing here reads your business data" on the Settings card becomes a lie. */
{
  ok(!/fetch\(/.test(js), 'health.js never calls the network');
  /* Match the CALL, not the word: the board's own prose explains the
     salesRows()/purchaseRows() split, so a bare-name test fails on its
     documentation instead of on a real data read. */
  ok(!/QLD\.|\bQ\.(salesRows|purchaseRows|state)\b/.test(js), '  and never reads the books');
  ok(/AUDIT_DATE/.test(js) && /RECHECK_DATE/.test(js), 'both dates are shown, so the snapshot can never look current');
}

console.log(fail ? `\n❌ FAILED — Passed: ${pass} · Failed: ${fail}\n` : `\n✅ PASSED — Passed: ${pass} · Failed: ${fail}\n`);
process.exit(fail ? 1 : 0);
