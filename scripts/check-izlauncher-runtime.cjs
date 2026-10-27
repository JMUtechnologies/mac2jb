#!/usr/bin/env node
'use strict';
// Exercise real packaged catalog, compressed shaders and Python rasterizers.
// No device, network, module installation or native RPC is started.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),run=promisify(execFile);
async function main(root=path.resolve(__dirname,'..')) {
  const prepared=require('./prepare-izlauncher.cjs'),info=prepared.verify(root),env=prepared.runtimeEnvironment(root);
  delete process.env.PYTHONHOME;Object.assign(process.env,env);
  const version=await run(path.join(root,'homebrew/python/bin/python3'),['-c','import sys,PIL; print(sys.version.split()[0], PIL.__version__)'],{env});
  if(version.stdout.trim()!=='3.13.17 13.0.0')throw Error('Unexpected IZlauncher Python/Pillow runtime.');
  const catalog=require(path.join(info.directory,'core/services/app-catalog.cjs'));
  const data=await catalog.scan(env.HB_APPS_DIR);
  if(data.rejected.length||data.apps.length!==1||data.apps[0].id!=='iz-exchange')throw Error('Unexpected IZlauncher base catalog.');
  const registry=require(path.join(info.directory,'core/modules.cjs'));
  const modules=await registry.list(info.directory);
  if(modules.errors.length||modules.modules.length!==1||modules.modules[0].id!=='iz-exchange')throw Error('Unexpected IZlauncher module inventory.');
  await registry.verify(info.directory,['iz-exchange']);
  const entry=await registry.loadServer(info.directory,'iz-exchange');
  if(typeof entry.load('runtime').create!=='function')throw Error('File Exchange Mac runtime is unavailable.');
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'mac2jb-izlauncher-check-'));
  try {
    const shell=await require(path.join(info.directory,'shells/izlauncher/server/composition.cjs')).build(data.apps,scratch);
    if(shell.root!==path.join(info.directory,'shells/izlauncher/app'))throw Error('Base IZlauncher unexpectedly requires shader compilation.');
    const atlas=await require(path.join(info.directory,'shells/izlauncher/server/font-data.cjs')).load();
    const type=await require(path.join(info.directory,'shells/izlauncher/server/assets.cjs')).loadTypeAtlas();
    if(atlas.length!==2097152||!type.bytes.length)throw Error('IZlauncher font atlases are incomplete.');
    const raster=await require(path.join(info.directory,'shells/izlauncher/server/raster.cjs')).raster(data,scratch,'offline-hero');
    if(raster.length!==32*131072||!raster.subarray(106496,118784).some(byte=>byte!==0))throw Error('IZlauncher hero title did not rasterize.');
    for(const stage of ['vert','frag','comp'])
      await run(env.SPIRV_VAL,['--target-env','vulkan1.0',path.join(info.directory,'shells/izlauncher/server/shaders/launcher.'+stage+'.spv')],{env});
    console.log('IZlauncher base shell + File Exchange: module integrity, Mac component loading, prebuilt/compressed shaders, Python/Pillow/font and hero catalog raster passed; no USB or RPC operations.');
  } finally {await fs.rm(scratch,{recursive:true,force:true});}
  prepared.verify(root);
}
module.exports={main};
if(require.main===module)main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
