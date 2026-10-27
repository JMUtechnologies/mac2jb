const path=require('node:path'),{startup,base,izPlan}=require('../common.cjs');
const manifest=require('./manifest.json'),menu=require('./menu.json');
function settings(){return {};}
function plan(value={},options={}){
 const {host,node}=base(options),cwd=path.join(__dirname,'upstream'),bootstrap={file:path.join(cwd,manifest.bootstrap),saveName:'NS2P',arity:9,loaderId:manifest.id,recovery:false};
 if(options.runtime==='izlauncher')throw Error('This engine supports Original only');
 const data=startup({root:__dirname,manifest,bootstrap:bootstrap.file,saveName:bootstrap.saveName,runRoot:path.join(cwd,'runs'),persistent:false,completedPatterns:['^FS execution verified\\.']});
 return {loaderId:manifest.id,mode:'original',runtime:'original',runner:'upstream',command:node,args:['run.cjs',host],cwd,env:{},startup:data,bootstrap:data.bootstrap,manualCommands:data.manualCommands,runRoot:data.runRoot,lifecycle:data.lifecycle,capabilities:{...manifest.capabilities,izPackages:false,streaming:false},originalServer:path.join(cwd,'run.cjs')};
}
module.exports={manifest,menu,settings,plan};

module.exports.createEngine=context=>require("../../core/session-api.cjs").engine(module.exports,context);
