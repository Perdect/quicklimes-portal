/* ═══════════════════════════════════════════════════════════════
   QuickLimes v2 — Data Layer (QLD)
   Ports the v1 production data logic into a clean module the v2
   pages consume: auth guard, multi-plant companies, local+cloud
   persistence, calculation helpers and dashboard aggregates.
   Depends on supabase-js (CDN) being loaded first.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Supabase (same project + publishable key as v1) ────────── */
  const SUPA_URL = 'https://iteaawedfmaujujyrqdu.supabase.co';
  const SUPA_KEY = 'sb_publishable_9MNYdrZ_ddJKTLL97amK4w_85iF6vlU';

  /* ── Auth guard — identical contract to v1 ──────────────────── */
  let QL_PLANT = null;
  try { QL_PLANT = JSON.parse(localStorage.getItem('ql_plant') || 'null'); } catch (_) {}
  // Cross-subdomain handoff (#auth=base64) — same as v1 login flow
  if (!QL_PLANT && location.hash.startsWith('#auth=')) {
    try {
      QL_PLANT = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(6)))));
      localStorage.setItem('ql_plant', JSON.stringify(QL_PLANT));
      history.replaceState(null, '', location.pathname);
    } catch (_) {}
  }
  if (!QL_PLANT || !QL_PLANT.id) {
    const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname) || location.hostname.endsWith('.local');
    location.replace(isLocal ? '/quicklime.html' : 'https://quicklimes.com/portal');
    throw new Error('ql_v2_no_session');
  }

  /* ── Seller details for tax invoices (ported from v1, keyed by name) ── */
  const HSN = '25221000';   // Quick Lime / Hydrated Lime
  const SELLER_DEFAULTS = {
    'DESHWALI MINERALS': {
      address: 'Ground Floor, Kali Talai, Near Hafiz Sahab Ki Dragha, Merta City, Nagaur, Rajasthan - 341510',
      state: 'Rajasthan (08)', pin: '341510', gstin: '08NLIPS9801K1Z5', phone: '9610099006',
      bank: 'HDFC Bank', bankBranch: 'Merta City', accNo: '50200089605146', ifsc: 'HDFC0002670',
      product: 'Manufactures of Quick Lime and Hydrated Lime.', tan: 'JDPM00000D', jurisdiction: 'MERTA CITY'
    },
    'GOTAN LIME INDUSTRIES': {
      address: 'TALANPUR ROAD ,SH 86B,, CHANDRA TYRE RETREADING GOTAN, DISTRICT -NAGAUR',
      state: 'Rajasthan (08)', pin: '342604', gstin: '08BNAPM0488E1Z3', phone: '9460034743',
      email: 'gotanlimeindustries@gmail.com', station: 'GOTAN',
      bank: 'BANK OF BARODA', bankBranch: 'MERTA CITY', accNo: '33580500001254', ifsc: 'BARB0MERTAC',
      bank2: 'HDFC BANK', bankBranch2: 'UMAID STADIUM', accNo2: '50200084904066', ifsc2: 'HDFC0001845',
      product: 'MANUFACTURES OF QUICK LIME AND HYDRATED LIME', msme: 'UDYAM-RJ -25-0061325',
      logo: '/v2/gotan-logo.png', tan: '', jurisdiction: 'MERTA CITY'
    }
  };

  /* ── Companies from the plants[] array (parent + children) ──── */
  const plants = (Array.isArray(QL_PLANT.plants) && QL_PLANT.plants.length) ? QL_PLANT.plants : [QL_PLANT];
  const COMPANIES = {};
  plants.forEach(p => {
    const nm = (p.plant_name || '').trim().toUpperCase();
    const seller = SELLER_DEFAULTS[nm] || {};
    COMPANIES[p.id] = {
      key: p.id,
      name: (p.plant_name || 'Your Plant').toUpperCase(),
      short: p.plant_name || 'Your Plant',
      city: p.city || '',
      gstin: p.gst_number || seller.gstin || '',
      address: seller.address || '', state: seller.state || 'Rajasthan (08)', pin: seller.pin || '',
      phone: seller.phone || (QL_PLANT.owner_phone || ''), email: seller.email || '', station: seller.station || p.city || '',
      bank: seller.bank || '', bankBranch: seller.bankBranch || '', accNo: seller.accNo || '', ifsc: seller.ifsc || '',
      bank2: seller.bank2 || '', bankBranch2: seller.bankBranch2 || '', accNo2: seller.accNo2 || '', ifsc2: seller.ifsc2 || '',
      product: seller.product || '', msme: seller.msme || '', logo: seller.logo || '', jurisdiction: seller.jurisdiction || '', hsn: HSN,
      isPrimary: !p.parent_plant_id,
      dataKey: 'ql_data_' + p.id
    };
  });
  let ACTIVE_CO = localStorage.getItem('dm_active_co');
  if (!ACTIVE_CO || !COMPANIES[ACTIVE_CO]) {
    ACTIVE_CO = (Object.values(COMPANIES).find(c => c.isPrimary) || Object.values(COMPANIES)[0]).key;
  }
  localStorage.setItem('dm_active_co', ACTIVE_CO);

  /* ── State ───────────────────────────────────────────────────── */
  const S = {
    SALES: [], PURCHASES: [], WORKERS: [], WORK_LOG: [], ATT: {},
    TDS: [], CHALLANS: [], PARTIES: [], CASHBOOK: [], LOANS: [], CHUNNA: [],
    FINANCE: null,
    RECON: { txns: [] }   // bank-statement reconciliation (per company)
  };
  // Finance + GST Portal state (bank txns, GST tracking, CA docs metadata).
  // Lives inside the per-company blob so it persists locally and syncs to
  // cloud with everything else. Uploaded document *files* live in IndexedDB
  // (finance.js), only lightweight metadata is kept here.
  function defaultFinance() {
    return {
      accounts: [
        { id: 'A1', label: 'Current Account 1', bank: '', accNo: '', opening: 0 },
        { id: 'A2', label: 'Current Account 2', bank: '', accNo: '', opening: 0 }
      ],
      txns: [], gst: {}, ca: {}
    };
  }
  function normalizeFinance(f) {
    const d = defaultFinance();
    if (!f || typeof f !== 'object') return d;
    return {
      accounts: (Array.isArray(f.accounts) && f.accounts.length) ? f.accounts : d.accounts,
      txns: Array.isArray(f.txns) ? f.txns : [],
      gst: (f.gst && typeof f.gst === 'object') ? f.gst : {},
      ca: (f.ca && typeof f.ca === 'object') ? f.ca : {}
    };
  }
  let DB = null;
  let ALL_LOANS = [];   // global across companies (v1 stores loans in `dm_loans`, tagged by .company)

  /* ── Format helpers (ported) ─────────────────────────────────── */
  const fmt = (n, d = 0) => Number(n == null ? 0 : n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fC = n => '₹' + fmt(n);
  const fL = n => '₹' + fmt(n / 100000, n >= 10000000 ? 2 : 1) + 'L';           // lakhs, compact
  const parseD = s => { if (!s) return null; const [y, m, d] = (s + '').split('T')[0].split('-').map(Number); return new Date(y, m - 1, d); };
  const fDS = s => s ? (parseD(s) || new Date()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '';
  const ymOf = s => (s || '').slice(0, 7);
  const daysAgo = s => { const d = parseD(s); return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : 0; };

  /* ── Business calc (ported from v1) ──────────────────────────── */
  const cS = s => { const tx = s.qty * s.rate, g = tx * s.gstR / 100; return { tx, cgst: g / 2, sgst: g / 2, tot: tx + g }; };
  const cP = p => { const g = p.taxable * p.grate / 100, itc = (p.itc === 'Eligible' || p.itc === 'RCM') ? g : 0; return { g, tot: p.taxable + g, itc }; };
  const cW = w => {
    const days = Object.values(S.ATT[w.id] || {}).filter(v => v === 'P' || v === 'H').length;
    const gross = w.freq === 'monthly' ? w.wage : w.wage * days, ded = w.adv || 0;
    return { days, gross, ded, net: gross - ded, cost: gross };
  };
  const totS = () => S.SALES.reduce((a, x) => { const c = cS(x); return { tx: a.tx + c.tx, cgst: a.cgst + c.cgst, sgst: a.sgst + c.sgst, tot: a.tot + c.tot }; }, { tx: 0, cgst: 0, sgst: 0, tot: 0 });
  const totP = () => S.PURCHASES.reduce((a, x) => { const c = cP(x); return { tx: a.tx + x.taxable, g: a.g + c.g, tot: a.tot + c.tot, itc: a.itc + c.itc }; }, { tx: 0, g: 0, tot: 0, itc: 0 });
  const totL = () => S.WORKERS.reduce((a, w) => { const c = cW(w); return { gross: a.gross + c.gross, net: a.net + c.net, cost: a.cost + c.cost }; }, { gross: 0, net: 0, cost: 0 });
  function getPL() {
    const ts = totS(), tp = totP(), tl = totL();
    const rev = ts.tx;
    const cogs = S.PURCHASES.reduce((s, p) => s + p.taxable, 0);
    const gp = rev - cogs;
    const labour = tl.cost, ebitda = gp - labour;
    const outGST = ts.cgst + ts.sgst, netGST = Math.max(0, outGST - tp.itc), np = ebitda - netGST;
    return { rev, cogs, gp, labour, ebitda, netGST, np, outGST, itc: tp.itc, gpm: rev ? gp / rev * 100 : 0, npm: rev ? np / rev * 100 : 0 };
  }

  /* ── Persistence (port of v1 loadLocal / cloud pull) ─────────── */
  function clearState() {
    S.SALES.length = 0; S.PURCHASES.length = 0; S.WORKERS.length = 0; S.WORK_LOG.length = 0;
    S.TDS.length = 0; S.CHALLANS.length = 0; S.PARTIES.length = 0; S.CASHBOOK.length = 0;
    S.LOANS.length = 0; S.CHUNNA.length = 0;
    Object.keys(S.ATT).forEach(k => delete S.ATT[k]);
    S.FINANCE = defaultFinance();
    S.RECON = { txns: [] };
  }
  function hydrate(d) {
    if (!d) return;
    if (d.sales)     S.SALES.push(...d.sales.map(s => ({ ...s, status: s.status || 'pending' })));
    if (d.purchases) S.PURCHASES.push(...d.purchases.map(p => ({ ...p, status: p.status || 'pending' })));
    if (d.workers)   S.WORKERS.push(...d.workers);
    if (d.workLog)   S.WORK_LOG.push(...d.workLog);
    if (d.att)       Object.assign(S.ATT, d.att);
    if (d.tds)       S.TDS.push(...d.tds);
    if (d.challans)  S.CHALLANS.push(...d.challans);
    if (d.parties)   S.PARTIES.push(...d.parties);
    if (d.cashbook)  S.CASHBOOK.push(...d.cashbook);
    if (d.loans)     S.LOANS.push(...d.loans);
    if (d.chunna)    S.CHUNNA.push(...d.chunna);
    if (d.finance)   S.FINANCE = normalizeFinance(d.finance);
    if (d.reconcile && Array.isArray(d.reconcile.txns)) S.RECON = d.reconcile;
  }
  function loadLocal() {
    clearState();
    try {
      const raw = localStorage.getItem(COMPANIES[ACTIVE_CO].dataKey);
      if (raw) hydrate(JSON.parse(raw));
    } catch (e) { console.warn('v2 loadLocal failed', e); }
  }
  // Loans live in a single global `dm_loans` array (all companies), each tagged
  // with a `.company` = plant id — identical contract to v1.
  function loadLoansLocal() {
    try {
      const saved = localStorage.getItem('dm_loans');
      const arr = saved ? JSON.parse(saved) : [];
      ALL_LOANS = Array.isArray(arr) ? arr : [];
    } catch (_) { ALL_LOANS = []; }
  }
  async function pullLoansCloud() {
    if (!DB) return false;
    try {
      const { data: rows, error } = await DB.rpc('get_my_data', { p_plant_id: QL_PLANT.id });
      if (error || !rows) return false;
      const row = rows.find(r => r.id === 'loans_' + QL_PLANT.id);
      if (row && row.data && Array.isArray(row.data.loans)) {
        ALL_LOANS = row.data.loans;
        try { localStorage.setItem('dm_loans', JSON.stringify(ALL_LOANS)); } catch (_) {}
        return true;
      }
    } catch (e) { console.warn('v2 loans cloud pull failed', e); }
    return false;
  }
  async function pullCloud() {
    if (!DB) return false;
    try {
      const { data: rows, error } = await DB.rpc('get_my_data', { p_plant_id: QL_PLANT.id });
      if (error || !rows || !rows.length) return false;
      const row = rows.find(r => r.id === ACTIVE_CO);
      if (!row || !row.data) { clearState(); return true; }   // no data for this company yet
      clearState(); hydrate(row.data);
      try { localStorage.setItem(COMPANIES[ACTIVE_CO].dataKey, JSON.stringify(row.data)); } catch (_) {}
      if (row.data.profile_pic) { try { localStorage.setItem('dm_profile_pic', row.data.profile_pic); } catch (_) {} }
      return true;
    } catch (e) { console.warn('v2 cloud pull failed', e); return false; }
  }

  /* ── Persistence: WRITE (mirror of v1 saveLocal / saveToCloud) ───
     CRITICAL: save_my_data REPLACES the whole company row, so we always
     write back EVERY field we hydrated — including ones v2 doesn't yet
     display (tds, challans, chunna, workLog, att) — or they'd be wiped.
     Loans are NOT part of this blob (separate dm_loans row), exactly
     like v1.  profile_pic is included in the cloud blob only. */
  function blob(includePic) {
    const b = {
      sales: S.SALES, purchases: S.PURCHASES, workers: S.WORKERS, workLog: S.WORK_LOG,
      att: S.ATT, tds: S.TDS, challans: S.CHALLANS, parties: S.PARTIES,
      cashbook: S.CASHBOOK, chunna: S.CHUNNA, finance: S.FINANCE || defaultFinance(),
      reconcile: S.RECON || { txns: [] }
    };
    if (includePic) b.profile_pic = localStorage.getItem('dm_profile_pic') || null;
    return b;
  }
  function saveLocal() {
    try { localStorage.setItem(COMPANIES[ACTIVE_CO].dataKey, JSON.stringify(blob(false))); }
    catch (e) { console.error('v2 saveLocal failed', e); }
  }
  let _cloudTimer = null;
  async function saveCloudNow() {
    if (!DB) return;
    try {
      const { error } = await DB.rpc('save_my_data', { p_plant_id: QL_PLANT.id, p_id: ACTIVE_CO, p_data: blob(true) });
      if (error) throw error;
    } catch (e) { console.warn('v2 cloud save failed', e); }
  }
  function commit() {                         // local now, cloud debounced (coalesce rapid edits)
    saveLocal();
    if (DB) { clearTimeout(_cloudTimer); _cloudTimer = setTimeout(saveCloudNow, 300); }
  }

  /* ── Mutations (each updates S.* then persists) ──────────────── */
  const upper = s => (s || '').toString().trim().toUpperCase();
  // Party auto-create/merge — same merge rules as v1 autoSaveParty.
  function upsertParty(name, gstin, phone, address, state, type) {
    if (!name || name.trim().length < 2) return;
    const nm = upper(name);
    const idx = S.PARTIES.findIndex(p => upper(p.name) === nm || (gstin && p.gstin && upper(p.gstin) === upper(gstin)));
    if (idx >= 0) {
      const p = S.PARTIES[idx];
      if (gstin && !p.gstin) p.gstin = upper(gstin);
      if (phone && !p.phone) p.phone = phone;
      if (address && (!p.address || address.length > (p.address || '').length)) p.address = address;
      if (state && !p.state) p.state = state;
      if (type && p.type !== type && p.type !== 'both') p.type = type;
    } else {
      S.PARTIES.push({ id: 'p' + idStamp(), name: name.trim(), gstin: upper(gstin), phone: phone || '', address: address || '', state: state || '', type: type || 'customer', notes: '' });
    }
    commit();
  }
  // Sales
  function addSale(e) { S.SALES.push({ ...e, status: e.status || 'pending' }); if (e.party) upsertParty(e.party, e.gstin, '', e.addr || '', e.state || '', 'customer'); else commit(); }
  function updateSale(i, e) { if (S.SALES[i]) { S.SALES[i] = { ...S.SALES[i], ...e }; if (e.party) upsertParty(e.party, e.gstin, '', e.addr || '', e.state || '', 'customer'); else commit(); } }
  function deleteSale(i) { if (S.SALES[i]) { S.SALES.splice(i, 1); commit(); } }
  function setSaleStatus(i, st, pay) { if (S.SALES[i]) { Object.assign(S.SALES[i], { status: st }, pay || {}); commit(); } }
  // Purchases
  function addPurchase(e) { S.PURCHASES.push({ ...e, status: e.status || 'pending' }); if (e.sup) upsertParty(e.sup, e.gstin, '', '', '', 'supplier'); else commit(); }
  function updatePurchase(i, e) { if (S.PURCHASES[i]) { S.PURCHASES[i] = { ...S.PURCHASES[i], ...e }; if (e.sup) upsertParty(e.sup, e.gstin, '', '', '', 'supplier'); else commit(); } }
  function deletePurchase(i) { if (S.PURCHASES[i]) { S.PURCHASES.splice(i, 1); commit(); } }
  function setPurchaseStatus(i, st, pay) { if (S.PURCHASES[i]) { Object.assign(S.PURCHASES[i], { status: st }, pay || {}); commit(); } }
  // Workers
  function addWorker(e) { S.WORKERS.push({ id: 'W' + idStamp(), ...e }); commit(); }
  function updateWorker(i, e) { if (S.WORKERS[i]) { S.WORKERS[i] = { ...S.WORKERS[i], ...e }; commit(); } }
  function deleteWorker(i) { if (S.WORKERS[i]) { S.WORKERS.splice(i, 1); commit(); } }
  // Cashbook
  function addCashEntry(e) { S.CASHBOOK.push({ id: 'cb' + idStamp(), ...e }); commit(); }
  function deleteCashEntry(i) { if (S.CASHBOOK[i]) { S.CASHBOOK.splice(i, 1); commit(); } }
  // Party direct edit/delete (by index into partyRows == index into S.PARTIES)
  function deleteParty(i) { if (S.PARTIES[i]) { S.PARTIES.splice(i, 1); commit(); } }
  let _seq = 0;
  function idStamp() { return Date.now() + '' + (_seq++); }   // unique even within the same millisecond

  /* ── Aggregates for the dashboard ────────────────────────────── */
  function monthSeries(nMonths = 7) {
    const out = [];
    const now = new Date();
    for (let i = nMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      const sal = S.SALES.filter(s => ymOf(s.date) === ym);
      const pur = S.PURCHASES.filter(p => ymOf(p.date) === ym);
      const sTot = sal.reduce((a, s) => a + cS(s).tot, 0);
      const sTx  = sal.reduce((a, s) => a + cS(s).tx, 0);
      const pTx  = pur.reduce((a, p) => a + p.taxable, 0);
      out.push({
        ym, m: d.toLocaleDateString('en-IN', { month: 'short' }),
        sales: sTot, purchases: pTx, profit: sTx - pTx,
        qty: sal.reduce((a, s) => a + (s.qty || 0), 0),
        invoices: sal.length
      });
    }
    return out;
  }
  const mom = (cur, prev) => (prev > 0 ? (cur - prev) / prev * 100 : null);

  function kpis() {
    const ser = monthSeries(2);
    const cur = ser[1] || { sales: 0, purchases: 0, profit: 0, qty: 0, invoices: 0 };
    const prev = ser[0] || { sales: 0, purchases: 0, profit: 0, qty: 0, invoices: 0 };
    const ts = totS(), pl = getPL();
    const pendSales = S.SALES.filter(s => (s.status || 'pending') === 'pending');
    const pendParties = [...new Set(pendSales.map(s => s.party))];
    const overdueParties = [...new Set(pendSales.filter(s => daysAgo(s.date) > 30).map(s => s.party))];
    const pendPur = S.PURCHASES.filter(p => (p.status || 'pending') === 'pending');
    const totQty = S.SALES.reduce((a, s) => a + (s.qty || 0), 0);
    return {
      sales:       { v: fC(ts.tx), trend: mom(cur.sales, prev.sales), meta: S.SALES.length + ' invoices · excl. GST' },
      profit:      { v: fC(pl.np), trend: mom(cur.profit, prev.profit), meta: 'Margin ' + pl.npm.toFixed(1) + '%' },
      production:  { v: fmt(totQty, 1) + ' T', trend: mom(cur.qty, prev.qty), meta: 'Total lime dispatched' },
      dispatch:    { v: fmt(cur.qty, 1) + ' T', trend: mom(cur.qty, prev.qty), meta: cur.invoices + ' invoices this month' },
      collections: { v: fC(pendSales.reduce((a, s) => a + cS(s).tot, 0)), trend: null, meta: pendParties.length + ' parties · ' + overdueParties.length + ' overdue' },
      payments:    { v: fC(pendPur.reduce((a, p) => a + cP(p).tot, 0)), trend: null, meta: [...new Set(pendPur.map(p => p.sup))].length + ' suppliers' }
    };
  }

  function collections(filter = 'all') {
    const pend = S.SALES.filter(s => (s.status || 'pending') === 'pending');
    const byParty = {};
    pend.forEach(s => {
      const k = s.party || '—';
      byParty[k] = byParty[k] || { party: k, bills: 0, total: 0, oldest: s.date };
      byParty[k].bills++; byParty[k].total += cS(s).tot;
      if (s.date < byParty[k].oldest) byParty[k].oldest = s.date;
    });
    let rows = Object.values(byParty).map(r => ({ ...r, days: daysAgo(r.oldest) }));
    if (filter === 'overdue') rows = rows.filter(r => r.days > 30);
    if (filter === 'week')    rows = rows.filter(r => r.days <= 7);
    if (filter === 'month')   rows = rows.filter(r => r.days <= 31);
    return {
      rows: rows.sort((a, b) => b.total - a.total),
      total: Object.values(byParty).reduce((a, r) => a + r.total, 0),
      parties: Object.keys(byParty).length,
      overdue: Object.values(byParty).filter(r => daysAgo(r.oldest) > 30).length
    };
  }

  function insights() {
    const out = [];
    const ser = monthSeries(2);
    const sMoM = mom(ser[1].sales, ser[0].sales);
    if (sMoM != null) out.push({
      tone: sMoM >= 0 ? 'success' : 'danger', icon: sMoM >= 0 ? 'up' : 'down',
      t: `Sales ${sMoM >= 0 ? 'up' : 'down'} ${Math.abs(sMoM).toFixed(1)}% vs last month.`,
      s: `${fL(ser[1].sales)} this month vs ${fL(ser[0].sales)} previous.`
    });
    const coll = collections().rows[0];
    if (coll && coll.days > 30) out.push({
      tone: 'danger', icon: 'alert',
      t: `${coll.party} has ${fC(coll.total)} outstanding for ${coll.days} days.`,
      s: 'Highest overdue.', cta: 'View collections →', page: 'collections'
    });
    const pendPur = S.PURCHASES.filter(p => (p.status || 'pending') === 'pending');
    if (pendPur.length) out.push({
      tone: 'warning', icon: 'bill',
      t: `${pendPur.length} supplier bill${pendPur.length > 1 ? 's' : ''} awaiting payment.`,
      s: fC(pendPur.reduce((a, p) => a + cP(p).tot, 0)) + ' total.'
    });
    if (ser[1].profit > 0) out.push({
      tone: 'info', icon: 'trend',
      t: `Estimated gross profit this month: ${fL(ser[1].profit)}.`,
      s: ser[0].profit > 0 ? `${ser[1].profit >= ser[0].profit ? '+' : ''}${fL(ser[1].profit - ser[0].profit)} vs last month.` : 'Based on sales minus purchases.'
    });
    return out.slice(0, 4);
  }

  function production() {
    const today = new Date(); const tISO = today.toISOString().slice(0, 10);
    const qtyIn = f => S.SALES.filter(f).reduce((a, s) => a + (s.qty || 0), 0);
    const ymNow = tISO.slice(0, 7);
    return {
      today: qtyIn(s => s.date === tISO),
      week:  qtyIn(s => daysAgo(s.date) <= 7),
      month: qtyIn(s => ymOf(s.date) === ymNow),
      chunnaMonth: S.CHUNNA.filter(c => ymOf(c.date) === ymNow).reduce((a, c) => a + (parseFloat(c.qty) || 0), 0)
    };
  }

  function topProducts() {
    const ts = totS();
    const qty = S.SALES.reduce((a, s) => a + (s.qty || 0), 0);
    const rows = [{
      icon: '⚪', name: 'Quick Lime', sub: 'GST invoiced dispatches',
      qty: fmt(qty, 1) + ' T', avg: qty ? fC(ts.tx / qty) : '—', rev: fC(ts.tot)
    }];
    const cQty = S.CHUNNA.reduce((a, c) => a + (parseFloat(c.qty) || 0), 0);
    const cTot = S.CHUNNA.reduce((a, c) => a + (parseFloat(c.total) || 0), 0);
    if (cQty || cTot) rows.push({
      icon: '🧱', name: 'Chunna', sub: 'Cash + PhonePe sales',
      qty: fmt(cQty, 1) + ' T', avg: cQty ? fC(cTot / cQty) : '—', rev: fC(cTot)
    });
    return rows;
  }

  function activity() {
    const ev = [];
    S.SALES.forEach(s => {
      ev.push({ d: s.date, tone: 'brand', icon: 'invoice', t: `Invoice ${s.inv} — ${s.party}`, s: fmt(s.qty, 1) + ' T · ' + fC(cS(s).tot) });
      if (s.status === 'paid' && s.paidDate) ev.push({ d: s.paidDate, tone: 'success', icon: 'paid', t: `${s.party} paid ${fC(cS(s).tot)}`, s: 'Invoice ' + s.inv + (s.paidMode ? ' · ' + s.paidMode : '') });
    });
    S.PURCHASES.forEach(p => ev.push({ d: p.date, tone: 'warning', icon: 'bill', t: `Bill ${p.bill} — ${p.sup}`, s: fC(p.taxable) + ' · ' + (p.cat || 'Purchase') }));
    S.CHUNNA.forEach(c => ev.push({ d: c.date, tone: 'indigo', icon: 'chunna', t: `Chunna sale — ${c.customer || 'cash'}`, s: fmt(c.qty, 1) + ' T · ' + fC(c.total) }));
    return ev.filter(e => e.d).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 6)
             .map(e => ({ ...e, when: fDS(e.d) }));
  }

  /* ── Sales register helpers ──────────────────────────────────── */
  function salesRows() {
    return S.SALES.map((s, i) => {
      const c = cS(s);
      const paid = (s.status === 'paid' || s.status === 'cash') ? c.tot : (+s.paid || 0);
      return {
        idx: i, inv: s.inv, date: s.date, party: s.party || '—',
        qty: s.qty || 0, taxable: c.tx, gst: c.cgst + c.sgst, total: c.tot,
        status: s.status || 'pending', veh: s.veh || '', gstin: s.gstin || '',
        days: daysAgo(s.date), paid, outstanding: Math.max(0, c.tot - paid),
        payments: s.payments || [], paidMode: s.paidMode || '', paidDate: s.paidDate || '', attach: s.attach || []
      };
    });
  }
  function salesSummary() {
    const rows = salesRows();
    const paid = rows.filter(r => r.status === 'paid' || r.status === 'cash');
    return {
      count: rows.length,
      taxable: rows.reduce((a, r) => a + r.taxable, 0),   // headline "sales" = taxable (matches v1)
      revenue: rows.reduce((a, r) => a + r.total, 0),      // GST-inclusive (kept for any callers)
      collected: paid.reduce((a, r) => a + r.total, 0),    // money received is GST-inclusive
      pending: rows.filter(r => r.status === 'pending').reduce((a, r) => a + r.total, 0),
      gst: rows.reduce((a, r) => a + r.gst, 0),
      qty: rows.reduce((a, r) => a + r.qty, 0)
    };
  }

  /* ── Purchase Groups → Items taxonomy (landed-cost model) ─────────
     Related expenses stay grouped: e.g. Petcoke = Petcoke Purchase +
     Petcoke Transport Freight + Loading Charges (the true landed cost). */
  const PURCHASE_GROUPS = [
    { key: 'limestone',   label: 'Limestone',   emoji: '🪨', items: ['Limestone Purchase', 'Limestone Freight', 'Royalty'] },
    { key: 'petcoke',     label: 'Petcoke',     emoji: '🔥', items: ['Petcoke Purchase', 'Petcoke Transport Freight', 'Loading Charges'] },
    { key: 'packaging',   label: 'Packaging',   emoji: '📦', items: ['Plastic Bags', 'Bag Printing', 'Other Packaging'] },
    { key: 'labour',      label: 'Labour',      emoji: '👷', items: ['Kiln Labour', 'Packing Labour', 'Loading Labour'] },
    { key: 'maintenance', label: 'Maintenance', emoji: '🛠️', items: ['Machine Repair', 'Spare Parts', 'Building Repair'] },
    { key: 'utilities',   label: 'Utilities',   emoji: '⚡', items: ['Electricity', 'Diesel', 'Water'] },
    { key: 'office',      label: 'Office',       emoji: '🏢', items: ['Stationery', 'Printing', 'Office Expenses'] },
    { key: 'other',       label: 'Other',        emoji: '📋', items: ['Other'] }
  ];
  const PGROUP_MAP = {}; PURCHASE_GROUPS.forEach(g => { PGROUP_MAP[g.key] = g; });
  const DEPARTMENTS = ['Production', 'Kiln', 'Packing', 'Loading', 'Utilities', 'Maintenance', 'Office', 'General'];
  const GROUP_DEPT = { limestone: 'Production', petcoke: 'Kiln', packaging: 'Packing', labour: 'Production', maintenance: 'Maintenance', utilities: 'Utilities', office: 'Office', other: 'General' };
  // Freight / transport / loading / royalty items — the "landed cost add-ons".
  const isFreightItem = it => /freight|transport|loading|cartage/i.test(it || '');
  // Map a legacy free-text category onto a {group,item} so old bills fit the model.
  function catToGroupItem(p) {
    if (p.group) return { group: p.group, item: p.item || (PGROUP_MAP[p.group] || PGROUP_MAP.other).items[0], dept: p.dept || GROUP_DEPT[p.group] || 'General' };
    const c = (p.cat || '').toLowerCase();
    let group = 'other', item = 'Other';
    if (/raw material|lime ?stone|\bstone\b|mineral/.test(c)) { group = 'limestone'; item = 'Limestone Purchase'; }
    else if (/petcoke|pet coke|\bcoke\b|\bcoal\b/.test(c)) { group = 'petcoke'; item = 'Petcoke Purchase'; }
    else if (/freight|transport|cartage|loading/.test(c)) { group = 'petcoke'; item = 'Petcoke Transport Freight'; }
    else if (/pack/.test(c)) { group = 'packaging'; item = 'Plastic Bags'; }
    else if (/electric|power/.test(c)) { group = 'utilities'; item = 'Electricity'; }
    else if (/diesel|fuel/.test(c)) { group = 'utilities'; item = 'Diesel'; }
    else if (/water/.test(c)) { group = 'utilities'; item = 'Water'; }
    else if (/repair|maint|spare/.test(c)) { group = 'maintenance'; item = 'Machine Repair'; }
    else if (/labour|labor|wage|salary/.test(c)) { group = 'labour'; item = 'Kiln Labour'; }
    else if (/office|station|print/.test(c)) { group = 'office'; item = 'Office Expenses'; }
    return { group, item, dept: p.dept || GROUP_DEPT[group] || 'General' };
  }

  /* ── Purchase register helpers ───────────────────────────────── */
  function itemIcon(item, groupEmoji) {
    const s = (item || '').toLowerCase();
    if (/freight|transport|cartage/.test(s)) return '🚚';
    if (/loading/.test(s)) return '🏗️';
    if (/royalty/.test(s)) return '📜';
    if (/thread|stitch/.test(s)) return '🧵';
    if (/bag|plastic|packag/.test(s)) return '📦';
    if (/electric|power/.test(s)) return '⚡';
    if (/diesel|fuel|petrol/.test(s)) return '⛽';
    if (/water/.test(s)) return '💧';
    if (/labour|labor|worker|crew|kiln lab|packing lab|loading lab/.test(s)) return '👷';
    if (/repair|machine|spare|maint/.test(s)) return '🔧';
    if (/station|print|office/.test(s)) return '🖇️';
    return groupEmoji || '📋';
  }
  function purchaseRows() {
    const todayISO = fmtISO(new Date());
    return S.PURCHASES.map((p, i) => {
      const c = cP(p);
      const g = catToGroupItem(p), gm = PGROUP_MAP[g.group] || PGROUP_MAP.other;
      let paid = +p.paid || 0;
      if (p.status === 'paid' && !paid) paid = c.tot;
      const outstanding = Math.max(0, c.tot - paid);
      const active = p.status !== 'paid' && p.status !== 'cancelled';
      const isOverdue = active && p.dueDate && p.dueDate < todayISO;
      return {
        idx: i, bill: p.bill, date: p.date, sup: p.sup || '—', cat: p.cat || 'Other',
        group: g.group, groupLabel: gm.label, emoji: gm.emoji, item: g.item, dept: g.dept,
        itemIconEmoji: itemIcon(g.item, gm.emoji),
        taxable: p.taxable, gst: c.g, itc: c.itc, total: c.tot, grate: p.grate || 0,
        qty: p.qty || 0, unit: p.unit || '', rate: p.rate || 0, desc: p.desc || '',
        status: p.status || 'pending', gstin: p.gstin || '', days: daysAgo(p.date),
        veh: p.veh || p.vehicle || '',
        remarks: p.remarks || '', dueDate: p.dueDate || '', createdBy: p.createdBy || (QL_PLANT.owner_name || QL_PLANT.plant_name || 'Owner'),
        paid, outstanding, payments: p.payments || [], attach: p.attach || [], isOverdue,
        freight: isFreightItem(g.item), freightAmt: isFreightItem(g.item) ? (p.taxable || 0) : 0
      };
    });
  }
  function fmtISO(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // Record a (possibly partial) payment against a purchase bill. Also posts
  // ONE debit to the unified money ledger (CASHBOOK) so the payment flows into
  // account balances, the Cash Book and the Payments Center automatically.
  function recordPurchasePayment(i, amount, mode, date, extra) {
    const p = S.PURCHASES[i]; if (!p) return;
    const c = cP(p); amount = +amount || 0;
    const prev = +p.paid || (p.status === 'paid' ? c.tot : 0);
    const paid = Math.min(c.tot, prev + amount);
    p.paid = paid;
    p.payments = (p.payments || []).concat([{ date: date || fmtISO(new Date()), amount, mode: mode || 'bank' }]);
    p.status = paid >= c.tot - 0.5 ? 'paid' : (paid > 0 ? 'partial' : 'pending');
    extra = extra || {};
    S.CASHBOOK.push({ id: 'cb' + idStamp(), date: date || fmtISO(new Date()), type: 'debit', mode: methodToMode(mode), method: extra.method || modeToMethod(methodToMode(mode)), ptype: 'Purchase Payment', party: p.sup || '—', ref: extra.ref || p.bill || '', amount, notes: extra.notes || '', link: { kind: 'purchase', idx: i } });
    commit();
  }
  // Per-bill AI insights.
  function billInsights(idx) {
    const rows = purchaseRows(), r = rows[idx]; if (!r) return [];
    const out = [], todayISO = fmtISO(new Date());
    if ((r.status === 'pending' || r.status === 'partial') && r.dueDate && r.dueDate < todayISO) out.push({ tone: 'danger', text: 'Payment overdue by ' + Math.max(1, daysAgo(r.dueDate)) + ' days.' });
    else if (r.status === 'pending' && r.days > 30) out.push({ tone: 'warn', text: 'Unpaid for ' + r.days + ' days — consider scheduling payment.' });
    const dup = rows.filter((x, j) => j !== idx && x.sup === r.sup && x.bill && r.bill && x.bill.toUpperCase() === r.bill.toUpperCase());
    if (dup.length) out.push({ tone: 'danger', text: 'Possible duplicate — bill ' + r.bill + ' from ' + r.sup + ' appears ' + (dup.length + 1) + ' times.' });
    const prev = rows.filter(x => x.sup === r.sup && x.item === r.item && x.date < r.date && x.rate > 0).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    if (prev && r.rate > 0) { const d = (r.rate - prev.rate) / prev.rate * 100; if (Math.abs(d) >= 3) out.push({ tone: d > 0 ? 'warn' : 'ok', text: r.item + ' rate ' + (d > 0 ? 'up ' : 'down ') + Math.abs(d).toFixed(0) + '% vs last purchase (' + fC(prev.rate) + '→' + fC(r.rate) + ').' }); }
    if (r.freight) { const pf = rows.filter(x => x.group === r.group && x.freight && x.date < r.date && x.taxable > 0).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]; if (pf) { const d = (r.taxable - pf.taxable) / pf.taxable * 100; if (d >= 8) out.push({ tone: 'warn', text: 'Freight ' + d.toFixed(0) + '% higher than previous (' + fC(pf.taxable) + '→' + fC(r.taxable) + ').' }); } }
    if (!r.itc && r.gst > 0) out.push({ tone: 'info', text: 'No ITC claimed on ' + fC(r.gst) + ' GST — check eligibility.' });
    if (!out.length) out.push({ tone: 'ok', text: 'Looks healthy — no issues detected.' });
    return out;
  }
  // Bills related to a bill (same group), split into freight / royalty.
  function relatedBills(idx) {
    const rows = purchaseRows(), r = rows[idx]; if (!r) return { freight: [], royalty: [], group: [] };
    const same = rows.filter((x, j) => j !== idx && x.group === r.group);
    return { freight: same.filter(x => x.freight), royalty: same.filter(x => /royalty/i.test(x.item)), group: same };
  }
  function purchaseSummary() {
    const r = purchaseRows();
    const pend = r.filter(x => x.status === 'pending');
    return {
      count: r.length,
      total: r.reduce((a, x) => a + x.taxable, 0),
      itc: r.reduce((a, x) => a + x.itc, 0),
      pending: pend.reduce((a, x) => a + x.total, 0),
      gst: r.reduce((a, x) => a + x.gst, 0)
    };
  }
  // Spend rolled up by Purchase Group (the landed cost), with item breakdown.
  function purchaseByGroup() {
    const rows = purchaseRows(), map = {};
    PURCHASE_GROUPS.forEach(g => { map[g.key] = { key: g.key, label: g.label, emoji: g.emoji, taxable: 0, gst: 0, total: 0, itc: 0, count: 0, freight: 0, items: {} }; });
    rows.forEach(r => {
      const m = map[r.group] || map.other;
      m.taxable += r.taxable; m.gst += r.gst; m.total += r.total; m.itc += r.itc; m.count++;
      if (r.freight) m.freight += r.taxable;
      const it = m.items[r.item] || (m.items[r.item] = { item: r.item, taxable: 0, total: 0, count: 0, freight: r.freight });
      it.taxable += r.taxable; it.total += r.total; it.count++;
    });
    return Object.values(map).filter(m => m.count)
      .map(m => ({ ...m, items: Object.values(m.items).sort((a, b) => b.taxable - a.taxable) }))
      .sort((a, b) => b.taxable - a.taxable);
  }
  // AI-style insights for the purchase page.
  function purchaseInsights() {
    const rows = purchaseRows(), byG = purchaseByGroup();
    const g = k => byG.find(x => x.key === k) || { taxable: 0, total: 0, freight: 0, items: [] };
    const lime = g('limestone'), pet = g('petcoke');
    const material = byG.reduce((a, x) => a + x.taxable, 0);
    const freight = byG.reduce((a, x) => a + x.freight, 0);
    const matBase = Math.max(1, material - freight);
    const pend = rows.filter(r => r.status === 'pending');
    // month-over-month total purchase spend
    const now = new Date();
    const ym = (y, m) => y + '-' + String(m + 1).padStart(2, '0');
    const curYM = ym(now.getFullYear(), now.getMonth());
    const pd = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevYM = ym(pd.getFullYear(), pd.getMonth());
    const sumYM = k => rows.filter(r => (r.date || '').slice(0, 7) === k).reduce((a, r) => a + r.taxable, 0);
    const cur = sumYM(curYM), prev = sumYM(prevYM);
    return {
      limeLanded: lime.taxable, petLanded: pet.taxable,
      petFreight: pet.freight, limeFreight: lime.freight,
      freight, material, freightPct: freight / matBase * 100,
      top: byG[0] || null,
      pendAmt: pend.reduce((a, r) => a + r.total, 0), pendCount: [...new Set(pend.map(r => r.sup))].length,
      itc: rows.reduce((a, r) => a + r.itc, 0),
      momCur: cur, momPrev: prev, momPct: prev > 0 ? (cur - prev) / prev * 100 : null
    };
  }

  /* ── Parties helpers ─────────────────────────────────────────── */
  function partyRows() {
    return S.PARTIES.map((p, i) => ({
      idx: i, name: p.name, gstin: p.gstin || '', phone: p.phone || '',
      address: p.address || '', state: p.state || '', type: p.type || 'customer', notes: p.notes || ''
    }));
  }
  function partySummary() {
    const r = partyRows();
    return {
      count: r.length,
      customers: r.filter(x => x.type === 'customer' || x.type === 'both').length,
      suppliers: r.filter(x => x.type === 'supplier' || x.type === 'both').length
    };
  }

  /* ── Labour helpers ──────────────────────────────────────────── */
  function labourRows() {
    return S.WORKERS.map((w, i) => {
      const c = cW(w);
      return { idx: i, name: w.name, desig: w.desig || '', wage: w.wage, freq: w.freq || 'daily', days: c.days, gross: c.gross, adv: w.adv || 0, net: c.net };
    });
  }
  function labourSummary() {
    const r = labourRows();
    return { count: r.length, gross: r.reduce((a, x) => a + x.gross, 0), adv: r.reduce((a, x) => a + x.adv, 0), net: r.reduce((a, x) => a + x.net, 0) };
  }

  /* ── Attendance ──────────────────────────────────────────────────
     ATT[workerId][dayNumber] ∈ P(resent) A(bsent) H(alf) L(eave) S(unday).
     Day-keyed (not date-keyed) — a single month grid, same model as v1.
     Unmarked weekday displays as P, Sunday as S (display default only). */
  const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  function attendanceData(ym) {
    const now = new Date();
    const y = ym ? +ym.slice(0, 4) : now.getFullYear();
    const m = ym ? +ym.slice(5, 7) - 1 : now.getMonth();
    const dim = new Date(y, m + 1, 0).getDate();
    const days = [];
    for (let d = 1; d <= dim; d++) { const dow = new Date(y, m, d).getDay(); days.push({ d, dow, dl: DOW[dow], isSun: dow === 0, isSat: dow === 6 }); }
    const monthLabel = new Date(y, m, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    const rows = S.WORKERS.map((w, i) => {
      const at = S.ATT[w.id] || {};
      const cells = days.map(({ d, dow, isSun }) => ({ d, isSun, status: at[d] || (dow === 0 ? 'S' : 'P') }));
      return {
        idx: i, id: w.id, name: w.name, desig: w.desig || 'Worker',
        cells,
        present: cells.filter(c => c.status === 'P' || c.status === 'H').length,
        leave: cells.filter(c => c.status === 'L').length,
        absent: cells.filter(c => c.status === 'A').length
      };
    });
    return { ym: `${y}-${String(m + 1).padStart(2, '0')}`, monthLabel, days, rows };
  }
  function setAtt(wid, day, status) { S.ATT[wid] = S.ATT[wid] || {}; S.ATT[wid][day] = status; commit(); }
  function cycleAtt(wid, day, curStatus) {        // curStatus = the cell's displayed status
    S.ATT[wid] = S.ATT[wid] || {};
    const nxt = { P: 'A', A: 'H', H: 'L', L: 'P', S: 'S' };
    S.ATT[wid][day] = nxt[curStatus] || 'P';
    commit();
  }
  function markAllAtt(status, dayNumbers) {
    S.WORKERS.forEach(w => { S.ATT[w.id] = S.ATT[w.id] || {}; dayNumbers.forEach(d => { S.ATT[w.id][d] = status; }); });
    commit();
  }

  /* ── Cashbook helpers ────────────────────────────────────────── */
  function cashbookRows() {
    return S.CASHBOOK.map((e, i) => ({ idx: i, date: e.date, type: e.type, mode: e.mode, category: e.category || '', party: e.party || '', amount: e.amount || 0, ref: e.ref || '', notes: e.notes || '' }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  function cashbookBalances() {
    const bal = m => {
      const cr = S.CASHBOOK.filter(e => e.mode === m && e.type === 'credit').reduce((s, e) => s + (e.amount || 0), 0);
      const dr = S.CASHBOOK.filter(e => e.mode === m && e.type === 'debit').reduce((s, e) => s + (e.amount || 0), 0);
      return cr - dr;
    };
    const cash = bal('cash'), phonepay = bal('phonepay'), bank = bal('bank');
    return { cash, phonepay, bank, total: cash + phonepay + bank, count: S.CASHBOOK.length };
  }

  /* ── Chunna (cash/PhonePe lime-powder sales) ─────────────────── */
  function chunnaRows() {
    return S.CHUNNA.map((c, i) => ({
      idx: i, date: c.date, customer: c.customer || 'Walk-in',
      qty: parseFloat(c.qty) || 0, rate: parseFloat(c.rate) || 0,
      total: parseFloat(c.total) || (parseFloat(c.qty) || 0) * (parseFloat(c.rate) || 0),
      mode: c.mode || 'cash'
    })).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  function chunnaSummary() {
    const r = chunnaRows();
    const ym = new Date().toISOString().slice(0, 7);
    return {
      count: r.length,
      qty: r.reduce((a, x) => a + x.qty, 0),
      total: r.reduce((a, x) => a + x.total, 0),
      monthTotal: r.filter(x => (x.date || '').slice(0, 7) === ym).reduce((a, x) => a + x.total, 0),
      cash: r.filter(x => x.mode === 'cash').reduce((a, x) => a + x.total, 0),
      phonepay: r.filter(x => x.mode === 'phonepay').reduce((a, x) => a + x.total, 0)
    };
  }
  function addChunna(e) {
    const qty = parseFloat(e.qty) || 0, rate = parseFloat(e.rate) || 0;
    S.CHUNNA.push({ id: 'CS' + idStamp(), date: e.date, customer: e.customer || 'Walk-in', qty, rate, total: +(qty * rate).toFixed(2), mode: e.mode || 'cash', photo: '' });
    commit();
  }
  function deleteChunna(i) { if (S.CHUNNA[i]) { S.CHUNNA.splice(i, 1); commit(); } }

  /* ── Loans helpers ───────────────────────────────────────────── */
  function loanRows() {
    return ALL_LOANS.filter(l => l.company === ACTIVE_CO).map((l, i) => {
      const insts = l.installments || [];
      const paid = insts.filter(x => x.paid).length;
      const nextDue = insts.find(x => !x.paid);
      const outstanding = insts.filter(x => !x.paid).reduce((s, x) => s + (x.amount || 0), 0);
      return {
        idx: i, name: l.name || l.bank || 'Loan', bank: l.bank || '', principal: l.principal || 0, emi: l.emi || 0,
        paid, total: insts.length, outstanding,
        nextDue: nextDue ? nextDue.dueDate : null, nextAmt: nextDue ? nextDue.amount : 0,
        nextDays: nextDue && nextDue.dueDate ? daysAgo(nextDue.dueDate) : null
      };
    });
  }
  function loanSummary() {
    const r = loanRows();
    return {
      count: r.length,
      principal: r.reduce((a, x) => a + x.principal, 0),
      outstanding: r.reduce((a, x) => a + x.outstanding, 0),
      monthlyEmi: r.reduce((a, x) => a + x.emi, 0)
    };
  }

  /* ── Payments Center — ONE unified money ledger over CASHBOOK ──
     Every payment (sales receipt, supplier payment, expense, salary, EMI,
     transfer, partner draw) posts ONE cashbook entry carrying its type,
     party, ref, method and a link to what it settles. Balances and the
     Payments timeline are derived from that single source, so nothing is
     double-counted and one payment updates every related module. */
  const PAY_METHODS = ['Cash', 'Bank', 'PhonePe', 'Google Pay', 'UPI', 'Cheque', 'NEFT', 'RTGS', 'IMPS'];
  const PAY_TYPES = ['Sales Payment', 'Purchase Payment', 'Expense', 'Salary', 'Loan EMI', 'Cash Deposit', 'Cash Withdrawal', 'Bank Transfer', 'UPI Transfer', 'Partner Withdrawal', 'Partner Investment', 'Other'];
  function methodToMode(m) { m = (m || '').toString().toLowerCase(); if (/cash/.test(m)) return 'cash'; if (/phonep|google|gpay|upi/.test(m)) return 'upi'; return 'bank'; }
  function modeToMethod(m) { return { cash: 'Cash', bank: 'Bank', upi: 'UPI', phonepay: 'PhonePe' }[m] || 'Bank'; }
  function accountBalances() {
    const openA = (S.FINANCE && S.FINANCE.opening) || {};
    const bucket = b => S.CASHBOOK.reduce((s, e) => methodToMode(e.method || e.mode) !== b ? s : s + (e.type === 'credit' ? 1 : -1) * (+e.amount || 0), +openA[b] || 0);
    const cash = bucket('cash'), bank = bucket('bank'), upi = bucket('upi');
    return { cash, bank, upi, total: cash + bank + upi };
  }
  function paymentsLedger() {
    const asc = S.CASHBOOK.map((e, i) => ({
      id: e.id || ('cb' + i), idx: i, date: e.date || '',
      party: e.party || e.category || '—', ptype: e.ptype || (e.type === 'credit' ? 'Receipt' : 'Payment'),
      ref: e.ref || '', method: e.method || modeToMethod(e.mode), mode: methodToMode(e.method || e.mode),
      dir: e.type === 'credit' ? 'in' : 'out',
      credit: e.type === 'credit' ? (+e.amount || 0) : 0, debit: e.type === 'debit' ? (+e.amount || 0) : 0,
      amount: +e.amount || 0, status: e.status || 'Completed', notes: e.notes || '', link: e.link || null, category: e.category || ''
    })).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.idx - b.idx));
    let run = 0; asc.forEach(e => { run += e.credit - e.debit; e.balance = run; });
    return asc.reverse();   // latest first for the table
  }
  function paymentsSummary() {
    const today = fmtISO(new Date()), led = paymentsLedger(), bal = accountBalances();
    const inToday = led.filter(e => e.date === today).reduce((s, e) => s + e.credit, 0);
    const outToday = led.filter(e => e.date === today).reduce((s, e) => s + e.debit, 0);
    const sales = salesRows(), purch = purchaseRows();
    const custOutstanding = sales.reduce((s, r) => s + (r.status === 'cancelled' ? 0 : r.outstanding), 0);
    const openBills = purch.filter(r => r.status !== 'paid' && r.status !== 'cancelled');
    return { inToday, outToday, custOutstanding, supOutstanding: openBills.reduce((s, r) => s + r.outstanding, 0), cash: bal.cash, bank: bal.bank, upi: bal.upi, total: bal.total, pendingBills: openBills.length, count: led.length };
  }
  function receiveSalesPayment(i, o) {
    const s = S.SALES[i]; if (!s) return; o = o || {};
    const c = cS(s), amount = +o.amount || 0;
    const prev = (s.status === 'paid' || s.status === 'cash') ? c.tot : (+s.paid || 0);
    const paid = Math.min(c.tot, prev + amount);
    s.paid = paid; s.status = paid >= c.tot - 0.5 ? 'paid' : (paid > 0 ? 'partial' : 'pending');
    s.paidDate = o.date || fmtISO(new Date()); s.paidMode = o.method || 'Bank';
    s.payments = (s.payments || []).concat([{ date: s.paidDate, amount, method: o.method || 'Bank' }]);
    S.CASHBOOK.push({ id: 'cb' + idStamp(), date: s.paidDate, type: 'credit', mode: methodToMode(o.method), method: o.method || 'Bank', ptype: 'Sales Payment', party: s.party || '—', ref: o.ref || s.inv || '', amount, notes: o.notes || '', link: { kind: 'sale', idx: i } });
    commit();
  }
  function payPurchaseBill(i, o) { o = o || {}; recordPurchasePayment(i, o.amount, methodToMode(o.method), o.date, { method: o.method, ref: o.ref, notes: o.notes }); }
  function addLedgerPayment(o) {
    o = o || {};
    S.CASHBOOK.push({ id: 'cb' + idStamp(), date: o.date || fmtISO(new Date()), type: o.dir === 'in' ? 'credit' : 'debit', mode: methodToMode(o.method), method: o.method || 'Cash', ptype: o.ptype || 'Other', party: o.party || '—', ref: o.ref || '', amount: +o.amount || 0, notes: o.notes || '', category: o.category || '', link: o.link || null });
    commit();
  }
  function addTransfer(o) {
    o = o || {}; const amt = +o.amount || 0, date = o.date || fmtISO(new Date());
    const ref = o.ref || ((o.fromMethod || '') + ' → ' + (o.toMethod || '')), party = o.party || 'Self transfer', ptype = o.ptype || 'Bank Transfer';
    S.CASHBOOK.push({ id: 'cb' + idStamp(), date, type: 'debit', mode: methodToMode(o.fromMethod), method: o.fromMethod || 'Cash', ptype, party, ref, amount: amt, notes: o.notes || '', link: { kind: 'transfer' } });
    S.CASHBOOK.push({ id: 'cb' + idStamp(), date, type: 'credit', mode: methodToMode(o.toMethod), method: o.toMethod || 'Bank', ptype, party, ref, amount: amt, notes: o.notes || '', link: { kind: 'transfer' } });
    commit();
  }
  function saveLoans() { try { localStorage.setItem('dm_loans', JSON.stringify(ALL_LOANS)); } catch (_) {} }
  function payLoanEmi(i, o) {
    o = o || {}; const loans = ALL_LOANS.filter(l => l.company === ACTIVE_CO), l = loans[i]; if (!l) return;
    const insts = l.installments || [], nx = insts.find(x => !x.paid);
    if (nx) { nx.paid = true; nx.paidDate = o.date || fmtISO(new Date()); }
    const amt = +o.amount || (nx ? nx.amount : l.emi) || 0;
    S.CASHBOOK.push({ id: 'cb' + idStamp(), date: o.date || fmtISO(new Date()), type: 'debit', mode: methodToMode(o.method), method: o.method || 'Bank', ptype: 'Loan EMI', party: l.name || l.bank || 'Loan', ref: o.ref || '', amount: amt, notes: o.notes || '', link: { kind: 'loan', idx: i } });
    saveLoans(); commit();
  }
  function deleteLedgerEntry(i) { if (S.CASHBOOK[i]) { S.CASHBOOK.splice(i, 1); commit(); } }
  function paymentsInsights() {
    const out = [], today = fmtISO(new Date()), led = paymentsLedger();
    const recv = salesRows().filter(r => r.status !== 'cancelled' && r.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding);
    if (recv[0]) out.push({ tone: 'warn', icon: '💰', text: `${recv[0].party} owes you ${fC(recv[0].outstanding)} — your largest receivable.` });
    const purch = purchaseRows().filter(r => r.status !== 'paid' && r.status !== 'cancelled' && r.dueDate);
    const weekEnd = fmtISO(new Date(Date.now() + 7 * 864e5));
    const dueWk = purch.filter(r => r.dueDate <= weekEnd);
    if (dueWk.length) out.push({ tone: 'info', icon: '📅', text: `${dueWk.length} supplier bill${dueWk.length > 1 ? 's' : ''} (${fC(dueWk.reduce((s, r) => s + r.outstanding, 0))}) due within a week.` });
    const big = led.filter(e => e.date === today).sort((a, b) => b.amount - a.amount)[0];
    if (big) out.push({ tone: 'ok', icon: '⭐', text: `Largest transaction today: ${big.ptype} ${fC(big.amount)} — ${big.party}.` });
    const emi = loanRows().filter(l => l.nextDue).sort((a, b) => (a.nextDue || '').localeCompare(b.nextDue || ''))[0];
    if (emi) out.push({ tone: 'info', icon: '🏦', text: `Next EMI ${fC(emi.nextAmt)} to ${emi.name}${emi.nextDue ? ' on ' + fDS(emi.nextDue) : ''}.` });
    const bal = accountBalances();
    if (bal.cash < 20000) out.push({ tone: 'bad', icon: '⚠️', text: `Cash running low: ${fC(bal.cash)}. Prioritise collections.` });
    return out;
  }

  /* ── Amount in words (Indian numbering — ported from v1 wn) ──── */
  function amountInWords(n) {
    n = Math.round(n);
    const o = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const t = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const h = x => { let s = ''; if (x > 99) { s += o[Math.floor(x / 100)] + ' Hundred '; x %= 100; } if (x > 19) s += t[Math.floor(x / 10)] + ' ' + o[x % 10]; else s += o[x]; return s.trim(); };
    let s = '', cr = Math.floor(n / 10000000), lk = Math.floor((n % 10000000) / 100000), th = Math.floor((n % 100000) / 1000), hu = n % 1000;
    if (cr) s += h(cr) + ' Crore '; if (lk) s += h(lk) + ' Lakh '; if (th) s += h(th) + ' Thousand '; if (hu) s += h(hu);
    return 'Rupees ' + (s.trim() || 'Zero') + ' Only';
  }

  /* ── Invoice data for a sale (everything a tax invoice needs) ── */
  function invoiceData(idx) {
    const s = S.SALES[idx]; if (!s) return null;
    const seller = COMPANIES[ACTIVE_CO];
    const taxable = (s.qty || 0) * (s.rate || 0);
    const rate = s.gstR != null ? s.gstR : 5;
    const cgst = taxable * rate / 200, sgst = taxable * rate / 200, total = taxable + cgst + sgst;
    const interState = s.gstin && s.gstin.length >= 2 && s.gstin.slice(0, 2) !== '08';   // seller is 08 (Rajasthan)
    return {
      seller, hsn: s.hsn || seller.hsn || HSN,
      buyer: { name: s.party || '', gstin: s.gstin || '', address: s.addr || '', state: s.state || '' },
      inv: s.inv, date: s.date, product: s.product || 'Quick Lime', qty: s.qty || 0, rate: s.rate || 0,
      unit: s.unit || 'Tonne', veh: s.veh || '', eway: s.eway || '', gstR: rate,
      transport: s.transport || '', station: s.station || '', grrr: s.grrr || '',
      taxable, cgst, sgst, igst: interState ? cgst + sgst : 0, interState,
      total, roundOff: Math.round(total) - total, grand: Math.round(total),
      words: amountInWords(Math.round(total))
    };
  }

  /* ── GST summary ─────────────────────────────────────────────── */
  function gstSummary() {
    const ts = totS(), tp = totP();
    return { outGST: ts.cgst + ts.sgst, cgst: ts.cgst, sgst: ts.sgst, itc: tp.itc, net: Math.max(0, (ts.cgst + ts.sgst) - tp.itc), taxable: ts.tx, purchaseTaxable: tp.tx };
  }

  /* ── TDS (tax deducted at source) ────────────────────────────── */
  function tdsRows() {
    return S.TDS.map((e, i) => {
      const amount = +e.amount || 0, rate = +e.rate || 0;
      const tds = e.tds != null ? +e.tds : +(amount * rate / 100).toFixed(2);
      return { idx: i, date: e.date, party: e.party || '', pan: e.pan || '', sec: e.sec || e.secLabel || '—', rate, amount, tds, net: e.net != null ? +e.net : amount - tds, remarks: e.remarks || '' };
    }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  function tdsSummary() {
    const r = tdsRows();
    return { count: r.length, amount: r.reduce((a, x) => a + x.amount, 0), tds: r.reduce((a, x) => a + x.tds, 0), net: r.reduce((a, x) => a + x.net, 0) };
  }
  function addTds(e) {
    const amount = +e.amount || 0, rate = +e.rate || 0, tds = +(amount * rate / 100).toFixed(2);
    S.TDS.push({ id: 'tds' + idStamp(), date: e.date, party: e.party || '', pan: (e.pan || '').toUpperCase(), sec: e.sec || '194C', secLabel: e.sec || '194C', rate, amount, tds, net: amount - tds, remarks: e.remarks || '' });
    commit();
  }
  function updateTds(i, e) {
    if (!S.TDS[i]) return;
    const amount = +e.amount || 0, rate = +e.rate || 0, tds = +(amount * rate / 100).toFixed(2);
    S.TDS[i] = { ...S.TDS[i], date: e.date, party: e.party, pan: (e.pan || '').toUpperCase(), sec: e.sec, secLabel: e.sec, rate, amount, tds, net: amount - tds, remarks: e.remarks || '' };
    commit();
  }
  function deleteTds(i) { if (S.TDS[i]) { S.TDS.splice(i, 1); commit(); } }

  /* ── Monthly register (combined sales + purchase by month) ───── */
  function monthlyRegister() {
    const months = [...new Set([...S.SALES.map(s => ymOf(s.date)), ...S.PURCHASES.map(p => ymOf(p.date))].filter(Boolean))].sort().reverse();
    return months.map(ym => {
      const sal = S.SALES.filter(s => ymOf(s.date) === ym);
      const pur = S.PURCHASES.filter(p => ymOf(p.date) === ym);
      const sTx = sal.reduce((a, s) => a + cS(s).tx, 0);
      const sTot = sal.reduce((a, s) => a + cS(s).tot, 0);
      const pTx = pur.reduce((a, p) => a + p.taxable, 0);
      const qty = sal.reduce((a, s) => a + (s.qty || 0), 0);
      const [y, m] = ym.split('-');
      return {
        ym, label: new Date(+y, +m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
        invoices: sal.length, bills: pur.length, qty, salesTax: sTx, salesTotal: sTot, purchaseTax: pTx, profit: sTx - pTx
      };
    });
  }
  function monthlyRegisterTotals() {
    return monthlyRegister().reduce((a, m) => ({ invoices: a.invoices + m.invoices, bills: a.bills + m.bills, qty: a.qty + m.qty, salesTotal: a.salesTotal + m.salesTotal, purchaseTax: a.purchaseTax + m.purchaseTax, profit: a.profit + m.profit }), { invoices: 0, bills: 0, qty: 0, salesTotal: 0, purchaseTax: 0, profit: 0 });
  }

  /* ── Custom renewal reminders (localStorage, per plant) ──────── */
  const RENEW_KEY = () => 'ql_renewals_' + ACTIVE_CO;
  function getRenewals() { try { return JSON.parse(localStorage.getItem(RENEW_KEY()) || '[]'); } catch (_) { return []; } }
  function addRenewal(r) { const a = getRenewals(); a.push({ id: idStamp(), title: r.title, date: r.date || '', amount: +r.amount || 0 }); localStorage.setItem(RENEW_KEY(), JSON.stringify(a)); }
  function removeRenewal(id) { localStorage.setItem(RENEW_KEY(), JSON.stringify(getRenewals().filter(x => String(x.id) !== String(id)))); }

  /* ── Notifications (business alerts derived from live data) ───── */
  function notifications() {
    const out = [], me = COMPANIES[ACTIVE_CO].short;
    const phoneOf = nm => { const p = S.PARTIES.find(x => (x.name || '').toUpperCase() === (nm || '').toUpperCase()); return p ? (p.phone || '') : ''; };
    // 1) Pending / overdue collections, grouped by party
    collections('all').rows.forEach(r => {
      if (r.days < 7) return;
      const overdue = r.days > 30;
      out.push({
        id: 'coll:' + r.party, type: 'collection', priority: overdue ? 'high' : 'medium',
        title: r.party, sub: `${r.bills} bill${r.bills > 1 ? 's' : ''} pending · oldest ${r.days}d`,
        amount: r.total, party: r.party, due: r.oldest, days: r.days,
        page: 'sales.html?filter=pending', phone: phoneOf(r.party),
        wa: `Dear ${r.party},\nGentle reminder: ${fC(r.total)} (${r.bills} bill${r.bills > 1 ? 's' : ''}) is pending with us. Kindly arrange payment at your earliest.\nThank you,\n${me}`
      });
    });
    // 2) Supplier payments due
    const bySup = {};
    S.PURCHASES.filter(p => (p.status || 'pending') === 'pending').forEach(p => {
      const k = p.sup || '—'; bySup[k] = bySup[k] || { sup: k, total: 0, bills: 0, oldest: p.date };
      bySup[k].total += cP(p).tot; bySup[k].bills++; if ((p.date || '') < bySup[k].oldest) bySup[k].oldest = p.date;
    });
    Object.values(bySup).forEach(s2 => out.push({
      id: 'pay:' + s2.sup, type: 'payment', priority: 'medium',
      title: 'Pay ' + s2.sup, sub: `${s2.bills} supplier bill${s2.bills > 1 ? 's' : ''} due`,
      amount: s2.total, party: s2.sup, due: s2.oldest, days: daysAgo(s2.oldest),
      page: 'purchase.html', phone: phoneOf(s2.sup)
    }));
    // 3) GST payable → GSTR-3B filing reminder
    const g = gstSummary();
    if (g.net > 0) out.push({ id: 'gst', type: 'gst', priority: 'high', title: 'GST payable ' + fC(g.net), sub: 'File GSTR-3B & pay before the 20th', amount: g.net, page: 'gst.html' });
    // 4) Loan EMIs coming due / overdue
    loanRows().forEach(l => {
      if (!l.nextDue || l.outstanding <= 0) return;
      const d = daysAgo(l.nextDue);
      out.push({ id: 'loan:' + l.idx, type: 'loan', priority: d >= -7 ? 'high' : 'medium', title: 'EMI ' + fC(l.nextAmt), sub: `${l.name} · due ${fDS(l.nextDue)}`, amount: l.nextAmt, due: l.nextDue, days: d, page: 'loans.html' });
    });
    // 5) Custom renewals (domain / hosting / subscription)
    getRenewals().forEach(r => {
      const d = r.date ? daysAgo(r.date) : null;
      out.push({ id: 'rem:' + r.id, type: 'renewal', priority: (d != null && d >= -10) ? 'high' : 'low', title: r.title, sub: r.date ? ('Renews ' + fDS(r.date)) : 'Reminder', amount: r.amount || 0, due: r.date, days: d, custom: true, rid: r.id });
    });
    // 6) Scheduled reports that are due (reminder-based — tap to generate & send)
    try {
      const today = new Date().toISOString().slice(0, 10);
      getSchedules().forEach(s => {
        if (s.nextDue && s.nextDue <= today) {
          const rt = (REPORT_TYPES.find(x => x.id === s.type) || {}).name || s.type;
          out.push({ id: 'sched:' + s.id, type: 'renewal', priority: 'high', title: `Send ${rt} report`, sub: `${s.freq} report due — generate & share`, page: 'reports.html', due: s.nextDue });
        }
      });
    } catch (_) {}
    const rank = { high: 0, medium: 1, low: 2 };
    return out.sort((a, b) => rank[a.priority] - rank[b.priority] || (b.amount || 0) - (a.amount || 0));
  }

  /* ── AI recommendations (Command Center) ─────────────────────── */
  function recommendations() {
    const out = [], coll = collections('all'), pl = getPL(), g = gstSummary();
    const top = coll.rows[0];
    if (top && top.days > 30) out.push({ tone: 'danger', icon: '💰', title: `Collect ${fC(top.total)} from ${top.party}`, detail: `${top.bills} bill${top.bills > 1 ? 's' : ''}, oldest ${top.days} days — send a reminder today.`, action: { label: 'Collections', page: 'sales.html?filter=pending' } });
    if (g.net > 0) out.push({ tone: 'warning', icon: '🏛️', title: `Pay GST ${fC(g.net)} before the 20th`, detail: 'File GSTR-3B to stay compliant.', action: { label: 'GST', page: 'gst.html' } });
    const pendPur = S.PURCHASES.filter(p => (p.status || 'pending') === 'pending');
    if (pendPur.length) { const t = pendPur.reduce((a, p) => a + cP(p).tot, 0); out.push({ tone: 'info', icon: '🧾', title: `${fC(t)} due to suppliers`, detail: `${pendPur.length} bill${pendPur.length > 1 ? 's' : ''} pending payment.`, action: { label: 'Purchases', page: 'purchase.html' } }); }
    const ser = monthSeries(2);
    if (ser[1] && ser[0] && ser[0].sales > 0) { const mom = (ser[1].sales - ser[0].sales) / ser[0].sales * 100; if (mom < -10) out.push({ tone: 'danger', icon: '📉', title: `Sales down ${Math.abs(mom).toFixed(0)}% this month`, detail: `${fL(ser[1].sales)} vs ${fL(ser[0].sales)} last month — push dispatch & follow up orders.`, action: { label: 'Sales', page: 'sales.html' } }); }
    const overdueLoan = loanRows().find(l => l.nextDays != null && l.nextDays >= -7 && l.outstanding > 0);
    if (overdueLoan) out.push({ tone: 'warning', icon: '🏦', title: `Loan EMI ${fC(overdueLoan.nextAmt)} due`, detail: `${overdueLoan.name} · ${fDS(overdueLoan.nextDue)}`, action: { label: 'Loans', page: 'loans.html' } });
    const cb = cashbookBalances(); if (cb.total < 50000) out.push({ tone: 'warning', icon: '💵', title: `Cash balance low: ${fC(cb.total)}`, detail: 'Prioritise collections to ease cash flow.', action: { label: 'Cash Book', page: 'cashbook.html' } });
    if (pl.npm > 0) out.push({ tone: 'success', icon: '✅', title: `Healthy ${pl.npm.toFixed(0)}% net margin`, detail: `${fC(pl.np)} net profit on ${fC(pl.rev)} sales.`, action: { label: 'P&L', page: 'pl.html' } });
    return out.slice(0, 6);
  }

  /* ═══════════ REPORTING & AUTOMATION HUB ═══════════════════════ */
  const REPORT_TYPES = [
    { id: 'sales', name: 'Sales Summary', icon: '📈' },
    { id: 'purchase', name: 'Purchase Summary', icon: '🛒' },
    { id: 'collections', name: 'Pending Collections', icon: '💰' },
    { id: 'outstanding', name: 'Outstanding Payments', icon: '⏳' },
    { id: 'pl', name: 'Profit & Loss', icon: '📊' },
    { id: 'gst', name: 'GST Summary', icon: '🏛️' },
    { id: 'production', name: 'Production / Dispatch', icon: '🏭' },
    { id: 'topcustomers', name: 'Top Customers', icon: '⭐' },
    { id: 'topsuppliers', name: 'Top Suppliers', icon: '🚚' },
    { id: 'cashflow', name: 'Cash Flow Summary', icon: '💵' }
  ];
  function buildReport(type, from, to) {
    const inR = d => (!from || (d || '') >= from) && (!to || (d || '') <= to);
    const period = from || to ? `${from ? fDS2(from) : 'start'} – ${to ? fDS2(to) : 'today'}` : 'All time';
    const meta = REPORT_TYPES.find(r => r.id === type) || { name: type };
    let headers = [], rows = [], totals = null, kpis = [];
    if (type === 'sales') {
      const r = salesRows().filter(x => inR(x.date));
      headers = ['Invoice', 'Date', 'Party', 'Qty (T)', 'Taxable', 'GST', 'Total', 'Status'];
      rows = r.map(x => [x.inv, x.date, x.party, x.qty, x.taxable, x.gst, x.total, x.status]);
      const tx = r.reduce((a, x) => a + x.taxable, 0), gst = r.reduce((a, x) => a + x.gst, 0), tot = r.reduce((a, x) => a + x.total, 0);
      totals = ['Total', '', r.length + ' inv', r.reduce((a, x) => a + x.qty, 0), tx, gst, tot, ''];
      kpis = [['Invoices', r.length], ['Taxable sales', fC(tx)], ['GST', fC(gst)], ['Total', fC(tot)]];
    } else if (type === 'purchase') {
      const r = purchaseRows().filter(x => inR(x.date));
      headers = ['Bill', 'Date', 'Supplier', 'Category', 'Taxable', 'GST', 'ITC', 'Total', 'Status'];
      rows = r.map(x => [x.bill, x.date, x.sup, x.cat, x.taxable, x.gst, x.itc, x.total, x.status]);
      const tx = r.reduce((a, x) => a + x.taxable, 0), itc = r.reduce((a, x) => a + x.itc, 0);
      totals = ['Total', '', r.length + ' bills', '', tx, r.reduce((a, x) => a + x.gst, 0), itc, r.reduce((a, x) => a + x.total, 0), ''];
      kpis = [['Bills', r.length], ['Taxable', fC(tx)], ['ITC', fC(itc)]];
    } else if (type === 'collections' || type === 'outstanding') {
      const c = collections('all');
      headers = ['Party', 'Bills', 'Outstanding', 'Oldest', 'Days'];
      rows = c.rows.map(x => [x.party, x.bills, x.total, x.oldest, x.days]);
      totals = ['Total', '', c.total, '', ''];
      kpis = [['Parties', c.parties], ['Outstanding', fC(c.total)], ['Overdue 30d+', c.overdue]];
    } else if (type === 'pl') {
      const p = getPL();
      headers = ['Line', 'Amount'];
      rows = [['Revenue (taxable)', p.rev], ['Less: Material cost', -p.cogs], ['Gross profit', p.gp], ['Less: Labour', -p.labour], ['EBITDA', p.ebitda], ['Less: Net GST', -p.netGST], ['Net profit', p.np]];
      kpis = [['Revenue', fC(p.rev)], ['Gross profit', fC(p.gp) + ' (' + p.gpm.toFixed(1) + '%)'], ['Net profit', fC(p.np) + ' (' + p.npm.toFixed(1) + '%)']];
    } else if (type === 'gst') {
      const g = gstSummary();
      headers = ['Particulars', 'Amount'];
      rows = [['CGST (output)', g.cgst], ['SGST (output)', g.sgst], ['Total output GST', g.outGST], ['Less: Input tax credit', -g.itc], ['Net GST payable', g.net], ['Taxable sales', g.taxable], ['Taxable purchases', g.purchaseTaxable]];
      kpis = [['Output GST', fC(g.outGST)], ['ITC', fC(g.itc)], ['Net payable', fC(g.net)]];
    } else if (type === 'production') {
      const pr = production(), ser = monthSeries(6);
      headers = ['Month', 'Dispatch (T)', 'Invoices'];
      rows = ser.slice().reverse().map(m => [m.m, +m.qty.toFixed(1), m.invoices]);
      kpis = [['Today', fmt(pr.today, 1) + ' T'], ['This month', fmt(pr.month, 1) + ' T'], ['Chunna (month)', fmt(pr.chunnaMonth, 1) + ' T']];
    } else if (type === 'topcustomers') {
      const by = {}; salesRows().filter(x => inR(x.date)).forEach(x => { by[x.party] = (by[x.party] || 0) + x.total; });
      const list = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 20);
      headers = ['#', 'Customer', 'Total'];
      rows = list.map((x, i) => [i + 1, x[0], x[1]]);
      kpis = [['Customers', Object.keys(by).length], ['Top', list[0] ? list[0][0] : '—']];
    } else if (type === 'topsuppliers') {
      const by = {}; purchaseRows().filter(x => inR(x.date)).forEach(x => { by[x.sup] = (by[x.sup] || 0) + x.taxable; });
      const list = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 20);
      headers = ['#', 'Supplier', 'Taxable'];
      rows = list.map((x, i) => [i + 1, x[0], x[1]]);
      kpis = [['Suppliers', Object.keys(by).length], ['Top', list[0] ? list[0][0] : '—']];
    } else if (type === 'cashflow') {
      const b = cashbookBalances(), r = cashbookRows().filter(x => inR(x.date));
      const inn = r.filter(x => x.type === 'credit').reduce((a, x) => a + x.amount, 0), out = r.filter(x => x.type === 'debit').reduce((a, x) => a + x.amount, 0);
      headers = ['Date', 'Party / Note', 'Mode', 'In/Out', 'Amount'];
      rows = r.map(x => [x.date, x.party || x.notes, x.mode, x.type === 'credit' ? 'In' : 'Out', x.amount]);
      totals = ['', '', '', 'Net', inn - out];
      kpis = [['Money in', fC(inn)], ['Money out', fC(out)], ['Balance', fC(b.total)]];
    }
    return { id: type, title: meta.name, icon: meta.icon, period, kpis, headers, rows, totals, count: rows.length };
  }
  function fDS2(s) { const d = parseD(s); return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : s; }

  // Distribution groups (localStorage per plant)
  const GROUP_KEY = () => 'ql_report_groups_' + ACTIVE_CO;
  function defaultGroups() { return [{ id: 'ca', name: 'CA Group', members: [] }, { id: 'mgmt', name: 'Management', members: [] }, { id: 'sales', name: 'Sales Team', members: [] }]; }
  function getGroups() { try { const g = JSON.parse(localStorage.getItem(GROUP_KEY()) || 'null'); return Array.isArray(g) && g.length ? g : defaultGroups(); } catch (_) { return defaultGroups(); } }
  function saveGroups(g) { localStorage.setItem(GROUP_KEY(), JSON.stringify(g)); }

  // Scheduled report configs (reminder-based, no server cron)
  const SCHED_KEY = () => 'ql_report_sched_' + ACTIVE_CO;
  function getSchedules() { try { return JSON.parse(localStorage.getItem(SCHED_KEY()) || '[]'); } catch (_) { return []; } }
  function saveSchedules(s) { localStorage.setItem(SCHED_KEY(), JSON.stringify(s)); }

  /* ── Public API ──────────────────────────────────────────────── */
  window.QLD = {
    plant: QL_PLANT, COMPANIES,
    get activeCo() { return ACTIVE_CO; },
    get co() { return COMPANIES[ACTIVE_CO]; },
    state: S,
    fmt, fC, fL, fDS, daysAgo, cS,
    kpis, monthSeries, collections, insights, production, topProducts, activity,
    salesRows, salesSummary,
    purchaseRows, purchaseSummary, partyRows, partySummary,
    purchaseGroups: PURCHASE_GROUPS, departments: DEPARTMENTS, purchaseByGroup, purchaseInsights,
    recordPurchasePayment, billInsights, relatedBills, itemIcon,
    // ── Payments Center (one unified money ledger) ──
    paymentsLedger, paymentsSummary, paymentsInsights, accountBalances,
    receiveSalesPayment, payPurchaseBill, addLedgerPayment, addTransfer, payLoanEmi, deleteLedgerEntry,
    paymentMethods: PAY_METHODS, paymentTypes: PAY_TYPES, methodToMode,
    labourRows, labourSummary, cashbookRows, cashbookBalances,
    loanRows, loanSummary, gstSummary,
    getPL, chunnaRows, chunnaSummary, attendanceData,
    tdsRows, tdsSummary, monthlyRegister, monthlyRegisterTotals,
    invoiceData, amountInWords,
    notifications, getRenewals, addRenewal, removeRenewal, recommendations,
    REPORT_TYPES, buildReport, getGroups, saveGroups, getSchedules, saveSchedules,

    // ── Finance + GST Portal ──
    get finance() { return (S.FINANCE || (S.FINANCE = defaultFinance())); },
    saveFinance() { commit(); },

    // ── Bank reconciliation ──
    get recon() { return (S.RECON || (S.RECON = { txns: [] })); },
    saveRecon() { commit(); try { if (window.QLReconAPI) window.QLReconAPI.mirror(ACTIVE_CO, S.RECON); } catch (_) {} },

    // ── Writes (persist local immediately + cloud debounced) ──
    commit, saveLocal,
    upsertParty, deleteParty,
    addSale, updateSale, deleteSale, setSaleStatus,
    addPurchase, updatePurchase, deletePurchase, setPurchaseStatus,
    addWorker, updateWorker, deleteWorker,
    addCashEntry, deleteCashEntry,
    addChunna, deleteChunna,
    setAtt, cycleAtt, markAllAtt,
    addTds, updateTds, deleteTds,

    async init(render) {
      loadLocal();
      loadLoansLocal();
      render();                                   // instant paint from local cache
      try {
        DB = window.supabase.createClient(SUPA_URL, SUPA_KEY);
        const [okData, okLoans] = await Promise.all([pullCloud(), pullLoansCloud()]);
        if (okData || okLoans) render();          // refresh with authoritative data
      } catch (e) { console.warn('v2 supabase init failed', e); }
    },

    async switchCompany(id, render) {
      if (!COMPANIES[id] || id === ACTIVE_CO) return;
      ACTIVE_CO = id;
      localStorage.setItem('dm_active_co', id);
      loadLocal();
      render();                                   // loans are global; just re-filter by company
      const ok = await pullCloud();
      if (ok) render();
    }
  };
})();
