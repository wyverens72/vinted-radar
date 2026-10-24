import {catalogUrl,fetchCatalog} from '../cloudflare/vinted.js';
import {setTimeout as pause} from 'node:timers/promises';
const base=process.env.RADAR_URL,token=process.env.CATALOG_COLLECTOR_TOKEN;
if(!base||new URL(base).protocol!=='https:'||!/^[a-f0-9]{64}$/.test(token||''))throw Error('Collector configuration is missing');
async function api(path,body){
 const r=await fetch(new URL('/api/collector/'+path,base),{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Radar-Client':'1'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Collector server HTTP '+r.status);
 return r.json();
}
const work=await api('jobs',{});
if(work.blockedUntil){console.log('Catalog is paused until '+new Date(work.blockedUntil).toISOString());}
else if(work.busy){console.log('Another collector is running');}
else{
 let loaded=0,imported=0;
 try{
  for(const {url} of work.jobs){
   // Only an internally supported, canonical public search URL is accepted.
   const u=new URL(url);
   if(u.origin!=='https://www.vinted.pl'||u.pathname!=='/catalog')throw Error('Unexpected catalog URL');
   try{
    const items=await fetchCatalog(url);
    await api('import',{lease:work.lease,url,items,fetchedAt:Date.now()});loaded++;imported+=items.length;
   }catch(e){
    await api('failure',{lease:work.lease,url,status:e.diagnostic?.status||0,blocked:!!e.blocked,retryAfter:e.retryAfter||0});
    console.log('Catalog request failed; no retries or network switching.');break;
   }
   if(loaded<work.jobs.length)await pause(3000);
  }
  console.log(JSON.stringify({catalogsLoaded:loaded,recordsImported:imported}));
 }finally{if(work.lease)await api('finish',{lease:work.lease});}
}
