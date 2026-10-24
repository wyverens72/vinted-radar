export const one=(env,sql,...args)=>env.DB.prepare(sql).bind(...args).first();
export const run=(env,sql,...args)=>env.DB.prepare(sql).bind(...args).run();
export const rows=async(env,sql,...args)=>(await env.DB.prepare(sql).bind(...args).all()).results;
export const getSetting=async(env,key)=>(await one(env,'SELECT value FROM settings WHERE key=?',key))?.value;
export const setSetting=(env,key,value)=>run(env,'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,String(value));
export async function limit(env,key,max,ms){
 const now=Date.now();
 const entry=await one(env,`INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING count`,key,now+ms,now,now);
 return entry.count<=max;
}
export async function lease(env,key,ttl=120000){
 const token=crypto.randomUUID(),now=Date.now();
 const result=await run(env,'INSERT INTO leases VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE leases.expires<=?',key,token,now+ttl,now);
 return result.meta.changes?token:null;
}
export const release=(env,key,token)=>run(env,'DELETE FROM leases WHERE key=? AND token=?',key,token);
export async function telegramUser(env,identity){
 if(!identity)return null;
 const id=String(identity.id);
 // Owner binding is configured out of band; a visitor can never claim it in a request.
 if(env.TELEGRAM_OWNER_ID&&id===String(env.TELEGRAM_OWNER_ID))await run(env,'UPDATE users SET telegramId=?,name=? WHERE id=? AND (telegramId IS NULL OR telegramId=?)',id,String(identity.first_name||'Владелец').slice(0,80),'owner',id);
 return one(env,'SELECT * FROM users WHERE telegramId=? AND enabled=1',id);
}
