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
  // Sniff the delimiter from the first non-empty line: Excel in some regions
  // exports semicolons, Google Sheets/exports use tabs, some use pipes.
  function sniffDelimiter(text) {
    const line = (text.split(/\r?\n/).find(l => l.trim() !== '') || '');
    const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 }; let inQ = false;
    for (const ch of line) { if (ch === '"') inQ = !inQ; else if (!inQ && counts[ch] != null) counts[ch]++; }
    let best = ',', n = 0;
    for (const d in counts) if (counts[d] > n) { n = counts[d]; best = d; }
    return best;
  }
  function parseCSV(text, delim) {
    delim = delim || ',';
    const rows = []; let i = 0, field = '', row = [], inQ = false;
    while (i < text.length) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === delim) { row.push(field); field = ''; }
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
    const name = (file.name || '').toLowerCase(), type = file.type || '';
    // Photos / scans can't be read as a table.
    if (/^image\//.test(type) || /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/.test(name)) return { rows: [], kind: 'image' };
    if (name.endsWith('.pdf') || type === 'application/pdf') return { rows: await pdfToRows(file), kind: 'pdf' };
    if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xlsm') || /sheet|excel|ms-excel/.test(type)) {
      await loadXLSX();
      const wb = window.XLSX.read(await readAsBuffer(file), { type: 'array', cellDates: false, raw: false });
      // Pick the sheet with the most rows — skips empty cover/summary sheets.
      let best = [], bestN = -1;
      wb.SheetNames.forEach(nm => { const r = window.XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, blankrows: false, defval: '' }); if (r.length > bestN) { bestN = r.length; best = r; } });
      return { rows: best, kind: 'xlsx' };
    }
    // csv / tsv / txt — auto-detect the delimiter (comma / semicolon / tab / pipe)
    const txt = await readAsText(file);
    return { rows: parseCSV(txt, sniffDelimiter(txt)), kind: 'csv' };
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

  /* ── x-position-aware bank-statement table from a digital PDF ─────
     pdfToRows() flattens columns to [Date,Narration,Amount,Balance], which
     LOSES the Withdrawal-vs-Deposit distinction — every transaction then
     imports as a credit. This extractor keeps each text item's x position,
     locates the column headers (WITHDRAWAL/DEPOSIT/BALANCE…), and assigns
     every numeric token to its nearest column, so Dr/Cr survive. Wrapped
     narration lines (no date, no amount-column tokens) are appended to the
     previous transaction. Balance keeps its Cr/Dr suffix for sign checks. */
  async function pdfBankTable(file) {
    const pdfjs = await loadPDF();
    const doc = await pdfjs.getDocument({ data: await readAsBuffer(file) }).promise;
    const out = [['Date', 'Narration', 'Cheque', 'Debit', 'Credit', 'Balance']];
    let cols = null;                        // header anchors: [{key, x}] using label right edges
    let pending = null;                     // dated line still waiting for its amounts
    const NUMRE = /^-?[\d,]+\.?\d*(\s*(CR|DR))?\.?$/i;
    const DATERE = /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/;
    for (let p = 1; p <= Math.min(doc.numPages, 300); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const byY = {};
      content.items.forEach(it => {
        const s = (it.str || '').trim(); if (!s) return;
        const y = Math.round(it.transform[5] / 2) * 2;      // absorb 1-2px baseline jitter
        (byY[y] = byY[y] || []).push({ x: it.transform[4], w: it.width || 0, s });
      });
      const lines = Object.keys(byY).map(Number).sort((a, b) => b - a).map(y => byY[y].sort((a, b) => a.x - b.x));
      for (const rawItems of lines) {
        // pdf.js may pack several words into ONE item ("22/06/2026 22/06/2026")
        // — split every item into word tokens with proportionally interpolated
        // x positions, so dates/amounts are detected regardless of packing.
        const items = [];
        rawItems.forEach(o => {
          const parts = o.s.split(/\s+/).filter(Boolean);
          if (parts.length <= 1) { items.push(o); return; }
          let cursor = 0;
          parts.forEach(pt => {
            const idx = o.s.indexOf(pt, cursor); cursor = idx + pt.length;
            items.push({ x: o.x + (o.w || 0) * (idx / o.s.length), w: (o.w || 0) * (pt.length / o.s.length), s: pt });
          });
        });
        const text = items.map(o => o.s).join(' ').replace(/\s+/g, ' ').trim();
        const U = text.toUpperCase();
        if (!cols) {
          if (/(WITHDRAW|DEBIT|\(DR\))/.test(U) && /(DEPOSIT|CREDIT|\(CR\))/.test(U) && /BALANCE/.test(U)) {
            const edge = re => { const it = items.find(o => re.test(o.s.toUpperCase())); return it ? it.x + (it.w || 0) : null; };
            cols = [];
            const push = (key, x) => { if (x != null) cols.push({ key, x }); };
            push('debit', edge(/WITHDRAW|DEBIT|\(DR\)/)); push('credit', edge(/DEPOSIT|CREDIT|\(CR\)/));
            push('balance', edge(/BALANCE/)); push('cheque', edge(/CHQ|CHEQUE|INSTRUMENT/));
          }
          continue;
        }
        const nearest = o => {               // nearest column by right-edge distance; far tokens = narration
          const r = o.x + (o.w || 0); let best = null, bd = 1e9;
          cols.forEach(c => { const d = Math.abs(r - c.x); if (d < bd) { bd = d; best = c.key; } });
          return bd <= 60 ? best : 'narr';
        };
        // leading date(s): BoB prints TRAN DATE + VALUE DATE — take the first, skip both
        let di = 0; while (di < items.length && DATERE.test(items[di].s)) di++;
        const dateTok = di > 0 ? items[0].s : null;
        const rest = items.slice(di);
        const cells = { debit: '', credit: '', balance: '', cheque: '' };
        const narrParts = [];
        rest.forEach(o => {
          const raw = (o.s || '').trim();
          // A standalone "Dr"/"Cr" is the SIGN for the balance to its left — glue
          // it on so signedBalance() can read it (else the whole chain unsigns and
          // the direction inference can silently invert the statement).
          if (/^(cr|dr)\.?$/i.test(raw)) {
            if (cells.balance && !/(cr|dr)/i.test(cells.balance)) cells.balance += raw.replace(/\.$/, '');
            return;                          // amount-column indicators are redundant (column already implies dir)
          }
          const isNum = NUMRE.test(raw.replace(/\s+/g, ''));
          const col = isNum ? nearest(o) : 'narr';
          if (col !== 'narr' && !cells[col]) cells[col] = raw;
          else narrParts.push(raw);
        });
        if (!dateTok) {
          // A dated line without amounts may be waiting for THIS line to carry
          // them (some layouts put the figures beside the wrapped 2nd line).
          if (pending && (cells.debit || cells.credit)) {
            pending[1] = (pending[1] + ' ' + narrParts.join(' ')).replace(/\s+/g, ' ').trim();
            pending[2] = pending[2] || cells.cheque; pending[3] = cells.debit; pending[4] = cells.credit; pending[5] = cells.balance || pending[5];
            out.push(pending); pending = null; continue;
          }
          // continuation line: text only, nothing landed in an amount column
          if (narrParts.length && !cells.debit && !cells.credit && !cells.balance) {
            if (pending) pending[1] = (pending[1] + ' ' + narrParts.join(' ')).replace(/\s+/g, ' ').trim();
            else if (out.length > 1) { const last = out[out.length - 1]; last[1] = (last[1] + ' ' + narrParts.join(' ')).replace(/\s+/g, ' ').trim(); }
          }
          continue;
        }
        pending = null;                                       // a new dated line supersedes any unfinished one
        if (!cells.debit && !cells.credit) {                  // amounts may follow on the next visual line
          pending = [dateTok, narrParts.join(' ').trim(), cells.cheque, '', '', cells.balance];
          continue;
        }
        out.push([dateTok, narrParts.join(' ').trim(), cells.cheque, cells.debit, cells.credit, cells.balance]);
      }
    }
    return out.length > 1 ? out : null;      // null → caller falls back to the generic path
  }

  /* ── OCR (Tesseract.js) — read a photo/PDF of a bill on-device ──── */
  const loadTesseract = () => loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js', 'tesseract').then(() => window.Tesseract);
  // Pull embedded text from a digital PDF (no OCR) — one entry per page, with
  // visual lines reconstructed by y-position so labels line up with their values.
  async function pdfPages(file) {
    const pdfjs = await loadPDF();
    const doc = await pdfjs.getDocument({ data: await readAsBuffer(file) }).promise;
    const pages = [];
    for (let p = 1; p <= Math.min(doc.numPages, 200); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const byY = {};
      content.items.forEach(it => { const y = Math.round(it.transform[5]); (byY[y] = byY[y] || []).push({ x: it.transform[4], s: it.str }); });
      let text = '';
      Object.keys(byY).map(Number).sort((a, b) => b - a).forEach(y => { const line = byY[y].sort((a, b) => a.x - b.x).map(o => o.s).join(' ').replace(/\s+/g, ' ').trim(); if (line) text += line + '\n'; });
      pages.push(text);
    }
    return pages;
  }
  // pdf-lib (separate from pdf.js) — splits a multi-bill PDF into single-page
  // PDFs so each imported bill can carry its own page as the uploaded document.
  const loadPdfLib = () => loadScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js', 'pdflib').then(() => window.PDFLib);
  // Extract the given 0-based page indexes as individual single-page PDF Files
  // (aligned 1:1 with pageIndexes; a page that fails to copy yields null).
  async function splitPdfPages(file, pageIndexes, baseName) {
    const PDFLib = await loadPdfLib();
    const src = await PDFLib.PDFDocument.load(await readAsBuffer(file));
    const out = [];
    for (const i of pageIndexes) {
      try {
        const doc = await PDFLib.PDFDocument.create();
        const [pg] = await doc.copyPages(src, [i]);
        doc.addPage(pg);
        const bytes = await doc.save();
        out.push(new File([bytes], (baseName || 'bill') + '-p' + (i + 1) + '.pdf', { type: 'application/pdf' }));
      } catch (_) { out.push(null); }
    }
    return out;
  }
  async function pdfText(file) { return (await pdfPages(file)).join('\n'); }
  // Render each PDF page to a PNG data URL (Tesseract reads images, not PDFs).
  async function pdfToImages(file, scale) {
    const pdfjs = await loadPDF();
    const doc = await pdfjs.getDocument({ data: await readAsBuffer(file) }).promise;
    const imgs = [];
    for (let p = 1; p <= Math.min(doc.numPages, 10); p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: scale || 2 });
      const canvas = document.createElement('canvas'); canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      imgs.push(canvas.toDataURL('image/png'));
    }
    return imgs;
  }
  async function ocrScan(file, onProgress) {
    const T = await loadTesseract();
    const name = (file.name || '').toLowerCase(), type = file.type || '';
    const images = (name.endsWith('.pdf') || type === 'application/pdf') ? await pdfToImages(file, 2) : [file];
    let text = '';
    for (let i = 0; i < images.length; i++) {
      const { data } = await T.recognize(images[i], 'eng', { logger: onProgress || (() => {}) });
      text += '\n' + (data.text || '');
    }
    return Object.assign({ _text: text }, parseInvoiceText(text));
  }
  // Best-effort field extraction from noisy OCR text. Returns GENERIC keys
  // (docno,date,name,gstin,taxable,total,rate); each page maps them to its own.
  // Collapse a phrase that's the same thing twice — the "Billed to | Shipped to"
  // side-by-side columns make names extract as "JAIDEV ASSOCIATES JAIDEV ASSOCIATES".
  function dedupePhrase(s) {
    const w = (s || '').trim().split(/\s+/);
    if (w.length >= 2 && w.length % 2 === 0) { const h = w.length / 2; if (w.slice(0, h).join(' ').toLowerCase() === w.slice(h).join(' ').toLowerCase()) return w.slice(0, h).join(' '); }
    return s;
  }
  // Our own firms — so the parser treats us as the BUYER, never the supplier.
  function ownInfo() {
    const g = [], n = [];
    const pm = {};
    const norm = s => String(s || '').toUpperCase().replace(/\s/g, '');
    const selfGstin = (window.QLD && QLD.co && QLD.co.gstin) ? norm(QLD.co.gstin) : '';
    if (window.QLD) {
      if (QLD.co) { if (QLD.co.gstin) g.push(QLD.co.gstin); if (QLD.co.short) n.push(QLD.co.short); if (QLD.co.name) n.push(QLD.co.name); }
      // Own firms are also valid COUNTERPARTIES on inter-firm bills (Gotan ↔
      // Deshwali), so map each own GSTIN → its legal name in the party master.
      Object.values(QLD.COMPANIES || {}).forEach(c => {
        if (c.gstin) g.push(c.gstin);
        if (c.short) n.push(c.short); if (c.name) n.push(c.name);
        if (c.gstin && (c.name || c.short)) pm[norm(c.gstin)] = c.name || c.short;
      });
    }
    // Party master (GSTIN → official name) from the user's own supplier list, so a
    // known/corrected supplier auto-resolves on future bills (grows the built-in seed).
    // Skip implausible names (declaration fragments saved under the old buggy
    // parser, e.g. "the buyer. For") — they'd re-poison every future bill.
    const sane = nm => !(window.BillOCR && BillOCR.plausibleName) || BillOCR.plausibleName(nm);
    try { (window.QLD && QLD.partyRows ? QLD.partyRows() : []).forEach(p => { if (p.gstin && p.name && sane(p.name)) pm[norm(p.gstin)] = p.name; }); } catch (_) {}
    // active company first in ownGstins (parser uses it as "self" for inter-firm)
    if (selfGstin) g.sort((a, b) => (norm(a) === selfGstin ? -1 : norm(b) === selfGstin ? 1 : 0));
    return { ownGstins: g, ownNames: n, selfGstin: selfGstin, aliases: billAliases(), partyMaster: pm };
  }
  // Learned supplier corrections: normalized header line → canonical name.
  function billAliasKey() { const co = (window.QLD && QLD.activeCo) || 'x'; return 'ql_bill_aliases_' + co; }
  function billAliases() { try { return JSON.parse(localStorage.getItem(billAliasKey()) || '{}'); } catch (_) { return {}; } }
  function learnBillAlias(headerLine, supplier) {
    if (!headerLine || !supplier) return;
    const k = (headerLine || '').toString().toUpperCase().replace(/\s+/g, ' ').trim();
    if (!k) return; const a = billAliases(); a[k] = supplier;
    try { localStorage.setItem(billAliasKey(), JSON.stringify(a)); } catch (_) {}
  }
  function parseInvoiceText(text) {
    // Delegate to the pure, unit-tested BillOCR engine when present. It fixes
    // the label-as-value bug, tells seller from buyer, and blanks unclear
    // fields (needs-review) instead of guessing.
    if (window.BillOCR && window.BillOCR.parse) { try { return window.BillOCR.legacy(window.BillOCR.parse(text, ownInfo())); } catch (_) {} }
    const T = (text || '').replace(/\r/g, ''), up = T.toUpperCase(), out = {};
    const lines = T.split('\n').map(l => l.trim()).filter(Boolean);
    // GSTIN(s) — the party's is the one that isn't ANY of our own plants'.
    const gstins = up.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]\b/g) || [];
    const ownG = new Set();
    if (window.QLD) { if (QLD.co && QLD.co.gstin) ownG.add(QLD.co.gstin.toUpperCase()); Object.values(QLD.COMPANIES || {}).forEach(c => c.gstin && ownG.add(c.gstin.toUpperCase())); }
    const partyG = gstins.find(g => !ownG.has(g));
    if (partyG) out.gstin = partyG;
    // Invoice/bill number — prefer a "No/#/number"-labelled value containing a digit.
    let doc = '', re = /(?:invoice|bill|inv|voucher)\s*(?:no\.?|number|#)\s*[:\-.]?\s*([A-Za-z0-9][A-Za-z0-9\/\-]{1,18})/ig, mm;
    while ((mm = re.exec(T))) { if (/\d/.test(mm[1])) { doc = mm[1]; break; } }
    if (!doc) { re = /(?:invoice|bill|inv|voucher)\s*[:\-.]?\s*([A-Za-z0-9\/\-]*\d[A-Za-z0-9\/\-]*)/ig; while ((mm = re.exec(T))) { if (/\d/.test(mm[1])) { doc = mm[1]; break; } } }
    if (doc) out.docno = doc.replace(/[^A-Za-z0-9\/\-]/g, '');
    // Date — a REAL d/m/y (month 1-12 or a name); rejects "1/2026-27". Prefer "Date"/"Dated".
    const MON = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
    const dre = new RegExp('(\\d{1,2})[\\/\\-. ]{1,2}(\\d{1,2}|' + MON + ')[a-z]*[\\/\\-. ]{1,2}(\\d{2,4})', 'ig');
    const pick = scope => { dre.lastIndex = 0; let d; while ((d = dre.exec(scope))) { const day = +d[1], named = /[a-z]/i.test(d[2]), mo = named ? 1 : +d[2]; if (day >= 1 && day <= 31 && (named || (mo >= 1 && mo <= 12))) return d[0].replace(/\s+/g, ' ').trim(); } return ''; };
    const near = T.match(/\bdate[d]?\b\s*[:\-]?\s*([^\n]{0,22})/i);
    const dt = (near && pick(near[1])) || pick(T);
    if (dt) out.date = dt;
    const amts = s => (s.match(/[\d,]+\.\d{2}/g) || []).map(n => +n.replace(/,/g, ''));
    // Grand total — the largest rupee amount on the "grand total" line.
    const gl = lines.find(l => /grand\s*total/i.test(l));
    if (gl) { const n = amts(gl); if (n.length) out.total = String(Math.max.apply(null, n)); }
    if (!out.total) { const g = T.match(/(?:invoice value|total amount|net amount|amount payable)[^0-9\-]{0,12}([0-9][0-9,]*\.?[0-9]{0,2})/i); if (g) out.total = g[1].replace(/,/g, ''); }
    // Quantity — "<qty> Tonne/MT" (on the grand-total line, else anywhere).
    let qm = (gl || '').match(/([\d,]+\.?\d*)\s*(?:tonne|mt|kgs?|nos|ton)\b/i) || T.match(/([\d,]+\.\d{1,3})\s*(?:tonne|mt|ton)\b/i);
    if (qm) out.qty = qm[1].replace(/,/g, '');
    // Taxable — the subtotal shown right before "Add : CGST/IGST", else a labelled value.
    const ai = lines.findIndex(l => /^add\s*[:.]?\s*(c?gst|igst|sgst)/i.test(l));
    if (ai > 0) for (let j = ai - 1; j >= Math.max(0, ai - 3); j--) { const n = amts(lines[j]); if (n.length) { out.taxable = String(Math.max.apply(null, n)); break; } }
    if (!out.taxable) { const g = T.match(/(?:taxable\s*(?:value|amt|amount)|basic\s*(?:value|amount))[^0-9\-]{0,12}([0-9][0-9,]*\.?[0-9]{0,2})/i); if (g) out.taxable = g[1].replace(/,/g, ''); }
    // GST rate — whole-number rate ("5%") from the HSN summary, else IGST/GST %.
    let m = up.match(/\b(5|12|18|28|3)\s?%/); if (!m) m = up.match(/i?gst\s*@?\s*(\d{1,2})(?:\.0+)?\s*%/i);
    if (m) out.rate = m[1];
    // Vehicle number (e.g. RJ 09 GE 0425).
    m = up.match(/\b([A-Z]{2}[\s\-]?\d{1,2}[\s\-]?[A-Z]{1,3}[\s\-]?\d{3,4})\b/); if (m) out.veh = m[1].replace(/[\s\-]/g, '');
    // Party name — "Billed to"/Buyer next line → labelled → M/s → near party GSTIN.
    const BAD = /road|street|nagar|\bdist\b|state|\bpin\b|mobile|phone|gstin|invoice|hsn|ward|tehsil|khasara|rajasthan|gujarat|india|shipped|^\d|\d{6}/i;
    let nm = '';
    const bi = lines.findIndex(l => /^(billed\s*to|bill\s*to|buyer|consignee)\b/i.test(l));
    if (bi >= 0) { let a = lines[bi].replace(/^(billed\s*to|bill\s*to|buyer|consignee)\b\s*:?\s*/i, '').trim(); if ((!a || a.length < 3) && lines[bi + 1]) a = lines[bi + 1].trim(); a = dedupePhrase(a); if (a && !BAD.test(a)) nm = a; }
    if (!nm) { m = T.match(/(?:party\s*name|customer(?:\s*name)?|name\s*of\s*(?:party|customer|buyer))\s*[:\-]?\s*([A-Za-z][A-Za-z0-9 &.,'()\-]{2,40})/i); if (m && !BAD.test(m[1])) nm = dedupePhrase(m[1]); }
    if (!nm) { const ml = lines.find(l => /^m\/?s\.?\s+\S/i.test(l)); if (ml) nm = dedupePhrase(ml.replace(/^m\/?s\.?\s+/i, '')); }
    if (!nm && partyG) { const gi = lines.findIndex(l => l.toUpperCase().includes(partyG)); if (gi >= 0) for (let j = gi; j >= Math.max(0, gi - 4); j--) { const cand = dedupePhrase(lines[j].replace(/gstin.*/i, '').trim()); if (cand.length >= 3 && cand.length <= 40 && /[A-Za-z]{3}/.test(cand) && !BAD.test(cand)) { nm = cand; break; } } }
    if (nm) out.name = nm.replace(/[.,;:]+$/, '').trim().slice(0, 40);
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

  /* ── Generic spreadsheet-import helpers (shared by Sales/Purchase) ── */
  // Find the header row: `groups` is a list of keyword-groups, ALL must match
  // (each group is an OR of keywords). Skips bank/register preamble rows.
  function findHeaderRow(rows, groups) {
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const cells = (rows[i] || []).map(c => (c || '').toString().toLowerCase());
      if (groups.every(g => cells.some(c => g.some(k => c.includes(k))))) return i;
    }
    return -1;
  }
  const colOf = (header, ...kws) => header.findIndex(h => { const c = (h || '').toString().toLowerCase().trim(); return kws.some(k => c.includes(k)); });
  // First row that looks like data/header (>=2 non-empty cells) — skips title rows.
  function firstDataRow(rows) { for (let i = 0; i < rows.length; i++) { if ((rows[i] || []).filter(c => (c || '').toString().trim() !== '').length >= 2) return i; } return 0; }

  // Reusable import wizard: file → find header → auto-map columns → (if any
  // required column is unmatched) show a manual column-mapper → preview →
  // dedup (cfg.keyOf/existing) → bulk cfg.add → cfg.done(count).
  // cfg: {title,sub,dropTitle,dropSub,tip,accept,noun,
  //   fields:[{key,label,required}], requireOneOf:[[key,...]],
  //   headerGroups, autoMap:header=>({key:idx}), buildRow:get=>item|null,
  //   existing,keyOf, preview:{headers,right,row}, add, done, errText}
  function importSheet(cfg) {
    const noun = cfg.noun || 'row';
    const plural = n => noun + (n === 1 ? '' : 's');
    const esc = s => (s == null ? '' : s).toString().replace(/[<>]/g, '');
    let el = document.getElementById('qlfImportSheet');
    if (!el) {
      el = document.createElement('div'); el.id = 'qlfImportSheet'; el.className = 'fin-sheet';
      el.innerHTML = '<div class="fin-sheet-card"><div class="fin-sheet-head"><div><div class="fin-sheet-title" id="qlfImpTitle"></div><div class="fin-sheet-sub" id="qlfImpSub"></div></div><button class="fin-x" id="qlfImpX">&times;</button></div><div class="fin-sheet-body" id="qlfImpBody"></div></div>';
      document.body.appendChild(el);
      el.addEventListener('click', e => { if (e.target.id === 'qlfImportSheet') el.hidden = true; });
      el.querySelector('#qlfImpX').addEventListener('click', () => { el.hidden = true; });
    }
    document.getElementById('qlfImpTitle').textContent = cfg.title || 'Import';
    document.getElementById('qlfImpSub').textContent = cfg.sub || '';
    document.getElementById('qlfImpBody').innerHTML =
      '<label class="fin-drop" id="qlfDrop"><div class="fin-drop-inner">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
      '<div><b>' + (cfg.dropTitle || 'Choose a file') + '</b><div class="fin-drop-sub">' + (cfg.dropSub || '.csv, .xlsx or .xls') + '</div></div></div>' +
      '<input type="file" id="qlfFile" accept="' + (cfg.accept || '.csv,.xlsx,.xls') + '" hidden></label>' +
      (cfg.tip ? '<div class="fin-note">' + cfg.tip + '</div>' : '') +
      ((cfg.ocr && window.BillOCR && ocrDevMode()) ? '<button class="ocr2-runbtn" id="qlfRunSuite">🧪 Run Import Test Suite (' + (window.BillOCR.SAMPLES || []).length + ' sample bills)</button>' : '') +
      '<div id="qlfImpResult"></div>';
    el.hidden = false;
    if (document.getElementById('qlfRunSuite')) document.getElementById('qlfRunSuite').onclick = () => { ocr2css(); runOcrSuite(); };
    const drop = document.getElementById('qlfDrop'), file = document.getElementById('qlfFile');
    const go = f => f && handle(f);
    file.onchange = () => go(file.files[0]);
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); go(e.dataTransfer.files[0]); });

    const res = () => document.getElementById('qlfImpResult');
    const displayHeader = row => (row || []).map((c, i) => { const t = (c || '').toString().trim(); return t || ('Column ' + (i + 1)); });
    function complete(m) {
      if ((cfg.fields || []).some(f => f.required && (m[f.key] == null || m[f.key] < 0))) return false;
      if ((cfg.requireOneOf || []).some(g => !g.some(k => m[k] != null && m[k] >= 0))) return false;
      return true;
    }

    async function handle(f) {
      res().innerHTML = '<div class="fin-up-loading">Reading <b>' + esc(f.name) + '</b>…</div>';
      const name = (f.name || '').toLowerCase(), type = f.type || '';
      const isImg = /^image\//.test(type) || /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/.test(name);
      const isPdf = name.endsWith('.pdf') || type === 'application/pdf';
      // OCR-enabled registers treat a photo or single-bill PDF as a "scan".
      if (cfg.ocr && isImg) { ocrOffer(f); return; }
      if (cfg.ocr && isPdf) {
        // Prefer the PDF's own embedded text (digital invoice) — instant, accurate,
        // no OCR download. Each page is one bill: 2+ pages → bulk import; 1 → review;
        // no embedded text (scanned PDF) → fall back to Tesseract OCR.
        let pages = [];
        try { pages = await pdfPages(f); } catch (e) {}
        const hasText = pages.filter(t => t && /\d/.test(t) && t.replace(/\s+/g, '').length > 60);
        if (hasText.length) {
          // Keep each parsed bill tied to the page it came from, so we can split
          // that page out and attach it to the bill as its real uploaded copy.
          const built = [];
          pages.forEach((t, i) => { const b = ocrBuild(parseInvoiceText(t)); if (b) built.push({ bill: b, page: i }); });
          if (built.length >= 2) {
            res().innerHTML = '<div class="fin-up-loading">Reading <b>' + esc(f.name) + '</b> — splitting ' + built.length + ' bills…</div>';
            let files = [];
            try { files = await splitPdfPages(f, built.map(x => x.page), (f.name || 'bill').replace(/\.[^.]+$/, '')); } catch (_) {}
            finishImport(built.map(x => x.bill), null, files);
            return;
          }
          if (built.length === 1) { ocrReview(parseInvoiceText(pages[built[0].page]), f); return; }
        }
        ocrOffer(f); return;
      }
      let parsed;
      try { parsed = await fileToRows(f); } catch (e) { res().innerHTML = '<div class="fin-up-err">Couldn\'t read this file. Please export it as CSV or Excel and try again.</div>'; return; }
      const rows = parsed.rows || [];
      if (rows.length < 2) {
        // A photo or single-bill PDF → offer on-device OCR (if enabled for this register).
        if (cfg.ocr && (parsed.kind === 'image' || parsed.kind === 'pdf')) { ocrOffer(f); return; }
        const add = cfg.addLabel ? ' or add it with the "' + cfg.addLabel + '" button' : '';
        let msg;
        if (parsed.kind === 'image') msg = 'That\'s a photo/scan — we can\'t read a picture into a table yet. Export a CSV/Excel list from your billing software' + add + '.';
        else if (parsed.kind === 'pdf') msg = 'This looks like a PDF document (often a single bill), not a spreadsheet list. To bulk-import, export an Excel/CSV with one row per ' + noun + '. To add a single ' + noun + add + '.';
        else msg = 'We couldn\'t read any rows. Upload an Excel or CSV with a header row and one row per ' + noun + add + '.';
        res().innerHTML = '<div class="fin-up-err">' + msg + '</div>';
        return;
      }
      let hi = cfg.headerGroups ? findHeaderRow(rows, cfg.headerGroups) : -1;
      if (hi < 0) hi = firstDataRow(rows);
      const mapping = cfg.autoMap ? cfg.autoMap(rows[hi] || []) : {};
      if (complete(mapping)) buildPreview(rows, hi, mapping);
      else mapper(rows, hi, mapping);
    }

    // Manual column-mapper — shown when auto-detect can't match every required field
    function mapper(rows, hi, mapping) {
      const header = displayHeader(rows[hi]);
      const opts = sel => '<option value="-1">— not in file —</option>' + header.map((h, i) => '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + esc(h) + '</option>').join('');
      res().innerHTML =
        '<div class="fin-map-head">Match your columns so we import the right data:</div>' +
        '<div class="fin-map">' + (cfg.fields || []).map(f =>
          '<label class="fin-map-row"><span>' + esc(f.label) + (f.required ? ' <b class="fin-req">*</b>' : '') + '</span><select data-field="' + f.key + '">' + opts(mapping[f.key] != null ? mapping[f.key] : -1) + '</select></label>').join('') + '</div>' +
        (cfg.requireOneOf ? '<div class="fin-note">Map at least one amount column (e.g. Taxable, Rate or Total).</div>' : '') +
        '<button class="ql-btn ql-btn-primary fin-up-import" id="qlfMapGo">Continue</button>';
      document.getElementById('qlfMapGo').onclick = () => {
        const m = {};
        res().querySelectorAll('select[data-field]').forEach(s => { const v = +s.value; if (v >= 0) m[s.dataset.field] = v; });
        if (!complete(m)) { if (window.QLShell && QLShell.toast) QLShell.toast('Please map the required columns marked *'); return; }
        buildPreview(rows, hi, m);
      };
    }

    function buildPreview(rows, hi, mapping) {
      const items = [];
      for (let r = hi + 1; r < rows.length; r++) {
        const row = rows[r]; if (!row) continue;
        const get = key => { const i = mapping[key]; return (i != null && i >= 0 && i < row.length) ? row[i] : ''; };
        let it; try { it = cfg.buildRow(get); } catch (e) { it = null; }
        if (it) items.push(it);
      }
      if (!items.length) { res().innerHTML = '<div class="fin-up-err">' + (cfg.errText || 'No usable rows found — check the column mapping.') + '</div><a class="fin-remap" id="qlfRemap">↺ Re-map columns</a>'; wireRemap(rows, hi, mapping); return; }
      finishImport(items, () => mapper(rows, hi, mapping));
    }
    // Dedup + preview table + bulk import. remapFn (optional) wires a "re-map"
    // link. files (optional) is aligned 1:1 with items — each item's uploaded
    // page/scan, attached on add. Pairs (item+file) so dedup keeps them aligned.
    function finishImport(items, remapFn, files) {
      files = files || [];
      const existing = cfg.existing ? cfg.existing() : new Set();
      const keyOf = cfg.keyOf || (() => '');
      const pairs = items.map((it, i) => ({ it, file: files[i] || null }));
      const fresh = pairs.filter(pr => { const k = keyOf(pr.it); return !(k && existing.has(k)); });
      const dupes = items.length - fresh.length;
      const nFiles = fresh.filter(pr => pr.file).length;
      const p = cfg.preview, prev = fresh.slice(0, 8), R = p.right || [];
      res().innerHTML =
        '<div class="fin-up-ok">✓ Found <b>' + items.length + '</b> ' + plural(items.length) + (dupes ? ' · ' + dupes + ' already added (skipped)' : '') + (nFiles ? ' · ' + nFiles + ' with attached bill page' : '') + '</div>' +
        '<div class="sr-table-wrap fin-up-prev"><table class="sr fin-table"><thead><tr>' + p.headers.map((h, i) => '<th' + (R.includes(i) ? ' class="r"' : '') + '>' + h + '</th>').join('') + '</tr></thead><tbody>' +
        prev.map(pr => '<tr>' + p.row(pr.it).map((c, i) => '<td' + (R.includes(i) ? ' class="r"' : '') + '>' + (c == null ? '' : c) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>' +
        (fresh.length > prev.length ? '<div class="fin-up-more">…and ' + (fresh.length - prev.length) + ' more</div>' : '') +
        (remapFn ? '<a class="fin-remap" id="qlfRemap">↺ Columns look wrong? Re-map</a>' : '') +
        (fresh.length ? '<button class="ql-btn ql-btn-primary fin-up-import" id="qlfDoImport">Import ' + fresh.length + ' ' + plural(fresh.length) + '</button>' : '<div class="fin-note">Nothing new to import — all of these are already added.</div>');
      if (remapFn) { const a = document.getElementById('qlfRemap'); if (a) a.onclick = remapFn; }
      const btn = document.getElementById('qlfDoImport');
      if (btn) btn.onclick = () => { fresh.forEach(pr => cfg.add(pr.it, pr.file || undefined)); el.hidden = true; if (cfg.done) cfg.done(fresh.length); };
    }
    // Build a row from OCR-parsed generic fields via cfg.buildRow + ocrMap.
    function ocrBuild(g) {
      const get = k => { const key = cfg.ocrMap ? cfg.ocrMap[k] : k; return (key && g[key] != null) ? g[key] : ''; };
      try { return cfg.buildRow(get); } catch (e) { return null; }
    }
    function wireRemap(rows, hi, mapping) { const a = document.getElementById('qlfRemap'); if (a) a.onclick = () => mapper(rows, hi, mapping); }

    /* ── OCR path — read a photo/PDF of a bill, then review & save ── */
    function ocrOffer(file) {
      res().innerHTML =
        '<div class="fin-ocr-offer"><div class="fin-ocr-ic">📷</div><div><b>Read this bill with OCR</b>' +
        '<div class="fin-ocr-sub">We\'ll read the text on your device and fill in the ' + noun + ' for you to check. Works best on a clear, straight photo of a printed bill. <span class="fin-beta">beta</span></div></div></div>' +
        '<button class="ql-btn ql-btn-primary fin-up-import" id="qlfOcrGo">Scan bill</button>';
      document.getElementById('qlfOcrGo').onclick = () => runOcr(file);
    }
    async function runOcr(file) {
      res().innerHTML = '<div class="fin-ocr-prog"><div class="fin-ocr-track"><i id="qlfOcrBar"></i></div><div id="qlfOcrMsg" class="fin-up-loading">Starting the reader… the first scan downloads ~12&nbsp;MB, so give it a moment.</div></div>';
      let data;
      try {
        data = await ocrScan(file, m => {
          const bar = document.getElementById('qlfOcrBar'), msg = document.getElementById('qlfOcrMsg');
          if (!bar) return;
          if (m.status === 'recognizing text') { bar.style.width = Math.round((m.progress || 0) * 100) + '%'; if (msg) msg.textContent = 'Reading the bill… ' + Math.round((m.progress || 0) * 100) + '%'; }
          else if (msg && m.status) msg.textContent = m.status.charAt(0).toUpperCase() + m.status.slice(1) + '…';
        });
      } catch (e) { res().innerHTML = '<div class="fin-up-err">Couldn\'t read this file. Try a clearer, well-lit photo — or add the ' + noun + (cfg.addLabel ? ' with the "' + cfg.addLabel + '" button' : ' manually') + '.</div>'; return; }
      ocrReview(data, file);
    }
    // `file` (optional) is the original photo/PDF of this single bill — kept so we
    // can auto-attach the real scan to the row on save (cfg.add(row, file)).
    function ocrReview(g, file) {
      ocr2css();
      el.classList.add('fin-sheet-wide');
      const gk = f => cfg.ocrMap ? cfg.ocrMap[f.key] : f.key;
      const val = f => { const k = gk(f); return (k && g[k] != null) ? g[k] : ''; };
      const confOf = f => { const k = gk(f); return (g._conf && k) ? g._conf[k] : undefined; };
      const revOf = f => { const k = gk(f); return !!(g._review && k && g._review.indexOf(k) >= 0); };
      const verOf = f => { const k = gk(f); return (g._verify && k) ? g._verify[k] : undefined; };
      const fields = cfg.fields || [];
      const got = fields.filter(f => val(f) !== '').length;
      const revCount = fields.filter(revOf).length;
      const warns = g._warn || [];
      // Step 9: show HOW a field was verified (GST calc / layout / confidence %),
      // not a generic High/Medium.
      const pct = c => Math.round(c * 100) + '%';
      const badge = f => {
        if (revOf(f)) return '<span class="ocr2-cf ocr2-cf-r">⚠ Needs review</span>';
        const c = confOf(f); if (c == null) return '';
        const v = verOf(f);
        if (v === 'gst_calc') return '<span class="ocr2-cf ocr2-cf-g">✓ Verified by GST · ' + pct(c) + '</span>';
        if (v === 'gst_sum') return '<span class="ocr2-cf ocr2-cf-g">✓ Verified · ' + pct(c) + '</span>';
        if (v === 'layout') return '<span class="ocr2-cf ocr2-cf-g">✓ Verified by layout · ' + pct(c) + '</span>';
        if (c >= 0.8) return '<span class="ocr2-cf ocr2-cf-g">✓ Auto-verified · ' + pct(c) + '</span>';
        return '<span class="ocr2-cf ocr2-cf-y">' + pct(c) + '</span>';
      };
      // left: the uploaded bill (image inline, PDF in a frame)
      let docUrl = ''; try { docUrl = file ? URL.createObjectURL(file) : ''; } catch (_) {}
      const isPdf = file && (/\.pdf$/i.test(file.name || '') || file.type === 'application/pdf');
      const docHtml = docUrl
        ? (isPdf ? '<iframe class="ocr2-doc" src="' + docUrl + '#toolbar=0&navpanes=0"></iframe>' : '<img class="ocr2-doc" src="' + docUrl + '" alt="bill">')
        : '<div class="ocr2-nodoc">Bill preview unavailable</div>';
      const firstLine = ((g._text || '').split('\n').map(s => s.trim()).filter(Boolean)[0]) || '';
      const supField = fields.find(f => gk(f) === 'name');
      const origSup = supField ? (val(supField) || '') : '';

      res().innerHTML =
        '<div class="ocr2-steps"><span class="ocr2-st done">1 Upload</span><span class="ocr2-st done">2 AI read</span><span class="ocr2-st on">3 Review &amp; save</span></div>' +
        '<div class="ocr2-hd"><b>Read ' + got + ' of ' + fields.length + ' fields.</b> ' +
        (revCount ? '<span class="ocr2-hd-r">⚠ ' + revCount + ' field' + (revCount === 1 ? '' : 's') + ' need' + (revCount === 1 ? 's' : '') + ' your review</span>' : '<span class="ocr2-hd-g">✓ All required fields verified — please confirm.</span>') + '</div>' +
        (warns.length ? '<div class="ocr2-warn"><b>⚠ Please check:</b> ' + warns.map(esc).join(' · ') + '</div>' : '') +
        '<div class="ocr2-grid">' +
          '<div class="ocr2-left">' + docHtml + '</div>' +
          '<div class="ocr2-right">' + fields.map(f =>
            '<label class="ocr2-f' + (revOf(f) ? ' rev' : '') + '"><span class="ocr2-l">' + esc(f.label) + (f.required ? ' <b class="fin-req">*</b>' : '') + ' ' + badge(f) + '</span>' +
            '<input data-k="' + f.key + '" value="' + esc(val(f)) + '"' + (revOf(f) ? ' placeholder="Needs review — read it off the bill"' : '') + '></label>').join('') +
          '</div>' +
        '</div>' +
        '<details class="ocr2-dbg"><summary>🔧 Extraction details (debug)</summary><div class="ocr2-dbg-b">' +
          '<div class="ocr2-dbg-kv">Parser: <b>BillOCR' + (window.BillOCR ? '' : ' (legacy fallback)') + '</b> · Fields read: <b>' + got + '/' + fields.length + '</b> · Needs review: <b>' + revCount + '</b></div>' +
          '<div class="ocr2-dbg-s">AI-extracted fields</div><pre>' + esc(JSON.stringify(g._fields || {}, null, 1)) + '</pre>' +
          '<div class="ocr2-dbg-s">Confidence</div><pre>' + esc(JSON.stringify(g._conf || {}, null, 1)) + '</pre>' +
          '<div class="ocr2-dbg-s">Validation warnings</div><pre>' + esc(JSON.stringify(warns, null, 1)) + '</pre>' +
          '<div class="ocr2-dbg-s">Raw OCR text</div><pre>' + esc((g._text || '').slice(0, 5000)) + '</pre>' +
        '</div></details>' +
        '<div class="ocr2-save"><span class="ocr2-save-h">' + (revCount ? 'Check the highlighted fields, then' : '') + '</span><button class="ql-btn ql-btn-primary" id="qlfOcrSave">Save ' + noun + '</button></div>';

      const cleanup = () => { if (docUrl) try { URL.revokeObjectURL(docUrl); } catch (_) {} el.classList.remove('fin-sheet-wide'); };
      document.getElementById('qlfOcrSave').onclick = () => {
        const vals = {}; res().querySelectorAll('input[data-k]').forEach(i => vals[i.dataset.k] = i.value);
        const miss = fields.filter(f => f.required && !((vals[f.key] || '').toString().trim()));
        if (miss.length) { if (window.QLShell && QLShell.toast) QLShell.toast('Please fill: ' + miss.map(f => f.label).join(', ')); return; }
        // Learn: if the user corrected the supplier, remember it for next time.
        if (supField && firstLine) { const ns = (vals[supField.key] || '').trim(); if (ns && ns !== origSup) learnBillAlias(firstLine, ns); }
        let row; try { row = cfg.buildRow(k => vals[k] != null ? vals[k] : ''); } catch (e) { row = null; }
        if (!row) { if (window.QLShell && QLShell.toast) QLShell.toast('Couldn\'t save — check the amounts'); return; }
        cfg.add(row, file); cleanup(); el.hidden = true; if (cfg.done) cfg.done(1);
      };
    }
    // Self-contained styles for the review UI (injected once).
    function ocr2css() {
      if (document.getElementById('qlfOcr2Css')) return;
      const s = document.createElement('style'); s.id = 'qlfOcr2Css';
      s.textContent =
        '.fin-sheet-wide .fin-sheet-card{max-width:min(980px,96vw)}' +
        '.ocr2-steps{display:flex;gap:8px;margin:0 0 12px;font-size:11.5px;font-weight:600}' +
        '.ocr2-st{padding:5px 11px;border-radius:999px;background:var(--ql-bg-subtle,#f1f5f9);color:var(--ql-text-muted,#64748b)}' +
        '.ocr2-st.done{background:#dcfce7;color:#15803d}.ocr2-st.on{background:var(--ql-brand-600,#2563eb);color:#fff}' +
        '.ocr2-hd{font-size:14px;margin-bottom:10px}.ocr2-hd-r{color:#b45309;font-weight:600}.ocr2-hd-g{color:#15803d;font-weight:600}' +
        '.ocr2-warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:12.5px;border-radius:10px;padding:9px 12px;margin-bottom:12px;line-height:1.5}' +
        '.ocr2-grid{display:grid;grid-template-columns:1fr;gap:16px}' +
        '@media(min-width:760px){.ocr2-grid{grid-template-columns:minmax(0,0.9fr) minmax(0,1.1fr)}}' +
        '.ocr2-left{position:relative}.ocr2-doc{width:100%;height:420px;border:1px solid var(--ql-border,#e2e8f0);border-radius:12px;background:#f8fafc;object-fit:contain;display:block}' +
        '@media(min-width:760px){.ocr2-left{position:sticky;top:0}.ocr2-doc{height:min(560px,68vh)}}' +
        '.ocr2-nodoc{height:200px;display:grid;place-items:center;color:var(--ql-text-muted,#94a3b8);border:1px dashed var(--ql-border,#e2e8f0);border-radius:12px;font-size:13px}' +
        '.ocr2-right{display:flex;flex-direction:column;gap:10px}' +
        '.ocr2-f{display:flex;flex-direction:column;gap:5px}' +
        '.ocr2-l{font-size:12px;font-weight:600;color:var(--ql-text-secondary,#475569);display:flex;align-items:center;gap:7px}' +
        '.ocr2-f input{border:1.5px solid var(--ql-border,#e2e8f0);border-radius:9px;padding:9px 11px;font:inherit;font-size:13.5px;width:100%}' +
        '.ocr2-f input:focus{outline:none;border-color:var(--ql-brand-500,#3b82f6);box-shadow:0 0 0 3px var(--ql-brand-50,#eff6ff)}' +
        '.ocr2-f.rev input{border-color:#f59e0b;background:#fffdf5}.ocr2-f.rev{border-left:3px solid #f59e0b;padding-left:10px;margin-left:-13px}' +
        '.ocr2-cf{font-size:10px;font-weight:700;letter-spacing:.02em;padding:2px 7px;border-radius:999px}' +
        '.ocr2-cf-g{background:#dcfce7;color:#15803d}.ocr2-cf-y{background:#fef9c3;color:#a16207}.ocr2-cf-r{background:#fee2e2;color:#b91c1c}' +
        '.ocr2-dbg{margin-top:16px;border:1px solid var(--ql-border,#e2e8f0);border-radius:10px;overflow:hidden}' +
        '.ocr2-dbg>summary{cursor:pointer;padding:9px 13px;font-size:12px;font-weight:600;color:var(--ql-text-secondary,#475569);background:var(--ql-bg-subtle,#f8fafc);user-select:none}' +
        '.ocr2-dbg-b{padding:12px 13px;font-size:11.5px}.ocr2-dbg-kv{color:var(--ql-text-secondary,#475569);margin-bottom:8px}' +
        '.ocr2-dbg-s{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ql-text-muted,#94a3b8);margin:10px 0 4px}' +
        '.ocr2-dbg pre{background:#0f172a;color:#e2e8f0;border-radius:8px;padding:10px;overflow:auto;max-height:200px;font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-word}' +
        '.ocr2-save{position:sticky;bottom:0;display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:14px 0 2px;margin-top:16px;background:linear-gradient(transparent,var(--ql-card,#fff) 30%)}' +
        '.ocr2-save-h{font-size:12px;color:var(--ql-text-muted,#94a3b8)}.ocr2-save .ql-btn{min-width:150px}' +
        '.ocr2-runbtn{margin-top:12px;display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:var(--ql-brand-600,#2563eb);background:var(--ql-brand-50,#eff6ff);border:1px solid var(--ql-brand-200,#bfdbfe);border-radius:9px;padding:8px 13px;cursor:pointer}' +
        '.ocr2-tcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:14px 0}' +
        '.ocr2-tc{border:1px solid var(--ql-border,#e2e8f0);border-radius:11px;padding:11px 13px;background:var(--ql-bg-subtle,#f8fafc)}' +
        '.ocr2-tc-v{font-size:20px;font-weight:800;letter-spacing:-.02em}.ocr2-tc-l{font-size:11px;color:var(--ql-text-muted,#64748b);margin-top:2px}' +
        '.ocr2-tc.good{background:#f0fdf4;border-color:#bbf7d0}.ocr2-tc.good .ocr2-tc-v{color:#15803d}' +
        '.ocr2-tc.bad{background:#fef2f2;border-color:#fecaca}.ocr2-tc.bad .ocr2-tc-v{color:#dc2626}' +
        '.ocr2-ttable{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px}' +
        '.ocr2-ttable th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--ql-text-muted,#94a3b8);padding:7px 9px;border-bottom:1px solid var(--ql-border,#e2e8f0)}' +
        '.ocr2-ttable td{padding:8px 9px;border-bottom:1px solid var(--ql-border-subtle,#f1f5f9)}' +
        '.ocr2-pass{color:#15803d;font-weight:600}.ocr2-fail{color:#dc2626;font-weight:600}';
      document.head.appendChild(s);
    }
    // Admin/dev mode: localStorage ql_dev=1  OR  ?dev in the URL.
    function ocrDevMode() { try { return localStorage.getItem('ql_dev') === '1' || /[?&]dev\b/.test(location.search); } catch (_) { return /[?&]dev\b/.test(location.search); } }
    // Run every built-in sample bill through the parser and show a field-level report.
    function runOcrSuite() {
      const rep = window.BillOCR.selfTest();
      const card = (l, v, ok) => '<div class="ocr2-tc' + (ok === false ? ' bad' : ok === true ? ' good' : '') + '"><div class="ocr2-tc-v">' + v + '</div><div class="ocr2-tc-l">' + l + '</div></div>';
      res().innerHTML =
        '<div class="ocr2-hd"><b>OCR Test Suite</b> — ran ' + rep.total + ' sample bills through the parser</div>' +
        '<div class="ocr2-tcards">' +
          card('Bills passed', rep.passed + '/' + rep.total, rep.passed === rep.total) +
          card('Field accuracy', rep.fieldAccuracy + '%', rep.fieldAccuracy >= 95) +
          card('Supplier', rep.supplierAccuracy + '%', rep.supplierAccuracy >= 90) +
          card('Amounts', rep.amountAccuracy + '%', rep.amountAccuracy >= 90) +
          card('GST', rep.gstAccuracy + '%', rep.gstAccuracy >= 90) +
          card('Total', rep.totalAccuracy + '%', rep.totalAccuracy >= 90) +
          card('Duplicate detect', rep.duplicateAccuracy + '%', rep.duplicateAccuracy >= 90) +
          card('Label-as-value errors', rep.labelErrors, rep.labelErrors === 0) +
          card('Fake-data errors', rep.fakeErrors, rep.fakeErrors === 0) +
        '</div>' +
        '<table class="ocr2-ttable"><thead><tr><th>Sample bill</th><th>Category</th><th>Supplier read</th><th>Result</th></tr></thead><tbody>' +
        rep.cases.map(c => '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.cat) + '</td><td>' + esc(c.supplier || '—') + '</td><td>' + (c.pass ? '<span class="ocr2-pass">✓ Pass</span>' : '<span class="ocr2-fail">✗ ' + esc(c.fields.filter(f => !f.pass).map(f => f.name).join(', ')) + '</span>') + '</td></tr>').join('') +
        '</tbody></table>' +
        '<div class="ocr2-save"><button class="ql-btn" id="qlfSuiteBack">← Back to upload</button></div>';
      const b = document.getElementById('qlfSuiteBack'); if (b) b.onclick = () => { res().innerHTML = ''; };
    }
  }

  /* ── Public API ────────────────────────────────────────────────── */
  window.QLFin = {
    CATS, CREDIT_CATS, DEBIT_CATS, STATUSES, CHECKLIST, DOC_KINDS,
    fileToRows, extract, parseDate, parseNum, findHeaderRow, colOf, importSheet, ocrScan, parseInvoiceText, learnBillAlias,
    pdfPages, splitPdfPages, ownInfo, pdfBankTable, pdfToImages,
    importTxns, reclassifyAll, setTxn, deleteTxn, findDuplicates,
    summary, byCategory, customerOutstanding, supplierOutstanding, accBalance, accLabel,
    gstMonths, setGst,
    caMonth, caProgress, caLabel, addDoc, downloadDoc, deleteDoc, setChecklist, setFiling,
    insights, report, thisMonth
  };
})();
