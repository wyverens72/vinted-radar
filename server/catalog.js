export const markets={pl:{currency:'PLN',symbol:'zł',host:'www.vinted.pl'},lt:{currency:'EUR',symbol:'€',host:'www.vinted.lt'}};
export const currencyLabel=c=>c==='PLN'?'zł':c==='EUR'?'€':c;
export function photoUrl(value){
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='string'||value.length>2048)throw Error('Неверная ссылка на фото');
 const u=new URL(value);
 if(u.protocol!=='https:'||!/(^|\.)vinted\.net$/i.test(u.hostname)||u.username||u.password||(u.port&&u.port!=='443'))throw Error('Фото должно быть HTTPS-ссылкой на CDN Vinted');
 return u.href;
}
export const normalized=s=>String(s??'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
export function sizeSelections(value){
 const seen=new Set();
 return String(value??'').split(',').map(v=>v.trim()).filter(v=>{const key=normalized(v);if(!key||seen.has(key))return false;seen.add(key);return true;});
}
export function marketFields(input){
 const country=input.country??'lt',market=markets[country];
 if(!market)throw Error('Поддерживаются каталоги Польши и Литвы');
 if(input.currency&&input.currency!==market.currency)throw Error('Валюта не соответствует выбранной стране');
 const minPrice=Number(input.minPrice??0),condition=input.condition??'';
 if(!Number.isFinite(minPrice)||minPrice<0||minPrice>Number(input.maxPrice)||typeof condition!=='string'||condition.length>80)throw Error('Проверьте минимальную цену и состояние');
 return {country,currency:market.currency,minPrice,condition:condition.trim()};
}
