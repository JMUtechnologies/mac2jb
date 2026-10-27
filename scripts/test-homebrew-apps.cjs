'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pin, verifyOverlay, installOverlays} = require('./prepare-homebrew-apps.cjs');
const repository = path.resolve(__dirname, '..');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mac2jb-ftpd-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.cpSync(path.join(repository, 'assets/homebrew-apps/ftpd-sb'), path.join(root, 'assets/homebrew-apps/ftpd-sb'), {recursive: true});
  fs.mkdirSync(path.join(root, 'packaging'));
  for (const name of ['ftpd-sb-v0.1.0-SHA256SUMS', 'ftpd-sb-v0.1.0-release-SHA256SUMS', 'ftpd-sb-v0.1.0-provenance.json'])
    fs.copyFileSync(path.join(repository, 'packaging', name), path.join(root, 'packaging', name));
  return {root, app: path.join(root, 'assets/homebrew-apps/ftpd-sb')};
}

test('the overlay is the exact released ftpd-sb v0.1.0 app and retains its upstream notice', () => {
  const app = verifyOverlay(repository);
  assert.equal(app.manifest.size, 20);
  assert.equal(app.provenance.commit, pin.commit);
  assert.equal(app.provenance.asset.digest, 'sha256:' + pin.archiveSha256);
  assert.match(fs.readFileSync(path.join(app.directory, 'README.md'), 'utf8'), /No blanket license\s+has been assigned to this package/);
});

for (const launcher of ['HBLauncher', 'GPUBrewLauncher']) test(launcher+' installs an exact overlay without changing upstream apps or integrity manifest', t => {
  const f = fixture(t), apps = path.join(f.root, 'runtime/vendor', launcher, 'apps');
  fs.cpSync(path.join(repository, 'vendor', launcher, 'apps'), apps, {recursive: true});
  const originals = fs.readdirSync(apps).sort().map(name => [name, fs.readFileSync(path.join(apps, name, 'app.json'))]);
  const manifest = path.join(repository, 'packaging', launcher+(launcher === 'HBLauncher' ? '-v0.2.0' : '')+'-SHA256SUMS');
  const upstreamManifest = fs.readFileSync(manifest);
  assert.deepEqual(installOverlays(f.root, apps), ['ftpd-sb']);
  for (const [name, bytes] of originals) assert.deepEqual(fs.readFileSync(path.join(apps, name, 'app.json')), bytes);
  assert.deepEqual(fs.readdirSync(apps).sort(), [...originals.map(([name]) => name), 'ftpd-sb'].sort());
  assert.deepEqual(fs.readFileSync(manifest), upstreamManifest);
  for (const name of verifyOverlay(f.root).manifest.keys())
    assert.deepEqual(fs.readFileSync(path.join(apps, 'ftpd-sb', name)), fs.readFileSync(path.join(f.app, name)));
});

test('changed release data and changed pins are rejected before installation', t => {
  for (const target of ['app.comp.spv', 'metadata']) {
    const f = fixture(t);
    if (target === 'metadata') {
      const file = path.join(f.root, 'packaging/ftpd-sb-v0.1.0-provenance.json');
      const value = JSON.parse(fs.readFileSync(file)); value.commit = 'wrong'; fs.writeFileSync(file, JSON.stringify(value));
    } else fs.appendFileSync(path.join(f.app, target), 'changed');
    assert.throws(() => verifyOverlay(f.root), /Changed ftpd-sb|Unexpected ftpd-sb/);
  }
});

test('extra files, runtime directories and symlinks cannot enter the packaged app', t => {
  for (const target of ['unlisted.txt', 'session.log', 'runs', 'symlink']) {
    const f = fixture(t);
    if (target === 'runs') fs.mkdirSync(path.join(f.app, target));
    else if (target === 'symlink') {
      fs.unlinkSync(path.join(f.app, 'README.md'));
      fs.symlinkSync(path.join(repository, 'README.md'), path.join(f.app, 'README.md'));
    } else fs.writeFileSync(path.join(f.app, target), 'unwanted');
    assert.throws(() => verifyOverlay(f.root), /unexpected files|Excluded|symlinks/);
  }
});

test('an existing destination app is preserved instead of merged or overwritten', t => {
  const f = fixture(t), apps = path.join(f.root, 'runtime/apps');
  fs.mkdirSync(path.join(apps, 'ftpd-sb'), {recursive: true});
  fs.writeFileSync(path.join(apps, 'ftpd-sb/existing.bin'), 'keep');
  assert.throws(() => installOverlays(f.root, apps), /Refusing to overwrite/);
  assert.equal(fs.readFileSync(path.join(apps, 'ftpd-sb/existing.bin'), 'utf8'), 'keep');
  assert.deepEqual(fs.readdirSync(path.join(apps, 'ftpd-sb')), ['existing.bin']);
});

test('the published checksum file and pinned per-file manifest cannot be replaced', t => {
  for (const name of ['ftpd-sb-v0.1.0-release-SHA256SUMS', 'ftpd-sb-v0.1.0-SHA256SUMS']) {
    const f = fixture(t); fs.appendFileSync(path.join(f.root, 'packaging', name), 'changed');
    assert.throws(() => verifyOverlay(f.root), /checksum changed|manifest changed/);
  }
});
