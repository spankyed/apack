import subprocess,time,json
from pathlib import Path
assert not subprocess.check_output(['docker','ps','-q'],text=True).strip(),'Other container running: defer heavy validation'
cid=Path('/private/tmp/ears-identity-full2.cid');assert not cid.exists(),'CID file already present'
args=['docker','run','--rm','--cidfile',str(cid),'--name','ears-identity-finish-qualification','--cpus','2','--memory','6g','--memory-swap','6g','--cap-drop','ALL','-v','ears-electron-runtime-work:/electron','-v','/private/tmp/ears-identity-controls.py:/controls.py:ro','-v','/private/tmp/ears-identity-full-overlay.tar:/overlay.tar:ro','-v','/private/tmp/ears-identity-finish.py:/qualification.py:ro','-v','/private/tmp/ears-identity-results:/results','-w','/electron','apack-linux-test:74d4b8cfe839','python3','/qualification.py']
p=subprocess.Popen(args);owned=None
while p.poll() is None:
 if owned is None and cid.exists():owned=cid.read_text().strip()
 if owned:
  d=subprocess.run(['docker','inspect',owned,'--format','{{json .State}}'],text=True,capture_output=True)
  if d.returncode==0:
   state=json.loads(d.stdout);other=[n for n in subprocess.check_output(['docker','ps','-q','--no-trunc'],text=True).splitlines() if n!=owned]
   action='pause' if other and not state['Paused'] else 'unpause' if not other and state['Paused'] else None
   if action:
    result=subprocess.run(['docker',action,owned],capture_output=True,text=True)
    with Path('/private/tmp/ears-identity-results/resource-finish-watch.log').open('a') as f:f.write(json.dumps({'time':time.time(),'action':action,'other':other,'exitCode':result.returncode})+'\n')
 time.sleep(2)
raise SystemExit(p.returncode)
