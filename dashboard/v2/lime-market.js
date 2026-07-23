/* ═══════════════════════════════════════════════════════════════════════════
   lime-market.js — the market-intelligence brain for a lime seller.

   Answers the sales-manager questions the search box cannot: which INDUSTRIES
   burn the most lime, which STATES hold the most of them, and — because lime is
   a low-value/high-volume commodity where freight decides everything — which of
   those markets are actually PROFITABLE to serve from a Rajasthan plant.

   ── HONESTY, up front ──
   The consumption bands and demand scores here are CURATED INDUSTRY KNOWLEDGE —
   rules of thumb, not figures scraped per company. They are the PRIOR. The TRUTH
   is the user's own invoices: icp-core.js already learns real margin per
   industry from them, so this engine is meant to be calibrated against that, not
   trusted as fact. Every estimate is labelled `est`. Nothing here is a
   per-company number — that would need a paid data provider (see the notes to
   the user). Freight is a transparent model (distance × a rate you set), not a
   quote.

   Pure: no DOM, no network. Browser (window.LimeMarket) + Node, so the ranking
   that decides where the user spends diesel and phone time is unit-tested.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* Freight origin. Default is Borunda (Jodhpur dist., Rajasthan) — the user's
     plant — but it is a PARAMETER everywhere, never baked in, so it can be moved
     from a setting without touching this file. */
  var DEFAULT_ORIGIN = { name: 'Borunda, Rajasthan', lat: 26.35, lon: 73.55 };
  var DEFAULT_FREIGHT = 4;      // ₹ per tonne per road-km — an estimate the user sets
  /* Ex-works price per tonne — ESTIMATES the user must set to their real prices.
     They drive the profitability figures; the relative ranking is robust to being
     a bit off, but the rupee numbers are only as true as these. */
  var DEFAULT_EXWORKS = { quick: 8000, hydrated: 9000, powder: 6000 };
  var ROAD_FACTOR = 1.3;        // straight-line → road distance, rough
  var VIABLE_KM = 1600;         // beyond this, freight on a commodity usually kills the margin

  /* ── Industries, ranked by how much lime they burn ──
     use        : what the lime is FOR (so a rep can talk to the plant)
     consumption: an ESTIMATE band per typical plant, not a company figure
     frequency  : how the buying recurs
     roles      : who signs the PO (titles to ask for — not names; names need paid data)
     demand     : 1–5, relative lime pull of the industry
     products   : which of the seller's products this industry buys           */
  var INDUSTRIES = [
    { key: 'steel',     label: 'Steel Plants',              use: 'Slag flux, dephosphorisation & desulphurisation in the furnace', consumption: 'Very high (est. 40–60 kg lime / tonne steel)', frequency: 'Continuous, monthly contracts', roles: ['Purchase / Procurement Head', 'Raw Material Manager'], demand: 5, products: ['quick'] },
    { key: 'sponge',    label: 'Sponge Iron (DRI) Plants',  use: 'Sulphur control in the kiln / gas cleaning', consumption: 'High (est.)', frequency: 'Continuous', roles: ['Purchase Manager', 'Plant Head'], demand: 4, products: ['quick'] },
    { key: 'ferro',     label: 'Ferro Alloy Plants',        use: 'Slag flux in the submerged-arc furnace', consumption: 'High (est.)', frequency: 'Continuous', roles: ['Purchase Manager'], demand: 4, products: ['quick'] },
    { key: 'sugar',     label: 'Sugar Mills',               use: 'Juice clarification (defecation / carbonatation) — lime is essential', consumption: 'High, seasonal (est.)', frequency: 'Crushing season (Oct–Apr), heavy', roles: ['Chief Chemist', 'Purchase Officer', 'General Manager'], demand: 5, products: ['quick', 'hydrated'] },
    { key: 'paper',     label: 'Paper & Pulp Mills',        use: 'Causticising to recover NaOH; bleaching', consumption: 'Very high (est.)', frequency: 'Continuous', roles: ['Purchase Head', 'Chemical Recovery Manager'], demand: 5, products: ['quick', 'hydrated'] },
    { key: 'aac',       label: 'AAC Block Manufacturers',   use: 'Raw material with fly-ash, cement & sand', consumption: 'Medium–high (est.)', frequency: 'Continuous', roles: ['Purchase Manager', 'Owner / Director'], demand: 4, products: ['quick', 'powder'] },
    { key: 'aluminium', label: 'Aluminium / Alumina Refineries', use: 'Causticisation & desilication in the Bayer process', consumption: 'Very high (est.)', frequency: 'Continuous', roles: ['Procurement Head', 'Materials Manager'], demand: 5, products: ['quick'] },
    { key: 'zinc',      label: 'Zinc / Lead Smelters',      use: 'pH control, iron removal, jarosite/effluent', consumption: 'High (est.)', frequency: 'Continuous', roles: ['Procurement Head'], demand: 4, products: ['quick', 'hydrated'] },
    { key: 'copper',    label: 'Copper Smelters',           use: 'Flux and effluent neutralisation', consumption: 'Medium–high (est.)', frequency: 'Continuous', roles: ['Procurement Head'], demand: 3, products: ['quick', 'hydrated'] },
    { key: 'chemical',  label: 'Chemical Industries',       use: 'Calcium carbide, PCC, bleaching powder, many syntheses', consumption: 'High, varies (est.)', frequency: 'Continuous', roles: ['Purchase Manager', 'Plant Head'], demand: 5, products: ['quick', 'hydrated'] },
    { key: 'mining',    label: 'Mining Companies',          use: 'Ore beneficiation, pH control, tailings & AMD', consumption: 'Medium–high (est.)', frequency: 'Continuous', roles: ['Purchase Manager', 'Mine Manager'], demand: 3, products: ['quick', 'hydrated'] },
    { key: 'water',     label: 'Water Treatment Plants',    use: 'Softening and pH correction', consumption: 'Medium (est.)', frequency: 'Continuous', roles: ['Plant In-charge', 'Municipal / Purchase Officer'], demand: 3, products: ['hydrated'] },
    { key: 'etp',       label: 'Effluent Treatment Plants', use: 'Acid neutralisation & precipitation', consumption: 'Medium (est.)', frequency: 'Continuous', roles: ['EHS Manager', 'Plant In-charge'], demand: 3, products: ['hydrated'] },
    { key: 'glass',     label: 'Glass Manufacturers',       use: 'Batch material (lime / limestone)', consumption: 'Medium (est.)', frequency: 'Continuous', roles: ['Purchase Manager'], demand: 3, products: ['quick', 'powder'] },
    { key: 'construction', label: 'Construction Material Mfrs', use: 'Blocks, plasters, stabilised soil, mortars', consumption: 'Medium (est.)', frequency: 'Ongoing', roles: ['Owner', 'Purchase Manager'], demand: 3, products: ['hydrated', 'powder'] },
    { key: 'fertilizer', label: 'Fertilizer Plants',        use: 'Process reagent & soil-conditioner grade', consumption: 'Medium (est.)', frequency: 'Ongoing / seasonal', roles: ['Procurement Head'], demand: 3, products: ['quick', 'powder'] },
    { key: 'textile',   label: 'Textile Processing Units',  use: 'Mercerising and effluent neutralisation', consumption: 'Low–medium (est.)', frequency: 'Continuous', roles: ['Purchase Manager', 'ETP In-charge'], demand: 2, products: ['hydrated'] },
    { key: 'waste',     label: 'Industrial Waste Treatment', use: 'pH stabilisation & solidification', consumption: 'Medium (est.)', frequency: 'Ongoing', roles: ['Operations Manager'], demand: 2, products: ['hydrated', 'quick'] },
    { key: 'cement',    label: 'Cement Plants',             use: 'Rarely buy — they PRODUCE lime-family materials; only niche uses', consumption: 'Low (usually not a buyer)', frequency: 'Rare', roles: ['Purchase Manager'], demand: 1, products: [] }
  ];

  /* ── States, with a rough centroid and which target industries cluster there.
     `stars` (1–5) is the concentration of lime-buying industry, from general
     industrial geography. Centroids drive the freight model. ── */
  /* `hubs` = the industrial cities where a state's plants actually cluster. This
     is not decoration: a whole-STATE search on the free Overpass service is the
     heaviest possible query and times out, whereas a CITY search returns in
     under a second. So discovery fans out across a state's hubs instead of
     hitting the state area — faster, and better targeted (a rep works clusters,
     not "the whole state"). Ordered most-industrial first. */
  var STATES = [
    { name: 'Gujarat',        lat: 22.66, lon: 71.19, stars: 5, industries: ['chemical', 'paper', 'water', 'etp', 'aluminium', 'textile', 'zinc'], hubs: ['Ankleshwar', 'Vadodara', 'Ahmedabad', 'Surat'] },
    { name: 'Maharashtra',    lat: 19.75, lon: 75.71, stars: 5, industries: ['sugar', 'paper', 'chemical', 'steel', 'textile'], hubs: ['Pune', 'Nagpur', 'Kolhapur', 'Aurangabad'] },
    { name: 'Chhattisgarh',   lat: 21.28, lon: 81.87, stars: 5, industries: ['steel', 'sponge', 'ferro', 'aluminium', 'mining'], hubs: ['Raipur', 'Bhilai', 'Raigarh', 'Korba'] },
    { name: 'Odisha',         lat: 20.95, lon: 85.10, stars: 5, industries: ['steel', 'sponge', 'aluminium', 'ferro', 'mining'], hubs: ['Rourkela', 'Angul', 'Jharsuguda', 'Cuttack'] },
    { name: 'Tamil Nadu',     lat: 11.13, lon: 78.66, stars: 5, industries: ['paper', 'sugar', 'textile', 'chemical', 'steel'], hubs: ['Coimbatore', 'Chennai', 'Karur', 'Salem'] },
    { name: 'Karnataka',      lat: 15.32, lon: 75.71, stars: 4, industries: ['steel', 'sugar', 'aac', 'chemical'], hubs: ['Ballari', 'Hospet', 'Bengaluru', 'Belgaum'] },
    { name: 'Uttar Pradesh',  lat: 26.85, lon: 80.95, stars: 4, industries: ['sugar', 'paper', 'chemical'], hubs: ['Kanpur', 'Muzaffarnagar', 'Meerut', 'Moradabad'] },
    { name: 'Andhra Pradesh', lat: 15.91, lon: 79.74, stars: 4, industries: ['steel', 'sugar', 'chemical', 'aac'], hubs: ['Visakhapatnam', 'Vijayawada', 'Nellore'] },
    { name: 'Telangana',      lat: 17.85, lon: 79.11, stars: 4, industries: ['steel', 'chemical', 'aac'], hubs: ['Hyderabad', 'Sangareddy', 'Bodhan'] },
    { name: 'Jharkhand',      lat: 23.61, lon: 85.28, stars: 4, industries: ['steel', 'sponge', 'mining', 'ferro'], hubs: ['Jamshedpur', 'Bokaro', 'Ranchi', 'Dhanbad'] },
    { name: 'West Bengal',    lat: 22.99, lon: 87.86, stars: 3, industries: ['steel', 'sponge', 'paper'], hubs: ['Durgapur', 'Asansol', 'Kolkata', 'Haldia'] },
    { name: 'Madhya Pradesh', lat: 23.47, lon: 77.95, stars: 3, industries: ['sponge', 'chemical', 'paper'], hubs: ['Indore', 'Pithampur', 'Jabalpur', 'Bhopal'] },
    { name: 'Punjab',         lat: 31.15, lon: 75.34, stars: 3, industries: ['paper', 'sugar', 'textile'], hubs: ['Ludhiana', 'Rajpura', 'Amritsar', 'Jalandhar'] },
    { name: 'Haryana',        lat: 29.06, lon: 76.09, stars: 3, industries: ['paper', 'steel', 'textile'], hubs: ['Hisar', 'Yamunanagar', 'Faridabad', 'Panipat'] },
    { name: 'Rajasthan',      lat: 27.02, lon: 74.22, stars: 4, industries: ['zinc', 'chemical', 'textile', 'aac'], hubs: ['Bhilwara', 'Kota', 'Bhiwadi', 'Udaipur'] }
  ];

  var PRODUCTS = [
    { key: 'quick',    label: 'Quick Lime (CaO)' },
    { key: 'hydrated', label: 'Hydrated Lime (Ca(OH)₂)' },
    { key: 'powder',   label: 'Lime Powder' }
  ];

  function toRad(d) { return d * Math.PI / 180; }
  function haversine(a, b) {
    var R = 6371, dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  /* road distance ≈ straight-line × a factor, rounded to something honest-looking */
  function roadKm(origin, place) { return Math.round(haversine(origin, place) * ROAD_FACTOR); }

  function transportTier(km) {
    if (km <= 400) return { tier: 'near', label: 'Near' };
    if (km <= 900) return { tier: 'regional', label: 'Regional' };
    if (km <= 1400) return { tier: 'far', label: 'Far' };
    return { tier: 'veryfar', label: 'Very far' };
  }
  /* Freight feasibility 0..1: 1 at the doorstep, ~0 past VIABLE_KM. This is what
     stops a high-demand-but-1500km state from topping the list on demand alone. */
  function feasibility(km) { return Math.max(0.05, 1 - km / VIABLE_KM); }

  /* The word to search on the map for each industry — used to bridge the
     targeting plan into the actual company discovery (OSM name-regex). */
  var OSM_TERM = {
    steel: 'steel', sponge: 'sponge iron', ferro: 'ferro alloy', sugar: 'sugar mill',
    paper: 'paper mill', aac: 'AAC', aluminium: 'aluminium', zinc: 'zinc', copper: 'copper',
    chemical: 'chemical', mining: 'mining', water: 'water treatment', etp: 'effluent treatment',
    glass: 'glass', construction: 'builder', fertilizer: 'fertilizer', textile: 'textile',
    waste: 'waste treatment', cement: 'cement'
  };
  function osmTerm(key) { return OSM_TERM[key] || key; }

  function industry(key) { for (var i = 0; i < INDUSTRIES.length; i++) if (INDUSTRIES[i].key === key) return INDUSTRIES[i]; return null; }

  /* Is this place-name one of our known states? (case-insensitive) */
  function stateByName(name) {
    var n = String(name || '').trim().toLowerCase();
    for (var i = 0; i < STATES.length; i++) if (STATES[i].name.toLowerCase() === n) return STATES[i];
    return null;
  }
  /* The industrial hub cities to actually search for a state (max n). Whole-state
     Overpass queries time out; these do not. */
  function hubsFor(name, n) {
    var s = stateByName(name);
    return s && s.hubs ? s.hubs.slice(0, n || 3) : [];
  }

  /* Industries relevant to a product, best-demand first. */
  function industriesForProduct(product) {
    return INDUSTRIES.filter(function (i) { return i.demand > 1 && (!product || i.products.indexOf(product) >= 0); })
      .slice().sort(function (a, b) { return b.demand - a.demand; });
  }

  /* Profitability tier from how much of your ex-works PRICE the freight eats.
     Lime is low-value/high-volume, so this ratio — not distance alone — is what
     decides whether a market pays. Maps to the user's Hot/Warm/Cold idea. */
  function profitTier(freightShare) {
    if (freightShare <= 0.25) return { key: 'strong', label: 'Strong margin' };
    if (freightShare <= 0.50) return { key: 'workable', label: 'Workable' };
    if (freightShare <= 0.80) return { key: 'thin', label: 'Thin margin' };
    return { key: 'unviable', label: 'Freight too high' };
  }

  /* Opportunity of one state for one product, from THIS origin at THIS rate.
     If an ex-works price is given (opts.exWorks), the score becomes PRICE-AWARE:
     reachability is driven by freight as a share of the price, and the rupee
     figures (delivered cost, freight share, profit tier) come back too. Without a
     price it falls back to the distance-only model (unchanged), so older callers
     and tests behave exactly as before. */
  function stateOpportunity(state, product, opts) {
    opts = opts || {};
    var origin = opts.origin || DEFAULT_ORIGIN;
    var rate = opts.freightRate != null ? opts.freightRate : DEFAULT_FREIGHT;
    var exWorks = +opts.exWorks || 0;
    var km = roadKm(origin, state);
    var freight = Math.round(km * rate);
    // demand = the lime pull of the RELEVANT industries present, tempered by how
    // concentrated the state is (stars). Normalised to 0..1.
    var rel = state.industries.map(industry).filter(Boolean)
      .filter(function (i) { return !product || i.products.indexOf(product) >= 0; });
    var pull = rel.reduce(function (a, i) { return a + i.demand; }, 0);
    var demand = Math.min(1, (pull / 25) * 0.6 + (state.stars / 5) * 0.4);

    // Reachability: freight-share when we know the price (more honest than a
    // fixed km cutoff), else the distance heuristic.
    var freightShare = exWorks > 0 ? freight / exWorks : null;
    var feas = exWorks > 0 ? Math.max(0.05, Math.min(1, 1 - freightShare)) : feasibility(km);

    // score = demand AND reachability. A market you can't afford to reach is not
    // an opportunity however much lime it burns.
    var score = Math.round(demand * feas * 100);
    var out = {
      state: state.name, km: km, tier: transportTier(km),
      freightPerTonne: freight,
      feasibility: Math.round(feas * 100) / 100,
      demand: Math.round(demand * 100),
      score: score,
      industries: rel.map(function (i) { return { key: i.key, label: i.label, demand: i.demand }; })
    };
    if (exWorks > 0) {
      out.exWorks = exWorks;
      out.deliveredPerTonne = exWorks + freight;
      out.freightSharePct = Math.round(freightShare * 100);
      out.profit = profitTier(freightShare);
    }
    return out;
  }

  /* The national targeting plan for a product: every state scored and ranked. */
  function plan(product, opts) {
    return STATES.map(function (s) { return stateOpportunity(s, product, opts); })
      .filter(function (r) { return r.industries.length; })
      .sort(function (a, b) { return b.score - a.score; });
  }

  root.LimeMarket = {
    INDUSTRIES: INDUSTRIES, STATES: STATES, PRODUCTS: PRODUCTS,
    DEFAULT_ORIGIN: DEFAULT_ORIGIN, DEFAULT_FREIGHT: DEFAULT_FREIGHT, DEFAULT_EXWORKS: DEFAULT_EXWORKS, VIABLE_KM: VIABLE_KM,
    roadKm: roadKm, transportTier: transportTier, feasibility: feasibility, osmTerm: osmTerm, profitTier: profitTier,
    industry: industry, stateByName: stateByName, hubsFor: hubsFor,
    industriesForProduct: industriesForProduct,
    stateOpportunity: stateOpportunity, plan: plan
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LimeMarket;
})(typeof window !== 'undefined' ? window : globalThis);
