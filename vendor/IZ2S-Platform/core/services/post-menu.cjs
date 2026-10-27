const fs=require('node:fs/promises'),path=require('node:path');
// Old frame-loop processes still update their report in place. A bounded read
// retry bridges that writer until its next launch uses atomic replacement.
async function readReport(file,{readFile=fs.readFile,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=4}={}){
 for(let attempt=0;attempt<attempts;attempt++)try{return JSON.parse(await readFile(file,'utf8'));}catch(error){
  if(error instanceof SyntaxError&&attempt+1<attempts){await wait(10);continue;}
  throw Object.assign(new Error('Cannot read menu report '+path.basename(file)+': '+error.message,{cause:error}),{code:'FRAME_MENU_REPORT_INVALID',reportFile:file});
 }
}
async function assertReady(rpc,directory){
 const [a,b,loop]=await Promise.all(['launcher-auto.json','launcher-auto-check.json','launcher-auto-loop.json'].map(name=>readReport(path.join(directory,name))));
 if([a,b,loop].some(x=>x.session!==rpc.a.session)||!a.ready||!a.firstShaderFramePresented||!a.scratchRestored||!b.passed||!b.scratchRestored||!loop.threadRunning)throw Error('Post-menu extension requires the original menu to be running');
 if(!(await rpc.request({command:'status'})).ready)throw Error('Console connection unavailable');
 return {session:rpc.a.session,menuReady:a.completed,inputChecks:b.completed,activated:new Date().toISOString(),bootstrapUnchanged:true};
}
module.exports={assertReady,readReport};
