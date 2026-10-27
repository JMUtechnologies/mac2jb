#!/usr/bin/env node
'use strict';
// GPU launcher runtimes attached to an already verified held session.
process.umask(0o077);
const fs = require('node:fs/promises');
const sync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const {spawn} = require('node:child_process');
const commands = new Set(['status','call','verify-function','call-address','pair','read','write','query']);
const stages = [
  ['homebrew-launcher/inspect-display.cjs'],
  ['homebrew-launcher/inspect-compatibility.cjs'],
  ['homebrew-launcher/inspect-input.cjs'],
  ['homebrew-launcher/vulkan-copy.cjs','display'],
  ['homebrew-launcher/launcher.cjs','auto'],
  ['homebrew-launcher/launcher-check.cjs','auto']
];
const owners = [
  {role:'graphics', script:'homebrew-launcher/launcher-loop.cjs', args:['auto'], ready:'GPUBrewLauncher game event source ready.'},
  {role:'ftp', script:'sdk/host/ftp-service.cjs', args:[], ready:'SDK FTP service ready.'},
  {role:'audio', script:'homebrew-launcher/game-audio.cjs', args:[], ready:'Game sound effects ready.'}
];
function applicationConfig(application='gpubrewlauncher') {
  if(application==='hblauncher')return {id:application,vendor:'HBLauncher',name:'HBLauncher',
    version:'0.2.0',source:{tag:'v0.2.0',commit:'b40723be04baa51e5d1f121a1e2242c4167b6cbc'},
    owners:owners.map(owner=>owner.role==='graphics'?{...owner,ready:'HBLauncher game event source ready.'}:owner),
    frameReady:'HBLauncher continuous native frame loop running.'};
  if(application!=='gpubrewlauncher')throw Error('Unknown homebrew application: '+application);
  return {id:application,vendor:'GPUBrewLauncher',name:'GPUBrewLauncher',
    version:'snapshot-f35ff64',source:{commit:'f35ff64ea4b9b42cf2a75095d24662fe250f03e4'},owners,
    frameReady:'GPUBrewLauncher continuous native frame loop running.'};
}
const check = (value, message) => {if (!value) throw Error(message);};
async function privatePath(file, directory = false) {
  const absolute = path.resolve(file), info = await fs.lstat(absolute);
  check(!info.isSymbolicLink() && (directory ? info.isDirectory() : info.isFile()) &&
    info.uid === process.getuid() && (info.mode & 0o077) === 0 &&
    await fs.realpath(absolute) === absolute, 'Expected a private owned session path: ' + absolute);
  return absolute;
}
async function json(file) {await privatePath(file); return JSON.parse(await fs.readFile(file,'utf8'));}
function writeJSON(file, value, exclusive = false) {
  return fs.writeFile(file, JSON.stringify(value,null,2)+'\n', {mode:0o600,flag:exclusive?'wx':'w'});
}
async function validateRun(root, candidate, verifySession) {
  const directory = await privatePath(candidate,true);
  const runs = await fs.realpath(path.join(root,'vendor/ns2jb/runs')).catch(error=>{
    if(error.code==='ENOENT')return null;throw error;
  });
  if(path.dirname(directory)!==runs)
    await require('./rpc-attachment.cjs').validateManifest(root,directory);
  const proof = await verifySession(directory);
  const connection = await json(path.join(directory,'connection.json'));
  check(proof.root === directory && proof.session === path.basename(directory) &&
    Number.isSafeInteger(connection.port) && connection.port >= 1 && connection.port <= 65535 &&
    connection.addresses?.session === proof.session && connection.addresses?.target === 'switch2' &&
    connection.addresses?.platform === 2, 'The held native connection belongs to another session.');
  for (const name of ['scratch','main','sdk','backing','controller'])
    check(Number.isSafeInteger(connection.addresses[name]) && connection.addresses[name] >= 4096 &&
      connection.addresses[name] < 2 ** 39, 'Invalid held native address: ' + name);
  return {directory,proof,connection};
}
function proxyHandler({token, request, live = () => true}) {
  return async (req,res) => {
    if (req.method !== 'POST' || req.url !== '/' || req.headers.authorization !== 'Bearer '+token) {
      res.writeHead(403).end();return;
    }
    try {
      check(live(), 'The original held RPC session is no longer available.');
      const parts=[];let length=0;
      for await (const part of req) {
        length+=part.length;check(length<=2*1024*1024,'Bridge request is too large');parts.push(part);
      }
      const body=JSON.parse(Buffer.concat(parts));
      check(body && typeof body==='object' && !Array.isArray(body) && commands.has(body.command),
        'Unknown homebrew bridge command');
      const reply=await request(body); // The original bridge serializes all native operations.
      if (!res.destroyed) {
        res.setHeader('content-type','application/json');
        res.end(JSON.stringify(reply,(_,value)=>typeof value==='bigint'?value.toString():value));
      }
    } catch(error) {
      if (!res.destroyed) res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:error.message}));
    }
  };
}
async function serveProxy(options) {
  const token=crypto.randomBytes(32).toString('hex');
  const server=http.createServer(proxyHandler({...options,token}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {token,port:server.address().port,async close(){
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }};
}
function runtimeEnvironment(root, inherited = process.env, application='gpubrewlauncher') {
  const selected=applicationConfig(application);
  const env={...inherited,
    PATH:[path.join(root,'homebrew/python/bin'),path.join(root,'homebrew/bin'),inherited.PATH||''].join(path.delimiter),
    SPIRV_VAL:path.join(root,'homebrew/bin/spirv-val'),
    PYTHONPATH:path.join(root,'homebrew/python-custom'),
    PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',
    MAC2JB_HBLAUNCHER_FONT:path.join(root,'homebrew/fonts/DejaVuSans.ttf'),
    HB_APPS_DIR:path.join(root,'vendor',selected.vendor,'apps')};
  delete env.PYTHONHOME;return env;
}
async function checkRuntime(root) {
  for(const file of ['homebrew/python/bin/python3','homebrew/bin/spirv-val'])
    await fs.access(path.join(root,file),sync.constants.X_OK);
  for(const file of ['homebrew/fonts/DejaVuSans.ttf','homebrew/python-custom/sitecustomize.py'])
    check((await fs.lstat(path.join(root,file))).isFile(),'Missing packaged homebrew dependency: '+file);
}
function lines(stream, callback) {
  let pending='';
  stream.on('data',bytes=>{
    pending+=bytes.toString();
    let at;while((at=pending.search(/[\r\n]/))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);if(line)callback(line);}
    if(pending.length>65536){callback(pending.slice(0,65536));pending='';}
  });
  stream.on('end',()=>{if(pending)callback(pending);});
}
async function main(args = process.argv.slice(2), options = {}) {
  check(args.length===1,'Usage: gui-homebrew.cjs RUN_DIRECTORY');
  const selected=applicationConfig(options.application), root=options.root||path.resolve(__dirname,'..');
  const vendor=path.join(root,'vendor',selected.vendor);
  const emit=options.emit||((type,fields={})=>process.stdout.write('MAC2JB_HOMEBREW '+JSON.stringify({type,...fields})+'\n'));
  const run=await validateRun(root,args[0],options.verifySession||require('./gui-dump.cjs').verifiedSession);
  await (options.checkRuntime||checkRuntime)(root);
  const request=options.request||require(path.join(root,'vendor/ns2jb/rpc.cjs')).request;
  const status=await request(run.directory,{command:'status'});
  check(status?.ready===true,'The existing native RPC connection is not ready.');
  await writeJSON(path.join(run.directory,'.mac2jb-hblauncher-attempt.json'),{
    application:selected.id,source:selected.name,...selected.source,started:new Date().toISOString()
  },true);
  const parent=path.join(root,'runs');await fs.mkdir(parent,{recursive:true,mode:0o700});
  await privatePath(parent,true);
  const directory=await fs.mkdtemp(path.join(await fs.realpath(parent),selected.id+'-'));
  const report={session:path.basename(directory),sourceSession:run.proof.session,sourceDirectory:run.directory,
    application:selected.id,version:selected.version,source:selected.source,started:new Date().toISOString(),status:'preparing',stages:[],children:[],resourcesRetained:true};
  const reportFile=path.join(directory,'mac2jb-homebrew.json');
  const save=()=>writeJSON(reportFile,report);
  let proxy,stopping=false,running=false,failure,monitor,stopResolve;
  const stopRequested=new Promise(resolve=>{stopResolve=resolve;});
  const children=new Set();
  function stop(){if(!stopping){stopping=true;stopResolve();}}
  const fail=error=>{failure ||= error;stop();};
  const safeEmit=(type,fields={})=>{
    try{emit(type,{path:directory,...fields});}catch(error){if(error.code!=='EPIPE')throw error;stop();}
  };
  const stdoutError=error=>{if(error.code!=='EPIPE')failure ||= error;stop();};
  process.stdout.on('error',stdoutError);
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
  function live(){
    try{
      const current=JSON.parse(sync.readFileSync(path.join(run.directory,'result.json'),'utf8'));
      const connection=JSON.parse(sync.readFileSync(path.join(run.directory,'connection.json'),'utf8'));
      return current.verified===true && !current.error && current.rpc?.mode==='held' &&
        current.rpc?.state==='listening' && connection.port===run.connection.port &&
        connection.addresses?.session===run.proof.session &&
        current.fs?.verified===true && current.fs?.restored===true &&
        current.fs?.retainedEndpoint?.ready===true && current.fs?.cleanup?.deferred===true;
    }catch{return false;}
  }
  function start(script,extra=[],readyText,role='prepare'){
    check(!stopping,selected.name+' launch was stopped.');
    const child=spawn(process.execPath,[path.join(vendor,script),directory,...extra],{
      cwd:vendor,env:runtimeEnvironment(root,process.env,selected.id),stdio:['ignore','pipe','pipe']
    });
    const state={child,script,role,closed:false,ready:false,frameReady:false,output:''};children.add(state);
    let readyResolve,readyReject;
    state.readiness=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    state.readiness.catch(()=>{});
    const observe=line=>{
      state.output=(state.output+line+'\n').slice(-32768);
      if(readyText && line.trim()===readyText){state.ready=true;readyResolve();}
      if(line.trim()===selected.frameReady)state.frameReady=true;
      safeEmit('progress',{message:script+': '+line});
    };
    lines(child.stdout,observe);lines(child.stderr,observe);
    state.done=new Promise(resolve=>{
      child.once('error',error=>{state.closed=true;readyReject(error);resolve({code:null,error});});
      child.once('close',(code,signal)=>{
        state.closed=true;state.outcome={code,signal};children.delete(state);
        readyReject(Error(script+' ended before readiness.'));
        if(role!=='prepare'&&!stopping)fail(Error(script+' ended unexpectedly: '+(signal||code)));
        resolve(state.outcome);
      });
    });
    return state;
  }
  async function wait(promise,label){
    let timer;
    try{return await Promise.race([promise,stopRequested.then(()=>{throw Error(selected.name+' stopped during '+label);}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out.')),options.startTimeoutMs||300000);})]);}
    finally{clearTimeout(timer);}
  }
  async function end(state){
    if(!state||state.closed)return;
    let timer,timedOut=false;
    state.child.kill('SIGTERM');
    const outcome=await Promise.race([state.done,new Promise(resolve=>{
      timer=setTimeout(()=>{timedOut=true;state.child.kill('SIGKILL');resolve({code:null});},options.stopTimeoutMs||90000);
    })]);clearTimeout(timer);
    if(timedOut||outcome.error||outcome.code!==0)
      failure ||= Error(selected.name+' '+state.role+' did not confirm a clean stop. Restart the console.');
    if(timedOut)await state.done;
  }
  let graphics;const activeOwners=new Map();
  try{
    proxy=await (options.serveProxy||serveProxy)({live,request:body=>request(run.directory,body)});
    await fs.mkdir(path.join(directory,'shared'),{mode:0o700});
    await fs.copyFile(path.join(vendor,'smilebasic/engine/shared/rpc.cjs'),path.join(directory,'shared/rpc.cjs'));
    await fs.chmod(path.join(directory,'shared/rpc.cjs'),0o600);
    await writeJSON(path.join(directory,'connection.json'),{
      port:proxy.port,token:proxy.token,addresses:{...run.connection.addresses,session:report.session}});
    await save();safeEmit('started',{message:'Attaching '+selected.name+' to the existing RPC session.'});
    monitor=setInterval(()=>{if(!live())fail(Error('The original held RPC session ended. Restart the console.'));},500);
    monitor.unref();
    for(const [script,...extra]of stages){
      safeEmit('progress',{message:'Preparing '+script});
      const state=start(script,extra);const outcome=await wait(state.done,script);
      check(!outcome.error&&outcome.code===0&&!outcome.signal,selected.name+' preparation failed: '+script);
      report.stages.push({script,completed:new Date().toISOString()});await save();
    }
    for(const owner of selected.owners){
      const state=start(owner.script,owner.args,owner.ready,owner.role);
      activeOwners.set(owner.role,state);if(owner.role==='graphics')graphics=state;
      await wait(state.readiness,owner.role+' readiness');report.children.push({role:owner.role,script:owner.script});await save();
    }
    // This second marker proves the console frame worker actually started.
    await wait((async()=>{while(!graphics.frameReady){
      check(!graphics.closed,'The graphics worker ended before its frame loop started.');
      await new Promise(resolve=>setTimeout(resolve,20));
    }})(),'console graphics readiness');
    check(live(),'The original RPC session ended during launcher preparation.');
    running=true;report.status='running';await save();
    safeEmit('running',{message:selected.name+' is running. Keep SmileBASIC and mac2jb open.'});
    await stopRequested;
  }catch(error){failure ||= error;stop();}
  finally{
    clearInterval(monitor);stopping=true;
    // FTP and audio finish while graphics and the original RPC remain live.
    for(const role of ['ftp','audio','graphics'])await end(activeOwners.get(role));
    for(const state of [...children])await end(state);
    if(running){
      try{
        const loop=await json(path.join(directory,'launcher-auto-loop.json'));
        const sound=await json(path.join(directory,'game-audio.json'));
        check(loop.session===report.session&&loop.completed&&!loop.error&&loop.threadRunning===false&&
          sound.session===report.session&&sound.completed&&!sound.error&&!sound.stopError,
        selected.name+' did not verify its graphics and audio shutdown.');
        report.shutdown={graphics:{completed:loop.completed,threadRunning:loop.threadRunning},
          audio:{completed:sound.completed}};
      }catch(error){failure ||= error;}
    }
    await proxy?.close();
    report.completed=new Date().toISOString();report.status=failure?'failed':'stopped';
    if(failure)report.error=failure.message;await save();
    process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
    if(failure)safeEmit('failed',{message:failure.message+' This launch was not retried. Finish RPC and restart the console.'});
    else safeEmit('stopped',{message:selected.name+' stopped. Graphics allocations remain owned by this console session.'});
  }
  if(failure){failure.homebrewReported=true;throw failure;}
  return {directory,stopped:true};
}
module.exports={main,validateRun,proxyHandler,serveProxy,runtimeEnvironment,stages,owners,applicationConfig};
if(require.main===module)main().catch(error=>{
  if(error.homebrewReported){process.exitCode=1;return;}
  try{process.stdout.write('MAC2JB_HOMEBREW '+JSON.stringify({type:'failed',
    message:error.message+' This launch was not retried. Finish RPC and restart the console.'})+'\n');}catch{}
  process.exitCode=1;
});
