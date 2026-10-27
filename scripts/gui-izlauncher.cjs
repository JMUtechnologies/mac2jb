#!/usr/bin/env node
'use strict';
// IZlauncher owns only its shell workers. The verified ns2jb host stays with its original owner.
process.umask(0o077);
const fs = require('node:fs/promises'), sync = require('node:fs'), path = require('node:path');
const {spawn} = require('node:child_process');
const {validateRun, serveProxy} = require('./gui-homebrew.cjs');
const REVISION = '907de0d9f5a4e358079306e7f04a8c43d463142a';
const stages = [
  ['core/services/inspect-display.cjs'],
  ['core/services/inspect-compatibility.cjs'],
  ['core/services/inspect-input.cjs'],
  ['core/services/vulkan-copy.cjs', 'display'],
  ['shells/izlauncher/server/prepare.cjs', 'auto'],
  ['shells/izlauncher/server/check-input.cjs', 'auto'],
];
const owners = [
  {role:'graphics', script:'shells/izlauncher/server/frame-loop.cjs', args:['auto'], ready:'IZ launcher game event source ready.'},
  {role:'ftp', script:'core/console/host/ftp-service.cjs', args:[], ready:'SDK FTP service ready.'},
  {role:'audio', script:'core/console/audio/game-audio.cjs', args:[], ready:'Game sound effects ready.'},
];
const FRAME_READY = 'IZ launcher continuous native frame loop running.';
const check = (value, message) => {if (!value) throw Error(message);};
const writeJSON = (file, value, exclusive=false) => fs.writeFile(file, JSON.stringify(value,null,2)+'\n', {mode:0o600,flag:exclusive?'wx':'w'});
async function privatePath(file, directory=false, forbiddenMode=0o077) {
  const absolute=path.resolve(file), info=await fs.lstat(absolute);
  check(!info.isSymbolicLink() && (directory?info.isDirectory():info.isFile()) && info.uid===process.getuid() &&
    (info.mode&forbiddenMode)===0 && await fs.realpath(absolute)===absolute, 'Expected a private owned IZlauncher path: '+absolute);
  return absolute;
}
async function readJSON(file) {await privatePath(file);return JSON.parse(await fs.readFile(file,'utf8'));}
function argumentsFor(args) {
  check(args.length===1, 'Usage: gui-izlauncher.cjs RUN_DIRECTORY');
  return args[0];
}
async function verifyProcessIdentity(run) {
  // Upstream fs.cp preserves source directory permissions inside the already-private run root.
  const folder=await privatePath(path.join(run.directory,'switch2/process'),true,0o022);
  const prefix=run.proof.session+'-qualification-';
  const names=(await fs.readdir(folder)).filter(name=>name.startsWith(prefix) && /^\d+\.json$/.test(name.slice(prefix.length)))
    .sort((a,b)=>Number(b.slice(prefix.length,-5))-Number(a.slice(prefix.length,-5)));
  check(names.length>0,'IZlauncher requires the current SmileBASIC process qualification.');
  const file=path.join(folder,names[0]), proof=await readJSON(file);
  check(proof.session===run.proof.session && proof.report===run.proof.reportFile && proof.verified===true &&
    !proof.error && !proof.cleanupError && proof.cleanup?.finished===true && proof.app?.result===0 &&
    ['0100c9100b06a000','0100b4b00f9f6000'].includes(proof.app.programId),
    'IZlauncher requires the current verified SmileBASIC process identity.');
  return {file,programId:proof.app.programId};
}
function runtimeEnvironment(root, directory, inherited=process.env) {
  const env={...require('./prepare-izlauncher.cjs').runtimeEnvironment(root,inherited),IZ11_STATE_DIR:path.join(directory,'state')};
  delete env.PYTHONHOME;return env;
}
async function verifyRuntime(root) {
  const prepared=require('./prepare-izlauncher.cjs').verify(root);
  for(const name of ['homebrew/python/bin/python3','homebrew/bin/spirv-val'])await fs.access(path.join(root,name),sync.constants.X_OK);
  for(const name of ['homebrew/fonts/DejaVuSans.ttf','homebrew/python-custom/sitecustomize.py',
    'vendor/GPUBrewLauncher/smilebasic/engine/shared/rpc.cjs'])
    check((await fs.lstat(path.join(root,name))).isFile(),'Missing packaged IZlauncher dependency: '+name);
  return prepared;
}
function readLines(stream, callback) {
  let pending='';
  stream.on('data',bytes=>{pending+=bytes.toString();let at;
    while((at=pending.search(/[\r\n]/))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);if(line)callback(line);}
    if(pending.length>65536){callback(pending.slice(0,65536));pending='';}
  });
  stream.on('end',()=>{if(pending)callback(pending);});
}
async function frameProof(directory, session, stopped=false) {
  const [prepared,qualified,loop]=await Promise.all(['launcher-auto.json','launcher-auto-check.json','launcher-auto-loop.json'].map(name=>readJSON(path.join(directory,name))));
  check([prepared,qualified,loop].every(row=>row.session===session && !row.error) &&
    prepared.ready===true && prepared.firstShaderFramePresented===true && prepared.scratchRestored===true &&
    qualified.passed===true && qualified.scratchRestored===true && loop.continuous===true &&
    /^[a-f0-9]{64}$/.test(loop.frameSha256||'') &&
    (stopped ? loop.threadRunning===false && !!loop.completed : loop.threadRunning===true && !loop.completed),
    'IZlauncher did not verify its '+(stopped?'graphics shutdown':'live console frame worker')+'.');
  return loop;
}
async function main(args=process.argv.slice(2), options={}) {
  const candidate=argumentsFor(args), root=options.root||path.resolve(__dirname,'..');
  const runtime=path.join(root,'homebrew/IZ2S-Platform');
  const run=await validateRun(root,candidate,options.verifySession||require('./gui-dump.cjs').verifiedSession);
  const identity=await verifyProcessIdentity(run);
  await (options.verifyRuntime||verifyRuntime)(root);
  const request=options.request||require(path.join(root,'vendor/ns2jb/rpc.cjs')).request;
  check((await request(run.directory,{command:'status'}))?.ready===true,'The existing native RPC connection is not ready.');
  await writeJSON(path.join(run.directory,'.mac2jb-hblauncher-attempt.json'),{
    application:'izlauncher',source:'IZ2S Platform',commit:REVISION,started:new Date().toISOString(),
  },true);
  const parent=path.join(root,'runs');await fs.mkdir(parent,{recursive:true,mode:0o700});await privatePath(parent,true);
  const directory=await fs.mkdtemp(path.join(await fs.realpath(parent),'izlauncher-'));
  const report={session:path.basename(directory),sourceSession:run.proof.session,sourceDirectory:run.directory,
    application:'izlauncher',version:'0.16.0-rc.3',source:{commit:REVISION},identity,
    started:new Date().toISOString(),status:'preparing',stages:[],children:[],resourcesRetained:true};
  const save=()=>writeJSON(path.join(directory,'mac2jb-homebrew.json'),report);
  const emit=options.emit||((type,fields)=>process.stdout.write('MAC2JB_HOMEBREW '+JSON.stringify({type,...fields})+'\n'));
  let stopping=false, failure, proxy, monitor, stopResolve, nativeTouched=false, cleanupBlocked=false, acceptingRPC=true, environment;
  const stopRequested=new Promise(resolve=>{stopResolve=resolve;});
  const children=new Set(), activeOwners=new Map(), pendingRPC=new Set();
  function stop(){if(!stopping){stopping=true;stopResolve();}}
  function fail(error){failure ||= error;stop();}
  function safeEmit(type,fields={}){try{emit(type,{path:directory,...fields});}catch(error){if(error.code!=='EPIPE')throw error;stop();}}
  function stdoutError(error){if(error.code!=='EPIPE')failure ||= error;stop();}
  process.stdout.on('error',stdoutError);process.on('SIGTERM',stop);process.on('SIGINT',stop);
  options.signal?.addEventListener('abort',stop,{once:true});if(options.signal?.aborted)stop();
  function live(){try{
    const current=JSON.parse(sync.readFileSync(path.join(run.directory,'result.json'),'utf8'));
    const connection=JSON.parse(sync.readFileSync(path.join(run.directory,'connection.json'),'utf8'));
    return current.verified===true && !current.error && current.rpc?.mode==='held' && current.rpc?.state==='listening' &&
      connection.port===run.connection.port && connection.addresses?.session===run.proof.session &&
      current.fs?.verified===true && current.fs?.restored===true && current.fs?.retainedEndpoint?.ready===true && current.fs?.cleanup?.deferred===true;
  }catch{return false;}}
  async function forward(body){
    check(pendingRPC.size<32,'Too many pending IZlauncher RPC requests.');
    const operation=Promise.resolve().then(()=>request(run.directory,body));pendingRPC.add(operation);
    try{return await operation;}catch(error){cleanupBlocked ||= nativeTouched;fail(error);throw error;}finally{pendingRPC.delete(operation);}
  }
  function start(script,extra=[],readyText,role='prepare') {
    check(!stopping,'IZlauncher launch was stopped.');
    const child=(options.spawn||spawn)(process.execPath,[path.join(runtime,script),directory,...extra],{
      cwd:runtime,env:environment,stdio:['ignore','pipe','pipe'],
    });
    const state={child,script,role,closed:false,frameReady:false};children.add(state);
    let readyResolve,readyReject;
    state.readiness=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});state.readiness.catch(()=>{});
    const observe=line=>{if(readyText && line.trim()===readyText)readyResolve();if(line.trim()===FRAME_READY)state.frameReady=true;
      safeEmit('progress',{message:script+': '+line});};
    readLines(child.stdout,observe);readLines(child.stderr,observe);
    state.done=new Promise(resolve=>{
      child.once('error',error=>{state.closed=true;state.outcome={code:null,error};children.delete(state);readyReject(error);resolve(state.outcome);if(role!=='prepare')fail(error);});
      child.once('close',(code,signal)=>{state.closed=true;state.outcome={code,signal};children.delete(state);readyReject(Error(script+' ended before readiness.'));
        if(role!=='prepare'&&!stopping)fail(Error(script+' ended unexpectedly: '+(signal||code)));resolve(state.outcome);});
    });return state;
  }
  async function bounded(promise,label,ms=options.startTimeoutMs||300000,cancellable=true) {
    let timer;
    try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out.')),ms);}),
      ...(cancellable?[stopRequested.then(()=>{throw Error('IZlauncher stopped during '+label);})]:[])]);}finally{clearTimeout(timer);}
  }
  async function end(state){
    if(!state)return;
    let outcome=state.outcome;
    if(!state.closed){state.child.kill('SIGTERM');try{outcome=await bounded(state.done,state.role+' shutdown',options.stopTimeoutMs||90000,false);}
      catch(error){cleanupBlocked ||= nativeTouched;failure ||= error;state.child.kill('SIGKILL');outcome=await state.done;}}
    if(outcome?.error || outcome?.code!==0 || outcome?.signal){cleanupBlocked ||= nativeTouched;failure ||= Error('IZlauncher '+state.role+' did not confirm a clean stop.');}
  }
  let graphics;
  try {
    environment=(options.runtimeEnvironment||runtimeEnvironment)(root,directory);
    proxy=await (options.serveProxy||serveProxy)({live:()=>acceptingRPC&&live(),request:forward});
    await fs.mkdir(path.join(directory,'shared'),{mode:0o700});
    // This frozen client describes exactly the older bridge's capabilities; no unsupported batch methods are advertised.
    await fs.copyFile(path.join(root,'vendor/GPUBrewLauncher/smilebasic/engine/shared/rpc.cjs'),path.join(directory,'shared/rpc.cjs'));
    await fs.chmod(path.join(directory,'shared/rpc.cjs'),0o600);
    await writeJSON(path.join(directory,'connection.json'),{port:proxy.port,token:proxy.token,addresses:{...run.connection.addresses,session:report.session}});
    await save();safeEmit('started',{message:'Attaching IZlauncher to the existing SmileBASIC RPC session.'});
    monitor=setInterval(()=>{if(!live())fail(Error('The original held RPC session ended.'));},options.monitorMs||500);monitor.unref();
    for(const [script,...extra] of stages){
      safeEmit('progress',{message:'Preparing '+script});
      if(script==='core/services/vulkan-copy.cjs')nativeTouched=true;
      const state=start(script,extra),outcome=await bounded(state.done,script);
      check(!outcome.error && outcome.code===0 && !outcome.signal,'IZlauncher preparation failed: '+script);
      report.stages.push({script,completed:new Date().toISOString()});await save();
    }
    async function startOwner(owner){const state=start(owner.script,owner.args,owner.ready,owner.role);activeOwners.set(owner.role,state);
      await bounded(state.readiness,owner.role+' readiness');report.children.push({role:owner.role,script:owner.script});await save();return state;}
    graphics=await startOwner(owners[0]);
    await bounded((async()=>{while(!graphics.frameReady){check(!graphics.closed,'The graphics worker ended before its frame loop started.');
      if(stopping)throw Error('IZlauncher stopped before its frame worker started.');await new Promise(resolve=>setTimeout(resolve,20));}})(),'console graphics readiness');
    await frameProof(directory,report.session);
    const catalog=await readJSON(path.join(directory,'app-runtime.json'));
    check(catalog.session===report.session && Array.isArray(catalog.catalog?.apps),'IZlauncher app catalog belongs to another session.');
    await startOwner(owners[1]);
    if(catalog.catalog.apps.some(app=>Object.keys(app.effects||{}).length))await startOwner(owners[2]);
    check(live() && !stopping,'The original RPC session ended during launcher preparation.');
    await frameProof(directory,report.session);report.status='running';await save();
    safeEmit('running',{message:'IZlauncher is running. Keep SmileBASIC and mac2jb open.'});await stopRequested;
  } catch(error){failure ||= error;stop();}
  finally {
    clearInterval(monitor);stopping=true;
    // Drain auxiliary owners and the native frame worker before allowing the original RPC owner to finish.
    for(const role of ['ftp','audio','graphics'])await end(activeOwners.get(role));
    for(const state of [...children])await end(state);
    acceptingRPC=false;
    if(nativeTouched){
      try {check(graphics,'IZlauncher preparation did not reach a verified graphics shutdown.');
        const loop=await frameProof(directory,report.session,true);report.shutdown={graphics:{completed:loop.completed,threadRunning:false}};
        if(activeOwners.has('audio')){const sound=await readJSON(path.join(directory,'game-audio.json'));
          check(sound.session===report.session && sound.completed && !sound.error && !sound.stopError,'IZlauncher did not verify audio shutdown.');report.shutdown.audio={completed:sound.completed};}
      }catch(error){cleanupBlocked=true;failure ||= error;}
    }
    try{const outcomes=await bounded(Promise.allSettled([...pendingRPC]),'RPC drain',options.stopTimeoutMs||90000,false);
      check(outcomes.every(outcome=>outcome.status==='fulfilled'),'IZlauncher RPC shutdown could not be confirmed.');}
    catch(error){cleanupBlocked ||= nativeTouched;failure ||= error;}
    try{await proxy?.close();}catch(error){failure ||= error;}
    report.completed=new Date().toISOString();report.status=failure?'failed':'stopped';report.cleanupBlocked=cleanupBlocked;
    if(failure)report.error=failure.message;
    try{
      await save();
      if(failure)safeEmit('failed',{message:failure.message+' This launch was not retried.'+(cleanupBlocked?' Restart the console before releasing its retained resources.':''),cleanupBlocked});
      else safeEmit('stopped',{message:'IZlauncher stopped. Graphics allocations remain owned by this console session.'});
      if(!options.emit)await new Promise(resolve=>process.stdout.write('',resolve));
    }finally{
      process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);options.signal?.removeEventListener('abort',stop);
      process.stdout.removeListener('error',stdoutError);
    }
  }
  if(failure){failure.homebrewReported=true;failure.cleanupBlocked=cleanupBlocked;throw failure;}return {directory,stopped:true};
}
module.exports={main,argumentsFor,verifyProcessIdentity,frameProof,runtimeEnvironment,verifyRuntime,stages,owners,FRAME_READY,REVISION};
if(require.main===module)(async()=>{
  if(process.argv.length===3 && process.argv[2]==='--self-test'){
    await verifyRuntime(path.resolve(__dirname,'..'));console.log('IZlauncher held-RPC adapter self-test passed.');return;
  }await main();
})().catch(error=>{if(!error.homebrewReported)try{process.stdout.write('MAC2JB_HOMEBREW '+JSON.stringify({type:'failed',message:error.message,cleanupBlocked:false})+'\n');}catch{}process.exitCode=1;});
