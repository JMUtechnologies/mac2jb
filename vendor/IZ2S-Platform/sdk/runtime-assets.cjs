// Static SDK check: inspect packaged source without executing an extension.
const path = require('node:path').posix;
function check(pkg) {
  const names = new Set(pkg.files.map(f => f.name)), errors = [];
  for (const file of pkg.files) {
    if (!file.name.startsWith('server/') || !/\.[cm]?js$/.test(file.name)) continue;
    const source = file.bytes.toString('utf8');
    for (const match of source.matchAll(/path\.(?:join|resolve)\(\s*__dirname\s*,((?:\s*['"][^'"\r\n]*['"]\s*,?)+)\s*\)/g)) {
      const parts = [...match[1].matchAll(/['"]([^'"]*)['"]/g)].map(m => m[1]);
      const target = path.normalize(path.join(path.dirname(file.name), ...parts));
      // Writable runtime directories have no extension. Dynamically computed paths
      // are deliberately left to module integration tests, not guessed here.
      if (path.extname(target) && !names.has(target))
        errors.push({ file: file.name, error: 'Missing packaged runtime asset: ' + target });
    }
  }
  return errors;
}
module.exports = { check };
