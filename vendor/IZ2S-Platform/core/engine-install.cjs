const fs = require('node:fs/promises'),
  sync = require('node:fs'),
  path = require('node:path');
const crypto = require('node:crypto'),
  { execFile } = require('node:child_process');
const run = require('node:util').promisify(execFile);
const jobs = new Map();
function status(folder, descriptor) {
  if (!descriptor.installation) return { installed: true, bundled: true };
  const target = path.join(folder, 'upstream');
  try {
    for (const name of descriptor.installation.requiredFiles)
      if (!sync.statSync(path.join(target, name)).isFile())
        throw Error('Missing ' + name);
    const hash = crypto
      .createHash('sha256')
      .update(sync.readFileSync(path.join(folder, descriptor.bootstrap.file)))
      .digest('hex');
    if (hash !== descriptor.bootstrap.sha256)
      throw Error('Bootstrap differs from the supported upstream revision');
    return { installed: true, bundled: false, folder: target };
  } catch (error) {
    return {
      installed: false,
      bundled: false,
      folder: target,
      error:
        error.code === 'ENOENT'
          ? 'Original engine is not installed'
          : error.message,
    };
  }
}
async function download(root, id, { execute = run } = {}) {
  if (jobs.has(id)) return jobs.get(id);
  const task = (async () => {
    const { scan } = require('./descriptors.cjs'),
      d = scan(root, 'engine').items.find((e) => e.id === id);
    if (!d?.installation) throw Error('This engine is bundled or unknown');
    if (d.installed) return { ok: true, alreadyInstalled: true };
    if (
      !/^https:\/\/(github\.com|gitlab\.com)\/[\w.-]+\/[\w.-]+$/.test(
        d.upstream.repository,
      ) ||
      !/^[a-f0-9]{40}$/.test(d.upstream.revision)
    )
      throw Error('Invalid official engine source');
    const stage = path.join(d.folder, '.download-' + crypto.randomUUID()),
      target = path.join(d.folder, 'upstream');
    await fs.mkdir(stage);
    const git = async (args) =>
      execute('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
        timeout: 180000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    try {
      await git(['init', '--quiet', stage]);
      await git([
        '-C',
        stage,
        'fetch',
        '--quiet',
        '--depth=1',
        d.upstream.repository,
        d.upstream.revision,
      ]);
      await git(['-C', stage, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);
      const hash = crypto
        .createHash('sha256')
        .update(
          await fs.readFile(path.join(stage, d.installation.bootstrapPath)),
        )
        .digest('hex');
      if (hash !== d.bootstrap.sha256)
        throw Error('Downloaded bootstrap checksum mismatch');
      for (const name of d.installation.requiredFiles)
        if (!(await fs.stat(path.join(stage, name))).isFile())
          throw Error('Original engine is incomplete: ' + name);
      const entries = await fs.readdir(target).catch((e) => {
        if (e.code === 'ENOENT') return [];
        throw e;
      });
      if (entries.some((n) => !['README.md', '.gitkeep'].includes(n)))
        throw Error(
          'The manual engine folder contains files; keep them and validate instead of overwriting',
        );
      // Preserve the empty manual placeholder rather than deleting user sources.
      if (entries.length)
        await fs.rename(
          target,
          path.join(d.folder, '.placeholder-' + crypto.randomUUID()),
        );
      else
        await fs.rmdir(target).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
        });
      await fs.rename(stage, target);
      await fs.writeFile(
        path.join(d.folder, '.engine-install.json'),
        JSON.stringify(
          {
            repository: d.upstream.repository,
            revision: d.upstream.revision,
            installedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
      return { ok: true, installed: true };
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
  })();
  jobs.set(id, task);
  try {
    return await task;
  } finally {
    jobs.delete(id);
  }
}
module.exports = { status, download };
