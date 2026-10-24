import {equal} from './security.js';
import {rows,one,run,limit,lease,release,getSetting,setSetting} from './data.js';
import {catalogUrl} from './vinted.js';
import {normalizeCatalogRows} from './catalog-records.js';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const active=env=>rows(env,`SELECT s.* FROM searches s JOIN users u ON s.userId=u.id WHERE s.enabled=1 AND u.enabled=1 AND s.country='pl' ORDER BY s.createdAt LIMIT 50`);
export async function collectorRoute(request,env,readBody){
 const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
 if(!env.CATALOG_COLLECTOR_TOKEN||!equal(token,env.CATALOG_COLLECTOR_TOKEN))return json({error:'Нет доступа'},401);
 if(env.CATALOG_FETCH_MODE!=='github')return json({error:'Внешний сборщик не включён'},409);
 if(request.method!=='POST'||request.headers.get('X-Radar-Client')!=='1')return json({error:'Ожидается POST'},405);
 const path=new URL(request.url).pathname;
 if(path==='/api/collector/jobs'){
  if(!await limit(env,'collector-jobs',12,3600000))return json({error:'Слишком частые запуски'},429);
  const blockedUntil=Number(await getSetting(env,'collectorBlockedUntil')||0);
  if(blockedUntil>Date.now())return json({jobs:[],blockedUntil});
  const lock=await lease(env,'collector:github',180000);if(!lock)return json({jobs:[],busy:true});
  try{
   const searches=await active(env),cache=await rows(env,'SELECT url,fetchedAt FROM catalog_cache LIMIT 200');
   const times=new Map(cache.map(c=>[c.url,c.fetchedAt]));
   const urls=[...new Set(searches.map(catalogUrl))].filter(u=>(times.get(u)||0)<Date.now()-14*60000).sort((a,b)=>(times.get(a)||0)-(times.get(b)||0));
   return json({lease:lock,jobs:urls.slice(0,3).map(url=>({url}))});
  }catch(e){await release(env,'collector:github',lock);throw e;}
 }
 const b=await readBody(request);
 const held=await one(env,"SELECT token FROM leases WHERE key='collector:github' AND expires>?",Date.now());
 if(!held||!equal(b.lease,held.token))return json({error:'Запуск истёк'},409);
 if(path==='/api/collector/finish'){await release(env,'collector:github',b.lease);return json({ok:true});}
 const searches=await active(env),matching=searches.filter(s=>catalogUrl(s)===b.url);
 if(!matching.length)return json({error:'Адрес не соответствует активным поискам'},400);
 if(path==='/api/collector/import'){
  if(!Number.isFinite(b.fetchedAt)||b.fetchedAt<Date.now()-5*60000||b.fetchedAt>Date.now()+30000)return json({error:'Данные устарели'},400);
  if(!Array.isArray(b.items)||b.items.length>100)return json({error:'До 100 товаров'},400);
  const items=normalizeCatalogRows(b.items.map(i=>({itemId:typeof i.id==='string'?i.id.match(/^vinted:pl:(\d+)$/)?.[1]:null,url:i.url,title:i.title,brand:i.brand,size:i.size,condition:i.condition,price:i.price,currency:i.currency,country:i.country,imageUrl:i.photoUrl})));
  // Only records for the configured Polish market, no arbitrary feed URLs or personal data.
  if(items.some(i=>i.country!=='pl'))return json({error:'Только польский каталог'},400);
  const now=Date.now();
  await env.DB.batch([
   env.DB.prepare('INSERT INTO catalog_cache(url,items,fetchedAt) VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET items=excluded.items,fetchedAt=excluded.fetchedAt WHERE excluded.fetchedAt>=catalog_cache.fetchedAt').bind(b.url,JSON.stringify(items),b.fetchedAt),
   env.DB.prepare("INSERT INTO settings(key,value) VALUES('collectorLastSuccess',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(now)),
   env.DB.prepare("INSERT INTO settings(key,value) VALUES('collectorLastError','') ON CONFLICT(key) DO UPDATE SET value=excluded.value"),
   env.DB.prepare('UPDATE searches SET nextCheck=0 WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(matching.map(s=>s.id)))
  ]);
  return json({ok:true,count:items.length});
 }
 if(path==='/api/collector/failure'){
  const status=Number(b.status),blocked=b.blocked===true;
  const delay=Number.isSafeInteger(b.retryAfter)&&b.retryAfter>0?b.retryAfter:0;
  await setSetting(env,'collectorLastError',Number.isInteger(status)&&status>0?`Vinted: HTTP ${status}`:'Не удалось загрузить публичный каталог');
  if(blocked)await setSetting(env,'collectorBlockedUntil',Date.now()+Math.max(3600000,delay));
  return json({ok:true});
 }
 return json({error:'Не найдено'},404);
}
