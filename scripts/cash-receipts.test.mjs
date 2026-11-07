import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCashReceipts,groupCashReceipts,installCashReceipts} from './cash-receipts.mjs';
const now=new Date('2026-11-07T12:00:00Z');
const snapshot={syncedAt:'2026-11-07T10:00:00.000Z',entries:[
  {month:'2026-10',date:'2026-10-15',code:'00919',currency:'TWD',amount:13100},
  ...[['00937B',3014],['00933B',1377],['00751B',4290],['00713',20000]].map(([code,amount])=>({month:'2026-10',date:null,code,currency:'TWD',amount})),
]};
test('five user-reported receipts sum to October 41781 without forecasts',()=>{
  const result=normalizeCashReceipts(snapshot,now);
  const groups=groupCashReceipts(result,'TWD');
  assert.equal(groups.length,1);
  assert.equal(groups[0].total,41781);
  assert.equal(result.entries.filter(row=>row.date===null).length,4);
});
test('dollars and Taiwan dollars remain in separate month totals',()=>{
  const data=normalizeCashReceipts({...snapshot,entries:[...snapshot.entries,{month:'2026-10',code:'富達永續',date:null,currency:'USD',amount:12.34}]},now);
  assert.equal(groupCashReceipts(data,'TWD')[0].total,41781);
  assert.equal(groupCashReceipts(data,'USD')[0].total,12.34);
});
test('inconsistent or future actual receipt dates are rejected',()=>{
  assert.throws(()=>normalizeCashReceipts({...snapshot,entries:[{...snapshot.entries[0],date:'2026-11-01'}]},now));
  assert.throws(()=>normalizeCashReceipts({...snapshot,entries:[{...snapshot.entries[0],month:'2026-12',date:null}]},now));
});
test('bad sync preserves the last good snapshot and indicates failure',()=>{
  const base='<body><section class="section" id="cash"><div class="card cash-card"></div></section><script>const cash=[];</script></body>';
  const valid=installCashReceipts(base,snapshot,now);
  const failed=installCashReceipts(valid,null,now);
  assert.match(failed,/本次未取得新紀錄/);
  assert.match(failed,/"amount":13100/);
  assert.equal((failed.match(/id="cashReceiptsScript"/g)||[]).length,1);
});
test('initial missing data is safe across repeated updates',()=>{
  const base='<body><section class="section" id="cash"></section><script>const cash=[];</script></body>';
  const first=installCashReceipts(base,null,now);
  assert.doesNotThrow(()=>installCashReceipts(first,null,now));
});
