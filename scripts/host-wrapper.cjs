#!/usr/bin/env node
'use strict';
// Pairing values belong to the current host launch.
process.umask(0o077);
// Starts the untouched ns2jb host, captures its per-session pairing command,
// and makes that command available to mac2jb-commands while the host is alive.
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const hostDir = path.join(root, 'vendor/ns2jb');
const runs = path.join(hostDir, 'runs');
const active = path.join(runs, 'mac2jb-active-connect.txt');
fs.mkdirSync(runs, {recursive: true, mode: 0o700});
// Existing directories may have been created with permissive modes.
fs.chmodSync(runs, 0o700);
let child, published = false, partial = '';
try {
  child = spawn(process.execPath, ['run.cjs', ...process.argv.slice(2)], {
    cwd: hostDir, stdio: ['inherit', 'pipe', 'inherit'],
    // Match the fork's shipped five-argument bootstrap.
    // Holding RPC remains an explicit CLI choice through --rpc.
    env: {...process.env, NS2_BASIC_ARITY: '5', NS2_RPC_MODE: '0'}
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
function publish(command) {
  if (published) return;
  const tmp = active + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, `${child.pid}\n${command}\n`, {mode: 0o600, flag: 'wx'});
    fs.renameSync(tmp, active);
    published = true;
    console.log('mac2jb: active V=START command is ready for mac2jb-commands.');
  } catch (error) {
    console.error('mac2jb: cannot publish active START command:', error.message);
    try {fs.unlinkSync(tmp)} catch {}
    child.kill('SIGTERM');
  }
}
child.stdout.on('data', chunk => {
  const str = chunk.toString();
  process.stdout.write(str);
  partial += str;
  let idx;
  while ((idx = partial.indexOf('\n')) >= 0) {
    const line = partial.slice(0, idx).trim();
    partial = partial.slice(idx+1);
    const match = /^V=START\((\d+(?:,\d+){4})\)$/.exec(line);
    if (match) {
      const words = match[1].split(',').map(Number);
      if (words.every(Number.isSafeInteger) && words[0] === 39380 &&
          words.slice(1).every(value => value >= 0 && value <= 255)) publish(line);
    }
  }
  if (partial.length > 16384) partial = partial.slice(-16384);
});
child.on('error', error => {console.error('ns2jb host failed:', error.message);});
child.on('close', (code, signal) => {
  if (published) {
    try {
      const content = fs.readFileSync(active, 'utf8');
      if (content.startsWith(`${child.pid}\n`)) fs.unlinkSync(active);
    } catch {}
  }
  if (signal) {
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
