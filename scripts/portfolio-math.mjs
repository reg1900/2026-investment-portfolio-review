export function loanSchedule({principal, annualRate, years, remainingMonths, repayment='annuity'}) {
  const months=remainingMonths===undefined?Math.round(years*12):remainingMonths;
  if (![principal,annualRate,months].every(Number.isFinite) || principal<0 || annualRate<0 || annualRate>30 || !Number.isInteger(months) || months<1 || months>480) throw new Error('請輸入有效貸款條件：餘額不可為負、利率 0–30%、剩餘期數 1–480 月。');
  if (!['annuity','principal','interest-only'].includes(repayment)) throw new Error('不支援的還款方式');
  const r=annualRate/1200;
  const payment=r===0?principal/months:principal*r/-Math.expm1(-months*Math.log1p(r));
  let balance=principal;
  const schedule=[];
  for(let month=1;month<=months;month++) {
    const interest=balance*r;
    let paidPrincipal=repayment==='interest-only'?0:repayment==='principal'?principal/months:payment-interest;
    if(month===months) paidPrincipal=balance;
    paidPrincipal=Math.min(balance,Math.max(0,paidPrincipal));
    balance=Math.max(0,balance-paidPrincipal);
    schedule.push({month,interest,principal:paidPrincipal,payment:interest+paidPrincipal,balance});
  }
  return {schedule,firstPayment:schedule[0].payment,firstInterest:schedule[0].interest,firstPrincipal:schedule[0].principal,
    firstYearPayment:schedule.slice(0,12).reduce((s,m)=>s+m.payment,0),firstYearInterest:schedule.slice(0,12).reduce((s,m)=>s+m.interest,0),
    totalInterest:schedule.reduce((s,m)=>s+m.interest,0),balanceAfterFiveYears:schedule[Math.min(60,months)-1].balance,
    balloon:repayment==='interest-only'?principal:0};
}

export function calculateExposure(holdings,cash,loan) {
  for(const h of holdings) if(!Number.isFinite(h.v)||h.v<0||!Number.isFinite(h.c)||h.c<0)throw new Error('持倉金額無效');
  const assets=holdings.reduce((s,h)=>s+h.v,0),cost=holdings.reduce((s,h)=>s+h.c,0);
  if(!(assets>0))throw new Error('持倉市值必須大於零');
  const debt=loan.principal,equity=assets-debt,repay=loanSchedule(loan);
  const value=name=>holdings.find(h=>h.n===name)?.v||0;
  const leveragedValue=value('00631L');
  const months=cash.map((m,i)=>{
    const income=m.x.reduce((s,x)=>s+Number(x[1]),0);
    if(!Number.isFinite(income)||income<0)throw new Error('配息金額無效');
    return {name:m.m,income,payment:repay.schedule[i]?.payment||0,net:income-(repay.schedule[i]?.payment||0)};
  });
  const annualCash=months.reduce((s,m)=>s+m.income,0);
  return {assets,cost,debt,equity,loanShare:debt/assets,leverage:equity>0?assets/equity:0,
    simplifiedLeverage:equity>0?(assets+leveragedValue)/equity:0,
    equityBuffer:Math.max(0,equity/assets),leveragedValue,
    taiwan50Exposure:value('0050')+2*leveragedValue,
    taiwanEquity:['0050','00713','00631L','00919','00878','00406A'].reduce((s,n)=>s+value(n),0),
    usdFunds:value('富達永續')+value('施羅德環球'),
    annualCash,months,shortMonths:months.filter(m=>m.net<0).length,
    annualSurplus:annualCash-repay.firstYearPayment,
    coverage:repay.firstYearPayment>0?annualCash/repay.firstYearPayment:0,
    cutBreakeven:annualCash>0?1-repay.firstYearPayment/annualCash:0,
    reserveSix:repay.schedule.slice(0,6).reduce((s,m)=>s+m.payment,0),reserveTwelve:repay.firstYearPayment,repay};
}

export function stressScenario(exposure,drop) {
  if(!Number.isFinite(drop)||drop<0||drop>1)throw new Error('跌幅需介於 0 與 100%');
  const loss=exposure.assets*drop;
  return {drop,loss,assets:exposure.assets-loss,equity:exposure.equity-loss,equityLoss:exposure.equity>0?loss/exposure.equity:0};
}

export function balanceTradePlan(holdings,target=.6) {
  const a=holdings.find(h=>h.n==='00713'),b=holdings.find(h=>h.n==='00631L');
  if(!a||!b||!(a.v+b.v>0)||!(a.u>0)||!(b.u>0))throw new Error('缺少平衡試算持倉');
  const total=a.v+b.v,diff=a.v-total*target,sell=diff>=0?a:b,buy=diff>=0?b:a,amount=Math.abs(diff);
  const sellPrice=sell.v/sell.u,buyPrice=buy.v/buy.u;
  const sellUnits=Math.floor(amount/sellPrice);
  const buyUnits=Math.floor(sellUnits*sellPrice/buyPrice);
  return {a:a.v,b:b.v,total,aPct:a.v/total*100,bPct:b.v/total*100,sell:sell.n,buy:buy.n,amount,sellUnits,buyUnits,
    residual:sellUnits*sellPrice-buyUnits*buyPrice,leveragedIncrease:buy.n==='00631L'&&amount>0,
    reduceOnlyCode:diff>=0?'00713':'00631L',reduceOnlyAmount:diff>=0?a.v-b.v*target/(1-target):b.v-a.v*(1-target)/target};
}
