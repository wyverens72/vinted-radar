import React,{useEffect,useRef,useState,useId} from 'react';
import {createPortal} from 'react-dom';
import {normalized,sizeSelections} from '../../server/catalog.js';
export function FilterPicker({kind,value,options,onChange}){
 const multi=kind==='size',title=multi?'Размеры':'Бренд',id=useId();
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[draft,setDraft]=useState([]),[error,setError]=useState('');
 const panel=useRef(null),trigger=useRef(null);
 useEffect(()=>{
  if(!open)return;const previous=document.activeElement;panel.current?.querySelector('input')?.focus();
  function keys(e){
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);}
   if(e.key==='Tab'){
    const nodes=[...panel.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')];const first=nodes[0],last=nodes.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
   }
  }
  const el=panel.current;el?.addEventListener('keydown',keys);
  return()=>{el?.removeEventListener('keydown',keys);previous?.focus();};
 },[open]);
 const chosen=multi?sizeSelections(value):(value?[value]:[]);
 const all=[];const seen=new Set();
 for(const v of [...options,...chosen,...draft]){const key=normalized(v);if(key&&!seen.has(key)){seen.add(key);all.push(v);}}
 const filtered=all.filter(v=>normalized(v).includes(normalized(query)));
 function toggle(v){setError('');if(!multi){setDraft([v]);return;}if(draft.some(s=>normalized(s)===normalized(v))){setDraft(draft.filter(s=>normalized(s)!==normalized(v)));return;}if(draft.length>=10){setError('Можно выбрать до 10 размеров');return;}setDraft([...draft,v]);}
 function start(){setDraft(chosen);setQuery('');setError('');setOpen(true);}
 const canAdd=query.trim()&&!all.some(v=>normalized(v)===normalized(query))&&(!multi||!query.includes(','));
 return <div className="filter-field"><span id={id+'-label'}>{title}</span><button ref={trigger} type="button" className="filter-trigger" aria-labelledby={id+'-label'} aria-haspopup="dialog" aria-expanded={open} onClick={start}><span>{chosen.length?chosen.join(', '):multi?'Все размеры':'Любой бренд'}</span><span aria-hidden="true">⌄</span></button>
 {open&&createPortal(<div className="picker-overlay" onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}><section ref={panel} className="picker-panel" role="dialog" aria-modal="true" aria-labelledby={id+'-title'}><div className="picker-heading"><h2 id={id+'-title'}>{title}</h2><button type="button" aria-label="Закрыть выбор" onClick={()=>setOpen(false)}>×</button></div><p>{multi?'Можно отметить несколько: подойдёт любой из выбранных размеров. Числовые размеры разных систем не переводятся автоматически.':'Подсказки из ваших находок и поисков. Это не полный справочник Vinted. Если нужного бренда нет, введите его название.'}</p><input aria-label={multi?'Найти или добавить размер':'Найти или добавить бренд'} maxLength={multi?40:80} placeholder={multi?'Например: S или EU 38':'Например: COS'} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(canAdd){toggle(multi?query.trim().toUpperCase():query.trim());setQuery('');}}}}/><button type="button" className="picker-any" aria-pressed={!draft.length} onClick={()=>setDraft([])}>{!draft.length?'✓ ':''}{multi?'Все размеры':'Любой бренд'}</button><div className="picker-options">{filtered.map(v=><label className="picker-option" key={normalized(v)}><input type={multi?'checkbox':'radio'} name={id} checked={draft.some(s=>normalized(s)===normalized(v))} onChange={()=>toggle(v)}/><span>{v}</span></label>)}{canAdd&&<button type="button" onClick={()=>{toggle(multi?query.trim().toUpperCase():query.trim());setQuery('');}}>Добавить «{query.trim()}»</button>}{!filtered.length&&!canAdd&&<p>Нет подходящих вариантов</p>}</div>{error&&<p role="alert" className="error">{error}</p>}<div className="picker-footer"><span>{multi?`Выбрано: ${draft.length||'все'}`:draft[0]||'Любой бренд'}</span><button type="button" className="primary" onClick={()=>{const result=multi?draft.join(', '):(draft[0]||'');if(result.length>(multi?160:80)){setError('Слишком длинный список размеров');return;}onChange(result);setOpen(false);}}>Применить</button></div></section></div>,document.body)}
 </div>;
}
