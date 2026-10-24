import {digest,random} from './security.js';
import {one,run,telegramUser,limit} from './data.js';
import {telegramCall} from './monitor.js';
export async function newLoginCode(env,userId){
 const token=random();await run(env,'INSERT INTO login_codes VALUES(?,?,?)',await digest(token),userId,Date.now()+300000);return token;
}
export async function acceptInvite(env,rawToken,identity){
 if(!identity||!/^\d+$/.test(String(identity.id))||typeof rawToken!=='string'||rawToken.length!==48)return null;
 if(String(identity.id)===String(env.TELEGRAM_OWNER_ID))return null;
 const token=await digest(rawToken),id=String(identity.id),now=Date.now(),userId='tg:'+id;
 // Atomic batch: a token can create at most one user's record, and then becomes unusable.
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO users(id,telegramId,name,role,createdAt) SELECT ?,?,?,'member',? FROM invites WHERE token=? AND usedBy IS NULL AND revoked=0 AND expires>? AND (SELECT count(*) FROM users)<10 ON CONFLICT(telegramId) DO NOTHING`).bind(userId,id,String(identity.first_name||'Друг').slice(0,80),now,token,now),
  env.DB.prepare(`UPDATE invites SET usedBy=? WHERE token=? AND usedBy IS NULL AND revoked=0 AND expires>? AND EXISTS(SELECT 1 FROM users WHERE id=? AND createdAt=?)`).bind(userId,token,now,userId,now)
 ]);
 const used=await one(env,'SELECT usedBy FROM invites WHERE token=?',token);
 return used?.usedBy===userId?one(env,'SELECT * FROM users WHERE id=? AND enabled=1',userId):null;
}
// Registration is reachable only from the authenticated Telegram webhook and private /start.
export async function registerTelegram(env,identity){
 if(env.PUBLIC_REGISTRATION!=='true'||!Number.isSafeInteger(identity?.id)||identity.id<=0)return null;
 const telegramId=String(identity.id);
 const existing=await one(env,'SELECT * FROM users WHERE telegramId=?',telegramId);
 if(existing)return existing.enabled?existing:null;
 if(!await limit(env,'registration:global',20,3600000))return null;
 await run(env,`INSERT INTO users(id,telegramId,name,role,createdAt) SELECT ?,?,?,'member',? WHERE (SELECT count(*) FROM users)<10 ON CONFLICT(telegramId) DO NOTHING`,'tg:'+telegramId,telegramId,String(identity.first_name||'Пользователь').slice(0,80),Date.now());
 return one(env,'SELECT * FROM users WHERE telegramId=? AND enabled=1',telegramId);
}
export async function handleUpdate(env,update){
 const m=update.message;if(!m||m.chat?.type!=='private'||!Number.isSafeInteger(m.from?.id)||m.from.id!==m.chat.id)return;
 const [raw='',payload='']=(m.text||'').trim().split(/\s+/),cmd=raw.split('@')[0];
 let user=await telegramUser(env,m.from);
 if(!user&&cmd==='/start'&&payload.startsWith('invite_'))user=await acceptInvite(env,payload.slice(7),m.from);
 if(!user&&cmd==='/start'&&!payload.startsWith('invite_'))user=await registerTelegram(env,m.from);
 if(!user){
  if(cmd==='/start')await telegramCall(env,'sendMessage',{chat_id:m.chat.id,text:env.PUBLIC_REGISTRATION==='true'?'Регистрация сейчас недоступна: достигнут лимит участников или доступ отключён. Обратитесь к владельцу.':`Для входа нужно приглашение владельца. Ваш Telegram ID: ${m.from.id}.`});
  return;
 }
 const chatId=String(m.chat.id);
 if(cmd==='/start'){
  await run(env,'UPDATE users SET chatId=?,notifications=1,notificationError=NULL WHERE id=?',chatId,user.id);
  const loginToken=await newLoginCode(env,user.id);
  await telegramCall(env,'sendMessage',{chat_id:chatId,text:'Ваш личный радар подключён ✓\nАккаунт создан через Telegram. Ваши поиски и избранное доступны только вам. Новые находки будут приходить сюда.\nОткрыть приложение — внутри Telegram. Войти на сайт — в браузере (ссылка на 5 минут). Не пересылайте ссылку входа. /stop — отключить уведомления.'+(env.DATA_SOURCE==='demo'?'\nСейчас включены демонстрационные товары.':''),reply_markup:{inline_keyboard:[[{text:'Открыть мой радар',web_app:{url:env.PUBLIC_URL}}],[{text:'Войти на сайт',url:env.PUBLIC_URL+'/#login='+loginToken}]]}});
 }else if(cmd==='/login'){
  const token=await newLoginCode(env,user.id);
  await telegramCall(env,'sendMessage',{chat_id:chatId,text:'Вход в браузере. Ссылка действует 5 минут и используется один раз. Откройте её самостоятельно; не пересылайте.',reply_markup:{inline_keyboard:[[{text:'Войти на сайт',url:env.PUBLIC_URL+'/#login='+token}]]}});
 }else if(cmd==='/stop'){
  await env.DB.batch([env.DB.prepare('UPDATE users SET notifications=0 WHERE id=?').bind(user.id),env.DB.prepare('DELETE FROM outbox WHERE sentAt IS NULL AND searchId IN (SELECT id FROM searches WHERE userId=?)').bind(user.id)]);
  await telegramCall(env,'sendMessage',{chat_id:chatId,text:'Уведомления выключены. Поиски продолжают работать. /start — включить снова.'});
 }else if(cmd==='/status'){
  const count=await one(env,'SELECT count(*) n FROM searches WHERE userId=? AND enabled=1',user.id);
  await telegramCall(env,'sendMessage',{chat_id:chatId,text:`Активных поисков: ${count.n}\nУведомления: ${user.notifications?'включены':'выключены'}\nИсточник: ${env.DATA_SOURCE||'demo'}\n/login — вход в браузере`});
 }
}
export async function webhook(request,env){
 const update=await request.json();
 if(!Number.isSafeInteger(update.update_id))return new Response('Bad update',{status:400});
 const now=Date.now();
 const claim=await run(env,`INSERT INTO updates VALUES(?,'working',?,?) ON CONFLICT(id) DO UPDATE SET leaseUntil=excluded.leaseUntil WHERE updates.status!='done' AND updates.leaseUntil<=?`,update.update_id,now+30000,now,now);
 if(!claim.meta.changes){const previous=await one(env,'SELECT status FROM updates WHERE id=?',update.update_id);return new Response(previous?.status==='done'?'OK':'Retry',{status:previous?.status==='done'?200:503});}
 try{await handleUpdate(env,update);await run(env,"UPDATE updates SET status='done' WHERE id=?",update.update_id);return new Response('OK');}
 catch{await run(env,'UPDATE updates SET leaseUntil=0 WHERE id=?',update.update_id);return new Response('Retry',{status:503});}
}
