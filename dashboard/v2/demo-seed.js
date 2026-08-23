/* ═══════════════════════════════════════════════════════════════════════
   DEMO DATA — deterministic seed for a realistic Quick Lime works.
   window.QLDemo (node-requirable for the reconciliation tests).

   Generates one COMPLETE data blob (the exact shape data.js hydrate() eats):
   parties → purchase bills → production runs (consuming what was bought) →
   classified expenses → sales invoices (selling what was produced) → receipts.
   Nothing here is a dashboard number: every figure the app will show is
   COMPUTED by the live engines (costing-core, data.js) off these transactions.

   SAFETY — this never touches real books:
   · generate() is pure: rows out, no storage.
   · data.js installDemo() refuses to install unless the ACTIVE company's name
     says DEMO. The user's real firms can never be overwritten by this file.
   · every record carries _demo: 1, and the blob carries demo: {…} metadata.

   DEMO ASSUMPTIONS (§10: configurable, and explicitly NOT claimed as industry
   standard — they are stated so the numbers can be traced, nothing more):     */
(function (root) {
  'use strict';
  var A = {
    seed: 20260601,             // fixed → same data every run (§28 deterministic)
    limestonePerT: 1.75,        // T limestone per T lime out (≈57% yield) ± noise
    petcokePerT: 0.11,          // T petcoke per T lime out ± noise
    bagsPerHydT: 20,            // 50-kg bags per T of hydrated (bagged product)
    limestoneRate: [620, 760],  // ₹/T delivered
    petcokeRate: [8800, 9900],  // ₹/T
    bagRate: [22, 26],          // ₹/bag
    qlRate: [4650, 5750],       // ₹/T selling (trimmed inside the spec band so June GP lands in its 8–15L target)
    hydRate: [6100, 7000],      // ₹/T selling
    qlDaily: [19, 32],          // T/day when the kilns run (spec range)
    hydDaily: [8, 20]           // T/day on hydration days (spec range)
  };

  /* mulberry32 — tiny, deterministic. */
  function rng(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      var r = Math.imul(t ^ t >>> 15, 1 | t);
      r = r + Math.imul(r ^ r >>> 7, 61 | r) ^ r;
      return ((r ^ r >>> 14) >>> 0) / 4294967296;
    };
  }
  var R2 = function (n) { return Math.round(n * 100) / 100; };

  var SUPPLIERS = [
    { name: 'Rajasthan Limestone Suppliers', gstin: '08AAACR1234L1Z6', state: 'Rajasthan', city: 'Gotan', phone: '9829011001', sells: 'limestone' },
    { name: 'Marwar Minerals & Mining', gstin: '08AABCM5678M1Z4', state: 'Rajasthan', city: 'Nagaur', phone: '9829011002', sells: 'limestone' },
    { name: 'Shree Petcoke Suppliers', gstin: '24AADCS9012P1Z8', state: 'Gujarat', city: 'Jamnagar', phone: '9825011003', sells: 'petcoke' },
    { name: 'Rajasthan Fuel Traders', gstin: '08AAFCR3456F1Z2', state: 'Rajasthan', city: 'Jodhpur', phone: '9829011004', sells: 'petcoke' },
    { name: 'Jaipur Industrial Packaging', gstin: '08AAGCJ7890K1Z9', state: 'Rajasthan', city: 'Jaipur', phone: '9829011005', sells: 'packaging' }
  ];
  var CUSTOMERS = [
    { name: 'Rajasthan Construction Materials', gstin: '08AAHCR2345C1Z1', state: 'Rajasthan', type: 'Construction', buys: 'quicklime' },
    { name: 'Jaipur Infrastructure Pvt Ltd', gstin: '08AAICJ6789I1Z5', state: 'Rajasthan', type: 'Construction', buys: 'quicklime' },
    { name: 'Marwar Steel & Chemicals', gstin: '08AAJCM0123S1Z3', state: 'Rajasthan', type: 'Industrial', buys: 'quicklime' },
    { name: 'Delhi Industrial Minerals', gstin: '07AAKCD4567D1Z7', state: 'Delhi', type: 'Dealer', buys: 'quicklime' },
    { name: 'Shree Cement Materials', gstin: '08AALCS8901C1Z0', state: 'Rajasthan', type: 'Industrial', buys: 'quicklime' },
    { name: 'North India Chemical Traders', gstin: '06AAMCN2345N1Z8', state: 'Haryana', type: 'Chemical', buys: 'hydrated' },
    { name: 'Agra Lime & Chemicals', gstin: '09AANCA6789A1Z2', state: 'Uttar Pradesh', type: 'Chemical', buys: 'hydrated' },
    { name: 'Jodhpur Building Solutions', gstin: '08AAPCJ0123B1Z6', state: 'Rajasthan', type: 'Distributor', buys: 'quicklime' }
  ];

  function generate(seed) {
    var rand = rng(seed || A.seed);
    var pick = function (arr) { return arr[Math.floor(rand() * arr.length)]; };
    var between = function (r) { return r[0] + rand() * (r[1] - r[0]); };
    var jitter = function (v, pct) { return v * (1 + (rand() * 2 - 1) * pct); };
    var _id = 1000;
    var id = function (p) { return p + 'D' + (_id++); };
    var D = function (ym, day) { return ym + '-' + String(day).padStart(2, '0'); };

    var parties = [], purchases = [], prod = [], expenses = [], sales = [], cashbook = [];

    SUPPLIERS.forEach(function (s) {
      parties.push({ id: id('p'), _demo: 1, name: s.name, gstin: s.gstin, phone: s.phone,
        address: s.city + ', ' + s.state, state: s.state, type: 'supplier',
        notes: 'DEMO supplier · payment terms 30 days', opening: 0, creditLimit: 0, creditDays: 30 });
    });
    CUSTOMERS.forEach(function (c) {
      parties.push({ id: id('p'), _demo: 1, name: c.name, gstin: c.gstin, phone: '',
        address: c.state, state: c.state, type: 'customer',
        notes: 'DEMO customer · ' + c.type, opening: 0, creditLimit: 0, creditDays: 15 });
    });

    var billNo = 1, invNo = 1;
    function buyMaterial(date, group, qty, rate, sup) {
      var taxable = R2(qty * rate);
      purchases.push({ _demo: 1, bill: sup.name.split(' ')[0].toUpperCase().slice(0, 4) + '/' + String(billNo++).padStart(3, '0'),
        date: date, sup: sup.name, gstin: sup.gstin, group: group, cat: group,
        qty: R2(qty), taxable: taxable, grate: 5, itc: 'Eligible', veh: 'RJ19GA' + (1000 + Math.floor(rand() * 9000)),
        status: rand() < 0.7 ? 'paid' : 'pending' });
      return taxable;
    }

    /* ── March: opening stock arrives as REAL transactions (§8: never fake a
       balance — closing stock must FALL OUT of purchases − consumption). */
    var supLime = SUPPLIERS[0], supLime2 = SUPPLIERS[1], supPet = SUPPLIERS[2], supPet2 = SUPPLIERS[3], supBag = SUPPLIERS[4];
    buyMaterial('2026-03-24', 'limestone', 520, between(A.limestoneRate), supLime);
    buyMaterial('2026-03-27', 'petcoke', 62, between(A.petcokeRate), supPet);
    buyMaterial('2026-03-28', 'packaging', 28000, between(A.bagRate), supBag);
    /* a little March production so April has a "previous month" and opening FG */
    [26, 28, 30].forEach(function (day) {
      var ql = between(A.qlDaily), hyd = day === 30 ? between(A.hydDaily) : 0;
      var out = ql + hyd;
      prod.push({ id: id('PR'), _demo: 1, date: D('2026-03', day), kiln: day % 2 ? 'Kiln 1' : 'Kiln 2',
        limestone: R2(jitter(out * A.limestonePerT, 0.06)), petcoke: R2(jitter(out * A.petcokePerT, 0.1)),
        bags: Math.round(hyd * A.bagsPerHydT), quicklime: R2(ql), hydrated: R2(hyd), labour: 0,
        note: 'DEMO run' });
    });

    /* ── Apr / May / Jun: the three demo months. June runs strongest (§18). ── */
    var MONTHS = [
      { ym: '2026-04', days: 30, operating: 22, hydDays: 6, tempo: 0.86 },
      { ym: '2026-05', days: 31, operating: 24, hydDays: 7, tempo: 0.93 },
      { ym: '2026-06', days: 30, operating: 26, hydDays: 8, tempo: 1.0 }
    ];

    MONTHS.forEach(function (M, mi) {
      /* maintenance/shutdown days: realistic gaps, not uniform production */
      var closed = {};
      while (Object.keys(closed).length < M.days - M.operating) closed[1 + Math.floor(rand() * M.days)] = 1;
      var hydOn = {};
      while (Object.keys(hydOn).length < M.hydDays) { var d = 1 + Math.floor(rand() * M.days); if (!closed[d]) hydOn[d] = 1; }

      /* material purchases through the month (1–2 limestone lots, 2 petcoke, 1 bags) */
      buyMaterial(D(M.ym, 3 + Math.floor(rand() * 4)), 'limestone', jitter(700 * M.tempo, 0.12), between(A.limestoneRate), supLime);
      buyMaterial(D(M.ym, 16 + Math.floor(rand() * 5)), 'limestone', jitter(560 * M.tempo, 0.12), between(A.limestoneRate), supLime2);
      buyMaterial(D(M.ym, 5 + Math.floor(rand() * 4)), 'petcoke', jitter(48 * M.tempo, 0.15), between(A.petcokeRate), supPet);
      buyMaterial(D(M.ym, 19 + Math.floor(rand() * 5)), 'petcoke', jitter(38 * M.tempo, 0.15), between(A.petcokeRate), supPet2);
      buyMaterial(D(M.ym, 9 + Math.floor(rand() * 6)), 'packaging', Math.round(jitter(16000 * M.tempo, 0.2)), between(A.bagRate), supBag);

      /* production: every operating day, varied output, two kilns */
      for (var day = 1; day <= M.days; day++) {
        if (closed[day]) continue;
        var ql = between(A.qlDaily) * M.tempo;
        var hyd = hydOn[day] ? between(A.hydDaily) : 0;
        var out = ql + hyd;
        prod.push({ id: id('PR'), _demo: 1, date: D(M.ym, day), kiln: day % 2 ? 'Kiln 1' : 'Kiln 2',
          limestone: R2(jitter(out * A.limestonePerT, 0.07)),
          petcoke: R2(jitter(out * A.petcokePerT, 0.12)),
          bags: Math.round(hyd * A.bagsPerHydT),
          quicklime: R2(ql), hydrated: R2(hyd), labour: 0, note: 'DEMO run' });
      }

      /* classified expenses — different heads on different dates (§11/§12).
         Raw materials are NOT here (they are purchase bills): §17. */
      var E = function (day, group, sub, amount, vendor, cc, treatment) {
        expenses.push({ id: id('EX'), _demo: 1, date: D(M.ym, day), group: group, sub: sub,
          amount: R2(jitter(amount * M.tempo, 0.08)), vendor: vendor || '', mode: 'bank',
          costCenter: cc || 'Factory', treatment: treatment, recurring: false, note: 'DEMO' });
      };
      // direct production
      E(6, 'production', 'Electricity', 148000, 'Jodhpur Vidyut Vitran', 'Factory', 'direct-production');
      E(12, 'production', 'Diesel (production)', 34000, 'IOCL Gotan', 'Factory', 'direct-production');
      E(27, 'production', 'Production labour', 152000, 'Site labour contractor', 'Kiln 1', 'direct-production');
      E(27, 'production', 'Contract labour', 58000, 'Marwar Manpower', 'Kiln 2', 'direct-production');
      E(15, 'production', 'Water', 9500, 'Tanker supply', 'Factory', 'direct-production');
      E(20, 'production', 'Production consumables', 12500, 'Local hardware', 'Factory', 'direct-production');
      // factory overhead
      E(8, 'factory', 'Kiln maintenance', 32000, 'Kiln service crew', 'Kiln ' + (1 + mi % 2), 'factory-overhead');
      E(14, 'factory', 'Machinery maintenance', 21000, 'Gotan Engineering Works', 'Factory', 'factory-overhead');
      E(17, 'factory', 'Spare parts', 18500, 'Jodhpur Machinery Stores', 'Factory', 'factory-overhead');
      E(11, 'factory', 'Lubricants / grease / oil', 7800, 'Shell distributor', 'Factory', 'factory-overhead');
      E(22, 'factory', 'Refractory / furnace bricks', 26000, 'Refractory suppliers', 'Kiln 2', 'factory-overhead');
      E(3, 'factory', 'Factory rent', 60000, 'Land lease', 'Factory', 'factory-overhead');
      E(25, 'employee', 'Security salary', 22000, 'Security staff', 'Factory', 'employee');
      E(26, 'factory', 'Cleaning / waste disposal', 6500, 'Cleaning contractor', 'Factory', 'factory-overhead');
      E(28, 'overhead', 'Depreciation — machinery', 75000, '', 'Factory', 'factory-overhead');
      // admin
      E(4, 'admin', 'Office rent', 18000, 'Office landlord', 'Office', 'admin');
      E(29, 'employee', 'Office staff salary', 86000, 'Staff payroll', 'Office', 'employee');
      E(9, 'admin', 'Internet / telephone', 3200, 'Airtel', 'Office', 'admin');
      E(18, 'admin', 'CA / accounting fees', 15000, 'CA firm, Jodhpur', 'Office', 'admin');
      E(21, 'admin', 'Software subscriptions', 4500, 'Software vendors', 'Office', 'admin');
      // selling
      E(24, 'selling', 'Sales commission', 42000, 'Sales agents', 'General', 'selling');
      E(16, 'transport', 'Outbound customer freight', 68000, 'Marwar Transport Co', 'Vehicles', 'selling');
      E(13, 'transport', 'Truck loading', 21000, 'Loading gang', 'Vehicles', 'selling');
      E(23, 'selling', 'Sales travel', 8500, '', 'General', 'selling');
      // finance
      E(30 > M.days ? M.days : 30, 'finance', 'CC / working-capital interest', 38000, 'SBI CC account', 'General', 'finance');
      E(2, 'admin', 'Bank charges', 2400, 'SBI', 'Office', 'admin');

      /* sales: 15–25 invoices, different customers, rates and quantities (§14).
         Sold tonnage tracks ~88–92% of the month's production so FG stock
         builds up honestly. */
      var producedQl = 0, producedHyd = 0;
      prod.forEach(function (r) { if (r.date.slice(0, 7) === M.ym) { producedQl += r.quicklime; producedHyd += r.hydrated; } });
      var sellQl = producedQl * (0.86 + rand() * 0.08), sellHyd = producedHyd * (0.8 + rand() * 0.12);
      /* keep invoicing until the month's dispatch target is met — a fixed
         invoice count left months undersold when the draws ran small */
      var soldQl = 0, soldHyd = 0, nInv = 0;
      while (nInv < 25 && (soldQl < sellQl * 0.96 || nInv < 15)) {
        nInv++;
        var wantHyd = (soldHyd < sellHyd) && (rand() < 0.3);
        var cust = pick(CUSTOMERS.filter(function (c) { return wantHyd ? c.buys === 'hydrated' : c.buys === 'quicklime'; }));
        var qty = R2(Math.min(between(wantHyd ? [12, 25] : [18, 42]), (wantHyd ? sellHyd - soldHyd : sellQl - soldQl)));
        if (qty < 5) continue;
        if (wantHyd) soldHyd += qty; else soldQl += qty;
        var rate = Math.round(between(wantHyd ? A.hydRate : A.qlRate));
        var day2 = 2 + Math.floor(rand() * (M.days - 3));
        var paid = rand() < 0.72;
        var inv = 'GLD/26-27/' + String(invNo++).padStart(3, '0');
        sales.push({ _demo: 1, inv: inv, date: D(M.ym, day2), party: cust.name, gstin: cust.gstin,
          qty: qty, rate: rate, gstR: 5, product: wantHyd ? 'hydrated' : 'quicklime',
          veh: 'RJ19GB' + (1000 + Math.floor(rand() * 9000)),
          status: paid ? 'paid' : 'pending',
          paidMode: paid ? (rand() < 0.5 ? 'bank' : 'upi') : '', paidDate: paid ? D(M.ym, Math.min(M.days, day2 + 3)) : '' });
        if (paid) cashbook.push({ id: id('cb'), _demo: 1, date: D(M.ym, Math.min(M.days, day2 + 3)), type: 'credit',
          amount: R2(qty * rate * 1.05), party: cust.name, category: 'Customer receipt', notes: 'DEMO receipt · ' + inv, mode: 'bank' });
      }
      /* supplier payments for the paid bills */
      purchases.forEach(function (p) {
        if (p.date.slice(0, 7) === M.ym && p.status === 'paid')
          cashbook.push({ id: id('cb'), _demo: 1, date: p.date, type: 'debit', amount: R2(p.taxable * 1.05),
            party: p.sup, category: 'Supplier payment', notes: 'DEMO payment · ' + p.bill, mode: 'bank' });
      });
    });

    return {
      demo: { version: 1, seed: seed || A.seed, generated: '2026-06 demo set · Apr–Jun 2026', assumptions: A },
      sales: sales, purchases: purchases, prod: prod, expenses: expenses,
      parties: parties, cashbook: cashbook,
      workers: [], workLog: [], att: {}, tds: [], challans: [], loans: [], chunna: [], audit: [], refunds: []
    };
  }

  var api = { generate: generate, ASSUMPTIONS: A };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QLDemo = api;
})(typeof window !== 'undefined' ? window : globalThis);
