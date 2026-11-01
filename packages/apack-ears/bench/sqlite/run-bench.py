"""Fresh-process, sequential trials. Do not run alongside other builds or benchmarks."""
import argparse, hashlib, json, math, pathlib, platform, subprocess, time
parser=argparse.ArgumentParser()
parser.add_argument('output',type=pathlib.Path)
parser.add_argument('--trials',type=int,default=3)
parser.add_argument('--durable',action='store_true')
args=parser.parse_args()
if args.trials < 1: parser.error('--trials must be positive')
if args.output.exists() and any(args.output.iterdir()): parser.error('output must be new or empty; preserve existing results')
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
if provenance['elmdbObservedCommit'] != provenance['elmdbPinnedCommit']:
    raise RuntimeError('Observed elmdb source does not match the recorded pin')
records=[]
def save_matrix(completed):
    (args.output/'matrix.json').write_text(json.dumps({
        'protocol':'ears-backend-bench-trials/1', 'completed':completed, 'qualification':False,
        'source':provenance['commit'], 'trials':args.trials, 'durable':args.durable,
        'scope':provenance['scope'], 'records':records,
        'passed':completed and len(records)==args.trials*2 and all(record['passed'] for record in records),
    },indent=2)+'\n')
def text(value):
    return value.decode('utf8',errors='replace') if isinstance(value,bytes) else value or ''
def validate(value,backend):
    if value.get('backend') != backend or value.get('durable') is not args.durable or value.get('n') != 10000:
        raise ValueError('Report does not match the selected backend/durability/fixture')
    if value.get('consumed') is not True: raise ValueError('Benchmark results were not consumed')
    bindings=value.get('nativeBindings')
    if not isinstance(bindings,list) or not bindings or any(not isinstance(row,dict) or not isinstance(row.get('path'),str) or not isinstance(row.get('sha256'),str) or len(row['sha256'])!=64 or any(c not in '0123456789abcdef' for c in row['sha256']) for row in bindings):
        raise ValueError('Actually loaded native bindings must be fingerprinted')
    samples=value.get('samples',{})
    required=['field','unique','page50','row','all10k','sort10k','edges50','walk299','text','vector1k256',
              'smallFieldLargeRow','projectedLargePage','updateSmallRepeatedBody','updateSmallVariedBody',
              'streamBody16Chunks','write','writeBatch100','watch20']
    for name in required:
        values=samples.get(name)
        if not isinstance(values,list) or len(values)!=(1 if name=='watch20' else 5):
            raise ValueError('Missing complete timing rounds: '+name)
        if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or v<0 for v in values):
            raise ValueError('Invalid/nonfinite timing: '+name)
save_matrix(False)
for trial in range(1,args.trials+1):
    for backend in (['sqlite','elmdb'] if trial%2 else ['elmdb','sqlite']):
        name=f'{backend}-{trial}'
        print(f'Running {name}, durable={args.durable}',flush=True)
        command=['node','--import','tsx','--expose-gc','packages/apack-ears/bench/sqlite/bench.ts',backend]
        if args.durable:command.append('--durable')
        started=time.monotonic()
        try:
            result=subprocess.run(command,cwd=repo,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
        except subprocess.TimeoutExpired as error:
            (args.output/f'{name}.stdout').write_text(text(error.stdout))
            (args.output/f'{name}.stderr').write_text(text(error.stderr))
            records.append({'backend':backend,'trial':trial,'passed':False,'outcome':'timeout','secondsLimit':300,'elapsedSeconds':time.monotonic()-started})
            save_matrix(False)
            raise SystemExit(f'{name} timed out; partial output retained, no retry')
        (args.output/f'{name}.stdout').write_text(result.stdout)
        (args.output/f'{name}.stderr').write_text(result.stderr)
        record={'backend':backend,'trial':trial,'passed':False,'returncode':result.returncode,'elapsedSeconds':time.monotonic()-started}
        records.append(record)
        try:
            if result.returncode: raise ValueError('Benchmark process failed')
            value=json.loads(result.stdout)
            validate(value,backend)
            (args.output/f'{name}.json').write_text(json.dumps(value,indent=2)+'\n')
        except (ValueError,TypeError,AttributeError,KeyError) as error:
            record['outcome']='invalid-report' if result.returncode==0 else 'process-failed'
            record['error']=str(error);save_matrix(False)
            raise SystemExit(f'{name} failed; complete stdout/stderr retained, no retry: {error}')
        record['passed']=True;record['outcome']='passed';save_matrix(False)
save_matrix(True)
