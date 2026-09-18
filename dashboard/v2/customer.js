/* ═══════════════════════════════════════════════════════════════════════
   customer.js — the Customer 360° profile. One page that answers, for one
   customer: who they are · what they buy · how much they need · what price
   they expect · what we offered · what they bought · when they will buy
   again · how much they owe · which quotations are open · who follows them
   · what to do next.

   Every figure is CustomerCore.enrich() over the real registers (one row of
   it — this customer). Every action is a CRMUI form writing through QLCRM;
   the page re-renders on the `crm:changed` event and holds no state of its
   own beyond which tab is open.
   ═══════════════════════════════════════════════════════════════════════ */
QLShell.mount({ active: 'customers', title: 'Customer' });
const Q = window.QLD, C = window.CustomerCore, M = window.QLCRM, U = window.CRMUI;
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons;
const toast = (m, t) => QLX.toast(m, t);
const fC = n => n == null ? '—' : '₹' + Math.round(+n).toLocaleString('en-IN');
/* a quantity prints WITH its unit, a rate WITH the unit it is per (units-core) */
const fQ = (qty, unit) => esc(C.fmtQty(qty, unit)), fRU = (rate, rateUnit, unit) => fC(rate) + ' / ' + esc(C.rateUnitOf(unit, rateUnit));
const fD = s => s ? Q.fDS(s) : '—';
const today = () => C.iso(new Date());
const qp = k => new URLSearchParams(location.search).get(k);
const TABS = [['overview', 'Overview'], ['reqs', 'Requirements'], ['quotes', 'Quotations & offers'], ['prices', 'Price history'], ['timeline', 'Timeline'], ['followups', 'Follow-ups'], ['comm', 'Communication'], ['notes', 'Notes'], ['docs', 'Documents'], ['finance', 'Financial']];
let ID = qp('id') || '', TAB = (location.hash || '').replace('#', '') || 'overview', TL = { q: '', kind: 'all' }, PH_PRODUCT = '';

function cust() { return M.enriched().find(r => r.id === ID) || null; }
function party() { return M.byId(ID); }
const relDays = n => n == null ? 'never' : n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 30 ? n + ' days ago' : n < 365 ? Math.round(n / 30) + ' months ago' : Math.round(n / 365) + ' years ago';

/* ── atoms ── */
const STATUS_TONE = { active: ['#dcfce7', '#166534'], new: ['#dbeafe', '#1d4ed8'], prospect: ['#f5f3ff', '#6d28d9'], inactive: ['#f1f5f9', '#475569'], blocked: ['#fee2e2', '#991b1b'] };
const pill = (t, bg, fg) => `<span class="crm-st" style="background:${bg};color:${fg}">${esc(t)}</span>`;
const statusPill = k => { const c = STATUS_TONE[k] || STATUS_TONE.active; return pill(C.labelOf(C.CUSTOMER_STATUS, k), c[0], c[1]); };
const segPill = k => { const c = C.SEGMENTS[k]; return c ? `<span class="crm-seg" style="--sb:${c.bg};--sf:${c.fg}"><i style="background:${c.dot}"></i>${c.label}</span>` : ''; };
const QT = { draft: ['#f1f5f9', '#475569'], sent: ['#dbeafe', '#1d4ed8'], viewed: ['#e0f2fe', '#0369a1'], negotiation: ['#fef3c7', '#b45309'], accepted: ['#dcfce7', '#166534'], rejected: ['#fee2e2', '#991b1b'], expired: ['#f1f5f9', '#64748b'], converted: ['#ede9fe', '#6d28d9'], saved: ['#f1f5f9', '#475569'] };
const qPill = (st, list) => { const c = QT[st] || QT.draft; return pill(C.labelOf(list || C.QUOTE_STATUS, st), c[0], c[1]); };
const healthColor = h => h >= 75 ? '#16a34a' : h >= 55 ? '#d97706' : '#dc2626';
function healthRing(h, sz) {
  sz = sz || 56; const c = healthColor(h), r = sz / 2 - 5, L = 2 * Math.PI * r;
  return `<div class="crm-ring" style="width:${sz}px;height:${sz}px"><svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}"><circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="var(--ql-neutral-150,#eef1f6)" stroke-width="5"/><circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${L.toFixed(1)}" stroke-dashoffset="${(L * (1 - h / 100)).toFixed(1)}" transform="rotate(-90 ${sz / 2} ${sz / 2})"/></svg><div class="crm-ring-v"><b style="color:${c};font-size:${sz * 0.3}px">${h}</b></div></div>`;
}
const kv = (l, v) => `<div><span>${l}</span><b>${v == null || v === '' ? '<i class="qx-mut">—</i>' : v}</b></div>`;
const box = (title, body, act, wide) => `<div class="cp-box${wide ? ' wide' : ''}"><div class="cp-box-h"><b>${title}</b>${act || ''}</div>${body}</div>`;
const btn = (label, act, primary, icon) => `<button class="ql-btn ${primary ? 'ql-btn-primary' : 'ql-btn-secondary'}" data-act="${act}">${icon ? svg(icon) : ''}${label}</button>`;
const empty = t => `<div class="cp-empty">${t}</div>`;
function sparkSVG(series, w, h) {
  if (!series || series.length < 2) return '';
  w = w || 320; h = h || 60; const vals = series.map(s => s.rate); const mn = Math.min(...vals), mx = Math.max(...vals), span = Math.max(1, mx - mn);
  const pts = series.map((s, i) => [i / (series.length - 1) * (w - 8) + 4, h - 6 - ((s.rate - mn) / span) * (h - 14)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return `<svg class="cp-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round"/>${pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="#2563eb"><title>${esc(series[i].date)} · ₹${series[i].rate}</title></circle>`).join('')}</svg>`;
}

/* ═══════════════════ HEADER + CARDS ═══════════════════ */
function headHTML(f, p) {
  const ph = U.phoneOf(p);
  const acts = [
    ['quote', 'New quotation', IC.doc2, true], ['offer', 'Send price offer', IC.share], ['order', 'Record order', IC.truck], ['payment', 'Record payment', IC.check],
    ['req', 'Add requirement', IC.plus], ...(ph ? [['wa', 'WhatsApp', IC.wa], ['call', 'Call', IC.call]] : []), ...(p.email ? [['mail', 'Email', IC.mail]] : []), ['followup', 'Add follow-up', IC.clock], ['note', 'Note', IC.comment], ['edit', 'Edit', IC.edit]
  ];
  return `<div class="cp-head">
    <div class="cp-head-id"><span class="crm-av" style="--av:#2563eb;width:52px;height:52px;font-size:19px">${esc((p.name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase())}</span>
      <div style="min-width:0"><div class="cp-name">${esc(p.name)} ${statusPill(f.statusEff)} ${segPill(f.seg)}${(f.tags || []).map(segPill).join('')}</div>
      <div class="cp-meta"><code>${esc(p.code || '—')}</code>${p.ctype ? '<span>' + esc(C.labelOf(C.CUSTOMER_TYPES, p.ctype)) + '</span>' : ''}${p.city || p.state ? '<span>' + esc([p.city, p.state].filter(Boolean).join(', ')) + '</span>' : ''}${p.gstin ? '<span>GSTIN ' + esc(p.gstin) + '</span>' : ''}<span>${p.salesperson ? 'Sales: <b>' + esc(p.salesperson) + '</b>' : '<i>no sales person assigned</i>'}</span></div></div></div>
    <div class="cp-health">${healthRing(f.health)}<div><div style="font:800 13px var(--ql-font-sans)">Health score</div><div class="qx-mut" style="font-size:12px">${esc(f.reliability)}${f.rhythm && f.rhythm.gapDays ? ' · orders every ~' + f.rhythm.gapDays + ' days' : ''}</div></div></div>
    <div class="cp-actions">${acts.map(a => btn(a[1], a[0], a[3], a[2])).join('')}</div></div>`;
}
function cardsHTML(f) {
  const cards = [
    ['Total orders', f.salesN, f.salesLast ? 'last ' + fD(f.salesLast) : 'none yet'],
    ['Total sales', fC(f.salesAmt), fC(f.salesPaid) + ' collected'],
    ['Outstanding', fC(f.salesDue), f.overdue > 0.5 ? fC(f.overdue) + ' overdue' : 'nothing overdue'],
    ['Last order', f.salesLast ? fD(f.salesLast) : '—', f.salesRec != null ? relDays(f.salesRec) : '—'],
    ['Average order', fC(f.avgOrder), f.rhythm && f.rhythm.gapDays ? 'every ~' + f.rhythm.gapDays + ' days' : '—'],
    ['Monthly requirement', f.monthlyDemand ? f.monthlyDemand + ' MT' : '—', f.monthlyPotential ? '≈ ' + fC(f.monthlyPotential) + '/month' : (f.demandSourceObserved ? 'from order rhythm' : 'no requirement recorded')],
    ['Open quotations', f.openQuotes, f.openQuoteValue ? fC(f.openQuoteValue) : (f.quotes.length + ' quotations in all')],
    ['Conversion', f.conversion == null ? '—' : f.conversion + '%', f.quotesWon + ' of ' + f.quotesDecided + ' decided']
  ];
  return `<div class="cp-cards">${cards.map(c => `<div class="cp-card"><span>${c[0]}</span><b>${c[1]}</b><small>${c[2]}</small></div>`).join('')}</div>`;
}
function tabsHTML(f) {
  const counts = { reqs: f.reqs.filter(r => r.status !== 'closed').length, quotes: f.quotes.length + f.offers.length, followups: f.openFollowups, notes: M.notesOf(ID).length, docs: M.docsOf(ID).length, timeline: M.eventsOf(ID).length + f.salesN };
  return `<div class="cp-tabs">${TABS.map(t => `<button class="cp-tab${TAB === t[0] ? ' on' : ''}" data-tab="${t[0]}">${t[1]}${counts[t[0]] ? `<span>${counts[t[0]]}</span>` : ''}</button>`).join('')}</div>`;
}

/* ═══════════════════ TABS ═══════════════════ */
function overviewHTML(f, p) {
  const ins = C.customerInsights(f, today());
  const demand = Object.values(f.demand || {});
  const insHTML = ins.length ? `<div class="cp-ins">${ins.map(i => `<div class="t-${i.tone}${i.rec ? ' rec' : ''}">${i.rec ? '➜' : '•'} <span>${esc(i.t)}</span></div>`).join('')}</div>` : empty('No history yet — record a requirement or an order and the insights appear here.');
  const demandHTML = demand.length ? demand.map(d => `<div class="cp-req"><div class="cp-req-h"><b>${esc(d.product)}</b>${d.monthlyDemand ? `<span class="crm-st" style="background:#ecfdf3;color:#15803d">${d.monthlyDemand} MT / month</span>` : ''}</div>
      <div class="cp-req-g">${[['Monthly demand', d.monthlyDemand ? d.monthlyDemand + ' MT (' + d.demandSource + ')' : '—'], ['Average order', d.avgOrderQty ? d.avgOrderQty + ' MT' : '—'], ['Last order', d.lastQty ? fQ(d.lastQty, 'Ton') + ' · ' + fD(d.lastDate) : '—'], ['Target rate', d.targetRate ? fRU(d.targetRate, d.rateUnit, 'Ton') : (d.lastRate ? fRU(d.lastRate, d.rateUnit, 'Ton') + ' (last sold)' : '—')], ['Purchase frequency', d.frequency ? 'every ~' + d.frequency + ' days' : (d.orders ? d.orders + ' order' + (d.orders > 1 ? 's' : '') + ' — not enough for a rhythm' : '—')], ['Next expected', d.nextWindow ? fD(d.nextWindow) + (d.rhythmStatus === 'overdue' ? ' <b style="color:#b45309">(passed)</b>' : d.rhythmStatus === 'due' ? ' <b style="color:#1d4ed8">(now)</b>' : '') : '—'], ['Monthly potential', d.monthlyPotential ? fC(d.monthlyPotential) : '—']].map(x => `<div><span>${x[0]}</span><br>${x[1]}</div>`).join('')}</div></div>`).join('') : empty('No demand recorded yet. Add a requirement, or it will be observed from orders.');
  const tl = C.timeline(f, M.eventsOf(ID), today()).slice(0, 6);
  return `<div class="cp-grid">
    ${box('What should I do next?', insHTML)}
    ${box('Demand intelligence', demandHTML, btn('+ Requirement', 'req'))}
    ${box('Contact', `<div class="cp-kv">${kv('Contact person', esc(p.contact))}${kv('Mobile', p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : '')}${kv('WhatsApp', p.wa ? esc(p.wa) : (p.phone ? 'same as mobile' : ''))}${kv('Email', p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '')}${kv('Alternate contact', esc(p.altContact))}${kv('Address', esc([p.address, p.city, p.state, p.pin, p.country].filter(Boolean).join(', ')))}</div>`, btn('Edit', 'edit'))}
    ${box('Business', `<div class="cp-kv">${kv('GSTIN', esc(p.gstin))}${kv('PAN', esc(p.pan || (p.gstin && p.gstin.length === 15 ? p.gstin.slice(2, 12) : '')))}${kv('IEC', esc(p.iec))}${kv('Customer since', fD(p.since))}${kv('Payment terms', esc(C.labelOf(C.PAYMENT_TERMS, p.payTerms)) + (p.payTermsNote ? ' — ' + esc(p.payTermsNote) : '') || (p.creditDays ? p.creditDays + ' days' : ''))}${kv('Credit limit', p.creditLimit ? fC(p.creditLimit) : '')}${kv('Transport', esc(C.labelOf(C.TRANSPORT, p.transport)))}${kv('Delivery location', esc(p.deliveryLoc))}</div>`)}
    ${box('Recent activity', tl.length ? tlListHTML(tl) : empty('Nothing yet.'), `<button class="ql-btn ql-btn-secondary" data-tab="timeline">All</button>`, true)}
  </div>`;
}
function reqsHTML(f) {
  const rs = f.reqs.slice().sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const body = rs.length ? rs.map((r, i) => `<div class="cp-req" data-req="${esc(r.id)}"><div class="cp-req-h"><b>Requirement #${i + 1} · ${esc(r.product)}</b><span>${r.status !== 'active' ? pill(r.status, '#f1f5f9', '#475569') + ' ' : ''}${btn('Quote', 'quote:' + r.id, false, IC.doc2)} ${btn('Offer', 'offer:' + r.id, false, IC.share)} ${btn('Edit', 'req:' + r.id, false, IC.edit)}</span></div>
    <div class="cp-req-g">${[['Quantity', C.fmtQty(r.qty, r.unit) + (r.freq === 'monthly' ? ' / month' : r.freq === 'weekly' ? ' / week' : ' one-time')], ['MOQ', r.moq ? C.fmtQty(r.moq, r.unit) : '—'], ['Target rate', r.targetRate ? C.fmtRate(r.targetRate, r.rateUnit, r.unit) : '—'], ['Preferred rate', r.prefRate ? C.fmtRate(r.prefRate, r.rateUnit, r.unit) : '—'], ['Last quoted', r.lastQuoted ? C.fmtRate(r.lastQuoted, r.rateUnit, r.unit) : '—'], ['Accepted rate', r.acceptedRate ? C.fmtRate(r.acceptedRate, r.rateUnit, r.unit) : '—'], ['CaO / MgO', [r.cao ? r.cao + '% CaO' : '', r.mgo ? r.mgo + '% MgO' : ''].filter(Boolean).join(' · ') || '—'], ['Reactivity', r.reactivity || '—'], ['Size / form', [r.size, C.labelOf(C.FORMS, r.form)].filter(Boolean).join(' · ') || '—'], ['Packaging', C.labelOf(C.PACKAGING, r.packaging) + (r.packagingNote ? ' — ' + r.packagingNote : '') || '—'], ['Delivery', [r.deliveryLoc, C.labelOf(C.TRANSPORT, r.transport), C.labelOf(C.FREIGHT, r.freight)].filter(Boolean).join(' · ') || '—'], ['Required by', [r.deliveryDate ? fD(r.deliveryDate) : '', r.deliveryFreq].filter(Boolean).join(' · ') || '—'], ['Payment', (C.labelOf(C.PAYMENT_TERMS, r.payment) + (r.paymentNote ? ' — ' + r.paymentNote : '')) || '—']].map(x => `<div><span>${x[0]}</span><br>${esc(x[1])}</div>`).join('')}</div>${r.notes ? `<div class="qx-mut" style="font-size:12.5px;margin-top:6px">${esc(r.notes)}</div>` : ''}</div>`).join('') : empty('No requirements recorded. Record what this customer normally wants — product, quantity, target rate, quality, packaging, delivery and payment.');
  return box('Demand & requirements', body, btn('+ Add requirement', 'req', true, IC.plus), true);
}
function quotesHTML(f) {
  const qs = f.quotes.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const os = f.offers.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const qBody = qs.length ? qs.map(q => { const t = C.quoteTotals(q); const st = C.effectiveQuoteStatus(q, today()); return `<div class="cp-row"><b class="cu-link" data-act="openq:${esc(q.id)}">${esc(q.no)}</b><span>${fD(q.date)}</span><span>${esc(M.lineSummary(q))}</span><span class="sp"></span><span><b>${fC(t.total)}</b></span>${qPill(st)}<span>${btn('Open', 'openq:' + q.id)}</span></div>`; }).join('') : empty('No quotations yet.');
  const oBody = os.length ? os.map(o => { const st = (o.status === 'sent' || o.status === 'saved') && o.validUntil < today() ? 'expired' : o.status; return `<div class="cp-row"><b>${esc(o.no)}</b><span>${fD(o.date)}</span><span>${esc(o.product)} · ${o.qty ? fQ(o.qty, o.unit) : '?'} @ <b>${fRU(o.rate, o.rateUnit, o.unit)}</b> · ${esc(C.labelOf(C.FREIGHT, o.freight))} · valid ${fD(o.validUntil)}</span><span class="sp"></span>${qPill(st, C.OFFER_STATUS)}<span>${o.via ? '<span class="qx-mut">' + esc(o.via) + '</span> ' : ''}${btn('Resend', 'resend:' + o.id)} ${st === 'sent' || st === 'saved' ? btn('Accepted', 'offerok:' + o.id) : ''} ${btn('Order', 'orderoffer:' + o.id)}</span></div>`; }).join('') : empty('No price offers yet.');
  return `<div class="cp-grid">${box('Quotations', qBody, btn('+ New quotation', 'quote', true, IC.doc2), true)}${box('Price offers', oBody, btn('+ Send price offer', 'offer', true, IC.share), true)}</div>`;
}
function pricesHTML(f) {
  const products = [...new Set([].concat(f.invoices.map(s => s.product || 'Quick Lime'), f.quotes.flatMap(q => (q.items || []).map(i => i.product)), f.offers.map(o => o.product)).filter(Boolean))];
  if (!PH_PRODUCT || !products.includes(PH_PRODUCT)) PH_PRODUCT = products[0] || '';
  const h = C.priceHistory(f.invoices, f.quotes, f.offers, PH_PRODUCT || null);
  const st = h.stats;
  const sel = products.length ? `<select class="qlf-input" id="cpPhProduct" style="width:auto">${products.map(p => `<option ${p === PH_PRODUCT ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>` : '';
  const stats = `<div class="cp-stats">${[['Current rate', st.current], ['Last rate', st.last], ['Average', st.avg], ['Lowest', st.lowest], ['Highest', st.highest], ['Last offered', st.lastOffered]].map(x => `<div class="cp-stat"><span>${x[0]}</span><b>${x[1] == null ? '—' : fC(x[1])}</b></div>`).join('')}</div>`;
  const rows = h.rows.length ? `<div class="cp-price"><table><thead><tr><th>Date</th><th class="n">Qty</th><th class="n">Rate</th><th>Status</th><th>Ref</th></tr></thead><tbody>${h.rows.map(r => `<tr><td>${fD(r.date)}</td><td class="n">${r.qty ? fQ(r.qty, r.unit) : '—'}</td><td class="n"><b>${fRU(r.rate, r.rateUnit, r.unit)}</b></td><td>${r.status === 'sold' ? pill('Sold', '#dcfce7', '#166534') : r.status === 'quoted' ? pill('Quoted · ' + C.labelOf(C.QUOTE_STATUS, r.sub), '#dbeafe', '#1d4ed8') : pill('Offered · ' + C.labelOf(C.OFFER_STATUS, r.sub), '#fef3c7', '#b45309')}</td><td class="qx-mut">${esc(r.ref)}</td></tr>`).join('')}</tbody></table></div>` : empty('No prices yet for this product.');
  return box('Price history' + (PH_PRODUCT ? ' — ' + esc(PH_PRODUCT) : ''), stats + (h.series.length > 1 ? `<div class="qx-mut" style="font-size:11.5px;margin-bottom:4px">Sold rate over time</div>${sparkSVG(h.series)}` : '') + rows, sel, true);
}
function tlListHTML(list) {
  const KIND_DOT = { invoice: '#2563eb', payment: '#16a34a', overdue: '#dc2626', quote_sent: '#7c3aed', offer_sent: '#7c3aed', requirement: '#0ea5e9', whatsapp: '#16a34a', email: '#2563eb', call: '#0f766e', note: '#f59e0b', complaint: '#dc2626', followup_done: '#16a34a', followup_due: '#b45309', order: '#2563eb', delivered: '#0ea5e9', price_request: '#f97316', price_revised: '#f97316' };
  let lastDay = '';
  return `<div class="cp-tl">${list.map(e => { const day = String(e.at).slice(0, 10); const head = day !== lastDay ? `<div class="cp-ev-d">${fD(day)}${day === today() ? ' · today' : ''}</div>` : ''; lastDay = day; return `<div class="cp-ev"><i style="background:${KIND_DOT[e.kind] || '#94a3b8'}"></i>${head}<div class="cp-ev-t"><span>${esc(e.title)}</span>${e.amount ? `<b>${fC(e.amount)}</b>` : ''}</div>${e.detail ? `<div class="cp-ev-s">${esc(e.detail)}</div>` : ''}${e.by ? `<div class="qx-mut" style="font-size:11px">${esc(e.by)} · ${esc(U.when(e.at))}</div>` : ''}</div>`; }).join('')}</div>`;
}
function timelineHTML(f) {
  const all = C.timeline(f, M.eventsOf(ID), today());
  const kinds = [...new Set(all.map(e => e.kind))];
  const list = C.filterTimeline(all, { q: TL.q, kind: TL.kind });
  const filt = `<div class="cp-tl-f"><input class="qlf-input" id="cpTlQ" placeholder="Search the timeline…" value="${esc(TL.q)}"><select class="qlf-input" id="cpTlKind"><option value="all">All events</option>${kinds.map(k => `<option value="${k}" ${TL.kind === k ? 'selected' : ''}>${esc(C.TIMELINE_KINDS[k] || k)}</option>`).join('')}</select><span class="qx-mut" style="align-self:center;font-size:12px">${list.length} of ${all.length}</span></div>`;
  return box('Timeline', filt + (list.length ? tlListHTML(list) : empty('Nothing matches.')), btn('+ Log a call / meeting', 'log', false, IC.plus), true);
}
function followupsHTML(f) {
  const b = C.followupBuckets(f.followups, today());
  const row = (x, tone) => `<div class="cp-row"><b style="color:${tone}">${fD(x.date)}${x.time ? ' ' + esc(x.time) : ''}</b><span>${esc(C.labelOf(C.FOLLOWUP_TYPES, x.type))}</span><span>${esc(x.notes || '')}${x.nextAction ? ' → ' + esc(x.nextAction) : ''}</span><span class="sp"></span><span class="qx-mut">${esc(x.assignee || '')}</span><span>${btn('Done', 'fudone:' + x.id, true, IC.check)} ${btn('Edit', 'fuedit:' + x.id)}</span></div>`;
  const done = f.followups.filter(x => x.status === 'done').sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt))).slice(0, 10);
  const body = (b.overdue.length ? `<div class="qx-sec-h" style="color:#dc2626">Overdue</div>` + b.overdue.map(x => row(x, '#dc2626')).join('') : '') + (b.today.length ? `<div class="qx-sec-h" style="color:#d97706">Today</div>` + b.today.map(x => row(x, '#d97706')).join('') : '') + (b.upcoming.length ? `<div class="qx-sec-h">Upcoming</div>` + b.upcoming.map(x => row(x, '#2563eb')).join('') : '') + (done.length ? `<div class="qx-sec-h">Completed</div>` + done.map(x => `<div class="cp-row"><b class="qx-mut">${fD(String(x.doneAt).slice(0, 10))}</b><span>${esc(C.labelOf(C.FOLLOWUP_TYPES, x.type))}</span><span>${esc(x.outcome || x.notes || '')}</span></div>`).join('') : '') || empty('No follow-ups. Schedule a call, a price follow-up or a payment reminder.');
  return box('Follow-ups', body, btn('+ Add follow-up', 'followup', true, IC.plus), true);
}
function commHTML(f, p) {
  const ev = M.eventsOf(ID).filter(e => ['whatsapp', 'email', 'call', 'meeting', 'offer_sent', 'quote_sent'].includes(e.kind)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const ph = U.phoneOf(p);
  const head = `<div class="cp-row" style="border:0"><span class="qx-mut">${ph ? 'WhatsApp / call ' + esc(ph) : 'No phone on file'}${p.email ? ' · ' + esc(p.email) : ''}</span><span class="sp"></span>${btn('WhatsApp', 'wa', true, IC.wa)} ${btn('Email', 'mail', false, IC.mail)} ${btn('Log call', 'log', false, IC.call)} ${btn('Templates', 'tpl', false, IC.comment)}</div><div class="qx-mut" style="font-size:12px;margin:0 0 10px">Messages open in WhatsApp or your mail app and are logged here as sent by you. Delivery and replies are not visible to this app.</div>`;
  return box('Communication', head + (ev.length ? tlListHTML(ev) : empty('No messages logged yet.')), '', true);
}
function notesHTML() {
  const ns = M.notesOf(ID);
  const body = ns.length ? ns.map(n => `<div class="cp-note${n.kind === 'complaint' ? ' complaint' : ''}">${n.pinned ? '📌 ' : ''}${esc(n.text)}<div class="cp-note-m"><span>${esc(n.by || '')} · ${esc(U.when(n.at))} · private</span><button data-act="pin:${esc(n.id)}">${n.pinned ? 'unpin' : 'pin'}</button><button data-act="noteedit:${esc(n.id)}">edit</button><button data-act="notedel:${esc(n.id)}">delete</button></div></div>`).join('') : empty('No internal notes. "Usually purchases at month-end", "Prefers 40 KG bags", "Always asks for freight-inclusive price" — write what the register cannot tell you.');
  return box('Internal notes', body, btn('+ Add note', 'note', true, IC.plus), true);
}
function docsHTML() {
  const ds = M.docsOf(ID);
  const body = ds.length ? ds.map(d => `<div class="cp-doc"><span class="k">${esc(C.labelOf(C.DOC_KINDS, d.kind))}</span><span class="n">${esc(d.label || d.name)}<span class="qx-mut"> · ${Math.round((d.size || 0) / 1024)} KB · ${fD(String(d.at).slice(0, 10))}</span></span><span class="a"><button data-act="docview:${esc(d.id)}">Preview</button><button data-act="docdl:${esc(d.id)}">Download</button><button data-act="docdel:${esc(d.id)}">Delete</button></span></div>`).join('') : empty('No documents. GST certificate, PAN, purchase orders, contracts, quality requirements, test reports.');
  return box('Documents', body, btn('+ Upload', 'doc', true, IC.plus), true);
}
function financeHTML(f, p) {
  const L = Q.partyLedger ? Q.partyLedger(f.idx) : null;
  const comp = f.hc || {};
  const bars = [['Payment behaviour', comp.payment, 25], ['Outstanding', comp.outstanding, 15], ['Order frequency', comp.frequency, 15], ['Revenue', comp.revenue, 15], ['Recent activity', comp.activity, 15], ['Quotation conversion', comp.conversion, 15]];
  const health = `<div class="crm-dhero" style="justify-content:center">${healthRing(f.health, 96)}</div>${bars.map(b => { const pct = Math.round((b[1] || 0) / b[2] * 100), col = pct >= 70 ? '#16a34a' : pct >= 45 ? '#d97706' : '#dc2626'; return `<div class="crm-comp"><div class="crm-comp-h"><span>${b[0]}</span><b>${Math.round(b[1] || 0)}/${b[2]}</b></div><div class="crm-hb-t"><div class="crm-hb-f" style="width:${pct}%;background:${col}"></div></div></div>`; }).join('')}`;
  const fin = `<div class="cp-kv">${kv('Total sales', fC(f.salesAmt))}${kv('Total orders', f.salesN)}${kv('Total paid', fC(f.salesPaid))}${kv('Outstanding', f.salesDue > 0.5 ? `<span style="color:var(--ql-danger-600)">${fC(f.salesDue)}</span>` : '₹0')}${kv('Overdue', f.overdue > 0.5 ? `<span style="color:var(--ql-danger-600)">${fC(f.overdue)}</span>` : '₹0')}${kv('Credit limit', f.creditLimit ? fC(f.creditLimit) : 'not set')}${kv('Available credit', f.availableCredit == null ? '' : fC(f.availableCredit))}${kv('Average payment days', f.avgPayDays == null ? '' : f.avgPayDays + ' days (terms ' + (f.creditDays || 30) + ')')}${kv('Last payment', f.lastPay ? fD(f.lastPay.date) + ' · ' + fC(f.lastPay.amount) : '')}${kv('Payment reliability', esc(f.reliability))}${kv('Running balance', L ? fC(L.closing) + (L.closing > 0.5 ? ' Dr' : L.closing < -0.5 ? ' Cr' : '') : '')}</div>`;
  const inv = f.invoices.length ? f.invoices.slice(0, 25).map(s => `<div class="cp-row"><b>#${esc(s.inv || '—')}</b><span>${fD(s.date)}</span><span>${esc(s.product || 'Quick Lime')} · ${fQ(s.qty, s.unit)} @ ${fRU(s.rate, s.rateUnit, s.unit)}</span><span class="sp"></span><span><b>${fC(s.total)}</b></span>${s.outstanding > 0.5 ? pill(fC(s.outstanding) + ' due', '#fee2e2', '#991b1b') : pill('Paid', '#dcfce7', '#166534')}</div>`).join('') : empty('No invoices yet.');
  return `<div class="cp-grid">${box('Financial intelligence', fin, `${btn('Record payment', 'payment', true, IC.check)} <a class="ql-btn ql-btn-secondary" href="ledger.html?party=${f.idx}">Statement</a>`)}${box('Health score', health)}${box('Orders / invoices (' + f.salesN + ')', inv, btn('Record order', 'order', false, IC.truck), true)}</div>`;
}

/* ═══════════════════ RENDER + WIRE ═══════════════════ */
function render() {
  const root = document.getElementById('cpRoot'); if (!root) return;
  const p = party();
  if (!ID || !p) { root.innerHTML = `<div class="cp-box"><div class="cp-empty">Customer not found. <a href="customers.html">Back to Customers</a></div></div>`; return; }
  const f = cust(); if (!f) return;
  QLShell.setBreadcrumb(p.name);
  document.title = p.name + ' — QuickLimes';
  const body = ({ overview: overviewHTML, reqs: reqsHTML, quotes: quotesHTML, prices: pricesHTML, timeline: timelineHTML, followups: followupsHTML, comm: commHTML, notes: notesHTML, docs: docsHTML, finance: financeHTML })[TAB] || overviewHTML;
  root.innerHTML = `<a class="cu-link qx-mut" href="customers.html" style="font-size:12.5px">‹ Customers</a>` + headHTML(f, p) + cardsHTML(f) + tabsHTML(f) + body(f, p);
  wire(f, p);
}
function wire(f, p) {
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { TAB = b.dataset.tab; history.replaceState(null, '', '#' + TAB); render(); });
  const q = document.getElementById('cpTlQ'); if (q) q.oninput = () => { TL.q = q.value; const pos = q.selectionStart; render(); const q2 = document.getElementById('cpTlQ'); if (q2) { q2.focus(); q2.setSelectionRange(pos, pos); } };
  const k = document.getElementById('cpTlKind'); if (k) k.onchange = () => { TL.kind = k.value; render(); };
  const ph = document.getElementById('cpPhProduct'); if (ph) ph.onchange = () => { PH_PRODUCT = ph.value; render(); };
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = e => { e.preventDefault(); act(b.dataset.act, f, p); });
}
async function act(a, f, p) {
  const [k, id] = a.split(':');
  const ref = () => render();
  switch (k) {
    case 'quote': return U.openQuoteEditor(ID, id ? { reqId: id } : {}, ref);
    case 'offer': { const r = id ? f.reqs.find(x => x.id === id) : null; return U.openOffer(ID, r ? { product: r.product, qty: r.qty, rate: r.targetRate || r.prefRate || '', freight: r.freight, payment: r.payment, deliveryLoc: r.deliveryLoc } : {}, ref); }
    case 'order': return U.openRecordOrder(ID, {}, ref);
    case 'orderoffer': return U.openRecordOrder(ID, { offerId: id }, ref);
    case 'payment': return U.openRecordPayment(ID, ref);
    case 'req': return U.openReqForm(ID, id || null, ref);
    case 'wa': return U.openComposer(ID, { channel: 'whatsapp' });
    case 'mail': return U.openComposer(ID, { channel: 'email', subject: 'From ' + (U.coProfile().short || '') });
    case 'call': M.logMessage(ID, 'call', 'Called ' + U.phoneOf(p)); location.href = 'tel:' + U.phoneOf(p); return;
    case 'log': return QLShell.openForm({ title: 'Log a call / meeting', sub: p.name, specs: [{ k: 'kind', label: 'What', type: 'select', opts: [['call', 'Call'], ['meeting', 'Meeting'], ['whatsapp', 'WhatsApp (sent outside the app)'], ['email', 'Email (sent outside the app)']] }, { k: 'text', label: 'What was said / agreed', type: 'textarea', full: true, req: true }, { k: 'price', label: 'Did they ask for a lower price?', type: 'select', opts: [['no', 'No'], ['yes', 'Yes']] }], initial: { kind: 'call', price: 'no' }, saveLabel: 'Log', onSave(v) { M.logMessage(ID, v.kind, v.text); if (v.price === 'yes') M.logEvent(ID, 'price_request', { detail: v.text.slice(0, 200) }); toast('Logged', 'ok'); render(); } });
    case 'followup': return U.openFollowupForm(ID, null, ref);
    case 'fuedit': return U.openFollowupForm(ID, id, ref);
    case 'fudone': return U.completeFollowup(id, ref);
    case 'note': return U.openNoteForm(ID, null, ref);
    case 'noteedit': return U.openNoteForm(ID, id, ref);
    case 'notedel': M.removeNote(id); toast('Note deleted'); return render();
    case 'pin': M.pinNote(id); return render();
    case 'doc': return U.openDocUpload(ID, ref);
    case 'docview': return U.openDoc(id, false);
    case 'docdl': { const d = M.docsOf(ID).find(x => x.id === id); return U.openDoc(id, true, d && d.name); }
    case 'docdel': return QLShell.confirmDelete({ title: 'Delete this document?', desc: 'It is removed from the server copy too.', confirmLabel: 'Delete', onConfirm: async () => { await M.removeDoc(ID, id); toast('Document deleted'); render(); } });
    case 'edit': return U.openCustomerForm(ID, ref);
    case 'openq': return U.openQuoteDoc(id);
    case 'resend': { const o = f.offers.find(x => x.id === id); return U.openComposer(ID, { channel: 'whatsapp', templateId: 'tpl_offer', vars: C.templateVars({ customer: p, offer: o, company: U.coProfile() }), ref: { type: 'offer', id }, onSent: via => M.markOfferSent(id, via) }); }
    case 'offerok': M.setOfferStatus(id, 'accepted'); toast('Offer marked accepted', 'ok'); return render();
    case 'tpl': return U.openTemplates();
  }
}
document.addEventListener('crm:changed', render);
window.__qlRefresh = render;
window.__qlOnSwitchCompany = () => { location.href = 'customers.html'; };
Q.init(() => { try { M.ensureIds(); } catch (_) {} render(); });
