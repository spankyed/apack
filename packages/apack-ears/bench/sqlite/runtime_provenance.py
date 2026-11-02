"""Capture exact code/runtime/native provenance without creating a workload or acceptance matrix."""
import hashlib
import json
import pathlib
import platform
import subprocess


def capture_runtime_provenance(repo, execution):
    if execution not in ['source', 'built-package']:
        raise ValueError('Execution must identify source or built-package code')
    # A commit alone does not identify a working-tree experiment. Retain exact source fingerprints as well.
    files = sorted((repo/'packages/apack-ears/src').rglob('*.ts')) + sorted((repo/'packages/apack-ears/bench/sqlite').glob('*.*')) + [repo/'package-lock.json',repo/'vendor/elmdb.rev']
    runtime_files = sorted(path for path in (repo/'packages/apack-ears/dist').rglob('*') if path.suffix in ['.js', '.wasm'])
    engine=repo/'vendor/elmdb'
    observed_engine=subprocess.run(['git','rev-parse','HEAD'],cwd=engine,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    engine_files=sorted((engine/'crates').rglob('*.rs'))+sorted((engine/'crates').glob('*/Cargo.toml'))+[engine/'Cargo.toml',engine/'Cargo.lock']
    # Resolve from the same source module as the adapter, and fingerprint the binaries actually loaded rather
    # than assuming the binding lives in build/Release (v13 ships platform prebuilds).
    node_probe = """
    import {createRequire} from 'node:module';
    import {loadedNativeBindings} from './packages/apack-ears/bench/sqlite/load-metrics.ts';
    const require=createRequire(new URL(MODULE_ENTRY,import.meta.url));
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
    node_probe=node_probe.replace('MODULE_ENTRY',json.dumps('./packages/apack-ears/' + ('src/sqlite/database.ts' if execution == 'source' else 'dist/sqlite/database.js')))
    sqlite_native=json.loads(subprocess.check_output(['node','--experimental-strip-types','--input-type=module','-e',node_probe],cwd=repo,text=True))
    bindings=list((engine/'crates/elmdb-node').glob('*.node'))+[pathlib.Path(path) for path in sqlite_native['files']]
    cpu_info = pathlib.Path('/proc/cpuinfo')
    cpu_models = sorted({line.partition(':')[2].strip() for line in cpu_info.read_text().splitlines() if line.startswith('model name')}) if cpu_info.exists() else []
    provenance = {
        'commit': subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
        'status': subprocess.check_output(['git','status','--short'],cwd=repo,text=True),
        'sourceSha256': {str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in files if path.is_file()},
        'runtimeSha256': {str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in runtime_files if path.is_file()},
        'execution': execution,
        'sqliteNative': sqlite_native,
        'platform': platform.platform(), 'machine': platform.machine(), 'cpuModels': cpu_models,
        'node': subprocess.check_output(['node','--version'],cwd=repo,text=True).strip(),
        'elmdbPinnedCommit': (repo/'vendor/elmdb.rev').read_text().strip(),
        'elmdbObservedCommit': observed_engine.stdout.strip() if observed_engine.returncode==0 else None,
        'elmdbSourceSha256': {str(path.relative_to(engine)):hashlib.sha256(path.read_bytes()).hexdigest() for path in engine_files if path.is_file()},
        'bindingSha256': {str(path.relative_to(repo)) if path.is_relative_to(repo) else str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in bindings if path.is_file()},
        'mounts': pathlib.Path('/proc/mounts').read_text() if pathlib.Path('/proc/mounts').exists() else None,
    }
    return provenance
