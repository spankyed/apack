import pathlib,subprocess,time,json,hashlib
r=pathlib.Path('/metrics');o=pathlib.Path('/results')
files=[r/'packages/apack-cli/tests/commands/dev-build.integration.spec.ts',r/'packages/apack-cli/vitest.integration.config.ts',r/'scripts/bundle-package.ts',r/'packages/apack-host/src/database/storage.ts']
(o/'source-sha256.json').write_text(json.dumps({str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files},indent=2)+'\n')
for name,args in [('packages-build',['npm','run','packages:build']),('dev-build-original-limit',['npm','test','-w','@apackdev/cli','--','--config','vitest.integration.config.ts','tests/commands/dev-build.integration.spec.ts']),('watch-repair-original-limits',['npm','test','-w','@apackdev/cli','--','--config','vitest.native.config.ts','tests/build/watch-worker-inputs.native.spec.ts'])]:
 start=time.monotonic();p=subprocess.run(args,cwd=r,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=300 if name=='watch-repair-original-limits' else 180)
 (o/(name+'.txt')).write_text(p.stdout);print(name,p.returncode,round(time.monotonic()-start,3),flush=True)
 (o/(name+'-timing.json')).write_text(json.dumps({'seconds':time.monotonic()-start,'exitCode':p.returncode,'scope':'exact tracked CI460 source on Linux 2 CPU / 6 GiB; original test timeout 120s; not a Mac cause diagnosis'},indent=2)+'\n')
 assert p.returncode==0,p.stdout[-15000:]
