/* gsp-provider.test.js — the abstraction, the two adapters, error
 * normalisation, and THE SWAP TEST.
 *
 * WHAT THIS PROVES: the ERP can drive ClearTax and Vayana through one
 * interface, with identical calling code, and every provider error arrives
 * in one internal shape.
 * WHAT THIS DOES NOT PROVE: that either provider actually works. No
 * credentials exist; nothing here touches a live host. Probing showed
 * api-sandbox.clear.in -> 504 and solo.enriched-api.vayana.com -> 503
 * unauthenticated. Live verification is BLOCKED until an account exists.
 * Run: node gsp-provider.test.js */
const GSP = require('./gsp-provider.js');
require('./gsp-adapters.js');
let pass = 0, fail = 0; const bad = [];
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : (fail++, bad.push(`${n} → got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)); };
const ok = (n, c) => { c ? pass++ : (fail++, bad.push(n)); };

/* A transport that records what the adapter tried to send and replays a
   canned response. The ADAPTER is real; only the wire is simulated. */
function recorder(responses) {
  const sent = [];
  let i = 0;
  const t = req => { sent.push(req); const r = responses[Math.min(i++, responses.length - 1)];
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r); };
  t.sent = sent;
  return t;
}
const OK = body => ({ status: 200, body, headers: {} });

/* ══ THE CONTRACT ══════════════════════════════════════════════════ */
{
  eq('CONTRACT · 12 methods', GSP.CONTRACT.length, 12);
  ['authenticate','getToken','generateEInvoice','cancelEInvoice','getEInvoice','generateEWayBill',
   'updateEWayBill','extendEWayBill','cancelEWayBill','getEWayBill','healthCheck','normalizeError']
    .forEach(m => ok('CONTRACT · includes ' + m, GSP.CONTRACT.indexOf(m) >= 0));
  eq('REGISTRY · both adapters registered', GSP._adapters().sort(), ['cleartax','vayana']);
}
/* an incomplete adapter is refused at registration, not mid-filing */
{
  GSP.register('halfbaked', () => ({ authenticate() {}, getToken() {} }));
  const r = GSP.create({ provider: 'halfbaked' });
  eq('CONTRACT · a partial adapter is refused', r.ok, false);
  eq('  with a clear reason', r.error.code, 'INCOMPLETE_ADAPTER');
  ok('  naming the gaps', /generateEInvoice/.test(r.error.message));
  eq('CONTRACT · an unknown provider is refused', GSP.create({ provider: 'nope' }).error.code, 'NO_ADAPTER');
}

/* ══ THE SWAP TEST — the whole point ═══════════════════════════════
   IDENTICAL business code. Only config changes. */
(async function main() {
  const INVOICE = { docNo: '29', docDate: '2026-07-01', buyerGstin: '08AMCPM0730H3ZB', taxable: 43365 };

  /* This function is the ERP. It names no vendor. */
  async function erpFilesInvoice(providerName, transport) {
    const r = GSP.create({ provider: providerName, env: 'sandbox', transport,
                           credentials: { authToken: 'X', jwt: 'Y', clientId: 'a', clientSecret: 'b' } });
    if (!r.ok) return { ok: false, error: r.error };
    const a = r.adapter;
    await a.authenticate();
    const gen = await a.generateEInvoice(INVOICE, { gstin: '08NLIPS9801K1Z5' });
    if (!gen.ok) return gen;
    const ewb = await a.generateEWayBill({ irn: 'IRN1', vehicleNo: 'RJ191R1049', distance: 42 }, { gstin: '08NLIPS9801K1Z5' });
    return { ok: gen.ok && ewb.ok };
  }

  const ct = recorder([OK({ irn: 'CT-IRN-1' }), OK({ ewbNo: '171CT' })]);
  const vy = recorder([OK({ access_token: 'x' }), OK({ irn: 'VY-IRN-1' }), OK({ ewbNo: '171VY' })]);

  await Promise.all([erpFilesInvoice('cleartax', ct), erpFilesInvoice('vayana', vy)]).then(([a, b]) => {
    eq('SWAP · the SAME ERP code files through ClearTax', a.ok, true);
    eq('SWAP · and through Vayana', b.ok, true);
    /* and they really did hit different vendors */
    ok('SWAP · ClearTax got api-sandbox.clear.in', ct.sent.some(r => /api-sandbox\.clear\.in/.test(r.url)));
    ok('SWAP · Vayana got solo.enriched-api.vayana.com', vy.sent.some(r => /solo\.enriched-api\.vayana\.com/.test(r.url)));
    ok('SWAP · ClearTax used its documented generate path', ct.sent.some(r => /\/einv\/v2\/eInvoice\/generate$/.test(r.url) && r.method === 'PUT'));
    ok('SWAP · Vayana used its own', vy.sent.some(r => /\/gus\/irp\/nic\/v1\/invoices$/.test(r.url) && r.method === 'POST'));
    /* the ERP function above contains no vendor name — that is the proof */
    ok('SWAP · the ERP function names no vendor', !/cleartax|vayana|clear\.in/i.test(erpFilesInvoice.toString().replace(/providerName/g, '')));

    /* ══ ERROR NORMALISATION ══════════════════════════════════════ */
    const cases = [
      ['duplicate (NIC 2150)', { status: 400, body: { errors: [{ code: '2150', message: 'Duplicate IRN' }] } }, 'DUPLICATE', false],
      ['auth 401',             { status: 401, body: { message: 'bad token' } },                                 'AUTH', false],
      ['rate limit 429',       { status: 429, body: {} },                                                       'RATE_LIMIT', true],
      ['provider 503',         { status: 503, body: {} },                                                       'PROVIDER', true],
      ['validation 400',       { status: 400, body: { errors: [{ code: '2172', message: 'Invalid HSN' }] } },    'VALIDATION', false]
    ];
    const runs = cases.map(([label, res, cat, retry]) => {
      const t = recorder([res]);
      const r = GSP.create({ provider: 'cleartax', transport: t, credentials: { authToken: 'X' } });
      return r.adapter.generateEInvoice({}, {}).then(out => {
        eq('ERR · ' + label + ' → ' + cat, out.error.category, cat);
        eq('ERR · ' + label + ' retryable=' + retry, out.error.retryable, retry);
        ok('ERR · ' + label + ' keeps the raw payload for audit', out.error.rawResponse != null);
        ok('ERR · ' + label + ' has a human message', out.error.message.length > 20 && !/undefined/.test(out.error.message));
      });
    });

    /* a thrown transport error is NETWORK, and must warn about re-filing */
    const boom = recorder([new Error('ECONNRESET')]);
    const r2 = GSP.create({ provider: 'vayana', transport: boom, credentials: { jwt: 'y' } });
    runs.push(r2.adapter.getEInvoice('IRN', {}).then(out => {
      eq('ERR · a dropped connection is NETWORK', out.error.category, 'NETWORK');
      eq('  and retryable', out.error.retryable, true);
      ok('  and warns the document may already be filed', /may or may not have been filed/.test(out.error.message));
    }));

    /* NO transport configured must fail loudly, never silently succeed */
    const r3 = GSP.create({ provider: 'cleartax', credentials: { authToken: 'X' } });
    runs.push(r3.adapter.generateEInvoice({}, {}).then(out => {
      eq('ERR · no transport = explicit failure', out.ok, false);
      eq('  code', out.error.code, 'NO_TRANSPORT');
      ok('  and says nothing was sent', /nothing was sent/i.test(out.error.message));
    }));

    /* a malformed provider response must not crash the ERP */
    const junk = recorder([{ status: 500, body: 'not json at all' }]);
    const r4 = GSP.create({ provider: 'cleartax', transport: junk, credentials: { authToken: 'X' } });
    runs.push(r4.adapter.generateEInvoice({}, {}).then(out => {
      eq('ERR · a malformed response is handled, not thrown', out.ok, false);
      eq('  categorised', out.error.category, 'PROVIDER');
    }));

    return Promise.all(runs);
  }).then(() => {
    /* ══ CREDENTIAL SAFETY ═════════════════════════════════════════ */
    const red = GSP.redact({ 'X-Cleartax-Auth-Token': 'super-secret', Authorization: 'Bearer abc', gstin: '08NLIPS9801K1Z5', 'Content-Type': 'application/json' });
    eq('SEC · auth token redacted', red['X-Cleartax-Auth-Token'], '[redacted]');
    eq('SEC · bearer redacted', red.Authorization, '[redacted]');
    eq('SEC · GSTIN is NOT a secret and survives', red.gstin, '08NLIPS9801K1Z5');
    eq('SEC · content-type survives', red['Content-Type'], 'application/json');
    /* no adapter may echo a raw credential back */
    const r = GSP.create({ provider: 'cleartax', credentials: { authToken: 'SECRET123' } });
    return r.adapter.getToken().then(t => {
      eq('SEC · getToken never returns the real token', t.token, '[redacted]');
      ok('SEC · adapter source contains no hardcoded credential',
         !/SECRET|password|Bearer [A-Za-z0-9]{8}/.test(require('fs').readFileSync(__dirname + '/gsp-adapters.js', 'utf8')));
    });
  }).then(() => {
    /* ══ HONEST CAPABILITY REPORTING ══════════════════════════════ */
    const ct = GSP.create({ provider: 'cleartax', credentials: {} }).adapter;
    const vy = GSP.create({ provider: 'vayana', credentials: {} }).adapter;
    eq('CAP · ClearTax has NO health endpoint and says so', ct.capabilities.healthCheck, false);
    eq('CAP · Vayana does', vy.capabilities.healthCheck, true);
    eq('CAP · ClearTax offers the govt schema', ct.capabilities.govtSchema, true);
    eq('CAP · Vayana does not', vy.capabilities.govtSchema, false);
    return ct.healthCheck().then(h => {
      eq('CAP · ClearTax healthCheck reports unsupported, not a fake green', h.unsupported, true);
      eq('  and never claims ok', h.ok, false);
    });
  }).then(() => {
    /* ══ NOT CONNECTED UNTIL PROVEN ═══════════════════════════════ */
    eq('HONEST · cleartax is configured but NOT connected', GSP.describe({ provider: 'cleartax' }).status, 'configured_not_connected');
    eq('HONEST · and connected is false', GSP.describe({ provider: 'cleartax' }).connected, false);
    eq('HONEST · vayana likewise', GSP.describe({ provider: 'vayana' }).connected, false);
    eq('HONEST · an unregistered provider is not_configured', GSP.describe({ provider: 'iris' }).status, 'not_configured');

    console.log('\n════ gsp-provider (abstraction · adapters · SWAP TEST) ════');
    console.log('  Passed: ' + pass + '   Failed: ' + fail);
    bad.forEach(b => console.log('    ✗ ' + b));
    console.log('\n  NOTE: no live provider call was made — no credentials exist.');
    console.log('  This proves the SHAPE is right, not that the wire works.');
    console.log(fail === 0 ? '\n✅ ALL ' + pass + ' GSP-PROVIDER TESTS PASSED\n' : '\n❌ FAILED\n');
    process.exit(fail === 0 ? 0 : 1);
  });
})();
