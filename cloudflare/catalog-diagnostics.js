// Retain only bounded diagnostic metadata, never cookies, full HTML or challenge URLs.
export function retryDelay(value,now=Date.now()){
 if(!value)return 0;
 const s=value.trim();
 if(/^\d+$/.test(s)){const n=Number(s)*1000;return Number.isSafeInteger(n)?n:0;}
 const date=Date.parse(s);return Number.isFinite(date)?Math.max(0,date-now):0;
}
export async function failureDiagnostic(response,now=Date.now()){
 const headers={};
 for(const name of ['content-type','server','retry-after','cf-mitigated','cf-ray']){
  const value=response.headers.get(name);if(value)headers[name]=value.slice(0,160);
 }
 let html='';
 if(response.body){
  const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0;
  try{while(bytes<32768){const {done,value}=await reader.read();if(done)break;const part=value.subarray(0,32768-bytes);bytes+=part.byteLength;html+=decoder.decode(part,{stream:true});}html+=decoder.decode();}
  catch{/* The status and headers still help if the body is unavailable. */}
  finally{await reader.cancel().catch(()=>{});}
 }
 const labels=[];
 if(/datadome|captcha-delivery/i.test(html))labels.push('datadome');
 if(/challenge-platform|cf-chl-|cf-mitigated/i.test(html)||headers['cf-mitigated']==='challenge')labels.push('cloudflare-challenge');
 if(/captcha|verify.{0,30}human|enable javascript/i.test(html))labels.push('browser-challenge');
 if(/too many requests|rate.?limit|error\s*(?:code)?\s*:?\s*1015/i.test(html))labels.push('rate-limit');
 const plain=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').slice(0,2000).replace(/https?:\/\/[^\s"'<>]+/gi,'[URL]').replace(/[\w.+-]{1,64}@[\w.-]{1,253}\.[a-z]{2,24}/gi,'[email]').replace(/[A-Za-z0-9_+./=-]{24,}/g,'[redacted]').replace(/\s+/g,' ').trim().slice(0,400);
 return {at:now,status:response.status,headers,signals:labels,excerpt:plain};
}
