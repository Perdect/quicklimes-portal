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

  /* ── Companies from the plants[] array (parent + children) ──── */
  const plants = (Array.isArray(QL_PLANT.plants) && QL_PLANT.plants.length) ? QL_PLANT.plants : [QL_PLANT];
  const COMPANIES = {};
  plants.forEach(p => {
    COMPANIES[p.id] = {
      key: p.id,
      name: (p.plant_name || 'Your Plant').toUpperCase(),
      short: p.plant_name || 'Your Plant',
      city: p.city || '',
      gstin: p.gst_number || '',
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
    TDS: [], CHALLANS: [], PARTIES: [], CASHBOOK: [], LOANS: [], CHUNNA: []
  };
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
      cashbook: S.CASHBOOK, chunna: S.CHUNNA
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
      sales:       { v: fC(ts.tot), trend: mom(cur.sales, prev.sales), meta: S.SALES.length + ' invoices · all time' },
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
      return {
        idx: i, inv: s.inv, date: s.date, party: s.party || '—',
        qty: s.qty || 0, taxable: c.tx, gst: c.cgst + c.sgst, total: c.tot,
        status: s.status || 'pending', veh: s.veh || '', gstin: s.gstin || '',
        days: daysAgo(s.date)
      };
    });
  }
  function salesSummary() {
    const rows = salesRows();
    const paid = rows.filter(r => r.status === 'paid' || r.status === 'cash');
    return {
      count: rows.length,
      revenue: rows.reduce((a, r) => a + r.total, 0),
      collected: paid.reduce((a, r) => a + r.total, 0),
      pending: rows.filter(r => r.status === 'pending').reduce((a, r) => a + r.total, 0),
      gst: rows.reduce((a, r) => a + r.gst, 0),
      qty: rows.reduce((a, r) => a + r.qty, 0)
    };
  }

  /* ── Purchase register helpers ───────────────────────────────── */
  function purchaseRows() {
    return S.PURCHASES.map((p, i) => {
      const c = cP(p);
      return {
        idx: i, bill: p.bill, date: p.date, sup: p.sup || '—', cat: p.cat || 'Other',
        taxable: p.taxable, gst: c.g, itc: c.itc, total: c.tot,
        status: p.status || 'pending', gstin: p.gstin || '', days: daysAgo(p.date)
      };
    });
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
    labourRows, labourSummary, cashbookRows, cashbookBalances,
    loanRows, loanSummary, gstSummary,
    getPL, chunnaRows, chunnaSummary, attendanceData,
    tdsRows, tdsSummary, monthlyRegister, monthlyRegisterTotals,

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
