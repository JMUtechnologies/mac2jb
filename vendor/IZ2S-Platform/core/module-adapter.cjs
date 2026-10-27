const path = require('node:path'),
  ROOT = require('./root.cjs');
function create(id, implementations, base) {
  const marker = path.sep + 'modules' + path.sep;
  const index = base?.lastIndexOf(marker) ?? -1;
  const root = index >= 0 ? base.slice(0, index) : ROOT;
  return {
    id,
    implementations,
    load(name) {
      if (!Object.hasOwn(implementations, name))
        throw Error('Unknown module component');
      const target = implementations[name];
      if (target.startsWith('module:')) {
        const [id, component] = target.slice(7).split('/');
        return require('./components.cjs').create(root).get(id, component);
      }
      const prefix = 'modules/' + id + '/server/';
      return require(
        base && target.startsWith(prefix)
          ? path.join(base, target.slice(prefix.length))
          : path.join(root, target),
      );
    },
    async createModule(context) {
      let instance;
      return {
        async init() {},
        async start() {
          if (context.start) instance = await context.start(this);
        },
        async stop() {
          await instance?.close?.();
        },
        async dispose() {
          instance = null;
        },
      };
    },
  };
}
module.exports = { create };
