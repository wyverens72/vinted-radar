import {readCatalog} from './vinted.js';
import {collectorRoute} from './collector.js';
import {notificationFor,sendNotification} from './notifications.js';
import {marketFields} from '../server/catalog.js';
import {validateSearch,validateItems} from '../server/domain.js';
import {digest,random,equal,cookie,telegramIdentity} from './security.js';
import {one,rows,run,getSetting,setSetting,limit,telegramUser} from './data.js';
import {monitor,telegramCall} from './monitor.js';
import {webhook} from './telegram.js';
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
async function body(request){
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail('Ожидается JSON',415);
 if(Number(request.headers.get('Content-Length')||0)>200000)fail('Слишком большой запрос',413);
 const text=await request.text();if(text.length>200000)fail('Слишком большой запрос',413);
 try{const b=JSON.parse(text);if(!b||typeof b!=='object'||Array.isArray(b))throw Error();return b;}catch{fail('Неверный JSON');}
}
async function identity(request,env){
 const token=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('radar='))?.slice(6);
 let user=token&&token.length===48?await one(env,'SELECT u.* FROM users u JOIN sessions s ON u.id=s.userId WHERE s.token=? AND s.expires>? AND u.enabled=1',await digest(token),Date.now()):null;
 if(!user)user=await telegramUser(env,await telegramIdentity(request.headers.get('X-Telegram-Init-Data'),env.BOT_TOKEN));
 return {user,token};
}
async function signIn(request,env,user){
 const token=random();await run(env,'INSERT INTO sessions VALUES(?,?,?)',await digest(token),user.id,Date.now()+604800000);
 return json({ok:true},200,{'Set-Cookie':cookie(request,token)});
}
async function router(request,env,ctx){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
 if(path==='/api/health')return json({ok:true,runtime:'cloudflare'});
 if(path.startsWith('/api/collector/'))return collectorRoute(request,env,body);
 if(path==='/api/telegram/webhook'){
  if(method!=='POST'||!env.TELEGRAM_WEBHOOK_SECRET||!equal(request.headers.get('X-Telegram-Bot-Api-Secret-Token'),env.TELEGRAM_WEBHOOK_SECRET))return json({error:'Запрещено'},403);
  if(Number(request.headers.get('Content-Length')||0)>100000)return json({error:'Too large'},413);
  return webhook(request,env);
 }
 if(path==='/api/public-config'&&method==='GET')return json({cloud:true,botUrl:env.BOT_USERNAME?`https://t.me/${env.BOT_USERNAME}`:null});
 if(!['GET','HEAD'].includes(method)){
  if(request.headers.get('X-Radar-Client')!=='1')fail('Обновите приложение',403);
  const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)fail('Недопустимый источник запроса',403);
 }
 if((path==='/api/login'||path==='/api/login/preview')&&method==='POST'){
  const key='login:'+(request.headers.get('CF-Connecting-IP')||'local');
  if(!await limit(env,key,12,900000))fail('Слишком много попыток. Подождите 15 минут.',429);
  const b=await body(request);let user;
  if(typeof b.loginCode==='string'&&b.loginCode.length===48){
   const hash=await digest(b.loginCode);
   const code=await one(env,'SELECT c.*,u.name,u.enabled FROM login_codes c JOIN users u ON c.userId=u.id WHERE c.token=? AND c.expires>? AND u.enabled=1',hash,Date.now());
   if(!code)fail('Ссылка истекла или уже использована. Отправьте боту /login.',401);
   if(path==='/api/login/preview')return json({name:code.name});
   const consumed=await run(env,'DELETE FROM login_codes WHERE token=? AND expires>?',hash,Date.now());
   if(!consumed.meta.changes)fail('Ссылка уже использована',401);
   user=await one(env,'SELECT * FROM users WHERE id=? AND enabled=1',code.userId);
  }else if(path==='/api/login/preview')fail('Нужна ссылка из Telegram',401);
  else{
   user=await telegramUser(env,await telegramIdentity(b.initData,env.BOT_TOKEN));
   if(!user&&typeof b.password==='string'&&env.APP_PASSWORD?.length>=24&&b.password.length<=300&&equal(await digest(b.password),await digest(env.APP_PASSWORD)))user=await one(env,"SELECT * FROM users WHERE id='owner' AND enabled=1");
  }
  if(!user)fail('Нет доступа. Откройте приглашение в Telegram или проверьте пароль владельца.',401);
  return signIn(request,env,user);
 }
 const auth=await identity(request,env),u=auth.user;
 if(!u)fail('Войдите в приложение',401);
 const admin=()=>{if(u.role!=='owner')fail('Только для владельца',403);};
 if(path==='/api/logout'&&method==='POST'){
  if(auth.token)await run(env,'DELETE FROM sessions WHERE token=? AND userId=?',await digest(auth.token),u.id);
  return json({ok:true},200,{'Set-Cookie':cookie(request,'',0)});
 }
 if(path==='/api/state'&&method==='GET'){
  const [searches,items,pending]=await Promise.all([
   rows(env,'SELECT * FROM searches WHERE userId=? ORDER BY createdAt DESC',u.id),
   rows(env,`SELECT m.*,s.name searchName FROM matches m JOIN searches s ON s.id=m.searchId WHERE s.userId=? AND (?=1 OR COALESCE(json_extract(m.item,'$.demo'),0)=0) ORDER BY m.foundAt DESC LIMIT 500`,u.id,Number(!env.DATA_SOURCE||env.DATA_SOURCE==='demo')),
   one(env,'SELECT count(*) n FROM outbox o JOIN searches s ON o.searchId=s.id WHERE s.userId=? AND o.sentAt IS NULL',u.id)
  ]);
  return json({cloud:true,user:{id:u.id,name:u.name,role:u.role},source:env.DATA_SOURCE||'demo',catalog:env.DATA_SOURCE==='vinted-public'?{mode:env.CATALOG_FETCH_MODE==='github'?'github':'cloudflare',blockedUntil:Number(await getSetting(env,env.CATALOG_FETCH_MODE==='github'?'collectorBlockedUntil':'vintedBlockedUntil')||0),lastError:await getSetting(env,env.CATALOG_FETCH_MODE==='github'?'collectorLastError':'vintedLastError')||null,lastSuccess:Number(await getSetting(env,env.CATALOG_FETCH_MODE==='github'?'collectorLastSuccess':'vintedLastSuccess')||0)}:null,telegram:{configured:!!(env.BOT_TOKEN&&env.TELEGRAM_WEBHOOK_SECRET),connected:!!(u.notifications&&u.chatId),botUrl:env.BOT_USERNAME?`https://t.me/${env.BOT_USERNAME}`:null,error:u.notificationError,pending:pending.n},searches:searches.map(s=>({...s,enabled:!!s.enabled})),items:items.map(m=>({...JSON.parse(m.item),searchId:m.searchId,searchName:m.searchName,foundAt:m.foundAt,favorite:!!m.favorite}))});
 }
 if(path==='/api/searches'&&method==='POST'){
  const input=await body(request),s={...validateSearch(input),...marketFields(input)};
  if(s.intervalMinutes<5)fail('В бесплатной облачной версии минимальный интервал — 5 минут');
  const id=crypto.randomUUID();
  const inserted=await run(env,`INSERT INTO searches(id,userId,name,query,brand,size,maxPrice,intervalMinutes,enabled,createdAt,country,currency,minPrice,condition) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM searches WHERE userId=?)<5`,id,u.id,s.name,s.query,s.brand,s.size,s.maxPrice,s.intervalMinutes,s.enabled,Date.now(),s.country,s.currency,s.minPrice,s.condition,u.id);
  if(!inserted.meta.changes)fail('До 5 поисков на человека в бесплатной версии');
  return json({id},201);
 }
 const searchMatch=path.match(/^\/api\/searches\/([^/]+)$/);
 if(searchMatch&&['PUT','DELETE'].includes(method)){
  const id=decodeURIComponent(searchMatch[1]);if(!await one(env,'SELECT id FROM searches WHERE id=? AND userId=?',id,u.id))fail('Поиск не найден',404);
  if(method==='DELETE')await run(env,'DELETE FROM searches WHERE id=? AND userId=?',id,u.id);
  else{
   const input=await body(request),s={...validateSearch(input),...marketFields(input)};if(s.intervalMinutes<5)fail('Минимальный интервал — 5 минут');
   await run(env,'UPDATE searches SET name=?,query=?,brand=?,size=?,maxPrice=?,intervalMinutes=?,enabled=?,nextCheck=0,error=NULL,country=?,currency=?,minPrice=?,condition=? WHERE id=? AND userId=?',s.name,s.query,s.brand,s.size,s.maxPrice,s.intervalMinutes,s.enabled,s.country,s.currency,s.minPrice,s.condition,id,u.id);
  }
  return json({ok:true});
 }
 if(path==='/api/favorites'&&method==='PUT'){
  const b=await body(request);if(typeof b.searchId!=='string'||typeof b.itemId!=='string'||typeof b.favorite!=='boolean')fail('Неверные данные');
  const result=await run(env,'UPDATE matches SET favorite=? WHERE searchId=? AND itemId=? AND searchId IN (SELECT id FROM searches WHERE userId=?)',Number(b.favorite),b.searchId,b.itemId,u.id);
  if(!result.meta.changes)fail('Находка не найдена',404);return json({ok:true});
 }
 if(path==='/api/check'&&method==='POST'){
  const now=Date.now(),claim=await run(env,'UPDATE users SET lastManual=? WHERE id=? AND lastManual<=?',now,u.id,now-30000);
  if(!claim.meta.changes)fail('Повторная проверка доступна через 30 секунд',429);
  return json(await monitor(env,{userId:u.id,force:true,send:false}));
 }
 if(path==='/api/telegram/test'&&method==='POST'){
  if(!u.chatId||!u.notifications)fail('Отправьте своему боту /start');
  if(!await limit(env,'test:'+u.id,3,60000))fail('Подождите минуту',429);
  const sample=await one(env,`SELECT m.item FROM matches m JOIN searches s ON s.id=m.searchId WHERE s.userId=? AND COALESCE(json_extract(m.item,'$.demo'),0)=0 AND json_extract(m.item,'$.photoUrl') IS NOT NULL ORDER BY m.foundAt DESC LIMIT 1`,u.id);
  if(sample){
   const n=notificationFor({name:'✓ Проверка радара · реальное объявление'},JSON.parse(sample.item));
   const sent=await sendNotification(env,{chatId:u.chatId,payload:JSON.stringify(n.payload),text:n.fallbackText},telegramCall);
   return json({ok:true,photo:!!sent?.photo?.length});
  }
  await telegramCall(env,'sendMessage',{chat_id:u.chatId,text:'✓ Личный Vinted Radar подключён. Ваши уведомления приходят в этот чат.'});return json({ok:true});
 }
 if(path==='/api/export'&&method==='GET')return json({version:2,searches:(await rows(env,'SELECT name,query,brand,size,maxPrice,minPrice,condition,country,currency,intervalMinutes,enabled FROM searches WHERE userId=?',u.id)).map(s=>({...s,enabled:!!s.enabled}))},200,{'Content-Disposition':'attachment; filename="radar-searches.json"'});
 if(path==='/api/admin/invites'&&method==='GET'){admin();return json({invites:await rows(env,'SELECT token id,expires,usedBy,revoked FROM invites ORDER BY createdAt DESC LIMIT 20')});}
 if(path==='/api/admin/invites'&&method==='POST'){
  admin();if(!env.BOT_USERNAME||!env.BOT_TOKEN)fail('Сначала подключите Telegram-бота');
  if(!await limit(env,'invites:'+u.id,10,86400000))fail('До 10 приглашений в день',429);
  const token=random(),expires=Date.now()+86400000;await run(env,'INSERT INTO invites(token,createdAt,expires) VALUES(?,?,?)',await digest(token),Date.now(),expires);
  return json({url:`https://t.me/${env.BOT_USERNAME}?start=invite_${token}`,expires});
 }
 const inviteMatch=path.match(/^\/api\/admin\/invites\/([a-f0-9]{64})$/);
 if(inviteMatch&&method==='DELETE'){admin();await run(env,'UPDATE invites SET revoked=1 WHERE token=?',inviteMatch[1]);return json({ok:true});}
 if(path==='/api/admin/members'&&method==='GET'){admin();return json({members:await rows(env,"SELECT id,name,enabled,createdAt FROM users WHERE role='member' ORDER BY createdAt")});}
 const memberMatch=path.match(/^\/api\/admin\/members\/(.+)$/);
 if(memberMatch&&method==='PUT'){
  admin();const id=decodeURIComponent(memberMatch[1]),b=await body(request);if(typeof b.enabled!=='boolean')fail('Неверные данные');
  if(!await one(env,"SELECT id FROM users WHERE id=? AND role='member'",id))fail('Пользователь не найден',404);
  const statements=[env.DB.prepare("UPDATE users SET enabled=? WHERE id=? AND role='member'").bind(Number(b.enabled),id)];
  if(!b.enabled)statements.push(env.DB.prepare('DELETE FROM sessions WHERE userId=?').bind(id),env.DB.prepare('DELETE FROM login_codes WHERE userId=?').bind(id),env.DB.prepare('DELETE FROM outbox WHERE sentAt IS NULL AND searchId IN (SELECT id FROM searches WHERE userId=?)').bind(id));
  await env.DB.batch(statements);return json({ok:true});
 }
 if(path==='/api/admin/readiness'&&method==='GET'){
  admin();return json({https:url.protocol==='https:',database:!!env.DB,ownerTelegram:!!env.TELEGRAM_OWNER_ID,bot:!!env.BOT_TOKEN,botTokenFormat:/^\d+:[A-Za-z0-9_-]{20,100}$/.test(env.BOT_TOKEN?.trim()||''),webhookSecret:!!env.TELEGRAM_WEBHOOK_SECRET,botUsername:env.BOT_USERNAME||null,source:env.DATA_SOURCE||'demo',lastScheduled:await getSetting(env,'lastScheduled'),scheduleError:await getSetting(env,'scheduleError')||null});
 }
 if(path==='/api/admin/telegram/setup'&&method==='POST'){
  admin();if(!env.TELEGRAM_WEBHOOK_SECRET||!env.BOT_TOKEN||!env.PUBLIC_URL?.startsWith('https://'))fail('Заполните BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET и HTTPS PUBLIC_URL в Cloudflare');
  const me=await telegramCall(env,'getMe',{});
  if(env.BOT_USERNAME?.toLowerCase()!==me.username.toLowerCase())fail('BOT_USERNAME должен совпадать с именем вашего бота: '+me.username);
  await telegramCall(env,'setWebhook',{url:env.PUBLIC_URL+'/api/telegram/webhook',secret_token:env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message'],drop_pending_updates:false,max_connections:1});
  await telegramCall(env,'setMyCommands',{commands:[{command:'start',description:'Открыть личный радар'},{command:'login',description:'Вход на сайт в браузере'},{command:'status',description:'Статус поисков'},{command:'stop',description:'Отключить уведомления'}]});
  await telegramCall(env,'setChatMenuButton',{menu_button:{type:'web_app',text:'Мой радар',web_app:{url:env.PUBLIC_URL}}});
  return json({ok:true,botUrl:`https://t.me/${me.username}`});
 }
 if(path==='/api/admin/catalog/diagnostic'&&method==='GET'){
  admin();const saved=await getSetting(env,'vintedDiagnostic');
  return json({diagnostic:saved?JSON.parse(saved):null,blockedUntil:Number(await getSetting(env,'vintedBlockedUntil')||0),lastError:await getSetting(env,'vintedLastError')||null});
 }
 if(path==='/api/admin/catalog/check'&&method==='POST'){
  admin();if(!await limit(env,'catalog-check',1,60000))fail('Повторная проверка доступна через минуту',429);
  const items=await readCatalog(env,{country:'pl',query:'',brand:'COS',minPrice:0,maxPrice:100});
  return json({ok:true,count:items.length,sample:items.slice(0,3)});
 }
 if(path==='/api/admin/feed'&&method==='PUT'){
  admin();const b=await body(request);
  if(env.DATA_SOURCE!=='authorized-feed'||env.AUTHORIZED_FEED_CONFIRMED!=='true'||b.permissionConfirmed!==true)fail('Источник должен иметь подтверждённое разрешение');
  const items=validateItems(b.items);if(items.length>100)fail('До 100 товаров в бесплатной версии');
  await env.DB.batch([env.DB.prepare('DELETE FROM feed'),env.DB.prepare(`INSERT INTO feed(id,item) SELECT json_extract(value,'$.id'),value FROM json_each(?)`).bind(JSON.stringify(items.map(i=>({...i,demo:false}))))]);return json({ok:true,count:items.length});
 }
 fail('Не найдено',404);
}
export default {
 async fetch(request,env,ctx){
  let response;
  try{response=await router(request,env,ctx);}catch(e){response=json({error:e.status||e.name==='Error'?e.message:'Ошибка сервера'},e.status||400);}
  const headers=new Headers(response.headers);
  headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' data: https://*.vinted.net https://vinted.net; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
  if(new URL(request.url).protocol==='https:')headers.set('Strict-Transport-Security','max-age=31536000');
  return new Response(response.body,{status:response.status,headers});
 },
 async scheduled(event,env,ctx){
  ctx.waitUntil((async()=>{
   try{
    await monitor(env);await setSetting(env,'lastScheduled',Date.now());await setSetting(env,'scheduleError','');
    // Bounded housekeeping: private favorites are retained; obsolete demo data is discarded after seven days.
    const now=Date.now();
    await env.DB.batch([
     env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(now),
     env.DB.prepare('DELETE FROM login_codes WHERE expires<?').bind(now),
     env.DB.prepare('DELETE FROM rate_limits WHERE expires<?').bind(now),
     env.DB.prepare('DELETE FROM catalog_cache WHERE fetchedAt<?').bind(now-86400000),
     env.DB.prepare('DELETE FROM updates WHERE createdAt<?').bind(now-86400000),
     env.DB.prepare('DELETE FROM outbox WHERE sentAt<?').bind(now-7*86400000),
     env.DB.prepare("DELETE FROM matches WHERE favorite=0 AND foundAt<? AND json_extract(item,'$.demo')=1").bind(now-7*86400000)
    ]);
   }catch(e){await setSetting(env,'scheduleError',String(e.message).slice(0,200));}
  })());
 }
};
