import fs from 'node:fs/promises';
import { installDataStatus, getDataStatus } from './data-status.mjs';

const HTML_PATH = new URL('../index.html', import.meta.url);
const TZ = 'Asia/Taipei';

const EXPECTED_TAIWAN = ['0050', '00713', '00937B', '00631L', '00919', '00878', '00751B', '00933B', '00406A'];
const EXPECTED_FUNDS = ['富達永續', '施羅德環球'];

const URLS = {
  twse: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
  tpex: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes',
  fidelity: 'https://tbbfws.moneydj.com/W4/wb/wb02.djhtm?a=FTZA55-068C&aspid=TBB',
  schroder: 'https://www.moneydj.com/funddj/ya/yp010001.djhtm?a=PYZT8',
  fx: 'https://raw.githubusercontent.com/haotool/app/data/public/rates/latest.json',
};

function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US');
}

function formatTaipei(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function ymdToShort(ymd) {
  const normalized = ymd.replaceAll('/', '-');
  const [, month, day] = normalized.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function rocDateToIso(value) {
  if (!/^\d{7}$/.test(value)) throw new Error(`Unexpected TWSE date: ${value}`);
  const year = Number(value.slice(0, 3)) + 1911;
  return `${year}-${value.slice(3, 5)}-${value.slice(5, 7)}`;
}

async function fetchWithTimeout(url, type = 'text') {
  const safeUrl = new URL(url).origin + new URL(url).pathname;
  for (let attempt = 1; attempt <= 3; attempt++) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'portfolio-dashboard-updater/1.0' },
    });
    if (!response.ok) {
      const safeUrl = new URL(url).origin + new URL(url).pathname;
      throw new Error(`${response.status} ${response.statusText} for ${safeUrl}`);
    }
    if (type === 'json') return await response.json();
    if (type === 'big5') {
      const bytes = await response.arrayBuffer();
      return new TextDecoder('big5').decode(bytes);
    }
    return await response.text();
  } catch {
    // 不輸出帶有同步金鑰的原始 URL 或底層錯誤。
    if (attempt === 3) throw new Error(`Source request failed after 3 attempts: ${safeUrl}`);
    console.warn(`Source request retry ${attempt}/3: ${safeUrl}`);
    await new Promise(resolve => setTimeout(resolve, attempt * 1500));
  } finally {
    clearTimeout(timer);
  }
  }
}

function portfolioKey(name) {
  if (name.includes('富達')) return '富達永續';
  if (name.includes('施羅德')) return '施羅德環球';
  return name.match(/00\d{2,3}[A-Z]?/)?.[0] || null;
}

async function fetchPortfolioSnapshot() {
  const endpoint = process.env.GOOGLE_SHEET_SYNC_URL;
  const token = process.env.GOOGLE_SHEET_SYNC_TOKEN;
  if (!endpoint || !token) throw new Error('Google Sheet sync secrets are not configured');

  const url = new URL(endpoint);
  url.searchParams.set('token', token);
  const data = await fetchWithTimeout(url, 'json');
  if (!data?.ok || !Array.isArray(data.holdings)) throw new Error('Google Sheet sync returned invalid data');

  const positions = new Map();
  for (const row of data.holdings) {
    const key = portfolioKey(String(row.name || ''));
    if (!key) continue;
    const position = {
      units: Number(row.units),
      cost: Number(row.cost),
      weight: Number(row.weight),
      averageCost: Number(row.averageCost),
    };
    if (!(position.units > 0) || !(position.cost > 0) || !(position.averageCost > 0)) {
      throw new Error(`Invalid Google Sheet position for ${key}`);
    }
    positions.set(key, position);
  }

  const expected = [...EXPECTED_TAIWAN, ...EXPECTED_FUNDS];
  const missing = expected.filter(key => !positions.has(key));
  if (missing.length) throw new Error(`Google Sheet sync missing holdings: ${missing.join(', ')}`);
  const totalCost = expected.reduce((sum, key) => sum + positions.get(key).cost, 0);
  if (!(totalCost > 1_000_000 && totalCost < 100_000_000)) throw new Error('Google Sheet total cost is outside the safety range');
  return { positions, totalCost, sourceUpdatedAt: data.updatedAt || null };
}

function extractExistingHoldings(html) {
  const match = html.match(/const holdings=(\[[\s\S]*?\]);/);
  if (!match) throw new Error('Could not find holdings array in index.html');
  // The repository owns this literal. Evaluating only the isolated array keeps
  // the updater compatible with both the original JS literal and JSON output.
  return Function(`"use strict"; return (${match[1]});`)();
}

async function fetchTaiwanQuotes(taiwanPositions) {
  const [twseRows, tpexRows] = await Promise.all([
    fetchWithTimeout(URLS.twse, 'json'),
    fetchWithTimeout(URLS.tpex, 'json'),
  ]);
  if (!Array.isArray(twseRows) || !Array.isArray(tpexRows)) {
    throw new Error('TWSE or TPEx response is not an array');
  }
  const result = new Map();
  for (const row of [...twseRows, ...tpexRows]) {
    const code = row.Code || row.SecuritiesCompanyCode;
    if (!(code in taiwanPositions)) continue;
    const price = Number(row.ClosingPrice || row.Close);
    const change = Number(row.Change);
    if (!(price > 0) || !Number.isFinite(change)) throw new Error(`Invalid Taiwan quote for ${code}`);
    const previous = price - change;
    const day = previous > 0 ? change / previous * 100 : 0;
    const isoDate = rocDateToIso(row.Date);
    result.set(code, { price, day, isoDate });
  }
  const missing = Object.keys(taiwanPositions).filter(code => !result.has(code));
  if (missing.length) throw new Error(`Taiwan exchanges missing symbols: ${missing.join(', ')}`);
  return result;
}

function parseFundSummary(html, name) {
  const match = html.match(/淨值日期[\s\S]*?<tr>\s*<td[^>]*>(\d{4}\/\d{2}\/\d{2})<\/td>\s*<td[^>]*>([\d.]+)<\/td>\s*<td[^>]*>([-+\d.]+)<\/td>/i);
  if (!match) throw new Error(`Could not parse ${name} NAV summary`);
  const nav = Number(match[2]);
  const change = Number(match[3]);
  const previous = nav - change;
  if (!(nav > 0) || !(previous > 0)) throw new Error(`Invalid ${name} NAV values`);
  return {
    nav,
    day: change / previous * 100,
    isoDate: match[1].replaceAll('/', '-'),
  };
}

async function fetchFundQuotes() {
  const [fidelityHtml, schroderHtml] = await Promise.all([
    fetchWithTimeout(URLS.fidelity, 'big5'),
    fetchWithTimeout(URLS.schroder, 'big5'),
  ]);
  return {
    fidelity: parseFundSummary(fidelityHtml, 'Fidelity'),
    schroder: parseFundSummary(schroderHtml, 'Schroder'),
  };
}

async function fetchUsdTwd() {
  const data = await fetchWithTimeout(URLS.fx, 'json');
  const value = Number(data?.sourceQuotes?.USD?.spot?.buy);
  if (!(value > 20 && value < 50)) throw new Error(`Invalid USD/TWD spot-buy rate: ${value}`);
  return { value, timestamp: data.sourcePublishedAt || data.timestamp };
}

function replaceOrThrow(html, pattern, replacement, label) {
  if (!pattern.test(html)) throw new Error(`Could not locate ${label} in index.html`);
  return html.replace(pattern, replacement);
}

function renderAllocationSection(positions) {
  const groups = [
    ['0050', ['0050'], '#174e3c'],
    ['海外基金', EXPECTED_FUNDS, '#39715c'],
    ['高股息', ['00713', '00919', '00878'], '#dda83d'],
    ['投資級債', ['00937B', '00751B', '00933B'], '#7f9fac'],
    ['00631L', ['00631L'], '#ae4d43'],
    ['00406A', ['00406A'], '#9b5d8d'],
  ];
  const total = [...positions.values()].reduce((sum, p) => sum + p.cost, 0);
  let cursor = 0;
  const values = groups.map(([label, keys, color]) => {
    const pct = keys.reduce((sum, key) => sum + positions.get(key).cost, 0) / total * 100;
    const start = cursor;
    cursor += pct;
    return { label, color, pct, start, end: cursor };
  });
  const gradient = values.map(v => `${v.color} ${v.start.toFixed(2)}% ${v.end.toFixed(2)}%`).join(',');
  const aria = values.map(v => `${v.label} ${v.pct.toFixed(2)}%`).join('，');
  const rows = values.map(v => `<div><i class="dot" style="background:${v.color}"></i><span>${v.label}</span><b>${v.pct.toFixed(2)}%</b></div>`).join('');
  return `<section class="section" id="allocation"><div class="section-head"><h2>資產配置</h2><small>依成本占比</small></div><div class="card allocation"><div class="ring-row"><div class="ring" style="background:conic-gradient(${gradient})" aria-label="${aria}"></div><div class="allocation-list">${rows}</div></div></div></section>`;
}

function renderBalanceSection(positions) {
  const a = positions.get('00713').cost;
  const b = positions.get('00631L').cost;
  const total = a + b;
  const aPct = a / total * 100;
  const bPct = 100 - aPct;
  const targetA = total * 0.6;
  const targetB = total * 0.4;
  const transfer = Math.abs(a - targetA);
  const sellCode = a > targetA ? '00713' : '00631L';
  const buyCode = a > targetA ? '00631L' : '00713';
  const sellBefore = sellCode === '00713' ? a : b;
  const sellAfter = sellCode === '00713' ? targetA : targetB;
  const buyBefore = buyCode === '00713' ? a : b;
  const buyAfter = buyCode === '00713' ? targetA : targetB;
  return `<section class="section" id="balance"><div class="section-head"><h2>00713 × 00631L</h2><small>兩檔子組合</small></div><div class="card balance"><div class="compare"><div class="compare-row"><span>目前</span><div class="track"><div class="part a" style="width:${aPct.toFixed(1)}%">00713<br><b>${aPct.toFixed(1)}%</b></div><div class="part b" style="width:${bPct.toFixed(1)}%">00631L<br><b>${bPct.toFixed(1)}%</b></div></div></div><div class="compare-row"><span>目標</span><div class="track"><div class="part a" style="width:60%">00713<br><b>60%</b></div><div class="part b" style="width:40%">00631L<br><b>40%</b></div></div></div></div><div class="rebalance-plan"><div class="rebalance-head"><strong>調整指引</strong><small>以成本金額試算</small></div><div class="trade-grid"><div class="trade sell"><span class="trade-action">賣出</span><strong>${sellCode}</strong><b class="money">NT$${fmtInt(transfer)}</b><small><span class="money">NT$${fmtInt(sellBefore)}</span> → <span class="money">NT$${fmtInt(sellAfter)}</span></small></div><div class="trade buy"><span class="trade-action">買入</span><strong>${buyCode}</strong><b class="money">NT$${fmtInt(transfer)}</b><small><span class="money">NT$${fmtInt(buyBefore)}</span> → <span class="money">NT$${fmtInt(buyAfter)}</span></small></div></div><div class="target-summary">調整後：00713 <b>60%</b>・00631L <b>40%</b></div><div class="balance-note">未計交易費用與價格變動。00631L 為每日槓桿 ETF，比例會隨行情快速偏移，宜定期重新檢查。</div></div></div></section>`;
}

const html = await fs.readFile(HTML_PATH, 'utf8');
const holdings = extractExistingHoldings(html);
const portfolio = await fetchPortfolioSnapshot();
const taiwanPositions = Object.fromEntries(EXPECTED_TAIWAN.map(key => [key, portfolio.positions.get(key).units]));
const fundPositions = {
  '富達永續': { ...portfolio.positions.get('富達永續'), source: 'fidelity' },
  '施羅德環球': { ...portfolio.positions.get('施羅德環球'), source: 'schroder' },
};
const [twQuotes, fundQuotes, fx] = await Promise.all([
  fetchTaiwanQuotes(taiwanPositions),
  fetchFundQuotes(),
  fetchUsdTwd(),
]);

for (const holding of holdings) {
  const synced = portfolio.positions.get(holding.n);
  if (!synced) throw new Error(`Dashboard holding is missing from Google Sheet sync: ${holding.n}`);
  holding.c = synced.cost;
  holding.w = `${synced.weight.toFixed(2)}%`;
  holding.u = synced.units;
  holding.unit = EXPECTED_FUNDS.includes(holding.n) ? '單位' : '股';
  holding.avg = `NT$${synced.averageCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${EXPECTED_FUNDS.includes(holding.n) ? '/單位' : ''}`;
  if (holding.n in taiwanPositions) {
    const quote = twQuotes.get(holding.n);
    holding.q = `NT$${quote.price.toFixed(2)}`;
    holding.v = Math.round(quote.price * taiwanPositions[holding.n]);
    holding.d = ymdToShort(quote.isoDate);
    holding.quoteDate = quote.isoDate;
    holding.day = Number(quote.day.toFixed(4));
  } else if (holding.n in fundPositions) {
    const position = fundPositions[holding.n];
    const quote = fundQuotes[position.source];
    holding.q = `US$${quote.nav.toFixed(4)}`;
    holding.v = Math.round(quote.nav * position.units * fx.value);
    holding.d = ymdToShort(quote.isoDate);
    holding.quoteDate = quote.isoDate;
    holding.day = Number(quote.day.toFixed(4));
  }
}

const totalValue = holdings.reduce((sum, h) => sum + Number(h.v), 0);
const totalCost = holdings.reduce((sum, h) => sum + Number(h.c), 0);
const totalPnl = totalValue - totalCost;
const totalRate = totalPnl / totalCost * 100;
const pnlSign = totalPnl >= 0 ? '+' : '−';
const pnlClass = totalPnl >= 0 ? 'gain' : 'loss';
const twDates = [...new Set([...twQuotes.values()].map(q => q.isoDate))].sort();
const twDate = twDates.length === 1 ? twDates[0] : `${twDates[0]}～${twDates.at(-1)}`;
const fundDates = Object.values(fundQuotes).map(v => v.isoDate).sort();
const fundDateText = fundDates[0] === fundDates.at(-1) ? fundDates[0] : `${fundDates[0]}～${fundDates.at(-1)}`;
const updatedAt = formatTaipei();
const metadata = { syncedAt: updatedAt, sources: [
  ...twDates.map(date => ({name:'台灣 ETF 收盤',date})),
  {name:'富達永續淨值',date:fundQuotes.fidelity.isoDate},
  {name:'施羅德環球淨值',date:fundQuotes.schroder.isoDate},
  {name:'美元匯率',date:String(fx.timestamp || ''),kind:'fx'},
] };

let output = html;
output = replaceOrThrow(output, /const holdings=\[[\s\S]*?\];/, `const holdings=${JSON.stringify(holdings)};`, 'holdings array');
output = replaceOrThrow(output, /<section class="section" id="balance">[\s\S]*?<\/section>/, renderBalanceSection(portfolio.positions), 'balance section');
output = replaceOrThrow(output, /<div class="asof">[\s\S]*?<\/div>/, `<div class="asof">更新時間：${updatedAt}</div>`, 'update timestamp');
output = replaceOrThrow(output, /<div class="hero-total">[\s\S]*?<\/div>\s*<div class="summary">/, `<div class="hero-total"><div class="label">估算目前市值</div><div class="amount money">NT$${fmtInt(totalValue)}</div><div class="sub">台灣 ETF ${twDate} 收盤；海外基金 ${fundDateText} 淨值</div></div>\n    <div class="summary">`, 'hero total');
output = replaceOrThrow(
  output,
  /<div class="summary">[\s\S]*?<\/div><\/div>\s*<\/header>/,
  `<div class="summary"><div><span>未實現損益</span><strong class="money ${pnlClass}">${pnlSign}NT$${fmtInt(Math.abs(totalPnl))}</strong></div><div><span>損益率</span><strong class="${pnlClass}">${pnlSign}${Math.abs(totalRate).toFixed(2)}%</strong></div><div><span>投資成本</span><strong class="money">NT$${fmtInt(totalCost)}</strong></div></div>\n  </header>`,
  'summary cards',
);
output = replaceOrThrow(
  output,
  /<div class="card notice">[\s\S]*?<\/div>\s*\n\s*<\/main>/,
  `<div class="card notice">持有數量、成本與成本占比自 Google Sheets「投資比重」唯讀同步。未實現損益＝估算市值−投資成本，未計已領配息、稅費與交易成本。台灣 ETF 採證交所與櫃買中心 ${twDate} 收盤資料；海外基金自動更新採 MoneyDJ 同步之富達與施羅德淨值（${fundDateText}），以臺銀資料鏡像的美元即期買入 ${fx.value.toFixed(3)} 換算。資料抓取異常時流程會停止，不覆蓋上一版。</div>\n\n</main>`,
  'methodology notice',
);

output = installDataStatus(output, metadata);
const freshness = getDataStatus(metadata);
if (freshness.tone === 'waiting') console.warn(`::warning::${freshness.title}；台灣 ETF ${twDate}；基金 ${fundDateText}`);
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
  `## 資料同步結果\n\n- 同步成功：${updatedAt}（台北）\n- 台灣 ETF：${twDate}\n- 富達：${fundQuotes.fidelity.isoDate}\n- 施羅德：${fundQuotes.schroder.isoDate}\n- 狀態：${freshness.title}\n\n${freshness.message}\n`);
if (/NaN|undefined|null/.test(output)) throw new Error('Generated HTML contains an invalid numeric value');
await fs.writeFile(HTML_PATH, output);
console.log(JSON.stringify({ updatedAt, twDate, fundDateText, usdTwd: fx.value, totalValue: Math.round(totalValue), totalPnl: Math.round(totalPnl) }, null, 2));

