#!/usr/bin/env node
'use strict';
// Prepare only the pinned IZlauncher base and File Exchange. The upstream
// snapshot stays unchanged; this private runtime never starts a platform host.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const REVISION='907de0d9f5a4e358079306e7f04a8c43d463142a';
const MANIFEST_SHA256='fd35e84485e74aac2e2b8dd42bdf6d15b0125a643e3edd087ee413971f9e728b';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const check=(value,message)=>{if(!value)throw Error(message);};
function files(folder,prefix='') {
  const result=[];
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})) {
    const relative=prefix+entry.name;
    check(!entry.isSymbolicLink(),'IZlauncher forbids links: '+relative);
    if(entry.isDirectory())result.push(...files(path.join(folder,entry.name),relative+'/'));
    else {check(entry.isFile(),'IZlauncher requires regular files: '+relative);result.push(relative);}
  }
  return result.sort();
}
function sourceFiles(root) {
  const source=path.join(root,'vendor/IZ2S-Platform');
  const manifest=fs.readFileSync(path.join(root,'packaging/IZ2S-Platform-SHA256SUMS'));
  check(hash(manifest)===MANIFEST_SHA256,'Changed IZlauncher source inventory.');
  const inventory=new Map();
  for(const line of manifest.toString('utf8').trim().split('\n')) {
    const match=/^([a-f0-9]{64})  (.+)$/.exec(line);
    check(match&&!path.isAbsolute(match[2])&&!/[\\\x00-\x1f]/.test(match[2])&&
      !match[2].split('/').some(part=>!part||part==='.'||part==='..')&&!inventory.has(match[2]),'Invalid IZlauncher source inventory.');
    inventory.set(match[2],match[1]);
  }
  check(JSON.stringify(files(source))===JSON.stringify([...inventory.keys()].sort()),'Unexpected or missing IZlauncher source file.');
  const contents=new Map();
  for(const [name,digest] of inventory) {
    const bytes=fs.readFileSync(path.join(source,name));
    check(hash(bytes)===digest,'Changed IZlauncher source: '+name);contents.set(name,bytes);
  }
  return contents;
}
function overlay(contents) {
  const out=new Map(contents);
  for(const name of ['shells/izlauncher/shell.json','modules/iz-exchange/module.json']) {
    const value=JSON.parse(out.get(name));
    check(JSON.stringify(value.platforms)==='["linux-x64","linux-arm64"]','Unexpected IZlauncher platform list.');
    value.platforms=['darwin-arm64'];out.set(name,Buffer.from(JSON.stringify(value,null,2)+'\n'));
  }
  const name='shells/izlauncher/server/hero-text.py';
  const before="font='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'",text=out.get(name).toString();
  check(text.split(before).length===2,'Unexpected IZlauncher font selection.');
  out.set(name,Buffer.from(text.replace(before,"font=os.environ['HB_FONT']")));
  return out;
}
function location(root){return path.join(root,'homebrew/IZ2S-Platform');}
function privateWrite(file,bytes){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});}
async function prepare(root=path.resolve(__dirname,'..')) {
  const source=sourceFiles(root),expected=overlay(source),directory=location(root);
  check(!fs.existsSync(directory),'IZlauncher preparation requires a fresh destination.');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  for(const [name,bytes] of expected)privateWrite(path.join(directory,name),bytes);
  const archive=require(path.join(directory,'core/archive.cjs'));
  const moduleRoot=path.join(directory,'modules/iz-exchange'),bytes=await archive.pack(moduleRoot),pkg=archive.inspect(bytes);
  privateWrite(path.join(moduleRoot,'iz-exchange.izm'),bytes);
  await archive.unpack(bytes,path.join(moduleRoot,'.versions',pkg.sha256));
  for(const name of pkg.descriptor.switch.files)
    privateWrite(path.join(directory,'data/app-links/iz-exchange',name.slice(7)),expected.get('modules/iz-exchange/'+name));
  const modified=[...expected].filter(([name,bytes])=>!bytes.equals(source.get(name))).map(([name,bytes])=>({path:name,sha256:hash(bytes)}));
  privateWrite(path.join(directory,'mac2jb-runtime.json'),JSON.stringify({version:1,revision:REVISION,
    scope:'IZlauncher base shell and File Exchange only',modules:['iz-exchange'],modified,moduleSha256:pkg.sha256},null,2)+'\n');
  return verify(root);
}
function verify(root=path.resolve(__dirname,'..')) {
  const expected=overlay(sourceFiles(root)),directory=location(root);
  check(fs.lstatSync(directory).isDirectory()&&!fs.lstatSync(directory).isSymbolicLink(),'Invalid IZlauncher runtime directory.');
  for(const [name,bytes] of expected) {
    const file=path.join(directory,name),stat=fs.lstatSync(file);
    check(stat.isFile()&&!stat.isSymbolicLink()&&fs.readFileSync(file).equals(bytes),'Changed IZlauncher runtime file: '+name);
  }
  // The only executable module archive is checked against the pinned sources.
  const archive=require(path.join(directory,'core/archive.cjs'));
  const archiveBytes=fs.readFileSync(path.join(directory,'modules/iz-exchange/iz-exchange.izm')),pkg=archive.inspect(archiveBytes);
  check(pkg.descriptor.id==='iz-exchange'&&JSON.stringify(pkg.descriptor.platforms)==='["darwin-arm64"]','Unexpected IZlauncher module.');
  const archiveNames=new Set();
  for(const file of pkg.files) {
    archiveNames.add(file.name);
    if(file.name!=='checksums.json')check(expected.get('modules/iz-exchange/'+file.name)?.equals(file.bytes),'Changed File Exchange package source: '+file.name);
    const version=path.join(directory,'modules/iz-exchange/.versions',pkg.sha256,file.name),stat=fs.lstatSync(version);
    check(stat.isFile()&&!stat.isSymbolicLink()&&fs.readFileSync(version).equals(file.bytes),'Changed File Exchange prepared version: '+file.name);
  }
  for(const name of expected.keys())if(name.startsWith('modules/iz-exchange/')&&!name.split('/').some(part=>part.startsWith('.')))
    check(archiveNames.has(name.slice('modules/iz-exchange/'.length)),'File Exchange package omitted source: '+name);
  const allowed=new Set([...expected.keys(),'mac2jb-runtime.json','modules/iz-exchange/iz-exchange.izm',
    ...pkg.files.map(file=>'modules/iz-exchange/.versions/'+pkg.sha256+'/'+file.name),
    ...pkg.descriptor.switch.files.map(name=>'data/app-links/iz-exchange/'+name.slice(7))]);
  for(const name of files(directory)) {
    // Session reports/cache are mutable data; code and module inventories are fixed.
    if(name.startsWith('data/')&&!name.startsWith('data/app-links/'))continue;
    check(allowed.has(name),'Unexpected IZlauncher runtime file: '+name);
  }
  for(const name of pkg.descriptor.switch.files) {
    const file=path.join(directory,'data/app-links/iz-exchange',name.slice(7));
    check(fs.readFileSync(file).equals(expected.get('modules/iz-exchange/'+name)),'Changed File Exchange catalog: '+name);
  }
  const metadata=JSON.parse(fs.readFileSync(path.join(directory,'mac2jb-runtime.json')));
  check(metadata.version===1&&metadata.revision===REVISION&&metadata.moduleSha256===pkg.sha256&&
    JSON.stringify(metadata.modules)==='["iz-exchange"]','Invalid IZlauncher runtime metadata.');
  return {directory,revision:REVISION,moduleSha256:pkg.sha256,packageBytes:archiveBytes.length};
}
function runtimeEnvironment(root,inherited=process.env) {
  const info=verify(root),font=path.join(root,'homebrew/fonts/DejaVuSans.ttf');
  const env={...require('./gui-homebrew.cjs').runtimeEnvironment(root,inherited),
    IZ2S_ROOT:info.directory,IZ15_ROOT:info.directory,IZ15_SHELL:'izlauncher',
    HB_APPS_DIR:path.join(info.directory,'data/app-links'),HB_FONT:font,
    IZ2S_MODULE_PINS:JSON.stringify({version:1,root:info.directory,modules:{'iz-exchange':{sha256:info.moduleSha256,packageBytes:info.packageBytes}}})};
  return env;
}
async function main(args=process.argv.slice(2)) {
  const root=path.resolve(args[1]||path.join(__dirname,'..'));
  if(args[0]==='--check-source'&&args.length<=2){sourceFiles(root);console.log('Pinned IZlauncher source verified.');return;}
  if(args[0]==='--prepare'&&args.length<=2){await prepare(root);console.log('Offline IZlauncher base runtime prepared.');return;}
  if(args[0]==='--check'&&args.length<=2){verify(root);console.log('Offline IZlauncher base runtime verified.');return;}
  throw Error('Usage: prepare-izlauncher.cjs --check-source|--prepare|--check [ROOT]');
}
module.exports={prepare,verify,runtimeEnvironment,sourceFiles,location,REVISION,MANIFEST_SHA256};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
