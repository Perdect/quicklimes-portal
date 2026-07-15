/* crm-core.test.js — the pipeline + consent contract.

   The failures that matter here are quiet ones:
     • a forecast that flatters, so limestone gets bought against a daydream
     • a bought contact WhatsApped, which is a DPDP problem AND a banned number
     • an opt-out honoured on one channel but not another
     • two rows for one company, so two salesmen quote one buyer two prices
     • a lead worth "0" that is actually worth "unknown"
   Run: node crm-core.test.js */

const C = require('./crm-core.js');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), a === b);

/* ── 1. VALUE: unknown is null, never zero ── */
eq('value = tonnes x price', C.leadValue({ tonnes: 20, price_per_tonne: 12000 }), 240000);
eq('no price -> unknown, NOT zero', C.leadValue({ tonnes: 20 }), null);
eq('no tonnes -> unknown', C.leadValue({ price_per_tonne: 12000 }), null);
eq('zero tonnes -> unknown, not a real zero-value deal', C.leadValue({ tonnes: 0, price_per_tonne: 12000 }), null);
eq('negative price -> unknown', C.leadValue({ tonnes: 20, price_per_tonne: -5 }), null);
eq('null lead -> null', C.leadValue(null), null);
eq('camelCase pricePerTonne also works', C.leadValue({ tonnes: 2, pricePerTonne: 100 }), 200);
// float noise must not reach a pipeline figure
eq('float noise is rounded to paise', C.leadValue({ tonnes: 18.15, price_per_tonne: 12385 }), 224787.75);
ok('...with no long tail', !/\.\d{3,}/.test(String(C.leadValue({ tonnes: 18.15, price_per_tonne: 12385 }))));

/* ── 2. STAGES ── */
eq('open stage', C.isOpen('quoted'), true);
eq('won is closed', C.isOpen('won'), false);
eq('lost is closed', C.isOpen('lost'), false);
eq('unknown stage is not open', C.isOpen('banana'), false);
eq('weighted = value x stage probability', C.weightedValue({ tonnes: 10, price_per_tonne: 10000, stage: 'quoted' }), 55000);
eq('unknown value stays unknown when weighted', C.weightedValue({ tonnes: 10, stage: 'quoted' }), null);

/* a win with no quote teaches the forecast nothing */
ok('cannot jump new -> won', C.canMove('new', 'won').ok === false);
ok('...and says why', /quote/i.test(C.canMove('new', 'won').why));
ok('quoted -> won is allowed', C.canMove('quoted', 'won').ok === true);
ok('negotiating -> won is allowed', C.canMove('negotiat', 'won').ok === true);
ok('anything -> lost is allowed', C.canMove('new', 'lost').ok === true);
ok('a lost lead can be re-opened', C.canMove('lost', 'contacted').ok === true);
ok('moving backwards is allowed but noted', C.canMove('quoted', 'new').ok === true && /backwards/i.test(C.canMove('quoted', 'new').why || ''));
ok('unknown stage is refused', C.canMove('new', 'banana').ok === false);

/* ── 3. FORECAST: the daydream and the plannable number are both shown ── */
const LEADS = [
  { id: 1, stage: 'new', tonnes: 20, price_per_tonne: 12000 },        // 240k x .05 = 12k
  { id: 2, stage: 'quoted', tonnes: 50, price_per_tonne: 12000 },     // 600k x .55 = 330k
  { id: 3, stage: 'negotiat', tonnes: 30, price_per_tonne: 12000 },   // 360k x .75 = 270k
  { id: 4, stage: 'qualified' },                                      // no price = unvalued
  { id: 5, stage: 'won', tonnes: 10, price_per_tonne: 12000 },        // closed
  { id: 6, stage: 'lost', tonnes: 90, price_per_tonne: 12000 },       // closed
];
const f = C.forecast(LEADS);
eq('only OPEN leads are in the pipeline', f.open, 4);
eq('gross is the sum of open valued leads', f.gross, 1200000);
eq('weighted is probability-adjusted', f.weighted, 612000);
ok('weighted is always below gross — hope is not a plan', f.weighted < f.gross);
eq('leads with no price are counted, not silently dropped', f.unvalued, 1);
eq('valued count', f.valued, 3);
ok('a won lead is not still in the pipeline', f.gross === 1200000);
const byQ = f.byStage.find(s => s.key === 'quoted');
eq('per-stage gross', byQ.gross, 600000);
eq('per-stage weighted', byQ.weighted, 330000);
eq('empty pipeline is zero, not NaN', C.forecast([]).weighted, 0);
eq('all-unvalued pipeline reports gross 0 but flags them', C.forecast([{ stage: 'new' }]).unvalued, 1);

/* ── 4. WIN RATES: no rate off three leads ── */
const wr = C.winRates(LEADS);
eq('too little history -> no rate', wr.rate, null);
ok('...and says so', /need 5/.test(wr.why));
ok('...and is not confident', wr.confident === false);
const many = [];
for (let i = 0; i < 8; i++) many.push({ stage: i < 2 ? 'won' : 'lost' });
const wr2 = C.winRates(many);
eq('with enough history a real rate appears', wr2.rate, 0.25);
ok('...and is confident', wr2.confident === true);
eq('closed count', wr2.closed, 8);

/* ── 5. CONSENT (DPDP Act 2023) — the gate ── */
eq('no basis -> no contact', C.mayContact({ consent_basis: 'none' }, 'whatsapp').ok, false);
ok('...and says what to do', /record how you got this contact/i.test(C.mayContact({}, 'whatsapp').why));
eq('a missing contact object is not a licence', C.mayContact(null, 'whatsapp').ok, false);
eq('unknown basis is refused, not waved through', C.mayContact({ consent_basis: 'vibes' }, 'email').ok, false);

/* THE ONE THAT MATTERS: a bought list is not consent to WhatsApp */
const bought = { consent_basis: 'purchased' };
eq('bought contact: cold WhatsApp REFUSED', C.mayContact(bought, 'whatsapp').ok, false);
ok('...and gives both reasons — lawful basis AND the ban', /lawful basis/i.test(C.mayContact(bought, 'whatsapp').why) && /banned/i.test(C.mayContact(bought, 'whatsapp').why));
eq('bought contact: cold EMAIL allowed', C.mayContact(bought, 'email').ok, true);
ok('...with an unsubscribe', /unsubscribe/i.test(C.mayContact(bought, 'email').why));
eq('bought contact: a phone call is fine', C.mayContact(bought, 'phone').ok, true);

eq('inbound (they messaged us) -> contact freely', C.mayContact({ consent_basis: 'inbound' }, 'whatsapp').ok, true);
eq('explicit consent -> ok', C.mayContact({ consent_basis: 'consent' }, 'whatsapp').ok, true);
eq('existing customer (contract) -> ok', C.mayContact({ consent_basis: 'contract' }, 'whatsapp').ok, true);

/* an opt-out beats EVERYTHING, on EVERY channel, forever */
['whatsapp', 'email', 'phone'].forEach(ch => {
  eq('opted out beats consent on ' + ch, C.mayContact({ consent_basis: 'consent', opted_out_at: '2026-01-01' }, ch).ok, false);
  eq('opted out beats contract on ' + ch, C.mayContact({ consent_basis: 'contract', opted_out_at: '2026-01-01' }, ch).ok, false);
});
ok('opt-out reason is unambiguous', /never contact again/i.test(C.mayContact({ opted_out_at: '2026-01-01' }, 'email').why));
eq('camelCase optedOutAt is honoured too', C.mayContact({ consentBasis: 'consent', optedOutAt: '2026-01-01' }, 'email').ok, false);

/* ── 6. DE-DUPE: two rows for one company = two prices to one buyer ── */
const EXISTING = [
  { id: 1, name: 'SHREE CEMENT LIMITED', gstin: '08AABCS5768D1Z1' },
  { id: 2, name: 'Magicrete AAC Blocks Pvt Ltd', gstin: '' },
];
const dG = C.dupeOf({ name: 'Totally Different Name', gstin: '08AABCS5768D1Z1' }, EXISTING);
ok('same GSTIN is a CERTAIN duplicate whatever the name says', dG.dupe && dG.certain && dG.on === 'gstin');
const dN = C.dupeOf({ name: 'M/s Magicrete AAC Blocks Private Limited', gstin: '' }, EXISTING);
ok('name match survives Pvt/Ltd/M-s noise', dN.dupe && dN.on === 'name');
ok('...but a name match is NOT certain', dN.certain === false);
const dNo = C.dupeOf({ name: 'Brand New Buyer', gstin: '08NEWNW1234N1Z9' }, EXISTING);
ok('a genuinely new company is not a duplicate', dNo.dupe === false);
eq('normName strips the legal-form noise', C.normName('M/s Shree Cement Pvt. Ltd.'), 'SHREE CEMENT');
ok('an empty candidate does not match everything', C.dupeOf({}, EXISTING).dupe === false);
ok('empty gstins do not match each other', C.dupeOf({ name: 'Someone Else', gstin: '' }, EXISTING).dupe === false);

/* ── 7. NEXT ACTIONS: overdue first ── */
const NA = [
  { id: 1, stage: 'quoted', next_action_at: '2026-07-10', tonnes: 10, price_per_tonne: 12000 },
  { id: 2, stage: 'new', next_action_at: '2026-07-15', tonnes: 50, price_per_tonne: 12000 },
  { id: 3, stage: 'quoted', next_action_at: '2026-07-20' },            // future
  { id: 4, stage: 'won', next_action_at: '2026-07-01' },               // closed
];
const na = C.nextActions(NA, '2026-07-15');
eq('only open leads due today or earlier', na.length, 2);
eq('most overdue first', na[0].lead.id, 1);
ok('overdue is flagged', na[0].overdue === true);
ok('due today is not overdue', na[1].overdue === false);
ok('a future action is not on the list', !na.find(x => x.lead.id === 3));
ok('a won lead never appears', !na.find(x => x.lead.id === 4));

console.log('\n════ CRM spine (pipeline + consent) ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' CRM TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
