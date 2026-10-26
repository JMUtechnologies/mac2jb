'use strict';
// A private Stremio-protocol sample provider; the user's addons stay unchanged.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function create({root}){
 const media=await fs.readFile(path.join(root,'assets/stremio/bbb-sample.mp4'));
 const token=crypto.randomBytes(24).toString('hex'),prefix='/'+token;let origin;
 const meta={id:'mac2jb:bbb-sample',type:'movie',name:'Big Buck Bunny · 30-second sample',description:'Playback test excerpt. (c) copyright 2008, Blender Foundation / www.bigbuckbunny.org. CC BY 3.0. Source excerpt 00:30–01:00.',releaseInfo:'2008'};
 const server=http.createServer((request,response)=>{
  if(!['GET','HEAD'].includes(request.method)||request.url.length>2048){response.writeHead(405).end();return;}
  let route;try{route=decodeURIComponent(new URL(request.url,origin).pathname);}catch{response.writeHead(400).end();return;}
  const routes={
   [prefix+'/manifest.json']:{id:'mac2jb.playback-sample',version:'0.1.0',name:'mac2jb playback sample',description:'A bundled movie excerpt to test video and audio without a remote addon.',resources:['catalog','meta','stream'],types:['movie'],idPrefixes:['mac2jb:'],catalogs:[{type:'movie',id:'samples',name:'Playback sample'}]},
   [prefix+'/catalog/movie/samples.json']:{metas:[meta]},
   [prefix+'/meta/movie/mac2jb:bbb-sample.json']:{meta},
   [prefix+'/stream/movie/mac2jb:bbb-sample.json']:{streams:[{name:'Bundled playback test',title:'Blender Foundation · CC BY 3.0',url:origin+prefix+'/sample.mp4'}]}
  };
  if(routes[route]){const bytes=Buffer.from(JSON.stringify(routes[route]));response.writeHead(200,{'content-type':'application/json','content-length':bytes.length,'cache-control':'no-store'});response.end(request.method==='HEAD'?undefined:bytes);return;}
  if(route!==prefix+'/sample.mp4'){response.writeHead(404).end();return;}
  let start=0,end=media.length-1,status=200;const headers={'content-type':'video/mp4','accept-ranges':'bytes','cache-control':'private, max-age=3600'};
  if(request.headers.range){
   const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range);if(!range){response.writeHead(416).end();return;}
   start=Number(range[1]);if(range[2])end=Math.min(end,Number(range[2]));
   if(!Number.isSafeInteger(start)||start<0||start> end||start>=media.length){response.writeHead(416,{'content-range':'bytes */'+media.length}).end();return;}
   status=206;headers['content-range']=`bytes ${start}-${end}/${media.length}`;
  }
  headers['content-length']=end-start+1;response.writeHead(status,headers);response.end(request.method==='HEAD'?undefined:media.subarray(start,end+1));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 return {manifestURL:origin+prefix+'/manifest.json',async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={create};
