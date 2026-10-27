// Legacy entry point delegates to the standalone engine server.
const host = require('../../engines/izmysh/server/host.cjs');
if (require.main === module) host.main().catch(error => { console.error(error.stack); process.exitCode=1; });
module.exports = host;
