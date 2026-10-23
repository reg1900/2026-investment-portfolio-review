import fs from 'node:fs/promises';

const HTML_PATH = new URL('../index.html', import.meta.url);
const TZ = 'Asia/Taipei';

const TAIWAN_POSITIONS = {
  '0050': 58000,
  '00713': 16000,
  '00937B': 42000,
  '00631L': 13000,
  '00919': 12000,
  '00878': 9000,
  '00751B': 10000,
  '00933B': 19000,
  '00406A': 21000,
};

const FUND_POSITIONS = {
  '富達永續': { units: 3206.8, source: 'fidelity' },
  '施羅德環球': { units: 241.26, source: 'schroder' },
};

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'portfolio-dashboard-updater/1.0' },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
    if (type === 'json') return response.json();
    if (type === 'big5') {
      const bytes = await response.arrayBuffer();
      return new TextDecoder('big5').decode(bytes);
    }
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractExistingHoldings(html) {
  const match = html.match(/const holdings=(\[[\s\S]*?\]);/);
  if (!match) throw new Error('Could not find holdings array in index.html');
  // The repository owns this literal. Evaluating only the isolated array keeps
  // the updater compatible with both the original JS literal and JSON output.
  return Function(`"use strict"; return (${match[1]});`)();
}

async function fetchTaiwanQuotes() {
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
    if (!(code in TAIWAN_POSITIONS)) continue;
    const price = Number(row.ClosingPrice || row.Close);
    const change = Number(row.Change);
    if (!(price > 0) || !Number.isFinite(change)) throw new Error(`Invalid Taiwan quote for ${code}`);
    const previous = price - change;
    const day = previous > 0 ? change / previous * 100 : 0;
    const isoDate = rocDateToIso(row.Date);
    result.set(code, { price, day, isoDate });
  }
  const missing = Object.keys(TAIWAN_POSITIONS).filter(code => !result.has(code));
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

const html = await fs.readFile(HTML_PATH, 'utf8');
const holdings = extractExistingHoldings(html);
const [twQuotes, fundQuotes, fx] = await Promise.all([
  fetchTaiwanQuotes(),
  fetchFundQuotes(),
  fetchUsdTwd(),
]);

for (const holding of holdings) {
  if (holding.n in TAIWAN_POSITIONS) {
    const quote = twQuotes.get(holding.n);
    holding.q = `NT$${quote.price.toFixed(2)}`;
    holding.v = Math.round(quote.price * TAIWAN_POSITIONS[holding.n]);
    holding.d = ymdToShort(quote.isoDate);
    holding.day = Number(quote.day.toFixed(4));
  } else if (holding.n in FUND_POSITIONS) {
    const position = FUND_POSITIONS[holding.n];
    const quote = fundQuotes[position.source];
    holding.q = `US$${quote.nav.toFixed(4)}`;
    holding.v = Math.round(quote.nav * position.units * fx.value);
    holding.d = ymdToShort(quote.isoDate);
    holding.day = Number(quote.day.toFixed(4));
  }
}

const totalValue = holdings.reduce((sum, h) => sum + Number(h.v), 0);
const totalCost = holdings.reduce((sum, h) => sum + Number(h.c), 0);
const totalPnl = totalValue - totalCost;
const totalRate = totalPnl / totalCost * 100;
const pnlSign = totalPnl >= 0 ? '+' : '−';
const pnlClass = totalPnl >= 0 ? 'gain' : 'loss';
const twDate = [...twQuotes.values()][0].isoDate;
const fundDates = Object.values(fundQuotes).map(v => v.isoDate).sort();
const fundDateText = fundDates[0] === fundDates.at(-1) ? fundDates[0] : `${fundDates[0]}～${fundDates.at(-1)}`;
const updatedAt = formatTaipei();

let output = html;
output = replaceOrThrow(output, /const holdings=\[[\s\S]*?\];/, `const holdings=${JSON.stringify(holdings)};`, 'holdings array');
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
  `<div class="card notice">未實現損益＝估算市值−投資成本，未計已領配息、稅費與交易成本。台灣 ETF 採證交所與櫃買中心 ${twDate} 收盤資料；海外基金自動更新採 MoneyDJ 同步之富達與施羅德淨值（${fundDateText}），以臺銀資料鏡像的美元即期買入 ${fx.value.toFixed(3)} 換算。資料抓取異常時流程會停止，不覆蓋上一版。</div>\n\n</main>`,
  'methodology notice',
);

if (/NaN|undefined|null/.test(output)) throw new Error('Generated HTML contains an invalid numeric value');
await fs.writeFile(HTML_PATH, output);
console.log(JSON.stringify({ updatedAt, twDate, fundDateText, usdTwd: fx.value, totalValue: Math.round(totalValue), totalPnl: Math.round(totalPnl) }, null, 2));
