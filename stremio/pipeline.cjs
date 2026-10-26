'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {createController,renderMenu}=require('./controller.cjs');
const decoderTools=require('./decoder.cjs'),codec=require('./bc1.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const BUTTONS=[[0,'a'],[1,'b'],[2,'x'],[3,'y'],[12,'left'],[13,'up'],[14,'right'],[15,'down']];
function gain(pcm,volume){if(volume===1)return pcm;const output=Buffer.alloc(pcm.length);for(let i=0;i<pcm.length;i+=2)output.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(pcm.readInt16LE(i)*volume))),i);return output;}
async function create({graphics,audio,addonUrls=[],libraryItems=[],directory,root,onAccountProgress=()=>{},onFatal=()=>{},onProgress=()=>{},
 createDecoder=decoderTools.create,render=renderMenu,encode=codec.encode,pollIntervalMs=200}){
 let controller,decoder,currentSource,sourceInfo,playing=false,paused=false,volume=1,position=0,wallStart=0,pausedAt=0,audioStarted=false;
 let generation=0,closed=false,dirty=true,tickBusy=false,timer,clockAt=0,clockValue=0,sourceBaseSamples=0,sourceOffset=0,clockOffset=0,lastAudioCount=0,startupAbort,currentTick=Promise.resolve(),lastInfo="",lastSave=0,firstFrame=false,firstMediaSequence=Infinity,progressWaiting=false,pendingProgressSnapshot,controls=Promise.resolve();
 const report={started:new Date().toISOString(),targetWidth:320,targetHeight:180,targetFPS:15,frames:0,droppedFrames:0,sourceChanges:0,position:0,volume:1,resourcesRetained:true};
 const builtin=await require('./builtin.cjs').create({root});
 const effectiveAddons=[builtin.manifestURL,...addonUrls];
 const reporter=require('./progress.cjs').createReporter({session:path.basename(directory),emit:update=>{if(!update.itemId.startsWith('mac2jb:'))onAccountProgress(update);}});
 const reportFile=path.join(directory,'stremio-playback.json');
 const background=new Set();
 function defer(task){const pending=new Promise(resolve=>setImmediate(resolve)).then(task);background.add(pending);pending.catch(onFatal).finally(()=>background.delete(pending));}
 const save=()=>fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 function progressState(){
  if(progressWaiting&&pendingProgressSnapshot)return {...pendingProgressSnapshot};
  let actual=position;
  if(playing&&!paused){
   // Never turn a stalled native request into minutes of imaginary watched time.
   if(sourceInfo?.hasAudio&&clockAt)actual=clockValue+Math.min(.5,Math.max(0,(Date.now()-clockAt)/1000));
   else actual=report.displayAcknowledgedPosition??sourceOffset;
  }
  return {position:Math.max(0,Math.min(sourceInfo?.duration||Infinity,actual)),duration:sourceInfo?.duration||0,paused};
 }
 const native=async task=>{try{return await task();}catch(error){onFatal(error);throw error;}};
 async function stopPlayback(reset=true){
  generation++;startupAbort?.abort();playing=false;paused=false;
  const old=decoder;decoder=undefined;if(old)await old.stop();
  if(reset)await native(()=>audio.reset());dirty=true;
 }
 async function start(source,startPosition=source?.resumePosition||0,seeking=false){
  if(closed)return;
  const previousProgress=progressState();
  if(seeking){pendingProgressSnapshot={position:startPosition,duration:sourceInfo?.duration||previousProgress.duration,paused:true};reporter.update(pendingProgressSnapshot,{reason:'seek'});}
  else{reporter.update(previousProgress,{reason:'stop'});pendingProgressSnapshot=undefined;}
  progressWaiting=true;
  await stopPlayback();if(closed)return;sourceOffset=startPosition;clockOffset=startPosition;lastAudioCount=0;currentSource=source;position=startPosition;sourceInfo=null;audioStarted=false;wallStart=0;clockAt=0;firstFrame=false;firstMediaSequence=Infinity;delete report.displayAcknowledgedPosition;report.sourceChanges++;
  sourceBaseSamples=await native(()=>audio.playedSamples());const attempt=++generation;
  startupAbort=new AbortController();
  const callbacks={position:startPosition,signal:startupAbort.signal,
   onVideo:async(rgba,frame)=>{
    if(closed||attempt!==generation)return;
    while(sourceInfo?.hasAudio&&!audioStarted&&!closed&&attempt===generation)await delay(5);
    if(closed||attempt!==generation||paused)return;
    wallStart ||= Date.now();const expected=wallStart+frame.index*1000/decoderTools.FPS;
    if(expected>Date.now())await delay(expected-Date.now());
    if(closed||attempt!==generation||paused)return;
    position=frame.ptsMs/1000;const lag=Date.now()-expected;
    if(lag>1000/decoderTools.FPS*2){report.droppedFrames++;return;}
    const before=performance.now(),encoded=encode(rgba,decoderTools.WIDTH,decoderTools.HEIGHT);
    const accepted=await native(()=>graphics.publish(encoded,Math.round(frame.ptsMs)));
    report.lastUploadMs=performance.now()-before;
    if(accepted){report.frames++;if(!firstFrame)firstMediaSequence=graphics.publishedFrameSeq??0;firstFrame=true;}else report.droppedFrames++;
   },
   onAudio:async pcm=>{
    if(closed||attempt!==generation)return;
    await native(()=>audio.write(gain(pcm,volume)));
    if(!audioStarted){audioStarted=true;wallStart ||= Date.now();}
   },
   onError:error=>defer(async()=>{
    if(!closed&&attempt===generation){reporter.update(progressState(),{reason:'stop'});await stopPlayback();if(!closed)controller.playbackFailed('This source could not be decoded or is no longer available.');}
   }),
   onEnd:()=>defer(async()=>{
    while(paused&&!closed&&attempt===generation)await delay(20);
    if(closed||attempt!==generation)return;
    if(sourceInfo?.hasAudio&&audio.drain)await native(()=>audio.drain());
    if(!closed&&attempt===generation){reporter.update({...progressState(),position:sourceInfo?.duration||position,paused:false},{reason:'ended'});await stopPlayback();if(!closed)controller.playbackEnded();}
   })
  };
  let opened;
  try{opened=await createDecoder(source,callbacks);}catch(error){
   if(!closed&&attempt===generation){reporter.update(progressState(),{reason:'stop'});progressWaiting=false;pendingProgressSnapshot=undefined;controller.playbackFailed('This source could not start. Choose a supported source.');}
   throw error;
  }
  if(closed||attempt!==generation){await opened.stop();return;}
  decoder=opened;sourceInfo=opened.info;playing=true;paused=false;progressWaiting=false;pendingProgressSnapshot=undefined;
  if(seeking)reporter.update({position:startPosition,duration:sourceInfo.duration||0,paused:false},{reason:'pause'});
  else reporter.begin(source,{position:startPosition,duration:sourceInfo.duration||0});
  report.duration=sourceInfo.duration;report.hasAudio=sourceInfo.hasAudio;report.codecs=sourceInfo.codecs;dirty=true;
 }
 async function pause(){
  if(!decoder||!playing)return;
  if(!paused){position=progressState().position;paused=true;pausedAt=Date.now();decoder.pause();await native(()=>audio.pause());}
  else{
   await native(()=>audio.resume());
   const samples=await native(()=>audio.playedSamples());
   sourceBaseSamples=samples;lastAudioCount=samples;clockOffset=position;clockValue=position;clockAt=Date.now();
   wallStart=clockAt-(position-sourceOffset)*1000;paused=false;decoder.resume();
  }
  reporter.update(progressState(),{reason:'pause'});dirty=true;
 }
 async function seek(seconds){if(!currentSource||!playing)return;const target=Math.max(0,Math.min(sourceInfo?.duration?Math.max(0,sourceInfo.duration-.1):Infinity,position+seconds));await start(currentSource,target,true);}
 async function adjustVolume(delta){volume=Math.max(0,Math.min(1,volume+delta));report.volume=volume;dirty=true;}
 controller=createController({addonUrls:effectiveAddons,libraryItems,callbacks:{play:source=>start(source),pause,seek,stop:async()=>{const state=progressState();reporter.update(state,{reason:'stop'});controller.setPlaybackInfo(state);await stopPlayback();},volume:adjustVolume},
  onChange:()=>{dirty=true;},onLog:message=>onProgress(message)});
 async function drawMenu(){
  const rgba=await render(controller.getMenuModel(),{python:path.join(root,'homebrew/python/bin/python3'),fontPath:path.join(root,'homebrew/fonts/DejaVuSans.ttf')});
  if(closed||(playing&&!paused))return;
  dirty=!(await native(()=>graphics.publish(encode(rgba,320,180),Math.round(position*1000))));
 }
 async function tick(){
  if(closed||tickBusy)return;tickBusy=true;
  try{
   const state=await native(()=>graphics.poll());
   for(const event of state.events||[])for(const [bit,name]of BUTTONS)if(event.buttons&(1<<bit)){
    controls=controls.then(()=>{if(!closed)return controller.handleButton(name);}).catch(error=>onProgress('The selected action could not finish.'));
   }
   if(playing&&firstFrame&&state.activeFrameSeq>=firstMediaSequence)report.displayAcknowledgedPosition=state.activePtsMs/1000;
   if(playing&&sourceInfo?.hasAudio&&audioStarted&&!paused&&Date.now()-clockAt>=500){
    const count=await native(()=>audio.playedSamples());
    if(count<sourceBaseSamples||count<lastAudioCount){sourceBaseSamples=count;clockOffset=position;}lastAudioCount=count;
    clockValue=clockOffset+(count-sourceBaseSamples)/48000;clockAt=Date.now();
    report.audioPosition=clockValue;
    if(firstFrame&&state.activeFrameSeq>=firstMediaSequence){report.displayAcknowledgedPosition=state.activePtsMs/1000;report.avDriftMs=Math.round((report.displayAcknowledgedPosition-clockValue)*1000);}
    wallStart=clockAt-(clockValue-sourceOffset)*1000;
   }
   if(playing){reporter.update(progressState());const info={position:Math.floor(position),duration:sourceInfo?.duration||0,paused,volume};const value=JSON.stringify(info);if(value!==lastInfo){lastInfo=value;controller.setPlaybackInfo(info);}}
   if(dirty&&(!playing||paused))await drawMenu();
   if(Date.now()-lastSave>2000){report.position=position;report.paused=paused;report.playing=playing;report.firstMediaFrameUploaded=firstFrame;await save();lastSave=Date.now();}
  }catch(error){if(!closed)onFatal(error);}finally{tickBusy=false;}
 }
 try{await drawMenu();await save();}catch(error){closed=true;controller.close?.();await builtin?.close();throw error;}
 timer=setInterval(()=>{if(!tickBusy&&!closed){currentTick=tick();currentTick.catch(onFatal);}},pollIntervalMs);timer.unref();
 // Catalog networking continues with the renderer and input owner already live.
 controller.init().catch(error=>onProgress('The add-on catalog could not load.'));
 return {controller,report,async close(){
  if(closed)return;reporter.close(progressState());closed=true;clearInterval(timer);generation++;startupAbort?.abort();controller.close?.();
  await controls.catch(()=>{});
  if(decoder)await decoder.stop();decoder=undefined;
  await currentTick;
  while(background.size)await Promise.allSettled([...background]);
  await builtin?.close();
  report.completed=new Date().toISOString();report.stopped=true;await save();
 }};
}
module.exports={create,gain,BUTTONS};
