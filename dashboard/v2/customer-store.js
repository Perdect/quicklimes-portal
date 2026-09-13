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
  const Q = window.QLD, C = window.CustomerCore;
  if (!Q || !C) { console.warn('customer-store: QLD/CustomerCore missing'); return; }
  const S = Q.state;
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
  function reqSummary(r) { return (r.product || 'Quick Lime') + ' · ' + (r.qty || 0) + ' ' + (r.unit || 'MT') + (r.freq === 'monthly' ? '/month' : r.freq === 'weekly' ? '/week' : '') + (r.targetRate ? ' · target ₹' + Math.round(r.targetRate).toLocaleString('en-IN') + '/MT' : ''); }
  function addReq(cust, v) {
    if (!byId(cust)) return { ok: false, reason: 'Customer not found' };
    const r = Object.assign({ id: 'rq' + stamp(), cust, status: 'active', at: now(), updatedAt: now(), unit: 'MT', freq: 'monthly' }, clean(v));
    if (!(+r.qty > 0)) return { ok: false, reason: 'Quantity is required' };
    S.REQS.push(r); Q.commit();
    logEvent(cust, 'requirement', { title: 'Customer requirement added', detail: reqSummary(r), ref: { type: 'req', id: r.id } });
    advanceDeal(cust, 'req_received', { product: r.product, qty: r.qty, targetRate: r.targetRate, reqId: r.id });
    return { ok: true, id: r.id };
  }
  function updateReq(id, v) {
    const r = S.REQS.find(x => x.id === id); if (!r) return { ok: false };
    Object.assign(r, clean(v), { updatedAt: now() }); Q.commit();
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
    q.items = (q.items || []).filter(it => +it.qty > 0);
    if (!q.items.length) return { ok: false, reason: 'A quotation needs at least one line' };
    q.history.push({ at: now(), by: who(), what: 'Created', status: 'draft' });
    S.QUOTES.push(q); Q.commit();
    const t = C.quoteTotals(q);
    logEvent(q.cust, 'quote_status', { title: 'Quotation ' + q.no + ' prepared', detail: lineSummary(q), amount: t.total, ref: { type: 'quote', id: q.id } });
    advanceDeal(q.cust, 'quote_prepared', { product: q.items[0].product, qty: t.tonnes, targetRate: q.items[0].rate, value: t.total, quoteId: q.id });
    return { ok: true, id: q.id, no: q.no };
  }
  function lineSummary(q) { return (q.items || []).map(it => (it.product || '') + ' – ' + it.qty + ' ' + (it.unit || 'MT') + ' @ ₹' + Math.round(+it.rate || 0).toLocaleString('en-IN') + '/' + (it.unit || 'MT')).join(' · '); }
  function updateQuote(id, v, what) {
    const q = S.QUOTES.find(x => x.id === id); if (!q) return { ok: false };
    const before = JSON.stringify((q.items || []).map(it => [it.product, it.qty, it.rate]));
    Object.assign(q, clean(v), { updatedAt: now() });
    if (v.items) q.items = v.items.filter(it => +it.qty > 0);
    const after = JSON.stringify((q.items || []).map(it => [it.product, it.qty, it.rate]));
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
    if (STAGE_FOR_QUOTE[status]) advanceDeal(q.cust, STAGE_FOR_QUOTE[status], { product: (q.items[0] || {}).product, qty: t.tonnes, targetRate: (q.items[0] || {}).rate, value: t.total, quoteId: q.id });
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
    if (changes && changes.items) n.items = changes.items.filter(it => +it.qty > 0);
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
    const o = Object.assign({ id: 'of' + stamp(), no: nextOfferNo(), date: today(), unit: 'MT', status: via ? 'sent' : 'saved', via: via || '', at: now(), by: who() }, clean(v));
    if (!(+o.rate > 0)) return { ok: false, reason: 'Offer price is required' };
    if (!o.validUntil) o.validUntil = C.addDays(o.date, +o.validDays || 3);
    S.OFFERS.push(o); Q.commit();
    logEvent(o.cust, 'offer_sent', { title: (via ? 'Price offer sent by ' + via : 'Price offer saved') + ' (' + o.no + ')', detail: (o.product || '') + ' – ' + (o.qty || '?') + ' ' + o.unit + ' @ ₹' + Math.round(o.rate).toLocaleString('en-IN') + '/MT · ' + C.labelOf(C.FREIGHT, o.freight) + ' · valid till ' + o.validUntil, amount: (+o.qty || 0) * o.rate || null, ref: { type: 'offer', id: o.id } });
    advanceDeal(o.cust, 'quote_sent', { product: o.product, qty: o.qty, targetRate: o.rate, offerId: o.id });
    return { ok: true, id: o.id, no: o.no };
  }
  function setOfferStatus(id, status, note) {
    const o = S.OFFERS.find(x => x.id === id); if (!o) return { ok: false };
    o.status = status; o.updatedAt = now(); Q.commit();
    logEvent(o.cust, 'quote_status', { title: 'Offer ' + o.no + ': ' + C.labelOf(C.OFFER_STATUS, status), detail: note || '', ref: { type: 'offer', id } });
    if (status === 'accepted') advanceDeal(o.cust, 'price_confirmed', { product: o.product, qty: o.qty, targetRate: o.rate, offerId: id });
    return { ok: true };
  }
  function markOfferSent(id, via) { const o = S.OFFERS.find(x => x.id === id); if (!o) return; if (o.status === 'saved') o.status = 'sent'; o.via = via; o.sentAt = now(); Q.commit(); logEvent(o.cust, via === 'email' ? 'email' : 'whatsapp', { title: 'Offer ' + o.no + ' sent by ' + via, detail: (o.product || '') + ' @ ₹' + Math.round(o.rate).toLocaleString('en-IN') + '/MT', ref: { type: 'offer', id } }); }

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
    const d = Object.assign({ id: 'dl' + stamp(), stage: 'new_lead', at: now(), updatedAt: now(), lastActivityAt: now(), owner: p.salesperson || '', unit: 'MT' }, clean(v));
    S.DEALS.push(d); Q.commit();
    return { ok: true, id: d.id };
  }
  function updateDeal(id, v) { const d = S.DEALS.find(x => x.id === id); if (!d) return { ok: false }; Object.assign(d, clean(v), { updatedAt: now() }); Q.commit(); return { ok: true }; }
  function moveDeal(id, stage, note) {
    const d = S.DEALS.find(x => x.id === id); if (!d || !C.stage(stage)) return { ok: false };
    const prev = d.stage; if (prev === stage) return { ok: true };
    d.stage = stage; d.updatedAt = now(); d.lastActivityAt = now();
    if (stage === 'completed') d.wonAt = now(); if (stage === 'lost') { d.lostAt = now(); d.lostReason = note || d.lostReason || ''; }
    Q.commit();
    logEvent(d.cust, stage === 'delivered' ? 'delivered' : stage === 'order_confirmed' ? 'order' : 'status', { title: (stage === 'delivered' ? 'Delivery completed' : stage === 'order_confirmed' ? 'Order confirmed' : 'Pipeline: ' + C.stageLabel(prev) + ' → ' + C.stageLabel(stage)), detail: (d.product || '') + (d.qty ? ' · ' + d.qty + ' ' + (d.unit || 'MT') : '') + (note ? ' — ' + note : ''), ref: { type: 'deal', id } });
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
      d = { id: 'dl' + stamp(), cust, stage: 'new_lead', at: now(), updatedAt: now(), lastActivityAt: now(), owner: p.salesperson || '', unit: 'MT' };
      S.DEALS.push(d);
    }
    ['product', 'qty', 'targetRate', 'value', 'quoteId', 'reqId', 'offerId', 'saleIdx'].forEach(k => { if (o[k] != null && o[k] !== '') d[k] = o[k]; });
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
    const sale = Object.assign({ party: p.name, gstin: p.gstin || '', date: today(), product: 'Quick Lime', gstR: 5 }, v, { custId: p.id, quoteId: link.quoteId || null, offerId: link.offerId || null, dealId: link.dealId || null });
    const r = Q.addSale(sale);
    if (r && r.ok === false) return r;
    const idx = S.SALES.length - 1;
    if (link.quoteId) { const q = S.QUOTES.find(x => x.id === link.quoteId); if (q) { q.convertedSale = idx; setQuoteStatus(q.id, 'converted', { note: 'Invoice #' + sale.inv }); } }
    if (link.offerId) setOfferStatus(link.offerId, 'accepted', 'Invoice #' + sale.inv);
    const d = advanceDeal(p.id, 'order_confirmed', { product: sale.product, qty: sale.qty, targetRate: sale.rate, value: (+sale.qty || 0) * (+sale.rate || 0), quoteId: link.quoteId, offerId: link.offerId, saleIdx: idx });
    logEvent(p.id, 'order', { title: 'Order received — invoice #' + sale.inv, detail: sale.product + ' · ' + sale.qty + ' MT @ ₹' + Math.round(+sale.rate || 0).toLocaleString('en-IN') + '/MT', amount: (+sale.qty || 0) * (+sale.rate || 0) * (1 + (+sale.gstR || 0) / 100), ref: { type: 'sale', id: idx } });
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

  /* The register rows, plus the per-tonne rate the price history needs:
     salesRows() carries qty and the taxable value but not the rate, so it is
     derived (taxable ÷ qty — the invoice average on a multi-line bill) when the
     row itself does not say. */
  function salesForCrm() {
    return Q.salesRows().map(s => { const raw = S.SALES[s.idx] || {}; const rate = +raw.rate || (s.qty ? Math.round(s.taxable / s.qty) : 0); return Object.assign({}, s, { rate, product: s.product || raw.product || 'Quick Lime' }); });
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
