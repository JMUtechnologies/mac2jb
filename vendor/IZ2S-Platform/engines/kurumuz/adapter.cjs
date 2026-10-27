const path=require('node:path'),{startup,base,izPlan}=require('../common.cjs');
const manifest=require('./manifest.json'),menu=require('./menu.json');
function settings(value={}) {
 if(value.rpcMode!==undefined&&typeof value.rpcMode!=='boolean')throw Error('RPC mode must be a checkbox value');
 return {rpcMode:value.rpcMode===true};
}
function plan(value={},options={}) {
 const selected=settings(value),{host,node}=base(options),cwd=path.join(__dirname,'upstream');
 const bootstrap={file:path.join(cwd,manifest.bootstrap),saveName:'NS2K',sourceSlot:0,arity:5,loaderId:manifest.id,recovery:false};
 // A held Original endpoint must never replace the selected console shell.
 if(options.runtime==='izlauncher')return izPlan({id:manifest.id,manifest,settings:selected,options,bootstrap});
 const rpcMode=options.rpcMode??selected.rpcMode;
 if(typeof rpcMode!=='boolean')throw Error('RPC mode must be boolean');
 const data=startup({root:__dirname,manifest,saveName:bootstrap.saveName,arity:bootstrap.arity,
  runRoot:path.join(cwd,'runs'),persistent:rpcMode,
  readyPatterns:rpcMode?['^4/4 verified\\. SmileBASIC RPC']:[],
  completedPatterns:rpcMode?[]:['^FS execution verified\\.']});
 data.preloaded=false;data.sourceSetup=true;data.bootstrap.sourceSlot=0;
 return {loaderId:manifest.id,mode:'original',runtime:'original',runner:'upstream',command:node,
  args:['run.cjs',...(rpcMode?['--rpc']:[]),host],cwd,
  env:{NS2_BASIC_ARITY:'5',NS2_RPC_MODE:rpcMode?'1':'0'},startup:data,bootstrap:data.bootstrap,
  manualCommands:data.manualCommands,runRoot:data.runRoot,lifecycle:data.lifecycle,
  capabilities:{...manifest.capabilities,heldRpc:rpcMode,izPackages:false,streaming:false},
  notes:['Launch loads saved NS2K and uses exactly five START arguments.',
   rpcMode?'Original RPC remains live until Stop.':'Original FS demonstration completes and exits.',
   'No firmware dump is started by Launch.']};
}
module.exports={manifest,menu,settings,plan};
module.exports.createEngine=context=>require('../../core/session-api.cjs').engine(module.exports,context);
