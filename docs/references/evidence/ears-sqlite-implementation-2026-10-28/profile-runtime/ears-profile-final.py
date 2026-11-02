import pathlib,subprocess,json,hashlib,time,os
r=pathlib.Path('/metrics');o=pathlib.Path('/results')
files=list((r/'packages/apack-ears/src').rglob('*.ts'))+list((r/'packages/apack-host/src/database').glob('*.ts'))+[r/'packages/api/src/runtime/index.ts',r/'packages/api/tsup.config.ts',r/'scripts/bundle-package.ts',r/'packages/apack-cli/src/build/compiler-watch.ts']
(o/'source-sha256.json').write_text(json.dumps({str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files},indent=2)+'\n')
def run(name,args,expected=0,env=None,timeout=180):
 start=time.monotonic();p=subprocess.run(args,cwd=r,env=os.environ|(env or {}),text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
 (o/(name+'.txt')).write_text(p.stdout);print(name,p.returncode,round(time.monotonic()-start,3),flush=True)
 assert (p.returncode==0 if expected==0 else p.returncode!=0),p.stdout[-16000:]
 return p.stdout
run('packages-build',['npm','run','packages:build'])
run('ears-types',['npm','run','typecheck','-w','@apackdev/ears'])
run('source-node',['npm','test','-w','@apackdev/ears','--','tests/sqlite/source-node.spec.ts'])
p=r/'packages/apack-ears/src/sqlite/search.ts';original=p.read_text();before='  private readonly db: SqliteDatabase;\n  constructor(db: SqliteDatabase) { this.db = db; this.trigrams = new SqliteTrigrams(db); }';assert before in original
try:
 p.write_text(original.replace(before,'  constructor(private readonly db: SqliteDatabase) { this.trigrams = new SqliteTrigrams(db); }'))
 v=run('negative-source-transform',['npm','test','-w','@apackdev/ears','--','tests/sqlite/source-node.spec.ts'],expected=1)
 assert 'strip-only' in v or 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX' in v,v[-12000:]
finally:p.write_text(original)
run('api-bundle',['npm','test','-w','@app/api','--','tests/runtime/sqlite-bundle.spec.ts'])
p=r/'packages/api/tsup.config.ts';original=p.read_text();assert ", '@apackdev/ears/sqlite'" in original
try:
 p.write_text(original.replace(", '@apackdev/ears/sqlite'",''))
 v=run('negative-api-boundary',['npm','test','-w','@app/api','--','tests/runtime/sqlite-bundle.spec.ts'],expected=1)
 assert 'better_sqlite3.node' in v,v[-12000:]
finally:p.write_text(original)
run('compiler-watch',['npm','test','-w','@apackdev/cli','--','tests/build/compiler-watch.spec.ts'])
p=r/'packages/apack-cli/src/build/compiler-watch.ts';original=p.read_text();before="if (event !== 'rename') return (kind !== undefined && kind !== 'directory') || (kind === undefined && ancestors.has(changed));";assert before in original
try:
 p.write_text(original.replace(before,"if (event !== 'rename') return kind !== undefined && kind !== 'directory';"))
 run('negative-watch-ancestor',['npm','test','-w','@apackdev/cli','--','tests/build/compiler-watch.spec.ts','-t','ancestor reports change'],expected=1)
finally:p.write_text(original)
run('sqlite',['npm','test','-w','@apackdev/ears','--','--reporter=json','--outputFile=/results/sqlite.json'],env={'EARS_EVALUATION_BACKEND':'sqlite'})
run('native',['npm','test','-w','@apackdev/ears','--','--reporter=json','--outputFile=/results/native.json'],env={'EARS_EVALUATION_BACKEND':'elmdb'})
for name in ['sqlite','native']:
 v=json.loads((o/(name+'.json')).read_text());print(name,v['numPassedTests'],v['numFailedTests'],flush=True)
run('host-profiles',['npm','test','-w','@apackdev/host','--','tests/database/storage.spec.ts','tests/backup/storage.spec.ts','tests/database/open-app-database.spec.ts'])
run('api-profiles',['npm','test','-w','@app/api','--','tests/runtime/sqlite-profile.spec.ts','tests/runtime/restart-persistence.spec.ts','tests/runtime/sqlite-bundle.spec.ts'])
run('cli-profiles',['npm','test','-w','@apackdev/cli','--','tests/commands/sqlite-profile.spec.ts','tests/build/compiler-watch.spec.ts'])
run('dev-build-current',['npm','test','-w','@apackdev/cli','--','--config','vitest.integration.config.ts','tests/commands/dev-build.integration.spec.ts'])
run('watch-repair-current',['npm','test','-w','@apackdev/cli','--','--config','vitest.native.config.ts','tests/build/watch-worker-inputs.native.spec.ts'],timeout=300)
for workspace,name in [('@apackdev/host','host'),('@apackdev/cli','cli')]:run('types-'+name,['npm','run','typecheck','-w',workspace])
run('types-api',['node','node_modules/typescript/bin/tsc','--noEmit','-p','packages/api/tsconfig.json'])
for workspace,name in [('@apackdev/ears','ears'),('@apackdev/sdk','sdk')]:run('api-'+name,['npm','run','api:check','-w',workspace])
run('lint',['npm','run','lint:check'])
run('specifiers',['npm','run','check:specifiers'])
run('scripts-types',['npm','run','typecheck:scripts'],timeout=60)
expected=json.loads((o/'source-sha256.json').read_text());assert all(hashlib.sha256((r/f).read_bytes()).hexdigest()==h for f,h in expected.items())
