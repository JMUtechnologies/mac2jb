const fs = require('node:fs/promises'),
  path = require('node:path'),
  { scan } = require('../core/descriptors.cjs'),
  archive = require('../core/archive.cjs'),
  ROOT = require('../core/root.cjs');
async function check(root = ROOT) {
  const errors = [],
    counts = {}, packages = new Map();
  for (const kind of ['engine', 'shell', 'profile']) {
    const result = scan(root, kind);
    counts[kind] = result.items.length;
    errors.push(...result.errors);
  }
  if(await fs.access(path.join(root,'hardware')).then(()=>true,()=>false))errors.push(...require('../hardware/index.cjs').configurations(root).errors);
  counts.module = 0;
  for (const e of await fs.readdir(path.join(root, 'modules'), { withFileTypes: true }))
    if (e.isDirectory())
      try {
        const discovered = require('../core/module-paths.cjs').discover(root);
        const descriptor = discovered.items.find(item=>item.home===path.join(root,'modules',e.name))?.descriptor;
        if(!descriptor)throw Error(discovered.errors.find(item=>item.module===e.name)?.error||'Module descriptor unavailable');
        const p = archive.inspect(await fs.readFile(path.join(root, 'modules', e.name, descriptor.id + '.izm')));
        if (p.descriptor.id !== descriptor.id || ![descriptor.id, require('../core/module-paths.cjs').directory(p.descriptor)].includes(e.name)) throw Error('Module folder/package mismatch');
        errors.push(...require('./runtime-assets.cjs').check(p).map(error => ({ id: e.name, ...error })));
        if(packages.has(p.descriptor.id))throw Error('Duplicate module identity: '+p.descriptor.id);
        packages.set(p.descriptor.id,p);
        const source=path.join(root,'modules',e.name);
        if(await fs.access(path.join(source,'module.json')).then(()=>true,()=>false)) {
          const entry=p.descriptor.server?.entry||p.descriptor.switch?.entry;
          if(entry&&await fs.access(path.join(source,entry)).then(()=>true,()=>false)) {
            const current=archive.inspect(await archive.pack(source)), published=new Map(p.files.filter(f=>f.name!=='checksums.json').map(f=>[f.name,archive.sha(f.bytes)])), files=current.files.filter(f=>f.name!=='checksums.json');
            // Different supported Node/zlib versions may compress the same bytes differently.
            if(files.length!==published.size||files.some(f=>published.get(f.name)!==archive.sha(f.bytes)))errors.push({id:e.name,error:'Published IZM differs from development source; repack before release'});
          }
        }
        counts.module++;
      } catch (error) {
        errors.push({ id: e.name, error: error.message });
      }
  for(const [id,p]of packages)for(const [component,target]of Object.entries(p.descriptor.server?.implementations||{})){
    const match=target.match(/^module:([^/]+)\/(.+)$/);if(!match)continue;
    const [,dependency,name]=match,provider=packages.get(dependency);
    if(!(p.descriptor.dependencies||[]).some(d=>d.kind==='module'&&d.id===dependency))errors.push({id,error:'Undeclared component dependency: '+target});
    if(!provider?.descriptor.server?.implementations?.[name])errors.push({id,error:'Missing component provider: '+target});
  }
  return { valid: !errors.length, counts, errors };
}
if (require.main === module)
  check(process.argv[2] ? path.resolve(process.argv[2]) : ROOT)
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      if (!r.valid) process.exitCode = 1;
    })
    .catch((e) => {
      console.error(e.stack);
      process.exitCode = 1;
    });
module.exports = { check };
