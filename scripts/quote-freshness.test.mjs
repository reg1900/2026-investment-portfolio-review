import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteFreshness} from './quote-freshness.mjs';
const holding=(n,date)=>({n,unit:'股',quoteDate:date});
test('checks each quote independently and excludes fund publication lag',()=>{
 const s=quoteFreshness([holding('0050','2026-11-02'),holding('00937B','2026-10-30'),{n:'基金',unit:'單位',quoteDate:'2026-10-30'}],new Date('2026-11-02T09:00Z'));
 assert.deepEqual(s.lagging,['00937B']);assert.equal(s.rows.length,2);assert.equal(s.alert,true);
});
test('weekday stale data prompts verification, weekends do not demand new quotes',()=>{
 const h=[holding('0050','2026-10-30')];
 assert.equal(quoteFreshness(h,new Date('2026-11-02T07:00Z')).alert,false);
 assert.equal(quoteFreshness(h,new Date('2026-11-02T09:00Z')).pending,true);
 assert.equal(quoteFreshness(h,new Date('2026-11-01T09:00Z')).pending,false);
});
test('missing date alerts, complete daily quotes pass',()=>{
 assert.equal(quoteFreshness([holding('0050','')]).alert,true);
 assert.equal(quoteFreshness([holding('0050','2026-11-02')],new Date('2026-11-02T09:00Z')).alert,false);
});
