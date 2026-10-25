export function quoteNumber(value,label) {
  if(value===null||value===undefined||typeof value==='boolean'||(typeof value==='string'&&!value.trim())) throw new Error(`Missing numeric quote: ${label}`);
  const number=Number(String(value).replaceAll(',','').trim());
  if(!Number.isFinite(number)) throw new Error(`Invalid numeric quote: ${label}`);
  return number;
}

export function validateQuoteDate(date,previous,now=new Date()) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Invalid source date format');
  const parsed=new Date(date+'T12:00:00Z');
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)throw new Error('Invalid source date');
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(now);
  if(date>today)throw new Error('Source date is in the future');
  if(previous&&date<previous)throw new Error('Source date moved backwards; keeping previous dashboard');
  return date;
}
