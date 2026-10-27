// The original acquisition bootstrap feeds the shared IZlauncher runtime.
// Do not invoke upstream/run.cjs here: that entry starts the upstream FS demo.
const path = require('node:path');
const net = require('node:net');
const {extendNative} = require('../extend-native.cjs');

function create({host, port = 39380, recovery = false, settings = {}} = {}) {
  if (!net.isIPv4(host || '') || !Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error('Expected reachable IPv4 address and port');
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    throw Error('Expected kurumuz loader settings');
const connection = require('./upstream/engine/lib/connection.cjs');
const {NativeClient} = require('./upstream/engine/lib/native.cjs');
const {qualify} = require('./upstream/engine/lib/qualify.cjs');
  const arity=5,saveName='NS2K';
  if(recovery)throw Error('The kurumuz bootstrap does not support NS2R recovery');

  const bootstrap = {
    file: path.join(__dirname, 'upstream/bootstrap.bas'),
    saveName,
    sourceSlot: 0,
    arity,
    loaderId: 'kurumuz',
    recovery: false,
  };
  return {
    id: 'kurumuz',
    rpcClient: path.join(__dirname, 'upstream/engine/shared/rpc.cjs'),
    command: `V=START(${[port, ...host.split('.')].join(',')})`,
    bootstrap,
    protocol: 1,
    resumable: false,
    // Always load the saved kurumuz program into slot 0.
    preloaded: false,
    async listen(options = {}) {
      const connected = await connection.listen({...options, host, port});
      return {...connected, addresses: {...connected.addresses, protocol: 1}};
    },
    native(connected) {
      if (!connected?.connection || !connected.addresses)
        throw Error('Expected a connected kurumuz console');
      return extendNative(new NativeClient(connected.connection, connected.addresses));
    },
    qualify,
  };
}

module.exports = {create};
