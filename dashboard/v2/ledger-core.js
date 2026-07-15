/* ═══════════════════════════════════════════════════════════════════════
   ledger-core.js — read a Tally PARTY LEDGER, then reconcile it against ours.

   A supplier's ledger is not an invoice. It is his answer to one question:
   "what do we owe each other?" — normally checked by hand once a year. This
   engine reads it and puts his answer next to ours.

   WHY THE BALANCE CHAIN, AND NOT THE COLUMNS
   Tally prints a clean table, but pdf.js reads ACROSS it and the app receives
   the rows in pieces, in varying order:

       9-Apr-25 Cr Payment 22 1,00,000.00 11,76,711.00 Cr
       BOB Ac 254                     <- particulars, alone
       23                             <- the NEXT row's voucher no, alone
       Cr Payment 5.60 11,76,705.40 Cr
       31-May-25 11                   <- date + voucher no fused
       Dr Purchase 10,502.00 11,87,207.40 Cr

   Column positions are therefore worthless (the same lesson the bill parser
   learned the hard way: its "nearest column" heuristic picked a PIN code as an
   invoice number). But one thing survives any scrambling — every transaction
   line ENDS with "<amount> <running balance> Cr|Dr". The running balance is a
   chain, so the delta between one row and the next IS the amount and IS the
   direction, and it can be checked against the amount printed on the same line.
   Two independent readings of every row, from one line.

   THE Dr/Cr MARKER IS A TRAP. In "9-Apr-25 Cr ... Payment ... 1,00,000.00" the
   Cr belongs to the CONTRA account (the bank is credited); the party is DEBITED
   and the balance falls. Reading that letter as the party's direction inverts
   every payment in the file. The chain is the truth; the marker is only ever a
   cross-check.

   Pure: no DOM, no QLD. Node-testable.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var MONEY = /(\d[\d,]*\.\d{2})/;
  var MONEY_G = /(\d[\d,]*\.\d{2})/g;
  /* A transaction line: "... <amount> <balance> Cr". Both money tokens and the
     balance type sit at the END, which is the one thing pdf.js keeps together. */
  var TXN = /(\d[\d,]*\.\d{2})\s+(\d[\d,]*\.\d{2})\s*(Cr|Dr)\s*$/i;
  var DATE = /(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}(?:\d{2})?)/i;
  var MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
              jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

  function num(s) { return +String(s == null ? '' : s).replace(/,/g, '') || 0; }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function round2(n) { return Math.round(n * 100) / 100; }

  /* "9-Apr-25" -> "2025-04-09". A 2-digit year is this century: these ledgers
     are printed from live books, not from 1925. */
  function isoDate(s) {
    var m = DATE.exec(String(s || '')); if (!m) return '';
    var y = m[3].length === 2 ? '20' + m[3] : m[3];
    return y + '-' + MON[m[2].toLowerCase()] + '-' + String(m[1]).padStart(2, '0');
  }

  /* ── the header: whose ledger, and for what period ── */
  function header(lines) {
    var out = { party: '', from: '', to: '', self: '' };
    for (var i = 0; i < Math.min(lines.length, 20); i++) {
      var L = clean(lines[i]);
      // Tally prints the account name directly ABOVE "Ledger Account".
      if (/^ledger\s*account$/i.test(L) && i > 0) out.party = clean(lines[i - 1]);
      var p = L.match(/(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+to\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i);
      if (p) { out.from = isoDate(p[1]); out.to = isoDate(p[2]); }
    }
    out.self = clean(lines[0] || '');       // our own firm — the ledger is printed from OUR books
    return out;
  }

  /* ── the spine ──
     Every transaction is one line ending "<amount> <balance> Cr|Dr". Date and
     voucher number may be on this line, an earlier one, or missing entirely —
     Tally omits a repeated date, so the last one seen carries forward, which is
     exactly what its own reader does. */
  function parse(text) {
    var lines = String(text || '').split('\n');
    var h = header(lines);
    var opening = 0, openingType = '';
    var entries = [], warnings = [];

    // Opening balance: its own line, and the ONLY money on it.
    for (var i = 0; i < lines.length; i++) {
      if (!/opening\s*balance/i.test(lines[i])) continue;
      var mo = String(lines[i]).match(MONEY);
      /* Only the MAGNITUDE is taken from this line. The Dr/Cr letter on it is
         the same contra-account trap as on every other row — "1-Apr-25 Dr
         Opening Balance 12,76,711.00" is marked Dr while the amount sits in the
         CREDIT column, because we owe it. Believing that letter flips the sign
         of the opening, which inverts the first row and cascades through the
         whole chain (it turned a ₹1,00,000 payment into a ₹24L purchase).
         openingSide() settles it with arithmetic instead. */
      if (mo) opening = num(mo[1]);
      break;
    }

    var lastDate = '', prevBal = null, prevType = '';
    for (var j = 0; j < lines.length; j++) {
      var raw = clean(lines[j]);
      if (!raw) continue;
      var d = isoDate(raw); if (d) lastDate = d;
      if (/opening\s*balance|closing\s*balance/i.test(raw)) continue;

      var m = TXN.exec(raw); if (!m) continue;
      var amt = num(m[1]), bal = num(m[2]), balType = m[3].toUpperCase() === 'CR' ? 'Cr' : 'Dr';

      // The first transaction anchors the chain to the opening balance. If the
      // ledger never printed an opening, derive it — never assume zero.
      if (prevBal == null) {
        if (!opening) { opening = round2(bal + amt); openingType = balType; warnings.push('No opening balance printed — derived from the first entry.'); }
        else openingType = openingSide(opening, amt, bal, balType, warnings);
        prevBal = opening; prevType = openingType;
      }

      /* DIRECTION FROM THE CHAIN, NOT FROM THE LETTER.
         Signed balance: Cr is what we owe (positive here), Dr is what they owe.
         The balance RISING means we owe more -> a purchase (credit).
         The balance FALLING means we paid -> a debit. */
      var signed = balType === 'Cr' ? bal : -bal;
      var prevSigned = prevType === 'Cr' ? prevBal : -prevBal;
      var delta = round2(signed - prevSigned);
      var dir = delta > 0 ? 'credit' : 'debit';

      /* The amount printed on the line and the amount implied by the chain are
         two independent readings. When they disagree the row is flagged rather
         than quietly believed — a ledger that does not tie is worth more as a
         question than as data. */
      var tie = Math.abs(Math.abs(delta) - amt) < 0.01;
      if (!tie) warnings.push('Row ' + (lastDate || '?') + ' ' + amt.toFixed(2) + ': the running balance moves ' + Math.abs(delta).toFixed(2) + ' — the two disagree.');

      entries.push({
        date: lastDate,
        amount: amt,
        dir: dir,                      // 'credit' = we owe more (his bill) · 'debit' = we paid
        balance: bal, balType: balType,
        vch: voucherNo(raw, lines[j - 1]),
        desc: describe(raw, lines, j, dir),
        tie: tie
      });
      prevBal = bal; prevType = balType;
    }

    var closing = entries.length ? entries[entries.length - 1].balance : opening;
    var closingType = entries.length ? entries[entries.length - 1].balType : (openingType || 'Cr');
    var totals = printedTotals(lines);

    return {
      party: h.party, self: h.self, from: h.from, to: h.to,
      opening: opening, openingType: openingType || 'Cr',
      entries: entries,
      closing: closing, closingType: closingType,
      printed: totals,
      warnings: warnings,
      check: verify(opening, openingType || 'Cr', entries, closing, closingType, totals)
    };
  }

  /* ── which side is the opening balance on? ──
     Not from the Dr/Cr letter printed beside it — that letter is the contra
     account's, and on this ledger it says "Dr" for a balance we plainly OWE.
     Arithmetic settles it instead: the opening is on whichever side makes the
     FIRST row's printed amount agree with the move in the running balance. Only
     one of the two can tie, so there is nothing to weigh up.

         opening Cr: 12,76,711 -> 11,76,711 = -1,00,000  ties the printed 1,00,000 ✓
         opening Dr: -12,76,711 -> 11,76,711 = +24,53,422  ties nothing        ✗ */
  function openingSide(opening, amt, bal, balType, warnings) {
    var signedBal = balType === 'Cr' ? bal : -bal;
    var fits = function (side) {
      var o = side === 'Cr' ? opening : -opening;
      return Math.abs(Math.abs(round2(signedBal - o)) - amt) < 0.01;
    };
    var cr = fits('Cr'), dr = fits('Dr');
    if (cr && !dr) return 'Cr';
    if (dr && !cr) return 'Dr';
    // Neither ties (a misread page) or both do (a zero opening) — say so rather
    // than pick, and let the gate refuse.
    warnings.push('The opening balance side could not be settled from the first entry.');
    return balType;
  }

  /* The voucher number: the integer token that is not money and not a date. It
     lands on the transaction line or the line above it, depending on how the
     columns fell. Best-effort — a wrong voucher number is cosmetic, a wrong
     amount is not, so this never affects the money. */
  function voucherNo(line, prev) {
    var strip = function (s) { return String(s || '').replace(MONEY_G, ' ').replace(DATE, ' ').replace(/\bAc\s*\d+/ig, ' ').replace(/\b\d+%/g, ' '); };
    var pick = function (s) { var m = strip(s).match(/\b(\d{1,6})\b/); return m ? m[1] : ''; };
    return pick(line) || pick(prev) || '';
  }

  /* What the row IS, in the user's words. The direction already comes from the
     chain, so this only has to label it — and it prefers the words Tally
     actually printed nearby over a guess. */
  function describe(line, lines, j, dir) {
    var near = [lines[j - 1], line, lines[j + 1]].map(clean).join(' ');
    var m = near.match(/purchase[^0-9]*?(\d+\s*%)?/i);
    if (dir === 'credit') return clean((m && m[0]) || 'Purchase');
    // strip the leading Dr/Cr: it is the contra marker, not part of the account name
    var b = near.replace(/\b(?:Dr|Cr)\s+/ig, ' ').match(/([A-Za-z][A-Za-z .&]*Ac\s*\d+)/i);
    return clean(b ? 'Payment · ' + b[1] : 'Payment');
  }

  /* The totals Tally prints at the foot: "62,01,505.60  71,46,139.00". They are
     the ledger's own arithmetic, and checking against them is how the import can
     prove it read the page correctly before writing anything. */
  function printedTotals(lines) {
    var out = { debit: null, credit: null, closing: null };
    var tail = [];
    for (var i = 0; i < lines.length; i++) {
      var L = clean(lines[i]); if (!L) continue;
      var monies = L.match(MONEY_G);
      if (!monies) continue;
      // A totals row carries two money tokens and no date.
      if (monies.length === 2 && !DATE.test(L) && !/Cr|Dr/i.test(L.replace(MONEY_G, ''))) tail.push([num(monies[0]), num(monies[1])]);
      if (/closing\s*balance/i.test(L)) { var c = L.match(MONEY); if (c) out.closing = num(c[1]); }
      // "Cr 9,44,633.40" — the closing balance printed beside its type
      var cb = L.match(/^(Cr|Dr)\s+(\d[\d,]*\.\d{2})$/i); if (cb) out.closing = num(cb[2]);
    }
    if (tail.length) { out.debit = tail[0][0]; out.credit = tail[0][1]; }
    return out;
  }

  /* ── THE GATE ──
     Nothing is written unless the file ties to its own printed totals. A
     half-read ledger silently posted into the books is worse than no import:
     it would look like a reconciliation and be a fabrication. */
  function verify(opening, openingType, entries, closing, closingType, printed) {
    var reasons = [], ok = true;
    var cr = 0, dr = 0;
    entries.forEach(function (e) { if (e.dir === 'credit') cr = round2(cr + e.amount); else dr = round2(dr + e.amount); });

    var open = openingType === 'Cr' ? opening : -opening;
    var calc = round2(open + cr - dr);
    var close = closingType === 'Cr' ? closing : -closing;
    if (Math.abs(calc - close) > 0.01) { ok = false; reasons.push('Opening ' + opening.toFixed(2) + ' + credits ' + cr.toFixed(2) + ' − debits ' + dr.toFixed(2) + ' = ' + Math.abs(calc).toFixed(2) + ', but the ledger closes at ' + closing.toFixed(2) + '.'); }

    if (printed.debit != null && Math.abs(dr - printed.debit) > 0.01) { ok = false; reasons.push('Debits read ' + dr.toFixed(2) + ' — the ledger totals ' + printed.debit.toFixed(2) + '. Rows are missing.'); }
    if (printed.credit != null && Math.abs(round2(open + cr) - printed.credit) > 0.01) { ok = false; reasons.push('Opening + credits read ' + round2(open + cr).toFixed(2) + ' — the ledger totals ' + printed.credit.toFixed(2) + '. Rows are missing.'); }
    if (printed.closing != null && Math.abs(closing - printed.closing) > 0.01) { ok = false; reasons.push('Closing read ' + closing.toFixed(2) + ' — the ledger prints ' + printed.closing.toFixed(2) + '.'); }
    if (!entries.length) { ok = false; reasons.push('No transactions could be read from this file.'); }
    var untied = entries.filter(function (e) { return !e.tie; }).length;
    if (untied) { ok = false; reasons.push(untied + ' row(s) where the printed amount and the running balance disagree.'); }

    return { ok: ok, reasons: reasons, credits: cr, debits: dr, count: entries.length };
  }

  /* ── RECONCILE: his answer next to ours ──
     `ours` is what QuickLimes already holds for this party:
       [{ date, amount, dir:'credit'|'debit', ref, src }]
     A credit is a bill he raised; a debit is money we paid him.

     Matching is on (direction, amount, date within a window) — never on the
     voucher number, which is HIS number and means nothing in our books. The
     window exists because his monthly bill is dated month-end while ours may
     carry the delivery date. */
  function reconcile(parsed, ours, opts) {
    opts = opts || {};
    var days = opts.days == null ? 7 : opts.days;
    /* TWO TOLERANCES, BECAUSE THERE ARE TWO QUESTIONS.
       verify() asks "did we read this page correctly?" — that must tie to the
       paisa, and it does.
       reconcile() asks "is his entry the same event as ours?" — and the two
       systems arrive at the figure differently. Tally rounds the invoice to the
       rupee; we compute taxable x (1 + rate). His 7,42,642.00 is our
       7,42,641.90. At a 1-paisa tolerance every single bill would be reported as
       missing from BOTH sides — the screen would announce a disagreement where
       there is none, which is the most damaging thing it could say. A rupee is
       nobody's real difference. */
    var tol = opts.tol == null ? 1 : opts.tol;
    var mine = (ours || []).map(function (o, i) { return { i: i, date: o.date || '', amount: +o.amount || 0, dir: o.dir, ref: o.ref || '', src: o.src || '', used: false }; });
    var both = [], onlyLedger = [], onlyOurs = [];

    (parsed.entries || []).forEach(function (e) {
      var hit = null, bestD = 1e9;
      for (var k = 0; k < mine.length; k++) {
        var o = mine[k];
        if (o.used || o.dir !== e.dir) continue;
        if (Math.abs(o.amount - e.amount) > tol) continue;   // beyond a rupee it is a different entry, not a rounding
        var d = Math.abs(dayGap(o.date, e.date));
        if (d <= days && d < bestD) { bestD = d; hit = o; }
      }
      if (hit) { hit.used = true; both.push({ ledger: e, ours: hit, dayGap: bestD }); }
      else onlyLedger.push(e);
    });
    mine.forEach(function (o) { if (!o.used) onlyOurs.push(o); });

    var sum = function (a, dir) { return round2(a.reduce(function (s, x) { return s + ((x.dir || (x.ledger && x.ledger.dir)) === dir ? (x.amount || x.ledger.amount) : 0); }, 0)); };
    return {
      both: both, onlyLedger: onlyLedger, onlyOurs: onlyOurs,
      missingHere: { credits: sum(onlyLedger, 'credit'), debits: sum(onlyLedger, 'debit') },
      missingThere: { credits: sum(onlyOurs, 'credit'), debits: sum(onlyOurs, 'debit') },
      theirClosing: parsed.closing, theirClosingType: parsed.closingType
    };
  }
  function dayGap(a, b) {
    if (!a || !b) return 1e9;
    return Math.round((new Date(a + 'T00:00') - new Date(b + 'T00:00')) / 86400000);
  }

  /* ── "the party we pay every month", from his own ledger ──
     The same rule the bank matcher uses: DIFFERENT months, not just several
     payments. Here it is a description of the arrangement, never a licence to
     post anything. */
  function rhythm(parsed) {
    var bills = (parsed.entries || []).filter(function (e) { return e.dir === 'credit'; });
    var pays = (parsed.entries || []).filter(function (e) { return e.dir === 'debit'; });
    var mset = {}; bills.forEach(function (b) { if (b.date) mset[b.date.slice(0, 7)] = 1; });
    var months = Object.keys(mset).length;
    var monthEnd = bills.length ? bills.filter(function (b) { return isMonthEnd(b.date); }).length / bills.length : 0;
    var amts = bills.map(function (b) { return b.amount; }).sort(function (x, y) { return x - y; });
    var med = amts.length ? (amts.length % 2 ? amts[(amts.length - 1) / 2] : round2((amts[amts.length / 2 - 1] + amts[amts.length / 2]) / 2)) : 0;
    return {
      billsPerMonth: months ? round2(bills.length / months) : 0,
      months: months, bills: bills.length, payments: pays.length,
      medianBill: med,
      consolidatedMonthly: months >= 3 && monthEnd >= 0.8 && bills.length / Math.max(1, months) <= 1.2,
      payPerBill: bills.length ? round2(pays.length / bills.length) : 0
    };
  }
  function isMonthEnd(iso) {
    if (!iso) return false;
    var d = new Date(iso + 'T00:00'), n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === n;
  }

  var API = { parse: parse, reconcile: reconcile, rhythm: rhythm, isoDate: isoDate, verify: verify, header: header, printedTotals: printedTotals };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.LedgerCore = API;
})(typeof window !== 'undefined' ? window : globalThis);
