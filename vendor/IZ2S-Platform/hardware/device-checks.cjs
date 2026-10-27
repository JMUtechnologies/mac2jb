const fs = require('node:fs/promises'),
  path = require('node:path'),
  net = require('node:net'),
  os = require('node:os'),
  { spawn } = require('node:child_process');
const { verifyOriginals } = require('../core/session/integrity.cjs');
function invoke(
  file,
  args,
  { cwd, env = process.env, timeout = 18000, onLine } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      pending = '',
      ended = false;
    const settle = (error, value) => {
      if (ended) return;
      ended = true;
      clearTimeout(deadline);
      error ? reject(error) : resolve(value);
    };
    const deadline = setTimeout(() => {
      child.kill('SIGTERM');
      settle(Error('Device operation timed out'));
    }, timeout);
    child.stdout.on('data', (b) => {
      stdout += b;
      pending += b;
      let at;
      while ((at = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, at);
        pending = pending.slice(at + 1);
        try {
          onLine?.(line);
        } catch (e) {
          child.kill('SIGTERM');
          settle(e);
        }
      }
    });
    child.stderr.on('data', (b) => (stderr = (stderr + b).slice(-12000)));
    child.once('error', (e) => settle(e));
    child.once('close', (code, signal) =>
      settle(
        code === 0
          ? null
          : Error(
              stderr.trim() ||
                stdout.trim() ||
                'Device helper stopped (' + (signal || code) + ')',
            ),
        { stdout, stderr },
      ),
    );
  });
}
function createInputLink(root, settings = {}) {
  return require('./transports/index.cjs').create({root, configuration:{
    id:'pc-arm', inputAdapter:'ssh-gadget', settings,
  }});
}

function availablePort(address, port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, address, () => s.close(() => resolve(true)));
  });
}
async function inspectConsolePaths({
  connections,
  settings,
  hostInterface,
  run,
  mode,
}) {
  const { modeName } = require('../core/session/connections.cjs');
  const candidates = connections?.candidates?.() || [
    {
      mode: mode('lan'),
      address: settings.consoleAddress,
      observedMode: connections?.observed('lan'),
    },
  ];
  const paths = await Promise.all(
    candidates.map(async (candidate) => {
      const { address, mode, observedMode } = candidate,
        start = Date.now();
      try {
        if (
          !address &&
          candidate.automatic
        ) {
          if (!hostInterface || !settings.consoleHost)
            throw Error(
              'No local server adapter for automatic console connection',
            );
          return {
            ...candidate,
            ready: true,
            pending: true,
            latencyMs: null,
            checkedAt: Date.now(),
            durationMs: Date.now() - start,
          };
        }
        if (!address)
          throw Error('Set the console ' + modeName(mode) + ' address');
        if (observedMode && observedMode !== mode)
          throw Error(
            'Console is on ' +
              modeName(observedMode) +
              ' · switch the connection or connect via ' +
              modeName(mode),
          );
        const route = JSON.parse(
          (
            await run('ip', ['-json', 'route', 'get', address], {
              timeout: 4000,
            })
          ).stdout,
        )[0];
        if (!route?.dev || route.dev === 'lo')
          throw Error('No route to the console');
        if (hostInterface && route.dev !== hostInterface)
          throw Error('Server and console are on different networks');
        const ping = await run(
          'ping',
          [
            '-n',
            ...(settings.consoleHost ? ['-I', settings.consoleHost] : []),
            '-c',
            '1',
            '-W',
            '1',
            address,
          ],
          { timeout: 2500 },
        ).catch(() => {
          throw Error(
            'Console is not reachable via ' + modeName(mode) + ' · ' + address,
          );
        });
        const ms = Number(ping.stdout.match(/time[=<]([\d.]+)\s*ms/)?.[1]);
        return {
          ...candidate,
          ready: true,
          latencyMs: Number.isFinite(ms) ? ms : null,
          checkedAt: Date.now(),
          durationMs: Date.now() - start,
        };
      } catch (error) {
        // Auto is an inbound connection, not a permanent pin to the previous
        // session's IP. A dock/portable transition can change that address.
        if (candidate.automatic && hostInterface && settings.consoleHost) {
          return {...candidate,address:'',observedMode:null,previousAddress:address,ready:true,pending:true,latencyMs:null,reason:'Awaiting the next console connection',checkedAt:Date.now(),durationMs:Date.now()-start};
        }
        return {
          ...candidate,
          ready: false,
          latencyMs: null,
          error: error.message,
          checkedAt: Date.now(),
        };
      }
    }),
  );
  connections?.reportPaths?.(paths);
  const active = paths.find((p) => p.ready&&!p.pending)||paths.find((p)=>p.ready);
  if (!active)
    throw Error(
      paths
        .map((p) => (paths.length > 1 ? modeName(p.mode) + ': ' : '') + p.error)
        .join(' · '),
    );
  return {
    ...active,
    detail: active.pending
      ? 'Automatic · waiting for Switch to connect to ' + settings.consoleHost
      : (paths.length > 1 ? 'LAN + Wi-Fi · using ' : 'Reachable · ') +
        modeName(active.mode) +
        (active.observedMode ? ' verified' : ' selected') +
        ' · ' +
        active.address,
    paths,
  };
}
function createDeviceChecks({
  root,
  settings,
  node,
  arm,
  connections,
  ownsListener = () => false,
  requiresArmAddress = true,
  run = invoke,
  interfaces = () => os.networkInterfaces(),
  portAvailable = availablePort,
}) {
  let cachedTools;
  async function inspect() {
    await connections?.refresh();
    const { modeName } = require('../core/session/connections.cjs'),
      mode = (id) => connections?.mode(id) || 'lan';
    const hostInterface = Object.entries(interfaces()).find(([, list]) =>
      list.some((a) => a.address === settings.consoleHost),
    )?.[0];
    const rows = [
      { id: 'server', label: 'Server', ready: false, detail: 'Checking host' },
      {
        id: 'arm',
        label: 'ARM PC · input service',
        ready: false,
        detail: 'Checking input service',
      },
      {
        id: 'usb',
        label: 'ARM Type C - Switch',
        ready: false,
        detail: 'Waiting for USB status',
      },
      {
        id: 'lan',
        label: 'LAN · console',
        ready: false,
        detail: 'Checking console network',
      },
    ];
    const tasks = await Promise.allSettled([
      (async () => {
        await verifyOriginals(root);
        if (!hostInterface)
          throw Error(
            'No active ' + modeName(mode('server')) + ' address on this PC',
          );
        if (
          connections?.observed('server') &&
          connections.observed('server') !== mode('server')
        )
          throw Error(
            'This PC address uses ' + modeName(connections.observed('server')),
          );
        if (
          !ownsListener() &&
          !(await portAvailable(settings.consoleHost, settings.consolePort))
        )
          throw Error('Console port is already in use');
        if (!cachedTools) {
          await run(node, ['hardware/dependencies.cjs', '--host-only'], {
            cwd: root,
            env: { ...process.env, NODE: node },
            timeout: 20000,
          });
          cachedTools = true;
        }
        return (
          modeName(mode('server')) +
          ' · ' +
          settings.consoleHost +
          ' · ' +
          hostInterface
        );
      })(),
      (async () => {
        if (requiresArmAddress && !settings.armAddress && connections)
          throw Error(
            connections.snapshot().discovery?.ambiguous
              ? 'Multiple ARM input services found · choose the required address'
              : 'Set the ARM PC ' +
                  modeName(mode('arm')) +
                  ' address, or install its IZ2S discovery service',
          );
        return arm.inspect();
      })(),
      inspectConsolePaths({ connections, settings, hostInterface, run, mode }),
    ]);
    const host = tasks[0];
    rows[0].ready = host.status === 'fulfilled';
    rows[0].detail =
      host.status === 'fulfilled'
        ? host.value
        : (
            host.reason.message
              .split('\n')
              .find((s) => s.startsWith('NEED ')) || host.reason.message
          ).replace(/^NEED\s+/, '');
    const peer = tasks[1];
    if (peer.status === 'fulfilled') {
      const h = peer.value,
        observed = h.connectionMode || connections?.observed('arm'),
        mismatch = observed && observed !== mode('arm');
      rows[1].ready = !!(h.reachable && h.moduleReady && !mismatch);
      rows[1].detail = !h.reachable
        ? 'ARM connection failed: ' + (h.error || 'SSH did not respond')
        : !h.moduleReady
          ? (h.error || 'Install or update the ARM input package')
          : mismatch
        ? 'ARM PC is on ' + modeName(observed) + ' · select that connection'
        : (h.installed ? 'Input module installed' : 'Input module ready') +
          ' · ' +
          modeName(mode('arm')) +
          ' · ' +
          (settings.armAddress || '10.42.0.2');
      rows[2].ready = !!h.reachable && !!h.keyboard && !h.keyboardBusy;
      rows[2].detail = !h.reachable ? 'USB state unavailable until ARM reconnects' : h.keyboardBusy
        ? 'Input device is busy'
        : h.keyboard
          ? 'USB host configured'
          : h.usbState || 'Connect the USB data cable';
    } else {
      rows[1].detail = peer.reason.message.startsWith('Set the ARM')
        ? peer.reason.message
        : 'ARM PC is not reachable · ' +
          (settings.armAddress || modeName(mode('arm')) + ' address needed');
      rows[2].detail = 'Waiting for the ARM PC';
    }
    const link = tasks[2];
    rows[3].ready = link.status === 'fulfilled';
    rows[3].detail =
      link.status === 'fulfilled' ? link.value.detail : link.reason.message;
    rows[3].latencyMs =
      link.status === 'fulfilled' ? link.value.latencyMs : null;
    rows[3].pending = link.status === 'fulfilled' && !!link.value.pending;
    return {
      at: new Date().toISOString(),
      ready: rows.every((r) => r.ready),
      items: rows,
    };
  }
  return { inspect };
}
module.exports = {
  invoke,
  availablePort,
  createInputLink,
  inspectConsolePaths,
  createDeviceChecks,
};
