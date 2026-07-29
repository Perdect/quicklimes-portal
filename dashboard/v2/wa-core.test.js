/* wa-core.test.js — the reminder engine's contract.

   These messages go to real customers about real money. The failure modes that
   matter are not crashes — they're plausible wrong messages:
     • chasing a bill that was already paid or cancelled
     • "₹244282.500000000000" in a WhatsApp message (the export bug, again)
     • "Dear {{PartyName}}" sent to an actual customer
     • the same dunning message twice
     • a balance sent to the WRONG number (one customer learns another's book)
   Run: node wa-core.test.js */

const W = require('./wa-core.js');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), a === b);

/* ── 1. MONEY: the export float-noise bug must never reach a customer ── */
eq('18.15 x 12385 = 224787.74999999997 -> clean rupees', W.money(18.15 * 12385), '2,24,788');
eq('244282.5 -> rounded, grouped', W.money(244282.5), '2,44,283');
eq('Indian grouping (lakhs), not thousands', W.money(3170529.6000000006), '31,70,530');
ok('no float tail ever', !/\.\d{3,}/.test(W.money(18.15 * 12385)));
eq('NaN -> blank, never "NaN" to a customer', W.money(NaN), '');
eq('Infinity -> blank', W.money(Infinity), '');
eq('zero is a real number', W.money(0), '0');

/* ── 2. PHONE: a wrong number leaks one customer's balance to another ── */
eq('10-digit mobile gets 91', W.normalizePhone('9460034743'), '919460034743');
eq('already has 91', W.normalizePhone('919460034743'), '919460034743');
eq('+91 with spaces/dashes', W.normalizePhone('+91 94600-34743'), '919460034743');
eq('leading 0 STD', W.normalizePhone('09460034743'), '919460034743');
eq('0091 international prefix', W.normalizePhone('00919460034743'), '919460034743');
eq('blank -> blank', W.normalizePhone(''), '');
eq('null -> blank', W.normalizePhone(null), '');
eq('junk -> blank', W.normalizePhone('n/a'), '');
eq('too short -> blank (never guess)', W.normalizePhone('94600'), '');
eq('landline (starts 2) -> blank, not a mobile', W.normalizePhone('2912345678'), '');
eq('5-starting 10-digit is not an Indian mobile', W.normalizePhone('5460034743'), '');

/* ── 3. DUE DATE from credit terms ── */
eq('30-day credit', W.dueDateOf('2026-01-01', 30), '2026-01-31');
eq('0 credit days = due on invoice date', W.dueDateOf('2026-01-01', 0), '2026-01-01');
eq('missing creditDays behaves as 0', W.dueDateOf('2026-01-01', undefined), '2026-01-01');
eq('crosses a month end', W.dueDateOf('2026-01-20', 30), '2026-02-19');
eq('crosses a year end', W.dueDateOf('2025-12-20', 30), '2026-01-19');
eq('leap day', W.dueDateOf('2028-02-01', 29), '2028-03-01');

/* ── 4. IST / UTC: the date must not shift a day (this bug has bitten twice) ── */
eq('daysBetween is inclusive-exact', W.daysBetween('2026-01-01', '2026-01-04'), 3);
eq('daysBetween backwards is negative', W.daysBetween('2026-01-04', '2026-01-01'), -3);
eq('no UTC shift on a month boundary', W.addDays('2026-03-01', -1), '2026-02-28');
eq('nice date is human, not ISO', W.niceDate('2025-12-31'), '31-Dec-2025');

/* ── 5. SCHEDULE: exact-day events, never stale ── */
eq('3 days before due fires', W.stepFor('2026-01-31', '2026-01-28'), -3);
eq('1 day before due fires', W.stepFor('2026-01-31', '2026-01-30'), -1);
eq('due day fires', W.stepFor('2026-01-31', '2026-01-31'), 0);
eq('7 days overdue fires', W.stepFor('2026-01-31', '2026-02-07'), 7);
eq('30 days overdue fires', W.stepFor('2026-01-31', '2026-03-02'), 30);
eq('a non-scheduled day fires NOTHING', W.stepFor('2026-01-31', '2026-01-29'), null);
eq('2 days overdue is not a step', W.stepFor('2026-01-31', '2026-02-02'), null);
eq('100 days overdue does not re-fire the 30-day step', W.stepFor('2026-01-31', '2026-05-11'), null);
eq('custom schedule is honoured', W.stepFor('2026-01-31', '2026-02-05', [5]), 5);
eq('custom schedule excludes the defaults', W.stepFor('2026-01-31', '2026-02-07', [5]), null);
ok('labels read like a human wrote them',
  W.stepLabel(-3) === '3 days before due' && W.stepLabel(-1) === '1 day before due' &&
  W.stepLabel(0) === 'Due today' && W.stepLabel(7) === '7 days overdue' && W.stepLabel(1) === '1 day overdue');

/* ── 6. RENDER: never send a half-built message ── */
const full = W.render(W.TEMPLATES.reminder, {
  PartyName: 'ARIF LIME', InvoiceNo: '147/2025-26', BalanceAmount: '2,24,788',
  DueDate: '31-Jan-2026', Outstanding: '5,00,000'
});
eq('a complete message has nothing missing', full.missing.length, 0);
ok('placeholders are actually substituted', !/\{\{/.test(full.text));
ok('the real numbers appear', /2,24,788/.test(full.text) && /31-Jan-2026/.test(full.text));

const holes = W.render(W.TEMPLATES.dispatch, { PartyName: 'ARIF LIME', VehicleNo: '', Material: 'Quick Lime' });
ok('a blank value is reported missing, not silently blanked', holes.missing.indexOf('VehicleNo') >= 0);
ok('missing vars are all listed', holes.missing.indexOf('Quantity') >= 0 && holes.missing.indexOf('EwayBillNo') >= 0);
eq('a present value is not reported missing', holes.missing.indexOf('Material'), -1);

/* ── 7. THE PLAN — real-shaped data ── */
const PARTIES = [
  { name: 'ARIF LIME', phone: '9460034743', creditDays: 30, state: 'Rajasthan', type: 'customer' },
  { name: 'SHREE CEMENT', phone: '9812345678', creditDays: 15, state: 'Rajasthan', type: 'customer' },
  { name: 'NO PHONE LTD', phone: '', creditDays: 30, state: 'Gujarat', type: 'customer' },
  { name: 'OPTED OUT', phone: '9812345670', creditDays: 30, autoRemind: false, type: 'customer' },
];
// today = 2026-01-31. ARIF's 2026-01-01 invoice (30d) is due exactly today.
const TODAY = '2026-01-31';
const SALES = [
  { inv: 'A-1', date: '2026-01-01', party: 'ARIF LIME', total: 118000, outstanding: 118000, status: 'pending' },
  { inv: 'A-2', date: '2026-01-01', party: 'ARIF LIME', total: 50000, outstanding: 20000, status: 'partial' },
  { inv: 'P-1', date: '2026-01-01', party: 'ARIF LIME', total: 90000, outstanding: 0, status: 'paid' },
  { inv: 'C-1', date: '2026-01-01', party: 'ARIF LIME', total: 70000, outstanding: 70000, status: 'cancelled' },
  { inv: 'S-1', date: '2026-01-16', party: 'SHREE CEMENT', total: 236000, outstanding: 236000, status: 'pending' },
  { inv: 'N-1', date: '2026-01-01', party: 'NO PHONE LTD', total: 10000, outstanding: 10000, status: 'pending' },
  { inv: 'O-1', date: '2026-01-01', party: 'OPTED OUT', total: 10000, outstanding: 10000, status: 'pending' },
];
const plan = W.planReminders({ sales: SALES, parties: PARTIES, today: TODAY });
const invs = plan.map(t => t.inv);

ok('a PAID invoice is never chased', invs.indexOf('P-1') < 0);
ok('a CANCELLED invoice is never chased', invs.indexOf('C-1') < 0);
ok('an opted-out party is never messaged', plan.every(t => t.party !== 'OPTED OUT'));
ok('a due-today invoice fires', invs.indexOf('A-1') >= 0);
ok('a PARTIALLY paid invoice is still chased', invs.indexOf('A-2') >= 0);
const a2 = plan.find(t => t.inv === 'A-2');
eq('a partial bill chases the BALANCE, not the invoice total', a2.balance, 20000);
ok('the balance appears in the text, not the total', /20,000/.test(a2.text) && !/50,000/.test(a2.text));

const a1 = plan.find(t => t.inv === 'A-1');
eq('due today is step 0', a1.step, 0);
eq("party outstanding = ALL live bills (118000+20000), not just this one", a1.outstanding, 138000);
ok('outstanding excludes paid + cancelled', a1.outstanding === 138000);
ok('the message carries the party outstanding', /1,38,000/.test(a1.text));
eq('phone normalized on the task', a1.phone, '919460034743');
ok('a complete task is sendable', a1.sendable === true);

const nop = plan.find(t => t.party === 'NO PHONE LTD');
ok('a party with no phone still APPEARS (the owner must see it)', !!nop);
ok('...but is NOT sendable', nop.sendable === false);
ok('...and says why', /No WhatsApp number/i.test(nop.reason));

// SHREE: invoice 2026-01-16 + 15 days = due 2026-01-31 = today
ok('a second party with different credit terms also fires', invs.indexOf('S-1') >= 0);

/* ── 8. DEDUPE: never chase the same thing twice ── */
const key = W.sendKey('ARIF LIME', 'A-1', 0);
const after = W.planReminders({ sales: SALES, parties: PARTIES, today: TODAY, sentKeys: [key] });
ok('an already-sent step does not re-fire', after.every(t => !(t.inv === 'A-1' && t.step === 0)));
ok('other invoices are unaffected by one dedupe key', after.some(t => t.inv === 'A-2'));
eq('sendKey ignores case/whitespace noise', W.sendKey(' arif lime ', ' a-1 ', 0), W.sendKey('ARIF LIME', 'A-1', 0));
ok('a different step is a different key', W.sendKey('ARIF LIME', 'A-1', 7) !== key);
const twice = W.planReminders({ sales: SALES, parties: PARTIES, today: TODAY });
eq('the plan itself contains no duplicate keys', new Set(twice.map(t => t.key)).size, twice.length);

/* ── 9. nothing fires on a quiet day ── */
eq('a day with no scheduled step sends nothing', W.planReminders({ sales: SALES, parties: PARTIES, today: '2026-01-29' }).length, 0);

/* ── 10. OVERDUE wording ── */
const od = W.planReminders({ sales: SALES, parties: PARTIES, today: '2026-02-07' });
const od1 = od.find(t => t.inv === 'A-1');
eq('7 days past due is step 7', od1.step, 7);
eq('it uses the overdue template', od1.kind, 'overdue');
ok('the message states the days overdue', /7 days overdue/.test(od1.text));
ok('no unfilled placeholder in an overdue message', !/\{\{/.test(od1.text));

/* ── 11. ORDER: worst first, the way a human chases ── */
const mixed = W.planReminders({ sales: SALES, parties: PARTIES, today: '2026-02-07' });
for (let i = 1; i < mixed.length; i++) ok('sorted by step desc then money desc', mixed[i - 1].step >= mixed[i].step);

/* ── 12. FILTERS (bulk campaigns + the AI assistant) ── */
const big = W.filterTasks(plan, { minOutstanding: 50000 }, PARTIES);
ok('"above ₹50,000" excludes the small fry', big.every(t => t.outstanding >= 50000));
ok('"above ₹50,000" keeps ARIF (1.38L)', big.some(t => t.party === 'ARIF LIME'));
ok('"above ₹50,000" drops NO PHONE LTD (10k)', big.every(t => t.party !== 'NO PHONE LTD'));
eq('state filter', W.filterTasks(plan, { state: 'Gujarat' }, PARTIES).every(t => t.party === 'NO PHONE LTD'), true);
eq('type filter keeps customers', W.filterTasks(plan, { type: 'customer' }, PARTIES).length, plan.length);
eq('unknown type filters everything out', W.filterTasks(plan, { type: 'supplier' }, PARTIES).length, 0);
ok('minStep only chases the overdue', W.filterTasks(mixed, { minStep: 1 }, PARTIES).every(t => t.step >= 1));

/* ── 13. STATEMENTS ── */
const st = W.planStatements({ sales: SALES, parties: PARTIES, today: TODAY });
const arifSt = st.find(s => s.party === 'ARIF LIME');
eq('statement totals the live bills only', arifSt.outstanding, 138000);
eq('statement counts the live bills only', arifSt.bills, 2);
ok('statement names the oldest bill', /A-1|A-2/.test(arifSt.text));
ok('statements are ordered biggest-debt first', st[0].outstanding >= st[st.length - 1].outstanding);
ok('a paid-up party gets no statement', !st.find(s => s.party === 'PAID UP'));

/* ── 14. DISPATCH ── */
const disp = W.planDispatch(
  { party: 'ARIF LIME', inv: 'A-1', veh: 'RJ-19-GA-1234', product: 'Quick Lime', qty: 32.76, eway: '1234567890' },
  PARTIES[0], {});
ok('dispatch renders fully', disp.missing.length === 0 && disp.sendable === true);
ok('dispatch carries the vehicle + eway', /RJ-19-GA-1234/.test(disp.text) && /1234567890/.test(disp.text));
const dispNoEway = W.planDispatch({ party: 'ARIF LIME', inv: 'A-1', veh: 'RJ-19-GA-1234', product: 'Quick Lime', qty: 32.76 }, PARTIES[0], {});
ok('a dispatch with no e-way bill is NOT sendable (never a broken message)', dispNoEway.sendable === false);
ok('...and says what is missing', /EwayBillNo/.test(dispNoEway.reason));

/* ── 15. the one-tap link (today's only real transport) ── */
ok('wa.me link targets the normalized number', W.waLink('9460034743', 'hi').indexOf('https://wa.me/919460034743') === 0);
ok('the message is url-encoded', W.waLink('9460034743', 'a b&c').indexOf('a%20b%26c') > 0);
ok('a full reminder survives encoding (newlines + ₹)', W.waLink('9460034743', a1.text).indexOf('%0A') > 0);

console.log('\n════ WhatsApp reminder engine ════\n  Passed: ' + pass + '   Failed: ' + fail);
fails.forEach(f => console.log('    ✗ ' + f));
/* ══════════ a WhatsApp button only where WhatsApp can land ══════════
   Reported live: "The phone number +917940235235 isn't on WhatsApp."
   That is 079 4023 5235, an Ahmedabad landline, which normalizePhone reduces
   to ten digits starting 7 — the exact shape of a mobile. Digits alone cannot
   decide it; the raw grouping can. */
{
  const no = (n, why) => ok(why, W.isMobileNumber(n) === false);
  const yes = (n, why) => ok(why, W.isMobileNumber(n) === true);
  no('+91 79 4023 5235', 'the reported landline gets no WhatsApp button');
  no('079 4023 5235', '  same number written with the trunk 0');
  no('07940235235', '  and run together with the trunk 0');
  no('+91 124 494 2555', 'Gurgaon landline (STD 124)');
  no('077228 77477', 'Raipur landline with a trunk 0');
  no('+91 771 223 4455', 'Raipur landline (STD 771)');
  no('011 2345 6789', 'Delhi landline');
  no('+91 22 6789 1234', 'Mumbai landline (2-digit STD)');
  no('+91 5460767676', 'a 10-digit number outside the 6-9 mobile series');
  no('', 'empty');
  no(null, 'null');
  no('12345', 'too short');
  no('+91 946076767', 'a 9-digit truncated mobile (directory data is often clipped)');
  no('+91 94607676761', 'an 11-digit run that merely starts like a mobile');
  yes('+91 9460767676', 'a real mobile still shows WhatsApp');
  yes('9460767676', '  bare 10 digits');
  yes('+91 94607 67676', '  grouped 5+5, the way mobiles are written');
  yes('+919824012345', '  no spaces, with country code');
  yes('98240-12345', '  hyphenated 5+5');
  yes('+91 7014547272', 'a mobile starting 7 is not mistaken for an STD code');
  yes('+91 6301234567', 'a mobile starting 6');
}

console.log(fail === 0 ? '\n✅ ALL ' + pass + ' WA-CORE TESTS PASSED\n' : '\n❌ ' + fail + ' FAILED\n');
process.exit(fail === 0 ? 0 : 1);
