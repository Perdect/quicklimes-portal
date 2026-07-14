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
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  ai: '<path d="M12 2l1.9 5.5L19.5 9l-5.6 1.5L12 16l-1.9-5.5L4.5 9l5.6-1.5z"/><circle cx="18" cy="18" r="1.5"/><circle cx="5" cy="17" r="1"/>',
  ck: '<polyline points="20 6 9 17 4 12"/>', bank: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>', wallet: '<path d="M2 8h20M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2M2 8v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8"/>',
  split: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
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
  manual:       ['Linked', '#dbeafe', '#1d4ed8'],
  review:       ['Needs review', '#fef9c3', '#a16207'],
  overpayment:  ['Overpayment', '#ffedd5', '#c2410c'],
  split:        ['Split', '#ede9fe', '#6d28d9']
};
function tierColor(t) { return t === 'green' ? ['#dcfce7', '#15803d'] : t === 'yellow' ? ['#fef9c3', '#a16207'] : ['#fef2f2', '#dc2626']; }
const toast = (m, t) => (QLShell.toast ? QLShell.toast(m, t) : 0);

let ST = { view: 'recon', month: 'all', monthInit: false, ftype: 'all', fstatus: 'all', q: '', sel: new Set(), foOpen: false };

/* ── helpers ─────────────────────────────────────────────────────────── */
function txns() { return (Q.recon.txns || []); }
const RC = window.ReconCore;                         // pure, unit-tested engine
function aliases() { return (Q.recon.aliases || (Q.recon.aliases = {})); }
function aliasOf(clean) { return aliases()[RC.normName(clean)] || null; }
function learnAlias(clean, party) { if (clean && party) { aliases()[RC.normName(clean)] = party; } }
// Resolve a bank narration to a party index (learned alias → exact name → first token).
function rcTxnParty(t) {
  const al = (aliases()[RC.normName(t.clean || '')]) || t.clean || '';
  const norm = s => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const target = norm(al); if (!target) return -1;
  const ps = Q.partyRows();
  let hit = ps.find(p => norm(p.name) === target) || ps.find(p => norm(p.name).split(' ')[0] === target.split(' ')[0]);
  return hit ? hit.idx : -1;
}
function ymOf(d) { return (d || '').slice(0, 7); }
function inMonth(d) { return !ST.month || ST.month === 'all' || ymOf(d) === ST.month; }
function monthLabel() { if (!ST.month || ST.month === 'all') return 'All months'; try { return new Date(ST.month + '-01T00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); } catch (_) { return ST.month; } }

/* ── matching engine (ReconCore) ─────────────────────────────────────── */
function npOf(t) { return { raw: t.raw || t.desc || '', clean: t.clean || '', utr: t.utr || '', cheque: t.cheque || '', mode: t.mode || '' }; }
// Names of the user's OWN firms (all plants) — for inter-firm transfer detection.
function ownNames() {
  const n = [].concat(Q.ownFirmNames || []);
  try { if (Q.co) { if (Q.co.name) n.push(Q.co.name); if (Q.co.short) n.push(Q.co.short); } Object.values(Q.COMPANIES || {}).forEach(c => { if (c.name) n.push(c.name); if (c.short) n.push(c.short); }); } catch (_) {}
  return [...new Set(n)];
}
function autoMatch(t) {
  const np = npOf(t);
  // 1) hard rules first: charges, interest, GST, cash, self — these narrations
  //    are bank-generated and never party names, so they never reach the
  //    matcher (a ₹29 "Charges for PORD Customer Payment" is a fee, not an
  //    unknown party). LOAN keywords are the exception: a real supplier can be
  //    named "Shriram Transport" — so a loan hit only sticks when no confident
  //    invoice match exists.
  const hard = RC.classifyTxn ? RC.classifyTxn(np, t) : null;
  const hardM = hard ? { kind: 'other', idx: null, status: 'other', cat: hard.cat, catKey: hard.key, auto: true, confidence: hard.confidence, tier: 'green', matchedBy: 'rule', reasons: hard.reasons, at: new Date().toISOString() } : null;
  // 2) invoice matching (sister firms pay real invoices — matching wins).
  const bills = (t.credit || 0) > 0 ? Q.salesRows() : Q.purchaseRows();
  const res = RC.bestMatch(np, t, bills, { aliasParty: aliasOf(np.clean) });
  // A CONFIDENT invoice match (real party + amount) overrides ANY hard rule —
  // so "EMI Transport" (customer) / "Shriram Transport" (freight supplier) book
  // to their bill, never swallowed as a loan/fee. Otherwise the hard rule wins.
  const strongMatch = res && res.idx != null && res.confidence >= 80;
  if (strongMatch) return Object.assign(res, { at: new Date().toISOString(), matchedBy: res.matchedBy || 'ai' });
  if (hardM) return hardM;
  // 3) residual: an UNMATCHED transfer whose narration IS one of our own firms
  //    is a likely inter-firm transfer — surfaced for REVIEW (never auto-hidden)
  //    so a real third-party receipt sharing our root token still reaches you.
  if ((res.status === 'unknown' || res.status === 'unmatched') && res.idx == null && RC.classifyResidual) {
    const resid = RC.classifyResidual(np, t, { ownNames: ownNames() });
    if (resid) return { kind: (t.credit || 0) > 0 ? 'sale' : 'purchase', idx: null, status: 'review', cat: resid.cat, catKey: resid.key, suggestInterfirm: true, confidence: resid.confidence, tier: 'yellow', matchedBy: 'ai', reasons: resid.reasons, at: new Date().toISOString() };
  }
  // 4) direction fallback: an unmatched line that still names a party is a
  //    customer receipt (credit) or supplier payment (debit) awaiting a link —
  //    never leave a real counterparty as a bare "Unknown".
  if ((res.status === 'unknown' || res.status === 'unmatched') && res.idx == null && RC.directionCat) {
    const dc = RC.directionCat(np, t);
    if (dc) return { kind: (t.credit || 0) > 0 ? 'sale' : 'purchase', idx: null, status: 'review', cat: dc.cat, catKey: dc.key, confidence: dc.confidence, tier: 'yellow', matchedBy: 'ai', needsLink: true, reasons: dc.reasons, at: new Date().toISOString() };
  }
  res.at = res.at || new Date().toISOString();
  res.matchedBy = res.matchedBy || 'ai';
  return res;
}
function runMatchAll(force) {
  const arr = txns();
  arr.forEach(t => { if (!t.m || !t.m.manual || force) t.m = autoMatch(t); });
  // pair the two legs of self transfers (cross-account: Dr in one a/c, Cr in
  // the other, same EBANK:SELF id) so both read as one internal movement
  if (RC.selfPairs) {
    try {
      RC.selfPairs(arr).forEach(p => {
        const c = arr[p.creditIdx], d = arr[p.debitIdx];
        [c, d].forEach(t => {
          if (t.m && t.m.manual) return;
          // never override a DIFFERENT hard classification (e.g. Loan / EMI)
          if (t.m && t.m.status === 'other' && t.m.catKey && t.m.catKey !== 'self') return;
          const other = t === c ? d : c;
          t.m = Object.assign({}, t.m, { kind: 'other', idx: null, status: 'other', cat: 'Self transfer', catKey: 'self', auto: true, confidence: 98, tier: 'green', matchedBy: 'rule', reasons: ['Two legs of one self transfer' + (p.id ? ' · ref ' + p.id : '') + ' — ' + fC(t.credit || t.debit) + ' ' + (t === c ? 'in' : 'out') + ' on ' + fDS(other.date)] });
        });
      });
    } catch (_) {}
  }
  // duplicate detection — UTR first, else amount + clean-name + date
  const seenKey = {}, seenBill = {};
  arr.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(t => {
    // manual rows keep their status but still REGISTER their key, so a
    // re-imported copy of a manually-confirmed line is caught as a duplicate
    const key = RC.dedupeKey(npOf(t), t);
    if (seenKey[key]) { if (!(t.m && t.m.manual)) { t.m.status = 'duplicate'; t.m.reasons = ['Duplicate of an earlier transaction']; } }
    else seenKey[key] = 1;
    if (t.m && t.m.manual) return;
    // Two txns claiming the same bill is only a duplicate when BOTH claim it
    // in full ('matched') — several partial/over payments against one running
    // bill are perfectly normal (instalments), not duplicates.
    if (t.m && t.m.idx != null && t.m.status === 'matched') { const bk = t.m.kind + t.m.idx; if (seenBill[bk]) t.m.status = 'duplicate'; else seenBill[bk] = 1; }
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
async function parseBankFile(file, password) {
  // PDFs go through the x-aware bank-table extractor (keeps the Withdrawal vs
  // Deposit columns apart); CSV/Excel through the generic reader as before.
  const isPdf = /\.pdf$/i.test(file.name || '') || file.type === 'application/pdf';
  let parsed = null;
  if (isPdf && QLFin.pdfBankTable) {
    // A password error must NOT be swallowed here, or the caller can never ask
    // for the password — banks routinely mail statements locked with a PAN/DOB.
    try { const tbl = await QLFin.pdfBankTable(file, password); if (tbl && tbl.length > 1) parsed = { rows: tbl, kind: 'pdf' }; }
    catch (e) { if (QLFin.pwError && QLFin.pwError(e)) { const err = new Error('locked'); err.pw = QLFin.pwError(e); throw err; } }
  }
  if (!parsed) {
    try { parsed = await QLFin.fileToRows(file, password); }
    catch (e) { if (QLFin.pwError && QLFin.pwError(e)) { const err = new Error('locked'); err.pw = QLFin.pwError(e); throw err; } throw e; }
  }
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
  const bank = RC.detectBank(rows.slice(0, 25).map(r => (r || []).join(' ')).join(' '));
  const out = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r]; if (!row) continue;
    const g = i => (i != null && i >= 0 && i < row.length) ? row[i] : '';
    const date = QLFin.parseDate(g(cDate));
    const narr = (g(cDesc) || '').toString().trim(), refVal = (g(cRef) || '').toString().trim();
    let debit = cDeb >= 0 ? QLFin.parseNum(g(cDeb)) : 0, credit = cCred >= 0 ? QLFin.parseNum(g(cCred)) : 0;
    if (!debit && !credit && cAmt >= 0) {
      const amt = QLFin.parseNum(g(cAmt)), ty = (g(cType) || '').toString().toLowerCase();
      if (/cr|credit|deposit/.test(ty)) credit = Math.abs(amt);
      else if (/dr|debit|withdraw/.test(ty)) debit = Math.abs(amt);
      else if (amt < 0) debit = Math.abs(amt); else credit = amt;
    }
    // A row with no date and no amount is a wrapped narration continuation of
    // the previous transaction (fixes the "…-ARIF" truncation) — never lose it.
    if (!date) {
      if (out.length && narr && !debit && !credit) {
        const last = out[out.length - 1];
        last.raw = (last.raw + ' ' + narr).replace(/\s+/g, ' ').trim();
        const rp = RC.parseNarration(last.raw); last.clean = rp.clean; if (!last.utr) last.utr = rp.utr; if (!last.cheque) last.cheque = rp.cheque;
      }
      continue;
    }
    if (!debit && !credit) continue;
    const np = RC.parseNarration(narr || refVal);
    if (!np.utr && refVal) np.utr = refVal;
    const balRaw = String(g(cBal) || '');
    const balSigned = RC.signedBalance ? RC.signedBalance(balRaw) : null;
    // Did this balance cell carry an EXPLICIT Dr/Cr marker (or minus)? Only then
    // is the sign trustworthy enough to override the parsed Debit/Credit columns.
    const balHasSign = /(cr|dr)\.?\s*$/i.test(balRaw) || /^-/.test(balRaw.trim());
    out.push({ id: 'bt' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36) + r, date, raw: np.raw || narr, desc: narr, clean: np.clean, utr: np.utr, cheque: np.cheque, mode: np.mode, bank, debit: debit || 0, credit: credit || 0, balance: balSigned != null ? balSigned : (QLFin.parseNum(balRaw) || 0), _balSigned: balHasSign, ref: refVal });
  }
  // Balance-chain verification: the running balance is arithmetic truth. A
  // Cash-Credit account runs a NEGATIVE (Dr) balance that GROWS with
  // withdrawals, so a naive Dr/Cr guess inverts the whole statement. BUT the
  // chain itself is sign-blind (negating every balance yields an equally
  // consistent inverse chain), so we ONLY trust it to override the columns when
  // the source actually printed Dr/Cr markers — otherwise we keep the columns
  // that pdfBankTable already assigned by position. This prevents silently
  // inverting an unsigned statement.
  try {
    const signedRows = out.filter(t => t._balSigned).length;
    if (RC.inferDirections && out.length >= 3 && signedRows >= Math.max(2, Math.floor(out.length * 0.5))) {
      const inf = RC.inferDirections(out.map(t => ({ amt: (t.credit || t.debit || 0), bal: t.balance })));
      if (inf.ok >= Math.max(3, Math.floor(out.length * 0.6))) {
        let fixed = 0;
        out.forEach((t, i) => {
          const d = inf.dirs[i]; if (!d) return;
          if (d === 'C' && t.debit) { t.credit = t.debit; t.debit = 0; fixed++; t._dirFixed = 1; }
          else if (d === 'D' && t.credit) { t.debit = t.credit; t.credit = 0; fixed++; t._dirFixed = 1; }
        });
        if (fixed) console.warn('[recon] balance chain corrected ' + fixed + ' of ' + out.length + ' transaction direction(s)');
      }
    }
  } catch (_) {}
  return out;
}

/* ── analytics ───────────────────────────────────────────────────────── */
function monthTxns() { return txns().filter(t => inMonth(t.date)); }
/* A transaction links to one bill (t.m.idx) OR many (t.m.allocs). allocsOf
   normalises both into an array of { kind, idx, amount } so every downstream
   consumer — ledger, cards, export, drawer — is split-aware for free. */
function allocsOf(t) {
  if (!t.m) return [];
  if (Array.isArray(t.m.allocs) && t.m.allocs.length) return t.m.allocs;
  if (t.m.idx != null) return [{ kind: t.m.kind, idx: t.m.idx, amount: (t.credit || t.debit || 0) }];
  return [];
}
function billOf(a) { const arr = a.kind === 'sale' ? Q.salesRows() : Q.purchaseRows(); return arr.find(r => r.idx === a.idx) || null; }
function billsFor(t) { return allocsOf(t).map(a => { const b = billOf(a); return b ? { kind: a.kind, idx: a.idx, amount: a.amount, bill: b } : null; }).filter(Boolean); }
function billFor(t) { const a = allocsOf(t)[0]; return a ? billOf(a) : null; }
function isSplit(t) { return t.m && Array.isArray(t.m.allocs) && t.m.allocs.length > 1; }
function isLinked(t) { return t.m && (t.m.idx != null || (Array.isArray(t.m.allocs) && t.m.allocs.length) || t.m.status === 'other' || t.m.manual); }
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
  monthTxns().forEach(t => billsFor(t).forEach(x => { const name = x.kind === 'sale' ? x.bill.party : x.bill.sup; const p = touch(name || '—'); if (t.credit) p.recv += x.amount; else if (t.debit) p.paid += x.amount; }));
  return Object.values(by).map(p => ({ ...p, pending: p.pendS - p.pendP, business: p.sales + p.purchases })).sort((a, b) => b.business - a.business);
}
/* What the AI understood this month — the digest that leads the insights bar. */
function categoryDigest() {
  const tt = monthTxns();
  const d = { receipts: 0, payments: 0, charges: 0, loan: 0, internal: 0, gst: 0, dup: 0, exceptions: 0, understood: 0 };
  tt.forEach(t => {
    const m = t.m || {};
    if (m.status === 'duplicate') { d.dup++; d.exceptions++; return; }
    if (m.status === 'other') {
      d.understood++;
      const k = m.catKey || '';
      if (k === 'charges' || k === 'interest' || /charge|interest|fee/i.test(m.cat || '')) d.charges++;
      else if (k === 'loan' || /loan|emi/i.test(m.cat || '')) d.loan++;
      else if (k === 'self' || k === 'interfirm' || k === 'cash' || /self|inter-firm|cash|partner/i.test(m.cat || '')) d.internal++;
      else if (k === 'gst' || /gst/i.test(m.cat || '')) d.gst++;
      return;
    }
    if (isLinked(t)) { d.understood++; if (t.credit) d.receipts++; else d.payments++; return; }
    d.exceptions++;
  });
  d.total = tt.length;
  return d;
}
function aiSuggestions() {
  const out = [], tt = monthTxns();
  // Lead with the digest — "AI understood X of Y" + what needs the accountant.
  if (tt.length) {
    const d = categoryDigest();
    const bits = [];
    if (d.receipts) bits.push(d.receipts + ' customer receipt' + (d.receipts === 1 ? '' : 's'));
    if (d.payments) bits.push(d.payments + ' supplier payment' + (d.payments === 1 ? '' : 's'));
    if (d.charges) bits.push(d.charges + ' bank charge' + (d.charges === 1 ? '' : 's'));
    if (d.loan) bits.push(d.loan + ' loan/EMI');
    if (d.internal) bits.push(d.internal + ' internal');
    if (d.gst) bits.push(d.gst + ' GST');
    if (d.dup) bits.push(d.dup + ' duplicate' + (d.dup === 1 ? '' : 's'));
    out.push({ ic: '🤖', tone: d.exceptions ? 'warn' : 'ok', t: `AI understood ${d.understood} of ${d.total} transactions`, s: (bits.join(' · ') || 'nothing categorized yet') + (d.exceptions ? ` — ${d.exceptions} exception${d.exceptions === 1 ? '' : 's'} need${d.exceptions === 1 ? 's' : ''} you.` : ' — nothing needs review. ✓') });
  }
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
  if (!ST.monthInit) { const saved = Q.uiMonth ? Q.uiMonth() : null; const ms = [...new Set(txns().map(t => ymOf(t.date)).filter(Boolean))].sort(); ST.month = saved || (ms.length ? ms[ms.length - 1] : 'all'); ST.monthInit = true; }
  let root = document.getElementById('rcRoot');
  if (!root) { main.innerHTML = '<div class="rc" id="rcRoot"></div>'; root = document.getElementById('rcRoot'); }
  try {
    root.innerHTML = heroHTML() + (txns().length ? summaryHTML() + finOverviewHTML() + aiHTML() + toolbarHTML() + `<div class="rc-panel">${viewHTML()}</div>` + bulkBarHTML() : emptyHTML());
    wire();
  } catch (e) { console.warn('recon render deferred:', e); }
  QLShell.paintWorkspace && QLShell.paintWorkspace();
}
function heroHTML() {
  return `<div class="rc-hero">
    <div><div class="rc-h1">Bank Reconciliation</div><div class="rc-sub">${esc(monthLabel())} · <b>${esc(Q.co.short || 'Company')}</b> · ${monthTxns().length} transaction${monthTxns().length === 1 ? '' : 's'}</div></div>
    <div class="rc-hero-r">
      <button class="rc-btn" id="rcMonth">${svg(IC.cal)}<span>${esc(monthLabel())}</span>${svg('<polyline points="6 9 12 15 18 9"/>')}</button>
      ${txns().length ? `<button class="rc-btn rc-btn-ai" id="rcMatch" title="Run the AI matching engine">${svg(IC.ai)}<span>AI Reconcile</span></button><button class="rc-btn" id="rcExport">${svg(IC.dl)}<span>Export</span></button>` : ''}
      <button class="rc-btn rc-btn-primary" id="rcUpload">${svg(IC.up)}<span>Upload statement</span></button>
    </div></div>`;
}
function emptyHTML() {
  return `<div class="rc-empty"><div class="rc-empty-ic">${svg(IC.bank)}</div>
    <div class="rc-empty-t">Upload your bank statement to begin</div>
    <div class="rc-empty-s">PDF, Excel or CSV. We read Date, Description, Debit, Credit, Balance &amp; UTR/Ref, then auto-match credits to your sales invoices and debits to your purchase bills for <b>${esc(Q.co.short || 'this firm')}</b>.</div>
    <button class="rc-btn rc-btn-primary" id="rcUpload2">${svg(IC.up)}<span>Upload bank statement</span></button></div>`;
}
/* One transaction's clear status (fewer, clearer statuses). */
function statusKey(t) {
  const m = t.m || {};
  if (m.status === 'duplicate') return 'duplicate';
  if (m.status === 'partial') return 'partial';
  // A yellow-tier suggestion (review / overpayment / mismatch) has a linked
  // idx but still NEEDS A HUMAN — it must never count as matched.
  if (!m.manual && (m.status === 'review' || m.status === 'overpayment' || m.status === 'amountdiff' || m.status === 'datemismatch')) return 'review';
  if (isLinked(t)) return 'matched';
  if (m.status === 'unknown') return 'unknown';
  return 'unmatched';
}
function needsReview(t) { return statusKey(t) !== 'matched'; }

/* ── ONE compact summary strip (4 segments) — replaces the 9-card dashboard ── */
function summaryHTML() {
  const c = cards(), tt = monthTxns();
  const credN = tt.filter(t => (t.credit || 0) > 0).length, debN = tt.filter(t => (t.debit || 0) > 0).length;
  const matchedRows = tt.filter(t => statusKey(t) === 'matched');
  const matchN = matchedRows.length;
  c.matched = matchedRows.reduce((a, t) => a + (t.credit || 0) + (t.debit || 0), 0);   // same definition as the count
  const rev = tt.filter(needsReview); const revAmt = rev.reduce((a, t) => a + (t.credit || 0) + (t.debit || 0), 0);
  const seg = (cls, ic, label, val, sub) => `<div class="rc-sum-seg"><span class="rc-sum-ic ${cls}">${ic}</span><div class="rc-sum-x"><span class="rc-sum-l">${label}</span><span class="rc-sum-v">${val}</span><span class="rc-sum-sub">${sub}</span></div></div>`;
  return `<div class="rc-summary">
    ${seg('g', svg('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'), 'Money In', fC(c.credits), credN + ' credit' + (credN === 1 ? '' : 's'))}
    ${seg('r', svg('<line x1="12" y1="5" x2="12" y2="19"/><polyline points="5 12 12 19 19 12"/>'), 'Money Out', fC(c.debits), debN + ' debit' + (debN === 1 ? '' : 's'))}
    ${seg('b', svg(IC.ck), 'Matched', fC(c.matched), matchN + ' linked')}
    ${seg('p', svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'), 'Needs Review', fC(revAmt), rev.length + ' transaction' + (rev.length === 1 ? '' : 's'))}
  </div>`;
}
/* Secondary metrics live in a collapsed accordion, out of the primary flow. */
function finOverviewHTML() {
  const c = cards();
  const kv = (l, v, col) => `<div class="rc-fo-kv"><span>${l}</span><b${col ? ` style="color:${col}"` : ''}>${fC(v)}</b></div>`;
  return `<details class="rc-fo"${ST.foOpen ? ' open' : ''}><summary class="rc-fo-h">${svg('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>')}<span>Financial overview</span><em>receivables · payables · GST · net flow</em>${svg('<polyline points="6 9 12 15 18 9"/>')}</summary>
    <div class="rc-fo-grid">
      ${kv('Pending receivable', c.recv)}${kv('Pending payable', c.pay)}${kv('GST input (ITC)', c.gstIn)}${kv('GST output', c.gstOut)}${kv('Net cash flow', c.net, c.net >= 0 ? '#16a34a' : 'var(--ql-danger-600)')}
    </div></details>`;
}
function aiHTML() {
  const items = aiSuggestions();
  if (!items.length) return '';
  const top = items[0];
  return `<div class="rc-aibar">
    <span class="rc-aibar-ic">${svg(IC.ai)}</span>
    <span class="rc-aibar-t"><b>${esc(top.t)}</b><em>${top.s}</em></span>
    ${items.length > 1 ? `<span class="rc-aibar-more">+${items.length - 1} more</span>` : ''}
    <button class="rc-aibar-btn" id="rcAiReview">Review needs-action</button>
  </div>`;
}
/* ── ONE clean filter toolbar: status tabs (with counts) + type toggle + search ── */
function toolbarHTML() {
  const tt = monthTxns();
  const cnt = k => k === 'all' ? tt.length : k === 'review' ? tt.filter(needsReview).length : tt.filter(t => statusKey(t) === k).length;
  const tab = (k, l) => `<button class="rc-ftab ${ST.fstatus === k ? 'on' : ''} k-${k}" data-fstatus="${k}">${l}<span class="rc-ftab-n">${cnt(k)}</span></button>`;
  if (ST.view === 'ledger') return `<div class="rc-toolbar2"><div class="rc-ftabs"><button class="rc-ftab on" data-view="recon">${svg('<polyline points="15 18 9 12 15 6"/>')} Back to reconciliation</button></div><div class="rc-tb-r"><button class="rc-mini2" id="rcLedgerExp">${svg(IC.dl)} Export ledger</button></div></div>`;
  const typ = (k, l) => `<button class="rc-typ ${ST.ftype === k ? 'on' : ''}" data-ftype="${k}">${l}</button>`;
  return `<div class="rc-toolbar2">
    <div class="rc-ftabs">${tab('all', 'All')}${tab('review', 'Needs review')}${tab('matched', 'Matched')}${tab('partial', 'Partial')}${tab('unmatched', 'Unmatched')}${tab('duplicate', 'Duplicate')}</div>
    <div class="rc-tb-r">
      <div class="rc-typtog">${typ('all', 'All')}${typ('credit', 'Credit')}${typ('debit', 'Debit')}</div>
      <div class="rc-searchw">${svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>')}<input class="rc-search2" id="rcSearch" placeholder="Search party, ref, amount…" value="${esc(ST.q)}"></div>
      <button class="rc-mini2" data-view="ledger" title="Party ledger">${svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>')}<span>Ledger</span></button>
    </div></div>`;
}
function bulkBarHTML() {
  if (!ST.sel || !ST.sel.size) return '';
  return `<div class="rc-bulk"><span class="rc-bulk-n">${ST.sel.size} selected</span>
    <button class="rc-bulk-b" data-bulk="confirm">${svg(IC.ck)} Confirm suggested</button>
    <button class="rc-bulk-b" data-bulk="dup">Mark duplicate</button>
    <button class="rc-bulk-b" data-bulk="ignore">Ignore</button>
    <button class="rc-bulk-b" data-bulk="export">${svg(IC.dl)} Export</button>
    <button class="rc-bulk-x" data-bulk="clear" title="Clear">${svg(IC.x)}</button></div>`;
}
function filteredTxns() {
  let r = monthTxns();
  if (ST.ftype === 'credit') r = r.filter(t => (t.credit || 0) > 0);
  if (ST.ftype === 'debit') r = r.filter(t => (t.debit || 0) > 0);
  if (ST.fstatus === 'review') r = r.filter(needsReview);
  else if (ST.fstatus === 'matched') r = r.filter(t => statusKey(t) === 'matched');
  else if (ST.fstatus === 'unmatched') r = r.filter(t => statusKey(t) === 'unmatched');
  else if (ST.fstatus === 'partial') r = r.filter(t => statusKey(t) === 'partial');
  else if (ST.fstatus === 'duplicate') r = r.filter(t => statusKey(t) === 'duplicate');
  if (ST.q) { const q = ST.q.toLowerCase(); r = r.filter(t => { const b = billFor(t); return ((t.clean || '') + ' ' + (t.raw || t.desc || '') + ' ' + (t.utr || '') + ' ' + (t.ref || '') + ' ' + (t.credit || t.debit || '') + ' ' + (b ? (b.party || b.sup || '') + ' ' + (b.inv || b.bill || '') : '')).toLowerCase().includes(q); }); }
  return r.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
function badge(t) {
  const m = t.m || {}, s = STAT[m.status] || STAT.unmatched;
  const showConf = m.confidence != null && ['matched', 'partial', 'review', 'overpayment', 'amountdiff', 'datemismatch'].indexOf(m.status) >= 0;
  const dot = m.tier ? `<span class="rc-dot ${m.tier}"></span>` : '';
  return `<span class="rc-badge" style="background:${s[1]};color:${s[2]}">${dot}${s[0]}${m.manual ? ' ✓' : ''}${showConf ? ' · ' + m.confidence + '%' : ''}</span>`;
}
function matchCell(t) {
  if (isSplit(t)) { const bl = billsFor(t); const names = bl.map(x => x.kind === 'sale' ? x.bill.party : x.bill.sup).filter(Boolean); const uniq = [...new Set(names)]; return `<div class="rc-match"><b>${bl.length} bills · ${fC(bl.reduce((a, x) => a + x.amount, 0))}</b><span>${esc(uniq.slice(0, 2).join(', '))}${uniq.length > 2 ? ' +' + (uniq.length - 2) : ''}</span></div>`; }
  if (t.m && t.m.kind === 'ledger') return `<div class="rc-match"><b>Running a/c</b><span>${esc(t.m.party || '')}</span></div>`;
  const b = billFor(t);
  if (b) { const ref = t.m.kind === 'sale' ? b.inv : b.bill; const nm = t.m.kind === 'sale' ? b.party : b.sup; return `<div class="rc-match"><b>${esc(ref || '—')}</b><span>${esc(nm || '')}${t.m.kind === 'purchase' && b.emoji ? ' · ' + b.emoji : ''}</span></div>`; }
  if (t.m && t.m.status === 'other') return `<div class="rc-match"><b>${esc(t.m.cat || 'Categorized')}</b><span>non-bill entry</span></div>`;
  return `<span class="rc-mut">—</span>`;
}
function viewHTML() {
  if (ST.view === 'ledger') return ledgerHTML();
  const rows = filteredTxns();
  if (!rows.length) return `<div class="rc-none">${ST.month && ST.month !== 'all' ? 'No matching transactions for ' + esc(monthLabel()) : 'No transactions match these filters'}.</div>`;
  const body = rows.map(t => {
    const sel = ST.sel && ST.sel.has(t.id);
    return `<tr data-open="${t.id}" class="rc-clk${sel ? ' rc-selrow' : ''}">
    <td class="rc-cbx"><button class="rc-cb${sel ? ' on' : ''}" data-sel="${t.id}" title="Select">${sel ? svg(IC.ck) : ''}</button></td>
    <td class="rc-mut rc-nowrap">${fDS(t.date)}</td>
    <td class="rc-party">${partyCell(t)}</td>
    <td>${typeCell(t)}</td>
    <td class="r">${amountCell(t)}</td>
    <td>${suggestCell(t)}</td>
    <td class="rc-cf">${confCell(t)}</td>
    <td>${badge(t)}</td>
    <td class="rc-actcell">${actionCell(t)}</td>
  </tr>`; }).join('');
  return `<div class="rc-tablewrap"><table class="rc-table rc-table2">
    <thead><tr><th class="rc-cbx"></th><th>Date</th><th>Party / Description</th><th>Type</th><th class="r">Amount</th><th>Suggested match</th><th>Confidence</th><th>Status</th><th></th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}
/* ── table cells ── */
function titleCase(s) { return (s || '').toString().toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()); }
function partyCell(t) {
  const b = billFor(t), m = t.m || {}, alias = (aliases()[RC.normName(t.clean || '')] || '');
  const known = b ? (t.credit ? b.party : b.sup) : (m.party || alias || '');
  // Primary line: the resolved PARTY (or the category for non-bill entries) —
  // never the raw bank blob. Secondary: normalized "mode · ref", not narration.
  const isOther = m.status === 'other';
  const name = known || (isOther ? m.cat : '') || titleCase(t.clean) || (t.raw || t.desc || '—').slice(0, 36);
  const mode = t.mode || (t.cheque ? 'CHQ' : '');
  const shortRef = t.utr ? String(t.utr).slice(-10) : (t.cheque || '');
  const norm2 = [mode, shortRef].filter(Boolean).join(' · ') || (t.raw || t.desc || '').slice(0, 38);
  const sub = known ? `<div class="rc-party-r">${svg('<path d="M20 6 9 17l-5-5"/>')}Recognized as <b>${esc(known)}</b></div>`
    : (!isOther && ((m.status === 'unknown') || !isLinked(t)) ? `<div class="rc-party-u"><span class="rc-uk">Unknown party</span><button class="rc-idbtn" data-link="${t.id}">Identify</button></div>` : '');
  return `<div class="rc-party-n">${esc(name)}</div><div class="rc-party-nar">${esc(norm2)}</div>${sub}`;
}
/* Transaction column — WHAT this money movement is, not just Credit/Debit. */
function typeCell(t) {
  const m = t.m || {};
  const chip = (l, cls) => `<span class="rc-tp ${cls}">${esc(l)}</span>`;
  if (m.status === 'other') {
    const key = m.catKey || '';
    const cls = key === 'self' || key === 'interfirm' ? 'rc-tp-i' : key === 'loan' ? 'rc-tp-l' : key === 'gst' ? 'rc-tp-g' : key === 'cash' ? 'rc-tp-a' : 'rc-tp-x';
    return chip(m.cat || 'Categorized', cls);
  }
  if (m.kind === 'ledger') return chip(t.credit ? 'On-account receipt' : 'On-account payment', t.credit ? 'rc-tp-c' : 'rc-tp-d');
  if (m.idx != null || isSplit(t)) return t.credit ? chip('Customer payment', 'rc-tp-c') : chip('Supplier payment', 'rc-tp-d');
  return t.credit ? chip('Credit', 'rc-tp-c') : chip('Debit', 'rc-tp-d');
}
function amountCell(t) { return t.credit ? `<span class="rc-amt rc-cr">+ ${fC(t.credit)}</span>` : `<span class="rc-amt rc-dr">− ${fC(t.debit)}</span>`; }
function suggestCell(t) {
  if (isSplit(t)) { const bl = billsFor(t); return `<div class="rc-sg"><b>${bl.length} bills · ${fC(bl.reduce((a, x) => a + x.amount, 0))}</b><span class="rc-sg-p">split allocation</span></div>`; }
  if (t.m && t.m.kind === 'ledger') return `<div class="rc-sg"><b>Running account</b><span class="rc-sg-p">${esc(t.m.party || '')}</span></div>`;
  const b = billFor(t);
  if (b) {
    const ref = t.m.kind === 'sale' ? b.inv : b.bill, nm = t.m.kind === 'sale' ? b.party : b.sup;
    const alloc = t.credit || t.debit || 0, tot = b.total || alloc;
    const over = alloc > tot + 1;
    const pct = Math.min(100, Math.round(alloc / (tot || 1) * 100));
    const col = over ? '#dc2626' : pct >= 99 ? '#16a34a' : '#f59e0b';
    const line = over ? `${fC(alloc)} — exceeds bill by ${fC(alloc - tot)}` : `${fC(alloc)} of ${fC(tot)}`;
    return `<div class="rc-sg"><b>${esc(ref || '—')}</b><span class="rc-sg-p">${esc(nm || '')}</span>
      <div class="rc-sg-of"${over ? ' style="color:#dc2626;font-weight:600"' : ''}>${line}</div><div class="rc-sg-bar"><i style="width:${pct}%;background:${col}"></i></div></div>`;
  }
  if (t.m && t.m.status === 'other') return `<div class="rc-sg"><b>${esc(t.m.cat || 'Categorized')}</b><span class="rc-sg-p">non-bill entry</span></div>`;
  return '<span class="rc-mut">— no match —</span>';
}
function confCell(t) {
  const m = t.m || {}; if (m.confidence == null || !isLinked(t)) return '<span class="rc-mut">—</span>';
  const c = m.confidence, col = c >= 90 ? '#16a34a' : c >= 70 ? '#f59e0b' : '#dc2626';
  return `<span class="rc-conf-dot" style="--cc:${col}"><i></i>${c}%</span>`;
}
function actionCell(t) {
  return `<button class="rc-review" data-open="${t.id}">Review</button><button class="rc-kebab" data-more="${t.id}" title="More">${svg(IC.dots || '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>')}</button>`;
}
function ledgerHTML() {
  const rows = partyLedger().filter(p => p.party !== '—');
  if (!rows.length) return `<div class="rc-none">No party data yet.</div>`;
  const initial = n => ((n || '').trim()[0] || '?').toUpperCase();
  const hue = n => { let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360; return h; };
  const recvTot = rows.reduce((a, p) => a + (p.pending > 0 ? p.pending : 0), 0);
  const payTot = rows.reduce((a, p) => a + (p.pending < 0 ? -p.pending : 0), 0);
  const chip = (l, v, cls) => v ? `<span class="rc-lg-chip ${cls || ''}">${l} ${fC(v)}</span>` : '';
  const body = rows.map(p => {
    const net = p.pending, h = hue(p.party);
    const dir = net > 0.5 ? ['owes you', 'r'] : net < -0.5 ? ['advance held', 'g'] : ['settled', 'm'];
    return `<div class="rc-lg-row" data-ledger="${esc(p.party)}">
      <div class="rc-lg-av" style="background:hsl(${h} 70% 93%);color:hsl(${h} 52% 38%)">${esc(initial(p.party))}</div>
      <div class="rc-lg-main">
        <div class="rc-lg-name">${esc(p.party)}</div>
        <div class="rc-lg-sub">${chip('Sales', p.sales)}${chip('Purch', p.purchases)}${p.recv ? `<span class="rc-lg-chip rc-cr">↓ ${fC(p.recv)}</span>` : ''}${p.paid ? `<span class="rc-lg-chip rc-dr">↑ ${fC(p.paid)}</span>` : ''}</div>
      </div>
      <div class="rc-lg-net rc-lg-${dir[1]}">
        <div class="rc-lg-amt">${net ? fC(Math.abs(net)) : '—'}</div>
        <div class="rc-lg-dir">${net ? dir[0] : 'settled'}</div>
      </div>
    </div>`;
  }).join('');
  const head = `<div class="rc-lg-head">
    <div class="rc-lg-hcard rc-lg-r"><span>To receive</span><b>${fC(recvTot)}</b></div>
    <div class="rc-lg-hcard rc-lg-g"><span>To pay</span><b>${fC(payTot)}</b></div>
    <div class="rc-lg-hcard"><span>Parties</span><b>${rows.length}</b></div>
  </div>`;
  return `<div class="rc-ledger2">${head}<div class="rc-lg-list">${body}</div></div>`;
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
    m.querySelectorAll('[data-ym]').forEach(b => b.onclick = () => { ST.month = b.dataset.ym; ST.monthInit = true; if (Q.setUiMonth) Q.setUiMonth(b.dataset.ym); closeRcMenu(); render(); });
  };
  paint(); placeRcMenu(m, anchor);
}
function openMark(tid, anchor) {
  closeRcMenu();
  const t = txns().find(x => x.id === tid); if (!t) return;
  const cats = ['Advance payment', 'Self transfer', 'Inter-firm transfer', 'Partner transfer', 'Loan / EMI', 'Cash withdrawal', 'GST payment', 'Bank charges', 'Interest', 'Petcoke', 'Limestone', 'Plastic Bags', 'Royalty', 'Ignore', 'Other'];
  const m = document.createElement('div'); m.className = 'rc-menu';
  m.innerHTML = `<div class="rc-menu-h">Mark as</div>${cats.map(c => `<button class="rc-menu-i" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}`;
  m.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { t.m = { kind: 'other', idx: null, status: 'other', cat: b.dataset.cat, manual: true, confidence: 100, matchedBy: 'manual', reasons: ['Categorized as ' + b.dataset.cat + ' by user'], at: new Date().toISOString() }; Q.saveRecon(); closeRcMenu(); render(); toast('Marked as ' + b.dataset.cat, 'ok'); });
  placeRcMenu(m, anchor);
}
/* Row 3-dot menu: one place for the secondary actions (keeps the row clean). */
function openKebab(tid, anchor) {
  closeRcMenu();
  const t = txns().find(x => x.id === tid); if (!t) return;
  const m = document.createElement('div'); m.className = 'rc-menu';
  const item = (label, fn, cls) => { const b = document.createElement('button'); b.className = 'rc-menu-i' + (cls ? ' ' + cls : ''); b.textContent = label; b.onclick = () => { closeRcMenu(); fn(); }; return b; };
  m.appendChild(item('Match to a bill', () => openLink(tid)));
  m.appendChild(item('Change party / identify', () => openLink(tid)));
  m.appendChild(item('Split across bills', () => openSplit(tid)));
  if (!isLinked(t) && rcTxnParty(t) >= 0) m.appendChild(item('Mark as advance (on-account)', () => { const pidx = rcTxnParty(t); if (postOnAccount(t, pidx, (t.credit ? 'Advance received' : 'Advance paid'))) { runMatchAll(); render(); } }));
  m.appendChild(item('Categorize', () => openMark(tid, anchor)));
  const isDup = t.m && t.m.status === 'duplicate';
  m.appendChild(item(isDup ? 'Unmark duplicate' : 'Mark duplicate', () => { markDuplicate(t, !isDup); render(); }));
  if (isLinked(t)) m.appendChild(item('Undo match', () => { undoMatch(t); render(); }, 'del'));
  placeRcMenu(m, anchor);
}
function markDuplicate(t, on) { t.m = Object.assign({}, t.m || {}, { status: on ? 'duplicate' : (t.m && t.m.idx != null ? 'matched' : 'unmatched'), manual: true }); Q.saveRecon(); }
function undoMatch(t) { if (t.m && t.m.kind === 'ledger' && t.m.ledgerEntryId && Q.reverseLedgerEntry) Q.reverseLedgerEntry(t.m.partyIdx, t.m.ledgerEntryId); t.m = { kind: (t.credit || 0) > 0 ? 'sale' : 'purchase', idx: null, status: 'unmatched', confidence: 0, matchedBy: 'manual', reasons: ['Unlinked by user'], at: new Date().toISOString() }; Q.saveRecon(); }
function bulkAction(a) {
  const rows = txns().filter(t => ST.sel.has(t.id));
  if (a === 'clear') { ST.sel.clear(); render(); return; }
  if (a === 'confirm') { rows.forEach(t => { if (t.m && t.m.idx != null) t.m = Object.assign({}, t.m, { status: (t.credit || t.debit) < ((billFor(t) || {}).outstanding != null ? billFor(t).outstanding : Infinity) - 1 ? 'partial' : 'matched', manual: true, confidence: 100 }); }); Q.saveRecon(); ST.sel.clear(); render(); toast('Confirmed ' + rows.length + ' match' + (rows.length === 1 ? '' : 'es'), 'ok'); return; }
  if (a === 'dup') { rows.forEach(t => markDuplicate(t, true)); ST.sel.clear(); render(); toast('Marked ' + rows.length + ' as duplicate', 'ok'); return; }
  if (a === 'ignore') { rows.forEach(t => { t.m = { kind: 'other', idx: null, status: 'other', cat: 'Ignored', manual: true, confidence: 100 }; }); Q.saveRecon(); ST.sel.clear(); render(); toast('Ignored ' + rows.length, 'ok'); return; }
  if (a === 'export') { exportRecon(); ST.sel.clear(); render(); return; }
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
      ${txns().length ? `<div class="rc-note" style="margin-top:8px">Re-importing a statement you fixed? <a href="#" id="rcClearAll" style="color:var(--ql-danger-600);font-weight:600">Clear the ${txns().length} imported transaction${txns().length === 1 ? '' : 's'}</a> first so the fresh rows don't read as duplicates. Manual links posted to party ledgers are reversed too.</div>` : ''}
    </div></div>`;
  const close = () => b.remove();
  document.getElementById('rcUX').onclick = close;
  const clearBtn = document.getElementById('rcClearAll');
  if (clearBtn) clearBtn.onclick = e => {
    e.preventDefault();
    QLShell.confirmDelete({
      title: 'Remove all ' + txns().length + ' bank transactions?',
      desc: 'On-account ledger postings made from them will be reversed. Your invoices, bills and payments are untouched. This clears the imported statement so you can re-upload.',
      needType: 'CLEAR', confirmLabel: 'Remove all',
      onConfirm() {
        txns().forEach(t => { const m = t.m || {}; if (m.kind === 'ledger' && m.ledgerEntryId && Q.reverseLedgerEntry) { try { Q.reverseLedgerEntry(m.partyIdx, m.ledgerEntryId); } catch (_) {} } });
        Q.recon.txns = []; Q.saveRecon(); close(); render(); toast('Imported transactions cleared — upload the statement again', 'ok');
      }
    });
  };
  const drop = document.getElementById('rcDrop'), file = document.getElementById('rcFile'), msg = document.getElementById('rcUpMsg');
  // Banks mail statements locked with a PAN/DOB-style password. Ask for it in
  // place and retry — the password stays in this tab (handed to pdf.js only)
  // and is never stored or uploaded.
  const askPassword = (f, wrong) => {
    msg.innerHTML = `<div class="rc-pw">
      <div class="rc-pw-head">${svg(IC.lock || '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>')}
        <div><div class="rc-pw-t">This statement is password-protected</div>
        <div class="rc-pw-s">${wrong ? 'That password didn\'t work — check and try again.' : 'Enter the password your bank uses to open <b>' + esc(f.name) + '</b>.'}</div></div></div>
      <div class="rc-pw-row">
        <input class="rc-pw-in" id="rcPw" type="password" autocomplete="off" placeholder="Statement password" aria-label="Statement password">
        <button class="rc-btn rc-btn-primary" id="rcPwGo">Unlock</button>
      </div>
      <div class="rc-pw-n">Often your PAN, date of birth (DDMMYYYY), or customer ID — check the email the bank sent it in. It's used only on this device to open the file.</div>
    </div>`;
    const inp = document.getElementById('rcPw'), btn = document.getElementById('rcPwGo');
    inp.focus();
    const submit = () => { const pw = inp.value; if (!pw) { inp.focus(); return; } go(f, pw); };
    btn.onclick = submit;
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
  };
  const go = async (f, password) => {
    if (!f) return;
    msg.innerHTML = `<div class="rc-loading">${password ? 'Unlocking' : 'Reading'} <b>${esc(f.name)}</b>…</div>`;
    let parsed;
    try { parsed = await parseBankFile(f, password); }
    catch (e) {
      if (e && e.pw) { askPassword(f, e.pw === 2 || !!password); return; }
      msg.innerHTML = `<div class="rc-err">${esc(e.message || 'Could not read this file. Export it as CSV or Excel and try again.')}</div>`; return;
    }
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
/* Reverse an on-account ledger entry safely: party indexes shift when parties
   are edited/deleted, so verify the stored idx actually holds the entry and
   fall back to scanning all parties for the (globally unique) ledger id. */
function reverseLedgerSafe(pidx, lid) {
  if (!lid || !Q.reverseLedgerEntry) return false;
  const holds = i => { const p = (Q.state.PARTIES || [])[i]; return p && (p.ledger || []).some(e => e.id === lid); };
  let idx = (pidx >= 0 && holds(pidx)) ? pidx : (Q.state.PARTIES || []).findIndex((_, i) => holds(i));
  if (idx >= 0) { Q.reverseLedgerEntry(idx, lid); return true; }
  return false;
}
/* Post a bank transaction on-account to a party's running balance (advance /
   partial / lump-sum). One shared path for the link modal AND the drawer. */
function postOnAccount(t, pidx, label) {
  const isCr = (t.credit || 0) > 0, amt = isCr ? t.credit : t.debit;
  const p = Q.partyRows().find(x => x.idx === pidx); if (!p) return false;
  const entry = { date: t.date, ref: t.utr || t.ref || '', mode: 'Bank', desc: (label || ('Bank ' + (isCr ? 'receipt' : 'payment'))) + (t.desc ? ' · ' + String(t.desc).slice(0, 36) : '') };
  if (isCr) entry.cr = amt; else entry.dr = amt;
  const lid = Q.recordLedgerEntry(pidx, entry);
  if (t.clean) learnAlias(t.clean, p.name);
  t.m = { kind: 'ledger', partyIdx: pidx, party: p.name, ledgerEntryId: lid, status: 'matched', manual: true, matchedBy: 'ledger', confidence: 100, reasons: [(label || 'Posted on-account') + ' → ' + p.name + ' running balance'], at: new Date().toISOString() };
  toast('Posted ' + fC(amt) + ' to ' + p.name + ' · running a/c', 'ok');
  return true;
}
function openLink(tid) {
  const t = txns().find(x => x.id === tid); if (!t) return;
  const isCr = (t.credit || 0) > 0, amt = isCr ? t.credit : t.debit;
  const list = (isCr ? Q.salesRows() : Q.purchaseRows()).filter(r => r.status !== 'cancelled')
    .map(r => ({ r, sc: Math.abs(amt - (r.outstanding || r.total || 0)) }))
    .sort((a, b) => a.sc - b.sc);
  const b = overlay();
  const row = x => { const r = x.r; const ref = isCr ? r.inv : r.bill; const nm = isCr ? r.party : r.sup; return `<button class="rc-pick" data-idx="${r.idx}"><div><b>${esc(ref || '—')}</b> · ${esc(nm || '')}</div><div class="rc-pick-m">${fDS(r.date)} · total ${fC(r.total)} · due ${fC(r.outstanding || 0)}</div></button>`; };
  const detIdx = rcTxnParty(t);
  const partyOpts = ['<option value="-1">Select party…</option>'].concat(Q.partyRows().slice().sort((a, c) => (a.name || '').localeCompare(c.name || '')).map(p => `<option value="${p.idx}"${p.idx === detIdx ? ' selected' : ''}>${esc(p.name)}</option>`)).join('');
  b.innerHTML = `<div class="rc-modal"><div class="rc-modal-h"><div class="rc-modal-t">Link ${isCr ? 'credit' : 'debit'} ${fC(amt)} to a ${isCr ? 'sales invoice' : 'purchase bill'}</div><button class="rc-modal-x" id="rcLX">&times;</button></div>
    <div class="rc-modal-b"><div class="rc-splitrow"><div class="rc-mut" style="font-size:12px">${fDS(t.date)} · ${esc((t.desc || '').slice(0, 48))}</div><button class="rc-linkbtn" id="rcToSplit">${svg(IC.split)}<span>Split across bills</span></button></div>
      <input class="rc-search" id="rcPickQ" placeholder="Search ${isCr ? 'invoice / customer' : 'bill / supplier'}…" style="width:100%;margin:10px 0">
      <div class="rc-picklist" id="rcPickList">${list.slice(0, 40).map(row).join('') || '<div class="rc-none">No bills found.</div>'}</div>
      <div class="rc-onacct">
        <div class="rc-mut" style="font-size:12px;margin-bottom:7px">Or post it <b>on-account</b> to a party's running balance — not tied to one bill (partial / advance / lump-sum):</div>
        <div class="rc-onacct-row">
          <select class="rc-search" id="rcOaParty">${partyOpts}</select>
          <button class="ql-btn ql-btn-primary" id="rcOaPost">Post ${fC(amt)}</button>
        </div>
      </div></div></div>`;
  const close = () => b.remove();
  document.getElementById('rcLX').onclick = close;
  document.getElementById('rcToSplit').onclick = () => { close(); openSplit(tid); };
  document.getElementById('rcOaPost').onclick = () => {
    const pidx = +document.getElementById('rcOaParty').value;
    if (!(pidx >= 0)) { toast('Pick a party first', 'err'); return; }
    if (postOnAccount(t, pidx)) { runMatchAll(); close(); render(); }
  };
  const relist = q => { const f = q ? list.filter(x => { const r = x.r; return ((isCr ? r.inv + ' ' + r.party : r.bill + ' ' + r.sup) || '').toLowerCase().includes(q); }) : list; document.getElementById('rcPickList').innerHTML = f.slice(0, 40).map(row).join('') || '<div class="rc-none">No matches.</div>'; wirePicks(); };
  const wirePicks = () => b.querySelectorAll('[data-idx]').forEach(btn => btn.onclick = () => {
    const idx = +btn.dataset.idx, bill = (isCr ? Q.salesRows() : Q.purchaseRows()).find(r => r.idx === idx);
    const party = bill ? (isCr ? bill.party : bill.sup) : '';
    if (t.clean && party) learnAlias(t.clean, party);       // remember this mapping forever
    const paidPartial = bill && amt < (bill.outstanding != null ? bill.outstanding : bill.total) - 1;
    t.m = { kind: isCr ? 'sale' : 'purchase', idx, status: paidPartial ? 'partial' : 'manual', manual: true, confidence: 100, matchedBy: 'manual', reasons: ['Manually linked' + (party && t.clean ? ' — learned "' + t.clean + '" → ' + party : '')], at: new Date().toISOString() };
    runMatchAll();                                          // let the new alias re-match siblings
    close(); render(); toast(party ? 'Linked · learned "' + t.clean + '" → ' + party : 'Linked to bill', 'ok');
  });
  wirePicks();
  document.getElementById('rcPickQ').oninput = e => relist(e.target.value.toLowerCase());
}

/* ══════════════════ SPLIT ONE PAYMENT ACROSS MULTIPLE BILLS ══════════════════ */
function openSplit(tid) {
  const t = txns().find(x => x.id === tid); if (!t) return;
  const isCr = (t.credit || 0) > 0, kind = isCr ? 'sale' : 'purchase', amt = isCr ? t.credit : t.debit;
  const src = () => (isCr ? Q.salesRows() : Q.purchaseRows()).filter(r => r.status !== 'cancelled');
  // seed from any existing allocation so re-editing a split is non-destructive
  let picks = (allocsOf(t).filter(a => a.kind === kind && billOf(a)).map(a => ({ idx: a.idx, amount: a.amount })));
  const b = overlay();
  const refOf = r => isCr ? r.inv : r.bill, nmOf = r => isCr ? r.party : r.sup;
  const alloc = () => picks.reduce((s, p) => s + (+p.amount || 0), 0);
  const rem = () => Math.round((amt - alloc()) * 100) / 100;
  const paint = () => {
    const chosen = new Set(picks.map(p => p.idx));
    const rows = picks.map(p => { const r = src().find(x => x.idx === p.idx) || {}; return `<div class="rc-al" data-al="${p.idx}">
      <div class="rc-al-i"><b>${esc(refOf(r) || '—')}</b><span>${esc(nmOf(r) || '')} · due ${fC(r.outstanding || 0)}</span></div>
      <input class="rc-al-amt" type="number" inputmode="decimal" data-amt="${p.idx}" value="${p.amount}" min="0" step="1">
      <button class="rc-ib rc-al-x" data-del="${p.idx}" title="Remove">${svg(IC.trash)}</button></div>`; }).join('');
    const avail = src().filter(r => !chosen.has(r.idx)).map(r => ({ r, sc: Math.abs(rem() - (r.outstanding || r.total || 0)) })).sort((a, c) => a.sc - c.sc);
    const pick = avail.slice(0, 30).map(x => { const r = x.r; return `<button class="rc-pick" data-add="${r.idx}"><div><b>${esc(refOf(r) || '—')}</b> · ${esc(nmOf(r) || '')}</div><div class="rc-pick-m">${fDS(r.date)} · due ${fC(r.outstanding || 0)}</div></button>`; }).join('') || '<div class="rc-none">No more bills.</div>';
    const over = rem() < -0.5;
    b.querySelector('.rc-modal-b').innerHTML = `
      <div class="rc-split-sum">
        <div><span>Payment</span><b>${fC(amt)}</b></div>
        <div><span>Allocated</span><b>${fC(alloc())}</b></div>
        <div class="${over ? 'rc-bad' : rem() < 0.5 ? 'rc-ok' : ''}"><span>${over ? 'Over by' : 'Unallocated'}</span><b>${fC(Math.abs(rem()))}</b></div>
      </div>
      <div class="rc-al-list">${rows || '<div class="rc-none" style="padding:10px 0">Pick bills below to split this payment across them.</div>'}</div>
      <div class="rc-split-add-h">Add a ${isCr ? 'sales invoice' : 'purchase bill'}</div>
      <input class="rc-search" id="rcSplitQ" placeholder="Search ${isCr ? 'invoice / customer' : 'bill / supplier'}…" style="width:100%;margin-bottom:8px">
      <div class="rc-picklist" id="rcSplitList" style="max-height:32vh">${pick}</div>
      <div class="rc-split-foot"><button class="rc-btn" id="rcSplitCancel">Cancel</button><button class="rc-btn rc-btn-primary" id="rcSplitSave" ${picks.length && !over ? '' : 'disabled'}>${svg(IC.ck)}<span>Save split (${picks.length})</span></button></div>`;
    wire2();
  };
  const wire2 = () => {
    b.querySelectorAll('[data-add]').forEach(btn => btn.onclick = () => { const idx = +btn.dataset.add; const r = src().find(x => x.idx === idx); const suggest = RC.suggestAlloc(amt, alloc(), (r && r.outstanding) || (r && r.total) || 0); picks.push({ idx, amount: suggest }); paint(); });
    b.querySelectorAll('[data-del]').forEach(btn => btn.onclick = () => { picks = picks.filter(p => p.idx !== +btn.dataset.del); paint(); });
    b.querySelectorAll('[data-amt]').forEach(inp => inp.oninput = () => { const p = picks.find(x => x.idx === +inp.dataset.amt); if (p) { p.amount = +inp.value || 0; const sum = b.querySelector('.rc-split-sum'); const over = rem() < -0.5; if (sum) sum.children[1].querySelector('b').textContent = fC(alloc()); const c3 = sum && sum.children[2]; if (c3) { c3.className = over ? 'rc-bad' : rem() < 0.5 ? 'rc-ok' : ''; c3.querySelector('span').textContent = over ? 'Over by' : 'Unallocated'; c3.querySelector('b').textContent = fC(Math.abs(rem())); } const save = document.getElementById('rcSplitSave'); if (save) save.disabled = !(picks.length && !over); } });
    const sq = document.getElementById('rcSplitQ'); if (sq) sq.oninput = () => { const q = sq.value.toLowerCase(); const chosen = new Set(picks.map(p => p.idx)); const f = src().filter(r => !chosen.has(r.idx) && ((refOf(r) + ' ' + nmOf(r)) || '').toLowerCase().includes(q)); document.getElementById('rcSplitList').innerHTML = f.slice(0, 30).map(r => `<button class="rc-pick" data-add="${r.idx}"><div><b>${esc(refOf(r) || '—')}</b> · ${esc(nmOf(r) || '')}</div><div class="rc-pick-m">${fDS(r.date)} · due ${fC(r.outstanding || 0)}</div></button>`).join('') || '<div class="rc-none">No matches.</div>'; wire2(); };
    const cx = document.getElementById('rcSplitCancel'); if (cx) cx.onclick = () => b.remove();
    const sv = document.getElementById('rcSplitSave'); if (sv) sv.onclick = save;
  };
  const save = () => {
    picks = picks.filter(p => (+p.amount || 0) > 0);
    if (!picks.length) { b.remove(); return; }
    const allocs = picks.map(p => ({ kind, idx: p.idx, amount: Math.round((+p.amount) * 100) / 100 }));
    const ss = RC.splitStatus(amt, allocs);
    if (!ss.valid) { toast('Allocation exceeds the payment amount', 'warn'); return; }
    const status = ss.status === 'matched' ? 'matched' : 'partial';
    t.m = { kind, allocs, status, manual: true, confidence: 100, matchedBy: 'manual', reasons: ['Split across ' + allocs.length + ' bills (' + fC(ss.total) + ' of ' + fC(amt) + ')'], at: new Date().toISOString() };
    Q.saveRecon(); b.remove(); render(); toast('Split across ' + allocs.length + ' bills', 'ok');
  };
  b.innerHTML = `<div class="rc-modal rc-modal-lg"><div class="rc-modal-h"><div class="rc-modal-t">Split ${isCr ? 'credit' : 'debit'} ${fC(amt)} across bills</div><button class="rc-modal-x" id="rcSX">&times;</button></div><div class="rc-modal-b"></div></div>`;
  document.getElementById('rcSX').onclick = () => b.remove();
  paint();
}

/* Party context inside the drawer: running balance + the last few ledger
   entries + open invoices — so the accountant decides without leaving. */
function partyContextHTML(t) {
  try {
    const m = t.m || {};
    const pidx = m.kind === 'ledger' ? m.partyIdx : rcTxnParty(t);
    if (!(pidx >= 0) || !Q.partyLedger) return '';
    const led = Q.partyLedger(pidx); if (!led) return '';
    const recent = led.rows.slice(-3).reverse();
    const openInv = led.rows.filter(e => e.kind === 'sale' || e.kind === 'bill').length;
    const balCol = led.closing > 0 ? 'var(--ql-danger-600)' : led.closing < 0 ? '#16a34a' : 'inherit';
    return `<div class="rc-dp-sec">Party · ${esc(led.party.name || '')}</div>
      <div class="rc-dp-kv"><span>Running balance</span><b style="color:${balCol}">${fC(Math.abs(led.closing))} ${led.closing > 0 ? 'due from party' : led.closing < 0 ? 'advance held' : 'settled'}</b></div>
      ${recent.map(e => `<div class="rc-dp-kv rc-dp-led"><span>${fDS(e.date)} · ${esc((e.desc || '').slice(0, 26))}</span><b>${e.dr ? fC(e.dr) + ' Dr' : fC(e.cr) + ' Cr'}</b></div>`).join('')}
      <div class="rc-dp-kv"><span>Ledger entries</span><b><a href="./ledger.html?party=${pidx}" style="color:var(--ql-brand-600)">${led.rows.length} · open full statement →</a></b></div>`;
  } catch (_) { return ''; }
}
/* ══════════════════ TRANSACTION DETAIL DRAWER ══════════════════ */
function openDetail(tid) {
  const t = txns().find(x => x.id === tid); if (!t) return;
  const m = t.m || {}, b = billFor(t), tier = m.tier || (isLinked(t) ? 'green' : 'red'), tc = tierColor(tier);
  const kv = (l, v) => v ? `<div class="rc-dp-kv"><span>${esc(l)}</span><b>${v}</b></div>` : '';
  const reasons = (m.reasons || []).map(r => `<li>${esc(r)}</li>`).join('') || '<li>No matching signals found.</li>';
  let back = document.getElementById('rcDp'); if (!back) { back = document.createElement('div'); back.id = 'rcDp'; document.body.appendChild(back); }
  back.className = 'rc-dp-back open'; back.onclick = e => { if (e.target === back) back.classList.remove('open'); };
  back.innerHTML = `<aside class="rc-dp">
    <div class="rc-dp-h"><div><div class="rc-dp-ey">Bank transaction · ${fDS(t.date)}</div><div class="rc-dp-amt ${t.credit ? 'rc-cr' : 'rc-dr'}">${t.credit ? '+' : '−'}${fC(t.credit || t.debit)}</div></div><button class="rc-dp-x" id="rcDpX">${svg(IC.x)}</button></div>
    <div class="rc-dp-b">
      <div class="rc-conf" style="background:${tc[0]};color:${tc[1]}"><span class="rc-conf-n">${m.confidence != null ? m.confidence + '%' : '—'}</span><span>${(STAT[m.status] || STAT.unmatched)[0]} · ${tier === 'green' ? 'auto-matched' : tier === 'yellow' ? 'needs review' : 'low confidence'}</span></div>
      <div class="rc-dp-sec">Narration</div>
      <div class="rc-dp-narr"><div class="rc-dp-nl">Clean (matched on)</div><div class="rc-dp-nc">${esc(t.clean || '—')}</div><div class="rc-dp-nl" style="margin-top:9px">Raw (verbatim from statement)</div><div class="rc-dp-nr">${esc(t.raw || t.desc || '—')}</div></div>
      <div class="rc-dp-sec">Statement fields</div>
      ${kv('Bank', t.bank)}${kv('Mode', t.mode)}${kv('UTR / Ref', t.utr)}${kv('Cheque no.', t.cheque)}${kv('Running balance', t.balance ? fC(t.balance) : '')}${kv('Firm', esc(Q.co.short || ''))}
      <div class="rc-dp-sec">Match${isSplit(t) ? ' · split across ' + billsFor(t).length + ' bills' : ''}</div>
      ${isSplit(t)
        ? billsFor(t).map(x => `<div class="rc-dp-kv"><span>${esc((x.kind === 'sale' ? x.bill.inv : x.bill.bill) || '—')} · ${esc((x.kind === 'sale' ? x.bill.party : x.bill.sup) || '')}</span><b>${fC(x.amount)}</b></div>`).join('') + kv('Total allocated', fC(billsFor(t).reduce((a, x) => a + x.amount, 0)))
        : (m.kind === 'ledger' ? (kv('Posted on-account', esc(m.party || '') + ' · running a/c') + kv('Amount', fC(t.credit || t.debit || 0))) : (b ? (kv(m.kind === 'sale' ? 'Sales invoice' : 'Purchase bill', esc((m.kind === 'sale' ? b.inv : b.bill) || '—') + ' · ' + esc((m.kind === 'sale' ? b.party : b.sup) || '')) + kv('Bill total', fC(b.total)) + kv('Outstanding', fC(b.outstanding || 0))) : (m.cat ? kv('Category', esc(m.cat)) : '<div class="rc-mut" style="font-size:12.5px">Not linked to any bill yet.</div>')))}
      <div class="rc-dp-sec">Why the AI decided this</div>
      <ul class="rc-dp-why">${reasons}</ul>
      ${partyContextHTML(t)}
      <div class="rc-dp-sec">Audit trail</div>
      ${kv('Matched by', m.matchedBy === 'manual' ? 'Manual (you)' : m.matchedBy === 'rule' ? 'Rule engine' : 'AI engine')}${kv('When', m.at ? new Date(m.at).toLocaleString('en-IN') : '')}
      <div class="rc-dp-acts">
        ${(m.status === 'review' && b) ? `<button class="rc-btn rc-btn-primary" id="rcDpConfirm">${svg(IC.ck)}<span>Confirm match</span></button>` : ''}
        <button class="rc-btn" id="rcDpLink">${svg(IC.link)}<span>Link / change</span></button>
        <button class="rc-btn" id="rcDpSplit">${svg(IC.split)}<span>${isSplit(t) ? 'Edit split' : 'Split across bills'}</span></button>
        ${(!isLinked(t) && rcTxnParty(t) >= 0) ? `<button class="rc-btn" id="rcDpAdvance">${svg(IC.wallet)}<span>Mark as advance</span></button>` : ''}
        <button class="rc-btn" id="rcDpMark">${svg(IC.tag)}<span>Categorize</span></button>
        ${isLinked(t) ? `<button class="rc-btn" id="rcDpUnlink">${svg(IC.x)}<span>Unlink</span></button>` : ''}
      </div>
    </div></aside>`;
  const $ = id => document.getElementById(id);
  $('rcDpX').onclick = () => back.classList.remove('open');
  if ($('rcDpConfirm')) $('rcDpConfirm').onclick = () => { const party = m.kind === 'sale' ? b.party : b.sup; if (t.clean && party) learnAlias(t.clean, party); const paidPartial = t.credit && t.credit < (b.outstanding != null ? b.outstanding : b.total) - 1; t.m = Object.assign({}, m, { status: paidPartial ? 'partial' : 'matched', manual: true, matchedBy: 'manual', confidence: 100, at: new Date().toISOString() }); runMatchAll(); back.classList.remove('open'); render(); toast('Confirmed · alias learned', 'ok'); };
  if ($('rcDpLink')) $('rcDpLink').onclick = () => { back.classList.remove('open'); openLink(tid); };
  if ($('rcDpAdvance')) $('rcDpAdvance').onclick = () => { const pidx = rcTxnParty(t); if (pidx >= 0 && postOnAccount(t, pidx, (t.credit ? 'Advance received' : 'Advance paid'))) { runMatchAll(); back.classList.remove('open'); render(); } };
  if ($('rcDpSplit')) $('rcDpSplit').onclick = () => { back.classList.remove('open'); openSplit(tid); };
  if ($('rcDpMark')) $('rcDpMark').onclick = e => openMark(tid, e.currentTarget);
  if ($('rcDpUnlink')) $('rcDpUnlink').onclick = () => { if (m.kind === 'ledger' && m.ledgerEntryId && Q.reverseLedgerEntry) { Q.reverseLedgerEntry(m.partyIdx, m.ledgerEntryId); toast('Reversed on-account entry', 'ok'); } t.m = { kind: (t.credit || 0) > 0 ? 'sale' : 'purchase', idx: null, status: 'unmatched', confidence: 0, tier: 'red', matchedBy: 'manual', reasons: ['Unlinked by user'], at: new Date().toISOString() }; Q.saveRecon(); back.classList.remove('open'); render(); };
}

/* ══════════════════ EXPORT ══════════════════ */
function exportRecon() {
  const rows = filteredTxns();
  QLShell.exportCSV('reconciliation_' + (Q.co.short || 'bank').replace(/\s+/g, '_') + (ST.month !== 'all' ? '_' + ST.month : ''),
    ['Date', 'Description', 'Ref/UTR', 'Debit', 'Credit', 'Balance', 'Matched Bill', 'Party', 'Allocated', 'Status'],
    rows.flatMap(t => {
      if (isSplit(t)) return billsFor(t).map(x => [t.date, t.desc, t.utr || t.ref, t.debit ? x.amount : '', t.credit ? x.amount : '', '', x.kind === 'sale' ? x.bill.inv : x.bill.bill, x.kind === 'sale' ? x.bill.party : x.bill.sup, x.amount, 'Split']);
      const bl = billFor(t);
      return [[t.date, t.desc, t.utr || t.ref, t.debit || '', t.credit || '', t.balance || '', bl ? (t.m.kind === 'sale' ? bl.inv : bl.bill) : (t.m && t.m.cat || ''), bl ? (t.m.kind === 'sale' ? bl.party : bl.sup) : '', bl ? (t.credit || t.debit || '') : '', (t.m && STAT[t.m.status]) ? STAT[t.m.status][0] : 'Unmatched']];
    }));
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
  if ($('rcMatch')) $('rcMatch').onclick = () => {
    runMatchAll(false);                       // false = never clobber manual work
    render();
    const d = categoryDigest();
    toast('AI reconciled: ' + d.understood + ' of ' + d.total + ' understood · ' + (d.exceptions ? d.exceptions + ' exception' + (d.exceptions === 1 ? '' : 's') + ' need you' : 'nothing needs review ✓'), d.exceptions ? '' : 'ok');
  };
  if ($('rcExport')) $('rcExport').onclick = exportRecon;
  if ($('rcLedgerExp')) $('rcLedgerExp').onclick = exportLedger;
  root.querySelectorAll('[data-ledger]').forEach(row => row.onclick = () => {
    const nm = row.dataset.ledger, ps = Q.partyRows(); const norm = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const p = ps.find(x => norm(x.name) === norm(nm)); if (p) location.href = './ledger.html?party=' + p.idx;
  });
  if ($('rcAiReview')) $('rcAiReview').onclick = () => { ST.fstatus = 'review'; render(); };
  root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { ST.view = b.dataset.view; render(); });
  root.querySelectorAll('[data-ftype]').forEach(b => b.onclick = () => { ST.ftype = b.dataset.ftype; render(); });
  root.querySelectorAll('[data-fstatus]').forEach(b => b.onclick = () => { ST.fstatus = b.dataset.fstatus; render(); });
  if ($('rcSearch')) { const s = $('rcSearch'); s.oninput = () => { ST.q = s.value; const p = document.querySelector('.rc-panel'); if (p) { p.innerHTML = viewHTML(); wire(); s2focus(); } }; }
  root.querySelectorAll('[data-link]').forEach(b => b.onclick = () => openLink(b.dataset.link));
  root.querySelectorAll('[data-unlink]').forEach(b => b.onclick = () => { const t = txns().find(x => x.id === b.dataset.unlink); if (t) { t.m = { kind: (t.credit || 0) > 0 ? 'sale' : 'purchase', idx: null, status: 'unmatched' }; Q.saveRecon(); render(); } });
  root.querySelectorAll('[data-mark]').forEach(b => b.onclick = e => openMark(b.dataset.mark, e.currentTarget));
  root.querySelectorAll('.rc-review').forEach(b => b.onclick = e => { e.stopPropagation(); openDetail(b.dataset.open); });
  root.querySelectorAll('[data-more]').forEach(b => b.onclick = e => { e.stopPropagation(); openKebab(b.dataset.more, e.currentTarget); });
  root.querySelectorAll('.rc-clk[data-open]').forEach(tr => tr.addEventListener('click', e => { if (e.target.closest('button,a,input,select')) return; openDetail(tr.dataset.open); }));
  // selection + bulk bar
  root.querySelectorAll('[data-sel]').forEach(b => b.onclick = e => { e.stopPropagation(); const id = b.dataset.sel; ST.sel.has(id) ? ST.sel.delete(id) : ST.sel.add(id); render(); });
  root.querySelectorAll('[data-bulk]').forEach(b => b.onclick = () => bulkAction(b.dataset.bulk));
  // financial-overview accordion — persist open/closed across re-renders
  const fo = root.querySelector('.rc-fo'); if (fo) fo.addEventListener('toggle', () => { ST.foOpen = fo.open; });
}
function s2focus() { const s = document.getElementById('rcSearch'); if (s) { s.focus(); const v = s.value; s.value = ''; s.value = v; } }

/* ── Copilot: reconciliation Q&A (registered into the shared assistant) ── */
if (QLShell.registerAssistIntent) QLShell.registerAssistIntent((q, t) => {
  const tt = monthTxns();
  const money = t2 => fC(t2.credit || t2.debit || 0);
  const line = (t2, why) => `<li><b>${money(t2)}</b> · ${fDS(t2.date)} · ${esc((t2.clean || t2.desc || '').slice(0, 34))}${why ? ' — ' + esc(why) : ''}</li>`;
  if (/duplicate|paid twice|double payment/.test(t)) {
    const d = tt.filter(x => x.m && x.m.status === 'duplicate');
    return d.length ? `<p><b>${d.length} possible duplicate${d.length === 1 ? '' : 's'}</b> this month:</p><ul>${d.slice(0, 6).map(x => line(x)).join('')}</ul><p>Open each row's Review to confirm or unmark.</p>` : `<p>No duplicate payments detected in ${esc(monthLabel())}. ✓</p>`;
  }
  if (/\badvance/.test(t) && /show|list|which|all|any/.test(t)) {
    const a = tt.filter(x => x.m && (x.m.kind === 'ledger' || x.m.status === 'overpayment' || /advance/i.test(x.m.cat || '')));
    return a.length ? `<p><b>${a.length} advance / on-account entr${a.length === 1 ? 'y' : 'ies'}</b>:</p><ul>${a.slice(0, 6).map(x => line(x, x.m.party || x.m.cat)).join('')}</ul>` : `<p>No advances recorded from the bank statement this month.</p>`;
  }
  if (/unknown part|not recognised|not recognized|unidentified/.test(t)) {
    const u = tt.filter(x => x.m && x.m.status === 'unknown');
    return u.length ? `<p><b>${u.length} unidentified transaction${u.length === 1 ? '' : 's'}</b> — teach me who they are via Review → Identify:</p><ul>${u.slice(0, 6).map(x => line(x)).join('')}</ul>` : `<p>Every transaction has a recognized party. ✓</p>`;
  }
  if (/why.*(unmatch|not match|no match)|unmatched|exception/.test(t)) {
    const u = tt.filter(needsReview);
    if (!u.length) return `<p>Nothing needs review in ${esc(monthLabel())} — all matched or categorized. ✓</p>`;
    const top = u[0], why = (top.m && top.m.reasons || []).join('; ') || 'no matching signals';
    return `<p><b>${u.length} transaction${u.length === 1 ? '' : 's'} need${u.length === 1 ? 's' : ''} review.</b> Top one: ${money(top)} on ${fDS(top.date)} — ${esc(why)}.</p><p>Common causes: the invoice isn't uploaded yet, the party name differs from your books (use Identify once — it learns), or it's an advance.</p>`;
  }
  if (/bank charge|charges|fees/.test(t) && /how much|total|show|list/.test(t)) {
    const c = tt.filter(x => x.m && x.m.status === 'other' && /charge|interest/i.test(x.m.cat || ''));
    const sum = c.reduce((a, x) => a + (x.debit || 0), 0);
    return `<p>Bank charges + interest in ${esc(monthLabel())}: <b>${fC(sum)}</b> across ${c.length} entr${c.length === 1 ? 'y' : 'ies'}.</p>`;
  }
  if (/self transfer|internal transfer|inter.?firm/.test(t)) {
    const s = tt.filter(x => x.m && x.m.status === 'other' && /self|inter-firm/i.test(x.m.cat || ''));
    return s.length ? `<p><b>${s.length} internal transfer${s.length === 1 ? '' : 's'}</b> (own accounts / sister firm):</p><ul>${s.slice(0, 6).map(x => line(x, x.m.cat)).join('')}</ul>` : `<p>No internal transfers detected this month.</p>`;
  }
  return null;   // fall through to the shell's built-in intents
});

/* ══════════════════ COPILOT — reconciliation Q&A ══════════════════
   Registered so "why wasn't this matched / show duplicates / which suppliers
   were paid twice / show all advances / all Indian Oil payments" answer from
   LIVE recon state. Runs before the shell's generic intents (first match wins). */
if (QLShell.registerAssistIntent) QLShell.registerAssistIntent((q, t, H) => {
  if (!/reconcil|transaction|bank statement|unmatch|duplicate|paid twice|advance|exception|matched|\bdebit\b|\bcredit\b|\butr\b|inter.?firm|self transfer/.test(t) && !/why.*(match|link)/.test(t)) return '';
  const tt = txns().filter(x => inMonth(x.date));
  if (!tt.length) return `<p>No bank transactions loaded for ${esc(monthLabel())}. Open <b>Bank Reconciliation</b> and upload a statement.</p>`;
  const fc = H.fc, row = (t2) => `${fDS(t2.date)} · ${esc(titleCase(t2.clean) || (t2.desc || '').slice(0, 24))} · <b>${t2.credit ? '+' : '−'}${fc(t2.credit || t2.debit)}</b>`;
  const listOf = arr => arr.length ? '<ul class="ql-ai-list">' + arr.slice(0, 12).map(x => `<li>${row(x)}</li>`).join('') + (arr.length > 12 ? `<li>…and ${arr.length - 12} more</li>` : '') + '</ul>' : '<p>None. ✓</p>';
  // duplicates / paid twice
  if (/duplicate|paid twice|twice|double/.test(t)) { const d = tt.filter(x => statusKey(x) === 'duplicate'); return `<p><b>${d.length}</b> duplicate transaction${d.length === 1 ? '' : 's'} this month:</p>${listOf(d)}`; }
  // advances
  if (/advance/.test(t)) { const a = tt.filter(x => x.m && x.m.kind === 'ledger'); return `<p><b>${a.length}</b> on-account / advance posting${a.length === 1 ? '' : 's'}:</p>${listOf(a)}`; }
  // exceptions / needs review / why unmatched
  if (/exception|unmatch|why.*(match|link)|need.*review|unknown/.test(t)) {
    const ex = tt.filter(needsReview);
    const d = categoryDigest();
    return `<p>The AI understood <b>${d.understood} of ${d.total}</b> transactions. <b>${ex.length}</b> need${ex.length === 1 ? 's' : ''} your review:</p>${listOf(ex)}<div class="ql-ai-acts"><button onclick="location.href='./reconcile.html'">Open reconciliation</button></div>`;
  }
  // a named party's bank transactions ("all Indian Oil payments")
  const pm = q.match(/(?:all|show|list)\s+([a-z][a-z &.]{2,32})\s+(?:payment|transaction|entr|receipt)/i);
  if (pm) { const nmq = RC.normName(pm[1]); const hits = tt.filter(x => RC.normName(x.clean || '').indexOf(nmq) >= 0 || (billFor(x) && RC.normName((billFor(x).party || billFor(x).sup || '')).indexOf(nmq) >= 0)); return `<p><b>${hits.length}</b> bank transaction${hits.length === 1 ? '' : 's'} for “${esc(pm[1].trim())}”:</p>${listOf(hits)}`; }
  // default recon digest
  const d = categoryDigest();
  return `<p><b>${monthLabel()} · ${esc(Q.co.short || '')}</b></p><p>${d.understood} of ${d.total} understood — ${d.receipts} receipts, ${d.payments} supplier payments, ${d.charges} charges, ${d.loan} loan/EMI, ${d.internal} internal, ${d.dup} duplicate. <b>${d.exceptions}</b> exception${d.exceptions === 1 ? '' : 's'} to review.</p><div class="ql-ai-acts"><button onclick="location.href='./reconcile.html'">Open reconciliation</button></div>`;
});

window.__qlRefresh = render;
window.__qlOnSwitchCompany = id => { ST.monthInit = false; Q.switchCompany(id, render); };
if (Q.init) Q.init(render); else render();

/* build rd7: ask for the password on a locked bank statement instead of showing pdf.js raw error */
