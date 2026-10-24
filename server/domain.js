export function validateItems(items) {
  if(!Array.isArray(items)||items.length>5000) throw Error('Источник должен содержать массив до 5000 товаров');
  const ids=new Set();
  return items.map(i=>{
    if(!i||typeof i.id!=='string'||!i.id||i.id.length>160||ids.has(i.id)||typeof i.title!=='string'||!i.title||i.title.length>300||typeof i.brand!=='string'||i.brand.length>100||typeof i.size!=='string'||i.size.length>40||!Number.isFinite(i.price)||i.price<0||i.price>100000||i.currency!=='EUR') throw Error('Неверный формат товара или повтор ID');
    ids.add(i.id);
    if(i.url&&(typeof i.url!=='string'||i.url.length>2048||!/^https:\/\//.test(i.url)||new URL(i.url).protocol!=='https:')) throw Error('Ссылка должна быть HTTPS');
    return {id:i.id,title:i.title,brand:i.brand,size:i.size,price:i.price,currency:'EUR',url:i.url||null,kind:i.kind||'jacket',color:i.color||'sand',demo:!!i.demo};
  });
}
export function matches(search,item) {
  const words=search.query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return words.every(w=>`${item.title} ${item.brand}`.toLocaleLowerCase().includes(w))&&(!search.brand||item.brand.toLocaleLowerCase()===search.brand.toLocaleLowerCase())&&(!search.size||item.size.toLocaleLowerCase()===search.size.toLocaleLowerCase())&&item.price<=search.maxPrice;
}
export function validateSearch(input) {
  const out={};
  for(const [key,max] of [['name',80],['query',120],['brand',80],['size',30]]) {
    if(typeof input[key]!=='string'||input[key].trim().length>max) throw Error('Проверьте текстовые поля');
    out[key]=input[key].trim();
  }
  if(!out.name||(!out.query&&!out.brand)) throw Error('Укажите название и запрос или бренд');
  out.maxPrice=Number(input.maxPrice); out.intervalMinutes=Number(input.intervalMinutes);
  if(!Number.isFinite(out.maxPrice)||out.maxPrice<1||out.maxPrice>100000||![1,5,15,30,60].includes(out.intervalMinutes)||typeof input.enabled!=='boolean') throw Error('Проверьте цену и интервал');
  out.enabled=Number(input.enabled); return out;
}
