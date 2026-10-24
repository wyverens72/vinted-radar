import { readFile } from 'node:fs/promises';
const examples=[['COS','Шерстяной жакет','M',38,'jacket','sand'],['Arket','Рубашка из хлопка','S',24,'shirt','sage'],['Ganni','Платье в клетку','M',55,'dress','rose'],['COS','Кожаная сумка','One size',65,'bag','ink'],['Arket','Вязаный кардиган','M',32,'knit','cream'],['Levi’s','Джинсы 501','S',29,'jeans','blue']];
import { validateItems } from './domain.js';
export { validateItems, matches, validateSearch } from './domain.js';
export async function getItems(config,now=Date.now()) {
  if(config.source==='demo') {
    const batch=Math.floor(now/300000);
    return [batch-1,batch].flatMap((b)=>examples.map(([brand,title,size,price,kind,color],n)=>({id:`demo-${b}-${n}`,brand,title,size,price,currency:'EUR',url:null,kind,color,demo:true})));
  }
  if(config.source!=='authorized-file'||!config.authorized) throw Error('Для источника нужно подтверждённое разрешение');
  return validateItems(JSON.parse(await readFile(config.feedPath,'utf8'))).map(i=>({...i,demo:false}));
}
