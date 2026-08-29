<?php
require __DIR__ . '/rates-lib.php';
ql_product_page([
  'slug' => 'quick-lime', 'name' => 'Quick Lime', 'path' => '/quick-lime-rate',
  'title' => 'Quick Lime Rate Today in India | Quick Lime Price per Ton',
  'desc'  => 'Current indicative quick lime rate per MT from Deshwali Minerals, a quicklime manufacturer in Rajasthan. Grades, packaging, MOQ, applications and a firm quotation on WhatsApp.',
  'h1'    => 'Quick Lime Rate Today',
  'sub'   => 'Indicative quicklime (burnt lime / CaO) rate per metric ton from our kilns at ' . QL_CITY . ' — with grades, packaging and delivery across India.',
  'sections' => [
    ['About our quick lime', '<p>Quick lime (calcium oxide, CaO) is limestone burnt in a kiln until the carbonate breaks down.
      ' . e(QL_FIRM) . ' burns high-calcium limestone from the Nagaur belt — one of India&rsquo;s established lime regions —
      and supplies lump quicklime directly from the kiln, as a manufacturer rather than a reseller. Grade and CaO content are
      confirmed per lot, and every dispatch carries its <b>test certificate</b>.</p>
      <div class="rt-cols"><div><h3>Supply details</h3><ul>
        <li><b>Form:</b> lumps (crushed sizes on request)</li>
        <li><b>Packaging:</b> loose / jumbo bags / 50&nbsp;kg bags</li>
        <li><b>MOQ:</b> typically one truckload — smaller lots on request</li>
        <li><b>Dispatch:</b> from ' . e(QL_CITY) . '</li>
        <li><b>Documents:</b> GST invoice, e-way bill, test certificate</li>
      </ul></div><div><h3>Industries served</h3><ul>
        <li>Steel &amp; metallurgy (flux, slag control)</li>
        <li>Water &amp; effluent treatment</li>
        <li>Paper &amp; sugar processing</li>
        <li>Chemicals — calcium-based derivatives</li>
        <li>Construction, soil stabilisation &amp; infrastructure</li>
      </ul></div></div>'],
    ['How the quick lime price is calculated', '<p>A delivered quicklime price has four parts: the <b>ex-works rate</b>
      (driven mainly by fuel and limestone quality), <b>packaging</b>, <b>freight</b> to your district — often the biggest
      variable, since lime moves in full truckloads — and <b>GST</b>. That is why one number cannot honestly serve every
      buyer: a plant 80&nbsp;km away and a plant 800&nbsp;km away pay meaningfully different landed prices for the same
      material. Share your delivery point and monthly volume and we will return a firm delivered quotation.</p>'],
  ],
  'faqs' => [
    ['What is today\'s quick lime rate per ton?', 'The current indicative rate is shown at the top of this page when published, ex-works and excluding GST. For a firm rate for your quantity and delivery location, WhatsApp or call our sales team — quotations usually go out within the hour in business hours.'],
    ['Does the rate include GST and transport?', 'No. Displayed rates are indicative ex-works rates excluding GST. Freight to your location, packaging and GST are added in the final quotation.'],
    ['What is the minimum order quantity?', 'Typically one full truckload, because freight dominates small-lot economics. Smaller quantities can be discussed — ask our sales team.'],
    ['What grade / CaO percentage do you supply?', 'We burn high-calcium Nagaur-belt limestone and confirm grade and CaO content per lot, with a test certificate accompanying every dispatch. Tell us your application and we will match the grade.'],
    ['Do you deliver outside Rajasthan?', 'Yes — truckload dispatches go across India from Merta City, Nagaur. Delivery time and freight depend on the destination district.'],
  ],
]);
