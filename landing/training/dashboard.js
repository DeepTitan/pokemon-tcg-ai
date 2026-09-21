let data,chosen;const $=id=>document.getElementById(id),anchor='4f42626fe3241cc64c7fda4e692b251fe5118670342fd1be5f32e0e7aaeb2733';
const names={'anchor-100m':'100M benchmark',imitation:'Human baseline','original-10m':'Original 10M',incumbent:'Earlier incumbent','start-rehearsal':'Starting model','previous-milestone':'Previous checkpoint'};
const pct=n=>(n*100).toFixed(1)+'%',steps=n=>(n/1e6).toFixed(1)+'M',fmt=n=>Number(n).toLocaleString();
function checkpointSteps(c){return c.phase===data.phases.at(-1).id?Math.floor(data.phases.at(-1).offset/1e7)*1e7+c.milestone:c.milestone}
function checkpointLabel(c){return (checkpointSteps(c)/1e6)+'M'}
function benchmark(c){return c.panels.find(p=>p.matchup==='mirror'&&c.opponents?.[p.opponent]?.sha256===anchor)}
function current(){return data.checkpoints.filter(c=>c.phase===data.phases.at(-1).id)}
function duration(ms){let m=Math.floor(Math.max(0,ms)/60000);return `${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}m`}
function clock(){if(!data)return;const r=data.run,observed=Date.parse(r.observedAt),fresh=Date.now()-observed<600000,end=fresh&&['running','evaluating'].includes(r.status)?Date.now():observed;
$('status').textContent=[!fresh?'Status stale':r.status==='running'?'Training':r.status==='evaluating'?'Evaluating':r.status==='exporting'?'Saving checkpoint':r.status,r.phaseDecisions==null?'':steps(Math.floor(data.phases.at(-1).offset/1e7)*1e7+r.phaseDecisions)+' steps',Number.isFinite(end)?duration(end-Date.parse(r.phaseStarted))+' on this run':''].filter(Boolean).join(' · ');
$('status').title=r.totalDecisions==null?'':`Exact total: ${fmt(r.totalDecisions)} training decisions. The displayed step count uses the same rounded starting offset as checkpoint labels.`;
pace(fresh);
$('session').textContent='Current deck run launched '+new Date(r.phaseStarted).toLocaleString()+'. AWS session launched '+new Date(r.hostSessionStarted).toLocaleString()+'. Times are elapsed wall time, not GPU hours.';}
function pace(fresh){
 const r=data.run,rate=r.stepsPerSecond,target=r.nextCheckpointSteps;
 const available=fresh&&Number.isFinite(rate),windowMinutes=Math.max(1,Math.round(r.speedWindowSeconds/60));
 const basis=r.speedBasis==='recent'?`Last ${windowMinutes} min average`:'Average since this run started';
 $('speed').textContent=available?`${Math.round(rate).toLocaleString()} steps/s`:'— steps/s';
 $('speed').title=available?`${basis}. Fresh accepted training decisions per wall-clock second, including collection and learning.`:'Waiting for fresh training progress.';
 const eta=r.etaSeconds;
 let etaText='ETA unavailable';
 if(fresh&&Number.isFinite(eta)){
   const minutes=Math.max(1,Math.ceil(eta/60));
   etaText=`~${minutes>=60?`${Math.floor(minutes/60)}h `:''}${minutes%60||minutes<60?minutes%60+'m':''}`.trim();
 }else if(fresh&&r.status==='evaluating')etaText='Evaluating';
 else if(fresh&&r.status==='exporting')etaText='Saving checkpoint';
 $('eta').textContent=Number.isFinite(target)?`${etaText}${Number.isFinite(eta)&&fresh?' to':' · next'} ${target/1e6}M`:etaText;
 $('eta').title='Estimated time to the next saved training checkpoint, based on observed throughput. Evaluation results follow separately. Refreshed with cloud progress; pauses can change the estimate.';
 $('paceMethod').textContent=`Speed counts fresh accepted training decisions once, not repeated optimizer passes or human rehearsal. ${available?basis+'. ':''}It includes collection and learning time. Recent speed uses up to 30 minutes of cloud observations; until two samples are available, it uses the run average. The checkpoint ETA estimates training time remaining at this pace, excluding the subsequent evaluation. Stale or paused runs do not show an ETA.`;
}
function render(){const cs=current(),pts=cs.filter(benchmark),last=pts.at(-1),p=last&&benchmark(last);
$('latest').textContent=p?pct(p.winRate):'—';$('latestCaption').innerHTML=last?`<span>${checkpointLabel(last)} checkpoint</span><span>${fmt(p.games)} evaluation games</span>`:'Waiting for the first benchmark';
$('verdict').textContent=!p?'':p.winRateWilson95[0]>.5?'Ahead of 100M in this evaluation.':p.winRateWilson95[1]<.5?'Behind 100M in this evaluation.':'Still roughly even with 100M.';
const resultCell=(p,opponent)=>p?`<span class="rate">${pct(p.winRate)}</span><div class="caption">${p.wins}–${p.losses}${p.draws?'–'+p.draws:''} · ${fmt(p.games)} games${opponent?` <span class="previous-target">· vs ${checkpointLabel(opponent)}</span>`:''}</div>`:'<span class="caption">Not evaluated</span>';
$('records').innerHTML=cs.slice().reverse().map(c=>{let b=benchmark(c),prior=c.panels.find(p=>p.name==='previous-milestone-mirror'),opponent=prior&&data.checkpoints.find(x=>x.actor===c.opponents?.[prior.opponent]?.sha256);return `<tr${c===last?' class="latest"':''}><td><span class="checkpoint-label">${checkpointLabel(c)}</span>${c===last?'<span class="tag">Latest evaluated</span>':''}<div class="caption">${c.trainingGames==null?'':fmt(c.trainingGames)+' simulated games'}</div></td><td>${resultCell(b)}</td><td>${resultCell(prior,opponent)}</td></tr>`}).join('')||'<tr><td colspan="3">First checkpoint evaluation is pending.</td></tr>';
$('pending').textContent=data.benchmark?.status==='evaluating'?'Evaluating '+((Math.floor(data.phases.at(-1).offset/1e7)*1e7+data.benchmark.milestone)/1e6)+'M'+' against 100M…':'Next checkpoint is tested automatically.';
$('deck').textContent='Current deck: '+data.run.deck+'. Earlier deck results are available below.';
const sel=$('checkpoint');if(sel.options.length!==data.checkpoints.length){sel.innerHTML=data.checkpoints.slice().reverse().map(c=>`<option value="${c.id}">${checkpointLabel(c)} · ${c.phaseName}</option>`).join('');}if(!chosen)chosen=data.checkpoints.at(-1)?.id;if(chosen)sel.value=chosen;
const stale=Date.now()-Date.parse(data.run.observedAt)>600000;$('error').style.display=data.sync.error||stale?'block':'none';$('error').textContent=data.sync.error?'Training updates are temporarily unavailable. Showing the last saved results.':'Training status is stale. Saved evaluation results remain available.';
$('refresh').disabled=data.sync.refreshing;$('refresh').setAttribute('aria-label',data.sync.refreshing?'Refreshing training results':'Refresh training results');$('freshness').textContent=(data.sync.refreshing?'Refreshing…':data.sync.lastSuccess?'Updated '+new Date(data.sync.lastSuccess).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'Awaiting cloud refresh')+' · Auto-refresh every 5 min';draw(pts);detail();clock();}
function draw(pts){
 const chart=$('chart'),width=Math.max(280,chart.clientWidth),height=278,left=43,right=18,bottom=225,plotHeight=205;
 chart.setAttribute('viewBox',`0 0 ${width} ${height}`);
 let s='',min=pts.length?checkpointSteps(pts[0])-2e6:100e6,max=pts.length?checkpointSteps(pts.at(-1))+2e6:160e6;
 if(max<=min)max=min+1e7;
 const X=n=>left+(n-min)/(max-min)*(width-left-right),Y=n=>bottom-n*plotHeight;
 for(const v of [0,.25,.5,.75,1])s+=`<line x1="${left}" x2="${width-right}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v===.5?'#9aadc3':'#e4e5e3'}" ${v===.5?'stroke-dasharray="5 5"':''}/><text x="${left-10}" y="${Y(v)+4}" text-anchor="end">${v*100}%</text>`;
 const stride=Math.max(1,Math.ceil((pts.length-1)/Math.max(1,Math.floor((width-left-right)/65))));
 const visible=i=>i%stride===0||i===pts.length-1;
 for(const [i,c] of pts.entries())if(visible(i))s+=`<line x1="${X(checkpointSteps(c))}" x2="${X(checkpointSteps(c))}" y1="${bottom}" y2="${bottom+7}" stroke="#c9d0d8"/><text x="${X(checkpointSteps(c))}" y="${bottom+28}" text-anchor="middle">${checkpointLabel(c)}</text>`;
 s+=`<text x="${(left+width-right)/2}" y="275" text-anchor="middle">Training steps</text>`;
 s+=`<polyline fill="none" stroke="#388bdf" stroke-width="2.5" points="${pts.map(c=>`${X(checkpointSteps(c))},${Y(benchmark(c).winRate)}`).join(' ')}"/>`;
 for(const [i,c] of pts.entries()){
  const p=benchmark(c),label=`${checkpointLabel(c)}: ${pct(p.winRate)}; ${p.wins} wins, ${p.losses} losses. 95% interval ${p.winRateWilson95.map(pct).join(' to ')}`;
  s+=`<circle tabindex="0" role="img" aria-label="${label}" cx="${X(checkpointSteps(c))}" cy="${Y(p.winRate)}" r="5" fill="#388bdf"><title>${label}</title></circle>`;
  if(visible(i))s+=`<text x="${X(checkpointSteps(c))}" y="${Y(p.winRate)-16}" text-anchor="middle" class="point-label">${pct(p.winRate)}</text>`;
 }
 chart.innerHTML=s;
}
let chartWidth=0;
new ResizeObserver(([entry])=>{if(data&&Math.abs(chartWidth-entry.contentRect.width)>1){chartWidth=entry.contentRect.width;draw(current().filter(benchmark))}}).observe($('chart'));
function detail(){let c=data.checkpoints.find(c=>c.id===$('checkpoint').value);if(!c)return;$('metadata').textContent=c.deck+' · Exact total: '+fmt(c.decisions)+' decisions · '+new Date(c.completedAt).toLocaleString();$('detailsTable').querySelector('tbody').innerHTML=c.panels.map(p=>`<tr><td>${names[p.opponent]||p.opponent} / ${p.matchup==='mirror'?'mirror':'vs Alakazam'}</td><td>${p.wins}–${p.losses}–${p.draws}</td><td>${pct(p.winRate)}</td><td>${p.winRateWilson95.map(pct).join('–')}</td></tr>`).join('');}
async function load(){try{let r=await fetch('/trace/leaderboard-static/training/status.json');if(!r.ok)throw Error();data=await r.json();render()}catch(e){$('error').style.display='block';$('error').textContent='Training updates are temporarily unavailable. Displayed results have not refreshed.'}}
$('checkpoint').onchange=()=>{chosen=$('checkpoint').value;detail()};$('refresh').onclick=async()=>{try{$('refresh').disabled=true;await load()}catch(e){$('error').style.display='block';$('error').textContent='Could not refresh. Please try again shortly.'}};load();setInterval(load,15000);setInterval(clock,1000);
