import {validateItems} from '../server/domain.js';
import {markets,photoUrl} from '../server/catalog.js';
// Normalize explicitly supplied catalog records; this module performs no network requests.
export function normalizeCatalogRows(input){
 if(!Array.isArray(input)||input.length>100)throw Error('До 100 строк в импортируемом наборе');
 const ids=new Set(),result=[];
 for(const row of input){
  if(!row||!/^\d{1,20}$/.test(String(row.itemId)))throw Error('В наборе нет корректного itemId');
  const u=new URL(row.url),country=Object.keys(markets).find(c=>[markets[c].host,markets[c].host.slice(4)].includes(u.hostname));
  const id=String(row.itemId);
  if(!country||u.protocol!=='https:'||u.username||u.password||u.port||!new RegExp('^/items/'+id+'(?:-|/|$)').test(u.pathname))throw Error('Ссылка объявления не соответствует ID или рынку');
  if(row.country&&row.country!==country)throw Error('Страна в данных и ссылке объявления не совпадает');
  if(row.currency!==markets[country].currency)throw Error('Валюта объявления не соответствует рынку');
  const key=`vinted:${country}:${id}`;if(ids.has(key))continue;ids.add(key);
  result.push({id:key,title:row.title,brand:row.brand??'',size:row.size??'',condition:row.condition??'',price:row.price,currency:row.currency,country,url:u.href,photoUrl:photoUrl(row.imageUrl),demo:false});
 }
 return validateItems(result);
}
