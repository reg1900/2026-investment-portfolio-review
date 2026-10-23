import fs from 'node:fs/promises';

const path = process.env.DASHBOARD_PATH || new URL('../index.html', import.meta.url);
const html = await fs.readFile(path, 'utf8');

for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  if (match[1].trim()) new Function(match[1]);
}

const checks = [
  ['11 holdings', (html.match(/\{\"n\":/g) || []).length === 11],
  ['update timestamp', /更新時間：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(html)],
  ['Taiwan quote sources', html.includes('證交所與櫃買中心')],
  ['fund quote source', html.includes('MoneyDJ')],
  ['privacy control', html.includes('id="privacy"')],
  ['red-up styling', html.includes('.pl-up{color:#c43e36}')],
  ['green-down styling', html.includes('.pl-down{color:#16805b}')],
  ['two-column cards', html.includes('grid-template-columns:repeat(2,minmax(0,1fr))')],
  ['holding units', html.includes('unit-pill') && html.includes('持有單位')],
  ['interactive allocation', html.includes('allocationRing') && html.includes('allocationDetail')],
  ['five-item navigation', html.includes('grid-template-columns:repeat(5,1fr)')],
  ['rebalance target', html.includes('00713 <b>60%</b>・00631L <b>40%</b>')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`Validation failed: ${name}`);
}
if (/NaN|undefined|null/.test(html)) throw new Error('Validation failed: invalid numeric value');

console.log('Dashboard validation passed.');
