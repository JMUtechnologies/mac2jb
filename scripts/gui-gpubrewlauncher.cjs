#!/usr/bin/env node
'use strict';
// Attach the pinned GPUBrewLauncher snapshot to the existing held native run.
// Its upstream fresh-session host and nine-argument bootstrap are not invoked.
const homebrew=require('./gui-homebrew.cjs');
function main(args=process.argv.slice(2),options={}) {
  return homebrew.main(args,{...options,application:'gpubrewlauncher'});
}
module.exports={main};
if(require.main===module)main().catch(error=>{
  if(!error.homebrewReported)try{
    process.stdout.write('MAC2JB_HOMEBREW '+JSON.stringify({type:'failed',
      message:error.message+' This launch was not retried. Finish RPC and restart the console.'})+'\n');
  }catch{}
  process.exitCode=1;
});
