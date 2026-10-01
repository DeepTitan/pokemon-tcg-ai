import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { issueReferral, readReferral, REFERRAL_COOKIE } from './referrals.mjs';
import { createMembershipHandler, CHECKOUT_COOKIE, ACCESS_COOKIE } from './membership.mjs';
const secret='only-the-web-server-knows-this-fixture-proxy-key-0123456789';
const now=1800000000;
const response=()=>({headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(value){this.body=JSON.parse(value);}});
async function invoke(action,{body={},cookie='',headers={},service}={}) {
 const out=response();
 await createMembershipHandler({authSecret:secret,service:service||{configured:true,guestConfigured:true}})(
  {method:'POST',url:`/trace/api/${action}`,headers:{origin:'https://victoryroad.app','content-type':'application/json',cookie,...headers},body},out);
 return out;
}
test('referral signature pins creator and click timestamp to a 24-hour window',()=>{
 const token=issueReferral('JakePTCG',secret,now);
 assert.deepEqual(readReferral(token,secret,now+86399),{code:'jakeptcg',at:now});
 for(const [value,clock] of [[token,now+86400],[token,now-1],[token+'x',now],['forged',now]]) assert.equal(readReferral(value,secret,clock),null);
 assert.equal(readReferral(token,'different-secret-with-more-than-forty-three-characters',now),null);
 assert.throws(()=>issueReferral('someone-else',secret,now));
});
test('creator capture is same-origin, returns no proof, and writes a secure one-day cookie',async()=>{
 const out=await invoke('referrals/start',{body:{code:' JakePTCG '}});
 assert.equal(out.statusCode,200); assert.deepEqual(out.body,{recorded:true,code:'jakeptcg'});
 const cookie=out.headers['set-cookie'][0];
 assert.match(cookie,/Max-Age=86400; Secure; HttpOnly; SameSite=Lax/);
 assert.equal(readReferral(cookie.split(';')[0].split('=')[1],secret).code,'jakeptcg');
 assert.equal((await invoke('referrals/start',{body:{code:'unknown'}})).statusCode,400);
 assert.equal((await invoke('referrals/start',{body:{code:'jakeptcg'},headers:{origin:'https://other.example'}})).statusCode,403);
});
test('only the valid server cookie reaches authenticated or guest checkout; browser JSON cannot forge attribution',async()=>{
 const recorded=issueReferral('jakeptcg',secret);
 for(const authenticated of [false,true]) {
  const calls=[];
  const service={configured:true,guestConfigured:true,async call(action,options){
   calls.push({action,options});
   if(action==='account') return authenticated?{status:200,body:{email:'fixture@example.test',plan:'none',status:'none',capabilities:{recordMatches:true,recentReplayDays:7}}}:{status:401,body:{}};
   if(action==='checkout/status') return {status:200,body:{state:'none',plan:'none',expiresAt:null}};
   return {status:200,body:{url:'https://checkout.stripe.com/c/pay/cs_test_fixture'}};
  }};
  const cookies=`${REFERRAL_COOKIE}=${recorded}; ${CHECKOUT_COOKIE}=${'a'.repeat(64)}${authenticated?`; ${ACCESS_COOKIE}=valid-token`:''}`;
  const out=await invoke('checkout/guest',{body:{plan:'trace',referralToken:'forged',creator:'forged'},cookie:cookies,service});
  assert.equal(out.statusCode,200);
  const sent=calls.find(call=>['checkout','checkout/guest'].includes(call.action));
  assert.equal(sent.options.body.referralToken,recorded); assert.equal(sent.options.body.creator,undefined);
  calls.length=0;
  await invoke('checkout/guest',{body:{plan:'trace',referralToken:recorded},cookie:`${CHECKOUT_COOKIE}=${'a'.repeat(64)}`,service});
  assert.equal(calls.find(call=>['checkout','checkout/guest'].includes(call.action)).options.body.referralToken,undefined);
 }
});
test('checkout waits for referral persistence before opening Stripe and cleans the referral URL',async()=>{
 const script=readFileSync(new URL('../script.js',import.meta.url),'utf8'),calls=[];
 let click,resolveReferral,clean;
 const button={dataset:{plan:'trace'},textContent:'Get Pro',addEventListener(_e,fn){click=fn;}};
 const message={replaceChildren(){},hidden:true};
 const location={href:'https://victoryroad.app/trace?ref=jakeptcg#plans',assign(){calls.push('redirect');}};
 const context={document:{getElementById:id=>id==='year'?{}:message,querySelectorAll:()=>[button]},location,URL,Date,
  history:{state:null,replaceState(_s,_t,url){clean=url;}},navigator:{locks:{request:async(_name,fn)=>fn()}},
  fetch:async url=>{calls.push(url);if(url.endsWith('start'))return new Promise(resolve=>{resolveReferral=resolve;});return {ok:true,json:async()=>url.endsWith('prepare')?{ready:true}:{url:'https://checkout.stripe.com/c/pay/cs_test_fixture'}};}};
 vm.runInNewContext(script,context); const pending=click();
 assert.deepEqual(calls,['/trace/api/referrals/start']);
 resolveReferral({ok:true,json:async()=>({recorded:true})});await pending;
 assert.equal(clean,'/trace#plans');assert.deepEqual(calls,['/trace/api/referrals/start','/trace/api/checkout/prepare','/trace/api/checkout/guest','redirect']);
});
