import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrainingDataHandler} from '../api/training-data.mjs';
const feedUrl='https://example123.execute-api.us-east-2.amazonaws.com/status';
function response(){return{headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=body}}}
test('only serves the fixed public feed and ignores caller URLs',async()=>{
 const r=response();let called;
 const handler=createTrainingDataHandler({feedUrl,fetcher:async url=>{called=url;return{ok:true,json:async()=>({schema:'trace-public-training-v1',checkpoints:[],run:{status:'running'}})}}});
 await handler({method:'GET',url:'/?url=http://private',query:{url:'http://private'}},r);
 assert.equal(called,feedUrl);assert.equal(r.statusCode,200);assert.equal(r.headers['Cache-Control'],'no-store');
});
test('refresh cannot mutate anything and HEAD omits the body',async()=>{
 const handler=createTrainingDataHandler({feedUrl,fetcher:async()=>({ok:true,json:async()=>({schema:'trace-public-training-v1',checkpoints:[],run:{}})})});
 const post=response();await handler({method:'POST'},post);assert.equal(post.statusCode,405);
 const head=response();await handler({method:'HEAD'},head);assert.equal(head.statusCode,200);assert.equal(head.body,undefined);
});
test('unconfigured, malformed and failed feeds return generic errors',async()=>{
 for(const options of [{feedUrl:'http://private'},{feedUrl,fetcher:async()=>{throw Error('SECRET')}},{feedUrl,fetcher:async()=>({ok:true,json:async()=>({})})}]){
  const r=response();await createTrainingDataHandler(options)({method:'GET'},r);assert.equal(r.statusCode,503);assert.ok(!r.body.includes('SECRET'));
 }
});
