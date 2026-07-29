/* sync-state.test.js — a failed cloud save must be visible and self-heal, and
 * a second tab must not silently clobber this one. (audit M2/M3)
 *
 * THE OLD BEHAVIOUR. saveCloudNow did `catch (e) { console.warn(e) }`. A failed
 * write left the data in this device's localStorage only — no signal, no retry,
 * and (because the debounce re-armed only on the next edit) stranded forever if
 * the user stopped editing. Two tabs on one account each held the whole company
 * in memory and the last to save clobbered the other.
 *
 * WHAT THIS PINS, driving the REAL functions out of data.js in a sandbox with
 * controllable timers + a fake window:
 *   1. success → state saving→idle, and the unsaved-changes flag clears.
 *   2. failure → state 'error' AND a retry is scheduled (not just a warning).
 *   3. the scheduled retry, once the backend recovers, returns to 'idle'.
 *   4. beforeunload nags ONLY when the cloud is behind ('error'/'conflict').
 *   5. a storage event from another tab: adopt when clean, flag 'conflict' when
 *      this tab has unsaved edits — never a silent overwrite.
 *
 *   node sync-state.test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ❌  ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + `  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

console.log('\n═══ sync state · failures are visible and self-heal; tabs don’t clobber ═══\n');

/* Grab the contiguous region: the sync-state machine + commit + the window
   listeners. It runs from `let _cloudTimer` to the end of the listener block. */
const start = src.indexOf('let _cloudTimer = null, _syncRetry');
const anchor = src.indexOf("window.addEventListener('beforeunload'", start);
const end = src.indexOf('\n  }', src.indexOf('e.returnValue', anchor)) + 4;
const region = src.slice(start, end);
ok(start > 0 && end > start, 'located the sync-state region in data.js');

/* ── Controllable environment ── */
const events = [];           // dispatched 'ql:sync' details, in order
const listeners = {};        // window listeners we register
let refreshed = 0, loaded = 0;
let rpcMode = 'ok';          // 'ok' | 'fail'
const timers = [];           // pending setTimeout callbacks (we fire them manually)

const ctx = {
  DB: { rpc: async () => (rpcMode === 'fail' ? { error: new Error('network') } : { error: null }) },
  QL_PLANT: { id: 'P1' },
  ACTIVE_CO: 'CO1',
  COMPANIES: { CO1: { dataKey: 'dm_v2_CO1' } },
  blob: () => ({}),
  saveLocal: () => {},
  loadLocal: () => { loaded++; },
  console: { warn: () => {} },
  clearTimeout: (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
  setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms }); return id; },
  window: {
    __qlRefresh: () => { refreshed++; },
    dispatchEvent: (e) => { events.push(e.detail); return true; },
    addEventListener: (name, fn) => { listeners[name] = fn; }
  },
  CustomEvent: function (name, opts) { this.type = name; this.detail = opts && opts.detail; }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
// expose the closure functions we need to poke
vm.runInContext(region + '\nthis.saveCloudNow = saveCloudNow; this.commit = commit; this.syncState = syncState;', ctx);

const fireTimers = async () => { const pend = timers.splice(0); for (const t of pend) await t.fn(); };
const beforeUnloadWarns = () => {
  let warned = false;
  listeners['beforeunload'] && listeners['beforeunload']({ preventDefault() {}, set returnValue(v) { warned = true; } });
  return warned;
};

(async () => {
  /* 1. success path */
  rpcMode = 'ok';
  ctx.commit();                              // marks dirty, arms the 300ms debounce
  await fireTimers();                        // fire the debounced saveCloudNow
  eq('a clean save ends at idle', ctx.syncState(), 'idle');
  ok(events.includes('saving') && events[events.length - 1] === 'idle', '  it passed through "saving" then "idle"');
  ok(!beforeUnloadWarns(), '  no unsaved-changes nag when idle');

  /* 2. failure path → error + a scheduled retry */
  events.length = 0; rpcMode = 'fail';
  ctx.commit(); await fireTimers();          // the save fails
  eq('a failed save shows "error"', ctx.syncState(), 'error');
  ok(timers.length === 1, '  and schedules a retry (not just a warning)');
  ok(beforeUnloadWarns(), '  beforeunload NOW nags — the cloud is behind');

  /* 3. the retry heals once the backend recovers */
  rpcMode = 'ok';
  await fireTimers();                        // fire the scheduled retry
  eq('the retry returns to idle', ctx.syncState(), 'idle');
  ok(!beforeUnloadWarns(), '  and the nag is gone');

  /* 4. cross-tab: another tab writes the active company key */
  //   4a. this tab is CLEAN → adopt the other tab’s copy
  loaded = 0; refreshed = 0;
  listeners['storage']({ key: 'dm_v2_CO1', newValue: '{"sales":[1]}' });
  ok(loaded === 1 && refreshed === 1, 'a clean tab ADOPTS another tab’s write (reload + refresh)');
  ok(ctx.syncState() !== 'conflict', '  no conflict flagged for a clean tab');

  //   4b. this tab is DIRTY → flag conflict, do NOT overwrite
  rpcMode = 'fail'; ctx.commit(); await fireTimers();   // make this tab dirty (+error)
  events.length = 0; loaded = 0;
  listeners['storage']({ key: 'dm_v2_CO1', newValue: '{"sales":[2]}' });
  eq('a DIRTY tab flags a conflict instead of clobbering', ctx.syncState(), 'conflict');
  ok(loaded === 0, '  and does NOT silently adopt (the pending edits survive)');
  ok(beforeUnloadWarns(), '  beforeunload nags on an unresolved conflict too');

  //   4c. an unrelated key is ignored
  const before = ctx.syncState();
  listeners['storage']({ key: 'some_other_key', newValue: 'x' });
  eq('an unrelated storage key is ignored', ctx.syncState(), before);

  console.log(fail ? `\n❌ FAILED — ${fail}\n` : `\n✅ PASSED — ${pass} checks; sync failures are visible, self-heal, and tabs don’t clobber\n`);
  process.exit(fail ? 1 : 0);
})();
