#!/usr/bin/env node
'use strict';
// Install application overlays after copying an unchanged launcher snapshot.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pin = Object.freeze({
  version: '0.1.0', commit: 'ab2123cfb97d492264bf6609cb410e285d6d9b5f',
  archiveSha256: 'e3c0e0387d2cdaa6b9345cd8e601cab584f7e46c5f16a285a39c368b5d33140e',
  manifestSha256: '0f085741f5707a41458be681eb7d2241cbc49f0574f5b0a4b3abba907f20214b',
  checksumAssetSha256: 'a162967e19d004564301f0607690ebae1cea7b3acf402345016607e9409b2381'
});
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const check = (value, message) => {if (!value) throw Error(message);};
const blockedNames = new Set(['.git', '.DS_Store', '__MACOSX', 'runs', 'dumps', 'node_modules', '__pycache__']);
const blockedSuffix = /\.(?:log|pyc|o|dylib|bak|zip|tar|gz)$/i;

function regularDirectory(directory) {
  const info = fs.lstatSync(directory);
  check(info.isDirectory() && !info.isSymbolicLink(), 'Expected a regular app directory: ' + directory);
}
function tree(directory) {
  regularDirectory(directory);
  const files = [], folders = [];
  function walk(folder, prefix = '') {
    for (const entry of fs.readdirSync(folder).sort()) {
      const relative = prefix + entry, file = path.join(folder, entry), info = fs.lstatSync(file);
      check(!blockedNames.has(entry) && !entry.startsWith('._') && !/[\\\x00-\x1f]/.test(entry) &&
        !blockedSuffix.test(entry), 'Excluded local/runtime/archive app file: ' + relative);
      check(!info.isSymbolicLink(), 'App overlays cannot contain symlinks: ' + relative);
      if (info.isDirectory()) {folders.push(relative); walk(file, relative + '/');}
      else {check(info.isFile(), 'App overlays must contain only regular files: ' + relative); files.push(relative);}
    }
  }
  walk(directory);
  return {files, folders};
}
function readManifest(root) {
  const file = path.join(root, 'packaging/ftpd-sb-v0.1.0-SHA256SUMS');
  const bytes = fs.readFileSync(file);
  check(hash(bytes) === pin.manifestSha256, 'The pinned ftpd-sb integrity manifest changed.');
  const manifest = new Map();
  for (const line of bytes.toString('utf8').trim().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    check(match && !path.isAbsolute(match[2]) && !match[2].split('/').some(part => !part || part === '.' || part === '..') &&
      !/[\\\x00-\x1f]/.test(match[2]) && !manifest.has(match[2]), 'Unsafe or duplicate ftpd-sb manifest path.');
    manifest.set(match[2], match[1]);
  }
  return manifest;
}
function verifyFiles(directory, manifest) {
  const actual = tree(directory), expected = [...manifest.keys()].sort();
  check(JSON.stringify(actual.files.sort()) === JSON.stringify(expected),
    'The ftpd-sb app contains missing or unexpected files.');
  const folders = new Set();
  for (const file of expected) {
    let folder = path.posix.dirname(file);
    while (folder !== '.') {folders.add(folder); folder = path.posix.dirname(folder);}
  }
  check(JSON.stringify(actual.folders.sort()) === JSON.stringify([...folders].sort()),
    'The ftpd-sb app contains unexpected directories.');
  for (const [file, expectedHash] of manifest)
    check(hash(fs.readFileSync(path.join(directory, file))) === expectedHash, 'Changed ftpd-sb release file: ' + file);
}
function verifyOverlay(root = path.resolve(__dirname, '..')) {
  const directory = path.join(root, 'assets/homebrew-apps/ftpd-sb'), manifest = readManifest(root);
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'packaging/ftpd-sb-v0.1.0-provenance.json')));
  check(provenance.version === pin.version && provenance.commit === pin.commit && provenance.fileCount === manifest.size &&
    provenance.asset?.digest === 'sha256:' + pin.archiveSha256 && provenance.asset?.size === 103460 &&
    provenance.publishedChecksums?.digest === 'sha256:' + pin.checksumAssetSha256 &&
    provenance.integrityManifestSha256 === pin.manifestSha256, 'Unexpected ftpd-sb release provenance.');
  const published = fs.readFileSync(path.join(root, 'packaging/ftpd-sb-v0.1.0-release-SHA256SUMS'));
  check(hash(published) === pin.checksumAssetSha256 &&
    published.toString('utf8').trim() === pin.archiveSha256 + '  ftpd-sb-v0.1.0.zip',
    'The published ftpd-sb archive checksum changed.');
  verifyFiles(directory, manifest);
  const app = JSON.parse(fs.readFileSync(path.join(directory, 'app.json')));
  check(app.format === 'hblauncher.gpu-app' && app.abi === 1 && app.id === 'ftpd-sb' && app.version === pin.version &&
    app.sdk?.version === 1 && JSON.stringify(app.sdk.services) === '["ftp"]' && app.sdk.ftpPort === 5000,
    'Unexpected ftpd-sb app or SDK manifest.');
  return {directory, manifest, provenance};
}
function installOverlays(root, appsDirectory) {
  const verified = verifyOverlay(root), overlays = path.join(root, 'assets/homebrew-apps');
  regularDirectory(overlays); regularDirectory(appsDirectory);
  const entries = fs.readdirSync(overlays).sort();
  for (const name of entries) {
    check(/^[a-z0-9][a-z0-9-]{0,47}$/.test(name), 'Invalid homebrew app overlay name: ' + name);
    tree(path.join(overlays, name));
    try {fs.lstatSync(path.join(appsDirectory, name)); throw Error('Refusing to overwrite an existing launcher app: ' + name);}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  for (const name of entries)
    fs.cpSync(path.join(overlays, name), path.join(appsDirectory, name), {recursive: true, errorOnExist: true, force: false});
  verifyFiles(path.join(appsDirectory, 'ftpd-sb'), verified.manifest);
  return entries;
}
function main(args = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..');
  if (args.length === 1 && args[0] === '--check') {
    const checked = verifyOverlay(root);
    console.log('ftpd-sb v0.1.0: ' + checked.manifest.size + ' exact published app files verified.');
    return;
  }
  check(args.length === 2 && args[0] === '--install', 'Usage: prepare-homebrew-apps.cjs --check | --install RUNTIME_APPS_DIRECTORY');
  const installed = installOverlays(root, path.resolve(args[1]));
  console.log('Installed homebrew app overlays: ' + installed.join(', '));
}
module.exports = {pin, tree, verifyOverlay, verifyFiles, installOverlays};
if (require.main === module) {try {main();} catch (error) {console.error(error.message); process.exitCode = 1;}}
