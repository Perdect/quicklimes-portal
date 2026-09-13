/* customer-core.test.js — the Customer 360° contract.

   What must never be quietly wrong here:
     • a quotation whose PDF total differs from its WhatsApp text (one maths)
     • a reorder window predicted from one order (no rhythm = no prediction)
     • a demand figure invented for a customer with no requirement and no orders
     • a health score that punishes a brand-new customer for having no history
     • a segment that overwrites a tag a person set
     • an insight sentence with no number behind it
   Run: node customer-core.test.js */
'use strict';
const C = require('./customer-core.js');
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b));
const TODAY = '2026-09-14';

/* ── 1. vocabularies exist and are complete ── */
eq('12 customer types', C.CUSTOMER_TYPES.length, 12);
eq('5 statuses', C.CUSTOMER_STATUS.map(x => x[0]), ['active', 'new', 'prospect', 'inactive', 'blocked']);
eq('13 pipeline stages, Lost last', C.STAGES.length, 13); eq('  last is lost', C.STAGES[12].key, 'lost');
ok('  completed and lost are closed, the rest open', !C.isOpenStage('completed') && !C.isOpenStage('lost') && C.isOpenStage('payment_pending') && C.isOpenStage('new_lead'));
eq('8 quotation statuses', C.QUOTE_STATUS.length, 8);
eq('7 follow-up types', C.FOLLOWUP_TYPES.length, 7);
eq('6 packaging options', C.PACKAGING.length, 6);
eq('7 payment terms', C.PAYMENT_TERMS.length, 7);
eq('labelOf resolves', C.labelOf(C.PAYMENT_TERMS, '15d'), '15 days');
eq('labelOf falls back to the key', C.labelOf(C.PAYMENT_TERMS, 'zzz'), 'zzz');
ok('12 segments incl. manual tags', Object.keys(C.SEGMENTS).length >= 12 && C.SEGMENTS.price_sensitive.auto === false && C.SEGMENTS.vip.auto === true);

/* ── 2. customer code ── */
eq('first code', C.nextCode([]), 'C-0001');
eq('next after the highest, not the count', C.nextCode([{ code: 'C-0007' }, { code: 'C-0003' }, { code: '' }]), 'C-0008');
eq('prefix honoured', C.nextCode([{ code: 'DM-C-0012' }], 'DM-C-'), 'DM-C-0013');

/* ── 3. quotation maths ── */
{
  const q = { items: [{ product: 'Quick Lime', qty: 42, rate: 4900, discount: 0 }], freight: 12600, loading: 2100, other: 0, gstR: 5 };
  const t = C.quoteTotals(q);
  eq('goods = qty × rate', t.goods, 205800);
  eq('taxable includes freight and loading', t.taxable, 205800 + 12600 + 2100);
  eq('GST 5% on the taxable', t.gst, 11025);
  eq('total', t.total, 231525);
  eq('tonnes', t.tonnes, 42);
  eq('line discount is subtracted', C.quoteTotals({ items: [{ qty: 10, rate: 5000, discount: 1000 }], gstR: 5 }).goods, 49000);
  eq('discount can never make a line negative', C.quoteTotals({ items: [{ qty: 1, rate: 100, discount: 500 }] }).goods, 0);
  eq('default GST is 5% when unset', C.quoteTotals({ items: [{ qty: 1, rate: 100 }] }).gstR, 5);
  eq('export is zero-rated', C.quoteTotals({ items: [{ qty: 1, rate: 100 }], gstR: 5, isExport: true }).gst, 0);
  eq('empty quotation totals zero, not NaN', C.quoteTotals({}).total, 0);
}
/* validity: expired only when undecided */
eq('sent + past validity = expired', C.effectiveQuoteStatus({ status: 'sent', validUntil: '2026-09-01' }, TODAY), 'expired');
eq('accepted stays accepted after validity', C.effectiveQuoteStatus({ status: 'accepted', validUntil: '2026-09-01' }, TODAY), 'accepted');
eq('valid today is still valid', C.effectiveQuoteStatus({ status: 'sent', validUntil: TODAY }, TODAY), 'sent');
ok('open = draft/sent/viewed/negotiation', C.isOpenQuote({ status: 'negotiation', validUntil: '2026-12-01' }, TODAY) && !C.isOpenQuote({ status: 'rejected' }, TODAY));

/* ── 4. requirement → monthly demand ── */
eq('monthly counts as-is', C.monthlyOf({ qty: 100, freq: 'monthly' }), 100);
eq('weekly × 4.33', C.monthlyOf({ qty: 10, freq: 'weekly' }), 43.3);
eq('one-time is not a rhythm', C.monthlyOf({ qty: 500, freq: 'one-time' }), 0);
eq('closed requirement contributes nothing', C.monthlyOf({ qty: 100, freq: 'monthly', status: 'closed' }), 0);

/* ── 5. purchase rhythm — no prediction from one order ── */
{
  eq('no orders → none', C.rhythm([], TODAY).status, 'none');
  eq('one order → insufficient, no next date', C.rhythm([{ date: '2026-09-01' }], TODAY).next, null);
  const r = C.rhythm([{ date: '2026-07-01' }, { date: '2026-07-16' }, { date: '2026-07-31' }, { date: '2026-08-14' }, { date: '2026-08-30' }], TODAY);
  eq('median gap 15 days', r.gapDays, 15);
  eq('next = last + gap', r.next, '2026-09-14');
  eq('15 days since last, gap 15 → due (≥ 80%)', r.status, 'due');
  const late = C.rhythm([{ date: '2026-06-01' }, { date: '2026-06-15' }, { date: '2026-06-29' }], TODAY);
  eq('77 days since a 14-day rhythm → overdue', late.status, 'overdue');
  const same = C.rhythm([{ date: '2026-08-01' }, { date: '2026-08-01' }, { date: '2026-08-11' }], TODAY);
  eq('two invoices on one day are one order for cadence', same.orders, 2);
}

/* ── 6. demand intelligence per product ── */
{
  const sales = [
    { date: '2026-07-01', product: 'Quick Lime', qty: 40, rate: 4800, total: 201600 },
    { date: '2026-07-16', product: 'Quick Lime', qty: 44, rate: 4850, total: 224070 },
    { date: '2026-08-01', product: 'Quick Lime', qty: 42, rate: 4900, total: 216090 },
    { date: '2026-08-05', product: 'Hydrated Lime', qty: 20, rate: 6200, total: 130200 }
  ];
  const reqs = [{ product: 'Quick Lime', qty: 250, freq: 'monthly', targetRate: 4900, updatedAt: '2026-09-01' }, { product: 'Hydrated Lime', qty: 100, freq: 'monthly' }];
  const d = C.demandByProduct(sales, reqs, TODAY);
  eq('QL monthly demand from requirement', d['Quick Lime'].monthlyDemand, 250);
  eq('  source is the requirement', d['Quick Lime'].demandSource, 'requirement');
  eq('  average order', d['Quick Lime'].avgOrderQty, 42);
  eq('  last order qty', d['Quick Lime'].lastQty, 42);
  eq('  target rate', d['Quick Lime'].targetRate, 4900);
  eq('  frequency: median of the gaps (15, 16) rounded', d['Quick Lime'].frequency, 16);
  eq('  monthly potential = demand × target', d['Quick Lime'].monthlyPotential, 250 * 4900);
  eq('HL monthly demand', d['Hydrated Lime'].monthlyDemand, 100);
  eq('  HL potential uses last sold rate when no target', d['Hydrated Lime'].monthlyPotential, 100 * 6200);
  /* no requirement: observed rhythm becomes the demand, labelled */
  const o = C.demandByProduct(sales.slice(0, 3), [], TODAY)['Quick Lime'];
  eq('observed demand = avg × 30/gap', o.monthlyDemand, Math.round(42 * 30 / 16 * 10) / 10);
  eq('  labelled observed', o.demandSource, 'observed');
  /* nothing at all: nothing invented */
  const n = C.demandByProduct([{ date: '2026-08-01', product: 'Quick Lime', qty: 10, rate: 5000 }], [], TODAY)['Quick Lime'];
  eq('one order, no requirement → demand 0, source none', n.monthlyDemand + '|' + n.demandSource, '0|none');
  eq('  and no potential', n.monthlyPotential, null);
}

/* ── 7. price history ── */
{
  const sales = [{ idx: 1, inv: '41', date: '2026-09-05', product: 'Quick Lime', qty: 30, rate: 5000 }, { idx: 2, inv: '30', date: '2026-08-10', product: 'Quick Lime', qty: 50, rate: 4850 }];
  const quotes = [{ id: 'q1', no: 'QT-1024', date: '2026-09-14', status: 'sent', items: [{ product: 'Quick Lime', qty: 42, rate: 4900 }] }];
  const offers = [{ id: 'o1', no: 'PO-3', date: '2026-08-22', product: 'Quick Lime', qty: 50, rate: 4850, status: 'sent' }];
  const h = C.priceHistory(sales, quotes, offers, 'Quick Lime');
  eq('rows newest first', h.rows.map(r => r.status), ['quoted', 'sold', 'offered', 'sold']);
  eq('current = latest sold', h.stats.current, 5000);
  eq('last = the sold one before', h.stats.last, 4850);
  eq('avg of sold', h.stats.avg, 4925);
  eq('lowest / highest', [h.stats.lowest, h.stats.highest], [4850, 5000]);
  eq('last offered = newest quote/offer rate', h.stats.lastOffered, 4900);
  eq('series is sold rates in date order', h.series.map(s => s.rate), [4850, 5000]);
  eq('other product filtered out', C.priceHistory(sales, quotes, offers, 'Hydrated Lime').rows.length, 0);
  eq('no history → nulls, never zeros', C.priceHistory([], [], [], 'Quick Lime').stats.current, null);
}

/* ── 8. health score ── */
{
  const base = { salesN: 0, salesAmt: 0, salesPaid: 0, overdue: 0, ordersLast6m: 0, share: 0, recDays: null, quotesDecided: 0, quotesWon: 0, creditDays: 0, avgPayDays: null };
  const h0 = C.healthScore(base);
  ok('a new customer with no history sits in the middle, not at zero (' + h0.score + ')', h0.score >= 35 && h0.score <= 55);
  const good = Object.assign({}, base, { salesN: 12, salesAmt: 1200000, salesPaid: 1200000, overdue: 0, ordersLast6m: 10, share: 0.3, recDays: 5, quotesDecided: 4, quotesWon: 4, creditDays: 30, avgPayDays: 12 });
  const hg = C.healthScore(good);
  ok('prompt payer, frequent, current → 90+ (' + hg.score + ')', hg.score >= 90);
  const bad = Object.assign({}, base, { salesN: 3, salesAmt: 300000, salesPaid: 100000, overdue: 200000, ordersLast6m: 0, share: 0.02, recDays: 120, quotesDecided: 3, quotesWon: 0, creditDays: 30, avgPayDays: 95 });
  const hb = C.healthScore(bad);
  ok('slow payer, overdue, dormant, loses quotes → below 35 (' + hb.score + ')', hb.score < 35);
  ok('score is bounded 0..100', hg.score <= 100 && hb.score >= 0);
  eq('six ingredients', Object.keys(hg.comp).length, 6);
  ok('ingredients sum to the score', Math.abs(Object.values(hg.comp).reduce((a, b) => a + b, 0) - hg.score) < 1);
}

/* ── 9. enrich — the registers become customer records ── */
{
  const parties = [
    { id: 'p1', name: 'BALAJI BUILDCON', gstin: '08ABCDE1234F1Z5', type: 'customer', creditDays: 15, creditLimit: 500000, code: 'C-0001', segments: ['price_sensitive'] },
    { id: 'p2', name: 'NEW PROSPECT', type: 'customer' },
    { id: 'p3', name: 'SOME SUPPLIER', type: 'supplier' }
  ];
  const sales = [
    { idx: 0, inv: '30', date: '2026-08-10', party: 'BALAJI BUILDCON', gstin: '08ABCDE1234F1Z5', product: 'Quick Lime', qty: 50, rate: 4850, total: 254625, paid: 254625, outstanding: 0, status: 'paid', payments: [{ date: '2026-08-20', amount: 254625 }] },
    { idx: 1, inv: '41', date: '2026-09-05', party: 'Balaji Buildcon', product: 'Quick Lime', qty: 30, rate: 5000, total: 157500, paid: 0, outstanding: 157500, status: 'pending', payments: [] },
    { idx: 2, inv: '42', date: '2026-07-01', party: 'BALAJI BUILDCON', product: 'Quick Lime', qty: 40, rate: 4800, total: 201600, paid: 0, outstanding: 201600, status: 'pending', payments: [] },
    { idx: 3, inv: 'X', date: '2026-09-01', party: 'BALAJI BUILDCON', product: 'Quick Lime', qty: 99, rate: 1, total: 1, paid: 0, outstanding: 1, status: 'cancelled' }
  ];
  const reqs = [{ id: 'r1', cust: 'p1', product: 'Quick Lime', qty: 250, freq: 'monthly', targetRate: 4900 }];
  const quotes = [{ id: 'q1', cust: 'p1', no: 'QT-1', date: '2026-09-10', validUntil: '2026-09-20', status: 'sent', items: [{ product: 'Quick Lime', qty: 42, rate: 4900 }], gstR: 5 },
                  { id: 'q2', cust: 'p1', no: 'QT-0', date: '2026-08-01', validUntil: '2026-08-10', status: 'accepted', items: [{ product: 'Quick Lime', qty: 50, rate: 4850 }] }];
  const followups = [{ id: 'f1', cust: 'p1', date: '2026-09-13', status: 'open', type: 'call' }, { id: 'f2', cust: 'p1', date: '2026-09-20', status: 'open' }, { id: 'f3', cust: 'p1', date: '2026-09-01', status: 'done', doneAt: '2026-09-02T10:00:00' }];
  const timeline = [{ id: 't1', cust: 'p1', kind: 'price_request', at: '2026-09-03T10:00:00' }, { id: 't2', cust: 'p1', kind: 'price_request', at: '2026-09-08T10:00:00' }];
  const rows = C.enrich({ parties, sales, reqs, quotes, followups, timeline, today: TODAY });
  eq('suppliers are excluded', rows.map(r => r.id), ['p1', 'p2']);
  const b = rows[0];
  eq('sales matched by GSTIN and by name (case-insensitive), cancelled ignored', b.salesN, 3);
  eq('total sales', b.salesAmt, 254625 + 157500 + 201600);
  eq('outstanding', b.salesDue, 157500 + 201600);
  eq('overdue = past the customer\'s own 15-day terms (inv 42 only)', b.overdue, 201600);
  eq('avg payment days from the one payment', b.avgPayDays, 10);
  eq('last order', b.salesLast, '2026-09-05');
  eq('monthly demand from requirement', b.monthlyDemand, 250);
  eq('monthly potential', b.monthlyPotential, 250 * 4900);
  eq('open quotations', b.openQuotes, 1);
  eq('open quotation value incl. GST', b.openQuoteValue, Math.round(42 * 4900 * 1.05));
  eq('decided / won', [b.quotesDecided, b.quotesWon, b.conversion], [1, 1, 100]);
  eq('due follow-ups (yesterday counts)', b.dueFollowups, 1);
  eq('open follow-ups', b.openFollowups, 2);
  eq('next follow-up', b.nextFollowup, '2026-09-13');
  eq('price requests in the last 60 days', b.timelineKinds.price_request, 2);
  eq('manual tag kept', b.tags, ['price_sensitive']);
  eq('current balance = billed − paid', b.currentBalance, 157500 + 201600);
  eq('available credit', b.availableCredit, 500000 - 359100);
  ok('health is a number', typeof b.health === 'number' && b.health >= 0 && b.health <= 100);
  eq('reliability sentence', b.reliability, 'pays on time');
  eq('effective status when unset: active (3 orders, recent)', b.statusEff, 'active');
  const p = rows[1];
  eq('prospect: no sales', [p.salesN, p.seg, p.statusEff], [0, 'prospect', 'prospect']);
  eq('prospect demand is nothing, not a guess', [p.monthlyDemand, p.monthlyPotential], [0, 0]);
  ok('prospect health sits mid, never punished (' + p.health + ')', p.health >= 35 && p.health <= 60);
  /* explicit status wins over the derived one */
  const rows2 = C.enrich({ parties: [{ id: 'p9', name: 'X', cstatus: 'blocked' }], sales: [], today: TODAY });
  eq('owner-set status wins', rows2[0].statusEff, 'blocked');
}

/* ── 10. segments ── */
{
  const f = (o) => Object.assign({ salesN: 5, lifetimeN: 5, salesAmt: 100000, overdue: 0, health: 80, salesRec: 10, creditLimit: 0, currentBalance: 0, monthlyPotential: 0, openQuotes: 0 }, o);
  eq('over the credit limit → credit_risk', C.autoSegment(f({ creditLimit: 100, currentBalance: 500 })), 'credit_risk');
  eq('overdue share high and unhealthy → at_risk', C.autoSegment(f({ overdue: 20000, health: 50 })), 'at_risk');
  eq('90+ days quiet → inactive', C.autoSegment(f({ salesRec: 120 })), 'inactive');
  eq('top 20% by revenue and healthy → vip', C.autoSegment(f({ salesAmt: 900000 }), { top20cut: 800000, avgSales: 100000 }), 'vip');
  eq('2× average → high_value', C.autoSegment(f({ salesAmt: 300000 }), { top20cut: 800000, avgSales: 100000 }), 'high_value');
  eq('one order, recent → new', C.autoSegment(f({ salesN: 1, lifetimeN: 1, salesRec: 20 }), { top20cut: 800000, avgSales: 100000 }), 'new');
  eq('nothing bought, open quote → high_potential', C.autoSegment(f({ salesN: 0, lifetimeN: 0, openQuotes: 1 })), 'high_potential');
  eq('nothing bought, nothing pending → prospect', C.autoSegment(f({ salesN: 0, lifetimeN: 0 })), 'prospect');
  eq('otherwise regular', C.autoSegment(f({}), { top20cut: 800000, avgSales: 100000 }), 'regular');
}

/* ── 11. timeline merge ── */
{
  const f = { creditDays: 15, invoices: [
    { idx: 1, inv: '41', date: '2026-08-01', product: 'Quick Lime', qty: 42, rate: 4900, total: 216090, paid: 100000, outstanding: 116090, payments: [{ date: '2026-08-10', amount: 100000, mode: 'Bank' }] }
  ] };
  const ex = [{ id: 'e1', cust: 'p1', kind: 'quote_sent', at: '2026-09-14T11:00:00', title: 'Quotation #QT-1024 sent', detail: 'Quick Lime – 42 MT · ₹4,900 / MT' }, { id: 'e2', kind: 'requirement', at: '2026-09-12T09:00:00' }];
  const tl = C.timeline(f, ex, TODAY);
  eq('newest first', tl.map(e => e.kind), ['quote_sent', 'requirement', 'overdue', 'payment', 'invoice']);
  eq('untitled explicit event gets the kind label', tl[1].title, 'Requirement added');
  eq('invoice event carries the amount', tl[4].amount, 216090);
  eq('payment event', [tl[3].amount, tl[3].detail], [100000, 'against #41 · Bank']);
  ok('overdue event says how far past terms', /29 days past 15-day terms/.test(tl[2].detail));
  eq('filter by kind', C.filterTimeline(tl, { kind: 'payment' }).length, 1);
  eq('search matches detail', C.filterTimeline(tl, { q: '4,900' }).length, 1);
  eq('no overdue when within terms', C.timeline({ creditDays: 60, invoices: f.invoices }, [], TODAY).filter(e => e.kind === 'overdue').length, 0);
}

/* ── 12. insights — every sentence has a number behind it ── */
{
  const f = { name: 'Balaji Buildcon', salesN: 5, salesRec: 14, rhythm: { orders: 5, gapDays: 15, gapLo: 14, gapHi: 18, sinceLast: 14, status: 'due', next: '2026-09-15' }, timelineKinds: { price_request: 3 }, monthlyDemand: 150, monthlyPotential: 735000, overdue: 0, amt30: 0, amtPrev30: 0, creditLimit: 0, currentBalance: 0, openQuotes: 1, openQuoteValue: 231525, dueFollowups: 0, recDays: 3, demand: { 'Quick Lime': {} }, creditDays: 30 };
  const ins = C.customerInsights(f, TODAY);
  ok('reorder window sentence', ins.some(i => /normally orders every 14–18 days/.test(i.t)));
  ok('price asks sentence', ins.some(i => /lower price 3 times/.test(i.t)));
  ok('monthly potential sentence', ins.some(i => /approximately 150 MT/.test(i.t)));
  ok('open quotation sentence', ins.some(i => /1 open quotation/.test(i.t)));
  ok('a recommendation is made, and it is the first actionable one (offer)', ins.some(i => i.rec === 'offer'));
  const quiet = C.customerInsights({ name: 'X', salesN: 2, salesRec: 35, rhythm: { orders: 2 }, overdue: 0, recDays: 35, timelineKinds: {}, demand: {} }, TODAY);
  ok('35 days without an order is said plainly', quiet.some(i => /No order for 35 days/.test(i.t)));
  eq('nothing to say about an empty customer', C.customerInsights({ name: 'X', salesN: 0, rhythm: { orders: 0 }, timelineKinds: {}, demand: {}, recDays: null }, TODAY).length, 0);
  ok('outstanding increasing → declining sentence only when the numbers say so', C.customerInsights({ name: 'X', salesN: 3, salesRec: 5, rhythm: {}, timelineKinds: {}, demand: {}, amt30: 10000, amtPrev30: 50000, recDays: 5 }, TODAY).some(i => /declining/.test(i.t)));
}
{
  const rows = [
    { id: 'a', name: 'A', salesN: 5, salesAmt: 900000, share: 0.6, monthlyPotential: 0, monthlyDemand: 0, rhythm: { status: 'due', orders: 4 }, amt30: 0, amtPrev30: 0, overdue: 0, dueFollowups: 0, recDays: 2, statusEff: 'active', tags: [], timelineKinds: {} },
    { id: 'b', name: 'B', salesN: 2, salesAmt: 100000, share: 0.1, monthlyPotential: 500000, monthlyDemand: 100, rhythm: { status: 'ok', orders: 2 }, amt30: 1000, amtPrev30: 9000, overdue: 50000, dueFollowups: 1, recDays: 45, statusEff: 'active', tags: ['price_sensitive'], timelineKinds: {} }
  ];
  const pi = C.portfolioInsights(rows, TODAY);
  const keys = pi.map(i => i.key);
  eq('portfolio insight set', keys, ['top', 'potential', 'reorder', 'declining', 'overdue', 'followup', 'quiet', 'price', 'demand']);
  eq('top customer is A', pi[0].ids, ['a']);
  eq('overdue names B', pi.find(i => i.key === 'overdue').ids, ['b']);
}

/* ── 13. templates ── */
{
  eq('variables substituted', C.fillTemplate('Hi {{customer_name}}, ₹{{rate}}/MT', { customer_name: 'Balaji', rate: '4,900' }), 'Hi Balaji, ₹4,900/MT');
  eq('unknown variable → blank, never left as braces', C.fillTemplate('{{nope}}x', {}), 'x');
  const vars = C.templateVars({ customer: { name: 'Balaji Buildcon', city: 'Jodhpur', payTerms: '15d' }, offer: { product: 'Quick Lime', qty: 42, rate: 4900, freight: 'extra', validUntil: '2026-09-17', delivery: 'Within 2-3 days', payment: 'against_delivery' }, company: { short: 'Deshwali Minerals' } });
  eq('offer vars', [vars.product, vars.rate, vars.quantity, vars.freight, vars.payment_terms, vars.location, vars.company], ['Quick Lime', '4,900', 42, 'Freight extra', 'Against delivery', 'Jodhpur', 'Deshwali Minerals']);
  const body = C.fillTemplate(C.DEFAULT_TEMPLATES[0].body, vars);
  ok('the default offer template renders every line', /Quick Lime at ₹4,900\/MT for 42 MT/.test(body) && /Payment Terms: Against delivery/.test(body) && /valid until: 2026-09-17/.test(body) && /Deshwali Minerals/.test(body));
  ok('quote vars include the total', C.templateVars({ customer: {}, quote: { no: 'QT-1', items: [{ product: 'Quick Lime', qty: 10, rate: 5000 }], gstR: 5 } }).total === '52,500');
  eq('5 default templates', C.DEFAULT_TEMPLATES.length, 5);
}

/* ── 14. pipeline ── */
{
  eq('deal value = qty × target when no value', C.dealValue({ qty: 42, targetRate: 4900 }), 205800);
  eq('explicit value wins', C.dealValue({ qty: 42, targetRate: 4900, value: 200000 }), 200000);
  eq('no price → unknown', C.dealValue({ qty: 42 }), null);
  const s = C.pipelineSummary([{ stage: 'quote_sent', qty: 10, targetRate: 5000 }, { stage: 'negotiation', qty: 10 }, { stage: 'completed', value: 99 }, { stage: 'lost', value: 5 }]);
  eq('open / gross / weighted / unvalued / won / lost', [s.open, s.gross, s.weighted, s.unvalued, s.won, s.lost], [2, 50000, 17500, 1, 1, 1]);
}

/* ── 15. follow-up buckets ── */
{
  const b = C.followupBuckets([{ date: '2026-09-13', status: 'open' }, { date: '2026-09-14', status: 'open', time: '11:00' }, { date: '2026-09-14', status: 'open', time: '09:00' }, { date: '2026-09-20', status: 'open' }, { date: '2026-09-01', status: 'done' }], TODAY);
  eq('overdue / today / upcoming', [b.overdue.length, b.today.length, b.upcoming.length], [1, 2, 1]);
  eq('today sorted by time', b.today.map(f => f.time), ['09:00', '11:00']);
}

console.log('\n═══ customer-core ═══');
fails.forEach(f => console.log('  ❌ ' + f));
console.log((fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
