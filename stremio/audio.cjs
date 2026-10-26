'use strict';
// Continuous PCM owner using only the SDK routines already qualified by HBL.
const fs=require('node:fs/promises'),path=require('node:path');
const symbols=require('../vendor/HBLauncher/homebrew-launcher/audio-symbols.json');
const sdkImage=require('../vendor/HBLauncher/smilebasic/reference/sdk-checks.cjs');
const RATE=48000,CHANNELS=2,FRAME_BYTES=4,CHUNK_BYTES=19200,SLOTS=8,STRIDE=32768;
const names=['InitializeAudioOutParameter','OpenDefaultAudioOutEPNS0_8AudioOutER',
  'GetAudioOutSampleRate','GetAudioOutChannelCount','GetAudioOutSampleFormat',
  'SetAudioOutBufferInfo','AppendAudioOutBuffer','GetReleasedAudioOutBuffer',
  'GetAudioOutBufferCount','GetAudioOutPlayedSampleCount','StartAudioOut',
  'StopAudioOut','FlushAudioOutBuffers','CloseAudioOut'];
const check=(condition,message)=>{if(!condition)throw Error(message);};
async function create({rpc,directory,definitions=symbols,reference=sdkImage,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  const functions={};
  for(const name of names){
    const matches=definitions.filter(row=>row.name.includes(name));
    check(matches.length===1,'Audio function is missing or ambiguous: '+name);
    const row=matches[0],address=rpc.a.sdk+row.offset;
    await rpc.request({command:'verify-function',address,hex:reference.bytes(row.offset,Math.min(32,row.size)).toString('hex')});
    functions[name]=address;
  }
  const call=async(name,...args)=>(await rpc.callAddress(functions[name],args)).result;
  const allocation=await rpc.call(5732112,[rpc.output,65536,65536+SLOTS*STRIDE]);
  check(allocation.result===0n,'Audio allocation failed');
  const base=Number(allocation.output.readBigUInt64LE());
  check(Number.isSafeInteger(base)&&base>0&&base%65536===0,'Invalid owned audio allocation');
  await rpc.write(base,Buffer.alloc(65536));
  const audio=base,param=base+0x300,descriptors=Array.from({length:SLOTS},(_,i)=>base+0x400+i*0x40);
  const free=new Set(descriptors),queued=new Set();
  const report={session:rpc.a.session,started:new Date().toISOString(),base,rate:RATE,channels:CHANNELS,
    format:'s16le',submittedSamples:0,totalSubmittedSamples:0,writes:0,underrunsMeasured:false,playedSamples:0,resets:0,resourcesRetained:true};
  const file=path.join(directory,'stremio-audio.json'),save=()=>fs.writeFile(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  let opened=false,started=false,paused=false,closing=false,closed=false,pendingBytes=0,queue=Promise.resolve(),failure;
  function serial(task,cleanup=false){
    const result=queue.then(()=>{if(failure&&!cleanup)throw failure;return task();}).catch(error=>{failure ||= error;throw error;});
    queue=result.catch(()=>{});return result;
  }
  async function reap(){
    for(let n=0;n<SLOTS;n++){
      const address=await call('GetReleasedAudioOutBuffer',audio);
      if(address===0n)break;
      const descriptor=Number(address);
      check(descriptors.includes(descriptor)&&queued.has(descriptor),'Audio released an unknown or repeated buffer');
      queued.delete(descriptor);free.add(descriptor);
    }
  }
  async function shutdown(){
    if(closed)return;closed=true;
    try{
      if(opened){
        if(started){check(await call('StopAudioOut',audio)===0n,'Audio stop failed');started=false;}
        await call('FlushAudioOutBuffers',audio);await reap();
        check(await call('GetAudioOutBufferCount',audio)===0n,'Audio buffers did not drain');
        await call('CloseAudioOut',audio);opened=false;
      }
      report.completed=new Date().toISOString();report.stopped=true;await save();
    }catch(error){report.error=error.message;await save();throw error;}
  }
  try{
    await call('InitializeAudioOutParameter',param);
    const parameters=await rpc.read(param,8);parameters.writeUInt32LE(RATE);parameters.writeUInt16LE(CHANNELS,4);await rpc.write(param,parameters);
    check(await call('OpenDefaultAudioOutEPNS0_8AudioOutER',audio,param)===0n,'Audio output did not open');opened=true;
    check(await call('GetAudioOutSampleRate',audio)===BigInt(RATE)&&
      await call('GetAudioOutChannelCount',audio)===BigInt(CHANNELS)&&
      await call('GetAudioOutSampleFormat',audio)===2n,'Unsupported audio output format');
    await save();
  }catch(error){try{await shutdown();}catch{}throw error;}
  return {
    report,
    write(pcm){
      check(Buffer.isBuffer(pcm)&&pcm.length>0&&pcm.length%FRAME_BYTES===0&&pcm.length<=131072,'PCM must contain 1..131072 aligned stereo s16le bytes');
      check(!closing&&!closed,'Audio is closed');
      check(pendingBytes+pcm.length<=262144,'Audio backpressure exceeded; await the previous write');
      pendingBytes+=pcm.length;
      const bytes=Buffer.from(pcm);
      return serial(async()=>{
        check(!paused,'Resume audio before submitting more PCM');
        for(let offset=0;offset<bytes.length;offset+=CHUNK_BYTES){
          const part=bytes.subarray(offset,Math.min(bytes.length,offset+CHUNK_BYTES)),deadline=Date.now()+5000;
          if(free.size===0)await reap();
          while(free.size===0){
            check(!closing,'Audio was stopped');check(Date.now()<deadline,'Audio backpressure timed out; no request was replayed');
            await sleep(20);await reap();
          }
          check(!closing,'Audio was stopped');
          const descriptor=free.values().next().value,index=descriptors.indexOf(descriptor),address=base+65536+index*STRIDE;
          await rpc.write(address,part);
          await call('SetAudioOutBufferInfo',descriptor,address,STRIDE,part.length);
          check(await call('AppendAudioOutBuffer',audio,descriptor)===1n,'Audio buffer was rejected');
          free.delete(descriptor);queued.add(descriptor);report.submittedSamples+=part.length/FRAME_BYTES;
          report.totalSubmittedSamples+=part.length/FRAME_BYTES;report.writes++;
          if(!started){check(await call('StartAudioOut',audio)===0n,'Audio playback did not start');started=true;}
        }
        await save();return pcm.length;
      }).finally(()=>{pendingBytes-=bytes.length;});
    },
    pause(){return serial(async()=>{if(closed)return;if(started){check(await call('StopAudioOut',audio)===0n,'Audio pause failed');started=false;}paused=true;});},
    resume(){return serial(async()=>{check(!closed&&!closing,'Audio is closed');paused=false;
      if(queued.size&&!started){check(await call('StartAudioOut',audio)===0n,'Audio resume failed');started=true;}});},
    reset(){return serial(async()=>{
      check(!closed&&!closing,'Audio is closed');
      try{
        if(started){check(await call('StopAudioOut',audio)===0n,'Audio reset stop failed');started=false;}
        await call('FlushAudioOutBuffers',audio);await reap();
        check(await call('GetAudioOutBufferCount',audio)===0n,'Audio reset did not drain queued PCM');
        queued.clear();free.clear();for(const descriptor of descriptors)free.add(descriptor);
        const played=await call('GetAudioOutPlayedSampleCount',audio);
        check(played>=0n&&played<=BigInt(Number.MAX_SAFE_INTEGER),'Invalid audio reset playback counter');
        report.sourceBaseSamples=Number(played);report.submittedSamples=0;report.resets++;paused=false;await save();
        return report.sourceBaseSamples;
      }catch(error){report.error=error.message;await save();throw error;}
    });},
    drain({timeoutMs=5000}={}){
      check(Number.isInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=30000,'Audio drain timeout must be 1..30000ms');
      return serial(async()=>{
        check(!closed&&!closing,'Audio is closed');
        check(!paused||queued.size===0,'Resume audio before draining paused PCM');
        const deadline=Date.now()+timeoutMs;
        for(;;){
          await reap();
          const count=await call('GetAudioOutBufferCount',audio);
          check(count>=0n&&count<=BigInt(SLOTS),'Invalid native audio queue length');
          if(count===0n){
            check(queued.size===0,'Audio queue and released descriptors disagree');
            const played=await call('GetAudioOutPlayedSampleCount',audio);
            check(played>=0n&&played<=BigInt(Number.MAX_SAFE_INTEGER),'Invalid drained audio playback counter');
            report.playedSamples=Number(played);report.drained=new Date().toISOString();await save();
            return report.playedSamples;
          }
          check(Date.now()<deadline,'Audio drain timed out; no request was replayed');
          await sleep(20);
        }
      });
    },
    playedSamples(){return serial(async()=>{
      check(!closed&&!closing,'Audio is closed');const count=await call('GetAudioOutPlayedSampleCount',audio);
      check(count>=0n&&count<=BigInt(Number.MAX_SAFE_INTEGER),'Invalid audio playback counter');
      report.playedSamples=Number(count);return report.playedSamples;
    });},
    close(){closing=true;return serial(shutdown,true);}
  };
}
module.exports={create,RATE,CHANNELS,FRAME_BYTES,CHUNK_BYTES,SLOTS,STRIDE,names};
