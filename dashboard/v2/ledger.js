/* ═══════════════════════════════════════════════════════════════════════
   Full-page Party Statement — bank-style running account for one party.
   Uses the single-source ledger engine QLD.partyLedger(idx, {from,to}).
   Date-range filter · record receipt against balance · Print/PDF · WhatsApp.
   Opened as ledger.html?party=<idx> (from the CRM drawer).
   ═══════════════════════════════════════════════════════════════════════ */
QLShell.mount({ active: 'parties', title: 'Party Statement' });
const Q = window.QLD, fC = Q.fC;
const esc = s => (s == null ? '' : s).toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const drcr = v => { const a = Math.round(Math.abs(v)); return a < 1 ? '₹0' : fC(a) + ' ' + (v >= 0 ? 'Dr' : 'Cr'); };
function qp(k) { return new URLSearchParams(location.search).get(k); }
/* Delegates to wa-core's normalizePhone — the tested engine — never a local copy.
   The copy that was here read `d.length === 10 ? '91' + d : d`, so a number stored
   with the STD trunk 0 (09829069545, ELEVEN digits) got no country code and wa.me
   was handed a number that is not the customer's. wa-core handles the trunk 0, the
   0091 prefix and the 6-9 mobile check, and returns '' rather than guess — which
   opens WhatsApp's contact picker instead of messaging a stranger. */
function waLink(phone, text) {
  if (window.WACore) return WACore.waLink(phone, text);
  return 'https://wa.me/?text=' + encodeURIComponent(text || '');
}
function isMobile() { return window.matchMedia && window.matchMedia('(max-width:768px)').matches; }

/* ── WHICH CUSTOMER ────────────────────────────────────────────────────
   ?id=<stable party id> is canonical. ?party=<array index> still works so
   every existing link and bookmark keeps resolving, but it is a POSITION:
   it means "the 10th row", so after the party list changes it points at a
   different customer's finances. Prefer id; fall back to index; and if an
   id is given that no longer exists, say so rather than silently showing
   row 0 — which would put one customer's balance under another's name.

   RESOLVE AT RENDER TIME, NOT AT LOAD TIME. This ran once as an IIFE while
   the module was still parsing — before Q.init() had hydrated the company
   blob — so partyRows() was empty, every id "wasn't found", and IDX fell
   back to 0. Every id link opened row 0's customer. It looked correct only
   because the party I first tested with happened to BE row 0. Data is ready
   inside render(), and re-resolving there also survives a company switch. */
const ICO = {
  wa: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>',
  print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'
};
function sendWhatsApp(p, bal) {
  const msg = bal > 0.5
    ? `Dear ${p.name},\nYour current outstanding balance with ${(Q.co.short || 'us')} is ${fC(Math.round(bal))}. Kindly arrange payment at your convenience. Thank you.`
    : `Dear ${p.name},\nThank you — your account is clear. We appreciate your business.`;
  window.open(waLink(p.phone, msg), '_blank');
}
let IDX = 0, BAD_ID = '', NOT_READY = false;
function resolveParty() {
  const rows = (window.QLD && QLD.partyRows) ? QLD.partyRows() : [];
  const r = (window.QLPartyLink && QLPartyLink.route)
    ? QLPartyLink.route(location.search, rows)
    : { idx: parseInt(qp('party'), 10) || 0, badId: '' };
  IDX = r.idx; BAD_ID = r.badId || ''; NOT_READY = !!r.notReady;
}
let FROM = '', TO = '';
/* The universal date filter (§13): one grammar value; FROM/TO derive from it
   through QLD.rangeSpan — the same resolver every other page uses. The local
   chip row and its private FY arithmetic are gone. */
let PERIOD = 'all';
function setLedgerPeriod(v) {
  PERIOD = v || 'all';
  const sp = Q.rangeSpan(PERIOD);
  FROM = sp.from || ''; TO = sp.to || '';
  render();
}

/* ── RECORD A RECEIPT, AND SAY WHICH BILLS IT PAYS ──────────────────────
   Two steps on purpose. Step one is the money: how much, when, by what
   route — facts the person has in front of them from the bank line. Step
   two is the judgement: which invoices it settles. Merging them would
   force the second decision before the first is even typed.

   Step two is skipped when there is nothing to decide (a supplier, or a
   customer with no open bills) — the receipt posts on-account as before. */
function recordReceipt(p) {
  const isSupp = p.type === 'supplier';
  QLShell.openForm({
    title: isSupp ? 'Record payment made' : 'Record receipt', sub: (p.name || '') + ' · posts to the running balance',
    specs: [
      { k: 'amount', label: (isSupp ? 'Amount paid' : 'Amount received') + ' (₹)', type: 'number', req: true, reqNonZero: true },
      { k: 'date', label: 'Date', type: 'date', req: true },
      { k: 'mode', label: 'Mode', type: 'select', opts: Q.paymentMethods.map(m => [m, m]) },
      { k: 'ref', label: 'Reference no.', ph: 'UTR / cheque / txn id' },
      { k: 'desc', label: 'Note', type: 'textarea', full: true, ph: 'e.g. advance for July dispatch' }
    ],
    initial: { date: new Date().toISOString().slice(0, 10), mode: 'Bank' },
    saveLabel: isSupp ? 'Record payment' : 'Continue',
    onSave: v => {
      const openBills = isSupp ? [] : outstandingFor(p);
      if (!openBills.length) { postOnAccount(p, v); return; }
      setTimeout(() => allocateStep(p, v, openBills), 0);   // let this modal close first
    }
  });
}

function postOnAccount(p, v) {
  const isSupp = p.type === 'supplier';
  const e = { date: v.date, mode: v.mode, ref: v.ref, desc: v.desc };
  Q.recordLedgerEntry(IDX, isSupp ? Object.assign({ dr: +v.amount }, e) : Object.assign({ cr: +v.amount }, e));
  QLShell.toast(isSupp ? 'Payment recorded' : 'Receipt recorded — on account', 'ok');
  render();
}

/* Step two: the allocation. QLAllocate proposes, the user decides, and
   every line stays editable — the engine only refuses what is arithmetically
   impossible (more than the bill, more than the money). */
function allocateStep(p, v, bills) {
  const AL = window.QLAllocate;
  const amt = +v.amount || 0;
  const prop = AL.propose(amt, bills);
  const pre = {}; prop.rows.forEach(r => pre[r.idx] = r.apply);

  const line = b => `<tr>
      <td><b>${esc(b.ref)}</b><div class="alc-d">${Q.fDS(b.date)}${b.age > 0 ? ' · ' + b.age + 'd' : ''}</div></td>
      <td class="num">${fC(Math.round(b.bal))}</td>
      <td class="num"><input class="qlf-input alc-i" data-idx="${b.idx}" type="number" inputmode="decimal" step="any"
           max="${b.bal}" value="${pre[b.idx] != null ? pre[b.idx] : ''}" placeholder="0"></td>
    </tr>`;

  QLShell.panel({
    title: 'Which invoices does this pay?', wide: true,
    sub: fC(Math.round(amt)) + ' from ' + (p.name || '') + ' · ' + Q.fDS(v.date) + (v.ref ? ' · ' + v.ref : ''),
    body: `<div class="alc">
      <div class="alc-why ${prop.kind}">${prop.kind === 'exact' ? '✓ ' : ''}${esc(prop.why || 'No open bills matched.')}</div>
      <table class="lgp-table alc-t">
        <thead><tr><th>Invoice</th><th class="num">Outstanding</th><th class="num">Apply</th></tr></thead>
        <tbody>${bills.map(line).join('')}</tbody>
      </table>
      <div class="alc-sum" id="alcSum"></div>
      <div class="alc-err" id="alcErr"></div>
    </div>`,
    actions: [
      { label: 'Back', onClick: () => { QLShell.closeModal(); setTimeout(() => recordReceipt(p), 0); } },
      { label: 'Post receipt', primary: true, onClick: el => {
          const r = AL.validate(amt, bills, readAlloc(el));
          if (!r.ok) { el.querySelector('#alcErr').innerHTML = r.errors.map(esc).join('<br>'); return; }
          postAllocated(p, v, r);
          QLShell.closeModal();
        } }
    ],
    onMount: el => {
      const paint = () => {
        const r = AL.validate(amt, bills, readAlloc(el));
        el.querySelector('#alcErr').innerHTML = r.errors.map(esc).join('<br>');
        el.querySelector('#alcSum').innerHTML =
          `<span>Applied to ${r.rows.length} invoice${r.rows.length === 1 ? '' : 's'}: <b>${fC(Math.round(r.applied))}</b></span>` +
          (r.unapplied > 0.005
            ? `<span class="alc-oa">On account: <b>${fC(Math.round(r.unapplied))}</b> — kept as an unallocated credit, not forced onto a bill</span>`
            : `<span class="alc-ok">Fully allocated</span>`);
      };
      el.querySelectorAll('.alc-i').forEach(i => { i.oninput = paint; });
      paint();
    }
  });
}

function readAlloc(el) {
  const m = {};
  el.querySelectorAll('.alc-i').forEach(i => { const v = parseFloat(i.value); if (isFinite(v) && v !== 0) m[i.dataset.idx] = v; });
  return m;
}

/* Posting. Each allocated line goes through Q.receiveSalesPayment, the same
   call the sales register uses — so the invoice status, its payment log and
   the cashbook all move together and there is no second way to pay a bill.
   Anything unallocated posts as one on-account ledger entry. The two paths
   add up to the amount received, never more. */
function postAllocated(p, v, r) {
  r.rows.forEach(row => Q.receiveSalesPayment(row.idx, {
    amount: row.apply, date: v.date, method: v.mode, ref: v.ref,
    notes: v.desc || ('Allocated from receipt' + (v.ref ? ' ' + v.ref : ''))
  }));
  if (r.unapplied > 0.005) {
    Q.recordLedgerEntry(IDX, { cr: r.unapplied, date: v.date, mode: v.mode, ref: v.ref,
      desc: v.desc || 'On-account receipt (unallocated balance)' });
  }
  const n = r.rows.length;
  QLShell.toast(n ? 'Receipt posted · ' + n + ' invoice' + (n === 1 ? '' : 's') + ' updated' : 'Receipt posted on account', 'ok');
  render();
}

function statementDoc(L) {
  const p = L.party, co = Q.co || {};
  const rows = L.rows.map(e => `<tr><td>${Q.fDS(e.date)}</td><td>${esc(e.desc)}${e.ref ? ' · ' + esc(e.ref) : ''}</td><td class="r">${e.dr ? fC(e.dr) : ''}</td><td class="r">${e.cr ? fC(e.cr) : ''}</td><td class="r">${drcr(e.bal)}</td></tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Statement — ${esc(p.name)}</title><style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:26px;font-size:12px}
    h1{font-size:18px;margin:0} .m{color:#666} .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:12px}
    .pty{font-size:13px;margin:2px 0 8px} .sum{display:flex;flex-wrap:wrap;gap:22px;margin:8px 0 12px;font-size:12px}
    table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid #ddd;padding:7px 8px;text-align:left} th{background:#f3f4f6;font-size:11px;text-transform:uppercase;letter-spacing:.03em}
    .r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap} tfoot td{font-weight:bold;border-top:2px solid #111}
  </style></head><body>
    <div class="hd"><div><h1>${esc(co.name || co.short || '')}</h1><div class="m">${co.gstin ? 'GSTIN ' + esc(co.gstin) : ''}${co.state ? ' · ' + esc(co.state) : ''}</div></div>
      <div style="text-align:right"><b>ACCOUNT STATEMENT</b><div class="m">${FROM || 'Beginning'} &rarr; ${TO || 'Today'}</div></div></div>
    <div class="pty"><b>${esc(p.name)}</b>${p.gstin ? ' · GSTIN ' + esc(p.gstin) : ''}${p.phone ? ' · ' + esc(p.phone) : ''}</div>
    <div class="sum"><span>Opening: <b>${drcr(L.openingForRange)}</b></span><span>Total Debit: <b>${fC(Math.round(L.totalDr))}</b></span><span>Total Credit: <b>${fC(Math.round(L.totalCr))}</b></span><span>Closing: <b>${drcr(L.closing)}</b></span></div>
    <table><thead><tr><th>Date</th><th>Particulars</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#888">No entries</td></tr>'}</tbody>
      <tfoot><tr><td colspan="2">Period total</td><td class="r">${fC(Math.round(L.totalDr))}</td><td class="r">${fC(Math.round(L.totalCr))}</td><td class="r">${drcr(L.closing)}</td></tr></tfoot></table>
    <p class="m" style="margin-top:18px">Running-account statement · generated by ${esc(co.short || 'QuickLimes')}</p>
  </body></html>`;
}
function printStatement(L) {
  const html = statementDoc(L);
  if (isMobile() && window.QLMobile && QLMobile.invoiceViewer) {
    QLMobile.invoiceViewer({ html, printHtml: html, title: 'Statement · ' + (L.party.name || ''), shareText: 'Account statement — ' + (L.party.name || '') });
    return;
  }
  const w = window.open('', '_blank');
  if (w) { w.document.write(html + '<scr' + 'ipt>onload=function(){setTimeout(print,300)}</scr' + 'ipt>'); w.document.close(); }
  else QLShell.toast('Allow pop-ups to print the statement');
}

function card(label, val, col, sub) { return `<div class="lgp-card"><span>${esc(label)}</span><b${col ? ` style="color:${col}"` : ''}>${val}</b>${sub ? `<i style="display:block;font-size:11px;color:var(--ql-text-secondary);font-style:normal;margin-top:3px">${esc(sub)}</i>` : ''}</div>`; }

const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

/* ── Insights from data the ledger ALREADY has (credit terms, ageing, advance,
   payment behaviour) — nothing invented, every line traceable to a row. ── */
function insights(L) {
  const out = [], p = L.party, bal = L.closing;
  const rows = L.rows || [];
  const unpaidDr = rows.filter(e => e.dr > 0);
  const lastCr = [...rows].reverse().find(e => e.cr > 0);
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00') - new Date(a + 'T00:00')) / 864e5);
  const today = ymd(new Date());

  if (bal > 0.5) {
    const oldest = unpaidDr[0];
    if (oldest) {
      const age = daysBetween(oldest.date, today);
      const terms = +p.creditDays || 0;
      if (terms && age > terms) out.push({ t: 'bad', h: `Overdue by ${age - terms} days`, s: `Oldest open entry ${Q.fDS(oldest.date)} · ${terms}-day terms.` });
      else if (age > 60) out.push({ t: 'bad', h: `Oldest balance is ${age} days old`, s: 'No credit terms set for this party.' });
      else out.push({ t: 'warn', h: `${drcr(bal)} outstanding`, s: `Oldest open entry ${Q.fDS(oldest.date)}${terms ? ` · ${terms}-day terms` : ''}.` });
    }
    const lim = +p.creditLimit || 0;
    if (lim && bal > lim) out.push({ t: 'bad', h: `Over the credit limit by ${fC(Math.round(bal - lim))}`, s: `Limit ${fC(lim)}.` });
  } else if (bal < -0.5) {
    out.push({ t: 'good', h: `${fC(Math.round(-bal))} advance held`, s: 'Adjust against the next invoice.' });
  } else if (rows.length) {
    out.push({ t: 'good', h: 'Fully settled', s: 'No outstanding balance for this period.' });
  }

  if (lastCr) out.push({ t: '', h: `Last payment ${fC(Math.round(lastCr.cr))}`, s: `${Q.fDS(lastCr.date)} · ${daysBetween(lastCr.date, today)} days ago.` });
  else if (rows.length) out.push({ t: 'warn', h: 'No payment received yet', s: 'Nothing has been credited in this period.' });

  if (L.totalDr > 0) {
    const pct = Math.round((L.totalCr / L.totalDr) * 100);
    out.push({ t: '', h: `${pct}% of billing collected`, s: `${fC(Math.round(L.totalCr))} received against ${fC(Math.round(L.totalDr))} billed.` });
  }
  return out.slice(0, 4);
}

/* Every cell goes through QLShell.csvRow — the ONE place floats are rounded to
   paise and text is preserved verbatim. Never hand-roll a CSV writer here: the
   raw floats this ledger computes (18.15 × 12385 = 224787.74999999997) would
   otherwise land in the file exactly as the UI never shows them. */
function exportLedger(L) {
  const row = QLShell.csvRow;
  const out = [
    row([L.party.name, L.party.gstin || '']),
    row(['Opening balance', L.openingForRange]),
    row(['Date', 'Particulars', 'Ref', 'Debit', 'Credit', 'Balance']),
    ...L.rows.map(e => row([e.date, e.desc, e.ref || '', e.dr || '', e.cr || '', e.bal])),
    row(['Total', '', '', L.totalDr, L.totalCr, L.closing])
  ];
  QLShell.downloadCSV('Ledger_' + (L.party.name || 'party').replace(/[^\w]+/g, '_'), out.join('\r\n'));
  QLShell.toast('Statement exported — ' + L.rows.length + ' entries', 'ok');
}


/* ── OUTSTANDING ─────────────────────────────────────────────────────────
   Invoice-by-invoice, from QLD.salesRows()/purchaseRows() — the SAME rows
   the registers show, never a second calculation. The ledger above answers
   "what is the balance"; this answers "which bills make it up", which is
   the question you need answered before allocating a receipt.
   Matching is by the party's own identity: GSTIN when both sides have one,
   otherwise the exact name. A near-name is NOT accepted — this book already
   contains two AMANs and two DESHWALIs. */
function outstandingFor(p) {
  const G = x => String(x == null ? '' : x).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const N = x => String(x == null ? '' : x).toUpperCase().replace(/\s+/g, ' ').trim();
  const pg = G(p.gstin), pn = N(p.name);
  const mine = r => (pg && G(r.gstin) === pg) || (!G(r.gstin) && N(r.party || r.sup) === pn) || (!pg && N(r.party || r.sup) === pn);
  const src = (p.type === 'supplier') ? (Q.purchaseRows ? Q.purchaseRows() : []) : (Q.salesRows ? Q.salesRows() : []);
  const today = new Date().toISOString().slice(0, 10);
  const days = d => { const a = new Date(today + 'T00:00'), b = new Date(String(d) + 'T00:00');
    const n = Math.round((a - b) / 86400000); return isFinite(n) ? n : 0; };
  return src.filter(r => r.status !== 'cancelled' && mine(r) && (+r.outstanding || 0) > 0.5)
    .map(r => ({ idx: r.idx, ref: r.inv || r.bill || '—', date: r.date, total: +r.total || 0,
                 paid: +r.paid || 0, bal: +r.outstanding || 0, age: days(r.date) }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}
function outstandingBlock(p) {
  const rows = outstandingFor(p);
  const noun = p.type === 'supplier' ? 'bill' : 'invoice';
  if (!rows.length) return `<div class="card lgp-tablewrap"><table class="lgp-table">
      <thead><tr><th>Outstanding</th></tr></thead>
      <tbody><tr><td class="lgp-empty">Nothing outstanding — every ${noun} is settled.</td></tr></tbody></table></div>`;
  const tot = rows.reduce((a, r) => a + r.bal, 0);
  const body = rows.map(r => `<tr>
      <td class="mono"><b>${esc(r.ref)}</b></td>
      <td>${Q.fDS(r.date)}</td>
      <td class="num">${fC(Math.round(r.total))}</td>
      <td class="num" style="color:#16a34a">${r.paid ? fC(Math.round(r.paid)) : ''}</td>
      <td class="num strong" style="color:#b91c1c">${fC(Math.round(r.bal))}</td>
      <td class="num">${r.age > 0 ? r.age + 'd' : '—'}</td>
    </tr>`).join('');
  return `<div class="card lgp-tablewrap">
    <table class="lgp-table">
      <thead><tr><th>${noun[0].toUpperCase() + noun.slice(1)}</th><th>Date</th><th class="num">Amount</th>
        <th class="num">Received</th><th class="num">Balance</th><th class="num">Age</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td colspan="4">${rows.length} open ${noun}${rows.length === 1 ? '' : 's'}</td>
        <td class="num strong" style="color:#b91c1c">${fC(Math.round(tot))}</td><td></td></tr></tfoot>
    </table>
  </div>`;
}

/* ── DOCUMENTS ───────────────────────────────────────────────────────────
   Every scan already attached to this party's invoices or bills, gathered
   in one place. Nothing new is stored: these are the SAME files the sales
   and purchase registers hold, listed by the customer they belong to
   instead of by the register they were filed in. Opening one fetches the
   blob from IndexedDB, or from the server if this device never had it. */
function docsFor(p) {
  const G = x => String(x == null ? '' : x).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const N = x => String(x == null ? '' : x).toUpperCase().replace(/\s+/g, ' ').trim();
  const pg = G(p.gstin), pn = N(p.name);
  const mine = r => (pg && G(r.gstin) === pg) || (!pg && N(r.party || r.sup) === pn) || (!G(r.gstin) && N(r.party || r.sup) === pn);
  const out = [];
  const scan = (rows, kind, refKey) => rows.filter(mine).forEach(r => (r.attach || []).forEach(a =>
    out.push({ id: a.id, name: a.name || '(unnamed file)', label: a.kind || 'Document', size: +a.size || 0,
               at: a.at || '', kind: kind, ref: r[refKey] || '—', date: r.date })));
  scan(Q.salesRows ? Q.salesRows() : [], 'sales', 'inv');
  scan(Q.purchaseRows ? Q.purchaseRows() : [], 'purchase', 'bill');
  return out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
function documentsBlock(p) {
  const d = docsFor(p);
  if (!d.length) return `<div class="card lgp-tablewrap"><table class="lgp-table">
      <tbody><tr><td class="lgp-empty">No scans attached to this party's bills yet. Attach them from the register and they appear here.</td></tr></tbody></table></div>`;
  const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : (n ? n + ' B' : '');
  return `<div class="card lgp-tablewrap"><table class="lgp-table">
    <thead><tr><th>File</th><th>Against</th><th>Date</th><th class="num">Size</th><th></th></tr></thead>
    <tbody>${d.map(x => `<tr>
      <td><b>${esc(x.label)}</b><div class="alc-d">${esc(x.name)}</div></td>
      <td class="mono">${esc(x.ref)}</td>
      <td>${Q.fDS(x.date)}</td>
      <td class="num">${kb(x.size)}</td>
      <td class="num"><button class="ql-btn ql-btn-secondary lgp-docbtn" data-doc="${esc(x.kind)}|${esc(x.id)}">Open</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}
async function openPartyDoc(kind, id) {
  try {
    let b = await Q.getDoc(kind, id);
    if (!(b instanceof Blob) && Q.fetchDocBlob) b = await Q.fetchDocBlob(id);
    if (!(b instanceof Blob)) { QLShell.toast('That file is not on this device or the server — re-upload it once', 'err'); return; }
    const url = URL.createObjectURL(b);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) { QLShell.toast('Could not open that file', 'err'); }
}

/* ── ACTIVITY ────────────────────────────────────────────────────────────
   The audit trail, filtered to this party. It is the app's own record of
   what was changed and by whom — not a new log written for this screen. */
function activityFor(p) {
  const N = x => String(x == null ? '' : x).toUpperCase().replace(/\s+/g, ' ').trim();
  const pn = N(p.name);
  return (Q.auditRows ? Q.auditRows() : []).filter(a => N(a.party) === pn).slice(0, 40);
}
function activityBlock(p) {
  const a = activityFor(p);
  if (!a.length) return `<div class="card lgp-tablewrap"><table class="lgp-table">
      <tbody><tr><td class="lgp-empty">No recorded changes for this party.</td></tr></tbody></table></div>`;
  const when = ts => { try { return Q.fDS(String(ts).slice(0, 10)) + ' ' + String(ts).slice(11, 16); } catch (_) { return ts || ''; } };
  return `<div class="card lgp-tablewrap"><table class="lgp-table">
    <thead><tr><th>When</th><th>What</th><th>Record</th><th class="num">Amount</th><th>By</th></tr></thead>
    <tbody>${a.map(x => `<tr>
      <td>${esc(when(x.ts))}</td>
      <td><b>${esc((x.action || '').replace(/^\w/, c => c.toUpperCase()))}</b> ${esc(x.module || '')}${x.reason ? `<div class="alc-d">${esc(x.reason)}</div>` : ''}</td>
      <td class="mono">${esc(x.recId || x.ref || '—')}</td>
      <td class="num">${x.amount ? fC(Math.round(x.amount)) : ''}</td>
      <td>${esc(x.by || '—')}</td>
    </tr>`).join('')}</tbody></table></div>`;
}


function render() {
  const main = document.getElementById('ql-main'); if (!main) return;
  resolveParty();
  const L = Q.partyLedger(IDX, { from: FROM, to: TO });
  if (NOT_READY) { main.innerHTML = `<div class="dash"><div class="card" style="padding:28px">Loading customer…</div></div>`; return; }
  if (BAD_ID) { main.innerHTML = `<div class="dash"><div class="qx-hero"><div class="qx-hero-l"><div class="qx-hero-tt"><div class="qx-title">Customer not found</div></div></div></div><div class="card" style="padding:28px">No customer with id <span class="mono">${esc(BAD_ID)}</span> in <b>${esc((Q.co && Q.co.name) || 'this company')}</b>. They may belong to another company, or have been deleted.<br><br><a href="parties.html">← Back to customers</a></div></div>`; return; }
  if (!L) { main.innerHTML = `<div class="dash"><div class="qx-hero"><div class="qx-hero-l"><div class="qx-hero-tt"><div class="qx-title">Statement</div></div></div></div><div class="card" style="padding:28px">Party not found. <a href="parties.html">← Back to customers</a></div></div>`; return; }
  const p = L.party, bal = L.closing;
  const balCol = bal > 0.5 ? 'var(--ql-danger-600)' : bal < -0.5 ? '#16a34a' : 'var(--ql-text)';
  const ins = insights(L);
  const rows = L.rows.map(e => `<tr>
      <td>${Q.fDS(e.date)}</td>
      <td><b>${esc(e.desc)}</b></td>
      <td class="mono">${esc(e.ref || '—')}</td>
      <td class="num">${e.dr ? fC(e.dr) : ''}</td>
      <td class="num" style="color:#16a34a">${e.cr ? fC(e.cr) : ''}</td>
      <td class="num strong" style="color:${e.bal > 0.5 ? '#b91c1c' : e.bal < -0.5 ? '#16a34a' : 'inherit'}">${drcr(e.bal)}</td>
    </tr>`).join('');
  /* The app's shared header. The customer's NAME is the page title, and the
     back-link and identity line ride in the subtitle — so the finance portal
     wears the same chrome as the registers it is opened from. The buttons keep
     their ids, because the wiring below finds them by id. */
  const heroCfg = {
    title: p.name || 'Statement',
    sub: `<a class="lgp-back" href="parties.html">← Customers</a><span class="lgp-idl">${p.gstin ? 'GSTIN ' + esc(p.gstin) : 'No GSTIN'}${p.phone ? ' · ' + esc(p.phone) : ''} · ${(p.type || 'customer')[0].toUpperCase() + (p.type || 'customer').slice(1)} · <b style="color:${balCol}">${drcr(bal)}</b></span>`,
    tools: [].concat(
      p.phone ? [{ label: 'WhatsApp', icon: ICO.wa, onClick: () => sendWhatsApp(p, bal) }] : [],
      [{ label: 'Print / PDF', icon: ICO.print, onClick: () => printStatement(L) }]),
    primary: { label: p.type === 'supplier' ? 'Record payment' : 'Record receipt',
               icon: ICO.plus, onClick: () => recordReceipt(p) }
  };
  main.innerHTML = `<div class="dash lgp qx qx-a-blue">
    <div id="lgHero"></div>
    <div class="lgp-cards">
      ${card('Opening balance', drcr(L.openingForRange), '', FROM ? 'as on ' + Q.fDS(FROM) : 'start of ledger')}
      ${card('Billed (debit)', fC(Math.round(L.totalDr)), '', L.rows.filter(e => e.dr > 0).length + ' entries')}
      ${card('Received (credit)', fC(Math.round(L.totalCr)), '#16a34a', L.rows.filter(e => e.cr > 0).length + ' payments')}
      ${card('Closing balance', drcr(bal), balCol, bal > 0.5 ? 'they owe you' : bal < -0.5 ? 'advance held' : 'settled')}
    </div>
    ${ins.length ? `<div class="lgp-ai">
      <svg class="lgp-ai-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.9 5.5L19.5 9l-5.6 1.5L12 16l-1.9-5.5L4.5 9l5.6-1.5z"/><circle cx="18" cy="18" r="1.4"/><circle cx="5" cy="17" r="1"/></svg>
      <div class="lgp-ai-list">${ins.map(i => `<div class="lgp-ai-i ${i.t}"><b>${esc(i.h)}</b> — ${esc(i.s)}</div>`).join('')}</div>
    </div>` : ''}
    <div class="card lgp-filter">
      ${QLShell.monthButton({ id: 'lgPeriodBtn', label: Q.periodLabel(PERIOD, 'All time'), title: 'Filter the statement by period' })}
      <span class="lgp-count">${L.rows.length} entr${L.rows.length === 1 ? 'y' : 'ies'} · <button class="lgp-chip" id="lgExp" style="margin-left:6px">⬇ Export</button></span>
    </div>
    <h2 class="lgp-h">Outstanding</h2>
    ${outstandingBlock(p)}
    <h2 class="lgp-h">Ledger</h2>
    <div class="card lgp-tablewrap">
      <table class="lgp-table">
        <thead><tr><th>Date</th><th>Particulars</th><th>Ref</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="lgp-empty">No entries in this period.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="3">Period total</td><td class="num">${fC(Math.round(L.totalDr))}</td><td class="num" style="color:#16a34a">${fC(Math.round(L.totalCr))}</td><td class="num strong" style="color:${balCol}">${drcr(bal)}</td></tr></tfoot>
      </table>
    </div>
    <h2 class="lgp-h">Documents</h2>
    ${documentsBlock(p)}
    <h2 class="lgp-h">Activity</h2>
    ${activityBlock(p)}
  </div>`;
  const $ = id => document.getElementById(id);
  document.querySelectorAll('.lgp-docbtn').forEach(b => b.onclick = () => {
    const [kind, id] = b.dataset.doc.split('|'); openPartyDoc(kind, id);
  });
  const pb = $('lgPeriodBtn');
  if (pb) pb.onclick = e => { e.stopPropagation(); QLShell.monthPicker(pb, { month: PERIOD, years: true, allLabel: 'All time', onPick: setLedgerPeriod }); };
  if ($('lgExp')) $('lgExp').onclick = () => exportLedger(L);
  /* The header is chrome — if qlx.js did not load, the ledger below must still
     be readable, so this warns rather than throwing. */
  const heroHost = $('lgHero');
  if (heroHost) {
    if (!window.QLX || !QLX.heroHTML) { console.warn('QLX not loaded — shared page header skipped'); }
    else { heroHost.innerHTML = QLX.heroHTML(heroCfg); QLX.wireHero(heroHost, heroCfg); }
  }
  QLShell.paintWorkspace && QLShell.paintWorkspace();
}

window.__qlRefresh = render;
window.__qlOnSwitchCompany = () => render();
if (Q.init) Q.init(render); else render();
