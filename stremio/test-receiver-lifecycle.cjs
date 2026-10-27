'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const receiver=require('./receiver.cjs'),native=require('./receiver-program.cjs'),P=require('./protocol.cjs');
const code=require('../vendor/GPUBrewLauncher/smilebasic/engine/switch2/app/thread-code.json').functions;
const sockets=require('../vendor/GPUBrewLauncher/sdk/native/ftp-functions.json');
async function fixture(t,mode={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mac2jb-receiver-lifecycle-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const base=0x10000000,sdk=0x50000000,mapped=0x20000000,memory=Buffer.alloc(native.ALLOCATION_BYTES);
  const events=[],verified=new Set(),writes=[];let program,listenToken,created=false,joined=false,sendReads=0;
  const view=(address,length)=>{
    assert.ok(Number.isSafeInteger(address)&&Number.isSafeInteger(length)&&length>=0&&address>=base&&address+length<=base+memory.length,
      'RPC fixture accesses only receiver-owned storage');return memory.subarray(address-base,address-base+length);
  };
  const putWord=(address,value)=>view(address,8).writeBigUInt64LE(BigInt.asUintN(64,BigInt(value)));
  class Peer extends EventEmitter{
    constructor(){super();this.destroyed=false;}
    setNoDelay(value){assert.equal(value,true);}
    resume(){events.push('peer-resume');}
    write(){assert.fail('Constructor fixture must not send a media packet');}
    destroy(){if(this.destroyed)return;this.destroyed=true;events.push('peer-destroy');this.emit('close');}
  }
  const peer=new Peer();
  const rpc={a:{sdk,session:'receiver-lifecycle-fixture'},output:base+0x40,
    async request(request){assert.equal(request.command,'verify-function');assert.ok(/^[0-9a-f]+$/.test(request.hex));verified.add(request.address);events.push('verify');return {};},
    async call(offset,args){assert.equal(offset,5732112);assert.deepEqual(args,[rpc.output,4096,native.ALLOCATION_BYTES]);events.push('allocate');
      const output=Buffer.alloc(8);output.writeBigUInt64LE(BigInt(base));return {result:0n,output};},
    async write(address,bytes){
      assert.ok(Buffer.isBuffer(bytes)&&bytes.length<=P.WRITE_BYTES,'Initialization writes remain bounded');
      const stopping=program&&address===program.selector&&bytes.length===8&&bytes.readBigUInt64LE()===BigInt(program.exit);
      if(stopping){events.push('selector-stop');if(mode.selectorError)throw Error('uncertain selector delivery');}
      writes.push({address,length:bytes.length});view(address,bytes.length).set(bytes);
    },
    async read(address,length){
      if(created&&address===base&&length===8){events.push('identity-read');
        if(mode.identityError)throw Error('uncertain thread identity');if(mode.truncatedIdentity)return Buffer.alloc(4);}
      if(created&&address===program.bootResults.send&&length===8){
        sendReads++;events.push('send-result-read');if(sendReads>(mode.delayedSendReads||0))putWord(address,32);
      }
      if(mode.corruptReadback&&!created&&program&&address===program.snapshot){const bytes=Buffer.from(view(address,length));bytes[0]^=1;return bytes;}
      return Buffer.from(view(address,length));
    },
    async callAddress(address,args){
      assert.ok(verified.has(address),'Every native function is verified before use');
      if(address===sdk+sockets.netAddress.offset){assert.deepEqual(args,[base+128]);view(args[0],4).set([127,0,0,1]);return {result:0n};}
      if(address===sdk+sockets.socket.offset){assert.deepEqual(args,[2,1,6]);events.push('socket-create');return {result:42n};}
      if(address===sdk+code.create.offset){
        assert.deepEqual(args,[base,0,sdk+code.longjmp.offset,program.boot]);events.push('thread-create');created=true;
        for(const entry of native.requirements(sdk))assert.ok(verified.has(entry.address));
        for(const {address,bytes}of program.readbacks)assert.deepEqual(view(address,bytes.length),bytes,'Real native program is fully initialized before create');
        putWord(base,99);putWord(program.bootResults.connect,0);
        if(!mode.delayedSendReads)putWord(program.bootResults.send,32);
        assert.deepEqual(view(program.handshake,32),listenToken,'Owned worker handshake matches the listener token');events.push('handshake');
        if(mode.createError)throw Error('uncertain pthread creation');return {result:0n};
      }
      if(address===sdk+code.tryWait.offset){assert.deepEqual(args,[99n]);events.push('thread-wait');
        assert.ok(peer.destroyed,'Peer is destroyed before waiting for receiver exit');
        if(mode.tryWaitError)throw Error('uncertain thread shutdown');return {result:1n};}
      if(address===sdk+code.join.offset){assert.deepEqual(args,[99n,base+8]);events.push('thread-join');
        if(mode.joinError)throw Error('uncertain thread join');joined=true;return {result:0n};}
      if(address===sdk+sockets.socketClose.offset){assert.deepEqual(args,[42]);assert.ok(!created||joined,'Socket is not closed underneath an unjoined worker');events.push('socket-close');return {result:0n};}
      assert.fail(`Unexpected native function ${address.toString(16)}`);
    }};
  const dependencies={native:{ALLOCATION_BYTES:native.ALLOCATION_BYTES,programs(options){program=native.programs(options);return program;}},
    async routeAddress(ip){assert.equal(ip,'127.0.0.1');return '127.0.0.1';},
    async listen({host,consoleIP,token}){assert.equal(host,'127.0.0.1');assert.equal(consoleIP,'127.0.0.1');listenToken=Buffer.from(token);events.push('listen');
      return {port:12345,async wait(){events.push('listen-wait');assert.ok(created);if(mode.handshakeError)throw Error('handshake did not authenticate');return peer;},
        async close(){events.push('listener-close');peer.destroy();}};}};
  return {directory,base,mapped,rpc,dependencies,events,writes,peer,view,get program(){return program;},get sendReads(){return sendReads;},
    create:()=>receiver.create({rpc,mapped,directory,dependencies}),report:async()=>JSON.parse(await fs.readFile(path.join(directory,'stremio-receiver.json'),'utf8'))};
}
function before(events,first,second){assert.ok(events.indexOf(first)>=0&&events.indexOf(second)>events.indexOf(first),`${first} precedes ${second}: ${events.join(',')}`);}
test('actual receiver constructor verifies and initializes the real program, then joins before closing its fd',async t=>{
  const f=await fixture(t),instance=await f.create();assert.equal(instance.report.ready,true);assert.equal(instance.report.thread,'99');
  assert.equal(instance.report.threadRunning,true);assert.equal(instance.stats.transport,'dedicated-tcp-v1');
  await instance.close();await instance.close();
  before(f.events,'selector-stop','peer-destroy');before(f.events,'peer-destroy','thread-wait');before(f.events,'thread-wait','thread-join');before(f.events,'thread-join','socket-close');
  assert.equal(f.events.filter(event=>event==='thread-join').length,1);assert.equal(f.events.filter(event=>event==='socket-close').length,1);
  const report=await f.report();assert.equal(report.cleanShutdown,true);assert.equal(report.threadRunning,false);assert.equal(report.cleanupBlocked,undefined);
  assert.equal(report.resourcesRetained,true);assert.equal(f.view(f.program.selector,8).readBigUInt64LE(),BigInt(f.program.exit));
});
test('authenticated startup tolerates delayed native send-result publication',async t=>{
  const f=await fixture(t,{delayedSendReads:2}),instance=await f.create();assert.equal(f.sendReads,3);assert.equal(instance.report.ready,true);
  before(f.events,'handshake','send-result-read');await instance.close();assert.equal((await f.report()).cleanShutdown,true);
});
for(const [name,mode]of [['identity read failure',{identityError:true}],['truncated identity',{truncatedIdentity:true}],['uncertain create result',{createError:true}]])
  test(`${name} requests exit, destroys the peer and retains the socket without an unproven join`,async t=>{
    const f=await fixture(t,mode);await assert.rejects(f.create(),error=>error.cleanupBlocked===true);
    before(f.events,'thread-create','selector-stop');before(f.events,'selector-stop','peer-destroy');
    assert.equal(f.events.includes('thread-join'),false);assert.equal(f.events.includes('socket-close'),false);
    const report=await f.report();assert.equal(report.cleanShutdown,false);assert.equal(report.cleanupBlocked,true);assert.equal(report.resourcesRetained,true);
  });
test('uncertain selector delivery and unproven exit retain the fd and block cleanup',async t=>{
  const f=await fixture(t,{selectorError:true,tryWaitError:true}),instance=await f.create();
  await assert.rejects(instance.close(),error=>error.cleanupBlocked===true&&/selector/.test(error.message));
  before(f.events,'selector-stop','peer-destroy');assert.equal(f.events.includes('thread-wait'),true);assert.equal(f.events.includes('thread-join'),false);
  assert.equal(f.events.includes('socket-close'),false);const report=await f.report();assert.equal(report.threadRunning,true);assert.equal(report.cleanupBlocked,true);
});
test('a failed join retains the fd and reports uncertain cleanup without replaying shutdown',async t=>{
  const f=await fixture(t,{joinError:true}),instance=await f.create();
  await assert.rejects(instance.close(),error=>error.cleanupBlocked===true&&/join/.test(error.message));
  await assert.rejects(instance.close(),/join/);assert.equal(f.events.filter(event=>event==='thread-join').length,1);
  assert.equal(f.events.includes('socket-close'),false);assert.equal((await f.report()).cleanupBlocked,true);
});
test('authentication failure still stops and joins the owned worker before closing its fd',async t=>{
  const f=await fixture(t,{handshakeError:true});await assert.rejects(f.create(),error=>/authenticate/.test(error.message)&&!error.cleanupBlocked);
  before(f.events,'selector-stop','peer-destroy');before(f.events,'thread-join','socket-close');
  const report=await f.report();assert.equal(report.cleanShutdown,true);assert.equal(report.ready,undefined);
});
test('program readback failure never starts a worker and safely closes the unshared socket',async t=>{
  const f=await fixture(t,{corruptReadback:true});await assert.rejects(f.create(),/readback differs/);
  assert.equal(f.events.includes('thread-create'),false);assert.equal(f.events.includes('thread-join'),false);assert.equal(f.events.includes('socket-close'),true);
  const report=await f.report();assert.equal(report.cleanShutdown,true);assert.equal(report.ready,undefined);
});
