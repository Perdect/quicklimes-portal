/* ═══════════════════════════════════════════════════════════════════════
   Bank Statement Reconciliation — Quick Lime / Hydrated Lime.
   Upload a bank statement → auto-match CREDIT to sales invoices and DEBIT to
   purchase bills by party name / amount / date / invoice / GST / UTR. Party
   ledger, dashboard cards, AI suggestions, month filter, manual override.
   Reuses QLFin (parsing) + QLD (sales/purchase/party data). Firm = the active
   company from the top-left switcher. Nothing here touches the registers.
   ═══════════════════════════════════════════════════════════════════════ */
QLShell.mount({ active: 'reconcile', title: 'Bank Reconciliation' });
const Q = window.QLD, fC = Q.fC, fmt = Q.fmt, fDS = d => Q.fDS(d);
const esc = s => (s == null ? '' : s).toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const IC = {
  up: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  ai: '<path d="M12 2l1.9 5.5L19.5 9l-5.6 1.5L12 16l-1.9-5.5L4.5 9l5.6-1.5z"/><circle cx="18" cy="18" r="1.5"/><circle cx="5" cy="17" r="1"/>',
  ck: '<polyline points="20 6 9 17 4 12"/>', bank: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>', wallet: '<path d="M2 8h20M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2M2 8v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8"/>'
};
const STAT = {
  matched:      ['Matched', '#dcfce7', '#15803d'],
  partial:      ['Partial', '#fef9c3', '#a16207'],
  amountdiff:   ['Amount diff', '#ffedd5', '#c2410c'],
  datemismatch: ['Date mismatch', '#e0e7ff', '#4338ca'],
  duplicate:    ['Duplicate', '#fee2e2', '#b91c1c'],
  unknown:      ['Unknown party', '#f1f5f9', '#475569'],
  unmatched:    ['Unmatched', '#fef2f2', '#dc2626'],
  other:        ['Categorized', '#cffafe', '#0e7490'],
  manual:       ['Linked', '#dbeafe', '#1d4ed8']
};
const toast = (m, t) => (QLShell.toast ? QLShell.toast(m, t) : 0);

let ST = { view: 'recon', month: 'all', monthInit: false, ftype: 'all', fstatus: 'all', q: '' };

/* ── helpers ─────────────────────────────────────────────────────────── */
function txns() { return (Q.recon.txns || []); }
function norm(s) { return (s || '').toString().toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function nameScore(desc, name) {
  const dn = ' ' + norm(desc) + ' ', toks = norm(name).split(' ').filter(w => w.length >= 4);
  if (!toks.length) return 0;
  const hit = toks.filter(t => dn.includes(' ' + t) || dn.includes(t)).length;
  return hit / toks.length;
}
function daysBetween(a, b) { const x = new Date(a + 'T00:00'), y = new Date(b + 'T00:00'); return Math.round((x - y) / 86400000); }
function ymOf(d) { return (d || '').slice(0, 7); }
function inMonth(d) { return !ST.month || ST.month === 'all' || ymOf(d) === ST.month; }
function monthLabel() { if (!ST.month || ST.month === 'all') return 'All months'; try { return new Date(ST.month + '-01T00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); } catch (_) { return ST.month; } }
function catOfDebit(desc) {
  const d = norm(desc);
  if (/ROYALTY/.test(d)) return 'Royalty';
  if (/PETCOKE|PET COKE/.test(d)) return 'Petcoke';
  if (/LIMESTONE|LIME STONE/.test(d)) return 'Limestone';
  if (/GST|TAX|GSTIN/.test(d)) return 'GST payment';
  if (/EMI|LOAN|BOB|PMEGP|TERM/.test(d)) return 'Loan / EMI';
  if (/ATM|CASH WDL|WITHDRAWAL|CWDR|CASH/.test(d)) return 'Cash withdrawal';
  if (/NEFT|RTGS|IMPS|TRANSFER|SELF/.test(d) && /SELF|OWN/.test(d)) return 'Partner transfer';
  return null;
}

/* ── matching engine ─────────────────────────────────────────────────── */
function autoMatch(t) {
  const isCr = (t.credit || 0) > 0, amt = isCr ? t.credit : t.debit;
  const list = isCr ? Q.salesRows() : Q.purchaseRows();
  const nameOf = isCr ? (r => r.party) : (r => r.sup), refOf = isCr ? (r => r.inv) : (r => r.bill);
  const dn = norm(t.desc) + ' ' + norm(t.ref);
  let best = null, bestScore = 0;
  list.forEach(r => {
    if (r.status === 'cancelled') return;
    let sc = 0; const nm = nameScore(dn, nameOf(r));
    if (nm >= 0.5) sc += 45 * nm;
    const dTotal = Math.abs(amt - (r.total || 0)), dOut = Math.abs(amt - (r.outstanding || r.total || 0));
    const dAmt = Math.min(dTotal, dOut);
    if (dAmt < 1) sc += 40; else if (dAmt < amt * 0.02) sc += 30; else if (dAmt < amt * 0.1) sc += 12;
    if (refOf(r) && refOf(r).length >= 2 && dn.includes(norm(refOf(r)))) sc += 25;
    if (r.gstin && dn.includes(norm(r.gstin))) sc += 22;
    const dd = Math.abs(daysBetween(t.date, r.date || t.date));
    if (dd <= 3) sc += 12; else if (dd <= 15) sc += 6; else if (dd > 60) sc -= 6;
    if (sc > bestScore) { bestScore = sc; best = { r, nm, dAmt, dd }; }
  });
  if (!best || bestScore < 22) {
    if (!isCr) { const cat = catOfDebit(t.desc); if (cat) return { kind: 'other', idx: null, status: 'other', cat, score: 0 }; }
    const anyName = list.some(r => nameScore(dn, nameOf(r)) >= 0.5);
    return { kind: isCr ? 'sale' : 'purchase', idx: null, status: anyName ? 'unmatched' : 'unknown', score: bestScore };
  }
  const exact = best.dAmt < 1 || best.dAmt < amt * 0.02;
  const partial = !exact && best.dAmt < amt;   // paid less than the bill
  let status = 'matched';
  if (best.nm < 0.5 && !exact) status = 'partial';
  else if (partial) status = 'partial';
  else if (!exact) status = 'amountdiff';
  if (status === 'matched' && best.dd > 45) status = 'datemismatch';
  return { kind: isCr ? 'sale' : 'purchase', idx: best.r.idx, status, score: bestScore, cat: isCr ? undefined : best.r.group };
}
function runMatchAll(force) {
  const arr = txns();
  arr.forEach(t => { if (!t.m || !t.m.manual || force) t.m = autoMatch(t); });
  // duplicate detection: same direction + amount + party matched to same bill, OR identical amount+desc+date
  const seenBill = {}, seenSig = {};
  arr.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(t => {
    if (t.m && t.m.manual) return;
    const dir = (t.credit || 0) > 0 ? 'c' : 'd', amt = (t.credit || 0) + (t.debit || 0);
    const sig = dir + '|' + Math.round(amt) + '|' + norm(t.desc).slice(0, 20);
    if (seenSig[sig]) t.m.status = 'duplicate'; else seenSig[sig] = 1;
    if (t.m && t.m.idx != null) { const bk = t.m.kind + t.m.idx; if (seenBill[bk]) t.m.status = 'duplicate'; else seenBill[bk] = 1; }
  });
  Q.saveRecon();
}

/* ── bank-statement parsing (CSV / Excel / digital PDF) ──────────────── */
function bankHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 18); i++) {
    const line = (rows[i] || []).join(' ').toLowerCase();
    if (/date/.test(line) && /(debit|credit|withdraw|deposit|amount|balance|dr|cr)/.test(line)) return i;
  }
  return 0;
}
async function parseBankFile(file) {
  const parsed = await QLFin.fileToRows(file);
  const rows = parsed.rows || [];
  if (rows.length < 2) throw new Error('No rows found — export the statement as CSV/Excel and retry.');
  const hi = bankHeaderRow(rows), header = rows[hi] || [], col = (...k) => QLFin.colOf(header, ...k);
  const cDate = col('date', 'txn date', 'value date', 'tran date', 'transaction date');
  const cDesc = col('narration', 'description', 'particulars', 'remarks', 'details', 'transaction remarks');
  const cDeb = col('debit', 'withdrawal', 'withdrawal amt', 'dr', 'withdrawal amount', 'paid');
  const cCred = col('credit', 'deposit', 'deposit amt', 'cr', 'deposit amount', 'received');
  const cBal = col('balance', 'closing balance', 'running balance', 'available balance');
  const cRef = col('ref', 'utr', 'cheque', 'chq', 'reference', 'ref no', 'instrument', 'chq/ref');
  const cAmt = col('amount', 'txn amount', 'transaction amount');
  const cType = col('type', 'dr/cr', 'cr/dr', 'indicator');
  const out = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r]; if (!row) continue;
    const g = i => (i != null && i >= 0 && i < row.length) ? row[i] : '';
    const date = QLFin.parseDate(g(cDate)); if (!date) continue;
    let debit = cDeb >= 0 ? QLFin.parseNum(g(cDeb)) : 0, credit = cCred >= 0 ? QLFin.parseNum(g(cCred)) : 0;
    if (!debit && !credit && cAmt >= 0) {
      const amt = QLFin.parseNum(g(cAmt)), ty = (g(cType) || '').toString().toLowerCase();
      if (/cr|credit|deposit/.test(ty)) credit = Math.abs(amt);
      else if (/dr|debit|withdraw/.test(ty)) debit = Math.abs(amt);
      else if (amt < 0) debit = Math.abs(amt); else credit = amt;
    }
    if (!debit && !credit) continue;
    out.push({ id: 'bt' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36) + r, date, desc: (g(cDesc) || '').toString().trim() || (g(cRef) || '').toString().trim(), debit: debit || 0, credit: credit || 0, balance: QLFin.parseNum(g(cBal)) || 0, ref: (g(cRef) || '').toString().trim() });
  }
  return out;
}

/* ── analytics ───────────────────────────────────────────────────────── */
function monthTxns() { return txns().filter(t => inMonth(t.date)); }
function billFor(t) {
  if (!t.m || t.m.idx == null) return null;
  const arr = t.m.kind === 'sale' ? Q.salesRows() : Q.purchaseRows();
  return arr.find(r => r.idx === t.m.idx) || null;
}
function isLinked(t) { return t.m && (t.m.idx != null || t.m.status === 'other' || t.m.manual); }
function cards() {
  const tt = monthTxns();
  const credits = tt.reduce((a, t) => a + (t.credit || 0), 0);
  const debits = tt.reduce((a, t) => a + (t.debit || 0), 0);
  const matched = tt.filter(isLinked).reduce((a, t) => a + (t.credit || 0) + (t.debit || 0), 0);
  const unmatched = tt.filter(t => !isLinked(t)).reduce((a, t) => a + (t.credit || 0) + (t.debit || 0), 0);
  const recv = Q.salesRows().reduce((a, r) => a + (r.status === 'cancelled' ? 0 : (r.outstanding || 0)), 0);
  const pay = Q.purchaseRows().reduce((a, r) => a + (r.status === 'cancelled' ? 0 : (r.outstanding || 0)), 0);
  const gst = Q.gstSummary ? Q.gstSummary() : { outGST: 0, itc: 0 };
  return { credits, debits, matched, unmatched, recv, pay, gstIn: gst.itc || 0, gstOut: gst.outGST || 0, net: credits - debits, count: tt.length };
}
function partyLedger() {
  const by = {};
  const touch = k => (by[k] = by[k] || { party: k, sales: 0, purchases: 0, recv: 0, paid: 0, pendS: 0, pendP: 0 });
  Q.salesRows().forEach(r => { if (r.status === 'cancelled') return; const p = touch(r.party || '—'); p.sales += r.total || 0; p.pendS += r.outstanding || 0; });
  Q.purchaseRows().forEach(r => { if (r.status === 'cancelled') return; const p = touch(r.sup || '—'); p.purchases += r.total || 0; p.pendP += r.outstanding || 0; });
  monthTxns().forEach(t => { const b = billFor(t); if (!b) return; const name = t.m.kind === 'sale' ? b.party : b.sup; const p = touch(name || '—'); if (t.credit) p.recv += t.credit; if (t.debit) p.paid += t.debit; });
  return Object.values(by).map(p => ({ ...p, pending: p.pendS - p.pendP, business: p.sales + p.purchases })).sort((a, b) => b.business - a.business);
}
function aiSuggestions() {
  const out = [], tt = monthTxns();
  tt.filter(t => (t.credit || 0) > 5000 && !isLinked(t)).slice(0, 3).forEach(t => out.push({ ic: '💰', tone: 'warn', t: `Unmatched credit ${fC(t.credit)} on ${fDS(t.date)}`, s: 'Customer payment received but no invoice linked — ' + (t.m && t.m.status === 'unknown' ? 'party not recognised.' : 'link it to a sales bill.') }));
  tt.filter(t => (t.debit || 0) > 5000 && !isLinked(t)).slice(0, 3).forEach(t => out.push({ ic: '📤', tone: 'info', t: `Unmatched debit ${fC(t.debit)} on ${fDS(t.date)}`, s: 'Money paid out — link to a purchase bill, or mark as GST / EMI / transfer.' }));
  tt.filter(t => t.m && t.m.status === 'duplicate').slice(0, 2).forEach(t => out.push({ ic: '⚠️', tone: 'bad', t: `Possible duplicate: ${fC((t.credit || 0) + (t.debit || 0))}`, s: esc((t.desc || '').slice(0, 46)) + ' appears twice this month.' }));
  const topRecv = Q.salesRows().filter(r => r.status !== 'cancelled' && r.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding)[0];
  if (topRecv) out.push({ ic: '📥', tone: 'warn', t: `${esc(topRecv.party)} owes ${fC(topRecv.outstanding)}`, s: 'Largest receivable — no matching bank credit found yet.' });
  const topPay = Q.purchaseRows().filter(r => r.status !== 'cancelled' && r.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding)[0];
  if (topPay) out.push({ ic: '🧾', tone: 'info', t: `Pending payment ${fC(topPay.outstanding)} to ${esc(topPay.sup)}`, s: 'Supplier bill unpaid — pay & it will match the debit.' });
  const c = cards(); out.push({ ic: c.net >= 0 ? '📈' : '📉', tone: c.net >= 0 ? 'ok' : 'bad', t: `Net cash flow ${fC(c.net)} · ${monthLabel()}`, s: `${fC(c.credits)} in · ${fC(c.debits)} out across ${c.count} transactions.` });
  if (c.gstOut || c.gstIn) out.push({ ic: '🏛️', tone: 'info', t: `GST: output ${fC(c.gstOut)} · ITC ${fC(c.gstIn)}`, s: `Net GST payable ${fC(Math.max(0, c.gstOut - c.gstIn))}.` });
  return out;
}

/* ══════════════════ RENDER ══════════════════ */
function render() {
  const main = document.getElementById('ql-main'); if (!main) return;
  if (!ST.monthInit) { const ms = [...new Set(txns().map(t => ymOf(t.date)).filter(Boolean))].sort(); ST.month = ms.length ? ms[ms.length - 1] : 'all'; ST.monthInit = true; }
  let root = document.getElementById('rcRoot');
  if (!root) { main.innerHTML = '<div class="rc" id="rcRoot"></div>'; root = document.getElementById('rcRoot'); }
  try {
    root.innerHTML = heroHTML() + (txns().length ? cardsHTML() + aiHTML() + tabsHTML() + `<div class="rc-panel">${viewHTML()}</div>` : emptyHTML());
    wire();
  } catch (e) { console.warn('recon render deferred:', e); }
  QLShell.paintWorkspace && QLShell.paintWorkspace();
}
function heroHTML() {
  return `<div class="rc-hero">
    <div><div class="rc-h1">Bank Reconciliation</div><div class="rc-sub"><b>${esc(Q.co.short || 'Company')}</b> · ${txns().length} bank transactions · auto-matched to sales &amp; purchase</div></div>
    <div class="rc-hero-r">
      <button class="rc-btn" id="rcMonth">${svg(IC.cal)}<span>${esc(monthLabel())}</span>${svg('<polyline points="6 9 12 15 18 9"/>')}</button>
      ${txns().length ? `<button class="rc-btn" id="rcMatch" title="Re-run auto match">${svg(IC.refresh)}<span>Re-match</span></button><button class="rc-btn" id="rcExport">${svg(IC.dl)}<span>Export</span></button>` : ''}
      <button class="rc-btn rc-btn-primary" id="rcUpload">${svg(IC.up)}<span>Upload statement</span></button>
    </div></div>`;
}
function emptyHTML() {
  return `<div class="rc-empty"><div class="rc-empty-ic">${svg(IC.bank)}</div>
    <div class="rc-empty-t">Upload your bank statement to begin</div>
    <div class="rc-empty-s">PDF, Excel or CSV. We read Date, Description, Debit, Credit, Balance &amp; UTR/Ref, then auto-match credits to your sales invoices and debits to your purchase bills for <b>${esc(Q.co.short || 'this firm')}</b>.</div>
    <button class="rc-btn rc-btn-primary" id="rcUpload2">${svg(IC.up)}<span>Upload bank statement</span></button></div>`;
}
function statCard(tint, ic, label, val, sub) {
  return `<div class="rc-kpi rc-t-${tint}"><div class="rc-kpi-top"><span class="rc-kpi-ic i-${tint}">${typeof ic === 'string' && ic.length <= 3 ? ic : svg(ic)}</span><span class="rc-kpi-l">${label}</span></div><div class="rc-kpi-v">${val}</div><div class="rc-kpi-s">${sub || ''}</div></div>`;
}
function cardsHTML() {
  const c = cards();
  return `<div class="rc-kpis">
    ${statCard('green', '↓', 'Total Credits', fC(c.credits), 'money received')}
    ${statCard('red', '↑', 'Total Debits', fC(c.debits), 'money paid')}
    ${statCard('blue', IC.ck, 'Matched', fC(c.matched), 'linked to bills')}
    ${statCard('amber', '?', 'Unmatched', fC(c.unmatched), 'needs review')}
    ${statCard('indigo', '📥', 'Pending Receivables', fC(c.recv), 'customers owe you')}
    ${statCard('rose', '🧾', 'Pending Payables', fC(c.pay), 'you owe suppliers')}
    ${statCard('violet', '🏛️', 'GST Input (ITC)', fC(c.gstIn), 'available credit')}
    ${statCard('teal', '🧮', 'GST Output', fC(c.gstOut), 'collected GST')}
    ${statCard(c.net >= 0 ? 'green' : 'red', c.net >= 0 ? '📈' : '📉', 'Net Cash Flow', fC(c.net), monthLabel())}
  </div>`;
}
function aiHTML() {
  const items = aiSuggestions();
  if (!items.length) return '';
  const TONE = { ok: 'i-green', bad: 'i-red', warn: 'i-amber', info: 'i-blue' };
  return `<div class="rc-ai"><div class="rc-ai-h"><span class="rc-ai-t">${svg(IC.ai)} AI Suggestions · ${esc(monthLabel())}</span><span class="rc-ai-badge">Auto</span></div>
    <div class="rc-ai-grid">${items.map(x => `<div class="rc-ai-i"><span class="rc-ai-ic ${TONE[x.tone] || 'i-blue'}">${x.ic}</span><div><div class="rc-ai-it">${esc(x.t)}</div><div class="rc-ai-is">${x.s}</div></div></div>`).join('')}</div></div>`;
}
function tabsHTML() {
  const tab = (k, l) => `<button class="rc-tab ${ST.view === k ? 'on' : ''}" data-view="${k}">${l}</button>`;
  const unm = monthTxns().filter(t => !isLinked(t)).length;
  const tabs = `<div class="rc-tabs">${tab('recon', 'Reconciliation')}${tab('ledger', 'Party Ledger')}${tab('unmatched', 'Unmatched' + (unm ? ' · ' + unm : ''))}</div>`;
  if (ST.view === 'ledger') return `<div class="rc-toolbar">${tabs}<div class="rc-tb-sp"></div><button class="rc-mini" id="rcLedgerExp">${svg(IC.dl)} Export ledger</button></div>`;
  const typ = (k, l) => `<button class="rc-chip ${ST.ftype === k ? 'on' : ''}" data-ftype="${k}">${l}</button>`;
  const sta = (k, l) => `<button class="rc-chip ${ST.fstatus === k ? 'on' : ''}" data-fstatus="${k}">${l}</button>`;
  return `<div class="rc-toolbar">${tabs}<div class="rc-tb-sp"></div>
    <div class="rc-chips">${typ('all', 'All')}${typ('credit', 'Credit')}${typ('debit', 'Debit')}</div>
    <div class="rc-chips">${sta('all', 'Any')}${sta('matched', 'Matched')}${sta('partial', 'Partial')}${sta('unmatched', 'Unmatched')}${sta('duplicate', 'Duplicate')}</div>
    <input class="rc-search" id="rcSearch" placeholder="Search party / ref…" value="${esc(ST.q)}">
  </div>`;
}
function filteredTxns() {
  let r = monthTxns();
  if (ST.ftype === 'credit') r = r.filter(t => (t.credit || 0) > 0);
  if (ST.ftype === 'debit') r = r.filter(t => (t.debit || 0) > 0);
  if (ST.fstatus === 'matched') r = r.filter(t => t.m && (t.m.status === 'matched' || t.m.status === 'manual' || t.m.status === 'other'));
  else if (ST.fstatus === 'unmatched') r = r.filter(t => !isLinked(t));
  else if (ST.fstatus === 'partial') r = r.filter(t => t.m && t.m.status === 'partial');
  else if (ST.fstatus === 'duplicate') r = r.filter(t => t.m && t.m.status === 'duplicate');
  if (ST.view === 'unmatched') r = r.filter(t => !isLinked(t));
  if (ST.q) { const q = ST.q.toLowerCase(); r = r.filter(t => { const b = billFor(t); return ((t.desc || '') + ' ' + (t.ref || '') + ' ' + (b ? (b.party || b.sup || '') : '')).toLowerCase().includes(q); }); }
  return r.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
function badge(t) { const s = (t.m && STAT[t.m.status]) ? STAT[t.m.status] : STAT.unmatched; return `<span class="rc-badge" style="background:${s[1]};color:${s[2]}">${s[0]}${t.m && t.m.manual ? ' ✓' : ''}</span>`; }
function matchCell(t) {
  const b = billFor(t);
  if (b) { const ref = t.m.kind === 'sale' ? b.inv : b.bill; const nm = t.m.kind === 'sale' ? b.party : b.sup; return `<div class="rc-match"><b>${esc(ref || '—')}</b><span>${esc(nm || '')}${t.m.kind === 'purchase' && b.emoji ? ' · ' + b.emoji : ''}</span></div>`; }
  if (t.m && t.m.status === 'other') return `<div class="rc-match"><b>${esc(t.m.cat || 'Categorized')}</b><span>non-bill entry</span></div>`;
  return `<span class="rc-mut">—</span>`;
}
function viewHTML() {
  if (ST.view === 'ledger') return ledgerHTML();
  const rows = filteredTxns();
  if (!rows.length) return `<div class="rc-none">${ST.month && ST.month !== 'all' ? 'No matching transactions for ' + esc(monthLabel()) : 'No transactions match these filters'}.</div>`;
  const body = rows.map((t, i) => `<tr data-tid="${t.id}">
    <td class="rc-mut">${fDS(t.date)}</td>
    <td><div class="rc-desc">${esc((t.desc || '—').slice(0, 60))}</div>${t.ref ? `<div class="rc-ref">${esc(t.ref)}</div>` : ''}</td>
    <td class="r ${t.debit ? 'rc-dr' : 'rc-mut'}">${t.debit ? fC(t.debit) : '—'}</td>
    <td class="r ${t.credit ? 'rc-cr' : 'rc-mut'}">${t.credit ? fC(t.credit) : '—'}</td>
    <td class="r rc-mut">${t.balance ? fC(t.balance) : '—'}</td>
    <td>${matchCell(t)}</td>
    <td>${badge(t)}</td>
    <td class="rc-actcell">${isLinked(t) ? `<button class="rc-ib" data-unlink="${t.id}" title="Unlink">${svg(IC.x)}</button>` : ''}<button class="rc-ib" data-link="${t.id}" title="Link to bill">${svg(IC.link)}</button><button class="rc-ib" data-mark="${t.id}" title="Categorize">${svg(IC.tag)}</button></td>
  </tr>`).join('');
  return `<div class="rc-tablewrap"><table class="rc-table"><thead><tr><th>Date</th><th>Description</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th><th>Matched to</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
}
function ledgerHTML() {
  const rows = partyLedger().filter(p => p.party !== '—');
  if (!rows.length) return `<div class="rc-none">No party data yet.</div>`;
  const body = rows.map(p => `<tr><td><b>${esc(p.party)}</b></td>
    <td class="r">${fC(p.sales)}</td><td class="r">${fC(p.purchases)}</td>
    <td class="r rc-cr">${p.recv ? fC(p.recv) : '—'}</td><td class="r rc-dr">${p.paid ? fC(p.paid) : '—'}</td>
    <td class="r"><b style="color:${p.pending > 0 ? 'var(--ql-danger-600)' : p.pending < 0 ? 'var(--ql-success-600)' : 'inherit'}">${p.pending ? fC(p.pending) : '—'}</b></td></tr>`).join('');
  return `<div class="rc-tablewrap"><table class="rc-table rc-ledger"><thead><tr><th>Party</th><th class="r">Sales</th><th class="r">Purchases</th><th class="r">Received</th><th class="r">Paid</th><th class="r">Net pending</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

/* ══════════════════ FLOATING MENU (month picker / mark) ══════════════════ */
let _rcMenu = null;
function closeRcMenu() { if (_rcMenu) { _rcMenu.remove(); _rcMenu = null; } }
document.addEventListener('click', e => { if (_rcMenu && !e.target.closest('.rc-menu') && !e.target.closest('#rcMonth,[data-mark]')) closeRcMenu(); });
function placeRcMenu(m, anchor) {
  document.body.appendChild(m); const r = anchor.getBoundingClientRect(), mh = m.offsetHeight, mw = m.offsetWidth;
  let top = r.bottom + 6; if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - 6 - mh);
  m.style.top = top + 'px'; m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 12)) + 'px'; _rcMenu = m;
}
function openMonthMenu(anchor) {
  closeRcMenu();
  const have = new Set(txns().map(t => ymOf(t.date)).filter(Boolean));
  let year = +((ST.month && ST.month !== 'all' ? ST.month : new Date().toISOString().slice(0, 7)).slice(0, 4)) || new Date().getFullYear();
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = document.createElement('div'); m.className = 'rc-menu rc-month-menu';
  const paint = () => {
    m.innerHTML = `<div class="rc-mm-yr"><button data-yr="-1">${svg('<polyline points="15 18 9 12 15 6"/>')}</button><span>${year}</span><button data-yr="1">${svg('<polyline points="9 18 15 12 9 6"/>')}</button></div>
      <div class="rc-mm-grid">${MN.map((mn, i) => { const ym = year + '-' + String(i + 1).padStart(2, '0'); return `<button class="rc-mm-c${ST.month === ym ? ' on' : ''}${have.has(ym) ? ' has' : ''}" data-ym="${ym}">${mn}</button>`; }).join('')}</div>
      <button class="rc-mm-all${(!ST.month || ST.month === 'all') ? ' on' : ''}" data-ym="all">All months</button>`;
    m.querySelectorAll('[data-yr]').forEach(b => b.onclick = () => { year += +b.dataset.yr; paint(); });
    m.querySelectorAll('[data-ym]').forEach(b => b.onclick = () => { ST.month = b.dataset.ym; ST.monthInit = true; closeRcMenu(); render(); });
  };
  paint(); placeRcMenu(m, anchor);
}
function openMark(tid, anchor) {
  closeRcMenu();
  const t = txns().find(x => x.id === tid); if (!t) return;
  const cats = ['Advance payment', 'Partner transfer', 'Loan / EMI', 'Cash withdrawal', 'GST payment', 'Petcoke', 'Limestone', 'Plastic Bags', 'Royalty', 'Bank charges', 'Other'];
  const m = document.createElement('div'); m.className = 'rc-menu';
  m.innerHTML = `<div class="rc-menu-h">Mark as</div>${cats.map(c => `<button class="rc-menu-i" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}`;
  m.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { t.m = { kind: 'other', idx: null, status: 'other', cat: b.dataset.cat, manual: true }; Q.saveRecon(); closeRcMenu(); render(); toast('Marked as ' + b.dataset.cat, 'ok'); });
  placeRcMenu(m, anchor);
}

/* ══════════════════ MODALS ══════════════════ */
function overlay() { let b = document.getElementById('rcBack'); if (!b) { b = document.createElement('div'); b.id = 'rcBack'; document.body.appendChild(b); } b.className = 'rc-back'; b.onclick = e => { if (e.target === b) b.remove(); }; return b; }
function openUpload() {
  const b = overlay();
  b.innerHTML = `<div class="rc-modal"><div class="rc-modal-h"><div class="rc-modal-t">Upload bank statement</div><button class="rc-modal-x" id="rcUX">&times;</button></div>
    <div class="rc-modal-b">
      <label class="rc-drop" id="rcDrop"><input type="file" id="rcFile" accept=".csv,.xlsx,.xls,.pdf" hidden>
        <span class="rc-drop-ic">${svg(IC.up)}</span><b>Choose a file or drop it here</b><span class="rc-drop-s">PDF · Excel (.xlsx/.xls) · CSV — one row per transaction with Date, Debit/Credit &amp; Balance</span></label>
      <div id="rcUpMsg" class="rc-upmsg"></div>
      <div class="rc-note">Statement is read on your device. Credits match sales invoices, debits match purchase bills — for <b>${esc(Q.co.short || 'this firm')}</b>.</div>
    </div></div>`;
  const close = () => b.remove();
  document.getElementById('rcUX').onclick = close;
  const drop = document.getElementById('rcDrop'), file = document.getElementById('rcFile'), msg = document.getElementById('rcUpMsg');
  const go = async f => {
    if (!f) return;
    msg.innerHTML = `<div class="rc-loading">Reading <b>${esc(f.name)}</b>…</div>`;
    let parsed; try { parsed = await parseBankFile(f); } catch (e) { msg.innerHTML = `<div class="rc-err">${esc(e.message || 'Could not read this file. Export it as CSV or Excel and try again.')}</div>`; return; }
    if (!parsed.length) { msg.innerHTML = `<div class="rc-err">No transactions found. Make sure the file has Date and Debit/Credit columns (or export as CSV).</div>`; return; }
    Q.recon.txns.push(...parsed); runMatchAll();
    const matched = parsed.filter(t => isLinked(t)).length;
    close(); render(); toast('Imported ' + parsed.length + ' transactions · ' + matched + ' auto-matched', 'ok');
  };
  file.onchange = () => go(file.files[0]);
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); go(e.dataTransfer.files[0]); });
}
function openLink(tid) {
  const t = txns().find(x => x.id === tid); if (!t) return;
  const isCr = (t.credit || 0) > 0, amt = isCr ? t.credit : t.debit;
  const list = (isCr ? Q.salesRows() : Q.purchaseRows()).filter(r => r.status !== 'cancelled')
    .map(r => ({ r, sc: Math.abs(amt - (r.outstanding || r.total || 0)) }))
    .sort((a, b) => a.sc - b.sc);
  const b = overlay();
  const row = x => { const r = x.r; const ref = isCr ? r.inv : r.bill; const nm = isCr ? r.party : r.sup; return `<button class="rc-pick" data-idx="${r.idx}"><div><b>${esc(ref || '—')}</b> · ${esc(nm || '')}</div><div class="rc-pick-m">${fDS(r.date)} · total ${fC(r.total)} · due ${fC(r.outstanding || 0)}</div></button>`; };
  b.innerHTML = `<div class="rc-modal"><div class="rc-modal-h"><div class="rc-modal-t">Link ${isCr ? 'credit' : 'debit'} ${fC(amt)} to a ${isCr ? 'sales invoice' : 'purchase bill'}</div><button class="rc-modal-x" id="rcLX">&times;</button></div>
    <div class="rc-modal-b"><div class="rc-mut" style="font-size:12px;margin-bottom:8px">${fDS(t.date)} · ${esc((t.desc || '').slice(0, 60))}</div>
      <input class="rc-search" id="rcPickQ" placeholder="Search ${isCr ? 'invoice / customer' : 'bill / supplier'}…" style="width:100%;margin-bottom:10px">
      <div class="rc-picklist" id="rcPickList">${list.slice(0, 40).map(row).join('') || '<div class="rc-none">No bills found.</div>'}</div></div></div>`;
  const close = () => b.remove();
  document.getElementById('rcLX').onclick = close;
  const relist = q => { const f = q ? list.filter(x => { const r = x.r; return ((isCr ? r.inv + ' ' + r.party : r.bill + ' ' + r.sup) || '').toLowerCase().includes(q); }) : list; document.getElementById('rcPickList').innerHTML = f.slice(0, 40).map(row).join('') || '<div class="rc-none">No matches.</div>'; wirePicks(); };
  const wirePicks = () => b.querySelectorAll('[data-idx]').forEach(btn => btn.onclick = () => { t.m = { kind: isCr ? 'sale' : 'purchase', idx: +btn.dataset.idx, status: 'manual', manual: true }; Q.saveRecon(); close(); render(); toast('Linked to bill', 'ok'); });
  wirePicks();
  document.getElementById('rcPickQ').oninput = e => relist(e.target.value.toLowerCase());
}

/* ══════════════════ EXPORT ══════════════════ */
function exportRecon() {
  const rows = filteredTxns();
  QLShell.exportCSV('reconciliation_' + (Q.co.short || 'bank').replace(/\s+/g, '_') + (ST.month !== 'all' ? '_' + ST.month : ''),
    ['Date', 'Description', 'Ref/UTR', 'Debit', 'Credit', 'Balance', 'Matched Bill', 'Party', 'Status'],
    rows.map(t => { const bl = billFor(t); return [t.date, t.desc, t.ref, t.debit || '', t.credit || '', t.balance || '', bl ? (t.m.kind === 'sale' ? bl.inv : bl.bill) : (t.m && t.m.cat || ''), bl ? (t.m.kind === 'sale' ? bl.party : bl.sup) : '', (t.m && STAT[t.m.status]) ? STAT[t.m.status][0] : 'Unmatched']; }));
  toast('Exported ' + rows.length + ' transactions', 'ok');
}
function exportLedger() {
  const rows = partyLedger().filter(p => p.party !== '—');
  QLShell.exportCSV('party_ledger_' + (Q.co.short || 'firm').replace(/\s+/g, '_') + (ST.month !== 'all' ? '_' + ST.month : ''),
    ['Party', 'Sales', 'Purchases', 'Received', 'Paid', 'Net Pending'],
    rows.map(p => [p.party, p.sales, p.purchases, p.recv, p.paid, p.pending]));
  toast('Exported ' + rows.length + ' parties', 'ok');
}

/* ══════════════════ WIRE ══════════════════ */
function wire() {
  const $ = id => document.getElementById(id), root = document.getElementById('rcRoot'); if (!root) return;
  ['rcUpload', 'rcUpload2'].forEach(id => { if ($(id)) $(id).onclick = openUpload; });
  if ($('rcMonth')) $('rcMonth').onclick = e => openMonthMenu(e.currentTarget);
  if ($('rcMatch')) $('rcMatch').onclick = () => { runMatchAll(true); render(); toast('Re-matched ' + txns().length + ' transactions', 'ok'); };
  if ($('rcExport')) $('rcExport').onclick = exportRecon;
  if ($('rcLedgerExp')) $('rcLedgerExp').onclick = exportLedger;
  root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { ST.view = b.dataset.view; render(); });
  root.querySelectorAll('[data-ftype]').forEach(b => b.onclick = () => { ST.ftype = b.dataset.ftype; render(); });
  root.querySelectorAll('[data-fstatus]').forEach(b => b.onclick = () => { ST.fstatus = b.dataset.fstatus; render(); });
  if ($('rcSearch')) { const s = $('rcSearch'); s.oninput = () => { ST.q = s.value; const p = document.querySelector('.rc-panel'); if (p) { p.innerHTML = viewHTML(); wire(); s2focus(); } }; }
  root.querySelectorAll('[data-link]').forEach(b => b.onclick = () => openLink(b.dataset.link));
  root.querySelectorAll('[data-unlink]').forEach(b => b.onclick = () => { const t = txns().find(x => x.id === b.dataset.unlink); if (t) { t.m = { kind: (t.credit || 0) > 0 ? 'sale' : 'purchase', idx: null, status: 'unmatched' }; Q.saveRecon(); render(); } });
  root.querySelectorAll('[data-mark]').forEach(b => b.onclick = e => openMark(b.dataset.mark, e.currentTarget));
}
function s2focus() { const s = document.getElementById('rcSearch'); if (s) { s.focus(); const v = s.value; s.value = ''; s.value = v; } }

window.__qlRefresh = render;
window.__qlOnSwitchCompany = id => { ST.monthInit = false; Q.switchCompany(id, render); };
if (Q.init) Q.init(render); else render();
