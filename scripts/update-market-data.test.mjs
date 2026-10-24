import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

test('updater retries a temporary failure and preserves separate source dates', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'portfolio-updater-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'scripts'));
  for (const file of ['index.html','scripts/update-market-data.mjs','scripts/data-status.mjs']) {
    await fs.copyFile(new URL('../'+file,import.meta.url),path.join(dir,file));
  }
  const original=await fs.readFile(path.join(dir,'index.html'),'utf8');
  const holdings=JSON.parse(original.match(/const holdings=(\[[\s\S]*?\]);/)[1]);
  const program=`
    const holdings=${JSON.stringify(holdings)};
    let first=true;
    globalThis.fetch=async url=>{
      const address=String(url);
      if(address.includes('script.google.com')) {
        if(first){first=false;throw new Error('temporary failure with token=DO_NOT_LOG');}
        return new Response(JSON.stringify({ok:true,holdings:holdings.map(h=>({name:h.n,units:h.u,cost:h.c,weight:Number(h.w.replace('%','')),averageCost:h.c/h.u}))}));
      }
      if(address.includes('openapi.twse.com.tw'))return new Response(JSON.stringify(holdings.filter(h=>h.unit==='股').map(h=>({Code:h.n,ClosingPrice:20,Change:1,Date:'1151023'}))));
      if(address.includes('tpex.org.tw'))return new Response('[]');
      if(address.includes('moneydj.com'))return new Response(Buffer.concat([Buffer.from('b262adc8a4e9b4c1','hex'),Buffer.from('<tr><td>2026/10/22</td><td>10.25</td><td>0.05</td></tr>')]));
      if(address.includes('raw.githubusercontent.com'))return new Response(JSON.stringify({sourceQuotes:{USD:{spot:{buy:32.43}}},sourcePublishedAt:'2026-10-23 16:00'}));
      throw new Error('Unexpected source');
    };
    await import(${JSON.stringify(pathToFileURL(path.join(dir,'scripts/update-market-data.mjs')).href)});
  `;
  const {stdout,stderr}=await promisify(execFile)(process.execPath,['--input-type=module','-e',program],{
    env:{...process.env,GOOGLE_SHEET_SYNC_URL:'https://script.google.com/test',GOOGLE_SHEET_SYNC_TOKEN:'DO_NOT_LOG',GITHUB_STEP_SUMMARY:''},
  });
  const output=await fs.readFile(path.join(dir,'index.html'),'utf8');
  const metadata=JSON.parse(output.match(/const portfolioDataStatus=([^;]+);/)[1]);
  assert.equal(metadata.sources.find(s=>s.name==='台灣 ETF 收盤').date,'2026-10-23');
  assert.equal(metadata.sources.find(s=>s.name==='富達永續淨值').date,'2026-10-22');
  assert.ok(output.includes('最近同步成功：'));
  assert.equal((output.match(/id="dataStatus"/g)||[]).length,1);
  assert.equal(output.match(/const cash=([\s\S]*?);/)[1],original.match(/const cash=([\s\S]*?);/)[1]);
  assert.match(stderr,/retry 1\/3/);
  assert.ok(!stdout.includes('DO_NOT_LOG')&&!stderr.includes('DO_NOT_LOG'));
  for(const match of output.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))new Function(match[1]);
});
