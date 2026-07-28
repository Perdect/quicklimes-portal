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
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
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

let ST = {
  view: 'recon', month: 'all', monthInit: false, ftype: 'all', fstatus: 'all', q: '', sel: new Set(), foOpen: false, acc: '',
  /* Date range, on the TABLE not the page header. The header's month picker
     could only ever say "one month"; reconciling a quarter, a financial year
     or "since the last statement" needed a range that lives beside the rows
     being filtered. Empty string = open-ended on that side. */
  dFrom: '', dTo: '', dOpen: false,
  /* EXCEPTION-FIRST. An accountant should not read 74 rows to find the 27 that
     need them. On by default; the toggle restores plain date order for anyone
     reconciling a statement line by line. */
  exFirst: true,
  /* The status dropdown ("too many options" — the six tabs became one select).
     View state only, like advOpen: closed on every pick and on click-away. */
  stOpen: false,
  /* The party ledger's own view state. `lq` is separate from `q`: the recon search
     matches narrations and refs, the ledger searches party names, and sharing one
     box would carry a half-typed narration search into the ledger and show nothing. */
  lq: '', lfilter: 'all', lsort: 'amount',
  /* Advanced filters, the same shape QLX uses for its Filters panel (S.adv) so
     the two behave identically even though this page is not a QLX mount.
     'all' means the filter is off — never '' , so an empty <select> value can
     never be mistaken for "show nothing". */
  adv: { party: 'all', cat: 'all', conf: 'all', from: '', to: '', min: '', max: '' },
  advOpen: false,
  /* Which month groups are folded shut. A Set of 'YYYY-MM', same as QLX's
     S.collapsed — collapsing is a VIEW preference, never saved to the blob. */
  collapsed: new Set(),
  /* Inline-expanded rows (click a row → details unfold under it; Review still
     opens the full drawer). View state only. */
  expanded: new Set(),
  /* Render cap: with 1,000+ lines the DOM is the bottleneck, not the data.
     Render the first N and offer "Show more" — honest, and never laggy. */
  cap: 300
};
/* How many filters are actually narrowing the list — drives the button's badge.
   Counted from the SAME object the predicate reads, so the badge can never claim
   a filter that is not being applied. */
function advCount() {
  const a = ST.adv;
  return ['party', 'cat', 'conf'].filter(k => a[k] && a[k] !== 'all').length
    + (a.from ? 1 : 0) + (a.to ? 1 : 0) + (a.min !== '' ? 1 : 0) + (a.max !== '' ? 1 : 0)
    /* Direction moved INTO the Filters panel (the toolbar had "too many
       options"), so a narrowed direction must light the button and be cleared
       by Clear like any other filter — a hidden filter that quietly halves the
       list is how "where did my rows go" tickets start. */
    + (ST.ftype !== 'all' ? 1 : 0);
}
function advReset() { ST.adv = { party: 'all', cat: 'all', conf: 'all', from: '', to: '', min: '', max: '' }; ST.ftype = 'all'; }

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
function monthLabel() { return (!ST.month || ST.month === 'all') ? 'All months' : Q.monthLabel(ST.month, { blank: ST.month }); }

/* ── matching engine (ReconCore) ─────────────────────────────────────── */
function npOf(t) { return { raw: t.raw || t.desc || '', clean: t.clean || '', utr: t.utr || '', cheque: t.cheque || '', mode: t.mode || '' }; }
// Names of the user's OWN firms (all plants) — for inter-firm transfer detection.
function ownNames() {
  const n = [].concat(Q.ownFirmNames || []);
  try { if (Q.co) { if (Q.co.name) n.push(Q.co.name); if (Q.co.short) n.push(Q.co.short); } Object.values(Q.COMPANIES || {}).forEach(c => { if (c.name) n.push(c.name); if (c.short) n.push(c.short); }); } catch (_) {}
  return [...new Set(n)];
}
/* Money the firm has ALREADY recorded, shaped for the matcher.

   The cashbook is the single ledger every payment posts to — a freight payment,
   a labour payout, a royalty, an EMI. None of them are supplier bills, which is
   why a bank debit could never match them before. `dir` translates the
   cashbook's credit/debit into the matcher's in/out, and `linked` marks entries
   already tied to another statement line so one payment cannot reconcile twice.

   Entries CREATED BY reconciliation itself are excluded: posting a payment from
   a bank line writes a cashbook row, and offering that row back as a candidate
   for the same line would let a re-run "discover" the record it just made. */
function entriesFor(t) {
  const linkedIds = new Set();
  txns().forEach(x => { if (x.id !== t.id && x.m && x.m.entryId) linkedIds.add(x.m.entryId); });
  let rows = [];
  try { rows = Q.cashbookRows() || []; } catch (_) { return []; }
  return rows.filter(r => r.id && !(r.reconTxnId && r.reconTxnId === t.id)).map(r => ({
    id: r.id, date: r.date, amount: +r.amount || 0, party: r.party || '',
    method: r.method || '', mode: r.mode || '', ref: r.ref || '',
    kind: r.ptype || r.category || 'payment', accountId: r.accountId || '',
    dir: r.type === 'credit' ? 'in' : 'out',
    linked: linkedIds.has(r.id)
  }));
}
/* The parties the firm pays every month, learned from its OWN cashbook.
   Cached: autoMatch runs per transaction and a statement is hundreds of lines,
   so recomputing this for each one would walk the whole cashbook every time.
   Invalidated by runMatchAll, which is the only thing that re-matches in bulk. */
let RECUR = null;
function recurring() {
  if (RECUR) return RECUR;
  try { RECUR = RC.recurringPayees ? RC.recurringPayees(entriesFor({ id: '' })) : []; }
  catch (_) { RECUR = []; }
  return RECUR;
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
  const opts = { aliasParty: aliasOf(np.clean), accountId: t.accountId || '' };
  /* A bank line is one of two things, and confusing them costs real money:
       it PAYS a bill      -> the money is not recorded yet; matching POSTS it
       it IS an entry      -> already in the cashbook; matching may only LINK
     Only bills used to be offered here, so a debit could only ever match a
     PURCHASE BILL. Freight, labour, royalty and EMI payments — recorded in the
     cashbook, never on a supplier bill — could not match anything: ₹55,233 to
     "Nagour Golden Transport" had no candidate to match against, while the name
     sat right there on the cashbook entry. resolve() considers both and returns
     the action, so an existing record is linked, never paid a second time. */
  const res = RC.resolve
    ? RC.resolve(np, t, { bills: bills, entries: entriesFor(t), opts: opts })
    : RC.bestMatch(np, t, bills, opts);
  // An already-recorded payment is the most reliable read there is — the money
  // is in the books with a name on it. It outranks the narration rules, which
  // only guess from bank text.
  if (res && res.kind === 'entry' && res.confidence >= 80) return Object.assign(res, { at: new Date().toISOString(), matchedBy: res.matchedBy || 'entry' });
  // A CONFIDENT invoice match (real party + amount) overrides ANY hard rule —
  // so "EMI Transport" (customer) / "Shriram Transport" (freight supplier) book
  // to their bill, never swallowed as a loan/fee. Otherwise the hard rule wins.
  // action 'ask' is EXCLUDED: it carries a bill idx and a high bill confidence,
  // but it exists precisely because an existing record might be this money —
  // auto-matching it here would post the payment the ask is meant to prevent.
  const strongMatch = res && res.idx != null && res.confidence >= 80 && res.action !== 'ask';
  if (strongMatch) return Object.assign(res, { at: new Date().toISOString(), matchedBy: res.matchedBy || 'ai' });
  // A less-certain entry match still beats a narration guess, and must not be
  // swallowed by a hard rule on its way out — it is a real record with a name.
  if (res && (res.kind === 'entry' || res.action === 'ask')) return Object.assign(res, { at: new Date().toISOString(), matchedBy: res.matchedBy || 'entry' });
  if (hardM) return hardM;
  // 3) residual: an UNMATCHED transfer whose narration IS one of our own firms
  //    is a likely inter-firm transfer — surfaced for REVIEW (never auto-hidden)
  //    so a real third-party receipt sharing our root token still reaches you.
  if ((res.status === 'unknown' || res.status === 'unmatched') && res.idx == null && RC.classifyResidual) {
    const resid = RC.classifyResidual(np, t, { ownNames: ownNames() });
    if (resid) return { kind: (t.credit || 0) > 0 ? 'sale' : 'purchase', idx: null, status: 'review', cat: resid.cat, catKey: resid.key, suggestInterfirm: true, confidence: resid.confidence, tier: 'yellow', matchedBy: 'ai', reasons: resid.reasons, at: new Date().toISOString() };
  }
  /* 3b) THE PARTY WE PAY EVERY MONTH.
     Nothing was recorded and no bill matches — but the firm has paid this name
     in each of the last several months. That history is evidence: the line is a
     known standing payment, not an unknown blob. It is only ever a REVIEW
     suggestion — a habit is a reason to recognize the name, never a reason to
     post money on its own. */
  // Debits only: the history is of money we PAY OUT, so it can say "we pay this
  // name every month". It says nothing about a receipt, and a credit from a name
  // we routinely pay is unusual enough that guessing at it would be worse than
  // leaving it for the user.
  if ((t.debit || 0) > 0 && (res.status === 'unknown' || res.status === 'unmatched') && res.idx == null && RC.knownPayee) {
    const kp = RC.knownPayee(np, t, recurring());
    if (kp) return { kind: 'purchase', idx: null, status: 'review',
      cat: 'Recurring payment', catKey: 'recurring',
      party: kp.party, recurring: true, amountUsual: kp.amountUsual,
      // A familiar payee at the usual amount is a decent guess; an unfamiliar
      // amount is exactly the case a human should look at, so it scores lower.
      confidence: kp.amountUsual ? 60 : 40, tier: 'yellow', matchedBy: 'history',
      needsLink: true, reasons: [kp.why], at: new Date().toISOString() };
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
  RECUR = null;                       // the cashbook may have changed since last run
  const arr = txns();
  /* THE STAMP SURVIVES RE-MATCHING.
     m.posted records that this bank line has ALREADY had its payment written to
     the books — it is a fact about money, not a matching opinion, and re-reading
     the statement cannot make it untrue. `force` (the AI Reconcile button)
     deliberately clobbers even manual work, so without carrying m.posted across
     it a re-match would erase the stamp and "Update Payments" would happily pay
     every one of those bills a second time.

     There is a second reason this must be sticky, specific to this app: posting
     CREATES a cashbook entry, so on the next run entriesFor() sees it and the
     very line we posted now matches its own new entry as kind:'entry'. The
     match object is legitimately rewritten — the stamp underneath it must not
     be. */
  arr.forEach(t => {
    const posted = t.m && t.m.posted;
    if (!t.m || !t.m.manual || force) t.m = autoMatch(t);
    if (posted) { t.m.posted = posted; t.m.manual = true; }
  });
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
  // Tag every self-transfer leg (paired A→B moves AND single EBANK:SELF legs)
  // as an internal transfer — the marker downstream code and the mirror use to
  // keep own-account moves out of income, expense and P&L.
  arr.forEach(t => { if (t.m && (t.m.catKey === 'self' || /self\s*transfer/i.test(t.m.cat || ''))) t.m.tag = 'internal_transfer'; });

  // duplicate detection — UTR first, else amount + clean-name + date.
  // ACCOUNT-SCOPED: the same line in two DIFFERENT own accounts is two real
  // transactions. But legacy rows (imported before multi-bank, no accountId)
  // must stay conservative: they match ANY account until Phase-6 backfill
  // assigns them one — otherwise a re-import into a named account would slip
  // past the old account-less copy and double-count.
  const seenKey = {}, seenLegacyBase = {}, seenAnyBase = {}, seenBill = {};
  arr.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(t => {
    // manual rows keep their status but still REGISTER their key, so a
    // re-imported copy of a manually-confirmed line is caught as a duplicate
    const key = RC.dedupeKey(npOf(t), t);                 // scoped when t.accountId is set
    const base = RC.dedupeKeyBase(npOf(t), t);            // account-blind signature
    const isDup = seenKey[key]                            // same account (or both legacy)
      || (t.accountId ? seenLegacyBase[base]              // scoped row vs a legacy copy
                      : seenAnyBase[base]);               // legacy row vs anything
    if (isDup) { if (!(t.m && t.m.manual)) { t.m.status = 'duplicate'; t.m.reasons = ['Duplicate of an earlier transaction']; } }
    seenKey[key] = 1; seenAnyBase[base] = 1; if (!t.accountId) seenLegacyBase[base] = 1;
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
  /* ── who does this statement BELONG to? ───────────────────────────────
     Every bank prints "Account No : … / IFSC : …" above the transaction table.
     Reading it is what lets the import modal pre-fill and auto-select instead
     of asking the user cold (the "Which account is this statement from?" with
     nothing in it).

     WHERE THE TEXT COMES FROM — this is the subtle bit. pdfBankTable() walks
     the pages and SKIPS every line until it finds the column header row
     (`if (!cols) { …; continue; }` in finance.js), so its output starts at the
     table: the account-number block above it is already gone by the time we get
     `rows`. It is not recoverable from `rows` — so for PDFs we re-read page 1's
     text with QLFin.pdfPages, which keeps the whole page. CSV/Excel need no such
     trip: fileToRows returns the pre-header lines, and bankHeaderRow() already
     told us where the table starts, so everything above `hi` IS the header.
     Best-effort throughout: a header we cannot read costs a pre-fill, never an
     import — so this is wrapped and falls back to today's table-only detect.
     KNOWN COST: pdfPages has no page limit, so it re-extracts the whole document
     to read page 1 — roughly a second on a long statement, on top of the read the
     user is already waiting through. Reusing the tested exported reader beats
     copying pdf.js line-grouping into this file; the real fix is a page-count
     argument on pdfPages (finance.js), which is a change for that file's owner. */
  let hdr = { bank: '', acctNo: '', ifsc: '' };
  try {
    let headText = rows.slice(0, hi).map(r => (r || []).join(' ')).join('\n');
    if (isPdf && parsed.kind === 'pdf' && QLFin.pdfPages) {
      try { const pgs = await QLFin.pdfPages(file, password); if (pgs && pgs[0]) headText = pgs[0] + '\n' + headText; } catch (_) {}
    }
    if (RC.parseStatementHeader) hdr = RC.parseStatementHeader(headText) || hdr;
  } catch (_) {}
  // The bank name keeps its old source as a fallback: the header block may be an
  // image (scanned statement) while the table still says "BANK OF BARODA".
  const bank = hdr.bank || RC.detectBank(rows.slice(0, 25).map(r => (r || []).join(' ')).join(' '));
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
  /* The header rides on the ARRAY, not on the transactions: askAccount needs it,
     but every txn in `out` gets pushed into the stored books, and stamping the
     firm's account number onto ten thousand transaction records would bloat the
     blob to say once what the account already says. */
  out._hdr = hdr;
  return out;
}

/* ── analytics ───────────────────────────────────────────────────────── */
/* Account scoping (multi-bank Phase 3): ST.acc = '' → all accounts,
   '__none' → legacy/unassigned rows, else a BANK_ACCOUNT id. Everything
   downstream (summary, counts, tabs, list, export, AI bar) reads monthTxns(),
   so one filter scopes the whole screen. */
function accMatch(t) { return !ST.acc || (ST.acc === '__none' ? !t.accountId : t.accountId === ST.acc); }
function monthTxns() { return txns().filter(t => inMonth(t.date) && accMatch(t)); }
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
/* A line is "linked" once it points at something real. An entry match has no
   bill idx — it points at a cashbook id — so it must be named here explicitly,
   or a matched line would still nag the user to "Identify" a party it has
   already recognized. */
function isLinked(t) { return t.m && (t.m.idx != null || t.m.entryId || (Array.isArray(t.m.allocs) && t.m.allocs.length) || t.m.status === 'other' || t.m.manual); }
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
    /* Recognized but not linked: the app knows WHO this is (from the firm's own
       payment history, or the narration) and says so on the row — it just needs
       a human to say what it settles. Counting it as understood-nothing made the
       page contradict itself: "Recognized as Nagaur Golden Transport Company"
       sitting under "AI understood 0 of 1 · nothing categorized yet". It is
       still an exception — understood and needs-you are different questions. */
    if (m.party) { d.understood++; if (t.credit) d.receipts++; else d.payments++; }
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
    root.innerHTML = heroHTML() + (txns().length ? accBarHTML() + summaryHTML() + finOverviewHTML() + aiHTML() + toolbarHTML() + filtersPanelHTML() + `<div class="rc-panel">${viewHTML()}</div>` + bulkBarHTML() : emptyHTML());
    wire();
    syncStickyOffset();   // the toolbar wraps — the header must pin below its REAL height
  } catch (e) { console.warn('recon render deferred:', e); }
  QLShell.paintWorkspace && QLShell.paintWorkspace();
}
/* Account chips — "All accounts | BOB Current | HDFC | Unassigned". Counts are
   month-scoped but account-blind, so a chip's number is what you'd see after
   clicking it. Hidden entirely until the firm has accounts or stamped txns. */
function accBarHTML() {
  const inM = txns().filter(t => inMonth(t.date));
  const accounts = (Q.bankAccounts ? Q.bankAccounts() : []);
  const stamped = inM.some(t => t.accountId);
  if (!accounts.length && !stamped) return '';
  const valid = new Set(['', '__none', ...accounts.map(a => a.id)]);
  if (!valid.has(ST.acc)) ST.acc = '';                       // company switch / archived account
  const nFor = id => inM.filter(t => id === '' ? true : id === '__none' ? !t.accountId : t.accountId === id).length;
  const unassigned = nFor('__none');
  const chip = (id, label) => `<button class="rc-acc-chip ${ST.acc === id ? 'on' : ''}" data-facc="${esc(id)}">${esc(label)}<span class="rc-acc-n">${nFor(id)}</span></button>`;
  return `<div class="rc-accbar">${svg('<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>')}
    ${chip('', 'All accounts')}
    ${accounts.map(a => chip(a.id, a.label)).join('')}
    ${unassigned && accounts.length ? chip('__none', 'Unassigned') : ''}
  </div>`;
}
function heroHTML() {
  return `<div class="rc-hero">
    <div><div class="rc-h1">Bank Reconciliation</div><div class="rc-sub">${esc(monthLabel())} · <b>${esc(Q.co.short || 'Company')}</b> · ${monthTxns().length} transaction${monthTxns().length === 1 ? '' : 's'}</div></div>
    <div class="rc-hero-r">
      ${QLShell.monthButton({ id: 'rcMonth', label: monthLabel() })}
      ${txns().length ? `<button class="rc-btn rc-btn-ai" id="rcMatch" title="Run the AI matching engine">${svg(IC.ai)}<span>AI Reconcile</span></button><button class="rc-btn" id="rcApply" title="Post payments for the matched bills so their status stops saying Pending">${svg(IC.ck)}<span>Update Payments</span></button><button class="rc-btn" id="rcExport">${svg(IC.dl)}<span>Export</span></button>` : ''}
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
  /* v3: the cards total WHAT IS ON SCREEN — filteredTxns(), not the whole month —
     so search/status/advanced filters update them instantly and the cards can
     never disagree with the list below them. */
  const tt = filteredTxns();
  /* MONEY EXCLUDES DUPLICATES. A row flagged duplicate is the SAME bank line
     imported twice — counting it again overstates what actually moved through
     the account. The dedupe keeps the first copy and flags every later one, so
     dropping the flagged rows leaves exactly one of each.
     The duplicate COUNT is still shown, because the user has to know they are
     there; it is only the money that must not double-count them. */
  const real = tt.filter(t => statusKey(t) !== 'duplicate');
  const cr = real.reduce((a, t) => a + (t.credit || 0), 0), dr = real.reduce((a, t) => a + (t.debit || 0), 0);
  const credN = real.filter(t => (t.credit || 0) > 0).length, debN = real.filter(t => (t.debit || 0) > 0).length;
  const matchedRows = tt.filter(t => statusKey(t) === 'matched');
  const dup = tt.filter(t => statusKey(t) === 'duplicate').length;
  const rev = tt.filter(needsReview); const revAmt = rev.reduce((a, t) => a + (t.credit || 0) + (t.debit || 0), 0);
  const decided = tt.filter(t => t.m && t.m.confidence != null).length;
  const acc = decided ? Math.round(matchedRows.length / decided * 100) : null;
  /* ONE DENSE STRIP, not four cards. The cards cost ~100px above the table and
     carried four numbers a reconciler reads in a glance. This says the same in
     a single row, so more transactions are on screen — the whole point of the
     page. Every figure still totals WHAT IS ON SCREEN (filteredTxns), so it can
     never disagree with the list below it. */
  const chip = (cls, ic, val, sub, title) =>
    `<span class="rc-s2 ${cls}" title="${esc(title || '')}">${ic}<b>${val}</b><i>${esc(sub)}</i></span>`;
  return `<div class="rc-summary2">
    ${chip('g', svg('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'), fC(cr), 'in · ' + credN, 'Money in from ' + credN + ' credits' + (dup ? ' — ' + dup + ' duplicate rows excluded' : ''))}
    ${chip('r', svg('<line x1="12" y1="5" x2="12" y2="19"/><polyline points="5 12 12 19 19 12"/>'), fC(dr), 'out · ' + debN, 'Money out from ' + debN + ' debits' + (dup ? ' — ' + dup + ' duplicate rows excluded' : ''))}
    ${chip('b', svg(IC.ck), matchedRows.length + '<small>/' + tt.length + '</small>', 'matched' + (acc != null ? ' · ' + acc + '%' : ''), 'Matched' + (acc != null ? ', auto-match rate ' + acc + '%' : ''))}
    ${chip('p', svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'), rev.length, 'to review' + (dup ? ' · ' + dup + ' dup' : ''), fC(revAmt) + ' needs review' + (dup ? ', ' + dup + ' duplicates' : ''))}
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
/* ── ONE clean filter toolbar: a status dropdown + Filters + search ── */
function toolbarHTML() {
  const tt = monthTxns();
  const cnt = k => k === 'all' ? tt.length : k === 'review' ? tt.filter(needsReview).length : tt.filter(t => statusKey(t) === k).length;
  if (ST.view === 'audit') {
    const n = ((Q.auditRows ? Q.auditRows() : []) || []).filter(a => a.module === 'recon').length;
    return `<div class="rc-toolbar2">
      <div class="rc-ftabs"><button class="rc-mini2" data-view="recon" title="Back to transactions">${svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>')}<span>Transactions</span></button>
        <span class="rc-audit-n">${n} recorded decision${n === 1 ? '' : 's'}</span></div>
      <div class="rc-tb-r"><div class="rc-searchw">${svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>')}<input class="rc-search2" id="rcAudSearch" placeholder="Search action, party, ref, user…" value="${esc(ST.aq || '')}"></div></div></div>`;
  }
  if (ST.view === 'ledger') {
    /* Counts come from the SAME rows the list renders (ledgerRows), so a chip can
       never promise a number the list does not show. */
    const all = ledgerRows({ ignoreFilter: true });
    const n = { all: all.length, receive: all.filter(p => p.pending > 0).length, pay: all.filter(p => p.pending < 0).length, settled: all.filter(p => !p.pending).length };
    const lt = (k, l) => `<button class="rc-ftab ${ST.lfilter === k ? 'on' : ''}" data-lfilter="${k}">${l}<span class="rc-ftab-n">${n[k]}</span></button>`;
    return `<div class="rc-toolbar2">
      <div class="rc-ftabs">
        <button class="rc-ftab" data-view="recon">${svg('<polyline points="15 18 9 12 15 6"/>')} Back</button>
        ${lt('all', 'All')}${lt('receive', 'To receive')}${lt('pay', 'To pay')}${lt('settled', 'Settled')}
      </div>
      <div class="rc-tb-r">
        <div class="rc-searchw">${svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>')}<input class="rc-search2" id="rcLgSearch" placeholder="Search party…" value="${esc(ST.lq)}"></div>
        <select class="qx-sel rc-lg-sort" id="rcLgSort" aria-label="Sort parties">
          ${[['amount', 'Biggest outstanding'], ['business', 'Most business'], ['name', 'Name (A–Z)']].map(o => `<option value="${o[0]}" ${ST.lsort === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}
        </select>
        <button class="rc-mini2" id="rcLedgerExp">${svg(IC.dl)} Export ledger</button>
      </div></div>`;
  }
  /* ── Status: ONE dropdown, not six tabs ──────────────────────────
     "there is too manny option" — the toolbar carried 6 status tabs + a
     3-way direction toggle + Filters + search + Ledger, eleven controls
     fighting for one row. Now: one Status select (each option keeps its
     count and a colour dot from the SAME STAT palette the row pills use),
     direction lives inside the Filters panel, and the row is four controls.

     The menu items carry data-fstatus — the EXACT attribute the old tabs
     carried — so the existing wire() handler routes them untouched. New
     markup, zero new routing: the class of bug where a redesign quietly
     unhooks a control cannot start here. */
  const stLabel = { all: 'All', review: 'Needs review', matched: 'Matched', partial: 'Partial', unmatched: 'Unmatched', duplicate: 'Duplicate' };
  const stDot = k => `<span class="rc-st-dot" style="background:${k === 'all' ? 'var(--ql-text-muted)' : (STAT[k] || ['', '', 'var(--ql-text-muted)'])[2]}"></span>`;
  const stItem = k => `<button class="rc-st-it ${ST.fstatus === k ? 'on' : ''}" data-fstatus="${k}" role="menuitemradio" aria-checked="${ST.fstatus === k}">${stDot(k)}<span>${stLabel[k]}</span><b>${cnt(k)}</b></button>`;
  const stSel = `<div class="rc-stwrap">
    <button class="rc-stbtn ${ST.fstatus !== 'all' ? 'on' : ''}" id="rcStBtn" aria-haspopup="menu" aria-expanded="${!!ST.stOpen}" title="Filter by status">
      ${stDot(ST.fstatus)}<span>${stLabel[ST.fstatus]}</span><b class="rc-st-n">${cnt(ST.fstatus)}</b>${svg('<polyline points="6 9 12 15 18 9"/>')}
    </button>
    ${ST.stOpen ? `<div class="rc-stmenu" role="menu">${Object.keys(stLabel).map(stItem).join('')}</div>` : ''}
  </div>`;
  return `<div class="rc-toolbar2">
    <div class="rc-ftabs">${stSel}</div>
    <div class="rc-tb-r">
      <button class="rc-exbtn ${ST.exFirst ? 'on' : ''}" id="rcExFirst" title="${ST.exFirst ? 'Showing what needs you first' : 'Showing newest first'}">
        ${svg('<path d="M12 2v6M12 16v6M2 12h6M16 12h6"/><circle cx="12" cy="12" r="3"/>')}<span>${ST.exFirst ? 'Needs you first' : 'Newest first'}</span></button>
      ${dateBtnHTML()}
      ${filtersBtnHTML()}
      <div class="rc-searchw">${svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>')}<input class="rc-search2" id="rcSearch" placeholder="Search party, ref, amount…" value="${esc(ST.q)}"></div>
      <button class="rc-mini2" data-view="ledger" title="Party ledger">${svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>')}<span>Ledger</span></button>
      <button class="rc-mini2" data-view="audit" title="Who decided what, and when">${svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')}<span>Audit</span></button>
    </div></div>`;
}
/* ── DATE RANGE, on the table ─────────────────────────────────────────────
   Presets cover what a reconciler actually asks for; the two date inputs cover
   everything else. Deliberately not tied to the header month picker — that one
   scopes the whole page (KPIs, AI summary), this one narrows the rows you are
   working through, and conflating them is why "filter any time" was awkward. */
function fyStart(d) { const y = d.getFullYear(); return (d.getMonth() >= 3 ? y : y - 1) + '-04-01'; }
function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function datePresets() {
  const now = new Date();
  const som = new Date(now.getFullYear(), now.getMonth(), 1);
  const lom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const eolm = new Date(now.getFullYear(), now.getMonth(), 0);
  const q = Math.floor(now.getMonth() / 3);
  return [
    ['All time', '', ''],
    ['This month', iso(som), iso(now)],
    ['Last month', iso(lom), iso(eolm)],
    ['Last 90 days', iso(new Date(now.getTime() - 89 * 86400000)), iso(now)],
    ['This quarter', iso(new Date(now.getFullYear(), q * 3, 1)), iso(now)],
    ['This FY', fyStart(now), iso(now)]
  ];
}
function dLabel() {
  if (!ST.dFrom && !ST.dTo) return 'Any date';
  const f = ST.dFrom ? fDS(ST.dFrom) : '…';
  const t = ST.dTo ? fDS(ST.dTo) : '…';
  const hit = datePresets().find(p => p[1] === ST.dFrom && p[2] === ST.dTo && p[1]);
  return hit ? hit[0] : f + ' – ' + t;
}
function dateBtnHTML() {
  const on = !!(ST.dFrom || ST.dTo);
  return `<div class="rc-dwrap">
    <button class="rc-dbtn ${on ? 'on' : ''}" id="rcDBtn" aria-haspopup="dialog" aria-expanded="${!!ST.dOpen}" title="Filter by date">
      ${svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>')}
      <span>${esc(dLabel())}</span>${svg('<polyline points="6 9 12 15 18 9"/>')}
    </button>
    ${ST.dOpen ? `<div class="rc-dmenu" role="dialog" aria-label="Date range">
      <div class="rc-dpre">${datePresets().map(p =>
        `<button class="rc-dpb ${(ST.dFrom === p[1] && ST.dTo === p[2]) ? 'on' : ''}" data-dpre="${esc(p[1])}|${esc(p[2])}">${esc(p[0])}</button>`).join('')}</div>
      <div class="rc-drow"><label>From</label><input type="date" id="rcDFrom" value="${esc(ST.dFrom)}"></div>
      <div class="rc-drow"><label>To</label><input type="date" id="rcDTo" value="${esc(ST.dTo)}"></div>
      <div class="rc-dfoot"><button class="rc-dclr" id="rcDClear">Clear</button><span class="rc-dn" id="rcDN"></span></div>
    </div>` : ''}
  </div>`;
}
function bulkBarHTML() {
  if (!ST.sel || !ST.sel.size) return '';
  const hasAccounts = Q.bankAccounts && Q.bankAccounts().length;
  return `<div class="rc-bulk"><span class="rc-bulk-n">${ST.sel.size} selected</span>
    <button class="rc-bulk-b" data-bulk="confirm">${svg(IC.ck)} Confirm suggested</button>
    ${hasAccounts ? `<button class="rc-bulk-b" data-bulk="acct">${svg('<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>')} Assign account</button>` : ''}
    <button class="rc-bulk-b" data-bulk="dup">Mark duplicate</button>
    <button class="rc-bulk-b" data-bulk="ignore">Ignore</button>
    <button class="rc-bulk-b" data-bulk="export">${svg(IC.dl)} Export</button>
    <button class="rc-bulk-x" data-bulk="clear" title="Clear">${svg(IC.x)}</button></div>`;
}
/* The Filters button + panel. Deliberately reuses QLX's own classes (qx-tool,
   qx-adv, qx-sel, qx-date) rather than new rc-* ones: this page is not a QLX
   mount, but it sits next to pages that are, and the control the user learned on
   the Sales Register must look and behave the same here. qlx.css is already
   loaded on this page, so this costs no new CSS. */
function filtersBtnHTML() {
  /* Byte-for-byte the Sales Register's control: class qx-tool, `on` when a filter
     is active, the same funnel icon, no badge. My first draft invented a
     .qx-tool-n count chip — a class that does not exist in qlx.css, so it would
     have rendered as unstyled text next to a control the user already knows.
     Matching beats inventing when the whole point is that it looks the same. */
  const n = advCount();
  return `<button class="qx-tool ${n ? 'on' : ''}" id="rcFilBtn" title="${n ? n + ' filter' + (n > 1 ? 's' : '') + ' active' : 'Filters'}">
    ${svg('<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>')} Filters</button>`;
}
function filtersPanelHTML() {
  if (!ST.advOpen) return '';
  const o = advOptions();
  // __none__ is a sentinel, not a party name — it must never be shown raw.
  const optLabel = v => (v === '__none__' ? '— Not identified —' : v);
  const sel = (k, label, opts) => `<select class="qx-sel" data-fk="${k}" aria-label="${esc(label)}">
    <option value="all">${esc('All ' + label.toLowerCase())}</option>
    ${opts.map(v => `<option value="${esc(v)}" ${ST.adv[k] === v ? 'selected' : ''}>${esc(optLabel(v))}</option>`).join('')}</select>`;
  const conf = `<select class="qx-sel" data-fk="conf" aria-label="Confidence">
    ${[['all', 'Any confidence'], ['high', 'High · 95%+ (auto-matched)'], ['med', 'Medium · 75–94% (needs a look)'],
       ['low', 'Low · under 75%'], ['none', 'No suggestion at all']]
      .map(o2 => `<option value="${o2[0]}" ${ST.adv.conf === o2[0] ? 'selected' : ''}>${esc(o2[1])}</option>`).join('')}</select>`;
  /* Direction (All / Credit / Debit) lives here now, out of the toolbar — same
     buttons, same data-ftype attributes, so the existing handler routes them. */
  const typ = (k, l) => `<button class="rc-typ ${ST.ftype === k ? 'on' : ''}" data-ftype="${k}">${l}</button>`;
  return `<div class="qx-adv" id="rcAdv">
    <div class="rc-typtog">${typ('all', 'All')}${typ('credit', 'Credit')}${typ('debit', 'Debit')}</div>
    ${sel('party', 'Parties', o.party)}
    ${sel('cat', 'Types', o.cat)}
    ${conf}
    <input class="qx-date" type="date" data-dk="from" value="${esc(ST.adv.from)}" aria-label="From date">
    <span class="qx-dash">–</span>
    <input class="qx-date" type="date" data-dk="to" value="${esc(ST.adv.to)}" aria-label="To date">
    <input class="qx-sel rc-amt" type="number" data-dk="min" value="${esc(ST.adv.min)}" placeholder="Min ₹" aria-label="Minimum amount">
    <input class="qx-sel rc-amt" type="number" data-dk="max" value="${esc(ST.adv.max)}" placeholder="Max ₹" aria-label="Maximum amount">
    ${advCount() ? `<button class="qx-tool" id="rcFilClear">${svg(IC.x)} Clear</button>` : ''}
  </div>`;
}

/* ── Advanced filters ────────────────────────────────────────────
   The Sales Register has a Filters panel; this page had only tabs, a
   credit/debit toggle and search — so "show me everything over ₹50,000 that
   Aziz Chemicals sent in the last fortnight" meant scrolling.

   Every option list is derived from the ROWS ON SCREEN (monthTxns), not from a
   hardcoded enum. A filter that offers "Petcoke" when no line is petcoke is a
   dead end the user has to discover by trying it. */
/* The PARTY filter must list PARTIES. It used to fall back to `t.clean`, which is
   a de-noised bank narration with no verification behind it — this file says so
   itself ("Clean (matched on)"). That is why the dropdown filled with "ACHRE HRETC
   HARGE", "AQB SER CHGS INC GST APR JUN2025 CDT2519" and "COLL": narrations that
   parsed badly, sitting beside real firms as if they were the same kind of thing.

   Only CERTAIN identities count, in descending order of certainty. Deliberately NO
   first-token guess (rcTxnParty's last resort): "DESHWALI LIME CENTRAL BANK O"
   shares a first token with the real party "Deshwali Minerals", so guessing would
   file a bank charge under a real firm's name — inventing data in a filter, which
   is worse than the junk it replaces. A row with no certain party returns '' and is
   reachable via Category, search, or the Unidentified option. */
function txnPartyName(t) {
  if (t.m && t.m.party) return t.m.party;                       // entry/ledger match — explicit
  const b = billFor(t);                                          // linked to an invoice/bill
  if (b) return b.party || b.sup || '';
  const al = aliasOf(t.clean || '');                             // the user taught us this narration
  if (al) return al;
  const norm = x => (x || '').toString().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const target = norm(t.clean); if (!target) return '';
  const hit = Q.partyRows().find(p => norm(p.name) === target);  // EXACT name only — never a prefix
  return hit ? hit.name : '';
}
function txnParty(t) { return txnPartyName(t); }
function txnCat(t) { return (t.m && t.m.cat) || ''; }
function txnAmt(t) { return (t.credit || 0) || (t.debit || 0) || 0; }

function advOptions() {
  const rows = monthTxns();
  const uniq = (fn) => [...new Set(rows.map(fn).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  /* __none__ is offered only when such rows exist: "which lines has the app failed
     to attribute?" is the actual question this screen is for, and before this the
     answer was unreachable — every row had a "party", because the narration was
     being passed off as one. */
  const parties = uniq(txnPartyName);
  const anyNone = rows.some(t => !txnPartyName(t));
  return {
    party: parties.concat(anyNone ? ['__none__'] : []),
    cat: uniq(txnCat)
  };
}

function advMatch(t) {
  const a = ST.adv;
  if (a.party === '__none__') { if (txnPartyName(t)) return false; }
  else if (a.party !== 'all' && txnPartyName(t) !== a.party) return false;
  if (a.cat !== 'all' && txnCat(t) !== a.cat) return false;
  if (a.conf !== 'all') {
    /* Confidence bands mirror the ENGINE's own tiers (recon-core: >=95 green,
       >=75 yellow) rather than inventing new ones — two different definitions of
       "high confidence" in one product is how a user stops trusting either. */
    const c = (t.m && t.m.confidence != null) ? t.m.confidence : -1;
    if (a.conf === 'high' && !(c >= 95)) return false;
    if (a.conf === 'med' && !(c >= 75 && c < 95)) return false;
    if (a.conf === 'low' && !(c >= 0 && c < 75)) return false;
    if (a.conf === 'none' && c >= 0) return false;      // no suggestion at all
  }
  const d = t.date || '';
  if (a.from && d && d < a.from) return false;
  if (a.to && d && d > a.to) return false;
  const amt = txnAmt(t);
  if (a.min !== '' && amt < (+a.min || 0)) return false;
  if (a.max !== '' && amt > (+a.max || 0)) return false;
  return true;
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
  /* Dates are ISO (YYYY-MM-DD) so a string compare IS a date compare — no
     parsing, no timezone to get wrong. */
  if (ST.dFrom) r = r.filter(t => String(t.date || '') >= ST.dFrom);
  if (ST.dTo)   r = r.filter(t => String(t.date || '') <= ST.dTo);
  r = r.filter(advMatch);          // advanced filters (Filters panel)
  if (ST.q) { const q = ST.q.toLowerCase(); r = r.filter(t => { const b = billFor(t); return ((t.clean || '') + ' ' + (t.raw || t.desc || '') + ' ' +(t.utr || '') + ' ' + (t.ref || '') + ' ' + (t.credit || t.debit || '') + ' ' + (b ? (b.party || b.sup || '') + ' ' + (b.inv || b.bill || '') : '')).toLowerCase().includes(q); }); }
  const byDate = (a, b) => (b.date || '').localeCompare(a.date || '');
  if (!ST.exFirst) return r.slice().sort(byDate);
  /* Order by what it costs to ignore: an unmatched line is money unaccounted
     for, a duplicate is money counted twice, a partial is half-done. Matched
     lines are already settled and sink to the bottom — still there, still
     scrollable, just not in the way. */
  const rank = t => {
    const k = statusKey(t);
    if (k === 'unmatched') return 0;
    if (k === 'duplicate') return 1;
    if (k === 'partial') return 2;
    if (k === 'other') return 3;
    return 4;                       // matched / everything settled
  };
  return r.slice().sort((a, b) => (rank(a) - rank(b)) || byDate(a, b));
}
function badge(t) {
  const m = t.m || {}, s = STAT[m.status] || STAT.unmatched;
  /* 'other' joins the list because the CONFIDENCE COLUMN IS GONE and this badge is
     now the only place the number is printed. It was always the better place: the
     column showed "80%", this badge showed "Partial · 80%", and the suggestion cell
     drew a progress bar of the same 80% — one fact, rendered three times, in three
     columns, on every row. That is what "too much data" meant. */
  /* v3: the chip is COMPACT — status only, coloured dot, hover explains the
     reason. The % moved to its own Confidence column (confCell) — one fact,
     one place, still true, just each fact in ITS place now. */
  const why = (m.reasons || []).filter(Boolean).slice(0, 3).join(' · ') || s[0];
  return `<span class="rc-badge rc-schip" style="background:${s[1]};color:${s[2]}" title="${esc(why)}"><i class="rc-schip-d" style="background:${s[2]}"></i>${s[0]}${m.manual ? ' ✓' : ''}</span>`;
}
function matchCell(t) {
  if (isSplit(t)) { const bl = billsFor(t); const names = bl.map(x => x.kind === 'sale' ? x.bill.party : x.bill.sup).filter(Boolean); const uniq = [...new Set(names)]; return `<div class="rc-match"><b>${bl.length} bills · ${fC(bl.reduce((a, x) => a + x.amount, 0))}</b><span>${esc(uniq.slice(0, 2).join(', '))}${uniq.length > 2 ? ' +' + (uniq.length - 2) : ''}</span></div>`; }
  if (t.m && t.m.kind === 'ledger') return `<div class="rc-match"><b>Running a/c</b><span>${esc(t.m.party || '')}</span></div>`;
  // An entry match points at money already in the cashbook — show the payment it
  // is, not a bill it would pay.
  if (t.m && t.m.kind === 'entry') return `<div class="rc-match"><b>${esc(t.m.cat || 'Recorded payment')}</b><span>${esc(t.m.party || '')} · already in cashbook</span></div>`;
  const b = billFor(t);
  if (b) { const ref = t.m.kind === 'sale' ? b.inv : b.bill; const nm = t.m.kind === 'sale' ? b.party : b.sup; return `<div class="rc-match"><b>${esc(ref || '—')}</b><span>${esc(nm || '')}${t.m.kind === 'purchase' && b.emoji ? ' · ' + b.emoji : ''}</span></div>`; }
  if (t.m && t.m.status === 'other') return `<div class="rc-match"><b>${esc(t.m.cat || 'Categorized')}</b><span>non-bill entry</span></div>`;
  return `<span class="rc-mut">—</span>`;
}
/* ── Month grouping ───────────────────────────────────────────────
   The Purchase Register groups its rows under collapsible headers ("Petcoke").
   This list had none: on "All months" a year of statements arrives as one flat
   run of 700 lines and you find June by scrolling until the dates change.

   Each header carries that month's OWN money in / money out / still-to-review.
   That is the actual ask — a per-month BREAKDOWN, not just a divider. The
   summary cards at the top total the whole filtered set; these total one month,
   from the same rows on screen, so the two can never disagree.

   Only groups when it can help: with a single month selected there is exactly one
   group, and a header saying "June — 74 of 74" is noise. */
function ymOfDate(d) { return (d || '').slice(0, 7); }
function monthName(ym) { return Q.monthLabel(ym, { blank: 'No date' }); }
function groupByMonth(rows) {
  const out = [], seen = {};
  rows.forEach(t => {                       // rows arrive newest-first; keep that order
    const k = ymOfDate(t.date);
    if (!seen[k]) { seen[k] = { key: k, label: monthName(k), rows: [] }; out.push(seen[k]); }
    seen[k].rows.push(t);
  });
  return out;
}
function monthGroupBar(g, first) {
  const cr = g.rows.reduce((a, t) => a + (t.credit || 0), 0);
  const dr = g.rows.reduce((a, t) => a + (t.debit || 0), 0);
  const todo = g.rows.filter(needsReview).length;
  const collapsed = ST.collapsed.has(g.key);
  return `<tr class="qx-grp ${collapsed ? 'collapsed' : ''}" data-grp="${esc(g.key)}"><td colspan="7">
    <div class="qx-grp-bar ${first ? 'first' : ''}">
      <svg class="qx-grp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      <b>${esc(g.label)}</b>
      <span class="rc-grp-n">${g.rows.length} line${g.rows.length === 1 ? '' : 's'}</span>
      <span class="rc-grp-sp"></span>
      ${cr ? `<span class="rc-grp-in">+${fC(cr)}</span>` : ''}
      ${dr ? `<span class="rc-grp-out">−${fC(dr)}</span>` : ''}
      ${todo ? `<span class="rc-grp-todo">${todo} to review</span>` : `<span class="rc-grp-done">all done</span>`}
    </div></td></tr>`;
}

/* ── AUDIT TRAIL: who decided what, and what it was before ─────────────────
   Reads the rows reconcile.js now writes. Deliberately read-only and
   unfiltered by month: an audit trail you can quietly narrow is not one.
   Same shape as purchase.js tabAudit so the two read alike. */
function auditHTML() {
  const all = (Q.auditRows ? Q.auditRows() : []) || [];
  const rows = all.filter(a => a.module === 'recon');
  if (!rows.length) return `<div class="rc-none">Nothing recorded yet. Confirming, unlinking, ignoring, categorising or marking a duplicate writes a line here.</div>`;
  const q = (ST.aq || '').toLowerCase().trim();
  const shown = q ? rows.filter(a => ((a.action || '') + ' ' + (a.party || '') + ' ' + (a.ref || '') + ' ' + (a.by || '') + ' ' + (a.reason || '')).toLowerCase().includes(q)) : rows;
  const LBL = { confirm: 'Confirmed match', unlink: 'Unlinked', duplicate: 'Marked duplicate',
    unduplicate: 'Unmarked duplicate', ignore: 'Ignored', categorise: 'Categorised' };
  return `<div class="rc-tablewrap"><table class="rc-table rc-table2 rc-v3">
    <thead><tr><th>When</th><th>Action</th><th>Transaction</th><th class="r">Amount</th><th>Change</th><th>By</th></tr></thead>
    <tbody>${shown.slice(0, 400).map(a => `<tr>
      <td class="rc-audit-t">${esc(String(a.ts || '').slice(0, 16).replace('T', ' '))}</td>
      <td><span class="rc-audit-a">${esc(LBL[a.action] || a.action || '')}</span></td>
      <td><div class="rc-mt"><span class="rc-mt-d">${esc(a.party || '—')}</span>${a.ref ? `<span class="rc-mt-w">${esc(a.ref)}</span>` : ''}</div></td>
      <td class="r">${a.amount ? fC(a.amount) : '—'}</td>
      <td class="rc-audit-c">${esc(a.reason || '—')}</td>
      <td class="rc-audit-b">${esc(a.by || '—')}${a.role ? ' · ' + esc(a.role) : ''}</td>
    </tr>`).join('')}</tbody></table>
    ${shown.length > 400 ? `<div class="rc-none">Showing the latest 400 of ${shown.length}.</div>` : ''}</div>`;
}
function viewHTML() {
  if (ST.view === 'ledger') return ledgerHTML();
  if (ST.view === 'audit') return auditHTML();
  const rows = filteredTxns();
  if (!rows.length) return `<div class="rc-none">${ST.month && ST.month !== 'all' ? 'No matching transactions for ' + esc(monthLabel()) : 'No transactions match these filters'}.</div>`;
  /* ONE row template — the grouped and ungrouped paths must render the same row.
     Two copies would drift the moment a column is added to only one of them.

     v3 LAYOUT (information priority): Date · Transaction (name + mode·ref) ·
     Amount · Status chip · Confidence bar · Review. Type + suggested-match moved
     into the EXPANDABLE detail row — scan first, detail on demand. */
  const rowHTML = t => {
    const sel = ST.sel && ST.sel.has(t.id);
    const open = ST.expanded.has(t.id);
    return `<tr data-open="${t.id}" class="rc-clk${sel ? ' rc-selrow' : ''}${open ? ' rc-xopen' : ''}">
    <td class="rc-cbx"><button class="rc-cb${sel ? ' on' : ''}" data-sel="${t.id}" title="Select">${sel ? svg(IC.ck) : ''}</button></td>
    <td class="rc-mut rc-nowrap">${fDS(t.date)}</td>
    <td class="rc-party">${partyCell(t)}</td>
    <td class="r">${amountCell(t)}</td>
    <td>${badge(t)}</td>
    <td>${matchedCell(t)}</td>
    <td class="rc-actcell">${actionCell(t)}</td>
  </tr>${open ? `<tr class="rc-xrow"><td colspan="7">${expandHTML(t)}</td></tr>` : ''}`; };

  /* Group only when there is more than one month to separate. */
  const capped = rows.slice(0, ST.cap);
  const more = rows.length - capped.length;
  const groups = groupByMonth(capped);
  const body = groups.length < 2
    ? capped.map(rowHTML).join('')
    : groups.map((g, i) =>
        monthGroupBar(g, i === 0) +
        (ST.collapsed.has(g.key) ? '' : g.rows.map(rowHTML).join(''))
      ).join('');
  const moreBar = more > 0 ? `<tr><td colspan="7" class="rc-morebar"><button class="ql-btn ql-btn-secondary" data-showmore>Show ${Math.min(300, more)} more (${more.toLocaleString('en-IN')} remaining)</button></td></tr>` : '';
  return `<div class="rc-tablewrap"><table class="rc-table rc-table2 rc-v3">
    <thead><tr><th class="rc-cbx"></th><th>Date</th><th>Transaction</th><th class="r">Amount</th><th>Status</th><th>Reconciled against</th><th></th></tr></thead>
    <tbody>${body}${moreBar}</tbody></table></div>`;
}
/* ── v3: confidence indicator (bar + %) — the ONE place the number is drawn ── */
/* WHAT THIS LINE IS RECONCILED AGAINST — a fact, not a score.

   The AI-confidence bar was a percentage on every row that nobody could act
   on: it said how sure the matcher was, never WHAT it matched. This shows the
   document the money is tied to (invoice / bill number and party), or the
   category for a line that is not a bill (bank charges, EMI, internal
   transfer). Unmatched lines say so plainly instead of showing a low bar.
   The confidence is still available — it is in the expandable row, next to
   the reasons the matcher gives. */
function matchedCell(t) {
  const m = t.m || {}, b = billFor(t);
  if (b) {
    const no = b.inv || b.bill || '';
    const who = b.party || b.sup || '';
    return `<div class="rc-mt"><span class="rc-mt-d">${esc(no || 'Matched')}</span>`
      + (who ? `<span class="rc-mt-w">${esc(who)}</span>` : '') + `</div>`;
  }
  if (m.entryId) return `<div class="rc-mt"><span class="rc-mt-d">Cashbook entry</span>${m.cat ? `<span class="rc-mt-w">${esc(m.cat)}</span>` : ''}</div>`;
  if (m.status === 'other' && m.cat) return `<div class="rc-mt"><span class="rc-mt-d">${esc(m.cat)}</span><span class="rc-mt-w">categorised</span></div>`;
  if (m.status === 'duplicate') return `<div class="rc-mt"><span class="rc-mt-w">duplicate of an earlier line</span></div>`;
  return `<div class="rc-mt"><span class="rc-mt-w">not matched yet</span></div>`;
}
function confCell(t) {
  const m = t.m || {};
  const c = m.confidence;
  if (c == null || ['matched', 'partial', 'review', 'overpayment', 'amountdiff', 'datemismatch', 'other'].indexOf(m.status) < 0) return '<span class="rc-mut">—</span>';
  const col = c >= 95 ? '#16a34a' : c >= 75 ? '#f59e0b' : '#ef4444';
  return `<div class="rc-cf" title="AI confidence ${c}%${m.tier ? ' · ' + m.tier + ' tier' : ''}"><span class="rc-cf-n">${c}%</span><div class="rc-cf-bar"><i style="width:${Math.max(4, Math.min(100, c))}%;background:${col}"></i></div></div>`;
}
/* ── v3: the expandable detail row — everything the lean row hides ── */
function expandHTML(t) {
  const m = t.m || {};
  const reasons = (m.reasons || []).filter(Boolean);
  const ids = [t.utr ? 'UTR ' + t.utr : '', t.cheque ? 'CHQ ' + t.cheque : '', t.ref ? 'Ref ' + t.ref : ''].filter(Boolean).join(' · ');
  return `<div class="rc-x">
    <div class="rc-x-col">
      <div class="rc-x-h">Narration</div>
      <div class="rc-x-nar">${esc(t.raw || t.desc || '—')}</div>
      ${ids ? `<div class="rc-x-ids">${esc(ids)}</div>` : ''}
      <div class="rc-x-type">${typeCell(t)}</div>
    </div>
    <div class="rc-x-col">
      <div class="rc-x-h">Suggested match</div>
      ${suggestCell(t)}
      ${reasons.length ? `<div class="rc-x-h" style="margin-top:10px">Why the AI thinks so</div><ul class="rc-x-why">${reasons.slice(0, 4).map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    </div>
    <div class="rc-x-acts">
      <button class="ql-btn ql-btn-primary rc-review" data-open="${t.id}">Open review</button>
      <button class="ql-btn ql-btn-secondary" data-link="${t.id}">Identify party</button>
      <button class="ql-btn ql-btn-secondary" data-mark="${t.id}">Mark as…</button>
    </div>
  </div>`;
}
/* ── table cells ── */
function titleCase(s) { return (s || '').toString().toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()); }
/* Rail/bank boilerplate that carries no information about WHO was paid. */
const TITLE_NOISE = /^(sent|using|payt|paytm@|upi|neft|imps|rtgs|chg|chrg|txn|trf|transfer|to|from|via|ref|no|the|and|of|ltd|pvt)$/i;
function shortTitle(s, max) {
  const words = String(s || '').replace(/[_\-\/]+/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words) {
    if (out.length >= (max || 3)) break;
    if (w.length === 1) continue;                       // stray initials: "M U"
    if (TITLE_NOISE.test(w)) continue;
    if (/^\d+$/.test(w)) continue;                      // refs and date fragments (12/12/25 -> 12 12 25)
    const prev = out[out.length - 1] || '';
    /* "Utility Utilitypaytm" and "Hdfcbank HdfcOmerupi" are the same token
       twice with the rail glued on — keep the first, drop the echo. */
    const a = w.toLowerCase(), b = prev.toLowerCase();
    if (prev && (a.startsWith(b) || b.startsWith(a))) continue;
    out.push(w);
  }
  return out.join(' ');
}
function partyCell(t) {
  const b = billFor(t), m = t.m || {}, alias = (aliases()[RC.normName(t.clean || '')] || '');
  const known = b ? (t.credit ? b.party : b.sup) : (m.party || alias || '');
  // Primary line: the resolved PARTY (or the category for non-bill entries) —
  // never the raw bank blob. Secondary: normalized "mode · ref", not narration.
  const isOther = m.status === 'other';
  /* NO FIXED CHARACTER LIMIT. This used to slice(0,36) — a hard cut that mangled
     long party names while half the row sat empty. The name is now given the
     room it needs and the CSS clamps it to two lines, so a 200-character
     narration degrades gracefully instead of being chopped mid-word. */
  /* A RESOLVED party keeps its full name — never cut a real name. An
     UNRESOLVED bank blob ("Paytm Utility Utilitypaytm Hdfcbank HdfcOmerupi
     Sent Using Payt M U") is not a name at all: it is rail noise, and it wraps
     to two lines saying almost nothing. Show the first few meaningful words;
     the full narration is always in the expandable row below. */
  const name = known || (isOther ? m.cat : '') || shortTitle(titleCase(t.clean)) || shortTitle(t.raw || t.desc || '') || '—';
  const mode = t.mode || (t.cheque ? 'CHQ' : '');
  const shortRef = t.utr ? String(t.utr).slice(-10) : (t.cheque || '');
  /* The secondary line is the PAYMENT RAIL + reference (NEFT · 6161997932) —
     short, structured, and the thing an accountant actually cross-checks. It
     only falls back to the raw narration when the bank gave us no rail/ref, and
     even then the CSS keeps it to one line: the FULL narration always lives in
     the expandable detail row, never truncated there. */
  const norm2 = [mode, shortRef].filter(Boolean).join(' · ') || (t.raw || t.desc || '');
  /* TWO LINES, ALWAYS. This cell used to grow a conditional THIRD line
     ("✓ Recognized as X" / "Unknown party · Identify"), so rows that had one stood
     taller than rows that did not — that is the ragged spacing he reported.

     "Recognized as Indian Oil Corporation Limited" also sat directly beneath the
     name Indian Oil Corporation Limited: `name` IS `known` whenever we know it. The
     same fact twice, one line apart. It becomes a tick against the name — same
     meaning, no extra line, no repetition. Unknown parties keep Identify (it is how
     the matcher learns) but inline on the reference line, where it costs no height. */
  const unknown = !isOther && ((m.status === 'unknown') || !isLinked(t));
  const tick = known ? `<span class="rc-ok" title="Recognized as ${esc(known)}">${svg('<path d="M20 6 9 17l-5-5"/>')}</span>` : '';
  const idLink = unknown ? `<button class="rc-idbtn" data-link="${t.id}">Identify</button>` : '';
  return `<div class="rc-party-n">${tick}<span class="rc-party-nm">${esc(name)}</span></div>`
    + `<div class="rc-party-nar"><span class="rc-nar-t">${esc(norm2)}</span>${idLink}</div>`;
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
  if (m.kind === 'entry') return chip(m.cat || 'Recorded payment', 'rc-tp-e');
  // A line recognized from the firm's own payment history. It has no bill and no
  // cashbook row yet, so without this it renders as a bare "Debit" and the whole
  // point — that we know who this is — never reaches the screen.
  if (m.catKey === 'recurring') return chip(m.cat || 'Recurring payment', 'rc-tp-r');
  if (m.idx != null || isSplit(t)) return t.credit ? chip('Customer payment', 'rc-tp-c') : chip('Supplier payment', 'rc-tp-d');
  return t.credit ? chip('Credit', 'rc-tp-c') : chip('Debit', 'rc-tp-d');
}
function amountCell(t) { return t.credit ? `<span class="rc-amt rc-cr">+ ${fC(t.credit)}</span>` : `<span class="rc-amt rc-dr">− ${fC(t.debit)}</span>`; }
function suggestCell(t) {
  if (isSplit(t)) { const bl = billsFor(t); return `<div class="rc-sg"><b>${bl.length} bills · ${fC(bl.reduce((a, x) => a + x.amount, 0))}</b><span class="rc-sg-p">split allocation</span></div>`; }
  if (t.m && t.m.kind === 'ledger') return `<div class="rc-sg"><b>Running account</b><span class="rc-sg-p">${esc(t.m.party || '')}</span></div>`;
  if (t.m && t.m.kind === 'entry') return `<div class="rc-sg"><b>${fC(t.m.entryAmount || t.debit || t.credit || 0)} · already recorded</b><span class="rc-sg-p">${esc(t.m.party || '')}${t.m.entryDate ? ' · ' + fDS(t.m.entryDate) : ''}</span></div>`;
  // The history match: say WHY in the user's own terms ("you pay them about every
  // month"), or the suggestion column is blank on the very rows it explains.
  if (t.m && t.m.catKey === 'recurring') return `<div class="rc-sg"><b>${esc(t.m.party || '')}</b><span class="rc-sg-p">${esc((t.m.reasons || [])[0] || 'Paid about every month')}</span></div>`;
  const b = billFor(t);
  if (b) {
    const ref = t.m.kind === 'sale' ? b.inv : b.bill, nm = t.m.kind === 'sale' ? b.party : b.sup;
    const alloc = t.credit || t.debit || 0, tot = b.total || alloc;
    const over = alloc > tot + 1;
    const pct = Math.min(100, Math.round(alloc / (tot || 1) * 100));
    const col = over ? '#dc2626' : pct >= 99 ? '#16a34a' : '#f59e0b';
    const line = over ? `${fC(alloc)} — exceeds bill by ${fC(alloc - tot)}` : `${fC(alloc)} of ${fC(tot)}`;
    /* TWO LINES like every other suggestion, not four. This was the tallest cell in
       the table: ref, party, "₹1,20,000 of ₹6,27,013", and a progress bar — while
       the Status badge two columns over already said "Partial · 80%". The amount
       folds onto the party line (it is the useful half: which bill, how much of it),
       and the bar becomes a hairline along the cell's bottom edge — it adds no
       height, and an over-payment still shows red where it matters. */
    return `<div class="rc-sg"><b>${esc(ref || '—')}</b>`
      + `<span class="rc-sg-p">${esc(nm || '')}${nm ? ' · ' : ''}<span class="rc-sg-of"${over ? ' style="color:#dc2626;font-weight:600"' : ''}>${line}</span></span>`
      + `<div class="rc-sg-bar"><i style="width:${pct}%;background:${col}"></i></div></div>`;
  }
  if (t.m && t.m.status === 'other') return `<div class="rc-sg"><b>${esc(t.m.cat || 'Categorized')}</b><span class="rc-sg-p">non-bill entry</span></div>`;
  return '<span class="rc-mut">— no match —</span>';
}
/* confCell is DELETED, not left orphaned. The Confidence COLUMN is gone: it printed
   the same number the Status badge already carries ("Partial · 80%"), which this
   function's own comment used to call "the page disagreeing with itself". One
   fact, one place. A dead renderer is what someone re-wires by accident later. */
function actionCell(t) {
  return `<button class="rc-review" data-open="${t.id}">Review</button><button class="rc-kebab" data-more="${t.id}" title="More">${svg(IC.dots || '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>')}</button>`;
}
/* ONE place decides which parties the ledger shows — the toolbar's counts, the
   list, the header totals and the export all call this. Two implementations would
   let the chip say "12 to receive" while the list showed 9. */
function ledgerRows(opts) {
  opts = opts || {};
  let r = partyLedger().filter(p => p.party !== '—');
  if (!opts.ignoreFilter) {
    if (ST.lfilter === 'receive') r = r.filter(p => p.pending > 0);
    else if (ST.lfilter === 'pay') r = r.filter(p => p.pending < 0);
    else if (ST.lfilter === 'settled') r = r.filter(p => !p.pending);
    const q = (ST.lq || '').trim().toLowerCase();
    if (q) r = r.filter(p => (p.party || '').toLowerCase().includes(q));
  }
  /* Only sorts with real data behind them. partyLedger emits no date, so a "Most
     recent" option would compare undefined to undefined — a control that looks like
     it works and silently does nothing. `business` is a field it actually returns. */
  if (ST.lsort === 'name') r = r.slice().sort((a, b) => (a.party || '').localeCompare(b.party || ''));
  else if (ST.lsort === 'business') r = r.slice().sort((a, b) => (b.business || 0) - (a.business || 0));
  else r = r.slice().sort((a, b) => Math.abs(b.pending || 0) - Math.abs(a.pending || 0));   // biggest money first
  return r;
}

function ledgerHTML() {
  const rows = ledgerRows();
  if (!rows.length && (ST.lq || ST.lfilter !== 'all')) {
    /* Say WHY it is empty and offer the way out — "No party data yet" would be a
       lie when the data is there and a filter is hiding it. */
    return `<div class="rc-none">No party matches ${ST.lq ? '“' + esc(ST.lq) + '”' : 'this filter'}.<br><button class="rc-linkbtn" id="rcLgClear">Clear search &amp; filters</button></div>`;
  }
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
/* The calendar is QLShell.monthPicker — the app's ONE picker. This was the third
   of four copies, and the one that shipped WITHOUT the year-arrow fix its
   siblings already had: the user found it, which is why monthpicker.test.js
   exists. There is nothing left here to drift. */
function openMonthMenu(anchor) {
  closeRcMenu();
  QLShell.monthPicker(anchor, {
    month: ST.month,
    have: new Set(txns().map(t => ymOf(t.date)).filter(Boolean)),
    onPick(ym) { ST.month = ym; ST.monthInit = true; if (Q.setUiMonth) Q.setUiMonth(ym); render(); }
  });
}
function openMark(tid, anchor) {
  closeRcMenu();
  const t = txns().find(x => x.id === tid); if (!t) return;
  const cats = ['Advance payment', 'Self transfer', 'Inter-firm transfer', 'Partner transfer', 'Loan / EMI', 'Cash withdrawal', 'GST payment', 'Bank charges', 'Interest', 'Petcoke', 'Limestone', 'Plastic Bags', 'Royalty', 'Ignore', 'Other'];
  const m = document.createElement('div'); m.className = 'rc-menu';
  m.innerHTML = `<div class="rc-menu-h">Mark as</div>${cats.map(c => `<button class="rc-menu-i" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}`;
  m.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { const _wc = statusKey(t); t.m = { kind: 'other', idx: null, status: 'other', cat: b.dataset.cat, manual: true, confidence: 100, matchedBy: 'manual', reasons: ['Categorized as ' + b.dataset.cat + ' by user'], at: new Date().toISOString() }; auditRecon('categorise', t, _wc, 'other', b.dataset.cat); Q.saveRecon(); closeRcMenu(); render(); toast('Marked as ' + b.dataset.cat, 'ok'); });
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
  // A loan/EMI debit can be recorded against a loan on the Loans page: marks
  // the next instalment paid + posts to the Payments ledger (with the bank
  // account this debit left from).
  if ((t.debit || 0) > 0 && !t.m?.loanApplied && /loan|emi/i.test(t.m?.cat || '') && (Q.loanRows ? Q.loanRows() : []).length) {
    m.appendChild(item('Record as loan EMI…', () => {
      const loans = Q.loanRows();
      QLShell.openForm({
        title: 'Record loan EMI', sub: fC(t.debit) + ' debit on ' + fDS(t.date),
        specs: [{ k: 'loan', label: 'Against loan', type: 'select', full: true, opts: loans.map(l => [String(l.idx), l.name + (l.outstanding ? ' · ' + fC(l.outstanding) + ' left' : '')]) }],
        saveLabel: 'Record EMI', initial: { loan: String(loans[0].idx) },
        onSave(v) {
          Q.payLoanEmi(+v.loan, { amount: t.debit, method: 'Bank', date: t.date, ref: t.utr || t.ref || '', accountId: t.accountId || '' });
          t.m = Object.assign({}, t.m, { loanApplied: true, manual: true, status: 'other', kind: 'other', reasons: ['EMI recorded against ' + (loans.find(l => String(l.idx) === v.loan) || {}).name] });
          Q.saveRecon(); render(); toast('EMI recorded — loan updated', 'ok');
        }
      });
    }));
  }
  m.appendChild(item('Categorize', () => openMark(tid, anchor)));
  const isDup = t.m && t.m.status === 'duplicate';
  m.appendChild(item(isDup ? 'Unmark duplicate' : 'Mark duplicate', () => { markDuplicate(t, !isDup); render(); }));
  if (isLinked(t)) m.appendChild(item('Undo match', () => { undoMatch(t); render(); }, 'del'));
  placeRcMenu(m, anchor);
}
/* ── AUDIT: every reconciliation DECISION leaves a trace ────────────────────
   reconcile.js wrote none. Confirming a match, unlinking one, marking a
   duplicate or categorising a line all moved money-facing state with nothing
   recorded — "who matched this, when, and was it the AI or a person" had no
   answer. Q.auditRows() already reads the log (purchase.js does), so only the
   write side was missing.

   Kept cheap on purpose: one call per decision, the previous → new status in
   `reason` so an override is legible without a schema change. */
function auditRecon(action, t, was, now, extra) {
  if (!Q.logAudit) return;                       // older data.js — never throw here
  const b = billFor(t);
  try {
    Q.logAudit(action, 'recon', { id: t.id }, {
      ref: t.utr || t.cheque || t.ref || '',
      party: (b && (b.party || b.sup)) || (t.m && t.m.party) || t.clean || '',
      amount: (t.credit || 0) + (t.debit || 0),
      reason: (was && now ? was + ' → ' + now : (now || '')) + (extra ? ' · ' + extra : '')
    });
  } catch (_) { /* an audit failure must never block the user's action */ }
}

function markDuplicate(t, on) {
  const was = statusKey(t);
  t.m = Object.assign({}, t.m || {}, { status: on ? 'duplicate' : (t.m && t.m.idx != null ? 'matched' : 'unmatched'), manual: true });
  auditRecon(on ? 'duplicate' : 'unduplicate', t, was, statusKey(t), 'by user');
  Q.saveRecon();
}
function undoMatch(t) { const _was = statusKey(t); if (t.m && t.m.kind === 'ledger' && t.m.ledgerEntryId && Q.reverseLedgerEntry) Q.reverseLedgerEntry(t.m.partyIdx, t.m.ledgerEntryId); t.m = { kind: (t.credit || 0) > 0 ? 'sale' : 'purchase', idx: null, status: 'unmatched', confidence: 0, matchedBy: 'manual', reasons: ['Unlinked by user'], at: new Date().toISOString() }; auditRecon('unlink', t, _was, 'unmatched', 'by user'); Q.saveRecon(); }
function bulkAction(a) {
  const rows = txns().filter(t => ST.sel.has(t.id));
  if (a === 'clear') { ST.sel.clear(); render(); return; }
  if (a === 'confirm') { rows.forEach(t => { if (t.m && t.m.idx != null) { const _w = statusKey(t); t.m = Object.assign({}, t.m, { status: (t.credit || t.debit) < ((billFor(t) || {}).outstanding != null ? billFor(t).outstanding : Infinity) - 1 ? 'partial' : 'matched', manual: true, confidence: 100 }); auditRecon('confirm', t, _w, statusKey(t), 'bulk'); } }); Q.saveRecon(); ST.sel.clear(); render(); toast('Confirmed ' + rows.length + ' match' + (rows.length === 1 ? '' : 'es'), 'ok'); return; }
  if (a === 'dup') { rows.forEach(t => markDuplicate(t, true)); ST.sel.clear(); render(); toast('Marked ' + rows.length + ' as duplicate', 'ok'); return; }
  if (a === 'ignore') { rows.forEach(t => { const _w = statusKey(t); t.m = { kind: 'other', idx: null, status: 'other', cat: 'Ignored', manual: true, confidence: 100 }; auditRecon('ignore', t, _w, 'other', 'bulk'); }); Q.saveRecon(); ST.sel.clear(); render(); toast('Ignored ' + rows.length, 'ok'); return; }
  if (a === 'export') { exportRecon(); ST.sel.clear(); render(); return; }
  // Reassign the selected txns to a bank account (or back to Unassigned).
  // Dedupe keys are account-scoped, so duplicates are re-evaluated after.
  if (a === 'acct') {
    const accounts = Q.bankAccounts();
    QLShell.openForm({
      title: 'Assign bank account', sub: rows.length + ' transaction' + (rows.length === 1 ? '' : 's') + ' selected',
      specs: [{ k: 'acc', label: 'Move to account', type: 'select', full: true,
        opts: accounts.map(x => [x.id, x.label]).concat([['', '— Unassigned —']]) }],
      saveLabel: 'Assign', initial: { acc: ST.acc && ST.acc !== '__none' ? ST.acc : (accounts[0] || {}).id || '' },
      onSave(v) {
        rows.forEach(t => { if (v.acc) t.accountId = v.acc; else delete t.accountId; });
        runMatchAll(); ST.sel.clear(); render();
        toast('Moved ' + rows.length + ' to ' + (v.acc ? Q.bankAccountLabel(v.acc) : 'Unassigned'), 'ok');
      }
    });
    return;
  }
}

/* ── Phase 6: one-time backfill — give pre-multi-bank txns their account ──
   Matches each stored txn's import-time t.bank to a BANK_ACCOUNT (creating
   accounts for distinct banks that have none), stamps accountId, and re-runs
   matching so the account-scoped dedupe keys settle. Blank-bank rows stay
   Unassigned for the bulk "Assign account" action. Guarded by recon.backfillV
   so it runs once per company; a firm with zero accounts and a single distinct
   bank is left exactly as-is (single implicit account — no regression). */
function runBackfill() {
  try {
    const r = Q.recon;
    if (!r || r.backfillV || !(r.txns || []).length) return;
    if (!Q.bankAccounts || !RC.backfillPlan) return;
    const plan = RC.backfillPlan(r.txns, Q.bankAccounts());
    r.backfillV = 1;
    if (plan.skipped || (!plan.assigns.length && !plan.creates.length)) { Q.saveRecon(); return; }
    plan.creates.forEach(b => { const acc = Q.addBankAccount({ bank: b }); plan.map[b] = acc.id; });
    let n = 0;
    r.txns.forEach(t => { const b = (t.bank || '').trim(); if (!t.accountId && b && plan.map[b]) { t.accountId = plan.map[b]; n++; } });
    runMatchAll();   // saves + mirrors; account-scoped dedupe re-evaluated
    if (n) toast('Assigned ' + n + ' past transaction' + (n === 1 ? '' : 's') + ' to your bank accounts', 'ok');
  } catch (e) { console.warn('bank backfill skipped:', e); }
}

/* ══════════════════ MODALS ══════════════════ */
function overlay() { let b = document.getElementById('rcBack'); if (!b) { b = document.createElement('div'); b.id = 'rcBack'; document.body.appendChild(b); } b.className = 'rc-back'; b.onclick = e => { if (e.target === b) b.remove(); }; return b; }
/* ══════════════════ UPDATE PAYMENTS ══════════════════
   Reconciling LINKS a bank line to a bill. Until now nothing POSTED, so a
   matched invoice still read "Pending" and outstanding never moved. This is the
   apply step.

   Every decision lives in recon-apply.js (pure, Node-tested). This function
   only: builds the plan, SHOWS it, and — if the user says yes — hands it to the
   existing QLD mutations. The numbers in the dialog are read straight off
   plan.totals, so the thing the user agrees to is the thing that gets written;
   there is no second count anywhere that could disagree with it. */
function buildApplyPlan() {
  return RCApply.plan(monthTxns(), {
    // the PAGE's allocsOf, so a split can never mean two things in two files
    allocsOf: allocsOf,
    billOf: (kind, idx) => {
      const arr = kind === 'sale' ? Q.salesRows() : Q.purchaseRows();
      return arr.find(r => r.idx === idx) || null;
    }
  });
}
function openApply() {
  const pl = buildApplyPlan(), T = pl.totals;
  const b = overlay();
  const willPost = T.bills > 0;
  /* Styled inline on the existing tokens rather than with new classes:
     reconcile.css is shared, and a class that only this dialog uses would ship
     as a rule nobody else can see is dead. */
  const row = (n, label, col) => n ? `<div style="display:flex;align-items:baseline;gap:9px;padding:7px 0;border-bottom:1px solid var(--ql-border)">
    <b style="font-size:15px;min-width:38px;color:${col}">${n}</b><span style="font-size:12.5px;color:var(--ql-text)">${esc(label)}</span></div>` : '';

  b.innerHTML = `<div class="rc-modal"><div class="rc-modal-h"><div class="rc-modal-t">Update payments</div><button class="rc-modal-x" id="rcApX">&times;</button></div>
    <div class="rc-modal-b">
      <div style="font-size:12.5px;color:var(--ql-text);line-height:1.55;margin-bottom:12px">${willPost
        ? `This posts <b>${fC(T.amount)}</b> across <b>${T.bills}</b> bill${T.bills === 1 ? '' : 's'} for <b>${esc(monthLabel())}</b>. Statuses, outstanding, the cash book and each party's ledger all update.`
        : `Nothing to post for <b>${esc(monthLabel())}</b> — every line is already recorded, already posted, or still needs a human.`}</div>
      <div>
        ${row(T.paid, 'will be marked Paid', '#15803d')}
        ${row(T.partial, 'will be marked Partial (part-payments)', '#a16207')}
        ${row(T.skipEntry, 'already recorded in your cash book — skipped', '#0e7490')}
        ${row(T.skipPosted, 'already posted by an earlier run — skipped', '#0e7490')}
        ${row(T.skipLowConf, 'not confident enough — confirm them yourself first', '#a16207')}
        ${row(T.skipDuplicate, 'flagged as duplicates — skipped', '#b91c1c')}
        ${row(T.skipNoBill, 'unmatched — nothing to post', '#475569')}
      </div>
      ${T.skipEntry ? `<div class="rc-note">The ${T.skipEntry} already-recorded line${T.skipEntry === 1 ? '' : 's'} (freight, labour, EMI and the like) are payments you entered yourself. They are linked, never posted again — posting them would pay those parties twice in your books.</div>` : ''}
      ${T.excess > 0 ? `<div style="margin-top:14px;padding:11px 12px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa;font-size:12px;color:#7c2d12;line-height:1.55">
        <b>${fC(T.excess)} cannot be posted anywhere.</b> ${T.overpay} bank line${T.overpay === 1 ? ' is' : 's are'} bigger than the bill${T.overpay === 1 ? '' : 's'} they pay. Only the billed amount is posted — the rest stays unapplied. Record it as an advance, or link another bill.
        <ul style="margin:7px 0 0;padding-left:16px">${pl.overpay.slice(0, 6).map(o => `<li>${esc(fDS(o.date))} · ${esc(o.party || (o.desc || '').slice(0, 28))} — ${fC(o.bankAmount)} paid, ${fC(o.applied)} applied, <b>${fC(o.excess)} left over</b></li>`).join('')}${pl.overpay.length > 6 ? `<li>+${pl.overpay.length - 6} more</li>` : ''}</ul></div>` : ''}
      ${willPost ? `<div class="rc-note">This cannot be undone from here — reversing it means opening each bill and deleting the payment. Check the numbers above before you post.</div>` : ''}
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;padding:13px 20px;border-top:1px solid var(--ql-border)">
      <button class="rc-btn" id="rcApCancel">Cancel</button>
      ${willPost ? `<button class="rc-btn rc-btn-primary" id="rcApGo">${svg(IC.ck)}<span>Post ${T.bills} payment${T.bills === 1 ? '' : 's'}</span></button>` : ''}
    </div></div>`;

  const close = () => b.remove();
  document.getElementById('rcApX').onclick = close;
  document.getElementById('rcApCancel').onclick = close;
  const go = document.getElementById('rcApGo');
  if (go) go.onclick = () => {
    /* Disable FIRST, before any write. The whole hazard here is the second
       click, and the stamp only protects the run after this one. */
    go.disabled = true; go.innerHTML = '<span>Posting…</span>';
    const res = RCApply.applyPlan(pl, {
      Q: Q,
      cashIds: () => { try { return (Q.cashbookRows() || []).map(r => r.id); } catch (_) { return []; } }
    });
    Q.saveRecon();
    close(); render();
    if (res.errors.length) toast(res.bills + ' payment' + (res.bills === 1 ? '' : 's') + ' posted · ' + res.errors.length + ' failed — re-check those bills', 'warn');
    else toast('Posted ' + fC(res.amount) + ' · ' + res.paid + ' paid, ' + res.partial + ' partial', 'ok');
  };
}

function openUpload() {
  const b = overlay();
  b.innerHTML = `<div class="rc-modal"><div class="rc-modal-h"><div class="rc-modal-t">Upload bank statement</div><button class="rc-modal-x" id="rcUX">&times;</button></div>
    <div class="rc-modal-b">
      <label class="rc-drop" id="rcDrop"><input type="file" id="rcFile" accept=".csv,.xlsx,.xls,.pdf" hidden>
        <span class="rc-drop-ic">${svg(IC.up)}</span><b>Choose a file or drop it here</b><span class="rc-drop-s">PDF · Excel (.xlsx/.xls) · CSV — one row per transaction with Date, Debit/Credit &amp; Balance</span></label>
      <div id="rcUpMsg" class="rc-upmsg"></div>
      <div class="rc-note">Statement is read on your device. Credits match sales invoices, debits match purchase bills — for <b>${esc(Q.co.short || 'this firm')}</b>. Re-imports are detected as duplicates automatically.</div>
    </div></div>`;
  const close = () => b.remove();
  document.getElementById('rcUX').onclick = close;
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
        <div class="rc-pw-wrap">
          <input class="rc-pw-in" id="rcPw" type="password" autocomplete="off" placeholder="Statement password" aria-label="Statement password">
          <button type="button" class="rc-pw-eye" id="rcPwEye" aria-label="Show password" aria-pressed="false" title="Show password">${svg(IC.eye)}</button>
        </div>
        <button class="rc-btn rc-btn-primary" id="rcPwGo">Unlock</button>
      </div>
      <div class="rc-pw-n">Often your PAN, date of birth (DDMMYYYY), or customer ID — check the email the bank sent it in. It's used only on this device to open the file.</div>
    </div>`;
    const inp = document.getElementById('rcPw'), btn = document.getElementById('rcPwGo'), eye = document.getElementById('rcPwEye');
    inp.focus();
    // Reveal toggle — bank passwords are long (PAN+DOB), so let the user check it.
    // Restore focus + caret afterwards, otherwise switching type drops the cursor.
    eye.onclick = () => {
      const show = inp.type === 'password';
      const at = inp.selectionStart;
      inp.type = show ? 'text' : 'password';
      eye.innerHTML = svg(show ? IC.eyeOff : IC.eye);
      eye.setAttribute('aria-pressed', show ? 'true' : 'false');
      const lbl = show ? 'Hide password' : 'Show password';
      eye.setAttribute('aria-label', lbl); eye.setAttribute('title', lbl);
      inp.focus(); try { inp.setSelectionRange(at, at); } catch (_) {}
    };
    const submit = () => { const pw = inp.value; if (!pw) { inp.focus(); return; } go(f, pw); };
    btn.onclick = submit;
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
  };
  const go = async (f, password) => {
    if (!f) return;
    msg.innerHTML = `<div class="rc-loading">${password ? 'Unlocking' : 'Reading'} <b>${esc(f.name)}</b>…</div>`;

    /* Checked BEFORE parsing, so re-uploading a locked statement is refused
       without asking for its password again. */
    const sha = await sha256(f);
    const fv = ImportGuard.fileVerdict(sha, Q.statementRows ? Q.statementRows() : []);
    if (fv.dup) {
      const on = fv.of.uploadedAt ? new Date(fv.of.uploadedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      msg.innerHTML = `<div class="rc-err"><b>Upload failed — this file is already imported.</b><br>
        The same file was uploaded as <b>${esc(fv.of.file || 'a statement')}</b>${on ? ' on ' + esc(on) : ''}${fv.of.rows ? ' (' + fv.of.rows + ' transactions)' : ''}.
        Renaming a file does not make it a new statement.</div>`;
      return;
    }

    let parsed;
    try { parsed = await parseBankFile(f, password); }
    catch (e) {
      if (e && e.pw) { askPassword(f, e.pw === 2 || !!password); return; }
      msg.innerHTML = `<div class="rc-err">${esc(e.message || 'Could not read this file. Export it as CSV or Excel and try again.')}</div>`; return;
    }
    if (!parsed.length) { msg.innerHTML = `<div class="rc-err">No transactions found. Make sure the file has Date and Debit/Credit columns (or export as CSV).</div>`; return; }
    askAccount(f, parsed, sha);
  };
  /* SHA-256 of the file's BYTES. Renaming "statement.pdf" to "statement (1).pdf"
     does not change it, which is the point — that rename is exactly how the same
     statement gets imported twice. Needs a secure context (https/localhost); if
     crypto.subtle is missing we return '' and ImportGuard treats "no hash" as
     "cannot be certain" → the upload proceeds rather than being wrongly blocked. */
  const sha256 = async f => {
    try {
      if (!(crypto && crypto.subtle && f.arrayBuffer)) return '';
      const h = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
      return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) { return ''; }
  };

  const finishImport = (parsed, f, sha) => {
    /* THE GATE. Previously every parsed row was pushed and runMatchAll() then
       BADGED the repeats "Duplicate" — which is why one PRINCE LIME payment sat
       in the books three times. A badge is not a gate. Screen first, store after.
       Only a repeated reference drops (see import-guard.js); anything less certain
       is still imported and flagged, because a customer really can pay the same
       amount twice in one day and deleting the second would lose real money. */
    const scr = ImportGuard.screenTxns(parsed, Q.recon.txns);
    if (!scr.keep.length) {
      msg.innerHTML = `<div class="rc-err"><b>Nothing new to import.</b><br>All ${parsed.length} transaction${parsed.length === 1 ? '' : 's'} in this file ${parsed.length === 1 ? 'is' : 'are'} already in your books.</div>`;
      return;
    }
    Q.recon.txns.push(...scr.keep); runMatchAll();
    const matched = scr.keep.filter(t => isLinked(t)).length;
    if (Q.addStatement && f) {
      const ds = scr.keep.map(t => t.date).filter(Boolean).sort();
      Q.addStatement({ accountId: scr.keep[0].accountId || '', file: f.name, rows: scr.keep.length, from: ds[0] || '', to: ds[ds.length - 1] || '', sha: sha || '' });
    }
    close(); render();
    toast('Imported ' + scr.keep.length + ' transactions · ' + matched + ' auto-matched'
      + (scr.dropped.length ? ' · ' + scr.dropped.length + ' already imported, skipped' : ''), 'ok');
  };
  // Phase 2 (multi-bank): every statement imports INTO an account. detectBank
  // pre-selects the matching one; the user can pick another or create one
  // inline. "Continue without account" preserves the single-bank behaviour.
  const askAccount = (f, parsed, sha) => {
    const accounts = (Q.bankAccounts ? Q.bankAccounts() : []);
    const detected = parsed[0].bank || '';
    const hdr = parsed._hdr || { acctNo: '', ifsc: '' };
    if (!accounts.length && !detected && !hdr.acctNo) { finishImport(parsed, f, sha); return; }   // nothing to choose from — behave like today
    const dl = detected.toLowerCase();
    /* THE ACCOUNT NUMBER WINS. Two accounts at the same bank are the normal case
       (a Current and a CC/OD at Bank of Baroda), and a bank-NAME match cannot tell
       them apart — it just picks whichever comes first, which is a coin flip that
       mis-files half the statements. The number printed on the statement is the
       only thing that actually identifies the account, so it is tried first; the
       name match stays as the fallback it always was. accountByAcctNo returns null
       when it is not certain (unknown OR ambiguous), and then we simply ask. */
    const byNo = (RC.accountByAcctNo && hdr.acctNo) ? RC.accountByAcctNo(hdr.acctNo, accounts) : null;
    const hit = byNo
      || accounts.find(a => { const ab = (a.bank || '').toLowerCase(); return dl && ab && (ab.includes(dl) || dl.includes(ab)); })
      || accounts.find(a => dl && (a.label || '').toLowerCase().includes(dl));
    const pre = hit ? hit.id : (accounts.length === 1 ? accounts[0].id : '__new');
    msg.innerHTML = `<div class="rc-pw">
      <div class="rc-pw-head">${svg('<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>')}
        <div><div class="rc-pw-t">Which account is this statement from?</div>
        <div class="rc-pw-s">${parsed.length} transactions read from <b>${esc(f.name)}</b>${detected ? ' · looks like a <b>' + esc(detected) + '</b> statement' : ''}${hdr.acctNo ? ' for A/C <b>' + esc(hdr.acctNo) + '</b>' : ''}${byNo ? ' — matched to <b>' + esc(byNo.label) + '</b>' : ''}. Each account keeps its own balance.</div></div></div>
      <div class="rc-pw-row">
        <select class="rc-pw-in" id="rcAccSel" aria-label="Bank account">
          ${accounts.map(a => `<option value="${esc(a.id)}" ${a.id === pre ? 'selected' : ''}>${esc(a.label)}${a.acctNo ? ' · ··' + esc(String(a.acctNo).slice(-4)) : ''}</option>`).join('')}
          <option value="__new" ${pre === '__new' ? 'selected' : ''}>➕ Create new account…</option>
        </select>
        <button class="rc-btn rc-btn-primary" id="rcAccGo">Import</button>
      </div>
      <!-- Compact on purpose (this sits inside an upload dialog), but the account
           NUMBER is now here: without it every account born during an import had
           acctNo:'' for life, so it could never be auto-matched on the NEXT import
           and never showed its ··1234 suffix in any picker. Pre-filled from the
           statement header when we could read it. Optional — a statement whose
           header we cannot read must still import. -->
      <div class="rc-pw-row" id="rcAccNew" style="display:${pre === '__new' ? 'flex' : 'none'};gap:8px;flex-wrap:wrap">
        <input class="rc-pw-in" id="rcAccBank" placeholder="Bank name" value="${esc(detected)}" style="flex:2;min-width:120px">
        <input class="rc-pw-in" id="rcAccLabel" placeholder="Nickname (optional)" style="flex:2;min-width:120px">
        <select class="rc-pw-in" id="rcAccType" style="flex:1;min-width:90px">${Object.entries(Q.BANK_TYPES || { current: 'Current' }).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
        <input class="rc-pw-in" id="rcAccNo" placeholder="Account number (optional)" value="${esc(hdr.acctNo || '')}" style="flex:2;min-width:120px">
        <input class="rc-pw-in" id="rcAccIfsc" placeholder="IFSC (optional)" value="${esc(hdr.ifsc || '')}" style="flex:1;min-width:100px">
      </div>
      <div class="rc-pw-n">Manage accounts in Settings → Bank accounts. <a href="#" id="rcAccSkip">Continue without assigning an account</a></div>
    </div>`;
    const sel = document.getElementById('rcAccSel');
    sel.onchange = () => { document.getElementById('rcAccNew').style.display = sel.value === '__new' ? 'flex' : 'none'; };
    document.getElementById('rcAccSkip').onclick = e => { e.preventDefault(); finishImport(parsed, f, sha); };
    document.getElementById('rcAccGo').onclick = () => {
      let accId = sel.value;
      if (accId === '__new') {
        const bank = document.getElementById('rcAccBank').value.trim();
        if (!bank) { document.getElementById('rcAccBank').focus(); return; }
        const acc = Q.addBankAccount({ bank, label: document.getElementById('rcAccLabel').value.trim(), type: document.getElementById('rcAccType').value,
          acctNo: document.getElementById('rcAccNo').value.trim(), ifsc: document.getElementById('rcAccIfsc').value.trim().toUpperCase() });
        accId = acc.id;
      }
      parsed.forEach(t => { t.accountId = accId; });
      finishImport(parsed, f, sha);
    };
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
  // An internal transfer is money moving BETWEEN own accounts — posting it to a
  // party would fabricate income/expense, so it is excluded from every ledger.
  if (RC.isSelfLeg && RC.isSelfLeg(t)) { toast('This is a transfer between your own accounts — it never counts as income or expense', 'warn'); return false; }
  const isCr = (t.credit || 0) > 0, amt = isCr ? t.credit : t.debit;
  const p = Q.partyRows().find(x => x.idx === pidx); if (!p) return false;
  const entry = { date: t.date, ref: t.utr || t.ref || '', mode: 'Bank', accountId: t.accountId || '', desc: (label || ('Bank ' + (isCr ? 'receipt' : 'payment'))) + (t.desc ? ' · ' + String(t.desc).slice(0, 36) : '') };
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
  if ($('rcApply')) $('rcApply').onclick = openApply;
  if ($('rcExport')) $('rcExport').onclick = exportRecon;
  if ($('rcLedgerExp')) $('rcLedgerExp').onclick = exportLedger;
  root.querySelectorAll('[data-ledger]').forEach(row => row.onclick = () => {
    const nm = row.dataset.ledger, ps = Q.partyRows(); const norm = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const p = ps.find(x => norm(x.name) === norm(nm)); if (p) location.href = './ledger.html?party=' + p.idx;
  });
  if ($('rcAiReview')) $('rcAiReview').onclick = () => { ST.fstatus = 'review'; render(); };
  root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { ST.view = b.dataset.view; render(); });
  if ($('rcAudSearch')) { const i = $('rcAudSearch'); i.oninput = () => { ST.aq = i.value; const p = document.querySelector('.rc-panel'); if (p) { p.innerHTML = viewHTML(); wire(); const j = $('rcAudSearch'); if (j) { j.focus(); j.setSelectionRange(j.value.length, j.value.length); } } }; }
  root.querySelectorAll('[data-ftype]').forEach(b => b.onclick = () => { ST.ftype = b.dataset.ftype; render(); });
  /* Filters. render() rebuilds the toolbar, so these rebind every paint — the
     same pattern the tab buttons above already use. */
  /* Fold a month shut. Bound before the row-open handler and stopping
     propagation, or clicking the header would also try to open a transaction
     drawer for a row that does not exist. */
  root.querySelectorAll('.qx-grp[data-grp]').forEach(g => g.onclick = e => {
    e.stopPropagation();
    const k = g.dataset.grp;
    if (ST.collapsed.has(k)) ST.collapsed.delete(k); else ST.collapsed.add(k);
    render();
  });
  if ($('rcFilBtn')) $('rcFilBtn').onclick = () => { ST.advOpen = !ST.advOpen; render(); };
  if ($('rcFilClear')) $('rcFilClear').onclick = () => { advReset(); render(); };
  root.querySelectorAll('#rcAdv [data-fk]').forEach(el => el.onchange = () => { ST.adv[el.dataset.fk] = el.value; render(); });
  /* Dates and amounts use change, not input: re-rendering on every keystroke of a
     number would steal focus mid-typing — the same bug that made the invoice
     form drop characters. */
  root.querySelectorAll('#rcAdv [data-dk]').forEach(el => el.onchange = () => { ST.adv[el.dataset.dk] = el.value; render(); });
  root.querySelectorAll('[data-fstatus]').forEach(b => b.onclick = () => { ST.fstatus = b.dataset.fstatus; ST.stOpen = false; render(); });
  /* The status dropdown. stopPropagation so the open click does not immediately
     reach the click-away closer below — the same trap the month picker hit. */
  if ($('rcStBtn')) $('rcStBtn').onclick = e => { e.stopPropagation(); ST.stOpen = !ST.stOpen; render(); };
  if (!window.__rcStAway) {
    window.__rcStAway = 1;   // bound once per page load — wire() runs on every render
    document.addEventListener('click', e => {
      if (ST.stOpen && !e.target.closest('.rc-stwrap')) { ST.stOpen = false; render(); }
      /* The date popover needs the same closer, and for the same reason. */
      if (ST.dOpen && !e.target.closest('.rc-dwrap')) { ST.dOpen = false; render(); }
    });
  }
  root.querySelectorAll('[data-facc]').forEach(b => b.onclick = () => { ST.acc = b.dataset.facc; ST.sel.clear(); render(); });
  /* Repaint the panel, keep the caret where the user left it — same shape as the
     recon search below. */
  const lgRepaint = () => { const p = document.querySelector('.rc-panel'); if (p) { p.innerHTML = viewHTML(); wire(); const i = $('rcLgSearch'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } } };
  if ($('rcLgSearch')) { const i = $('rcLgSearch'); i.oninput = () => { ST.lq = i.value; lgRepaint(); }; }
  if ($('rcLgSort')) { const sel = $('rcLgSort'); sel.onchange = () => { ST.lsort = sel.value; lgRepaint(); }; }
  document.querySelectorAll('[data-lfilter]').forEach(b => { b.onclick = () => { ST.lfilter = b.dataset.lfilter; lgRepaint(); }; });
  if ($('rcLgClear')) $('rcLgClear').onclick = () => { ST.lq = ''; ST.lfilter = 'all'; lgRepaint(); };
  if ($('rcSearch')) { const s = $('rcSearch'); s.oninput = () => { ST.q = s.value; ST.cap = 300; repaintList(); s2focus(); }; }
  /* ── date range ── */
  if ($('rcExFirst')) $('rcExFirst').onclick = () => { ST.exFirst = !ST.exFirst; ST.cap = 300; render(); };
  if ($('rcDBtn')) $('rcDBtn').onclick = e => { e.stopPropagation(); ST.dOpen = !ST.dOpen; ST.stOpen = false; render(); };
  (document.querySelectorAll('[data-dpre]') || []).forEach(b => b.onclick = e => {
    e.stopPropagation();
    const [f, t] = b.dataset.dpre.split('|');
    ST.dFrom = f; ST.dTo = t; ST.dOpen = false; ST.cap = 300; render();
  });
  ['rcDFrom', 'rcDTo'].forEach(id => { const el = $(id); if (el) {
    el.onclick = e => e.stopPropagation();
    el.onchange = () => {
      const f = ($('rcDFrom') || {}).value || '', t = ($('rcDTo') || {}).value || '';
      /* A backwards range silently shows nothing, which reads as "no data".
         Swap it instead — the user meant the span between the two dates. */
      ST.dFrom = (f && t && f > t) ? t : f;
      ST.dTo   = (f && t && f > t) ? f : t;
      ST.cap = 300; render();
    };
  } });
  if ($('rcDClear')) $('rcDClear').onclick = e => { e.stopPropagation(); ST.dFrom = ST.dTo = ''; ST.dOpen = false; render(); };
  root.querySelectorAll('[data-link]').forEach(b => b.onclick = () => openLink(b.dataset.link));
  root.querySelectorAll('[data-unlink]').forEach(b => b.onclick = () => { const t = txns().find(x => x.id === b.dataset.unlink); if (t) { t.m = { kind: (t.credit || 0) > 0 ? 'sale' : 'purchase', idx: null, status: 'unmatched' }; Q.saveRecon(); render(); } });
  root.querySelectorAll('[data-mark]').forEach(b => b.onclick = e => openMark(b.dataset.mark, e.currentTarget));
  root.querySelectorAll('.rc-review').forEach(b => b.onclick = e => { e.stopPropagation(); openDetail(b.dataset.open); });
  root.querySelectorAll('[data-more]').forEach(b => b.onclick = e => { e.stopPropagation(); openKebab(b.dataset.more, e.currentTarget); });
  /* v3: clicking a row EXPANDS it inline (details unfold under the row, no
     navigation); the Review button is the path to the full side drawer. */
  root.querySelectorAll('.rc-clk[data-open]').forEach(tr => tr.addEventListener('click', e => {
    if (e.target.closest('button,a,input,select')) return;
    const id = tr.dataset.open;
    ST.expanded.has(id) ? ST.expanded.delete(id) : ST.expanded.add(id);
    repaintList();
  }));
  root.querySelectorAll('[data-showmore]').forEach(b => b.onclick = () => { ST.cap += 300; repaintList(); });
  // selection + bulk bar
  root.querySelectorAll('[data-sel]').forEach(b => b.onclick = e => { e.stopPropagation(); const id = b.dataset.sel; ST.sel.has(id) ? ST.sel.delete(id) : ST.sel.add(id); render(); });
  root.querySelectorAll('[data-bulk]').forEach(b => b.onclick = () => bulkAction(b.dataset.bulk));
  // financial-overview accordion — persist open/closed across re-renders
  const fo = root.querySelector('.rc-fo'); if (fo) fo.addEventListener('toggle', () => { ST.foOpen = fo.open; });
}
function s2focus() { const s = document.getElementById('rcSearch'); if (s) { s.focus(); const v = s.value; s.value = ''; s.value = v; } }
/* THE STICKY OFFSET, measured — not guessed.
   The toolbar WRAPS (status pills + Filters + search + Ledger): one line on a
   wide screen, three on a narrow one, so its height is 56px…200px. A hard-coded
   `top` for the table header is therefore wrong at most widths — too small and
   the header slides under the toolbar, too large and a white band opens between
   them. That band is the "header / sub-header gap". Measure the real element and
   publish it as --rc-tb-h; re-measure on resize. */
function syncStickyOffset() {
  const tb = document.querySelector('.rc-toolbar2');
  if (!tb) return;
  const h = Math.round(tb.getBoundingClientRect().height);
  if (h > 0) document.documentElement.style.setProperty('--rc-tb-h', h + 'px');
  /* Watch the toolbar itself. A window-resize listener alone is not enough: the
     toolbar also rewraps when its own content changes (a filter chip appears, the
     count text grows) with no window resize at all — and a measurement taken
     while the pane is still laying out would stick forever. ResizeObserver
     re-measures on every real height change, so the header always pins flush. */
  if (!window.__rcRO && typeof ResizeObserver === 'function') {
    window.__rcRO = new ResizeObserver(() => {
      const el = document.querySelector('.rc-toolbar2'); if (!el) return;
      const hh = Math.round(el.getBoundingClientRect().height);
      if (hh > 0) document.documentElement.style.setProperty('--rc-tb-h', hh + 'px');
    });
  }
  if (window.__rcRO) { try { window.__rcRO.disconnect(); window.__rcRO.observe(tb); } catch (_) {} }

}

/* Guarded: this file is also loaded head-less by the recon test suites, whose
   stubbed `window` has no addEventListener — an unguarded call here would throw
   at PARSE time and take the whole page (and every test) down with it. */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('resize', () => { clearTimeout(window.__rcSyncT); window.__rcSyncT = setTimeout(syncStickyOffset, 120); });
}
/* Repaint the list AND the summary cards together. The cards now total the
   FILTERED set, so refreshing only the panel (the old behaviour) would leave
   them describing a list that is no longer on screen. */
function repaintList() {
  const p = document.querySelector('.rc-panel');
  if (!p) { render(); return; }
  p.innerHTML = viewHTML();
  /* Must match the class summaryHTML() actually renders. When the strip was
     renamed this selector was left behind: `s` came back null, the `if (s)`
     guard swallowed it, and the totals silently stopped following the filters
     while still looking authoritative. */
  const s = document.querySelector('.rc-summary2');
  if (s) s.outerHTML = summaryHTML();
  wire();
  syncStickyOffset();
}

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
  const tt = monthTxns();   // month + account scoped, same as every other block
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
window.__qlOnSwitchCompany = () => { ST.monthInit = false; ST.acc = ''; runBackfill(); render(); };   // shell owns the switch
// Deep-links: ?upload=1 (e.g. "Upload statement" on the Loans page) opens the
// upload modal after the first paint; ?acc=<id> (a Banks-overview card) lands
// with that account's chip pre-selected. Both fire once.
let _autoUpload = /[?&]upload=/.test(location.search);
const _autoAcc = (location.search.match(/[?&]acc=([^&]+)/) || [])[1];
if (_autoAcc) { try { ST.acc = decodeURIComponent(_autoAcc); } catch (_) {} }   // validated by accBarHTML
if (Q.init) Q.init(() => { runBackfill(); render(); if (_autoUpload) { _autoUpload = false; try { openUpload(); } catch (_) {} } }); else render();

/* build rd7: ask for the password on a locked bank statement instead of showing pdf.js raw error */

/* build rd8: eye toggle on the statement password field */

/* build rd9: statement imports into a chosen bank account (multi-bank Phase 2) */

/* build rd10: account chips scope the whole Reconcile screen (multi-bank Phase 3) */

/* build rd11: one-time account backfill + bulk Assign account (multi-bank Phase 6) */

/* build rd12: ?upload=1 deep-link; clear-all note removed (dedupe handles re-imports) */

/* build rd13: ?acc= deep-link from Banks cards */

/* build rd14: internal_transfer tag + self-leg posting guard + record-as-EMI */
