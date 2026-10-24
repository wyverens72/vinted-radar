import { createHmac, timingSafeEqual, scryptSync, randomBytes, createHash } from 'node:crypto';
export const digest=t=>createHash('sha256').update(t).digest('hex');
export function same(a,b) {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function verifyTelegram(initData,token,owner,now=Date.now()) {
  if(!token||!owner||typeof initData!=='string'||initData.length>10000) return false;
  const p=new URLSearchParams(initData), hash=p.get('hash');
  if(!hash||new Set(p.keys()).size!==[...p.keys()].length) return false;
  p.delete('hash');
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  const check=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const expected=createHmac('sha256',secret).update(check).digest('hex');
  const age=now/1000-Number(p.get('auth_date'));
  try {return same(hash,expected)&&age>=-30&&age<3600&&String(JSON.parse(p.get('user')).id)===String(owner);}catch{return false;}
}
export function passwordVerifier(password) { const salt=randomBytes(16); const hash=scryptSync(password,salt,32); return input=>timingSafeEqual(scryptSync(input,salt,32),hash); }
export function session(db) {
  const token=randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?)').run(digest(token),Date.now()+7*86400000);
  return token;
}
