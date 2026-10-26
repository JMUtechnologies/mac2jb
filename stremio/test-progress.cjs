'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReporter,MAX_SECONDS}=require('./progress.cjs');
function source(overrides={}){
  return {url:'https://media.example/private?token=SECRET',headers:{Authorization:'Bearer SECRET'},
    resumePosition:120,meta:{id:'tt123',type:'series',videoId:'tt123:2:3'},
    libraryInfo:{itemId:'tt123',videoId:'tt123:2:3',type:'series',name:'An actual series',
      poster:'https://poster.example/show.jpg?auth=SECRET',season:2,episode:3,
      videoIds:['tt123:2:1','tt123:2:2','tt123:2:3']},...overrides};
}
function fixture(){
  let time=0;const values=[];const reporter=createReporter({session:'private-helper-session',now:()=>time,emit:value=>values.push(value)});
  return {reporter,values,time:value=>{time=value;}};
}
test('resume starts at cloud seconds without counting skipped playback and preserves episode identity',()=>{
  const f=fixture(),first=f.reporter.begin(source(),{duration:1000});
  assert.equal(first.position,120);assert.equal(first.resumePosition,120);assert.equal(first.playedSeconds,0);
  assert.equal(first.itemId,'tt123');assert.equal(first.videoId,'tt123:2:3');assert.equal(first.type,'series');
  assert.equal(first.season,2);assert.equal(first.episode,3);assert.deepEqual(first.videoIds,['tt123:2:1','tt123:2:2','tt123:2:3']);
  assert.match(first.playbackId,/^[a-f0-9-]{36}$/);assert.equal(first.reason,'interval');assert.equal(first.sequence,1);
});
test('periodic output is limited to once per thirty seconds while evidence keeps accumulating',()=>{
  const f=fixture();f.reporter.begin(source(),{position:120,duration:1000});
  for(let n=1;n<30;n++){f.time(n*1000);assert.equal(f.reporter.update({position:120+n}),null);}
  f.time(30000);const event=f.reporter.update({position:150});
  assert.equal(f.values.length,2);assert.equal(event.playedSeconds,30);assert.equal(event.position,150);
  f.time(30001);assert.equal(f.reporter.update({position:150.001}),null);
});
test('pause/resume, seek, stop and finish force timely updates without duplicate events',()=>{
  const f=fixture();f.reporter.begin(source(),{position:120,duration:1000});
  f.time(5000);const pause=f.reporter.update({position:125,paused:true},{reason:'pause'});
  assert.equal(pause.playedSeconds,5);assert.equal(f.reporter.update({position:125,paused:true},{reason:'pause'}),null);
  f.time(20000);const resume=f.reporter.update({position:125,paused:false},{reason:'pause'});assert.equal(resume.playedSeconds,5);
  f.time(21000);const seek=f.reporter.update({position:400},{reason:'seek'});assert.equal(seek.playedSeconds,5);
  f.time(22000);assert.equal(f.reporter.update({position:390}),null);
  const back=f.reporter.update({position:200},{reason:'seek'});assert.equal(back.position,200);assert.equal(back.playedSeconds,5);
  f.time(24000);const stopped=f.reporter.update({position:202},{reason:'stop'});assert.equal(stopped.playedSeconds,7);
  assert.equal(f.reporter.close(),null);assert.equal(f.reporter.update({position:300}),null);
});
test('stalls, clock jumps and explicit seeks never invent watched time',()=>{
  const f=fixture();f.reporter.begin(source(),{position:120,duration:1000});
  f.time(30000);f.reporter.update({position:120});assert.equal(f.values.length,1);
  f.time(31000);const jump=f.reporter.update({position:500},{reason:'pause'});assert.equal(jump.playedSeconds,1);
  f.time(32000);const seek=f.reporter.update({position:900},{reason:'seek'});assert.equal(seek.playedSeconds,1);
});
test('source change sends a final stop before a new playback UUID and close sends finish once',()=>{
  const f=fixture();const first=f.reporter.begin(source(),{duration:1000});
  f.time(2000);f.reporter.update({position:122});
  const next=f.reporter.begin(source({libraryInfo:{itemId:'tt456',videoId:'tt456',type:'movie',name:'A movie'},resumePosition:0}),{duration:60});
  assert.notEqual(next.playbackId,first.playbackId);assert.equal(next.sequence,3);
  assert.equal(f.values[1].reason,'stop');assert.equal(f.values[1].position,122);
  f.time(4000);const final=f.reporter.close({position:2,duration:60,paused:true});
  assert.equal(final.reason,'finish');assert.equal(f.reporter.close(),null);assert.equal(f.reporter.begin(source()),null);
});
test('ended playback is bounded by duration and cannot emit progress afterward',()=>{
  const f=fixture();f.reporter.begin(source(),{position:900,duration:1000});
  f.time(1000);const ended=f.reporter.update({position:1001},{reason:'ended'});
  assert.equal(ended.position,1000);assert.equal(ended.ended,true);assert.equal(ended.playedSeconds,1);
  assert.equal(f.reporter.update({position:999},{reason:'seek'}),null);
});
test('transport credentials, media URLs and unrecognized metadata never enter the DTO',()=>{
  const f=fixture(),value=f.reporter.begin(source(),{duration:1000}),encoded=JSON.stringify(value);
  assert.equal(encoded.includes('SECRET'),false);assert.equal(encoded.includes('media.example'),false);
  assert.equal(encoded.includes('Authorization'),false);assert.equal(encoded.includes('private-helper-session'),false);
  assert.equal(value.poster,'https://poster.example/show.jpg');
  assert.equal(value.url,undefined);assert.equal(value.headers,undefined);assert.equal(value.libraryInfo,undefined);
});
test('invalid times, metadata IDs and unknown reasons cannot corrupt current progress',()=>{
  const f=fixture();f.reporter.begin(source(),{duration:1000});
  for(const position of [NaN,Infinity,-1,'200',1e12])assert.equal(f.reporter.update({position},{reason:'pause'}),null);
  assert.equal(f.reporter.update({position:121},{reason:'unknown'}),null);
  assert.equal(f.reporter.update({position:121,duration:NaN},{reason:'pause'}),null);
  assert.equal(f.reporter.begin(source({libraryInfo:{itemId:'https://secret/token',videoId:'x',type:'series',name:'Bad'}})),null);
  assert.equal(f.values.at(-1).reason,'stop');
  assert.equal(f.reporter.update({position:200}),null);
});
test('timestamps share the account and controller four hundred hour cap',()=>{
  assert.equal(MAX_SECONDS,400*60*60);
  const f=fixture();assert.equal(f.reporter.begin(source({resumePosition:MAX_SECONDS}),{duration:MAX_SECONDS}).position,MAX_SECONDS);
  assert.equal(f.reporter.update({duration:MAX_SECONDS+1},{reason:'pause'}),null);
  assert.equal(f.reporter.begin(source({resumePosition:MAX_SECONDS+1})),null);
});
test('oversized or incomplete episode maps are omitted rather than truncated or reordered',()=>{
  const f=fixture(),input=source();input.libraryInfo.videoIds=['tt123:2:1'];
  assert.equal(f.reporter.begin(input).videoIds,undefined);
  const many=source();many.libraryInfo.videoIds=Array.from({length:2001},(_,index)=>'episode:'+index);
  assert.equal(f.reporter.begin(many).videoIds,undefined);
});
test('callback failures do not break playback or replay an update',()=>{
  let calls=0;const f=createReporter({session:'test',now:()=>0,emit:()=>{calls++;throw Error('account unavailable');}});
  assert.equal(f.begin(source()).reason,'interval');assert.equal(f.update({position:120}),null);assert.equal(calls,1);
});
