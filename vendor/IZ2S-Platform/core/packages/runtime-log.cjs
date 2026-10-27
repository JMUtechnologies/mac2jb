// Host-only diagnostics. Never issues RPC or copies console image/audio data.
const path=require('node:path'),files=require('./files.cjs');
function create({directory,stateRoot,clock=Date.now,log=console.error}){
 let row={session:path.basename(directory),stage:'starting',updated:new Date(clock()).toISOString()},lastWrite=-Infinity,lastRequest='';
 async function flush(force=false){if(!force&&clock()-lastWrite<1000)return;lastWrite=clock();try{await files.write(path.join(directory,'run11-diagnostics.json'),row);}catch(error){log('Run11 diagnostics: '+error.message);}}
 async function event(type,message,extra={}){try{await files.event(stateRoot,type,message,extra);}catch(error){log('Run11 event log: '+error.message);}}
 return {
  async stage(stage,details={},force=false){row={...row,stage,operation:details,updated:new Date(clock()).toISOString()};await flush(force);},
  async observe(state,available=[]){
   const request=state.readUInt32LE(812),sequence=state.readUInt32LE(808),key=sequence+':'+request;
   row.console={selected:state.readUInt32LE(80),installed:state.readUInt32LE(112),picker:state.readUInt32LE(800)!==0,selection:state.readUInt32LE(804),sequence,request,busy:state.readUInt32LE(836)!==0,acknowledged:state.readUInt32LE(844),available:state.readUInt32LE(832)};
   row.lastStateAt=new Date(clock()).toISOString();
   if(request&&key!==lastRequest){const name=available[request-1]?.name||'Unknown package';row.packageRequest={name,request,sequence,at:row.lastStateAt};await event('package-request','Console requested '+name,{request,sequence});await flush(true);}
   lastRequest=key;
  },
  async fail(error){if(row.failure)return;const operation=row.stage;row.failure={error:files.clean(error.message),operation,at:new Date(clock()).toISOString()};row.stage='failed';row.updated=row.failure.at;await flush(true);await event('error','Run11 '+operation+': '+row.failure.error);},
  async cleanup(name,error){await event('cleanup-error','Cleanup '+name+': '+files.clean(error.message));},
  async complete(){row.stage='stopped';row.updated=new Date(clock()).toISOString();await flush(true);},
 };
}
// Cleanup must not replace the first operational error with ECONNREFUSED.
async function cleanup(primary,steps,report=async()=>{}){
 let first;
 for(const [name,action]of steps)try{await action();}catch(error){first||=error;try{await report(name,error);}catch{}}
 if(!primary&&first)throw first;
}
module.exports={create,cleanup};
