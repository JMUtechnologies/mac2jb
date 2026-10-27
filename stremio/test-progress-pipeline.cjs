'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const realProgress=require('./progress.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let n=0;n<300;n++){if(check())return;await delay(5);}throw Error('Playback fixture did not become ready');}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function source(id='tt123'){
 return {url:'https://media.example/private?token=SECRET',headers:{Authorization:'Bearer SECRET'},resumePosition:120,
  meta:{id,type:'movie',videoId:id},libraryInfo:{itemId:id,videoId:id,type:'movie',name:'Fixture movie'}};
}
async function fixture(t,{pendingOpen}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'stremio-progress-pipeline-'));
 const state={wall:1000000,monotonic:0,samples:0,polls:0,events:[],updates:[],errors:[],requests:[],audioCalls:[],renders:[],encodes:[],publications:[]};
 state.advance=ms=>{state.wall+=ms;state.monotonic+=ms;};
 t.mock.method(Date,'now',()=>state.wall);
 let callbacks;
 const controller={async init(){},getMenuModel(){return {};},setPlaybackInfo(){},playbackFailed(){},playbackEnded(){},close(){},tickOverlay(){},async handleSeekAxis(){},
  async handleButton(button){if(button==='right')return callbacks.seek(10);if(button==='left')return callbacks.seek(-10);if(button==='a')return callbacks.pause();if(button==='b')return callbacks.stop();}};
 const entries=new Map(),replace=(name,exports)=>{const file=require.resolve(name);entries.set(file,require.cache[file]);require.cache[file]={id:file,filename:file,loaded:true,exports};};
 replace('./controller.cjs',{createController:options=>{callbacks=options.callbacks;state.changeMenu=options.onChange;return controller;},renderMenu:async()=>Buffer.alloc(640*360*4)});
 replace('./builtin.cjs',{async create(){return {manifestURL:'http://127.0.0.1:1/manifest.json',async close(){}};}});
 replace('./progress.cjs',{...realProgress,createReporter:options=>realProgress.createReporter({...options,now:()=>state.monotonic})});
 const pipelineFile=require.resolve('./pipeline.cjs'),previousPipeline=require.cache[pipelineFile];delete require.cache[pipelineFile];
 let pipeline;
 try{
  const {create}=require('./pipeline.cjs');
  pipeline=await create({directory,root:path.resolve(__dirname,'..'),quality:'180p',pollIntervalMs:5,
   graphics:{async publish(bytes,ptsMs,format){state.publications.push({bytes:bytes.length,ptsMs,format});return true;},async poll(){state.polls++;if(state.pollGate)await state.pollGate.promise;return {events:state.events.splice(0),activeFrameSeq:1,activePtsMs:0};}},
   audio:{async reset(){state.samples=0;state.audioCalls.push('reset');},async playedSamples(){state.audioCalls.push('samples');return state.samples;},
    async write(){state.audioCalls.push('write');},async pause(){state.audioCalls.push('pause');},async resume(){state.audioCalls.push('resume');},async drain(){}},
   onFatal:error=>state.errors.push(error),onAccountProgress:update=>state.updates.push(update),
   render:async(model,options)=>{state.renders.push(options);return Buffer.alloc(options.width*options.height*4);},
   encode:(rgba,width,height)=>{assert.equal(rgba.length,width*height*4);state.encodes.push({width,height});return Buffer.alloc(width*height/2);},
   createDecoder:async(input,options)=>{
    const request={input,options,stopped:false};state.requests.push(request);
    const opened={info:{duration:1000,hasAudio:true,codecs:['fixture']},async stop(){request.stopped=true;},pause(){},resume(){}};
    if(pendingOpen&&state.requests.length===2)await pendingOpen.promise;
    return opened;
   }});
 }finally{
  for(const [file,entry]of entries)if(entry)require.cache[file]=entry;else delete require.cache[file];
  if(previousPipeline)require.cache[pipelineFile]=previousPipeline;else delete require.cache[pipelineFile];
 }
 t.after(async()=>{pendingOpen?.resolve();state.pollGate?.resolve();await pipeline?.close();await fs.rm(directory,{recursive:true,force:true});});
 return {...state,state,pipeline,callbacks,controller};
}
async function playing(f){
 await f.callbacks.play(source());
 await f.state.requests[0].options.onAudio(Buffer.alloc(19200));
 f.state.samples=48000;f.state.advance(1000);
 await until(()=>f.pipeline.report.audioPosition===121);
}
test('dirty menus use 1280x720 while a selected 180p video keeps its smaller transport',{timeout:10000},async t=>{
 const f=await fixture(t);
 assert.deepEqual(f.state.encodes,[{width:1280,height:720}]);
 assert.deepEqual(f.state.publications,[{bytes:460800,ptsMs:0,format:{width:1280,height:720}}]);
 await until(()=>f.state.polls>=3);assert.equal(f.state.renders.length,1,'unchanged menus are not uploaded every poll');
 f.state.changeMenu();await until(()=>f.state.renders.length===2);
 await playing(f);
 await f.state.requests[0].options.onVideo(Buffer.alloc(320*180*4),{ptsMs:121000,index:15});
 assert.deepEqual(f.state.encodes.at(-1),{width:320,height:180});
 assert.deepEqual(f.state.publications.at(-1),{bytes:28800,ptsMs:121000,format:{width:320,height:180}});
 assert.equal(f.state.errors.length,0);
});
test('sixty seconds paused cannot advance account position or actual watched time on resume',{timeout:10000},async t=>{
 const f=await fixture(t);await playing(f);
 await f.callbacks.pause();
 const paused=f.state.updates.at(-1);assert.equal(paused.reason,'pause');assert.equal(paused.paused,true);
 assert.equal(paused.position,121);assert.equal(paused.playedSeconds,1);
 f.state.advance(60000);await f.callbacks.pause();
 const resumed=f.state.updates.at(-1);assert.equal(resumed.reason,'pause');assert.equal(resumed.paused,false);
 assert.equal(resumed.position,paused.position);assert.equal(resumed.playedSeconds,paused.playedSeconds);
 const lastResume=f.state.audioCalls.lastIndexOf('resume');assert.equal(f.state.audioCalls[lastResume+1],'samples');
 f.state.samples+=48000;f.state.advance(1000);await until(()=>f.pipeline.report.audioPosition===122);
 await f.callbacks.pause();assert.equal(f.state.updates.at(-1).position,122);assert.equal(f.state.updates.at(-1).playedSeconds,2);
 assert.equal(f.state.errors.length,0);
});
test('Finish during a three minute native poll stall caps unconfirmed playback at half a second',{timeout:10000},async t=>{
 const f=await fixture(t);await playing(f);
 await f.callbacks.pause();await f.callbacks.pause();
 const confirmed=f.state.updates.at(-1);assert.equal(confirmed.position,121);assert.equal(confirmed.playedSeconds,1);
 const gate=deferred(),before=f.state.polls;f.state.pollGate=gate;
 await until(()=>f.state.polls>before);
 f.state.advance(180000);let finished=false;const closing=f.pipeline.close().then(()=>{finished=true;});
 await delay(10);
 const final=f.state.updates.at(-1);assert.equal(final.reason,'finish');
 assert.equal(final.position,121.5);assert.ok(final.position-confirmed.position<=.5);
 assert.ok(final.playedSeconds-confirmed.playedSeconds<=.5,'native buffering cannot become watched time');
 assert.equal(finished,false,'Finish awaits the outstanding native owner');
 const count=f.state.updates.length;gate.resolve();await closing;
 assert.equal(f.state.updates.length,count);assert.equal(f.state.errors.length,0);
});
test('Finish during a pending seek preserves explicit seek identity and excludes startup wait',{timeout:10000},async t=>{
 const gate=deferred(),f=await fixture(t,{pendingOpen:gate});await playing(f);
 const first=f.state.updates[0];f.state.events.push({buttons:1<<14});
 await until(()=>f.state.requests.length===2);
 const seek=f.state.updates.at(-1);assert.equal(seek.reason,'seek');assert.equal(seek.paused,true);
 assert.equal(seek.playbackId,first.playbackId);assert.equal(seek.position,131);assert.equal(seek.duration,1000);
 const watched=seek.playedSeconds;
 f.state.advance(60000);let finished=false;const closing=f.pipeline.close().then(()=>{finished=true;});
 await delay(15);assert.equal(finished,false,'Finish waits for the pending decoder owner');
 const final=f.state.updates.at(-1);assert.equal(final.reason,'finish');assert.equal(final.position,seek.position);
 assert.equal(final.duration,1000);assert.equal(final.paused,true);assert.equal(final.playedSeconds,watched);
 assert.equal(final.playbackId,first.playbackId);assert.equal(f.state.requests[1].options.signal.aborted,true);
 gate.resolve();await closing;assert.equal(f.state.requests[1].stopped,true);
 const count=f.state.updates.length;
 await f.state.requests[1].options.onAudio(Buffer.alloc(19200));
 await f.state.requests[1].options.onVideo(Buffer.alloc(320*180*4),{ptsMs:130000,index:0});
 f.state.requests[1].options.onEnd();await delay(10);
 assert.equal(f.state.updates.length,count,'late decoder callbacks cannot publish account progress');
 assert.equal(f.state.errors.length,0);
});
test('new-source preparation finalizes the previous item and built-in IDs never reach account output',{timeout:10000},async t=>{
 const gate=deferred(),f=await fixture(t,{pendingOpen:gate});await playing(f);
 const starting=f.callbacks.play(source('tt456'));await until(()=>f.state.requests.length===2);
 const stop=f.state.updates.at(-1);assert.equal(stop.reason,'stop');assert.equal(stop.itemId,'tt123');
 f.state.advance(60000);const closing=f.pipeline.close();gate.resolve();await starting;await closing;
 assert.equal(f.state.updates.at(-1),stop,'new item cannot borrow old item metadata while opening');
 const another=await fixture(t);await another.callbacks.play(source('mac2jb:demo'));
 await another.callbacks.stop();await another.pipeline.close();assert.deepEqual(another.state.updates,[]);
 assert.equal(JSON.stringify(f.state.updates).includes('SECRET'),false);
 assert.equal(JSON.stringify(f.state.updates).includes('media.example'),false);
});
