import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCatalog,fetchCatalog,catalogUrl} from '../cloudflare/vinted.js';
const html=readFileSync(new URL('./fixtures/vinted-pl-card.html',import.meta.url),'utf8');
test('Public Polish HTML fixture: actual item price, metadata, photo, canonical link',()=>{
 const [i]=parseCatalog(html);assert.equal(i.id,'vinted:pl:10508917416');assert.equal(i.price,50.64);assert.equal(i.currency,'PLN');assert.equal(i.title,'Cos bukser 7/8 længde');assert.equal(i.brand,'COS');assert.equal(i.size,'S');assert.equal(i.condition,'Bardzo dobry');assert.ok(i.photoUrl.startsWith('https://images1.vinted.net/'));assert.equal(new URL(i.url).search,'');assert.equal(i.demo,false);
 const encoded=html.replaceAll('Cos bukser 7/8 længde','A &amp; B &#x27; test');assert.equal(parseCatalog(encoded)[0].title,"A & B ' test");
 assert.throws(()=>parseCatalog(html.replaceAll('50,64','oops')),/цену/);
 assert.throws(()=>parseCatalog(html.replaceAll('10508917416-cos-bukser','99999999-cos-bukser')),/ID/);
 assert.deepEqual(parseCatalog('<div data-testid="search-empty-state">Nie znaleźliśmy pasujących przedmiotów.</div>'),[]);
 assert.throws(()=>parseCatalog('<html>Verify you are human</html>'),/остановлен/);
});
test('Public fetch is bounded, never replays cookies, follows no redirects and reports blocks',async()=>{
 const url=catalogUrl({country:'pl',query:'marynarka',brand:'COS',minPrice:10,maxPrice:70});
 assert.equal(new URL(url).searchParams.get('order'),'newest_first');
 let calls=0;
 const items=await fetchCatalog(url,async(u,opts)=>{calls++;assert.equal(opts.redirect,'manual');assert.equal(opts.headers.Cookie,undefined);assert.equal(opts.headers.Authorization,undefined);return new Response(html,{headers:{'content-type':'text/html','set-cookie':'ignored=1'}});});assert.equal(items.length,1);assert.equal(calls,1);
 for(const status of [401,403,429])await assert.rejects(()=>fetchCatalog(url,async()=>new Response('challenge',{status})),e=>e.blocked===true);
 await assert.rejects(()=>fetchCatalog(url,async()=>new Response('',{status:302,headers:{Location:'https://evil.example/'}})),/302/);
 await assert.rejects(()=>fetchCatalog(url,async()=>new Response('<html>captcha</html>',{headers:{'content-type':'text/html'}})),e=>e.blocked===true);
 await assert.rejects(()=>fetchCatalog('https://evil.example/catalog',async()=>{throw Error('must not run');}),/адрес/);
 await assert.rejects(()=>fetchCatalog(url,async()=>new Response(html,{headers:{'content-type':'text/html','content-length':'99999999'}})),/размер/);
 assert.throws(()=>catalogUrl({country:'lt'}),/Польшу/);
});
