const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function read(file,fallback=null){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function write(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await fs.rename(temp,file);}
function clean(value){return String(value).replace(/V=START\([^)]*\)/g,'V=START(…)').replace(/(https?:\/\/[^\s#]+\/#)[a-f0-9]{24,64}/gi,'$1[private]').replace(/((?:token|secret|key)\s*[:=]\s*)[a-f0-9]{24,64}/gi,'$1[private]');}
async function event(root,type,message,extra={}){await fs.mkdir(root,{recursive:true});const row={id:crypto.randomUUID(),at:new Date().toISOString(),type,message:clean(message).slice(0,1200),...extra};await fs.appendFile(path.join(root,'events.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});return row;}
module.exports={read,write,event,clean};
