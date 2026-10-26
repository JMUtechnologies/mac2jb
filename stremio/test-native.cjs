'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const P=require('./protocol.cjs'),audio=require('./audio.cjs'),graphics=require('./graphics.cjs');
const definitions=require('../vendor/HBLauncher/homebrew-launcher/audio-symbols.json');
function media(){
  const memory=P.initialMemory(),mapped=0x100000,writes=[],reads=[];
  let failAt=0;
  const rpc={async read(address,length){reads.push({address,length});return Buffer.from(memory.subarray(address-mapped,address-mapped+length));},
    async write(address,bytes){writes.push({address,bytes:Buffer.from(bytes)});if(failAt===writes.length)throw Error('uncertain write');
      bytes.copy(memory,address-mapped);}};
  const transport=P.createTransport({rpc,mapped});
  return {memory,mapped,writes,reads,transport,failAt:value=>{failAt=value;},
    acknowledge(){memory.writeUInt32LE(memory.readUInt32LE(P.COMMIT_OFFSET),P.ACK_OFFSET);memory.writeUInt32LE(1,P.ACK_OFFSET+4);},
    input(sequence,buttons){const offset=P.RING_OFFSET+((sequence-1)%P.RING_SIZE)*16;
      memory.writeUInt32LE(sequence,offset);memory.writeUInt32LE(buttons,offset+4);memory.writeUInt32LE(buttons,offset+8);
      memory.writeUInt32LE(sequence,P.ACK_OFFSET+8);}};
}
test('frame publication writes an inactive slot completely before its single-word commit',async()=>{
  const f=media(),frame=Buffer.alloc(P.BC1_BYTES,0xaa);
  assert.equal(await f.transport.publish(frame,100),true);assert.equal(f.writes.length,2);
  assert.equal(f.writes[0].address,f.mapped+P.HEADER_BYTES);
  assert.equal(f.writes[0].bytes.readUInt32LE(),1);assert.equal(f.writes[0].bytes.readUInt32LE(4),100);
  assert.deepEqual(f.writes[0].bytes.subarray(16),frame);
  assert.equal(f.writes[1].address,f.mapped+P.COMMIT_OFFSET);assert.equal(f.writes[1].bytes.length,4);
  assert.equal(f.writes[1].bytes.readUInt32LE(),4);
});
test('unacknowledged frames drop without touching current or pending buffers',async()=>{
  const f=media(),frame=Buffer.alloc(P.BC1_BYTES);
  await f.transport.publish(frame,0);assert.equal(await f.transport.publish(frame,1),false);assert.equal(f.writes.length,2);
  f.acknowledge();assert.equal(await f.transport.publish(frame,2),true);
  const first=f.writes[0].address,second=f.writes[2].address;assert.notEqual(second,first);
  f.acknowledge();assert.equal((await f.transport.poll()).activeFrameSeq,2);
  assert.equal(f.transport.stats.droppedFrames,1);
});
test('internal acknowledgement refresh preserves controller edges for the next public poll',async()=>{
  const f=media(),frame=Buffer.alloc(P.BC1_BYTES);await f.transport.publish(frame,0);f.acknowledge();f.input(1,1<<15);
  await f.transport.publish(frame,50);f.acknowledge();
  assert.deepEqual((await f.transport.poll()).events,[{sequence:1,buttons:1<<15,currentButtons:1<<15}]);
  assert.deepEqual((await f.transport.poll()).events,[]);
});
test('failed payload and failed commit are never replayed and permanently stop publication',async()=>{
  for(const at of [1,2]){
    const f=media();f.failAt(at);
    await assert.rejects(f.transport.publish(Buffer.alloc(P.BC1_BYTES),0),/uncertain/);
    const calls=f.writes.length;await assert.rejects(f.transport.publish(Buffer.alloc(P.BC1_BYTES),1),/uncertain/);
    assert.equal(f.writes.length,calls);assert.equal(f.memory.readUInt32LE(P.COMMIT_OFFSET),0);
  }
});
test('controller ring overflow reports dropped edges and reads only bounded complete records',async()=>{
  const f=media();for(let n=1;n<=20;n++)f.input(n,n);
  const value=await f.transport.poll();assert.equal(value.inputOverruns,4);assert.equal(value.events.length,16);
  assert.equal(value.events[0].sequence,5);assert.equal(value.events.at(-1).sequence,20);
  assert.deepEqual(f.reads,[{address:f.mapped+128,length:384}]);
});
test('media input rejects malformed frames and timestamps before any native operation',()=>{
  const f=media();
  for(const value of [Buffer.alloc(1),Buffer.alloc(P.BC1_BYTES+1)])assert.throws(()=>f.transport.publish(value,0),/28800/);
  assert.throws(()=>f.transport.publish(Buffer.alloc(P.BC1_BYTES),-1),/PTS/);assert.equal(f.writes.length,0);
});
function fakeAudio(t,options={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mac2jb-audio-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const base=0x200000,memory=Buffer.alloc(65536+audio.SLOTS*audio.STRIDE),events=[],queued=new Map(),released=[],info=new Map();
  const functionNames=new Map();
  for(const name of audio.names){
    const row=definitions.find(value=>value.name.includes(name));functionNames.set(0x7100000000+row.offset,name);
  }
  let started=false,played=4800;
  const rpc={a:{sdk:0x7100000000,session:'test'},output:0x1000,
    async request(request){events.push({type:'verify',address:request.address});if(options.badSignature)throw Error('signature changed');return {verified:true};},
    async call(offset,args){events.push({type:'allocate',offset,args});const output=Buffer.alloc(32768);output.writeBigUInt64LE(BigInt(base));return {result:0n,output};},
    async read(address,length){return Buffer.from(memory.subarray(address-base,address-base+length));},
    async write(address,bytes){
      if(address>=base+65536){const slot=Math.floor((address-base-65536)/audio.STRIDE),descriptor=base+0x400+slot*0x40;
        assert.equal(queued.has(descriptor),false,'Never overwrite PCM that native audio still owns');}
      bytes.copy(memory,address-base);events.push({type:'write',address,length:bytes.length});
    },
    async callAddress(address,args){
      const name=functionNames.get(address);assert.ok(name,'Only named qualified AudioOut functions may execute');events.push({type:'call',name,args});
      if(name==='GetAudioOutSampleRate')return {result:48000n};
      if(name==='GetAudioOutChannelCount')return {result:2n};
      if(name==='GetAudioOutSampleFormat')return {result:options.badFormat?99n:2n};
      if(name==='SetAudioOutBufferInfo'){info.set(args[0],{address:args[1],bytes:args[3]});return {result:0n};}
      if(name==='AppendAudioOutBuffer'){if(options.rejectAppend)return {result:0n};queued.set(args[1],info.get(args[1]));return {result:1n};}
      if(name==='GetReleasedAudioOutBuffer'){
        let descriptor=released.shift();
        if(descriptor===undefined&&options.autoRelease!==false&&started&&queued.size){descriptor=queued.keys().next().value;queued.delete(descriptor);}
        return {result:BigInt(descriptor||0)};
      }
      if(name==='GetAudioOutBufferCount')return {result:options.badBufferCount?999n:BigInt(queued.size)};
      if(name==='GetAudioOutPlayedSampleCount')return {result:BigInt(played)};
      if(name==='StartAudioOut'){started=true;return {result:0n};}
      if(name==='StopAudioOut'){started=false;return {result:0n};}
      if(name==='FlushAudioOutBuffers'){if(!options.flushFail){released.push(...queued.keys());queued.clear();}return {result:0n};}
      return {result:0n};
    }};
  return {rpc,directory,events,queued,options,played:value=>{played=value;},
    async sleep(){
      if(options.drainHold){await new Promise(resolve=>setTimeout(resolve,2));return;}
      const descriptor=queued.keys().next().value;if(descriptor!==undefined){queued.delete(descriptor);released.push(descriptor);}
    }};
}
test('audio verifies every supported native signature before allocating or opening output',async t=>{
  const f=fakeAudio(t),owner=await audio.create(f);
  assert.equal(f.events.findIndex(row=>row.type==='allocate'),audio.names.length);
  assert.equal(await owner.playedSamples(),4800);await owner.close();
  assert.ok(f.events.some(row=>row.name==='CloseAudioOut'));assert.equal(owner.report.stopped,true);
});
test('signature or audio format mismatch fails before playback without retry',async t=>{
  const signature=fakeAudio(t,{badSignature:true});await assert.rejects(audio.create(signature),/signature/);
  assert.equal(signature.events.some(row=>row.type==='allocate'),false);
  const format=fakeAudio(t,{badFormat:true});await assert.rejects(audio.create(format),/format/);
  assert.equal(format.events.some(row=>row.name==='StartAudioOut'),false);
});
test('continuous PCM is chunked, backpressured and recycled only after release',async t=>{
  const f=fakeAudio(t,{autoRelease:false}),owner=await audio.create(f);
  await owner.write(Buffer.alloc(audio.CHUNK_BYTES*6));await owner.write(Buffer.alloc(audio.CHUNK_BYTES*2));
  assert.equal(f.queued.size,audio.SLOTS);await owner.write(Buffer.alloc(audio.CHUNK_BYTES));
  assert.equal(owner.report.writes,9);assert.equal(owner.report.submittedSamples,9*audio.CHUNK_BYTES/4);
  assert.ok(f.events.filter(row=>row.name==='SetAudioOutBufferInfo').every(row=>row.args[3]<=audio.CHUNK_BYTES));
  await owner.close();
});
test('reset flushes and proves a drained queue before reusing descriptors without reallocating',async t=>{
  const f=fakeAudio(t,{autoRelease:false}),owner=await audio.create(f);await owner.write(Buffer.alloc(19200));
  const allocationCount=f.events.filter(row=>row.type==='allocate').length;
  const start=f.events.length;assert.equal(await owner.reset(),4800);assert.equal(f.queued.size,0);
  await owner.write(Buffer.alloc(19200));assert.equal(f.events.filter(row=>row.type==='allocate').length,allocationCount);
  const rows=f.events.slice(start),flush=rows.findIndex(row=>row.name==='FlushAudioOutBuffers'),drain=rows.findIndex(row=>row.name==='GetAudioOutBufferCount');
  const append=rows.findIndex(row=>row.name==='AppendAudioOutBuffer');assert.ok(flush<drain&&drain<append);
  assert.equal(owner.report.sourceBaseSamples,4800);assert.equal(owner.report.resets,1);await owner.close();
});
test('failed reset or rejected native append is fatal and does not automatically replay',async t=>{
  const f=fakeAudio(t,{autoRelease:false,flushFail:true}),owner=await audio.create(f);await owner.write(Buffer.alloc(19200));
  await assert.rejects(owner.reset(),/drain/);const calls=f.events.length;
  await assert.rejects(owner.write(Buffer.alloc(19200)),/drain/);assert.equal(f.events.length,calls);
  f.options.flushFail=false;await owner.close();
  const bad=fakeAudio(t,{rejectAppend:true}),other=await audio.create(bad);
  await assert.rejects(other.write(Buffer.alloc(19200)),/rejected/);
  assert.equal(bad.events.filter(row=>row.name==='AppendAudioOutBuffer').length,1);await other.close();
});
test('pause/resume preserves queued audio and validates raw played-sample counters',async t=>{
  const f=fakeAudio(t,{autoRelease:false}),owner=await audio.create(f);await owner.write(Buffer.alloc(19200));
  await owner.pause();assert.equal(f.queued.size,1);await owner.resume();assert.equal(f.queued.size,1);
  assert.equal(await owner.playedSamples(),4800);f.played(9600);assert.equal(await owner.playedSamples(),9600);
  await owner.close();assert.equal(f.queued.size,0);
});
test('drain waits for released native PCM without stopping, flushing or replaying it',async t=>{
  const f=fakeAudio(t,{autoRelease:false}),owner=await audio.create(f);await owner.write(Buffer.alloc(19200));
  const before=f.events.length;assert.equal(await owner.drain(),4800);
  assert.equal(f.queued.size,0);assert.ok(owner.report.drained);
  assert.equal(f.events.slice(before).some(row=>['StopAudioOut','FlushAudioOutBuffers','AppendAudioOutBuffer'].includes(row.name)),false);
  await owner.close();
});
test('drain timeout or invalid native queue count latches a fatal error without replay',async t=>{
  for(const options of [{autoRelease:false,drainHold:true},{autoRelease:false,badBufferCount:true}]){
    const f=fakeAudio(t,options),owner=await audio.create(f);await owner.write(Buffer.alloc(19200));
    await assert.rejects(owner.drain({timeoutMs:5}),/drain timed out|queue length/);
    const calls=f.events.length;await assert.rejects(owner.write(Buffer.alloc(19200)),/drain timed out|queue length/);
    assert.equal(f.events.length,calls);
    f.options.badBufferCount=false;f.options.drainHold=false;await owner.close();
  }
});
test('native graphics plan reuses qualified render and input calls without host-side frame polling',()=>{
  const resources={device:'1',queue:'2',swapchain:'3',acquired:'4',semaphores:['5','6']},commands=[['7','8']];
  const data=graphics.frameData({base:0x100000,resources,commands});
  assert.equal(data.data.readUInt32LE(0x230),32);assert.equal(data.data.readUInt32LE(0x234),0);
  const functions={vkAcquireNextImage2KHR:100,vkQueueSubmit:104,vkQueuePresentKHR:108,vkQueueWaitIdle:112};
  const plan=graphics.frameCalls({sdk:0x7100000000,...data,resources,commands,functions,inputs:[{address:200,args:[300,400]}],lookup:500,frameCount:12});
  assert.equal(plan.checks.length,48);assert.equal(plan.calls.filter(row=>row.function===200).length,12);
  assert.equal(plan.calls.filter(row=>row.function===100).length,12);
  assert.ok(plan.calls.every(row=>row.args.length===4));assert.equal(data.data.length,0x9000);
});
