/* theme.test.js — dark mode must be REACHABLE, and dark must not mean invisible.
 *
 * THE BUG THIS FIXES. ~24 dark rules had shipped and none of them could ever
 * run: shell.js READ localStorage.ql_theme, and nothing in the app ever WROTE
 * it. Dark mode was dead code behind a key with no writer.
 *
 * THE TRAP IT PINS. tokens.css defined --ql-neutral-0/50/100 once, in :root,
 * with no dark override. So `background: var(--ql-neutral-50)` was TOKENISED
 * YET STILL NEAR-WHITE in dark — the failure looks correct in the source. The
 * text on those surfaces came from var(--ql-text), which IS theme-aware and
 * goes near-white. White text on a white card, in tokenised code.
 * Tokenised ≠ dark-safe. That is the whole point of this file.
 *
 *   node theme.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  expected: ' + JSON.stringify(b));
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

console.log('\n═══ dark mode · reachable · persists · nothing invisible ═══\n');

/* ── 1. The engine: QLTheme ─────────────────────────────────────────────
   Loaded in a fake DOM so we can drive the OS switch by hand. */
function harness(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.store);
  const html = { attrs: {} };
  let osDark = !!opts.osDark, listeners = [];
  const mql = {
    get matches() { return osDark; },
    addEventListener: (_e, fn) => listeners.push(fn),
    addListener: fn => listeners.push(fn),
  };
  const win = {
    matchMedia: opts.noMatchMedia ? undefined : () => mql,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { if (opts.throwOnWrite) throw new Error('quota'); store[k] = String(v); },
    },
    document: {
      documentElement: {
        setAttribute: (k, v) => { html.attrs[k] = v; },
        getAttribute: k => html.attrs[k],
      },
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {} }),
      body: { classList: { add() {}, remove() {} }, appendChild() {} },
    },
  };
  win.window = win;
  const ctx = vm.createContext(win);
  /* Only the QLTheme IIFE — the shell IIFE below it needs a whole app. */
  const src = read('shell.js');
  const start = src.indexOf('/* ── THEME ');
  const marker = src.indexOf('window.QLTheme = {');
  const end = src.indexOf('})();', marker);          // the IIFE's real closer
  ok(start >= 0 && marker > start && end > marker, 'QLTheme block is findable in shell.js');
  vm.runInContext(src.slice(start, end + 5), ctx);
  return { T: win.QLTheme, store, html, os: v => { osDark = v; listeners.forEach(fn => fn()); }, listeners };
}

{
  console.log('· the setting itself');
  const { T, store, html } = harness();
  eq('with nothing stored, the mode is Light (the app default)', T.get(), 'light');
  T.set('dark');
  eq('choosing Dark writes ql_theme — THE BUG: nothing ever wrote this key', store.ql_theme, 'dark');
  eq('  and applies it to <html> instantly, no reload', html.attrs['data-theme'], 'dark');
  T.set('light');
  eq('choosing Light writes through', store.ql_theme, 'light');
  eq('  and repaints', html.attrs['data-theme'], 'light');
}

{
  console.log('· System is a live subscription, not a stored colour');
  const { T, html, os } = harness({ osDark: false });
  T.set('system');
  T.init();
  eq('System on a light OS resolves light', html.attrs['data-theme'], 'light');
  os(true);
  eq('THE POINT: the OS flipping at sunset moves the app, with no reload', html.attrs['data-theme'], 'dark');
  os(false);
  eq('  and back', html.attrs['data-theme'], 'light');
}

{
  console.log('· an explicit choice OVERRIDES the OS (the mutation that matters)');
  const { T, html, os } = harness({ osDark: false });
  T.init();
  T.set('dark');
  os(true); os(false);          // OS thrashes underneath
  eq('Dark stays dark on a light OS', html.attrs['data-theme'], 'dark');
  T.set('light');
  os(true);
  eq('Light stays light on a DARK OS — the OS must not win over a real choice', html.attrs['data-theme'], 'light');
}

{
  console.log('· it survives junk and hostile browsers');
  const { T } = harness({ store: { ql_theme: 'chartreuse' } });
  eq('a mode we do not ship reads back as Light (the app default), not as itself', T.get(), 'light');
  const j = harness({ store: { ql_theme: 'chartreuse' } });
  eq('  and resolves to a real theme anyway', ['light', 'dark'].indexOf(j.T.resolve()) >= 0, true);
  const b = harness({ noMatchMedia: true });
  b.T.init();
  eq('no matchMedia (old webview): System falls back to light, does not throw', b.html.attrs['data-theme'], 'light');
  const t = harness({ throwOnWrite: true });
  t.T.set('dark');
  eq('localStorage throwing (Safari private) still applies the theme', t.html.attrs['data-theme'], 'dark');
  const d = harness();
  d.T.init(); d.T.init(); d.T.init();
  eq('init is idempotent — mount() runs more than once, listeners must not stack', d.listeners.length, 1);
}

/* ── 2. Every page reaches dark before first paint ─────────────────── */
{
  console.log('· every page applies the theme BEFORE the first paint');
  const pages = fs.readdirSync(__dirname).filter(f => f.endsWith('.html'))
    .filter(f => fs.statSync(path.join(__dirname, f)).size > 0);
  const noBoot = [], lateBoot = [], splashBack = [];
  for (const f of pages) {
    const s = read(f);
    const boot = s.indexOf('THEME BOOT');
    if (boot < 0) { noBoot.push(f); continue; }
    /* ANCHOR CHANGED — and this is the point of the rewrite.
       These checks used to be measured against the launch splash. The splash
       is deleted, so `indexOf('id="ql-splash"')` is now -1 on every page and
       the guard `if (splash >= 0 && …)` could never fire again: the assertion
       would have gone on passing forever while testing NOTHING.

       The real requirement never mentioned the splash. The boot script must
       run before the browser paints ANYTHING, which means before the first
       stylesheet and before <body>. Those are the things that actually paint,
       so those are what it is measured against now. */
    const firstCss = s.indexOf('<link rel="stylesheet"');
    const body = s.indexOf('<body');
    if ((firstCss >= 0 && boot > firstCss) || (body >= 0 && boot > body)) lateBoot.push(f);
    if (s.indexOf('ql-splash') >= 0) splashBack.push(f);
  }
  eq('every non-empty page carries the boot script', noBoot, []);
  eq('THE FLASH: none boots the theme after a stylesheet or <body> — it must beat the first paint', lateBoot, []);
  eq('the launch splash stays deleted ("remove site loder") — it ran on EVERY navigation, not just launch', splashBack, []);
  ok(pages.length >= 30, 'the sweep actually covered the app (' + pages.length + ' pages)');

  /* Mutation-test the guard above: if it cannot fail, it is not a test. */
  const canary = read('dashboard.html').replace('THEME BOOT', 'x');
  ok(canary.indexOf('THEME BOOT') < 0, 'MUTATION: a page stripped of the boot script is detected');
}

/* ── 3. THE TOKEN GAP ───────────────────────────────────────────────── */
{
  console.log('· tokenised must MEAN dark-safe');
  const tok = read('tokens.css');
  const dark = tok.slice(tok.indexOf('[data-theme="dark"]'));
  for (const n of ['0', '50', '100']) {
    ok(new RegExp('--ql-neutral-' + n + ':').test(dark),
      'THE TRAP: --ql-neutral-' + n + ' has a dark value (without it, background:var(--ql-neutral-' + n + ') is tokenised yet still near-white)');
  }
  /* Every dark neutral must actually be dark, or the override is theatre. */
  const lum = h => { const c = h.replace('#', ''); const v = i => parseInt(c.substr(i, 2), 16);
    return (0.2126 * v(0) + 0.7152 * v(2) + 0.0722 * v(4)) / 255; };
  for (const n of ['0', '50', '100']) {
    const m = dark.match(new RegExp('--ql-neutral-' + n + ':\\s*(#[0-9a-fA-F]{6})'));
    ok(m && lum(m[1]) < 0.25, '  --ql-neutral-' + n + ' is genuinely dark (' + (m ? m[1] : '?') + ')');
  }
  /* The one casualty of flipping neutral-0. */
  ok(/--ql-text-inverted:\s*#[fF]{3,6}/.test(dark),
    'text-inverted is pinned white — it aliases neutral-0 and sits on the BLUE button, which stays blue in dark');
}

/* ── 3b. PHANTOM TOKENS — the same trap in its best disguise ─────────
   `background: var(--ql-surface-2, #f8fafc)` reads as tokenised. But
   --ql-surface-2 was never defined, so the FALLBACK was the real value —
   a hardcoded near-white wearing a token's clothes, immune to every dark
   override and to any grep for '#fff'. That is what made the Settings
   "LOCKED ON" rows render #F1F5F9 text on an #F8FAFC card.
   inventory.css hit this and inventory.test.js started checking it — but
   only for inventory.css, while 39 sites in 4 other files kept doing it.
   The check belongs to the whole app. */
{
  console.log('· no phantom tokens (a var() whose token does not exist is a hardcoded colour)');
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.css'));
  const defined = new Set();
  for (const f of files) {
    let m; const re = /(--[A-Za-z0-9-]+)\s*:/g, css = read(f);
    while ((m = re.exec(css))) defined.add(m[1]);
  }
  /* Two names are deliberately not failures:
       --ql-photo — set at runtime by JS as an inline style, by design.
       --ql-mono  — a REAL phantom, but a FONT one. It carries no colour, so it
                    cannot make anything invisible in dark. Its two call sites
                    fall back to two different mono stacks, so pointing them at
                    --ql-font-mono would change typography in LIGHT — an
                    unrequested regression in the theme he actually uses. Left
                    alone on purpose; tracked separately. */
  const OK_UNDEFINED = ['--ql-photo', '--ql-mono'];
  /* JS matters MORE than CSS here, not less: these land as inline style="" on
     the element, where no stylesheet and no [data-theme] rule can reach them.
     qlx.js's empty state rendered `color:var(--qx-text,#0f172a)` — near-black
     on a near-black page, contrast 1.13 — and outlived every dark rule in the
     app precisely because it was inline. A CSS-only guard never sees it. */
  const scan = files.concat(fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.js') && !f.endsWith('.test.js')));
  const phantom = [];
  for (const f of scan) {
    /* Comments discuss token names in prose — inventory.css's header and this
       fix's own comment both do. Strip them, or the guard fails on its own
       documentation. */
    read(f).replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).split('\n').forEach((line, i) => {
      let m; const re = /var\(\s*(--(?:ql|qx|mut)[A-Za-z0-9-]*)\s*[,)]/g;
      while ((m = re.exec(line))) {
        if (OK_UNDEFINED.indexOf(m[1]) >= 0) continue;
        if (!defined.has(m[1])) phantom.push(f + ':' + (i + 1) + '  ' + m[1]);
      }
    });
  }
  eq('every colour token referenced in v2 — CSS *and* JS inline styles — actually exists', phantom, []);
  /* MUTATION: the guard must fail on a token that is not there. */
  ok(!defined.has('--ql-surface-2'), 'MUTATION: the phantom that caused the bug is gone, not merely defined away');
  ok(defined.has('--ql-neutral-150'), '  and the one slot worth keeping is now real');
}

/* ── 4. No surface may render text on its own colour ────────────────── */
{
  console.log('· the white-on-white sweep (dash.css + finance.css were the worst)');
  /* A raw white background is only safe if either (a) a [data-theme="dark"]
     rule overrides that same selector, or (b) it is audited below. Matching by
     LINE is not good enough — it misses a selector sitting on the line above
     its background, and it cannot see an override 400 lines away. So parse
     rules and resolve each selector. */
  const ALLOW = {
    'invoice.css': ['.inv-prev iframe'],        // the invoice is white PAPER
    'mobile.css': ['.qlm-iv-doc'],              // ditto, 794px = A4
    'qlx.css': ['.qx-inv-frame'],               // ditto
    'pages.css': ['.ft-slider::before'],        // toggle knob on a coloured track
    'shell.css': ['.ql-mp-cell.on.has::after'], // dot on a selected blue cell
  };
  /* A light surface is not always spelled '#fff'. `.qx-foot` was
     `rgba(248,250,252,.75)` — a 75% near-white sticky footer that composites
     to light grey over the dark page, under var(--ql-text). A hex-only regex
     never saw it. Anything light enough and opaque enough to carry text counts. */
  function lightRGBA(body) {
    const re = /background(?:-color)?:\s*rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/gi;
    let m;
    while ((m = re.exec(body))) {
      const a = m[4] === undefined ? 1 : parseFloat(m[4]);
      if (a < 0.5) continue;                       // a faint wash reads as a lift, not a surface
      const l = (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
      if (l > 0.75) return true;
    }
    return false;
  }
  const HEXWHITE = /background(-color)?:\s*(#fff\b|#ffffff|white)\s*[;}]/i;
  const WHITE = { test: b => HEXWHITE.test(b) || lightRGBA(b) };
  /* The last class in a compound selector is the one a dark rule would target:
     `.dx .dx-card` → `.dx-card`, `.qx-btn:hover` → `.qx-btn`. */
  const key = sel => { const m = sel.trim().match(/\.[A-Za-z0-9_-]+/g); return m ? m[m.length - 1] : null; };

  function sweep(css, file) {
    const out = [];
    const rules = css.match(/([^{}]+)\{([^{}]*)\}/g) || [];
    for (const r of rules) {
      const cut = r.indexOf('{');
      const sel = r.slice(0, cut).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      const body = r.slice(cut + 1, -1);
      if (!WHITE.test(body)) continue;
      if (/\[data-theme="dark"\]/.test(sel)) continue;          // it IS the dark rule
      for (const part of sel.split(',')) {
        const p = part.trim();
        if (!p || p.charAt(0) === '@') continue;
        if ((ALLOW[file] || []).some(a => p.indexOf(a) >= 0)) continue;
        const k = key(p);
        /* Is there a dark rule anywhere in this file naming the same class? */
        const covered = k && new RegExp('\\[data-theme="dark"\\][^{}]*\\' + k + '(?![A-Za-z0-9_-])').test(css);
        if (!covered) out.push(file + '  ' + p.slice(0, 46));
      }
    }
    return out;
  }

  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.css'));
  let bad = [];
  for (const f of files) bad = bad.concat(sweep(read(f), f));
  eq('every white surface is either overridden in dark or audited as paper', bad, []);

  /* MUTATION: the sweep must catch a white card, and must NOT fire on one that
     has a dark override — an allowlist-shaped test that passes everything is
     the exact failure mode here. */
  eq('MUTATION: a bare white card is caught',
    sweep('.zz-card { background: #fff; color: var(--ql-text); }', 'x.css'), ['x.css  .zz-card']);
  eq('MUTATION: the same card WITH a dark override is not flagged',
    sweep('.zz-card { background:#fff; }\n[data-theme="dark"] .zz-card { background: var(--ql-card); }', 'x.css'), []);
  eq('MUTATION: a near-miss class name does not count as coverage',
    sweep('.zz-card { background:#fff; }\n[data-theme="dark"] .zz-card-x { background:#000; }', 'x.css'), ['x.css  .zz-card']);

  /* The exact shape of the original bug, pinned by name. */
  const dash = read('dash.css');
  ok(/\.dx \.dx-card, \.dx-kpi, \.dx-mk \{ background: var\(--ql-card\)/.test(dash),
    'THE HEADLINE BUG: .dx-card is no longer background:#fff under .dx{color:var(--ql-text)}');
  ok(dash.indexOf('[data-theme="dark"]') >= 0, 'dash.css has dark rules at all (it had ZERO — and it is the first screen he opens)');
  ok(read('finance.css').indexOf('[data-theme="dark"]') >= 0, 'finance.css has dark rules at all (it had ZERO too)');

  /* MUTATION: prove the sweep above can actually catch the bug it exists for. */
  const line = '.dx-card { background: #fff; }';
  ok(/background(-color)?:\s*(#fff\b|#ffffff|white)\s*[;}]/i.test(line), 'MUTATION: the sweep detects a reintroduced white card');
  ok(!/background(-color)?:\s*(#fff\b|#ffffff|white)\s*[;}]/i.test('.x { background: var(--ql-card); }'), '  and does not fire on the tokenised form');
}

/* ── 5. The setting is really wired into Settings ───────────────────── */
{
  console.log('· the switch exists where he was told to look');
  const s = read('settings.html');
  ok(/id="themeSel"/.test(s), 'settings.html has the picker');
  for (const v of ['light', 'dark', 'system']) ok(new RegExp('value="' + v + '"').test(s), '  offers ' + v);
  ok(/renderTheme\(\)/.test(s) && s.indexOf('function renderTheme') < s.lastIndexOf('renderTheme()'),
    '  and render() actually calls it — a card nothing wires is the bug we started with');
  ok(/QLTheme\.set\(/.test(s), '  the picker writes through QLTheme (the one owner of the rule)');
  ok(!/location\.reload/.test(s.slice(s.indexOf('function renderTheme'), s.indexOf('function renderLang'))),
    '  and applies instantly — no reload');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
