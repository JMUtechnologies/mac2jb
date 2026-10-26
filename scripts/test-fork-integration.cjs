#!/usr/bin/env node
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const {spawn} = require('node:child_process');
const repository = path.resolve(__dirname, '..');

function fixture(t, actualHost = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac2jb-fork-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'scripts'));
  for (const name of ['gui-host.cjs', 'host-wrapper.cjs'])
    fs.copyFileSync(path.join(__dirname, name), path.join(root, 'scripts', name));
  const host = path.join(root, 'vendor/ns2jb');
  fs.mkdirSync(host, {recursive: true});
  if (actualHost) fs.cpSync(path.join(repository, 'vendor/ns2jb'), host, {
    recursive: true, filter: file => !['runs', 'dumps'].includes(path.basename(file))
  });
  return {root, host, active: path.join(host, 'runs/mac2jb-active-connect.txt')};
}

function launch(t, fixture, adapter, args) {
  const child = spawn(process.execPath, [path.join(fixture.root, 'scripts', adapter), ...args], {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, NS2_BASIC_ARITY: '9', NS2_RPC_MODE: '1'}
  });
  let output = '', error = '', hostPid;
  child.stdout.on('data', bytes => {output += bytes;});
  child.stderr.on('data', bytes => {error += bytes;});
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({code, signal, output, error}));
  });
  t.after(async () => {
    // GUI host processes own a separate group; CLI children share the wrapper's.
    if (hostPid) {try {process.kill(-hostPid, 'SIGKILL');} catch {}}
    try {process.kill(-child.pid, 'SIGKILL');} catch {}
    await done;
  });
  return {child, done, output: () => output, recordHost: pid => {hostPid = pid;}};
}

async function until(predicate, message, deadline = 5000) {
  const start = Date.now();
  while (!predicate()) {
    assert.ok(Date.now() - start < deadline, message);
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}

function greeting() {
  const bytes = Buffer.alloc(128);
  const main = 0x7100000000, sdk = 0x7200000000;
  const words = [0x31545344, 1, 2, 0x10000000, 0x80000,
    main, sdk, main + 0x9c92f0, sdk + 0x5872f0, 0x10001000, 0x10002000,
    0, 0, 0, 0, 3925528160];
  words.forEach((value, index) => bytes.writeBigUInt64LE(BigInt(value), index * 8));
  return bytes;
}

test('transmitted bootstrap is the exact five-argument fork bootstrap', () => {
  const bundled = fs.readFileSync(path.join(repository, 'assets/bootstrap.bas'));
  assert.deepEqual(bundled, fs.readFileSync(path.join(repository, 'vendor/ns2jb/bootstrap.bas')));
  assert.match(bundled.toString(), /COMMON DEF START\(PORT,A,B,C,D\)/);
  const {parseHello} = require('../vendor/ns2jb/engine/lib/connection.cjs');
  assert.equal(parseHello(greeting()).platform, 2);
});

test('CLI host settings override inherited modes while preserving explicit --rpc', async t => {
  const source = fixture(t, false);
  fs.writeFileSync(path.join(source.host, 'run.cjs'), `
    require('fs').writeFileSync('settings.json', JSON.stringify({
      arity: process.env.NS2_BASIC_ARITY, rpc: process.env.NS2_RPC_MODE,
      args: process.argv.slice(2)
    }));
  `);
  const runner = launch(t, source, 'host-wrapper.cjs', ['--rpc', '127.0.0.1']);
  assert.equal((await runner.done).code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(source.host, 'settings.json'))),
    {arity: '5', rpc: '0', args: ['--rpc', '127.0.0.1']});
});

for (const adapter of ['gui-host.cjs', 'host-wrapper.cjs']) {
  test(`${adapter} ignores wrong arity and malformed values and publishes only the five-argument command`, async t => {
    const source = fixture(t, false);
    const values = ['V=START(39380,127,0,0,1,0,0,0,0)', 'V=START(39380,127,0,0)',
      'V=START(39381,127,0,0,1)', 'V=START(39380,999,0,0,1)',
      'V=START(39380,-1,0,0,1)', 'V=START(39380,127,0,0,1.5)',
      'V=START(39380,127,0,0,1);PRINT 1', 'V=START(39380,127,0,0,1)',
      'V=START(39380,127,0,0,1,0,0,0,0)'];
    fs.writeFileSync(path.join(source.host, 'run.cjs'), `
      const fs = require('fs'); const path = require('path');
      const directory = path.join(__dirname, 'runs/test-session'); fs.mkdirSync(directory, {recursive:true});
      for (const command of ${JSON.stringify(values)}) console.log(command);
      console.log('Run folder: ' + directory);
      fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({
        verified: true, fs: {verified: true, restored: true, cleanup: {cleanedUp:true}}
      }));
      setTimeout(() => {}, 300);
    `);
    const args = adapter === 'gui-host.cjs' ? ['host', '127.0.0.1'] : ['127.0.0.1'];
    const runner = launch(t, source, adapter, args);
    await until(() => fs.existsSync(source.active), 'No valid START command was published');
    const record = fs.readFileSync(source.active, 'utf8').trim().split('\n');
    runner.recordHost(Number(record[0]));
    assert.equal(record[1], 'V=START(39380,127,0,0,1)');
    assert.equal((await runner.done).code, 0);
    assert.equal(fs.existsSync(source.active), false);
  });

  test(`${adapter} publishes the actual fork's five-argument command and cleans up after disconnect`,
    {timeout: 10000}, async t => {
      const source = fixture(t);
      const args = adapter === 'gui-host.cjs' ? ['host', '127.0.0.1'] : ['127.0.0.1'];
      const runner = launch(t, source, adapter, args);
      await until(() => fs.existsSync(source.active), 'Host did not publish its command: ' + runner.output());
      const record = fs.readFileSync(source.active, 'utf8').trim().split('\n');
      runner.recordHost(Number(record[0]));
      assert.equal(record[1], 'V=START(39380,127,0,0,1)');
      assert.equal(fs.statSync(source.active).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.dirname(source.active)).mode & 0o777, 0o700);
      // The fork also logs a compatibility fallback. It must not replace the
      // five-argument record that the bundled bootstrap and C sender require.
      await until(() => (runner.output().match(/V=START\(/g) || []).length === 2,
        'The actual host did not print both START forms');
      assert.equal(fs.readFileSync(source.active, 'utf8').trim().split('\n')[1], record[1]);

      // A valid greeting verifies the preserved BASIC wire format. Close on the
      // first qualification read: no native command is executed by this fixture.
      const socket = net.connect(39380, '127.0.0.1');
      t.after(() => socket.destroy());
      await new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.once('connect', () => {socket.write(greeting()); resolve();});
      });
      await new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.once('data', () => {socket.destroy(); resolve();});
      });
      const result = await runner.done;
      assert.equal(result.code, 1, result.output + result.error);
      assert.match(result.output, /Connected\. Checking the application/);
      assert.equal(fs.existsSync(source.active), false);
      const sessions = fs.readdirSync(path.join(source.host, 'runs')).filter(name => name.startsWith('switch2-'));
      assert.equal(sessions.length, 1);
      const report = JSON.parse(fs.readFileSync(path.join(source.host, 'runs', sessions[0], 'result.json')));
      assert.equal(report.verified, false);
      // A peer close may surface as a reset on macOS rather than an EOF.
      assert.match(report.error, /disconnected|closed|ECONNRESET/i);
      if (adapter === 'gui-host.cjs') {
        const events = result.output.trim().split('\n').map(JSON.parse);
        assert.ok(events.some(event => event.type === 'host-ready'));
        assert.ok(events.some(event => event.type === 'host-stage' && event.stage === 'connected'));
        assert.ok(events.some(event => event.type === 'failed'));
        assert.equal(events.some(event => event.type === 'verified'), false);
      }
      await until(() => {
        try {process.kill(Number(record[0]), 0); return false;} catch (error) {return error.code === 'ESRCH';}
      }, 'The completed host process remained alive');
      await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(39380, '127.0.0.1', () => server.close(resolve));
      });
    });
}
