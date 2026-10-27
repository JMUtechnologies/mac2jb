'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};}
async function until(check){for(let index=0;index<200;index++){if(check())return;await delay(2);}throw Error('Lifecycle fixture did not become ready');}
async function fixture(t,{stopGate,resetGate,samplesGate}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'stremio-lifecycle-')),state={resets:0,stops:0,requests:[],audioEvents:[],errors:[],failed:0,ended:0};
 let callbacks;
 const controller={busy:false,view:'playing',async init(){},getMenuModel(){return {};},tickOverlay(){},setPlaybackInfo(){},close(){},
  playbackFailed(){state.failed++;this.view='sources';},playbackEnded(){state.ended++;this.view='sources';}};
 const entries=new Map(),replace=(name,exports)=>{const file=require.resolve(name);entries.set(file,require.cache[file]);require.cache[file]={id:file,filename:file,loaded:true,exports};};
 replace('./controller.cjs',{createController(options){callbacks=options.callbacks;return controller;},renderMenu(){}});
 replace('./builtin.cjs',{async create(){return {manifestURL:'http://127.0.0.1:1/manifest.json',async close(){}};}});
 replace('./menu.cjs',{async closeArtworkCache(){}});
 replace('./progress.cjs',{createReporter(){return {begin(){},update(){},close(){}};}});
 const pipelineFile=require.resolve('./pipeline.cjs'),previous=require.cache[pipelineFile];delete require.cache[pipelineFile];
 let pipeline;
 try{
  pipeline=await require('./pipeline.cjs').create({directory,root:path.resolve(__dirname,'..'),pollIntervalMs:10000,
   graphics:{async publish(){return true;},async poll(){return {events:[],currentButtons:0,activeFrameSeq:0};}},
   audio:{async reset(){const index=++state.resets;state.audioEvents.push(`reset ${index} start`);if(index===2&&resetGate)await resetGate.promise;state.audioEvents.push(`reset ${index} end`);},
    async playedSamples(){if(samplesGate&&state.resets===2)await samplesGate.promise;return 0;},async write(){state.audioEvents.push('new audio');},async pause(){},async resume(){}},
   render:async(_model,options)=>Buffer.alloc(options.width*options.height*4),encode:()=>Buffer.alloc(8),onFatal:error=>state.errors.push(error),
   createDecoder:async(source,options)=>{
    const request={source,options};state.requests.push(request);
    return {info:{duration:100,hasAudio:false,codecs:[]},async stop(){state.stops++;if(request===state.requests[0]&&stopGate)await stopGate.promise;request.stopped=true;},pause(){},resume(){}};
   }});
 }finally{
  for(const [file,entry]of entries)if(entry)require.cache[file]=entry;else delete require.cache[file];
  if(previous)require.cache[pipelineFile]=previous;else delete require.cache[pipelineFile];
 }
 t.after(async()=>{stopGate?.resolve();resetGate?.resolve();samplesGate?.resolve();await pipeline?.close();await fs.rm(directory,{recursive:true,force:true});});
 const play=id=>callbacks.play({url:`https://example.invalid/${id}.mp4`,meta:{id,type:'movie',videoId:id}});
 await play('old');return {state,pipeline,controller,play};
}
for(const event of ['onError','onEnd'])test(`a replacement waits for retired ${event} stop ownership and keeps its controller state`,{timeout:5000},async t=>{
 const gate=deferred(),f=await fixture(t,{stopGate:gate});
 f.state.requests[0].options[event](Error('old source failed'));await until(()=>f.state.stops===1);
 const replacement=f.play('new');await turn();assert.equal(f.state.requests.length,1);assert.equal(f.state.resets,1);
 gate.resolve();await replacement;await turn();
 assert.equal(f.state.requests.length,2);assert.equal(f.state.requests[1].source.meta.id,'new');assert.equal(f.state.resets,2,'retired stop cannot reset replacement audio');
 assert.equal(f.state.failed,0);assert.equal(f.state.ended,0);assert.equal(f.controller.view,'playing');assert.deepEqual(f.state.errors,[]);
 await f.state.requests[1].options.onAudio(Buffer.alloc(19200));assert.equal(f.state.audioEvents.at(-1),'new audio');
});
for(const event of ['onError','onEnd'])test(`a pending ${event} audio reset completes before replacement and cannot change its UI`,{timeout:5000},async t=>{
 const gate=deferred(),f=await fixture(t,{resetGate:gate});
 f.state.requests[0].options[event](Error('old source failed'));await until(()=>f.state.resets===2);
 const replacement=f.play('new');await turn();assert.equal(f.state.requests.length,1);assert.equal(f.state.resets,2);
 gate.resolve();await replacement;await turn();assert.equal(f.state.requests.length,2);assert.equal(f.state.resets,3);
 assert.equal(f.state.failed,0);assert.equal(f.state.ended,0);assert.equal(f.controller.view,'playing');
 await f.state.requests[1].options.onAudio(Buffer.alloc(19200));await turn();
 assert.deepEqual(f.state.audioEvents,['reset 1 start','reset 1 end','reset 2 start','reset 2 end','reset 3 start','reset 3 end','new audio']);
 assert.deepEqual(f.state.errors,[]);
});
test('uncertain cleanup failure propagates to a waiting replacement without resetting or replaying it',{timeout:5000},async t=>{
 const gate=deferred(),f=await fixture(t,{resetGate:gate}),failure=Error('uncertain native reset');
 f.state.requests[0].options.onError(Error('old source failed'));await until(()=>f.state.resets===2);
 const replacement=f.play('new');const rejected=assert.rejects(replacement,error=>error===failure);gate.reject(failure);await rejected;await turn();
 assert.equal(f.state.resets,2);assert.equal(f.state.requests.length,1);assert.equal(f.state.failed,0);assert.ok(f.state.errors.includes(failure));
 await assert.rejects(f.play('again'),error=>error===failure);assert.equal(f.state.resets,2);assert.equal(f.state.requests.length,1);
});
test('a start superseded during its sample-counter read never opens a decoder later',{timeout:5000},async t=>{
 const gate=deferred(),f=await fixture(t,{samplesGate:gate});
 const older=f.play('older');await until(()=>f.state.resets===2);await turn();
 const latest=f.play('latest');await until(()=>f.state.resets===3);await latest;gate.resolve();await older;
 assert.deepEqual(f.state.requests.map(request=>request.source.meta.id),['old','latest']);assert.deepEqual(f.state.errors,[]);
});
