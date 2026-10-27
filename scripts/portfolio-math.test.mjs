import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {loanSchedule,calculateExposure,stressScenario,balanceTradePlan} from './portfolio-math.mjs';
import {loanConfig} from './loan-config.mjs';
import {installPortfolioReview} from './portfolio-review.mjs';
import {quoteNumber,validateQuoteDate} from './source-validation.mjs';
const close=(a,b,tolerance=.01)=>assert.ok(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);
const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
// Fixed calculation fixtures: live prices, units and distributions may change daily.
// Only the HTML preservation test below reads the current dashboard data.
const holdings=[
  {n:'0050',u:100000,c:9000000,v:10377092},
  {n:'00713',u:16000,c:1018400,v:1054400},
  {n:'00631L',u:13000,c:505130,v:462930},
];
const cash=Array.from({length:12},(_,i)=>({
  m:`${i+1}月`,x:[['測試配息',i<6?20000:i===11?62551:62550]],
}));

test('870萬 original loan, one payment, 359 remaining installments',()=>{
  const original=loanSchedule({principal:8700000,annualRate:2.3,years:30});
  close(original.firstPayment,33477.71228028817);
  close(original.firstInterest,16675);
  close(original.schedule[0].balance,8683197.287719712);
  close(loanConfig.principal,8683197.29);
  assert.equal(loanConfig.remainingMonths,359);
  const remaining=loanSchedule(loanConfig);
  close(remaining.firstPayment,original.firstPayment);
  close(remaining.schedule.reduce((s,m)=>s+m.principal,0),loanConfig.principal);
  close(remaining.schedule.at(-1).balance,0);
  close(remaining.totalInterest+original.firstInterest,original.totalInterest);
});
test('zero interest, no loan, equal principal and interest-only balloon',()=>{
  const zero=loanSchedule({principal:120000,annualRate:0,remainingMonths:12});
  close(zero.firstPayment,10000);close(zero.totalInterest,0);
  close(loanSchedule({principal:0,annualRate:2.3,years:30}).firstPayment,0);
  const principal=loanSchedule({...loanConfig,repayment:'principal'});
  assert.ok(principal.schedule[1].payment<principal.schedule[0].payment);
  const io=loanSchedule({...loanConfig,repayment:'interest-only'});
  close(io.schedule[0].principal,0);close(io.schedule.at(-1).principal,loanConfig.principal);
  assert.throws(()=>loanSchedule({...loanConfig,remainingMonths:0}));
});
test('exposure uses market values and outstanding debt, not cost or original loan',()=>{
  const e=calculateExposure(holdings,cash,loanConfig);
  close(e.equity,e.assets-8683197.29);
  close(e.leverage,e.assets/e.equity);
  close(e.annualCash,495301);
  assert.equal(e.shortMonths,6);
  close(e.repay.firstYearPayment,401732.54736,.1);
  close(e.annualSurplus,93568.45264,.1);
  const s=stressScenario(e,.2);
  close(s.loss,e.assets*.2);close(s.equityLoss,e.assets*.2/e.equity);
  close(stressScenario(e,e.equityBuffer).equity,0);
  assert.ok(stressScenario(e,.3).equity<0);
  const negative=calculateExposure(holdings,cash,{...loanConfig,principal:e.assets+1});
  assert.equal(negative.leverage,0);assert.ok(negative.equity<0);
});
test('60:40 rebalance is based on market value and cannot spend more than sales',()=>{
  const p=balanceTradePlan(holdings);
  close(p.amount,144002);
  close((p.a-p.amount)/p.total,.6,1e-10);
  assert.equal(p.sell,'00713');assert.equal(p.buy,'00631L');
  assert.ok(p.residual>=0);
  close((p.a-p.reduceOnlyAmount)/(p.a-p.reduceOnlyAmount+p.b),.6,1e-10);
});
test('missing numeric quotes cannot masquerade as unchanged prices',()=>{
  for(const value of ['',null,undefined,'--',true])assert.throws(()=>quoteNumber(value,'test'));
  assert.equal(quoteNumber('0','test'),0);
  assert.equal(quoteNumber('+1.25','test'),1.25);
  assert.equal(quoteNumber('1,234.50','test'),1234.5);
});
test('invalid, future and regressing source dates are rejected',()=>{
  const now=new Date('2026-10-25T01:00:00+08:00');
  assert.equal(validateQuoteDate('2026-10-23','2026-10-22',now),'2026-10-23');
  assert.throws(()=>validateQuoteDate('2026-02-30',undefined,now));
  assert.throws(()=>validateQuoteDate('2026-10-26',undefined,now));
  assert.throws(()=>validateQuoteDate('2026-10-22','2026-10-23',now));
});
test('review build is idempotent and preserves loan, date and holding data',async()=>{
  const once=await installPortfolioReview(html),twice=await installPortfolioReview(once);
  assert.equal((twice.match(/id="exposureBody"/g)||[]).length,1);
  assert.equal((twice.match(/id="exposureScript"/g)||[]).length,1);
  assert.equal((twice.match(/data-basis="cost"/g)||[]).length,1);
  assert.equal(twice.match(/const holdings=(\[[\s\S]*?\]);/)[1],html.match(/const holdings=(\[[\s\S]*?\]);/)[1]);
  assert.ok(twice.includes('8,683,197'));
  assert.ok(twice.includes('value="359"'));
  assert.ok(!twice.includes('780 萬'));
  assert.ok(!twice.includes('以成本金額試算'));
  for(const m of twice.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))new Function(m[1]);
});
