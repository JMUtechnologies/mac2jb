#!/usr/bin/env node
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');

test('the native command sender accepts only the live five-argument START record', t => {
  const root = path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mac2jb-start-test-'));
  t.after(() => fs.rmSync(temporary, {recursive: true, force: true}));
  const source = fs.readFileSync(path.join(root, 'commands.c'), 'utf8');
  const entry = 'int main(int argc, char **argv) {';
  assert.equal(source.split(entry).length, 2);
  // Compile the production translation unit with its program entry renamed.
  // The harness calls its actual record parser and never initializes USB.
  const harness = source.replace(entry, 'int mac2jb_commands_test_entry(int argc, char **argv) {') + `
    int main(void) {
      char command[512];
      return load_active_start(command, sizeof(command)) == 0 ? 0 : 1;
    }
  `;
  const input = path.join(temporary, 'start-test.c');
  const executable = path.join(temporary, 'start-test');
  fs.writeFileSync(input, harness);
  const compiled = spawnSync('xcrun', ['clang', '-std=c11', '-D_POSIX_C_SOURCE=200809L',
    '-I' + root, '-I' + path.join(root, 'vendor/libusbd/include'),
    input, '-L' + path.join(root, 'vendor/libusbd'), '-lusbd',
    '-Wl,-rpath,' + path.join(root, 'vendor/libusbd'),
    '-framework', 'CoreFoundation', '-framework', 'IOKit', '-o', executable], {encoding: 'utf8'});
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const folder = path.join(temporary, 'vendor/ns2jb/runs');
  fs.mkdirSync(folder, {recursive: true});
  const active = path.join(folder, 'mac2jb-active-connect.txt');
  function check(command, expected, pid = process.pid) {
    fs.writeFileSync(active, `${pid}\n${command}\n`);
    const result = spawnSync(executable, [], {cwd: temporary, encoding: 'utf8'});
    assert.equal(result.status, expected, command + '\n' + result.stderr);
  }
  for (const command of ['V=START(39380,192,0,2,1)', 'V=START(39380,0,0,0,0)',
    'V=START(39380,255,255,255,255)']) check(command, 0);
  for (const command of ['V=START(39380,192,0,2,1,0,0,0,0)', 'V=START(39380,192,0,2)',
    'V=START(39381,192,0,2,1)', 'V=START(39380,256,0,2,1)', 'V=START(39380,-1,0,2,1)',
    'V=START(39380,192,0,2,1.5)', 'V=START(39380,192,0,2,1);PRINT 1',
    'V=START(39380,192,0,2,18446744073709551616)', 'V=START(39380,192,0,2,)',
    'V=START(39380,192,0,2,1,)', 'V=START(39380,192,0,2,1)garbage']) check(command, 1);
  check('V=START(39380,192,0,2,1)', 1, 1);
});
