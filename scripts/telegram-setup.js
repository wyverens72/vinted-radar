const token=process.env.BOT_TOKEN,url=process.env.PUBLIC_URL;
if(!token||!url?.startsWith('https://')) throw Error('Set BOT_TOKEN and HTTPS PUBLIC_URL in .env');
async function call(method,body){
 const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const d=await r.json();if(!d.ok) throw Error(d.description);console.log(`${method}: OK`);
}
await call('deleteWebhook',{drop_pending_updates:false});
await call('setMyCommands',{commands:[{command:'start',description:'Подключить уведомления'},{command:'status',description:'Статус радара'},{command:'stop',description:'Отключить уведомления'}]});
await call('setChatMenuButton',{menu_button:{type:'web_app',text:'Открыть радар',web_app:{url}}});
