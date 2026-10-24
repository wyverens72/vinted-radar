import { setting } from './db.js';
export function createTelegram(db,config) {
 const call=async(method,body)=>{
  if(!config.botToken) throw Error('Telegram ещё не настроен');
  let res;
  try {res=await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});}catch{throw Error('Telegram недоступен: ошибка сети');}
  const data=await res.json(); if(!data.ok) throw Error(`Telegram: ${data.description||res.status}`);return data.result;
 };
 let lastSent=0;
 const send=async text=>{
  const chat=setting(db,'chatId'); if(!chat) throw Error('Откройте бота и отправьте /start');
  const wait=1100-(Date.now()-lastSent);if(wait>0)await new Promise(r=>setTimeout(r,wait));
  lastSent=Date.now();return call('sendMessage',{chat_id:chat,text,link_preview_options:{is_disabled:true}});
 };
 let stopped=false;
 async function poll() {
  while(!stopped) {
   try {
    const updates=await call('getUpdates',{offset:Number(setting(db,'offset')||0),timeout:25,allowed_updates:['message']});
    for(const u of updates) {
     const m=u.message;
     if(m?.chat?.type==='private'&&String(m.from?.id)===config.ownerId) {
      const cmd=(m.text||'').split(/\s/)[0].split('@')[0];
      if(cmd==='/start') {
       setting(db,'chatId',m.chat.id);
       await call('sendMessage',{chat_id:m.chat.id,text:'Радар подключён ✓\nСохраняйте поиски в приложении. Пока включён демо-источник, все находки — вымышленные.',...(config.publicUrl.startsWith('https:')?{reply_markup:{inline_keyboard:[[{text:'Открыть Vinted Radar',web_app:{url:config.publicUrl}}]]}}:{})});
      } else if(cmd==='/stop') {db.prepare("DELETE FROM settings WHERE key='chatId'").run();db.prepare('DELETE FROM outbox WHERE sentAt IS NULL').run();await call('sendMessage',{chat_id:m.chat.id,text:'Уведомления отключены. /start — подключить снова.'});}
      else if(cmd==='/status') await call('sendMessage',{chat_id:m.chat.id,text:`Источник: ${config.source}\nПоисков: ${db.prepare('SELECT COUNT(*) AS n FROM searches WHERE enabled=1').get().n}\nУведомления: ${setting(db,'chatId')?'включены':'выключены'}`});
     }
     setting(db,'offset',u.update_id+1);
    }
    setting(db,'botError','');
   }catch(e){setting(db,'botError',e.message);await new Promise(r=>setTimeout(r,5000));}
  }
 }
 return {call,send,start:()=>{if(config.botToken&&config.ownerId)void poll();},stop:()=>{stopped=true;}};
}
