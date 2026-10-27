// Compatibility CLI; the capture service belongs to the streaming module.
const current=require(require('../module-files.cjs').resolve('blitbun','server/standalone-service.cjs'));module.exports=current;
if(require.main===module)current.main(...process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
