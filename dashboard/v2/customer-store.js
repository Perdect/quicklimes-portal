/* ═══════════════════════════════════════════════════════════════════════
   customer-store.js — the WRITE side of Customer 360° (window.QLCRM).

   Every requirement, quotation, offer, deal, follow-up, note and activity is a
   row in the per-company blob (QLD.state.*), keyed to the customer by the
   party's STABLE id — never its array index, which moves when the list does.
   Reads go through customer-core.js; this file only creates, edits, links and
   logs. Each write calls QLD.commit(), so it lands in localStorage now and in
   the cloud on the same debounce every other register uses.

   THE LINKING RULE
   A quotation knows its requirement, a deal knows the quotation that moved
   it, an order (sale) knows the quotation it converted, and every one of them
   knows the customer. That is what lets the profile answer "what did we
   offer, what did they buy, what is open" without a second copy of anything.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const Q = window.QLD, C = window.CustomerCore, U = window.QLUnits;
  if (!Q || !C || !U) { console.warn('customer-store: QLD/CustomerCore/QLUnits missing'); return; }
  const S = Q.state;
  /* Every row that carries a quantity carries its unit, and every row that
     carries a rate carries the unit that rate is per (rateUnit). Legacy 'MT'
     folds onto Ton; a NEW line whose form left rateUnit blank gets the
     business default (mass → per Ton, bags → per Bag) via C.newRateUnit.
     The amount is ALWAYS QLUnits.lineAmount — never qty × rate — so a
     7,650 Kg order at ₹5,300 / Ton is ₹40,545. */
  const withUnits = (row, rateKeys) => {
    const out = Object.assign({}, row);
    if (out.unit !== undefined || out.rateUnit !== undefined || (rateKeys || []).some(k => out[k] !== undefined && out[k] !== '')) {
      out.unit = C.unitKey(out.unit) || 'Ton';
      out.rateUnit = C.newRateUnit(out.unit, out.rateUnit);
    }
    return out;
  };
  /* An EXISTING record being edited keeps the rate unit it was booked with:
     a legacy row with no rateUnit is priced per its own unit (C.rateUnitOf,
     the register's rule), so an edit that does not touch the rate unit can
     never silently re-price a stored Kg line as per Ton. */
  const asStored = (r) => Object.assign({}, r, { rateUnit: C.rateUnitOf(r.unit, r.rateUnit) });
  const priceOf = (row, rateKey) => C.priceLine(row.qty, row.unit, row[rateKey || 'rate'], row.rateUnit);
  const qtyLabel = (qty, unit) => C.fmtQty(qty, unit);
  const rateLabel = (rate, rateUnit, unit) => C.fmtRate(rate, rateUnit, unit);
  const now = () => new Date().toISOString();
  const today = () => C.iso(new Date());
  const stamp = () => Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const who = () => { try { const p = JSON.parse(localStorage.getItem('ql_plant') || '{}'); return p.user_name || p.owner_name || p.name || ''; } catch (_) { return ''; } };
  const up = s => String(s || '').trim().toUpperCase();

  /* ── customers (parties of type customer/both) ───────────────────────── */
  /* Every party needs an id and every customer a code. Parties created before
     ids existed (old imports) get one here, once, so a URL can name them. */
  function ensureIds() {
    let changed = false;
    S.PARTIES.forEach(p => {
      if (!p.id) { p.id = 'p' + stamp(); changed = true; }
      if ((p.type || 'customer') !== 'supplier' && !p.code) { p.code = C.nextCode(S.PARTIES); changed = true; }
    });
    if (changed) Q.commit();
    return changed;
  }
  function byId(id) { return S.PARTIES.find(p => p.id === id) || null; }
  function idxOf(id) { return S.PARTIES.findIndex(p => p.id === id); }
  function customers() { return S.PARTIES.filter(p => (p.type || 'customer') !== 'supplier' && !p._del && !p._arch); }

  /* The fields the customer master carries beyond the party's identity. */
  const CUSTOMER_FIELDS = ['ctype', 'contact', 'wa', 'email', 'altContact', 'address', 'city', 'state', 'country', 'pin',
    'gstin', 'pan', 'iec', 'code', 'payTerms', 'payTermsNote', 'creditLimit', 'creditDays', 'transport', 'deliveryLoc', 'since',
    'salesperson', 'cstatus', 'segments', 'notes', 'industry', 'lang', 'autoRemind', 'autoInvoice', 'autoStatement', 'opening', 'waAlt'];

  function addCustomer(v) {
    const name = String(v.name || '').trim();
    if (name.length < 2) return { ok: false, reason: 'Customer name is required' };
    const dupe = S.PARTIES.find(p => !p._del && (up(p.name) === up(name) || (v.gstin && p.gstin && up(p.gstin) === up(v.gstin))));
    if (dupe) return { ok: false, reason: 'Already on file as "' + dupe.name + '"' + (v.gstin && up(dupe.gstin) === up(v.gstin) ? ' (same GSTIN)' : ''), id: dupe.id };
    Q.upsertParty(name, v.gstin || '', v.phone || '', v.address || '', v.state || '', v.type || 'customer', true);
    const p = S.PARTIES.find(x => up(x.name) === up(name));
    if (!p) return { ok: false, reason: 'The customer could not be created' };
    if (!p.id) p.id = 'p' + stamp();
    applyFields(p, v);
    if (!p.code) p.code = C.nextCode(S.PARTIES);
    if (!p.since) p.since = today();
    if (!p.cstatus) p.cstatus = 'new';
    p.createdAt = now();
    Q.commit();
    logEvent(p.id, 'created', { title: 'Customer created', detail: [C.labelOf(C.CUSTOMER_TYPES, p.ctype), p.city].filter(Boolean).join(' · ') });
    return { ok: true, id: p.id, idx: idxOf(p.id) };
  }
  function applyFields(p, v) {
    CUSTOMER_FIELDS.forEach(k => {
      if (v[k] === undefined) return;
      if (k === 'creditLimit' || k === 'creditDays' || k === 'opening') p[k] = +v[k] || 0;
      else if (k === 'segments') p[k] = Array.isArray(v[k]) ? v[k] : String(v[k] || '').split(',').map(s => s.trim()).filter(Boolean);
      else if (k === 'gstin' || k === 'pan' || k === 'iec') p[k] = up(v[k]);
      else p[k] = v[k];
    });
    if (v.name && String(v.name).trim().length >= 2) p.name = String(v.name).trim();
    if (v.phone !== undefined) p.phone = v.phone;
    if (v.type) p.type = v.type;
  }
  function updateCustomer(id, v) {
    const p = byId(id); if (!p) return { ok: false, reason: 'Customer not found' };
    const before = { cstatus: p.cstatus, salesperson: p.salesperson, name: p.name };
    applyFields(p, v);
    p.updatedAt = now();
    Q.commit();
    if (v.cstatus !== undefined && v.cstatus !== before.cstatus) logEvent(id, 'status', { title: 'Status changed', detail: (C.labelOf(C.CUSTOMER_STATUS, before.cstatus) || 'unset') + ' → ' + C.labelOf(C.CUSTOMER_STATUS, v.cstatus) });
    else logEvent(id, 'edit', { title: 'Details updated', detail: Object.keys(v).filter(k => k !== 'name' && v[k] !== undefined && v[k] !== '').slice(0, 6).join(', ') });
    return { ok: true, id };
  }
  function setStatus(id, status) { return updateCustomer(id, { cstatus: status }); }
  function setSalesperson(id, name) { const p = byId(id); if (!p) return; p.salesperson = name; Q.commit(); }
  function toggleTag(id, tag, on) {
    const p = byId(id); if (!p) return;
    const set = new Set(Array.isArray(p.segments) ? p.segments : []);
    if (on === undefined) on = !set.has(tag);
    on ? set.add(tag) : set.delete(tag);
    p.segments = [...set]; Q.commit();
  }

  /* ── the activity log ─────────────────────────────────────────────────── */
  function logEvent(cust, kind, o) {
    o = o || {};
    const e = { id: 'ev' + stamp(), cust, kind, at: o.at || now(), by: o.by || who(), title: o.title || C.TIMELINE_KINDS[kind] || kind, detail: o.detail || '', ref: o.ref || null, amount: o.amount == null ? null : +o.amount };
    S.CTIMELINE.push(e); Q.commit();
    return e;
  }
  function eventsOf(cust) { return S.CTIMELINE.filter(e => e.cust === cust); }

  /* ── requirements ─────────────────────────────────────────────────────── */
  function reqsOf(cust) { return S.REQS.filter(r => r.cust === cust && !r._del); }
  function reqSummary(r) { return (r.product || 'Quick Lime') + ' · ' + qtyLabel(r.qty || 0, r.unit) + (r.freq === 'monthly' ? '/month' : r.freq === 'weekly' ? '/week' : '') + (r.targetRate ? ' · target ' + rateLabel(r.targetRate, r.rateUnit, r.unit) : ''); }
  const REQ_RATES = ['prefRate', 'targetRate', 'lastQuoted', 'acceptedRate'];
  function reqUnitsOk(r) {
    const rate = REQ_RATES.map(k => +r[k] || 0).find(x => x > 0);
    if (!rate) return { ok: true };
    const L = priceOf(Object.assign({}, r, { rate }), 'rate');
    return L.ok ? { ok: true } : { ok: false, reason: L.why };
  }
  function addReq(cust, v) {
    if (!byId(cust)) return { ok: false, reason: 'Customer not found' };
    const r = withUnits(Object.assign({ id: 'rq' + stamp(), cust, status: 'active', at: now(), updatedAt: now(), unit: 'Ton', freq: 'monthly' }, clean(v)), REQ_RATES);
    if (!(+r.qty > 0)) return { ok: false, reason: 'Quantity is required' };
    const u = reqUnitsOk(r); if (!u.ok) return u;
    S.REQS.push(r); Q.commit();
    logEvent(cust, 'requirement', { title: 'Customer requirement added', detail: reqSummary(r), ref: { type: 'req', id: r.id } });
    advanceDeal(cust, 'req_received', { product: r.product, qty: r.qty, unit: r.unit, targetRate: r.targetRate, rateUnit: r.rateUnit, reqId: r.id });
    return { ok: true, id: r.id };
  }
  function updateReq(id, v) {
    const r = S.REQS.find(x => x.id === id); if (!r) return { ok: false };
    const next = withUnits(Object.assign(asStored(r), clean(v)), REQ_RATES);
    const u = reqUnitsOk(next); if (!u.ok) return u;
    Object.assign(r, next, { updatedAt: now() }); Q.commit();
    logEvent(r.cust, 'requirement', { title: 'Requirement updated', detail: reqSummary(r), ref: { type: 'req', id } });
    return { ok: true };
  }
  function removeReq(id) { const i = S.REQS.findIndex(x => x.id === id); if (i < 0) return; const r = S.REQS[i]; S.REQS.splice(i, 1); Q.commit(); logEvent(r.cust, 'requirement', { title: 'Requirement removed', detail: reqSummary(r) }); }

  /* ── quotations ───────────────────────────────────────────────────────── */
  function quotesOf(cust) { return S.QUOTES.filter(q => q.cust === cust && !q._del); }
  /* QT-1001 upward; a revision keeps the number and adds -R2, -R3… */
  function nextQuoteNo() {
    let mx = 1000;
    S.QUOTES.forEach(q => { const m = /^QT-(\d+)/.exec(String(q.no || '')); if (m) mx = Math.max(mx, +m[1]); });
    return 'QT-' + (mx + 1);
  }
  function addQuote(v) {
    if (!byId(v.cust)) return { ok: false, reason: 'Customer not found' };
    const q = Object.assign({ id: 'qt' + stamp(), no: nextQuoteNo(), date: today(), status: 'draft', rev: 1, items: [], gstR: 5, history: [], at: now(), by: who() }, clean(v));
    if (!q.validUntil) q.validUntil = C.addDays(q.date, 7);
    q.items = normLines(q.items);
    if (!q.items.length) return { ok: false, reason: 'A quotation needs at least one line' };
    const t = C.quoteTotals(q);
    if (!t.ok) return { ok: false, reason: t.why };
    q.history.push({ at: now(), by: who(), what: 'Created', status: 'draft' });
    S.QUOTES.push(q); Q.commit();
    logEvent(q.cust, 'quote_status', { title: 'Quotation ' + q.no + ' prepared', detail: lineSummary(q), amount: t.total, ref: { type: 'quote', id: q.id } });
    advanceDeal(q.cust, 'quote_prepared', Object.assign({ product: q.items[0].product, value: t.total, quoteId: q.id }, dealQtyOf(q, t)));
    return { ok: true, id: q.id, no: q.no };
  }
  /* Quotation lines: only lines with a quantity, each carrying its unit and
     the unit its rate is per. */
  function normLines(items) { return (items || []).filter(it => +it.qty > 0).map(it => withUnits(Object.assign({ unit: 'Ton' }, it), ['rate'])); }
  /* What a quotation puts on its deal: the tonnage priced per Ton when the
     lines are a mass, else the first line as entered (bags stay bags). */
  function dealQtyOf(q, t) { const it = q.items[0] || {}; return t.tonnes > 0 ? { qty: t.tonnes, unit: 'Ton', targetRate: it.rate, rateUnit: it.rateUnit } : { qty: it.qty, unit: it.unit, targetRate: it.rate, rateUnit: it.rateUnit }; }
  function lineSummary(q) { return (q.items || []).map(it => (it.product || '') + ' – ' + qtyLabel(it.qty, it.unit) + ' @ ' + rateLabel(it.rate, it.rateUnit, it.unit)).join(' · '); }
  function updateQuote(id, v, what) {
    const q = S.QUOTES.find(x => x.id === id); if (!q) return { ok: false };
    const before = JSON.stringify((q.items || []).map(it => [it.product, it.qty, it.unit, it.rate, it.rateUnit]));
    if (v.items) { const items = normLines(v.items); const t0 = C.quoteTotals(Object.assign({}, q, clean(v), { items })); if (!t0.ok) return { ok: false, reason: t0.why }; }
    Object.assign(q, clean(v), { updatedAt: now() });
    if (v.items) q.items = normLines(v.items);
    const after = JSON.stringify((q.items || []).map(it => [it.product, it.qty, it.unit, it.rate, it.rateUnit]));
    q.history = q.history || []; q.history.push({ at: now(), by: who(), what: what || 'Edited', status: q.status });
    Q.commit();
    if (before !== after) logEvent(q.cust, 'price_revised', { title: 'Price revised on ' + q.no, detail: lineSummary(q), amount: C.quoteTotals(q).total, ref: { type: 'quote', id } });
    return { ok: true };
  }
  const STAGE_FOR_QUOTE = { sent: 'quote_sent', viewed: 'quote_sent', negotiation: 'negotiation', accepted: 'price_confirmed', converted: 'order_confirmed' };
  function setQuoteStatus(id, status, o) {
    o = o || {};
    const q = S.QUOTES.find(x => x.id === id); if (!q) return { ok: false };
    const prev = q.status;
    q.status = status; q.updatedAt = now();
    if (status === 'sent') { q.sentAt = now(); q.sentVia = o.via || q.sentVia || ''; }
    q.history = q.history || []; q.history.push({ at: now(), by: who(), what: o.note || (C.labelOf(C.QUOTE_STATUS, status)), status, via: o.via || '' });
    Q.commit();
    const t = C.quoteTotals(q);
    if (status === 'sent' && prev !== 'sent') logEvent(q.cust, 'quote_sent', { title: 'Quotation ' + q.no + ' sent' + (o.via ? ' by ' + o.via : ''), detail: lineSummary(q), amount: t.total, ref: { type: 'quote', id } });
    else logEvent(q.cust, 'quote_status', { title: 'Quotation ' + q.no + ': ' + C.labelOf(C.QUOTE_STATUS, status), detail: o.note || lineSummary(q), amount: t.total, ref: { type: 'quote', id } });
    if (status === 'negotiation' && o.priceRequest) logEvent(q.cust, 'price_request', { title: 'Customer requested revised price', detail: 'on ' + q.no + (o.note ? ' — ' + o.note : ''), ref: { type: 'quote', id } });
    if (STAGE_FOR_QUOTE[status]) advanceDeal(q.cust, STAGE_FOR_QUOTE[status], Object.assign({ product: (q.items[0] || {}).product, value: t.total, quoteId: q.id }, dealQtyOf(q, t)));
    if (status === 'rejected') { const d = dealForQuote(q); if (d && C.isOpenStage(d.stage)) moveDeal(d.id, 'lost', 'Quotation rejected'); }
    return { ok: true };
  }
  /* A revision is a NEW quotation carrying the same number with -R2; the old
     one is closed as expired so it can never be sent again by mistake. */
  function reviseQuote(id, changes) {
    const q = S.QUOTES.find(x => x.id === id); if (!q) return { ok: false };
    const base = String(q.no).replace(/-R\d+$/, '');
    const rev = (q.rev || 1) + 1;
    const n = Object.assign({}, JSON.parse(JSON.stringify(q)), { id: 'qt' + stamp(), no: base + '-R' + rev, rev, parentId: q.id, status: 'draft', date: today(), validUntil: C.addDays(today(), 7), sentAt: null, sentVia: '', at: now(), by: who(), history: [{ at: now(), by: who(), what: 'Revised from ' + q.no, status: 'draft' }] }, clean(changes || {}));
    if (changes && changes.items) n.items = normLines(changes.items);
    const tn = C.quoteTotals(n); if (!tn.ok) return { ok: false, reason: tn.why };
    q.status = 'expired'; q.supersededBy = n.id; q.history = q.history || []; q.history.push({ at: now(), by: who(), what: 'Superseded by ' + n.no, status: 'expired' });
    S.QUOTES.push(n); Q.commit();
    logEvent(q.cust, 'price_revised', { title: 'Quotation revised: ' + n.no, detail: lineSummary(n), amount: C.quoteTotals(n).total, ref: { type: 'quote', id: n.id } });
    return { ok: true, id: n.id, no: n.no };
  }
  function duplicateQuote(id) {
    const q = S.QUOTES.find(x => x.id === id); if (!q) return { ok: false };
    const n = Object.assign({}, JSON.parse(JSON.stringify(q)), { id: 'qt' + stamp(), no: nextQuoteNo(), rev: 1, parentId: null, supersededBy: null, status: 'draft', date: today(), validUntil: C.addDays(today(), 7), sentAt: null, sentVia: '', convertedSale: null, at: now(), by: who(), history: [{ at: now(), by: who(), what: 'Duplicated from ' + q.no, status: 'draft' }] });
    S.QUOTES.push(n); Q.commit();
    return { ok: true, id: n.id, no: n.no };
  }
  function removeQuote(id) { const i = S.QUOTES.findIndex(x => x.id === id); if (i < 0) return; const q = S.QUOTES[i]; if (q.status !== 'draft') return { ok: false, reason: 'Only a draft can be deleted — mark it rejected or expired instead' }; S.QUOTES.splice(i, 1); Q.commit(); return { ok: true }; }

  /* ── quick price offers ───────────────────────────────────────────────── */
  function offersOf(cust) { return S.OFFERS.filter(o => o.cust === cust && !o._del); }
  function nextOfferNo() { let mx = 0; S.OFFERS.forEach(o => { const m = /^PO-(\d+)/.exec(String(o.no || '')); if (m) mx = Math.max(mx, +m[1]); }); return 'PO-' + (mx + 1); }
  function addOffer(v, via) {
    if (!byId(v.cust)) return { ok: false, reason: 'Customer not found' };
    const o = withUnits(Object.assign({ id: 'of' + stamp(), no: nextOfferNo(), date: today(), unit: 'Ton', status: via ? 'sent' : 'saved', via: via || '', at: now(), by: who() }, clean(v)), ['rate']);
    if (!(+o.rate > 0)) return { ok: false, reason: 'Offer price is required' };
    const L = priceOf(o); if (!L.ok) return { ok: false, reason: L.why };
    if (!o.validUntil) o.validUntil = C.addDays(o.date, +o.validDays || 3);
    S.OFFERS.push(o); Q.commit();
    logEvent(o.cust, 'offer_sent', { title: (via ? 'Price offer sent by ' + via : 'Price offer saved') + ' (' + o.no + ')', detail: (o.product || '') + ' – ' + (o.qty ? qtyLabel(o.qty, o.unit) : '? ' + o.unit) + ' @ ' + rateLabel(o.rate, o.rateUnit, o.unit) + ' · ' + C.labelOf(C.FREIGHT, o.freight) + ' · valid till ' + o.validUntil, amount: (+o.qty > 0 ? L.amount : null) || null, ref: { type: 'offer', id: o.id } });
    advanceDeal(o.cust, 'quote_sent', { product: o.product, qty: o.qty, unit: o.unit, targetRate: o.rate, rateUnit: o.rateUnit, offerId: o.id });
    return { ok: true, id: o.id, no: o.no };
  }
  function setOfferStatus(id, status, note) {
    const o = S.OFFERS.find(x => x.id === id); if (!o) return { ok: false };
    o.status = status; o.updatedAt = now(); Q.commit();
    logEvent(o.cust, 'quote_status', { title: 'Offer ' + o.no + ': ' + C.labelOf(C.OFFER_STATUS, status), detail: note || '', ref: { type: 'offer', id } });
    if (status === 'accepted') advanceDeal(o.cust, 'price_confirmed', { product: o.product, qty: o.qty, unit: o.unit, targetRate: o.rate, rateUnit: o.rateUnit, offerId: id });
    return { ok: true };
  }
  function markOfferSent(id, via) { const o = S.OFFERS.find(x => x.id === id); if (!o) return; if (o.status === 'saved') o.status = 'sent'; o.via = via; o.sentAt = now(); Q.commit(); logEvent(o.cust, via === 'email' ? 'email' : 'whatsapp', { title: 'Offer ' + o.no + ' sent by ' + via, detail: (o.product || '') + ' @ ' + rateLabel(o.rate, o.rateUnit, o.unit), ref: { type: 'offer', id } }); }

  /* ── deals — the pipeline ─────────────────────────────────────────────── */
  const STAGE_ORDER = C.STAGES.map(s => s.key);
  function dealsOf(cust) { return S.DEALS.filter(d => d.cust === cust && !d._del); }
  function openDeal(cust, product) {
    return S.DEALS.filter(d => d.cust === cust && C.isOpenStage(d.stage) && (!product || !d.product || d.product === product))
      .sort((a, b) => String(b.updatedAt || b.at).localeCompare(String(a.updatedAt || a.at)))[0] || null;
  }
  function dealForQuote(q) { return S.DEALS.find(d => d.quoteId === q.id) || openDeal(q.cust, (q.items[0] || {}).product); }
  function addDeal(v) {
    if (!byId(v.cust)) return { ok: false, reason: 'Customer not found' };
    const p = byId(v.cust);
    const d = withUnits(Object.assign({ id: 'dl' + stamp(), stage: 'new_lead', at: now(), updatedAt: now(), lastActivityAt: now(), owner: p.salesperson || '', unit: 'Ton' }, clean(v)), ['targetRate']);
    const u = dealUnitsOk(d); if (!u.ok) return u;
    S.DEALS.push(d); Q.commit();
    return { ok: true, id: d.id };
  }
  function dealUnitsOk(d) { if (!(+d.qty > 0 && +d.targetRate > 0)) return { ok: true }; const L = priceOf(d, 'targetRate'); return L.ok ? { ok: true } : { ok: false, reason: L.why }; }
  function updateDeal(id, v) { const d = S.DEALS.find(x => x.id === id); if (!d) return { ok: false }; const next = withUnits(Object.assign(asStored(d), clean(v)), ['targetRate']); const u = dealUnitsOk(next); if (!u.ok) return u; Object.assign(d, next, { updatedAt: now() }); Q.commit(); return { ok: true }; }
  function moveDeal(id, stage, note) {
    const d = S.DEALS.find(x => x.id === id); if (!d || !C.stage(stage)) return { ok: false };
    const prev = d.stage; if (prev === stage) return { ok: true };
    d.stage = stage; d.updatedAt = now(); d.lastActivityAt = now();
    if (stage === 'completed') d.wonAt = now(); if (stage === 'lost') { d.lostAt = now(); d.lostReason = note || d.lostReason || ''; }
    Q.commit();
    logEvent(d.cust, stage === 'delivered' ? 'delivered' : stage === 'order_confirmed' ? 'order' : 'status', { title: (stage === 'delivered' ? 'Delivery completed' : stage === 'order_confirmed' ? 'Order confirmed' : 'Pipeline: ' + C.stageLabel(prev) + ' → ' + C.stageLabel(stage)), detail: (d.product || '') + (d.qty ? ' · ' + qtyLabel(d.qty, d.unit) : '') + (note ? ' — ' + note : ''), ref: { type: 'deal', id } });
    return { ok: true };
  }
  /* Move the customer's open deal forward to `stage` (never backwards), or
     open one. Called by requirements, quotations, offers and orders, so the
     board reflects what actually happened without anyone dragging a card. */
  function advanceDeal(cust, stage, o) {
    o = o || {};
    let d = o.quoteId ? S.DEALS.find(x => x.quoteId === o.quoteId) : null;
    if (!d) d = openDeal(cust, o.product);
    if (!d) {
      const p = byId(cust) || {};
      d = { id: 'dl' + stamp(), cust, stage: 'new_lead', at: now(), updatedAt: now(), lastActivityAt: now(), owner: p.salesperson || '', unit: 'Ton' };
      S.DEALS.push(d);
    }
    ['product', 'qty', 'unit', 'targetRate', 'rateUnit', 'value', 'quoteId', 'reqId', 'offerId', 'saleIdx'].forEach(k => { if (o[k] != null && o[k] !== '') d[k] = o[k]; });
    if (o.qty != null && o.qty !== '') { d.unit = C.unitKey(o.unit || d.unit) || 'Ton'; d.rateUnit = C.rateUnitOf(d.unit, o.rateUnit || d.rateUnit); }
    if (STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(d.stage)) d.stage = stage;
    d.updatedAt = now(); d.lastActivityAt = now();
    Q.commit();
    return d;
  }
  function touchDeal(cust) { const d = openDeal(cust); if (d) { d.lastActivityAt = now(); Q.commit(); } }

  /* ── follow-ups ───────────────────────────────────────────────────────── */
  function followupsOf(cust) { return S.FOLLOWUPS.filter(f => f.cust === cust && !f._del); }
  function addFollowup(v) {
    if (!byId(v.cust)) return { ok: false, reason: 'Customer not found' };
    const p = byId(v.cust);
    const f = Object.assign({ id: 'fu' + stamp(), date: today(), time: '', type: 'call', status: 'open', at: now(), by: who(), assignee: p.salesperson || who() }, clean(v));
    S.FOLLOWUPS.push(f); Q.commit();
    logEvent(f.cust, 'followup_due', { title: 'Follow-up scheduled: ' + C.labelOf(C.FOLLOWUP_TYPES, f.type), detail: f.date + (f.time ? ' ' + f.time : '') + (f.notes ? ' — ' + f.notes : ''), ref: { type: 'followup', id: f.id } });
    return { ok: true, id: f.id };
  }
  function updateFollowup(id, v) { const f = S.FOLLOWUPS.find(x => x.id === id); if (!f) return { ok: false }; Object.assign(f, clean(v), { updatedAt: now() }); Q.commit(); return { ok: true }; }
  function completeFollowup(id, outcome, next) {
    const f = S.FOLLOWUPS.find(x => x.id === id); if (!f) return { ok: false };
    f.status = 'done'; f.doneAt = now(); f.outcome = outcome || ''; Q.commit();
    logEvent(f.cust, 'followup_done', { title: 'Follow-up completed: ' + C.labelOf(C.FOLLOWUP_TYPES, f.type), detail: outcome || f.notes || '', ref: { type: 'followup', id } });
    touchDeal(f.cust);
    if (next && next.date) addFollowup(Object.assign({ cust: f.cust, type: f.type, assignee: f.assignee }, next));
    return { ok: true };
  }
  function skipFollowup(id) { const f = S.FOLLOWUPS.find(x => x.id === id); if (!f) return; f.status = 'skipped'; f.doneAt = now(); Q.commit(); }

  /* ── notes ────────────────────────────────────────────────────────────── */
  function notesOf(cust) { return S.CNOTES.filter(n => n.cust === cust && !n._del).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.at).localeCompare(String(a.at))); }
  function addNote(cust, text, o) {
    text = String(text || '').trim(); if (!text || !byId(cust)) return { ok: false };
    const n = Object.assign({ id: 'nt' + stamp(), cust, text, at: now(), by: who(), pinned: false, private: true, kind: 'note' }, o || {});
    S.CNOTES.push(n); Q.commit();
    logEvent(cust, n.kind === 'complaint' ? 'complaint' : 'note', { title: n.kind === 'complaint' ? 'Complaint / issue' : 'Internal note', detail: text.slice(0, 200), ref: { type: 'note', id: n.id } });
    return { ok: true, id: n.id };
  }
  function updateNote(id, text) { const n = S.CNOTES.find(x => x.id === id); if (!n) return; n.text = String(text || '').trim(); n.updatedAt = now(); Q.commit(); }
  function removeNote(id) { const i = S.CNOTES.findIndex(x => x.id === id); if (i >= 0) { S.CNOTES.splice(i, 1); Q.commit(); } }
  function pinNote(id, on) { const n = S.CNOTES.find(x => x.id === id); if (!n) return; n.pinned = on === undefined ? !n.pinned : !!on; Q.commit(); }

  /* ── communication log (a message the user opened/sent) ───────────────── */
  function logMessage(cust, channel, text, ref) {
    return logEvent(cust, channel === 'email' ? 'email' : channel === 'call' ? 'call' : channel === 'meeting' ? 'meeting' : 'whatsapp', { title: channel === 'email' ? 'Email sent' : channel === 'call' ? 'Call' : channel === 'meeting' ? 'Meeting' : 'WhatsApp message sent', detail: String(text || '').slice(0, 400), ref: ref || null });
  }

  /* ── message templates ────────────────────────────────────────────────── */
  function templates() {
    const custom = S.MSG_TEMPLATES || [];
    const map = {}; C.DEFAULT_TEMPLATES.forEach(t => { map[t.id] = Object.assign({ builtin: true }, t); });
    custom.forEach(t => { map[t.id] = Object.assign({}, map[t.id] || {}, t, { builtin: false, overridesBuiltin: !!map[t.id] && map[t.id].builtin }); });
    return Object.values(map).filter(t => !t._del);
  }
  function saveTemplate(t) {
    if (!t || !String(t.body || '').trim()) return { ok: false, reason: 'Template body is required' };
    const id = t.id || ('tp' + stamp());
    const i = S.MSG_TEMPLATES.findIndex(x => x.id === id);
    const row = Object.assign({ id, name: t.name || 'Template', channel: t.channel || 'whatsapp', body: t.body, updatedAt: now() });
    if (i >= 0) S.MSG_TEMPLATES[i] = Object.assign({}, S.MSG_TEMPLATES[i], row); else S.MSG_TEMPLATES.push(row);
    Q.commit(); return { ok: true, id };
  }
  function removeTemplate(id) {
    const i = S.MSG_TEMPLATES.findIndex(x => x.id === id);
    if (i >= 0) { S.MSG_TEMPLATES.splice(i, 1); Q.commit(); return; }
    if (C.DEFAULT_TEMPLATES.some(t => t.id === id)) { S.MSG_TEMPLATES.push({ id, _del: true }); Q.commit(); }
  }

  /* ── orders: a quotation or offer becomes a GST invoice row ───────────── */
  function recordOrder(v, link) {
    link = link || {};
    const p = byId(link.cust); if (!p) return { ok: false, reason: 'Customer not found' };
    /* The sale is self-describing: unit + rateUnit always stored (the form's
       selects, else Ton / per Ton), so the register, the print and the e-way
       value all price it through QLUnits.lineAmount. */
    const sale = withUnits(Object.assign({ party: p.name, gstin: p.gstin || '', date: today(), product: 'Quick Lime', gstR: 5, unit: 'Ton' }, v, { custId: p.id, quoteId: link.quoteId || null, offerId: link.offerId || null, dealId: link.dealId || null }), ['rate']);
    const L = priceOf(sale);
    if (!L.ok) return { ok: false, reason: L.why };
    const r = Q.addSale(sale);
    if (r && r.ok === false) return r;
    const idx = S.SALES.length - 1;
    if (link.quoteId) { const q = S.QUOTES.find(x => x.id === link.quoteId); if (q) { q.convertedSale = idx; setQuoteStatus(q.id, 'converted', { note: 'Invoice #' + sale.inv }); } }
    if (link.offerId) setOfferStatus(link.offerId, 'accepted', 'Invoice #' + sale.inv);
    const d = advanceDeal(p.id, 'order_confirmed', { product: sale.product, qty: sale.qty, unit: sale.unit, targetRate: sale.rate, rateUnit: sale.rateUnit, value: L.amount, quoteId: link.quoteId, offerId: link.offerId, saleIdx: idx });
    logEvent(p.id, 'order', { title: 'Order received — invoice #' + sale.inv, detail: sale.product + ' · ' + qtyLabel(sale.qty, sale.unit) + ' @ ' + rateLabel(sale.rate, sale.rateUnit, sale.unit), amount: U.round(L.amount * (1 + (+sale.gstR || 0) / 100), 2), ref: { type: 'sale', id: idx } });
    return { ok: true, idx, dealId: d && d.id };
  }
  /* A payment against an invoice, or on account. Both post to the same books
     every other page reads; this only adds the timeline line and the deal move. */
  function recordPayment(cust, o) {
    const p = byId(cust); if (!p) return { ok: false, reason: 'Customer not found' };
    const amount = +o.amount || 0; if (!(amount > 0)) return { ok: false, reason: 'Amount is required' };
    if (o.saleIdx != null && o.saleIdx !== '' && S.SALES[+o.saleIdx]) {
      Q.receiveSalesPayment(+o.saleIdx, { amount, date: o.date, method: o.mode || 'Bank', ref: o.ref, notes: o.desc, accountId: o.accountId || '' });
    } else {
      Q.recordLedgerEntry(idxOf(cust), { cr: amount, date: o.date, mode: o.mode || 'Bank', ref: o.ref, desc: o.desc || 'On-account receipt' });
      logEvent(cust, 'payment', { title: 'Payment received (on account)', detail: (o.mode || 'Bank') + (o.ref ? ' · ' + o.ref : ''), amount, ref: null });
    }
    const d = openDeal(cust); if (d && d.stage === 'payment_pending') moveDeal(d.id, 'completed', 'Payment received');
    return { ok: true };
  }

  /* ── documents ──────────────────────────────────────────────────────────
     The file goes through data.js's attachPartyDoc: IndexedDB here (fast,
     offline), the shared /api/files copy behind it, and a metadata row on the
     customer (party.docs) so every device lists it. Reads try the local
     store first, then the server copy. */
  function docsOf(cust) { const p = byId(cust); return (p && Array.isArray(p.docs)) ? p.docs.filter(d => !d._del) : []; }
  function addDocMeta(idx, meta) {
    const p = S.PARTIES[idx]; if (!p || !meta || !meta.id) return;
    p.docs = (p.docs || []).concat([Object.assign({ at: now(), by: who() }, meta)]); Q.commit();
    if (p.id) logEvent(p.id, 'document', { title: 'Document added: ' + C.labelOf(C.DOC_KINDS, meta.kind || 'other'), detail: meta.label || meta.name || '', ref: { type: 'doc', id: meta.id } });
  }
  async function attachDoc(cust, file, kind, label) {
    const idx = idxOf(cust); if (idx < 0 || !file) return { ok: false, reason: 'No file' };
    try { const id = await Q.attachPartyDoc(idx, file, kind || 'other', label || ''); return { ok: true, id }; }
    catch (e) { return { ok: false, reason: (window.QLAttachWhy ? QLAttachWhy(e) : (e && e.message)) || 'Could not store the file' }; }
  }
  async function fetchDoc(id) {
    try { const b = await Q.getDoc('parties', id); if (b instanceof Blob) return b; } catch (_) {}
    try { return await Q.fetchDocBlob(id); } catch (_) { return null; }
  }
  async function removeDoc(cust, id) {
    const p = byId(cust); if (!p) return;
    p.docs = (p.docs || []).filter(d => d.id !== id); Q.commit();
    let pl = {}; try { pl = JSON.parse(localStorage.getItem('ql_plant') || 'null') || {}; } catch (_) {}
    if (pl.id && pl.token) fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plant_id: pl.id, company_id: Q.activeCo || '', token: pl.token, action: 'del', id }) }).catch(() => {});
  }

  function clean(v) { const o = {}; Object.keys(v || {}).forEach(k => { if (v[k] !== undefined) o[k] = v[k]; }); return o; }

  /* The register rows, plus the rate the price history needs: salesRows()
     carries qty, unit, rate, rateUnit and tonnes; a row with no stored rate
     (a multi-line bill) gets the implied rate per Ton — taxable ÷ tonnes —
     never taxable ÷ raw qty, which would make a Kg invoice look like ₹5 / T. */
  function salesForCrm() {
    return Q.salesRows().map(s => {
      const raw = S.SALES[s.idx] || {};
      const unit = C.unitKey(s.unit || raw.unit) || 'Ton';
      let rate = +s.rate || +raw.rate || 0, rateUnit = C.rateUnitOf(unit, s.rateUnit || raw.rateUnit);
      if (!rate && +s.taxable > 0) { const t = s.tonnes != null ? +s.tonnes : C.tonnesOf(s.qty, unit); if (t > 0) { rate = U.round(s.taxable / t, 2); rateUnit = 'Ton'; } else if (+s.qty > 0) { rate = U.round(s.taxable / s.qty, 2); rateUnit = unit; } }
      return Object.assign({}, s, { rate, unit, rateUnit, tonnes: s.tonnes != null ? +s.tonnes : C.tonnesOf(s.qty, unit), product: s.product || raw.product || 'Quick Lime' });
    });
  }
  /* everything the read side needs, in one call */
  function enriched(opts) {
    opts = opts || {};
    return C.enrich({
      parties: S.PARTIES.filter(p => !p._del && !p._arch), sales: salesForCrm(), reqs: S.REQS, quotes: S.QUOTES, offers: S.OFFERS,
      followups: S.FOLLOWUPS, timeline: S.CTIMELINE, deals: S.DEALS, today: today(), includeAll: !!opts.includeAll, ledgerNet: Q.ledgerNet
    });
  }

  window.QLCRM = {
    ensureIds, byId, idxOf, customers, addCustomer, updateCustomer, setStatus, setSalesperson, toggleTag, CUSTOMER_FIELDS,
    logEvent, eventsOf, logMessage,
    reqsOf, addReq, updateReq, removeReq, reqSummary,
    quotesOf, nextQuoteNo, addQuote, updateQuote, setQuoteStatus, reviseQuote, duplicateQuote, removeQuote, lineSummary,
    offersOf, addOffer, setOfferStatus, markOfferSent, nextOfferNo,
    dealsOf, openDeal, addDeal, updateDeal, moveDeal, advanceDeal,
    followupsOf, addFollowup, updateFollowup, completeFollowup, skipFollowup,
    notesOf, addNote, updateNote, removeNote, pinNote,
    templates, saveTemplate, removeTemplate,
    recordOrder, recordPayment,
    docsOf, addDocMeta, attachDoc, fetchDoc, removeDoc,
    enriched, salesForCrm, today, who
  };
})();
