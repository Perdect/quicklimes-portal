/* qlx-remount.test.js — a tabbed workspace can swap registers without
 * cloning the shell, and each tab keeps its own persisted state.
 * Static assertions against the real file: the failure mode here (a second
 * sidebar appearing) is a DOM accident that no unit test would catch, so we
 * pin the code shape that prevents it. Run: node qlx-remount.test.js */
const fs = require('fs');
const Q = fs.readFileSync(__dirname + '/qlx.js', 'utf8');
let pass = 0, fail = 0; const bad = [];
const ok = (n, c) => { c ? pass++ : (fail++, bad.push(n)); };

ok('remount() exists', /function remount\(config\)/.test(Q));
ok('  and is exported', /mount, remount, refresh/.test(Q));
ok('  it does NOT call QLShell.mount', !/function remount\(config\)[\s\S]{0,700}QLShell\.mount/.test(Q));
ok('  it does NOT re-register the QLD paint driver', !/function remount\(config\)[\s\S]{0,700}Q\.init\(/.test(Q));
/* Slice the ACTUAL function body by brace-matching: a fixed character window
   runs straight past the closing brace into `function ensureChrome()` itself,
   which declares the thing rather than calling it. */
const rmStart = Q.indexOf('function remount(config)');
let depth = 0, rmEnd = rmStart;
for (let i = Q.indexOf('{', rmStart); i < Q.length; i++) {
  if (Q[i] === '{') depth++; else if (Q[i] === '}') { depth--; if (!depth) { rmEnd = i; break; } }
}
const RM = Q.slice(rmStart, rmEnd + 1);
ok('  it does NOT re-run ensureChrome (keydown listeners would stack)', !/ensureChrome\(\)/.test(RM));
ok('  and refresh() does not run it either', !/function refresh\(\)[^\n]*ensureChrome/.test(Q));
ok('  it swaps CFG and takes fresh state', /function remount\(config\)[\s\S]{0,400}CFG = config; S = freshState\(\)/.test(Q));
ok('  and falls back to a real mount when nothing is mounted yet', /if \(!_mounted \|\| !document\.getElementById\('qxRoot'\)\) return mount\(config\)/.test(Q));
ok('mount() sets the mounted flag', /_mounted = true/.test(Q));

/* per-tab state isolation */
ok('stateKey() exists', /function stateKey\(\) \{ return CFG\.stateKey \|\| CFG\.active; \}/.test(Q));
ok('  hidden columns read through it', /localStorage\.getItem\('qx_hidden_' \+ stateKey\(\)/.test(Q));
ok('  and write through it', /localStorage\.setItem\('qx_hidden_' \+ stateKey\(\)/.test(Q));
ok('  defaulting to CFG.active so existing registers do not move', /CFG\.stateKey \|\| CFG\.active/.test(Q));
ok('no qx_hidden_ key still uses CFG.active directly', !/qx_hidden_' \+ CFG\.active/.test(Q));

/* pagination contract (landed alongside) */
ok('pagination is opt-in', /CFG\.paginate/.test(Q));
ok('footer totals use the FULL filtered set', /footHTML\(allRows\)/.test(Q));
ok('grouped views are not paginated', /!\(CFG\.groupBy && S\.groupBy\)/.test(Q));
ok('the page is clamped after filtering', /if \(page !== S\.page\) S\.page = page/.test(Q));
ok('sorting resets to page 1', /S\.sort\.dir = 'asc'; \} S\.page = 1; render\(\)/.test(Q));
ok('the pager emits the already-styled markup', /class="qx-pager"/.test(Q) && /class="qx-pg"/.test(Q));
ok('  with the ERP\'s own wording', /Showing \$\{p\.from\}–\$\{p\.to\} of \$\{p\.total\}/.test(Q));

console.log('\n════ qlx remount + state isolation ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' QLX-REMOUNT TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
