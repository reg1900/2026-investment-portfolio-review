import fs from 'node:fs/promises';
import {quoteFreshness} from './quote-freshness.mjs';
import { pathToFileURL } from 'node:url';

// 僅判斷日期與同步時間，不把平日直接視為開市日。
export function getDataStatus(meta, now = new Date()) {
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);
  const today = local.slice(0, 10);
  const checkedAt = new Date(meta.syncedAt.replace(' ', 'T') + ':00+08:00');
  // 主更新與基金補抓各保留 90 分鐘緩衝。條件式補跑不算必到的更新。
  const cutoff = new Date(now.getTime() - 90 * 60 * 1000);
  let expected = 0;
  for (let back = 0; back < 8; back++) {
    const day = new Date(Date.parse(today + 'T00:00:00+08:00') - back * 86400000);
    const date = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Taipei'}).format(day);
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    const slots = [];
    if (weekday >= 2) slots.push('10:47', '14:17');
    if (weekday >= 1 && weekday <= 5) slots.push('16:17', '17:17');
    if (weekday === 6) slots.push('17:17');
    for (const time of slots) {
      const slot = Date.parse(date + 'T' + time + ':00+08:00');
      if (slot <= cutoff.getTime()) expected = Math.max(expected, slot);
    }
  }
  const quoteAudit=quoteFreshness(meta.holdings||[],now);
  const quoteAlert=(meta.holdings||[]).length>0&&quoteAudit.alert;
  const overdue = !Number.isFinite(checkedAt.getTime()) || checkedAt.getTime() < expected;
  const priced = meta.sources.filter(source => source.kind !== 'fx');
  const earlier = priced.filter(source => source.date < today);
  const funds = priced.filter(source => source.name.includes('淨值'));
  const etfs = priced.filter(source => source.name === '台灣 ETF 收盤');
  const fundsBehind = earlier.length > 0 && earlier.every(source => funds.includes(source));
  const datedFunds = funds.length && funds.every(source => source.date === funds[0].date && /^\d{4}-\d{2}-\d{2}$/.test(source.date));
  const fundTitle = datedFunds ? '基金淨值 ' + funds[0].date.slice(5).replace('-', '/') : '各基金估值日見明細';
  const splitDates = fundsBehind && etfs.length > 0 && etfs.every(source => source.date === today);
  const etfDate = etfs[0]?.date;
  const alignedEtfs = /^\d{4}-\d{2}-\d{2}$/.test(etfDate) && etfs.every(source => source.date === etfDate);
  const datedTitle = alignedEtfs && funds.length ? '台股 ' + etfDate.slice(5).replace('-', '/') + '・' + fundTitle : '';
  const problems = [];
  if (overdue) problems.push('已超過預定更新時間 90 分鐘，上次成功同步於 ' + meta.syncedAt + '。');
  if (quoteAlert) problems.push('逐檔日期：' + quoteAudit.rows.map(row => row.code + ' ' + (row.date || '未提供')).join('、') + '。');
  return {
    overdue,
    tone: quoteAlert || overdue || earlier.length ? 'waiting' : 'current',
    title: quoteAlert ? quoteAudit.message : overdue ? '同步時間已落後，等待補跑' : splitDates ? '台股已收盤・' + fundTitle : datedTitle || (earlier.length ? '部分報價非今日資料' : '同步完成・報價日期為今日'),
    message: problems.length ? problems.join(' ') : splitDates
      ? '台灣 ETF 採今日收盤價，兩檔海外基金按各自公布的淨值估算。'
      : earlier.length ? '各標的採下列報價日期估算。' : '損益依下列報價日期估算。',
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function sourceDate(source) {
  if (source.kind === 'fx' && /^\d{4}-\d{2}-\d{2}T/.test(source.date)) {
    const date = new Date(source.date);
    if (Number.isFinite(date.getTime())) return new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Taipei'}).format(date);
  }
  return source.date || '日期未提供';
}

export function installDataStatus(html, meta, now = new Date()) {
  const state = getDataStatus(meta, now);
  const panel = `<section class="data-status ${state.tone}" id="dataStatus" aria-label="資料更新狀態"><details class="status-disclosure"><summary><span>資料更新狀態</span><strong id="dataStatusTitle">${state.title}</strong></summary><p id="dataStatusMessage">${state.message}</p><dl>${meta.sources.map(s => `<div><dt>${escapeHtml(s.name)}</dt><dd>${escapeHtml(sourceDate(s))}</dd></div>`).join('')}</dl><div class="sync-schedule">台股於平日 16:17、17:17 檢查收盤，18:47 視需要補跑。基金於週二至週六 10:47、14:17 檢查，週六 17:17 再查一次。皆為台北預定時間。</div><a href="https://github.com/reg1900/2026-investment-portfolio-review/actions/workflows/update-portfolio.yml" target="_blank" rel="noopener">查看執行紀錄 ↗</a></details></section>`;
  const css = `@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto!important}}.data-status{margin:14px 0 18px;padding:14px 15px;border:1px solid #d6b567;border-radius:16px;background:#fff5da;color:#493d21;font-size:.9rem}.data-status.current{background:#edf5ef;border-color:#bad5c4;color:#214a35}.data-status>strong{display:block;font-size:1rem}.data-status p{margin:5px 0 10px;line-height:1.6}.data-status dl{margin:0;border-top:1px solid #493d2120}.data-status dl div{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #493d2120}.data-status dt{font-weight:650}.data-status dd{margin:0;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.sync-schedule{margin-top:9px;font-size:.86rem;line-height:1.6}.data-status a{display:inline-block;margin-top:8px;padding:3px 0;color:inherit;font-weight:750;text-underline-offset:3px}`;
  const script = `<script id="dataStatusScript">\nconst portfolioDataStatus=${JSON.stringify(meta).replaceAll('<','\\u003c')};\n${quoteFreshness.toString()}\n${getDataStatus.toString()}\nfunction refreshDataStatus(){const state=getDataStatus(portfolioDataStatus);document.getElementById('dataStatus').className='data-status '+state.tone;document.getElementById('dataStatusTitle').textContent=state.title;document.getElementById('dataStatusMessage').textContent=state.message;}\nrefreshDataStatus();setInterval(refreshDataStatus,60000);
async function checkNewQuotes(){
 if(document.hidden||checkNewQuotes.busy||!/^https?:/.test(location.href))return;checkNewQuotes.busy=true;
 try{const u=new URL(location.href);u.hash='';u.searchParams.set('_refresh',Date.now());
 const response=await fetch(u,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)return;
 const text=await response.text(),match=text.match(/const portfolioDataStatus=([^;]+);/);
 if(!match)return;const next=JSON.parse(match[1]);
 if(next.syncedAt>portfolioDataStatus.syncedAt){
 try{sessionStorage.setItem('portfolioView',JSON.stringify({hidden:document.getElementById('privacy')?.getAttribute('aria-pressed')==='true',open:[...document.querySelectorAll('.holding.open')].map(tile=>tile.dataset.code || tile.querySelector('.position-name small')?.textContent)}));}catch{}
 const nextUrl=new URL(location.href);nextUrl.searchParams.delete('_refresh');nextUrl.searchParams.set('v',next.syncedAt.replace(/[^0-9]/g,''));
 location.replace(nextUrl.href);}
 }catch{}finally{checkNewQuotes.busy=false;}
}
try{const saved=JSON.parse(sessionStorage.getItem('portfolioView')||'null');if(saved){sessionStorage.removeItem('portfolioView');if(saved.hidden)document.getElementById('privacy').click();for(const tile of document.querySelectorAll('.holding'))if(saved.open.includes(tile.dataset.code) || saved.open.includes(tile.querySelector('.position-name small')?.textContent) || (tile.dataset.code && saved.open.includes(tile.dataset.code+' · 基金')))tile.querySelector('button').click();}}catch{}
setInterval(checkNewQuotes,120000);document.addEventListener('visibilitychange',()=>{refreshDataStatus();checkNewQuotes();});checkNewQuotes();\n</script>`;
  let output = html.replace(/<div class="asof">[\s\S]*?<\/div>/, `<div class="asof">最近同步成功：${escapeHtml(meta.syncedAt)}（台北）</div>`);
  output = output.replace(/<style id="dataStatusStyle">[\s\S]*?<\/style>\s*/,'');
  output = output.replace('</head>', `<style id="dataStatusStyle">${css}</style>\n</head>`);
  output = output.replace(/<section class="data-status[^\"]*" id="dataStatus"[\s\S]*?<\/section>\s*/, '');
  output = output.replace('</header>', '</header>\n\n  ' + panel);
  output = output.replace(/<script id="dataStatusScript">[\s\S]*?<\/script>\s*/, '');
  return output.replace('</body>', script + '\n</body>');
}

// 一次性遷移：保留既有同步時間與價格，不把版面修改當成資料同步。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = new URL('../index.html', import.meta.url);
  const html = await fs.readFile(path, 'utf8');
  const existing = html.match(/const portfolioDataStatus=([^;]+);/);
  if (existing) {
    await fs.writeFile(path, installDataStatus(html, JSON.parse(existing[1])));
    process.exit(0);
  }
  const syncedAt = html.match(/(?:更新時間：|最近同步成功：)(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)?.[1];
  const twDate = html.match(/台灣 ETF (\d{4}-\d{2}-\d{2}) 收盤/)?.[1];
  const fundDate = html.match(/海外基金 (\d{4}-\d{2}-\d{2}) 淨值/)?.[1];
  if (!syncedAt || !twDate || !fundDate) throw new Error('Missing existing source dates');
  await fs.writeFile(path, installDataStatus(html, {syncedAt, sources:[
    {name:'台灣 ETF 收盤',date:twDate}, {name:'富達永續淨值',date:fundDate},
    {name:'施羅德環球淨值',date:fundDate}, {name:'美元匯率',date:'',kind:'fx'},
  ]}));
}
