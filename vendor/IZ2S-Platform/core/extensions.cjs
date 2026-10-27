const fs = require('node:fs/promises'),
  sync = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  Module = require('node:module');
const { scan, assert, ID } = require('./descriptors.cjs');
function catalog(root) {
  return {
    engines: scan(root, 'engine'),
    shells: scan(root, 'shell'),
    profiles: scan(root, 'profile'),
  };
}
// Capture source before activation. Relative JS imports remain pinned to these bytes
// even if the source folder changes while the session is running.
async function pin(root, kind, id) {
  assert(ID.test(id), 'Invalid extension id');
  const found = scan(root, kind).items.find((x) => x.id === id);
  assert(found, 'Extension not available: ' + id);
  const sources = new Map(),
    modes = new Map();
  async function walk(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (
        e.name.startsWith('.') ||
        ['runs', 'data', 'node_modules'].includes(e.name)
      )
        continue;
      assert(!e.isSymbolicLink(), 'Extension links are not allowed');
      const f = path.join(dir, e.name);
      if (e.isDirectory()) await walk(f);
      else if (e.isFile()) {
        sources.set(f, await fs.readFile(f));
        modes.set(f, (await fs.stat(f)).mode & 0o777);
      }
    }
  }
  await walk(found.folder);
  const hash = crypto.createHash('sha256');
  for (const [name, b] of [...sources].sort())
    hash.update(path.relative(found.folder, name)).update(b);
  const fingerprint = hash.digest('hex'),
    cache = new Map();
  function load(file) {
    file = require.resolve(file);
    if (!sources.has(file)) return require(file);
    if (cache.has(file)) return cache.get(file).exports;
    if (file.endsWith('.json')) return JSON.parse(sources.get(file));
    const m = new Module(file, module);
    cache.set(file, m);
    m.filename = file;
    m.paths = Module._nodeModulePaths(path.dirname(file));
    m.require = (name) =>
      load(require.resolve(name, { paths: [path.dirname(file)] }));
    m._compile(sources.get(file).toString('utf8'), file);
    return m.exports;
  }
  return {
    descriptor: found,
    fingerprint,
    load: () => load(path.join(found.folder, found.entry)),
    bytes: (relative) => sources.get(path.join(found.folder, relative)),
    async materialize(destination) {
      await fs.mkdir(destination, { recursive: true });
      for (const [name, bytes] of sources) {
        const out = path.join(destination, path.relative(found.folder, name));
        await fs.mkdir(path.dirname(out), { recursive: true });
        try {
          await fs.writeFile(out, bytes, {
            flag: 'wx',
            mode: modes.get(name) || 0o600,
          });
        } catch (e) {
          if (e.code !== 'EEXIST') throw e;
          const old = await fs.readFile(out);
          assert(old.equals(bytes), 'Pinned extension cache was modified');
        }
      }
      return destination;
    },
  };
}
function watch(root, onChange, { interval = 1500 } = {}) {
  let stamp = '';
  const timer = setInterval(() => {
    try {
      const value = catalog(root),
        next = JSON.stringify(value);
      if (next !== stamp) {
        stamp = next;
        onChange(value);
      }
    } catch (e) {
      onChange({ error: e.message });
    }
  }, interval);
  timer.unref();
  return { close: () => clearInterval(timer) };
}
module.exports = { catalog, pin, watch };
