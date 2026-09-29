import test from 'node:test';
import assert from 'node:assert/strict';
import { sealAuth, openAuth, AUTH_COOKIE, authDestination } from './auth-state.mjs';
import { createMembershipHandler } from './membership.mjs';
import { googleConfig, startGoogle, finishGoogle } from './google-auth.mjs';
const secret = 'test-only-secret-'.repeat(4);
const origin = 'https://victoryroad.app';
const response = () => ({headers:{}, setHeader(k,v){this.headers[k]=v;},end(v){this.body=v;}});
async function run(action, body, cookie, service, extra = {}) {
  const out = response();
  await createMembershipHandler({origin,authSecret:secret,service:{configured:true,guestConfigured:true,call:service},...extra})({url:'/trace/api/'+action,method:'POST',headers:{origin,'content-type':'application/json',cookie},body},out);
  return out;
}
test('encrypted auth state is private, tamper resistant, bound to secret and expiring',()=>{
  const value={type:'email',challenge:{email:'player@example.test',session:'private'}};
  const sealed=sealAuth(value,secret,1000);
  assert.equal(openAuth(sealed,secret,1001).challenge.session,'private');
  assert.equal(openAuth(sealed,secret,1000+15*60000),null);
  assert.equal(openAuth(sealed,secret+'different',1001),null);
  assert.equal(openAuth('x'+sealed.slice(1),secret,1001),null);
  assert.ok(!sealed.includes('player'));
});
test('new and existing users receive identical public replies and HttpOnly state',async()=>{
  for(const kind of ['signup','signin']) {
    const out=await run('auth/email-start',{email:'Player@example.test'},'',async()=>({status:200,body:{challenge:{kind,email:'player@example.test',session:'provider-secret'}}}));
    assert.equal(out.statusCode,200);
    assert.deepEqual(JSON.parse(out.body),{codeRequired:true});
    assert.match(out.headers['Set-Cookie'][0],/Secure; HttpOnly; SameSite=Lax/);
    assert.ok(!out.body.includes(kind));
    assert.ok(!out.body.includes('provider-secret'));
  }
});
test('finish ignores client-supplied identity, preserves destination, keeps tokens out of JS',async()=>{
  const state=sealAuth({type:'email',challenge:{kind:'signin',email:'actual@example.test',session:'private'},context:{userCode:'ABCDEFGHIJ'.replace(/[0189]/g,'A'),plan:'supporter'}},secret);
  const out=await run('auth/email-finish',{code:'123456',challenge:{email:'attacker@example.test'}},`${AUTH_COOKIE}=${state}`,async(action,input)=>{
    assert.equal(input.body.challenge.email,'actual@example.test');
    return {status:200,body:{accessToken:'access.token',refreshToken:'refresh.token',expiresIn:3600}};
  });
  assert.equal(out.statusCode,200);
  assert.match(JSON.parse(out.body).next,/^\/trace\/connect\?/);
  assert.ok(!out.body.includes('token'));
  assert.equal(out.headers['Set-Cookie'].length,3);
});
test('missing browser proof or delivery error does not claim success',async()=>{
  const missing=await run('auth/email-finish',{code:'123456'},'',async()=>assert.fail());
  assert.equal(missing.statusCode,410);
  const failed=await run('auth/email-start',{email:'test@example.test'},'',async()=>({status:503,body:{error:'service_unavailable'}}));
  assert.equal(failed.statusCode,503);
  assert.equal(failed.headers['Set-Cookie'],undefined);
});
test('return context cannot redirect outside Trace',()=>{
  assert.equal(authDestination({redirect:'https://attacker.test',userCode:'evil',download:'//evil'}),'/trace/account');
});
test('Google uses code flow, PKCE and state; rejects wrong state before exchange',async()=>{
  const config=googleConfig('https://trace-test.auth.us-east-1.amazoncognito.com','1234567890client',origin);
  const {url,pending}=startGoogle(config,{plan:'trace'});
  const parsed=new URL(url);
  assert.equal(parsed.searchParams.get('code_challenge_method'),'S256');
  assert.equal(parsed.searchParams.get('response_type'),'code');
  assert.equal(googleConfig('https://attacker.test','1234567890',origin),null);
  await assert.rejects(finishGoogle(config,pending,new URLSearchParams({state:'wrong',code:'x'}),()=>assert.fail()));
  let body;
  const completed=await finishGoogle(config,pending,new URLSearchParams({state:pending.state,code:'x'}),async(_,opts)=>{body=new URLSearchParams(opts.body);return {ok:true,json:async()=>({access_token:'a',refresh_token:'r',expires_in:3600})};});
  assert.equal(body.get('code_verifier'),pending.verifier);
  assert.equal(completed.next,'/trace/account?plan=trace');
});
