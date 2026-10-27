const path = require('node:path');
const apiVersion = 1;
function openSession(session) {
  if (!session?.directory) throw Error('Qualified native session required');
  return require(path.join(session.directory, 'shared/rpc.cjs'));
}
function dataDirectory(root, id) {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id)) throw Error('Invalid module id');
  return path.join(require('../core/module-paths.cjs').home(root,id), 'data');
}
// A module owns its listener and requests an OS-assigned port by default.
async function listenHttp(server, { port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw Error('Invalid module port');
  await new Promise((resolve, reject) => {
    const error = (e) => {
      server.removeListener('listening', ready);
      reject(e);
    };
    const ready = () => {
      server.removeListener('error', error);
      resolve();
    };
    server.once('error', error);
    server.once('listening', ready);
    server.listen(port, '127.0.0.1');
  });
  const actualPort = server.address().port;
  return { port: actualPort, origin: 'http://127.0.0.1:' + actualPort };
}
function openPanel(url) {
  return require('../core/services/open-panel.cjs').openPanel(url, {
    env: { ...process.env, HB_OPEN_PANEL: '1' },
  });
}
module.exports = {
  apiVersion,
  moduleDirectories: true,
  streamMenuExtensions: true,
  openSession,
  dataDirectory,
  listenHttp,
  openPanel,
};
