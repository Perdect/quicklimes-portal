<?php
/* ═══════════════════════════════════════════════════════════════
   rates-lib.php — shared engine for the quicklimes.com lime-rate pages.

   Server-rendered on purpose: the rate, the updated date and the schema all
   land in the HTML itself, so search engines index the real current number —
   and when the admin updates a rate in the QuickLimes app, every page here
   changes on the next request with no rebuild.

   THE RATE RULE: a product without a published rate renders "On request".
   This file never invents a number.
   ═══════════════════════════════════════════════════════════════ */
error_reporting(E_ALL & ~E_DEPRECATED);

const QL_SITE   = 'https://quicklimes.com';
const QL_FIRM   = 'Deshwali Minerals';
const QL_CITY   = 'Merta City, Nagaur, Rajasthan';
const QL_GSTIN  = '08NLIPS9801K1Z5';
const QL_PHONE  = '9469767676';
const QL_WA     = '919469767676';

function ql_rates_db() {
  static $db = null, $tried = false;
  if ($tried) return $db;
  $tried = true;
  foreach ([__DIR__ . '/app/api/db.php', __DIR__ . '/../app/api/db.php', __DIR__ . '/dashboard/api/db.php'] as $p) {
    /* db.php EXITS with a JSON error when config.php is missing — so only
       require it where a config actually exists, and render "on request"
       everywhere else instead of dying */
    if (is_file($p) && is_file(dirname($p) . '/config.php')) { require_once $p; break; }
  }
  if (!function_exists('ql_db')) return null;
  try { ql_ensure_tables(); $db = ql_db(); } catch (Throwable $e) { $db = null; }
  return $db;
}

/* published products, keyed by slug — [] when the DB is unreachable, and the
   pages then say "on request" instead of erroring */
function ql_rates() {
  static $rows = null;
  if ($rows !== null) return $rows;
  $rows = [];
  $db = ql_rates_db(); if (!$db) return $rows;
  try {
    foreach ($db->query('SELECT * FROM lime_rates WHERE published = 1 ORDER BY id') as $r) $rows[$r['slug']] = $r;
  } catch (Throwable $e) {}
  return $rows;
}
function ql_rate_history($slug = '', $limit = 12) {
  $db = ql_rates_db(); if (!$db) return [];
  try {
    $q = $slug === ''
      ? $db->prepare('SELECT slug, rate, unit, recorded_at FROM lime_rate_history ORDER BY id DESC LIMIT ' . (int)$limit)
      : $db->prepare('SELECT slug, rate, unit, recorded_at FROM lime_rate_history WHERE slug = ? ORDER BY id DESC LIMIT ' . (int)$limit);
    $q->execute($slug === '' ? [] : [$slug]);
    return $q->fetchAll(PDO::FETCH_ASSOC);
  } catch (Throwable $e) { return []; }
}

function e($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function ql_inr($n) { return '₹' . number_format((float)$n, ((float)$n == (int)$n) ? 0 : 2, '.', ','); }   // en-IN grouping below
function ql_inr_in($n) {                                             // Indian digit grouping (₹12,34,567)
  $n = (float)$n; $d = floor($n);
  $s = (string)(int)$d; $last3 = substr($s, -3); $rest = substr($s, 0, -3);
  if ($rest !== '') $last3 = preg_replace('/\B(?=(\d{2})+(?!\d))/', ',', $rest) . ',' . $last3;
  return '₹' . $last3;
}
function ql_date($iso) { return $iso ? date('j M Y', strtotime($iso)) : ''; }
function ql_rate_cell($p) {
  if (!$p || $p['rate'] === null || $p['rate'] === '') return '<span class="rt-onreq">On request</span>';
  return '<b class="rt-amt">' . ql_inr_in($p['rate']) . '</b><span class="rt-unit">/' . e($p['unit']) . '</span>';
}
function ql_last_updated($products) {
  $mx = '';
  foreach ($products as $p) if (($p['updated_at'] ?? '') > $mx) $mx = $p['updated_at'];
  return $mx;
}

/* one WhatsApp link with a per-page prefilled message */
function ql_wa_link($msg) { return 'https://wa.me/' . QL_WA . '?text=' . rawurlencode($msg); }

/* ── page chrome ─────────────────────────────────────────────── */
function ql_head($t) {
  $title = e($t['title']); $desc = e($t['desc']); $canon = QL_SITE . $t['path'];
  $ld = $t['ld'] ?? [];
  $ldJson = '';
  foreach ($ld as $obj) $ldJson .= '<script type="application/ld+json">' . json_encode($obj, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . '</script>' . "\n";
  echo '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>' . $title . '</title>
<meta name="description" content="' . $desc . '">
<link rel="canonical" href="' . e($canon) . '">
<meta property="og:type" content="website"><meta property="og:site_name" content="Deshwali Minerals — QuickLimes">
<meta property="og:title" content="' . $title . '"><meta property="og:description" content="' . $desc . '">
<meta property="og:url" content="' . e($canon) . '"><meta property="og:image" content="' . QL_SITE . '/assets/og-image.png">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' . $title . '">
<meta name="twitter:description" content="' . $desc . '">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/rates.css">
' . $ldJson . '</head><body>';
}
function ql_nav($active) {
  $items = [['/', 'Home'], ['/lime-rates', 'Lime Rates'], ['/quick-lime-rate', 'Quick Lime'], ['/hydrated-lime-rate', 'Hydrated Lime'], ['/chuna-rate', 'Chuna'], ['/portal', 'Customer Portal']];
  echo '<header class="rt-nav"><div class="rt-wrap rt-nav-in"><a class="rt-logo" href="/"><img src="/assets/favicon-32.png" alt="QuickLimes" width="26" height="26"> Deshwali Minerals</a><nav>';
  foreach ($items as $i) echo '<a href="' . $i[0] . '"' . ($active === $i[0] ? ' class="on"' : '') . '>' . $i[1] . '</a>';
  echo '</nav><a class="rt-cta-mini" href="' . e(ql_wa_link('Hello Deshwali Minerals, I want today\'s lime rate.')) . '">WhatsApp</a></div></header>';
}
function ql_breadcrumb($trail) {
  echo '<div class="rt-wrap"><nav class="rt-crumb" aria-label="Breadcrumb">';
  $out = [];
  foreach ($trail as $tt) $out[] = $tt[0] === '' ? '<span>' . e($tt[1]) . '</span>' : '<a href="' . e($tt[0]) . '">' . e($tt[1]) . '</a>';
  echo implode(' <span class="sep">›</span> ', $out) . '</nav></div>';
}
function ql_bc_ld($trail) {
  $items = []; $i = 1;
  foreach ($trail as $tt) $items[] = ['@type' => 'ListItem', 'position' => $i++, 'name' => $tt[1]] + ($tt[0] !== '' ? ['item' => QL_SITE . $tt[0]] : []);
  return ['@context' => 'https://schema.org', '@type' => 'BreadcrumbList', 'itemListElement' => $items];
}
function ql_org_ld() {
  return ['@context' => 'https://schema.org', '@type' => 'Organization', 'name' => QL_FIRM,
    'url' => QL_SITE, 'logo' => QL_SITE . '/assets/icon-512.png', 'telephone' => '+91' . QL_PHONE,
    'address' => ['@type' => 'PostalAddress', 'addressLocality' => 'Merta City', 'addressRegion' => 'Rajasthan', 'addressCountry' => 'IN']];
}
/* Product schema — the Offer appears ONLY when a real published rate exists,
   and mirrors exactly what the page displays (§16). */
function ql_product_ld($slug, $name, $desc, $path) {
  $p = ql_rates()[$slug] ?? null;
  $ld = ['@context' => 'https://schema.org', '@type' => 'Product', 'name' => $name, 'description' => $desc,
    'url' => QL_SITE . $path, 'brand' => ['@type' => 'Brand', 'name' => QL_FIRM]];
  if ($p && $p['rate'] !== null && $p['rate'] !== '') {
    $ld['offers'] = ['@type' => 'Offer', 'priceCurrency' => 'INR', 'price' => (string)(float)$p['rate'],
      'priceSpecification' => ['@type' => 'UnitPriceSpecification', 'price' => (string)(float)$p['rate'],
        'priceCurrency' => 'INR', 'unitText' => $p['unit']],
      'availability' => 'https://schema.org/InStock',
      'priceValidUntil' => date('Y-m-d', strtotime('+30 days')),
      'seller' => ['@type' => 'Organization', 'name' => QL_FIRM]];
  }
  return $ld;
}
function ql_faq_ld($faqs) {
  $q = [];
  foreach ($faqs as $f) $q[] = ['@type' => 'Question', 'name' => $f[0],
    'acceptedAnswer' => ['@type' => 'Answer', 'text' => $f[1]]];
  return ['@context' => 'https://schema.org', '@type' => 'FAQPage', 'mainEntity' => $q];
}

/* the disclaimer every rate carries — this is what keeps an indicative
   figure from reading as a binding quotation */
function ql_disclaimer() {
  echo '<p class="rt-disc">Rates shown are <b>indicative market rates</b>, exclusive of GST. Final price may vary with quantity,
  specification, grade, packaging, transportation and delivery location. Contact our sales team for a firm quotation.</p>';
}

function ql_cta_block($product) {
  $wa = ql_wa_link('Hello Deshwali Minerals, please share today\'s rate for ' . $product . '.');
  echo '<section class="rt-cta" id="enquire"><div class="rt-wrap">
  <h2>Need today&rsquo;s exact ' . e($product) . ' rate?</h2>
  <p>Market prices move with quantity, grade and delivery location. Tell us what you need and our sales team will
  send a firm quotation — usually within the hour, during business hours.</p>
  <div class="rt-cta-btns">
    <a class="rt-btn rt-btn-wa" href="' . e($wa) . '">WhatsApp Sales</a>
    <a class="rt-btn rt-btn-ghost" href="tel:+91' . QL_PHONE . '">Call +91 ' . QL_PHONE . '</a>
    <a class="rt-btn rt-btn-primary" href="#quote">Request a Quote</a>
  </div>
  ' . ql_enquiry_form($product) . '
</div></section>';
}
function ql_enquiry_form($product) {
  return '<form class="rt-form" id="quote" onsubmit="return qlEnq(this)">
    <h3>Request a quotation</h3>
    <div class="rt-form-grid">
      <label>Name*<input name="name" required maxlength="120"></label>
      <label>Company<input name="company" maxlength="160"></label>
      <label>Phone / WhatsApp*<input name="phone" required inputmode="tel" maxlength="16"></label>
      <label>Email<input name="email" type="email" maxlength="160"></label>
      <label>Product<select name="product">
        <option' . ($product === 'Quick Lime' ? ' selected' : '') . '>Quick Lime</option>
        <option' . ($product === 'Quick Lime Powder' ? ' selected' : '') . '>Quick Lime Powder</option>
        <option' . ($product === 'Hydrated Lime' ? ' selected' : '') . '>Hydrated Lime</option>
        <option' . ($product === 'Chuna (Lime)' ? ' selected' : '') . '>Chuna (Lime)</option></select></label>
      <label>Quantity<input name="qty" placeholder="e.g. 25 MT" maxlength="40"></label>
      <label>Delivery location<input name="location" placeholder="City / district, state" maxlength="160"></label>
      <label class="rt-form-full">Requirement<textarea name="requirement" rows="3" maxlength="1000" placeholder="Grade, packaging, delivery schedule…"></textarea></label>
      <input name="website" tabindex="-1" autocomplete="off" class="rt-hp" aria-hidden="true">
    </div>
    <button class="rt-btn rt-btn-primary" type="submit">Send enquiry</button>
    <span class="rt-form-msg" aria-live="polite"></span>
  </form>
  <script>
  async function qlEnq(f){var m=f.querySelector(".rt-form-msg"),b=f.querySelector("button");m.textContent="Sending…";b.disabled=true;
    try{var d={action:"enquiry"};new FormData(f).forEach(function(v,k){d[k]=v});
      var r=await fetch("https://app.quicklimes.com/api/rates.php",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});
      var j=await r.json();
      m.textContent=j.ok?"Thank you — our sales team will contact you shortly.":(j.error||"Could not send — please WhatsApp or call us.");
      if(j.ok)f.reset();
    }catch(e){m.textContent="Could not send — please WhatsApp or call us."}
    b.disabled=false;return false}
  </script>';
}
function ql_trust() {
  echo '<section class="rt-trust"><div class="rt-wrap rt-trust-grid">
    <div><b>Manufacturer, not a trader</b><span>Own kiln operations at ' . e(QL_CITY) . ' — quicklime and hydrated lime made in-house.</span></div>
    <div><b>GST-registered</b><span>' . e(QL_FIRM) . ' · GSTIN ' . e(QL_GSTIN) . '</span></div>
    <div><b>Test certificate with dispatch</b><span>Every lot ships with its test certificate; grade confirmed before loading.</span></div>
    <div><b>Pan-India dispatch</b><span>Truckload deliveries across Rajasthan and India — packaging in bags, jumbo bags or loose.</span></div>
  </div></section>';
}
function ql_footer() {
  echo '<footer class="rt-foot"><div class="rt-wrap">
  <div class="rt-foot-grid">
    <div><b>' . e(QL_FIRM) . '</b><br>' . e(QL_CITY) . '<br>GSTIN ' . e(QL_GSTIN) . '</div>
    <div><b>Products &amp; rates</b><br><a href="/lime-rates">All lime rates</a><br><a href="/quick-lime-rate">Quick lime rate</a><br><a href="/quick-lime-powder-rate">Quick lime powder rate</a><br><a href="/hydrated-lime-rate">Hydrated lime rate</a><br><a href="/chuna-rate">Chuna rate</a></div>
    <div><b>Contact</b><br><a href="tel:+91' . QL_PHONE . '">+91 ' . QL_PHONE . '</a><br><a href="' . e(ql_wa_link('Hello Deshwali Minerals')) . '">WhatsApp</a><br><a href="/portal">Customer portal</a></div>
  </div>
  <p class="rt-foot-note">© ' . date('Y') . ' ' . e(QL_FIRM) . '. Rates on this site are indicative and exclusive of GST; final quotations depend on quantity, specification and delivery location.</p>
</div></footer>
<a class="rt-sticky-wa" href="' . e(ql_wa_link('Hello Deshwali Minerals, I want today\'s lime rate.')) . '" aria-label="WhatsApp sales">WhatsApp</a>
</body></html>';
}

/* rate table used by the hub + reusable rows */
function ql_rate_table($slugs) {
  $R = ql_rates();
  echo '<div class="rt-tblwrap"><table class="rt-tbl"><thead><tr>
    <th scope="col">Product</th><th scope="col">Grade</th><th scope="col">Unit</th><th scope="col" class="num">Indicative rate</th><th scope="col">Last updated</th><th scope="col"></th></tr></thead><tbody>';
  $PAGES = ['quick-lime' => '/quick-lime-rate', 'quick-lime-powder' => '/quick-lime-powder-rate', 'hydrated-lime' => '/hydrated-lime-rate', 'chuna' => '/chuna-rate'];
  $NAMES = ['quick-lime' => 'Quick Lime', 'quick-lime-powder' => 'Quick Lime Powder', 'hydrated-lime' => 'Hydrated Lime', 'chuna' => 'Chuna (Lime)'];
  foreach ($slugs as $slug) {
    $p = $R[$slug] ?? null;
    $name = $p['name'] ?? $NAMES[$slug] ?? $slug;
    $href = $PAGES[$slug] ?? '/lime-rates';
    echo '<tr><td><a class="rt-plink" href="' . e($href) . '">' . e($name) . '</a></td>'
      . '<td>' . e($p['grade'] ?? 'Industrial Grade') . '</td>'
      . '<td>Per ' . e($p['unit'] ?? 'MT') . '</td>'
      . '<td class="num">' . ql_rate_cell($p) . '</td>'
      . '<td>' . ($p ? e(ql_date($p['updated_at'])) : '—') . '</td>'
      . '<td><a class="rt-btn rt-btn-sm" href="' . e($href) . '#enquire">Enquire</a></td></tr>';
  }
  echo '</tbody></table></div>';
}

/* ── the product-page renderer: one layout, unique content per product ── */
function ql_product_page($c) {
  $slug = $c['slug']; $name = $c['name']; $path = $c['path'];
  $p = ql_rates()[$slug] ?? null;
  $trail = [['/', 'Home'], ['/lime-rates', 'Lime Rates'], ['', $name]];
  $ld = [ql_org_ld(), ql_bc_ld($trail), ql_product_ld($slug, $name, $c['desc'], $path)];
  if (!empty($c['faqs'])) $ld[] = ql_faq_ld($c['faqs']);
  ql_head(['title' => $c['title'], 'desc' => $c['desc'], 'path' => $path, 'ld' => $ld]);
  ql_nav($path);
  ql_breadcrumb($trail);
  echo '<main class="rt-wrap"><section class="rt-hero"><h1>' . e($c['h1']) . '</h1><p class="sub">' . e($c['sub']) . '</p>';
  if ($p) echo '<span class="rt-updated"><span class="dot"></span>Rate updated: ' . e(ql_date($p['updated_at'])) . '</span>';
  echo '<div class="rt-ratecard"><div><div class="lbl">Indicative rate — ' . e($name) . '</div><div class="big">' . ql_rate_cell($p) . '</div></div>';
  if ($p && $p['moq'] !== '') echo '<div class="meta"><b>MOQ</b><br>' . e($p['moq']) . '</div>';
  echo '<div class="meta"><b>Ex-works</b><br>' . e($p && $p['location'] !== '' ? $p['location'] : QL_CITY) . '</div>';
  if ($p && $p['grade'] !== '') echo '<div class="meta"><b>Grade</b><br>' . e($p['grade']) . '</div>';
  echo '<a class="rt-btn rt-btn-primary" href="#enquire" style="margin-left:auto">Get today&rsquo;s exact rate</a></div>';
  ql_disclaimer();
  echo '</section>';
  foreach ($c['sections'] as $sec) {
    echo '<section class="rt-sec"><h2>' . e($sec[0]) . '</h2>' . $sec[1] . '</section>';
  }
  /* rate history — real records only, shown only when they exist */
  $hist = ql_rate_history($slug, 12);
  if ($hist) {
    echo '<section class="rt-sec"><h2>' . e($name) . ' rate history</h2>
    <div class="rt-tblwrap"><table class="rt-tbl rt-hist"><thead><tr><th>Date</th><th>Product</th><th class="num">Indicative rate</th></tr></thead><tbody>';
    foreach ($hist as $h) echo '<tr><td>' . e(ql_date($h['recorded_at'])) . '</td><td>' . e($name) . '</td><td class="num"><b class="rt-amt">' . ql_inr_in($h['rate']) . '</b><span class="rt-unit">/' . e($h['unit']) . '</span></td></tr>';
    echo '</tbody></table></div><p class="rt-disc" style="margin-top:0">Historical indicative rates as published on this site on each date. They are records, not current offers.</p></section>';
  }
  if (!empty($c['faqs'])) {
    echo '<section class="rt-sec rt-faq"><h2>Frequently asked questions</h2>';
    foreach ($c['faqs'] as $f) echo '<details><summary>' . e($f[0]) . '</summary><p>' . e($f[1]) . '</p></details>';
    echo '</section>';
  }
  ql_trust();
  echo '</main>';
  ql_cta_block($name);
  ql_footer();
}
