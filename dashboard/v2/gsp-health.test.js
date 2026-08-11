/* gsp-health.test.js — provider status honesty, and the retry policy that
 * stops a dropped connection becoming a duplicate statutory filing.
 * Run: node gsp-health.test.js */
const H = require('./gsp-health.js');
let pass = 0, fail = 0; const bad = [];
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : (fail++, bad.push(`${n} → got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)); };
const ok = (n, c) => { c ? pass++ : (fail++, bad.push(n)); };

/* ══ NEVER A FALSE GREEN ═══════════════════════════════════════════
   ClearTax has no health endpoint. With no recent successful call the
   only honest answer is UNKNOWN — and UNKNOWN must not render as ok. */
{
  const ct = H.assess({ configured: true, supportsHealth: false, provider: 'cleartax' });
  eq('CLEARTAX · no probe, no recent success → UNKNOWN', ct.status, 'UNKNOWN');
  eq('  never green', ct.tone === 'ok', false);
  eq('  and never claims verified', ct.verified, false);
  ok('  says it cannot be confirmed', /cannot be confirmed/.test(ct.detail));
  /* but it must still be usable — blocking on "cannot verify" would make
     ClearTax unusable entirely */
  eq('  filing is still allowed', ct.canFile, true);

  /* a RECENT real success is the only evidence that earns CONNECTED */
  const fresh = H.assess({ configured: true, supportsHealth: false, lastSuccessAgeMs: 60000 });
  eq('CLEARTAX · a recent successful filing earns CONNECTED', fresh.status, 'CONNECTED');
  eq('  and is marked verified', fresh.verified, true);
  ok('  citing why', /last successful filing/.test(fresh.because));
  /* evidence expires */
  const stale = H.assess({ configured: true, supportsHealth: false, lastSuccessAgeMs: 60 * 60 * 1000 });
  eq('CLEARTAX · an hour-old success is no longer proof', stale.status, 'UNKNOWN');
}

/* ══ VAYANA — a real probe, and it separates the two failures ══════ */
{
  const up = H.assess({ configured: true, supportsHealth: true, probe: { ok: true, latencyMs: 300 } });
  eq('VAYANA · healthy probe → CONNECTED', up.status, 'CONNECTED');
  eq('  verified by the probe', up.verified, true);

  const gstn = H.assess({ configured: true, supportsHealth: true, probe: { ok: true, gstnDown: true } });
  eq('VAYANA · provider up but GSTN down is its OWN status', gstn.status, 'GSTN_DOWN');
  ok('  and says nothing can be filed', /Nothing can be filed/.test(gstn.detail));

  const slow = H.assess({ configured: true, supportsHealth: true, probe: { ok: true, latencyMs: 9000 } });
  eq('VAYANA · a slow probe is DEGRADED, not down', slow.status, 'DEGRADED');
  eq('  still fileable', slow.canFile, true);

  const down = H.assess({ configured: true, supportsHealth: true, probe: { error: { category: 'NETWORK' } } });
  eq('VAYANA · unreachable → PROVIDER_DOWN', down.status, 'PROVIDER_DOWN');
  eq('  and filing stops', down.canFile, false);
}

/* ══ auth and configuration ════════════════════════════════════════ */
{
  eq('AUTH · rejected credentials outrank everything', H.assess({ configured: true, supportsHealth: true, lastError: { category: 'AUTH' } }).status, 'AUTH_FAILED');
  eq('CONFIG · nothing configured', H.assess({ configured: false }).status, 'NOT_CONFIGURED');
  eq('CONFIG · and cannot file', H.assess({ configured: false }).canFile, false);
  /* every status has copy — a status with no words is a status nobody acts on */
  H.STATUS.forEach(s => ok('COPY · ' + s + ' has a label and detail', H.LABEL[s] && H.LABEL[s].text && H.LABEL[s].detail.length > 15));
}

/* ══ THE CRITICAL TEST — a dropped connection on a GENERATE ═════════
   The IRP may already hold the IRN. Retrying blind mints a second
   statutory document for one sale. */
{
  const drop = { category: 'NETWORK', retryable: true };
  const gen = H.retryPlan('generateEInvoice', drop, 1);
  eq('DROP · generate does NOT retry', gen.retry, false);
  eq('DROP · it reconciles instead', gen.action, 'reconcile');
  ok('DROP · and explains the stake', /second statutory record/.test(gen.why));

  const ewb = H.retryPlan('generateEWayBill', drop, 1);
  eq('DROP · same for the E-Way Bill', ewb.action, 'reconcile');

  /* a READ is safe to repeat — nothing is created */
  const read = H.retryPlan('getEInvoice', drop, 1);
  eq('DROP · a read DOES retry', read.retry, true);
  ok('  with backoff', read.delayMs > 0);
}

/* ══ the other error categories ════════════════════════════════════ */
{
  const dup = H.retryPlan('generateEInvoice', { category: 'DUPLICATE' }, 1);
  eq('DUP · never retried', dup.retry, false);
  eq('DUP · but reconciled — fetch what exists', dup.reconcile, true);
  ok('DUP · and says do not file again', /do not file again/i.test(dup.why));

  const val = H.retryPlan('generateEInvoice', { category: 'VALIDATION' }, 1);
  eq('VALIDATION · never retried', val.retry, false);
  eq('VALIDATION · and nothing to reconcile', val.reconcile, false);
  ok('VALIDATION · explains why repeating is pointless', /fails identically/.test(val.why));

  const auth = H.retryPlan('generateEInvoice', { category: 'AUTH' }, 1);
  eq('AUTH · re-authenticates rather than repeating', auth.action, 'reauth');
  eq('AUTH · does not retry the dead call', auth.retry, false);

  const rate = H.retryPlan('getEInvoice', { category: 'RATE_LIMIT' }, 1);
  eq('RATE · a read backs off and retries', rate.retry, true);

  /* backoff grows, and stops */
  const a1 = H.retryPlan('getEInvoice', { category: 'PROVIDER' }, 1);
  const a3 = H.retryPlan('getEInvoice', { category: 'PROVIDER' }, 3);
  ok('BACKOFF · grows with attempts', a3.delayMs > a1.delayMs);
  const a4 = H.retryPlan('getEInvoice', { category: 'PROVIDER' }, 4);
  eq('BACKOFF · stops after 4 rather than hammering', a4.retry, false);

  /* an unrecognised error must fail SAFE on a create */
  const wat = H.retryPlan('generateEInvoice', { category: 'UNKNOWN' }, 1);
  eq('UNKNOWN · never retried on a create', wat.retry, false);
  eq('UNKNOWN · and reconciled, because the outcome is unknown', wat.reconcile, true);
}

/* ══ reconciliation — ask before filing again ══════════════════════ */
{
  const have = H.reconcilePlan({ kind: 'einvoice', gov: { irn: 'IRN1' } });
  eq('RECON · already holding a reference → nothing to do', have.action, 'already_have');

  const inv = H.reconcilePlan({ kind: 'einvoice' });
  eq('RECON · e-invoice looks up by document number', inv.method, 'getEInvoice');
  eq('  keyed on docNo', inv.by, 'docNo');
  ok('  and says why', /before generating another/.test(inv.why));

  const ewb = H.reconcilePlan({ kind: 'ewb' });
  eq('RECON · EWB uses its own lookup', ewb.method, 'getEWayBill');
}

/* ══ the full incident, end to end ═════════════════════════════════ */
{
  /* generate → connection drops → policy says reconcile → lookup finds an
     IRN already exists → we store it and never file twice */
  const plan = H.retryPlan('generateEInvoice', { category: 'NETWORK' }, 1);
  eq('INCIDENT · step 1: do not retry', plan.retry, false);
  eq('INCIDENT · step 2: reconcile', plan.reconcile, true);
  const look = H.reconcilePlan({ kind: 'einvoice' });
  eq('INCIDENT · step 3: look it up', look.action, 'lookup');
  const after = H.reconcilePlan({ kind: 'einvoice', gov: { irn: 'FOUND' } });
  eq('INCIDENT · step 4: found → stop, do not file again', after.action, 'already_have');
}

console.log('\n════ gsp-health (status honesty · safe retry) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' GSP-HEALTH TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
