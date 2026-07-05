/* ═══════════════════════════════════════════════════════════════
   QuickLimes v2 — Finance + GST Portal engine (QLFin)
   Client-side finance intelligence layer for Gotan Lime Industries:
   • Bank-statement parsing (CSV / Excel / best-effort PDF)
   • AI (rule-based) transaction classification
   • De-duplication + merge of 2 current accounts
   • Sales / purchase matching against QLD data
   • GST tracking + filing status (month-wise)
   • CA document vault (files in IndexedDB, metadata in the synced blob)
   • Plain-language insights + report builders
   Depends on QLD (data.js) being loaded first. Document *files* live in
   IndexedDB (per browser); everything else rides the QLD per-company blob
   so it persists locally now and syncs to the server once live.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (!window.QLD) { console.error('QLFin: QLD not loaded'); return; }

  const CATS = ['Sales Receipt', 'Purchase Payment', 'Supplier Payment', 'Customer Payment',
    'GST Payment', 'GST Refund', 'Salary', 'Transport', 'Cash Withdrawal', 'Bank Charges',
    'Loan / EMI', 'Other', 'Needs Review'];
  const CREDIT_CATS = ['Sales Receipt', 'Customer Payment', 'GST Refund'];
  const DEBIT_CATS = ['Purchase Payment', 'Supplier Payment', 'GST Payment', 'Salary',
    'Transport', 'Cash Withdrawal', 'Bank Charges', 'Loan / EMI'];

  let _seq = 0;
  const uid = () => 'ftx' + Date.now().toString(36) + (_seq++).toString(36);

  /* ── Value parsers ─────────────────────────────────────────────── */
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function parseDate(s) {
    s = (s == null ? '' : s).toString().trim();
    if (!s) return '';
    // Excel serial date number
    if (/^\d{5}(\.\d+)?$/.test(s)) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + Math.round(parseFloat(s)) * 86400000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
    let m;
    if ((m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/)))
      return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if ((m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/))) {
      let [, d, mo, y] = m; if (y.length === 2) y = '20' + y;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    if ((m = s.match(/^(\d{1,2})[\/\-\s]([A-Za-z]{3,})[\/\-\s](\d{2,4})/))) {
      const mo = MON[m[2].slice(0, 3).toLowerCase()]; let y = m[3]; if (y.length === 2) y = '20' + y;
      if (mo) return `${y}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return '';
  }
  function parseNum(s) {
    if (typeof s === 'number') return s;
    s = (s == null ? '' : s).toString().replace(/[₹,\s]/g, '');
    if (!s || s === '-') return 0;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.replace(/[()]/g, ''); }
    if (/(dr|cr)$/i.test(s)) s = s.replace(/(dr|cr)$/i, '');
    const v = parseFloat(s);
    return isNaN(v) ? 0 : (neg ? -v : v);
  }

  /* ── CSV parser (quoted-field aware) ───────────────────────────── */
  function parseCSV(text) {
    const rows = []; let i = 0, field = '', row = [], inQ = false;
    while (i < text.length) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
          if (c === '\r' && text[i + 1] === '\n') i++;
          row.push(field); rows.push(row); row = []; field = '';
        } else field += c;
      }
      i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(x => (x || '').toString().trim() !== ''));
  }

  /* ── Lazy CDN loaders (Excel + PDF) ────────────────────────────── */
  const _loaded = {};
  function loadScript(src, key) {
    if (_loaded[key]) return _loaded[key];
    _loaded[key] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + key));
      document.head.appendChild(s);
    });
    return _loaded[key];
  }
  const loadXLSX = () => loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'xlsx');
  async function loadPDF() {
    if (window.pdfjsLib) return window.pdfjsLib;
    await loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js', 'pdfjs');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    return window.pdfjsLib;
  }

  /* ── File → rows[] ─────────────────────────────────────────────── */
  function readAsText(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); }); }
  function readAsBuffer(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(file); }); }

  async function fileToRows(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.csv') || file.type === 'text/csv') return { rows: parseCSV(await readAsText(file)), kind: 'csv' };
    if (name.endsWith('.xlsx') || name.endsWith('.xls') || /sheet|excel/.test(file.type)) {
      await loadXLSX();
      const wb = window.XLSX.read(await readAsBuffer(file), { type: 'array', cellDates: false, raw: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return { rows: window.XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }), kind: 'xlsx' };
    }
    if (name.endsWith('.pdf') || file.type === 'application/pdf') return { rows: await pdfToRows(file), kind: 'pdf' };
    // last resort: try CSV/TSV text
    const txt = await readAsText(file);
    return { rows: parseCSV(txt.indexOf('\t') > -1 ? txt.replace(/\t/g, ',') : txt), kind: 'txt' };
  }

  // Best-effort PDF row extraction: pull text lines, keep those that start with
  // a date and contain amounts. Bank PDFs vary wildly — flagged "review" in UI.
  async function pdfToRows(file) {
    const pdfjs = await loadPDF();
    const doc = await pdfjs.getDocument({ data: await readAsBuffer(file) }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // group text items into visual lines by y-position
      const byY = {};
      content.items.forEach(it => {
        const y = Math.round(it.transform[5]);
        (byY[y] = byY[y] || []).push({ x: it.transform[4], s: it.str });
      });
      Object.keys(byY).map(Number).sort((a, b) => b - a).forEach(y => {
        const line = byY[y].sort((a, b) => a.x - b.x).map(o => o.s).join(' ').replace(/\s+/g, ' ').trim();
        if (line) lines.push(line);
      });
    }
    const out = [['Date', 'Narration', 'Amount', 'Balance']];
    const dre = /^(\d{1,2}[\/\-][A-Za-z0-9]{1,3}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/;
    const amt = /-?[\d,]+\.\d{2}/g;
    lines.forEach(l => {
      if (!dre.test(l)) return;
      const nums = l.match(amt);
      if (!nums || !nums.length) return;
      const date = l.match(dre)[0];
      const balance = nums[nums.length - 1];
      const amount = nums.length > 1 ? nums[nums.length - 2] : '';
      const narr = l.replace(dre, '').replace(amt, '').replace(/\s+/g, ' ').trim().slice(0, 80);
      out.push([date, narr, amount, balance]);
    });
    return out;
  }

  /* ── Header detection + column mapping ─────────────────────────── */
  function findHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const cells = (rows[i] || []).map(c => (c || '').toString().toLowerCase());
      const has = (...kw) => cells.some(c => kw.some(k => c.includes(k)));
      if (has('date') && (has('debit', 'withdrawal', 'withdrawl', 'dr', 'paid out', 'amount')) && has('balance'))
        return i;
    }
    return -1;
  }
  function mapCols(header) {
    const idx = (...kws) => header.findIndex(h => { const c = (h || '').toString().toLowerCase().trim(); return kws.some(k => c.includes(k)); });
    return {
      date: idx('value date', 'txn date', 'tran date', 'transaction date', 'date'),
      narr: idx('narration', 'description', 'particular', 'remarks', 'details', 'transaction remarks', 'transaction'),
      debit: idx('withdrawal', 'withdrawl', 'debit', 'paid out', 'dr amount', 'dr'),
      credit: idx('deposit', 'credit', 'paid in', 'cr amount', 'cr'),
      amount: idx('amount'),
      balance: idx('closing balance', 'balance'),
      ref: idx('utr', 'ref no', 'reference', 'rrn', 'chq/ref', 'transaction id'),
      cheque: idx('cheque', 'chq', 'instrument')
    };
  }

  // Turn a raw rows[] into parsed txns using detected columns. Returns a preview.
  function extract(rows) {
    const hi = findHeader(rows);
    if (hi < 0) return { ok: false, reason: 'no-header', header: rows[0] || [], txns: [] };
    const header = rows[hi].map(c => (c || '').toString());
    const map = mapCols(header);
    if (map.date < 0) return { ok: false, reason: 'no-date', header, map, txns: [] };
    const txns = [];
    for (let r = hi + 1; r < rows.length; r++) {
      const row = rows[r]; if (!row) continue;
      const cell = i => (i >= 0 && i < row.length) ? row[i] : '';
      const date = parseDate(cell(map.date));
      if (!date) continue;
      let debit = map.debit >= 0 ? Math.abs(parseNum(cell(map.debit))) : 0;
      let credit = map.credit >= 0 ? Math.abs(parseNum(cell(map.credit))) : 0;
      if (!debit && !credit && map.amount >= 0) {
        const a = parseNum(cell(map.amount)); if (a < 0) debit = Math.abs(a); else credit = a;
      }
      if (!debit && !credit) continue;
      txns.push({
        date, narr: (cell(map.narr) || '').toString().replace(/\s+/g, ' ').trim(),
        debit, credit, bal: map.balance >= 0 ? parseNum(cell(map.balance)) : null,
        ref: (cell(map.ref) || '').toString().trim(), cheque: (cell(map.cheque) || '').toString().trim()
      });
    }
    return { ok: true, header, map, txns };
  }

  /* ── Classification (rule-based AI) ────────────────────────────── */
  function partyIndex() {
    const rows = QLD.partyRows();
    const norm = s => (s || '').toUpperCase().replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|INDUSTRIES|MINERALS|CHEMICAL|CHEMICALS|AND|THE|CO)\b/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    return rows.map(p => ({ name: p.name, type: p.type, tokens: norm(p.name).split(' ').filter(t => t.length >= 4) }));
  }
  function matchParty(narr, parties, kind) {
    const N = (narr || '').toUpperCase();
    let best = null;
    parties.forEach(p => {
      if (kind === 'customer' && !(p.type === 'customer' || p.type === 'both')) return;
      if (kind === 'supplier' && !(p.type === 'supplier' || p.type === 'both')) return;
      const hits = p.tokens.filter(t => N.includes(t)).length;
      if (hits && (!best || hits > best.hits)) best = { name: p.name, hits };
    });
    return best ? best.name : '';
  }
  function classify(t, parties) {
    const n = (t.narr || '').toUpperCase();
    const isCr = t.credit > 0;
    // Match at a word boundary START so prefixes still hit ("TRANSPORT" →
    // "TRANSPORTATION") but a keyword can't match mid-word ("EMI" must NOT
    // fire inside "CHEMICAL"). Plain includes() caused exactly that bug.
    const test = (...ks) => ks.some(k => new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(n));
    let cat = 'Needs Review', match = '';
    if (test('GST', 'CGST', 'SGST', 'IGST', 'GSTN')) cat = (isCr || test('REFUND', 'RFND')) ? 'GST Refund' : 'GST Payment';
    else if (test('SALARY', 'WAGES', 'PAYROLL', 'STIPEND')) cat = 'Salary';
    else if (test('TRANSPORT', 'FREIGHT', 'TRUCK', 'LOGISTIC', 'CARRIER', 'CARTAGE', 'ROADLINE', 'ROADWAYS')) cat = 'Transport';
    else if (test('ATM', 'CASH WDL', 'CASH WITHDRAWAL', 'CASHWDL', 'SELF', 'CASH DEP')) cat = 'Cash Withdrawal';
    else if (test('EMI', 'LOAN', 'NACH', 'ECS', 'MANDATE', 'REPAYMENT')) cat = 'Loan / EMI';
    else if (test('CHRG', 'CHARGE', 'CHARGES', 'COMMISSION', 'SMS CHG', 'AMC', 'GST ON', 'FOLIO', 'PENAL', 'MIN BAL')) cat = 'Bank Charges';
    else {
      if (isCr) { const c = matchParty(n, parties, 'customer'); if (c) { cat = 'Customer Payment'; match = c; } }
      else { const s = matchParty(n, parties, 'supplier'); if (s) { cat = 'Supplier Payment'; match = s; } }
    }
    return { cat, match };
  }

  /* ── De-dup + import ───────────────────────────────────────────── */
  const keyOf = t => [t.acc, t.date, t.debit || 0, t.credit || 0, (t.ref || t.narr || '').toString().slice(0, 24).toUpperCase()].join('|');
  function importTxns(accId, list) {
    const F = QLD.finance;
    const seen = new Set(F.txns.map(keyOf));
    const parties = partyIndex();
    let added = 0, dupes = 0;
    list.forEach(t => {
      const rec = { id: uid(), acc: accId, date: t.date, ym: (t.date || '').slice(0, 7), narr: t.narr || '', debit: +t.debit || 0, credit: +t.credit || 0, bal: (t.bal == null ? null : +t.bal), ref: t.ref || '', cheque: t.cheque || '', cat: t.cat || '', match: t.match || '', note: '' };
      const k = keyOf(rec);
      if (seen.has(k)) { dupes++; return; }
      if (!rec.cat) { const c = classify(rec, parties); rec.cat = c.cat; rec.match = c.match; }
      seen.add(k); F.txns.push(rec); added++;
    });
    F.txns.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    QLD.saveFinance();
    return { added, dupes };
  }
  function reclassifyAll() {
    const parties = partyIndex();
    QLD.finance.txns.forEach(t => { const c = classify(t, parties); t.cat = c.cat; t.match = c.match; });
    QLD.saveFinance();
  }
  function setTxn(id, patch) { const t = QLD.finance.txns.find(x => x.id === id); if (t) { Object.assign(t, patch); QLD.saveFinance(); } return t; }
  function deleteTxn(id) { const F = QLD.finance; const i = F.txns.findIndex(x => x.id === id); if (i >= 0) { F.txns.splice(i, 1); QLD.saveFinance(); } }
  function findDuplicates() {
    const seen = {}, dups = [];
    QLD.finance.txns.forEach(t => { const k = keyOf(t); if (seen[k]) dups.push(t); else seen[k] = t; });
    return dups;
  }

  /* ── Aggregates ────────────────────────────────────────────────── */
  function accBalance(accId) {
    const F = QLD.finance, a = F.accounts.find(x => x.id === accId);
    const rows = F.txns.filter(t => t.acc === accId).slice().sort((x, y) => (x.date || '').localeCompare(y.date || '') || (x.id < y.id ? -1 : 1));
    if (rows.length && rows[rows.length - 1].bal != null) return rows[rows.length - 1].bal;
    const net = rows.reduce((s, t) => s + (t.credit || 0) - (t.debit || 0), 0);
    return (a ? a.opening || 0 : 0) + net;
  }
  function sumCat(cats, side) {
    return QLD.finance.txns.filter(t => cats.includes(t.cat)).reduce((s, t) => s + (side === 'credit' ? (t.credit || 0) : (t.debit || 0)), 0);
  }
  function summary() {
    const F = QLD.finance;
    const inflow = F.txns.reduce((s, t) => s + (t.credit || 0), 0);
    const outflow = F.txns.reduce((s, t) => s + (t.debit || 0), 0);
    const salesRecv = sumCat(['Customer Payment', 'Sales Receipt'], 'credit');
    const purchasePaid = sumCat(['Supplier Payment', 'Purchase Payment'], 'debit');
    const pendSales = QLD.state.SALES.filter(s => (s.status || 'pending') === 'pending');
    const pendPur = QLD.purchaseRows().filter(p => p.status === 'pending');
    const custOut = pendSales.reduce((a, s) => a + QLD.cS(s).tot, 0);
    const supOut = pendPur.reduce((a, p) => a + p.total, 0);
    const overdue = pendSales.filter(s => QLD.daysAgo(s.date) > 30).reduce((a, s) => a + QLD.cS(s).tot, 0);
    return {
      inflow, outflow, netCash: inflow - outflow, salesRecv, purchasePaid,
      custOut, supOut, pendingBills: pendPur.length + pendSales.length, overdue,
      accounts: F.accounts.map(a => ({ id: a.id, label: a.label, bank: a.bank, balance: accBalance(a.id), count: F.txns.filter(t => t.acc === a.id).length })),
      txnCount: F.txns.length, needsReview: F.txns.filter(t => t.cat === 'Needs Review').length,
      gstPaid: sumCat(['GST Payment'], 'debit'), gstRefund: sumCat(['GST Refund'], 'credit')
    };
  }
  function byCategory() {
    const m = {}; CATS.forEach(c => m[c] = { cat: c, credit: 0, debit: 0, count: 0 });
    QLD.finance.txns.forEach(t => { const c = m[t.cat] || (m[t.cat] = { cat: t.cat, credit: 0, debit: 0, count: 0 }); c.credit += t.credit || 0; c.debit += t.debit || 0; c.count++; });
    return Object.values(m).filter(c => c.count).sort((a, b) => (b.credit + b.debit) - (a.credit + a.debit));
  }
  // Customer-wise / supplier-wise outstanding (from QLD sales/purchases)
  function customerOutstanding() {
    const by = {};
    QLD.salesRows().filter(r => r.status === 'pending').forEach(r => {
      const k = r.party || '—'; (by[k] = by[k] || { party: k, amount: 0, count: 0, oldest: 0 });
      by[k].amount += r.total; by[k].count++; by[k].oldest = Math.max(by[k].oldest, r.days);
    });
    return Object.values(by).sort((a, b) => b.amount - a.amount);
  }
  function supplierOutstanding() {
    const by = {};
    QLD.purchaseRows().filter(r => r.status === 'pending').forEach(r => {
      const k = r.sup || '—'; (by[k] = by[k] || { party: k, amount: 0, count: 0, oldest: 0 });
      by[k].amount += r.total; by[k].count++; by[k].oldest = Math.max(by[k].oldest, r.days);
    });
    return Object.values(by).sort((a, b) => b.amount - a.amount);
  }

  /* ── GST tracking (month-wise) ─────────────────────────────────── */
  const STATUSES = ['Pending', 'Sent to CA', 'Filed', 'Refund Pending', 'Refund Received'];
  function gstMonths() {
    const F = QLD.finance;
    const months = new Set();
    QLD.state.SALES.forEach(s => s.date && months.add(s.date.slice(0, 7)));
    QLD.state.PURCHASES.forEach(p => p.date && months.add(p.date.slice(0, 7)));
    F.txns.forEach(t => { if (['GST Payment', 'GST Refund'].includes(t.cat) && t.ym) months.add(t.ym); });
    Object.keys(F.gst || {}).forEach(m => months.add(m));
    return [...months].filter(Boolean).sort().reverse().map(ym => {
      const sal = QLD.state.SALES.filter(s => (s.date || '').slice(0, 7) === ym);
      const pur = QLD.state.PURCHASES.filter(p => (p.date || '').slice(0, 7) === ym);
      const collected = sal.reduce((a, s) => { const c = QLD.cS(s); return a + c.cgst + c.sgst; }, 0);
      const itc = pur.reduce((a, p) => a + (p.taxable * p.grate / 100) * ((p.itc === 'Eligible' || p.itc === 'RCM') ? 1 : 0), 0);
      const paidBank = F.txns.filter(t => t.cat === 'GST Payment' && t.ym === ym).reduce((a, t) => a + t.debit, 0);
      const refundBank = F.txns.filter(t => t.cat === 'GST Refund' && t.ym === ym).reduce((a, t) => a + t.credit, 0);
      const rec = F.gst[ym] || {};
      const net = Math.max(0, collected - itc);
      const [y, mo] = ym.split('-');
      return {
        ym, label: new Date(+y, +mo - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
        collected, itc, net, paidBank, refundBank,
        refundPending: +rec.refundPending || 0,
        status: rec.status || 'Pending', note: rec.note || ''
      };
    });
  }
  function setGst(ym, patch) { const F = QLD.finance; F.gst[ym] = Object.assign({}, F.gst[ym], patch); QLD.saveFinance(); }

  /* ── CA document vault (files → IndexedDB, meta → blob) ────────── */
  const CHECKLIST = [
    ['bank1', 'Bank Statement — Account 1'], ['bank2', 'Bank Statement — Account 2'],
    ['sales', 'Sales invoices uploaded'], ['purchase', 'Purchase bills uploaded'],
    ['gst', 'GST data uploaded'], ['sent', 'Documents sent to CA'],
    ['confirm', 'CA confirmation received'], ['filed', 'GST filed'],
    ['refund', 'GST refund status updated']
  ];
  const DOC_KINDS = ['Bank Statement', 'Sales Invoices', 'Purchase Bills', 'GST Return', 'GST Challan', 'GST Refund Doc', 'TDS Document', 'Ledger Report', 'Expense Receipt', 'Other'];

  const DB_NAME = 'ql_fin_docs';
  let _dbP = null;
  function idb() {
    if (_dbP) return _dbP;
    _dbP = new Promise((res, rej) => {
      const rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = e => { const db = e.target.result; if (!db.objectStoreNames.contains('files')) db.createObjectStore('files'); };
      rq.onsuccess = e => res(e.target.result);
      rq.onerror = () => rej(rq.error);
    });
    return _dbP;
  }
  async function idbOp(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('files', mode), st = tx.objectStore('files');
      const out = fn(st);
      tx.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      tx.onerror = () => rej(tx.error);
    });
  }
  function caMonth(ym) {
    const F = QLD.finance;
    if (!F.ca[ym]) F.ca[ym] = { checklist: {}, filing: 'Pending', docs: [] };
    if (!F.ca[ym].docs) F.ca[ym].docs = [];
    if (!F.ca[ym].checklist) F.ca[ym].checklist = {};
    return F.ca[ym];
  }
  async function addDoc(ym, kind, file) {
    const m = caMonth(ym);
    const id = 'doc' + Date.now().toString(36) + (_seq++).toString(36);
    await idbOp('readwrite', st => st.put(file, id));
    m.docs.push({ id, name: file.name, kind, type: file.type || '', size: file.size, at: new Date().toISOString() });
    // auto-tick the matching checklist item
    if (kind === 'Bank Statement') { /* user picks acc separately */ }
    QLD.saveFinance();
    return m.docs[m.docs.length - 1];
  }
  async function getDocBlob(id) { return idbOp('readonly', st => st.get(id)); }
  async function downloadDoc(doc) {
    const blob = await getDocBlob(doc.id); if (!blob) { alert('File not found in this browser'); return; }
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = doc.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  async function deleteDoc(ym, id) {
    const m = caMonth(ym); const i = m.docs.findIndex(d => d.id === id);
    if (i >= 0) { m.docs.splice(i, 1); QLD.saveFinance(); }
    try { await idbOp('readwrite', st => st.delete(id)); } catch (_) {}
  }
  function setChecklist(ym, key, val) { const m = caMonth(ym); m.checklist[key] = val; QLD.saveFinance(); }
  function setFiling(ym, status) { const m = caMonth(ym); m.filing = status; QLD.saveFinance(); }
  function caProgress(ym) { const m = caMonth(ym); const done = CHECKLIST.filter(([k]) => m.checklist[k]).length; return { done, total: CHECKLIST.length, pct: Math.round(done / CHECKLIST.length * 100) }; }

  /* ── AI insights (plain language) ──────────────────────────────── */
  const fC = QLD.fC;
  function thisMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
  function insights() {
    const s = summary(), out = [];
    const dups = findDuplicates();
    if (dups.length) out.push({ icon: 'warn', tone: 'warn', title: `${dups.length} possible duplicate transaction${dups.length > 1 ? 's' : ''}`, body: 'Same date, amount and reference appear more than once. Review before sharing with your CA.' });
    if (s.needsReview) out.push({ icon: 'tag', tone: 'info', title: `${s.needsReview} transaction${s.needsReview > 1 ? 's need' : ' needs'} a category`, body: 'These couldn\'t be auto-classified. Assign a category so reports stay accurate.' });
    const co = customerOutstanding();
    if (co.length) { const top = co[0]; out.push({ icon: 'rupee', tone: co[0].oldest > 30 ? 'warn' : 'info', title: `Pending customer payments: ${fC(s.custOut)}`, body: `${co.length} customer${co.length > 1 ? 's' : ''} outstanding. Largest: ${top.party} — ${fC(top.amount)}${top.oldest > 30 ? ` (overdue ${top.oldest}d)` : ''}.` }); }
    const so = supplierOutstanding();
    if (so.length) { const top = so[0]; out.push({ icon: 'bill', tone: 'info', title: `Supplier bills due: ${fC(s.supOut)}`, body: `${so.length} supplier${so.length > 1 ? 's' : ''} to pay. Largest: ${top.party} — ${fC(top.amount)}.` }); }
    // missing CA docs for current month
    const ym = thisMonth(), prog = caProgress(ym);
    if (prog.done < prog.total) { const m = caMonth(ym); const miss = CHECKLIST.filter(([k]) => !m.checklist[k]).map(([, l]) => l); out.push({ icon: 'folder', tone: 'info', title: `CA checklist ${prog.pct}% ready for this month`, body: 'Still missing: ' + miss.slice(0, 3).join(', ') + (miss.length > 3 ? ` +${miss.length - 3} more` : '') + '.' }); }
    // cash-flow plain language
    const flowWord = s.netCash >= 0 ? 'positive' : 'negative';
    out.push({ icon: 'flow', tone: s.netCash >= 0 ? 'ok' : 'warn', title: `Cash flow is ${flowWord}`, body: `Across both accounts, ${fC(s.inflow)} came in and ${fC(s.outflow)} went out — a net of ${fC(s.netCash)}. Combined balance ${fC(s.accounts.reduce((a, x) => a + x.balance, 0))}.` });
    return out;
  }

  /* ── Report builders (CSV / print) ─────────────────────────────── */
  const inMonth = (d, ym) => !ym || (d || '').slice(0, 7) === ym;
  function report(type, ym) {
    const F = QLD.finance; let title = type, headers = [], rows = [], totals = null;
    if (type === 'cashflow') {
      title = 'Monthly Cash Flow';
      headers = ['Date', 'Account', 'Narration', 'Category', 'In', 'Out', 'Balance'];
      const t = F.txns.filter(x => inMonth(x.date, ym)).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      rows = t.map(x => [x.date, accLabel(x.acc), x.narr, x.cat, x.credit || '', x.debit || '', x.bal == null ? '' : x.bal]);
      totals = ['', '', '', 'Net', t.reduce((a, x) => a + x.credit, 0), t.reduce((a, x) => a + x.debit, 0), ''];
    } else if (type === 'collection') {
      title = 'Sales Collection'; headers = ['Date', 'Customer', 'Narration', 'Amount Received'];
      const t = F.txns.filter(x => CREDIT_CATS.includes(x.cat) && x.cat !== 'GST Refund' && inMonth(x.date, ym));
      rows = t.map(x => [x.date, x.match || '—', x.narr, x.credit]);
      totals = ['', '', 'Total', t.reduce((a, x) => a + x.credit, 0)];
    } else if (type === 'payment') {
      title = 'Purchase Payments'; headers = ['Date', 'Supplier', 'Narration', 'Amount Paid'];
      const t = F.txns.filter(x => ['Supplier Payment', 'Purchase Payment'].includes(x.cat) && inMonth(x.date, ym));
      rows = t.map(x => [x.date, x.match || '—', x.narr, x.debit]);
      totals = ['', '', 'Total', t.reduce((a, x) => a + x.debit, 0)];
    } else if (type === 'custout') {
      title = 'Customer Outstanding'; headers = ['Customer', 'Invoices', 'Oldest (days)', 'Outstanding'];
      const c = customerOutstanding(); rows = c.map(x => [x.party, x.count, x.oldest, x.amount]);
      totals = ['Total', c.reduce((a, x) => a + x.count, 0), '', c.reduce((a, x) => a + x.amount, 0)];
    } else if (type === 'supout') {
      title = 'Supplier Outstanding'; headers = ['Supplier', 'Bills', 'Oldest (days)', 'Outstanding'];
      const c = supplierOutstanding(); rows = c.map(x => [x.party, x.count, x.oldest, x.amount]);
      totals = ['Total', c.reduce((a, x) => a + x.count, 0), '', c.reduce((a, x) => a + x.amount, 0)];
    } else if (type === 'gstrefund') {
      title = 'GST Refund'; headers = ['Month', 'GST Collected', 'ITC', 'Net GST', 'Refund Received', 'Refund Pending', 'Status'];
      const g = gstMonths(); rows = g.map(x => [x.label, x.collected, x.itc, x.net, x.refundBank, x.refundPending, x.status]);
    } else if (type === 'gststatus') {
      title = 'GST Filing Status'; headers = ['Month', 'Net GST', 'GST Paid (bank)', 'Status', 'Note'];
      const g = gstMonths(); rows = g.map(x => [x.label, x.net, x.paidBank, x.status, x.note]);
    } else if (type === 'missing') {
      title = 'Missing Documents'; headers = ['Month', 'Missing item'];
      Object.keys(F.ca).sort().reverse().forEach(m => { const cm = caMonth(m); CHECKLIST.forEach(([k, l]) => { if (!cm.checklist[k]) rows.push([caLabel(m), l]); }); });
      if (!rows.length) rows.push([caLabel(thisMonth()), 'All items complete 🎉']);
    } else if (type === 'unmatched') {
      title = 'Unmatched Transactions'; headers = ['Date', 'Account', 'Narration', 'In', 'Out', 'Category'];
      const t = F.txns.filter(x => x.cat === 'Needs Review');
      rows = t.map(x => [x.date, accLabel(x.acc), x.narr, x.credit || '', x.debit || '', x.cat]);
    }
    return { title, headers, rows, totals };
  }
  function accLabel(id) { const a = QLD.finance.accounts.find(x => x.id === id); return a ? a.label : id; }
  function caLabel(ym) { if (!ym) return ''; const [y, m] = ym.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }); }

  /* ── Public API ────────────────────────────────────────────────── */
  window.QLFin = {
    CATS, CREDIT_CATS, DEBIT_CATS, STATUSES, CHECKLIST, DOC_KINDS,
    fileToRows, extract, parseDate, parseNum,
    importTxns, reclassifyAll, setTxn, deleteTxn, findDuplicates,
    summary, byCategory, customerOutstanding, supplierOutstanding, accBalance, accLabel,
    gstMonths, setGst,
    caMonth, caProgress, caLabel, addDoc, downloadDoc, deleteDoc, setChecklist, setFiling,
    insights, report, thisMonth
  };
})();
