import {validateQuoteDate} from './source-validation.mjs';

export function parseSchroderNav(html) {
  const match=html.match(/<script\b[^>]*id=["']vike_pageContext["'][^>]*>([\s\S]*?)<\/script>/i);
  if(!match)throw new Error('Schroder NAV data missing');
  const body=JSON.parse(match[1]).data?.body;
  if(body?.shareClass?.isin!=='LU1884790491' ||
      body.shareClass.externalId!=='SCHDR_F000011DCB')throw new Error('Schroder share class mismatch');
  const points=body.fxPricePanel?.series?.[0]?.data;
  if(!Array.isArray(points)||points.length<2)throw new Error('Schroder price history missing');
  const [prior,current]=points.slice(-2);
  if(![prior[0],prior[1],current[0],current[1]].every(Number.isFinite) ||
      prior[0]>=current[0] || prior[1]<=0 || current[1]<=0)throw new Error('Invalid Schroder price history');
  const date=validateQuoteDate(new Date(current[0]).toISOString().slice(0,10));
  const metric=body.fxProfileHeroPanel?.metricList?.items?.find(item=>item.id==='priceEndValue');
  const metricDate=metric?.date?.split('.').reverse().join('-');
  const metricValue=Number(metric?.value?.replace(/<[^>]*>/g,'').replace(/&#\d+;/g,'').trim());
  if(metricDate!==date || metricValue!==current[1])throw new Error('Schroder NAV summary mismatch');
  return {nav:current[1],isoDate:date,change:current[1]-prior[1],day:(current[1]/prior[1]-1)*100,
    source:'施羅德官方基金中心',sourceUrl:'https://www.schroders.com/zh-tw/tw/individual/fund-centre/?externalId=SCHDR_F000011DCB&r=%2Ffund%2FSCHDR_F000011DCB%2F'};
}
