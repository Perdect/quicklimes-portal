/* freight-edit.test.js — freight typed into the table, and the landed cost it feeds.
 *
 * "give fright option editable from the table I can add amount directly / when I add
 *  fright amount then show total amount with petcoke or fright + then show tatal so
 *  that we can get correct amount of petcoke cost"
 *
 * Landed cost already existed (bill total + freight). What did not exist was any way
 * to PUT the freight in from the table — it lived in the drawer's Freight tab, so
 * the column was a row of dashes you could look at and not fix.
 *
 * THE RULE THAT MATTERS. data.js:939 — freight PAYMENTS supersede the manual number
 * ("payments are the truth"). So writing freightAmt on a bill that has payments is a
 * write that goes nowhere: the cell keeps showing the old figure and the user thinks
 * the app lost their edit. That silent-swallow is the bug this file exists to stop.
 *
 *   node freight-edit.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ freight · edited in the table, feeding landed cost ═══\n');

const dsrc = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
const psrc = fs.readFileSync(path.join(__dirname, 'purchase.js'), 'utf8');

/* ══════════ 1. THE LANDED-COST MATH — the user's actual question ══════════
   "petcoke + freight = the correct cost of petcoke". Driven through the REAL
   purchaseRows out of data.js. */
{
  function grabLine(k) { const i = dsrc.indexOf(k); return dsrc.slice(i, dsrc.indexOf('\n', i)); }
  function grabBlock(k, end) { const i = dsrc.indexOf(k); return dsrc.slice(i, dsrc.indexOf(end, i) + end.length); }

  const S = { PURCHASES: [], PARTIES: [] };
  const ctx = {
    console, S, Math, Object, Array, Number, String, isNaN, parseFloat, Date, JSON,
    todayISO: '2026-07-16', cleanSup: p => p.sup || '', partyGstin: () => '',
    withIdx: arr => arr.map((r, i) => [r, i]).filter(([r]) => !r._del && !r._arch),
    catToGroupItem: p => ({ group: p.group || 'petcoke', item: p.item || 'Petcoke Purchase', dept: '' }),
    PGROUP_MAP: { petcoke: { label: 'Petcoke', emoji: '🔥' }, limestone: { label: 'Limestone', emoji: '🪨' } },
    itemIcon: () => '', toISODate: d => d, fmtISO: () => '2026-07-16', daysAgo: () => 0,
    /* purchaseRows stamps createdBy from QL_PLANT — a real dependency, not a bug.
       Stubbed rather than hidden: the alternative was trimming the slice until the
       error went away, which is how a test ends up not running the real code. */
    QL_PLANT: { owner_name: 'Sameer', plant_name: 'Gotan Lime Industries' }
  };
  vm.createContext(ctx);
  vm.runInContext([
    grabLine('const cP = p =>'),
    grabLine('const isFreightItem = it =>'),
    grabBlock('function purchaseRows()', '\n  }'),
    'this.purchaseRows = purchaseRows;'
  ].join('\n'), ctx);
  ok(typeof ctx.purchaseRows === 'function', 'the REAL purchaseRows loaded out of data.js');

  const reset = () => { S.PURCHASES.length = 0; };
  const bill = o => Object.assign({ taxable: 411973, grate: 18, status: 'pending', group: 'petcoke', item: 'Petcoke Purchase' }, o);

  /* His real Indian Oil bill: ₹4,11,973 taxable, 18% GST → ₹4,86,128 total. */
  reset(); S.PURCHASES.push(bill({}));
  let r = ctx.purchaseRows()[0];
  eq('a petcoke bill with no freight: landed = the bill total', Math.round(r.landed), Math.round(r.total));
  eq('  and no freight is shown', r.freightAmt, 0);

  /* Add ₹40,000 of freight — the thing he wants to type in. */
  reset(); S.PURCHASES.push(bill({ freightAmt: 40000 }));
  r = ctx.purchaseRows()[0];
  eq('THE ASK: freight added → landed = bill + freight', Math.round(r.landed), Math.round(r.total) + 40000);
  eq('  the freight is shown', r.freightAmt, 40000);
  ok(r.landed > r.total, '  landed cost is now HIGHER than the bill — which is the point');

  /* PAYMENTS BEAT THE MANUAL NUMBER. If both exist, payments win — so an edit to
     freightAmt here is silently ignored, which is exactly why the UI must refuse. */
  reset(); S.PURCHASES.push(bill({ freightAmt: 40000, freightPays: [{ amount: 55000 }] }));
  r = ctx.purchaseRows()[0];
  eq('freight PAYMENTS supersede the manual number', r.freightAmt, 55000);
  ok(r.freightAmt !== 40000, '  the manual 40,000 is ignored — this is why the table must not offer to edit it');

  /* Multiple payments sum. */
  reset(); S.PURCHASES.push(bill({ freightPays: [{ amount: 30000 }, { amount: 25000 }] }));
  eq('several freight payments add up', ctx.purchaseRows()[0].freightAmt, 55000);

  /* A FREIGHT BILL is itself the freight — its own add-on must not be added twice.
     freightAmt must be NON-ZERO here: with 0 the guard and its absence compute the
     same number, so the double-count mutation survived until this fixture carried a
     real amount. A test whose fixture cannot distinguish the two is not testing. */
  reset(); S.PURCHASES.push(bill({ item: 'Petcoke Transport Freight', taxable: 40000, freightAmt: 5000 }));
  r = ctx.purchaseRows()[0];
  eq('a freight BILL does not add an add-on to its own landed cost', Math.round(r.landed), Math.round(r.total));
  ok(r.freight, '  and it is marked as freight');
  eq('  its freightAmt IS its own taxable value, not the add-on', Math.round(r.freightAmt), 40000);
  eq('  and the add-on it carries is zeroed, so nothing is counted twice', Math.round(r.freightAddon), 0);

  /* The material bill beside it is where an add-on DOES belong. */
  reset(); S.PURCHASES.push(bill({ item: 'Petcoke Purchase', taxable: 411973, freightAmt: 5000 }));
  r = ctx.purchaseRows()[0];
  eq('a MATERIAL bill DOES carry its freight add-on into landed cost', Math.round(r.landed), Math.round(r.total) + 5000);
  eq('  and reports it as an add-on', Math.round(r.freightAddon), 5000);

  /* Cancelled/junk must not poison the figure. */
  reset(); S.PURCHASES.push(bill({ freightAmt: 'abc' }));
  ok(!isNaN(ctx.purchaseRows()[0].landed), 'a junk freight value does not turn landed cost into NaN');
}

/* ══════════ 2. THE EDITOR REFUSES WHAT WOULD BE SWALLOWED ══════════ */
{
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const code = strip(psrc);
  const fn = (code.match(/function editFreight\(idx\)[\s\S]{0,1200}/) || [''])[0];

  ok(/freightPays \|\| \[\]\)\.length/.test(fn),
    'THE RULE: editFreight REFUSES a bill that has freight payments — writing freightAmt there is silently ignored');
  ok(/Freight tab/.test(fn), '  and points at the tab that actually owns it');
  ok(/if \(v === null\) return;/.test(fn), 'Cancel does nothing — it is not the same as clearing');
  ok(/if \(t === ''\)[\s\S]{0,80}freightAmt: 0/.test(fn), 'a blank CLEARS the freight (deliberate, and distinct from cancel)');
  ok(/if \(!\(n > 0\)\)[\s\S]{0,60}nothing saved/.test(fn),
    'junk is REFUSED, not stored as 0 — a silent 0 reads as "no freight", a different fact from a typo');
  ok(/updatePurchase\(idx, \{ freightAmt: n \}\)/.test(fn), 'a real amount is written through the real mutation');
  ok(/landed cost/.test(fn), 'the toast reports the new LANDED cost — the number he actually wanted');

  /* The cell must not offer an edit it will refuse. */
  const cell = (code.match(/key: 'freightAmt'[\s\S]{0,700}/) || [''])[0];
  ok(/const paid = \(r\.freightPays \|\| \[\]\)\.length;/.test(cell), 'the cell checks for payments before offering a button');
  ok(/if \(paid\) return/.test(cell), '  and a paid bill renders as text, not as an editable control');
  ok(/data-fr="\$\{r\.idx\}"/.test(cell), '  an editable bill renders a button carrying its row index');
}

/* ══════════ 3. THE CLICK SURVIVES A RE-RENDER ══════════
   qlx rebuilds the whole table on every sort/filter/refresh. Anything bound to a
   cell is dead the moment the user sorts a column. */
{
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const code = strip(psrc);
  ok(/document\.addEventListener\('click'[\s\S]{0,200}data-fr/.test(code),
    'the freight click is DELEGATED from the document — a per-cell binding dies on the next re-render');
  ok(/closest\('\[data-fr\]'\)/.test(code), '  matched with closest(), so a click on the inner text still counts');
  ok(/e\.stopPropagation\(\)/.test(code), '  and it stops the event reaching qlx\'s row handlers above it');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
