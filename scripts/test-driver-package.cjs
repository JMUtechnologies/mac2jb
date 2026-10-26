'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('driver verification accepts the tested copy and rejects tampering, extra files and links', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac2jb-driver-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const repo = path.resolve(__dirname, '..');
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(path.join(repo, 'scripts/install-driver.sh'), path.join(root, 'scripts/install-driver.sh'));
  fs.cpSync(path.join(repo, 'drivers'), path.join(root, 'drivers'), {recursive: true});
  const verify = () => spawnSync('/bin/bash', [path.join(root, 'scripts/install-driver.sh'), '--verify'], {encoding: 'utf8'});
  assert.equal(verify().status, 0);
  const binary = path.join(root, 'drivers/usbgadget.kext/Contents/MacOS/usbgadget');
  const original = fs.readFileSync(binary);
  fs.appendFileSync(binary, 'tampered');
  assert.notEqual(verify().status, 0);
  fs.writeFileSync(binary, original);
  const extra = path.join(root, 'drivers/usbgadget.kext/Contents/extra');
  fs.writeFileSync(extra, 'unexpected signing metadata');
  assert.notEqual(verify().status, 0);
  fs.unlinkSync(extra);
  fs.symlinkSync(binary, extra);
  assert.notEqual(verify().status, 0);
});

test('installer uses the actual loader outcome instead of the SIP status summary', async t => {
  const repo = path.resolve(__dirname, '..');
  for (const fixture of [
    {name: 'fully disabled', sip: 'System Integrity Protection status: disabled.', code: 0},
    {name: 'custom configuration', sip: 'System Integrity Protection status: unknown (Custom Configuration).\nKext Signing: disabled', code: 0, backup: true},
    {name: 'enabled with loader refusal', sip: 'System Integrity Protection status: enabled.', code: 71},
    {name: 'unavailable status command', sip: 'csrutil: status unavailable', csrCode: 1, code: 0},
    {name: 'custom configuration with loader refusal', sip: 'System Integrity Protection status: enabled (Custom Configuration).', code: 71},
  ]) {
    await t.test(fixture.name, t => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac2jb-driver-policy-'));
      t.after(() => fs.rmSync(root, {recursive: true, force: true}));
      assert.match(root, /^[A-Za-z0-9_/.-]+$/);
      const scripts = path.join(root, 'scripts'), bin = path.join(root, 'bin');
      const extensions = path.join(root, 'Extensions'), calls = path.join(root, 'loader-calls');
      for (const directory of [scripts, bin, extensions]) fs.mkdirSync(directory);
      fs.cpSync(path.join(repo, 'drivers'), path.join(root, 'drivers'), {recursive: true});
      let installer = fs.readFileSync(path.join(repo, 'scripts/install-driver.sh'), 'utf8');
      assert.ok(installer.includes('PATH=/usr/bin:/bin:/usr/sbin:/sbin'));
      assert.ok(installer.includes('if [[ "$EUID" != 0 ]]; then'));
      // Only this disposable copy can use stubs, skip elevation and write into
      // a fake Extensions folder. The production installer keeps its fixed PATH.
      installer = installer.replace('PATH=/usr/bin:/bin:/usr/sbin:/sbin', `PATH=${bin}:/usr/bin:/bin:/usr/sbin:/sbin`)
        .replace('if [[ "$EUID" != 0 ]]; then', 'if false; then')
        .replaceAll('/Library/Extensions', extensions);
      assert.equal(installer.includes('/Library/Extensions'), false);
      const file = path.join(scripts, 'install-driver.sh');
      fs.writeFileSync(file, installer);
      function stub(name, body) {fs.writeFileSync(path.join(bin, name), '#!/bin/bash\nset -eu\n' + body + '\n', {mode: 0o755});}
      stub('uname', 'case "$1" in -s) echo Darwin;; -m) echo arm64;; *) exit 1;; esac');
      stub('csrutil', 'printf "%s\\n" "$MAC2JB_TEST_SIP"; exit "$MAC2JB_TEST_CSR_EXIT"');
      stub('ditto', '/bin/cp -R "$1" "$2"');
      stub('chown', 'exit 0');
      stub('sync', 'exit 0');
      stub('sudo', 'echo "Unexpected privilege request in test" >&2; exit 99');
      stub('kmutil', 'printf "%s\\n" "$*" >> "$MAC2JB_TEST_CALLS"; if [[ "$MAC2JB_TEST_LOAD_EXIT" != 0 ]]; then echo "fixture: macOS refused unsigned driver" >&2; fi; exit "$MAC2JB_TEST_LOAD_EXIT"');
      if (fixture.backup) {
        fs.mkdirSync(path.join(extensions, 'usbgadget.kext'));
        fs.writeFileSync(path.join(extensions, 'usbgadget.kext/prior-driver'), 'preserve me');
      }
      const result = spawnSync('/bin/bash', [file], {encoding: 'utf8', env: {...process.env,
        MAC2JB_TEST_SIP: fixture.sip, MAC2JB_TEST_CSR_EXIT: String(fixture.csrCode || 0),
        MAC2JB_TEST_LOAD_EXIT: String(fixture.code), MAC2JB_TEST_CALLS: calls}});
      assert.equal(result.status, fixture.code, result.stdout + result.stderr);
      assert.match(result.stdout, /diagnostic only/);
      assert.ok(result.stdout.includes(fixture.sip));
      assert.equal(fs.readFileSync(calls, 'utf8').trim(), 'load -p ' + path.join(extensions, 'usbgadget.kext'));
      assert.ok(fs.existsSync(path.join(extensions, '.mac2jb-usbgadget-restart-required')));
      if (fixture.code) {
        assert.match(result.stderr, /fixture: macOS refused unsigned driver/);
        assert.match(result.stderr, /SIP status text alone does not determine compatibility/);
        assert.doesNotMatch(result.stdout, /load request accepted/);
      }
      if (fixture.backup) {
        const backup = fs.readdirSync(extensions).find(name => name.startsWith('.mac2jb-usbgadget-backup-'));
        assert.ok(backup);
        assert.equal(fs.readFileSync(path.join(extensions, backup, 'prior-driver'), 'utf8'), 'preserve me');
      }
    });
  }
});
