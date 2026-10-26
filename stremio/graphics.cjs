'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const P=require('./protocol.cjs');
const root=path.resolve(__dirname,'..'),HBL=path.join(root,'vendor/HBLauncher');
const code=require('../vendor/HBLauncher/smilebasic/engine/switch2/app/thread-code.json').functions;
const timing=require('../vendor/HBLauncher/smilebasic/engine/switch2/app/timing-code.json').functions;
const check=(condition,message)=>{if(!condition)throw Error(message);};
const struct=(size,type,words={},pointers={})=>{
  const bytes=Buffer.alloc(size);bytes.writeUInt32LE(type);
  for(const [offset,value]of Object.entries(words))bytes.writeUInt32LE(value,+offset);
  for(const [offset,value]of Object.entries(pointers))bytes.writeBigUInt64LE(BigInt(value),+offset);
  return bytes;
};
async function readJSON(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function setup(directory,onProgress){
  const scripts=require('../scripts/gui-homebrew.cjs').stages;
  for(const [script,...args]of scripts){
    onProgress('Preparing '+script);
    await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[path.join(HBL,script),directory,...args],{
        cwd:HBL,env:require('../scripts/gui-homebrew.cjs').runtimeEnvironment(root),stdio:['ignore','pipe','pipe']});
      let output='',timedOut=false,killTimer;
      for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{output=(output+bytes.toString()).slice(-65536);});
      const timer=setTimeout(()=>{
        timedOut=true;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),5000);
      },300000);
      child.once('error',error=>{clearTimeout(timer);clearTimeout(killTimer);reject(error);});
      child.once('close',(status,signal)=>{
        clearTimeout(timer);clearTimeout(killTimer);
        if(timedOut)reject(Error(script+' timed out; restart the console.'));
        else status===0&&!signal?resolve():reject(Error(script+' failed: '+output));
      });
    });
  }
}
function frameData({base,resources,commands}){
  const control=base+0x1000,data=Buffer.alloc(0x9000);
  const put=(offset,bytes)=>bytes.copy(data,offset),u64=(offset,value)=>data.writeBigUInt64LE(BigInt(value),offset);
  put(0x100,struct(56,1000060010,{48:1},{16:resources.swapchain,24:0xffffffffffffffffn,32:resources.acquired}));
  u64(0x200,resources.acquired);data.writeUInt32LE(0x400,0x210);u64(0x220,resources.swapchain);
  data.writeUInt32LE(32,0x230);data.writeUInt32LE(0,0x234);
  const semaphore=control+0x800;u64(0x850,control+0x880);
  resources.semaphores.forEach((value,index)=>u64(0x880+index*8,value));
  put(0x600,struct(64,1000001001,{16:1,32:1},{24:semaphore+0x28,40:control+0x220,48:control}));
  for(let phase=0;phase<commands.length;phase++){
    const offset=0x1000+phase*0x100,object=control+offset;u64(offset+0x50,object+0x60);
    commands[phase].forEach((value,index)=>u64(offset+0x60+index*8,value));
    put(offset+0x80,struct(72,4,{16:1,40:1,56:1},
      {24:control+0x200,32:control+0x210,48:object+0x28,64:semaphore+0x28}));
  }
  return {data,control,semaphore};
}
function frameCalls({sdk,control,semaphore,resources,commands,functions,inputs,lookup,frameCount=12}){
  const calls=[],checks=[];
  const add=(address,args=[],expectZero=false)=>{
    if(expectZero)checks.push(calls.length);
    calls.push({function:address,args:[...args,...Array(4-args.length).fill(0)]});
  };
  add(sdk+timing.tick.offset);
  for(let frame=0;frame<frameCount;frame++){
    for(const input of inputs)add(input.address,input.args);
    const object=control+0x1000+(frame%commands.length)*0x100;
    add(functions.vkAcquireNextImage2KHR,[String(resources.device),control+0x100,control],true);
    add(lookup,[object,{u32:control}]);add(lookup,[semaphore,{u32:control}]);
    add(functions.vkQueueSubmit,[String(resources.queue),1,object+0x80,0],true);
    add(functions.vkQueuePresentKHR,[String(resources.queue),control+0x600],true);
    add(functions.vkQueueWaitIdle,[String(resources.queue)],true);
  }
  add(sdk+timing.tick.offset);
  return {calls,checks};
}
async function create({rpc,directory,appDirectory=path.join(__dirname,'app'),onProgress=()=>{}}){
  check(path.isAbsolute(directory)&&path.isAbsolute(appDirectory),'Graphics requires absolute owned session/app paths');
  const file=path.join(directory,'stremio-graphics.json');
  await fs.writeFile(file,'{}',{flag:'wx',mode:0o600});
  const report={session:rpc.a.session,started:new Date().toISOString(),resourcesRetained:true};
  const save=()=>fs.writeFile(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  let thread=null,program,transport,closed=false,base,checks;
  async function stopWorker(){
    if(thread===null)return;
    await program.stop();const deadline=Date.now()+10000;let done=false;
    while(Date.now()<deadline){
      const value=(await rpc.callAddress(rpc.a.sdk+code.tryWait.offset,[thread])).result;
      check(value===0n||value===1n,'Invalid frame worker shutdown state');
      if(value===1n){done=true;break;}await new Promise(resolve=>setTimeout(resolve,20));
    }
    check(done,'Frame worker did not stop; restart the console');
    check((await rpc.callAddress(rpc.a.sdk+code.join.offset,[thread,base+8])).result===0n,'Frame worker join failed');
    thread=null;report.threadRunning=false;
  }
  try{
    try{await fs.access(path.join(directory,'launcher-auto.json'));}
    catch(error){if(error.code!=='ENOENT')throw error;await setup(directory,onProgress);}
    const menu=await readJSON(path.join(directory,'launcher-auto.json'));
    const qualified=await readJSON(path.join(directory,'launcher-auto-check.json'));
    check(menu.session===rpc.a.session&&menu.ready&&menu.scratchRestored&&qualified.session===rpc.a.session&&
      qualified.passed&&qualified.scratchRestored,'Graphics preparation belongs to another or incomplete session');
    onProgress('Preparing the Stremio media display');
    const app=await require('../vendor/HBLauncher/homebrew-launcher/app-catalog.cjs').readApp(appDirectory);
    check(app.id==='stremio-experimental'&&app.files.memory?.allocationBytes===P.MEMORY_BYTES,'Unexpected media package layout');
    const gpu=await require('../vendor/HBLauncher/homebrew-launcher/gpu-app.cjs').prepare(rpc,menu,app,directory);
    check(gpu.ready&&gpu.scratchRestored&&gpu.privateStorage?.bytes===P.MEMORY_BYTES,'Media graphics did not verify');
    const mapped=gpu.privateStorage.mapped;
    check(Number.isSafeInteger(mapped)&&mapped>0,'Invalid owned media buffer');
    report.mapped=mapped;report.bytes=P.MEMORY_BYTES;
    await rpc.write(mapped,P.initialMemory());
    const benchmark=Buffer.alloc(32768,0xa5),benchmarkAddress=mapped+P.HEADER_BYTES+2*P.SLOT_BYTES;
    const started=performance.now();await rpc.write(benchmarkAddress,benchmark);
    report.benchmark={uploadBytes:benchmark.length,uploadMs:performance.now()-started};
    check((await rpc.read(benchmarkAddress,benchmark.length)).equals(benchmark),'Owned upload benchmark readback failed');
    await rpc.write(benchmarkAddress,Buffer.alloc(32768));
    for(const entry of [...Object.values(code),timing.tick])
      await rpc.request({command:'verify-function',address:rpc.a.sdk+entry.offset,hex:entry.bytes.slice(0,512)});
    const lookup=rpc.a.sdk+0x45c288;
    await rpc.request({command:'verify-function',address:lookup,
      hex:require('../vendor/HBLauncher/smilebasic/reference/sdk-checks.cjs').bytes(0x45c288,16).toString('hex')});
    await rpc.request({command:'verify-function',address:rpc.a.sdk+0x586fb0,
      hex:require('../vendor/HBLauncher/sdk/native/ipc-functions.json').copy.hex});
    const module=await readJSON(path.join(directory,'compatibility-module.json')),verified=new Set([lookup]);
    for(const name of ['vkAcquireNextImage2KHR','vkQueueSubmit','vkQueuePresentKHR','vkQueueWaitIdle']){
      const symbol=module.symbols.find(row=>row.name===name&&row.section&&row.type===2);
      check(symbol&&module.base+symbol.offset===menu.functions[name],'Graphics function changed: '+name);
      const address=menu.functions[name];
      await rpc.request({command:'verify-function',address,hex:(await rpc.read(address,32)).toString('hex')});verified.add(address);
    }
    const allocation=await rpc.call(5732112,[rpc.output,4096,0x400000]);
    check(allocation.result===0n,'Frame worker allocation failed');base=Number(allocation.output.readBigUInt64LE());
    check(Number.isSafeInteger(base)&&base>0&&base%4096===0,'Invalid owned frame worker allocation');
    const state=frameData({base,resources:menu.resources,commands:gpu.commands});await rpc.write(state.control,state.data);
    const inspection=await readJSON(path.join(directory,'input-inspection.json'));
    check(inspection.session===rpc.a.session,'Input belongs to another session');
    const inputs=[];
    for(const [index,kind]of ['Handheld','FullKey','JoyDual','JoyLeft','JoyRight'].entries()){
      const match=Object.entries(inspection.imports).find(([name])=>name.includes('GetNpadState')&&name.includes('Npad'+kind+'State'));
      if(!match?.[1]?.bytes){check(index!==0,'Required handheld input is missing');continue;}
      const entry=match[1];
      check(Number((await rpc.read(rpc.a.main+entry.slot,8)).readBigUInt64LE())===entry.target,'Controller import changed');
      await rpc.request({command:'verify-function',address:entry.target,hex:entry.bytes.slice(0,64)});verified.add(entry.target);
      inputs.push({address:entry.target,args:[index===0?menu.controls.mapped:mapped+2048+(index-1)*64,
        state.control+(index===0?0x230:0x234)]});
    }
    const plan=frameCalls({sdk:rpc.a.sdk,...state,resources:menu.resources,commands:gpu.commands,
      functions:menu.functions,inputs,lookup});checks=plan.checks;
    program=await require('../vendor/HBLauncher/sdk/native/repeating.cjs').prepare(rpc,{base,code,calls:plan.calls,verified});
    report.frameBytes=program.frame.length;report.framesPerCycle=12;
    check((await rpc.callAddress(rpc.a.sdk+code.create.offset,[base,0,rpc.a.sdk+code.longjmp.offset,program.live])).result===0n,
      'Native frame worker did not start');
    thread=(await rpc.read(base,8)).readBigUInt64LE();check(thread!==0n,'Invalid frame worker identity');
    report.thread=String(thread);report.threadRunning=true;await save();
    transport=P.createTransport({rpc,mapped});
    const deadline=Date.now()+10000;
    for(;;){
      const results=await rpc.read(program.results,program.addresses.length*8);
      if(results.readBigUInt64LE((program.addresses.length-1)*8)!==0n){
        check(checks.every(index=>results.readBigUInt64LE(index*8)===0n),'The first native media presentation cycle failed');
        break;
      }
      check(Date.now()<deadline,'The media frame worker did not complete its first presentation cycle');
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    check((await transport.poll()).presentedFrames>0,'The media compute shader did not acknowledge its first presentation cycle');
    report.firstCycleVerified=true;await save();
    onProgress('Media display ready; owned upload benchmark '+report.benchmark.uploadMs.toFixed(1)+' ms per32KiB');
    let lastResults=0;
    return {
      report,
      get publishedFrameSeq(){return transport.publishedFrameSeq;},
      publish:(bytes,ptsMs)=>transport.publish(bytes,ptsMs),
      async poll(){
        const result=await transport.poll();
        if(Date.now()-lastResults>2000){
          const replies=await rpc.read(program.results,program.addresses.length*8);
          check(checks.every(index=>replies.readBigUInt64LE(index*8)===0n),'The native media frame worker reported a graphics error');
          lastResults=Date.now();
        }
        return result;
      },
      async close(){
        if(closed)return;closed=true;await transport.close();
        try{
          await stopWorker();
          report.completed=new Date().toISOString();report.transport=transport.stats;await save();
        }catch(error){report.error=error.message;await save();throw error;}
      }
    };
  }catch(error){
    report.error=error.message;
    try{await transport?.close();await stopWorker();}catch(cleanupError){report.cleanupError=cleanupError.message;}
    report.threadRunning=thread!==null;await save();throw error;
  }
}
module.exports={create,setup,frameData,frameCalls,...P};
