/* ═══════════════════════════════════════════════════════════════════════
   Sales Register — mounted on the QLX workspace engine (PERDECT / IMZA look).
   Modern data grid, collapsible groups, right-side detail panel (Overview /
   Invoice / Payments / Comments), receive-payment flow that marks the invoice
   Paid/Partial and posts to the Payments ledger, import + PDF reused.
   ═══════════════════════════════════════════════════════════════════════ */
const Q = window.QLD, fC = Q.fC, fmt = Q.fmt, fDS = d => Q.fDS(d);
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons;
const todayISO = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const STATUSES = [['pending', 'Pending'], ['partial', 'Partial'], ['paid', 'Paid'], ['cash', 'Cash']];
const STDOT = { pending: '#f59e0b', partial: '#2563eb', paid: '#16a34a', cash: '#0d9488', cancelled: '#ef4444' };
const toast = (m, t) => QLX.toast(m, t);

/* ── Attachments (IndexedDB, per browser) — real scanned/signed invoices ── */
const ADB = 'ql_sal_docs'; let _adb = null;
function adb() { if (_adb) return _adb; _adb = new Promise((res, rej) => { const r = indexedDB.open(ADB, 1); r.onupgradeneeded = e => { const d = e.target.result; if (!d.objectStoreNames.contains('f')) d.createObjectStore('f'); }; r.onsuccess = e => res(e.target.result); r.onerror = () => rej(r.error); }); return _adb; }
function aOp(mode, fn) { return adb().then(d => new Promise((res, rej) => { const t = d.transaction('f', mode), o = fn(t.objectStore('f')); t.oncomplete = () => res(o && o.result !== undefined ? o.result : o); t.onerror = () => rej(t.error); })); }
async function addAttach(idx, file, kind) {
  const id = 'sa' + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);
  await aOp('readwrite', st => st.put(file, id));
  const s = Q.state.SALES[idx]; Q.updateSale(idx, { attach: (s.attach || []).concat([{ id, name: file.name, type: file.type || '', kind: kind || 'Invoice', size: file.size, at: new Date().toISOString() }]) });
}
function getAttachBlob(id) { return aOp('readonly', st => st.get(id)); }
async function openAttach(idx, id, dl) { const a = (Q.state.SALES[idx].attach || []).find(x => x.id === id); if (!a) return; const b = await getAttachBlob(a.id); if (!b) { toast('File not found in this browser', 'err'); return; } const url = URL.createObjectURL(b); if (dl) { const x = document.createElement('a'); x.href = url; x.download = a.name; x.click(); } else window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 4000); }
async function delAttach(idx, id) { const s = Q.state.SALES[idx]; Q.updateSale(idx, { attach: (s.attach || []).filter(a => a.id !== id) }); try { await aOp('readwrite', st => st.delete(id)); } catch (_) {} QLX.refresh(); }

/* ── cells ── */
function stCell(r) { return `<select class="qx-st s-${r.status}" data-st="${r.idx}" onclick="event.stopPropagation()">${STATUSES.map(s => `<option value="${s[0]}" ${s[0] === r.status ? 'selected' : ''}>${s[1]}</option>`).join('')}</select>`; }
function stPill(r) { const st = r.status; return `<span class="qx-pill s-${st}">${st[0].toUpperCase() + st.slice(1)}</span>`; }
function partyCell(r) { return `<span class="qx-party-n" style="font-weight:600">${esc(r.party)}</span>`; }

/* ── mutations ── */
function printInv(r) { QLShell.printInvoice(r.idx); }
function printInvByIdx(idx) { QLShell.printInvoice(idx); }
/* "Print / PDF" button: open the UPLOADED invoice scan in a new tab when one is
   attached (the real document), else print the generated GST invoice. */
async function openInvPdf(r) {
  const list = r.attach || [];
  const a = list.find(x => /invoice|bill|scan|pdf|image/i.test((x.kind || '') + ' ' + (x.type || ''))) || list[0];
  if (a) {
    const w = window.open('', '_blank');
    try {
      const blob = await getAttachBlob(a.id);
      if (blob) { const url = URL.createObjectURL(blob); if (w) w.location = url; else window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000); return; }
      if (w) w.close(); toast('That uploaded file isn\'t stored in this browser — re-upload it on this device', 'err'); return;
    } catch (_) { if (w) w.close(); toast('Could not open the uploaded invoice', 'err'); return; }
  }
  printInv(r);
}
/* Generated GST invoice (same layout as an uploaded bill), from manual entry */
function salesBillHTML(r) {
  const co = Q.co || {}, cg = r.gst / 2, money = n => '₹' + fmt(n), rate = r.qty ? r.taxable / r.qty : 0;
  const st = (r.status === 'paid' || r.status === 'cash') ? 'paid' : (r.status === 'partial' ? 'partial' : 'pending');
  return `<style>*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;color:#0f172a;margin:0;padding:32px;font-size:13px}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:14px}
    .co{font-size:19px;font-weight:800}.mut{color:#64748b;font-size:12px;line-height:1.5}.doc{text-align:right}.doc h1{font-size:15px;margin:0;letter-spacing:2px;color:#2563eb}
    .grid{display:flex;justify-content:space-between;gap:24px;margin:18px 0}.lbl{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#94a3b8;margin-bottom:3px}.nm{font-weight:700;font-size:14px}
    table{width:100%;border-collapse:collapse;margin-top:8px}th,td{padding:9px 10px;text-align:left;border-bottom:1px solid #e2e8f0}th{background:#f8fafc;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#64748b}td.r,th.r{text-align:right}
    .tot{margin-left:auto;width:280px;margin-top:14px}.tot .row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px}.tot .g{font-weight:800;font-size:16px;border-top:2px solid #0f172a;padding-top:10px;margin-top:4px}
    .pill{display:inline-block;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700}.paid{background:#dcfce7;color:#15803d}.pending,.partial{background:#fef3c7;color:#b45309}
    .ft{margin-top:26px;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:12px}</style>
    <div class="hd"><div><div class="co">${esc(co.name || 'Your Company')}</div><div class="mut">${esc(co.address || '')}${co.gstin ? '<br>GSTIN: ' + esc(co.gstin) : ''}${co.phone ? ' · ' + esc(co.phone) : ''}</div></div>
      <div class="doc"><h1>TAX INVOICE</h1><div class="mut">Invoice: <b>${esc(r.inv || '—')}</b><br>Date: ${fDS(r.date)}<br><span class="pill ${st}">${st.toUpperCase()}</span></div></div></div>
    <div class="grid"><div><div class="lbl">Billed to</div><div class="nm">${esc(r.party)}</div><div class="mut">${r.gstin ? 'GSTIN: ' + esc(r.gstin) : ''}</div></div>
      <div style="text-align:right"><div class="lbl">Vehicle</div><div class="nm">${esc(r.veh || '—')}</div></div></div>
    <table><thead><tr><th>Product</th><th class="r">Qty (T)</th><th class="r">Rate</th><th class="r">Taxable</th></tr></thead>
      <tbody><tr><td>⚪ Quick Lime</td><td class="r">${fmt(r.qty, 2)}</td><td class="r">${money(rate)}</td><td class="r">${money(r.taxable)}</td></tr></tbody></table>
    <div class="tot"><div class="row"><span>Taxable value</span><span>${money(r.taxable)}</span></div><div class="row"><span>CGST</span><span>${money(cg)}</span></div><div class="row"><span>SGST</span><span>${money(cg)}</span></div><div class="row g"><span>Total</span><span>${money(r.total)}</span></div></div>
    <div class="ft">System-generated from ${esc(co.name || 'QuickLimes')} · QuickLimes Sales Register.</div>`;
}
async function viewBillSale(r) {
  const list = r.attach || [];
  const a = list.find(x => /invoice|bill|scan|pdf|image/i.test((x.kind || '') + ' ' + (x.type || ''))) || list[0];
  if (a) {
    // Open the uploaded scan straight in the browser's native PDF/image viewer
    // (its own download/print/share) — no in-app wrapper. Reserve the tab
    // synchronously so the pop-up isn't blocked after the await.
    const w = window.open('', '_blank');
    try {
      const blob = await getAttachBlob(a.id);
      if (blob) { const url = URL.createObjectURL(blob); if (w) w.location = url; else window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000); return; }
      if (w) w.close(); toast('That uploaded file isn\'t stored in this browser — re-upload it on this device', 'err'); return;
    } catch (_) { if (w) w.close(); toast('Could not open the uploaded bill', 'err'); return; }
  }
  let html = ''; try { html = QLShell.getInvoiceHTML(r.idx); } catch (_) {}
  QLX.viewDoc({ eyebrow: 'GST Invoice', title: r.inv || '—', sub: r.party + ' · tax invoice', html: html || salesBillHTML(r), onPrint: () => printInv(r), onShare: () => shareInv(r) });
}
/* Documents tab — upload/view the real scanned invoice */
function tabDocs(r) {
  const KINDS = ['Invoice PDF', 'Scanned Invoice', 'E-way Bill', 'Weighbridge Slip', 'Photo', 'Other'];
  const list = (r.attach || []).length ? (r.attach || []).map(a => `<div class="qx-doc"><span class="qx-doc-ic">${svg(IC.doc2)}</span><div style="min-width:0"><div class="qx-doc-n">${esc(a.name)}</div><div class="qx-doc-m">${esc(a.kind)} · ${(a.size / 1024).toFixed(0)} KB</div></div><div class="qx-doc-a"><button class="qx-ib" data-tt="View" onclick="openAttach(${r.idx},'${a.id}',0)">${svg(IC.eye)}</button><button class="qx-ib" data-tt="Download" onclick="openAttach(${r.idx},'${a.id}',1)">${svg(IC.dl)}</button><button class="qx-ib" data-tt="Remove" onclick="delAttach(${r.idx},'${a.id}')">${svg(IC.trash)}</button></div></div>`).join('') : '<div class="qx-empty">No documents yet. Upload the scanned / signed invoice so View opens the real bill.</div>';
  return `<div class="qx-sec-h">Attach the real invoice <span class="qx-mut" style="text-transform:none;letter-spacing:0;font-weight:500">PDF · scan · photo</span></div>
    <label class="qx-drop" id="sxDrop"><select id="sxKind" class="qx-sel" onclick="event.stopPropagation()" style="margin-bottom:4px">${KINDS.map(k => `<option>${k}</option>`).join('')}</select>${svg(IC.dl)}<span>Drop files or click to upload</span><input type="file" id="sxFile" multiple hidden></label>
    <div style="margin-top:14px">${list}</div>`;
}
function wireDocs(body, r) {
  const drop = body.querySelector('#sxDrop'), file = body.querySelector('#sxFile'), kind = body.querySelector('#sxKind');
  const handle = async files => { for (const f of files) { try { await addAttach(r.idx, f, kind.value); } catch (_) { toast('Upload failed', 'err'); } } toast(files.length + ' file' + (files.length > 1 ? 's' : '') + ' attached', 'ok'); QLX.refresh(); };
  drop.addEventListener('click', e => { if (!e.target.closest('select')) file.click(); });
  file.onchange = () => handle([...file.files]);
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) handle([...e.dataTransfer.files]); });
}
function setStatus(r, val) { Q.setSaleStatus(r.idx, val, (val === 'paid' || val === 'cash') ? { paidDate: todayISO, paidMode: val === 'cash' ? 'Cash' : 'Bank' } : {}); }
function delInv(r) { QLShell.confirmDelete({ title: 'Move invoice to Trash?', desc: (r.inv ? 'Invoice ' + r.inv : 'This invoice') + ' for ' + Q.fC(r.total) + ' · ' + r.party + ' will move to Trash and can be restored for 90 days.', confirmLabel: 'Move to Trash', onConfirm: reason => { Q.deleteSale(r.idx, reason); toast('Moved to Trash'); QLX.refresh(); } }); }
function voidInv(r) {
  if (r.status === 'cancelled') { toast('This invoice is already voided'); return; }
  QLShell.confirmDelete({
    title: 'Void invoice ' + (r.inv || '') + '?',
    desc: 'Invoice ' + (r.inv || '') + ' for ' + Q.fC(r.total) + ' · ' + r.party + ' will be marked Cancelled. The document and number are kept for GST & audit, and it drops out of live sales totals. This is the compliant alternative to deleting a posted invoice.',
    reasonLabel: 'Reason for voiding', reasonPh: 'e.g. wrong party · duplicate · order cancelled', confirmLabel: 'Void invoice',
    onConfirm: reason => { const res = Q.voidRecord('sales', r.idx, reason); if (res.ok) { toast('Invoice voided'); QLX.refresh(); } else { toast(res.err || 'Could not void'); } }
  });
}
function dupInv(r) { const s = Q.state.SALES[r.idx]; Q.addSale(Object.assign({}, s, { inv: (s.inv || '') + '-COPY', status: 'pending', paid: 0, payments: [] })); toast('Invoice duplicated'); QLX.refresh(); }
function shareInv(r) { const co = (Q.partyRows().find(x => (x.name || '').toUpperCase() === (r.party || '').toUpperCase()) || {}); const d = (co.phone || '').replace(/\D/g, ''); const n = d.length === 10 ? '91' + d : d; window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(`Invoice ${r.inv || ''} — ${fC(r.total)} · ${r.status}`), '_blank'); }

/* ── detail tabs ── */
function tabOverview(r) {
  const kv = (l, v) => `<div class="qx-kv"><span>${l}</span><b>${v}</b></div>`;
  const co = Q.partyRows().find(x => (x.name || '').toUpperCase() === (r.party || '').toUpperCase()) || {};
  const phone = co.phone || '';
  const comm = `<div class="qx-comm">
    ${phone ? `<a class="wa" href="https://wa.me/${(phone.replace(/\D/g,'').length===10?'91':'')+phone.replace(/\D/g,'')}?text=${encodeURIComponent('Invoice '+(r.inv||''))}" target="_blank">${svg(IC.wa)} WhatsApp</a>` : ''}
    ${phone ? `<a class="call" href="tel:${esc(phone)}">${svg(IC.call)} Call</a>` : ''}
    ${co.email ? `<a class="mail" href="mailto:${esc(co.email)}">${svg(IC.mail)} Email</a>` : ''}
    ${!phone && !co.email ? '<span class="qx-mut" style="font-size:12px">No saved contact — add it in All Parties.</span>' : ''}</div>`;
  return `<div class="qx-sec-h">Customer</div>
    <div style="font-weight:700;font-size:15px">${esc(r.party)}</div>
    <div class="qx-mut" style="font-size:12.5px;margin-top:2px">${r.gstin ? 'GSTIN ' + esc(r.gstin) : 'No GSTIN on file'}${phone ? ' · ' + esc(phone) : ''}</div>
    ${comm}
    <div class="qx-sec-h">Invoice</div>
    ${kv('Invoice No', esc(r.inv || '—'))}${kv('Date', fDS(r.date))}${kv('Vehicle', esc(r.veh || '—'))}${kv('Qty', fmt(r.qty, 2) + ' T')}
    <div class="qx-sec-h">Amount</div>
    ${kv('Taxable value', fC(r.taxable))}${kv('GST', fC(r.gst))}
    <div class="qx-kv qx-kv-tot"><span>Grand total</span><b>${fC(r.total)}</b></div>
    ${kv('Received', fC(r.paid))}${r.outstanding > 0 ? kv('Outstanding', `<span style="color:var(--ql-danger-600)">${fC(r.outstanding)}</span>`) : ''}`;
}
function tabPayments(r) {
  const hist = (r.payments || []).length ? r.payments.map(p => `<div class="qx-kv"><span>${fDS(p.date)} · ${esc(p.method || p.mode || '—')}</span><b>${fC(p.amount)}</b></div>`).join('') : '<div class="qx-empty">No payments recorded yet.</div>';
  const form = (r.status !== 'paid' && r.status !== 'cash' && r.outstanding > 0) ? `<div class="qx-sec-h">Receive a payment</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input type="number" id="sxPayAmt" value="${r.outstanding}" placeholder="Amount" style="flex:1;min-width:120px;height:38px;border:1px solid var(--ql-border);border-radius:8px;padding:0 12px;font-size:13px">
      <select id="sxPayMode" class="qx-sel" style="height:38px">${Q.paymentMethods.map(m => `<option>${m}</option>`).join('')}</select>
      <button class="qx-btn qx-btn-primary" id="sxPayBtn">Receive</button>
    </div>` : '';
  return `<div class="qx-sec-h">Status</div>
    <div>${r.outstanding > 0 ? `Outstanding <b style="color:var(--ql-danger-600)">${fC(r.outstanding)}</b> of ${fC(r.total)}` : `<b style="color:var(--ql-success-600)">Fully collected ✓</b>`}</div>
    ${form}
    <div class="qx-sec-h">Payment history</div>${hist}`;
}
function wirePayments(body, r) {
  const btn = body.querySelector('#sxPayBtn'); if (!btn) return;
  btn.onclick = () => { const amt = +body.querySelector('#sxPayAmt').value || 0, method = body.querySelector('#sxPayMode').value; if (!amt) { toast('Enter an amount', 'err'); return; } Q.receiveSalesPayment(r.idx, { amount: amt, method }); toast('Payment received — invoice updated', 'ok'); QLX.refresh(); };
}

/* ══════════════════ AI Insights panel (monthly ops) ══════════════════ */
function sInsightFilter(ym) {
  const S = QLX.state();
  const d = new Date(ym + '-01T00:00'), last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  S.adv = { _from: ym + '-01', _to: ym + '-' + String(last.getDate()).padStart(2, '0') };
  S.advOpen = true; S.page = 1;
  QLX.refresh();
  const p = document.querySelector('.qx-panel'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// `rows` = the currently-selected month's invoices (passed by the QLX engine).
function salesInsightsPanel(rows) {
  rows = rows || [];
  const mon = QLX.month() ? QLX.monthLabel() : 'all time';
  const inMon = QLX.month() ? '' : ' (all)';
  const tons = rows.reduce((a, r) => a + (r.qty || 0), 0);
  const trucks = rows.filter(r => r.veh && r.veh.trim()).length || rows.length;
  const sales = rows.reduce((a, r) => a + (r.taxable || 0), 0);
  const isM = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width:768px)').matches;
  const cards = [
    { ic: '🏭', tint: 'indigo', n: fmt(tons, 1) + ' T', label: 'Production', sub: 'dispatched' + inMon },
    { ic: '🚚', tint: 'amber', n: String(trucks), label: 'Trucks Loaded', sub: 'loaded' + inMon },
    // Sales total + invoice count already sit in the top KPI cards — drop them on
    // mobile so the insight strip doesn't just repeat the stat cards above.
    ...(isM ? [] : [
      { ic: '₹', tint: 'green', n: fC(sales), label: 'Sales', sub: 'billed' + inMon },
      { ic: '🧾', tint: 'blue', n: String(rows.length), label: 'Invoices', sub: 'raised' + inMon }
    ])
  ];
  const cardHTML = c => `<div class="qx-aip-card"><span class="qx-aip-ic t-${c.tint}">${c.ic}</span><div class="qx-aip-b"><div class="qx-aip-top"><span class="qx-aip-n">${c.n}</span><span class="qx-aip-l">${c.label}</span></div><div class="qx-aip-s">${c.sub}</div></div></div>`;
  return `<div class="qx-aip"><div class="qx-aip-h"><span class="qx-aip-h-t">${svg(IC.ai)} AI Insights · ${esc(mon)}</span><span class="qx-aip-badge">Auto</span></div><div class="qx-aip-row">${cards.map(cardHTML).join('')}</div></div>`;
}

/* ══════════════════ CONFIG ══════════════════ */
QLX.mount({
  active: 'sales', title: 'Sales Register', accent: 'blue', noun: 'invoice', nounPl: 'invoices',
  icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  data: () => Q.salesRows(), rowId: r => r.idx, dateField: r => r.date,
  monthFilter: true, monthOf: r => r.date, emptyLabel: 'sales',
  emptySub: 'Create a GST invoice, or use “Upload Bills” to import from PDF / photo.',
  subtitle: () => { const s = Q.salesSummary(); return `<b>${esc(Q.co.short)}</b> · ${s.count} invoices · <b>${fC(s.taxable)}</b> sales`; },
  banner: rows => salesInsightsPanel(rows),
  primary: { label: 'New invoice', icon: IC.plus, onClick: () => QLShell.openSaleForm() },
  tools: [
    { label: 'Upload Bills', icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', onClick: () => importInvoices() },
    { label: 'Export', icon: IC.dl, onClick: () => exportRows(QLX.rows()) },
    { label: 'Report', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/>', onClick: () => openSalesReport(QLX.rows()) }
  ],
  // Month-scoped: `rows` is the selected month's invoices (all statuses).
  stats: rows => {
    const nc = rows.filter(r => r.status !== 'cancelled');
    const qty = nc.reduce((a, r) => a + (r.qty || 0), 0);
    const taxable = nc.reduce((a, r) => a + (r.taxable || 0), 0);
    const gst = nc.reduce((a, r) => a + (r.gst || 0), 0);
    const pending = nc.reduce((a, r) => a + (r.outstanding || 0), 0);
    const collected = nc.reduce((a, r) => a + (r.total || 0), 0) - pending;
    return [
      { label: 'Total Invoices', value: rows.length, sub: fmt(qty, 1) + ' T dispatched', tint: 'blue', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' },
      { label: 'Total Sales', value: fC(taxable), sub: 'excl. GST', tint: 'green', icon: '<path d="M3 3h2l2 13h11l2-8H6"/><circle cx="9" cy="21" r="1"/><circle cx="18" cy="21" r="1"/>' },
      { label: 'Collected', value: fC(collected), sub: 'paid + cash', tint: 'indigo', icon: '<polyline points="20 6 9 17 4 12"/>' },
      { label: 'Pending', value: fC(pending), sub: 'awaiting payment', tint: 'amber', icon: IC.clock },
      { label: 'GST Output', value: fC(gst), sub: 'collected GST', tint: 'violet', icon: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><line x1="8" y1="8" x2="16" y2="8"/>' }
    ];
  },
  quickFilters: [
    { key: 'all', label: 'All', test: () => true },
    { key: 'pending', label: 'Pending', test: r => r.status === 'pending' },
    { key: 'partial', label: 'Partial', test: r => r.status === 'partial' },
    { key: 'paid', label: 'Paid', test: r => r.status === 'paid' },
    { key: 'cash', label: 'Cash', test: r => r.status === 'cash' }
  ],
  search: (r, q) => (r.inv + ' ' + r.party + ' ' + r.gstin + ' ' + r.veh).toLowerCase().includes(q),
  filters: [
    { key: 'party', label: 'Party', options: rows => [...new Set(rows.map(r => r.party))].filter(p => p && p !== '—').sort().map(p => [p, p]), test: (r, v) => r.party === v },
    { key: 'status', label: 'Status', options: () => STATUSES, test: (r, v) => r.status === v }
  ],
  groupBy: [
    { key: 'status', label: 'Status', of: r => r.status, title: r => r.status[0].toUpperCase() + r.status.slice(1), dot: r => STDOT[r.status] },
    { key: 'party', label: 'Customer', of: r => r.party, title: r => esc(r.party), dot: () => 'var(--qx)' },
    { key: 'month', label: 'Month', of: r => (r.date || '').slice(0, 7), title: r => (r.date || '').slice(0, 7), dot: () => 'var(--qx)' }
  ],
  groupByDefault: 'none', groupSum: r => r.total,
  sortDefault: { key: 'date', dir: 'desc' },
  columns: [
    { key: 'sr', label: '#', cell: (r, sr) => `<span class="qx-sr">${sr}</span>`, cls: 'qx-sr' },
    { key: 'inv', label: 'Invoice', sort: true, cell: r => `<span class="qx-ref">${esc(r.inv || '—')}</span>` },
    { key: 'date', label: 'Date', sort: true, cell: r => `<span class="qx-mut">${fDS(r.date)}</span>` },
    { key: 'party', label: 'Party', sort: true, cell: partyCell },
    { key: 'veh', label: 'Vehicle No', sort: true, cell: r => r.veh ? `<span class="qx-mut">🚚 ${esc(r.veh)}</span>` : '<span class="qx-mut">—</span>' },
    { key: 'qty', label: 'Qty (T)', sort: true, num: true, cell: r => `<span class="qx-num">${fmt(r.qty, 2)}</span>` },
    { key: 'taxable', label: 'Taxable', sort: true, num: true, cell: r => `<span class="qx-num">${fC(r.taxable)}</span>` },
    { key: 'gst', label: 'GST', sort: true, num: true, cell: r => `<span class="qx-num qx-mut">${fC(r.gst)}</span>` },
    { key: 'total', label: 'Total', sort: true, num: true, cell: r => `<span class="qx-num qx-strong">${fC(r.total)}</span>` },
    { key: 'status', label: 'Status', sort: true, cell: stCell },
    { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
  ],
  status: { options: STATUSES, of: r => r.status, set: setStatus, dot: v => STDOT[v] },
  rowActions: r => [
    { tt: 'View bill', icon: IC.eye, onClick: viewBillSale },
    { tt: 'Edit', icon: IC.edit, onClick: r => QLShell.openSaleForm(r.idx) }
  ],
  rowMenu: r => [
    { label: 'Print / PDF', icon: IC.print, onClick: openInvPdf },
    { label: 'Edit', icon: IC.edit, onClick: r => QLShell.openSaleForm(r.idx) },
    { label: 'Duplicate', icon: IC.copy, onClick: dupInv },
    { label: 'Share', icon: IC.share, onClick: shareInv },
    { divider: true },
    { label: 'Archive', icon: IC.file, onClick: r => { Q.archiveRecord('sales', r.idx, true); toast('Invoice archived — see Settings → Data Management → Archived'); QLX.refresh(); } },
    { label: 'Void / Cancel', icon: IC.ban || IC.close, onClick: voidInv },
    { label: 'Delete', icon: IC.trash, cls: 'del', onClick: delInv }
  ],
  bulkActions: [
    { label: 'Mark paid', icon: IC.check, onClick: rows => { rows.forEach(r => r.outstanding > 0 && Q.receiveSalesPayment(r.idx, { amount: r.outstanding, method: 'Bank' })); toast(rows.length + ' invoices collected', 'ok'); QLX.refresh(); } },
    { label: 'Export', icon: IC.dl, onClick: rows => exportRows(rows) },
    { label: 'Delete', icon: IC.trash, cls: 'del', onClick: rows => { QLShell.confirmDelete({ title: 'Move ' + rows.length + ' invoices to Trash?', desc: 'All ' + rows.length + ' selected invoices move to Trash and can be restored for 90 days.', confirmLabel: 'Move to Trash', onConfirm: reason => { rows.map(r => r.idx).sort((a, b) => b - a).forEach(i => Q.deleteSale(i, reason)); toast(rows.length + ' moved to Trash'); QLX.refresh(); } }); } }
  ],
  card: r => ({ id: r.inv || '—', title: `<span style="color:var(--qx)">${esc(r.inv || '—')}</span>`, amount: fC(r.total), party: r.party, partySub: r.gstin || '', sub: r.veh ? '🚚 ' + r.veh : 'Invoice: ' + (r.inv || '—'), date: r.date, calLabel: r.party, status: stPill(r), rows: [['Qty', fmt(r.qty, 2) + ' T'], ['Taxable', fC(r.taxable)], ['GST', fC(r.gst)], ['Status', stPill(r)]] }),
  footer: rows => { const t = rows.reduce((a, r) => ({ qty: a.qty + r.qty, tax: a.tax + r.taxable, gst: a.gst + r.gst, tot: a.tot + r.total, paid: a.paid + r.paid, out: a.out + r.outstanding }), { qty: 0, tax: 0, gst: 0, tot: 0, paid: 0, out: 0 }); return [{ label: 'Qty', value: fmt(t.qty, 1) + ' T' }, { label: 'Taxable', value: fC(t.tax) }, { label: 'GST', value: fC(t.gst) }, { label: 'Grand Total', value: fC(t.tot), strong: true }, { label: 'Collected', value: fC(t.paid) }, { label: 'Pending', value: fC(t.out) }]; },
  analytics: () => {
    const rows = Q.salesRows();
    const byParty = {}; rows.forEach(r => { byParty[r.party] = (byParty[r.party] || 0) + r.total; });
    const bars = Object.entries(byParty).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, v]) => ({ label: p, value: v, display: fC(v) }));
    const byStatus = {}; rows.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + r.total; });
    const donut = Object.keys(byStatus).map(k => ({ label: k[0].toUpperCase() + k.slice(1), value: byStatus[k], color: STDOT[k] || '#94a3b8' }));
    return { barsTitle: 'Top customers by sales', bars, donutTitle: 'Sales by status', donut, donutCenter: fC(Q.salesSummary().revenue) };
  },
  detail: r => ({
    eyebrow: 'GST Invoice', title: `${esc(r.inv || '—')} · ${esc(r.party)}`, sub: `${fDS(r.date)} · ${fmt(r.qty, 2)} T · ${fC(r.total)}`,
    actions: [
      { label: 'PDF', icon: IC.print, onClick: openInvPdf },
      { label: 'Edit', icon: IC.edit, onClick: r => QLShell.openSaleForm(r.idx) },
      ...(r.status !== 'paid' && r.status !== 'cash' && r.outstanding > 0 ? [{ label: 'Receive', icon: IC.check, primary: true, onClick: r => { Q.receiveSalesPayment(r.idx, { amount: r.outstanding, method: 'Bank' }); toast('Payment received', 'ok'); QLX.refresh(); } }] : [])
    ],
    tabs: [
      { label: 'Overview', icon: IC.file, render: tabOverview },
      { label: 'Invoice', icon: IC.doc2, render: r => `<div class="qx-inv-bar"><button class="qx-btn qx-btn-sm" onclick="printInvByIdx(${r.idx})">${svg(IC.print)} Print</button></div><iframe class="qx-inv-frame" srcdoc="${esc((function(){try{return QLShell.getInvoiceHTML(r.idx)}catch(_){return salesBillHTML(r)}})())}" title="invoice"></iframe>` },
      { label: 'Documents', icon: IC.dl, count: (r.attach || []).length || null, render: tabDocs, onMount: wireDocs },
      { label: 'Payments', icon: IC.clock, render: tabPayments, onMount: wirePayments }
    ]
  })
});

/* handle #new (GST Invoice sidebar link) + #pending/#paid/#cash (Collections) */
(function () {
  const h = (location.hash || '').slice(1);
  if (h === 'new') { history.replaceState(null, '', location.pathname); QLShell.openSaleForm(); }
  else if (['pending', 'paid', 'cash'].includes(h)) { const S = QLX.state(); S.quick = h; QLX.refresh(); }
})();
window.addEventListener('hashchange', () => {
  const h = (location.hash || '').slice(1);
  if (h === 'new') { history.replaceState(null, '', location.pathname); QLShell.openSaleForm(); }
  else if (['pending', 'paid', 'cash', 'partial', 'all'].includes(h)) { const S = QLX.state(); S.quick = h; QLX.refresh(); }
});

/* Export / Import */
function exportRows(rows) {
  rows = rows || [];
  const mo = QLX.month() ? '_' + QLX.month() : '';
  QLShell.exportCSV('sales_' + (Q.co.short || 'register').replace(/\s+/g, '_') + mo, ['Invoice', 'Date', 'Party', 'GSTIN', 'Vehicle', 'Qty (MT)', 'Taxable', 'GST', 'Total', 'Status'], rows.map(x => [x.inv, x.date, x.party, x.gstin || '—', x.veh || '—', x.qty, x.taxable, x.gst, x.total, x.status]));
  toast('Exported ' + rows.length + ' invoices' + (QLX.month() ? ' · ' + QLX.monthLabel() : ''));
}
function exportInvoices() { exportRows(QLX.rows()); }
/* Printable monthly Sales report for the selected month. */
function openSalesReport(rows) {
  rows = rows || [];
  const label = QLX.month() ? QLX.monthLabel() : 'All months';
  if (!rows.length) { toast('No sales data found for ' + label, 'err'); return; }
  const nc = rows.filter(r => r.status !== 'cancelled');
  const qty = nc.reduce((a, r) => a + (r.qty || 0), 0), taxable = nc.reduce((a, r) => a + (r.taxable || 0), 0);
  const gst = nc.reduce((a, r) => a + (r.gst || 0), 0), total = nc.reduce((a, r) => a + (r.total || 0), 0);
  const pending = nc.reduce((a, r) => a + (r.outstanding || 0), 0), collected = total - pending;
  const co = Q.co || {};
  const cards = [['Invoices', rows.length], ['Qty dispatched', fmt(qty, 2) + ' T'], ['Taxable value', fC(taxable)], ['GST output', fC(gst)], ['Collected', fC(collected)], ['Pending', fC(pending)]];
  const body = rows.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.inv || '—')}</td><td>${fDS(r.date)}</td><td>${esc(r.party)}</td><td class="r">${fmt(r.qty, 2)}</td><td class="r">${fC(r.taxable)}</td><td class="r">${fC(r.gst)}</td><td class="r">${fC(r.total)}</td><td>${esc(r.status)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Sales Report — ${esc(label)}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,Segoe UI,Roboto,Inter,sans-serif;color:#0f172a;padding:28px;max-width:1000px;margin:0 auto}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #2563eb;padding-bottom:14px;margin-bottom:18px}
  h1{font-size:20px;font-weight:800}.sub{color:#64748b;font-size:13px;margin-top:3px}.co{text-align:right;font-size:13px;color:#334155}.co b{font-size:15px;color:#0f172a}
  .cards{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:20px}
  .c{border:1px solid #e2e8f0;border-radius:10px;padding:12px}.c .l{font-size:10.5px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;font-weight:600}.c .v{font-size:16px;font-weight:800;margin-top:5px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #eef2f7}th{background:#f8fafc;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:#475569}.r{text-align:right}
  tfoot td{font-weight:800;border-top:2px solid #cbd5e1;background:#f8fafc}
  .pbar{position:fixed;top:14px;right:14px}.pbtn{background:#2563eb;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-weight:700;cursor:pointer;font-size:13px}
  @media print{.pbar{display:none}body{padding:0}}</style></head>
  <body><div class="pbar"><button class="pbtn" onclick="window.print()">🖨 Print</button></div>
  <div class="top"><div><h1>Sales Report</h1><div class="sub">${esc(label)} · ${rows.length} invoices</div></div>
  <div class="co"><b>${esc(co.name || co.short || 'QuickLimes')}</b>${co.gstin ? '<div>GSTIN ' + esc(co.gstin) + '</div>' : ''}${co.city ? '<div>' + esc(co.city) + '</div>' : ''}</div></div>
  <div class="cards">${cards.map(c => `<div class="c"><div class="l">${c[0]}</div><div class="v">${c[1]}</div></div>`).join('')}</div>
  <table><thead><tr><th>#</th><th>Invoice</th><th>Date</th><th>Party</th><th class="r">Qty (T)</th><th class="r">Taxable</th><th class="r">GST</th><th class="r">Total</th><th>Status</th></tr></thead>
  <tbody>${body}</tbody>
  <tfoot><tr><td colspan="4">Total (${nc.length} invoices)</td><td class="r">${fmt(qty, 2)}</td><td class="r">${fC(taxable)}</td><td class="r">${fC(gst)}</td><td class="r">${fC(total)}</td><td></td></tr></tfoot></table></body></html>`;
  const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to open the report'); return; }
  w.document.write(html); w.document.close();
}
function importInvoices() {
  const cfg = {
    kind: 'sales',
    title: 'Import sales bills', sub: 'Upload a spreadsheet list — or a photo/PDF of a single bill to scan.',
    dropTitle: 'Choose a file', dropSub: '.csv / .xlsx list, or a photo / PDF of one bill',
    tip: 'A spreadsheet imports many invoices at once. A photo or PDF of one bill is read with OCR.',
    noun: 'invoice', addLabel: 'New invoice', accept: '.csv,.xlsx,.xls,.pdf,image/*,.zip', ocr: true,
    ocrMap: { inv: 'docno', date: 'date', party: 'name', gstin: 'gstin', qty: 'qty', taxable: 'taxable', total: 'total', gstr: 'rate', veh: 'veh' },
    errText: 'No usable invoices found. Check that Date, Party and an amount column are mapped.',
    headerGroups: [['date', 'invoice', 'bill', 'voucher'], ['party', 'customer', 'buyer', 'consignee', 'name', 'amount', 'taxable', 'total', 'rate']],
    fields: [{ key: 'inv', label: 'Invoice No.' }, { key: 'date', label: 'Date', required: true }, { key: 'party', label: 'Party / Customer', required: true }, { key: 'gstin', label: 'GSTIN' }, { key: 'qty', label: 'Quantity' }, { key: 'rate', label: 'Rate' }, { key: 'gstr', label: 'GST %' }, { key: 'taxable', label: 'Taxable amount' }, { key: 'total', label: 'Total amount' }, { key: 'veh', label: 'Vehicle No.' }],
    requireOneOf: [['taxable', 'rate', 'total']],
    autoMap: h => ({ inv: QLFin.colOf(h, 'invoice no', 'bill no', 'invoice', 'voucher', 'inv no', 'inv'), date: QLFin.colOf(h, 'invoice date', 'bill date', 'date'), party: QLFin.colOf(h, 'party', 'customer', 'buyer', 'consignee', 'name'), gstin: QLFin.colOf(h, 'gstin', 'gst no', 'gst number', 'gst in'), qty: QLFin.colOf(h, 'qty', 'quantity', 'weight', 'tonne', 'ton', 'mt'), rate: QLFin.colOf(h, 'rate', 'price', 'unit'), gstr: QLFin.colOf(h, 'gst %', 'gst%', 'gst rate', 'tax %', 'tax%', 'rate of tax', 'tax rate'), taxable: QLFin.colOf(h, 'taxable', 'basic', 'amount', 'value'), total: QLFin.colOf(h, 'invoice value', 'grand total', 'net amount', 'total'), veh: QLFin.colOf(h, 'vehicle', 'truck', 'lorry') }),
    buildRow: get => {
      const party = (get('party') || '').toString().trim(), date = QLFin.parseDate(get('date'));
      let qty = QLFin.parseNum(get('qty')), rate = QLFin.parseNum(get('rate'));
      let taxable = QLFin.parseNum(get('taxable')), total = QLFin.parseNum(get('total'));
      let gstR = QLFin.parseNum(get('gstr')); if (!gstR) gstR = 5; if (gstR > 0 && gstR < 1) gstR *= 100;
      if (!taxable && !(qty && rate) && total) taxable = total / (1 + gstR / 100);
      if (!qty || !rate) { if (taxable) { qty = qty || 1; rate = taxable / (qty || 1); } }
      if (!party && !qty && !taxable && !total) return null;
      return { inv: (get('inv') || '').toString().trim(), date: date || '', party, gstin: (get('gstin') || '').toString().trim().toUpperCase(), qty: +(qty || 0), rate: +(rate || 0), gstR, veh: (get('veh') || '').toString().trim(), status: 'pending' };
    },
    existing: () => new Set(Q.state.SALES.map(s => (s.inv || '').toString().toUpperCase()).filter(Boolean)),
    keyOf: s => s.inv ? s.inv.toUpperCase() : '',
    preview: { headers: ['Invoice', 'Date', 'Party', 'Qty', 'Taxable', 'GST%'], right: [3, 4, 5], row: s => [s.inv || '—', s.date || '—', s.party || '—', s.qty || '', Q.fC(s.qty * s.rate), s.gstR + '%'] },
    add: (s, file) => { Q.addSale(s); if (file) { try { addAttach(Q.state.SALES.length - 1, file, 'Invoice'); } catch (_) {} } },
    done: n => { if (n) toast('Imported ' + n + ' invoice' + (n === 1 ? '' : 's'), 'ok'); QLX.refresh(); }
  };
  // Fast path: native picker → background OCR → drawer (1) / review table (N).
  if (window.QLBulk) QLBulk.open(cfg); else QLFin.importSheet(cfg);
}
