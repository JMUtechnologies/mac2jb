#!/usr/bin/env node
'use strict';
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{performance}=require('node:perf_hooks');
const {PROFILES}=require('./quality.cjs');
const check=(condition,message)=>{if(!condition)throw Error(message);};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function parseArgs(args){
  if(args.length===1&&args[0]==='--self-test')return {selfTest:true};
  const config={samples:20,warmup:10,rounds:1,qualities:['360p','720p']};
  const seen=new Set();
  for(let i=0;i<args.length;i++){
    const key=args[i];if(key==='--help')return {help:true};
    check(['--run','--output','--samples','--warmup','--rounds','--quality'].includes(key)&&args[i+1]!==undefined&&!seen.has(key),'Unknown, repeated or incomplete benchmark option: '+key);seen.add(key);
    const value=args[++i];
    if(key==='--run'||key==='--output'){check(path.isAbsolute(value)&&!/[\x00-\x1f]/.test(value),'Use an absolute path for '+key);config[key.slice(2)]=value;}
    else if(key==='--quality'){check(Object.hasOwn(PROFILES,value),'Choose 180p, 360p, 540p or 720p.');config.qualities=[value];}
    else{const n=Number(value),minimum=key==='--warmup'?0:1,maximum=key==='--rounds'?4:120;
      check(/^\d+$/.test(value)&&Number.isInteger(n)&&n>=minimum&&n<=maximum,'Invalid benchmark count for '+key);config[key.slice(2)]=n;}
  }
  check(config.run&&config.output,'Usage: benchmark-console.cjs --run EXISTING_HELD_RUN --output NEW_REPORT_PATH [--quality 360p|720p] [--samples N] [--warmup N] [--rounds N]');
  return config;
}
function makeFrames(profile,count){
  return Array.from({length:count},(_,index)=>{
    const bytes=Buffer.alloc(profile.width*profile.height/2);
    // valid encoded blocks isolate transport from source decoding and encoding time.
    for(let at=0;at<bytes.length;at+=8){bytes.writeUInt16LE(0xf800,at);bytes.writeUInt16LE(0x001f,at+2);bytes.writeUInt32LE((0xe4e4e4e4^(Math.floor(at/8)+index*0x01010101))>>>0,at+4);}
    return bytes;
  });
}
function distribution(values){const sorted=[...values].sort((a,b)=>a-b),round=n=>Number(n.toFixed(3));return {p50:round(sorted[Math.ceil(sorted.length*.5)-1]),p95:round(sorted[Math.ceil(sorted.length*.95)-1]),max:round(sorted.at(-1)),samples:values.map(round)};}
async function measure(graphics,config,{active=()=>{},beforeBlock=async()=>{},afterBlock=async()=>{},onBlock=async()=>{}}={}){
  const results=[];let ptsMs=0;
  for(let qualityIndex=0;qualityIndex<config.qualities.length;qualityIndex++){
    const quality=config.qualities[qualityIndex],profile=PROFILES[quality],frames=makeFrames(profile,config.warmup+config.samples);
    const datasetSha256=crypto.createHash('sha256');for(const frame of frames)datasetSha256.update(frame);
    const digest=datasetSha256.digest('hex');
    for(let round=0;round<config.rounds;round++)for(const mode of (round+qualityIndex)%2?['dedicated','rpc']:['rpc','dedicated']){
      active();await graphics.setTransportMode(mode);active();const before=await beforeBlock();
      const upload=[],acknowledged=[],polls=[];let warmupEnded;
      for(let index=0;index<frames.length;index++){
        active();if(index===config.warmup)warmupEnded=await beforeBlock();
        ptsMs+=Math.round(1000/profile.fps);const start=performance.now();
        check(await graphics.publish(frames[index],ptsMs,{width:profile.width,height:profile.height}),'A benchmark frame was dropped before publication');
        const uploaded=performance.now(),sequence=graphics.publishedFrameSeq,deadline=uploaded+10000;let state,pollCount=0;
        do{active();state=await graphics.poll();pollCount++;
          check(state.activeFrameSeq<=sequence,'GPU acknowledgement advanced beyond the benchmark frame');
          if(state.activeFrameSeq===sequence)break;
          check(performance.now()<deadline,'GPU did not acknowledge the complete benchmark frame within 10 seconds');await delay(2);
        }while(true);
        check(state.activePtsMs===ptsMs,'GPU acknowledgement has the wrong benchmark timestamp');active();
        if(index>=config.warmup){upload.push(uploaded-start);acknowledged.push(performance.now()-start);polls.push(pollCount);}
      }
      const after=await afterBlock();
      const result={quality,width:profile.width,height:profile.height,mode,round:round+1,warmupFrames:config.warmup,measuredFrames:config.samples,
        bc1BytesPerFrame:frames[0].length,datasetSha256:digest,uploadMs:distribution(upload),gpuAcknowledgedMs:distribution(acknowledged),polls,
        nativeCalls:typeof after?.calls==='number'&&typeof warmupEnded?.calls==='number'?after.calls-warmupEnded.calls:null,
        warmupNativeCalls:typeof warmupEnded?.calls==='number'&&typeof before?.calls==='number'?warmupEnded.calls-before.calls:null};
      results.push(result);await onBlock(result);
    }
  }
  return results;
}
async function environment(root){
  let toolsRoot;
  for(const candidate of [path.join(root,'homebrew'),path.join(root,'.build-gui/homebrew')]){
    try{await fs.access(path.join(candidate,'python/bin/python3'),sync.constants.X_OK);toolsRoot=await fs.realpath(candidate);break;}catch(error){if(!['ENOENT','EACCES'].includes(error.code))throw error;}
  }
  check(toolsRoot,'Prepare the existing bundled homebrew runtime before benchmarking.');
  const env={...require('../scripts/gui-homebrew.cjs').runtimeEnvironment(root),
    PATH:[path.join(toolsRoot,'python/bin'),path.join(toolsRoot,'bin'),process.env.PATH||''].join(path.delimiter),
    SPIRV_VAL:path.join(toolsRoot,'bin/spirv-val'),PYTHONPATH:path.join(toolsRoot,'python-custom'),
    MAC2JB_HBLAUNCHER_FONT:path.join(toolsRoot,'fonts/DejaVuSans.ttf')};
  await fs.access(env.SPIRV_VAL,sync.constants.X_OK);await fs.access(env.MAC2JB_HBLAUNCHER_FONT,sync.constants.R_OK);
  await fs.access(path.join(env.PYTHONPATH,'sitecustomize.py'),sync.constants.R_OK);
  const manifest=await fs.readFile(path.join(root,'packaging/stremio-display-SHA256SUMS'),'utf8');
  for(const line of manifest.trim().split('\n')){
    const match=/^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line);check(match&&!path.isAbsolute(match[2])&&!match[2].split('/').includes('..'),'Invalid media asset manifest');
    check(crypto.createHash('sha256').update(await fs.readFile(path.join(root,'stremio/app',match[2]))).digest('hex')===match[1],'Media asset hash differs: '+match[2]);
  }
  return env;
}
async function main(args=process.argv.slice(2)){
  const config=parseArgs(args);if(config.selfTest){console.log(JSON.stringify(await selfTest()));return;}
  if(config.help){console.log('Usage: node stremio/benchmark-console.cjs --run EXISTING_HELD_RUN --output NEW_REPORT_PATH [--quality 180p|360p|540p|720p] [--samples 1..120] [--warmup 0..120] [--rounds 1..4]\nThis command uses a live console, consumes its one homebrew attempt, and preserves the original host. Use --self-test for inert model checks only.');return;}
  process.umask(0o077);
  const root=await fs.realpath(path.resolve(__dirname,'..')),output=path.join(await fs.realpath(path.dirname(config.output)),path.basename(config.output));
  const handle=await fs.open(output,'wx',0o600);
  const report={schema:1,scope:'Live console BC1 upload plus GPU consumption acknowledgement; excludes decode, encode and audio, and is not a display scanout measurement.',
    started:new Date().toISOString(),status:'preflight',sourceRun:config.run,config,results:[],resourcesRetained:true,originalHostPreserved:true};
  const save=async()=>{await handle.truncate(0);await handle.write(JSON.stringify(report,null,2)+'\n',0,'utf8');await handle.sync();};
  let context,proxy,graphics,child,childKill,monitor,stopping=false,failure,mutated=false,cleanupBlocked=false,directory;
  const abort=new AbortController(),savedEnv={...process.env};
  const progress=message=>process.stderr.write(message+'\n');
  function stop(reason,uncertain=false){cleanupBlocked ||= uncertain;if(stopping)return;stopping=true;failure ||= Error(reason);abort.abort();context?.abortVerification();
    if(child){const owned=child;owned.kill('SIGTERM');childKill=setTimeout(()=>owned.kill('SIGKILL'),5000);}
    graphics?.abortPending?.().catch(()=>{});}
  const term=()=>stop('Benchmark interrupted; no operation was replayed.'),interrupt=()=>stop('Benchmark cancelled; no operation was replayed.');
  process.on('SIGTERM',term);process.on('SIGINT',interrupt);
  const active=()=>{if(stopping)throw failure||Error('Benchmark stopped');};
  const live=()=>{
    try{const value=JSON.parse(sync.readFileSync(path.join(context.directory,'result.json'),'utf8'));return value.verified===true&&value.rpc?.mode==='held'&&value.rpc?.state==='listening'&&!value.error;}catch{return false;}
  };
  async function stage(script,extra,env){
    active();mutated=true;const vendor=path.join(root,'vendor/GPUBrewLauncher');progress('Preparing '+path.basename(script));
    child=spawn(process.execPath,[path.join(vendor,script),directory,...extra],{cwd:vendor,env,stdio:['ignore','pipe','pipe']});
    const owned=child;let output='';
    for(const stream of [owned.stdout,owned.stderr])stream.on('data',bytes=>{output=(output+bytes.toString()).slice(-8192);});
    const timeout=setTimeout(()=>stop('Graphics preparation timed out.'),300000);
    try{await new Promise((resolve,reject)=>{owned.once('error',reject);owned.once('close',(code,signal)=>code===0&&!signal?resolve():reject(Error('Graphics preparation failed: '+script+'\n'+output)));});active();}
    finally{clearTimeout(timeout);clearTimeout(childKill);childKill=undefined;child=undefined;}
  }
  try{
    await save();const env=await environment(root);delete process.env.PYTHONHOME;Object.assign(process.env,env);
    await require('../vendor/GPUBrewLauncher/homebrew-launcher/app-catalog.cjs').readApp(path.join(root,'stremio/app'));
    require('./receiver-program.cjs').selfTest();active();
    const runPath=await fs.realpath(config.run);context=await require('../scripts/rpc-attachment.cjs').prepare(root,{kind:'local',runDirectory:runPath},{signal:abort.signal});active();
    await context.claimApplication('stremio');active();process.env.MAC2JB_ATTACHED_RUN_MANIFEST=context.manifestPath;
    const {validateRun,serveProxy,stages}=require('../scripts/gui-homebrew.cjs');
    const run=await validateRun(root,context.directory,require('../scripts/gui-dump.cjs').verifiedSession);
    await fs.writeFile(path.join(run.directory,'.mac2jb-hblauncher-attempt.json'),JSON.stringify({application:'Stremio receiver benchmark',started:new Date().toISOString()}),{flag:'wx',mode:0o600});
    const original=require('../vendor/ns2jb/rpc.cjs').request;check((await original(run.directory,{command:'status'})).ready,'The held RPC is not ready');active();
    const parent=path.join(root,'runs');await fs.mkdir(parent,{recursive:true,mode:0o700});directory=await fs.mkdtemp(path.join(await fs.realpath(parent),'stremio-benchmark-'));
    report.sourceRun=run.directory;report.sourceSession=run.proof.session;report.directory=directory;
    proxy=await serveProxy({live,request:body=>original(run.directory,body)});
    await fs.mkdir(path.join(directory,'shared'),{mode:0o700});await fs.copyFile(path.join(root,'vendor/GPUBrewLauncher/smilebasic/engine/shared/rpc.cjs'),path.join(directory,'shared/rpc.cjs'));await fs.chmod(path.join(directory,'shared/rpc.cjs'),0o600);
    await fs.writeFile(path.join(directory,'connection.json'),JSON.stringify({port:proxy.port,token:proxy.token,addresses:{...run.connection.addresses,session:path.basename(directory)}}),{mode:0o600});
    monitor=setInterval(()=>{if(!live())stop('The original held RPC ended; the benchmark stopped.',true);},1000);monitor.unref();
    report.status='preparing';await save();
    for(const [script,...extra]of stages)await stage(script,extra,{...env,MAC2JB_ATTACHED_RUN_MANIFEST:context.manifestPath});
    active();mutated=true;graphics=await require('./graphics.cjs').create({rpc:require(path.join(directory,'shared/rpc.cjs')),directory,appDirectory:path.join(root,'stremio/app'),onProgress:progress});active();
    report.status='measuring';await save();
    await measure(graphics,config,{active,beforeBlock:()=>context.verify(),afterBlock:()=>context.verify(),onBlock:async result=>{report.results.push(result);await save();progress(result.quality+' '+result.mode+': upload p50 '+result.uploadMs.p50+' ms; GPU acknowledgement p95 '+result.gpuAcknowledgedMs.p95+' ms.');}});
    report.status='completed';
  }catch(error){failure ||= error;cleanupBlocked ||= error.cleanupBlocked===true||mutated&&!graphics;report.status='failed';report.error=failure.message;}
  finally{
    clearInterval(monitor);clearTimeout(childKill);context?.abortVerification();
    if(graphics)try{await graphics.close();}catch(error){cleanupBlocked=true;failure ||= error;report.cleanupError=error.message;}
    try{await proxy?.close();}catch(error){failure ||= error;report.proxyError=error.message;}
    try{await context?.close();}catch(error){failure ||= error;report.authorizationError=error.message;}
    report.completed=new Date().toISOString();report.cleanupBlocked=cleanupBlocked;report.cleanShutdown=!cleanupBlocked;
    if(failure){report.status='failed';report.error ||= failure.message;}
    process.removeListener('SIGTERM',term);process.removeListener('SIGINT',interrupt);
    for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];Object.assign(process.env,savedEnv);
    try{await save();}finally{await handle.close();}
  }
  progress('Report: '+output+'. Original host retained; restart the console before another homebrew attempt.');
  if(failure){failure.benchmarkReported=true;throw failure;}return report;
}
async function selfTest(){
  const assert=require('node:assert/strict');let sequence=0,activeSequence=0,pts=0,pendingPoll=false,calls=0;
  const modes=[],payloads=[],config={qualities:['180p'],samples:3,warmup:1,rounds:2};
  const graphics={get publishedFrameSeq(){return sequence;},async setTransportMode(mode){assert.equal(activeSequence,sequence);modes.push(mode);},
    async publish(bytes,time){assert.equal(activeSequence,sequence);payloads.push(crypto.createHash('sha256').update(bytes).digest('hex'));sequence++;pts=time;pendingPoll=true;return true;},
    async poll(){if(pendingPoll){pendingPoll=false;return {activeFrameSeq:activeSequence,activePtsMs:pts};}activeSequence=sequence;return {activeFrameSeq:activeSequence,activePtsMs:pts};}};
  const results=await measure(graphics,config,{beforeBlock:async()=>({calls:++calls}),afterBlock:async()=>({calls:++calls})});
  assert.deepEqual(modes,['rpc','dedicated','dedicated','rpc']);assert.equal(sequence,16);assert.equal(results.length,4);
  assert.ok(results.every(result=>result.measuredFrames===3&&result.uploadMs.samples.length===3&&result.polls.every(count=>count===2)));
  for(let i=4;i<payloads.length;i++)assert.equal(payloads[i],payloads[i%4]);
  assert.equal(new Set(results.map(result=>result.datasetSha256)).size,1);
  const short={qualities:['180p'],samples:1,warmup:0,rounds:1};
  await assert.rejects(measure({...graphics,async publish(){return false;}},short),/dropped/);
  await assert.rejects(measure({...graphics,async poll(){return {activeFrameSeq:sequence+1,activePtsMs:0};}},short),/advanced beyond/);
  await assert.rejects(measure({...graphics,async setTransportMode(){},async publish(){return true;},async poll(){return {activeFrameSeq:sequence,activePtsMs:0};}},short),/wrong benchmark timestamp/);
  await assert.rejects(measure(graphics,short,{active(){throw Error('fixture cancelled');}}),/fixture cancelled/);
  assert.throws(()=>parseArgs(['--run','relative','--output','/tmp/report']),/absolute/);
  assert.throws(()=>parseArgs(['--run','/tmp/run','--output','/tmp/report','--samples','0']),/count/);
  return {passed:true,scope:'inert benchmark measurement fixtures; no files, sockets, console, USB or native operations'};
}
module.exports={main,parseArgs,measure,makeFrames,distribution,selfTest};
if(require.main===module)main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
