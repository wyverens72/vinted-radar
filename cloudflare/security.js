const encoder=new TextEncoder();
export const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
export const random=()=>hex(crypto.getRandomValues(new Uint8Array(24)));
export const digest=async text=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(text)));
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
async function hmac(key,text){const k=await crypto.subtle.importKey('raw',typeof key==='string'?encoder.encode(key):key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return crypto.subtle.sign('HMAC',k,encoder.encode(text));}
export async function telegramIdentity(initData,token,now=Date.now()){
 if(!token||typeof initData!=='string'||initData.length>10000)return null;
 const p=new URLSearchParams(initData),hash=p.get('hash');if(!hash||new Set(p.keys()).size!==[...p.keys()].length)return null;
 p.delete('hash');const text=[...p.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=await hmac('WebAppData',token),expected=hex(await hmac(secret,text));
 const age=now/1000-Number(p.get('auth_date'));
 try{const u=JSON.parse(p.get('user'));return equal(hash,expected)&&age>=-30&&age<3600&&Number.isSafeInteger(u.id)&&u.id>0?u:null;}catch{return null;}
}
export function cookie(request,token,maxAge=604800){return `radar=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
