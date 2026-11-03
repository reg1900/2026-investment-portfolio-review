import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
async function validate(source,url){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'quote-validator-'));try{
const h=JSON.parse(html.match(/const holdings=(\[[\s\S]*?\]);/)[1]);
for(const row of h.filter(x=>x.unit==='股')){row.quoteSource=source;row.quoteSourceUrl=url;}
const file=path.join(dir,'index.html');await fs.writeFile(file,html.replace(/const holdings=\[[\s\S]*?\];/,'const holdings='+JSON.stringify(h)+';'));
return execFileSync(process.execPath,[new URL('./validate-dashboard.mjs',import.meta.url).pathname],{env:{...process.env,DASHBOARD_PATH:file},stdio:'pipe'}).toString();
}finally{await fs.rm(dir,{recursive:true,force:true});}}
test('validated official backup is accepted even if no holding uses daily report',async()=>assert.match(await validate('證交所 OpenAPI 備援','https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'),/passed/));
test('official report source is accepted',async()=>assert.match(await validate('證交所盤後每日報表','https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX'),/passed/));
test('source label cannot conceal an unrelated host',async()=>assert.rejects(validate('證交所 OpenAPI 備援','https://example.com/quotes')));
