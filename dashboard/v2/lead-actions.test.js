/* lead-actions.test.js — Assess & Message are useful and never fabricate. */
'use strict';
const LA = require('./lead-actions.js');
const LM = require('./lime-market.js');
const IND = LM.INDUSTRIES;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ Lead actions · assess + message ═══\n');

/* ── industry matching ── */
{
  ok(LA.matchIndustry('Steel', IND).key === 'steel', '"Steel" → steel');
  ok(LA.matchIndustry('sugar mill', IND).key === 'sugar', '"sugar mill" → sugar');
  ok(LA.matchIndustry('Chemicals', IND).key === 'chemical', '"Chemicals" → chemical');
  ok(LA.matchIndustry('', IND) === null && LA.matchIndustry('llamas', IND) === null, 'unknown/empty → null (not a wrong guess)');
}

/* ── assess ── */
{
  const a = LA.assess({ industry: 'Steel', phone: '9460034743' }, IND, { score: 88, tier: 'high', why: ['own-margin fit'] });
  ok(a.matched && a.industry === 'Steel Plants', 'a steel lead is assessed against the steel playbook');
  ok(a.points.some(p => /Ask for/.test(p.k)) && a.points.some(p => /consumption/i.test(p.k)), '  briefing carries who-to-ask + consumption');
  ok(a.points.some(p => /Fit/.test(p.k) && /88/.test(p.v)), '  and the ICP fit score when known');
  ok(/purchase|raw material/i.test(a.approach), '  the approach names a real role');
  const noPhone = LA.assess({ industry: 'Steel' }, IND, null);
  ok(noPhone.points.some(p => /none/.test(p.v)), 'a lead with no contact is TOLD so, not handed a fake one');
  const unknown = LA.assess({ industry: 'quantum widgets', name: 'X' }, IND, null);
  ok(!unknown.matched && unknown.points.some(p => /confirm what they make/i.test(p.v)) && /confirm their process/i.test(unknown.approach),
    'an unrecognised industry is flagged, not force-fit');
}

/* ── message draft (TEXT only — wa-core owns the recipient) ── */
{
  const seller = { name: 'Gotan Lime Industries', city: 'Gotan, Rajasthan', phone: '9460034743' };
  const wa = LA.draft({ name: 'Marudhar Steel', industry: 'Steel', phone: '098765 43210' }, seller, IND);
  ok(wa.hasPhone === true && wa.hasEmail === false, 'a lead with a phone is flagged hasPhone (caller routes it via wa-core)');
  ok(/Gotan Lime Industries/.test(wa.text) && /Marudhar Steel/.test(wa.text), '  the message names the seller and the lead');
  ok(/steel/i.test(wa.text), '  and references their industry');
  ok(/quick lime|hydrated/i.test(wa.text.toLowerCase()), '  and what we actually sell');
  ok(!/wa\.me|mailto:/.test(wa.text) && wa.waUrl === undefined, '  it does NOT build a wa.me/mailto itself (wa-core decides the recipient)');

  const em = LA.draft({ name: 'Acme Paper', industry: 'Paper', email: 'buy@acme.in' }, seller, IND);
  ok(em.hasPhone === false && em.hasEmail === true, 'no phone but an email → hasEmail');

  const none = LA.draft({ name: 'Nobody Ltd' }, seller, IND);
  ok(!none.hasPhone && !none.hasEmail && none.text.length > 0, 'no contact → text to copy, but nothing auto-addressed (no invented recipient)');
}

/* ── pure ── */
{
  const src = require('fs').readFileSync(__dirname + '/lead-actions.js', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  ok(!/document\.|fetch\(|localStorage/.test(src), 'pure module — no DOM/network/storage');
}

/* ── Outreach Studio composer (compose + refine) ── */
{
  const lead = { name: 'Marudhar Steel Works', industry: 'Steel', city: 'Raipur', phone: '9460034743', email: 'x@y.com' };
  const seller = { name: 'Gotan Lime Industries', city: 'Gotan, Rajasthan', phone: '9460034743' };
  ['intro', 'followup', 'proposal', 'meeting'].forEach(t => {
    const e = LA.compose(lead, seller, LM.INDUSTRIES, { channel: 'email', type: t });
    const w = LA.compose(lead, seller, LM.INDUSTRIES, { channel: 'whatsapp', type: t });
    ok(e.subject && e.text && e.text.length > 40, `compose email/${t} has subject + body`);
    ok(w.text && w.text.length > 20, `compose whatsapp/${t} has body`);
    ok(e.text.indexOf('Gotan Lime Industries') >= 0, `compose ${t} is Gotan-Lime framed (not a stray brand)`);
  });
  const wa = LA.compose(lead, seller, LM.INDUSTRIES, { channel: 'whatsapp', type: 'intro' });
  ok(/👋|✅/.test(wa.text), 'whatsapp intro carries a friendly emoji/ticks');
  const em = LA.compose(lead, seller, LM.INDUSTRIES, { channel: 'email', type: 'intro' });
  ok(!/👋|✅/.test(em.text), 'email stays clean (no emoji)');
  ok(LA.refine(em.text, 'shorten', lead).length < em.text.length, 'refine shorten shortens');
  ok(!/👋|✅/.test(LA.refine(wa.text, 'professional', lead)), 'refine professional strips emoji');
  ok(LA.refine(em.text, 'personalize', lead).indexOf('Raipur') >= 0, 'refine personalize adds the city');
  ok(LA.refine(em.text, 'improve', lead).indexOf('trusted by plants') >= 0, 'refine improve adds a benefit line');
  ok(!/document\.|fetch\(|localStorage/.test(LA.compose.toString() + LA.refine.toString()), 'compose/refine are pure');
}

console.log(fail ? `\n❌ FAILED — Passed: ${pass} · Failed: ${fail}\n` : `\n✅ PASSED — Passed: ${pass} · Failed: ${fail}\n`);
process.exit(fail ? 1 : 0);
