import assert from 'node:assert/strict';
import { replayEloRatings, type LiveEloEvent } from '../legacy-elo.js';
import { LiveRefreshTracker } from '../live-refresh.js';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const game=(id:string,day:number,a=1700,b=1700,after=1712,seasonId='s1'):LiveEloEvent=>({
 id,playedAt:new Date(Date.UTC(2026,0,day)).toISOString(),playerIds:['a','b'],confirmed:true,
 outcome:{type:'win',winnerId:'a'},liveRatings:{a,b},liveRatingsAfter:{a:after},seasonId});
const opts={livePriorWeight:.5,liveRefreshStrength:.5};
const first=game('first',1), second=game('next',2,1812,1700,1824);
const replay=replayEloRatings([first,second],[],opts);
const update=replay.updates.find(u=>u.playerId==='a'&&u.matchId==='next')!;
close(update.liveRefresh!.unexplainedLiveChange!,100);
close(update.liveRefresh!.adjustment,25);
// Recorded +12 must not be counted as outside play.
const continuous=replayEloRatings([first,game('next',2,1712,1700,1724)],[],opts);
close(continuous.updates.find(u=>u.playerId==='a'&&u.matchId==='next')!.liveRefresh!.adjustment,0);
for(const row of replay.rows){const us=replay.updates.filter(u=>u.playerId===row.playerId);
 close(1500+us.reduce((s,u)=>s+u.adjustment+(u.calibration?.adjustment??0)+(u.liveRefresh?.adjustment??0),0),row.rating);
 assert.ok(us.every(u=>Math.abs(u.adjustment)<=32));}
// A game's own post-score can only affect subsequent games.
assert.deepEqual(replayEloRatings([first],[],opts).updates,replayEloRatings([{...first,liveRatingsAfter:{a:9999}}],[],opts).updates);
assert.deepEqual(replayEloRatings([first,second],[],{...opts,asOf:first.playedAt}).updates,replayEloRatings([first],[],opts).updates);
assert.deepEqual(replayEloRatings([first,first,second],[],opts).updates,replay.updates);
// Unknown overlap must not be silently treated as missing play.
const unknown=replayEloRatings([{...first,liveRatingsAfter:undefined},second],[],opts);
assert.equal(unknown.updates.find(u=>u.playerId==='a'&&u.matchId==='next')!.liveRefresh!.status,'overlap-unknown');
// Labelled and suspicious unlabelled resets quarantine the measurement, not skill.
for(const reset of [game('next',2,1500,1500,1512),game('next',2,1700,1700,1712,'s2')]){
 const r=replayEloRatings([first,reset],[],opts);
 const u=r.updates.find(u=>u.playerId==='a'&&u.matchId==='next')!;
 assert.equal(u.liveRefresh!.status,'reset-held');close(u.liveRefresh!.adjustment,0);
 close(u.before.rating,replay.updates.find(u=>u.playerId==='a'&&u.matchId==='first')!.after.rating);
}
const held=replayEloRatings([first,game('reset',2,1500,1500,1512),game('climb',3,1700,1700,1712)],[],opts);
assert.equal(held.updates.find(u=>u.playerId==='a'&&u.matchId==='climb')!.liveRefresh!.status,'reset-held','A post-reset climb must not automatically add skill');
const tracker=new LiveRefreshTracker(1,true);
tracker.complete('a',1700,1700,undefined,1,'s1',1);
assert.equal(tracker.refresh('a',1800,1600,'s1',undefined,2,.5).status,'overlap-unknown','No estimated reference before enough earlier examples');
for(let i=0;i<10;i++)tracker.learn(1700,1700,1713,1,'s1');
tracker.complete('a',1700,1700,undefined,1,'s1',3);
const estimated=tracker.refresh('a',1753,1600,'s1',undefined,4,.5);
close(estimated.reference!,1713);close(estimated.adjustment,10);assert.equal(estimated.reliability,.5);
tracker.complete('a',1700,1700,1713,1,'s1',5);
close(tracker.refresh('a',2100,1600,'s1',undefined,6,.5).adjustment,32);
assert.equal(tracker.refresh('a',1500,1600,'s2',undefined,7,.5).status,'reset-held');
assert.equal(tracker.refresh('a',1510,1600,'s2','settled',8,.5).status,'overlap-unknown');
assert.throws(()=>replayEloRatings([],[],{liveRefreshStrength:2}));
console.log('Live refresh: outside-play increments, no current-outcome leakage, missing overlap, duplicate safety, reset quarantine, and bounded corrections verified');
