/* inventory.test.js — a card must never print a number that is a lie.
 *
 * WHAT WENT WRONG
 * ───────────────
 * The Inventory page showed the user — a lime manufacturer — this:
 *
 *     Limestone      0 T      9 purchase bills      ₹44,71,494      ₹0/T
 *
 * He has not got "no limestone". He has got nine bills and nobody wrote the
 * tonnage on any of them. The card said the first thing while the truth was the
 * second, because of one character:
 *
 *     const qty = rs.reduce((a, r) => a + (+r.qty || 0), 0);   // ← `|| 0`
 *
 * `(+r.qty || 0)` turns MISSING into ZERO, and the sum then gets printed as a
 * fact. "You have none" and "we never measured" are different statements, and he
 * can act on both — which makes the silent one worse than a blank.
 *
 * AND IT WAS NOT ONLY LIMESTONE. Petcoke rendered 97.7 T against ₹75,22,976 —
 * an implied ₹77,001 a tonne. Petcoke is ₹8,000–18,000 a tonne. The bills are
 * fine; only a few of the sixteen carry tonnage and the card summed the rest as
 * zero, so the division was nonsense. That rate is the loudest signal in the
 * whole dataset that quantities are missing, and the page printed it as a
 * feature. (The chemistry agrees: 4,416.5 T of quick lime dispatched needs
 * ~440–660 T of petcoke, and ₹75,22,976 at ₹12,000/T buys ~627 T. The MONEY is
 * right. The QUANTITIES are missing.)
 *
 * WHAT THIS FILE PINS
 * ───────────────────
 * These tests drive the page's REAL render() — the whole inline script of
 * inventory.html, loaded in a stubbed browser, with the REAL monthLabel() out of
 * data.js. Not a copy of the logic. A copy proves the copy: this project has
 * already shipped a green engine test over a router that never called the
 * engine (see recon-wiring.test.js), so the assertions below read the HTML the
 * user would actually have on screen.
 *
 * Every assertion here has been mutation-tested — the code was broken on purpose
 * (`|| 0` restored, tonnage hardcoded, the warning made constant, the filter
 * made a no-op, stopPropagation deleted) and each mutation was confirmed to turn
 * this file red.
 *
 *   node inventory.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(a === b, m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));
/* JSON-compare, not ===: two arrays are never ===, and this reported
   "got: [] expected: []" as a FAILURE. monthlabel.test.js carries the same note. */
const jeq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));
const near = (m, a, b, tol) => ok(Math.abs(a - b) <= (tol == null ? 0.5 : tol), m + '\n     got: ' + a + '  expected: ~' + b);

const HTML = fs.readFileSync(path.join(__dirname, 'inventory.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, 'inventory.css'), 'utf8');

console.log('\n═══ inventory — never print a number that is a lie ═══\n');

/* ══════════════════════════════════════════════════════════════════════════
   0. THE REAL monthLabel, OUT OF data.js
   The page must not hand-roll "March 2026" — five places once built that string
   from scratch and the screens disagreed with each other (monthlabel.test.js).
   ══════════════════════════════════════════════════════════════════════════ */
const dataSrc = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
const mlAt = dataSrc.indexOf('function monthLabel(ym, opts)');
const mlCtx = { console, Date, String, RegExp, isNaN };
vm.createContext(mlCtx);
vm.runInContext(dataSrc.slice(mlAt, dataSrc.indexOf('\n  }', mlAt) + 4) + '\nthis.monthLabel = monthLabel;', mlCtx);
const realMonthLabel = mlCtx.monthLabel;
eq('data.js still owns monthLabel (this test leans on the real one)', realMonthLabel('2026-03'), 'March 2026');

/* ══════════════════════════════════════════════════════════════════════════
   1. A BROWSER, STUBBED JUST ENOUGH TO LOAD THE PAGE
   ══════════════════════════════════════════════════════════════════════════ */
const noop = () => {};

/* Slice the two pure chrome builders out of qlx.js and make them callable. */
function buildQLXChrome() {
  const qlx = fs.readFileSync(path.join(__dirname, 'qlx.js'), 'utf8');
  const grab = name => {
    const i = qlx.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('qlx.js no longer defines ' + name + ' — the shared chrome moved');
    const open = qlx.indexOf('{', i);
    let j = open + 1, d = 1;
    while (j < qlx.length && d > 0) { const c = qlx[j]; if (c === '{') d++; else if (c === '}') d--; j++; }
    return qlx.slice(i, j);
  };
  const sandbox = {
    esc: x => (x == null ? '' : String(x)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    svg: b => '<svg>' + (b || '') + '</svg>',
    IC: { plus: '<plus/>', file: '<file/>' }
  };
  vm.createContext(sandbox);
  vm.runInContext(grab('heroMarkup') + '\n' + grab('statsMarkup') +
    '\n;this.__c = { heroHTML: heroMarkup, statsHTML: statsMarkup, wireHero: function(){} };', sandbox);
  return sandbox.__c;
}

function loadPage(fx) {
  const script = /<script>\n([\s\S]*?)\n<\/script>\s*<\/body>/.exec(HTML);
  if (!script) throw new Error('could not find the page script in inventory.html');

  const els = {};
  const mkEl = id => els[id] || (els[id] = {
    id, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, onclick: null,
    classList: { add: noop, remove: noop, contains: () => false, toggle: noop },
    querySelectorAll: () => [], contains: () => false, appendChild: noop, removeChild: noop,
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 30, right: 100 })
  });
  const doc = {
    getElementById: id => mkEl(id),
    querySelector: s => mkEl(String(s).replace(/^#/, '')),
    querySelectorAll: () => [],
    createElement: () => ({
      className: '', style: {}, innerHTML: '', offsetWidth: 268, parentNode: null,
      querySelectorAll: () => [], contains: () => false, appendChild: noop
    }),
    addEventListener: noop, removeEventListener: noop,
    body: { appendChild: noop, removeChild: noop }, documentElement: mkEl('html')
  };

  let renderFn = null;
  const QLD = {
    purchaseRows: () => fx.purchases || [],
    salesRows: () => fx.sales || [],
    productionRows: () => fx.prod || [],
    monthLabel: realMonthLabel,
    fC: n => '₹' + Math.round(+n || 0).toLocaleString('en-IN'),
    fDS: d => String(d || ''),
    uiMonth: () => fx.uiMonth || null,
    setUiMonth: noop,
    co: { short: 'GOTAN', name: 'Gotan Lime Industries' },
    init: fn => { renderFn = fn; }          // hold it — the tests drive render() themselves
  };
  const ctx = {
    console, Date, Math, Number, String, Array, Set, Map, JSON, RegExp, isNaN, parseFloat, parseInt,
    document: doc, QLD,
    window: { QLD, scrollY: 0, innerWidth: 1280, addEventListener: noop },
    /* monthButton/monthPicker are the app's ONE month picker (shell.js). The stub
       echoes the label into the markup because that is exactly what the assertions
       below care about: that the PAGE hands the picker the right label ("March
       2026" from QLD.monthLabel). The real button's chrome is shell.js's business
       and monthpicker.test.js's to pin — not this file's. */
    QLShell: {
      mount: noop, toast: noop, modal: noop, panel: noop,
      monthButton: o => `<button class="ql-mp-btn" id="${o.id}">${o.label}</button>`,
      monthPicker: noop, closeMonthPicker: noop
    },
    QLMobile: null, setTimeout: noop, clearTimeout: noop,
    location: { href: '' },
    /* THE REAL SHARED CHROME, not a stub. heroMarkup/statsMarkup are sliced
       straight out of qlx.js and run here, so these assertions fail if the
       registers' header or stat row changes shape and Inventory is left
       behind. A hand-written stub would have proved only the stub — the same
       reason the page core is extracted rather than copied. Only esc/svg/IC
       are shimmed; they affect escaping and icon bodies, never the structure
       being asserted. */
    QLX: buildQLXChrome()
  };
  ctx.window.document = doc;
  vm.createContext(ctx);
  vm.runInContext(script[1] + `
    ;this.__X = { invModel, invCard, invStock, invFgStock, invRateFlag, invInPeriod, invUpto,
                  invPeriodEnd, invMonths, invHasQty, invLive, qtyBlock, cardHTML, render,
                  MATS: INV_MATERIALS, FG: INV_FG };
  `, ctx);
  return { X: ctx.__X, els, render: () => ctx.__X.render(), setP: p => vm.runInContext('PERIOD = ' + JSON.stringify(p), ctx) };
}

/* ══════════════════════════════════════════════════════════════════════════
   2. THE FIXTURES — the user's real numbers
   Shaped the way data.js hands rows to the page: purchaseRows() maps
   `qty: p.qty || 0`, so a bill that never had a tonnage arrives here as 0. That
   is exactly the ambiguity the page has to survive.
   ══════════════════════════════════════════════════════════════════════════ */
const bill = (o) => Object.assign({
  group: 'limestone', item: 'Limestone Purchase', freight: false,
  date: '2026-03-10', taxable: 0, total: 0, qty: 0, status: 'pending', bill: 'B1'
}, o);

// 9 limestone bills, ₹44,71,494, not one tonnage among them.
const LIMESTONE_9 = Array.from({ length: 9 }, (_, i) =>
  bill({ bill: 'LS/' + i, taxable: i === 8 ? 4471494 - 8 * 496832 : 496832, qty: 0 }));
// 16 petcoke bills, ₹75,22,976 — only 3 carry tonnage, summing 97.7 T.
const PETCOKE_16 = Array.from({ length: 16 }, (_, i) =>
  bill({ group: 'petcoke', item: 'Petcoke Purchase', bill: 'PC/' + i,
         taxable: i === 15 ? 7522976 - 15 * 470186 : 470186,
         qty: i < 3 ? [40.2, 31.5, 26.0][i] : 0 }));
// 1 plastic-bag bill, ₹1,04,000, no count.
const BAGS_1 = [bill({ group: 'packaging', item: 'Plastic Bags', bill: 'PB/1', taxable: 104000, qty: 0 })];
// Quick lime dispatched: 4,416.5 T for ₹2,34,80,277 — raised in-app, qty × rate, so real.
const SALES_REAL = [
  { inv: 'S/1', date: '2026-03-12', qty: 2200.0, taxable: 11695000, total: 12300000, status: 'paid' },
  { inv: 'S/2', date: '2026-03-20', qty: 2216.5, taxable: 11785277, total: 12400000, status: 'pending' }
];
const sumQ = SALES_REAL.reduce((a, r) => a + r.qty, 0);
const sumV = SALES_REAL.reduce((a, r) => a + r.taxable, 0);
eq('fixture sanity — sales tonnage is the real 4,416.5 T', sumQ, 4416.5);
eq('fixture sanity — sales value is the real ₹2,34,80,277', sumV, 23480277);
eq('fixture sanity — petcoke value is the real ₹75,22,976', PETCOKE_16.reduce((a, r) => a + r.taxable, 0), 7522976);
near('fixture sanity — petcoke recorded tonnage is the real 97.7 T', PETCOKE_16.reduce((a, r) => a + r.qty, 0), 97.7, 0.001);
eq('fixture sanity — limestone value is the real ₹44,71,494', LIMESTONE_9.reduce((a, r) => a + r.taxable, 0), 4471494);

const FULL = { purchases: LIMESTONE_9.concat(PETCOKE_16, BAGS_1), sales: SALES_REAL, prod: [] };

/* ══════════════════════════════════════════════════════════════════════════
   3. NO BILL HAS A QUANTITY → "not recorded". NOT "0 T". NOT ₹0/T.
   The headline defect, asserted on the HTML the user would be reading.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const p = loadPage({ purchases: LIMESTONE_9, sales: [], prod: [] });
  const found = p.X.invModel(LIMESTONE_9, [], [], 'all').raw.find(x => x.key === 'limestone');
  /* `|| {}` so a missing card FAILS every assertion below instead of throwing on
     the first deref. A test that dies mid-run reports one crash and silently
     skips the rest — mutation testing surfaced exactly that here. */
  const c = found || {};

  ok(found, 'limestone gets a card — nine bills exist, they must be visible');
  eq('  its state is "unknown", not a total', c.state, 'unknown');
  eq('  qty is null — the ABSENCE of a measurement, never the number zero', c.qty, null);
  ok(c.qty !== 0, '  qty is not 0: `+r.qty || 0` turned "nobody measured" into "you have none"');
  eq('  it counts the bills that should have carried a quantity', c.missingQty, 9);
  eq('  none of them did', c.withQty, 0);
  eq('  the MONEY is real and complete and stays confident', c.value, 4471494);
  eq('  no average rate is offered — ₹44,71,494 ÷ nothing is not a rate', c.rate, null);

  p.setP('all'); p.render();
  const h = p.els.invBody.innerHTML;
  ok(/Not recorded/.test(h), '  the card SAYS "Not recorded"');
  ok(!/>0<u>T<\/u>|>0 <u>T<\/u>/.test(h), '  the card never renders "0 T" for limestone');
  ok(!/₹0\/T/.test(h), '  the card never renders "₹0/T"');
  ok(!/Avg rate/.test(h.split('Petcoke')[0]), '  no "Avg rate" row at all on an unmeasured card');
  ok(/9 bills/.test(h), '  it says how many bills are behind the gap');
  ok(/₹44,71,494/.test(h), '  it still shows the real money');
  ok(/purchase/.test(h) && /Record the quantities/.test(h), '  and routes the user somewhere he can fix it');
}

/* ══════════════════════════════════════════════════════════════════════════
   4. SOME BILLS HAVE A QUANTITY → the partial figure, labelled as partial.
   A floor must never masquerade as a total.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const p = loadPage({ purchases: PETCOKE_16, sales: [], prod: [] });
  const c = p.X.invModel(PETCOKE_16, [], [], 'all').raw.find(x => x.key === 'petcoke') || {};

  eq('petcoke is "partial" — some bills measured, most not', c.state, 'partial');
  near('  it shows the tonnage it can actually stand behind', c.qty, 97.7, 0.001);
  eq('  from 3 bills', c.withQty, 3);
  eq('  and it knows 13 are missing', c.missingQty, 13);
  eq('  the value is all 16 bills — the money is not in doubt', c.value, 7522976);
  eq('  BUT the average rate is suppressed: ₹75,22,976 ÷ 97.7 is arithmetic on missing data', c.rate, null);

  p.setP('all'); p.render();
  const h = p.els.invBody.innerHTML;
  ok(/97\.7/.test(h), '  the partial tonnage is shown (hiding it would waste real data)');
  ok(/from 3 of 16 bills/.test(h), '  ...labelled with exactly how partial it is');
  ok(/13 carry no quantity/.test(h), '  ...and how many bills are behind the gap');
  ok(/floor, not a total/.test(h), '  ...and told plainly that it is a floor, not a total');
  /* The ₹77,001/T number is allowed to appear ONCE — inside the warning, named
     as impossible. What it must never be is the card's stated Avg rate. A kv row
     renders its value as a bare `<b>₹.../T</b>`; the warning never does. */
  ok(!/<b>₹\d{2},\d{3}\/T<\/b>/.test(h), '  the ₹77,001/T figure is never presented as the rate');
  ok(/Avg rate<\/span><b class="off">Needs all quantities<\/b>/.test(h),
    '  the rate row says why it is empty rather than showing a number');
}

/* ══════════════════════════════════════════════════════════════════════════
   5. EVERY BILL HAS A QUANTITY → a clean total and a real rate.
   The honest path must still work, or the fix is just a refusal to compute.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const rows = [
    bill({ group: 'petcoke', item: 'Petcoke Purchase', bill: 'A', taxable: 1200000, qty: 100 }),
    bill({ group: 'petcoke', item: 'Petcoke Purchase', bill: 'B', taxable: 2400000, qty: 200 })
  ];
  const p = loadPage({ purchases: rows, sales: [], prod: [] });
  const c = p.X.invModel(rows, [], [], 'all').raw.find(x => x.key === 'petcoke') || {};

  eq('all measured → "complete"', c.state, 'complete');
  eq('  a clean total', c.qty, 300);
  eq('  no bills missing', c.missingQty, 0);
  eq('  and a real average rate: ₹36,00,000 / 300 T', c.rate, 12000);
  eq('  which is plausible, so nothing is flagged', c.flag, null);

  p.setP('all'); p.render();
  const h = p.els.invBody.innerHTML;
  ok(/300<u>T<\/u>/.test(h), '  the total renders');
  ok(/Avg rate/.test(h) && /₹12,000\/T/.test(h), '  the rate renders, because this one is earned');
  ok(!/floor, not a total|Not recorded/.test(h), '  and none of the hedging language appears on good data');
}

/* ══════════════════════════════════════════════════════════════════════════
   6. NO BILLS AT ALL ≠ BILLS WITH NO QUANTITY.
   These are different answers to different questions and must never look alike.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const none = loadPage({ purchases: [], sales: [], prod: [] });
  const mNone = none.X.invModel([], [], [], 'all');
  eq('no bills → no limestone card at all', mNone.raw.find(c => c.key === 'limestone'), undefined);
  eq('no bills → nothing is "missing" either — there is simply nothing', mNone.missingBills, 0);
  none.setP('all'); none.render();
  const hNone = none.els.invBody.innerHTML;

  const some = loadPage({ purchases: LIMESTONE_9, sales: [], prod: [] });
  some.setP('all'); some.render();
  const hSome = some.els.invBody.innerHTML;

  ok(/No raw-material purchases yet/.test(hNone), 'genuinely-empty says "no purchases yet"');
  ok(!/Not recorded/.test(hNone), '  and never says "not recorded" — there is nothing to record about');
  ok(!/9 bills/.test(hNone), '  and invents no bills');
  ok(/Not recorded/.test(hSome), 'bills-without-quantity says "Not recorded"');
  ok(!/No raw-material purchases yet/.test(hSome), '  and never claims there are no purchases — there are nine');
  ok(hNone !== hSome, 'the two states do not render the same HTML');
  ok(!/>0<u>/.test(hNone) && !/>0<u>/.test(hSome), 'neither state ever prints a bare 0 as a quantity');
}

/* ══════════════════════════════════════════════════════════════════════════
   7. THE IMPLAUSIBLE-RATE WARNING — the loudest signal in the dataset.
   Fires on the real petcoke numbers. Silent on the real quick-lime numbers.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const p = loadPage(FULL);
  const M = p.X.invModel(FULL.purchases, FULL.sales, [], 'all');
  const pc = M.raw.find(c => c.key === 'petcoke') || {};
  const fg = M.fg || {};
  const F = pc.flag || {};    // see §3 — assertions must fail, not throw

  ok(pc.flag, 'FIRES on the real petcoke: ₹75,22,976 over 97.7 T');
  near('  it names the impossible rate', F.rate, 77001, 15);
  eq('  it is too HIGH, not too low', F.over, true);
  ok(F.impliedLow > 200 && F.impliedLow < 400,
    '  and inverts the money into an implied tonnage floor (~251 T) — got ' + Math.round(F.impliedLow));
  ok(F.impliedHigh > 1200 && F.impliedHigh < 1700,
    '  ...and a ceiling (~1,505 T), bracketing the ~627 T the lime chemistry predicts — got ' + Math.round(F.impliedHigh));

  /* Copy, not cosmetics: a sales invoice is not a "bill", and plastic bags have
     no "tonnage". Both were live in the first cut of this rewrite and only
     showed up by reading the rendered output. */
  p.setP('all'); p.render();
  const hh = p.els.invBody.innerHTML;
  ok(/2 invoices/.test(hh), 'the dispatch card counts INVOICES, not "bills"');
  ok(!/Quick Lime dispatched<\/div>\s*<div class="sub">\d+ bills/.test(hh), '  ...never "2 bills"');
  const bags = hh.slice(hh.indexOf('Plastic Bags'));
  ok(/the quantity was never entered/.test(bags), 'plastic bags have a "quantity", not a "tonnage"');
  ok(!/the tonnage was never entered/.test(bags.slice(0, 600)), '  ...bags are not weighed in tonnes');
  ok(/the tonnage was never entered/.test(hh.slice(hh.indexOf('Limestone'), hh.indexOf('Petcoke'))),
    '  ...but limestone IS tonnage, and still says so');

  near('quick lime realisation is ~₹5,317/T', fg.impliedRate, 5316.5, 1);
  eq('SILENT on the real quick lime: ₹2,34,80,277 over 4,416.5 T is an ordinary price', fg.flag, null);
  near('  quick-lime quantities are complete, so its rate is shown', fg.rate, 5316.5, 1);

  /* The mutation guard that matters: a hardcoded `flag: true` would pass every
     assertion above. Same material, same money, PLAUSIBLE tonnage → silent. So
     the warning must be computed from its inputs. */
  const fixed = PETCOKE_16.map((r, i) => Object.assign({}, r, { qty: 627 / 16 }));
  const pc2 = loadPage({ purchases: fixed }).X.invModel(fixed, [], [], 'all').raw.find(c => c.key === 'petcoke') || {};
  eq('  the SAME ₹75,22,976 over a plausible 627 T does NOT fire', pc2.flag, null);
  near('  ...because that is ₹11,998/T, an actual petcoke price', pc2.rate, 11998, 5);

  /* ...and the converse: a real price moved out of the band must fire, or the
     band is decoration. */
  const silly = [bill({ group: 'limestone', item: 'Limestone Purchase', taxable: 5000000, qty: 5 })];
  ok(loadPage({ purchases: silly }).X.invModel(silly, [], [], 'all').raw[0].flag,
    '  ₹10,00,000/T limestone fires too — the band is checked, not decorative');

  p.setP('all'); p.render();
  const h = p.els.invBody.innerHTML;
  ok(/is not a real price/.test(h), '  the warning reaches the screen');
  ok(/implies roughly/.test(h), '  ...and tells the user what the money actually implies');
}

/* ══════════════════════════════════════════════════════════════════════════
   8. THE PERIOD FILTER ACTUALLY SCOPES — and scopes EVERYTHING.
   Asserting values TRACK the filter, not that they equal a constant: a
   hardcoded output would sail through an equals-a-constant test.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const rows = [
    bill({ bill: 'M1', date: '2026-03-05', taxable: 100000, qty: 10 }),
    bill({ bill: 'M2', date: '2026-04-18', taxable: 250000, qty: 20 }),
    bill({ bill: 'M3', date: '2025-11-02', taxable: 700000, qty: 70 })
  ];
  const sales = [
    { inv: 'S1', date: '2026-03-09', qty: 5, taxable: 40000, status: 'paid' },
    { inv: 'S2', date: '2026-04-09', qty: 9, taxable: 72000, status: 'paid' }
  ];
  const p = loadPage({ purchases: rows, sales: sales, prod: [] });
  const at = per => p.X.invModel(rows, sales, [], per);

  const mar = at('2026-03'), apr = at('2026-04'), y26 = at('2026'), all = at('all');

  ok(mar.raw[0].value !== apr.raw[0].value, 'March and April return DIFFERENT cards — the filter is not a no-op');
  eq('  March sees only the March bill', mar.raw[0].value, 100000);
  eq('  April sees only the April bill', apr.raw[0].value, 250000);
  eq('  ...and their quantities track too', mar.raw[0].qty + '/' + apr.raw[0].qty, '10/20');
  eq('  a whole year rolls its months up', y26.raw[0].value, 350000);
  eq('  all time includes the 2025 bill the year filter excluded', all.raw[0].value, 1050000);
  ok(y26.raw[0].value < all.raw[0].value, '  ...so "2026" is strictly narrower than "all time"');
  eq('  bill COUNTS track as well', [mar, apr, y26, all].map(m => m.raw[0].bills).join(','), '1,1,2,3');

  /* The finding the brief calls out by name: a filter that scopes one card and
     not its neighbour. Sales must move with purchases. */
  eq('  the DISPATCH card is scoped by the same period (March)', mar.fg.qty, 5);
  eq('  ...and April', apr.fg.qty, 9);
  eq('  ...and rolls up over the year', y26.fg.qty, 14);
  ok(mar.fg.value !== apr.fg.value, '  dispatch VALUE tracks the filter too, not just quantity');

  /* Boundary arithmetic — invPeriodEnd builds the last day of the month. */
  eq('a month ends on its real last day (30 April)', p.X.invPeriodEnd('2026-04'), '2026-04-30');
  eq('February 2026 is 28 days', p.X.invPeriodEnd('2026-02'), '2026-02-28');
  eq('February 2028 is a leap year', p.X.invPeriodEnd('2028-02'), '2028-02-29');
  eq('a year ends on 31 December', p.X.invPeriodEnd('2026'), '2026-12-31');
  eq('all time has no end', p.X.invPeriodEnd('all'), null);
  eq('an undated bill cannot be placed in a month, so it is not claimed for one', p.X.invInPeriod('', '2026-03'), false);
  eq('  ...but it still counts in all time', p.X.invInPeriod('', 'all'), true);

  /* Closing stock is a BALANCE: everything up to the end of the period, not
     only what happened inside it. */
  eq('closing stock counts everything up to the end of the period', p.X.invUpto('2025-11-02', '2026-03'), true);
  eq('  ...and nothing after it', p.X.invUpto('2026-04-18', '2026-03'), false);

  /* The rendered scope line must agree with the model, or the header contradicts
     the cards under it. */
  p.setP('2026-03'); p.render();
  ok(/March 2026/.test(p.els.invBar.innerHTML), 'the filter button reads "March 2026" (QLD.monthLabel, not a hand-rolled string)');
  ok(/>2<\/b> bills in scope|<b>2<\/b> bill/.test(p.els.invScope.innerHTML),
    '  the scope line counts the March bills — got: ' + p.els.invScope.innerHTML);
  p.setP('all'); p.render();
  ok(/All time/.test(p.els.invBar.innerHTML), 'and "All time" when unfiltered');
  ok(/<b>5<\/b> bill/.test(p.els.invScope.innerHTML),
    '  the scope line tracks the filter — got: ' + p.els.invScope.innerHTML);
}

/* ══════════════════════════════════════════════════════════════════════════
   9. CANCELLED / TRASHED / ARCHIVED ARE NOT BUSINESS RECORDS (data.js's rule)
   ══════════════════════════════════════════════════════════════════════════ */
{
  const rows = [
    bill({ bill: 'GOOD', taxable: 100000, qty: 10 }),
    bill({ bill: 'CANX', taxable: 999999, qty: 999, status: 'cancelled' }),
    bill({ bill: 'DEL', taxable: 888888, qty: 888, _del: { at: '2026-03-01', by: 'x' } }),
    bill({ bill: 'ARCH', taxable: 777777, qty: 777, _arch: { at: '2026-03-01', by: 'x' } })
  ];
  const p = loadPage({ purchases: rows, sales: [], prod: [] });
  const c = p.X.invModel(rows, [], [], 'all').raw[0] || {};
  eq('only the live bill counts', c.bills, 1);
  eq('  a cancelled/trashed/archived bill adds no value', c.value, 100000);
  eq('  ...and no tonnage', c.qty, 10);
  eq('  ...and does not count as a live bill', c.state, 'complete');

  eq('the rule is spelled out: cancelled', p.X.invLive({ status: 'cancelled' }), false);
  eq('  soft-deleted', p.X.invLive({ _del: {} }), false);
  eq('  archived', p.X.invLive({ _arch: {} }), false);
  eq('  a plain pending bill is live', p.X.invLive({ status: 'pending' }), true);
  eq('  a bill with no status at all is live (data.js defaults it to pending)', p.X.invLive({}), true);
}

/* ══════════════════════════════════════════════════════════════════════════
   10. WHAT COUNTS AS "RECORDED"
   data.js:945 does `qty: p.qty || 0`, so a never-recorded tonnage reaches this
   page as 0 and cannot be told apart from a literal zero. A purchase bill for
   0 tonnes is not a thing, so `> 0` is the only honest reading — pin it.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const p = loadPage({ purchases: [] });
  eq('a real tonnage is recorded', p.X.invHasQty({ qty: 40.2 }), true);
  eq('a string tonnage off a form is recorded', p.X.invHasQty({ qty: '40.2' }), true);
  eq('zero is NOT a recorded quantity — nobody buys 0 tonnes', p.X.invHasQty({ qty: 0 }), false);
  eq('missing is not recorded', p.X.invHasQty({}), false);
  eq('null is not recorded', p.X.invHasQty({ qty: null }), false);
  eq('empty string is not recorded', p.X.invHasQty({ qty: '' }), false);
  eq('junk is not recorded', p.X.invHasQty({ qty: 'abc' }), false);
  eq('NaN is not recorded (and does not poison the sum)', p.X.invHasQty({ qty: NaN }), false);

  /* NaN is the specific trap: parseFloat('abc') is NaN, and NaN + anything is
     NaN, so ONE junk row would blank the whole card. */
  const rows = [bill({ taxable: 100000, qty: 10 }), bill({ bill: 'J', taxable: 50000, qty: 'abc' })];
  const c = loadPage({ purchases: rows }).X.invModel(rows, [], [], 'all').raw[0] || {};
  eq('one junk quantity does not turn the total into NaN', c.qty, 10);
  eq('  ...it is counted as a missing quantity instead', c.missingQty, 1);
  eq('  ...and its money still counts', c.value, 150000);
}

/* ══════════════════════════════════════════════════════════════════════════
   11. FREIGHT BILLS CARRY NO TONNAGE BY NATURE — do not cry wolf on them.
   `group === 'limestone'` sweeps in Limestone Freight and Royalty. Counting a
   freight bill as a missing quantity would raise an alarm on a bill that is
   perfectly complete, and a warning that cries wolf gets ignored.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const rows = [
    bill({ bill: 'LS/1', item: 'Limestone Purchase', taxable: 1000000, qty: 500 }),
    bill({ bill: 'FR/1', item: 'Limestone Freight', freight: true, taxable: 120000, qty: 0 })
  ];
  const p = loadPage({ purchases: rows, sales: [], prod: [] });
  const c = p.X.invModel(rows, [], [], 'all').raw[0] || {};
  eq('the freight bill does not count as a missing quantity', c.missingQty, 0);
  eq('  so the card is complete, not "partial"', c.state, 'complete');
  eq('  both bills are counted', c.bills, 2);
  eq('  the freight is broken out so the value still adds up', c.addonBills, 1);
  eq('  total value = material + freight', c.value, 1120000);
  eq('  but the RATE is material only — ₹10,00,000 / 500 T', c.rate, 2000);
  eq('  ...so freight does not inflate the price per tonne', c.flag, null);
}

/* ══════════════════════════════════════════════════════════════════════════
   12. THE DEAD CARD
   The page listed a `fuel` group for Diesel. PURCHASE_GROUPS has no `fuel` key
   — diesel is utilities/Diesel — so that card could never match a row and never
   once rendered. Utilities is also three units in one group (kWh, L, litres of
   water), so a summed quantity there would be a number with no unit.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const groups = (/const PURCHASE_GROUPS = \[[\s\S]*?\n  \];/.exec(dataSrc) || [''])[0];
  ok(!/key: 'fuel'/.test(groups), 'data.js has no `fuel` purchase group (so a card keyed on it is dead)');
  const p = loadPage({ purchases: [] });
  eq('the page keys its cards on real groups only',
    p.X.MATS.filter(m => !/^(limestone|petcoke|packaging|utilities)$/.test(m.key)).map(m => m.key).join(','), '');
  p.X.MATS.forEach(m => ok(new RegExp("key: '" + m.key + "'").test(groups), '  `' + m.key + '` is a real group in data.js'));

  const rows = [bill({ group: 'utilities', item: 'Diesel', taxable: 80000, qty: 900 }),
                bill({ group: 'utilities', item: 'Electricity', taxable: 300000, qty: 12000 })];
  const c = loadPage({ purchases: rows }).X.invModel(rows, [], [], 'all').raw[0] || {};
  eq('a diesel bill now lands on a card that exists', c.key, 'utilities');
  eq('  litres + kilowatt-hours are not added together', c.qty, null);
  eq('  ...the card is value-only and says so', c.state, 'mixed');
  eq('  the value is still real', c.value, 380000);
  eq('  and no rate is invented for a group with no single unit', c.rate, null);
}

/* ══════════════════════════════════════════════════════════════════════════
   13. CLOSING STOCK REFUSES TO COMPUTE ON INCOMPLETE INWARD
   inward-we-know-about minus consumed-in-full trends negative and looks like
   theft. Refusing is the correct answer.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const prod = [{ date: '2026-03-20', limestone: 300, petcoke: 40, bags: 100, quicklime: 168, hydrated: 0 }];
  const gappy = [bill({ bill: 'A', taxable: 500000, qty: 400 }), bill({ bill: 'B', taxable: 500000, qty: 0 })];
  const p = loadPage({ purchases: gappy, sales: [], prod: prod });

  const s = p.X.invStock(p.X.MATS[0], gappy, prod, 'all');
  eq('one unmeasured inward bill makes closing stock incomputable', s.computable, false);
  eq('  ...so no number is offered', s.closing, null);
  eq('  ...and it says how many bills are in the way', s.missing, 1);

  const clean = [bill({ bill: 'A', taxable: 500000, qty: 400 }), bill({ bill: 'B', taxable: 500000, qty: 350 })];
  const s2 = p.X.invStock(p.X.MATS[0], clean, prod, 'all');
  eq('measure them and it computes: 750 inward − 300 consumed', s2.closing, 450);
  eq('  ...and says so', s2.computable, true);

  const M = p.X.invModel(gappy, [], prod, 'all');
  ok(M.stock.length > 0, 'the stock section appears once production runs exist');
  p.setP('all'); p.render();
  ok(/Not computable/.test(p.els.invBody.innerHTML), '  and the card says "Not computable" rather than showing a shortfall');
  ok(!/Closing stock/.test(loadPage({ purchases: gappy, sales: [], prod: [] }).X.invModel(gappy, [], [], 'all').stock.join('')),
    '  with no production runs there is no closing-stock section at all');
}

/* ══════════════════════════════════════════════════════════════════════════
   14. EVERY var(--ql-*) MUST EXIST IN tokens.css
   This is not hypothetical. The page that shipped used var(--ql-surface) for
   every card background and var(--ql-text-soft) for every secondary line.
   NEITHER HAS EVER EXISTED in tokens.css, so they resolved to nothing — the
   cards had no background at all. A typo'd CSS variable fails silently, which
   is exactly why it needs a test rather than an eye.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const tok = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8');
  const defined = new Set();
  let d; const dre = /(--ql-[\w-]+)\s*:/g;
  while ((d = dre.exec(tok))) defined.add(d[1]);
  ok(defined.size > 50, 'parsed the token list out of tokens.css (' + defined.size + ' tokens)');

  /* Proof the parser can actually see an absence — otherwise a broken regex
     would make this whole section pass by finding nothing. */
  ok(!defined.has('--ql-surface'), 'sanity: --ql-surface really is undefined in tokens.css');
  ok(!defined.has('--ql-text-soft'), 'sanity: --ql-text-soft really is undefined in tokens.css');
  ok(defined.has('--ql-card') && defined.has('--ql-text-muted'), 'sanity: the REAL names are --ql-card / --ql-text-muted');

  /* Strip comments before scanning. Both files NAME the two dead tokens in prose
     to explain the bug, and the first run of this test duly failed on its own
     documentation. Same trap monthpicker.test.js and waphone.test.js call out. */
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const all = new Set();
  for (const [name, src] of [['inventory.css', CSS], ['inventory.html', HTML]]) {
    const seen = new Set();
    let m; const ure = /var\(\s*(--ql-[\w-]+)/g;
    while ((m = ure.exec(strip(src)))) seen.add(m[1]);
    for (const t of Array.from(seen).sort()) {
      all.add(t);
      ok(defined.has(t), name + ' uses ' + t + ', which tokens.css does not define — it will resolve to nothing');
    }
  }
  ok(all.size > 20, 'the page is actually themed off tokens, not hardcoded hexes (' + all.size + ' distinct tokens)');

  /* The stripper must not be so eager that it hides real code from the scan. */
  ok(/var\(--ql-card\)/.test(strip(CSS)), 'sanity: stripping comments still leaves the real CSS to scan');
  ok(all.has('--ql-card') && all.has('--ql-text-muted'), 'sanity: the scan really did find the tokens the page uses');
}

/* ══════════════════════════════════════════════════════════════════════════
   15. THE PICKER IS NOT THIS PAGE'S
   This section used to assert that inventory.html binds its OWN year arrows and
   that they carry the stopPropagation fix — because back then this page had its
   own picker, the fourth copy. Its stated reason was that monthpicker.test.js
   "globs `*.js`, so an inline <script> in a .html page is invisible to it".

   Both halves are now obsolete, and in the right direction: the page has no
   picker to guard (it calls QLShell.monthPicker), and monthpicker.test.js reads
   .html files too, so the blind spot this section covered is closed at the
   source. What is left worth pinning here is that Inventory did not quietly LOSE
   anything in the consolidation.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const code = HTML.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  ok(!/\[data-yr\]/.test(code) && !/data-yr\s*=/.test(code),
    'inventory.html must not build its own year arrows — it had the 4th copy of the picker. Use QLShell.monthPicker.');
  ok(/QLShell\.monthPicker\s*\(/.test(code), 'inventory.html opens the SHARED picker');
  ok(/QLShell\.monthButton\s*\(/.test(code), '  and renders the shared trigger, so the button matches the calendar');

  /* Inventory's picker genuinely does more than the registers': stock is a
     running position, so it offers "Whole year 2026" and calls the unfiltered
     case "All time", not "All months". Those survived as OPTIONS on the shared
     picker — losing them would be a silent feature deletion dressed as cleanup. */
  ok(/years:\s*true/.test(code), 'inventory keeps its "Whole year" option (years: true on the shared picker)');
  ok(/allLabel:\s*'All time'/.test(code), 'inventory keeps "All time" (not "All months" — stock is not a monthly book)');

  ok(/QLD\.monthLabel/.test(HTML), 'the page defers to QLD.monthLabel for "March 2026" rather than building a sixth copy');
  /* Both quote styles. monthlabel.test.js only matches single quotes, and
     mutation testing proved a double-quoted hand-roll walks straight past it:
       new Date(p + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" })
     survived the whole suite. A guard that only catches one way of writing the
     bug is a guard the next person writes around by accident. */
  const opts = code.match(/\{[^{}]*month:\s*['"](long|short)['"][^{}]*\}/g) || [];
  jeq('  ...and hand-rolls no month formatting of its own (either quote style)',
    opts.filter(o => /year:\s*['"]numeric['"]/.test(o) && !/day:/.test(o)), []);
  ok(!/toLocaleDateString/.test(code), '  ...and does not reach for toLocaleDateString at all — data.js owns date text');
  ok(/QLD\.uiMonth/.test(HTML) && /QLD\.setUiMonth/.test(HTML),
    'the picker reads and writes the app-wide month (QLD.uiMonth/setUiMonth), so it agrees with Sales and Purchase');
}

/* ══════════════════════════════════════════════════════════════════════════
   16. THE ORIGINAL DEFECT, PINNED IN THE SOURCE
   The exact expression that caused this. If it comes back, this fails.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const core = /INV-CORE-START([\s\S]*?)INV-CORE-END/.exec(HTML);
  ok(core, 'the pure core is marked off so it can be tested without a browser');
  const code = core[1].replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  ok(!/\+r\.qty\s*\|\|\s*0/.test(code),
    'the core is summing `+r.qty || 0` again — that is the whole bug: it turns a MISSING quantity into a zero and prints it as a fact');
  ok(/invHasQty/.test(code) && /invNum\(r\.qty\) > 0/.test(code),
    'the core decides "recorded" with an explicit qty > 0 test');
  ok(!/\+r\.qty\s*\|\|\s*0/.test(HTML.replace(/\/\*[\s\S]*?\*\//g, ' ')),
    'and `+r.qty || 0` is gone from the whole page, not just the core');
}

/* ══════════════════════════════════════════════════════════════════════════
   THE MODERN CHROME — and the headline that must not lie
   The page now wears the registers' header and KPI row (QLX.heroHTML /
   QLX.statsHTML). Everything this file exists to protect applies to the stat
   cards too: a big confident "0 T" at the TOP of the page would be the same
   defect in the loudest place on the screen.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const p = loadPage({ purchases: LIMESTONE_9, sales: [], prod: [] });
  p.setP('all'); p.render();
  const hero = p.els.invHero.innerHTML, stats = p.els.invStats.innerHTML;

  ok(/qx-hero/.test(hero), 'CHROME · the page renders the shared register header');
  ok(/qx-title/.test(hero) && /Inventory/.test(hero), '  with the page title in it');
  ok(/qx-btn-primary/.test(hero), '  and the primary action, styled like every other page');
  ok(/qx-stats/.test(stats) && /qx-stat-v/.test(stats), 'CHROME · the KPI row is the registers’ stat row');

  /* THE HEADLINE MUST NOT LIE. Nine limestone bills, no tonnage on any. */
  ok(/—/.test(stats), 'KPI · with no quantity recorded the tonnage headline is a dash');
  ok(/not recorded/i.test(stats), '  and says "not recorded" underneath');
  ok(!/>0<u|>0 ?<u|>0 T</.test(stats), '  it NEVER prints a confident "0 T" — the defect, in the loudest place');
  ok(/4,71,494|4471494/.test(stats.replace(/,/g, m => m)) || /₹44,71,494/.test(stats),
     '  the MONEY stays confident — the value is complete even when the tonnage is not');
}
{
  /* Quantities fully recorded → the headline is a real number, with its unit. */
  const p = loadPage({ purchases: [], sales: SALES_REAL, prod: [] });
  p.setP('all'); p.render();
  const stats = p.els.invStats.innerHTML;
  ok(/4,416.5|4416.5/.test(stats), 'KPI · a fully recorded tonnage IS shown as the number');
  ok(/qx-u/.test(stats), '  with the unit set small beside it, as the registers do');
}
{
  /* Partial: some bills carry tonnage, some do not. The number is a floor and
     the card must say how many are still missing rather than imply a total. */
  const p = loadPage({ purchases: PETCOKE_16, sales: [], prod: [] });
  p.setP('all'); p.render();
  const stats = p.els.invStats.innerHTML;
  ok(/still missing a quantity/.test(stats),
     'KPI · a partial tonnage says how many bills are still missing one');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
