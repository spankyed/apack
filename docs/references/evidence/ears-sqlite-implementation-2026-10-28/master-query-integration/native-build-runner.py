import subprocess,pathlib,json,hashlib,time,os
root=pathlib.Path('/native');out=pathlib.Path('/results');pin='4d558a27543a74e2ea4c131aff1cb32455708994'
assert not list(root.iterdir()),'Refuse to overwrite an existing native volume'
subprocess.run(['git','clone','--quiet','/source.bundle',str(root)],check=True)
subprocess.run(['git','-C',str(root),'checkout','--quiet','--detach',pin],check=True)
assert subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()==pin
assert not subprocess.check_output(['git','-C',str(root),'status','--porcelain'],text=True).strip()
limits={name:pathlib.Path('/sys/fs/cgroup',name).read_text().strip() for name in ('cpu.max','memory.max','memory.swap.max')}
assert limits=={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'}
env=os.environ|{'CARGO_BUILD_JOBS':'2','CARGO_TARGET_DIR':'/native/target'}
command=['cargo','build','--locked','--release','-p','elmdb-node','-p','elmdb-cli']
started=time.monotonic()
with (out/'build.log').open('w') as log:
 process=subprocess.run(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
print('cargo exit',process.returncode,flush=True)
assert process.returncode==0,(out/'build.log').read_text()[-6000:]
binding=root/'crates/elmdb-node/elmdb.linux-arm64-gnu.node'
binding.write_bytes((root/'target/release/libelmdb_node.so').read_bytes())
loaded=subprocess.check_output(['node','-e',"const n=require('/native/crates/elmdb-node');console.log(JSON.stringify(Object.keys(n).sort()))"],text=True)
record={'source':pin,'command':command,'seconds':time.monotonic()-started,'limits':limits,'rustc':subprocess.check_output(['rustc','--version'],text=True).strip(),'bindingSha256':hashlib.sha256(binding.read_bytes()).hexdigest(),'cliSha256':hashlib.sha256((root/'target/release/elmdb').read_bytes()).hexdigest(),'moduleExports':json.loads(loaded),'trackedChanges':subprocess.check_output(['git','-C',str(root),'status','--porcelain','--untracked-files=no'],text=True).strip()}
assert not record['trackedChanges']
(out/'provenance.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record),flush=True)
