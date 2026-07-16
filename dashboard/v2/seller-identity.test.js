/* seller-identity.test.js — one firm's bank account must never print on another's
 * invoice.
 *
 * From the audit. SELLER_DEFAULTS held two real firms' private banking details
 * (account numbers, IFSC) and was keyed by COMPANY NAME. Any tenant who named their
 * plant "GOTAN LIME INDUSTRIES" printed Gotan's Bank of Baroda account 33580500001254
 * on their own tax invoices — even with their own GSTIN set, because the bank fields
 * had no plant-row fallback. And `ownFirmNames` handed every tenant both firms' names,
 * so a stranger's payment could read as an internal transfer.
 *
 * The key is now the GSTIN: government-issued, unique, unforgeable by naming. A firm
 * gets these details only if it IS that firm.
 *
 *   node seller-identity.test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };

console.log('\n═══ seller identity · no cross-firm bank leak ═══\n');

/* The REAL map, pulled out of data.js as an object literal. */
function grabObject(startsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) throw new Error('not found: ' + startsWith);
  const brace = src.indexOf('{', i);
  let depth = 0, j = brace;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (!depth) break; } }
  return src.slice(brace, j + 1);
}
const MAP = vm.runInNewContext('(' + grabObject('const SELLER_BY_GSTIN =') + ')');

/* The lookup line, verbatim from data.js, is what actually decides. */
const lookupSrc = (src.match(/const seller = SELLER_BY_GSTIN\[[^\]]+\][^;]*;/) || [''])[0];
const lookup = plant => vm.runInNewContext(
  'const p = plant; ' + lookupSrc.replace('const seller', 'seller') + ' seller || {}',
  { plant, SELLER_BY_GSTIN: MAP }
);

const GOTAN_GSTIN = '08BNAPM0488E1Z3', GOTAN_ACCT = '33580500001254';

/* ══════════ 1. THE KEY IS A GSTIN, NOT A NAME ══════════ */
{
  const keys = Object.keys(MAP);
  ok(keys.length >= 1, 'the seller map has entries');
  ok(keys.every(k => /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/.test(k)),
    'EVERY key is a GSTIN, not a company name — names collide, GSTINs cannot:\n       ' + keys.join(', '));
  ok(!keys.includes('GOTAN LIME INDUSTRIES') && !keys.includes('DESHWALI MINERALS'),
    'no company NAME survives as a key');
  ok(!!MAP[GOTAN_GSTIN] && MAP[GOTAN_GSTIN].accNo === GOTAN_ACCT,
    "Gotan's own record is intact under its GSTIN (its real invoices still work)");
}

/* ══════════ 2. THE LOOKUP KEYS ON gst_number ══════════ */
{
  ok(/gst_number/.test(lookupSrc), 'the lookup reads p.gst_number');
  ok(!/plant_name/.test(lookupSrc), 'the lookup does NOT read plant_name — that was the leak');

  /* The firm itself: right GSTIN → its details. */
  const self = lookup({ plant_name: 'GOTAN LIME INDUSTRIES', gst_number: GOTAN_GSTIN });
  ok(self.accNo === GOTAN_ACCT, 'the real Gotan plant (matching GSTIN) still gets its bank account');

  /* THE ATTACK: a stranger names their plant identically but has their OWN GSTIN. */
  const impostor = lookup({ plant_name: 'GOTAN LIME INDUSTRIES', gst_number: '27AAAAA0000A1Z5' });
  ok(!impostor.accNo, 'THE LEAK, CLOSED: a same-NAMED tenant with a different GSTIN gets NO bank account');
  ok(!impostor.gstin, '  and none of the hardcoded identity');

  /* A tenant with no GSTIN set gets nothing — never a default firm's data. */
  ok(!lookup({ plant_name: 'GOTAN LIME INDUSTRIES', gst_number: '' }).accNo,
    'a plant with no GSTIN set inherits no bank account (blank beats wrong)');
  ok(!lookup({ plant_name: 'SOME OTHER FIRM' }).accNo, 'an unknown firm gets nothing');
}

/* ══════════ 3. ownFirmNames IS THE TENANT'S OWN PLANTS ══════════ */
{
  const line = (src.match(/ownFirmNames:[^,]*plants\.map[^,]*,/) || [''])[0];
  ok(/plants\.map/.test(line), 'ownFirmNames is derived from the tenant\'s own plants[]');
  ok(!/Object\.keys\(SELLER/.test(line),
    'ownFirmNames is NOT the hardcoded seller list — that leaked both firms into every tenant\'s transfer detection');
}

console.log('\n' + (fail ? '❌ FAILED' : '✅ PASSED') + ' — Passed: ' + pass + ' · Failed: ' + fail + '\n');
process.exit(fail ? 1 : 0);
