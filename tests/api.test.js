import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
test('HTTP: auth, CRUD, favorites, isolation, persistence and logout',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'radar-test-')),port=18000+Math.floor(Math.random()*10000),base=`http://127.0.0.1:${port}`;
 let child;
 async function start(){child=spawn(process.execPath,['server/index.js'],{env:{...process.env,APP_PASSWORD:'testing-private-password-123',DATABASE_PATH:join(dir,'db.sqlite'),PORT:String(port),PUBLIC_URL:base,HOST:'127.0.0.1',BOT_TOKEN:'',TELEGRAM_OWNER_ID:'',DATA_SOURCE:'demo',COOKIE_SECURE:'false'},stdio:['ignore','pipe','pipe']});let output='';child.stderr.on('data',d=>output+=d);for(let n=0;n<80;n++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}if(child.exitCode!==null)throw Error(output);await new Promise(r=>setTimeout(r,50));}throw Error('Server did not start: '+output);}
 async function stop(){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
 let cookie='';
 const req=(p,body,method=body?'POST':'GET',extra={})=>fetch(base+'/api'+p,{method,headers:{'Content-Type':'application/json','X-Radar-Client':'1',Cookie:cookie,...extra},...(body?{body:JSON.stringify(body)}:{})});
 try {
  await start();assert.equal((await req('/state')).status,401);
  assert.equal((await req('/login',{password:'wrong'})).status,401);
  assert.equal((await req('/login',{password:'testing-private-password-123'},'POST',{Origin:'https://evil.example'})).status,403);
  const login=await req('/login',{password:'testing-private-password-123'});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly/);cookie=login.headers.get('set-cookie').split(';')[0];
  const data={name:'Жакеты',query:'',brand:'COS',size:'M',maxPrice:45,intervalMinutes:5,enabled:true};
  const created=await req('/searches',data);assert.equal(created.status,201);const {id}=await created.json();
  await new Promise(r=>setTimeout(r,100));
  let state=await (await req('/state')).json();assert.equal(state.searches.length,1);assert.ok(state.items.length>0);
  const item=state.items[0];await req('/favorites',{searchId:id,itemId:item.id,favorite:true},'PUT');
  await req('/searches/'+id,{...data,enabled:false},'PUT');
  await stop();await start();
  state=await (await req('/state')).json();assert.equal(state.searches[0].enabled,false);assert.ok(state.items.some(i=>i.favorite));
  const exported=await (await req('/export')).json();assert.equal(exported.searches[0].name,'Жакеты');
  await req('/searches/'+id,{},'DELETE');state=await (await req('/state')).json();assert.equal(state.items.length,0);
  await req('/logout',{});assert.equal((await req('/state')).status,401);
 }finally{if(child&&child.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true});}
});
