import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeaderboardPreviewHandler } from '../api/leaderboard-preview.mjs';
import { leaderboardPreviewVersion, leaderboardPreviewUrl } from './leaderboard-preview-version.mjs';

const initial = { schema:'trace-leaderboard/v1', generatedAt:'2026-09-16T12:00:00Z', sourceLabel:'Trace matches',
  players:[{id:'alice',name:'Alice & friends',traceStatus:'trace-user'}], matches:[] };
function response() { return {statusCode:0,headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=value;},end(body){this.body=body;}}; }
async function call(handler, input={}) { const res=response(); await handler({method:'GET',url:'/',...input},res); return res; }

test('a warm preview follows changed feed data even with an old image revision in the URL', async () => {
  const snapshot=structuredClone(initial); let renders=0;
  const handler=createLeaderboardPreviewHandler({readFeed:async()=>({snapshot}),render:async(s,id)=>{
    renders++; return Buffer.from(JSON.stringify({player:id,count:s.matches.length}));
  }});
  const first=await call(handler,{query:{player:'alice',v:'old-version'}});
  const cached=await call(handler,{query:{player:'Alice & friends',v:'different-version'}});
  assert.equal(first.statusCode,200); assert.deepEqual(cached.body,first.body); assert.equal(renders,1);
  snapshot.matches.push({id:'new-match'});
  const latest=await call(handler,{query:{player:'alice',v:'old-version'},headers:{'if-none-match':first.headers.etag}});
  assert.equal(latest.statusCode,200); assert.notEqual(latest.headers.etag,first.headers.etag);
  assert.notEqual(latest.headers['x-trace-preview-version'],first.headers['x-trace-preview-version']);
  assert.notDeepEqual(latest.body,first.body); assert.equal(renders,2);
  for(const key of ['cache-control','cdn-cache-control','vercel-cdn-cache-control']) assert.equal(latest.headers[key],'no-store');
  assert.equal(latest.headers['content-type'],'image/png');
  const unchanged=await call(handler,{query:{player:'alice'},headers:{'if-none-match':latest.headers.etag}});
  assert.equal(unchanged.statusCode,304); assert.equal(unchanged.body,undefined);
  const head=await call(handler,{method:'HEAD',query:{player:'alice'}});
  assert.equal(head.statusCode,200); assert.equal(head.body,undefined);
  assert.equal(head.headers['content-length'],String(latest.body.length));
});

test('new and unregistered players get their own preview without a screenshot manifest', async () => {
  const snapshot=structuredClone(initial);
  const handler=createLeaderboardPreviewHandler({readFeed:async()=>({snapshot}),render:async(s,id)=>Buffer.from(id??'board')});
  assert.equal((await call(handler,{query:{player:'new-id'}})).statusCode,404);
  snapshot.players.push({id:'new-id',name:'__proto__',traceStatus:'opponent-only'});
  assert.equal((await call(handler,{url:'/api/leaderboard-preview?player=__proto__'})).body.toString(),'new-id');
  assert.equal((await call(handler)).body.toString(),'board');
  for(const player of ['',null,['alice','new-id'],'<script>']) {
    const result=await call(handler,{query:{player}}); assert.equal(result.statusCode,404); assert.equal(result.headers['cache-control'],'no-store');
  }
  assert.equal((await call(handler,{url:'/?player=alice&player=new-id'})).statusCode,404);
});

test('concurrent identical renders coalesce, failures retry, and feed failures never serve stale images', async () => {
  let renders=0, unavailable=false, failOnce=true;
  const handler=createLeaderboardPreviewHandler({readFeed:async()=>{if(unavailable)throw Error('secret');return {snapshot:initial};},render:async()=>{
    renders++; await new Promise(resolve=>setTimeout(resolve,5)); if(failOnce){failOnce=false;throw Error('private file path');}return Buffer.from('png');
  }});
  const failed=await call(handler); assert.equal(failed.statusCode,503); assert.doesNotMatch(failed.body,/private/);
  const [a,b]=await Promise.all([call(handler),call(handler)]);
  assert.equal(a.statusCode,200); assert.deepEqual(a.body,b.body); assert.equal(renders,2);
  unavailable=true; const fail=await call(handler); assert.equal(fail.statusCode,503); assert.equal(fail.headers['retry-after'],'15'); assert.doesNotMatch(fail.body,/secret/);
  const post=await call(handler,{method:'POST'}); assert.equal(post.statusCode,405);assert.equal(post.headers.allow,'GET, HEAD');
});

test('preview URLs change for actual content changes but not timestamp-only rebuilds', () => {
  const before=leaderboardPreviewVersion(initial);
  assert.equal(leaderboardPreviewVersion({...initial,generatedAt:'2026-09-17T00:00:00Z'}),before);
  const changed=structuredClone(initial); changed.players[0].name='New display name';
  assert.notEqual(leaderboardPreviewVersion(changed),before);
  const url=new URL(leaderboardPreviewUrl(initial,'alice / ?#'));
  assert.equal(url.pathname,'/trace/leaderboard-preview.png');assert.equal(url.searchParams.get('player'),'alice / ?#');
  assert.equal(url.searchParams.get('v'),before); assert.equal(url.origin,'https://victoryroad.app');
});

test('a display name cannot shadow the player ID encoded in social image URLs', async () => {
  const snapshot={...initial,players:[{id:'name-a',name:'name-b'},{id:'name-b',name:'Bob'}]};
  const handler=createLeaderboardPreviewHandler({readFeed:async()=>({snapshot}),render:async(s,id)=>Buffer.from(id)});
  const result=await call(handler,{query:{player:'name-b'}});
  assert.equal(result.statusCode,200);assert.equal(result.body.toString(),'name-b');
});
