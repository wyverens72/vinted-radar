import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {openDb,setting} from '../server/db.js';
import {verifyTelegram} from '../server/auth.js';
import {matches,validateSearch,validateItems} from '../server/source.js';
import {createMonitor} from '../server/monitor.js';
const s={name:'COS',query:'',brand:'COS',size:'M',maxPrice:40,intervalMinutes:5,enabled:true};
test('filters respect words, brand, size and price',()=>{
 const item={title:'Шерстяной жакет',brand:'COS',size:'M',price:38};
 assert.equal(matches(s,item),true);
 for(const patch of [{brand:'Arket'},{size:'S'},{maxPrice:20},{query:'сумка'}])assert.equal(matches({...s,...patch},item),false);
 assert.equal(matches({...s,query:'COS жакет'},item),true);
});
test('search validation rejects empty filters, invalid interval, malformed values',()=>{
 assert.deepEqual(validateSearch(s),{...s,enabled:1});
 for(const patch of [{brand:'',query:''},{intervalMinutes:2},{maxPrice:'bad'},{enabled:'false'},{name:''}])assert.throws(()=>validateSearch({...s,...patch}));
});
test('authorized source validates URL, IDs, currency',()=>{
 const item={id:'1',title:'a',brand:'b',size:'m',price:3,currency:'EUR',url:'https://example.com'};
 assert.equal(validateItems([item]).length,1);
 for(const patch of [{url:'javascript:alert(1)'},{currency:'USD'},{price:-1}])assert.throws(()=>validateItems([{...item,...patch}]));
 assert.throws(()=>validateItems([item,item]));
});
function signed(userId,date){const p=new URLSearchParams({auth_date:String(date),query_id:'q',user:JSON.stringify({id:userId})});const secret=createHmac('sha256','WebAppData').update('secret').digest();const text=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');p.set('hash',createHmac('sha256',secret).update(text).digest('hex'));return p.toString();}
test('Telegram requires valid HMAC, allowed user and fresh timestamp',()=>{
 const now=Date.now(),date=Math.floor(now/1000),data=signed(123,date);
 assert.equal(verifyTelegram(data,'secret','123',now),true);
 assert.equal(verifyTelegram(data,'wrong','123',now),false);
 assert.equal(verifyTelegram(data,'secret','456',now),false);
 assert.equal(verifyTelegram(signed(123,date-7200),'secret','123',now),false);
 assert.equal(verifyTelegram(signed(123,date+120),'secret','123',now),false);
 assert.equal(verifyTelegram(data+'&user=x','secret','123',now),false);
});
function fixture(){const db=openDb(':memory:');db.prepare('INSERT INTO searches(id,name,query,brand,size,maxPrice,intervalMinutes,enabled) VALUES(?,?,?,?,?,?,?,?)').run('s',s.name,s.query,s.brand,s.size,s.maxPrice,5,1);setting(db,'chatId','123');return db;}
test('monitor persists matches, deduplicates notifications and honors paused searches',async()=>{
 const db=fixture();const sent=[];const monitor=createMonitor(db,{source:'demo',botToken:'test'},async text=>sent.push(text));
 await monitor.run(true);assert.ok(sent.length>=2);assert.ok(sent.every(t=>t.includes('ДЕМО')));
 const n=sent.length;await monitor.run(true);assert.equal(sent.length,n);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM matches').get().n,n);
 db.prepare('UPDATE searches SET enabled=0').run();await monitor.run(true);assert.equal(sent.length,n);db.close();
});
test('failed delivery remains queued and retries instead of dropping matches',async()=>{
 const db=fixture();const monitor=createMonitor(db,{source:'demo',botToken:'test'},async()=>{throw Error('network');});
 await monitor.run(true);assert.ok(db.prepare('SELECT COUNT(*) n FROM outbox WHERE sentAt IS NULL').get().n>0);
 assert.equal(db.prepare('SELECT attempts FROM outbox ORDER BY id LIMIT 1').get().attempts,1);
 let delivered=0;db.prepare('UPDATE outbox SET nextAttempt=0').run();
 await createMonitor(db,{source:'demo',botToken:'test'},async()=>{delivered++;}).run();
 assert.ok(delivered>0);assert.equal(db.prepare('SELECT COUNT(*) n FROM outbox WHERE sentAt IS NULL').get().n,0);
 db.prepare('DELETE FROM searches').run();assert.equal(db.prepare('SELECT COUNT(*) n FROM matches').get().n,0);db.close();
});

test('Size selections use OR, ignore case, preserve composite labels and never mix numeric systems',()=>{
 const item={title:'COS',brand:'COS',size:'M / 38',price:30,currency:'EUR'};
 for(const size of ['s, m','M','38','','S, M, L'])assert.equal(matches({...s,size},item),true);
 for(const size of ['S, L','EU 38','XS'])assert.equal(matches({...s,size},item),false);
 assert.equal(matches({...s,brand:'cos',size:'m'},item),true);
 assert.equal(validateSearch({...s,size:'s, S, M'}).size,'s, M');
 assert.throws(()=>validateSearch({...s,size:Array.from({length:11},(_,i)=>'EU '+i).join(',')}));
});
