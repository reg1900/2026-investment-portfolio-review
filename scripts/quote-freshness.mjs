import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export function quoteFreshness(holdings, now=new Date()) {
  const local=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
  const today=local.slice(0,10),weekday=new Date(today+'T12:00:00Z').getUTCDay();
  const quotes=holdings.filter(h=>h.unit==='股');
  const latest=quotes.map(h=>h.quoteDate||'').sort().at(-1)||'';
  const afterClose=weekday!==0&&weekday!==6&&local.slice(11)>='16:05';
  const rows=quotes.map(h=>({code:h.n,date:h.quoteDate||'',source:h.quoteSource||'',olderThanPeers:!!latest&&(h.quoteDate||'')<latest}));
  const missing=rows.filter(h=>!h.date),lagging=rows.filter(h=>h.olderThanPeers);
  // 平日不等於交易日；沒有當日報表時提示待確認，不把休市判為價格錯誤。
  const pending=afterClose&&latest<today;
  return {checkedAt:local,latest,rows,missing:missing.map(h=>h.code),lagging:lagging.map(h=>h.code),pending,
    alert:!!(missing.length||lagging.length||pending),
    message:missing.length?'部分台灣 ETF 缺少報價日期':lagging.length?'部分台灣 ETF 報價落後其他標的':pending?'盤後仍未取得今日收盤；可能來源延遲或休市，請核對':'台灣 ETF 日期一致'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
  const holdings=JSON.parse(html.match(/const holdings=(\[[\s\S]*?\]);/)[1]);
  const audit=quoteFreshness(holdings);
  console.log(JSON.stringify({...audit,runId:process.env.GITHUB_RUN_ID||null,schedule:process.env.TRIGGER_SCHEDULE||null},null,2));
  if(audit.alert)console.warn('::warning::'+audit.message);
  if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,'stale='+audit.alert+'\n');
  if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,'\n## 逐檔報價檢查\n'+audit.message+'\n\n| 標的 | 日期 | 來源 |\n|---|---|---|\n'+audit.rows.map(h=>'|'+h.code+'|'+h.date+'|'+h.source+'|').join('\n')+'\n');
  if(process.argv.includes('--retry')&&audit.alert)process.exitCode=2;
}
