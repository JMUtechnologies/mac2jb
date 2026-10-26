#!/usr/bin/env node
'use strict';
// No console commands: verify the packaged tools against real HBLauncher assets.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
async function main(root=path.resolve(__dirname,'..')) {
  const runtime=path.join(root,'homebrew');
  const manifest=JSON.parse(await fs.readFile(path.join(runtime,'manifest.json'),'utf8'));
  for(const entry of manifest.files) {
    if(typeof entry.path!=='string'||path.isAbsolute(entry.path)||entry.path.split('/').includes('..'))throw Error('Unsafe dependency manifest path');
    const file=path.join(runtime,entry.path),stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unexpected runtime file: '+entry.path);
    if(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')!==entry.sha256)
      throw Error('Changed homebrew dependency: '+entry.path);
  }
  const env=require('./gui-homebrew.cjs').runtimeEnvironment(root);
  delete process.env.PYTHONHOME;Object.assign(process.env,env);
  const version=await run(path.join(runtime,'python/bin/python3'),['-c','import sys,PIL; print(sys.version.split()[0], PIL.__version__)'],{env});
  if(version.stdout.trim()!=='3.13.17 13.0.0')throw Error('Unexpected Python/Pillow versions');
  const catalog=require(path.join(root,'vendor/HBLauncher/homebrew-launcher/app-catalog.cjs'));
  const data=await catalog.scan(path.join(root,'vendor/HBLauncher/apps'));
  if(data.rejected.length||!data.apps.length)throw Error('Bundled app validation failed: '+JSON.stringify(data.rejected));
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'mac2jb-hbl-check-'));
  try {
    await catalog.raster(data,scratch,'packaged');
    const malformed=path.join(scratch,'invalid.spv');await fs.writeFile(malformed,Buffer.alloc(24));
    let rejected=false;
    try{await run(env.SPIRV_VAL,['--target-env','vulkan1.0',malformed],{env});}catch{rejected=true;}
    if(!rejected)throw Error('Shader validator accepted malformed SPIR-V');
    console.log('HBLauncher v0.2.0: portable Python/Pillow/font, shader validation, bundled apps and catalog raster passed; no console commands sent.');
  } finally {await fs.rm(scratch,{recursive:true,force:true});}
}
module.exports={main};
if(require.main===module)main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
