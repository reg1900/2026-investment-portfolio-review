import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSchroderNav} from './schroder-nav.mjs';

function page({isin='LU1884790491',summary='06.11.2026'}={}) {
  return '<script id="vike_pageContext" type="application/json">'+JSON.stringify({data:{body:{
    shareClass:{isin,externalId:'SCHDR_F000011DCB'},
    fxPricePanel:{series:[{data:[[Date.UTC(2026,10,5),122.9269,100],[Date.UTC(2026,10,6),120.1661,100]]}]},
    fxProfileHeroPanel:{metricList:{items:[{id:'priceEndValue',date:summary,value:'<span>&#32654;&#20803;</span> 120.1661'}]}},
  }}})+'</script>';
}
test('official Schroder NAV matches the exact held share class and date',()=>{
  const quote=parseSchroderNav(page());
  assert.equal(quote.nav,120.1661);
  assert.equal(quote.isoDate,'2026-11-06');
  assert.ok(Math.abs(quote.day+2.2458875966)<0.000001);
});
test('wrong share class is rejected',()=>{
  assert.throws(()=>parseSchroderNav(page({isin:'LU0000000000'})),/share class mismatch/);
});
test('inconsistent summary date is rejected',()=>{
  assert.throws(()=>parseSchroderNav(page({summary:'05.11.2026'})),/summary mismatch/);
});
