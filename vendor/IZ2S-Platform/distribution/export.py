#!/usr/bin/env python3
"""Export only committed, allowlisted sources. Never copy local runtime data."""
import hashlib, json, pathlib, re, subprocess, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
PROFILE = json.loads((ROOT/'distribution/profile.json').read_text())
TOP = {'core','panel','desktop','engines','shells','hardware','profiles','sdk','modules','tools','distribution','.vscode'}
SDK = {'build.cjs','check.cjs','pack.cjs','pack-agent.cjs','platform.cjs','publish-modules.cjs','runtime-assets.cjs','validate.cjs','LICENSE','README.md'}
DIAGNOSTICS = {'launcher-desktop-check.cjs','h264-audit.cjs','game-render','game-compute-check'}
def allowed(name):
    p=pathlib.PurePosixPath(name); parts=p.parts
    if len(parts)==1:return name in {'start.cjs','start.sh','install-desktop.sh','package.json','LICENSE','COPYRIGHT','LICENSE-SCOPE.md','THIRD_PARTY.json','FAQ.md','.gitignore','.dockerignore'}
    if parts[0] not in TOP:return False
    if any(x in {'.git','node_modules','__pycache__','.versions','test-data'} or x.startswith(('.placeholder-','.download-')) for x in parts):return False
    if p.suffix in {'.log','.pyc','.izm','.izs','.izp'} or p.name in {'secret','installed.json','.engine-install.json','capsule.key'}:return False
    if parts[:2]==('core','packages') and len(parts)>2 and parts[2]=='tests':return False
    if parts[0]=='core' and p.name in DIAGNOSTICS:return False
    if parts[0]=='modules':
        if len(parts)>1 and (parts[1].endswith('.cjs') or parts[1]=='README.md'):return True
        if parts[1] not in PROFILE['modules']:return False
        if any(x in {'runtime','data','downloads','dist'} for x in parts[2:]):return False
    if parts[0]=='engines' and len(parts)>2 and parts[1] not in PROFILE['preinstalledEngines']+PROFILE['optionalEngines']:return False
    if parts[0]=='engines' and len(parts)>2 and parts[2]=='upstream':return False
    if parts[:3]==('hardware','configurations','mac2jb'):return False
    if parts[0]=='sdk':
        if parts[1] in SDK:return True
        if parts[1]=='tools':return p.name in {'toolchain.cjs','toolchain.sh'}
        return parts[1] in {'host','native','include','schemas','docs'}
    if parts[0]=='tools':return parts[1]=='node'
    return True

def git(root,*args):return subprocess.check_output(['git','-C',str(root),*args])
def sources(root,commit):
    result={}
    entries=git(root,'ls-tree','-rz','--full-tree',commit).split(b'\0')
    for entry in entries:
        if not entry:continue
        meta,raw=entry.split(b'\t',1);mode,kind,oid=meta.decode().split();name=raw.decode()
        if not allowed(name):continue
        if kind!='blob' or mode=='120000':raise ValueError('Unsupported source entry: '+name)
        content=git(root,'cat-file','blob',oid)
        if re.search(rb'-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}',content):raise ValueError('Possible credential: '+name)
        result[name]=(content,0o755 if mode=='100755' else 0o644)
    third=json.loads(result['THIRD_PARTY.json'][0]);third['modules']=[m for m in third['modules'] if m['id'] in PROFILE['modules']];third.pop('vacuumtubeSource',None);third['externalComponents']=[]
    result['THIRD_PARTY.json']=((json.dumps(third,indent=2)+'\n').encode(),0o644)
    package=json.loads(result['package.json'][0]);package['engines']['node']='>=22';package['scripts']={'start':'node start.cjs','preview':'node distribution/preview.cjs','check':'node distribution/verify.cjs','release':'node distribution/build.cjs'}
    result['package.json']=((json.dumps(package,indent=2)+'\n').encode(),0o644)
    template,mode=result['distribution/README-release.md']
    # The template lives under distribution/, but the rendered start page lives at the root.
    rendered=template.decode().replace('(../','(').replace('(README-development.md)','(distribution/README-development.md)')
    result['README.md']=(rendered.encode(),mode)
    for name in ['install.sh','preview.sh']:
        result[name]=result['distribution/'+name]
    # The public shell builder keeps compilation, not developer-only GPU tests.
    name='shells/izlauncher/server/build.sh'
    if name in result:
        content=result[name][0].decode();content=content
        # Optional --check belongs to the lab. The normal compilation path is preserved.
        content=re.sub(r'if \[.*?--check.*?\nfi\n?', '', content, flags=re.S)
        result[name]=(content.encode(),0o755)
    return result

def write(files,target):
    target=pathlib.Path(target);target.mkdir(parents=True,exist_ok=True)
    for name,(content,mode) in files.items():
        file=target/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(content);file.chmod(mode)
    for engine in PROFILE['optionalEngines']:(target/'engines'/engine/'upstream').mkdir(parents=True,exist_ok=True)
    return {name:hashlib.sha256(content).hexdigest() for name,(content,_) in files.items()}
if __name__=='__main__':
    source=pathlib.Path(sys.argv[1]);commit=git(source,'rev-parse',sys.argv[2]).decode().strip();target=pathlib.Path(sys.argv[3])
    hashes=write(sources(source,commit),target)
    (target/'.release').mkdir(exist_ok=True)
    (target/'.release/imported-files.json').write_text(json.dumps({'sourceCommit':commit,'files':hashes},indent=2)+'\n')
    print('Exported',len(hashes),'files from',commit[:12])
