import {test} from 'node:test';
import assert from 'node:assert/strict';
import {referenceDate,rateRows,checkInvoiceRates} from '../src/fbr/fbr.rates.js';
import {fbrClient} from '../src/fbr/fbr.client.js';
test('FBR reference dates are validated without timezone shifts',()=>{
 assert.equal(referenceDate('2026-11-14'),'14-Nov-2026');assert.equal(referenceDate('2026-05-18'),'18-May-2026');
 for(const d of ['2026-02-30','14-Nov-2026','2026-13-01',''])assert.throws(()=>referenceDate(d));
});
test('reference rates preserve compound descriptions without pretending they are a simple percentage',()=>{
 assert.deepEqual(rateRows([{ratE_ID:1043,ratE_DESC:'18% and Rs. 80 per Liter',ratE_VALUE:18}]),[{id:1043,description:'18% and Rs. 80 per Liter',value:18,supported:false}]);
 assert.equal(rateRows([{ratE_ID:128,ratE_DESC:'8%',ratE_VALUE:8}])[0].supported,true);
 assert.throws(()=>rateRows([]));
});
test('November 8% mismatch is stopped with an actionable message and leaves invoice data untouched',async()=>{
 const invoice={invoice_date:'2026-11-14',seller_snapshot:{province:'Punjab'},items:[{snapshot:{saleType:'Goods (FED in ST Mode)',rate:'8%',salesTaxApplicable:8}}]};
 const original=structuredClone(invoice);const client={reference:async()=>({rates:[{description:'18% and Rs. 80 per Liter',supported:false}]})};
 await assert.rejects(()=>checkInvoiceRates(invoice,{mock:false},client),e=>e.status===400&&e.message.includes('2026-11-14')&&e.message.includes('18% and Rs. 80 per Liter'));
 assert.deepEqual(invoice,original);
 await checkInvoiceRates(invoice,{mock:true},client);
 await checkInvoiceRates({...invoice,invoice_date:'2026-05-18'},{mock:false},{reference:async()=>({rates:[{description:'8%',supported:true}]})});
});
test('rate lookup uses documented IDs, date and province, and caches only identical contexts',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async url=>{
  const u=new URL(url);calls.push(u);
  const data=u.pathname.endsWith('/provinces')?[{stateProvinceCode:7,stateProvinceDesc:'PUNJAB'}]:u.pathname.endsWith('/transtypecode')?[{transactioN_TYPE_ID:21,transactioN_DESC:'Goods (FED in ST Mode)'}]:[{ratE_ID:128,ratE_DESC:'8%',ratE_VALUE:8}];
  return {ok:true,json:async()=>data};
 };
 try{
  const client=fbrClient({mock:false,getToken:'test-only-get',postToken:'test-only-post'}),context={invoiceDate:'2026-05-18',sellerProvince:'Punjab',saleType:'Goods (FED in ST Mode)'};
  await client.reference('rates',context);await client.reference('rates',context);assert.equal(calls.length,3);
  const q=calls.find(u=>u.pathname.endsWith('/SaleTypeToRate')).searchParams;
  assert.equal(q.get('date'),'18-May-2026');assert.equal(q.get('transTypeId'),'21');assert.equal(q.get('originationSupplier'),'7');
  await client.reference('rates',{...context,invoiceDate:'2026-11-14'});assert.equal(calls.length,6);
 }finally{globalThis.fetch=original;}
});
