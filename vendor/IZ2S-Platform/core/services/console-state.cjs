// Read-only SDK getters. TV output and Ethernet are independent properties.
const path=require('node:path');
const NETWORK=require('../console/abi/service-functions.json');
const OE={operationMode:{symbol:'_ZN2nn2oe16GetOperationModeEv',offset:3784432,hex:'ff8300d1fd7b01a9fd4300917db60894080040f9a11300d1082540f900013fd6'},performanceMode:{symbol:'_ZN2nn2oe18GetPerformanceModeEv',offset:3784496,hex:'ff8300d1fd7b01a9fd4300916db60894080040f9a11300d1082940f900013fd6'},display:{symbol:'_ZN2nn2oe27GetDefaultDisplayResolutionEPiS1_',offset:3781376,hex:'ffc300d1fd7b01a9fd430091f44f02a9f30301aaf40300aa76b90894080040f9'}};
function describe({operationMode,performanceMode,width,height,networkType,networkStatus,signalBars,ip,at=new Date().toISOString()}){
 const mode=operationMode===1?'docked':operationMode===0?'handheld':'unknown',network=networkType===2?'ethernet':networkType===1?'wifi':'unknown';
 return {at,stale:false,operationMode,mode,docked:mode==='unknown'?null:mode==='docked',physicalInsertion:mode==='docked'?'TV output active':'not determined by operation mode alone',performanceMode,display:{width,height},network:{type:network,status:networkStatus,connected:networkStatus===4,signalBars,ip},warning:mode==='docked'&&(networkType!==2||networkStatus!==4)?'TV mode is active, but Ethernet is not connected':null};
}
async function create({rpc,directory}){
 if(rpc.a.sdkCrc32!==3925528160)throw Error('Console mode getters require the qualified SmileBASIC SDK');
 // The full SDK CRC was checked during host qualification. Also register each
 // current getter's original instructions before calling it through the bridge.
 const defs={netStatus:NETWORK.netStatus,netAddress:NETWORK.netAddress,...OE};
 const api=await require('../console/native/client.cjs').create(rpc,defs,4096);let state=null,closed=false,pending=null;
 async function refresh(){if(closed)return state;if(pending)return pending;pending=(async()=>{
  const status=await rpc.request({command:'status'});if(!status.ready)return state;
  const operationMode=await api.result('operationMode'),performanceMode=await api.result('performanceMode');await api.call('display',[api.base,api.base+4]);const display=await api.read(0,8);
  const networkResult=await api.result('netStatus',[api.base+16]);if(networkResult)throw Error('Network status getter failed: '+networkResult);
  const net=await api.read(16,12),addressResult=await api.result('netAddress',[api.base+32]),ip=addressResult?null:[...await api.read(32,4)].join('.');
  state=describe({operationMode,performanceMode,width:display.readInt32LE(),height:display.readInt32LE(4),networkType:net.readUInt32LE(),signalBars:net.readUInt32LE(4),networkStatus:net.readUInt32LE(8),ip});
  if(directory)await require('../session/ledger.cjs').saveJson(path.join(directory,'console-state.json'),state);return state;
 })().finally(()=>pending=null);return pending;}
 return {get state(){return state;},refresh,close(){closed=true;}};
}
// A single sample in flight. Sampling failures retain the last known mode;
// they never tear down the native session or manufacture a network change.
function start({rpc,directory,intervalMs=2000,onChange=()=>{},createReader=create,schedule=setTimeout,cancel=clearTimeout}){
 let reader=null,state=null,error=null,timer=null,closed=false,pending=null;
 async function refresh(){
  if(closed)return state;if(pending)return pending;if(timer){cancel(timer);timer=null;}
  pending=(async()=>{
   try{
    if(!reader){if(!(await rpc.request({command:'status'})).ready)return state;reader=await createReader({rpc,directory});}
    const next=await reader.refresh();if(closed)return state;
    if(next){state=next;error=null;onChange({...state,stale:false});}
   }catch(e){error=e.message;if(state)onChange({...state,stale:true,error});}
   finally{if(!closed){timer=schedule(()=>{timer=null;refresh();},intervalMs);timer?.unref?.();}}
   return state;
  })().finally(()=>pending=null);return pending;
 }
 refresh();
 return {get state(){return state?{...state,stale:!!error||Date.now()-Date.parse(state.at)>intervalMs*3,...(error?{error}:{})}:null;},refresh,close(){closed=true;if(timer)cancel(timer);reader?.close();}};
}
module.exports={create,start,describe,OE};
