import { getItems, matches } from './source.js';
import { setting } from './db.js';
export function createMonitor(db,config,send) {
 let busy=false;
 async function run(force=false) {
  if(busy) return {busy:true}; busy=true;
  let found=0;
  try {
   const now=Date.now();
   const searches=db.prepare('SELECT * FROM searches WHERE enabled=1 AND (? OR nextCheck<=?)').all(Number(force),now);
   if(searches.length) {
    let items;
    try {items=await getItems(config,now);} catch(e) {
      for(const s of searches) db.prepare('UPDATE searches SET error=?,nextCheck=? WHERE id=?').run(e.message,now+60000,s.id);
      items=null;
    }
    for(const s of items?searches:[]) {
     db.exec('BEGIN');
     try {
      for(const i of items.filter(i=>matches(s,i))) {
       const fresh=db.prepare('INSERT OR IGNORE INTO matches(searchId,itemId,item,foundAt) VALUES(?,?,?,?)').run(s.id,i.id,JSON.stringify(i),now).changes;
       if(fresh) {
        found++;
        const text=`${i.demo?'🧪 ДЕМО · ':''}Новая находка: ${s.name}\n${i.title}\n${i.brand} · ${i.size} · ${i.price} €${i.url?'\n'+i.url:''}`;
        // Queue only when Telegram is linked. Browser-only matches remain available in the app.
        if(config.botToken&&setting(db,'chatId')) db.prepare('INSERT OR IGNORE INTO outbox(searchId,itemId,text) VALUES(?,?,?)').run(s.id,i.id,text);
       }
      }
      db.prepare('UPDATE searches SET lastChecked=?,nextCheck=?,error=NULL WHERE id=?').run(now,now+s.intervalMinutes*60000,s.id);
      db.exec('COMMIT');
     }catch(e){db.exec('ROLLBACK');throw e;}
    }
   }
   const pending=db.prepare('SELECT * FROM outbox WHERE sentAt IS NULL AND nextAttempt<=? ORDER BY id LIMIT 20').all(Date.now());
   for(const job of pending) {
    try {
     await send(job.text);
     db.prepare('UPDATE outbox SET sentAt=? WHERE id=?').run(Date.now(),job.id);
     setting(db,'notificationError','');
    }catch(e){
     db.prepare('UPDATE outbox SET attempts=attempts+1,nextAttempt=? WHERE id=?').run(Date.now()+Math.min(3600000,30000*2**Math.min(job.attempts,7)),job.id);
     setting(db,'notificationError',e.message); break;
    }
   }
   const sourceError=db.prepare('SELECT error FROM searches WHERE enabled=1 AND error IS NOT NULL LIMIT 1').get()?.error;
   return {found,...(sourceError?{error:sourceError}:{})};
  }finally{busy=false;}
 }
 return {run};
}
