// Session lifecycle hooks are declared by modules, never by application names.
const registry = require('./modules.cjs');
async function create({
  root = require('./root.cjs'),
  context = {},
  inventory = () => registry.list(root),
  load = (id, name) => require('./components.cjs').create(root).get(id, name),
} = {}) {
  let rows = [],
    available = true,
    storage,
    closed = false,
    pending = null,
    running = null,
    closePromise = null;
  const instances = new Map(),
    owners = new Map(),
    sequences = new Map(),
    errors = [];
  async function refresh() {
    rows = (await inventory()).modules.filter(
      (m) => m.descriptor.server?.sessionHook,
    );
  }
  await refresh();
  function requested(row, state) {
    const a = row.descriptor.server.activation;
    if (
      !a ||
      !Number.isInteger(a.offset) ||
      !Number.isInteger(a.sequenceOffset) ||
      a.offset < 0 ||
      a.sequenceOffset < 0 ||
      a.offset + 4 > state.length ||
      a.sequenceOffset + 4 > state.length
    )
      return false;
    const value = state.readFloatLE(a.offset),
      seq = state.readFloatLE(a.sequenceOffset);
    if (
      !Number.isInteger(seq) ||
      seq < 1 ||
      !a.values.includes(value) ||
      sequences.get(row.id) === seq
    )
      return false;
    sequences.set(row.id, seq);
    return true;
  }
  async function consume(state) {
    // Independent modules may use the same console video slot. Join the old
    // owner before handing it over; common controls go only to the active owner.
    if (available) for (const row of rows) {
      const group = row.descriptor.server.activation?.exclusiveGroup;
      if (!group || !requested(row, state) || owners.get(group) === row.id) continue;
      const previous = owners.get(group);
      try {
        await instances.get(previous)?.suspend?.();
        owners.set(group, row.id);
      } catch (e) {
        errors.push({ id: previous, phase: 'handover', error: e.message });
        return;
      }
    }
    for (const row of rows) {
      const group = row.descriptor.server.activation?.exclusiveGroup;
      if (group && owners.get(group) !== row.id) continue;
      let instance = instances.get(row.id);
      if (!instance) {
        if (!available || (!group && !requested(row, state))) continue;
        try {
          const factory = await load(row.id, row.descriptor.server.sessionHook);
          instance = await factory.create(context);
          instance.setVideoStorage?.(storage);
          instance.setAvailable?.(available);
          instances.set(row.id, instance);
        } catch (e) {
          errors.push({ id: row.id, error: e.message });
          continue;
        }
      }
      try {
        instance.onState?.(state);
      } catch (e) {
        errors.push({ id: row.id, error: e.message });
      }
    }
  }
  function onState(state) {
    if (closed) return;
    pending = Buffer.from(state);
    if (running) return;
    running = (async () => {
      while (pending && !closed) {
        const value = pending;
        pending = null;
        await consume(value);
      }
    })()
      .catch((e) => errors.push({ error: e.message }))
      .finally(() => (running = null));
  }
  return {
    onState,
    refresh,
    errors,
    setVideoStorage: (s) => {
      storage = s;
      for (const v of instances.values()) v.setVideoStorage?.(s);
    },
    setAvailable: (v) => {
      available = !!v;
      for (const i of instances.values()) i.setAvailable?.(available);
    },
    async pollInterval() {
      const values = await Promise.all(
        [...instances.values()].map((v) => v.pollInterval?.() || 50),
      );
      return Math.max(50, ...values);
    },
    async suspend() {
      pending = null;
      await running;
      await Promise.all([...instances.values()].map((v) => v.suspend?.()));
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      pending = null;
      closePromise = (async () => {
        await running;
        const owned = [...instances.entries()];
        const results = await Promise.allSettled(owned.map(([, value]) => value.close?.()));
        instances.clear();
        const failed = results.flatMap((result, index) => {
          if (result.status !== 'rejected') return [];
          const id = owned[index][0];
          errors.push({ id, phase: 'close', error: result.reason?.message || String(result.reason) });
          return [{ id, error: result.reason }];
        });
        if (failed.length) throw new AggregateError(failed.map(row => row.error), 'Module shutdown unconfirmed: ' + failed.map(row => row.id).join(', '));
      })();
      return closePromise;
    },
  };
}
module.exports = { create };
