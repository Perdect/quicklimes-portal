/* ═══════════════════════════════════════════════════════════════
   QuickLimes v2 — Data Layer (QLD)
   Ports the v1 production data logic into a clean module the v2
   pages consume: auth guard, multi-plant companies, local+cloud
   persistence, calculation helpers and dashboard aggregates.
   Depends on supabase-js (CDN) being loaded first.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Party identity ──────────────────────────────────────────
     Every "group by supplier/customer" in this app must go through here. Keying
     a party by the raw name string is what put "RAMKARAN AND SONS" and
     "Ramkaran and Sons" (one firm, GSTIN 08AIUPB9022D1ZB) on two rows with their
     outstanding split between them. See party-identity.js for the rules.

     Resolved lazily so load order can't bite, and so the node tests that
     require() data.js directly still work. The fallback normalises case rather
     than throwing: a blank dashboard is worse than an imperfect one, and it can
     only ever be BETTER than the raw-string keying it replaces — but it should
     never fire, since party-identity.js is wired into all 30 pages. */
  function QLP() {
    if (typeof QLParty !== 'undefined' && QLParty) return QLParty;
    if (typeof window !== 'undefined' && window.QLParty) return window.QLParty;
    if (typeof require === 'function') { try { return require('./party-identity.js'); } catch (e) { /* browser */ } }
    return null;
  }
  function partyIndex(rows, nameOf, gstinOf) {
    const P = QLP();
    if (P) return P.index(rows, nameOf, gstinOf);
    const up = s => String(s == null ? '' : s).toUpperCase().replace(/\s+/g, ' ').trim();
    return { keyOf: n => 'N:' + (up(n) || '—'), labelOf: k => k.slice(2), gstinFor: () => '' };
  }
  /* "How many suppliers do we owe?" — count distinct PARTIES, not distinct
     spellings. [...new Set(rows.map(r => r.sup))] counted one firm twice and
     overstated every such KPI on the dashboards. */
  function countParties(rows, nameOf, gstinOf) {
    const idx = partyIndex(rows, nameOf, gstinOf);
    return new Set((rows || []).map(r => idx.keyOf(nameOf(r), gstinOf ? gstinOf(r) : r.gstin))).size;
  }

  /* ── Supabase (same project + publishable key as v1) ────────── */
  const SUPA_URL = 'https://iteaawedfmaujujyrqdu.supabase.co';
  const SUPA_KEY = 'sb_publishable_9MNYdrZ_ddJKTLL97amK4w_85iF6vlU';

  /* ── Auth guard ─────────────────────────────────────────────── */
  let QL_PLANT = null;
  try { QL_PLANT = JSON.parse(localStorage.getItem('ql_plant') || 'null'); } catch (_) {}
  // Every account-scoped localStorage key. Wiped when a DIFFERENT account signs
  // in on this browser, so a new login can never see the previous account's
  // cached data. ql_BACKUP_* (explicit user backups) and ql_features (device
  // preference) survive on purpose.
  function wipeAccountCaches() {
    const kill = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      /* ql_qtyscan_ = "these bills have already had their tonnage read off the
         PDF". It is a statement about ANOTHER account's bills; left behind, it
         tells the new account's backfill to skip bills it has never looked at. */
      if (/^ql_data_/.test(k) || /^ql_bill_aliases_/.test(k) || /^ql_qtyscan_/.test(k)) kill.push(k);
    }
    kill.push('dm_active_co', 'dm_loans', 'dm_profile_pic', 'ql_notif_state');
    kill.forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
  }
  // Cross-subdomain handoff (#auth=base64). A FRESH handoff ALWAYS wins over a
  // stored session: signing up / logging in as another account used to be
  // silently ignored when this browser already held a session, so the new user
  // landed on the previous account's dashboard with its cached data. Now the
  // incoming identity replaces the session, and if it is a different account
  // the previous account's local caches are wiped first.
  if (location.hash.startsWith('#auth=')) {
    try {
      const fresh = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(6)))));
      if (fresh && fresh.id) {
        if (QL_PLANT && QL_PLANT.id && QL_PLANT.id !== fresh.id) wipeAccountCaches();
        QL_PLANT = fresh;
        localStorage.setItem('ql_plant', JSON.stringify(QL_PLANT));
      }
      history.replaceState(null, '', location.pathname);
    } catch (_) {}
  }
  const _loginUrl = () => {
    const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname) || location.hostname.endsWith('.local');
    return isLocal ? '/quicklime.html' : 'https://quicklimes.com/portal';
  };
  if (!QL_PLANT || !QL_PLANT.id) {
    location.replace(_loginUrl());
    throw new Error('ql_v2_no_session');
  }
  /* THE SESSION DIED UNDER US. ql-api.js calls this the moment any request
     comes back 401 — the token expired, or the account it names is gone
     (a company removal promoted a new main, or deleted the account). This runs
     on EVERY device, not just the one that pressed Remove.

     Why it must sign out rather than carry on: pullCloud treats an empty/failed
     read as "no cloud" and keeps rendering the local cache, and saveCloudNow
     swallows write errors — so without this the user would see their full books
     while every edit silently went nowhere. Better a login screen than a lie.
     Runs once (a burst of 401s must not fight over the redirect). */
  let _authLost = false;
  window.QLAuthLost = function () {
    if (_authLost) return; _authLost = true;
    try { localStorage.removeItem('ql_plant'); } catch (_) {}
    try { localStorage.removeItem('dm_active_co'); } catch (_) {}
    try { localStorage.removeItem('ql_cache_owner'); } catch (_) {}
    try { location.replace(_loginUrl()); } catch (_) {}
  };
  // Identity marker — catches the OTHER login path too (login page writing
  // ql_plant directly, no #auth hash): if the session's account differs from
  // the one that wrote these caches, the caches belong to someone else.
  try {
    const owner = localStorage.getItem('ql_cache_owner');
    if (owner && owner !== QL_PLANT.id) wipeAccountCaches();
    localStorage.setItem('ql_cache_owner', QL_PLANT.id);
  } catch (_) {}

  /* ── Seller details for tax invoices ──────────────────────────────
     Keyed by GSTIN, NOT by company name. These are two real firms' private
     banking details, shipped in JS that every tenant downloads. Keyed by name, a
     tenant who called their plant "GOTAN LIME INDUSTRIES" printed Gotan's Bank of
     Baroda account on THEIR invoices — even with their own GSTIN set, because the
     bank fields had no plant-row fallback. A GSTIN is government-issued and unique,
     so it cannot collide: a firm gets these details only if it IS that firm.
     (Deeper fix, not done here: move this off the shipped bundle into per-plant
     server data so one tenant's account number never reaches another's browser.) */
  const HSN = '25221000';   // Quick Lime / Hydrated Lime
  const SELLER_BY_GSTIN = {
    '08NLIPS9801K1Z5': {
      address: 'Ground Floor, Kali Talai, Near Hafiz Sahab Ki Dragha, Merta City, Nagaur, Rajasthan - 341510',
      state: 'Rajasthan (08)', pin: '341510', gstin: '08NLIPS9801K1Z5', phone: '9610099006',
      bank: 'HDFC Bank', bankBranch: 'Merta City', accNo: '50200089605146', ifsc: 'HDFC0002670',
      product: 'Manufactures of Quick Lime and Hydrated Lime.', tan: 'JDPM00000D', jurisdiction: 'MERTA CITY'
    },
    '08BNAPM0488E1Z3': {
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
    // By GSTIN — the only key that cannot be forged by naming a plant after a firm.
    const seller = SELLER_BY_GSTIN[(p.gst_number || '').trim().toUpperCase()] || {};
    COMPANIES[p.id] = {
      key: p.id,
      name: (p.plant_name || 'Your Plant').toUpperCase(),
      short: p.plant_name || 'Your Plant',
      city: p.city || '',
      gstin: p.gst_number || seller.gstin || '',
      address: p.address || seller.address || '', state: seller.state || 'Rajasthan (08)', pin: seller.pin || '',
      // The company's own contact mobile (editable in the profile) wins over the
      // seed and the account login phone; it's what prints on invoices.
      ownerName: p.owner_name || seller.owner_name || '',
      phone: p.contact_phone || seller.phone || (QL_PLANT.owner_phone || ''), email: seller.email || '', station: seller.station || p.city || '',
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

  /* ── Company identity (name / GSTIN / city / address) ──────────────────
     The firm's OWN GSTIN is what lets the bill parser tell our GSTIN from
     theirs — i.e. a Sale from a Purchase. Only GOTAN / DESHWALI are seeded
     above, and signup never asked for one, so a new company had NO identity
     and no way to set one: v1 had an "Edit profile" screen, v2 dropped it.
     Every uploaded bill then came out as a Purchase from the bill's own
     issuer. This writes through to plants.gst_number and refreshes the
     cached identity, so the fix applies without a re-login. */
  const validGstinFmt = g => /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/.test(g) && +g.slice(0, 2) >= 1 && +g.slice(0, 2) <= 38;
  const validPhone = p => String(p || '').replace(/\D/g, '').length >= 7;   // agrees with ql_phone_valid
  async function updateCompany(id, o) {
    o = o || {};
    const name = String(o.name || '').trim();
    const gstin = String(o.gstin || '').trim().toUpperCase().replace(/\s/g, '');
    const ownerName = String(o.ownerName || '').trim();
    const phone = String(o.phone || '').trim();
    const city = String(o.city || '').trim(), address = String(o.address || '').trim();
    if (!COMPANIES[id]) return { ok: false, err: 'Unknown company' };
    if (name.length < 2) return { ok: false, err: 'Company name is required' };
    // GSTIN is now REQUIRED (it is what tells this firm's sales from its
    // purchases — a blank one mis-files every uploaded bill), and a wrong one is
    // worse than none, so validate the shape too.
    if (!gstin) return { ok: false, err: 'GSTIN is required — it is what tells this firm’s sales from its purchases' };
    if (!validGstinFmt(gstin)) return { ok: false, err: 'That GSTIN doesn’t look right — it should be 15 characters, like 08BNAPM0488E1Z3' };
    if (!phone) return { ok: false, err: 'Mobile number is required' };
    if (!validPhone(phone)) return { ok: false, err: 'That mobile number doesn’t look right' };
    // Two of the user's own firms sharing a GSTIN would make inter-firm bills
    // unresolvable (the parser could not tell which firm is which).
    const clash = Object.values(COMPANIES).find(c => c.key !== id && gstin && (c.gstin || '').toUpperCase() === gstin);
    if (clash) return { ok: false, err: gstin + ' is already used by ' + (clash.short || clash.name) };
    if (!DB) return { ok: false, err: 'Not connected — check your internet and try again' };

    let res;
    try {
      res = await DB.rpc('update_my_plant', {
        p_plant_id: id, p_plant_name: name, p_city: city || null,
        p_gst_number: gstin || null, p_address: address || null,
        p_owner_name: ownerName || null, p_contact_phone: phone,
        p_owner_phone: QL_PLANT.owner_phone || null
      });
    } catch (e) { return { ok: false, err: 'Could not save (' + (e && e.message ? e.message : 'network') + ')' }; }
    const err = (res && res.error && res.error.message) || (res && res.data && res.data.error);
    if (err) return { ok: false, err: err };            // NEVER report success on a failed write

    // Write through to the cached identity so ownGstins is right immediately.
    const apply = p => { if (!p || p.id !== id) return; p.plant_name = name; p.city = city; p.gst_number = gstin; p.address = address; p.owner_name = ownerName; p.contact_phone = phone; };
    (QL_PLANT.plants || []).forEach(apply); apply(QL_PLANT);
    try { localStorage.setItem('ql_plant', JSON.stringify(QL_PLANT)); } catch (_) {}
    const c = COMPANIES[id];
    c.name = name.toUpperCase(); c.short = name; c.city = city; c.gstin = gstin;
    c.ownerName = ownerName; c.phone = phone;
    if (address) c.address = address;
    return { ok: true };
  }

  /* ── Add a company (self-service) ─────────────────────────────────
     Creates a new company under this account. GSTIN is REQUIRED — a company
     born without one files every uploaded bill as a Purchase (the Deshwali
     bug). The same checks run server-side (ql_company_add); duplicating the
     cheap ones here just gives a faster message. On success the new company is
     written into the cached family and made active; the caller reloads so
     COMPANIES rebuilds from it (add is rare — a reload is simpler and cannot
     leave a half-built company in memory). Returns { ok, id } / { ok:false, err }. */
  async function addCompany(o) {
    o = o || {};
    const name = String(o.name || '').trim();
    const gstin = String(o.gstin || '').trim().toUpperCase().replace(/\s/g, '');
    const ownerName = String(o.ownerName || '').trim();
    const phone = String(o.phone || '').trim();
    const city = String(o.city || '').trim();
    if (name.length < 2) return { ok: false, err: 'Company name is required' };
    if (!gstin) return { ok: false, err: 'GSTIN is required — it is what tells this firm’s sales from its purchases' };
    if (!validGstinFmt(gstin)) return { ok: false, err: 'That GSTIN doesn’t look right — it should be 15 characters, like 08BNAPM0488E1Z3' };
    if (!phone) return { ok: false, err: 'Mobile number is required' };
    if (!validPhone(phone)) return { ok: false, err: 'That mobile number doesn’t look right' };
    const clash = Object.values(COMPANIES).find(c => (c.gstin || '').toUpperCase() === gstin);
    if (clash) return { ok: false, err: gstin + ' is already used by ' + (clash.short || clash.name) };
    const limit = +(QL_PLANT.plan_limit || 2);
    if (Object.keys(COMPANIES).length >= limit) return { ok: false, err: 'Your plan allows ' + limit + ' companies. Contact support to add more.' };
    if (!DB) return { ok: false, err: 'Not connected — check your internet and try again' };

    let res;
    try { res = await DB.rpc('add_my_company', { p_plant_name: name, p_gst_number: gstin, p_city: city || null, p_owner_name: ownerName || null, p_contact_phone: phone }); }
    catch (e) { return { ok: false, err: 'Could not add (' + (e && e.message ? e.message : 'network') + ')' }; }
    const err = (res && res.error && res.error.message) || (res && res.data && res.data.error);
    if (err) return { ok: false, err };                 // NEVER report success on a failed write
    const plant = res && res.data && res.data.plant;
    if (!plant || !plant.id) return { ok: false, err: 'Could not add the company — please try again' };

    QL_PLANT.plants = QL_PLANT.plants || [];
    QL_PLANT.plants.push(plant);
    try { localStorage.setItem('ql_plant', JSON.stringify(QL_PLANT)); } catch (_) {}
    localStorage.setItem('dm_active_co', plant.id);     // land on the new company after reload
    return { ok: true, id: plant.id };
  }

  /* ── Remove a company (self-service) ──────────────────────────────
     Deletes a SECONDARY company and its data. The main company (the one that
     holds the login) can never be removed — the server refuses it too, this is
     just a faster message. On success the company is dropped from the cached
     family and its local cache cleared; if it was active, the main company
     takes over. The caller reloads. Returns { ok } / { ok:false, err }. */
  async function removeCompany(id) {
    if (!COMPANIES[id]) return { ok: false, err: 'Unknown company' };
    if (!DB) return { ok: false, err: 'Not connected — check your internet and try again' };

    // Removing the MAIN company is allowed — the server promotes the other
    // company to carry the login (owner's rule: never tell the user "you
    // can't delete"). The old login token dies with the old main, so the
    // caller must sign the user out; we say so with signOut: true.
    const isMain = id === (QL_PLANT.id || '');
    const params = { p_plant_id: id };
    if (isMain) {
      const other = (QL_PLANT.plants || []).find(p => p.id !== id);
      if (other) params.p_promote_id = other.id;
    }

    let res;
    try { res = await DB.rpc('remove_my_company', params); }
    catch (e) { return { ok: false, err: 'Could not remove (' + (e && e.message ? e.message : 'network') + ')' }; }
    const err = (res && res.error && res.error.message) || (res && res.data && res.data.error);
    if (err) return { ok: false, err };
    const d = (res && res.data) || {};

    try { localStorage.removeItem('ql_data_' + id); } catch (_) {}
    try { sessionStorage.removeItem('ql_uimonth_' + id); } catch (_) {}
    if (d.promoted || d.account_deleted) {
      // The account anchor changed (or the account is gone): the cached
      // identity and token are dead. Clear them; the caller redirects to login.
      try { localStorage.removeItem('ql_plant'); } catch (_) {}
      try { localStorage.removeItem('dm_active_co'); } catch (_) {}
      return { ok: true, signOut: true, accountDeleted: !!d.account_deleted };
    }

    QL_PLANT.plants = (QL_PLANT.plants || []).filter(p => p.id !== id);
    try { localStorage.setItem('ql_plant', JSON.stringify(QL_PLANT)); } catch (_) {}
    if (ACTIVE_CO === id) {
      const primary = (QL_PLANT.id) || ((QL_PLANT.plants[0] || {}).id) || '';
      if (primary) localStorage.setItem('dm_active_co', primary);
    }
    return { ok: true };
  }

  /* ── State ───────────────────────────────────────────────────── */
  const S = {
    SALES: [], PURCHASES: [], WORKERS: [], WORK_LOG: [], ATT: {},
    TDS: [], CHALLANS: [], PARTIES: [], CASHBOOK: [], LOANS: [], CHUNNA: [], PROD: [], AUDIT: [], REFUNDS: [],
    FINANCE: null,
    RECON: { txns: [] },      // bank-statement reconciliation (per company)
    BANK_ACCOUNTS: [],        // first-class bank accounts within THIS firm (multi-bank)
    /* Statement uploads, one record per file, scoped to a bank account.
       Nothing recorded this before: the recon page could show WHAT was imported
       but never WHEN, BY WHOM, or FROM WHICH FILE. That is why a bank card cannot
       say "last upload", why there is no history to re-import from, and why the
       same statement can be uploaded twice with only per-row dedupe to catch it. */
    STATEMENTS: []
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
  // gstR can be absent on legacy/synced sales → default 5% (mirrors invoiceData) so we never produce NaN
  const cS = s => { const tx = (+s.qty || 0) * (+s.rate || 0), g = tx * (s.gstR == null ? 5 : +s.gstR) / 100; return { tx, cgst: g / 2, sgst: g / 2, tot: tx + g }; };
  // RCM: the recipient pays GST to the govt, not the supplier — so the supplier-payable (total) is the taxable only, ITC still claimable
  const cP = p => { const tx = +p.taxable || 0, g = tx * (+p.grate || 0) / 100, rcm = p.itc === 'RCM', itc = (p.itc === 'Eligible' || rcm) ? g : 0; return { g, tot: rcm ? tx : tx + g, itc }; };
  const cW = w => {
    const days = Object.values(S.ATT[w.id] || {}).filter(v => v === 'P' || v === 'H').length;
    const gross = w.freq === 'monthly' ? w.wage : w.wage * days, ded = w.adv || 0;
    return { days, gross, ded, net: gross - ded, cost: gross };
  };
  // inter-state = buyer GSTIN state code ≠ 08 (Rajasthan seller). Inter-state GST is IGST, not CGST/SGST.
  const saleInter = s => { const g = s.gstin || partyGstin(s.party); return !!(g && g.length >= 2 && g.slice(0, 2) !== '08'); };
  /* Cancelled bills never count toward sales/GST/ITC totals — and neither do
     TRASHED or ARCHIVED ones. Trash a ₹10L invoice and it left the Sales register
     but kept adding ₹50,000 of output tax to your GST liability; a trashed purchase
     kept inflating ITC. Void was handled, trash was not. Both stores must gain this
     together: fixing only sales would drop the payable while leaving stale ITC. */
  const notCancelled = x => (x.status || 'pending') !== 'cancelled' && !x._del && !x._arch;
  /* `p` = the picked period ('all' | 'YYYY' | 'YYYY-MM'), see inPeriod(). Omitted
     ⇒ all time, which is what every existing caller passes, so behaviour is
     unchanged for them. */
  const totS = p => S.SALES.filter(x => notCancelled(x) && inPeriod(x.date, p)).reduce((a, x) => { const c = cS(x), inter = saleInter(x); return { tx: a.tx + c.tx, cgst: a.cgst + (inter ? 0 : c.cgst), sgst: a.sgst + (inter ? 0 : c.sgst), igst: a.igst + (inter ? c.cgst + c.sgst : 0), tot: a.tot + c.tot }; }, { tx: 0, cgst: 0, sgst: 0, igst: 0, tot: 0 });
  const totP = p => S.PURCHASES.filter(x => notCancelled(x) && inPeriod(x.date, p)).reduce((a, x) => { const c = cP(x); return { tx: a.tx + (+x.taxable || 0), g: a.g + c.g, tot: a.tot + c.tot, itc: a.itc + c.itc }; }, { tx: 0, g: 0, tot: 0, itc: 0 });
  /* NO period argument, deliberately. A worker record carries a wage and a
     designation — no date — and attendance is keyed by DAY NUMBER inside one
     unlabelled month grid (S.ATT[workerId][17]), so there is nothing here to
     filter a month or a year by. Adding a `p` that silently did nothing is the
     exact failure this codebase keeps repeating; getPL() below takes the dated
     route instead when a period is picked, and says so on screen. */
  const totL = () => S.WORKERS.reduce((a, w) => { const c = cW(w); return { gross: a.gross + c.gross, net: a.net + c.net, cost: a.cost + c.cost }; }, { gross: 0, net: 0, cost: 0 });
  /* Wage money that IS dated: cash-book debits that read as labour. Same rule
     (same regex) the Reports Hub's date-scoped P&L already uses — that report
     and this page must not disagree about what "labour in March" means. */
  const LABOUR_RE = /labour|labor|wage|salary|mazdoor|hamali|payroll/i;
  function labourPaid(p) {
    return S.CASHBOOK.filter(e => e.type === 'debit' && inPeriod(e.date, p) && LABOUR_RE.test((e.category || '') + ' ' + (e.notes || '') + ' ' + (e.party || '')))
      .reduce((a, e) => a + (+e.amount || 0), 0);
  }
  function getPL(period) {
    const ts = totS(period), tp = totP(period);
    const rev = ts.tx;
    /* tp.tx, not a fresh sum of S.PURCHASES: that raw reduce counted CANCELLED and
       trashed bills, and returned NaN if any row lacked `taxable` — poisoning Gross
       Margin and Cost/Ton. tp is already filtered and NaN-safe, and the Reports P&L
       already computes it this way, so the two screens disagreed on one number. */
    const cogs = tp.tx;
    const gp = rev - cogs;
    /* All time → the worker masters, exactly as before. A picked month/year →
       dated cash-book wage payments, because the masters cannot answer "March".
       Subtracting an ALL-TIME labour cost from ONE month's revenue would not be
       a scoped P&L, it would be a wrong one — a loss reported where there was a
       profit. The two sources genuinely differ, so `labourSrc` travels with the
       number and pl.html prints which one it used rather than swapping the
       basis behind the owner's back. */
    const scoped = !!(period && period !== 'all');
    const labour = scoped ? labourPaid(period) : totL().cost;
    const labourSrc = scoped ? 'cashbook' : 'workers';
    const ebitda = gp - labour;
    /* IGST was missing. Every inter-state sale showed ZERO output GST here, so net
       profit was overstated by the whole IGST amount — while the dashboard's card
       (which uses gstSummary) reported it correctly on the same data. totS already
       splits intra/inter; this just has to read the field. */
    const outGST = ts.cgst + ts.sgst + (ts.igst || 0), netGST = Math.max(0, outGST - tp.itc), np = ebitda - netGST;
    return { rev, cogs, gp, labour, labourSrc, ebitda, netGST, np, outGST, itc: tp.itc, gpm: rev ? gp / rev * 100 : 0, npm: rev ? np / rev * 100 : 0 };
  }

  /* ── Persistence (port of v1 loadLocal / cloud pull) ─────────── */
  function clearState() {
    S.SALES.length = 0; S.PURCHASES.length = 0; S.WORKERS.length = 0; S.WORK_LOG.length = 0;
    S.TDS.length = 0; S.CHALLANS.length = 0; S.PARTIES.length = 0; S.CASHBOOK.length = 0;
    S.LOANS.length = 0; S.CHUNNA.length = 0; S.PROD.length = 0; S.AUDIT.length = 0; S.REFUNDS.length = 0;
    Object.keys(S.ATT).forEach(k => delete S.ATT[k]);
    S.FINANCE = defaultFinance();
    S.RECON = { txns: [] };
    // Reset the WhatsApp store too. It is per-company: leaving one firm's send
    // log in place while switching to another leaks their customer contact
    // history across companies — the same isolation failure as ql_data_*.
    S.WA = { cfg: {}, log: [] };
    S.BANK_ACCOUNTS.length = 0;
    S.STATEMENTS.length = 0;
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
    if (d.prod)      S.PROD.push(...d.prod);
    if (d.audit)     S.AUDIT.push(...d.audit);
    if (d.refunds)   S.REFUNDS.push(...d.refunds);
    if (d.finance)   S.FINANCE = normalizeFinance(d.finance);
    if (d.reconcile && Array.isArray(d.reconcile.txns)) S.RECON = d.reconcile;
    if (Array.isArray(d.bankAccounts)) S.BANK_ACCOUNTS.push(...d.bankAccounts);
    if (Array.isArray(d.statements)) S.STATEMENTS.push(...d.statements);
    // The WhatsApp send log IS the dedupe memory — without restoring it, every
    // reload forgets what was already sent and a customer gets chased twice.
    if (d.wa && typeof d.wa === 'object') S.WA = { cfg: d.wa.cfg || {}, log: Array.isArray(d.wa.log) ? d.wa.log : [] };
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
  // Count the business records in a blob — used to guard against an empty/stale
  // cloud response silently wiping good local data.
  function blobCount(d) {
    if (!d) return 0;
    return (d.sales || []).length + (d.purchases || []).length + (d.parties || []).length +
      (d.cashbook || []).length + (d.workers || []).length + (d.chunna || []).length +
      (d.tds || []).length + (d.prod || []).length;
  }
  async function pullCloud() {
    if (!DB) return false;
    try {
      const { data: rows, error } = await DB.rpc('get_my_data', { p_plant_id: QL_PLANT.id });
      if (error || !rows || !rows.length) return false;
      const row = rows.find(r => r.id === ACTIVE_CO);
      const cd = row && row.data;
      const cloudN = blobCount(cd);
      // ── DATA-LOSS GUARD ──────────────────────────────────────────────
      // Never let an EMPTY cloud row overwrite non-empty local data. A paused /
      // mid-migration backend can return 0 records; without this guard pullCloud
      // would clearState() + cache an empty blob, silently destroying the last
      // local copy. When the cloud is empty but local has data, keep local — a
      // real edit later re-pushes local → cloud and restores it.
      let localN = 0;
      try { const raw = localStorage.getItem(COMPANIES[ACTIVE_CO].dataKey); if (raw) localN = blobCount(JSON.parse(raw)); } catch (_) {}
      const stateN = S.SALES.length + S.PURCHASES.length + S.PARTIES.length;
      if (cloudN === 0 && (localN > 0 || stateN > 0)) {
        if (!stateN) loadLocal();          // surface the surviving cache into state
        return true;                       // …but do NOT overwrite the cache with empty cloud
      }
      if (!row || !cd) { if (!localN) clearState(); return true; }   // genuinely new/empty company
      clearState(); hydrate(cd);
      try { localStorage.setItem(COMPANIES[ACTIVE_CO].dataKey, JSON.stringify(cd)); } catch (_) {}
      if (cd.profile_pic) { try { localStorage.setItem('dm_profile_pic', cd.profile_pic); } catch (_) {} }
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
      cashbook: S.CASHBOOK, chunna: S.CHUNNA, prod: S.PROD, audit: S.AUDIT, refunds: S.REFUNDS, finance: S.FINANCE || defaultFinance(),
      reconcile: S.RECON || { txns: [] },
      bankAccounts: S.BANK_ACCOUNTS,
      statements: S.STATEMENTS,
      // blob() is an explicit WHITELIST: a store missing from this list is
      // never saved and silently dies on reload. The WhatsApp send log is the
      // DEDUPE MEMORY — lose it and a customer gets chased twice for the same
      // invoice, which is the one thing the reminder engine exists to prevent.
      wa: S.WA || { cfg: {}, log: [] }
    };
    if (includePic) b.profile_pic = localStorage.getItem('dm_profile_pic') || null;
    return b;
  }
  function saveLocal() {
    try { localStorage.setItem(COMPANIES[ACTIVE_CO].dataKey, JSON.stringify(blob(false))); }
    catch (e) { console.error('v2 saveLocal failed', e); }
  }
  /* ── Sync state (audit M3) ──────────────────────────────────────────────
     The old saveCloudNow swallowed every error with a console.warn: a failed
     cloud write left the data in THIS device's localStorage only, with no
     signal and no retry — and because the debounce timer only re-armed on the
     NEXT edit, a failure with no further edits stranded the change forever.
       'idle'   — everything the user did has reached the cloud
       'saving' — a write is in flight
       'error'  — the last write failed; a retry is scheduled
     syncState() + the 'ql:sync' window event let the shell show an indicator;
     _dirty drives the unsaved-changes guard below. */
  let _cloudTimer = null, _syncRetry = null, _syncBackoff = 0, _syncState = 'idle', _dirty = false;
  function setSync(s) {
    if (s === _syncState) return;
    _syncState = s;
    try { if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new CustomEvent('ql:sync', { detail: s })); } catch (_) {}
  }
  function syncState() { return _syncState; }
  async function saveCloudNow() {
    if (!DB) return;
    clearTimeout(_syncRetry); _syncRetry = null;
    setSync('saving');
    try {
      const { error } = await DB.rpc('save_my_data', { p_plant_id: QL_PLANT.id, p_id: ACTIVE_CO, p_data: blob(true) });
      if (error) throw error;
      _dirty = false; _syncBackoff = 0; setSync('idle');
    } catch (e) {
      console.warn('v2 cloud save failed', e);
      setSync('error');
      /* Retry with capped backoff so a transient outage self-heals without a
         further edit. The local copy is already safe; this is about the cloud
         (and therefore other devices) catching up. */
      _syncBackoff = Math.min((_syncBackoff || 1500) * 2, 60000);
      _syncRetry = setTimeout(saveCloudNow, _syncBackoff);
    }
  }
  function commit() {                         // local now, cloud debounced (coalesce rapid edits)
    saveLocal();
    if (DB) { _dirty = true; clearTimeout(_cloudTimer); _cloudTimer = setTimeout(saveCloudNow, 300); }
  }

  /* ── Cross-tab & unsaved-changes safety (audit M2/M3) ────────────────────
     Two browser tabs on the same account both hold the whole company in
     memory; whoever saves last silently clobbers the other (last-write-wins).
     A `storage` event fires in THIS tab when ANOTHER tab writes the active
     company's localStorage key — so we can react instead of overwriting:
       • if this tab has no unsaved edits, adopt the other tab's copy (reload
         local state and re-render) so the two stay consistent;
       • if this tab IS dirty, don't destroy either side — flag a conflict and
         let the user decide (the shell listens for 'ql:sync' === 'conflict').
     This closes the same-browser case fully. True multi-DEVICE conflict needs
     a server revision column (tracked as audit M2 follow-up); it can't be done
     safely from the client alone. */
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', function (e) {
      try {
        const key = COMPANIES[ACTIVE_CO] && COMPANIES[ACTIVE_CO].dataKey;
        if (!key || e.key !== key || e.newValue == null) return;
        if (_dirty) { setSync('conflict'); return; }   // don't clobber this tab's pending edits
        loadLocal();                                   // adopt the other tab's write
        try { if (window.__qlRefresh) window.__qlRefresh(); } catch (_) {}
      } catch (_) {}
    });
    window.addEventListener('beforeunload', function (e) {
      /* Only nag when the cloud is genuinely behind — a persistent error or an
         unresolved cross-tab conflict. Normal debounced saves clear in 300ms. */
      if (_syncState === 'error' || _syncState === 'conflict') { e.preventDefault(); e.returnValue = ''; return ''; }
    });
  }
  // Wipe EVERY record for the active company (sales, purchases, parties, labour,
  // cashbook, chunna, TDS, attendance, finance, recon + this company's loans),
  // then persist the empty state locally and to the cloud. Irreversible.
  function wipeData() {
    clearState();
    ALL_LOANS = ALL_LOANS.filter(l => l.company !== ACTIVE_CO);
    saveLoans();
    commit();
  }

  /* ── Mutations (each updates S.* then persists) ──────────────── */
  const upper = s => (s || '').toString().trim().toUpperCase();
  // OCR label-leak names ("Delivery Note Mode/Terms of Payment", "the buyer", …) — never a real supplier
  const SUP_LEAK = /delivery\s*note|mode\s*\/?\s*terms|terms\s*of\b|the\s*buyer|reference\s*no|dispatch|bill\s*of\s*lading|^[—\-\s]*$/i;
  // Party auto-create/merge — same merge rules as v1 autoSaveParty.
  function upsertParty(name, gstin, phone, address, state, type) {
    if (!name || name.trim().length < 2) return;
    const nm = upper(name);
    const idx = S.PARTIES.findIndex(p => upper(p.name) === nm || (gstin && p.gstin && upper(p.gstin) === upper(gstin)));
    if (idx >= 0) {
      const p = S.PARTIES[idx];
      if (gstin && !p.gstin) p.gstin = upper(gstin);
      // upgrade a leaked/placeholder party name to a real one when a clean import arrives
      if (name && !SUP_LEAK.test(name.trim()) && SUP_LEAK.test((p.name || '').trim())) p.name = name.trim();
      if (phone && !p.phone) p.phone = phone;
      if (address && (!p.address || address.length > (p.address || '').length)) p.address = address;
      if (state && !p.state) p.state = state;
      if (type && p.type !== type && p.type !== 'both') p.type = type;
    } else {
      S.PARTIES.push({ id: 'p' + idStamp(), name: name.trim(), gstin: upper(gstin), phone: phone || '', address: address || '', state: state || '', type: type || 'customer', notes: '', opening: 0, creditLimit: 0, creditDays: 0 });
    }
    commit();
  }
  // Sales
  /* THE GATE for ledger documents. Here, not at the call sites, because there are
     several ways in (the add form, the bulk importer, the cross-register router)
     and a check copied into each would drift — that is the bug this codebase keeps
     producing (one company switch in eight pages, one waLink in seven).

     Returns { ok:false, reason } instead of throwing: shell.js calls onSave OUTSIDE
     a try/catch, so a throw there would leave the modal open with no message — a
     silent failure, which is the one outcome worse than the duplicate. Callers that
     want an exception (the bulk importer, which has a Failed tab) raise it
     themselves. hydrate() pushes straight to S.SALES and is deliberately NOT gated:
     that is the server's own data coming back, not an import. */
  function dupCheck(e, existing) {
    if (!(typeof ImportGuard !== 'undefined' && ImportGuard.docVerdict)) return null;   // page did not load the guard — import-guard-loaded.test.js pins that it does
    /* Only LIVE documents can be "already recorded". The register has THREE
       ways to retire a document — Delete (Trash, _del), Archive (_arch), and
       Void/Cancel (status 'cancelled') — and the user does not distinguish
       them when the gate throws his upload back: "I deleted this one but when
       I upload again it says already uploaded", twice, once per door. The
       void dialog itself promises the invoice "drops out of live sales
       totals"; a document that is out of the totals cannot also be the reason
       an upload is refused. So the gate applies the SAME live-record rule as
       notCancelled (:264) and the importer pre-pass (liveSales/livePurchases)
       — one rule, every door, or the doors disagree and he meets the odd one
       out. The voided record itself STAYS in the register for GST/audit;
       re-adding its number just creates the redo alongside it. */
    const live = x => !x._del && !x._arch && (x.status || 'pending') !== 'cancelled';
    const v = ImportGuard.docVerdict(e, (existing || []).filter(live));
    return v.dup ? { ok: false, dup: true, of: v.of, amountDiffers: !!v.amountDiffers, reason: v.reason } : null;
  }
  function addSale(e) {
    const d = dupCheck(e, S.SALES); if (d) return d;
    S.SALES.push({ ...e, date: toISODate(e.date) || e.date, status: e.status || 'pending' });
    /* commit UNCONDITIONALLY. The old `if (e.party) upsertParty(...); else commit()`
       delegated the invoice's save to upsertParty — which returns early WITHOUT
       committing on a name under 2 chars. So a 1-char customer name pushed the
       invoice into memory, skipped the commit, and the toast said "Invoice created"
       while a reload showed it gone. The invoice must persist regardless of whether
       the party name was savable. (commit is debounced, so the extra call upsertParty
       makes when the name IS valid coalesces to one cloud write.) */
    if (e.party) upsertParty(e.party, e.gstin, '', e.addr || '', e.state || '', 'customer');
    commit();
    return { ok: true };
  }
  function updateSale(i, e) { if (S.SALES[i]) { S.SALES[i] = { ...S.SALES[i], ...e }; if (e.party) upsertParty(e.party, e.gstin, '', e.addr || '', e.state || '', 'customer'); commit(); } }
  function deleteSale(i, reason) { return softDelete('sales', i, reason); }
  function setSaleStatus(i, st, pay) { if (S.SALES[i]) { Object.assign(S.SALES[i], { status: st }, pay || {}); commit(); } }
  // Purchases
  function addPurchase(e) {
    const d = dupCheck(e, S.PURCHASES); if (d) return d;
    S.PURCHASES.push({ ...e, date: toISODate(e.date) || e.date, status: e.status || 'pending' });
    if (e.sup) upsertParty(e.sup, e.gstin, '', '', '', 'supplier');
    commit();   // unconditional — a too-short supplier name must not drop the bill (see addSale)
    return { ok: true };
  }
  /* Import a bill from GENERIC OCR/AI fields into the CORRECT register based on
     its detected kind — so a purchase uploaded on the Sales page (or vice-versa)
     still lands in the right place. Returns the new row's index. */
  function importGenericBill(kind, g) {
    const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
    /* Default to 5% only when NO rate was given — not when it was given AS zero. The
       old `if (!rate) rate = 5` treated an explicit 0% (nil-rated goods) as "missing"
       and stamped 5% on it, fabricating ITC that does not exist: a nil ₹1,00,000 bill
       imported as ₹1,05,000 with ₹5,000 of invented input credit. */
    const rateGiven = g.rate != null && String(g.rate).trim() !== '';
    let rate = num(g.rate); if (!rateGiven) rate = 5; if (rate > 0 && rate < 1) rate *= 100;
    let taxable = num(g.taxable); const total = num(g.total);
    if (!taxable && total) taxable = Math.round(total / (1 + rate / 100) * 100) / 100;
    const veh = (g.veh || '').toString().trim().toUpperCase();
    const gstin = (g.gstin || '').toString().trim().toUpperCase();
    const date = toISODate(g.date) || fmtISO(new Date());
    const cat = ((g.group || '') + ' ' + (g.item || '')).trim();
    if (kind === 'sales') {
      let qty = num(g.qty) || 1, r = taxable ? Math.round(taxable / qty * 100) / 100 : num(g.rate);
      addSale({ inv: (g.docno || '').toString().trim(), date, party: (g.name || '').toString().trim(), gstin, qty, rate: r, gstR: rate, veh, status: 'pending' });
      return S.SALES.length - 1;
    }
    addPurchase({ bill: (g.docno || '').toString().trim(), date, sup: (g.name || '').toString().trim(), gstin, taxable, grate: rate, itc: g.itc || 'Eligible', veh, cat: cat || undefined, status: 'pending' });
    return S.PURCHASES.length - 1;
  }
  /* ── BILL DOCUMENTS — the original scan, one store per register ─────────
     ONE writer for both registers. The record shape written here is exactly what
     viewBill / openBillPdf / wireInvoice read back, and the id prefix is what
     separates a purchase doc from a sales one — so a second implementation that
     drifts by a single field is a bill whose scan cannot be opened. purchase.js
     and sales.js delegate their addAttach here instead of keeping a copy each.

     `kind` is the DESTINATION register, never the page the upload started from.
     A sales invoice auto-routed off the Purchase register must land in the SALES
     store: written to the purchase store it is filed where nothing will ever
     look for it, which is the same as losing it. */
  const DOC_DB = { purchase: 'ql_pur_docs', sales: 'ql_sal_docs' };
  const DOC_PFX = { purchase: 'pa', sales: 'sa' };
  const _docDb = {};
  function docDb(kind) {
    const name = DOC_DB[kind];
    if (!name) return Promise.reject(new Error('unknown register “' + kind + '” — nowhere to file the scan'));
    if (_docDb[name]) return _docDb[name];
    _docDb[name] = new Promise((res, rej) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = e => { const d = e.target.result; if (!d.objectStoreNames.contains('f')) d.createObjectStore('f'); };
      r.onsuccess = e => res(e.target.result); r.onerror = () => rej(r.error);
    });
    return _docDb[name];
  }
  function docOp(kind, mode, fn) {
    return docDb(kind).then(d => new Promise((res, rej) => {
      const t = d.transaction('f', mode), o = fn(t.objectStore('f'));
      // Resolve to the request RESULT (undefined on a miss). Returning the
      // IDBRequest itself on a miss made getDoc() look like it found a non-Blob,
      // and createObjectURL threw "Overload resolution failed".
      t.oncomplete = () => res(o instanceof IDBRequest ? o.result : o);
      t.onerror = () => rej(t.error);
    }));
  }
  /* Put the file in the store, then pin its record to the row. THROWS on failure
     — the caller must be able to say "the bill saved, the scan did not" instead
     of dropping the failure on the floor and letting the eye button discover it
     weeks later. Returns the new attachment id. */
  async function attachDoc(kind, idx, file, label) {
    if (!file) return '';
    const arr = kind === 'sales' ? S.SALES : S.PURCHASES;
    if (!arr[idx]) throw new Error('the bill row is no longer there — scan not attached');
    const id = (DOC_PFX[kind] || 'da') + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);
    await docOp(kind, 'readwrite', st => st.put(file, id));
    docSync(id, { name: file.name, kind: label || 'Invoice', mime: file.type || '' }, file);
    // Re-read AFTER the await: the row is what we are about to write to, and the
    // store could have moved under us while IndexedDB was busy.
    const row = arr[idx];
    if (!row) throw new Error('the bill row is no longer there — scan not attached');
    const attach = (row.attach || []).concat([{ id, name: file.name, type: file.type || '', kind: label || 'Invoice', size: file.size, at: new Date().toISOString() }]);
    if (kind === 'sales') updateSale(idx, { attach }); else updatePurchase(idx, { attach });
    return id;
  }
  function getDoc(kind, id) { return docOp(kind, 'readonly', st => st.get(id)); }

  /* ── SERVER COPY of every scan (/api/files) ──────────────────────────────
     The browser store stays primary (fast, offline). The server is the shared
     copy behind it, so the eye works on a device that never saw the upload.
     Sync is fire-and-forget: an offline attach MUST still succeed, and a
     failed upload surfaces the next time the other device misses. */
  /* `co` is passed in, never read from ACTIVE_CO at call time: an upload fires
     asynchronously (FileReader → fetch) and the user can switch company in
     between, which would file the scan — and its party names, GSTINs and
     amounts — under the WRONG firm, readable by that firm's users. */
  function docApi(body, co) {
    let p = {}; try { p = JSON.parse(localStorage.getItem('ql_plant') || 'null') || {}; } catch (_) {}
    if (!p.id || !p.token) return Promise.resolve(null);
    return fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ plant_id: p.id, company_id: co != null ? co : (ACTIVE_CO || ''), token: p.token }, body)) })
      .then(r => r.json()).catch(() => null);
  }
  function docSync(id, meta, file) {
    try {
      /* Pinned NOW, before any async hop — but INSIDE the guard. It sat above
         the try once, and that one line outside made the whole server-copy
         path fatal to its caller: attachDoc would throw before writing
         row.attach, so a failure to reach the SERVER silently cost you the
         LOCAL attachment. The sync is fire-and-forget by design; nothing in
         here may ever reach the caller. */
      const co = ACTIVE_CO || '';
      const rd = new FileReader();
      rd.onload = () => {
        const b64 = String(rd.result || '').split(',')[1] || '';
        if (b64) docApi({ action: 'put', id: String(id), name: meta.name || '', kind: meta.kind || '', mime: meta.mime || '', data: b64 }, co);
      };
      rd.readAsDataURL(file);
    } catch (_) { /* never block the attach */ }
  }
  async function fetchDocBlob(id) {
    const kind = String(id).indexOf('pa') === 0 ? 'purchase' : String(id).indexOf('sa') === 0 ? 'sales' : '';
    const r = await docApi({ action: 'get', id: String(id) });
    if (!r || !r.ok || !r.data) return null;
    const bin = atob(r.data); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const blob = new Blob([u8], { type: r.mime || 'application/octet-stream' });
    /* re-seed the local store so the NEXT open is instant and offline-safe */
    if (kind) { try { await docOp(kind, 'readwrite', st => st.put(blob, String(id))); } catch (_) {} }
    return blob;
  }

  function updatePurchase(i, e) { if (S.PURCHASES[i]) { S.PURCHASES[i] = { ...S.PURCHASES[i], ...e }; if (e.sup) upsertParty(e.sup, e.gstin, '', '', '', 'supplier'); commit(); } }
  function deletePurchase(i, reason) { return softDelete('purchase', i, reason); }
  function setPurchaseStatus(i, st, pay) { if (S.PURCHASES[i]) { Object.assign(S.PURCHASES[i], { status: st }, pay || {}); commit(); } }
  // Workers
  function addWorker(e) { S.WORKERS.push({ id: 'W' + idStamp(), ...e }); commit(); }
  function updateWorker(i, e) { if (S.WORKERS[i]) { S.WORKERS[i] = { ...S.WORKERS[i], ...e }; commit(); } }
  function deleteWorker(i, reason) { return softDelete('worker', i, reason); }
  // Cashbook
  function addCashEntry(e) { S.CASHBOOK.push({ id: 'cb' + idStamp(), ...e }); commit(); }
  function deleteCashEntry(i, reason) { return softDelete('payment', i, reason); }
  // Party direct edit/delete (by index into partyRows == index into S.PARTIES)
  function deleteParty(i, reason) { return softDelete('party', i, reason); }
  let _seq = 0;
  function idStamp() { return Date.now() + '' + (_seq++); }   // unique even within the same millisecond

  /* ═══════════════════════════════════════════════════════════════════
     SOFT-DELETE / TRASH / ARCHIVE / AUDIT — reusable service.
     No business record is hard-deleted by default: delete() sets a `_del`
     marker (kept ON the record so it persists with its module + firm), the
     row builders exclude `_del`/`_arch`, Trash lists them for restore, and
     every action is written to an append-only audit log. Records are only
     physically removed by purge() (permanent delete). ─────────────────── */
  const nowISO = () => new Date().toISOString();
  function whoami() {
    try { const p = JSON.parse(localStorage.getItem('ql_plant') || 'null') || {}; return { by: (p.user && p.user.name) || 'Owner', role: p.role || 'owner' }; }
    catch (_) { return { by: 'Owner', role: 'owner' }; }
  }
  // module key → {arr, label, ref, party, amount, date}. One place to add modules.
  const TRASHABLE = {
    sales:      { arr: () => S.SALES,     label: 'Sales invoice',  ref: r => r.inv,  party: r => r.party,        amount: r => cS(r).tot,   date: r => r.date, protect: r => (r.status === 'paid' || r.status === 'cash') },
    purchase:   { arr: () => S.PURCHASES, label: 'Purchase bill',  ref: r => r.bill, party: r => r.name || r.sup, amount: r => cP(r).tot,   date: r => r.date, protect: r => r.status === 'paid' },
    party:      { arr: () => S.PARTIES,   label: 'Party',          ref: r => r.name, party: r => r.name,         amount: () => 0,           date: () => '' },
    payment:    { arr: () => S.CASHBOOK,  label: 'Payment / entry', ref: r => r.ref || r.id, party: r => r.party, amount: r => +r.amount || 0, date: r => r.date },
    chunna:     { arr: () => S.CHUNNA,    label: 'Chunna sale',    ref: r => r.id,   party: r => r.customer,     amount: r => +r.total || 0, date: r => r.date },
    production: { arr: () => S.PROD,      label: 'Production run', ref: r => r.date, party: () => '',            amount: r => +r.labour || 0, date: r => r.date },
    tds:        { arr: () => S.TDS,       label: 'TDS entry',      ref: r => r.id,   party: r => r.party,        amount: r => +r.tds || 0,  date: r => r.date },
    worker:     { arr: () => S.WORKERS,   label: 'Worker',         ref: r => r.name, party: r => r.name,         amount: () => 0,           date: () => '' }
  };
  const isDel  = r => r && !!r._del;
  const isArch = r => r && !!r._arch;
  // Pair each ACTIVE record (not trashed/archived) with its RAW array index, so
  // row builders exclude soft-deleted records while keeping idx stable for
  // delete/restore. Usage: withIdx(S.SALES).map(([s, i]) => ({ idx: i, ... })).
  const withIdx = arr => arr.map((r, i) => [r, i]).filter(([r]) => !r._del && !r._arch);
  /* Money that still counts: not trashed, not archived, not voided. The BALANCE
     functions must use the same rule as the LISTS (withIdx) plus the void rule,
     or the page contradicts itself — cashbook.test.js pinned the exact screen:
     delete the only entry and the subtitle still said "0 entries · Balance
     ₹1,000", forever, because payment records can never be purged. */
  const liveMoney = e => !e._del && !e._arch && (e.status || '') !== 'cancelled';
  function logAudit(action, module, rec, meta) {
    meta = meta || {}; const w = whoami();
    S.AUDIT.push({
      id: 'AU' + idStamp(), ts: nowISO(), action, module,
      recId: (rec && (rec.id || rec.inv || rec.bill || rec.name)) || '',
      ref: meta.ref || '', party: meta.party || '', amount: meta.amount || 0,
      by: w.by, role: w.role, reason: meta.reason || '',
      device: (typeof navigator !== 'undefined' ? (navigator.userAgent || '').slice(0, 80) : '')
    });
    if (S.AUDIT.length > 3000) S.AUDIT.splice(0, S.AUDIT.length - 3000);
  }
  function _meta(c, rec, reason) { return { ref: c.ref(rec) || '', party: c.party(rec) || '', amount: c.amount(rec) || 0, reason: reason || '' }; }
  function softDelete(module, idx, reason) {
    const c = TRASHABLE[module]; if (!c) return { ok: false, err: 'Unknown module' };
    const rec = c.arr()[idx]; if (!rec || isDel(rec)) return { ok: false, err: 'Not found' };
    const w = whoami();
    rec._del = { at: nowISO(), by: w.by, role: w.role, reason: reason || '' };
    logAudit('trash', module, rec, _meta(c, rec, reason)); commit();
    return { ok: true };
  }
  function restoreRecord(module, idx) {
    const c = TRASHABLE[module]; if (!c) return { ok: false, err: 'Unknown module' };
    const rec = c.arr()[idx]; if (!rec || !isDel(rec)) return { ok: false, err: 'Not in trash' };
    const ref = c.ref(rec);
    const conflict = ref ? c.arr().some((x, i) => i !== idx && !isDel(x) && c.ref(x) === ref) : false;
    delete rec._del;
    logAudit('restore', module, rec, Object.assign(_meta(c, rec), conflict ? { reason: 'ref conflict: ' + ref } : {})); commit();
    return { ok: true, conflict: conflict ? ref : null };
  }
  // Financial/compliance records must NEVER be hard-deleted — only voided or
  // archived — so GST, audit and ledger history stay intact.
  const FINANCIAL = { sales: 1, purchase: 1, payment: 1 };
  function purgeRecord(module, idx) {
    const c = TRASHABLE[module]; if (!c) return { ok: false, err: 'Unknown module' };
    const rec = c.arr()[idx]; if (!rec) return { ok: false, err: 'Not found' };
    if (FINANCIAL[module]) return { ok: false, blocked: true, err: c.label + ' records can’t be permanently deleted — Void / Cancel or Archive instead, so GST and audit history stay intact.' };
    logAudit('purge', module, rec, _meta(c, rec)); c.arr().splice(idx, 1); commit();
    return { ok: true };
  }
  const isVoid = r => r && (r.status === 'cancelled' || !!r._void);
  // Void / Cancel a posted financial record: keep the document + number, mark it
  // Cancelled (so it drops out of live totals but stays in audit/compliance), and
  // reverse any linked bank-ledger posting. This is the compliant alternative to
  // deleting invoices, bills and payments.
  function voidRecord(module, idx, reason) {
    const c = TRASHABLE[module]; if (!c) return { ok: false, err: 'Unknown module' };
    const rec = c.arr()[idx]; if (!rec) return { ok: false, err: 'Not found' };
    if (isVoid(rec)) return { ok: false, err: 'Already voided' };
    const w = whoami();
    rec._void = { at: nowISO(), by: w.by, role: w.role, reason: reason || '' };
    rec.status = 'cancelled';
    if (module === 'payment' && rec.partyIdx != null && rec.ledgerEntryId) { try { reverseLedgerEntry(rec.partyIdx, rec.ledgerEntryId); } catch (_) {} }
    logAudit('void', module, rec, _meta(c, rec, reason)); commit();
    return { ok: true };
  }
  function archiveRecord(module, idx, on) {
    const c = TRASHABLE[module]; if (!c) return { ok: false }; const rec = c.arr()[idx]; if (!rec) return { ok: false };
    if (on === false) { delete rec._arch; logAudit('unarchive', module, rec, _meta(c, rec)); }
    else { const w = whoami(); rec._arch = { at: nowISO(), by: w.by }; logAudit('archive', module, rec, _meta(c, rec)); }
    commit(); return { ok: true };
  }
  function trashRows(days) {
    days = days || 90; const out = [];
    Object.keys(TRASHABLE).forEach(m => { const c = TRASHABLE[m]; c.arr().forEach((rec, i) => {
      if (!isDel(rec)) return; const d = rec._del;
      const age = Math.floor((Date.parse(nowISO()) - Date.parse(d.at)) / 86400000);
      out.push({ module: m, moduleLabel: c.label, idx: i, ref: c.ref(rec) || '—', party: c.party(rec) || '', amount: c.amount(rec) || 0,
        date: c.date(rec) || '', deletedAt: d.at, deletedBy: d.by, reason: d.reason || '', daysLeft: Math.max(0, days - age), expired: age >= days });
    }); });
    return out.sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  }
  function auditRows() { return S.AUDIT.slice().reverse(); }
  function trashCount() { let n = 0; Object.keys(TRASHABLE).forEach(m => TRASHABLE[m].arr().forEach(r => { if (isDel(r)) n++; })); return n; }
  // Archived records (hidden from active lists, kept for history, restorable).
  function archiveRows() {
    const out = [];
    Object.keys(TRASHABLE).forEach(m => { const c = TRASHABLE[m]; c.arr().forEach((rec, i) => {
      if (!isArch(rec) || isDel(rec)) return; const a = rec._arch;
      out.push({ module: m, moduleLabel: c.label, idx: i, ref: c.ref(rec) || '—', party: c.party(rec) || '', amount: c.amount(rec) || 0,
        date: c.date(rec) || '', archivedAt: a.at, archivedBy: a.by });
    }); });
    return out.sort((x, y) => (y.archivedAt || '').localeCompare(x.archivedAt || ''));
  }
  function archiveCount() { let n = 0; Object.keys(TRASHABLE).forEach(m => TRASHABLE[m].arr().forEach(r => { if (isArch(r) && !isDel(r)) n++; })); return n; }
  // Full company snapshot for the "download backup" button (client-side JSON export).
  function backupJSON() { return JSON.stringify({ company: (COMPANIES[ACTIVE_CO] || {}).name || ACTIVE_CO, exportedAt: nowISO(), data: blob(true) }, null, 2); }

  /* ── Aggregates for the dashboard ────────────────────────────── */
  function monthSeries(nMonths = 7, endYm) {
    const out = [];
    /* Anchored at NOW by default — every existing caller (the dashboard sparklines,
       kpis(), insights()) means "the last n months" and must not move. Production's
       trend chart is the one that has to end somewhere else: picking June 2026 has
       to walk the chart back to the 7 months ENDING in June, not leave it showing
       the 7 ending today while every other figure on the page says June.
       A malformed endYm falls back to now rather than to an Invalid Date, which
       would emit NaN month buckets instead of failing. */
    const em = /^(\d{4})-(\d{2})$/.exec(String(endYm || ''));
    const now = (em && +em[2] >= 1 && +em[2] <= 12) ? new Date(+em[1], +em[2] - 1, 1) : new Date();
    for (let i = nMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      /* notCancelled, not a bare date filter: a cancelled or trashed invoice is not a
         dispatch. Without this the trend chart counts tonnage that was voided —
         totS()/totP() have always filtered, these month buckets never did. */
      const sal = S.SALES.filter(s => ymOf(s.date) === ym && notCancelled(s));
      const pur = S.PURCHASES.filter(p => ymOf(p.date) === ym && notCancelled(p));
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
    const outRows = salesRows().filter(r => r.outstanding > 0.5 && r.status !== 'cancelled');   // anything still owed (incl. partials)
    // Distinct CUSTOMERS, resolved by GSTIN — not distinct spellings.
    const _pIdx = partyIndex(outRows, r => r.party, r => r.gstin);
    const pendParties = [...new Set(outRows.map(r => _pIdx.keyOf(r.party, r.gstin)))];
    const overdueParties = [...new Set(outRows.filter(r => r.days > 30).map(r => _pIdx.keyOf(r.party, r.gstin)))];
    const collAmt = outRows.reduce((a, r) => a + r.outstanding, 0);
    const payAmt = purchaseRows().filter(r => r.outstanding > 0.5 && r.status !== 'cancelled').reduce((a, r) => a + r.outstanding, 0);
    const totQty = S.SALES.filter(notCancelled).reduce((a, s) => a + (s.qty || 0), 0);
    return {
      sales:       { v: fC(ts.tx), trend: mom(cur.sales, prev.sales), meta: S.SALES.length + ' invoices · excl. GST' },
      profit:      { v: fC(pl.np), trend: mom(cur.profit, prev.profit), meta: 'Margin ' + pl.npm.toFixed(1) + '%' },
      production:  { v: fmt(totQty, 1) + ' T', trend: mom(cur.qty, prev.qty), meta: 'Total lime dispatched' },
      dispatch:    { v: fmt(cur.qty, 1) + ' T', trend: mom(cur.qty, prev.qty), meta: cur.invoices + ' invoices this month' },
      collections: { v: fC(collAmt), trend: null, meta: pendParties.length + ' parties · ' + overdueParties.length + ' overdue' },
      payments:    { v: fC(payAmt), trend: null, meta: countParties(purchaseRows().filter(r => r.outstanding > 0.5 && r.status !== 'cancelled'), r => r.sup, r => r.gstin) + ' suppliers' }
    };
  }

  function collections(filter = 'all') {
    // everything still owed by customers = outstanding > 0 (includes partially-paid bills), matching the register
    const pend = salesRows().filter(r => r.outstanding > 0.5 && r.status !== 'cancelled');
    const byParty = {};
    const pidx = partyIndex(pend, r => r.party, r => r.gstin);
    pend.forEach(r => {
      const k = pidx.keyOf(r.party, r.gstin);
      byParty[k] = byParty[k] || { party: pidx.labelOf(k), gstin: pidx.gstinFor(k), bills: 0, total: 0, oldest: r.date };
      byParty[k].bills++; byParty[k].total += r.outstanding;
      if (r.date < byParty[k].oldest) byParty[k].oldest = r.date;
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
    // A cancelled/trashed invoice never left the gate — it must not be "dispatched".
    const qtyIn = f => S.SALES.filter(s => notCancelled(s) && f(s)).reduce((a, s) => a + (s.qty || 0), 0);
    const ymNow = tISO.slice(0, 7);
    return {
      today: qtyIn(s => s.date === tISO),
      week:  qtyIn(s => daysAgo(s.date) <= 7),
      month: qtyIn(s => ymOf(s.date) === ymNow),
      chunnaMonth: S.CHUNNA.filter(c => ymOf(c.date) === ymNow && notCancelled(c)).reduce((a, c) => a + (parseFloat(c.qty) || 0), 0)
    };
  }

  /* ── Production figures for a PICKED period ─────────────────────────────
     production() above answers "what is happening NOW": today, this week, this
     month. Those three are pinned to the clock and CANNOT be honestly re-aimed at
     a past month — a card labelled "Today" showing a June number is simply a lie,
     and relabelling it "Today (June)" is the same lie with better manners. So the
     Production page swaps the whole card set for these when the picked period does
     not contain today, and keeps the live ones when it does.

     Same tonnage basis as production().month (invoice qty; cancelled and trashed
     excluded), deliberately — two dispatch figures on one screen must never
     disagree, which is the bug production-derived.test.js §5b was written for.

     `invoices` vs `withQty` is the honest-empty half. `dispatched === 0` means one
     of two very different things: no invoices at all, or invoices that carry no
     tonnage. Both render "0.0 T" and he has twice read a silent zero as a broken
     screen — so the page needs the counts to say WHICH, and cannot get them from a
     single sum. */
  function productionPeriod(period) {
    const sal = S.SALES.filter(s => notCancelled(s) && inPeriod(s.date, period));
    const chu = S.CHUNNA.filter(c => notCancelled(c) && inPeriod(c.date, period));
    const byDay = {};
    sal.forEach(s => { const q = +s.qty || 0; if (q > 0 && s.date) byDay[s.date] = (byDay[s.date] || 0) + q; });
    // Ties break on the EARLIER date so the answer is stable across renders rather
    // than depending on key order.
    const peak = Object.keys(byDay).sort((a, b) => byDay[b] - byDay[a] || a.localeCompare(b))[0];
    return {
      period: period || 'all',
      dispatched: sal.reduce((a, s) => a + (+s.qty || 0), 0),
      invoices: sal.length,
      withQty: sal.filter(s => +s.qty > 0).length,
      chunna: chu.reduce((a, c) => a + (parseFloat(c.qty) || 0), 0),
      chunnaSales: chu.length,
      peak: peak ? { date: peak, qty: byDay[peak] } : null
    };
  }

  function topProducts(period) {
    const ts = totS(period);
    const qty = S.SALES.filter(s => notCancelled(s) && inPeriod(s.date, period)).reduce((a, s) => a + (s.qty || 0), 0);
    const rows = [{
      icon: '⚪', name: 'Quick Lime', sub: 'GST invoiced dispatches',
      qty: fmt(qty, 1) + ' T', avg: qty ? fC(ts.tx / qty) : '—', rev: fC(ts.tot)
    }];
    const cQty = S.CHUNNA.filter(c => notCancelled(c) && inPeriod(c.date, period)).reduce((a, c) => a + (parseFloat(c.qty) || 0), 0);
    const cTot = S.CHUNNA.filter(c => notCancelled(c) && inPeriod(c.date, period)).reduce((a, c) => a + (parseFloat(c.total) || 0), 0);
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
  // Resolve a party's GSTIN when the invoice didn't store one — look it up from the
  // saved party record, then from our own linked firms (fixes e.g. Deshwali Minerals
  // showing a blank GSTIN when the sale was booked without it).
  function partyGstin(name) {
    if (!name || name === '—') return '';
    const n = String(name).trim().toUpperCase();
    const p = S.PARTIES.find(x => (x.name || '').trim().toUpperCase() === n);
    if (p && p.gstin) return p.gstin;
    const c = Object.values(COMPANIES).find(x => (x.name || '').toUpperCase() === n || (x.short || '').toUpperCase() === n);
    return (c && c.gstin) ? c.gstin : '';
  }
  function salesRows() {
    return withIdx(S.SALES).map(([s, i]) => {
      const c = cS(s);
      const paid = (s.status === 'paid' || s.status === 'cash') ? c.tot : (+s.paid || 0);
      return {
        idx: i, inv: s.inv, date: s.date, party: s.party || '—',
        qty: s.qty || 0, unit: s.unit || '', product: s.product || '',
        taxable: c.tx, gst: c.cgst + c.sgst, total: c.tot,
        status: s.status || 'pending', veh: s.veh || '', gstin: s.gstin || partyGstin(s.party),
        days: daysAgo(s.date), paid, outstanding: Math.max(0, c.tot - paid),
        payments: s.payments || [], paidMode: s.paidMode || '', paidDate: s.paidDate || '', attach: s.attach || []
      };
    });
  }
  function salesSummary() {
    const rows = salesRows().filter(r => r.status !== 'cancelled');
    return {
      count: rows.length,
      taxable: rows.reduce((a, r) => a + r.taxable, 0),   // headline "sales" = taxable (matches v1)
      revenue: rows.reduce((a, r) => a + r.total, 0),      // GST-inclusive (kept for any callers)
      collected: rows.reduce((a, r) => a + r.paid, 0),     // actual money received (includes partial payments)
      pending: rows.reduce((a, r) => a + r.outstanding, 0),// true receivable still owed (includes partials)
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
  /* Display names for the taxonomy's full item labels. Lives HERE, not in
     purchase.js, because the register and the party ledger must call one bill the
     same thing — two maps drift, and this codebase's recurring bug is one rule
     implemented twice. Keyed on the label because the whole taxonomy is (see
     catToGroupItem / itemIcon / isFreightItem): renaming an item in
     PURCHASE_GROUPS reclassifies history, which is a known debt, not a new one. */
  const ITEM_SHORT = {
    'Limestone Purchase': 'Limestone', 'Petcoke Purchase': 'Petcoke', 'Plastic Bags': 'Bags',
    'Royalty': 'Royalty', 'Petcoke Transport Freight': 'Petcoke Freight', 'Limestone Freight': 'Limestone Freight',
    'Loading Charges': 'Loading Charges', 'Bag Printing': 'Bag Printing', 'Other Packaging': 'Other Packaging'
  };
  function itemShort(it) { return ITEM_SHORT[it] || it || ''; }
  /* 'YYYY-MM' → 'March 2026'. One implementation: this string was being built from
     scratch in reconcile.js, dashboard.js and here, which is how one screen ends up
     saying "March 2026" while its neighbour says "2026-03". Parsed as LOCAL time
     ('-01T00:00', never 'Z') — new Date('2026-03-01') is UTC midnight, which in a
     negative-offset zone renders as February. */
  function monthLabel(ym, opts) {
    const blank = (opts && opts.blank) || '';
    ym = (ym || '').toString().slice(0, 7);
    const m = /^(\d{4})-(\d{2})$/.exec(ym);
    if (!m || +m[2] < 1 || +m[2] > 12) return blank;
    const d = new Date(ym + '-01T00:00:00');
    /* An invalid Date does NOT throw — toLocaleDateString returns the STRING
       "Invalid Date", which would render as a group header. A try/catch cannot see
       that, which is how the first version of this shipped.

       This is redundant with the month-range check above, deliberately: mutation
       testing shows removing EITHER one alone still passes, and only removing BOTH
       fails. Two cheap guards against a wrong month heading is a trade worth making
       — but it means neither line is independently pinned, so say so rather than
       claim a catch. */
    if (isNaN(d.getTime())) return blank;
    return d.toLocaleDateString('en-IN', { month: (opts && opts.short) ? 'short' : 'long', year: 'numeric' });
  }
  /* ── PERIOD: one rule for "which month/year/span am I looking at" ──────
     The picker (QLShell.monthPicker) emits these shapes, and every page that
     scopes numbers has to agree on what they mean. They were about to be
     re-decided per page, which is how monthLabel reached five copies:

       'all' / null / ''   every row
       'YYYY-MM'           that month        ← the picker's grid cells
       'YYYY'              that whole year   ← the picker's `years: true` button
       'r:<key>'           a RELATIVE span   ← the picker's quick-range list
       'c:FROM..TO'        a custom span, both endpoints INCLUSIVE
       {from,to}           the same custom span, object form

     The first three are matched by a PREFIX test because dates are ISO
     ('2026-03-14'), and a prefix is the ONLY thing that reads a year and a month
     with one comparison — the alternative (`slice(0,7) === p`) silently matches
     NOTHING for 'YYYY', which is a picker that renders and filters nothing.

     The span forms arrived when the owner asked for reports.html's pill row
     (Today · Yesterday · This week · Quarter · Custom) to live inside the one
     calendar. They are dispatched BEFORE the prefix test and are namespaced
     'r:'/'c:' precisely so they can never collide with an ISO prefix — 'year'
     bare would read as a prefix of nothing and quietly match zero rows, and that
     class of silent-empty is what this whole comment block exists to prevent.

     'r:month' is NOT 'YYYY-MM' of today: it is month-TO-DATE (1st → now),
     whereas the grid cell means the WHOLE month. Same for 'r:year' vs 'YYYY'.
     They are different questions and the owner can ask both. */
  const RANGE_KEYS = ['today', 'yday', 'week', 'month', 'lastmon', 'quarter', 'year'];
  const RANGE_LABEL = { today: 'Today', yday: 'Yesterday', week: 'This week', month: 'This month', lastmon: 'Last month', quarter: 'Quarter', year: 'Year' };
  /* Local Y-M-D. NOT toISOString() — that converts to UTC and hands back
     yesterday for every IST evening, which moves every month/quarter/year edge
     by a day. reports.html learned this first; this is that line, shared. */
  const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const weekStart = n => new Date(n.getFullYear(), n.getMonth(), n.getDate() - ((n.getDay() + 6) % 7));   // Monday
  /* Resolve ANY period to { from, to } (inclusive, or null/null for all time).
     `now` is injectable for tests ONLY — every caller in the app omits it, so a
     relative range is recomputed from the real clock on EVERY call. That is the
     whole reason this is a function and not a table: a tab left open overnight
     re-resolves 'r:today' to the new today the next time anything renders,
     instead of quietly still meaning yesterday. */
  function rangeSpan(period, now) {
    const none = { from: null, to: null };
    if (!period || period === 'all') return none;
    if (typeof period === 'object') {
      return (period.from || period.to) ? { from: period.from || null, to: period.to || null } : none;
    }
    const p = String(period);
    const c = /^c:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(p);
    if (c) return c[1] <= c[2] ? { from: c[1], to: c[2] } : { from: c[2], to: c[1] };   // tolerate a backwards pick
    if (/^c:/.test(p)) return none;                       // half-filled custom = not yet a span
    if (/^r:/.test(p)) {
      const k = p.slice(2);
      const d = now ? new Date(now) : new Date(), y = d.getFullYear(), m = d.getMonth(), dd = d.getDate();
      const day = (a, b, cc) => isoOf(new Date(a, b, cc));
      switch (k) {
        case 'today': return { from: isoOf(d), to: isoOf(d) };
        case 'yday': return { from: day(y, m, dd - 1), to: day(y, m, dd - 1) };
        case 'week': return { from: isoOf(weekStart(d)), to: isoOf(d) };
        case 'month': return { from: day(y, m, 1), to: isoOf(d) };
        case 'lastmon': return { from: day(y, m - 1, 1), to: day(y, m, 0) };       // day 0 = last day of prev month
        case 'quarter': return { from: day(y, Math.floor(m / 3) * 3, 1), to: isoOf(d) };
        case 'year': return { from: day(y, 0, 1), to: isoOf(d) };
        default: return none;                             // unknown key = never invent a span
      }
    }
    if (/^\d{4}$/.test(p)) return { from: p + '-01-01', to: p + '-12-31' };
    if (/^\d{4}-\d{2}$/.test(p)) {
      const [yy, mm] = p.split('-').map(Number);
      return { from: p + '-01', to: isoOf(new Date(yy, mm, 0)) };
    }
    return none;
  }
  /* A stored value's own span. inPeriod is called with a full ISO date on most
     pages but with a bare 'YYYY-MM' on two (qlx's register filter used to
     truncate, and monthlyRegister IS a list of months). Against a prefix that
     never mattered; against a SPAN a naive compare reads '2026-07' as before
     '2026-07-01' and drops the row. So a value is a span too, and the test is
     OVERLAP — "does this month contain any day I asked for". A full date is just
     the degenerate one-day case, so one rule covers both. */
  function valueSpan(v) {
    const s = String(v || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return { s: s.slice(0, 10), e: s.slice(0, 10) };
    if (/^\d{4}-\d{2}$/.test(s)) { const [yy, mm] = s.split('-').map(Number); return { s: s + '-01', e: isoOf(new Date(yy, mm, 0)) }; }
    if (/^\d{4}$/.test(s)) return { s: s + '-01-01', e: s + '-12-31' };
    return null;
  }
  function inPeriod(date, period) {
    if (!period || period === 'all') return true;
    const isSpan = typeof period === 'object' || /^[rc]:/.test(String(period));
    if (!isSpan) {                                        // ── the original prefix rule, untouched
      const p = String(period);
      return String(date || '').slice(0, p.length) === p;
    }
    const { from, to } = rangeSpan(period);
    if (!from && !to) return true;                        // an unresolvable span filters nothing
    const v = valueSpan(date);
    if (!v) return false;                                 // no date on the row = not in a dated span
    if (from && v.e < from) return false;
    if (to && v.s > to) return false;
    return true;
  }
  /* 'March 2026' / 'Year 2026' / 'This week' / '1 Apr – 30 Jun 2026' / 'All months'.
     monthLabel deliberately returns blank for a bare 'YYYY' (it validates a
     MONTH), so the year case must be handled before delegating — inventory.html
     learned this first, and this is that function hoisted to where the other
     pages can reach it rather than copied a seventh time. */
  function periodLabel(p, allLabel) {
    if (!p || p === 'all') return allLabel || 'All months';
    if (typeof p !== 'object') {
      if (/^r:/.test(String(p))) return RANGE_LABEL[String(p).slice(2)] || (allLabel || 'All months');
      if (/^\d{4}$/.test(String(p))) return 'Year ' + p;
      if (!/^c:/.test(String(p))) return monthLabel(p, { blank: String(p) });
    }
    const { from, to } = rangeSpan(p);
    if (!from || !to) return 'Custom range';              // half-picked — say so, never show a fake span
    /* fDS2 carries the year, fDS does not. Printing it twice for one year
       ("1 Apr 2026 – 30 Jun 2026") is noise in a 264px button, so the start
       drops it only when both ends agree — across a rollover both must show it
       or the span reads as impossible ("1 Dec – 31 Jan"). */
    if (from === to) return fDS2(from);
    return (from.slice(0, 4) === to.slice(0, 4) ? fDS(from) : fDS2(from)) + ' – ' + fDS2(to);
  }
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
  // recover a real supplier name from the GSTIN when the stored name is an OCR label
  // leak (Tally "Delivery Note Mode/Terms of Payment", "the buyer", etc.)
  function nameByGstin(gstin) { if (!gstin) return ''; const g = String(gstin).trim().toUpperCase(); const p = S.PARTIES.find(x => x.gstin && String(x.gstin).trim().toUpperCase() === g && x.name && !SUP_LEAK.test(x.name)); return p ? p.name : ''; }
  function cleanSup(p) { const raw = (p.sup || '').trim(); if (raw && SUP_LEAK.test(raw)) { const rec = nameByGstin(p.gstin); if (rec) return rec; } return raw || '—'; }
  function purchaseRows() {
    const todayISO = fmtISO(new Date());
    return withIdx(S.PURCHASES).map(([p, i]) => {
      const c = cP(p);
      const g = catToGroupItem(p), gm = PGROUP_MAP[g.group] || PGROUP_MAP.other;
      let paid = +p.paid || 0;
      if (p.status === 'paid' && !paid) paid = c.tot;
      const outstanding = Math.max(0, c.tot - paid);
      const active = p.status !== 'paid' && p.status !== 'cancelled';
      const isOverdue = active && p.dueDate && p.dueDate < todayISO;
      // Freight PAYMENTS (multi-entry, cash/UPI/bank each) supersede the single
      // manual freightAmt number when any exist — payments are the truth.
      const fPays = p.freightPays || [];
      const fTotal = fPays.length ? fPays.reduce((s, f) => s + (+f.amount || 0), 0) : (+p.freightAmt || 0);
      return {
        idx: i, bill: p.bill, date: p.date, sup: cleanSup(p), cat: p.cat || 'Other',
        group: g.group, groupLabel: gm.label, emoji: gm.emoji, item: g.item, dept: g.dept,
        itemIconEmoji: itemIcon(g.item, gm.emoji),
        taxable: p.taxable, gst: c.g, itc: c.itc, total: c.tot, grate: p.grate || 0,
        qty: p.qty || 0, unit: p.unit || '', rate: p.rate || 0, desc: p.desc || '',
        status: p.status || 'pending', gstin: p.gstin || '', days: daysAgo(p.date),
        veh: p.veh || p.vehicle || '',
        remarks: p.remarks || '', dueDate: p.dueDate || '', createdBy: p.createdBy || (QL_PLANT.owner_name || QL_PLANT.plant_name || 'Owner'),
        paid, outstanding, payments: p.payments || [], attach: p.attach || [], isOverdue,
        // Freight: a dedicated freight-item bill IS freight (its whole taxable);
        // a material bill can carry a MANUAL freight add-on (p.freightAmt) the
        // user enters directly — it rolls into landed cost but NOT into this
        // bill's GST/total (transport is paid/taxed separately). freightAddon =
        // the part not already inside `total`, so landed cost never double-counts.
        freight: isFreightItem(g.item) || fTotal > 0,
        freightAmt: isFreightItem(g.item) ? (p.taxable || 0) : fTotal,
        freightAddon: isFreightItem(g.item) ? 0 : fTotal,
        // What this material ACTUALLY cost: the bill plus the freight paid to get
        // it here. A derived field, never a replacement for `total` — `total` is
        // the invoice value and stays the thing you owe THIS supplier, which is
        // what payments, outstanding and bank matching all key on. The register's
        // "Landed cost" column reads this, so it can be sorted on (qlx sorts by
        // r[key], with no accessor — a column showing one number and sorting by
        // another is a bug the eye catches only after it has misled someone).
        landed: (c.tot || 0) + (isFreightItem(g.item) ? 0 : fTotal),
        freightPays: fPays
      };
    });
  }
  function fmtISO(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // Normalise ANY bill date to ISO YYYY-MM-DD so it always groups into a month.
  // Handles "10-Dec-25" / "10-Dec-2025" / "10/12/2025" / "10-12-2025" / ISO.
  const _MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  function toISODate(s) {
    if (!s) return '';
    s = String(s).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                                    // already ISO
    var m = s.match(/^(\d{1,2})[\-\/ .]([A-Za-z]{3,})[\-\/ .](\d{2,4})$/);          // 10-Dec-25 / 10 Dec 2025
    if (m) { var mm = _MON[m[2].slice(0, 3).toLowerCase()]; if (mm) { var y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + mm + '-' + m[1].padStart(2, '0'); } }
    m = s.match(/^(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{2,4})$/);                      // 10/12/2025 (DD/MM/YYYY)
    if (m) { var yy = m[3].length === 2 ? '20' + m[3] : m[3]; return yy + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
    var d = new Date(s); if (!isNaN(d.getTime())) return fmtISO(d);                 // last resort
    return s;
  }
  // Record a (possibly partial) payment against a purchase bill. Also posts
  // ONE debit to the unified money ledger (CASHBOOK) so the payment flows into
  // account balances, the Cash Book and the Payments Center automatically.
  function recordPurchasePayment(i, amount, mode, date, extra) {
    const p = S.PURCHASES[i]; if (!p) return;
    const c = cP(p); amount = +amount || 0;
    const prev = +p.paid || (p.status === 'paid' ? c.tot : 0);
    const paid = Math.min(c.tot, prev + amount);
    /* APPLIED, not entered — see receiveSalesPayment. The ledger debit and the
       payment log record `paid - prev`, capped at what the bill still owed, so
       an over-entry can't post phantom cash going OUT. Pinned by payments.test.js. */
    const applied = Math.round((paid - prev) * 100) / 100;
    p.paid = paid;
    extra = extra || {};
    p.status = paid >= c.tot - 0.5 ? 'paid' : (paid > 0 ? 'partial' : 'pending');
    if (applied > 0.005) {
      // accountId (multi-bank): WHICH own bank account the supplier was paid from.
      p.payments = (p.payments || []).concat([{ date: date || fmtISO(new Date()), amount: applied, mode: mode || 'bank', accountId: extra.accountId || '' }]);
      S.CASHBOOK.push({ id: 'cb' + idStamp(), date: date || fmtISO(new Date()), type: 'debit', mode: methodToMode(mode), method: extra.method || modeToMethod(methodToMode(mode)), ptype: 'Purchase Payment', party: p.sup || '—', ref: extra.ref || p.bill || '', amount: applied, notes: extra.notes || '', accountId: extra.accountId || '', link: { kind: 'purchase', idx: i } });
    }
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
    const r = purchaseRows().filter(x => x.status !== 'cancelled');   // cancelled bills don't count toward totals
    return {
      count: r.length,
      total: r.reduce((a, x) => a + x.taxable, 0),
      itc: r.reduce((a, x) => a + x.itc, 0),
      pending: r.reduce((a, x) => a + (x.outstanding || 0), 0),         // true payable still owed (includes partials, nets partial payments)
      gst: r.reduce((a, x) => a + x.gst, 0)
    };
  }
  // Spend rolled up by Purchase Group (the landed cost), with item breakdown.
  function purchaseByGroup() {
    const rows = purchaseRows(), map = {};
    PURCHASE_GROUPS.forEach(g => { map[g.key] = { key: g.key, label: g.label, emoji: g.emoji, taxable: 0, gst: 0, total: 0, itc: 0, count: 0, freight: 0, items: {} }; });
    rows.forEach(r => {
      const m = map[r.group] || map.other;
      // Landed cost = bill totals + any manual freight add-on not already in them.
      m.taxable += r.taxable; m.gst += r.gst; m.total += r.total + (r.freightAddon || 0); m.itc += r.itc; m.count++;
      m.freight += r.freightAmt || (r.freight ? r.taxable : 0);
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
      pendAmt: pend.reduce((a, r) => a + r.total, 0), pendCount: countParties(pend, r => r.sup, r => r.gstin),
      itc: rows.reduce((a, r) => a + r.itc, 0),
      momCur: cur, momPrev: prev, momPct: prev > 0 ? (cur - prev) / prev * 100 : null
    };
  }

  /* ── Parties helpers ─────────────────────────────────────────── */
  function partyRows() {
    return withIdx(S.PARTIES).map(([p, i]) => ({
      idx: i, name: p.name, gstin: p.gstin || '', phone: p.phone || '',
      address: p.address || '', state: p.state || '', type: p.type || 'customer', notes: p.notes || '',
      // Running-account fields (bank-ledger model): opening balance (+ = they owe us),
      // credit limit & credit days for terms/overdue tracking.
      opening: +p.opening || 0, creditLimit: +p.creditLimit || 0, creditDays: +p.creditDays || 0,
      // WhatsApp reachability + consent. The form stores 'yes'/'no' strings;
      // wa-core tests `=== false`, so translate here rather than teaching the
      // engine about this UI's encoding. Default is opt-IN (undefined -> true):
      // an existing party with no preference set still gets their invoice.
      industry: p.industry || '',          // '' ⇒ ICPCore guesses from the name, and says it guessed
      wa: p.wa || '', waAlt: p.waAlt || '', lang: p.lang || 'en',
      autoRemind: p.autoRemind !== 'no', autoInvoice: p.autoInvoice !== 'no', autoStatement: p.autoStatement !== 'no'
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

  /* ── Running party ledger (bank-statement model) — single source of truth ──
     Assigns each sale/purchase to exactly one party (GSTIN → normalized name →
     first token, same as the CRM) and merges every money event + manual
     on-account entry into one running balance. Receivable-positive:
       Sales invoice = Dr(+) · Receipt = Cr(−) · Purchase bill = Cr(−) · Payment made = Dr(+) */
  const _lnorm = s => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  function _partyResolver() {
    const byGst = {}, byNorm = {}, byTok = {};
    S.PARTIES.forEach((p, i) => {
      if (p.gstin) byGst[_lnorm(p.gstin).replace(/ /g, '')] = i;
      const nm = _lnorm(p.name); if (nm) byNorm[nm] = i;
      const t = nm.split(' ')[0]; if (t && byTok[t] === undefined) byTok[t] = i;
    });
    return (name, gstin) => {
      const g = _lnorm(gstin).replace(/ /g, ''); if (g && byGst[g] !== undefined) return byGst[g];
      const nm = _lnorm(name); if (nm && byNorm[nm] !== undefined) return byNorm[nm];
      const t = nm.split(' ')[0]; if (t && byTok[t] !== undefined) return byTok[t];
      return -1;
    };
  }
  function ledgerNet(idx) { const p = S.PARTIES[idx]; return (p && p.ledger || []).reduce((a, e) => a + (+e.dr || 0) - (+e.cr || 0), 0); }
  function partyLedger(idx, opts) {
    opts = opts || {};
    const p = S.PARTIES[idx]; if (!p) return null;
    const resolve = _partyResolver();
    const ev = [];
    salesRows().forEach(s => {
      if (resolve(s.party, s.gstin) !== idx) return;
      ev.push({ date: s.date, o: 1, ref: s.inv || '', desc: 'Sales Invoice', dr: s.total, cr: 0, kind: 'sale', link: { kind: 'sale', idx: s.idx } });
      const pays = (s.payments && s.payments.length) ? s.payments : (s.paid > 0.5 ? [{ date: s.paidDate || s.date, amount: s.paid, mode: s.paidMode }] : []);
      pays.forEach(x => ev.push({ date: x.date || s.date, o: 2, ref: s.inv || '', desc: x.mode ? 'Receipt · ' + x.mode : 'Payment received', dr: 0, cr: +x.amount || 0, kind: 'receipt' }));
    });
    purchaseRows().forEach(b => {
      if (resolve(b.sup, b.gstin) !== idx) return;
      /* "Purchase Bill" on every row told the user nothing — six identical lines,
         and the item ("Limestone", "Petcoke", "Bags") was already sitting on `b`,
         unused. Falls back to the generic label when an old bill has no item. */
      ev.push({ date: b.date, o: 1, ref: b.bill || '', desc: itemShort(b.item) || 'Purchase Bill', dr: 0, cr: b.total, kind: 'bill', link: { kind: 'purchase', idx: b.idx } });
      const pays = (b.payments && b.payments.length) ? b.payments : (b.paid > 0.5 ? [{ date: b.date, amount: b.paid, mode: b.paidMode }] : []);
      pays.forEach(x => ev.push({ date: x.date || b.date, o: 2, ref: b.bill || '', desc: 'Payment made', dr: +x.amount || 0, cr: 0, kind: 'paymade' }));
    });
    (p.ledger || []).forEach(a => ev.push({ date: a.date, o: 2, ref: a.ref || '', desc: a.desc || (a.dr ? 'Adjustment' : 'On-account receipt'), dr: +a.dr || 0, cr: +a.cr || 0, kind: a.kind || 'manual', manualId: a.id }));
    ev.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.o - b.o);
    const opening = +p.opening || 0;
    let bal = opening; ev.forEach(e => { bal += e.dr - e.cr; e.bal = bal; });
    let rows = ev, openingForRange = opening;
    if (opts.from || opts.to) {
      const before = opts.from ? ev.filter(e => (e.date || '') < opts.from) : [];
      openingForRange = before.length ? before[before.length - 1].bal : opening;
      rows = ev.filter(e => (!opts.from || (e.date || '') >= opts.from) && (!opts.to || (e.date || '') <= opts.to));
    }
    return {
      party: p, idx, opening, openingForRange, rows, closing: bal,
      totalDr: rows.reduce((a, e) => a + e.dr, 0), totalCr: rows.reduce((a, e) => a + e.cr, 0),
      advance: bal < 0 ? -bal : 0, creditLimit: +p.creditLimit || 0, creditDays: +p.creditDays || 0
    };
  }
  // Record a receipt / payment / adjustment straight against the running balance
  // (not tied to one invoice). Mirrors it to the CASHBOOK so the money ledger agrees.
  function recordLedgerEntry(idx, e) {
    const p = S.PARTIES[idx]; if (!p) return null;
    const date = e.date || fmtISO(new Date()), cr = +e.cr || 0, dr = +e.dr || 0, lid = 'lg' + idStamp();
    p.ledger = p.ledger || [];
    p.ledger.push({ id: lid, date, desc: e.desc || (cr ? 'On-account receipt' : 'Adjustment'), dr, cr, ref: e.ref || '', mode: e.mode || '', kind: e.kind || 'manual', accountId: e.accountId || '' });
    if (cr > 0) S.CASHBOOK.push({ id: 'cb' + idStamp(), date, type: 'credit', mode: methodToMode(e.mode || 'bank'), method: e.mode || 'Bank', ptype: 'Sales Payment', party: p.name, ref: e.ref || '', amount: cr, notes: e.desc || 'On-account receipt', accountId: e.accountId || '', link: { kind: 'party', idx, ledgerId: lid } });
    else if (dr > 0) S.CASHBOOK.push({ id: 'cb' + idStamp(), date, type: 'debit', mode: methodToMode(e.mode || 'bank'), method: e.mode || 'Bank', ptype: 'Purchase Payment', party: p.name, ref: e.ref || '', amount: dr, notes: e.desc || 'On-account payment', accountId: e.accountId || '', link: { kind: 'party', idx, ledgerId: lid } });
    commit();
    return lid;
  }
  // Reverse an on-account entry (used when a reconciliation post is un-linked).
  function reverseLedgerEntry(idx, lid) {
    const p = S.PARTIES[idx]; if (!p || !lid) return;
    if (p.ledger) p.ledger = p.ledger.filter(e => e.id !== lid);
    S.CASHBOOK = S.CASHBOOK.filter(c => !(c.link && c.link.ledgerId === lid));
    commit();
  }

  /* ── Labour helpers ──────────────────────────────────────────── */
  function labourRows() {
    return withIdx(S.WORKERS).map(([w, i]) => {
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
    const rows = withIdx(S.WORKERS).map(([w, i]) => {
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
  /* id/method/accountId/link are carried because bank reconciliation matches a
     statement line against money ALREADY recorded here: it needs the id to link
     to, the method to reject cash (a cash payment can never be a bank line),
     and the accountId to keep one bank's money out of another's. */
  function cashbookRows() {
    return withIdx(S.CASHBOOK).map(([e, i]) => ({ idx: i, id: e.id || '', date: e.date, type: e.type, mode: e.mode, method: e.method || '', ptype: e.ptype || '', category: e.category || '', party: e.party || '', amount: e.amount || 0, ref: e.ref || '', notes: e.notes || '', accountId: e.accountId || '', link: e.link || null, reconTxnId: e.reconTxnId || '' }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  function cashbookBalances() {
    /* THREE bugs lived in this one function, all pinned by cashbook.test.js:
       1. It read the raw array — a deleted entry counted forever ("0 entries ·
          Balance ₹1,000"). Now liveMoney, the same rule the lists use.
       2. It bucketed by raw `e.mode === 'phonepay'` — a word the Payments page
          never writes (it writes 'upi'), so every PhonePe/GPay rupee vanished
          from this total while accountBalances counted it. Now the SAME
          methodToMode normalizer accountBalances uses: one vocabulary, two
          functions, no gap for money to fall through.
       3. `s + (e.amount || 0)` string-CONCATENATED uncoerced amounts:
          '1500' + '200' = ₹15,00,200. Now +e.amount like everywhere else.
       `phonepay` stays as an alias of upi — callers only read .total today,
       but a stale reader of .phonepay must see the money, not a phantom 0. */
    const rows = S.CASHBOOK.filter(liveMoney);
    const bal = m => rows.filter(e => methodToMode(e.method || e.mode) === m)
      .reduce((s, e) => s + (e.type === 'credit' ? 1 : -1) * (+e.amount || 0), 0);
    const cash = bal('cash'), upi = bal('upi'), bank = bal('bank');
    return { cash, upi, phonepay: upi, bank, total: cash + upi + bank, count: rows.length };
  }

  /* ── Chunna (cash/PhonePe lime-powder sales) ─────────────────── */
  function chunnaRows() {
    return withIdx(S.CHUNNA).map(([c, i]) => ({
      idx: i, date: c.date, customer: c.customer || 'Walk-in',
      qty: parseFloat(c.qty) || 0, rate: parseFloat(c.rate) || 0,
      total: parseFloat(c.total) || (parseFloat(c.qty) || 0) * (parseFloat(c.rate) || 0),
      mode: c.mode || 'cash'
    })).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  function chunnaSummary(period) {
    const all = chunnaRows();
    const r = all.filter(x => inPeriod(x.date, period));
    const ym = new Date().toISOString().slice(0, 7);
    return {
      count: r.length,
      qty: r.reduce((a, x) => a + x.qty, 0),
      total: r.reduce((a, x) => a + x.total, 0),
      /* Out of `all`, NOT `r`: this card means "the calendar month we are in",
         which does not change because the owner is looking at last March — it
         would just read ₹0 there, which is not what it says on the tin. The page
         hides it while a period is picked; `total` is the scoped number. */
      monthTotal: all.filter(x => (x.date || '').slice(0, 7) === ym).reduce((a, x) => a + x.total, 0),
      cash: r.filter(x => x.mode === 'cash').reduce((a, x) => a + x.total, 0),
      phonepay: r.filter(x => x.mode === 'phonepay').reduce((a, x) => a + x.total, 0)
    };
  }
  function addChunna(e) {
    const qty = parseFloat(e.qty) || 0, rate = parseFloat(e.rate) || 0;
    S.CHUNNA.push({ id: 'CS' + idStamp(), date: e.date, customer: e.customer || 'Walk-in', qty, rate, total: +(qty * rate).toFixed(2), mode: e.mode || 'cash', photo: '' });
    commit();
  }
  function deleteChunna(i, reason) { return softDelete('chunna', i, reason); }

  /* ── Production (daily manufacturing entries) ──────────────────────────
     A run records what was CONSUMED (limestone, petcoke, bags) and what was
     PRODUCED (quick lime, hydrated lime) that day, plus the labour cost. This
     is the missing link that turns purchases + sales into true closing stock
     and a real cost-per-ton. All quantities in tonnes (bags in count). */
  const nQ = v => parseFloat(v) || 0;
  function addProduction(e) {
    S.PROD.push({
      id: 'PR' + idStamp(), date: e.date,
      limestone: nQ(e.limestone), petcoke: nQ(e.petcoke), bags: nQ(e.bags),
      quicklime: nQ(e.quicklime), hydrated: nQ(e.hydrated), labour: nQ(e.labour),
      note: (e.note || '').toString().slice(0, 200)
    });
    commit();
  }
  function updateProduction(i, e) {
    if (!S.PROD[i]) return;
    ['limestone', 'petcoke', 'bags', 'quicklime', 'hydrated', 'labour'].forEach(k => { if (e[k] != null) S.PROD[i][k] = nQ(e[k]); });
    if (e.date) S.PROD[i].date = e.date;
    if (e.note != null) S.PROD[i].note = e.note.toString().slice(0, 200);
    commit();
  }
  function deleteProduction(i, reason) { return softDelete('production', i, reason); }
  /* `period` is optional and filters AFTER withIdx, never before: idx is the row's
     address in S.PROD and is what the delete button posts back. Filtering first
     would renumber it and delete the wrong run. */
  function productionRows(period) {
    return withIdx(S.PROD).map(([p, i]) => ({
      idx: i, date: p.date,
      limestone: nQ(p.limestone), petcoke: nQ(p.petcoke), bags: nQ(p.bags),
      quicklime: nQ(p.quicklime), hydrated: nQ(p.hydrated), labour: nQ(p.labour),
      output: nQ(p.quicklime) + nQ(p.hydrated), note: p.note || ''
    })).filter(r => inPeriod(r.date, period))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  // Average purchase rate (₹ per T / per bag) for a material group — from real bills.
  function avgRate(group) {
    const rs = purchaseRows().filter(r => r.group === group && r.status !== 'cancelled');
    const q = rs.reduce((a, r) => a + (nQ(r.qty)), 0), v = rs.reduce((a, r) => a + (nQ(r.taxable) || nQ(r.total)), 0);
    return q ? v / q : 0;
  }
  // Consumed / produced totals + derived cost-per-ton and yield.
  function prodStats() {
    const rows = productionRows();
    const sum = k => rows.reduce((a, r) => a + r[k], 0);
    const consumed = { limestone: sum('limestone'), petcoke: sum('petcoke'), bags: sum('bags') };
    const produced = { quicklime: sum('quicklime'), hydrated: sum('hydrated') };
    const output = produced.quicklime + produced.hydrated;
    const labour = sum('labour');
    const matCost = consumed.limestone * avgRate('limestone') + consumed.petcoke * avgRate('petcoke') + consumed.bags * avgRate('packaging');
    const totalCost = matCost + labour;
    return {
      runs: rows.length, consumed, produced, output, labour,
      matCost, totalCost,
      costPerTon: output ? totalCost / output : 0,
      yield: consumed.limestone ? output / consumed.limestone * 100 : 0
    };
  }

  /* ── Production DERIVED from the bills already uploaded ─────────────────
     "no need to add Production data you can get from uploded sales or purchase
      data bills with automation make sure you will also get quantity mainly"

     He is right that the tonnage is already in the books. He is wrong that it
     adds up to a production run, and the difference has to survive contact with
     this table or it becomes a lie that reads like a fact:

     · A SALES bill proves a DISPATCH — tonnes that left the gate on a date.
     · A PURCHASE bill proves an INTAKE — tonnes that arrived on a date.
     · A production RUN is limestone BURNT → lime MADE on a day. Neither bill
       witnesses that. He can dispatch out of last month's stock, and he can
       stockpile limestone for weeks. So this function never emits "produced".
       It emits what the paperwork actually saw, per month, marked as derived.

     The one honest bridge is the IMPLIED ratio: dispatch ÷ limestone intake over
     the same month. Two real numbers divided. It is NOT a yield — a yield needs a
     measured output — which is why it is called implied and only ever appears when
     BOTH sides are real.

     UNKNOWN IS NOT ZERO. A month whose limestone bills carry no readable quantity
     returns null, never 0. `0` claims he bought nothing; `null` admits the bills
     don't say. The first silently halves every ratio below it. Each figure carries
     the bills it was built from (refs) so he can check it against the paper, and
     the count it could NOT read (missing) so a blank is explained, not just blank. */

  /* Tonnes off one line. The purchase register heads its column "Qty (T)" and every
     other screen reads qty as tonnes, so a bare number is tonnes here too — one
     convention, not a new stricter one that would print '—' where the register
     prints a figure. KG/QTL convert by exact factor: arithmetic, not a guess. A unit
     that is not a weight at all (BAG, NOS, LTR) is NOT quietly counted as tonnes —
     it returns null and the line is reported as unread. */
  const U_TONNE = /^(m\.?t\.?s?|tonnes?|ton|to|t)$/i;
  const U_KG    = /^(kgs?|kilograms?)$/i;
  const U_QTL   = /^(qtls?|quintals?)$/i;
  const U_COUNT = /^(nos?|pcs?|pieces?|units?|bags?)$/i;
  function tonnesOf(r) {
    const q = parseFloat(r && r.qty); if (!(q > 0)) return null;
    const u = ((r.unit || '') + '').trim();
    if (!u || U_TONNE.test(u)) return q;
    if (U_KG.test(u))  return q / 1000;
    if (U_QTL.test(u)) return q / 10;
    return null;
  }
  function countOf(r) {
    const q = parseFloat(r && r.qty); if (!(q > 0)) return null;
    const u = ((r.unit || '') + '').trim();
    if (!u || U_COUNT.test(u)) return q;
    return null;                        // bags billed in MT: we don't know how many bags
  }
  /* Freight, royalty and loading ride INSIDE the limestone/petcoke groups (that is
     the whole point of the landed-cost taxonomy). Their qty is the same tonnage as
     the material bill they attach to — counting them as intake would book every load
     twice. Only the material purchase itself is an intake. */
  const isMaterialBuy = it => !isFreightItem(it) && !/royalty/i.test(it || '');

  function derivedCell(rows, conv, label) {
    let v = null, read = 0; const refs = [];
    (rows || []).forEach(r => {
      const n = conv(r);
      if (n == null) return;
      v = (v || 0) + n; read++;
      refs.push({ ref: r.bill || r.inv || '—', date: r.date, party: r.sup || r.party || '', qty: n });
    });
    return { v, label: label || '', bills: (rows || []).length, read, missing: (rows || []).length - read, refs, measured: false };
  }
  const measuredCell = (v, refs) => ({ v: v > 0 ? v : null, bills: refs.length, read: refs.length, missing: 0, refs, measured: true });

  /* `period` scopes which MONTHS are emitted — 'all' | 'YYYY' | 'YYYY-MM', through
     QLD.inPeriod like every other page, so "Whole year 2026" widens the table
     instead of emptying it (a `=== period` test here would match nothing for a
     year). The per-month arithmetic below is untouched by it: each month is still
     built from every bill dated in that month, so a scoped row and an unscoped row
     for the same month are the same row. */
  function productionDerived(period) {
    const sal = salesRows().filter(r => r.status !== 'cancelled');
    const pur = purchaseRows().filter(r => r.status !== 'cancelled');
    const runs = productionRows();
    const ymOk = m => /^\d{4}-\d{2}$/.test(m);
    const months = [...new Set([...sal, ...pur, ...runs].map(r => ymOf(r.date)).filter(ymOk))]
      .filter(ym => inPeriod(ym, period)).sort().reverse();
    // A sale states its product only when it was raised in the invoice builder; a
    // bill imported by OCR does not. The app has always treated an unstated GST sale
    // as quick lime (topProducts, invoiceData) — keep that one convention rather than
    // invent a second. Hydrated is counted ONLY where the invoice says so, so a firm
    // that never types it sees '—' rather than a number nobody wrote down.
    const isHyd = p => /hydrat|slaked/i.test(p || '');
    return months.map(ym => {
      const inM = r => ymOf(r.date) === ym;
      const pM = pur.filter(inM), sM = sal.filter(inM), rM = runs.filter(inM);
      const lime  = pM.filter(r => r.group === 'limestone' && isMaterialBuy(r.item));
      const coke  = pM.filter(r => r.group === 'petcoke'   && isMaterialBuy(r.item));
      const bags  = pM.filter(r => r.group === 'packaging' && !/printing/i.test(r.item));
      const hyd   = sM.filter(r => isHyd(r.product));
      const ql    = sM.filter(r => !isHyd(r.product));
      const row = {
        ym, label: monthLabel(ym, { short: true }), source: 'derived', runs: rM.length,
        limestone: derivedCell(lime, tonnesOf, 'limestone bills'),
        petcoke:   derivedCell(coke, tonnesOf, 'petcoke bills'),
        bags:      derivedCell(bags, countOf,  'packaging bills'),
        quicklime: derivedCell(ql,   tonnesOf, 'quick lime invoices'),
        hydrated:  derivedCell(hyd,  tonnesOf, 'hydrated lime invoices'),
        labour: null, implied: null
      };
      /* A measured run beats the paperwork for the period it covers: its limestone is
         CONSUMED (not merely delivered) and its lime is PRODUCED (not merely sold).
         It overrides — but only cell by cell, and only where he actually wrote a
         number. A run that records limestone and leaves output blank must not blank
         out the dispatch the invoices prove. What the bills said is kept in `bills`
         so the row can show its own working. */
      if (rM.length) {
        const sum = k => rM.reduce((a, r) => a + (+r[k] || 0), 0);
        const refs = rM.map(r => ({ ref: 'Run ' + (r.date || ''), date: r.date, party: '', qty: 0 }));
        const over = {};
        [['limestone', 'limestone'], ['petcoke', 'petcoke'], ['bags', 'bags'], ['quicklime', 'quicklime'], ['hydrated', 'hydrated']]
          .forEach(([k, f]) => { const v = sum(f); if (v > 0) over[k] = measuredCell(v, refs); });
        if (Object.keys(over).length) {
          row.bills = { limestone: row.limestone, petcoke: row.petcoke, bags: row.bags, quicklime: row.quicklime, hydrated: row.hydrated };
          row.source = 'measured';
          Object.assign(row, over);
          row.overrode = Object.keys(over);
        }
        const lab = sum('labour'); row.labour = lab > 0 ? lab : null;
      }
      // Implied ratio: only when BOTH sides are real numbers, never on one alone.
      const out = (row.quicklime.v || 0) + (row.hydrated.v || 0);
      const hasOut = row.quicklime.v != null || row.hydrated.v != null;
      if (hasOut && row.limestone.v > 0) row.implied = out / row.limestone.v * 100;
      return row;
    });
  }
  /* How much of the tonnage is simply missing off the bills. This is the number that
     decides whether the page is useful yet — the Purchase register reads the old
     bills' tonnage back off their PDFs on its own, so this shrinks on its own once
     he opens it. Computed, not assumed, and the page says it out loud. */
  function derivedQtyGaps(period) {
    const pur = purchaseRows().filter(r => r.status !== 'cancelled' && inPeriod(r.date, period))
      .filter(r => ['limestone', 'petcoke', 'packaging'].includes(r.group) && isMaterialBuy(r.item));
    const sal = salesRows().filter(r => r.status !== 'cancelled' && inPeriod(r.date, period));
    const miss = a => a.filter(r => !(parseFloat(r.qty) > 0)).length;
    return {
      purchase: { total: pur.length, missing: miss(pur), fixable: pur.filter(r => !(parseFloat(r.qty) > 0) && (r.attach || []).length).length },
      sales:    { total: sal.length, missing: miss(sal) }
    };
  }

  /* ── GST Refunds (RFD-01 inverted-duty / petcoke refunds + CA commission) ──
     status: filed → sanctioned → received. CA commission is charged only on an
     amount RECEIVED (default 5%, per-refund override); net retention = received
     − commission. A pending refund shows the expected commission for planning. */
  function addRefund(r) {
    const total = +r.total || ((+r.igst || 0) + (+r.cgst || 0) + (+r.sgst || 0) + (+r.cess || 0));
    S.REFUNDS.push({
      id: 'RF' + idStamp(), arn: (r.arn || '').toUpperCase().trim(), gstin: (r.gstin || '').toUpperCase().trim(),
      fromPeriod: r.fromPeriod || '', toPeriod: r.toPeriod || '', reason: r.reason || '', appDate: r.appDate || '', kind: r.kind || 'RFD-01',
      igst: +r.igst || 0, cgst: +r.cgst || 0, sgst: +r.sgst || 0, cess: +r.cess || 0, total,
      status: r.status || 'filed', receivedAmount: +r.receivedAmount || 0, receivedDate: r.receivedDate || '',
      caRate: r.caRate != null ? +r.caRate : 5, note: r.note || ''
    });
    commit();
  }
  function updateRefund(i, patch) {
    const r = S.REFUNDS[i]; if (!r) return;
    Object.assign(r, patch);
    if (['igst', 'cgst', 'sgst', 'cess'].some(k => k in patch)) r.total = (+r.igst || 0) + (+r.cgst || 0) + (+r.sgst || 0) + (+r.cess || 0);
    // marking received without an explicit amount defaults to the claimed total
    if (patch.status === 'received' && !(+r.receivedAmount)) r.receivedAmount = r.total;
    commit();
  }
  function deleteRefund(i) { if (S.REFUNDS[i]) { S.REFUNDS.splice(i, 1); commit(); } }
  function refundRows() {
    return S.REFUNDS.map((r, i) => {
      const total = +r.total || 0, rate = r.caRate != null ? +r.caRate : 5;
      const isRec = r.status === 'received';
      const received = isRec ? (+r.receivedAmount || total) : 0;
      const caCommission = +(received * rate / 100).toFixed(2);
      const expectedComm = +(total * rate / 100).toFixed(2);
      return {
        idx: i, arn: r.arn || '', gstin: r.gstin || '', fromPeriod: r.fromPeriod || '', toPeriod: r.toPeriod || '',
        period: (r.fromPeriod || '') + (r.toPeriod && r.toPeriod !== r.fromPeriod ? '–' + r.toPeriod : ''),
        reason: r.reason || '', appDate: r.appDate || '', kind: r.kind || 'RFD-01',
        igst: +r.igst || 0, cgst: +r.cgst || 0, sgst: +r.sgst || 0, cess: +r.cess || 0, total,
        status: r.status || 'filed', received, receivedDate: r.receivedDate || '',
        caRate: rate, caCommission, expectedComm, netRetention: +(received - caCommission).toFixed(2), note: r.note || ''
      };
    }).reverse();
  }
  function refundSummary() {
    const rows = refundRows();
    const rec = rows.filter(r => r.status === 'received');
    return {
      count: rows.length, receivedCount: rec.length,
      claimed: rows.reduce((a, r) => a + r.total, 0),
      received: rec.reduce((a, r) => a + r.received, 0),
      pending: rows.filter(r => r.status !== 'received').reduce((a, r) => a + r.total, 0),
      caPaid: rows.reduce((a, r) => a + r.caCommission, 0),
      netRet: rows.reduce((a, r) => a + r.netRetention, 0)
    };
  }
  // Double-entry journal entries for one refund (receipt + CA professional fee).
  function refundJournal(row) {
    const j = [];
    j.push({ when: row.appDate || '', title: 'Refund application filed (' + (row.arn || '') + ')', lines: [
      { acc: 'GST Refund Receivable', dr: row.total, cr: 0 },
      { acc: 'Electronic Credit Ledger (ITC)', dr: 0, cr: row.total }
    ] });
    if (row.status === 'received') {
      j.push({ when: row.receivedDate || '', title: 'Refund received in bank', lines: [
        { acc: 'Bank', dr: row.received, cr: 0 },
        { acc: 'GST Refund Receivable', dr: 0, cr: row.received }
      ] });
      if (row.caCommission > 0) j.push({ when: row.receivedDate || '', title: 'CA professional fee @ ' + row.caRate + '% on refund', lines: [
        { acc: 'Professional Fees (CA)', dr: row.caCommission, cr: 0 },
        { acc: 'Bank / CA Payable', dr: 0, cr: row.caCommission }
      ] });
    }
    return j;
  }

  /* ── Bank accounts (multi-bank, per firm) ─────────────────────────
     First-class records inside the per-company blob (key `bankAccounts`).
     Blob stays authoritative; each write also fire-and-forget mirrors the
     account to the relational store (recon.php add_account) so bank_txns
     rows can reference account_id. Legacy S.FINANCE.accounts (A1/A2
     placeholders) is untouched — this store supersedes it going forward. */
  const BANK_TYPES = { current: 'Current', cc_od: 'CC / OD', savings: 'Savings', loan: 'Loan account' };
  function bankAccounts(includeArchived) {
    return S.BANK_ACCOUNTS.filter(a => includeArchived || !a.archived);
  }
  function bankAccountById(id) { return S.BANK_ACCOUNTS.find(a => a.id === id) || null; }
  function bankAccountLabel(id) {
    const a = bankAccountById(id);
    if (!a) return '';
    return a.label || [a.bank, a.acctNo ? '··' + String(a.acctNo).slice(-4) : ''].filter(Boolean).join(' ');
  }
  function _mirrorBankAccount(a) {
    try {
      if (window.QLReconAPI && QLReconAPI.mirrorAccount) QLReconAPI.mirrorAccount(ACTIVE_CO, a);
    } catch (_) { /* mirror is best-effort; blob is authoritative */ }
  }
  function _cleanBankAccount(a, prev) {
    const p = prev || {};
    const bank = (a.bank != null ? a.bank : p.bank || '').toString().trim();
    const acctNo = (a.acctNo != null ? a.acctNo : p.acctNo || '').toString().replace(/\s+/g, '');
    return {
      bank,
      acctNo,
      ifsc: (a.ifsc != null ? a.ifsc : p.ifsc || '').toString().trim().toUpperCase(),
      type: BANK_TYPES[a.type] ? a.type : (BANK_TYPES[p.type] ? p.type : 'current'),
      label: (a.label != null ? a.label : p.label || '').toString().trim()
        || [bank, acctNo ? '··' + acctNo.slice(-4) : ''].filter(Boolean).join(' ') || 'Bank account',
      openingBalance: a.openingBalance != null ? (+a.openingBalance || 0) : (+p.openingBalance || 0),
      openingDate: (a.openingDate != null ? a.openingDate : p.openingDate || '').toString().trim()
    };
  }
  /* ── Statement uploads ──────────────────────────────────────────
     One record per imported file, scoped to a bank account. Nothing recorded
     this before, so a bank card could not say when it was last updated, there
     was no history to re-import from, and the same PDF could be imported twice
     with only per-row dedupe standing in the way.

     This is a LOG of what was imported, not the transactions themselves — those
     stay in S.RECON.txns keyed by accountId. Deleting a statement record must
     therefore never be assumed to delete its rows; that is a separate decision
     and deliberately not implemented here. */
  function addStatement(s) {
    s = s || {};
    const rec = {
      id: 'ST' + idStamp(),
      accountId: (s.accountId || '').toString(),
      file: (s.file || '').toString(),
      rows: +s.rows || 0,
      from: (s.from || '').toString(),        // ISO — earliest txn date in the file
      to: (s.to || '').toString(),            // ISO — latest
      uploadedAt: nowISO(),
      uploadedBy: (QL_PLANT && (QL_PLANT.owner_name || QL_PLANT.user_name)) || '',
      sha: (s.sha || '').toString()           // content hash, for exact re-upload detection
    };
    S.STATEMENTS.push(rec);
    logAudit('create', 'statement', rec, { ref: rec.file });
    commit();
    return rec;
  }
  function statementRows(accountId) {
    return S.STATEMENTS
      .filter(s => !accountId || s.accountId === accountId)
      .slice()
      .sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  }
  function lastStatement(accountId) { return statementRows(accountId)[0] || null; }
  /* removeReconTxns() lived here: a hard splice of bank rows, built for
     dedupe.js's "Find duplicates" broom and called by nothing else. It went with
     it. Duplicates are refused at import now (ImportGuard, above), so a function
     whose whole job is HARD-DELETING bank rows — no soft-delete, no Trash, no
     restore — had no remaining caller and no reason to stay on the API where the
     next "clean this up" feature would find it and reach for it. Bank rows are
     what the bank told you; the app does not get to quietly drop them. */

  function removeStatement(id) {
    const i = S.STATEMENTS.findIndex(s => s.id === id);
    if (i < 0) return false;
    /* The imported TRANSACTIONS are not touched. Removing the log entry while
       silently deleting a month of reconciled bank lines would destroy work with
       no warning — if the rows should go too, that must be asked, not assumed. */
    logAudit('delete', 'statement', S.STATEMENTS[i], { ref: S.STATEMENTS[i].file });
    S.STATEMENTS.splice(i, 1); commit();
    return true;
  }

  /* Would this upload duplicate or overlap what is already in? Returns a verdict
     for the UI to SHOW — it never blocks by itself. A firm re-importing a
     corrected statement is doing something legitimate; the job here is to make
     sure they know what they are about to do, not to decide for them. */
  function statementConflict(accountId, o) {
    o = o || {};
    const mine = statementRows(accountId);
    const exact = o.sha ? mine.find(s => s.sha && s.sha === o.sha) : null;
    if (exact) return { kind: 'duplicate', of: exact, msg: 'This exact file was already imported on ' + fDS(exact.uploadedAt.slice(0, 10)) + ' (' + exact.rows + ' rows).' };
    if (o.from && o.to) {
      const hit = mine.find(s => s.from && s.to && !(o.to < s.from || o.from > s.to));
      if (hit) return { kind: 'overlap', of: hit, msg: 'Dates overlap "' + hit.file + '" (' + fDS(hit.from) + ' – ' + fDS(hit.to) + '). Rows already imported are skipped automatically.' };
    }
    return { kind: 'none' };
  }

  function addBankAccount(a) {
    const acc = Object.assign({ id: 'BA' + idStamp(), archived: false, createdAt: nowISO() }, _cleanBankAccount(a || {}));
    S.BANK_ACCOUNTS.push(acc);
    logAudit('create', 'bank_account', acc, { ref: acc.label });
    commit(); _mirrorBankAccount(acc);
    return acc;
  }
  function updateBankAccount(id, patch) {
    const acc = bankAccountById(id); if (!acc) return null;
    Object.assign(acc, _cleanBankAccount(patch || {}, acc));
    logAudit('edit', 'bank_account', acc, { ref: acc.label });
    commit(); _mirrorBankAccount(acc);
    return acc;
  }
  function setBankAccountArchived(id, archived) {
    const acc = bankAccountById(id); if (!acc) return null;
    acc.archived = !!archived;
    logAudit(archived ? 'archive' : 'restore', 'bank_account', acc, { ref: acc.label });
    commit();
    return acc;
  }

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
    /* liveMoney, same as the lists: a trashed payment must leave the BALANCE,
       not only the timeline. Payments can never be purged (financial guard), so
       without this the headline number was overstated by every deleted entry,
       permanently, on every screen that shows it. */
    const bucket = b => S.CASHBOOK.filter(liveMoney).reduce((s, e) => methodToMode(e.method || e.mode) !== b ? s : s + (e.type === 'credit' ? 1 : -1) * (+e.amount || 0), +openA[b] || 0);
    const cash = bucket('cash'), bank = bucket('bank'), upi = bucket('upi');
    return { cash, bank, upi, total: cash + bank + upi };
  }
  function paymentsLedger() {
    const asc = withIdx(S.CASHBOOK).map(([e, i]) => ({
      id: e.id || ('cb' + i), idx: i, date: e.date || '',
      party: e.party || e.category || '—', ptype: e.ptype || (e.type === 'credit' ? 'Receipt' : 'Payment'),
      ref: e.ref || '', method: e.method || modeToMethod(e.mode), mode: methodToMode(e.method || e.mode),
      dir: e.type === 'credit' ? 'in' : 'out',
      credit: e.type === 'credit' ? (+e.amount || 0) : 0, debit: e.type === 'debit' ? (+e.amount || 0) : 0,
      amount: +e.amount || 0, status: e.status || 'Completed', notes: e.notes || '', link: e.link || null, category: e.category || '',
      accountId: e.accountId || '', account: e.accountId ? bankAccountLabel(e.accountId) : ''
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
    /* APPLIED, not entered. `paid` is capped at the invoice total, but the
       cashbook credit and the payment log must record what ACTUALLY reduced the
       balance — `paid - prev` — never the raw entered amount. Recording the raw
       amount (the old bug) let ₹30k entered against a ₹10k-outstanding bill post
       a ₹30k cashbook credit: the invoice showed paid, the cashbook showed ₹20k
       of phantom money, and that phantom could itself be matched to a bank line.
       The person entering the payment sees the outstanding figure, so an amount
       over it is a typo, not a real overpayment; this app has no advance bucket
       to hold a genuine excess. Pinned by payments.test.js. */
    const applied = Math.round((paid - prev) * 100) / 100;
    s.paid = paid; s.status = paid >= c.tot - 0.5 ? 'paid' : (paid > 0 ? 'partial' : 'pending');
    s.paidDate = o.date || fmtISO(new Date()); s.paidMode = o.method || 'Bank';
    if (applied > 0.005) {
      // accountId (multi-bank): WHICH own bank account the customer paid into.
      s.payments = (s.payments || []).concat([{ date: s.paidDate, amount: applied, method: o.method || 'Bank', accountId: o.accountId || '' }]);
      S.CASHBOOK.push({ id: 'cb' + idStamp(), date: s.paidDate, type: 'credit', mode: methodToMode(o.method), method: o.method || 'Bank', ptype: 'Sales Payment', party: s.party || '—', ref: o.ref || s.inv || '', amount: applied, notes: o.notes || '', accountId: o.accountId || '', link: { kind: 'sale', idx: i } });
    }
    commit();
  }
  function payPurchaseBill(i, o) { o = o || {}; recordPurchasePayment(i, o.amount, methodToMode(o.method), o.date, { method: o.method, ref: o.ref, notes: o.notes, accountId: o.accountId || '' }); }

  /* ── Freight payments on a purchase bill (multi-bank aware) ──────────
     Every petcoke/limestone truck usually has a SEPARATE freight payment —
     cash to the driver, UPI or bank to the transporter. Each entry lives on
     the bill (p.freightPays[]) so landed cost = material + freight, AND posts
     one linked 'Freight' row to the Payments ledger (with the bank account it
     left from, when online). Freight is an expense — no GST/ITC is claimed
     (GTA transport is typically RCM); the bill's own GST math is untouched. */
  function addFreightPayment(i, f) {
    const p = S.PURCHASES[i]; if (!p) return null; f = f || {};
    const fr = {
      id: 'fr' + idStamp(), date: toISODate(f.date) || fmtISO(new Date()), amount: +f.amount || 0,
      method: f.method || 'Cash', accountId: f.accountId || '', paidTo: (f.paidTo || '').toString().trim(),
      veh: (f.veh || '').toString().trim().toUpperCase(), ref: f.ref || '', notes: f.notes || '',
      /* The consignment note (LR/GR) and the driver. This object is a WHITELIST —
         anything not named here is dropped on save, silently — so a field is only
         real once it is written down in both places. Both are optional: a freight
         payment made before the LR arrives is still a payment. */
      lr: (f.lr || '').toString().trim(), driver: (f.driver || '').toString().trim(),
      driverPhone: (f.driverPhone || '').toString().trim()
    };
    if (!(fr.amount > 0)) return null;
    p.freightPays = (p.freightPays || []).concat([fr]);
    S.CASHBOOK.push({
      id: 'cb' + idStamp(), date: fr.date, type: 'debit', mode: methodToMode(fr.method), method: fr.method,
      ptype: 'Freight', party: fr.paidTo || ('Freight · ' + (p.sup || '—')), ref: fr.ref || p.bill || '',
      amount: fr.amount, notes: (fr.veh ? '🚚 ' + fr.veh + ' · ' : '') + 'Freight for bill ' + (p.bill || '—'),
      accountId: fr.accountId, link: { kind: 'purchase', idx: i, freightId: fr.id }
    });
    logAudit('create', 'freight', fr, { ref: p.bill || '', party: fr.paidTo, amount: fr.amount });
    commit();
    return fr;
  }
  function deleteFreightPayment(i, fid, reason) {
    const p = S.PURCHASES[i]; if (!p || !fid) return false;
    const fr = (p.freightPays || []).find(x => x.id === fid); if (!fr) return false;
    p.freightPays = p.freightPays.filter(x => x.id !== fid);
    const ci = S.CASHBOOK.findIndex(e => e && e.link && e.link.freightId === fid && !e._del);
    if (ci >= 0) softDelete('payment', ci, reason || 'freight removed from bill');   // ledger row → Trash
    logAudit('delete', 'freight', fr, { ref: p.bill || '', amount: fr.amount, reason: reason || '' });
    commit();
    return true;
  }
  /* Amend the paperwork on a freight payment — the LR/consignment note and the
     driver usually arrive AFTER the money is sent, so they have to be addable
     later or they never get recorded at all.

     Deliberately narrow: the MONEY (amount, method, account, date) is not
     editable here. Those posted a cashbook row when the payment was made, and
     silently rewriting an amount would put the ledger and the bill out of step
     with no trace. Correcting money means deleting the payment (which trashes
     its ledger row, recoverably) and re-adding it. */
  function updateFreightNote(i, fid, f) {
    const p = S.PURCHASES[i]; if (!p || !fid) return false;
    const fr = (p.freightPays || []).find(x => x.id === fid); if (!fr) return false;
    f = f || {};
    if (f.lr != null) fr.lr = String(f.lr).trim();
    if (f.driver != null) fr.driver = String(f.driver).trim();
    if (f.driverPhone != null) fr.driverPhone = String(f.driverPhone).trim();
    if (f.veh != null) fr.veh = String(f.veh).trim().toUpperCase();
    if (f.paidTo != null) fr.paidTo = String(f.paidTo).trim();
    logAudit('update', 'freight', fr, { ref: p.bill || '', party: fr.paidTo, amount: fr.amount });
    commit();
    return true;
  }
  function addLedgerPayment(o) {
    o = o || {};
    S.CASHBOOK.push({ id: 'cb' + idStamp(), date: o.date || fmtISO(new Date()), type: o.dir === 'in' ? 'credit' : 'debit', mode: methodToMode(o.method), method: o.method || 'Cash', ptype: o.ptype || 'Other', party: o.party || '—', ref: o.ref || '', amount: +o.amount || 0, notes: o.notes || '', category: o.category || '', accountId: o.accountId || '', link: o.link || null });
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
    S.CASHBOOK.push({ id: 'cb' + idStamp(), date: o.date || fmtISO(new Date()), type: 'debit', mode: methodToMode(o.method), method: o.method || 'Bank', ptype: 'Loan EMI', party: l.name || l.bank || 'Loan', ref: o.ref || '', amount: amt, notes: o.notes || '', accountId: o.accountId || '', link: { kind: 'loan', idx: i } });
    saveLoans(); commit();
  }
  function deleteLedgerEntry(i, reason) { return softDelete('payment', i, reason); }
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
    const bg = s.gstin || partyGstin(s.party);   // resolve buyer GSTIN (sale record, else the party) for inter-state detection
    const interState = bg && bg.length >= 2 && bg.slice(0, 2) !== '08';   // seller is 08 (Rajasthan)
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
  function gstSummary(period) {
    const ts = totS(period), tp = totP(period);
    const out = ts.cgst + ts.sgst + ts.igst;
    return { outGST: out, cgst: ts.cgst, sgst: ts.sgst, igst: ts.igst || 0, itc: tp.itc, net: Math.max(0, out - tp.itc), taxable: ts.tx, purchaseTaxable: tp.tx };
  }

  /* ── TDS (tax deducted at source) ────────────────────────────── */
  function tdsRows() {
    return withIdx(S.TDS).map(([e, i]) => {
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
  function deleteTds(i, reason) { return softDelete('tds', i, reason); }

  /* ── Monthly register (combined sales + purchase by month) ───── */
  /* `period` narrows WHICH month rows the register lists — 'YYYY' is the useful
     one here (a year's twelve rows, which is what this table is for); 'YYYY-MM'
     legitimately leaves a single row, because the register is a list of months
     and the owner asked for one. */
  function monthlyRegister(period) {
    const months = [...new Set([...S.SALES.map(s => ymOf(s.date)), ...S.PURCHASES.map(p => ymOf(p.date))].filter(Boolean))]
      .filter(ym => inPeriod(ym, period)).sort().reverse();
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
  // The totals row must add up the rows ACTUALLY on screen, so it takes the same
  // period — a footer that totals twelve months under a one-month table is the
  // half-wired filter this whole change exists to avoid.
  function monthlyRegisterTotals(period) {
    return monthlyRegister(period).reduce((a, m) => ({ invoices: a.invoices + m.invoices, bills: a.bills + m.bills, qty: a.qty + m.qty, salesTotal: a.salesTotal + m.salesTotal, purchaseTax: a.purchaseTax + m.purchaseTax, profit: a.profit + m.profit }), { invoices: 0, bills: 0, qty: 0, salesTotal: 0, purchaseTax: 0, profit: 0 });
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
    const _pend = S.PURCHASES.filter(p => (p.status || 'pending') === 'pending');
    const _bIdx = partyIndex(_pend, p => p.sup, p => p.gstin);   // by identity, not spelling
    _pend.forEach(p => {
      const k = _bIdx.keyOf(p.sup, p.gstin); bySup[k] = bySup[k] || { sup: _bIdx.labelOf(k), gstin: _bIdx.gstinFor(k), total: 0, bills: 0, oldest: p.date };
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
    { id: 'cashflow', name: 'Cash Flow Summary', icon: '💵' },
    { id: 'refunds', name: 'GST Refunds', icon: '🏛️' }
  ];
  function buildReport(type, from, to) {
    const inR = d => (!from || (d || '') >= from) && (!to || (d || '') <= to);
    const period = from || to ? `${from ? fDS2(from) : 'start'} – ${to ? fDS2(to) : 'today'}` : 'All time';
    const meta = REPORT_TYPES.find(r => r.id === type) || { name: type };
    let headers = [], rows = [], totals = null, kpis = [];
    // Date-scoped + cancelled/voided-excluded working set — the report period
    // filter is honoured everywhere, and voided invoices/bills never inflate totals.
    const active = arr => arr.filter(x => inR(x.date) && (x.status || 'pending') !== 'cancelled');
    const gstSplit = sr => { let cg = 0, sg = 0, ig = 0; sr.forEach(x => { const inter = !!(x.gstin && x.gstin.length >= 2 && x.gstin.slice(0, 2) !== '08'); if (inter) ig += x.gst; else { cg += x.gst / 2; sg += x.gst / 2; } }); return { cg, sg, ig, out: cg + sg + ig }; };
    if (type === 'sales') {
      const r = active(salesRows());
      headers = ['Invoice', 'Date', 'Party', 'GSTIN', 'Vehicle', 'Qty (T)', 'Taxable', 'GST', 'Total', 'Status'];
      rows = r.map(x => [x.inv, x.date, x.party, x.gstin || '—', x.veh || '—', x.qty, x.taxable, x.gst, x.total, x.status]);
      const tx = r.reduce((a, x) => a + x.taxable, 0), gst = r.reduce((a, x) => a + x.gst, 0), tot = r.reduce((a, x) => a + x.total, 0);
      totals = ['Total', '', r.length + ' inv', '', '', r.reduce((a, x) => a + x.qty, 0), tx, gst, tot, ''];
      kpis = [['Invoices', r.length], ['Taxable sales', fC(tx)], ['GST', fC(gst)], ['Total', fC(tot)]];
    } else if (type === 'purchase') {
      const r = active(purchaseRows());
      headers = ['Bill', 'Date', 'Supplier', 'Category', 'Taxable', 'GST', 'ITC', 'Total', 'Status'];
      rows = r.map(x => [x.bill, x.date, x.sup, x.groupLabel || x.cat || 'Other', x.taxable, x.gst, x.itc, x.total, x.status]);
      const tx = r.reduce((a, x) => a + x.taxable, 0), itc = r.reduce((a, x) => a + x.itc, 0);
      totals = ['Total', '', r.length + ' bills', '', tx, r.reduce((a, x) => a + x.gst, 0), itc, r.reduce((a, x) => a + x.total, 0), ''];
      kpis = [['Bills', r.length], ['Taxable', fC(tx)], ['ITC', fC(itc)]];
    } else if (type === 'collections') {
      // Customer receivables — a point-in-time snapshot (what's owed right now).
      const c = collections('all');
      headers = ['Customer', 'Bills', 'Outstanding', 'Oldest', 'Days'];
      rows = c.rows.map(x => [x.party, x.bills, x.total, x.oldest, x.days]);
      totals = ['Total', '', c.total, '', ''];
      kpis = [['Customers', c.parties], ['To collect', fC(c.total)], ['Overdue 30d+', c.overdue]];
    } else if (type === 'outstanding') {
      // Supplier payables — what WE owe (distinct from customer collections).
      const pend = purchaseRows().filter(r => r.outstanding > 0.5 && (r.status || 'pending') !== 'cancelled');
      const by = {};
      const sidx = partyIndex(pend, r => r.sup, r => r.gstin);
      pend.forEach(r => { const k = sidx.keyOf(r.sup, r.gstin); (by[k] = by[k] || { sup: sidx.labelOf(k), gstin: sidx.gstinFor(k), bills: 0, total: 0, oldest: r.date }); by[k].bills++; by[k].total += r.outstanding; if ((r.date || '') < by[k].oldest) by[k].oldest = r.date; });
      const list = Object.values(by).map(r => ({ ...r, days: daysAgo(r.oldest) })).sort((a, b) => b.total - a.total);
      const tot = list.reduce((a, x) => a + x.total, 0);
      headers = ['Supplier', 'Bills', 'Outstanding', 'Oldest', 'Days'];
      rows = list.map(x => [x.sup, x.bills, x.total, x.oldest, x.days]);
      totals = ['Total', '', tot, '', ''];
      kpis = [['Suppliers', list.length], ['To pay', fC(tot)], ['Overdue 30d+', list.filter(x => x.days > 30).length]];
    } else if (type === 'pl') {
      const sr = active(salesRows()), pr = active(purchaseRows());
      const rev = sr.reduce((a, x) => a + x.taxable, 0), cogs = pr.reduce((a, x) => a + x.taxable, 0), gp = rev - cogs;
      const labour = cashbookRows().filter(x => inR(x.date) && x.type === 'debit' && /labour|labor|wage|salary|mazdoor|hamali|payroll/i.test((x.category || '') + ' ' + (x.notes || '') + ' ' + (x.party || ''))).reduce((a, x) => a + x.amount, 0);
      const ebitda = gp - labour;
      const gs = gstSplit(sr), itc = pr.reduce((a, x) => a + x.itc, 0), netGST = Math.max(0, gs.out - itc), np = ebitda - netGST;
      headers = ['Line', 'Amount'];
      rows = [['Revenue (taxable)', rev], ['Less: Material cost', -cogs], ['Gross profit', gp], ['Less: Labour', -labour], ['EBITDA', ebitda], ['Less: Net GST', -netGST], ['Net profit', np]];
      const gpm = rev ? gp / rev * 100 : 0, npm = rev ? np / rev * 100 : 0;
      kpis = [['Revenue', fC(rev)], ['Gross profit', fC(gp) + ' (' + gpm.toFixed(1) + '%)'], ['Net profit', fC(np) + ' (' + npm.toFixed(1) + '%)']];
    } else if (type === 'gst') {
      const sr = active(salesRows()), pr = active(purchaseRows());
      const gs = gstSplit(sr), itc = pr.reduce((a, x) => a + x.itc, 0), net = Math.max(0, gs.out - itc);
      const txS = sr.reduce((a, x) => a + x.taxable, 0), txP = pr.reduce((a, x) => a + x.taxable, 0);
      headers = ['Particulars', 'Amount'];
      rows = [['CGST (output)', gs.cg], ['SGST (output)', gs.sg], ['IGST (output)', gs.ig], ['Total output GST', gs.out], ['Less: Input tax credit', -itc], ['Net GST payable', net], ['Taxable sales', txS], ['Taxable purchases', txP]];
      kpis = [['Output GST', fC(gs.out)], ['ITC', fC(itc)], ['Net payable', fC(net)]];
    } else if (type === 'production') {
      const pr = production(), ser = monthSeries(6);
      headers = ['Month', 'Dispatch (T)', 'Invoices'];
      rows = ser.slice().reverse().map(m => [m.m, +m.qty.toFixed(1), m.invoices]);
      kpis = [['Today', fmt(pr.today, 1) + ' T'], ['This month', fmt(pr.month, 1) + ' T'], ['Chunna (month)', fmt(pr.chunnaMonth, 1) + ' T']];
    } else if (type === 'topcustomers') {
      const by = {}; active(salesRows()).forEach(x => { by[x.party] = (by[x.party] || 0) + x.total; });
      const list = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 20);
      headers = ['#', 'Customer', 'Total'];
      rows = list.map((x, i) => [i + 1, x[0], x[1]]);
      kpis = [['Customers', Object.keys(by).length], ['Top', list[0] ? list[0][0] : '—']];
    } else if (type === 'topsuppliers') {
      const by = {}; active(purchaseRows()).forEach(x => { by[x.sup] = (by[x.sup] || 0) + x.taxable; });
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
    } else if (type === 'refunds') {
      const rs = refundRows();
      headers = ['ARN', 'Period', 'Reason', 'Claimed', 'Status', 'Received', 'CA %', 'CA Fee', 'Net Retention'];
      rows = rs.map(r => [r.arn, r.period, (r.reason || '').slice(0, 30), r.total, r.status, r.status === 'received' ? r.received : '', r.caRate + '%', r.status === 'received' ? r.caCommission : '', r.status === 'received' ? r.netRetention : '']);
      const claimed = rs.reduce((a, r) => a + r.total, 0), rec = rs.filter(r => r.status === 'received').reduce((a, r) => a + r.received, 0), ca = rs.reduce((a, r) => a + r.caCommission, 0), net = rs.reduce((a, r) => a + r.netRetention, 0);
      totals = ['Total', '', rs.length + ' refunds', claimed, '', rec, '', ca, net];
      kpis = [['Refunds', rs.length], ['Received', fC(rec)], ['CA commission', fC(ca)], ['Net retention', fC(net)]];
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
  /* ══ WhatsApp reminders — settings + the send log ═══════════════════════
     The RULES (who to chase, when, what to say) live in wa-core.js: pure and
     unit-tested. This is only storage, so the two can't drift.

     The log is the dedupe memory: wa-core refuses to re-send a key that is
     already in here, so a customer is never dunned twice for the same invoice
     at the same step. That makes it a RECORD, not a cache — it rides inside
     the per-company blob and syncs like everything else.

     NOTE ON SECRETS: no API token is ever stored here. This blob lives in the
     browser AND in the database, which is exactly where a provider credential
     must never be. When a provider is connected, its token goes in the
     server-side config only. */
  function waCfg() {
    S.WA = S.WA || {};
    S.WA.cfg = S.WA.cfg || {};
    const c = S.WA.cfg;
    if (!c.provider) c.provider = '';            // '' = not connected -> one-tap sending only
    if (!c.schedule) c.schedule = null;          // null = wa-core's default (-3,-1,0,3,7,15,30)
    if (!c.templates) c.templates = {};          // per-company overrides of the default wording
    return c;
  }
  function saveWaCfg(o) { Object.assign(waCfg(), o || {}); commit(); return waCfg(); }
  function waLogRows() { S.WA = S.WA || {}; return S.WA.log || (S.WA.log = []); }

  /* Record one send. `via` is how it physically left: 'tap' (the human pressed
     send in WhatsApp) or a provider id later. status starts 'sent'; a provider
     can later move it to delivered/read/failed via its webhook. With one-tap we
     genuinely CANNOT know if it was delivered — so we say 'sent', not 'delivered'. */
  function waRecord(t, via) {
    const rows = waLogRows();
    rows.push({
      id: 'wa' + idStamp(), ts: Date.now(), date: fmtISO(new Date()),
      key: t.key || '', party: t.party || '', phone: t.phone || '',
      kind: t.kind || 'reminder', step: t.step != null ? t.step : '', inv: t.inv || '',
      amount: +t.balance || +t.outstanding || 0, text: t.text || '',
      template: t.kind || '', attachments: t.attachments || [],
      status: 'sent', via: via || 'tap',
      user: (QL_PLANT && (QL_PLANT.user_name || QL_PLANT.owner_phone)) || ''
    });
    commit();
    return rows[rows.length - 1];
  }
  function waSetStatus(id, status) {
    const r = waLogRows().find(x => x.id === id);
    if (r) { r.status = status; commit(); }
    return r;
  }
  /* Keys already sent — a failed send is NOT a send, so it may be retried. */
  function waSentKeys() {
    return waLogRows().filter(r => r.status !== 'failed').map(r => r.key).filter(Boolean);
  }
  function waStats(day) {
    const d = day || fmtISO(new Date());
    const today = waLogRows().filter(r => r.date === d);
    const n = s => today.filter(r => r.status === s).length;
    return {
      sent: today.length, delivered: n('delivered'), read: n('read'),
      failed: n('failed'), pending: n('sent'), day: d
    };
  }

  window.QLD = {
    plant: QL_PLANT, COMPANIES,
    waCfg, saveWaCfg, waLogRows, waRecord, waSetStatus, waSentKeys, waStats,
    // All of the user's own firm names (sister companies) — recon uses these
    // to tell an inter-firm transfer from an unknown party.
    /* The CURRENT tenant's own plant names, for inter-firm transfer detection —
       NOT the hardcoded seller list, which handed every tenant Gotan + Deshwali and
       made a stranger's payment look like an internal transfer. */
    ownFirmNames: plants.map(pl => (pl.plant_name || '').trim().toUpperCase()).filter(Boolean),
    get activeCo() { return ACTIVE_CO; },
    fetchDocBlob,
    /* Shared, persisted UI period filter — ONE source of truth across every page
       that scopes numbers, scoped per company, kept in sessionStorage so a
       deliberate pick survives navigation + refresh (a multi-page app reloads on
       every page change). Returns null until first set.

       Holds a PERIOD, not only a month: 'YYYY-MM', 'YYYY' or 'all' (see
       inPeriod). The name is historical — renaming it would touch 30 call sites
       to buy nothing, but a reader must not assume the value matches /\d{4}-\d{2}/.
       'all' is stored explicitly: it is a deliberate pick like any other, and
       dropping it made the next page re-default to its latest month instead. */
    uiMonth() { try { return sessionStorage.getItem('ql_uimonth_' + ACTIVE_CO) || null; } catch (_) { return null; } },
    setUiMonth(ym) { try { if (ym) sessionStorage.setItem('ql_uimonth_' + ACTIVE_CO, ym); } catch (_) {} },
    get co() { return COMPANIES[ACTIVE_CO]; },
    updateCompany, addCompany, removeCompany, validGstinFmt,
    state: S,
    fmt, fC, fL, fDS, daysAgo, cS,
    kpis, monthSeries, collections, insights, production, productionPeriod, topProducts, activity,
    salesRows, salesSummary,
    purchaseRows, purchaseSummary, partyRows, partySummary,
    partyLedger, recordLedgerEntry, reverseLedgerEntry, ledgerNet,
    purchaseGroups: PURCHASE_GROUPS, departments: DEPARTMENTS, purchaseByGroup, purchaseInsights, itemShort, monthLabel,
    /* The period vocabulary every page shares with QLShell.monthPicker.
       rangeSpan turns ANY period — month, year, named range, custom — into the
       { from, to } that buildReport() already takes, which is what let reports
       drop its private copy of all this. */
    inPeriod, periodLabel, rangeSpan, rangeKeys: () => RANGE_KEYS.slice(), rangeLabel: k => RANGE_LABEL[k] || k,
    recordPurchasePayment, billInsights, relatedBills, itemIcon,
    // ── Payments Center (one unified money ledger) ──
    paymentsLedger, paymentsSummary, paymentsInsights, accountBalances,
    receiveSalesPayment, payPurchaseBill, addLedgerPayment, addTransfer, payLoanEmi, deleteLedgerEntry,
    paymentMethods: PAY_METHODS, paymentTypes: PAY_TYPES, methodToMode,
    labourRows, labourSummary, cashbookRows, cashbookBalances,
    loanRows, loanSummary, gstSummary,
    getPL, chunnaRows, chunnaSummary, attendanceData,
    productionRows, prodStats, addProduction, updateProduction, deleteProduction,
    productionDerived, derivedQtyGaps, tonnesOf, countOf,
    refundRows, refundSummary, addRefund, updateRefund, deleteRefund, refundJournal,
    // ── Soft-delete / Trash / Archive / Audit (recoverable deletion) ──
    softDelete, restoreRecord, purgeRecord, voidRecord, archiveRecord, archiveRows, archiveCount, trashRows, trashCount, auditRows, logAudit, backupJSON, trashModules: () => Object.keys(TRASHABLE),
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

    // ── Bank accounts (multi-bank) ──
    BANK_TYPES, bankAccounts, bankAccountById, bankAccountLabel,
    addBankAccount, updateBankAccount, setBankAccountArchived,
    addStatement, statementRows, lastStatement, removeStatement, statementConflict,

    // ── Writes (persist local immediately + cloud debounced) ──
    commit, saveLocal, wipeData, syncState,
    upsertParty, deleteParty,
    addSale, updateSale, deleteSale, setSaleStatus,
    addPurchase, updatePurchase, deletePurchase, setPurchaseStatus, importGenericBill,
    attachDoc, getDoc,
    addFreightPayment, deleteFreightPayment, updateFreightNote,
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

/* build: prod-module 2026-07-11 */

/* build: trash-audit 1783845386 */

/* build: void-protect 1783929898 */

/* build: archive-perms 1783930681 */

/* build: reports-fix 1783933534 */

/* build: pullcloud-guard 1783938945 */

/* build: refunds 1783950533 */

/* build m16: toISODate normalises bill dates at every entry point (fixes Dec purchases stored as "10-Dec-25" → never grouped into a month) */

/* build m17: BANK_ACCOUNTS store (multi-bank Phase 1) */

/* build m19: payments carry accountId (multi-bank Phase 5) */

/* build m20: addFreightPayment/deleteFreightPayment + freightPays landed-cost derivation */

/* build m21: #auth handoff always wins + ql_cache_owner identity guard (session isolation) */

/* WHY the bill would not open. This used to be `catch (_) { toast('Could not open
   the uploaded bill') }` — the browser told us exactly what went wrong and we threw
   it away, leaving a message that helps nobody: not the owner, who cannot act on
   it, and not me, who then has to guess. Each of these has a completely different
   fix, and the user can only take the right one if we say which. */
window.QLAttachWhy = function (e) {
  const n = (e && e.name) || '';
  if (n === 'DataError') return 'this attachment has no file id saved — the bill was booked without its scan';
  if (n === 'NotFoundError') return 'the attachment store is missing in this browser';
  if (n === 'QuotaExceededError') return 'this browser is out of storage';
  if (n === 'InvalidStateError' || n === 'SecurityError') return 'this browser blocks local file storage (private/incognito mode?)';
  if (n === 'VersionError') return 'the local file store is from a newer version — close other QuickLimes tabs and retry';
  return (e && (e.message || e.name)) || 'unknown error';
};

