import copy,json,pathlib,runpy,subprocess,sys
out=pathlib.Path('/results');cases=[]
for name,expected in [('1000',0),('99900',1)]:
 p=subprocess.run([sys.executable,'/verify.py','/measurements/fresh-'+name+'.json','/truth/truth.json',str(out/(name+'.json'))])
 cases.append({'size':int(name),'exitCode':p.returncode,'expectedExitCode':expected});assert p.returncode==expected
namespace=runpy.run_path('/verify.py',run_name='fresh_verifier')
truth_bytes=pathlib.Path('/truth/truth.json').read_bytes();truth=json.loads(truth_bytes)
smoke=json.loads(pathlib.Path('/measurements/fresh-1000.json').read_text())
for name in ('recall','eligibility','heartbeat'):
 report=copy.deepcopy(smoke)
 if name=='recall':report['cohorts'][0]['passes'][0]['samples'][0]['recall']=0
 elif name=='eligibility':report['cohorts'][0]['passes'][0]['samples'][0]['ordinals'][0]=499
 else:report['cohorts'][0]['passes'][0]['heartbeatMs']['p99']=0
 try:namespace['verify'](report,truth,truth_bytes)
 except AssertionError:cases.append({'mutation':name,'rejected':True})
 else:raise AssertionError('Verifier accepted corrupted '+name)
(out/'checks.json').write_text(json.dumps(cases,indent=2)+'\n');print(json.dumps(cases))
