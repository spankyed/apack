import pathlib, subprocess, time, json, os, shutil, tarfile
r=pathlib.Path('/metrics');o=pathlib.Path('/results');r.mkdir()
with tarfile.open('/source.tar') as t:t.extractall(r)
# Archive source is exact; these guards also inspect Git's tracked/ignored path classification.
subprocess.run(['git','init','-q',str(r)],check=True)
subprocess.run(['git','-C',str(r),'add','-f','.'],check=True)
subprocess.run(['git','-C',str(r),'-c','user.name=SQLite diagnostic','-c','user.email=diagnostic@localhost','commit','-qm','Exact tracked source archive for isolated checks'],check=True)
(o/'source.json').write_text(json.dumps({'source':os.environ['EARS_TEST_SOURCE'],'gitMetadata':'synthetic repository for tracked/ignored file guards; no source edits'},indent=2)+'\n')

shutil.copytree('/seed/node_modules',r/'node_modules',symlinks=True)
for p in pathlib.Path('/seed/packages').glob('*/node_modules'):
 d=r/'packages'/p.parent.name/'node_modules'
 if d.parent.exists():shutil.copytree(p,d,symlinks=True)
p=r/'vendor/elmdb'
if p.is_symlink():p.unlink()
elif p.exists():shutil.rmtree(p)
p.symlink_to('/engine')
p=r/'node_modules/elmdb'
if p.is_symlink():p.unlink()
elif p.exists():shutil.rmtree(p)
p.symlink_to('/engine/crates/elmdb-node')
os.chdir(r)
probe=r/'permission-denial-probe';probe.mkdir();(probe/'file').write_text('probe');probe.chmod(0)
try:
 try:list(probe.iterdir())
 except PermissionError:pass
 else:raise AssertionError('Container privileges bypass mode denial; cannot qualify permission tests')
finally:probe.chmod(0o700);shutil.rmtree(probe)
(o/'permission-preflight.json').write_text(json.dumps({'uid':os.getuid(),'modeDenial':True,'capEff':next(line.strip() for line in pathlib.Path('/proc/self/status').read_text().splitlines() if line.startswith('CapEff:'))},indent=2)+'\n')

results=[]
def run(label,args,limit):
 start=time.monotonic()
 with (o/(label+'.txt')).open('w') as f:
  try:
   p=subprocess.run(args,stdout=f,stderr=subprocess.STDOUT,timeout=limit)
   v={'label':label,'exitCode':p.returncode,'seconds':time.monotonic()-start}
  except subprocess.TimeoutExpired:v={'label':label,'timeoutSeconds':limit,'seconds':time.monotonic()-start}
 results.append(v);(o/'results.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(v),flush=True)
source_lock=(r/'package-lock.json').read_bytes()
run('dependencies',['npm','install','--ignore-scripts','--no-audit','--no-fund'],120)
assert results[-1].get('exitCode')==0, 'dependency setup failed; stop before package builds'
assert (r/'package-lock.json').read_bytes()==source_lock, 'dependency setup changed checked-in lockfile'




def check(name,args,env=None,negative=False,timeout=180):
 start=time.monotonic()
 with (o/(name+'.txt')).open('w') as f:
  p=subprocess.run(args,cwd=r,env=os.environ|(env or {}),stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 print(name,p.returncode,round(time.monotonic()-start,3),flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.txt')).read_text()[-16000:]




p=r/'packages/apack-cli/src/commands/build.ts';original=p.read_text()
trace="const recordDiagnosticStage = (root: string, phase: string) => fs.appendFileSync('/results/compiler-stages.jsonl', JSON.stringify({root, phase, pid:process.pid, time:Date.now(), cpu:process.cpuUsage(), memory:process.memoryUsage()})+'\\n');\n"
anchor='export async function build(args: string[], root = findPackRoot(process.cwd())) {'
assert original.count(anchor)==1
text=original.replace(anchor,trace+'\n'+anchor)
markers=[
('  const inputsHash = packInputsHash(root);','start'),
('  const compilation = captureCompilationInputs(root);','capture-inputs-start'),
('  const outputs = createBuildOutputs(outputDir);','capture-inputs-done'),
("    if (args.includes('--skip-generate')) assertGeneratedCurrent",'generate-start'),
('    compilation.captureGenerated();','generate-done'),
('    const packTypes = typesStale === null','facade-start'),
('    const packTypesProblems = packTypes.success','facade-done'),
('    const flowHelpers = await bundlePackFlowHelpers','flow-helpers-start'),
('    if (!flowHelpers.success) fail','flow-helpers-done'),
('    const contentRuntime = await bundlePackContentRuntime','content-runtime-start'),
('    if (contentRuntime.success) {','content-runtime-done'),
('    const runtimeResult = await bundlePackRuntime','runtime-start'),
('    if (runtimeResult.success) {','runtime-done'),
('      const feResult = await bundlePackFE','frontend-start'),
('      if (feResult.success) {','frontend-done'),
('    return await finish();','finish-start'),
('      return { inputHash: inputsHash, revision: readPackBuild(outputDir).revision };','finish-done')]
for anchor,stage in markers:
 assert text.count(anchor)==1,(anchor,text.count(anchor))
 text=text.replace(anchor,"    recordDiagnosticStage(root, "+json.dumps(stage)+");\n"+anchor)
p.write_text(text)
(o/'diagnostic-source.patch').write_bytes(subprocess.check_output(['git','diff','--',str(p)],cwd=r))
run('packages-build',['npm','run','packages:build'],180)
assert results[-1].get('exitCode')==0, 'package setup failed'
command=['node','node_modules/vitest/vitest.mjs','run','--config','vitest.integration.config.ts','--maxWorkers=2','--bail=1','packages/apack-cli/tests/build/dependency-graph.integration.spec.ts','packages/apack-cli/tests/build/build-registry.integration.spec.ts','--reporter=default','--reporter=json','--outputFile=/results/focused.json']
check('focused-compiler',command,env={'APACK_CHAIN_CORES':'2'},timeout=420)
