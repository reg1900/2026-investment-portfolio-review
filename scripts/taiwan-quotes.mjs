import {quoteNumber,validateQuoteDate} from './source-validation.mjs';

export const TAIWAN_SOURCES={
  report:'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX',
  twse:'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
  tpex:'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes',
};
const plain=value=>String(value??'').replace(/<[^>]*>/g,'').trim();
function quote(price,change,isoDate,source,sourceUrl,now) {
  price=quoteNumber(price,'close');change=quoteNumber(change,'change');
  if(!(price>0)||!(price-change>0))throw new Error('Invalid close or previous close');
  return {price,change,day:change/(price-change)*100,
    isoDate:validateQuoteDate(isoDate,undefined,now),source,sourceUrl};
}
export function completedDateCandidates(now=new Date()) {
  const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
  // This is a close-only dashboard. Before the afternoon sync, use the prior
  // calendar day; skip weekends and let the actual report identify holidays.
  const offset=parts.slice(11,16)>='15:35'?0:1;
  const base=Date.parse(parts.slice(0,10)+'T12:00:00Z');
  const dates=[];
  for(let i=offset;i<offset+10;i++){
    const day=new Date(base-i*86400000),weekday=day.getUTCDay();
    if(weekday!==0&&weekday!==6)dates.push(day.toISOString().slice(0,10));
  }
  return dates;
}
export function parseDailyReport(data,positions,date,now=new Date()) {
  if(typeof data?.stat!=='string')throw new Error('Invalid TWSE daily report response');
  if(data.stat!=='OK'){
    if(/沒有|查無|很抱歉/.test(data.stat))return new Map();
    throw new Error('TWSE daily report returned an error');
  }
  if(data.date!==date.replaceAll('-',''))throw new Error('TWSE report date mismatch');
  const table=data.tables?.find(t=>t.fields?.includes('證券代號')&&t.fields?.includes('收盤價'));
  if(!table||!Array.isArray(table.data))throw new Error('TWSE close table missing');
  const index=field=>{const i=table.fields.indexOf(field);if(i<0)throw new Error('TWSE report field missing');return i;};
  const code=index('證券代號'),close=index('收盤價'),sign=index('漲跌(+/-)'),change=index('漲跌價差');
  const result=new Map(),url=TAIWAN_SOURCES.report+'?date='+data.date+'&type=ALLBUT0999&response=json';
  for(const row of table.data){
    if(!(row[code] in positions))continue;
    if(result.has(row[code]))throw new Error('Duplicate symbol in TWSE daily report');
    const symbol=plain(row[sign]),magnitude=quoteNumber(row[change],'change');
    if(magnitude<0||(!['+','-','－','−'].includes(symbol)&&!(symbol===''&&magnitude===0)))
      throw new Error('TWSE change sign missing or not comparable');
    result.set(row[code],quote(row[close],['-','－','−'].includes(symbol)?-magnitude:magnitude,
      date,'證交所盤後每日報表',url,now));
  }
  return result;
}
export function parseBulkQuotes(rows,positions,market,now=new Date()){
  if(!Array.isArray(rows))throw new Error('Exchange quotes are not an array');
  const result=new Map();
  for(const row of rows){
    const code=row.Code||row.SecuritiesCompanyCode;
    if(!(code in positions))continue;
    const date=String(row.Date);
    if(!/^\d{7}$/.test(date))throw new Error('Invalid exchange quote date');
    if(result.has(code))throw new Error('Duplicate symbol in exchange quotes');
    const isoDate=`${Number(date.slice(0,3))+1911}-${date.slice(3,5)}-${date.slice(5,7)}`;
    result.set(code,quote(row.ClosingPrice??row.Close,row.Change,isoDate,
      market==='tpex'?'櫃買中心收盤資料':'證交所 OpenAPI 備援',TAIWAN_SOURCES[market],now));
  }
  return result;
}
export function selectQuotes(maps,positions){
  const selected=new Map();
  // Earlier maps have priority on the same date, but disagreement is never hidden.
  for(const map of maps)for(const [code,candidate] of map){
    const current=selected.get(code);
    if(current?.isoDate===candidate.isoDate&&
      (Math.abs(current.price-candidate.price)>.005||Math.abs(current.change-candidate.change)>.005))
      throw new Error('Same-date close disagreement for '+code);
    if(!current||candidate.isoDate>current.isoDate)selected.set(code,candidate);
  }
  const missing=Object.keys(positions).filter(code=>!selected.has(code));
  if(missing.length)throw new Error('Taiwan close sources missing symbols: '+missing.join(', '));
  return selected;
}
export async function fetchTaiwanCloses(positions,request,{now=new Date(),warn=console.warn}={}){
  async function daily(){
    for(const date of completedDateCandidates(now)){
      const url=TAIWAN_SOURCES.report+'?date='+date.replaceAll('-','')+'&type=ALLBUT0999&response=json';
      const map=parseDailyReport(await request(url,'json'),positions,date,now);
      if(map.size)return map;
    }
    throw new Error('No recent completed TWSE report available');
  }
  const responses=await Promise.allSettled([
    daily(),
    request(TAIWAN_SOURCES.twse,'json').then(x=>parseBulkQuotes(x,positions,'twse',now)),
    request(TAIWAN_SOURCES.tpex,'json').then(x=>parseBulkQuotes(x,positions,'tpex',now)),
  ]);
  const labels=['TWSE daily report','TWSE OpenAPI backup','TPEx'];
  const maps=responses.map((r,i)=>{
    if(r.status==='fulfilled')return r.value;
    warn(labels[i]+' unavailable or invalid; trying other validated close sources');
    return new Map();
  });
  const result=selectQuotes(maps,positions);
  const newest=[...result.values()].map(q=>q.isoDate).sort().at(-1);
  for(const [code,q] of result)if(q.isoDate<newest)warn(code+' close is older: '+q.isoDate+' ('+q.source+')');
  return result;
}
