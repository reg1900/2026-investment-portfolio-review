import { quoteLinks, holdingNames } from './quote-links.mjs';

export function normalizeRealizedPnl(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.trades) || typeof snapshot.syncedAt !== 'string') {
    throw new Error('Missing realized P&L snapshot');
  }
  const syncedAt = new Date(snapshot.syncedAt);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(snapshot.syncedAt) || !Number.isFinite(syncedAt.valueOf())) {
    throw new Error('Invalid realized P&L sync time');
  }
  const trades = snapshot.trades.map(({code, date, pnl}) => {
    const day = new Date(date + 'T00:00:00Z');
    if (typeof code !== 'string' || !/^[0-9]{4,6}[A-Z]?$/.test(code) || typeof date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(day.valueOf()) ||
        day.toISOString().slice(0, 10) !== date || !Number.isFinite(pnl)) {
      throw new Error('Invalid realized P&L row');
    }
    return {code, date, pnl};
  });
  return {syncedAt, trades: trades.sort((a,b) => b.date.localeCompare(a.date))};
}

export function renderRealizedPnl(snapshot) {
  const {syncedAt, trades} = normalizeRealizedPnl(snapshot);
  const time = new Intl.DateTimeFormat('sv-SE', {
    timeZone:'Asia/Taipei', dateStyle:'short', timeStyle:'short',
  }).format(syncedAt);
  const tone = amount => amount > 0 ? 'pl-up' : amount < 0 ? 'pl-down' : '';
  const money = amount => (amount > 0 ? '+' : amount < 0 ? '−' : '') +
    'NT$' + Math.abs(amount).toLocaleString('zh-TW', {maximumFractionDigits:2});
  const total = trades.reduce((sum, trade) => sum + Math.round(trade.pnl * 100), 0) / 100;
  const entries = trades.map(({code,date,pnl}) => {
    const url = quoteLinks[code];
    const name = holdingNames[code] || code;
    const label = url ? `<a class="quote-link" href="${url}" target="_blank" rel="noopener noreferrer">${name}</a>` : name;
    return `<div class="realized-trade"><div><strong>${label}</strong><time datetime="${date}">${date}・${code}</time></div><strong class="money ${tone(pnl)}">${money(pnl)}</strong></div>`;
  }).join('');
  return `<section class="section" id="realized">
  <div class="section-head"><h2>已實現損益</h2></div>
  <div class="card realized-card">
    <div class="realized-total"><div><span>累計賣出損益</span><strong class="money ${tone(total)}">${money(total)}</strong></div><span>${trades.length} 筆</span></div>
    ${entries || '<p>目前沒有賣出紀錄。</p>'}
    <p>損益表同步時間 <time datetime="${syncedAt.toISOString()}">${time}（台北）</time><br>損益金額依試算表「實現損益」欄。</p>
  </div>
</section>`;
}
