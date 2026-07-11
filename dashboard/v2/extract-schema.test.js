/* Tests for the extraction validation engine. Run: node dashboard/v2/extract-schema.test.js */
const X = require('./extract-schema.js');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗', n, x != null ? '· ' + JSON.stringify(x) : ''); } };
const eq = (n, a, b) => ok(n + ' (got ' + JSON.stringify(a) + ')', a === b);
// build a checksum-valid GSTIN from any 14-char prefix
const G = p14 => p14 + X.gstinChecksum(p14);
const IOC = G('24AAACI1681G1Z'), GOTAN = G('08BNAPM0488E1Z'), CUST = G('08ALAPD1927C1Z');

console.log('GSTIN checksum');
ok('valid gstin passes', X.validGstin(IOC));
ok('wrong check digit fails', !X.validGstin('24AAACI1681G1ZZ' === IOC ? '24AAACI1681G1ZA' : IOC.slice(0, 14) + (IOC[14] === 'A' ? 'B' : 'A')));
ok('malformed fails', !X.validGstin('08ABC'));
eq('state code', X.gstinState(IOC), '24');

console.log('fabricated-name rejection');
['the buyer. For', 'For', 'Authorised Signatory', 'Declaration', 'Buyer (Bill to)', "'s Order No. Dated",
 'Gotan To Beawar Plant', 'Village Gotan, Dist Nagaur', 'CONSIGNMENT NOTE', 'Terms and Conditions'].forEach(n =>
  ok('reject "' + n + '"', !X.plausibleName(n)));
['Indian Oil Corporation Limited', 'Mateshwari Mines and Minerals', 'Shree Ganesh Roadlines Transport Co',
 'SHREE BALAJI POLY PACK PVT LTD'].forEach(n => ok('accept "' + n + '"', X.plausibleName(n)));

console.log('party master (GSTIN wins, never a fragment)');
let r = X.resolveParty(IOC, 'the buyer. For', { [IOC]: 'Indian Oil Corporation Limited' });
eq('master heals fragment', r.name, 'Indian Oil Corporation Limited'); eq('source=master', r.source, 'master');
r = X.resolveParty(IOC, 'Indian Oil Corp', { [IOC]: 'Indian Oil Corporation Limited' });
ok('mismatch flagged', r.mismatch === true);
r = X.resolveParty('', 'the buyer. For', {});
eq('fabricated + no master → blank', r.name, '');

console.log('classify sales vs purchase (own GSTIN)');
eq('own is buyer → purchase', X.classify({ supplierGstin: IOC, buyerGstin: GOTAN }, [GOTAN]).kind, 'purchase');
eq('own is seller → sales', X.classify({ supplierGstin: GOTAN, buyerGstin: CUST }, [GOTAN]).kind, 'sales');
eq('neither → hint', X.classify({ supplierGstin: IOC, buyerGstin: CUST }, [GOTAN], 'purchase').kind, 'purchase');

console.log('validate — reconciliation & recovery');
let v = X.validate({ supplierName: 'Mateshwari Mines and Minerals', supplierGstin: CUST, buyerGstin: GOTAN,
  invoiceNo: '222/26-27', invoiceDate: '2026-06-29', taxable: null, cgst: 29008.33, sgst: 29008.33, roundOff: 0.24, grandTotal: 1218350,
  confidence: { total: 'high' } }, { ownGstins: [GOTAN] });
eq('taxable recovered from identity', v.fields.taxable, 1160333.10);
eq('gstRate from math', v.fields.gstRate, 5);
eq('classified purchase', v.cls.kind, 'purchase');
ok('status ready (all core present)', v.status === 'ready', v);

v = X.validate({ supplierName: 'X Traders', supplierGstin: CUST, buyerGstin: GOTAN, invoiceNo: '5', invoiceDate: '2026-06-01',
  taxable: 100000, cgst: 9000, sgst: 9000, grandTotal: 999999 }, { ownGstins: [GOTAN] });
ok('bad total → issue + review', v.issues.some(i => /reconcile/i.test(i)) && v.status === 'review', v.issues);

console.log('validate — never fabricate / missing gate');
v = X.validate({ supplierName: null, supplierGstin: null, invoiceNo: null, taxable: null, grandTotal: null }, {});
ok('all missing → invalid, no invented values', v.status === 'invalid' && v.fields.supplierName === null && v.fields.taxable === null, v.status);
v = X.validate({ supplierName: 'the buyer. For', supplierGstin: CUST, invoiceNo: '9', invoiceDate: '2026-06-01', taxable: 5000, grandTotal: 5000 }, {});
eq('fragment supplier blanked (not saved)', v.fields.supplierName, null);

console.log('validate — intra/inter-state consistency');
v = X.validate({ supplierName: 'A Ltd', supplierGstin: G('27AAACX1234A1Z'), buyerGstin: GOTAN, invoiceNo: '1', invoiceDate: '2026-06-01',
  taxable: 100000, cgst: 2500, sgst: 2500, grandTotal: 105000 }, { ownGstins: [GOTAN] });
ok('interstate but CGST/SGST → flagged', v.issues.some(i => /interstate/i.test(i)), v.issues);

console.log('dup key');
ok('dup key stable', X.invKey({ supplierGstin: IOC, invoiceNo: 'A1', invoiceDate: '2026-06-01', grandTotal: 100 }) ===
  X.invKey({ supplierGstin: IOC.toLowerCase(), invoiceNo: 'a1', invoiceDate: '2026-06-01', grandTotal: 100.4 }));

console.log('\n' + (fail === 0 ? '✅ ALL ' + pass + ' TESTS PASSED' : '❌ ' + fail + ' FAILED, ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
