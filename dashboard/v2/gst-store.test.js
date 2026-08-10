/* gst-store.test.js — compliance records: the state machine, immutability
 * of a government reference, and idempotency.
 * The rule under test: nothing may claim a filing happened unless the
 * government said so, and nothing may erase that proof afterwards.
 * Run: node gst-store.test.js */
const ST = require('./gst-store.js');
const G = require('./gst-core.js');
let pass = 0, fail = 0; const bad = [];
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : (fail++, bad.push(`${n} → got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)); };

const base = { companyId: 'desh', gstin: '08NLIPS9801K1Z5', invoiceRef: 'S29', docNo: '29', docDate: '2026-07-01' };
const mk = k => ST.newRecord(k, base);

/* ══ THE CORE SAFETY RULE ══════════════════════════════════════════
   "generated" is a claim that a government document exists. It may not
   be made without the reference that proves it. */
{
  const r = mk('einvoice');
  ST.transition(r, 'ready', {}); ST.transition(r, 'generating', {});
  const bare = ST.transition(r, 'generated', {});
  eq('SAFETY · cannot mark generated with no reference', bare.ok, false);
  eq('SAFETY · and says why', /nothing came back to prove it was filed/.test(bare.err), true);
  eq('SAFETY · status is unchanged', r.status, 'generating');

  const real = ST.transition(r, 'generated', { gov: { irn: 'IRN123', ackNo: '112', ackDate: '2026-07-01' }, at: 'T1', by: 'haji' });
  eq('SAFETY · with a real IRN it succeeds', real.ok, true);
  eq('SAFETY · status advances', r.status, 'generated');
  eq('SAFETY · the reference is stored', r.gov.irn, 'IRN123');
}

/* ══ A GOVERNMENT REFERENCE IS IMMUTABLE ═══════════════════════════ */
{
  const r = mk('einvoice');
  ST.transition(r, 'ready', {}); ST.transition(r, 'generating', {});
  ST.transition(r, 'generated', { gov: { irn: 'FIRST' } });
  /* a second filing cannot overwrite the proof of the first */
  ST.transition(r, 'cancelled', {});
  const again = ST.transition(r, 'generated', { gov: { irn: 'SECOND' } });
  eq('IMMUTABLE · cancelled is final, no re-generate', again.ok, false);
  eq('IMMUTABLE · the original IRN survives', r.gov.irn, 'FIRST');
}
{
  /* even mid-flight, a stored reference cannot be replaced */
  const r = mk('ewb');
  ST.transition(r, 'ready', {}); ST.transition(r, 'generating', {});
  ST.transition(r, 'generated', { gov: { ewbNo: '171000111222' } });
  ST.transition(r, 'expired', {});
  eq('IMMUTABLE · an expired EWB keeps its number', r.gov.ewbNo, '171000111222');
}

/* ══ THE STATE MACHINE REFUSES UNDECLARED MOVES ════════════════════ */
{
  const r = mk('einvoice');
  const jump = ST.transition(r, 'generated', { gov: { irn: 'X' } });
  eq('MACHINE · cannot leap straight to generated', jump.ok, false);
  eq('MACHINE · and lists what IS allowed', /only ready, blocked, not_applicable/.test(jump.err), true);
  eq('MACHINE · status untouched', r.status, 'not_generated');

  const c = mk('einvoice');
  ST.transition(c, 'ready', {}); ST.transition(c, 'generating', {});
  ST.transition(c, 'generated', { gov: { irn: 'A' } });
  ST.transition(c, 'cancelled', {});
  eq('MACHINE · cancelled is terminal', ST.transition(c, 'ready', {}).ok, false);
}
{ /* EWB has states an e-invoice does not */
  const e = mk('ewb');
  eq('MACHINE · an EWB can be marked not_required', ST.transition(e, 'not_required', {}).ok, true);
  eq('MACHINE · an e-invoice cannot', ST.transition(mk('einvoice'), 'not_required', {}).ok, false);
  const e2 = ST.newRecord('ewb', base); e2.status = 'not_required';
  eq('MACHINE · and can come back from it', ST.transition(e2, 'not_generated', {}).ok, true);
}

/* ══ FAILURE IS RECORDED, NOT SWALLOWED ════════════════════════════ */
{
  const r = mk('einvoice');
  ST.transition(r, 'ready', {}); ST.transition(r, 'generating', {});
  ST.transition(r, 'failed', { code: '2150', message: 'Duplicate IRN', at: 'T2' });
  eq('FAIL · the error is kept', r.lastError.code, '2150');
  eq('FAIL · with the government wording', r.lastError.message, 'Duplicate IRN');
  eq('FAIL · and a retry is allowed', ST.transition(r, 'generating', {}).ok, true);
  eq('FAIL · attempts are counted', r.attempts, 2);
}

/* ══ IDEMPOTENCY — two clicks, one filing ══════════════════════════ */
{
  const filed = mk('einvoice');
  filed.status = 'generated'; filed.gov = { irn: 'ALREADY' };
  const fresh = mk('einvoice');                     // same company + doc + date
  eq('IDEM · the same document shares a request key', fresh.requestKey, filed.requestKey);
  const g = ST.guard([filed], fresh);
  eq('IDEM · a second attempt is refused', g.proceed, false);
  eq('IDEM · because it is already filed', g.reason, 'already_generated');
  eq('IDEM · and it hands back the existing record', g.existing.gov.irn, 'ALREADY');

  const flying = mk('einvoice'); flying.status = 'generating';
  eq('IDEM · an in-flight filing blocks a second', ST.guard([flying], mk('einvoice')).reason, 'in_flight');

  const other = ST.newRecord('einvoice', Object.assign({}, base, { docNo: '30' }));
  eq('IDEM · a DIFFERENT document proceeds', ST.guard([filed], other).proceed, true);
}

/* ══ prepare() — the gate, in the right order ══════════════════════ */
{
  const seller = { name: 'DESHWALI MINERALS', gstin: '08NLIPS9801K1Z5' };
  const GOOD = { inv: '29', date: '2026-07-01', party: 'AMAN LIME PRODUCTS', gstin: '08AMCPM0730H3ZB',
    qty: 8.26, rate: 5250, gstR: 5, hsn: '25221000', unit: 'Tonne', veh: 'RJ191R1049',
    taxable: 43365, cgst: 1084.13, sgst: 1084.13, igst: 0, interState: false,
    _partyResolve: { method: 'source_document', confidence: 0.99 } };
  const live = {}; G.PROVIDER_CONTRACT.forEach(m => { live[m] = () => {}; }); live.connected = true;

  /* a bad invoice is rejected BEFORE the provider is even consulted */
  const bad = ST.prepare(mk('einvoice'),
    { ...GOOD, party: 'MANUFACTURES OF QUICK LIME AND HYDRATED LIME' },
    { seller, today: '2026-08-11', records: [], provider: live });
  eq('GATE · a bad invoice stops at validation', bad.stage, 'validation');
  eq('GATE · not at the provider', bad.ok, false);

  /* a good invoice with NO provider is honestly reported as such */
  const noProv = ST.prepare(mk('einvoice'), GOOD, { seller, today: '2026-08-11', records: [], provider: null });
  eq('GATE · no provider is its own stage', noProv.stage, 'provider');
  eq('GATE · and names the status', /not_configured/.test(noProv.err), true);

  /* everything in place → proceed */
  const ok = ST.prepare(mk('einvoice'), GOOD, { seller, today: '2026-08-11', records: [], provider: live });
  eq('GATE · a clean invoice with a live provider proceeds', ok.ok, true);
  eq('GATE · carrying its validation result', ok.validation.state, 'READY');

  /* already filed → refused at idempotency, after validation passed */
  const filed = mk('einvoice'); filed.status = 'generated'; filed.gov = { irn: 'X' };
  const dup = ST.prepare(mk('einvoice'), GOOD, { seller, today: '2026-08-11', records: [filed], provider: live });
  eq('GATE · a duplicate stops at idempotency', dup.stage, 'idempotency');
}

/* ══ HISTORY IS NEVER LOST ═════════════════════════════════════════ */
{
  const r = mk('einvoice');
  ST.transition(r, 'ready', { at: 'T1', by: 'haji' });
  ST.transition(r, 'generating', { at: 'T2', by: 'haji' });
  ST.transition(r, 'failed', { at: 'T3', code: '1', message: 'timeout' });
  eq('AUDIT · every move is logged', r.history.length, 3);
  eq('AUDIT · with who and when', r.history[0].by + '@' + r.history[0].at, 'haji@T1');
  eq('AUDIT · and the transition itself', r.history[1].from + '→' + r.history[1].to, 'ready→generating');
  /* a retry storm cannot erase the original filing */
  for (let i = 0; i < 400; i++) { ST.transition(r, 'generating', { at: 'x' }); ST.transition(r, 'failed', { at: 'x' }); }
  eq('AUDIT · history is bounded', r.history.length <= 200, true);
  eq('AUDIT · but the FIRST entries survive', r.history[0].to, 'ready');
}

console.log('\n════ gst-store (compliance records) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' GST-STORE TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
