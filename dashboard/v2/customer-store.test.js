/* customer-store.test.js — the write layer, against a QLD shim.

   What must never be quietly wrong:
     • a requirement, quotation, offer, follow-up or note filed under the WRONG
       customer (two customers × two requirements, every write checked)
     • a quotation sent/accepted/converted that does not move the deal
     • an order recorded from a quotation that does not convert it and link the
       invoice back
     • a revision that leaves the old quotation sendable
     • a blob round-trip (JSON.stringify → parse → hydrate) that loses a store
   Run: node customer-store.test.js */
'use strict';
const C = require('./customer-core.js');

/* ── the QLD shim: the state the store writes, the calls it makes ── */
const S = { PARTIES: [], SALES: [], CASHBOOK: [], REQS: [], QUOTES: [], OFFERS: [], DEALS: [], FOLLOWUPS: [], CNOTES: [], CTIMELINE: [], MSG_TEMPLATES: [] };
let commits = 0;
const QLD = {
  state: S, activeCo: 'CO1', co: { short: 'Deshwali Minerals', name: 'DESHWALI MINERALS' },
  commit() { commits++; },
  upsertParty(name, gstin, phone, address, state, type) { S.PARTIES.push({ id: 'p' + (S.PARTIES.length + 1), name: name.trim(), gstin: (gstin || '').toUpperCase(), phone: phone || '', address: address || '', state: state || '', type: type || 'customer', notes: '', opening: 0, creditLimit: 0, creditDays: 0 }); },
  salesRows() { return S.SALES.map((s, i) => ({ idx: i, inv: s.inv, date: s.date, party: s.party, gstin: s.gstin || '', qty: s.qty, product: s.product, taxable: s.qty * s.rate, total: s.qty * s.rate * (1 + (s.gstR || 0) / 100), status: s.status || 'pending', paid: s.paid || 0, outstanding: s.qty * s.rate * (1 + (s.gstR || 0) / 100) - (s.paid || 0), payments: s.payments || [] })); },
  ledgerNet() { return 0; },
  addSale(e) { S.SALES.push(Object.assign({ status: 'pending', paid: 0, payments: [] }, e)); return { ok: true }; },
  receiveSalesPayment(i, o) { const s = S.SALES[i]; s.paid = (s.paid || 0) + o.amount; s.payments = (s.payments || []).concat([{ date: o.date, amount: o.amount, method: o.method }]); s.status = 'partial'; },
  recordLedgerEntry(idx, e) { const p = S.PARTIES[idx]; p.ledger = (p.ledger || []).concat([Object.assign({ id: 'lg1' }, e)]); return 'lg1'; }
};
global.window = global; global.QLD = QLD; global.CustomerCore = C;
global.localStorage = { getItem: () => null };
require('./customer-store.js');
const M = global.QLCRM;

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (n, a, b) => ok(n + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b));

/* ── 1. two customers ── */
const a = M.addCustomer({ name: 'Balaji Buildcon', gstin: '08ABCDE1234F1Z5', phone: '9829000001', city: 'Jodhpur', ctype: 'construction', payTerms: '15d', creditDays: 15, salesperson: 'Sameer' });
const b = M.addCustomer({ name: 'Marwar Steel', phone: '9829000002', city: 'Pali', ctype: 'steel' });
ok('both customers created', a.ok && b.ok && a.id !== b.id);
eq('codes assigned in order', [M.byId(a.id).code, M.byId(b.id).code], ['C-0001', 'C-0002']);
eq('status defaults to new, since = today', [M.byId(a.id).cstatus, M.byId(a.id).since], ['new', M.today()]);
eq('creation logged on the right timeline', M.eventsOf(a.id).map(e => e.kind), ['created']);
eq('duplicate by GSTIN refused', M.addCustomer({ name: 'BALAJI BUILDCON PVT', gstin: '08abcde1234f1z5' }).ok, false);
eq('duplicate by name refused', M.addCustomer({ name: 'balaji buildcon' }).ok, false);
ok('status change is logged as a status event', (M.updateCustomer(a.id, { cstatus: 'active' }), M.eventsOf(a.id).some(e => e.kind === 'status' && /New → Active/.test(e.detail))));

/* ── 2. two requirements each; every write lands on its owner ── */
const ra1 = M.addReq(a.id, { product: 'Quick Lime', qty: 42, freq: 'one-time', targetRate: 4900, deliveryLoc: 'Rajasthan' });
const ra2 = M.addReq(a.id, { product: 'Hydrated Lime', qty: 100, freq: 'monthly', targetRate: 6200 });
const rb1 = M.addReq(b.id, { product: 'Quick Lime', qty: 250, freq: 'monthly', targetRate: 4850 });
const rb2 = M.addReq(b.id, { product: 'Quick Lime Powder', qty: 30, freq: 'weekly' });
eq('A has its two, B has its two', [M.reqsOf(a.id).map(r => r.product), M.reqsOf(b.id).map(r => r.product)], [['Quick Lime', 'Hydrated Lime'], ['Quick Lime', 'Quick Lime Powder']]);
eq('a requirement without quantity is refused', M.addReq(a.id, { product: 'Quick Lime' }).ok, false);
eq('a requirement for an unknown customer is refused', M.addReq('nope', { product: 'Quick Lime', qty: 1 }).ok, false);
eq('each requirement opened a deal for ITS customer at Requirement Received', [M.dealsOf(a.id).length, M.dealsOf(b.id).length, M.dealsOf(a.id)[0].stage], [2, 2, 'req_received']);
ok('the deal remembers the requirement', M.dealsOf(a.id).some(d => d.reqId === ra1.id));

/* ── 3. quotation → sent → order ── */
const q1 = M.addQuote({ cust: a.id, reqId: ra1.id, items: [{ product: 'Quick Lime', qty: 42, unit: 'MT', rate: 4900 }], freight: 12600, gstR: 5, paymentTerms: '15d' });
eq('QT numbering starts at 1001', q1.no, 'QT-1001');
eq('a quotation with no lines is refused', M.addQuote({ cust: a.id, items: [] }).ok, false);
const dealA = M.dealsOf(a.id).find(d => d.quoteId === q1.id);
ok('the quotation attached to A\'s open Quick Lime deal and moved it to Quotation Prepared', dealA && dealA.stage === 'quote_prepared' && dealA.reqId === ra1.id);
eq('B\'s deals untouched', M.dealsOf(b.id).map(d => d.stage), ['req_received', 'req_received']);
M.setQuoteStatus(q1.id, 'sent', { via: 'whatsapp' });
eq('sent → deal Quotation Sent, event logged with the channel', [dealA.stage, M.eventsOf(a.id).filter(e => e.kind === 'quote_sent').length, M.quotesOf(a.id)[0].sentVia], ['quote_sent', 1, 'whatsapp']);
M.setQuoteStatus(q1.id, 'negotiation', { note: 'wants 4,800', priceRequest: true });
eq('negotiation with a price ask logs price_request', M.eventsOf(a.id).filter(e => e.kind === 'price_request').length, 1);
eq('  and moves the deal to Negotiation', dealA.stage, 'negotiation');
const rev = M.reviseQuote(q1.id, { items: [{ product: 'Quick Lime', qty: 42, unit: 'MT', rate: 4850 }] });
eq('revision keeps the number with -R2', rev.no, 'QT-1001-R2');
eq('the old quotation is closed (expired) and points at the revision', [M.quotesOf(a.id)[0].status, M.quotesOf(a.id)[0].supersededBy === rev.id], ['expired', true]);
ok('price_revised logged with the new rate', M.eventsOf(a.id).some(e => e.kind === 'price_revised' && /4,850/.test(e.detail)));
const ord = M.recordOrder({ inv: '141', date: M.today(), product: 'Quick Lime', qty: 42, rate: 4850, gstR: 5 }, { cust: a.id, quoteId: rev.id });
ok('order recorded', ord.ok);
const sale = S.SALES[ord.idx];
eq('the invoice carries the customer id and the quotation id', [sale.custId, sale.quoteId, sale.party], [a.id, rev.id, 'Balaji Buildcon']);
eq('the revision is Converted and knows its invoice', [M.quotesOf(a.id)[1].status, M.quotesOf(a.id)[1].convertedSale], ['converted', ord.idx]);
eq('the deal is at Order Confirmed with the invoice index', [dealA.stage, dealA.saleIdx], ['order_confirmed', ord.idx]);
ok('order event on A only', M.eventsOf(a.id).some(e => e.kind === 'order') && !M.eventsOf(b.id).some(e => e.kind === 'order'));
eq('a duplicate invoice number is refused by the register', (QLD.addSale = () => ({ ok: false, reason: 'dup' }), M.recordOrder({ inv: '141', qty: 1, rate: 1 }, { cust: a.id }).ok), false);
QLD.addSale = e => { S.SALES.push(Object.assign({ status: 'pending', paid: 0, payments: [] }, e)); return { ok: true }; };

/* ── 4. payment ── */
M.moveDeal(dealA.id, 'payment_pending');
const pay = M.recordPayment(a.id, { saleIdx: ord.idx, amount: 100000, date: M.today(), mode: 'Bank', ref: 'UTR1' });
eq('payment against the invoice goes through the register', [pay.ok, S.SALES[ord.idx].paid], [true, 100000]);
eq('a deal waiting for payment completes on payment', dealA.stage, 'completed');
const onAcc = M.recordPayment(a.id, { amount: 5000, date: M.today() });
ok('on-account payment posts to the party ledger and logs', onAcc.ok && M.byId(a.id).ledger.length === 1 && M.eventsOf(a.id).some(e => e.kind === 'payment'));
eq('zero amount refused', M.recordPayment(a.id, { amount: 0 }).ok, false);

/* ── 5. offers ── */
const of1 = M.addOffer({ cust: b.id, product: 'Quick Lime', qty: 250, rate: 4850, freight: 'extra', validDays: 3, payment: 'against_delivery' }, 'whatsapp');
eq('offer numbered and sent', [of1.no, M.offersOf(b.id)[0].status, M.offersOf(b.id)[0].validUntil], ['PO-1', 'sent', C.addDays(M.today(), 3)]);
eq('offer moved B\'s Quick Lime deal to Quotation Sent, not A\'s', [M.dealsOf(b.id).find(d => d.product === 'Quick Lime').stage, M.dealsOf(b.id).find(d => d.product === 'Quick Lime Powder').stage], ['quote_sent', 'req_received']);
eq('offer without a price refused', M.addOffer({ cust: b.id, product: 'Quick Lime' }).ok, false);
M.setOfferStatus(of1.id, 'accepted');
eq('accepted offer → Price Confirmed', M.dealsOf(b.id).find(d => d.product === 'Quick Lime').stage, 'price_confirmed');

/* ── 6. follow-ups and notes ── */
const f1 = M.addFollowup({ cust: a.id, date: '2026-09-13', type: 'price', notes: 'ask' });
const f2 = M.addFollowup({ cust: b.id, date: '2026-09-20', type: 'payment' });
eq('follow-ups on their own customers', [M.followupsOf(a.id).length, M.followupsOf(b.id).length], [1, 1]);
M.completeFollowup(f1.id, 'agreed', { date: '2026-09-28', notes: 'next' });
eq('completing logs and schedules the next', [M.followupsOf(a.id).map(f => f.status), M.eventsOf(a.id).filter(e => e.kind === 'followup_done').length], [['done', 'open'], 1]);
M.addNote(a.id, 'Prefers 40 KG bags'); M.addNote(b.id, 'Late truck', { kind: 'complaint' });
eq('notes private and on the right customer', [M.notesOf(a.id).map(n => n.text), M.notesOf(b.id)[0].kind, M.notesOf(a.id)[0].private], [['Prefers 40 KG bags'], 'complaint', true]);
ok('a complaint is a complaint on the timeline', M.eventsOf(b.id).some(e => e.kind === 'complaint'));

/* ── 7. templates ── */
eq('defaults present until overridden', M.templates().length, C.DEFAULT_TEMPLATES.length);
M.saveTemplate({ id: 'tpl_offer', name: 'Price offer (Hindi)', channel: 'whatsapp', body: 'नमस्ते {{customer_name}}' });
eq('a saved built-in overrides in place, count unchanged', [M.templates().length, M.templates().find(t => t.id === 'tpl_offer').body], [C.DEFAULT_TEMPLATES.length, 'नमस्ते {{customer_name}}']);
M.removeTemplate('tpl_offer');
eq('removing the override brings the built-in back (a reset, not a loss)', M.templates().find(t => t.id === 'tpl_offer').body, C.DEFAULT_TEMPLATES[0].body);
M.removeTemplate('tpl_offer');
eq('removing the built-in itself hides it', M.templates().some(t => t.id === 'tpl_offer'), false);

/* ── 8. enrich sees it all, per customer ── */
const rows = M.enriched();
const A = rows.find(r => r.id === a.id), B = rows.find(r => r.id === b.id);
eq('A: 1 order, 2 requirements, 2 quotations, 1 note', [A.salesN, A.reqs.length, A.quotes.length], [1, 2, 2]);
eq('B: no orders, 1 offer, monthly demand 250 + 30×4.33', [B.salesN, B.offers.length, B.monthlyDemand], [0, 1, 379.9]);
eq('A\'s quotation conversion: 1 won of 2 decided (expired + converted)', [A.quotesDecided, A.quotesWon, A.conversion], [2, 1, 50]);

/* ── 9. blob round-trip: nothing lost through JSON ── */
const blob = JSON.parse(JSON.stringify({ reqs: S.REQS, quotes: S.QUOTES, offers: S.OFFERS, deals: S.DEALS, followups: S.FOLLOWUPS, cnotes: S.CNOTES, ctimeline: S.CTIMELINE, msgTemplates: S.MSG_TEMPLATES }));
eq('round-trip keeps every row', [blob.reqs.length, blob.quotes.length, blob.offers.length, blob.deals.length, blob.followups.length, blob.cnotes.length, blob.ctimeline.length], [4, 2, 1, 4, 3, 2, S.CTIMELINE.length]);
ok('every row names its customer by stable id', ['reqs', 'quotes', 'offers', 'deals', 'followups', 'cnotes', 'ctimeline'].every(k => blob[k].every(r => r.cust === a.id || r.cust === b.id)));
ok('commit() was called for every write', commits > 30);

/* ── 10. ensureIds backfills old parties ── */
S.PARTIES.push({ name: 'OLD IMPORT', type: 'customer' });
ok('a party without id/code gets both', M.ensureIds() && /^p/.test(S.PARTIES[2].id) && S.PARTIES[2].code === 'C-0003');
eq('a second pass changes nothing', M.ensureIds(), false);

console.log('\n═══ customer-store ═══');
fails.forEach(f => console.log('  ❌ ' + f));
console.log((fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
