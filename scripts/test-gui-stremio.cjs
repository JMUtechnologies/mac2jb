'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const {configuration,playerConfiguration}=require('./gui-stremio.cjs');
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
 await fs.symlink(path.join(sourceRoot,'vendor/HBLauncher'),path.join(root,'vendor/HBLauncher'));
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
  font:path.join(root,'homebrew/fonts/DejaVuSans.ttf'),appId:'stremio-experimental',memoryBytes:102400});
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
