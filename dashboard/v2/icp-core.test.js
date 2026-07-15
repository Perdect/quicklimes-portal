/* icp-core.test.js — the ICP engine's contract.

   What goes wrong here isn't a crash. It's a confident wrong answer:
     • "SHREE CEMENT" filed as AAC because 'aerated concrete' contains 'concrete'
     • a reorder predicted off two invoices, so the sales team learns to ignore it
     • an industry ranked #1 on revenue while losing money per tonne
     • a cancelled invoice counted as a sale
     • a name-guess presented as a known fact
   Run: node icp-core.test.js */

const I = require('./icp-core.js');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), a === b);

/* ── 1. INDUSTRY: order matters, and a guess is never a fact ── */
eq('AAC beats cement on "autoclaved aerated concrete"', I.industryOf({ name: 'SHREE AUTOCLAVED AERATED CONCRETE PVT LTD' }).key, 'aac');
eq('plain AAC', I.industryOf({ name: 'Magicrete AAC Blocks' }).key, 'aac');
eq('real cement still reads as cement', I.industryOf({ name: 'SHREE CEMENT LIMITED' }).key, 'cement');
eq('sugar', I.industryOf({ name: 'Shri Ganesh Sahakari Sakhar Karkhana' }).key, 'sugar');
eq('paper', I.industryOf({ name: 'JK Paper Mills Ltd' }).key, 'paper');
eq('steel', I.industryOf({ name: 'Jindal Ispat & Steel' }).key, 'steel');
eq('foundry', I.industryOf({ name: 'Rajasthan Foundry Works' }).key, 'foundry');
eq('water treatment', I.industryOf({ name: 'Aqua ETP Water Treatment Co' }).key, 'water');
eq('glass', I.industryOf({ name: 'Gujarat Float Glass Ltd' }).key, 'glass');
eq('trader is the LAST resort', I.industryOf({ name: 'Bansal Trading Company' }).key, 'trader');
eq('an unmatchable name is unknown, not guessed into a bucket', I.industryOf({ name: 'Ramesh & Sons' }).key, '');

const guessed = I.industryOf({ name: 'Magicrete AAC Blocks' });
eq('a name match is marked as a GUESS', guessed.source, 'guess');
ok('a guess carries a confidence below 1', guessed.confidence > 0 && guessed.confidence < 1);
const set = I.industryOf({ name: 'Anything At All', industry: 'sugar' });
eq('a confirmed industry WINS over the name', set.key, 'sugar');
eq('...and is marked as set', set.source, 'set');
eq('...at full confidence', set.confidence, 1);
eq('unknown has zero confidence', I.industryOf({ name: 'Ramesh & Sons' }).confidence, 0);
ok('"trader" is low-confidence — half of India is "X Enterprises"',
  I.industryOf({ name: 'Gupta Enterprises' }).confidence < 0.5);

/* ── 2. REORDER: never predict from too little history ── */
const mk = (date, qty, total, status) => ({ inv: date, date, qty, total, taxable: total, status: status || 'pending' });

const two = I.orderProfile([mk('2026-01-01', 20, 250000), mk('2026-02-01', 20, 250000)], '2026-03-15');
eq('two orders is not a pattern', two.status, 'unknown');
ok('...and it says why', /need 3/.test(two.why));
ok('...and is not confident', two.confident === false);
eq('no invoices at all', I.orderProfile([], '2026-03-15').status, 'unknown');

// a real 30-day rhythm
const rhythm = [mk('2026-01-01', 20, 250000), mk('2026-01-31', 22, 275000), mk('2026-03-02', 20, 250000), mk('2026-04-01', 21, 260000)];
const p30 = I.orderProfile(rhythm, '2026-04-05');
eq('a 4-order 30-day rhythm is confident', p30.confident, true);
ok('median gap ~30 days', Math.abs(p30.medianDays - 30) <= 1);
eq('4 days after the last order they are on track', p30.status, 'ontrack');
const pDue = I.orderProfile(rhythm, '2026-04-28');            // 27 days on
eq('at ~the usual gap they are DUE', pDue.status, 'due');
const pOver = I.orderProfile(rhythm, '2026-05-20');           // 49 days on = 1.6x
eq('well past the gap they are OVERDUE', pOver.status, 'overdue');
ok('...and it quantifies it', /past their usual/.test(pOver.why));
const pDead = I.orderProfile(rhythm, '2026-08-01');           // 122 days
eq('long gone is DORMANT, not "overdue"', pDead.status, 'dormant');
ok('dormant explains itself', /likely lost/.test(pDead.why));

/* ── 3. cancelled is not a sale ── */
const withCancel = [mk('2026-01-01', 20, 250000), mk('2026-01-31', 22, 275000), mk('2026-03-02', 20, 250000), mk('2026-03-10', 99, 9999999, 'cancelled')];
const pc = I.orderProfile(withCancel, '2026-03-15');
eq('a cancelled invoice is not counted as an order', pc.orders, 3);
ok('a cancelled invoice does not inflate tonnes', pc.tonnes === 62);
ok('a cancelled invoice does not become the last order date', pc.lastDate === '2026-03-02');

/* ── 4. same-day invoices are one order, not a zero gap ── */
// TWO same-day pairs: raw gaps would be [0,30,0,31] -> median 15, which would
// halve the predicted cycle and chase every customer twice as often. One pair
// alone leaves the median at 30 and hides the bug — a weaker test would pass.
const sameDay = I.orderProfile([
  mk('2026-01-01', 10, 120000), mk('2026-01-01', 10, 120000),
  mk('2026-01-31', 20, 250000),
  mk('2026-03-02', 20, 250000), mk('2026-03-02', 10, 120000),
  mk('2026-04-02', 20, 250000)
], '2026-04-05');
ok('same-day split invoices never create a 0-day cycle', sameDay.medianDays >= 29);
ok('...so the reorder cycle is not halved', sameDay.medianDays > 20);

/* ── 5. ICP BY INDUSTRY — ranked by margin, not turnover ── */
const PARTIES = [
  { name: 'MAGICRETE AAC BLOCKS', industry: 'aac', phone: '9460034743' },
  { name: 'SHREE SAKHAR KARKHANA', industry: 'sugar', phone: '9812345678' },
];
// AAC: 100 T at ₹12,000/T ex-GST. Sugar: 400 T at ₹6,000/T. Sugar wins on
// revenue; with cost ₹5,000/T, AAC earns 7,000/T vs sugar's 1,000/T.
const SALES = [
  { inv: 'A1', date: '2026-01-01', party: 'MAGICRETE AAC BLOCKS', qty: 50, taxable: 600000, total: 630000, status: 'pending' },
  { inv: 'A2', date: '2026-02-01', party: 'MAGICRETE AAC BLOCKS', qty: 50, taxable: 600000, total: 630000, status: 'pending' },
  { inv: 'S1', date: '2026-01-01', party: 'SHREE SAKHAR KARKHANA', qty: 200, taxable: 1200000, total: 1260000, status: 'pending' },
  { inv: 'S2', date: '2026-02-01', party: 'SHREE SAKHAR KARKHANA', qty: 200, taxable: 1200000, total: 1260000, status: 'pending' },
];
const icp = I.icpByIndustry({ sales: SALES, parties: PARTIES, costPerTonne: 5000 });
const aac = icp.find(r => r.key === 'aac'), sug = icp.find(r => r.key === 'sugar');
eq('AAC price/tonne read from real invoices', aac.pricePerTonne, 12000);
eq('sugar price/tonne', sug.pricePerTonne, 6000);
eq('AAC margin/tonne = price - plant cost', aac.marginPerTonne, 7000);
eq('sugar margin/tonne', sug.marginPerTonne, 1000);
ok('sugar has MORE revenue', sug.revenue > aac.revenue);
eq('AAC total margin (100T x 7000)', aac.totalMargin, 700000);
eq('sugar total margin (400T x 1000)', sug.totalMargin, 400000);
eq('ranked by MARGIN, so AAC is first despite lower turnover', icp[0].key, 'aac');
eq('customer count', aac.customers, 1);
eq('confirmed industries report 100% confirmed', aac.confirmedPct, 100);

// the same data with UNCONFIRMED industries must flag itself as guesswork
const icpGuess = I.icpByIndustry({ sales: SALES, parties: [{ name: 'MAGICRETE AAC BLOCKS' }, { name: 'SHREE SAKHAR KARKHANA' }], costPerTonne: 5000 });
ok('a row built from name-guesses reports low confirmed%', icpGuess.every(r => r.confirmedPct === 0));

// no cost data => no margin invented
const icpNoCost = I.icpByIndustry({ sales: SALES, parties: PARTIES });
ok('without cost data, margin is null — never guessed', icpNoCost.every(r => r.marginPerTonne === null && r.totalMargin === null));
ok('...and it falls back to ranking on revenue', icpNoCost[0].key === 'sugar');

/* ── 6. cost per tonne ── */
eq('cost/T = (cogs + labour) / tonnes', I.costPerTonne({ cogs: 400000, labour: 100000 }, 100), 5000);
eq('zero tonnes -> null, not Infinity', I.costPerTonne({ cogs: 400000, labour: 100000 }, 0), null);
eq('no P&L -> null', I.costPerTonne(null, 100), null);
eq('zero cost -> null (not a free plant)', I.costPerTonne({ cogs: 0, labour: 0 }, 100), null);

/* ── 7. REORDER BOARD — worst first ── */
const board = I.reorderBoard({ sales: SALES.concat(rhythm.map(r => Object.assign({}, r, { party: 'ARIF LIME' }))), parties: PARTIES.concat([{ name: 'ARIF LIME', phone: '9460000000' }]), today: '2026-05-20' });
ok('every selling party appears', board.length === 3);
const arif = board.find(b => b.party === 'ARIF LIME');
eq('ARIF is overdue on a real rhythm', arif.status, 'overdue');
eq('board is ranked worst-first', board[0].status, 'overdue');
ok('an overdue row carries the expected order value for ranking', arif.expectedValue > 0);
ok('a guessed industry is flagged on the board', board.find(b => b.party === 'ARIF LIME').industryGuessed === true);
ok('a confirmed industry is not flagged', board.find(b => b.party === 'MAGICRETE AAC BLOCKS').industryGuessed === false);

/* ── 8. SCORE LEAD — "good" means "resembles who already pays you" ── */
const hi = I.scoreLead({ industry: 'aac', estTonnesPerMonth: 100, distanceKm: 120 }, icp);
const lo = I.scoreLead({ industry: 'sugar', estTonnesPerMonth: 100, distanceKm: 120 }, icp);
ok('the higher-MARGIN industry scores higher, though it sells less', hi.score > lo.score);
eq('a strong nearby lead in your best industry is high tier', hi.tier, 'high');
ok('the score explains itself in plain words', hi.why.length >= 2 && typeof hi.why[0] === 'string');
ok('...naming the industry', hi.why.join(' ').indexOf('AAC') >= 0);

const far = I.scoreLead({ industry: 'aac', estTonnesPerMonth: 100, distanceKm: 950 }, icp);
ok('freight kills a distant lead — lime is heavy and cheap', far.score < hi.score);
ok('...and says so', /freight probably kills/.test(far.why.join(' ')));

const never = I.scoreLead({ industry: 'glass', estTonnesPerMonth: 100, distanceKm: 100 }, icp);
eq('an industry you have never sold to scores 0, not a guess', never.score, 0);
eq('...and is tiered unknown', never.tier, 'unknown');
ok('...and admits there is no evidence', /never sold/.test(never.why.join(' ')));

// a loss-making industry must not be recommended, however well it matches
const lossIcp = I.icpByIndustry({ sales: SALES, parties: PARTIES, costPerTonne: 7000 });   // sugar now loses 1000/T
const lossy = I.scoreLead({ industry: 'sugar', estTonnesPerMonth: 500, distanceKm: 50 }, lossIcp);
ok('a loss-making industry is capped low even with size + proximity', lossy.score < 40);
ok('...and warns you are losing money per tonne', /LOSE .*per tonne/.test(lossy.why.join(' ')));
ok('...and states the counter-intuitive bit: a bigger order is worse',
  /bigger order here loses you more/.test(lossy.why.join(' ')));
ok('...and quantifies the loss in rupees', /₹[\d,]+ per tonne/.test(lossy.why.join(' ')));

// THE NASTY CASE: a bad month where EVERY industry loses money. The best row is
// now the LEAST-BAD, so margin/best turns positive again and the worst industry
// would score high — recommending exactly what is bleeding you. The cap is the
// only thing standing between you and that.
const allLoss = I.icpByIndustry({ sales: SALES, parties: PARTIES, costPerTonne: 20000 });
ok('sanity: every industry is under water in this scenario', allLoss.every(r => r.marginPerTonne < 0));
const worst = I.scoreLead({ industry: 'sugar', estTonnesPerMonth: 500, distanceKm: 50 }, allLoss);
const lessBad = I.scoreLead({ industry: 'aac', estTonnesPerMonth: 500, distanceKm: 50 }, allLoss);
ok('when everything loses money, nothing is recommended (worst)', worst.score < 40 && worst.tier !== 'high');
ok('when everything loses money, nothing is recommended (least-bad either)', lessBad.score < 40 && lessBad.tier !== 'high');
ok('...and both say you are losing money per tonne',
  /LOSE .*per tonne/.test(worst.why.join(' ')) && /LOSE .*per tonne/.test(lessBad.why.join(' ')));
ok('the warning leads the explanation, not buried at the end',
  /LOSE/.test(worst.why[0]));

/* ── 9. money sanity ── */
ok('no float noise in a price per tonne', String(aac.pricePerTonne).indexOf('.0000') < 0);
eq('median of an empty set is null, not NaN', I.median([]), null);
eq('median ignores junk', I.median([10, null, undefined, 20, NaN, 30]), 20);

console.log('\n════ ICP engine (learned from your own invoices) ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' ICP TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
