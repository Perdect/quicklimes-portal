/* Tests for the allocation engine.
   The anchor case is real: AMAN ENTERPRISES, ₹4,97,490 received, four open
   invoices, two of them ₹2,48,745. Oldest-first would have spread it over
   three bills and left a stray partial. The customer paid 51 and 52. */
const A = require('./allocate-core.js');
let pass = 0, fail = 0; const bad = [];
const ok = (m, c) => { if (c) pass++; else { fail++; bad.push(m); } };

/* The real ledger, as it stands today. */
const AMAN = [
  { idx: 12, ref: '154/2025-26', date: '2025-12-15', bal: 193301 },
  { idx: 40, ref: '36/2026-27', date: '2026-05-27', bal: 262605 },
  { idx: 55, ref: '51/2026-27', date: '2026-06-21', bal: 248745 },
  { idx: 56, ref: '52/2026-27', date: '2026-06-21', bal: 248745 }
];

/* ── EXACT MATCH ─────────────────────────────────────────────────────────── */
{
  const p = A.propose(497490, AMAN);
  ok('AMAN · 4,97,490 is recognised as invoices 51 + 52, not an oldest-first spread',
     p.kind === 'exact' && p.rows.length === 2 &&
     p.rows.map(r => r.ref).sort().join(',') === '51/2026-27,52/2026-27');
  ok('AMAN · both lines are paid in full', p.rows.every(r => r.apply === r.bal));
  ok('AMAN · nothing is left unapplied', p.unapplied === 0 && p.applied === 497490);
  ok('AMAN · the proposal explains itself', /exactly this amount/.test(p.why) && /51\/2026-27/.test(p.why));

  const one = A.propose(262605, AMAN);
  ok('EXACT · a single matching bill is preferred over any pair',
     one.kind === 'exact' && one.rows.length === 1 && one.rows[0].ref === '36/2026-27');

  const three = A.propose(193301 + 248745 + 248745, AMAN);
  ok('EXACT · a three-bill combination is found when that is the only exact fit',
     three.kind === 'exact' && three.rows.length === 3 && three.unapplied === 0);
}

/* ── OLDEST FIRST ────────────────────────────────────────────────────────── */
{
  const p = A.propose(300000, AMAN);
  ok('FIFO · a non-matching amount clears the oldest bill first',
     p.kind === 'fifo' && p.rows[0].ref === '154/2025-26' && p.rows[0].apply === 193301);
  ok('FIFO · the remainder spills to the next-oldest, capped at its balance',
     p.rows[1].ref === '36/2026-27' && p.rows[1].apply === 106699);
  ok('FIFO · the whole amount is accounted for', p.applied === 300000 && p.unapplied === 0);
  ok('FIFO · says plainly that no exact match existed', /no combination/.test(p.why));
}

/* ── MONEY THAT HAS NOWHERE TO GO ────────────────────────────────────────── */
{
  const total = AMAN.reduce((a, i) => a + i.bal, 0);
  const p = A.propose(total + 50000, AMAN);
  ok('OVERPAY · every bill is closed', p.applied === total);
  ok('OVERPAY · the excess is reported as unapplied, NOT absorbed into a bill',
     p.unapplied === 50000 && p.rows.every(r => r.apply <= r.bal + A.EPS));

  const none = A.propose(10000, []);
  ok('NO BILLS · nothing to allocate against leaves the full amount unapplied',
     none.kind === 'none' && none.rows.length === 0 && none.unapplied === 10000);
}

/* ── WHAT THE USER TYPED ─────────────────────────────────────────────────── */
{
  const v = A.validate(497490, AMAN, { 55: 248745, 56: 248745 });
  ok('EDIT · a valid hand allocation passes', v.ok && v.applied === 497490 && v.unapplied === 0);

  const over = A.validate(497490, AMAN, { 55: 300000 });
  ok('EDIT · a line above the bill balance is refused and named',
     !over.ok && /51\/2026-27 only has/.test(over.errors[0]));

  const tooMuch = A.validate(100000, AMAN, { 12: 193301 });
  ok('EDIT · allocating more than was received is refused',
     !tooMuch.ok && /only 100000/.test(tooMuch.errors.join(' ').replace(/\.00/g, '')));

  const neg = A.validate(50000, AMAN, { 12: -5 });
  ok('EDIT · a negative allocation is refused', !neg.ok && /cannot be negative/.test(neg.errors[0]));

  const part = A.validate(497490, AMAN, { 55: 248745 });
  ok('EDIT · under-allocating is allowed and the rest stays unapplied',
     part.ok && part.applied === 248745 && part.unapplied === 248745);

  const zero = A.validate(497490, AMAN, {});
  ok('EDIT · allocating nothing is allowed — the whole receipt goes on account',
     zero.ok && zero.rows.length === 0 && zero.unapplied === 497490);
}

/* ── SETTLED BILLS AND ROUNDING ──────────────────────────────────────────── */
{
  const withPaid = AMAN.concat([{ idx: 99, ref: 'PAID/1', date: '2025-01-01', bal: 0 }]);
  const p = A.propose(193301, withPaid);
  ok('SETTLED · a bill with no balance is never a target',
     p.rows.every(r => r.ref !== 'PAID/1'));

  const cents = [{ idx: 1, ref: 'C1', date: '2026-01-01', bal: 0.1 },
                 { idx: 2, ref: 'C2', date: '2026-01-02', bal: 0.2 }];
  const c = A.propose(0.3, cents);
  ok('ROUNDING · 0.1 + 0.2 is treated as an exact match for 0.3',
     c.kind === 'exact' && c.unapplied === 0);

  /* Each line is rounded to the paisa, and the engine's own applied/unapplied
     figures are the ones the ledger posts — so those are what must be clean.
     (Summing the raw floats gives 0.30000000000000004; that is the reason the
     engine reports r2() totals rather than leaving the caller to add them up.) */
  const f = A.propose(0.3, cents);
  ok('ROUNDING · the posted totals carry no floating-point dust',
     f.applied === 0.3 && f.unapplied === 0 && f.rows.every(r => r.apply === Math.round(r.apply * 100) / 100));
}

/* ── ORDER INDEPENDENCE ──────────────────────────────────────────────────── */
{
  const shuffled = [AMAN[3], AMAN[0], AMAN[2], AMAN[1]];
  const p = A.propose(300000, shuffled);
  ok('ORDER · input order does not change the answer — date does',
     p.rows[0].ref === '154/2025-26' && p.rows[1].ref === '36/2026-27');
}

console.log('\n════ allocate-core (which invoices does this money pay?) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' ALLOCATION TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
