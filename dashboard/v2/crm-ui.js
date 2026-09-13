/* ═══════════════════════════════════════════════════════════════════════
   crm-ui.js — every Customer 360° form and action, shared by the Customers
   workspace (customers.js) and the profile page (customer.js).

   Reads: CustomerCore (rules) · QLCRM (writes) · QLD (registers) · QLShell
   (modals) · WACore (phone → wa.me). Renders nothing on its own; each page
   calls CRMUI.* and refreshes itself through the `crm:changed` event.

   The one thing this file insists on: a message the app OPENS for the user
   (a WhatsApp draft, a mailto:) is logged as "sent by the user", never as
   "delivered" — nothing here can observe delivery, so nothing here claims it.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const Q = window.QLD, C = window.CustomerCore, M = window.QLCRM, D = window.QuoteDoc;
  const esc = s => (s == null ? '' : s).toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fC = n => '₹' + Math.round(+n || 0).toLocaleString('en-IN');
  const toast = (m, t) => (window.QLX && QLX.toast) ? QLX.toast(m, t) : QLShell.toast(m, t);
  const today = () => C.iso(new Date());
  const changed = (what) => { document.dispatchEvent(new CustomEvent('crm:changed', { detail: what || '' })); };
  const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const opts = list => list.map(x => [x[0], x[1]]);

  /* ── contact helpers ─────────────────────────────────────────────────── */
  function phoneOf(c) { return (c && (c.wa || c.phone)) || ''; }
  function waLink(c, text) {
    const ph = phoneOf(c);
    if (window.WACore && WACore.waLink) return WACore.waLink(ph, text || '');
    return 'https://wa.me/' + String(ph).replace(/\D/g, '') + '?text=' + encodeURIComponent(text || '');
  }
  function mailLink(c, subject, body) { return 'mailto:' + encodeURIComponent(c.email || '') + '?subject=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(body || ''); }
  function coProfile() { const co = (Q && Q.co) || {}; return { name: co.name || co.short, short: co.short || co.name, address: co.address, city: co.city, state: co.state, pin: co.pin, gstin: co.gstin, phone: co.phone, email: co.email }; }

  /* ═══════════════ CUSTOMER MASTER ═══════════════ */
  const SEG_TAGS = Object.keys(C.SEGMENTS).filter(k => !C.SEGMENTS[k].auto);
  function segChipsHTML(sel) {
    sel = new Set(sel || []);
    return '<div class="qlf-label">Segment tags <span style="font-weight:500;color:var(--ql-text-muted)">(the rest are computed)</span></div><div class="cu-tags">' +
      SEG_TAGS.map(k => `<label class="cu-tag${sel.has(k) ? ' on' : ''}"><input type="checkbox" data-seg="${k}" ${sel.has(k) ? 'checked' : ''}><i style="background:${C.SEGMENTS[k].dot}"></i>${esc(C.SEGMENTS[k].label)}</label>`).join('') + '</div>';
  }
  function customerSpecs(row) {
    const people = salespeople();
    return [
      { type: 'section', label: 'Basic information' },
      { k: 'name', label: 'Customer / company name', req: true, full: true, upper: true },
      { k: 'ctype', label: 'Customer type', type: 'select', opts: [['', '— select —']].concat(opts(C.CUSTOMER_TYPES)) },
      { k: 'cstatus', label: 'Status', type: 'select', opts: opts(C.CUSTOMER_STATUS) },
      { k: 'contact', label: 'Contact person' },
      { k: 'phone', label: 'Mobile number', type: 'tel' },
      { k: 'wa', label: 'WhatsApp number', type: 'tel', ph: 'if different from mobile' },
      { k: 'email', label: 'Email', type: 'email' },
      { k: 'altContact', label: 'Alternate contact', ph: 'name · number' },
      { k: 'address', label: 'Address', type: 'textarea', full: true },
      { k: 'city', label: 'City' }, { k: 'state', label: 'State' }, { k: 'country', label: 'Country' }, { k: 'pin', label: 'PIN code' },
      { type: 'section', label: 'Business information' },
      { k: 'gstin', label: 'GSTIN', upper: true, hint: 'Type it and the legal name, state and address fill from the GST portal.' },
      { k: 'pan', label: 'PAN', upper: true }, { k: 'iec', label: 'IEC (exporters)', upper: true },
      { k: 'code', label: 'Customer code', ph: 'auto', hint: 'Assigned automatically; change only if you keep your own numbering.' },
      { k: 'payTerms', label: 'Payment terms', type: 'select', opts: [['', '— select —']].concat(opts(C.PAYMENT_TERMS)) },
      { k: 'payTermsNote', label: 'Payment note', ph: 'e.g. 50% advance, balance on delivery' },
      { k: 'creditLimit', label: 'Credit limit (₹)', type: 'number', ph: '0 = none' },
      { k: 'creditDays', label: 'Credit days', type: 'number', ph: 'e.g. 30', hint: 'Invoice date + credit days = due date; overdue is measured from it.' },
      { k: 'transport', label: 'Transport preference', type: 'select', opts: [['', '— select —']].concat(opts(C.TRANSPORT)) },
      { k: 'deliveryLoc', label: 'Preferred delivery location' },
      { k: 'since', label: 'Customer since', type: 'date' },
      { k: 'salesperson', label: 'Assigned sales person', type: people.length ? 'searchselect' : 'text', opts: people.map(p => [p, p]), ph: 'name' },
      { type: 'html', html: segChipsHTML(row && row.segments) },
      { type: 'section', label: 'Messaging & account' },
      { k: 'lang', label: 'Preferred language', type: 'select', opts: [['en', 'English'], ['hi', 'हिन्दी Hindi']] },
      { k: 'autoRemind', label: 'Auto payment reminders', type: 'select', opts: [['yes', 'Yes'], ['no', 'No — never message this party']] },
      { k: 'opening', label: 'Opening balance (₹)', type: 'number', ph: '+ they owe you · − you owe them' },
      { k: 'industry', label: 'Industry (for the fit score)', type: 'select', opts: () => [['', 'Not set']].concat((window.ICPCore ? ICPCore.INDUSTRIES : []).map(i => [i.key, i.label])) },
      { k: 'notes', label: 'Notes', type: 'textarea', full: true }
    ];
  }
  function salespeople() {
    const set = new Set();
    Q.state.PARTIES.forEach(p => { if (p.salesperson) set.add(p.salesperson); });
    try { const p = JSON.parse(localStorage.getItem('ql_plant') || '{}'); if (p.owner_name) set.add(p.owner_name); } catch (_) {}
    return [...set].sort();
  }
  function openCustomerForm(id, after) {
    const row = id ? M.byId(id) : null;
    const initial = row ? Object.assign({}, row) : { type: 'customer', cstatus: 'new', country: 'India', since: today(), lang: 'en', autoRemind: 'yes', code: C.nextCode(Q.state.PARTIES) };
    QLShell.openForm({
      title: row ? 'Edit customer' : 'Add customer', sub: row ? row.name : 'Customer master', wide: true,
      specs: customerSpecs(row), initial, saveLabel: row ? 'Save changes' : 'Add customer',
      onSave(v) {
        v.segments = [...document.querySelectorAll('[data-seg]:checked')].map(x => x.dataset.seg);
        v.type = row ? (row.type || 'customer') : 'customer';
        const r = row ? M.updateCustomer(row.id, v) : M.addCustomer(v);
        if (!r.ok) { toast(r.reason || 'Could not save', 'err'); return false; }
        toast(row ? 'Customer updated' : 'Customer added', 'ok');
        changed('customer'); if (after) after(r.id);
      }
    });
    // tag chips toggle their own look
    document.querySelectorAll('.cu-tag input').forEach(i => i.addEventListener('change', () => i.closest('.cu-tag').classList.toggle('on', i.checked)));
  }

  /* pick a customer (for quick actions launched without one) */
  function pickCustomer(title, cb) {
    const list = M.customers().sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) { toast('Add a customer first', 'err'); return openCustomerForm(null, id => cb(id)); }
    QLShell.openForm({
      title: title || 'Which customer?', specs: [{ k: 'cust', label: 'Customer', type: 'searchselect', req: true, full: true, opts: list.map(p => [p.id, p.name + (p.city ? ' · ' + p.city : '')]), ph: 'Type to search…' }],
      initial: {}, saveLabel: 'Continue', onSave(v) { if (!v.cust) { toast('Choose a customer', 'err'); return false; } cb(v.cust); }
    });
  }
  const withCustomer = (id, title, fn) => id ? fn(id) : pickCustomer(title, fn);

  /* ═══════════════ REQUIREMENTS ═══════════════ */
  function reqSpecs() {
    return [
      { type: 'section', label: 'Product' },
      { k: 'product', label: 'Product', type: 'select', opts: opts(C.PRODUCTS) },
      { k: 'productOther', label: 'If other, name it' },
      { k: 'qty', label: 'Required quantity', type: 'number', req: true, reqNonZero: true },
      { k: 'unit', label: 'Unit', type: 'select', opts: opts(C.UNITS) },
      { k: 'freq', label: 'How often', type: 'select', opts: opts(C.REQ_FREQ) },
      { k: 'moq', label: 'Minimum order qty', type: 'number' },
      { type: 'section', label: 'Rates (₹ per MT)' },
      { k: 'prefRate', label: 'Preferred rate', type: 'number' }, { k: 'targetRate', label: 'Target rate', type: 'number' },
      { k: 'lastQuoted', label: 'Last quoted rate', type: 'number' }, { k: 'acceptedRate', label: 'Accepted rate', type: 'number' },
      { type: 'section', label: 'Quality' },
      { k: 'cao', label: 'Required CaO %', type: 'number' }, { k: 'mgo', label: 'Required MgO %', type: 'number' },
      { k: 'reactivity', label: 'Reactivity', ph: 'e.g. high / medium / °C rise' }, { k: 'size', label: 'Size / mesh', ph: 'e.g. 0–5 mm, 200 mesh' },
      { k: 'form', label: 'Powder / lump', type: 'select', opts: [['', '—']].concat(opts(C.FORMS)) },
      { k: 'packaging', label: 'Packaging', type: 'select', opts: [['', '—']].concat(opts(C.PACKAGING)) },
      { k: 'packagingNote', label: 'Packaging note', ph: 'if custom' },
      { type: 'section', label: 'Delivery' },
      { k: 'deliveryLoc', label: 'Delivery location' },
      { k: 'transport', label: 'Preferred transport', type: 'select', opts: [['', '—']].concat(opts(C.TRANSPORT)) },
      { k: 'freight', label: 'Freight', type: 'select', opts: opts(C.FREIGHT) },
      { k: 'deliveryDate', label: 'Required delivery date', type: 'date' },
      { k: 'deliveryFreq', label: 'Delivery frequency', ph: 'e.g. 2 trucks a week' },
      { type: 'section', label: 'Payment' },
      { k: 'payment', label: 'Payment terms', type: 'select', opts: [['', '—']].concat(opts(C.PAYMENT_TERMS)) },
      { k: 'paymentNote', label: 'Payment note' },
      { k: 'status', label: 'Requirement status', type: 'select', opts: [['active', 'Active'], ['fulfilled', 'Fulfilled'], ['closed', 'Closed']] },
      { k: 'notes', label: 'Notes', type: 'textarea', full: true }
    ];
  }
  function openReqForm(cust, reqId, after) {
    withCustomer(cust, 'Add a requirement for…', id => {
      const c = M.byId(id); const row = reqId ? Q.state.REQS.find(r => r.id === reqId) : null;
      const initial = row ? Object.assign({}, row) : { product: 'Quick Lime', unit: 'MT', freq: 'monthly', freight: 'extra', status: 'active', deliveryLoc: c.deliveryLoc || c.city || '', transport: c.transport || '', payment: c.payTerms || '' };
      QLShell.openForm({
        title: row ? 'Edit requirement' : 'Add requirement', sub: c.name, wide: true, specs: reqSpecs(), initial, saveLabel: row ? 'Save' : 'Add requirement',
        onSave(v) {
          if (v.product === 'Other' && v.productOther) v.product = v.productOther;
          const r = row ? M.updateReq(row.id, v) : M.addReq(id, v);
          if (!r.ok) { toast(r.reason || 'Could not save', 'err'); return false; }
          toast(row ? 'Requirement updated' : 'Requirement added', 'ok'); changed('req'); if (after) after(r.id || row.id);
        }
      });
    });
  }

  /* ═══════════════ QUOTATION EDITOR ═══════════════ */
  function lineRowHTML(it, i) {
    return `<tr data-line="${i}">
      <td><select class="qlf-input cu-in" data-f="product">${C.PRODUCTS.map(p => `<option value="${esc(p[0])}" ${it.product === p[0] ? 'selected' : ''}>${esc(p[1])}</option>`).join('')}${it.product && !C.PRODUCTS.some(p => p[0] === it.product) ? `<option value="${esc(it.product)}" selected>${esc(it.product)}</option>` : ''}</select></td>
      <td><input class="qlf-input cu-in n" data-f="qty" type="number" step="any" value="${esc(it.qty || '')}" placeholder="0"></td>
      <td><select class="qlf-input cu-in" data-f="unit">${C.UNITS.map(u => `<option value="${u[0]}" ${(it.unit || 'MT') === u[0] ? 'selected' : ''}>${u[0]}</option>`).join('')}</select></td>
      <td><input class="qlf-input cu-in n" data-f="rate" type="number" step="any" value="${esc(it.rate || '')}" placeholder="₹/MT"></td>
      <td><input class="qlf-input cu-in n" data-f="discount" type="number" step="any" value="${esc(it.discount || '')}" placeholder="₹"></td>
      <td class="n cu-amt">—</td>
      <td><button type="button" class="cu-x" data-del="${i}" title="Remove line">×</button></td></tr>`;
  }
  function readQuoteForm(body) {
    const g = k => { const el = body.querySelector('[data-q="' + k + '"]'); return el ? el.value : ''; };
    const items = [...body.querySelectorAll('tr[data-line]')].map(tr => {
      const v = f => { const el = tr.querySelector('[data-f="' + f + '"]'); return el ? el.value : ''; };
      return { product: v('product'), qty: +v('qty') || 0, unit: v('unit') || 'MT', rate: +v('rate') || 0, discount: +v('discount') || 0 };
    });
    return { date: g('date'), validUntil: g('validUntil'), items, freight: +g('freight') || 0, loading: +g('loading') || 0, other: +g('other') || 0, otherLabel: g('otherLabel'), gstR: +g('gstR'), isExport: g('gstR') === '0',
      paymentTerms: g('paymentTerms'), paymentNote: g('paymentNote'), deliveryTerms: g('deliveryTerms'), deliveryLoc: g('deliveryLoc'), transport: g('transport'), packaging: g('packaging'), spec: g('spec'), notes: g('notes'), reqId: g('reqId') || null };
  }
  function paintTotals(body) {
    const q = readQuoteForm(body); const t = C.quoteTotals(q);
    body.querySelectorAll('tr[data-line]').forEach((tr, i) => { const c = tr.querySelector('.cu-amt'); if (c) c.textContent = t.lines[i] ? D.money(t.lines[i].amount) : '—'; });
    const set = (k, v) => { const el = body.querySelector('[data-t="' + k + '"]'); if (el) el.textContent = v; };
    set('goods', D.money(t.goods)); set('taxable', D.money(t.taxable)); set('gst', D.money(t.gst) + ' (' + t.gstR + '%)'); set('total', D.money(t.total)); set('tonnes', t.tonnes + ' MT');
  }
  function openQuoteEditor(cust, o, after) {
    o = o || {};
    withCustomer(cust, 'Quotation for…', id => {
      const c = M.byId(id);
      const row = o.quoteId ? Q.state.QUOTES.find(q => q.id === o.quoteId) : null;
      const req = o.reqId ? Q.state.REQS.find(r => r.id === o.reqId) : null;
      const offer = o.offerId ? Q.state.OFFERS.find(x => x.id === o.offerId) : null;
      const q = row ? JSON.parse(JSON.stringify(row)) : {
        date: today(), validUntil: C.addDays(today(), 7), gstR: 5, freight: 0, loading: 0, other: 0,
        items: [req ? { product: req.product, qty: req.qty, unit: req.unit || 'MT', rate: req.targetRate || req.prefRate || '', discount: 0 } : offer ? { product: offer.product, qty: offer.qty, unit: offer.unit || 'MT', rate: offer.rate, discount: 0 } : { product: 'Quick Lime', qty: '', unit: 'MT', rate: '', discount: 0 }],
        paymentTerms: (req && req.payment) || (offer && offer.payment) || c.payTerms || '', deliveryTerms: (offer && offer.delivery) || 'Within 2–3 days of confirmation', deliveryLoc: (req && req.deliveryLoc) || (offer && offer.deliveryLoc) || c.deliveryLoc || c.city || '', transport: (req && req.transport) || c.transport || '', packaging: (req && req.packaging) || '', reqId: o.reqId || null
      };
      const sel = (k, list, cur, blank) => `<select class="qlf-input" data-q="${k}">${blank ? '<option value="">—</option>' : ''}${list.map(x => `<option value="${esc(x[0])}" ${String(cur) === String(x[0]) ? 'selected' : ''}>${esc(x[1])}</option>`).join('')}</select>`;
      const inp = (k, cur, type, ph) => `<input class="qlf-input" data-q="${k}" type="${type || 'text'}" value="${esc(cur == null ? '' : cur)}" placeholder="${esc(ph || '')}" ${type === 'number' ? 'step="any"' : ''}>`;
      const f = (label, ctrl, full) => `<div class="qlf-field${full ? ' qlf-full' : ''}"><label class="qlf-label">${label}</label>${ctrl}</div>`;
      const body = `<div class="qlf-grid">
        <div class="qlf-section"><span>Quotation${row ? ' ' + esc(row.no) : ''} · ${esc(c.name)}</span></div>
        ${f('Date', inp('date', q.date, 'date'))}${f('Valid until', inp('validUntil', q.validUntil, 'date'))}
        ${f('Payment terms', sel('paymentTerms', C.PAYMENT_TERMS, q.paymentTerms, true))}${f('Payment note', inp('paymentNote', q.paymentNote, 'text', 'e.g. 50% advance'))}
        ${f('Delivery terms', inp('deliveryTerms', q.deliveryTerms, 'text', 'e.g. within 2–3 days'))}${f('Delivery location', inp('deliveryLoc', q.deliveryLoc))}
        ${f('Transport', sel('transport', C.TRANSPORT, q.transport, true))}${f('Packaging', sel('packaging', C.PACKAGING, q.packaging, true))}
        ${f('Specification (prints under the product)', inp('spec', q.spec, 'text', 'e.g. CaO 85% min, 0–5 mm'), true)}
        <input type="hidden" data-q="reqId" value="${esc(q.reqId || '')}">
        <div class="qlf-section"><span>Lines</span></div>
        <div class="qlf-full"><div class="cu-tbl-wrap"><table class="cu-tbl"><thead><tr><th>Product</th><th class="n">Qty</th><th>Unit</th><th class="n">Rate</th><th class="n">Discount</th><th class="n">Amount</th><th></th></tr></thead><tbody id="cuLines">${q.items.map(lineRowHTML).join('')}</tbody></table></div>
        <button type="button" class="ql-btn ql-btn-secondary" id="cuAddLine" style="margin-top:8px">+ Add line</button></div>
        <div class="qlf-section"><span>Charges & tax</span></div>
        ${f('Freight (₹)', inp('freight', q.freight || '', 'number', '0'))}${f('Loading (₹)', inp('loading', q.loading || '', 'number', '0'))}
        ${f('Other charges (₹)', inp('other', q.other || '', 'number', '0'))}${f('Other charges label', inp('otherLabel', q.otherLabel, 'text', 'e.g. Packing'))}
        ${f('GST', sel('gstR', [['5', '5%'], ['12', '12%'], ['18', '18%'], ['0', 'Nil / export (LUT)']], q.isExport ? '0' : (q.gstR == null ? 5 : q.gstR)))}
        <div class="qlf-field"><label class="qlf-label">Totals</label><div class="cu-totals"><div><span>Goods</span><b data-t="goods">—</b></div><div><span>Taxable</span><b data-t="taxable">—</b></div><div><span>GST</span><b data-t="gst">—</b></div><div class="g"><span>Total</span><b data-t="total">—</b></div><div><span>Tonnage</span><b data-t="tonnes">—</b></div></div></div>
        ${f('Notes (print on the quotation)', `<textarea class="qlf-input" data-q="notes" rows="2">${esc(q.notes || '')}</textarea>`, true)}
      </div>`;
      const save = (bodyEl, thenPreview) => {
        const v = readQuoteForm(bodyEl);
        v.items = v.items.filter(it => it.qty > 0);
        if (!v.items.length) { toast('Add at least one line with a quantity', 'err'); return; }
        if (v.items.some(it => !(it.rate > 0))) { toast('Every line needs a rate', 'err'); return; }
        const r = row ? M.updateQuote(row.id, v) : M.addQuote(Object.assign({ cust: id, offerId: o.offerId || null }, v));
        if (!r.ok) { toast(r.reason || 'Could not save', 'err'); return; }
        const qid = row ? row.id : r.id;
        QLShell.closeModal(); toast(row ? 'Quotation saved' : 'Quotation ' + r.no + ' created', 'ok'); changed('quote');
        if (after) after(qid);
        if (thenPreview) openQuoteDoc(qid);
      };
      QLShell.panel({
        title: row ? 'Edit quotation ' + row.no : 'New quotation', sub: c.name + (c.code ? ' · ' + c.code : ''), wide: true, body,
        actions: [{ label: 'Cancel', onClick: () => QLShell.closeModal() }, { label: 'Save draft', onClick: b => save(b, false) }, { label: 'Save & preview', primary: true, onClick: b => save(b, true) }],
        onMount(b) {
          const wire = () => { b.querySelectorAll('.cu-in, [data-q]').forEach(el => { el.oninput = () => paintTotals(b); }); b.querySelectorAll('[data-del]').forEach(x => x.onclick = () => { x.closest('tr').remove(); paintTotals(b); }); };
          wire(); paintTotals(b);
          b.querySelector('#cuAddLine').onclick = () => { const tb = b.querySelector('#cuLines'); const i = tb.querySelectorAll('tr').length; tb.insertAdjacentHTML('beforeend', lineRowHTML({ product: 'Quick Lime', unit: 'MT' }, i)); wire(); paintTotals(b); };
        }
      });
    });
  }

  /* ═══════════════ QUOTATION DOCUMENT (preview · print · send) ═══════════════ */
  function printHTML(html, title) {
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print', 'err'); return; }
    w.document.open(); w.document.write(D.page(html, title)); w.document.close();
    w.onload = () => { try { w.focus(); w.print(); } catch (_) {} };
    setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 600);
  }
  function quoteLink(q) {
    /* The customer-facing link needs the server to sign it; the app asks once
       and caches the URL on the quotation. */
    return new Promise(res => {
      if (q.link) return res(q.link);
      let p = {}; try { p = JSON.parse(localStorage.getItem('ql_plant') || '{}'); } catch (_) {}
      fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'link', plant_id: p.id, company_id: Q.activeCo || '', token: p.token, quote: q.id }) })
        .then(r => r.json()).then(r => { if (r && r.ok && r.url) { q.link = r.url; Q.commit(); res(r.url); } else res(null); }).catch(() => res(null));
    });
  }
  /* The server counts opens of the customer link; a sent quotation that has
     been opened becomes "Viewed" — the one status change no human types. */
  function syncViews(q) {
    if (!q || !q.link || q.status !== 'sent') return;
    let p = {}; try { p = JSON.parse(localStorage.getItem('ql_plant') || '{}'); } catch (_) {}
    fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'views', plant_id: p.id, company_id: Q.activeCo || '', token: p.token, quotes: [q.id] }) })
      .then(r => r.json()).then(r => { const v = r && r.ok && r.views && r.views[q.id]; if (v && v.n > 0 && q.status === 'sent') { M.setQuoteStatus(q.id, 'viewed', { note: 'Link opened ' + v.n + ' time' + (v.n > 1 ? 's' : '') + ' (last ' + v.last + ' UTC)' }); changed('quote'); } }).catch(() => {});
  }
  function openQuoteDoc(quoteId) {
    const q = Q.state.QUOTES.find(x => x.id === quoteId); if (!q) return;
    syncViews(q);
    const c = M.byId(q.cust) || {};
    const st = C.effectiveQuoteStatus(q, today());
    const t = C.quoteTotals(q);
    const html = D.quotationHTML(q, c, coProfile(), { today: today(), showStatus: true });
    const statusSel = `<select class="qlf-input" id="cuQStatus" style="width:auto">${C.QUOTE_STATUS.map(s => `<option value="${s[0]}" ${st === s[0] ? 'selected' : ''}>${esc(s[1])}</option>`).join('')}</select>`;
    const bar = `<div class="cu-docbar">
      <div class="cu-docbar-l">${statusSel}<span class="qx-mut" style="font-size:12px">${q.history && q.history.length ? esc(q.history[q.history.length - 1].what) + ' · ' + esc(when(q.history[q.history.length - 1].at)) : ''}</span></div>
      <div class="cu-docbar-r">
        <button class="ql-btn ql-btn-secondary" data-a="wa">${svg(QLX.icons.wa)} WhatsApp</button>
        <button class="ql-btn ql-btn-secondary" data-a="mail">${svg(QLX.icons.mail)} Email</button>
        <button class="ql-btn ql-btn-secondary" data-a="link">${svg(QLX.icons.share)} Copy link</button>
        <button class="ql-btn ql-btn-secondary" data-a="print">${svg(QLX.icons.print)} PDF / Print</button>
        <button class="ql-btn ql-btn-secondary" data-a="dup">${svg(QLX.icons.copy)} Duplicate</button>
        <button class="ql-btn ql-btn-secondary" data-a="revise">${svg(QLX.icons.edit)} Revise</button>
        ${st === 'draft' || st === 'negotiation' ? `<button class="ql-btn ql-btn-secondary" data-a="edit">Edit</button>` : ''}
        ${st !== 'converted' ? `<button class="ql-btn ql-btn-primary" data-a="order">${svg(QLX.icons.check)} Record order</button>` : ''}
      </div></div>`;
    const hist = (q.history || []).slice().reverse().map(h => `<div class="cu-hist"><span>${esc(when(h.at))}</span><b>${esc(h.what)}</b><i>${esc(h.by || '')}${h.via ? ' · ' + esc(h.via) : ''}</i></div>`).join('');
    QLShell.panel({
      title: 'Quotation ' + q.no, sub: c.name + ' · ' + fC(t.total) + ' incl. GST', wide: true,
      body: bar + `<div class="cu-doc-frame"><style>${D.CSS}</style>${html}</div><div class="qx-sec-h" style="margin-top:14px">History</div><div class="cu-hists">${hist || '<span class="qx-mut">—</span>'}</div>`,
      actions: [{ label: 'Close', onClick: () => QLShell.closeModal() }],
      onMount(b) {
        b.querySelector('#cuQStatus').onchange = e => {
          const v = e.target.value;
          if (v === 'negotiation') return QLShell.openForm({
            title: 'Negotiation', sub: 'What did ' + (c.name || 'the customer') + ' ask for?',
            specs: [{ k: 'ask', label: 'They asked for', type: 'select', full: true, opts: [['price', 'A lower price'], ['terms', 'Different payment / delivery terms'], ['qty', 'A different quantity'], ['other', 'Something else']] }, { k: 'note', label: 'Note', type: 'textarea', full: true }],
            initial: { ask: 'price' }, saveLabel: 'Save',
            onSave(nv) { M.setQuoteStatus(q.id, v, { note: nv.note, priceRequest: nv.ask === 'price' }); changed('quote'); openQuoteDoc(q.id); }
          });
          if (v === 'rejected') return askNote('Why was it rejected?', 'Reason (helps the price history)', note => { M.setQuoteStatus(q.id, v, { note }); changed('quote'); openQuoteDoc(q.id); });
          M.setQuoteStatus(q.id, v, {}); changed('quote'); openQuoteDoc(q.id);
        };
        b.querySelectorAll('[data-a]').forEach(btn => btn.onclick = async () => {
          const a = btn.dataset.a;
          if (a === 'print') return printHTML(html, 'Quotation ' + q.no);
          if (a === 'edit') return openQuoteEditor(q.cust, { quoteId: q.id }, () => openQuoteDoc(q.id));
          if (a === 'dup') { const r = M.duplicateQuote(q.id); toast('Duplicated as ' + r.no, 'ok'); changed('quote'); return openQuoteEditor(q.cust, { quoteId: r.id }, () => openQuoteDoc(r.id)); }
          if (a === 'revise') { const r = M.reviseQuote(q.id); toast('Revision ' + r.no + ' created — edit and send it', 'ok'); changed('quote'); return openQuoteEditor(q.cust, { quoteId: r.id }, () => openQuoteDoc(r.id)); }
          if (a === 'order') return openRecordOrder(q.cust, { quoteId: q.id });
          if (a === 'link') {
            const url = await quoteLink(q);
            if (!url) return toast('The server could not sign a link (is the backend deployed?)', 'err');
            try { await navigator.clipboard.writeText(url); toast('Link copied', 'ok'); } catch (_) { window.prompt('Copy this link', url); }
            return;
          }
          if (a === 'wa' || a === 'mail') {
            const link = await quoteLink(q);
            const vars = C.templateVars({ customer: c, quote: Object.assign({}, q, { link: link || '' }), company: coProfile() });
            openComposer(q.cust, { channel: a === 'wa' ? 'whatsapp' : 'email', templateId: 'tpl_quote', vars, subject: 'Quotation ' + q.no + ' — ' + (coProfile().short || ''), ref: { type: 'quote', id: q.id }, onSent(via) { M.setQuoteStatus(q.id, 'sent', { via }); changed('quote'); } });
          }
        });
      }
    });
  }
  function when(iso) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return String(iso); return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); }
  function askNote(title, label, cb) {
    QLShell.openForm({ title, specs: [{ k: 'note', label, type: 'textarea', full: true }], initial: {}, saveLabel: 'Save', onSave(v) { cb(v.note || ''); } });
  }

  /* ═══════════════ QUICK PRICE OFFER ═══════════════ */
  function openOffer(cust, pre, after) {
    pre = pre || {};
    withCustomer(cust, 'Send a price offer to…', id => {
      const c = M.byId(id);
      const reqs = M.reqsOf(id).filter(r => r.status !== 'closed');
      const r0 = reqs[0] || {};
      const fRow = M.enriched().find(x => x.id === id) || { invoices: [] };
      const hist = C.priceHistory(fRow.invoices, M.quotesOf(id), M.offersOf(id), null);
      const lastRate = hist.stats.lastOffered || hist.stats.current || '';
      const o = Object.assign({ product: r0.product || 'Quick Lime', qty: r0.qty || '', unit: 'MT', rate: r0.targetRate || lastRate || '', freight: r0.freight || 'extra', gstText: 'As applicable', validDays: 3, delivery: 'Within 2–3 days', payment: r0.payment || c.payTerms || 'against_delivery', deliveryLoc: r0.deliveryLoc || c.deliveryLoc || c.city || '' }, pre);
      const specs = [
        { k: 'product', label: 'Product', type: 'select', opts: opts(C.PRODUCTS) },
        { k: 'qty', label: 'Quantity (MT)', type: 'number' },
        { k: 'rate', label: 'Offer price ₹/MT', type: 'number', req: true, reqNonZero: true, hint: hist.stats.current ? 'Last sold ₹' + hist.stats.current + (hist.stats.lastOffered ? ' · last offered ₹' + hist.stats.lastOffered : '') : (hist.stats.lastOffered ? 'Last offered ₹' + hist.stats.lastOffered : 'No price history yet') },
        { k: 'freight', label: 'Freight', type: 'select', opts: opts(C.FREIGHT) },
        { k: 'gstText', label: 'GST', ph: 'As applicable' },
        { k: 'validDays', label: 'Validity (days)', type: 'number' },
        { k: 'delivery', label: 'Delivery', ph: 'Within 2–3 days' },
        { k: 'payment', label: 'Payment', type: 'select', opts: opts(C.PAYMENT_TERMS) },
        { k: 'deliveryLoc', label: 'Delivery location', full: true },
        { k: 'notes', label: 'Note (optional)', type: 'textarea', full: true },
        { type: 'html', html: '<div class="qlf-label">Message preview</div><pre class="cu-preview" id="cuOfferPrev"></pre>' }
      ];
      const preview = () => {
        const v = readSpecs(specs);
        v.validUntil = C.addDays(today(), +v.validDays || 3);
        const vars = C.templateVars({ customer: c, offer: v, company: coProfile() });
        const tpl = M.templates().find(t => t.id === 'tpl_offer');
        const el = document.getElementById('cuOfferPrev'); if (el) el.textContent = C.fillTemplate(tpl ? tpl.body : '', vars);
      };
      const send = (via) => {
        const v = readSpecs(specs);
        if (!(+v.rate > 0)) { toast('Offer price is required', 'err'); return false; }
        v.validUntil = C.addDays(today(), +v.validDays || 3);
        const r = M.addOffer(Object.assign({ cust: id }, v), via === 'save' ? '' : via === 'pdf' ? '' : via);
        if (!r.ok) { toast(r.reason || 'Could not save', 'err'); return false; }
        const offer = Q.state.OFFERS.find(x => x.id === r.id);
        const vars = C.templateVars({ customer: c, offer, company: coProfile() });
        const tpl = M.templates().find(t => t.id === 'tpl_offer');
        const text = C.fillTemplate(tpl ? tpl.body : '', vars);
        if (via === 'whatsapp') { if (!phoneOf(c)) toast('No WhatsApp number on file — the picker will open', 'err'); window.open(waLink(c, text), '_blank', 'noopener'); M.logMessage(id, 'whatsapp', text, { type: 'offer', id: r.id }); }
        if (via === 'email') { if (!c.email) toast('No email on file — fill it in your mail app', 'err'); window.open(mailLink(c, 'Price offer ' + r.no + ' — ' + (coProfile().short || ''), text), '_self'); M.logMessage(id, 'email', text, { type: 'offer', id: r.id }); }
        if (via === 'pdf') printHTML(D.offerHTML(offer, c, coProfile()), 'Price offer ' + r.no);
        toast(via === 'save' ? 'Offer saved (' + r.no + ')' : 'Offer ' + r.no + ' ' + (via === 'pdf' ? 'generated' : 'sent by ' + via) + ' — logged on the timeline', 'ok');
        changed('offer'); QLShell.closeModal(); if (after) after(r.id);
      };
      QLShell.openForm({ title: 'Send price offer', sub: c.name + (phoneOf(c) ? ' · ' + phoneOf(c) : ' · no phone on file'), wide: true, specs, initial: o, saveLabel: 'Save offer', onSave() { send('save'); return false; } });
      // extra send buttons beside Save
      const foot = document.querySelector('#qlModal .ql-modal-foot');
      if (foot) {
        const mk = (label, via, cls) => { const b = document.createElement('button'); b.className = 'ql-btn ' + (cls || 'ql-btn-secondary'); b.innerHTML = label; b.onclick = () => send(via); return b; };
        foot.insertBefore(mk(svg(QLX.icons.print) + ' Generate PDF', 'pdf'), foot.lastElementChild);
        foot.insertBefore(mk(svg(QLX.icons.mail) + ' Send Email', 'email'), foot.lastElementChild);
        foot.insertBefore(mk(svg(QLX.icons.wa) + ' Send WhatsApp', 'whatsapp', 'ql-btn-primary'), foot.lastElementChild);
      }
      document.querySelectorAll('#qlModal .qlf-input').forEach(el => el.addEventListener('input', preview));
      preview();
    });
  }
  function readSpecs(specs) {
    const out = {};
    specs.forEach(f => { if (!f.k) return; const el = document.getElementById('qf_' + f.k); if (!el) return; out[f.k] = f.type === 'number' ? (parseFloat(el.value) || 0) : String(el.value || '').trim(); });
    return out;
  }

  /* ═══════════════ MESSAGE COMPOSER (templates → WhatsApp / email) ═══════════════ */
  function openComposer(cust, o) {
    o = o || {};
    withCustomer(cust, 'Message…', id => {
      const c = M.byId(id);
      const f = M.enriched().find(x => x.id === id) || {};
      const vars = Object.assign(C.templateVars({ customer: Object.assign({}, c, { salesDue: f.salesDue, salesLast: f.salesLast }), company: coProfile() }), o.vars || {});
      const tpls = M.templates();
      let channel = o.channel || 'whatsapp';
      const tplSel = `<select class="qlf-input" id="cuTpl"><option value="">— blank —</option>${tpls.map(t => `<option value="${esc(t.id)}" ${o.templateId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
      const body = `<div class="qlf-grid">
        <div class="qlf-field"><label class="qlf-label">Template</label>${tplSel}</div>
        <div class="qlf-field"><label class="qlf-label">Channel</label><div class="cu-seg"><button type="button" data-ch="whatsapp" class="${channel === 'whatsapp' ? 'on' : ''}">WhatsApp</button><button type="button" data-ch="email" class="${channel === 'email' ? 'on' : ''}">Email</button><button type="button" data-ch="copy" class="${channel === 'copy' ? 'on' : ''}">Copy</button></div></div>
        <div class="qlf-field qlf-full" id="cuSubjWrap" ${channel === 'email' ? '' : 'hidden'}><label class="qlf-label">Subject</label><input class="qlf-input" id="cuSubj" value="${esc(o.subject || '')}"></div>
        <div class="qlf-field qlf-full"><label class="qlf-label">Message</label><textarea class="qlf-input" id="cuMsg" rows="12"></textarea><div class="qlf-hint">Variables were filled from the customer record. Edit freely; what you send is logged on the timeline.</div></div>
        <div class="qlf-full qx-mut" style="font-size:12px">To: <b>${esc(channel === 'email' ? (c.email || 'no email on file') : (phoneOf(c) || 'no number on file'))}</b></div>
      </div>`;
      const fill = (b) => { const t = tpls.find(x => x.id === b.querySelector('#cuTpl').value); b.querySelector('#cuMsg').value = t ? C.fillTemplate(t.body, vars) : (o.text || ''); };
      QLShell.panel({
        title: 'Send message', sub: c.name, wide: true, body,
        actions: [{ label: 'Cancel', onClick: () => QLShell.closeModal() }, { label: 'Send', primary: true, onClick: b => {
          const text = b.querySelector('#cuMsg').value.trim(); if (!text) return toast('Nothing to send', 'err');
          if (channel === 'whatsapp') { window.open(waLink(c, text), '_blank', 'noopener'); M.logMessage(id, 'whatsapp', text, o.ref); }
          else if (channel === 'email') { window.open(mailLink(c, b.querySelector('#cuSubj').value, text), '_self'); M.logMessage(id, 'email', text, o.ref); }
          else { navigator.clipboard && navigator.clipboard.writeText(text); M.logMessage(id, 'whatsapp', '[copied] ' + text, o.ref); }
          if (o.onSent) o.onSent(channel);
          toast(channel === 'copy' ? 'Copied and logged' : 'Opened in ' + (channel === 'email' ? 'your mail app' : 'WhatsApp') + ' — logged on the timeline', 'ok');
          changed('message'); QLShell.closeModal();
        } }],
        onMount(b) {
          fill(b);
          b.querySelector('#cuTpl').onchange = () => fill(b);
          b.querySelectorAll('[data-ch]').forEach(x => x.onclick = () => { channel = x.dataset.ch; b.querySelectorAll('[data-ch]').forEach(y => y.classList.toggle('on', y === x)); b.querySelector('#cuSubjWrap').hidden = channel !== 'email'; });
        }
      });
    });
  }
  function openTemplates() {
    const tpls = M.templates();
    const rows = tpls.map(t => `<div class="cu-tpl"><div><b>${esc(t.name)}</b> <span class="qx-mut">${esc(t.channel)}${t.builtin ? ' · built-in' : ''}</span><pre>${esc(t.body)}</pre></div><div class="cu-tpl-a"><button class="ql-btn ql-btn-secondary" data-edit="${esc(t.id)}">Edit</button>${t.builtin ? '' : `<button class="ql-btn ql-btn-secondary" data-del="${esc(t.id)}">Delete</button>`}</div></div>`).join('');
    QLShell.panel({
      title: 'Message templates', sub: 'Variables: {{customer_name}} {{contact_person}} {{product}} {{rate}} {{quantity}} {{unit}} {{location}} {{payment_terms}} {{validity}} {{delivery}} {{freight}} {{gst}} {{quote_no}} {{total}} {{outstanding}} {{last_order}} {{company}} {{link}}', wide: true,
      body: `<div class="cu-tpls">${rows}</div>`,
      actions: [{ label: 'Close', onClick: () => QLShell.closeModal() }, { label: '+ New template', primary: true, onClick: () => editTemplate(null) }],
      onMount(b) {
        b.querySelectorAll('[data-edit]').forEach(x => x.onclick = () => editTemplate(x.dataset.edit));
        b.querySelectorAll('[data-del]').forEach(x => x.onclick = () => { M.removeTemplate(x.dataset.del); toast('Template deleted'); openTemplates(); });
      }
    });
  }
  function editTemplate(id) {
    const t = id ? M.templates().find(x => x.id === id) : null;
    QLShell.openForm({
      title: t ? 'Edit template' : 'New template', specs: [{ k: 'name', label: 'Name', req: true }, { k: 'channel', label: 'Channel', type: 'select', opts: [['whatsapp', 'WhatsApp'], ['email', 'Email'], ['any', 'Any']] }, { k: 'body', label: 'Message', type: 'textarea', full: true, req: true }],
      initial: t || { channel: 'whatsapp', body: 'Hello {{customer_name}},\n\n\n\nRegards,\n{{company}}' }, saveLabel: 'Save template',
      onSave(v) { const r = M.saveTemplate(Object.assign({ id: t ? t.id : null }, v)); if (!r.ok) { toast(r.reason, 'err'); return false; } toast('Template saved', 'ok'); openTemplates(); }
    });
  }

  /* ═══════════════ FOLLOW-UPS ═══════════════ */
  function openFollowupForm(cust, id, after) {
    withCustomer(cust, 'Follow-up for…', cid => {
      const c = M.byId(cid); const row = id ? Q.state.FOLLOWUPS.find(f => f.id === id) : null;
      const people = salespeople();
      QLShell.openForm({
        title: row ? 'Edit follow-up' : 'Add follow-up', sub: c.name,
        specs: [
          { k: 'date', label: 'Date', type: 'date', req: true }, { k: 'time', label: 'Time', type: 'time' },
          { k: 'type', label: 'Type', type: 'select', opts: opts(C.FOLLOWUP_TYPES) },
          { k: 'assignee', label: 'Assigned to', type: people.length ? 'searchselect' : 'text', opts: people.map(p => [p, p]) },
          { k: 'notes', label: 'Notes', type: 'textarea', full: true, ph: 'what to talk about' },
          { k: 'nextAction', label: 'Next action', full: true, ph: 'e.g. send revised quote after the call' }
        ],
        initial: row || { date: today(), type: 'call', assignee: c.salesperson || M.who() }, saveLabel: row ? 'Save' : 'Add follow-up',
        onSave(v) { const r = row ? M.updateFollowup(row.id, v) : M.addFollowup(Object.assign({ cust: cid }, v)); if (!r.ok) { toast(r.reason || 'Could not save', 'err'); return false; } toast(row ? 'Follow-up updated' : 'Follow-up added', 'ok'); changed('followup'); if (after) after(); }
      });
    });
  }
  function completeFollowup(id, after) {
    const f = Q.state.FOLLOWUPS.find(x => x.id === id); if (!f) return;
    QLShell.openForm({
      title: 'Complete follow-up', sub: (M.byId(f.cust) || {}).name + ' · ' + C.labelOf(C.FOLLOWUP_TYPES, f.type),
      specs: [{ k: 'outcome', label: 'Outcome', type: 'textarea', full: true, ph: 'what was said / agreed' }, { type: 'section', label: 'Schedule the next one (optional)' }, { k: 'nextDate', label: 'Next follow-up date', type: 'date' }, { k: 'nextNotes', label: 'Next action', full: true }],
      initial: {}, saveLabel: 'Mark done',
      onSave(v) { M.completeFollowup(id, v.outcome, v.nextDate ? { date: v.nextDate, notes: v.nextNotes } : null); toast('Follow-up completed', 'ok'); changed('followup'); if (after) after(); }
    });
  }

  /* ═══════════════ NOTES ═══════════════ */
  function openNoteForm(cust, noteId, after) {
    withCustomer(cust, 'Note for…', cid => {
      const c = M.byId(cid); const row = noteId ? Q.state.CNOTES.find(n => n.id === noteId) : null;
      QLShell.openForm({
        title: row ? 'Edit note' : 'Add internal note', sub: c.name + ' · private, never sent to the customer',
        specs: [{ k: 'text', label: 'Note', type: 'textarea', full: true, req: true, ph: 'e.g. Usually purchases at month-end. Prefers 40 KG bags.' }, { k: 'kind', label: 'Kind', type: 'select', opts: [['note', 'Note'], ['complaint', 'Complaint / issue']] }],
        initial: row || { kind: 'note' }, saveLabel: 'Save note',
        onSave(v) { if (row) M.updateNote(row.id, v.text); else { const r = M.addNote(cid, v.text, { kind: v.kind }); if (!r.ok) { toast('Note is empty', 'err'); return false; } } toast('Note saved', 'ok'); changed('note'); if (after) after(); }
      });
    });
  }

  /* ═══════════════ DOCUMENTS ═══════════════ */
  function openDocUpload(cust, after) {
    withCustomer(cust, 'Document for…', cid => {
      const c = M.byId(cid);
      QLShell.panel({
        title: 'Add document', sub: c.name,
        body: `<div class="qlf-grid"><div class="qlf-field"><label class="qlf-label">Kind</label><select class="qlf-input" id="cuDocKind">${C.DOC_KINDS.map(k => `<option value="${k[0]}">${esc(k[1])}</option>`).join('')}</select></div><div class="qlf-field"><label class="qlf-label">Label (optional)</label><input class="qlf-input" id="cuDocLabel" placeholder="e.g. PO 4471 dated 12 Sep"></div><div class="qlf-field qlf-full"><label class="qlf-label">File</label><input type="file" id="cuDocFile" accept="application/pdf,image/jpeg,image/png,image/webp"><div class="qlf-hint">PDF, JPG, PNG or WebP up to ~6 MB. Stored on the server, so it opens from any device.</div></div></div>`,
        actions: [{ label: 'Cancel', onClick: () => QLShell.closeModal() }, { label: 'Upload', primary: true, onClick: async b => {
          const file = b.querySelector('#cuDocFile').files[0]; if (!file) return toast('Choose a file', 'err');
          const btn = b.parentElement.querySelector('[data-pact="1"]'); if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
          const r = await M.attachDoc(cid, file, b.querySelector('#cuDocKind').value, b.querySelector('#cuDocLabel').value);
          if (!r.ok) { if (btn) { btn.disabled = false; btn.textContent = 'Upload'; } return toast(r.reason || 'Upload failed', 'err'); }
          toast('Document added', 'ok'); changed('doc'); QLShell.closeModal(); if (after) after();
        } }]
      });
    });
  }
  async function openDoc(id, download, name) {
    const blob = await M.fetchDoc(id);
    if (!blob) return toast('The file could not be fetched from the server', 'err');
    const url = URL.createObjectURL(blob);
    if (download) { const a = document.createElement('a'); a.href = url; a.download = name || 'document'; document.body.appendChild(a); a.click(); a.remove(); }
    else window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* ═══════════════ RECORD ORDER (→ GST invoice row) ═══════════════ */
  function openRecordOrder(cust, link, after) {
    link = link || {};
    withCustomer(cust, 'Record an order for…', cid => {
      const c = M.byId(cid);
      const q = link.quoteId ? Q.state.QUOTES.find(x => x.id === link.quoteId) : null;
      const of = link.offerId ? Q.state.OFFERS.find(x => x.id === link.offerId) : null;
      const it = q ? (q.items[0] || {}) : (of || {});
      const nextInv = (() => { let mx = 0; Q.state.SALES.forEach(s => { const n = parseInt(String(s.inv || '').replace(/\D/g, ''), 10); if (n > mx) mx = n; }); return mx ? String(mx + 1) : ''; })();
      QLShell.openForm({
        title: 'Record order', sub: c.name + (q ? ' · from ' + q.no : of ? ' · from offer ' + of.no : ''),
        specs: [
          { k: 'inv', label: 'Invoice no.', req: true, upper: true }, { k: 'date', label: 'Date', type: 'date', req: true },
          { k: 'product', label: 'Product', type: 'select', opts: opts(C.PRODUCTS).concat(it.product && !C.PRODUCTS.some(p => p[0] === it.product) ? [[it.product, it.product]] : []) },
          { k: 'qty', label: 'Qty (MT)', type: 'number', req: true, reqNonZero: true }, { k: 'rate', label: 'Rate (₹/MT)', type: 'number', req: true, reqNonZero: true },
          { k: 'gstR', label: 'GST rate', type: 'select', opts: [['5', '5%'], ['12', '12%'], ['18', '18%'], ['0', 'Nil']] },
          { k: 'veh', label: 'Vehicle no.', upper: true }, { k: 'eway', label: 'E-way bill' }
        ],
        initial: { inv: nextInv, date: today(), product: it.product || 'Quick Lime', qty: it.qty || '', rate: it.rate || '', gstR: q ? (q.isExport ? 0 : q.gstR) : 5 }, saveLabel: 'Create invoice',
        onSave(v) {
          v.gstR = +v.gstR;
          const r = M.recordOrder(v, { cust: cid, quoteId: link.quoteId || null, offerId: link.offerId || null, dealId: link.dealId || null });
          if (!r.ok) { toast(r.reason || 'Could not create the invoice', 'err'); return false; }
          toast('Invoice #' + v.inv + ' created — order recorded' + (q ? ', ' + q.no + ' converted' : ''), 'ok'); changed('order'); if (after) after(r.idx);
        }
      });
    });
  }

  /* ═══════════════ RECORD PAYMENT ═══════════════ */
  function openRecordPayment(cust, after) {
    withCustomer(cust, 'Record a payment from…', cid => {
      const c = M.byId(cid);
      const f = M.enriched().find(x => x.id === cid) || { invoices: [] };
      const open = (f.invoices || []).filter(s => s.outstanding > 0.5);
      QLShell.openForm({
        title: 'Record payment', sub: c.name + (f.salesDue ? ' · ' + fC(f.salesDue) + ' outstanding' : ''),
        specs: [
          { k: 'saleIdx', label: 'Against', type: 'select', full: true, opts: [['', 'On account (running balance)']].concat(open.map(s => [String(s.idx), '#' + s.inv + ' · ' + Q.fDS(s.date) + ' · ' + fC(s.outstanding) + ' due'])) },
          { k: 'amount', label: 'Amount (₹)', type: 'number', req: true, reqNonZero: true }, { k: 'date', label: 'Date', type: 'date', req: true },
          { k: 'mode', label: 'Mode', type: 'select', opts: (Q.paymentMethods || ['Bank', 'Cash', 'UPI', 'Cheque']).map(m => [m, m]) }, { k: 'ref', label: 'Reference', ph: 'UTR / cheque no.' },
          { k: 'desc', label: 'Note', full: true }
        ],
        initial: { date: today(), mode: 'Bank', saleIdx: open.length ? String(open[0].idx) : '', amount: open.length ? Math.round(open[0].outstanding) : '' }, saveLabel: 'Record payment',
        onSave(v) { const r = M.recordPayment(cid, v); if (!r.ok) { toast(r.reason || 'Could not record', 'err'); return false; } toast('Payment recorded', 'ok'); changed('payment'); if (after) after(); }
      });
    });
  }

  /* ═══════════════ DEALS ═══════════════ */
  function openDealForm(cust, id, after) {
    withCustomer(cust, 'Deal for…', cid => {
      const c = M.byId(cid); const row = id ? Q.state.DEALS.find(d => d.id === id) : null;
      const people = salespeople();
      QLShell.openForm({
        title: row ? 'Edit deal' : 'New deal', sub: c.name,
        specs: [
          { k: 'product', label: 'Product', type: 'select', opts: opts(C.PRODUCTS) }, { k: 'qty', label: 'Quantity (MT)', type: 'number' },
          { k: 'targetRate', label: 'Target price ₹/MT', type: 'number' }, { k: 'value', label: 'Expected value (₹)', type: 'number', ph: 'blank = qty × price' },
          { k: 'stage', label: 'Stage', type: 'select', opts: C.STAGES.map(s => [s.key, s.label]) }, { k: 'expectedClose', label: 'Expected closing', type: 'date' },
          { k: 'owner', label: 'Sales person', type: people.length ? 'searchselect' : 'text', opts: people.map(p => [p, p]) }, { k: 'notes', label: 'Notes', type: 'textarea', full: true }
        ],
        initial: row || { product: 'Quick Lime', stage: 'new_lead', owner: c.salesperson || '' }, saveLabel: row ? 'Save' : 'Add to pipeline',
        onSave(v) { if (v.value === 0) v.value = null; const r = row ? (v.stage !== row.stage ? (M.updateDeal(row.id, Object.assign({}, v, { stage: row.stage })), M.moveDeal(row.id, v.stage)) : M.updateDeal(row.id, v)) : M.addDeal(Object.assign({ cust: cid }, v)); if (!r.ok) { toast(r.reason || 'Could not save', 'err'); return false; } toast(row ? 'Deal updated' : 'Deal added', 'ok'); changed('deal'); if (after) after(); }
      });
    });
  }

  /* ═══════════════ QUICK ACTIONS (anywhere in the CRM) ═══════════════ */
  const QUICK = [
    { key: 'customer', label: 'Add customer', icon: QLX.icons.plus, run: () => openCustomerForm(null) },
    { key: 'req', label: 'Add requirement', icon: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>', run: cid => openReqForm(cid) },
    { key: 'quote', label: 'New quotation', icon: QLX.icons.doc2, run: cid => openQuoteEditor(cid) },
    { key: 'offer', label: 'Send price offer', icon: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>', run: cid => openOffer(cid) },
    { key: 'order', label: 'Record order', icon: QLX.icons.truck, run: cid => openRecordOrder(cid) },
    { key: 'payment', label: 'Record payment', icon: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>', run: cid => openRecordPayment(cid) },
    { key: 'followup', label: 'Follow-up', icon: QLX.icons.clock, run: cid => openFollowupForm(cid) },
    { key: 'whatsapp', label: 'WhatsApp', icon: QLX.icons.wa, run: cid => openComposer(cid, { channel: 'whatsapp' }) },
    { key: 'export', label: 'Export customers', icon: QLX.icons.dl, run: () => exportCustomers() }
  ];
  function quickMenu(anchor, cust) {
    closeQuick();
    const m = document.createElement('div'); m.className = 'qx-menu cu-quick'; m.id = 'cuQuick';
    m.innerHTML = '<div class="qx-menu-h">Quick actions</div>' + QUICK.map((a, i) => `<button class="qx-menu-i" data-qa="${i}">${svg(a.icon)}<span>${esc(a.label)}</span></button>`).join('');
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.position = 'fixed'; m.style.top = (r.bottom + 6) + 'px'; m.style.right = Math.max(8, window.innerWidth - r.right) + 'px'; m.style.zIndex = 400;
    m.querySelectorAll('[data-qa]').forEach(b => b.onclick = () => { closeQuick(); QUICK[+b.dataset.qa].run(cust || null); });
    setTimeout(() => document.addEventListener('click', closeQuick, { once: true }), 0);
  }
  function closeQuick() { const m = document.getElementById('cuQuick'); if (m) m.remove(); }
  function exportCustomers() {
    const rows = M.enriched();
    QLShell.exportCSV('customers_' + (Q.co.short || 'list').replace(/\s+/g, '_'),
      ['Code', 'Customer', 'Type', 'City', 'State', 'Segment', 'Health', 'MonthlyDemandMT', 'LastOrder', 'TotalSales', 'Outstanding', 'Overdue', 'OpenQuotes', 'SalesPerson', 'LastActivity', 'Status', 'GSTIN', 'Phone', 'Email'],
      rows.map(x => [x.code, x.name, C.labelOf(C.CUSTOMER_TYPES, x.ctype), x.city, x.state, C.SEGMENTS[x.seg] ? C.SEGMENTS[x.seg].label : x.seg, x.health, x.monthlyDemand, x.salesLast || '', Math.round(x.salesAmt), Math.round(x.salesDue), Math.round(x.overdue), x.openQuotes, x.salesperson, x.lastActivity || '', C.labelOf(C.CUSTOMER_STATUS, x.statusEff), x.gstin, x.phone, x.email]));
    toast('Exported ' + rows.length + ' customers');
  }

  /* keyboard: "n" opens quick actions on CRM pages */
  document.addEventListener('keydown', e => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === 'n' && !e.metaKey && !e.ctrlKey) { const b = document.getElementById('cuQuickBtn'); if (b) quickMenu(b); }
  });

  window.CRMUI = {
    openCustomerForm, pickCustomer, openReqForm, openQuoteEditor, openQuoteDoc, openOffer, openComposer, openTemplates,
    openFollowupForm, completeFollowup, openNoteForm, openDocUpload, openDoc, openRecordOrder, openRecordPayment, openDealForm,
    quickMenu, QUICK, exportCustomers, waLink, mailLink, phoneOf, printHTML, coProfile, when, salespeople
  };
})();
