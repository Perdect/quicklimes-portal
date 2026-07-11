/* ═══════════════════════════════════════════════════════════════════════
   BillOCR — PERMANENT regression suite.  Run: node dashboard/v2/bill-ocr.regression.js
   Every supported invoice format has an expected-JSON fixture. The runner
   parses each, compares EVERY field, fails on ANY difference, and prints a
   field-level confidence report. This is the gate before any OCR change ships.
   ═══════════════════════════════════════════════════════════════════════ */
const OCR = require('./bill-ocr.js');
const OWN = { ownGstins: ['08AABCG1234H1Z5', '08BNAPM0488E1Z3', '08AADFD5678K1Z9'], ownNames: ['GOTAN LIME INDUSTRIES', 'DESHWALI MINERALS'] };

/* Each fixture: { name, format, text, expect:{…} }. `expect` lists ONLY the
   fields that appear on that bill; a field set to null MUST come back blank
   (the parser must never invent it). */
const CORPUS = [
  {
    name: 'Indian Oil Corporation (IOC) — pet coke, IGST', format: 'PDF · columnar · Integrated Tax',
    text: `INVOICE UNDER RULE 46 of GST Rules
Indian Oil Corporation Limited
Doc.Name & number IRN: 23e75664460d6a03684ca14931fcd6851a8
TAX INVOICE 20273121B007217
Form No AC4 31A SAP Doc no.7007959119 Date 23-Jun-26 Time 15:12
Del Mode Road T.T.No. RJ19GE8199
Supplier Recipient (Ship to party)
Name & Address Tin : 24073200438 376530 (Mob No.-Ajij Mohma)
GST Registration No GSTIN 08BNAPM0488E1Z3
GSTIN 24AAACI1681G1ZV BNAPM0488E
Reverse Charge Applicable - No
Item Material Description Quantity Unit Rate Unit HSN code Total
10 178100 FUEL GRADE PET COKE (BULK) 32.380 TO 16220.000 TO 271311
Taxable Value 32.380 TO 16220.000 TO 525203.60
JOIG IN: Integrated Tax 18.000 % 94536.65
Density@15: 0.000 Total for material 619740.25
Total 619740.00`,
    expect: { supplier: 'Indian Oil Corporation Limited', supplierGstin: '24AAACI1681G1ZV', buyerGstin: '08BNAPM0488E1Z3', billNo: '20273121B007217', date: '23-Jun-26', billType: 'Tax Invoice', group: 'petcoke', item: 'Pet Coke', qty: 32.38, unit: 'TO', taxable: 525203.60, igst: 94536.65, gstRate: 18, total: 619740, grandTotal: 619740, itc: 'Eligible', cgst: null, sgst: null }
  },
  {
    // User-reported (2026-07-07): IOC pet-coke variant with a "Supplier TAN:" line
    // (was leaking as the supplier) AND "Mode of Transport" + "Freight 0.00" noise
    // lines (were flipping the group to transport/freight). Must stay petcoke/material.
    name: 'Indian Oil (IOC) — pet coke, TAN + transport-noise variant', format: 'PDF · columnar · IGST',
    text: `INVOICE UNDER RULE 46 of GST Rules
Indian Oil Corporation Limited
TAX INVOICE 20263121B024217
Form No AC4 31A SAP Doc no.7007959120 Date 15-Jan-26 Time 12:01
Supplier TAN: DELIO9652G
GST Registration No GSTIN 24AAACI1681G1ZV
GSTIN 08BNAPM0488E1Z3
Reverse Charge Applicable - No
Place of supply : Gujarat 24
Material Code / Material Description Quantity Unit Rate HSN Total
178100 FUEL GRADE PET COKE (BULK) 48.500 TO 8293.00 27131100 402226.20
AVL Transaction Value
Taxable Value 402226.20
OIG IN: Integrated Tax 18.000 % 72400.72
Mode of Transport : Road
Freight 0.00
Density@15: 0.000
Bay No.: 08
RND Rounding Difference
Total 474627.00`,
    expect: { supplier: 'Indian Oil Corporation Limited', supplierGstin: '24AAACI1681G1ZV', buyerGstin: '08BNAPM0488E1Z3', billNo: '20263121B024217', date: '15-Jan-26', group: 'petcoke', item: 'Pet Coke', taxable: 402226.20, igst: 72400.72, gstRate: 18, total: 474627, itc: 'Eligible' }
  },
  {
    // User-reported (2026-07-08): Tally e-invoice (Mateshwari Mines, limestone).
    // The "Total 1,432.510 MTS ₹12,18,350.00" row made the parser store the
    // QUANTITY (1432.51) as the grand total. Fixed by unit-stripping (MTS) +
    // GST-arithmetic reconciliation (total = taxable+CGST+SGST+roundoff, and can
    // never be below taxable). This fixture locks that behaviour.
    name: 'Tally e-invoice (Mateshwari Mines) — limestone, qty-as-total trap', format: 'PDF · Tally e-invoice · CGST+SGST',
    // Verbatim pdf.js line reconstruction of the REAL bill (2026-07-10). Two
    // traps this locks: (1) the invoice number "222/26-27" is on a SEPARATE line
    // from its "Invoice No. Dated" label (Tally grid), and (2) the taxable value
    // 11,60,333.10 appears ONLY in the HSN-summary column (no "Taxable: <amt>"
    // label), so it must be recovered via total − GST − round-off.
    text: `e-Invoice
|| SHREE ||
TAX INVOICE
IRN : 92cc1955831b58d1cb463cd068a7d0bb5325257e4-2d12add7c0ca5c5c15883bd
Ack No. : 172620567484822
Ack Date : 29-Jun-26
Invoice No. Dated
Mateshwari Mines and Minerals
222/26-27 29-Jun-26
ML No 349/2005, ML No.350/2005,
Gotan Road, Village- Borunda, Tehsil- Pipar City
342604 Dist- Jodhpur Rural (Rajasthan)
GSTIN/UIN: 08ABWFM4111F1Z6
State Name : Rajasthan, Code : 08
Consignee (Ship to)
Gotan Lime Industries
GSTIN/UIN : 08BNAPM0488E1Z3
Buyer (Bill to)
Gotan Lime Industries
GSTIN/UIN : 08BNAPM0488E1Z3
Motor Vehicle No. Tmxxxxxx
1 Lime Stone 25210010 1,432.510 MTS 810.00 MTS 11,60,333.10
CGST OUTPUT 29,008.33
SGST OUTPUT 29,008.33
ROUNDOFF 0.24
Total 1,432.510 MTS ī12,18,350.00
Amount Chargeable (in words)
INR Twelve Lakh Eighteen Thousand Three Hundred Fifty Only
HSN/SAC Taxable CGST SGST/UTGST Total
25210010 11,60,333.10 2.50% 29,008.33 2.50% 29,008.33 58,016.66
Total 11,60,333.10 29,008.33 29,008.33 58,016.66
Tax Amount (in words) : INR Fifty Eight Thousand Sixteen and Sixty Six paise Only`,
    expect: { supplier: 'Mateshwari Mines and Minerals', supplierGstin: '08ABWFM4111F1Z6', buyerGstin: '08BNAPM0488E1Z3', billNo: '222/26-27', date: '29-Jun-26', group: 'limestone', taxable: 1160333.10, cgst: 29008.33, sgst: 29008.33, gstRate: 5, total: 1218350, grandTotal: 1218350, itc: 'Eligible' }
  },
  {
    // User-reported (2026-07-08): IOC SAP invoice extracted supplier = "the buyer.
    // For" (footer/declaration text) and still said "Looks clean". Fixed by (1) the
    // party master (GSTIN 24AAACI1681G1ZV → Indian Oil Corporation Limited, OCR-
    // independent) and (2) hard rejection of declaration/footer fragments as names.
    name: 'Indian Oil (IOC) — SAP invoice, footer-declaration supplier trap', format: 'PDF · SAP · IGST',
    text: `INVOICE UNDER RULE 46 of GST Rules
Indian Oil Corporation Limited
We hereby certify that the goods covered by this document have suffered applicable Taxes on clearance
Doc.Name & number  TAX INVOICE  20273121B007217
Form No AC4 31A   SAP Doc no.7007959119   Date 23-Jun-26
Supplier
GST Registration No  GSTIN 24AAACI1681G1ZV
Recipient (Ship to party)
GOTAN LIME INDUSTRIES
GSTIN 08BNAPM0488E1Z3
Supplier TAN: DELIO9652G
Reverse Charge Applicable - No
PAYER - 376530 GOTAN LIME INDUSTRIES
Ordering Party(Bill to party) : 376530
Item  Material Code / Material Description  Quantity Unit  Rate Unit  HSN code  Total
10  178100  FUEL GRADE PET COKE (BULK)  32.380 TO  16220.000 TO  271311  525203.60
ZAVL Transaction Value  32.380 TO  16220.000 TO  525203.60
Taxable Value  525203.60
JOIG IN: Integrated Tax  18.000 %  94536.65
Total for material  619740.30
ZRND Rounding Difference  -0.25
Total  619740.00
Provisional Balance Subject to reconciliation: 22763.00- ( CR )
This Document is Digitally Signed
Signed by: CHAUDHARI BHIKHUBHAI DAYALJI
received in good condition by the buyer. For Indian Oil Corporation Limited Authorised Signatory`,
    expect: { supplier: 'Indian Oil Corporation Limited', supplierGstin: '24AAACI1681G1ZV', buyerGstin: '08BNAPM0488E1Z3', billNo: '20273121B007217', date: '23-Jun-26', group: 'petcoke', item: 'Pet Coke', taxable: 525203.60, igst: 94536.65, gstRate: 18, total: 619740, grandTotal: 619740, itc: 'Eligible' }
  },
  {
    // User-reported (2026-07-07): Tally e-invoice (Pooja Enterprises, plastic bags).
    // Was reading supplier="Delivery Note Mode/Terms of Payment" (Tally header cell)
    // and date=Ack Date (31 May 25) instead of the invoice Dated (29 May 25).
    name: 'Tally e-invoice (Pooja Enterprises) — plastic bags, CGST+SGST', format: 'PDF · Tally · e-invoice',
    text: `TAX INVOICE
e-Invoice
IRN : 789c3c509abaebea28830dcb756ef7d1d0d44cc82b839bddb28a60e9922e6ba
Ack No. : 172517595673499
Ack Date : 31 MAY 25
Pooja Enterprises
Plot No 87, Laxmi Nagar, Paota C Road,
Jodhpur, Rajasthan, 342006
GSTIN/UIN : 08BOLPB2694P1ZA
Invoice No. 165 Dated 29 May 25
Delivery Note Mode/Terms of Payment
Reference No. Other Reference(s)
Consignee (Ship to)
GOTAN LIME INDUSTRIES, KAKA JI
GSTIN/UIN : 08BNAPM0488E1Z3
Dispatch Doc No. 16463,16471 Delivery Note Date
Dispatched through Pick Up Destination
Buyer (Bill to)
GOTAN LIME INDUSTRIES, KAKA JI
GSTIN/UIN : 08BNAPM0488E1Z3
Bill of Lading/LR-RR No. dt. 29 May 25
Motor Vehicle No.
1 PLASTIC BAG MIX REPOL 392310 18% 10,000 BAG 9.7 BAG 97,000
2 Plastic Repol 2nd 391590 18% 1,000 PIECES 7 PIECES 7,000
1,04,000
S G S T 9% 9,360
C G S T 9% 9,360
Total 1,22,720
Company's GST No. : 08BOLPB2694P1ZA
for Pooja Enterprises`,
    expect: { supplier: 'Pooja Enterprises', supplierGstin: '08BOLPB2694P1ZA', buyerGstin: '08BNAPM0488E1Z3', billNo: '165', date: '29 May 25', group: 'packaging', item: 'Plastic Bags', taxable: 104000, gstRate: 18, total: 122720, itc: 'Eligible' }
  },
  {
    // Adversarial-QA find (2026-07-10): Busy-software multi-item bill where the
    // qty line sits BETWEEN "Grand Total" and its value — the parser read total
    // = 1,04,000 (the taxable, from the HSN "Total" row), then fabricated taxable
    // 95,412.84 and gstRate 9. Locks: total from a value 2 lines below its label
    // + GST% = combined 18 (not the per-component 9) + buyer not "(Bill to)".
    name: 'Busy multi-item — plastic bags, qty line between Grand Total & value', format: 'PDF · Busy · CGST+SGST',
    text: `Tax Invoice
SHREE BALAJI POLYMERS
GSTIN/UIN: 08AACFS1234R1ZP
Invoice No.
SBP/2526/0417
Dated
08-Jul-2026
Buyer (Bill to)
GOTAN LIME INDUSTRIES
GSTIN/UIN : 08BNAPM0488E1Z3
1
HDPE Woven Sacks 50 Kg
39232990
20,000 Nos
4.20
Nos
84,000.00
2
PP Laminated Bags 25 Kg
39232990
5,000 Nos
3.00
Nos
15,000.00
Total
26,000 Nos
1,04,000.00
CGST 9%
9,360.00
SGST 9%
9,360.00
Grand Total
26,000 Nos
1,22,720.00
HSN/SAC
Taxable Value
Central Tax
State Tax
Total Tax Amount
39232990
1,04,000.00
9%
9,360.00
9%
9,360.00
18,720.00
Total
1,04,000.00
9,360.00
9,360.00
18,720.00`,
    expect: { supplier: 'SHREE BALAJI POLYMERS', supplierGstin: '08AACFS1234R1ZP', buyerGstin: '08BNAPM0488E1Z3', billNo: 'SBP/2526/0417', date: '08-Jul-2026', group: 'packaging', taxable: 104000, cgst: 9360, sgst: 9360, gstRate: 18, total: 122720, itc: 'Eligible' }
  },
  {
    name: 'Reliance — pet coke, IGST inter-state', format: 'IGST',
    text: `Reliance Industries Limited
Jamnagar Gujarat  GSTIN 24AAACR5055K1Z7
Tax Invoice No RIL/2026/8842  Dated 02-Jun-2026
Bill To Deshwali Minerals GSTIN 08AADFD5678K1Z9
Raw Petroleum Coke  HSN 2713  120.00 MT
Taxable Amount 1000000.00  IGST 18% 180000.00  Invoice Value 1180000.00
Reverse Charge : No`,
    expect: { supplier: 'Reliance Industries Limited', supplierGstin: '24AAACR5055K1Z7', billNo: 'RIL/2026/8842', date: '02-Jun-2026', group: 'petcoke', item: 'Pet Coke', qty: 120, unit: 'MT', taxable: 1000000, igst: 180000, gstRate: 18, total: 1180000, itc: 'Eligible' }
  },
  {
    name: 'Mateshwari Mines — limestone, CGST+SGST, M/s', format: 'CGST+SGST',
    text: `M/s Mateshwari Mines and Minerals
Village Gotan, Nagaur, Rajasthan 341027
GSTIN 08ABCFM1234N1ZP
Tax Invoice Bill No: GJ5534 Date: 15/06/2026
To: Gotan Lime Industries GSTIN 08AABCG1234H1Z5
Limestone (Kankar) HSN 2521 Quantity 250.00 MT
Taxable Value 847170.00
CGST @2.5% 21179.25  SGST @2.5% 21179.25
Round Off 0.50  Grand Total 889529.00
Reverse Charge : No`,
    expect: { supplier: 'Mateshwari Mines and Minerals', supplierGstin: '08ABCFM1234N1ZP', billNo: 'GJ5534', date: '15/06/2026', billType: 'Tax Invoice', group: 'limestone', item: 'Limestone Purchase', qty: 250, unit: 'MT', taxable: 847170, cgst: 21179.25, sgst: 21179.25, gstRate: 5, total: 889529, grandTotal: 889529, itc: 'Eligible', igst: null }
  },
  {
    name: 'Shree Balaji Polysack — plastic bags, CGST+SGST', format: 'CGST+SGST · packaging',
    text: `Shree Balaji Polysack Industries
GSTIN 24AAECS7777P1ZR
Invoice No SBP/771 Date 12-Jun-2026
Bill To Gotan Lime Industries GSTIN 08AABCG1234H1Z5
HDPE Woven Sack Bags HSN 6305  12000 NOS
Taxable Value 174000.00 CGST 9% 15660.00 SGST 9% 15660.00 Grand Total 205320.00
Reverse Charge : No`,
    expect: { supplier: 'Shree Balaji Polysack Industries', supplierGstin: '24AAECS7777P1ZR', billNo: 'SBP/771', date: '12-Jun-2026', group: 'packaging', item: 'Plastic Bags', qty: 12000, unit: 'NOS', taxable: 174000, cgst: 15660, sgst: 15660, gstRate: 18, total: 205320, itc: 'Eligible' }
  },
  {
    name: 'Dept of Mines — royalty on limestone', format: 'Royalty',
    text: `Department of Mines and Geology
GSTIN 08AAAGD0001A1Z5
Challan No DMG/RY/551 Date 09-Jun-2026
To Gotan Lime Industries
Royalty on Limestone (Mineral) DMF NMET
Taxable Value 300000.00 CGST 9% 27000.00 SGST 9% 27000.00 Grand Total 354000.00`,
    expect: { supplier: 'Department of Mines and Geology', supplierGstin: '08AAAGD0001A1Z5', billNo: 'DMG/RY/551', date: '09-Jun-2026', group: 'royalty', item: 'Royalty', taxable: 300000, cgst: 27000, sgst: 27000, gstRate: 18, total: 354000 }
  },
  {
    name: 'Shree Balaji Roadlines — GTA freight, RCM, LR+vehicle', format: 'Transport · RCM',
    text: `M/s Shree Balaji Roadlines
GSTIN 08AABCT9999Q1ZX
Consignment Note No TC/551 Date 20/06/2026
LR No : LR/8842   Vehicle No : RJ19 GE 8199
To Gotan Lime Industries
Goods Transport Agency - Freight for limestone
Freight 45000.00
Tax payable by recipient under RCM
Total 45000.00`,
    expect: { supplier: 'Shree Balaji Roadlines', supplierGstin: '08AABCT9999Q1ZX', billNo: 'TC/551', date: '20/06/2026', group: 'transport', item: 'Transport / Freight', vehicle: 'RJ19GE8199', lrNo: 'LR/8842', total: 45000, itc: 'RCM' }
  },
  {
    name: 'Shree Balaji Labour Contractor — labour, long name', format: 'Labour · CGST+SGST',
    text: `SHREE BALAJI LABOUR CONTRACTOR & MANPOWER SUPPLIERS
GSTIN 08AACFS9012K1Z6
Invoice No SBL/LAB/0271 Dated 18/02/2025
Billed To Gotan Lime Industries GSTIN 08AABCG1234H1Z5
Loading & Unloading of Limestone SAC 998519
Taxable Value 85000.00 CGST 9% 7650.00 SGST 9% 7650.00 Grand Total 100300.00
Reverse Charge : No`,
    expect: { supplier: 'SHREE BALAJI LABOUR CONTRACTOR & MANPOWER SUPPLIERS', supplierGstin: '08AACFS9012K1Z6', billNo: 'SBL/LAB/0271', date: '18/02/2025', group: 'labour', item: 'Labour', taxable: 85000, cgst: 7650, sgst: 7650, gstRate: 18, total: 100300, itc: 'Eligible' }
  },
  {
    name: 'Generic GST tax invoice — CGST+SGST', format: 'Tax invoice',
    text: `Krishna Cement Traders
GSTIN 08AAACK1111A1Z0
Tax Invoice  Invoice No KCT/442  Date 05-Jun-2026
Bill To Gotan Lime Industries GSTIN 08AABCG1234H1Z5
Portland Cement HSN 2523  100 Bags
Taxable Value 45000.00 CGST 14% 6300.00 SGST 14% 6300.00 Grand Total 57600.00
Payment Terms : Net 30 days
Reverse Charge : No`,
    expect: { supplier: 'Krishna Cement Traders', supplierGstin: '08AAACK1111A1Z0', billNo: 'KCT/442', date: '05-Jun-2026', billType: 'Tax Invoice', taxable: 45000, cgst: 6300, sgst: 6300, gstRate: 28, total: 57600, paymentTerms: 'Net 30 days', itc: 'Eligible' }
  },
  {
    name: 'Debit note', format: 'Debit note',
    text: `Balaji Minerals Pvt Ltd
GSTIN 08AAECB2222R1Z3
DEBIT NOTE  No DN/2026/12  Date 10-Jun-2026
To Gotan Lime Industries GSTIN 08AABCG1234H1Z5
Price difference on limestone
Taxable Value 20000.00 CGST 2.5% 500.00 SGST 2.5% 500.00 Total 21000.00`,
    expect: { supplier: 'Balaji Minerals Pvt Ltd', supplierGstin: '08AAECB2222R1Z3', billNo: 'DN/2026/12', date: '10-Jun-2026', billType: 'Debit Note', group: 'limestone', taxable: 20000, cgst: 500, sgst: 500, gstRate: 5, total: 21000 }
  },
  {
    name: 'Credit note', format: 'Credit note',
    text: `Balaji Minerals Pvt Ltd
GSTIN 08AAECB2222R1Z3
CREDIT NOTE  No CN/2026/07  Date 11-Jun-2026
To Gotan Lime Industries GSTIN 08AABCG1234H1Z5
Rate revision credit
Taxable Value 15000.00 CGST 2.5% 375.00 SGST 2.5% 375.00 Total 15750.00`,
    expect: { supplier: 'Balaji Minerals Pvt Ltd', billNo: 'CN/2026/07', date: '11-Jun-2026', billType: 'Credit Note', taxable: 15000, cgst: 375, sgst: 375, gstRate: 5, total: 15750 }
  },
  {
    name: 'Bill of supply — exempt / 0%', format: 'Bill of supply · 0%',
    text: `Mahakali Agro Lime & Minerals
GSTIN 08AULPK9021R1ZP
BILL OF SUPPLY  No MAL/AGRI/0247  Date 14-06-2025
To Gotan Lime Industries
Agricultural Lime (Liming material) HSN 2522  40 MT
Taxable Value 106000.00  Total 106000.00
Nil rated / Exempt supply. No input tax credit available.`,
    expect: { supplier: 'Mahakali Agro Lime & Minerals', supplierGstin: '08AULPK9021R1ZP', billNo: 'MAL/AGRI/0247', date: '14-06-2025', billType: 'Bill of Supply', group: 'limestone', qty: 40, unit: 'MT', taxable: 106000, total: 106000, itc: 'Ineligible' }
  },
  {
    name: 'Vertical label:value layout', format: 'Different layout',
    text: `SUPPLIER : Ambika Stone Suppliers
GSTIN : 08AAACA9090C1ZK
INVOICE NO : ASS-2026-118
DATE : 08-Jun-2026
BUYER : Gotan Lime Industries
ITEM : Limestone Purchase  HSN : 2521
QUANTITY : 180 MT
TAXABLE VALUE : 610000.00
CGST 2.5% : 15250.00
SGST 2.5% : 15250.00
GRAND TOTAL : 640500.00`,
    expect: { supplier: 'Ambika Stone Suppliers', supplierGstin: '08AAACA9090C1ZK', billNo: 'ASS-2026-118', date: '08-Jun-2026', group: 'limestone', qty: 180, unit: 'MT', taxable: 610000, cgst: 15250, sgst: 15250, gstRate: 5, total: 640500 }
  },
  {
    name: 'Diesel / fuel bill', format: 'Fuel · 0% GST',
    text: `Shree Balaji Filling Station
GSTIN 08AAAFS2222B1Z4
Invoice No FS/8890 Date 11-Jun-2026
To Gotan Lime Industries
High Speed Diesel HSD 2000 Ltr
Taxable Value 178840.00 Total 178840.00`,
    expect: { supplier: 'Shree Balaji Filling Station', supplierGstin: '08AAAFS2222B1Z4', billNo: 'FS/8890', date: '11-Jun-2026', group: 'fuel', item: 'Diesel', taxable: 178840, total: 178840 }
  },
  {
    name: 'Bank charges — 18% GST', format: 'Bank charges',
    text: `HDFC Bank Limited
GST Registration No 07AAACH2702H1ZS
Tax Invoice / Debit Note No BC/2211 Date 30-Jun-2026
To Gotan Lime Industries GSTIN 08AABCG1234H1Z5
Processing fee and bank commission
Taxable Value 5000.00 CGST 9% 450.00 SGST 9% 450.00 Grand Total 5900.00
Reverse Charge : No`,
    expect: { supplier: 'HDFC Bank Limited', supplierGstin: '07AAACH2702H1ZS', billNo: 'BC/2211', date: '30-Jun-2026', group: 'bank', item: 'Bank Charges', taxable: 5000, cgst: 450, sgst: 450, gstRate: 18, total: 5900, itc: 'Eligible' }
  },
  {
    name: 'Label-trap (GST Registration No)', format: 'Regression — the original bug',
    text: `INDORAMA CEMENT LIMITED
Plot 42, GIDC Industrial Area, Bharuch, Gujarat
GST Registration No
24AAACI1681G1ZR
TAX INVOICE  Invoice No : 39/2026-27  Dated : 19-Jun-26
Billed To : Gotan Lime Industries GSTIN 08AABCG1234H1Z5
Cement HSN 2523  Taxable Value 84717.00
CGST 2.5% 2117.93 SGST 2.5% 2117.93 Grand Total 88952.86
Reverse Charge : No`,
    expect: { supplier: 'INDORAMA CEMENT LIMITED', supplierGstin: '24AAACI1681G1ZR', billNo: '39/2026-27', date: '19-Jun-26', taxable: 84717, cgst: 2117.93, sgst: 2117.93, gstRate: 5, total: 88952.86, itc: 'Eligible' }
  },
  {
    name: 'Own firm is the buyer (must pick the seller)', format: 'Buyer=us',
    text: `GOTAN LIME INDUSTRIES
GSTIN 08AABCG1234H1Z5
Tax Invoice No 900 Date 12-Jun-26
Sold By: Balaji Minerals
GSTIN 08AAECB2222R1Z3
Limestone Taxable 100000.00 CGST 2500.00 SGST 2500.00 Total 105000.00`,
    expect: { supplier: 'Balaji Minerals', supplierGstin: '08AAECB2222R1Z3', buyerGstin: '08AABCG1234H1Z5', group: 'limestone', taxable: 100000, cgst: 2500, sgst: 2500, gstRate: 5, total: 105000 }
  },
  {
    // Adversarial-QA find (2026-07-11) — locked.
    name: 'GTA freight — RCM, no GST charged, consignment note', format: 'PDF · GTA · RCM',
    text: `                    CONSIGNMENT NOTE
Shree Ganesh Roadlines Transport Co.
Transport Nagar, Beawar Road, Ajmer, Rajasthan 305001
GSTIN
08AACFS4521P1Z9
PAN AACFS4521P
State Code : 08 Rajasthan
Consignment Note No.
CN/2026-27/1187
Dated : 22-Jun-2026
Vehicle No RJ14 GC 8829
Consignor / Billed To
GOTAN LIME INDUSTRIES
GSTIN 08BNAPM0488E1Z3
Village Gotan, Nagaur, Rajasthan
Description of Service
Goods Transport Agency Service - Transportation of Limestone
SAC 996511
From Gotan To Beawar Plant
Weight 28.500 MT
Freight Charges
79800.00
Taxable Value
79800.00
CGST 0.00
SGST 0.00
IGST 0.00
Total
79800.00
GST Payable by Recipient under Reverse Charge (RCM) - Section 9(3)
Tax to be paid by consignee under RCM
This is a Goods Transport Agency bill. No GST charged by transporter.`,
    expect: { supplier: 'Shree Ganesh Roadlines Transport Co', supplierGstin: '08AACFS4521P1Z9', buyerGstin: '08BNAPM0488E1Z3', billNo: 'CN/2026-27/1187', group: 'transport', taxable: 79800, total: 79800, itc: 'RCM' }
  },
  {
    // Adversarial-QA find (2026-07-11) — locked.
    name: 'Credit Note (sales return) — CGST+SGST, own number not the original invoice', format: 'PDF · Credit Note',
    text: `SHREE BALAJI MINERALS PVT LTD
Plot 47, RIICO Industrial Area, Nagaur Road
Gotan, Dist. Nagaur, Rajasthan - 342902
GSTIN/UIN: 08AACCS1234F1ZP
State Name : Rajasthan, Code : 08

CREDIT NOTE
(Sales Return)

Credit Note No.          Dated
CN/042/2026-27           28-Jun-26
Original Invoice No.     Date
218/2026-27              12-May-26
Mode/Terms of Payment
Against Sales Return

Buyer (Bill to)
GOTAN LIME INDUSTRIES
Gotan, Dist. Nagaur, Rajasthan
GSTIN/UIN : 08BNAPM0488E1Z3
State Name : Rajasthan, Code : 08

Sl  Description of Goods           HSN/SAC    Quantity    Rate      per    Amount
1   Hydrated Lime Powder (Return)  25221000   30.00 MT    1,500.00  MT     45,000.00

                                              Taxable Value              45,000.00
                                   CGST @ 9%                              4,050.00
                                   SGST @ 9%                              4,050.00
                                              Round Off                       0.00
Total                                                                    53,100.00

Amount Chargeable (in words)
INR Fifty Three Thousand One Hundred Only

HSN/SAC    Taxable Value   CGST Rate   CGST Amt    SGST Rate   SGST Amt    Total Tax
25221000    45,000.00        9%        4,050.00       9%       4,050.00     8,100.00

Being credit note issued for goods returned vide your despatch note.
Company's GSTIN : 08AACCS1234F1ZP
This is a Credit Note and not a Tax Invoice for any fresh supply.
for SHREE BALAJI MINERALS PVT LTD
Authorised Signatory`,
    expect: { supplier: 'SHREE BALAJI MINERALS PVT LTD', supplierGstin: '08AACCS1234F1ZP', billNo: 'CN/042/2026-27', taxable: 45000, cgst: 4050, sgst: 4050, gstRate: 18, total: 53100, billType: 'Credit Note', itc: 'Ineligible' }
  },
  {
    // Adversarial-QA find (2026-07-11) — locked.
    name: 'Exempt Bill of Supply — zero GST, no fabricated CGST', format: 'PDF · Bill of Supply · exempt',
    text: `BHANDARI AGRO PRODUCE COMPANY
Krishi Upaj Mandi, Nagaur Road, Merta City, Rajasthan - 341510
GSTIN/UIN
08AAKFB3421H1ZP
State Name : Rajasthan, Code : 08
BILL OF SUPPLY
(Exempted Goods - No GST)
Invoice No.
Dated
BAP/342/26-27
05-Jul-26
Buyer (Bill to)
GOTAN LIME INDUSTRIES
Village Gotan, Dist. Nagaur, Rajasthan
GSTIN/UIN
08BNAPM0488E1Z3
Sl
Description of Goods
HSN/SAC
Quantity
Rate
per
Amount
1
Agricultural Liming Material (Exempt Produce)
2521
500.00 MT
550.00
MT
2,75,000.00
Total
500.00 MT
2,75,000.00
Amount Chargeable (in words)
INR Two Lakh Seventy Five Thousand Only
Taxable Value
2,75,000.00
Total Tax
NIL
Round Off
0.00
Grand Total
2,75,000.00
Declaration : Goods are exempt from GST vide Notification No. 2/2017-Central Tax (Rate).
This is a Bill of Supply issued under Section 31(3)(c) - no tax is chargeable.
Reverse Charge : No
for BHANDARI AGRO PRODUCE COMPANY
Authorised Signatory`,
    expect: { supplier: 'BHANDARI AGRO PRODUCE COMPANY', supplierGstin: '08AAKFB3421H1ZP', billNo: 'BAP/342/26-27', cgst: null, taxable: 275000, total: 275000, itc: 'Ineligible' }
  },
  {
    // Adversarial-QA find (2026-07-11) — locked.
    name: 'Govt mining royalty challan — DMF/NMET, not a limestone purchase', format: 'PDF · royalty challan',
    text: `GOVERNMENT OF RAJASTHAN
DEPARTMENT OF MINES & GEOLOGY
Office of the Mining Engineer, Jodhpur
GSTIN
08AAAGR2021D1ZP
State Code : 08
eRAVANA MINERAL DESPATCH CHALLAN-cum-TAX INVOICE
Challan No.
Dated
RY/DMG/JOD/2026-27/04417
27-Jun-2026
Recipient / Lessee
GOTAN LIME INDUSTRIES
GSTIN 08BNAPM0488E1Z3
Village Gotan, Dist. Nagaur, Rajasthan
Mineral : Limestone (Chemical Grade)
HSN/SAC
9973
Royalty on Limestone   Qty 5610.00 MT
Particulars                         Amount
Royalty Charges                     425000.00
DMF Contribution (30%)              127500.00
NMET Contribution (2%)              8500.00
Taxable Value
561000.00
CGST
9%
50490.00
SGST
9%
50490.00
Round Off
0.00
Total Invoice Value
661980.00
Reverse Charge : No
This is a computer generated challan-cum-invoice.`,
    expect: { supplierGstin: '08AAAGR2021D1ZP', billNo: 'RY/DMG/JOD/2026-27/04417', group: 'royalty', taxable: 561000, cgst: 50490, sgst: 50490, gstRate: 18, total: 661980 }
  },
  {
    name: 'Low-quality / garbled OCR (must blank, never fake)', format: 'Low-quality scan',
    text: `T@X 1NV0ICE
S0me Vend0r ???
G$TlN 08 A?BC ????
T0tal ...`,
    expect: { supplier: null, supplierGstin: null, taxable: null, total: null, gstRate: null }
  }
];

/* ── field comparator ─────────────────────────────────────────────────── */
function eqField(exp, got) {
  if (exp === null) return got == null || got === '';                    // must be blank
  if (got == null || got === '') return false;                           // expected something, got blank
  if (typeof exp === 'number') return Math.abs(+got - exp) <= (exp >= 1000 ? 2 : 0.5);
  var a = String(exp).toLowerCase().replace(/\s+/g, ' ').trim(), b = String(got).toLowerCase().replace(/\s+/g, ' ').trim();
  if (a === b) return true;
  return b.indexOf(a) >= 0 || a.indexOf(b) >= 0;                          // tolerate OCR suffix drift on names
}
// group each field into a report category
var CATEGORY = {
  supplier: 'Supplier Name', buyer: 'Supplier Name',
  supplierGstin: 'GSTIN', buyerGstin: 'GSTIN',
  billNo: 'Invoice Number', date: 'Date', billType: 'Bill Type',
  group: 'Material Detection', item: 'Material Detection', hsn: 'Material Detection', qty: 'Material Detection', unit: 'Material Detection', unitRate: 'Material Detection',
  cgst: 'Tax Detection', sgst: 'Tax Detection', igst: 'Tax Detection', gstRate: 'Tax Detection', totalGst: 'Tax Detection', itc: 'Tax Detection',
  taxable: 'Amount Accuracy', total: 'Amount Accuracy', grandTotal: 'Amount Accuracy', roundOff: 'Amount Accuracy',
  paymentTerms: 'Other Fields', vehicle: 'Other Fields', lrNo: 'Other Fields', remarks: 'Other Fields'
};

var cat = {}, failures = [], invPass = 0, totF = 0, okF = 0;
CORPUS.forEach(function (s) {
  var r = OCR.parse(s.text, OWN).fields, invOk = true;
  Object.keys(s.expect).forEach(function (k) {
    var exp = s.expect[k], got = r[k], ok = eqField(exp, got), c = CATEGORY[k] || 'Other Fields';
    cat[c] = cat[c] || [0, 0]; cat[c][1]++; totF++; if (ok) { cat[c][0]++; okF++; } else { invOk = false; failures.push({ bill: s.name, field: k, expected: exp, got: got == null ? '(blank)' : got }); }
  });
  if (invOk) invPass++;
});

/* ── report ───────────────────────────────────────────────────────────── */
function pct(a) { return a[1] ? Math.round(a[0] / a[1] * 100) : 100; }
var order = ['Supplier Name', 'GSTIN', 'Invoice Number', 'Date', 'Bill Type', 'Material Detection', 'Tax Detection', 'Amount Accuracy', 'Other Fields'];
console.log('\n════════════════ OCR Regression Report ════════════════\n');
console.log('  Invoices Tested : ' + CORPUS.length);
console.log('  Passed          : ' + invPass);
console.log('  Failed          : ' + (CORPUS.length - invPass));
console.log('  Field checks    : ' + okF + '/' + totF + ' (' + Math.round(okF / totF * 100) + '%)\n');
order.forEach(function (c) { if (cat[c]) console.log('  ' + (c + ' Accuracy').padEnd(30) + pct(cat[c]) + '%   (' + cat[c][0] + '/' + cat[c][1] + ')'); });
console.log('\n  Regression Errors : ' + (failures.length ? failures.length : 'None'));
failures.forEach(function (f) { console.log('    ✗ [' + f.bill + '] ' + f.field + ': expected ' + JSON.stringify(f.expected) + ', got ' + JSON.stringify(f.got)); });
console.log('\n════════════════════════════════════════════════════════\n');
process.exit(failures.length ? 1 : 0);
