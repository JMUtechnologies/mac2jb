// The selected acquisition transport feeds one qualified IZlauncher runtime.
// Upstream FS demos and their separate GPU menus are not started here.
const fs = require('node:fs/promises'),
  path = require('node:path');
const { chooseHost } = require('./izmysh/server/lib/network.cjs');
const { serve } = require('./izmysh/server/lib/bridge.cjs');
const { saveJson } = require('../core/session/ledger.cjs');
async function main() {
  const root = path.resolve(__dirname, '..'),
    id = process.env.IZ15_LOADER || 'izmysh';
  if (
    !require('./index.cjs').IDS.includes(id) ||
    !require('./index.cjs').available(id, 'izlauncher')
  )
    throw Error('Unknown acquisition loader');
  const host = await chooseHost(process.argv.slice(2)),
    port = Number(process.env.HB_PORT || 39395),
    settings = JSON.parse(process.env.IZ15_LOADER_SETTINGS || '{}');
  const transport = process.env.IZ15_ENGINE_FOLDER
    ? require(
        path.join(process.env.IZ15_ENGINE_FOLDER, 'transport.cjs'),
      ).create({ host, port, recovery: false, settings })
    : require('./index.cjs').transport(id, {
        host,
        port,
        recovery: false,
        settings,
      });
  const workspace = path.join(root, 'data/sessions');
  await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(path.join(workspace, 'launcher-'));
  const record = {
    started: new Date().toISOString(),
    purpose: 'Qualified engine session for IZlauncher',
    loader: id,
    transport: { protocol: transport.protocol, resumable: transport.resumable },
    bootstrap: transport.bootstrap,
  };
  let native,
    bridge,
    stateWrites = Promise.resolve(),
    actualProtocol = transport.protocol,
    actualResumable = transport.resumable;
  const state = (event) => {
    const snapshot = {
      ...event,
      protocol: actualProtocol,
      recoveryAvailable: actualResumable,
      loader: id,
    };
    stateWrites = stateWrites
      .then(async () => {
        await fs.appendFile(
          path.join(directory, 'connection-events.jsonl'),
          JSON.stringify(snapshot) + '\n',
        );
        await saveJson(path.join(directory, 'connection-state.json'), snapshot);
      })
      .catch(() => {});
    console.log('Console link: ' + event.state);
  };
  try {
    await fs.writeFile(
      path.join(directory, 'connect.txt'),
      transport.command + '\n',
      { mode: 0o600 },
    );
    await saveJson(path.join(directory, 'loader.json'), {
      id,
      settings,
      bootstrap: transport.bootstrap,
      protocol: transport.protocol,
      resumable: transport.resumable,
    });
    const connected = await transport.listen({
      onRejected: console.error,
      onResumeState: state,
      onWaiting() {
        console.log('Graphics listener ready at ' + host + ':' + port + '.');
        console.log(
          'Acquisition loader: ' +
            id +
            '. Shared IZlauncher runtime follows qualification.',
        );
        console.log(
          '  LOAD "TXT:' +
            transport.bootstrap.saveName +
            '"\n  RUN\n  REMOVE NSR,&H60000000,&H3FFFFFFF',
        );
        console.log(
          'After the expected Out of memory message, enter:\n  ' +
            transport.command,
        );
        console.log('Run folder: ' + directory);
      },
    });
    native = require('../core/session-api.cjs').validateNative(
      transport.native(connected),
    );
    record.qualification = await transport.qualify(native);
    const peer = connected.connection.socket.remoteAddress?.replace(
      /^::ffff:/,
      '',
    );
    if (require('node:net').isIPv4(peer || ''))
      console.log('Console peer: ' + peer);
    const protocol = connected.addresses.protocol ?? 1;
    actualProtocol = protocol;
    actualResumable = protocol === 2 && transport.resumable;
    record.transport = { protocol, resumable: actualResumable };
    record.reconnectProtocol =
      protocol === 2
        ? 'receipt-v2'
        : 'upstream-legacy: dock reconnect unavailable';
    if (protocol !== 2)
      state({ state: 'connected', protocol, at: new Date().toISOString() });
    console.log(
      protocol === 2
        ? 'Dock reconnect protocol v2 active.'
        : 'Selected upstream bootstrap has no receipt reconnect protocol.',
    );
    // Preserve an in-flight operation during HOME; never replay an uncertain call.
    connected.connection.timeout = 120000;
    record.homeResumeGraceMs = 120000;
    bridge = await serve(native, directory);
    bridge.keepAwake(record.qualification.activity);
    await fs.mkdir(path.join(directory, 'shared'));
    await fs.copyFile(
      transport.rpcClient || path.join(__dirname, 'izmysh/server/lib/rpc.cjs'),
      path.join(directory, 'shared/rpc.cjs'),
    );
    await fs.writeFile(
      path.join(directory, 'connection.json'),
      JSON.stringify({
        port: bridge.port,
        token: bridge.token,
        addresses: {
          ...native.addresses,
          session: path.basename(directory),
          target: 'switch2',
        },
      }),
      { mode: 0o600 },
    );
    console.log('Qualified native session ready for graphics inspection.');
    await new Promise((resolve) => {
      const socket = connected.connection.socket;
      const done = () => {
        process.removeListener('SIGINT', done);
        process.removeListener('SIGTERM', done);
        socket.removeListener('close', done);
        resolve();
      };
      socket.once('close', done);
      process.once('SIGINT', done);
      process.once('SIGTERM', done);
      if (socket.destroyed || connected.connection.error) done();
    });
    if (native.connection.error)
      record.disconnect = native.connection.error.message;
    if (protocol !== 2)
      state({
        state: 'closed',
        reason: record.disconnect || 'host-stopped',
        at: new Date().toISOString(),
      });
  } catch (error) {
    record.error = error.stack;
    throw error;
  } finally {
    try {
      await bridge?.close();
    } finally {
      try {
        await native?.stop();
      } finally {
        await stateWrites;
        record.completed = new Date().toISOString();
        await fs.writeFile(
          path.join(directory, 'result.json'),
          JSON.stringify(record, null, 2),
          { mode: 0o600 },
        );
      }
    }
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
module.exports = { main };
