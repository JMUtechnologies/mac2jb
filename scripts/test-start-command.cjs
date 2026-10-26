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

test('native full-game and demo command modes preserve actual HID ordering and waits without hardware', async t => {
  const root = path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mac2jb-command-modes-'));
  t.after(() => fs.rmSync(temporary, {recursive: true, force: true}));
  const production = fs.readFileSync(path.join(root, 'commands.c'), 'utf8')
    .replace('int main(int argc, char **argv) {', 'int mac2jb_commands_test_entry(int argc, char **argv) {');
  // Compile the production main and sender encoding. Only USB operations and the
  // monotonic clock/sleep boundary are replaced, so every submitted key is observed.
  const harness = `
    #include <libusbd.h>
    #include <time.h>
    #include <unistd.h>
    #include <stdio.h>
    static unsigned long long mock_ns=0;
    static int mock_usb_write(libusbd_ctx_t*,uint8_t,uint64_t,const void*,uint32_t,uint64_t);
    static int mock_clock(clockid_t,struct timespec*);
    static int mock_pause(const struct timespec*,struct timespec*);
    static unsigned int mock_seconds(unsigned int);
    #define libusbd_init(ctx) (*(ctx)=(libusbd_ctx_t*)1,0)
    #define libusbd_free(...) (0)
    #define libusbd_set_pid(...) (0)
    #define libusbd_set_version(...) (0)
    #define libusbd_set_class(...) (0)
    #define libusbd_set_subclass(...) (0)
    #define libusbd_set_protocol(...) (0)
    #define libusbd_set_manufacturer_str(...) (0)
    #define libusbd_set_product_str(...) (0)
    #define libusbd_set_serial_str(...) (0)
    #define libusbd_iface_alloc(ctx,iface) (*(iface)=0,0)
    #define libusbd_config_finalize(...) (0)
    #define libusbd_iface_set_class(...) (0)
    #define libusbd_iface_set_subclass(...) (0)
    #define libusbd_iface_set_protocol(...) (0)
    #define libusbd_iface_standard_desc(...) (0)
    #define libusbd_iface_nonstandard_desc(...) (0)
    #define libusbd_iface_add_endpoint(ctx,iface,type,direction,size,interval,unknown,ep) (*(ep)=0,0)
    #define libusbd_iface_finalize(...) (0)
    #define libusbd_ep_write mock_usb_write
    #define clock_gettime mock_clock
    #define nanosleep mock_pause
    #define sleep mock_seconds
    ${production}
    static int mock_usb_write(libusbd_ctx_t *ctx,uint8_t iface,uint64_t ep,
                              const void *data,uint32_t len,uint64_t timeout) {
      if(len!=8)return LIBUSBD_NOT_ENUMERATED;
      const uint8_t *b=data;
      printf("TEST_USB {\\"atNs\\":%llu,\\"report\\":[%u,%u,%u,%u,%u,%u,%u,%u]}\\n",
        mock_ns,b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7]);return (int)len;
    }
    static int mock_clock(clockid_t id,struct timespec *value) {
      value->tv_sec=(time_t)(mock_ns/1000000000ULL);value->tv_nsec=(long)(mock_ns%1000000000ULL);return 0;
    }
    static int mock_pause(const struct timespec *value,struct timespec *remaining) {
      unsigned long long duration=(unsigned long long)value->tv_sec*1000000000ULL+value->tv_nsec;
      printf("TEST_PAUSE {\\"durationNs\\":%llu}\\n",duration);mock_ns+=duration;return 0;
    }
    static unsigned int mock_seconds(unsigned int seconds) {
      printf("TEST_SLEEP {\\"seconds\\":%u}\\n",seconds);mock_ns+=(unsigned long long)seconds*1000000000ULL;return 0;
    }
    int main(int argc,char **argv) { return mac2jb_commands_test_entry(argc,argv); }
  `;
  const input = path.join(temporary, 'commands-test.c');fs.writeFileSync(input, harness);
  const executables = {};
  for (const build of ['cli', 'gui']) {
    const executable = path.join(temporary, 'commands-' + build);
    const compiled = spawnSync('xcrun', ['clang', '-std=c11', '-D_POSIX_C_SOURCE=200809L',
      ...(build === 'gui' ? ['-DMAC2JB_GUI=1'] : []), '-I' + root,
      '-I' + path.join(root, 'vendor/libusbd/include'), input, '-o', executable], {encoding: 'utf8'});
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);executables[build] = executable;
  }
  const active = path.join(temporary, 'vendor/ns2jb/runs/mac2jb-active-connect.txt');
  fs.mkdirSync(path.dirname(active), {recursive: true});
  const start = 'V=START(39380,192,0,2,1)';fs.writeFileSync(active, `${process.pid}\n${start}\n`);
  const demoCommand = 'PRGEDIT 0:LOADV "TXT:NS2" OUT C$:PRGSET C$';
  const following = ['RUN', 'REMOVE NSR,&H60000000,&H3FFFFFFF', start];
  const guiOptions = ['--gui-events', '--load-confirm-wait-ms', '111', '--load-wait-ms', '222',
    '--run-wait-ms', '333', '--remove-wait-ms', '444'];
  function run(build, demo, extra = ['--auto'], input = '') {
    const result = spawnSync(executables[build], [...(demo ? ['--demo'] : []), '--delay-ms', '50',
      ...(build === 'gui' ? guiOptions : []), ...extra], {cwd: temporary, encoding: 'utf8', input,
      env: {...process.env, MAC2JB_AUTO_WORKER: '1'}, timeout: 3000});
    const records = result.stdout.split('\n').flatMap(line => {
      for (const [prefix, kind] of [['TEST_USB ', 'usb'], ['TEST_SLEEP ', 'sleep'],
        ['TEST_PAUSE ', 'pause'], ['MAC2JB_GUI ', 'event']])
        if (line.startsWith(prefix)) return [{kind, ...JSON.parse(line.slice(prefix.length))}];
      return [];
    });
    return {...result, records};
  }
  function character(mods, key) {
    assert.ok(mods === 0 || mods === 2, 'Only the existing SmileBASIC shift convention is used');
    if (key >= 4 && key <= 29) return String.fromCharCode((mods ? 97 : 65) + key - 4);
    if (key >= 30 && key <= 38) return mods ? '!@#$%^&*('[key - 30] : String(key - 29);
    if (key === 39) return mods ? ')' : '0';
    const symbols = {44: [' ', ' '], 45: ['-', '_'], 46: ['=', '+'], 47: ['[', '{'], 48: [']', '}'],
      49: ['\\', '|'], 51: [';', ':'], 52: ["'", '"'], 53: ['`', '~'], 54: [',', '<'], 55: ['.', '>'], 56: ['/', '?']};
    assert.ok(symbols[key], 'Unexpected HID key: ' + key);return symbols[key][mods ? 1 : 0];
  }
  function submitted(records) {
    const usb = records.filter(row => row.kind === 'usb'), groups = [];let command = '', firstAt;
    for (let index = 0; index < usb.length; index++) {
      const row = usb[index], [mods, reserved, key, ...remaining] = row.report;
      assert.equal(reserved, 0);assert.deepEqual(remaining, [0, 0, 0, 0, 0]);
      if (!key) continue;
      assert.deepEqual(usb[index + 1].report, Array(8).fill(0), 'Every pressed key must immediately release');
      if (key === 40) {groups.push({command, firstAt, enterAt: row.atNs});command = '';firstAt = undefined;}
      else {firstAt ??= row.atNs;command += character(mods, key);}
    }
    assert.equal(command, '');return groups;
  }
  function events(result, demo, automatic) {
    const native = result.records.filter(row => row.kind === 'event');
    assert.deepEqual(native.filter(row => row.type.startsWith('command-')).map(row => [row.type, row.step]),
      Array.from({length: 4}, (_, index) => [['command-start', index + 1], ['command-complete', index + 1]]).flat());
    const waits = new Map(native.filter(row => row.type === 'wait').map(row => [row.label, row.durationMs]));
    assert.deepEqual([...waits], [...(!demo ? [['LOAD confirmation', 111]] : []),
      ...(automatic ? [['LOAD', 222], ['RUN', 333], ['REMOVE', 444]] : [])]);
  }
  for (const build of ['cli', 'gui']) for (const demo of [false, true]) {
    await t.test(`${build} ${demo ? 'demo LOADV' : 'full LOAD'} sends exact bytes, Enters and original waits`, () => {
      const result = run(build, demo);assert.equal(result.status, 0, result.stderr);
      const groups = submitted(result.records);
      assert.deepEqual(groups.map(group => group.command), [demo ? demoCommand : 'LOAD "TXT:NS2"', ...(!demo ? [''] : []), ...following]);
      assert.equal(groups.length, demo ? 4 : 5);
      const confirmationMs = build === 'gui' ? 111 : 1000;
      const waits = build === 'gui' ? [222, 333, 444] : [3000, 3000, 3000];
      if (!demo) assert.equal((groups[1].enterAt - groups[0].enterAt) / 1000000, 50 + confirmationMs);
      for (let next = demo ? 1 : 2, wait = 0; next < groups.length; next++, wait++)
        assert.equal((groups[next].firstAt - groups[next - 1].enterAt) / 1000000, 50 + waits[wait]);
      if (build === 'gui') events(result, demo, true);
      else assert.deepEqual(result.records.filter(row => row.kind === 'sleep').map(row => row.seconds), demo ? [3, 3, 3] : [1, 3, 3, 3]);
    });
  }
  await t.test('manual first-step prompts describe the selected command and retain approval boundaries', () => {
    for (const build of ['cli', 'gui']) for (const demo of [false, true]) {
      const result = run(build, demo, [], '\n'.repeat(4));assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes(demo ? 'STEP 1/4: Focus SmileBASIC Demo Direct mode. Send ' + demoCommand + '?' :
        'STEP 1/4: Focus SmileBASIC Direct mode. Send LOAD "TXT:NS2"?'));
      assert.equal(submitted(result.records).length, demo ? 4 : 5);
      if (build === 'gui') events(result, demo, false);
      else assert.deepEqual(result.records.filter(row => row.kind === 'sleep').map(row => row.seconds), demo ? [] : [1]);
    }
  });
  await t.test('dry-run and help expose demo selection without touching USB', () => {
    for (const build of ['cli', 'gui']) for (const demo of [false, true]) {
      const result = run(build, demo, ['--dry-run']);assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes('1: ' + (demo ? demoCommand : 'LOAD "TXT:NS2"') + ' [Enter]\n2: RUN [Enter]'));
      assert.equal(result.records.some(row => row.kind === 'usb'), false);
      const help = run(build, demo, ['--help']);assert.equal(help.status, 0);assert.match(help.stdout, /\[--demo\]/);
    }
  });
  await t.test('GUI timing protocol skips only the demo confirmation wait and never initializes USB', () => {
    for (const demo of [false, true]) {
      const result = run('gui', demo, ['--gui-timing-test']);assert.equal(result.status, 0, result.stderr);
      assert.equal(result.records.some(row => row.kind === 'usb'), false);events(result, demo, true);
    }
  });
});
