/* datefield.test.js — an unreadable bill date must BLOCK the save.

   THE REPORTED BUG (2026-07-15, "I uploaded jan purchase bill still not
   showing"): OCR reads the LABEL instead of the value — "Dated :" — which is
   not empty, so the required-field check passes. buildRow then runs it through
   parseDate, gets '', and the bill saves with NO DATE. A bill with no date
   belongs to no month, so it is invisible in every one, while the app says
   "Saved 1 bill". Uploaded, stored, and gone.

   Reproduced live before fixing: the bill was in the data and in no month.

   The rule: a required date must PARSE, not merely exist. If it can't be read,
   ask the user — never file it under nothing (and never under today, which is
   the other half of the same trap).

   Drives the REAL recompute() out of bulk.js with the REAL purchase field cfg.
   Run: node datefield.test.js */

const fs=require('fs'), vm=require('vm'), D=__dirname + '/';
const src=fs.readFileSync(D+'bulk.js','utf8');
const cut=(a,b)=>{const i=src.indexOf(a);return src.slice(i,src.indexOf(b,i)+b.length);};
const ctx={ window:{ QLExtract:{validGstin:()=>true},
  // the app's real date parser, same rules as finance.js parseDate
  QLFin:{ parseDate(s){ s=(s==null?'':s).toString().trim(); if(!s) return '';
    let m; if((m=s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/))) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    if((m=s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/))){let[,d,mo,y]=m;if(y.length===2)y='20'+y;return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;}
    const MON={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    if((m=s.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3,})[-\/ ](\d{2,4})$/))){const mm=MON[m[2].slice(0,3).toLowerCase()];if(mm){const y=m[3].length===2?'20'+m[3]:m[3];return `${y}-${mm}-${m[1].padStart(2,'0')}`;}}
    return ''; } } }, SEQ:1, console };
ctx.QLFin = ctx.window.QLFin; ctx.QLExtract = ctx.window.QLExtract;
vm.createContext(ctx);
vm.runInContext([cut('function recompute(bill, cfg)','\n  }'), cut('function nameKey(cfg)','\n  }'),
  'this.recompute=recompute;'].join('\n'), ctx);

const CFG={ kind:'purchase',
  fields:[{key:'bill',label:'Bill No.'},{key:'date',label:'Date',required:true},{key:'sup',label:'Supplier',required:true},
          {key:'gstin',label:'GSTIN'},{key:'taxable',label:'Taxable amount'},{key:'total',label:'Total amount'}],
  ocrMap:{bill:'docno',date:'date',sup:'name',gstin:'gstin',taxable:'taxable',total:'total'},
  requireOneOf:[['taxable','total']],
  buildRow:get=>({bill:get('bill'),date:ctx.QLFin.parseDate(get('date')),sup:get('sup'),taxable:+get('taxable')||0}) };

const mk=date=>{ const b={id:'b1',kind:'ocr',g:{},vals:{bill:'JAN-1',date,sup:'Indian Oil Corporation Limited',gstin:'24AAACI1681G1ZV',taxable:'402226.20',total:'474627'},reviewFields:[]};
  ctx.recompute(b,CFG); return b; };

let pass=0,fail=0;
const t=(n,c)=>{ c?pass++:(fail++,console.log('  ✗ '+n)); };
console.log('\n── the reported bug: an unreadable date must BLOCK the save, not lose the bill');
const junk=mk('Dated :');
t('junk date "Dated :" is NOT ready to import', junk.status!=='ready');
t('...it is marked invalid', junk.status==='invalid');
t('...and says what went wrong in plain words', /Couldn.t read the bill date/.test(junk.reason||''));
t('...quoting what it actually read', /Dated :/.test(junk.reason||''));
t('...and warns it would show in no month', /no month/.test(junk.reason||''));

const empty=mk('');
t('an empty date is still blocked', empty.status==='invalid');

console.log('\n── real dates must still sail through');
[['15-Jan-2026','1'],['2026-01-15','2'],['15/01/2026','3'],['15-01-2026','4'],['15-Jan-26','5']].forEach(([d,i])=>{
  const b=mk(d); t('"'+d+'" is accepted (status='+b.status+')', b.status!=='invalid');
});
console.log('\n════ bill-date gate ════\n  Passed: '+pass+'   Failed: '+fail);
console.log(fail===0 ? '\n✅ ALL '+pass+' DATE-GATE TESTS PASSED\n' : '\n❌ '+fail+' FAILED\n');
process.exit(fail?1:0);
