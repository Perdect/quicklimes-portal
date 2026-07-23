/* ═══════════════════════════════════════════════════════════════════════════
   FREIGHT CALCULATOR — page logic. Pure math lives in freight-core.js; distance
   & geocoding go through /api/freight (Google when a key is set) with a free
   in-browser fallback (Nominatim + lime-market road-km estimate). Freight
   history is kept on this device for now (server sync is Phase 2).
   ─────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  var FC = window.FreightCore, LM = window.LimeMarket, WA = window.WA;
  var Q = window.QLD;

  /* Plants. One today (Borunda / Deshwali Minerals); array so adding more later
     is a data change, not a code change. lat/lon drive the estimate + best-plant. */
  var PLANTS = [
    { key: 'borunda', name: 'Borunda (Deshwali Minerals), Rajasthan', short: 'Borunda', lat: 26.35, lon: 73.55 }
  ];

  var state = {
    plant: 'borunda',           // plant key or 'auto'
    dest: null,                 // { lat, lon, city, state, pin, formatted }
    km: 0, kmSource: 'est', minutes: 0,
    google: false               // does the backend have a Google key?
  };

  var $ = function (id) { return document.getElementById(id); };
  var fmt0 = function (n) { return '₹' + Math.round(+n || 0).toLocaleString('en-IN'); };
  var HIST_KEY = function () { return 'ql_freight_hist_' + (Q && Q.activeCo != null ? Q.activeCo : '0'); };

  /* ── API ── */
  async function api(body) {
    try {
      var p = JSON.parse(localStorage.getItem('ql_plant') || '{}');
      var auth = { plant_id: p.id, company_id: (Q ? Q.activeCo : undefined), token: p.token };
      var res = await fetch('/api/freight', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign(auth, body))
      });
      var txt = await res.text();
      try { return JSON.parse(txt); } catch (_) { return { ok: false, error: 'bad_response' }; }
    } catch (e) { return { ok: false, error: 'offline' }; }
  }

  /* Free geocode fallback (browser, no key) — same source Lead Discovery uses. */
  async function nominatim(q) {
    try {
      var r = await fetch('https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&countrycodes=in&q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } });
      var j = await r.json();
      if (j && j[0] && j[0].lat) {
        var a = j[0].address || {};
        return {
          lat: +j[0].lat, lon: +j[0].lon,
          city: a.city || a.town || a.village || a.county || '',
          state: a.state || '', pin: a.postcode || '',
          formatted: j[0].display_name || q, source: 'est'
        };
      }
    } catch (_) {}
    return null;
  }

  function activePlant() {
    if (state.plant === 'auto') return PLANTS[0];   // one plant → auto = it
    return PLANTS.find(function (p) { return p.key === state.plant; }) || PLANTS[0];
  }

  /* ── Populate selects/pills ── */
  function buildPlants() {
    var host = $('frPlants'); host.innerHTML = '';
    PLANTS.forEach(function (p) { host.appendChild(pill(p.key, p.short, state.plant === p.key)); });
    if (PLANTS.length > 1) host.appendChild(pill('auto', '✦ Auto — best plant', state.plant === 'auto'));
    var pb = $('frPlantBadge'); if (pb) pb.textContent = '▲ ' + activePlant().name;   // hero badge — absent when embedded in Lead Discovery
    var ph = $('frPlantHint'); if (ph) ph.textContent = PLANTS.length > 1
      ? 'Auto compares every plant and picks the cheapest delivered.'
      : 'Freight is measured from your Borunda plant. Add more plants later to compare.';
  }
  function pill(val, label, on) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'fr-pill' + (on ? ' on' : '');
    b.innerHTML = '<span class="dot"></span>' + label;
    b.addEventListener('click', function () { state.plant = val; buildPlants(); recompute(); });
    return b;
  }

  function buildSelects() {
    var pr = $('frProduct'); pr.innerHTML = FC.PRODUCTS.map(function (p) { return '<option value="' + p.key + '">' + p.label + '</option>'; }).join('');
    $('frPack').innerHTML = FC.PACKAGING.map(function (p) { return '<option value="' + p.key + '">' + p.label + '</option>'; }).join('');
    $('frVehicle').innerHTML = FC.VEHICLES.map(function (v) { return '<option value="' + v.key + '">' + v.label + '</option>'; }).join('');
    $('frMethod').innerHTML = FC.FREIGHT_METHODS.map(function (m) { return '<option value="' + m.key + '">' + m.label + '</option>'; }).join('');
    syncExworks();
  }
  function currentProduct() { return FC.PRODUCTS.find(function (p) { return p.key === $('frProduct').value; }) || FC.PRODUCTS[0]; }
  function syncExworks() { $('frExworks').value = currentProduct().exworks; }

  var METHOD_META = {
    per_ton_km: { label: 'Rate (₹/MT/km)', hint: 'Freight = rate × distance × quantity. The most common lime freight basis.' },
    per_ton:    { label: 'Rate (₹/MT)', hint: 'A flat rate per tonne, whatever the distance.' },
    per_km:     { label: 'Rate (₹/km)', hint: 'Per-vehicle: rate × distance, multiplied by the number of trucks.' },
    per_truck:  { label: 'Price per truck (₹)', hint: 'A fixed price per vehicle, multiplied by the number of trucks.' },
    fixed:      { label: 'Fixed price (₹)', hint: 'One price for the whole load to this destination, distance ignored.' },
    manual:     { label: 'Freight (₹ total)', hint: 'Type the whole-load freight; or use Manual override below for full transporter details.' }
  };
  function syncMethod() {
    var m = $('frMethod').value, meta = METHOD_META[m] || METHOD_META.per_ton_km;
    $('frRateLabel').textContent = meta.label; $('frMethodHint').textContent = meta.hint;
    // sensible default rate per method
    var def = { per_ton_km: LM ? LM.DEFAULT_FREIGHT : 4, per_ton: 2500, per_km: 90, per_truck: 120000, fixed: 100000, manual: 50000 }[m];
    if (!$('frRate').value || $('frRate').dataset.method !== m) { $('frRate').value = def; $('frRate').dataset.method = m; }
  }

  function buildCharges() {
    var labels = { loading: 'Loading', unloading: 'Unloading', toll: 'Toll', borderTax: 'Border tax', diesel: 'Diesel adj.', labour: 'Labour', waiting: 'Waiting', night: 'Night', permit: 'Permit', insurance: 'Insurance', fuelSurcharge: 'Fuel surcharge', misc: 'Misc.' };
    $('frCharges').innerHTML = FC.CHARGE_KEYS.map(function (k) {
      return '<div class="fr-f"><label for="fc_' + k + '">' + labels[k] + '</label><input id="fc_' + k + '" data-charge="' + k + '" type="number" min="0" step="100" placeholder="0"></div>';
    }).join('');
    $('frCharges').querySelectorAll('input').forEach(function (i) { i.addEventListener('input', recompute); });
  }
  function readCharges() {
    var c = {}; $('frCharges').querySelectorAll('input[data-charge]').forEach(function (i) { c[i.dataset.charge] = +i.value || 0; });
    return c;
  }

  /* ── Locate the customer ── */
  async function locate() {
    var q = ($('frAddr').value || '').trim();
    if (!q) { flash($('frLocate'), 'Enter an address'); return; }
    var btn = $('frLocate'); btn.disabled = true; var old = btn.textContent; btn.textContent = 'Locating…';
    var g = null;
    if (state.google) { var r = await api({ action: 'geocode', q: q }); if (r && r.ok) g = { lat: +r.lat, lon: +r.lng, city: r.city, state: r.state, pin: r.pin, formatted: r.formatted, source: 'google' }; }
    if (!g) g = await nominatim(q);
    btn.disabled = false; btn.textContent = old;
    if (!g) { flash(btn, 'Not found'); return; }
    state.dest = g;
    if (g.city) $('frCity').value = g.city;
    if (g.state) $('frState').value = g.state;
    if (g.pin) $('frPin').value = g.pin;
    await measure();
  }

  /* Distance from the active plant to the destination. */
  async function measure() {
    if (!state.dest) return;
    var p = activePlant();
    var km = 0, src = 'est', mins = 0;
    if (state.google) {
      var r = await api({ action: 'distance', oLat: p.lat, oLng: p.lon, dLat: state.dest.lat, dLng: state.dest.lon });
      if (r && r.ok) { km = r.km; mins = r.minutes || 0; src = 'google'; }
    }
    if (!km && LM) { km = LM.roadKm({ lat: p.lat, lon: p.lon }, { lat: state.dest.lat, lon: state.dest.lon }); src = 'est'; }
    state.km = km; state.kmSource = src; state.minutes = mins;
    var d = $('frDetect'); d.classList.add('show');
    d.innerHTML = '<b>' + (state.dest.formatted || 'Location') + '</b><br>'
      + (state.dest.city ? state.dest.city + ', ' : '') + (state.dest.state || '') + (state.dest.pin ? ' · ' + state.dest.pin : '')
      + ' · <b>' + km.toLocaleString('en-IN') + ' km</b> from ' + p.short
      + '<span class="fr-src ' + (src === 'google' ? 'google' : 'est') + '">' + (src === 'google' ? 'Google' : 'estimate') + '</span>';
    recompute();
    predict();
  }

  /* ── The calculation + render ── */
  function recompute() {
    var prod = currentProduct();
    var qty = +$('frQty').value || 0;
    var cap = (FC.VEHICLES.find(function (v) { return v.key === $('frVehicle').value; }) || {}).cap || 25;
    var method = $('frMethod').value;
    var rate = +$('frRate').value || 0;
    var pack = (FC.PACKAGING.find(function (p) { return p.key === $('frPack').value; }) || {}).addPerMt || 0;
    var exworks = +$('frExworks').value || 0;

    // vehicle recommendation
    var rec = FC.recommendVehicle(qty);
    $('frVehRec').textContent = qty > 0 ? (rec.vehicle.label + (rec.trips > 1 ? ' × ' + rec.trips + ' trips' : '') + ' · ' + Math.round(rec.fill * 100) + '% full') : '—';

    // manual override?
    var manFreight = +$('frManFreight').value || 0;
    var f;
    if (manFreight > 0) {
      f = FC.freight('manual', { qtyMt: qty, value: manFreight });
      f.overridden = true;
    } else {
      f = FC.freight(method, { qtyMt: qty, km: state.km, cap: cap, value: rate });
    }

    var charges = readCharges();
    var addTotal = FC.additionalTotal(charges);
    var sum = addTotal > 0 ? '· ' + fmt0(addTotal) : '';
    $('frChargesSum').textContent = sum;

    var d = FC.delivered({
      qtyMt: qty, exworksPerMt: exworks, packagingAddPerMt: pack,
      freightPerMt: f.freightPerMt, additionalTotal: addTotal, gstRate: prod.gst
    });

    // transit days
    var manDays = +$('frManDays').value || 0;
    var days = manDays > 0 ? manDays : FC.transitDays(state.km);

    // headline metrics
    $('frKm').textContent = state.km ? state.km.toLocaleString('en-IN') + ' km' : '—';
    $('frKmSrc').innerHTML = state.km ? (state.kmSource === 'google' ? 'Google driving distance' : 'road-km estimate') : 'locate a destination';
    $('frDays').textContent = days ? days + (days === 1 ? ' day' : ' days') : '—';
    $('frFreightMt').textContent = qty > 0 && state.km ? fmt0(f.freightPerMt) : '—';
    $('frTrucks').textContent = f.trucks ? f.trucks + (f.trucks === 1 ? ' truck' : ' trucks') + (f.overridden ? ' · manual' : '') : (f.overridden ? 'manual' : '');
    $('frFreightTotal').textContent = state.km || f.overridden ? fmt0(f.totalFreight) : '—';
    $('frFreightNote').textContent = f.overridden ? 'negotiated' : (state.km ? '' : '');

    var ready = qty > 0 && exworks > 0 && (state.km > 0 || f.overridden);
    $('frEmpty').style.display = ready ? 'none' : 'block';
    $('frBreakdown').style.display = ready ? 'block' : 'none';
    if (!ready) return;

    // breakdown
    $('frBdMaterial').textContent = fmt0(d.materialPerMt) + ' /MT';
    $('frBdFreight').textContent = fmt0(d.freightPerMt) + ' /MT';
    $('frBdAddLine').style.display = addTotal > 0 ? 'flex' : 'none';
    $('frBdAdd').textContent = fmt0(d.additionalPerMt) + ' /MT';
    $('frBdGstLbl').textContent = 'GST (' + Math.round(prod.gst * 100) + '%)';
    $('frBdGst').textContent = fmt0(d.gstPerMt) + ' /MT';
    $('frBdDelivered').textContent = fmt0(d.deliveredPerMt) + ' /MT';
    $('frGrand').innerHTML = 'Order total for <b>' + qty + ' MT</b>: <b>' + fmt0(d.grandTotal) + '</b> (incl. GST)';

    // margin verdict
    var mv = FC.marginVerdict(d.freightPerMt, d.materialPerMt);
    var vEl = $('frVerdict');
    if (mv.key && mv.key !== 'unknown') {
      vEl.style.display = 'flex'; vEl.className = 'fr-verdict ' + mv.key;
      vEl.innerHTML = '<b>' + mv.label + '</b> — freight is ' + mv.sharePct + '% of your ex-works price.';
    } else vEl.style.display = 'none';

    renderCompare(qty, exworks, rate, method, cap);
    state._last = { d: d, f: f, days: days, prod: prod, qty: qty };
  }

  function renderCompare(qty, exworks, rate, method, cap) {
    var host = $('frPlantsCompare');
    if (PLANTS.length < 2 || !state.dest) { host.innerHTML = ''; return; }
    var res = FC.bestPlant(PLANTS.map(function (p) { return { name: p.short, lat: p.lat, lon: p.lon, exworksPerMt: exworks }; }),
      { lat: state.dest.lat, lon: state.dest.lon },
      { method: method, rate: rate, qtyMt: qty, exworksPerMt: exworks, cap: cap, distanceFn: function (p, dd) { return LM ? LM.roadKm({ lat: p.lat, lon: p.lon }, { lat: dd.lat, lon: dd.lon }) : 0; } });
    host.innerHTML = '<div class="fr-sec-t" style="margin:6px 0 4px">Best plant</div>' + res.rows.map(function (r, i) {
      return '<div class="fr-plant-row' + (i === 0 ? ' best' : '') + '"><div><div class="pn">' + (i === 0 ? '✅ ' : '') + r.plant.name + '</div><div class="pd">' + r.km + ' km · ' + r.transitDays + ' days</div></div><div class="pv">' + fmt0(r.deliveredPerMt) + '/MT</div></div>';
    }).join('') + (res.savingsPerMt > 0 ? '<div class="fr-hint" style="margin-top:8px">Save <b>' + fmt0(res.savingsPerMt) + '/MT</b> (' + fmt0(res.savingsTotal) + ' on this order) vs the next plant.</div>' : '');
  }

  /* ── Quotation text ── */
  function quoteText() {
    var L = state._last; if (!L) return '';
    var co = (Q && Q.co) || {};
    var p = activePlant();
    var lines = [];
    lines.push('*' + (co.short || 'QuickLimes') + '* — Freight Quotation');
    if ($('frCompany').value || $('frCustName').value) lines.push('To: ' + [$('frCompany').value, $('frCustName').value].filter(Boolean).join(' · '));
    lines.push('');
    lines.push('Product: ' + L.prod.label);
    lines.push('Quantity: ' + L.qty + ' MT' + (L.f.trucks ? ' (' + L.f.trucks + ' × ' + ($('frVehicle').selectedOptions[0] || {}).text + ')' : ''));
    lines.push('From: ' + p.short + '  →  ' + [$('frCity').value, $('frState').value].filter(Boolean).join(', '));
    if (state.km) lines.push('Distance: ' + state.km.toLocaleString('en-IN') + ' km' + (state.kmSource === 'google' ? '' : ' (est.)') + ' · Transit ~' + L.days + ' day(s)');
    lines.push('');
    lines.push('Material: ' + fmt0(L.d.materialPerMt) + '/MT');
    lines.push('Freight: ' + fmt0(L.d.freightPerMt) + '/MT');
    if (L.d.additionalPerMt > 0) lines.push('Other charges: ' + fmt0(L.d.additionalPerMt) + '/MT');
    lines.push('GST (' + Math.round(L.prod.gst * 100) + '%): ' + fmt0(L.d.gstPerMt) + '/MT');
    lines.push('*Delivered: ' + fmt0(L.d.deliveredPerMt) + '/MT*');
    lines.push('Order total (' + L.qty + ' MT): ' + fmt0(L.d.grandTotal) + ' incl. GST');
    if ($('frTransporter').value) lines.push('Transporter: ' + $('frTransporter').value);
    lines.push('');
    lines.push('_Freight-inclusive delivered price. Valid 7 days._');
    return lines.join('\n');
  }

  /* ── History (local) ── */
  function loadHist() { try { return JSON.parse(localStorage.getItem(HIST_KEY()) || '[]'); } catch (_) { return []; } }
  function saveHist(list) { try { localStorage.setItem(HIST_KEY(), JSON.stringify(list.slice(0, 40))); } catch (_) {} }
  function saveCurrent() {
    var L = state._last; if (!L || !state.dest) { flash($('frSave'), 'Nothing to save'); return; }
    var list = loadHist();
    list.unshift({
      t: Date.now(), company: $('frCompany').value || '', cust: $('frCustName').value || '',
      city: $('frCity').value || '', state: $('frState').value || '', pin: $('frPin').value || '',
      lat: state.dest.lat, lon: state.dest.lon, km: state.km, kmSource: state.kmSource,
      plant: activePlant().short, product: L.prod.key, qty: L.qty,
      freightPerMt: L.d.freightPerMt, freightTotal: L.f.totalFreight, deliveredPerMt: L.d.deliveredPerMt,
      days: L.days, transporter: $('frTransporter').value || ''
    });
    saveHist(list); renderHist();
    var n = $('frSaveNote'); n.style.display = 'block'; n.textContent = '✓ Saved to freight history (this device).';
    setTimeout(function () { n.style.display = 'none'; }, 2500);
  }
  function renderHist() {
    var list = loadHist(), host = $('frHist');
    if (!list.length) { host.innerHTML = '<div class="fr-hist-empty">No saved calculations yet. Save one to reuse its freight next time.</div>'; return; }
    host.innerHTML = list.slice(0, 8).map(function (h, i) {
      var where = [h.city, h.state].filter(Boolean).join(', ') || 'Unknown';
      return '<div class="fr-hist-row" data-i="' + i + '"><div><div class="hn">' + (h.company || h.cust || where) + '</div><div class="hm">' + where + ' · ' + (h.km || 0) + ' km · ' + (h.qty || 0) + ' MT ' + (h.product || '') + '</div></div>'
        + '<div style="display:flex;align-items:center;gap:6px"><div class="hp">' + fmt0(h.deliveredPerMt) + '<small>/MT delivered</small></div><button class="fr-hist-del" data-del="' + i + '" title="Remove">×</button></div></div>';
    }).join('');
    host.querySelectorAll('.fr-hist-row').forEach(function (r) {
      r.addEventListener('click', function (e) { if (e.target.dataset.del != null) return; reuse(list[+r.dataset.i]); });
    });
    host.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); var l = loadHist(); l.splice(+b.dataset.del, 1); saveHist(l); renderHist(); });
    });
  }
  function reuse(h) {
    if (!h) return;
    $('frCompany').value = h.company || ''; $('frCustName').value = h.cust || '';
    $('frCity').value = h.city || ''; $('frState').value = h.state || ''; $('frPin').value = h.pin || '';
    $('frAddr').value = [h.city, h.state, h.pin].filter(Boolean).join(', ');
    if (h.product) { $('frProduct').value = h.product; syncExworks(); }
    if (h.qty) $('frQty').value = h.qty;
    state.dest = { lat: h.lat, lon: h.lon, city: h.city, state: h.state, pin: h.pin, formatted: [h.city, h.state].filter(Boolean).join(', '), source: h.kmSource || 'est' };
    state.km = h.km || 0; state.kmSource = h.kmSource || 'est';
    measure();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* "AI freight prediction" lite — if we've quoted this city before, show the
     spread so the user can price consistently. Real, from their own history. */
  function predict() {
    var el = $('frPredict'); el.classList.remove('show');
    if (!state.dest) return;
    var city = ($('frCity').value || state.dest.city || '').toLowerCase().trim();
    if (!city) return;
    var past = loadHist().filter(function (h) { return (h.city || '').toLowerCase().trim() === city && h.freightPerMt; });
    if (past.length < 1) return;
    var vals = past.map(function (h) { return h.freightPerMt; });
    var avg = Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var freq = {}; past.forEach(function (h) { if (h.transporter) freq[h.transporter] = (freq[h.transporter] || 0) + 1; });
    var top = Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; })[0];
    el.classList.add('show');
    el.innerHTML = '📊 You’ve quoted <b>' + city.replace(/\b\w/g, function (c) { return c.toUpperCase(); }) + '</b> ' + past.length + '×: freight avg <b>' + fmt0(avg) + '/MT</b> (range ' + fmt0(lo) + '–' + fmt0(hi) + ')' + (top ? ' · usual transporter <b>' + top + '</b>' : '') + '.';
  }

  function flash(btn, msg) { var old = btn.textContent; btn.textContent = msg; setTimeout(function () { btn.textContent = old; }, 1400); }

  /* ── Wire up ── */
  function wire() {
    $('frLocate').addEventListener('click', locate);
    $('frAddr').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); locate(); } });
    ['frQty', 'frExworks', 'frRate', 'frManFreight', 'frManDays'].forEach(function (id) { $(id).addEventListener('input', recompute); });
    ['frProduct', 'frPack', 'frVehicle'].forEach(function (id) { $(id).addEventListener('change', recompute); });
    $('frProduct').addEventListener('change', syncExworks);
    $('frMethod').addEventListener('change', function () { syncMethod(); recompute(); });
    $('frCity').addEventListener('input', predict);
    // collapses
    [['frChargesToggle', 'frChargesWrap'], ['frManualToggle', 'frManualWrap']].forEach(function (pair) {
      $(pair[0]).addEventListener('click', function () { $(pair[1]).classList.toggle('open'); });
    });
    // actions
    $('frSave').addEventListener('click', saveCurrent);
    $('frCopy').addEventListener('click', function () {
      var t = quoteText(); if (!t) return flash($('frCopy'), 'Nothing yet');
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { flash($('frCopy'), '✓ Copied'); }).catch(function () { flash($('frCopy'), 'Copy failed'); });
    });
    $('frWa').addEventListener('click', function () {
      var t = quoteText(); if (!t) return flash($('frWa'), 'Locate first');
      var url = (WA && WA.waLink) ? WA.waLink('', t) : ('https://wa.me/?text=' + encodeURIComponent(t));
      window.open(url, '_blank');
    });
  }

  /* ── Boot — idempotent init so BOTH the standalone page and the Lead Discovery
     "Freight" tab can mount the same calculator. Does NOT touch the shell (the
     host page owns QLShell.mount). ── */
  var _inited = false;
  function init() {
    if (_inited) return;
    if (!document.getElementById('frPlants')) return;   // freight markup not on this page
    _inited = true;
    buildPlants(); buildSelects(); buildCharges(); syncMethod(); wire(); renderHist();
    api({ action: 'config' }).then(function (r) { state.google = !!(r && r.google); if (state.google) { var e = $('frKmSrc'); if (e) e.textContent = 'Google ready'; } });
    var boot = function () { renderHist(); buildPlants(); };
    if (Q && Q.init) Q.init(function () {}).then(boot).catch(boot);
    var prev = window.__qlOnSwitchCompany;
    window.__qlOnSwitchCompany = function () { if (typeof prev === 'function') prev(); renderHist(); };
  }
  window.FreightUI = { init: init };
  // Standalone freight.html carries #frCalcRoot → it mounts the shell then inits.
  // Inside Lead Discovery there is no #frCalcRoot; the host calls FreightUI.init().
  if (document.getElementById('frCalcRoot') && window.QLShell) {
    QLShell.mount({ active: 'freight', title: 'Freight Calculator' });
    init();
  }
})();
