import {holdingNames,quoteLinks} from './quote-links.mjs';

export function normalizeCashReceipts(snapshot,now=new Date()) {
  if(!snapshot||!Array.isArray(snapshot.entries)||!Number.isFinite(Date.parse(snapshot.syncedAt)))throw Error('Cash receipts unavailable');
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(now);
  const entries=snapshot.entries.map(({month,date=null,code,currency,amount})=>{
    if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month>today.slice(0,7))throw Error('Invalid receipt month');
    if(date!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||
        new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date.slice(0,7)!==month||date>today))throw Error('Receipt date does not match month');
    if(typeof code!=='string'||!code.trim()||code.length>100||!['TWD','USD'].includes(currency)||!Number.isFinite(amount)||amount<0)throw Error('Invalid cash receipt');
    return {month,date,code:code.trim(),currency,amount};
  });
  return {syncedAt:new Date(snapshot.syncedAt).toISOString(),entries};
}

export function groupCashReceipts(snapshot,currency) {
  const months=new Map();
  for(const entry of snapshot.entries.filter(entry=>entry.currency===currency)){
    const month=months.get(entry.month)||{month:entry.month,cents:0,entries:[]};
    month.cents+=Math.round(entry.amount*100);
    month.entries.push(entry);
    months.set(entry.month,month);
  }
  return [...months.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(month=>({...month,total:month.cents/100}));
}

function cashReceiptsRuntime() {
  const data=cashReceiptsSnapshot;
  let currency=data.entries.some(entry=>entry.currency==='USD')&&!data.entries.some(entry=>entry.currency==='TWD')?'USD':'TWD';
  let selectedMonth='';
  const colors={'00713':'#3285ba','00919':'#cc8732','00937B':'#168e88','00933B':'#8267af','00751B':'#77924c','0050':'#2864a5','00878':'#cd6680','00406A':'#cb744d','富達永續':'#b48436','施羅德環球':'#5a68a6'};
  const safe=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const money=value=>(currency==='TWD'?'NT$':'US$')+value.toLocaleString('zh-TW',{maximumFractionDigits:2});
  const monthLabel=month=>month.replace('-',' 年 ')+' 月';
  function draw() {
    const months=groupCashReceipts(data,currency);
    const total=months.reduce((sum,month)=>sum+month.cents,0)/100;
    document.querySelectorAll('[data-receipt-currency]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.receiptCurrency===currency)));
    document.getElementById('receiptTotal').textContent=months.length?money(total):'尚無入帳紀錄';
    document.getElementById('receiptCount').textContent=data.entries.filter(entry=>entry.currency===currency).length+' 筆';
    const maximum=Math.max(1,...months.map(month=>month.total));
    document.getElementById('receiptMonths').innerHTML=months.map(month=>
      '<button type="button" class="receipt-month" data-month="'+month.month+'" aria-label="查看'+month.month+' '+currency+'配息"><span>'+monthLabel(month.month)+
      '</span><span class="receipt-track" aria-hidden="true"><span class="receipt-fill" style="width:'+Math.max(0,month.total/maximum*100)+'%">'+
      month.entries.map(entry=>'<i style="width:'+(month.total>0?Math.round(entry.amount*100)/month.cents*100:0)+'%;background:'+(colors[entry.code]||'#658ba1')+'"></i>').join('')+
      '</span></span><b class="money">'+money(month.total)+'</b></button>').join('');
    selectedMonth=months.some(month=>month.month===selectedMonth)?selectedMonth:months.at(-1)?.month;
    const selected=months.find(month=>month.month===selectedMonth);
    document.getElementById('receiptDetail').innerHTML=selected?
      '<div class="detail-head"><span>'+monthLabel(selected.month)+'</span><b class="money">'+money(selected.total)+'</b></div>'+
      selected.entries.map(entry=>{
        const name=holdingNames[entry.code]||entry.code,url=quoteLinks[entry.code];
        const label=url?'<a href="'+safe(url)+'" target="_blank" rel="noopener noreferrer">'+safe(name)+'</a>':safe(name);
        return '<div class="receipt-line"><span><i style="background:'+(colors[entry.code]||'#658ba1')+'"></i>'+label+
          '<small>'+(entry.date?safe(entry.date):'已知月份，日期未提供')+'</small></span><b class="money">'+money(entry.amount)+'</b></div>';
      }).join(''):'<p class="receipt-empty">尚無'+(currency==='TWD'?'新台幣':'美元')+'配息入帳紀錄。</p>';
    document.querySelectorAll('.receipt-month').forEach(button=>{
      button.setAttribute('aria-pressed',String(button.dataset.month===selectedMonth));
      button.onclick=()=>{selectedMonth=button.dataset.month;draw();};
    });
    syncPrivacy();
  }
  document.querySelectorAll('[data-receipt-currency]').forEach(button=>button.onclick=()=>{currency=button.dataset.receiptCurrency;draw();});
  draw();
}

export function installCashReceipts(html,rawSnapshot,now=new Date()) {
  const previous=html.match(/const cashReceiptsSnapshot=([^\n]+);/);
  let snapshot,valid=true;
  try{snapshot=normalizeCashReceipts(rawSnapshot,now);}
  catch{
    valid=false;
    try{snapshot=previous?normalizeCashReceipts(JSON.parse(previous[1]),now):null;}catch{snapshot=null;}
    snapshot ||= {syncedAt:null,entries:[]};
  }
  const synced=snapshot.syncedAt?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short'}).format(new Date(snapshot.syncedAt)):'尚未成功同步';
  const section='<section class="section" id="cash"><div class="section-head"><h2>每月已領配息</h2><small>按入帳月份</small></div>'+
    '<div class="card cash-card"><div class="receipt-currencies" role="group" aria-label="配息幣別"><button type="button" data-receipt-currency="TWD">新台幣</button><button type="button" data-receipt-currency="USD">美元</button></div>'+
    '<div class="receipt-total"><span>已登錄配息</span><strong id="receiptTotal" class="money"></strong><small id="receiptCount"></small></div>'+
    '<div id="receiptMonths" class="receipt-months"></div><div id="receiptDetail" aria-live="polite"></div>'+
    '<p class="receipt-note">依原始試算表「配息紀錄」實收金額彙總。未登錄的配息尚未計入。</p>'+
    '<p class="receipt-note">配息紀錄同步 '+synced+'（台北）'+(!valid?'・本次未取得新紀錄':'')+'</p></div></section>';
  let output=html.replace(/<section class="section" id="cash">[\s\S]*?<\/section>/,()=>section);
  output=output.replace(/const cash=\[[\s\S]*?\];/,'const cash=[];');
  output=output.replace(/const bars=document\.getElementById\('bars'\)[\s\S]*?showCash\(9\);\n/,'');
  output=output.replace(/<script id="cashReceiptsScript">[\s\S]*?<\/script>\s*/,'');
  const script='<script id="cashReceiptsScript">const cashReceiptsSnapshot='+JSON.stringify(snapshot).replaceAll('<','\\u003c')+';\n'+
    groupCashReceipts.toString()+'\n('+cashReceiptsRuntime.toString()+')();</script>\n';
  return output.replace('</body>',()=>script+'</body>');
}
