/* company-manage.test.js — self-service Add / Remove company (client side).
 *
 * The "Add company" button in the switcher was a dead stub ("contact support").
 * Now it creates a real company (GSTIN required), and Settings → Company profile
 * can remove a secondary one. This runs the REAL addCompany / removeCompany out
 * of data.js against a mocked DB.rpc, proves ql-api.js routes the two RPCs to
 * company.php, and pins that the buttons actually call them (the half-wired trap).
 *
 *   node company-manage.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '  (got ' + JSON.stringify(a) + ')');

console.log('\n═══ Add / Remove company (client) ═══\n');

const dataSrc = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');

/* Slice a top-level `function name(...) { … }` out of data.js by brace-matching. */
function grabFn(sig) {
  const i = dataSrc.indexOf(sig);
  if (i < 0) throw new Error('not found: ' + sig);
  let depth = 0, started = false;
  for (let j = i; j < dataSrc.length; j++) {
    const ch = dataSrc[j];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return dataSrc.slice(i, j + 1); }
  }
  throw new Error('unbalanced: ' + sig);
}

/* A mutable in-memory environment mirroring data.js's module scope. */
function makeEnv(opts) {
  opts = opts || {};
  const store = {};
  const ctx = {
    QL_PLANT: opts.QL_PLANT || { id: 'GOTAN', plan_limit: 3, plants: [{ id: 'GOTAN' }, { id: 'DESH' }] },
    COMPANIES: opts.COMPANIES || { GOTAN: { key: 'GOTAN', short: 'Gotan', gstin: '08BNAPM0488E1Z3', isPrimary: true }, DESH: { key: 'DESH', short: 'Deshwali', gstin: '', isPrimary: false } },
    ACTIVE_CO: opts.ACTIVE_CO || 'GOTAN',
    DB: opts.DB || { rpc: async () => ({ data: { success: true, plant: { id: 'NEW', plant_name: 'X', gst_number: '08AABCG1234H1Z5' } }, error: null }) },
    validGstinFmt: g => /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/.test(g) && +g.slice(0, 2) >= 1 && +g.slice(0, 2) <= 38,
    validPhone: p => String(p || '').replace(/\D/g, '').length >= 7,
    localStorage: { _s: store, setItem: (k, v) => { store[k] = v; }, getItem: k => store[k] || null, removeItem: k => { delete store[k]; } },
    sessionStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    console
  };
  vm.createContext(ctx);
  vm.runInContext(grabFn('async function addCompany(o)') + '\n' + grabFn('async function removeCompany(id)') + '\n' + grabFn('async function updateCompany(id, o)') +
    '\nthis.addCompany = addCompany; this.removeCompany = removeCompany; this.updateCompany = updateCompany;', ctx);
  return ctx;
}
// Every add now needs a mobile; helper keeps cases terse.
function addIn(over) { return Object.assign({ name: 'New Lime Co', gstin: '08AABCG1234H1Z5', phone: '9876543210' }, over || {}); }

/* ══════════ addCompany ══════════ */
(async () => {
  {
    const env = makeEnv();
    const r = await env.addCompany(addIn({ city: 'Jodhpur', ownerName: 'Sameer' }));
    ok(r.ok && r.id === 'NEW', 'add: happy path returns the new id');
    ok(JSON.parse(env.localStorage.getItem('ql_plant')).plants.some(p => p.id === 'NEW'), '  the new company is cached in the family');
    eq('  it becomes the active company', env.localStorage.getItem('dm_active_co'), 'NEW');
  }
  {
    const env = makeEnv();
    ok(!(await env.addCompany(addIn({ gstin: '' }))).ok, 'add: blank GSTIN refused');
    ok((await env.addCompany(addIn({ gstin: '' }))).err.includes('GSTIN is required'), '  with the right message');
    ok(!(await env.addCompany(addIn({ gstin: '08BNAPM0488E1Z' }))).ok, 'add: malformed GSTIN refused');
    ok(!(await env.addCompany(addIn({ name: 'A' }))).ok, 'add: 1-char name refused');
  }
  {
    const env = makeEnv();
    ok(!(await env.addCompany(addIn({ phone: '' }))).ok, 'add: blank mobile refused');
    ok((await env.addCompany(addIn({ phone: '' }))).err.includes('Mobile number is required'), '  with the right message');
    ok(!(await env.addCompany(addIn({ phone: '123' }))).ok, 'add: too-short mobile refused');
  }
  {
    const env = makeEnv();
    const r = await env.addCompany(addIn({ gstin: '08BNAPM0488E1Z3' }));   // Gotan's GSTIN
    ok(!r.ok && /already used by/.test(r.err), 'add: a GSTIN already in the account is refused');
  }
  {
    const env = makeEnv({ QL_PLANT: { id: 'GOTAN', plan_limit: 2, plants: [{ id: 'GOTAN' }, { id: 'DESH' }] } });
    const r = await env.addCompany(addIn({ name: 'Third' }));
    ok(!r.ok && /plan allows 2/.test(r.err), 'add: at the plan limit, refused with a clear message');
  }
  {
    // A server-side failure must NOT report success.
    const env = makeEnv({ DB: { rpc: async () => ({ data: { error: 'boom' }, error: null }) } });
    const r = await env.addCompany(addIn());
    ok(!r.ok && r.err === 'boom', 'add: a server error is surfaced, not swallowed');
  }
  {
    const env = makeEnv();
    await env.addCompany(addIn({ ownerName: 'Sameer' }));
    const cap = JSON.parse(env.localStorage.getItem('ql_plant')).plants.find(p => p.id === 'NEW');
    ok(cap, 'add: the returned plant is cached');   // owner_name/contact_phone ride the RPC params (Object.assign)
  }

  /* ══════════ updateCompany (edit profile) ══════════ */
  {
    const env = makeEnv();
    const r = await env.updateCompany('DESH', { name: 'Deshwali Minerals', gstin: '08NLIPS9801K1Z5', phone: '9876500000', ownerName: 'Kayyum', city: 'Merta City' });
    ok(r.ok, 'edit: a valid profile saves');
    eq('  the cached company gets the mobile', env.COMPANIES.DESH.phone, '9876500000');
    eq('  and the manager name', env.COMPANIES.DESH.ownerName, 'Kayyum');
  }
  {
    const env = makeEnv();
    ok((await env.updateCompany('DESH', { name: 'Deshwali', gstin: '', phone: '9876500000' })).err.includes('GSTIN is required'), 'edit: blank GSTIN refused (was optional before)');
    ok((await env.updateCompany('DESH', { name: 'Deshwali', gstin: '08NLIPS9801K1Z5', phone: '' })).err.includes('Mobile number is required'), 'edit: blank mobile refused');
    const rr = await env.updateCompany('DESH', { name: 'Deshwali', gstin: '08BNAPM0488E1Z3', phone: '9876500000' });   // Gotan's GSTIN
    ok(!rr.ok && /already used by/.test(rr.err), 'edit: reusing a sibling GSTIN refused');
  }

  /* ══════════ removeCompany ══════════ */
  {
    const env = makeEnv({ DB: { rpc: async () => ({ data: { success: true, id: 'DESH' }, error: null }) } });
    env.localStorage.setItem('ql_data_DESH', 'blob');
    const r = await env.removeCompany('DESH');
    ok(r.ok, 'remove: a secondary company succeeds');
    ok(!JSON.parse(env.localStorage.getItem('ql_plant')).plants.some(p => p.id === 'DESH'), '  it is dropped from the cached family');
    eq('  its local data cache is cleared', env.localStorage.getItem('ql_data_DESH'), null);
  }
  {
    // Removing the MAIN company is ALLOWED (owner's rule: never tell the user
    // "you can't delete") — the server promotes the sibling; the client must
    // send the promote target, clear the dead identity, and ask for sign-out.
    let sent = null;
    const env = makeEnv({ DB: { rpc: async (fn, params) => { sent = params; return { data: { success: true, id: 'GOTAN', promoted: 'DESH' }, error: null }; } } });
    env.localStorage.setItem('ql_plant', 'x'); env.localStorage.setItem('dm_active_co', 'GOTAN');
    const r = await env.removeCompany('GOTAN');           // the primary
    ok(r.ok && r.signOut, 'remove: the MAIN company is allowed — and asks for a sign-out');
    eq('  the sibling is sent as the promote target', sent.p_promote_id, 'DESH');
    eq('  the dead identity is cleared', env.localStorage.getItem('ql_plant'), null);
    eq('  and the active-company pointer too', env.localStorage.getItem('dm_active_co'), null);
  }
  {
    // The LAST company → account deletion: same sign-out contract.
    const env = makeEnv({
      QL_PLANT: { id: 'GOTAN', plan_limit: 3, plants: [{ id: 'GOTAN' }] },
      COMPANIES: { GOTAN: { key: 'GOTAN', short: 'Gotan', gstin: '08BNAPM0488E1Z3', isPrimary: true } },
      DB: { rpc: async () => ({ data: { success: true, id: 'GOTAN', account_deleted: true }, error: null }) }
    });
    env.localStorage.setItem('ql_plant', 'x');
    const r = await env.removeCompany('GOTAN');
    ok(r.ok && r.signOut && r.accountDeleted, 'remove: the last company deletes the account — sign-out + accountDeleted');
  }
  {
    const env = makeEnv();
    ok(!(await env.removeCompany('NOPE')).ok, 'remove: an unknown company is refused');
  }

  /* ══════════ ql-api.js routes the two RPCs ══════════ */
  {
    const apiSrc = fs.readFileSync(path.join(__dirname, 'ql-api.js'), 'utf8');
    let captured = null;
    const win = {};
    const ctx = {
      window: win, location: { hostname: 'app.quicklimes.com' },
      localStorage: { getItem: () => JSON.stringify({ token: 'T' }) },
      fetch: async (url, opts) => { captured = { url, body: JSON.parse(opts.body) }; return { json: async () => ({ success: true, plant: { id: 'NEW' } }) }; },
      console
    };
    vm.createContext(ctx);
    vm.runInContext(apiSrc, ctx);
    const client = win.supabase.createClient();
    await client.rpc('add_my_company', { p_plant_name: 'X', p_gst_number: '08AABCG1234H1Z5' });
    ok(/company\.php$/.test(captured.url), 'ql-api: add_my_company → /api/company.php');
    eq('  with action "add"', captured.body.action, 'add');
    eq('  and the token attached', captured.body.token, 'T');
    await client.rpc('remove_my_company', { p_plant_id: 'DESH' });
    eq('ql-api: remove_my_company → action "remove"', captured.body.action, 'remove');
  }

  /* ══════════ WIRED: the buttons actually call the methods ══════════ */
  {
    const shell = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    ok(/\.ws-add/.test(shell) && /Q\.addCompany\(/.test(shell), 'the switcher "Add company" button calls Q.addCompany');
    ok(!/contact support to link a plant/.test(shell), '  the old dead "contact support" stub is gone');
    const settings = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    ok(/data-co-remove/.test(settings) && /QLD\.removeCompany\(/.test(settings), 'Settings \u2192 Company profile "Remove" calls QLD.removeCompany');
    ok(!/c\.isPrimary \? '' :.*data-co-remove/.test(settings), '  the Remove button is on EVERY company (main included — owner\u2019s rule)');
    // The gate must be INSIDE the remove handler — a _checkPin elsewhere (the
    // Danger zone has its own) must not satisfy this pin.
    const rmStart = settings.indexOf("[data-co-remove]");
    const rmBlock = settings.slice(rmStart, settings.indexOf('});', settings.indexOf('onSave', rmStart)));
    ok(rmStart > 0 && /_checkPin\(v\.code\)/.test(rmBlock), '  gated behind the security code (inside the remove flow itself)');
    ok(/_hasPin\(\)/.test(rmBlock.slice(0, 600)) || /_hasPin\(\)/.test(settings.slice(rmStart, rmStart + 600)), '  and a user with no code set is sent to create one first');
    ok(/signOut/.test(settings) && /location\.replace/.test(settings), '  a main-company removal signs out and returns to login');  }

  console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
  process.exit(fail ? 1 : 0);
})();
