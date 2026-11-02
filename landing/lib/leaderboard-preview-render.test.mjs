import assert from 'node:assert/strict';
import test from 'node:test';
import { leaderboardPreviewSvg } from './leaderboard-preview-render.mjs';
test('profile share image includes rated client-close history and its Trace points', () => {
 const snapshot={generatedAt:'2026-11-02T08:00:00Z',players:[{id:'a',name:'Alice',traceStatus:'trace-user'},{id:'b',name:'Bob'}],matches:[],
  clientExitMatches:[{id:'exit',playedAt:'2026-10-30T12:00:00Z',playerIds:['a','b'],confirmed:false,resultReason:'local-client-closed',outcome:{type:'win',winnerId:'b'},liveRatings:{a:1500,b:1500}}]};
 const svg=leaderboardPreviewSvg(snapshot,'a');
 assert.match(svg,/Client closed/);assert.match(svg,/Bob/);assert.match(svg,/−16\.0/);assert.match(svg,/0W.*1L/);assert.match(svg,/1,484/);
 assert.equal((svg.match(/Client closed/g)||[]).length,1);
});
