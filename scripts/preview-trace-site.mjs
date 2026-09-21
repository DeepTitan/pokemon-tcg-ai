import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import leaderboardPage from '../landing/api/leaderboard-page.mjs';
import leaderboardData from '../landing/api/leaderboard-data.mjs';
import leaderboardArt from '../landing/api/leaderboard-art.mjs';
import trainingData from '../landing/api/training-data.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../landing/dist');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2'};
http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://127.0.0.1:4011');req.query=Object.fromEntries(url.searchParams);
  const p=url.pathname;
  if(p==='/trace/leaderboard-static/training/status.json')return await trainingData(req,res);
  if(p==='/trace/leaderboard-static/events.json')return await leaderboardData(req,res);
  if(p==='/trace/leaderboard')return await leaderboardPage(req,res);
  if(p.startsWith('/trace/players/')){req.query.player=decodeURIComponent(p.slice('/trace/players/'.length));return await leaderboardPage(req,res)}
  if(p.startsWith('/trace/leaderboard-static/card-art/')){req.query.cardId=path.basename(p,'.png');return await leaderboardArt(req,res)}
  const relative=p==='/trace/training'?'/trace/leaderboard-static/training/index.html':p==='/'?'/index.html':p;
  const file=path.resolve(root,'.'+decodeURIComponent(relative));
  if(!file.startsWith(root+'/'))throw Error('not found');
  const bytes=await fs.readFile(file);res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(bytes);
 }catch{res.statusCode=404;res.end('Not found')}
}).listen(4011,'127.0.0.1',()=>console.log('Integrated Trace preview: http://127.0.0.1:4011/trace/training'));
