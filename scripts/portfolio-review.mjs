import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {loanConfig} from './loan-config.mjs';
import {loanSchedule,calculateExposure,stressScenario,balanceTradePlan} from './portfolio-math.mjs';
import {exposureRuntime} from './exposure-view.mjs';

export function renderMarketBalance(holdings) {
  const p=balanceTradePlan(holdings),money=n=>'$'+Math.round(n).toLocaleString('zh-TW');
  return `<section class="section" id="balance"><div class="section-head"><h2>00713 × 00631L</h2><small>依目前市值</small></div><div class="card balance"><div class="compare"><div class="compare-row"><span>目前</span><div class="track"><div class="part a" style="width:${p.aPct.toFixed(2)}%">00713<br><b>${p.aPct.toFixed(1)}%</b></div><div class="part b" style="width:${p.bPct.toFixed(2)}%">00631L<br><b>${p.bPct.toFixed(1)}%</b></div></div></div><div class="compare-row"><span>目標</span><div class="track"><div class="part a" style="width:60%">00713<br><b>60%</b></div><div class="part b" style="width:40%">00631L<br><b>40%</b></div></div></div></div><div class="rebalance-plan"><div class="rebalance-head"><strong>等額轉換試算</strong><small>不是立即交易建議</small></div><div class="trade-grid"><div class="trade sell"><span class="trade-action">賣出 ${p.sell}</span><b class="money">${money(p.amount)}</b><small>零股約 <span class="money">${p.sellUnits.toLocaleString('zh-TW')} 股</span></small></div><div class="trade buy"><span class="trade-action">買入 ${p.buy}</span><b class="money">${money(p.amount)}</b><small>依賣出款可買約 <span class="money">${p.buyUnits.toLocaleString('zh-TW')} 股</span></small></div></div><div class="target-summary">調整目標：00713 <b>60%</b>・00631L <b>40%</b></div>${p.leveragedIncrease?'<p class="risk-alert">這個調整會增加正2持倉。已有借款槓桿時，先確認曝險區的還款緩衝與下跌承受度，再決定是否執行。</p>':''}<details class="rebalance-mode"><summary>另一種方式：只減碼，不加碼</summary><p class="risk-note">只減碼 ${p.reduceOnlyCode} 約 <b class="money">${money(p.reduceOnlyAmount)}</b>，其餘一檔不變，也可讓兩檔子組合接近 60：40。賣出款可留作還款準備，或在確認提前清償條件後評估還貸；這是另一種試算，不需和上面的等額轉換同時執行。</p></details><div class="balance-note">金額以各檔最近報價的市值計；股數向下取整，未計手續費、交易稅與價差，實際可買股數可能更少。00713 是台股權益資產，不是 00631L 的避險資產。目標僅適用這兩檔，並非整體組合比例。</div></div></div></section>`;
}

function allocationRuntime(){
  let allocationBasis='cost',allocationTotal=0,allocationIndex=0;
  const allocationRing=document.getElementById('allocationRing'),allocationList=document.getElementById('allocationList'),allocationDetail=document.getElementById('allocationDetail');
  function unitText(h){return `${h.u.toLocaleString('zh-TW',{maximumFractionDigits:2})} ${h.unit}`;}
  function showAllocation(i){
    allocationIndex=i;const g=allocationGroups[i],isCost=allocationBasis==='cost';
    document.getElementById('allocationFocusName').textContent=g.name;
    document.getElementById('allocationFocusPct').textContent=`${g.pct.toFixed(2)}%`;
    allocationList.querySelectorAll('button').forEach((button,j)=>{button.classList.toggle('active',i===j);button.setAttribute('aria-pressed',String(i===j));});
    allocationDetail.innerHTML=`<div class="allocation-detail-head"><strong>${g.name}・${g.assets.length} 檔</strong><b>${g.pct.toFixed(2)}%</b></div>`+g.assets.map(h=>`<div class="allocation-asset"><strong>${h.n}</strong><span class="asset-share">${((isCost?h.c:h.v)/allocationTotal*100).toFixed(2)}%</span><small class="money">${unitText(h)}</small><span class="asset-cost money">${isCost?'成本':'市值'} ${money(Math.round(isCost?h.c:h.v))}</span></div>`).join('');syncPrivacy();
  }
  function drawAllocation(){
    const field=allocationBasis==='cost'?'c':'v';allocationTotal=holdings.reduce((sum,h)=>sum+h[field],0);
    allocationGroups.forEach(g=>{g.assets=g.keys.map(key=>holdings.find(h=>h.n===key)).filter(Boolean);g.amount=g.assets.reduce((sum,h)=>sum+h[field],0);g.pct=g.amount/allocationTotal*100;});
    let cursor=0;allocationRing.style.background=`conic-gradient(${allocationGroups.map(g=>{const start=cursor;cursor+=g.pct;return `${g.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;}).join(',')})`;
    allocationList.innerHTML=allocationGroups.map((g,i)=>`<button type="button" aria-label="查看${g.name}詳細標的" data-index="${i}"><i class="dot" style="background:${g.color}"></i><span>${g.name}</span><b>${g.pct.toFixed(2)}%</b></button>`).join('');
    allocationList.querySelectorAll('button').forEach(button=>button.onclick=()=>showAllocation(Number(button.dataset.index)));
    document.querySelectorAll('[data-basis]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.basis===allocationBasis)));
    document.getElementById('allocationBasisLabel').textContent=allocationBasis==='cost'?'依成本占比':'依市值占比';showAllocation(allocationIndex);
  }
  document.querySelectorAll('[data-basis]').forEach(button=>button.onclick=()=>{allocationBasis=button.dataset.basis;drawAllocation();});
  allocationRing.onclick=event=>{if(event.detail===0){showAllocation((allocationIndex+1)%allocationGroups.length);return;}const rect=allocationRing.getBoundingClientRect(),x=event.clientX-rect.left-rect.width/2,y=event.clientY-rect.top-rect.height/2,target=((Math.atan2(y,x)*180/Math.PI+450)%360)/360*100;let cumulative=0;const index=allocationGroups.findIndex(g=>(cumulative+=g.pct)>=target);showAllocation(index<0?0:index);};
  allocationRing.onkeydown=event=>{if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(event.key)){event.preventDefault();showAllocation((allocationIndex+(event.key==='ArrowRight'||event.key==='ArrowDown'?1:-1)+allocationGroups.length)%allocationGroups.length);}};
  drawAllocation();
}

function card(h){
  const p=h.v-h.c,rate=h.c>0?p/h.c*100:0,up=p>=0,sign=up?'+':'−',tone=up?'pl-up':'pl-down';
  const dayUp=h.day>=0,daySign=dayUp?'+':'−',dayTone=dayUp?'pl-up':'pl-down';
  const todayP=Number.isFinite(h.dayPnl)?h.dayPnl:h.v-h.v/(1+h.day/100);
  const isFund=h.k==='海外基金',quoteLabel=isFund?'淨值':'收盤價',shortQuote=h.q.replace(/^NT\$/,'$');
  const signedAmount=value=>{const n=Math.round(value);return (n>0?'+':n<0?'−':'')+Math.abs(n).toLocaleString('zh-TW');};
  const amountTone=value=>Math.round(value)>0?'pl-up':Math.round(value)<0?'pl-down':'pl-flat';
  const units=`${h.u.toLocaleString('zh-TW',{maximumFractionDigits:2})} ${h.unit}`;
  return `<article class="card holding ${up?'tile-gain':'tile-loss'}"><button class="tile-button" aria-expanded="false"><div class="card-name-row"><span class="ticker">${h.n}</span><span class="unit-pill money">${units}</span></div><div class="quote-row"><b class="quote-value">${shortQuote}</b><b class="day-rate ${dayTone}">${daySign}${Math.abs(h.day).toFixed(2)}%</b></div><div class="profit-stack"><b class="money daily-pnl ${amountTone(todayP)}" aria-label="單日價差損益，台幣，報價日期 ${h.quoteDate||h.d}" title="單日價差損益｜${h.quoteDate||h.d}｜台幣">${signedAmount(todayP)}</b><div class="total-pnl-row ${amountTone(p)}" title="未實現總損益率與金額｜台幣｜不含配息"><span class="total-rate" aria-label="未實現總損益率">${sign}${Math.abs(rate).toFixed(2)}%</span><b class="money total-pnl" aria-label="未實現總損益金額，台幣，不含配息">${signedAmount(p)}</b></div></div><div class="tile-details"><span class="detail-section">完整明細</span><span>類型</span><b>${h.k}</b><span>持有單位</span><b class="money">${units}</b><span>${quoteLabel}</span><b>${h.q}</b><span>成本均價</span><b>${h.avg}</b><span>估算市值</span><b class="money">${money(h.v)}</b><span>投資成本</span><b class="money">${money(Math.round(h.c))}</b><span>單日價差損益</span><b class="money ${amountTone(todayP)}">${signedAmount(todayP)} 元</b><span>總損益率</span><b class="${tone}">${sign}${Math.abs(rate).toFixed(2)}%</b><span>總損益金額</span><b class="money ${tone}">${sign}${money(Math.abs(Math.round(p)))}</b><span>資料日期</span><b>${h.quoteDate||h.d}</b><span>行情來源</span><b>${h.quoteSource||(isFund?'MoneyDJ 基金淨值':'證交所／櫃買中心')}</b><span class="detail-section">${isFund?'單日損益為淨值價差按目前匯率換算，未含匯率變動與配息。':'單日損益為收盤價差，未含配息及交易費用。'}</span></div></button></article>`;
}

export async function installPortfolioReview(html,{draft=true}={}) {
  const holdings=JSON.parse(html.match(/const holdings=(\[[\s\S]*?\]);/)[1]);
  const cash=Function('return '+html.match(/const cash=(\[[\s\S]*?\]);/)[1])();
  calculateExposure(holdings,cash,loanConfig);
  const css=await fs.readFile(new URL('./review-style.css',import.meta.url),'utf8');
  let output=html.replace(/<style id="portfolioReviewStyle">[\s\S]*?<\/style>\s*/,'');
  output=output.replace('</head>',`<style id="portfolioReviewStyle">${css}</style>\n</head>`);
  output=output.replace(/<div class="review-banner">[\s\S]*?<\/div>\s*/,'');
  if(draft)output=output.replace('<main class="app">','<main class="app">\n<div class="review-banner"><strong>本地審核版・尚未發布</strong>新增曝險分析與計算修正，供你審核。</div>');
  const section=`<section class="section" id="exposure"><div class="section-head"><h2>曝險</h2><small>借款資金納入</small></div><details class="card loan-controls"><summary>貸款 ${(loanConfig.originalPrincipal/10000).toLocaleString('zh-TW')} 萬・已繳 ${loanConfig.paidInstallments} 期</summary><p class="risk-note">原始貸款 <b class="money">${(loanConfig.originalPrincipal/10000).toLocaleString('zh-TW')} 萬元</b>，${loanConfig.originalMonths/12} 年、年利率 ${loanConfig.annualRate}%、無寬限期，本息平均攤還，已繳 ${loanConfig.paidInstallments} 期。依標準公式估算剩餘本金 <b class="money">${loanConfig.principal.toLocaleString('zh-TW',{maximumFractionDigits:0})} 元</b>、${loanConfig.remainingMonths} 期（${loanConfig.asOf} 記錄）；銀行按日計息與四捨五入可能略有差異。可在下方調整，僅影響這次瀏覽。實際以銀行還款表為準。</p><form id="loanForm" class="loan-form"><label>目前貸款餘額（元）<input class="money" id="loanPrincipal" type="number" min="0" max="1000000000" step="0.01" value="${loanConfig.principal}" required></label><label>年利率（%）<input id="loanRate" type="number" min="0" max="30" step="0.01" value="${loanConfig.annualRate}" required></label><label>剩餘期數（月）<input id="loanMonths" type="number" min="1" max="480" step="1" value="${loanConfig.remainingMonths}" required></label><label>還款方式<select id="loanRepayment"><option value="annuity" ${loanConfig.repayment==='annuity'?'selected':''}>本息平均攤還</option><option value="principal" ${loanConfig.repayment==='principal'?'selected':''}>本金平均攤還</option><option value="interest-only" ${loanConfig.repayment==='interest-only'?'selected':''}>全期只繳息（情境）</option></select></label><button type="submit">重新試算</button></form><div id="loanError" class="loan-error" role="status"></div></details><div id="exposureBody" aria-live="polite"></div></section>`;
  output=output.replace(/<section class="section" id="exposure">[\s\S]*?<\/section>\s*/,'');
  output=output.replace('<section class="section" id="allocation">',section+'\n\n  <section class="section" id="allocation">');
  output=output.replace(/<section class="section" id="balance">[\s\S]*?<\/section>/,renderMarketBalance(holdings));
  output=output.replace(/<nav class="bottom-nav"[\s\S]*?<\/nav>/,'<nav class="bottom-nav" aria-label="主要導覽"><a href="#home"><b>⌂</b>總覽</a><a href="#holdings"><b>◫</b>損益</a><a href="#exposure"><b>◈</b>曝險</a><a href="#allocation"><b>◉</b>配置</a><a href="#cash"><b>▥</b>配息</a><a href="#balance"><b>⇄</b>平衡</a></nav>');
  output=output.replace('<small>點分類看詳細標的</small>','<small id="allocationBasisLabel">依成本占比</small>');
  if(!output.includes('data-basis="cost"'))output=output.replace('<div class="card allocation"><div class="ring-row">','<div class="card allocation"><div class="basis-toggle" role="group" aria-label="資產配置計算基礎"><button type="button" data-basis="cost" aria-pressed="true">成本</button><button type="button" data-basis="market" aria-pressed="false">市值</button></div><div class="ring-row">');
  output=output.replace(/const allocationTotal=[\s\S]*?showAllocation\(0\);/,()=>`(${allocationRuntime.toString()})();`);
  output=output.replace(/\(function allocationRuntime\(\)\{[\s\S]*?drawAllocation\(\);\n\}\)\(\);/,()=>`(${allocationRuntime.toString()})();`);
  output=output.replace(/function card\(h\)\{[\s\S]*?\}\s*document.getElementById\('holdingsGrid'\)/,()=>card.toString()+"\ndocument.getElementById('holdingsGrid')");
  const annualCash=cash.reduce((sum,m)=>sum+m.x.reduce((s,x)=>s+Number(x[1]),0),0);
  output=output.replace(/<div class="cash-top">[\s\S]*?<\/div>/,`<div class="cash-top"><span>12 個月配息情境</span><strong class="money">NT$${annualCash.toLocaleString('zh-TW')}</strong></div>`);
  if(!output.includes('class="cash-plan-note"'))output=output.replace('<div class="cash-detail" id="cashDetail" aria-live="polite"></div>','<div class="cash-detail" id="cashDetail" aria-live="polite"></div><p class="cash-plan-note">沿用既有配息表，部分月份含實收金額；尚未隨持倉及最新配息公告自動重估。配息可能含本金，不代表投資報酬。</p>');
  output=output.replace(/<script id="exposureScript">[\s\S]*?<\/script>\s*/,'');
  const functions=[loanSchedule,calculateExposure,stressScenario].map(fn=>fn.toString()).join('\n');
  output=output.replace('</body>',()=>`<script id="exposureScript">\n${functions}\n(${exposureRuntime.toString()})();\n</script>\n</body>`);
  return output;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const path=new URL('../index.html',import.meta.url);
  const draft=!process.argv.includes('--publish');
  await fs.writeFile(path,await installPortfolioReview(await fs.readFile(path,'utf8'),{draft}));
  console.log(draft?'Local exposure review built; no publication performed.':'Publication HTML built locally; deployment is a separate step.');
}
