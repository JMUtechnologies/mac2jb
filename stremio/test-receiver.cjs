'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net'),{once}=require('node:events');
const P=require('./protocol.cjs'),R=require('./receiver.cjs');
const mapped=0x10000000,control=0x20000000;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t,{acknowledge,descriptorFailure=false,holdDescriptor=false,timeoutMs=500}={}){
  let peer,accept;const accepted=new Promise(resolve=>{accept=resolve;});
  const server=net.createServer(socket=>{peer=socket;socket.on('error',()=>{});accept();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const client=net.createConnection({host:'127.0.0.1',port:server.address().port});await once(client,'connect');await accepted;
  const memory=P.initialMemory(),writes=[];let trusted,received=Buffer.alloc(0),releaseDescriptor;
  const rpc={async write(address,bytes){
    writes.push({address,bytes:Buffer.from(bytes)});
    if(address===control){
      if(descriptorFailure)throw Error('uncertain descriptor');
      if(holdDescriptor)await new Promise(resolve=>{releaseDescriptor=resolve;});
      trusted=Buffer.from(bytes);return;
    }
    assert.equal(address,mapped+P.COMMIT_OFFSET);assert.equal(bytes.length,4);bytes.copy(memory,P.COMMIT_OFFSET);
  },async read(address,length){return Buffer.from(memory.subarray(address-mapped,address-mapped+length));}};
  peer.on('data',bytes=>{
    received=Buffer.concat([received,bytes]);if(received.length<8)return;
    assert.ok(trusted,'Trusted descriptor precedes trigger');const length=trusted.readUInt32LE(8);
    if(received.length<length+8)return;
    assert.equal(received.length,length+8);const token=received.subarray(0,8),body=received.subarray(8),destination=Number(trusted.readBigUInt64LE());
    body.copy(memory,destination-mapped);const ack=Buffer.alloc(24);token.copy(ack);ack.writeBigInt64LE(8n,8);ack.writeBigInt64LE(BigInt(length),16);
    received=Buffer.alloc(0);trusted=undefined;
    if(acknowledge)acknowledge(peer,ack);else peer.write(ack);
  });
  const sender=R.createBulkSender({rpc,socket:client,control,mapped,timeoutMs}),transport=P.createTransport({rpc,mapped,upload:sender.upload});
  t.after(async()=>{releaseDescriptor?.();sender.close();peer.destroy();await transport.close();await new Promise(resolve=>server.close(resolve));});
  return {sender,transport,rpc,memory,writes,peer,client,release(){releaseDescriptor?.();},
    consume(){const value=memory.readUInt32LE(P.COMMIT_OFFSET);memory.writeUInt32LE(value,P.ACK_OFFSET);memory.writeUInt32LE(1,P.ACK_OFFSET+4);memory.writeUInt32LE(1,204);},
    frame:Buffer.alloc(P.BC1_BYTES,0x5a)};
}
test('bulk frames preserve every supported format and commit only after exact fragmented ACK',async t=>{
  const f=await fixture(t,{acknowledge(socket,ack){socket.write(ack.subarray(0,3));setImmediate(()=>{socket.write(ack.subarray(3,15));setImmediate(()=>socket.write(ack.subarray(15)));});}});
  for(const [index,format]of P.FORMATS.entries()){
    const data=Buffer.alloc(format.bytes,index+1);assert.equal(await f.transport.publish(data,index,format),true);
    const slot=f.memory.readUInt32LE(P.COMMIT_OFFSET)&3,offset=P.HEADER_BYTES+slot*P.SLOT_BYTES;
    assert.ok(f.memory.subarray(offset+16,offset+16+data.length).equals(data));f.consume();
  }
  assert.equal(f.sender.stats.frames,P.FORMATS.length);
  assert.deepEqual(f.writes.map(row=>row.address),P.FORMATS.flatMap(()=>[control,mapped+P.COMMIT_OFFSET]));
});
test('a complete payload cannot publish before receiver ACK and pending frames do not overwrite slots',async t=>{
  let acknowledge;const f=await fixture(t,{acknowledge(socket,ack){acknowledge=()=>socket.write(ack);}});
  const first=f.transport.publish(f.frame,0);while(!acknowledge)await tick();
  assert.equal(f.memory.readUInt32LE(P.COMMIT_OFFSET),0);assert.equal(f.writes.length,1);acknowledge();await first;
  assert.equal(await f.transport.publish(f.frame,1),false);assert.equal(f.writes.length,2);
});
for(const kind of ['wrong-token','short-trigger','short-body','negative-body','oversized','partial-eof','no-ack'])test(kind+' permanently rejects publication without commit or replay',async t=>{
  const f=await fixture(t,{timeoutMs:30,acknowledge(socket,ack){
    if(kind==='wrong-token')ack[0]^=0xff;
    if(kind==='short-trigger')ack.writeBigInt64LE(7n,8);
    if(kind==='short-body')ack.writeBigInt64LE(BigInt(f.frame.length),16);
    if(kind==='negative-body')ack.writeBigInt64LE(-1n,16);
    if(kind==='oversized')ack=Buffer.concat([ack,Buffer.alloc(1)]);
    if(kind==='partial-eof'){socket.end(ack.subarray(0,10));return;}
    if(kind!=='no-ack')socket.write(ack);
  }});
  await assert.rejects(f.transport.publish(f.frame,0),/receiver|acknowledgement/);
  assert.equal(f.memory.readUInt32LE(P.COMMIT_OFFSET),0);assert.equal(f.writes.length,1);
  await assert.rejects(f.transport.publish(f.frame,1));await assert.rejects(f.transport.poll());assert.equal(f.writes.length,1);
});
test('uncertain descriptor delivery sends no token or payload and is never retried',async t=>{
  const f=await fixture(t,{descriptorFailure:true});await assert.rejects(f.transport.publish(f.frame,0),/uncertain descriptor/);
  assert.equal(f.sender.stats.wireSentBytes,0);assert.equal(f.writes.length,1);await assert.rejects(f.transport.publish(f.frame,1));
});
test('cancelling while descriptor delivery is pending prevents later socket delivery',async t=>{
  const f=await fixture(t,{holdDescriptor:true});const pending=f.transport.publish(f.frame,0);while(!f.writes.length)await tick();
  f.sender.close();f.release();await assert.rejects(pending,{code:'STREMIO_RECEIVER_CANCELLED'});
  assert.equal(f.sender.stats.wireSentBytes,0);assert.equal(f.writes.length,1);
});
test('cancelling while awaiting ACK settles immediately and leaves the frame uncommitted',async t=>{
  let received=false;const f=await fixture(t,{acknowledge(){received=true;}}),pending=f.transport.publish(f.frame,0);
  while(!received)await tick();f.sender.close();await assert.rejects(pending,{code:'STREMIO_RECEIVER_CANCELLED'});
  assert.equal(f.memory.readUInt32LE(P.COMMIT_OFFSET),0);
});
test('unsolicited acknowledgement bytes poison the connection before another descriptor',async t=>{
  const f=await fixture(t);f.peer.write(Buffer.alloc(24));while(!f.sender.failed)await tick();
  await assert.rejects(f.transport.publish(f.frame,0),/Unexpected/);assert.equal(f.writes.length,0);
});
test('receiver descriptor rejects pointers, partial slots, oversized lengths and unsupported formats',()=>{
  for(const address of [mapped,mapped+P.HEADER_BYTES+1,mapped+P.MEMORY_BYTES,NaN,2**40])assert.throws(()=>R.descriptor({mapped,address,length:460816}));
  for(const length of [0,16,460815,460817,P.SLOT_BYTES,2**32])assert.throws(()=>R.descriptor({mapped,address:mapped+P.HEADER_BYTES,length}));
  const bytes=R.descriptor({mapped,address:mapped+P.HEADER_BYTES+P.SLOT_BYTES,length:460816});assert.equal(bytes.readUInt32LE(12),0);
});
test('listener requires exact worker secret and allows fragmented authentication',async t=>{
  const token=Buffer.alloc(32,0x39),listener=await R.listen({host:'127.0.0.1',consoleIP:'127.0.0.1',token,timeoutMs:1000});
  let good;t.after(async()=>{good?.destroy();await listener.close();});
  const bad=net.createConnection({host:'127.0.0.1',port:listener.port});bad.on('error',()=>{});await once(bad,'connect');bad.write(Buffer.alloc(32));await once(bad,'close');
  good=net.createConnection({host:'127.0.0.1',port:listener.port});good.on('error',()=>{});await once(good,'connect');
  const pending=listener.wait();good.write(token.subarray(0,5));await tick();good.write(token.subarray(5));const accepted=await pending;
  assert.equal(accepted.destroyed,false);assert.equal(accepted.isPaused(),true);
});
test('listener startup deadline begins when the worker starts, after program upload',async t=>{
  const token=Buffer.alloc(32),listener=await R.listen({host:'127.0.0.1',consoleIP:'127.0.0.1',token,timeoutMs:15});t.after(()=>listener.close());
  await new Promise(resolve=>setTimeout(resolve,30));await assert.rejects(listener.wait(),/did not authenticate/);
});
