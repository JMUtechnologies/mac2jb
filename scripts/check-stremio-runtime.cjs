#!/usr/bin/env node
'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function main(root=path.resolve(__dirname,'..')){
 const sum=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 const manifest=await fs.readFile(path.join(root,'packaging/stremio-display-SHA256SUMS'),'utf8');
 for(const line of manifest.trim().split('\n')){
  const [sha,file]=line.split('  ');if(!/^[a-f0-9]{64}$/.test(sha)||!file||file.includes('..')||path.isAbsolute(file))throw Error('Invalid display manifest');
  if(sum(await fs.readFile(path.join(root,'stremio/app',file)))!==sha)throw Error('Changed Stremio display asset: '+file);
 }
 const sample=JSON.parse(await fs.readFile(path.join(root,'packaging/stremio-sample-provenance.json'),'utf8'));
 if(sum(await fs.readFile(path.join(root,'assets/stremio/bbb-sample.mp4')))!==sample.sha256)throw Error('Changed Stremio sample clip');
 // Exercise the real startup preflight, without supplying a separate test-only
 // environment that could conceal a missing tool path in the launch path.
 await require('./gui-stremio.cjs').checkRuntime(root);
 const {renderMenu}=require(path.join(root,'stremio/menu.cjs'));
 const rgba=await renderMenu({title:'Stremio · experimental',subtitle:'Playback sample',rows:[{label:'Big Buck Bunny · 30-second sample'}],selected:0,footer:'A Open · B Back'},
  {python:path.join(root,'homebrew/python/bin/python3'),fontPath:path.join(root,'homebrew/fonts/DejaVuSans.ttf')});
 const codec=require(path.join(root,'stremio/bc1.cjs'));if(codec.encode(rgba,320,180).length!==28800)throw Error('Invalid video transport block size');
 console.log('Experimental Stremio assets, sample, real menu raster and shader validation passed; no console commands sent.');
}
module.exports={main};if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
