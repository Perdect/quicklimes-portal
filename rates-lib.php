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
<link rel="stylesheet" href="/rates.css?v=2">
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
  /* Company and Email were removed on 2026-08-30: this buyer sells by phone and
     WhatsApp, and both fields were optional noise that unbalanced the grid. The
     API still accepts them, so a page cached before today keeps working. */
  $opts = ['Quick Lime', 'Quick Lime Powder', 'Hydrated Lime', 'Chuna (Lime)'];
  if (!in_array($product, $opts, true)) $product = $opts[0];
  $chips = '';
  foreach ($opts as $o) {
    $v = e($o);
    $chips .= '<label class="rt-chip"><input type="radio" name="product" value="' . $v . '"'
            . ($o === $product ? ' checked' : '') . '><span>' . $v . '</span></label>';
  }
  $waHref = 'https://wa.me/' . QL_WA . '?text=' . rawurlencode('Hello, I would like a price for ' . $product . '.');

  $head = <<<'HTML'
<form class="rt-form" id="quote" novalidate onsubmit="qlEnq(this);return false">
  <div class="rt-form-head">
    <span class="rt-form-tag">Free quote</span>
    <h3>Request a quotation</h3>
    <p>Tell us how much you need and where it has to reach. We reply with a firm rate for your quantity, usually the same working day.</p>
  </div>
  <div class="rt-form-body">
    <fieldset class="rt-chips">
      <legend>Which product?</legend>
      <div class="rt-chip-row">
HTML;

  $fields = <<<'HTML'
      </div>
    </fieldset>
    <div class="rt-form-grid">
      <label class="rt-f">
        <span class="rt-lab">Name <i class="rt-req">required</i></span>
        <input name="name" required maxlength="120" autocomplete="name" placeholder="Your name">
      </label>
      <label class="rt-f">
        <span class="rt-lab">Phone / WhatsApp <i class="rt-req">required</i></span>
        <input name="phone" required inputmode="tel" autocomplete="tel" maxlength="16" placeholder="10-digit mobile number">
      </label>
      <label class="rt-f">
        <span class="rt-lab">Quantity <i class="rt-opt">optional</i></span>
        <input name="qty" maxlength="40" placeholder="e.g. 25 MT">
      </label>
      <label class="rt-f">
        <span class="rt-lab">Delivery location <i class="rt-opt">optional</i></span>
        <input name="location" maxlength="160" autocomplete="address-level2" placeholder="City / district, state">
      </label>
      <label class="rt-f rt-form-full">
        <span class="rt-lab">Requirement <i class="rt-opt">optional</i></span>
        <textarea name="requirement" rows="3" maxlength="1000" placeholder="Grade, packaging, delivery schedule, GST state…"></textarea>
      </label>
      <input name="website" tabindex="-1" autocomplete="off" class="rt-hp" aria-hidden="true">
    </div>
    <div class="rt-form-foot">
      <button class="rt-submit" type="submit">Send enquiry</button>
HTML;

  $wa = '<a class="rt-alt" href="' . $waHref . '" target="_blank" rel="noopener">'
      . '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.13c-.25.69-1.44 1.32-1.99 1.37-.53.05-1.02.23-3.44-.72-2.9-1.14-4.74-4.1-4.88-4.29-.14-.19-1.16-1.55-1.16-2.96 0-1.41.74-2.1 1-2.39.26-.29.57-.36.76-.36h.55c.18 0 .42-.07.65.5.25.6.84 2.07.91 2.22.07.14.12.31.02.5-.1.19-.15.31-.29.48-.14.17-.3.38-.43.51-.14.14-.29.3-.13.58.17.29.74 1.22 1.59 1.98 1.09.97 2.01 1.28 2.3 1.42.29.14.45.12.62-.07.17-.19.71-.83.9-1.12.19-.29.38-.24.64-.14.26.1 1.65.78 1.93.92.29.14.48.21.55.33.07.12.07.69-.18 1.37z"/></svg>'
      . 'WhatsApp instead</a>';

  $tail = <<<'HTML'

    </div>
    <p class="rt-form-msg" role="status" aria-live="polite"></p>
    <p class="rt-form-note">We use your number only to send this quotation and to follow it up. No newsletters, no sharing with anyone else.</p>
  </div>
  <div class="rt-form-done" hidden tabindex="-1">
    <div class="rt-done-tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></div>
    <h3>Enquiry received</h3>
    <p>Thank you. Our sales team will call you on <b class="rt-done-num"></b> with a firm rate — usually within a few working hours.</p>
HTML;

  $done = '<a class="rt-btn rt-btn-wa" href="' . $waHref . '" target="_blank" rel="noopener">Message us on WhatsApp</a>'
        . '</div></form>';

  $js = <<<'HTML'
<script>
  /* qlEnq must NOT be async: an async function returns a Promise, every Promise is
     truthy, and a truthy onsubmit handler does not cancel the native submit — the
     form reloaded the page on every real click and the enquiry was lost. The async
     work happens in qlEnqGo; this wrapper returns a plain false. */
  function qlEnq(f){ qlEnqGo(f); return false }
  function qlTen(v){
    var x=(v||"").replace(/\D/g,"");
    if(x.length>10&&x.slice(0,2)==="91") x=x.slice(2);
    if(x.length===11&&x.charAt(0)==="0") x=x.slice(1);
    return x
  }
  async function qlEnqGo(f){
    var m=f.querySelector(".rt-form-msg"),b=f.querySelector(".rt-submit");
    var nm=f.querySelector('[name="name"]'),ph=f.querySelector('[name="phone"]');
    [nm,ph].forEach(function(el){el.classList.remove("rt-bad")});
    m.style.color="";m.textContent="";
    if(!nm.value.trim()){nm.classList.add("rt-bad");m.textContent="Please tell us your name.";nm.focus();return}
    var tel=qlTen(ph.value);
    if(tel.length<10){ph.classList.add("rt-bad");m.textContent="Please enter a 10-digit mobile number so we can call you back.";ph.focus();return}
    m.style.color="var(--mut)";m.textContent="Sending…";b.disabled=true;
    try{
      var d={action:"enquiry"};new FormData(f).forEach(function(v,k){d[k]=v});
      d.phone=tel;
      if(/^\d+(\.\d+)?$/.test((d.qty||"").trim())) d.qty=d.qty.trim()+" MT";
      var r=await fetch("https://app.quicklimes.com/api/rates.php",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});
      var j=await r.json();
      if(j.ok){
        var done=f.querySelector(".rt-form-done");
        done.querySelector(".rt-done-num").textContent=tel.length===10?tel.slice(0,5)+" "+tel.slice(5):tel;
        f.querySelector(".rt-form-head").hidden=true;
        f.querySelector(".rt-form-body").hidden=true;
        done.hidden=false;done.focus();
        return;
      }
      m.style.color="";m.textContent=j.error||"Could not send — please WhatsApp or call us.";
    }catch(e){m.style.color="";m.textContent="Could not send — please WhatsApp or call us."}
    b.disabled=false;
  }
</script>
HTML;

  return $head . $chips . $fields . $wa . $tail . $done . $js;
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
<script>/* owner shortcut: visible only in a browser signed into the portal */
try{if((JSON.parse(localStorage.getItem("ql_plant")||"null")||{}).token){var qlmr=document.createElement("a");qlmr.href="/rates-manage";qlmr.textContent="✎ Manage rates";qlmr.setAttribute("style","position:fixed;left:18px;bottom:18px;z-index:60;background:#0B1220;color:#fff;font:600 .82rem Inter,sans-serif;border-radius:999px;padding:.6rem 1rem;text-decoration:none");document.body.appendChild(qlmr);}}catch(e){}</script>
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
