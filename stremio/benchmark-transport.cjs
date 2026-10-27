#!/usr/bin/env node
'use strict';
const net=require('node:net'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const P=require('./protocol.cjs'),{PROFILES}=require('./quality.cjs');
const {Connection}=require('../vendor/ns2jb/engine/lib/connection.cjs');
const {NativeClient,REQUEST_BYTES,RESPONSE_BYTES}=require('../vendor/ns2jb/engine/lib/native.cjs');
const MAPPED=0x30000000,CONTROL=MAPPED+P.MEMORY_BYTES+4096,SDK=0x10000000,SCRATCH=0x20000000;
const ALLOCATION_BYTES=P.MEMORY_BYTES+8192,TIMEOUT_MS=10000;
const integer=(text,min,max,label)=>{const value=Number(text);if(!/^\d+$/.test(text)||!Number.isSafeInteger(value)||value<min||value>max)throw Error(`Invalid ${label}: expected ${min}..${max}`);return value;};
function options(args){
  const result={samples:20,warmup:3,rounds:2,qualities:Object.keys(PROFILES)};
  for(let i=0;i<args.length;i++){
    const key=args[i];
    if(key==='--self-test'){result.samples=2;result.warmup=1;result.rounds=1;continue;}
    if(key==='--help')return {help:true};
    if(!['--samples','--warmup','--rounds','--quality'].includes(key)||args[i+1]===undefined)throw Error('Unknown or incomplete benchmark argument: '+key);
    const value=args[++i];
    if(key==='--quality'){if(!Object.hasOwn(PROFILES,value))throw Error('Choose 180p, 360p, 540p or 720p.');result.qualities=[value];}
    else result[key.slice(2)]=integer(value,key==='--warmup'?0:1,key==='--rounds'?8:500,key);
  }
  return result;
}
class Reader {
  constructor(socket){
    this.socket=socket;this.parts=[];this.bytes=0;this.pending=null;this.failure=null;
    socket.on('data',part=>{this.parts.push(part);this.bytes+=part.length;if(this.bytes>2*P.SLOT_BYTES)this.fail(Error('Fixture input exceeded its bound'));else this.drain();});
    socket.on('error',error=>this.fail(error));socket.on('end',()=>this.fail(Error('Fixture peer ended')));socket.on('close',()=>this.fail(Error('Fixture peer closed')));
  }
  fail(error){this.failure ||= error;if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(this.failure);this.pending=null;}}
  drain(){
    if(!this.pending||this.bytes<this.pending.size)return;
    const {size,resolve,timer}=this.pending;this.pending=null;clearTimeout(timer);
    const output=Buffer.allocUnsafe(size);let offset=0;
    while(offset<size){const part=this.parts[0],count=Math.min(part.length,size-offset);part.copy(output,offset,0,count);offset+=count;this.bytes-=count;if(count===part.length)this.parts.shift();else this.parts[0]=part.subarray(count);}
    resolve(output);
  }
  read(size){
    if(this.failure)return Promise.reject(this.failure);
    assert.ok(Number.isInteger(size)&&size>0&&size<=P.SLOT_BYTES);assert.equal(this.pending,null);
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.fail(Error('Fixture receive timed out'));this.socket.destroy();},TIMEOUT_MS);this.pending={size,resolve,reject,timer};this.drain();});
  }
}
const write=(socket,bytes)=>new Promise((resolve,reject)=>socket.write(bytes,error=>error?reject(error):resolve()));
async function pair(handler){
  let accepted,acceptResolve;const incoming=new Promise(resolve=>{acceptResolve=resolve;});
  const server=net.createServer(socket=>{if(accepted){socket.destroy();return;}accepted=socket;socket.setNoDelay(true);acceptResolve(socket);});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  let client;
  try{
    client=net.createConnection({host:'127.0.0.1',port:server.address().port});client.setNoDelay(true);
    await new Promise((resolve,reject)=>{client.once('connect',resolve);client.once('error',reject);});
    const peer=await incoming;let closing=false,failure;
    const task=handler(peer).catch(error=>{if(!closing){failure=error;peer.destroy();client.destroy(error);}});
    return {client,get failure(){return failure;},async close(){closing=true;client.destroy();peer.destroy();await task;await new Promise(resolve=>server.close(resolve));}};
  }catch(error){client?.destroy();accepted?.destroy();await new Promise(resolve=>server.close(resolve));throw error;}
}
function store(){
  const bytes=Buffer.alloc(ALLOCATION_BYTES);P.initialMemory().copy(bytes);let expected,commits=0;
  const offset=(address,length)=>{assert.ok(Number.isSafeInteger(address)&&Number.isSafeInteger(length)&&length>=0&&address>=MAPPED&&address+length<=MAPPED+bytes.length,'Fixture operation stays inside its owned memory');return address-MAPPED;};
  function commit(){
    assert.ok(expected,'No frame was expected');const word=bytes.readUInt32LE(P.COMMIT_OFFSET),slot=word&3,sequence=word>>>2;
    assert.ok(slot<P.SLOTS&&sequence>0);const at=P.HEADER_BYTES+slot*P.SLOT_BYTES;
    assert.equal(bytes.readUInt32LE(at),sequence);assert.equal(bytes.readUInt32LE(at+4),expected.ptsMs);
    assert.equal(bytes.readUInt32LE(at+8),expected.width);assert.equal(bytes.readUInt32LE(at+12),expected.height);
    assert.ok(bytes.subarray(at+P.FRAME_HEADER_BYTES,at+P.FRAME_HEADER_BYTES+expected.payload.length).equals(expected.payload),'Complete received BC1 frame equals input');
    // synthetic acknowledgement; this does not measure graphics or display time.
    bytes.writeUInt32LE(word,P.ACK_OFFSET);bytes.writeUInt32LE(++commits,P.ACK_OFFSET+4);
    bytes.writeUInt32LE(expected.ptsMs,P.ACK_OFFSET+16);bytes.writeUInt32LE(commits,204);
  }
  return {bytes,offset,get commits(){return commits;},expect(frame){expected=frame;},
    write(address,data){data.copy(bytes,offset(address,data.length));if(address===MAPPED+P.COMMIT_OFFSET){assert.equal(data.length,4);commit();}},
    read(address,length){return bytes.subarray(offset(address,length),offset(address,length)+length);}};
}
async function nativeFixture(memory){
  return pair(async socket=>{
    const reader=new Reader(socket);
    for(;;){
      const packet=await reader.read(REQUEST_BYTES),response=Buffer.alloc(RESPONSE_BYTES),output=response.subarray(16);
      const functionAddress=Number(packet.readBigUInt64LE(0)),args=Array.from({length:4},(_,i)=>Number(packet.readBigUInt64LE(8+i*8)));
      let result=0;
      if(functionAddress===SDK+0x158314){
        memory.offset(args[2],1);output.writeBigUInt64LE(BigInt(MAPPED));output.writeBigUInt64LE(BigInt(ALLOCATION_BYTES),8);output.writeUInt32LE(2,16);output.writeUInt32LE(3,24);
      }else if(functionAddress===SDK+0x5872f0){
        assert.equal(args[1],SCRATCH+0x40000+0x80);assert.ok(args[2]>0&&args[2]<=0x8000);
        memory.write(args[0],packet.subarray(0x80,0x80+args[2]));result=args[0];
      }else if(functionAddress===SDK+0x586fb0){
        assert.equal(args[0],SCRATCH+0x4040);assert.ok(args[2]>0&&args[2]<=0x8000);
        memory.read(args[1],args[2]).copy(output);result=args[0];
      }else throw Error('Unexpected emulated native function');
      response.writeBigUInt64LE(BigInt(result),8);await write(socket,response);
    }
  });
}
async function receiverFixture(memory){
  return pair(async socket=>{
    const reader=new Reader(socket);
    for(;;){
      const token=await reader.read(8); // receive the gate before reading the trusted descriptor.
      const descriptor=memory.read(CONTROL,16),destination=Number(descriptor.readBigUInt64LE()),length=descriptor.readUInt32LE(8);
      assert.equal(descriptor.readUInt32LE(12),0);assert.ok(length>P.FRAME_HEADER_BYTES&&length<=P.SLOT_BYTES);
      assert.ok(destination>=MAPPED+P.HEADER_BYTES&&(destination-MAPPED-P.HEADER_BYTES)%P.SLOT_BYTES===0);
      memory.offset(destination,length);
      const staging=await reader.read(length);memory.write(destination,staging);
      // reset before acknowledgement; the next upload must arm the worker again.
      const idle=Buffer.alloc(16);idle.writeBigUInt64LE(BigInt(CONTROL+16));memory.write(CONTROL,idle);
      const ack=Buffer.alloc(24);token.copy(ack);ack.writeBigInt64LE(8n,8);ack.writeBigInt64LE(BigInt(length),16);await write(socket,ack);
    }
  });
}
function inputFrames(profile,count){
  return Array.from({length:count},(_,index)=>{
    const payload=Buffer.alloc(profile.width*profile.height/2);
    for(let i=0;i<payload.length;i++)payload[i]=(i*17+Math.floor(i/4096)+index*31)&255;
    return {...profile,payload,ptsMs:Math.round(index*1000/profile.fps)};
  });
}
const wire=sockets=>sockets.reduce((sum,socket)=>({sent:sum.sent+socket.bytesWritten,received:sum.received+socket.bytesRead}),{sent:0,received:0});
async function runPath(kind,frames,warmup){
  const memory=store(),native=await nativeFixture(memory);let receiver,sender,transport;
  try{
    const rpc=new NativeClient(new Connection(native.client,TIMEOUT_MS),{sdk:SDK,scratch:SCRATCH});
    if(kind==='dedicated'){
      receiver=await receiverFixture(memory);
      sender=require('./receiver.cjs').createBulkSender({rpc,socket:receiver.client,control:CONTROL,mapped:MAPPED,timeoutMs:TIMEOUT_MS});
    }
    transport=P.createTransport({rpc,mapped:MAPPED,...(sender?{upload:sender.upload}:{})});
    const sockets=[native.client,...(receiver?[receiver.client]:[])],samples=[];let baseline,nativeBaseline,startCalls;
    for(let i=0;i<frames.length;i++){
      if(i===warmup){baseline=wire(sockets);nativeBaseline=wire([native.client]);startCalls=rpc.calls;}
      const frame=frames[i];memory.expect(frame);const start=performance.now();
      assert.equal(await transport.publish(frame.payload,frame.ptsMs,{width:frame.width,height:frame.height}),true);
      const state=await transport.poll();assert.equal(state.activeFrameSeq,transport.publishedFrameSeq);assert.equal(state.activePtsMs,frame.ptsMs);
      if(i>=warmup)samples.push(performance.now()-start);
      if(native.failure||receiver?.failure)throw native.failure||receiver.failure;
    }
    const end=wire(sockets),nativeEnd=wire([native.client]);assert.equal(memory.commits,frames.length);assert.equal(transport.stats.droppedFrames,0);
    if(sender){assert.equal(sender.stats.frames,frames.length,'Every dedicated frame used the real bulk sender');assert.equal(sender.stats.descriptorWrites,frames.length);}
    const sentBytes=end.sent-baseline.sent,receivedBytes=end.received-baseline.received;
    const rpcBytes=nativeEnd.sent-nativeBaseline.sent+nativeEnd.received-nativeBaseline.received;
    return {samples,sentBytes,receivedBytes,rpcBytes,bulkBytes:sentBytes+receivedBytes-rpcBytes,nativeExchanges:rpc.calls-startCalls,verifiedFrames:samples.length};
  }finally{
    try{await transport?.close();}finally{sender?.close();try{await receiver?.close();}finally{await native.close();}}
  }
}
function summary(runs){
  const samples=runs.flatMap(run=>run.samples).sort((a,b)=>a-b),percentile=p=>samples[Math.max(0,Math.ceil(samples.length*p)-1)];
  const totals=Object.fromEntries(['sentBytes','receivedBytes','rpcBytes','bulkBytes','nativeExchanges','verifiedFrames'].map(key=>[key,runs.reduce((n,run)=>n+run[key],0)]));
  const rounded=value=>Number(value.toFixed(3));
  return {...totals,applicationBytes:totals.sentBytes+totals.receivedBytes,applicationBytesPerFrame:(totals.sentBytes+totals.receivedBytes)/samples.length,
    latencyMs:{p50:rounded(percentile(.5)),p95:rounded(percentile(.95)),max:rounded(samples.at(-1))},samplesMs:samples.map(rounded)};
}
async function main(args=process.argv.slice(2)){
  const config=options(args);
  if(config.help){console.log('Usage: node stremio/benchmark-transport.cjs [--samples 1..500] [--warmup 0..500] [--rounds 1..8] [--quality 180p|360p|540p|720p] [--self-test]');return;}
  const results=[];
  for(const quality of config.qualities){
    const profile=PROFILES[quality],frames=inputFrames(profile,config.samples+config.warmup),runs={legacy:[],dedicated:[]};
    for(let round=0;round<config.rounds;round++)for(const kind of round%2?['dedicated','legacy']:['legacy','dedicated'])runs[kind].push(await runPath(kind,frames,config.warmup));
    const legacy=summary(runs.legacy),dedicated=summary(runs.dedicated);
    results.push({quality,width:profile.width,height:profile.height,bc1PayloadBytes:frames[0].payload.length,legacy,dedicated,
      applicationByteReductionPercent:Number((100*(1-dedicated.applicationBytes/legacy.applicationBytes)).toFixed(3))});
  }
  const result={scope:'Loopback TCP and emulated native RPC only; receiver-ready acknowledgement is synthetic, not console FPS or GPU presentation.',
    exclusions:['FFmpeg and BC1 encoding','HTTP/base64 RPC proxies','network latency and packet headers','console CPU/GPU and audio','connection setup and teardown'],
    included:['actual NativeClient guarded fixed-size exchanges','dedicated descriptor write, token/body/ACK and RPC commit','identical RPC acknowledgement polling','full received-frame equality checks'],
    platform:process.platform,arch:process.arch,node:process.version,config,results};
  console.log(JSON.stringify(result,null,2));return result;
}
module.exports={main,options,summary,runPath};
if(require.main===module)main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
