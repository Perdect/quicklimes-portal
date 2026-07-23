/* ═══════════════════════════════════════════════════════════════════════════
   osm-query.js — builds the Overpass query the BROWSER sends.

   OpenStreetMap discovery moved from the server to the browser: the free
   Overpass service is slow (30s+ when busy) and throttles datacenter IPs, so a
   PHP curl bounded under the 30s execution limit reports "could not reach" while
   a browser — residential IP, no hard time limit, and Overpass allows CORS —
   succeeds. This module is the query half, kept pure so the exact Overpass QL
   (and its escaping) is unit-tested rather than hand-checked in the console.

   It mirrors the server's builder (db.php ql_osm_search) on purpose: same area
   vs. around logic, same quote/backslash escaping so a quote in the search text
   can never break out of the regex and rewrite the query.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function esc(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

  /* build(what, city, opts) -> Overpass QL string.
       opts.max        : cap on results (1..60, default 40)
       opts.center     : {lat, lon} → an around-search (radius mode)
       opts.radiusKm   : radius when center is given (clamped 1..500 km)
     With a center it searches a circle; otherwise the named administrative area.
     The [timeout:25] is the Overpass-side budget — the browser can afford to wait
     for it (unlike the server, which PHP would kill first). */
  function build(what, city, opts) {
    opts = opts || {};
    var max = Math.max(1, Math.min(60, opts.max || 40));
    var w = esc(what);
    if (opts.center && typeof opts.center.lat === 'number' && typeof opts.center.lon === 'number') {
      var m = Math.min(500000, Math.max(1000, (opts.radiusKm || 50) * 1000));
      return '[out:json][timeout:25];\n'
        + '( nwr["name"~"' + w + '",i](around:' + m + ',' + opts.center.lat + ',' + opts.center.lon + '); );\n'
        + 'out center ' + max + ';';
    }
    return '[out:json][timeout:25];\n'
      + 'area["name"~"^' + esc(city) + '$",i]["boundary"="administrative"]->.a;\n'
      + '( nwr["name"~"' + w + '",i](area.a); );\n'
      + 'out center ' + max + ';';
  }

  root.OSMQuery = { build: build, esc: esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.OSMQuery;
})(typeof window !== 'undefined' ? window : globalThis);
