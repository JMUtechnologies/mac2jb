// Compatibility API: UI implementation belongs to the console shell.
module.exports = require('../../shells/izlauncher/server/build-app.cjs');
if(require.main===module)module.exports.build(process.argv[2]).catch(error=>{console.error(error);process.exitCode=1;});
