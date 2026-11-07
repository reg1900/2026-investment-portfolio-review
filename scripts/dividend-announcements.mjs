import {holdingNames} from './quote-links.mjs';

const SOURCES = [
  {id:'twse',name:'證交所收益分配',url:'https://www.twse.com.tw/rwd/zh/ETF/etfDiv?response=json',type:'json',
    page:'https://www.twse.com.tw/zh/products/securities/etf/products/div.html',codes:['0050','00713','00631L','00919','00878','00406A']},
  {id:'tpex',name:'櫃買中心除息預告',url:'https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost',type:'json',
    page:'https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost',codes:['00937B','00933B','00751B']},
  {id:'capital',name:'群益投信',url:'https://www.capitalfund.com.tw/etf/product/detail/378/interest',type:'text',codes:['00937B']},
  {id:'yuanta',name:'元大投信',url:'https://www.yuantafunds.com/myfund/information/1181?tab=3',type:'text',codes:['00751B']},
  {id:'schroder',name:'施羅德官方基金中心',type:'text',codes:['施羅德環球'],
    url:'https://fev2-vite.schdr.eu-central-1.isgdigital.com/?language=zh-tw&location=tw&channel=individual&clientId=schdr&clientVersion=v1&externalId=SCHDR_F000011DCB&r=%2Ffund%2FSCHDR_F000011DCB%2F',
    page:'https://www.schroders.com/zh-tw/tw/individual/fund-centre/?externalId=SCHDR_F000011DCB&r=%2Ffund%2FSCHDR_F000011DCB%2F'},
  {id:'fidelity',name:'MoneyDJ／台灣企銀（富達同級別）',type:'big5',codes:['富達永續'],
    url:'https://tbbfws.moneydj.com/W4/wb/wb05.djhtm?a=FTZA55-068C&aspid=TBB'},
];

function text(value) {
  return String(value ?? '').replace(/<[^>]*>/g,' ').replace(/&#\d+;/g,'')
    .replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
}
function escape(value) {
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}
export function dividendDate(value) {
  const raw=text(value);
  const match=raw.match(/^(\d{3,4})[年/-](\d{1,2})[月/-](\d{1,2})日?$/) ||
    raw.match(/^(\d{3})(\d{2})(\d{2})$/);
  if(!match) throw new Error('Invalid dividend date');
  const year=Number(match[1])+(match[1].length===3?1911:0);
  const result=year+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');
  if(new Date(result+'T00:00:00Z').toISOString().slice(0,10)!==result)throw new Error('Invalid dividend date');
  return result;
}
function amount(value) {
  if(value===null || value===undefined || /待|未|--/.test(String(value)) || !String(value).trim()) return null;
  const number=Number(String(value).replaceAll(',','').trim());
  if(!Number.isFinite(number)||number<0)throw new Error('Invalid dividend amount');
  return number;
}
function cells(html) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(row=>[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell=>text(cell[1])));
}
export function parseDividendSource(id,data) {
  if(id==='twse'){
    if(!Array.isArray(data.data)||!data.fields?.includes('收益分配發放日'))throw new Error('TWSE dividend layout changed');
    return data.data.filter(row=>SOURCES[0].codes.includes(row[0])).map(row=>({
      code:row[0],exDate:dividendDate(row[2]),payDate:dividendDate(row[4]),amount:amount(row[5]),currency:'TWD',
    }));
  }
  if(id==='tpex'){
    if(!Array.isArray(data)||(data.length>0&&!('ExRrightsExDividendDate' in data[0])))throw new Error('TPEx dividend layout changed');
    return data.filter(row=>SOURCES[1].codes.includes(row.SecuritiesCompanyCode)).map(row=>({
      code:row.SecuritiesCompanyCode,exDate:dividendDate(row.ExRrightsExDividendDate),payDate:null,amount:amount(row.CashDividend),currency:'TWD',
    }));
  }
  if(id==='capital'){
    if(!data.includes('00937B'))throw new Error('Capital fund identity missing');
    // The first dividend row on this fund-specific page is the newest.
    const labels=['評價日','參與配息最後申購日','除息日','發放日','每單位分配金額(元)'];
    const values=labels.map(label=>{
      const pattern=new RegExp('class="th-mobile[^"]*">'+label.replace(/[()]/g,'\\$&')+'<\\/div>\\s*<div[^>]*>([^<]+)<\\/div>');
      return data.match(pattern)?.[1];
    });
    if(values.some(value=>value===undefined))throw new Error('Capital dividend layout changed');
    return [{code:'00937B',exDate:dividendDate(values[2]),payDate:dividendDate(values[3]),amount:amount(values[4]),currency:'TWD'}];
  }
  if(id==='yuanta'){
    if(!data.includes('00751B'))throw new Error('Yuanta fund identity missing');
    const rows=cells(data).filter(row=>/^\d{4}\/\d{2}$/.test(row[0])&&row.length>=4);
    if(!rows.length)throw new Error('Yuanta dividend table missing');
    return rows.map(row=>({code:'00751B',exDate:dividendDate(row[1]),payDate:dividendDate(row[2]),amount:amount(row[3]),currency:'TWD'}));
  }
  if(id==='schroder'){
    const raw=data.match(/<script\b[^>]*id=["']vike_pageContext["'][^>]*>([\s\S]*?)<\/script>/i);
    const body=raw&&JSON.parse(raw[1]).data?.body;
    if(body?.shareClass?.isin!=='LU1884790491')throw new Error('Schroder dividend share class mismatch');
    const rows=body.fxPerformanceTablePanel?.sections?.find(section=>section.id==='distribution')?.data?.rows;
    if(!Array.isArray(rows)||!rows.length)throw new Error('Schroder distribution table missing');
    return rows.map(row=>({code:'施羅德環球',exDate:null,payDate:null,
      referenceDate:dividendDate(text(row[0]).split('.').reverse().join('-')),amount:amount(text(row[1])),currency:'USD'}));
  }
  if(id==='fidelity'){
    if(!data.includes("ComboReset('FTZA55-068C')"))throw new Error('Fidelity dividend share class mismatch');
    const rows=cells(data).filter(row=>/^\d{4}\/\d{2}\/\d{2}$/.test(row[0])&&row[1]==='配息'&&row[4]==='美元');
    if(!rows.length)throw new Error('Fidelity dividend table missing');
    return rows.map(row=>({code:'富達永續',exDate:dividendDate(row[0]),payDate:null,amount:amount(row[2]),currency:'USD'}));
  }
  throw new Error('Unknown dividend source');
}

export async function fetchDividendAnnouncements(fetchSource,previous={sources:[]},now=new Date()) {
  const results=await Promise.allSettled(SOURCES.map(async source=>({
    ...source,checkedAt:now.toISOString(),status:'ok',events:parseDividendSource(source.id,await fetchSource(source.url,source.type)),
  })));
  const sources=SOURCES.map((source,index)=>{
    const result=results[index];
    if(result.status==='fulfilled')return result.value;
    const old=previous.sources?.find(item=>item.id===source.id);
    return {...source,checkedAt:old?.checkedAt||null,status:'failed',events:old?.events||[]};
  });
  return {attemptedAt:now.toISOString(),sources};
}

export function renderDividendAnnouncements(snapshot,holdings,now=new Date()) {
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(now);
  const all=snapshot.sources.flatMap(source=>source.events.map(event=>({...event,source})));
  const upcoming=[],other=[];
  for(const holding of holdings){
    const records=all.filter(event=>event.code===holding.n)
      .sort((a,b)=>(b.exDate||b.referenceDate||'').localeCompare(a.exDate||a.referenceDate||''));
    const active=records.filter(event=>(event.exDate&&event.exDate>=today)||(event.payDate&&event.payDate>=today));
    const unique=[...new Map((active.length?active:records.slice(0,1)).map(event=>[
      [event.code,event.exDate,event.referenceDate,event.payDate].join('|'),event,
    ])).values()];
    const card=event=>{
      const source=event?.source||snapshot.sources.find(item=>item.codes.includes(holding.n));
      const status=!event?'本次未查到公告':event.exDate>=today?'待除息':event.payDate>=today?'待發放':'最近紀錄';
      const name=holdingNames[holding.n]||holding.n;
      const unit=event?.amount===null||!event?'金額待確認':(event.currency==='USD'?'US$':'NT$')+event.amount.toLocaleString('zh-TW',{maximumFractionDigits:6});
      const calculation=event?.amount!==null&&event?.exDate>=today
        ? '<div class="dividend-estimate"><span>按目前持有量試算</span><strong class="money">'+(event.currency==='USD'?'US$':'NT$')+
          (event.amount*holding.u).toLocaleString('zh-TW',{maximumFractionDigits:2})+'</strong></div>'
        : event?.exDate<today&&event?.payDate>=today?'<p class="dividend-note">已除息，應領數量待核對</p>':'';
      const covered=snapshot.sources.filter(item=>item.codes.includes(holding.n));
      const failed=(source?[source]:covered).filter(item=>item.status==='failed');
      const dates=event?[
        event.exDate?'<span>除息</span><b>'+event.exDate+'</b>':'',
        event.referenceDate?'<span>基準日</span><b>'+event.referenceDate+'</b>':'',
        event.payDate?'<span>發放</span><b>'+event.payDate+'</b>':'<span>發放</span><b>來源未提供</b>',
      ].join(''):'';
      const link=source?'<a href="'+escape(source.page||source.url)+'" target="_blank" rel="noopener noreferrer">'+escape(source.name)+' ↗</a>':'';
      const checked=source?.checkedAt?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short'}).format(new Date(source.checkedAt)):'';
      return '<article class="dividend-item"><div class="dividend-title"><strong>'+escape(name)+'</strong><span>'+status+'</span></div>'+
        '<div class="dividend-amount"><span>每單位</span><b class="money">'+unit+'</b></div><div class="dividend-dates">'+dates+'</div>'+calculation+
        (failed.length?'<p class="dividend-warning">來源未更新'+(source?'，保留上次紀錄':'，公告待查證')+'</p>':'')+
        '<div class="dividend-source">'+link+(checked?'<small>查詢 '+checked+'（台北）</small>':'')+'</div></article>';
    };
    if(active.length)upcoming.push(...unique.map(event=>({html:card(event),date:event.exDate>=today?event.exDate:event.payDate})));
    else other.push(card(unique[0]));
  }
  return '<div id="dividendAnnouncements" class="dividend-announcements"><div class="section-head"><h3>配息預告</h3><small>'+upcoming.length+' 筆近期公告</small></div>'+
    '<p class="dividend-note">試算依目前持有數量，未扣稅費。已除息款項依當時持有數量及實際入帳為準。</p>'+
    '<div class="dividend-upcoming">'+(upcoming.sort((a,b)=>a.date.localeCompare(b.date)).map(item=>item.html).join('')||'<p>本次未查到待除息或待發放公告。</p>')+'</div>'+
    '<details class="dividend-history"><summary>其他標的與最近紀錄（'+other.length+'）</summary>'+other.join('')+'</details></div>';
}

export function installDividendAnnouncements(html,snapshot,holdings,now=new Date()) {
  const rendered=renderDividendAnnouncements(snapshot,holdings,now);
  let output=html.replace(/<!-- dividend-announcements-start -->[\s\S]*?<!-- dividend-announcements-end -->/,'');
  const marker='<div class="card cash-card">';
  if(!output.includes(marker))throw new Error('Cash section missing');
  output=output.replace(marker,'<!-- dividend-announcements-start -->'+rendered+'<!-- dividend-announcements-end -->'+marker);
  output=output.replace(/<script id="dividendAnnouncementsData">[\s\S]*?<\/script>\s*/,'');
  return output.replace('</body>',()=>'<script id="dividendAnnouncementsData">const dividendAnnouncementsSnapshot='+
    JSON.stringify(snapshot).replaceAll('<','\\u003c')+';</script>\n</body>');
}

export function existingDividendSnapshot(html) {
  const match=html.match(/const dividendAnnouncementsSnapshot=([^\n]+);<\/script>/);
  return match?JSON.parse(match[1]):{sources:[]};
}
