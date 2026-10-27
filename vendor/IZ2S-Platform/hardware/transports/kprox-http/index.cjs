// KProx's documented API, not an invented Cardputer serial protocol.
// https://github.com/akoerner/kprox/blob/master/API_REFERENCE.md
// https://github.com/akoerner/kprox/blob/master/TOKEN_REFERENCE.md
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const SPECIAL={enter:40,escape:41,backspace:42,tab:43,capslock:57,f4:61,f7:64,f8:65,home:74,delete:76,end:77,right:79,left:80,down:81,up:82};
const KEYS=Object.fromEntries([...'abcdefghijklmnopqrstuvwxyz'].map((c,i)=>[c,[0,i+4]]));
[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].forEach((c,i)=>KEYS[c]=[2,i+4]);[...'1234567890'].forEach((c,i)=>KEYS[c]=[0,i+30]);[...'!@#$%^&*()'].forEach((c,i)=>KEYS[c]=[2,i+30]);
for(const [a,b,code]of [['-','_',45],['=','+',46],['[','{',47],[']','}',48],['\\','|',49],[';',':',51],["'",'"',52],['`','~',53],[',','<',54],['.','>',55],['/','?',56],[' ',' ',44]]){KEYS[a]=[0,code];if(a!==b)KEYS[b]=[2,code];}
function create({root,configuration,preparePlan=value=>require('../common.cjs').plan(root,value),fetchImpl=fetch}){
 const settings=configuration.settings,jobs=new Map(),cancelledIds=new Set();let queue=Promise.resolve();
 function configured(){const reasons=[];if(!settings.cardputerEndpoint)reasons.push('Set the KProx HTTP endpoint');if(settings.cardputerFirmware!=='kprox')reasons.push('Install KProx firmware with USB keyboard enabled');if(!process.env[settings.cardputerApiKeyEnv])reasons.push('Set '+settings.cardputerApiKeyEnv);if(!['on','off'].includes(settings.cardputerCapsLock))reasons.push('Confirm Switch Caps Lock state');if(reasons.length)throw Object.assign(Error(reasons.join('; ')),{code:'SETUP_REQUIRED'});}
 async function read(url,options={}){const response=await fetchImpl(url,{redirect:'error',...options,signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Cardputer API returned '+response.status);if(response.headers.get('x-encrypted')==='1')throw Object.assign(Error('This KProx firmware requires an encrypted API client; setup is incomplete'),{code:'SETUP_REQUIRED'});return response.json();}
 function request(route,body){
  const pending=queue.catch(()=>{}).then(async()=>{configured();const nonce=await read(settings.cardputerEndpoint+'/api/nonce');if(typeof nonce.nonce!=='string'||nonce.nonce.length>512)throw Error('Invalid KProx nonce');const auth=crypto.createHmac('sha256',process.env[settings.cardputerApiKeyEnv]).update(nonce.nonce).digest('hex');return read(settings.cardputerEndpoint+route,{method:body===undefined?'GET':'POST',headers:{'x-auth':auth,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});});queue=pending;return pending;
 }
 async function send(text){const result=await request('/send/text',{text});if(result.status!=='ok')throw Error('Cardputer HID completion is unconfirmed');}
 async function inspect(){
  try{configured();const discovery=await request('/api/discovery');if(discovery.device_type!=='KProx_HID_Controller'||!discovery.capabilities?.keyboard)throw Error('Endpoint is not a KProx HID controller');const usb=await request('/api/usb'),ready=usb.enabled===true&&usb.initialized===true&&usb.connected===true&&usb.keyboardReady===true;return {reachable:true,moduleReady:true,keyboard:ready,keyboardBusy:[...jobs.values()].some(j=>j.running),installed:true,setupRequired:!ready,service:'kprox-http',usbState:ready?'configured':'USB keyboard is not ready',detail:ready?'Cardputer ADV · KProx USB keyboard':'Enable KProx USB keyboard and connect its data cable to Switch'};}
  catch(e){return {reachable:false,moduleReady:false,keyboard:false,setupRequired:true,error:e.message,service:'kprox-http'};}
 }
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function raw(code,modifier=0){await send('{RELEASEALL_USB}'+(modifier?'{SHIFT press USB}{SLEEP 80}':'')+'{HID 0x'+modifier.toString(16)+' 0x'+code.toString(16)+' USB}{SLEEP 60}{RELEASEALL_USB}{SLEEP 60}');}
 async function performPlan(value,onEvent=()=>{}){
  const plan=await preparePlan(value);if(cancelledIds.has(plan.requestId))throw Error('Input job was cancelled; its commands were not sent');if(jobs.has(plan.requestId))return jobs.get(plan.requestId).promise;configured();
  const folder=path.join(root,'data/state/cardputer-input-jobs'),file=path.join(folder,plan.requestId+'.json');await fs.mkdir(folder,{recursive:true,mode:0o700});
  await fs.writeFile(file,JSON.stringify({id:plan.requestId,status:'requested'}),{flag:'wx',mode:0o600}).catch(e=>{if(e.code==='EEXIST')throw Error('This input job already exists; its HID commands were not replayed');throw e;});
  if(cancelledIds.has(plan.requestId))throw Error('Input job was cancelled; its commands were not sent');
  const job={running:true,cancelled:false,promise:null};jobs.set(plan.requestId,job);
  job.promise=(async()=>{
   function check(){if(job.cancelled)throw Error('Input job cancelled');}
   async function key(name,modifier=0){check();await raw(SPECIAL[name],modifier);}
   async function text(value){for(let ch of value){check();if(settings.cardputerCapsLock==='on'&&/[a-z]/i.test(ch))ch=ch===ch.toLowerCase()?ch.toUpperCase():ch.toLowerCase();const code=KEYS[ch];if(!code)throw Error('Unsupported ASCII input');await raw(code[1],code[0]);}}
   async function source(value){const lines=value.replace(/\r\n?/g,'\n').split('\n');if(lines.at(-1)==='')lines.pop();for(let i=0;i<lines.length;i++){check();await key('home',2);await key('delete');await text(lines[i]);if(lines[i].trim())await key('escape');await key('enter');await sleep(lines[i].trim().toUpperCase()==='END'?800:300);onEvent({detail:'Entered source line',fields:{line:i+1,total:lines.length}});}}
   let error;
   try{const state=await inspect();if(!state.keyboard)throw Error(state.error||state.detail||'Cardputer USB keyboard is not ready');for(let at=0;at<=plan.steps.length;at++){check();if(plan.source!==null&&at===plan.sourceAfter)await source(plan.source);if(at===plan.steps.length)break;const step=plan.steps[at];if(step.type==='line'){onEvent({detail:step.text.startsWith('V=START(')?'Typing generated connection command':'Typing plan line',fields:{step:at+1,total:plan.steps.length}});await text(step.text);await key('escape');await key('enter');await sleep(step.delayMs);}else if(step.type==='key'){await key(step.key);await sleep(step.delayMs);}else await sleep(step.ms);}}
   catch(e){error=e;}
   finally{try{await send('{RELEASEALL_USB}');}catch(e){error??=e;}job.running=false;await fs.writeFile(file,JSON.stringify({id:plan.requestId,status:error?'failed':'complete',...(error?{error:error.message}:{})}),{mode:0o600});}
   if(error)throw error;return {ok:true};
  })();return job.promise;
 }
 return {adapter:'kprox-http',inspect,performPlan,async perform(){throw Error('Input actions must be supplied as an engine-provided typed plan');},async halt(id){if(!/^[a-f\d-]{36}$/.test(id))throw Error('Invalid input job identifier');cancelledIds.add(id);const folder=path.join(root,'data/state/cardputer-input-jobs');await fs.mkdir(folder,{recursive:true,mode:0o700});await fs.writeFile(path.join(folder,id+'.json'),JSON.stringify({id,status:'cancelled'}),{flag:'wx',mode:0o600}).catch(e=>{if(e.code!=='EEXIST')throw e;});const job=jobs.get(id);if(job){job.cancelled=true;await Promise.race([job.promise.catch(()=>{}),sleep(12000).then(()=>{throw Error('Cardputer input cancellation is unconfirmed');})]);}await send('{RELEASEALL_USB}');return {stopped:true};}};
}
module.exports={create};
