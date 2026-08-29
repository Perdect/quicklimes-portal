<?php
require __DIR__ . '/rates-lib.php';
ql_product_page([
  'slug' => 'hydrated-lime', 'name' => 'Hydrated Lime', 'path' => '/hydrated-lime-rate',
  'title' => 'Hydrated Lime Rate Today in India | Hydrated Lime Price',
  'desc'  => 'Indicative hydrated lime (slaked lime) rate per MT from Deshwali Minerals, Rajasthan. Purity, packaging, MOQ, bulk supply and firm quotations on WhatsApp.',
  'h1'    => 'Hydrated Lime Rate Today',
  'sub'   => 'Indicative hydrated lime (calcium hydroxide / slaked lime) rate per metric ton, hydrated in-house from our own kiln-burnt quicklime.',
  'sections' => [
    ['About our hydrated lime', '<p>Hydrated lime — calcium hydroxide, Ca(OH)<sub>2</sub> — is made by slaking fresh quicklime
      with water under control. Because we hydrate our own kiln output at ' . e(QL_CITY) . ', the input lime never travels or
      ages before slaking, which is what protects available-lime content. Purity is confirmed per lot with a test
      certificate.</p>
      <div class="rt-cols"><div><h3>Supply details</h3><ul>
        <li><b>Form:</b> dry powder</li>
        <li><b>Packaging:</b> 25/50&nbsp;kg bags or jumbo bags</li>
        <li><b>MOQ:</b> typically one truckload; smaller lots on request</li>
        <li><b>Documents:</b> GST invoice, e-way bill, test certificate</li>
      </ul></div><div><h3>Applications</h3><ul>
        <li>Water &amp; sewage treatment (pH correction)</li>
        <li>Flue-gas desulphurisation</li>
        <li>Sugar refining</li>
        <li>Construction — mortars, plasters, soil stabilisation</li>
        <li>Chemical intermediates &amp; pesticides</li>
      </ul></div></div>'],
    ['Hydrated lime vs quick lime — which do you need?', '<p>Quicklime is the stronger, hotter-reacting oxide; hydrated lime
      is its slaked, easier-to-handle form. If your process has a slaker and wants maximum available CaO per rupee, buy
      <a href="/quick-lime-rate">quicklime</a>. If you dose dry powder directly, need safer handling, or your specification
      says Ca(OH)<sub>2</sub>, hydrated lime is the right material. We supply both — pricing each way on request.</p>'],
  ],
  'faqs' => [
    ['What is the hydrated lime price per ton today?', 'The current indicative ex-works rate appears at the top of this page when published, excluding GST. For a firm delivered price, send your quantity and district on WhatsApp.'],
    ['What purity do you supply?', 'Purity and available-lime content are confirmed per lot against your specification, and every dispatch carries its test certificate. Tell us the application and we will match the grade.'],
    ['Why is hydrated lime priced differently from quicklime?', 'Slaking adds process cost but also weight (water combines chemically), so per-ton comparisons are not like-for-like. The right comparison is cost per unit of available lime for your process — we can work that out with you.'],
    ['Do you supply bulk monthly contracts?', 'Yes. Contract volumes price better than spot truckloads — share your monthly offtake for a contract quotation.'],
  ],
]);
