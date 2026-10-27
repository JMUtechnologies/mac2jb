#!/usr/bin/env python3
"""Check local links/anchors in owned README files, FAQ and shipped SDK guides."""
import pathlib,re,sys,urllib.parse
root=pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else pathlib.Path(__file__).resolve().parents[1]
ignored={'data','dist','.git','.dev','node_modules','__pycache__','.versions','upstream','runtime','downloads','vacuumtube','ouncecake'}
def owned(p):
 parts=p.relative_to(root).parts
 return not any(x in ignored or x.startswith(('.placeholder-','.download-')) for x in parts)
def prose(p):return re.sub(r'^```[^\n]*\n.*?^```[^\n]*$', '',p.read_text(),flags=re.M|re.S)
def anchors(p):
 seen={};result=set()
 for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*$',prose(p),flags=re.M):
  slug=re.sub(r'[^\w\- ]','',heading.lower()).replace(' ','-')
  count=seen.get(slug,0);seen[slug]=count+1;result.add(slug+('-'+str(count) if count else ''))
 return result
files=sorted({p for p in root.rglob('README.md') if owned(p)}|{p for p in [root/'FAQ.md',root/'distribution/README-development.md',root/'distribution/README-release.md'] if p.exists()}|set((root/'sdk/docs').glob('*.md')))
errors=[]
for p in files:
 for target in re.findall(r'!?\[[^\]]*\]\(([^)]+)\)',prose(p)):
  if re.match(r'[a-zA-Z][\w+.-]*:',target) or target.startswith('//'):continue
  target=target.strip('<>');name,_,fragment=target.partition('#');name=urllib.parse.unquote(name)
  dest=(p.parent/name).resolve() if name else p
  if not dest.exists():errors.append(str(p.relative_to(root))+': missing '+target);continue
  if fragment and dest.suffix=='.md' and urllib.parse.unquote(fragment) not in anchors(dest):errors.append(str(p.relative_to(root))+': missing heading '+target)
if errors:print('\n'.join(errors),file=sys.stderr);sys.exit(1)
print(f'Documentation verified: {len(files)} owned guides; local links and headings resolve.')
