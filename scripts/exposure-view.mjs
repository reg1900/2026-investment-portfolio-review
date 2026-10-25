export function exposureRuntime() {
  const root=document.getElementById('exposureBody');
  const currency=n=>'$'+Math.round(n).toLocaleString('zh-TW');
  const wan=n=>(n/10000).toLocaleString('zh-TW',{minimumFractionDigits:1,maximumFractionDigits:1})+' 萬';
  const percent=n=>(n*100).toFixed(1)+'%';
  let drop=.2,cut=0,monthIndex=0;
  function readLoan(){
    if(!document.getElementById('loanForm').checkValidity())throw new Error('請完整填入有效的貸款餘額、利率與剩餘期數。');
    return {principal:Number(document.getElementById('loanPrincipal').value),annualRate:Number(document.getElementById('loanRate').value),remainingMonths:Number(document.getElementById('loanMonths').value),repayment:document.getElementById('loanRepayment').value};
  }
  function render(){
    const focusedId=document.activeElement?.id,focusedDrop=document.activeElement?.dataset?.drop;
    let loan,e;
    try{loan=readLoan();e=calculateExposure(holdings,cash,loan);document.getElementById('loanError').textContent='';}
    catch(error){document.getElementById('loanError').textContent=error.message;return;}
    const stress=stressScenario(e,drop),higher=loanSchedule({...loan,annualRate:Math.min(30,loan.annualRate+1)});
    const afterCut=e.annualCash*(1-cut)-e.repay.firstYearPayment;
    const selected=e.months[monthIndex],income=selected.income*(1-cut),net=income-selected.payment;
    const moneyClass=n=>n<0?'negative-value':'positive-value';
    const maxFlow=Math.max(...e.months.map(m=>Math.max(m.income,m.payment)),1);
    const bars=e.months.map((m,i)=>{const height=m.income*(1-cut)/maxFlow*120;return `<rect x="${32+i*46}" y="${145-height}" width="26" height="${height}" rx="5" fill="${i===monthIndex?'#d6a846':'#4a7b68'}"><title>${m.name}：配息 ${currency(m.income*(1-cut))}；還款 ${currency(m.payment)}</title></rect><text x="${45+i*46}" y="169" text-anchor="middle">${i+1}</text>`;}).join('');
    const paymentPoints=e.months.map((m,i)=>`${45+i*46},${145-m.payment/maxFlow*120}`).join(' ');
    root.innerHTML=`
      <div class="risk-kpis"><div><span>投資組合市值</span><strong class="money">${wan(e.assets)}</strong></div><div class="net-equity"><span>扣貸款後淨資產</span><strong class="money ${moneyClass(e.equity)}">${wan(e.equity)}</strong></div><div><span>貸款／市值</span><strong>${percent(e.loanShare)}</strong></div><div><span>資產／淨資產</span><strong>${e.equity>0?e.leverage.toFixed(2)+' 倍':'淨資產非正值'}</strong></div></div>
      <div class="card risk-panel"><div class="risk-bar" role="img" aria-label="貸款占資產 ${percent(e.loanShare)}"><div class="debt-part" style="width:${Math.min(100,e.loanShare*100)}%"></div><div class="equity-part" style="width:${Math.max(0,100-e.loanShare*100)}%"></div></div><div class="risk-legend"><span>● 借款 <b class="money">${wan(e.debt)}</b></span><span>● 淨資產 <b class="money">${wan(e.equity)}</b></span></div><p class="risk-note">只計本投資組合與這筆貸款，不含房屋、其他現金、收入或負債。貸款餘額需自行更新，不會隨行情自動扣本金。</p></div>
      <div class="card risk-panel"><div class="risk-subhead"><h3>下跌會放大多少？</h3><span>固定負債壓力測試</span></div><div class="risk-tabs" role="group" aria-label="選擇整體投資組合跌幅">${[.1,.2,.3,.4].map(x=>`<button type="button" data-drop="${x}" aria-pressed="${x===drop}">跌 ${percent(x)}</button>`).join('')}</div><div class="stress-result"><div><span>組合市值減少</span><strong class="money negative-value">${wan(stress.loss)}</strong></div><div><span>淨資產減少</span><strong class="negative-value">${e.equity>0?percent(stress.equityLoss):'不適用'}</strong></div><div><span>扣貸款後剩餘</span><strong class="money ${moneyClass(stress.equity)}">${wan(stress.equity)}</strong></div></div><div class="stress-meter"><span style="width:${Math.min(100,stress.equityLoss*100)}%"></span></div><p class="risk-note">${e.equity>0?`整體市值下跌約 <b>${percent(e.equityBuffer)}</b>，即會耗盡這部分淨資產。`:'目前投資組合市值已不足抵銷貸款。'}這不是斷頭線或發生機率。假設所有資產合計下跌所選幅度、貸款不變；未計期間配息、利息及還本，也未再對 00631L 重複乘二。</p></div>
      <div class="card risk-panel"><div class="risk-subhead"><h3>還款與配息</h3><span>沿用既有配息情境</span></div><div class="repay-kpis"><div><span>${loan.repayment==='principal'?'下期本息':'每月本息'}</span><strong class="money">${currency(e.repay.firstPayment)}</strong></div><div><span>下期利息</span><strong class="money">${currency(e.repay.firstInterest)}</strong></div><div><span>下期還本金</span><strong class="money">${currency(e.repay.firstPrincipal)}</strong></div></div>
      ${loan.repayment==='interest-only'?`<p class="risk-alert">此情境假設全期只繳利息，到期仍須償還 <b class="money">${wan(e.repay.balloon)}</b> 本金；若只是短期寬限期，期滿月付額需另算。</p>`:''}
      <p class="risk-note">本金還款會減少負債；利息才是借款成本。利率 ${loan.annualRate}% 假設不變，未含開辦費與提前還款費。</p>
      <label class="cash-cut">配息減少 <select id="cashCut" aria-label="配息減少情境">${[0,.2,.4,1].map(c=>`<option value="${c}" ${cut===c?'selected':''}>${percent(c)}</option>`).join('')}</select></label>
      <div class="flow-summary"><span>12 個月配息扣本息</span><strong class="money ${moneyClass(afterCut)}">${afterCut>=0?'+':'−'}${currency(Math.abs(afterCut))}</strong></div>
      <svg class="cash-loan-chart" viewBox="0 0 600 185" role="img" aria-label="12個月配息與貸款本息比較；選擇下方月份查看金額"><line x1="26" x2="580" y1="145" y2="145" stroke="#d7d9cf"/>${bars}<polyline points="${paymentPoints}" fill="none" stroke="#a95b39" stroke-width="3" stroke-dasharray="7 5"/></svg>
      <div class="chart-legend"><span>▰ 配息情境</span><span>┄ 每月本息</span></div>
      <div class="flow-month"><label>月份 <select id="flowMonth" aria-label="查看月份配息與還款">${e.months.map((m,i)=>`<option value="${i}" ${monthIndex===i?'selected':''}>${m.name}</option>`).join('')}</select></label><dl><div><dt>配息</dt><dd class="money">${currency(income)}</dd></div><div><dt>本息</dt><dd class="money">${currency(selected.payment)}</dd></div><div><dt>${net<0?'需補足':'餘額'}</dt><dd class="money ${moneyClass(net)}">${currency(Math.abs(net))}</dd></div></dl></div>
      <p class="risk-note">不減配時，12 個月合計 <b class="money">${wan(e.annualCash)}</b>，覆蓋本息 ${e.repay.firstYearPayment>0?e.coverage.toFixed(2)+' 倍':'不適用'}，有 <b>${e.shortMonths} 個月</b>不足。${e.cutBreakeven>0?`若配息總額減少約 ${percent(e.cutBreakeven)}，全年也會不足。`:'目前全年配息已不足支付本息。'}此表沿用 2026 年既有月份與金額，對照試算前 12 期還款，並非未來 12 個月預測；部分月份含實收數字，尚未隨新持倉與配息公告重估。配息可能含本金，不等於獲利。</p>
      <details class="risk-details"><summary>看完整還款與升息試算</summary><dl class="risk-dl"><div><dt>前 12 期本息合計</dt><dd class="money">${currency(e.repay.firstYearPayment)}</dd></div><div><dt>前 12 期利息合計</dt><dd class="money">${currency(e.repay.firstYearInterest)}</dd></div><div><dt>5 年後剩餘本金</dt><dd class="money">${currency(e.repay.balanceAfterFiveYears)}</dd></div><div><dt>剩餘全期利息合計</dt><dd class="money">${currency(e.repay.totalInterest)}</dd></div><div><dt>利率升至 ${Math.min(30,loan.annualRate+1).toFixed(1)}%：下期本息</dt><dd class="money">${currency(higher.firstPayment)}</dd></div></dl><p class="risk-note">升息情境假設立刻以新利率及目前剩餘本金、年限重算。實際依銀行還款表。</p></details></div>
      <div class="card risk-panel"><div class="risk-subhead"><h3>重疊曝險</h3><span>依市值估算</span></div><dl class="risk-dl"><div><dt>台股 ETF 直接持倉</dt><dd>${percent(e.taiwanEquity/e.assets)}</dd></div><div><dt>0050＋正2的臺灣50單日名目曝險</dt><dd>${percent(e.taiwan50Exposure/e.assets)}</dd></div><div><dt>00631L 額外一倍曝險</dt><dd class="money">${wan(e.leveragedValue)}</dd></div><div><dt>含正2的簡化名目曝險／淨資產</dt><dd>${e.equity>0?e.simplifiedLeverage.toFixed(2)+' 倍':'不適用'}</dd></div><div><dt>美元計價海外基金</dt><dd>${percent(e.usdFunds/e.assets)}</dd></div></dl><p class="risk-note">臺灣50名目曝險＝0050 市值＋00631L 市值×2，僅近似單日敏感度；其他資產按市值一倍計，不是整體 Beta、波動率或長期報酬倍數。尚未穿透其他 ETF／基金成分與衍生品，不能據此視為已充分分散。台幣計價的海外債 ETF 仍可能有匯率、利率與信用風險。</p></div>
      <div class="card risk-panel risk-advice"><h3>目前的建議順序</h3><ol><li><strong>先準備還款緩衝</strong><p>本息 ${loan.repayment==='principal'?'下期':'每月'}約 <b class="money">${currency(e.repay.firstPayment)}</b>。可先以 6–12 期本息 <b class="money">${wan(e.reserveSix)}～${wan(e.reserveTwelve)}</b> 作為現金準備情境，另計生活費；長天期債券 ETF 不等同現金。是否足夠仍取決於你的薪資、家庭支出及貸款條件。</p></li><li><strong>先確認能承受淨資產跌幅</strong><p>目前市值跌 20%，這部分淨資產約減少 <b>${e.equity>0?percent(stressScenario(e,.2).equityLoss):'不適用'}</b>。若無法承受，優先評估降低借款或高波動資產，而非只追求配息高於 ${loan.annualRate}%。</p></li><li><strong>60：40 保留為目標，不自動追補正2</strong><p>00713 與 00631L 有台股共同風險，前者不能視為後者的避險部位。借款已放大曝險，先確認現金準備與跌幅承受度，再決定是否補足正2。下方平衡區提供依市值計算的兩種方式。</p></li></ol><details class="risk-details"><summary>計算方法與參考資料</summary><p>淨資產＝組合市值－貸款餘額；資產槓桿＝組合市值÷淨資產。本息攤還採月利率＝年利率÷12，以未四捨五入值計算，顯示到元；淨資產未扣尚未發生的未來利息。所有試算未計稅費。</p><a href="https://pip.moi.gov.tw/Publicize/Info/C1040" target="_blank" rel="noopener">內政部：房貸本息試算</a><a href="https://www.yuantaetfs.com/product/detail/00631L/Basic_information" target="_blank" rel="noopener">元大：00631L 單日槓桿與風險</a><a href="https://www.capitalfund.com.tw/opinion/article/64" target="_blank" rel="noopener">群益：配息與總報酬的差異</a></details></div>`;
    root.querySelectorAll('[data-drop]').forEach(button=>button.onclick=()=>{drop=Number(button.dataset.drop);render();});
    document.getElementById('cashCut').onchange=event=>{cut=Number(event.target.value);render();};
    document.getElementById('flowMonth').onchange=event=>{monthIndex=Number(event.target.value);render();};
    syncPrivacy();
    if(focusedId)document.getElementById(focusedId)?.focus({preventScroll:true});
    else if(focusedDrop)root.querySelector(`[data-drop="${focusedDrop}"]`)?.focus({preventScroll:true});
  }
  document.getElementById('loanForm').addEventListener('submit',event=>{event.preventDefault();render();});
  document.getElementById('loanForm').addEventListener('change',render);
  render();
}
