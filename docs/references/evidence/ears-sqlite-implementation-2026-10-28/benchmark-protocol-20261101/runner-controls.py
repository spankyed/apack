import contextlib,io,json,pathlib,runpy,subprocess,sys,tempfile
from unittest.mock import patch
repo=pathlib.Path.cwd();script=repo/'packages/apack-ears/bench/sqlite/run-bench.py';pin=(repo/'vendor/elmdb.rev').read_text().strip()
names=['field','unique','page50','row','all10k','sort10k','edges50','walk299','text','vector1k256','smallFieldLargeRow','projectedLargePage','updateSmallRepeatedBody','updateSmallVariedBody','streamBody16Chunks','write','writeBatch100','watch20']
def report(backend,durable):return {'backend':backend,'execution':'built-package','durable':durable,'n':10000,'consumed':True,'nativeBindings':[{'path':'/native/fixture.node','sha256':'a'*64}],'samples':{n:[1]*(1 if n=='watch20' else 5) for n in names}}
def exercise(mode,durable=False):
 calls=[]
 with tempfile.TemporaryDirectory(prefix='ears-bench-control-') as tmp:
  out=pathlib.Path(tmp)/'results'
  def check(command,**kwargs):
   if command[0]=='node' and '--input-type=module' in command:return json.dumps({'files':[],'bindings':[],'driverVersion':'13.0.3'})
   if command==['node','--version']:return 'v23.11.1\n'
   if command[0]=='git':return '' if command[1]=='status' else 'c'*40+'\n'
   raise AssertionError(command)
  def run(command,**kwargs):
   if command[0]=='git':return subprocess.CompletedProcess(command,0,('f'*40 if mode=='pin' else pin)+'\n','')
   backend=command[-2] if command[-1]=='--durable' else command[-1];calls.append(backend)
   if mode=='timeout':raise subprocess.TimeoutExpired(command,300,output=b'partial stdout',stderr=b'partial stderr')
   if mode=='process':return subprocess.CompletedProcess(command,7,'partial stdout','retained stderr')
   value=report(backend,durable)
   if mode=='nan':value['samples']['field'][0]=float('nan')
   if mode=='missing':value['samples'].pop('streamBody16Chunks')
   if mode=='bindings':value['nativeBindings']=[]
   if mode=='source':value['execution']='source'
   if mode=='durability':value['durable']=not durable
   return subprocess.CompletedProcess(command,0,'invalid JSON' if mode=='json' else json.dumps(value),'retained stderr')
  argv=[str(script),str(out),'--trials','3']+(['--durable'] if durable else [])
  exited=None
  with patch.object(sys,'argv',argv),patch('platform.platform',return_value='controlled'),patch('platform.machine',return_value='controlled'),patch('subprocess.check_output',check),patch('subprocess.run',run),contextlib.redirect_stdout(io.StringIO()):
   try:runpy.run_path(str(script),run_name='__main__')
   except (SystemExit,RuntimeError) as e:exited=e
  if mode=='pin':assert exited and calls==[] and (out/'provenance.json').exists();return
  matrix=json.loads((out/'matrix.json').read_text())
  if mode=='ok':
   assert exited is None and matrix['completed'] and matrix['passed'] and len(matrix['records'])==6
   assert calls==['sqlite','elmdb','elmdb','sqlite','sqlite','elmdb']
  else:
   assert exited and not matrix['completed'] and not matrix['passed'] and len(calls)==1
   record=matrix['records'][0];assert not record['passed']
   assert (out/'sqlite-1.stdout').exists() and (out/'sqlite-1.stderr').exists()
   if mode=='timeout':assert (out/'sqlite-1.stdout').read_text()=='partial stdout' and record['secondsLimit']==300
for durable in [False,True]:exercise('ok',durable)
for mode in ['timeout','process','json','nan','missing','bindings','durability','source','pin']:exercise(mode)
with tempfile.TemporaryDirectory(prefix='ears-bench-retain-') as tmp:
 p=pathlib.Path(tmp);(p/'sentinel').write_text('keep')
 with patch.object(sys,'argv',[str(script),tmp]),contextlib.redirect_stderr(io.StringIO()):
  try:runpy.run_path(str(script),run_name='__main__');raise AssertionError('Accepted existing output')
  except SystemExit as e:assert e.code==2
 assert (p/'sentinel').read_text()=='keep'
compile(script.read_text(),str(script),'exec')
print('Actual runner passes both six-process alternation controls; rejects timeout, process error, invalid JSON, NaN, missing task/bindings, wrong durability/pin and reused output while retaining failure evidence. No native workload was run locally.')
