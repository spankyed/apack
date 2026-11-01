from pathlib import Path
import subprocess,time,os,json
cid=Path('/private/tmp/ears-identity-full2.cid');assert not cid.exists(),'An identity finish run has already been created; inspect it instead'
Path('/private/tmp/ears-identity-admission.pid').write_text(str(os.getpid())+'\n')
quiet=None;last=0
print('Waiting for 30 seconds with no running containers before admitting the unchanged host/scripts gates',flush=True)
while True:
 if Path('/private/tmp/ears-identity-admission.stop').exists():raise SystemExit('Admission stopped before container creation')
 p=subprocess.run(['docker','ps','-q'],capture_output=True,text=True)
 now=time.monotonic()
 if p.returncode or p.stdout.strip():quiet=None
 elif quiet is None:quiet=now
 if now-last>=20:
  print(json.dumps({'pid':os.getpid(),'otherContainers':p.stdout.splitlines(),'quietSeconds':0 if quiet is None else round(now-quiet)}),flush=True);last=now
 if quiet is not None and now-quiet>=30:
  p=subprocess.run(['python3','/private/tmp/ears-run-identity-finish.py'])
  if cid.exists():raise SystemExit(p.returncode) # A started run is never restarted by this admission watcher.
  if p.returncode==0:raise SystemExit('Runner exited without creating its expected container')
  quiet=None # The final admission guard caught a new competing build; no check has started yet.
 time.sleep(2)
