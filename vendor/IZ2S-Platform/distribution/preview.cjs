#!/usr/bin/env node
// A temporary source copy gives preview an independent state directory and port.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),temp=await fs.mkdtemp(path.join(os.tmpdir(),'iz2s-preview-'));
 await fs.cp(root,temp,{recursive:true,filter:p=>!['.git','data','dist','.dev','node_modules'].includes(path.relative(root,p).split(path.sep)[0])});
 const publication=await require(path.join(temp,'sdk/publish-modules.cjs')).publish(temp);
 if(publication.errors.length)throw Error(JSON.stringify(publication.errors));
 const child=spawn(process.execPath,[path.join(temp,'start.cjs'),'--preview',...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,HB_OPEN_PANEL:process.argv.includes('--no-open')?'0':'1'}});
 const forward=signal=>child.kill(signal);process.once('SIGINT',()=>forward('SIGINT'));process.once('SIGTERM',()=>forward('SIGTERM'));
 child.once('error',async e=>{console.error(e.message);await fs.rm(temp,{recursive:true,force:true});process.exitCode=1;});
 child.once('close',async code=>{await fs.rm(temp,{recursive:true,force:true});process.exitCode=code||0;});
})().catch(e=>{console.error(e.message);process.exitCode=1;});
