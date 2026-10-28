import fs from 'node:fs/promises';
import { installDataStatus, getDataStatus } from './data-status.mjs';
import { installPortfolioReview, renderMarketBalance } from './portfolio-review.mjs';
import { validateQuoteDate } from './source-validation.mjs';
import { fetchTaiwanCloses } from './taiwan-quotes.mjs';

const HTML_PATH = new URL('../index.html', import.meta.url);
const TZ = 'Asia/Taipei';

const EXPECTED_TAIWAN = ['0050', '00713', '00937B', '00631L', '00919', '00878', '00751B', '00933B', '00406A'];
const EXPECTED_FUNDS = ['富達永續', '施羅德環球'];

const URLS = {
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
    if (!key) {
      if (Number(row.units) > 0) throw new Error('Google Sheet contains an unsupported holding');
      continue;
    }
    if (positions.has(key)) throw new Error(`Duplicate Google Sheet holding: ${key}`);
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
  const unexpected = [...positions.keys()].filter(key => !expected.includes(key));
  if (unexpected.length) throw new Error(`Unsupported Google Sheet holdings: ${unexpected.join(', ')}`);
  const missing = expected.filter(key => !positions.has(key));
  if (missing.length) throw new Error(`Google Sheet sync missing holdings: ${missing.join(', ')}`);
  const totalCost = expected.reduce((sum, key) => sum + positions.get(key).cost, 0);
  if (!(totalCost > 1_000_000 && totalCost < 100_000_000)) throw new Error('Google Sheet total cost is outside the safety range');
  return { positions, totalCost, sourceUpdatedAt: data.updatedAt || null };
}

function extractExistingHoldings(html) {
  const match = html.match(/const holdings=(\[[\s\S]*?\]);/);
  if (!match) throw new Error('Could not find holdings array in index.html');
  return JSON.parse(match[1]);
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
    isoDate: validateQuoteDate(match[1].replaceAll('/', '-')),
    change,
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
  return html.replace(pattern, () => replacement);
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
  fetchTaiwanCloses(taiwanPositions, fetchWithTimeout),
  fetchFundQuotes(),
  fetchUsdTwd(),
]);

for (const holding of holdings) {
  const synced = portfolio.positions.get(holding.n);
  if (!synced) throw new Error(`Dashboard holding is missing from Google Sheet sync: ${holding.n}`);
  holding.c = synced.cost;
  holding.w = `${(synced.cost / portfolio.totalCost * 100).toFixed(2)}%`;
  holding.u = synced.units;
  holding.unit = EXPECTED_FUNDS.includes(holding.n) ? '單位' : '股';
  holding.avg = `NT$${(synced.cost / synced.units).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${EXPECTED_FUNDS.includes(holding.n) ? '/單位' : ''}`;
  if (holding.n in taiwanPositions) {
    const quote = twQuotes.get(holding.n);
    validateQuoteDate(quote.isoDate, holding.quoteDate);
    holding.quoteSource = quote.source;
    holding.quoteSourceUrl = quote.sourceUrl;
    holding.dayPnl = quote.change * holding.u;
    holding.q = `NT$${quote.price.toFixed(2)}`;
    holding.v = Math.round(quote.price * taiwanPositions[holding.n]);
    holding.d = ymdToShort(quote.isoDate);
    holding.quoteDate = quote.isoDate;
    holding.day = Number(quote.day.toFixed(4));
  } else if (holding.n in fundPositions) {
    const position = fundPositions[holding.n];
    const quote = fundQuotes[position.source];
    validateQuoteDate(quote.isoDate, holding.quoteDate);
    holding.dayPnl = quote.change * holding.u * fx.value;
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
output = replaceOrThrow(output, /<section class="section" id="balance">[\s\S]*?<\/section>/, renderMarketBalance(holdings), 'balance section');
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
  `<div class="card notice">持有數量、成本與成本占比自 Google Sheets「投資比重」唯讀同步。未實現損益＝估算市值−投資成本，未計已領配息、稅費與交易成本。台灣 ETF 採證交所與櫃買中心 ${twDate} 收盤資料，優先使用證交所盤後每日報表，OpenAPI 作備援，各檔來源見明細；海外基金自動更新採 MoneyDJ 同步之富達與施羅德淨值（${fundDateText}），以臺銀資料鏡像的美元即期買入 ${fx.value.toFixed(3)} 換算。資料抓取異常時流程會停止，不覆蓋上一版。</div>\n\n</main>`,
  'methodology notice',
);

output = installDataStatus(output, metadata);
output = await installPortfolioReview(output, {draft:false});
const freshness = getDataStatus(metadata);
if (freshness.tone === 'waiting') console.warn(`::warning::${freshness.title}；台灣 ETF ${twDate}；基金 ${fundDateText}`);
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
  `## 資料同步結果\n\n- 同步成功：${updatedAt}（台北）\n- 台灣 ETF：${twDate}\n- 富達：${fundQuotes.fidelity.isoDate}\n- 施羅德：${fundQuotes.schroder.isoDate}\n- 狀態：${freshness.title}\n\n${freshness.message}\n`);
for (const h of holdings) {
  if (![h.c, h.v, h.u, h.day, h.dayPnl].every(Number.isFinite)) throw new Error(`Invalid output values for ${h.n}`);
}
await fs.writeFile(HTML_PATH, output);
console.log(JSON.stringify({ updatedAt, twDate, fundDateText, usdTwd: fx.value, totalValue: Math.round(totalValue), totalPnl: Math.round(totalPnl) }, null, 2));
