#!/usr/bin/env node
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {validStart, verifiedResult, hidSettings, networkBindFailure} = require('./gui-host.cjs');
function command(address = '192.0.2.1') {
  return 'V=START(' + [39380, ...address.split('.')].join(',') + ')';
}
function fixture(t, sender, host) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac2jb-gui-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.mkdirSync(path.join(root, 'vendor/ns2jb'), {recursive: true});
  fs.copyFileSync(path.join(__dirname, 'gui-host.cjs'), path.join(root, 'scripts/gui-host.cjs'));
  fs.writeFileSync(path.join(root, 'assets/bootstrap.bas'), 'PRINT 1\n');
  if (sender) for (const name of ['mac2jb-send', 'mac2jb-commands'])
    fs.writeFileSync(path.join(root, name), '#!' + process.execPath + '\n' + sender, {mode: 0o700});
  if (host) fs.writeFileSync(path.join(root, 'vendor/ns2jb/run.cjs'), host);
  return root;
}
function run(root, args, env = {}) {
  const child = spawn(process.execPath, [path.join(root, 'scripts/gui-host.cjs'), ...args], {
    stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, ...env}
  });
  let output = '', error = '';
  child.stdout.on('data', bytes => {output += bytes;});
  child.stderr.on('data', bytes => {error += bytes;});
  const done = new Promise((resolve, reject) => {
    child.on('error', reject); child.on('close', code => resolve({code, output, error, events: output.trim().split('\n').filter(Boolean).map(JSON.parse)}));
  });
  return {child, done, events: () => output.split('\n').slice(0, -1).filter(Boolean).map(JSON.parse)};
}
async function until(predicate, message) {
  const started = performance.now();
  while (!predicate()) {
    assert.ok(performance.now() - started < 2500, message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
test('pairing validation requires the expected address and complete command', () => {
  const value = command();
  assert.equal(validStart(value, '192.0.2.1'), true);
  assert.equal(validStart(value, '192.0.2.2'), false);
  assert.equal(validStart(value + 'garbage', '192.0.2.1'), false);
  for (const invalid of ['V=START(39380,192,0,2,1,0,0,0,0)', 'V=START(39380,192,0,2)',
    'V=START(39381,192,0,2,1)', 'V=START(39380,256,0,2,1)', 'V=START(39380,-1,0,2,1)',
    'V=START(39380,192,0,2,1.5)', 'V=START(39380,192,0,2,1);PRINT 1'])
    assert.equal(validStart(invalid, '192.0.2.1'), false, invalid);
});
test('success requires independent FS verification, restoration and cleanup', () => {
  assert.equal(verifiedResult({verified: true}), false);
  assert.equal(verifiedResult({verified: true, fs: {verified: true, restored: true, cleanup: {cleanedUp: false}}}), false);
  assert.equal(verifiedResult({verified: true, fs: {verified: true, restored: true, cleanup: {cleanedUp: true}}}), true);
});
test('Mac network diagnostics match only unavailable binding of the selected host endpoint', () => {
  const line='Error: listen EADDRNOTAVAIL: address not available 192.0.2.1:39380';
  assert.deepEqual(networkBindFailure(line,'192.0.2.1'),{address:'192.0.2.1',diagnostic:line});
  for(const bad of [line.replace('EADDRNOTAVAIL','EADDRINUSE'),line.replace(':39380',':393800'),line.replace(':39380',':12345'),line.replace('192.0.2.1','192.0.2.11')])
    assert.equal(networkBindFailure(bad,'192.0.2.1'),null,bad);
});
function bindFailureScript(prefix='',latePairing=false) {
  const original='Error: listen EADDRNOTAVAIL: address not available 192.0.2.1:39380';
  return `require('fs').appendFileSync('host-invocations.txt','once\\n');
    process.stdout.write(${JSON.stringify(prefix+original+'\n    at Server.setupListenHandle (node:net:1:1)\n'+(latePairing?command()+'\n':''))});setInterval(()=>{},1000);`;
}
test('ordinary host bind failure preserves the cause, never publishes pairing and never retries', {timeout:5000}, async t => {
  const root=fixture(t,undefined,bindFailureScript('',true));
  const result=await run(root,['host','192.0.2.1']).done;
  assert.equal(result.code,1,result.error);
  const events=result.events.filter(event=>event.type==='network-unavailable');assert.equal(events.length,1);
  assert.equal(events[0].retrySafe,true);assert.equal(events[0].address,'192.0.2.1');assert.match(events[0].message,/Refresh network addresses/);
  assert.match(events[0].diagnostic,/listen EADDRNOTAVAIL.*192\.0\.2\.1:39380/);
  assert.ok(result.events.some(event=>event.type==='log'&&event.message===events[0].diagnostic));
  assert.equal(result.events.some(event=>['host-ready','verified','failed','typing'].includes(event.type)),false);
  assert.equal(fs.existsSync(path.join(root,'vendor/ns2jb/runs/mac2jb-active-connect.txt')),false);
  assert.equal(fs.readFileSync(path.join(root,'vendor/ns2jb/host-invocations.txt'),'utf8'),'once\n');
});
for(const prefix of [command()+'\n','Connected. Checking the application\n','1/4 native work\n','Sending: LOAD\n'])
test('ordinary host cannot call a bind failure safe after '+prefix.trim(),{timeout:5000},async t=>{
  const root=fixture(t,undefined,bindFailureScript(prefix));const result=await run(root,['host','192.0.2.1']).done;
  assert.equal(result.code,1);assert.equal(result.events.some(event=>event.type==='network-unavailable'),false);
  const failure=result.events.find(event=>event.type==='failed');assert.equal(failure.retrySafe,false);
  assert.match(failure.message,/Mac network address.*Refresh network addresses/);assert.match(failure.message,/restart the console/);
  assert.match(failure.diagnostic,/EADDRNOTAVAIL/);
  assert.equal(fs.readFileSync(path.join(root,'vendor/ns2jb/host-invocations.txt'),'utf8'),'once\n');
});
test('timing defaults and independent range limits are validated', () => {
  assert.deepEqual(hidSettings([]), {delay: 50, enumerationTimeout: 4,
    loadWaitMs: 3000, runWaitMs: 3000, removeWaitMs: 3000, loadConfirmWaitMs: 1000, demo: false});
  assert.equal(hidSettings(['2000', '--enumeration-timeout', '120', '--load-wait-ms', '0']).loadWaitMs, 0);
  for (const args of [['0'], ['2001'], ['50', '--enumeration-timeout', '0'],
    ['50', '--enumeration-timeout', '121'], ['50', '--run-wait-ms', '120001'],
    ['50', '--load-confirm-wait-ms', '-1']]) assert.throws(() => hidSettings(args));
});
test('demo is a standalone opt-in flag and preserves all timing validation', () => {
  assert.equal(hidSettings(['--demo']).demo, true);
  const settings = hidSettings(['77', '--demo', '--load-wait-ms', '22', '--enumeration-timeout', '1']);
  assert.equal(settings.demo, true);
  assert.equal(settings.delay, 77);
  assert.equal(settings.loadWaitMs, 22);
  assert.equal(settings.enumerationTimeout, 1);
  for (const args of [['--demo', '--demo'], ['--demo=true'], ['--demo=false'],
    ['--demo', 'true'], ['--demo', 'false'], ['--demo', '1'],
    ['50', '--demo', '--enumeration-timeout', '0'], ['50', '--demo', '--run-wait-ms', '120001']])
    assert.throws(() => hidSettings(args), undefined, JSON.stringify(args));
});
test('demo reaches the actual command sender after safe controller probe retry', async t => {
  const root = fixture(t, `
    const fs = require('fs'), path = require('path');
    fs.appendFileSync('demo-invocations.jsonl', JSON.stringify({
      executable:path.basename(process.argv[1]), controller:process.env.MAC2JB_CONTROLLER, args:process.argv.slice(2)
    }) + '\\n');
    if (process.env.MAC2JB_CONTROLLER === 'usb-drd0') {
      console.error('USB host did not enumerate a keyboard'); process.exitCode = 1;
    } else {console.log('Keyboard enumerated. Sending...'); console.log('Sending: LOAD');}
  `);
  const result = await run(root, ['hid', 'commands', 'auto', '77', '--demo', '--load-wait-ms', '22']).done;
  assert.equal(result.code, 0, result.error);
  const invocations = fs.readFileSync(path.join(root, 'demo-invocations.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(invocations.map(value => value.controller), ['usb-drd0', 'usb-drd1']);
  assert.ok(invocations.every(value => value.executable === 'mac2jb-commands' &&
    value.args.filter(argument => argument === '--demo').length === 1));
  for (const value of invocations) {
    assert.equal(value.args[value.args.indexOf('--delay-ms') + 1], '77');
    assert.equal(value.args[value.args.indexOf('--load-wait-ms') + 1], '22');
  }
  assert.ok(result.events.some(value => value.type === 'typing' && value.kind === 'commands'));
  assert.ok(result.events.some(value => value.type === 'transfer-complete'));
});
test('bootstrap sender never receives demo even when the adapter option is enabled', async t => {
  const root = fixture(t, `
    require('fs').writeFileSync('bootstrap-args.json', JSON.stringify({
      executable:require('path').basename(process.argv[1]), args:process.argv.slice(2)
    })); console.log('Keyboard enumerated. Sending...'); console.log('Sent line 1');
  `);
  const result = await run(root, ['hid', 'bootstrap', 'usb-drd1', '77', '--demo']).done;
  assert.equal(result.code, 0, result.error);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'bootstrap-args.json'), 'utf8')),
    {executable: 'mac2jb-send', args: ['assets/bootstrap.bas', '--delay-ms', '77']});
});
test('only pre-enumeration failures probe another controller', async t => {
  const root = fixture(t, `
    if (process.env.MAC2JB_CONTROLLER === 'usb-drd0') {
      console.error('USB host did not enumerate a keyboard'); process.exitCode = 1;
    } else {console.log('Keyboard enumerated. Sending...'); process.stdout.write('\\rSent line 1');}
  `);
  const result = await run(root, ['hid', 'bootstrap', 'auto']).done;
  assert.equal(result.code, 0, result.error);
  assert.deepEqual(result.events.filter(e => e.type === 'controller').map(e => e.controller), ['usb-drd0', 'usb-drd1']);
  assert.ok(result.events.some(e => e.type === 'progress' && e.completed === 1));
});
test('a partial transfer never probes another controller', async t => {
  const root = fixture(t, `console.log('Keyboard enumerated. Sending...'); console.error('Transfer stopped'); process.exitCode = 1;`);
  const result = await run(root, ['hid', 'bootstrap', 'auto']).done;
  assert.equal(result.code, 1);
  assert.equal(result.events.filter(e => e.type === 'controller').length, 1);
  assert.ok(result.events.some(e => e.type === 'failed' && e.partial === true));
});
for (const kind of ['bootstrap', 'commands']) for (const typing of [false, true]) {
  test(`${kind} helper signal termination reports the actual failure and never probes again (${typing ? 'partial typing' : 'before typing'})`, async t => {
    const root = fixture(t, `
      console.log(${JSON.stringify(typing ? 'Keyboard enumerated. Sending...' : 'Waiting for USB host enumeration...')});
      process.kill(process.pid, 'SIGTERM');
    `);
    const result = await run(root, ['hid', kind, 'auto']).done;
    assert.equal(result.code, 1, result.error);
    assert.deepEqual(result.events.filter(event => event.type === 'controller').map(event => event.controller), ['usb-drd0']);
    const failed = result.events.filter(event => event.type === 'failed');
    assert.equal(failed.length, 1);
    assert.equal(failed[0].helper, kind === 'bootstrap' ? 'mac2jb-send' : 'mac2jb-commands');
    assert.equal(failed[0].signal, 'SIGTERM');
    assert.equal(failed[0].controller, 'usb-drd0');
    assert.equal(failed[0].partial, typing);
    assert.match(failed[0].message, new RegExp(`${failed[0].helper} terminated by SIGTERM on usb-drd0`));
    assert.match(failed[0].message, /does not establish that the USB driver is missing/);
    assert.match(failed[0].message, /macOS crash reports and the session logs/);
    assert.match(failed[0].message, /Automatic retry was stopped/);
    assert.equal(result.events.some(event => event.type === 'transfer-complete'), false);
  });
}
test('expected enumeration timeout signals still allow the next safe controller probe', {timeout: 5000}, async t => {
  const root = fixture(t, `
    if (process.env.MAC2JB_CONTROLLER === 'usb-drd0') {
      console.log('Waiting for USB host enumeration...'); setInterval(() => {}, 1000);
    } else {console.log('Keyboard enumerated. Sending...'); console.log('Sent line 1');}
  `);
  const result = await run(root, ['hid', 'bootstrap', 'auto', '50', '--enumeration-timeout', '1']).done;
  assert.equal(result.code, 0, result.error);
  assert.deepEqual(result.events.filter(event => event.type === 'controller').map(event => event.controller), ['usb-drd0', 'usb-drd1']);
  assert.equal(result.events.some(event => event.type === 'failed'), false);
  assert.ok(result.events.some(event => event.type === 'transfer-complete'));
});
test('fragmented native line events show the current line before its completion', {timeout: 8000}, async t => {
  const root = fixture(t, `
    const fs = require('fs');
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const event = value => console.log('MAC2JB_GUI ' + JSON.stringify(value));
    (async () => {
      event({type:'line-start',line:0,completed:0,total:3});
      event({type:'line-start',line:1,completed:1,total:3});
      process.stdout.write('MAC2JB_GUI {"type":"line-');
      await pause(25);
      process.stdout.write('start","line":1,"completed":0,"total":3}\\n');
      console.log('Sent line 3'); // Legacy output must not override native state.
      while (!fs.existsSync('complete-first')) await pause(10);
      event({type:'line-complete',line:1,completed:1,total:3});
      event({type:'line-start',line:2,completed:1,total:3});
      while (!fs.existsSync('stop-second')) await pause(10);
      console.error('Transfer stopped midway through line 2'); process.exitCode = 1;
    })();
  `);
  fs.writeFileSync(path.join(root, 'assets/bootstrap.bas'), 'PRINT 1\nPRINT 2\nPRINT 3\n');
  const runner = run(root, ['hid', 'bootstrap', 'auto', '50', '--enumeration-timeout', '1']);
  t.after(async () => {runner.child.kill('SIGTERM'); await runner.done;});
  await until(() => runner.events().some(e => e.type === 'line-start'), 'Current line was not published while the sender paused');
  const first = runner.events().find(e => e.type === 'line-start');
  assert.deepEqual(first, {type: 'line-start', kind: 'bootstrap', line: 1, completed: 0, total: 3,
    message: 'Typing line 1 of 3'});
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(runner.events().filter(e => e.type === 'controller').length, 1);
  assert.equal(runner.events().some(e => e.type === 'line-complete' || e.type === 'progress'), false);
  assert.equal(runner.events().some(e => e.type === 'transfer-complete'), false);
  const typing = runner.events().findIndex(e => e.type === 'typing');
  assert.ok(typing >= 0);
  assert.equal(runner.events().slice(typing + 1).some(e => e.type === 'enumeration-progress'), false);
  fs.writeFileSync(path.join(root, 'complete-first'), '');
  await until(() => runner.events().some(e => e.type === 'line-start' && e.line === 2), 'Second current line was not published');
  assert.deepEqual(runner.events().filter(e => e.type === 'line-complete').map(e => e.completed), [1]);
  fs.writeFileSync(path.join(root, 'stop-second'), '');
  const result = await runner.done;
  assert.equal(result.code, 1, result.error);
  assert.equal(result.events.filter(e => e.type === 'line-start').length, 2);
  assert.deepEqual(result.events.filter(e => e.type === 'line-complete').map(e => e.completed), [1]);
  assert.equal(result.events.find(e => e.type === 'line-complete').message, 'Sent line 1 of 3');
  assert.equal(result.events.some(e => e.type === 'progress'), false);
  assert.ok(result.events.some(e => e.type === 'failed' && e.partial));
});
test('legacy line progress stays within source bounds and includes the final unterminated line', async t => {
  const root = fixture(t, `console.log('Sent line 1'); console.log('Sent line 2'); console.log('Sent line 99');`);
  fs.writeFileSync(path.join(root, 'assets/bootstrap.bas'), 'PRINT 1\r\nPRINT 2');
  const result = await run(root, ['hid', 'bootstrap', 'usb-drd0']).done;
  assert.equal(result.code, 0, result.error);
  assert.deepEqual(result.events.filter(e => e.type === 'progress'), [
    {type: 'progress', kind: 'bootstrap', line: 2, completed: 1, total: 2},
    {type: 'progress', kind: 'bootstrap', line: 2, completed: 2, total: 2}
  ]);
});
test('typing evidence arriving during timeout shutdown prevents retry', {timeout: 10000}, async t => {
  const root = fixture(t, `
    process.on('SIGTERM', () => {console.log('Keyboard enumerated. Sending...'); process.exitCode = 1; clearInterval(timer);});
    console.log('Waiting for USB host enumeration...'); const timer = setInterval(() => {}, 1000);
  `);
  const result = await run(root, ['hid', 'bootstrap', 'auto']).done;
  assert.equal(result.code, 1);
  assert.equal(result.events.filter(e => e.type === 'controller').length, 1);
  assert.ok(result.events.some(e => e.partial === true));
});
test('host preserves the full pairing output and accepts verified result', async t => {
  const pairing = command();
  const root = fixture(t, undefined, `
    const fs = require('fs'); const path = require('path'); process.umask(0o077);
    const directory = path.join(__dirname, 'runs', 'test-session'); fs.mkdirSync(directory, {recursive: true});
    console.log(${JSON.stringify('  ' + pairing)}); console.log('Run folder: ' + directory);
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({verified:true,fs:{verified:true,restored:true,cleanup:{cleanedUp:true}}}));
    setTimeout(() => {}, 150);
  `);
  const result = await run(root, ['host', '192.0.2.1']).done;
  assert.equal(result.code, 0, result.error);
  assert.ok(result.events.some(e => e.type === 'log' && e.message.trim() === pairing));
  assert.ok(result.events.some(e => e.type === 'host-ready'));
  assert.ok(result.events.some(e => e.type === 'verified'));
  assert.equal(fs.existsSync(path.join(root, 'vendor/ns2jb/runs/mac2jb-active-connect.txt')), false);
  assert.equal(fs.statSync(path.join(root, 'vendor/ns2jb/runs')).mode & 0o777, 0o700);
});
test('GUI host fixes bootstrap arity and disables inherited held RPC mode', async t => {
  const pairing = 'V=START(39380,192,0,2,1)';
  const root = fixture(t, undefined, `
    const fs = require('fs'); const path = require('path');
    fs.writeFileSync(path.join(__dirname, 'host-settings.json'), JSON.stringify({
      arity: process.env.NS2_BASIC_ARITY, rpc: process.env.NS2_RPC_MODE,
      args: process.argv.slice(2)
    }));
    console.log(${JSON.stringify(pairing)});
  `);
  const result = await run(root, ['host', '192.0.2.1'], {NS2_BASIC_ARITY: '9', NS2_RPC_MODE: '1'}).done;
  const settings = JSON.parse(fs.readFileSync(path.join(root, 'vendor/ns2jb/host-settings.json')));
  assert.deepEqual(settings, {arity: '5', rpc: '0', args: ['192.0.2.1']});
  assert.ok(result.events.some(e => e.type === 'host-ready'));
});
test('USB command and failure output preserve the full pairing command', async t => {
  const pairing = command();
  const root = fixture(t, `
    console.log('Sending: ' + ${JSON.stringify(pairing)});
    console.error('Transfer stopped after ' + ${JSON.stringify(pairing)});
    process.exitCode = 1;
  `);
  const result = await run(root, ['hid', 'commands', 'usb-drd0']).done;
  assert.equal(result.code, 1);
  assert.ok(result.events.some(e => e.type === 'command' && e.message === 'Sending: ' + pairing));
  assert.ok(result.events.some(e => e.type === 'log' && e.message === 'Transfer stopped after ' + pairing));
  assert.ok(result.events.some(e => e.type === 'failed' && e.partial === true));
});
test('host rejects a claimed success without restoration', async t => {
  const root = fixture(t, undefined, `
    const fs = require('fs'); const path = require('path'); process.umask(0o077);
    const directory = path.join(__dirname, 'runs', 'test-session'); fs.mkdirSync(directory, {recursive: true});
    console.log('Run folder: ' + directory);
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({verified:true,fs:{verified:true,restored:false,cleanup:{cleanedUp:true}}}));
  `);
  const result = await run(root, ['host', '192.0.2.1']).done;
  assert.equal(result.code, 1);
  assert.equal(result.events.some(e => e.type === 'verified'), false);
});
test('cancellation stops the owned native worker', async t => {
  const root = fixture(t, `console.log('Keyboard enumerated. Sending...'); setInterval(() => {}, 1000);`);
  const {child, done} = run(root, ['hid', 'bootstrap', 'auto']);
  await new Promise(resolve => child.stdout.once('data', resolve));
  await new Promise(resolve => setTimeout(resolve, 100));
  child.kill('SIGTERM');
  const result = await done;
  assert.equal(result.code, 130);
  assert.ok(result.events.some(e => e.type === 'cancelled'));
});
test('selected enumeration window is counted down and bounded', {timeout: 5000}, async t => {
  const root = fixture(t, `
    console.log('Waiting for USB host enumeration...');
    process.on('SIGTERM', () => process.exit(1)); setInterval(() => {}, 1000);
  `);
  const started = performance.now();
  const result = await run(root, ['hid', 'bootstrap', 'usb-drd0', '60', '--enumeration-timeout', '1']).done;
  const elapsed = performance.now() - started;
  assert.equal(result.code, 1);
  assert.ok(elapsed >= 900 && elapsed < 2500, `Elapsed ${elapsed}ms`);
  const countdown = result.events.filter(e => e.type === 'enumeration-progress');
  assert.ok(countdown.length >= 2);
  assert.ok(countdown.every(e => e.total === 1000 && e.remainingMs >= 0 && e.completed <= 1000));
  assert.ok(countdown.at(-1).remainingMs <= 10);
});
test('post-command typing, waits and progress replace enumeration and preserve tuning', {timeout: 5000}, async t => {
  const root = fixture(t, `
    const fs = require('fs'); fs.writeFileSync('timing-args.json', JSON.stringify({args:process.argv.slice(2), timeout:process.env.MAC2JB_ENUMERATION_TIMEOUT_SECONDS}));
    const event = value => console.log('MAC2JB_GUI ' + JSON.stringify(value));
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    (async () => {
      await pause(150); event({type:'typing',completed:0,total:4});
      for (let step=1;step<=4;step++) {
        event({type:'command-start',step,completed:step-1,total:4,label:['LOAD','RUN','REMOVE','START'][step-1]});
        console.log('Sending: ' + ['LOAD','RUN','REMOVE','START'][step-1]); await pause(20);
        event({type:'command-complete',step,completed:step,total:4,label:['LOAD','RUN','REMOVE','START'][step-1]});
        if(step<4) {event({type:'wait',completed:step,total:4,label:'after command',remainingMs:25,durationMs:25});await pause(25);}
      }
      await pause(1100);
    })();
  `);
  const result = await run(root, ['hid', 'commands', 'usb-drd1', '77', '--enumeration-timeout', '1',
    '--load-confirm-wait-ms', '11', '--load-wait-ms', '22', '--run-wait-ms', '33', '--remove-wait-ms', '44']).done;
  assert.equal(result.code, 0, result.error);
  const forwarded = JSON.parse(fs.readFileSync(path.join(root, 'timing-args.json')));
  assert.equal(forwarded.timeout, '1');
  assert.equal(forwarded.args.includes('--demo'), false);
  for (const [flag, value] of [['--delay-ms','77'], ['--enumeration-timeout','1'], ['--load-confirm-wait-ms','11'],
    ['--load-wait-ms','22'], ['--run-wait-ms','33'], ['--remove-wait-ms','44']])
    assert.equal(forwarded.args[forwarded.args.indexOf(flag)+1], value);
  const typing = result.events.findIndex(e => e.type === 'typing');
  assert.ok(typing >= 0);
  assert.equal(result.events.slice(typing+1).some(e => e.type === 'enumeration-progress'), false);
  assert.deepEqual(result.events.filter(e => e.type === 'command-complete').map(e => e.completed), [1,2,3,4]);
  assert.equal(result.events.filter(e => e.type === 'wait').length, 3);
  assert.ok(result.events.some(e => e.type === 'transfer-complete'));
});
test('a launch error clears even a long enumeration countdown immediately', {timeout: 2000}, async t => {
  const root = fixture(t);
  const result = await run(root, ['hid', 'bootstrap', 'usb-drd0', '50', '--enumeration-timeout', '120']).done;
  assert.equal(result.code, 1);
  assert.ok(result.events.some(e => e.type === 'failed' && /ENOENT/.test(e.message)));
});
