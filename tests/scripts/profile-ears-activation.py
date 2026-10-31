#!/usr/bin/env python3
"""Observe real pack activation on prebuilt isolated APIs; never run on a daily-use profile.

Diagnostic only. Default backend acknowledgment policies differ. This does not replace
the renderer's five-second acceptance assertion or establish a causal storage speedup.
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
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
if platform.system() not in ('Darwin', 'Linux') or not (
    os.environ.get('GITHUB_ACTIONS') == 'true' or
    (platform.system() == 'Linux' and Path('/.dockerenv').exists())
):
    raise SystemExit('Use disposable Linux or hosted CI, never the daily Mac')
root = Path(__file__).resolve().parents[2]
out = args.output.resolve()
out.mkdir(mode=0o700, parents=True)
source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
observer = root / 'tests/scripts/_support/ears-activation-observer.mjs'
client = root / 'tests/scripts/_support/ears-activation-client.mjs'
inputs = [observer, client, root / 'packages/api/dist/server.js',
          root / 'packages/default-setup/dist/integrity.json']
report = {
    'source': source,
    'nativePin': (root / 'vendor/elmdb.rev').read_text().strip(),
    'qualification': False,
    'scope': 'Backend-only sampled stacks and overlapping SQL spans; no renderer acceptance',
    'policies': 'Ordinary defaults: SQLite FULL per commit; elmdb default group commit. No policy tuning.',
    'observationBounds': {'startupSeconds': 45, 'activationSeconds': 30, 'shutdownSeconds': 15},
    'inputs': {}, 'cases': [],
}


def save():
    (out / 'run.json').write_text(json.dumps(report, indent=2) + '\n')


def stop(child, entry):
    if child.poll() is not None:
        return
    os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=15)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
        entry['forcedStop'] = True


try:
    report['inputs'] = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
    subprocess.run(['node', '--import', 'tsx', '--conditions=@apackdev/source', '--input-type=module', '-e',
                    "import {packagesBuiltOrRefuse} from '@apackdev/host/build/packages-built'; "
                    "if (!packagesBuiltOrRefuse('npm run packages:build')) throw Error('Stale package inputs');"],
                   cwd=root, check=True, timeout=120)
    with tempfile.TemporaryDirectory(prefix='ears-activation-profile-') as scratch:
        for backend in ('sqlite', 'elmdb'):
            entry = {'backend': backend}
            report['cases'].append(entry)
            profile = Path(scratch) / backend
            config = profile / 'apack/installed-packs.json'
            config.parent.mkdir(parents=True)
            config.write_text(json.dumps({'packs': [{'id': 'default-setup', 'enabled': False}]}))
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0))
                port = listener.getsockname()[1]
            hook = out / (backend + '-hook.json')
            env = os.environ | {
                'APACK_ENV': 'test', 'APACK_USER_DATA_DIR': str(profile),
                'APACK_STORAGE_FORMAT': backend + '/1', 'API_PORT': str(port),
                'APACK_API_TOKEN': 'synthetic-activation-profile-token',
                'SHIPPED_PACKS_DIR': str(root / 'packages'), 'APACK_PACKAGES_PREBUILT': '1',
                'NODE_OPTIONS': '--conditions=@apackdev/source --max-old-space-size=4096',
                'EARS_TEST_SOURCE': source, 'EARS_ACTIVATION_REPORT': str(hook),
            }
            with (out / (backend + '-api.log')).open('w') as log:
                child = subprocess.Popen(['node', '--import', 'tsx', '--import', str(observer),
                                          'packages/api/dist/server.js'], cwd=root, env=env,
                                         stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                try:
                    at = time.monotonic()
                    while True:
                        if child.poll() is not None:
                            raise RuntimeError('API exited before readiness: ' + str(child.returncode))
                        endpoint = profile / 'apack/api-port'
                        try:
                            ready = json.loads(endpoint.read_text()).get('port') == port
                        except (FileNotFoundError, json.JSONDecodeError):
                            ready = False
                        if ready:
                            break
                        if time.monotonic() - at >= 45:
                            raise RuntimeError('API startup observation exceeded45sec')
                        time.sleep(.1)
                    entry['startupSeconds'] = time.monotonic() - at
                    client_env = env | {'EARS_API_PID': str(child.pid)}
                    with (out / (backend + '-client.log')).open('w') as client_log:
                        result = subprocess.run(['node', str(client), str(out / (backend + '.json'))],
                                                cwd=root, env=client_env, stdout=client_log,
                                                stderr=subprocess.STDOUT, timeout=35)
                    if result.returncode:
                        raise RuntimeError('Activation client refused: ' + str(result.returncode))
                    answer = json.loads((out / (backend + '.json')).read_text())
                    assert answer['completed'] and answer['profile']['state'] == 'complete'
                    assert (out / (backend + '-hook.json.cpuprofile')).is_file()
                    commits = sum(s['count'] for s in answer['profile']['stats'] if ':commitWrite' in s['key'])
                    assert commits > 0 if backend == 'sqlite' else commits == 0
                    entry.update({'completed': True, 'backendReadyMs': answer['backendReadyMs'],
                                  'observedSqliteCommits': commits})
                except Exception as error:
                    entry['failure'] = {'type': type(error).__name__, 'message': str(error)}
                finally:
                    stop(child, entry)
                    entry['childExitCode'] = child.returncode
                    save()
    report['completed'] = all(c.get('completed') and not c.get('forcedStop') for c in report['cases'])
except Exception as error:
    report['failure'] = {'type': type(error).__name__, 'message': str(error)}
finally:
    save()
if not report.get('completed'):
    raise SystemExit(1)
