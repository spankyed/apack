import pathlib,shutil,subprocess,os,time,json,hashlib
root=pathlib.Path('/native');copy=pathlib.Path('/tmp/elmdb-overlay-mutant');out=pathlib.Path('/results')
original=subprocess.check_output(['git','diff','--binary'],cwd=root)
assert hashlib.sha256(original).hexdigest()=='a6c663442b58e3d04e436ecb485f823813fe4ab8ae6f6d2a23d3e863dc50a91d'
shutil.copytree(root,copy,ignore=shutil.ignore_patterns('.git','target','node_modules','*.node'))
file='crates/elmdb/src/engine/vector/mod.rs'
(copy/file).write_bytes(subprocess.check_output(['git','show','HEAD:'+file],cwd=root))
command=['cargo','test','--locked','--profile','mutants','-p','elmdb','engine::vector::tests::unit_vector_reads_overlay_pending_graph_changes_and_savepoint_rollback','--','--exact']
start=time.monotonic()
with (out/'mutation.log').open('w') as log:p=subprocess.run(command,cwd=copy,env=os.environ|{'CARGO_BUILD_JOBS':'2','CARGO_TARGET_DIR':'/native/target'},stdout=log,stderr=subprocess.STDOUT,timeout=180)
log=(out/'mutation.log').read_text()
assert p.returncode!=0 and 'assertion `left == right` failed' in log and '0 passed; 1 failed' in log,log[-6000:]
assert subprocess.check_output(['git','diff','--binary'],cwd=root)==original
(out/'mutation.json').write_text(json.dumps({'base':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'patchSha256':hashlib.sha256(original).hexdigest(),'mutation':'restore committed nearest-vector implementation in a disposable source copy, retaining new regression','command':command,'exitCode':p.returncode,'seconds':time.monotonic()-start,'intendedAssertionFailed':True,'originalSourceUnchanged':True},indent=2)+'\n')
print('Mutation rejected by the intended regression; source volume unchanged',flush=True)
