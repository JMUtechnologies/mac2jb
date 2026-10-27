'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
const {qualityProfile}=require('./quality.cjs');
const {width:WIDTH,height:HEIGHT,fps:FPS}=qualityProfile();
const SAMPLE_RATE=48000;
async function tools(config={}){
 const ffmpeg=config.ffmpeg||process.env.MAC2JB_FFMPEG||'/Applications/Stremio.app/Contents/MacOS/ffmpeg';
 const ffprobe=config.ffprobe||process.env.MAC2JB_FFPROBE||path.join(path.dirname(ffmpeg),'ffprobe');
 for(const file of [ffmpeg,ffprobe])await fs.access(file,1).catch(()=>{throw Error('Install Stremio on this Mac before starting the experimental player. Its video tools were not found.');});
 return {ffmpeg,ffprobe};
}
function mediaURL(value){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('This experimental player supports HTTP(S) media URLs without URL passwords.');return url.href;}
function headerArgs(headers={}){
 if(!headers||typeof headers!=='object'||Array.isArray(headers))throw Error('Invalid media headers');
 const fields=[];
 for(const [name,value] of Object.entries(headers)){
  if(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)||typeof value!=='string'||/[\r\n\0]/.test(value)||value.length>8192)throw Error('Invalid media header');
  fields.push(name+': '+value+'\r\n');
 }
 return fields.length?['-headers',fields.join('')]:[];
}
function audioTracks(streams=[]){
 const clean=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,120):'';
 const seen=new Set();
 return streams.filter(stream=>stream.codec_type==='audio'&&Number.isSafeInteger(stream.index)&&stream.index>=0&&stream.index<=65535).slice(0,128).flatMap(stream=>{
  if(seen.has(stream.index))return [];seen.add(stream.index);
  const language=clean(stream.tags?.language)||'und',title=clean(stream.tags?.title);
  let name=language==='und'?'Unknown language':language;
  try{if(language!=='und')name=new Intl.DisplayNames(['en'],{type:'language'}).of(language)||language;}catch{}
  const label=title&&title.toLowerCase()!==name.toLowerCase()?`${name} — ${title}`:name;
  return [{id:stream.index,index:stream.index,language,title,label,default:stream.disposition?.default===1||stream.disposition?.default===true}];
 });
}
function selectAudioTrack(info,audioTrackId){
 if(audioTrackId!==undefined&&(!Number.isSafeInteger(audioTrackId)||audioTrackId<0||audioTrackId>65535))throw Error('Invalid audio track selection.');
 const selected=audioTrackId===undefined?info.audioTracks.find(track=>track.default)||info.audioTracks[0]:info.audioTracks.find(track=>track.id===audioTrackId);
 if(audioTrackId!==undefined&&!selected)throw Error('The selected audio track is unavailable in this source.');
 return selected?.id??null;
}
async function probe(source,config={},signal){
 const {ffprobe}=await tools(config),url=mediaURL(source.url);
 const {stdout}=await run(ffprobe,['-v','error','-rw_timeout','15000000','-protocol_whitelist','http,https,tcp,tls,crypto',...headerArgs(source.headers),'-show_entries','format=duration:stream=index,codec_type,codec_name,width,height:stream_tags=language,title:stream_disposition=default','-of','json',url],{timeout:20000,maxBuffer:1024*1024,signal});
 const data=JSON.parse(stdout);if(!data.streams?.some(s=>s.codec_type==='video'))throw Error('The selected source has no supported video stream.');
 const video=data.streams.find(s=>s.codec_type==='video');
 const tracks=audioTracks(data.streams),info={duration:Number(data.format?.duration)||null,hasAudio:tracks.length>0,audioTracks:tracks,codecs:data.streams.map(s=>s.codec_name),sourceWidth:video.width||null,sourceHeight:video.height||null};
 info.audioTrackId=selectAudioTrack(info);return info;
}
// ffmpeg stdout and fd3 preserve matched video/audio timelines from a single decoder.
async function create(source,{position=0,config={},quality,audioTrackId,onVideo,onAudio,onError,onEnd,signal}={}){
 const profile=qualityProfile(quality),width=profile.width,height=profile.height;
 if(audioTrackId!==undefined&&(!Number.isSafeInteger(audioTrackId)||audioTrackId<0||audioTrackId>65535))throw Error('Invalid audio track selection.');
 if(signal?.aborted)throw Error('Media start cancelled.');
 const {ffmpeg}=await tools(config),info={...await probe(source,config,signal),...profile};
 info.audioTrackId=selectAudioTrack(info,audioTrackId);
 if(signal?.aborted)throw Error('Media start cancelled.');
 if(!Number.isFinite(position)||position<0)throw Error('Invalid playback position');
 const input=['-hide_banner','-loglevel','error','-nostdin','-rw_timeout','15000000','-protocol_whitelist','http,https,tcp,tls,crypto',...headerArgs(source.headers)];
 if(position)input.push('-ss',String(position));
 input.push('-i',mediaURL(source.url));
 const args=[...input,'-map','0:v:0','-an','-vf',`fps=${FPS},scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,'-pix_fmt','rgba','-f','rawvideo','pipe:1'];
 if(info.hasAudio)args.push('-map',`0:${info.audioTrackId}`,'-vn','-ac','2','-ar',String(SAMPLE_RATE),'-f','s16le','pipe:3');
 const child=spawn(ffmpeg,args,{stdio:['ignore','pipe','pipe','pipe']});let stopped=false,paused=false,errorText='',failure,resumeResolve,pauseGate;
 child.stderr.on('data',bytes=>{errorText=(errorText+bytes.toString()).slice(-2048);});
 const assemble=require('./decoder-assembler.cjs').consume;
 const consume=(stream,size,callback,allowPartial=false)=>assemble(stream,size,callback,{allowPartial,beforeFrame:()=>paused?pauseGate:undefined,isStopped:()=>stopped});
 const video=consume(child.stdout,width*height*4,(frame,index)=>onVideo?.(frame,{ptsMs:position*1000+index*1000/FPS,index,width,height}));
 // 100ms blocks bound audio latency and stay inside one 32KiB useful write.
 const audio=info.hasAudio?consume(child.stdio[3],SAMPLE_RATE*4/10,(pcm,index)=>onAudio?.(pcm,{ptsMs:position*1000+index*100,index}),true):Promise.resolve();
 const stop=()=>{if(stopped)return;stopped=true;resumeResolve?.();if(paused){child.kill('SIGCONT');paused=false;}child.kill('SIGTERM');};
 signal?.addEventListener('abort',stop,{once:true});
 const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,sig)=>{if(!stopped&&(code!==0||sig))reject(Error('Video decoding failed. The source may be unavailable or unsupported.'));else resolve();});});
 const done=Promise.all([video,audio,exit]).catch(error=>{failure=error;stop();onError?.(error);throw error;}).finally(()=>{signal?.removeEventListener('abort',stop);if(!stopped&&!failure)onEnd?.();});done.catch(()=>{});
 return {info,done,async stop(){stop();if(paused){child.kill('SIGCONT');paused=false;}await done.catch(()=>{});},pause(){if(!paused&&!stopped){paused=true;pauseGate=new Promise(resolve=>{resumeResolve=resolve;});child.kill('SIGSTOP');}},resume(){if(paused&&!stopped){child.kill('SIGCONT');paused=false;resumeResolve?.();}},get paused(){return paused;}};
}
module.exports={tools,mediaURL,headerArgs,audioTracks,selectAudioTrack,probe,create,WIDTH,HEIGHT,FPS,SAMPLE_RATE};
