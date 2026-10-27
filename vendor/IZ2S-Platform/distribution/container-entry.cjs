// Preview-only bridge. The real panel remains loopback-only inside the container.
const http=require('node:http'),path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..'),settings=require('../panel/profile.json');
 const manager=await require('../panel/controller.cjs').create({root,settings,node:process.execPath,preview:true});
 const panel=await require('../panel/http.cjs').createWindowServer({root,manager,port:0});
 const target=new URL(panel.url),token=target.hash.slice(1);
 const bridge=http.createServer((req,res)=>{
   if(req.method!=='GET'){res.writeHead(403);return res.end('Container preview is read-only');}
   const forward=http.request({hostname:'127.0.0.1',port:target.port,path:req.url,method:'GET',headers:{...req.headers,host:target.host}},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
   forward.on('error',()=>{res.writeHead(502);res.end('Preview stopped');});forward.end();
 });
 bridge.listen(39517,'0.0.0.0',()=>console.log('Preview: http://127.0.0.1:'+(process.env.IZ2S_PREVIEW_PORT||'39518')+'/#'+token));
 async function stop(){bridge.close();await panel.close();await manager.stop();}
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
