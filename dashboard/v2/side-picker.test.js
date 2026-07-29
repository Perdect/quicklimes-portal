/* side-picker.test.js — the match picker is side-by-side, and STAYS scrollable.

   WHY THIS EXISTS. Matching a bank line to a bill is a comparison, so the
   table has to stay visible while you pick. That is the `rc-side` dock. But
   the dock is only half of it: once the panel owns the full viewport height,
   the candidate list must scroll INSIDE its own pane. If it doesn't, the
   whole modal body becomes the scroller and the running total — the one
   number you must watch while allocating — scrolls off the top.

   The first implementation had exactly that bug: `align-items: start` sized
   each pane to its content, the list grew to 2754px, and the body scrolled.
   It LOOKED right in a screenshot. It only failed once the list was long.

   The fix is a chain: every element between the panel and the list needs
   min-height:0, and the grid row must stretch. Break any single link and the
   overflow escapes upward again — silently, with no error. So each link is
   pinned separately here.

   Static assertion over the CSS + JS source; no browser needed. */

const fs = require('fs'), path = require('path');
const css = fs.readFileSync(path.join(__dirname, 'reconcile.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'reconcile.js'), 'utf8');

let fail = 0;
const ok = (name, cond) => { if (cond) console.log('  ok  ' + name); else { fail++; console.log('  ❌  ' + name); } };

/* Pull one rule's declaration block by exact selector, so a match somewhere
   else in the 1000-line stylesheet cannot make a check pass by accident. */
const rule = sel => {
  const i = css.indexOf('\n' + sel + ' {');
  if (i === -1) return null;
  return css.slice(i + sel.length + 3, css.indexOf('}', i));
};

console.log('\n=== the picker docks to the side, not the centre ===');
const back = rule('.rc-back.rc-side');
ok('.rc-back.rc-side exists', !!back);
ok('  …docks right (justify-content: flex-end)', back && /justify-content:\s*flex-end/.test(back));
ok('  …stretches full height (align-items: stretch)', back && /align-items:\s*stretch/.test(back));
ok('  …drops the blur so the table behind stays readable', back && /backdrop-filter:\s*none/.test(back));
ok('  …clips the slide-in start frame', back && /overflow:\s*hidden/.test(back));

/* Both entry points must dock. openLink is the single-bill picker, openSplit
   the multi-bill one; a user reaches split THROUGH link, so if either forgets
   the class the panel jumps between docked and centred mid-task. */
console.log('\n=== both pickers opt in ===');
for (const fn of ['openLink', 'openSplit']) {
  const start = js.indexOf('function ' + fn + '(');
  const body = start === -1 ? '' : js.slice(start, js.indexOf('\nfunction ', start + 1));
  ok(fn + ' adds the rc-side class', body.includes("classList.add('rc-side')"));
}

console.log('\n=== the scroll chain: body must NOT be the scroller ===');
/* Read in order, panel → body → grid → pane → list. Each one that loses
   min-height:0 lets the overflow escape one level further up. */
const chain = [
  ['.rc-back.rc-side .rc-modal-b', ['min-height:\\s*0', 'overflow:\\s*hidden', 'flex:\\s*1']],
  ['.rc-back.rc-side .rc-two', ['min-height:\\s*0', 'align-items:\\s*stretch', 'grid-template-rows:\\s*minmax\\(\\s*0']],
  ['.rc-back.rc-side .rc-two-l, .rc-back.rc-side .rc-two-r', ['min-height:\\s*0']],
  ['.rc-back.rc-side .rc-al-list, .rc-back.rc-side .rc-picklist', ['min-height:\\s*0', 'overflow-y:\\s*auto', 'flex:\\s*1']],
];
for (const [sel, needs] of chain) {
  const d = rule(sel);
  ok(sel + ' present', !!d);
  for (const n of needs) ok('  …declares ' + n.replace(/\\\\?[s*(]/g, '').replace('\\', ''), !!d && new RegExp(n).test(d));
}

/* openSplit still ships an inline max-height:32vh on the picklist — a
   leftover from modal days. In panel mode that would cap the list at a third
   of the screen and waste the height we just gained. Only an !important
   author rule beats an inline style. */
console.log('\n=== the inline modal-era height cap is overridden ===');
const pl = rule('.rc-back.rc-side .rc-picklist');
ok('picklist max-height is cleared with !important (beats the inline 32vh)',
  !!pl && /max-height:\s*none\s*!important/.test(pl));
ok('  …and the inline cap it overrides is still the thing in the JS',
  js.includes('id="rcSplitList" style="max-height:32vh"'));

console.log('\n=== the two panes exist in the markup ===');
ok('openSplit renders a .rc-two grid', js.includes('<div class="rc-two">'));
ok('  …with the running total in the LEFT pane', /rc-two-l[\s\S]{0,400}rc-split-sum/.test(js));
ok('  …and the candidate list in the RIGHT pane', /rc-two-r[\s\S]{0,600}rcSplitList/.test(js));

console.log('\n=== narrow screens fall back to a stacked sheet ===');
const mq = css.slice(css.indexOf('@media (max-width: 1180px)'), css.indexOf('@media (max-width: 1180px)') + 420);
ok('under 1180px the panel narrows', /max-width:\s*560px/.test(mq));
ok('  …and the panes stack to one column', /grid-template-columns:\s*1fr/.test(mq));

console.log(fail ? `\n❌ FAILED — ${fail}\n` : '\n✅ PASSED — the picker is side-by-side and each pane scrolls on its own\n');
process.exit(fail ? 1 : 0);
