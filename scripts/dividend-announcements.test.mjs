import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dividendDate,parseDividendSource,renderDividendAnnouncements,fetchDividendAnnouncements,installDividendAnnouncements,existingDividendSnapshot} from './dividend-announcements.mjs';
const now=new Date('2026-11-07T04:00:00Z');
const stock={n:'00937B',u:33000};
const source={id:'capital',name:'群益投信',url:'https://www.capitalfund.com.tw/etf/product/detail/378/interest',codes:['00937B'],status:'ok',checkedAt:now.toISOString(),events:[{code:'00937B',exDate:'2026-10-19',payDate:'2026-11-13',amount:0.072,currency:'TWD'}]};

test('unannounced amount remains unknown',()=>{
  const events=parseDividendSource('twse',{fields:['收益分配發放日'],data:[['00878','','115年11月17日','','115年12月11日',null]]});
  assert.equal(events[0].amount,null);
  assert.equal(events[0].payDate,'2026-12-11');
  assert.throws(()=>dividendDate('115年02月30日'));
});
test('post-ex-date sale does not reduce the reported upcoming entitlement',()=>{
  const html=renderDividendAnnouncements({sources:[source]},[stock],now);
  assert.match(html,/應領數量待核對/);
  assert.doesNotMatch(html,/2,376/);
});
test('future ex-date can use current holdings for an explicitly labelled illustration',()=>{
  const s={...source,events:[{...source.events[0],exDate:'2026-11-17',payDate:'2026-12-11'}]};
  const html=renderDividendAnnouncements({sources:[s]},[stock],now);
  assert.match(html,/按目前持有量試算/);
  assert.match(html,/2,376/);
});
test('failed source keeps prior events and prior check time',async()=>{
  const snapshot=await fetchDividendAnnouncements(async()=>{throw Error('offline');},{sources:[source]},now);
  const retained=snapshot.sources.find(s=>s.id==='capital');
  assert.equal(retained.status,'failed');
  assert.equal(retained.checkedAt,source.checkedAt);
  assert.deepEqual(retained.events,source.events);
});
test('preview generation preserves a single section and snapshot',()=>{
  const snapshot={sources:[source]};
  const base='<body><section id="cash"><div class="card cash-card"></div></section></body>';
  const first=installDividendAnnouncements(base,snapshot,[stock],now);
  assert.equal(installDividendAnnouncements(first,snapshot,[stock],now),first);
  assert.deepEqual(existingDividendSnapshot(first),snapshot);
});

test('future ex-date with an unannounced amount is never described as already ex-dividend',()=>{
  const s={...source,events:[{...source.events[0],exDate:'2026-11-17',payDate:'2026-12-11',amount:null}]};
  const html=renderDividendAnnouncements({sources:[s]},[stock],now);
  assert.match(html,/待除息/);
  assert.doesNotMatch(html,/已除息，應領數量待核對/);
});
