#!/usr/bin/env node
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const {main, launchConfiguration, validCatalog} = require('./gui-attach.cjs');
const root = '/private/test/mac2jb-app';
const directory = '/private/test/original-host/runs/switch2-held';
const game = {titleId: '0100123456789000', name: 'My game', storages: [2]};
function deferred() {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};}
async function until(check, message = 'Fixture action did not finish') {
  const deadline = Date.now() + 2000;
  while (!check()) {assert.ok(Date.now() < deadline, message); await new Promise(resolve => setTimeout(resolve, 2));}
}
function fixture(t, options = {}) {
  const input = new PassThrough(), output = new PassThrough(), signals = new EventEmitter();
  const events = [], calls = [], children = [];
  const state = {lost: false, closed: false, checks: 0};
  const context = {
    directory, sourceSession: 'switch2-held', description: 'Verified local RPC', manifestPath: root + '/attached-run.json',
    async verify() {
      calls.push(['verify']); state.checks++;
      if (options.verify) await options.verify(state);
      if (state.lost) throw Error('source closed');
      return {ready: true, calls: 7};
    },
    async claimApplication(application) {calls.push(['claim', application]); await options.claim?.(application);},
    abortVerification() {calls.push(['abort-verification']); options.abortVerification?.();},
    async close() {calls.push(['close']); state.closed = true; await options.close?.();}
  };
  function spawn(executable, args, settings) {
    calls.push(['spawn', executable, args, settings]);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.input = ''; child.signals = []; child.ended = false;
    child.stdin.on('data', bytes => {child.input += bytes;});
    child.event = event => child.stdout.write('MAC2JB_HOMEBREW ' + JSON.stringify(event) + '\n');
    child.close = (code = 0, signal = null) => {
      if (child.ended) return; child.ended = true;
      child.stdout.end(); child.stderr.end(); child.emit('close', code, signal);
    };
    children.push(child);
    setImmediate(() => {
      if (options.childStart) options.childStart(child);
      else {child.event({type: 'started'}); if (!args[0].endsWith('gui-ouncecake.cjs')) child.event({type: 'running'});}
    });
    return child;
  }
  const done = main({root, input, output, signals, emit: (type, fields) => events.push({type, ...fields}),
    pollMs: options.pollMs ?? 0, graceMs: options.graceMs ?? 200,
    prepare: async (receivedRoot, connection, preparation) => {
      calls.push(['prepare', receivedRoot, connection]);
      await options.prepare?.(preparation.signal); return context;
    }, spawn, signal: (child, signal, group) => {
      assert.ok(children.includes(child), 'Only owned children may be signalled');
      child.signals.push([signal, group]); calls.push(['signal', signal, group]);
      if (signal === 'SIGKILL') child.close(null, 'SIGKILL');
      else if (options.stopChild) options.stopChild(child);
      else setImmediate(() => {child.event({type: 'stopped'}); child.close();});
    }});
  const keepAlive = setInterval(() => {}, 100);
  let finished = false; done.finally(() => {finished = true; clearInterval(keepAlive);});
  function send(value) {input.write(typeof value === 'string' ? value + '\n' : JSON.stringify(value) + '\n');}
  async function wait(type, count = 1) {
    await until(() => events.filter(event => event.type === type).length >= count, 'Missing ' + type + ': ' + JSON.stringify(events));
    return events.filter(event => event.type === type).at(-1);
  }
  async function attach() {send({action: 'attach', connection: {kind: 'local', runDirectory: directory}}); return wait('rpc-attached');}
  t.after(async () => {
    if (!finished) {send({action: 'finish'}); for (const child of children) child.close();}
    await Promise.race([done, new Promise(resolve => setTimeout(resolve, 500))]);
    clearInterval(keepAlive);
    input.destroy(); output.destroy();
  });
  return {input, output, signals, events, calls, children, state, context, done, send, wait, attach};
}

test('local attachment is announced only after prepare and live verification', async t => {
  const proof = deferred(), session = fixture(t, {verify: () => proof.promise});
  session.send({action: 'attach', connection: {kind: 'local', runDirectory: directory}});
  await until(() => session.state.checks === 1);
  assert.equal(session.events.some(event => event.type === 'rpc-attached'), false);
  session.send({action: 'launch-gpubrewlauncher'}); await session.wait('action-rejected');
  proof.resolve(); const attached = await session.wait('rpc-attached');
  assert.equal(attached.path, directory); assert.equal(attached.sourceSession, 'switch2-held');
  assert.deepEqual(session.calls.map(row => row[0]), ['prepare', 'verify']);
  session.send({action: 'rpc-status'}); assert.equal((await session.wait('rpc-status')).ready, true);
  assert.equal(session.state.checks, 2); assert.equal(session.children.length, 0);
  session.send({action: 'finish'}); assert.equal(await session.done, 0);
  assert.equal(session.events.at(-1).type, 'rpc-detached'); assert.equal(session.events.at(-1).resourcesRetained, true);
  assert.equal(session.events.some(event => ['verified', 'host-ready', 'post-run-ready'].includes(event.type)), false);
  assert.deepEqual(session.calls.at(-1), ['close']);
});
test('invalid and nonlocal controls cannot prepare or claim a source', async t => {
  const session = fixture(t);
  for (const value of ['{', 'null', '[]', {action: 'attach', connection: {kind: 'ssh'}}, {action: 'attach'},
    {action: 'host'}, {action: 'launch-gpubrewlauncher'}]) session.send(value);
  await session.wait('action-rejected', 7);
  assert.deepEqual(session.calls, []); assert.equal(session.children.length, 0);
  await session.attach(); session.send({action: 'attach', connection: {kind: 'local', runDirectory: '/elsewhere'}});
  await session.wait('action-rejected', 8); assert.equal(session.calls.filter(row => row[0] === 'prepare').length, 1);
});
for (const step of ['prepare', 'verify']) test('failed ' + step + ' never announces attached or spawns a helper', async t => {
  const session = fixture(t, {[step]: async () => {throw Error('invalid proof');}});
  session.send({action: 'attach', connection: {kind: 'local', runDirectory: directory}});
  assert.equal(await session.done, 1); assert.equal(session.events.some(event => event.type === 'rpc-attached'), false);
  assert.equal(session.children.length, 0); assert.ok(session.events.some(event => event.type === 'failed'));
  assert.equal(session.state.closed, step === 'verify');
});
test('launch configurations reject unsupported input before reserving a native attempt', async t => {
  const session = fixture(t); await session.attach();
  const bad = [
    {action: 'launch-ouncecake', consoleAddress: 'host.example'},
    {action: 'launch-stremio', addonUrls: Array(33).fill('https://test/manifest.json')},
    {action: 'launch-stremio', addonUrls: ['x'.repeat(4097)]},
    {action: 'launch-stremio', addonUrls: [5]},
    {action: 'launch-stremio', libraryItems: [null]},
    {action: 'launch-stremio', libraryItems: [[]]},
    {action: 'launch-stremio', libraryItems: Array(501).fill({})},
    {action: 'launch-stremio', quality: '4k'}
  ];
  for (const command of bad) session.send(command);
  await session.wait('action-rejected', bad.length);
  assert.equal(session.calls.some(row => row[0] === 'claim'), false);
  session.send({action: 'launch-gpubrewlauncher'}); await session.wait('homebrew-running');
  assert.equal(session.children.length, 1);
});
for (const [action, application, name] of [
  ['launch-izlauncher', 'izlauncher', 'gui-izlauncher.cjs'],
  ['launch-hblauncher', 'hblauncher', 'gui-hblauncher.cjs'],
  ['launch-gpubrewlauncher', 'gpubrewlauncher', 'gui-gpubrewlauncher.cjs'],
  ['launch-stremio', 'stremio', 'gui-stremio.cjs'],
  ['launch-ouncecake', 'ouncecake', 'gui-ouncecake.cjs']
]) test(application + ' claims the original run once before the correct local helper starts', async t => {
  const session = fixture(t); await session.attach();
  const command = {action, consoleAddress: '192.0.2.9', quality: '540p', addonUrls: ['https://test/manifest.json'], libraryItems: [{id: 'tt1'}]};
  session.send(command); session.send(command); await session.wait('action-rejected'); await session.wait('homebrew-started');
  assert.deepEqual(session.calls.filter(row => row[0] === 'claim'), [['claim', application]]);
  const call = session.calls.find(row => row[0] === 'spawn');
  assert.ok(session.calls.findIndex(row => row[0] === 'claim') < session.calls.indexOf(call));
  assert.equal(call[1], process.execPath); assert.equal(call[2][0], root + '/scripts/' + name); assert.equal(call[2][1], directory);
  assert.equal(call[3].env.MAC2JB_ATTACHED_RUN_MANIFEST, session.context.manifestPath);
  assert.equal(call[3].detached, true); assert.equal(call[3].cwd, root);
  if (application === 'izlauncher') assert.deepEqual(call[2].slice(2), []);
  if (application === 'stremio') {
    assert.deepEqual(call[2].slice(2), ['--quality', '540p']);
    assert.deepEqual(JSON.parse(session.children[0].input), {addonUrls: command.addonUrls, libraryItems: command.libraryItems});
    session.children[0].event({type: 'account-progress', watchProgress: {id: 'tt1', time: 12}});
    assert.equal((await session.wait('account-progress')).watchProgress.time, 12);
  } else if (application === 'ouncecake') assert.deepEqual(JSON.parse(session.children[0].input), {consoleAddress: '192.0.2.9', port: 2121});
  session.send({action: 'finish'}); assert.equal(await session.done, 0);
  assert.deepEqual(session.children[0].signals, [['SIGTERM', false]]);
  assert.ok(session.events.findIndex(row => row.type === 'homebrew-stopped') < session.events.findIndex(row => row.type === 'rpc-detached'));
});
test('atomic source claim failure never spawns and cannot be retried', async t => {
  const session = fixture(t, {claim: async () => {throw Error('already claimed');}}); await session.attach();
  session.send({action: 'launch-gpubrewlauncher'}); await session.wait('homebrew-failed');
  session.send({action: 'launch-stremio'}); await session.wait('action-rejected');
  assert.equal(session.children.length, 0); assert.equal(session.calls.filter(row => row[0] === 'claim').length, 1);
  session.send({action: 'finish'}); assert.equal(await session.done, 1);
});
test('finish during a pending source claim prevents helper spawn', async t => {
  const claim = deferred(), session = fixture(t, {claim: () => claim.promise}); await session.attach();
  session.send({action: 'launch-gpubrewlauncher'}); await until(() => session.calls.some(row => row[0] === 'claim'));
  session.send({action: 'finish'}); await session.wait('rpc-finishing'); claim.resolve();
  assert.equal(await session.done, 0); assert.equal(session.children.length, 0); assert.equal(session.state.closed, true);
});
test('source monitoring never races installation of the atomic claim marker', async t => {
  const claim = deferred(), session = fixture(t, {pollMs: 5, claim: () => claim.promise}); await session.attach();
  session.send({action: 'launch-gpubrewlauncher'}); await until(() => session.calls.some(row => row[0] === 'claim'));
  const checks = session.state.checks; await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(session.state.checks, checks); assert.equal(session.children.length, 0);
  claim.resolve(); await session.wait('homebrew-running');
  await until(() => session.state.checks > checks);
  session.send({action: 'finish'}); assert.equal(await session.done, 0);
});
test('finish during attachment waits for authorization and closes it without publishing readiness', async t => {
  const prepare = deferred(), session = fixture(t, {prepare: () => prepare.promise});
  session.send({action: 'attach', connection: {kind: 'local', runDirectory: directory}});
  await until(() => session.calls.some(row => row[0] === 'prepare'));
  session.input.end(); await session.wait('rpc-finishing'); prepare.resolve();
  assert.equal(await session.done, 0); assert.equal(session.state.closed, true);
  assert.equal(session.events.some(row => row.type === 'rpc-attached'), false); assert.equal(session.children.length, 0);
});
test('finish aborts pending preparation probes without claiming source failure', async t => {
  const session = fixture(t, {prepare: signal => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(Error('probe aborted'), {name: 'AbortError'})), {once: true});
  })});
  session.send({action: 'attach', connection: {kind: 'local', runDirectory: directory}});
  await until(() => session.calls.some(row => row[0] === 'prepare')); session.send({action: 'finish'});
  assert.equal(await session.done, 0); assert.equal(session.events.some(row => row.type === 'failed'), false);
  assert.equal(session.state.closed, false); assert.equal(session.state.checks, 0);
});
test('finish aborts initial verification without publishing attachment or source loss', async t => {
  const proof = deferred(), session = fixture(t, {verify: () => proof.promise,
    abortVerification: () => proof.reject(Object.assign(Error('probe aborted'), {name: 'AbortError'}))});
  session.send({action: 'attach', connection: {kind: 'local', runDirectory: directory}});
  await until(() => session.state.checks === 1); session.send({action: 'finish'});
  assert.equal(await session.done, 0); assert.equal(session.state.closed, true);
  assert.equal(session.events.some(row => ['rpc-attached', 'failed', 'cleanup-blocked'].includes(row.type)), false);
});
test('finish aborts a monitor only after the owned app has finished native cleanup', async t => {
  const stopped = deferred(), probe = deferred();
  const session = fixture(t, {pollMs: 5, verify: state => state.checks >= 3 ? probe.promise : undefined,
    abortVerification: () => probe.reject(Object.assign(Error('probe aborted'), {name: 'AbortError'})),
    stopChild: child => stopped.promise.then(() => {child.event({type: 'stopped'}); child.close();})});
  await session.attach(); session.send({action: 'launch-gpubrewlauncher'}); await session.wait('homebrew-running');
  await until(() => session.state.checks >= 3); session.send({action: 'finish'});
  await until(() => session.children[0].signals.length === 1);
  assert.equal(session.calls.some(row => row[0] === 'abort-verification'), false);
  stopped.resolve(); assert.equal(await session.done, 0); assert.equal(session.state.closed, true);
  assert.ok(session.calls.some(row => row[0] === 'abort-verification'));
  assert.equal(session.events.some(row => ['failed', 'cleanup-blocked'].includes(row.type)), false);
});
for (const stop of ['EOF', 'SIGTERM', 'SIGINT']) test(stop + ' drains only the owned helper before detaching', async t => {
  const stopped = deferred(), session = fixture(t, {stopChild: child => {
    child.stdout.write('MAC2JB_HOMEBREW {"type":"sto');
    stopped.promise.then(() => {child.stdout.write('pped"}\n'); child.close();});
  }});
  await session.attach(); session.send({action: 'launch-gpubrewlauncher'}); await session.wait('homebrew-running');
  if (stop === 'EOF') session.input.end(); else session.signals.emit(stop);
  await until(() => session.children[0].signals.length === 1);
  assert.equal(session.state.closed, false); assert.equal(session.events.some(row => row.type === 'rpc-detached'), false);
  stopped.resolve(); assert.equal(await session.done, 0);
  assert.deepEqual(session.children[0].signals, [['SIGTERM', false]]); assert.equal(session.state.closed, true);
});
test('source loss kills only owned helpers and retains original resources without native cleanup', async t => {
  const session = fixture(t, {pollMs: 5}); await session.attach();
  session.send({action: 'launch-gpubrewlauncher'}); await session.wait('homebrew-running'); session.state.lost = true;
  assert.equal(await session.done, 1);
  assert.deepEqual(session.children[0].signals, [['SIGKILL', true]]);
  assert.ok(session.events.some(row => row.type === 'cleanup-blocked' && row.resourcesRetained));
  assert.equal(session.events.at(-1).type, 'rpc-detached'); assert.equal(session.events.at(-1).cleanupBlocked, true);
  assert.equal(session.calls.filter(row => row[0] === 'claim').length, 1);
});
test('unconfirmed helper shutdown reaches its grace limit and reports cleanup blocked', async t => {
  const session = fixture(t, {graceMs: 20, stopChild: () => {}}); await session.attach();
  session.send({action: 'launch-gpubrewlauncher'}); await session.wait('homebrew-running'); session.send({action: 'finish'});
  assert.equal(await session.done, 1);
  assert.deepEqual(session.children[0].signals, [['SIGTERM', false], ['SIGKILL', true]]);
  assert.equal(session.events.at(-1).cleanupBlocked, true); assert.equal(session.state.closed, true);
});
test('a zero helper exit without terminal cleanup proof is not a successful app shutdown', async t => {
  const session = fixture(t, {childStart: child => {child.event({type: 'started'}); child.close();}}); await session.attach();
  session.send({action: 'launch-stremio'}); await session.wait('homebrew-failed');
  assert.ok(session.events.some(row => row.type === 'cleanup-blocked'));
  session.send({action: 'launch-gpubrewlauncher'}); await session.wait('action-rejected');
  session.send({action: 'finish'}); assert.equal(await session.done, 1);
});
test('OunceCake catalog selection and FTP endpoint belong to the attached session', async t => {
  const session = fixture(t); await session.attach(); session.send({action: 'launch-ouncecake', consoleAddress: '192.0.2.9'});
  await session.wait('homebrew-started'); const child = session.children[0];
  child.event({type: 'catalog', games: [game]}); assert.deepEqual((await session.wait('homebrew-catalog')).games, [game]);
  session.send({action: 'select-ouncecake-game', titleId: '0000000000000000'}); await session.wait('action-rejected');
  session.send({action: 'select-ouncecake-game', titleId: game.titleId});
  await until(() => child.input.split('\n').filter(Boolean).length === 2);
  assert.deepEqual(JSON.parse(child.input.trim().split('\n')[1]), {action: 'select-game', titleId: game.titleId});
  child.event({type: 'running', host: '192.0.2.9', port: 2121, ftpURL: 'ftp://192.0.2.9:2121'});
  assert.equal((await session.wait('homebrew-running')).ftpURL, 'ftp://192.0.2.9:2121');
  session.send({action: 'select-ouncecake-game', titleId: game.titleId}); await session.wait('action-rejected', 2);
  session.send({action: 'finish'}); assert.equal(await session.done, 0);
});
test('invalid or duplicate OunceCake catalogs are rejected before selection', async t => {
  for (const games of [[], [game, game], [{...game, titleId: 'bad'}], [{...game, name: 'bad\nname'}],
    [{...game, name: 'é'.repeat(81)}], [{...game, storages: [2, 2]}], [{...game, storages: [7]}]]) assert.equal(validCatalog(games), false);
  const session = fixture(t); await session.attach(); session.send({action: 'launch-ouncecake', consoleAddress: '192.0.2.9'});
  await session.wait('homebrew-started'); session.children[0].event({type: 'catalog', games: [game, game]});
  await session.wait('homebrew-stopped'); assert.equal(session.events.some(row => row.type === 'homebrew-catalog'), false);
  session.send({action: 'finish'}); assert.equal(await session.done, 1);
});
test('OunceCake cannot publish FTP readiness before selection or for a different endpoint', async t => {
  const session = fixture(t); await session.attach(); session.send({action: 'launch-ouncecake', consoleAddress: '192.0.2.9'});
  await session.wait('homebrew-started'); session.children[0].event({type: 'running', host: '192.0.2.9', port: 2121, ftpURL: 'ftp://192.0.2.9:2121'});
  await session.wait('homebrew-stopped'); assert.equal(session.events.some(row => row.type === 'homebrew-running'), false);
  session.send({action: 'finish'}); assert.equal(await session.done, 1);
});
for (const endpoint of [{host: '192.0.2.10', port: 2121, ftpURL: 'ftp://192.0.2.10:2121'},
  {host: '192.0.2.9', port: 5000, ftpURL: 'ftp://192.0.2.9:5000'},
  {host: '192.0.2.9', port: 2121, ftpURL: 'ftp://other.example:2121'}])
test('selected OunceCake game rejects mismatched endpoint ' + endpoint.ftpURL, async t => {
  const session = fixture(t); await session.attach(); session.send({action: 'launch-ouncecake', consoleAddress: '192.0.2.9'});
  await session.wait('homebrew-started'); const child = session.children[0]; child.event({type: 'catalog', games: [game]});
  await session.wait('homebrew-catalog'); session.send({action: 'select-ouncecake-game', titleId: game.titleId});
  await until(() => child.input.split('\n').filter(Boolean).length === 2); child.event({type: 'running', ...endpoint});
  await session.wait('homebrew-stopped'); assert.equal(session.events.some(row => row.type === 'homebrew-running'), false);
  session.send({action: 'finish'}); assert.equal(await session.done, 1);
});
for (const application of ['ouncecake', 'izlauncher', 'stremio']) test(application + ' uncertain native cleanup is retained when the local helper is detached', async t => {
  const session = fixture(t); await session.attach(); session.send({action: 'launch-' + application, consoleAddress: '192.0.2.9'});
  await session.wait('homebrew-started');
  session.children[0].event({type: 'failed', cleanupBlocked: true, message: 'Native join was not confirmed.'});
  await session.wait('cleanup-blocked');
  assert.equal((await session.wait('homebrew-failed')).cleanupBlocked, true);
  session.send({action: 'finish'});
  assert.equal(await session.done, 1); assert.deepEqual(session.children[0].signals, [['SIGKILL', true]]);
  assert.equal(session.events.at(-1).cleanupBlocked, true); assert.equal(session.state.closed, true);
});
test('Stremio receive failure with confirmed native shutdown detaches without claiming uncertainty', async t => {
  const session=fixture(t);await session.attach();session.send({action:'launch-stremio'});await session.wait('homebrew-running');
  session.children[0].event({type:'failed',cleanupBlocked:false,message:'Short receive; native workers joined'});
  assert.equal((await session.wait('homebrew-failed')).cleanupBlocked,false);session.children[0].close(1);
  await until(()=>session.events.filter(row=>row.type==='homebrew-failed').length===2);
  session.send({action:'finish'});assert.equal(await session.done,1);
  assert.equal(session.events.at(-1).cleanupBlocked,false);assert.equal(session.events.at(-1).resourcesRetained,true);
  assert.deepEqual(session.children[0].signals,[]);
});
test('malformed helper events stop the owned helper without another launch', async t => {
  const session = fixture(t); await session.attach(); session.send({action: 'launch-gpubrewlauncher'}); await session.wait('homebrew-running');
  session.children[0].stdout.write('MAC2JB_HOMEBREW null\n'); await session.wait('homebrew-stopped');
  session.send({action: 'launch-gpubrewlauncher'}); await session.wait('action-rejected');
  session.send({action: 'finish'}); assert.equal(await session.done, 1); assert.equal(session.children.length, 1);
});
test('status loss without an active app detaches without claiming native cleanup', async t => {
  const session = fixture(t); await session.attach(); session.state.lost = true;
  session.send({action: 'rpc-status'}); assert.equal((await session.wait('rpc-status')).ready, false);
  assert.equal(await session.done, 1); assert.equal(session.children.length, 0);
  assert.equal(session.events.at(-1).cleanupBlocked, false); assert.equal(session.events.at(-1).resourcesRetained, true);
});
test('stdout EPIPE still drains the owned helper and closes only local authorization', async t => {
  const session = fixture(t); await session.attach(); session.send({action: 'launch-gpubrewlauncher'}); await session.wait('homebrew-running');
  session.output.emit('error', Object.assign(Error('pipe closed'), {code: 'EPIPE'}));
  assert.equal(await session.done, 0); assert.equal(session.state.closed, true);
  assert.deepEqual(session.children[0].signals, [['SIGTERM', false]]);
  assert.equal(session.events.some(row => row.type === 'verified'), false);
});
