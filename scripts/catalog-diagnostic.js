import {appendFile} from 'node:fs/promises';
import {catalogUrl,fetchCatalog} from '../cloudflare/vinted.js';
// One transparent request only. No credentials, proxies, retries or raw response logs.
const url=catalogUrl({country:'pl',query:'',brand:'COS',minPrice:0,maxPrice:60});
let status=null,result;
try{
 const items=await fetchCatalog(url,async(u,options)=>{const r=await fetch(u,options);status=r.status;return r;});
 result={at:new Date().toISOString(),status,parsed:items.length,matchingCOSsizeM:items.filter(i=>i.brand==='COS'&&(i.size==='M'||i.size.split('/').map(s=>s.trim()).includes('M'))).length};
}catch(e){result={at:new Date().toISOString(),status,error:e.message,diagnostic:e.diagnostic||null};}
console.log(JSON.stringify(result,null,2));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'## One-request catalog diagnostic\n\n```json\n'+JSON.stringify(result,null,2)+'\n```\n\nConnectivity test only. No production import, session, proxy, retry or monitoring schedule.\n');
