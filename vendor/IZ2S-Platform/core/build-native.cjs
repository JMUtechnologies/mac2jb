const modulePaths = require('./module-paths.cjs');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  { execFile } = require('node:child_process'),
  { promisify } = require('node:util');
const { ID, relative, assert } = require('./descriptors.cjs'),
  run = promisify(execFile),
  tasks = new Map();
async function build(root, id, source) {
  assert(ID.test(id) && process.platform === 'linux', 'Unsupported native helper');
  const recipe = JSON.parse(await fs.readFile(path.join(source, 'build.json')));
  assert(
    recipe.format === 'izlauncher.native-build' &&
      recipe.version === 1 &&
      Array.isArray(recipe.sources) &&
      Array.isArray(recipe.args),
    'Invalid native recipe',
  );
  recipe.sources.forEach(relative);
  assert(recipe.dependencies===undefined||Array.isArray(recipe.dependencies),'Invalid native build dependencies');
  (recipe.dependencies||[]).forEach(relative);
  relative(recipe.output);
  assert(!recipe.output.includes('/'), 'Output must be a filename');
  const hash = crypto.createHash('sha256').update(JSON.stringify(recipe)).update(process.arch);
  for (const name of [...new Set([...recipe.sources,...(recipe.dependencies||[])])]) hash.update(await fs.readFile(path.join(source, name)));
  const digest = hash.digest('hex'),
    bin = path.join(modulePaths.home(root, id), 'runtime/bin'),
    dir = path.join(bin, digest),
    output = path.join(dir, recipe.output);
  if (
    (await fs.readFile(output + '.sha', 'utf8').then(
      (s) => s === digest,
      () => false,
    )) &&
    (await fs.access(output).then(
      () => true,
      () => false,
    ))
  )
    return output;
  const key = output + digest;
  if (!tasks.has(key))
    tasks.set(
      key,
      (async () => {
        await fs.mkdir(dir, { recursive: true });
        const temporary = output + '.' + crypto.randomUUID() + '.tmp';
        try {
          const flags = recipe.pkgConfig?.length
            ? (await run('pkg-config', ['--cflags', '--libs', ...recipe.pkgConfig])).stdout
                .trim()
                .split(/\s+/)
            : [];
          await run(
            process.env.CC || 'cc',
            [...recipe.args, ...recipe.sources.map(name => path.join(source, name)), '-o', temporary, ...flags],
            { timeout: 60000 },
          );
          await fs.chmod(temporary, 0o700);
          await fs.rename(temporary, output);
          await fs.writeFile(output + '.sha', digest);
          // Compatibility tools may inspect the latest build. Runtime callers
          // receive the immutable hash path above, never this mutable alias.
          const alias=path.join(bin,recipe.output),link=alias+'.'+crypto.randomUUID()+'.tmp';
          try{await fs.symlink(path.relative(bin,output),link);await fs.rename(link,alias);}finally{await fs.rm(link,{force:true});}
          return output;
        } finally {
          await fs.rm(temporary, { force: true });
        }
      })().finally(() => tasks.delete(key)),
    );
  return tasks.get(key);
}
module.exports = { build };
