const fs=require('node:fs/promises'),path=require('node:path'),L=require('./layout.cjs'),{root}=require('./platform.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function create({rpc,mapped,directory,native:providedNative,createServer=api=>require(path.join(root,'core/console/host/ftp-server.cjs')).create(api)}){
 const native=providedNative||await require(path.join(root,'core/console/host/ftp-native.cjs')).create(rpc,directory),server=createServer(native),base=mapped+L.OFFSET;
 let closed=false,ack=0,generation=0,cwd='/',entries=[],page=0,error='',lastPublish=0,request=null,dirty=true,pumpError;
 async function listing(target){entries=(await native.storage.list(target)).sort((a,b)=>(a.type===b.type?0:a.type==='dir'?-1:1)||a.name.localeCompare(b.name));cwd=target;page=0;generation++;}
 async function publish(){await rpc.write(base+64,L.encode({ack,generation,cwd,entries,page,ftp:server.state,error:error||pumpError}));lastPublish=Date.now();dirty=false;await fs.writeFile(path.join(directory,'file-exchange.json'),JSON.stringify({session:rpc.a.session,active:!closed,cwd,page,entries:entries.length,ftp:server.state,error:error||pumpError},null,2));}
 try{await listing('/');await server.start(2121);await publish();}catch(e){await server.stop().catch(()=>{});throw e;}
 // File transfers continue independently of graphics. Page writes happen only
 // after the scheduler pauses the GPU at a module boundary.
 const pumping=(async()=>{while(!closed){try{await server.pump();}catch(e){pumpError=e.message;dirty=true;}await sleep(20);}})();
 return {
  async pending(){if(closed)return false;request=await rpc.read(base,16);return dirty||!!request.readUInt32LE()&&request.readUInt32LE()!==ack||Date.now()-lastPublish>=400;},
  async afterBatch(){if(closed)return;const packet=request||await rpc.read(base,16),seq=packet.readUInt32LE();request=null;
   if(seq&&seq!==ack){error='';try{const op=packet.readUInt32LE(4),arg=packet.readUInt32LE(8),paths=require(path.join(root,'core/console/host/ftp-native.cjs'));
    if(op===1)await listing('/');
    else if(op===2){const e=entries[page*L.ROWS+arg];if(arg>=L.ROWS||!e)throw Error('Entry no longer available');if(e.type==='dir')await listing(paths.virtualPath(cwd,e.name));}
    else if(op===3)await listing(paths.virtualPath(cwd,'..'));
    else if(op===4)await listing(cwd);
    else if(op===5)page=Math.min(Math.max(0,Math.ceil(entries.length/L.ROWS)-1),page+1);
    else if(op===6)page=Math.max(0,page-1);
    else if(op===7){if(server.state.running)await server.stop();else await server.start(2121);}
    else throw Error('Unknown file command');
   }catch(e){error=e.message;}ack=seq;}
   await publish();
  },
  async close(){if(closed)return;closed=true;await pumping;await server.stop();await publish();}
 };
}
module.exports={create};
