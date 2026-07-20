/* assistant-intents.test.js — the AI assistant's local engine understands more.
 *
 * "hi" used to hit the robotic capability dump; free-form questions like "cash
 * balance", "how many customers", "best month", "expenses" fell through to the
 * fallback. This runs the REAL assistAnswer out of shell.js against a mocked
 * QLD and proves each new intent answers — and that gibberish still falls back.
 *
 *   node assistant-intents.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const has = (ans, sub, m) => ok(typeof ans === 'string' && ans.toLowerCase().includes(sub.toLowerCase()), m + '  (got: ' + String(ans).replace(/<[^>]+>/g, ' ').slice(0, 90).trim() + ')');

console.log('\n═══ AI assistant · expanded local intents ═══\n');

const src = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8');
function grabFn(sig) {
  const i = src.indexOf(sig); if (i < 0) throw new Error('not found: ' + sig);
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced: ' + sig);
}

/* A mock QLD with just enough real-shaped data for the new intents. */
const Q = {
  fC: n => '₹' + Number(n || 0).toLocaleString('en-IN'),
  fmt: (n, d) => Number(n || 0).toFixed(d || 0),
  fDS: d => d, daysAgo: () => 0,
  co: { short: 'Gotan Lime', name: 'GOTAN LIME INDUSTRIES' },
  cashbookBalances: () => ({ cash: 40000, bank: 160000, upi: 0, total: 200000, count: 12 }),
  partySummary: () => ({ customers: 18, suppliers: 5 }),
  partyRows: () => Array.from({ length: 23 }, (_, i) => ({ idx: i, name: 'P' + i, type: i < 18 ? 'customer' : 'supplier', gstin: '', phone: '' })),
  salesRows: () => [
    { idx: 0, inv: 'A-1', party: 'Aziz', date: '2026-07-01', taxable: 100000, total: 118000, status: 'pending', days: 10, qty: 10 },
    { idx: 1, inv: 'A-2', party: 'Bala', date: '2026-06-01', taxable: 60000, total: 70800, status: 'paid', days: 40, qty: 6 }
  ],
  purchaseRows: () => [{ idx: 0, bill: 'B-1', sup: 'Ram', date: '2026-07-01', taxable: 50000, total: 59000, status: 'pending', days: 5, cat: 'coal' }],
  monthSeries: () => [{ m: 'Apr', sales: 300000, profit: 40000, qty: 30 }, { m: 'May', sales: 500000, profit: 90000, qty: 50 }, { m: 'Jun', sales: 200000, profit: 20000, qty: 20 }],
  getPL: () => ({ rev: 900000, cogs: 500000, gp: 400000, gpm: 44.4, labour: 80000, netGST: 60000, np: 260000, npm: 28.9 }),
  collections: () => ({ total: 118000, parties: 1, overdue: 1, rows: [{ party: 'Aziz', total: 118000, days: 10, bills: 1 }] }),
  gstSummary: () => ({ outGST: 18000, itc: 6000, net: 12000 }),
  state: { PURCHASES: [] }
};

const ctx = {
  window: { QLD: Q }, QLD: Q, console,
  esc: s => (s == null ? '' : String(s)),
  findPartyInQuery: () => null,        // these queries name no party
  _assistIntents: [],
  waLink: () => '#', closeDrawer: () => {},
  QLParty: { index: () => ({ keyOf: () => 'k', labelOf: () => 'x' }) }
};
vm.createContext(ctx);
vm.runInContext(grabFn('function assistAnswer(q)') + '\nthis.assistAnswer = assistAnswer;', ctx);
const A = ctx.assistAnswer;

/* ── greeting / help / thanks ── */
has(A('hi'), 'hello', '"hi" → a real greeting, not the capability dump');
has(A('hello there'), 'gotan lime', '  greets by company name');
ok(!A('hi').toLowerCase().includes("didn't quite catch"), '  "hi" never shows the fallback');
has(A('thanks'), 'happy to help', '"thanks" → acknowledged');
has(A('what can you do'), 'try', '"what can you do" → help with examples');
has(A('help'), 'sales this month', '"help" → tappable examples');

/* ── new data intents ── */
has(A('cash balance'), '2,00,000', '"cash balance" → total on hand');
has(A('how much money do I have'), '2,00,000', '  "how much money" also works');
has(A('how many customers'), '18', '"how many customers" → 18');
has(A('how many suppliers do I have'), '5', '"how many suppliers" → 5');
has(A('how many invoices'), '2', '"how many invoices" → count');
has(A('best month'), 'may', '"best month" → May (highest sales)');
has(A('worst month'), 'jun', '"worst month" → Jun (lowest sales)');
has(A('total sales this year'), '2026', '"total sales this year" → year total');
has(A('what are my expenses'), 'outgoings', '"expenses" → outgoings breakdown');
has(A('average invoice value'), 'average invoice', '"average invoice" → average');

/* ── existing intents still work ── */
has(A('net profit'), 'net profit', 'existing: profit still answers');
has(A('gst payable'), 'net payable', 'existing: GST still answers');

/* ── gibberish still falls back (but not for greetings/data) ── */
has(A('asdfqwer zxcv'), "didn't quite catch", 'unknown query → the (improved) fallback');

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
