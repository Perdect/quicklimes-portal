/* ═══════════════════════════════════════════════════════════════════════
   Purchase Register — mounted on the QLX workspace engine (flagship).
   Monday-style: multiple views, collapsible groups, right-side detail panel
   with Overview / Invoice / Payments / Documents / AI / Comments tabs,
   bulk actions, per-row comments. Reuses the existing payment / attachment /
   PDF / import logic that already shipped.
   ═══════════════════════════════════════════════════════════════════════ */
const Q = window.QLD, fC = Q.fC, fmt = Q.fmt, fDS = d => Q.fDS(d);
/* Hindi pilot — see sales.js. Local alias, English fallback. */
const t = window.QLI18n ? QLI18n.t : (x => x);
const esc = QLX.esc, svg = QLX.svg, IC = QLX.icons;
const GCOL = { limestone: ['#f6f0e4', '#8a6d3b'], petcoke: ['#fdeceb', '#c0392b'], packaging: ['#eaf1ff', '#2f5fd0'], labour: ['#e9f9ee', '#1c7c3a'], maintenance: ['#f2eefb', '#6b3fa0'], utilities: ['#fff5e0', '#b7791f'], office: ['#eef2f7', '#475569'], other: ['#f1f5f9', '#64748b'] };
// Short, friendly names for the Item filter (falls back to the full item name).
// Item display names moved to data.js (Q.itemShort) so the register and the party
// ledger cannot call the same bill two different things.
const STATUSES = [['pending', 'Pending'], ['partial', 'Partial'], ['paid', 'Paid'], ['cancelled', 'Cancelled']];
const STDOT = { pending: '#f59e0b', partial: '#2563eb', paid: '#16a34a', cancelled: '#ef4444', overdue: '#ef4444' };
const toast = (m, t) => QLX.toast(m, t);

/* ── contacts ── */
function supContact(name) { return Q.partyRows().find(x => (x.name || '').toUpperCase() === (name || '').toUpperCase()) || {}; }
/* Delegates to wa-core's normalizePhone — the tested engine — never a local copy.
   The copy that was here dropped the country code on any number stored with the
   STD trunk 0 (09829069545 is ELEVEN digits, so the ===10 rule never fired) and
   handed wa.me a number that is not the supplier's. wa-core handles the trunk 0,
   the 0091 prefix and the 6-9 mobile check, and returns '' rather than guess. */
function waLink(phone, text) {
  if (window.WACore) return WACore.waLink(phone, text);
  return 'https://wa.me/?text=' + encodeURIComponent(text || '');
}

/* ── Attachments (IndexedDB, per browser) ── */
const ADB = 'ql_pur_docs'; let _adb = null;
function adb() { if (_adb) return _adb; _adb = new Promise((res, rej) => { const r = indexedDB.open(ADB, 1); r.onupgradeneeded = e => { const d = e.target.result; if (!d.objectStoreNames.contains('f')) d.createObjectStore('f'); }; r.onsuccess = e => res(e.target.result); r.onerror = () => rej(r.error); }); return _adb; }
function aOp(mode, fn) { return adb().then(d => new Promise((res, rej) => { const t = d.transaction('f', mode), o = fn(t.objectStore('f')); t.oncomplete = () => res(o && o.result !== undefined ? o.result : o); t.onerror = () => rej(t.error); })); }

/* attachWhy lives in data.js as QLAttachWhy — sales.html does not load this file,
   and both pages need the same reasons. One rule, one place. */
/* The attachment store, exposed. qty-backfill needs to re-read the ORIGINAL bill
   PDFs, and the alternative was a second copy of this IndexedDB plumbing in another
   file — the exact duplication that has caused every "one rule, two places" bug in
   this codebase. One store, one accessor. Read-only from outside. */
window.QLAttach = { get: id => aOp('readonly', st => st.get(id)), DB: ADB };

/* Delegates to Q.attachDoc — the ONE writer for both registers' doc stores.
   The copy that lived here wrote the same store with the same record shape as the
   sales one, which is two places that had to agree forever about an id prefix and
   six field names for the eye button to open anything. It also read
   Q.state.PURCHASES[idx] AFTER its await and dereferenced it unchecked, so a row
   that moved threw an async rejection into a synchronous try/catch that could not
   catch it. Q.attachDoc throws honestly; every caller here handles it. */
function addAttach(idx, file, kind) { return Q.attachDoc('purchase', idx, file, kind); }
async function openAttach(idx, id, dl) { const a = (Q.state.PURCHASES[idx].attach || []).find(x => x.id === id); if (!a) return; const b = await aOp('readonly', st => st.get(a.id)); if (!b) { toast('File not found in this browser', 'err'); return; } const url = URL.createObjectURL(b); if (dl) { const x = document.createElement('a'); x.href = url; x.download = a.name; x.click(); } else window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 4000); }
async function delAttach(idx, id) { const p = Q.state.PURCHASES[idx]; Q.updatePurchase(idx, { attach: (p.attach || []).filter(a => a.id !== id) }); try { await aOp('readwrite', st => st.delete(id)); } catch (_) {} QLX.refresh(); }

/* ── freight, edited in place ─────────────────────────────────
   Deliberately a plain prompt rather than an inline <input>: the table re-renders
   on every refresh, and an input living inside a cell that gets replaced loses what
   you typed. That focus-loss bug has already been fixed once in the invoice builder;
   there is no reason to rebuild it here for a single number. */
/* Delegated from the document, NOT bound per cell. qlx re-renders the whole table
   on every refresh, sort and filter, so anything bound to a cell is dead the moment
   the user sorts. qlx has no hook for a page to wire its own cell controls (it wires
   only its own data-st / data-act / data-more), and adding one would touch the
   engine every register runs on. Delegation costs nothing and cannot go stale.
   stopPropagation because qlx's row handlers sit above this. */
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-fr]');
  if (b) {
    e.stopPropagation(); e.preventDefault();
    editFreight(+b.dataset.fr, b);      // pass the CELL — the input is built inside it, in the row
    return;
  }
  const q = e.target.closest && e.target.closest('[data-qy]');
  if (q) {
    e.stopPropagation(); e.preventDefault();
    editQty(+q.dataset.qy, q);            // same delegation, same reason — cannot go stale
    return;
  }
  /* Enter the RATE directly — the owner knows ₹/T off the bill even when the
     tonnage was never captured. "every bill has rate." We derive and store the
     qty (taxable ÷ rate), so both columns fill from one number. */
  const rt = e.target.closest && e.target.closest('[data-rt]');
  if (!rt) return;
  e.stopPropagation(); e.preventDefault();
  editRate(+rt.dataset.rt, rt);
});

/* ── Freight: typed IN THE ROW ─────────────────────────────────
   This was a native prompt(). "when I click on freight then open popup I want to
   type in same row no need to open anythnig" — and he is right: a browser prompt is
   a modal system dialog that blocks the page, cannot be styled, says
   "app.quicklimes.com says", and looks like a virus warning. In a table of 26 bills
   it also throws away the one thing that makes inline editing worth having: you can
   see the row you are editing.

   The cell becomes an <input> in place. Enter saves, Escape cancels, blur saves —
   and the value is committed BEFORE the table repaints, because QLX.refresh()
   rebuilds every row and would otherwise destroy the input mid-edit.

   I shipped the prompt() and told him the freight cell was "verified" — having
   checked how it LOOKED and never once clicked it. Verifying the paint of a control
   is not verifying the control. */
function editFreight(idx, cell) {
  const p = Q.state.PURCHASES[idx];
  if (!p) return;
  if ((p.freightPays || []).length) {
    toast('This bill has freight payments recorded — open it and use the Freight tab', 'warn');
    return;
  }
  const host = cell || document.querySelector('[data-fr="' + idx + '"]');
  if (!host || host.querySelector('input')) return;            // already editing
  const cur = +p.freightAmt || 0;

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.inputMode = 'decimal';                                   // phone shows a number pad
  inp.className = 'pfr-inp';
  inp.value = cur > 0 ? String(cur) : '';
  inp.placeholder = '0';
  inp.setAttribute('aria-label', 'Freight on bill ' + (p.bill || ''));

  const prev = host.innerHTML;
  host.innerHTML = '';
  host.appendChild(inp);
  inp.focus(); inp.select();

  let done = false;
  const restore = () => { if (!done) { done = true; host.innerHTML = prev; } };

  const commit = () => {
    if (done) return; done = true;
    const t = (inp.value || '').trim();
    if (t === '' && cur === 0) { host.innerHTML = prev; return; }        // nothing typed, nothing to do
    if (t === '') { Q.updatePurchase(idx, { freightAmt: 0 }); toast('Freight cleared'); QLX.refresh(); return; }
    const n = QLFin.parseNum(t);
    /* Refuse junk rather than storing 0 — a silent 0 would read as "no freight",
       which is a different fact from "I typed something wrong". */
    if (!(n > 0)) { toast('“' + t + '” is not an amount — nothing saved', 'err'); host.innerHTML = prev; return; }
    if (n === cur) { host.innerHTML = prev; return; }                    // unchanged — no toast, no write
    Q.updatePurchase(idx, { freightAmt: n });
    const row = Q.purchaseRows().find(r => r.idx === idx);
    toast('Freight ' + fC(n) + ' · landed cost ' + fC(row ? row.landed : 0), 'ok');
    QLX.refresh();
  };

  inp.onkeydown = e => {
    e.stopPropagation();                                       // Esc must not close the drawer behind it
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); restore(); }
  };
  inp.onblur = commit;
  inp.onclick = e => e.stopPropagation();                      // clicking the field must not open the bill
}

/* ── inline QUANTITY editor — the freight editor's sibling ─────────
   "still not show some bills per tone rate": the rate is DERIVED from
   taxable ÷ qty, and a whole class of bills legitimately has no qty for the
   machine to find — CSV/Tally imports carry no scan at all, and uploaded
   scans live in THIS BROWSER's IndexedDB, so qty-backfill cannot read a PDF
   that sits on the other device. Those rows dashed forever, and the only
   repair was the full Edit modal. Now the tonnage is typed where the dash
   is, and the rate appears on the same refresh. A typed number is exactly
   what qty-backfill treats as sacred — a human's qty is never overruled. */
function editQty(idx, cell) {
  const p = Q.state.PURCHASES[idx];
  if (!p) return;
  const host = cell || document.querySelector('[data-qy="' + idx + '"]');
  if (!host || host.querySelector('input')) return;            // already editing
  const cur = +p.qty || 0;

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.inputMode = 'decimal';
  inp.className = 'pfr-inp';
  inp.value = cur > 0 ? String(cur) : '';
  inp.placeholder = '0 T';
  inp.setAttribute('aria-label', 'Quantity (tonnes) on bill ' + (p.bill || ''));

  const prev = host.innerHTML;
  host.innerHTML = '';
  host.appendChild(inp);
  inp.focus(); inp.select();

  let done = false;
  const restore = () => { if (!done) { done = true; host.innerHTML = prev; } };

  const commit = () => {
    if (done) return; done = true;
    const t = (inp.value || '').trim();
    if (t === '' && cur === 0) { host.innerHTML = prev; return; }
    if (t === '') { Q.updatePurchase(idx, { qty: 0 }); toast('Quantity cleared'); QLX.refresh(); return; }
    const n = QLFin.parseNum(t);
    if (!(n > 0)) { toast('“' + t + '” is not a tonnage — nothing saved', 'err'); host.innerHTML = prev; return; }
    if (n === cur) { host.innerHTML = prev; return; }
    Q.updatePurchase(idx, { qty: n });
    /* The point of typing the tonnage: the rate exists now. Say it. */
    const tax = +p.taxable || 0;
    toast('Qty ' + fmt(n, 2) + ' T' + (tax > 0 ? ' · rate ' + fC(Math.round(tax / n)) + '/T' : ''), 'ok');
    QLX.refresh();
  };

  inp.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); restore(); }
  };
  inp.onblur = commit;
  inp.onclick = e => e.stopPropagation();
}

/* ── inline RATE editor — the qty editor's mirror ─────────────────
   "every bill has rate": the owner reads ₹/T straight off the bill even when
   the tonnage was never captured. Typing the rate here derives and STORES the
   quantity (qty = taxable ÷ rate) — the base field stays qty, so the rate
   column keeps deriving back to the number he typed and the qty column fills
   in too. One number, both columns. Refuses when there is no taxable to divide
   (a rate with nothing to apply it to is not a rate). */
function editRate(idx, cell) {
  const p = Q.state.PURCHASES[idx];
  if (!p) return;
  const tax = +p.taxable || 0;
  const host = cell || document.querySelector('[data-rt="' + idx + '"]');
  if (!host || host.querySelector('input')) return;
  if (!(tax > 0)) { toast('This bill has no taxable amount — add the amount first', 'warn'); return; }
  const curQty = +p.qty || 0;
  const curRate = curQty > 0 ? Math.round(tax / curQty) : 0;

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.inputMode = 'decimal';
  inp.className = 'pfr-inp';
  inp.value = curRate > 0 ? String(curRate) : '';
  inp.placeholder = '₹/T';
  inp.setAttribute('aria-label', 'Rate per tonne on bill ' + (p.bill || ''));

  const prev = host.innerHTML;
  host.innerHTML = '';
  host.appendChild(inp);
  inp.focus(); inp.select();

  let done = false;
  const restore = () => { if (!done) { done = true; host.innerHTML = prev; } };
  const commit = () => {
    if (done) return; done = true;
    const s = (inp.value || '').trim();
    if (s === '') { host.innerHTML = prev; return; }
    const rate = QLFin.parseNum(s);
    if (!(rate > 0)) { toast('“' + s + '” is not a rate — nothing saved', 'err'); host.innerHTML = prev; return; }
    if (rate === curRate) { host.innerHTML = prev; return; }     // unchanged
    const qty = Math.round(tax / rate * 100) / 100;              // derive the tonnage
    Q.updatePurchase(idx, { qty });
    toast('Rate ' + fC(rate) + '/T · qty ' + fmt(qty, 2) + ' T', 'ok');
    QLX.refresh();
  };
  inp.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); restore(); }
  };
  inp.onblur = commit;
  inp.onclick = e => e.stopPropagation();
}

/* ── read the tonnage back off the bills already uploaded ──────
   There is no button for this any more. "no need to read quantities separate when
   uploaded documents then read same time" — and for new uploads that is already
   how it works: the importer maps qty at import. The only bills that need this are
   the ones imported BEFORE that fix, which carry no tonnage and show "—" in
   Production. Asking him to press a button to repair an old bug is not a feature.

   So it runs itself, once per bill, on idle. QLQtyBackfill owns the rules: the
   arithmetic gate decides every write, a human's number is never overruled, and
   anything that does not reconcile stays a dash. It must SAY what it did — a
   background job that writes to the books in silence is the ai-status bug. */
function runQtyBackfill() {
  if (!window.QLQtyBackfill) return;
  QLQtyBackfill.auto().then(o => {
    const msg = QLQtyBackfill.report(o);
    if (!msg) return;                    // nothing read and nothing refused — nothing to say
    toast(msg, o.wrote ? 'ok' : 'err');
    if (o.wrote) QLX.refresh();          // the Qty column has new numbers in it
  });
}

/* ── row action helpers (mutations) ── */
function setStatus(r, val) { const patch = { status: val }; if (val === 'paid') patch.paid = r.total; else if (val === 'pending') patch.paid = 0; Q.updatePurchase(r.idx, patch); }
function markPaid(r) { Q.recordPurchasePayment(r.idx, r.outstanding, 'bank'); toast('Marked paid', 'ok'); QLX.refresh(); }
function dupBill(r) { const p = Q.state.PURCHASES[r.idx]; Q.addPurchase(Object.assign({}, p, { bill: (p.bill || '') + '-COPY', status: 'pending', paid: 0, payments: [], attach: [] })); toast('Bill duplicated'); QLX.refresh(); }
function delBill(r) { QLShell.confirmDelete({ title: 'Move bill to Trash?', desc: (r.bill ? 'Bill ' + r.bill : 'This bill') + ' for ' + Q.fC(r.total) + ' · ' + r.sup + ' will move to Trash and can be restored for 90 days.', confirmLabel: 'Move to Trash', onConfirm: reason => { Q.deletePurchase(r.idx, reason); toast('Moved to Trash'); QLX.refresh(); } }); }
function voidBill(r) {
  if (r.status === 'cancelled') { toast('This bill is already voided'); return; }
  QLShell.confirmDelete({
    title: 'Void bill ' + (r.bill || '') + '?',
    desc: 'Bill ' + (r.bill || '') + ' for ' + Q.fC(r.total) + ' · ' + r.sup + ' will be marked Cancelled. The document is kept for ITC & audit, and it drops out of live purchase totals. This is the compliant alternative to deleting a posted bill.',
    reasonLabel: 'Reason for voiding', reasonPh: 'e.g. wrong supplier · duplicate · returned', confirmLabel: 'Void bill',
    onConfirm: reason => { const res = Q.voidRecord('purchase', r.idx, reason); if (res.ok) { toast('Bill voided'); QLX.refresh(); } else { toast(res.err || 'Could not void'); } }
  });
}
function shareBill(r) { const co = supContact(r.sup); window.open(waLink(co.phone || '', `Purchase bill ${r.bill || ''} — ${r.item} · ${fC(r.total)} · ${r.status}`), '_blank'); }
function copyLink(r) { const text = `${Q.co.short} · Bill ${r.bill || ''} · ${r.sup} · ${r.item} · ${fC(r.total)} · ${r.status}`; (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Bill summary copied'), () => toast('Copy not available', 'err')); }

/* ── cell chips ── */
function stCell(r) { const st = r.isOverdue ? 'overdue' : r.status; return `<select class="qx-st s-${st}" data-st="${r.idx}" onclick="event.stopPropagation()">${STATUSES.map(s => `<option value="${s[0]}" ${s[0] === r.status ? 'selected' : ''}>${r.isOverdue && s[0] === 'pending' ? 'Overdue' : s[1]}</option>`).join('')}</select>`; }
function stPill(r) { const st = r.isOverdue ? 'overdue' : r.status; return `<span class="qx-pill s-${st}">${st[0].toUpperCase() + st.slice(1)}</span>`; }
function groupChip(r) { const gc = GCOL[r.group] || GCOL.other; return `<span class="qx-pill" style="background:${gc[0]};color:${gc[1]}">${r.emoji} ${esc(r.groupLabel)}</span>`; }
function supCell(r) { return `<span class="qx-party-n" style="font-weight:600">${esc(r.sup)}</span>`; }
/* No freight badge here. It used to carry the amount because the Freight column
   was off the right edge of a register wider than the screen — but the amount now
   appears twice more on the same row (in Freight, and inside Landed cost), and a
   number printed three times invites the reader to add two of them together.
   A dedicated freight-item bill still says so: there the freight IS the purchase,
   and no amount is repeated. */
function itemCell(r) {
  const frt = (r.freight && !(r.freightAddon > 0)) ? ' <span class="qx-frt">freight</span>' : '';
  return `<span class="qx-party"><span class="qx-party-n">${esc(Q.itemShort(r.item))}</span></span>${frt}`;
}

/* ══════════════════ PDF (drawer/print) ══════════════════ */
function billHTML(r) {
  const co = Q.co || {}, cg = r.gst / 2, money = n => '₹' + fmt(n);
  const inter = (r.gstin || '').length >= 2 && (r.gstin || '').slice(0, 2) !== '08';   // supplier out-of-state → IGST
  const rcm = r.itc === 'RCM';
  const gstRows = rcm
    ? `<div class="row"><span>GST @ ${r.grate}% — under RCM (payable by recipient)</span><span>${money(r.gst)}</span></div>`
    : inter
      ? `<div class="row"><span>IGST @ ${r.grate}%</span><span>${money(r.gst)}</span></div>`
      : `<div class="row"><span>CGST @ ${r.grate / 2}%</span><span>${money(cg)}</span></div><div class="row"><span>SGST @ ${r.grate / 2}%</span><span>${money(cg)}</span></div>`;
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
      <div style="text-align:right"><div class="lbl">ITC</div><div class="nm">${r.itc ? 'Eligible' : '—'}</div></div></div>
    <table><thead><tr><th>Purchase Group / Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Taxable</th></tr></thead>
      <tbody><tr><td>${esc(r.emoji + ' ' + r.groupLabel)}<div class="it">${esc(r.item)}${r.desc ? ' — ' + esc(r.desc) : ''}</div></td><td class="r">${r.qty ? fmt(r.qty, 2) + (r.unit ? ' ' + esc(r.unit) : '') : '—'}</td><td class="r">${r.rate ? money(r.rate) : '—'}</td><td class="r">${money(r.taxable)}</td></tr></tbody></table>
    <div class="tot"><div class="row"><span>Taxable value</span><span>${money(r.taxable)}</span></div>${gstRows}<div class="row g"><span>Total${rcm ? ' payable' : ''}</span><span>${money(r.total)}</span></div>${r.freightAddon ? `<div class="row"><span>Freight / transport (add-on)</span><span>${money(r.freightAddon)}</span></div><div class="row g"><span>Landed cost</span><span>${money(r.total + r.freightAddon)}</span></div>` : ''}</div>
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
    } catch (e) { if (w) w.close(); console.warn('[bill] open failed', e); toast('Could not open the bill — ' + QLAttachWhy(e), 'err'); return; }
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
    } catch (e) { if (w) w.close(); console.warn('[bill] open failed', e); toast('Could not open the bill — ' + QLAttachWhy(e), 'err'); return; }
  }
  // no upload on this bill → the generated bill. On phones open it as a full-screen
  // PDF (like the sales invoice); on desktop keep the in-app preview drawer.
  if (isMobileP() && window.QLMobile && QLMobile.invoiceViewer) return mobileBillViewer(r);
  QLX.viewDoc({ eyebrow: 'Purchase bill', title: 'Bill ' + (r.bill || '—'), sub: r.sup + ' · generated (no file uploaded)', html: billHTML(r), onPrint: () => pdfWindow(r), onShare: () => shareBill(r) });
}

/* ══════════════════ DETAIL PANEL TABS ══════════════════ */
/* ══════════════════ Purchase Bill drawer (glass) ══════════════════
   Lucide paths, inlined. The spec asked for Lucide-the-React-package; this app
   has no build step, so the icons arrive the only way they can — as their path
   data. Same glyphs, no bundler. */
const PB = {
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1V2l-2 1-2-1-2 1-2-1-2 1-2-1z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  trend: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><path d="M17 12h.01"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h6a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6"/>'
};
const psvg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

/* Status is one of four states, and "overdue" is not a stored status — it is a
   pending bill whose due date has passed. purchaseRows computes isOverdue. */
function pbStatus(r) {
  if (r.status === 'cancelled') return { cls: 'pb-st-void', label: 'Cancelled' };
  if (r.status === 'paid') return { cls: 'pb-st-paid', label: 'Paid' };
  if (r.isOverdue) return { cls: 'pb-st-over', label: 'Overdue' };
  if (r.status === 'partial') return { cls: 'pb-st-pend', label: 'Part paid' };
  return { cls: 'pb-st-pend', label: 'Pending' };
}
/* No logo service is called and none is invented: a fabricated logo would be a
   claim about a real company. The initial on a brand gradient is honest. */
function pbAvatar(r) { return `<div class="qx-dp-av">${esc(((r.sup || '?').trim()[0] || '?').toUpperCase())}</div>`; }

/* ── the summary rail ── */
function pbAside(r) {
  const st = pbStatus(r), landed = r.landed != null ? r.landed : r.total + (r.freightAddon || 0);
  const row = (l, v, ic) => `<div class="pb-row"><span>${ic ? psvg(ic) : ''}${l}</span><b>${v}</b></div>`;
  const due = r.dueDate ? fDS(r.dueDate) : null;
  /* EVERY ROW HERE MUST EARN ITS PLACE.
     The first version printed ₹8,89,529 FOUR times — Net payable, Bill amount,
     Landed cost and Outstanding are the same figure on a bill with no freight
     and no payments — and ₹42,359 twice, because a fully-claimable ITC equals
     the GST. Nine rows, three facts. Repetition doesn't read as thorough, it
     reads as noise, and it buries the two numbers that matter.

     So a row appears only when it says something the rail hasn't already said:
       - Outstanding is GONE: the hero IS the outstanding figure.
       - Freight and Landed cost appear only when there IS freight; without it
         landed cost is just the bill amount under a longer name.
       - "Paid so far" appears only once something has been paid.
       - ITC folds into the GST line when the two are equal (the usual case) —
         "GST @ 5% · claimable" says both facts with one number.
     And the card is now a real BREAKDOWN: taxable + GST = bill, + freight =
     landed. Arithmetic the reader can follow, rather than a list of figures
     that happen to sit together. */
  const hasFreight = r.freightAddon > 0;
  const itcSame = r.itc > 0 && Math.abs(r.itc - r.gst) < 1;
  return `<div class="pb-sum">
      <div class="pb-sum-l">Net payable</div>
      <div class="pb-sum-v">${fC(r.outstanding)}</div>
      <div class="pb-sum-s">${r.outstanding > 0 ? 'owed to ' + esc(r.sup) : 'settled in full'}${r.paid > 0 && r.outstanding > 0 ? ' · ' + fC(r.paid) + ' paid' : ''}</div>
    </div>
    <div class="pb-card">
      <div class="pb-card-h">${psvg(PB.receipt)}Breakdown</div>
      ${row('Taxable', fC(r.taxable), PB.wallet)}
      ${row('GST @ ' + r.grate + '%' + (itcSame ? ' · claimable' : ''), fC(r.gst), itcSame ? PB.shield : null)}
      ${!itcSame && r.itc > 0 ? row('of which ITC', fC(r.itc), PB.shield) : ''}
      ${!itcSame && !r.itc && r.gst > 0 ? row('ITC', 'not claimed', PB.shield) : ''}
      ${hasFreight ? `<div class="pb-row pb-row-sub"><span>Bill amount</span><b>${fC(r.total)}</b></div>` : ''}
      ${hasFreight ? row('Freight', fC(r.freightAddon), IC.truck) : ''}
      <div class="pb-row pb-row-tot"><span>${hasFreight ? 'Landed cost' : 'Bill amount'}</span><b>${fC(hasFreight ? landed : r.total)}</b></div>
    </div>
    ${payCard(r, st, due, row)}`;
}
/* ONE FACT LIVES HERE, AND ONLY WHEN IT IS TRUE: how far overdue the bill is.
   Everything else a payment card wants to say is already on the screen —
     "Status: Pending"  -> the badge in the header
     "Due date"         -> the Invoice Details row, three inches to the left
     "Paid so far"      -> the hero's own sub-line ("... · ₹3,00,000 paid")
     "Outstanding"      -> the hero IS the outstanding figure
   My first attempt at trimming this card still printed ₹3,00,000 twice and the
   bill amount twice, which is the same mistake in a smaller box. A card whose
   rows are all printed elsewhere is furniture; delete it.
   "Overdue by 12 days" is the one thing nothing else says — the badge conveys
   urgency but never how much. */
function payCard(r, st, due, row) {
  if (!r.isOverdue) return '';
  return `<div class="pb-card" style="border-color:var(--ql-danger-500)">
      <div class="pb-card-h">${psvg(IC.clock)}Overdue</div>
      ${row('Late by', Math.max(1, Q.daysAgo(r.dueDate)) + ' days')}
      ${due ? row('Was due', due) : ''}
    </div>`;
}

/* ── Overview ── */
function tabOverview(r) {
  const co = supContact(r.sup), phone = co.phone || '';
  const rows = Q.purchaseRows();
  const landed = r.landed != null ? r.landed : r.total + (r.freightAddon || 0);
  const pct = n => landed > 0 ? (n / landed * 100) : 0;

  /* Supplier history — real rows, not a rating out of five. There is no supplier
     rating in this system, and inventing one would put a number the app cannot
     defend next to a real company's name. What it CAN say is what actually
     happened: how many bills, how much, and when the last one was. */
  const hist = rows.filter(x => x.sup === r.sup && x.status !== 'cancelled');
  const prev = hist.filter(x => x.date < r.date).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const spend = hist.reduce((a, x) => a + x.total, 0);

  const comm = `<div class="qx-comm" style="margin-top:10px">
    ${phone ? `<a class="wa" href="${waLink(phone, 'Regarding bill ' + (r.bill || '') + ' — ' + r.item)}" target="_blank">${svg(IC.wa)} WhatsApp</a>` : ''}
    ${phone ? `<a class="call" href="tel:${esc(phone)}">${svg(IC.call)} Call</a>` : ''}
    ${co.email ? `<a class="mail" href="mailto:${esc(co.email)}">${svg(IC.mail)} Email</a>` : ''}
    ${!phone && !co.email ? `<button class="pb-ask" id="pbAddContact">+ Add supplier contact</button>` : ''}
  </div>`;

  const kpi = (ic, cls, label, val, delta, dcls) => `<div class="pb-kpi">
    <div class="pb-kpi-i ${cls}">${psvg(ic)}</div>
    <div class="pb-kpi-l">${label}</div><div class="pb-kpi-v">${val}</div>
    ${delta ? `<div class="pb-kpi-d ${dcls || 'pb-flat'}">${delta}</div>` : ''}</div>`;

  /* rate vs the last purchase of the same item from the same supplier — the
     "price comparison" the spec asks for, computed from the firm's own bills */
  const prevSame = rows.filter(x => x.sup === r.sup && x.item === r.item && x.date < r.date && x.rate > 0)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const rateD = prevSame && r.rate > 0 ? (r.rate - prevSame.rate) / prevSame.rate * 100 : null;

  /* monthly spend for this group — last 6 months that exist in the data */
  const byMonth = {};
  rows.filter(x => x.group === r.group && x.status !== 'cancelled').forEach(x => {
    const m = (x.date || '').slice(0, 7); if (m) byMonth[m] = (byMonth[m] || 0) + x.total + (x.freightAddon || 0);
  });
  const months = Object.keys(byMonth).sort().slice(-6);
  const peak = Math.max(...months.map(m => byMonth[m]), 1);
  const thisM = (r.date || '').slice(0, 7);
  const trend = months.length > 1 ? `<div class="pb-card">
      <div class="pb-card-h">${psvg(PB.trend)}${esc(r.groupLabel)} spend · last ${months.length} months</div>
      <div class="pb-tr">${months.map(m => `<div class="pb-tr-c">
        <div class="pb-tr-b ${m === thisM ? 'now' : ''}" style="height:${Math.max(3, byMonth[m] / peak * 74)}px" title="${esc(m)} · ${fC(byMonth[m])}"></div>
        <div class="pb-tr-x">${esc(m.slice(5) + '/' + m.slice(2, 4))}</div></div>`).join('')}</div>
      <div class="qx-mut" style="font-size:11.5px;margin-top:8px">Landed spend per month · this bill's month highlighted.</div>
    </div>` : '';

  const ins = Q.billInsights(r.idx) || [];
  const tone = { danger: ['pb-i-r', IC.ban], warn: ['pb-i-a', IC.clock], ok: ['pb-i-g', IC.check], info: ['pb-i-b', PB.shield] };

  return `<div class="pb-card">
      <div class="pb-card-h">${psvg(PB.user)}Supplier</div>
      <div style="font-weight:700;font-size:15.5px;letter-spacing:-.01em">${esc(r.sup)}</div>
      <div class="qx-mut" style="font-size:12.5px;margin-top:3px">${r.gstin ? 'GSTIN ' + esc(r.gstin) : 'No GSTIN on file'}${co.name && co.contact ? ' · ' + esc(co.contact) : ''}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px">
        <div><div class="pb-kpi-l">Bills</div><div style="font-weight:700">${hist.length}</div></div>
        <div><div class="pb-kpi-l">Total spend</div><div style="font-weight:700">${fC(spend)}</div></div>
        <div><div class="pb-kpi-l">Last purchase</div><div style="font-weight:700">${prev ? fDS(prev.date) : '—'}</div></div>
      </div>
      ${comm}
    </div>

    <div class="pb-card">
      <div class="pb-card-h">${psvg(PB.receipt)}Invoice details</div>
      <div class="pb-row"><span>Invoice / Bill No</span><b>${esc(r.bill || '—')}</b></div>
      <div class="pb-row"><span>Invoice date</span><b>${fDS(r.date)}</b></div>
      <div class="pb-row"><span>Due date</span><b>${r.dueDate ? fDS(r.dueDate) : '—'}</b></div>
      <div class="pb-row"><span>Category</span><b>${r.emoji} ${esc(r.groupLabel)} → ${esc(r.item)}</b></div>
      ${r.veh ? `<div class="pb-row"><span>Vehicle</span><b>🚚 ${esc(r.veh)}</b></div>` : ''}
      <div class="pb-row"><span>Created by</span><b>${esc(r.createdBy)}</b></div>
      <div class="pb-row"><span>${psvg(PB.pin)}Plant</span><b>${esc(Q.co.short || Q.co.name || '—')}</b></div>
    </div>

    <div class="pb-card">
      <div class="pb-card-h">${psvg(PB.wallet)}Financial summary</div>
      <div class="pb-kpis">
        ${kpi(PB.receipt, 'pb-i-b', 'Taxable', fC(r.taxable), pct(r.taxable).toFixed(0) + '% of landed', 'pb-flat')}
        ${kpi(PB.pie, 'pb-i-n', 'GST @ ' + r.grate + '%', fC(r.gst), pct(r.gst).toFixed(0) + '% of landed', 'pb-flat')}
        ${kpi(PB.shield, 'pb-i-g', 'ITC', r.itc ? fC(r.itc) : '—', r.itc ? 'recoverable' : 'not claimed', r.itc ? 'pb-dn' : 'pb-flat')}
        ${kpi(IC.truck, 'pb-i-a', 'Freight', r.freightAddon > 0 ? fC(r.freightAddon) : '—', r.freightAddon > 0 ? pct(r.freightAddon).toFixed(1) + '% of landed' : 'none recorded', 'pb-flat')}
        ${kpi(PB.wallet, 'pb-i-b', 'Grand total', fC(r.total), 'bill value', 'pb-flat')}
        ${kpi(PB.trend, 'pb-i-b', 'Landed cost', fC(landed), rateD != null ? (rateD > 0 ? '▲ ' : '▼ ') + Math.abs(rateD).toFixed(1) + '% rate vs last' : 'first purchase', rateD == null ? 'pb-flat' : rateD > 0 ? 'pb-up' : 'pb-dn')}
      </div>
      ${r.qty ? `<div class="pb-row" style="margin-top:10px"><span>Effective landed rate</span><b>${fC(landed / r.qty)} / ${esc(r.unit || 'MT')}${prevSame ? ' · was ' + fC(prevSame.rate) : ''}</b></div>` : ''}
    </div>

    <div class="pb-card">
      <div class="pb-card-h">${psvg(PB.pie)}Cost breakdown</div>
      <div class="pb-bar">
        <i style="width:${pct(r.taxable)}%;background:var(--ql-brand-500)"></i>
        <i style="width:${pct(r.gst)}%;background:var(--ql-neutral-400)"></i>
        <i style="width:${pct(r.freightAddon || 0)}%;background:var(--ql-warning-500)"></i>
      </div>
      <div class="pb-leg">
        <span><i style="background:var(--ql-brand-500)"></i>Material ${fC(r.taxable)} · ${pct(r.taxable).toFixed(0)}%</span>
        <span><i style="background:var(--ql-neutral-400)"></i>GST ${fC(r.gst)} · ${pct(r.gst).toFixed(0)}%</span>
        ${r.freightAddon > 0 ? `<span><i style="background:var(--ql-warning-500)"></i>Freight ${fC(r.freightAddon)} · ${pct(r.freightAddon).toFixed(1)}%</span>` : ''}
      </div>
    </div>

    ${trend}

    <div class="pb-ai">
      <div class="pb-card-h" style="margin-bottom:8px">${psvg(PB.sparkle)}AI insights</div>
      ${ins.map(i => { const t = tone[i.tone] || tone.info; return `<div class="pb-ins"><span class="pb-ins-i ${t[0]}">${svg(t[1])}</span><span>${esc(i.text)}</span></div>`; }).join('')}
    </div>`;
}
function wireOverview(body, r) {
  const b = document.getElementById('pbAddContact');
  if (b) b.onclick = () => { location.href = 'parties.html?add=' + encodeURIComponent(r.sup); };
}
function pdfByIdx(idx) { openBillPdf(Q.purchaseRows()[idx]); }
function shareByIdx(idx) { shareBill(Q.purchaseRows()[idx]); }
/* Invoice tab — show THE SUPPLIER'S ACTUAL UPLOADED BILL when we have one.
   We never issued this document (IOC did), so rendering our own letterhead
   version of it is confusing and misrepresents the source. The generated
   summary is only a fallback for bills with no upload, and is labelled as
   a summary rather than dressed up as the bill. */
function tabInvoice(r) {
  const doc = (r.attach || []).find(a => /invoice|bill|scan/i.test((a.kind || '') + ' ' + (a.name || ''))) || (r.attach || [])[0];
  if (doc) {
    return `<div class="qx-inv-bar">
        <button class="qx-btn qx-btn-sm" onclick="openAttach(${r.idx},'${doc.id}',1)">${svg(IC.dl)} Download</button>
        <button class="qx-btn qx-btn-sm" onclick="openAttach(${r.idx},'${doc.id}',0)">${svg(IC.eye)} Open</button>
        <button class="qx-btn qx-btn-sm" onclick="shareByIdx(${r.idx})">${svg(IC.share)} Share</button>
        <span class="qx-mut" style="margin-left:auto;font-size:11.5px">📎 ${esc(doc.name)}</span>
      </div>
      <div class="qx-inv-frame" id="pxDocFrame" data-doc="${doc.id}" style="display:grid;place-items:center;color:var(--ql-text-secondary);font-size:12.5px">Loading the uploaded bill…</div>`;
  }
  return `<div class="qx-inv-bar"><button class="qx-btn qx-btn-sm" onclick="pdfByIdx(${r.idx})">${svg(IC.dl)} Download</button><button class="qx-btn qx-btn-sm" onclick="pdfByIdx(${r.idx})">${svg(IC.print)} Print</button><button class="qx-btn qx-btn-sm" onclick="shareByIdx(${r.idx})">${svg(IC.share)} Share</button>
      <span class="qx-mut" style="margin-left:auto;font-size:11.5px">No bill uploaded — summary from the entered data</span></div>
    <iframe class="qx-inv-frame" srcdoc="${esc(billHTML(r))}" title="bill summary"></iframe>`;
}
/* Render the uploaded PDF/image inline (blob from IndexedDB). */
async function wireInvoice(body, r) {
  const host = (body || document).querySelector('#pxDocFrame'); if (!host) return;
  const a = (r.attach || []).find(x => x.id === host.dataset.doc); if (!a) return;
  try {
    const blob = await aOp('readonly', st => st.get(a.id));
    if (!blob) { host.textContent = 'This file was uploaded on another device — re-upload it here to preview.'; return; }
    const url = URL.createObjectURL(blob);
    const isImg = /^image\//.test(blob.type || '') || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(a.name || '');
    host.innerHTML = isImg
      ? `<img src="${url}" alt="${esc(a.name)}" style="max-width:100%;max-height:100%;object-fit:contain">`
      : `<iframe src="${url}#toolbar=1" title="${esc(a.name)}" style="width:100%;height:100%;border:0;border-radius:13px"></iframe>`;
    host.style.display = 'block';
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) { console.warn('[bill] preview failed', e); host.textContent = 'Could not open the bill — ' + QLAttachWhy(e) + '.'; }
}
/* ── Freight tab: every truck's freight payment (cash / UPI / bank), living on
   the bill so landed cost = material + freight. Posts to the Payments ledger. */
function tabFreight(r) {
  const rows = r.freightPays || [];
  const ft = rows.length ? rows.reduce((s, f) => s + (+f.amount || 0), 0) : (r.freightAmt || 0);
  const landed = r.landed != null ? r.landed : r.total + (r.freightAddon || 0);
  const perMT = r.qty ? landed / r.qty : 0;

  /* One card per consignment. The spec wanted a tracking status; there is no
     GPS feed and no carrier API behind this app, so inventing "In transit" would
     be a moving graphic that knows nothing. What the firm actually knows is
     whether the transporter has been PAID — that is the state shown, and it is
     true. Driver/LR render only when recorded; blank rows are not printed. */
  const card = f => {
    const bank = f.accountId && Q.bankAccountLabel ? Q.bankAccountLabel(f.accountId) : '';
    const bits = [
      f.veh ? ['Vehicle', '🚚 ' + esc(f.veh)] : null,
      f.lr ? ['LR / consignment no', esc(f.lr)] : null,
      f.driver ? ['Driver', esc(f.driver) + (f.driverPhone ? ` · <a href="tel:${esc(f.driverPhone)}">${esc(f.driverPhone)}</a>` : '')] : null,
      f.paidTo ? ['Transporter', esc(f.paidTo)] : null,
      ['Paid via', esc(f.method) + (bank ? ' · ' + esc(bank) : '')],
      f.ref ? ['Reference', esc(f.ref)] : null
    ].filter(Boolean);
    return `<div class="pb-card">
      <div class="pb-card-h">${svg(IC.truck)}${fDS(f.date)}
        <span class="pb-h-act"><span class="pb-st pb-st-paid">Paid</span></span>
      </div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:8px">
        <div style="font-size:20px;font-weight:700;letter-spacing:-.02em">${fC(f.amount)}</div>
        <button class="qx-ib" data-fr-del="${esc(f.id)}" title="Remove freight payment">✕</button>
      </div>
      ${bits.map(b => `<div class="pb-row"><span>${b[0]}</span><b>${b[1]}</b></div>`).join('')}
      ${!f.lr || !f.driver ? `<button class="pb-ask" data-fr-edit="${esc(f.id)}" style="margin-top:10px">+ Add ${[!f.lr ? 'LR no' : '', !f.driver ? 'driver' : ''].filter(Boolean).join(' / ')}</button>` : ''}
    </div>`;
  };

  const list = rows.length ? rows.map(card).join('')
    : (r.freightAmt ? `<div class="pb-card"><div class="pb-card-h">${svg(IC.truck)}Freight on the bill</div>
        <div class="pb-row"><span>Entered on the bill · no payment detail recorded</span><b>${fC(r.freightAmt)}</b></div></div>`
      : `<div class="pb-empty">
          <div class="pb-empty-i">${svg(IC.truck)}</div>
          <div class="pb-empty-t">No freight on this bill yet</div>
          <div class="pb-empty-s">Record what the transporter was paid and it rolls into landed cost, posts to the Payments ledger, and becomes matchable against your bank statement.</div>
          <button class="qx-btn qx-btn-primary qx-btn-sm" id="pxFrAdd2" style="margin-top:12px">+ Add freight payment</button>
        </div>`);

  return `<div class="pb-card">
      <div class="pb-card-h">${psvg(PB.route)}Landed cost</div>
      <div class="pb-row"><span>Material (bill total)</span><b>${fC(r.total)}</b></div>
      <div class="pb-row"><span>Freight${rows.length > 1 ? ' · ' + rows.length + ' payments' : ''}</span><b>${fC(ft)}</b></div>
      <div class="pb-row pb-row-tot"><span>Landed cost</span><b>${fC(landed)}</b></div>
      ${r.qty ? `<div class="pb-row"><span>Effective rate</span><b>${fC(perMT)} / ${esc(r.unit || 'MT')}</b></div>` : ''}
      <div class="qx-mut" style="font-size:11.5px;margin-top:8px">Freight is an expense (no ITC) — the bill's own GST is untouched. Each payment also appears in the Payments ledger${rows.some(f => f.accountId) ? ' with its bank account' : ''}.</div>
    </div>
    ${rows.length ? `<button class="qx-btn qx-btn-primary qx-btn-sm" id="pxFrAdd" style="margin-bottom:14px">+ Add freight payment</button>` : ''}
    ${list}`;
}

/* ── Audit trail: who touched this bill, from the real audit log ── */
function tabAudit(r) {
  /* Audit rows are FLAT — ts/action/module/recId/ref/party/amount/by — not
     nested under `meta`, and the stamp is `ts`. A bill is identified by its
     number: logAudit records it as `ref` for payments/freight and as `recId`
     for the bill row itself. */
  const all = (Q.auditRows ? Q.auditRows() : []) || [];
  const ref = (r.bill || '').toUpperCase();
  const mine = !ref ? [] : all.filter(a =>
    String(a.ref || '').toUpperCase() === ref || String(a.recId || '').toUpperCase() === ref
  ).slice(0, 40);
  if (!mine.length) return `<div class="pb-empty">
      <div class="pb-empty-i">${svg(IC.activity)}</div>
      <div class="pb-empty-t">No recorded activity for this bill</div>
      <div class="pb-empty-s">Edits, payments and freight entries are logged here as they happen. Bills imported before the audit log started have no history to show — nothing is hidden.</div>
    </div>`;
  const verb = { create: 'created', update: 'edited', delete: 'deleted', void: 'voided', restore: 'restored' };
  return `<div class="pb-card"><div class="pb-card-h">${svg(IC.activity)}Audit trail · ${mine.length} event${mine.length === 1 ? '' : 's'}</div>
    <div class="pb-tl">${mine.map((a, i) => `<div class="pb-tl-i ${i === 0 ? 'now' : 'done'}">
      <div class="pb-tl-t">${esc(verb[a.action] || a.action || 'changed')} · ${esc(a.module || '')}${a.amount ? ' · ' + fC(a.amount) : ''}</div>
      <div class="pb-tl-s">${esc(a.ts ? fDS(String(a.ts).slice(0, 10)) : '')}${a.by ? ' · ' + esc(a.by) : ''}${a.role ? ' (' + esc(a.role) + ')' : ''}${a.party ? ' · ' + esc(a.party) : ''}</div>
    </div>`).join('')}</div></div>`;
}
function freightForm(r) {
  const accounts = Q.bankAccounts ? Q.bankAccounts() : [];
  QLShell.openForm({
    title: 'Add freight payment', sub: (r.bill || '—') + ' · ' + r.sup + (r.qty ? ' · ' + r.qty + ' ' + (r.unit || 'MT') : ''),
    specs: [
      { k: 'amount', label: 'Amount (₹)', type: 'number', req: true, reqNonZero: true },
      { k: 'method', label: 'Paid via', type: 'select', opts: Q.paymentMethods.map(m => [m, m]) },
      ...(accounts.length ? [{ k: 'accountId', label: 'Bank account (if online)', type: 'select', opts: [['', '—']].concat(accounts.map(a => [a.id, a.label])) }] : []),
      { k: 'paidTo', label: 'Transporter / paid to', ph: 'e.g. Ramesh Transport' },
      { k: 'veh', label: 'Vehicle no.', upper: true },
      // The consignment note and the driver: real documents on a real truck, and
      // the only way the Freight tab can show logistics rather than decoration.
      { k: 'lr', label: 'LR / consignment no.', ph: 'from the transporter\'s note' },
      { k: 'driver', label: 'Driver name', ph: 'optional' },
      { k: 'driverPhone', label: 'Driver phone', ph: 'optional' },
      { k: 'date', label: 'Date', type: 'date', req: true },
      { k: 'ref', label: 'Reference', ph: 'UTR / note' }
    ],
    initial: { method: 'Cash', date: r.date || '', veh: r.veh || '' },
    saveLabel: 'Add freight',
    onSave(v) {
      Q.addFreightPayment(r.idx, v);
      toast('Freight recorded — landed cost updated');
      QLX.refresh(); QLX.open(r.idx);
    }
  });
}
function wireFreight(body, r) {
  const add = document.getElementById('pxFrAdd') || document.getElementById('pxFrAdd2');
  if (add) add.onclick = () => {
    freightForm(r);
  };
  document.querySelectorAll('[data-fr-del]').forEach(b => b.onclick = () => {
    QLShell.confirmDelete({
      title: 'Remove this freight payment?', reason: false,
      desc: 'The linked entry in the Payments ledger moves to Trash (restorable for 90 days). The bill itself is untouched.',
      confirmLabel: 'Remove freight',
      onConfirm() { Q.deleteFreightPayment(r.idx, b.dataset.frDel); toast('Freight payment removed'); QLX.refresh(); QLX.open(r.idx); }
    });
  });
  /* The LR note and the driver usually arrive after the money is sent, so they
     can be filled in later. Money is not editable here — see updateFreightNote. */
  document.querySelectorAll('[data-fr-edit]').forEach(b => b.onclick = () => {
    const f = (r.freightPays || []).find(x => x.id === b.dataset.frEdit); if (!f) return;
    QLShell.openForm({
      title: 'Consignment details', sub: fC(f.amount) + ' · ' + (f.paidTo || 'transporter') + ' · ' + fDS(f.date),
      specs: [
        { k: 'lr', label: 'LR / consignment no.' },
        { k: 'driver', label: 'Driver name' },
        { k: 'driverPhone', label: 'Driver phone' },
        { k: 'veh', label: 'Vehicle no.', upper: true },
        { k: 'paidTo', label: 'Transporter' }
      ],
      initial: { lr: f.lr || '', driver: f.driver || '', driverPhone: f.driverPhone || '', veh: f.veh || '', paidTo: f.paidTo || '' },
      saveLabel: 'Save details',
      onSave(v) { Q.updateFreightNote(r.idx, f.id, v); toast('Consignment details saved'); QLX.refresh(); QLX.open(r.idx); }
    });
  });
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
/* The asks open the REAL Business Assistant with the question pre-filled. They
   are not a second chat implementation, and they are not decoration: each one is
   a question the assistant already answers. A chip that opened an empty box
   would be a worse lie than no chip. */
function pbAsks(r) {
  return [
    'Explain bill ' + (r.bill || '') + ' from ' + r.sup,
    'Is the GST on ' + (r.bill || 'this bill') + ' eligible for ITC?',
    'Compare ' + r.item + ' rates from ' + r.sup,
    'What do I owe ' + r.sup + '?',
    'Show freight spend this month'
  ];
}
function tabAI(r) {
  const ins = Q.billInsights(r.idx), rel = Q.relatedBills(r.idx);
  const tone = { danger: ['pb-i-r', IC.ban], warn: ['pb-i-a', IC.clock], ok: ['pb-i-g', IC.check], info: ['pb-i-b', PB.shield] };
  const relList = arr => arr.length ? arr.map(x => `<button class="qx-tag" style="cursor:pointer;margin:2px 4px 2px 0" onclick="QLX.open(${x.idx})">${x.itemIconEmoji} ${esc(x.item)} · ${fC(x.taxable)}</button>`).join('') : '<span class="qx-mut">None</span>';
  const related = rel.freight.concat(rel.royalty).length ? rel.freight.concat(rel.royalty) : rel.group.slice(0, 5);
  return `<div class="pb-ai">
      <div class="pb-card-h" style="margin-bottom:8px">${psvg(PB.sparkle)}AI insights for this bill</div>
      ${ins.map(i => { const t = tone[i.tone] || tone.info; return `<div class="pb-ins"><span class="pb-ins-i ${t[0]}">${svg(t[1])}</span><span>${esc(i.text)}</span></div>`; }).join('')}
    </div>
    <div class="pb-card">
      <div class="pb-card-h">${svg(IC.ai)}Ask the assistant</div>
      <div class="qx-mut" style="font-size:12.5px">Opens the Business Assistant with the question filled in — it answers from this company's real data.</div>
      <div class="pb-asks">${pbAsks(r).map((q, i) => `<button class="pb-ask" data-ask="${i}">${esc(q)}</button>`).join('')}</div>
    </div>
    <div class="pb-card">
      <div class="pb-card-h">${psvg(PB.route)}Related in ${r.emoji} ${esc(r.groupLabel)}</div>
      <div>${relList(related)}</div>
    </div>`;
}
function wireAI(body, r) {
  const qs = pbAsks(r);
  (body || document).querySelectorAll('[data-ask]').forEach(b => b.onclick = () => {
    const q = qs[+b.dataset.ask]; if (!q) return;
    QLShell.openAssistant(); setTimeout(() => QLShell.assistAsk(q), 60);
  });
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
  emptySub: 'Add a purchase bill, or use “Upload Bills” to import petcoke / limestone / bag invoices.',
  subtitle: () => { const s = Q.purchaseSummary(); return `<b>${esc(Q.co.short)}</b> · ${s.count} bills · <b>${fC(s.total)}</b> purchase value`; },
  banner: rows => aiInsightsPanel(rows),
  primary: { label: t('Add Bill'), icon: IC.plus, onClick: () => QLShell.openPurchaseForm() },
  tools: [
    { label: t('Upload Bills'), icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', onClick: () => importBills() },
    { label: 'Export', icon: IC.dl, onClick: () => exportRows(QLX.rows()) },
    { label: 'Report', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/>', onClick: () => openPurchaseReport(QLX.rows()) }
    /* "Read quantities" and "Find duplicates" were both here, and both were
       remediation for bugs that are now fixed at the source:
       · Quantities are read AT IMPORT (cfg.ocrMap maps qty). The old bills that
         missed that fix are repaired by runQtyBackfill() on its own, in the
         background — see above.
       · Duplicates are REFUSED before they are stored, at the one chokepoint every
         import goes through (data.js addPurchase → ImportGuard.docVerdict). A
         broom for duplicates that can no longer get in is an invitation to sweep
         up real bills.
       Neither is coming back as a button. If either bug returns, the fix belongs
       where the bug is, not in a tool that asks the owner to clean up after us. */
  ],
  // Month-scoped: `rows` is the selected month's bills (all statuses).
  stats: rows => {
    const nc = rows.filter(r => r.status !== 'cancelled');
    const taxable = nc.reduce((a, r) => a + (r.taxable || 0), 0);
    const itc = nc.reduce((a, r) => a + (r.itc || 0), 0);
    const pending = nc.reduce((a, r) => a + (r.outstanding || 0), 0);
    const paid = nc.reduce((a, r) => a + (r.paid || 0), 0);
    // Distinct suppliers by identity, not by spelling.
    const _owed = nc.filter(r => (r.outstanding || 0) > 0);
    const _sIdx = QLParty.index(_owed, r => r.sup, r => r.gstin);
    const sups = new Set(_owed.map(r => _sIdx.keyOf(r.sup, r.gstin))).size;
    return [
      { label: 'Total Bills', value: rows.length, sub: nc.filter(r => r.isOverdue).length + ' overdue', tint: 'blue', icon: IC.file },
      { label: 'Total Purchases', value: fC(taxable), sub: 'excl. GST', tint: 'indigo', icon: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>' },
      { label: 'GST Input Credit', value: fC(itc), sub: 'available ITC', tint: 'green', icon: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/>' },
      { label: 'Pending Payment', value: fC(pending), sub: sups + ' supplier' + (sups === 1 ? '' : 's'), tint: 'amber', icon: IC.clock },
      { label: 'Paid Amount', value: fC(paid), sub: 'settled to date', tint: 'teal', icon: IC.check }
    ];
  },
  search: (r, q) => (r.bill + ' ' + r.sup + ' ' + r.item + ' ' + r.groupLabel + ' ' + r.gstin).toLowerCase().includes(q),
  filters: [
    { key: 'status', label: 'Status', options: () => [['pending', 'Pending'], ['partial', 'Partial'], ['paid', 'Paid'], ['overdue', 'Overdue'], ['cancelled', 'Cancelled']], test: (r, v) => v === 'overdue' ? r.isOverdue : v === 'pending' ? (r.status === 'pending' && !r.isOverdue) : r.status === v },
    { key: 'group', label: 'Group', options: rows => Q.purchaseGroups.filter(g => rows.some(r => r.group === g.key)).map(g => [g.key, g.emoji + ' ' + g.label]), test: (r, v) => r.group === v },
    { key: 'item', label: 'Item', allLabel: 'All items', options: rows => [...new Set(rows.map(r => r.item))].filter(Boolean).sort().map(it => [it, Q.itemShort(it)]), test: (r, v) => r.item === v },
    { key: 'sup', label: 'Supplier', options: rows => [...new Set(rows.map(r => r.sup))].filter(s => s && s !== '—').sort().map(s => [s, s]), test: (r, v) => r.sup === v }
  ],
  groupBy: [
    { key: 'group', label: t('Purchase Group'), of: r => r.group, title: r => esc(r.groupLabel), dot: r => (GCOL[r.group] || GCOL.other)[1] },
    { key: 'item', label: t('Purchase Item'), of: r => r.item || '—', title: r => esc(Q.itemShort(r.item) || '—'), dot: r => (GCOL[r.group] || GCOL.other)[1] },
    { key: 'status', label: t('Payment status'), of: r => (r.isOverdue ? 'overdue' : r.status), title: r => (r.isOverdue ? 'Overdue' : r.status[0].toUpperCase() + r.status.slice(1)), dot: r => STDOT[r.isOverdue ? 'overdue' : r.status] },
    { key: 'sup', label: t('Supplier'), of: r => r.sup, title: r => esc(r.sup), dot: () => 'var(--qx)' },
    { key: 'month', label: t('Month'), of: r => (r.date || '').slice(0, 7), title: r => Q.monthLabel(r.date, { blank: 'No date' }), dot: () => 'var(--qx)' }
  ],
  groupByDefault: 'group', groupSum: r => r.total,
  sortDefault: { key: 'date', dir: 'desc' },
  columns: [
    { key: 'sr', label: '#', cell: (r, sr) => `<span class="qx-sr">${sr}</span>`, cls: 'qx-sr' },
    { key: 'bill', label: 'Bill No', sort: true, cell: r => `<span class="qx-ref">${esc(r.bill || '—')}</span>` },
    { key: 'date', label: 'Bill Date', sort: true, cell: r => `<span class="qx-mut">${fDS(r.date)}</span>` },
    { key: 'sup', label: 'Supplier', sort: true, cell: supCell },
    { key: 'item', label: 'Purchase Item', sort: true, cell: itemCell },
    { key: 'veh', label: 'Vehicle No', sort: true, cell: r => r.veh ? `<span class="qx-mut">🚚 ${esc(r.veh)}</span>` : '<span class="qx-mut">—</span>' },
    { key: 'grate', label: 'GST', sort: true, num: true, cell: r => `<span class="qx-mut qx-num">${r.grate}%</span>` },
    /* Qty + rate, exactly as the Sales register has always had them (sales.js:267).
       Purchase never showed them — which is how the importer silently dropping the
       tonnage went unnoticed for so long: there was no column for the missing number
       to be missing FROM. An unrecorded qty shows '—', not 0: those are different
       facts and the whole Inventory mess came from conflating them. */
    /* Editable in place, exactly like freight: a VALUE with a pencil on row
       hover, a dash when empty — never an "add" button shouting down the page.
       This is the repair path for rate dashes: type the tonnage, the rate
       column derives on the same refresh. */
    { key: 'qty', label: t('Qty (T)'), sort: true, num: true, cell: r =>
        `<button class="pfr-edit" data-qy="${r.idx}" title="${+r.qty > 0 ? 'Click to correct the tonnage on this bill' : 'Click to add the tonnage — the ₹/T rate appears once the bill has a quantity'}">`
        + (+r.qty > 0 ? `<span class="qx-num">${fmt(r.qty, 2)}</span>` : '<span class="pfr-add">—</span>')
        + `<svg class="pfr-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>` },
    /* Editable in place, same as qty: a derived rate with a pencil on hover, or
       a clickable dash to TYPE the rate off the bill (we back-derive the qty).
       Only clickable when there is a taxable to divide — a rate with nothing to
       apply it to would store a bogus qty. */
    { key: 'rate', label: t('Rate ₹/T'), sort: true, num: true, cell: r =>
        (+r.taxable > 0
          ? `<button class="pfr-edit" data-rt="${r.idx}" title="${+r.qty > 0 ? 'Click to correct the rate — the tonnage re-derives' : 'Click to type the rate off the bill — the tonnage fills in'}">`
            + (+r.qty > 0 ? `<span class="qx-num">${fC(Math.round(r.taxable / r.qty))}</span>` : '<span class="pfr-add">—</span>')
            + `<svg class="pfr-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>`
          : `<span class="qx-dash">—</span>`) },
    { key: 'taxable', label: 'Taxable', sort: true, num: true, cell: r => `<span class="qx-num">${fC(r.taxable)}</span>` },
    // LANDED COST = the bill + the freight paid to get the material here. This is
    // what the petcoke actually cost, and it is what the owner reads the register
    // for. It is deliberately NOT labelled "Total": ₹5,29,860 is not the IOC bill
    // (₹4,74,627) and is not what is owed to IOC — the freight is owed to the
    // transporter. A column called "Total" showing neither would mislead the next
    // person to read it. Taxable + Freight sit either side, so the split is right
    // there on the row.
    { key: 'landed', label: 'Landed cost', sort: true, num: true,
      cell: r => `<span class="qx-num qx-strong" title="${r.freightAddon > 0 ? 'Bill ' + fC(r.total) + ' + freight ' + fC(r.freightAddon) : 'Bill total'}">${fC(r.landed)}</span>` },
    // Freight = what the TRANSPORTER was paid for this bill. Real money that
    // never appears in the bill's own total (transport is invoiced and taxed
    // separately), so landed cost was invisible in the table. freightAmt is
    // computed by purchaseRows FROM the freight payments themselves, so this
    // can never disagree with the drawer's Freight tab or the landed cost.
    /* EDITABLE IN PLACE. Freight was only reachable through the drawer's Freight
       tab, so the column was a row of dashes you could look at and not fix. Click
       it and type the amount.

       BUT: a bill with freight PAYMENTS recorded is not editable here, and that is
       deliberate, not a limitation. data.js:939 — payments supersede the manual
       number ("payments are the truth"). Writing freightAmt on such a bill would be
       silently ignored: the cell would show the old figure and the user would think
       the app had lost their edit. It says so instead and sends them to the tab
       that owns it. */
    { key: 'freightAmt', label: 'Freight', sort: true, num: true,
      cell: r => {
        const paid = (r.freightPays || []).length;
        if (paid) return `<span class="qx-num" title="${paid} freight payment${paid > 1 ? 's' : ''} — edit in the bill's Freight tab">${fC(r.freightAmt)} <span class="qx-mut" style="font-size:10px">·${paid}</span></span>`;
        /* A VALUE, not a button. The amount renders as plain tabular figures like
           every other money column; only on row-hover does the pencil and frame
           appear. An empty cell is "—", the same blank the rest of the table uses,
           not an "add" button demanding attention 26 times down the page. */
        const has = r.freightAmt > 0;
        return `<button class="pfr-edit" data-fr="${r.idx}" title="${has ? 'Click to change the freight on this bill' : 'Click to add the freight paid on this bill'}">`
          + (has ? `<span class="qx-num">${fC(r.freightAmt)}</span>` : '<span class="pfr-add">—</span>')
          + `<svg class="pfr-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>`;
      } },
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
    { label: 'Archive', icon: IC.file, onClick: r => { Q.archiveRecord('purchase', r.idx, true); toast('Bill archived — see Settings → Data Management → Archived'); QLX.refresh(); } },
    { label: 'Void / Cancel', icon: IC.ban || IC.close, onClick: voidBill },
    { label: 'Delete', icon: IC.trash, cls: 'del', onClick: delBill }
  ],
  bulkActions: [
    /* Set ONE rate across many bills — the answer to "every petcoke bill has a
       rate" when 30 IOC bills carry the same ₹/T but no tonnage. Applies only to
       bills with a taxable amount (nothing to divide otherwise), and derives +
       stores each bill's own qty (qty = taxable ÷ rate), so every row's tonnage
       is correct for ITS amount, not a copied number. */
    { label: 'Set rate ₹/T', icon: (IC.tag || IC.edit || IC.check), onClick: rows => {
        const eligible = rows.filter(r => +r.taxable > 0);
        if (!eligible.length) { toast('None of the selected bills have a taxable amount to price', 'warn'); return; }
        QLShell.openForm({
          title: 'Set rate for ' + eligible.length + ' bill' + (eligible.length === 1 ? '' : 's'),
          sub: 'Type the ₹/T off the bill — each bill\'s tonnage fills in from its own taxable amount',
          specs: [{ k: 'rate', label: 'Rate ₹/T', type: 'number', req: true, reqNonZero: true }],
          saveLabel: 'Apply rate',
          onSave(v) {
            const rate = +v.rate; if (!(rate > 0)) { toast('Enter a rate above 0', 'err'); return; }
            let done = 0;
            eligible.forEach(r => { const qty = Math.round((+r.taxable) / rate * 100) / 100; if (qty > 0) { Q.updatePurchase(r.idx, { qty }); done++; } });
            toast('Rate ' + fC(rate) + '/T applied to ' + done + ' bill' + (done === 1 ? '' : 's') + ' — tonnage filled in', 'ok');
            QLX.refresh();
          }
        });
      } },
    { label: 'Mark paid', icon: IC.check, onClick: rows => { rows.forEach(r => r.outstanding > 0 && Q.recordPurchasePayment(r.idx, r.outstanding, 'bank')); toast(rows.length + ' bills marked paid', 'ok'); QLX.refresh(); } },
    { label: 'Export', icon: IC.dl, onClick: rows => { exportRows(rows); } },
    { label: 'Delete', icon: IC.trash, cls: 'del', onClick: rows => { QLShell.confirmDelete({ title: 'Move ' + rows.length + ' bills to Trash?', desc: 'All ' + rows.length + ' selected bills move to Trash and can be restored for 90 days.', confirmLabel: 'Move to Trash', onConfirm: reason => { rows.map(r => r.idx).sort((a, b) => b - a).forEach(i => Q.deletePurchase(i, reason)); toast(rows.length + ' moved to Trash'); QLX.refresh(); } }); } }
  ],
  card: r => ({
    /* The phone leads with the same number as the register — landed cost — but
       it MUST carry its label here. A card puts the amount right beside the
       status pill, so an unlabelled "₹5,29,860 · Pending" reads as one sentence,
       and that sentence is false: ₹4,74,627 is what is pending. The desktop
       column header does this job; a card has no header. */
    id: r.bill || '—', title: `<span style="color:var(--qx)">${esc(r.bill || '—')}</span>`,
    amount: r.freightAddon > 0
      ? `${fC(r.landed)} <span style="font-size:10px;font-weight:600;color:var(--ql-text-secondary)">landed</span>`
      : fC(r.total),
    party: r.sup, partySub: r.emoji + ' ' + r.groupLabel, sub: r.veh ? '🚚 ' + r.veh : 'Bill: ' + (r.bill || '—'), date: r.date, calLabel: r.sup, status: stPill(r),
    chips: [groupChip(r), (r.freight && !(r.freightAddon > 0)) ? '<span class="qx-frt">freight</span>' : ''].filter(Boolean),
    rows: [['Item', r.itemIconEmoji + ' ' + esc(r.item)], ['Taxable', fC(r.taxable)], ['GST', fC(r.gst)]]
      .concat(r.freightAddon > 0 ? [['Bill total', fC(r.total)], ['Freight', fC(r.freightAddon)]] : [])
      .concat([['Status', stPill(r)]])
  }),
  footer: rows => {
    const t = rows.reduce((a, r) => ({ tax: a.tax + r.taxable, gst: a.gst + r.gst, tot: a.tot + r.total,
      paid: a.paid + r.paid, out: a.out + r.outstanding, fr: a.fr + (+r.freightAddon || 0) }), { tax: 0, gst: 0, tot: 0, paid: 0, out: 0, fr: 0 });
    // Landed = material + the freight actually paid on it. freightAddon (NOT
    // freightAmt) is summed on purpose: on a bill that IS a freight bill the
    // amount already sits inside `total`, and adding it again double-counts.
    return [{ label: 'Taxable', value: fC(t.tax) }, { label: 'GST', value: fC(t.gst) },
      { label: 'Grand Total', value: fC(t.tot), strong: true }]
      .concat(t.fr > 0 ? [{ label: 'Freight', value: fC(t.fr) }, { label: 'Landed cost', value: fC(t.tot + t.fr), strong: true }] : [])
      .concat([{ label: 'Paid', value: fC(t.paid) }, { label: 'Pending', value: fC(t.out) }]);
  },
  analytics: () => {
    const g = Q.purchaseByGroup();
    const bars = g.map(x => ({ label: x.emoji + ' ' + x.label, value: x.total, display: fC(x.total), color: (GCOL[x.key] || GCOL.other)[1] }));
    const rows = Q.purchaseRows();
    const byStatus = {}; rows.forEach(r => { if (r.status === 'cancelled') return; const k = r.isOverdue ? 'overdue' : r.status; byStatus[k] = (byStatus[k] || 0) + r.total; });
    const donut = Object.keys(byStatus).map(k => ({ label: k[0].toUpperCase() + k.slice(1), value: byStatus[k], color: STDOT[k] || '#94a3b8' }));
    return { barsTitle: 'Landed cost by purchase group', bars, donutTitle: 'Spend by payment status', donut, donutCenter: fC(Q.purchaseSummary().total) };
  },
  detail: r => ({
    /* `variant: 'glass'` opts this drawer into pbill.css. Every other QLX module
       renders exactly as before until it opts in too — the drawer markup is
       shared, so this is the only way to redesign one module without silently
       redesigning Sales, Parties and Reconciliation along with it. */
    variant: 'glass',
    eyebrow: 'Purchase Bill', title: `${esc(r.bill || '—')}`, sub: `${esc(r.sup)} · ${r.emoji} ${esc(r.groupLabel)} → ${esc(r.item)}`,
    avatar: pbAvatar(r),
    badge: `<span class="pb-st ${pbStatus(r).cls}">${pbStatus(r).label}</span>`,
    // The header states LANDED cost — what the material actually cost — and says
    // so. It is not the bill value and not what is owed; the rail spells both out.
    amount: `${fC(r.landed != null ? r.landed : r.total + (r.freightAddon || 0))}<small>${r.freightAddon > 0 ? 'landed cost' : 'bill total'}</small>`,
    aside: pbAside(r),
    actions: [
      { label: 'Edit', icon: IC.edit, onClick: r => QLShell.openPurchaseForm(r.idx) },
      { label: 'PDF', icon: IC.print, onClick: openBillPdf },
      { label: 'Share', icon: IC.share, onClick: shareBill },
      { label: 'Ask AI', icon: IC.ai, onClick: r => { QLShell.openAssistant(); setTimeout(() => QLShell.assistAsk(pbAsks(r)[0]), 60); } },
      ...(r.status !== 'paid' && r.status !== 'cancelled' ? [{ label: 'Mark paid', icon: IC.check, primary: true, onClick: markPaid }] : [])
    ],
    tabs: [
      { label: 'Overview', icon: IC.file, render: tabOverview, onMount: wireOverview },
      { label: 'Invoice', icon: IC.doc2, render: tabInvoice, onMount: wireInvoice },
      { label: 'Payments', icon: IC.clock, render: tabPayments, onMount: wirePayments },
      { label: 'Freight', icon: IC.truck || IC.box, count: (r.freightPays || []).length || null, render: tabFreight, onMount: wireFreight },
      { label: 'Documents', icon: IC.dl, count: (r.attach || []).length || null, render: tabDocs, onMount: wireDocs },
      { label: 'AI', icon: IC.ai, render: tabAI, onMount: wireAI },
      { label: 'Audit', icon: IC.activity, render: tabAudit }
    ]
  })
});

/* The old bills' tonnage, read back off their own PDFs — unasked, on idle, once
   per bill. Fired AFTER mount so the register is on screen first: this is
   repair work, and it must never be the reason the page is slow to appear. */
runQtyBackfill();

/* ── Export / Import (reused) ── */
function exportRows(rows) {
  rows = rows || [];
  const mo = QLX.month() ? '_' + QLX.month() : '';
  /* Both numbers ship. "Landed cost" is what the register now shows, so the
     export has to carry it or the file disagrees with the screen. "Total" stays
     because it is the invoice value — the figure that ties to the supplier's
     bill and to the ITC claimed on it. Dropping either one makes this file wrong
     for somebody: the owner reading cost, or the CA reading tax. */
  QLShell.exportCSV('purchases_' + (Q.co.short || 'register').replace(/\s+/g, '_') + mo, ['Bill', 'Date', 'Supplier', 'Group', 'Item', 'GSTIN', 'GST%', 'Taxable', 'Freight', 'GST', 'ITC', 'Total', 'Landed cost', 'Paid', 'Status', 'Due'], rows.map(x => [x.bill, x.date, x.sup, x.groupLabel, x.item, x.gstin, x.grate, x.taxable, x.freightAmt, x.gst, x.itc, x.total, x.landed, x.paid, x.status, x.dueDate]));
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
  // The one definition of "a bill that still counts" — shared by the dedup set
  // (existing) and the gate's list (rows) so they can never disagree about a
  // deleted bill again. Voided and archived are retired too: same rule as the
  // save gate (data.js dupCheck) and notCancelled, or the pre-pass promises an
  // import the gate then refuses — the exact two-door bug this line closed.
  const livePurchases = () => Q.state.PURCHASES.filter(p => !p._del && !p._arch && (p.status || 'pending') !== 'cancelled');
  const cfg = {
    kind: 'purchase',
    title: 'Import purchase bills', sub: 'Upload a spreadsheet list — or a photo/PDF of a single bill to scan.',
    dropTitle: 'Choose a file', dropSub: '.csv / .xlsx list, or a photo / PDF of one bill',
    tip: 'A spreadsheet imports many bills; a photo/PDF is read with OCR. A "Purchase Group / Item" column is auto-detected.',
    noun: 'bill', addLabel: 'Add Bill', accept: '.csv,.xlsx,.xls,.pdf,image/*,.zip', ocr: true,
    /* qty + unit were MISSING here while sales.js:381 has had `qty: 'qty'` all
       along. bill-ocr DOES read the tonnage off the bill (f.qty) — this map just
       never carried it across, so every OCR-imported purchase landed with no
       quantity and Inventory showed "Limestone 0 T" on ₹44,71,494 of real bills.
       The 97.7 T of petcoke that DID show up came from the handful typed in by
       hand on the form, which has always had a Qty field. Sales was right; purchase
       dropped it on the floor. */
    ocrMap: { bill: 'docno', date: 'date', sup: 'name', gstin: 'gstin', qty: 'qty', unit: 'unit', taxable: 'taxable', total: 'total', grate: 'rate', group: 'group', item: 'item', itc: 'itc', veh: 'veh' },
    errText: 'No usable bills found. Ensure Date, Supplier and a taxable/total column are mapped.',
    headerGroups: [['date', 'bill', 'invoice', 'voucher'], ['supplier', 'vendor', 'party', 'seller', 'name', 'amount', 'taxable', 'total']],
    fields: [{ key: 'bill', label: 'Bill No.' }, { key: 'date', label: 'Date', required: true }, { key: 'sup', label: 'Supplier', required: true }, { key: 'qty', label: 'Quantity' }, { key: 'unit', label: 'Unit' }, { key: 'gstin', label: 'GSTIN' }, { key: 'group', label: 'Purchase Group' }, { key: 'item', label: 'Purchase Item' }, { key: 'taxable', label: 'Taxable amount' }, { key: 'total', label: 'Total amount' }, { key: 'grate', label: 'GST %' }, { key: 'itc', label: 'ITC' }, { key: 'veh', label: 'Vehicle No.' }],
    requireOneOf: [['taxable', 'total']],
    autoMap: h => ({ qty: QLFin.colOf(h, 'qty', 'quantity', 'weight', 'tonne', 'ton', 'mt'), unit: QLFin.colOf(h, 'unit', 'uom'), bill: QLFin.colOf(h, 'bill no', 'invoice no', 'bill', 'invoice', 'voucher'), date: QLFin.colOf(h, 'bill date', 'invoice date', 'date'), sup: QLFin.colOf(h, 'supplier', 'vendor', 'seller', 'party', 'name'), gstin: QLFin.colOf(h, 'gstin', 'gst no', 'gst number'), group: QLFin.colOf(h, 'purchase group', 'group', 'category', 'head'), item: QLFin.colOf(h, 'purchase item', 'item', 'particular', 'description'), taxable: QLFin.colOf(h, 'taxable', 'basic', 'amount', 'value'), total: QLFin.colOf(h, 'invoice value', 'grand total', 'net amount', 'total'), grate: QLFin.colOf(h, 'gst %', 'gst%', 'gst rate', 'tax %', 'tax%', 'rate of tax', 'tax rate'), itc: QLFin.colOf(h, 'itc'), veh: QLFin.colOf(h, 'vehicle', 'vehicle no', 'truck', 'lorry', 'tt no', 'tanker') }),
    buildRow: get => {
      const sup = (get('sup') || '').toString().trim(), date = QLFin.parseDate(get('date'));
      let taxable = QLFin.parseNum(get('taxable')), total = QLFin.parseNum(get('total'));
      let grate = QLFin.parseNum(get('grate')); if (!grate) grate = 5; if (grate > 0 && grate < 1) grate *= 100;
      if (!taxable && total) taxable = total / (1 + grate / 100);
      if (!sup && !taxable && !total) return null;
      let itc = 'Eligible'; const iv = (get('itc') || '').toString().toLowerCase().trim();
      if (/rcm/.test(iv)) itc = 'RCM'; else if (/inelig/.test(iv) || iv === 'no' || iv === 'n') itc = 'Ineligible';
      const raw = ((get('group') || '') + ' ' + (get('item') || '')).toLowerCase().trim();
      /* Store the tonnage. A missing qty stays UNSET, not 0 — data.js coerces with
         `p.qty || 0` downstream, so 0 and "never recorded" are already hard to tell
         apart; writing a literal 0 here would make an unread bill indistinguishable
         from a genuinely zero one forever. */
      const qty = QLFin.parseNum(get('qty'));
      const unit = (get('unit') || '').toString().trim();
      const out = { bill: (get('bill') || '').toString().trim(), date: date || '', sup, gstin: (get('gstin') || '').toString().trim().toUpperCase(), taxable: +(taxable || 0), grate, itc, veh: (get('veh') || '').toString().trim().toUpperCase(), status: 'pending' };
      if (qty > 0) { out.qty = qty; if (unit) out.unit = unit; if (taxable) out.rate = Math.round(taxable / qty * 100) / 100; }
      if (raw) { out.cat = raw; const gm = Q.purchaseGroups.find(g => raw.includes(g.label.toLowerCase()) || g.items.some(it => raw.includes(it.toLowerCase()))); if (gm) { out.group = gm.key; out.item = gm.items.find(it => raw.includes(it.toLowerCase())) || gm.items[0]; } }
      return out;
    },
    // Dedup by bill no. + a stable supplier identity (GSTIN, else taxable amount) —
    // NOT the parsed supplier name, which can vary between OCR runs of the same bill
    // (e.g. "the buyer. For" vs "Indian Oil Corporation Limited") and let duplicates through.
    /* existing() and rows() must never disagree on what "live" means — when they
       did, a deleted bill was gone from rows() (the gate) but still in existing()
       (the dedup set), so re-uploading a bill you deleted was refused. Both now
       derive from ONE predicate, so they cannot drift apart again. A deleted bill
       is not a live bill. */
    existing: () => new Set(livePurchases().filter(p => p.bill).map(dupKeyP)),
    keyOf: dupKeyP,
    /* The SAVED bills, for the importer to ask ImportGuard the same question
       addPurchase will ask at save time. Without this the review table had to
       guess with dupKeyP — a narrower key than the gate's — and told him a bill
       was ready that the register then refused. */
    rows: livePurchases,
    preview: { headers: ['Bill', 'Date', 'Supplier', 'Group', 'Taxable', 'GST%'], right: [4, 5], row: p => [p.bill || '—', p.date || '—', p.sup || '—', (Q.purchaseGroups.find(g => g.key === p.group) || { label: p.cat || '—' }).label, Q.fC(p.taxable), p.grate + '%'] },
    /* RETURNS the attach promise. It used to swallow it in a synchronous
       try/catch — which cannot catch an async rejection, so a scan that failed to
       store failed in total silence while the importer said "Imported". The
       importer awaits this and reports a lost scan. */
    add: (p, file) => {
      const r = Q.addPurchase(p);
      if (r && r.ok === false) throw new Error(r.reason);
      if (file) return addAttach(Q.state.PURCHASES.length - 1, file, 'Invoice');
    },
    // After an import, JUMP the month filter to the imported bill's month —
    // otherwise a bill from another month is saved but invisible behind the
    // current filter, which reads as "uploaded but not showing in the table".
    done: (n, lastBill) => {
      if (!n) { QLX.refresh(); return; }
      const last = Q.state.PURCHASES.filter(x => !x._del).slice(-1)[0];   // store dates are ISO-normalised
      const ym = last && String(last.date || '').slice(0, 7);
      const cur = QLX.month && QLX.month();
      if (ym && /^\d{4}-\d{2}$/.test(ym) && cur && cur !== 'all' && cur !== ym && QLX.setMonth) {
        toast('Imported ' + n + ' bill' + (n === 1 ? '' : 's') + ' — showing ' + ym, 'ok');
        QLX.setMonth(ym);
      } else { toast('Imported ' + n + ' bill' + (n === 1 ? '' : 's'), 'ok'); QLX.refresh(); }
    }
  };
  // Fast path: native picker → background OCR → drawer (1) / review table (N).
  if (window.QLBulk) QLBulk.open(cfg); else QLFin.importSheet(cfg);
}

/* build m22: Freight tab on the purchase drawer */
