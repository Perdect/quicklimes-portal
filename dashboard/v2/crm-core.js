/* ═══════════════════════════════════════════════════════════════════════
   crm-core.js — pipeline rules, forecast maths, and the consent gate.

   Pure: browser (window.CRMCore) + Node (module.exports), so the rules that
   decide what your pipeline is worth — and whether you may lawfully contact
   someone — are unit-tested rather than trusted.

   THE THREE THINGS THIS PROTECTS
   1. CONSENT. India's DPDP Act 2023 treats a purchase manager's mobile as
      personal data even in B2B. Buying a list does not create a lawful basis
      to message them, and an opt-out is absolute and permanent. mayContact()
      is the single gate; nothing should message a contact without asking it.
   2. THE FORECAST. A pipeline number that flatters you is worse than none —
      you staff and buy limestone against it. Weighted by stage, never by hope.
   3. THE TRUTH ABOUT A LEAD'S VALUE. Value is tonnes × price, and if either is
      unknown the value is unknown — not zero, and not a guess.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CRMCore = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── stages ───────────────────────────────────────────────────────────
     Probabilities are the DEFAULT prior, not a fact. They exist so the
     forecast is weighted by evidence instead of optimism: a plant that has
     quoted 100 customers and won 20 should not be told its pipeline is worth
     100 orders. Calibrate them from real win rates once there is history —
     `winRates()` below computes exactly that. */
  var STAGES = [
    { key: 'new',       label: 'New',            p: 0.05, open: true },
    { key: 'contacted', label: 'Contacted',      p: 0.10, open: true },
    { key: 'qualified', label: 'Qualified',      p: 0.25, open: true },
    { key: 'sampled',   label: 'Sample sent',    p: 0.40, open: true },  // lime is bought on CaO — the sample IS the sales pitch
    { key: 'quoted',    label: 'Quoted',         p: 0.55, open: true },
    { key: 'negotiat',  label: 'Negotiating',    p: 0.75, open: true },
    { key: 'won',       label: 'Won',            p: 1.00, open: false },
    { key: 'lost',      label: 'Lost',           p: 0.00, open: false }
  ];
  var byKey = {};
  STAGES.forEach(function (s) { byKey[s.key] = s; });
  function stage(k) { return byKey[k] || null; }
  function stageLabel(k) { var s = stage(k); return s ? s.label : (k || 'Unknown'); }
  function isOpen(k) { var s = stage(k); return !!(s && s.open); }
  function stageIndex(k) { for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === k) return i; return -1; }

  /* A lead moves forward one step at a time, but may be lost from anywhere and
     may be re-opened. Skipping "quoted" straight to "won" is not process
     policing — it means the quote was never recorded, so the win has no price
     and the forecast learns nothing. */
  function canMove(from, to) {
    if (from === to) return { ok: true };
    if (!stage(from) || !stage(to)) return { ok: false, why: 'Unknown stage' };
    if (to === 'lost') return { ok: true };
    if (from === 'lost') return { ok: true, why: 'Re-opening a lost lead' };
    if (to === 'won' && from !== 'quoted' && from !== 'negotiat') {
      return { ok: false, why: 'Record the quote first — a win with no price teaches the forecast nothing' };
    }
    var a = stageIndex(from), b = stageIndex(to);
    if (b < a) return { ok: true, why: 'Moving backwards' };
    return { ok: true };
  }

  /* ── value ────────────────────────────────────────────────────────────
     Unknown is NULL, never 0. A pipeline of 40 leads worth "0" reads as
     nothing at stake; a pipeline of 40 leads where 30 have no price reads as
     "go and get the prices" — which is the truth and the action. */
  function leadValue(l) {
    if (!l) return null;
    var t = Number(l.tonnes), p = Number(l.price_per_tonne != null ? l.price_per_tonne : l.pricePerTonne);
    if (!isFinite(t) || !isFinite(p) || t <= 0 || p <= 0) return null;
    return Math.round(t * p * 100) / 100;      // paise, then rounded — never raw float noise
  }
  function weightedValue(l) {
    var v = leadValue(l); if (v === null) return null;
    var s = stage(l.stage); if (!s) return null;
    return Math.round(v * s.p * 100) / 100;
  }

  /* forecast(leads) -> { open, valued, unvalued, gross, weighted, byStage[] }
     `gross` is the daydream; `weighted` is the number you may plan against;
     `unvalued` is how much of the pipeline you are flying blind on. All three
     are reported because showing only one of them is how a forecast lies. */
  function forecast(leads) {
    var open = (leads || []).filter(function (l) { return isOpen(l.stage); });
    var gross = 0, weighted = 0, valued = 0, unvalued = 0;
    open.forEach(function (l) {
      var v = leadValue(l);
      if (v === null) { unvalued++; return; }
      valued++; gross += v; weighted += weightedValue(l);
    });
    var byStage = STAGES.filter(function (s) { return s.open; }).map(function (s) {
      var rows = open.filter(function (l) { return l.stage === s.key; });
      var g = rows.reduce(function (a, l) { return a + (leadValue(l) || 0); }, 0);
      return { key: s.key, label: s.label, p: s.p, count: rows.length, gross: g, weighted: Math.round(g * s.p) };
    });
    return {
      open: open.length, valued: valued, unvalued: unvalued,
      gross: Math.round(gross), weighted: Math.round(weighted), byStage: byStage
    };
  }

  /* winRates(leads) -> per-stage evidence from CLOSED leads.
     Once there is history, this is what the stage priors should be replaced
     with. Below `min` it returns null rather than a rate off three leads —
     the same rule as the reorder engine: too little history is not a pattern. */
  function winRates(leads, min) {
    min = min || 5;
    var closed = (leads || []).filter(function (l) { return l.stage === 'won' || l.stage === 'lost'; });
    var won = closed.filter(function (l) { return l.stage === 'won'; }).length;
    return {
      closed: closed.length, won: won,
      rate: closed.length >= min ? Math.round(won / closed.length * 100) / 100 : null,
      confident: closed.length >= min,
      why: closed.length >= min ? null : closed.length + ' closed lead(s) — need ' + min + ' before a win rate means anything'
    };
  }

  /* ── consent (DPDP Act 2023) ──────────────────────────────────────────
     mayContact(contact, channel) -> { ok, why }
     Bases, weakest to strongest:
       'none'      — we hold a number and nothing else. NOT a basis.
       'purchased' — a bought list. NOT a basis to message. Legitimate to hold,
                     not to WhatsApp.
       'inbound'   — they contacted us. Reply freely.
       'consent'   — they said yes, and when.
       'contract'  — an existing customer: invoices and dispatches are the
                     performance of a contract they entered.
     An opt-out beats every one of them, forever. */
  var BASES = { none: 0, purchased: 1, inbound: 2, consent: 3, contract: 3 };
  function mayContact(c, channel) {
    c = c || {};
    if (c.opted_out_at || c.optedOutAt) return { ok: false, why: 'They opted out — never contact again on any channel' };
    var basis = String(c.consent_basis || c.consentBasis || 'none');
    if (!(basis in BASES)) return { ok: false, why: 'Unknown consent basis "' + basis + '"' };
    if (basis === 'none') return { ok: false, why: 'No lawful basis on file — record how you got this contact first' };
    if (basis === 'purchased') {
      // A bought list is the ONE case where the channel decides. Cold email to
      // a business address is defensible; a cold WhatsApp to a personal mobile
      // is both a DPDP problem and the fastest way to get the number banned.
      if (channel === 'whatsapp') return { ok: false, why: 'Bought contact — cold WhatsApp is not lawful basis, and it is what gets numbers banned. Email or phone first.' };
      if (channel === 'email') return { ok: true, why: 'Cold email to a business address — include an unsubscribe' };
      return { ok: true, why: 'Phone call is fine; do not WhatsApp until they reply' };
    }
    return { ok: true, why: basis === 'contract' ? 'Existing customer' : (basis === 'inbound' ? 'They contacted you first' : 'They consented') };
  }

  /* ── company de-duplication ───────────────────────────────────────────
     Bought lists and referrals WILL collide with customers you already have.
     Two rows for one company means two salesmen calling the same buyer with
     two prices, which is worse than never calling at all.
     GSTIN is the only true identity in India; a normalised name is a hint. */
  var normName = function (s) {
    return String(s == null ? '' : s).toUpperCase()
      .replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|INC|CO|COMPANY|THE|M\/S|AND|&)\b/g, ' ')
      .replace(/[^A-Z0-9]+/g, ' ').trim();
  };
  function dupeOf(cand, existing) {
    cand = cand || {};
    var g = String(cand.gstin || '').toUpperCase().replace(/\s/g, '');
    var n = normName(cand.name);
    var hitG = null, hitN = null;
    (existing || []).forEach(function (e) {
      var eg = String(e.gstin || '').toUpperCase().replace(/\s/g, '');
      if (g && eg && g === eg && !hitG) hitG = e;
      if (n && normName(e.name) === n && !hitN) hitN = e;
    });
    if (hitG) return { dupe: true, of: hitG, on: 'gstin', certain: true };
    if (hitN) return { dupe: true, of: hitN, on: 'name', certain: false };
    return { dupe: false, of: null, on: null, certain: false };
  }

  /* nextActions(leads, today) — the call list. Overdue first: a lead with a
     next action three days past is the one quietly dying. */
  function nextActions(leads, todayISO) {
    var t = todayISO || (function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
    return (leads || []).filter(function (l) { return isOpen(l.stage) && l.next_action_at; })
      .map(function (l) {
        var overdue = l.next_action_at < t;
        return {
          lead: l, due: l.next_action_at, overdue: overdue,
          days: Math.round((new Date(t) - new Date(l.next_action_at)) / 86400000),
          value: leadValue(l), weighted: weightedValue(l)
        };
      })
      .filter(function (x) { return x.due <= t; })
      .sort(function (a, b) { return (a.due < b.due ? -1 : a.due > b.due ? 1 : (b.weighted || 0) - (a.weighted || 0)); });
  }

  return {
    STAGES: STAGES, stage: stage, stageLabel: stageLabel, isOpen: isOpen, canMove: canMove,
    leadValue: leadValue, weightedValue: weightedValue, forecast: forecast, winRates: winRates,
    mayContact: mayContact, dupeOf: dupeOf, normName: normName, nextActions: nextActions
  };
}));
