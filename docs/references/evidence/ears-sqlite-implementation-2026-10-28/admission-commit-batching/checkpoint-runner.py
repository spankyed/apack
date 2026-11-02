from pathlib import Path
import tarfile,subprocess,shutil,os,time,json,hashlib
r=Path('/metrics');o=Path('/results');r.mkdir(exist_ok=True)
source='2d0a0e7d4885b47c3d330870e75ff74666f81fdd'
with tarfile.open('/source.tar') as t:
 assert t.pax_headers['comment']==source
 for member in t:
  if member.isfile():assert (r/member.name).read_bytes()==t.extractfile(member).read(),member.name
assert (r/'package-lock.json').read_bytes()==Path('/seed/package-lock.json').read_bytes()
limits={n:Path('/sys/fs/cgroup',n).read_text().strip() for n in ('cpu.max','memory.max','memory.swap.max')}
assert limits=={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'}
assert hashlib.sha256(Path('/upstream.c').read_bytes()).hexdigest()=='b341c15fe10e41a9b96981ff3a9c217ea0774b4e04932b5acf3dac1320aeceb1'
assert hashlib.sha256(Path('/truth/truth.json').read_bytes()).hexdigest()=='ca6356a0cf0059ba87e5f628e9ae0a32260adf146617acb498c880cdf9442545'
with (o/'build-extension.log').open('w') as f:subprocess.run(['node','native/vectors/build.mjs','/metrics/patched','/upstream.c'],cwd=r,stdout=f,stderr=subprocess.STDOUT,check=True)
provenance=json.loads((r/'patched/provenance.json').read_text());assert provenance['sourceSha256']=='5d49d5ea17fbeaa1f22141305a81a5aeac8feb1af652a0d8229ea906bd5c973b'
(o/'native-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
extension=r/'patched/vec1.so'
base=r/'packages/apack-ears/bench/sqlite/real-vector-ears.mjs';original=base.read_text();probe=original
needle="  report.initialCanonicalRowsVerified=canonicalHash(false); report.filesAfterLoad=files(); save();"
assert probe.count(needle)==1
probe=probe.replace(needle,needle+'''\n  const checkpointMode=process.env.EARS_CHECKPOINT_PROBE;
  assert(['auto','manual'].includes(checkpointMode));
  const beforeCheckpoint=db.sql.pragma('wal_checkpoint(TRUNCATE)');
  assert.equal(beforeCheckpoint[0].busy,0);
  const beforeAdmissionAutoThreshold=db.sql.pragma('wal_autocheckpoint',{simple:true});
  assert.equal(beforeAdmissionAutoThreshold,1000);
  if(checkpointMode==='manual')db.sql.pragma('wal_autocheckpoint=0');
  report.checkpointProbe={mode:checkpointMode,beforeCheckpoint,beforeAdmissionAutoThreshold,
    admissionAutoThreshold:db.sql.pragma('wal_autocheckpoint',{simple:true}),filesAtAdmissionStart:files()};
  assert.equal(db.sql.pragma('synchronous',{simple:true}),2);
''')
needle="trace.push({stage:label,atMs:at-admissionAt,ms:performance.now()-at});"
assert probe.count(needle)==1
probe=probe.replace(needle,"trace.push({stage:label,atMs:at-admissionAt,ms:performance.now()-at,...(label==='writer-commit'?{walBytes:existsSync(join(path,'data.sqlite3-wal'))?statSync(join(path,'data.sqlite3-wal')).size:0}:{})});")
a=probe.index('  const queryFor=');b=probe.index('} catch(error)',a)
probe=probe[:a]+'''  assert.equal(db.sql.pragma('synchronous',{simple:true}),2);
  report.checkpointProbe.filesAfterAdmission=files();
  const checkpointAt=performance.now();
  report.checkpointProbe.finalPassiveCheckpoint=db.sql.pragma('wal_checkpoint(PASSIVE)');
  report.checkpointProbe.finalCheckpointMs=performance.now()-checkpointAt;
  report.checkpointProbe.finalCanonicalRowsVerified=canonicalHash(false);
  report.checkpointProbe.scope='admission-only attribution; manual checkpoint is foreground and not an adopted scheduling solution';
  report.maxRssKiB=process.resourceUsage().maxRSS;
  report.completed=true;save();
''' +probe[b:]
file=base.parent/'checkpoint-admission-probe.mjs';file.write_text(probe)
(o/'probe-source.mjs').write_text(probe)
(o/'source.json').write_text(json.dumps({'source':source,'baseHarnessSha256':hashlib.sha256(original.encode()).hexdigest(),'probeSha256':hashlib.sha256(probe.encode()).hexdigest(),'extensionSha256':hashlib.sha256(extension.read_bytes()).hexdigest(),'limits':limits,'order':['auto-1000','manual-1000','auto-99900','manual-99900'],'control':'same data and FULL commits; checkpoint thresholds changed only after common truncating checkpoint before model admission; separate model training, fixed order, not a paired same-model performance claim'},indent=2)+'\n')
rows=[]
for size in [1000,99900]:
 for mode in ['auto','manual']:
  name=mode+'-'+str(size);args=['node','--import','tsx',str(file),'/corpus','/truth/truth.json',str(size),'/results/'+name+'.json','native-diagnose'];start=time.monotonic()
  with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=os.environ|{'EARS_TEST_SOURCE':source,'EARS_VEC1_EXTENSION':str(extension),'EARS_CHECKPOINT_PROBE':mode},stdout=f,stderr=subprocess.STDOUT,timeout=480)
  rows.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'results.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True)
  assert p.returncode==0,(o/(name+'.log')).read_text()[-10000:]
  report=json.loads((o/(name+'.json')).read_text());assert report['completed'] and report['synchronous']==2 and report['checkpointProbe']['finalCanonicalRowsVerified']==size and report['modelAdmission']['state']['state']=='ready'
