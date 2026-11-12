import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDataStatus, installDataStatus } from './data-status.mjs';

const meta = (syncedAt, date) => ({syncedAt,sources:[{name:'ETF',date}]});
test('Sunday does not require a sync after the Saturday fund check', () => {
  const state = getDataStatus(meta('2026-10-24 11:00','2026-10-23'),new Date('2026-10-25T12:00:00+08:00'));
  assert.equal(state.overdue,false);
  assert.equal(state.title,'部分報價非今日資料');
});
test('successful execution with old source date never claims latest quotes', () => {
  const state = getDataStatus(meta('2026-10-23 16:05','2026-10-22'),new Date('2026-10-23T16:06:00+08:00'));
  assert.equal(state.overdue,false);
  assert.equal(state.tone,'waiting');
});
test('Tuesday fund check becomes overdue after 90 minutes', () => {
  assert.equal(getDataStatus(meta('2026-10-26 17:35','2026-10-26'),new Date('2026-10-27T12:17:00+08:00')).overdue,true);
  assert.equal(getDataStatus(meta('2026-10-26 17:35','2026-10-26'),new Date('2026-10-27T12:16:00+08:00')).overdue,false);
});
test('Monday main update is expected after its grace period, with no separate backup deadline', () => {
  assert.equal(getDataStatus(meta('2026-10-24 11:00','2026-10-23'),new Date('2026-10-26T18:46:00+08:00')).overdue,false);
  assert.equal(getDataStatus(meta('2026-10-24 11:00','2026-10-23'),new Date('2026-10-26T18:47:00+08:00')).overdue,true);
  assert.equal(getDataStatus(meta('2026-10-26 17:35','2026-10-26'),new Date('2026-10-26T21:00:00+08:00')).overdue,false);
});
test('same-day quotes with successful sync have current status', () => {
  assert.equal(getDataStatus(meta('2026-10-23 16:05','2026-10-23'),new Date('2026-10-23T16:06:00+08:00')).tone,'current');
});
test('FX timestamp displays a compact Taipei date instead of a long UTC string', () => {
  const html=installDataStatus('<head></head><body><header></header></body>',{syncedAt:'2026-10-25 01:07',sources:[{name:'美元匯率',date:'2026-10-23T21:31:00.000Z',kind:'fx'}]});
  assert.ok(html.includes('<dt>美元匯率</dt><dd>2026-10-24</dd>'));
});
test('repeated updates keep one status panel and executable script', () => {
  const original='<html><head></head><body><header><div class="asof">更新時間：2026-10-23 20:49</div></header></body></html>';
  const metadata=meta('2026-10-23 20:49','2026-10-22');
  const once=installDataStatus(original,metadata,new Date('2026-10-25T00:00:00+08:00'));
  const twice=installDataStatus(once,metadata,new Date('2026-10-25T00:00:00+08:00'));
  assert.equal((twice.match(/id="dataStatus"/g)||[]).length,1);
  assert.equal((twice.match(/id="dataStatusScript"/g)||[]).length,1);
  assert.equal((twice.match(/id="dataStatusStyle"/g)||[]).length,1);
  assert.ok(twice.includes('最近同步成功：2026-10-23 20:49'));
  new Function(twice.match(/<script id="dataStatusScript">([\s\S]*?)<\/script>/)[1]);
});

// Execute the generated browser code against an isolated browser-shaped context.
import vm from 'node:vm';
async function checkRefresh({nextTime='2026-11-12 17:30', storageFails=false, status=200}={}) {
  let destination, request;
  const context={
    URL, Intl, Date, AbortSignal, console,
    location:{href:'https://example.test/?v=old#holdings',replace:url=>{destination=url;}},
    document:{hidden:false,getElementById:()=>({className:'',textContent:'',getAttribute:()=> 'true'}),querySelectorAll:()=>[],addEventListener:()=>{}},
    sessionStorage:{getItem:()=>null,setItem:()=>{if(storageFails)throw Error('Storage disabled');}},
    setInterval:()=>{},
    fetch:async(url,options)=>{request={url:String(url),options};return {ok:status===200,text:async()=>`const portfolioDataStatus=${JSON.stringify(meta(nextTime,'2026-11-12'))};`};},
  };
  vm.createContext(context);
  const html=installDataStatus('<head></head><body><header></header></body>',meta('2026-11-12 10:47','2026-11-11'));
  vm.runInContext(html.match(/<script id="dataStatusScript">([\s\S]*?)<\/script>/)[1],context);
  await new Promise(resolve=>setImmediate(resolve));
  return {destination,request,busy:vm.runInContext('checkNewQuotes.busy',context)};
}
test('new data navigates to a new version URL and preserves the selected section', async()=>{
  const result=await checkRefresh();
  assert.equal(result.destination,'https://example.test/?v=202611121730#holdings');
  assert.equal(result.request.options.cache,'no-store');
  assert.ok(result.request.options.signal);
  assert.equal(result.busy,false);
});
test('blocked browser storage does not prevent loading a newer snapshot', async()=>{
  assert.ok((await checkRefresh({storageFails:true})).destination);
});
test('same, older, or failed responses do not trigger a reload loop', async()=>{
  for(const input of [{nextTime:'2026-11-12 10:47'},{nextTime:'2026-11-11 17:30'},{status:503}]){
    const result=await checkRefresh(input);
    assert.equal(result.destination,undefined);
    assert.equal(result.busy,false);
  }
});
