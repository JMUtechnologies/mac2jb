'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {consume}=require('./decoder-assembler.cjs');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function* parts(bytes,sizes){let offset=0;for(const size of sizes){yield bytes.subarray(offset,offset+size);offset+=size;}if(offset<bytes.length)yield bytes.subarray(offset);}
test('decoder assembly preserves arbitrary boundaries, multiple frames per chunk and frame ownership',async()=>{
 const source=Buffer.from(Array.from({length:80},(_,index)=>index)),frames=[];
 await consume(parts(source,[1,7,0,33,2,1]),16,(frame,index)=>frames.push({frame,index}));
 assert.equal(frames.length,5);
 frames.forEach(({frame,index})=>{assert.deepEqual(frame,source.subarray(index*16,(index+1)*16));assert.equal(frames[index].index,index);if(index)assert.notEqual(frame,frames[index-1].frame);});
});
test('consumer backpressure keeps the next frame and stream chunk from being delivered early',async()=>{
 const gate=deferred(),callbacks=[],reads=[];
 async function* input(){reads.push(1);yield Buffer.alloc(8,1);reads.push(2);yield Buffer.alloc(8,2);}
 const done=consume(input(),8,async(frame,index)=>{callbacks.push(index);if(index===0)await gate.promise;});
 await turn();assert.deepEqual(callbacks,[0]);assert.deepEqual(reads,[1]);
 gate.resolve();await done;assert.deepEqual(callbacks,[0,1]);assert.deepEqual(reads,[1,2]);
});
test('pause gate is honored before a full frame and stop cancels it without invoking the callback',async()=>{
 const gate=deferred();let stopped=false,callbacks=0;
 const done=consume(parts(Buffer.alloc(16),[16]),8,()=>callbacks++,{beforeFrame:()=>gate.promise,isStopped:()=>stopped});
 await turn();assert.equal(callbacks,0);stopped=true;gate.resolve();await done;assert.equal(callbacks,0);
});
test('stop between callbacks drops the rest of a chunk and closes its iterator',async()=>{
 let stopped=false,closed=false,count=0;
 async function* input(){try{yield Buffer.alloc(24);}finally{closed=true;}}
 await consume(input(),8,()=>{count++;stopped=true;},{isStopped:()=>stopped});
 assert.equal(count,1);assert.equal(closed,true);
});
test('partial PCM is zero padded exactly once; truncated video or unaligned PCM fails',async()=>{
 const frames=[];await consume(parts(Buffer.alloc(12,0xa5),[3,2]),8,(frame,index)=>frames.push({frame,index}),{allowPartial:true});
 assert.deepEqual(frames,[{frame:Buffer.alloc(8,0xa5),index:0},{frame:Buffer.from([0xa5,0xa5,0xa5,0xa5,0,0,0,0]),index:1}]);
 await assert.rejects(consume(parts(Buffer.alloc(12),[12]),8,()=>{}),/truncated/);
 await assert.rejects(consume(parts(Buffer.alloc(11),[11]),8,()=>{},{allowPartial:true}),/truncated/);
 let stopped=false,count=0;async function* cancelled(){yield Buffer.alloc(3);stopped=true;}
 await consume(cancelled(),8,()=>count++,{isStopped:()=>stopped});assert.equal(count,0);
});
test('stream and callback failures propagate once without replaying a delivered frame',async()=>{
 let callbacks=0;const failure=Error('consumer failed');
 await assert.rejects(consume(parts(Buffer.alloc(24),[24]),8,()=>{callbacks++;throw failure;}),error=>error===failure);assert.equal(callbacks,1);
 async function* broken(){yield Buffer.alloc(3);throw Error('pipe closed');}
 await assert.rejects(consume(broken(),8,()=>callbacks++),/pipe closed/);assert.equal(callbacks,1);
});
test('1080p frames assemble from 64KiB pipe pieces with one linear copy per piece',async()=>{
 const size=1920*1080*4,source=Buffer.alloc(size*2);for(let index=0;index<source.length;index++)source[index]=(index*17)&255;
 const frames=[];await consume(parts(source,Array(Math.floor(source.length/65536)).fill(65536)),size,frame=>frames.push(frame));
 assert.equal(frames.length,2);assert.deepEqual(Buffer.concat(frames),source);
});
