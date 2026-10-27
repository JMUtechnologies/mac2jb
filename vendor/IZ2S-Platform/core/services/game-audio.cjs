// Compatibility entry; shared console effects belong to the console runtime.
const current=require('../console/audio/game-audio.cjs');module.exports=current;
if(require.main===module)current.main(process.argv[2]).catch(error=>{console.error(error);process.exitCode=1;});
