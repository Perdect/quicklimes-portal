<?php
/* ONE location page, done properly — real plant, real region, real logistics.
   More locations only when there is genuinely distinct substance (§5). */
require __DIR__ . '/rates-lib.php';
ql_product_page([
  'slug' => 'quick-lime', 'name' => 'Quick Lime', 'path' => '/quick-lime-rate-rajasthan',
  'title' => 'Quick Lime Rate in Rajasthan | Manufacturer in Nagaur',
  'desc'  => 'Quick lime rate in Rajasthan from Deshwali Minerals — lime manufacturer at Merta City, Nagaur. Same-state truckload delivery, grades, packaging and firm quotations on WhatsApp.',
  'h1'    => 'Quick Lime Rate in Rajasthan',
  'sub'   => 'Buying lime inside Rajasthan means buying at the source: our kilns are at Merta City in the Nagaur lime belt, so in-state buyers get the shortest freight in the country.',
  'sections' => [
    ['Why Rajasthan buyers pay the best landed price', '<p>The Nagaur belt is one of India&rsquo;s main quicklime regions,
      and freight is the largest variable in a delivered lime price. From Merta City, most Rajasthan districts are a
      same-day or next-day truck run — Jodhpur, Jaipur, Ajmer, Bikaner, Udaipur, Kota and the industrial areas between.
      That shorter leg is exactly why an in-state buyer&rsquo;s landed cost beats buying the same grade hauled from
      further away.</p>
      <div class="rt-cols"><div><h3>Delivery across Rajasthan</h3><ul>
        <li>Jodhpur, Pali, Barmer — western industrial belt</li>
        <li>Jaipur, Ajmer, Kishangarh — central corridor</li>
        <li>Udaipur, Chittorgarh — southern mining &amp; chemical belt</li>
        <li>Bikaner, Sri Ganganagar — northern districts</li>
        <li>Kota, Bhilwara — textile and process industries</li>
      </ul></div><div><h3>Who buys from us in-state</h3><ul>
        <li>Water treatment &amp; municipal users</li>
        <li>Construction and infrastructure contractors</li>
        <li>Chemical and mineral processors</li>
        <li>Agriculture &amp; soil treatment suppliers</li>
      </ul></div></div>'],
    ['Rates for Rajasthan delivery', '<p>The indicative ex-works rate above applies at the kiln gate at Merta City; a
      Rajasthan delivered price adds only the short in-state freight and GST. Send your district and quantity on
      WhatsApp and the quotation will show the delivered ₹/MT for your location. For the national picture, see the
      <a href="/quick-lime-rate">all-India quick lime rate page</a> or the <a href="/lime-rates">full rate table</a>.</p>'],
  ],
  'faqs' => [
    ['What is the quick lime rate in Rajasthan today?', 'The indicative ex-works rate at our Merta City kiln is shown above when published, excluding GST. Delivered rates inside Rajasthan add only short in-state freight — WhatsApp your district for the exact number.'],
    ['How fast is delivery inside Rajasthan?', 'Most districts are a same-day or next-day truck run from Merta City, Nagaur, subject to vehicle availability.'],
    ['Are you a manufacturer or a trader?', 'A manufacturer — Deshwali Minerals burns lime in its own kilns at Merta City, Nagaur (GSTIN 08NLIPS9801K1Z5). You buy at the source.'],
  ],
]);
