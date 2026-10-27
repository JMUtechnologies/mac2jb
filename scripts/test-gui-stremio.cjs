'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const {configuration,playerConfiguration,createShutdown}=require('./gui-stremio.cjs');
test('shutdown cancels the pending receiver ACK before waiting for the pipeline and joins graphics once',{timeout:2000},async()=>{
 const order=[],failures=[];let releaseDisplay,releaseAbort;
 const display=new Promise(resolve=>{releaseDisplay=resolve;}),joined=new Promise(resolve=>{releaseAbort=resolve;});
 const graphics={abortPending(){order.push('abort');releaseDisplay();return joined;},async close(){order.push('graphics');releaseAbort();}};
 const shutdown=createShutdown({getGraphics:()=>graphics,onFailure:(error,native)=>failures.push({error,native})});
 shutdown.abort();shutdown.abort();
 await shutdown.close({pipeline:{async close(){await display;order.push('pipeline');}},audio:{async close(){order.push('audio');}}});
 assert.deepEqual(order,['abort','pipeline','audio','graphics']);assert.deepEqual(failures,[]);
});
test('receiver abort failure is observed immediately and cannot skip remaining native cleanup',{timeout:2000},async()=>{
 const error=Object.assign(Error('Receiver join uncertain'),{cleanupBlocked:true}),order=[],failures=[];
 const graphics={async abortPending(){throw error;},async close(){order.push('graphics');}};
 const shutdown=createShutdown({getGraphics:()=>graphics,onFailure:(error,native)=>failures.push({error,native})});
 shutdown.abort();await new Promise(resolve=>setImmediate(resolve));
 await shutdown.close({pipeline:{async close(){order.push('pipeline');}},audio:{async close(){order.push('audio');}}});
 assert.deepEqual(order,['pipeline','audio','graphics']);assert.equal(failures.length,1);
 assert.equal(failures[0].error.cleanupBlocked,true);
});
test('intentional receiver cancellation drains cleanly while unexpected or uncertain cancellation remains a failure',async()=>{
 let stopping=false;const failures=[],cancel=()=>Object.assign(Error('Receiver stopped'),{code:'STREMIO_RECEIVER_CANCELLED'});
 const graphics={async abortPending(){},async close(){}};
 const shutdown=createShutdown({getGraphics:()=>graphics,isStopping:()=>stopping,onFailure:(error,native)=>failures.push({error,native})});
 shutdown.record(cancel());assert.equal(failures.length,1,'Unexpected cancellation is not ignored');failures.length=0;
 stopping=true;
 await shutdown.close({pipeline:{async close(){throw cancel();}},audio:{async close(){}}});
 assert.deepEqual(failures,[],'User Stop does not become a failed playback');
 shutdown.record(Object.assign(cancel(),{cleanupBlocked:true}));shutdown.record(cancel(),true);
 assert.equal(failures.length,2,'Native uncertainty always survives cancellation');
});
test('a short receive with clean receiver/graphics joins does not become uncertain native cleanup',async()=>{
 const failures=[],graphics={async abortPending(){},async close(){}};
 const shutdown=createShutdown({getGraphics:()=>graphics,onFailure:(error,native)=>failures.push({error,native})});
 await shutdown.close({pipeline:{async close(){throw Error('Short media receive; frame not committed');}},audio:{async close(){}}});
 assert.equal(failures.length,1);assert.equal(failures[0].native,false);assert.notEqual(failures[0].error.cleanupBlocked,true);
});
test('shutdown preserves native uncertainty from audio or graphics even after a pipeline failure',async()=>{
 const failures=[],graphics={async abortPending(){},async close(){throw Object.assign(Error('Graphics join uncertain'),{cleanupBlocked:true});}};
 const shutdown=createShutdown({getGraphics:()=>graphics,onFailure:(error,native)=>failures.push({error,native})});
 await shutdown.close({pipeline:{async close(){throw Error('Receiver disconnected');}},audio:{async close(){throw Error('Audio did not drain');}}});
 assert.equal(failures.length,3);assert.equal(failures[1].native,true);assert.equal(failures[2].error.cleanupBlocked,true);
});
test('media helper config stays on private stdin and bounded JSON objects',async()=>{
 assert.deepEqual(await configuration(Readable.from(['{"addonUrls":[]}\n'])),{addonUrls:[]});
 assert.deepEqual(await configuration(Readable.from([])),{});
 await assert.rejects(configuration(Readable.from(['null\n'])),/Invalid/);
 await assert.rejects(configuration(Readable.from(['{"addonUrls":[]}'])),/incomplete/);
 await assert.rejects(configuration(Readable.from(['{"addonUrls":'+ 'x'.repeat(4*1024*1024)])),/large/);
 const value={addonUrls:[],libraryItems:[{_id:'fixture',name:'Café ☃',state:{timeOffset:52000}}]};
 const bytes=Buffer.from(JSON.stringify(value)+'\n'),split=bytes.indexOf(Buffer.from('é'))+1;
 assert.deepEqual(await configuration(Readable.from([bytes.subarray(0,split),bytes.subarray(split)])),value);
 assert.deepEqual(playerConfiguration({}),{addonUrls:[],libraryItems:[]});
 for(const libraryItems of [null,{},[null],[[]],Array(501).fill({})])assert.throws(()=>playerConfiguration({libraryItems}),/library/);
 assert.throws(()=>playerConfiguration({addonUrls:Array(33).fill('https://example.invalid/manifest.json')}),/add-on/);
});
const sourceRoot=path.resolve(__dirname,'..'),portable=path.join(sourceRoot,'.build-gui/homebrew');
async function runtimePresent(){
 try{for(const file of ['python/bin/python3','bin/spirv-val','fonts/DejaVuSans.ttf','python-custom/sitecustomize.py'])await fs.access(path.join(portable,file));return true;}catch{return false;}
}
async function runtimeFixture(t,{missingValidator=false}={}){
 const parent=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'mac2jb stremio startup ')),root=path.join(parent,'Runtime With Spaces');
 await fs.mkdir(path.join(root,'scripts'),{recursive:true});await fs.mkdir(path.join(root,'vendor'));
 // Copy the real entrypoint so its default root is the relocated app, then alias only source assets.
 for(const file of await fs.readdir(path.join(sourceRoot,'scripts'))){
  if(file==='gui-stremio.cjs')await fs.copyFile(path.join(sourceRoot,'scripts',file),path.join(root,'scripts',file));
  else await fs.symlink(path.join(sourceRoot,'scripts',file),path.join(root,'scripts',file));
 }
 for(const directory of ['stremio','assets','packaging'])await fs.symlink(path.join(sourceRoot,directory),path.join(root,directory));
 await fs.symlink(path.join(sourceRoot,'vendor/GPUBrewLauncher'),path.join(root,'vendor/GPUBrewLauncher'));
 // The invalid fixture has its own empty bin directory; it never mutates the shared runtime cache.
 if(missingValidator){
  await fs.mkdir(path.join(root,'homebrew/bin'),{recursive:true});
  for(const directory of ['python','python-custom','fonts'])await fs.symlink(path.join(portable,directory),path.join(root,'homebrew',directory));
 }else await fs.symlink(portable,path.join(root,'homebrew'));
 t.after(()=>fs.rm(parent,{recursive:true,force:true}));return root;
}
function startup(root,args=['--check-runtime']){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(root,'scripts/gui-stremio.cjs'),...args],{cwd:root,
   env:{...process.env,PATH:'/usr/bin:/bin',PYTHONHOME:'/inherited invalid Python home',PYTHONPATH:'/inherited invalid Python modules',
    SPIRV_VAL:'/inherited missing validator',MAC2JB_HBLAUNCHER_FONT:'/inherited missing font',PYTHONNOUSERSITE:'0'},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Runtime startup check timed out'));},45000);
  child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stdout,stderr});});
 });
}
test('real entrypoint validates bundled shaders and Pillow from a clean relocated app environment',{timeout:60000},async t=>{
 if(!await runtimePresent()){t.skip('Portable homebrew cache is absent; built-app runtime self-test remains mandatory.');return;}
 const root=await runtimeFixture(t),result=await startup(root);
 assert.equal(result.signal,null);assert.equal(result.code,0,result.stdout+'\n'+result.stderr);
 assert.deepEqual(JSON.parse(result.stdout.trim()),{ready:true,python:path.join(root,'homebrew/python/bin/python3'),
  spirvVal:path.join(root,'homebrew/bin/spirv-val'),pythonPath:path.join(root,'homebrew/python-custom'),
  font:path.join(root,'homebrew/fonts/DejaVuSans.ttf'),appId:'stremio-experimental',memoryBytes:3149824});
 assert.doesNotMatch(result.stdout+result.stderr,/ENOENT|ModuleNotFoundError|Python path configuration|MAC2JB_HOMEBREW.*"(?:started|running)"/);
 assert.equal(await fs.stat(path.join(root,'runs')).then(()=>true,()=>false),false,'preflight must not create a native run');
});
test('missing bundled validator fails in local preflight before held RPC or console setup',{timeout:60000},async t=>{
 if(!await runtimePresent()){t.skip('Portable homebrew cache is absent; built-app runtime self-test remains mandatory.');return;}
 const root=await runtimeFixture(t,{missingValidator:true}),result=await startup(root);
 assert.notEqual(result.code,0);assert.equal(result.signal,null);
 assert.match(result.stdout+result.stderr,/The app is missing a bundled Stremio tool/);
 assert.doesNotMatch(result.stdout+result.stderr,/held RPC|held run|RUN_DIRECTORY|The Stremio configuration did not arrive|Preparing the player display|"(?:started|running)"/);
 assert.equal(await fs.stat(path.join(root,'runs')).then(()=>true,()=>false),false);
});
