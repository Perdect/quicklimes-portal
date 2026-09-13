/* customers-wired.test.js — Customer 360° is reachable, loaded in the right
   order, stored where it is gated, and its pages use one vocabulary.

   The dominant bug class in this codebase is "built but never connected":
   a page that never loads the module it calls, a store that never reaches
   blob(), a nav item that points at a page that no longer exists. This pins
   the wiring; the maths are in customer-core.test.js, the writes in
   customer-store.test.js.

     node customers-wired.test.js
*/
'use strict';
const fs = require('fs'), path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

const shell = R('shell.js'), data = R('data.js'), qlx = R('qlx.js'), db = R('../api/db.php'), caps = R('../api/blob-caps.test.php');
const wsHtml = R('customers.html'), prHtml = R('customer.html'), ws = R('customers.js'), pr = R('customer.js'), ui = R('crm-ui.js'), store = R('customer-store.js'), core = R('customer-core.js'), doc = R('quote-doc.js'), api = R('../api/quote.php');
const bare = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ');

console.log('\n═══ Customer 360° · wired ═══\n');

/* ── reachable ── */
ok(/id: 'customers',\s+label: 'Customers',\s+href: 'customers\.html'/.test(shell), 'the sidebar Customers item opens the workspace (customers.html)');
ok(/id: 'pipeline',\s+label: 'Sales Pipeline',\s+href: 'customers\.html#pipeline'/.test(shell), 'Sales Pipeline opens the workspace on its Pipeline tab');
ok(!fs.existsSync(path.join(__dirname, 'pipeline.html')) && !fs.existsSync(path.join(__dirname, 'crm-data.js')) && !fs.existsSync(path.join(__dirname, 'crm360.css')), 'the parallel implementation (pipeline.html, crm-data.js, crm360.css) is gone');
ok(!/crm360|crm-data\.js|crm-docs\.js/.test(wsHtml + prHtml + R('parties.html')), '  and no page still references it');

/* ── the pages load what they use, in order ── */
for (const [name, html] of [['customers.html', wsHtml], ['customer.html', prHtml]]) {
  const order = ['data.js', 'shell.js', 'qlx.js', 'customer-core.js', 'customer-store.js', 'quote-doc.js', 'crm-ui.js', name === 'customers.html' ? 'customers.js' : 'customer.js'];
  const idx = order.map(f => html.indexOf('src="./' + f));
  ok(idx.every(i => i > 0), name + ' loads ' + order.join(', '));
  ok(idx.every((v, i) => i === 0 || v > idx[i - 1]), '  in dependency order (data → shell → qlx → core → store → doc → ui → page)');
  ok(/customers\.css\?v=/.test(html) && /crm\.css\?v=/.test(html), '  with customers.css and crm.css');
  ok(/<\/head>/.test(html) && /<body class="ql-v2">/.test(html) && /<div id="ql-page">/.test(html), '  and the shell\'s page skeleton');
}
ok(/customer-core\.js\?v=/.test(R('parties.html')), 'parties.html (suppliers / all parties) loads the core for the shared party form');
ok(/if \(!window\.CustomerCore && !openPartyForm\._loading\)/.test(shell), 'the shell pulls the core on demand when another page opens the party form');

/* ── one global each, no collisions ── */
ok(/root\.CustomerCore = api/.test(core) && /window\.QLCRM = \{/.test(store) && /window\.CRMUI = \{/.test(ui) && /root\.QuoteDoc = api/.test(doc), 'globals: CustomerCore · QLCRM · CRMUI · QuoteDoc');
ok((store.match(/window\.QLCRM = /g) || []).length === 1 && !/window\.QLCRM = /.test(core), '  QLCRM is defined exactly once');

/* ── the stores reach the blob and are gated ── */
const S = ['reqs', 'quotes', 'offers', 'deals', 'followups', 'cnotes', 'ctimeline', 'msgTemplates'];
ok(/REQS: \[\], QUOTES: \[\], OFFERS: \[\], DEALS: \[\], FOLLOWUPS: \[\], CNOTES: \[\], CTIMELINE: \[\], MSG_TEMPLATES: \[\]/.test(data), 'data.js declares the eight stores');
ok(S.every(k => new RegExp('if \\(Array\\.isArray\\(d\\.' + k + '\\)\\) S\\.[A-Z_]+\\.push').test(data)), '  hydrate() restores every one');
const blobSrc = data.slice(data.indexOf('function blob(includePic)'), data.indexOf('function saveLocal'));
ok(S.every(k => new RegExp('\\b' + k + ': S\\.[A-Z_]+').test(blobSrc)), '  blob() saves every one (the whitelist)');
ok(/'REQS', 'QUOTES', 'OFFERS', 'DEALS', 'FOLLOWUPS', 'CNOTES', 'CTIMELINE', 'MSG_TEMPLATES'\]\.forEach\(k => \{ S\[k\]\.length = 0; \}\)/.test(data), '  clearState() empties every one on company switch');
ok(S.every(k => new RegExp("'" + k + "' => 'sales'").test(db)), '  db.php gates every one on the sales capability');
ok(S.every(k => new RegExp("'" + k + "'\\s+=> 'sales'").test(caps)), '  and blob-caps.test.php declares the decision');
ok(/attachPartyDoc/.test(data) && /parties: 'ql_party_docs'/.test(data) && /fetchDocBlob,/.test(data), 'customer documents use the shared document store (IndexedDB + /api/files)');
ok(/addDocMeta/.test(store) && /Q\.attachPartyDoc\(idx, file/.test(store), '  and the CRM store records the metadata on the customer');

/* ── every row names its customer by stable id, never by index ── */
ok(/cust,/.test(store) && !/cust: idx\b/.test(store), 'store rows carry cust = party id');
ok(/function ensureIds\(\)/.test(store) && /C\.nextCode\(S\.PARTIES\)/.test(store), '  old parties get an id and a customer code once');
ok(/'customer\.html\?id=' \+ encodeURIComponent\(id\)/.test(ws), 'list → profile by id');
ok(/qp\('id'\)/.test(pr) && /M\.byId\(ID\)/.test(pr), 'profile resolves ?id through the store');

/* ── the spec's vocabulary comes from ONE place ── */
ok(/CustomerCore\.CUSTOMER_TYPES/.test(shell) && /CustomerCore\.CUSTOMER_STATUS/.test(shell) && /CustomerCore\.PAYMENT_TERMS/.test(shell) && /CustomerCore\.TRANSPORT/.test(shell), 'the shared party form reads types / statuses / terms / transport from CustomerCore');
ok(['ctype', 'cstatus', 'contact', 'email', 'altContact', 'city', 'country', 'pin', 'pan', 'iec', 'code', 'payTerms', 'transport', 'deliveryLoc', 'since', 'salesperson'].every(k => new RegExp("\\{ k: '" + k + "'").test(shell)), '  and carries every customer-master field');
ok(/PARTY_SPECS\.forEach\(f => \{ const k = f\.k;/.test(shell), '  a NEW party keeps every spec field (no second list to forget)');
ok(!/QLCRM\.CUSTOMER_TYPES|QLCRM\.STATUSES|QLCRM\.PAY_TERMS/.test(shell), '  nothing reads the old crm-data vocabulary');
ok(/salesperson: p\.salesperson \|\| '', cstatus: p\.cstatus \|\| ''/.test(data), 'partyRows() exposes the master fields under the store\'s names');

/* ── the workspace ── */
ok(/const TABS = \[\['customers', 'Customers'\], \['pipeline', 'Pipeline'\], \['followups', 'Follow-ups'\], \['quotes', 'Quotations'\], \['offers', 'Offers'\]\]/.test(ws), 'five tabs: customers · pipeline · follow-ups · quotations · offers');
ok(/QLX\.remount\(CFG\[t\]\(\)\)/.test(ws), '  switching a tab remounts the register in place');
ok(['ctype', 'city', 'seg', 'health', 'monthlyDemand', 'salesLast', 'salesAmt', 'salesDue', 'openQuotes', 'salesperson', 'lastActivity', 'statusEff'].every(k => new RegExp("\\{ key: '" + k + "', label: ").test(ws)), '  list columns: type, city, segment, health, monthly demand, last order, total sales, outstanding, open quote, sales person, last activity, status');
ok(/views: \['table', 'cards', 'board', 'analytics'\]/.test(ws), '  list views: table · cards · kanban · analytics');
ok(/bulkActions: \[/.test(ws) && /Assign sales person/.test(ws) && /Set status/.test(ws) && /Add segment tag/.test(ws) && /Export selected/.test(ws), '  bulk actions: assign, status, tag, follow-up, export');
ok(/'Total customers'/.test(ws) && /'Active'/.test(ws) && /'New'/.test(ws) && /'Monthly sales'/.test(ws) && /'Monthly potential'/.test(ws) && /'Outstanding'/.test(ws) && /'Open quotations'/.test(ws) && /'Conversion'/.test(ws) && /'At risk'/.test(ws), '  the nine dashboard cards the spec names');
ok(/C\.portfolioInsights\(rows\(\), today\(\)\)/.test(ws) && /data-insight=/.test(ws), '  AI insights come from the core and are clickable');
ok(/onOpen: r => \{ location\.href = profile\(r\.id\); return true; \}/.test(ws) && /if \(CFG\.onOpen\)/.test(qlx), '  clicking a customer opens the profile page (QLX onOpen hook)');
ok(/status: \{ options: C\.STAGES\.map/.test(ws) && /set: \(r, k\) =>/.test(ws) && /function wireBoardDrag/.test(qlx) && /draggable="true"/.test(qlx), '  the pipeline board is drag-and-drop through QLX status.set');
ok(/quickDefault: 'open'/.test(ws) && /CFG\.quickDefault \|\| 'all'/.test(qlx), '  pipeline / follow-ups / quotations open on "Open"');
ok(/views: \['table', 'board', 'calendar'\]/.test(ws), '  follow-ups have a calendar view');
ok(/id="cuQuickBtn"/.test(ws) && /U\.quickMenu\(qb\)/.test(ws) && /const QUICK = \[/.test(ui) && ['Add customer', 'Add requirement', 'New quotation', 'Send price offer', 'Record order', 'Record payment', 'Follow-up', 'WhatsApp', 'Export customers'].every(l => ui.includes("label: '" + l + "'")), '  quick actions: the nine the spec names, from anywhere in the CRM');

/* ── the profile ── */
ok(['overview', 'reqs', 'quotes', 'prices', 'timeline', 'followups', 'comm', 'notes', 'docs', 'finance'].every(t => new RegExp("\\['" + t + "', '").test(pr)), 'ten profile tabs');
ok(['Total orders', 'Total sales', 'Outstanding', 'Last order', 'Average order', 'Monthly requirement', 'Open quotations', 'Conversion'].every(l => pr.includes("['" + l + "'")), '  the eight summary cards');
ok(/\['quote', 'New quotation'/.test(pr) && /'offer', 'Send price offer'/.test(pr) && /'order', 'Record order'/.test(pr) && /'payment', 'Record payment'/.test(pr) && /'req', 'Add requirement'/.test(pr) && /'followup', 'Add follow-up'/.test(pr), '  quick actions in the header');
ok(/C\.timeline\(f, M\.eventsOf\(ID\), today\(\)\)/.test(pr) && /C\.filterTimeline\(all, \{ q: TL\.q, kind: TL\.kind \}\)/.test(pr), '  timeline merges log + registers, searchable and filterable');
ok(/C\.customerInsights\(f, today\(\)\)/.test(pr), '  "what should I do next" comes from the core');
ok(/C\.priceHistory\(f\.invoices, f\.quotes, f\.offers, PH_PRODUCT/.test(pr), '  price history per product');
ok(/private, never sent to the customer/.test(ui) && /private: true/.test(store), '  notes are private');

/* ── quotations: one maths, one paper ── */
ok(/C\.quoteTotals\(/.test(doc) && !/\* rate|qty \* /.test(bare(doc).replace(/quoteTotals/g, '')), 'quote-doc.js never re-adds a total — it asks the core');
ok(/function paintTotals/.test(ui) && /C\.quoteTotals\(q\)/.test(ui), '  the editor shows the same totals live');
ok(['wa', 'mail', 'link', 'print', 'dup', 'revise', 'order'].every(a => ui.includes('data-a="' + a + '"')), '  document actions: WhatsApp, email, copy link, PDF/print, duplicate, revise, record order');
ok(/M\.setQuoteStatus\(q\.id, 'sent', \{ via \}\)/.test(ui), '  sending marks it Sent with the channel');
ok(/function reviseQuote/.test(store) && /q\.status = 'expired'; q\.supersededBy = n\.id/.test(store), '  a revision closes the old quotation');
ok(/action === 'link'/.test(api) && /hash_hmac\('sha256'/.test(api) && /hash_equals\(/.test(api) && /quote_views/.test(api) && /QuoteDoc\.quotationHTML/.test(api), 'the customer link is signed, counted, and rendered by the same QuoteDoc');
ok(/function syncViews/.test(ui) && /'viewed'/.test(ui), '  an opened link marks the quotation Viewed');

/* ── offers and messages never claim delivery ── */
ok(/logged as "sent by the user", never as\s+"delivered"/.test(ui) && !/delivered to the customer|replied/.test(bare(ui)), 'no message is ever reported as delivered or replied');
ok(/Send WhatsApp/.test(ui) && /Send Email/.test(ui) && /Generate PDF/.test(ui) && /Save offer/.test(ui), '  the offer composer has WhatsApp / Email / PDF / Save');
ok(/'tpl_offer'/.test(core) && /\{\{customer_name\}\}/.test(core) && /function fillTemplate/.test(core), '  templates with {{variables}} live in the core');

/* ── orders and payments go through the books, not a copy ── */
ok(/Q\.addSale\(sale\)/.test(store) && /Q\.receiveSalesPayment\(/.test(store) && /Q\.recordLedgerEntry\(/.test(store), 'orders and payments post to the existing registers');
ok(/custId: p\.id, quoteId: link\.quoteId/.test(store), '  and the invoice remembers its customer and quotation');
ok(/URLSearchParams\(location\.search\)\.get\('party'\)/.test(R('invoice.js')), '  the GST Invoice page accepts ?party= for the full invoice route');

/* ── local stack safety ── */
ok(/h === 'localhost' \|\| h === '127\.0\.0\.1'/.test(R('ql-api.js')), 'a localhost session talks to the local API, never production');

console.log((fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
