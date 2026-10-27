const fs = require('node:fs/promises'),
  path = require('node:path'),
  archive = require('../core/archive.cjs'),
  ROOT = require('../core/root.cjs');
async function main(args = process.argv.slice(2)) {
  const directories = args.length
    ? [path.resolve(args[0])]
    : await fs
        .readdir(path.join(ROOT, 'modules'), { withFileTypes: true })
        .then((es) =>
          es.filter((e) => e.isDirectory()).map((e) => path.join(ROOT, 'modules', e.name)),
        );
  const sizes = [];
  for (const folder of directories) {
    const d = JSON.parse(await fs.readFile(path.join(folder, 'module.json'))),
      bytes = await archive.pack(folder),
      target = path.resolve(args[1] || path.join(folder, d.id + '.izm'));
    await fs.writeFile(target + '.tmp', bytes);
    await fs.rename(target + '.tmp', target);
    const pkg = archive.inspect(bytes);
    sizes.push({
      id: d.id,
      archiveBytes: bytes.length,
      expandedBytes: pkg.expandedBytes,
      switchBytes: pkg.files
        .filter((f) => d.switch?.files.includes(f.name))
        .reduce((n, f) => n + f.bytes.length, 0),
    });
  }
  console.log(JSON.stringify(sizes, null, 2));
  return sizes;
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  });
module.exports = { main };
