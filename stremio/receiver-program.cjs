'use strict';
const {build,SENTINEL}=require('../vendor/GPUBrewLauncher/smilebasic/engine/shared/frames.cjs');
const threadCode=require('../vendor/GPUBrewLauncher/smilebasic/engine/switch2/app/thread-code.json').functions;
const sockets=require('../vendor/GPUBrewLauncher/sdk/native/ftp-functions.json');
const copy=require('../vendor/GPUBrewLauncher/sdk/native/ipc-functions.json').copy;
const P=require('./protocol.cjs');
const ALLOCATION_BYTES=0x400000,SDK_BYTES=0x5e1000,FRAME_REGION_BYTES=0x40000;
const TRIGGER_BYTES=8,ACK_BYTES=24,DESCRIPTOR_BYTES=16,HANDSHAKE_BYTES=32,MSG_WAITALL=0x40;
const MAX_PACKET=P.FRAME_HEADER_BYTES+Math.max(...P.FORMATS.map(row=>row.bytes));
// pinned connect entry; verify all function bytes against the live sdk.
const FUNCTIONS=Object.freeze({connect:Object.freeze({offset:1313872,hex:'6c121214'}),
  recv:Object.freeze({...sockets.recv}),send:Object.freeze({...sockets.send}),copy:Object.freeze({...copy})});
const OFFSETS=Object.freeze({control:0x2000,selector:0x2010,ack:0x2100,sockaddr:0x2200,
  handshake:0x2300,results:0x2400,idleDescriptor:0x2500,live:0x10000,snapshot:0x50000,
  boot:0x90000,bootSnapshot:0xd0000,exit:0x110000,exitStack:0x130000,staging:0x200000});
const check=(value,message)=>{if(!value)throw Error(message);};
const range=(address,length)=>Number.isSafeInteger(address)&&address>=4096&&Number.isSafeInteger(length)&&length>=0&&address+length<2**39;
const overlaps=(a,an,b,bn)=>a<b+bn&&b<a+an;
function descriptor({mapped,address,length}){
  check(range(mapped,P.MEMORY_BYTES)&&mapped%4096===0,'Invalid receiver media mapping');
  const relative=address-mapped-P.HEADER_BYTES;
  check(Number.isSafeInteger(address)&&relative>=0&&relative%P.SLOT_BYTES===0&&relative/P.SLOT_BYTES<P.SLOTS,
    'Receiver destination is not an owned media slot');
  check(Number.isInteger(length)&&P.FORMATS.some(row=>length===P.FRAME_HEADER_BYTES+row.bytes)&&length<=MAX_PACKET,
    'Invalid receiver packet length');
  const bytes=Buffer.alloc(DESCRIPTOR_BYTES);bytes.writeBigUInt64LE(BigInt(address));bytes.writeUInt32LE(length,8);return bytes;
}
function requirements(sdk){
  check(range(sdk,SDK_BYTES)&&sdk%4096===0,'Invalid receiver SDK mapping');
  return [...Object.entries(FUNCTIONS).map(([name,value])=>({name,address:sdk+value.offset,hex:value.hex})),
    ...['loadTable','call4','saveResult64','longjmp','exit'].map(name=>({name,address:sdk+threadCode[name].offset,hex:threadCode[name].bytes.slice(0,512)}))];
}
function programs({base,sdk,mapped,memoryBytes=P.MEMORY_BYTES,fd,functions,sockaddr,handshake,code=threadCode}){
  check(range(base,ALLOCATION_BYTES)&&base%4096===0,'Invalid receiver allocation');
  check(range(sdk,SDK_BYTES)&&sdk%4096===0,'Invalid receiver SDK mapping');
  check(memoryBytes===P.MEMORY_BYTES&&range(mapped,memoryBytes)&&mapped%4096===0,'Invalid receiver media mapping');
  check(!overlaps(base,ALLOCATION_BYTES,mapped,memoryBytes)&&!overlaps(base,ALLOCATION_BYTES,sdk,SDK_BYTES)&&
    !overlaps(mapped,memoryBytes,sdk,SDK_BYTES),'Receiver mappings overlap');
  check(Number.isInteger(fd)&&fd>=0&&fd<=0x7fffffff,'Invalid receiver socket');
  check(Buffer.isBuffer(sockaddr)&&sockaddr.length===16&&sockaddr[0]===16&&sockaddr[1]===2&&sockaddr.readUInt16BE(2)>0&&
    sockaddr.subarray(8).every(byte=>byte===0)&&sockaddr[4]>0&&sockaddr[4]<224,'Invalid receiver IPv4 address');
  check(Buffer.isBuffer(handshake)&&handshake.length===HANDSHAKE_BYTES&&!handshake.every(byte=>byte===0),'Invalid receiver handshake');
  for(const name of ['loadTable','call4','saveResult64','longjmp','exit'])
    check(code?.[name]?.offset===threadCode[name].offset,'Receiver requires the pinned qualified thread frame');
  for(const name of ['connect','recv','send'])
    check(functions?.[name]===sdk+FUNCTIONS[name].offset,`Receiver requires the qualified ${name} function`);
  check(functions.copy===undefined||functions.copy===sdk+copy.offset,'Receiver requires the qualified copy function');
  const layout=Object.fromEntries(Object.entries(OFFSETS).map(([name,offset])=>[name,base+offset]));
  const {control,selector,ack,live,snapshot,boot,bootSnapshot,exit,exitStack,staging,idleDescriptor,results}=layout;
  const copyAddress=sdk+copy.offset,jump=sdk+code.longjmp.offset;
  const call=(fn,...args)=>({function:fn,args:[...args,...Array(4-args.length).fill(0)]});
  const restore=call(copyAddress,live,snapshot,0);
  const calls=[
    call(functions.recv,fd,ack,TRIGGER_BYTES,MSG_WAITALL),
    // indirect arguments load only after the fixed trigger has returned.
    call(functions.recv,fd,staging,{u32:control+8},MSG_WAITALL),
    call(copyAddress,{u64:control},staging,{u32:control+8}),
    // reset before acknowledgement so a later disconnect cannot rewrite the
    // last slot after the host has published it.
    call(copyAddress,control,idleDescriptor,DESCRIPTOR_BYTES),
    call(functions.send,fd,ack,ACK_BYTES,0),
    restore,
    call(jump,{u64:selector},1)
  ];
  let loop=build(live,sdk,calls,code);restore.args[2]=loop.frame.length;loop=build(live,sdk,calls,code);
  const bootCalls=[call(functions.connect,fd,layout.sockaddr,16),
    call(functions.send,fd,layout.handshake,HANDSHAKE_BYTES,0),call(jump,{u64:selector},1)];
  const startup=build(boot,sdk,bootCalls,code);
  check(loop.frame.length<=FRAME_REGION_BYTES&&startup.frame.length<=FRAME_REGION_BYTES&&staging+MAX_PACKET<=base+ALLOCATION_BYTES,
    'Receiver frame exceeds owned storage');
  function redirect(built,index,address){
    const native=built.proof.logicalResultIndices[index];
    built.frame.writeBigUInt64LE(BigInt(address),built.proof.stackOffset+native*0x140+0x118);
  }
  redirect(loop,0,ack+8);redirect(loop,1,ack+16);redirect(loop,4,results+16);
  const bootResults={connect:results,send:results+8};
  redirect(startup,0,bootResults.connect);redirect(startup,1,bootResults.send);
  const stop=Buffer.alloc(0xb0);stop.writeBigUInt64LE(BigInt(sdk+code.exit.offset),0x58);stop.writeBigUInt64LE(BigInt(exitStack),0x68);
  const pointer=Buffer.alloc(8);pointer.writeBigUInt64LE(BigInt(live));
  const idle=Buffer.alloc(DESCRIPTOR_BYTES);idle.writeBigUInt64LE(BigInt(staging));
  const initialResults=Buffer.alloc(24);for(let at=0;at<initialResults.length;at+=8)initialResults.writeBigUInt64LE(SENTINEL,at);
  const initialAck=Buffer.alloc(ACK_BYTES);initialAck.writeBigUInt64LE(SENTINEL,8);initialAck.writeBigUInt64LE(SENTINEL,16);
  const initialization=[{address:control,bytes:Buffer.from(idle)},{address:selector,bytes:pointer},
    {address:ack,bytes:initialAck},{address:layout.sockaddr,bytes:Buffer.from(sockaddr)},
    {address:layout.handshake,bytes:Buffer.from(handshake)},{address:results,bytes:initialResults},
    {address:idleDescriptor,bytes:idle},{address:live,bytes:loop.frame},{address:snapshot,bytes:Buffer.from(loop.frame)},
    {address:boot,bytes:startup.frame},{address:bootSnapshot,bytes:Buffer.from(startup.frame)},{address:exit,bytes:stop}];
  const readbacks=initialization.map(({address,bytes})=>({address,bytes:Buffer.from(bytes)}));
  return {...layout,allocationBytes:ALLOCATION_BYTES,ackBytes:ACK_BYTES,descriptorBytes:DESCRIPTOR_BYTES,
    maxPacket:MAX_PACKET,initialization,readbacks,bootResults,sendResult:results+16,
    frame:loop.frame,bootFrame:startup.frame,stop,proof:loop.proof,bootProof:startup.proof,
    requirements:requirements(sdk),logicalCalls:calls,bootCalls};
}
function selfTest(){
  const base=0x10000000,sdk=0x50000000,mapped=0x20000000,sockaddr=Buffer.alloc(16);
  sockaddr[0]=16;sockaddr[1]=2;sockaddr.writeUInt16BE(10000,2);sockaddr.set([192,168,1,10],4);
  const functions=Object.fromEntries(Object.entries(FUNCTIONS).map(([name,value])=>[name,sdk+value.offset]));
  const program=programs({base,sdk,mapped,fd:7,functions,sockaddr,handshake:Buffer.alloc(32,0x5a)});
  check(program.proof.logicalResultIndices[0]===0&&program.proof.logicalResultIndices[1]>1,'Receiver gate is not first');
  check(program.initialization.every(({address,bytes})=>address>=base&&address+bytes.length<=base+ALLOCATION_BYTES),'Receiver initialization exceeds storage');
  for(const format of P.FORMATS)for(let slot=0;slot<P.SLOTS;slot++){
    const bytes=descriptor({mapped,address:mapped+P.HEADER_BYTES+slot*P.SLOT_BYTES,length:P.FRAME_HEADER_BYTES+format.bytes});
    check(bytes.length===16&&bytes.readUInt32LE(12)===0,'Receiver descriptor layout differs');
  }
  check(program.logicalCalls[3].args[0]===program.control&&program.logicalCalls[4].function===functions.send,'Receiver idle reset is after acknowledgement');
  check(program.readbacks.find(row=>row.address===program.snapshot).bytes.equals(program.frame),'Receiver snapshot differs');
  return {ok:true,formats:P.FORMATS.length,slots:P.SLOTS,allocationBytes:ALLOCATION_BYTES,maxPacket:MAX_PACKET};
}
module.exports={programs,descriptor,requirements,selfTest,FUNCTIONS,OFFSETS,ALLOCATION_BYTES,ACK_BYTES,TRIGGER_BYTES,
  DESCRIPTOR_BYTES,HANDSHAKE_BYTES,MAX_PACKET,MSG_WAITALL,SENTINEL};
if(require.main===module){if(process.argv.length!==3||process.argv[2]!=='--self-test')throw Error('Usage: receiver-program.cjs --self-test');
  process.stdout.write(JSON.stringify(selfTest())+'\n');}
