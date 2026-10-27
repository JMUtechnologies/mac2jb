const { assert } = require('./descriptors.cjs');
function validateNative(native) {
  for (const method of [
    'call',
    'callAddress',
    'verifyFunction',
    'exchange',
    'read',
    'readMany',
    'write',
    'writeCall',
    'query',
    'stop',
  ])
    assert(typeof native?.[method] === 'function', 'Engine missing session method: ' + method);
  return native;
}
function engine(adapter, context) {
  assert(typeof adapter.plan === 'function', 'Engine adapter must export plan');
  let state = 'created',
    handle;
  return {
    async prepare() {
      assert(state === 'created', 'Engine already prepared');
      handle = await adapter.plan(context.settings || {}, context);
      state = 'prepared';
      return handle;
    },
    async start() {
      assert(state === 'prepared', 'Prepare engine first');
      assert(typeof context.launch === 'function', 'Missing process launcher');
      state = 'running';
      return context.launch(handle);
    },
    async stop() {
      if (state === 'stopped') return;
      try {
        await context.stop?.();
      } finally {
        state = 'stopped';
      }
    },
    get state() {
      return state;
    },
  };
}
module.exports = { validateNative, engine };
