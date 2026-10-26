'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {main, verifiedSession, MINIMUM_FREE_BYTES} = require('./gui-dump.cjs');

const sufficientSpace = async () => ({bavail: MINIMUM_FREE_BYTES, bsize: 1n});
function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  fs.writeFileSync(file, JSON.stringify(value), {mode: 0o600});
}
function update(file, mutate) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8')); mutate(value); writeJSON(file, value);
}

function fixture(t, moduleBody) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mac2jb-dump-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const run = path.join(root, 'switch2-test'), engine = path.join(run, 'switch2');
  const session = 'switch2-test';
  const proofFile = path.join(engine, 'process', session + '-fs-execution-1792967562384.json');
  const report = path.join(engine, 'memory/reserved-gap-1792967392773.json');
  // Match fs-execute.main's real return shape: report belongs to the full proof,
  // while the held summary exposes only .file and a numeric .trials count.
  const summary = {session, file: proofFile, trials: 2, verified: true, restored: true,
    cleanup: {deferred: true, donor: {cleanedUp: true}},
    retainedEndpoint: {ready: true, session, socketPath: path.join(run, 'memory.sock')}};
  const resultFile = path.join(run, 'result.json'), currentFile = path.join(engine, 'fs-execution-current.json');
  writeJSON(resultFile, {platform: 2, verified: true, rpc: {mode: 'held', state: 'listening'}, fs: summary});
  writeJSON(currentFile, summary);
  writeJSON(proofFile, {session, report, verified: true,
    trials: [{verified: true, restored: true}, {verified: true, restored: true}]});
  writeJSON(report, {session, retainedMemory: {ready: true, zeroCountVerified: true},
    memoryControl: {socketPath: summary.retainedEndpoint.socketPath}});
  writeJSON(path.join(engine, 'current-acquisition.json'), {session, report});
  writeJSON(path.join(engine, 'ro/current-execution.json'), {session, report, verified: true});
  writeJSON(path.join(engine, 'ro', session + '-loader-root-copy.json'),
    {session, report, verified: true, restored: true, copy: {handle: 42}});
  const called = path.join(engine, 'called.txt'), destination = path.join(root, 'captured-code');
  fs.writeFileSync(path.join(engine, 'firmware-dump.cjs'), `
    const fs = require('node:fs'); const path = require('node:path');
    const crypto = require('node:crypto');
    const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
    module.exports.main = async proofFile => {
      fs.appendFileSync(${JSON.stringify(called)}, 'called\\n');
      const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
      const destination = process.env.NS2_FIRMWARE_DUMP_DIR;
      ${moduleBody || `
        const title = '0x0100000000000001';
        const folder = path.join(destination, title.slice(2)); fs.mkdirSync(folder, {mode:0o700});
        const inventory = Buffer.alloc(16384, 1), metadata = Buffer.from('metadata'), capture = Buffer.from('code');
        const rawFile = path.join(destination, 'ncm-system-programs.bin'); fs.writeFileSync(rawFile, inventory);
        const infoFile = path.join(folder, 'code-info.bin'); fs.writeFileSync(infoFile, metadata);
        const codeFile = path.join(folder, 'main'); fs.writeFileSync(codeFile, capture);
        const manifest = {session:proof.session, report:proof.report, fsProofFile:proofFile, complete:true,
          inventory: {total:1, rawFile, sha256:hash(inventory), keys:[{id:title}]},
          entries:[{title, status:'captured', codeInfo:{file:infoFile, sha256:hash(metadata)},
            files:[{name:'main', file:codeFile, size:capture.length, sha256:hash(capture)}]}]};
        fs.writeFileSync(path.join(destination, 'firmware-dump.json'), JSON.stringify(manifest));
        console.log('Firmware: fake copied fork capture finished');
        return {complete:true};
      `}
    };
  `, {mode: 0o600});
  return {root, run, engine, proofFile, report, called, destination, resultFile, currentFile};
}

test('captures once from the copied fork using the full original proof and verifies readback', async t => {
  const f = fixture(t), previous = process.env.NS2_FIRMWARE_DUMP_DIR;
  process.env.NS2_FIRMWARE_DUMP_DIR = '/old/environment-value';
  try {
    const result = await main([f.run, f.destination], {statfs: sufficientSpace});
    assert.equal(result.complete, true); assert.equal(result.total, 1);
    assert.equal(result.file, path.join(f.destination, 'firmware-dump.json'));
    assert.equal(fs.readFileSync(f.called, 'utf8'), 'called\n');
    assert.equal(fs.statSync(f.destination).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(f.destination, '.mac2jb-code-dump.json')).mode & 0o777, 0o600);
    const manifest = JSON.parse(fs.readFileSync(result.file));
    assert.equal(manifest.fsProofFile, f.proofFile);
    assert.equal(process.env.NS2_FIRMWARE_DUMP_DIR, '/old/environment-value');
  } finally {
    if (previous === undefined) delete process.env.NS2_FIRMWARE_DUMP_DIR;
    else process.env.NS2_FIRMWARE_DUMP_DIR = previous;
  }
});

test('resolves the real fork report layout without a report field on the held FS summary', async t => {
  const f = fixture(t);
  const summary = JSON.parse(fs.readFileSync(f.currentFile));
  const result = JSON.parse(fs.readFileSync(f.resultFile));
  assert.equal(Object.hasOwn(summary, 'report'), false);
  assert.equal(Object.hasOwn(result.fs, 'report'), false);
  assert.equal(summary.trials, 2);
  const run = await verifiedSession(f.run);
  assert.equal(run.proofFile, f.proofFile);
  assert.equal(run.reportFile, f.report);
  assert.equal(fs.existsSync(f.called), false);
});

test('refuses incomplete, closed, unrestored, or mismatched held proofs before calling the fork', async t => {
  const invalid = [
    ['unverified result', f => update(f.resultFile, row => {row.verified = false;})],
    ['closed RPC', f => update(f.resultFile, row => {row.rpc.state = 'closed';})],
    ['retired endpoint', f => update(f.currentFile, row => {row.retainedEndpoint.ready = false;})],
    ['unfinished donor cleanup', f => update(f.currentFile, row => {row.cleanup.donor.cleanedUp = false;})],
    ['missing restoration', f => update(f.proofFile, row => {row.trials[1].restored = false;})],
    ['unverified trial', f => update(f.proofFile, row => {row.trials[0].verified = false;})],
    ['pending trial', f => update(f.proofFile, row => {row.trials[0].pending = 'restore';})],
    ['only one trial', f => update(f.proofFile, row => {row.trials.pop();})],
    ['wrong session', f => update(f.proofFile, row => {row.session = 'different';})],
    ['wrong report', f => update(f.proofFile, row => {row.report = '/outside/report.json';})],
    ['mismatched acquisition report', f => update(path.join(f.engine, 'current-acquisition.json'), row => {row.report = '/outside/report.json';})],
    ['contradictory optional summary report', f => update(f.currentFile, row => {row.report = '/outside/report.json';})],
    ['unready acquisition', f => update(f.report, row => {row.retainedMemory.ready = false;})],
    ['stale acquisition pointer', f => update(path.join(f.engine, 'current-acquisition.json'), row => {row.session = 'previous-run';})],
    ['invalid loader', f => update(path.join(f.engine, 'ro/switch2-test-loader-root-copy.json'), row => {row.restored = false;})],
    ['outside proof', f => update(f.currentFile, row => {row.file = '/outside/proof.json';})]
  ];
  for (const [name, mutate] of invalid) await t.test(name, async child => {
    const f = fixture(child); mutate(f);
    await assert.rejects(main([f.run, f.destination], {statfs: sufficientSpace}));
    assert.equal(fs.existsSync(f.called), false);
    assert.equal(fs.existsSync(f.destination), false);
  });
});

test('refuses symlinked run, proof, report, destination, or destination parent without calling the fork', async t => {
  for (const location of ['run', 'proof', 'report', 'destination', 'parent']) await t.test(location, async child => {
    const f = fixture(child);
    let run = f.run, destination = f.destination;
    if (location === 'run') {
      run = path.join(f.root, 'linked-run'); fs.symlinkSync(f.run, run, 'dir');
    } else if (location === 'proof' || location === 'report') {
      const file = location === 'proof' ? f.proofFile : f.report;
      const real = file + '.real'; fs.renameSync(file, real); fs.symlinkSync(real, file);
    } else if (location === 'destination') {
      const real = path.join(f.root, 'real-destination'); fs.mkdirSync(real); fs.symlinkSync(real, destination, 'dir');
    } else {
      const real = path.join(f.root, 'real-parent'); fs.mkdirSync(real);
      const linked = path.join(f.root, 'linked-parent'); fs.symlinkSync(real, linked, 'dir');
      destination = path.join(linked, 'captured-code');
    }
    await assert.rejects(main([run, destination], {statfs: sufficientSpace}), /without symlinks/);
    assert.equal(fs.existsSync(f.called), false);
  });
});

test('never overwrites a nonempty destination or starts with less than 512 MiB free', async t => {
  await t.test('existing capture', async child => {
    const f = fixture(child); fs.mkdirSync(f.destination);
    const previous = path.join(f.destination, 'previous.bin'); fs.writeFileSync(previous, 'keep this');
    await assert.rejects(main([f.run, f.destination], {statfs: sufficientSpace}), /must be empty/);
    assert.equal(fs.readFileSync(previous, 'utf8'), 'keep this');
    assert.equal(fs.existsSync(f.called), false);
  });
  await t.test('insufficient free space', async child => {
    const f = fixture(child);
    await assert.rejects(main([f.run, f.destination], {
      statfs: async () => ({bavail: MINIMUM_FREE_BYTES - 1n, bsize: 1n})
    }), /512 MiB/);
    assert.equal(fs.existsSync(f.called), false);
    assert.deepEqual(fs.readdirSync(f.destination), []);
  });
});

test('retains partial captures and does not replay a failed or uncertain operation', async t => {
  const f = fixture(t, `
    fs.writeFileSync(path.join(destination, 'partial-main'), 'partial bytes');
    throw Error('Native request timed out; it was not replayed');
  `);
  await assert.rejects(main([f.run, f.destination], {statfs: sufficientSpace}), /timed out/);
  assert.equal(fs.readFileSync(f.called, 'utf8'), 'called\n');
  assert.equal(fs.readFileSync(path.join(f.destination, 'partial-main'), 'utf8'), 'partial bytes');
  await assert.rejects(main([f.run, f.destination], {statfs: sufficientSpace}), /must be empty/);
  assert.equal(fs.readFileSync(f.called, 'utf8'), 'called\n');
});

test('rejects incomplete manifests and corrupt captured bytes after the fork returns', async t => {
  for (const alteration of ['incomplete', 'corrupt']) await t.test(alteration, async child => {
    const f = fixture(child);
    const moduleFile = path.join(f.engine, 'firmware-dump.cjs');
    const source = fs.readFileSync(moduleFile, 'utf8');
    fs.writeFileSync(moduleFile, source.replace('return {complete:true};', alteration === 'incomplete'
      ? `manifest.complete = false; fs.writeFileSync(path.join(destination, 'firmware-dump.json'), JSON.stringify(manifest)); return {complete:true};`
      : `fs.writeFileSync(codeFile, 'bad!'); return {complete:true};`));
    await assert.rejects(main([f.run, f.destination], {statfs: sufficientSpace}),
      alteration === 'incomplete' ? /complete verified inventory/ : /SHA-256/);
    assert.equal(fs.readFileSync(f.called, 'utf8'), 'called\n');
    assert.equal(fs.existsSync(path.join(f.destination, 'firmware-dump.json')), true);
  });
});

test('CLI reports a failed proof and exits once without launching the copied module', t => {
  const f = fixture(t); update(f.resultFile, row => {row.rpc.state = 'closed';});
  assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, 'gui-dump.cjs'), f.run, f.destination],
    {stdio: 'pipe'}), error => error.status === 1 && /Firmware:.*held RPC/.test(error.stderr.toString()) &&
      /not retried/.test(error.stderr.toString()));
  assert.equal(fs.existsSync(f.called), false);
});
