"""IZ2S local USB jobs, shared by SSH and ARM-only modes. No host server over SSH."""
import fcntl,importlib.util,json,os,platform,re,select,signal,subprocess,sys,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
JOBS=Path('/run/ns2jb-keyboard-jobs')
def identifier(value):
 if not isinstance(value,str) or not re.fullmatch(r'[a-f0-9-]{36}',value):raise ValueError('Invalid input job identifier')
 return value
def device():return json.loads((HERE/'input-config.json').read_text()).get('hidDevice','/dev/hidg0')
def usb():return Path(device()).exists() and any(p.read_text().strip()=='configured' for p in Path('/sys/class/udc').glob('*/state'))
def busy():
 for file in Path('/run').glob('ns2jb-keyboard-jobs*/current.json'):
  try:
   value=json.loads(file.read_text()).get('requestId','')
   if value and subprocess.run(['systemctl','is-active','--quiet','ns2jb-hid-'+value],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:return True
  except (OSError,ValueError):pass
 return False
def sender():
 spec=importlib.util.spec_from_file_location('protected_hid',HERE/'type-bootstrap.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def status():return {'reachable':True,'moduleReady':os.geteuid()==0 and Path('/run/systemd/system').is_dir() and all((HERE/n).is_file() for n in ['type-bootstrap.py']),'keyboard':usb(),'keyboardBusy':busy(),'usbState':', '.join(p.read_text().strip() for p in Path('/sys/class/udc').glob('*/state')) or 'not attached','architecture':platform.machine(),'service':'izlauncher-input','installed':True}
def enqueue(body):
 key=identifier(body.get('requestId'));job=JOBS/key
 if body.get('action')!='plan':raise ValueError('Input jobs require an engine-provided plan')
 if body.get('action')=='connect' and not re.fullmatch(r'V=START\([0-9,]+\)',body.get('command','')):raise ValueError('Invalid generated connection command')
 if body.get('bootstrap','NS2') not in ['NS2','NS2R']:raise ValueError('Unsupported bootstrap')
 JOBS.mkdir(mode=0o700,exist_ok=True)
 with (JOBS/'lock').open('w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  if job.exists():return {'accepted':True,'duplicate':True}
  if not usb():raise RuntimeError('USB input cable is not configured')
  if busy():raise RuntimeError('USB input device is busy')
  job.mkdir(mode=0o700);file=job/'request.json';file.write_text(json.dumps(body));file.chmod(0o600);(JOBS/'current.json').write_text(json.dumps({'requestId':key}))
  try:subprocess.run(['systemd-run','--quiet','--collect','--service-type=exec','--unit=ns2jb-hid-'+key,'--property=KillMode=control-group','--property=RuntimeMaxSec=7200','python3',str(HERE/'agent.py'),'execute',key],check=True,capture_output=True)
  except Exception:
   (job/'done.json').write_text(json.dumps({'ok':False,'error':'Input task did not start'}));raise
 return {'accepted':True}
def typed_plan(body,report):
 module=sender();special={**module.SPECIAL,'up':82,'down':81,'tab':43};keyboard=module.Keyboard(device(),.06,.08)
 try:
  # Observe the actual USB LED report; a silent host never receives a plan.
  for _ in range(2):keyboard.isolated_tap(0,special['capslock']);time.sleep(.4)
  leds=None
  while select.select([keyboard.fd],[],[],.2)[0]:leds=os.read(keyboard.fd,64)
  if not leds:raise RuntimeError('Console keyboard did not answer; no plan was typed')
  caps=bool(leds[0]&2)
  def text(value):
   for ch in value:
    key=ch.swapcase() if caps and ch.isalpha() else ch
    keyboard.isolated_tap(*module.KEYS[key])
  def source(value):
   lines=value.replace('\r\n','\n').replace('\r','\n').splitlines()
   for number,line in enumerate(lines,1):
    keyboard.isolated_tap(module.SHIFT,special['home']);keyboard.isolated_tap(0,special['delete']);text(line)
    if line.strip():keyboard.isolated_tap(0,special['escape']);time.sleep(.2)
    keyboard.isolated_tap(0,special['enter']);time.sleep(.3)
    if line.strip().upper()=='END':time.sleep(.8)
    report('Entered source line',line=number,total=len(lines))
  steps=body['steps']
  for at in range(len(steps)+1):
   if body.get('source') is not None and at==body.get('sourceAfter',len(steps)):source(body['source'])
   if at==len(steps):break
   step=steps[at]
   if step['type']=='line':
    report('Typing generated connection command' if step['text'].startswith('V=START(') else 'Typing plan line',step=at+1,total=len(steps));text(step['text']);keyboard.isolated_tap(0,special['escape']);time.sleep(.5);keyboard.isolated_tap(0,special['enter']);time.sleep(step.get('delayMs',500)/1000)
   elif step['type']=='key':keyboard.isolated_tap(0,special[step['key']]);time.sleep(step.get('delayMs',500)/1000)
   elif step['type']=='sleep':time.sleep(step['ms']/1000)
   else:raise ValueError('Unsupported typed plan step')
 finally:keyboard.close()
def execute(key):
 job=JOBS/identifier(key);file=job/'request.json';body=json.loads(file.read_text());file.unlink()
 def report(detail,**fields):
  with (job/'events.jsonl').open('a') as out:out.write(json.dumps({'detail':detail,'fields':fields})+'\n')
 def interrupted(signum,frame):raise KeyboardInterrupt('Input job cancelled')
 signal.signal(signal.SIGTERM,interrupted)
 try:
  if not usb():raise RuntimeError('USB input cable is not configured')
  if body['action']!='plan':raise ValueError('Input jobs require an engine-provided plan')
  typed_plan(body,report)
  result={'ok':True}
 except BaseException as error:result={'ok':False,'error':str(error) or 'Input job interrupted'}
 (job/'done.json').write_text(json.dumps(result))
def follow(key):
 job=JOBS/identifier(key);position=0;deadline=time.monotonic()+7250
 while time.monotonic()<deadline:
  lines=(job/'events.jsonl').read_text().splitlines() if (job/'events.jsonl').exists() else []
  for line in lines[position:]:print(line,flush=True)
  position=len(lines)
  if (job/'done.json').exists():result=json.loads((job/'done.json').read_text());print(json.dumps({'done':result}),flush=True);return
  time.sleep(.2)
 raise RuntimeError('Input job completion is unconfirmed')
def halt(body):
 key=identifier(body.get('requestId'));job=JOBS/key;JOBS.mkdir(mode=0o700,exist_ok=True)
 with (JOBS/'lock').open('w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX);existed=job.exists();job.mkdir(mode=0o700,exist_ok=True)
  if existed:
   unit='ns2jb-hid-'+key;subprocess.run(['systemctl','stop',unit],capture_output=True,timeout=10)
   result=subprocess.run(['systemctl','show',unit,'--property=ActiveState','--property=MainPID'],capture_output=True,text=True,timeout=3);values=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
   if values.get('ActiveState') not in ['inactive','failed'] or values.get('MainPID')!='0':raise RuntimeError('Input cancellation is unconfirmed')
  if existed and usb():
   module=sender();keyboard=module.Keyboard(device(),.06,.08)
   try:keyboard.write(module.RELEASE,timeout=.3)
   finally:keyboard.close()
  (job/'request.json').unlink(missing_ok=True);(job/'done.json').write_text(json.dumps({'ok':False,'stopped':True}))
 return {'stopped':True}
if __name__=='__main__':
 try:
  action=sys.argv[1]
  if action=='status':print(json.dumps(status()),flush=True)
  elif action=='enqueue':print(json.dumps(enqueue(json.load(sys.stdin))),flush=True)
  elif action=='execute':execute(sys.argv[2])
  elif action=='follow':follow(sys.argv[2])
  elif action=='halt':print(json.dumps(halt(json.load(sys.stdin))),flush=True)
  else:raise ValueError('Unknown input service action')
 except Exception as error:print(str(error),file=sys.stderr);raise SystemExit(1)
