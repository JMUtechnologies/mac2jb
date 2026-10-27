'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const P=require('./protocol.cjs'),audio=require('./audio.cjs'),graphics=require('./graphics.cjs');
const definitions=require('../vendor/GPUBrewLauncher/homebrew-launcher/audio-symbols.json');
const HD={width:1280,height:720},FULL_HD={width:1920,height:1080};
const chunkCount=bytes=>Math.ceil((P.FRAME_HEADER_BYTES+bytes)/P.WRITE_BYTES);
test('automatic transport retains one-write frames on RPC and sends larger frames through the dedicated receiver',()=>{
  for(const format of P.FORMATS){
    const bytes=P.FRAME_HEADER_BYTES+format.bytes;
    assert.equal(graphics.selectTransportMode('auto',bytes),format.height===180?'rpc':'dedicated');
    assert.equal(graphics.selectTransportMode('rpc',bytes),'rpc');assert.equal(graphics.selectTransportMode('dedicated',bytes),'dedicated');
  }
  for(const bytes of [0,-1,NaN,P.SLOT_BYTES+1])assert.throws(()=>graphics.selectTransportMode('auto',bytes));
  assert.throws(()=>graphics.selectTransportMode('retry',460816));
});
function media({afterRead}={}){
  const memory=P.initialMemory(),mapped=0x100000,writes=[],reads=[];
  let failAt=0,failMode='before';
  const within=(address,length)=>assert.ok(address>=mapped&&address+length<=mapped+memory.length,'Transfer stays inside the owned media mapping');
  const rpc={async read(address,length){within(address,length);reads.push({address,length});const bytes=Buffer.from(memory.subarray(address-mapped,address-mapped+length));return afterRead?.({address,length,bytes,memory})||bytes;},
    async write(address,bytes){within(address,bytes.length);assert.ok(bytes.length<=P.WRITE_BYTES);writes.push({address,bytes:Buffer.from(bytes)});if(failAt===writes.length){
      if(failMode==='partial')bytes.subarray(0,Math.floor(bytes.length/2)).copy(memory,address-mapped);
      if(failMode==='complete')bytes.copy(memory,address-mapped);
      throw Error('uncertain write');}
      bytes.copy(memory,address-mapped);}};
  const transport=P.createTransport({rpc,mapped});
  return {memory,mapped,writes,reads,transport,failAt:(value,mode='before')=>{failAt=value;failMode=mode;},
    acknowledge(){memory.writeUInt32LE(memory.readUInt32LE(P.COMMIT_OFFSET),P.ACK_OFFSET);memory.writeUInt32LE(1,P.ACK_OFFSET+4);memory.writeUInt32LE(1,204);},
    input(sequence,buttons,{currentButtons=buttons,kind=1,x=0,y=0,buttonsHigh=0,currentButtonsHigh=buttonsHigh}={}){
      const offset=P.RING_OFFSET+(((sequence-1)>>>0)%P.RING_SIZE)*P.RING_ENTRY_BYTES;
      [sequence,buttons,currentButtons,kind,x,y,buttonsHigh,currentButtonsHigh].forEach((word,index)=>memory.writeUInt32LE(word,offset+index*4));
      memory.writeUInt32LE(sequence,P.ACK_OFFSET+8);memory.writeUInt32LE(currentButtons,P.ACK_OFFSET+12);memory.writeUInt32LE(currentButtonsHigh,P.ACK_OFFSET+20);
    }};
}
test('every video format finishes bounded inactive-slot writes before committing, including the full HD final chunk',async()=>{
  for(const format of P.FORMATS){
    const f=media(),frame=Buffer.alloc(format.bytes,0xaa),count=chunkCount(frame.length);
    assert.equal(await f.transport.publish(frame,100,format),true);assert.equal(f.writes.length,count+1);
    const packet=Buffer.concat(f.writes.slice(0,count).map(row=>row.bytes));
    assert.equal(packet.readUInt32LE(),1);assert.equal(packet.readUInt32LE(4),100);
    assert.equal(packet.readUInt32LE(8),format.width);assert.equal(packet.readUInt32LE(12),format.height);
    assert.deepEqual(packet.subarray(P.FRAME_HEADER_BYTES),frame);
    for(let n=0;n<count;n++)assert.equal(f.writes[n].address,f.mapped+P.HEADER_BYTES+n*P.WRITE_BYTES);
    assert.equal(f.writes[count-1].address+f.writes[count-1].bytes.length<=f.mapped+P.HEADER_BYTES+P.SLOT_BYTES,true);
    assert.deepEqual(f.writes[count],{address:f.mapped+P.COMMIT_OFFSET,bytes:Buffer.from([4,0,0,0])});
  }
  assert.equal(P.WIDTH,1280);assert.equal(P.HEIGHT,720);assert.equal(P.SLOT_BYTES,1048576);assert.equal(P.MEMORY_BYTES,3149824);
});
test('720p menus and mixed video formats never overwrite the active slot and reach all three slots',async()=>{
  const f=media(),menu=Buffer.alloc(P.MENU_BC1_BYTES,0x5a);
  assert.equal(f.memory.length,3149824);assert.equal(f.memory.readUInt32LE(4),4);
  assert.equal(await f.transport.publish(menu,500,{width:P.MENU_WIDTH,height:P.MENU_HEIGHT}),true);f.acknowledge();
  let previous=Buffer.from(f.memory.subarray(P.HEADER_BYTES,P.HEADER_BYTES+P.SLOT_BYTES));
  await f.transport.publish(Buffer.alloc(1036800,0xa5),600,FULL_HD);
  assert.deepEqual(f.memory.subarray(P.HEADER_BYTES,P.HEADER_BYTES+P.SLOT_BYTES),previous);f.acknowledge();
  previous=Buffer.from(f.memory.subarray(P.HEADER_BYTES+P.SLOT_BYTES,P.HEADER_BYTES+2*P.SLOT_BYTES));
  await f.transport.publish(Buffer.alloc(28800,0x55),700,{width:320,height:180});f.acknowledge();
  assert.deepEqual(f.memory.subarray(P.HEADER_BYTES+P.SLOT_BYTES,P.HEADER_BYTES+2*P.SLOT_BYTES),previous);
  assert.equal((await f.transport.poll()).activeFrameSeq,3);
  assert.equal(f.memory.readUInt32LE(P.HEADER_BYTES+2*P.SLOT_BYTES+8),320);
});
test('unacknowledged frames drop without touching current or pending buffers',async()=>{
  const f=media(),frame=Buffer.alloc(P.BC1_BYTES),count=chunkCount(frame.length)+1;
  await f.transport.publish(frame,0);assert.equal(await f.transport.publish(frame,1),false);assert.equal(f.writes.length,count);
  f.acknowledge();assert.equal(await f.transport.publish(frame,2),true);
  assert.notEqual(f.writes[count].address,f.writes[0].address);
  f.acknowledge();assert.equal((await f.transport.poll()).activeFrameSeq,2);assert.equal(f.transport.stats.droppedFrames,1);
});
test('internal acknowledgement refresh preserves button edges while stable held state survives empty polls',async()=>{
  const f=media(),frame=Buffer.alloc(P.BC1_BYTES);await f.transport.publish(frame,0);f.acknowledge();f.input(1,1<<15);
  await f.transport.publish(frame,50);f.acknowledge();
  const first=await f.transport.poll();assert.deepEqual(first.events,[{sequence:1,buttons:1<<15,currentButtons:1<<15}]);assert.equal(first.currentButtons,1<<15);
  const held=await f.transport.poll();assert.deepEqual(held.events,[]);assert.equal(held.currentButtons,1<<15);
  f.memory.writeUInt32LE(0,P.ACK_OFFSET+12);assert.equal((await f.transport.poll()).currentButtons,0);
});
test('touch start/move/end ring records retain screen coordinates and simultaneous controller input',async()=>{
  const f=media();f.input(1,0x40);f.input(2,0,{currentButtons:0x40,kind:2,x:1279,y:719});f.input(3,0,{currentButtons:0x40,kind:3,x:600,y:300});
  f.input(4,0,{currentButtons:0x40,kind:4,x:600,y:300});
  const value=await f.transport.poll();assert.equal(value.currentButtons,0x40);
  assert.deepEqual(value.events,[{sequence:1,buttons:0x40,currentButtons:0x40},
    {sequence:2,buttons:0,currentButtons:0x40,touch:{x:1279,y:719,phase:'start'}},
    {sequence:3,buttons:0,currentButtons:0x40,touch:{x:600,y:300,phase:'move'}},
    {sequence:4,buttons:0,currentButtons:0x40,touch:{x:600,y:300,phase:'end'}}]);
  const high=media();high.input(1,0,{buttonsHigh:0x80000000});
  assert.deepEqual((await high.transport.poll()).events,[{sequence:1,buttons:0,currentButtons:0,buttonsHigh:0x80000000,currentButtonsHigh:0x80000000}]);
  assert.equal(high.transport.stats.currentButtonsHigh,0x80000000);
});
test('stable touchscreen snapshots retain release even after ring overflow and reject incoherent frames',async()=>{
  const f=media();
  const snapshot=(frame,end,down,x,y,id)=>{for(const [offset,value]of [[132,frame],[204,end],[160,down],[164,x],[168,y],[200,id]])f.memory.writeUInt32LE(value,offset);};
  snapshot(1,1,1,1100,470,7);
  const first=await f.transport.poll();assert.deepEqual(first.touch,{active:true,x:1100,y:470,id:7});
  first.touch.active=false;assert.equal(f.transport.stats.touch.active,true);
  snapshot(2,1,0,500,500,8);
  assert.deepEqual((await f.transport.poll()).touch,{active:true,x:1100,y:470,id:7});
  for(let n=1;n<=P.RING_SIZE+8;n++)f.input(n,0,{kind:n===P.RING_SIZE+8?4:3,x:100,y:400});
  snapshot(2,2,0,100,400,7);
  const released=await f.transport.poll();assert.equal(released.inputOverruns,8);
  assert.deepEqual(released.touch,{active:false,x:100,y:400,id:7});
  assert.equal(released.events.at(-1).touch.phase,'end');
});
test('a post-copy counter rejects changed touch payload bracketed by equal old GPU counters',async()=>{
  let concurrent=false;
  const f=media({afterRead({length,bytes,memory}){
    if(concurrent&&length===P.INPUT_BYTES){
      // The host copied the old begin word before this compute cycle began,
      // but some touch fields after it began and the old end word before commit.
      bytes.writeUInt32LE(500,164-P.ACK_OFFSET);bytes.writeUInt32LE(200,168-P.ACK_OFFSET);
      memory.writeUInt32LE(2,132);memory.writeUInt32LE(0,160);
      memory.writeUInt32LE(500,164);memory.writeUInt32LE(200,168);
    }
  }});
  for(const [offset,value]of [[132,1],[204,1],[160,1],[164,1100],[168,470],[200,7]])f.memory.writeUInt32LE(value,offset);
  assert.deepEqual((await f.transport.poll()).touch,{active:true,x:1100,y:470,id:7});
  concurrent=true;
  assert.deepEqual((await f.transport.poll()).touch,{active:true,x:1100,y:470,id:7});
  concurrent=false;f.memory.writeUInt32LE(2,204);
  assert.deepEqual((await f.transport.poll()).touch,{active:false,x:500,y:200,id:7});
  assert.deepEqual(f.reads.map(read=>read.length),[P.INPUT_BYTES,4,P.INPUT_BYTES,4,P.INPUT_BYTES,4]);
});
test('truncated post-copy counters latch failure before any follow-up native operation',async()=>{
  const f=media({afterRead:({length})=>length===4?Buffer.alloc(3):undefined});
  await assert.rejects(f.transport.poll(),/snapshot counter was truncated/);
  await assert.rejects(f.transport.poll(),/snapshot counter was truncated/);
  assert.equal(f.reads.length,2);
});
test('malformed coherent touchscreen snapshots latch failure before further native requests',async()=>{
  for(const [offset,value]of [[160,2],[164,1280],[168,720]]){
    const f=media();f.memory.writeUInt32LE(value,offset);
    await assert.rejects(f.transport.poll(),/touchscreen snapshot/);
    await assert.rejects(f.transport.poll(),/touchscreen snapshot/);assert.equal(f.reads.length,2);
  }
});
test('raw right stick remains continuous across polls without digital edges or a forced deadzone',async()=>{
  const f=media();assert.equal((await f.transport.poll()).rightStickX,0);
  for(const axis of [-32767,-6553,-1,0,1,6553,32767]){
    f.memory.writeInt32LE(axis,P.RIGHT_STICK_X_OFFSET);
    const value=await f.transport.poll();assert.equal(value.rightStickX,axis/32767);assert.deepEqual(value.events,[]);
    assert.equal((await f.transport.poll()).rightStickX,axis/32767);
  }
  for(const [axis,expected]of [[-32768,-1],[32768,1]]){
    f.memory.writeInt32LE(axis,P.RIGHT_STICK_X_OFFSET);assert.equal((await f.transport.poll()).rightStickX,expected);
  }
});
test('any uncertain payload chunk or commit reply permanently stops publication without replay',async()=>{
  const count=chunkCount(1036800);
  for(const mode of ['before','partial','complete'])for(let at=1;at<=count+1;at++){
    const f=media();f.failAt(at,mode);
    await assert.rejects(f.transport.publish(Buffer.alloc(1036800,0x5a),0,FULL_HD),/uncertain/);
    assert.equal(f.writes.length,at);
    assert.equal(f.memory.readUInt32LE(P.COMMIT_OFFSET),at===count+1&&mode!=='before'?4:0);
    if(at===count+1&&mode!=='before')f.acknowledge();
    await assert.rejects(f.transport.publish(Buffer.alloc(P.BC1_BYTES),1),/uncertain/);
    await assert.rejects(f.transport.poll(),/uncertain/);assert.equal(f.writes.length,at);assert.equal(f.reads.length,0);
  }
});
test('input ring overflow reports lost records and reads exactly the complete bounded ring',async()=>{
  const f=media();for(let n=1;n<=P.RING_SIZE+4;n++)f.input(n,n);
  const value=await f.transport.poll();assert.equal(value.inputOverruns,4);assert.equal(value.events.length,P.RING_SIZE);
  assert.equal(value.events[0].sequence,5);assert.equal(value.events.at(-1).sequence,P.RING_SIZE+4);
  assert.deepEqual(f.reads,[{address:f.mapped+128,length:P.INPUT_BYTES},{address:f.mapped+132,length:4}]);
});
test('malformed ring records latch failure before any follow-up native operation',async()=>{
  for(const fixture of [{kind:99},{kind:2,x:1280},{kind:3,y:720}]){
    const f=media();f.input(1,0,fixture);await assert.rejects(f.transport.poll(),/Invalid GPU/);
    await assert.rejects(f.transport.publish(Buffer.alloc(P.BC1_BYTES),1),/Invalid GPU/);assert.equal(f.writes.length,0);assert.equal(f.reads.length,2);
  }
});
test('media input rejects malformed frames and timestamps before any native operation',()=>{
  const f=media();
  for(const value of [Buffer.alloc(1),Buffer.alloc(P.BC1_BYTES+1)])assert.throws(()=>f.transport.publish(value,0),/460800/);
  assert.throws(()=>f.transport.publish(Buffer.alloc(P.BC1_BYTES),-1),/PTS/);
  for(const format of [null,[],{}, {width:640,height:180},{width:1920,height:1084},{width:640.1,height:360}])
    assert.throws(()=>f.transport.publish(Buffer.alloc(P.BC1_BYTES),0,format),/frame/);
  assert.throws(()=>f.transport.publish(Buffer.alloc(1036801),0,FULL_HD),/1036800/);
  assert.throws(()=>P.createTransport({rpc:{},mapped:Number.MAX_SAFE_INTEGER}),/mapping/);
  assert.equal(f.writes.length,0);assert.equal(f.reads.length,0);
});
test('graphics initialization splits expanded memory into bounded writes and stops at the first uncertainty',async()=>{
  const writes=[],initial=P.initialMemory(),rpc={async write(address,bytes){writes.push({address,bytes:Buffer.from(bytes)});assert.ok(bytes.length<=32768);}};
  await graphics.writeChunks(rpc,0x100000,initial);assert.deepEqual(Buffer.concat(writes.map(row=>row.bytes)),initial);
  writes.forEach((row,index)=>assert.equal(row.address,0x100000+index*32768));
  let calls=0;await assert.rejects(graphics.writeChunks({async write(){if(++calls===2)throw Error('uncertain initialization');}},0x100000,initial),/uncertain/);assert.equal(calls,2);
});
test('controller and touchscreen inputs reuse exact inspected import targets and verified native call signatures',async()=>{
  const imports=require('../vendor/GPUBrewLauncher/homebrew-launcher/input-imports.json'),inspection={session:'qualified-test',imports:{}},verified=new Set(),requests=[];
  Object.entries(imports).forEach(([name,row],index)=>inspection.imports[name]={...row,target:0x100000+index*32,bytes:'11223344'.repeat(32)});
  const rpc={a:{main:0x7000000000,session:'qualified-test'},async read(address,length){assert.equal(length,8);const row=Object.values(inspection.imports).find(value=>address===rpc.a.main+value.slot);assert.ok(row);const output=Buffer.alloc(8);output.writeBigUInt64LE(BigInt(row.target));return output;},async request(request){requests.push(request);}};
  const result=await graphics.qualifyInputs({rpc,inspection,controls:0x200000,mapped:0x300000,control:0x400000,verified});
  assert.equal(result.inputs.length,6);assert.equal(requests.length,6);
  assert.deepEqual(result.inputs.at(-1),{address:Object.values(inspection.imports)[0].target,args:[0x200080]});
  assert.deepEqual(result.touch,{target:Object.values(inspection.imports)[0].target,offset:128,width:1280,height:720});
  for(const input of result.inputs)assert.ok(verified.has(input.address));
  delete inspection.imports[Object.keys(imports)[0]];
  await assert.rejects(graphics.qualifyInputs({rpc,inspection,controls:0x200000,mapped:0x300000,control:0x400000,verified}),/touchscreen/);
});
test('changed native input targets or signatures prevent a render worker input plan',async()=>{
  const inspection={session:'test',imports:{'_ZN2nn3hid12GetNpadStateEPNS0_17NpadHandheldStateERKj':{slot:20,target:100,bytes:'aa'.repeat(32)}}};
  let signatureCalls=0;const rpc={a:{main:0x100000,session:'test'},async read(){const b=Buffer.alloc(8);b.writeBigUInt64LE(101n);return b;},async request(){signatureCalls++;}};
  await assert.rejects(graphics.qualifyInputs({rpc,inspection,controls:1,mapped:2,control:3,verified:new Set()}),/Controller import changed/);assert.equal(signatureCalls,0);
  rpc.read=async()=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(100n);return b;};rpc.request=async()=>{throw Error('native signature mismatch');};
  await assert.rejects(graphics.qualifyInputs({rpc,inspection,controls:1,mapped:2,control:3,verified:new Set()}),/signature mismatch/);
});
test('actual shader input body preserves matching-finger End coordinates and separates replacement fingers on the host',t=>{
  const compiler=process.env.CXX||'/usr/bin/c++';
  if(!fs.existsSync(compiler)){t.skip('A C++ compiler is needed for the host shader input logic fixture.');return;}
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'stremio-shader-input-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  // Execute the actual scalar input body with host buffer/vector bindings. This
  // checks its transitions without claiming desktop Vulkan or console execution.
  const shader=fs.readFileSync(path.join(__dirname,'app/app.comp'),'utf8')
    .replace(/^#version[^\n]*\n/m,'').replace(/^layout\([^\n]*\n/gm,'').replace('void main()','void shaderMain()');
  const source=`#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
using uint=uint32_t;
using std::min; using std::clamp; using std::abs;
struct ivec4 { int v[4]; ivec4(uint a,uint b,uint c,uint d):v{int(a),int(b),int(c),int(d)}{} int operator[](uint i) const{return v[i];} };
struct { uint raw[256]; } c;
struct { uint m[${P.MEMORY_BYTES/4}]; } media;
void memoryBarrierBuffer(){}
${shader}
void expect(bool value,const char* message){if(!value){std::cerr<<message<<"\\n";std::exit(1);}}
void reset(){std::memset(&c,0,sizeof(c));std::memset(&media,0,sizeof(media));media.m[0]=0x314d5453u;media.m[1]=${P.VERSION}u;}
void sample(uint id,uint attributes,uint x,uint y,uint count=1u){c.raw[34]=count;c.raw[38]=attributes;c.raw[39]=id;c.raw[40]=x;c.raw[41]=y;shaderMain();}
void event(uint sequence,uint kind,uint x,uint y){uint base=64u+((sequence-1u)%48u)*8u;expect(media.m[base]==sequence,"event sequence");expect(media.m[base+3u]==kind,"event kind");expect(media.m[base+4u]==x&&media.m[base+5u]==y,"event coordinates");}
int main(){
 reset();sample(7u,0u,100u,450u);sample(7u,2u,1170u,480u);
 expect(media.m[34]==2u,"matching End must publish once");event(2u,4u,1170u,480u);
 expect(media.m[40]==0u&&media.m[41]==1170u&&media.m[42]==480u&&media.m[50]==7u,"matching End snapshot");
 sample(7u,2u,1170u,480u);expect(media.m[34]==2u,"duplicate End must not replay");
 reset();sample(7u,0u,100u,450u);sample(8u,2u,1200u,600u);
 event(2u,4u,100u,450u);expect(media.m[41]==100u&&media.m[42]==450u,"different finger End must retain previous coordinates");
 reset();sample(7u,0u,100u,450u);sample(8u,0u,200u,460u);
 expect(media.m[34]==3u,"replacement finger transitions");event(2u,4u,100u,450u);event(3u,2u,200u,460u);
 reset();sample(7u,0u,100u,450u);sample(0u,0u,0u,0u,0u);event(2u,4u,100u,450u);
 reset();sample(7u,0u,100u,450u);sample(7u,2u,9999u,9999u);event(2u,4u,1279u,719u);
 return 0;
}
`;
  const file=path.join(directory,'input.cpp'),binary=path.join(directory,'input-check');fs.writeFileSync(file,source);
  execFileSync(compiler,['-std=c++17','-O0',file,'-o',binary],{stdio:'pipe'});execFileSync(binary,[],{stdio:'pipe'});
});
test('display package memory, source hashes and compiled Vulkan shaders match protocol v4',t=>{
  const root=path.resolve(__dirname,'..'),app=path.join(__dirname,'app'),manifest=JSON.parse(fs.readFileSync(path.join(app,'app.json')));
  assert.equal(manifest.version,'0.4.0');assert.equal(manifest.memory.bytes,P.MEMORY_BYTES);
  assert.deepEqual(fs.readFileSync(path.join(app,manifest.memory.initial)),P.initialMemory());
  const crypto=require('node:crypto');
  for(const line of fs.readFileSync(path.join(root,'packaging/stremio-display-SHA256SUMS'),'utf8').trim().split('\n')){
    const [hash,file]=line.split(/\s+/);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(app,file))).digest('hex'),hash,file);
  }
  const validator=[process.env.SPIRV_VAL,path.join(root,'homebrew/bin/spirv-val'),path.join(root,'.build-gui/homebrew/bin/spirv-val')].filter(Boolean).find(file=>fs.existsSync(file));
  if(!validator){t.skip('A bundled SPIR-V validator is needed to validate compiled display shaders.');return;}
  for(const file of Object.values(manifest.shaders))execFileSync(validator,['--target-env','vulkan1.0',path.join(app,file)],{stdio:'pipe'});
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
