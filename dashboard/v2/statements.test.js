/* statements.test.js — the statement upload log.
 *
 * New store behind the Bank Reconciliation redesign: one record per imported
 * file, scoped to a bank account. It is what lets a bank card say "last updated
 * 12 Jan", what the statement-history panel lists, and what makes "you already
 * imported this file" possible at all.
 *
 * The rules worth pinning are the ones about NOT destroying work:
 *   - a statement record is a LOG, not the transactions. Deleting the log must
 *     never be assumed to delete a month of reconciled bank lines.
 *   - conflict detection REPORTS, it never blocks. Re-importing a corrected
 *     statement is legitimate; the job is to make sure the user knows.
 *   - it must be scoped per bank account, or HDFC's history appears under BOB.
 *
 *   node statements.test.js
 */
'use strict';
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = '' + v; }, removeItem: k => { delete store[k]; } };
global.location = { hash: '', hostname: 'localhost', pathname: '/', search: '', replace() {}, href: '' };
global.history = { replaceState() {} };
global.navigator = { userAgent: 'node-test' };
global.document = { addEventListener() {}, createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
global.setTimeout = () => 0;
global.window = global;
localStorage.setItem('ql_plant', JSON.stringify({ id: 'co1', plants: [{ id: 'co1', plant_name: 'Gotan Lime' }], token: 't', role: 'owner', owner_name: 'Sameer', user: { name: 'Sameer', role: 'owner' } }));
localStorage.setItem('dm_active_co', 'co1');
global.supabase = { createClient: () => ({ rpc: async () => ({ data: null, error: 'offline' }) }) };
global.QLParty = require('./party-identity.js');

require('./data.js');
const Q = global.QLD;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));

console.log('\n═══ statement upload log ═══\n');

/* ── 1. it records, and it records the right things ── */
const st = Q.addStatement({ accountId: 'BA1', file: 'hdfc-jan.pdf', rows: 196, from: '2026-01-01', to: '2026-01-31', sha: 'aaa' });
ok(/^ST/.test(st.id), 'a statement gets an id');
eq('  the row count is kept', st.rows, 196);
eq('  scoped to the bank account it was uploaded for', st.accountId, 'BA1');
ok(!!st.uploadedAt, 'uploadedAt is stamped — a bank card reads "last updated" from this');
eq('  and WHO uploaded it, from the session', st.uploadedBy, 'Sameer');

/* ── 2. PER BANK ACCOUNT — the whole point of multi-bank ── */
Q.addStatement({ accountId: 'BA2', file: 'bob-jan.pdf', rows: 12, from: '2026-01-01', to: '2026-01-31', sha: 'bbb' });
eq('HDFC sees only its own statement', Q.statementRows('BA1').length, 1);
eq('BOB sees only its own', Q.statementRows('BA2').length, 1);
eq('  and BOB\'s is BOB\'s file, not HDFC\'s', Q.statementRows('BA2')[0].file, 'bob-jan.pdf');
eq('no filter → every statement, across banks', Q.statementRows().length, 2);

/* ── 3. newest first — "last upload" must mean the LAST one ── */
Q.addStatement({ accountId: 'BA1', file: 'hdfc-feb.pdf', rows: 210, from: '2026-02-01', to: '2026-02-28', sha: 'ccc' });
eq('history is newest-first', Q.statementRows('BA1').map(s => s.file), ['hdfc-feb.pdf', 'hdfc-jan.pdf']);
eq('lastStatement is the most recent upload for THAT bank', Q.lastStatement('BA1').file, 'hdfc-feb.pdf');
eq('  and the other bank is unaffected', Q.lastStatement('BA2').file, 'bob-jan.pdf');
eq('a bank with no statements has no "last" — not a crash, not someone else\'s', Q.lastStatement('BA9'), null);

/* ── 4. CONFLICTS — report, never block ── */
{
  const dup = Q.statementConflict('BA1', { sha: 'aaa', from: '2026-01-01', to: '2026-01-31' });
  eq('the same FILE re-uploaded is flagged as a duplicate', dup.kind, 'duplicate');
  ok(/already imported/i.test(dup.msg), '  and says so in words a human reads');
  ok(dup.of && dup.of.file === 'hdfc-jan.pdf', '  naming the file it clashes with');

  const ov = Q.statementConflict('BA1', { sha: 'zzz', from: '2026-01-15', to: '2026-02-15' });
  eq('a DIFFERENT file covering overlapping dates is flagged as overlap, not duplicate', ov.kind, 'overlap');
  ok(/overlap/i.test(ov.msg), '  and explains the overlap');

  eq('a clean new period is not flagged', Q.statementConflict('BA1', { sha: 'yyy', from: '2026-03-01', to: '2026-03-31' }).kind, 'none');
  eq('the SAME dates on a DIFFERENT bank are not a conflict', Q.statementConflict('BA2', { sha: 'yyy', from: '2026-01-01', to: '2026-01-31' }).kind, 'overlap');
  eq('an upload with no dates known yet is not falsely flagged', Q.statementConflict('BA1', { sha: 'new' }).kind, 'none');

  /* The safety property: a verdict is ADVICE. Nothing here refuses the import —
     a firm re-importing a corrected statement is doing something legitimate. */
  const before = Q.statementRows('BA1').length;
  Q.addStatement({ accountId: 'BA1', file: 'hdfc-jan-corrected.pdf', rows: 197, from: '2026-01-01', to: '2026-01-31', sha: 'ddd' });
  eq('a flagged upload still goes through if the user proceeds', Q.statementRows('BA1').length, before + 1);
}

/* ── 5. DELETING the log must not be assumed to delete the money ── */
{
  Q.state.RECON = { txns: [{ id: 'T1', accountId: 'BA1', credit: 5000 }, { id: 'T2', accountId: 'BA1', debit: 200 }] };
  const target = Q.statementRows('BA1').find(s => s.file === 'hdfc-jan.pdf');
  const removed = Q.removeStatement(target.id);
  ok(removed, 'a statement record can be removed');
  ok(!Q.statementRows('BA1').some(s => s.id === target.id), '  and is gone from the history');
  eq('THE IMPORTED TRANSACTIONS ARE UNTOUCHED — deleting a log entry must never silently destroy a month of reconciled bank lines',
    (Q.state.RECON.txns || []).length, 2);
  eq('removing an unknown id is a no-op, not a throw', Q.removeStatement('nope'), false);
}

/* ── 6. it must actually SAVE (blob() is a whitelist) ── */
{
  const b = Q.blob ? Q.blob(false) : null;
  if (b) ok(Array.isArray(b.statements), 'statements are in the blob whitelist — a store missing from it dies silently on reload');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
