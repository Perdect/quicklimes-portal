/* ═══════════════════════════════════════════════════════════════════════
   wa-core.js — the WhatsApp reminder/notification ENGINE.

   Pure: no DOM, no network, no globals. Runs in the browser (window.WACore)
   AND in Node (module.exports), so every rule that decides WHO gets chased
   FOR HOW MUCH is unit-tested against real-shaped data.

   This module decides and composes. It never sends. Sending is a separate,
   swappable adapter (one-tap wa.me today; a provider API later) so the rules
   below stay true regardless of how the message physically leaves.

   HARD RULES (money + a customer relationship are on the line):
     • Never chase money that isn't owed — cancelled/paid/credit-note invoices
       are out, and outstanding must equal what the register shows.
     • Never send a half-rendered message. A missing {{placeholder}} makes the
       message UNSENDABLE, never "Dear {{PartyName}}" or "₹undefined".
     • Never leak float noise into a customer's message. 18.15*12385 is
       224787.74999999997 — a customer must read ₹2,24,788, not that.
     • Never message the same party about the same invoice at the same step
       twice. A duplicate dunning message is worse than a late one.
     • Silence is opt-out: no phone / reminders switched off ⇒ no message.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WACore = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── dates (local Y-M-D only) ─────────────────────────────────────────
     NEVER toISOString() — it shifts to UTC and in IST pulls the previous day
     in, so a reminder fires a day early. This bug has been fixed here once
     already (reports date ranges); do not reintroduce it. */
  function parseD(s) {
    if (!s) return null;
    var p = String(s).split('T')[0].split('-').map(Number);
    if (p.length !== 3 || !p[0]) return null;
    var d = new Date(p[0], p[1] - 1, p[2]);
    return isNaN(d.getTime()) ? null : d;
  }
  function fmtD(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addDays(iso, n) { var d = parseD(iso); if (!d) return ''; d.setDate(d.getDate() + n); return fmtD(d); }
  function daysBetween(aISO, bISO) {              // b - a, in whole days
    var a = parseD(aISO), b = parseD(bISO);
    if (!a || !b) return null;
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }
  // Human date for a customer-facing message: 31-Dec-2025, never 2025-12-31.
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function niceDate(iso) { var d = parseD(iso); return d ? (String(d.getDate()).padStart(2, '0') + '-' + MON[d.getMonth()] + '-' + d.getFullYear()) : ''; }

  /* ── money ────────────────────────────────────────────────────────────
     Whole rupees, Indian grouping. Rounded FIRST: the same float-noise class
     of bug that put "244282.500000000000" in an export would otherwise put it
     in a customer's WhatsApp message. */
  function money(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';                            // never "NaN"/"Infinity" to a customer
    return Math.round(v).toLocaleString('en-IN');
  }

  /* ── phone ────────────────────────────────────────────────────────────
     Indian numbers. Returns '' when we cannot be SURE — a reminder sent to a
     wrong number is a real leak of one customer's balance to another. */
  function normalizePhone(raw, cc) {
    cc = cc || '91';
    var d = String(raw == null ? '' : raw).replace(/\D/g, '');
    if (!d) return '';
    if (d.length > 12 && d.slice(0, 2) === '00') d = d.slice(2);      // 0091…
    if (d.length === 11 && d[0] === '0') d = d.slice(1);              // STD 0…
    if (d.length === 10) return /^[6-9]/.test(d) ? cc + d : '';       // Indian mobiles start 6-9
    if (d.length === 12 && d.slice(0, 2) === cc) return /^[6-9]/.test(d.slice(2)) ? d : '';
    if (d.length >= 11 && d.length <= 15) return d;                   // an already-qualified intl number
    return '';                                                        // landline / junk / truncated
  }

  /* ── is this number reachable on WhatsApp at all? ──────────────────────
     normalizePhone() sees digits only, and that is not enough: an Ahmedabad
     landline (079 4023 5235) reduces to 7940235235 — ten digits starting 7,
     identical in shape to a mobile. The user hit exactly this and got "The
     phone number +917940235235 isn't on WhatsApp."

     The RAW string still carries the answer in two places:
       • a leading trunk 0 marks a landline;
       • Indian landlines are written STD + subscriber (79 4023 5235 /
         124 494 2555), while mobiles come as one 10-digit run or 5+5.
     Directory sources (Google Places, OSM) preserve that grouping, so we read
     it instead of discarding it.

     Deliberately biased towards hiding: a hidden button on a real mobile costs
     one tap on Call, while a shown button on a landline opens a dead chat. */
  function isMobileNumber(raw, cc) {
    cc = cc || '91';
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return false;
    var nat = s.replace(/^\+?(?:00)?/, '');
    if (nat.indexOf(cc) === 0 && nat.replace(/\D/g, '').length > 10) nat = nat.slice(cc.length);
    nat = nat.replace(/^[\s\-()]+/, '');
    /* No explicit trunk-0 rule: every leading-0 form is already rejected by
       the grouping rule (079 4023 5235) or by the length rule (07940235235 is
       11 digits). A branch no test can fail is a branch that rots. */
    var groups = nat.split(/[\s\-().]+/).filter(Boolean);
    if (groups.length > 1 && /^\d{2,4}$/.test(groups[0])) return false;   // STD code + subscriber
    var d = nat.replace(/\D/g, '');
    if (d.length !== 10) return false;
    return /^[6-9]/.test(d);                                  // Indian mobile series
  }

  /* ── templates ────────────────────────────────────────────────────────
     Text is data, not code — these are defaults the user can override, and
     the same strings are what get submitted to Meta for template approval
     when a provider is connected. */
  var TEMPLATES = {
    invoice: 'Dear {{PartyName}},\nYour Invoice {{InvoiceNo}} for ₹{{Amount}} has been generated.\nInvoice Date: {{InvoiceDate}}\nPlease find the invoice attached.\nThank you.',
    reminder: 'Dear {{PartyName}},\nThis is a friendly reminder that Invoice {{InvoiceNo}} amounting to ₹{{BalanceAmount}} is due on {{DueDate}}.\nCurrent Outstanding: ₹{{Outstanding}}\nKindly arrange payment.\nThank you.',
    overdue: 'Dear {{PartyName}},\nInvoice {{InvoiceNo}} for ₹{{BalanceAmount}} was due on {{DueDate}} and is now {{DaysOverdue}} days overdue.\nCurrent Outstanding: ₹{{Outstanding}}\nKindly arrange payment.\nThank you.',
    statement: 'Dear {{PartyName}},\nYour account statement as on {{Today}}:\nTotal Outstanding: ₹{{Outstanding}} across {{BillCount}} invoice(s).\nOldest pending: {{OldestInvoice}} ({{OldestDays}} days).\nThank you.',
    dispatch: 'Dear {{PartyName}},\nYour order has been dispatched.\nVehicle Number: {{VehicleNo}}\nMaterial: {{Material}}\nQuantity: {{Quantity}}\nE-Way Bill: {{EwayBillNo}}\nThank you.'
  };

  /* render(tpl, vars) -> { text, missing[] }
     A placeholder with no value makes the message UNSENDABLE. We do NOT
     silently blank it: "Vehicle Number: " tells the customer nothing and looks
     broken; "{{VehicleNo}}" looks worse. The caller must not send it. */
  function render(tpl, vars) {
    var missing = [];
    var text = String(tpl == null ? '' : tpl).replace(/\{\{(\w+)\}\}/g, function (_, k) {
      var v = vars ? vars[k] : undefined;
      if (v === undefined || v === null || String(v).trim() === '') { missing.push(k); return '{{' + k + '}}'; }
      return String(v);
    });
    return { text: text, missing: missing };
  }

  /* ── schedule ─────────────────────────────────────────────────────────
     Offsets in days RELATIVE TO THE DUE DATE. Negative = before it.
     -3 and -1 are courtesy nudges; 0 is due day; positive are overdue chases. */
  var DEFAULT_SCHEDULE = [-3, -1, 0, 3, 7, 15, 30];

  function dueDateOf(invDate, creditDays) {
    var cd = Number(creditDays);
    if (!isFinite(cd) || cd < 0) cd = 0;
    return addDays(invDate, cd);              // creditDays 0 ⇒ due on invoice date
  }

  /* stepFor(due, today, schedule) -> the schedule offset that fires TODAY, or null.
     Exact match only: a reminder is an event on a specific day, not a state.
     Missing a day (phone off, app closed) does NOT fire a stale reminder later —
     the next scheduled step does. That is deliberate: a customer receiving
     "3 days before due" a week AFTER the due date destroys trust in the system. */
  function stepFor(dueISO, todayISO, schedule) {
    var offs = schedule && schedule.length ? schedule : DEFAULT_SCHEDULE;
    var delta = daysBetween(dueISO, todayISO);      // today - due; +5 = 5 days overdue
    if (delta === null) return null;
    return offs.indexOf(delta) >= 0 ? delta : null;
  }

  function stepLabel(step) {
    if (step < 0) return Math.abs(step) + ' day' + (step === -1 ? '' : 's') + ' before due';
    if (step === 0) return 'Due today';
    return step + ' day' + (step === 1 ? '' : 's') + ' overdue';
  }

  /* A send is identified by party + invoice + step. Same key ⇒ already sent,
     never send again. Not date-based: if the app is opened twice on the same
     day, or the due date is recomputed, the customer must not be chased twice. */
  function sendKey(party, inv, step) {
    return String(party || '').trim().toUpperCase() + '|' + String(inv || '').trim().toUpperCase() + '|' + step;
  }

  /* ── the plan ─────────────────────────────────────────────────────────
     planReminders(o) -> [task]
       o.sales    : rows from QLD.salesRows() (needs: inv, date, party, outstanding, status, total)
       o.parties  : rows from QLD.partyRows() (needs: name, phone, creditDays; opt: wa, waAlt, autoRemind)
       o.today    : 'YYYY-MM-DD'
       o.schedule : offsets (default DEFAULT_SCHEDULE)
       o.sentKeys : array/Set of sendKey() already sent — the dedupe memory
       o.templates: { reminder, overdue } overrides
     A task is one INVOICE at one STEP. Outstanding is the party's whole book,
     because that is the number the customer argues about. */
  function planReminders(o) {
    o = o || {};
    var today = o.today || fmtD(new Date());
    var sched = o.schedule && o.schedule.length ? o.schedule : DEFAULT_SCHEDULE;
    var tpl = o.templates || {};
    var sent = o.sentKeys instanceof Set ? o.sentKeys : new Set(o.sentKeys || []);
    var parties = {};
    (o.parties || []).forEach(function (p) { parties[String(p.name || '').trim().toUpperCase()] = p; });

    // Only real, still-owed customer money. This mirrors QLD.collections():
    // outstanding > 0.5 (paise dust is not a debt) and never a cancelled bill.
    var live = (o.sales || []).filter(function (r) {
      return r && r.status !== 'cancelled' && Number(r.outstanding) > 0.5;
    });

    // Party-level outstanding: what the customer owes in total, today.
    var outByParty = {}, billsByParty = {};
    live.forEach(function (r) {
      var k = String(r.party || '').trim().toUpperCase();
      outByParty[k] = (outByParty[k] || 0) + Number(r.outstanding);
      (billsByParty[k] = billsByParty[k] || []).push(r);
    });

    var tasks = [];
    live.forEach(function (r) {
      var key = String(r.party || '').trim().toUpperCase();
      var p = parties[key] || {};
      // Opt-out is absolute. autoRemind === false means the human said no.
      if (p.autoRemind === false) return;

      var due = dueDateOf(r.date, p.creditDays);
      var step = stepFor(due, today, sched);
      if (step === null) return;                       // nothing scheduled for this invoice today

      var k = sendKey(r.party, r.inv, step);
      if (sent.has(k)) return;                         // already chased on this exact step

      var phone = normalizePhone(p.wa || p.phone, o.cc);
      var overdue = step > 0;
      var vars = {
        PartyName: r.party, InvoiceNo: r.inv, InvoiceDate: niceDate(r.date),
        Amount: money(r.total), BalanceAmount: money(r.outstanding),
        DueDate: niceDate(due), Outstanding: money(outByParty[key]),
        DaysOverdue: overdue ? String(step) : '', Today: niceDate(today)
      };
      var out = render(overdue ? (tpl.overdue || TEMPLATES.overdue) : (tpl.reminder || TEMPLATES.reminder), vars);

      tasks.push({
        key: k, kind: overdue ? 'overdue' : 'reminder', step: step, stepLabel: stepLabel(step),
        party: r.party, phone: phone, inv: r.inv, invDate: r.date, due: due,
        balance: Number(r.outstanding), outstanding: outByParty[key], bills: billsByParty[key].length,
        text: out.text, missing: out.missing,
        // sendable is the ONLY gate the UI should trust. Reasons are shown, not hidden:
        // a customer we cannot reach is a collections problem the owner must see.
        sendable: !!phone && out.missing.length === 0,
        reason: !phone ? 'No WhatsApp number on file' : (out.missing.length ? 'Incomplete message: missing ' + out.missing.join(', ') : '')
      });
    });

    // Most overdue and biggest money first — that is the order a human chases.
    tasks.sort(function (a, b) { return (b.step - a.step) || (b.balance - a.balance); });
    return tasks;
  }

  /* Party-level statement task (daily/weekly/monthly), one per party. */
  function planStatements(o) {
    o = o || {};
    var today = o.today || fmtD(new Date());
    var tpl = (o.templates || {}).statement || TEMPLATES.statement;
    var parties = {};
    (o.parties || []).forEach(function (p) { parties[String(p.name || '').trim().toUpperCase()] = p; });
    var live = (o.sales || []).filter(function (r) { return r && r.status !== 'cancelled' && Number(r.outstanding) > 0.5; });

    var by = {};
    live.forEach(function (r) {
      var k = String(r.party || '').trim().toUpperCase();
      by[k] = by[k] || { party: r.party, total: 0, bills: 0, oldest: r.date, oldestInv: r.inv };
      by[k].total += Number(r.outstanding); by[k].bills++;
      if (r.date < by[k].oldest) { by[k].oldest = r.date; by[k].oldestInv = r.inv; }
    });

    return Object.keys(by).map(function (k) {
      var g = by[k], p = parties[k] || {};
      if (p.autoStatement === false) return null;
      var phone = normalizePhone(p.wa || p.phone, o.cc);
      var days = daysBetween(g.oldest, today);
      var out = render(tpl, {
        PartyName: g.party, Today: niceDate(today), Outstanding: money(g.total),
        BillCount: String(g.bills), OldestInvoice: g.oldestInv, OldestDays: String(days)
      });
      return {
        key: sendKey(g.party, 'STATEMENT', today), kind: 'statement', party: g.party, phone: phone,
        outstanding: g.total, bills: g.bills, oldest: g.oldest, days: days,
        text: out.text, missing: out.missing,
        sendable: !!phone && out.missing.length === 0,
        reason: !phone ? 'No WhatsApp number on file' : ''
      };
    }).filter(Boolean).sort(function (a, b) { return b.outstanding - a.outstanding; });
  }

  /* Dispatch notification for one sale. */
  function planDispatch(sale, party, o) {
    o = o || {};
    var out = render((o.templates || {}).dispatch || TEMPLATES.dispatch, {
      PartyName: sale.party, VehicleNo: sale.veh, Material: sale.product || sale.item,
      Quantity: sale.qty != null ? String(sale.qty) + ' T' : '', EwayBillNo: sale.eway || sale.ewayBill
    });
    var phone = normalizePhone((party || {}).wa || (party || {}).phone, o.cc);
    return {
      key: sendKey(sale.party, sale.inv, 'DISPATCH'), kind: 'dispatch', party: sale.party, phone: phone,
      inv: sale.inv, text: out.text, missing: out.missing,
      sendable: !!phone && out.missing.length === 0,
      reason: !phone ? 'No WhatsApp number on file' : (out.missing.length ? 'Missing ' + out.missing.join(', ') : '')
    };
  }

  /* ── campaign filters ─────────────────────────────────────────────────
     Used by both bulk campaigns and the AI assistant ("above ₹50,000").
     f: { minOutstanding, maxOutstanding, state, city, type, minCreditDays,
          maxCreditDays, minStep } */
  function filterTasks(tasks, f, parties) {
    f = f || {};
    var pmap = {};
    (parties || []).forEach(function (p) { pmap[String(p.name || '').trim().toUpperCase()] = p; });
    return (tasks || []).filter(function (t) {
      var p = pmap[String(t.party || '').trim().toUpperCase()] || {};
      if (f.minOutstanding != null && !(t.outstanding >= f.minOutstanding)) return false;
      if (f.maxOutstanding != null && !(t.outstanding <= f.maxOutstanding)) return false;
      if (f.minStep != null && !(t.step >= f.minStep)) return false;
      if (f.state && String(p.state || '').toUpperCase().indexOf(String(f.state).toUpperCase()) < 0) return false;
      if (f.city && String(p.city || p.address || '').toUpperCase().indexOf(String(f.city).toUpperCase()) < 0) return false;
      if (f.type && String(p.type || '').toLowerCase() !== String(f.type).toLowerCase()) return false;
      if (f.minCreditDays != null && !((+p.creditDays || 0) >= f.minCreditDays)) return false;
      if (f.maxCreditDays != null && !((+p.creditDays || 0) <= f.maxCreditDays)) return false;
      return true;
    });
  }

  /* One-tap send link. This is the ONLY transport available until a provider
     is connected, and it is honest: it opens WhatsApp with the message ready
     and the human presses send. No API, no cost, no template approval. */
  function waLink(phone, text) {
    var p = normalizePhone(phone);
    return 'https://wa.me/' + p + (text ? '?text=' + encodeURIComponent(text) : '');
  }

  return {
    normalizePhone: normalizePhone,
    isMobileNumber: isMobileNumber, money: money, niceDate: niceDate,
    addDays: addDays, daysBetween: daysBetween, dueDateOf: dueDateOf,
    stepFor: stepFor, stepLabel: stepLabel, sendKey: sendKey, render: render,
    planReminders: planReminders, planStatements: planStatements, planDispatch: planDispatch,
    filterTasks: filterTasks, waLink: waLink,
    TEMPLATES: TEMPLATES, DEFAULT_SCHEDULE: DEFAULT_SCHEDULE
  };
}));
