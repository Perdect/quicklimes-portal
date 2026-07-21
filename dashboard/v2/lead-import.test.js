/* lead-import.test.js — a list becomes a RANKED call list, honestly.
 *
 * The point of the feature: you have 500 rows and 20 phone calls in you. These
 * pin the four promises that make the ranking trustworthy —
 *   1. the columns are found in real-world messy headers,
 *   2. a row without a company is dropped, not imported as "Unknown",
 *   3. the order is MARGIN, not size (a loss-making giant must lose to a
 *      profitable small plant — the whole reason the ICP engine exists),
 *   4. a bought list can never arrive pre-consented.
 * Runs the REAL LeadImport, and the REAL ICPCore.scoreLead as the scorer.
 *
 *   node lead-import.test.js
 */
'use strict';
const path = require('path');
const LI = require(path.join(__dirname, 'lead-import.js'));
const ICP = require(path.join(__dirname, 'icp-core.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (m, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n     got: ' + JSON.stringify(a) + '  want: ' + JSON.stringify(b));

console.log('\n═══ lead import · a list becomes a ranked call list ═══\n');

/* ══════════ 1. column auto-mapping on real-world headers ══════════ */
{
  const h = ['S.No', 'Company Name', 'Contact Person', 'Mobile No', 'City', 'State', 'Industry', 'Monthly Requirement (MT)', 'GSTIN', 'Current Supplier'];
  const m = LI.autoMap(h);
  eq('company name found', m.name, 1);
  eq('  contact person is NOT mistaken for the company', m.person, 2);
  eq('  phone found', m.phone, 3);
  eq('  city / state found', [m.city, m.state], [4, 5]);
  eq('  industry found', m.industry, 6);
  eq('  tonnage found from "Monthly Requirement (MT)"', m.tonnes, 7);
  eq('  gstin found', m.gstin, 8);
  eq('  current supplier found', m.supplier, 9);
}
{
  // The trap: a sheet whose ONLY name column is "Name" plus a "Contact Name".
  // "Company name" must not be stolen by the contact column.
  const m = LI.autoMap(['Contact Name', 'Name', 'Town']);
  ok(m.name === 1 && m.person === 0, 'a bare "Name" is the company; "Contact Name" is the person');
  eq('  "Town" maps to city', m.city, 2);
}
{
  const m = LI.autoMap(['Firm', 'Distance in KM', 'Qty']);
  eq('"Firm" is a company name', m.name, 0);
  eq('  "Distance in KM" is distance, not tonnage', m.distance, 1);
  eq('  "Qty" is tonnage', m.tonnes, 2);
}

/* ══════════ 2. building a row — and refusing a non-row ══════════ */
const mk = obj => k => (obj[k] == null ? '' : obj[k]);
{
  const l = LI.buildLead(mk({ name: '  Shree AAC Blocks Pvt Ltd ', tonnes: '1,200 MT', distance: '~145 km', gstin: '08aabcg1234h1z5', city: 'Jodhpur' }));
  eq('name is trimmed', l.name, 'Shree AAC Blocks Pvt Ltd');
  eq('  "1,200 MT" → 1200', l.tonnes, 1200);
  eq('  "~145 km" → 145', l.distanceKm, 145);
  eq('  gstin upper-cased', l.gstin, '08AABCG1234H1Z5');
}
{
  ok(LI.buildLead(mk({ name: '' })) === null, 'a row with no company name is DROPPED');
  ok(LI.buildLead(mk({ name: 'Total' })) === null, 'a "Total" footer row is dropped');
  ok(LI.buildLead(mk({ name: 'S.No' })) === null, 'a stray header repeat is dropped');
  const bad = LI.buildLead(mk({ name: 'Real Co', gstin: '08AABCG1234' }));
  eq('a malformed GSTIN is blanked, not stored', bad.gstin, '');
  const noQty = LI.buildLead(mk({ name: 'Real Co' }));
  eq('  missing tonnage is null, not 0', noQty.tonnes, null);
  eq('  missing distance is null, not 0', noQty.distanceKm, null);
}

/* ══════════ 3. industry is resolved, never invented ══════════ */
{
  const inds = ICP.INDUSTRIES;
  ok(LI.resolveIndustry('AAC', inds) === 'aac', 'an exact industry is resolved');
  ok(LI.resolveIndustry('AAC block manufacturer', inds) === 'aac', '  and found inside a phrase');
  eq('an unknown industry is BLANK, never guessed', LI.resolveIndustry('spaceship parts', inds), '');
  eq('  empty stays empty', LI.resolveIndustry('', inds), '');
}

/* ══════════ 4. THE ORDER: margin beats size ══════════
   The scorer is the real ICPCore.scoreLead. Build an ICP where AAC earns well
   and sugar LOSES money per tonne — then a huge, nearby sugar lead must rank
   BELOW a modest, distant AAC lead. This is the entire promise of the feature. */
{
  const icp = [
    { key: 'aac',   label: 'AAC blocks', revenue: 5000000, totalMargin: 1500000, marginPerTonne: 900,  tonnes: 1600, customers: 6 },
    { key: 'sugar', label: 'Sugar',      revenue: 9000000, totalMargin: -400000, marginPerTonne: -250, tonnes: 1600, customers: 4 }
  ];
  const cands = [
    { name: 'Big Sugar Mill',  industry: 'sugar', tonnes: 900, distanceKm: 30 },
    { name: 'Small AAC Plant', industry: 'aac',   tonnes: 60,  distanceKm: 260 },
    { name: 'Mystery Co',      industry: '',      tonnes: 500, distanceKm: 40 }
  ];
  const r = LI.rank(cands, icp, ICP.scoreLead);
  eq('the profitable AAC plant ranks FIRST, despite being smaller and further',
    r[0].lead.name, 'Small AAC Plant');
  ok(r.findIndex(x => x.lead.name === 'Big Sugar Mill') > 0, '  the loss-making sugar giant ranks below it');
  ok(r[0].score > r.find(x => x.lead.name === 'Big Sugar Mill').score, '  and scores strictly higher');
  const mys = r.find(x => x.lead.name === 'Mystery Co');
  eq('a row with no industry is tier "unknown" (no evidence ≠ bad)', mys.tier, 'unknown');
  ok(r.length === 3, '  nothing is silently dropped from the ranking');
  ok(r.every(x => Array.isArray(x.why)), '  every row carries its reasons');
}
{
  // Ranking must not explode when the scorer throws or is absent.
  const r = LI.rank([{ name: 'A', industry: 'aac', tonnes: 10, distanceKm: 5 }], [], () => { throw new Error('boom'); });
  eq('a scorer that throws yields tier unknown, not a crash', r[0].tier, 'unknown');
  const r2 = LI.rank([{ name: 'A' }], [], null);
  ok(r2.length === 1 && r2[0].score === 0, '  no scorer at all is survivable');
}

/* ══════════ 5. dedupe identity agrees with the CRM ══════════ */
{
  eq('GSTIN wins as identity', LI.keyOf({ name: 'X', gstin: '08AABCG1234H1Z5' }), 'G:08AABCG1234H1Z5');
  const a = LI.keyOf({ name: 'Shree AAC Blocks Pvt. Ltd.' });
  const b = LI.keyOf({ name: 'SHREE AAC BLOCKS PRIVATE LIMITED' });
  eq('the same firm written two ways collides on the name key', a, b);
  eq('  a nameless row has no key (never dedupes everything together)', LI.keyOf({ name: '' }), '');
}

/* ══════════ 6. a bought list can NEVER arrive pre-consented ══════════
   Consent under the DPDP Act belongs to a PERSON, and crm_contacts is the only
   table that stores a basis — so the guarantee is pinned on the CONTACT, which
   is what the app actually saves and what mayContact actually reads. */
{
  const c = LI.toCompany({ name: 'Bought Co', tonnes: 50, distanceKm: 100, gstin: '' }, 'aac', 'apollo');
  eq('the source is recorded on the company', c.source, 'apollo');
  eq('  the resolved industry key is used, not the raw text', c.industry, 'aac');
  ok(!('consent_basis' in c), '  a COMPANY carries no consent basis (only a person can consent)');

  const ct = LI.toContact({ name: 'Bought Co', person: 'R. Sharma', phone: '9876500000' }, 42);
  eq('the imported CONTACT carries consent_basis "purchased"', ct.consent_basis, 'purchased');
  eq('  linked to its company', ct.crm_company, 42);
  eq('  the person is used, not the firm name', ct.name, 'R. Sharma');

  // The DPDP promise this protects, proven against the REAL CRMCore gate:
  const CRM = require(path.join(__dirname, 'crm-core.js'));
  ok(!CRM.mayContact({ consent_basis: ct.consent_basis }, 'whatsapp').ok,
    '  → CRMCore still refuses to cold-WhatsApp an imported contact');
  ok(CRM.mayContact({ consent_basis: ct.consent_basis }, 'phone').ok,
    '  → but phoning a bought contact is allowed (as the law has it)');

  ok(LI.toContact({ name: 'No Person Co' }, 7) === null, 'a row with no person AND no phone makes no contact row');
  const fallback = LI.toContact({ name: 'Firm Only', phone: '9876500000' }, 7);
  eq('  a phone with no person falls back to the firm name', fallback.name, 'Firm Only');
}

/* ══════════ 7. WIRED — the engine is actually reachable ══════════
   The dominant bug class in this codebase is "built but never connected": a
   perfect core nothing calls. These pin the whole chain from the button to the
   file that must be loaded for it to work. */
{
  const fs = require('fs');
  const crm = fs.readFileSync(path.join(__dirname, 'crm.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'crm.html'), 'utf8');
  const stripped = crm.replace(/\/\*[\s\S]*?\*\//g, ' ');

  ok(/label: 'Import list'.*onClick: \(\) => importLeads\(\)/.test(stripped), 'the toolbar has an "Import list" action that calls importLeads');
  ok(/function importLeads\(\)/.test(stripped), '  importLeads exists');
  ok(/window\.LeadImport/.test(stripped) && /QLFin/.test(stripped), '  and it drives LeadImport through the QLFin import wizard');
  ok(/LI\.autoMap\(header\)/.test(stripped) && /LI\.buildLead\(get\)/.test(stripped), '  columns are auto-mapped and rows built by the tested core');
  /* Scope the ranking pin to the ROW-BUILDING path. crm.js calls LI.rank in
     other places too, so an unscoped grep passed even after the import stopped
     ranking at all — the mutation that proved it caught nothing. */
  const bi = stripped.indexOf('buildRow: get =>');
  const buildRowBlock = bi > 0 ? stripped.slice(bi, stripped.indexOf('existing:', bi)) : '';
  ok(bi > 0 && /LI\.rank\(\[lead\], icp, IC2\.scoreLead\)/.test(buildRowBlock),
    '  each imported row is scored by the ICP scorer as it is built (not sheet order)');
  ok(/LI\.toContact\(it, r\.id\)/.test(stripped), '  contacts go through toContact (which pins the consent basis)');
  ok(/LI\.keyOf/.test(stripped), '  already-in-CRM rows are skipped by the shared identity rule');

  // The half-wired trap: the button can exist while the file it needs is not loaded.
  ok(/<script src="\.\/lead-import\.js/.test(html), 'crm.html loads lead-import.js');
  ok(/<script src="\.\/finance\.js/.test(html), '  and finance.js (QLFin.importSheet / fileToRows)');
  ok(/finance\.css/.test(html), '  and finance.css (the wizard\'s styles — without it the sheet is unstyled)');
  ok(html.indexOf('lead-import.js') < html.indexOf('crm.js?'), '  lead-import.js loads BEFORE crm.js uses it');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
