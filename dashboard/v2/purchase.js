/* ═══════════════════════════════════════════════════════════════════════
   Purchase Register — mounted on the QLX workspace engine (flagship).
   Monday-style: multiple views, collapsible groups, right-side detail panel
   with Overview / Invoice / Payments / Documents / AI / Comments tabs,
   bulk actions, per-row comments. Reuses the existing payment / attachment /
   PDF / import logic that already shipped.
   ═══════════════════════════════════════════════════════════════════════ */
const Q = window.QLD, fC = Q.fC, fmt = Q.fmt, fDS = d => Q.fDS(d);
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons;
const GCOL = { limestone: ['#f6f0e4', '#8a6d3b'], petcoke: ['#fdeceb', '#c0392b'], packaging: ['#eaf1ff', '#2f5fd0'], labour: ['#e9f9ee', '#1c7c3a'], maintenance: ['#f2eefb', '#6b3fa0'], utilities: ['#fff5e0', '#b7791f'], office: ['#eef2f7', '#475569'], other: ['#f1f5f9', '#64748b'] };
// Short, friendly names for the Item filter (falls back to the full item name).
const ITEM_SHORT = { 'Limestone Purchase': 'Limestone', 'Petcoke Purchase': 'Petcoke', 'Plastic Bags': 'Bags', 'Royalty': 'Royalty', 'Petcoke Transport Freight': 'Petcoke Freight', 'Limestone Freight': 'Limestone Freight', 'Loading Charges': 'Loading Charges', 'Bag Printing': 'Bag Printing', 'Other Packaging': 'Other Packaging' };
const STATUSES = [['pending', 'Pending'], ['partial', 'Partial'], ['paid', 'Paid'], ['cancelled', 'Cancelled']];
const STDOT = { pending: '#f59e0b', partial: '#2563eb', paid: '#16a34a', cancelled: '#ef4444', overdue: '#ef4444' };
const toast = (m, t) => QLX.toast(m, t);

/* ── contacts ── */
function supContact(name) { return Q.partyRows().find(x => (x.name || '').toUpperCase() === (name || '').toUpperCase()) || {}; }
function waLink(phone, text) { const d = (phone || '').replace(/\D/g, ''); const n = d.length === 10 ? '91' + d : d; return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text); }

/* ── Attachments (IndexedDB, per browser) ── */
const ADB = 'ql_pur_docs'; let _adb = null;
function adb() { if (_adb) return _adb; _adb = new Promise((res, rej) => { const r = indexedDB.open(ADB, 1); r.onupgradeneeded = e => { const d = e.target.result; if (!d.objectStoreNames.contains('f')) d.createObjectStore('f'); }; r.onsuccess = e => res(e.target.result); r.onerror = () => rej(r.error); }); return _adb; }
function aOp(mode, fn) { return adb().then(d => new Promise((res, rej) => { const t = d.transaction('f', mode), o = fn(t.objectStore('f')); t.oncomplete = () => res(o && o.result !== undefined ? o.result : o); t.onerror = () => rej(t.error); })); }
async function addAttach(idx, file, kind) {
  const id = 'pa' + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);
  await aOp('readwrite', st => st.put(file, id));
  const p = Q.state.PURCHASES[idx]; const attach = (p.attach || []).concat([{ id, name: file.name, type: file.type || '', kind: kind || 'Invoice', size: file.size, at: new Date().toISOString() }]);
  Q.updatePurchase(idx, { attach });
}
async function openAttach(idx, id, dl) { const a = (Q.state.PURCHASES[idx].attach || []).find(x => x.id === id); if (!a) return; const b = await aOp('readonly', st => st.get(a.id)); if (!b) { toast('File not found in this browser', 'err'); return; } const url = URL.createObjectURL(b); if (dl) { const x = document.createElement('a'); x.href = url; x.download = a.name; x.click(); } else window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 4000); }
async function delAttach(idx, id) { const p = Q.state.PURCHASES[idx]; Q.updatePurchase(idx, { attach: (p.attach || []).filter(a => a.id !== id) }); try { await aOp('readwrite', st => st.delete(id)); } catch (_) {} QLX.refresh(); }

/* ── row action helpers (mutations) ── */
function setStatus(r, val) { const patch = { status: val }; if (val === 'paid') patch.paid = r.total; else if (val === 'pending') patch.paid = 0; Q.updatePurchase(r.idx, patch); }
function markPaid(r) { Q.recordPurchasePayment(r.idx, r.outstanding, 'bank'); toast('Marked paid', 'ok'); QLX.refresh(); }
function dupBill(r) { const p = Q.state.PURCHASES[r.idx]; Q.addPurchase(Object.assign({}, p, { bill: (p.bill || '') + '-COPY', status: 'pending', paid: 0, payments: [], attach: [] })); toast('Bill duplicated'); QLX.refresh(); }
function delBill(r) { if (confirm('Delete bill ' + (r.bill || '') + ' from ' + r.sup + '?')) { Q.deletePurchase(r.idx); toast('Bill deleted'); QLX.refresh(); } }
// Find + remove duplicate purchase bills (same supplier · amount · date · bill no.),
// keeping the BEST copy of each group (real supplier name / has a bill no. / has a scan).
function removeDuplicateBills() {
  const P = Q.state.PURCHASES;
  const BADNAME = /delivery\s*note|mode\s*\/?\s*terms|terms\s*of|the\s*buyer|reference\s*no|dispatch|^[—\-\s]*$/i;
  const sig = p => [(p.gstin || p.sup || '').toString().trim().toUpperCase(), Math.round(+p.taxable || 0), (p.date || ''), (p.bill || '').toString().trim().toUpperCase()].join('|');
  const score = p => (p.bill ? 4 : 0) + ((p.attach || []).length ? 2 : 0) + ((p.sup && !BADNAME.test(p.sup)) ? 1 : 0);
  const groups = {};
  P.forEach((p, i) => { const k = sig(p); (groups[k] = groups[k] || []).push(i); });
  const remove = [];
  Object.values(groups).forEach(idxs => {
    if (idxs.length < 2) return;
    let keep = idxs[0]; idxs.forEach(i => { if (score(P[i]) > score(P[keep])) keep = i; });
    idxs.forEach(i => { if (i !== keep) remove.push(i); });
  });
  if (!remove.length) { toast('No duplicate bills found', 'ok'); return; }
  if (!confirm('Remove ' + remove.length + ' duplicate bill' + (remove.length > 1 ? 's' : '') + '? One (best) copy of each is kept.')) return;
  remove.sort((a, b) => b - a).forEach(i => Q.deletePurchase(i));   // delete from the end so indices stay valid
  toast('Removed ' + remove.length + ' duplicate bill' + (remove.length > 1 ? 's' : ''), 'ok');
  QLX.refresh();
}
function shareBill(r) { const co = supContact(r.sup); window.open(waLink(co.phone || '', `Purchase bill ${r.bill || ''} — ${r.item} · ${fC(r.total)} · ${r.status}`), '_blank'); }
function copyLink(r) { const text = `${Q.co.short} · Bill ${r.bill || ''} · ${r.sup} · ${r.item} · ${fC(r.total)} · ${r.status}`; (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Bill summary copied'), () => toast('Copy not available', 'err')); }

/* ── cell chips ── */
function stCell(r) { const st = r.isOverdue ? 'overdue' : r.status; return `<select class="qx-st s-${st}" data-st="${r.idx}" onclick="event.stopPropagation()">${STATUSES.map(s => `<option value="${s[0]}" ${s[0] === r.status ? 'selected' : ''}>${r.isOverdue && s[0] === 'pending' ? 'Overdue' : s[1]}</option>`).join('')}</select>`; }
function stPill(r) { const st = r.isOverdue ? 'overdue' : r.status; return `<span class="qx-pill s-${st}">${st[0].toUpperCase() + st.slice(1)}</span>`; }
function groupChip(r) { const gc = GCOL[r.group] || GCOL.other; return `<span class="qx-pill" style="background:${gc[0]};color:${gc[1]}">${r.emoji} ${esc(r.groupLabel)}</span>`; }
function supCell(r) { return `<span class="qx-party-n" style="font-weight:600">${esc(r.sup)}</span>`; }
function itemCell(r) { return `<span class="qx-party"><span class="qx-party-n">${esc(r.item)}</span></span>${r.freight ? ' <span class="qx-frt">freight</span>' : ''}`; }

/* ══════════════════ PDF (drawer/print) ══════════════════ */
function billHTML(r) {
  const co = Q.co || {}, cg = r.gst / 2, money = n => '₹' + fmt(n);
  return `<style>*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;color:#0f172a;margin:0;padding:32px;font-size:13px}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:14px}
    .co{font-size:19px;font-weight:800}.mut{color:#64748b;font-size:12px;line-height:1.5}.doc{text-align:right}.doc h1{font-size:15px;margin:0;letter-spacing:2px;color:#2563eb}
    .grid{display:flex;justify-content:space-between;gap:24px;margin:18px 0}.lbl{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#94a3b8;margin-bottom:3px}.nm{font-weight:700;font-size:14px}
    table{width:100%;border-collapse:collapse;margin-top:8px}th,td{padding:9px 10px;text-align:left;border-bottom:1px solid #e2e8f0}th{background:#f8fafc;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#64748b}td.r,th.r{text-align:right}.it{color:#64748b;font-size:11px;margin-top:2px}
    .tot{margin-left:auto;width:280px;margin-top:14px}.tot .row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px}.tot .g{font-weight:800;font-size:16px;border-top:2px solid #0f172a;padding-top:10px;margin-top:4px}
    .pill{display:inline-block;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700}.paid{background:#dcfce7;color:#15803d}.pending,.partial{background:#fef3c7;color:#b45309}.cancelled{background:#fee2e2;color:#b91c1c}
    .ft{margin-top:26px;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:12px}</style>
    <div class="hd"><div><div class="co">${esc(co.name || 'Your Company')}</div><div class="mut">${esc(co.address || '')}${co.gstin ? '<br>GSTIN: ' + esc(co.gstin) : ''}${co.phone ? ' · ' + esc(co.phone) : ''}</div></div>
      <div class="doc"><h1>PURCHASE BILL</h1><div class="mut">Bill No: <b>${esc(r.bill || '—')}</b><br>Date: ${fDS(r.date)}<br><span class="pill ${r.status}">${r.status.toUpperCase()}</span></div></div></div>
    <div class="grid"><div><div class="lbl">Supplier</div><div class="nm">${esc(r.sup)}</div><div class="mut">${r.gstin ? 'GSTIN: ' + esc(r.gstin) : ''}</div></div>
      <div style="text-align:right"><div class="lbl">Department · ITC</div><div class="nm">${esc(r.dept || '—')}</div><div class="mut">ITC: ${r.itc ? 'Eligible' : '—'}</div></div></div>
    <table><thead><tr><th>Purchase Group / Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Taxable</th></tr></thead>
      <tbody><tr><td>${esc(r.emoji + ' ' + r.groupLabel)}<div class="it">${esc(r.item)}${r.desc ? ' — ' + esc(r.desc) : ''}</div></td><td class="r">${r.qty ? fmt(r.qty, 2) + (r.unit ? ' ' + esc(r.unit) : '') : '—'}</td><td class="r">${r.rate ? money(r.rate) : '—'}</td><td class="r">${money(r.taxable)}</td></tr></tbody></table>
    <div class="tot"><div class="row"><span>Taxable value</span><span>${money(r.taxable)}</span></div>${r.freightAmt ? `<div class="row"><span>Freight (incl.)</span><span>${money(r.freightAmt)}</span></div>` : ''}<div class="row"><span>CGST @ ${r.grate / 2}%</span><span>${money(cg)}</span></div><div class="row"><span>SGST @ ${r.grate / 2}%</span><span>${money(cg)}</span></div><div class="row g"><span>Total</span><span>${money(r.total)}</span></div></div>
    <div class="ft">System-generated from ${esc(co.name || 'QuickLimes')} · QuickLimes Purchase Register.</div>`;
}
const isMobileP = () => (window.QLMobile ? QLMobile.isMobile() : window.matchMedia('(max-width:768px)').matches);
// open the generated purchase bill in the same full-screen viewer the sales invoice
// uses on phones (fit-to-width · pinch-zoom · PDF · Print · WhatsApp)
function mobileBillViewer(r) {
  QLMobile.invoiceViewer({
    html: billHTML(r),
    printHtml: '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill ' + esc(r.bill || '') + '</title></head><body>' + billHTML(r) + '</body></html>',
    title: 'Purchase Bill ' + (r.bill || '—'),
    shareText: Q.co.short + ' · Bill ' + (r.bill || '') + ' · ' + r.sup + ' · ' + fC(r.total) + ' · ' + r.status,
    onShare: () => shareBill(r)
  });
}
function pdfWindow(r) {
  if (isMobileP() && window.QLMobile && QLMobile.invoiceViewer) return mobileBillViewer(r);
  const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to open the PDF'); return; }
  w.document.write('<html><head><title>Purchase Bill ' + esc(r.bill || '') + '</title></head><body>' + billHTML(r) + '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print()},250)}</scr' + 'ipt></body></html>'); w.document.close();
}
/* The "PDF" / "Download PDF" buttons: open the UPLOADED scan in a new tab when
   one is attached (the real document), else fall back to the generated bill. */
async function openBillPdf(r) {
  const list = r.attach || [];
  const a = list.find(x => /invoice|bill|scan|pdf|image/i.test((x.kind || '') + ' ' + (x.type || ''))) || list[0];
  if (a) {
    const w = window.open('', '_blank');
    try {
      const blob = await aOp('readonly', st => st.get(a.id));
      if (blob) { const url = URL.createObjectURL(blob); if (w) w.location = url; else window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000); return; }
      if (w) w.close(); toast('That uploaded file isn\'t stored in this browser — re-upload it on this device', 'err'); return;
    } catch (_) { if (w) w.close(); toast('Could not open the uploaded bill', 'err'); return; }
  }
  pdfWindow(r);
}
/* View the actual bill: the UPLOADED file if one is attached, else the bill
   generated from the manually-entered details (same layout). */
async function viewBill(r) {
  const list = r.attach || [];
  // prefer an invoice/bill/scan/pdf attachment, else the first uploaded file
  const a = list.find(x => /invoice|bill|scan|pdf|image/i.test((x.kind || '') + ' ' + (x.type || ''))) || list[0];
  if (a) {
    // Open the uploaded scan straight in the browser's native PDF/image viewer
    // (no in-app wrapper). Reserve the tab synchronously so it isn't pop-up
    // blocked after the await.
    const w = window.open('', '_blank');
    try {
      const blob = await aOp('readonly', st => st.get(a.id));
      if (blob) { const url = URL.createObjectURL(blob); if (w) w.location = url; else window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000); return; }
      if (w) w.close(); toast('That uploaded file isn\'t stored in this browser — re-upload it on this device', 'err'); return;
    } catch (_) { if (w) w.close(); toast('Could not open the uploaded bill', 'err'); return; }
  }
  // no upload on this bill → the generated bill. On phones open it as a full-screen
  // PDF (like the sales invoice); on desktop keep the in-app preview drawer.
  if (isMobileP() && window.QLMobile && QLMobile.invoiceViewer) return mobileBillViewer(r);
  QLX.viewDoc({ eyebrow: 'Purchase bill', title: 'Bill ' + (r.bill || '—'), sub: r.sup + ' · generated (no file uploaded)', html: billHTML(r), onPrint: () => pdfWindow(r), onShare: () => shareBill(r) });
}

/* ══════════════════ DETAIL PANEL TABS ══════════════════ */
function tabOverview(r) {
  const co = supContact(r.sup), phone = co.phone || '';
  const kv = (l, v) => `<div class="qx-kv"><span>${l}</span><b>${v}</b></div>`;
  const comm = `<div class="qx-comm">
    ${phone ? `<a class="wa" href="${waLink(phone, 'Regarding bill ' + (r.bill || '') + ' — ' + r.item)}" target="_blank">${svg(IC.wa)} WhatsApp</a>` : ''}
    ${phone ? `<a class="call" href="tel:${esc(phone)}">${svg(IC.call)} Call</a>` : ''}
    ${co.email ? `<a class="mail" href="mailto:${esc(co.email)}">${svg(IC.mail)} Email</a>` : ''}
    ${!phone && !co.email ? '<span class="qx-mut" style="font-size:12px">No saved supplier contact — add it in All Parties.</span>' : ''}
  </div>`;
  return `<div class="qx-sec-h">Supplier</div>
    <div style="font-weight:700;font-size:15px">${esc(r.sup)}</div>
    <div class="qx-mut" style="font-size:12.5px;margin-top:2px">${r.gstin ? 'GSTIN ' + esc(r.gstin) : 'No GSTIN on file'}${phone ? ' · ' + esc(phone) : ''}</div>
    ${comm}
    <div class="qx-sec-h">Bill details</div>
    ${kv('Invoice / Bill No', esc(r.bill || '—'))}${kv('Bill date', fDS(r.date))}${kv('Due date', r.dueDate ? fDS(r.dueDate) : '—')}
    ${kv('Group · Item', r.emoji + ' ' + esc(r.groupLabel) + ' → ' + esc(r.item))}${kv('Department', esc(r.dept || '—'))}${kv('Created by', esc(r.createdBy))}
    <div class="qx-sec-h">Amount</div>
    ${kv('Taxable value', fC(r.taxable))}${r.freightAmt ? kv('Freight / transport', '🚚 ' + fC(r.freightAmt)) : ''}${kv('GST @ ' + r.grate + '%', fC(r.gst))}${kv('ITC', r.itc ? fC(r.itc) : '—')}
    <div class="qx-kv qx-kv-tot"><span>Grand total</span><b>${fC(r.total)}</b></div>`;
}
function pdfByIdx(idx) { openBillPdf(Q.purchaseRows()[idx]); }
function shareByIdx(idx) { shareBill(Q.purchaseRows()[idx]); }
function tabInvoice(r) {
  return `<div class="qx-inv-bar"><button class="qx-btn qx-btn-sm" onclick="pdfByIdx(${r.idx})">${svg(IC.dl)} Download</button><button class="qx-btn qx-btn-sm" onclick="pdfByIdx(${r.idx})">${svg(IC.print)} Print</button><button class="qx-btn qx-btn-sm" onclick="shareByIdx(${r.idx})">${svg(IC.share)} Share</button></div>
    <iframe class="qx-inv-frame" srcdoc="${esc(billHTML(r))}" title="bill preview"></iframe>`;
}
function tabPayments(r) {
  const hist = (r.payments || []).length ? r.payments.map(p => `<div class="qx-kv"><span>${fDS(p.date)} · ${esc(p.mode)}</span><b>${fC(p.amount)}</b></div>`).join('') : '<div class="qx-empty">No payments recorded yet.</div>';
  const form = (r.status !== 'paid' && r.status !== 'cancelled') ? `<div class="qx-sec-h">Record a payment</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input type="number" id="pxPayAmt" value="${r.outstanding}" placeholder="Amount" style="flex:1;min-width:120px;height:38px;border:1px solid var(--ql-border);border-radius:10px;padding:0 12px;font-size:13px">
      <select id="pxPayMode" class="qx-sel" style="height:38px"><option value="bank">Bank</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="cheque">Cheque</option></select>
      <button class="qx-btn qx-btn-primary" id="pxPayBtn">Record</button>
    </div>` : '';
  return `<div class="qx-sec-h">Status</div>
    <div>${r.outstanding > 0 ? `Outstanding <b style="color:var(--ql-danger-600)">${fC(r.outstanding)}</b> of ${fC(r.total)}` : `<b style="color:var(--ql-success-600)">Fully paid ✓</b>`}</div>
    ${form}
    <div class="qx-sec-h">Payment history</div>${hist}`;
}
function wirePayments(body, r) {
  const btn = body.querySelector('#pxPayBtn'); if (!btn) return;
  btn.onclick = () => { const amt = +body.querySelector('#pxPayAmt').value || 0, mode = body.querySelector('#pxPayMode').value; if (!amt) { toast('Enter an amount', 'err'); return; } Q.recordPurchasePayment(r.idx, amt, mode); toast('Payment recorded', 'ok'); QLX.refresh(); };
}
function tabDocs(r) {
  const KINDS = ['Invoice PDF', 'Scanned Invoice', 'Transport Slip', 'Royalty Receipt', 'Weighbridge Slip', 'Photo', 'Other'];
  const list = (r.attach || []).length ? (r.attach || []).map(a => `<div class="qx-doc"><span class="qx-doc-ic">${svg(IC.doc2)}</span><div style="min-width:0"><div class="qx-doc-n">${esc(a.name)}</div><div class="qx-doc-m">${esc(a.kind)} · ${(a.size / 1024).toFixed(0)} KB</div></div><div class="qx-doc-a"><button class="qx-ib" data-tt="View" onclick="openAttach(${r.idx},'${a.id}',0)">${svg(IC.eye)}</button><button class="qx-ib" data-tt="Download" onclick="openAttach(${r.idx},'${a.id}',1)">${svg(IC.dl)}</button><button class="qx-ib" data-tt="Remove" onclick="delAttach(${r.idx},'${a.id}')">${svg(IC.trash)}</button></div></div>`).join('') : '<div class="qx-empty">No documents attached yet.</div>';
  return `<div class="qx-sec-h">Attach a document <span class="qx-mut" style="text-transform:none;letter-spacing:0;font-weight:500">Invoice · Transport slip · Royalty · Weighbridge · Photos</span></div>
    <label class="qx-drop" id="pxDrop"><select id="pxKind" class="qx-sel" onclick="event.stopPropagation()" style="margin-bottom:4px">${KINDS.map(k => `<option>${k}</option>`).join('')}</select>${svg(IC.dl)}<span>Drop files or click to upload</span><input type="file" id="pxFile" multiple hidden></label>
    <div style="margin-top:14px">${list}</div>`;
}
function wireDocs(body, r) {
  const drop = body.querySelector('#pxDrop'), file = body.querySelector('#pxFile'), kind = body.querySelector('#pxKind');
  const handle = async files => { for (const f of files) { try { await addAttach(r.idx, f, kind.value); } catch (_) { toast('Upload failed', 'err'); } } toast(files.length + ' file' + (files.length > 1 ? 's' : '') + ' attached', 'ok'); QLX.refresh(); };
  drop.addEventListener('click', e => { if (!e.target.closest('select')) file.click(); });
  file.onchange = () => handle([...file.files]);
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) handle([...e.dataTransfer.files]); });
}
function tabAI(r) {
  const ins = Q.billInsights(r.idx), rel = Q.relatedBills(r.idx);
  const relList = arr => arr.length ? arr.map(x => `<button class="qx-tag" style="cursor:pointer;margin:2px 4px 2px 0" onclick="QLX.open(${x.idx})">${x.itemIconEmoji} ${esc(x.item)} · ${fC(x.taxable)}</button>`).join('') : '<span class="qx-mut">None</span>';
  const related = rel.freight.concat(rel.royalty).length ? rel.freight.concat(rel.royalty) : rel.group.slice(0, 5);
  return `<div class="qx-ai"><div class="qx-ai-h">${svg(IC.ai)} AI insights for this bill</div>${ins.map(x => `<div class="qx-ai-i t-${x.tone}"><span class="qx-ai-d"></span>${esc(x.text)}</div>`).join('')}</div>
    <div class="qx-sec-h">Related in ${r.emoji} ${esc(r.groupLabel)}</div><div>${relList(related)}</div>`;
}

/* ══════════════════ AI Insights panel (monthly materials) ══════════════════ */
function pInsightFilter(kind) {
  const S = QLX.state();
  if (kind === '__royalty') { S.adv = {}; S.q = 'royalty'; }
  else { S.adv = { group: kind }; S.q = ''; }
  S.advOpen = true; S.page = 1;
  QLX.refresh();
  const p = document.querySelector('.qx-panel'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// `rows` = the currently-selected month's bills (passed by the QLX engine).
function aiInsightsPanel(rows) {
  rows = rows || [];
  const mon = QLX.month() ? QLX.monthLabel() : 'all time';
  const inMon = QLX.month() ? '' : ' (all)';
  const amt = pred => rows.filter(pred).reduce((a, r) => a + (r.total || 0), 0);
  const qty = pred => rows.filter(pred).reduce((a, r) => a + (r.qty || 0), 0);
  const cards = [
    { ic: '🪨', tint: 'amber', label: 'Limestone', a: amt(r => r.group === 'limestone'), q: qty(r => r.group === 'limestone'), unit: 'T', act: 'purchased' },
    { ic: '🔥', tint: 'red', label: 'Petcoke', a: amt(r => r.group === 'petcoke'), q: qty(r => r.group === 'petcoke'), unit: 'T', act: 'consumed' },
    { ic: '📦', tint: 'blue', label: 'Plastic Bags', a: amt(r => r.group === 'packaging'), q: qty(r => r.group === 'packaging'), unit: 'bags', act: 'used' },
    { ic: '📜', tint: 'violet', label: 'Royalty', a: amt(r => /royalty/i.test(r.item)), q: 0, unit: '', act: 'paid' }
  ];
  const cardHTML = c => {
    const big = c.a ? fC(c.a) : '₹0';
    const sub = c.act + inMon + (c.q && c.unit ? ' · ' + fmt(c.q, c.unit === 'bags' ? 0 : 1) + ' ' + c.unit : '');
    return `<div class="qx-aip-card"><div class="qx-aip-b"><div class="qx-aip-top"><span class="qx-aip-n">${big}</span><span class="qx-aip-l">${c.label}</span></div><div class="qx-aip-s">${sub}</div></div></div>`;
  };
  return `<div class="qx-aip"><div class="qx-aip-h"><span class="qx-aip-h-t">${svg(IC.ai)} AI Insights · ${esc(mon)}</span><span class="qx-aip-badge">Auto</span></div><div class="qx-aip-row">${cards.map(cardHTML).join('')}</div></div>`;
}

/* ══════════════════ CONFIG ══════════════════ */
QLX.mount({
  active: 'purchase', title: 'Purchase Register', accent: 'blue', noun: 'bill', nounPl: 'bills',
  icon: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  views: ['table'],
  data: () => Q.purchaseRows(), rowId: r => r.idx, dateField: r => r.date,
  monthFilter: true, monthOf: r => r.date, emptyLabel: 'purchase',
  subtitle: () => { const s = Q.purchaseSummary(); return `<b>${esc(Q.co.short)}</b> · ${s.count} bills · <b>${fC(s.total)}</b> purchase value`; },
  banner: rows => aiInsightsPanel(rows),
  primary: { label: 'Add Bill', icon: IC.plus, onClick: () => QLShell.openPurchaseForm() },
  tools: [
    { label: 'Import', icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', onClick: () => importBills() },
    { label: 'Export', icon: IC.dl, onClick: () => exportRows(QLX.rows()) },
    { label: 'Report', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/>', onClick: () => openPurchaseReport(QLX.rows()) },
    { label: 'Remove duplicates', icon: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', onClick: () => removeDuplicateBills() }
  ],
  // Month-scoped: `rows` is the selected month's bills (all statuses).
  stats: rows => {
    const nc = rows.filter(r => r.status !== 'cancelled');
    const taxable = nc.reduce((a, r) => a + (r.taxable || 0), 0);
    const itc = nc.reduce((a, r) => a + (r.itc || 0), 0);
    const pending = nc.reduce((a, r) => a + (r.outstanding || 0), 0);
    const paid = nc.reduce((a, r) => a + (r.paid || 0), 0);
    const sups = new Set(nc.filter(r => (r.outstanding || 0) > 0).map(r => r.sup)).size;
    return [
      { label: 'Total Bills', value: rows.length, sub: nc.filter(r => r.isOverdue).length + ' overdue', tint: 'blue', icon: IC.file },
      { label: 'Total Purchases', value: fC(taxable), sub: 'excl. GST', tint: 'indigo', icon: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>' },
      { label: 'GST Input Credit', value: fC(itc), sub: 'available ITC', tint: 'green', icon: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/>' },
      { label: 'Pending Payment', value: fC(pending), sub: sups + ' supplier' + (sups === 1 ? '' : 's'), tint: 'amber', icon: IC.clock },
      { label: 'Paid Amount', value: fC(paid), sub: 'settled to date', tint: 'teal', icon: IC.check }
    ];
  },
  search: (r, q) => (r.bill + ' ' + r.sup + ' ' + r.item + ' ' + r.groupLabel + ' ' + r.gstin + ' ' + r.dept).toLowerCase().includes(q),
  filters: [
    { key: 'status', label: 'Status', options: () => [['pending', 'Pending'], ['partial', 'Partial'], ['paid', 'Paid'], ['overdue', 'Overdue'], ['cancelled', 'Cancelled']], test: (r, v) => v === 'overdue' ? r.isOverdue : v === 'pending' ? (r.status === 'pending' && !r.isOverdue) : r.status === v },
    { key: 'group', label: 'Group', options: rows => Q.purchaseGroups.filter(g => rows.some(r => r.group === g.key)).map(g => [g.key, g.emoji + ' ' + g.label]), test: (r, v) => r.group === v },
    { key: 'item', label: 'Item', allLabel: 'All items', options: rows => [...new Set(rows.map(r => r.item))].filter(Boolean).sort().map(it => [it, ITEM_SHORT[it] || it]), test: (r, v) => r.item === v },
    { key: 'sup', label: 'Supplier', options: rows => [...new Set(rows.map(r => r.sup))].filter(s => s && s !== '—').sort().map(s => [s, s]), test: (r, v) => r.sup === v }
  ],
  groupBy: [
    { key: 'group', label: 'Purchase Group', of: r => r.group, title: r => esc(r.groupLabel), dot: r => (GCOL[r.group] || GCOL.other)[1] },
    { key: 'item', label: 'Purchase Item', of: r => r.item || '—', title: r => esc(ITEM_SHORT[r.item] || r.item || '—'), dot: r => (GCOL[r.group] || GCOL.other)[1] },
    { key: 'status', label: 'Payment status', of: r => (r.isOverdue ? 'overdue' : r.status), title: r => (r.isOverdue ? 'Overdue' : r.status[0].toUpperCase() + r.status.slice(1)), dot: r => STDOT[r.isOverdue ? 'overdue' : r.status] },
    { key: 'sup', label: 'Supplier', of: r => r.sup, title: r => esc(r.sup), dot: () => 'var(--qx)' },
    { key: 'dept', label: 'Department', of: r => r.dept, title: r => esc(r.dept || '—'), dot: () => 'var(--qx)' }
  ],
  groupByDefault: 'group', groupSum: r => r.total,
  sortDefault: { key: 'date', dir: 'desc' },
  columns: [
    { key: 'sr', label: '#', cell: (r, sr) => `<span class="qx-sr">${sr}</span>`, cls: 'qx-sr' },
    { key: 'bill', label: 'Bill No', sort: true, cell: r => `<span class="qx-ref">${esc(r.bill || '—')}</span>` },
    { key: 'date', label: 'Bill Date', sort: true, cell: r => `<span class="qx-mut">${fDS(r.date)}</span>` },
    { key: 'sup', label: 'Supplier', sort: true, cell: supCell },
    { key: 'item', label: 'Purchase Item', sort: true, cell: itemCell },
    { key: 'dept', label: 'Department', hidden: true, cell: r => `<span class="qx-tag">${esc(r.dept || '—')}</span>` },
    { key: 'grate', label: 'GST', sort: true, num: true, cell: r => `<span class="qx-mut qx-num">${r.grate}%</span>` },
    { key: 'taxable', label: 'Taxable', sort: true, num: true, cell: r => `<span class="qx-num">${fC(r.taxable)}</span>` },
    { key: 'freightAmt', label: 'Freight', sort: true, num: true, cell: r => r.freightAmt ? `<span class="qx-num" style="color:#b7791f">🚚 ${fC(r.freightAmt)}</span>` : '<span class="qx-mut">—</span>' },
    { key: 'total', label: 'Total', sort: true, num: true, cell: r => `<span class="qx-num qx-strong">${fC(r.total)}</span>` },
    { key: 'status', label: 'Status', sort: true, cell: stCell },
    { key: 'dueDate', label: 'Due Date', hidden: true, cell: r => `<span class="qx-mut">${r.dueDate ? fDS(r.dueDate) : '—'}</span>` },
    { key: 'createdBy', label: 'Created By', hidden: true, cell: r => `<span class="qx-mut">${esc(r.createdBy)}</span>` },
    { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
  ],
  status: { options: STATUSES, of: r => r.status, set: setStatus, dot: v => STDOT[v] },
  rowActions: r => [
    { tt: 'View bill', icon: IC.eye, onClick: viewBill },
    { tt: 'Edit', icon: IC.edit, onClick: r => QLShell.openPurchaseForm(r.idx) },
    ...(r.status !== 'paid' && r.status !== 'cancelled' ? [{ tt: 'Mark paid', icon: IC.check, cls: 'qx-ib-ok', onClick: markPaid }] : [])
  ],
  rowMenu: r => [
    { label: 'Duplicate', icon: IC.copy, onClick: dupBill },
    { label: 'Download PDF', icon: IC.dl, onClick: openBillPdf },
    { label: 'Print', icon: IC.print, onClick: pdfWindow },
    { label: 'Share', icon: IC.share, onClick: shareBill },
    { label: 'Copy link', icon: IC.copy, onClick: copyLink },
    { divider: true },
    { label: 'Delete', icon: IC.trash, cls: 'del', onClick: delBill }
  ],
  bulkActions: [
    { label: 'Mark paid', icon: IC.check, onClick: rows => { rows.forEach(r => r.outstanding > 0 && Q.recordPurchasePayment(r.idx, r.outstanding, 'bank')); toast(rows.length + ' bills marked paid', 'ok'); QLX.refresh(); } },
    { label: 'Export', icon: IC.dl, onClick: rows => { exportRows(rows); } },
    { label: 'Delete', icon: IC.trash, cls: 'del', onClick: rows => { if (confirm('Delete ' + rows.length + ' bills?')) { rows.map(r => r.idx).sort((a, b) => b - a).forEach(i => Q.deletePurchase(i)); toast(rows.length + ' bills deleted'); QLX.refresh(); } } }
  ],
  card: r => ({
    id: r.bill || '—', title: `<span style="color:var(--qx)">${esc(r.bill || '—')}</span>`, amount: fC(r.total),
    party: r.sup, partySub: r.emoji + ' ' + r.groupLabel, sub: r.veh ? '🚚 ' + r.veh : 'Bill: ' + (r.bill || '—'), date: r.date, calLabel: r.sup, status: stPill(r),
    chips: [groupChip(r), r.freight ? '<span class="qx-frt">freight</span>' : ''].filter(Boolean),
    rows: [['Item', r.itemIconEmoji + ' ' + esc(r.item)], ['Taxable', fC(r.taxable)], ['GST', fC(r.gst)], ['Status', stPill(r)]]
  }),
  footer: rows => { const t = rows.reduce((a, r) => ({ tax: a.tax + r.taxable, frt: a.frt + r.freightAmt, gst: a.gst + r.gst, tot: a.tot + r.total, paid: a.paid + r.paid, out: a.out + r.outstanding }), { tax: 0, frt: 0, gst: 0, tot: 0, paid: 0, out: 0 }); return [{ label: 'Taxable', value: fC(t.tax) }, { label: 'Freight', value: fC(t.frt) }, { label: 'GST', value: fC(t.gst) }, { label: 'Grand Total', value: fC(t.tot), strong: true }, { label: 'Paid', value: fC(t.paid) }, { label: 'Pending', value: fC(t.out) }]; },
  analytics: () => {
    const g = Q.purchaseByGroup();
    const bars = g.map(x => ({ label: x.emoji + ' ' + x.label, value: x.total, display: fC(x.total), color: (GCOL[x.key] || GCOL.other)[1] }));
    const rows = Q.purchaseRows();
    const byStatus = {}; rows.forEach(r => { const k = r.isOverdue ? 'overdue' : r.status; byStatus[k] = (byStatus[k] || 0) + r.total; });
    const donut = Object.keys(byStatus).map(k => ({ label: k[0].toUpperCase() + k.slice(1), value: byStatus[k], color: STDOT[k] || '#94a3b8' }));
    return { barsTitle: 'Landed cost by purchase group', bars, donutTitle: 'Spend by payment status', donut, donutCenter: fC(Q.purchaseSummary().total) };
  },
  detail: r => ({
    eyebrow: 'Purchase Bill', title: `${esc(r.bill || '—')} · ${esc(r.sup)}`, sub: `${r.emoji} ${esc(r.groupLabel)} → ${esc(r.item)} · ${fC(r.total)}`,
    actions: [
      { label: 'Edit', icon: IC.edit, onClick: r => QLShell.openPurchaseForm(r.idx) },
      { label: 'PDF', icon: IC.print, onClick: openBillPdf },
      ...(r.status !== 'paid' && r.status !== 'cancelled' ? [{ label: 'Mark paid', icon: IC.check, primary: true, onClick: markPaid }] : [])
    ],
    tabs: [
      { label: 'Overview', icon: IC.file, render: tabOverview },
      { label: 'Invoice', icon: IC.doc2, render: tabInvoice },
      { label: 'Payments', icon: IC.clock, render: tabPayments, onMount: wirePayments },
      { label: 'Documents', icon: IC.dl, count: (r.attach || []).length || null, render: tabDocs, onMount: wireDocs },
      { label: 'AI', icon: IC.ai, render: tabAI }
    ]
  })
});

/* ── Export / Import (reused) ── */
function exportRows(rows) {
  rows = rows || [];
  const mo = QLX.month() ? '_' + QLX.month() : '';
  QLShell.exportCSV('purchases_' + (Q.co.short || 'register').replace(/\s+/g, '_') + mo, ['Bill', 'Date', 'Supplier', 'Group', 'Item', 'Department', 'GSTIN', 'GST%', 'Taxable', 'Freight', 'GST', 'ITC', 'Total', 'Paid', 'Status', 'Due'], rows.map(x => [x.bill, x.date, x.sup, x.groupLabel, x.item, x.dept, x.gstin, x.grate, x.taxable, x.freightAmt, x.gst, x.itc, x.total, x.paid, x.status, x.dueDate]));
  toast('Exported ' + rows.length + ' bills' + (QLX.month() ? ' · ' + QLX.monthLabel() : ''));
}
function exportBills() { exportRows(QLX.rows()); }
/* Printable monthly Purchase report for the selected month. */
function openPurchaseReport(rows) {
  rows = rows || [];
  const label = QLX.month() ? QLX.monthLabel() : 'All months';
  if (!rows.length) { toast('No purchase data found for ' + label, 'err'); return; }
  const nc = rows.filter(r => r.status !== 'cancelled');
  const taxable = nc.reduce((a, r) => a + (r.taxable || 0), 0), gst = nc.reduce((a, r) => a + (r.gst || 0), 0);
  const itc = nc.reduce((a, r) => a + (r.itc || 0), 0), total = nc.reduce((a, r) => a + (r.total || 0), 0);
  const paid = nc.reduce((a, r) => a + (r.paid || 0), 0), pending = nc.reduce((a, r) => a + (r.outstanding || 0), 0);
  const co = Q.co || {};
  const cards = [['Bills', rows.length], ['Taxable value', fC(taxable)], ['GST (ITC)', fC(itc)], ['Total', fC(total)], ['Paid', fC(paid)], ['Pending', fC(pending)]];
  const body = rows.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.bill || '—')}</td><td>${fDS(r.date)}</td><td>${esc(r.sup)}</td><td>${r.emoji} ${esc(r.item || r.groupLabel || '')}</td><td class="r">${fC(r.taxable)}</td><td class="r">${fC(r.gst)}</td><td class="r">${fC(r.total)}</td><td>${esc(r.status)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Purchase Report — ${esc(label)}</title>
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
  <div class="top"><div><h1>Purchase Report</h1><div class="sub">${esc(label)} · ${rows.length} bills</div></div>
  <div class="co"><b>${esc(co.name || co.short || 'QuickLimes')}</b>${co.gstin ? '<div>GSTIN ' + esc(co.gstin) + '</div>' : ''}${co.city ? '<div>' + esc(co.city) + '</div>' : ''}</div></div>
  <div class="cards">${cards.map(c => `<div class="c"><div class="l">${c[0]}</div><div class="v">${c[1]}</div></div>`).join('')}</div>
  <table><thead><tr><th>#</th><th>Bill</th><th>Date</th><th>Supplier</th><th>Item</th><th class="r">Taxable</th><th class="r">GST</th><th class="r">Total</th><th>Status</th></tr></thead>
  <tbody>${body}</tbody>
  <tfoot><tr><td colspan="5">Total (${nc.length} bills)</td><td class="r">${fC(taxable)}</td><td class="r">${fC(gst)}</td><td class="r">${fC(total)}</td><td></td></tr></tfoot></table></body></html>`;
  const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to open the report'); return; }
  w.document.write(html); w.document.close();
}
function importBills() {
  // stable "same bill" key — name-independent, and works even when the bill NUMBER
  // wasn't extracted (Tally bills): bill · supplier-identity (GSTIN, else name) · amount · date.
  const dupKeyP = p => {
    const b = String(p.bill || '').trim(), id = String(p.gstin || p.sup || '').trim(), amt = Math.round(+p.taxable || 0);
    return (b || id) ? (b + '|' + id + '|' + amt + '|' + (p.date || '')).toUpperCase() : '';
  };
  QLFin.importSheet({
    title: 'Import purchase bills', sub: 'Upload a spreadsheet list — or a photo/PDF of a single bill to scan.',
    dropTitle: 'Choose a file', dropSub: '.csv / .xlsx list, or a photo / PDF of one bill',
    tip: 'A spreadsheet imports many bills; a photo/PDF is read with OCR. A "Purchase Group / Item" column is auto-detected.',
    noun: 'bill', addLabel: 'Add Bill', accept: '.csv,.xlsx,.xls,.pdf,image/*', ocr: true,
    ocrMap: { bill: 'docno', date: 'date', sup: 'name', gstin: 'gstin', taxable: 'taxable', total: 'total', grate: 'rate', group: 'group', item: 'item', itc: 'itc' },
    errText: 'No usable bills found. Ensure Date, Supplier and a taxable/total column are mapped.',
    headerGroups: [['date', 'bill', 'invoice', 'voucher'], ['supplier', 'vendor', 'party', 'seller', 'name', 'amount', 'taxable', 'total']],
    fields: [{ key: 'bill', label: 'Bill No.' }, { key: 'date', label: 'Date', required: true }, { key: 'sup', label: 'Supplier', required: true }, { key: 'gstin', label: 'GSTIN' }, { key: 'group', label: 'Purchase Group' }, { key: 'item', label: 'Purchase Item' }, { key: 'taxable', label: 'Taxable amount' }, { key: 'total', label: 'Total amount' }, { key: 'grate', label: 'GST %' }, { key: 'itc', label: 'ITC' }],
    requireOneOf: [['taxable', 'total']],
    autoMap: h => ({ bill: QLFin.colOf(h, 'bill no', 'invoice no', 'bill', 'invoice', 'voucher'), date: QLFin.colOf(h, 'bill date', 'invoice date', 'date'), sup: QLFin.colOf(h, 'supplier', 'vendor', 'seller', 'party', 'name'), gstin: QLFin.colOf(h, 'gstin', 'gst no', 'gst number'), group: QLFin.colOf(h, 'purchase group', 'group', 'category', 'head'), item: QLFin.colOf(h, 'purchase item', 'item', 'particular', 'description'), taxable: QLFin.colOf(h, 'taxable', 'basic', 'amount', 'value'), total: QLFin.colOf(h, 'invoice value', 'grand total', 'net amount', 'total'), grate: QLFin.colOf(h, 'gst %', 'gst%', 'gst rate', 'tax %', 'tax%', 'rate of tax', 'tax rate'), itc: QLFin.colOf(h, 'itc') }),
    buildRow: get => {
      const sup = (get('sup') || '').toString().trim(), date = QLFin.parseDate(get('date'));
      let taxable = QLFin.parseNum(get('taxable')), total = QLFin.parseNum(get('total'));
      let grate = QLFin.parseNum(get('grate')); if (!grate) grate = 5; if (grate > 0 && grate < 1) grate *= 100;
      if (!taxable && total) taxable = total / (1 + grate / 100);
      if (!sup && !taxable && !total) return null;
      let itc = 'Eligible'; const iv = (get('itc') || '').toString().toLowerCase().trim();
      if (/rcm/.test(iv)) itc = 'RCM'; else if (/inelig/.test(iv) || iv === 'no' || iv === 'n') itc = 'Ineligible';
      const raw = ((get('group') || '') + ' ' + (get('item') || '')).toLowerCase().trim();
      const out = { bill: (get('bill') || '').toString().trim(), date: date || '', sup, gstin: (get('gstin') || '').toString().trim().toUpperCase(), taxable: +(taxable || 0), grate, itc, status: 'pending' };
      if (raw) { out.cat = raw; const gm = Q.purchaseGroups.find(g => raw.includes(g.label.toLowerCase()) || g.items.some(it => raw.includes(it.toLowerCase()))); if (gm) { out.group = gm.key; out.item = gm.items.find(it => raw.includes(it.toLowerCase())) || gm.items[0]; } }
      return out;
    },
    // Dedup by bill no. + a stable supplier identity (GSTIN, else taxable amount) —
    // NOT the parsed supplier name, which can vary between OCR runs of the same bill
    // (e.g. "the buyer. For" vs "Indian Oil Corporation Limited") and let duplicates through.
    existing: () => new Set(Q.state.PURCHASES.filter(p => p.bill).map(dupKeyP)),
    keyOf: dupKeyP,
    preview: { headers: ['Bill', 'Date', 'Supplier', 'Group', 'Taxable', 'GST%'], right: [4, 5], row: p => [p.bill || '—', p.date || '—', p.sup || '—', (Q.purchaseGroups.find(g => g.key === p.group) || { label: p.cat || '—' }).label, Q.fC(p.taxable), p.grate + '%'] },
    add: (p, file) => { Q.addPurchase(p); if (file) { try { addAttach(Q.state.PURCHASES.length - 1, file, 'Invoice'); } catch (_) {} } },
    done: n => { toast('Imported ' + n + ' bill' + (n === 1 ? '' : 's'), 'ok'); QLX.refresh(); }
  });
}
