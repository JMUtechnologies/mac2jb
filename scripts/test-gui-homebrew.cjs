#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Readable}=require('node:stream');
const {main,validateRun,proxyHandler,runtimeEnvironment,stages,owners}=require('./gui-homebrew.cjs');
function fixture(t,options={}){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mac2jb-homebrew-test-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const directory=path.join(root,'vendor/ns2jb/runs/switch2-source'),vendor=path.join(root,'vendor/HBLauncher');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  fs.mkdirSync(path.join(vendor,'smilebasic/engine/shared'),{recursive:true});
  fs.writeFileSync(path.join(vendor,'smilebasic/engine/shared/rpc.cjs'),'// exact mocked upstream RPC module\n',{mode:0o600});
  const addresses={session:'switch2-source',target:'switch2',platform:2,scratch:4096,main:8192,sdk:12288,backing:16384,controller:20480};
  fs.writeFileSync(path.join(directory,'connection.json'),JSON.stringify({port:12345,addresses}),{mode:0o600});
  fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({verified:true,fs:{verified:true,restored:true,
    cleanup:{deferred:true},retainedEndpoint:{ready:true}},rpc:{mode:'held',state:'listening'}}),{mode:0o600});
  const trace=path.join(root,'order.txt'),all=[...stages.map(value=>({script:value[0],role:'prepare',args:value.slice(1)})),...owners];
  for(const item of all){
    const file=path.join(vendor,item.script);fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,[
      "const fs=require('fs'),path=require('path');const directory=process.argv[2];",
      'const options='+JSON.stringify(options)+',item='+JSON.stringify(item)+',trace='+JSON.stringify(trace)+';',
      "const log=value=>fs.appendFileSync(trace,JSON.stringify(value)+'\\n');",
      "const session=path.basename(directory);log({event:'start',script:item.script,args:process.argv.slice(3)});",
      "if(options.failStage===item.script)process.exit(1);",
      "if(item.role==='prepare'){",
      "if(options.stallStage===item.script){process.on('SIGTERM',()=>{log({event:'stop',role:'prepare'});process.exit(0);});console.log('STAGE_READY');setInterval(()=>{},1000);}",
      'else process.exit(0);',
      '}else{',
      "if(item.role==='graphics'){fs.writeFileSync(path.join(directory,'launcher-auto-loop.json'),JSON.stringify({session,threadRunning:true}));console.log('HBLauncher continuous native frame loop running.');}",
      "if(item.role==='audio')fs.writeFileSync(path.join(directory,'game-audio.json'),JSON.stringify({session}));",
      "process.on('SIGTERM',()=>{log({event:'stop',role:item.role});setTimeout(()=>{",
      "if(item.role==='graphics')fs.writeFileSync(path.join(directory,'launcher-auto-loop.json'),JSON.stringify({session,threadRunning:false,completed:'now'}));",
      "if(item.role==='audio')fs.writeFileSync(path.join(directory,'game-audio.json'),JSON.stringify({session,completed:'now',...(options.badAudioStop?{stopError:'audio did not stop'}:{})}));",
      "process.exit(0);},options.stopMs||10);});console.log(item.ready);setInterval(()=>{},1000);}",
    ].join('\n'),{mode:0o600});
  }
  const events=[],requests=[];
  const api={root,verifySession:async candidate=>({root:candidate,session:path.basename(candidate)}),
    checkRuntime:async()=>{},request:async(run,body)=>{requests.push({run,body});return {ready:true};},
    serveProxy:async()=>({port:23456,token:'ab'.repeat(32),close:async()=>{fs.appendFileSync(trace,JSON.stringify({event:'proxy-close'})+'\n');}}),
    startTimeoutMs:2000,stopTimeoutMs:500,
    emit:(type,value)=>{events.push({type,...value});if(type==='running')setImmediate(()=>process.emit('SIGTERM'));}};
  return {root,directory,vendor,trace,events,requests,api,addresses};
}
test('runtime tools are portable and Python user configuration is excluded',()=>{
  const env=runtimeEnvironment('/private/runtime',{PATH:'/usr/bin',PYTHONPATH:'/user/modules',PYTHONHOME:'/user/python'});
  assert.equal(env.PATH,'/private/runtime/homebrew/python/bin:/private/runtime/homebrew/bin:/usr/bin');
  assert.equal(env.SPIRV_VAL,'/private/runtime/homebrew/bin/spirv-val');
  assert.equal(env.PYTHONPATH,'/private/runtime/homebrew/python-custom');assert.equal(env.PYTHONHOME,undefined);
  assert.equal(env.PYTHONNOUSERSITE,'1');assert.equal(env.PYTHONDONTWRITEBYTECODE,'1');
  assert.equal(env.MAC2JB_HBLAUNCHER_FONT,'/private/runtime/homebrew/fonts/DejaVuSans.ttf');
});
test('unsupported launcher selection cannot contact RPC or consume the one-app gate',async t=>{
  const f=fixture(t);
  await assert.rejects(main([f.directory],{...f.api,application:'unavailable'}),/Unknown homebrew application/);
  assert.equal(f.requests.length,0);
  assert.equal(fs.existsSync(path.join(f.directory,'.mac2jb-hblauncher-attempt.json')),false);
  assert.throws(()=>runtimeEnvironment(f.root,{},'unavailable'),/Unknown homebrew application/);
});
async function exchange(handler,{token='secret',body={command:'status'},method='POST',url='/'}={}){
  const bytes=Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
  const req=Readable.from([bytes]);Object.assign(req,{method,url,headers:{authorization:'Bearer '+token}});
  const res={status:200,headers:{},destroyed:false,writeHead(status){this.status=status;return this;},
    setHeader(name,value){this.headers[name]=value;},end(value=''){this.body=value;return this;}};
  await handler(req,res);return res;
}
test('authenticated proxy only forwards supported, bounded requests once',async()=>{
  const requests=[];const handler=proxyHandler({token:'secret',request:async body=>{requests.push(body);return {result:7n};}});
  assert.equal((await exchange(handler,{token:'wrong'})).status,403);
  assert.equal((await exchange(handler,{method:'GET'})).status,403);
  assert.equal((await exchange(handler,{url:'/other'})).status,403);
  assert.equal(requests.length,0);
  const good=await exchange(handler,{body:{command:'call',offset:16,args:[1]}});
  assert.equal(good.status,200);assert.equal(JSON.parse(good.body).result,'7');assert.equal(requests.length,1);
  for(const body of [null,[],{command:'spawn'},Buffer.alloc(2*1024*1024+1,32),Buffer.from('{broken')])
    assert.equal((await exchange(handler,{body})).status,400);
  assert.equal(requests.length,1);
  const failed=proxyHandler({token:'secret',request:async()=>{requests.push('failed');throw Error('uncertain native request');}});
  assert.equal((await exchange(failed)).status,400);assert.equal(requests.filter(value=>value==='failed').length,1);
  const ended=proxyHandler({token:'secret',live:()=>false,request:async()=>{throw Error('must not forward');}});
  assert.match((await exchange(ended)).body,/no longer available/);
});
test('attach uses existing held connection, separate authenticated metadata and exact setup order',{timeout:10000},async t=>{
  const f=fixture(t),original=fs.readFileSync(path.join(f.directory,'connection.json'));
  const result=await main([f.directory],f.api);
  assert.equal(result.stopped,true);assert.deepEqual(fs.readFileSync(path.join(f.directory,'connection.json')),original);
  const connection=JSON.parse(fs.readFileSync(path.join(result.directory,'connection.json')));
  assert.equal(connection.port,23456);assert.equal(connection.token,'ab'.repeat(32));
  assert.deepEqual(connection.addresses,{...f.addresses,session:path.basename(result.directory)});
  assert.equal(fs.statSync(path.join(result.directory,'connection.json')).mode&0o077,0);
  assert.equal(fs.readFileSync(path.join(result.directory,'shared/rpc.cjs'),'utf8'),'// exact mocked upstream RPC module\n');
  assert.deepEqual(f.requests,[{run:f.directory,body:{command:'status'}}]);
  const trace=fs.readFileSync(f.trace,'utf8').trim().split('\n').map(JSON.parse),started=trace.filter(row=>row.event==='start');
  assert.deepEqual(started.slice(0,6).map(row=>[row.script,...row.args]),stages);
  assert.deepEqual(started.slice(6).map(row=>row.script),owners.map(row=>row.script));
  assert.equal(started.some(row=>/start-launcher|smilebasic\/host|pico/i.test(row.script)),false);
  assert.deepEqual(trace.filter(row=>row.event==='stop').map(row=>row.role),['ftp','audio','graphics']);
  assert.equal(trace.at(-1).event,'proxy-close');
  assert.ok(f.events.some(row=>row.type==='running'));assert.equal(f.events.at(-1).type,'stopped');
  await assert.rejects(main([f.directory],f.api),/EEXIST/);
});
test('a stage failure stops once and never retries or reaches live rendering',{timeout:10000},async t=>{
  const f=fixture(t,{failStage:'homebrew-launcher/inspect-input.cjs'});
  await assert.rejects(main([f.directory],f.api),/preparation failed/);
  const trace=fs.readFileSync(f.trace,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(trace.filter(row=>row.event==='start'&&row.script==='homebrew-launcher/inspect-input.cjs').length,1);
  assert.equal(trace.some(row=>row.role==='graphics'),false);assert.equal(f.events.at(-1).type,'failed');
});
test('cancelling an in-flight setup stage stops it without replaying RPC or setup',{timeout:10000},async t=>{
  const f=fixture(t,{stallStage:'homebrew-launcher/inspect-display.cjs'});
  f.api.emit=(type,value)=>{f.events.push({type,...value});if(value.message?.includes('STAGE_READY'))process.emit('SIGTERM');};
  await assert.rejects(main([f.directory],f.api),/stopped during/);
  const trace=fs.readFileSync(f.trace,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(trace.filter(row=>row.event==='start').length,1);assert.equal(f.requests.length,1);
  assert.equal(f.events.some(row=>row.type==='running'),false);assert.equal(f.events.at(-1).type,'failed');
});
test('unconfirmed audio shutdown cannot claim homebrew stopped cleanly',{timeout:10000},async t=>{
  const f=fixture(t,{badAudioStop:true});await assert.rejects(main([f.directory],f.api),/shutdown/);
  assert.equal(f.events.at(-1).type,'failed');assert.equal(f.events.some(row=>row.type==='stopped'),false);
});
test('foreign runs, wrong native identity and public connection files cannot attach',async t=>{
  const f=fixture(t);
  await assert.rejects(validateRun(f.root,f.root,f.api.verifySession),/current held run/);
  const connection=path.join(f.directory,'connection.json'),original=JSON.parse(fs.readFileSync(connection));
  fs.writeFileSync(connection,JSON.stringify({...original,addresses:{...original.addresses,session:'wrong'}}));
  await assert.rejects(validateRun(f.root,f.directory,f.api.verifySession),/another session/);
  fs.writeFileSync(connection,JSON.stringify(original));fs.chmodSync(connection,0o644);
  await assert.rejects(validateRun(f.root,f.directory,f.api.verifySession),/private owned/);
});
