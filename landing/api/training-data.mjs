// Fixed public projection only. This function has no AWS credentials or private artifact access.
export function createTrainingDataHandler({fetcher=fetch,feedUrl='https://bh36pzgdea.execute-api.us-east-2.amazonaws.com/status'}={}) {
  return async function handler(request,response) {
    response.setHeader('Content-Type','application/json; charset=utf-8');
    response.setHeader('Cache-Control','no-store');
    response.setHeader('CDN-Cache-Control','no-store');
    response.setHeader('Vercel-CDN-Cache-Control','no-store');
    response.setHeader('X-Content-Type-Options','nosniff');
    if(!['GET','HEAD'].includes(request.method||'GET')){
      response.statusCode=405;response.setHeader('Allow','GET, HEAD');response.end('{}');return;
    }
    try {
      if(!feedUrl || !/^https:\/\/[a-z0-9]+\.execute-api\.us-east-2\.amazonaws\.com\/status$/.test(feedUrl)) throw Error('Feed not configured');
      const upstream=await fetcher(feedUrl,{signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});
      if(!upstream.ok)throw Error('Feed unavailable');
      const data=await upstream.json();
      if(data.schema!=='trace-public-training-v1'||!Array.isArray(data.checkpoints)||!data.run)throw Error('Invalid feed');
      response.statusCode=200;response.end(request.method==='HEAD'?undefined:JSON.stringify(data));
    } catch {
      response.statusCode=503;response.setHeader('Retry-After','30');response.end(request.method==='HEAD'?undefined:'{"error":"Training updates temporarily unavailable"}');
    }
  };
}
export default createTrainingDataHandler();
