import {matches} from '../server/domain.js';
import {run,rows,lease,release} from './data.js';
import {notificationFor,sendNotification} from './notifications.js';
export function demoItems(now=Date.now()){
 const items=[['COS','Шерстяной жакет','M',38,'jacket','sand'],['Arket','Рубашка из хлопка','S',24,'shirt','sage'],['Ganni','Платье в клетку','M',55,'dress','rose'],['COS','Кожаная сумка','One size',65,'bag','ink'],['Arket','Вязаный кардиган','M',32,'knit','cream'],['Levi’s','Джинсы 501','S',29,'jeans','blue']];
 const batch=Math.floor(now/300000);
 const original=items.map(([brand,title,size,price,kind,color],n)=>({country:'lt',condition:'',id:`demo-${batch}-${n}`,brand,title:`${title}${batch%2?' · подборка II':''}`,size,price,currency:'EUR',url:null,kind,color,demo:true}));
 const titles=['Wełniana marynarka','Bawełniana koszula','Sukienka w kratę','Skórzana torebka','Dzianinowy kardigan','Jeansy 501'];
 const prices=[49,39,79,99,59,49];
 return [...original,...original.map((i,n)=>({...i,id:`demo-pl-${batch}-${n}`,country:'pl',currency:'PLN',title:titles[n],price:prices[n],condition:'Bardzo dobry'}))];
}
export async function telegramCall(env,method,body){
 const token=env.BOT_TOKEN?.trim();
 if(!token)throw Error('Telegram ещё не настроен');
 if(!/^\d+:[A-Za-z0-9_-]{20,100}$/.test(token))throw Error('BOT_TOKEN имеет неверный формат. Скопируйте из BotFather только строку вида 123456:ABC..., без кавычек и ссылки.');
 let response;
 try{response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});}catch{throw Error('Telegram временно недоступен');}
 const data=await response.json();
 if(!data.ok){const err=new Error(`Telegram: ${String(data.description||response.status).slice(0,160)}`);err.retryAfter=data.parameters?.retry_after;err.errorCode=data.error_code;throw err;}
 return data.result;
}
export async function deliver(env){
 if(!env.BOT_TOKEN)return;
 const token=await lease(env,'delivery');if(!token)return;
 try{
  const pending=await rows(env,`SELECT * FROM (SELECT o.*,u.id userId,u.chatId,ROW_NUMBER() OVER (PARTITION BY u.chatId ORDER BY o.nextAttempt,o.createdAt,o.id) position FROM outbox o JOIN searches s ON s.id=o.searchId JOIN users u ON u.id=s.userId WHERE o.sentAt IS NULL AND o.nextAttempt<=? AND u.enabled=1 AND u.notifications=1 AND u.chatId IS NOT NULL) WHERE position=1 ORDER BY nextAttempt,createdAt,id LIMIT 5`,Date.now());
  const sentChats=new Set();
  for(const job of pending){
   // One message per chat per scheduled invocation avoids a burst into that chat.
   if(sentChats.has(job.chatId))continue;sentChats.add(job.chatId);
   try{
    await sendNotification(env,job,telegramCall);
    await env.DB.batch([env.DB.prepare('UPDATE outbox SET sentAt=? WHERE id=?').bind(Date.now(),job.id),env.DB.prepare('UPDATE users SET notificationError=NULL WHERE id=?').bind(job.userId)]);
   }catch(e){
    await env.DB.batch([env.DB.prepare('UPDATE outbox SET attempts=attempts+1,nextAttempt=? WHERE id=?').bind(Date.now()+Math.max((e.retryAfter||0)*1000,Math.min(3600000,60000*2**Math.min(job.attempts,6))),job.id),env.DB.prepare('UPDATE users SET notificationError=? WHERE id=?').bind(e.message,job.userId)]);
   }
  }
 }finally{await release(env,'delivery',token);}
}
export async function monitor(env,{userId=null,force=false,send=true}={}){
 const key=userId?'monitor:'+userId:'monitor:scheduled',token=await lease(env,key);if(!token)return {busy:true};
 let found=0;
 try{
  const now=Date.now();
  const searches=await rows(env,`SELECT s.*,u.chatId,u.notifications FROM searches s JOIN users u ON s.userId=u.id WHERE s.enabled=1 AND u.enabled=1 AND (? IS NULL OR s.userId=?) AND (? OR s.nextCheck<=?) ORDER BY s.nextCheck LIMIT 5`,userId,userId,Number(force),now);
  let items;
  if(!searches.length)items=[];
  else if(env.DATA_SOURCE==='demo'||!env.DATA_SOURCE)items=demoItems(now);
  else if(env.DATA_SOURCE==='authorized-feed'&&env.AUTHORIZED_FEED_CONFIRMED==='true')items=(await rows(env,'SELECT item FROM feed LIMIT 500')).map(i=>JSON.parse(i.item));
  else throw Error('Для источника требуется подтверждённое разрешение');
  for(const s of searches){
   // Claim each search atomically, including when a manual check overlaps a cron run.
   const claim=await run(env,'UPDATE searches SET nextCheck=? WHERE id=? AND nextCheck=?',now+Math.max(s.intervalMinutes,5)*60000,s.id,s.nextCheck);
   if(!claim.meta.changes)continue;
   const selected=items.filter(i=>matches(s,i)).slice(0,100);
   const envelopes=selected.map(item=>({item,...notificationFor(s,item)}));
   const statements=[env.DB.prepare(`INSERT OR IGNORE INTO matches(searchId,itemId,item,foundAt) SELECT ?,json_extract(value,'$.item.id'),json_extract(value,'$.item'),? FROM json_each(?)`).bind(s.id,now,JSON.stringify(envelopes))];
   if(env.BOT_TOKEN&&s.notifications&&s.chatId&&(env.DATA_SOURCE==='demo'||!env.DATA_SOURCE))statements.push(env.DB.prepare(`INSERT OR IGNORE INTO outbox(id,searchId,itemId,text) SELECT ?,?,?,? || group_concat('• ' || json_extract(item,'$.title') || ' · ' || json_extract(item,'$.price') || CASE WHEN json_extract(item,'$.currency')='PLN' THEN ' zł' ELSE ' €' END,char(10)) || ? FROM (SELECT item FROM matches WHERE searchId=? AND foundAt=? LIMIT 5) HAVING count(*)>0`).bind(crypto.randomUUID(),s.id,'batch:'+now,`${env.DATA_SOURCE==='demo'?'🧪 ДЕМО · ':''}${s.name}\nНовые совпадения (первые 5):\n`,env.PUBLIC_URL?'\nВсе находки: '+env.PUBLIC_URL:'',s.id,now));
   if(env.BOT_TOKEN&&s.notifications&&s.chatId&&env.DATA_SOURCE&&env.DATA_SOURCE!=='demo')statements.push(env.DB.prepare(`INSERT OR IGNORE INTO outbox(id,searchId,itemId,text,payload,createdAt) SELECT 'item:'||?||':'||json_extract(e.value,'$.item.id'),?,json_extract(e.value,'$.item.id'),json_extract(e.value,'$.fallbackText'),json_extract(e.value,'$.payload'),? FROM json_each(?) e JOIN matches m ON m.searchId=? AND m.itemId=json_extract(e.value,'$.item.id') WHERE m.foundAt=?`).bind(s.id,s.id,now,JSON.stringify(envelopes),s.id,now));
   statements.push(env.DB.prepare('UPDATE searches SET lastChecked=?,error=NULL WHERE id=?').bind(now,s.id));
   const result=await env.DB.batch(statements);found+=result[0].meta.changes;
  }
  if(send)await deliver(env);
  return {found};
 }catch(e){
  if(userId)await run(env,'UPDATE searches SET error=? WHERE userId=? AND enabled=1',e.message,userId);
  throw e;
 }finally{await release(env,key,token);}
}
