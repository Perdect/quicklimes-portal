/* Tests for freight-core.js — the freight & delivered-price engine.
   Run: node freight-core.test.js   (❌ marks a failure) */
const FC = require('./freight-core.js');
// lime-market provides profitTier for marginVerdict; load it so that path is real.
require('./lime-market.js');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('❌ ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + a + ', want ' + b + ')'); }

console.log('\n═══ Freight Core · calculation engine ═══\n');

/* ── Vehicle recommendation ── */
{
  eq(FC.recommendVehicle(20).vehicle.key, 't21', '20 MT → smallest fitting vehicle (21 MT truck)');
  eq(FC.recommendVehicle(21).vehicle.key, 't21', '21 MT → exactly the 21 MT truck');
  eq(FC.recommendVehicle(22).vehicle.key, 't25', '22 MT → next size up (25 MT truck)');
  eq(FC.recommendVehicle(30).vehicle.key, 'tr35', '30 MT → 35 MT trailer, single trip');
  eq(FC.recommendVehicle(30).trips, 1, '30 MT → one trip');
  const big = FC.recommendVehicle(100);
  eq(big.vehicle.key, 'tr35', '100 MT → largest vehicle for fewest trips');
  eq(big.trips, 3, '100 MT / 35 MT → 3 trips');
  eq(FC.recommendVehicle(0).trips, 0, '0 MT → no trips');
}

/* ── Trips ── */
{
  eq(FC.tripsFor(50, 25), 2, '50 MT / 25 cap → 2 trips');
  eq(FC.tripsFor(51, 25), 3, '51 MT / 25 cap → 3 trips (ceil)');
  eq(FC.tripsFor(0, 25), 0, '0 MT → 0 trips');
  eq(FC.tripsFor(25, 0), 0, '0 cap → 0 trips (no divide-by-zero)');
}

/* ── Transit days ── */
{
  eq(FC.transitDays(0), 0, '0 km → 0 days');
  eq(FC.transitDays(300), 2, '300 km → 2 days (1 travel + 1 buffer)');
  eq(FC.transitDays(400), 2, '400 km → 2 days');
  eq(FC.transitDays(1200), 4, '1200 km → 4 days');
  ok(FC.transitDays(50) >= 1, 'any positive distance is at least 1 day');
}

/* ── Freight methods: total-first, then per-MT ── */
{
  // per_ton_km: ₹4/MT/km × 1000 km × 25 MT = 100000; perMt = 4000
  let f = FC.freight('per_ton_km', { qtyMt: 25, km: 1000, cap: 25, value: 4 });
  eq(f.totalFreight, 100000, 'per_ton_km total = rate×km×qty');
  eq(f.freightPerMt, 4000, 'per_ton_km perMt = rate×km');

  // per_ton: ₹2500/MT × 25 = 62500
  f = FC.freight('per_ton', { qtyMt: 25, value: 2500 });
  eq(f.totalFreight, 62500, 'per_ton total = rate×qty');
  eq(f.freightPerMt, 2500, 'per_ton perMt = rate');

  // per_km: ₹90/km × 1000 = 90000 per truck; 25 MT / 25 cap = 1 truck
  f = FC.freight('per_km', { qtyMt: 25, km: 1000, cap: 25, value: 90 });
  eq(f.totalFreight, 90000, 'per_km single truck total = rate×km');
  eq(f.trucks, 1, 'per_km 25 MT → 1 truck');
  // 50 MT / 25 cap = 2 trucks → 180000
  f = FC.freight('per_km', { qtyMt: 50, km: 1000, cap: 25, value: 90 });
  eq(f.totalFreight, 180000, 'per_km 2 trucks total = rate×km×trucks');
  eq(f.freightPerMt, 3600, 'per_km perMt = total/qty');

  // per_truck: ₹120000/truck × 2 trucks (50/25)
  f = FC.freight('per_truck', { qtyMt: 50, cap: 25, value: 120000 });
  eq(f.totalFreight, 240000, 'per_truck total = price×trucks');
  eq(f.trucks, 2, 'per_truck 50/25 → 2 trucks');

  // fixed: ₹125000 whole load regardless of distance/qty
  f = FC.freight('fixed', { qtyMt: 40, km: 9999, value: 125000 });
  eq(f.totalFreight, 125000, 'fixed total ignores distance');
  eq(f.freightPerMt, 3125, 'fixed perMt = fixed/qty (125000/40)');

  // manual total vs manual per-MT
  f = FC.freight('manual', { qtyMt: 20, value: 50000 });
  eq(f.totalFreight, 50000, 'manual (total) uses value as-is');
  f = FC.freight('manual', { qtyMt: 20, value: 2000, manualPerMt: true });
  eq(f.totalFreight, 40000, 'manual (per-MT) → value×qty');
}

/* ── Additional charges ── */
{
  const t = FC.additionalTotal({ loading: 1000, unloading: 1500, toll: 800, misc: 200 });
  eq(t, 3500, 'additional charges sum');
  eq(FC.additionalTotal({ toll: 500, extra: [{ label: 'x', amount: 250 }] }), 750, 'extra rows counted');
  eq(FC.additionalTotal({}), 0, 'no charges → 0');
  eq(FC.additionalTotal({ toll: 'abc' }), 0, 'non-numeric charge ignored');
}

/* ── Delivered price ── */
{
  // material 7500 + freight 2500, no packaging/charges, 5% GST
  let d = FC.delivered({ qtyMt: 25, exworksPerMt: 7500, freightPerMt: 2500, gstRate: 0.05 });
  eq(d.materialPerMt, 7500, 'delivered material = ex-works (+packaging)');
  eq(d.preTaxPerMt, 10000, 'pre-tax perMt = material + freight + additional');
  eq(d.gstPerMt, 500, 'GST perMt = 5% of pre-tax');
  eq(d.deliveredPerMt, 10500, 'delivered perMt = pre-tax + GST');
  eq(d.grandTotal, 262500, 'grand total = delivered × qty (10500×25)');

  // packaging + additional spread across qty
  d = FC.delivered({ qtyMt: 20, exworksPerMt: 8000, packagingAddPerMt: 350, freightPerMt: 3000, additionalTotal: 20000, gstRate: 0.05 });
  eq(d.materialPerMt, 8350, 'packaging folds into material perMt');
  eq(d.additionalPerMt, 1000, 'additional total spread per MT (20000/20)');
  eq(d.preTaxPerMt, 12350, 'pre-tax includes packaging + additional');
  eq(d.deliveredPerMt, Math.round(12350 * 1.05), 'delivered applies GST to full pre-tax');

  // zero qty must not throw / divide-by-zero
  d = FC.delivered({ qtyMt: 0, exworksPerMt: 8000, freightPerMt: 2000 });
  ok(isFinite(d.deliveredPerMt) && d.deliveredPerMt > 0, 'zero qty still gives a per-MT price');
  eq(d.grandTotal, 0, 'zero qty → zero order total');
}

/* ── Margin verdict (reuses lime-market profitTier) ── */
{
  // freight 1500 on 8000 ex-works = 18.75% → strong
  let m = FC.marginVerdict(1500, 8000);
  eq(m.key, 'strong', 'low freight share → strong margin');
  eq(m.sharePct, 19, 'share % rounded');
  // freight 7000 on 8000 = 87.5% → unviable
  m = FC.marginVerdict(7000, 8000);
  eq(m.key, 'unviable', 'freight > 80% of price → freight too high');
}

/* ── Best-plant comparison ── */
{
  const plants = [
    { name: 'Borunda', lat: 26.35, lon: 73.55, exworksPerMt: 8000 },
    { name: 'Odisha',  lat: 22.19, lon: 84.58, exworksPerMt: 8000 }
  ];
  const dest = { lat: 20.30, lon: 85.82 };   // Bhubaneswar-ish
  // fake distance: crude but deterministic — Odisha much closer to an Odisha dest
  const distanceFn = (p, d) => Math.round(Math.hypot(p.lat - d.lat, p.lon - d.lon) * 111 * 1.3);
  const res = FC.bestPlant(plants, dest, { method: 'per_ton_km', rate: 4, qtyMt: 25, exworksPerMt: 8000, cap: 25, distanceFn });
  eq(res.best.plant.name, 'Odisha', 'closer plant wins on delivered cost');
  ok(res.savingsPerMt > 0, 'reports a per-MT saving vs the farther plant');
  ok(res.rows.length === 2 && res.rows[0].deliveredPerMt <= res.rows[1].deliveredPerMt, 'rows sorted cheapest-first');
  ok(res.reasons.indexOf('Lowest delivered cost') >= 0, 'gives the lowest-cost reason');
}

console.log('\n' + (fail === 0 ? '✅ PASSED' : '❌ FAILED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail === 0 ? 0 : 1);
