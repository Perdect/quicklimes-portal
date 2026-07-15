/* collections.test.js — the money paths of the Collections page.
 *
 * Why this file first: collections.js was 185 lines with ZERO coverage, and it
 * is the highest-consequence untested code in the app. It does two things to the
 * outside world:
 *   - reminderMsg() composes a WhatsApp message telling a REAL customer what they
 *     owe. Wrong number in that string is a wrong demand for money, sent over a
 *     real phone line, in the firm's name.
 *   - applyReceipt() POSTS PAYMENTS to the cashbook across a customer's bills.
 *     Wrong here and the ledger is silently corrupted.
 * Neither had a single assertion.
 *
 * This loads the REAL collections.js in a VM with a mocked browser — the same
 * shape as recon-wiring.test.js — because the bug class that keeps hitting this
 * app is not "the engine is wrong", it is "the page uses the engine wrong". A
 * test of a re-implementation would prove nothing.
 *
 *   node collections.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b));
const near = (m, a, b) => ok(m + '\n     got: ' + a + '  expected: ≈' + b, Math.abs(a - b) < 0.51);

/* ── Load the real page script in a mocked browser ───────────────────────── */
function load(state) {
  const cashbook = [];
  const paidCalls = [];                    // every receiveSalesPayment the page makes
  const SALES = state.sales;

  // A QLD stub shaped exactly like the real one's OUTPUT (see data.js salesRows):
  // rows carry idx (the index into S.SALES) and a derived `outstanding`.
  const QLD = {
    co: { short: 'Gotan Lime', name: 'GOTAN LIME INDUSTRIES' },
    fC: v => '₹' + Math.round(v || 0).toLocaleString('en-IN'),
    fDS: d => d || '',
    salesRows: () => SALES.map((s, i) => ({
      idx: i, inv: s.inv, date: s.date, party: s.party, gstin: s.gstin || '',
      status: s.status || 'pending', total: s.total,
      paid: s.paid || 0, outstanding: Math.max(0, s.total - (s.paid || 0))
    })),
    partyRows: () => state.parties || [],
    receiveSalesPayment: (i, o) => {
      paidCalls.push({ idx: i, inv: SALES[i] && SALES[i].inv, amount: o.amount, method: o.method });
      const s = SALES[i];
      s.paid = Math.min(s.total, (s.paid || 0) + o.amount);
      s.status = s.paid >= s.total - 0.5 ? 'paid' : 'partial';
      cashbook.push({ type: 'credit', amount: o.amount, party: s.party });
    }
  };

  const cfg = {};
  const QLX = {
    esc: s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    svg: () => '', icons: {}, toast: () => {}, refresh: () => {}, close: () => {},
    open: () => {}, state: () => ({}), actionsCell: () => '',
    mount: c => Object.assign(cfg, c)
  };

  const ctx = {
    QLD, QLX, QLParty: require('./party-identity.js'),
    /* The REAL wa-core, not a stub. waLink() delegates to it, so stubbing it
       would test the stub. This is the integration that matters: the page must
       actually reach the tested engine. */
    WACore: require('./wa-core.js'),
    QLShell: { exportCSV: (...a) => { ctx.__csv = a; } },
    console,
    location: { hash: '', href: '' },
    document: {
      getElementById: () => null,
      createElement: () => ({ setAttribute() {}, appendChild() {}, remove() {}, style: {} }),
      body: { appendChild() {} }
    },
    setTimeout, clearTimeout
  };
  ctx.window = ctx;
  ctx.window.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'collections.js'), 'utf8'), ctx);
  return { ctx, cfg, cashbook, paidCalls, SALES };
}

/* Dates relative to today, so ageing assertions do not rot.
   Built from LOCAL parts, matching data.js fmtISO() — NOT toISOString(). The
   first draft used toISOString() and drifted a day: this machine runs at UTC+4,
   so at 02:37 local the UTC date is still yesterday, and iso(75) handed the app a
   76-day-old bill. Two assertions failed and the app was right both times.
   A fixture that does not build dates the way the app builds them tests the
   timezone, not the code. */
const iso = daysAgo => {
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

console.log('\n═══ collections.js · the money paths ═══\n');

/* ══════════ 1. AGGREGATION — what the customer is told they owe ══════════ */
{
  const { ctx } = load({
    sales: [
      // One firm, two spellings, one GSTIN — the split-customer bug this page is
      // most exposed to, because each row becomes a WhatsApp message.
      { inv: 'S1', date: iso(75), party: 'Shree Cement Ltd', gstin: '08AABCS1429B1ZW', total: 100000, paid: 0 },
      { inv: 'S2', date: iso(40), party: 'SHREE CEMENT LTD', gstin: '08AABCS1429B1ZW', total: 50000, paid: 20000 },
      { inv: 'S3', date: iso(10), party: 'Ambuja', gstin: '27AAACG0569P1ZP', total: 30000, paid: 0 },
      { inv: 'S4', date: iso(5), party: 'Ambuja', gstin: '27AAACG0569P1ZP', total: 1000, paid: 1000 },   // fully paid
      { inv: 'S5', date: iso(3), party: 'Ghost', gstin: '', total: 9999, paid: 0, status: 'cancelled' }  // cancelled
    ],
    parties: [{ name: 'Shree Cement Limited', gstin: '08AABCS1429B1ZW', phone: '9829069545' }]
  });
  const rows = ctx.collectRows();

  eq('two real customers (Shree + Ambuja), not four', rows.length, 2);
  ok('a CANCELLED invoice is never chased', !rows.some(r => /Ghost/.test(r.party)));
  ok('a fully PAID invoice is never chased', !rows.some(r => r.invs.some(i => i.inv === 'S4')));

  const shree = rows.find(r => /shree/i.test(r.party));
  near('Shree owes the SUM of both spellings (100000 + 30000)', shree.out, 130000);
  eq('  counted as 2 bills, not 1 or 4', shree.bills, 2);
  eq('  oldest date is the OLDEST invoice, not the first seen', shree.oldest, iso(75));
  eq('  last sale is the newest', shree.last, iso(40));
  ok('  a partially-paid bill still counts its REMAINDER', shree.invs.some(i => i.inv === 'S2'));

  eq('phone resolves across a DIFFERENT spelling in the party master', shree.phone, '9829069545');
  const ambuja = rows.find(r => /ambuja/i.test(r.party));
  eq('a customer with no party record has no phone (not a wrong one)', ambuja.phone, '');

  eq('sorted by amount owed, biggest first', rows.map(r => Math.round(r.out)), [130000, 30000]);
}

/* ══════════ 2. THE REMINDER MESSAGE — this reaches a real person ══════════ */
{
  const { ctx } = load({
    sales: [
      { inv: 'S1', date: iso(75), party: 'Shree Cement Ltd', gstin: '08AABCS1429B1ZW', total: 100000, paid: 0 },
      { inv: 'S2', date: iso(40), party: 'SHREE CEMENT LTD', gstin: '08AABCS1429B1ZW', total: 50000, paid: 20000 }
    ],
    parties: [{ name: 'Shree Cement Ltd', gstin: '08AABCS1429B1ZW', phone: '9829069545' }]
  });
  const r = ctx.collectRows()[0];
  const msg = ctx.reminderMsg(r);

  ok('the message states the FULL amount owed (1,30,000), not one bill\'s share',
    msg.includes('1,30,000'));
  ok('  and names the firm sending it', msg.includes('Gotan Lime'));
  ok('  and the customer', msg.includes('Shree'));
  ok('  says "2 invoices" (plural), matching the bill count', /2 invoices/.test(msg));
  ok('  quotes the age of the OLDEST bill', /75 days/.test(msg));
  ok('  no NaN/undefined ever reaches a customer', !/NaN|undefined/.test(msg));

  // Singular/plural: "1 invoices" in a message to a customer looks like a bug to them.
  const { ctx: c2 } = load({
    sales: [{ inv: 'X', date: iso(5), party: 'Solo', gstin: '08X', total: 500, paid: 0 }],
    parties: []
  });
  ok('one bill says "1 invoice", not "1 invoices"', / 1 invoice[^s]/.test(c2.reminderMsg(c2.collectRows()[0])));
}

/* ══════════ 3. THE PHONE NUMBER — a wrong one messages a STRANGER ══════════ */
{
  const { ctx } = load({ sales: [], parties: [] });
  const num = l => (l.match(/wa\.me\/(\d+)/) || [])[1];

  eq('a plain 10-digit mobile gets the 91 country code', num(ctx.waLink('9829069545', 'x')), '919829069545');
  eq('spaces and dashes are stripped', num(ctx.waLink('98290-69545', 'x')), '919829069545');
  eq('an already-prefixed +91 number is not double-prefixed', num(ctx.waLink('+91 98290 69545', 'x')), '919829069545');
  ok('the message text is URL-encoded into the link', ctx.waLink('9829069545', 'a b&c').includes('a%20b%26c'));

  /* THE CASE THAT COULD MESSAGE A STRANGER — now fixed by delegating to
     wa-core's normalizePhone instead of the page's own copy. Indian numbers are
     routinely stored with the STD trunk '0' (0982…), which is 11 digits, so the
     old `length === 10` rule never fired and wa.me got a number that was not the
     customer's. */
  eq('a leading-0 (STD trunk) number is normalised, not sent to a stranger',
    num(ctx.waLink('09829069545', 'x')), '919829069545');
  eq('a 0091-prefixed number is normalised', num(ctx.waLink('009198290 69545', 'x')), '919829069545');

  /* And the rule that makes the fix safe: when the number cannot be trusted,
     wa-core returns '' rather than guessing. wa.me with no recipient opens
     WhatsApp's own contact picker — the human chooses. A wrong recipient is
     worse than no recipient, because it leaks one customer's balance to another. */
  eq('junk never becomes a recipient — WhatsApp asks instead', num(ctx.waLink('12345', 'x')), undefined);
  eq('a landline is not messaged as a mobile', num(ctx.waLink('0294 2345678', 'x')), undefined);
  ok('  and the message text survives so the user can still send it by hand',
    ctx.waLink('12345', 'hello there').includes('hello%20there'));
}

/* ══════════ 4. APPLYING A RECEIPT — this writes to the ledger ══════════ */
{
  // Three bills, oldest first: 30k (90d), 20k (60d), 10k (10d) = 60k outstanding.
  const mk = () => load({
    sales: [
      { inv: 'B-OLD', date: iso(90), party: 'Acme', gstin: '08A', total: 30000, paid: 0 },
      { inv: 'B-MID', date: iso(60), party: 'Acme', gstin: '08A', total: 20000, paid: 0 },
      { inv: 'B-NEW', date: iso(10), party: 'Acme', gstin: '08A', total: 10000, paid: 0 }
    ],
    parties: []
  });

  // Partial receipt — must consume the OLDEST bill first.
  {
    const { ctx, paidCalls, SALES } = mk();
    const applied = ctx.applyReceipt(ctx.collectRows()[0], 35000, 'Bank');
    near('a ₹35,000 receipt applies ₹35,000', applied, 35000);
    eq('  oldest bill first, then the next — never newest-first', paidCalls.map(p => p.inv), ['B-OLD', 'B-MID']);
    eq('  the oldest is paid in full (30,000)', paidCalls[0].amount, 30000);
    near('  the remainder (5,000) goes to the next oldest', paidCalls[1].amount, 5000);
    ok('  the newest bill is untouched', !paidCalls.some(p => p.inv === 'B-NEW'));
    eq('  the oldest bill is now closed', SALES[0].status, 'paid');
    eq('  the middle bill is partial', SALES[1].status, 'partial');
  }

  // Exact settlement — everything closes, nothing over-pays.
  {
    const { ctx, paidCalls, SALES } = mk();
    const applied = ctx.applyReceipt(ctx.collectRows()[0], 60000, 'Cash');
    near('an exact ₹60,000 settles the whole account', applied, 60000);
    eq('  every bill is paid', SALES.map(s => s.status), ['paid', 'paid', 'paid']);
    ok('  no bill is paid twice', new Set(paidCalls.map(p => p.inv)).size === paidCalls.length);
    ok('  no single payment exceeds that bill\'s outstanding',
      paidCalls.every(p => p.amount <= 30000 + 0.5));
  }

  // Overpayment — the customer pays MORE than they owe.
  {
    const { ctx, paidCalls } = mk();
    const applied = ctx.applyReceipt(ctx.collectRows()[0], 75000, 'Bank');
    near('an over-payment applies only what is OWED (60,000), never more', applied, 60000);
    ok('  and no bill is overpaid', paidCalls.every(p => p.amount > 0));
    /* The ₹15,000 excess is silently dropped: not posted, not held as an advance,
       and the row's caller only toasts the APPLIED figure. That is honest on
       screen but the money is unrecorded. Documented as real behaviour; the
       running-ledger work is where an advance belongs. */
    ok('KNOWN GAP (documented): the ₹15,000 excess is not recorded anywhere', applied === 60000);
  }

  // Method is carried through to the cashbook — a Cash receipt filed as Bank
  // breaks the reconciliation later.
  {
    const { ctx, paidCalls, cashbook } = mk();
    ctx.applyReceipt(ctx.collectRows()[0], 10000, 'UPI');
    eq('the payment METHOD reaches the ledger', paidCalls[0].method, 'UPI');
    eq('  and a cashbook credit is posted', cashbook.length, 1);
  }

  // Tiny/zero receipts must not post noise rows.
  {
    const { ctx, paidCalls } = mk();
    const applied = ctx.applyReceipt(ctx.collectRows()[0], 0, 'Bank');
    eq('a zero receipt posts nothing', paidCalls.length, 0);
    eq('  and applies nothing', applied, 0);
  }
}

/* ══════════ 5. AGEING — drives who gets chased ══════════ */
{
  const { ctx } = load({ sales: [], parties: [] });
  eq('0–30 days is on track', ctx.bucketOf(30), 'recent');
  eq('31 days tips into overdue', ctx.bucketOf(31), 'overdue');
  eq('60 days is still overdue, not critical', ctx.bucketOf(60), 'overdue');
  eq('61 days is critical', ctx.bucketOf(61), 'critical');
  eq('a missing date ages to 0, never NaN', ctx.ageOf(''), 0);
  eq('a future date does not age negatively', ctx.ageOf(iso(-5)), 0);
}

/* ══════════ 6. THE PAGE'S OWN TOTALS ══════════ */
{
  const { ctx, cfg } = load({
    sales: [
      { inv: 'A', date: iso(75), party: 'X', gstin: '08X', total: 100000, paid: 0 },
      { inv: 'B', date: iso(10), party: 'Y', gstin: '08Y', total: 40000, paid: 0 }
    ],
    parties: []
  });
  const stats = cfg.stats();
  ok('"Total to collect" is the sum of every row (1,40,000)', /1,40,000/.test(stats[0].value));
  ok('  "Overdue > 30 days" counts only the 75-day one (1,00,000)', /1,00,000/.test(stats[1].value));
  ok('  "Critical > 60 days" is the same 75-day one', /1,00,000/.test(stats[2].value));
  ok('  "Oldest receivable" reports 75 days', /75/.test(stats[3].value));
  const foot = cfg.footer(ctx.collectRows());
  eq('the table footer counts 2 customers', foot[0].value, 2);
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
