"""Fresh-process, sequential trials. Do not run alongside other builds or benchmarks."""
import argparse, hashlib, json, pathlib, platform, subprocess
parser=argparse.ArgumentParser()
parser.add_argument('output',type=pathlib.Path)
parser.add_argument('--trials',type=int,default=3)
parser.add_argument('--durable',action='store_true')
args=parser.parse_args()
repo=pathlib.Path(__file__).resolve().parents[4]
args.output.mkdir(parents=True,exist_ok=True)
# A commit alone does not identify a working-tree experiment. Retain exact source fingerprints as well.
files = sorted((repo/'packages/apack-ears/src').rglob('*.ts')) + sorted((repo/'packages/apack-ears/bench/sqlite').glob('*.*')) + [repo/'package-lock.json',repo/'vendor/elmdb.rev']
engine=repo/'vendor/elmdb'
observed_engine=subprocess.run(['git','rev-parse','HEAD'],cwd=engine,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
engine_files=sorted((engine/'crates').rglob('*.rs'))+sorted((engine/'crates').glob('*/Cargo.toml'))+[engine/'Cargo.toml',engine/'Cargo.lock']
# Resolve from the same source module as the adapter, and fingerprint the binaries actually loaded rather
# than assuming the binding lives in build/Release (v13 ships platform prebuilds).
node_probe = """
import {createRequire} from 'node:module';
import {loadedNativeBindings} from './packages/apack-ears/bench/sqlite/load-metrics.ts';
const require=createRequire(new URL('./packages/apack-ears/src/sqlite/database.ts',import.meta.url));
const driverPackage=require.resolve('better-sqlite3/package.json');
const extension=require('sqlite-vec');
const extensionPath=extension.getLoadablePath();
const db=new (require('better-sqlite3'))(':memory:');
extension.load(db);
const bindings=loadedNativeBindings([extensionPath]);
const files=bindings.map(binding=>binding.path);
if(!files.some(path=>path.endsWith('.node')))throw new Error('No loaded SQLite binding reported');
db.close();
console.log(JSON.stringify({driverPackage,driverVersion:require(driverPackage).version,extensionPath,files,bindings}));
"""
sqlite_native=json.loads(subprocess.check_output(['node','--experimental-strip-types','--input-type=module','-e',node_probe],cwd=repo,text=True))
bindings=list((engine/'crates/elmdb-node').glob('*.node'))+[pathlib.Path(path) for path in sqlite_native['files']]
provenance = {
    'commit': subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
    'status': subprocess.check_output(['git','status','--short'],cwd=repo,text=True),
    'sourceSha256': {str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in files if path.is_file()},
    'sqliteNative': sqlite_native,
    'platform': platform.platform(), 'machine': platform.machine(),
    'node': subprocess.check_output(['node','--version'],cwd=repo,text=True).strip(),
    'elmdbPinnedCommit': (repo/'vendor/elmdb.rev').read_text().strip(),
    'elmdbObservedCommit': observed_engine.stdout.strip() if observed_engine.returncode==0 else None,
    'elmdbSourceSha256': {str(path.relative_to(engine)):hashlib.sha256(path.read_bytes()).hexdigest() for path in engine_files if path.is_file()},
    'bindingSha256': {str(path.relative_to(repo)) if path.is_relative_to(repo) else str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in bindings if path.is_file()},
    'mounts': pathlib.Path('/proc/mounts').read_text() if pathlib.Path('/proc/mounts').exists() else None,
    'trials': args.trials, 'durable': args.durable,
    'scope': 'sequential fresh-process synthetic EARS fixture; not app latency, relevance, recall or platform qualification',
}
(args.output/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
for trial in range(1,args.trials+1):
    for backend in (['sqlite','elmdb'] if trial%2 else ['elmdb','sqlite']):
        name=f'{backend}-{trial}'
        print(f'Running {name}, durable={args.durable}',flush=True)
        command=['node','--import','tsx','--expose-gc','packages/apack-ears/bench/sqlite/bench.ts',backend]
        if args.durable:command.append('--durable')
        result=subprocess.run(command,cwd=repo,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
        (args.output/f'{name}.stderr').write_text(result.stderr)
        if result.returncode:raise RuntimeError(f'{name} failed: {result.stderr}')
        value=json.loads(result.stdout)
        (args.output/f'{name}.json').write_text(json.dumps(value,indent=2)+'\n')
