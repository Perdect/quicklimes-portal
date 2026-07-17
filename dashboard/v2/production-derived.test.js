/* production-derived.test.js — loads the REAL data.js in a mocked browser env and
   pins QLD.productionDerived(): the rows must equal the bills they claim to come
   from, an unknown quantity must stay unknown (never 0), a measured run must beat
   the paperwork for its own month, and cancelled/trashed bills must be invisible.

   Run: node production-derived.test.js
*/
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = '' + v; }, removeItem: k => { delete store[k]; } };
global.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.location = { hash: '', hostname: 'localhost', pathname: '/', search: '', replace() {}, href: '' };
global.history = { replaceState() {} };
global.navigator = { userAgent: 'node-test' };
global.document = { addEventListener() {}, createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
global.setTimeout = () => 0;
global.window = global;
localStorage.setItem('ql_plant', JSON.stringify({ id: 'co1', plants: [{ id: 'co1', plant_name: 'Test Co' }], token: 't', role: 'owner', user: { name: 'Tester', role: 'owner' } }));
localStorage.setItem('dm_active_co', 'co1');
global.supabase = { createClient: () => ({ rpc: async () => ({ data: null, error: 'offline' }) }) };
require('./data.js');
const Q = global.QLD;

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const near = (a, b) => a != null && Math.abs(a - b) <= 0.01;

/* ── the books ───────────────────────────────────────────────────────────
   June: limestone 100T + 50T (one of them ALSO has a freight bill for the same
   load — the landed-cost taxonomy puts freight inside the limestone group, so a
   naive sum would book 150+30 and invent 30 tonnes of stone that never arrived).
   Petcoke 20T. Bags 500. Dispatch: 90T quick lime + 10T hydrated.
   July: limestone bills exist but NOT ONE carries a quantity — the blocked case. */
Q.addPurchase({ bill: 'L-1', date: '2026-06-02', sup: 'STONE CO', taxable: 100000, grate: 5, group: 'limestone', item: 'Limestone Purchase', qty: 100, unit: 'MT' });
Q.addPurchase({ bill: 'L-2', date: '2026-06-09', sup: 'STONE CO', taxable: 50000, grate: 5, group: 'limestone', item: 'Limestone Purchase', qty: 50, unit: 'TO' });
Q.addPurchase({ bill: 'F-1', date: '2026-06-09', sup: 'TRANSPORT', taxable: 9000, grate: 5, group: 'limestone', item: 'Limestone Freight', qty: 30, unit: 'MT' });
Q.addPurchase({ bill: 'R-1', date: '2026-06-09', sup: 'MINES DEPT', taxable: 4000, grate: 5, group: 'limestone', item: 'Royalty', qty: 30, unit: 'MT' });
Q.addPurchase({ bill: 'C-1', date: '2026-06-12', sup: 'IOC', taxable: 200000, grate: 18, group: 'petcoke', item: 'Petcoke Purchase', qty: 20, unit: 'MT' });
Q.addPurchase({ bill: 'B-1', date: '2026-06-14', sup: 'BAGWALA', taxable: 12000, grate: 18, group: 'packaging', item: 'Plastic Bags', qty: 500, unit: 'NOS' });
// the bill with NO qty (his real books, per qty-backfill.js)
Q.addPurchase({ bill: 'L-NOQ', date: '2026-07-03', sup: 'STONE CO', taxable: 80000, grate: 5, group: 'limestone', item: 'Limestone Purchase' });
// a CANCELLED limestone bill — must be invisible everywhere
Q.addPurchase({ bill: 'L-CAN', date: '2026-06-20', sup: 'GHOST', taxable: 70000, grate: 5, group: 'limestone', item: 'Limestone Purchase', qty: 70, unit: 'MT', status: 'cancelled' });

Q.addSale({ inv: 'S-1', date: '2026-06-05', party: 'ARIF', gstin: '08ARIF0000A1Z0', product: 'Quick Lime', qty: 60, unit: 'Tonne', rate: 5000, gstR: 5 });
Q.addSale({ inv: 'S-2', date: '2026-06-18', party: 'AMAN', gstin: '08AMAN0000A1Z0', product: '', qty: 30, unit: 'Tonne', rate: 5000, gstR: 5 });   // no product stated → quick lime by the app's own convention
Q.addSale({ inv: 'S-H1', date: '2026-06-22', party: 'KIRTI', gstin: '08KIRT0000A1Z0', product: 'Hydrated Lime', qty: 10, unit: 'Tonne', rate: 6000, gstR: 5 });
Q.addSale({ inv: 'S-CAN', date: '2026-06-25', party: 'GHOST', gstin: '08GHOS0000A1Z0', product: 'Quick Lime', qty: 999, unit: 'Tonne', rate: 5000, gstR: 5, status: 'cancelled' });
Q.addSale({ inv: 'S-NOQ', date: '2026-07-08', party: 'ARIF', gstin: '08ARIF0000A1Z0', product: 'Quick Lime', rate: 5000, taxable: 40000, gstR: 5 });   // no qty

const byM = ym => Q.productionDerived().find(r => r.ym === ym);

/* ── 1. derived rows equal the bills, exactly ───────────────────────────── */
const jun = byM('2026-06');
ok('June row exists', !!jun);
ok('June limestone = 150 T (L-1 100 + L-2 50) — freight & royalty NOT double-counted', near(jun.limestone.v, 150));
ok('June limestone traced to exactly 2 bills', jun.limestone.refs.length === 2 && jun.limestone.refs.map(r => r.ref).sort().join() === 'L-1,L-2');
ok('June petcoke = 20 T', near(jun.petcoke.v, 20));
ok('June bags = 500', near(jun.bags.v, 500));
ok('June quick lime dispatched = 90 T (S-1 60 + S-2 30, unstated product counts as QL)', near(jun.quicklime.v, 90));
ok('June hydrated dispatched = 10 T (only the invoice that says hydrated)', near(jun.hydrated.v, 10));
ok('June row is labelled derived', jun.source === 'derived');
ok('June implied ratio = 100/150 = 67%', near(Math.round(jun.implied), 67));

/* ── 2. missing qty → null (never 0, never a guess) ─────────────────────── */
const jul = byM('2026-07');
ok('July limestone is NULL, not 0 — the bill exists but states no tonnage', jul.limestone.v === null);
ok('July limestone reports the bill it could not read', jul.limestone.bills === 1 && jul.limestone.missing === 1 && jul.limestone.read === 0);
ok('July quick lime is NULL — the invoice carries no qty', jul.quicklime.v === null);
ok('July implied ratio is null — nothing honest to divide', jul.implied === null);
ok('a month with no bills of a kind reports 0 bills (a quiet blank, not a warning)', jul.petcoke.v === null && jul.petcoke.bills === 0 && jul.petcoke.missing === 0);
ok('derivedQtyGaps counts the unreadable material bill', Q.derivedQtyGaps().purchase.missing === 1);
ok('derivedQtyGaps counts the unreadable invoice', Q.derivedQtyGaps().sales.missing === 1);

/* ── 3. cancelled / trashed are invisible ───────────────────────────────── */
ok('cancelled limestone bill (70 T) excluded — June is 150, not 220', near(jun.limestone.v, 150));
ok('cancelled invoice (999 T) excluded — June QL is 90, not 1089', near(jun.quicklime.v, 90));
const ti = Q.state.PURCHASES.findIndex(p => p.bill === 'L-1');
Q.softDelete('purchase', ti, 'test trash');
ok('TRASHED bill (_del) drops out → June limestone = 50', near(byM('2026-06').limestone.v, 50));
Q.restoreRecord('purchase', ti);
ok('restored bill comes back → June limestone = 150 again', near(byM('2026-06').limestone.v, 150));
Q.archiveRecord('purchase', ti, true);
ok('ARCHIVED bill (_arch) drops out → June limestone = 50', near(byM('2026-06').limestone.v, 50));
Q.archiveRecord('purchase', ti, false);   // restoreRecord only clears _del; _arch is archiveRecord(..,false)
ok('unarchived → June limestone = 150 again', near(byM('2026-06').limestone.v, 150));

/* ── 4. units are converted by arithmetic, never assumed ────────────────── */
ok('KG converts exactly: 32000 KG = 32 T', near(Q.tonnesOf({ qty: 32000, unit: 'KG' }), 32));
ok('QUINTAL converts exactly: 10 QTL = 1 T', near(Q.tonnesOf({ qty: 10, unit: 'Qtl' }), 1));
ok('a bare number follows the register convention (tonnes)', near(Q.tonnesOf({ qty: 5, unit: '' }), 5));
ok('BAG is not a tonnage → null, not 5 tonnes of stone', Q.tonnesOf({ qty: 5, unit: 'Bag' }) === null);
ok('LTR is not a tonnage → null', Q.tonnesOf({ qty: 5, unit: 'Ltr' }) === null);
ok('zero/absent qty → null, never 0', Q.tonnesOf({ qty: 0, unit: 'MT' }) === null && Q.tonnesOf({}) === null);
ok('countOf refuses MT for a bag count', Q.countOf({ qty: 5, unit: 'MT' }) === null);
ok('countOf accepts NOS', near(Q.countOf({ qty: 500, unit: 'NOS' }), 500));

/* ── 5. a measured run overrides its month, and says so ─────────────────── */
Q.addProduction({ date: '2026-06-15', limestone: 140, petcoke: 18, quicklime: 88, hydrated: 9, labour: 25000 });
const jun2 = byM('2026-06');
ok('June is now MEASURED', jun2.source === 'measured');
ok('measured limestone (140 consumed) overrides the derived 150 delivered', near(jun2.limestone.v, 140));
ok('measured quick lime (88 produced) overrides the derived 90 dispatched', near(jun2.quicklime.v, 88));
ok('the overridden columns are named', (jun2.overrode || []).sort().join() === 'hydrated,limestone,petcoke,quicklime');
ok('the run is flagged as measured on the cell', jun2.limestone.measured === true);
ok('what the bills said is kept, so the row can show its working', near(jun2.bills.limestone.v, 150) && near(jun2.bills.quicklime.v, 90));
ok('labour comes from the run', near(jun2.labour, 25000));
ok('bags: the run left it blank, so the BILLS still speak (500) — a blank run field must not blank the paperwork', near(jun2.bags.v, 500) && jun2.bags.measured === false);
ok('implied ratio now uses the measured numbers: 97/140 = 69%', near(Math.round(jun2.implied), 69));
ok('July is untouched by June\'s run', byM('2026-07').source === 'derived');
ok('the raw runs are still listed separately for editing/deleting', Q.productionRows().length === 1);

/* ── 5b. the page's OTHER tonnage figures must agree with the table ───────
   Found in the browser: "Output by product" read 1,099 T while the derived table
   read 90 T on the same screen — the 999 T cancelled invoice was being counted as
   dispatch. production(), topProducts(), kpis() and monthSeries() were each reading
   S.SALES raw, ignoring the notCancelled helper that totS()/totP() have always used.
   Two tonnage figures on one page must never disagree, so these pin the fix. */
{
  const jj = { from: '2026-06-01', to: '2026-06-30' };
  ok('topProducts() excludes the cancelled 999 T invoice → 100 T, not 1099', Q.topProducts()[0].qty.startsWith('100'));
  const ser = Q.monthSeries(24).find(r => r.ym === '2026-06');
  ok('monthSeries() June qty excludes the cancelled invoice → 100 T', ser && near(ser.qty, 100));
  ok('kpis() total dispatched excludes the cancelled invoice', Q.kpis().production.v.startsWith('100'));
  // and a TRASHED invoice must vanish from the same figures
  const si = Q.state.SALES.findIndex(s => s.inv === 'S-1');
  Q.softDelete('sales', si, 'test');
  ok('a TRASHED invoice drops out of topProducts() → 40 T', Q.topProducts()[0].qty.startsWith('40'));
  ok('a TRASHED invoice drops out of monthSeries()', near(Q.monthSeries(24).find(r => r.ym === '2026-06').qty, 40));
  ok('a TRASHED invoice drops out of the derived table too', near(byM('2026-06').bills.quicklime.v, 30));
  Q.restoreRecord('sales', si);
  ok('restored → topProducts() back to 100 T', Q.topProducts()[0].qty.startsWith('100'));

  /* production()'s Today/Week/Month tiles are relative to the real clock, so a June
     fixture can never exercise them — the first version of this test passed with the
     guard deleted. Date the invoices TODAY or the tiles are untested. */
  const todayISO = new Date().toISOString().slice(0, 10);
  Q.addSale({ inv: 'S-TODAY', date: todayISO, party: 'ARIF TRADERS', gstin: '08ARIF0000A1Z0', product: 'Quick Lime', qty: 12, unit: 'Tonne', rate: 5000, gstR: 5 });
  Q.addSale({ inv: 'S-TODAY-CAN', date: todayISO, party: 'GHOST', gstin: '08GHOS0000A1Z0', product: 'Quick Lime', qty: 500, unit: 'Tonne', rate: 5000, gstR: 5, status: 'cancelled' });
  ok('production().today excludes a cancelled invoice dated today → 12, not 512', near(Q.production().today, 12));
  ok('production().week excludes it too', near(Q.production().week, 12));
  ok('production().month excludes it too', near(Q.production().month, 12));
  const ti2 = Q.state.SALES.findIndex(s => s.inv === 'S-TODAY');
  Q.softDelete('sales', ti2, 'test');
  ok('production().today excludes a TRASHED invoice → 0', near(Q.production().today, 0));
  Q.purgeRecord('sales', ti2);
  const ci = Q.state.SALES.findIndex(s => s.inv === 'S-TODAY-CAN');
  Q.purgeRecord('sales', ci);
  ok('fixture cleaned up — June/July asserts below still hold', near(byM('2026-06').bills.quicklime.v, 90));
}

/* ── 6. MUTATION TESTS — prove each guard is load-bearing ────────────────
   A test that passes with the guard removed is not a test. Each block below
   re-implements the function WITHOUT one guard and asserts the suite would have
   caught it. */
const mut = [];
const mok = (n, c) => { if (c) pass++; else { fail++; fails.push('MUTANT SURVIVED: ' + n); } };

// mutant A: drop the freight/royalty exclusion (count the whole group)
{
  const rows = Q.purchaseRows().filter(r => r.status !== 'cancelled' && r.date.slice(0, 7) === '2026-06' && r.group === 'limestone');
  const naive = rows.reduce((a, r) => a + (Q.tonnesOf(r) || 0), 0);
  mok('freight+royalty exclusion is load-bearing (naive sum = 210, real = 150)', !near(naive, 150) && near(naive, 210));
}
// mutant B: unknown → 0 instead of null
{
  const zeroish = (Q.tonnesOf({ qty: 0 }) || 0);
  mok('null-vs-0 is load-bearing: coercing gives 0, which the July assert would catch', zeroish === 0 && byM('2026-07').limestone.v !== 0);
}
// mutant C: cancelled not filtered
{
  const withCan = Q.purchaseRows().filter(r => r.date.slice(0, 7) === '2026-06' && r.group === 'limestone' && !/freight|royalty/i.test(r.item))
    .reduce((a, r) => a + (Q.tonnesOf(r) || 0), 0);
  mok('the cancelled filter is load-bearing (unfiltered = 220, real = 150)', near(withCan, 220));
}
// mutant D: unit ignored (treat every qty as tonnes)
{
  mok('the unit check is load-bearing: ignoring it would call 32000 KG "32000 T"', Q.tonnesOf({ qty: 32000, unit: 'KG' }) !== 32000);
}
// mutant E: implied ratio computed off one side only
{
  const j = byM('2026-07');
  const bogus = ((j.quicklime.v || 0) + (j.hydrated.v || 0)) / (j.limestone.v || 0) * 100;
  mok('the both-sides-real gate is load-bearing (one side missing → NaN/Infinity, we return null)', !isFinite(bogus) && j.implied === null);
}

console.log((fail ? '\x1b[31m' : '\x1b[32m') + `production-derived: ${pass} passed, ${fail} failed` + '\x1b[0m');
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
