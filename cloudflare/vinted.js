import {normalizeCatalogRows} from './catalog-records.js';
import {one,run,getSetting,setSetting,lease,release} from './data.js';
const MAX_BYTES=8*1024*1024,TTL=300000;
const decode=s=>String(s||'').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_,e)=>{if(e[0]==='#'){const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):Number(e.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'�';}return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[e.toLowerCase()];});
const text=s=>decode(s.replace(/<[^>]*>/g,'')).replace(/\s+/g,' ').trim();
function attrs(tag){const out={};for(const m of tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gs))out[m[1]]=decode(m[3]);return out;}
export function catalogUrl(search){
 if(search.country!=='pl')throw Error('Публичный сборщик сейчас поддерживает Польшу. Выберите Польшу и бюджет в zł в настройках поиска.');
 const u=new URL('https://www.vinted.pl/catalog');
 u.searchParams.set('search_text',[search.query,search.brand].filter(Boolean).join(' ').trim());
 u.searchParams.set('order','newest_first');u.searchParams.set('price_from',String(search.minPrice||0));u.searchParams.set('price_to',String(search.maxPrice));u.searchParams.set('currency','PLN');
 return u.href;
}
export function parseCatalog(html){
 if(/data-testid="search-empty-state"/.test(html))return [];
 const cards=[...html.matchAll(/<div\b[^>]*data-testid="product-item-id-(\d+)"[^>]*>/g)];
 if(!cards.length){
  throw Error('Vinted не вернул распознаваемые карточки. Сбор остановлен: возможна проверка доступа или смена формата страницы.');
 }
 const records=[];
 for(let n=0;n<Math.min(cards.length,100);n++){
  const id=cards[n][1],block=html.slice(cards[n].index,cards[n+1]?.index??Math.min(html.length,cards[n].index+50000));
  const link=block.match(new RegExp('<a\\b[^>]*data-testid="product-item-id-'+id+'--overlay-link"[^>]*>'));
  const image=block.match(new RegExp('<img\\b[^>]*data-testid="product-item-id-'+id+'--image--img"[^>]*>'));
  const price=block.match(new RegExp('<p\\b[^>]*data-testid="product-item-id-'+id+'--price-text"[^>]*>([\\s\\S]*?)</p>'));
  if(!link||!price)throw Error('Изменился формат карточки Vinted. Неполная выдача не сохранена.');
  const a=attrs(link[0]),label=a.title||'',p=text(price[1]);
  // Observed public Polish card labels; title is everything before the first metadata label.
  const title=label.split(/, (?:Marka|Stan|Rozmiar): /)[0].trim();
  const field=name=>label.match(new RegExp('(?:^|, )'+name+': (.*?)(?=, (?:Marka|Stan|Rozmiar): |, \\d[\\d .,\\u00a0]*zł|$)'))?.[1]?.trim()||'';
  if(!/^[\d\s.,]+\s*zł$/.test(p))throw Error('Не удалось определить цену в PLN');
  const amount=Number(p.replace(/\s|zł/g,'').replace(',','.'));
  const url=new URL(a.href,'https://www.vinted.pl');url.search='';url.hash='';
  records.push({itemId:id,url:url.href,title,brand:field('Marka'),size:field('Rozmiar'),condition:field('Stan'),price:amount,currency:'PLN',country:'pl',imageUrl:image?attrs(image[0]).src:null});
 }
 return normalizeCatalogRows(records);
}
export async function fetchCatalog(url,fetcher=fetch){
 // Re-validate even internally generated URLs. No arbitrary URLs, credentials, cookies or redirects.
 const u=new URL(url);if(u.origin!=='https://www.vinted.pl'||u.pathname!=='/catalog'||u.username||u.password)throw Error('Недопустимый адрес каталога');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const r=await fetcher(u.href,{headers:{Accept:'text/html','User-Agent':'VintedRadar/1.0 (public catalog monitor)'},redirect:'manual',signal:controller.signal});
  if(!r.ok){const e=Error(`Vinted вернул HTTP ${r.status}. Повторные запросы временно приостановлены.`);e.blocked=[401,403,429].includes(r.status);const retry=r.headers.get('retry-after');e.retryAfter=retry?Math.max(Number(retry)*1000||0,Date.parse(retry)-Date.now()||0):0;throw e;}
  if(!r.headers.get('content-type')?.includes('text/html'))throw Error('Vinted вернул ответ в неизвестном формате');
  if(Number(r.headers.get('content-length')||0)>MAX_BYTES)throw Error('Страница Vinted превышает допустимый размер');
  if(!r.body)throw Error('Пустой ответ Vinted');
  const reader=r.body.getReader(),decoder=new TextDecoder();let size=0,html='';
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw Error('Страница Vinted превышает допустимый размер');html+=decoder.decode(value,{stream:true});}html+=decoder.decode();}
  finally{await reader.cancel().catch(()=>{});}
  try{return parseCatalog(html);}catch(e){e.blocked=true;throw e;}
 }catch(e){if(e.name==='AbortError')throw Error('Vinted не ответил за 15 секунд');throw e;}
 finally{clearTimeout(timer);}
}
export async function readCatalog(env,search){
 const url=catalogUrl(search),now=Date.now();
 const cached=await one(env,'SELECT * FROM catalog_cache WHERE url=?',url);
 if(cached&&cached.fetchedAt>now-TTL)return JSON.parse(cached.items);
 if(Number(await getSetting(env,'vintedBlockedUntil')||0)>now)throw Error('Vinted временно приостановлен после отказа доступа. Следующая попытка — не раньше чем через час после отказа.');
 const key='catalog:'+url,token=await lease(env,key,30000);if(!token)throw Error('Этот каталог уже проверяется. Попробуйте позже.');
 try{
  const items=await fetchCatalog(url);
  await run(env,'INSERT INTO catalog_cache(url,items,fetchedAt) VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET items=excluded.items,fetchedAt=excluded.fetchedAt',url,JSON.stringify(items),now);
  await setSetting(env,'vintedLastSuccess',Date.now());await setSetting(env,'vintedLastError','');
  return items;
 }catch(e){await setSetting(env,'vintedLastError',String(e.message).slice(0,300));if(e.blocked)await setSetting(env,'vintedBlockedUntil',now+Math.max(3600000,e.retryAfter||0));throw e;}
 finally{await release(env,key,token);}
}
// Changing filters starts a fresh baseline rather than flooding the chat with old inventory.
export const catalogSearchKey=s=>JSON.stringify([s.country,s.currency,s.query,s.brand,s.size,s.condition,s.minPrice,s.maxPrice]);
