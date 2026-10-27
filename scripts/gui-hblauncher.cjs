#!/usr/bin/env node
'use strict';
// Attach the frozen HBLauncher v0.2.0 to the existing verified held session.
const homebrew=require('./gui-homebrew.cjs');
function main(args=process.argv.slice(2),options={}) {
  return homebrew.main(args,{...options,application:'hblauncher'});
}
module.exports={main};
if(require.main===module)main().catch(error=>{
  if(!error.homebrewReported)try{
    process.stdout.write('MAC2JB_HOMEBREW '+JSON.stringify({type:'failed',
      message:error.message+' This launch was not retried. Finish RPC and restart the console.'})+'\n');
  }catch{}
  process.exitCode=1;
});
