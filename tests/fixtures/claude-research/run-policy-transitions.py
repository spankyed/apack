"""Root-only outer fixture; native/app processes always run as the owned node user."""
from pathlib import Path
import hashlib,json,os,pwd,shutil,subprocess,tarfile,tempfile,time,uuid
assert os.geteuid()==0 and Path('/.dockerenv').is_file()
root=Path('/work');fixture=root/'tests/fixtures/claude-research';manifest=json.loads((fixture/'manifest.json').read_text());archive=(fixture/'runner.tgz').read_bytes()
assert hashlib.sha256(archive).hexdigest()==manifest['archiveSha256']
name='src/protocol/linux-policy-transition-fixture.py'
with tarfile.open(fixture/'runner.tgz') as source:
 data=source.extractfile(name).read()
assert hashlib.sha256(data).hexdigest()==manifest['files'][name]
base=root/'.claude-research';base.mkdir(exist_ok=True);user=pwd.getpwnam('node');os.chown(base,user.pw_uid,user.pw_gid)
control=base/('policy-transition-'+str(uuid.uuid4()))
with tempfile.TemporaryDirectory(prefix='claude-policy-root-') as temporary:
 helper=Path(temporary)/'fixture.py';helper.write_bytes(data)
 with (Path(temporary)/'fixture.log').open('wb') as log:
  service=subprocess.Popen(['python3',str(helper),str(control),'--seconds','280'],stdout=log,stderr=subprocess.STDOUT)
  try:
   deadline=time.monotonic()+5
   while not (control/'ready.json').exists():
    assert service.poll() is None,'Policy fixture failed before ready'
    assert time.monotonic()<deadline,'Policy fixture ready timeout'
    time.sleep(.05)
   env={**os.environ,'CLAUDE_RESEARCH_SYSTEM_POLICY_CONTROL':str(control)}
   result=subprocess.run(['runuser','-u','node','--','xvfb-run','-a','-s','-screen 0 1280x1024x24','python3','scripts/claude-research-ci.py','--linux-container','system-policy-transition-app'],env=env,timeout=260)
  finally:
   if control.is_dir():(control/'finish').touch()
   if service.poll() is None:
    try:service.wait(timeout=5)
    except subprocess.TimeoutExpired:
     service.terminate();service.wait(timeout=5)
   destination=base/'current/output/policy-transition-control'
   destination.mkdir(parents=True,exist_ok=True)
   if control.is_dir():
    for path in control.iterdir():
     if path.is_file() and not path.is_symlink():shutil.copy2(path,destination/path.name)
   shutil.copy2(Path(temporary)/'fixture.log',destination/'fixture.log')
  assert service.returncode==0,'Policy fixture did not finish cleanly; inspect preserved root fixture log'
  assert (control/'restored.json').is_file(),'Original policy restoration receipt missing'
  raise SystemExit(result.returncode)
