import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// 僅判斷日期與同步時間，不把平日直接視為開市日。
export function getDataStatus(meta, now = new Date()) {
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);
  const today = local.slice(0, 10);
  const checkedAt = new Date(meta.syncedAt.replace(' ', 'T') + ':00+08:00');
  // 給原排程 90 分鐘緩衝，週末沿用週五；國定假日仍會同步資料。
  const cutoff = new Date(now.getTime() - 90 * 60 * 1000);
  let expected = 0;
  for (let back = 0; back < 8; back++) {
    const day = new Date(Date.parse(today + 'T00:00:00+08:00') - back * 86400000);
    const date = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Taipei'}).format(day);
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const time of ['08:35', '15:35']) {
      const slot = Date.parse(date + 'T' + time + ':00+08:00');
      if (slot <= cutoff.getTime()) expected = Math.max(expected, slot);
    }
  }
  const overdue = !Number.isFinite(checkedAt.getTime()) || checkedAt.getTime() < expected;
  const earlier = meta.sources.filter(source => source.kind !== 'fx' && source.date < today);
  return {
    overdue,
    tone: overdue || earlier.length ? 'waiting' : 'current',
    title: overdue ? '同步時間已落後，等待補跑' : earlier.length ? '部分報價非今日資料' : '同步完成・報價日期為今日',
    message: overdue
      ? '超過原排程 90 分鐘仍未看到同步成功紀錄；本頁保留上次資料。'
      : earlier.length
        ? '損益依下列日期計算。休市、基金公布時差或來源尚未更新，都可能造成日期落後。'
        : '同步成功與報價日期分開核對；報價並非盤中即時行情。',
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
  const panel = `<section class="data-status ${state.tone}" id="dataStatus" aria-label="資料更新狀態"><details class="status-disclosure"><summary><span>資料更新狀態</span><strong id="dataStatusTitle">${state.title}</strong></summary><p id="dataStatusMessage">${state.message}</p><dl>${meta.sources.map(s => `<div><dt>${escapeHtml(s.name)}</dt><dd>${escapeHtml(sourceDate(s))}</dd></div>`).join('')}</dl><div class="sync-schedule">平日 08:35／15:35 同步；09:05／16:05／17:35／20:35 再檢查。排程可能延遲。</div><a href="https://github.com/reg1900/2026-investment-portfolio-review/actions/workflows/update-portfolio.yml" target="_blank" rel="noopener">查看執行紀錄 ↗</a></details></section>`;
  const css = `.data-status{margin:14px 0 18px;padding:14px 15px;border:1px solid #d6b567;border-radius:16px;background:#fff5da;color:#493d21;font-size:.9rem}.data-status.current{background:#edf5ef;border-color:#bad5c4;color:#214a35}.data-status>strong{display:block;font-size:1rem}.data-status p{margin:5px 0 10px;line-height:1.6}.data-status dl{margin:0;border-top:1px solid #493d2120}.data-status dl div{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #493d2120}.data-status dt{font-weight:650}.data-status dd{margin:0;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.sync-schedule{margin-top:9px;font-size:.86rem;line-height:1.6}.data-status a{display:inline-block;margin-top:8px;padding:3px 0;color:inherit;font-weight:750;text-underline-offset:3px}`;
  const script = `<script id="dataStatusScript">\nconst portfolioDataStatus=${JSON.stringify(meta).replaceAll('<','\\u003c')};\n${getDataStatus.toString()}\nfunction refreshDataStatus(){const state=getDataStatus(portfolioDataStatus);document.getElementById('dataStatus').className='data-status '+state.tone;document.getElementById('dataStatusTitle').textContent=state.title;document.getElementById('dataStatusMessage').textContent=state.message;}\nrefreshDataStatus();setInterval(refreshDataStatus,60000);document.addEventListener('visibilitychange',refreshDataStatus);\n</script>`;
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
