<?php
require __DIR__ . '/rates-lib.php';
ql_product_page([
  'slug' => 'chuna', 'name' => 'Chuna (Lime)', 'path' => '/chuna-rate',
  'title' => 'Chuna Rate Today | Lime Price per Ton in India',
  'desc'  => 'Indicative chuna (lime) rate today from Deshwali Minerals, Rajasthan — construction chuna and industrial lime, price per ton, packaging, MOQ and quotations on WhatsApp.',
  'h1'    => 'Chuna Rate Today',
  'sub'   => 'Indicative chuna / lime rate per metric ton from ' . QL_CITY . ' — the traditional name, the same kiln-made lime.',
  'sections' => [
    ['What chuna are you buying?', '<p><b>Chuna</b> is the everyday name for lime, and it covers more than one material:
      burnt lump lime (quicklime), slaked lime powder (hydrated lime), and construction chuna used in mortars, whitewash and
      plasters. The rate depends on which one your work needs — whitewash chuna and steel-plant lime are different products
      at different prices. If you are unsure, describe the use on WhatsApp and we will point you at the right material and
      its rate.</p>
      <div class="rt-cols"><div><h3>Common chuna uses</h3><ul>
        <li>Whitewash and traditional plasters</li>
        <li>Lime mortar for construction and restoration</li>
        <li>Soil treatment for farming and ponds</li>
        <li>Water cleaning in villages and factories</li>
        <li>Industrial uses — see <a href="/quick-lime-rate">quicklime</a> and <a href="/hydrated-lime-rate">hydrated lime</a></li>
      </ul></div><div><h3>Supply details</h3><ul>
        <li><b>Forms:</b> lump chuna or powder</li>
        <li><b>Packaging:</b> 25/50&nbsp;kg bags, jumbo bags, loose</li>
        <li><b>MOQ:</b> from one truckload; local smaller lots on request</li>
        <li><b>Dispatch:</b> ' . e(QL_CITY) . '</li>
      </ul></div></div>'],
    ['Chuna vs hydrated lime', '<p>Construction chuna sold in bazaars is usually slaked lime of ordinary purity; industrial
      hydrated lime is the same chemistry held to a specification. If your buyer or consultant wrote Ca(OH)<sub>2</sub>
      with a purity number, quote against <a href="/hydrated-lime-rate">hydrated lime</a>; for whitewash, plaster and
      village use, ordinary chuna does the job at a lower rate.</p>'],
  ],
  'faqs' => [
    ['What is the chuna rate today?', 'The indicative ex-works rate appears above when published, excluding GST and freight. WhatsApp us the quantity and your district for a firm rate — bazaars quote per bag; we quote per ton or per bag as you prefer.'],
    ['Do you sell chuna per kg or per bag?', 'We are a manufacturer, so pricing is per ton or per bag in truckload lots. For a per-bag price at your location, tell us how many bags and where.'],
    ['Is your chuna good for whitewash?', 'Yes — fresh kiln lime slakes into bright whitewash chuna. Tell us the use and we will send the right form (lump for on-site slaking, or ready powder).'],
  ],
]);
