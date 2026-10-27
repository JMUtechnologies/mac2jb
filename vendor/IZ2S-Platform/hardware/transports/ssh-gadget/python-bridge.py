"""Local or trusted-SSH transport for the packaged IZ2S input agent."""
import base64, ipaddress, json, os, subprocess, sys
from pathlib import Path
mode, action = sys.argv[1:3]
request = json.load(sys.stdin)
root = Path(request['root'])
if mode == 'ssh':
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from ssh_transport import SSH
    ipaddress.IPv4Address(request['armAddress'])
    peer = SSH + [(os.environ.get('IZ2S_ARM_USER') or os.environ.get('IZ15_ARM_USER', 'root')) + '@' + request['armAddress']]
else:
    peer = []
program = '''import base64,json,subprocess,sys
from pathlib import Path
r=json.loads(base64.b64decode(%r))
folder=Path(r['folder'])
action=%r
if action=='ensure':
 scope={'__name__':'iz2s_installer'}
 exec(compile(base64.b64decode(r['files']['install.py']),'iz2s-input-install','exec'),scope)
 scope['install'](folder,r['files'],r['hidDevice'])
 action='status'
if action=='status' and not (folder/'agent.py').is_file():
 print(json.dumps({'reachable':True,'moduleReady':False,'keyboard':False,'setupRequired':True,'error':'Install the ARM input package using First-time setup.'}));raise SystemExit(0)
if action=='status':
 import hashlib
 from_checks=json.loads(base64.b64decode(r['files']['checksums.json']))['files']
 if any(not (folder/name).is_file() or hashlib.sha256((folder/name).read_bytes()).hexdigest()!=from_checks[name] for name in ['agent.py','discovery.py','type-bootstrap.py']):
  print(json.dumps({'reachable':True,'moduleReady':False,'keyboard':False,'setupRequired':True,'error':'ARM input package needs an update. Open First-time setup.'}));raise SystemExit(0)
command=['python3',str(folder/'agent.py'),action]
body=None if action=='status' else json.dumps(r.get('body') or {})
if action=='follow':command.append(r['body']['requestId']);body=None
result=subprocess.run(command,input=body,text=True)
raise SystemExit(result.returncode)
''' % (base64.b64encode(json.dumps(request).encode()).decode(), action)
process = subprocess.Popen(peer+['python3','-'], stdin=subprocess.PIPE)
try:
    process.communicate(program.encode())
    raise SystemExit(process.returncode)
finally:
    if process.poll() is None: process.terminate()
