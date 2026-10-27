// Compatibility entry: use the current session/shell orchestration.
const current=require('./start-run12.cjs');
module.exports=current;
if(require.main===module){process.on('SIGINT',current.closeSession);process.on('SIGTERM',current.closeSession);current.runQualifiedSession().catch(error=>{console.error(error);process.exitCode=1;});}
