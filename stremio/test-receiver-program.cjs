'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const N=require('./receiver-program.cjs'),P=require('./protocol.cjs');
const code=require('../vendor/GPUBrewLauncher/smilebasic/engine/switch2/app/thread-code.json').functions;
function options(){
  const base=0x10000000,sdk=0x50000000,mapped=0x20000000,sockaddr=Buffer.alloc(16);
  sockaddr[0]=16;sockaddr[1]=2;sockaddr.writeUInt16BE(10000,2);sockaddr.set([192,168,1,10],4);
  return {base,sdk,mapped,fd:7,functions:Object.fromEntries(Object.entries(N.FUNCTIONS).map(([key,value])=>[key,sdk+value.offset])),
    sockaddr,handshake:Buffer.alloc(32,0x5a),code};
}
// interpret emitted tables and argument slots without executing console code.
function machine(opts=options()){
  const program=N.programs(opts),allocation=Buffer.alloc(N.ALLOCATION_BYTES),media=P.initialMemory(),writes=[];
  function view(address,length){
    assert.ok(Number.isSafeInteger(address)&&Number.isInteger(length)&&length>=0,'Bounded integer memory access');
    if(address>=opts.base&&address+length<=opts.base+allocation.length)return allocation.subarray(address-opts.base,address-opts.base+length);
    if(address>=opts.mapped&&address+length<=opts.mapped+media.length)return media.subarray(address-opts.mapped,address-opts.mapped+length);
    assert.fail(`Unowned memory access ${address.toString(16)} + ${length}`);
  }
  function put(address,bytes){view(address,bytes.length).set(bytes);writes.push({address,length:bytes.length});}
  const word=address=>view(address,8).readBigUInt64LE();
  const setWord=(address,value)=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(BigInt.asUintN(64,BigInt(value)));put(address,bytes);};
  for(const row of program.initialization)put(row.address,row.bytes);
  writes.length=0;
  function run({boot=false,incoming=[],afterReceive=()=>{},onSend=()=>{},connectResult=0,sendResult}={}){
    const address=boot?program.boot:program.live,proof=boot?program.bootProof:program.proof;
    let received=0,jump;const sent=[],calls=[];
    for(let index=0;index<proof.nativeCalls;index++){
      const sp=address+proof.stackOffset+index*0x140;
      const fn=Number(word(address+proof.tablesOffset+index*0x100+0x78));
      const args=[Number(word(index===0?address+0x30:sp-0x140+0xe8)),
        ...[0x10,0x20,0x28].map(offset=>Number(word(sp+offset)))];
      calls.push({fn,args});let result;
      if(fn===opts.functions.copy){const bytes=Buffer.from(view(args[1],args[2]));put(args[0],bytes);result=args[0];}
      else if(fn===opts.functions.recv){
        const next=incoming[received++]||{bytes:Buffer.alloc(0),result:0};
        assert.equal(args[0],opts.fd);assert.equal(args[3],N.MSG_WAITALL);
        const count=next.result??next.bytes.length;
        assert.ok(count<0||count<=args[2],'Native recv cannot exceed the requested bound');
        if(count>0)put(args[1],next.bytes.subarray(0,count));result=count;
        afterReceive({number:received,args,machine:{put,setWord,view}});
      }else if(fn===opts.functions.send){
        assert.equal(args[0],opts.fd);assert.equal(args[3],0);
        const bytes=Buffer.from(view(args[1],args[2]));sent.push(bytes);onSend({bytes,put,setWord,view});result=sendResult??args[2];
      }else if(fn===opts.functions.connect){assert.equal(args[2],16);assert.deepEqual(view(args[1],16),opts.sockaddr);result=connectResult;}
      else if(fn===opts.sdk+code.longjmp.offset){jump=args[0];assert.equal(args[1],1);break;}
      else assert.fail(`Unqualified function ${fn.toString(16)}`);
      setWord(Number(word(sp+0x118)),result);
    }
    return {sent,calls,jump,received};
  }
  return {opts,program,allocation,media,writes,view,put,word,setWord,run};
}
function packet(format,sequence=1){const bytes=Buffer.alloc(P.FRAME_HEADER_BYTES+format.bytes,0xa7);
  bytes.writeUInt32LE(sequence);bytes.writeUInt32LE(123,4);bytes.writeUInt32LE(format.width,8);bytes.writeUInt32LE(format.height,12);return bytes;}
const token=Buffer.from('0102030405060708','hex');
test('offline packaged self-test builds the qualified receiver',()=>assert.deepEqual(N.selfTest(),{
  ok:true,formats:5,slots:3,allocationBytes:0x400000,maxPacket:1036816}));
test('descriptors accept only exact owned slot starts and supported packet lengths',()=>{
  const {mapped}=options();for(const format of P.FORMATS)for(let slot=0;slot<P.SLOTS;slot++){
    const address=mapped+P.HEADER_BYTES+slot*P.SLOT_BYTES,length=P.FRAME_HEADER_BYTES+format.bytes;
    const bytes=N.descriptor({mapped,address,length});assert.equal(Number(bytes.readBigUInt64LE()),address);
    assert.equal(bytes.readUInt32LE(8),length);assert.equal(bytes.readUInt32LE(12),0);
  }
  const valid={mapped,address:mapped+P.HEADER_BYTES,length:P.FRAME_HEADER_BYTES+P.FORMATS[0].bytes};
  for(const address of [mapped,mapped+P.COMMIT_OFFSET,valid.address+1,valid.address-1,valid.address+3*P.SLOT_BYTES,NaN,Infinity])
    assert.throws(()=>N.descriptor({...valid,address}),/owned media slot/);
  for(const length of [-1,0,16,valid.length-1,valid.length+1,P.SLOT_BYTES,2**32,1.5,NaN])
    assert.throws(()=>N.descriptor({...valid,length}),/packet length/);
  for(const mapped of [0,-1,1.5,4097,2**39-P.MEMORY_BYTES,NaN])assert.throws(()=>N.descriptor({...valid,mapped}),/media mapping/);
});
test('worker rejects overlapping or unqualified mappings, functions and malformed bootstrap data',()=>{
  const o=options();for(const changes of [{base:o.mapped},{base:o.sdk},{mapped:o.sdk},{base:4097},{sdk:0},{mapped:2**39},
    {memoryBytes:P.MEMORY_BYTES-1},{fd:-1},{fd:2**31},{fd:1.5},{handshake:Buffer.alloc(32)},{handshake:Buffer.alloc(31,1)},
    {sockaddr:Buffer.alloc(16)},{sockaddr:Buffer.alloc(17)},{code:{...code,longjmp:{offset:4}}},
    {functions:{...o.functions,recv:o.functions.recv+4}},{functions:{...o.functions,copy:o.functions.copy+4}}])
    assert.throws(()=>N.programs({...o,...changes}));
});
test('initialization and readbacks cover isolated frame/control regions with safe idle and sentinel results',()=>{
  const m=machine(),p=m.program;
  for(const [i,a]of p.initialization.entries()){
    assert.ok(a.address>=m.opts.base&&a.address+a.bytes.length<=m.opts.base+N.ALLOCATION_BYTES);
    for(const b of p.initialization.slice(i+1))assert.ok(a.address+a.bytes.length<=b.address||b.address+b.bytes.length<=a.address);
  }
  assert.deepEqual(p.readbacks,p.initialization);assert.equal(m.word(p.control),BigInt(p.staging));assert.equal(m.word(p.control+8),0n);
  assert.equal(m.word(p.selector),BigInt(p.live));assert.equal(m.word(p.bootResults.connect),N.SENTINEL);assert.equal(m.word(p.bootResults.send),N.SENTINEL);
  assert.equal(m.word(p.ack+8),N.SENTINEL);assert.equal(m.word(p.ack+16),N.SENTINEL);
  assert.ok(p.staging+N.MAX_PACKET<m.opts.base+N.ALLOCATION_BYTES);
  assert.equal(m.word(p.exit+0x58),BigInt(m.opts.sdk+code.exit.offset));assert.equal(m.word(p.exit+0x68),BigInt(p.exitStack));
});
test('boot connects and sends only the handshake, persists results and obeys the exit selector',()=>{
  const m=machine(),p=m.program;const result=m.run({boot:true});
  assert.deepEqual(result.sent,[m.opts.handshake]);assert.equal(result.jump,p.live);assert.equal(m.word(p.bootResults.connect),0n);assert.equal(m.word(p.bootResults.send),32n);
  m.setWord(p.selector,p.exit);const stopped=m.run({boot:true,connectResult:-1,sendResult:-1});
  assert.equal(stopped.jump,p.exit);assert.equal(BigInt.asIntN(64,m.word(p.bootResults.connect)),-1n);assert.equal(BigInt.asIntN(64,m.word(p.bootResults.send)),-1n);
  assert.equal(m.writes.some(row=>row.address>=m.opts.mapped&&row.address<m.opts.mapped+P.MEMORY_BYTES),false);
});
test('descriptor loads occur after the trigger, packets are copied completely before ACK, and no worker publishes',()=>{
  for(const format of P.FORMATS)for(let slot=0;slot<P.SLOTS;slot++){
    const m=machine(),p=m.program,bytes=packet(format),address=m.opts.mapped+P.HEADER_BYTES+slot*P.SLOT_BYTES;
    const result=m.run({incoming:[{bytes:token},{bytes}],afterReceive({number,machine}){
      // set the descriptor as the trigger returns; earlier loads would see the
      // zero-length idle descriptor instead.
      if(number===1)machine.put(p.control,N.descriptor({mapped:m.opts.mapped,address,length:bytes.length}));
    },onSend({bytes:ack,view}){
      assert.deepEqual(view(address,bytes.length),bytes);assert.deepEqual(ack.subarray(0,8),token);
      assert.equal(ack.readBigInt64LE(8),8n);assert.equal(ack.readBigInt64LE(16),BigInt(bytes.length));
      assert.equal(view(p.control+8,4).readUInt32LE(),0,'Reset precedes ACK');
    }});
    assert.equal(result.jump,p.live);assert.equal(result.sent.length,1);assert.equal(m.media.readUInt32LE(P.COMMIT_OFFSET),0);
    assert.equal(result.calls[0].fn,m.opts.functions.recv);assert.deepEqual(result.calls[0].args,[7,p.ack,8,N.MSG_WAITALL]);
    const mediaWrites=m.writes.filter(row=>row.address>=m.opts.mapped&&row.address<m.opts.mapped+P.MEMORY_BYTES);
    assert.deepEqual(mediaWrites,[{address,length:bytes.length}]);
  }
});
test('short/failed receives are reflected in ACK and never publish or exceed the RPC-owned inactive slot',()=>{
  for(const triggerCount of [0,3,8,-1])for(const bodyCount of [0,7,-1]){
    const m=machine(),p=m.program,bytes=packet(P.FORMATS[0]),address=m.opts.mapped+P.HEADER_BYTES+P.SLOT_BYTES;
    m.media.fill(0x6c,P.HEADER_BYTES,P.HEADER_BYTES+P.SLOT_BYTES);m.media.writeUInt32LE(4,P.COMMIT_OFFSET);
    m.put(p.control,N.descriptor({mapped:m.opts.mapped,address,length:bytes.length}));
    const result=m.run({incoming:[{bytes:token,result:triggerCount},{bytes,result:bodyCount}]});
    assert.equal(result.sent[0].readBigInt64LE(8),BigInt(triggerCount));assert.equal(result.sent[0].readBigInt64LE(16),BigInt(bodyCount));
    assert.equal(m.media.readUInt32LE(P.COMMIT_OFFSET),4);assert.ok(m.media.subarray(P.HEADER_BYTES,P.HEADER_BYTES+P.SLOT_BYTES).every(byte=>byte===0x6c));
    assert.equal(m.word(p.control+8),0n);
  }
});
test('idle EOF after publication cannot rewrite the active frame, and host exit selection survives restoration',()=>{
  const m=machine(),p=m.program,bytes=packet(P.FORMATS[0]),address=m.opts.mapped+P.HEADER_BYTES;
  m.put(p.control,N.descriptor({mapped:m.opts.mapped,address,length:bytes.length}));m.run({incoming:[{bytes:token},{bytes}]});
  m.media.writeUInt32LE(4,P.COMMIT_OFFSET);const before=Buffer.from(m.media);m.writes.length=0;
  m.setWord(p.selector,p.exit);const result=m.run({incoming:[{bytes:Buffer.alloc(0)},{bytes:Buffer.alloc(0)}]});
  assert.equal(result.jump,p.exit);assert.deepEqual(m.media,before);
  assert.equal(m.writes.some(row=>row.address>=m.opts.mapped&&row.address<m.opts.mapped+P.MEMORY_BYTES),false);
  assert.equal(m.word(p.selector),BigInt(p.exit));assert.equal(result.sent[0].readBigInt64LE(8),0n);assert.equal(result.sent[0].readBigInt64LE(16),0n);
});
test('an ACK arms a different format/slot for the next iteration without frame argument leakage',()=>{
  const m=machine(),p=m.program;let sequence=0;
  for(const format of [...P.FORMATS].reverse()){
    const bytes=packet(format,++sequence),address=m.opts.mapped+P.HEADER_BYTES+(sequence%3)*P.SLOT_BYTES;
    m.put(p.control,N.descriptor({mapped:m.opts.mapped,address,length:bytes.length}));
    const result=m.run({incoming:[{bytes:token},{bytes}]});assert.deepEqual(m.view(address,bytes.length),bytes);
    assert.equal(result.sent[0].readBigInt64LE(16),BigInt(bytes.length));assert.equal(result.jump,p.live);
  }
});
test('network header fields are opaque data and cannot select destinations, lengths, functions or publication',()=>{
  const m=machine(),p=m.program,bytes=packet(P.FORMATS[0]),address=m.opts.mapped+P.HEADER_BYTES+2*P.SLOT_BYTES;
  bytes.fill(0xff,0,P.FRAME_HEADER_BYTES);m.put(p.control,N.descriptor({mapped:m.opts.mapped,address,length:bytes.length}));
  m.run({incoming:[{bytes:Buffer.alloc(8,0xff)},{bytes}]});assert.deepEqual(m.view(address,bytes.length),bytes);assert.equal(m.media.readUInt32LE(P.COMMIT_OFFSET),0);
  const targets=new Set(N.requirements(m.opts.sdk).map(row=>row.address));
  for(const [frame,proof]of [[p.frame,p.proof],[p.bootFrame,p.bootProof]])for(let n=0;n<proof.nativeCalls;n++)
    assert.ok(targets.has(Number(frame.readBigUInt64LE(proof.tablesOffset+n*0x100+0x78))));
});
