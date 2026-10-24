import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCatalog} from '../server/native-filters.js';
import {catalogUrl,fetchCatalogWindow} from '../cloudflare/vinted.js';
import {matches,validateSearch} from '../server/domain.js';
test('Native URL preserves exact IDs, strips tracking/page and rejects unsupported filters or remote targets',()=>{
 const url=nativeCatalog('https://www.vinted.pl/catalog/16-obuwie?brand_ids[]=2029&size_ids[]=123&color_ids[]=1&status_ids[]=2&page=9&time=123&price_to=60');
 const p=new URL(url).searchParams;assert.equal(p.get('catalog[]'),'16');assert.equal(p.get('size_ids[]'),'123');assert.equal(p.has('page'),false);assert.equal(p.get('order'),'newest_first');
 for(const bad of ['https://evil.example/catalog','https://www.vinted.pl/api/catalog','https://www.vinted.pl/catalog?access_token=secret','https://www.vinted.pl/catalog?brand_ids[]=bad','https://www.vinted.pl/catalog?currency=EUR'])assert.throws(()=>nativeCatalog(bad));
 assert.equal(catalogUrl({country:'pl',catalogUrl:url}),url);
 validateSearch({name:'Shoes',query:'',brand:'',size:'',catalogUrl:url,maxPrice:60,intervalMinutes:5,enabled:true});
 assert.equal(matches({catalogUrl:url,brand:'outdated',size:'S',maxPrice:1},{country:'pl',currency:'PLN',price:50}),true);
});
test('Pagination deduplicates, bounds requests, and never accepts a partially failed scan',async()=>{
 const result=await fetchCatalogWindow('https://www.vinted.pl/catalog',{fetchPage:async u=>new URL(u).searchParams.has('page')?[{id:'b'},{id:'c'}]:[{id:'a'},{id:'b'}]});
 assert.deepEqual(result.items.map(i=>i.id),['a','b','c']);assert.equal(result.pages,2);assert.equal(result.reason,'limit');
 await assert.rejects(fetchCatalogWindow('https://www.vinted.pl/catalog',{fetchPage:async u=>{if(new URL(u).searchParams.has('page'))throw Error('429');return [{id:'a'}];}}));
});

test('Deep scan refreshes newest page and resumes old inventory without skipping failed pages',async()=>{
 const {fetchCatalogProgress}=await import('../cloudflare/vinted.js');const seen=[];
 const first=await fetchCatalogProgress('https://www.vinted.pl/catalog',{fetchPage:async u=>{const p=Number(new URL(u).searchParams.get('page')||1);seen.push(p);return [{id:'page-'+p}];}});
 assert.deepEqual(seen,[1,2,3,4,5]);assert.equal(first.nextPage,6);assert.equal(first.complete,false);
 const second=await fetchCatalogProgress('https://www.vinted.pl/catalog',{startPage:first.nextPage,fetchPage:async u=>{const p=Number(new URL(u).searchParams.get('page')||1);return p===7?[]:[{id:'page-'+p}];}});
 assert.equal(second.complete,true);assert.equal(second.reason,'empty');assert.deepEqual(second.items.map(i=>i.id),['page-1','page-6']);
 await assert.rejects(fetchCatalogProgress('https://www.vinted.pl/catalog',{startPage:6,fetchPage:async u=>{if(new URL(u).searchParams.get('page')==='6')throw Error('blocked');return [{id:'new'}];}}));
 const finished=[];await fetchCatalogProgress('https://www.vinted.pl/catalog',{startPage:null,fetchPage:async u=>{finished.push(Number(new URL(u).searchParams.get('page')||1));return [{id:u}];}});assert.deepEqual(finished,[1,2]);
});

test('Catalog page provenance preserves the first occurrence across repeated promoted cards',async()=>{
 const {fetchCatalogProgress}=await import('../cloudflare/vinted.js');const result=await fetchCatalogProgress('https://www.vinted.pl/catalog',{fetchPage:async u=>{const page=Number(new URL(u).searchParams.get('page')||1);return [{id:'promoted'},{id:'page-'+page}];}});
 assert.equal(result.items.find(i=>i.id==='promoted').catalogPage,1);assert.equal(result.items.find(i=>i.id==='page-5').catalogPage,5);
});

test('Native sorting preserves Vinted relevance and newest-first modes without inventing popularity ranking',()=>{
 const relevance=nativeCatalog('https://www.vinted.pl/catalog?search_text=kurtka&order=relevance');assert.equal(new URL(relevance).searchParams.get('order'),'relevance');
 assert.equal(catalogUrl({country:'pl',catalogUrl:relevance}),relevance);
 assert.equal(new URL(nativeCatalog('https://www.vinted.pl/catalog')).searchParams.get('order'),'newest_first');
 assert.throws(()=>nativeCatalog('https://www.vinted.pl/catalog?order=popular_first'));
});
