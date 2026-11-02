from pathlib import Path
import subprocess,time,json,os,hashlib,shutil
root=Path('/metrics');out=Path('/results');records=[];env=os.environ|{'EARS_TEST_SOURCE':'dd5d7da67e96c44b323e2572c48e529e7593da2e'}
source=root/'patched/vec1.c';original=source.read_bytes();assert hashlib.sha256(original).hexdigest()=='5d49d5ea17fbeaa1f22141305a81a5aeac8feb1af652a0d8229ea906bd5c973b'
headers=str(root/'node_modules/better-sqlite3/deps/sqlite3')
def run(name,args,negative=False,extra=None,limit=180):
 start=time.monotonic()
 with (out/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=root,env=env|(extra or {}),stdout=f,stderr=subprocess.STDOUT,timeout=limit)
 records.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start})
 (out/'results.json').write_text(json.dumps(records,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(out/(name+'.log')).read_text()[-6000:]
def compile(name,content,flags):
 file=root/(name+'.c');file.write_bytes(content);extension=root/(name+'.so')
 run('compile-'+name,['cc',*flags,'-DNDEBUG','-Werror=implicit-function-declaration','-shared','-fPIC','-I'+headers,str(file),'-lm','-o',str(extension)])
 return extension
# Dropping exclusion bits must fail the independent result oracle.
needle=b'pBitmask->a[ii/8] |= (1 << (ii%8));';assert original.count(needle)==1
mutant=compile('clobbered-mask',original.replace(needle,b'pBitmask->a[ii/8] = (1 << (ii%8));'),['-O3'])
run('mutation-mask',['node','native/vectors/membership-test.mjs',str(mutant),str(out/'mutation-mask.json')],negative=True)
assert 'AssertionError' in (out/'mutation-mask.log').read_text()
assert not json.loads((out/'mutation-mask.json').read_text())['completed']
# Force the existing operand-buffer allocation to fail and check its actual error branch.
needle=b'int *aRval = (int*)vec1MallocZero(sizeof_u32 * (pFilter->iVal+1));';assert original.count(needle)==1
fault=compile('allocation-refusal',original.replace(needle,b'int *aRval = (int*)0; /* deterministic allocation refusal */'),['-O3'])
run('allocation-refusal',['node','native/vectors/membership-test.mjs',str(fault),str(out/'allocation-refusal.json')],negative=True)
assert 'SQLITE_NOMEM' in (out/'allocation-refusal.log').read_text()
# Sanitizer variants are never used for latency measurements.
asan=compile('sanitized',original,['-O1','-g','-fsanitize=address,undefined','-fno-omit-frame-pointer'])
asanLib=subprocess.check_output(['cc','-print-file-name=libasan.so'],text=True).strip();assert Path(asanLib).is_file()
run('sanitized-membership',['node','native/vectors/membership-test.mjs',str(asan),str(out/'sanitized-membership.json')],extra={'LD_PRELOAD':asanLib,'ASAN_OPTIONS':'detect_leaks=0:abort_on_error=1','UBSAN_OPTIONS':'halt_on_error=1:print_stacktrace=1'})
report=json.loads((out/'sanitized-membership.json').read_text());assert report['completed'] and sum(g['checks'] for g in report['groups'])==555
assert source.read_bytes()==original
(out/'controls.json').write_text(json.dumps({'testedSourceSha256':hashlib.sha256(original).hexdigest(),'mutationRejected':True,'allocationFailureReported':'SQLITE_NOMEM','sanitizerChecks':555,'testedSourceUnchanged':True},indent=2)+'\n')
