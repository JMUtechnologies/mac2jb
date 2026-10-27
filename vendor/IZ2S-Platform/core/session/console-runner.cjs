// Start the server, then attach the separately owned console shell.
const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const children = new Set();
let stopping;
const hostScript = 'engines/host.cjs';
function launchStage(script, args = [], readyText) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  child.script = script;
  children.add(child);
  let output = '',
    readyResolve,
    readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // Some stages only need completion; keep unused readiness rejections handled.
  ready.catch(() => {});
  child.stdout.on('data', (bytes) => {
    process.stdout.write(bytes);
    output = (output + bytes).slice(-32768);
    if (readyText && output.includes(readyText)) readyResolve(output);
  });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      children.delete(child);
      readyReject(Error(script + ' exited before ready'));
      if (code === 0) resolve(output);
      else reject(Error(script + ' exited: ' + (signal || code)));
    });
  });
  done.catch(() => {});
  return { child, ready, done };
}
function closeSession() {
  if (stopping) return stopping;
  stopping = (async () => {
    async function end(child) {
      if (!children.has(child)) return;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5000);
        child.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill('SIGTERM');
      });
    }
    // Close file-transfer handles and commit writes while RPC is still available.
    await Promise.all(
      [...children].filter((c) => c.script === 'core/console/host/ftp-service.cjs').map(end),
    );
    // Keep RPC alive until the audio owner has stopped its console output.
    await Promise.all([...children].filter((c) => /\/game-audio\.cjs$/.test(c.script)).map(end));
    await Promise.all([...children].filter((c) => c.script !== hostScript).map(end));
    await Promise.all([...children].map(end));
  })();
  return stopping;
}
// Auxiliary services never own the native connection's lifetime.
function watchAuxiliary(task, name, onExit, isStopping = () => !!stopping) {
  let reported = false;
  const report = (error) => {
    if (reported || isStopping()) return;
    reported = true;
    try {
      return Promise.resolve(onExit(name, error)).catch((e) =>
        console.error('Service report: ' + e.message),
      );
    } catch (e) {
      console.error('Service report: ' + e.message);
    }
  };
  task.done
    .then(() => report(Error('Service exited')), report)
    .catch((error) => console.error('Service report: ' + error.message));
  return task.ready.catch((error) => report(error));
}
async function runQualifiedSession() {
  const id = process.env.IZ2S_SHELL || process.env.IZ15_SHELL || 'izlauncher',
    pinned = await require('../extensions.cjs').pin(root, 'shell', id),
    factory = pinned.load();
  if (
    typeof factory.compatible === 'function' &&
    !(await factory.compatible(
      require('../../engines/index.cjs')
        .list()
        .find((e) => e.id === (process.env.IZ2S_LOADER || process.env.IZ15_LOADER || 'izmysh')),
    ))
  )
    throw Error('Shell incompatible with the selected engine');
  const host = launchStage(
    hostScript,
    process.argv.slice(2),
    'Qualified native session ready for graphics inspection.',
  );
  try {
    const output = await host.ready;
    const match = output.match(/Run folder: ([^\r\n]+)/);
    if (!match) throw Error('Missing fresh run directory');
    const directory = match[1];
    const connection = JSON.parse(
      await require('node:fs/promises').readFile(path.join(directory, 'connection.json')),
    );
    const instance = await factory.create({
      root,
      session: { directory, connection },
      watchAuxiliary,
      closeSession,
      launchStage,
    });
    for (const method of ['init', 'start', 'stop', 'dispose'])
      if (typeof instance[method] !== 'function') throw Error('Missing shell lifecycle: ' + method);
    try {
      await instance.init();
      await instance.start();
      if (!instance.done || typeof instance.done.then !== 'function')
        throw Error('Shell must expose its completion Promise');
      console.log('IZ launcher runtime is running.');
      await Promise.race([host.done, instance.done]);
    } finally {
      try {
        await instance.stop();
      } finally {
        await instance.dispose();
      }
    }
  } finally {
    await closeSession();
  }
}
if (require.main === module) {
  process.on('SIGINT', closeSession);
  process.on('SIGTERM', closeSession);
  runQualifiedSession().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
module.exports = {watchAuxiliary, runQualifiedSession, closeSession};
