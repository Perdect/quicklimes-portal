/* replace-month.test.js — the Settings card is WIRED, not just written.
 * A wizard that never mounts is worse than no wizard: the page looks fine
 * and the feature silently does not exist. These are static checks against
 * the real files, so they fail at commit time rather than in the browser.
 * Run: node replace-month.test.js */
const fs = require('fs');
const H = fs.readFileSync(__dirname + '/settings.html', 'utf8');
const J = fs.readFileSync(__dirname + '/replace-month.js', 'utf8');
const A = fs.readFileSync(__dirname + '/month-apply.js', 'utf8');
let pass = 0, fail = 0; const bad = [];
const ok = (n, cond) => { cond ? pass++ : (fail++, bad.push(n)); };

/* ── mounted ── */
ok('settings.html has the #rmCard host', /id="rmCard"/.test(H));
ok('  with a body to render into', /id="rmBody"/.test(H));
ok('  and a nav chip', /\['rmCard', 'Replace month'\]/.test(H));
ok('  ordered above Data and Danger', H.indexOf("['rmCard'") < H.indexOf("['dmCard'"));
ok('the card sits above Data Management in the DOM too', H.indexOf('id="rmCard"') < H.indexOf('id="dmCard"'));

/* ── scripts, in dependency order ── */
const at = s => H.indexOf(s);
ok('sources-core.js is loaded', at('./sources-core.js') > 0);
ok('month-apply.js is loaded', at('./month-apply.js') > 0);
ok('replace-month.js is loaded', at('./replace-month.js') > 0);
ok('  sources-core before month-apply', at('./sources-core.js') < at('./month-apply.js'));
ok('  shell.js before replace-month (it calls QLShell)', at('./shell.js') < at('./replace-month.js'));
ok('  every src keeps the ./ prefix version-sync requires', !/src="replace-month\.js/.test(H));

/* ── rendered through all three doors, or it is blank on arrival ── */
ok('renderRm is defined', /function renderRm\(/.test(H));
const lineWith = s => (H.split('\n').find(l => l.includes(s)) || '');
ok('  called on first init', /renderRm\(\)/.test(lineWith('QLD.init(')));
ok('  called on refresh', /renderRm\(\)/.test(lineWith('window.__qlRefresh =')));
ok('  called on company switch', /renderRm\(\)/.test(lineWith('window.__qlOnSwitchCompany =')));
/* switching firm mid-wizard must not leave a modal open over the new book */
ok('  and the switch closes any open modal first', /__qlOnSwitchCompany = \(\) => \{ QLShell\.closeModal\(\)/.test(H));

/* ── owner gate FAILS CLOSED ──────────────────────────────────────────
   settings.html's own _isOwner() reads `_plant().role || 'owner'`, so a
   login with no role field is treated as an owner. Fine for reading a card,
   wrong for emptying a month of the books. */
const rm = H.slice(H.indexOf('function renderRm('), H.indexOf('function renderRm(') + 700);
ok('the owner check does NOT default to owner', !/role \|\| 'owner'/.test(rm));
ok('  a missing role means NOT owner', /role \?[^:]*: false/.test(rm));
ok('  and the card is hidden for everyone else', /display = owner \? '' : 'none'/.test(rm));

/* ── the modal choices that matter ── */
/* Check for the CALL, not the word — the file's header explains at length
   why confirmDelete is the wrong tool here, and that prose is not a bug. */
ok('does NOT use confirmDelete (it escapes the body and closes on failure)', !/QLShell\.confirmDelete\s*\(/.test(J));
ok('uses panel() for the preview', /QLShell\.panel\(/.test(J));
ok('uses openForm for the gate (it honours return false)', /QLShell\.openForm\(/.test(J));
ok('the gate returns false on a wrong month', /return false/.test(J));
ok('confirmation is the MONTH, not the word DELETE', /Type ' \+ label\.toUpperCase\(\)/.test(J));
ok('  and a mismatch names the month actually picked', /That is not the month you picked/.test(J));
ok('the firm is re-checked at save time', /QLD\.activeCo !== firmAtStart/.test(J));
ok('the plan is re-derived against the live book', /MA\.verify\(plan/.test(J));
ok('a single month is enforced', /\^\\d\{4\}-\\d\{2\}\$/.test(J));

/* ── the blob is assembled explicitly, never QLD.blob() ── */
ok('reads the live arrays directly', /sales: S\.SALES/.test(J));
ok('  under the PERSISTED reconcile key', /reconcile: S\.RECON/.test(J));
ok('  and never calls QLD.blob()', !/(window\.)?QLD\.blob\s*\(\s*\)?[^)]*\)/.test(J.replace(/\/\*[\s\S]*?\*\//g, '')));

/* ── held-back sources say why, and offer no button ── */
ok('payments is held back', /payments: \{ on: false/.test(J));
ok('  with the real reason (invoice keeps the paid tick)', /still ticked as paid/.test(J));
ok('bank is held back', /bank: \{ on: false/.test(J));
ok('  with the real reason (statements span months / sha gate)', /cover several months/.test(J));
ok('a held-back source renders no action button', /months\.length && r\.on \? `<button/.test(J));

/* ── the applier keeps the promises the copy makes ── */
ok('applier never splices sales/purchases/cashbook', !/\b(sales|purchases|cashbook)\.splice\(/.test(A));
ok('  rows are soft-deleted', /r\._del = stamp/.test(A));
ok('  a receipt keeps its amount, loses only the tick', /e\.link\.idx = null/.test(A));
ok('  and link is never nulled wholesale', !/e\.link = null/.test(A));
ok('  bank txns ARE spliced (id-keyed, nothing indexes into them)', /ctx\.txns\.splice/.test(A));
ok('  statements ARE spliced (a _del row still blocks the sha gate)', /ctx\.statements\.splice/.test(A));
ok('  exactly one audit row per month', /'MONTH:' \+ plan\.ym/.test(A));
ok('  and one commit', (A.match(/ctx\.commit\(\)/g) || []).length === 1);

console.log('\n════ replace-month (wired into Settings) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' REPLACE-MONTH TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
