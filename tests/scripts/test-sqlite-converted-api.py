#!/usr/bin/env python3
"""Prebuilt candidate gate: native profile -> SQLite -> real shipped pack/API boot and restart.

Only disposable Linux or Linux CI. Build matching packages, default-setup and API first.
The native producer must match vendor/elmdb.rev. No user profile or API credential is read.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import socket
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--producer', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
if platform.system() != 'Linux' or not (Path('/.dockerenv').exists() or os.environ.get('GITHUB_ACTIONS') == 'true'):
    raise SystemExit('Run this gate only in disposable Linux or Linux CI')
root = Path(__file__).resolve().parents[2]
producer = args.producer.resolve(strict=True)
out = args.output.resolve()
out.mkdir(mode=0o700)  # New caller-owned evidence directory; refuse an incumbent.
base = os.environ | {'APACK_ENV': 'test', 'NODE_OPTIONS': '', 'APACK_API_TOKEN': 'synthetic-converted-api-probe-token', 'SHIPPED_PACKS_DIR': str(root / 'packages')}
helper = 'tests/scripts/_support/sqlite-converted-api.mjs'
commands = []

def run(label, command, env=None, timeout=120):
    start = time.monotonic()
    with (out / (label + '.log')).open('w') as log:
        child = subprocess.Popen(command, cwd=root, env=env or base, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
            raise
    commands.append({'label': label, 'args': command, 'exitCode': code, 'seconds': time.monotonic() - start})
    (out / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
    if code:
        raise RuntimeError((out / (label + '.log')).read_text()[-16000:])

run('prebuilt-inputs', ['node', '--import', 'tsx', '--conditions=@apackdev/source', '--input-type=module', '-e',
    "import {packagesBuiltOrRefuse} from '@apackdev/host/build/packages-built'; if (!packagesBuiltOrRefuse('npm run packages:build')) throw new Error('Built inputs are required for this gate');"])
for file in ('packages/default-setup/dist/integrity.json', 'packages/api/dist/server.js'):
    if not (root / file).is_file():
        raise SystemExit('Missing prebuilt input: ' + file)
provenance = {'source': os.environ.get('EARS_TEST_SOURCE') or subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
    'enginePin': (root / 'vendor/elmdb.rev').read_text().strip(), 'producerSha256': hashlib.sha256(producer.read_bytes()).hexdigest(),
    'apiSha256': hashlib.sha256((root / 'packages/api/dist/server.js').read_bytes()).hexdigest(),
    'scope': 'Synthetic copied native profile, real built starter pack and Node API/RPC/live view; not Electron, renderer, installed distributions, large resources or power loss'}
(out / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
with tempfile.TemporaryDirectory(prefix='ears-converted-api-') as temporary:
    scratch = Path(temporary)
    source = scratch / 'native-source'
    source.mkdir()
    source_env = base | {'APACK_USER_DATA_DIR': str(source), 'APACK_STORAGE_FORMAT': 'elmdb/1'}
    run('seed-native', ['node', '--import', 'tsx', '--conditions=@apackdev/source', helper, 'seed', str(out / 'seed.json')], source_env)
    seed = json.loads((out / 'seed.json').read_text())
    def boot(profile, storage_format, trial, label, expected=None, changed=None):
        env = base | {'APACK_USER_DATA_DIR': str(profile), 'APACK_STORAGE_FORMAT': storage_format}
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        child_env = env | {'API_PORT': str(port), 'APACK_STARTUP_ID': label, 'CONVERTED_API_TRIAL': str(trial)}
        if expected is not None:
            child_env['CONVERTED_API_EXPECT_LABEL'] = expected
        if changed is not None:
            child_env['CONVERTED_API_WRITE_LABEL'] = changed
        endpoint = profile / 'apack/api-port'
        log_path = out / (label + '.log')
        rpc_file = out / (label + '-rpc.json')
        with log_path.open('w') as log:
            child = subprocess.Popen(['node', 'scripts/with-source.mjs', 'node', 'packages/api/dist/server.js'], cwd=root, env=child_env,
                stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            start = time.monotonic()
            try:
                while True:
                    if child.poll() is not None:
                        raise RuntimeError('API exited before readiness: ' + log_path.read_text()[-16000:])
                    try:
                        published = json.loads(endpoint.read_text())
                        if published.get('port') == port:
                            break
                    except (FileNotFoundError, json.JSONDecodeError):
                        pass
                    if time.monotonic() - start > 60:
                        raise TimeoutError('API did not publish readiness within the 60s smoke safety cap')
                    time.sleep(0.1)
                ready_seconds = time.monotonic() - start
                run(label + '-rpc', ['node', helper, 'client', str(rpc_file)], child_env, timeout=30)
            finally:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait()
                        raise
            assert child.returncode == 0, log_path.read_text()[-16000:]
        for line in log_path.read_text().splitlines():
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict) and item.get('__fatal'):
                raise RuntimeError('API reported fatal startup/runtime error: ' + line)
        return {'trial': trial, 'format': storage_format, 'readySeconds': ready_seconds, 'exitCode': child.returncode,
            'rpc': json.loads(rpc_file.read_text()), 'environmentDiagnostics': {'missingOptionalCodexExecutable': 'spawn codex ENOENT' in log_path.read_text()}}

    native = boot(source, 'elmdb/1', 0, 'native-baseline', 'converted native Prompt', 'updated in native baseline')
    (out / 'native-baseline.json').write_text(json.dumps(native, indent=2) + '\n')
    run('inspect-native-baseline', ['node', '--import', 'tsx', '--conditions=@apackdev/source', helper, 'source-inspect', str(out / 'native-inspection.json')], source_env)
    native_inspection = json.loads((out / 'native-inspection.json').read_text())
    run('convert', ['node', '--import', 'tsx', '--conditions=@apackdev/source', 'scripts/convert-sqlite-profile.ts', str(source), str(scratch / 'converted'), str(producer)], source_env)
    converted = json.loads((out / 'convert.log').read_text())
    profile = Path(converted['path'])
    assert profile.is_dir() and converted['format'] == 'sqlite/1'
    env = base | {'APACK_USER_DATA_DIR': str(profile), 'APACK_STORAGE_FORMAT': 'sqlite/1'}
    boots = []
    for trial in (1, 2):
        boots.append(boot(profile, 'sqlite/1', trial, 'sqlite-' + str(trial), 'updated in native baseline' if trial == 1 else None))
        (out / 'boots.json').write_text(json.dumps(boots, indent=2) + '\n')
    run('inspect-reopened', ['node', '--import', 'tsx', '--conditions=@apackdev/source', helper, 'inspect', str(out / 'inspection.json')], env)
    inspection = json.loads((out / 'inspection.json').read_text())
    assert inspection['mediaSha256'] == seed['hashes']['media']
    for key, name in (('primary', 'lmdb'), ('runs', 'runHistory')):
        assert hashlib.sha256((Path(seed['paths'][name]) / 'data.mdb').read_bytes()).hexdigest() == native_inspection['hashes'][key]
    (out / 'verification.json').write_text(json.dumps({'source': provenance['source'], 'nativeBaselineBoots': 1, 'sqliteBoots': 2, 'livePackUpdates': 3, 'postRestartDataRetained': True,
        'nativeSourceUnchanged': True, 'historyRetained': True, 'settingsRetained': True, 'mediaRetained': True,
        'environmentDiagnostics': {'missingOptionalCodexExecutable': any(item['environmentDiagnostics']['missingOptionalCodexExecutable'] for item in [native, *boots])}}, indent=2) + '\n')
