import test from 'node:test';
import assert from 'node:assert/strict';
import {loginCodeFromLink} from '../web/src/login-link.js';
test('Safari fallback extracts only same-site one-use link credentials',()=>{
 const origin='https://app.vinted-radar.workers.dev',token='a'.repeat(48);
 assert.equal(loginCodeFromLink(origin+'/#login='+token,origin),token);assert.equal(loginCodeFromLink(' '+token+' ',origin),token);
 for(const value of ['https://evil.example/#login='+token,origin+'/#login=short',origin+'/?login='+token,origin+'/#login='+token+'&login='+token,'https://user:pass@app.vinted-radar.workers.dev/#login='+token])assert.throws(()=>loginCodeFromLink(value,origin));
});
