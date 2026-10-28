import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completedDateCandidates,parseDailyReport,parseBulkQuotes,selectQuotes,fetchTaiwanCloses} from './taiwan-quotes.mjs';
const now=new Date('2026-10-29T01:00:00+08:00');
const listed={'0050':58000,'00631L':14000,'00713':16000};
const positions={...listed,'00937B':42000};
// Sanitized rows from the official 10/28 report, including HTML +/- signs.
const report={stat:'OK',date:'20261028',tables:[{fields:['證券代號','證券名稱','收盤價','漲跌(+/-)','漲跌價差'],data:[
  ['0050','元大台灣50','108.65','<p style= color:red>+</p>','2.05'],
  ['00631L','元大台灣50正2','36.88','<p style= color:red>+</p>','1.28'],
  ['00713','元大台灣高息低波','65.90','<p style= color:green>-</p>','0.45'],
]}]};
const bulk=Object.keys(listed).map(Code=>({Code,Date:'1151027',ClosingPrice:'20',Change:'1'}));
const tpex=[{SecuritiesCompanyCode:'00937B',Date:'1151028',Close:'14.17',Change:'-0.03'}];
const clone=x=>structuredClone(x);
test('official daily close parser reads actual date and signed change fields',()=>{
  const m=parseDailyReport(report,listed,'2026-10-28',now);
  assert.equal(m.get('0050').price,108.65);assert.equal(m.get('0050').change,2.05);
  assert.equal(m.get('00631L').price,36.88);
  assert.equal(m.get('00713').change,-.45);
  assert.ok(Math.abs(m.get('0050').day-2.05/106.6*100)<1e-10);
  assert.equal(m.get('0050').source,'證交所盤後每日報表');
  assert.ok(m.get('0050').sourceUrl.includes('date=20261028'));
});
test('close date selection avoids intraday data and skips weekends',()=>{
  assert.equal(completedDateCandidates(now)[0],'2026-10-28');
  assert.equal(completedDateCandidates(new Date('2026-10-29T15:35:00+08:00'))[0],'2026-10-29');
  assert.equal(completedDateCandidates(new Date('2026-10-29T15:34:00+08:00'))[0],'2026-10-28');
  assert.equal(completedDateCandidates(new Date('2026-10-26T08:35:00+08:00'))[0],'2026-10-23');
});
test('invalid, future, mismatched or non-comparable report quotes are rejected',()=>{
  assert.throws(()=>parseDailyReport(report,listed,'2026-10-27',now),/mismatch/);
  const future={...report,date:'20261030'};
  assert.throws(()=>parseDailyReport(future,listed,'2026-10-30',now),/future/);
  for(const value of ['--','',null]){
    const bad=clone(report);bad.tables[0].data[0][2]=value;
    assert.throws(()=>parseDailyReport(bad,listed,'2026-10-28',now));
  }
  const bad=clone(report);bad.tables[0].data[0][3]='X';
  assert.throws(()=>parseDailyReport(bad,listed,'2026-10-28',now),/not comparable/);
  assert.equal(parseDailyReport({stat:'很抱歉，沒有符合條件的資料!'},listed,'2026-10-28',now).size,0);
  assert.throws(()=>parseDailyReport({},listed,'2026-10-28',now));
});
test('newer report replaces stale OpenAPI, and same-date disagreement stops refresh',()=>{
  const primary=parseDailyReport(report,listed,'2026-10-28',now);
  const backup=parseBulkQuotes(bulk,listed,'twse',now);
  const selected=selectQuotes([primary,backup],listed);
  assert.equal(selected.get('0050').price,108.65);
  assert.equal(selected.get('0050').isoDate,'2026-10-28');
  const conflict=new Map([['0050',{...primary.get('0050'),price:109}]]);
  assert.throws(()=>selectQuotes([primary,conflict],listed),/disagreement/);
  assert.throws(()=>selectQuotes([primary],positions),/00937B/);
});
test('report-first orchestration combines current listed and OTC closes',async()=>{
  const warnings=[];
  const request=async url=>url.includes('/afterTrading/')?report:url.includes('openapi.twse')?bulk:tpex;
  const m=await fetchTaiwanCloses(positions,request,{now,warn:x=>warnings.push(x)});
  assert.equal(m.size,4);assert.equal(m.get('0050').price,108.65);
  assert.equal(m.get('00937B').price,14.17);assert.equal(m.get('00937B').change,-.03);
  assert.equal(m.get('00937B').source,'櫃買中心收盤資料');
  assert.equal(warnings.length,0);
});
test('report failures use dated OpenAPI backup and warn rather than inventing prices',async()=>{
  const warnings=[];
  const m=await fetchTaiwanCloses(positions,async url=>{
    if(url.includes('/afterTrading/'))throw new Error('Temporary failure');
    return url.includes('openapi.twse')?bulk:tpex;
  },{now,warn:x=>warnings.push(x)});
  assert.equal(m.get('0050').isoDate,'2026-10-27');
  assert.equal(m.get('0050').source,'證交所 OpenAPI 備援');
  assert.ok(warnings.some(x=>x.includes('unavailable')));
  assert.ok(warnings.some(x=>x.includes('0050 close is older')));
});
test('no-trading-day report falls back to last actual report without changing its date',async()=>{
  const monday=new Date('2026-10-26T16:00:00+08:00');
  const earlier={...report,date:'20261023'};
  const m=await fetchTaiwanCloses(listed,async url=>{
    if(url.includes('/afterTrading/'))return url.includes('20261026')?{stat:'查無資料'}:earlier;
    return [];
  },{now:monday,warn:()=>{}});
  assert.equal(m.get('0050').isoDate,'2026-10-23');
});
