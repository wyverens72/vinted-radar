import express from 'express';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { openDb, setting } from './db.js';
import { verifyTelegram,passwordVerifier,session,digest } from './auth.js';
import { validateSearch } from './source.js';
import { createMonitor } from './monitor.js';
import { createTelegram } from './telegram.js';
const password=process.env.APP_PASSWORD;
if(!password||password.length<16||password.includes('replace-with')) throw Error('Set APP_PASSWORD to a unique secret of at least 16 characters in .env');
const config={source:process.env.DATA_SOURCE||'demo',authorized:process.env.AUTHORIZED_FEED_CONFIRMED==='true',feedPath:resolve(process.env.AUTHORIZED_FEED_PATH||'data/authorized-feed.json'),botToken:process.env.BOT_TOKEN||'',ownerId:process.env.TELEGRAM_OWNER_ID||'',publicUrl:process.env.PUBLIC_URL||'http://localhost:3000'};
if(!['demo','authorized-file'].includes(config.source)) throw Error('Unknown DATA_SOURCE');
if(config.source==='authorized-file'&&!config.authorized) throw Error('Authorized feed requires permission confirmation');
if(Boolean(config.botToken)!==Boolean(config.ownerId)) throw Error('Set both BOT_TOKEN and TELEGRAM_OWNER_ID');
const db=openDb(process.env.DATABASE_PATH||'./data/radar.sqlite');
const bot=createTelegram(db,config), monitor=createMonitor(db,config,bot.send);
const app=express(); app.disable('x-powered-by');
if(process.env.TRUST_PROXY==='1') app.set('trust proxy',1);
app.use((req,res,next)=>{
 res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"});
 if(req.path.startsWith('/api')) res.set('Cache-Control','no-store');
 next();
});
app.use(express.json({limit:'20kb'}));
const failures=new Map(), checkPassword=passwordVerifier(password);
app.get('/api/health',(_req,res)=>res.json({ok:true}));
app.use('/api',(req,res,next)=>{
 if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
  // Prevent cross-site form/cookie requests, including logout and login CSRF.
  if(req.get('X-Radar-Client')!=='1') return res.status(403).json({error:'Обновите приложение'});
  if(req.get('origin')&&req.get('origin')!==config.publicUrl&&req.get('origin')!==`http://localhost:5173`&&!(process.env.COOKIE_SECURE!=='true'&&req.get('origin')==='http://127.0.0.1:5173')) return res.status(403).json({error:'Недопустимый источник запроса'});
 }
 next();
});
app.post('/api/login',(req,res)=>{
 const key=req.ip,now=Date.now();
 const entry=failures.get(key);
 if(entry&&entry.until>now&&entry.count>=8) return res.status(429).json({error:'Слишком много попыток. Подождите 15 минут.'});
 if(failures.size>10000) for(const [k,v] of failures) if(v.until<now) failures.delete(k);
 const ok=typeof req.body.password==='string'&&req.body.password.length<=300&&checkPassword(req.body.password);
 const tg=verifyTelegram(req.body.initData,config.botToken,config.ownerId);
 if(!ok&&!tg){failures.set(key,{count:entry&&entry.until>now?entry.count+1:1,until:now+900000});return res.status(401).json({error:'Неверный пароль или доступ Telegram'});}
 failures.delete(key);
 const token=session(db);
 res.cookie('radar',token,{httpOnly:true,secure:process.env.COOKIE_SECURE==='true',sameSite:'lax',maxAge:7*86400000,path:'/'}).json({ok:true});
});
app.use('/api',(req,res,next)=>{
 const token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('radar='))?.slice(6)||'';
 const valid=token.length===64&&db.prepare('SELECT 1 FROM sessions WHERE token=? AND expires>?').get(digest(token),Date.now());
 const telegramValid=!valid&&verifyTelegram(req.get('X-Telegram-Init-Data'),config.botToken,config.ownerId);
 if(!valid&&!telegramValid) return res.status(401).json({error:'Войдите в приложение'});
 req.sessionToken=valid?digest(token):'';next();
});
app.post('/api/logout',(req,res)=>{db.prepare('DELETE FROM sessions WHERE token=?').run(req.sessionToken);res.clearCookie('radar',{path:'/'}).json({ok:true});});
app.get('/api/state',(_req,res)=>res.json({
 source:config.source,telegram:{configured:!!config.botToken,connected:!!setting(db,'chatId'),error:setting(db,'botError')||setting(db,'notificationError')||null,pending:db.prepare('SELECT COUNT(*) n FROM outbox WHERE sentAt IS NULL').get().n},
 searches:db.prepare('SELECT * FROM searches ORDER BY rowid DESC').all().map(s=>({...s,enabled:!!s.enabled})),
 items:db.prepare('SELECT m.*,s.name AS searchName FROM matches m JOIN searches s ON s.id=m.searchId ORDER BY foundAt DESC LIMIT 500').all().map(m=>({...JSON.parse(m.item),searchId:m.searchId,searchName:m.searchName,foundAt:m.foundAt,favorite:!!m.favorite}))
}));
app.post('/api/searches',(req,res)=>{
 const s=validateSearch(req.body);
 if(db.prepare('SELECT COUNT(*) n FROM searches').get().n>=50) return res.status(400).json({error:'Максимум 50 поисков'});
 const id=randomUUID();db.prepare('INSERT INTO searches(id,name,query,brand,size,maxPrice,intervalMinutes,enabled) VALUES(?,?,?,?,?,?,?,?)').run(id,s.name,s.query,s.brand,s.size,s.maxPrice,s.intervalMinutes,s.enabled);
 res.status(201).json({id});void monitor.run().catch(()=>{});
});
app.put('/api/searches/:id',(req,res)=>{
 const s=validateSearch(req.body);
 const result=db.prepare('UPDATE searches SET name=?,query=?,brand=?,size=?,maxPrice=?,intervalMinutes=?,enabled=?,nextCheck=0,error=NULL WHERE id=?').run(s.name,s.query,s.brand,s.size,s.maxPrice,s.intervalMinutes,s.enabled,req.params.id);
 if(!result.changes) return res.status(404).json({error:'Поиск не найден'});
 res.json({ok:true});
});
app.delete('/api/searches/:id',(req,res)=>{db.prepare('DELETE FROM searches WHERE id=?').run(req.params.id);res.json({ok:true});});
app.put('/api/favorites',(req,res)=>{
 const {searchId,itemId,favorite}=req.body;
 if(typeof searchId!=='string'||typeof itemId!=='string'||typeof favorite!=='boolean') return res.status(400).json({error:'Неверные данные'});
 db.prepare('UPDATE matches SET favorite=? WHERE searchId=? AND itemId=?').run(Number(favorite),searchId,itemId);res.json({ok:true});
});
let lastManual=0;
app.post('/api/check',async(_req,res)=>{
 if(Date.now()-lastManual<10000) return res.status(429).json({error:'Следующая проверка через несколько секунд'});
 lastManual=Date.now();res.json(await monitor.run(true));
});
app.post('/api/telegram/test',async(_req,res)=>{await bot.send('✓ Vinted Radar: тестовое уведомление. Связь работает.');res.json({ok:true});});
app.get('/api/export',(_req,res)=>{res.attachment('radar-searches.json').json({version:1,searches:db.prepare('SELECT name,query,brand,size,maxPrice,intervalMinutes,enabled FROM searches').all().map(s=>({...s,enabled:!!s.enabled}))});});
app.use('/api',(_req,res)=>res.status(404).json({error:'Не найдено'}));
if(existsSync('dist')) {app.use(express.static('dist',{maxAge:0}));app.get('/{*path}',(_req,res)=>res.sendFile(resolve('dist/index.html')));}
app.use((err,_req,res,_next)=>res.status(err.status||400).json({error:err.message||'Ошибка сервера'}));
const server=app.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`Vinted Radar ready on port ${process.env.PORT||3000}; source=${config.source}`));
const timer=setInterval(()=>{void monitor.run().catch(e=>console.error('Monitoring failed:',e.message));db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());},15000);
bot.start();void monitor.run().catch(e=>console.error(e.message));
function shutdown(){clearInterval(timer);bot.stop();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
