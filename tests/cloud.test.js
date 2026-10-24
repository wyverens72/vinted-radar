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
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_cloud.sql',import.meta.url),'utf8'));
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
