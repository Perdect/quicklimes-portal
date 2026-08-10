/* gst-core.test.js — the GST validator, built around one rule:
 * an invoice that is wrong must never reach a government filing.
 * Fixtures use the real shapes and GSTINs from this business's books.
 * Run: node gst-core.test.js */
const G = require('./gst-core.js');
let pass = 0, fail = 0; const bad = [];
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : (fail++, bad.push(`${n} → got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)); };
const has = (r, code) => r.issues.some(i => i.code === code);

const SELLER = { name: 'DESHWALI MINERALS', gstin: '08NLIPS9801K1Z5', state: 'Rajasthan' };
const TODAY = '2026-08-11';
/* Invoice 29 as it now stands after the party repair — a clean intra-state B2B sale. */
const GOOD = { inv: '29', date: '2026-07-01', party: 'AMAN LIME PRODUCTS', gstin: '08AMCPM0730H3ZB',
  qty: 8.26, rate: 5250, gstR: 5, hsn: '25221000', unit: 'Tonne', veh: 'RJ191R1049',
  taxable: 43365, cgst: 1084.13, sgst: 1084.13, igst: 0, total: 45533.26, interState: false,
  _partyResolve: { method: 'source_document', confidence: 0.99 } };
const ctx = extra => Object.assign({ seller: SELLER, today: TODAY }, extra || {});

/* ══ a clean invoice files ═════════════════════════════════════════ */
{
  const r = G.validate(GOOD, ctx());
  eq('CLEAN · READY', r.state, 'READY');
  eq('CLEAN · no blockers', r.blockers, 0);
  eq('CLEAN · no warnings', r.warnings, 0);
  const e = G.validate(GOOD, ctx({ forEwb: true }));
  eq('CLEAN · also READY for an E-Way Bill', e.state, 'READY');
}

/* ══ THE ONE THAT MATTERS — the bug this app actually had ══════════
   A letterhead tagline in the customer field must never be filed. */
{
  const r = G.validate({ ...GOOD, party: 'MANUFACTURES OF QUICK LIME AND HYDRATED LIME' }, ctx());
  eq('STRAPLINE · BLOCKED', r.state, 'BLOCKED');
  eq('STRAPLINE · names the reason', has(r, 'BUYER_NAME_NOT_A_NAME'), true);
  eq('STRAPLINE · explains the stake', /legal document/.test(r.issues.find(i => i.code === 'BUYER_NAME_NOT_A_NAME').fix), true);
}
/* An OCR-imported party that was never verified is not filable either. */
{
  const r = G.validate({ ...GOOD, _ocrParty: 'SOMETHING OCR READ', _partyResolve: null }, ctx());
  eq('UNVERIFIED · BLOCKED', r.state, 'BLOCKED');
  eq('UNVERIFIED · flagged', has(r, 'PARTY_UNVERIFIED'), true);
}
{ /* a weak match is a warning, not a block — it can be confirmed */
  const r = G.validate({ ...GOOD, _ocrParty: 'X', _partyResolve: { method: 'fuzzy_name', confidence: 0.72 } }, ctx());
  eq('LOW-CONF · REVIEW, not blocked', r.state, 'REVIEW');
  eq('LOW-CONF · flagged', has(r, 'PARTY_LOW_CONFIDENCE'), true);
}

/* ══ identity ═════════════════════════════════════════════════════ */
{
  eq('GSTIN · invalid buyer blocks', has(G.validate({ ...GOOD, gstin: '08ABC' }, ctx()), 'BUYER_GSTIN_INVALID'), true);
  eq('GSTIN · state code 99 blocks', has(G.validate({ ...GOOD, gstin: '99AMCPM0730H3ZB' }, ctx()), 'BUYER_GSTIN_INVALID'), true);
  const self = G.validate({ ...GOOD, gstin: SELLER.gstin }, ctx());
  eq('GSTIN · a firm cannot invoice itself', has(self, 'BUYER_IS_SELLER'), true);
  eq('  and that is a blocker', self.state, 'BLOCKED');
  const b2c = G.validate({ ...GOOD, gstin: '' }, ctx());
  eq('B2C · no GSTIN is allowed', b2c.state, 'REVIEW');
  eq('B2C · but flagged as URP', has(b2c, 'BUYER_UNREGISTERED'), true);
  eq('SELLER · missing company GSTIN blocks', has(G.validate(GOOD, ctx({ seller: { name: 'X' } })), 'SELLER_GSTIN_MISSING'), true);
}

/* ══ document ═════════════════════════════════════════════════════ */
{
  eq('DOC · no number blocks', has(G.validate({ ...GOOD, inv: '' }, ctx()), 'DOCNO_MISSING'), true);
  eq('DOC · over 16 chars blocks', has(G.validate({ ...GOOD, inv: 'A'.repeat(17) }, ctx()), 'DOCNO_TOO_LONG'), true);
  eq('DOC · a future date blocks', has(G.validate({ ...GOOD, date: '2027-01-01' }, ctx()), 'DATE_FUTURE'), true);
  eq('DOC · a junk date blocks', has(G.validate({ ...GOOD, date: '01-07-2026' }, ctx()), 'DATE_INVALID'), true);
}

/* ══ line + tax arithmetic ════════════════════════════════════════ */
{
  eq('LINE · no HSN blocks', has(G.validate({ ...GOOD, hsn: '' }, ctx()), 'HSN_MISSING'), true);
  eq('LINE · a 5-digit HSN blocks', has(G.validate({ ...GOOD, hsn: '25221' }, ctx()), 'HSN_INVALID'), true);
  eq('LINE · 4-digit HSN is fine', has(G.validate({ ...GOOD, hsn: '2522' }, ctx()), 'HSN_INVALID'), false);
  eq('LINE · zero qty blocks', has(G.validate({ ...GOOD, qty: 0 }, ctx()), 'QTY_MISSING'), true);
  /* the invoice and its own line must agree */
  eq('TAX · taxable that disagrees with qty×rate blocks',
     has(G.validate({ ...GOOD, taxable: 99999 }, ctx()), 'TAXABLE_MISMATCH'), true);
  eq('TAX · 7% is not a GST rate', has(G.validate({ ...GOOD, gstR: 7 }, ctx()), 'GSTRATE_INVALID'), true);
  eq('TAX · 0% IS a valid rate', has(G.validate({ ...GOOD, gstR: 0 }, ctx()), 'GSTRATE_INVALID'), false);
}
/* CGST+SGST vs IGST — the most common portal rejection */
{
  const inter = { ...GOOD, gstin: '24AAACI1681G1ZV', igst: 0, cgst: 1084.13, sgst: 1084.13 };
  eq('TAX · inter-state without IGST blocks', has(G.validate(inter, ctx()), 'IGST_EXPECTED'), true);
  const intra = { ...GOOD, igst: 2168.26 };
  eq('TAX · intra-state WITH IGST blocks', has(G.validate(intra, ctx()), 'IGST_UNEXPECTED'), true);
  const okInter = { ...GOOD, gstin: '24AAACI1681G1ZV', cgst: 0, sgst: 0, igst: 2168.26, interState: true };
  eq('TAX · a correct inter-state invoice passes', G.validate(okInter, ctx()).state, 'READY');
}

/* ══ transport — only checked when preparing an EWB ════════════════ */
{
  const noVeh = { ...GOOD, veh: '' };
  eq('EWB · a missing vehicle does NOT block a plain e-invoice', G.validate(noVeh, ctx()).state, 'READY');
  eq('EWB · but DOES block an E-Way Bill', has(G.validate(noVeh, ctx({ forEwb: true })), 'VEHICLE_MISSING'), true);
  eq('EWB · a malformed vehicle blocks', has(G.validate({ ...GOOD, veh: 'TRUCK-1' }, ctx({ forEwb: true })), 'VEHICLE_INVALID'), true);
  eq('EWB · real plates pass', has(G.validate({ ...GOOD, veh: 'RJ14GQ6403' }, ctx({ forEwb: true })), 'VEHICLE_INVALID'), false);
  /* both real plate shapes from this book — letters series and alphanumeric series */
  eq('EWB · alphanumeric series passes (RJ19-1R-1049)', has(G.validate({ ...GOOD, veh: 'RJ191R1049' }, ctx({ forEwb: true })), 'VEHICLE_INVALID'), false);
  /* ship-to is its own party */
  const ship = { ...GOOD, shipTo: { name: 'SOMEONE ELSE', gstin: '' } };
  eq('EWB · ship-to differing from bill-to needs its own GSTIN',
     has(G.validate(ship, ctx({ forEwb: true })), 'SHIPTO_GSTIN_MISSING'), true);
  const shipOk = { ...GOOD, shipTo: { name: 'SOMEONE ELSE', gstin: '08AAKPI9578B1ZE' } };
  eq('EWB · with a ship-to GSTIN it passes', G.validate(shipOk, ctx({ forEwb: true })).state, 'READY');
}

/* ══ eligibility — a legal question the app must not guess ═════════ */
{
  const noRules = G.ewbRequired(GOOD, {});
  eq('ELIG · no configured threshold → REVIEW, never a guess', noRules.verdict, 'REVIEW');
  eq('ELIG · and says why', /No E-Way Bill threshold configured/.test(noRules.why), true);
  eq('ELIG · below threshold', G.ewbRequired(GOOD, { threshold: 50000 }).verdict, 'NOT_REQUIRED');
  eq('ELIG · at/above threshold', G.ewbRequired(GOOD, { threshold: 40000 }).verdict, 'REQUIRED');
  eq('ELIG · exempt HSN', G.ewbRequired(GOOD, { threshold: 1, exemptHsn: ['25221000'] }).verdict, 'NOT_REQUIRED');
}

/* ══ idempotency — two clicks must never file twice ════════════════ */
{
  const a = G.requestKey('co1', '08NLIPS9801K1Z5', 'INV', '29', '2026-07-01');
  const b = G.requestKey('co1', '08nlips9801k1z5', 'INV', '29', '2026-07-01');
  eq('IDEM · the same document yields the same key regardless of case', a, b);
  eq('IDEM · a different company yields a different key', G.requestKey('co2', '08NLIPS9801K1Z5', 'INV', '29', '2026-07-01') === a, false);
  eq('IDEM · a different document number differs', G.requestKey('co1', '08NLIPS9801K1Z5', 'INV', '30', '2026-07-01') === a, false);
}

/* ══ provider — honest about NOT being connected ═══════════════════ */
{
  eq('PROV · nothing configured', G.describeProvider(null).status, 'not_configured');
  const partial = { authenticate() {}, generateIRN() {} };
  eq('PROV · a half-built adapter is incomplete, not connected', G.describeProvider(partial).status, 'incomplete');
  eq('PROV · and lists what is missing', G.describeProvider(partial).missing.indexOf('generateEWB') >= 0, true);
  const full = {}; G.PROVIDER_CONTRACT.forEach(m => { full[m] = () => {}; });
  eq('PROV · complete but not live reads configured_not_connected', G.describeProvider(full).status, 'configured_not_connected');
  full.connected = true;
  eq('PROV · only a live adapter is connected', G.describeProvider(full).connected, true);
  /* there must be no way to fake a filing */
  eq('PROV · gst-core exposes NO generate function of its own', typeof G.generateIRN, 'undefined');
  eq('PROV · and no EWB generator', typeof G.generateEWB, 'undefined');
}

/* ══ the three lifecycles stay separate ════════════════════════════ */
{
  eq('STATUS · e-invoice states', G.EINV_STATUS.indexOf('blocked') >= 0, true);
  eq('STATUS · EWB has its own states', G.EWB_STATUS.indexOf('expired') >= 0, true);
  eq('STATUS · EWB can be not_required; an e-invoice cannot be',
     G.EWB_STATUS.indexOf('not_required') >= 0 && G.EINV_STATUS.indexOf('not_required') < 0, true);
}

console.log('\n════ gst-core (validation · eligibility · provider contract) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' GST-CORE TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
