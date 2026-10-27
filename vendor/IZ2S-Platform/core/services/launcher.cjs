// Compatibility entry; implementation is owned by its extension.
const implementation = require('../../shells/izlauncher/server/prepare.cjs');
module.exports = implementation;
if (require.main === module) implementation.main(...process.argv.slice(2)).catch(error => {console.error(error);process.exitCode=1;});
