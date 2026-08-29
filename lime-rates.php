<?php
/* /lime-rates — the ONE authoritative rate page (§21: update this page,
   never spawn fake "today" pages). Everything renders from the DB. */
require __DIR__ . '/rates-lib.php';
$R = ql_rates();
$updated = ql_last_updated($R);
$trail = [['/', 'Home'], ['', 'Lime Rates']];
ql_head([
  'title' => 'Quick Lime, Hydrated Lime & Chuna Rate Today | India',
  'desc'  => 'Latest indicative market rates for Quick Lime, Quick Lime Powder, Hydrated Lime and Chuna from Deshwali Minerals, Rajasthan. Updated by our sales team — request a firm quotation on WhatsApp.',
  'path'  => '/lime-rates',
  'ld'    => [ql_org_ld(), ql_bc_ld($trail),
    ['@context' => 'https://schema.org', '@type' => 'WebSite', 'name' => 'QuickLimes — Deshwali Minerals', 'url' => QL_SITE]],
]);
ql_nav('/lime-rates');
ql_breadcrumb($trail);
?>
<main class="rt-wrap">
  <section class="rt-hero">
    <h1>Quick Lime &amp; Hydrated Lime Rates</h1>
    <p class="sub">Check the latest indicative market rates for Quick Lime, Hydrated Lime, Chuna and Lime Powder
    from <?= e(QL_FIRM) ?> — lime manufacturer at <?= e(QL_CITY) ?>.</p>
    <?php if ($updated): ?><span class="rt-updated"><span class="dot"></span>Rates updated: <?= e(ql_date($updated)) ?></span>
    <?php else: ?><span class="rt-updated"><span class="dot"></span>Current rates are shared on request — WhatsApp or call for today's number</span><?php endif; ?>
  </section>

  <?php ql_rate_table(['quick-lime', 'quick-lime-powder', 'hydrated-lime', 'chuna']); ql_disclaimer(); ?>

  <section class="rt-sec">
    <h2>Latest lime market rates</h2>
    <p>Industrial lime is not exchange-traded, so there is no single official ticker — the working market rate moves with
    limestone and fuel costs, kiln availability, order volume and freight. The rates on this page are the current
    <b>indicative selling rates of <?= e(QL_FIRM) ?></b>, maintained by our own sales team and updated whenever our
    pricing changes. They are a starting point for budgeting; a firm quotation always follows a conversation about
    quantity, grade and delivery point.</p>
    <div class="rt-cols">
      <div>
        <h3>What moves lime prices</h3>
        <ul>
          <li><b>Fuel</b> — petcoke and coal are the largest cost in burning lime; their swings move quicklime rates directly.</li>
          <li><b>Limestone quality</b> — higher-purity feedstock costs more and yields higher-CaO lime.</li>
          <li><b>Order volume</b> — full truckloads and contract volumes price better than small lots.</li>
          <li><b>Freight</b> — lime is heavy; the delivery district often decides more of the landed cost than the product itself.</li>
          <li><b>Packaging</b> — loose in bulkers, 50&nbsp;kg bags or jumbo bags each carry different costs.</li>
        </ul>
      </div>
      <div>
        <h3>Explore each product</h3>
        <ul>
          <li><a href="/quick-lime-rate">Quick lime rate today — price per ton, grades, uses</a></li>
          <li><a href="/quick-lime-powder-rate">Quick lime powder rate — fine-ground quicklime</a></li>
          <li><a href="/hydrated-lime-rate">Hydrated lime rate — slaked lime price and specs</a></li>
          <li><a href="/chuna-rate">Chuna rate — lime for construction and traditional uses</a></li>
          <li><a href="/quick-lime-rate-rajasthan">Quick lime rate in Rajasthan — supply from Nagaur</a></li>
        </ul>
      </div>
    </div>
  </section>

  <?php
  $hist = ql_rate_history('', 18);
  if ($hist) {
    $NAMES = ['quick-lime' => 'Quick Lime', 'quick-lime-powder' => 'Quick Lime Powder', 'hydrated-lime' => 'Hydrated Lime', 'chuna' => 'Chuna (Lime)'];
    echo '<section class="rt-sec"><h2>Rate history</h2>
    <div class="rt-tblwrap"><table class="rt-tbl rt-hist"><thead><tr><th>Date</th><th>Product</th><th class="num">Indicative rate</th></tr></thead><tbody>';
    foreach ($hist as $h) echo '<tr><td>' . e(ql_date($h['recorded_at'])) . '</td><td>' . e($NAMES[$h['slug']] ?? $h['slug']) . '</td><td class="num"><b class="rt-amt">' . ql_inr_in($h['rate']) . '</b><span class="rt-unit">/' . e($h['unit']) . '</span></td></tr>';
    echo '</tbody></table></div>
    <p class="rt-disc" style="margin-top:0">Historical indicative rates as published here on each date — records, not current offers.</p></section>';
  }
  ql_trust();
  ?>
</main>
<?php ql_cta_block('Quick Lime'); ql_footer(); ?>
