'use strict';
// Playback evidence only: account/library merging belongs to the Mac account owner.
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const REASONS=new Set(['interval','pause','seek','stop','ended','finish']);
const TERMINAL=new Set(['stop','ended','finish']);
const MAX_SECONDS=400*60*60,MAX_IDS=2000,IDS_BYTES=48*1024;
function text(value,max){
  if(typeof value!=='string')return undefined;
  const result=value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/https?:\/\/\S+/gi,'[link]')
    .replace(/\bBearer\s+\S+/gi,'[redacted]').trim().slice(0,max);
  return result||undefined;
}
function identifier(value){
  if(typeof value!=='string'||value.length<1||value.length>256||/[\u0000-\u0020\u007f?#]/.test(value)||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value))return undefined;
  return value;
}
function metadata(source){
  if(!source||typeof source!=='object'||Array.isArray(source))return null;
  const info=source.libraryInfo&&typeof source.libraryInfo==='object'&&!Array.isArray(source.libraryInfo)?source.libraryInfo:{};
  const meta=source.meta&&typeof source.meta==='object'&&!Array.isArray(source.meta)?source.meta:{};
  const itemId=identifier(info.itemId??meta.id),videoId=identifier(info.videoId??meta.videoId??source.video?.id);
  const type=typeof(info.type??meta.type)==='string'?(info.type??meta.type):undefined;
  const name=text(info.name??meta.name??source.title,256);
  if(!itemId||!videoId||!type||!/^[a-z][a-z0-9_-]{0,31}$/.test(type)||!name)return null;
  const output={itemId,videoId,type,name};
  if(typeof info.poster==='string'&&info.poster.length<=4096){
    try{const url=new URL(info.poster);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password){
      url.search='';url.hash='';output.poster=url.href;
    }}catch{}
  }
  for(const key of ['season','episode']){
    const value=info[key]??source.video?.[key];
    if(Number.isInteger(value)&&value>=0&&value<=1000000)output[key]=value;
  }
  if(Array.isArray(info.videoIds)&&info.videoIds.length>0&&info.videoIds.length<=MAX_IDS){
    const ids=info.videoIds.map(identifier);
    if(ids.every(Boolean)&&new Set(ids).size===ids.length&&ids.includes(videoId)&&
      Buffer.byteLength(JSON.stringify(ids))<=IDS_BYTES)output.videoIds=ids;
  }
  return output;
}
function seconds(value,unknown=false){
  if(unknown&&(value===undefined||value===null||value===0))return 0;
  return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=MAX_SECONDS?value:null;
}
function createReporter({session=crypto.randomUUID(),emit=()=>{},now=()=>performance.now(),intervalMs=30000}={}){
  if(typeof session!=='string'||!session||session.length>4096||typeof emit!=='function'||typeof now!=='function'||
    !Number.isFinite(intervalMs)||intervalMs<30000||intervalMs>24*60*60*1000)throw Error('Invalid playback reporter configuration');
  let active,sequence=0,closed=false,lastClock=0;
  function clock(){
    let value;try{value=now();}catch{return lastClock;}
    if(!Number.isFinite(value))return lastClock;
    lastClock=Math.max(lastClock,value);return lastClock;
  }
  function send(reason,force=false){
    if(!active||active.terminal||closed)return null;
    const instant=clock(),snapshot={...active.meta,playbackId:active.id,reason,
      position:active.position,duration:active.duration,paused:active.paused,ended:reason==='ended',
      resumePosition:active.resumePosition,playedSeconds:active.playedSeconds};
    const fingerprint=JSON.stringify(snapshot);
    if(fingerprint===active.lastFingerprint||!force&&instant-active.lastEmission<intervalMs)return null;
    const dto={...snapshot,sequence:++sequence};
    active.lastFingerprint=fingerprint;active.lastEmission=instant;
    if(TERMINAL.has(reason))active.terminal=true;
    try{const result=emit(dto);if(result?.catch)result.catch(()=>{});}catch{}
    return dto;
  }
  return {
    begin(source,state={}){
      if(closed)return null;
      if(active&&!active.terminal)send('stop',true);
      active=undefined;
      const info=metadata(source),resume=seconds(source?.resumePosition??0);
      let position=seconds(state.position??resume??0),duration=seconds(state.duration,true);
      if(!info||resume===null||position===null||duration===null)return null;
      if(duration>0)position=Math.min(position,duration);
      active={id:crypto.randomUUID(),meta:info,position,duration,resumePosition:resume,paused:false,
        playedSeconds:0,lastObservation:clock(),lastEmission:-Infinity,lastFingerprint:null,terminal:false};
      return send('interval',true);
    },
    update(state={},options={}){
      if(closed||!active||active.terminal||!state||typeof state!=='object'||Array.isArray(state))return null;
      let reason=options.reason;
      if(reason===undefined)reason=typeof state.paused==='boolean'&&state.paused!==active.paused?'pause':'interval';
      if(!REASONS.has(reason))return null;
      let position=seconds(state.position??active.position),duration=seconds(state.duration??active.duration,true);
      if(position===null||duration===null||state.paused!==undefined&&typeof state.paused!=='boolean')return null;
      if(duration>0)position=Math.min(position,duration);
      // Backward movement must come from an explicit seek, never a stale poll.
      if(position<active.position&&reason!=='seek')return null;
      const instant=clock(),paused=state.paused??active.paused;
      if(reason!=='seek'&&!active.paused){
        const elapsed=Math.max(0,(instant-active.lastObservation)/1000),delta=Math.max(0,position-active.position);
        active.playedSeconds+=Math.min(delta,elapsed);
      }
      active.position=position;active.duration=duration;active.paused=paused;active.lastObservation=instant;
      return send(reason,reason!=='interval');
    },
    close(state){
      if(closed)return null;
      let result=null;
      if(active&&!active.terminal){
        if(state)result=this.update(state,{reason:'finish'});
        if(!result)result=send('finish',true);
      }
      closed=true;return result;
    }
  };
}
module.exports={createReporter,metadata,REASONS,MAX_SECONDS,MAX_IDS,IDS_BYTES};
