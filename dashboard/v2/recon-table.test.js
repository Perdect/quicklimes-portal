/* recon-table.test.js — the Bank Reconciliation table is rich, and its column
 * count stays consistent everywhere. (Bank Rec redesign, increment 1)
 *
 * THE ASK. The old table had 6 data columns and a full-width "Review" button on
 * every row — sparse, and the button was dead weight because the whole row is
 * already clickable. The redesign promotes real data the row used to hide:
 *   • Type — the payment/semantic type chip (Customer/Supplier payment, Bank
 *     charge, On-account…), previously only in the expanded row;
 *   • AI  — the confidence bar+%, previously only in the expanded row.
 * and replaces the "Review" text button with a compact icon.
 *
 * THE TRAP THIS PINS. A table renders a <thead>, a body row, an expand row, a
 * "show more" bar and a month-group bar — and the last three use colspan. Add a
 * column to the header and forget one colspan and the layout silently breaks
 * (a cell spans too few/many columns). So this asserts the header column count
 * EQUALS every colspan in the table. It also pins that Type + AI are real
 * columns and the fat Review button is gone.
 *
 *   node recon-table.test.js
 */
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'reconcile.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ❌  ' + m); } };

console.log('\n═══ bank reconciliation · rich table, consistent columns ═══\n');

/* The main txn table's <thead> — the one with "Reconciled against" (NOT the
   audit table's When/Action/Transaction/Amount/Change/By header). Count its th. */
const theads = [...src.matchAll(/<thead><tr>(<th[^]*?)<\/tr><\/thead>/g)].map(m => m[1]);
const txnHead = theads.find(h => /Reconciled against/.test(h));
ok(!!txnHead, 'found the reconciliation table header (the one with "Reconciled against")');
const thCount = txnHead ? (txnHead.match(/<th/g) || []).length : 0;
ok(thCount === 9, `the header has 9 columns (got ${thCount})`);

/* The header names the two promoted columns. */
ok(/<th>Type<\/th>/.test(src), 'there is a Type column');
ok(/<th>AI<\/th>/.test(src), 'there is an AI column');

/* Every colspan in the txn table equals the header column count. The audit
   table (its own thead: When/Action/Transaction/Amount/Change/By) is excluded —
   it legitimately has 6. We check the colspans that belong to the txn table:
   the expand row, the more-bar and the month-group bar. */
const txnColspans = [];
for (const re of [/rc-xrow"><td colspan="(\d+)"/g, /colspan="(\d+)" class="rc-morebar"/g, /qx-grp [^]*?<td colspan="(\d+)"/g]) {
  let m; while ((m = re.exec(src)) !== null) txnColspans.push(+m[1]);
}
ok(txnColspans.length >= 3, `found the txn-table colspans (${txnColspans.length})`);
ok(txnColspans.every(c => c === thCount), `every txn-table colspan equals the header count (${thCount}) — got ${JSON.stringify(txnColspans)}`);

/* The row template renders the promoted cells. */
const rowBlock = src.slice(src.indexOf('const rowHTML = t =>'), src.indexOf('</tr>${open', src.indexOf('const rowHTML = t =>')) + 40);
ok(/\$\{typeCell\(t\)\}/.test(rowBlock), 'the row renders typeCell in a column');
ok(/\$\{confCell\(t\)\}/.test(rowBlock), 'the row renders confCell (AI) in a column');

/* The fat "Review" text button is gone; a compact icon action replaced it. */
const actBlock = src.slice(src.indexOf('function actionCell'), src.indexOf('function actionCell') + 400);
ok(!/>Review<\/button>/.test(actBlock), 'the full-width "Review" text button is gone');
ok(/rc-review-ic/.test(actBlock), '  replaced by a compact review icon');
ok(/data-open="\$\{t\.id\}"/.test(actBlock), '  which still opens review (data-open preserved)');

/* typeCell must not ALSO sit in the expanded row now that it is a column
   (that would be the duplication the user objects to). */
const expBlock = src.slice(src.indexOf('function expandHTML'), src.indexOf('function expandHTML') + 700);
ok(!/rc-x-type/.test(expBlock), 'typeCell is not duplicated in the expanded row');

console.log(fail ? `\n❌ FAILED — ${fail}\n` : `\n✅ PASSED — ${pass} checks; the table is richer and every colspan matches the header\n`);
process.exit(fail ? 1 : 0);
