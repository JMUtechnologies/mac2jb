const path = require('node:path'),
  fs = require('node:fs'),
  { scan, assert, relative } = require('../core/descriptors.cjs');
function create(ROOT = require('../core/root.cjs')) {
  const DEFAULT = 'izmysh';
  function find(id = DEFAULT) {
    const result = scan(ROOT, 'engine'),
      value = result.items.find((x) => x.id === id);
    assert(value, 'Unknown/unavailable engine: ' + id);
    return value;
  }
  function list() {
    return scan(ROOT, 'engine').items.map((d) => ({
      ...d,
      manifest: undefined,
      arity: d.bootstrap?.arity,
      bootstrap: d.bootstrap?.file,
      bootstrapDescriptor: d.bootstrap,
      availableIn: [
        'original',
        ...scan(ROOT, 'shell')
          .items.filter((shell) => d.modes.includes('izlauncher'))
          .map((shell) => shell.id),
      ],
      menu: readMenu(d),
      settings: d.defaultSettings || {},
    }));
  }
  function readMenu(d) {
    try {
      return JSON.parse(fs.readFileSync(path.join(d.folder, 'menu.json')));
    } catch {
      return {
        title: d.name,
        defaultAction: 'launch',
        sourceSetup: !!d.bootstrap,
      };
    }
  }
  function adapter(id = DEFAULT) {
    const d = find(id);
    assert(d.supported, 'Engine platform unsupported');
    assert(
      d.installed !== false,
      'Download or manually install the original engine first',
    );
    return require(path.join(d.folder, d.entry));
  }
  function select(id = DEFAULT, value = {}, installation = {}) {
    const d = find(id),
      manifest = {
        ...d,
        bootstrap: d.bootstrap?.file,
        arity: d.bootstrap?.arity,
        availableIn: d.modes,
      },
      settings = { ...d.defaultSettings, ...value },
      installSlot = require('../core/session/install-slot.cjs').resolve(
        installation.installSlot,
        d.bootstrap?.installSlot ?? 0,
      );
    return {
      id: d.id,
      folder: d.folder,
      bootstrapDescriptor: d.bootstrap,
      sourcePlan() {
        return {
          loaderId: d.id,
          bootstrap:
            d.bootstrap && d.installed !== false
              ? {
                  file: path.join(d.folder, d.bootstrap.file),
                  saveName: d.bootstrap.saveName,
                  sourceSlot: installSlot,
                  arity: d.bootstrap.arity,
                  loaderId: d.id,
                }
              : null,
          startup: { sourceSetup: !!d.bootstrap, preloaded: !d.bootstrap },
        };
      },
      manifest,
      menu: readMenu(d),
      settings,
      async plan(options) {
        assert(
          d.installed !== false,
          'Download or manually install the original engine first',
        );
        const pinned = await require('../core/extensions.cjs').pin(
            ROOT,
            'engine',
            id,
          ),
          a = pinned.load(),
          plan = await a.plan(settings, options);
        const cache = path.join(ROOT, 'data/extensions', pinned.fingerprint),
          folder = await pinned.materialize(path.join(cache, 'engines', id)),
          af = require('node:fs/promises');
        for (const shared of ['common.cjs', 'extend-native.cjs', 'index.cjs']) {
          await af.copyFile(
            path.join(ROOT, 'engines', shared),
            path.join(cache, 'engines', shared),
          );
        }
        for (const name of ['core', 'sdk', 'modules', 'profiles', 'hardware', 'shells'])
          try {
            await af.symlink(
              path.relative(cache, path.join(ROOT, name)),
              path.join(cache, name),
              'dir',
            );
          } catch (e) {
            if (e.code !== 'EEXIST') throw e;
          }
        const relocate = (value) =>
          typeof value === 'string' &&
          (value === d.folder || value.startsWith(d.folder + path.sep))
            ? folder + value.slice(d.folder.length)
            : Array.isArray(value)
              ? value.map(relocate)
              : value && typeof value === 'object'
                ? Object.fromEntries(
                    Object.entries(value).map(([k, v]) => [k, relocate(v)]),
                  )
                : value;
        Object.assign(plan, relocate(plan));
        plan.extensionFingerprint = pinned.fingerprint;
        plan.env = {
          ...plan.env,
          IZ2S_ROOT: ROOT,
          IZ15_ROOT: ROOT,
          IZ15_ENGINE_DIGEST: pinned.fingerprint,
          IZ15_ENGINE_FOLDER: folder,
          IZ15_ENGINE_WORKSPACE: path.join(folder, 'upstream'),
        };
        if (plan.bootstrap)
          Object.assign(plan.bootstrap, {
            file: path.join(folder, d.bootstrap.file),
            saveName: d.bootstrap.saveName,
            sourceSlot: installSlot,
            arity: d.bootstrap.arity,
          });
        return plan;
      },
      connectSteps: require('./common.cjs').connectSteps,
    };
  }
  function available(id, runtime) {
    return runtime === 'original'
      ? find(id).modes.includes('original')
      : find(id).modes.includes('izlauncher') &&
          scan(ROOT, 'shell').items.some(
            (s) => s.id === runtime && s.supported,
          );
  }
  function transport(id, options) {
    const d = find(id);
    assert(d.modes.includes('izlauncher'), 'Engine has no shell transport');
    relative(d.transport);
    return require(path.join(d.folder, d.transport)).create(options);
  }
  return {
    DEFAULT,
    list,
    select,
    available,
    transport,
    adapter,
    plan: (id, value, options) => select(id, value).plan(options),
    get IDS() {
      return scan(ROOT, 'engine').items.map((d) => d.id);
    },
  };
}
module.exports = create();
module.exports.create = create;
