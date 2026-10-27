const fs = require('node:fs/promises'),
  path = require('node:path'),
  D = require('../core/descriptors.cjs');
async function main(file) {
  if (!file) throw Error('Pass a descriptor JSON or .izm file');
  const bytes = await fs.readFile(file);
  if (file.endsWith('.izm')) return require('../core/archive.cjs').inspect(bytes).descriptor;
  const d = JSON.parse(bytes);
  return d.format === 'izlauncher.module'
    ? D.moduleDescriptor(d)
    : D.validate(d, d.format?.replace('izlauncher.', ''));
}
if (require.main === module)
  main(process.argv[2])
    .then((d) => console.log('OK ' + d.id))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
module.exports = { main };
