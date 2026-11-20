import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {installPortfolioReview} from './portfolio-review.mjs';

test('rendered holding distinguishes missing, flat and negative daily returns', async () => {
  const original = await fs.readFile(new URL('../index.html', import.meta.url),'utf8');
  const html = await installPortfolioReview(original);
  const render = vm.runInNewContext('(' + html.match(/function card\(h,index\)\{[\s\S]*?\n\}/)[0] + ')', {holdingNames:{},quoteLinks:{}});
  const holding = {n:'0050',q:'NT$10',u:1,c:10,v:10,day:null};
  assert.match(render(holding,0),/單日價差損益<\/span><b class="money pl-neutral">—/);
  assert.match(render(holding,0),/單日漲跌幅<\/span><b class="pl-neutral">—/);
  assert.match(render({...holding,day:0,dayPnl:0},0),/單日漲跌幅<\/span><b class="pl-neutral">0.00%/);
  assert.match(render({...holding,day:-2,dayPnl:-50},0),/單日價差損益<\/span><b class="money pl-down">−50/);
});
