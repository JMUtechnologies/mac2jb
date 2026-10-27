#!/usr/bin/env python3
"""Local-only release promotion. No push, pull, reset or clean commands."""
import argparse, datetime, hashlib, importlib.util, json, pathlib, subprocess, sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
def run(*args,cwd=ROOT,capture=False):
 r=subprocess.run(args,cwd=cwd,check=True,stdout=subprocess.PIPE if capture else None,text=True)
 return r.stdout.strip() if capture else None
def git(*args,**kw):return run('git',*args,**kw)
def clean():
 if git('status','--porcelain',capture=True):raise RuntimeError('Release has uncommitted changes. Review and commit them first.')
def branch():return git('branch','--show-current',capture=True)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None
def scan_staged(root):
 import re
 for name in git('diff','--cached','--name-only','--diff-filter=ACMR',cwd=root,capture=True).splitlines():
  p=root/name
  if p.is_file() and re.search(rb'-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}',p.read_bytes()):raise RuntimeError('Possible credential in '+name+'; checkpoint not committed. Review staged files.')
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['status','snapshot','prepare','review','verify','accept','build','preview']);parser.add_argument('--source',type=pathlib.Path);parser.add_argument('--commit',default='HEAD');parser.add_argument('-m','--message',default='Save experimental changes');a=parser.parse_args()
 if a.command=='status':git('status','--short','--branch');git('log','--oneline','-5');return
 if a.command=='snapshot':
  source=a.source
  if source is None:raise RuntimeError('Pass --source /path/to/experimental-project')
  git('add','--all',cwd=source);scan_staged(source)
  if not git('diff','--cached','--name-only',cwd=source,capture=True):print('No new experimental changes.');return
  git('commit','--quiet','-m',a.message,cwd=source);return
 if a.command=='prepare':
  clean()
  if branch()!='main':raise RuntimeError('Prepare starts on main. Finish or leave the current candidate first.')
  local=ROOT/'.dev/local.json';config=json.loads(local.read_text()) if local.exists() else {};source=(a.source or pathlib.Path(config.get('source',''))).resolve()
  if source==ROOT or not (source/'.git').exists():raise RuntimeError('Pass --source /path/to/experimental-project')
  commit=git('rev-parse',a.commit,cwd=source,capture=True)
  spec=importlib.util.spec_from_file_location('exporter',ROOT/'distribution/export.py');exporter=importlib.util.module_from_spec(spec);spec.loader.exec_module(exporter)
  incoming=exporter.sources(source,commit);old=json.loads((ROOT/'.release/imported-files.json').read_text());previous=old['files'];conflicts=[];changes={};remove=[]
  for name,(content,mode) in incoming.items():
   before=previous.get(name);current=digest(ROOT/name);new=hashlib.sha256(content).hexdigest()
   if new==before:continue # Release-only edits are retained.
   if current==new:continue
   if current!=before:conflicts.append(name);continue
   changes[name]=(content,mode)
  for name,before in previous.items():
   if name not in incoming:
    current=digest(ROOT/name)
    if current is None:continue
    if current!=before:conflicts.append(name)
    else:remove.append(name)
  if conflicts:raise RuntimeError('Both lab and release changed these files; merge them manually before promotion:\n'+'\n'.join(conflicts))
  if commit==old['sourceCommit'] and not changes and not remove:print('This source commit is already imported.');return
  candidate='candidate/'+commit[:10]+'-'+datetime.datetime.now().strftime('%Y%m%d%H%M%S');git('switch','-c',candidate)
  exporter.write(changes,ROOT)
  for name in remove:(ROOT/name).unlink()
  (ROOT/'.release/imported-files.json').write_text(json.dumps({'sourceCommit':commit,'files':{n:hashlib.sha256(v[0]).hexdigest() for n,v in incoming.items()}},indent=2)+'\n')
  git('add','--all');scan_staged(ROOT);git('commit','-m','Import release candidate from '+commit[:12]);print('Candidate ready. main is unchanged. Run review, verify and preview before accept.');return
 if a.command=='review':git('diff','--stat','main...HEAD');git('diff','main...HEAD','--',':(exclude).release/imported-files.json');return
 if a.command=='verify':run(str(ROOT/'tools/node'),str(ROOT/'distribution/verify.cjs'));return
 if a.command=='accept':
  clean();candidate=branch()
  if not candidate.startswith('candidate/'):raise RuntimeError('Accept must run on a candidate branch.')
  run(str(ROOT/'tools/node'),str(ROOT/'distribution/verify.cjs'));git('switch','main');git('merge','--ff-only',candidate);print('Candidate accepted into local main. Nothing was published.');return
 if a.command=='build':run(str(ROOT/'tools/node'),str(ROOT/'distribution/build.cjs'));return
 if a.command=='preview':run(str(ROOT/'tools/node'),str(ROOT/'distribution/preview.cjs'));return
if __name__=='__main__':
 try:main()
 except (RuntimeError,subprocess.CalledProcessError) as e:print(str(e),file=sys.stderr);sys.exit(1)
