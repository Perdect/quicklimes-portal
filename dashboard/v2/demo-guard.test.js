/* THE DEMO GUARD, EXECUTED — not grep'd.

   isDemoCo() shipped referencing `co`, which exists as a getter on the QLD
   export but NOT inside data.js's scope. Every page calls paintWorkspace at
   mount; paintWorkspace calls isDemoCo; the ReferenceError killed the caller's
   whole inline script — every page rendered chrome-only for signed-in users.
   node --check cannot catch a free identifier, so this test RUNS the real
   functions the way the shell does. */
'use strict';
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/data.js', 'utf8');
let pass = 0, fail = 0; const bad = [];
const ok = (m, c) => { if (c) pass++; else { fail++; bad.push(m); } };

function grab(start, end) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error('not found: ' + start);
  return src.slice(i, src.indexOf(end, i) + end.length);
}
const F_IS = grab('function isDemoCo()', '\n  }');
const F_INSTALL = grab('function installDemo(seed)', '\n  }');

/* the ONLY environment the functions may assume: what data.js itself provides */
function ctxWith(coName, hasDemo) {
  const S = { SALES: [], PURCHASES: [], PROD: [], EXPENSES: [], PARTIES: [], CASHBOOK: [] };
  const ctx = {
    COMPANIES: { A: { key: 'A', name: (coName || '').toUpperCase(), short: coName } },
    ACTIVE_CO: 'A', S,
    window: { QLDemo: hasDemo ? { generate: () => ({ demo: { seed: 1 }, sales: [{ inv: 'X' }], purchases: [], prod: [], expenses: [], parties: [], cashbook: [] }) } : undefined },
    clearState: () => { Object.keys(S).forEach(k => S[k].length = 0); },
    hydrate: d => { if (d.sales) S.SALES.push(...d.sales); },
    commit: () => { ctx._committed = true; },
    logAudit: () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(F_IS + '\n' + F_INSTALL + '\nthis.isDemoCo = isDemoCo; this.installDemo = installDemo;', ctx);
  return ctx;
}

/* 1 · the crash: isDemoCo must run with NOTHING but data.js's own scope */
{
  let r, threw = null;
  try { r = ctxWith('Gotan Lime Industries').isDemoCo(); } catch (e) { threw = e.message; }
  ok('isDemoCo runs without a free `co` (threw: ' + threw + ')', threw === null);
  ok('  and a real firm is NOT demo', r === false);
  ok('  a DEMO-named firm is', ctxWith('Gotan Lime DEMO').isDemoCo() === true);
  ok('  case-insensitive', ctxWith('demo works').isDemoCo() === true);
}

/* 2 · the guard: installDemo refuses real companies, installs into demo ones */
{
  const real = ctxWith('Gotan Lime Industries', true);
  const r1 = real.installDemo();
  ok('installDemo REFUSES a real company', r1 && r1.ok === false && /demo/i.test(r1.err));
  ok('  and wrote nothing', real.S.SALES.length === 0 && !real._committed);
  const demo = ctxWith('Gotan Lime DEMO', true);
  const r2 = demo.installDemo();
  ok('installDemo fills a demo company', r2 && r2.ok === true && demo.S.SALES.length === 1 && demo._committed === true);
  const noSeed = ctxWith('Gotan Lime DEMO', false);
  const r3 = noSeed.installDemo();
  ok('missing demo-seed.js is an error, not a crash', r3 && r3.ok === false && /demo-seed/.test(r3.err));
}

console.log('\n════ demo guard (executed, not grep\'d) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' GUARD TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
