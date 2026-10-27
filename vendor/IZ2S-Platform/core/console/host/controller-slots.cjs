// Discovery owns a separate scratch allocation: it may run while rendering.
const {word}=require('./layout.cjs');
const SOURCES=[[1,'FullKey'],[4,'JoyDual'],[8,'JoyLeft'],[16,'JoyRight']],IDS=[0,1,2,3,4,5,6,7,32];
function sourceIds(controllers,{source='auto',controllerId=null}={}){
 return SOURCES.map(([bit])=>controllerId!==null&&(source==='pro'&&bit===1||source==='joycon'&&bit!==1)?controllerId:controllers.find(p=>(p.style&bit)!==0)?.id??0);
}
async function create(rpc,target,{apiFactory=require('../native/client.cjs').create,now=Date.now,intervalMs=5000,activeIntervalMs=300,settings}={}){
 settings??=await require('./controller-preferences.cjs').open();
 const hid=require('../abi/hid-functions.json'),api=await apiFactory(rpc,{style:hid.style},4096);let checked=-Infinity,controllers=[],previousIds=[];
 return {async refresh({forceSelectors=false}={}){
  const interval=settings.hubActive()?activeIntervalMs:intervalMs;
  if(now()-checked>=interval){checked=now();const next=[];
   for(const id of IDS){await api.write(0,word(id));if(await api.result('style',[api.base+16,api.base]))continue;const style=(await api.read(16,4)).readUInt32LE();if(style)next.push({id,style});}
   controllers=next;
  }
  const ids=sourceIds(controllers,settings.get());for(let i=0;i<ids.length;i++)if(forceSelectors||ids[i]!==previousIds[i])await target.write(0x1004+i*4,word(ids[i]));previousIds=ids;return controllers;
 }};
}
// Optional upgrade for an existing running hardware object. Reuse its actual
// selector storage and leave the per-frame HID graph and worker untouched.
const UPGRADE=Symbol.for('izlauncher.controller-slots.upgrade');
async function upgrade(rpc,hardware,{mapped,root,settings,...options}={}){
 if(hardware[UPGRADE])return hardware[UPGRADE];
 const installing=(async()=>{
  if(!Number.isSafeInteger(mapped)||mapped<0)throw Error('Mapped controller storage is required');
  settings??=await require('./controller-preferences.cjs').open(root);
  const L=require('./layout.cjs'),slot=hardware.frameCalls(mapped).find(c=>c.args?.[0]===mapped+L.OFFSET+L.FIELD.padSources+64),base=slot?.args?.[1]-0x1004;
  if(!Number.isSafeInteger(base)||base<4096)throw Error('Existing HID selector storage was not found');
  const observer=await create(rpc,{write:(offset,bytes)=>rpc.write(base+offset,bytes)},{...options,settings}),poll=hardware.poll.bind(hardware),close=hardware.close?.bind(hardware);let closed=false;
  hardware.refreshControllers=async()=>{if(!closed)hardware.controllers=await observer.refresh();return hardware.controllers;};
  hardware.poll=async(...args)=>{const result=await poll(...args);if(!closed)hardware.controllers=await observer.refresh({forceSelectors:true});return result;};
  if(close)hardware.close=async()=>{closed=true;return close();};
  await hardware.refreshControllers();return {base,settings,observer};
 })();Object.defineProperty(hardware,UPGRADE,{value:installing,configurable:true});
 try{return await installing;}catch(e){delete hardware[UPGRADE];throw e;}
}
module.exports={create,sourceIds,IDS,upgrade};
