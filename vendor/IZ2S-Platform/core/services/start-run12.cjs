// Compatibility entry; process orchestration belongs to session lifecycle.
const current=require('../session/console-runner.cjs');module.exports=current;
if(require.main===module){process.on('SIGINT',current.closeSession);process.on('SIGTERM',current.closeSession);current.runQualifiedSession().catch(error=>{console.error(error);process.exitCode=1;});}
