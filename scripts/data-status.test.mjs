import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDataStatus, installDataStatus } from './data-status.mjs';

const meta = (syncedAt, date) => ({syncedAt,sources:[{name:'ETF',date}]});
test('weekend does not require new scheduled syncs; old quotes remain explicit', () => {
  const state = getDataStatus(meta('2026-10-23 20:49','2026-10-22'),new Date('2026-10-25T12:00:00+08:00'));
  assert.equal(state.overdue,false);
  assert.equal(state.title,'部分報價非今日資料');
});
test('successful execution with old source date never claims latest quotes', () => {
  const state = getDataStatus(meta('2026-10-23 16:05','2026-10-22'),new Date('2026-10-23T16:06:00+08:00'));
  assert.equal(state.overdue,false);
  assert.equal(state.tone,'waiting');
});
test('missed morning schedule becomes overdue after 90 minutes', () => {
  assert.equal(getDataStatus(meta('2026-10-23 20:49','2026-10-23'),new Date('2026-10-26T10:06:00+08:00')).overdue,true);
  assert.equal(getDataStatus(meta('2026-10-23 20:49','2026-10-23'),new Date('2026-10-26T09:00:00+08:00')).overdue,false);
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
