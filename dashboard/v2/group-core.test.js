/* group-core.test.js — multi-company consolidation math.
 * Covers the acceptance scenarios for the Group Overview:
 *   S7/S8  company isolation (a summary contains ONLY its own blob's data)
 *   S9     All-Companies totals are exactly Gotan + Deshwali, with breakdown
 *   S10    date-range changes recompute every figure
 *   S11    product/material classification drives the breakdowns
 *   S12    cancelled + trashed rows (returns/adjustments) leave every total
 *   §6     stock is a ledger: opening + in − used = closing; refuses when
 *          a contributing bill has no quantity (mirrors inventory.html)
 * Run: node group-core.test.js */
const G = require('./group-core.js');
let pass = 0, fail = 0; const bad = [];
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : (fail++, bad.push(`${n} → got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)); };
const close = (n, a, b) => { Math.abs(a - b) < 0.01 ? pass++ : (fail++, bad.push(`${n} → got ${a}, want ${b}`)); };

/* ── synthetic books: two companies, clearly distinguishable numbers ── */
const GOTAN = {
  sales: [
    { inv: 'G1', date: '2026-07-02', party: 'DURGA', qty: 42.10, rate: 6000, gstR: 5, status: 'pending' },
    { inv: 'G2', date: '2026-07-10', party: 'ARIF', qty: 10, rate: 5000, gstR: 5, status: 'paid' },
    { inv: 'G3', date: '2026-06-15', party: 'OLD', qty: 5, rate: 4000, gstR: 5, status: 'paid' },      // outside July
    { inv: 'G4', date: '2026-07-20', party: 'CANC', qty: 99, rate: 9999, gstR: 5, status: 'cancelled' }, // cancelled
    { inv: 'G5', date: '2026-07-21', party: 'DEL', qty: 88, rate: 8888, gstR: 5, _del: { at: 'x' } },   // trashed
  ],
  purchases: [
    { bill: 'P1', date: '2026-07-01', sup: 'MINE', cat: 'limestone Limestone', qty: 100, taxable: 200000, status: 'pending' },
    { bill: 'P2', date: '2026-07-03', sup: 'IOC', cat: 'petcoke fuel', qty: 20, taxable: 300000, status: 'paid' },
    { bill: 'P3', date: '2026-07-05', sup: 'BAGS', cat: 'packaging HDPE Bags', qty: 1000, taxable: 20000, status: 'pending' },
    { bill: 'P4', date: '2026-05-01', sup: 'MINE', cat: 'limestone', qty: 50, taxable: 90000, status: 'paid' },  // outside July
  ],
  prod: [
    { date: '2026-07-06', limestone: 60, petcoke: 8, bags: 200, quicklime: 40, hydrated: 5, labour: 12000 },
    { date: '2026-07-15', limestone: 30, petcoke: 4, bags: 100, quicklime: 20, hydrated: 0, labour: 6000 },
    { date: '2026-06-20', limestone: 10, petcoke: 1, bags: 0, quicklime: 6, hydrated: 0, labour: 2000 }, // outside July
  ],
  chunna: [{ date: '2026-07-08', customer: 'X', qty: 3, total: 9000 }],
};
const DESHWALI = {
  sales: [{ inv: 'D1', date: '2026-07-04', party: 'STEELCO', qty: 20, rate: 7000, gstR: 5, status: 'pending' }],
  purchases: [{ bill: 'DP1', date: '2026-07-02', sup: 'MINE', cat: 'limestone', qty: 40, taxable: 76000, status: 'pending' }],
  prod: [{ date: '2026-07-09', limestone: 25, petcoke: 3, bags: 50, quicklime: 18, hydrated: 2, labour: 5000 }],
  chunna: [],
};
const JULY = { from: '2026-07-01', to: '2026-07-31' };

/* ── S7/S8 + math: single-company summaries ── */
const g = G.summarize(GOTAN, JULY);
close('Gotan July sales taxable = 42.1×6000 + 10×5000', g.sales.taxable, 252600 + 50000);
close('Gotan July sales total (with 5% GST)', g.sales.total, 265230 + 52500);
eq('cancelled + trashed sales are EXCLUDED (returns/adjustments honoured)', g.sales.count, 2);
close('Gotan July sales qty', g.sales.qty, 52.10);
close('Gotan July purchase value (excl GST)', g.purchase.value, 520000);
close('Gotan purchase tonnes = limestone+petcoke only', g.purchase.tonnes, 120);
close('  limestone group qty', g.purchase.byGroup.limestone.qty, 100);
close('  packaging group value', g.purchase.byGroup.packaging.value, 20000);
close('Gotan July production output', g.production.output, 65);
close('  limestone consumed', g.production.consumed.limestone, 90);
close('  labour', g.production.labour, 18000);
close('Gotan chunna qty', g.chunna.qty, 3);
const d = G.summarize(DESHWALI, JULY);
close('Deshwali July sales taxable', d.sales.taxable, 140000);
eq('S7: Gotan summary has no Deshwali counts', g.sales.count === 2 && g.purchase.count === 3, true);
eq('S8: Deshwali summary has no Gotan counts', d.sales.count === 1 && d.purchase.count === 1, true);

/* ── §6 stock ledger: opening + in − used = closing ── */
const gl = g.stock.find(s => s.key === 'limestone');
close('limestone opening (before July) = 50 in − 10 used', gl.opening, 40);
close('limestone closing = 150 in − 100 used (cumulative)', gl.closing, 50);
eq('  ledger identity: opening + range-in − range-used = closing',
   Math.round((gl.opening + 100 - 90) * 100) / 100, gl.closing);
const gf = g.stock.find(s => s.key === 'fg');
close('FG closing = made(71) − sold(57.1) cumulative', gf.closing, 71 - 57.10);
/* missing-qty refusal (the inventory page's honesty guard) */
const MISSING = { ...GOTAN, purchases: GOTAN.purchases.concat([{ bill: 'PX', date: '2026-07-09', sup: 'M', cat: 'limestone', taxable: 5000, status: 'pending' }]) };
const gm = G.summarize(MISSING, JULY).stock.find(s => s.key === 'limestone');
eq('stock REFUSES a number when a limestone bill has no qty', gm.closing, null);
eq('  and says why (missing count)', gm.missing, 1);

/* ── S9: consolidation = exact sum, provenance preserved ── */
const T = G.consolidate([{ id: 'g', summary: g }, { id: 'd', summary: d }]);
close('S9: total sales taxable = Gotan + Deshwali', T.sales.taxable, g.sales.taxable + d.sales.taxable);
close('S9: total purchase value', T.purchase.value, g.purchase.value + d.purchase.value);
close('S9: total production output', T.production.output, g.production.output + d.production.output);
close('S9: total limestone closing = 50 + 15', T.stockClosing.limestone, 50 + 15);
eq('S9: consolidated stock stays computable when all parts are', T.stockComputable.limestone, true);
const Tm = G.consolidate([{ id: 'g', summary: G.summarize(MISSING, JULY) }, { id: 'd', summary: d }]);
eq('S9: one non-computable company poisons the consolidated balance (no fake totals)', Tm.stockComputable.limestone, false);

/* ── S10: date range changes everything ── */
const gJune = G.summarize(GOTAN, { from: '2026-06-01', to: '2026-06-30' });
close('June sales = only the June invoice', gJune.sales.taxable, 20000);
close('June production output', gJune.production.output, 6);
const gAll = G.summarize(GOTAN, { from: null, to: null });
eq('All-time counts every live sale', gAll.sales.count, 3);
close('all-time opening is zero (books start empty)', gAll.stock.find(s => s.key === 'limestone').opening, 0);

/* ── S11: material classification ── */
eq('cat "petcoke fuel" → petcoke', G.pgroup('petcoke fuel'), 'petcoke');
eq('cat "limestone Limestone Purchase" → limestone', G.pgroup('limestone Limestone Purchase'), 'limestone');
eq('cat "HDPE Bags" → packaging', G.pgroup('HDPE Bags'), 'packaging');
eq('cat "Diesel" → utilities', G.pgroup('Diesel'), 'utilities');
eq('unknown cat → other', G.pgroup('mystery thing'), 'other');

/* ── presets sanity (§13) ── */
const P = Object.fromEntries(G.presets('2026-08-09').map(p => [p.key, p]));
eq('This FY starts 1 April 2026', P.fy.from, '2026-04-01');
eq('Last FY is Apr 2025 – Mar 2026', [P.lastfy.from, P.lastfy.to], ['2025-04-01', '2026-03-31']);
eq('Last month is July 2026', [P.lastmonth.from, P.lastmonth.to], ['2026-07-01', '2026-07-31']);
eq('All Time has open bounds', [P.all.from, P.all.to], [null, null]);

/* ══ PARTNERSHIP: two firms, two kilns run jointly ══
   Deshwali Minerals (own firm) + Gotan Lime Industries (partner firm) operate
   Kiln 1 and Kiln 2 together. A kiln is a physical asset — the SAME kiln can
   appear in both firms' books, and its rolled-up total must be the kiln's real
   output, not one firm's slice. */
const K_GOTAN = { sales: [], purchases: [
    { bill: 'K1', date: '2026-07-01', cat: 'limestone', qty: 100, taxable: 200000, status: 'paid' }],
  prod: [
    { date: '2026-07-03', kiln: 'Kiln 1', limestone: 40, petcoke: 5, quicklime: 26, hydrated: 0, labour: 8000 },
    { date: '2026-07-05', kiln: 'Kiln 2', limestone: 30, petcoke: 4, quicklime: 20, hydrated: 0, labour: 6000 },
    { date: '2026-07-07', limestone: 10, petcoke: 1, quicklime: 6, hydrated: 0, labour: 2000 } ], chunna: [] };
const K_DESH = { sales: [], purchases: [
    { bill: 'K2', date: '2026-07-01', cat: 'limestone', qty: 50, taxable: 100000, status: 'paid' }],
  prod: [
    { date: '2026-07-04', kiln: 'Kiln 1', limestone: 20, petcoke: 3, quicklime: 13, hydrated: 0, labour: 4000 } ],
  chunna: [] };
const kg = G.summarize(K_GOTAN, JULY), kd = G.summarize(K_DESH, JULY);
eq('kiln names are kept per company', Object.keys(kg.production.byKiln).sort(), ['Kiln 1', 'Kiln 2', 'Unassigned']);
close('Kiln 1 output in Gotan books', kg.production.byKiln['Kiln 1'].output, 26);
close('a run with no kiln lands in Unassigned (never silently attributed)', kg.production.byKiln['Unassigned'].output, 6);
eq('kiln costs sum back to the company production cost',
   Math.round(Object.values(kg.production.byKiln).reduce((a, b) => a + b.cost, 0)), Math.round(kg.production.cost));
const KT = G.consolidate([{ id: 'g', name: 'Gotan Lime Industries', summary: kg },
                          { id: 'd', name: 'Deshwali Minerals', summary: kd }]);
close('SAME kiln across BOTH firms rolls up to the kiln real total (26+13)', KT.production.byKiln['Kiln 1'].output, 39);
eq('  and records which firms ran it', KT.production.byKiln['Kiln 1'].firms.sort(), ['Deshwali Minerals', 'Gotan Lime Industries']);
close('Kiln 2 (single firm) unchanged', KT.production.byKiln['Kiln 2'].output, 20);
close('kiln totals still equal the consolidated output',
      Object.values(KT.production.byKiln).reduce((a, b) => a + b.output, 0), KT.production.output);

/* profit-share split — arithmetic on real totals, ratio always user-set */
eq('no ratio configured ⇒ null, never a silent 50/50', G.partnerSplit(KT, null), null);
eq('zero/invalid ratio ⇒ null', G.partnerSplit(KT, { mine: 0, partner: 0 }), null);
const sp = G.partnerSplit(T, { mine: 60, partner: 40 });
close('60/40 split: my share of sales', sp.mine.sales, T.sales.taxable * 0.6);
close('60/40 split: partner share of sales', sp.partner.sales, T.sales.taxable * 0.4);
close('shares sum back to the whole', sp.mine.sales + sp.partner.sales, T.sales.taxable);
close('margin = sales − production cost', sp.margin, T.sales.taxable - T.production.cost);
close('margin splits by the same ratio', sp.mine.margin + sp.partner.margin, sp.margin);
const half = G.partnerSplit(T, { mine: 50, partner: 50 });
close('50/50 halves the margin', half.mine.margin, half.partner.margin);
eq('ratio is normalised to a percentage (3:1 ⇒ 75%)', G.partnerSplit(T, { mine: 3, partner: 1 }).mine.pct, 75);

console.log('\n════ group-core (multi-company consolidation) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' GROUP-CORE TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
