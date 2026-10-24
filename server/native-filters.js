// Only public catalog filters; never accept arbitrary fetch targets or account data.
const groups=['catalog','brand_ids','size_ids','status_ids','color_ids','material_ids'];
export function nativeCatalog(value){
 if(!value)return '';
 if(typeof value!=='string'||value.length>4000)throw Error('Слишком длинная ссылка Vinted');
 const source=new URL(value);
 if(source.origin!=='https://www.vinted.pl'||source.username||source.password||!/^\/catalog(?:\/\d+(?:-[a-zA-Z0-9-]+)?)?\/?$/.test(source.pathname))throw Error('Нужна ссылка публичного каталога https://www.vinted.pl/catalog');
 const out=new URL('https://www.vinted.pl/catalog');
 const pathId=source.pathname.match(/^\/catalog\/(\d+)/)?.[1];
 if(pathId)out.searchParams.append('catalog[]',pathId);
 for(const [key] of source.searchParams){if(![...groups.flatMap(g=>[g,g+'[]']),'search_text','price_from','price_to','currency','order','page','time'].includes(key))throw Error('Ссылка содержит неподдерживаемый фильтр: '+key);}
 for(const group of groups){const ids=[...new Set([...out.searchParams.getAll(group+'[]'),...source.searchParams.getAll(group),...source.searchParams.getAll(group+'[]')])];if(ids.length>20||ids.some(id=>!/^\d{1,9}$/.test(id)||Number(id)<1))throw Error('Некорректные идентификаторы фильтра');out.searchParams.delete(group+'[]');for(const id of ids.sort((a,b)=>Number(a)-Number(b)))out.searchParams.append(group+'[]',id);}
 const query=source.searchParams.get('search_text')||'';if(query.length>120)throw Error('Запрос слишком длинный');if(query)out.searchParams.set('search_text',query);
 for(const key of ['price_from','price_to'])if(source.searchParams.has(key)){const n=Number(source.searchParams.get(key));if(!Number.isFinite(n)||n<0||n>100000)throw Error('Некорректная цена');out.searchParams.set(key,String(n));}
 if(Number(out.searchParams.get('price_from')||0)>Number(out.searchParams.get('price_to')||100000))throw Error('Минимальная цена выше максимальной');
 if(source.searchParams.has('currency')&&source.searchParams.get('currency')!=='PLN')throw Error('Для Польши нужна валюта PLN');
 const order=source.searchParams.get('order')||'newest_first';
 if(!['newest_first','relevance'].includes(order))throw Error('Выберите «Самые новые» или «Рекомендованные Vinted»');
 out.searchParams.set('currency','PLN');out.searchParams.set('order',order);return out.href;
}
