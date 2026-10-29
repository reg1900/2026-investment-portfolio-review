import fs from 'node:fs/promises';

const path = process.env.DASHBOARD_PATH || new URL('../index.html', import.meta.url);
const html = await fs.readFile(path, 'utf8');

for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  if (match[1].trim()) new Function(match[1]);
}

const checks = [
  ['11 holdings', (html.match(/\{\"n\":/g) || []).length === 11],
  ['sync timestamp', /最近同步成功：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(html)],
  ['separate source dates', html.includes('id="dataStatus"') && html.includes('id="dataStatusScript"')],
  ['Taiwan quote sources', html.includes('證交所盤後每日報表') && html.includes('櫃買中心收盤資料')],
  ['fund quote source', html.includes('MoneyDJ')],
  ['privacy control', html.includes('id="privacy"')],
  ['red-up styling', html.includes('.pl-up{color:#c43e36}')],
  ['green-down styling', html.includes('.pl-down{color:#16805b}')],
  ['single-column holdings', html.includes('position-summary') && html.includes('positions-legend')],
  ['holding units', html.includes('unit-pill') && html.includes('持有單位')],
  ['interactive allocation', html.includes('allocationRing') && html.includes('allocationDetail')],
  ['five-item navigation', !html.includes('href="#exposure"') && html.includes('grid-template-columns:repeat(5,1fr)')],
  ['market-based rebalance', html.includes('依目前市值') && !html.includes('以成本金額試算')],
  ['rebalance target', html.includes('00713 <b>60%</b>・00631L <b>40%</b>')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`Validation failed: ${name}`);
}
const holdings=JSON.parse(html.match(/const holdings=(\[[\s\S]*?\]);/)[1]);
for(const holding of holdings) if(![holding.c,holding.v,holding.u,holding.day].every(Number.isFinite))throw new Error('Validation failed: invalid holding values');

console.log('Dashboard validation passed.');
