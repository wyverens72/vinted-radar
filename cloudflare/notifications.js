import {currencyLabel} from '../server/catalog.js';
export function notificationFor(search,item){
 const caption=[search.name,item.title,`${item.brand||'Бренд не указан'} · ${item.size||'Размер не указан'}`,`${item.price} ${currencyLabel(item.currency)}`,item.condition].filter(Boolean).join('\n').slice(0,900).replace(/[\uD800-\uDBFF]$/,'');
 const text=caption+(item.url?'\n'+item.url:'');
 const reply_markup=item.url?{inline_keyboard:[[{text:'Открыть на Vinted ↗',url:item.url}]]}:undefined;
 return {fallbackText:text,payload:item.photoUrl?{method:'sendPhoto',photo:item.photoUrl,caption,reply_markup,fallbackText:text}:{method:'sendMessage',text,reply_markup,link_preview_options:{is_disabled:true}}};
}
export async function sendNotification(env,job,call){
 if(!job.payload)return call(env,'sendMessage',{chat_id:job.chatId,text:job.text,link_preview_options:{is_disabled:true}});
 const {method,fallbackText,...fields}=JSON.parse(job.payload);
 if(!['sendPhoto','sendMessage'].includes(method))throw Error('Неизвестный формат уведомления');
 try{return await call(env,method,{...fields,chat_id:job.chatId});}
 catch(e){
  if(method==='sendPhoto'&&e.errorCode===400&&/photo|image|media|file|url|HTTP/i.test(e.message))return call(env,'sendMessage',{chat_id:job.chatId,text:fallbackText||job.text,reply_markup:fields.reply_markup,link_preview_options:{is_disabled:true}});
  throw e;
 }
}
