import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import worker from '../cloudflare/worker.js';
import {monitor,deliver,telegramCall} from '../cloudflare/monitor.js';
import {acceptInvite,newLoginCode} from '../cloudflare/telegram.js';
import {digest,telegramIdentity} from '../cloudflare/security.js';
// Uses real SQLite for the D1 SQL surface and atomic batch semantics. Wrangler checks the actual Worker bundle separately.
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_cloud.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0002_catalog_media.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0003_public_catalog.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('../migrations/0004_native_filters.sql',import.meta.url),'utf8'));
 let count=0;
 class Statement{
  constructor(sql,args=[]){this.sql=sql;this.args=args;}
  bind(...args){return new Statement(this.sql,args);}
  async first(){count++;return db.prepare(this.sql).get(...this.args)||null;}
  async all(){count++;return {results:db.prepare(this.sql).all(...this.args)};}
  async run(){count++;const r=db.prepare(this.sql).run(...this.args);return {success:true,results:[],meta:{changes:r.changes}};}
 }
 const env={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}},APP_PASSWORD:'test-owner-password-32-characters',DATA_SOURCE:'demo',PUBLIC_URL:'https://radar.example',BOT_TOKEN:'123456:TEST_ONLY_NOT_A_REAL_TOKEN_1234567890',BOT_USERNAME:'TestRadarBot',TELEGRAM_OWNER_ID:'111',TELEGRAM_WEBHOOK_SECRET:'test-webhook-secret'};
 return {db,env,count:()=>count,reset:()=>{count=0;}};
}
function signed(id,token='123456:TEST_ONLY_NOT_A_REAL_TOKEN_1234567890',timestamp=Math.floor(Date.now()/1000)){
 const p=new URLSearchParams({auth_date:String(timestamp),query_id:'test',user:JSON.stringify({id,first_name:'User '+id})});
 const text=[...p.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=createHmac('sha256','WebAppData').update(token).digest();p.set('hash',createHmac('sha256',secret).update(text).digest('hex'));return p.toString();
}
const search={name:'COS',query:'',brand:'COS',size:'M',maxPrice:60,intervalMinutes:5,enabled:true};
function client(env){let cookie='';return async(path,body,method=body?'POST':'GET',headers={})=>{
 const r=await worker.fetch(new Request('https://radar.example/api'+path,{method,headers:{'Content-Type':'application/json','X-Radar-Client':'1','CF-Connecting-IP':headers.ip||'127.0.0.1',Cookie:cookie,...headers},...(body?{body:JSON.stringify(body)}:{})}),env,{});
 if(r.headers.get('Set-Cookie'))cookie=r.headers.get('Set-Cookie').split(';')[0];return r;
};}
test('Cloud auth: fresh Telegram identity, owner binding, no unauthorised self-registration',async()=>{
 const {env,db}=fixture(),request=client(env);
 assert.equal((await telegramIdentity(signed(111),'123456:TEST_ONLY_NOT_A_REAL_TOKEN_1234567890')).id,111);
 assert.equal(await telegramIdentity(signed(111,'bad'),'123456:TEST_ONLY_NOT_A_REAL_TOKEN_1234567890'),null);
 assert.equal(await telegramIdentity(signed(111,'123456:TEST_ONLY_NOT_A_REAL_TOKEN_1234567890',1),'123456:TEST_ONLY_NOT_A_REAL_TOKEN_1234567890'),null);
 assert.equal((await request('/login',{initData:signed(222)})).status,401);
 assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,1);
 assert.equal((await request('/login',{initData:signed(111)})).status,200);
 const state=await (await request('/state')).json();assert.equal(state.user.role,'owner');assert.equal(state.user.id,'owner');db.close();
});
test('Cloud invitation: one use, expiration, member data isolation and revocation',async()=>{
 const {env,db}=fixture(),owner=client(env),friend=client(env);
 await owner('/login',{password:env.APP_PASSWORD});
 const invite=await (await owner('/admin/invites',{})).json();
 const raw=new URL(invite.url).searchParams.get('start').slice(7);
 const user=await acceptInvite(env,raw,{id:222,first_name:'Friend'});assert.equal(user.id,'tg:222');
 assert.equal(await acceptInvite(env,raw,{id:333,first_name:'Stranger'}),null);
 const code=await newLoginCode(env,user.id);
 assert.equal((await friend('/login/preview',{loginCode:code})).status,200);
 assert.equal((await friend('/login',{loginCode:code})).status,200);
 assert.equal((await client(env)('/login',{loginCode:code})).status,401);
 const mine=await (await owner('/searches',search)).json();
 const theirs=await (await friend('/searches',{...search,name:'Only Friend',brand:'Arket',size:''})).json();
 await owner('/check',{});await friend('/check',{});
 const a=await (await owner('/state')).json(),b=await (await friend('/state')).json();
 assert.equal(a.searches.length,1);assert.equal(b.searches.length,1);assert.equal(a.searches[0].id,mine.id);assert.equal(b.searches[0].id,theirs.id);
 assert.ok(b.items.length);assert.ok(b.items.every(i=>i.searchId===theirs.id));
 assert.equal((await friend('/searches/'+mine.id,{...search,name:'stolen'},'PUT')).status,404);
 assert.equal((await friend('/searches/'+mine.id,{},'DELETE')).status,404);
 assert.equal((await friend('/favorites',{searchId:mine.id,itemId:a.items[0].id,favorite:true},'PUT')).status,404);
 assert.equal((await friend('/admin/invites',{})).status,403);
 assert.equal((await (await friend('/export')).json()).searches[0].name,'Only Friend');
 assert.equal((await owner('/admin/members/tg%3A222',{enabled:false},'PUT')).status,200);
 assert.equal((await friend('/state')).status,401);
 assert.equal((await client(env)('/login',{initData:signed(222)})).status,401);
 const expired=await (await owner('/admin/invites',{})).json();
 const token=new URL(expired.url).searchParams.get('start').slice(7);db.prepare('UPDATE invites SET expires=0 WHERE token=?').run(await digest(token));
 assert.equal(await acceptInvite(env,token,{id:444}),null);db.close();
});
test('Cloud webhook validates secret, retries safely, routes private notifications',async()=>{
 const {env,db}=fixture();const original=globalThis.fetch,sent=[];
 globalThis.fetch=async(url,options)=>{sent.push({url,body:JSON.parse(options.body)});return Response.json({ok:true,result:{message_id:sent.length}});};
 const hook=update=>new Request('https://radar.example/api/telegram/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':env.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify(update)});
 try{
  const update={update_id:1,message:{chat:{id:111,type:'private'},from:{id:111,first_name:'Owner'},text:'/start'}};
  assert.equal((await worker.fetch(new Request('https://radar.example/api/telegram/webhook',{method:'POST',body:'{}'}),env,{})).status,403);
  assert.equal((await worker.fetch(hook(update),env,{})).status,200);assert.equal(sent.length,1);
  await worker.fetch(hook(update),env,{});assert.equal(sent.length,1);
  const owner=client(env);await owner('/login',{password:env.APP_PASSWORD});await owner('/searches',search);
  db.prepare("INSERT INTO users(id,telegramId,name,chatId,notifications,createdAt) VALUES('friend','222','Friend','222',1,0)").run();
  db.prepare("INSERT INTO searches(id,userId,name,query,brand,size,maxPrice,intervalMinutes,createdAt) VALUES('friend-search','friend','Only Friend','','Arket','',100,5,0)").run();
  env.DB.prepare('UPDATE users SET notifications=1,chatId=? WHERE id=?').bind('111','owner').run();
  await monitor(env,{send:false});assert.equal(db.prepare('SELECT count(*) n FROM outbox').get().n,2);
  await deliver(env);assert.equal(sent.length,3);
  const friendMessage=sent.find(x=>String(x.body.chat_id)==='222');assert.ok(friendMessage.body.text.includes('Only Friend'));assert.ok(!friendMessage.body.text.includes('COS'));
  const n=sent.length;await monitor(env,{force:true});assert.equal(sent.length,n);
  db.prepare('UPDATE searches SET nextCheck=0').run();
  const stop={update_id:2,message:{chat:{id:222,type:'private'},from:{id:222},text:'/stop'}};await worker.fetch(hook(stop),env,{});
  assert.equal(db.prepare("SELECT notifications FROM users WHERE id='friend'").get().notifications,0);
 }finally{globalThis.fetch=original;db.close();}
});
test('Cloud manual request cannot bypass CSRF, interval or per-user quota',async()=>{
 const {env,db}=fixture(),request=client(env);
 assert.equal((await request('/login',{password:env.APP_PASSWORD},'POST',{Origin:'https://evil.example'})).status,403);
 await request('/login',{password:env.APP_PASSWORD});
 assert.equal((await request('/searches',{...search,intervalMinutes:1})).status,400);
 for(let i=0;i<5;i++)assert.equal((await request('/searches',{...search,name:'Search '+i})).status,201);
 assert.equal((await request('/searches',search)).status,400);
 await request('/check',{});assert.equal((await request('/check',{})).status,429);
 await request('/logout',{});assert.equal((await request('/state')).status,401);db.close();
});
test('Cloud scheduled run stays inside Free D1 query budget with five due searches',async()=>{
 const {env,db,count,reset}=fixture();for(let n=0;n<5;n++)db.prepare('INSERT INTO searches(id,userId,name,query,brand,size,maxPrice,intervalMinutes,createdAt) VALUES(?,?,?,?,?,?,?,?,0)').run('s'+n,'owner','All COS','','COS','',100,5);
 db.prepare("UPDATE users SET notifications=1,chatId='111' WHERE id='owner'").run();
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:1}});
 const jobs=[];reset();try{await worker.scheduled({},env,{waitUntil:p=>jobs.push(p)});await Promise.all(jobs);assert.ok(count()<=50,`D1 queries: ${count()}`);assert.equal(db.prepare("SELECT value FROM settings WHERE key='scheduleError'").get().value,'');assert.ok(db.prepare('SELECT count(*) n FROM matches').get().n>0);}finally{globalThis.fetch=original;db.close();}
});
test('Cloud bot onboarding without owner ID does not grant access to a stranger',async()=>{
 const {env,db}=fixture();delete env.TELEGRAM_OWNER_ID;
 const original=globalThis.fetch,sent=[];
 globalThis.fetch=async(url,options)=>{sent.push(JSON.parse(options.body));return Response.json({ok:true,result:url.endsWith('/getMe')?{username:'testradarbot'}:{message_id:1}});};
 try{
  const owner=client(env);await owner('/login',{password:env.APP_PASSWORD});
  assert.equal((await owner('/admin/telegram/setup',{})).status,200);
  const r=await worker.fetch(new Request('https://radar.example/api/telegram/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':env.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify({update_id:20,message:{chat:{id:777,type:'private'},from:{id:777},text:'/start'}})}),env,{});
  assert.equal(r.status,200);assert.ok(sent.some(m=>m.text?.includes('777')));assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,1);
  assert.equal((await client(env)('/login',{initData:signed(777)})).status,401);
 }finally{globalThis.fetch=original;db.close();}
});
test('Cloud notification retry retains matches and marks delivery after recovery',async()=>{
 const {env,db}=fixture(),owner=client(env);await owner('/login',{password:env.APP_PASSWORD});await owner('/searches',search);
 db.prepare("UPDATE users SET notifications=1,chatId='111' WHERE id='owner'").run();
 await monitor(env,{send:false});const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>{throw Error('network');};await deliver(env);
  assert.equal(db.prepare('SELECT attempts FROM outbox').get().attempts,1);assert.equal(db.prepare('SELECT sentAt FROM outbox').get().sentAt,null);assert.equal(db.prepare('SELECT count(*) n FROM matches').get().n,1);
  db.prepare('UPDATE outbox SET nextAttempt=0').run();let delivered=0;
  globalThis.fetch=async()=>{delivered++;return Response.json({ok:true,result:{message_id:1}});};await deliver(env);
  assert.equal(delivered,1);assert.ok(db.prepare('SELECT sentAt FROM outbox').get().sentAt);await monitor(env,{force:true});assert.equal(delivered,1);
 }finally{globalThis.fetch=original;db.close();}
});

test('Cloud token validation rejects wrong format and normalizes surrounding whitespace',async()=>{
 const {env,db}=fixture();const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{calls++;assert.ok(!url.includes('%20'));return Response.json({ok:true,result:{username:'TestRadarBot'}});};
 try{env.BOT_TOKEN='@TestRadarBot';await assert.rejects(()=>telegramCall(env,'getMe',{}),/неверный формат/);assert.equal(calls,0);env.BOT_TOKEN='  123456:TEST_ONLY_NOT_A_REAL_TOKEN_1234567890  ';await telegramCall(env,'getMe',{});assert.equal(calls,1);assert.equal((await telegramIdentity(signed(111),env.BOT_TOKEN)).id,111);}finally{globalThis.fetch=original;db.close();}
});
test('Poland: PLN, country, range, condition and composite size must all match',async()=>{
 const {matches}=await import('../server/domain.js');const {marketFields}=await import('../server/catalog.js');
 const s={...search,...marketFields({...search,country:'pl',currency:'PLN',minPrice:30,condition:'Bardzo dobry'})};
 const item={title:'Wełniana marynarka',brand:'COS',size:'M / 38',condition:'Bardzo dobry',country:'pl',currency:'PLN',price:49};
 assert.equal(matches(s,item),true);
 for(const patch of [{currency:'EUR'},{country:'lt'},{price:29},{price:61},{condition:'Dobry'},{brand:'Arket'},{size:'S / 36'}])assert.equal(matches(s,{...item,...patch}),false);
 assert.throws(()=>marketFields({...search,country:'pl',currency:'EUR'}));
 assert.throws(()=>marketFields({...search,country:'pl',minPrice:100}));
});
test('Catalog record normalizer checks item identity, Polish currency and image host without inventing missing data',async()=>{
 const {normalizeCatalogRows}=await import('../cloudflare/catalog-records.js');
 const row={itemId:'1234567890',url:'https://www.vinted.pl/items/1234567890-marynarka',title:'Marynarka COS',brand:'COS',size:'M / 38',condition:'Bardzo dobry',price:49,currency:'PLN',country:'pl',imageUrl:'https://images1.vinted.net/t/example.webp'};
 const item=normalizeCatalogRows([row,row])[0];assert.equal(item.id,'vinted:pl:1234567890');assert.equal(item.photoUrl,row.imageUrl);assert.equal(normalizeCatalogRows([row,row]).length,1);
 for(const patch of [{url:'https://evil.example/items/1234567890'},{url:'https://www.vinted.pl/items/99999999-test'},{currency:'EUR'},{imageUrl:'https://vinted.net.evil.example/a.jpg'},{imageUrl:'http://127.0.0.1/a.jpg'}])assert.throws(()=>normalizeCatalogRows([{...row,...patch}]));
 const sparse=normalizeCatalogRows([{...row,brand:null,size:null,imageUrl:null}])[0];assert.equal(sparse.brand,'');assert.equal(sparse.size,'');assert.equal(sparse.photoUrl,null);

});
test('Photo notifications keep the item link and only fall back for an invalid image',async()=>{
 const {notificationFor,sendNotification}=await import('../cloudflare/notifications.js');
 const item={title:'Marynarka',brand:'COS',size:'M',condition:'Bardzo dobry',price:49,currency:'PLN',photoUrl:'https://images1.vinted.net/t/example.webp',url:'https://www.vinted.pl/items/1234567890-test'};
 const n=notificationFor(search,item);assert.equal(n.payload.method,'sendPhoto');assert.ok(n.payload.caption.includes('49 zł'));assert.equal(n.payload.reply_markup.inline_keyboard[0][0].url,item.url);
 const job={payload:JSON.stringify(n.payload),text:n.fallbackText,chatId:'111'},calls=[];
 await sendNotification({},job,async(_e,method,body)=>{calls.push({method,body});return true;});assert.equal(calls[0].method,'sendPhoto');assert.equal(calls[0].body.chat_id,'111');
 const badImage=Object.assign(Error('Telegram: failed to get HTTP URL content'),{errorCode:400});
 calls.length=0;await sendNotification({},job,async(_e,method,body)=>{calls.push({method,body});if(method==='sendPhoto')throw badImage;return true;});assert.equal(calls[1].method,'sendMessage');assert.ok(calls[1].body.text.includes(item.url));
 await assert.rejects(()=>sendNotification({},job,async()=>{throw Object.assign(Error('Too many requests'),{errorCode:429});}),/Too many/);
});
test('Real catalog pipeline queues individual photos atomically and isolates matches from another market',async()=>{
 const {env,db}=fixture(),owner=client(env);env.DATA_SOURCE='authorized-feed';env.AUTHORIZED_FEED_CONFIRMED='true';
 await owner('/login',{password:env.APP_PASSWORD});
 assert.equal((await owner('/searches',{...search,country:'pl',currency:'PLN',minPrice:30,condition:'Bardzo dobry'})).status,201);
 db.prepare("UPDATE users SET chatId='111',notifications=1 WHERE id='owner'").run();
 const item={id:'vinted:pl:1234567890',title:'Marynarka COS',brand:'COS',size:'M / 38',country:'pl',currency:'PLN',condition:'Bardzo dobry',price:49,url:'https://www.vinted.pl/items/1234567890-test',photoUrl:'https://images1.vinted.net/t/example.webp'};
 await owner('/admin/feed',{permissionConfirmed:true,items:[item,{...item,id:'other-country',country:'lt',currency:'EUR'}]},'PUT');
 await monitor(env,{send:false});assert.equal(db.prepare('SELECT count(*) n FROM matches').get().n,1);
 assert.equal(JSON.parse(db.prepare('SELECT payload FROM outbox').get().payload).method,'sendPhoto');
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({ok:true,result:{message_id:1}});};
 try{await deliver(env);assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/sendPhoto'));assert.equal(calls[0].body.photo,item.photoUrl);await monitor(env,{force:true});assert.equal(calls.length,1);}finally{globalThis.fetch=original;db.close();}
});

test('Public monitoring caches identical URLs, baselines without alerts, deduplicates and records blocks per search',async()=>{
 const {env,db}=fixture(),owner=client(env);env.DATA_SOURCE='vinted-public';
 await owner('/login',{password:env.APP_PASSWORD});
 const pl={...search,country:'pl',currency:'PLN',size:'S',maxPrice:100};
 await owner('/searches',pl);await owner('/searches',{...pl,name:'Second'});
 db.prepare("UPDATE users SET chatId='111',notifications=1 WHERE id='owner'").run();
 const html=readFileSync(new URL('./fixtures/vinted-pl-card.html',import.meta.url),'utf8'),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(html,{headers:{'content-type':'text/html'}});};
 try{
  await monitor(env,{send:false});assert.equal(calls,1);assert.equal(db.prepare('SELECT count(*) n FROM matches').get().n,2);assert.equal(db.prepare('SELECT count(*) n FROM outbox').get().n,0);
  db.exec('UPDATE catalog_cache SET fetchedAt=0');
  globalThis.fetch=async()=>{calls++;return new Response(html.replaceAll('10508917416','10508917417'),{headers:{'content-type':'text/html'}});};
  await monitor(env,{force:true,send:false});assert.equal(calls,2);assert.equal(db.prepare('SELECT count(*) n FROM outbox').get().n,2);
  await monitor(env,{force:true,send:false});assert.equal(calls,2);assert.equal(db.prepare('SELECT count(*) n FROM outbox').get().n,2);
  db.exec('UPDATE catalog_cache SET fetchedAt=0');globalThis.fetch=async()=>{calls++;return new Response('blocked',{status:403});};
  await monitor(env,{force:true,send:false});assert.equal(calls,3);assert.equal(db.prepare('SELECT count(*) n FROM searches WHERE error IS NOT NULL').get().n,2);
  await monitor(env,{force:true,send:false});assert.equal(calls,3);assert.equal(db.prepare('SELECT count(*) n FROM matches').get().n,4);
 }finally{globalThis.fetch=original;db.close();}
});

test('Public scheduled scan with fresh pages stays within the Free query budget',async()=>{
 const {env,db,count,reset}=fixture(),owner=client(env);env.DATA_SOURCE='vinted-public';await owner('/login',{password:env.APP_PASSWORD});
 for(let n=0;n<5;n++)await owner('/searches',{...search,country:'pl',currency:'PLN',size:'S',maxPrice:100+n});
 const original=globalThis.fetch,html=readFileSync(new URL('./fixtures/vinted-pl-card.html',import.meta.url),'utf8');let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(html,{headers:{'content-type':'text/html'}});};
 try{reset();let job;await worker.scheduled({},env,{waitUntil:p=>{job=p;}});await job;assert.equal(calls,3);assert.ok(count()<=50,`D1 statements: ${count()}`);assert.equal(db.prepare('SELECT count(*) n FROM searches WHERE lastChecked IS NOT NULL').get().n,3);}
 finally{globalThis.fetch=original;db.close();}
});

test('Catalog diagnostic is owner-only, read-only and retains safe response evidence during cooldown',async()=>{
 const {env,db}=fixture(),owner=client(env);env.DATA_SOURCE='vinted-public';await owner('/login',{password:env.APP_PASSWORD});
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('<title>Too many requests</title>',{status:429,headers:{'retry-after':'120','set-cookie':'never-store=secret','content-type':'text/html'}});};
 try{
  const {readCatalog}=await import('../cloudflare/vinted.js');
  await assert.rejects(()=>readCatalog(env,{country:'pl',query:'',brand:'COS',minPrice:0,maxPrice:60}),/429/);
  const before=Date.now();const saved=await (await owner('/admin/catalog/diagnostic')).json();
  assert.equal(saved.diagnostic.status,429);assert.ok(saved.blockedUntil-before<=3600000);assert.ok(saved.blockedUntil-before>3500000);
  assert.equal(saved.diagnostic.headers['set-cookie'],undefined);assert.equal((await client(env)('/admin/catalog/diagnostic')).status,401);
  await assert.rejects(()=>readCatalog(env,{country:'pl',query:'',brand:'COS',minPrice:0,maxPrice:60}),/приостановлен/);assert.equal(calls,1);
 }finally{globalThis.fetch=original;db.close();}
});

test('Dedicated collector can import only active public catalogs; cloud never fetches in GitHub mode',async()=>{
 const {env,db}=fixture(),owner=client(env);env.DATA_SOURCE='vinted-public';env.CATALOG_FETCH_MODE='github';env.CATALOG_COLLECTOR_TOKEN='a'.repeat(64);
 await owner('/login',{password:env.APP_PASSWORD});await owner('/searches',{...search,country:'pl',currency:'PLN',size:'S'});
 const call=async(path,b,token=env.CATALOG_COLLECTOR_TOKEN)=>worker.fetch(new Request('https://radar.example/api/collector/'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'X-Radar-Client':'1','Content-Type':'application/json'},body:JSON.stringify(b)}),env,{});
 assert.equal((await call('jobs',{},'wrong')).status,401);
 const work=await (await call('jobs',{})).json();assert.equal(work.jobs.length,1);assert.ok(work.lease);
 assert.equal((await call('import',{lease:'wrong',url:work.jobs[0].url,items:[]})).status,409);
 assert.equal((await call('import',{lease:work.lease,url:'https://evil.test/catalog',items:[]})).status,400);
 const {parseCatalog}=await import('../cloudflare/vinted.js');const items=parseCatalog(readFileSync(new URL('./fixtures/vinted-pl-card.html',import.meta.url),'utf8'));
 assert.equal((await call('import',{lease:work.lease,url:work.jobs[0].url,items,fetchedAt:1})).status,400);
 assert.equal((await call('import',{lease:work.lease,url:work.jobs[0].url,items:[{...items[0],url:'https://evil.test/items/10508917416'}],fetchedAt:Date.now()})).status,400);
 db.prepare("INSERT INTO settings VALUES('vintedBlockedUntil',?)").run(String(Date.now()+3600000));
 assert.equal((await call('import',{lease:work.lease,url:work.jobs[0].url,items,fetchedAt:Date.now()})).status,200);
 const original=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('No cloud fetch allowed');};
 try{
  await monitor(env,{send:false});assert.equal(requests,0);assert.equal(db.prepare('SELECT count(*) n FROM matches').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM outbox').get().n,0);
  const state=await (await owner('/state')).json();assert.equal(state.catalog.mode,'github');assert.equal(state.catalog.blockedUntil,0);assert.ok(state.catalog.lastSuccess>0);
  assert.ok(Number(db.prepare("SELECT value FROM settings WHERE key='vintedBlockedUntil'").get().value)>Date.now());
  db.exec('UPDATE catalog_cache SET fetchedAt=0');await monitor(env,{force:true,send:false});assert.equal(requests,0);assert.match(db.prepare('SELECT error FROM searches').get().error,/Ожидаем/);
 }finally{globalThis.fetch=original;}
 await call('failure',{lease:work.lease,url:work.jobs[0].url,status:429,blocked:true,retryAfter:7200000});
 await call('finish',{lease:work.lease});const paused=await (await call('jobs',{})).json();assert.equal(paused.jobs.length,0);assert.ok(paused.blockedUntil>Date.now()+7100000);
 const denied=await worker.fetch(new Request('https://radar.example/api/admin/readiness',{headers:{Authorization:'Bearer '+env.CATALOG_COLLECTOR_TOKEN}}),env,{});assert.equal(denied.status,401);db.close();
});

test('Telegram test uses a real photo only from the signed-in users own matches',async()=>{
 const {env,db}=fixture(),owner=client(env);await owner('/login',{password:env.APP_PASSWORD});const s=await (await owner('/searches',{...search,country:'pl',currency:'PLN'})).json();
 const {parseCatalog}=await import('../cloudflare/vinted.js');const item=parseCatalog(readFileSync(new URL('./fixtures/vinted-pl-card.html',import.meta.url),'utf8'))[0];
 db.prepare("UPDATE users SET chatId='111',notifications=1 WHERE id='owner'").run();
 db.prepare('INSERT INTO matches(searchId,itemId,item,foundAt) VALUES(?,?,?,?)').run(s.id,item.id,JSON.stringify(item),Date.now());
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,o)=>{calls.push({url,body:JSON.parse(o.body)});return Response.json({ok:true,result:{message_id:1,photo:[{file_id:'test'}]}});};
 try{const r=await owner('/telegram/test',{});assert.equal(r.status,200);assert.equal((await r.json()).photo,true);assert.ok(calls[0].url.endsWith('/sendPhoto'));assert.equal(calls[0].body.photo,item.photoUrl);assert.equal(calls[0].body.chat_id,'111');}
 finally{globalThis.fetch=original;db.close();}
});

test('Multiple size choices survive API save, reload and pause updates without changing old searches',async()=>{
 const {env,db}=fixture(),owner=client(env);await owner('/login',{password:env.APP_PASSWORD});
 const saved=await (await owner('/searches',{...search,country:'pl',currency:'PLN',size:'s, S, M'})).json();
 let state=await (await owner('/state')).json(),item=state.searches.find(s=>s.id===saved.id);assert.equal(item.size,'s, M');
 assert.equal((await owner('/searches/'+item.id,{...item,enabled:false},'PUT')).status,200);
 state=await (await owner('/state')).json();item=state.searches.find(s=>s.id===saved.id);assert.equal(item.size,'s, M');assert.equal(item.enabled,false);db.close();
});

test('Native filters survive save, reload, pause and export without stale text filtering',async()=>{
 const {env,db}=fixture(),owner=client(env);await owner('/login',{password:env.APP_PASSWORD});
 const response=await owner('/searches',{...search,query:'',brand:'',country:'pl',currency:'PLN',catalogUrl:'https://www.vinted.pl/catalog?catalog[]=183&brand_ids[]=2029&size_ids[]=123&color_ids[]=1'});
 assert.equal(response.status,201);const saved=await response.json();
 let state=await (await owner('/state')).json(),item=state.searches.find(s=>s.id===saved.id);assert.ok(item.catalogUrl.includes('size_ids'));
 assert.equal((await owner('/searches/'+item.id,{...item,enabled:false},'PUT')).status,200);
 const exported=await (await owner('/export')).json();assert.equal(exported.searches[0].catalogUrl,item.catalogUrl);db.close();
});
